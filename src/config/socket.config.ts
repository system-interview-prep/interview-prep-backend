/**
 * socket.config.ts
 * WebSocket / Socket.IO server configuration.
 * Used by SignalingGateway and ChatGateway.
 */
export const socketConfig = {
  /** Port for the Socket.IO server (defaults to app port) */
  port: parseInt(process.env.SOCKET_PORT || '5000', 10),

  /** Allowed CORS origins for WebSocket connections */
  cors: {
    origin: process.env.SOCKET_CORS_ORIGIN || '*',
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
