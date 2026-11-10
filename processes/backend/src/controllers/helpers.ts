import type { Request } from 'express';
import { idSchema } from '../contracts/schemas.js';
import { AppError } from '../core/errors.js';
export const paramId = (req: Request) => idSchema.parse(req.params.id);
export function idempotencyKey(req: Request) {
  const key = req.get('Idempotency-Key');
  if (key && !/^[a-zA-Z0-9_-]{8,128}$/.test(key))
    throw new AppError(
      'INVALID_IDEMPOTENCY_KEY',
      'Use 8-128 letters, digits, underscores or hyphens.',
      422,
    );
  return key;
}
