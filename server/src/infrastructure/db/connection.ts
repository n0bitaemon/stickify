import mongoose from 'mongoose';
import type { Logger } from '../../config/logger.js';

/**
 * Normalises JSON sent to clients: `_id` → `id`, no `__v`.
 * Set globally so every model shares it and controllers do not map by hand.
 */
mongoose.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret: Record<string, unknown>) => {
    delete ret._id;
    return ret;
  },
});
mongoose.set('strictQuery', true);

export async function connectDatabase(uri: string, logger: Logger): Promise<typeof mongoose> {
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));

  // Moderate pool: queries are light, the heavy part is media processing (already limited by the queue).
  const conn = await mongoose.connect(uri, {
    maxPoolSize: 20,
    serverSelectionTimeoutMS: 10_000,
    socketTimeoutMS: 45_000,
  });
  logger.info({ db: conn.connection.name }, 'Connected to MongoDB');
  return conn;
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}
