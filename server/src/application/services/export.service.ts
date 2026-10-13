import type { Readable } from 'node:stream';
import type { Types } from 'mongoose';
import type { Logger } from '../../config/logger.js';
import { AppError, NotFoundError, ValidationError } from '../../domain/errors.js';
import type { ProcessingOptions } from '../../domain/media.js';
import { getPlatformSpec, type PlatformId } from '../../domain/platforms.js';
import { ExportJobModel, type ExportJobDocument } from '../../infrastructure/db/models/export-job.model.js';
import type { StickerItemDocument } from '../../infrastructure/db/models/sticker-item.model.js';
import type { StickerPackDocument } from '../../infrastructure/db/models/sticker-pack.model.js';
import { mapLimit, type TaskQueue } from '../../infrastructure/queue/task-queue.js';
import type { ProcessedMedia } from '../ports/media.port.js';
import type { StoragePort } from '../ports/storage.port.js';
import { slugify, toObjectId } from './ids.js';
import type { PackService } from './pack.service.js';
import type { RenditionService } from './rendition.service.js';
import type { TelegramPublishService } from './telegram-publish.service.js';
import { buildStickerZip, groupForPlatform, type ZipGroup } from './zip-builder.js';

export interface CreateExportInput {
  platform: PlatformId;
  target: 'zip' | 'telegram';
  options?: Partial<ProcessingOptions>;
}

interface JobWarning {
  item?: Types.ObjectId;
  message: string;
}

export interface RenderedItem {
  item: StickerItemDocument;
  media: ProcessedMedia;
}

/**
 * Exports a pack to a target platform. Jobs run in the background through the TaskQueue;
 * the client gets 202 + the job id and polls GET /api/exports/:id. The resulting ZIP is
 * kept as conversion history.
 */
export class ExportService {
  constructor(
    private readonly storage: StoragePort,
    private readonly packs: PackService,
    private readonly renditions: RenditionService,
    private readonly publisher: TelegramPublishService,
    private readonly queue: TaskQueue,
    private readonly logger: Logger,
  ) {}

  async create(ownerId: string, packId: string, input: CreateExportInput): Promise<ExportJobDocument> {
    const pack = await this.packs.getOwned(ownerId, packId);
    const spec = getPlatformSpec(input.platform);

    if (pack.importState?.status === 'importing') throw new ValidationError('The pack is still importing – please wait for it to finish');
    if (pack.stickerCount === 0) throw new ValidationError('The pack has no stickers yet');
    if (pack.stickerCount < spec.pack.min) {
      throw new ValidationError(`${spec.label} needs at least ${spec.pack.min} stickers per pack (this pack has ${pack.stickerCount})`);
    }
    if (input.target === 'telegram' && !spec.directPublish) {
      throw new ValidationError(`${spec.label} does not support direct publishing – download the ZIP instead`);
    }

    const options = { ...pack.toObject().processing, ...input.options } as ProcessingOptions;
    const job = await ExportJobModel.create({
      owner: pack.owner,
      pack: pack._id,
      packTitle: pack.title,
      platform: spec.id,
      target: input.target,
      options,
      progress: { done: 0, total: pack.stickerCount },
    });

    this.queue.enqueue(`export:${job.id}`, () => this.run(job.id));
    return job;
  }

  /** The background job. Every error is written to the job for the user to see – nothing is thrown. */
  private async run(jobId: string): Promise<void> {
    const job = await ExportJobModel.findById(jobId);
    if (!job) return;
    job.status = 'processing';
    job.startedAt = new Date();
    await job.save();

    try {
      const { pack, items } = await this.packs.getWithItems(job.owner.toString(), job.pack.toString());
      const spec = getPlatformSpec(job.platform);
      const options = job.toObject().options as ProcessingOptions;
      const warnings: JobWarning[] = [];

      // Processing itself is limited by the TaskQueue; mapLimit only avoids creating hundreds of promises at once.
      const rendered = await mapLimit(items, 4, async (item): Promise<RenderedItem | null> => {
        try {
          const media = await this.renditions.render(item, spec, options);
          for (const w of media.warnings) warnings.push({ item: item._id, message: `#${item.position + 1}: ${w}` });
          return { item, media };
        } catch (err) {
          warnings.push({ item: item._id, message: `#${item.position + 1}: ${(err as Error).message} – skipped` });
          return null;
        } finally {
          await ExportJobModel.updateOne({ _id: job._id }, { $inc: { 'progress.done': 1 } });
        }
      });
      const ok = rendered.filter((r): r is RenderedItem => r !== null);
      if (ok.length === 0) throw new AppError('None of the stickers could be processed for this platform', 422, 'EXPORT_EMPTY');

      if (job.target === 'telegram') {
        const url = await this.publisher.publish(pack, ok);
        job.result = { telegramUrl: url, stickerCount: ok.length };
      } else {
        job.result = await this.writeZip(job, pack, ok, options, warnings);
      }

      job.set('warnings', warnings);
      job.status = 'completed';
    } catch (err) {
      this.logger.warn({ err, jobId }, 'Export failed');
      job.status = 'failed';
      job.error = err instanceof AppError ? err.message : 'Unexpected error while exporting the pack';
    } finally {
      job.finishedAt = new Date();
      await job.save();
    }
  }

  private async writeZip(
    job: ExportJobDocument,
    pack: StickerPackDocument,
    rendered: RenderedItem[],
    options: ProcessingOptions,
    /** Pack-level warnings (e.g. a sub-pack with too few stickers) are added here so the UI shows them too. */
    warnings: JobWarning[],
  ) {
    const spec = getPlatformSpec(job.platform);
    const grouped = groupForPlatform(
      rendered.map((r) => ({ ...r, animated: r.media.animated })),
      spec,
    );

    const groups: ZipGroup[] = [];
    for (const g of grouped) {
      // The tray icon comes from the first sticker that can produce a still image.
      const trayItem = g.items.find((r) => r.item.original.kind !== 'lottie');
      const tray = trayItem ? await this.renditions.trayIcon(trayItem.item, spec, options) : null;
      if (spec.pack.min > 1 && g.items.length < spec.pack.min) {
        warnings.push({ message: `A sub-pack only has ${g.items.length} stickers (${spec.label} needs at least ${spec.pack.min})` });
      }
      groups.push({ animated: g.animated, tray, stickers: g.items.map((r) => ({ media: r.media, emojis: r.item.emojis })) });
    }

    const key = `exports/${job.owner.toString()}/${job.id}.zip`;
    const zip = buildStickerZip({ title: pack.title, author: pack.author ?? '', spec, warnings: warnings.map((w) => w.message) }, groups);
    const { bytes } = await this.storage.put(key, zip);
    return { key, bytes, filename: `${slugify(pack.title)}-${spec.id}.zip`, stickerCount: rendered.length };
  }

  history(ownerId: string, packId?: string) {
    const filter: Record<string, unknown> = { owner: toObjectId(ownerId) };
    if (packId) filter.pack = toObjectId(packId, 'Pack');
    return ExportJobModel.find(filter).sort({ createdAt: -1 }).limit(100);
  }

  async get(ownerId: string, jobId: string): Promise<ExportJobDocument> {
    const job = await ExportJobModel.findOne({ _id: toObjectId(jobId, 'Export'), owner: toObjectId(ownerId) });
    if (!job) throw new NotFoundError('Export');
    return job;
  }

  async openDownload(ownerId: string, jobId: string): Promise<{ stream: Readable; filename: string; bytes: number }> {
    const job = await this.get(ownerId, jobId);
    if (job.status !== 'completed' || !job.result?.key) throw new ValidationError('The ZIP file is not ready yet');
    const stat = await this.storage.stat(job.result.key);
    if (!stat) throw new NotFoundError('ZIP file');
    return { stream: this.storage.createReadStream(job.result.key), filename: job.result.filename ?? 'stickers.zip', bytes: stat.bytes };
  }

  /** After a restart, in-memory jobs are lost → mark them failed so the UI does not hang. */
  async failInterruptedJobs(): Promise<number> {
    const res = await ExportJobModel.updateMany(
      { status: { $in: ['queued', 'processing'] } },
      { $set: { status: 'failed', error: 'The server restarted during processing – please export again', finishedAt: new Date() } },
    );
    return res.modifiedCount;
  }
}
