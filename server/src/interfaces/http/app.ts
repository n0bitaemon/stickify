import { existsSync } from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Container } from '../../container.js';
import { errorHandler, notFoundHandler } from './middlewares/error.js';
import { createApiRouter } from './routes.js';

export function createApp(c: Container): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind a reverse proxy (nginx) → rate-limit by the real client IP

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          // blob: for previews built with URL.createObjectURL (Lottie, downloads).
          'img-src': ["'self'", 'data:', 'blob:'],
          'media-src': ["'self'", 'blob:'],
        },
      },
    }),
  );

  // CORS is only needed when the frontend runs on another origin (e.g. Vite dev without the proxy).
  if (c.env.CORS_ORIGIN) {
    const origin = c.env.CORS_ORIGIN;
    app.use((req, res, next) => {
      if (req.headers.origin === origin) {
        res.set({
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Expose-Headers': 'Content-Disposition,X-Stickify-Warnings,X-Stickify-Bytes,X-Stickify-Format,X-Stickify-Size,X-Stickify-Failed,X-Stickify-Converted',
          Vary: 'Origin',
        });
      }
      if (req.method === 'OPTIONS') return res.status(204).end();
      next();
    });
  }

  app.use(pinoHttp({ logger: c.logger, autoLogging: { ignore: (req) => req.url?.startsWith('/api/health') ?? false } }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.use('/api', createApiRouter(c));
  app.use('/api', notFoundHandler);

  // Production: serve the built SPA; every non-/api route returns index.html.
  const webDist = c.env.WEB_DIST_DIR;
  if (existsSync(path.join(webDist, 'index.html'))) {
    app.use(express.static(webDist, { index: false, maxAge: '1h' }));
    app.get('/{*splat}', (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }

  app.use(errorHandler(c.logger));
  return app;
}
