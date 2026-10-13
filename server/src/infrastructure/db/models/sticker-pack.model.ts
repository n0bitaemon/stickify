import { model, Schema, Types, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { SOURCE_IDS } from '../../../domain/sources.js';
import { ProcessingOptionsSchema } from './shared.js';

/** upload: files added by hand · link: imported from a share link · archive: .wastickers/.zip · bot: sent to the Telegram bot */
export const PACK_SOURCES = ['upload', 'link', 'archive', 'bot'] as const;
export const IMPORT_STATUSES = ['idle', 'importing', 'done', 'failed'] as const;

/**
 * A StickerPack only holds metadata + denormalised counters (stickerCount, animatedCount).
 * Stickers live in their own collection (StickerItem): a pack can have hundreds of items
 * with technical metadata – embedding them would bloat the document and make paging and
 * reordering awkward.
 */
const StickerPackSchema = new Schema(
  {
    owner: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 64 },
    author: { type: String, trim: true, maxlength: 64, default: '' },
    description: { type: String, trim: true, maxlength: 500, default: '' },
    /** Default emoji for new stickers (Telegram/WhatsApp require one). */
    defaultEmoji: { type: String, default: '🙂', maxlength: 16 },

    /**
     * Where the pack came from: how it was imported (type) + the source platform.
     * E.g. { type: 'link', platform: 'signal', externalId: '<pack_id>' }.
     */
    source: {
      type: { type: String, enum: PACK_SOURCES, default: 'upload' },
      platform: { type: String, enum: SOURCE_IDS, default: 'file' },
      /** Pack id on the original platform (Telegram set name, Signal pack_id). Decryption keys are never stored. */
      externalId: { type: String },
      url: { type: String },
    },

    /** Background import state – the frontend polls it to show progress. */
    importState: {
      status: { type: String, enum: IMPORT_STATUSES, default: 'idle' },
      done: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
      error: { type: String },
    },

    /** Processing options remembered per pack (outline, padding...). */
    processing: { type: ProcessingOptionsSchema, default: () => ({}) },

    stickerCount: { type: Number, default: 0, min: 0 },
    animatedCount: { type: Number, default: 0, min: 0 },
    totalBytes: { type: Number, default: 0, min: 0 },
    coverItem: { type: Types.ObjectId, ref: 'StickerItem' },

    /** Last push to Telegram through the bot. */
    telegramPublished: {
      setName: { type: String },
      url: { type: String },
      publishedAt: { type: Date },
    },
  },
  { timestamps: true },
);

// The dashboard lists a user's packs by last update.
StickerPackSchema.index({ owner: 1, updatedAt: -1 });

export type StickerPack = InferSchemaType<typeof StickerPackSchema>;
export type StickerPackDocument = HydratedDocument<StickerPack>;
export const StickerPackModel = model('StickerPack', StickerPackSchema);
