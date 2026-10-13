import https from 'node:https';
import { AppError, NotFoundError, UpstreamError } from '../../domain/errors.js';

export interface HttpsGetOptions {
  /** Custom CA (PEM) for servers with self-signed certificates such as cdn.signal.org. */
  ca?: string;
  timeoutMs?: number;
  maxBytes?: number;
}

/**
 * HTTPS GET with time and size limits. Uses node:https rather than fetch because fetch
 * cannot take a custom CA. Redirects are not followed – only known hosts are called.
 */
export function httpsGet(url: string, { ca, timeoutMs = 20_000, maxBytes = 20 * 1024 * 1024 }: HttpsGetOptions = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { ca, timeout: timeoutMs }, (res) => {
      const status = res.statusCode ?? 0;
      if (status === 404 || status === 403) {
        res.resume();
        return reject(new NotFoundError('Sticker pack'));
      }
      if (status !== 200) {
        res.resume();
        return reject(new UpstreamError(`The source server returned HTTP ${status}`));
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (c: Buffer) => {
        size += c.length;
        if (size > maxBytes) {
          req.destroy();
          reject(new AppError('The file from the source is too large', 413, 'FILE_TOO_LARGE'));
          return;
        }
        chunks.push(c);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new UpstreamError('The source server did not respond')));
    req.on('error', (err) => reject(err instanceof AppError ? err : new UpstreamError('Could not reach the source server', { reason: err.message })));
  });
}
