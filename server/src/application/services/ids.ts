import { Types } from 'mongoose';
import { NotFoundError } from '../../domain/errors.js';

/** Converts a URL id to an ObjectId; a malformed id means "not found" (404), not a 500. */
export function toObjectId(id: string, what = 'Resource'): Types.ObjectId {
  if (!Types.ObjectId.isValid(id)) throw new NotFoundError(what);
  return new Types.ObjectId(id);
}

/** Safe file/folder name for ZIP entries (accents are stripped, e.g. "Gói Đẹp" → "goi-dep"). */
export function slugify(input: string, fallback = 'stickers'): string {
  const s = input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd') // Vietnamese "đ" has no decomposed form
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return s || fallback;
}
