// Loads news for a day, computes the index and keeps per-(day, tz) snapshots (final once the day is over). The common
// index comes from the common (local) scores; since FD-AIKEYS a user whose own AI scores the news has their own index,
// from their AI's scores where it gave one and the common ones elsewhere, kept per (user, day, tz).
import { addDays, dayBounds, dayKey } from '../../shared/time.ts';
import type { Db } from '../db/database.ts';
import { readJobData, writeJobData } from '../jobs/scheduler.ts';
import type { SettingsService } from '../settings.ts';
import type { AiService } from '../ai/service.ts';
import { MAX_ITEM_AGE_MS } from '../news/normalize.ts';
import { computeIndex, DEFAULT_INDEX_PARAMS, intradaySeries, type Driver, type IndexItem, type IndexResult } from './daily-index.ts';
import { stockScopeSql, usersWithStockScope, type StockScope } from '../news/stock-scope.ts';

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

/**
 * Whose index: null = the common one; a user id = that user's: from their own AI's scores (FD-AIKEYS) and / or with their
 * stock news limited to indices (FD-INDEXNEWS), kept per user in `ai_daily_sentiment`.
 */
export type IndexScope = number | null;

export class DailySentimentService {
  private readonly db: Db;
  private readonly settings: SettingsService;
  private readonly ai: AiService | null;
  /** `${scope}|${tz}|${day}` of elapsed days without news, old enough that none can still arrive (feed items > 3 days are rejected). */
  private readonly emptyDays = new Set<string>();

  /** FD-INDEXNEWS: a user's stock news filter (null: all). */
  private readonly stockScopeOf: (userId: number) => Promise<StockScope | null>;

  constructor(db: Db, settings: SettingsService, ai: AiService | null = null, stockScopeOf: (userId: number) => Promise<StockScope | null> = async () => null) {
    this.db = db;
    this.settings = settings;
    this.ai = ai;
    this.stockScopeOf = stockScopeOf;
  }

  /** The index a user sees: their own when their AI scores the news or their stock news are limited, the common one otherwise. */
  async scopeFor(userId: number): Promise<IndexScope> {
    if (this.ai && (await this.ai.isScoring(userId))) return userId;
    return (await this.stockScopeOf(userId)) ? userId : null;
  }

  /**
   * After a change of the user's stock news filter (FD-INDEXNEWS §3): their days still backed by stored news are dropped,
   * to be computed again (by `refreshZone`); older ones keep their value.
   */
  async resetUser(userId: number): Promise<void> {
    const { retentionCutoff } = await readJobData(this.db, MAINTENANCE_JOB, { retentionCutoff: 0 });
    const tz = (await this.settings.forUser(userId)).timezone;
    const from = retentionCutoff > 0 ? addDays(dayKey(retentionCutoff, tz), 1) : '';
    await this.db.run('DELETE FROM ai_daily_sentiment WHERE user_id = ? AND day >= ?', [userId, from]);
    for (const k of [...this.emptyDays]) if (k.startsWith(`${userId}|`)) this.emptyDays.delete(k);
  }

  async loadItems(start: number, end: number, scope: IndexScope = null): Promise<IndexItem[]> {
    // A user's AI score (and importance) where it gave one, the common one elsewhere; their stock news filter if any.
    const stock = scope === null ? null : await this.stockScopeOf(scope);
    const filter = stock ? stockScopeSql(stock) : null;
    const rows = await this.db.all<NewsRow>(
      scope === null
        ? `SELECT n.id, n.title, n.url, n.source_id, s.name AS source_name, s.weight AS source_weight, n.category, n.published_at,
                  n.relevance, COALESCE(n.sentiment_impact, n.impact) AS impact, n.flags, n.cluster_id, n.sentiment
           FROM news n JOIN sources s ON s.id = n.source_id
           WHERE s.enabled = 1 AND n.published_at >= ? AND n.published_at < ?
           ORDER BY n.published_at, n.id`
        : `SELECT n.id, n.title, n.url, n.source_id, s.name AS source_name, s.weight AS source_weight, n.category, n.published_at,
                  n.relevance, COALESCE(a.impact, n.sentiment_impact, n.impact) AS impact, n.flags, n.cluster_id, COALESCE(a.score, n.sentiment) AS sentiment
           FROM news n JOIN sources s ON s.id = n.source_id
           LEFT JOIN news_ai_scores a ON a.news_id = n.id AND a.user_id = ?
           WHERE s.enabled = 1 AND n.published_at >= ? AND n.published_at < ?${filter ? ` AND ${filter.sql}` : ''}
           ORDER BY n.published_at, n.id`,
      scope === null ? [start, end] : [scope, start, end, ...(filter ? [filter.param] : [])],
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

  async computeDay(day: string, tz: string, now: number, withIntraday = true, scope: IndexScope = null): Promise<DaySentiment> {
    const window = dayBounds(day, tz);
    const asOf = Math.min(now, window.end);
    const items = await this.loadItems(window.start, window.end, scope);
    const res = computeIndex(items, window, asOf, DEFAULT_INDEX_PARAMS);
    await this.attachCoins([...res.drivers.positive, ...res.drivers.negative]);
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
  private async attachCoins(drivers: Driver[]): Promise<void> {
    if (drivers.length === 0) return;
    const rows = await this.db.all<{ news_id: string; coin: string }>(
      `SELECT news_id, coin FROM news_coins WHERE news_id IN (${drivers.map(() => '?').join(',')}) AND coin NOT LIKE N'#%' ORDER BY coin`,
      drivers.map((d) => d.id),
    );
    for (const d of drivers) d.coins = rows.filter((r) => r.news_id === d.id).map((r) => r.coin);
  }

  /** Today in `tz` (every user sees the day of their own time zone, FD-USERS §2), in the common index or a user's. */
  async today(tz: string, now = Date.now(), scope: IndexScope = null): Promise<DaySentiment> {
    const day = dayKey(now, tz);
    const res = await this.computeDay(day, tz, now, true, scope);
    await this.save(res, false, scope);
    return res;
  }

  /** A frozen (final) day is never overwritten by a provisional one. */
  private async save(r: DaySentiment, final: boolean, scope: IndexScope = null): Promise<void> {
    const count = r.counts.positive + r.counts.neutral + r.counts.negative;
    // The common index and a user's: the same columns, the user's rows also keyed by the user.
    const [table, who, whoCol, whoVal] = scope === null ? ['daily_sentiment', '', '', ''] : ['ai_daily_sentiment', 'user_id = @u AND ', 'user_id, ', '@u, '];
    await this.db.run(
      `UPDATE ${table} SET value = @value, raw = @raw, confidence = @confidence, counts = @counts, breakdown = @breakdown, drivers = @drivers,
         computed_at = @computed_at, final = @final
       WHERE ${who}day = @day AND tz = @tz AND (final = 0 OR @final = 1);
       IF @@ROWCOUNT = 0 AND NOT EXISTS (SELECT 1 FROM ${table} WHERE ${who}day = @day AND tz = @tz)
         INSERT INTO ${table}(${whoCol}day, tz, value, raw, confidence, counts, breakdown, drivers, computed_at, final)
         VALUES (${whoVal}@day, @tz, @value, @raw, @confidence, @counts, @breakdown, @drivers, @computed_at, @final)`,
      {
        ...(scope === null ? {} : { u: scope }),
        day: r.day,
        tz: r.tz,
        value: r.index,
        raw: r.raw,
        confidence: r.confidence,
        counts: JSON.stringify({ ...r.counts, total: count }),
        breakdown: JSON.stringify(r.breakdown),
        drivers: JSON.stringify(r.drivers),
        computed_at: Date.now(),
        final: final ? 1 : 0,
      },
    );
  }

  /**
   * `refreshZone` for every time zone in use (the common index), then for each user whose own AI scores the news (their
   * index, in their time zone); the common days frozen, without repeats.
   */
  async refresh(now = Date.now()): Promise<{ finalized: string[] }> {
    const finalized = new Set<string>();
    for (const tz of await this.settings.timezones()) for (const d of (await this.refreshZone(tz, now)).finalized) finalized.add(d);
    const own = new Set([...(this.ai ? await this.ai.scoringUsers() : []), ...(await usersWithStockScope(this.db))]);
    for (const userId of own) {
      await this.refreshZone((await this.settings.forUser(userId)).timezone, now, userId);
    }
    return { finalized: [...finalized].sort() };
  }

  /**
   * Recomputes today and freezes every elapsed day that has news but no final snapshot yet — after the
   * grace period and once its news are all scored (days older than 3 days are frozen regardless).
   */
  async refreshZone(tz: string, now = Date.now(), scope: IndexScope = null): Promise<{ today: DaySentiment; finalized: string[] }> {
    const todayKey = dayKey(now, tz);
    const finalized: string[] = [];
    // Days before Sentiq started collecting only hold the few items the feeds still carried (backlog):
    // they would enter the history as if complete, so history starts on the first collection day. A user's own index
    // starts on the first day their AI scored: before it, theirs would be the common one again.
    // A user whose index differs only by the stock news filter (no AI of their own) starts with the common one.
    const aiOwn = scope !== null && this.ai !== null && (await this.ai.isScoring(scope));
    const span =
      !aiOwn
        ? await this.db.get<{ t: number | null; f: number | null }>('SELECT min(published_at) AS t, min(fetched_at) AS f FROM news')
        : await this.db.get<{ t: number | null; f: number | null }>(
            'SELECT min(n.published_at) AS t, min(n.fetched_at) AS f FROM news_ai_scores a JOIN news n ON n.id = a.news_id WHERE a.user_id = ?',
            [scope],
          );
    const oldest = span?.t ?? null;
    if (oldest !== null && span?.f !== null && span?.f !== undefined) {
      let day = dayKey(Math.max(oldest, span.f), tz);
      const floor = addDays(todayKey, -MAX_FINALIZE_DAYS);
      if (day < floor) day = floor;
      if (scope !== null) {
        // A user's own index is new: the day the retention already thinned out is not computed (FD-IMPACT §3).
        const { retentionCutoff } = await readJobData(this.db, MAINTENANCE_JOB, { retentionCutoff: 0 });
        const complete = retentionCutoff > 0 ? addDays(dayKey(retentionCutoff, tz), 1) : '';
        if (day < complete) day = complete;
      }
      const finals = new Set(
        (scope === null
          ? await this.db.all<{ day: string }>('SELECT day FROM daily_sentiment WHERE tz = ? AND final = 1', [tz])
          : await this.db.all<{ day: string }>('SELECT day FROM ai_daily_sentiment WHERE user_id = ? AND tz = ? AND final = 1', [scope, tz])
        ).map((r) => r.day),
      );
      const settledBefore = addDays(dayKey(now - MAX_ITEM_AGE_MS, tz), -1);
      for (; day < todayKey; day = addDays(day, 1)) {
        const empty = `${scope ?? ''}|${tz}|${day}`;
        if (finals.has(day) || this.emptyDays.has(empty)) continue;
        const r = await this.computeDay(day, tz, now, false, scope);
        if (r.counts.positive + r.counts.neutral + r.counts.negative === 0 && r.counts.pending === 0) {
          if (day < settledBefore) this.emptyDays.add(empty);
          continue;
        }
        const settled = day < settledBefore;
        const ready = now >= dayBounds(day, tz).end + FINALIZE_GRACE_MS && r.counts.pending === 0;
        if (!ready && !settled) {
          await this.save(r, false, scope); // provisional: still visible in the history, recomputed on the next refresh
          continue;
        }
        await this.save(r, true, scope);
        if (scope === null) finalized.push(day);
      }
    }
    return { today: await this.today(tz, now, scope), finalized };
  }

  /** The days of the common index, or of a user's own where they have one (the common one fills the days before). */
  async history(days: number, tz: string, now = Date.now(), scope: IndexScope = null): Promise<HistoryPoint[]> {
    const todayKey = dayKey(now, tz);
    const from = addDays(todayKey, -(days - 1));
    type Row = { day: string; value: number; confidence: string; counts: string; final: number };
    const point = (r: Row): HistoryPoint => {
      let count = 0;
      try {
        count = (JSON.parse(r.counts) as { total?: number }).total ?? 0;
      } catch {
        count = 0;
      }
      return { day: r.day, index: r.value, confidence: r.confidence, count, final: r.final === 1 };
    };
    const common = await this.db.all<Row>('SELECT day, value, confidence, counts, final FROM daily_sentiment WHERE tz = ? AND day >= ? AND day <= ? ORDER BY day', [tz, from, todayKey]);
    if (scope === null) return common.map(point);
    const own = await this.db.all<Row>(
      'SELECT day, value, confidence, counts, final FROM ai_daily_sentiment WHERE user_id = ? AND tz = ? AND day >= ? AND day <= ? ORDER BY day',
      [scope, tz, from, todayKey],
    );
    const byDay = new Map(common.map((r) => [r.day, point(r)]));
    for (const r of own) byDay.set(r.day, point(r));
    return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
  }

  /**
   * Rebuilds the snapshots from the stored news (the admin's tool, and `upgradeHistory`), in every time zone in use
   * or with snapshots.
   * Days the retention has already thinned out keep the value they had: their news are partly gone, so a new
   * computation would be wrong (FD-IMPACT §3).
   */
  async recomputeHistory(now = Date.now()): Promise<string[]> {
    const { retentionCutoff } = await readJobData(this.db, MAINTENANCE_JOB, { retentionCutoff: 0 });
    // Also the zones nobody uses now: whoever picks one again gets days computed the current way (refresh rebuilds
    // the missing ones), never an older weighing next to a newer one.
    const stored = (await this.db.all<{ tz: string }>('SELECT DISTINCT tz FROM daily_sentiment UNION SELECT DISTINCT tz FROM ai_daily_sentiment')).map((r) => r.tz);
    for (const tz of new Set([...(await this.settings.timezones()), ...stored])) {
      // The day holding the threshold lost its earlier news: the first complete day is the next one.
      const from = retentionCutoff > 0 ? addDays(dayKey(retentionCutoff, tz), 1) : '';
      await this.db.run('DELETE FROM daily_sentiment WHERE tz = ? AND day >= ?', [tz, from]);
      await this.db.run('DELETE FROM ai_daily_sentiment WHERE tz = ? AND day >= ?', [tz, from]);
    }
    this.emptyDays.clear();
    return (await this.refresh(now)).finalized;
  }

  /** Recomputes the history once after the weighing changed (INDEX_VERSION); true when it did. */
  async upgradeHistory(now = Date.now()): Promise<boolean> {
    const state = await readJobData(this.db, DAILY_JOB, { indexVersion: 1 });
    if (state.indexVersion >= INDEX_VERSION) return false;
    await this.recomputeHistory(now);
    await writeJobData(this.db, DAILY_JOB, { ...state, indexVersion: INDEX_VERSION });
    return true;
  }
}
