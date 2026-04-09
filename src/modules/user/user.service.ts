import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import * as dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import { S3Util } from '../../utils/s3.util';

dotenv.config();

const PROFILE_IMAGE_MIMES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'] as const;

@Injectable()
export class UserService {
  private client: DynamoDBClient;
  private tableName: string;
  private s3: S3Util;

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
    this.s3 = new S3Util();
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

    return this.mapItemToUser(data.Item);
  }

  private mapItemToUser(item: Record<string, any>): Record<string, any> {
    return {
      id: item.id?.S,
      email: item.email?.S,
      password: item.password?.S,
      name: item.name?.S,
      role: item.role?.S,
      provider: item.provider?.S,
      dob: item.dob?.S,
      picture: item.picture?.S,
      created_at: item.created_at?.S,
    };
  }

  private toPublicProfile(user: Record<string, any>): Record<string, any> {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      provider: user.provider,
      dob: user.dob,
      picture: user.picture,
      created_at: user.created_at,
    };
  }

  /** Đọc theo PK `USER#email`; xác thực `sub` trong JWT khớp `id` trong bảng */
  async getProfile(email: string, jwtSub: string): Promise<Record<string, any>> {
    const row = await this.findByEmail(email);
    if (!row || row.id !== jwtSub) {
      throw new NotFoundException('User not found');
    }
    return this.toPublicProfile(row);
  }

  async updateProfile(
    email: string,
    jwtSub: string,
    updateDto: Record<string, any>,
  ): Promise<Record<string, any>> {
    const row = await this.findByEmail(email);
    if (!row || row.id !== jwtSub) {
      throw new NotFoundException('User not found');
    }

    const allowed = ['name', 'dob'] as const;
    const updates: Record<string, string> = {};
    for (const key of allowed) {
      if (updateDto[key] !== undefined && updateDto[key] !== null) {
        updates[key] = String(updateDto[key]);
      }
    }

    if (Object.keys(updates).length === 0) {
      return this.toPublicProfile(row);
    }

    const exprNames: Record<string, string> = {};
    const exprValues: Record<string, { S: string }> = {};
    const setParts: string[] = [];
    let i = 0;
    for (const [attr, value] of Object.entries(updates)) {
      const nameKey = `#k${i}`;
      const valKey = `:v${i}`;
      exprNames[nameKey] = attr;
      exprValues[valKey] = { S: value };
      setParts.push(`${nameKey} = ${valKey}`);
      i++;
    }

    await this.client.send(
      new UpdateItemCommand({
        TableName: this.tableName,
        Key: {
          PK: { S: `USER#${email.toLowerCase()}` },
        },
        UpdateExpression: 'SET ' + setParts.join(', '),
        ExpressionAttributeNames: exprNames,
        ExpressionAttributeValues: exprValues,
      }),
    );

    const fresh = await this.findByEmail(email);
    return this.toPublicProfile(fresh!);
  }

  async uploadProfilePicture(
    email: string,
    jwtSub: string,
    file: Express.Multer.File | undefined,
  ): Promise<Record<string, any>> {
    const row = await this.findByEmail(email);
    if (!row || row.id !== jwtSub) {
      throw new NotFoundException('User not found');
    }
    if (!file?.buffer?.length) {
      throw new BadRequestException('File is required (field name: file)');
    }
    const mime = (file.mimetype || '').toLowerCase();
    if (!PROFILE_IMAGE_MIMES.includes(mime as (typeof PROFILE_IMAGE_MIMES)[number])) {
      throw new BadRequestException(
        `Invalid image type. Allowed: ${PROFILE_IMAGE_MIMES.join(', ')}`,
      );
    }

    const key = this.s3.buildAvatarKey(jwtSub, mime === 'image/jpg' ? 'image/jpeg' : mime);
    const { url } = await this.s3.uploadBuffer({
      key,
      buffer: file.buffer,
      contentType: mime === 'image/jpg' ? 'image/jpeg' : mime,
    });

    const exprNames: Record<string, string> = { '#pic': 'picture' };
    const exprValues: Record<string, { S: string }> = { ':pic': { S: url } };

    await this.client.send(
      new UpdateItemCommand({
        TableName: this.tableName,
        Key: {
          PK: { S: `USER#${email.toLowerCase()}` },
        },
        UpdateExpression: 'SET #pic = :pic',
        ExpressionAttributeNames: exprNames,
        ExpressionAttributeValues: exprValues,
      }),
    );

    const fresh = await this.findByEmail(email);
    return this.toPublicProfile(fresh!);
  }
}
