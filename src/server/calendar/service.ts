// Calendar persistence, fetch policies (FF ≤ 1/h, rate-limit backoff; TV every 15 min + bursts) and queries.
import { z } from 'zod';
import type { Db } from '../db/database.ts';
import { BIN } from '../db/schema.ts';
import { readJobData, writeJobData } from '../jobs/scheduler.ts';
import type { Logger } from '../log.ts';
import { cleanCompanyName, type EarningsRow } from '../market/stocks.ts';
import { formatIssues, ValidationError } from '../settings.ts';
import { addDays, dayBounds, dayKey, zonedTimeToUtc } from '../../shared/time.ts';
import { explain } from './glossary.ts';
import { ffWeekRange, mergeCalendar, type CalendarEvent } from './merge.ts';
import { fetchForexFactory, fetchTradingView, RateLimitedError, type CalImpact, type RawEvent, type TvEarnings } from './sources.ts';

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

/** Where an earnings event's date and numbers come from (FD-EARNTV): Nasdaq unless TradingView is named. */
export interface EarningsFrom {
  /** The date is the one TradingView says the company confirmed. */
  date?: 'tv';
  /** The EPS expected is TradingView's (Nasdaq has not got the results that day). */
  numbers?: 'tv';
}

/** Nasdaq's earnings row → calendar event: before the open at 08:00 ET, after the close at 16:30 ET, else all day. */
export function earningsEvent(day: string, r: EarningsRow, from: EarningsFrom = {}): RawEvent {
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
    // pre / after / unknown, for the note; the quarter after the bar ("Sep/2026"); where the date and the numbers come
    // from (FD-EARNTV; events stored before it have only the first two).
    period: `${r.time}|${r.quarter ?? ''}|${from.date ?? ''}|${from.numbers ?? ''}`,
  };
}

/** A Nasdaq report no closer than this after the last one TradingView knows of can be the next quarter's. */
export const EARN_STALE_DAYS = 45;
const daysBetween = (a: string, b: string) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY;

/** TradingView's EPS: „$0.13”, „-$0.09”, as Nasdaq writes it (rounded first: never „-$0.00”). */
export function formatEps(eps: number | null): string | null {
  if (eps === null) return null;
  const cents = Math.round(eps * 100);
  return `${cents < 0 ? '-' : ''}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

/**
 * One day's earnings events of the watchlist stocks (FD-EARNTV §1), from Nasdaq's rows of that day and what TradingView
 * says of each stock: a date the company confirmed wins over Nasdaq's (an estimate that did not follow), and a Nasdaq
 * date shortly after a publication is a stale estimate; with no confirmed date, or no word from TradingView, Nasdaq's.
 */
export function planEarnings(day: string, rows: EarningsRow[], wanted: ReadonlySet<string>, tv: ReadonlyMap<string, TvEarnings>): RawEvent[] {
  const out: RawEvent[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (!wanted.has(r.symbol) || seen.has(r.symbol)) continue;
    seen.add(r.symbol);
    const t = tv.get(r.symbol);
    const confirmedHere = t?.next?.confirmed === true && t.next.day === day;
    if (t && !confirmedHere) {
      if (t.next?.confirmed && day !== t.lastDay) continue;
      if (t.lastDay && day > t.lastDay && daysBetween(t.lastDay, day) < EARN_STALE_DAYS) continue;
    }
    if (!confirmedHere || !t?.next) {
      out.push(earningsEvent(day, r));
      continue;
    }
    const time = t.next.time !== 'unknown' ? t.next.time : r.time;
    out.push(earningsEvent(day, { ...r, time }, { date: 'tv' }));
  }
  // Confirmed for this day by TradingView alone (Nasdaq still has an older estimate, or none).
  for (const symbol of wanted) {
    const next = tv.get(symbol)?.next;
    if (seen.has(symbol) || !next?.confirmed || next.day !== day) continue;
    out.push(
      earningsEvent(
        day,
        { symbol, name: symbol, time: next.time, quarter: next.quarter, epsForecast: formatEps(next.eps), lastYearEps: null },
        { date: 'tv', numbers: 'tv' },
      ),
    );
  }
  return out;
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

  ffState(): Promise<FfState> {
    return readJobData<FfState>(this.db, FF_JOB, { lastOk: 0, blockedUntil: 0, weeks: [] });
  }

  /**
   * The events of `source` inside `range` become `events`. An event already stored under the same id (moved in time,
   * so outside the range) is replaced, as SQLite's INSERT OR REPLACE did; within `events` the last one of an id wins.
   */
  private async replace(source: RawEvent['source'], range: { start: number; end: number }, events: RawEvent[], now: number): Promise<void> {
    const rows = new Map<string, Record<string, unknown>>();
    for (const e of events) {
      if (e.ts < range.start || e.ts >= range.end) continue;
      rows.set(`${e.source}\u0000${e.extId}`, {
        source: e.source,
        ext_id: String(e.extId),
        title: e.title,
        currency: e.currency,
        country: e.country,
        ts: e.ts,
        all_day: e.allDay ? 1 : 0,
        impact: e.impact,
        forecast: e.forecast,
        previous: e.previous,
        actual: e.actual,
        unit: e.unit,
        scale: e.scale,
        period: e.period,
        fetched_at: now,
      });
    }
    const json = JSON.stringify([...rows.values()]);
    await this.db.tx(async () => {
      await this.db.run('DELETE FROM calendar_raw WHERE source = ? AND ts >= ? AND ts < ?', [source, range.start, range.end]);
      if (!rows.size) return;
      await this.db.run(
        `DELETE c FROM calendar_raw c JOIN OPENJSON(?) WITH (source nvarchar(16), ext_id nvarchar(200)) j ON c.source = j.source COLLATE ${BIN} AND c.ext_id = j.ext_id COLLATE ${BIN}`,
        [json],
      );
      await this.db.run(
        `INSERT INTO calendar_raw(source, ext_id, title, currency, country, ts, all_day, impact, forecast, previous, actual, unit, scale, period, fetched_at)
         SELECT source, ext_id, title, currency, country, ts, all_day, impact, forecast, previous, actual, unit, scale, period, fetched_at
         FROM OPENJSON(?) WITH (source nvarchar(16), ext_id nvarchar(200), title nvarchar(max), currency nvarchar(max), country nvarchar(max), ts bigint, all_day int,
           impact nvarchar(max), forecast nvarchar(max), previous nvarchar(max), actual nvarchar(max), unit nvarchar(max), scale nvarchar(max), period nvarchar(max), fetched_at bigint)`,
        [json],
      );
    });
  }

  /** Downloads ForexFactory if allowed (≤ 1/h, not blocked). Returns the number of stored events or null when skipped. */
  async refreshForexFactory(now = Date.now(), fetcher: () => Promise<RawEvent[]> = fetchForexFactory): Promise<number | null> {
    const st = await this.ffState();
    if (now < st.blockedUntil || now - st.lastOk < FF_MIN_INTERVAL_MS) return null;
    let events: RawEvent[];
    try {
      events = await fetcher();
    } catch (err) {
      if (err instanceof RateLimitedError) {
        await writeJobData(this.db, FF_JOB, { ...st, blockedUntil: now + FF_BLOCK_MS });
        this.log.warn(`ForexFactory rate limited, pausing until ${new Date(now + FF_BLOCK_MS).toISOString()}`);
      }
      throw err;
    }
    if (events.length === 0) {
      await writeJobData(this.db, FF_JOB, { ...st, lastOk: now });
      return 0;
    }
    const minTs = Math.min(...events.map((e) => e.ts));
    const range = ffWeekRange(minTs);
    await this.replace('ff', range, events, now);
    const weeks = [...st.weeks.filter((w) => w.start !== range.start), range].sort((a, b) => a.start - b.start).slice(-MAX_FF_WEEKS);
    await writeJobData(this.db, FF_JOB, { lastOk: now, blockedUntil: 0, weeks });
    return events.length;
  }

  async refreshTradingView(now = Date.now(), fetcher: (from: number, to: number) => Promise<RawEvent[]> = fetchTradingView): Promise<number> {
    const from = now - 7 * DAY;
    const to = now + 14 * DAY;
    const events = await fetcher(from, to);
    // Three weeks without a single event means a broken answer, not an empty calendar: keep what we have.
    if (events.length === 0) return 0;
    await this.replace('tv', { start: from, end: to }, events, now);
    return events.length;
  }

  /** High/Medium events of the last 15 minutes still waiting for an actual value (drive the "burst" refreshes). */
  async awaitingActual(now = Date.now()): Promise<number> {
    const r = await this.db.get<{ n: number }>(
      `SELECT count(*) AS n FROM calendar_raw WHERE source = N'tv' AND actual IS NULL AND forecast IS NOT NULL
       AND impact IN (N'High', N'Medium') AND ts <= ? AND ts >= ?`,
      [now, now - 15 * 60_000],
    );
    return r?.n ?? 0;
  }

  /**
   * Earnings of the watchlist stocks for the next weekdays, from Nasdaq. Each day is replaced only when its
   * request succeeded; a stock that left the watchlist loses its future events. Returns the stored events.
   */
  async refreshEarnings(
    symbols: string[],
    fetchDay: (day: string) => Promise<EarningsRow[]>,
    now = Date.now(),
    fetchTv?: (symbols: string[]) => Promise<Map<string, TvEarnings>>,
  ): Promise<number> {
    const wanted = new Set(symbols);
    const today = dayBounds(dayKey(now, NY), NY).start;
    if (wanted.size === 0) {
      await this.db.run("DELETE FROM calendar_raw WHERE source = N'earn' AND ts >= ?", [today]);
      return 0;
    }
    // FD-EARNTV: the dates the companies confirmed; without them, Nasdaq's alone, as before.
    let tv = new Map<string, TvEarnings>();
    if (fetchTv) {
      try {
        tv = await fetchTv([...wanted]);
      } catch (err) {
        this.log.warn(`earnings: TradingView unavailable, Nasdaq's dates only (${(err as Error).message})`);
      }
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
      const events = planEarnings(day, rows, wanted, tv);
      await this.replace('earn', dayBounds(day, NY), events, now);
      stored += events.length;
    }
    // Days not looked at any more (e.g. after a long pause) keep their events; symbols removed from the watchlist do not.
    // The symbol is what precedes ':' in the id ('' without one, as SQLite's substr gave; LEFT refuses a negative length).
    await this.db.run(
      `DELETE FROM calendar_raw WHERE source = N'earn' AND ts >= ?
         AND LEFT(ext_id, CASE WHEN CHARINDEX(':', ext_id) > 0 THEN CHARINDEX(':', ext_id) - 1 ELSE 0 END) NOT IN (SELECT value COLLATE ${BIN} FROM OPENJSON(?))`,
      [today, JSON.stringify([...wanted])],
    );
    if (errors.length === EARN_DAYS) throw new Error(`Nasdaq earnings: ${errors[0]}`);
    if (errors.length) this.log.warn(`earnings: ${errors.length} days failed (${errors[0]})`);
    return stored;
  }

  /** Next High-impact event start time after `now` (for burst scheduling). */
  async nextImportant(now = Date.now()): Promise<number | null> {
    const r = await this.db.get<{ ts: number | null }>(
      "SELECT min(ts) AS ts FROM calendar_raw WHERE source IN (N'ff', N'tv') AND impact IN (N'High', N'Medium') AND all_day = 0 AND ts > ?",
      [now],
    );
    return r?.ts ?? null;
  }

  async query(q: CalendarQuery): Promise<CalendarEvent[]> {
    const rows = (await this.db.all<RawRow>('SELECT * FROM calendar_raw WHERE ts >= ? AND ts < ? ORDER BY ts, source, ext_id', [q.from - DAY, q.to + DAY])).map(toRaw);
    const merged = mergeCalendar({
      ff: rows.filter((r) => r.source === 'ff'),
      tv: rows.filter((r) => r.source === 'tv'),
      ffCoverage: (await this.ffState()).weeks,
    });
    const stocks = new Map(
      (await this.db.all<{ coin: string; name: string | null }>("SELECT coin, name FROM watchlist WHERE kind = N'stock' AND user_id = ? ORDER BY position, coin", [q.userId])).map((w) => [
        w.coin,
        w.name,
      ]),
    );
    const earnings =
      q.earnings === false
        ? []
        : rows
            .filter((r) => r.source === 'earn' && stocks.has(r.extId.slice(0, r.extId.indexOf(':'))))
            .map((r): CalendarEvent => {
              const sym = r.extId.slice(0, r.extId.indexOf(':'));
              const [when = 'unknown', quarter = '', dateFrom = '', numbersFrom = ''] = (r.period ?? '').split('|');
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
                note: `${who} își publică rezultatele ${quarter ? `trimestrului încheiat în ${quarterRo(quarter)} ` : ''}${EARN_WHEN[when] ?? EARN_WHEN.unknown}.${dateFrom === 'tv' ? ' Data e confirmată (TradingView).' : ''} ${
                  numbersFrom === 'tv'
                    ? 'Prognoza este EPS-ul estimat de analiști (TradingView); Nasdaq nu are încă rezultatele în calendar.'
                    : 'Prognoza este EPS-ul estimat de analiști, iar Anterior este EPS-ul din același trimestru de anul trecut (Nasdaq).'
                }`,
              };
            });
    const custom = (
      await this.db.all<{ id: number; title: string; ts: number; all_day: number; impact: CalImpact; currency: string; note: string }>(
        'SELECT id, title, ts, all_day, impact, currency, note FROM calendar_custom WHERE user_id = ? AND ts >= ? AND ts < ? ORDER BY ts, id',
        [q.userId, q.from, q.to],
      )
    ).map(
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

  async addCustom(userId: number, input: unknown): Promise<number> {
    const r = customEventSchema.safeParse(input);
    if (!r.success) throw new ValidationError(`Eveniment invalid: ${formatIssues(r.error.issues)}`, r.error.issues);
    const e = r.data;
    // Counted and added in one transaction: two saves at once never pass the limit.
    return this.db.tx(async () => {
      if (((await this.db.get<{ n: number }>('SELECT count(*) AS n FROM calendar_custom WHERE user_id = ?', [userId]))?.n ?? 0) >= MAX_CUSTOM_EVENTS) {
        throw new ValidationError(`Poți avea cel mult ${MAX_CUSTOM_EVENTS} evenimente proprii; șterge din cele vechi.`);
      }
      return (
        await this.db.run('INSERT INTO calendar_custom(user_id, title, ts, all_day, impact, currency, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
          userId,
          e.title,
          e.ts,
          e.allDay ? 1 : 0,
          e.impact,
          e.currency,
          e.note,
          Date.now(),
        ])
      ).lastInsertRowid;
    });
  }

  /** Only the owner's own event (anybody else's id is "not found"). */
  async deleteCustom(userId: number, id: number): Promise<boolean> {
    return (await this.db.run('DELETE FROM calendar_custom WHERE id = ? AND user_id = ?', [id, userId])).changes > 0;
  }

  async lastUpdate(): Promise<{ ff: number | null; tv: number | null; earn: number | null }> {
    const r = await this.db.all<{ source: string; t: number | null }>('SELECT source, max(fetched_at) AS t FROM calendar_raw GROUP BY source');
    const at = (s: string) => r.find((x) => x.source === s)?.t ?? null;
    return { ff: at('ff'), tv: at('tv'), earn: at('earn') };
  }
}
