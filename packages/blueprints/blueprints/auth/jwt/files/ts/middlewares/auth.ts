import type { NextFunction, Request, Response } from 'express';

import { HttpStatus, sendError } from '../lib/http.js';
import { verifyToken } from '../lib/jwt.js';
import type { TokenPayload } from '../lib/jwt.js';

export interface AuthenticatedRequest extends Request {
  user?: TokenPayload;
}

/** Accepts `Authorization: Bearer <token>` first, then a `token` cookie. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const bearer = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
  const token = bearer ?? (req.cookies?.token as string | undefined);

  if (!token) {
    sendError(res, 'Authentication required', HttpStatus.UNAUTHORIZED);
    return;
  }

  try {
    (req as AuthenticatedRequest).user = verifyToken(token);
    next();
  } catch {
    sendError(res, 'Invalid or expired token', HttpStatus.UNAUTHORIZED);
  }
}
