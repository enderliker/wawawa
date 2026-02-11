import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  Message,
  ChannelType,
  MessageType,
} from 'discord.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createChildLogger } from './util/logger.js';
import { VoiceManager } from './voice/voiceManager.js';
import { VoiceFollower } from './voice/follow.js';
import { TtsQueue } from './tts/queue.js';
import { guardMessage, OWNER_ID } from './guards/ownerOnly.js';
import { VoiceClipRecorder } from './util/voiceClipRecorder.js';
import { DATA_DIR } from './util/settings.js';
import * as sayCommand from './commands/say.js';
import * as stopCommand from './commands/stop.js';
import * as textCommand from './commands/text.js';
import * as mode247Command from './commands/247.js';
import * as recordCommand from './commands/record.js';
import * as recordingCommand from './commands/recording.js';
import * as iaCommand from './commands/ia.js';

const logger = createChildLogger('Bot');
const IA_STATE_FILE = path.join(DATA_DIR, 'ia_state.json');

export class DiscordBot {
  private client: Client;
  private voiceManager: VoiceManager;
  private voiceFollower: VoiceFollower;
  private ttsQueue: TtsQueue;
  private clipRecorder: VoiceClipRecorder;
  private token: string;
  
  // Track voice-text channel relationships per guild
  // Maps voice channel ID to its associated text channel ID
  private voiceTextChannels = new Map<string, Set<string>>();
  
  // Debounce for message reading (prevent spam)
  private messageDebounce = new Map<string, NodeJS.Timeout>();
  private readonly messageDebounceDelay = 300; // 300ms

  // Owner-triggered IA prompt flow (per-channel)
  private iaAwaitReply = new Map<string, { botMessageId: string; expiresAt: number }>();
  private readonly iaAwaitTtlMs = 5 * 60 * 1000; // 5 min

  private clipAttachTimer: NodeJS.Timeout | null = null;

  constructor(token: string) {
    this.token = token;

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    this.voiceManager = new VoiceManager();
    this.voiceFollower = new VoiceFollower(this.client, this.voiceManager);
    this.ttsQueue = new TtsQueue();
    this.clipRecorder = new VoiceClipRecorder({ windowMs: 12_000 });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.client.once('ready', () => {
      void this.onReady();
    });

    this.client.on('interactionCreate', async (interaction) => {
      if (!interaction.isChatInputCommand()) return;

      await this.handleCommand(interaction);
    });

    this.client.on('messageCreate', async (message) => {
      await this.handleMessage(message);
    });

    this.client.on('voiceStateUpdate', (oldState, newState) => {
      this.trackVoiceTextChannel(oldState.channelId, newState.channelId, newState.guild.id);
    });
  }

  private async onReady(): Promise<void> {
    logger.info(
      { tag: this.client.user?.tag, id: this.client.user?.id },
      'Bot is ready'
    );
  
    // On startup: if the owner is already in a voice channel, join immediately
    await this.joinOwnerIfAlreadyInVoice();

    // Start lightweight loop to attach clip recorder to active voice connections.
    // (Covers reconnects, moves, voice restarts without needing to thread hooks through every path.)
    this.startClipRecorderAttachLoop();

    await this.loadIaAwaitState();

    await iaCommand.initializeIA();
}

  private async loadIaAwaitState(): Promise<void> {
    try {
      const raw = await fs.readFile(IA_STATE_FILE, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, { botMessageId: string; expiresAt: number }>;
      const now = Date.now();
      for (const [channelId, state] of Object.entries(parsed || {})) {
        if (state?.botMessageId && typeof state.expiresAt === 'number' && state.expiresAt > now) {
          this.iaAwaitReply.set(channelId, state);
        }
      }
    } catch {
      // no-op
    }
  }

  private async saveIaAwaitState(): Promise<void> {
    try {
      await fs.mkdir(DATA_DIR, { recursive: true });
      const payload = Object.fromEntries(this.iaAwaitReply.entries());
      const tmp = `${IA_STATE_FILE}.tmp`;
      await fs.writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
      await fs.rename(tmp, IA_STATE_FILE);
    } catch (err) {
      logger.warn({ err }, 'Failed to persist IA reply-await state');
    }
  }

  private startClipRecorderAttachLoop(): void {
    if (this.clipAttachTimer) return;
    this.clipAttachTimer = setInterval(() => {
      try {
        for (const guild of this.client.guilds.cache.values()) {
          const conn = this.voiceManager.getConnection(guild.id);
          if (conn) this.clipRecorder.attach(guild.id, conn);
        }
      } catch {
        // ignore
      }
    }, 1000);
  }

  
  /**
   * If the owner is already connected to a voice channel when the bot starts,
   * join that channel (first match across guilds).
   */
  private async joinOwnerIfAlreadyInVoice(): Promise<void> {
    try {
      for (const guild of this.client.guilds.cache.values()) {
        // Fetch member if not cached
        const member =
          guild.members.cache.get(OWNER_ID) ??
          (await guild.members.fetch(OWNER_ID).catch(() => null));
        const channel = member?.voice?.channel;
        if (channel && channel.type === ChannelType.GuildVoice) {
          logger.info(
        { guildId: guild.id, channelId: channel.id, channelName: channel.name },
            'Owner already in voice on startup, joining'
          );
          await this.voiceManager.join(channel);
          return;
        }
      }
    } catch (err) {
      logger.warn({ err }, 'Failed startup owner voice check');
    }
  }

  /**
   * Track voice-text channel relationships
   * When owner joins a voice channel, track its associated text channel
   */
  private trackVoiceTextChannel(
    _oldChannelId: string | null,
    newChannelId: string | null,
    guildId: string
  ): void {
    if (!newChannelId) return;

    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return;

    const voiceChannel = guild.channels.cache.get(newChannelId);
    if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) return;

    // Find associated text channel
    // In Discord, voice channels can have an associated text channel
    // We need to identify it based on the channel structure
    
    // Method 1: Check if there's a text channel with same parent and similar name
    const parent = voiceChannel.parent;
    if (parent) {
      const textChannels = parent.children.cache.filter(
        (ch) => ch.type === ChannelType.GuildText
      );

      for (const [channelId] of textChannels) {
        // Store this mapping
        if (!this.voiceTextChannels.has(newChannelId)) {
          this.voiceTextChannels.set(newChannelId, new Set());
        }
        this.voiceTextChannels.get(newChannelId)!.add(channelId);
      logger.debug(
          { voiceChannelId: newChannelId, textChannelId: channelId },
          'Tracked voice-text channel relationship'
        );
      }
    }
  }

  /**
   * Check if a message is from a voice chat text channel
   * FAIL-CLOSED: Only read if we're CERTAIN it's a voice chat channel
   */
  private isVoiceChatMessage(message: Message): boolean {
    // Must be in a guild
    if (!message.guild) return false;

    // Check channel type
    // Discord supports "voice channel chat" where the channel itself (GuildVoice) can receive messages.
    
    // Method 1: Check if this is a text channel associated with voice
    const currentVoiceChannel = this.voiceManager.getChannelId(message.guild.id);
    if (!currentVoiceChannel) {
      // Bot not in voice, can't be voice chat
      return false;
    }

    // Method 0 (most reliable): messages sent directly in the *voice channel chat*
    // In this case, message.channelId === voiceChannelId and channel type is GuildVoice.
    if (message.channelId === currentVoiceChannel && message.channel.type === ChannelType.GuildVoice) {
      return true;
    }

    // Check if this text channel is associated with the voice channel
    const associatedTextChannels = this.voiceTextChannels.get(currentVoiceChannel);
    if (associatedTextChannels && associatedTextChannels.has(message.channel.id)) {
      return true;
    }

    // Method 2: Check channel parent relationship
    const voiceChannel = message.guild.channels.cache.get(currentVoiceChannel);
    if (voiceChannel && 'parentId' in message.channel && 'parentId' in voiceChannel && message.channel.parentId === voiceChannel.parentId) {
      // Same category, likely associated
      // But still fail-closed: only if it's the only text channel in category
      const textChannelsInCategory = message.guild.channels.cache.filter(
        (ch) =>
          ch.type === ChannelType.GuildText &&
          'parentId' in ch &&
          ch.parentId === voiceChannel.parentId
      );
      
      if (textChannelsInCategory.size === 1 && textChannelsInCategory.has(message.channel.id)) {
        return true;
      }
    }

    // FAIL-CLOSED: If uncertain, don't read
    return false;
  }

  private async safeSendTyping(channel: unknown): Promise<void> {
    const ch = channel as { sendTyping?: () => Promise<unknown> };
    if (typeof ch.sendTyping === 'function') {
      await ch.sendTyping();
    }
  }

  private async safeSendToChannel(channel: unknown, payload: { files: Array<{ attachment: Buffer | import('discord.js').AttachmentBuilder; name?: string }> }): Promise<void> {
    const ch = channel as { send?: (input: unknown) => Promise<unknown> };
    if (typeof ch.send === 'function') {
      await ch.send(payload);
    }
  }

  /**
 * Ignore non-text payloads and links for auto-read.
 * - attachments that are images (or typical image extensions)
 * - any message containing a URL
 * - non-default message types (system/pins/etc)
 * - empty/whitespace-only content
 */
  private shouldIgnoreAutoReadMessage(message: Message): boolean {
  // Non-default message types (system, pins, etc.)
  if (message.type !== MessageType.Default) return true;
  
  const content = (message.content ?? '').trim();
  if (!content) return true;
  
  // Ignore links (any URL anywhere in the message)
  const urlRegex = /(https?:\/\/|www\.)\S+/i;
  if (urlRegex.test(content)) return true;
  
  // Ignore image attachments (and common image extensions)
  if (message.attachments?.size) {
    const imageExt = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
    for (const att of message.attachments.values()) {
      const ct = att.contentType ?? '';
      if (ct.startsWith('image/')) return true;
      if (imageExt.test(att.name ?? '')) return true;
    }
  }
  
  return false;
  }

  /**
   * Handle incoming messages for auto-reading
   */
  private async handleMessage(message: Message): Promise<void> {
    // Ignore bot messages
    if (message.author.bot) return;
  
    // Owner-only guard
    if (!guardMessage(message)) return;
  
    // Must be in a guild
    if (!message.guild) return;

    // ============================================================
    // IA trigger (owner-only)
    // - "oe bot: <pregunta>"
    // - "oye bot: <pregunta>"
    // - "oe bot" / "oye bot" (sin pregunta) -> te pide que respondas a su mensaje
    // - Si respondes (Reply) al mensaje del bot, toma tu reply como prompt.
    // ============================================================
    try {
      const channelId = message.channel.id;
      const now = Date.now();

      // Reply-to-bot flow
      const awaiting = this.iaAwaitReply.get(channelId);
      if (awaiting && now <= awaiting.expiresAt) {
        if (message.reference?.messageId && message.reference.messageId === awaiting.botMessageId) {
          const prompt = message.content?.trim();
          if (prompt) {
            this.iaAwaitReply.delete(channelId);
            await this.saveIaAwaitState();
            await this.safeSendTyping(message.channel);
            const out = await iaCommand.askIA({
              guildId: message.guildId ?? null,
              channelId: message.channel.id,
              userId: message.author.id,
              userText: prompt,
            });
            const parts = iaCommand.splitForDiscord(out.text || '(respuesta vacía)');
            for (const p of parts) {
              await message.reply(p);
            }
            for (const attachment of out.attachments) {
              await this.safeSendToChannel(message.channel, { files: [{ attachment }] });
            }

            for (const fileId of out.fileIds) {
              // Download and attach image files (best effort)
              try {
                const buf = await iaCommand.getMistralFileContent(fileId);
                if (buf) {
                  await this.safeSendToChannel(message.channel, { files: [{ attachment: buf, name: `${fileId}.png` }] });
                }
              } catch {
                // ignore download failures
              }
            }
            return; // do not auto-read this message
          }
        }
      } else if (awaiting && now > awaiting.expiresAt) {
        this.iaAwaitReply.delete(channelId);
        await this.saveIaAwaitState();
      }

      const raw = (message.content || '').trim();
      const m = raw.match(/^o(?:e|ye)\s+bot\s*:??\s*(.*)$/i);
      if (m) {
        const prompt = (m[1] || '').trim();
        if (!prompt) {
          const botMsg = await message.reply('¿Qué pasó? Respóndeme a este mensaje con tu pregunta.');
          this.iaAwaitReply.set(channelId, { botMessageId: botMsg.id, expiresAt: now + this.iaAwaitTtlMs });
          await this.saveIaAwaitState();
          return;
        }

        await this.safeSendTyping(message.channel);
        const out = await iaCommand.askIA({
          guildId: message.guildId ?? null,
          channelId: message.channel.id,
          userId: message.author.id,
          userText: prompt,
        });
        const parts = iaCommand.splitForDiscord(out.text || '(respuesta vacía)');
        for (const p of parts) {
          await message.reply(p);
        }

        for (const attachment of out.attachments) {
          await this.safeSendToChannel(message.channel, { files: [{ attachment }] });
        }

        for (const fileId of out.fileIds) {
          try {
            const buf = await iaCommand.getMistralFileContent(fileId);
            if (buf) {
              await this.safeSendToChannel(message.channel, { files: [{ attachment: buf, name: `${fileId}.png` }] });
            }
          } catch {
            // ignore
          }
        }
        return; // do not auto-read the trigger message
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to handle IA trigger message');
    }
  
    // Check if owner is in voice in this guild
    if (!this.voiceManager.isInVoice(message.guild.id)) {
      return;
    }
  
    // Check if message starts with . or , (ignore prefixes)
    if (message.content.startsWith('.') || message.content.startsWith(',')) {
      logger.debug(
        { guildId: message.guild.id, content: message.content },
        'Ignoring message with prefix'
      );
      return;
    }
  
  
  // Ignore images/links/non-text messages for auto-read
    if (this.shouldIgnoreAutoReadMessage(message)) {
      logger.debug(
        { guildId: message.guild.id, channelId: message.channel.id },
        'Ignoring non-text/link/image message'
      );
      return;
  }
  
    // Check if this is a voice chat message
    if (!this.isVoiceChatMessage(message)) {
      logger.debug(
        { guildId: message.guild.id, channelId: message.channel.id },
        'Message not from voice chat channel'
      );
      return;
    }
  
    // Debounce to avoid spam
    const debounceKey = `${message.guild.id}-${message.author.id}`;
    const existingTimer = this.messageDebounce.get(debounceKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
  
    const timer = setTimeout(async () => {
      await this.readMessage(message);
      this.messageDebounce.delete(debounceKey);
    }, this.messageDebounceDelay);
  
    this.messageDebounce.set(debounceKey, timer);
  }
  
  /**
   * Read a message via TTS
   */
  private async readMessage(message: Message): Promise<void> {
    try {
      const connection = this.voiceManager.getConnection(message.guild!.id);
      if (!connection) {
        logger.warn({ guildId: message.guild!.id }, 'No voice connection for message reading');
        return;
      }
  
      logger.info(
        {
          guildId: message.guild!.id,
          channelId: message.channel.id,
          messageId: message.id,
          content: message.content,
        },
        'Auto-reading message from voice chat'
      );
  
      await this.ttsQueue.enqueue(message.guild!.id, message.content, connection);
      
    } catch (err) {
      logger.error({ err, messageId: message.id }, 'Error reading message');
    }
  }
  
  /**
   * Handle slash command interactions
   */
  private async handleCommand(interaction: any): Promise<void> {
    const { commandName } = interaction;
    const normalizedCommand = String(commandName).toLowerCase().replace(/[^a-z0-9]/g, '');
  
    try {
      switch (normalizedCommand) {
        case 'say':
          await sayCommand.execute(interaction, this.voiceManager, this.ttsQueue);
          break;
        case 'text':
          await textCommand.execute(interaction);
          break;
        case 'stop':
          await stopCommand.execute(interaction, this.ttsQueue);
          break;
        case '247':
          await mode247Command.execute(interaction);
          break;
        case 'record':
          await recordCommand.execute(interaction, this.voiceManager, this.clipRecorder);
          break;
        case 'recording':
          await recordingCommand.execute(interaction);
          break;
        case 'ia':
          await iaCommand.execute(interaction);
          break;
        default:
          logger.warn({ commandName }, 'Unknown command');
      }
    } catch (err) {
      logger.error({ err, commandName }, 'Error handling command');
    }
  }
  
  /**
   * Register slash commands with Discord
   */
  async registerCommands(): Promise<void> {
    const modules: Array<{ name: string; module: any }> = [
      { name: 'say', module: sayCommand },
      { name: 'text', module: textCommand },
      { name: 'stop', module: stopCommand },
      { name: '247', module: mode247Command },
      { name: 'record', module: recordCommand },
      { name: 'recording', module: recordingCommand },
      { name: 'ia', module: iaCommand },
    ];

    const commands: any[] = [];
    for (const entry of modules) {
      const data = entry.module?.data;
      const execute = entry.module?.execute;
      if (!data || typeof data.toJSON !== 'function' || typeof execute !== 'function') {
        logger.warn({ module: entry.name }, 'Skipping malformed command module');
        continue;
      }

      try {
        commands.push(data.toJSON());
      } catch (err) {
        logger.warn({ err, module: entry.name }, 'Skipping command with invalid data.toJSON()');
      }
    }
  
    const rest = new REST({ version: '10' }).setToken(this.token);
  
    try {
      logger.info({ count: commands.length }, 'Registering slash commands');
  
      await rest.put(
        Routes.applicationCommands(this.client.user!.id),
        { body: commands }
      );
  
      logger.info('Successfully registered slash commands');
    } catch (err) {
      logger.error({ err }, 'Failed to register slash commands');
      throw err;
    }
  }
  
  /**
   * Start the bot
   */
  async start(): Promise<void> {
    logger.info('Starting bot...');
  
    await this.client.login(this.token);
  
    // Wait for client to be ready
    await new Promise<void>((resolve) => {
      if (this.client.isReady()) {
        resolve();
      } else {
        this.client.once('ready', () => resolve());
      }
    });
  
    // Register commands
    await this.registerCommands();
  
    logger.info('Bot started successfully');
  }
  
  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down bot...');
  
    // Clear debounce timers
    for (const timer of this.messageDebounce.values()) {
      clearTimeout(timer);
    }
    this.messageDebounce.clear();
  
    // Cleanup voice resources
    this.voiceFollower.cleanup();
    this.voiceManager.cleanupAll();
  
    // Cleanup TTS queues
    for (const guildId of this.client.guilds.cache.keys()) {
      this.ttsQueue.cleanup(guildId);
    }
  
    // Destroy client
    this.client.destroy();
  
    logger.info('Bot shutdown complete');
  }
  }
