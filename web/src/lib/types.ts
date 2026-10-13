/** Types matching the JSON returned by the API (see server/src/infrastructure/db/models). */

export type PlatformId = 'telegram' | 'whatsapp' | 'imessage' | 'signal' | 'discord' | 'viber' | 'facebook';
export type SourceId = 'file' | 'telegram' | 'signal' | 'whatsapp';
export type MediaKind = 'static' | 'vector' | 'animated' | 'video' | 'lottie';

/** A source platform – each has its own kind of input (see server/src/domain/sources.ts). */
export interface SourceSpec {
  id: SourceId;
  label: string;
  input: 'files' | 'link' | 'archive';
  description: string;
  placeholder?: string;
  examples?: string[];
  accept?: string;
  steps: string[];
  notes: string[];
  available: boolean;
}

export interface ReviewSticker {
  index: number;
  emojis: string[];
  kind: 'static' | 'animated' | 'video' | 'lottie';
  filename: string;
}

/** A pack loaded for review (from a link or an upload) before import/conversion. */
export interface ReviewInfo {
  previewId: string;
  source: SourceId;
  origin: 'link' | 'upload';
  title: string;
  author: string;
  count: number;
  animated: number;
  video: number;
  lottie: number;
  truncated: boolean;
  stickers: ReviewSticker[];
}

export interface ProcessingOptions {
  trim: boolean;
  padding: number;
  borderWidth: number;
  borderColor: string;
}

export interface PlatformSpec {
  id: PlatformId;
  label: string;
  canvas: { width: number; height: number };
  static: { format: string; maxBytes: number };
  animated: { format: string; maxBytes: number; maxDurationMs: number; maxFps: number } | null;
  tray: { width: number; height: number; format: string; maxBytes: number } | null;
  pack: { min: number; max: number; splitByAnimation?: boolean };
  acceptsLottie: boolean;
  directPublish: boolean;
  notes: string[];
  importGuide: string[];
}

export interface User {
  id: string;
  email: string;
  displayName: string;
  telegram?: { userId?: number; username?: string; linkedAt?: string };
  preferences: { defaultPlatform: PlatformId; processing: ProcessingOptions };
}

export interface Pack {
  id: string;
  title: string;
  author: string;
  description: string;
  defaultEmoji: string;
  source: { type: 'upload' | 'link' | 'archive' | 'bot'; platform: SourceId; externalId?: string; url?: string };
  importState: { status: 'idle' | 'importing' | 'done' | 'failed'; done: number; total: number; error?: string };
  processing: ProcessingOptions;
  stickerCount: number;
  animatedCount: number;
  totalBytes: number;
  coverItem?: string | null;
  telegramPublished?: { setName?: string; url?: string; publishedAt?: string };
  createdAt: string;
  updatedAt: string;
}

export interface StickerItem {
  id: string;
  pack: string;
  position: number;
  emojis: string[];
  animated: boolean;
  original: {
    filename?: string;
    mime: string;
    format: string;
    kind: MediaKind;
    bytes: number;
    width: number;
    height: number;
    frames: number;
    durationMs: number;
  };
  thumbnail?: { mime?: string; animated?: boolean };
}

export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface ExportJob {
  id: string;
  pack: string;
  packTitle: string;
  platform: PlatformId;
  target: 'zip' | 'telegram';
  status: JobStatus;
  progress: { done: number; total: number };
  result?: { filename?: string; bytes?: number; stickerCount?: number; telegramUrl?: string };
  warnings: Array<{ item?: string; message: string }>;
  error?: string;
  createdAt: string;
  finishedAt?: string;
}

export type FailedFile = { filename: string; message: string };

export interface UploadResult {
  items: StickerItem[];
  failed: FailedFile[];
}

export interface TelegramStatus {
  configured: boolean;
  botUsername?: string;
  linked: boolean;
  telegramUsername: string | null;
}

/** A converted file plus the metadata the server sends in X-Stickify-* headers. */
export interface RenderedPreview {
  blob: Blob;
  format: string;
  bytes: number;
  size: string;
  warnings: string[];
}
