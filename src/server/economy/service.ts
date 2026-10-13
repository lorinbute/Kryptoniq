// Economic indicators by country (FD-ECON, TD-ECON §2–§5), from the TradingView calendar: the Calendar's own reads
// keep the latest values fresh; this service adds ~400 days of history once and the release schedule daily.
import { explain } from '../calendar/glossary.ts';
import { fetchTradingView, TV_COUNTRIES, type RawEvent } from '../calendar/sources.ts';
import type { Db } from '../db/database.ts';
import { readJobData, writeJobData } from '../jobs/scheduler.ts';
import type { Logger } from '../log.ts';
import { ECON_COUNTRIES, ECON_SOURCE_COUNTRIES, ESSENTIAL, EU_MEMBERS, groupOf, polarityOf, RO_EXPLAIN, RO_NAMES, type EconGroup, type Polarity } from './names.ts';

export const ECON_JOB = 'econ.history';
/** The source answers at most this many events per request: a full answer may be cut, so the range is split. */
export const TV_CAP = 2000;
const DAY = 86_400_000;
export const HISTORY_DAYS = 400;
/** The schedule is read this far ahead (the source publishes ~5 weeks). */
export const SCHEDULE_DAYS = 60;
export const KEEP_MS = 730 * DAY;
const VIEW_TTL_MS = 60_000;
/** Placeholders of the source, not indicators. */
const NOT_INDICATORS = new Set(['calendar', 'holidays']);

export type EconFetcher = (from: number, to: number, countries: readonly string[]) => Promise<RawEvent[]>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Events of [from, to] for `countries`; a range whose answer reaches the source's cap is read again in halves. */
export async function fetchEconRange(from: number, to: number, countries: readonly string[], fetcher: EconFetcher = fetchTradingView, pauseMs = 500): Promise<RawEvent[]> {
  const events = await fetcher(from, to, countries);
  if (events.length < TV_CAP || to - from <= DAY) return events;
  const mid = from + Math.floor((to - from) / 2);
  const first = await fetchEconRange(from, mid, countries, fetcher, pauseMs);
  if (pauseMs > 0) await sleep(pauseMs);
  const second = await fetchEconRange(mid, to, countries, fetcher, pauseMs);
  // An event right at the boundary can come back in both halves.
  const seen = new Set<string>();
  return [...first, ...second].filter((e) => (seen.has(e.extId) ? false : (seen.add(e.extId), true)));
}

/**
 * The Calendar's TradingView reader, also feeding the Economy page with the same answer (FD-ECON §3: fresh values
 * without requests of its own). A failure on the Economy side never fails the Calendar.
 */
export function feedingEconomy(economy: EconomyService, log: Logger, fetcher: (from: number, to: number) => Promise<RawEvent[]> = (from, to) => fetchTradingView(from, to)) {
  return async (from: number, to: number): Promise<RawEvent[]> => {
    const events = await fetcher(from, to);
    try {
      economy.ingest(events, { from, to, countries: TV_COUNTRIES });
    } catch (err) {
      log.warn(`economy: ${(err as Error).message}`);
    }
    return events;
  };
}

/** The indicator an event belongs to: the source's ticker, or "country:name" for the few without one. */
export function indicatorKey(e: RawEvent): string | null {
  const name = e.tv?.indicator;
  if (!e.tv || !name || !e.country || NOT_INDICATORS.has(name.toLowerCase())) return null;
  return e.tv.ticker || `${e.country.toUpperCase()}:${name.toLowerCase()}`;
}

export interface EconRelease {
  value: number;
  period: string | null;
  ts: number;
  forecast: number | null;
}

export interface EconIndicator {
  key: string;
  /** Country of the data (a member state inside the euro-area group). */
  country: string;
  countryName: string | null;
  group: EconGroup;
  /** Romanian name when known, else the source's. */
  name: string;
  original: string;
  unit: string | null;
  scale: string | null;
  important: boolean;
  /** 1 = a rise is good for the economy, -1 = bad, 0 = neither (FD-ECONCOLOR). */
  polarity: Polarity;
  latest: EconRelease;
  /** The previous period's value, as revised in the latest release. */
  previous: number | null;
  change: number | null;
  next: { ts: number; forecast: number | null; overdue: boolean } | null;
  /** [period, value], oldest first (tuples: ~650 indicators × 13 periods make a sizeable answer). */
  history: [string | null, number][];
  source: string | null;
  sourceUrl: string | null;
  explanation: string | null;
  /** The source's description exists (in English; read with `description(key)`, kept out of the page's answer). */
  hasDescription: boolean;
}

export interface EconomyView {
  updatedAt: number | null;
  historyReady: boolean;
  countries: { code: string; name: string; indicators: EconIndicator[] }[];
}

interface IndicatorRow {
  key: string;
  country: string;
  name: string;
  category: string | null;
  unit: string | null;
  scale: string | null;
  importance: number;
  source: string | null;
  source_url: string | null;
  /** 1 when the source's description is stored (the text itself is read on demand). */
  has_comment: number;
}

interface ReleaseRow {
  id: string;
  key: string;
  ts: number;
  period: string | null;
  reference_date: number | null;
  actual: number | null;
  previous: number | null;
  forecast: number | null;
  fetched_at: number;
}

interface BackfillState {
  /** Countries whose history has been read (a failed one is retried at the next run). */
  done: string[];
}

export class EconomyService {
  private readonly db: Db;
  private readonly log: Logger;
  private cache: { at: number; view: EconomyView } | null = null;

  constructor(db: Db, log: Logger) {
    this.db = db;
    this.log = log;
  }

  /**
   * Stores the indicators and releases of `events`. With a range, unreleased releases of those countries inside it
   * that the answer no longer has (moved or cancelled) are removed, as the Calendar does with its events.
   */
  ingest(events: RawEvent[], range?: { from: number; to: number; countries: readonly string[] }, now = Date.now()): number {
    let stored = 0;
    const ids: string[] = [];
    this.db.tx(() => {
      for (const e of events) {
        const key = indicatorKey(e);
        if (!key || !e.tv) continue;
        const tv = e.tv;
        this.db.run(
          `INSERT INTO econ_indicators(key, country, name, category, unit, scale, currency, importance, source, source_url, comment, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET name = excluded.name, category = COALESCE(excluded.category, econ_indicators.category),
             unit = COALESCE(excluded.unit, econ_indicators.unit), scale = COALESCE(excluded.scale, econ_indicators.scale),
             currency = COALESCE(excluded.currency, econ_indicators.currency), importance = MAX(econ_indicators.importance, excluded.importance),
             source = COALESCE(excluded.source, econ_indicators.source), source_url = COALESCE(excluded.source_url, econ_indicators.source_url),
             comment = COALESCE(excluded.comment, econ_indicators.comment), updated_at = excluded.updated_at`,
          [key, (e.country ?? '').toUpperCase(), tv.indicator, tv.category, e.unit, e.scale, e.currency || null, tv.importance ?? -1, tv.source, tv.sourceUrl, tv.comment, now],
        );
        // A value the source stops sending (a glitch) is kept; a corrected one replaces it.
        this.db.run(
          `INSERT INTO econ_releases(id, key, ts, period, reference_date, actual, previous, forecast, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET key = excluded.key, ts = excluded.ts, period = excluded.period, reference_date = excluded.reference_date,
             actual = COALESCE(excluded.actual, econ_releases.actual), previous = COALESCE(excluded.previous, econ_releases.previous),
             forecast = COALESCE(excluded.forecast, econ_releases.forecast), fetched_at = excluded.fetched_at`,
          [e.extId, key, e.ts, e.period, tv.referenceDate, tv.actual, tv.previous, tv.forecast, now],
        );
        ids.push(e.extId);
        stored++;
      }
      // An empty answer is a broken one, not a calendar without events, and an answer at the source's cap may be cut
      // short: nothing is removed from either.
      if (range && events.length > 0 && events.length < TV_CAP) {
        const from = Math.max(range.from, now);
        const placeholders = range.countries.map(() => '?').join(',');
        this.db.run(
          `DELETE FROM econ_releases WHERE ts >= ? AND ts < ? AND actual IS NULL
             AND key IN (SELECT key FROM econ_indicators WHERE country IN (${placeholders}))
             AND id NOT IN (SELECT value FROM json_each(?))`,
          [from, range.to, ...range.countries.map((c) => c.toUpperCase()), JSON.stringify(ids)],
        );
      }
    });
    this.cache = null;
    return stored;
  }

  /** ~400 days of history, once per country (TD-ECON §3); returns the countries read now. */
  async backfill(fetcher: EconFetcher = fetchTradingView, signal?: AbortSignal, now = Date.now(), pauseMs = 1000): Promise<string[]> {
    const state = readJobData<BackfillState>(this.db, ECON_JOB, { done: [] });
    const done = new Set(state.done);
    const read: string[] = [];
    for (const c of ECON_SOURCE_COUNTRIES) {
      if (done.has(c) || signal?.aborted) continue;
      try {
        const events = await fetchEconRange(now - HISTORY_DAYS * DAY, now - 7 * DAY, [c], fetcher, pauseMs);
        this.ingest(events, undefined, now);
        done.add(c);
        read.push(c);
        writeJobData(this.db, ECON_JOB, { ...state, done: [...done] });
      } catch (err) {
        this.log.warn(`economy: history of ${c} not read (${(err as Error).message}); retried at the next run`);
      }
      if (pauseMs > 0) await sleep(pauseMs);
    }
    return read;
  }

  historyReady(): boolean {
    const done = new Set(readJobData<BackfillState>(this.db, ECON_JOB, { done: [] }).done);
    return ECON_SOURCE_COUNTRIES.every((c) => done.has(c));
  }

  /** The release schedule beyond the Calendar's two weeks (TD-ECON §3). */
  async refreshSchedule(fetcher: EconFetcher = fetchTradingView, now = Date.now()): Promise<number> {
    const from = now + 14 * DAY;
    const to = now + SCHEDULE_DAYS * DAY;
    const events = await fetchEconRange(from, to, ECON_SOURCE_COUNTRIES, fetcher);
    return this.ingest(events, { from, to, countries: ECON_SOURCE_COUNTRIES }, now);
  }

  /** Releases older than two years, and indicators left without any. */
  prune(now = Date.now()): number {
    const removed = this.db.run('DELETE FROM econ_releases WHERE ts < ?', [now - KEEP_MS]).changes;
    this.db.run('DELETE FROM econ_indicators WHERE key NOT IN (SELECT DISTINCT key FROM econ_releases)');
    if (removed) this.cache = null;
    return removed;
  }

  /** The source's description of an indicator (English), for the row the user opens. */
  description(key: string): string | null {
    return this.db.get<{ comment: string | null }>('SELECT comment FROM econ_indicators WHERE key = ?', [key])?.comment ?? null;
  }

  /** What the Economy page shows (TD-ECON §4); kept a minute. */
  view(now = Date.now()): EconomyView {
    if (this.cache && now - this.cache.at < VIEW_TTL_MS) return this.cache.view;
    const indicators = this.db.all<IndicatorRow>(
      'SELECT key, country, name, category, unit, scale, importance, source, source_url, comment IS NOT NULL AS has_comment FROM econ_indicators',
    );
    const releases = this.db.all<ReleaseRow>('SELECT id, key, ts, period, reference_date, actual, previous, forecast, fetched_at FROM econ_releases WHERE ts >= ? ORDER BY ts', [
      now - (HISTORY_DAYS + 60) * DAY,
    ]);
    const byKey = new Map<string, ReleaseRow[]>();
    let updatedAt: number | null = null;
    for (const r of releases) {
      (byKey.get(r.key) ?? byKey.set(r.key, []).get(r.key))!.push(r);
      if (updatedAt === null || r.fetched_at > updatedAt) updatedAt = r.fetched_at;
    }
    const build = (row: IndicatorRow, countryName: string | null): EconIndicator | null => {
      const list = byKey.get(row.key) ?? [];
      const published = list.filter((r) => r.actual !== null && r.ts <= now);
      const last = published.at(-1);
      if (!last) return null;
      const lower = row.name.toLowerCase();
      const upcoming = list.find((r) => r.ts > now) ?? null;
      // Its time has passed but no value yet: delayed, or not published yet by the source (FD-ECON §4).
      const overdue = list.find((r) => r.actual === null && r.ts <= now && r.ts > last.ts && now - r.ts <= DAY) ?? null;
      const nextRow = overdue ?? upcoming;
      return {
        key: row.key,
        country: row.country,
        countryName,
        group: groupOf(row.category, row.name),
        name: RO_NAMES[lower] ?? row.name,
        original: row.name,
        unit: row.unit,
        scale: row.scale,
        // A member state's indicator inside the euro-area group: essential only when the source says so.
        important: row.importance >= 1 || (countryName === null && ESSENTIAL.has(lower)),
        polarity: polarityOf(row.category, row.name),
        latest: { value: last.actual as number, period: last.period, ts: last.ts, forecast: last.forecast },
        previous: last.previous,
        change: last.previous !== null ? (last.actual as number) - last.previous : null,
        next: nextRow ? { ts: nextRow.ts, forecast: nextRow.forecast, overdue: nextRow === overdue } : null,
        history: historyOf(published),
        source: row.source,
        sourceUrl: row.source_url,
        explanation: RO_EXPLAIN[lower] ?? explain(row.name),
        hasDescription: row.has_comment === 1,
      };
    };
    const byCountry = new Map<string, IndicatorRow[]>();
    for (const row of indicators) (byCountry.get(row.country) ?? byCountry.set(row.country, []).get(row.country))!.push(row);
    const countries = ECON_COUNTRIES.map(({ code, name }) => {
      const own = (byCountry.get(code) ?? []).map((r) => build(r, null)).filter((x): x is EconIndicator => x !== null);
      let list = own;
      if (code === 'EU') {
        // A member state's indicator only where the euro area has none of the same name (FD-ECON §1).
        const euNames = new Set(own.map((i) => i.original.toLowerCase()));
        for (const [member, memberName] of Object.entries(EU_MEMBERS)) {
          for (const r of byCountry.get(member) ?? []) {
            // Low-importance national details (the CPI of each German Land…) stay out: the group is about the EU.
            if (euNames.has(r.name.toLowerCase()) || r.importance < 0) continue;
            const item = build(r, memberName);
            if (item) list.push(item);
          }
        }
        list = list.sort((a, b) => Number(a.countryName !== null) - Number(b.countryName !== null));
      }
      return { code, name, indicators: list };
    });
    const view: EconomyView = { updatedAt, historyReady: this.historyReady(), countries };
    this.cache = { at: now, view };
    return view;
  }
}

/**
 * The value of each period, as last published (a flash estimate is replaced by the final one), oldest first: 13
 * periods, 26 for weekly series.
 */
function historyOf(published: ReleaseRow[]): [string | null, number][] {
  const byPeriod = new Map<string, ReleaseRow>();
  for (const r of published) byPeriod.set(String(r.reference_date ?? r.period ?? r.ts), r);
  const rows = [...byPeriod.values()].sort((a, b) => (a.reference_date ?? a.ts) - (b.reference_date ?? b.ts));
  const gaps = rows.slice(1).map((r, i) => (r.reference_date ?? r.ts) - (rows[i]!.reference_date ?? rows[i]!.ts));
  const weekly = gaps.length > 2 && gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)]! < 10 * DAY;
  return rows.slice(-(weekly ? 26 : 13)).map((r) => [r.period, r.actual as number]);
}
