import { Injectable } from '@nestjs/common';
import {
  BedrockRuntimeClient,
  ConversationRole,
  ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { TTSProvider } from '../../utils/tts.interface';
import { ElevenLabsUtil } from '../../utils/elevenlabs.util';
import { S3Util } from '../../utils/s3.util';
import { SYSTEM_PROMPT } from './system-prompt';
import { JOB_PROFILE_JSON_SYSTEM_PROMPT } from './job-profile-json-prompt';
import { CV_JSON_SYSTEM_PROMPT } from './cv-json-prompt';
import * as dotenv from 'dotenv';

@Injectable()
export class AiProviderService {
  private client: BedrockRuntimeClient;
  private ttsProvider: TTSProvider;
  private s3Util: S3Util;

  constructor() {
    dotenv.config();
    this.client = new BedrockRuntimeClient({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      },
    });
    this.ttsProvider = new ElevenLabsUtil();
    this.s3Util = new S3Util();
  }

  async converse(params: {
    language: string;
    history: { role: ConversationRole; content: string }[];
    /** Merged into system when history starts with assistant (Bedrock requires user first). */
    extraSystemContext?: string;
  }): Promise<string> {
    const prefix: string[] = [];
    let i = 0;
    while (i < params.history.length && params.history[i].role === 'assistant') {
      prefix.push(params.history[i].content);
      i++;
    }
    const bedrockHistory = params.history.slice(i);
    const fromLeadingAssistants =
      prefix.length > 0 ? prefix.join('\n\n') : '';
    const extra = [params.extraSystemContext?.trim(), fromLeadingAssistants]
      .filter(Boolean)
      .join('\n\n');

    let systemText = `${SYSTEM_PROMPT}\n\nALL RESPONSES MUST BE IN: ${params.language.toUpperCase()}`;
    if (extra) {
      systemText += `\n\nINTERVIEW CONTEXT (messages already shown to the candidate):\n${extra}`;
    }
    const system = [{ text: systemText }];
    const messages = bedrockHistory.map((m) => ({
      role: m.role,
      content: [{ text: m.content }],
    }));

    const response = await this.client.send(
      new ConverseCommand({
        modelId: process.env.MODELID || '',
        system,
        messages,
      }),
    );
    return response.output?.message?.content?.[0]?.text || '';
  }

  async textToSpeechAndUpload(text: string): Promise<{
    audioBase64: string;
    mimeType: string;
    audioUrl: string;
  }> {
    const { audioBase64, mimeType } = await this.ttsProvider.convertTextToSpeech(
      text,
    );
    const audioUrl = await this.s3Util.uploadAudioBase64(audioBase64, mimeType);
    return { audioBase64, mimeType, audioUrl };
  }

  async createSimliSession(faceId?: string): Promise<string> {
    const apiKey = process.env.SIMLI_API_KEY;
    if (!apiKey) throw new Error('SIMLI_API_KEY is not configured');

    const payload = {
      apiKey,
      faceId: faceId || process.env.SIMLI_FACE_ID || 'tmp9lt11ci',
      syncAudio: true,
      isJPG: false,
    };

    const response = await fetch('https://api.simli.ai/startAudioToVideoSession', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to create Simli session: ${response.status} - ${errorText}`,
      );
    }
    const data = await response.json();
    return data.session_token;
  }

  async getSimliIceServers(): Promise<any[]> {
    const apiKey = process.env.SIMLI_API_KEY;
    if (!apiKey) throw new Error('SIMLI_API_KEY is not configured');

    const response = await fetch('https://api.simli.ai/getIceServers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey }),
    });
    if (!response.ok) return [{ urls: ['stun:stun.l.google.com:19302'] }];
    return await response.json();
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

  async converseWithSystem(params: {
    systemPrompts: string[];
    userText: string;
    maxTokens?: number;
  }): Promise<string> {
    const system = (params.systemPrompts || []).filter(Boolean).map((text) => ({ text }));
    const messages = [
      {
        role: 'user' as ConversationRole,
        content: [{ text: params.userText || '' }],
      },
    ];

    const response = await this.client.send(
      new ConverseCommand({
        modelId: process.env.MODELID || '',
        system,
        messages,
        inferenceConfig: params.maxTokens ? { maxTokens: params.maxTokens } : undefined,
      }),
    );
    return response.output?.message?.content?.[0]?.text || '';
  }
}

