import bcrypt from 'bcryptjs';

const ROUNDS = 12;

export function hashPassword(password) {
  return bcrypt.hash(password, ROUNDS);
}

export function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}
