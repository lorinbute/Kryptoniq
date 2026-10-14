// FD-DBHEAL: a stuck Sentiq session holding the write lock is ended; lease renewals and jobs never join a transaction.
import { describe, expect, it, vi } from 'vitest';
import { Db, isStuckHolder, STUCK_TX_MS, type LockHolder } from './database.ts';
import { testDb } from '../test/db.ts';
import { Scheduler } from '../jobs/scheduler.ts';
import { silentLogger } from '../log.ts';

const holder = (over: Partial<LockHolder> = {}): LockHolder => ({ spid: 78, login: new Date('2026-10-14T14:16:51.737Z'), prog: 'Sentiq', host: 'aef27428e9f3', txAgeS: 598, lastSql: 'UPDATE job_lease …', ...over });

/** A Db over a fake pool: each read of the holder takes the next answer; the KILL is recorded. */
function fakeDb(answers: (LockHolder | undefined | Error)[]) {
  const queries: string[] = [];
  const warnings: string[] = [];
  const db = Object.create(Db.prototype) as Db;
  const raw = db as unknown as { pool: unknown; lastHeal: number };
  raw.lastHeal = 0;
  db.onWarn = (m: string) => void warnings.push(m);
  raw.pool = {
    request: () => ({
      query: async (q: string) => {
        queries.push(q.startsWith('KILL') ? q : 'holder');
        if (q.startsWith('KILL')) return {};
        const a = answers.shift();
        if (a instanceof Error) throw a;
        return { recordset: a ? [a] : [] };
      },
    }),
  };
  return { db, queries, warnings };
}

describe('a stuck write lock (FD-DBHEAL §2)', () => {
  it('counts as stuck only for a Sentiq session in a transaction open for minutes', () => {
    expect(isStuckHolder(holder())).toBe(true);
    expect(isStuckHolder(holder({ txAgeS: STUCK_TX_MS / 1000 - 1 }))).toBe(false);
    expect(isStuckHolder(holder({ prog: 'SSMS' }))).toBe(false);
    expect(isStuckHolder(holder({ txAgeS: null }))).toBe(false);
    expect(isStuckHolder(undefined)).toBe(false);
  });

  it('ends the same stuck session after a second look, at most once a minute', async () => {
    const { db, queries, warnings } = fakeDb([holder(), holder()]);
    expect(await db.healStuckLock(1_000_000)).toBe(true);
    expect(queries).toEqual(['holder', 'holder', 'KILL 78']);
    expect(warnings[0]).toMatch(/^database: ended a stuck session 78 \(aef27428e9f3, transaction open 598 s; last: UPDATE job_lease/);
    // Within the minute: no look at all.
    expect(await db.healStuckLock(1_030_000)).toBe(false);
    expect(queries).toHaveLength(3);
  });

  it('ends nothing when the session changed, is young, is not Sentiq, or the views cannot be read', async () => {
    for (const answers of [
      [holder(), holder({ login: new Date('2026-10-14T14:40:00Z') })],
      [holder({ txAgeS: 20 })],
      [holder({ prog: 'other' })],
      [undefined],
      [new Error('VIEW DATABASE STATE permission denied')],
    ]) {
      const { db, queries } = fakeDb(answers);
      expect(await db.healStuckLock(1_000_000)).toBe(false);
      expect(queries.some((q) => q.startsWith('KILL'))).toBe(false);
    }
  });
});

describe('running outside any transaction (FD-DBHEAL §2)', () => {
  it('detached calls do not join the transaction they are called from', async () => {
    const db = await testDb();
    const inside = await db.tx(async () => {
      const joined = await db.get<{ n: number }>('SELECT @@TRANCOUNT AS n');
      const apart = await db.detached(() => db.get<{ n: number }>('SELECT @@TRANCOUNT AS n'));
      return { joined: joined?.n, apart: apart?.n };
    });
    expect(inside).toEqual({ joined: 1, apart: 0 });
  });

  it('renews the lease and runs the jobs detached', async () => {
    const db = await testDb();
    const spy = vi.spyOn(db, 'detached');
    const s = new Scheduler(db, silentLogger, { host: 'test', renewMs: 60_000 });
    let ran = false;
    s.add({ name: 'probe', everyMs: 60_000, run: async () => void (ran = true) });
    await s.start();
    await s.trigger('probe');
    expect(ran).toBe(true);
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
    await s.stop();
  });
});
