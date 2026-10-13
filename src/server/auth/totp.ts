// RFC 6238 TOTP over RFC 4226 HOTP (FD-USERS §7), ported from Serento.Web's Totp.cs: HMAC-SHA1, 30 s, 6 digits,
// ±1 step, and a high-water mark so a code is accepted once (RFC 6238 §5.2). Pure: the clock is passed in.
//
// SHA-1 is the Key URI Format's default: every authenticator app supports it, and as an HMAC key it is not the
// weak point (a 160-bit random key truncated to six digits).
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const DIGITS = 6;
export const PERIOD_SECONDS = 30;
const WINDOW_STEPS = 1;
const SECRET_BYTES = 20;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function newSecret(): string {
  return encodeBase32(randomBytes(SECRET_BYTES));
}

/** Groups of four, for the "cannot scan?" line. */
export function formatSecret(secret: string): string {
  return secret.replace(/(.{4})(?=.)/g, '$1 ');
}

/** The enrolment URI: the issuer both as the label prefix and as a parameter (older and newer apps read one each). */
export function buildUri(issuer: string, account: string, secret: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${PERIOD_SECONDS}`;
}

export const stepFor = (nowMs: number): number => Math.floor(nowMs / 1000 / PERIOD_SECONDS);

export function computeCode(key: Buffer, step: number, digits = DIGITS): string {
  if (digits < 6 || digits > 9) throw new RangeError('TOTP supports 6 to 9 digits');
  const counter = Buffer.alloc(8);
  counter.writeBigInt64BE(BigInt(step));
  const mac = createHmac('sha1', key).update(counter).digest();
  const offset = (mac[mac.length - 1] as number) & 0x0f;
  const binary = (((mac[offset] as number) & 0x7f) << 24) | ((mac[offset + 1] as number) << 16) | ((mac[offset + 2] as number) << 8) | (mac[offset + 3] as number);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/** The step the code was accepted for, or null. Steps at or below `lastStep` are spent. */
export function verifyTotp(secret: string | null, entered: unknown, lastStep: number, nowMs: number): number | null {
  if (!secret) return null;
  const code = String(entered ?? '').replace(/\D/g, '');
  if (code.length !== DIGITS) return null;
  let key: Buffer;
  try {
    key = decodeBase32(secret);
  } catch {
    return null;
  }
  const current = stepFor(nowMs);
  for (let step = current - WINDOW_STEPS; step <= current + WINDOW_STEPS; step++) {
    if (step <= lastStep) continue;
    if (timingSafeEqual(Buffer.from(computeCode(key, step)), Buffer.from(code))) return step;
  }
  return null;
}

export function encodeBase32(data: Uint8Array): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const b of data) {
    buffer = ((buffer << 8) | b) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(buffer >> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(buffer << (5 - bits)) & 31];
  return out;
}

/** Tolerant on the way in: lower case, spaces, dashes and '=' padding. */
export function decodeBase32(s: string): Buffer {
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const raw of s) {
    if (' -=\t\r\n'.includes(raw)) continue;
    const v = ALPHABET.indexOf(raw.toUpperCase());
    if (v < 0) throw new Error(`'${raw}' is not a base32 character`);
    buffer = ((buffer << 5) | v) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((buffer >> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
