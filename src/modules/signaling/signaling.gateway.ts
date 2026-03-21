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
 * SignalingGateway – WebRTC signaling relay via Socket.IO.
 *
 * Relay flow:
 *  1. Two peers join the same room (join-room)
 *  2. Caller sends offer → server relays to callee
 *  3. Callee answers → server relays to caller
 *  4. Both exchange ICE candidates via server
 */
@WebSocketGateway({ namespace: '/signaling', cors: { origin: '*' } })
export class SignalingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(SignalingGateway.name);

  handleConnection(client: Socket) {
    this.logger.log(`Signaling client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Signaling client disconnected: ${client.id}`);
  }

  @SubscribeMessage('join-room')
  handleJoinRoom(
    @MessageBody() data: { roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    client.join(data.roomId);
    client.to(data.roomId).emit('peer-joined', { socketId: client.id });
    this.logger.log(`${client.id} joined room: ${data.roomId}`);
  }

  @SubscribeMessage('offer')
  handleOffer(
    @MessageBody() data: { roomId: string; offer: RTCSessionDescriptionInit },
    @ConnectedSocket() client: Socket,
  ) {
    client.to(data.roomId).emit('offer', { offer: data.offer, from: client.id });
  }

  @SubscribeMessage('answer')
  handleAnswer(
    @MessageBody() data: { roomId: string; answer: RTCSessionDescriptionInit },
    @ConnectedSocket() client: Socket,
  ) {
    client.to(data.roomId).emit('answer', { answer: data.answer, from: client.id });
  }

  @SubscribeMessage('ice-candidate')
  handleIceCandidate(
    @MessageBody() data: { roomId: string; candidate: RTCIceCandidateInit },
    @ConnectedSocket() client: Socket,
  ) {
    client.to(data.roomId).emit('ice-candidate', { candidate: data.candidate, from: client.id });
  }

  @SubscribeMessage('leave-room')
  handleLeaveRoom(
    @MessageBody() data: { roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    client.leave(data.roomId);
    client.to(data.roomId).emit('peer-left', { socketId: client.id });
    this.logger.log(`${client.id} left room: ${data.roomId}`);
  }
}
