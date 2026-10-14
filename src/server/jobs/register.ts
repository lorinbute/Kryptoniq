// Background jobs (TD §4).
import { readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { refreshContext } from '../market/context.ts';
import type { AppContext } from '../context.ts';
import { retagRecent } from '../news/ingest.ts';
import { fetchDueSources } from '../news/fetcher.ts';
import { EARN_JOB, FF_JOB, TV_JOB } from '../calendar/service.ts';
import { ECON_JOB, feedingEconomy } from '../economy/service.ts';
import { refreshStockContext } from '../market/stock-context.ts';
import { syncStockSources } from '../news/sources.ts';
import { readJobData, writeJobData } from './scheduler.ts';
import { MAINTENANCE_JOB } from '../sentiment/daily.ts';
import { TD_PLAN_JOB } from '../market/stocks.ts';

const MIN = 60_000;
const LOG_RETENTION_DAYS = 30;

/** Deletes daily log files (sentiq-YYYY-MM-DD.log, or kryptoniq-… from before the rename) older than `before`. */
export function pruneLogs(dir: string, before: number): number {
  let removed = 0;
  let files: string[] = [];
  try {
    files = readdirSync(dir);
  } catch {
    return 0;
  }
  for (const f of files) {
    const m = /^(?:sentiq|kryptoniq)-(\d{4}-\d{2}-\d{2})\.log$/.exec(f);
    if (m && Date.parse(`${m[1]}T00:00:00Z`) < before) {
      try {
        rmSync(path.join(dir, f));
        removed++;
      } catch {
        // ignore files we cannot delete
      }
    }
  }
  return removed;
}

export function registerJobs(ctx: AppContext): void {
  const { scheduler, db, log } = ctx;

  scheduler.add({
    name: 'news.fetch',
    everyMs: MIN,
    runOnStart: true,
    timeoutMs: 4 * MIN,
    run: async (signal) => {
      const results = await fetchDueSources(db, ctx.coins, log, signal);
      if (results.some((r) => r.inserted > 0)) scheduler.nudge('sentiment.score', 1000);
    },
  });

  scheduler.add({
    name: 'sentiment.score',
    everyMs: 20_000,
    runOnStart: true,
    timeoutMs: 10 * MIN,
    run: async (signal) => {
      // Drain the queue in batches while the job is allowed to run.
      for (let i = 0; i < 20 && !signal.aborted; i++) {
        const n = await ctx.sentiment.scorePending(signal);
        if (n === 0) break;
      }
    },
  });

  scheduler.add({
    name: 'sentiment.daily',
    everyMs: 2 * MIN,
    runOnStart: true,
    run: async () => {
      // Once after an update that changes how news weigh (FD-IMPACT §3); then the regular refresh.
      if (await ctx.daily.upgradeHistory()) log.info('sentiment: daily history recomputed with the new weighing');
      await ctx.daily.refresh();
    },
  });

  scheduler.add({
    name: FF_JOB,
    everyMs: 15 * MIN,
    runOnStart: true,
    run: async () => {
      await ctx.calendar.refreshForexFactory();
    },
  });

  scheduler.add({
    name: TV_JOB,
    everyMs: 15 * MIN,
    runOnStart: true,
    run: async () => {
      // The same answer keeps the Economy page's values fresh (FD-ECON §3): no request of its own.
      await ctx.calendar.refreshTradingView(Date.now(), feedingEconomy(ctx.economy, log));
      // Bursts: poll again shortly after important releases until their actual values arrive.
      const now = Date.now();
      if ((await ctx.calendar.awaitingActual(now)) > 0) {
        scheduler.nudge(TV_JOB, 2 * MIN);
        return;
      }
      const next = await ctx.calendar.nextImportant(now);
      if (next !== null && next - now < 15 * MIN) scheduler.nudge(TV_JOB, Math.max(MIN, next - now + MIN));
    },
  });

  scheduler.add({
    name: 'market.context',
    everyMs: 60 * MIN,
    runOnStart: true,
    run: async () => {
      const r = await refreshContext(db);
      if (r.coinListUpdated) {
        ctx.coins.invalidate();
        await retagRecent(db, await ctx.coins.get(), Date.now() - 3 * 86_400_000, await ctx.coins.classifier());
      }
      if (r.errors.length) throw new Error(r.errors.join('; '));
    },
  });

  // FD-TDPLAN: the Twelve Data key's plan (limits a minute and a day), at start and every 6 hours; one credit a read.
  scheduler.add({
    name: TD_PLAN_JOB,
    everyMs: 6 * 60 * MIN,
    firstDelayMs: 20_000,
    run: async () => {
      const p = await ctx.stocks.refreshPlan();
      if (p) log.info(`twelvedata: plan ${p.category}, ${p.perMinute} credits a minute, ${p.perDay === null ? 'no daily limit' : `${p.perDay} a day`}`);
    },
  });

  // FD-SENTIQ §4.5: quarterly results of the watchlist stocks (nothing to do without stocks).
  scheduler.add({
    name: EARN_JOB,
    everyMs: 6 * 60 * MIN,
    firstDelayMs: 30_000,
    run: async () => {
      // Every user's stocks, once (FD-USERS §2): each user then sees only the results of their own.
      const symbols = (await db.all<{ coin: string }>("SELECT DISTINCT coin FROM watchlist WHERE kind = N'stock' ORDER BY coin")).map((r) => r.coin);
      await ctx.calendar.refreshEarnings(symbols, (day) => ctx.stocks.nasdaq.earnings(day));
    },
  });

  // FD-ECON §3: ~400 days of indicator history once, then the release schedule beyond the Calendar's two weeks.
  scheduler.add({
    name: ECON_JOB,
    everyMs: 24 * 60 * MIN,
    firstDelayMs: 30_000,
    timeoutMs: 15 * MIN,
    run: async (signal) => {
      const read = await ctx.economy.backfill(undefined, signal);
      if (read.length) log.info(`economy: history read for ${read.join(', ')}`);
      if (!signal.aborted) await ctx.economy.refreshSchedule();
    },
  });

  // FD-SENTIQ §4.2: US market state, S&P 500 / Nasdaq 100 / VIX and CNN's Fear & Greed.
  scheduler.add({
    name: 'stocks.market',
    everyMs: 5 * MIN,
    runOnStart: true,
    run: async () => {
      const errors = await refreshStockContext(db, ctx.stocks);
      if (errors.length) throw new Error(errors.join('; '));
    },
  });

  scheduler.add({
    name: 'scanner',
    everyMs: 5 * MIN,
    firstDelayMs: 20_000,
    timeoutMs: 4 * MIN,
    run: async (signal) => {
      await ctx.scanner.run(signal);
    },
  });

  scheduler.add({
    name: 'maintenance',
    everyMs: 24 * 60 * MIN,
    firstDelayMs: 10 * MIN,
    run: async () => {
      const days = (await ctx.settings.get()).retentionDays;
      const cutoff = Date.now() - days * 86_400_000;
      const removed = (await db.run('DELETE FROM news WHERE published_at < ?', [cutoff])).changes;
      // Days before this threshold are no longer complete: a history recomputation keeps them (FD-IMPACT §3).
      const prev = await readJobData(db, MAINTENANCE_JOB, { retentionCutoff: 0 });
      if (cutoff > prev.retentionCutoff) await writeJobData(db, MAINTENANCE_JOB, { ...prev, retentionCutoff: cutoff });
      await db.run('DELETE FROM calendar_raw WHERE ts < ?', [Date.now() - 400 * 86_400_000]);
      await db.run('UPDATE sources SET item_count = (SELECT count(*) FROM news WHERE source_id = sources.id)');
      // FD-USERS / FD-INVITE: sign-ins that ended, and account requests nobody answered within 30 days.
      await ctx.sessions.purgeExpired();
      const purged = await ctx.users.purgeOldRequests();
      if (purged) log.info(`users: removed ${purged} account requests nobody answered`);
      // Feeds of stocks nobody follows any more (another instance's change, FD-AUTOFEED).
      for (const sym of await syncStockSources(db)) log.info(`news: removed the automatic feed of ${sym} (in nobody's favourites)`);
      await ctx.economy.prune();
      pruneLogs(path.join(ctx.config.dataDir, 'logs'), Date.now() - LOG_RETENTION_DAYS * 86_400_000);
      if (removed) log.info(`retention: removed ${removed} news older than ${days} days`);
    },
  });
}
