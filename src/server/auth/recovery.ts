// Recovery codes (FD-USERS §7), as in Serento.Web: ten single-use codes of ten base32 characters (no 0/1/8/9, so
// they cannot be read as digits), shown once, stored as SHA-256 of their normalised form.
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const RECOVERY_CODE_COUNT = 10;
const LENGTH = 10;

/** Upper case, letters and digits only: the dash, spaces and a phone keyboard's lower case all redeem the same code. */
export const normalizeCode = (s: unknown): string => String(s ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
const hash = (s: string) => createHash('sha256').update(s).digest('hex');

export function newRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    let c = '';
    for (let i = 0; i < LENGTH; i++) c += ALPHABET[randomInt(ALPHABET.length)];
    return `${c.slice(0, LENGTH / 2)}-${c.slice(LENGTH / 2)}`;
  });
}

export const hashRecoveryCodes = (codes: string[]): string => JSON.stringify(codes.map((c) => hash(normalizeCode(c))));

export function countRecoveryCodes(stored: string | null): number {
  try {
    const list = JSON.parse(stored ?? '[]') as unknown;
    return Array.isArray(list) ? list.length : 0;
  } catch {
    return 0;
  }
}

/** The stored list without the code that matched, or null when none did. Every entry is compared (no early exit). */
export function redeemRecoveryCode(stored: string | null, entered: unknown): string | null {
  const wanted = Buffer.from(hash(normalizeCode(entered)));
  let list: string[];
  try {
    list = JSON.parse(stored ?? '[]') as string[];
  } catch {
    return null;
  }
  if (!Array.isArray(list) || normalizeCode(entered).length !== LENGTH) return null;
  let index = -1;
  list.forEach((h, i) => {
    if (typeof h === 'string' && h.length === wanted.length && timingSafeEqual(Buffer.from(h), wanted)) index = i;
  });
  if (index < 0) return null;
  return JSON.stringify(list.filter((_, i) => i !== index));
}
