import type { Request, Response } from 'express';
import type { Container } from '../../../container.js';
import { getPlatformSpec } from '../../../domain/platforms.js';
import { currentUser } from '../middlewares/auth.js';
import { PreviewQuery, UpdateStickerBody } from '../schemas.js';
import { encodeHeaderJson, mergeOptions, SANDBOX_HEADERS, sendStream } from './helpers.js';

const id = (req: Request) => String(req.params.id);

export function stickersController(c: Container) {
  /** Rendition for a platform + options (priority: query > the pack's options > defaults). */
  async function renderFor(req: Request) {
    const userId = currentUser(req);
    const { platform, ...overrides } = PreviewQuery.parse(req.query);
    const item = await c.packs.getOwnedItem(userId, id(req));
    const pack = await c.packs.getOwned(userId, item.pack.toString());
    const options = mergeOptions(pack.toObject().processing, overrides);
    const media = await c.renditions.render(item, getPlatformSpec(platform), options);
    return { item, media, platform };
  }

  return {
    async update(req: Request, res: Response) {
      res.json({ item: await c.packs.updateSticker(currentUser(req), id(req), UpdateStickerBody.parse(req.body)) });
    },

    async remove(req: Request, res: Response) {
      await c.packs.deleteSticker(currentUser(req), id(req));
      res.status(204).end();
    },

    async thumbnail(req: Request, res: Response) {
      const file = await c.packs.openFile(currentUser(req), id(req), 'thumbnail');
      res.type(file.mime).set('Cache-Control', 'private, max-age=86400');
      await sendStream(res, file.stream);
    },

    /** The uploaded original – sandboxed, since it may be a user-supplied SVG. */
    async original(req: Request, res: Response) {
      const file = await c.packs.openFile(currentUser(req), id(req), 'original');
      res.type(file.mime).set({ 'Cache-Control': 'private, max-age=86400', ...SANDBOX_HEADERS });
      await sendStream(res, file.stream);
    },

    /** Live preview: the converted file, with metadata in headers for the UI. */
    async preview(req: Request, res: Response) {
      const { media } = await renderFor(req);
      res
        .type(media.mime)
        .set({
          'Cache-Control': 'private, max-age=300',
          'X-Stickify-Format': media.format,
          'X-Stickify-Bytes': String(media.buffer.length),
          'X-Stickify-Size': `${media.width}x${media.height}`,
          'X-Stickify-Warnings': encodeHeaderJson(media.warnings),
        })
        .send(media.buffer);
    },

    /** Downloads one converted sticker. */
    async download(req: Request, res: Response) {
      const { item, media, platform } = await renderFor(req);
      res.attachment(`sticker-${item.position + 1}-${platform}.${media.ext}`).type(media.mime).send(media.buffer);
    },
  };
}
