import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
} from '@aws-sdk/client-dynamodb';
import axios from 'axios';
import { nowISO } from '../../utils';
import { v4 as uuidv4 } from 'uuid';
import { unwrapLabeledJson } from '../../utils/labeled-json.util';

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

const SCORING_VERSION = '2.2-matching-calibrated';

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

function stringsFromUnknown(value: any): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((x) => (typeof x === 'string' ? x : JSON.stringify(x)))
      .map((x) => String(x || '').trim())
      .filter(Boolean);
  }
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  if (typeof value === 'object') {
    return Object.values(value)
      .flatMap((x) => stringsFromUnknown(x))
      .filter(Boolean);
  }
  return [];
}

type StructuredJobRequirements = {
  mustHave: string[];
  niceToHave: string[];
  constraints: string[];
};

function extractStructuredJobRequirements(jobProfile: Record<string, any> | null | undefined): StructuredJobRequirements {
  const source = jobProfile || {};
  const directMustHave = source.mustHave ?? source.must_have ?? source.haveMust ?? source.have_must;
  const directNiceToHave = source.niceToHave ?? source.nice_to_have ?? source.preferred;
  const requirements = jobProfile?.requirements;
  const requirementsValue =
    requirements && typeof requirements === 'object' && 'value' in requirements
      ? requirements.value
      : requirements;
  const mustHave = stringsFromUnknown(
    directMustHave ??
      (requirementsValue && typeof requirementsValue === 'object'
        ? requirementsValue.mustHave ??
          requirementsValue.must_have ??
          requirementsValue.haveMust ??
          requirementsValue.have_must ??
          requirementsValue.required
        : []),
  );
  const niceToHave = stringsFromUnknown(
    directNiceToHave ??
      (requirementsValue && typeof requirementsValue === 'object'
        ? requirementsValue.niceToHave ?? requirementsValue.nice_to_have ?? requirementsValue.preferred
        : []),
  );
  const constraintsRaw = source.constraints;
  const constraintsValue =
    constraintsRaw && typeof constraintsRaw === 'object' && 'value' in constraintsRaw
      ? constraintsRaw.value
      : constraintsRaw;
  const constraints = stringsFromUnknown(constraintsValue);

  return {
    mustHave: Array.from(new Set(mustHave)),
    niceToHave: Array.from(new Set(niceToHave)),
    constraints: Array.from(new Set(constraints)),
  };
}

function mergeStructuredJobRequirements(
  ...items: Array<StructuredJobRequirements | null | undefined>
): StructuredJobRequirements {
  return {
    mustHave: Array.from(new Set(items.flatMap((x) => x?.mustHave || []))),
    niceToHave: Array.from(new Set(items.flatMap((x) => x?.niceToHave || []))),
    constraints: Array.from(new Set(items.flatMap((x) => x?.constraints || []))),
  };
}

function buildStructuredJobHints(requirements: StructuredJobRequirements): string {
  const parts: string[] = [];
  if (requirements.mustHave.length) {
    parts.push(`MUST HAVE\n${requirements.mustHave.map((x) => `- ${x}`).join('\n')}`);
  }
  if (requirements.niceToHave.length) {
    parts.push(`NICE TO HAVE\n${requirements.niceToHave.map((x) => `- ${x}`).join('\n')}`);
  }
  if (requirements.constraints.length) {
    parts.push(`CONSTRAINTS\n${requirements.constraints.map((x) => `- ${x}`).join('\n')}`);
  }
  return parts.join('\n\n');
}

type MatchingServiceResult = {
  score: number;
  weightedScore: number | null;
  rank: number | null;
  explanation: string;
  scores: Record<string, number>;
  algorithmDetails: Record<string, any>;
  processingTimeSeconds: number | null;
  algorithmsUsed: string[];
  serviceVersion?: string;
};

@Injectable()
export class ScoringService {
  private client: DynamoDBClient;
  private userCvTable: string;
  private jobProfileTable: string;
  private scoringHistoryTable: string;
  private matchingServiceUrl: string;
  private matchingServiceTimeoutMs: number;
  private matchingScoreImportance: number;
  private matchingMethods: string[];
  private matchingPassThreshold: number;

  constructor() {
    this.client = new DynamoDBClient({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      },
    });
    this.userCvTable = process.env.DYNAMO_USER_CV_TABLE || 'UserCvs';
    this.jobProfileTable = process.env.DYNAMO_JOB_PROFILE_TABLE || 'JobProfiles';
    this.scoringHistoryTable = process.env.DYNAMO_SCORING_HISTORY_TABLE || 'InterviewScoringHistory';
    this.matchingServiceUrl = (process.env.RESUME_MATCHING_SERVICE_URL || 'http://localhost:5001').replace(/\/+$/, '');
    this.matchingServiceTimeoutMs = Math.max(1000, Number(process.env.RESUME_MATCHING_TIMEOUT_MS || 15000));
    this.matchingScoreImportance = Math.max(0, Number(process.env.RESUME_MATCHING_SCORE_IMPORTANCE || 3));
    this.matchingPassThreshold = clamp01(Number(process.env.RESUME_MATCHING_PASS_THRESHOLD || 0.6));
    this.matchingMethods = (process.env.RESUME_MATCHING_METHODS || 'requirements,sbert,bm25,cosine,ner')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean);
  }

  private async tryGetAlgorithmicMatch(params: {
    candidateCv: Record<string, any>;
    jobProfile: Record<string, any>;
    requirements?: StructuredJobRequirements;
    candidateText?: string;
    jobText?: string;
    candidateId: string;
    jobId: string;
  }): Promise<MatchingServiceResult | null> {
    if (!this.matchingServiceUrl || this.matchingMethods.length === 0) return null;

    try {
      const res = await axios.post(
        `${this.matchingServiceUrl}/api/process-resumes`,
        {
          cvs: [params.candidateText?.trim() || params.candidateCv],
          jobDescription: params.jobText?.trim() || undefined,
          job: params.jobText?.trim() ? undefined : params.jobProfile,
          requirements: params.requirements,
          methods: this.matchingMethods,
          position: 'general',
          metadata: {
            candidateId: params.candidateId,
            jobId: params.jobId,
            caller: 'interview-prep-backend',
          },
          options: {
            include_explanations: true,
            include_skill_extraction: true,
            include_score_breakdown: true,
          },
        },
        { timeout: this.matchingServiceTimeoutMs },
      );

      const payload = res.data;
      const first = Array.isArray(payload?.results) ? payload.results[0] : null;
      const score = toNumberOrNull(first?.final_score);
      if (!first || score === null) return null;

      const scores: Record<string, number> = {};
      const rawScores = first.scores && typeof first.scores === 'object' ? first.scores : {};
      for (const [key, value] of Object.entries(rawScores)) {
        const n = toNumberOrNull(value);
        if (n !== null) scores[key] = round2(clamp01(n));
      }

      return {
        score: round2(clamp01(score)),
        weightedScore: toNumberOrNull(first.weighted_score),
        rank: toNumberOrNull(first.rank),
        explanation: String(first.explanation || '').trim(),
        scores,
        algorithmDetails:
          first.algorithm_details && typeof first.algorithm_details === 'object'
            ? first.algorithm_details
            : {},
        processingTimeSeconds: toNumberOrNull(payload?.processing_time_seconds),
        algorithmsUsed: Array.isArray(payload?.summary?.algorithms_used)
          ? payload.summary.algorithms_used.map((x: any) => String(x))
          : this.matchingMethods,
        serviceVersion:
          typeof payload?.metadata?.server_version === 'string'
            ? payload.metadata.server_version
            : undefined,
      };
    } catch {
      return null;
    }
  }

  private buildAlgorithmicCriterion(match: MatchingServiceResult | null): any | null {
    if (!match || this.matchingScoreImportance <= 0) return null;
    const scoreParts = Object.entries(match.scores)
      .map(([name, value]) => `${name}: ${Math.round(value * 100)}%`)
      .join(', ');
    const evidence = scoreParts
      ? `Điểm ensemble thuật toán (${scoreParts}).`
      : match.explanation || 'Điểm ensemble từ dịch vụ matching CV-JD.';

    return {
      name: 'Độ phù hợp thuật toán CV-JD',
      type: 'algorithmic_ensemble',
      importance: round2(this.matchingScoreImportance),
      match: match.score,
      evidence: evidence.slice(0, 200),
    };
  }

  private getRequirementsDetails(match: MatchingServiceResult): Record<string, any> {
    const requirements = match.algorithmDetails?.requirements;
    const mustHave = match.algorithmDetails?.must_have;
    return (
      (requirements && typeof requirements === 'object' ? requirements.details : null) ||
      (mustHave && typeof mustHave === 'object' ? mustHave.details : null) ||
      {}
    );
  }

  private buildMatchingCriteria(match: MatchingServiceResult): any[] {
    const details = this.getRequirementsDetails(match);
    const criteria: any[] = [];

    if (match.scores.requirements !== undefined || match.scores.must_have !== undefined) {
      criteria.push({
        name: 'Yêu cầu có cấu trúc',
        type: 'requirements',
        importance: 5,
        match: round2(match.scores.requirements ?? match.scores.must_have ?? 0),
        score: round2((match.scores.requirements ?? match.scores.must_have ?? 0) * 5),
        evidence: [
          `Must-have: ${Math.round((details.must_have_score ?? 0) * 100)}%`,
          `Nice-to-have: ${Math.round((details.nice_to_have_score ?? 0) * 100)}%`,
          `Constraints: ${Math.round((details.constraints_score ?? 0) * 100)}%`,
        ].join(', '),
      });
    }

    for (const [name, importance] of [
      ['sbert', 3],
      ['bm25', 2],
      ['cosine', 2],
      ['ner', 1],
    ] as Array<[string, number]>) {
      const value = match.scores[name];
      if (value === undefined) continue;
      criteria.push({
        name: name.toUpperCase(),
        type: 'algorithm',
        importance,
        match: round2(value),
        score: round2(value * importance),
        evidence: `Điểm ${name.toUpperCase()} từ matching service: ${Math.round(value * 100)}%.`,
      });
    }

    const overall = this.buildAlgorithmicCriterion(match);
    return overall ? [overall, ...criteria] : criteria;
  }

  private buildMatchingSummary(match: MatchingServiceResult): {
    strengths: string[];
    weaknesses: string[];
    suggestions: string[];
  } {
    const details = this.getRequirementsDetails(match);
    const matchedMust = (details.matched_must_have || []).slice(0, 5);
    const matchedNice = (details.matched_nice_to_have || []).slice(0, 5);
    const missingMust = (details.missing_must_have || []).slice(0, 5);
    const missingNice = (details.missing_nice_to_have || []).slice(0, 5);
    const missingConstraints = (details.missing_constraints || []).slice(0, 5);

    return {
      strengths: [
        matchedMust.length ? `Đáp ứng must-have: ${matchedMust.join(', ')}.` : '',
        matchedNice.length ? `Có thêm nice-to-have: ${matchedNice.join(', ')}.` : '',
        match.explanation || '',
      ].filter(Boolean).slice(0, 5),
      weaknesses: [
        missingMust.length ? `Thiếu must-have: ${missingMust.join(', ')}.` : '',
        missingNice.length ? `Chưa có nice-to-have: ${missingNice.join(', ')}.` : '',
        missingConstraints.length ? `Chưa thỏa constraints: ${missingConstraints.join(', ')}.` : '',
      ].filter(Boolean).slice(0, 5),
      suggestions: [
        missingMust.length ? `Bổ sung bằng chứng cho must-have: ${missingMust.join(', ')}.` : '',
        missingNice.length ? `Nếu có, làm nổi bật thêm: ${missingNice.join(', ')}.` : '',
        missingConstraints.length ? `Làm rõ constraint liên quan: ${missingConstraints.join(', ')}.` : '',
      ].filter(Boolean).slice(0, 5),
    };
  }

  private buildMatchingOnlyOutput(params: {
    candidateId: string;
    jobId: string;
    match: MatchingServiceResult;
  }): any {
    const details = this.getRequirementsDetails(params.match);
    const missingMust = Array.isArray(details.missing_must_have)
      ? details.missing_must_have.map((x: any) => String(x)).filter(Boolean)
      : [];
    const missingConstraints = Array.isArray(details.missing_constraints)
      ? details.missing_constraints.map((x: any) => String(x)).filter(Boolean)
      : [];
    const hardPassed = missingMust.length === 0 && details.must_have_ok !== false;
    const decision =
      hardPassed && params.match.score >= this.matchingPassThreshold ? 'PASS' : 'FAIL';
    const percentage = Math.round(params.match.score * 100);

    return {
      candidateId: params.candidateId,
      jobId: params.jobId,
      score: {
        raw: round2(params.match.score),
        max: 1,
        normalized: round2(params.match.score),
        percentage,
      },
      decision,
      hardFilters: {
        passed: hardPassed,
        reasons: missingMust.map((x) => `Thiếu must-have: ${x}`),
      },
      criteriaBreakdown: this.buildMatchingCriteria(params.match),
      summary: this.buildMatchingSummary(params.match),
      metadata: {
        scoringVersion: SCORING_VERSION,
        timestamp: nowISO(),
        passThreshold: this.matchingPassThreshold,
        algorithmicMatch: {
          score: params.match.score,
          weightedScore: params.match.weightedScore,
          rank: params.match.rank,
          scores: params.match.scores,
          algorithmsUsed: params.match.algorithmsUsed,
          processingTimeSeconds: params.match.processingTimeSeconds,
          serviceVersion: params.match.serviceVersion,
          missingConstraints,
        },
      },
    };
  }

  private async tryGetExistingResult(params: {
    userId: string;
    candidateId: string;
    jobId: string;
  }): Promise<any | null> {
    let lastKey: Record<string, any> | undefined = undefined;
    const MAX_PAGES = 6;
    const PAGE_SIZE = 25;

    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await this.client.send(
        new QueryCommand({
          TableName: this.scoringHistoryTable,
          IndexName: 'user_id-index',
          KeyConditionExpression: 'user_id = :uid',
          FilterExpression: 'candidate_id = :cid AND job_id = :jid',
          ExpressionAttributeValues: {
            ':uid': { S: params.userId },
            ':cid': { S: params.candidateId },
            ':jid': { S: params.jobId },
          },
          ScanIndexForward: false,
          Limit: PAGE_SIZE,
          ExclusiveStartKey: lastKey,
          ProjectionExpression: 'result_json',
        }),
      );

      const hit = (data.Items || [])[0];
      const raw = hit?.result_json?.S;
      if (raw?.trim()) {
        const parsed = safeParseJson(raw);
        if (
          parsed &&
          typeof parsed === 'object' &&
          parsed.metadata?.scoringVersion === SCORING_VERSION
        ) {
          return parsed;
        }
      }

      lastKey = data.LastEvaluatedKey;
      if (!lastKey) break;
    }

    return null;
  }

  async scoreCvAgainstJobProfile(params: {
    userId: string;
    candidateId: string; // CV id
    jobId: string; // JobProfile id
  }): Promise<any> {
    if (!params.userId?.trim()) throw new BadRequestException('userId missing');
    if (!params.candidateId?.trim()) throw new BadRequestException('candidateId is required');
    if (!params.jobId?.trim()) throw new BadRequestException('jobId is required');

    // If already scored, return previous result (idempotent by user_id + candidate_id + job_id).
    try {
      const existing = await this.tryGetExistingResult({
        userId: params.userId,
        candidateId: params.candidateId,
        jobId: params.jobId,
      });
      if (existing) {
        existing.candidateId = params.candidateId;
        existing.jobId = params.jobId;
        return existing;
      }
    } catch {
      // ignore (missing table/index, etc.)
    }

    // 1) Load CV structured_data
    const cvRes = await this.client.send(
      new GetItemCommand({
        TableName: this.userCvTable,
        Key: {
          user_id: { S: params.userId },
          id: { S: params.candidateId },
        },
        ProjectionExpression: 'user_id, id, structured_data, raw_text',
      }),
    );
    if (!cvRes.Item) throw new NotFoundException('CV not found');
    const structuredRaw = cvRes.Item.structured_data?.S || '';
    const structuredData = safeParseJson(structuredRaw);
    if (!structuredData || typeof structuredData !== 'object') {
      throw new BadRequestException('CV structured_data is missing or invalid JSON');
    }
    const cvRawText = cvRes.Item.raw_text?.S || '';

    // 2) Load JP ai_profile_ui_json (labeled) and unwrap to raw for scoring
    const jpRes = await this.client.send(
      new GetItemCommand({
        TableName: this.jobProfileTable,
        Key: { id: { S: params.jobId } },
        ProjectionExpression: 'id, ai_profile_ui_json, ai_extras_json, title, keywords, raw_jd_text, description, requirements',
      }),
    );
    if (!jpRes.Item) throw new NotFoundException('Job profile not found');
    const aiUiRaw = jpRes.Item.ai_profile_ui_json?.S || '';
    const aiUiJson = safeParseJson(aiUiRaw);
    if (!aiUiJson || typeof aiUiJson !== 'object') {
      throw new BadRequestException('JobProfile ai_profile_ui_json is missing or invalid JSON');
    }
    const aiProfileJson = unwrapLabeledJson(aiUiJson);
    const aiExtrasRaw = jpRes.Item.ai_extras_json?.S || '';
    const aiExtrasUi = safeParseJson(aiExtrasRaw);
    const aiExtrasJson =
      aiExtrasUi && typeof aiExtrasUi === 'object' ? unwrapLabeledJson(aiExtrasUi) : {};
    const structuredRequirements = mergeStructuredJobRequirements(
      extractStructuredJobRequirements(aiExtrasJson),
      extractStructuredJobRequirements(aiProfileJson),
    );
    const jpRawText = [
      buildStructuredJobHints(structuredRequirements),
      jpRes.Item.raw_jd_text?.S,
      jpRes.Item.description?.S,
      jpRes.Item.requirements?.S,
    ]
      .map((x) => String(x || '').trim())
      .filter(Boolean)
      .join('\n\n');
    const algorithmicMatch = await this.tryGetAlgorithmicMatch({
      candidateCv: structuredData,
      jobProfile: aiProfileJson,
      requirements: structuredRequirements,
      candidateText: cvRawText,
      jobText: jpRawText,
      candidateId: params.candidateId,
      jobId: params.jobId,
    });

    if (!algorithmicMatch) {
      throw new ServiceUnavailableException(
        'Resume matching service is unavailable or returned an invalid result',
      );
    }

    const out = this.buildMatchingOnlyOutput({
      candidateId: params.candidateId,
      jobId: params.jobId,
      match: algorithmicMatch,
    });

    // Persist history (best-effort; do not block response)
    try {
      const id = uuidv4();
      const createdAt = nowISO();
      await this.client.send(
        new PutItemCommand({
          TableName: this.scoringHistoryTable,
          Item: {
            id: { S: id },
            user_id: { S: params.userId },
            candidate_id: { S: params.candidateId },
            job_id: { S: params.jobId },
            pair_key: { S: `${params.candidateId}#${params.jobId}` },
            decision: { S: String(out.decision || '') },
            percentage: { N: String(out.score?.percentage ?? 0) },
            created_at: { S: createdAt },
            // Keep full result for replay/debug/FE render
            result_json: { S: JSON.stringify(out) },
          },
        }),
      );
    } catch {
      // ignore
    }

    return out;
  }
}

