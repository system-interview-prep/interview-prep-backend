import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { ScoringController } from './scoring.controller';
import { ScoringService } from './scoring.service';

@Module({
  imports: [AiModule, AuthModule],
  controllers: [ScoringController],
  providers: [ScoringService],
})
export class ScoringModule {}

