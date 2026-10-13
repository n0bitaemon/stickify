import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { Container } from '../../container.js';
import { authController } from './controllers/auth.controller.js';
import { convertController } from './controllers/convert.controller.js';
import { exportsController } from './controllers/exports.controller.js';
import { importController } from './controllers/import.controller.js';
import { packsController } from './controllers/packs.controller.js';
import { stickersController } from './controllers/stickers.controller.js';
import { telegramController } from './controllers/telegram.controller.js';
import { authenticate } from './middlewares/auth.js';
import { createUpload } from './middlewares/upload.js';

/**
 * The whole REST API, mounted at /api. Express 5 forwards errors from async handlers to
 * the error middleware, so controllers need no try/catch.
 */
export function createApiRouter(c: Container): Router {
  const r = Router();
  const requireAuth = authenticate(c.auth);
  const upload = createUpload({ maxFileMb: c.env.MAX_UPLOAD_MB, maxFiles: c.env.MAX_FILES_PER_UPLOAD });
  const isTest = c.env.NODE_ENV === 'test';
  const limiter = (limit: number) =>
    rateLimit({ windowMs: 15 * 60 * 1000, limit: isTest ? 10_000 : limit, standardHeaders: 'draft-8', legacyHeaders: false });

  const auth = authController(c);
  const packs = packsController(c);
  const stickers = stickersController(c);
  const exportsCtl = exportsController(c);
  const convert = convertController(c);
  const telegram = telegramController(c);
  const importCtl = importController(c);

  // ── Public ───────────────────────────────────────────────────────────────
  r.get('/health', (_req, res) =>
    res.json({ status: 'ok', media: c.mediaQueue.stats, jobs: c.jobQueue.stats, previews: c.previews.stats, telegram: c.telegram.configured }),
  );
  r.get('/platforms', convert.platforms);
  r.get('/sources', importCtl.sources);
  r.post('/convert', limiter(40), upload, convert.convert);

  // ── Auth ─────────────────────────────────────────────────────────────────
  r.post('/auth/register', limiter(20), auth.register);
  r.post('/auth/login', limiter(30), auth.login);
  r.post('/auth/logout', auth.logout);
  r.get('/auth/me', requireAuth, auth.me);
  r.patch('/auth/me', requireAuth, auth.updateMe);

  // ── Sticker packs ────────────────────────────────────────────────────────
  r.get('/packs', requireAuth, packs.list);
  r.post('/packs', requireAuth, packs.create);
  r.get('/packs/:id', requireAuth, packs.get);
  r.patch('/packs/:id', requireAuth, packs.update);
  r.delete('/packs/:id', requireAuth, packs.remove);
  r.post('/packs/:id/stickers', requireAuth, upload, packs.uploadStickers);
  r.post('/packs/:id/stickers/from-preview', requireAuth, packs.addFromPreview);
  r.put('/packs/:id/order', requireAuth, packs.reorder);

  // ── Single stickers ──────────────────────────────────────────────────────
  r.patch('/stickers/:id', requireAuth, stickers.update);
  r.delete('/stickers/:id', requireAuth, stickers.remove);
  r.get('/stickers/:id/thumbnail', requireAuth, stickers.thumbnail);
  r.get('/stickers/:id/original', requireAuth, stickers.original);
  r.get('/stickers/:id/preview', requireAuth, stickers.preview);
  r.get('/stickers/:id/download', requireAuth, stickers.download);

  // ── Exports & conversion history ─────────────────────────────────────────
  r.post('/packs/:id/exports', requireAuth, limiter(120), exportsCtl.create);
  r.get('/exports', requireAuth, exportsCtl.list);
  r.get('/exports/:id', requireAuth, exportsCtl.get);
  r.get('/exports/:id/download', requireAuth, exportsCtl.download);

  // ── Telegram account ─────────────────────────────────────────────────────
  r.get('/telegram/status', requireAuth, telegram.status);
  r.post('/telegram/link-code', requireAuth, telegram.createLinkCode);
  r.delete('/telegram/link', requireAuth, telegram.unlink);

  // ── Import from source platforms (review sessions) ───────────────────────
  // Review sessions are public so Quick Convert works without an account.
  r.post('/import/inspect', limiter(60), importCtl.inspect);
  r.post('/import/upload-preview', limiter(120), upload, importCtl.uploadPreview);
  // A pack holds up to 200 stickers → one review is ~200 image requests.
  r.get('/import/previews/:id/stickers/:index', limiter(3000), importCtl.previewFile);
  // Rendering for a target platform is CPU-heavy → tighter limit.
  r.get('/import/previews/:id/stickers/:index/render', limiter(600), importCtl.renderPreview);
  r.post('/import/preview', requireAuth, limiter(60), importCtl.importPreview);
  r.post('/import/link', requireAuth, limiter(30), importCtl.importLink);

  return r;
}
