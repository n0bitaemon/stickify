import type { MediaProcessorPort, ProcessedMedia } from '../../application/ports/media.port.js';
import { MediaError } from '../../domain/errors.js';
import { OUTPUT_META, isAnimatedKind, type MediaInfo, type OutputFormat, type ProcessingOptions } from '../../domain/media.js';
import type { AnimatedRule, PlatformSpec, TrayRule } from '../../domain/platforms.js';
import { formatKB } from './fit.js';
import { applyStroke, padFrame, sequenceDurationMs, type FrameSequence } from './frames.js';
import { decodeVideo, encodeApng, encodeWebm } from './ffmpeg.processor.js';
import { probeMedia } from './probe.js';
import {
  contentBox,
  decodeAnimatedImage,
  encodeAnimatedWebp,
  encodeGif,
  encodeStatic,
  renderStaticFrame,
  type Box,
} from './sharp.processor.js';

/**
 * Maximum frames held in RAM for one sticker (512×512×4 ≈ 1MB per frame).
 * Long clips lower their FPS to stay under this ceiling.
 */
const MAX_FRAMES = 150;

/** User padding/outline is expressed for a 512px canvas → scale it to the real canvas. */
function scaleOptions(opts: ProcessingOptions, canvas: Box): ProcessingOptions {
  const k = Math.min(canvas.width, canvas.height) / 512;
  return { ...opts, padding: Math.round(opts.padding * k), borderWidth: Math.round(opts.borderWidth * k) };
}

const result = (
  buffer: Buffer,
  format: OutputFormat,
  box: Box,
  animated: boolean,
  warnings: string[],
): ProcessedMedia => ({ buffer, format, ...OUTPUT_META[format], ...box, animated, warnings });

export class StickerProcessor implements MediaProcessorPort {
  probe(input: Buffer): Promise<MediaInfo> {
    return probeMedia(input);
  }

  async processForPlatform(input: Buffer, info: MediaInfo, spec: PlatformSpec, options: ProcessingOptions): Promise<ProcessedMedia> {
    const canvas = spec.canvas;
    const opts = scaleOptions(options, canvas);
    const warnings: string[] = [];

    if (info.kind === 'lottie') {
      if (spec.acceptsLottie) return result(input, 'tgs', canvas, true, warnings);
      throw new MediaError(`Lottie (.tgs) stickers cannot be converted to ${spec.label} yet – that needs a Lottie renderer`);
    }

    if (isAnimatedKind(info.kind)) {
      if (spec.animated) return this.processAnimated(input, info, canvas, opts, spec.animated, warnings);
      warnings.push(`${spec.label} has no animated stickers – the first frame was used`);
    }

    const frame = await this.firstFrame(input, info, canvas, opts);
    const encoded = await encodeStatic(frame, canvas, spec.static.format, spec.static.maxBytes);
    if (!encoded.fitted) {
      warnings.push(`Could not compress below ${formatKB(spec.static.maxBytes)} (got ${formatKB(encoded.buffer.length)})`);
    }
    return result(encoded.buffer, spec.static.format, canvas, false, warnings);
  }

  async makeTrayIcon(input: Buffer, info: MediaInfo, rule: TrayRule, options: ProcessingOptions): Promise<ProcessedMedia> {
    if (info.kind === 'lottie') throw new MediaError('Cannot build an icon from a Lottie sticker');
    const box = { width: rule.width, height: rule.height };
    const opts = scaleOptions({ ...options, padding: Math.max(options.padding, 4) }, box);
    const frame = await this.firstFrame(input, info, box, opts);
    const encoded = await encodeStatic(frame, box, rule.format, rule.maxBytes);
    const warnings = encoded.fitted ? [] : [`Tray icon is over ${formatKB(rule.maxBytes)}`];
    return result(encoded.buffer, rule.format, box, false, warnings);
  }

  async makeThumbnail(input: Buffer, info: MediaInfo): Promise<ProcessedMedia | null> {
    if (info.kind === 'lottie') return null; // the frontend renders the .tgs itself
    const box = { width: 256, height: 256 };
    const opts: ProcessingOptions = { trim: false, padding: 0, borderWidth: 0, borderColor: '#fff' };
    if (isAnimatedKind(info.kind)) {
      const rule: AnimatedRule = { format: 'webp', maxBytes: 400 * 1024, maxDurationMs: 4000, maxFps: 12 };
      return this.processAnimated(input, info, box, opts, rule, []);
    }
    const frame = await renderStaticFrame(input, info, box, opts);
    const encoded = await encodeStatic(frame, box, 'webp', 60 * 1024);
    return result(encoded.buffer, 'webp', box, false, []);
  }

  /** The first frame on the canvas – for stills, tray icons and platforms without animation. */
  private async firstFrame(input: Buffer, info: MediaInfo, canvas: Box, opts: ProcessingOptions): Promise<Buffer> {
    if (info.kind !== 'video') return renderStaticFrame(input, info, canvas, opts);
    const box = contentBox(canvas, opts);
    const seq = await decodeVideo(input, info, box, 1, 1000);
    const padded = padFrame(seq.frames[0]!, box.width, box.height, canvas.width, canvas.height);
    return applyStroke(padded, canvas.width, canvas.height, opts.borderWidth, opts.borderColor);
  }

  private async processAnimated(
    input: Buffer,
    info: MediaInfo,
    canvas: Box,
    opts: ProcessingOptions,
    rule: AnimatedRule,
    warnings: string[],
  ): Promise<ProcessedMedia> {
    // No trim for animations: each frame has a different bounding box and the image would "jump".
    const animOpts = { ...opts, trim: false };
    const seq = await this.decodeFrames(input, info, canvas, animOpts, rule);

    if (info.durationMs > rule.maxDurationMs + 50) {
      warnings.push(`Cut to ${(rule.maxDurationMs / 1000).toFixed(1)} s (original ${(info.durationMs / 1000).toFixed(1)} s)`);
    }

    const encoders = { webp: encodeAnimatedWebp, gif: encodeGif, webm: encodeWebm, apng: encodeApng };
    const encoded = await encoders[rule.format](seq, rule.maxBytes);
    if (!encoded.fitted) {
      warnings.push(`Could not compress below ${formatKB(rule.maxBytes)} (got ${formatKB(encoded.buffer.length)})`);
    }
    return result(encoded.buffer, rule.format, canvas, true, warnings);
  }

  private async decodeFrames(input: Buffer, info: MediaInfo, canvas: Box, opts: ProcessingOptions, rule: AnimatedRule): Promise<FrameSequence> {
    // Animated GIF/WebP: sharp decodes each frame with its original delay.
    if (info.format === 'gif' || info.format === 'webp') {
      const { seq } = await decodeAnimatedImage(input, canvas, opts, { ...rule, maxFrames: MAX_FRAMES });
      return seq;
    }

    // Video and APNG: ffmpeg decodes, picking the FPS while decoding (cheaper than decoding everything and dropping frames).
    const durationMs = Math.min(info.durationMs || rule.maxDurationMs, rule.maxDurationMs);
    const sourceFps = info.durationMs ? (info.frames * 1000) / info.durationMs : rule.maxFps;
    const fps = Math.max(1, Math.min(rule.maxFps, Math.round(sourceFps), Math.floor((MAX_FRAMES * 1000) / durationMs)));
    const box = contentBox(canvas, opts);
    const decoded = await decodeVideo(input, info, box, fps, rule.maxDurationMs);

    const frames: Buffer[] = [];
    for (const f of decoded.frames) {
      const padded = padFrame(f, box.width, box.height, canvas.width, canvas.height);
      frames.push(applyStroke(padded, canvas.width, canvas.height, opts.borderWidth, opts.borderColor));
    }
    const seq = { ...canvas, fps, frames };
    if (sequenceDurationMs(seq) === 0) throw new MediaError('The video is too short');
    return seq;
  }
}
