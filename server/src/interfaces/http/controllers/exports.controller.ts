import type { Request, Response } from 'express';
import type { Container } from '../../../container.js';
import { currentUser } from '../middlewares/auth.js';
import { CreateExportBody, HistoryQuery } from '../schemas.js';
import { sendStream } from './helpers.js';

const id = (req: Request) => String(req.params.id);

export function exportsController(c: Container) {
  return {
    /** POST /api/packs/:id/exports → 202 Accepted + job; client poll GET /api/exports/:jobId. */
    async create(req: Request, res: Response) {
      const job = await c.exports.create(currentUser(req), id(req), CreateExportBody.parse(req.body));
      res.status(202).location(`/api/exports/${job.id}`).json({ job });
    },

    async list(req: Request, res: Response) {
      const { packId } = HistoryQuery.parse(req.query);
      res.json({ jobs: await c.exports.history(currentUser(req), packId) });
    },

    async get(req: Request, res: Response) {
      res.json({ job: await c.exports.get(currentUser(req), id(req)) });
    },

    async download(req: Request, res: Response) {
      const file = await c.exports.openDownload(currentUser(req), id(req));
      res.attachment(file.filename).type('application/zip').set('Content-Length', String(file.bytes));
      await sendStream(res, file.stream);
    },
  };
}
