import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { unzipSync } from 'fflate';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { buildStickerZip } from '../src/application/services/zip-builder.js';
import { DEFAULT_PROCESSING_OPTIONS } from '../src/domain/media.js';
import { PLATFORM_SPECS } from '../src/domain/platforms.js';
import { StickerProcessor } from '../src/infrastructure/media/sticker.processor.js';

const processor = new StickerProcessor();
const transparent = { r: 0, g: 0, b: 0, alpha: 0 };

/** 800×400 transparent PNG with an ellipse – not square, to test padding. */
async function makePng() {
  return sharp({ create: { width: 800, height: 400, channels: 4, background: transparent } })
    .composite([{ input: Buffer.from('<svg width="800" height="400"><ellipse cx="400" cy="200" rx="300" ry="150" fill="#3a7"/></svg>') }])
    .png()
    .toBuffer();
}

/** 20-frame animated GIF with a moving circle. */
async function makeGif() {
  const n = 20, W = 120, H = 80;
  const raw = Buffer.alloc(W * H * 4 * n);
  for (let f = 0; f < n; f++)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const o = ((f * H + y) * W + x) * 4;
        if (Math.hypot(x - (20 + f * 4), y - 40) < 18) raw.set([230, 60, 90, 255], o);
      }
  return sharp(raw, { raw: { width: W, height: H * n, channels: 4, pageHeight: H } as never })
    .gif({ delay: Array(n).fill(100), loop: 0 })
    .toBuffer();
}

describe('StickerProcessor', () => {
  it('PNG → WhatsApp: WebP 512×512, ≤100KB, transparent corners', async () => {
    const png = await makePng();
    const info = await processor.probe(png);
    expect(info).toMatchObject({ format: 'png', kind: 'static', width: 800, height: 400 });

    const out = await processor.processForPlatform(png, info, PLATFORM_SPECS.whatsapp, { ...DEFAULT_PROCESSING_OPTIONS, borderWidth: 8 });
    const meta = await sharp(out.buffer).metadata();
    expect(out.format).toBe('webp');
    expect([meta.width, meta.height]).toEqual([512, 512]);
    expect(out.buffer.length).toBeLessThanOrEqual(100 * 1024);
    const { data } = await sharp(out.buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(data[3]).toBe(0);
  });

  it('rasterises SVG crisply at the target size', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#f00"/></svg>');
    const info = await processor.probe(svg);
    expect(info.kind).toBe('vector');
    const out = await processor.processForPlatform(svg, info, PLATFORM_SPECS.imessage, { ...DEFAULT_PROCESSING_OPTIONS, padding: 0, trim: false });
    const meta = await sharp(out.buffer).metadata();
    expect([out.format, meta.width, meta.height]).toEqual(['png', 408, 408]);
  });

  it('GIF → WhatsApp: animated WebP 512×512 ≤500KB', async () => {
    const gif = await makeGif();
    const info = await processor.probe(gif);
    expect(info).toMatchObject({ kind: 'animated', frames: 20, durationMs: 2000 });
    const out = await processor.processForPlatform(gif, info, PLATFORM_SPECS.whatsapp, DEFAULT_PROCESSING_OPTIONS);
    const meta = await sharp(out.buffer, { animated: true }).metadata();
    expect(out.animated).toBe(true);
    expect(meta.pages).toBeGreaterThan(1);
    expect([meta.width, meta.pageHeight]).toEqual([512, 512]);
    expect(out.buffer.length).toBeLessThanOrEqual(500 * 1024);
  });

  it('GIF → Telegram: WebM VP9 with alpha, ≤256KB', async () => {
    const gif = await makeGif();
    const out = await processor.processForPlatform(gif, await processor.probe(gif), PLATFORM_SPECS.telegram, DEFAULT_PROCESSING_OPTIONS);
    expect(out.format).toBe('webm');
    expect(out.buffer.length).toBeLessThanOrEqual(256 * 1024);
    expect(out.buffer.subarray(0, 4)).toEqual(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  });

  it('5s video → Telegram is cut to 3s with a warning; Viber gets the first frame', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'stickify-test-'));
    const file = path.join(dir, 'clip.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=24:duration=5', '-pix_fmt', 'yuv420p', file]);
    const mp4 = readFileSync(file);
    const info = await processor.probe(mp4);
    expect(info).toMatchObject({ kind: 'video', format: 'mp4' });

    const tg = await processor.processForPlatform(mp4, info, PLATFORM_SPECS.telegram, DEFAULT_PROCESSING_OPTIONS);
    expect(tg.warnings.some((w) => w.includes('Cut to 3.0 s'))).toBe(true);

    const viber = await processor.processForPlatform(mp4, info, PLATFORM_SPECS.viber, DEFAULT_PROCESSING_OPTIONS);
    expect(viber.format).toBe('png');
    expect(viber.animated).toBe(false);
  }, 30_000);

  it('rejects files that are not images', async () => {
    await expect(processor.probe(Buffer.from('definitely not an image file'))).rejects.toThrow(/Unsupported format/);
  });
});

describe('WhatsApp export ZIP', () => {
  it('contains a ready-to-import .wastickers per pack and the import guide in README', async () => {
    const png = await makePng();
    const info = await processor.probe(png);
    const spec = PLATFORM_SPECS.whatsapp;
    const media = await processor.processForPlatform(png, info, spec, DEFAULT_PROCESSING_OPTIONS);
    const tray = await processor.makeTrayIcon(png, info, spec.tray!, DEFAULT_PROCESSING_OPTIONS);

    const stream = buildStickerZip({ title: 'Cats', author: 'Me', spec, warnings: [] }, [
      { animated: false, tray, stickers: [0, 1, 2].map(() => ({ media, emojis: ['😺'] })) },
    ]);
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    const outer = unzipSync(new Uint8Array(Buffer.concat(chunks)));

    expect(Object.keys(outer)).toContain('cats.wastickers');
    const inner = unzipSync(outer['cats.wastickers']!);
    expect(Object.keys(inner).sort()).toEqual(['01.webp', '02.webp', '03.webp', 'author.txt', 'contents.json', 'title.txt', 'tray.png']);
    expect(Buffer.from(outer['README.txt']!).toString()).toContain('How to add these stickers to WhatsApp');
  });
});
