import 'dotenv/config';
import axios from 'axios';
import { S3Util } from '../../utils/s3.util';
import { RabbitMqUtil } from '../../utils/rabbitmq.util';
import { guessFileType, parseDocument } from '../shared/document-parser';
import { JobProfileService } from '../../modules/job-profile/job-profile.service';
import { AiProviderService } from '../../modules/ai/ai-provider.service';
import { JobCategoryService } from '../../modules/job-category/job-category.service';
import type { JpUploadStatus } from '../../modules/job-profile/job-profile.types';
import { rabbitMqConfig } from '../../config/rabbitmq.config';

type JpQueueMessage = {
  userId: string;
  uploadId: string;
  s3Key: string;
  contentType?: string;
  filename?: string;
};

const QUEUE_TAG = '[JP pipeline][queue]';
const PIPELINE_TIMEOUT_MS = Math.max(1_000, Number(process.env.JP_PIPELINE_TIMEOUT_MS || 45_000));
const PIPELINE_WARN_AT_MS = Math.floor(PIPELINE_TIMEOUT_MS * 0.7);
const AI_STEP_TIMEOUT_MS = Math.max(1_000, Number(process.env.JP_AI_TIMEOUT_MS || 15_000));

function withTimeout<T>(work: () => Promise<T>, uploadId: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const warnTimer = setTimeout(() => {
      console.warn(`${QUEUE_TAG} slow_warning`, {
        uploadId,
        elapsedMs: PIPELINE_WARN_AT_MS,
        timeoutMs: PIPELINE_TIMEOUT_MS,
      });
    }, PIPELINE_WARN_AT_MS);

    const timeoutTimer = setTimeout(() => {
      const err = new Error(`JP_PROCESSING_TIMEOUT:${PIPELINE_TIMEOUT_MS}ms`);
      (err as any).code = 'JP_PROCESSING_TIMEOUT';
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

async function withAiStepTimeout<T>(work: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(`JP_AI_STEP_TIMEOUT:${AI_STEP_TIMEOUT_MS}ms`);
      (err as any).code = 'JP_AI_STEP_TIMEOUT';
      reject(err);
    }, AI_STEP_TIMEOUT_MS);

    work()
      .then((value) => resolve(value))
      .catch((error) => reject(error))
      .finally(() => clearTimeout(timer));
  });
}

function sanitizeStatusPayload(
  uploadId: string,
  status: JpUploadStatus,
  extra?: Partial<{
    parseSource: string;
    error: string;
    receiveCount: number;
  }>,
) {
  return {
    uploadId,
    status,
    ...(extra?.parseSource ? { parseSource: extra.parseSource } : {}),
    ...(extra?.error ? { error: extra.error } : {}),
    ...(extra?.receiveCount !== undefined ? { receiveCount: extra.receiveCount } : {}),
    updatedAt: new Date().toISOString(),
  };
}

async function broadcast(uploadId: string, payload: Record<string, any>) {
  const apiBase = process.env.API_BASE_URL || 'http://localhost:5000';
  const secret = process.env.WORKER_SECRET || '';
  if (!secret) return;
  try {
    await axios.post(
      `${apiBase}/internal/jp-events/status`,
      { uploadId, payload },
      { headers: { 'x-worker-secret': secret } },
    );
  } catch (e: any) {
    console.warn(`${QUEUE_TAG} broadcast failed`, {
      uploadId,
      message: e?.message || String(e),
      status: payload.status,
    });
  }
}

function validateRawTextForJd(rawText: string): void {
  const text = String(rawText || '').trim();

  if (text.length < 120) {
    const err = new Error('JD_TEXT_TOO_SHORT');
    (err as any).code = 'JD_TEXT_TOO_SHORT';
    throw err;
  }
}

async function setStatus(params: {
  svc: JobProfileService;
  msg: JpQueueMessage;
  status: JpUploadStatus;
  extra?: Partial<{
    rawText: string;
    parseSource: string;
    canonicalUi: Record<string, any>;
    extras: Record<string, any>;
    description: string;
    error: string;
    receiveCount: number;
  }>;
}) {
  await params.svc.updateJpUploadProcessing({
    userId: params.msg.userId,
    uploadId: params.msg.uploadId,
    status: params.status,
    rawText: params.extra?.rawText,
    parseSource: params.extra?.parseSource,
    description: params.extra?.description,
    aiExtrasJson: params.extra?.extras,
    aiProfileUiJson: params.extra?.canonicalUi,
    error: params.extra?.error,
  });
  await broadcast(
    params.msg.uploadId,
    sanitizeStatusPayload(params.msg.uploadId, params.status, params.extra),
  );
}

async function processOne(msg: JpQueueMessage) {
  await withTimeout(async () => {
    const s3 = new S3Util();
    const ai = new AiProviderService();
    const svc = new JobProfileService(new JobCategoryService(), ai);

    // --- Worker 1: Parse raw text from file ---
    const buffer = await s3.getObjectBuffer(msg.s3Key);
    const fileType = guessFileType(msg);
    const { rawText, parseSource } = await parseDocument(buffer, fileType);
    
    validateRawTextForJd(rawText);

    await setStatus({
      svc,
      msg,
      status: 'PARSING',
      extra: { rawText, parseSource },
    });

    // --- Worker 2: AI parse canonical + extras ---
    await setStatus({ svc, msg, status: 'AI_PROCESSING', extra: { rawText, parseSource } });
    const res = await withAiStepTimeout(() =>
      ai.generateJobProfileCanonicalAndExtras({
        jobId: msg.uploadId,
        rawText,
      }),
    );
    if ((res as any).error) {
      const err = String((res as any).error || 'AI_PARSE_FAILED');
      await setStatus({
        svc,
        msg,
        status: 'FAILED',
        extra: { rawText, parseSource, error: err },
      });
      return;
    }

    const { canonicalUi, extras } = res as any;

    // --- Worker 3: Generate candidate-facing description preview ---
    let description = '';
    try {
      const titleFromUi = String((canonicalUi as any)?.title?.value ?? '').trim();
      const title = titleFromUi || msg.filename || 'Job';
      const aiDesc = await withAiStepTimeout(() =>
        ai.generateJobDescriptionFromProfileUi({
          title,
          canonicalUi: canonicalUi || {},
          extras: extras || {},
        }),
      );
      if ((aiDesc as any)?.description && String((aiDesc as any).description).trim()) {
        description = String((aiDesc as any).description).trim();
      }
    } catch {
      // ignore: keep fallback
    }
    if (!description) {
      const titleFromUi = String((canonicalUi as any)?.title?.value ?? '').trim();
      const title = titleFromUi || msg.filename || 'Job';
      description =
        `**Vị trí / Tổng quan**\n` +
        `- ${title}\n\n` +
        `**Nội dung JD (trích xuất)**\n` +
        `${String(rawText || '').trim().slice(0, 4000)}`;
    }

    // Remove markdown headings if model returned them (we store plain Markdown without # headings).
    description = String(description || '').replace(/^\s*#{1,6}\s*/gm, '').trim();

    await setStatus({
      svc,
      msg,
      status: 'DONE',
      extra: { rawText, parseSource, extras, canonicalUi, description },
    });
  }, msg.uploadId);
}

async function main() {
  const rabbit = new RabbitMqUtil(rabbitMqConfig.queues.jobProfile);
  console.log(`${QUEUE_TAG} worker started`, {
    queue: rabbitMqConfig.queues.jobProfile,
    maxAttempts: rabbitMqConfig.maxAttempts,
  });

  await rabbit.consumeJson<JpQueueMessage>(async (body, context) => {
    const { raw, receiveCount } = context;
    try {
      if (!body?.userId || !body?.uploadId || !body?.s3Key) {
        throw new Error('Invalid message body');
      }

      console.log(`${QUEUE_TAG} message:received`, {
        uploadId: body.uploadId,
        userId: body.userId,
        receiveCount,
        s3Key: body.s3Key,
      });
      await processOne(body);
      console.log(`${QUEUE_TAG} message:acked`, { uploadId: body.uploadId });
    } catch (e: any) {
      const rawErr = String(e?.message || e);
      const isFinal = receiveCount >= rabbitMqConfig.maxAttempts;
      console.error(`${QUEUE_TAG} message:error`, {
        uploadId: body?.uploadId,
        receiveCount,
        error: rawErr,
      });

      if (!isFinal) {
        await rabbit.retry(raw, receiveCount, rawErr);
        console.warn(`${QUEUE_TAG} message:scheduled_retry`, {
          uploadId: body?.uploadId,
          receiveCount,
          retryDelayMs: rabbitMqConfig.retryDelayMs,
        });
        return;
      }

      if (body?.userId && body?.uploadId) {
        try {
          const svc = new JobProfileService(
            new JobCategoryService(),
            new AiProviderService(),
          );
          await svc.updateJpUploadProcessing({
            userId: body.userId,
            uploadId: body.uploadId,
            status: 'FAILED',
            error: `[receiveCount=${receiveCount}] ${rawErr}`,
          });
          await broadcast(
            body.uploadId,
            sanitizeStatusPayload(body.uploadId, 'FAILED', {
              error: rawErr,
              receiveCount,
            }),
          );
        } catch {}
      }
      await rabbit.deadLetter(raw, receiveCount, rawErr);
      console.log(`${QUEUE_TAG} message:dead_lettered`, {
        uploadId: body?.uploadId,
      });
    }
  });
}

main().catch((e) => {
  console.error(`${QUEUE_TAG} fatal`, e);
  process.exit(1);
});

