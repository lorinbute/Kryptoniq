// Background jobs (TD §4).
import { readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { refreshContext } from '../market/context.ts';
import type { AppContext } from '../context.ts';
import { retagRecent } from '../news/ingest.ts';
import { fetchDueSources } from '../news/fetcher.ts';
import { FF_JOB, TV_JOB } from '../calendar/service.ts';

const MIN = 60_000;
const LOG_RETENTION_DAYS = 30;

/** Deletes daily log files (kryptoniq-YYYY-MM-DD.log) older than `before`. */
export function pruneLogs(dir: string, before: number): number {
  let removed = 0;
  let files: string[] = [];
  try {
    files = readdirSync(dir);
  } catch {
    return 0;
  }
  for (const f of files) {
    const m = /^kryptoniq-(\d{4}-\d{2}-\d{2})\.log$/.exec(f);
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
      ctx.daily.refresh();
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
      await ctx.calendar.refreshTradingView();
      // Bursts: poll again shortly after important releases until their actual values arrive.
      const now = Date.now();
      if (ctx.calendar.awaitingActual(now) > 0) {
        scheduler.nudge(TV_JOB, 2 * MIN);
        return;
      }
      const next = ctx.calendar.nextImportant(now);
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
        retagRecent(db, ctx.coins.get(), Date.now() - 3 * 86_400_000);
      }
      if (r.errors.length) throw new Error(r.errors.join('; '));
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
      const days = ctx.settings.get().retentionDays;
      const cutoff = Date.now() - days * 86_400_000;
      const removed = db.run('DELETE FROM news WHERE published_at < ?', [cutoff]).changes;
      db.run('DELETE FROM calendar_raw WHERE ts < ?', [Date.now() - 400 * 86_400_000]);
      db.run('UPDATE sources SET item_count = (SELECT count(*) FROM news WHERE source_id = sources.id)');
      db.raw.exec('PRAGMA optimize');
      pruneLogs(path.join(ctx.config.dataDir, 'logs'), Date.now() - LOG_RETENTION_DAYS * 86_400_000);
      if (removed) log.info(`retention: removed ${removed} news older than ${days} days`);
    },
  });
}
