/**
 * ai.config.ts
 * Configuration for AWS Bedrock and ElevenLabs AI services.
 */
export const aiConfig = {
  bedrock: {
    region: process.env.AWS_REGION || 'us-east-1',
    modelId: process.env.MODELID || 'anthropic.claude-3-sonnet-20240229-v1:0',
  },

  elevenlabs: {
    apiKey: process.env.ELEVENLABS_API_KEY || '',
    voiceId: process.env.ELEVENLABS_VOICE_ID || '',
    modelId: process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2',
    outputFormat: process.env.ELEVENLABS_OUTPUT_FORMAT || 'mp3_44100_128',
  },
};
