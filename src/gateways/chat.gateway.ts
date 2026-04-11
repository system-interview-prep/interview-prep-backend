import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { corsOrigins } from '../config/cors.config';

/**
 * Centralized ChatGateway – realtime messaging.
 * Re-exports the logic from modules/chat/chat.gateway.ts.
 */
@WebSocketGateway({ namespace: '/chat', cors: { origin: corsOrigins, credentials: true } })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(ChatGateway.name);

  constructor(private readonly jwtService: JwtService) {}

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
      this.logger.log(`[Chat] Client connected: ${client.id} userId=${userId}`);
    } catch {
      client.emit('auth-error', { message: 'Unauthorized' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`[Chat] Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('join-room')
  handleJoinRoom(@MessageBody() data: { roomId: string; userName: string }, @ConnectedSocket() client: Socket) {
    client.join(data.roomId);
    client.to(data.roomId).emit('user-joined', { userName: data.userName, socketId: client.id });
  }

  @SubscribeMessage('send-message')
  handleMessage(@MessageBody() data: { roomId: string; senderId: string; senderName: string; content: string }, @ConnectedSocket() client: Socket) {
    const message = { ...data, timestamp: new Date().toISOString() };
    this.server.to(data.roomId).emit('message', message);
  }

  @SubscribeMessage('leave-room')
  handleLeaveRoom(@MessageBody() data: { roomId: string; userName: string }, @ConnectedSocket() client: Socket) {
    client.leave(data.roomId);
    client.to(data.roomId).emit('user-left', { userName: data.userName });
  }
}
