import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({ namespace: '/cv', cors: { origin: '*' } })
export class CvStatusGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(CvStatusGateway.name);

  handleConnection(client: Socket) {
    this.logger.log(`[CV] Client connected: ${client.id}`);
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
    const room = `cv:${data?.cvId}`;
    if (data?.cvId) client.join(room);
    return { joined: Boolean(data?.cvId), room };
  }

  emitStatus(cvId: string, payload: Record<string, any>) {
    this.server.to(`cv:${cvId}`).emit('cv.status', payload);
  }
}

