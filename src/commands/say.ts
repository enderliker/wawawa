import { SlashCommandBuilder, ChatInputCommandInteraction, GuildMember, MessageFlags } from 'discord.js';
import { guardInteraction } from '../guards/ownerOnly.js';
import { createChildLogger } from '../util/logger.js';
import { VoiceManager } from '../voice/voiceManager.js';
import { TtsQueue } from '../tts/queue.js';

const logger = createChildLogger('SayCommand');

export const data = new SlashCommandBuilder()
  .setName('say')
  .setDescription('Make the bot speak text in voice channel')
  .addStringOption((option) =>
    option
      .setName('text')
      .setDescription('Text to speak')
      .setRequired(true)
      .setMaxLength(500)
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
  voiceManager: VoiceManager,
  ttsQueue: TtsQueue
): Promise<void> {
  // Owner-only guard
  if (!(await guardInteraction(interaction))) {
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const text = interaction.options.get('text', true).value as string;

    if (!interaction.guild) {
      await interaction.editReply('This command can only be used in a server');
      return;
    }

    const member = interaction.member as GuildMember;
    const voiceChannel = member.voice.channel;

    if (!voiceChannel) {
      await interaction.editReply('You must be in a voice channel to use this command');
      return;
    }

    logger.info(
      {
        guildId: interaction.guild.id,
        channelId: voiceChannel.id,
        userId: interaction.user.id,
        text,
      },
      'Processing /say command'
    );

    // Ensure bot is connected to voice channel
    let connection = voiceManager.getConnection(interaction.guild.id);
    
    if (!connection || voiceManager.getChannelId(interaction.guild.id) !== voiceChannel.id) {
      logger.info(
        { guildId: interaction.guild.id, channelId: voiceChannel.id },
        'Bot not in owner\'s voice channel, joining'
      );
      connection = await voiceManager.join(voiceChannel);
    }

    // Enqueue TTS
    await ttsQueue.enqueue(interaction.guild.id, text, connection);

    await interaction.editReply(`🔊 Speaking: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`);
    
  } catch (err) {
    logger.error({ err }, 'Error executing /say command');
    
    const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
    await interaction.editReply(`❌ Error: ${errorMessage}`);
  }
}
