import type { Request, Response } from 'express';
import type { Container } from '../../../container.js';
import { ValidationError } from '../../../domain/errors.js';
import { PLATFORM_SPECS } from '../../../domain/platforms.js';
import { SOURCE_SPECS } from '../../../domain/sources.js';
import { uploadedFiles } from '../middlewares/upload.js';
import { ConvertFields } from '../schemas.js';
import { encodeHeaderJson, mergeOptions, sendStream } from './helpers.js';

export function convertController(c: Container) {
  return {
    /**
     * POST /api/convert (multipart) → ZIP download.
     * Stickers come from a reviewed pack (previewId), a share link, or uploaded files.
     * Flow: get stickers from the source → detect formats → normalise for the target → ZIP.
     */
    async convert(req: Request, res: Response) {
      const { platform, source, previewId, link, title, indices, ...overrides } = ConvertFields.parse(req.body);
      const options = mergeOptions(overrides);

      let result;
      if (previewId) {
        result = await c.convert.convertFromPreview(previewId, platform, options, title, indices);
      } else if (SOURCE_SPECS[source].input === 'link') {
        if (!link) throw new ValidationError(`Enter a ${SOURCE_SPECS[source].label} sticker pack link`);
        result = await c.convert.convertFromLink(source, link, platform, options, title, indices);
      } else {
        result = await c.convert.convertToZip(uploadedFiles(req), platform, options, title || 'Stickify pack');
      }

      res
        .attachment(result.filename)
        .type('application/zip')
        .set({
          'X-Stickify-Converted': String(result.converted),
          'X-Stickify-Failed': encodeHeaderJson(result.failed),
        });
      await sendStream(res, result.zip);
    },

    platforms(_req: Request, res: Response) {
      res.set('Cache-Control', 'public, max-age=3600').json({ platforms: Object.values(PLATFORM_SPECS) });
    },
  };
}
