import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ScoringController } from './scoring.controller';
import { ScoringService } from './scoring.service';

@Module({
  imports: [AuthModule],
  controllers: [ScoringController],
  providers: [ScoringService],
})
export class ScoringModule {}

