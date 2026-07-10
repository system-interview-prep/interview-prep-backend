import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AiModule } from '../ai/ai.module';
import { ScoringController } from './scoring.controller';
import { ScoringService } from './scoring.service';

@Module({
  imports: [AuthModule, AiModule],
  controllers: [ScoringController],
  providers: [ScoringService],
})
export class ScoringModule {}

