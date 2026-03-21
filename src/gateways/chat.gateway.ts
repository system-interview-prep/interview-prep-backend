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

/**
 * Centralized ChatGateway – realtime messaging.
 * Re-exports the logic from modules/chat/chat.gateway.ts.
 */
@WebSocketGateway({ namespace: '/chat', cors: { origin: '*' } })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(ChatGateway.name);

  handleConnection(client: Socket) {
    this.logger.log(`[Chat] Client connected: ${client.id}`);
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
