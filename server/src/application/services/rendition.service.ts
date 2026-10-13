import { createHash } from 'node:crypto';
import type { MediaInfo, OutputFormat, ProcessingOptions } from '../../domain/media.js';
import { OUTPUT_META } from '../../domain/media.js';
import type { PlatformSpec } from '../../domain/platforms.js';
import type { StickerItemDocument } from '../../infrastructure/db/models/sticker-item.model.js';
import type { TaskQueue } from '../../infrastructure/queue/task-queue.js';
import type { MediaProcessorPort, ProcessedMedia } from '../ports/media.port.js';
import type { StoragePort } from '../ports/storage.port.js';
import { itemPrefix } from './sticker-ingest.service.js';

/**
 * Bump when processing changes, to invalidate every cached rendition.
 * v2: warnings are stored in English (v1 caches held Vietnamese text).
 */
const ENGINE_VERSION = 2;

interface RenditionMeta {
  format: OutputFormat;
  width: number;
  height: number;
  animated: boolean;
  warnings: string[];
}

export function itemMediaInfo(item: StickerItemDocument): MediaInfo {
  const o = item.original;
  return {
    format: o.format,
    kind: o.kind,
    mime: o.mime,
    width: o.width,
    height: o.height,
    frames: o.frames ?? 1,
    durationMs: o.durationMs ?? 0,
    codec: o.codec ?? undefined,
  };
}

/**
 * A sticker's conversion (rendition) for one platform + options. Results are cached in
 * storage under a deterministic key → the live preview, ZIP export and Telegram push
 * reuse the same file instead of processing again.
 */
export class RenditionService {
  constructor(
    private readonly storage: StoragePort,
    private readonly media: MediaProcessorPort,
    private readonly queue: TaskQueue,
  ) {}

  private cacheKey(item: StickerItemDocument, spec: PlatformSpec, options: ProcessingOptions): string {
    const fingerprint = JSON.stringify({
      v: ENGINE_VERSION,
      canvas: spec.canvas,
      static: spec.static,
      animated: spec.animated,
      lottie: spec.acceptsLottie,
      o: [options.trim, options.padding, options.borderWidth, options.borderColor.toLowerCase()],
    });
    const hash = createHash('sha1').update(fingerprint).digest('hex').slice(0, 16);
    return `${itemPrefix(item.pack.toString(), item.id)}/renditions/${spec.id}-${hash}`;
  }

  async render(item: StickerItemDocument, spec: PlatformSpec, options: ProcessingOptions): Promise<ProcessedMedia> {
    const base = this.cacheKey(item, spec, options);
    const metaKey = `${base}.json`;

    if (await this.storage.exists(metaKey)) {
      try {
        const meta = JSON.parse((await this.storage.get(metaKey)).toString('utf8')) as RenditionMeta;
        const { ext, mime } = OUTPUT_META[meta.format];
        const buffer = await this.storage.get(`${base}.${ext}`);
        return { ...meta, buffer, ext, mime };
      } catch {
        // Broken/missing cache → process again below.
      }
    }

    const input = await this.storage.get(item.original.key);
    const result = await this.queue.run(() => this.media.processForPlatform(input, itemMediaInfo(item), spec, options));

    const meta: RenditionMeta = {
      format: result.format,
      width: result.width,
      height: result.height,
      animated: result.animated,
      warnings: result.warnings,
    };
    // File first, meta second: if the meta exists, the file is guaranteed to be complete.
    await this.storage.put(`${base}.${result.ext}`, result.buffer);
    await this.storage.put(metaKey, Buffer.from(JSON.stringify(meta)));
    return result;
  }

  /** Tray icon for a pack (WhatsApp/Telegram). */
  async trayIcon(item: StickerItemDocument, spec: PlatformSpec, options: ProcessingOptions): Promise<ProcessedMedia | null> {
    if (!spec.tray || item.original.kind === 'lottie') return null;
    const input = await this.storage.get(item.original.key);
    return this.queue.run(() => this.media.makeTrayIcon(input, itemMediaInfo(item), spec.tray!, options));
  }
}
