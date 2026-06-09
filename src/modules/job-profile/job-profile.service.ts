import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  DeleteItemCommand,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  ScanCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import 'dotenv/config';
import { nowISO } from '../../utils';
import {
  JobProfile,
  JobProfileUpload,
  JpUploadStatus,
  ListJobProfilesResult,
} from './job-profile.types';
import { JobCategoryService } from '../job-category/job-category.service';
import { AiProviderService } from '../ai/ai-provider.service';
import { S3Util } from '../../utils/s3.util';
import { SqsUtil } from '../../utils/sqs.util';
import { unwrapLabeledJson } from '../../utils/labeled-json.util';
import { createDynamoDBClient } from '../../config/dynamodb-client';

function normalizeKeyword(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function encodeCursor(lastEvaluatedKey: Record<string, any>): string {
  return Buffer.from(JSON.stringify(lastEvaluatedKey), 'utf8').toString('base64');
}

function decodeCursor(cursor: string): Record<string, any> {
  try {
    const json = Buffer.from(cursor, 'base64').toString('utf8');
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object') throw new Error('Invalid cursor');
    return parsed;
  } catch {
    throw new BadRequestException('Invalid cursor');
  }
}

function safeParseJson<T = any>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function asStringOrNull(v: any): string | null {
  const s = typeof v === 'string' ? v.trim() : String(v ?? '').trim();
  return s ? s : null;
}

function asStringArray(v: any): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === 'string' ? x.trim() : String(x ?? '').trim()))
    .filter(Boolean);
}

function section(title: string, lines: string[]): string {
  const body = (lines || []).map((l) => String(l || '').trim()).filter(Boolean);
  if (body.length === 0) return '';
  return [title, ...body.map((l) => `- ${l}`), ''].join('\n');
}

function buildJdDescriptionText(params: {
  title: string;
  canonicalUiRaw: string;
  extrasRaw?: string | null;
}): string {
  const canonicalUi = safeParseJson<Record<string, any>>(params.canonicalUiRaw) || {};
  const extrasUi = params.extrasRaw ? safeParseJson<Record<string, any>>(params.extrasRaw) : null;

  const canonical = unwrapLabeledJson(canonicalUi) || {};
  const extras = extrasUi ? unwrapLabeledJson(extrasUi) : {};

  const header: string[] = [];
  header.push(`Vị trí: ${params.title}`);

  const level = asStringOrNull((canonical as any).level);
  const seniority = asStringOrNull((canonical as any).seniority);
  const roleType = asStringOrNull((canonical as any).roleType);
  const employmentType = asStringOrNull((canonical as any).employmentType);
  const workModel = asStringOrNull((canonical as any).workModel);
  const location = asStringOrNull((canonical as any).location);
  const metaBits = [level, seniority, roleType, employmentType, workModel, location].filter(Boolean);
  if (metaBits.length) header.push(`Thông tin: ${metaBits.join(' • ')}`);

  const exp = (canonical as any).experience;
  const minY = exp?.minYears;
  const maxY = exp?.maxYears;
  const minOk = typeof minY === 'number' && Number.isFinite(minY);
  const maxOk = typeof maxY === 'number' && Number.isFinite(maxY);
  if (minOk && maxOk) header.push(`Kinh nghiệm: ${minY}–${maxY} năm`);
  else if (minOk) header.push(`Kinh nghiệm: tối thiểu ${minY} năm`);
  else if (maxOk) header.push(`Kinh nghiệm: tối đa ${maxY} năm`);

  const out: string[] = [];
  out.push(header.join('\n'), '');

  const responsibilities = asStringArray((canonical as any).responsibilities);
  const deliverables = asStringArray((canonical as any).deliverables);
  out.push(section('Mô tả công việc', responsibilities.length ? responsibilities : deliverables));

  const req = (canonical as any).requirements || {};
  const mustHave = asStringArray(req.mustHave);
  const niceToHave = asStringArray(req.niceToHave);
  if (mustHave.length || niceToHave.length) {
    const lines: string[] = [];
    if (mustHave.length) {
      lines.push('- MustHave:');
      lines.push(...mustHave.map((x) => ` + ${x}`));
    }
    if (niceToHave.length) {
      lines.push('- NiceToHave:');
      lines.push(...niceToHave.map((x) => ` + ${x}`));
    }
    out.push(['Requirements', ...lines, ''].join('\n'));
  }

  const tech = (canonical as any).techStack || {};
  const techLines: string[] = [];
  const langs = asStringArray(tech.languages);
  const frws = asStringArray(tech.frameworks);
  const tools = asStringArray(tech.tools);
  const apis = asStringArray(tech.apis);
  const plats = asStringArray(tech.platforms);
  if (langs.length) techLines.push(`Ngôn ngữ: ${langs.join(', ')}`);
  if (frws.length) techLines.push(`Framework: ${frws.join(', ')}`);
  if (tools.length) techLines.push(`Tools: ${tools.join(', ')}`);
  if (apis.length) techLines.push(`APIs: ${apis.join(', ')}`);
  if (plats.length) techLines.push(`Platforms: ${plats.join(', ')}`);
  out.push(section('Kỹ năng / Tech stack', techLines));

  out.push(
    section('Kỹ năng mềm', asStringArray((canonical as any).softSkills)),
    section('Kiến thức chuyên môn', asStringArray((canonical as any).knowledgeDomains)),
  );

  // Extras (best-effort as bullets)
  const extraLines: string[] = [];
  if (extras && typeof extras === 'object') {
    for (const [k, v] of Object.entries(extras as any)) {
      if (v === null || v === undefined) continue;
      if (typeof v === 'string') {
        const s = v.trim();
        if (s) extraLines.push(`${k}: ${s}`);
      } else if (Array.isArray(v)) {
        const xs = asStringArray(v);
        if (xs.length) extraLines.push(`${k}: ${xs.join(', ')}`);
      }
    }
  }
  out.push(section('Thông tin thêm', extraLines));

  return out.join('\n').trim();
}

async function withTimeout<T>(work: () => Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`TIMEOUT_${timeoutMs}ms`)), timeoutMs);
    work()
      .then((v) => resolve(v))
      .catch((e) => reject(e))
      .finally(() => clearTimeout(t));
  });
}

function stripMarkdownHeadings(input: string): string {
  const s = String(input || '');
  // Remove heading markers like "# ", "## ", ... at line start.
  return s.replace(/^\s*#{1,6}\s*/gm, '').trim();
}

@Injectable()
export class JobProfileService {
  private client: DynamoDBClient;
  private tableName: string;
  private jobCategoryService: JobCategoryService;
  private aiService: AiProviderService;
  private s3: S3Util;
  private sqs: SqsUtil;
  private jpQueueUrl: string;

  constructor() {
    this.client = createDynamoDBClient();
    this.tableName = process.env.DYNAMO_JOB_PROFILE_TABLE || 'JobProfiles';
    this.jobCategoryService = new JobCategoryService();
    this.aiService = new AiProviderService();
    this.s3 = new S3Util();
    this.sqs = new SqsUtil();
    this.jpQueueUrl = process.env.SQS_JP_QUEUE_URL || '';
  }

  private toDomain(item: Record<string, any>): JobProfile {
    return {
      id: item.id?.S || '',
      title: item.title?.S || '',
      // backward-compatible read: old items may still have `category` as string
      categoryId: item.category_id?.S || item.categoryId?.S || item.category?.S || '',
      keywords: (item.keywords?.L || []).map((x: any) => x.S).filter(Boolean),
      description: item.description?.S || '',
      requirements: item.requirements?.S || '',
      aiProfileUiJson: item.ai_profile_ui_json?.S ?? null,
      aiExtrasJson: item.ai_extras_json?.S ?? null,
      rawJdText: item.raw_jd_text?.S ?? null,
      status: (item.status?.S || 'ACTIVE') as any,
      createdAt: item.created_at?.S || '',
      updatedAt: item.updated_at?.S || '',
    };
  }

  // -----------------------------
  // JP Upload (JD file → rawText → AI canonical+extras)
  // -----------------------------

  private normalizeUploadStatus(raw: string | undefined, hasError: boolean): JpUploadStatus {
    const upper = String(raw || '')
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, '_');
    if (['DONE', 'SUCCESS', 'COMPLETED'].includes(upper)) return 'DONE';
    if (['FAILED', 'FAIL', 'ERROR'].includes(upper)) return 'FAILED';
    if (['AI_PROCESSING', 'AI', 'ANALYZING', 'ANALYSIS'].includes(upper))
      return 'AI_PROCESSING';
    if (['PARSING', 'OCR', 'EXTRACTING', 'PROCESSING'].includes(upper)) return 'PARSING';
    if (['PENDING', 'QUEUED', 'QUEUE'].includes(upper)) return 'PENDING';
    return hasError ? 'FAILED' : 'PENDING';
  }

  private toUploadDomain(item: Record<string, any>): JobProfileUpload {
    const error = item.error?.S ?? null;
    const statusRaw = item.status?.S;
    return {
      id: item.id?.S || '',
      userId: item.owner_user_id?.S || item.user_id?.S || '',
      filename: item.filename?.S || '',
      contentType: item.content_type?.S || '',
      size: Number(item.size?.N || 0),
      s3Key: item.s3_key?.S || '',
      url: item.url?.S || '',
      status: this.normalizeUploadStatus(statusRaw, Boolean(error)),
      parseSource: item.parse_source?.S ?? null,
      rawText: item.raw_text?.S ?? null,
      description: item.description?.S ?? null,
      aiProfileUiJson: item.ai_profile_ui_json?.S ?? null,
      aiExtrasJson: item.ai_extras_json?.S ?? null,
      error,
      createdAt: item.created_at?.S || '',
      updatedAt: item.updated_at?.S || item.created_at?.S || '',
    };
  }

  async uploadJpFile(userId: string, file: Express.Multer.File): Promise<JobProfileUpload> {
    if (!userId?.trim()) throw new BadRequestException('userId is required');
    if (!file) throw new BadRequestException('file is required');
    if (!file.buffer?.length) throw new BadRequestException('file is empty');

    const id = uuidv4();
    const createdAt = nowISO();
    const updatedAt = createdAt;
    const status: JpUploadStatus = 'PENDING';

    const key = this.s3.buildJpKey(userId, id, file.originalname);
    const uploaded = await this.s3.uploadBuffer({
      key,
      buffer: file.buffer,
      contentType: file.mimetype,
    });

    await this.client.send(
      new PutItemCommand({
        TableName: this.tableName,
        Item: {
          id: { S: id },
          item_type: { S: 'JP_UPLOAD' },
          owner_user_id: { S: userId },
          filename: { S: file.originalname || '' },
          content_type: { S: file.mimetype || 'application/octet-stream' },
          size: { N: String(file.size || file.buffer.length) },
          s3_key: { S: uploaded.key },
          url: { S: uploaded.url },
          status: { S: status },
          created_at: { S: createdAt },
          updated_at: { S: updatedAt },
        },
      }),
    );

    const created: JobProfileUpload = {
      id,
      userId,
      filename: file.originalname || '',
      contentType: file.mimetype || 'application/octet-stream',
      size: file.size || file.buffer.length,
      s3Key: uploaded.key,
      url: uploaded.url,
      status,
      createdAt,
      updatedAt,
      error: null,
    };

    if (!this.jpQueueUrl?.trim()) {
      // not fatal: keeps record for debugging
      return created;
    }

    try {
      await this.sqs.sendJson(this.jpQueueUrl, {
        userId,
        uploadId: id,
        s3Key: uploaded.key,
        contentType: created.contentType,
        filename: created.filename,
      });
    } catch (e: any) {
      const msg = e?.message || String(e);
      await this.updateJpUploadProcessing({
        userId,
        uploadId: id,
        error: `enqueue_failed: ${msg}`,
      });
      throw new InternalServerErrorException(
        'JD đã lưu nhưng không gửi được hàng đợi xử lý (SQS).',
      );
    }

    return created;
  }

  async getJpUpload(userId: string, uploadId: string): Promise<JobProfileUpload> {
    if (!userId?.trim()) throw new BadRequestException('userId is required');
    if (!uploadId?.trim()) throw new BadRequestException('uploadId is required');

    const data = await this.client.send(
      new GetItemCommand({
        TableName: this.tableName,
        Key: { id: { S: uploadId } },
      }),
    );
    if (!data.Item) throw new NotFoundException('JP upload not found');
    const upload = this.toUploadDomain(data.Item);
    if (upload.userId !== userId) throw new NotFoundException('JP upload not found');
    if ((data.Item.item_type?.S || '') !== 'JP_UPLOAD') {
      throw new NotFoundException('JP upload not found');
    }
    return upload;
  }

  async updateJpUploadProcessing(params: {
    userId: string;
    uploadId: string;
    status?: JpUploadStatus;
    rawText?: string | null;
    parseSource?: string | null;
    description?: string | null;
    aiProfileUiJson?: Record<string, any> | null;
    aiExtrasJson?: Record<string, any> | null;
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
    if (params.rawText !== undefined) {
      values[':rawText'] = { S: String(params.rawText || '') };
      sets.push('raw_text = :rawText');
    }
    if (params.parseSource !== undefined) {
      values[':parseSource'] = { S: String(params.parseSource || '') };
      sets.push('parse_source = :parseSource');
    }
    if (params.description !== undefined) {
      values[':description'] = { S: String(params.description || '') };
      sets.push('description = :description');
    }
    if (params.aiProfileUiJson !== undefined) {
      values[':aiProfileUiJson'] = { S: JSON.stringify(params.aiProfileUiJson || {}) };
      sets.push('ai_profile_ui_json = :aiProfileUiJson');
    }
    if (params.aiExtrasJson !== undefined) {
      values[':aiExtrasJson'] = { S: JSON.stringify(params.aiExtrasJson || {}) };
      sets.push('ai_extras_json = :aiExtrasJson');
    }
    if (params.error !== undefined) {
      values[':errVal'] = { S: String(params.error || '') };
      sets.push('#err = :errVal');
      names['#err'] = 'error';
    }

    await this.client.send(
      new UpdateItemCommand({
        TableName: this.tableName,
        Key: { id: { S: params.uploadId } },
        UpdateExpression: `SET ${sets.join(', ')}`,
        ConditionExpression: 'owner_user_id = :uid AND item_type = :type',
        ExpressionAttributeNames: Object.keys(names).length ? names : undefined,
        ExpressionAttributeValues: {
          ...values,
          ':uid': { S: params.userId },
          ':type': { S: 'JP_UPLOAD' },
        },
      }),
    );
  }

  async finalizeUploadToJobProfile(params: {
    userId: string;
    uploadId: string;
    title: string;
    categoryId: string;
    keywords?: string[];
    status?: 'ACTIVE' | 'DRAFT' | 'ARCHIVED';
    description?: string;
  }): Promise<{ id: string }> {
    const userId = String(params.userId || '').trim();
    if (!userId) throw new BadRequestException('userId is required');
    const uploadId = String(params.uploadId || '').trim();
    if (!uploadId) throw new BadRequestException('uploadId is required');

    const title = String(params.title || '').trim();
    const categoryId = String(params.categoryId || '').trim();
    if (!title) throw new BadRequestException('title is required');
    if (!categoryId) throw new BadRequestException('categoryId is required');

    const upload = await this.getJpUpload(userId, uploadId);
    if (upload.status !== 'DONE') {
      throw new BadRequestException('Upload is not DONE yet');
    }
    const canonicalUiRaw = String(upload.aiProfileUiJson || '').trim();
    if (!canonicalUiRaw) throw new BadRequestException('ai_profile_ui_json missing in upload');

    await this.jobCategoryService.getById(categoryId);

    const now = nowISO();
    const createdAtEpoch = Date.parse(now);
    const id = uploadId;

    const keywords = (params.keywords || [])
      .map(normalizeKeyword)
      .filter(Boolean)
      .slice(0, 50);
    const status = (params.status || 'ACTIVE').toUpperCase();
    if (!['ACTIVE', 'DRAFT', 'ARCHIVED'].includes(status)) {
      throw new BadRequestException('status must be ACTIVE, DRAFT, or ARCHIVED');
    }

    const searchText = normalizeText([title, categoryId, ...keywords, upload.rawText || ''].join(' '));
    const descriptionFallback = buildJdDescriptionText({
      title,
      canonicalUiRaw,
      extrasRaw: upload.aiExtrasJson,
    });

    // Priority: admin edited (frontend) > worker-generated upload preview > fallback
    const descriptionText = stripMarkdownHeadings(
      String(params.description || '').trim() ||
        String((upload as any).description || '').trim() ||
        descriptionFallback ||
        '',
    );

    await this.client.send(
      new UpdateItemCommand({
        TableName: this.tableName,
        Key: { id: { S: id } },
        ConditionExpression: 'owner_user_id = :uid AND item_type = :type',
        UpdateExpression:
          'SET item_type = :jobType, title = :title, category_id = :categoryId, keywords = :keywords, description = :description, requirements = :requirements, #status = :status, created_at = if_not_exists(created_at, :createdAt), updated_at = :updatedAt, created_at_epoch = if_not_exists(created_at_epoch, :createdAtEpoch), updated_at_epoch = :updatedAtEpoch, gsi1pk = :gsi1pk, gsi1sk = :gsi1sk, gsi2pk = :gsi2pk, gsi2sk = :gsi2sk, search_text = :searchText, raw_jd_text = :rawJdText, ai_profile_ui_json = :aiProfileUiJson, ai_profile_version = :aiVer, ai_generated_at = :genAt' +
          (upload.aiExtrasJson ? ', ai_extras_json = :aiExtrasJson' : ''),
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':uid': { S: userId },
          ':type': { S: 'JP_UPLOAD' },
          ':jobType': { S: 'JOBPROFILE' },
          ':title': { S: title },
          ':categoryId': { S: categoryId },
          ':keywords': { L: keywords.map((k) => ({ S: k })) },
          ':description': { S: descriptionText || '' },
          ':requirements': { S: '' },
          ':status': { S: status },
          ':createdAt': { S: now },
          ':updatedAt': { S: now },
          ':createdAtEpoch': { N: String(createdAtEpoch) },
          ':updatedAtEpoch': { N: String(createdAtEpoch) },
          ':gsi1pk': { S: 'JOBPROFILE' },
          ':gsi1sk': { S: now },
          ':gsi2pk': { S: `CATEGORY#${categoryId}` },
          ':gsi2sk': { S: now },
          ':searchText': { S: searchText },
          ':rawJdText': { S: String(upload.rawText || '') },
          ':aiProfileUiJson': { S: canonicalUiRaw },
          ':aiVer': { S: '1.0' },
          ':genAt': { S: now },
          ...(upload.aiExtrasJson ? { ':aiExtrasJson': { S: String(upload.aiExtrasJson) } } : {}),
        },
      }),
    );

    return { id };
  }

  async getById(id: string): Promise<JobProfile> {
    if (!id?.trim()) throw new BadRequestException('id is required');

    const data = await this.client.send(
      new GetItemCommand({
        TableName: this.tableName,
        Key: { id: { S: id } },
      }),
    );

    if (!data.Item) throw new NotFoundException('Job profile not found');
    return this.toDomain(data.Item);
  }

  async updateDescription(params: {
    userId: string;
    jobId: string;
    description: string;
  }): Promise<void> {
    const userId = String(params.userId || '').trim();
    if (!userId) throw new BadRequestException('userId is required');
    const jobId = String(params.jobId || '').trim();
    if (!jobId) throw new BadRequestException('jobId is required');

    const updatedAt = nowISO();
    const description = String(params.description || '').trim();

    await this.client.send(
      new UpdateItemCommand({
        TableName: this.tableName,
        Key: { id: { S: jobId } },
        ConditionExpression: 'owner_user_id = :uid AND item_type = :type',
        UpdateExpression: 'SET description = :d, updated_at = :u, updated_at_epoch = :ue',
        ExpressionAttributeValues: {
          ':uid': { S: userId },
          ':type': { S: 'JOBPROFILE' },
          ':d': { S: description },
          ':u': { S: updatedAt },
          ':ue': { N: String(Date.parse(updatedAt)) },
        },
      }),
    );
  }

  async remove(id: string): Promise<{ message: string }> {
    if (!id?.trim()) throw new BadRequestException('id is required');

    // Ensure exists for consistent 404 behavior
    await this.getById(id);

    await this.client.send(
      new DeleteItemCommand({
        TableName: this.tableName,
        Key: { id: { S: id } },
      }),
    );

    return { message: 'Deleted' };
  }

  async list(params: {
    limit?: number;
    cursor?: string;
    categoryId?: string;
    q?: string;
    order?: 'asc' | 'desc';
  }): Promise<ListJobProfilesResult> {
    const limit = Math.min(Math.max(Number(params.limit || 12), 1), 50);
    const cursor = params.cursor ? decodeCursor(params.cursor) : undefined;
    const categoryId = params.categoryId?.trim();
    const q = params.q?.trim();
    const order = (params.order || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

    // If q is present, we do a Scan with contains(search_text, ...)
    // This is a pragmatic MVP; for large datasets consider OpenSearch.
    if (q) {
      const qNorm = normalizeText(q);
      const scanParams: any = {
        TableName: this.tableName,
        Limit: limit,
        ExclusiveStartKey: cursor,
        FilterExpression: 'contains(search_text, :q)',
        ExpressionAttributeValues: { ':q': { S: qNorm } },
      };

      if (categoryId) {
        scanParams.FilterExpression += ' AND category_id = :categoryId';
        scanParams.ExpressionAttributeValues[':categoryId'] = { S: categoryId };
      }

      const data = await this.client.send(new ScanCommand(scanParams));
      const items = (data.Items || []).map((it) => this.toDomain(it));
      items.sort((a, b) =>
        order === 'asc'
          ? a.createdAt.localeCompare(b.createdAt)
          : b.createdAt.localeCompare(a.createdAt),
      );

      return {
        items,
        nextCursor: data.LastEvaluatedKey ? encodeCursor(data.LastEvaluatedKey) : undefined,
      };
    }

    // No q: use Query on GSI for efficient list + date sort.
    const useCategoryIndex = Boolean(categoryId);
    const queryParams: any = {
      TableName: this.tableName,
      IndexName: useCategoryIndex ? 'gsi2' : 'gsi1',
      KeyConditionExpression: useCategoryIndex ? 'gsi2pk = :pk' : 'gsi1pk = :pk',
      ExpressionAttributeValues: {
        ':pk': { S: useCategoryIndex ? `CATEGORY#${categoryId}` : 'JOBPROFILE' },
      },
      Limit: limit,
      ExclusiveStartKey: cursor,
      ScanIndexForward: order === 'asc',
    };

    const data = await this.client.send(new QueryCommand(queryParams));
    return {
      items: (data.Items || []).map((it) => this.toDomain(it)),
      nextCursor: data.LastEvaluatedKey ? encodeCursor(data.LastEvaluatedKey) : undefined,
    };
  }
}

