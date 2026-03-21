import { Module } from '@nestjs/common';

// Domain Modules
import { AiModule } from './modules/ai/ai.module';
import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/user/user.module';
import { InterviewModule } from './modules/interview/interview.module';
import { SignalingModule } from './modules/signaling/signaling.module';
import { ChatModule } from './modules/chat/chat.module';
import { MediaModule } from './modules/media/media.module';

@Module({
  imports: [
    AiModule,
    AuthModule,
    UserModule,
    InterviewModule,
    SignalingModule,
    ChatModule,
    MediaModule,
  ],
})
export class AppModule {}
