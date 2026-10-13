import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import ffmpeg from 'fluent-ffmpeg';
import sharp from 'sharp';
import { MediaError } from '../../domain/errors.js';
import { MIME_BY_SOURCE, type MediaInfo, type SourceFormat } from '../../domain/media.js';
import { withTempDir } from './temp.js';

/** Browsers treat GIF delays ≤ 10ms as 100ms; we do the same so durations match what users see. */
export const normalizeDelay = (ms: number | undefined): number => (!ms || ms <= 10 ? 100 : ms);

/**
 * Detects the format from magic bytes. The client's mimetype/extension is never trusted:
 * a ".png" may really be an animated GIF or a renamed malicious file.
 */
export function detectFormat(buf: Buffer): SourceFormat | null {
  if (buf.length < 12) return null;
  const ascii = (start: number, end: number) => buf.toString('latin1', start, end);

  if (buf[0] === 0x89 && ascii(1, 4) === 'PNG') return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (ascii(0, 4) === 'GIF8') return 'gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'webm';
  if (ascii(4, 8) === 'ftyp') return ascii(8, 12) === 'qt  ' ? 'mov' : 'mp4';
  if (buf[0] === 0x1f && buf[1] === 0x8b) return 'tgs'; // gzip – the Lottie content is validated in probeLottie
  // SVG is text: skip BOM/whitespace and look for an <svg tag near the start.
  const head = buf.toString('utf8', 0, Math.min(buf.length, 2048)).replace(/^﻿/, '').trimStart();
  if ((head.startsWith('<?xml') || head.startsWith('<svg') || head.startsWith('<!--')) && head.includes('<svg')) {
    return 'svg';
  }
  return null;
}

/**
 * An APNG is a PNG with an acTL chunk before IDAT. sharp/libvips only read the first frame
 * and ffprobe reports no duration, so we read the chunks ourselves: acTL (frame count) +
 * fcTL (per-frame delay).
 */
export function parseApng(buf: Buffer): { frames: number; durationMs: number } | null {
  let offset = 8; // skip the PNG signature
  let frames = 0;
  let durationMs = 0;
  let animated = false;
  while (offset + 12 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('latin1', offset + 4, offset + 8);
    const data = offset + 8;
    if (data + length > buf.length) break;
    if (type === 'acTL') {
      animated = true;
      frames = buf.readUInt32BE(data);
    } else if (type === 'fcTL' && length >= 26) {
      const num = buf.readUInt16BE(data + 20);
      const den = buf.readUInt16BE(data + 22) || 100; // den = 0 means 1/100 s
      durationMs += normalizeDelay(Math.round((num / den) * 1000));
    } else if (type === 'IDAT' && !animated) {
      return null; // image data before any acTL → a plain PNG
    } else if (type === 'IEND') {
      break;
    }
    offset = data + length + 4; // + CRC
  }
  return animated && frames > 1 ? { frames, durationMs } : null;
}

async function probeImage(buf: Buffer, format: SourceFormat): Promise<MediaInfo> {
  if (format === 'png') {
    const apng = parseApng(buf);
    if (apng) {
      const meta = await sharp(buf).metadata();
      return { format: 'apng', kind: 'animated', mime: MIME_BY_SOURCE.apng, width: meta.width ?? 0, height: meta.height ?? 0, codec: 'apng', ...apng };
    }
  }

  const meta = await sharp(buf, { animated: true }).metadata();
  const pages = meta.pages ?? 1;
  const pageHeight = meta.pageHeight ?? meta.height ?? 0;
  const animated = (format === 'gif' || format === 'webp') && pages > 1;
  const durationMs = animated ? (meta.delay ?? []).slice(0, pages).reduce((sum, d) => sum + normalizeDelay(d), 0) : 0;

  return {
    format,
    kind: format === 'svg' ? 'vector' : animated ? 'animated' : 'static',
    mime: MIME_BY_SOURCE[format],
    width: meta.width ?? 0,
    height: pageHeight,
    frames: animated ? pages : 1,
    durationMs,
  };
}

async function probeVideo(buf: Buffer, format: SourceFormat): Promise<MediaInfo> {
  // ffprobe needs a seekable file (MP4 may keep its moov atom at the end) → write a temp file.
  const data = await withTempDir(async (dir) => {
    const file = path.join(dir, `input.${format}`);
    await writeFile(file, buf);
    return new Promise<ffmpeg.FfprobeData>((resolve, reject) =>
      ffmpeg.ffprobe(file, (err, d) => (err ? reject(err) : resolve(d))),
    );
  });

  const stream = data.streams.find((s) => s.codec_type === 'video');
  if (!stream?.width || !stream.height) throw new MediaError('No valid video stream found');

  const [num = 0, den = 1] = String(stream.avg_frame_rate || stream.r_frame_rate || '0/1').split('/').map(Number);
  const fps = den ? num / den : 0;
  const durationSec = Number(stream.duration ?? data.format.duration ?? 0) || 0;
  const frames = Number(stream.nb_frames) || Math.max(1, Math.round(durationSec * (fps || 30)));

  return {
    format,
    kind: 'video',
    mime: MIME_BY_SOURCE[format],
    width: stream.width,
    height: stream.height,
    frames,
    durationMs: Math.round(durationSec * 1000),
    codec: stream.codec_name,
  };
}

function probeLottie(buf: Buffer): MediaInfo {
  let json: { w?: number; h?: number; ip?: number; op?: number; fr?: number };
  try {
    // Cap the decompressed size to defend against "zip bombs".
    json = JSON.parse(gunzipSync(buf, { maxOutputLength: 10 * 1024 * 1024 }).toString('utf8'));
  } catch {
    throw new MediaError('This compressed file is not a valid Telegram .tgs sticker');
  }
  const frames = Math.max(1, (json.op ?? 0) - (json.ip ?? 0));
  return {
    format: 'tgs',
    kind: 'lottie',
    mime: MIME_BY_SOURCE.tgs,
    width: json.w ?? 512,
    height: json.h ?? 512,
    frames,
    durationMs: json.fr ? Math.round((frames / json.fr) * 1000) : 0,
  };
}

export async function probeMedia(buf: Buffer): Promise<MediaInfo> {
  const format = detectFormat(buf);
  if (!format) {
    throw new MediaError('Unsupported format. Accepted: PNG, JPG, WebP, GIF, SVG, WebM, MP4, MOV, TGS.');
  }
  try {
    if (format === 'tgs') return probeLottie(buf);
    if (format === 'webm' || format === 'mp4' || format === 'mov') return await probeVideo(buf, format);
    return await probeImage(buf, format);
  } catch (err) {
    if (err instanceof MediaError) throw err;
    throw new MediaError(`Could not read this ${format.toUpperCase()} file (corrupt or invalid)`, {
      cause: (err as Error).message,
    });
  }
}
