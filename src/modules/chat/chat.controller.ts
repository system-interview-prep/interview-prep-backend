import { BadRequestException, Controller, Get, Post, Body, Query } from '@nestjs/common';
import { ChatService } from './chat.service';

@Controller('ai')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post('chat')
  async chat(
    @Body('sessionId') sessionId: string,
    @Body('prompt') prompt: string,
    @Body('language') language: string,
  ) {
    if (!sessionId?.trim()) throw new BadRequestException('sessionId is required');
    if (!prompt?.trim()) throw new BadRequestException('prompt is required');
    const reply = await this.chatService.chat({
      sessionId,
      prompt,
      language: language || 'english',
    });
    return { reply: reply || '' };
  }

  @Get('history')
  async history(@Query('sessionId') sessionId: string) {
    if (!sessionId?.trim()) throw new BadRequestException('sessionId is required');
    const history = await this.chatService.getHistoryMerged(sessionId);
    return { history };
  }
}

