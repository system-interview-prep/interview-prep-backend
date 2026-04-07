import { Module } from '@nestjs/common';
import { ChatGateway } from './chat.gateway';
import { AiModule } from '../ai/ai.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { VoiceModule } from '../voice/voice.module';

@Module({
  imports: [AiModule, VoiceModule],
  controllers: [ChatController],
  providers: [ChatGateway, ChatService],
})
export class ChatModule {}
