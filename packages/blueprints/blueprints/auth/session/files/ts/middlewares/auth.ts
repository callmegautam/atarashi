import type { NextFunction, Request, Response } from 'express';

import { HttpStatus, sendError } from '../lib/http.js';

/** Rejects the request unless the session carries a signed-in user. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) {
    sendError(res, 'Authentication required', HttpStatus.UNAUTHORIZED);
    return;
  }
  next();
}
