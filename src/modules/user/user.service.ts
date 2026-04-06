import { Injectable } from '@nestjs/common';
import { DynamoDBClient, PutItemCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import * as dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

@Injectable()
export class UserService {
  private client: DynamoDBClient;
  private tableName: string;

  constructor() {
    this.client = new DynamoDBClient({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      },
    });
    // Trỏ đến bảng mới hoặc giữ biến môi trường nếu đã cập nhật .env
    this.tableName = process.env.DYNAMO_USER_TABLE || 'Users';
  }

  async createUser(dto: Record<string, any>): Promise<any> {
    const id = uuidv4();
    const now = new Date().toISOString();
    const item: Record<string, any> = {
      PK: { S: `USER#${dto.email.toLowerCase()}` },
      id: { S: id },
      email: { S: dto.email.toLowerCase() },
      name: { S: dto.name || '' },
      role: { S: dto.role || 'CANDIDATE' },
      provider: { S: dto.provider || 'local' },
      created_at: { S: now },
    };

    if (dto.password) {
      item.password = { S: dto.password };
    }
    if (dto.dob) {
      item.dob = { S: dto.dob };
    }

    await this.client.send(new PutItemCommand({
      TableName: this.tableName,
      Item: item,
    }));

    return {
      id,
      email: dto.email.toLowerCase(),
      name: dto.name,
      role: dto.role || 'CANDIDATE',
    };
  }

  async findByEmail(email: string): Promise<any> {
    const data = await this.client.send(new GetItemCommand({
      TableName: this.tableName,
      Key: {
        PK: { S: `USER#${email.toLowerCase()}` }
      }
    }));

    if (!data.Item) {
      return null;
    }

    const item = data.Item;
    return {
      id: item.id?.S,
      email: item.email?.S,
      password: item.password?.S,
      name: item.name?.S,
      role: item.role?.S,
      provider: item.provider?.S,
    };
  }

  async getProfile(userId: string): Promise<Record<string, any>> {
    // Left for token-based profile lookup if needed later
    return { userId, name: 'Placeholder User', email: 'placeholder@example.com' };
  }

  async updateProfile(
    userId: string,
    updateDto: Record<string, any>,
  ): Promise<{ message: string }> {
    console.log('updateProfile', userId, updateDto);
    return { message: 'Profile updated (placeholder)' };
  }
}
