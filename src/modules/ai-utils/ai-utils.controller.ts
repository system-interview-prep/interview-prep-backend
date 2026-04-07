import { Body, Controller, Post } from '@nestjs/common';
import { AiProviderService } from '../ai/ai-provider.service';

@Controller('ai')
export class AiUtilsController {
  constructor(private readonly ai: AiProviderService) {}

  @Post('simli-session')
  async createSimliSession(@Body('faceId') faceId?: string) {
    try {
      const session_token = await this.ai.createSimliSession(faceId);
      return { session_token };
    } catch (error: any) {
      return { error: error.message };
    }
  }

  @Post('simli-ice-servers')
  async getSimliIceServers() {
    try {
      const iceServers = await this.ai.getSimliIceServers();
      return { iceServers };
    } catch (error: any) {
      return { iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }] };
    }
  }
}

