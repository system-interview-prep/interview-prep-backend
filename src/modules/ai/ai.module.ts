import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiProviderService } from './ai-provider.service';

@Module({
  controllers: [AiController],
  providers: [AiProviderService],
  exports: [AiProviderService],
})
export class AiModule {}
