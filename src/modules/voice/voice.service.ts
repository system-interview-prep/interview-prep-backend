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
export class VoiceService {
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

  private async getHistoryMerged(sessionId: string) {
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
    }));
  }

  async chatVoice(params: { sessionId: string; prompt: string; language: string }) {
    const now = nowISO();
    // Voice mode: persist user prompt in voice table (type=text) so we don't pollute InterviewChatText.
    await this.client.send(
      new PutItemCommand({
        TableName: this.chatVoiceTableName,
        Item: {
          id: { S: uuidv4() },
          session_id: { S: params.sessionId },
          sender: { S: 'user' },
          type: { S: 'text' },
          content: { S: params.prompt },
          created_at: { S: now },
        },
      }),
    );

    const history = await this.getHistoryMerged(params.sessionId);
    const replyText = await this.ai.converse({
      language: params.language || 'english',
      history,
    });

    const { audioBase64, mimeType, audioUrl } =
      await this.ai.textToSpeechAndUpload(replyText);

    // save assistant turn to voice table
    await this.client.send(
      new PutItemCommand({
        TableName: this.chatVoiceTableName,
        Item: {
          id: { S: uuidv4() },
          session_id: { S: params.sessionId },
          sender: { S: 'assistant' },
          type: { S: 'audio' },
          content: { S: replyText },
          audio_url: { S: audioUrl },
          created_at: { S: nowISO() },
        },
      }),
    );

    return { reply: replyText, audioBase64, mimeType };
  }
}

