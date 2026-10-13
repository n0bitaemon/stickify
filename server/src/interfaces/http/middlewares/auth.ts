import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AuthService } from '../../../application/services/auth.service.js';
import { UnauthorizedError } from '../../../domain/errors.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export const AUTH_COOKIE = 'stk_token';

/**
 * Reads the JWT from the httpOnly cookie (browsers) or the Authorization: Bearer header
 * (API/CLI clients). JavaScript cannot read an httpOnly cookie → the token cannot be
 * stolen through XSS.
 */
export function authenticate(auth: AuthService): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    const token = (req.cookies as Record<string, string> | undefined)?.[AUTH_COOKIE] ?? (header?.startsWith('Bearer ') ? header.slice(7) : undefined);
    if (!token) return next(new UnauthorizedError());
    req.userId = auth.verify(token);
    next();
  };
}

/** The authenticated user id inside a controller (the route has been through `authenticate`). */
export function currentUser(req: Request): string {
  if (!req.userId) throw new UnauthorizedError();
  return req.userId;
}
