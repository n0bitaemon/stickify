import type { Readable } from 'node:stream';

/**
 * Port for binary file storage (originals, thumbnails, renditions, ZIP files).
 * The default implementation writes to the local disk; it can be swapped for S3/R2/GCS
 * without touching the application layer.
 *
 * `key` is a logical path such as "packs/<packId>/items/<id>/original.png" – it never
 * comes from the client.
 */
export interface StoragePort {
  put(key: string, data: Buffer | Readable): Promise<{ key: string; bytes: number }>;
  get(key: string): Promise<Buffer>;
  createReadStream(key: string): Readable;
  stat(key: string): Promise<{ bytes: number } | null>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  /** Deletes every key under a prefix (e.g. when a whole pack is deleted). */
  deletePrefix(prefix: string): Promise<void>;
}
