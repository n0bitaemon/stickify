import type { MediaInfo, OutputFormat, ProcessingOptions } from '../../domain/media.js';
import type { PlatformSpec, TrayRule } from '../../domain/platforms.js';

export interface ProcessedMedia {
  buffer: Buffer;
  format: OutputFormat;
  mime: string;
  ext: string;
  width: number;
  height: number;
  animated: boolean;
  /** Non-blocking warnings: duration cut, could not compress enough, motion lost... */
  warnings: string[];
}

/**
 * Media processing port. The application layer only knows "probe" and "process for a
 * spec" – it does not know sharp or ffmpeg exist.
 */
export interface MediaProcessorPort {
  /** Detects the real format from magic bytes and reads size, frame count and duration. */
  probe(input: Buffer): Promise<MediaInfo>;
  /** Normalises one sticker for a target platform's spec. */
  processForPlatform(input: Buffer, info: MediaInfo, spec: PlatformSpec, options: ProcessingOptions): Promise<ProcessedMedia>;
  /** Builds a tray/pack icon (always a still image). */
  makeTrayIcon(input: Buffer, info: MediaInfo, rule: TrayRule, options: ProcessingOptions): Promise<ProcessedMedia>;
  /** Small dashboard thumbnail (WebP, animated when the source is animated). */
  makeThumbnail(input: Buffer, info: MediaInfo): Promise<ProcessedMedia | null>;
}
