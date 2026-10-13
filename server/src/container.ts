import { AuthService } from './application/services/auth.service.js';
import { ConvertService } from './application/services/convert.service.js';
import { ExportService } from './application/services/export.service.js';
import { ImportService } from './application/services/import.service.js';
import { PackService } from './application/services/pack.service.js';
import { RemotePreviewService } from './application/services/remote-preview.service.js';
import { RenditionService } from './application/services/rendition.service.js';
import { SourceRegistry } from './application/services/source-registry.js';
import { StickerIngestService } from './application/services/sticker-ingest.service.js';
import { TelegramAccountService } from './application/services/telegram-account.service.js';
import { TelegramPublishService } from './application/services/telegram-publish.service.js';
import type { Env } from './config/env.js';
import type { Logger } from './config/logger.js';
import { configureFfmpeg } from './infrastructure/media/ffmpeg.processor.js';
import { StickerProcessor } from './infrastructure/media/sticker.processor.js';
import { TaskQueue } from './infrastructure/queue/task-queue.js';
import { SignalSource } from './infrastructure/sources/signal.source.js';
import { TelegramSource } from './infrastructure/sources/telegram.source.js';
import { LocalStorage } from './infrastructure/storage/local.storage.js';
import { TelegramBot } from './infrastructure/telegram/telegram.bot.js';
import { TelegramClient } from './infrastructure/telegram/telegram.client.js';

/**
 * Composition root: the ONLY place that knows which concrete implementations are used.
 * Swapping LocalStorage → S3Storage or TaskQueue → BullMQ only touches this file.
 */
export function createContainer(env: Env, logger: Logger) {
  configureFfmpeg({ ffmpeg: env.FFMPEG_PATH, ffprobe: env.FFPROBE_PATH });

  const storage = new LocalStorage(env.STORAGE_DIR);
  const media = new StickerProcessor();
  // Two separate queues to avoid deadlocks when a background job waits on media work (see TaskQueue).
  const mediaQueue = new TaskQueue(env.PROCESSING_CONCURRENCY, logger);
  const jobQueue = new TaskQueue(env.JOB_CONCURRENCY, logger);
  const telegram = new TelegramClient(env.TELEGRAM_BOT_TOKEN);

  const auth = new AuthService({ jwtSecret: env.JWT_SECRET, jwtExpiresIn: env.JWT_EXPIRES_IN });
  const ingest = new StickerIngestService(storage, media, mediaQueue);
  const packs = new PackService(storage, ingest);
  const renditions = new RenditionService(storage, media, mediaQueue);
  const publisher = new TelegramPublishService(telegram);
  const exports = new ExportService(storage, packs, renditions, publisher, jobQueue, logger);
  // To add a source platform: write a provider and add it to this list.
  const sources = new SourceRegistry([new TelegramSource(telegram), new SignalSource()]);
  const previews = new RemotePreviewService(sources, media, mediaQueue);
  const importer = new ImportService(previews, packs, ingest, jobQueue, logger);
  const accounts = new TelegramAccountService(telegram);
  const convert = new ConvertService(media, mediaQueue, previews);

  const bot =
    telegram.configured && env.TELEGRAM_BOT_POLLING
      ? new TelegramBot(telegram, accounts, packs, ingest, importer, sources, logger)
      : null;

  return {
    env,
    logger,
    storage,
    media,
    mediaQueue,
    jobQueue,
    telegram,
    auth,
    ingest,
    packs,
    renditions,
    exports,
    sources,
    previews,
    importer,
    accounts,
    convert,
    bot,
  };
}

export type Container = ReturnType<typeof createContainer>;
