import { CommandInteraction, Message, ButtonInteraction, ModalSubmitInteraction } from 'discord.js';
import { createChildLogger } from '../util/logger.js';

const logger = createChildLogger('ownerGuard');

// Default owner ID, can be overridden by OWNER_ID env var
const DEFAULT_OWNER_ID = '978783908638375956';

export const OWNER_ID = process.env.OWNER_ID || DEFAULT_OWNER_ID;

/**
 * Check if a user ID matches the owner
 */
export function isOwner(userId: string): boolean {
  return userId === OWNER_ID;
}

/**
 * Assert that a user is the owner, throws if not
 */
export function assertOwner(userId: string): void {
  if (!isOwner(userId)) {
    logger.warn({ userId, ownerId: OWNER_ID }, 'Access denied: not owner');
    throw new Error('Access denied: only the bot owner can use this command');
  }
}

/**
 * Guard for slash command interactions
 */
export async function guardInteraction(
  interaction: CommandInteraction | ButtonInteraction | ModalSubmitInteraction
): Promise<boolean> {
  const userId = interaction.user.id;
  
  if (!isOwner(userId)) {
    logger.info(
      { 
        userId, 
        username: interaction.user.username,
        type: interaction.type,
        commandName: 'commandName' in interaction ? interaction.commandName : undefined
      },
      'Denied: interaction from non-owner'
    );
    
    // Don't reply to avoid revealing bot presence to non-owners
    // Just silently ignore
    return false;
  }
  
  return true;
}

/**
 * Guard for message events
 */
export function guardMessage(message: Message): boolean {
  const userId = message.author.id;
  
  if (!isOwner(userId)) {
    logger.debug(
      { 
        userId, 
        username: message.author.username,
        channelId: message.channelId,
        guildId: message.guildId
      },
      'Denied: message from non-owner'
    );
    return false;
  }
  
  return true;
}

/**
 * Wrapper for command handlers that require owner permission
 */
export function ownerOnly<T extends any[], R>(
  fn: (...args: T) => R | Promise<R>
): (...args: T) => Promise<R | null> {
  return async (...args: T): Promise<R | null> => {
    // Extract user ID from first argument (interaction or message)
    const firstArg = args[0] as any;
    const userId = firstArg?.user?.id || firstArg?.author?.id;
    
    if (!userId || !isOwner(userId)) {
      logger.warn({ userId }, 'Owner-only function called by non-owner');
      return null;
    }
    
    return await fn(...args);
  };
}

// Log owner ID on module load
logger.info({ ownerId: OWNER_ID }, 'Owner guard initialized');
