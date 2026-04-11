/**
 * socket.config.ts
 * WebSocket / Socket.IO server configuration.
 * Used by SignalingGateway and ChatGateway.
 */
import { corsOrigins } from './cors.config';

export const socketConfig = {
  /** Port for the Socket.IO server (defaults to app port) */
  port: parseInt(process.env.SOCKET_PORT || '5000', 10),

  /** Allowed CORS origins for WebSocket connections */
  cors: {
    origin: corsOrigins,
    methods: ['GET', 'POST'],
  },

  /** Socket.IO namespaces */
  namespaces: {
    signaling: '/signaling',
    chat: '/chat',
  },

  /** Ping timeout / interval (ms) */
  pingTimeout: 60000,
  pingInterval: 25000,
};
