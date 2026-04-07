
import { Injectable } from '@nestjs/common';
import { BedrockRuntimeClient, ConversationRole, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient, PutItemCommand, QueryCommand, DeleteItemCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { TTSProvider } from '../../utils/tts.interface';
import { ElevenLabsUtil } from '../../utils/elevenlabs.util';
import { S3Util } from '../../utils/s3.util';
import { SYSTEM_PROMPT } from './system-prompt';
import { JOB_PROFILE_JSON_SYSTEM_PROMPT } from './job-profile-json-prompt';
import { CV_JSON_SYSTEM_PROMPT } from './cv-json-prompt';
import * as dotenv from 'dotenv';

@Injectable()
export class AiService {
  private client: BedrockRuntimeClient;
  private dynamo: DynamoDBClient;
  private ttsProvider: TTSProvider;
  private s3Util: S3Util;

  private sessionTableName: string;
  private messageTableName: string;

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
    this.ttsProvider = new ElevenLabsUtil();
    this.s3Util = new S3Util();

    this.sessionTableName = process.env.DYNAMO_SESSION_TABLE || 'InterviewSessions';
    this.messageTableName = process.env.DYNAMO_MESSAGE_TABLE || 'Messages';
  }

  async createInterviewSession(userId: string, type: string = 'General', language: string = 'English'): Promise<string> {
    const sessionId = uuidv4();
    const now = new Date().toISOString();

    await this.dynamo.send(new PutItemCommand({
      TableName: this.sessionTableName,
      Item: {
        id: { S: sessionId },
        user_id: { S: userId },
        type: { S: type },
        language: { S: language },
        status: { S: 'Open' },
        started_at: { S: now },
      },
    }));
    return sessionId;
  }

  async saveChatMessage(sessionId: string, timestamp: string, sender: string, content: string, audioUrl: string = '') {
    const messageId = uuidv4();
    const item: Record<string, any> = {
      id: { S: messageId },
      session_id: { S: sessionId },
      sender: { S: sender }, // 'user' or 'assistant'
      type: { S: audioUrl ? 'audio' : 'text' },
      content: { S: content },
      created_at: { S: timestamp },
    };

    if (audioUrl) {
      item.audio_url = { S: audioUrl };
    }

    await this.dynamo.send(new PutItemCommand({
      TableName: this.messageTableName,
      Item: item,
    }));
  }

  async getChatHistory(sessionId: string) {
    const params = {
      TableName: this.messageTableName,
      IndexName: 'session_id-index',
      KeyConditionExpression: 'session_id = :sid',
      ExpressionAttributeValues: {
        ':sid': { S: sessionId },
      },
      // Note: If you want to sort by created_at, the GSI must have created_at as Sort Key.
      // ScanIndexForward: true, 
    };

    const data = await this.dynamo.send(new QueryCommand(params));
    
    // Fallback sort in case GSI has no sort key configured yet
    const items = (data.Items || []).sort((a, b) => a.created_at.S.localeCompare(b.created_at.S));

    return items.map(item => ({
      role: item.sender.S,
      content: item.content.S,
      audio_url: item.audio_url?.S || null,
      timestamp: item.created_at.S,
    }));
  }

  async getAllSessionsByUser(userId: string) {
    const params = {
      TableName: this.sessionTableName,
      IndexName: 'user_id-index',
      KeyConditionExpression: 'user_id = :uid',
      ExpressionAttributeValues: {
        ':uid': { S: userId },
      },
    };
    
    const data = await this.dynamo.send(new QueryCommand(params));
    return (data.Items || []).map((item) => ({
      id: item.id.S,
      type: item.type?.S,
      language: item.language?.S,
      status: item.status?.S,
      started_at: item.started_at?.S,
    }));
  }

  async chat(
    sessionId: string,
    newMessage: { role: string; content: string },
    language: string,
  ): Promise<string> {
    const now = new Date().toISOString();
    await this.saveChatMessage(sessionId, now, newMessage.role, newMessage.content);

    const history = await this.getChatHistory(sessionId);
    // Build context
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
      const aiTimestamp = new Date().toISOString();
      await this.saveChatMessage(sessionId, aiTimestamp, 'assistant', aiText); // Text version
      return aiText;
    } catch (error: any) {
      if (error.name === 'ModelNotReady') {
        console.error(`${error.name} - Model not ready, please wait and try again.`);
      } else if (error.name === 'BedrockRuntimeException') {
        console.error(`${error.name} - Error occurred while sending Converse request`);
      }
      throw error;
    }
  }

  async chatToSpeech(
    sessionId: string,
    newMessage: { role: string; content: string },
    language: string,
  ): Promise<{ reply: string; audioBase64: string; mimeType: string }> {
    // 1. Phản hồi Text
    const now = new Date().toISOString();
    await this.saveChatMessage(sessionId, now, newMessage.role, newMessage.content);

    const history = await this.getChatHistory(sessionId);
    const messages = history.map(msg => ({
      role: msg.role as ConversationRole,
      content: [{ text: msg.content }],
    }));

    const systemPrompt = [{ text: `${SYSTEM_PROMPT}\n\nALL RESPONSES MUST BE IN: ${language.toUpperCase()}` }];
    let replyText = '';

    try {
      const response = await this.client.send(
        new ConverseCommand({
          modelId: process.env.MODELID || '',
          system: systemPrompt,
          messages,
        }),
      );
      replyText = response.output?.message?.content?.[0]?.text || '';
    } catch (e) {
      console.error(e);
      throw e;
    }

    // 2. Chuyển đổi TTS
    const { audioBase64, mimeType } = await this.ttsProvider.convertTextToSpeech(replyText);

    // 3. Đẩy file Audio lên S3 lưu lấy link
    const audioUrl = await this.s3Util.uploadAudioBase64(audioBase64, mimeType);

    // 4. Lưu log vào bảng Messages
    const aiTimestamp = new Date().toISOString();
    await this.saveChatMessage(sessionId, aiTimestamp, 'assistant', replyText, audioUrl);

    return {
      reply: replyText,
      audioBase64,
      mimeType,
    };
  }

  async createSimliSession(faceId?: string): Promise<string> {
    const apiKey = process.env.SIMLI_API_KEY;
    if (!apiKey) {
      throw new Error('SIMLI_API_KEY is not configured');
    }

    const payload = {
      apiKey: apiKey,
      faceId: faceId || process.env.SIMLI_FACE_ID || 'tmp9lt11ci',
      syncAudio: true,
      isJPG: false,
    };

    const response = await fetch('https://api.simli.ai/startAudioToVideoSession', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create Simli session: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return data.session_token;
  }

  async getSimliIceServers(): Promise<any[]> {
    const apiKey = process.env.SIMLI_API_KEY;
    if (!apiKey) {
      throw new Error('SIMLI_API_KEY is not configured');
    }

    const response = await fetch('https://api.simli.ai/getIceServers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey }),
    });

    if (!response.ok) {
      return [{ urls: ['stun:stun.l.google.com:19302'] }];
    }
    const iceServers = await response.json();
    return iceServers;
  }

  async generateJobProfileJson(input: {
    jobId: string;
    title: string;
    categoryId?: string;
    keywords?: string[];
    description?: string;
    requirements?: string;
    createdAt?: string;
  }): Promise<Record<string, any>> {
    const todayUtc = new Date().toISOString().slice(0, 10);
    const payload = {
      ...input,
      createdAt: input.createdAt ? input.createdAt.slice(0, 10) : todayUtc,
    };

    const system = [
      { text: JOB_PROFILE_JSON_SYSTEM_PROMPT },
      { text: `TODAY_UTC_DATE: ${todayUtc}` },
    ];

    const messages = [
      {
        role: 'user' as ConversationRole,
        content: [{ text: JSON.stringify(payload) }],
      },
    ];

    const response = await this.client.send(
      new ConverseCommand({
        modelId: process.env.MODELID || '',
        system,
        messages,
      }),
    );

    const text = response.output?.message?.content?.[0]?.text || '';

    const extractJsonCandidate = (raw: string): string => {
      const trimmed = (raw || '').trim();
      // Strip fenced blocks if model accidentally returns them
      const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
      const candidate = (fenced?.[1] ?? trimmed).trim();

      // If still not pure JSON, try to grab first {...} object
      const start = candidate.indexOf('{');
      const end = candidate.lastIndexOf('}');
      if (start >= 0 && end > start) {
        return candidate.slice(start, end + 1).trim();
      }
      return candidate;
    };

    const jsonCandidate = extractJsonCandidate(text);
    try {
      const parsed = JSON.parse(jsonCandidate);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { error: 'MODEL_OUTPUT_NOT_OBJECT', raw: text };
      }
      return parsed;
    } catch {
      // If model returns non-JSON by mistake, wrap for storage/debugging
      return { error: 'MODEL_OUTPUT_NOT_JSON', raw: text };
    }
  }

  async generateCvJson(rawText: string): Promise<Record<string, any>> {
    const system = [{ text: CV_JSON_SYSTEM_PROMPT }];
    const messages = [
      {
        role: 'user' as ConversationRole,
        content: [{ text: rawText || '' }],
      },
    ];

    const response = await this.client.send(
      new ConverseCommand({
        modelId: process.env.MODELID || '',
        system,
        messages,
      }),
    );

    const text = response.output?.message?.content?.[0]?.text || '';
    // reuse JSON extraction logic from generateJobProfileJson
    const extractJsonCandidate = (raw: string): string => {
      const trimmed = (raw || '').trim();
      const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
      const candidate = (fenced?.[1] ?? trimmed).trim();
      const start = candidate.indexOf('{');
      const end = candidate.lastIndexOf('}');
      if (start >= 0 && end > start) return candidate.slice(start, end + 1).trim();
      return candidate;
    };
    const jsonCandidate = extractJsonCandidate(text);
    try {
      const parsed = JSON.parse(jsonCandidate);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { error: 'MODEL_OUTPUT_NOT_OBJECT', raw: text };
      }
      return parsed;
    } catch {
      return { error: 'MODEL_OUTPUT_NOT_JSON', raw: text };
    }
  }
}
