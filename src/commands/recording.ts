import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { guardInteraction } from '../guards/ownerOnly.js';
import { createChildLogger } from '../util/logger.js';
import { getRecordingEnabled, setRecordingEnabled } from '../util/settings.js';

const logger = createChildLogger('RecordingCommand');

export const data = new SlashCommandBuilder()
  .setName('recording')
  .setDescription('Enable/disable clip recording (owner-only, persistent)')
  .addBooleanOption((opt) =>
    opt
      .setName('enabled')
      .setDescription('Turn recording on/off for this server')
      .setRequired(true)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!(await guardInteraction(interaction))) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    if (!interaction.guild) {
      await interaction.editReply('This command can only be used in a server.');
      return;
    }

    const enabled = interaction.options.getBoolean('enabled', true);
    setRecordingEnabled(interaction.guild.id, enabled);

    logger.info({ guildId: interaction.guild.id, enabled }, 'Recording mode updated');
    await interaction.editReply(`✅ Recording is now **${enabled ? 'ENABLED' : 'DISABLED'}** for this server.`);
  } catch (err) {
    logger.error({ err }, 'Failed to update recording mode');
    const msg = err instanceof Error ? err.message : 'Unknown error';
    await interaction.editReply(`❌ Error: ${msg}`);
  }
}
