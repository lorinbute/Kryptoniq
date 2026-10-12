// Calendar persistence, fetch policies (FF ≤ 1/h, rate-limit backoff; TV every 15 min + bursts) and queries.
import { z } from 'zod';
import type { Db } from '../db/database.ts';
import { readJobData, writeJobData } from '../jobs/scheduler.ts';
import type { Logger } from '../log.ts';
import { formatIssues, ValidationError } from '../settings.ts';
import { explain } from './glossary.ts';
import { ffWeekRange, mergeCalendar, type CalendarEvent } from './merge.ts';
import { fetchForexFactory, fetchTradingView, RateLimitedError, type CalImpact, type RawEvent } from './sources.ts';

export const FF_JOB = 'calendar.ff';
export const TV_JOB = 'calendar.tv';
export const FF_MIN_INTERVAL_MS = 60 * 60_000;
export const FF_BLOCK_MS = 60 * 60_000;
const DAY = 86_400_000;
const MAX_FF_WEEKS = 60;

interface FfState {
  lastOk: number;
  blockedUntil: number;
  weeks: { start: number; end: number }[];
}

interface RawRow {
  source: 'ff' | 'tv';
  ext_id: string;
  title: string;
  currency: string;
  country: string | null;
  ts: number;
  all_day: number;
  impact: CalImpact;
  forecast: string | null;
  previous: string | null;
  actual: string | null;
  unit: string | null;
  scale: string | null;
  period: string | null;
}

const toRaw = (r: RawRow): RawEvent => ({
  source: r.source,
  extId: r.ext_id,
  title: r.title,
  currency: r.currency,
  country: r.country,
  ts: r.ts,
  allDay: r.all_day === 1,
  impact: r.impact,
  forecast: r.forecast,
  previous: r.previous,
  actual: r.actual,
  unit: r.unit,
  scale: r.scale,
  period: r.period,
});

export const customEventSchema = z.object({
  title: z.string().trim().min(1).max(200),
  ts: z.number().int().positive(),
  allDay: z.boolean().default(false),
  impact: z.enum(['High', 'Medium', 'Low']).default('Medium'),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,10}$/).default('CRYPTO'),
  note: z.string().max(1000).default(''),
});

export interface CalendarQuery {
  from: number;
  to: number;
  impacts?: string[];
  currencies?: string[];
}

export class CalendarService {
  private readonly db: Db;
  private readonly log: Logger;

  constructor(db: Db, log: Logger) {
    this.db = db;
    this.log = log;
  }

  ffState(): FfState {
    return readJobData<FfState>(this.db, FF_JOB, { lastOk: 0, blockedUntil: 0, weeks: [] });
  }

  private replace(source: 'ff' | 'tv', range: { start: number; end: number }, events: RawEvent[], now: number): void {
    this.db.tx(() => {
      this.db.run('DELETE FROM calendar_raw WHERE source = ? AND ts >= ? AND ts < ?', [source, range.start, range.end]);
      for (const e of events) {
        if (e.ts < range.start || e.ts >= range.end) continue;
        this.db.run(
          `INSERT OR REPLACE INTO calendar_raw(source, ext_id, title, currency, country, ts, all_day, impact, forecast, previous, actual, unit, scale, period, fetched_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [e.source, e.extId, e.title, e.currency, e.country, e.ts, e.allDay ? 1 : 0, e.impact, e.forecast, e.previous, e.actual, e.unit, e.scale, e.period, now],
        );
      }
    });
  }

  /** Downloads ForexFactory if allowed (≤ 1/h, not blocked). Returns the number of stored events or null when skipped. */
  async refreshForexFactory(now = Date.now(), fetcher: () => Promise<RawEvent[]> = fetchForexFactory): Promise<number | null> {
    const st = this.ffState();
    if (now < st.blockedUntil || now - st.lastOk < FF_MIN_INTERVAL_MS) return null;
    let events: RawEvent[];
    try {
      events = await fetcher();
    } catch (err) {
      if (err instanceof RateLimitedError) {
        writeJobData(this.db, FF_JOB, { ...st, blockedUntil: now + FF_BLOCK_MS });
        this.log.warn(`ForexFactory rate limited, pausing until ${new Date(now + FF_BLOCK_MS).toISOString()}`);
      }
      throw err;
    }
    if (events.length === 0) {
      writeJobData(this.db, FF_JOB, { ...st, lastOk: now });
      return 0;
    }
    const minTs = Math.min(...events.map((e) => e.ts));
    const range = ffWeekRange(minTs);
    this.replace('ff', range, events, now);
    const weeks = [...st.weeks.filter((w) => w.start !== range.start), range].sort((a, b) => a.start - b.start).slice(-MAX_FF_WEEKS);
    writeJobData(this.db, FF_JOB, { lastOk: now, blockedUntil: 0, weeks });
    return events.length;
  }

  async refreshTradingView(now = Date.now(), fetcher: (from: number, to: number) => Promise<RawEvent[]> = fetchTradingView): Promise<number> {
    const from = now - 7 * DAY;
    const to = now + 14 * DAY;
    const events = await fetcher(from, to);
    // Three weeks without a single event means a broken answer, not an empty calendar: keep what we have.
    if (events.length === 0) return 0;
    this.replace('tv', { start: from, end: to }, events, now);
    return events.length;
  }

  /** High/Medium events of the last 15 minutes still waiting for an actual value (drive the "burst" refreshes). */
  awaitingActual(now = Date.now()): number {
    const r = this.db.get<{ n: number }>(
      `SELECT count(*) AS n FROM calendar_raw WHERE source = 'tv' AND actual IS NULL AND forecast IS NOT NULL
       AND impact IN ('High', 'Medium') AND ts <= ? AND ts >= ?`,
      [now, now - 15 * 60_000],
    );
    return r?.n ?? 0;
  }

  /** Next High-impact event start time after `now` (for burst scheduling). */
  nextImportant(now = Date.now()): number | null {
    const r = this.db.get<{ ts: number | null }>(
      "SELECT min(ts) AS ts FROM calendar_raw WHERE impact IN ('High', 'Medium') AND all_day = 0 AND ts > ?",
      [now],
    );
    return r?.ts ?? null;
  }

  query(q: CalendarQuery): CalendarEvent[] {
    const rows = this.db.all<RawRow>('SELECT * FROM calendar_raw WHERE ts >= ? AND ts < ?', [q.from - DAY, q.to + DAY]).map(toRaw);
    const merged = mergeCalendar({
      ff: rows.filter((r) => r.source === 'ff'),
      tv: rows.filter((r) => r.source === 'tv'),
      ffCoverage: this.ffState().weeks,
    });
    const custom = this.db
      .all<{ id: number; title: string; ts: number; all_day: number; impact: CalImpact; currency: string; note: string }>(
        'SELECT id, title, ts, all_day, impact, currency, note FROM calendar_custom WHERE ts >= ? AND ts < ?',
        [q.from, q.to],
      )
      .map(
        (c): CalendarEvent => ({
          id: `custom:${c.id}`,
          source: 'custom',
          title: c.title,
          currency: c.currency,
          ts: c.ts,
          allDay: c.all_day === 1,
          impact: c.impact,
          actual: null,
          forecast: null,
          previous: null,
          deviation: null,
          matched: false,
          note: c.note || null,
        }),
      );
    const impacts = q.impacts && q.impacts.length ? new Set(q.impacts) : null;
    const currencies = q.currencies && q.currencies.length ? new Set(q.currencies) : null;
    return [...merged, ...custom]
      .filter((e) => e.ts >= q.from && e.ts < q.to)
      .filter((e) => e.source === 'custom' || !impacts || impacts.has(e.impact))
      .filter((e) => e.source === 'custom' || !currencies || currencies.has(e.currency))
      .map((e) => ({ ...e, note: e.note ?? explain(e.title) }))
      .sort((a, b) => a.ts - b.ts || a.title.localeCompare(b.title));
  }

  addCustom(input: unknown): number {
    const r = customEventSchema.safeParse(input);
    if (!r.success) throw new ValidationError(`Eveniment invalid: ${formatIssues(r.error.issues)}`, r.error.issues);
    const e = r.data;
    return this.db.run('INSERT INTO calendar_custom(title, ts, all_day, impact, currency, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      e.title,
      e.ts,
      e.allDay ? 1 : 0,
      e.impact,
      e.currency,
      e.note,
      Date.now(),
    ]).lastInsertRowid;
  }

  deleteCustom(id: number): boolean {
    return this.db.run('DELETE FROM calendar_custom WHERE id = ?', [id]).changes > 0;
  }

  lastUpdate(): { ff: number | null; tv: number | null } {
    const r = this.db.all<{ source: string; t: number | null }>('SELECT source, max(fetched_at) AS t FROM calendar_raw GROUP BY source');
    return { ff: r.find((x) => x.source === 'ff')?.t ?? null, tv: r.find((x) => x.source === 'tv')?.t ?? null };
  }
}
