import { Client, VoiceState } from 'discord.js';
import { createChildLogger } from '../util/logger.js';
import { OWNER_ID } from '../guards/ownerOnly.js';
import { VoiceManager } from './voiceManager.js';
import { get247Enabled } from '../util/settings.js';

const logger = createChildLogger('VoiceFollow');

export class VoiceFollower {
  private onVoiceStateUpdate?: (oldState: VoiceState, newState: VoiceState) => void;
  private client: Client;
  private voiceManager: VoiceManager;
  
  // Debouncing: prevent processing rapid successive events
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private readonly debounceDelay = 500; // 500ms debounce

  constructor(client: Client, voiceManager: VoiceManager) {
    this.client = client;
    this.voiceManager = voiceManager;

    this.setupListeners();
    logger.info({ ownerId: OWNER_ID }, 'Voice follower initialized');
  }

  private setupListeners(): void {
    this.onVoiceStateUpdate = (oldState, newState) => {
      this.handleVoiceStateUpdate(oldState, newState);
    };
    this.client.on('voiceStateUpdate', this.onVoiceStateUpdate);
  }

  /**
   * Handle voice state updates with debouncing
   */
  private handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): void {
    const userId = newState.id;

    // Only follow the owner
    if (userId !== OWNER_ID) {
      return;
    }

    const guildId = newState.guild.id;

    // Debounce: cancel previous timer and set new one
    const existingTimer = this.debounceTimers.get(guildId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.processVoiceStateUpdate(oldState, newState);
      this.debounceTimers.delete(guildId);
    }, this.debounceDelay);

    this.debounceTimers.set(guildId, timer);
  }

  /**
   * Process voice state update (after debounce)
   */
  private async processVoiceStateUpdate(
    oldState: VoiceState,
    newState: VoiceState
  ): Promise<void> {
    const guildId = newState.guild.id;
    const oldChannelId = oldState.channelId;
    const newChannelId = newState.channelId;

    logger.debug(
      { guildId, oldChannelId, newChannelId, userId: OWNER_ID },
      'Processing owner voice state update'
    );

    try {
      // Case 1: Owner joined a voice channel
      if (!oldChannelId && newChannelId) {
        await this.handleOwnerJoin(newState);
      }
      // Case 2: Owner moved to a different voice channel
      else if (oldChannelId && newChannelId && oldChannelId !== newChannelId) {
        await this.handleOwnerMove(newState);
      }
      // Case 3: Owner left voice channel
      else if (oldChannelId && !newChannelId) {
        await this.handleOwnerLeave(guildId);
      }
      // Case 4: Other updates (mute, deafen, etc.) - ignore
      else {
        logger.debug({ guildId }, 'Owner voice state update (no channel change)');
      }
    } catch (err) {
      logger.error({ err, guildId }, 'Error processing owner voice state update');
    }
  }

  /**
   * Handle owner joining a voice channel
   */
  private async handleOwnerJoin(newState: VoiceState): Promise<void> {
    const channel = newState.channel;
    if (!channel) {
      return;
    }

    const guildId = newState.guild.id;

    logger.info(
      { guildId, channelId: channel.id, channelName: channel.name },
      'Owner joined voice channel, following'
    );

    try {
      await this.voiceManager.join(channel);
    } catch (err) {
      logger.error({ err, guildId }, 'Failed to follow owner to voice channel');
    }
  }

  /**
   * Handle owner moving to a different voice channel
   */
  private async handleOwnerMove(newState: VoiceState): Promise<void> {
    const channel = newState.channel;
    if (!channel) {
      return;
    }

    const guildId = newState.guild.id;

    logger.info(
      { guildId, channelId: channel.id, channelName: channel.name },
      'Owner moved to different voice channel, following'
    );

    try {
      await this.voiceManager.move(channel);
    } catch (err) {
      logger.error({ err, guildId }, 'Failed to follow owner to new voice channel');
    }
  }

  /**
   * Handle owner leaving voice channel
   */
  private async handleOwnerLeave(guildId: string): Promise<void> {
    if (get247Enabled(guildId)) {
      logger.info({ guildId }, 'Owner left voice channel, 24/7 enabled — staying connected');
      return;
    }

    logger.info({ guildId }, 'Owner left voice channel, disconnecting');

    try {
      await this.voiceManager.leave(guildId);
    } catch (err) {
      logger.error({ err, guildId }, 'Failed to leave voice channel');
    }
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    logger.info('Cleaning up voice follower');

    // Clear all debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    // Remove ONLY our own listener
    if (this.onVoiceStateUpdate) {
      this.client.off('voiceStateUpdate', this.onVoiceStateUpdate);
    }
  }
}
