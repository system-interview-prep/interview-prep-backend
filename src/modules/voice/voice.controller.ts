import { BadRequestException, Controller, Post, Body } from '@nestjs/common';
import { VoiceService } from './voice.service';

@Controller('ai')
export class VoiceController {
  constructor(private readonly voice: VoiceService) {}

  @Post('chat-voice')
  async chatVoice(
    @Body('sessionId') sessionId: string,
    @Body('prompt') prompt: string,
    @Body('language') language: string,
  ) {
    if (!sessionId?.trim()) throw new BadRequestException('sessionId is required');
    if (!prompt?.trim()) throw new BadRequestException('prompt is required');
    return this.voice.chatVoice({
      sessionId,
      prompt,
      language: language || 'english',
    });
  }
}

