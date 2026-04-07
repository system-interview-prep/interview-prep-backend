import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Request,
  Param,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { SessionsService, InterviewSessionType } from './sessions.service';

@Controller('ai')
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @UseGuards(AuthGuard)
  @Post('session')
  async createSession(
    @Request() req: any,
    @Body('type') type?: InterviewSessionType,
    @Body('language') language?: string,
  ) {
    const userId = req.user?.sub;
    if (!userId?.trim()) throw new BadRequestException('userId missing');
    if (!type || !['Chat', 'Voice', 'Call'].includes(type)) {
      throw new BadRequestException('type must be Chat | Voice | Call');
    }
    return this.sessions.create({ userId, type, language });
  }

  @UseGuards(AuthGuard)
  @Get('sessions')
  async listSessions(@Request() req: any) {
    const userId = req.user?.sub;
    if (!userId?.trim()) throw new BadRequestException('userId missing');
    const sessions = await this.sessions.listByUser(userId);
    return { sessions };
  }

  /** POST /ai/session/:sessionId/close */
  @UseGuards(AuthGuard)
  @Post('session/:sessionId/close')
  async closeSession(@Request() req: any, @Param('sessionId') sessionId: string) {
    const userId = req.user?.sub;
    if (!userId?.trim()) throw new BadRequestException('userId missing');
    if (!sessionId?.trim()) throw new BadRequestException('sessionId is required');
    return this.sessions.close({ userId, sessionId });
  }
}

