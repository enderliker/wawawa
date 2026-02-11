import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { createChildLogger } from '../util/logger.js';
import { guardInteraction } from '../guards/ownerOnly.js';
import { get247Enabled, set247Enabled } from '../util/settings.js';

const logger = createChildLogger('247Command');

export const data = new SlashCommandBuilder()
  // Discord command names cannot include '/', so we use 247
  .setName('247')
  .setDescription('Activa o desactiva el modo 24/7 (no salir de la llamada).')
  .addBooleanOption((opt) =>
    opt
      .setName('enabled')
      .setDescription('Opcional: true para activar, false para desactivar')
      .setRequired(false)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!(await guardInteraction(interaction))) return;

  if (!interaction.guild) {
    await interaction.reply({ content: 'Este comando solo funciona en servidores.', flags: MessageFlags.Ephemeral });
    return;
  }

  const guildId = interaction.guild.id;

  const provided = interaction.options.getBoolean('enabled', false);
  const current = get247Enabled(guildId);
  const enabled = typeof provided === 'boolean' ? provided : !current;

  set247Enabled(guildId, enabled);

  logger.info({ guildId, enabled }, '24/7 mode updated');

  await interaction.reply({
    content: enabled
      ? '✅ Modo **24/7** activado. El bot **no se saldrá** de la llamada.'
      : '🟦 Modo **24/7** desactivado. Comportamiento normal (se sale cuando el owner sale).',
    flags: MessageFlags.Ephemeral,
  });
}
