import { Controller, Post, Body } from '@nestjs/common';
import { AiService } from './ai.service';

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('chat')
  async chat(@Body('prompt') prompt: string) {
    const reply = await this.aiService.chat([{ role: 'user', content: [{ text: prompt }] }]);
    return { reply: reply || '' };
  }
}
