import { Module } from '@nestjs/common';
import { InterviewController } from './interview.controller';
import { InterviewService } from './interview.service';
import { VideoCallService } from './video-call.service';

@Module({
  controllers: [InterviewController],
  providers: [InterviewService, VideoCallService],
  exports: [InterviewService, VideoCallService],
})
export class InterviewModule {}
