import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import {
  DeleteItemCommand,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  TransactionCanceledException,
  TransactWriteItemsCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import 'dotenv/config';
import { v4 as uuidv4 } from 'uuid';
import { nowISO } from '../../utils';
import { S3Util } from '../../utils/s3.util';
import { RabbitMqUtil } from '../../utils/rabbitmq.util';
import { CvProcessingStatus, UserCv } from './user-cv.types';
import { createDynamoDBClient } from '../../config/dynamodb-client';
import { databaseConfig } from '../../config/database.config';
import { rabbitMqConfig } from '../../config/rabbitmq.config';

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/png',
  'image/jpeg',
  'image/webp',
];

const ALLOWED_EXTENSIONS = /\.(pdf|doc|docx|png|jpg|jpeg|webp)$/i;

@Injectable()
export class UserCvService {
  private readonly logger = new Logger(UserCvService.name);
  private client: DynamoDBClient;
  private tableName: string;
  /** Set via DYNAMO_USER_CV_DEDUPE_TABLE; empty = dedupe disabled (no second table). */
  private dedupeTableName: string;
  private readonly dedupeEnabled: boolean;
  private s3: S3Util;
  private queue: RabbitMqUtil;

  constructor() {
    this.client = createDynamoDBClient();
    this.tableName = databaseConfig.tables.userCvs;
    this.dedupeTableName = databaseConfig.tables.userCvDedupe;
    this.dedupeEnabled = this.dedupeTableName.length > 0;
    if (!this.dedupeEnabled) {
      this.logger.log(
        'DYNAMO_USER_CV_DEDUPE_TABLE is empty: CV upload uses UserCvs only (create dedupe table + set env for atomic same-file dedupe).',
      );
    }
    this.s3 = new S3Util();
    this.queue = new RabbitMqUtil(rabbitMqConfig.queues.cv);
  }

  private normalizeStatus(raw: string | undefined, hasError: boolean): CvProcessingStatus {
    const upper = String(raw || '')
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, '_');

    if (['DONE', 'SUCCESS', 'COMPLETED'].includes(upper)) return 'DONE';
    if (
      [
        'FAILED',
        'FAIL',
        'ERROR',
        'AI_FAILED',
        'PARSING_FAILED',
        'TIMEOUT',
      ].includes(upper)
    ) {
      return 'FAILED';
    }
    if (['AI_PROCESSING', 'AI', 'ANALYZING', 'ANALYSIS'].includes(upper)) return 'AI_PROCESSING';
    if (['PARSING', 'OCR', 'EXTRACTING', 'PROCESSING'].includes(upper)) return 'PARSING';
    if (['PENDING', 'QUEUED', 'QUEUE'].includes(upper)) return 'PENDING';
    return hasError ? 'FAILED' : 'PENDING';
  }

  private toDomain(item: Record<string, any>): UserCv {
    const error = item.error?.S ?? null;
    const statusRaw = item.status?.S || item.processing_status?.S;
    return {
      id: item.id?.S || '',
      userId: item.user_id?.S || '',
      checksum: item.checksum?.S || '',
      filename: item.filename?.S || '',
      contentType: item.content_type?.S || '',
      size: Number(item.size?.N || 0),
      s3Key: item.s3_key?.S || '',
      url: item.url?.S || '',
      createdAt: item.created_at?.S || '',
      updatedAt: item.updated_at?.S || item.created_at?.S || '',
      status: this.normalizeStatus(statusRaw, Boolean(error)),
      score:
        item.score?.N !== undefined
          ? Number(item.score.N) === -1
            ? null
            : Number(item.score.N)
          : null,
      error,
      parseSource: item.parse_source?.S ?? null,
      rawText: item.raw_text?.S ?? null,
    };
  }

  private async findByChecksum(userId: string, checksum: string): Promise<UserCv | null> {
    const data = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'user_id = :uid',
        FilterExpression: 'checksum = :c',
        ConsistentRead: true,
        ExpressionAttributeValues: {
          ':uid': { S: userId },
          ':c': { S: checksum },
        },
        Limit: 1,
      }),
    );
    const item = data.Items?.[0];
    return item ? this.toDomain(item) : null;
  }

  private async getDedupeCvId(userId: string, checksum: string): Promise<string | null> {
    const data = await this.client.send(
      new GetItemCommand({
        TableName: this.dedupeTableName,
        Key: {
          user_id: { S: userId },
          checksum: { S: checksum },
        },
        ProjectionExpression: 'cv_id',
      }),
    );
    return data.Item?.cv_id?.S ?? null;
  }

  async upload(userId: string, file: Express.Multer.File): Promise<UserCv> {
    if (!userId?.trim()) throw new BadRequestException('userId is required');
    if (!file) throw new BadRequestException('file is required');
    if (!file.buffer?.length) throw new BadRequestException('file is empty');

    // MIME type & extension validation
    const mimeValid = ALLOWED_MIME_TYPES.includes(file.mimetype);
    const extValid = ALLOWED_EXTENSIONS.test(file.originalname || '');
    if (!mimeValid && !extValid) {
      throw new BadRequestException(
        'Invalid file type. Only PDF, DOC, DOCX, PNG, JPEG, and WEBP files are allowed.',
      );
    }

    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    const existing = await this.findByChecksum(userId, checksum);
    if (existing) {
      return existing;
    }

    const id = uuidv4();
    const createdAt = nowISO();
    const updatedAt = createdAt;
    const status: CvProcessingStatus = 'PENDING';

    const key = this.s3.buildCvKey(userId, id, file.originalname);
    const uploaded = await this.s3.uploadBuffer({
      key,
      buffer: file.buffer,
      contentType: file.mimetype,
    });

    const cvItem = {
      user_id: { S: userId },
      id: { S: id },
      checksum: { S: checksum },
      filename: { S: file.originalname || '' },
      content_type: { S: file.mimetype || 'application/octet-stream' },
      size: { N: String(file.size || file.buffer.length) },
      s3_key: { S: uploaded.key },
      url: { S: uploaded.url },
      created_at: { S: createdAt },
      updated_at: { S: updatedAt },
      status: { S: status },
    };

    if (this.dedupeEnabled) {
      try {
        await this.client.send(
          new TransactWriteItemsCommand({
            TransactItems: [
              {
                Put: {
                  TableName: this.tableName,
                  Item: cvItem,
                },
              },
              {
                Put: {
                  TableName: this.dedupeTableName,
                  Item: {
                    user_id: { S: userId },
                    checksum: { S: checksum },
                    cv_id: { S: id },
                    created_at: { S: createdAt },
                  },
                  ConditionExpression: 'attribute_not_exists(checksum)',
                },
              },
            ],
          }),
        );
      } catch (e: unknown) {
        const reasons =
          e instanceof TransactionCanceledException
            ? (e.CancellationReasons ?? [])
            : [];
        const conditionalFailed = reasons.some(
          (r) => r.Code === 'ConditionalCheckFailed',
        );
        if (e instanceof TransactionCanceledException && conditionalFailed) {
          try {
            await this.s3.deleteObject(uploaded.key);
          } catch (s3Err: any) {
            this.logger.error(
              `Failed to delete orphaned S3 object ${uploaded.key} during dedupe rollback: ${s3Err?.message || s3Err}`,
            );
          }
          const existingId = await this.getDedupeCvId(userId, checksum);
          if (existingId) return this.get(userId, existingId);
          const fb = await this.findByChecksum(userId, checksum);
          if (fb) return fb;
        }
        throw e;
      }
    } else {
      await this.client.send(
        new PutItemCommand({
          TableName: this.tableName,
          Item: cvItem,
        }),
      );
    }

    const created: UserCv = {
      id,
      userId,
      checksum,
      filename: file.originalname || '',
      contentType: file.mimetype || 'application/octet-stream',
      size: file.size || file.buffer.length,
      s3Key: uploaded.key,
      url: uploaded.url,
      createdAt,
      updatedAt,
      status,
      score: null,
      error: null,
    };

    try {
      await this.queue.sendJson({
        userId,
        cvId: id,
        s3Key: uploaded.key,
        contentType: created.contentType,
        filename: created.filename,
      });
      this.logger.log(`CV ${id} enqueued to RabbitMQ for user ${userId}`);
    } catch (e: any) {
      const msg = e?.message || String(e);
      this.logger.error(`RabbitMQ publish failed for CV ${id}: ${msg}`);
      await this.updateProcessing({
        userId,
        cvId: id,
        error: `enqueue_failed: ${msg}`,
      });
      throw new InternalServerErrorException(
        'CV đã lưu nhưng không gửi được hàng đợi xử lý RabbitMQ.',
      );
    }

    return created;
  }

  async updateProcessing(params: {
    userId: string;
    cvId: string;
    status?: CvProcessingStatus;
    score?: number | null;
    rawText?: string | null;
    parseSource?: string | null;
    structuredData?: Record<string, any> | null;
    error?: string | null;
  }): Promise<void> {
    const updatedAt = nowISO();
    const names: Record<string, string> = {};
    const values: Record<string, any> = { ':updatedAt': { S: updatedAt } };
    const sets: string[] = ['updated_at = :updatedAt'];

    if (params.status) {
      values[':status'] = { S: params.status };
      sets.push('#status = :status');
      names['#status'] = 'status';
    }
    if (params.score !== undefined) {
      // store score as number; if null then set to -1 to represent "unset"
      values[':score'] = { N: String(params.score === null ? -1 : params.score) };
      sets.push('score = :score');
    }
    if (params.rawText !== undefined) {
      values[':rawText'] = { S: String(params.rawText || '') };
      sets.push('raw_text = :rawText');
    }
    if (params.parseSource !== undefined) {
      values[':parseSource'] = { S: String(params.parseSource || '') };
      sets.push('parse_source = :parseSource');
    }
    if (params.structuredData !== undefined) {
      values[':structuredData'] = { S: JSON.stringify(params.structuredData || {}) };
      sets.push('structured_data = :structuredData');
    }
    if (params.error !== undefined) {
      values[':errVal'] = { S: String(params.error || '') };
      sets.push('#err = :errVal');
      names['#err'] = 'error';
    }

    // Chỉ update bản ghi đã tạo từ upload (có s3_key). Tránh UpdateItem tạo "ghost row"
    // khi user_id/cvId lệch hoặc message RabbitMQ cũ.
    await this.client.send(
      new UpdateItemCommand({
        TableName: this.tableName,
        Key: {
          user_id: { S: params.userId },
          id: { S: params.cvId },
        },
        UpdateExpression: `SET ${sets.join(', ')}`,
        ConditionExpression: 'attribute_exists(s3_key)',
        ExpressionAttributeNames: Object.keys(names).length ? names : undefined,
        ExpressionAttributeValues: values,
      }),
    );
  }

  async list(
    userId: string,
    limit = 50,
    cursor?: string,
  ): Promise<{ items: UserCv[]; nextToken?: string }> {
    if (!userId?.trim()) throw new BadRequestException('userId is required');
    const lim = Math.min(Math.max(Number(limit || 50), 1), 100);

    let exclusiveStartKey: Record<string, any> | undefined = undefined;
    if (cursor?.trim()) {
      try {
        exclusiveStartKey = JSON.parse(
          Buffer.from(cursor.trim(), 'base64').toString('utf-8'),
        );
      } catch {
        throw new BadRequestException('Invalid pagination cursor');
      }
    }

    const data = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'user_id = :uid',
        ConsistentRead: true,
        ExpressionAttributeValues: {
          ':uid': { S: userId },
        },
        Limit: lim,
        ScanIndexForward: false,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );

    let nextToken: string | undefined = undefined;
    if (data.LastEvaluatedKey) {
      nextToken = Buffer.from(JSON.stringify(data.LastEvaluatedKey)).toString('base64');
    }

    return {
      items: (data.Items || []).map((it) => this.toDomain(it)),
      nextToken,
    };
  }

  async get(userId: string, id: string): Promise<UserCv> {
    if (!userId?.trim()) throw new BadRequestException('userId is required');
    if (!id?.trim()) throw new BadRequestException('id is required');

    const data = await this.client.send(
      new GetItemCommand({
        TableName: this.tableName,
        ConsistentRead: true,
        Key: {
          user_id: { S: userId },
          id: { S: id },
        },
      }),
    );

    if (!data.Item) throw new NotFoundException('CV not found');
    return this.toDomain(data.Item);
  }

  async remove(userId: string, id: string): Promise<{ message: string }> {
    const cv = await this.get(userId, id);

    // Best-effort S3 delete with logging
    try {
      if (cv.s3Key) await this.s3.deleteObject(cv.s3Key);
    } catch (s3Err: any) {
      this.logger.warn(
        `Failed to delete S3 object ${cv.s3Key} for CV ${id}: ${s3Err?.message || s3Err}`,
      );
    }

    await this.client.send(
      new DeleteItemCommand({
        TableName: this.tableName,
        Key: {
          user_id: { S: userId },
          id: { S: id },
        },
      }),
    );

    if (this.dedupeEnabled && cv.checksum) {
      try {
        await this.client.send(
          new DeleteItemCommand({
            TableName: this.dedupeTableName,
            Key: {
              user_id: { S: userId },
              checksum: { S: cv.checksum },
            },
          }),
        );
      } catch (dedupeErr: any) {
        this.logger.warn(
          `Failed to delete dedupe record for checksum ${cv.checksum}: ${dedupeErr?.message || dedupeErr}`,
        );
      }
    }

    return { message: 'Deleted' };
  }

  async downloadCvBuffer(
    userId: string,
    id: string,
  ): Promise<{ filename: string; contentType: string; buffer: Buffer }> {
    const cv = await this.get(userId, id);
    if (!cv.s3Key) {
      throw new NotFoundException('CV file storage path missing');
    }
    const buffer = await this.s3.getObjectBuffer(cv.s3Key);
    return {
      filename: cv.filename,
      contentType: cv.contentType || 'application/pdf',
      buffer,
    };
  }
}
