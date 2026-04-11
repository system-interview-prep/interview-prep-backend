import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Body,
  Query,
  ForbiddenException,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ChatService } from './chat.service';
import { AuthGuard } from '../auth/auth.guard';
import { SessionsService } from '../sessions/sessions.service';

@Controller('ai')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly sessions: SessionsService,
  ) {}

  private async ensureOwnedSession(userId: string, sessionId: string): Promise<void> {
    const ownedType = await this.sessions.getType({ userId, sessionId });
    if (!ownedType) {
      throw new ForbiddenException('sessionId does not belong to user');
    }
  }

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
    const safeSessionId = sessionId.trim();
    await this.ensureOwnedSession(userId, safeSessionId);
    await this.chatService.ensureOpeningIfEmpty({ userId, sessionId: safeSessionId });
    const reply = await this.chatService.chat({
      userId,
      sessionId: safeSessionId,
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
    const safeSessionId = sessionId.trim();
    await this.ensureOwnedSession(userId, safeSessionId);
    await this.chatService.ensureOpeningIfEmpty({ userId, sessionId: safeSessionId });
    const history = await this.chatService.getHistoryMerged(safeSessionId);
    return { history };
  }
}

