import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { SourceRegistry } from '../src/application/services/source-registry.js';
import { DEFAULT_PROCESSING_OPTIONS } from '../src/domain/media.js';
import { PLATFORM_SPECS } from '../src/domain/platforms.js';
import { expandArchives, readStickerArchive } from '../src/infrastructure/archive/sticker-archive.js';
import { parseApng } from '../src/infrastructure/media/probe.js';
import { StickerProcessor } from '../src/infrastructure/media/sticker.processor.js';
import { decryptSignalBlob, parseSignalManifest, SignalSource } from '../src/infrastructure/sources/signal.source.js';
import { TelegramSource } from '../src/infrastructure/sources/telegram.source.js';
import { TelegramClient } from '../src/infrastructure/telegram/telegram.client.js';

const PACK_ID = '9acc9e8aba563d26a4994e69263e3b25';
const PACK_KEY = '5a6dff3948c28efb9b7aaf93ecc375c69fc316e78077ed26867a14d10a0f6a12';

describe('SignalSource', () => {
  const signal = new SignalSource();

  it('parses signal.art and sgnl:// links', () => {
    expect(signal.parse(`https://signal.art/addstickers/#pack_id=${PACK_ID}&pack_key=${PACK_KEY}`)).toBe(`${PACK_ID}:${PACK_KEY}`);
    expect(signal.parse(`sgnl://addstickers/?pack_id=${PACK_ID.toUpperCase()}&pack_key=${PACK_KEY}`, true)).toBe(`${PACK_ID}:${PACK_KEY}`);
  });

  it('rejects links with a missing key or wrong lengths', () => {
    expect(signal.parse(`https://signal.art/addstickers/#pack_id=${PACK_ID}`)).toBeNull();
    expect(signal.parse(`https://signal.art/addstickers/#pack_id=abc&pack_key=${PACK_KEY}`)).toBeNull();
    // strict: must be a Signal URL
    expect(signal.parse(`pack_id=${PACK_ID}&pack_key=${PACK_KEY}`, true)).toBeNull();
  });

  // Encrypt the way Signal does to test decryption round-trip (no network needed).
  const okm = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(PACK_KEY, 'hex'), Buffer.alloc(32), Buffer.from('Sticker Pack'), 64));
  const keys = { aesKey: okm.subarray(0, 32), macKey: okm.subarray(32) };
  const encrypt = (plain: Buffer) => {
    const iv = crypto.randomBytes(16);
    const c = crypto.createCipheriv('aes-256-cbc', keys.aesKey, iv);
    const body = Buffer.concat([iv, c.update(plain), c.final()]);
    return Buffer.concat([body, crypto.createHmac('sha256', keys.macKey).update(body).digest()]);
  };

  it('decrypts a blob and rejects a wrong MAC', () => {
    const blob = encrypt(Buffer.from('hello sticker'));
    expect(decryptSignalBlob(blob, keys).toString()).toBe('hello sticker');
    blob[20]! ^= 1;
    expect(() => decryptSignalBlob(blob, keys)).toThrow(/pack_key/);
  });

  it('parses the protobuf manifest (title, author, sticker id/emoji/contentType)', () => {
    const field = (n: number, v: Buffer) => Buffer.concat([Buffer.from([(n << 3) | 2, v.length]), v]);
    const sticker = (id: number, emoji: string, ct: string) =>
      Buffer.concat([Buffer.from([0x08, id]), field(2, Buffer.from(emoji)), field(3, Buffer.from(ct))]);
    const manifest = Buffer.concat([
      field(1, Buffer.from('Bandit the Cat')),
      field(2, Buffer.from('Agnes Lee')),
      field(4, sticker(0, '👍', 'image/webp')),
      field(4, sticker(1, '😔', 'image/apng')),
    ]);
    expect(parseSignalManifest(manifest)).toEqual({
      title: 'Bandit the Cat',
      author: 'Agnes Lee',
      stickers: [
        { id: 0, emoji: '👍', contentType: 'image/webp' },
        { id: 1, emoji: '😔', contentType: 'image/apng' },
      ],
    });
  });
});

describe('SourceRegistry', () => {
  const registry = new SourceRegistry([new TelegramSource(new TelegramClient()), new SignalSource()]);

  it('Telegram is unavailable without a token; Signal is always available', () => {
    const list = registry.list();
    expect(list.find((s) => s.id === 'telegram')?.available).toBe(false);
    expect(list.find((s) => s.id === 'signal')?.available).toBe(true);
    expect(list.find((s) => s.id === 'whatsapp')).toMatchObject({ input: 'archive', available: true });
  });

  it('clear errors: source not configured, bad link, source without links', () => {
    expect(() => registry.resolve('telegram', 'https://t.me/addstickers/deathclickk')).toThrow(/not configured/);
    expect(() => registry.resolve('signal', 'https://t.me/addstickers/x')).toThrow(/Invalid Signal link/);
    expect(() => registry.resolve('whatsapp', 'abc')).toThrow(/does not import from links/);
  });

  it('finds a Signal link inside a message', () => {
    const text = `check this pack https://signal.art/addstickers/#pack_id=${PACK_ID}&pack_key=${PACK_KEY} please`;
    expect(registry.detect(text)?.source).toBe('signal');
    expect(registry.detect('hello bot')).toBeNull();
  });
});

describe('WhatsApp archives', () => {
  const webp = () => sharp({ create: { width: 64, height: 64, channels: 4, background: '#f00' } }).webp().toBuffer();

  it('reads .wastickers: title/author, emojis from contents.json, skips the tray, numeric order', async () => {
    const img = new Uint8Array(await webp());
    const contents = {
      sticker_packs: [{ name: 'WA pack', publisher: 'Someone', tray_image_file: 'tray.png', stickers: [{ image_file: '10.webp', emojis: ['😂'] }] }],
    };
    const zip = Buffer.from(
      zipSync({
        'title.txt': strToU8('Cat Stickers'),
        'tray.png': img,
        '2.webp': img,
        '10.webp': img,
        'contents.json': strToU8(JSON.stringify(contents)),
        '__MACOSX/._2.webp': img,
        'notes.pdf': strToU8('ignored'),
      }),
    );
    const archive = readStickerArchive(zip);
    expect(archive.title).toBe('Cat Stickers'); // title.txt wins over contents.json
    expect(archive.author).toBe('Someone');
    expect(archive.files.map((f) => [f.filename, f.emojis])).toEqual([
      ['2.webp', undefined], // not in contents.json → the pack's default emoji is used
      ['10.webp', ['😂']],
    ]);
  });

  it('a broken ZIP only fails itself; normal files pass through', async () => {
    const good = { buffer: await webp(), filename: 'a.webp' };
    const broken = { buffer: Buffer.from('PK\x03\x04garbage-garbage'), filename: 'x.zip' };
    const { files, failed } = expandArchives([good, broken]);
    expect(files.map((f) => f.filename)).toEqual(['a.webp']);
    expect(failed).toHaveLength(1);
  });
});

describe('APNG (Signal animated stickers)', () => {
  it('detects APNG, reads frame count + duration, exports WebM for Telegram', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'stickify-apng-'));
    const file = path.join(dir, 'a.png');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x160:rate=10:duration=1.5', '-f', 'apng', '-plays', '0', file]);
    const buf = readFileSync(file);
    expect(parseApng(buf)).toEqual({ frames: 15, durationMs: 1500 });

    const processor = new StickerProcessor();
    const info = await processor.probe(buf);
    expect(info).toMatchObject({ format: 'apng', kind: 'animated', frames: 15 });

    const out = await processor.processForPlatform(buf, info, PLATFORM_SPECS.telegram, DEFAULT_PROCESSING_OPTIONS);
    expect(out.format).toBe('webm');
    expect(out.animated).toBe(true);
  });

  it('a plain PNG is not mistaken for APNG', async () => {
    const png = await sharp({ create: { width: 10, height: 10, channels: 4, background: '#000' } }).png().toBuffer();
    expect(parseApng(png)).toBeNull();
  });
});
