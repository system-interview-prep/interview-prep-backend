import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { nowISO } from '../../utils';
import { AiProviderService } from '../ai/ai-provider.service';
import { SessionsService } from '../sessions/sessions.service';
import { INTERVIEW_QUESTIONS_SYSTEM_PROMPT } from './interview-questions.prompt';
import { OPENING_MESSAGE_SYSTEM_PROMPT } from './opening-message.prompt';
import { unwrapLabeledJson } from '../../utils/labeled-json.util';
import { createDynamoDBClient } from '../../config/dynamodb-client';

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
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

@Injectable()
export class InterviewQuestionsService {
  private client: DynamoDBClient;
  private plansTable: string;
  private questionsTable: string;
  private userCvTable: string;
  private jobProfileTable: string;

  constructor(
    private readonly ai: AiProviderService,
    private readonly sessions: SessionsService,
  ) {
    this.client = createDynamoDBClient();
    this.plansTable = process.env.DYNAMO_INTERVIEW_QUESTION_PLANS_TABLE || 'InterviewQuestionPlans';
    this.questionsTable = process.env.DYNAMO_INTERVIEW_QUESTIONS_TABLE || 'InterviewQuestions';
    this.userCvTable = process.env.DYNAMO_USER_CV_TABLE || 'UserCvs';
    this.jobProfileTable = process.env.DYNAMO_JOB_PROFILE_TABLE || 'JobProfiles';
  }

  async getExistingPlan(params: { userId: string; sessionId: string }) {
    const data = await this.client.send(
      new GetItemCommand({
        TableName: this.plansTable,
        Key: { session_id: { S: params.sessionId } },
      }),
    );
    const item = data.Item;
    if (!item) return null;
    if (item.user_id?.S !== params.userId) return null;
    const raw = item.plan_json?.S || '';
    const plan = safeParseJson(raw);
    const activeRaw = item.active_question_order?.N;
    const activeQuestionOrder =
      activeRaw !== undefined && activeRaw !== ''
        ? Math.max(1, Math.floor(Number(activeRaw)))
        : 1;

    return {
      sessionId: item.session_id?.S || params.sessionId,
      candidateId: item.candidate_id?.S || '',
      jobId: item.job_id?.S || '',
      language: item.language?.S || 'Vietnamese',
      createdAt: item.created_at?.S || '',
      version: item.version?.S || '1.0',
      openingText: item.opening_text?.S || null,
      activeQuestionOrder,
      plan,
    };
  }

  /** Single source of truth for which bank question is currently being discussed. */
  async getActiveQuestionOrder(params: { userId: string; sessionId: string }): Promise<number> {
    const plan = await this.getExistingPlan(params);
    if (!plan) return 1;
    return plan.activeQuestionOrder ?? 1;
  }

  async setActiveQuestionOrder(params: {
    userId: string;
    sessionId: string;
    order: number;
  }): Promise<void> {
    const o = Math.max(1, Math.floor(params.order));
    await this.client.send(
      new UpdateItemCommand({
        TableName: this.plansTable,
        Key: { session_id: { S: params.sessionId } },
        UpdateExpression: 'SET active_question_order = :o, updated_at = :u',
        ConditionExpression: 'user_id = :uid',
        ExpressionAttributeValues: {
          ':o': { N: String(o) },
          ':u': { S: nowISO() },
          ':uid': { S: params.userId },
        },
      }),
    );
  }

  /** Default active_question_order to 1 when missing (older plans / first opening). */
  async ensureActiveQuestionOrderDefault(params: {
    userId: string;
    sessionId: string;
  }): Promise<void> {
    try {
      await this.client.send(
        new UpdateItemCommand({
          TableName: this.plansTable,
          Key: { session_id: { S: params.sessionId } },
          UpdateExpression:
            'SET active_question_order = if_not_exists(active_question_order, :one), updated_at = :u',
          ConditionExpression: 'user_id = :uid',
          ExpressionAttributeValues: {
            ':one': { N: '1' },
            ':u': { S: nowISO() },
            ':uid': { S: params.userId },
          },
        }),
      );
    } catch {
      /* ignore */
    }
  }

  private extractCandidateNameFromStructuredData(structuredData: any): string | null {
    const name =
      structuredData?.basics?.name ??
      structuredData?.basic?.name ??
      structuredData?.profile?.name;
    const s = typeof name === 'string' ? name.trim() : '';
    return s.length ? s : null;
  }

  async getOpeningMessage(params: { userId: string; sessionId: string }) {
    const plan = await this.getExistingPlan(params);
    if (!plan) throw new NotFoundException('Question plan not found (generate first)');
    if (plan.openingText?.trim()) {
      return { openingText: plan.openingText };
    }

    const questions = await this.listQuestions({ sessionId: params.sessionId, limit: 200 });
    const first = [...questions].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))[0];
    if (!first?.question_text?.trim()) {
      throw new NotFoundException('Question #1 not found');
    }

    // Load CV structured_data to get candidate name (optional)
    const cvRes = await this.client.send(
      new GetItemCommand({
        TableName: this.userCvTable,
        Key: { user_id: { S: params.userId }, id: { S: plan.candidateId } },
        ProjectionExpression: 'structured_data',
      }),
    );
    const structuredData = safeParseJson(cvRes.Item?.structured_data?.S || '') || null;
    const candidateName = structuredData ? this.extractCandidateNameFromStructuredData(structuredData) : null;

    // Load JP title for context
    const jpRes = await this.client.send(
      new GetItemCommand({
        TableName: this.jobProfileTable,
        Key: { id: { S: plan.jobId } },
        ProjectionExpression: 'title',
      }),
    );
    const jobTitle = jpRes.Item?.title?.S?.trim() || '';

    const payload = {
      candidateName,
      jobTitle,
      firstQuestion: first.question_text,
    };

    const raw = await this.ai.converseWithSystem({
      systemPrompts: [OPENING_MESSAGE_SYSTEM_PROMPT],
      userText: JSON.stringify(payload),
      maxTokens: 512,
    });
    const jsonCandidate = extractJsonCandidate(raw);
    const parsed = safeParseJson(jsonCandidate);
    const openingText = String(parsed?.opening_text || '').trim();
    if (!openingText) {
      // Fallback (no extra AI call): simple template
      const who = candidateName ? `Chào ${candidateName},` : 'Chào bạn,';
      const role = jobTitle ? ` hôm nay anh sẽ phỏng vấn em cho vị trí ${jobTitle}.` : ' hôm nay anh sẽ phỏng vấn em.';
      const question = ` ${first.question_text}`;
      return { openingText: `${who}${role}${question}`.trim() };
    }

    // Persist for later (best-effort)
    try {
      await this.client.send(
        new UpdateItemCommand({
          TableName: this.plansTable,
          Key: { session_id: { S: params.sessionId } },
          UpdateExpression: 'SET opening_text = :t, updated_at = :u',
          ConditionExpression: 'user_id = :uid',
          ExpressionAttributeValues: {
            ':t': { S: openingText },
            ':u': { S: nowISO() },
            ':uid': { S: params.userId },
          },
        }),
      );
    } catch {
      /* ignore */
    }

    return { openingText };
  }

  async listQuestions(params: { sessionId: string; limit?: number }) {
    const lim = Math.min(Math.max(params.limit ?? 200, 1), 500);
    const data = await this.client.send(
      new QueryCommand({
        TableName: this.questionsTable,
        IndexName: 'session_id-index',
        KeyConditionExpression: 'session_id = :sid',
        ExpressionAttributeValues: { ':sid': { S: params.sessionId } },
        Limit: lim,
        ScanIndexForward: true,
      }),
    );
    return (data.Items || []).map((it) => ({
      id: it.id?.S || '',
      order:
        it.order_num?.N !== undefined
          ? Number(it.order_num.N || 0)
          : Number(it.order?.S ? parseInt(it.order.S, 10) : 0),
      stage: it.stage?.S || '',
      category: it.category?.S || '',
      difficulty: it.difficulty?.S || '',
      question_text: it.question_text?.S || '',
      expected_signals: (it.expected_signals?.L || [])
        .map((x: any) => x.S)
        .filter(Boolean),
      source_refs: safeParseJson(it.source_refs_json?.S || '') || { cv: [], jp: [] },
      created_at: it.created_at?.S || '',
    }));
  }

  /**
   * Get a single question by its order (1-based) for a session.
   * Uses GSI session_id-index (PK=session_id, SK=order as zero-padded string).
   */
  async getQuestionByOrder(params: { sessionId: string; order: number }) {
    const ord = Math.max(1, Math.floor(params.order));
    const orderKey = String(ord).padStart(4, '0');
    const data = await this.client.send(
      new QueryCommand({
        TableName: this.questionsTable,
        IndexName: 'session_id-index',
        KeyConditionExpression: 'session_id = :sid AND #ord = :ord',
        ExpressionAttributeNames: { '#ord': 'order' },
        ExpressionAttributeValues: {
          ':sid': { S: params.sessionId },
          ':ord': { S: orderKey },
        },
        Limit: 1,
        ScanIndexForward: true,
      }),
    );
    const it = (data.Items || [])[0];
    if (!it) return null;
    return {
      id: it.id?.S || '',
      order:
        it.order_num?.N !== undefined
          ? Number(it.order_num.N || 0)
          : Number(it.order?.S ? parseInt(it.order.S, 10) : 0),
      stage: it.stage?.S || '',
      category: it.category?.S || '',
      difficulty: it.difficulty?.S || '',
      question_text: it.question_text?.S || '',
      expected_signals: (it.expected_signals?.L || [])
        .map((x: any) => x.S)
        .filter(Boolean),
      source_refs: safeParseJson(it.source_refs_json?.S || '') || { cv: [], jp: [] },
      created_at: it.created_at?.S || '',
    };
  }

  async generate(params: {
    userId: string;
    sessionId: string;
    candidateId: string;
    jobId: string;
    language?: string;
    totalQuestions?: number;
    force?: boolean;
  }) {
    const sessionType = await this.sessions.getType({
      userId: params.userId,
      sessionId: params.sessionId,
    });
    if (!sessionType) throw new NotFoundException('Session not found');

    if (!params.force) {
      const existing = await this.getExistingPlan({
        userId: params.userId,
        sessionId: params.sessionId,
      });
      if (existing) {
        const questions = await this.listQuestions({ sessionId: params.sessionId, limit: 500 });
        return { plan: existing.plan, questions };
      }
    }

    // Load CV structured_data
    const cvRes = await this.client.send(
      new GetItemCommand({
        TableName: this.userCvTable,
        Key: { user_id: { S: params.userId }, id: { S: params.candidateId } },
        ProjectionExpression: 'user_id, id, structured_data, #st',
        ExpressionAttributeNames: { '#st': 'status' },
      }),
    );
    if (!cvRes.Item) throw new NotFoundException('CV not found');
    const structuredData = safeParseJson(cvRes.Item.structured_data?.S || '');
    if (!structuredData || typeof structuredData !== 'object') {
      throw new BadRequestException('CV structured_data is missing or invalid JSON');
    }

    // Load JP ai_profile_ui_json (labeled) and unwrap to raw for prompts
    const jpRes = await this.client.send(
      new GetItemCommand({
        TableName: this.jobProfileTable,
        Key: { id: { S: params.jobId } },
        ProjectionExpression: 'id, ai_profile_ui_json, title',
      }),
    );
    if (!jpRes.Item) throw new NotFoundException('Job profile not found');
    const aiUiJson = safeParseJson(jpRes.Item.ai_profile_ui_json?.S || '');
    if (!aiUiJson || typeof aiUiJson !== 'object') {
      throw new BadRequestException('JobProfile ai_profile_ui_json is missing or invalid JSON');
    }
    const aiProfileJson = unwrapLabeledJson(aiUiJson);

    const total = Math.min(Math.max(params.totalQuestions ?? 20, 10), 35);
    const language = params.language || 'Vietnamese';
    const schemaHint = {
      plan: {
        sessionId: params.sessionId,
        candidateId: params.candidateId,
        jobId: params.jobId,
        language,
        stages: [],
      },
      questions: [],
    };

    const userPayload = {
      sessionId: params.sessionId,
      candidateId: params.candidateId,
      jobId: params.jobId,
      language,
      totalQuestions: total,
      jobProfile: aiProfileJson,
      candidateCv: structuredData,
      output_schema_example: schemaHint,
    };

    const MAX_ATTEMPTS = 3;
    let lastRaw = '';
    let parsed: any | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const extraStrict =
        attempt === 1
          ? ''
          : `ATTEMPT_${attempt}: Output was invalid/truncated JSON. Return ONLY one complete JSON object.`;

      lastRaw = await this.ai.converseWithSystem({
        systemPrompts: [
          INTERVIEW_QUESTIONS_SYSTEM_PROMPT,
          extraStrict,
        ].filter(Boolean),
        userText: JSON.stringify(userPayload),
        maxTokens: 4096,
      });

      const jsonCandidate = extractJsonCandidate(lastRaw);
      parsed = safeParseJson(jsonCandidate);
      if (parsed && typeof parsed === 'object') break;
    }

    if (!parsed || typeof parsed !== 'object') {
      return { error: 'MODEL_OUTPUT_NOT_JSON', raw: lastRaw };
    }

    const out: any = parsed;
    out.plan = out.plan || {};
    out.plan.sessionId = params.sessionId;
    out.plan.candidateId = params.candidateId;
    out.plan.jobId = params.jobId;
    out.plan.language = language;

    const createdAt = nowISO();
    const version = '1.0';

    // Save plan (overwrite)
    await this.client.send(
      new PutItemCommand({
        TableName: this.plansTable,
        Item: {
          session_id: { S: params.sessionId },
          user_id: { S: params.userId },
          candidate_id: { S: params.candidateId },
          job_id: { S: params.jobId },
          language: { S: language },
          version: { S: version },
          created_at: { S: createdAt },
          active_question_order: { N: '1' },
          plan_json: { S: JSON.stringify(out.plan) },
        },
      }),
    );

    // Save questions
    const questions: any[] = Array.isArray(out.questions) ? out.questions : [];
    const saved: any[] = [];
    for (const q of questions) {
      const id = uuidv4();
      const orderNum = Number(q.order || 0);
      const orderKey = String(Math.max(0, orderNum)).padStart(4, '0'); // for GSI sort key (String)
      const stage = String(q.stage || '').trim();
      const category = String(q.category || '').trim();
      const difficulty = String(q.difficulty || '').trim();
      const questionText = String(q.question_text || '').trim();
      if (!questionText) continue;

      const expectedSignals = Array.isArray(q.expected_signals)
        ? q.expected_signals.map((x: any) => String(x || '').trim()).filter(Boolean).slice(0, 6)
        : [];
      const sourceRefs =
        q.source_refs && typeof q.source_refs === 'object'
          ? q.source_refs
          : { cv: [], jp: [] };

      await this.client.send(
        new PutItemCommand({
          TableName: this.questionsTable,
          Item: {
            id: { S: id },
            session_id: { S: params.sessionId },
            // Your DynamoDB GSI session_id-index uses `order` as SortKey (String),
            // so store a zero-padded string to keep correct ordering.
            order: { S: orderKey },
            order_num: { N: String(orderNum) },
            stage: { S: stage },
            category: { S: category },
            difficulty: { S: difficulty },
            question_text: { S: questionText },
            expected_signals: { L: expectedSignals.map((s) => ({ S: s })) },
            source_refs_json: { S: JSON.stringify(sourceRefs) },
            created_at: { S: createdAt },
          },
        }),
      );

      saved.push({
        id,
        order: orderNum,
        stage,
        category,
        difficulty,
        question_text: questionText,
        expected_signals: expectedSignals,
        source_refs: sourceRefs,
        created_at: createdAt,
      });
    }

    return { plan: out.plan, questions: saved };
  }
}

