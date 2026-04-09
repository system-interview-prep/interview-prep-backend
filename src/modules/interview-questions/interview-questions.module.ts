import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { SessionsModule } from '../sessions/sessions.module';
import { InterviewQuestionsController } from './interview-questions.controller';
import { InterviewQuestionsService } from './interview-questions.service';

@Module({
  imports: [AiModule, AuthModule, SessionsModule],
  controllers: [InterviewQuestionsController],
  providers: [InterviewQuestionsService],
  exports: [InterviewQuestionsService],
})
export class InterviewQuestionsModule {}

