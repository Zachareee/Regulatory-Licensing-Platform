import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../domain/errors';
import { InvalidTransitionError } from '../../domain/statusMachine';

/**
 * Single mapping from domain errors to HTTP status codes, so every route
 * handler can just `throw` a domain error and trust it gets translated
 * correctly and consistently (PRD NFR: input validation & error handling
 * on every mutating endpoint).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation failed',
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    return;
  }
  if (err instanceof ValidationError) {
    res.status(400).json({ error: err.message, fieldErrors: err.fieldErrors });
    return;
  }
  if (err instanceof NotFoundError) {
    res.status(404).json({ error: err.message });
    return;
  }
  if (err instanceof ForbiddenError) {
    res.status(403).json({ error: err.message });
    return;
  }
  if (err instanceof ConflictError || err instanceof InvalidTransitionError) {
    res.status(409).json({ error: err.message });
    return;
  }

  // eslint-disable-next-line no-console
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void> | void,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
