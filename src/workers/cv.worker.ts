import 'dotenv/config';
import axios from 'axios';
import { AiProviderService } from '../modules/ai/ai-provider.service';
import { UserCvService } from '../modules/user-cv/user-cv.service';
import { S3Util } from '../utils/s3.util';
import { SqsUtil } from '../utils/sqs.util';
import { CvProcessingStatus } from '../modules/user-cv/user-cv.types';
import { guessFileType, worker1ParseCv } from './cv-parse.worker1';
import { createPipelineLogger } from './cv-pipeline.logger';

type CvQueueMessage = {
  userId: string;
  cvId: string;
  s3Key: string;
  contentType?: string;
  filename?: string;
};

const QUEUE_TAG = '[CV pipeline][queue]';
const PIPELINE_TIMEOUT_MS = Math.max(1_000, Number(process.env.CV_PIPELINE_TIMEOUT_MS || 30_000));
const PIPELINE_WARN_AT_MS = Math.floor(PIPELINE_TIMEOUT_MS * 0.7);
const AI_STEP_TIMEOUT_MS = Math.max(1_000, Number(process.env.CV_AI_TIMEOUT_MS || 12_000));

function withTimeout<T>(work: () => Promise<T>, cvId: string, L: ReturnType<typeof createPipelineLogger>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const warnTimer = setTimeout(() => {
      L.warn('job:slow_warning', {
        cvId,
        elapsedMs: PIPELINE_WARN_AT_MS,
        timeoutMs: PIPELINE_TIMEOUT_MS,
      });
    }, PIPELINE_WARN_AT_MS);

    const timeoutTimer = setTimeout(() => {
      const err = new Error(`CV_PROCESSING_TIMEOUT:${PIPELINE_TIMEOUT_MS}ms`);
      (err as any).code = 'CV_PROCESSING_TIMEOUT';
      reject(err);
    }, PIPELINE_TIMEOUT_MS);

    work()
      .then((value) => resolve(value))
      .catch((error) => reject(error))
      .finally(() => {
        clearTimeout(warnTimer);
        clearTimeout(timeoutTimer);
      });
  });
}

function sanitizeStatusPayload(
  cvId: string,
  status: CvProcessingStatus,
  extra?: Partial<{
    parseSource: string;
    score: number;
    error: string;
    receiveCount: number;
  }>,
) {
  return {
    cvId,
    status,
    ...(extra?.parseSource ? { parseSource: extra.parseSource } : {}),
    ...(extra?.score !== undefined ? { score: extra.score } : {}),
    ...(extra?.error ? { error: extra.error } : {}),
    ...(extra?.receiveCount !== undefined ? { receiveCount: extra.receiveCount } : {}),
    updatedAt: new Date().toISOString(),
  };
}

function ensureStructuredDataValid(structuredData: Record<string, any>): void {
  if (!structuredData || typeof structuredData !== 'object' || Array.isArray(structuredData)) {
    const err = new Error('AI_STRUCTURED_DATA_INVALID');
    (err as any).code = 'AI_STRUCTURED_DATA_INVALID';
    throw err;
  }
  const rawError = typeof structuredData.error === 'string' ? structuredData.error.trim() : '';
  if (rawError) {
    const err = new Error('AI_STRUCTURED_DATA_INVALID');
    (err as any).code = 'AI_STRUCTURED_DATA_INVALID';
    throw err;
  }
}

function validateRawTextForCv(rawText: string): void {
  const text = String(rawText || '').trim();
  const lower = text.toLowerCase();

  if (text.length < 120) {
    const err = new Error('CV_TEXT_TOO_SHORT');
    (err as any).code = 'CV_TEXT_TOO_SHORT';
    throw err;
  }

  const transcriptHints = [
    'bang diem',
    'bảng điểm',
    'transcript',
    'gpa',
    'course code',
    'semester',
    'credit',
    'tín chỉ',
    'môn học',
    'điểm môn',
  ];
  const cvHints = [
    'experience',
    'kinh nghiệm',
    'project',
    'dự án',
    'skill',
    'kỹ năng',
    'objective',
    'mục tiêu',
    'work history',
    'employment',
    'intern',
    'portfolio',
  ];

  const hasTranscriptHint = transcriptHints.some((k) => lower.includes(k));
  const hasCvHint = cvHints.some((k) => lower.includes(k));

  if (hasTranscriptHint && !hasCvHint) {
    const err = new Error('CV_CONTENT_NOT_RESUME');
    (err as any).code = 'CV_CONTENT_NOT_RESUME';
    throw err;
  }
}

async function withAiStepTimeout<T>(work: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(`CV_AI_STEP_TIMEOUT:${AI_STEP_TIMEOUT_MS}ms`);
      (err as any).code = 'CV_AI_STEP_TIMEOUT';
      reject(err);
    }, AI_STEP_TIMEOUT_MS);

    work()
      .then((value) => resolve(value))
      .catch((error) => reject(error))
      .finally(() => clearTimeout(timer));
  });
}

function shouldFailFast(errCode: string, rawErr: string): boolean {
  const code = String(errCode || '').toUpperCase();
  const raw = String(rawErr || '').toUpperCase();
  if (code === 'CV_PROCESSING_TIMEOUT' || code === 'AI_STRUCTURED_DATA_INVALID') return true;
  if (code === 'CV_AI_STEP_TIMEOUT' || code === 'CV_CONTENT_NOT_RESUME' || code === 'CV_TEXT_TOO_SHORT') return true;
  if (raw.includes('CV_PROCESSING_TIMEOUT') || raw.includes('AI_STRUCTURED_DATA_INVALID')) return true;
  if (raw.includes('CV_AI_STEP_TIMEOUT') || raw.includes('CV_CONTENT_NOT_RESUME') || raw.includes('CV_TEXT_TOO_SHORT')) return true;
  if (raw.includes('MODEL_OUTPUT_NOT_JSON') || raw.includes('MODEL_OUTPUT_NOT_OBJECT')) return true;
  return false;
}

async function persistFailedAndBroadcast(params: {
  body: CvQueueMessage;
  receiveCount: number;
  err: string;
}) {
  const userCv = new UserCvService();
  const L = createPipelineLogger(params.body.cvId);
  L.error('job:FAILED_FINAL', { receiveCount: params.receiveCount, message: params.err });
  try {
    await userCv.updateProcessing({
      userId: params.body.userId,
      cvId: params.body.cvId,
      status: 'FAILED',
      error: `[receiveCount=${params.receiveCount}] ${params.err}`,
    });
  } catch (persistErr: any) {
    L.warn('job:FAILED_FINAL:dynamo_skip', {
      reason: persistErr?.name || String(persistErr?.message || persistErr),
      hint: 'Kiểm tra user_id+cvId trong Dynamo và field s3_key; message SQS có thể stale.',
    });
  }
  await broadcast(
    params.body.cvId,
    sanitizeStatusPayload(params.body.cvId, 'FAILED', {
      error: params.err,
      receiveCount: params.receiveCount,
    }),
    L,
  );
}

async function broadcast(
  cvId: string,
  payload: Record<string, any>,
  L: ReturnType<typeof createPipelineLogger>,
) {
  const apiBase = process.env.API_BASE_URL || 'http://localhost:5000';
  const secret = process.env.WORKER_SECRET || '';
  if (!secret) {
    L.warn('socket:broadcast:skip', { reason: 'WORKER_SECRET empty' });
    return;
  }
  try {
    await axios.post(
      `${apiBase}/internal/cv-events/status`,
      { cvId, payload },
      { headers: { 'x-worker-secret': secret } },
    );
    L.info('socket:broadcast:ok', { status: payload.status });
  } catch (e: any) {
    L.warn('socket:broadcast:fail', {
      message: e?.message || String(e),
      status: payload.status,
    });
  }
}

async function setStatus(
  userCv: UserCvService,
  msg: CvQueueMessage,
  status: CvProcessingStatus,
  L: ReturnType<typeof createPipelineLogger>,
  extra?: Partial<{
    rawText: string;
    parseSource: string;
    structuredData: any;
    score: number;
    error: string;
  }>,
) {
  const meta: Record<string, unknown> = { status };
  if (extra?.rawText !== undefined) {
    meta.rawTextChars = String(extra.rawText).length;
  }
  if (extra?.parseSource) meta.parseSource = extra.parseSource;
  if (extra?.score !== undefined) meta.score = extra.score;
  if (extra?.structuredData) meta.structuredDataKeys = Object.keys(extra.structuredData || {}).length;

  L.info('dynamo:update', meta);

  await userCv.updateProcessing({
    userId: msg.userId,
    cvId: msg.cvId,
    status,
    rawText: extra?.rawText,
    parseSource: extra?.parseSource,
    structuredData: extra?.structuredData,
    score: extra?.score,
    error: extra?.error,
  });
  await broadcast(msg.cvId, sanitizeStatusPayload(msg.cvId, status, extra), L);
}

/**
 * Pipeline: W1 parse → W2 AI JSON → W3 score heuristic → DONE (câu hỏi phỏng vấn lưu bảng khác sau)
 */
async function processOne(msg: CvQueueMessage) {
  const L = createPipelineLogger(msg.cvId);
  await withTimeout(
    async () => {
      L.info('job:START', {
        userId: msg.userId,
        s3Key: msg.s3Key,
        filename: msg.filename,
        contentType: msg.contentType,
        timeoutMs: PIPELINE_TIMEOUT_MS,
      });

      const userCv = new UserCvService();
      const s3 = new S3Util();
      const ai = new AiProviderService();

      // --- Worker 1 ---
      const buffer = await L.time('W1:s3:GetObject', () => s3.getObjectBuffer(msg.s3Key), {
        s3Key: msg.s3Key,
      });
      const fileType = guessFileType(msg);
      L.info('W1:detect_type', { fileType });

      const { rawText, parseSource } = await L.time('W1:parse', () =>
        worker1ParseCv(buffer, fileType, L),
      );

      validateRawTextForCv(rawText);

      await setStatus(userCv, msg, 'PARSING', L, {
        rawText,
        parseSource,
      });

      // --- Worker 2 ---
      await setStatus(userCv, msg, 'AI_PROCESSING', L, { rawText, parseSource });
      const structuredData = await L.time('W2:bedrock:generateCvJson', () =>
        withAiStepTimeout(() => ai.generateCvJson(rawText || '')),
      );
      ensureStructuredDataValid(structuredData);

      const blob = JSON.stringify(structuredData || {});
      const score = Math.min(
        100,
        Math.max(0, Math.round((blob.length ? Math.min(blob.length, 5000) / 5000 : 0) * 100)),
      );
      L.info('W3:match_score', { score, jsonBlobChars: blob.length });

      await setStatus(userCv, msg, 'DONE', L, {
        score,
        structuredData,
        rawText,
        parseSource,
      });

      L.info('job:DONE', { score });
    },
    msg.cvId,
    L,
  );
}

async function main() {
  const queueUrl = process.env.SQS_CV_QUEUE_URL;
  if (!queueUrl) {
    console.error(`${QUEUE_TAG} SQS_CV_QUEUE_URL is not configured`);
    process.exit(1);
  }

  const sqs = new SqsUtil();
  console.log(`${QUEUE_TAG} worker started`, { queueUrl });

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await sqs.receive(queueUrl, 20, 180);
    const messages = res.Messages || [];
    if (messages.length === 0) continue;

    for (const msg of messages) {
      const receiptHandle = msg.ReceiptHandle!;
      const receiveCount = Number(msg.Attributes?.ApproximateReceiveCount || 1);

      let body: CvQueueMessage | null = null;
      try {
        body = JSON.parse(msg.Body || '{}');
        if (!body?.userId || !body?.cvId || !body?.s3Key) {
          throw new Error('Invalid message body');
        }

        console.log(`${QUEUE_TAG} message:received`, {
          cvId: body.cvId,
          userId: body.userId,
          receiveCount,
          s3Key: body.s3Key,
        });

        await processOne(body);

        console.log(`${QUEUE_TAG} message:deleted`, { cvId: body.cvId });
        await sqs.delete(queueUrl, receiptHandle);
      } catch (e: any) {
        const rawErr = String(e?.message || e);
        const errCode = String(e?.code || '').trim();
        const err = errCode || rawErr;
        const failFast = shouldFailFast(errCode, rawErr);
        console.error(`${QUEUE_TAG} message:error`, {
          cvId: body?.cvId,
          receiveCount,
          error: err,
          failFast,
        });

        if (body?.userId && body?.cvId && (failFast || receiveCount >= 3)) {
          await persistFailedAndBroadcast({ body, receiveCount, err });
          await sqs.delete(queueUrl, receiptHandle);
          console.log(`${QUEUE_TAG} message:deleted_after_fail`, { cvId: body.cvId });
        } else if (body?.cvId) {
          console.warn(`${QUEUE_TAG} message:will_retry`, {
            cvId: body.cvId,
            receiveCount,
          });
        }
      }
    }
  }
}

main().catch((e) => {
  console.error(`${QUEUE_TAG} fatal`, e);
  process.exit(1);
});
