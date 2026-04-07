import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AiUtilsController } from './ai-utils.controller';

@Module({
  imports: [AiModule],
  controllers: [AiUtilsController],
})
export class AiUtilsModule {}

