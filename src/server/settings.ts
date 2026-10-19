import { AI_PROVIDERS, type AiProvider } from '../shared/ai.ts';
import { CHART_SYMBOL_RE, settingsSchema, type AiKeyView, type Settings, type SettingsView } from '../shared/settings.ts';
import { salvageChartLines } from '../shared/hlines.ts';
import { isFavoriteId, STUDY_MAX, studyMemoryEntrySchema, studySchema, type FavoriteId, type Study, type StudyMemoryEntry } from '../shared/studies.ts';
import { salvageOrderTicket } from '../shared/trading.ts';
import { isValidTimeZone, systemTimeZone } from '../shared/time.ts';
import { parsePublicUrl, type AppConfig } from './config.ts';
import type { Db } from './db/database.ts';
import { tdPlanKey, tdUsageKey } from './market/stocks.ts';
import { secretHint, type SecretBox } from './secrets/crypto.ts';

/**
 * The indicators of a list that no longer parses as a whole (FD-INDICATORS §6): each one that still does, once per uid,
 * at most STUDY_MAX. An indicator a newer catalog dropped goes; the others stay.
 */
export function salvageStudies(stored: unknown): Study[] {
  if (!Array.isArray(stored)) return [];
  const out: Study[] = [];
  const seen = new Set<string>();
  for (const item of stored) {
    const r = studySchema.safeParse(item);
    if (!r.success || seen.has(r.data.uid)) continue;
    seen.add(r.data.uid);
    out.push(r.data);
    if (out.length === STUDY_MAX) break;
  }
  return out;
}

/** The known favourites of a stored list, once each (FD-STUDYUX §1: one id dropped from the catalog leaves the rest). */
export function salvageFavorites(stored: unknown): FavoriteId[] {
  if (!Array.isArray(stored)) return [];
  return [...new Set(stored.filter(isFavoriteId))];
}

/** The valid entries of a stored memory, the first for each indicator (FD-STUDYMEMORY). */
export function salvageStudyMemory(stored: unknown): StudyMemoryEntry[] {
  if (!Array.isArray(stored)) return [];
  const out: StudyMemoryEntry[] = [];
  const seen = new Set<string>();
  for (const item of stored) {
    const r = studyMemoryEntrySchema.safeParse(item);
    if (!r.success || seen.has(r.data.id)) continue;
    seen.add(r.data.id);
    out.push(r.data);
  }
  return out;
}

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
/** The admin's Claude key before FD-AIKEYS: moved to the admin's own keys at start-up (`AiService.migrateLegacy`). */
export const LEGACY_CLAUDE_KEY = 'claude_key';
const RESEND_KEY = 'resend_key';
const RESEND_FROM = 'resend_from';
/** Resend's test sender: works without a verified domain, delivers only to the Resend account's own address. */
export const RESEND_DEV_FROM = 'onboarding@resend.dev';
/** Mail that reaches only the Resend account's owner: no key, or Resend's test sender ("Sentiq <onboarding@resend.dev>" too). */
/** What an AI key looks like before it is sent to its provider to be checked (FD-AIKEYS). */
const AI_KEY_RE = /^[\x21-\x7e]{20,300}$/;
export function checkAiKeyShape(key: string): void {
  if (!AI_KEY_RE.test(key)) throw new ValidationError('Cheia API nu pare validă (20–300 de caractere, fără spații)');
}

export const isDevMail = (r: { apiKey: string | null; from: string }) => !r.apiKey || /(^|<)onboarding@resend\.dev>?$/i.test(r.from.trim());

/** Settings each user has for themselves (FD-USERS §2); the rest are global and only the admin changes them. */
export const USER_KEYS = ['timezone', 'market', 'scanner', 'calendar', 'indicator', 'lma', 'charts', 'ai', 'studies', 'studyFavorites', 'studyMemory', 'orderTicket', 'stockNews', 'chartLines', 'hlineTemplate'] as const;
type UserKey = (typeof USER_KEYS)[number];
const isUserKey = (k: string): k is UserKey => (USER_KEYS as readonly string[]).includes(k);

/** A user tried to change a global setting (403). */
export class SettingsForbiddenError extends Error {
  readonly statusCode = 403;
  readonly code = 'FORBIDDEN';
}
/** The Twelve Data key before FD-TDKEYS (everyone's): moved to the admin's own keys at start-up. */
const LEGACY_TWELVEDATA_KEY = 'twelvedata_key';
/** A user's Twelve Data key in `user_keys`. */
const TWELVEDATA = 'twelvedata';
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
      else if (key === 'studies') out.studies = salvageStudies(stored.studies);
      else if (key === 'studyFavorites') out.studyFavorites = salvageFavorites(stored.studyFavorites);
      else if (key === 'studyMemory') out.studyMemory = salvageStudyMemory(stored.studyMemory);
      else if (key === 'orderTicket') out.orderTicket = salvageOrderTicket(stored.orderTicket);
      else if (key === 'chartLines') out.chartLines = salvageChartLines(stored.chartLines, CHART_SYMBOL_RE);
    }
    return out as Settings;
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

  /**
   * What the API returns: secrets only as "set" flags with a hint; the user's own keys (AI, Twelve Data: FD-AIKEYS,
   * FD-TDKEYS) for them alone; the mail settings (everyone's) only for the admin.
   */
  async viewFor(userId: number, isAdmin: boolean): Promise<SettingsView> {
    const [resend, own, aiKeys, td] = await Promise.all([isAdmin ? this.getResend() : null, this.forUser(userId), this.aiKeyViews(userId), this.getTwelveDataKey(userId)]);
    return {
      ...own,
      aiKeys,
      // The user's own Twelve Data key (FD-TDKEYS): its hint for them alone.
      twelveDataKeySet: td !== null,
      twelveDataKeyHint: td ? secretHint(td) : null,
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

  // ── Each user's own keys: AI providers (FD-AIKEYS), Twelve Data (FD-TDKEYS) ──────────────────────────

  /** The user's keys by name, decrypted (a key that no longer decrypts counts as absent). */
  private async userKeys(userId: number): Promise<Map<string, string>> {
    const rows = await this.db.all<{ name: string; secret: string }>('SELECT name, secret FROM user_keys WHERE user_id = ?', [userId]);
    const out = new Map<string, string>();
    for (const r of rows) {
      try {
        out.set(r.name, this.box.decrypt(r.secret));
      } catch {
        // a key saved under another master key: as if none
      }
    }
    return out;
  }

  /** Saves (encrypted) or, with null / empty, removes one of the user's keys; its shape is the caller's to check. */
  private async setUserKey(userId: number, name: string, key: string): Promise<void> {
    if (!key) {
      await this.db.run('DELETE FROM user_keys WHERE user_id = ? AND name = ?', [userId, name]);
      return;
    }
    await this.db.run(
      'UPDATE user_keys SET secret = @s, updated_at = @t WHERE user_id = @u AND name = @n; IF @@ROWCOUNT = 0 INSERT INTO user_keys(user_id, name, secret, updated_at) VALUES (@u, @n, @s, @t)',
      { u: userId, n: name, s: this.box.encrypt(key), t: this.now() },
    );
  }

  /** The enabled users who have a key of this name. */
  async usersWithKey(name: string): Promise<number[]> {
    return (
      await this.db.all<{ id: number }>('SELECT u.id FROM users u JOIN user_keys k ON k.user_id = u.id WHERE k.name = ? AND u.disabled_at IS NULL ORDER BY u.id', [name])
    ).map((r) => r.id);
  }

  /** The user's AI keys. */
  async getAiKeys(userId: number): Promise<Partial<Record<AiProvider, string>>> {
    const keys = await this.userKeys(userId);
    return Object.fromEntries(AI_PROVIDERS.filter((p) => keys.has(p)).map((p) => [p, keys.get(p)])) as Partial<Record<AiProvider, string>>;
  }

  async aiKeyViews(userId: number): Promise<Record<AiProvider, AiKeyView>> {
    const keys = await this.getAiKeys(userId);
    return Object.fromEntries(AI_PROVIDERS.map((p) => [p, { set: keys[p] !== undefined, hint: keys[p] ? secretHint(keys[p]) : null }])) as Record<AiProvider, AiKeyView>;
  }

  /** Saves or, with null / empty, removes a user's key of one AI provider; checked only for its shape here. */
  async setAiKey(userId: number, provider: AiProvider, key: string | null): Promise<void> {
    const k = (key ?? '').trim();
    if (k) checkAiKeyShape(k);
    await this.setUserKey(userId, provider, k);
  }

  /** The user's Twelve Data key (FD-TDKEYS), or null. */
  async getTwelveDataKey(userId: number): Promise<string | null> {
    return (await this.userKeys(userId)).get(TWELVEDATA) ?? null;
  }

  /** Saves or, with null / empty, removes the user's Twelve Data key; checked only for its shape here. */
  async setTwelveDataKey(userId: number, key: string | null): Promise<void> {
    const k = (key ?? '').trim();
    if (k && !TWELVEDATA_KEY_RE.test(k)) throw new ValidationError(TWELVEDATA_KEY_INVALID);
    await this.setUserKey(userId, TWELVEDATA, k);
  }

  /**
   * Run once at start-up (FD-TDKEYS §4): the Twelve Data key, until now everyone's, becomes the admin's own, with its
   * plan and the day's credits. Nothing to do once the global key is gone. True when it moved it.
   */
  async migrateTwelveData(adminId: number): Promise<boolean> {
    return this.db.tx(async () => {
      const row = await this.db.get<{ value: string }>('SELECT value FROM settings WHERE [key] = ?', [LEGACY_TWELVEDATA_KEY]);
      if (!row) return false;
      await this.db.run(
        `IF NOT EXISTS (SELECT 1 FROM user_keys WHERE user_id = @u AND name = @n) INSERT INTO user_keys(user_id, name, secret, updated_at) VALUES (@u, @n, @s, @t)`,
        { u: adminId, n: TWELVEDATA, s: row.value, t: this.now() },
      );
      // The plan read for it and the credits it used today are the admin's now.
      for (const [from, to] of [
        [tdPlanKey(), tdPlanKey(String(adminId))],
        [tdUsageKey(), tdUsageKey(String(adminId))],
      ] as const) {
        await this.db.run(
          'IF NOT EXISTS (SELECT 1 FROM market_cache WHERE [key] = @to) UPDATE market_cache SET [key] = @to WHERE [key] = @from; DELETE FROM market_cache WHERE [key] = @from',
          { from, to },
        );
      }
      await this.db.run('DELETE FROM settings WHERE [key] = ?', [LEGACY_TWELVEDATA_KEY]);
      return true;
    });
  }
}
