import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import ffmpeg from 'fluent-ffmpeg';
import { MediaError } from '../../domain/errors.js';
import type { MediaInfo } from '../../domain/media.js';
import { fitToSize } from './fit.js';
import { decimate, sequenceDurationMs, splitStackedFrames, type FrameSequence } from './frames.js';
import type { Box } from './sharp.processor.js';
import { withTempDir } from './temp.js';

export function configureFfmpeg(paths: { ffmpeg?: string; ffprobe?: string }): void {
  if (paths.ffmpeg) ffmpeg.setFfmpegPath(paths.ffmpeg);
  if (paths.ffprobe) ffmpeg.setFfprobePath(paths.ffprobe);
}

/** Runs an ffmpeg command that writes a file; errors become MediaError with the stderr tail for debugging. */
function run(cmd: ffmpeg.FfmpegCommand): Promise<void> {
  return new Promise((resolve, reject) => {
    cmd
      .on('end', () => resolve())
      .on('error', (err: Error, _stdout: string | null, stderr: string | null) =>
        reject(new MediaError('Video processing failed', { message: err.message, stderr: stderr?.slice(-800) })),
      )
      .run();
  });
}

/** Runs an ffmpeg command that writes to stdout and collects it into a Buffer. */
function runToBuffer(cmd: ffmpeg.FfmpegCommand): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const out = new PassThrough();
    out.on('data', (c: Buffer) => chunks.push(c));
    out.on('end', () => resolve(Buffer.concat(chunks)));
    cmd.on('error', (err: Error, _stdout: string | null, stderr: string | null) =>
      reject(new MediaError('Video decoding failed', { message: err.message, stderr: stderr?.slice(-800) })),
    );
    cmd.pipe(out, { end: true });
  });
}

/**
 * ffmpeg's default VP8/VP9 decoder DROPS the alpha channel. Telegram video stickers are
 * VP9 with alpha → force libvpx to keep the transparent background.
 */
function alphaAwareDecoder(codec?: string): string[] {
  if (codec === 'vp9') return ['-c:v', 'libvpx-vp9'];
  if (codec === 'vp8') return ['-c:v', 'libvpx'];
  return [];
}

/**
 * Decodes a video (WebM/MP4/MOV/APNG) into raw RGBA frames, scaled to "contain" the box
 * and centred on transparency. FPS and duration are cut while decoding.
 */
export async function decodeVideo(input: Buffer, info: MediaInfo, box: Box, fps: number, maxDurationMs: number): Promise<FrameSequence> {
  return withTempDir(async (dir) => {
    const file = path.join(dir, `input.${info.format}`);
    await writeFile(file, input);

    const { width: w, height: h } = box;
    const cmd = ffmpeg(file)
      .inputOptions(alphaAwareDecoder(info.codec))
      .videoFilters([
        `fps=${fps}`,
        `scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=lanczos`,
        'format=rgba',
        `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`,
      ])
      .outputOptions(['-t', (maxDurationMs / 1000).toFixed(3), '-an', '-f', 'rawvideo', '-pix_fmt', 'rgba']);

    const data = await runToBuffer(cmd);
    const count = Math.floor(data.length / (w * h * 4));
    if (count === 0) throw new MediaError('No frames could be decoded from the video');
    return { width: w, height: h, fps, frames: splitStackedFrames(data, w, h, count) };
  });
}

/** An ffmpeg command that reads a FrameSequence from stdin as raw RGBA video. */
function rawFramesCommand(seq: FrameSequence): ffmpeg.FfmpegCommand {
  return ffmpeg(Readable.from(seq.frames))
    .inputFormat('rawvideo')
    .inputOptions(['-pix_fmt', 'rgba', '-s', `${seq.width}x${seq.height}`, '-r', String(seq.fps)]);
}

/**
 * WebM VP9 with alpha (Telegram video stickers: ≤256KB, ≤3s, ≤30fps, no audio).
 * The target bitrate comes from the size limit; CRF goes up while the file is too big.
 */
export async function encodeWebm(seq: FrameSequence, maxBytes: number) {
  const seconds = Math.max(0.1, sequenceDurationMs(seq) / 1000);
  const targetKbps = Math.max(50, Math.floor((maxBytes * 8 * 0.85) / seconds / 1000));
  const attempts = [
    { crf: 30, drop: 1 },
    { crf: 40, drop: 1 },
    { crf: 50, drop: 1 },
    { crf: 50, drop: 2 },
    { crf: 63, drop: 2 },
  ];

  return withTempDir((dir) =>
    fitToSize(attempts, maxBytes, async (a) => {
      const s = decimate(seq, a.drop);
      const out = path.join(dir, `out-${a.crf}-${a.drop}.webm`);
      await run(
        rawFramesCommand(s)
          .videoCodec('libvpx-vp9')
          .outputOptions([
            '-pix_fmt', 'yuva420p',
            '-b:v', `${targetKbps}k`,
            '-crf', String(a.crf),
            '-deadline', 'good',
            '-cpu-used', '4',
            '-row-mt', '1',
            '-auto-alt-ref', '0', // required for reliable alpha encoding
            '-an',
          ])
          .output(out),
      );
      return readFile(out);
    }),
  );
}

/**
 * APNG (iMessage/Signal/Discord). RGBA APNG is heavy, so the loop moves to an 8-bit
 * palette (palettegen reserves one transparent colour) and lowers FPS when needed.
 */
export async function encodeApng(seq: FrameSequence, maxBytes: number) {
  const attempts = [
    { palette: 0, drop: 1 },
    { palette: 256, drop: 1 },
    { palette: 256, drop: 2 },
    { palette: 128, drop: 2 },
    { palette: 64, drop: 3 },
  ];

  return withTempDir((dir) =>
    fitToSize(attempts, maxBytes, async (a) => {
      const s = decimate(seq, a.drop);
      const out = path.join(dir, `out-${a.palette}-${a.drop}.png`);
      const cmd = rawFramesCommand(s);
      if (a.palette) {
        cmd.complexFilter(
          `[0:v]split[a][b];[a]palettegen=max_colors=${a.palette}:reserve_transparent=1[p];[b][p]paletteuse=alpha_threshold=128:dither=bayer`,
        );
      } else {
        cmd.outputOptions(['-pix_fmt', 'rgba']);
      }
      await run(cmd.outputOptions(['-f', 'apng', '-plays', '0', '-pred', 'mixed']).output(out));
      return readFile(out);
    }),
  );
}
