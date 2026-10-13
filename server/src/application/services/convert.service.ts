import type { Readable } from 'node:stream';
import { AppError, ValidationError } from '../../domain/errors.js';
import type { MediaInfo, ProcessingOptions } from '../../domain/media.js';
import { getPlatformSpec, type PlatformId, type PlatformSpec } from '../../domain/platforms.js';
import type { SourceId } from '../../domain/sources.js';
import { expandArchives } from '../../infrastructure/archive/sticker-archive.js';
import { mapLimit, type TaskQueue } from '../../infrastructure/queue/task-queue.js';
import type { MediaProcessorPort, ProcessedMedia } from '../ports/media.port.js';
import { slugify } from './ids.js';
import type { RemotePreviewService } from './remote-preview.service.js';
import { buildStickerZip, groupForPlatform, type ZipGroup } from './zip-builder.js';

export interface ConvertFile {
  buffer: Buffer;
  filename: string;
  emojis?: string[];
}

export interface ConvertResult {
  zip: Readable;
  filename: string;
  converted: number;
  failed: Array<{ filename: string; message: string }>;
}

interface Converted {
  file: ConvertFile;
  info: MediaInfo;
  media: ProcessedMedia;
  animated: boolean;
}

/**
 * Quick convert, no account needed: stickers in → ZIP out, in the same response.
 * Nothing is written to the DB or storage. Everything is processed before streaming so a
 * proper JSON error can still be returned when every file fails.
 */
export class ConvertService {
  constructor(
    private readonly media: MediaProcessorPort,
    private readonly queue: TaskQueue,
    private readonly previews: RemotePreviewService,
  ) {}

  /**
   * Converts a reviewed pack (link or upload). Reuses the downloads and any target previews
   * the user already looked at; `indices` limits the conversion to the selected stickers.
   */
  async convertFromPreview(previewId: string, platform: PlatformId, options: ProcessingOptions, title?: string, indices?: number[]): Promise<ConvertResult> {
    const spec = getPlatformSpec(platform);
    const collected = await this.previews.collectById(previewId, indices);
    const failed = [...collected.failed];

    const converted = await mapLimit(collected.files, 4, async (file): Promise<Converted | null> => {
      try {
        const [media, info] = await Promise.all([this.previews.render(previewId, file.index, spec, options), this.media.probe(file.buffer)]);
        return { file, info, media, animated: media.animated };
      } catch (err) {
        failed.push({ filename: file.filename, message: err instanceof AppError ? err.message : 'Processing failed' });
        return null;
      }
    });
    return this.package(converted, failed, spec, options, title || collected.pack.title || 'Stickify pack');
  }

  /** Converts a pack straight from a share link (API clients). */
  async convertFromLink(source: SourceId, input: string, platform: PlatformId, options: ProcessingOptions, title?: string, indices?: number[]) {
    const session = await this.previews.open(source, input);
    return this.convertFromPreview(session.id, platform, options, title, indices);
  }

  /** Converts uploaded files directly (API clients). ZIP/.wastickers files are unpacked. */
  async convertToZip(uploads: ConvertFile[], platform: PlatformId, options: ProcessingOptions, title = 'Stickify pack'): Promise<ConvertResult> {
    if (uploads.length === 0) throw new ValidationError('No files selected');
    const spec = getPlatformSpec(platform);
    const { files, failed } = expandArchives(uploads);

    const converted = await mapLimit(files, 4, async (file): Promise<Converted | null> => {
      try {
        const info = await this.media.probe(file.buffer);
        const media = await this.queue.run(() => this.media.processForPlatform(file.buffer, info, spec, options));
        return { file, info, media, animated: media.animated };
      } catch (err) {
        failed.push({ filename: file.filename, message: err instanceof AppError ? err.message : 'Processing failed' });
        return null;
      }
    });
    return this.package(converted, failed, spec, options, title);
  }

  /** Groups converted stickers by the platform's pack rules, adds tray icons and builds the ZIP. */
  private async package(
    converted: Array<Converted | null>,
    failed: ConvertResult['failed'],
    spec: PlatformSpec,
    options: ProcessingOptions,
    title: string,
  ): Promise<ConvertResult> {
    const ok = converted.filter((c): c is Converted => c !== null);
    if (ok.length === 0) throw new AppError('None of the stickers could be converted', 422, 'CONVERT_FAILED', { failed });

    const warnings = ok.flatMap((c) => c.media.warnings.map((w) => `${c.file.filename}: ${w}`));
    const groups: ZipGroup[] = [];
    for (const g of groupForPlatform(ok, spec)) {
      let tray: ProcessedMedia | null = null;
      const first = g.items.find((c) => c.info.kind !== 'lottie');
      if (spec.tray && first) tray = await this.queue.run(() => this.media.makeTrayIcon(first.file.buffer, first.info, spec.tray!, options));
      groups.push({
        animated: g.animated,
        tray,
        stickers: g.items.map((c) => ({ media: c.media, emojis: c.file.emojis?.length ? c.file.emojis : ['🙂'] })),
      });
    }

    for (const f of failed) warnings.push(`${f.filename}: ${f.message} – skipped`);
    const zip = buildStickerZip({ title, author: 'Stickify', spec, warnings }, groups);
    return { zip, filename: `${slugify(title)}-${spec.id}.zip`, converted: ok.length, failed };
  }
}
