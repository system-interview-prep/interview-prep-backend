import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ScoringService } from './scoring.service';

@Controller('ai')
export class ScoringController {
  constructor(private readonly scoring: ScoringService) {}

  /**
   * POST /ai/score-cv-jp
   * Body: { candidateId, jobId }
   * Uses UserCvs.structured_data and JobProfiles.ai_profile_ui_json (labeled)
   */
  @Post('score-cv-jp')
  @UseGuards(AuthGuard)
  async score(
    @Request() req: any,
    @Body('candidateId') candidateId: string,
    @Body('jobId') jobId: string,
  ) {
    const userId = req.user?.sub;
    if (!userId?.trim()) throw new BadRequestException('userId missing');
    if (!candidateId?.trim()) throw new BadRequestException('candidateId is required');
    if (!jobId?.trim()) throw new BadRequestException('jobId is required');
    return this.scoring.scoreCvAgainstJobProfile({
      userId,
      candidateId: candidateId.trim(),
      jobId: jobId.trim(),
    });
  }
}

