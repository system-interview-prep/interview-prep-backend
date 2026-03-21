import { Controller, Post, Get, Param, Body, UseGuards } from '@nestjs/common';
import { InterviewService } from './interview.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('interview')
export class InterviewController {
  constructor(private readonly interviewService: InterviewService) {}

  /** POST /interview/start – create a new interview session */
  @Post('start')
  @UseGuards(JwtAuthGuard)
  async startInterview(
    @CurrentUser() user: any,
    @Body('topic') topic: string,
    @Body('language') language: string,
  ) {
    return this.interviewService.startInterview({ userId: user?.userId, topic, language });
  }

  /** GET /interview/:id – get interview session details */
  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async getInterview(@Param('id') id: string) {
    return this.interviewService.getInterview(id);
  }

  /** POST /interview/:id/end – finalize an interview session */
  @Post(':id/end')
  @UseGuards(JwtAuthGuard)
  async endInterview(@Param('id') id: string) {
    return this.interviewService.endInterview(id);
  }

  /** GET /interview – list all sessions for the current user */
  @Get()
  @UseGuards(JwtAuthGuard)
  async listInterviews(@CurrentUser() user: any) {
    return this.interviewService.listInterviews(user?.userId);
  }
}
