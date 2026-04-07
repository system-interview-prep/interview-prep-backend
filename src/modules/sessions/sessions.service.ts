import { Injectable } from '@nestjs/common';
import {
  DynamoDBClient,
  PutItemCommand,
  QueryCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { nowISO } from '../../utils';

export type InterviewSessionType = 'Chat' | 'Voice' | 'Call';

@Injectable()
export class SessionsService {
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
    this.tableName = process.env.DYNAMO_SESSIONS_TABLE || 'InterviewSessions';
  }

  async create(params: {
    userId: string;
    type: InterviewSessionType;
    language?: string;
  }): Promise<{ sessionId: string }> {
    const sessionId = uuidv4();
    const startedAt = nowISO();
    await this.client.send(
      new PutItemCommand({
        TableName: this.tableName,
        Item: {
          id: { S: sessionId },
          user_id: { S: params.userId },
          type: { S: params.type },
          language: { S: params.language || 'English' },
          status: { S: 'Open' },
          started_at: { S: startedAt },
        },
      }),
    );
    return { sessionId };
  }

  async listByUser(userId: string) {
    const data = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'user_id-index',
        KeyConditionExpression: 'user_id = :uid',
        ExpressionAttributeValues: { ':uid': { S: userId } },
      }),
    );
    return (data.Items || []).map((item) => ({
      id: item.id?.S || '',
      type: item.type?.S || '',
      language: item.language?.S || '',
      status: item.status?.S || '',
      started_at: item.started_at?.S || '',
      ended_at: item.ended_at?.S || null,
    }));
  }

  async close(params: { userId: string; sessionId: string }) {
    const now = nowISO();
    await this.client.send(
      new UpdateItemCommand({
        TableName: this.tableName,
        Key: { id: { S: params.sessionId } },
        UpdateExpression:
          'SET #status = :closed, ended_at = :endedAt, updated_at = :updatedAt',
        ConditionExpression: 'user_id = :uid',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':closed': { S: 'Closed' },
          ':endedAt': { S: now },
          ':updatedAt': { S: now },
          ':uid': { S: params.userId },
        },
      }),
    );
    return { sessionId: params.sessionId, status: 'Closed', endedAt: now };
  }
}

