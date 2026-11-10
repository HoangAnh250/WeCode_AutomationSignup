import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { RequestHandler, ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError, safeError } from '../core/errors.js';
import type { Logger } from '../infrastructure/logger.js';
export function authenticate(token: string): RequestHandler {
  const expected = Buffer.from(token);
  return (req, res, next) => {
    if (req.headers.origin) {
      res.status(403).json({
        error: {
          code: 'ORIGIN_FORBIDDEN',
          message: 'Browser-origin requests are not accepted by the desktop service.',
        },
      });
      return;
    }
    const supplied = Buffer.from(req.headers.authorization?.replace(/^Bearer /, '') ?? '');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'A valid desktop service token is required.' },
      });
      return;
    }
    next();
  };
}
export function requestLog(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const id = randomUUID();
    res.locals.requestId = id;
    res.setHeader('X-Request-ID', id);
    const start = Date.now();
    res.on('finish', () =>
      logger.info(
        {
          requestId: id,
          method: req.method,
          status: res.statusCode,
          durationMs: Date.now() - start,
        },
        'HTTP request completed.',
      ),
    );
    next();
  };
}
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error, req, res, _next) => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    const requestId = res.locals.requestId as string;
    let status = 500;
    let details: { code: string; message: string; fields?: string[] } = { ...safeError(error) };
    if (error instanceof ZodError) {
      status = 422;
      details = {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed.',
        fields: [...new Set(error.issues.map((i) => i.path.join('.')))],
      };
    } else if (error instanceof AppError) {
      status = error.status;
    } else if ((error as { code?: string })?.code === 'P2002') {
      status = 409;
      details = {
        code: 'DUPLICATE_RECORD',
        message: 'A record with this unique identity already exists.',
      };
    } else if ((error as { code?: string })?.code === 'P2025') {
      status = 404;
      details = { code: 'NOT_FOUND', message: 'The requested record was not found.' };
    } else if ((error as { code?: string })?.code === 'P2003') {
      status = 409;
      details = {
        code: 'INVALID_REFERENCE',
        message: 'A referenced record does not exist or is still in use.',
      };
    } else if ((error as { type?: string })?.type === 'entity.too.large') {
      status = 413;
      details = { code: 'PAYLOAD_TOO_LARGE', message: 'Request exceeds the accepted size.' };
    } else if (error instanceof SyntaxError && 'body' in error) {
      status = 400;
      details = { code: 'INVALID_JSON', message: 'Request body must contain valid JSON.' };
    }
    logger[status >= 500 ? 'error' : 'warn'](
      { requestId, event: 'request.failed', code: details.code, status },
      'Request could not be completed.',
    );
    res.status(status).json({ error: { ...details, requestId } });
  };
}
