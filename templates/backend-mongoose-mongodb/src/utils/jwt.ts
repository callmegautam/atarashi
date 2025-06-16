import env from '@/config/env';
import jwt from 'jsonwebtoken';

const JWT_SECRET = env.JWT_SECRET;
const JWT_EXPIRES_IN = env.JWT_EXPIRY;

export function generateToken(payload: string | Buffer | Object): string {
    // @ts-expect-error
    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token: string) {
    return jwt.verify(token, JWT_SECRET);
}

export function decodeToken(token: string): Object | null {
    return jwt.decode(token);
}
