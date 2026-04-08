import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DynamoDBClient,
  GetItemCommand,
} from '@aws-sdk/client-dynamodb';
import { nowISO } from '../../utils';
import { AiProviderService } from '../ai/ai-provider.service';
import { SCORING_SYSTEM_PROMPT } from './scoring-prompt';

function extractJsonCandidate(raw: string): string {
  const trimmed = (raw || '').trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = (fenced?.[1] ?? trimmed).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start >= 0 && end > start) return candidate.slice(start, end + 1).trim();
  return candidate;
}

function safeParseJson(raw: string): any | null {
  try {
    const parsed = JSON.parse(raw);
    return parsed;
  } catch {
    return null;
  }
}

function toNumberOrNull(value: any): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function normalizeCriteriaBreakdown(items: any): any[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((it) => (it && typeof it === 'object' ? it : null))
    .filter(Boolean)
    .map((it: any) => {
      const name = String(it.name ?? it.criterion ?? '').trim();
      const evidence = String(it.evidence ?? it.details ?? '').trim();
      const matchRaw = toNumberOrNull(it.match ?? it.match_score);
      const importanceRaw = toNumberOrNull(it.importance);
      const type = it.type !== undefined ? String(it.type) : undefined;

      const match = matchRaw === null ? null : clamp01(matchRaw);
      const importance = importanceRaw === null ? null : Math.max(0, importanceRaw);

      return {
        ...(name ? { name } : {}),
        ...(type ? { type } : {}),
        ...(importance !== null ? { importance: round2(importance) } : {}),
        ...(match !== null ? { match: round2(match) } : {}),
        evidence: evidence || 'Không có bằng chứng rõ ràng trong dữ liệu cung cấp.',
      };
    })
    .filter((x) => typeof x.name === 'string' && x.name.length > 0);
}

function computeScores(criteria: any[]): {
  criteriaWithScore: any[];
  raw: number;
  max: number;
  normalized: number;
  percentage: number;
} {
  let raw = 0;
  let max = 0;

  const criteriaWithScore = (criteria || []).map((c: any) => {
    const match = toNumberOrNull(c.match) ?? 0;
    const importance = toNumberOrNull(c.importance) ?? 0;
    const score = match * importance;
    raw += score;
    max += importance;
    return {
      ...c,
      score: round2(score),
    };
  });

  const normalized = max > 0 ? raw / max : 0;
  const percentage = Math.round(normalized * 100);

  return {
    criteriaWithScore,
    raw: round2(raw),
    max: round2(max),
    normalized: round2(normalized),
    percentage,
  };
}

@Injectable()
export class ScoringService {
  private client: DynamoDBClient;
  private userCvTable: string;
  private jobProfileTable: string;

  constructor(private readonly ai: AiProviderService) {
    this.client = new DynamoDBClient({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      },
    });
    this.userCvTable = process.env.DYNAMO_USER_CV_TABLE || 'UserCvs';
    this.jobProfileTable = process.env.DYNAMO_JOB_PROFILE_TABLE || 'JobProfiles';
  }

  async scoreCvAgainstJobProfile(params: {
    userId: string;
    candidateId: string; // CV id
    jobId: string; // JobProfile id
  }): Promise<any> {
    if (!params.userId?.trim()) throw new BadRequestException('userId missing');
    if (!params.candidateId?.trim()) throw new BadRequestException('candidateId is required');
    if (!params.jobId?.trim()) throw new BadRequestException('jobId is required');

    // 1) Load CV structured_data
    const cvRes = await this.client.send(
      new GetItemCommand({
        TableName: this.userCvTable,
        Key: {
          user_id: { S: params.userId },
          id: { S: params.candidateId },
        },
        ProjectionExpression: 'user_id, id, structured_data',
      }),
    );
    if (!cvRes.Item) throw new NotFoundException('CV not found');
    const structuredRaw = cvRes.Item.structured_data?.S || '';
    const structuredData = safeParseJson(structuredRaw);
    if (!structuredData || typeof structuredData !== 'object') {
      throw new BadRequestException('CV structured_data is missing or invalid JSON');
    }

    // 2) Load JP ai_profile_json
    const jpRes = await this.client.send(
      new GetItemCommand({
        TableName: this.jobProfileTable,
        Key: { id: { S: params.jobId } },
        ProjectionExpression: 'id, ai_profile_json, title, description, requirements, keywords',
      }),
    );
    if (!jpRes.Item) throw new NotFoundException('Job profile not found');
    const aiProfileRaw = jpRes.Item.ai_profile_json?.S || '';
    const aiProfileJson = safeParseJson(aiProfileRaw);
    if (!aiProfileJson || typeof aiProfileJson !== 'object') {
      throw new BadRequestException('JobProfile ai_profile_json is missing or invalid JSON');
    }

    // 3) Ask model to output EXACT schema JSON
    const expectedSchemaHint = {
      candidateId: params.candidateId,
      jobId: params.jobId,
      score: { raw: 0, max: 0, normalized: 0, percentage: 0 },
      decision: 'FAIL',
      hardFilters: { passed: false, reasons: [] as string[] },
      criteriaBreakdown: [],
      summary: { strengths: [], weaknesses: [], suggestions: [] },
      metadata: { scoringVersion: '1.0', timestamp: nowISO() },
    };

    const userPayload = {
      candidateId: params.candidateId,
      jobId: params.jobId,
      jobProfile: aiProfileJson,
      candidateCv: structuredData,
      output_schema_example: expectedSchemaHint,
    };

    const MAX_ATTEMPTS = 3;
    let lastRaw = '';
    let parsed: any | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const extraStrict =
        attempt === 1
          ? ''
          : `ATTEMPT_${attempt}: Your previous output was NOT valid JSON. Fix it and return ONLY a single JSON object.`;

      lastRaw = await this.ai.converseWithSystem({
        systemPrompts: [
          SCORING_SYSTEM_PROMPT,
          'Return ONLY valid JSON. Do not include markdown fences. Output must strictly follow the provided JSON schema example keys.',
          'Do not add any extra keys. Do not add any commentary. Do not add trailing commas.',
          extraStrict,
        ].filter(Boolean),
        userText: JSON.stringify(userPayload),
      });

      const jsonCandidate = extractJsonCandidate(lastRaw);
      parsed = safeParseJson(jsonCandidate);
      if (parsed && typeof parsed === 'object') break;
    }

    if (!parsed || typeof parsed !== 'object') {
      return {
        error: 'MODEL_OUTPUT_NOT_JSON',
        raw: lastRaw,
      };
    }
    // Normalize to the schema FE expects (avoid alias keys from the model)
    const out: any = parsed;
    out.candidateId = params.candidateId;
    out.jobId = params.jobId;
    const normalizedCriteria = normalizeCriteriaBreakdown(out.criteriaBreakdown);
    const computed = computeScores(normalizedCriteria);
    out.criteriaBreakdown = computed.criteriaWithScore;
    out.score = {
      raw: computed.raw,
      max: computed.max,
      normalized: computed.normalized,
      percentage: computed.percentage,
    };

    // Enforce HARD FILTER outcome from AI if present
    const hardPassed = out.hardFilters?.passed;
    if (hardPassed === false) out.decision = 'FAIL';


    console.log('out', out);  
    return out;
  }
}

