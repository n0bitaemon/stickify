import { Schema } from 'mongoose';
import { DEFAULT_PROCESSING_OPTIONS } from '../../../domain/media.js';

/** Processing options shared by User (defaults), StickerPack and ExportJob. */
export const ProcessingOptionsSchema = new Schema(
  {
    trim: { type: Boolean, default: DEFAULT_PROCESSING_OPTIONS.trim },
    padding: { type: Number, min: 0, max: 64, default: DEFAULT_PROCESSING_OPTIONS.padding },
    borderWidth: { type: Number, min: 0, max: 32, default: DEFAULT_PROCESSING_OPTIONS.borderWidth },
    borderColor: { type: String, match: /^#[0-9a-f]{6}$/i, default: DEFAULT_PROCESSING_OPTIONS.borderColor },
  },
  { _id: false },
);
