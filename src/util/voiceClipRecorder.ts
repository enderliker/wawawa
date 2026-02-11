import { EndBehaviorType, VoiceConnection } from '@discordjs/voice';
import { createChildLogger } from './logger.js';
import { Readable } from 'node:stream';

const logger = createChildLogger('VoiceClipRecorder');

type Packet = { t: number; b: Buffer };

/**
 * Records raw Opus packets received from Discord voice receiver.
 *
 * Implementation notes:
 * - Stores packets per user in a rolling time window.
 * - Keeps only last `windowMs` to avoid unbounded memory.
 * - Resets on restart.
 */
export class VoiceClipRecorder {
  private readonly windowMs: number;
  private readonly maxUsersPerGuild: number;
  private readonly guildUserPackets = new Map<string, Map<string, Packet[]>>();
  private readonly attached = new Map<string, VoiceConnection>();
  private readonly subscriptions = new Map<string, Map<string, any>>();

  constructor(opts?: { windowMs?: number; maxUsersPerGuild?: number }) {
    this.windowMs = opts?.windowMs ?? 12_000; // keep a bit more than 10s
    this.maxUsersPerGuild = opts?.maxUsersPerGuild ?? 24;
  }

  /**
   * Attach to a guild's active voice connection.
   * Safe to call repeatedly.
   */
  attach(guildId: string, connection: VoiceConnection): void {
    const existing = this.attached.get(guildId);
    if (existing === connection) return;

    // If connection changed, drop previous listeners/data (defensive)
    this.detach(guildId);
    this.attached.set(guildId, connection);

    const receiver = connection.receiver;

    // Per-guild active subscriptions to avoid re-subscribing on every speaking start.
    if (!this.subscriptions.has(guildId)) this.subscriptions.set(guildId, new Map());
    const subs = this.subscriptions.get(guildId)!;

    const ensureSubscribed = (userId: string) => {
      try {
        // Cap how many users we track to prevent abuse.
        const users = this.getGuildMap(guildId);
        if (!users.has(userId) && users.size >= this.maxUsersPerGuild) return;

        if (subs.has(userId)) return; // already subscribed

        const opusStream = receiver.subscribe(userId, {
          end: { behavior: EndBehaviorType.AfterSilence, duration: 250 },
        });

        // Avoid MaxListeners warnings on AudioReceiveStream
        try {
          opusStream.setMaxListeners(0);
        } catch {}

        const onData = (chunk: Buffer) => {
          if (!Buffer.isBuffer(chunk)) return;
          this.pushPacket(guildId, userId, chunk);
        };
        const onError = (err: unknown) => {
          logger.debug({ guildId, userId, err }, 'receiver opus stream error');
        };
        const onEnd = () => {
          // cleanup subscription entry when the stream finishes
          subs.delete(userId);
          try {
            opusStream.removeListener('data', onData);
            opusStream.removeListener('error', onError as any);
          } catch {}
        };

        opusStream.on('data', onData);
        opusStream.on('error', onError as any);
        opusStream.on('end', onEnd);
        opusStream.on('close', onEnd);

        subs.set(userId, opusStream);
      } catch (err) {
        logger.debug({ guildId, userId, err }, 'failed to subscribe receiver stream');
      }
    };

    receiver.speaking.on('start', ensureSubscribed);

    // Keep references for detach
    (connection as any).__clipRecorderOnStart = ensureSubscribed;

    logger.info({ guildId }, 'Attached voice clip recorder');
  }

  detach(guildId: string): void {
    const prev = this.attached.get(guildId);
    if (!prev) return;
    try {
      const receiver = prev.receiver;
      const onStart = (prev as any).__clipRecorderOnStart;
      if (onStart) receiver.speaking.off('start', onStart);
    } catch {}
    this.attached.delete(guildId);
    // Best-effort cleanup of any active subscriptions to avoid leaking listeners
    const subs = this.subscriptions.get(guildId);
    if (subs) {
      for (const s of subs.values()) {
        try { s.destroy?.(); } catch {}
      }
      subs.clear();
    }
    // Keep packets (optional). We'll keep them so quick reconnect doesn't nuke clip.
  }

  /**
   * Get last `ms` of packets for a given user.
   */
  getRecentPackets(guildId: string, userId: string, ms: number): Buffer[] {
    const arr = this.guildUserPackets.get(guildId)?.get(userId);
    if (!arr || arr.length === 0) return [];
    const cutoff = Date.now() - ms;
    // packets are in order
    const startIdx = arr.findIndex((p) => p.t >= cutoff);
    if (startIdx === -1) return [];
    return arr.slice(startIdx).map((p) => p.b);
  }

  /**
   * Create a Readable stream from recent packets (object mode OFF).
   */
  getRecentPacketStream(guildId: string, userId: string, ms: number): Readable {
    const bufs = this.getRecentPackets(guildId, userId, ms);
    return Readable.from(bufs, { objectMode: false });
  }

  private getGuildMap(guildId: string): Map<string, Packet[]> {
    if (!this.guildUserPackets.has(guildId)) {
      this.guildUserPackets.set(guildId, new Map());
    }
    return this.guildUserPackets.get(guildId)!;
  }

  private pushPacket(guildId: string, userId: string, buf: Buffer): void {
    const users = this.getGuildMap(guildId);
    if (!users.has(userId)) users.set(userId, []);
    const arr = users.get(userId)!;

    const now = Date.now();
    arr.push({ t: now, b: buf });

    // Trim old packets
    const cutoff = now - this.windowMs;
    while (arr.length && arr[0].t < cutoff) arr.shift();
  }
}
