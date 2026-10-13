import https from 'node:https';
import { AppError, UpstreamError } from '../../domain/errors.js';

/** The minimal Telegram Bot API types Stickify uses. */
export interface TgUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

export interface TgSticker {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  is_animated: boolean; // .tgs (Lottie)
  is_video: boolean; // .webm
  emoji?: string;
  file_size?: number;
}

export interface TgStickerSet {
  name: string;
  title: string;
  sticker_type: 'regular' | 'mask' | 'custom_emoji';
  stickers: TgSticker[];
}

export interface TgFile {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
}

export interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: { id: number; type: string };
  text?: string;
  sticker?: TgSticker;
  photo?: Array<{ file_id: string; file_unique_id: string; width: number; height: number; file_size?: number }>;
  document?: { file_id: string; file_unique_id: string; file_name?: string; mime_type?: string; file_size?: number };
  animation?: { file_id: string; file_unique_id: string; file_name?: string; mime_type?: string; file_size?: number };
  video?: { file_id: string; file_unique_id: string; mime_type?: string; file_size?: number; duration: number };
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
}

export type TgStickerFormat = 'static' | 'animated' | 'video';

export interface InputStickerSpec {
  fileId: string;
  format: TgStickerFormat;
  emojis: string[];
}

interface TgResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
}

const API = 'https://api.telegram.org';
/** The Bot API only lets bots download files up to 20MB. */
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Thin wrapper around the Telegram Bot API using Node's built-in fetch.
 * The token only appears in request URLs – never in error messages or logs.
 */
export class TelegramClient {
  private me: TgUser | null = null;
  /** Dedicated connection for long polling, separate from fetch's pool (see getUpdates). */
  private readonly pollAgent = new https.Agent({ keepAlive: true, maxSockets: 1 });

  constructor(private readonly token?: string) {}

  get configured(): boolean {
    return Boolean(this.token);
  }

  private ensureToken(): string {
    if (!this.token) {
      throw new AppError('TELEGRAM_BOT_TOKEN is not configured on the server', 503, 'TELEGRAM_NOT_CONFIGURED');
    }
    return this.token;
  }

  /**
   * Calls a Bot API method. Waits and retries automatically when rate-limited (429 with retry_after).
   */
  async call<T>(method: string, params?: Record<string, unknown> | FormData, timeoutMs = 30_000): Promise<T> {
    const token = this.ensureToken();
    const isForm = params instanceof FormData;

    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await fetch(`${API}/bot${token}/${method}`, {
          method: 'POST',
          headers: isForm ? undefined : { 'content-type': 'application/json' },
          body: isForm ? params : JSON.stringify(params ?? {}),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        throw new UpstreamError(`Could not reach Telegram (${method})`, { reason: (err as Error).name });
      }

      const data = (await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }))) as TgResponse<T>;
      if (data.ok) return data.result as T;

      const retryAfter = data.parameters?.retry_after;
      if (data.error_code === 429 && retryAfter && attempt < 3) {
        await sleep((retryAfter + 1) * 1000);
        continue;
      }
      const status = data.error_code === 400 ? 422 : 502;
      throw new AppError(`Telegram: ${data.description ?? 'unknown error'}`, status, 'TELEGRAM_ERROR', { method });
    }
  }

  async getMe(): Promise<TgUser> {
    this.me ??= await this.call<TgUser>('getMe');
    return this.me;
  }

  getStickerSet(name: string): Promise<TgStickerSet> {
    return this.call<TgStickerSet>('getStickerSet', { name });
  }

  getFile(fileId: string): Promise<TgFile> {
    return this.call<TgFile>('getFile', { file_id: fileId });
  }

  /** Downloads a file by file_id (getFile → download from the /file endpoint). */
  async downloadFile(fileId: string): Promise<{ buffer: Buffer; filePath: string }> {
    const token = this.ensureToken();
    const file = await this.getFile(fileId);
    if (!file.file_path) throw new UpstreamError('Telegram did not return a file path');
    if ((file.file_size ?? 0) > MAX_DOWNLOAD_BYTES) throw new AppError('The file on Telegram is larger than 20MB', 413, 'FILE_TOO_LARGE');

    const res = await fetch(`${API}/file/bot${token}/${file.file_path}`, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new UpstreamError(`Downloading the file from Telegram failed (HTTP ${res.status})`);
    return { buffer: Buffer.from(await res.arrayBuffer()), filePath: file.file_path };
  }

  /**
   * Long polling for the bot. Deliberately NOT using `fetch`: fetch (undici) shares its
   * connection to api.telegram.org between requests, so a getUpdates call hanging for 30s
   * blocked the getFile/getStickerSet calls queued behind it (sticker previews timed out
   * after exactly 30s). A dedicated https.Agent means polling never shares a connection.
   */
  getUpdates(offset: number, timeoutSec = 30): Promise<TgUpdate[]> {
    const token = this.ensureToken();
    const query = new URLSearchParams({ offset: String(offset), timeout: String(timeoutSec), allowed_updates: '["message"]' });
    return new Promise((resolve, reject) => {
      const req = https.get(`${API}/bot${token}/getUpdates?${query}`, { agent: this.pollAgent, timeout: (timeoutSec + 10) * 1000 }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('error', reject);
        res.on('end', () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString('utf8')) as TgResponse<TgUpdate[]>;
            if (data.ok) resolve(data.result ?? []);
            else reject(new AppError(`Telegram: ${data.description ?? 'getUpdates failed'}`, 502, 'TELEGRAM_ERROR', { method: 'getUpdates' }));
          } catch {
            reject(new UpstreamError(`getUpdates returned invalid data (HTTP ${res.statusCode})`));
          }
        });
      });
      req.on('timeout', () => req.destroy(new UpstreamError('getUpdates timed out')));
      req.on('error', (err) => reject(err instanceof AppError ? err : new UpstreamError('Could not reach Telegram (getUpdates)', { reason: err.message })));
    });
  }

  sendMessage(chatId: number, text: string): Promise<unknown> {
    return this.call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
  }

  /** Uploads a sticker file to get a file_id for createNewStickerSet/addStickerToSet. */
  async uploadStickerFile(userId: number, file: Buffer, filename: string, format: TgStickerFormat): Promise<TgFile> {
    const form = new FormData();
    form.set('user_id', String(userId));
    form.set('sticker_format', format);
    form.set('sticker', new Blob([new Uint8Array(file)]), filename);
    return this.call<TgFile>('uploadStickerFile', form, 60_000);
  }

  private toInputSticker(s: InputStickerSpec) {
    return { sticker: s.fileId, format: s.format, emoji_list: s.emojis.slice(0, 20) };
  }

  /** Creates a new sticker set (up to 50 initial stickers; the rest go through addStickerToSet). */
  createNewStickerSet(userId: number, name: string, title: string, stickers: InputStickerSpec[]): Promise<boolean> {
    return this.call<boolean>('createNewStickerSet', {
      user_id: userId,
      name,
      title,
      sticker_type: 'regular',
      stickers: stickers.map((s) => this.toInputSticker(s)),
    });
  }

  addStickerToSet(userId: number, name: string, sticker: InputStickerSpec): Promise<boolean> {
    return this.call<boolean>('addStickerToSet', { user_id: userId, name, sticker: this.toInputSticker(sticker) });
  }
}

/**
 * Extracts the sticker set name from a link or a bare name:
 *   https://t.me/addstickers/Animals  |  t.me/addemoji/Foo  |  tg://addstickers?set=Foo  |  Animals
 */
export function parseStickerSetName(input: string): string | null {
  const s = input.trim();
  const m =
    /^(?:https?:\/\/)?(?:www\.)?(?:t|telegram)\.me\/add(?:stickers|emoji)\/([A-Za-z0-9_]{1,64})\/?(?:[?#].*)?$/i.exec(s) ??
    /^tg:\/\/add(?:stickers|emoji)\?set=([A-Za-z0-9_]{1,64})$/i.exec(s) ??
    /^([A-Za-z][A-Za-z0-9_]{0,63})$/.exec(s);
  return m?.[1] ?? null;
}
