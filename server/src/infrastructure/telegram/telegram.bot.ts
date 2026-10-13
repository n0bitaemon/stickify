import type { ImportService } from '../../application/services/import.service.js';
import type { PackService } from '../../application/services/pack.service.js';
import type { SourceRegistry } from '../../application/services/source-registry.js';
import type { StickerIngestService } from '../../application/services/sticker-ingest.service.js';
import type { TelegramAccountService } from '../../application/services/telegram-account.service.js';
import type { Logger } from '../../config/logger.js';
import { AppError } from '../../domain/errors.js';
import type { TelegramClient, TgMessage } from './telegram.client.js';

const HELP = [
  '<b>Stickify Bot</b> 🎨',
  '',
  '• Send a <b>sticker</b>, <b>photo</b>, <b>GIF</b> or a PNG/WebP/WebM file → it goes into your <i>Telegram Inbox</i> pack.',
  '• Send a <code>t.me/addstickers/...</code> or <code>signal.art/addstickers/...</code> link → the whole pack is imported.',
  '• To link your account, click "Link with Telegram" on the Stickify Telegram page.',
].join('\n');

const escapeHtml = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

/**
 * Telegram bot using long polling (no public domain/HTTPS needed, unlike webhooks).
 * Each update is handled independently; one failing update never stops the loop.
 */
export class TelegramBot {
  private running = false;
  private offset = 0;
  private loop: Promise<void> | null = null;

  constructor(
    private readonly client: TelegramClient,
    private readonly accounts: TelegramAccountService,
    private readonly packs: PackService,
    private readonly ingest: StickerIngestService,
    private readonly importer: ImportService,
    private readonly sources: SourceRegistry,
    private readonly logger: Logger,
  ) {}

  async start(): Promise<void> {
    const me = await this.client.getMe();
    this.running = true;
    this.logger.info({ bot: me.username }, 'Telegram bot running (long polling)');
    this.loop = this.poll();
  }

  async stop(): Promise<void> {
    this.running = false;
    // Do not wait for a hanging getUpdates call (up to 30s) – the process is about to exit.
    await Promise.race([this.loop, new Promise((r) => setTimeout(r, 1000))]);
  }

  private async poll(): Promise<void> {
    let backoff = 1000;
    while (this.running) {
      try {
        const updates = await this.client.getUpdates(this.offset, 30);
        backoff = 1000;
        for (const u of updates) {
          this.offset = u.update_id + 1;
          if (u.message) void this.handle(u.message);
        }
      } catch (err) {
        if (!this.running) break;
        this.logger.warn({ err: (err as Error).message }, 'getUpdates failed, retrying');
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, 30_000);
      }
    }
  }

  private reply(msg: TgMessage, text: string) {
    return this.client.sendMessage(msg.chat.id, text).catch((err) => this.logger.warn({ err }, 'sendMessage failed'));
  }

  private async handle(msg: TgMessage): Promise<void> {
    if (msg.chat.type !== 'private' || !msg.from) return; // private chats only
    try {
      const text = msg.text?.trim() ?? '';
      if (text.startsWith('/start') || text.startsWith('/link')) return await this.onStart(msg, text.split(/\s+/)[1]);
      if (text.startsWith('/help')) return void (await this.reply(msg, HELP));

      const user = await this.accounts.findByTelegramId(msg.from.id);
      if (!user) {
        return void (await this.reply(msg, 'Your account is not linked yet. Open Stickify → <b>Telegram</b> → <b>Link with Telegram</b>.'));
      }

      // A share link from any source (Telegram, Signal...) → import the whole pack.
      const link = this.sources.detect(text);
      if (link) return await this.onImportLink(msg, user.id, link);

      const file = this.extractFile(msg);
      if (file) return await this.onFile(msg, user.id, file);

      await this.reply(msg, HELP);
    } catch (err) {
      const message = err instanceof AppError ? err.message : 'Something went wrong, please try again.';
      if (!(err instanceof AppError)) this.logger.error({ err }, 'Failed to handle a bot message');
      await this.reply(msg, `⚠️ ${escapeHtml(message)}`);
    }
  }

  private async onStart(msg: TgMessage, code?: string) {
    if (!code) return void (await this.reply(msg, HELP));
    const user = await this.accounts.linkByCode(code, msg.from!);
    await this.reply(msg, `✅ Linked to <b>${escapeHtml(user.displayName)}</b>. Send me a sticker to get started!`);
  }

  private async onImportLink(msg: TgMessage, userId: string, link: NonNullable<ReturnType<SourceRegistry['detect']>>) {
    const pack = await this.importer.importFromLink(userId, link.source, link.input);
    await this.reply(msg, `⏳ Importing <b>${escapeHtml(pack.title)}</b> (${pack.importState?.total} stickers). Open Stickify to see it.`);
  }

  private extractFile(msg: TgMessage) {
    if (msg.sticker) {
      const s = msg.sticker;
      return { fileId: s.file_id, uniqueId: s.file_unique_id, emoji: s.emoji, name: 'sticker' };
    }
    // Compressed photos: take the largest size (last entry).
    const photo = msg.photo?.at(-1);
    if (photo) return { fileId: photo.file_id, uniqueId: photo.file_unique_id, name: 'photo.jpg' };
    // Telegram turns GIFs into MP4 "animations".
    const doc = msg.animation ?? msg.document ?? msg.video;
    if (doc) return { fileId: doc.file_id, uniqueId: doc.file_unique_id, name: ('file_name' in doc && doc.file_name) || 'file' };
    return null;
  }

  private async onFile(msg: TgMessage, userId: string, file: NonNullable<ReturnType<TelegramBot['extractFile']>>) {
    const pack = await this.packs.getOrCreateInbox(userId);
    const { buffer } = await this.client.downloadFile(file.fileId);
    const result = await this.ingest.ingestMany(pack, [
      {
        buffer,
        filename: file.name,
        emojis: file.emoji ? [file.emoji] : undefined,
        telegram: { fileId: file.fileId, fileUniqueId: file.uniqueId },
      },
    ]);
    if (result.failed.length) return void (await this.reply(msg, `⚠️ ${escapeHtml(result.failed[0]!.message)}`));
    await this.reply(msg, `✅ Added to <b>${escapeHtml(pack.title)}</b>.`);
  }
}
