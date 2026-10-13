import type { ErrorRequestHandler, RequestHandler } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';
import type { Logger } from '../../../config/logger.js';
import { AppError } from '../../../domain/errors.js';

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No endpoint ${req.method} ${req.path}` } } satisfies ErrorBody);
};

/**
 * The single error-handling point. Expected errors → HTTP status + friendly message;
 * unexpected errors → 500 with a generic message, details only in the logs.
 */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    const send = (status: number, body: ErrorBody) => {
      if (res.headersSent) return res.end(); // mid-stream we can only cut the connection
      res.status(status).json(body);
    };

    if (err instanceof ZodError) {
      const details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
      return send(422, { error: { code: 'VALIDATION_ERROR', message: details[0]?.message ?? 'Invalid input', details } });
    }
    if (err instanceof AppError) {
      if (err.status >= 500) logger.error({ err, path: req.path }, err.message);
      return send(err.status, { error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err instanceof multer.MulterError) {
      const messages: Partial<Record<multer.ErrorCode, [number, string]>> = {
        LIMIT_FILE_SIZE: [413, 'File is too large'],
        LIMIT_FILE_COUNT: [413, 'Too many files in one upload'],
        LIMIT_UNEXPECTED_FILE: [400, 'The file field must be named "files"'],
      };
      const [status, message] = messages[err.code] ?? [400, err.message];
      return send(status, { error: { code: err.code, message } });
    }
    // JSON body parse errors from express.json()
    if ((err as { type?: string }).type === 'entity.parse.failed') {
      return send(400, { error: { code: 'BAD_JSON', message: 'Invalid JSON body' } });
    }
    if ((err as { type?: string }).type === 'entity.too.large') {
      return send(413, { error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' } });
    }

    logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');
    send(500, { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on the server' } });
  };
}
