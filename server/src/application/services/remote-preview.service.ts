import { randomBytes } from 'node:crypto';
import { AppError, ValidationError } from '../../domain/errors.js';
import { MIME_BY_SOURCE, type MediaInfo, type MediaKind, type ProcessingOptions } from '../../domain/media.js';
import type { PlatformSpec } from '../../domain/platforms.js';
import type { SourceId } from '../../domain/sources.js';
import { isZip, readStickerArchive } from '../../infrastructure/archive/sticker-archive.js';
import { mapLimit, type TaskQueue } from '../../infrastructure/queue/task-queue.js';
import type { MediaProcessorPort, ProcessedMedia } from '../ports/media.port.js';
import type { RemoteSticker } from '../ports/sticker-source.port.js';
import { MAX_REMOTE_STICKERS, type SourceRegistry } from './source-registry.js';

type StickerKind = RemoteSticker['kind'];

/** A pack under review – from a share link or from uploaded files. */
interface PreviewPack {
  source: SourceId;
  origin: 'link' | 'upload';
  title: string;
  author: string;
  url?: string;
  externalId?: string;
  stickers: RemoteSticker[];
}

interface Session {
  id: string;
  /** Link sessions: "<source>:<ref>" so the same link reuses one session. Uploads: unique. */
  key: string;
  pack: PreviewPack;
  /** One download per sticker, shared by the preview grid and the final import/convert. */
  files: Map<number, Promise<Buffer>>;
  probes: Map<number, Promise<MediaInfo>>;
  /** Target-platform previews, keyed by "<index>|<platform>|<options>". */
  renders: Map<string, Promise<ProcessedMedia>>;
  bytes: number;
  lastUsed: number;
  /** The original pack had more than MAX_REMOTE_STICKERS stickers (it was cut). */
  truncated: boolean;
}

export interface CollectedFile {
  index: number;
  buffer: Buffer;
  filename: string;
  emojis: string[];
  telegram?: { fileId: string; fileUniqueId: string };
}

export interface PreviewLimits {
  ttlMs: number;
  maxBytes: number;
  maxSessions: number;
}

const DEFAULT_LIMITS: PreviewLimits = { ttlMs: 15 * 60 * 1000, maxBytes: 300 * 1024 * 1024, maxSessions: 30 };

const KIND_BY_MEDIA: Record<MediaKind, StickerKind> = { static: 'static', vector: 'static', animated: 'animated', video: 'video', lottie: 'lottie' };

/**
 * Review sessions for sticker packs before they are imported or converted.
 *
 * - Link packs: browsers cannot fetch them directly (Signal stickers are encrypted,
 *   Telegram needs the bot token), so the server keeps the pack and serves each file.
 *   The same link (source + pack) reuses one session, so "Import"/"Convert" after
 *   reviewing does not download anything again.
 * - Uploaded files: archives are unpacked and every file is probed once, so the review
 *   grid shows exactly what will be imported, including the contents of .wastickers/.zip.
 * - Sessions are bounded by time-to-live, total bytes and count; the least recently used
 *   session goes first. An evicted session only means the user has to load it again.
 */
export class RemotePreviewService {
  private readonly byId = new Map<string, Session>();
  private readonly byKey = new Map<string, Session>();

  constructor(
    private readonly sources: SourceRegistry,
    private readonly media: MediaProcessorPort,
    private readonly mediaQueue: TaskQueue,
    private readonly limits: PreviewLimits = DEFAULT_LIMITS,
  ) {}

  private register(key: string, pack: PreviewPack, truncated: boolean): Session {
    const session: Session = {
      id: randomBytes(16).toString('hex'),
      key,
      pack,
      files: new Map(),
      probes: new Map(),
      renders: new Map(),
      bytes: 0,
      lastUsed: Date.now(),
      truncated,
    };
    this.byId.set(session.id, session);
    this.byKey.set(key, session);
    return session;
  }

  /** Opens (or reuses) the session for a share link. */
  async open(source: SourceId, input: string): Promise<Session> {
    this.evict();
    const { provider, ref } = this.sources.resolve(source, input);
    const key = `${source}:${ref}`;
    const existing = this.byKey.get(key);
    if (existing) {
      existing.lastUsed = Date.now();
      return existing;
    }

    const remote = await provider.fetchPack(ref);
    const truncated = remote.stickers.length > MAX_REMOTE_STICKERS;
    return this.register(
      key,
      {
        source,
        origin: 'link',
        title: remote.title,
        author: remote.author,
        url: remote.url,
        externalId: remote.externalId,
        stickers: remote.stickers.slice(0, MAX_REMOTE_STICKERS),
      },
      truncated,
    );
  }

  /**
   * Creates a session from uploaded files (or appends to an existing upload session).
   * Archives are unpacked; files that are not valid stickers are reported in `failed`.
   */
  async openUpload(source: SourceId, uploads: Array<{ buffer: Buffer; filename: string }>, appendTo?: string) {
    this.evict();
    const failed: Array<{ filename: string; message: string }> = [];
    let title: string | undefined;
    let author: string | undefined;

    // 1. Unpack archives, keeping per-sticker emojis from contents.json.
    const files: Array<{ buffer: Buffer; filename: string; emojis?: string[] }> = [];
    for (const upload of uploads) {
      if (!isZip(upload.buffer)) {
        files.push(upload);
        continue;
      }
      try {
        const archive = readStickerArchive(upload.buffer);
        title ??= archive.title;
        author ??= archive.author;
        files.push(...archive.files);
      } catch (err) {
        failed.push({ filename: upload.filename, message: (err as Error).message });
      }
    }

    // 2. Probe every file once – rejects non-stickers early and tells the UI how to render it.
    const probed = await mapLimit(files, 4, async (file) => {
      try {
        return { file, info: await this.media.probe(file.buffer) };
      } catch (err) {
        failed.push({ filename: file.filename, message: (err as Error).message });
        return null;
      }
    });
    const valid = probed.filter((p): p is NonNullable<typeof p> => p !== null);

    const session = appendTo ? this.session(appendTo) : null;
    if (session && session.pack.origin !== 'upload') throw new ValidationError('Files can only be added to an upload review');
    if (!session && valid.length === 0) {
      throw new ValidationError(failed[0]?.message ?? 'No stickers found in the uploaded files', { failed });
    }

    const target =
      session ??
      this.register(
        `upload:${randomBytes(8).toString('hex')}`,
        { source, origin: 'upload', title: title ?? '', author: author ?? '', stickers: [] },
        false,
      );
    if (!target.pack.title && title) target.pack.title = title;
    if (!target.pack.author && author) target.pack.author = author;

    const room = MAX_REMOTE_STICKERS - target.pack.stickers.length;
    for (const extra of valid.slice(Math.max(0, room))) {
      failed.push({ filename: extra.file.filename, message: `A review holds at most ${MAX_REMOTE_STICKERS} stickers` });
    }
    for (const { file, info } of valid.slice(0, Math.max(0, room))) {
      const index = target.pack.stickers.length;
      const buffer = file.buffer;
      target.pack.stickers.push({
        filename: file.filename,
        emojis: file.emojis ?? [],
        kind: KIND_BY_MEDIA[info.kind],
        download: () => Promise.resolve(buffer),
      });
      target.files.set(index, Promise.resolve(buffer));
      target.probes.set(index, Promise.resolve(info));
      target.bytes += buffer.length;
    }
    this.evict(target);
    return { session: target, failed };
  }

  private session(id: string): Session {
    const s = this.byId.get(id);
    if (!s || Date.now() - s.lastUsed > this.limits.ttlMs) {
      throw new AppError('This review has expired – please load the stickers again', 404, 'REVIEW_EXPIRED');
    }
    s.lastUsed = Date.now();
    return s;
  }

  /** Downloads (with caching) sticker `index` of a session. Failures are not cached so they can be retried. */
  private download(s: Session, index: number): Promise<Buffer> {
    const sticker = s.pack.stickers[index];
    if (!sticker) throw new ValidationError(`There is no sticker #${index + 1} in this pack`);
    let pending = s.files.get(index);
    if (!pending) {
      pending = sticker.download().then(
        (buf) => {
          s.bytes += buf.length;
          this.evict(s);
          return buf;
        },
        (err: unknown) => {
          s.files.delete(index);
          throw err;
        },
      );
      s.files.set(index, pending);
    }
    return pending;
  }

  private probe(s: Session, index: number): Promise<MediaInfo> {
    let pending = s.probes.get(index);
    if (!pending) {
      pending = this.download(s, index).then((buf) => this.media.probe(buf));
      pending.catch(() => s.probes.delete(index));
      s.probes.set(index, pending);
    }
    return pending;
  }

  /** The original file, for the browser to display (images via <img>, WebM via <video>, TGS via Lottie). */
  async file(id: string, index: number): Promise<{ buffer: Buffer; mime: string }> {
    const s = this.session(id);
    const buffer = await this.download(s, index);
    const info = await this.probe(s, index).catch(() => null);
    return { buffer, mime: info ? MIME_BY_SOURCE[info.format] : 'application/octet-stream' };
  }

  /**
   * The sticker converted for a target platform – lets the user check the result before
   * converting the whole pack. Cached per platform + options.
   */
  async render(id: string, index: number, spec: PlatformSpec, options: ProcessingOptions): Promise<ProcessedMedia> {
    const s = this.session(id);
    const key = `${index}|${spec.id}|${options.trim}|${options.padding}|${options.borderWidth}|${options.borderColor.toLowerCase()}`;
    let pending = s.renders.get(key);
    if (!pending) {
      pending = (async () => {
        const [buffer, info] = await Promise.all([this.download(s, index), this.probe(s, index)]);
        const result = await this.mediaQueue.run(() => this.media.processForPlatform(buffer, info, spec, options));
        s.bytes += result.buffer.length;
        this.evict(s);
        return result;
      })();
      pending.catch(() => s.renders.delete(key));
      s.renders.set(key, pending);
    }
    return pending;
  }

  /** Collects the selected stickers (default: all) of a session for import or conversion. */
  async collectById(id: string, indices?: number[], onEach?: (ok: boolean) => Promise<void>) {
    return this.collectFrom(this.session(id), indices, onEach);
  }

  /** Same as collectById, for a share link (used by the bot and the link-based API). */
  async collect(source: SourceId, input: string, indices?: number[], onEach?: (ok: boolean) => Promise<void>) {
    return this.collectFrom(await this.open(source, input), indices, onEach);
  }

  private async collectFrom(s: Session, indices?: number[], onEach?: (ok: boolean) => Promise<void>) {
    const wanted = this.normalizeIndices(s, indices);
    const failed: Array<{ filename: string; message: string }> = [];

    const results = await mapLimit(wanted, 4, async (index): Promise<CollectedFile | null> => {
      const sticker = s.pack.stickers[index]!;
      try {
        const buffer = await this.download(s, index);
        await onEach?.(true);
        return { index, buffer, filename: sticker.filename, emojis: sticker.emojis, telegram: sticker.telegram };
      } catch (err) {
        failed.push({ filename: sticker.filename, message: (err as Error).message });
        await onEach?.(false);
        return null;
      }
    });
    return { pack: s.pack, files: results.filter((r): r is CollectedFile => r !== null), failed };
  }

  /** Validates the user's selection: in range, no duplicates, kept in pack order. */
  normalizeIndices(s: { pack: PreviewPack }, indices?: number[]): number[] {
    const all = s.pack.stickers.map((_, i) => i);
    if (!indices) return all;
    const set = new Set(indices.filter((i) => Number.isInteger(i) && i >= 0 && i < all.length));
    if (set.size === 0) throw new ValidationError('No stickers selected');
    return all.filter((i) => set.has(i));
  }

  /** Looks up a session (throws 404 when expired). */
  get(id: string): Session {
    return this.session(id);
  }

  /** What the UI needs to show the review grid. */
  describe(s: Session) {
    const count = (k: StickerKind) => s.pack.stickers.filter((st) => st.kind === k).length;
    return {
      previewId: s.id,
      source: s.pack.source,
      origin: s.pack.origin,
      title: s.pack.title,
      author: s.pack.author,
      count: s.pack.stickers.length,
      animated: count('animated'),
      video: count('video'),
      lottie: count('lottie'),
      truncated: s.truncated,
      stickers: s.pack.stickers.map((st, index) => ({ index, emojis: st.emojis, kind: st.kind, filename: st.filename })),
    };
  }

  private remove(s: Session) {
    this.byId.delete(s.id);
    this.byKey.delete(s.key);
  }

  /** Drops expired sessions, then the least recently used ones until within limits. Never drops `keep`. */
  private evict(keep?: Session) {
    const now = Date.now();
    for (const s of this.byId.values()) if (s !== keep && now - s.lastUsed > this.limits.ttlMs) this.remove(s);

    const total = () => [...this.byId.values()].reduce((sum, s) => sum + s.bytes, 0);
    const oldestFirst = [...this.byId.values()].filter((s) => s !== keep).sort((a, b) => a.lastUsed - b.lastUsed);
    for (const s of oldestFirst) {
      if (this.byId.size <= this.limits.maxSessions && total() <= this.limits.maxBytes) break;
      this.remove(s);
    }
  }

  get stats() {
    return { sessions: this.byId.size, bytes: [...this.byId.values()].reduce((sum, s) => sum + s.bytes, 0) };
  }
}
