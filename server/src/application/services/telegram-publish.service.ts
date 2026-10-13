import { randomBytes } from 'node:crypto';
import { ValidationError } from '../../domain/errors.js';
import type { OutputFormat } from '../../domain/media.js';
import { StickerPackModel, type StickerPackDocument } from '../../infrastructure/db/models/sticker-pack.model.js';
import { UserModel } from '../../infrastructure/db/models/user.model.js';
import type { InputStickerSpec, TelegramClient, TgStickerFormat } from '../../infrastructure/telegram/telegram.client.js';
import type { RenderedItem } from './export.service.js';

/** Telegram creates a set with at most 50 initial stickers. */
const INITIAL_BATCH = 50;

const FORMAT_MAP: Partial<Record<OutputFormat, TgStickerFormat>> = { webp: 'static', png: 'static', webm: 'video', tgs: 'animated' };

/**
 * Set name: only [a-z0-9_], starts with a letter, ends with "_by_<bot>", ≤ 64 characters.
 * A random suffix makes every push create a new set without clashing with existing names.
 */
export function buildStickerSetName(title: string, botUsername: string): string {
  const suffix = `_${randomBytes(3).toString('hex')}_by_${botUsername}`;
  let base = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!/^[a-z]/.test(base)) base = `s_${base}`;
  return (base.slice(0, Math.max(1, 64 - suffix.length)).replace(/_+$/, '') + suffix).replace(/__+/g, '_');
}

/** Pushes a converted pack to Telegram under the user's linked Telegram account. */
export class TelegramPublishService {
  constructor(private readonly telegram: TelegramClient) {}

  async publish(pack: StickerPackDocument, rendered: RenderedItem[]): Promise<string> {
    const user = await UserModel.findById(pack.owner);
    const tgUserId = user?.telegram?.userId;
    if (!tgUserId) throw new ValidationError('Link your Telegram account (on the Telegram page) before pushing a pack');

    const bot = await this.telegram.getMe();
    if (!bot.username) throw new ValidationError('The Telegram bot has no username');

    // Upload one by one: the Bot API rate-limits sticker operations quite strictly.
    const inputs: InputStickerSpec[] = [];
    for (const [i, r] of rendered.entries()) {
      const format = FORMAT_MAP[r.media.format];
      if (!format) continue;
      const file = await this.telegram.uploadStickerFile(tgUserId, r.media.buffer, `sticker${i + 1}.${r.media.ext}`, format);
      inputs.push({ fileId: file.file_id, format, emojis: r.item.emojis });
    }
    if (inputs.length === 0) throw new ValidationError('There are no valid stickers to push to Telegram');

    const name = buildStickerSetName(pack.title, bot.username);
    await this.telegram.createNewStickerSet(tgUserId, name, pack.title.slice(0, 64), inputs.slice(0, INITIAL_BATCH));
    for (const input of inputs.slice(INITIAL_BATCH)) {
      await this.telegram.addStickerToSet(tgUserId, name, input);
    }

    const url = `https://t.me/addstickers/${name}`;
    await StickerPackModel.updateOne({ _id: pack._id }, { $set: { telegramPublished: { setName: name, url, publishedAt: new Date() } } });
    return url;
  }
}
