import type { Request, Response } from 'express';
import type { Container } from '../../../container.js';
import { currentUser } from '../middlewares/auth.js';
import { uploadedFiles } from '../middlewares/upload.js';
import { AddFromPreviewBody, CreatePackBody, ReorderBody, UpdatePackBody } from '../schemas.js';

const id = (req: Request) => String(req.params.id);

export function packsController(c: Container) {
  return {
    async list(req: Request, res: Response) {
      res.json({ packs: await c.packs.list(currentUser(req)) });
    },

    async create(req: Request, res: Response) {
      res.status(201).json({ pack: await c.packs.create(currentUser(req), CreatePackBody.parse(req.body)) });
    },

    async get(req: Request, res: Response) {
      const { pack, items } = await c.packs.getWithItems(currentUser(req), id(req));
      res.json({ pack, items });
    },

    async update(req: Request, res: Response) {
      res.json({ pack: await c.packs.update(currentUser(req), id(req), UpdatePackBody.parse(req.body)) });
    },

    async remove(req: Request, res: Response) {
      await c.packs.delete(currentUser(req), id(req));
      res.status(204).end();
    },

    /**
     * POST /api/packs/:id/stickers (multipart, field "files") – direct upload for API clients.
     * 201 when at least one file succeeded; `failed` lists rejected files and why.
     */
    async uploadStickers(req: Request, res: Response) {
      const result = await c.packs.addStickers(currentUser(req), id(req), uploadedFiles(req));
      res.status(result.items.length ? 201 : 422).json(result);
    },

    /** POST /api/packs/:id/stickers/from-preview – adds the selected stickers of a review session. */
    async addFromPreview(req: Request, res: Response) {
      const { previewId, indices } = AddFromPreviewBody.parse(req.body);
      const result = await c.importer.addFromPreview(currentUser(req), id(req), previewId, indices);
      res.status(result.items.length ? 201 : 422).json(result);
    },

    async reorder(req: Request, res: Response) {
      await c.packs.reorder(currentUser(req), id(req), ReorderBody.parse(req.body).ids);
      res.status(204).end();
    },
  };
}
