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
 * Centralized SignalingGateway – WebRTC signaling relay.
 * Re-exports the logic from modules/signaling/signaling.gateway.ts.
 * Use this file if you prefer a single top-level gateway instead of
 * mounting it inside the SignalingModule.
 */
@WebSocketGateway({ namespace: '/signaling', cors: { origin: corsOrigins, credentials: true } })
export class SignalingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(SignalingGateway.name);

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
      this.logger.log(`[Signaling] Client connected: ${client.id} userId=${userId}`);
    } catch {
      client.emit('auth-error', { message: 'Unauthorized' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`[Signaling] Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('join-room')
  handleJoinRoom(@MessageBody() data: { roomId: string }, @ConnectedSocket() client: Socket) {
    client.join(data.roomId);
    client.to(data.roomId).emit('peer-joined', { socketId: client.id });
  }

  @SubscribeMessage('offer')
  handleOffer(@MessageBody() data: { roomId: string; offer: any }, @ConnectedSocket() client: Socket) {
    client.to(data.roomId).emit('offer', { offer: data.offer, from: client.id });
  }

  @SubscribeMessage('answer')
  handleAnswer(@MessageBody() data: { roomId: string; answer: any }, @ConnectedSocket() client: Socket) {
    client.to(data.roomId).emit('answer', { answer: data.answer, from: client.id });
  }

  @SubscribeMessage('ice-candidate')
  handleIceCandidate(@MessageBody() data: { roomId: string; candidate: any }, @ConnectedSocket() client: Socket) {
    client.to(data.roomId).emit('ice-candidate', { candidate: data.candidate, from: client.id });
  }

  @SubscribeMessage('leave-room')
  handleLeaveRoom(@MessageBody() data: { roomId: string }, @ConnectedSocket() client: Socket) {
    client.leave(data.roomId);
    client.to(data.roomId).emit('peer-left', { socketId: client.id });
  }
}
