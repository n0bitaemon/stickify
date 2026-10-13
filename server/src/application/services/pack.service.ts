import type { Readable } from 'node:stream';
import { NotFoundError, ValidationError } from '../../domain/errors.js';
import type { ProcessingOptions } from '../../domain/media.js';
import { expandArchives } from '../../infrastructure/archive/sticker-archive.js';
import { StickerItemModel, type StickerItemDocument } from '../../infrastructure/db/models/sticker-item.model.js';
import { StickerPackModel, type StickerPackDocument } from '../../infrastructure/db/models/sticker-pack.model.js';
import type { StoragePort } from '../ports/storage.port.js';
import { toObjectId } from './ids.js';
import { itemPrefix, refreshPackStats, type IngestInput, type IngestResult, type StickerIngestService } from './sticker-ingest.service.js';

export interface PackInput {
  title: string;
  author?: string;
  description?: string;
  defaultEmoji?: string;
  processing?: Partial<ProcessingOptions>;
}

const INBOX_TITLE = 'Telegram Inbox';

export class PackService {
  constructor(
    private readonly storage: StoragePort,
    private readonly ingest: StickerIngestService,
  ) {}

  list(ownerId: string) {
    return StickerPackModel.find({ owner: toObjectId(ownerId) }).sort({ updatedAt: -1 }).limit(500);
  }

  /** Loads a pack and checks it belongs to the user (404 rather than 403, so existence is not leaked). */
  async getOwned(ownerId: string, packId: string): Promise<StickerPackDocument> {
    const pack = await StickerPackModel.findOne({ _id: toObjectId(packId, 'Pack'), owner: toObjectId(ownerId) });
    if (!pack) throw new NotFoundError('Pack');
    return pack;
  }

  async getWithItems(ownerId: string, packId: string) {
    const pack = await this.getOwned(ownerId, packId);
    const items = await StickerItemModel.find({ pack: pack._id }).sort({ position: 1 });
    return { pack, items };
  }

  create(ownerId: string, input: PackInput, source: StickerPackDocument['source'] = { type: 'upload', platform: 'file' }) {
    return StickerPackModel.create({ ...input, owner: toObjectId(ownerId), source });
  }

  async update(ownerId: string, packId: string, input: Partial<PackInput>): Promise<StickerPackDocument> {
    const pack = await this.getOwned(ownerId, packId);
    const { processing, ...rest } = input;
    pack.set(rest);
    if (processing) pack.set('processing', { ...pack.toObject().processing, ...processing });
    return pack.save();
  }

  /** Deletes a pack with all its stickers and files. Export history (ZIPs) is kept so it can still be downloaded. */
  async delete(ownerId: string, packId: string): Promise<void> {
    const pack = await this.getOwned(ownerId, packId);
    await StickerItemModel.deleteMany({ pack: pack._id });
    await pack.deleteOne();
    await this.storage.deletePrefix(`packs/${pack.id}`);
  }

  /** Direct upload into a pack (API clients). ZIP/.wastickers files are unpacked, keeping their emojis. */
  async addStickers(ownerId: string, packId: string, inputs: IngestInput[]): Promise<IngestResult> {
    if (inputs.length === 0) throw new ValidationError('No files selected');
    const pack = await this.getOwned(ownerId, packId);
    const expanded = expandArchives(inputs.map((i) => ({ ...i, filename: i.filename ?? 'file' })));
    const result = await this.ingest.ingestMany(pack, expanded.files);
    await StickerPackModel.updateOne({ _id: pack._id }, { $currentDate: { updatedAt: true } });
    return { items: result.items, failed: [...expanded.failed, ...result.failed] };
  }

  /** The default pack for stickers sent to the Telegram bot. */
  async getOrCreateInbox(ownerId: string): Promise<StickerPackDocument> {
    const owner = toObjectId(ownerId);
    const existing = await StickerPackModel.findOne({ owner, 'source.type': 'bot' });
    return existing ?? this.create(ownerId, { title: INBOX_TITLE, description: 'Stickers sent to the Telegram bot' }, { type: 'bot', platform: 'telegram' });
  }

  async getOwnedItem(ownerId: string, itemId: string): Promise<StickerItemDocument> {
    const item = await StickerItemModel.findOne({ _id: toObjectId(itemId, 'Sticker'), owner: toObjectId(ownerId) });
    if (!item) throw new NotFoundError('Sticker');
    return item;
  }

  async updateSticker(ownerId: string, itemId: string, input: { emojis: string[] }): Promise<StickerItemDocument> {
    const item = await this.getOwnedItem(ownerId, itemId);
    item.emojis = input.emojis;
    return item.save();
  }

  async deleteSticker(ownerId: string, itemId: string): Promise<void> {
    const item = await this.getOwnedItem(ownerId, itemId);
    await item.deleteOne();
    await this.storage.deletePrefix(itemPrefix(item.pack.toString(), item.id));
    await refreshPackStats(item.pack);
  }

  /** Reorders stickers: the client sends every id in the new order. */
  async reorder(ownerId: string, packId: string, ids: string[]): Promise<void> {
    const pack = await this.getOwned(ownerId, packId);
    const existing = await StickerItemModel.find({ pack: pack._id }).select('_id').lean();
    const known = new Set(existing.map((d) => d._id.toString()));
    if (ids.length !== known.size || new Set(ids).size !== ids.length || !ids.every((id) => known.has(id))) {
      throw new ValidationError('The new order must list every sticker of the pack exactly once');
    }
    await StickerItemModel.bulkWrite(
      ids.map((id, position) => ({ updateOne: { filter: { _id: toObjectId(id) }, update: { $set: { position } } } })),
    );
    await refreshPackStats(pack._id);
  }

  async openFile(ownerId: string, itemId: string, which: 'original' | 'thumbnail'): Promise<{ stream: Readable; mime: string }> {
    const item = await this.getOwnedItem(ownerId, itemId);
    const key = which === 'original' ? item.original.key : item.thumbnail?.key;
    const mime = which === 'original' ? item.original.mime : item.thumbnail?.mime;
    if (!key || !mime || !(await this.storage.exists(key))) throw new NotFoundError('File');
    return { stream: this.storage.createReadStream(key), mime };
  }
}
