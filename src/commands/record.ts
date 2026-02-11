import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  MessageFlags,
  ChannelType,
} from 'discord.js';
import { guardInteraction } from '../guards/ownerOnly.js';
import { createChildLogger } from '../util/logger.js';
import { VoiceManager } from '../voice/voiceManager.js';
import { VoiceClipRecorder } from '../util/voiceClipRecorder.js';
import { opusPacketsToWavBuffer } from '../util/wav.js';
import { getRecordingEnabled } from '../util/settings.js';

const logger = createChildLogger('RecordCommand');

export const data = new SlashCommandBuilder()
  .setName('record')
  .setDescription('Create a 10s voice clip (owner-only; requires /recording enabled:true)');

export async function execute(
  interaction: ChatInputCommandInteraction,
  voiceManager: VoiceManager,
  clipRecorder: VoiceClipRecorder
): Promise<void> {
  if (!(await guardInteraction(interaction))) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    if (!interaction.guild) {
      await interaction.editReply('This command can only be used in a server');
      return;
    }

    const guildId = interaction.guild.id;

    if (!getRecordingEnabled(guildId)) {
      await interaction.editReply('❌ Recording is disabled. Use /recording enabled:true first.');
      return;
    }

    const channelId = voiceManager.getChannelId(guildId);
    if (!channelId) {
      await interaction.editReply('❌ Bot is not in a voice channel in this server.');
      return;
    }

    const guild = interaction.guild;
    const voiceChannel = guild.channels.cache.get(channelId);
    if (!voiceChannel || (voiceChannel.type !== ChannelType.GuildVoice && voiceChannel.type !== ChannelType.GuildStageVoice)) {
      await interaction.editReply('❌ Could not resolve the active voice channel.');
      return;
    }

    logger.info({ guildId, channelId }, 'Processing /record command (10s clip, owner-consent)');

    const files: { attachment: Buffer; name: string }[] = [];

    // Produce one clip per human member (mixing is non-trivial; this keeps it reliable).
    for (const member of voiceChannel.members.values()) {
      if (member.user.bot) continue;
      const stream = clipRecorder.getRecentPacketStream(guildId, member.id, 10_000);
      const wav = await opusPacketsToWavBuffer(stream, { sampleRate: 48_000, channels: 2 });
      if (wav.length <= 44) continue; // header only / empty
      const safeName = member.displayName.replace(/[^a-z0-9-_]+/gi, '_').slice(0, 32) || member.id;
      files.push({ attachment: wav, name: `clip_${safeName}.wav` });
    }

    if (files.length === 0) {
      await interaction.editReply('❌ No recent audio captured yet. Speak for a moment and try again.');
      return;
    }

    await interaction.channel?.send({
      content: '🎙️ 10s voice clips (per user):',
      files,
    });

    await interaction.editReply('✅ Clip(s) sent.');
  } catch (err) {
    logger.error({ err }, 'Error executing /record command');
    const msg = err instanceof Error ? err.message : 'Unknown error';
    await interaction.editReply(`❌ Error: ${msg}`);
  }
}
