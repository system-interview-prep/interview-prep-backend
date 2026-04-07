import { ElevenLabsClient, ElevenLabs } from '@elevenlabs/elevenlabs-js';
import { TTSProvider } from './tts.interface';

export class ElevenLabsUtil implements TTSProvider {
  private client: ElevenLabsClient;

  constructor() {
    this.client = new ElevenLabsClient({
      apiKey: process.env.ELEVENLABS_API_KEY || '',
    });
  }

  async convertTextToSpeech(text: string): Promise<{ audioBase64: string; mimeType: string }> {
    const voiceId = process.env.ELEVENLABS_VOICE_ID || '';
    const modelId = process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2';
    const outputFormat = (process.env.ELEVENLABS_OUTPUT_FORMAT || 'pcm_16000') as ElevenLabs.TextToSpeechConvertRequestOutputFormat;

    if (!voiceId) {
      throw new Error('ELEVENLABS_VOICE_ID is not configured');
    }

    const audioStream = await this.client.textToSpeech.convert(voiceId, {
      text: text || '',
      modelId,
      outputFormat,
    });

    const audioBuffer = await this.readAudioToBuffer(audioStream);
    const mimeType = this.getMimeType(outputFormat);

    return {
      audioBase64: audioBuffer.toString('base64'),
      mimeType,
    };
  }

  private getMimeType(outputFormat: string): string {
    if (outputFormat.startsWith('mp3')) return 'audio/mpeg';
    if (outputFormat.startsWith('wav')) return 'audio/wav';
    if (outputFormat.startsWith('ogg')) return 'audio/ogg';
    if (outputFormat.startsWith('pcm')) return 'audio/l16;rate=16000';
    return 'application/octet-stream';
  }

  private async readAudioToBuffer(audio: any): Promise<Buffer> {
    if (Buffer.isBuffer(audio)) return audio;
    if (audio instanceof Uint8Array) return Buffer.from(audio);
    if (audio?.arrayBuffer) {
      const arrayBuffer = await audio.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }
    if (audio?.transformToByteArray) {
      const byteArray = await audio.transformToByteArray();
      return Buffer.from(byteArray);
    }
    if (audio?.[Symbol.asyncIterator]) {
      const chunks: Buffer[] = [];
      for await (const chunk of audio) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    }
    if (audio?.on && audio?.pipe) {
      return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        audio.on('data', (chunk: Buffer | Uint8Array) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        audio.on('end', () => resolve(Buffer.concat(chunks)));
        audio.on('error', reject);
      });
    }
    throw new Error('Unsupported audio response type from ElevenLabs');
  }
}

