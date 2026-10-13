import { model, Schema, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { PLATFORM_IDS } from '../../../domain/platforms.js';
import { ProcessingOptionsSchema } from './shared.js';

const UserSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    // select:false → the hash is never returned by accident; it is only loaded at login.
    passwordHash: { type: String, required: true, select: false },
    displayName: { type: String, required: true, trim: true, maxlength: 60 },

    /** Linked Telegram account (via the bot's /start <code>), used by the bot and to push packs to Telegram. */
    telegram: {
      userId: { type: Number },
      username: { type: String },
      linkedAt: { type: Date },
    },
    /** One-time link code, expires after 15 minutes. */
    telegramLinkCode: {
      code: { type: String },
      expiresAt: { type: Date },
    },

    preferences: {
      defaultPlatform: { type: String, enum: PLATFORM_IDS, default: 'whatsapp' },
      processing: { type: ProcessingOptionsSchema, default: () => ({}) },
    },

    /** Total bytes of stored originals – for quotas later. */
    storageBytes: { type: Number, default: 0, min: 0 },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      versionKey: false,
      transform: (_doc, ret: Record<string, unknown>) => {
        delete ret._id;
        delete ret.passwordHash;
        delete ret.telegramLinkCode;
        return ret;
      },
    },
  },
);

// A Telegram account links to one user only. Partial index skips users without a link.
UserSchema.index({ 'telegram.userId': 1 }, { unique: true, partialFilterExpression: { 'telegram.userId': { $type: 'number' } } });
UserSchema.index({ 'telegramLinkCode.code': 1 }, { partialFilterExpression: { 'telegramLinkCode.code': { $type: 'string' } } });

export type User = InferSchemaType<typeof UserSchema>;
export type UserDocument = HydratedDocument<User>;
export const UserModel = model('User', UserSchema);
