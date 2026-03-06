
import { Injectable } from '@nestjs/common';
import { BedrockRuntimeClient, ConversationRole, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient, PutItemCommand, QueryCommand, DeleteItemCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import { ElevenLabsClient, ElevenLabs } from '@elevenlabs/elevenlabs-js';
import { SYSTEM_PROMPT } from './system-prompt';
import * as dotenv from 'dotenv';

@Injectable()
export class AiService {
  private client: BedrockRuntimeClient;
  private dynamo: DynamoDBClient;
  private elevenlabs: ElevenLabsClient;

  constructor() {
    dotenv.config();
    this.client = new BedrockRuntimeClient({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      },
    });
    this.dynamo = new DynamoDBClient({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      },
    });
    this.elevenlabs = new ElevenLabsClient({
      apiKey: process.env.ELEVENLABS_API_KEY || '',
    });
  }

  // Save a chat message to DynamoDB
  async saveChatMessage(sessionId: string, timestamp: string, role: string, content: string) {
    const params: any = {
      TableName: process.env.DYNAMO_CHAT_TABLE || 'InterviewChats',
      Item: {
        PK: { S: `SESSION#${sessionId}` },
        SK: { S: timestamp },
        role: { S: role },
        content: { S: content },
      },
    };
    await this.dynamo.send(new PutItemCommand(params));
  }

  // Get up to 20 most recent chat messages for a session, sorted by timestamp (oldest to newest)
  async getChatHistory(sessionId: string) {
    // Query newest first, then reverse for chronological order
    const params = {
      TableName: process.env.DYNAMO_CHAT_TABLE,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': { S: `SESSION#${sessionId}` },
      },
      ScanIndexForward: false, // newest first
      Limit: 20,
    };
    const data = await this.dynamo.send(new QueryCommand(params));
    // Reverse to chronological order (oldest to newest)
    return (data.Items || [])
      .map(item => ({
        role: item.role.S,
        content: item.content.S,
        timestamp: item.SK.S,
      }))
      .reverse();
  }

  // Delete all chat messages for a session (session reset)
  async resetSession(sessionId: string) {
    // Query all SKs for the session, then batch delete
    const params = {
      TableName: process.env.DYNAMO_CHAT_TABLE,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': { S: `SESSION#${sessionId}` },
      },
      ProjectionExpression: 'PK, SK',
    };
    const data = await this.dynamo.send(new QueryCommand(params));
    if (!data.Items) return;
    for (const item of data.Items) {
      await this.dynamo.send(new DeleteItemCommand({
        TableName: process.env.DYNAMO_CHAT_TABLE,
        Key: { PK: { S: item.PK.S }, SK: { S: item.SK.S } },
      }));
    }
  }

  async chat(
    sessionId: string,
    newMessage: { role: string, content: string },
    language: string,
  ): Promise<any> {

    const now = new Date().toISOString();
    await this.saveChatMessage(sessionId, now, newMessage.role, newMessage.content);

    const history = await this.getChatHistory(sessionId);
    const messages = history.map(msg => ({
      role: msg.role as ConversationRole,
      content: [{ text: msg.content }],
    }));

    const systemPrompt = [{ text: `${SYSTEM_PROMPT}\n\nALL RESPONSES MUST BE IN: ${language.toUpperCase()}` }];

    try {
      const response = await this.client.send(
        new ConverseCommand({
          modelId: process.env.MODELID || '',
          system: systemPrompt,
          messages,
        }),
      );
      const aiText = response.output?.message?.content?.[0]?.text || '';
      // Lưu luôn câu trả lời của AI vào DynamoDB
      const aiTimestamp = new Date().toISOString();
      await this.saveChatMessage(
        sessionId,
        aiTimestamp,
        'assistant',
        aiText
      );
      return aiText;
    } catch (error: any) {
      if (error.name === "ModelNotReady") {
        console.error(
          `${error.name} - Model not ready, please wait and try again.`,
        );
      } else if (error.name === "BedrockRuntimeException") {
        console.error(
          `${error.name} - Error occurred while sending Converse request`,
        );
      }
      throw error;
    }
  }

  async chatToSpeech(
    sessionId: string,
    newMessage: { role: string, content: string },
    language: string,
  ): Promise<{ reply: string; audioBase64: string; mimeType: string }> {
    const reply = await this.chat(sessionId, newMessage, language);
    const voiceId = process.env.ELEVENLABS_VOICE_ID || '';
    const modelId = process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2';
    const outputFormat = (process.env.ELEVENLABS_OUTPUT_FORMAT || 'mp3_44100_128') as ElevenLabs.TextToSpeechConvertRequestOutputFormat;

    if (!voiceId) {
      throw new Error('ELEVENLABS_VOICE_ID is not configured');
    }

    const audio = await this.elevenlabs.textToSpeech.convert(voiceId, {
      text: reply || '',
      modelId,
      outputFormat,
    });

    const audioBuffer = await this.readAudioToBuffer(audio);
    const mimeType = this.getMimeType(outputFormat);

    return {
      reply: reply || '',
      audioBase64: audioBuffer.toString('base64'),
      mimeType,
    };
  }

  private getMimeType(outputFormat: string): string {
    if (outputFormat.startsWith('mp3')) {
      return 'audio/mpeg';
    }
    if (outputFormat.startsWith('wav')) {
      return 'audio/wav';
    }
    if (outputFormat.startsWith('ogg')) {
      return 'audio/ogg';
    }
    return 'application/octet-stream';
  }

  private async readAudioToBuffer(audio: any): Promise<Buffer> {
    if (Buffer.isBuffer(audio)) {
      return audio;
    }
    if (audio instanceof Uint8Array) {
      return Buffer.from(audio);
    }
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

    // Lấy tất cả sessionId (PK duy nhất)
  // Lấy tất cả sessionId (PK duy nhất), sắp xếp theo thời gian gần nhất (dựa trên SK lớn nhất)
  async getAllSessionIds(): Promise<string[]> {
    let lastKey = undefined;
    // Map: sessionId -> max timestamp (SK)
    const sessionMap = new Map<string, string>();
    do {
      const data = await this.dynamo.send(new ScanCommand({
        TableName: process.env.DYNAMO_CHAT_TABLE,
        ProjectionExpression: 'PK, SK',
        ExclusiveStartKey: lastKey,
      }));
      (data.Items || []).forEach(item => {
        if (item.PK && item.PK.S && item.SK && item.SK.S) {
          const sessionId = item.PK.S.replace('SESSION#', '');
          const timestamp = item.SK.S;
          if (!sessionMap.has(sessionId) || sessionMap.get(sessionId)! < timestamp) {
            sessionMap.set(sessionId, timestamp);
          }
        }
      });
      lastKey = data.LastEvaluatedKey;
    } while (lastKey);
    // Sort sessionIds by timestamp (desc)
    return Array.from(sessionMap.entries())
      .sort((a, b) => (a[1] < b[1] ? 1 : -1))
      .map(([sessionId]) => sessionId);
  }
}
