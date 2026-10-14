import { describe, expect, it } from 'vitest';
import { testDb } from '../test/db.ts';
import { hashPassword, passwordProblem, verifyPassword } from './passwords.ts';
import { countRecoveryCodes, hashRecoveryCodes, newRecoveryCodes, redeemRecoveryCode } from './recovery.ts';
import { FULL_SESSION_MS, PENDING_SESSION_MS, Sessions } from './sessions.ts';
import { callerKey, COOLDOWN_MS, Throttle } from './throttle.ts';
import { buildUri, computeCode, decodeBase32, encodeBase32, formatSecret, newSecret, stepFor, verifyTotp } from './totp.ts';

describe('TOTP (RFC 6238, Serento rules)', () => {
  it('matches the RFC 6238 SHA-1 test vectors', () => {
    const key = Buffer.from('12345678901234567890');
    expect(computeCode(key, stepFor(59_000), 8)).toBe('94287082');
    expect(computeCode(key, stepFor(1_111_111_109_000), 8)).toBe('07081804');
    expect(computeCode(key, stepFor(1_234_567_890_000), 8)).toBe('89005924');
    expect(computeCode(key, stepFor(2_000_000_000_000), 8)).toBe('69279037');
  });

  it('accepts the step before and after, never a spent step, and returns the step used', () => {
    const secret = newSecret();
    const key = decodeBase32(secret);
    const now = Date.UTC(2026, 9, 13, 12);
    const step = stepFor(now);
    expect(verifyTotp(secret, computeCode(key, step), 0, now)).toBe(step);
    expect(verifyTotp(secret, computeCode(key, step - 1), 0, now)).toBe(step - 1);
    expect(verifyTotp(secret, computeCode(key, step + 1), 0, now)).toBe(step + 1);
    expect(verifyTotp(secret, computeCode(key, step - 2), 0, now)).toBeNull();
    // Replay: the high-water mark makes the same code (and older ones) useless.
    expect(verifyTotp(secret, computeCode(key, step), step, now)).toBeNull();
    expect(verifyTotp(secret, '12345', 0, now)).toBeNull();
    expect(verifyTotp(null, computeCode(key, step), 0, now)).toBeNull();
  });

  it('round-trips base32, groups the secret and builds an otpauth URI', () => {
    const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 9]);
    expect(decodeBase32(encodeBase32(bytes))).toEqual(bytes);
    expect(decodeBase32('jbsw y3dp-ehpk 3pxp')).toEqual(decodeBase32('JBSWY3DPEHPK3PXP'));
    const secret = newSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(formatSecret(secret).split(' ')).toHaveLength(8);
    const uri = new URL(buildUri('Sentiq', 'ana@example.com', secret));
    expect(uri.protocol).toBe('otpauth:');
    expect(uri.searchParams.get('secret')).toBe(secret);
    expect(uri.searchParams.get('issuer')).toBe('Sentiq');
  });
});

describe('recovery codes', () => {
  it('are ten XXXXX-XXXXX codes, each good once, in any case or spacing', () => {
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(10);
    for (const c of codes) expect(c).toMatch(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/);
    const stored = hashRecoveryCodes(codes);
    expect(stored).not.toContain(codes[0]!.replace('-', ''));
    const typed = ` ${codes[3]!.toLowerCase().replace('-', ' ')} `;
    const rest = redeemRecoveryCode(stored, typed);
    expect(rest).not.toBeNull();
    expect(countRecoveryCodes(rest)).toBe(9);
    expect(redeemRecoveryCode(rest, codes[3])).toBeNull();
    expect(redeemRecoveryCode(stored, 'AAAAA-AAAAA')).toBeNull();
    expect(redeemRecoveryCode(null, codes[0])).toBeNull();
  });
});

describe('passwords', () => {
  it('follow the rule and verify only the right password', async () => {
    expect(passwordProblem('short')).toMatch(/12/);
    expect(passwordProblem('alllowercase123')).toMatch(/mare/);
    expect(passwordProblem('x'.repeat(201))).toMatch(/200/);
    expect(passwordProblem('Corect-horse-9')).toBeNull();
    const h = await hashPassword('Corect-horse-9');
    expect(h).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(await verifyPassword('Corect-horse-9', h)).toBe(true);
    expect(await verifyPassword('Corect-horse-8', h)).toBe(false);
    expect(await verifyPassword('Corect-horse-9', null)).toBe(false);
    expect(await verifyPassword('Corect-horse-9', 'md5$abc')).toBe(false);
  });
});

describe('throttle', () => {
  it('locks a caller after three failures for 15 minutes, per partition', () => {
    let now = 1_000_000;
    const t = new Throttle(() => now);
    expect(t.registerFailure('login:a')).toBeNull();
    expect(t.registerFailure('login:a')).toBeNull();
    expect(t.registerFailure('login:a')).toBe(COOLDOWN_MS);
    expect(t.lockedFor('login:a')).toBe(COOLDOWN_MS);
    expect(t.lockedFor('mail:a')).toBeNull();
    expect(t.lockedFor('login:b')).toBeNull();
    now += COOLDOWN_MS;
    expect(t.lockedFor('login:a')).toBeNull();
    expect(t.registerFailure('login:a')).toBeNull();
    t.reset('login:a');
    expect(t.remaining('login:a')).toBe(3);
  });

  it('keys IPv4 whole and IPv6 by its /64', () => {
    expect(callerKey('192.168.1.20')).toBe('192.168.1.20');
    expect(callerKey('::ffff:192.168.1.20')).toBe('192.168.1.20');
    expect(callerKey('2a02:2f0e:0012:3400:aaaa:bbbb:cccc:dddd')).toBe('2a02:2f0e:12:3400::/64');
    expect(callerKey('2a02:2f0e:12:3400::1')).toBe('2a02:2f0e:12:3400::/64');
    expect(callerKey('::1')).toBe('0:0:0:0::/64');
    expect(callerKey(undefined)).toBe('unknown');
  });
});

describe('sessions', () => {
  it('keep a full sign-in for 30 days of use and a pending one for 5 fixed minutes', async () => {
    const db = await testDb();
    let now = Date.UTC(2026, 9, 13);
    const s = new Sessions(db, () => now);
    const full = await s.create(1, 'full');
    const pending = await s.create(1, 'pending');
    expect((await db.get<{ n: number }>('SELECT count(*) AS n FROM sessions WHERE id_hash = ?', [full]))?.n).toBe(0); // only hashes are stored
    now += PENDING_SESSION_MS - 1;
    expect((await s.read(pending))?.kind).toBe('pending');
    now += 1;
    expect(await s.read(pending)).toBeNull();
    // Used every 20 days, a full session never ends; left alone for 30 days, it does.
    for (let i = 0; i < 3; i++) {
      now += 20 * 86_400_000;
      expect((await s.read(full))?.kind).toBe('full');
    }
    now += FULL_SESSION_MS;
    expect(await s.read(full)).toBeNull();
    const a = await s.create(1, 'full');
    const b = await s.create(1, 'full');
    expect(await s.destroyAll(1, a)).toBe(1);
    expect(await s.read(a)).not.toBeNull();
    expect(await s.read(b)).toBeNull();
    expect(await s.read('x'.repeat(200))).toBeNull();
  });
});
