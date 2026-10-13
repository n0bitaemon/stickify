import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/domain/errors.js';
import { TelegramClient } from '../src/infrastructure/telegram/telegram.client.js';

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('TelegramClient', () => {
  it('gives a clear error when no token is configured', async () => {
    await expect(new TelegramClient().getMe()).rejects.toMatchObject({ code: 'TELEGRAM_NOT_CONFIGURED', status: 503 });
  });

  it('maps Telegram 400 errors to AppError 422 without leaking the token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ ok: false, error_code: 400, description: 'Bad Request: STICKERSET_INVALID' })));
    const err = await new TelegramClient('123:SECRET').getStickerSet('nope').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ status: 422, code: 'TELEGRAM_ERROR' });
    expect((err as Error).message).not.toContain('SECRET');
  });

  it('retries automatically on a 429 rate limit', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 1 } }))
      .mockResolvedValueOnce(json({ ok: true, result: { id: 1, is_bot: true, first_name: 'Bot', username: 'StickifyBot' } }));
    vi.stubGlobal('fetch', fetchMock);

    const promise = new TelegramClient('123:SECRET').getMe();
    await vi.advanceTimersByTimeAsync(2500);
    await expect(promise).resolves.toMatchObject({ username: 'StickifyBot' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('downloads files via getFile → /file/bot<token>/<path>', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.includes('/getFile')
        ? json({ ok: true, result: { file_id: 'F', file_unique_id: 'U', file_path: 'stickers/a.webp', file_size: 3 } })
        : new Response(new Uint8Array([1, 2, 3])),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { buffer, filePath } = await new TelegramClient('123:SECRET').downloadFile('F');
    expect([...buffer]).toEqual([1, 2, 3]);
    expect(filePath).toBe('stickers/a.webp');
    expect(fetchMock.mock.calls[1]![0]).toBe('https://api.telegram.org/file/bot123:SECRET/stickers/a.webp');
  });
});
