import {
  BadRequestException,
  Body,
  Controller,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { InterviewQuestionsService } from './interview-questions.service';

@Controller('ai')
export class InterviewQuestionsController {
  constructor(private readonly svc: InterviewQuestionsService) {}

  /**
   * POST /ai/session/:sessionId/questions/generate
   * Body: { candidateId, jobId, language?, totalQuestions?, force? }
   */
  @Post('session/:sessionId/questions/generate')
  @UseGuards(AuthGuard)
  async generate(
    @Request() req: any,
    @Param('sessionId') sessionId: string,
    @Body('candidateId') candidateId: string,
    @Body('jobId') jobId: string,
    @Body('language') language?: string,
    @Body('totalQuestions') totalQuestions?: number,
    @Body('force') force?: boolean,
  ) {
    const userId = req.user?.sub;
    if (!userId?.trim()) throw new BadRequestException('userId missing');
    if (!sessionId?.trim()) throw new BadRequestException('sessionId is required');
    if (!candidateId?.trim()) throw new BadRequestException('candidateId is required');
    if (!jobId?.trim()) throw new BadRequestException('jobId is required');

    return this.svc.generate({
      userId,
      sessionId: sessionId.trim(),
      candidateId: candidateId.trim(),
      jobId: jobId.trim(),
      language: (language || 'Vietnamese').trim(),
      totalQuestions: totalQuestions ? Number(totalQuestions) : undefined,
      force: Boolean(force),
    });
  }
}

