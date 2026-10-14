// In-process job scheduler: no overlapping runs, jitter, per-run timeout, state persisted in job_state; with several
// processes on one database, only the one holding the `job_lease` runs the jobs (TD-AZURE §6).
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
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

/** Who runs the background jobs (TD-AZURE §6): `self` = this process. */
export interface JobsLeader {
  host: string | null;
  self: boolean;
}

export const LEASE_NAME = 'jobs';
/** A lease lasts this long; it is renewed every LEASE_RENEW_MS, so another process takes over within ~a minute. */
export const LEASE_TTL_MS = 60_000;
export const LEASE_RENEW_MS = 20_000;
const DB_NOW = "DATEDIFF_BIG(MILLISECOND, '19700101', SYSUTCDATETIME())";

export class Scheduler {
  private readonly jobs = new Map<string, JobRuntime>();
  private stopped = false;
  private readonly db: Db;
  private readonly log: Logger;
  private readonly controller = new AbortController();
  /** This process's lease owner id and the machine's name (shown on the health page). */
  private readonly owner = randomUUID();
  private readonly host: string;
  private leader = false;
  private leaseTimer: NodeJS.Timeout | null = null;
  private leaseHost: string | null = null;
  /** When this process last renewed its lease (local clock). */
  private renewedAt = 0;
  private readonly ttlMs: number;
  private readonly renewMs: number;

  constructor(db: Db, log: Logger, opts: { host?: string; leaseTtlMs?: number; renewMs?: number } = {}) {
    this.db = db;
    this.log = log;
    this.host = (opts.host ?? hostname()).slice(0, 200);
    this.ttlMs = opts.leaseTtlMs ?? LEASE_TTL_MS;
    this.renewMs = opts.renewMs ?? LEASE_RENEW_MS;
  }

  add(job: Job): void {
    if (this.jobs.has(job.name)) throw new Error(`Duplicate job ${job.name}`);
    this.jobs.set(job.name, { job, timer: null, running: null, nextAt: 0, lastDurationMs: null, nudgeAt: null });
  }

  /** Takes part in the election; the jobs start when (and as long as) this process holds the lease. */
  async start(): Promise<void> {
    // Never inside a transaction left open somewhere (FD-DBHEAL): a renewal would join it and keep its lock.
    await this.db.detached(() => this.renewLease());
    const tick = () => {
      this.leaseTimer = setTimeout(() => {
        void this.db.detached(() => this.renewLease()).finally(() => {
          if (!this.stopped) tick();
        });
      }, this.renewMs);
      this.leaseTimer.unref?.();
    };
    if (!this.stopped) tick();
  }

  /** Takes or renews the lease (with the database's clock, never the local one) and follows what it says. */
  private async renewLease(): Promise<void> {
    if (this.stopped) return;
    let holder: { owner: string; host: string } | undefined;
    try {
      holder = await this.db.tx(async () => {
        await this.db.run(
          `UPDATE job_lease SET owner = @owner, host = @host, expires_at = ${DB_NOW} + @ttl
           WHERE name = @name AND (owner = @owner OR expires_at < ${DB_NOW});
           IF @@ROWCOUNT = 0 AND NOT EXISTS (SELECT 1 FROM job_lease WHERE name = @name)
             INSERT INTO job_lease(name, owner, host, expires_at) VALUES (@name, @owner, @host, ${DB_NOW} + @ttl)`,
          { name: LEASE_NAME, owner: this.owner, host: this.host, ttl: this.ttlMs },
        );
        return this.db.get<{ owner: string; host: string }>('SELECT owner, host FROM job_lease WHERE name = ?', [LEASE_NAME]);
      });
    } catch (err) {
      this.log.warn(`jobs: the lease could not be renewed (${(err as Error).message})`);
      // The database is unreachable: keep going until the lease could expire for the others, then step down.
      if (this.leader && Date.now() - this.renewedAt > this.ttlMs - this.renewMs) this.stepDown('the lease could not be renewed');
      return;
    }
    this.leaseHost = holder?.host ?? null;
    const mine = holder?.owner === this.owner;
    // Stopped while this renewal was on its way: hand the lease straight back.
    if (this.stopped) {
      if (mine) await this.release();
      return;
    }
    if (mine) this.renewedAt = Date.now();
    if (mine && !this.leader) {
      this.leader = true;
      this.log.info('jobs: this instance runs the background jobs');
      for (const rt of this.jobs.values()) this.schedule(rt, rt.job.runOnStart ? 500 : (rt.job.firstDelayMs ?? rt.job.everyMs));
    } else if (!mine && this.leader) {
      this.stepDown(`${holder?.host ?? 'another instance'} runs the background jobs now`);
    }
  }

  /** No more runs here (a run in progress finishes). */
  private stepDown(why: string): void {
    this.leader = false;
    this.log.warn(`jobs: stopped here (${why})`);
    for (const rt of this.jobs.values()) {
      if (rt.timer) clearTimeout(rt.timer);
      rt.timer = null;
      rt.nudgeAt = null;
    }
  }

  /** Who runs the jobs as this process last saw it (no database call). */
  leaderInfo(): JobsLeader {
    return { host: this.leader ? this.host : this.leaseHost, self: this.leader };
  }

  /** Who runs the jobs now, from the lease itself (the health page; also right on a process with the jobs off). */
  async currentLeader(): Promise<JobsLeader> {
    const row = await this.db.get<{ owner: string; host: string; live: number }>(
      `SELECT owner, host, CASE WHEN expires_at > ${DB_NOW} THEN 1 ELSE 0 END AS live FROM job_lease WHERE name = ?`,
      [LEASE_NAME],
    );
    return row?.live ? { host: row.host, self: row.owner === this.owner } : { host: null, self: false };
  }

  private schedule(rt: JobRuntime, delayMs: number): void {
    if (this.stopped || !this.leader) return;
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

  /** Runs the job now unless it is already running; returns when the run finishes (also on a follower). */
  async trigger(name: string): Promise<void> {
    const rt = this.jobs.get(name);
    if (!rt) throw new Error(`Unknown job ${name}`);
    await this.execute(rt);
  }

  /** Asks for an extra run in `delayMs` without disturbing the regular cadence beyond that (only on the leader). */
  nudge(name: string, delayMs = 0): void {
    const rt = this.jobs.get(name);
    if (!rt || this.stopped || !this.leader) return;
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
    const timeoutMs = job.timeoutMs ?? 5 * 60_000;
    const ac = new AbortController();
    const onStop = () => ac.abort();
    this.controller.signal.addEventListener('abort', onStop, { once: true });
    let timer: NodeJS.Timeout | undefined;
    // A run starts clean, whatever context its timer was set in (FD-DBHEAL): it never joins an open transaction.
    rt.running = this.db.detached(async () => {
      try {
        await this.db.run(
          'UPDATE job_state SET last_start = @t, runs = runs + 1 WHERE name = @n; IF @@ROWCOUNT = 0 INSERT INTO job_state(name, last_start, runs) VALUES (@n, @t, 1)',
          { n: job.name, t: start },
        );
        await Promise.race([
          job.run(ac.signal),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              ac.abort();
              reject(new Error(`Timed out after ${timeoutMs} ms`));
            }, timeoutMs);
          }),
        ]);
        await this.db.run('UPDATE job_state SET last_end = ?, last_ok = ?, last_error = NULL WHERE name = ?', [Date.now(), Date.now(), job.name]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log.warn(`job ${job.name} failed: ${msg}`);
        try {
          await this.db.run('UPDATE job_state SET last_end = ?, last_error = ? WHERE name = ?', [Date.now(), msg.slice(0, 500), job.name]);
        } catch {
          // The database may be unreachable (or closed during shutdown).
        }
      } finally {
        clearTimeout(timer);
        this.controller.signal.removeEventListener('abort', onStop);
        rt.lastDurationMs = Date.now() - start;
        rt.running = null;
      }
    });
    return rt.running;
  }

  async status(): Promise<JobStatus[]> {
    const rows = new Map(
      (
        await this.db.all<{ name: string; last_start: number | null; last_end: number | null; last_ok: number | null; last_error: string | null; runs: number }>(
          'SELECT name, last_start, last_end, last_ok, last_error, runs FROM job_state',
        )
      ).map((r) => [r.name, r]),
    );
    return [...this.jobs.values()].map((rt) => {
      const r = rows.get(rt.job.name);
      return {
        name: rt.job.name,
        running: rt.running !== null,
        nextAt: this.stopped || !this.leader ? null : rt.nextAt || null,
        lastStart: r?.last_start ?? null,
        lastEnd: r?.last_end ?? null,
        lastOk: r?.last_ok ?? null,
        lastError: r?.last_error ?? null,
        lastDurationMs: rt.lastDurationMs,
        runs: r?.runs ?? 0,
      };
    });
  }

  /** Stops timers, aborts running jobs, waits for them (bounded) and hands the lease over at once. */
  async stop(waitMs = 5000): Promise<void> {
    this.stopped = true;
    this.controller.abort();
    if (this.leaseTimer) clearTimeout(this.leaseTimer);
    for (const rt of this.jobs.values()) if (rt.timer) clearTimeout(rt.timer);
    const running = [...this.jobs.values()].map((rt) => rt.running).filter((p): p is Promise<void> => p !== null);
    await Promise.race([Promise.allSettled(running), new Promise((r) => setTimeout(r, waitMs).unref?.())]);
    if (this.leader) {
      this.leader = false;
      await this.release();
    }
  }

  /** The lease ends now (expires_at = 0), so another process takes it at its next renewal. */
  private async release(): Promise<void> {
    await this.db.run('UPDATE job_lease SET expires_at = 0 WHERE name = ? AND owner = ?', [LEASE_NAME, this.owner]).catch(() => undefined);
  }
}

/** Persistent per-job data blob (e.g. FF covered weeks, blocked_until). */
export async function readJobData<T>(db: Db, name: string, fallback: T): Promise<T> {
  const row = await db.get<{ data: string | null }>('SELECT data FROM job_state WHERE name = ?', [name]);
  if (!row?.data) return fallback;
  try {
    return { ...fallback, ...(JSON.parse(row.data) as T) };
  } catch {
    return fallback;
  }
}

export async function writeJobData<T>(db: Db, name: string, data: T): Promise<void> {
  await db.run('UPDATE job_state SET data = @d WHERE name = @n; IF @@ROWCOUNT = 0 INSERT INTO job_state(name, data) VALUES (@n, @d)', { n: name, d: JSON.stringify(data) });
}
