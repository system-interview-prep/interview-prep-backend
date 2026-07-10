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
import { JOB_PROFILE_CANONICAL_EXTRAS_SYSTEM_PROMPT } from './job-profile-canonical-extras-prompt';
import { JOB_PROFILE_DESCRIPTION_SYSTEM_PROMPT } from './job-profile-description-prompt';
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

  async generateJobProfileCanonicalAndExtras(input: {
    jobId: string;
    rawText: string;
    createdAt?: string;
  }): Promise<
    | { canonical: Record<string, any>; canonicalUi: Record<string, any>; extras: Record<string, any> }
    | { error: string; raw: string }
  > {
    const humanizeKey = (key: string): string => {
      const acronyms = new Set(['id', 'url', 'api', 'cv', 'jd', 'kpi', 'hr']);
      const s = String(key || '')
        .trim()
        .replace(/[_-]+/g, ' ')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/\s+/g, ' ');
      return s
        .split(' ')
        .filter(Boolean)
        .map((w) => {
          const lower = w.toLowerCase();
          if (acronyms.has(lower)) return lower.toUpperCase();
          return lower.charAt(0).toUpperCase() + lower.slice(1);
        })
        .join(' ');
    };

    const isLabeled = (v: any): v is { label: any; value: any } =>
      Boolean(v) && typeof v === 'object' && !Array.isArray(v) && 'label' in v && 'value' in v;

    const wrapLabeled = (key: string, value: any): { label: string; value: any } => ({
      label: humanizeKey(key),
      value,
    });

    // Convert labeled canonical -> raw canonical (schema-only values), and ensure ui object exists.
    const unwrapCanonical = (node: any, keyForLabel = ''): { raw: any; ui: any } => {
      // If model already returns labeled node
      if (isLabeled(node)) {
        const label = String(node.label || '').trim() || (keyForLabel ? humanizeKey(keyForLabel) : 'Value');
        const inner = unwrapCanonical(node.value, '');
        return { raw: inner.raw, ui: { label, value: inner.ui?.value ?? node.value } };
      }
      // Plain arrays/primitive: return as-is
      if (node === null || typeof node !== 'object' || Array.isArray(node)) {
        return { raw: node, ui: keyForLabel ? { label: humanizeKey(keyForLabel), value: node } : node };
      }
      // Object: for each key, unwrap
      const rawOut: Record<string, any> = {};
      const uiOut: Record<string, any> = {};
      for (const [k, v] of Object.entries(node)) {
        const inner = unwrapCanonical(v, k);
        rawOut[k] = inner.raw;
        // ensure each field is labeled in UI form
        uiOut[k] = isLabeled(inner.ui) ? inner.ui : wrapLabeled(k, inner.ui?.value ?? v);
      }
      return { raw: rawOut, ui: uiOut };
    };

    const normalizeExtras = (extrasRaw: any): Record<string, any> => {
      const out: Record<string, any> = {};
      const extrasObj =
        extrasRaw && typeof extrasRaw === 'object' && !Array.isArray(extrasRaw)
          ? extrasRaw
          : {};

      for (const [k, v] of Object.entries(extrasObj)) {
        if (isLabeled(v)) {
          const label = String((v as any).label || '').trim() || humanizeKey(k);
          out[k] = { label, value: (v as any).value };
        } else {
          out[k] = { label: humanizeKey(k), value: v as any };
        }
      }
      return out;
    };

    const todayUtc = new Date().toISOString().slice(0, 10);
    const payload = {
      jobId: input.jobId,
      createdAt: input.createdAt ? input.createdAt.slice(0, 10) : todayUtc,
      rawText: String(input.rawText || ''),
    };

    const raw = await this.converseWithSystem({
      systemPrompts: [
        JOB_PROFILE_CANONICAL_EXTRAS_SYSTEM_PROMPT,
        `TODAY_UTC_DATE: ${todayUtc}`,
      ],
      userText: JSON.stringify(payload),
      maxTokens: 4096,
    });

    const extractJsonCandidate = (text: string): string => {
      const trimmed = (text || '').trim();
      const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
      const candidate = (fenced?.[1] ?? trimmed).trim();
      const start = candidate.indexOf('{');
      const end = candidate.lastIndexOf('}');
      if (start >= 0 && end > start) return candidate.slice(start, end + 1).trim();
      return candidate;
    };

    const jsonCandidate = extractJsonCandidate(raw);
    try {
      const parsed = JSON.parse(jsonCandidate);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { error: 'MODEL_OUTPUT_NOT_OBJECT', raw };
      }
      const canonical = (parsed as any).canonical;
      const extras = (parsed as any).extras;
      if (!canonical || typeof canonical !== 'object' || Array.isArray(canonical)) {
        return { error: 'MODEL_OUTPUT_CANONICAL_MISSING', raw };
      }
      const unwrapped = unwrapCanonical(canonical);
      const normalizedExtras = normalizeExtras(extras);
      return { canonical: unwrapped.raw, canonicalUi: unwrapped.ui, extras: normalizedExtras };
    } catch {
      return { error: 'MODEL_OUTPUT_NOT_JSON', raw };
    }
  }

  async generateJobDescriptionFromProfileUi(input: {
    title: string;
    canonicalUi: Record<string, any>;
    extras?: Record<string, any> | null;
  }): Promise<{ description: string } | { error: string; raw: string }> {
    const title = String(input.title || '').trim();
    if (!title) return { error: 'MISSING_TITLE', raw: '' };

    const payload = {
      title,
      canonical_ui_json: input.canonicalUi || {},
      extras_json: input.extras || {},
    };

    const raw = await this.converseWithSystem({
      systemPrompts: [
        JOB_PROFILE_DESCRIPTION_SYSTEM_PROMPT,
        'Return ONLY Markdown text. Do not include JSON. Do not include markdown fences.',
      ],
      userText: JSON.stringify(payload),
      maxTokens: 1200,
    });

    const text = String(raw || '').trim();
    if (!text) return { error: 'MODEL_OUTPUT_EMPTY', raw };
    // basic guard: if model mistakenly outputs JSON, treat as error
    if (text.startsWith('{') || text.startsWith('[')) {
      return { error: 'MODEL_OUTPUT_LOOKS_LIKE_JSON', raw };
    }
    // Ensure we never return markdown headings (#, ##, ###...) to keep UI simple.
    const sanitized = text.replace(/^\s*#{1,6}\s*/gm, '').trim();
    return { description: sanitized };
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

  async converseWithTools(params: {
    systemPrompts: string[];
    messages: any[];
    tools: any[];
    toolResolver: (toolUse: { name: string; input: any; toolUseId: string }) => Promise<any>;
    maxTokens?: number;
  }): Promise<string> {
    const system = (params.systemPrompts || []).filter(Boolean).map((text) => ({ text }));
    const messages = [...params.messages];

    const maxLoops = 10;
    for (let loop = 0; loop < maxLoops; loop++) {
      const response = await this.client.send(
        new ConverseCommand({
          modelId: process.env.MODELID || '',
          system,
          messages,
          toolConfig: { tools: params.tools },
          inferenceConfig: params.maxTokens ? { maxTokens: params.maxTokens } : undefined,
        }),
      );

      const outputMsg = response.output?.message;
      if (!outputMsg) {
        throw new Error('Empty response from Bedrock model');
      }

      messages.push(outputMsg);

      if (response.stopReason === 'tool_use') {
        const toolRequests = outputMsg.content?.filter((c) => c.toolUse) || [];
        const toolResultsContent: any[] = [];

        for (const req of toolRequests) {
          const toolUse = req.toolUse;
          if (toolUse) {
            const result = await params.toolResolver({
              name: toolUse.name || '',
              input: toolUse.input,
              toolUseId: toolUse.toolUseId || '',
            });
            toolResultsContent.push({
              toolResult: {
                toolUseId: toolUse.toolUseId,
                content: [{ json: result }],
              },
            });
          }
        }

        messages.push({
          role: 'user' as ConversationRole,
          content: toolResultsContent,
        });
      } else {
        const textContent = outputMsg.content
          ?.filter((c) => c.text !== undefined)
          .map((c) => c.text)
          .join('\n') || '';
        return textContent;
      }
    }

    throw new Error('Exceeded maximum tool calling loops limit');
  }
}

