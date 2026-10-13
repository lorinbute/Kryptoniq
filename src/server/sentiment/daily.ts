// Loads news for a day, computes the index and keeps per-(day, tz) snapshots (final once the day is over).
import { addDays, dayBounds, dayKey } from '../../shared/time.ts';
import type { Db } from '../db/database.ts';
import { readJobData, writeJobData } from '../jobs/scheduler.ts';
import type { SettingsService } from '../settings.ts';
import { MAX_ITEM_AGE_MS } from '../news/normalize.ts';
import { computeIndex, DEFAULT_INDEX_PARAMS, intradaySeries, type Driver, type IndexItem, type IndexResult } from './daily-index.ts';

export const MAX_FINALIZE_DAYS = 120;
/**
 * Version of the way the index weighs news. A higher one than the history was built with recomputes it once
 * (`upgradeHistory`). 2 = FD-IMPACT: Claude's importance, geopolitics at 0.8.
 */
export const INDEX_VERSION = 2;
export const DAILY_JOB = 'sentiment.daily';
/** Job data of the maintenance job: the latest retention threshold applied (news older than it are gone). */
export const MAINTENANCE_JOB = 'maintenance';
/** A day is frozen only after this grace period (late feeds) and once none of its news is still being scored. */
export const FINALIZE_GRACE_MS = 2 * 3_600_000;

export interface DaySentiment extends IndexResult {
  day: string;
  tz: string;
  asOf: number;
  final: boolean;
  intraday: { t: number; index: number; count: number }[];
}

export interface HistoryPoint {
  day: string;
  index: number;
  confidence: string;
  count: number;
  final: boolean;
}

interface NewsRow {
  id: string;
  title: string;
  url: string | null;
  source_id: string;
  source_name: string;
  source_weight: number;
  category: IndexItem['category'];
  published_at: number;
  relevance: number;
  impact: number;
  flags: string;
  cluster_id: string;
  sentiment: number | null;
}

function parseFlags(s: string): string[] {
  try {
    const v = JSON.parse(s) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export class DailySentimentService {
  private readonly db: Db;
  private readonly settings: SettingsService;
  /** `${tz}|${day}` of elapsed days without news, old enough that none can still arrive (feed items > 3 days are rejected). */
  private readonly emptyDays = new Set<string>();

  constructor(db: Db, settings: SettingsService) {
    this.db = db;
    this.settings = settings;
  }

  loadItems(start: number, end: number): IndexItem[] {
    const rows = this.db.all<NewsRow>(
      `SELECT n.id, n.title, n.url, n.source_id, s.name AS source_name, s.weight AS source_weight, n.category, n.published_at,
              n.relevance, COALESCE(n.sentiment_impact, n.impact) AS impact, n.flags, n.cluster_id, n.sentiment
       FROM news n JOIN sources s ON s.id = n.source_id
       WHERE s.enabled = 1 AND n.published_at >= ? AND n.published_at < ?`,
      [start, end],
    );
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      url: r.url,
      sourceId: r.source_id,
      sourceName: r.source_name,
      sourceWeight: r.source_weight,
      category: r.category,
      publishedAt: r.published_at,
      relevance: r.relevance,
      impact: r.impact,
      flags: parseFlags(r.flags),
      clusterId: r.cluster_id,
      sentiment: r.sentiment,
    }));
  }

  computeDay(day: string, tz: string, now: number, withIntraday = true): DaySentiment {
    const window = dayBounds(day, tz);
    const asOf = Math.min(now, window.end);
    const items = this.loadItems(window.start, window.end);
    const res = computeIndex(items, window, asOf, DEFAULT_INDEX_PARAMS);
    this.attachCoins([...res.drivers.positive, ...res.drivers.negative]);
    return {
      ...res,
      day,
      tz,
      asOf,
      final: now >= window.end,
      intraday: withIntraday ? intradaySeries(items, window, asOf, DEFAULT_INDEX_PARAMS) : [],
    };
  }

  /** Coins of the (at most ten) drivers, for their icon: one query instead of loading coins for every item. */
  private attachCoins(drivers: Driver[]): void {
    if (drivers.length === 0) return;
    const rows = this.db.all<{ news_id: string; coin: string }>(
      `SELECT news_id, coin FROM news_coins WHERE news_id IN (${drivers.map(() => '?').join(',')}) ORDER BY coin`,
      drivers.map((d) => d.id),
    );
    for (const d of drivers) d.coins = rows.filter((r) => r.news_id === d.id).map((r) => r.coin);
  }

  /** Today in `tz` (every user sees the day of their own time zone, FD-USERS §2). */
  today(tz: string, now = Date.now()): DaySentiment {
    const day = dayKey(now, tz);
    const res = this.computeDay(day, tz, now);
    this.save(res, false);
    return res;
  }

  private save(r: DaySentiment, final: boolean): void {
    const count = r.counts.positive + r.counts.neutral + r.counts.negative;
    this.db.run(
      `INSERT INTO daily_sentiment(day, tz, value, raw, confidence, counts, breakdown, drivers, computed_at, final)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(day, tz) DO UPDATE SET value = excluded.value, raw = excluded.raw, confidence = excluded.confidence,
         counts = excluded.counts, breakdown = excluded.breakdown, drivers = excluded.drivers,
         computed_at = excluded.computed_at, final = excluded.final
       WHERE daily_sentiment.final = 0 OR excluded.final = 1`,
      [r.day, r.tz, r.index, r.raw, r.confidence, JSON.stringify({ ...r.counts, total: count }), JSON.stringify(r.breakdown), JSON.stringify(r.drivers), Date.now(), final ? 1 : 0],
    );
  }

  /** `refreshZone` for every time zone in use; the days frozen, without repeats. */
  refresh(now = Date.now()): { finalized: string[] } {
    const finalized = new Set<string>();
    for (const tz of this.settings.timezones()) for (const d of this.refreshZone(tz, now).finalized) finalized.add(d);
    return { finalized: [...finalized].sort() };
  }

  /**
   * Recomputes today and freezes every elapsed day that has news but no final snapshot yet — after the
   * grace period and once its news are all scored (days older than 3 days are frozen regardless).
   */
  refreshZone(tz: string, now = Date.now()): { today: DaySentiment; finalized: string[] } {
    const todayKey = dayKey(now, tz);
    const finalized: string[] = [];
    // Days before Sentiq started collecting only hold the few items the feeds still carried (backlog):
    // they would enter the history as if complete, so history starts on the first collection day.
    const span = this.db.get<{ t: number | null; f: number | null }>('SELECT min(published_at) AS t, min(fetched_at) AS f FROM news');
    const oldest = span?.t ?? null;
    if (oldest !== null && span?.f !== null && span?.f !== undefined) {
      let day = dayKey(Math.max(oldest, span.f), tz);
      const floor = addDays(todayKey, -MAX_FINALIZE_DAYS);
      if (day < floor) day = floor;
      const finals = new Set(this.db.all<{ day: string }>('SELECT day FROM daily_sentiment WHERE tz = ? AND final = 1', [tz]).map((r) => r.day));
      const settledBefore = addDays(dayKey(now - MAX_ITEM_AGE_MS, tz), -1);
      for (; day < todayKey; day = addDays(day, 1)) {
        if (finals.has(day) || this.emptyDays.has(`${tz}|${day}`)) continue;
        const r = this.computeDay(day, tz, now, false);
        if (r.counts.positive + r.counts.neutral + r.counts.negative === 0 && r.counts.pending === 0) {
          if (day < settledBefore) this.emptyDays.add(`${tz}|${day}`);
          continue;
        }
        const settled = day < settledBefore;
        const ready = now >= dayBounds(day, tz).end + FINALIZE_GRACE_MS && r.counts.pending === 0;
        if (!ready && !settled) {
          this.save(r, false); // provisional: still visible in the history, recomputed on the next refresh
          continue;
        }
        this.save(r, true);
        finalized.push(day);
      }
    }
    return { today: this.today(tz, now), finalized };
  }

  history(days: number, tz: string, now = Date.now()): HistoryPoint[] {
    const todayKey = dayKey(now, tz);
    const from = addDays(todayKey, -(days - 1));
    return this.db
      .all<{ day: string; value: number; confidence: string; counts: string; final: number }>(
        'SELECT day, value, confidence, counts, final FROM daily_sentiment WHERE tz = ? AND day >= ? AND day <= ? ORDER BY day',
        [tz, from, todayKey],
      )
      .map((r) => {
        let count = 0;
        try {
          count = (JSON.parse(r.counts) as { total?: number }).total ?? 0;
        } catch {
          count = 0;
        }
        return { day: r.day, index: r.value, confidence: r.confidence, count, final: r.final === 1 };
      });
  }

  /**
   * Rebuilds the snapshots from the stored news (the admin's tool, and `upgradeHistory`), in every time zone in use
   * or with snapshots.
   * Days the retention has already thinned out keep the value they had: their news are partly gone, so a new
   * computation would be wrong (FD-IMPACT §3).
   */
  recomputeHistory(now = Date.now()): string[] {
    const { retentionCutoff } = readJobData(this.db, MAINTENANCE_JOB, { retentionCutoff: 0 });
    // Also the zones nobody uses now: whoever picks one again gets days computed the current way (refresh rebuilds
    // the missing ones), never an older weighing next to a newer one.
    const stored = this.db.all<{ tz: string }>('SELECT DISTINCT tz FROM daily_sentiment').map((r) => r.tz);
    for (const tz of new Set([...this.settings.timezones(), ...stored])) {
      // The day holding the threshold lost its earlier news: the first complete day is the next one.
      const from = retentionCutoff > 0 ? addDays(dayKey(retentionCutoff, tz), 1) : '';
      this.db.run('DELETE FROM daily_sentiment WHERE tz = ? AND day >= ?', [tz, from]);
    }
    this.emptyDays.clear();
    return this.refresh(now).finalized;
  }

  /** Recomputes the history once after the weighing changed (INDEX_VERSION); true when it did. */
  upgradeHistory(now = Date.now()): boolean {
    const state = readJobData(this.db, DAILY_JOB, { indexVersion: 1 });
    if (state.indexVersion >= INDEX_VERSION) return false;
    this.recomputeHistory(now);
    writeJobData(this.db, DAILY_JOB, { ...state, indexVersion: INDEX_VERSION });
    return true;
  }
}
