import type { RemotePack, StickerSourceProvider } from '../../application/ports/sticker-source.port.js';
import { AppError, NotFoundError } from '../../domain/errors.js';
import { parseStickerSetName, type TelegramClient } from '../telegram/telegram.client.js';

/** Telegram source: t.me/addstickers/<name> link → Bot API getStickerSet + getFile. */
export class TelegramSource implements StickerSourceProvider {
  readonly id = 'telegram' as const;

  constructor(private readonly client: TelegramClient) {}

  available(): boolean {
    return this.client.configured;
  }

  parse(input: string, strict = false): string | null {
    const name = parseStickerSetName(input);
    if (strict && name && !/(?:t|telegram)\.me\/|tg:\/\//i.test(input)) return null;
    return name;
  }

  async fetchPack(name: string): Promise<RemotePack> {
    let set;
    try {
      set = await this.client.getStickerSet(name);
    } catch (err) {
      // Telegram answers 400 STICKERSET_INVALID when the pack does not exist.
      if (err instanceof AppError && err.code === 'TELEGRAM_ERROR' && err.status === 422) throw new NotFoundError('Telegram sticker pack');
      throw err;
    }

    return {
      source: 'telegram',
      externalId: set.name,
      url: `https://t.me/addstickers/${set.name}`,
      title: set.title,
      author: 'Telegram',
      counts: {
        animated: 0,
        video: set.stickers.filter((s) => s.is_video).length,
        lottie: set.stickers.filter((s) => s.is_animated).length,
      },
      stickers: set.stickers.map((s, i) => ({
        filename: `${i + 1}.${s.is_animated ? 'tgs' : s.is_video ? 'webm' : 'webp'}`,
        emojis: s.emoji ? [s.emoji] : [],
        kind: s.is_animated ? 'lottie' : s.is_video ? 'video' : 'static',
        telegram: { fileId: s.file_id, fileUniqueId: s.file_unique_id },
        download: async () => (await this.client.downloadFile(s.file_id)).buffer,
      })),
    };
  }
}
