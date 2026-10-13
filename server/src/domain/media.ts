/**
 * Pure domain media types – no dependency on sharp/ffmpeg.
 */

/** Source format detected from magic bytes (the client's file extension/mimetype is never trusted). */
export type SourceFormat = 'png' | 'apng' | 'jpeg' | 'webp' | 'gif' | 'svg' | 'webm' | 'mp4' | 'mov' | 'tgs';

/**
 * Processing groups:
 * - static:   single-frame raster images (PNG/JPG/WebP/still GIF)
 * - vector:   SVG, rasterised at high quality before being treated as static
 * - animated: animated images (GIF/animated WebP decoded by sharp; APNG decoded by ffmpeg)
 * - video:    WebM/MP4/MOV – decoded by ffmpeg
 * - lottie:   Telegram .tgs (gzipped Lottie) – only passed through back to Telegram
 */
export type MediaKind = 'static' | 'vector' | 'animated' | 'video' | 'lottie';

/** Output formats the engine can produce. `apng` uses the .png extension. */
export type OutputFormat = 'webp' | 'png' | 'webm' | 'apng' | 'gif' | 'tgs';

export const MIME_BY_SOURCE: Record<SourceFormat, string> = {
  png: 'image/png',
  apng: 'image/apng',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webm: 'video/webm',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  tgs: 'application/x-tgsticker',
};

export const OUTPUT_META: Record<OutputFormat, { ext: string; mime: string }> = {
  webp: { ext: 'webp', mime: 'image/webp' },
  png: { ext: 'png', mime: 'image/png' },
  apng: { ext: 'png', mime: 'image/apng' },
  gif: { ext: 'gif', mime: 'image/gif' },
  webm: { ext: 'webm', mime: 'video/webm' },
  tgs: { ext: 'tgs', mime: 'application/x-tgsticker' },
};

/** Technical details of a source file after probing. */
export interface MediaInfo {
  format: SourceFormat;
  kind: MediaKind;
  mime: string;
  width: number;
  height: number;
  /** Number of frames (1 for stills). */
  frames: number;
  /** Total duration in ms, 0 for stills. */
  durationMs: number;
  /** Video codec (vp8/vp9/h264...) – needed to pick a decoder that keeps the alpha channel. */
  codec?: string;
}

/** Options the user picks when converting. */
export interface ProcessingOptions {
  /** Trim transparent/uniform margins before centring. */
  trim: boolean;
  /** Transparent padding around the sticker, in px on a 512px canvas. */
  padding: number;
  /** Outline (stroke) around the shape, 0 = off. */
  borderWidth: number;
  borderColor: string;
}

export const DEFAULT_PROCESSING_OPTIONS: ProcessingOptions = {
  trim: true,
  padding: 8,
  borderWidth: 0,
  borderColor: '#ffffff',
};

export const isAnimatedKind = (kind: MediaKind): boolean => kind === 'animated' || kind === 'video';
