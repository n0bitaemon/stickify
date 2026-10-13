import path from 'node:path';
import { unzipSync, type UnzipFileInfo } from 'fflate';
import { MediaError } from '../../domain/errors.js';

const STICKER_EXT = /\.(png|jpe?g|webp|gif|svg|webm|mp4|mov|tgs)$/i;
const META_FILES = new Set(['title.txt', 'author.txt', 'contents.json']);
const MAX_ENTRIES = 300;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;
const MAX_ENTRY_BYTES = 20 * 1024 * 1024;

export interface ArchiveFile {
  buffer: Buffer;
  filename: string;
  emojis?: string[];
}

export interface StickerArchive {
  title?: string;
  author?: string;
  files: ArchiveFile[];
}

export const isZip = (buf: Buffer) => buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;

interface WaContents {
  sticker_packs?: Array<{
    name?: string;
    publisher?: string;
    tray_image_file?: string;
    stickers?: Array<{ image_file?: string; emojis?: string[] }>;
  }>;
}

/**
 * Reads a .wastickers/.zip file (the format of WhatsApp sticker maker apps and of
 * Stickify's own exports): sticker files + pack name/author/emojis from title.txt,
 * author.txt and contents.json. The tray icon is skipped.
 *
 * "Zip bomb" protection: entry count and uncompressed size are checked from the headers
 * BEFORE extracting (fflate's filter), and only the files we need are extracted.
 * Nested .wastickers files inside an export are ignored – the loose files cover them.
 */
export function readStickerArchive(buf: Buffer): StickerArchive {
  let total = 0;
  let count = 0;
  const filter = (f: UnzipFileInfo) => {
    const base = path.posix.basename(f.name).toLowerCase();
    if (f.name.endsWith('/') || base.startsWith('.') || f.name.includes('__MACOSX')) return false;
    const wanted = STICKER_EXT.test(base) || META_FILES.has(base);
    if (!wanted) return false;
    if (++count > MAX_ENTRIES) throw new MediaError(`The archive contains more than ${MAX_ENTRIES} files`);
    if (f.originalSize > MAX_ENTRY_BYTES) throw new MediaError(`"${base}" in the archive is larger than 20MB`);
    total += f.originalSize;
    if (total > MAX_TOTAL_BYTES) throw new MediaError('The archive is too large once extracted');
    return true;
  };

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), { filter });
  } catch (err) {
    if (err instanceof MediaError) throw err;
    throw new MediaError('The archive is corrupt or not a ZIP file');
  }

  // ZIPs with several sub-packs (e.g. a split Stickify WhatsApp export) → use the first pack's metadata.
  const byBase = new Map<string, Buffer>();
  for (const name of Object.keys(entries).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
    const base = path.posix.basename(name).toLowerCase();
    if (!byBase.has(base)) byBase.set(base, Buffer.from(entries[name]!));
  }

  const text = (name: string) => byBase.get(name)?.toString('utf8').trim() || undefined;
  let contents: WaContents | undefined;
  try {
    const raw = text('contents.json');
    contents = raw ? (JSON.parse(raw) as WaContents) : undefined;
  } catch {
    contents = undefined; // a broken contents.json must not block importing the images
  }
  const waPack = contents?.sticker_packs?.[0];
  const emojiByFile = new Map((waPack?.stickers ?? []).map((s) => [String(s.image_file).toLowerCase(), s.emojis ?? []]));
  const tray = waPack?.tray_image_file?.toLowerCase();

  const files: ArchiveFile[] = Object.entries(entries)
    .filter(([name]) => STICKER_EXT.test(name))
    .map(([name, data]) => ({ name, base: path.posix.basename(name), data }))
    .filter(({ base }) => base.toLowerCase() !== tray && !/^tray[._-]/i.test(base))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    .map(({ base, data }) => ({ buffer: Buffer.from(data), filename: base, emojis: emojiByFile.get(base.toLowerCase()) }));

  if (files.length === 0) throw new MediaError('No stickers found in the archive');
  return { title: text('title.txt') ?? waPack?.name, author: text('author.txt') ?? waPack?.publisher, files };
}

/**
 * Expands ZIP files in an upload into loose sticker files (other files pass through).
 * A broken ZIP only fails itself.
 */
export function expandArchives<T extends ArchiveFile>(inputs: T[]): { files: ArchiveFile[]; failed: Array<{ filename: string; message: string }> } {
  const files: ArchiveFile[] = [];
  const failed: Array<{ filename: string; message: string }> = [];
  for (const input of inputs) {
    if (!isZip(input.buffer)) {
      files.push(input);
      continue;
    }
    try {
      files.push(...readStickerArchive(input.buffer).files);
    } catch (err) {
      failed.push({ filename: input.filename, message: (err as Error).message });
    }
  }
  return { files, failed };
}
