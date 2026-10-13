import { ZipArchive } from 'archiver';
import { strToU8, zipSync, type Zippable } from 'fflate';
import type { Readable } from 'node:stream';
import type { PlatformSpec } from '../../domain/platforms.js';
import type { ProcessedMedia } from '../ports/media.port.js';
import { slugify } from './ids.js';

export interface ZipSticker {
  media: ProcessedMedia;
  emojis: string[];
}

export interface ZipGroup {
  animated: boolean;
  stickers: ZipSticker[];
  tray: ProcessedMedia | null;
}

export interface ZipPackMeta {
  title: string;
  author: string;
  spec: PlatformSpec;
  warnings: string[];
}

/**
 * Splits stickers into sub-packs following the platform's rules: separate static and
 * animated when required, then cut by the maximum pack size (e.g. 30 for WhatsApp).
 */
export function groupForPlatform<T extends { animated: boolean }>(items: T[], spec: PlatformSpec): Array<{ animated: boolean; items: T[] }> {
  const buckets = spec.pack.splitByAnimation
    ? [
        { animated: false, items: items.filter((i) => !i.animated) },
        { animated: true, items: items.filter((i) => i.animated) },
      ]
    : [{ animated: items.some((i) => i.animated), items }];

  return buckets.flatMap((b) => {
    const chunks: Array<{ animated: boolean; items: T[] }> = [];
    for (let i = 0; i < b.items.length; i += spec.pack.max) {
      chunks.push({ animated: b.animated, items: b.items.slice(i, i + spec.pack.max) });
    }
    return chunks;
  });
}

const pad = (n: number) => String(n).padStart(2, '0');

function readme(meta: ZipPackMeta, groupCount: number): string {
  const { spec } = meta;
  const lines = [
    `${meta.title} – exported for ${spec.label} by Stickify`,
    '='.repeat(60),
    '',
    `Size: ${spec.canvas.width}×${spec.canvas.height}px`,
    `Static: ${spec.static.format.toUpperCase()} ≤ ${Math.round(spec.static.maxBytes / 1024)}KB`,
    spec.animated
      ? `Animated: ${spec.animated.format.toUpperCase()} ≤ ${Math.round(spec.animated.maxBytes / 1024)}KB, ≤ ${spec.animated.maxDurationMs / 1000}s`
      : 'Animated: not supported (the first frame was used)',
    groupCount > 1 ? `Split into ${groupCount} packs to fit ${spec.label}'s limits.` : '',
    '',
    `How to add these stickers to ${spec.label}:`,
    ...spec.importGuide.map((step, i) => `  ${i + 1}. ${step}`),
    '',
    'Notes:',
    ...spec.notes.map((n) => `  - ${n}`),
  ];
  if (meta.warnings.length) lines.push('', 'Processing warnings:', ...meta.warnings.map((w) => `  - ${w}`));
  return lines.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n') + '\n';
}

/** contents.json in the format of WhatsApp's official sample app (WhatsApp/stickers). */
function whatsappContents(meta: ZipPackMeta, group: ZipGroup, identifier: string, files: string[]) {
  return {
    android_play_store_link: '',
    ios_app_store_link: '',
    sticker_packs: [
      {
        identifier,
        name: meta.title.slice(0, 128),
        publisher: (meta.author || 'Stickify').slice(0, 128),
        tray_image_file: 'tray.png',
        image_data_version: '1',
        avoid_cache: false,
        animated_sticker_pack: group.animated,
        stickers: group.stickers.map((s, i) => ({ image_file: files[i], emojis: s.emojis.slice(0, 3) })),
      },
    ],
  };
}

/**
 * Builds the ZIP stream. Images are already compressed (WebP/PNG/WebM), so a low zlib
 * level is much faster with almost no size difference.
 */
export function buildStickerZip(meta: ZipPackMeta, groups: ZipGroup[]): Readable {
  const archive = new ZipArchive({ zlib: { level: 1 } });
  const root = slugify(meta.title);
  const manifest: Array<{ pack: number; file: string; emojis: string[]; animated: boolean; bytes: number }> = [];

  groups.forEach((group, gi) => {
    const dir = groups.length > 1 ? `${root}-${gi + 1}${group.animated ? '-animated' : ''}/` : '';
    const files = group.stickers.map((s, i) => `${pad(i + 1)}.${s.media.ext}`);

    group.stickers.forEach((s, i) => {
      archive.append(s.media.buffer, { name: `${dir}${files[i]}` });
      manifest.push({ pack: gi + 1, file: `${dir}${files[i]}`, emojis: s.emojis, animated: s.media.animated, bytes: s.media.buffer.length });
    });
    if (group.tray) archive.append(group.tray.buffer, { name: `${dir}tray.${group.tray.ext}` });

    if (meta.spec.id === 'whatsapp') {
      const title = groups.length > 1 ? `${meta.title} ${gi + 1}` : meta.title;
      const author = meta.author || 'Stickify';
      const contents = JSON.stringify(whatsappContents({ ...meta, title }, group, `${root}-${gi + 1}`, files), null, 2);
      archive.append(`${title}\n`, { name: `${dir}title.txt` });
      archive.append(`${author}\n`, { name: `${dir}author.txt` });
      archive.append(contents, { name: `${dir}contents.json` });

      // A .wastickers file is itself a ZIP with everything at its root – importer apps open it directly.
      const pack: Zippable = { 'title.txt': strToU8(`${title}\n`), 'author.txt': strToU8(`${author}\n`), 'contents.json': strToU8(contents) };
      group.stickers.forEach((s, i) => (pack[files[i]!] = new Uint8Array(s.media.buffer)));
      if (group.tray) pack['tray.png'] = new Uint8Array(group.tray.buffer);
      const name = groups.length > 1 ? `${root}-${gi + 1}${group.animated ? '-animated' : ''}` : root;
      archive.append(Buffer.from(zipSync(pack, { level: 0 })), { name: `${name}.wastickers` });
    }
  });

  archive.append(
    JSON.stringify({ app: 'stickify', platform: meta.spec.id, title: meta.title, author: meta.author, stickers: manifest }, null, 2),
    { name: 'manifest.json' },
  );
  archive.append(readme(meta, groups.length), { name: 'README.txt' });
  void archive.finalize();
  return archive;
}
