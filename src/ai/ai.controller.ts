import { v4 as uuidv4 } from 'uuid';
import { Controller, Post, Body, Get, Query } from '@nestjs/common';
import { AiService } from './ai.service';

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('session')
  async createSession() {
    const sessionId = uuidv4();
    return { sessionId };
  }

  @Post('chat')
  async chat(
    @Body('sessionId') sessionId: string,
    @Body('prompt') prompt: string,
    @Body('language') language: any,
  ) {
    const reply = await this.aiService.chat(
      sessionId,
      { role: 'user', content: prompt},
      language
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
      language
    );
    return result;
  }

  @Get('history')
  async getHistory(@Query('sessionId') sessionId: string, @Query('limit') limit?: number) {
    const history = await this.aiService.getChatHistory(sessionId);
    return { history };
  }

  @Get('sessions')
  async getAllSessions() {
    const sessions = await this.aiService.getAllSessionIds();
    return { sessions };
  }

}
