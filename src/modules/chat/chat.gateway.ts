import {
  WsException,
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
import { VoiceService } from '../voice/voice.service';
import { JwtService } from '@nestjs/jwt';
import { SessionsService } from '../sessions/sessions.service';
import { corsOrigins } from '../../config/cors.config';

interface ChatMessage {
  roomId: string;
  senderId: string;
  senderName: string;
  content: string;
  language?: string;  // optional: 'english' | 'vietnamese' etc.
  timestamp?: string;
}

/**
 * ChatGateway – Realtime chat via Socket.IO (/chat namespace).
 * Supports room-based messaging during interview sessions.
 * After each user message, forwards content to VoiceService and relays the reply.
 */
@WebSocketGateway({ namespace: '/chat', cors: { origin: corsOrigins, credentials: true } })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly voiceService: VoiceService,
    private readonly jwtService: JwtService,
    private readonly sessions: SessionsService,
  ) {}

  private extractToken(client: Socket): string | null {
    const authToken = client.handshake.auth?.token;
    if (typeof authToken === 'string' && authToken.trim()) return authToken.trim();
    const header = client.handshake.headers?.authorization;
    if (!header || Array.isArray(header)) return null;
    const [type, token] = header.split(' ');
    return type === 'Bearer' && token ? token : null;
  }

  private async authenticate(client: Socket): Promise<string | null> {
    const token = this.extractToken(client);
    if (!token) return null;
    try {
      const payload = await this.jwtService.verifyAsync(token, {
        secret: process.env.JWT_SECRET || 'fallback-secret-key-for-dev',
      });
      const userId = String(payload?.sub || '').trim();
      if (!userId) return null;
      client.data.userId = userId;
      return userId;
    } catch {
      return null;
    }
  }

  private async ensureRoomOwnership(client: Socket, roomId: string): Promise<boolean> {
    const userId = String(client.data?.userId || '').trim();
    if (!userId || !roomId?.trim()) return false;
    const type = await this.sessions.getType({ userId, sessionId: roomId.trim() });
    return type !== null;
  }

  async handleConnection(client: Socket) {
    const userId = await this.authenticate(client);
    if (!userId) {
      client.emit('auth-error', { message: 'Unauthorized' });
      client.disconnect(true);
      return;
    }
    this.logger.log(`Chat client connected: ${client.id} userId=${userId}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Chat client disconnected: ${client.id}`);
  }

  @SubscribeMessage('join-room')
  async handleJoinRoom(
    @MessageBody() data: { roomId: string; userName: string },
    @ConnectedSocket() client: Socket,
  ) {
    if (!(await this.ensureRoomOwnership(client, data?.roomId || ''))) {
      throw new WsException('Forbidden room');
    }
    client.join(data.roomId);
    client.to(data.roomId).emit('user-joined', { userName: data.userName, socketId: client.id });
    this.logger.log(`${data.userName} joined chat room: ${data.roomId}`);
  }

  @SubscribeMessage('send-message')
  async handleMessage(
    @MessageBody() data: ChatMessage,
    @ConnectedSocket() client: Socket,
  ) {
    if (!(await this.ensureRoomOwnership(client, data?.roomId || ''))) {
      throw new WsException('Forbidden room');
    }
    const userMessage: ChatMessage = {
      ...data,
      timestamp: new Date().toISOString(),
    };

    // 1. Broadcast user message to everyone in the room
    this.server.to(data.roomId).emit('message', userMessage);

    // 2. Forward to AI and broadcast the reply
    try {
      const language = data.language || 'english';
      const { reply, audioBase64 } = await this.voiceService.chatVoice({
        sessionId: data.roomId,
        prompt: data.content,
        language,
      });

      const aiMessage: ChatMessage = {
        roomId: data.roomId,
        senderId: 'ai',
        senderName: 'AI Interviewer',
        content: reply,
        timestamp: new Date().toISOString(),
      };

      this.server.to(data.roomId).emit('message', aiMessage);
      
      // Nếu có đoạn thu âm PCM, gửi xuống Frontend để nhép môi Simli
      if (audioBase64) {
        this.server.to(data.roomId).emit('ai-audio', { audioBase64 });
      }
    } catch (err) {
      this.logger.error('AI reply failed', err);
      // Emit an error notice only to the sender so the room isn't disrupted
      client.emit('ai-error', { message: 'AI is temporarily unavailable.' });
    }
  }

  @SubscribeMessage('leave-room')
  async handleLeaveRoom(
    @MessageBody() data: { roomId: string; userName: string },
    @ConnectedSocket() client: Socket,
  ) {
    if (!(await this.ensureRoomOwnership(client, data?.roomId || ''))) {
      throw new WsException('Forbidden room');
    }
    client.leave(data.roomId);
    client.to(data.roomId).emit('user-left', { userName: data.userName, socketId: client.id });
  }
}

