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
    return { ...this.get(), claudeKeySet: Boolean(claude), claudeKeyHint: hint };
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

  setClaudeKey(key: string | null): void {
    if (key === null || key.trim() === '') {
      this.db.run('DELETE FROM settings WHERE key = ?', [CLAUDE_KEY]);
      return;
    }
    const k = key.trim();
    if (k.length < 20 || k.length > 300 || /\s/.test(k)) throw new ValidationError('Cheia API Anthropic nu pare validă');
    this.db.run('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [CLAUDE_KEY, this.box.encrypt(k)]);
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
