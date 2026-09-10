import jwt from 'jsonwebtoken';

import { env } from '../config/env.js';

export function signToken(payload, options = {}) {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN, ...options });
}

export function verifyToken(token) {
  return jwt.verify(token, env.JWT_SECRET);
}

export function decodeToken(token) {
  return jwt.decode(token);
}
