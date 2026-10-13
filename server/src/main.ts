import { mkdir } from 'node:fs/promises';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { createContainer } from './container.js';
import { connectDatabase, disconnectDatabase } from './infrastructure/db/connection.js';
import { createApp } from './interfaces/http/app.js';

async function main(): Promise<void> {
  await mkdir(env.STORAGE_DIR, { recursive: true });
  await connectDatabase(env.MONGODB_URI, logger);

  const c = createContainer(env, logger);

  // Clean up unfinished work from the previous run (the queues live in memory, so it is lost).
  const interrupted = await c.exports.failInterruptedJobs();
  await c.importer.failInterruptedImports();
  if (interrupted) logger.warn({ interrupted }, 'Marked interrupted export jobs as failed');

  const server = createApp(c).listen(env.PORT, () => {
    logger.info(`Stickify API listening on http://localhost:${env.PORT}`);
  });
  // Uploads/conversions of videos can take tens of seconds.
  server.requestTimeout = 5 * 60 * 1000;

  if (c.bot) {
    c.bot.start().catch((err) => logger.error({ err }, 'Could not start the Telegram bot (check TELEGRAM_BOT_TOKEN)'));
  } else if (!c.telegram.configured) {
    logger.info('TELEGRAM_BOT_TOKEN is not set – Telegram features are disabled');
  }

  // Graceful shutdown: stop accepting requests, stop the bot, close the DB.
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down...');
    const force = setTimeout(() => process.exit(1), 15_000);
    force.unref();
    await c.bot?.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await disconnectDatabase();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

process.on('unhandledRejection', (reason) => logger.error({ err: reason }, 'Unhandled promise rejection'));

main().catch((err) => {
  logger.fatal({ err }, 'Startup failed');
  process.exit(1);
});
