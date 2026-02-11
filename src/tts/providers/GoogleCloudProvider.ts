import { createChildLogger } from '../../util/logger.js';
import type { TtsProvider } from './TtsProvider.js';

const logger = createChildLogger('GoogleCloudProvider');

// Dynamic import to handle optional dependency
type TextToSpeechClient = any;

export class GoogleCloudProvider implements TtsProvider {
  readonly name = 'google-cloud';
  private client: TextToSpeechClient | null = null;
  private voiceName: string;
  private languageCode: string;

  constructor(voiceName?: string, languageCode: string = 'es-ES') {
    this.languageCode = languageCode;
    
    // Fallback voice names if specific one isn't available
    this.voiceName = voiceName || this.getDefaultVoice(languageCode);
    
    logger.info(
      { voiceName: this.voiceName, languageCode },
      'Google Cloud TTS provider created (not yet initialized)'
    );
  }

  private getDefaultVoice(languageCode: string): string {
    // Map language codes to default female voices
    const defaults: Record<string, string> = {
      'es-ES': 'es-ES-Standard-A',
      'es-US': 'es-US-Standard-A',
      'es-MX': 'es-US-Standard-A',
      'es': 'es-ES-Standard-A',
    };
    
    return defaults[languageCode] || 'es-ES-Standard-A';
  }

  async initialize(): Promise<void> {
    if (this.client) {
      return; // Already initialized
    }

    try {
      // Dynamic import of optional dependency
      const { TextToSpeechClient } = await import('@google-cloud/text-to-speech');
      
      this.client = new TextToSpeechClient();
      
      logger.info('Google Cloud TTS client initialized');
    } catch (err) {
      logger.error({ err }, 'Failed to initialize Google Cloud TTS client');
      throw new Error(
        'Google Cloud TTS not available. Install @google-cloud/text-to-speech ' +
        'and configure GOOGLE_APPLICATION_CREDENTIALS'
      );
    }
  }

  async synthesize(text: string): Promise<Buffer> {
    if (!this.client) {
      await this.initialize();
    }

    logger.debug({ text, voice: this.voiceName }, 'Synthesizing with Google Cloud TTS');

    try {
      const [response] = await this.client.synthesizeSpeech({
        input: { text },
        voice: {
          languageCode: this.languageCode,
          name: this.voiceName,
          ssmlGender: 'FEMALE',
        },
        audioConfig: {
          audioEncoding: 'MP3',
          speakingRate: 1.0,
          pitch: 0.0,
        },
      });

      if (!response.audioContent) {
        throw new Error('No audio content in response');
      }

      const buffer = Buffer.from(response.audioContent as Uint8Array);
      logger.debug({ size: buffer.length }, 'Google Cloud TTS synthesis complete');
      
      return buffer;
    } catch (err) {
      logger.error({ err }, 'Google Cloud TTS synthesis error');
      throw err;
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Check if credentials are configured
      if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && 
          !process.env.GOOGLE_CLOUD_PROJECT_ID) {
        logger.warn('Google Cloud credentials not configured');
        return false;
      }

      // Try to initialize
      await this.initialize();
      return true;
    } catch (err) {
      logger.warn({ err }, 'Google Cloud TTS not available');
      return false;
    }
  }
}
