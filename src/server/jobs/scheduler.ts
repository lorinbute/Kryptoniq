// In-process job scheduler: no overlapping runs, jitter, per-run timeout, state persisted in job_state.
import type { Db } from '../db/database.ts';
import type { Logger } from '../log.ts';

export interface Job {
  name: string;
  everyMs: number;
  runOnStart?: boolean;
  /** Delay before the first run when runOnStart is false (defaults to everyMs). */
  firstDelayMs?: number;
  timeoutMs?: number;
  run: (signal: AbortSignal) => Promise<void>;
}

interface JobRuntime {
  job: Job;
  timer: NodeJS.Timeout | null;
  running: Promise<void> | null;
  nextAt: number;
  lastDurationMs: number | null;
  /** Earlier next run requested while the job was running. */
  nudgeAt: number | null;
}

export interface JobStatus {
  name: string;
  running: boolean;
  nextAt: number | null;
  lastStart: number | null;
  lastEnd: number | null;
  lastOk: number | null;
  lastError: string | null;
  lastDurationMs: number | null;
  runs: number;
}

export class Scheduler {
  private readonly jobs = new Map<string, JobRuntime>();
  private stopped = false;
  private readonly db: Db;
  private readonly log: Logger;
  private readonly controller = new AbortController();

  constructor(db: Db, log: Logger) {
    this.db = db;
    this.log = log;
  }

  add(job: Job): void {
    if (this.jobs.has(job.name)) throw new Error(`Duplicate job ${job.name}`);
    this.jobs.set(job.name, { job, timer: null, running: null, nextAt: 0, lastDurationMs: null, nudgeAt: null });
  }

  start(): void {
    for (const rt of this.jobs.values()) {
      const delay = rt.job.runOnStart ? 500 : (rt.job.firstDelayMs ?? rt.job.everyMs);
      this.schedule(rt, delay);
    }
  }

  private schedule(rt: JobRuntime, delayMs: number): void {
    if (this.stopped) return;
    if (rt.timer) clearTimeout(rt.timer);
    const jitter = delayMs > 5000 ? (Math.random() - 0.5) * 0.2 * delayMs : 0;
    const d = Math.max(0, Math.round(delayMs + jitter));
    rt.nextAt = Date.now() + d;
    rt.timer = setTimeout(() => {
      rt.timer = null;
      void this.execute(rt).finally(() => {
        const nudged = rt.nudgeAt !== null ? Math.max(0, rt.nudgeAt - Date.now()) : Infinity;
        rt.nudgeAt = null;
        this.schedule(rt, Math.min(rt.job.everyMs, nudged));
      });
    }, d);
    rt.timer.unref?.();
  }

  /** Runs the job now unless it is already running; returns when the run finishes. */
  async trigger(name: string): Promise<void> {
    const rt = this.jobs.get(name);
    if (!rt) throw new Error(`Unknown job ${name}`);
    await this.execute(rt);
  }

  /** Asks for an extra run in `delayMs` without disturbing the regular cadence beyond that. */
  nudge(name: string, delayMs = 0): void {
    const rt = this.jobs.get(name);
    if (!rt || this.stopped) return;
    if (rt.running || rt.timer === null) {
      // Applied when the current run finishes (its follow-up schedule would override a timer set now).
      const at = Date.now() + delayMs;
      rt.nudgeAt = rt.nudgeAt === null ? at : Math.min(rt.nudgeAt, at);
      return;
    }
    if (rt.nextAt - Date.now() > delayMs) this.schedule(rt, delayMs);
  }

  private async execute(rt: JobRuntime): Promise<void> {
    if (this.stopped) return;
    if (rt.running) return rt.running;
    const { job } = rt;
    const start = Date.now();
    this.db.run(
      `INSERT INTO job_state(name, last_start, runs) VALUES (?, ?, 1)
       ON CONFLICT(name) DO UPDATE SET last_start = excluded.last_start, runs = runs + 1`,
      [job.name, start],
    );
    const timeoutMs = job.timeoutMs ?? 5 * 60_000;
    const ac = new AbortController();
    const onStop = () => ac.abort();
    this.controller.signal.addEventListener('abort', onStop, { once: true });
    let timer: NodeJS.Timeout | undefined;
    rt.running = (async () => {
      try {
        await Promise.race([
          job.run(ac.signal),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              ac.abort();
              reject(new Error(`Timed out after ${timeoutMs} ms`));
            }, timeoutMs);
          }),
        ]);
        this.db.run('UPDATE job_state SET last_end = ?, last_ok = ?, last_error = NULL WHERE name = ?', [Date.now(), Date.now(), job.name]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log.warn(`job ${job.name} failed: ${msg}`);
        try {
          this.db.run('UPDATE job_state SET last_end = ?, last_error = ? WHERE name = ?', [Date.now(), msg.slice(0, 500), job.name]);
        } catch {
          // DB may already be closed during shutdown
        }
      } finally {
        clearTimeout(timer);
        this.controller.signal.removeEventListener('abort', onStop);
        rt.lastDurationMs = Date.now() - start;
        rt.running = null;
      }
    })();
    return rt.running;
  }

  status(): JobStatus[] {
    const rows = new Map(
      this.db
        .all<{ name: string; last_start: number | null; last_end: number | null; last_ok: number | null; last_error: string | null; runs: number }>(
          'SELECT name, last_start, last_end, last_ok, last_error, runs FROM job_state',
        )
        .map((r) => [r.name, r]),
    );
    return [...this.jobs.values()].map((rt) => {
      const r = rows.get(rt.job.name);
      return {
        name: rt.job.name,
        running: rt.running !== null,
        nextAt: this.stopped ? null : rt.nextAt || null,
        lastStart: r?.last_start ?? null,
        lastEnd: r?.last_end ?? null,
        lastOk: r?.last_ok ?? null,
        lastError: r?.last_error ?? null,
        lastDurationMs: rt.lastDurationMs,
        runs: r?.runs ?? 0,
      };
    });
  }

  /** Stops timers, aborts running jobs and waits for them (bounded). */
  async stop(waitMs = 5000): Promise<void> {
    this.stopped = true;
    this.controller.abort();
    for (const rt of this.jobs.values()) if (rt.timer) clearTimeout(rt.timer);
    const running = [...this.jobs.values()].map((rt) => rt.running).filter((p): p is Promise<void> => p !== null);
    await Promise.race([Promise.allSettled(running), new Promise((r) => setTimeout(r, waitMs).unref?.())]);
  }
}

/** Persistent per-job data blob (e.g. FF covered weeks, blocked_until). */
export function readJobData<T>(db: Db, name: string, fallback: T): T {
  const row = db.get<{ data: string | null }>('SELECT data FROM job_state WHERE name = ?', [name]);
  if (!row?.data) return fallback;
  try {
    return { ...fallback, ...(JSON.parse(row.data) as T) };
  } catch {
    return fallback;
  }
}

export function writeJobData<T>(db: Db, name: string, data: T): void {
  db.run(
    `INSERT INTO job_state(name, data) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET data = excluded.data`,
    [name, JSON.stringify(data)],
  );
}
