import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';

interface StartInterviewDto {
  userId: string;
  topic: string;
  language: string;
}

/**
 * InterviewService – core business logic for interview sessions.
 * TODO: Persist sessions to DynamoDB (DYNAMO_SESSIONS_TABLE).
 */
@Injectable()
export class InterviewService {
  async startInterview(dto: StartInterviewDto): Promise<Record<string, any>> {
    const roomId = uuidv4();
    const sessionId = uuidv4();
    // TODO: save session to DB
    return {
      sessionId,
      roomId,
      userId: dto.userId,
      topic: dto.topic,
      language: dto.language,
      status: 'active',
      startedAt: new Date().toISOString(),
    };
  }

  async getInterview(id: string): Promise<Record<string, any>> {
    // TODO: fetch from DB
    return { sessionId: id, status: 'active', message: 'Placeholder session data' };
  }

  async endInterview(id: string): Promise<{ message: string }> {
    // TODO: update session status in DB
    return { message: `Interview session ${id} ended (placeholder)` };
  }

  async listInterviews(userId: string): Promise<any[]> {
    // TODO: query DB for user's sessions
    return [];
  }
}
