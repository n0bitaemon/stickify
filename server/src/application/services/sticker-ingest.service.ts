import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import { ConflictError, MediaError } from '../../domain/errors.js';
import type { MediaInfo } from '../../domain/media.js';
import { StickerItemModel, type StickerItemDocument } from '../../infrastructure/db/models/sticker-item.model.js';
import { StickerPackModel, type StickerPackDocument } from '../../infrastructure/db/models/sticker-pack.model.js';
import { mapLimit, type TaskQueue } from '../../infrastructure/queue/task-queue.js';
import type { MediaProcessorPort } from '../ports/media.port.js';
import type { StoragePort } from '../ports/storage.port.js';

export const MAX_STICKERS_PER_PACK = 200;
const MAX_DIMENSION = 8192;
const MAX_VIDEO_MS = 60_000;

export interface IngestInput {
  buffer: Buffer;
  filename?: string;
  emojis?: string[];
  telegram?: { fileId: string; fileUniqueId: string };
}

export interface IngestResult {
  items: StickerItemDocument[];
  failed: Array<{ filename: string; message: string }>;
}

export const itemPrefix = (packId: string, itemId: string) => `packs/${packId}/items/${itemId}`;

/**
 * Brings a file into the system: detect the real format → check limits → reject duplicates →
 * store the original + thumbnail → create the StickerItem. Shared by web uploads, link
 * imports and files sent to the bot.
 */
export class StickerIngestService {
  constructor(
    private readonly storage: StoragePort,
    private readonly media: MediaProcessorPort,
    private readonly queue: TaskQueue,
  ) {}

  private validate(info: MediaInfo): void {
    if (info.width < 16 || info.height < 16) throw new MediaError('Image is too small (at least 16×16px)');
    if (info.width > MAX_DIMENSION || info.height > MAX_DIMENSION) {
      throw new MediaError(`Image is too large (at most ${MAX_DIMENSION}px per side)`);
    }
    if (info.kind === 'video' && info.durationMs > MAX_VIDEO_MS) throw new MediaError('Video is longer than 60 seconds');
  }

  /** Adds one file to a pack at a given position. Cleans up written files if a later step fails. */
  async ingestOne(pack: StickerPackDocument, input: IngestInput, position: number): Promise<StickerItemDocument> {
    const contentHash = createHash('sha256').update(input.buffer).digest('hex');
    if (await StickerItemModel.exists({ pack: pack._id, contentHash })) {
      throw new ConflictError('This sticker is already in the pack');
    }

    const info = await this.media.probe(input.buffer);
    this.validate(info);

    const id = new Types.ObjectId();
    const prefix = itemPrefix(pack.id, id.toString());
    const ext = info.format === 'jpeg' ? 'jpg' : info.format;

    try {
      // Thumbnails go through the shared queue so the media concurrency limit is respected.
      const thumb = await this.queue.run(() => this.media.makeThumbnail(input.buffer, info));
      const original = await this.storage.put(`${prefix}/original.${ext}`, input.buffer);
      const thumbKey = thumb ? (await this.storage.put(`${prefix}/thumb.${thumb.ext}`, thumb.buffer)).key : undefined;

      return await StickerItemModel.create({
        _id: id,
        pack: pack._id,
        owner: pack.owner,
        position,
        emojis: input.emojis?.length ? input.emojis : [pack.defaultEmoji || '🙂'],
        original: {
          key: original.key,
          filename: input.filename?.slice(0, 255),
          mime: info.mime,
          format: info.format,
          kind: info.kind,
          bytes: original.bytes,
          width: info.width,
          height: info.height,
          frames: info.frames,
          durationMs: info.durationMs,
          codec: info.codec,
        },
        thumbnail: thumb ? { key: thumbKey, mime: thumb.mime, animated: thumb.animated } : undefined,
        contentHash,
        telegram: input.telegram,
      });
    } catch (err) {
      await this.storage.deletePrefix(prefix).catch(() => undefined);
      throw err;
    }
  }

  /**
   * Adds many files. One failing file does not spoil the batch – successes and failures
   * are returned so the UI can say exactly which files were rejected and why.
   */
  async ingestMany(pack: StickerPackDocument, inputs: IngestInput[], onProgress?: () => Promise<void>): Promise<IngestResult> {
    const failed: IngestResult['failed'] = [];
    const current = await StickerItemModel.countDocuments({ pack: pack._id });
    const room = Math.max(0, MAX_STICKERS_PER_PACK - current);

    // Drop duplicates within the same batch (files are processed in parallel, so the DB
    // check in ingestOne cannot reliably catch this case).
    const seen = new Set<string>();
    const unique = inputs.filter((input) => {
      const hash = createHash('sha256').update(input.buffer).digest('hex');
      if (!seen.has(hash)) return seen.add(hash);
      failed.push({ filename: input.filename ?? 'file', message: 'Duplicate file in the same upload' });
      return false;
    });

    const accepted = unique.slice(0, room);
    for (const extra of unique.slice(room)) {
      failed.push({ filename: extra.filename ?? 'file', message: `The pack already has ${MAX_STICKERS_PER_PACK} stickers` });
    }

    const last = await StickerItemModel.findOne({ pack: pack._id }).sort({ position: -1 }).select('position').lean();
    const start = (last?.position ?? -1) + 1;

    const results = await mapLimit(accepted, 3, async (input, i) => {
      try {
        return await this.ingestOne(pack, input, start + i);
      } catch (err) {
        failed.push({ filename: input.filename ?? `file ${i + 1}`, message: (err as Error).message });
        return null;
      } finally {
        await onProgress?.();
      }
    });

    await refreshPackStats(pack._id);
    return { items: results.filter((r): r is StickerItemDocument => r !== null), failed };
  }
}

/** Recomputes a pack's denormalised counters after its sticker list changes. */
export async function refreshPackStats(packId: Types.ObjectId): Promise<void> {
  const [stats] = await StickerItemModel.aggregate<{ count: number; animated: number; bytes: number }>([
    { $match: { pack: packId } },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        animated: { $sum: { $cond: [{ $in: ['$original.kind', ['animated', 'video', 'lottie']] }, 1, 0] } },
        bytes: { $sum: '$original.bytes' },
      },
    },
  ]);
  const cover = await StickerItemModel.findOne({ pack: packId }).sort({ position: 1 }).select('_id').lean();
  await StickerPackModel.updateOne(
    { _id: packId },
    {
      $set: {
        stickerCount: stats?.count ?? 0,
        animatedCount: stats?.animated ?? 0,
        totalBytes: stats?.bytes ?? 0,
        coverItem: cover?._id ?? null,
      },
    },
  );
}
