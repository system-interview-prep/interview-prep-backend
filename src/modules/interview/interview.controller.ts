import {
  BadRequestException,
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { InterviewService } from './interview.service';
import { VideoCallService } from './video-call.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('interview')
export class InterviewController {
  constructor(
    private readonly interviewService: InterviewService,
    private readonly videoCallService: VideoCallService,
  ) {}

  /** POST /interview/video-calls/start — lưu metadata phiên video (room WebRTC / Simli) */
  @Post('video-calls/start')
  @UseGuards(JwtAuthGuard)
  async startVideoCall(
    @CurrentUser() user: any,
    @Body('roomId') roomId: string,
    @Body('sessionId') sessionId?: string,
  ) {
    const userId = user?.sub || user?.userId;
    if (!userId?.trim()) throw new BadRequestException('user id missing');
    if (!roomId?.trim()) throw new BadRequestException('roomId is required');
    return this.videoCallService.start({
      userId,
      roomId: roomId.trim(),
      sessionId,
    });
  }

  /** POST /interview/video-calls/:callId/end */
  @Post('video-calls/:callId/end')
  @UseGuards(JwtAuthGuard)
  async endVideoCall(
    @CurrentUser() user: any,
    @Param('callId') callId: string,
  ) {
    const userId = user?.sub || user?.userId;
    if (!userId?.trim()) throw new BadRequestException('user id missing');
    return this.videoCallService.end(userId, callId);
  }

  /** GET /interview/video-calls — danh sách phiên video của user */
  @Get('video-calls')
  @UseGuards(JwtAuthGuard)
  async listVideoCalls(@CurrentUser() user: any) {
    const userId = user?.sub || user?.userId;
    if (!userId?.trim()) throw new BadRequestException('user id missing');
    return this.videoCallService.listByUser(userId);
  }

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
