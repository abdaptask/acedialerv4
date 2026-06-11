import { Emitter } from '@socket.io/redis-emitter';
import { Redis } from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redisClient = new Redis(redisUrl);

export const ioEmitter = new Emitter(redisClient);

/**
 * Emit an event to a specific user's room.
 * The socket service automatically places users into `user:${userId}` rooms upon authentication.
 */
export function emitToUser(userId: number, event: string, payload: any) {
  ioEmitter.to(`user:${userId}`).emit(event, payload);
}
