import type { Request, Response } from 'express';
import type { Container } from '../../../container.js';
import { getPlatformSpec } from '../../../domain/platforms.js';
import { currentUser } from '../middlewares/auth.js';
import { uploadedFiles } from '../middlewares/upload.js';
import { ImportLinkBody, ImportPreviewBody, InspectBody, PreviewFileParams, RenderQuery, UploadPreviewFields } from '../schemas.js';
import { encodeHeaderJson, mergeOptions, SANDBOX_HEADERS } from './helpers.js';

/** Bringing stickers in from source platforms, always through a review session. */
export function importController(c: Container) {
  return {
    /** GET /api/sources – source platforms and the kind of input each one takes. */
    sources(_req: Request, res: Response) {
      res.json({ sources: c.sources.list() });
    },

    /** POST /api/import/inspect – loads a pack from a share link for review. */
    async inspect(req: Request, res: Response) {
      const { source, link } = InspectBody.parse(req.body);
      res.json(await c.importer.inspect(source, link));
    },

    /**
     * POST /api/import/upload-preview (multipart "files", optional source/previewId) –
     * loads uploaded files (archives unpacked) for review. Rejected files come back in `failed`.
     */
    async uploadPreview(req: Request, res: Response) {
      const { source, previewId } = UploadPreviewFields.parse(req.body);
      res.status(201).json(await c.importer.previewUpload(source, uploadedFiles(req), previewId));
    },

    /** GET /api/import/previews/:id/stickers/:index – the original file, for display. */
    async previewFile(req: Request, res: Response) {
      const { id, index } = PreviewFileParams.parse(req.params);
      const file = await c.previews.file(id, index);
      res
        .type(file.mime)
        .set({ 'Cache-Control': 'private, max-age=900', ...SANDBOX_HEADERS })
        .send(file.buffer);
    },

    /** GET /api/import/previews/:id/stickers/:index/render?platform=… – the sticker as it will look on the target. */
    async renderPreview(req: Request, res: Response) {
      const { id, index } = PreviewFileParams.parse(req.params);
      const { platform, ...overrides } = RenderQuery.parse(req.query);
      const media = await c.previews.render(id, index, getPlatformSpec(platform), mergeOptions(overrides));
      res
        .type(media.mime)
        .set({
          'Cache-Control': 'private, max-age=900',
          'X-Stickify-Format': media.format,
          'X-Stickify-Bytes': String(media.buffer.length),
          'X-Stickify-Size': `${media.width}x${media.height}`,
          'X-Stickify-Warnings': encodeHeaderJson(media.warnings),
        })
        .send(media.buffer);
    },

    /** POST /api/import/preview → 202: creates a pack from a review (selected stickers only); poll GET /api/packs/:id. */
    async importPreview(req: Request, res: Response) {
      const { previewId, indices, title } = ImportPreviewBody.parse(req.body);
      res.status(202).json({ pack: await c.importer.importFromPreview(currentUser(req), previewId, indices, title) });
    },

    /** POST /api/import/link → 202: imports straight from a link without a review step (API clients). */
    async importLink(req: Request, res: Response) {
      const { source, link, indices } = ImportLinkBody.parse(req.body);
      res.status(202).json({ pack: await c.importer.importFromLink(currentUser(req), source, link, indices) });
    },
  };
}
