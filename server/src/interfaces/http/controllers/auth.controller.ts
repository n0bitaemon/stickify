import type { CookieOptions, Request, Response } from 'express';
import type { Container } from '../../../container.js';
import { AUTH_COOKIE, currentUser } from '../middlewares/auth.js';
import { LoginBody, RegisterBody, UpdateProfileBody } from '../schemas.js';

/** "7d" | "12h" | "30m" → ms; used as the cookie maxAge so it matches the JWT expiry. */
function durationToMs(value: string): number {
  const m = /^(\d+)\s*([smhd])$/.exec(value.trim());
  if (!m) return 7 * 24 * 3600 * 1000;
  const unit = { s: 1e3, m: 6e4, h: 36e5, d: 864e5 }[m[2] as 's' | 'm' | 'h' | 'd'];
  return Number(m[1]) * unit;
}

export function authController(c: Container) {
  const cookieOptions: CookieOptions = {
    httpOnly: true,
    sameSite: 'lax',
    secure: c.env.NODE_ENV === 'production',
    path: '/',
  };
  const setSession = (res: Response, token: string) =>
    res.cookie(AUTH_COOKIE, token, { ...cookieOptions, maxAge: durationToMs(c.env.JWT_EXPIRES_IN) });

  return {
    async register(req: Request, res: Response) {
      const { user, token } = await c.auth.register(RegisterBody.parse(req.body));
      setSession(res, token);
      res.status(201).json({ user, token });
    },

    async login(req: Request, res: Response) {
      const { user, token } = await c.auth.login(LoginBody.parse(req.body));
      setSession(res, token);
      res.json({ user, token });
    },

    logout(_req: Request, res: Response) {
      res.clearCookie(AUTH_COOKIE, cookieOptions).status(204).end();
    },

    async me(req: Request, res: Response) {
      res.json({ user: await c.auth.getUser(currentUser(req)) });
    },

    async updateMe(req: Request, res: Response) {
      res.json({ user: await c.auth.updateProfile(currentUser(req), UpdateProfileBody.parse(req.body)) });
    },
  };
}
