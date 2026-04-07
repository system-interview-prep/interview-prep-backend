import {
  BadRequestException,
  Injectable,
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
import { CreateJobProfileDto } from './dto/create-job-profile.dto';
import { UpdateJobProfileDto } from './dto/update-job-profile.dto';
import { JobProfile, ListJobProfilesResult } from './job-profile.types';
import { JobCategoryService } from '../job-category/job-category.service';
import { AiProviderService } from '../ai/ai-provider.service';

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

@Injectable()
export class JobProfileService {
  private client: DynamoDBClient;
  private tableName: string;
  private jobCategoryService: JobCategoryService;
  private aiService: AiProviderService;

  constructor() {
    this.client = new DynamoDBClient({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      },
    });
    this.tableName = process.env.DYNAMO_JOB_PROFILE_TABLE || 'JobProfiles';
    this.jobCategoryService = new JobCategoryService();
    this.aiService = new AiProviderService();
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
      status: (item.status?.S || 'ACTIVE') as any,
      createdAt: item.created_at?.S || '',
      updatedAt: item.updated_at?.S || '',
    };
  }

  private buildSearchText(dto: {
    title: string;
    categoryId: string;
    keywords: string[];
    description?: string;
    requirements?: string;
  }): string {
    const parts = [
      dto.title,
      dto.categoryId,
      ...(dto.keywords || []),
      dto.description || '',
      dto.requirements || '',
    ];
    return normalizeText(parts.join(' '));
  }

  async create(dto: CreateJobProfileDto): Promise<JobProfile> {
    if (!dto?.title?.trim()) throw new BadRequestException('title is required');
    if (!dto?.categoryId?.trim()) throw new BadRequestException('categoryId is required');

    const id = uuidv4();
    const now = nowISO();
    const createdAtEpoch = Date.parse(now);

    const keywords = (dto.keywords || [])
      .map(normalizeKeyword)
      .filter(Boolean)
      .slice(0, 50);

    const title = dto.title.trim();
    const categoryId = dto.categoryId.trim();
    const description = (dto.description || '').trim();
    const requirements = (dto.requirements || '').trim();
    const status = (dto.status || 'ACTIVE').toUpperCase();

    if (!['ACTIVE', 'DRAFT', 'ARCHIVED'].includes(status)) {
      throw new BadRequestException('status must be ACTIVE, DRAFT, or ARCHIVED');
    }

    const searchText = this.buildSearchText({
      title,
      categoryId,
      keywords,
      description,
      requirements,
    });

    // validate category exists
    await this.jobCategoryService.getById(categoryId);

    await this.client.send(
      new PutItemCommand({
        TableName: this.tableName,
        Item: {
          id: { S: id },
          title: { S: title },
          category_id: { S: categoryId },
          keywords: { L: keywords.map((k) => ({ S: k })) },
          description: { S: description },
          requirements: { S: requirements },
          status: { S: status },
          created_at: { S: now },
          updated_at: { S: now },
          created_at_epoch: { N: String(createdAtEpoch) },
          updated_at_epoch: { N: String(createdAtEpoch) },

          // GSI for list/sort by date (all)
          gsi1pk: { S: 'JOBPROFILE' },
          // IMPORTANT: the deployed GSI expects String sort key
          gsi1sk: { S: now },

          // GSI for list/sort by date within category
          gsi2pk: { S: `CATEGORY#${categoryId}` },
          // IMPORTANT: the deployed GSI expects String sort key
          gsi2sk: { S: now },

          // simple search support (Scan + contains)
          search_text: { S: searchText },
        },
      }),
    );

    const created: JobProfile = {
      id,
      title,
      categoryId,
      keywords,
      description,
      requirements,
      status: status as any,
      createdAt: now,
      updatedAt: now,
    };

    // Fire-and-forget AI enrichment: do NOT affect create flow.
    setImmediate(() => {
      this.enrichWithAiJson(created).catch(() => {
        // swallow errors intentionally to keep create path stable
      });
    });

    return created;
  }

  private async enrichWithAiJson(job: JobProfile): Promise<void> {
    const aiJson = await this.aiService.generateJobProfileJson({
      jobId: job.id,
      title: job.title,
      categoryId: job.categoryId,
      keywords: job.keywords,
      description: job.description,
      requirements: job.requirements,
      createdAt: job.createdAt,
    });

    const now = nowISO();
    await this.client.send(
      new UpdateItemCommand({
        TableName: this.tableName,
        Key: { id: { S: job.id } },
        UpdateExpression:
          'SET ai_profile_json = :aiJson, ai_profile_version = :ver, ai_generated_at = :genAt, updated_at = :updatedAt',
        ExpressionAttributeValues: {
          ':aiJson': { S: JSON.stringify(aiJson) },
          ':ver': { S: '1.0' },
          ':genAt': { S: now },
          ':updatedAt': { S: now },
        },
      }),
    );
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

  async update(id: string, dto: UpdateJobProfileDto): Promise<JobProfile> {
    if (!id?.trim()) throw new BadRequestException('id is required');
    if (!dto || Object.keys(dto).length === 0) {
      throw new BadRequestException('update body is required');
    }

    const existing = await this.getById(id);

    const title = dto.title !== undefined ? dto.title.trim() : existing.title;
    const categoryId =
      dto.categoryId !== undefined ? dto.categoryId.trim() : existing.categoryId;
    const keywords =
      dto.keywords !== undefined
        ? dto.keywords.map(normalizeKeyword).filter(Boolean).slice(0, 50)
        : existing.keywords;
    const description =
      dto.description !== undefined ? (dto.description || '').trim() : existing.description;
    const requirements =
      dto.requirements !== undefined ? (dto.requirements || '').trim() : existing.requirements;
    const status =
      dto.status !== undefined ? String(dto.status).toUpperCase() : existing.status;

    if (!title) throw new BadRequestException('title is required');
    if (!categoryId) throw new BadRequestException('categoryId is required');
    if (!['ACTIVE', 'DRAFT', 'ARCHIVED'].includes(status)) {
      throw new BadRequestException('status must be ACTIVE, DRAFT, or ARCHIVED');
    }

    const now = nowISO();
    const updatedAtEpoch = Date.parse(now);
    const searchText = this.buildSearchText({
      title,
      categoryId,
      keywords,
      description,
      requirements,
    });

    // validate category exists
    await this.jobCategoryService.getById(categoryId);

    await this.client.send(
      new UpdateItemCommand({
        TableName: this.tableName,
        Key: { id: { S: id } },
        UpdateExpression:
          'SET title = :title, category_id = :categoryId, keywords = :keywords, description = :description, requirements = :requirements, #status = :status, updated_at = :updatedAt, updated_at_epoch = :updatedAtEpoch, gsi2pk = :gsi2pk, search_text = :searchText',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':title': { S: title },
          ':categoryId': { S: categoryId },
          ':keywords': { L: keywords.map((k) => ({ S: k })) },
          ':description': { S: description },
          ':requirements': { S: requirements },
          ':status': { S: status },
          ':updatedAt': { S: now },
          ':updatedAtEpoch': { N: String(updatedAtEpoch) },
          ':gsi2pk': { S: `CATEGORY#${categoryId}` },
          ':searchText': { S: searchText },
        },
      }),
    );

    return this.getById(id);
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

