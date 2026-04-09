import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ChatService } from './chat.service';
import { AuthGuard } from '../auth/auth.guard';

@Controller('ai')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @UseGuards(AuthGuard)
  @Post('chat')
  async chat(
    @Request() req: any,
    @Body('sessionId') sessionId: string,
    @Body('prompt') prompt: string,
    @Body('language') language: string,
  ) {
    const userId = req.user?.sub;
    if (!userId?.trim()) throw new BadRequestException('userId missing');
    if (!sessionId?.trim()) throw new BadRequestException('sessionId is required');
    if (!prompt?.trim()) throw new BadRequestException('prompt is required');
    await this.chatService.ensureOpeningIfEmpty({ userId, sessionId: sessionId.trim() });
    const reply = await this.chatService.chat({
      userId,
      sessionId: sessionId.trim(),
      prompt,
      language: language || 'english',
    });
    return { reply: reply || '' };
  }

  @Get('history')
  @UseGuards(AuthGuard)
  async history(@Request() req: any, @Query('sessionId') sessionId: string) {
    const userId = req.user?.sub;
    if (!userId?.trim()) throw new BadRequestException('userId missing');
    if (!sessionId?.trim()) throw new BadRequestException('sessionId is required');
    await this.chatService.ensureOpeningIfEmpty({ userId, sessionId: sessionId.trim() });
    const history = await this.chatService.getHistoryMerged(sessionId.trim());
    return { history };
  }
}

