import { Injectable } from '@nestjs/common';
import {
  DynamoDBClient,
  PutItemCommand,
  QueryCommand,
} from '@aws-sdk/client-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { nowISO } from '../../utils';
import { AiProviderService } from '../ai/ai-provider.service';
import { ConversationRole } from '@aws-sdk/client-bedrock-runtime';

@Injectable()
export class ChatService {
  private client: DynamoDBClient;
  private chatTextTableName: string;
  private chatVoiceTableName: string;

  constructor(private readonly ai: AiProviderService) {
    this.client = new DynamoDBClient({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      },
    });
    this.chatTextTableName =
      process.env.DYNAMO_CHAT_TEXT_TABLE || 'InterviewChatText';
    this.chatVoiceTableName =
      process.env.DYNAMO_CHAT_VOICE_TABLE || 'InterviewChatVoice';
  }

  async saveTextTurn(params: {
    sessionId: string;
    sender: 'user' | 'assistant';
    content: string;
    createdAt?: string;
  }) {
    const id = uuidv4();
    const createdAt = params.createdAt || nowISO();
    await this.client.send(
      new PutItemCommand({
        TableName: this.chatTextTableName,
        Item: {
          id: { S: id },
          session_id: { S: params.sessionId },
          sender: { S: params.sender },
          type: { S: 'text' },
          content: { S: params.content },
          created_at: { S: createdAt },
        },
      }),
    );
  }

  async getHistoryMerged(sessionId: string) {
    const query = (tableName: string) =>
      this.client.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: 'session_id-index',
          KeyConditionExpression: 'session_id = :sid',
          ExpressionAttributeValues: { ':sid': { S: sessionId } },
        }),
      );

    const [textData, voiceData] = await Promise.all([
      query(this.chatTextTableName),
      query(this.chatVoiceTableName),
    ]);

    const items = [...(textData.Items || []), ...(voiceData.Items || [])].sort(
      (a, b) => a.created_at.S.localeCompare(b.created_at.S),
    );

    return items.map((item) => ({
      role: item.sender.S as ConversationRole,
      content: item.content.S,
      audio_url: item.audio_url?.S || null,
      timestamp: item.created_at.S,
    }));
  }

  async chat(params: { sessionId: string; prompt: string; language: string }) {
    const now = nowISO();
    await this.saveTextTurn({
      sessionId: params.sessionId,
      sender: 'user',
      content: params.prompt,
      createdAt: now,
    });

    const history = await this.getHistoryMerged(params.sessionId);
    const reply = await this.ai.converse({
      language: params.language || 'english',
      history: history.map((h) => ({ role: h.role, content: h.content })),
    });

    await this.saveTextTurn({
      sessionId: params.sessionId,
      sender: 'assistant',
      content: reply,
      createdAt: nowISO(),
    });

    return reply;
  }
}

