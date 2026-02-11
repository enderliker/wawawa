import gtts from 'gtts';
import { Readable } from 'node:stream';
import { createChildLogger } from '../../util/logger.js';
import type { TtsProvider } from './TtsProvider.js';

const logger = createChildLogger('GttsProvider');

/**
 * NOTE:
 * - Pterodactyl hosts can have flaky/slow outbound networking.
 * - The npm "gtts" library sometimes hangs, which caused long delays.
 *
 * Strategy:
 * 1) In-memory cache for repeated texts (cuts latency massively).
 * 2) Run BOTH synthesis paths in parallel and take the first success:
 *    - fetch() to translate.google.com/translate_tts (usually fastest)
 *    - npm "gtts" library stream (fallback)
 * 3) Only log errors if BOTH paths fail.
 */
export class GttsProvider implements TtsProvider {
  readonly name = 'gtts';
  private lang: string;

  // Separate timeouts: fetch tends to be faster; library can hang.
  private fetchTimeoutMs: number;
  private libTimeoutMs: number;

  private retries: number;

  // Simple FIFO cache (good enough for small bots)
  private cache = new Map<string, Buffer>();
  private cacheMaxEntries: number;

  constructor(
    lang: string = 'es',
    fetchTimeoutMs: number = 15000,
    libTimeoutMs: number = 8000,
    retries: number = 1,
    cacheMaxEntries: number = 200
  ) {
    this.lang = lang;
    this.fetchTimeoutMs = fetchTimeoutMs;
    this.libTimeoutMs = libTimeoutMs;
    this.retries = retries;
    this.cacheMaxEntries = cacheMaxEntries;

    logger.info(
      { lang, fetchTimeoutMs, libTimeoutMs, retries, cacheMaxEntries },
      'gTTS provider initialized'
    );
  }

  async synthesize(text: string): Promise<Buffer> {
    const key = `${this.lang}:${text}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    let lastErr: unknown;

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        // Run in parallel; use whichever succeeds first.
        const buf = await Promise.any([
          this.synthesizeWithFetch(text),
          this.synthesizeWithLibrary(text),
        ]);

        this.putCache(key, buf);
        return buf;
      } catch (err) {
        lastErr = err;
        logger.warn({ err, attempt }, 'gTTS synthesis attempt failed (both paths)');
      }
    }

    throw lastErr instanceof Error ? lastErr : new Error('gTTS synthesis failed');
  }

  private putCache(key: string, buf: Buffer): void {
    // FIFO eviction
    if (this.cache.size >= this.cacheMaxEntries) {
      const firstKey = this.cache.keys().next().value as string | undefined;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, buf);
  }

  private synthesizeWithLibrary(text: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(
        () => reject(new Error('gTTS (library) synthesis timeout')),
        this.libTimeoutMs
      );

      try {
        const tts = new (gtts as any)(text, this.lang);

        const cb = (err: Error | null, stream: Readable) => {
          clearTimeout(timeoutId);
          if (err) return reject(err);

          const chunks: Buffer[] = [];
          stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
          stream.on('end', () => resolve(Buffer.concat(chunks)));
          stream.on('error', (streamErr) => reject(streamErr));
        };

        if (typeof (tts as any).stream === 'function') {
          try {
            (tts as any).stream(cb);
          } catch {
            (tts as any).stream(text, cb);
          }
        } else {
          reject(new Error('gTTS library does not support stream()'));
        }
      } catch (err) {
        clearTimeout(timeoutId);
        reject(err);
      }
    });
  }

  private async synthesizeWithFetch(text: string): Promise<Buffer> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.fetchTimeoutMs);

    try {
      const url = new URL('https://translate.google.com/translate_tts');
      url.searchParams.set('ie', 'UTF-8');
      url.searchParams.set('q', text);
      url.searchParams.set('tl', this.lang);
      url.searchParams.set('client', 'tw-ob');

      const res = await fetch(url.toString(), {
        signal: controller.signal,
        headers: {
          // Helps avoid 403 from some edges
          'user-agent': 'Mozilla/5.0',
          // Sometimes translate_tts behaves better with an explicit accept
          accept: 'audio/mpeg,audio/*;q=0.9,*/*;q=0.8',
        },
      });

      if (!res.ok) {
        throw new Error(`gTTS (fetch) failed: HTTP ${res.status}`);
      }

      const arr = await res.arrayBuffer();
      return Buffer.from(arr);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }
}
