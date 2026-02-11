/**
 * Base interface for TTS providers
 */
export interface TtsProvider {
  /**
   * Provider name for logging
   */
  readonly name: string;
  
  /**
   * Synthesize text to speech audio
   * @param text Text to synthesize
   * @returns Audio buffer (MP3 or compatible format)
   */
  synthesize(text: string): Promise<Buffer>;
  
  /**
   * Optional: Check if provider is available/configured
   */
  isAvailable?(): Promise<boolean>;
}

/**
 * TTS configuration options
 */
export interface TtsConfig {
  provider: 'gtts' | 'google';
  voiceName?: string;
  lang: string;
  maxChars: number;
}

/**
 * Get TTS configuration from environment
 */
export function getTtsConfig(): TtsConfig {
  return {
    provider: (process.env.TTS_PROVIDER as 'gtts' | 'google') || 'gtts',
    voiceName: process.env.VOICE_NAME,
    lang: process.env.LANG || 'es',
    maxChars: parseInt(process.env.MAX_TTS_CHARS || '200', 10),
  };
}
