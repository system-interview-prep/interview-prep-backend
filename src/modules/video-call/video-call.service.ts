import { Injectable, NotFoundException } from '@nestjs/common';
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { nowISO } from '../../utils';

/**
 * Bản ghi phiên video call (WebRTC room / Simli) — tách khỏi chat text/voice.
 * Signaling vẫn qua Socket.IO `/signaling`; bảng này chỉ lưu metadata để list/lịch sử.
 */
@Injectable()
export class VideoCallService {
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
    this.tableName = process.env.DYNAMO_VIDEO_CALL_TABLE || 'InterviewVideoCalls';
  }

  async start(params: {
    userId: string;
    roomId: string;
    /** Liên kết tùy chọn tới buổi AI (InterviewSessions.id) */
    sessionId?: string;
  }): Promise<{ callId: string; roomId: string; startedAt: string }> {
    const callId = uuidv4();
    const startedAt = nowISO();

    await this.client.send(
      new PutItemCommand({
        TableName: this.tableName,
        Item: {
          id: { S: callId },
          user_id: { S: params.userId },
          room_id: { S: params.roomId },
          status: { S: 'active' },
          started_at: { S: startedAt },
          ...(params.sessionId?.trim()
            ? { session_id: { S: params.sessionId.trim() } }
            : {}),
        },
      }),
    );

    return { callId, roomId: params.roomId, startedAt };
  }

  async end(
    userId: string,
    callId: string,
  ): Promise<{ callId: string; endedAt: string }> {
    const endedAt = nowISO();

    await this.client.send(
      new UpdateItemCommand({
        TableName: this.tableName,
        Key: { id: { S: callId } },
        UpdateExpression: 'SET #status = :st, ended_at = :ea, updated_at = :ua',
        ConditionExpression: 'user_id = :uid',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':st': { S: 'ended' },
          ':ea': { S: endedAt },
          ':ua': { S: endedAt },
          ':uid': { S: userId },
        },
      }),
    );

    return { callId, endedAt };
  }

  async get(userId: string, callId: string) {
    const data = await this.client.send(
      new GetItemCommand({
        TableName: this.tableName,
        Key: { id: { S: callId } },
      }),
    );
    if (!data.Item) throw new NotFoundException('Video call not found');
    if (data.Item.user_id?.S !== userId) {
      throw new NotFoundException('Video call not found');
    }
    return this.toDto(data.Item);
  }

  async listByUser(userId: string, limit = 50) {
    const lim = Math.min(Math.max(limit, 1), 100);
    const data = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'user_id-index',
        KeyConditionExpression: 'user_id = :uid',
        ExpressionAttributeValues: { ':uid': { S: userId } },
        Limit: lim,
        ScanIndexForward: false,
      }),
    );
    return (data.Items || []).map((it) => this.toDto(it));
  }

  /**
   * Lưu 1 turn (user/assistant) như 1 item mới trong InterviewVideoCalls.
   * Partition/query theo GSI `session_id-index` (session_id + started_at).
   */
  async saveTurn(params: {
    userId: string;
    callId: string;
    sessionId: string;
    role: 'user' | 'assistant';
    type: 'text' | 'audio';
    content: string;
    audioUrl?: string;
    startedAt: string;
  }): Promise<void> {
    await this.client.send(
      new PutItemCommand({
        TableName: this.tableName,
        Item: {
          id: { S: uuidv4() },
          user_id: { S: params.userId },
          call_id: { S: params.callId },
          session_id: { S: params.sessionId },
          kind: { S: 'turn' },
          role: { S: params.role },
          type: { S: params.type },
          content: { S: params.content || '' },
          ...(params.audioUrl ? { audio_url: { S: params.audioUrl } } : {}),
          started_at: { S: params.startedAt },
        },
      }),
    );
  }

  async getCallSessionId(params: { userId: string; callId: string }): Promise<string> {
    const data = await this.client.send(
      new GetItemCommand({
        TableName: this.tableName,
        Key: { id: { S: params.callId } },
        ProjectionExpression: 'user_id, session_id',
      }),
    );
    if (!data.Item) throw new NotFoundException('Video call not found');
    if (data.Item.user_id?.S !== params.userId) throw new NotFoundException('Video call not found');
    const sid = data.Item.session_id?.S;
    if (!sid?.trim()) throw new NotFoundException('Video call session not found');
    return sid.trim();
  }

  async listTurnsBySessionId(params: {
    sessionId: string;
    limit?: number;
  }): Promise<
    { role: 'user' | 'assistant'; content: string; startedAt: string; audioUrl?: string | null }[]
  > {
    const lim = Math.min(Math.max(params.limit ?? 60, 1), 200);
    const data = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'session_id-index',
        KeyConditionExpression: 'session_id = :sid',
        ExpressionAttributeValues: { ':sid': { S: params.sessionId } },
        Limit: lim,
        ScanIndexForward: true,
      }),
    );
    return (data.Items || [])
      .filter((it) => it.kind?.S === 'turn')
      .map((it) => ({
        role: (it.role?.S as 'user' | 'assistant') || 'user',
        content: it.content?.S || '',
        startedAt: it.started_at?.S || '',
        audioUrl: it.audio_url?.S ?? null,
      }))
      .filter((x) => x.content.trim().length > 0);
  }

  private toDto(item: Record<string, any>) {
    return {
      id: item.id?.S || '',
      userId: item.user_id?.S || '',
      roomId: item.room_id?.S || '',
      sessionId: item.session_id?.S ?? null,
      status: item.status?.S || '',
      startedAt: item.started_at?.S || '',
      endedAt: item.ended_at?.S ?? null,
      updatedAt: item.updated_at?.S ?? null,
    };
  }
}

