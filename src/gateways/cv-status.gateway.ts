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
import { corsOrigins } from '../config/cors.config';
import { UserCvService } from '../modules/user-cv/user-cv.service';

@WebSocketGateway({ namespace: '/cv', cors: { origin: corsOrigins, credentials: true } })
export class CvStatusGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(CvStatusGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly userCvService: UserCvService,
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
      this.logger.log(`[CV] Client connected: ${client.id} userId=${userId}`);
    } catch {
      client.emit('auth-error', { message: 'Unauthorized' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`[CV] Client disconnected: ${client.id}`);
  }

  /**
   * FE calls: socket.emit('join-cv', { cvId })
   * then receives: 'cv.status' events.
   */
  @SubscribeMessage('join-cv')
  async joinCv(@MessageBody() data: { cvId: string }, @ConnectedSocket() client: Socket) {
    const userId = String(client.data?.userId || '').trim();
    const cvId = String(data?.cvId || '').trim();
    if (!userId || !cvId) {
      throw new WsException({
        code: 'CV_ROOM_INVALID',
        cvId,
        message: 'Invalid cv room request',
      });
    }

    try {
      await this.userCvService.get(userId, cvId);
      const room = `cv:${cvId}`;
      client.join(room);
      return { joined: true, room };
    } catch {
      this.logger.warn(`[CV] join denied for userId=${userId} cvId=${cvId}`);
      throw new WsException({
        code: 'CV_ROOM_FORBIDDEN',
        cvId,
        message: 'Forbidden cv room',
      });
    }
  }

  emitStatus(cvId: string, payload: Record<string, any>) {
    this.server.to(`cv:${cvId}`).emit('cv.status', payload);
  }
}

