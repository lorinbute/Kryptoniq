// Users (FD-USERS, TD-USERS §2, FD-INVITE): accounts only on request, approved by the admin and activated from a
// link (which also proves the address), password + TOTP (with recovery codes), the one-time links, the admin's
// first password, and the admin's tools. The rules are Serento.Web's AdminAuthService,
// for many accounts:
// - the password is checked BEFORE a second factor, so a wrong password never burns a recovery code;
// - a reset link never clears two-factor (whoever holds the mailbox would otherwise hold both factors);
// - a live reset link is never replaced (nobody can keep invalidating it by asking again);
// - every link and every recovery code is stored as a SHA-256, so the database never holds a usable one.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Db } from '../db/database.ts';
import type { SecretBox } from '../secrets/crypto.ts';
import { burnPasswordCheck, hashPassword, passwordProblem, verifyPassword } from './passwords.ts';
import { countRecoveryCodes, hashRecoveryCodes, newRecoveryCodes, normalizeCode, redeemRecoveryCode } from './recovery.ts';
import { buildUri, newSecret, verifyTotp } from './totp.ts';

export const TOTP_ISSUER = 'Sentiq';
export const RESET_TTL_MS = 3_600_000;
/** How long an activation link works (FD-INVITE §2). */
export const ACTIVATE_TTL_MS = 7 * 86_400_000;
/** Requests nobody answered go after this long (FD-INVITE §1). */
export const REQUEST_MAX_AGE_MS = 30 * 86_400_000;
/** At most this many requests wait at once (FD-INVITE §1). */
export const MAX_PENDING_REQUESTS = 50;
/** The favourites a new account starts with (FD-USERS §2). */
export const NEW_USER_FAVORITES = ['BTC', 'ETH', 'SOL'];

export type Role = 'admin' | 'user';

export interface UserRow {
  id: number;
  email: string | null;
  name: string;
  password_hash: string | null;
  role: Role;
  email_verified_at: number | null;
  created_at: number;
  last_login_at: number | null;
  disabled_at: number | null;
  totp_secret: string | null;
  totp_confirmed_at: number | null;
  totp_last_step: number;
  recovery_codes: string | null;
  passkey_user_handle: Uint8Array | null;
}

export interface PublicUser {
  id: number;
  email: string | null;
  name: string;
  role: Role;
  emailVerified: boolean;
  /** Has a password: approved accounts get one when they are activated (FD-INVITE §3). */
  activated: boolean;
  twoFactor: boolean;
  recoveryCodesLeft: number;
  passkeys: number;
  createdAt: number;
  lastLoginAt: number | null;
  disabled: boolean;
}

/** A request for an account, waiting for the admin (FD-INVITE §1). */
export interface AccountRequest {
  id: number;
  email: string;
  name: string;
  createdAt: number;
}

export type LoginResult = { status: 'ok' | '2fa'; user: UserRow } | { status: 'unverified' | 'disabled'; user: UserRow } | { status: 'invalid' };
export type SecondFactor = 'totp' | 'recovery' | 'invalid';

/** An error the person can act on (400). */
export class UserError extends Error {}
/** The admin addressed an account that does not exist (404). */
export class UserMissingError extends Error {}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const e = raw.trim().toLowerCase();
  return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

export function cleanName(raw: unknown): string {
  return String(raw ?? '')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .trim()
    .slice(0, 80);
}

export class UserService {
  private readonly db: Db;
  private readonly box: SecretBox;
  private readonly now: () => number;
  constructor(db: Db, box: SecretBox, now: () => number = () => Date.now()) {
    this.db = db;
    this.box = box;
    this.now = now;
  }

  byId(id: number): UserRow | undefined {
    return this.db.get<UserRow>('SELECT * FROM users WHERE id = ?', [id]);
  }

  byEmail(email: string): UserRow | undefined {
    return this.db.get<UserRow>('SELECT * FROM users WHERE email = ?', [email]);
  }

  admin(): UserRow {
    return this.db.get<UserRow>("SELECT * FROM users WHERE role = 'admin' ORDER BY id LIMIT 1") as UserRow;
  }

  publicUser(u: UserRow): PublicUser {
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      emailVerified: u.email_verified_at !== null,
      activated: u.password_hash !== null,
      twoFactor: u.totp_confirmed_at !== null,
      recoveryCodesLeft: countRecoveryCodes(u.recovery_codes),
      passkeys: this.db.get<{ n: number }>('SELECT count(*) AS n FROM passkeys WHERE user_id = ?', [u.id])?.n ?? 0,
      createdAt: u.created_at,
      lastLoginAt: u.last_login_at,
      disabled: u.disabled_at !== null,
    };
  }

  // ── The admin's first password (FD-USERS §3) ─────────────────────────────────────────────────────────

  /** True while the admin account cannot be signed into yet (no password, or no email). */
  setupNeeded(): boolean {
    const a = this.admin();
    return !a.password_hash || !a.email;
  }

  /** Sets the admin's email (when it has none) and first password. Refused once a password exists. */
  async setupAdmin(input: { email?: unknown; name?: unknown; password: unknown }): Promise<UserRow> {
    const a = this.admin();
    if (a.password_hash) throw new UserError('Contul de admin are deja o parolă.');
    const email = a.email ?? normalizeEmail(input.email);
    if (!email) throw new UserError('Scrie o adresă de email validă.');
    const problem = passwordProblem(input.password);
    if (problem) throw new UserError(problem);
    const hash = await hashPassword(input.password as string);
    const name = cleanName(input.name) || a.name || email.split('@')[0] || '';
    const other = this.byEmail(email);
    if (other && other.id !== a.id) throw new UserError('Adresa e deja folosită de alt cont.');
    // Two first passwords sent at once: only the first one counts; the other is refused, never signed in.
    const changed = this.db.run('UPDATE users SET email = ?, name = ?, password_hash = ?, email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ? AND password_hash IS NULL', [
      email,
      name,
      hash,
      this.now(),
      a.id,
    ]).changes;
    if (changed === 0) throw new UserError('Contul de admin are deja o parolă.');
    return this.byId(a.id) as UserRow;
  }

  /** The admin's email, set before the first sign-in (`scripts/sentiq.sh admin <email>`). */
  setAdminEmail(raw: unknown): UserRow {
    const email = normalizeEmail(raw);
    if (!email) throw new UserError('Adresă de email invalidă.');
    const a = this.admin();
    const other = this.byEmail(email);
    if (other && other.id !== a.id) throw new UserError('Adresa e deja folosită de alt cont.');
    this.db.run('UPDATE users SET email = ?, email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?', [email, this.now(), a.id]);
    return this.byId(a.id) as UserRow;
  }

  // ── Requests, activation and the one-time links (FD-INVITE) ──────────────────────────────────────────

  /**
   * Somebody asks for an account. `ignored` when the address already has an account or a request (the caller says
   * the same either way, and the first request's name stays), `full` when too many wait.
   */
  requestAccount(input: { email: unknown; name: unknown }): 'created' | 'ignored' | 'full' {
    const email = normalizeEmail(input.email);
    if (!email) throw new UserError('Scrie o adresă de email validă.');
    const name = cleanName(input.name);
    if (!name) throw new UserError('Scrie-ți numele.');
    if (this.byEmail(email) || this.db.get('SELECT 1 AS x FROM account_requests WHERE email = ?', [email])) return 'ignored';
    if ((this.db.get<{ n: number }>('SELECT count(*) AS n FROM account_requests')?.n ?? 0) >= MAX_PENDING_REQUESTS) return 'full';
    try {
      this.db.run('INSERT INTO account_requests(email, name, created_at) VALUES (?, ?, ?)', [email, name, this.now()]);
    } catch {
      return 'ignored'; // the same address asked in between (UNIQUE)
    }
    return 'created';
  }

  /** The requests waiting for the admin, oldest first. */
  accountRequests(): AccountRequest[] {
    return this.db
      .all<{ id: number; email: string; name: string; created_at: number }>('SELECT id, email, name, created_at FROM account_requests ORDER BY created_at, id')
      .map((r) => ({ id: r.id, email: r.email, name: r.name, createdAt: r.created_at }));
  }

  /**
   * The admin approves: an account without a password (it cannot sign in yet) with the default favourites, and its
   * activation link. The request goes either way; an address that got an account meanwhile is refused.
   */
  approveRequest(id: number): { user: UserRow; token: string } {
    const r = this.db.get<{ email: string; name: string }>('SELECT email, name FROM account_requests WHERE id = ?', [id]);
    if (!r) throw new UserMissingError('Cererea nu mai există.');
    const now = this.now();
    const made = this.db.tx(() => {
      this.db.run('DELETE FROM account_requests WHERE id = ?', [id]);
      if (this.byEmail(r.email)) return null;
      const uid = this.db.run("INSERT INTO users(email, name, password_hash, role, created_at) VALUES (?, ?, NULL, 'user', ?)", [r.email, r.name, now]).lastInsertRowid;
      NEW_USER_FAVORITES.forEach((coin, i) =>
        this.db.run("INSERT INTO watchlist(user_id, coin, quote, position, aliases, added_at, kind) VALUES (?, ?, 'USDT', ?, '[]', ?, 'crypto')", [uid, coin, i, now]),
      );
      return { uid, token: this.issueToken(uid, 'activate', ACTIVATE_TTL_MS, false) as string };
    });
    if (made === null) throw new UserError('Adresa are deja un cont.');
    return { user: this.byId(made.uid) as UserRow, token: made.token };
  }

  /** The admin refuses: the request goes, nobody is told. */
  rejectRequest(id: number): void {
    if (this.db.run('DELETE FROM account_requests WHERE id = ?', [id]).changes === 0) throw new UserMissingError('Cererea nu mai există.');
  }

  /** A new activation link for an approved account not activated yet (the old one stops working). */
  newActivation(id: number): { user: UserRow; token: string } {
    const u = this.target(id);
    if (u.password_hash !== null) throw new UserError('Contul e deja activat.');
    return { user: u, token: this.issueToken(id, 'activate', ACTIVATE_TTL_MS, false) as string };
  }

  /** Who an activation link is for, while it can still be used. */
  activationInfo(token: unknown): { email: string; name: string } | null {
    const id = this.tokenUser('activate', token);
    const u = id === null ? undefined : this.byId(id);
    if (!u || !u.email || u.password_hash !== null || u.disabled_at !== null) return null;
    return { email: u.email, name: u.name };
  }

  /** The first password, from a live activation link; the address is confirmed by the link itself. */
  async activate(token: unknown, password: unknown): Promise<UserRow> {
    const problem = passwordProblem(password);
    if (problem) throw new UserError(problem);
    if (!this.activationInfo(token)) throw new UserError('Linkul nu mai e valabil. Cere adminului unul nou.');
    const hash = await hashPassword(password as string);
    // Checked again after the (slow) hash: two submissions at once, or the admin acting meanwhile.
    const id = this.tokenUser('activate', token);
    const done =
      id !== null &&
      this.db.tx(() => {
        const n = this.db.run('UPDATE users SET password_hash = ?, email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ? AND password_hash IS NULL AND disabled_at IS NULL', [
          hash,
          this.now(),
          id,
        ]).changes;
        if (n) this.db.run("DELETE FROM user_tokens WHERE user_id = ? AND kind = 'activate'", [id]);
        return n > 0;
      });
    if (!done) throw new UserError('Linkul nu mai e valabil. Cere adminului unul nou.');
    return this.byId(id) as UserRow;
  }

  /** Requests nobody answered within REQUEST_MAX_AGE_MS. */
  purgeOldRequests(): number {
    return this.db.run('DELETE FROM account_requests WHERE created_at < ?', [this.now() - REQUEST_MAX_AGE_MS]).changes;
  }

  /**
   * A fresh one-time link of `kind`. With `keepLive`, a link still valid is left alone and null is returned (reset
   * links: nobody can invalidate the one already in the mailbox by asking again).
   */
  issueToken(userId: number, kind: 'reset' | 'activate', ttlMs: number, keepLive: boolean): string | null {
    const now = this.now();
    const live = this.db.get<{ expires_at: number }>('SELECT expires_at FROM user_tokens WHERE user_id = ? AND kind = ?', [userId, kind]);
    if (keepLive && live && live.expires_at > now) return null;
    const token = randomBytes(32).toString('base64url');
    this.db.run(
      'INSERT INTO user_tokens(user_id, kind, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, kind) DO UPDATE SET token_hash = excluded.token_hash, expires_at = excluded.expires_at, created_at = excluded.created_at',
      [userId, kind, sha(token), now + ttlMs, now],
    );
    return token;
  }

  /** The user a live link belongs to (without using it up). */
  tokenUser(kind: 'reset' | 'activate', token: unknown): number | null {
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
    const row = this.db.get<{ user_id: number; token_hash: string; expires_at: number }>('SELECT user_id, token_hash, expires_at FROM user_tokens WHERE token_hash = ? AND kind = ?', [sha(token), kind]);
    if (!row || row.expires_at <= this.now()) return null;
    return timingSafeEqual(Buffer.from(row.token_hash), Buffer.from(sha(token))) ? row.user_id : null;
  }

  // ── Sign-in ──────────────────────────────────────────────────────────────────────────────────────────

  async login(rawEmail: unknown, password: unknown): Promise<LoginResult> {
    const email = normalizeEmail(rawEmail);
    const u = email ? this.byEmail(email) : undefined;
    if (!u || !u.password_hash || typeof password !== 'string') {
      await burnPasswordCheck(typeof password === 'string' ? password : '');
      return { status: 'invalid' };
    }
    if (!(await verifyPassword(password, u.password_hash))) return { status: 'invalid' };
    // Told only to somebody who knows the password: the state of an account is nobody else's business.
    if (u.disabled_at !== null) return { status: 'disabled', user: u };
    if (u.email_verified_at === null) return { status: 'unverified', user: u };
    return { status: u.totp_confirmed_at !== null ? '2fa' : 'ok', user: u };
  }

  touchLogin(userId: number): void {
    this.db.run('UPDATE users SET last_login_at = ? WHERE id = ?', [this.now(), userId]);
  }

  /** Six digits = an authenticator code; anything else is tried as a recovery code (the two cannot be confused). */
  verifySecondFactor(userId: number, entered: unknown): SecondFactor {
    const u = this.byId(userId);
    if (!u || u.totp_confirmed_at === null) return 'invalid';
    const input = normalizeCode(entered);
    if (!input) return 'invalid';
    if (/^\d{6}$/.test(input)) {
      const step = verifyTotp(this.secretOf(u), input, u.totp_last_step, this.now());
      if (step === null) return 'invalid';
      this.db.run('UPDATE users SET totp_last_step = ? WHERE id = ?', [step, userId]);
      return 'totp';
    }
    const rest = redeemRecoveryCode(u.recovery_codes, input);
    if (rest === null) return 'invalid';
    this.db.run('UPDATE users SET recovery_codes = ? WHERE id = ?', [rest, userId]);
    return 'recovery';
  }

  // ── Two-factor (TOTP) ────────────────────────────────────────────────────────────────────────────────

  private secretOf(u: UserRow): string | null {
    if (!u.totp_secret) return null;
    try {
      return this.box.decrypt(u.totp_secret);
    } catch {
      return null; // fails closed: two-factor stays on, only a recovery code gets in
    }
  }

  /** The pending secret is shown only before confirmation; a confirmed one never leaves the database again. */
  twoFactorState(userId: number): { enabled: boolean; confirmedAt: number | null; pendingSecret: string | null; uri: string | null; recoveryCodesLeft: number } {
    const u = this.byId(userId) as UserRow;
    const pending = u.totp_confirmed_at === null ? this.secretOf(u) : null;
    return {
      enabled: u.totp_confirmed_at !== null,
      confirmedAt: u.totp_confirmed_at,
      pendingSecret: pending,
      uri: pending ? buildUri(TOTP_ISSUER, u.email ?? `user-${u.id}`, pending) : null,
      recoveryCodesLeft: countRecoveryCodes(u.recovery_codes),
    };
  }

  /** Starts (or restarts) enrolment; refused while two-factor is on (turn it off first). */
  beginTwoFactor(userId: number, restart: boolean): boolean {
    const u = this.byId(userId) as UserRow;
    if (u.totp_confirmed_at !== null) return false;
    if (!u.totp_secret || restart) this.db.run('UPDATE users SET totp_secret = ?, totp_last_step = 0 WHERE id = ?', [this.box.encrypt(newSecret()), userId]);
    return true;
  }

  /** Abandons an unconfirmed enrolment; never turns a live one off. */
  cancelTwoFactor(userId: number): void {
    this.db.run('UPDATE users SET totp_secret = NULL, totp_last_step = 0 WHERE id = ? AND totp_confirmed_at IS NULL', [userId]);
  }

  /** Proves the enrolment, turns two-factor on and returns the recovery codes: the only time they exist in clear. */
  confirmTwoFactor(userId: number, code: unknown): string[] | null {
    const u = this.byId(userId) as UserRow;
    if (u.totp_confirmed_at !== null || !u.totp_secret) return null;
    const step = verifyTotp(this.secretOf(u), code, u.totp_last_step, this.now());
    if (step === null) return null;
    const codes = newRecoveryCodes();
    // The step that confirmed is spent: the same six digits do not work again at the next sign-in.
    this.db.run('UPDATE users SET totp_last_step = ?, totp_confirmed_at = ?, recovery_codes = ? WHERE id = ?', [step, this.now(), hashRecoveryCodes(codes), userId]);
    return codes;
  }

  /** Both factors (a recovery code counts as the second), the password first. */
  async disableTwoFactor(userId: number, password: unknown, code: unknown): Promise<boolean> {
    const u = this.byId(userId) as UserRow;
    if (u.totp_confirmed_at === null || typeof password !== 'string' || !(await verifyPassword(password, u.password_hash))) return false;
    if (this.verifySecondFactor(userId, code) === 'invalid') return false;
    this.db.run('UPDATE users SET totp_secret = NULL, totp_confirmed_at = NULL, totp_last_step = 0, recovery_codes = NULL WHERE id = ?', [userId]);
    return true;
  }

  async regenerateRecoveryCodes(userId: number, password: unknown, code: unknown): Promise<string[] | null> {
    const u = this.byId(userId) as UserRow;
    if (u.totp_confirmed_at === null || typeof password !== 'string' || !(await verifyPassword(password, u.password_hash))) return null;
    if (this.verifySecondFactor(userId, code) === 'invalid') return null;
    const codes = newRecoveryCodes();
    this.db.run('UPDATE users SET recovery_codes = ? WHERE id = ?', [hashRecoveryCodes(codes), userId]);
    return codes;
  }

  // ── Passwords ────────────────────────────────────────────────────────────────────────────────────────

  /** null on success, else why not. */
  async changePassword(userId: number, current: unknown, next: unknown): Promise<string | null> {
    const u = this.byId(userId) as UserRow;
    const problem = passwordProblem(next);
    if (problem) return problem;
    if (typeof current !== 'string' || !(await verifyPassword(current, u.password_hash))) return 'Parola actuală nu e corectă.';
    this.db.run('UPDATE users SET password_hash = ? WHERE id = ?', [await hashPassword(next as string), userId]);
    return null;
  }

  /** A reset link for a confirmed, active account; null otherwise or while a previous link is still valid. */
  beginReset(rawEmail: unknown): { user: UserRow; token: string } | null {
    const email = normalizeEmail(rawEmail);
    const u = email ? this.byEmail(email) : undefined;
    if (!u || u.email_verified_at === null || u.disabled_at !== null) return null;
    const token = this.issueToken(u.id, 'reset', RESET_TTL_MS, true);
    return token ? { user: u, token } : null;
  }

  /** Sets the password from a live reset link (two-factor untouched). */
  async completeReset(token: unknown, password: unknown): Promise<UserRow> {
    const problem = passwordProblem(password);
    if (problem) throw new UserError(problem);
    const id = this.tokenUser('reset', token);
    if (id === null) throw new UserError('Linkul nu mai e valabil. Cere altul din „Am uitat parola”.');
    const hash = await hashPassword(password as string);
    this.db.tx(() => {
      this.db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, id]);
      this.db.run("DELETE FROM user_tokens WHERE user_id = ? AND kind = 'reset'", [id]);
    });
    return this.byId(id) as UserRow;
  }

  // ── The admin's tools (FD-USERS §8) ──────────────────────────────────────────────────────────────────

  list(): PublicUser[] {
    return this.db.all<UserRow>('SELECT * FROM users ORDER BY role, created_at').map((u) => this.publicUser(u));
  }

  private target(id: number): UserRow {
    const u = this.byId(id);
    if (!u) throw new UserMissingError('Utilizatorul nu există.');
    if (u.role === 'admin') throw new UserError('Contul de admin nu poate fi modificat de aici.');
    return u;
  }

  setDisabled(id: number, disabled: boolean): void {
    this.target(id);
    this.db.run('UPDATE users SET disabled_at = ? WHERE id = ?', [disabled ? this.now() : null, id]);
  }

  resetTwoFactor(id: number): void {
    this.target(id);
    this.db.run('UPDATE users SET totp_secret = NULL, totp_confirmed_at = NULL, totp_last_step = 0, recovery_codes = NULL WHERE id = ?', [id]);
  }

  /** Removes the account and, through the foreign keys, its sessions, passkeys, favourites, accounts and events. */
  remove(id: number): void {
    this.target(id);
    this.db.run('DELETE FROM users WHERE id = ?', [id]);
  }

  // ── Passkey user handle ──────────────────────────────────────────────────────────────────────────────

  /** The stable, random WebAuthn user handle (never the id or the email), created on first use. */
  userHandle(userId: number): Uint8Array<ArrayBuffer> {
    const u = this.byId(userId) as UserRow;
    if (!u.passkey_user_handle || !u.passkey_user_handle.length) {
      this.db.run('UPDATE users SET passkey_user_handle = ? WHERE id = ? AND passkey_user_handle IS NULL', [randomBytes(32), userId]);
    }
    const stored = (this.byId(userId) as UserRow).passkey_user_handle as Uint8Array;
    const out = new Uint8Array(new ArrayBuffer(stored.length));
    out.set(stored);
    return out;
  }
}
