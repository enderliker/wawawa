import { Readable } from 'node:stream';
import prism from 'prism-media';

/**
 * Decode Opus packet stream to a WAV Buffer.
 *
 * The input stream must be a binary stream of Opus packets (NOT objectMode).
 */
export async function opusPacketsToWavBuffer(
  opusPacketStream: Readable,
  opts?: { sampleRate?: number; channels?: number }
): Promise<Buffer> {
  const sampleRate = opts?.sampleRate ?? 48_000;
  const channels = opts?.channels ?? 2;

  const decoder = new prism.opus.Decoder({ rate: sampleRate, channels, frameSize: 960 });

  const chunks: Buffer[] = [];
  let total = 0;

  return await new Promise<Buffer>((resolve, reject) => {
    opusPacketStream
      .pipe(decoder)
      .on('data', (d: Buffer) => {
        chunks.push(d);
        total += d.length;
      })
      .on('end', () => {
        const pcm = Buffer.concat(chunks, total);
        resolve(pcmToWav(pcm, sampleRate, channels));
      })
      .on('error', reject);

    opusPacketStream.on('error', reject);
  });
}

function pcmToWav(pcm: Buffer, sampleRate: number, channels: number): Buffer {
  const bitsPerSample = 16;
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM fmt chunk size
  header.writeUInt16LE(1, 20); // audio format 1=PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}
