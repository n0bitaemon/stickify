import { model, Schema, Types, type HydratedDocument, type InferSchemaType } from 'mongoose';

const MEDIA_KINDS = ['static', 'vector', 'animated', 'video', 'lottie'] as const;
const SOURCE_FORMATS = ['png', 'apng', 'jpeg', 'webp', 'gif', 'svg', 'webm', 'mp4', 'mov', 'tgs'] as const;

/** Technical metadata of the original file (the probe result). */
const OriginalFileSchema = new Schema(
  {
    key: { type: String, required: true },
    filename: { type: String, maxlength: 255 },
    mime: { type: String, required: true },
    format: { type: String, enum: SOURCE_FORMATS, required: true },
    kind: { type: String, enum: MEDIA_KINDS, required: true },
    bytes: { type: Number, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
    frames: { type: Number, default: 1 },
    durationMs: { type: Number, default: 0 },
    codec: { type: String },
  },
  { _id: false },
);

/**
 * One sticker in a pack. Only the ORIGINAL file + thumbnail are stored; per-platform
 * conversions (renditions) are generated on demand and cached in storage under a
 * deterministic key (platform + options hash), so they need no DB record.
 */
const StickerItemSchema = new Schema(
  {
    pack: { type: Types.ObjectId, ref: 'StickerPack', required: true },
    owner: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    position: { type: Number, required: true, min: 0 },
    emojis: {
      type: [String],
      default: ['🙂'],
      validate: { validator: (v: string[]) => v.length >= 1 && v.length <= 20, message: '1–20 emojis required' },
    },

    original: { type: OriginalFileSchema, required: true },

    thumbnail: {
      key: { type: String },
      mime: { type: String },
      animated: { type: Boolean, default: false },
    },

    /** SHA-256 of the original – stops the same file being added to a pack twice. */
    contentHash: { type: String, required: true },

    /** Telegram file ids when the sticker was imported from Telegram. */
    telegram: {
      fileId: { type: String },
      fileUniqueId: { type: String },
    },
  },
  { timestamps: true },
);

StickerItemSchema.virtual('animated').get(function () {
  return this.original.kind === 'animated' || this.original.kind === 'video' || this.original.kind === 'lottie';
});

// A pack's stickers in display order.
StickerItemSchema.index({ pack: 1, position: 1 });
// Fast duplicate check on upload.
StickerItemSchema.index({ pack: 1, contentHash: 1 });

export type StickerItem = InferSchemaType<typeof StickerItemSchema>;
export type StickerItemDocument = HydratedDocument<StickerItem>;
export const StickerItemModel = model('StickerItem', StickerItemSchema);
