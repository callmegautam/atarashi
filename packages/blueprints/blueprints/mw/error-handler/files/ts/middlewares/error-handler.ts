import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

import { env } from '../config/env.js';
import { HttpError } from '../lib/http-error.js';

/**
 * Express identifies an error handler by its four parameters, so `next` stays
 * in the signature even though it is unused on the happy path.
 */
export function errorHandler(error: unknown, _req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof ZodError) {
    res.status(422).json({ success: false, error: 'Validation failed', details: error.issues });
    return;
  }

  if (error instanceof HttpError) {
    res.status(error.status).json({
      success: false,
      error: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    });
    return;
  }

  if (env.NODE_ENV !== 'production') {
    console.error(error);
  }

  res.status(500).json({ success: false, error: 'Internal server error' });
}
