import { Body, Controller, Post } from '@nestjs/common';
import { AiProviderService } from './ai-provider.service';

@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiProviderService) {}

  /**
   * Khởi tạo phiên WebRTC Avatar AI (Vendor-agnostic domain endpoint).
   */
  @Post('avatar-session')
  async createAvatarSession(@Body('faceId') faceId?: string) {
    try {
      const session_token = await this.ai.createSimliSession(faceId);
      return { session_token };
    } catch (error: any) {
      return { error: error.message };
    }
  }

  /**
   * Lấy danh sách ICE/STUN/TURN Servers cho WebRTC Avatar AI.
   */
  @Post('avatar-ice-servers')
  async getAvatarIceServers() {
    try {
      const iceServers = await this.ai.getSimliIceServers();
      return { iceServers };
    } catch (error: any) {
      return { iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }] };
    }
  }
}
