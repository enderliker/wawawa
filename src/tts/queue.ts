import {
  createAudioPlayer,
  createAudioResource,
  AudioPlayer,
  AudioPlayerStatus,
  VoiceConnection,
  PlayerSubscription,
  entersState,
  demuxProbe,
} from '@discordjs/voice';
import { Readable, PassThrough } from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';
import { AttachmentBuilder } from 'discord.js';
import { createChildLogger } from '../util/logger.js';
import type { TtsProvider } from './providers/TtsProvider.js';
import { GttsProvider } from './providers/GttsProvider.js';
import { GoogleCloudProvider } from './providers/GoogleCloudProvider.js';
import { getTtsConfig } from './providers/TtsProvider.js';

const logger = createChildLogger('TtsQueue');

type QueueItem =
  | { kind: 'tts'; text: string; requestId: string }
  | { kind: 'sound'; soundKey: string; filePath: string; requestId: string };

type SubMeta = { sub: PlayerSubscription; connection: VoiceConnection };

export class TtsQueue {
  private queues = new Map<string, QueueItem[]>();
  private players = new Map<string, AudioPlayer>();
  private subscriptions = new Map<string, SubMeta>();
  private processing = new Map<string, boolean>();
  private currentConnections = new Map<string, VoiceConnection>();

  private provider: TtsProvider;
  private config = getTtsConfig();

  // Keep a small rolling window of the most recent audio items (for /record)
  // Stored as raw encoded audio buffers (mp3/ogg/wav/opus) to avoid demux/encode complexity.
  private recentAudio = new Map<string, Array<{ name: string; buffer: Buffer }>>();
  private readonly recentAudioMaxItems = 10;

  // Anti-spam: track last request time per guild
  private lastRequestTime = new Map<string, number>();
  private readonly minRequestInterval = 200; // ms

  // Sound triggers (prefix tokens)
  private readonly soundsDir = path.resolve(process.cwd(), 'sounds');

  constructor() {
    this.provider = this.createProvider();
    logger.info({ provider: this.config.provider, soundsDir: this.soundsDir }, 'TTS queue initialized');
  }

  private createProvider(): TtsProvider {
    const { provider, voiceName, lang } = this.config;

    if (provider === 'google') {
      return new GoogleCloudProvider(voiceName, lang);
    }
    return new GttsProvider(lang);
  }

  /**
   * Ensure the audio player is subscribed to the CURRENT voice connection.
   * This is critical when the bot moves between voice channels (new VoiceConnection instance).
   */
  private ensureSubscribed(guildId: string, connection: VoiceConnection, player: AudioPlayer): void {
    const existing = this.subscriptions.get(guildId);

    // Already subscribed to this exact connection object.
    if (existing && existing.connection === connection) return;

    // Unsubscribe old sub (if any) to prevent stuck routing.
    if (existing) {
      try {
        existing.sub.unsubscribe();
      } catch {}
      this.subscriptions.delete(guildId);
    }

    try {
      const sub = connection.subscribe(player);
      if (sub) {
        this.subscriptions.set(guildId, { sub, connection });
        logger.info(
          { guildId, channelId: (connection as any).joinConfig?.channelId },
          'Subscribed audio player to voice connection'
        );
      } else {
        logger.warn({ guildId }, 'Failed to subscribe audio player to voice connection');
      }
    } catch (err) {
      logger.error({ err, guildId }, 'Error subscribing audio player to voice connection');
    }
  }

  /**
   * Sanitize text for TTS
   * - Remove @everyone, @here, role/user mentions
   * - Limit length
   * - Trim whitespace
   */
  private sanitizeText(text: string): string {
    let sanitized = text
      .replace(/@(everyone|here)/g, '')
      .replace(/<@&\d+>/g, '')
      .replace(/<@!?\d+>/g, '')
      .replace(/<#\d+>/g, '')
      .trim();

    if (sanitized.length > this.config.maxChars) {
      sanitized = sanitized.substring(0, this.config.maxChars);
      logger.debug({ original: text.length, truncated: sanitized.length }, 'Text truncated');
    }

    return sanitized;
  }

  private checkRateLimit(guildId: string): boolean {
    const now = Date.now();
    const last = this.lastRequestTime.get(guildId) || 0;

    if (now - last < this.minRequestInterval) {
      logger.debug({ guildId, timeSinceLast: now - last }, 'Rate limit hit');
      return false;
    }

    this.lastRequestTime.set(guildId, now);
    return true;
  }

  /**
   * Find a sound file for a token (e.g. "hmph" -> sounds/hmph.(wav|mp3|ogg))
   */
  private resolveSoundFile(soundKey: string): string | null {
    const key = soundKey.toLowerCase();
    const candidates = [
      path.join(this.soundsDir, `${key}.wav`),
      path.join(this.soundsDir, `${key}.mp3`),
      path.join(this.soundsDir, `${key}.ogg`),
      path.join(this.soundsDir, `${key}.opus`),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    }
    return null;
  }

  private pushRecentAudio(guildId: string, name: string, buffer: Buffer): void {
    const list = this.recentAudio.get(guildId) ?? [];
    list.push({ name, buffer });
    while (list.length > this.recentAudioMaxItems) list.shift();
    this.recentAudio.set(guildId, list);
  }

  /**
   * Build Discord attachments for the last N audio items.
   * Note: Attachments are sent as-is (mp3/ogg/wav/opus). This matches what the bot actually played.
   */
  getRecentAudioAttachments(guildId: string, limit = 10): AttachmentBuilder[] {
    const list = this.recentAudio.get(guildId) ?? [];
    const slice = list.slice(Math.max(0, list.length - limit));
    return slice.map((item) => new AttachmentBuilder(item.buffer, { name: item.name }));
  }

  /**
   * Split a message into TTS text segments + sound segments.
   * Example: "a hmph ok" -> TTS("a") + SOUND("hmph") + TTS("ok")
   */
  private splitIntoSegments(text: string): Array<{ kind: 'tts'; text: string } | { kind: 'sound'; key: string; filePath: string }> {
    const parts = text.split(/\s+/).filter(Boolean);
    const out: Array<{ kind: 'tts'; text: string } | { kind: 'sound'; key: string; filePath: string }> = [];

    let buffer: string[] = [];

    const flush = () => {
      if (buffer.length) {
        out.push({ kind: 'tts', text: buffer.join(' ') });
        buffer = [];
      }
    };

    for (const raw of parts) {
      // Normalize token for lookup: strip punctuation on edges
      const token = raw.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, '');
      const filePath = token ? this.resolveSoundFile(token) : null;

      if (filePath) {
        flush();
        out.push({ kind: 'sound', key: token, filePath });
      } else {
        buffer.push(raw);
      }
    }

    flush();
    return out;
  }

  /**
   * Enqueue TTS text for a guild
   */
  async enqueue(guildId: string, text: string, connection: VoiceConnection): Promise<void> {
    if (!this.checkRateLimit(guildId)) {
      throw new Error('Rate limit: please wait before sending another TTS request');
    }

    this.currentConnections.set(guildId, connection);

    const sanitized = this.sanitizeText(text);
    if (!sanitized) {
      throw new Error('Text is empty after sanitization');
    }

    logger.info({ guildId, text: sanitized }, 'Enqueuing TTS');

    if (!this.queues.has(guildId)) {
      this.queues.set(guildId, []);
    }

    const queue = this.queues.get(guildId)!;
    const baseRequestId = `${guildId}-${Date.now()}`;

    // Expand into segments (tts + sounds)
    const segments = this.splitIntoSegments(sanitized);

    let segIndex = 0;
    for (const seg of segments) {
      const requestId = `${baseRequestId}-${segIndex++}`;

      if (seg.kind === 'sound') {
        queue.push({ kind: 'sound', soundKey: seg.key, filePath: seg.filePath, requestId });
      } else {
        const segText = this.sanitizeText(seg.text);
        if (segText) queue.push({ kind: 'tts', text: segText, requestId });
      }
    }

    // Get or create audio player
    if (!this.players.has(guildId)) {
      const player = createAudioPlayer();
      this.players.set(guildId, player);
      this.ensureSubscribed(guildId, connection, player);

      // IMPORTANT: never capture stale connection here. Use currentConnections map.
      player.on(AudioPlayerStatus.Idle, () => {
        logger.debug({ guildId }, 'Player idle, processing next in queue');
        void this.processQueue(guildId);
      });

      player.on('error', (error) => {
        logger.error({ error, guildId }, 'Audio player error');
        void this.processQueue(guildId);
      });
    }

    // Re-subscribe on every enqueue (handles channel moves)
    const player = this.players.get(guildId)!;
    this.ensureSubscribed(guildId, connection, player);

    await this.processQueue(guildId);
  }

  private getConnectionOrNull(guildId: string): VoiceConnection | null {
    return this.currentConnections.get(guildId) ?? null;
  }

  /**
   * Build an AudioResource from a buffer/stream with demuxProbe so mp3/ogg/wav works reliably.
   */
  private async resourceFromStream(stream: Readable) {
    // @discordjs/voice demuxProbe() cannot handle objectMode streams.
    if ((stream as any).readableObjectMode) {
      const pt = new PassThrough();
      stream.on('data', (chunk: any) => pt.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      stream.on('end', () => pt.end());
      stream.on('error', (e) => pt.destroy(e));
      stream = pt;
    }
    const probed = await demuxProbe(stream);
    return createAudioResource(probed.stream, { inputType: probed.type });
  }

  private async synthesizeOrLoad(item: QueueItem): Promise<{ stream: Readable; name: string; buffer?: Buffer }> {
    if (item.kind === 'sound') {
      // Read from disk (also keep in history for /record)
      const ext = path.extname(item.filePath) || '.bin';
      const base = `${item.soundKey}${ext}`;
      const buf = fs.readFileSync(item.filePath);
      this.pushRecentAudio(item.requestId.split('-')[0] ?? 'unknown', `sound-${Date.now()}-${base}`, buf);
      const rs = new PassThrough();
      rs.end(buf);
      return { stream: rs, name: base, buffer: buf };
    }

    const audioBuffer = await this.provider.synthesize(item.text);
    // gTTS & Google Cloud are typically MP3.
    const name = `tts-${Date.now()}-${item.requestId}.mp3`;
    this.pushRecentAudio(item.requestId.split('-')[0] ?? 'unknown', name, audioBuffer);

    const pt = new PassThrough();
    pt.end(audioBuffer);
    return { stream: pt, name, buffer: audioBuffer };
  }

  /**
   * Process queue for a guild
   */
  private async processQueue(guildId: string): Promise<void> {
    if (this.processing.get(guildId)) {
      logger.debug({ guildId }, 'Already processing queue');
      return;
    }

    const queue = this.queues.get(guildId);
    if (!queue || queue.length === 0) {
      logger.debug({ guildId }, 'Queue empty');
      return;
    }

    const player = this.players.get(guildId);
    if (!player) {
      logger.error({ guildId }, 'No player for guild');
      return;
    }

    // If player is busy, don't interrupt.
    if (player.state.status !== AudioPlayerStatus.Idle) {
      logger.debug({ guildId, status: player.state.status }, 'Player busy');
      return;
    }

    const connection = this.getConnectionOrNull(guildId);
    if (!connection) {
      logger.warn({ guildId }, 'No current voice connection (dropping queued items)');
      // Fail-safe: clear queue so it doesn't grow forever
      queue.length = 0;
      return;
    }

    // Ensure player is routed to the latest connection (move safety)
    this.ensureSubscribed(guildId, connection, player);

    this.processing.set(guildId, true);

    try {
      const item = queue.shift()!;

      if (item.kind === 'sound') {
        logger.info({ guildId, requestId: item.requestId, soundKey: item.soundKey }, 'Playing sound trigger');
      } else {
        logger.info({ guildId, requestId: item.requestId, text: item.text }, 'Processing TTS');
      }

      const { stream } = await this.synthesizeOrLoad(item);
      const resource = await this.resourceFromStream(stream);

      player.play(resource);

      await entersState(player, AudioPlayerStatus.Playing, 7000);
      logger.debug({ guildId, requestId: item.requestId }, 'Audio playing');
    } catch (err) {
      logger.error({ err, guildId }, 'Failed to process queue item');
      // Continue with next item
    } finally {
      this.processing.set(guildId, false);
      // Immediately attempt next item if any (reduces perceived delay)
      if ((this.queues.get(guildId)?.length ?? 0) > 0) {
        void this.processQueue(guildId);
      }
    }
  }

  stop(guildId: string): void {
    logger.info({ guildId }, 'Stopping TTS queue');

    const queue = this.queues.get(guildId);
    if (queue) queue.length = 0;

    const player = this.players.get(guildId);
    if (player) player.stop();

    this.processing.set(guildId, false);
  }

  cleanup(guildId: string): void {
    logger.info({ guildId }, 'Cleaning up TTS queue');

    this.stop(guildId);

    const sub = this.subscriptions.get(guildId);
    if (sub) {
      try {
        sub.sub.unsubscribe();
      } catch {}
    }

    const player = this.players.get(guildId);
    if (player) {
      player.removeAllListeners();
      player.stop();
    }

    this.queues.delete(guildId);
    this.players.delete(guildId);
    this.subscriptions.delete(guildId);
    this.processing.delete(guildId);
    this.currentConnections.delete(guildId);
    this.lastRequestTime.delete(guildId);
  }
}
