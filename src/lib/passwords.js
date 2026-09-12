import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(crypto.scrypt);
const KEY_LENGTH = 64;
const N = 16384;
const r = 8;
const p = 1;

export async function hashPassword(password) {
  const value = String(password || '');
  if (value.length < 14) throw new Error('PASSWORD_TOO_SHORT');
  const salt = crypto.randomBytes(16);
  const derived = await scryptAsync(value, salt, KEY_LENGTH, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${Buffer.from(derived).toString('base64url')}`;
}

export async function verifyPassword(password, encoded) {
  try {
    const [scheme, nText, rText, pText, saltText, hashText] = String(encoded || '').split('$');
    if (scheme !== 'scrypt' || !saltText || !hashText) return false;
    const expected = Buffer.from(hashText, 'base64url');
    const salt = Buffer.from(saltText, 'base64url');
    const derived = Buffer.from(await scryptAsync(String(password || ''), salt, expected.length, {
      N: Number(nText), r: Number(rText), p: Number(pText), maxmem: 64 * 1024 * 1024
    }));
    return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
  } catch {
    return false;
  }
}

export function generateTemporaryPassword() {
  return `${crypto.randomBytes(18).toString('base64url')}!9Aa`;
}
