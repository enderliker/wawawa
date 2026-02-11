import {
  joinVoiceChannel,
  VoiceConnection,
  VoiceConnectionStatus,
  entersState,
} from '@discordjs/voice';
import { VoiceBasedChannel } from 'discord.js';
import { createChildLogger } from '../util/logger.js';

const logger = createChildLogger('VoiceManager');

// Voice connection states
export enum VoiceState {
  Idle = 'Idle',
  Connecting = 'Connecting',
  Ready = 'Ready',
  Moving = 'Moving',
  Disconnecting = 'Disconnecting',
  Backoff = 'Backoff',
}

interface GuildVoiceState {
  state: VoiceState;
  connection: VoiceConnection | null;
  channelId: string | null;
  retries: number;
  lastError: Error | null;
  operationLock: Promise<void> | null;
}

export class VoiceManager {
  private guildStates = new Map<string, GuildVoiceState>();

  private readonly joinTimeout = parseInt(process.env.VOICE_JOIN_TIMEOUT || '10000', 10);
  private readonly readyTimeout = parseInt(process.env.VOICE_READY_TIMEOUT || '20000', 10);
  private readonly maxRetries = parseInt(process.env.VOICE_MAX_RETRIES || '3', 10);
  private readonly backoffBase = parseInt(process.env.VOICE_BACKOFF_BASE || '1000', 10);
  private readonly backoffMax = parseInt(process.env.VOICE_BACKOFF_MAX || '10000', 10);

  constructor() {
    logger.info(
      {
        joinTimeout: this.joinTimeout,
        readyTimeout: this.readyTimeout,
        maxRetries: this.maxRetries,
      },
      'Voice manager initialized'
    );
  }

  private getOrCreateState(guildId: string): GuildVoiceState {
    if (!this.guildStates.has(guildId)) {
      this.guildStates.set(guildId, {
        state: VoiceState.Idle,
        connection: null,
        channelId: null,
        retries: 0,
        lastError: null,
        operationLock: null,
      });
    }
    return this.guildStates.get(guildId)!;
  }

  /**
   * Acquire operation lock for a guild (prevents race conditions)
   */
  private async acquireLock<T>(guildId: string, operation: () => Promise<T>): Promise<T> {
    const state = this.getOrCreateState(guildId);

    // Wait for existing operation to complete
    if (state.operationLock) {
      logger.debug({ guildId }, 'Waiting for existing operation to complete');
      await state.operationLock;
    }

    // Create new lock
    let resolveLock: () => void;
    state.operationLock = new Promise((resolve) => {
      resolveLock = resolve;
    });

    try {
      return await operation();
    } finally {
      resolveLock!();
      state.operationLock = null;
    }
  }

  /**
   * Calculate backoff delay with jitter
   */
  private calculateBackoff(retries: number): number {
    const exponential = Math.min(this.backoffBase * Math.pow(2, retries), this.backoffMax);
    const jitter = Math.random() * 0.3 * exponential;
    return exponential + jitter;
  }

  /**
   * Low-level join attempt that MUST be called only while holding the guild lock.
   * (Avoids self-deadlocks when join() is called from move() or retries.)
   */
  private async joinUnlockedOnce(channel: VoiceBasedChannel, state: GuildVoiceState): Promise<VoiceConnection> {
    const guildId = channel.guild.id;

    state.state = VoiceState.Connecting;

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator as any,
      selfDeaf: false,
      selfMute: false,
    });

    // Setup connection event handlers
    this.setupConnectionHandlers(connection, guildId);

    // Wait for connection to be ready
    await Promise.race([
      entersState(connection, VoiceConnectionStatus.Ready, this.readyTimeout),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Connection ready timeout')), this.readyTimeout)
      ),
    ]);

    state.connection = connection;
    state.channelId = channel.id;
    state.state = VoiceState.Ready;
    state.retries = 0;
    state.lastError = null;

    logger.info({ guildId, channelId: channel.id }, 'Successfully joined voice channel');
    return connection;
  }

  /**
   * Join with retry/backoff, while holding the guild lock.
   */
  private async joinUnlockedWithRetries(channel: VoiceBasedChannel, state: GuildVoiceState): Promise<VoiceConnection> {
    const guildId = channel.guild.id;

    for (;;) {
      logger.info(
        { guildId, channelId: channel.id, currentState: state.state },
        'Joining voice channel'
      );

      try {
        return await this.joinUnlockedOnce(channel, state);
      } catch (err) {
        state.lastError = err as Error;
        logger.error({ err, guildId, channelId: channel.id }, 'Failed to join voice channel');

        // Cleanup any half-open connection (defensive)
        try {
          state.connection?.destroy();
        } catch {}
        state.connection = null;
        state.channelId = null;

        if (state.retries < this.maxRetries) {
          state.retries++;
          state.state = VoiceState.Backoff;

          const backoff = this.calculateBackoff(state.retries);
          logger.warn({ guildId, retries: state.retries, backoff }, 'Retrying join after backoff');
          await new Promise((resolve) => setTimeout(resolve, backoff));
          continue;
        }

        state.retries = 0;
        state.state = VoiceState.Idle;
        throw err;
      }
    }
  }

  /**
   * Join a voice channel
   */
  async join(channel: VoiceBasedChannel): Promise<VoiceConnection> {
    const guildId = channel.guild.id;

    return this.acquireLock(guildId, async () => {
      const state = this.getOrCreateState(guildId);
      return this.joinUnlockedWithRetries(channel, state);
    });
  }

  /**
   * Move to a different voice channel
   */
  async move(channel: VoiceBasedChannel): Promise<VoiceConnection> {
    const guildId = channel.guild.id;

    return this.acquireLock(guildId, async () => {
      const state = this.getOrCreateState(guildId);

      logger.info(
        { guildId, fromChannel: state.channelId, toChannel: channel.id },
        'Moving to different voice channel'
      );

      state.state = VoiceState.Moving;

      // If we have an existing connection, destroy it cleanly
      if (state.connection) {
        try {
          state.connection.destroy();
        } catch (err) {
          logger.error({ err, guildId }, 'Error destroying connection before move');
        } finally {
          state.connection = null;
          state.channelId = null;
        }
      }

      // Join new channel (NO nested lock)
      return this.joinUnlockedWithRetries(channel, state);
    });
  }

  /**
   * Leave voice channel
   */
  async leave(guildId: string): Promise<void> {
    return this.acquireLock(guildId, async () => {
      const state = this.guildStates.get(guildId);

      if (!state || !state.connection) {
        logger.debug({ guildId }, 'No voice connection to leave');
        return;
      }

      logger.info({ guildId, channelId: state.channelId }, 'Leaving voice channel');

      try {
        state.state = VoiceState.Disconnecting;
        state.connection.destroy();
      } catch (err) {
        logger.error({ err, guildId }, 'Error destroying voice connection');
      } finally {
        state.connection = null;
        state.channelId = null;
        state.state = VoiceState.Idle;
        state.retries = 0;
      }
    });
  }

  /**
   * Get current voice connection for a guild
   */
  getConnection(guildId: string): VoiceConnection | null {
    const state = this.guildStates.get(guildId);
    return state?.connection || null;
  }

  /**
   * Get current channel ID for a guild
   */
  getChannelId(guildId: string): string | null {
    const state = this.guildStates.get(guildId);
    return state?.channelId || null;
  }

  /**
   * Check if bot is in a voice channel in a guild
   */
  isInVoice(guildId: string): boolean {
    const state = this.guildStates.get(guildId);
    return state?.state === VoiceState.Ready && state.connection !== null;
  }

  /**
   * Setup connection event handlers
   */
  private setupConnectionHandlers(connection: VoiceConnection, guildId: string): void {
    connection.on('error', (error) => {
      logger.error({ error, guildId }, 'Voice connection error');
    });

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      logger.warn({ guildId }, 'Voice connection disconnected');

      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5000),
        ]);
        // Seems to be reconnecting to a new channel - ignore disconnect
        logger.info({ guildId }, 'Voice connection recovering');
      } catch {
        // Disconnect appears to be permanent
        logger.warn({ guildId }, 'Voice connection permanently disconnected');
        connection.destroy();

        const state = this.guildStates.get(guildId);
        if (state) {
          state.connection = null;
          state.channelId = null;
          state.state = VoiceState.Idle;
          state.retries = 0;
        }
      }
    });

    connection.on(VoiceConnectionStatus.Destroyed, () => {
      logger.info({ guildId }, 'Voice connection destroyed');

      const state = this.guildStates.get(guildId);
      if (state) {
        state.connection = null;
        state.channelId = null;
        state.state = VoiceState.Idle;
        state.retries = 0;
      }
    });
  }

  /**
   * Cleanup all resources for a guild
   */
  cleanup(guildId: string): void {
    logger.info({ guildId }, 'Cleaning up voice manager');

    const state = this.guildStates.get(guildId);
    if (state?.connection) {
      try {
        state.connection.destroy();
      } catch (err) {
        logger.error({ err, guildId }, 'Error destroying connection during cleanup');
      }
    }

    this.guildStates.delete(guildId);
  }

  /**
   * Cleanup all resources (shutdown)
   */
  cleanupAll(): void {
    logger.info('Cleaning up all voice connections');

    for (const [guildId, state] of this.guildStates.entries()) {
      if (state.connection) {
        try {
          state.connection.destroy();
        } catch (err) {
          logger.error({ err, guildId }, 'Error destroying connection during cleanup');
        }
      }
    }

    this.guildStates.clear();
  }
}
