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
  ScanCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import 'dotenv/config';
import { nowISO } from '../../utils';
import { CreateJobCategoryDto } from './dto/create-job-category.dto';
import { UpdateJobCategoryDto } from './dto/update-job-category.dto';
import { JobCategory, ListJobCategoriesResult } from './job-category.types';
import { createDynamoDBClient } from '../../config/dynamodb-client';
import { databaseConfig } from '../../config/database.config';

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
export class JobCategoryService {
  private client: DynamoDBClient;
  private tableName: string;

  constructor() {
    this.client = createDynamoDBClient();
    this.tableName = databaseConfig.tables.jobCategories;
  }

  private toDomain(item: Record<string, any>): JobCategory {
    return {
      id: item.id?.S || '',
      name: item.name?.S || '',
      description: item.description?.S || '',
      createdAt: item.created_at?.S || '',
      updatedAt: item.updated_at?.S || '',
    };
  }

  async create(dto: CreateJobCategoryDto): Promise<JobCategory> {
    if (!dto?.name?.trim()) throw new BadRequestException('name is required');
    const id = uuidv4();
    const now = nowISO();

    const name = dto.name.trim();
    const description = (dto.description || '').trim();
    const searchText = normalizeText([name, description].join(' '));

    await this.client.send(
      new PutItemCommand({
        TableName: this.tableName,
        Item: {
          id: { S: id },
          name: { S: name },
          description: { S: description },
          created_at: { S: now },
          updated_at: { S: now },
          search_text: { S: searchText },
        },
      }),
    );

    return { id, name, description, createdAt: now, updatedAt: now };
  }

  async getById(id: string): Promise<JobCategory> {
    if (!id?.trim()) throw new BadRequestException('id is required');
    const data = await this.client.send(
      new GetItemCommand({
        TableName: this.tableName,
        Key: { id: { S: id } },
      }),
    );
    if (!data.Item) throw new NotFoundException('Category not found');
    return this.toDomain(data.Item);
  }

  async update(id: string, dto: UpdateJobCategoryDto): Promise<JobCategory> {
    if (!id?.trim()) throw new BadRequestException('id is required');
    if (!dto || Object.keys(dto).length === 0) {
      throw new BadRequestException('update body is required');
    }

    const existing = await this.getById(id);
    const name = dto.name !== undefined ? dto.name.trim() : existing.name;
    const description =
      dto.description !== undefined ? (dto.description || '').trim() : existing.description;
    if (!name) throw new BadRequestException('name is required');

    const now = nowISO();
    const searchText = normalizeText([name, description].join(' '));

    await this.client.send(
      new UpdateItemCommand({
        TableName: this.tableName,
        Key: { id: { S: id } },
        UpdateExpression: 'SET #name = :name, description = :description, updated_at = :updatedAt, search_text = :searchText',
        ExpressionAttributeNames: { '#name': 'name' },
        ExpressionAttributeValues: {
          ':name': { S: name },
          ':description': { S: description },
          ':updatedAt': { S: now },
          ':searchText': { S: searchText },
        },
      }),
    );

    return this.getById(id);
  }

  async remove(id: string): Promise<{ message: string }> {
    if (!id?.trim()) throw new BadRequestException('id is required');
    await this.getById(id);
    await this.client.send(
      new DeleteItemCommand({
        TableName: this.tableName,
        Key: { id: { S: id } },
      }),
    );
    return { message: 'Deleted' };
  }

  async list(params: { limit?: number; cursor?: string; q?: string }): Promise<ListJobCategoriesResult> {
    const limit = Math.min(Math.max(Number(params.limit || 50), 1), 100);
    const cursor = params.cursor ? decodeCursor(params.cursor) : undefined;
    const q = params.q?.trim();

    const scanParams: any = {
      TableName: this.tableName,
      Limit: limit,
      ExclusiveStartKey: cursor,
    };

    if (q) {
      scanParams.FilterExpression = 'contains(search_text, :q)';
      scanParams.ExpressionAttributeValues = { ':q': { S: normalizeText(q) } };
    }

    const data = await this.client.send(new ScanCommand(scanParams));
    const items = (data.Items || []).map((it) => this.toDomain(it));
    items.sort((a, b) => a.name.localeCompare(b.name));

    return {
      items,
      nextCursor: data.LastEvaluatedKey ? encodeCursor(data.LastEvaluatedKey) : undefined,
    };
  }
}

