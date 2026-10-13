import { strToU8, zipSync } from 'fflate';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import type { RemotePack, StickerSourceProvider } from '../src/application/ports/sticker-source.port.js';
import { RemotePreviewService, type PreviewLimits } from '../src/application/services/remote-preview.service.js';
import { SourceRegistry } from '../src/application/services/source-registry.js';
import { logger } from '../src/config/logger.js';
import { DEFAULT_PROCESSING_OPTIONS } from '../src/domain/media.js';
import { PLATFORM_SPECS } from '../src/domain/platforms.js';
import { StickerProcessor } from '../src/infrastructure/media/sticker.processor.js';
import { TaskQueue } from '../src/infrastructure/queue/task-queue.js';

const webp = (shade: number, size = 64) => sharp({ create: { width: size, height: size, channels: 4, background: { r: shade, g: 0, b: 0, alpha: 1 } } }).webp().toBuffer();

/** Fake provider: counts pack fetches and per-sticker downloads; sticker #2 fails the first time. */
async function fakeProvider(stickerCount = 4, size = 64) {
  const calls = { fetchPack: 0, downloads: new Map<number, number>() };
  let failOnce = true;
  const files = await Promise.all(Array.from({ length: stickerCount }, (_, i) => webp(i * 40, size)));
  const provider: StickerSourceProvider = {
    id: 'signal',
    available: () => true,
    parse: (input) => (input.startsWith('pack:') ? input.slice(5) : null),
    fetchPack: async (ref): Promise<RemotePack> => {
      calls.fetchPack++;
      return {
        source: 'signal',
        externalId: ref,
        url: '',
        title: `Pack ${ref}`,
        author: '',
        counts: { animated: 0, video: 0, lottie: 0 },
        stickers: files.map((buf, i) => ({
          filename: `${i}.webp`,
          emojis: ['🙂'],
          kind: 'static' as const,
          download: async () => {
            calls.downloads.set(i, (calls.downloads.get(i) ?? 0) + 1);
            if (i === 2 && failOnce) {
              failOnce = false;
              throw new Error('network error');
            }
            return buf;
          },
        })),
      };
    },
  };
  return { provider, calls };
}

const service = (provider: StickerSourceProvider, limits?: PreviewLimits) =>
  new RemotePreviewService(new SourceRegistry([provider]), new StickerProcessor(), new TaskQueue(2, logger), limits);

describe('RemotePreviewService – link sessions', () => {
  it('the same link shares one session; each file is downloaded once for preview and import', async () => {
    const { provider, calls } = await fakeProvider();
    const previews = service(provider);

    const s1 = await previews.open('signal', 'pack:a');
    const s2 = await previews.open('signal', 'pack:a');
    expect(s2.id).toBe(s1.id);
    expect(calls.fetchPack).toBe(1);

    const file = await previews.file(s1.id, 0);
    expect(file.mime).toBe('image/webp');
    await previews.file(s1.id, 0);
    await previews.collectById(s1.id, [0, 1]);
    expect(calls.downloads.get(0)).toBe(1); // previewed twice + imported → still one download
  });

  it('collects only selected stickers, in pack order, ignoring invalid indices', async () => {
    const { provider } = await fakeProvider();
    const previews = service(provider);
    const r = await previews.collect('signal', 'pack:a', [3, 0, 3, 99]);
    expect(r.files.map((f) => f.index)).toEqual([0, 3]);
    await expect(previews.collect('signal', 'pack:a', [99])).rejects.toThrow(/No stickers selected/);
  });

  it('download failures are not cached – the next attempt retries', async () => {
    const { provider, calls } = await fakeProvider();
    const previews = service(provider);
    const s = await previews.open('signal', 'pack:a');
    await expect(previews.file(s.id, 2)).rejects.toThrow('network error');
    await expect(previews.file(s.id, 2)).resolves.toMatchObject({ mime: 'image/webp' });
    expect(calls.downloads.get(2)).toBe(2);
  });

  it('reports per-sticker failures instead of failing the whole pack', async () => {
    const { provider } = await fakeProvider();
    const previews = service(provider);
    const r = await previews.collect('signal', 'pack:a');
    expect(r.files.map((f) => f.index)).toEqual([0, 1, 3]);
    expect(r.failed).toEqual([{ filename: '2.webp', message: 'network error' }]);
  });

  it('expired / unknown session → clear 404', async () => {
    const { provider } = await fakeProvider();
    const previews = service(provider, { ttlMs: 1, maxBytes: 1e9, maxSessions: 10 });
    const s = await previews.open('signal', 'pack:a');
    await new Promise((r) => setTimeout(r, 5));
    await expect(previews.file(s.id, 0)).rejects.toThrow(/expired/);
    await expect(previews.file('0'.repeat(32), 0)).rejects.toThrow(/expired/);
  });

  it('over the byte budget → the least recently used session is dropped', async () => {
    const { provider } = await fakeProvider(2, 200);
    const previews = service(provider, { ttlMs: 60_000, maxBytes: 1, maxSessions: 10 });
    const a = await previews.open('signal', 'pack:a');
    await previews.collect('signal', 'pack:a');
    const b = await previews.open('signal', 'pack:b');
    await previews.collect('signal', 'pack:b'); // over budget → session a goes
    await expect(previews.file(a.id, 0)).rejects.toThrow(/expired/);
    await expect(previews.file(b.id, 0)).resolves.toBeTruthy();
  });

  it('renders a sticker for a target platform and caches the result', async () => {
    const { provider } = await fakeProvider();
    const previews = service(provider);
    const s = await previews.open('signal', 'pack:a');
    const first = await previews.render(s.id, 0, PLATFORM_SPECS.discord, DEFAULT_PROCESSING_OPTIONS);
    const meta = await sharp(first.buffer).metadata();
    expect([first.format, meta.width, meta.height]).toEqual(['png', 320, 320]);
    const again = await previews.render(s.id, 0, PLATFORM_SPECS.discord, DEFAULT_PROCESSING_OPTIONS);
    expect(again).toBe(first); // same cached object
  });
});

describe('RemotePreviewService – upload sessions', () => {
  it('unpacks archives, keeps emojis/title, probes kinds and rejects non-stickers', async () => {
    const { provider } = await fakeProvider();
    const previews = service(provider);
    const img = await webp(10);
    const contents = { sticker_packs: [{ name: 'WA pack', publisher: 'Someone', tray_image_file: 'tray.png', stickers: [{ image_file: '1.webp', emojis: ['😂'] }] }] };
    const wastickers = Buffer.from(
      zipSync({ 'title.txt': strToU8('My WA Pack'), '1.webp': new Uint8Array(img), 'tray.png': new Uint8Array(img), 'contents.json': strToU8(JSON.stringify(contents)) }),
    );
    const loose = await webp(200);

    const { session, failed } = await previews.openUpload('whatsapp', [
      { buffer: wastickers, filename: 'pack.wastickers' },
      { buffer: loose, filename: 'loose.webp' },
      { buffer: Buffer.from('not an image at all!'), filename: 'notes.png' },
    ]);
    const d = previews.describe(session);
    expect(d).toMatchObject({ origin: 'upload', source: 'whatsapp', title: 'My WA Pack', author: 'Someone', count: 2 });
    expect(d.stickers.map((s) => [s.filename, s.emojis, s.kind])).toEqual([
      ['1.webp', ['😂'], 'static'],
      ['loose.webp', [], 'static'],
    ]);
    expect(failed.map((f) => f.filename)).toEqual(['notes.png']);
  });

  it('appends files to an existing upload review', async () => {
    const { provider } = await fakeProvider();
    const previews = service(provider);
    const { session } = await previews.openUpload('file', [{ buffer: await webp(1), filename: 'a.webp' }]);
    await previews.openUpload('file', [{ buffer: await webp(2), filename: 'b.webp' }], session.id);
    expect(previews.describe(session).stickers.map((s) => s.filename)).toEqual(['a.webp', 'b.webp']);
  });

  it('an upload with no valid stickers is rejected', async () => {
    const { provider } = await fakeProvider();
    const previews = service(provider);
    await expect(previews.openUpload('file', [{ buffer: Buffer.from('garbage-garbage'), filename: 'x.png' }])).rejects.toThrow(/Unsupported format/);
  });
});
