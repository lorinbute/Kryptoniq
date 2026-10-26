// The news tagged again in the background after the symbols followed change (FD-WATCHLISTS).
import { describe, expect, it } from 'vitest';
import type { Logger } from '../log.ts';
import { RetagQueue } from './retag-queue.ts';

const logs = (): Logger & { lines: string[] } => {
  const lines: string[] = [];
  return { lines, info: () => {}, warn: (m: string) => void lines.push(m), error: () => {} };
};

describe('the background retagging', () => {
  it('one pass at a time; changes during a pass ask for one more, not one each', async () => {
    let passes = 0;
    let release: () => void = () => {};
    const q = new RetagQueue(async () => {
      passes++;
      if (passes === 1) await new Promise<void>((r) => (release = r));
    }, logs());
    q.request();
    q.request();
    q.request();
    await Promise.resolve();
    expect(passes).toBe(1);
    release();
    await q.idle();
    expect(passes).toBe(2);
    await q.idle();
    q.request();
    await q.idle();
    expect(passes).toBe(3);
  });

  it('a failed pass is noted and the next request runs again', async () => {
    const log = logs();
    let fail = true;
    let passes = 0;
    const q = new RetagQueue(async () => {
      passes++;
      if (fail) throw new Error('database unreachable');
    }, log);
    q.request();
    await q.idle();
    expect(log.lines).toEqual(['news: retagging after a change of the symbols followed failed (database unreachable)']);
    fail = false;
    q.request();
    await q.idle();
    expect(passes).toBe(2);
    expect(log.lines).toHaveLength(1);
  });
});
