import { HttpStatus, sendError } from '../lib/http.js';
import { verifyToken } from '../lib/jwt.js';

/** Accepts `Authorization: Bearer <token>` first, then a `token` cookie. */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  const bearer = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
  const token = bearer ?? req.cookies?.token;

  if (!token) {
    sendError(res, 'Authentication required', HttpStatus.UNAUTHORIZED);
    return;
  }

  try {
    req.user = verifyToken(token);
    next();
  } catch {
    sendError(res, 'Invalid or expired token', HttpStatus.UNAUTHORIZED);
  }
}
