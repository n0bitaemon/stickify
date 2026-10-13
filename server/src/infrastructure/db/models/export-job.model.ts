import { model, Schema, Types, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { PLATFORM_IDS } from '../../../domain/platforms.js';
import { ProcessingOptionsSchema } from './shared.js';

export const JOB_STATUSES = ['queued', 'processing', 'completed', 'failed'] as const;
export const EXPORT_TARGETS = ['zip', 'telegram'] as const;

/**
 * Conversion history. Each export of a pack to a platform is a job; the resulting ZIP
 * is kept so the user can download it again at any time.
 */
const ExportJobSchema = new Schema(
  {
    owner: { type: Types.ObjectId, ref: 'User', required: true },
    pack: { type: Types.ObjectId, ref: 'StickerPack', required: true },
    /** Pack title at export time – still correct if the pack is renamed or deleted. */
    packTitle: { type: String, required: true },
    platform: { type: String, enum: PLATFORM_IDS, required: true },
    target: { type: String, enum: EXPORT_TARGETS, default: 'zip' },
    options: { type: ProcessingOptionsSchema, default: () => ({}) },

    status: { type: String, enum: JOB_STATUSES, default: 'queued' },
    progress: {
      done: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
    },
    result: {
      key: { type: String },
      filename: { type: String },
      bytes: { type: Number },
      stickerCount: { type: Number },
      /** t.me/addstickers/... link when target = telegram. */
      telegramUrl: { type: String },
    },
    warnings: [
      {
        _id: false,
        item: { type: Types.ObjectId, ref: 'StickerItem' },
        message: { type: String, required: true },
      },
    ],
    error: { type: String },
    startedAt: { type: Date },
    finishedAt: { type: Date },
  },
  { timestamps: true },
);

ExportJobSchema.index({ owner: 1, createdAt: -1 });
ExportJobSchema.index({ pack: 1, createdAt: -1 });
// Used at startup to mark unfinished jobs.
ExportJobSchema.index({ status: 1 });

export type ExportJob = InferSchemaType<typeof ExportJobSchema>;
export type ExportJobDocument = HydratedDocument<ExportJob>;
export const ExportJobModel = model('ExportJob', ExportJobSchema);
