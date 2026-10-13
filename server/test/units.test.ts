import { describe, expect, it } from 'vitest';
import { slugify } from '../src/application/services/ids.js';
import { buildStickerSetName } from '../src/application/services/telegram-publish.service.js';
import { groupForPlatform } from '../src/application/services/zip-builder.js';
import { PLATFORM_IDS, PLATFORM_SPECS } from '../src/domain/platforms.js';
import { SOURCE_SPECS } from '../src/domain/sources.js';
import { applyStroke, decimate, padFrame, resampleFrames } from '../src/infrastructure/media/frames.js';
import { detectFormat } from '../src/infrastructure/media/probe.js';
import { parseStickerSetName } from '../src/infrastructure/telegram/telegram.client.js';

describe('parseStickerSetName', () => {
  it.each([
    ['https://t.me/addstickers/Animals', 'Animals'],
    ['t.me/addstickers/Cute_Cats_by_bot/', 'Cute_Cats_by_bot'],
    ['https://telegram.me/addemoji/Foo?x=1', 'Foo'],
    ['tg://addstickers?set=Bar', 'Bar'],
    ['PlainName', 'PlainName'],
  ])('%s → %s', (input, expected) => expect(parseStickerSetName(input)).toBe(expected));

  it.each(['https://evil.com/addstickers/x', 'not a link!!', '', '1abc'])('rejects %j', (input) => {
    expect(parseStickerSetName(input)).toBeNull();
  });
});

describe('buildStickerSetName', () => {
  it('follows Telegram rules: [a-z0-9_], starts with a letter, _by_<bot> suffix, ≤ 64 chars', () => {
    // Accented titles are deliberate test data: accents must be stripped.
    for (const title of ['Mèo cam lầy lội', '123 numbers', '!!!', 'x'.repeat(200)]) {
      const name = buildStickerSetName(title, 'StickifyBot');
      expect(name).toMatch(/^[a-z][a-z0-9_]*_by_StickifyBot$/);
      expect(name.length).toBeLessThanOrEqual(64);
      expect(name).not.toContain('__');
    }
  });
});

describe('slugify', () => {
  it('strips accents, including Vietnamese "đ"', () => expect(slugify('Gói Đặc Biệt!')).toBe('goi-dac-biet'));
  it('falls back when nothing is left', () => expect(slugify('🔥🔥')).toBe('stickers'));
});

describe('detectFormat', () => {
  const pad = (b: number[]) => Buffer.concat([Buffer.from(b), Buffer.alloc(16)]);
  it('detects formats from magic bytes', () => {
    expect(detectFormat(pad([0x89, 0x50, 0x4e, 0x47]))).toBe('png');
    expect(detectFormat(pad([0xff, 0xd8, 0xff]))).toBe('jpeg');
    expect(detectFormat(Buffer.from('GIF89a' + ' '.repeat(10)))).toBe('gif');
    expect(detectFormat(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('webp');
    expect(detectFormat(pad([0x1a, 0x45, 0xdf, 0xa3]))).toBe('webm');
    expect(detectFormat(Buffer.from('\0\0\0\x18ftypisom\0\0\0\0'))).toBe('mp4');
    expect(detectFormat(Buffer.from('\0\0\0\x14ftypqt  \0\0\0\0'))).toBe('mov');
    expect(detectFormat(Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('svg');
  });
  it('returns null for unknown data', () => expect(detectFormat(Buffer.from('hello world, not an image'))).toBeNull());
});

describe('frames', () => {
  const frame = (v: number) => Buffer.alloc(4, v);

  it('resampleFrames turns variable delays into a constant FPS and cuts the duration', () => {
    const frames = [frame(1), frame(2), frame(3)];
    // 100ms, 300ms, 100ms @ 10fps → 1,2,2,2,3
    expect(resampleFrames(frames, [100, 300, 100], 10, 10_000).map((f) => f[0])).toEqual([1, 2, 2, 2, 3]);
    // cut to 200ms → 2 frames
    expect(resampleFrames(frames, [100, 300, 100], 10, 200)).toHaveLength(2);
  });

  it('decimate lowers FPS and frame count', () => {
    const seq = { width: 1, height: 1, fps: 30, frames: Array.from({ length: 9 }, (_, i) => frame(i)) };
    const out = decimate(seq, 3);
    expect(out.fps).toBe(10);
    expect(out.frames.map((f) => f[0])).toEqual([0, 3, 6]);
  });

  it('padFrame centres on transparency', () => {
    const src = Buffer.from([255, 0, 0, 255]); // 1×1 red
    const out = padFrame(src, 1, 1, 3, 3);
    expect([...out.subarray(16, 20)]).toEqual([255, 0, 0, 255]); // centre (1,1)
    expect(out[3]).toBe(0); // transparent corner
  });

  it('applyStroke draws an outline exactly b px wide around the shape', () => {
    const W = 41;
    const src = Buffer.alloc(W * W * 4);
    const set = (x: number, y: number) => src.fill(255, (y * W + x) * 4, (y * W + x) * 4 + 4);
    set(20, 20); // one solid pixel in the middle
    const out = applyStroke(src, W, W, 6, '#00ff00');
    const alphaAt = (x: number, y: number) => out[(y * W + x) * 4 + 3]!;
    const greenAt = (x: number, y: number) => out[(y * W + x) * 4 + 1]!;
    expect(alphaAt(25, 20)).toBe(255); // 5px away → inside the outline
    expect(greenAt(25, 20)).toBe(255);
    expect(alphaAt(26, 20)).toBe(128); // exactly 6px → anti-aliased edge (50%)
    expect(alphaAt(24, 24)).toBeGreaterThan(0); // diagonal ~5.7px → evenly round outline
    expect(alphaAt(28, 20)).toBe(0); // 8px → outside
    expect([...out.subarray((20 * W + 20) * 4, (20 * W + 20) * 4 + 4)]).toEqual([255, 255, 255, 255]); // the original is untouched
  });
});

describe('groupForPlatform', () => {
  const items = (s: number, a: number) => [
    ...Array.from({ length: s }, () => ({ animated: false })),
    ...Array.from({ length: a }, () => ({ animated: true })),
  ];

  it('WhatsApp: separates static/animated and splits at 30', () => {
    const groups = groupForPlatform(items(45, 5), PLATFORM_SPECS.whatsapp);
    expect(groups.map((g) => [g.animated, g.items.length])).toEqual([
      [false, 30],
      [false, 15],
      [true, 5],
    ]);
  });

  it('Telegram: allows mixing, splits at 120', () => {
    const groups = groupForPlatform(items(100, 30), PLATFORM_SPECS.telegram);
    expect(groups.map((g) => g.items.length)).toEqual([120, 10]);
  });
});

describe('guides', () => {
  it('every target platform has an import guide and every source has steps', () => {
    for (const id of PLATFORM_IDS) expect(PLATFORM_SPECS[id].importGuide.length).toBeGreaterThan(1);
    for (const spec of Object.values(SOURCE_SPECS)) expect(spec.steps.length).toBeGreaterThan(0);
  });
});
