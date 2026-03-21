import { Module } from '@nestjs/common';
import { ChatGateway } from './chat.gateway';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [AiModule],
  providers: [ChatGateway],
})
export class ChatModule {}
