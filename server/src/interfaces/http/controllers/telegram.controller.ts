import type { Request, Response } from 'express';
import type { Container } from '../../../container.js';
import { currentUser } from '../middlewares/auth.js';

/** Telegram account linking (lets the bot receive stickers and packs be pushed to Telegram). */
export function telegramController(c: Container) {
  return {
    async status(req: Request, res: Response) {
      res.json(await c.accounts.status(currentUser(req)));
    },

    async createLinkCode(req: Request, res: Response) {
      res.status(201).json(await c.accounts.createLinkCode(currentUser(req)));
    },

    async unlink(req: Request, res: Response) {
      await c.accounts.unlink(currentUser(req));
      res.status(204).end();
    },
  };
}
