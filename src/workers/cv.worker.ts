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
  await broadcast(
    msg.cvId,
    { cvId: msg.cvId, status, ...extra, updatedAt: new Date().toISOString() },
    L,
  );
}

/**
 * Pipeline: W1 parse → W2 AI JSON → W3 score heuristic → DONE (câu hỏi phỏng vấn lưu bảng khác sau)
 */
async function processOne(msg: CvQueueMessage) {
  const L = createPipelineLogger(msg.cvId);
  L.info('job:START', {
    userId: msg.userId,
    s3Key: msg.s3Key,
    filename: msg.filename,
    contentType: msg.contentType,
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

  await setStatus(userCv, msg, 'PARSING', L, {
    rawText,
    parseSource,
  });

  // --- Worker 2 ---
  await setStatus(userCv, msg, 'AI_PROCESSING', L, { rawText, parseSource });
  const structuredData = await L.time('W2:bedrock:generateCvJson', () =>
    ai.generateCvJson(rawText || ''),
  );

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
    const msg = res.Messages?.[0];
    if (!msg) continue;

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
      const err = String(e?.message || e);
      console.error(`${QUEUE_TAG} message:error`, {
        cvId: body?.cvId,
        receiveCount,
        error: err,
      });

      if (body?.userId && body?.cvId && receiveCount >= 3) {
        const userCv = new UserCvService();
        const L = createPipelineLogger(body.cvId);
        L.error('job:FAILED_FINAL', { receiveCount, message: err });
        try {
          await userCv.updateProcessing({
            userId: body.userId,
            cvId: body.cvId,
            status: 'FAILED',
            error: `[receiveCount=${receiveCount}] ${err}`,
          });
        } catch (persistErr: any) {
          // Thường gặp: không có bản ghi UserCvs (hoặc thiếu s3_key) — cùng lỗi với job chính.
          // Không throw: vẫn broadcast + xóa message để worker không crash / không lặp vô hạn.
          L.warn('job:FAILED_FINAL:dynamo_skip', {
            reason: persistErr?.name || String(persistErr?.message || persistErr),
            hint: 'Kiểm tra user_id+cvId trong Dynamo và field s3_key; message SQS có thể stale.',
          });
        }
        await broadcast(
          body.cvId,
          { cvId: body.cvId, status: 'FAILED', error: err, receiveCount },
          L,
        );
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

main().catch((e) => {
  console.error(`${QUEUE_TAG} fatal`, e);
  process.exit(1);
});
