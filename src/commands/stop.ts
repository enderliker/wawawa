import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { guardInteraction } from '../guards/ownerOnly.js';
import { createChildLogger } from '../util/logger.js';
import { TtsQueue } from '../tts/queue.js';

const logger = createChildLogger('StopCommand');

export const data = new SlashCommandBuilder()
  .setName('stop')
  .setDescription('Stop current TTS and clear queue');

export async function execute(
  interaction: ChatInputCommandInteraction,
  ttsQueue: TtsQueue
): Promise<void> {
  // Owner-only guard
  if (!(await guardInteraction(interaction))) {
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    if (!interaction.guild) {
      await interaction.editReply('This command can only be used in a server');
      return;
    }

    logger.info(
      { guildId: interaction.guild.id, userId: interaction.user.id },
      'Processing /stop command'
    );

    ttsQueue.stop(interaction.guild.id);

    await interaction.editReply('⏹️ Stopped TTS and cleared queue');
    
  } catch (err) {
    logger.error({ err }, 'Error executing /stop command');
    
    const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
    await interaction.editReply(`❌ Error: ${errorMessage}`);
  }
}
