import { settingsSchema, type Settings, type SettingsView } from '../shared/settings.ts';
import { isValidTimeZone, systemTimeZone } from '../shared/time.ts';
import type { Db } from './db/database.ts';
import { secretHint, type SecretBox } from './secrets/crypto.ts';

/** Short, human summary of zod issues: "retentionDays: Too small…; indicator.lenFastEma: …". */
export function formatIssues(issues: readonly { path: readonly PropertyKey[]; message: string }[]): string {
  return issues
    .slice(0, 3)
    .map((i) => (i.path.length ? `${i.path.map(String).join('.')}: ${i.message}` : i.message))
    .join('; ');
}

export class ValidationError extends Error {
  readonly details: unknown;
  constructor(message: string, details?: unknown) {
    super(message);
    this.details = details;
  }
}

const KEY = 'app';
const CLAUDE_KEY = 'claude_key';
const RESEND_KEY = 'resend_key';
const RESEND_FROM = 'resend_from';
/** Resend's test sender: works without a verified domain, delivers only to the Resend account's own address. */
export const RESEND_DEV_FROM = 'onboarding@resend.dev';
/** Mail that reaches only the Resend account's owner: no key, or Resend's test sender ("Sentiq <onboarding@resend.dev>" too). */
export const isDevMail = (r: { apiKey: string | null; from: string }) => !r.apiKey || /(^|<)onboarding@resend\.dev>?$/i.test(r.from.trim());

/** Settings each user has for themselves (FD-USERS §2); the rest are global and only the admin changes them. */
export const USER_KEYS = ['timezone', 'market', 'scanner', 'calendar', 'indicator', 'lma', 'charts'] as const;
type UserKey = (typeof USER_KEYS)[number];
const isUserKey = (k: string): k is UserKey => (USER_KEYS as readonly string[]).includes(k);

/** A user tried to change a global setting (403). */
export class SettingsForbiddenError extends Error {
  readonly statusCode = 403;
  readonly code = 'FORBIDDEN';
}
const TWELVEDATA_KEY = 'twelvedata_key';
/** What a Twelve Data key looks like (checked before it is sent anywhere). */
export const TWELVEDATA_KEY_RE = /^[A-Za-z0-9]{16,64}$/;
export const TWELVEDATA_KEY_INVALID = 'Cheia Twelve Data nu pare validă (litere și cifre, 16–64 de caractere)';

type Listener = (next: Settings, prev: Settings) => void;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Deep merge where arrays and primitives in `patch` replace the base value. */
export function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch === undefined ? base : patch;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    out[k] = deepMerge(base[k], v);
  }
  return out;
}

export class SettingsService {
  private cached: Settings | null = null;
  private readonly userCache = new Map<number, Settings>();
  private readonly listeners: Listener[] = [];
  private readonly db: Db;
  private readonly box: SecretBox;

  constructor(db: Db, box: SecretBox) {
    this.db = db;
    this.box = box;
  }

  get(): Settings {
    if (this.cached) return this.cached;
    const row = this.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [KEY]);
    let parsed: Settings;
    let stored: unknown = {};
    try {
      stored = row ? JSON.parse(row.value) : {};
    } catch {
      stored = {};
    }
    const res = settingsSchema.safeParse(stored);
    // A stored blob that no longer validates (e.g. after an upgrade) falls back field-group by field-group.
    parsed = res.success ? res.data : this.salvage(stored);
    // No (valid) stored time zone → follow the system's.
    const storedTz = isPlainObject(stored) && typeof stored.timezone === 'string' ? stored.timezone : null;
    parsed = { ...parsed, timezone: storedTz && isValidTimeZone(storedTz) ? storedTz : systemTimeZone() };
    this.cached = parsed;
    return parsed;
  }

  private salvage(stored: unknown): Settings {
    const base = settingsSchema.parse({});
    if (!isPlainObject(stored)) return base;
    const out: Record<string, unknown> = { ...base };
    for (const key of Object.keys(base) as (keyof Settings)[]) {
      const candidate = settingsSchema.safeParse({ ...base, [key]: stored[key] });
      if (candidate.success) out[key] = candidate.data[key];
    }
    return out as Settings;
  }

  view(): SettingsView {
    const claude = this.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [CLAUDE_KEY]);
    let hint: string | null = null;
    if (claude) {
      try {
        hint = secretHint(this.box.decrypt(claude.value));
      } catch {
        hint = null;
      }
    }
    const td = this.getTwelveDataKey();
    return { ...this.get(), claudeKeySet: Boolean(claude), claudeKeyHint: hint, twelveDataKeySet: td !== null, twelveDataKeyHint: td ? secretHint(td) : null };
  }

  update(patch: unknown): Settings {
    if (!isPlainObject(patch)) throw new ValidationError('Setările trebuie trimise ca obiect JSON');
    const prev = this.get();
    const merged = deepMerge(prev, patch);
    const res = settingsSchema.safeParse(merged);
    if (!res.success) throw new ValidationError(`Setări invalide: ${formatIssues(res.error.issues)}`, res.error.issues);
    if (!isValidTimeZone(res.data.timezone)) throw new ValidationError(`Fus orar necunoscut: ${res.data.timezone}`);
    if (res.data.indicator.lenFastEma <= 0 || res.data.indicator.lenSlowEma <= 0) throw new ValidationError('Perioadele EMA trebuie să fie pozitive');
    this.db.run('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [KEY, JSON.stringify(res.data)]);
    this.cached = res.data;
    // Every user's view carries the global keys too.
    this.userCache.clear();
    for (const l of this.listeners) {
      try {
        l(res.data, prev);
      } catch {
        // listeners must not break saving
      }
    }
    return res.data;
  }

  onChange(l: Listener): void {
    this.listeners.push(l);
  }

  // ── Per user (FD-USERS §2) ───────────────────────────────────────────────────────────────────────────

  /**
   * Run once at start-up after migration 3: the admin (user 1) keeps the personal settings that so far lived in the
   * one global blob. Nothing to do when they already have their own row.
   */
  migrateLegacyToAdmin(adminId: number): void {
    if (this.db.get('SELECT 1 AS x FROM user_settings WHERE user_id = ?', [adminId])) return;
    const row = this.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [KEY]);
    if (!row) return;
    let stored: unknown;
    try {
      stored = JSON.parse(row.value);
    } catch {
      return;
    }
    if (!isPlainObject(stored)) return;
    const own = Object.fromEntries(Object.entries(stored).filter(([k]) => isUserKey(k)));
    this.db.run('INSERT OR IGNORE INTO user_settings(user_id, value) VALUES (?, ?)', [adminId, JSON.stringify(own)]);
    this.userCache.delete(adminId);
  }

  /** The settings a user sees: the global ones, with the user's own in place of the personal keys. */
  forUser(userId: number): Settings {
    const cached = this.userCache.get(userId);
    if (cached) return cached;
    const global = this.get();
    const row = this.db.get<{ value: string }>('SELECT value FROM user_settings WHERE user_id = ?', [userId]);
    let own: Record<string, unknown> = {};
    try {
      const parsed = row ? (JSON.parse(row.value) as unknown) : {};
      if (isPlainObject(parsed)) own = parsed;
    } catch {
      own = {};
    }
    // Personal keys come from the user's row or the defaults, never from somebody else's.
    const base = settingsSchema.parse({});
    const candidate: Record<string, unknown> = { ...global };
    for (const k of USER_KEYS) candidate[k] = own[k] !== undefined ? own[k] : k === 'timezone' ? systemTimeZone() : base[k];
    const res = settingsSchema.safeParse(candidate);
    let out = res.success ? res.data : this.salvage(candidate);
    if (!isValidTimeZone(out.timezone)) out = { ...out, timezone: systemTimeZone() };
    this.userCache.set(userId, out);
    return out;
  }

  /** Saves a patch for a user: personal keys for anyone, global keys only for the admin (else 403). */
  updateFor(userId: number, isAdmin: boolean, patch: unknown): Settings {
    if (!isPlainObject(patch)) throw new ValidationError('Setările trebuie trimise ca obiect JSON');
    const globalPatch = Object.fromEntries(Object.entries(patch).filter(([k]) => !isUserKey(k)));
    if (Object.keys(globalPatch).length && !isAdmin) throw new SettingsForbiddenError('Doar adminul poate schimba aceste setări.');
    const merged = deepMerge(this.forUser(userId), patch);
    const res = settingsSchema.safeParse(merged);
    if (!res.success) throw new ValidationError(`Setări invalide: ${formatIssues(res.error.issues)}`, res.error.issues);
    if (!isValidTimeZone(res.data.timezone)) throw new ValidationError(`Fus orar necunoscut: ${res.data.timezone}`);
    if (res.data.indicator.lenFastEma <= 0 || res.data.indicator.lenSlowEma <= 0) throw new ValidationError('Perioadele EMA trebuie să fie pozitive');
    if (Object.keys(globalPatch).length) this.update(globalPatch);
    const own = Object.fromEntries(USER_KEYS.map((k) => [k, res.data[k]]));
    this.db.run('INSERT INTO user_settings(user_id, value) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET value = excluded.value', [userId, JSON.stringify(own)]);
    this.userCache.delete(userId);
    return this.forUser(userId);
  }

  /** The time zones in use (the daily sentiment is kept for each). */
  timezones(): string[] {
    const ids = this.db.all<{ id: number }>('SELECT id FROM users').map((r) => r.id);
    return [...new Set(ids.map((id) => this.forUser(id).timezone))];
  }

  /** Forgets cached personal settings (a user was deleted, or tests). */
  forget(userId?: number): void {
    if (userId === undefined) this.userCache.clear();
    else this.userCache.delete(userId);
  }

  /** What the API returns: secrets only as "set" flags; their hints only for the admin. */
  viewFor(userId: number, isAdmin: boolean): SettingsView {
    const v = this.view();
    const resend = this.getResend();
    return {
      ...v,
      ...this.forUser(userId),
      claudeKeyHint: isAdmin ? v.claudeKeyHint : null,
      twelveDataKeyHint: isAdmin ? v.twelveDataKeyHint : null,
      resendKeySet: resend.apiKey !== null,
      resendKeyHint: isAdmin && resend.apiKey ? secretHint(resend.apiKey) : null,
      resendFrom: resend.from,
      resendDev: isDevMail(resend),
    };
  }

  // ── Resend (FD-USERS §4) ─────────────────────────────────────────────────────────────────────────────

  getResend(): { apiKey: string | null; from: string } {
    const key = this.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [RESEND_KEY]);
    const from = this.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [RESEND_FROM]);
    let apiKey: string | null = null;
    if (key) {
      try {
        apiKey = this.box.decrypt(key.value);
      } catch {
        apiKey = null;
      }
    }
    return { apiKey, from: from?.value || RESEND_DEV_FROM };
  }

  /** `key`: null removes it, undefined keeps it. `from`: "Name <a@b.c>" or "a@b.c"; empty = Resend's test sender. */
  setResend(key: string | null | undefined, from?: string | null): void {
    // Both are checked before either is saved: a bad sender never leaves a new key half-saved.
    const k = typeof key === 'string' ? key.trim() : '';
    if (k && !/^re_[A-Za-z0-9_]{10,200}$/.test(k)) throw new ValidationError('Cheia Resend începe cu „re_” și conține doar litere, cifre și „_”.');
    const f = from === undefined ? undefined : (from ?? '').trim();
    if (f && (f.length > 200 || !/^(?:[^<>@\r\n]{0,80}<[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>|[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)$/.test(f))) {
      throw new ValidationError('Expeditor invalid: „nume <adresa@domeniu>” sau „adresa@domeniu”.');
    }
    this.db.tx(() => {
      if (key === null || (typeof key === 'string' && !k)) this.db.run('DELETE FROM settings WHERE key = ?', [RESEND_KEY]);
      else if (k) this.db.run('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [RESEND_KEY, this.box.encrypt(k)]);
      if (f === '') this.db.run('DELETE FROM settings WHERE key = ?', [RESEND_FROM]);
      else if (f !== undefined) this.db.run('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [RESEND_FROM, f]);
    });
  }

  setClaudeKey(key: string | null): void {
    if (key === null || key.trim() === '') {
      this.db.run('DELETE FROM settings WHERE key = ?', [CLAUDE_KEY]);
      return;
    }
    const k = key.trim();
    if (k.length < 20 || k.length > 300 || /\s/.test(k)) throw new ValidationError('Cheia API Anthropic nu pare validă');
    this.db.run('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [CLAUDE_KEY, this.box.encrypt(k)]);
  }

  /** The Twelve Data key (FD-SENTIQ §4.3), encrypted like the Claude key; null removes it. */
  setTwelveDataKey(key: string | null): void {
    if (key === null || key.trim() === '') {
      this.db.run('DELETE FROM settings WHERE key = ?', [TWELVEDATA_KEY]);
      return;
    }
    const k = key.trim();
    if (!TWELVEDATA_KEY_RE.test(k)) throw new ValidationError(TWELVEDATA_KEY_INVALID);
    this.db.run('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [TWELVEDATA_KEY, this.box.encrypt(k)]);
  }

  getTwelveDataKey(): string | null {
    const row = this.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [TWELVEDATA_KEY]);
    if (!row) return null;
    try {
      return this.box.decrypt(row.value);
    } catch {
      return null;
    }
  }

  getClaudeKey(): string | null {
    const row = this.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [CLAUDE_KEY]);
    if (!row) return null;
    try {
      return this.box.decrypt(row.value);
    } catch {
      return null;
    }
  }
}
