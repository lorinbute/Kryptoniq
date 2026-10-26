// Background jobs (TD §4).
import { readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { refreshContext } from '../market/context.ts';
import type { AppContext } from '../context.ts';
import { retagCoins, retagRecent, upgradeClassification } from '../news/ingest.ts';
import { MEMBERS_JOB, membersSignature, RETAG_JOB } from '../news/index-members.ts';
import { fetchDueSources } from '../news/fetcher.ts';
import { EARN_JOB, FF_JOB, TV_JOB } from '../calendar/service.ts';
import { fetchTvEarnings } from '../calendar/sources.ts';
import { ECON_JOB, feedingEconomy } from '../economy/service.ts';
import { refreshStockContext } from '../market/stock-context.ts';
import { syncStockSources } from '../news/sources.ts';
import { readJobData, writeJobData } from './scheduler.ts';
import { DAILY_JOB, MAINTENANCE_JOB } from '../sentiment/daily.ts';
import { TD_PLAN_JOB } from '../market/stocks.ts';
import { BOT_TICK_MS } from '../../shared/bot.ts';

export const BOTS_JOB = 'bots';

const MIN = 60_000;
const LOG_RETENTION_DAYS = 30;
/** FD-AISLOW §3: no AI scoring round starts after this, so the one in progress (up to 3 minutes) ends within the job's 10. */
export const AI_RUN_BUDGET_MS = 5 * MIN;
export const AI_MAX_ROUNDS = 40;

/** The AI scoring rounds of one run: until one scores nothing, the budget is spent or the run is stopped. */
export async function aiRounds(round: () => Promise<number>, signal: AbortSignal, now: () => number = Date.now): Promise<number> {
  const started = now();
  let rounds = 0;
  while (rounds < AI_MAX_ROUNDS && !signal.aborted && now() - started < AI_RUN_BUDGET_MS) {
    rounds++;
    if ((await round()) === 0) break;
  }
  return rounds;
}

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
      if (results.some((r) => r.inserted > 0)) {
        scheduler.nudge('sentiment.score', 1000);
        scheduler.nudge('sentiment.ai', 3000);
      }
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

  // FD-AIKEYS: the users' own AI scores the last days' news, each with their key (FD-AISLOW §3: rounds of one batch each).
  scheduler.add({
    name: 'sentiment.ai',
    everyMs: 60_000,
    runOnStart: true,
    timeoutMs: 10 * MIN,
    run: async (signal) => {
      await aiRounds(() => ctx.sentiment.scoreUsers(signal), signal);
    },
  });

  scheduler.add({
    name: 'sentiment.daily',
    everyMs: 2 * MIN,
    runOnStart: true,
    run: async () => {
      // Once after an update that changes how news are classified (FD-MACRORULES), then once after one that changes how
      // they weigh (FD-IMPACT §3: the history recomputed from them); then the regular refresh.
      if (await upgradeClassification(db, await ctx.coins.get(), await ctx.coins.classifier(), DAILY_JOB)) log.info('news: stored news classified again with the macro rules');
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

  // FD-INDEXNEWS §5: the companies of the filter indices, read again once a week (each source on its own); when they
  // change, the stored news are tagged again, a day at a time, newest first.
  scheduler.add({
    name: MEMBERS_JOB,
    everyMs: 6 * 60 * MIN,
    firstDelayMs: 30_000,
    run: async () => {
      if (await ctx.indexMembers.refresh()) {
        ctx.coins.invalidate();
        scheduler.nudge(RETAG_JOB, 1000);
      }
      if (ctx.indexMembers.lastErrors.length) throw new Error(ctx.indexMembers.lastErrors.join('; '));
    },
  });
  scheduler.add({
    name: RETAG_JOB,
    everyMs: 6 * 60 * MIN,
    firstDelayMs: 60_000,
    // ~2 ms a news: 90 days of news take minutes; a run cut short goes on from its cursor.
    timeoutMs: 30 * MIN,
    run: async () => {
      const signature = membersSignature(await ctx.indexMembers.get());
      const state = await readJobData<{ signature: string; cursor: { signature: string; to: number } | null }>(db, RETAG_JOB, { signature: '', cursor: null });
      if (state.signature === signature) return;
      const detector = await ctx.coins.get();
      const oldest = (await db.get<{ t: number | null }>('SELECT min(published_at) AS t FROM news'))?.t ?? null;
      const DAY = 86_400_000;
      let to = state.cursor?.signature === signature ? state.cursor.to : Date.now() + DAY;
      for (; oldest !== null && to > oldest; to -= DAY) {
        await retagCoins(db, detector, to - DAY, to);
        await writeJobData(db, RETAG_JOB, { signature: state.signature, cursor: { signature, to: to - DAY } });
      }
      await writeJobData(db, RETAG_JOB, { signature, cursor: null });
      // The users' own indices (FD-INDEXNEWS §3) read the new tags.
      scheduler.nudge('sentiment.daily', 1000);
    },
  });

  // FD-TDPLAN: each user's Twelve Data key's plan (limits a minute and a day, FD-TDKEYS), at start and every 6 hours;
  // one credit of their key a read. One key failing does not stop the others.
  scheduler.add({
    name: TD_PLAN_JOB,
    everyMs: 6 * 60 * MIN,
    firstDelayMs: 20_000,
    run: async () => {
      const failed: string[] = [];
      for (const userId of await ctx.settings.usersWithKey('twelvedata')) {
        try {
          const p = await ctx.stocks.refreshPlan(userId);
          if (p) log.info(`twelvedata: user ${userId}: plan ${p.category}, ${p.perMinute} credits a minute, ${p.perDay === null ? 'no daily limit' : `${p.perDay} a day`}`);
        } catch (err) {
          failed.push(`user ${userId}: ${(err as Error).message}`);
        }
      }
      if (failed.length) throw new Error(`plan not read for ${failed.join('; ')}`);
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
      // FD-EARNTV: with the dates the companies confirmed, from TradingView.
      await ctx.calendar.refreshEarnings(symbols, (day) => ctx.stocks.nasdaq.earnings(day), undefined, (s) => fetchTvEarnings(s));
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

  // FD-BOT §8: the trading bots, every 30 s (only here: one instance runs the jobs).
  scheduler.add({
    name: BOTS_JOB,
    everyMs: BOT_TICK_MS,
    firstDelayMs: 30_000,
    timeoutMs: 4 * MIN,
    run: async (signal) => {
      await ctx.botEngine.run(signal);
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
