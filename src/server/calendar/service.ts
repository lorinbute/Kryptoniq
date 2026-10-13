// Calendar persistence, fetch policies (FF ≤ 1/h, rate-limit backoff; TV every 15 min + bursts) and queries.
import { z } from 'zod';
import type { Db } from '../db/database.ts';
import { readJobData, writeJobData } from '../jobs/scheduler.ts';
import type { Logger } from '../log.ts';
import { cleanCompanyName, type EarningsRow } from '../market/stocks.ts';
import { formatIssues, ValidationError } from '../settings.ts';
import { addDays, dayBounds, dayKey, zonedTimeToUtc } from '../../shared/time.ts';
import { explain } from './glossary.ts';
import { ffWeekRange, mergeCalendar, type CalendarEvent } from './merge.ts';
import { fetchForexFactory, fetchTradingView, RateLimitedError, type CalImpact, type RawEvent } from './sources.ts';

export const FF_JOB = 'calendar.ff';
export const TV_JOB = 'calendar.tv';
export const EARN_JOB = 'calendar.earnings';
/** Custom events per user: a person adds a few; the cap keeps one account from filling the database. */
export const MAX_CUSTOM_EVENTS = 1000;
/** Weekdays of earnings looked up ahead (one Nasdaq request each). */
export const EARN_DAYS = 10;
const NY = 'America/New_York';
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
  source: 'ff' | 'tv' | 'earn';
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
  /** Whose custom events and whose watchlist stocks (FD-USERS §2). */
  userId: number;
  from: number;
  to: number;
  impacts?: string[];
  currencies?: string[];
  /** Quarterly results of the watchlist stocks; on unless false. */
  earnings?: boolean;
}

/** Next `n` weekdays in New York, starting today (YYYY-MM-DD). */
export function earningsDays(now: number, n = EARN_DAYS): string[] {
  const out: string[] = [];
  for (let d = dayKey(now, NY); out.length < n; d = addDays(d, 1)) {
    const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d);
  }
  return out;
}

/** Nasdaq's earnings row → calendar event: before the open at 08:00 ET, after the close at 16:30 ET, else all day. */
export function earningsEvent(day: string, r: EarningsRow): RawEvent {
  const allDay = r.time === 'unknown';
  return {
    source: 'earn',
    extId: `${r.symbol}:${day}`,
    title: `${r.symbol}: rezultate trimestriale`,
    currency: 'USD',
    country: 'US',
    ts: r.time === 'pre' ? zonedTimeToUtc(day, NY, 8, 0) : r.time === 'after' ? zonedTimeToUtc(day, NY, 16, 30) : zonedTimeToUtc(day, NY),
    allDay,
    impact: 'High',
    forecast: r.epsForecast,
    previous: r.lastYearEps,
    actual: null,
    unit: null,
    scale: null,
    // pre / after / unknown, for the note; the quarter after the bar ("Sep/2026").
    period: `${r.time}|${r.quarter ?? ''}`,
  };
}

const MONTH_RO: Record<string, string> = {
  Jan: 'ianuarie', Feb: 'februarie', Mar: 'martie', Apr: 'aprilie', May: 'mai', Jun: 'iunie',
  Jul: 'iulie', Aug: 'august', Sep: 'septembrie', Oct: 'octombrie', Nov: 'noiembrie', Dec: 'decembrie',
};
/** Nasdaq's "Sep/2026" → "septembrie 2026". */
export const quarterRo = (q: string) => q.replace(/^(\w{3})\/(\d{4})$/, (m, mon: string, y: string) => (MONTH_RO[mon] ? `${MONTH_RO[mon]} ${y}` : m));

const EARN_WHEN: Record<string, string> = {
  pre: 'înainte de deschiderea bursei (în jur de 08:00, ora New York-ului)',
  after: 'după închiderea bursei (în jur de 16:30, ora New York-ului)',
  unknown: 'în cursul zilei (compania nu a anunțat ora)',
};

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

  private replace(source: RawEvent['source'], range: { start: number; end: number }, events: RawEvent[], now: number): void {
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

  /**
   * Earnings of the watchlist stocks for the next weekdays, from Nasdaq. Each day is replaced only when its
   * request succeeded; a stock that left the watchlist loses its future events. Returns the stored events.
   */
  async refreshEarnings(symbols: string[], fetchDay: (day: string) => Promise<EarningsRow[]>, now = Date.now()): Promise<number> {
    const wanted = new Set(symbols);
    const today = dayBounds(dayKey(now, NY), NY).start;
    if (wanted.size === 0) {
      this.db.run("DELETE FROM calendar_raw WHERE source = 'earn' AND ts >= ?", [today]);
      return 0;
    }
    let stored = 0;
    const errors: string[] = [];
    for (const day of earningsDays(now)) {
      let rows: EarningsRow[];
      try {
        rows = await fetchDay(day);
      } catch (err) {
        errors.push(`${day}: ${(err as Error).message}`);
        continue;
      }
      const events = rows.filter((r) => wanted.has(r.symbol)).map((r) => earningsEvent(day, r));
      this.replace('earn', dayBounds(day, NY), events, now);
      stored += events.length;
    }
    // Days not looked at any more (e.g. after a long pause) keep their events; symbols removed from the watchlist do not.
    const placeholders = [...wanted].map(() => '?').join(',');
    this.db.run(`DELETE FROM calendar_raw WHERE source = 'earn' AND ts >= ? AND substr(ext_id, 1, instr(ext_id, ':') - 1) NOT IN (${placeholders})`, [today, ...wanted]);
    if (errors.length === EARN_DAYS) throw new Error(`Nasdaq earnings: ${errors[0]}`);
    if (errors.length) this.log.warn(`earnings: ${errors.length} days failed (${errors[0]})`);
    return stored;
  }

  /** Next High-impact event start time after `now` (for burst scheduling). */
  nextImportant(now = Date.now()): number | null {
    const r = this.db.get<{ ts: number | null }>(
      "SELECT min(ts) AS ts FROM calendar_raw WHERE source IN ('ff', 'tv') AND impact IN ('High', 'Medium') AND all_day = 0 AND ts > ?",
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
    const stocks = new Map(
      this.db.all<{ coin: string; name: string | null }>("SELECT coin, name FROM watchlist WHERE kind = 'stock' AND user_id = ?", [q.userId]).map((w) => [w.coin, w.name]),
    );
    const earnings =
      q.earnings === false
        ? []
        : rows
            .filter((r) => r.source === 'earn' && stocks.has(r.extId.slice(0, r.extId.indexOf(':'))))
            .map((r): CalendarEvent => {
              const sym = r.extId.slice(0, r.extId.indexOf(':'));
              const [when = 'unknown', quarter = ''] = (r.period ?? '').split('|');
              const name = stocks.get(sym);
              const who = name ? cleanCompanyName(name) || sym : sym;
              return {
                id: `earn:${r.extId}`,
                source: 'earn',
                title: `Rezultate trimestriale ${who}`,
                currency: sym,
                ts: r.ts,
                allDay: r.allDay,
                impact: r.impact,
                actual: null,
                forecast: r.forecast,
                previous: r.previous,
                deviation: null,
                matched: false,
                note: `${who} își publică rezultatele ${quarter ? `trimestrului încheiat în ${quarterRo(quarter)} ` : ''}${EARN_WHEN[when] ?? EARN_WHEN.unknown}. Prognoza este EPS-ul estimat de analiști, iar Anterior este EPS-ul din același trimestru de anul trecut (Nasdaq).`,
              };
            });
    const custom = this.db
      .all<{ id: number; title: string; ts: number; all_day: number; impact: CalImpact; currency: string; note: string }>(
        'SELECT id, title, ts, all_day, impact, currency, note FROM calendar_custom WHERE user_id = ? AND ts >= ? AND ts < ?',
        [q.userId, q.from, q.to],
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
    return [...merged, ...custom, ...earnings]
      .filter((e) => e.ts >= q.from && e.ts < q.to)
      .filter((e) => e.source === 'custom' || !impacts || impacts.has(e.impact))
      // Earnings have their own switch, not a currency.
      .filter((e) => e.source === 'custom' || e.source === 'earn' || !currencies || currencies.has(e.currency))
      .map((e) => ({ ...e, note: e.note ?? explain(e.title) }))
      .sort((a, b) => a.ts - b.ts || a.title.localeCompare(b.title));
  }

  addCustom(userId: number, input: unknown): number {
    const r = customEventSchema.safeParse(input);
    if (!r.success) throw new ValidationError(`Eveniment invalid: ${formatIssues(r.error.issues)}`, r.error.issues);
    const e = r.data;
    if ((this.db.get<{ n: number }>('SELECT count(*) AS n FROM calendar_custom WHERE user_id = ?', [userId])?.n ?? 0) >= MAX_CUSTOM_EVENTS) {
      throw new ValidationError(`Poți avea cel mult ${MAX_CUSTOM_EVENTS} evenimente proprii; șterge din cele vechi.`);
    }
    return this.db.run('INSERT INTO calendar_custom(user_id, title, ts, all_day, impact, currency, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
      userId,
      e.title,
      e.ts,
      e.allDay ? 1 : 0,
      e.impact,
      e.currency,
      e.note,
      Date.now(),
    ]).lastInsertRowid;
  }

  /** Only the owner's own event (anybody else's id is "not found"). */
  deleteCustom(userId: number, id: number): boolean {
    return this.db.run('DELETE FROM calendar_custom WHERE id = ? AND user_id = ?', [id, userId]).changes > 0;
  }

  lastUpdate(): { ff: number | null; tv: number | null; earn: number | null } {
    const r = this.db.all<{ source: string; t: number | null }>('SELECT source, max(fetched_at) AS t FROM calendar_raw GROUP BY source');
    const at = (s: string) => r.find((x) => x.source === s)?.t ?? null;
    return { ff: at('ff'), tv: at('tv'), earn: at('earn') };
  }
}
