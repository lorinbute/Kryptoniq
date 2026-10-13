// Password hashing and policy (FD-USERS §4, TD-USERS §2). scrypt from node:crypto: memory-hard, no native add-on.
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// N = 2^15 with r = 8 needs 32 MiB per hash (~60-100 ms here): slow for a guesser, fine for a login.
const N = 2 ** 15;
const R = 8;
const P = 1;
const KEY_LEN = 32;
const MAX_MEM = 64 * 1024 * 1024;

export const PASSWORD_RULE = 'Parola: minimum 12 caractere, cu literă mare, literă mică și cifră.';

/** Why a password is refused, or null when it follows the rule. */
export function passwordProblem(pw: unknown): string | null {
  if (typeof pw !== 'string' || pw.length < 12) return 'Parola are nevoie de cel puțin 12 caractere.';
  if (pw.length > 200) return 'Parola poate avea cel mult 200 de caractere.';
  if (!/[A-Z]/.test(pw) || !/[a-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Parola are nevoie de o literă mare, o literă mică și o cifră.';
  return null;
}

function derive(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize('NFKC'), salt, KEY_LEN, { N: n, r, p, maxmem: MAX_MEM }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

/** `scrypt$N$r$p$salt$hash` (base64url), so the parameters can be raised later without breaking old hashes. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P);
  return ['scrypt', N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored || typeof password !== 'string' || password.length > 200) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [n, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  if (![n, r, p].every((x) => Number.isInteger(x) && x > 0)) return false;
  const expected = Buffer.from(parts[5] as string, 'base64url');
  const key = await derive(password, Buffer.from(parts[4] as string, 'base64url'), n, r, p);
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** A password check that costs the same when there is no account, so timing does not say whether an email exists. */
let dummyHash: Promise<string> | null = null;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword('Unused-dummy-password-0');
  await verifyPassword(password, await dummyHash);
}
