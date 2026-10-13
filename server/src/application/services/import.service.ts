import type { Logger } from '../../config/logger.js';
import { ValidationError } from '../../domain/errors.js';
import { SOURCE_SPECS, type SourceId } from '../../domain/sources.js';
import { StickerPackModel, type StickerPackDocument } from '../../infrastructure/db/models/sticker-pack.model.js';
import type { TaskQueue } from '../../infrastructure/queue/task-queue.js';
import type { PackService } from './pack.service.js';
import type { CollectedFile, RemotePreviewService } from './remote-preview.service.js';
import type { IngestResult, StickerIngestService } from './sticker-ingest.service.js';

type Collect = (onEach: (ok: boolean) => Promise<void>) => Promise<{ files: CollectedFile[]; failed: IngestResult['failed'] }>;

/**
 * Brings stickers from a source platform into Stickify. Every flow goes through a review
 * session (RemotePreviewService) so the user sees – and can untick – stickers first:
 *
 *   link or upload  →  review session  →  new pack (background job) / existing pack
 */
export class ImportService {
  constructor(
    private readonly previews: RemotePreviewService,
    private readonly packs: PackService,
    private readonly ingest: StickerIngestService,
    private readonly jobQueue: TaskQueue,
    private readonly logger: Logger,
  ) {}

  /** Loads a pack from a share link for review: title, counts, previewId and sticker list. */
  async inspect(source: SourceId, input: string) {
    return this.previews.describe(await this.previews.open(source, input));
  }

  /**
   * Loads uploaded files for review. Archives (.wastickers/.zip) are unpacked so their
   * contents can be reviewed one by one. `appendTo` adds files to an existing upload review.
   */
  async previewUpload(source: SourceId, uploads: Array<{ buffer: Buffer; filename: string }>, appendTo?: string) {
    if (uploads.length === 0) throw new ValidationError('No files selected');
    const { session, failed } = await this.previews.openUpload(source, uploads, appendTo);
    return { ...this.previews.describe(session), failed };
  }

  /** Imports a reviewed pack (optionally only the stickers in `indices`) into a NEW pack, in the background. */
  async importFromPreview(ownerId: string, previewId: string, indices?: number[], title?: string): Promise<StickerPackDocument> {
    const session = this.previews.get(previewId);
    const selected = this.previews.normalizeIndices(session, indices);
    const { pack: preview } = session;
    const label = SOURCE_SPECS[preview.source].label;

    const pack = await this.packs.create(
      ownerId,
      {
        title: (title?.trim() || preview.title || `${label} stickers`).slice(0, 64),
        author: (preview.author || (preview.origin === 'link' ? label : '')).slice(0, 64),
        description: preview.source === 'file' ? '' : `Imported from ${label}`,
      },
      preview.origin === 'link'
        ? // A Signal URL contains the pack_key (decryption key) – never store it.
          { type: 'link', platform: preview.source, externalId: preview.externalId, url: preview.source === 'signal' ? undefined : preview.url }
        : { type: preview.source === 'file' ? 'upload' : 'archive', platform: preview.source },
    );
    pack.importState = { status: 'importing', done: 0, total: selected.length };
    await pack.save();

    this.jobQueue.enqueue(`import:${preview.source}:${pack.id}`, () =>
      this.runImport(pack, (onEach) => this.previews.collectById(previewId, selected, onEach)),
    );
    return pack;
  }

  /** Adds reviewed stickers to an EXISTING pack (used by the pack editor's upload). */
  async addFromPreview(ownerId: string, packId: string, previewId: string, indices?: number[]): Promise<IngestResult> {
    const pack = await this.packs.getOwned(ownerId, packId);
    const collected = await this.previews.collectById(previewId, indices);
    const result = await this.ingest.ingestMany(pack, collected.files);
    await StickerPackModel.updateOne({ _id: pack._id }, { $currentDate: { updatedAt: true } });
    return { items: result.items, failed: [...collected.failed, ...result.failed] };
  }

  /** Imports straight from a link without a separate review step (Telegram bot, API clients). */
  async importFromLink(ownerId: string, source: SourceId, input: string, indices?: number[]): Promise<StickerPackDocument> {
    const session = await this.previews.open(source, input);
    if (session.pack.stickers.length === 0) throw new ValidationError('The sticker pack is empty');
    return this.importFromPreview(ownerId, session.id, indices);
  }

  private async runImport(pack: StickerPackDocument, collect: Collect): Promise<void> {
    const bump = () => StickerPackModel.updateOne({ _id: pack._id }, { $inc: { 'importState.done': 1 } }).then(() => undefined);
    try {
      // Progress = stickers finished (on ingest when they succeed, right away when a download fails).
      const download = await collect(async (ok) => (ok ? undefined : bump()));
      const result = await this.ingest.ingestMany(pack, download.files, bump);
      const failed = [...download.failed, ...result.failed];

      await StickerPackModel.updateOne(
        { _id: pack._id },
        {
          $set: {
            'importState.status': result.items.length > 0 ? 'done' : 'failed',
            'importState.error': failed.length ? `${failed.length} sticker(s) failed: ${failed[0]!.message}` : undefined,
          },
        },
      );
    } catch (err) {
      this.logger.error({ err, pack: pack.id }, 'Import failed');
      await StickerPackModel.updateOne(
        { _id: pack._id },
        { $set: { 'importState.status': 'failed', 'importState.error': (err as Error).message } },
      );
    }
  }

  /** After a restart, in-flight imports are lost → mark them so the user knows. */
  async failInterruptedImports(): Promise<void> {
    await StickerPackModel.updateMany(
      { 'importState.status': 'importing' },
      { $set: { 'importState.status': 'failed', 'importState.error': 'The server restarted during the import' } },
    );
  }
}
