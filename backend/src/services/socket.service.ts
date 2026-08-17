import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { logger } from '../utils/logger';
import { verifyAccessToken } from '../utils/jwt';
import { query } from '../config/database';

class SocketService {
  private io: Server | null = null;

  initialize(httpServer: HttpServer): void {
    this.io = new Server(httpServer, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST'],
      },
      pingTimeout: 60000,
      pingInterval: 25000,
    });

    // Authentication middleware
    this.io.use(async (socket, next) => {
      try {
        const token =
          socket.handshake.auth?.token ||
          (socket.handshake.query?.token as string | undefined);
        if (token && typeof token === 'string') {
          const decoded = verifyAccessToken(token);
          (socket as Socket & { userId?: string; userRole?: string }).userId = decoded.id;
          (socket as Socket & { userId?: string; userRole?: string }).userRole = decoded.role;
        }
        next();
      } catch (_error) {
        // Allow unauthenticated connections but they won't join rooms
        next();
      }
    });

    this.io.on('connection', (socket: Socket) => {
      const userId = (socket as Socket & { userId?: string }).userId;
      logger.info(
        `[Socket] Client connected: ${socket.id}${userId ? ` (user: ${userId})` : ''}`
      );

      // Auto-join user's personal room for notifications
      if (userId) {
        socket.join(`user:${userId}`);
      }

      // Join order room (with ownership verification)
      socket.on('join-order', async (data: { orderId: string }) => {
        try {
          if (!userId) {
            socket.emit('error', { message: 'Authentication required' });
            return;
          }
          if (!data?.orderId) {
            socket.emit('error', { message: 'orderId is required' });
            return;
          }

          // Verify the user owns this order
          const result = await query<{ id: string }>(
            'SELECT id FROM orders WHERE id = $1 AND user_id = $2',
            [data.orderId, userId]
          );
          if (result.rows.length === 0) {
            socket.emit('error', { message: 'Order not found or access denied' });
            return;
          }

          socket.join(`order:${data.orderId}`);
          logger.debug(`[Socket] User ${userId} joined order room: ${data.orderId}`);
          socket.emit('joined-order', { orderId: data.orderId });
        } catch (error) {
          logger.error('[Socket] Error joining order room:', error);
          socket.emit('error', { message: 'Failed to join order room' });
        }
      });

      // Leave order room
      socket.on('leave-order', (data: { orderId: string }) => {
        if (data?.orderId) {
          socket.leave(`order:${data.orderId}`);
          logger.debug(`[Socket] Client ${socket.id} left order room: ${data.orderId}`);
        }
      });

      socket.on('disconnect', (reason: string) => {
        logger.info(`[Socket] Client disconnected: ${socket.id} (${reason})`);
      });
    });

    logger.info('[Socket] Socket.IO initialized');
  }

  emitOrderStatusUpdate(orderId: string, payload: object): void {
    if (!this.io) {
      logger.warn('[Socket] Socket.IO not initialized, skipping order status emit');
      return;
    }
    this.io.to(`order:${orderId}`).emit('order:status', payload);
    logger.debug(`[Socket] Emitted order:status to order:${orderId}`);
  }

  emitProductionStatusUpdate(orderId: string, payload: object): void {
    if (!this.io) {
      logger.warn('[Socket] Socket.IO not initialized, skipping production status emit');
      return;
    }
    this.io.to(`order:${orderId}`).emit('production:status', payload);
    logger.debug(`[Socket] Emitted production:status to order:${orderId}`);
  }

  emitNotification(userId: string, payload: object): void {
    if (!this.io) {
      logger.warn('[Socket] Socket.IO not initialized, skipping notification emit');
      return;
    }
    this.io.to(`user:${userId}`).emit('notification', payload);
    logger.debug(`[Socket] Emitted notification to user:${userId}`);
  }

  getIO(): Server | null {
    return this.io;
  }
}

const socketService = new SocketService();
export default socketService;
