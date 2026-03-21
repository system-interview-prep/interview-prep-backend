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
import { AiService } from '../ai/ai.service';

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
 * After each user message, forwards content to AiService and relays the reply.
 */
@WebSocketGateway({ namespace: '/chat', cors: { origin: '*' } })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(ChatGateway.name);

  constructor(private readonly aiService: AiService) {}

  handleConnection(client: Socket) {
    this.logger.log(`Chat client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Chat client disconnected: ${client.id}`);
  }

  @SubscribeMessage('join-room')
  handleJoinRoom(
    @MessageBody() data: { roomId: string; userName: string },
    @ConnectedSocket() client: Socket,
  ) {
    client.join(data.roomId);
    client.to(data.roomId).emit('user-joined', { userName: data.userName, socketId: client.id });
    this.logger.log(`${data.userName} joined chat room: ${data.roomId}`);
  }

  @SubscribeMessage('send-message')
  async handleMessage(
    @MessageBody() data: ChatMessage,
    @ConnectedSocket() client: Socket,
  ) {
    const userMessage: ChatMessage = {
      ...data,
      timestamp: new Date().toISOString(),
    };

    // 1. Broadcast user message to everyone in the room
    this.server.to(data.roomId).emit('message', userMessage);

    // 2. Forward to AI and broadcast the reply
    try {
      const language = data.language || 'english';
      const reply = await this.aiService.chat(
        data.roomId,                          // use roomId as sessionId
        { role: 'user', content: data.content },
        language,
      );

      const aiMessage: ChatMessage = {
        roomId: data.roomId,
        senderId: 'ai',
        senderName: 'AI Interviewer',
        content: reply,
        timestamp: new Date().toISOString(),
      };

      this.server.to(data.roomId).emit('message', aiMessage);
    } catch (err) {
      this.logger.error('AI reply failed', err);
      // Emit an error notice only to the sender so the room isn't disrupted
      client.emit('ai-error', { message: 'AI is temporarily unavailable.' });
    }
  }

  @SubscribeMessage('leave-room')
  handleLeaveRoom(
    @MessageBody() data: { roomId: string; userName: string },
    @ConnectedSocket() client: Socket,
  ) {
    client.leave(data.roomId);
    client.to(data.roomId).emit('user-left', { userName: data.userName, socketId: client.id });
  }
}

