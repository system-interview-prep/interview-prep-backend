import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WsException,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { JobProfileService } from './job-profile.service';
import { corsOrigins } from '../../config/cors.config';

@WebSocketGateway({ namespace: '/jp', cors: { origin: corsOrigins, credentials: true } })
export class JpStatusGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(JpStatusGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly jobProfiles: JobProfileService,
  ) {}

  private extractToken(client: Socket): string | null {
    const authToken = client.handshake.auth?.token;
    if (typeof authToken === 'string' && authToken.trim()) return authToken.trim();
    const header = client.handshake.headers?.authorization;
    if (!header || Array.isArray(header)) return null;
    const [type, token] = header.split(' ');
    return type === 'Bearer' && token ? token : null;
  }

  async handleConnection(client: Socket) {
    const token = this.extractToken(client);
    if (!token) {
      client.emit('auth-error', { message: 'Unauthorized' });
      client.disconnect(true);
      return;
    }
    try {
      const payload = await this.jwtService.verifyAsync(token, {
        secret: process.env.JWT_SECRET || 'fallback-secret-key-for-dev',
      });
      const userId = String(payload?.sub || '').trim();
      if (!userId) throw new Error('Missing sub');
      client.data.userId = userId;
      this.logger.log(`[JP] Client connected: ${client.id} userId=${userId}`);
    } catch {
      client.emit('auth-error', { message: 'Unauthorized' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`[JP] Client disconnected: ${client.id}`);
  }

  /**
   * FE calls: socket.emit('join-jp', { uploadId })
   * then receives: 'jp.status' events.
   */
  @SubscribeMessage('join-jp')
  async joinJp(
    @MessageBody() data: { uploadId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const userId = String(client.data?.userId || '').trim();
    const uploadId = String(data?.uploadId || '').trim();
    if (!userId || !uploadId) {
      throw new WsException({
        code: 'JP_ROOM_INVALID',
        uploadId,
        message: 'Invalid jp room request',
      });
    }

    try {
      await this.jobProfiles.getJpUpload(userId, uploadId);
      const room = `jp:${uploadId}`;
      client.join(room);
      return { joined: true, room };
    } catch {
      this.logger.warn(`[JP] join denied for userId=${userId} uploadId=${uploadId}`);
      throw new WsException({
        code: 'JP_ROOM_FORBIDDEN',
        uploadId,
        message: 'Forbidden jp room',
      });
    }
  }

  emitStatus(uploadId: string, payload: Record<string, any>) {
    this.server.to(`jp:${uploadId}`).emit('jp.status', payload);
  }
}

