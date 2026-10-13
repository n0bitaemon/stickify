import type { Response } from 'express';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DEFAULT_PROCESSING_OPTIONS, type ProcessingOptions } from '../../../domain/media.js';

/**
 * Merges processing options in increasing priority, skipping undefined values
 * (a plain spread would overwrite with undefined).
 */
export function mergeOptions(...parts: Array<Partial<ProcessingOptions> | null | undefined>): ProcessingOptions {
  const out: ProcessingOptions = { ...DEFAULT_PROCESSING_OPTIONS };
  for (const part of parts) {
    if (!part) continue;
    for (const [k, v] of Object.entries(part)) {
      if (v !== undefined && v !== null && k in out) (out as unknown as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}

/**
 * Headers for serving user-supplied files (originals, review previews). An uploaded SVG
 * opened directly in the browser would run its scripts on our origin; the sandbox CSP
 * stops that. <img> tags are unaffected.
 */
export const SANDBOX_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; media-src 'self'; sandbox",
  'Content-Disposition': 'inline',
};

/** Streams a file to the response; a client aborting the download is not a server error. */
export async function sendStream(res: Response, stream: Readable): Promise<void> {
  try {
    await pipeline(stream, res);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ERR_STREAM_PREMATURE_CLOSE') return;
    throw err;
  }
}

/** Headers must be ASCII → JSON warnings (which may contain non-ASCII text) are URI-encoded. */
export const encodeHeaderJson = (value: unknown): string => encodeURIComponent(JSON.stringify(value));
