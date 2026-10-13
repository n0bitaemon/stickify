import type { LinkSourceId } from '../../domain/sources.js';

/** One sticker on a source platform – its content is only downloaded when needed. */
export interface RemoteSticker {
  filename: string;
  emojis: string[];
  /** Content type according to the source's metadata – lets the UI pick a renderer before downloading. */
  kind: 'static' | 'animated' | 'video' | 'lottie';
  download(): Promise<Buffer>;
  /** Telegram file identifiers (to refer back to the file if needed). */
  telegram?: { fileId: string; fileUniqueId: string };
}

export interface RemotePack {
  source: LinkSourceId;
  /** Public pack identifier (NEVER contains secrets such as Signal's pack_key). */
  externalId: string;
  url: string;
  title: string;
  author: string;
  stickers: RemoteSticker[];
  /** Counts shown before importing. */
  counts: { animated: number; video: number; lottie: number };
}

/**
 * Provider for one link-based source. Adding a platform = writing a new provider and
 * registering it in the container – no service or controller changes.
 */
export interface StickerSourceProvider {
  readonly id: LinkSourceId;
  /** Whether the provider can be used (e.g. Telegram needs a bot token). */
  available(): boolean;
  /**
   * Extracts the pack reference from user input. `strict` = only accept full URLs
   * (used when scanning bot messages for links); non-strict also accepts bare names.
   */
  parse(input: string, strict?: boolean): string | null;
  fetchPack(ref: string): Promise<RemotePack>;
}
