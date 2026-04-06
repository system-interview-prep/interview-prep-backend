import { v4 as uuidv4 } from 'uuid';
import { Controller, Post, Body, Get, Query, UseGuards, Request } from '@nestjs/common';
import { AiService } from './ai.service';
import { AuthGuard } from '../auth/auth.guard'; // Middleware lọc Token

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  // Bảo vệ Router (Chỉ Request Header chứa "Bearer {token}" hợp lệ mới được đi qua)
  @UseGuards(AuthGuard)
  @Post('session')
  async createSession(@Request() req: any, @Body('type') type?: string, @Body('language') language?: string) {
    const userId = req.user.sub; // Trích xuất từ JWT Payload (sub = id)
    const sessionId = await this.aiService.createInterviewSession(userId, type, language);
    return { sessionId };
  }

  @Post('simli-session')
  async createSimliSession(@Body('faceId') faceId?: string) {
    try {
      const session_token = await this.aiService.createSimliSession(faceId);
      return { session_token };
    } catch (error: any) {
      return { error: error.message };
    }
  }

  @Post('simli-ice-servers')
  async getSimliIceServers() {
    try {
      const iceServers = await this.aiService.getSimliIceServers();
      return { iceServers };
    } catch (error: any) {
      return { iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }] };
    }
  }

  @Post('chat')
  async chat(
    @Body('sessionId') sessionId: string,
    @Body('prompt') prompt: string,
    @Body('language') language: any,
  ) {
    const reply = await this.aiService.chat(
      sessionId,
      { role: 'user', content: prompt },
      language,
    );
    return { reply: reply || '' };
  }

  @Post('chat-voice')
  async chatVoice(
    @Body('sessionId') sessionId: string,
    @Body('prompt') prompt: string,
    @Body('language') language: any,
  ) {
    const result = await this.aiService.chatToSpeech(
      sessionId,
      { role: 'user', content: prompt },
      language,
    );
    return result;
  }

  @Get('history')
  async getHistory(
    @Query('sessionId') sessionId: string,
  ) {
    const history = await this.aiService.getChatHistory(sessionId);
    return { history };
  }

  @UseGuards(AuthGuard)
  @Get('sessions')
  async getAllSessions(@Request() req: any) {
    // Lấy riêng biệt lịch sử phỏng vấn của người dùng này
    const userId = req.user.sub;
    const sessions = await this.aiService.getAllSessionsByUser(userId);
    return { sessions };
  }
}
