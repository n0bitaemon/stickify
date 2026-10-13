import { z } from 'zod';
import { PLATFORM_IDS } from '../../domain/platforms.js';
import { SOURCE_IDS } from '../../domain/sources.js';

/**
 * HTTP input validation. Query strings and multipart fields are always strings, hence the
 * coerce/preprocess. Note: z.coerce.boolean() treats "false" as true, so we define our own.
 */
const boolish = z.preprocess((v) => (typeof v === 'string' ? ['true', '1', 'on', 'yes'].includes(v.toLowerCase()) : v), z.boolean());

const emoji = z
  .string()
  .trim()
  .min(1)
  .max(16)
  .regex(/\p{Extended_Pictographic}|\p{Regional_Indicator}/u, 'Must be an emoji');

export const ProcessingOptionsInput = z
  .object({
    trim: boolish,
    padding: z.coerce.number().int().min(0).max(64),
    borderWidth: z.coerce.number().int().min(0).max(32),
    borderColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Colour must look like #rrggbb'),
  })
  .partial();

export const Platform = z.enum(PLATFORM_IDS);
const Source = z.enum(SOURCE_IDS);

export const RegisterBody = z.object({
  email: z.email('Invalid email address').max(254),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  displayName: z.string().trim().min(1).max(60),
});

export const LoginBody = z.object({
  email: z.email('Invalid email address'),
  password: z.string().min(1).max(128),
});

export const UpdateProfileBody = z.object({
  displayName: z.string().trim().min(1).max(60).optional(),
  defaultPlatform: Platform.optional(),
  processing: ProcessingOptionsInput.optional(),
});

export const CreatePackBody = z.object({
  title: z.string().trim().min(1, 'Enter a pack name').max(64),
  author: z.string().trim().max(64).optional(),
  description: z.string().trim().max(500).optional(),
  defaultEmoji: emoji.optional(),
  processing: ProcessingOptionsInput.optional(),
});

export const UpdatePackBody = CreatePackBody.partial();

export const ReorderBody = z.object({ ids: z.array(z.string()).min(1).max(500) });

export const UpdateStickerBody = z.object({ emojis: z.array(emoji).min(1).max(20) });

export const CreateExportBody = z.object({
  platform: Platform,
  target: z.enum(['zip', 'telegram']).default('zip'),
  options: ProcessingOptionsInput.optional(),
});

export const PreviewQuery = ProcessingOptionsInput.extend({ platform: Platform });

export const HistoryQuery = z.object({ packId: z.string().optional() });

// ── Sources & review sessions ────────────────────────────────────────────────

const Link = z.string().trim().min(1, 'Enter a sticker pack link').max(500);
const PreviewId = z.string().regex(/^[0-9a-f]{32}$/, 'Invalid review session');
/** Selected stickers of a review (omit = the whole pack). */
const Indices = z.array(z.number().int().min(0)).min(1, 'No stickers selected').max(500);

export const InspectBody = z.object({ source: Source, link: Link });

export const ImportLinkBody = InspectBody.extend({ indices: Indices.optional() });

/** Multipart fields of POST /api/import/upload-preview. */
export const UploadPreviewFields = z.object({
  source: Source.default('file'),
  /** Add the files to an existing upload review instead of starting a new one. */
  previewId: PreviewId.optional(),
});

export const ImportPreviewBody = z.object({
  previewId: PreviewId,
  indices: Indices.optional(),
  title: z.string().trim().max(64).optional(),
});

export const AddFromPreviewBody = z.object({ previewId: PreviewId, indices: Indices.optional() });

export const PreviewFileParams = z.object({
  id: PreviewId,
  index: z.coerce.number().int().min(0),
});

export const RenderQuery = ProcessingOptionsInput.extend({ platform: Platform });

/**
 * Fields of POST /api/convert (multipart). Three ways to provide stickers:
 *  - previewId (+ indices): a reviewed pack – what the web app uses
 *  - source=telegram|signal + link
 *  - files[] (source=file|whatsapp)
 */
export const ConvertFields = ProcessingOptionsInput.extend({
  platform: Platform,
  source: Source.default('file'),
  previewId: PreviewId.optional(),
  link: Link.optional(),
  /** Multipart has no arrays → indices as "0,3,5". */
  indices: z
    .string()
    .regex(/^\d+(,\d+)*$/, 'indices must look like "0,1,2"')
    .transform((s) => s.split(',').map(Number))
    .optional(),
  title: z.string().trim().max(64).optional(),
});
