import {
  BadRequestException,
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { VideoCallService } from './video-call.service';
import { VideoCallAiService } from './video-call-ai.service';
import { AuthGuard } from '../auth/auth.guard';

@Controller('interview')
export class VideoCallController {
  constructor(
    private readonly videoCallService: VideoCallService,
    private readonly videoCallAi: VideoCallAiService,
  ) {}

  /** POST /interview/video-calls/start — lưu metadata phiên video (room WebRTC / Simli) */
  @Post('video-calls/start')
  @UseGuards(AuthGuard)
  async startVideoCall(
    @Request() req: any,
    @Body('roomId') roomId: string,
    @Body('sessionId') sessionId?: string,
  ) {
    const userId = req.user?.sub;
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
  @UseGuards(AuthGuard)
  async endVideoCall(
    @Request() req: any,
    @Param('callId') callId: string,
  ) {
    const userId = req.user?.sub;
    if (!userId?.trim()) throw new BadRequestException('user id missing');
    return this.videoCallService.end(userId, callId);
  }

  /** GET /interview/video-calls — danh sách phiên video của user */
  @Get('video-calls')
  @UseGuards(AuthGuard)
  async listVideoCalls(@Request() req: any) {
    const userId = req.user?.sub;
    if (!userId?.trim()) throw new BadRequestException('user id missing');
    return this.videoCallService.listByUser(userId);
  }

  /**
   * POST /interview/video-calls/:callId/chat-voice
   * Dùng riêng cho video-call: lưu transcript vào InterviewVideoCalls (KHÔNG ghi InterviewChatVoice).
   */
  @Post('video-calls/:callId/chat-voice')
  @UseGuards(AuthGuard)
  async chatVoiceOnCall(
    @Request() req: any,
    @Param('callId') callId: string,
    @Body('prompt') prompt: string,
    @Body('language') language: string,
  ) {
    const userId = req.user?.sub;
    if (!userId?.trim()) throw new BadRequestException('user id missing');
    if (!callId?.trim()) throw new BadRequestException('callId is required');
    if (!prompt?.trim()) throw new BadRequestException('prompt is required');
    return this.videoCallAi.chatVoiceOnCall({
      userId,
      callId: callId.trim(),
      prompt,
      language: language || 'english',
    });
  }
}

