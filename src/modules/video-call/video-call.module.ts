import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { VideoCallController } from './video-call.controller';
import { VideoCallAiService } from './video-call-ai.service';
import { VideoCallService } from './video-call.service';

@Module({
  imports: [AiModule],
  controllers: [VideoCallController],
  providers: [VideoCallService, VideoCallAiService],
  exports: [VideoCallService, VideoCallAiService],
})
export class VideoCallModule {}

