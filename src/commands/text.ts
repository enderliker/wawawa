import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  MessageFlags,
  ChannelType,
} from 'discord.js';
import { guardInteraction } from '../guards/ownerOnly.js';
import { createChildLogger } from '../util/logger.js';

const logger = createChildLogger('TextCommand');

export const data = new SlashCommandBuilder()
  .setName('text')
  .setDescription('Enviar un mensaje como el bot')
  .addStringOption((option) =>
    option
      .setName('texto')
      .setDescription('Texto a enviar')
      .setRequired(true)
      .setMaxLength(2000)
  )
  .addChannelOption((option) =>
    option
      .setName('canal')
      .setDescription('Canal destino (opcional)')
      .setRequired(false)
      // Mostrar canales de texto y de voz
      .addChannelTypes(
        ChannelType.GuildText,
        ChannelType.GuildAnnouncement,
        ChannelType.GuildVoice,
        ChannelType.GuildStageVoice
      )
  );

export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  if (!(await guardInteraction(interaction))) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const texto = interaction.options.getString('texto', true);
  const selected = interaction.options.getChannel('canal', false) ?? interaction.channel;

  logger.info(
    {
      guildId: interaction.guild?.id,
      channelId: selected?.id ?? interaction.channelId,
      userId: interaction.user.id,
      content: texto,
    },
    'Processing /text command'
  );

  if (!selected) {
    await interaction.editReply('No hay un canal disponible.');
    return;
  }

  // discord.js: algunos tipos (voz) pueden o no ser "text-based" según versión/feature.
  // Permitimos selección de voz, pero si no es messageable, respondemos con error claro.
  const anyChan: any = selected as any;

  if (typeof anyChan?.isTextBased === 'function' && !anyChan.isTextBased()) {
    await interaction.editReply('Ese canal no acepta mensajes (no es text-based).');
    return;
  }
  if (typeof anyChan?.send !== 'function') {
    await interaction.editReply('Ese tipo de canal no soporta enviar mensajes.');
    return;
  }

  try {
    await anyChan.send({ content: texto });
    await interaction.editReply('✅ Enviado.');
  } catch (err) {
    logger.error({ err }, 'Error sending /text message');
    const msg = err instanceof Error ? err.message : 'Unknown error';
    await interaction.editReply(`❌ Error: ${msg}`);
  }
}
