import { settingsSchema, type Settings, type SettingsView } from '../shared/settings.ts';
import { isValidTimeZone, systemTimeZone } from '../shared/time.ts';
import { parsePublicUrl, type AppConfig } from './config.ts';
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

const PUBLIC_INSTANCE = 'public_instance';

/** The instance with a public address (FD-ONLINE §2), as the other instances on the same database see it. */
export interface PublicInstance {
  /** Its origin, e.g. https://sentiq.money. */
  url: string;
}

const isLoopbackUrl = (url: string) => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);

/** The stored row, checked: a public https origin (never this computer) or null. */
export function parsePublicInstance(raw: string | undefined): PublicInstance | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isPlainObject(v) || typeof v.url !== 'string') return null;
  const url = parsePublicUrl(v.url);
  if (!url || isLoopbackUrl(url)) return null;
  // A row written before FD-MCPREMOVE also says whether the connector was on: ignored.
  return { url };
}

/**
 * At start-up (TD-ONLINE §2): an instance with a public address writes it; one on App Service without it removes the
 * row; any other (the Mac, tests on this computer) leaves it alone.
 */
export async function publishPublicInstance(db: Db, config: Pick<AppConfig, 'publicUrl' | 'proxy'>, now = Date.now()): Promise<void> {
  if (config.publicUrl && !isLoopbackUrl(config.publicUrl)) {
    await db.run(UPSERT_SETTING, { k: PUBLIC_INSTANCE, v: JSON.stringify({ url: config.publicUrl, at: now }) });
  } else if (config.proxy === 'azure') {
    await db.run('DELETE FROM settings WHERE [key] = ?', [PUBLIC_INSTANCE]);
  }
}

/** `settings` row upsert (named parameters @k, @v). */
export const UPSERT_SETTING = 'UPDATE settings SET value = @v WHERE [key] = @k; IF @@ROWCOUNT = 0 INSERT INTO settings([key], value) VALUES (@k, @v)';
const UPSERT_USER = 'UPDATE user_settings SET value = @v WHERE user_id = @u; IF @@ROWCOUNT = 0 INSERT INTO user_settings(user_id, value) VALUES (@u, @v)';

/**
 * How long settings read from the database are reused (TD-AZURE §5): another process on the same database (the Mac and
 * Azure) may change them, so a cache never outlives this. Changes made here are seen here at once.
 */
export const SETTINGS_TTL_MS = 30_000;

export class SettingsService {
  private cached: { value: Settings; at: number } | null = null;
  private publicCached: { value: PublicInstance | null; at: number } | null = null;
  private readonly userCache = new Map<number, { value: Settings; at: number }>();
  private readonly listeners: Listener[] = [];
  private readonly db: Db;
  private readonly box: SecretBox;
  private readonly now: () => number;

  constructor(db: Db, box: SecretBox, now: () => number = Date.now) {
    this.db = db;
    this.box = box;
    this.now = now;
  }

  /** The global settings from the database (no cache). */
  private async load(): Promise<Settings> {
    const row = await this.db.get<{ value: string }>('SELECT value FROM settings WHERE [key] = ?', [KEY]);
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
    return parsed;
  }

  async get(): Promise<Settings> {
    if (this.cached && this.now() - this.cached.at < SETTINGS_TTL_MS) return this.cached.value;
    const value = await this.load();
    this.cached = { value, at: this.now() };
    return value;
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

  async view(): Promise<SettingsView> {
    const [claude, td, base] = await Promise.all([this.db.get<{ value: string }>('SELECT value FROM settings WHERE [key] = ?', [CLAUDE_KEY]), this.getTwelveDataKey(), this.get()]);
    let hint: string | null = null;
    if (claude) {
      try {
        hint = secretHint(this.box.decrypt(claude.value));
      } catch {
        hint = null;
      }
    }
    return { ...base, claudeKeySet: Boolean(claude), claudeKeyHint: hint, twelveDataKeySet: td !== null, twelveDataKeyHint: td ? secretHint(td) : null };
  }

  private validate(merged: unknown): Settings {
    const res = settingsSchema.safeParse(merged);
    if (!res.success) throw new ValidationError(`Setări invalide: ${formatIssues(res.error.issues)}`, res.error.issues);
    if (!isValidTimeZone(res.data.timezone)) throw new ValidationError(`Fus orar necunoscut: ${res.data.timezone}`);
    if (res.data.indicator.lenFastEma <= 0 || res.data.indicator.lenSlowEma <= 0) throw new ValidationError('Perioadele EMA trebuie să fie pozitive');
    return res.data;
  }

  /** Reads, merges and writes the global settings; the caller holds the transaction (caches are set after COMMIT). */
  private async writeGlobal(patch: Record<string, unknown>): Promise<{ next: Settings; prev: Settings }> {
    const prev = await this.load();
    const next = this.validate(deepMerge(prev, patch));
    await this.db.run(UPSERT_SETTING, { k: KEY, v: JSON.stringify(next) });
    return { next, prev };
  }

  private afterGlobal({ next, prev }: { next: Settings; prev: Settings }): void {
    this.cached = { value: next, at: this.now() };
    // Every user's view carries the global keys too.
    this.userCache.clear();
    for (const l of this.listeners) {
      try {
        l(next, prev);
      } catch {
        // listeners must not break saving
      }
    }
  }

  /** Saves a patch of the global settings: read, merged and written in one transaction (two saves never lose one). */
  async update(patch: unknown): Promise<Settings> {
    if (!isPlainObject(patch)) throw new ValidationError('Setările trebuie trimise ca obiect JSON');
    const done = await this.db.tx(() => this.writeGlobal(patch));
    this.afterGlobal(done);
    return done.next;
  }

  onChange(l: Listener): void {
    this.listeners.push(l);
  }

  // ── Per user (FD-USERS §2) ───────────────────────────────────────────────────────────────────────────

  /**
   * Run once at start-up after migration 3: the admin (user 1) keeps the personal settings that so far lived in the
   * one global blob. Nothing to do when they already have their own row.
   */
  async migrateLegacyToAdmin(adminId: number): Promise<void> {
    await this.db.tx(async () => {
      if (await this.db.get('SELECT 1 AS x FROM user_settings WHERE user_id = ?', [adminId])) return;
      const row = await this.db.get<{ value: string }>('SELECT value FROM settings WHERE [key] = ?', [KEY]);
      if (!row) return;
      let stored: unknown;
      try {
        stored = JSON.parse(row.value);
      } catch {
        return;
      }
      if (!isPlainObject(stored)) return;
      const own = Object.fromEntries(Object.entries(stored).filter(([k]) => isUserKey(k)));
      await this.db.run('INSERT INTO user_settings(user_id, value) VALUES (?, ?)', [adminId, JSON.stringify(own)]);
    });
    this.userCache.delete(adminId);
  }

  /**
   * Run once at start-up (FD-MARKETSRC §3): the exchange and the chart history, so far each user's, become everyone's
   * (`marketData`), taken from the admin's own settings. Nothing to do once the global row has them.
   */
  async migrateMarketData(adminId: number): Promise<void> {
    const done = await this.db.tx(async () => {
      const row = await this.db.get<{ value: string }>('SELECT value FROM settings WHERE [key] = ?', [KEY]);
      let stored: unknown = {};
      try {
        stored = row ? JSON.parse(row.value) : {};
      } catch {
        stored = {};
      }
      if (isPlainObject(stored) && stored.marketData !== undefined) return null;
      const own = await this.db.get<{ value: string }>('SELECT value FROM user_settings WHERE user_id = ?', [adminId]);
      let market: unknown;
      try {
        market = own ? (JSON.parse(own.value) as { market?: unknown }).market : undefined;
      } catch {
        market = undefined;
      }
      // Each value only if still valid (an exchange no longer offered, a history length no longer offered: the default).
      const m = isPlainObject(market) ? market : {};
      const marketData: Record<string, unknown> = {};
      for (const k of ['exchange', 'candles'] as const) {
        if (m[k] !== undefined && settingsSchema.shape.marketData.safeParse({ [k]: m[k] }).success) marketData[k] = m[k];
      }
      return this.writeGlobal({ marketData });
    });
    if (done) this.afterGlobal(done);
  }

  /** A user's settings from the database: the global ones, with the user's own in place of the personal keys. */
  private async loadFor(userId: number, global: Settings): Promise<Settings> {
    const row = await this.db.get<{ value: string }>('SELECT value FROM user_settings WHERE user_id = ?', [userId]);
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
    return out;
  }

  /** The settings a user sees: the global ones, with the user's own in place of the personal keys. */
  async forUser(userId: number): Promise<Settings> {
    const cached = this.userCache.get(userId);
    if (cached && this.now() - cached.at < SETTINGS_TTL_MS) return cached.value;
    const out = await this.loadFor(userId, await this.get());
    this.userCache.set(userId, { value: out, at: this.now() });
    return out;
  }

  /** Saves a patch for a user: personal keys for anyone, global keys only for the admin (else 403). */
  async updateFor(userId: number, isAdmin: boolean, patch: unknown): Promise<Settings> {
    if (!isPlainObject(patch)) throw new ValidationError('Setările trebuie trimise ca obiect JSON');
    const globalPatch = Object.fromEntries(Object.entries(patch).filter(([k]) => !isUserKey(k)));
    if (Object.keys(globalPatch).length && !isAdmin) throw new SettingsForbiddenError('Doar adminul poate schimba aceste setări.');
    const global = await this.db.tx(async () => {
      const next = this.validate(deepMerge(await this.loadFor(userId, await this.load()), patch));
      const g = Object.keys(globalPatch).length ? await this.writeGlobal(globalPatch) : null;
      const own = Object.fromEntries(USER_KEYS.map((k) => [k, next[k]]));
      await this.db.run(UPSERT_USER, { u: userId, v: JSON.stringify(own) });
      return g;
    });
    if (global) this.afterGlobal(global);
    this.userCache.delete(userId);
    return this.forUser(userId);
  }

  /** The time zones in use (the daily sentiment is kept for each). */
  async timezones(): Promise<string[]> {
    const ids = (await this.db.all<{ id: number }>('SELECT id FROM users ORDER BY id')).map((r) => r.id);
    const zones: string[] = [];
    for (const id of ids) zones.push((await this.forUser(id)).timezone);
    return [...new Set(zones)];
  }

  /** Forgets cached personal settings (a user was deleted, or tests). */
  forget(userId?: number): void {
    if (userId === undefined) this.userCache.clear();
    else this.userCache.delete(userId);
  }

  /** What the API returns: secrets only as "set" flags; their hints and the mail settings only for the admin. */
  async viewFor(userId: number, isAdmin: boolean): Promise<SettingsView> {
    const [v, resend, own] = await Promise.all([this.view(), isAdmin ? this.getResend() : null, this.forUser(userId)]);
    return {
      ...v,
      ...own,
      claudeKeyHint: isAdmin ? v.claudeKeyHint : null,
      twelveDataKeyHint: isAdmin ? v.twelveDataKeyHint : null,
      // The mail settings are the admin's alone (FD-ADMINSET §1).
      ...(resend
        ? { resendKeySet: resend.apiKey !== null, resendKeyHint: resend.apiKey ? secretHint(resend.apiKey) : null, resendFrom: resend.from, resendDev: isDevMail(resend) }
        : {}),
    };
  }

  /** The public instance written by `publishPublicInstance` (FD-ONLINE §2), reused like the settings. */
  async publicInstance(): Promise<PublicInstance | null> {
    if (this.publicCached && this.now() - this.publicCached.at < SETTINGS_TTL_MS) return this.publicCached.value;
    const row = await this.db.get<{ value: string }>('SELECT value FROM settings WHERE [key] = ?', [PUBLIC_INSTANCE]);
    const value = parsePublicInstance(row?.value);
    this.publicCached = { value, at: this.now() };
    return value;
  }

  // ── Resend (FD-USERS §4) ─────────────────────────────────────────────────────────────────────────────

  async getResend(): Promise<{ apiKey: string | null; from: string }> {
    const rows = await this.db.all<{ key: string; value: string }>('SELECT [key], value FROM settings WHERE [key] IN (?, ?)', [RESEND_KEY, RESEND_FROM]);
    const key = rows.find((r) => r.key === RESEND_KEY);
    const from = rows.find((r) => r.key === RESEND_FROM);
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
  async setResend(key: string | null | undefined, from?: string | null): Promise<void> {
    // Both are checked before either is saved: a bad sender never leaves a new key half-saved.
    const k = typeof key === 'string' ? key.trim() : '';
    if (k && !/^re_[A-Za-z0-9_]{10,200}$/.test(k)) throw new ValidationError('Cheia Resend începe cu „re_” și conține doar litere, cifre și „_”.');
    const f = from === undefined ? undefined : (from ?? '').trim();
    if (f && (f.length > 200 || !/^(?:[^<>@\r\n]{0,80}<[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>|[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)$/.test(f))) {
      throw new ValidationError('Expeditor invalid: „nume <adresa@domeniu>” sau „adresa@domeniu”.');
    }
    await this.db.tx(async () => {
      if (key === null || (typeof key === 'string' && !k)) await this.db.run('DELETE FROM settings WHERE [key] = ?', [RESEND_KEY]);
      else if (k) await this.db.run(UPSERT_SETTING, { k: RESEND_KEY, v: this.box.encrypt(k) });
      if (f === '') await this.db.run('DELETE FROM settings WHERE [key] = ?', [RESEND_FROM]);
      else if (f !== undefined) await this.db.run(UPSERT_SETTING, { k: RESEND_FROM, v: f });
    });
  }

  async setClaudeKey(key: string | null): Promise<void> {
    if (key === null || key.trim() === '') {
      await this.db.run('DELETE FROM settings WHERE [key] = ?', [CLAUDE_KEY]);
      return;
    }
    const k = key.trim();
    if (k.length < 20 || k.length > 300 || /\s/.test(k)) throw new ValidationError('Cheia API Anthropic nu pare validă');
    await this.db.run(UPSERT_SETTING, { k: CLAUDE_KEY, v: this.box.encrypt(k) });
  }

  /** The Twelve Data key (FD-SENTIQ §4.3), encrypted like the Claude key; null removes it. */
  async setTwelveDataKey(key: string | null): Promise<void> {
    if (key === null || key.trim() === '') {
      await this.db.run('DELETE FROM settings WHERE [key] = ?', [TWELVEDATA_KEY]);
      return;
    }
    const k = key.trim();
    if (!TWELVEDATA_KEY_RE.test(k)) throw new ValidationError(TWELVEDATA_KEY_INVALID);
    await this.db.run(UPSERT_SETTING, { k: TWELVEDATA_KEY, v: this.box.encrypt(k) });
  }

  private async secret(name: string): Promise<string | null> {
    const row = await this.db.get<{ value: string }>('SELECT value FROM settings WHERE [key] = ?', [name]);
    if (!row) return null;
    try {
      return this.box.decrypt(row.value);
    } catch {
      return null;
    }
  }

  getTwelveDataKey(): Promise<string | null> {
    return this.secret(TWELVEDATA_KEY);
  }

  getClaudeKey(): Promise<string | null> {
    return this.secret(CLAUDE_KEY);
  }
}
