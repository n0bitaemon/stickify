import sharp from 'sharp';
import type { PngOptions, WebpOptions } from 'sharp';
import type { MediaInfo, ProcessingOptions } from '../../domain/media.js';
import { fitToSize } from './fit.js';
import { applyStroke, decimate, padFrame, resampleFrames, splitStackedFrames, type FrameSequence } from './frames.js';
import { normalizeDelay } from './probe.js';

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

// libvips' internal cache does not help a "each file once" workload and only holds RAM.
sharp.cache(false);

export interface Box {
  width: number;
  height: number;
}

/**
 * Sticker layout on the canvas: content is shrunk into a "content box" that leaves room
 * for padding + outline on every side, so the outline is never clipped at the edge.
 */
export function contentBox(canvas: Box, opts: ProcessingOptions): Box {
  const inset = 2 * (opts.padding + opts.borderWidth);
  return { width: Math.max(16, canvas.width - inset), height: Math.max(16, canvas.height - inset) };
}

/** DPI that rasterises an SVG at ~2× the target size before downscaling → crisp edges. */
function svgDensity(info: MediaInfo, target: number): number {
  const base = Math.max(info.width, info.height) || target;
  return Math.min(2400, Math.max(72, Math.ceil((72 * target * 2) / base)));
}

/** Static/vector pipeline → a raw RGBA frame of exactly the canvas size. */
export async function renderStaticFrame(input: Buffer, info: MediaInfo, canvas: Box, opts: ProcessingOptions): Promise<Buffer> {
  const density = info.kind === 'vector' ? svgDensity(info, Math.max(canvas.width, canvas.height)) : undefined;

  // .rotate() without arguments = apply EXIF orientation (phone photos). Only the first frame is read.
  let buf = await sharp(input, { density, animated: false }).rotate().ensureAlpha().png({ compressionLevel: 0 }).toBuffer();

  if (opts.trim) {
    try {
      buf = await sharp(buf).trim({ threshold: 10 }).png({ compressionLevel: 0 }).toBuffer();
    } catch {
      // Uniform/fully transparent image → nothing to trim, keep it as is.
    }
  }

  const box = contentBox(canvas, opts);
  const { data, info: out } = await sharp(buf)
    .resize({ ...box, fit: 'contain', background: TRANSPARENT, kernel: 'lanczos3' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const frame = padFrame(data, out.width, out.height, canvas.width, canvas.height);
  return applyStroke(frame, canvas.width, canvas.height, opts.borderWidth, opts.borderColor);
}

/**
 * Decodes an animated GIF/WebP with sharp → a FrameSequence on the canvas.
 * Only frames within the duration limit are decoded, to save RAM.
 */
export async function decodeAnimatedImage(
  input: Buffer,
  canvas: Box,
  opts: ProcessingOptions,
  limits: { maxFps: number; maxDurationMs: number; maxFrames: number },
): Promise<{ seq: FrameSequence; truncated: boolean }> {
  const meta = await sharp(input, { animated: true }).metadata();
  const totalPages = meta.pages ?? 1;
  const delays = Array.from({ length: totalPages }, (_, i) => normalizeDelay(meta.delay?.[i]));

  let pages = 0;
  let elapsed = 0;
  while (pages < totalPages && elapsed < limits.maxDurationMs) elapsed += delays[pages++]!;
  const truncated = pages < totalPages;
  const usedDelays = delays.slice(0, pages);
  const durationMs = Math.min(elapsed, limits.maxDurationMs);

  // The source's natural FPS, capped by the platform limit and the frame ceiling (RAM).
  const naturalFps = (pages * 1000) / Math.max(1, usedDelays.reduce((a, b) => a + b, 0));
  const fps = Math.max(1, Math.min(limits.maxFps, Math.round(naturalFps), Math.floor((limits.maxFrames * 1000) / durationMs)));

  const box = contentBox(canvas, opts);
  const { data, info } = await sharp(input, { animated: true, pages })
    .resize({ ...box, fit: 'contain', background: TRANSPARENT })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const frameHeight = info.pageHeight ?? Math.round(info.height / pages);
  const decoded = splitStackedFrames(data, info.width, frameHeight, pages);

  // Pad + stroke the source frames (before resampling) so duplicated frames are not processed twice.
  const finished: Buffer[] = [];
  for (const f of decoded) {
    const padded = padFrame(f, info.width, frameHeight, canvas.width, canvas.height);
    finished.push(applyStroke(padded, canvas.width, canvas.height, opts.borderWidth, opts.borderColor));
  }

  return {
    seq: { ...canvas, fps, frames: resampleFrames(finished, usedDelays, fps, durationMs) },
    truncated,
  };
}

const rawInput = (frame: Buffer, box: Box) => sharp(frame, { raw: { width: box.width, height: box.height, channels: 4 } });

/** Encodes a still frame as WebP/PNG, lowering quality until it fits the byte limit. */
export async function encodeStatic(frame: Buffer, box: Box, format: 'webp' | 'png', maxBytes: number) {
  if (format === 'webp') {
    const attempts: WebpOptions[] = [
      { lossless: true, effort: 4 },
      ...[92, 85, 78, 70, 60, 50, 40, 30, 20].map((quality) => ({ quality, alphaQuality: 90, effort: 5 })),
    ];
    return fitToSize(attempts, maxBytes, (o) => rawInput(frame, box).webp(o).toBuffer());
  }
  const attempts: PngOptions[] = [
    { compressionLevel: 9, adaptiveFiltering: true },
    { palette: true, quality: 100, colours: 256, compressionLevel: 9 },
    { palette: true, quality: 80, colours: 256, compressionLevel: 9 },
    { palette: true, quality: 60, colours: 128, compressionLevel: 9 },
    { palette: true, quality: 40, colours: 64, compressionLevel: 9, dither: 1 },
  ];
  return fitToSize(attempts, maxBytes, (o) => rawInput(frame, box).png(o).toBuffer());
}

/** Stacks a FrameSequence into a "tall" image with pageHeight so sharp writes an animation. */
function stackedInput(seq: FrameSequence) {
  const raw = { width: seq.width, height: seq.height * seq.frames.length, channels: 4 as const, pageHeight: seq.height };
  return sharp(Buffer.concat(seq.frames), { raw });
}

const delaysFor = (seq: FrameSequence) => Array<number>(seq.frames.length).fill(Math.round(1000 / seq.fps));

/** Animated WebP (WhatsApp). Lowers quality first, then FPS. */
export async function encodeAnimatedWebp(seq: FrameSequence, maxBytes: number) {
  const attempts = [
    { quality: 80, drop: 1 },
    { quality: 65, drop: 1 },
    { quality: 50, drop: 1 },
    { quality: 50, drop: 2 },
    { quality: 35, drop: 2 },
    { quality: 25, drop: 3 },
  ];
  return fitToSize(attempts, maxBytes, (a) => {
    const s = decimate(seq, a.drop);
    return stackedInput(s).webp({ quality: a.quality, alphaQuality: 80, effort: 4, loop: 0, delay: delaysFor(s) }).toBuffer();
  });
}

/** Animated GIF (Messenger). GIF only has 1-bit alpha, so soft outlines look slightly jagged – a format limit. */
export async function encodeGif(seq: FrameSequence, maxBytes: number) {
  const attempts = [
    { colours: 256, drop: 1 },
    { colours: 128, drop: 1 },
    { colours: 128, drop: 2 },
    { colours: 64, drop: 2 },
  ];
  return fitToSize(attempts, maxBytes, (a) => {
    const s = decimate(seq, a.drop);
    return stackedInput(s).gif({ colours: a.colours, effort: 7, loop: 0, delay: delaysFor(s) }).toBuffer();
  });
}
