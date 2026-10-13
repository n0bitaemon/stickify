import type { Request } from 'express';
import multer from 'multer';
import { MediaError } from '../../../domain/errors.js';

/** zip/wastickers: packaged sticker packs (e.g. WhatsApp) – unpacked in the service layer. */
const ALLOWED_EXT = /\.(png|jpe?g|webp|gif|svg|webm|mp4|mov|tgs|zip|wastickers)$/i;

/**
 * Uploads go to memory (no temp files): sticker files are small, and we need the buffer
 * to check magic bytes. Size and count limits stop memory-exhaustion attacks. The extension
 * filter is only an early check – the real format is verified from magic bytes later.
 */
export function createUpload(opts: { maxFileMb: number; maxFiles: number }) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: opts.maxFileMb * 1024 * 1024, files: opts.maxFiles, fields: 20, fieldSize: 1024 },
    fileFilter: (_req, file, cb) => {
      // Multer decodes file names as latin1 → convert back to UTF-8 to keep non-ASCII names.
      file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
      if (ALLOWED_EXT.test(file.originalname) || /^(image|video)\//.test(file.mimetype)) return cb(null, true);
      cb(new MediaError(`"${file.originalname}" is not a supported format`));
    },
  }).array('files', opts.maxFiles);
}

export function uploadedFiles(req: Request): Array<{ buffer: Buffer; filename: string }> {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  return files.map((f) => ({ buffer: f.buffer, filename: f.originalname }));
}
