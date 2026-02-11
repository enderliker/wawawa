import {
  AttachmentBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import fs from 'node:fs/promises';
import path from 'node:path';

import { guardInteraction } from '../guards/ownerOnly.js';
import { createChildLogger } from '../util/logger.js';
import { DATA_DIR } from '../util/settings.js';

const log = createChildLogger('IACommand');

const MAX_DISCORD_CHARS = 1900;
const AGENT_FILE = path.join(DATA_DIR, 'mistral_agent.json');
const CONVERSATIONS_FILE = path.join(DATA_DIR, 'mistral_conversations.json');

const IA_SYSTEM_PROMPT =
  'Eres una IA privada para Discord. Responde siempre en español. Usa jerga peruana natural, tono técnico directo y jerárquico, sin ser grosero. No menciones herramientas internas, APIs, modelos ni infraestructura. Si te preguntan quién eres, responde exactamente: "Soy el bot de Ender."';

type AgentStore = { basicAgentId: string; updatedAt: string };
type ConversationStore = Record<string, { conversationId: string; updatedAt: string }>;

type AskIaArgs = {
  guildId: string | null;
  channelId: string;
  userId: string;
  userText: string;
};

type AskIaResult = {
  text: string;
  fileIds: string[];
  attachments: AttachmentBuilder[];
};

function nowIso(): string {
  return new Date().toISOString();
}

async function ensureDataDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(filePath: string, payload: unknown): Promise<void> {
  await ensureDataDir();
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await fs.rename(tmpPath, filePath);
}

function getApiKey(): string {
  const key = process.env.MISTRAL_API_KEY?.trim();
  if (!key) throw new Error('Falta MISTRAL_API_KEY en el .env');
  return key;
}

function getModel(): string {
  return process.env.MISTRAL_MODEL?.trim() || 'mistral-small-latest';
}

function getChannelKey(guildId: string | null, channelId: string): string {
  return `${guildId ?? 'dm'}:${channelId}`;
}

async function mistralPost(endpointPath: string, body: unknown): Promise<{ status: number; json: any }> {
  const response = await fetch(`https://api.mistral.ai${endpointPath}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  const raw = await response.text();
  let json: any = {};
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    json = { raw };
  }

  return { status: response.status, json };
}

function isRateLimit(status: number, body: any): boolean {
  const message = JSON.stringify(body ?? {}).toLowerCase();
  return status === 429 || message.includes('rate limit') || message.includes('too many requests');
}

function extractAssistantText(raw: any): string {
  const candidates = [
    raw?.output?.[0]?.content,
    raw?.output,
    raw?.message?.content,
    raw?.choices?.[0]?.message?.content,
    raw?.content,
  ];

  for (const content of candidates) {
    if (typeof content === 'string' && content.trim()) return content.trim();
    if (Array.isArray(content)) {
      const blocks: string[] = [];
      for (const block of content) {
        if (!block || typeof block !== 'object') continue;
        if (block.type === 'text' && typeof block.text === 'string') blocks.push(block.text.trim());
      }
      const joined = blocks.filter(Boolean).join('\n').trim();
      if (joined) return joined;
    }
  }

  if (typeof raw?.output_text === 'string' && raw.output_text.trim()) return raw.output_text.trim();
  return '';
}

function extractGeneratedFileIds(raw: any): string[] {
  const ids = new Set<string>();

  const walk = (node: any): void => {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (typeof node !== 'object') return;

    if (typeof node.file_id === 'string') ids.add(node.file_id);
    if (typeof node.id === 'string' && String(node.type || '').includes('image')) ids.add(node.id);
    if (typeof node.image_id === 'string') ids.add(node.image_id);

    for (const value of Object.values(node)) walk(value);
  };

  walk(raw);
  return [...ids];
}

export function splitForDiscord(text: string): string[] {
  const input = text || '';
  const chunks: string[] = [];
  for (let i = 0; i < input.length; i += MAX_DISCORD_CHARS) {
    chunks.push(input.slice(i, i + MAX_DISCORD_CHARS));
  }
  return chunks.length ? chunks : [' '];
}

function shouldUseWebSearch(prompt: string): boolean {
  const t = prompt.trim().toLowerCase();
  if (!t) return false;
  const keywords = [
    'hoy', 'ahora', 'último', 'ultimo', 'cambió', 'cambio', 'docs', 'documentación', 'documentacion',
    'api', 'endpoint', 'precio', 'estado', '2026', 'version', 'rate limit', 'según la web', 'segun la web',
    'investiga', 'busca',
  ];
  return keywords.some((word) => t.includes(word));
}

function shouldGenerateImage(prompt: string): boolean {
  const t = prompt.trim().toLowerCase();
  if (!t) return false;
  return /(genera imagen|genera una imagen|haz una imagen|crear imagen|dibuja|render|ilustraci[oó]n|imagen de)/i.test(t);
}

async function ensureBasicAgentId(): Promise<string | null> {
  const saved = await readJson<AgentStore | null>(AGENT_FILE, null);
  if (saved?.basicAgentId) return saved.basicAgentId;

  const payload = {
    name: 'ender-basic-text-agent',
    model: getModel(),
    instructions: IA_SYSTEM_PROMPT,
  };

  const create = await mistralPost('/v1/agents', payload);
  if (create.status >= 200 && create.status < 300 && typeof create.json?.id === 'string') {
    const toSave: AgentStore = { basicAgentId: create.json.id, updatedAt: nowIso() };
    await writeJsonAtomic(AGENT_FILE, toSave);
    return toSave.basicAgentId;
  }

  log.warn({ status: create.status, body: create.json }, 'No se pudo crear/leer agente persistente, usando fallback');
  return null;
}

async function ensureConversationId(channelKey: string): Promise<string | null> {
  const saved = await readJson<ConversationStore>(CONVERSATIONS_FILE, {});
  if (saved[channelKey]?.conversationId) return saved[channelKey].conversationId;

  const created = await mistralPost('/v1/conversations', {});
  if (created.status >= 200 && created.status < 300 && typeof created.json?.id === 'string') {
    saved[channelKey] = { conversationId: created.json.id, updatedAt: nowIso() };
    await writeJsonAtomic(CONVERSATIONS_FILE, saved);
    return created.json.id;
  }

  log.warn({ status: created.status, body: created.json, channelKey }, 'No se pudo crear conversación persistente, usando fallback');
  return null;
}

async function updateConversationTimestamp(channelKey: string, conversationId: string): Promise<void> {
  const saved = await readJson<ConversationStore>(CONVERSATIONS_FILE, {});
  saved[channelKey] = { conversationId, updatedAt: nowIso() };
  await writeJsonAtomic(CONVERSATIONS_FILE, saved);
}

async function runAgentTurn(params: {
  agentId: string;
  conversationId: string;
  prompt: string;
  enableWeb: boolean;
  enableImage: boolean;
}): Promise<{ status: number; body: any }> {
  const tools: Array<Record<string, string>> = [];
  if (params.enableWeb) tools.push({ type: 'web_search' });
  if (params.enableImage) tools.push({ type: 'image_generation' });

  const attemptBodies = [
    {
      agent_id: params.agentId,
      conversation_id: params.conversationId,
      messages: [{ role: 'user', content: params.prompt }],
      ...(tools.length ? { tools } : {}),
    },
    {
      agent_id: params.agentId,
      conversation_id: params.conversationId,
      input: params.prompt,
      ...(tools.length ? { tools } : {}),
    },
  ];

  for (const body of attemptBodies) {
    const res = await mistralPost('/v1/agents/completions', body);
    if (res.status !== 404) {
      return { status: res.status, body: res.json };
    }
  }

  return { status: 404, body: { error: 'agents completion endpoint not available' } };
}

async function runFallbackChat(prompt: string): Promise<string> {
  const res = await mistralPost('/v1/chat/completions', {
    model: getModel(),
    messages: [
      { role: 'system', content: IA_SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
  });

  if (res.status >= 200 && res.status < 300) {
    return extractAssistantText(res.json);
  }

  throw new Error(`Mistral fallback error ${res.status}: ${JSON.stringify(res.json)}`);
}

export async function askIA(args: AskIaArgs): Promise<AskIaResult> {
  const { guildId, channelId, userText } = args;

  const wantsWeb = shouldUseWebSearch(userText);
  const wantsImage = shouldGenerateImage(userText);
  const channelKey = getChannelKey(guildId, channelId);

  try {
    const agentId = await ensureBasicAgentId();
    const conversationId = await ensureConversationId(channelKey);

    if (agentId && conversationId) {
      const primary = await runAgentTurn({
        agentId,
        conversationId,
        prompt: userText,
        enableWeb: wantsWeb,
        enableImage: wantsImage,
      });

      if (primary.status >= 200 && primary.status < 300) {
        await updateConversationTimestamp(channelKey, conversationId);
        const text = extractAssistantText(primary.body) || 'No salió texto útil, repite con más contexto.';
        const fileIds = extractGeneratedFileIds(primary.body);
        return { text, fileIds, attachments: [] };
      }

      if (wantsWeb && isRateLimit(primary.status, primary.body)) {
        log.warn({ status: primary.status }, 'Rate limit con búsqueda web, reintentando sin web');
        const retry = await runAgentTurn({
          agentId,
          conversationId,
          prompt: userText,
          enableWeb: false,
          enableImage: wantsImage,
        });
        if (retry.status >= 200 && retry.status < 300) {
          await updateConversationTimestamp(channelKey, conversationId);
          const text = extractAssistantText(retry.body) || 'No salió texto útil, repite con más contexto.';
          const fileIds = extractGeneratedFileIds(retry.body);
          return { text, fileIds, attachments: [] };
        }
      }

      if (wantsImage && isRateLimit(primary.status, primary.body)) {
        log.warn({ status: primary.status }, 'Rate limit en imagen, degradando a texto puro');
        const retryText = await runAgentTurn({
          agentId,
          conversationId,
          prompt: `${userText}\n\nSi no puedes generar imagen, responde solo con una descripción textual útil.`,
          enableWeb: wantsWeb,
          enableImage: false,
        });
        if (retryText.status >= 200 && retryText.status < 300) {
          await updateConversationTimestamp(channelKey, conversationId);
          const text = extractAssistantText(retryText.body) || 'No salió texto útil, repite con más contexto.';
          return { text, fileIds: [], attachments: [] };
        }
      }

      log.warn({ status: primary.status, body: primary.body }, 'Fallo en flujo de agentes, degradando a chat básico');
    }

    const fallbackText = await runFallbackChat(userText);
    return {
      text: fallbackText || 'No pude responder ahorita, intenta en un toque.',
      fileIds: [],
      attachments: [],
    };
  } catch (err) {
    log.error({ err }, 'Error IA no fatal; devolviendo mensaje seguro');
    return {
      text: 'Estoy con carga ahorita. Reintenta en un momento, causa.',
      fileIds: [],
      attachments: [],
    };
  }
}

export async function getMistralFileContent(fileId: string): Promise<Buffer | null> {
  try {
    const response = await fetch(`https://api.mistral.ai/v1/files/${encodeURIComponent(fileId)}/content`, {
      headers: { Authorization: `Bearer ${getApiKey()}` },
    });

    if (!response.ok) {
      log.warn({ status: response.status, fileId }, 'No se pudo descargar archivo de Mistral');
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer;
  } catch (err) {
    log.warn({ err, fileId }, 'Error descargando archivo de Mistral');
    return null;
  }
}

export const data = new SlashCommandBuilder()
  .setName('ia')
  .setDescription('Habla con la IA (solo owner)')
  .addStringOption((opt) => opt.setName('texto').setDescription('Tu mensaje').setRequired(true));

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!(await guardInteraction(interaction))) return;

  const text = interaction.options.getString('texto', true).trim();
  if (!text) {
    await interaction.reply({ content: 'Pásame una pregunta, pe.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply();

  const result = await askIA({
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    userId: interaction.user.id,
    userText: text,
  });

  const chunks = splitForDiscord(result.text);
  await interaction.editReply({
    content: chunks[0],
    files: result.attachments.length ? result.attachments : undefined,
  });

  for (let i = 1; i < chunks.length; i += 1) {
    await interaction.followUp({ content: chunks[i] });
  }

  for (const fileId of result.fileIds) {
    const content = await getMistralFileContent(fileId);
    if (content) {
      await interaction.followUp({ files: [{ attachment: content, name: `${fileId}.png` }] });
    }
  }
}
