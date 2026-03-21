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
 * Centralized SignalingGateway – WebRTC signaling relay.
 * Re-exports the logic from modules/signaling/signaling.gateway.ts.
 * Use this file if you prefer a single top-level gateway instead of
 * mounting it inside the SignalingModule.
 */
@WebSocketGateway({ namespace: '/signaling', cors: { origin: '*' } })
export class SignalingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(SignalingGateway.name);

  handleConnection(client: Socket) {
    this.logger.log(`[Signaling] Client connected: ${client.id}`);
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
