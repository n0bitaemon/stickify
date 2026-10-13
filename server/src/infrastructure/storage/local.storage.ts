import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import type { StoragePort } from '../../application/ports/storage.port.js';
import { NotFoundError } from '../../domain/errors.js';

/** Valid keys: safe characters only, no "..", no leading "/". */
const SAFE_KEY = /^(?!.*\.\.)[a-zA-Z0-9][a-zA-Z0-9/_.-]*$/;

/**
 * Stores files on the local disk. Writes go to a temp file and are renamed into place
 * (atomic), so a crash never leaves a half-written file.
 */
export class LocalStorage implements StoragePort {
  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    if (!SAFE_KEY.test(key)) throw new Error(`Invalid storage key: ${key}`);
    const full = path.resolve(this.root, key);
    // Defence in depth: make sure the path cannot escape the root directory.
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error(`Storage key escapes the root: ${key}`);
    return full;
  }

  async put(key: string, data: Buffer | Readable): Promise<{ key: string; bytes: number }> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    const tmp = `${full}.${randomUUID()}.tmp`;
    try {
      if (Buffer.isBuffer(data)) await writeFile(tmp, data);
      else await pipeline(data, createWriteStream(tmp));
      await rename(tmp, full);
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
    const { size } = await stat(full);
    return { key, bytes: size };
  }

  async get(key: string): Promise<Buffer> {
    try {
      return await readFile(this.resolve(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new NotFoundError('File');
      throw err;
    }
  }

  createReadStream(key: string): Readable {
    return createReadStream(this.resolve(key));
  }

  async stat(key: string): Promise<{ bytes: number } | null> {
    try {
      const s = await stat(this.resolve(key));
      return { bytes: s.size };
    } catch {
      return null;
    }
  }

  async exists(key: string): Promise<boolean> {
    return (await this.stat(key)) !== null;
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  async deletePrefix(prefix: string): Promise<void> {
    await rm(this.resolve(prefix.replace(/\/+$/, '')), { recursive: true, force: true });
  }
}
