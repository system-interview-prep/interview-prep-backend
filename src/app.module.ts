import { Module } from '@nestjs/common';

// Domain Modules
import { AiModule } from './modules/ai/ai.module';
import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/user/user.module';
import { VideoCallModule } from './modules/video-call/video-call.module';
import { SignalingModule } from './modules/signaling/signaling.module';
import { ChatModule } from './modules/chat/chat.module';
import { MediaModule } from './modules/media/media.module';
import { JobProfileModule } from './modules/job-profile/job-profile.module';
import { JobCategoryModule } from './modules/job-category/job-category.module';
import { UserCvModule } from './modules/user-cv/user-cv.module';
import { SessionsModule } from './modules/sessions/sessions.module';
import { VoiceModule } from './modules/voice/voice.module';
import { AiUtilsModule } from './modules/ai-utils/ai-utils.module';

@Module({
  imports: [
    AiModule,
    AiUtilsModule,
    AuthModule,
    UserModule,
    VideoCallModule,
    SignalingModule,
    ChatModule,
    VoiceModule,
    SessionsModule,
    MediaModule,
    JobCategoryModule,
    JobProfileModule,
    UserCvModule,
  ],
})
export class AppModule {}
