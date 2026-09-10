import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Wraps an async route handler so a rejected promise reaches the error
 * middleware instead of becoming an unhandled rejection.
 */
export const asyncHandler =
  (handler: RequestHandler): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
