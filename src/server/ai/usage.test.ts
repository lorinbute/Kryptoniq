import { describe, expect, it } from 'vitest';
import { testDb } from '../test/db.ts';
import { AiUsage } from './usage.ts';

const zero = { calls: 0, items: 0, input: 0, output: 0, model: null };

describe("what each user's AI key spends (FD-AICLARITY, FD-AIKEYS)", () => {
  it('adds the calls of the day per user, apart for the scores and the summaries, and starts again on a new UTC day', async () => {
    const db = await testDb();
    let now = Date.parse('2026-10-14T23:50:00Z');
    const u = new AiUsage(db, () => now);
    expect(await u.today(1)).toEqual({ day: '2026-10-14', sentiment: zero, summary: zero });
    await u.record(1, 'sentiment', { items: 25, input: 1200, output: 800, model: 'gpt-6-luna' });
    await u.record(1, 'sentiment', { items: 7, input: 500, output: 210, model: 'gpt-6-luna' });
    await u.record(1, 'summary', { input: 9000, output: 3000, model: 'gpt-6-astra' });
    await u.record(2, 'summary', { input: 1, output: 1, model: 'gemini-3.8-flash' });
    expect(await u.today(1)).toEqual({
      day: '2026-10-14',
      sentiment: { calls: 2, items: 32, input: 1700, output: 1010, model: 'gpt-6-luna' },
      summary: { calls: 1, items: 0, input: 9000, output: 3000, model: 'gpt-6-astra' },
    });
    expect((await u.today(2)).summary).toMatchObject({ calls: 1, model: 'gemini-3.8-flash' });
    now = Date.parse('2026-10-15T00:05:00Z');
    expect((await u.today(1)).sentiment.calls).toBe(0);
    await u.record(1, 'sentiment', { items: 1, input: 10, output: 5, junk: 1 } as never);
    expect(await u.today(1)).toMatchObject({ day: '2026-10-15', sentiment: { calls: 1, items: 1, input: 10, output: 5, model: null }, summary: { calls: 0 } });
    await u.forget(1);
    expect((await u.today(1)).sentiment.calls).toBe(0);
  });

  it('two writers at once (the Mac and Azure) lose nothing; bad values count as zero', async () => {
    const db = await testDb();
    const now = () => Date.parse('2026-10-14T12:00:00Z');
    const a = new AiUsage(db, now);
    const b = new AiUsage(db, now);
    await Promise.all([...Array.from({ length: 4 }, () => a.record(1, 'sentiment', { items: 25, input: 100, output: 50 })), ...Array.from({ length: 4 }, () => b.record(1, 'summary', { input: 10, output: 5 }))]);
    await a.record(1, 'sentiment', { items: -3, input: Number.NaN, output: Number.POSITIVE_INFINITY });
    expect(await a.today(1)).toMatchObject({ sentiment: { calls: 5, items: 100, input: 400, output: 200 }, summary: { calls: 4, input: 40, output: 20 } });
  });

  it('never stops the work it counts', async () => {
    const broken = { tx: async () => Promise.reject(new Error('Baza de date nu răspunde acum.')) } as never;
    await expect(new AiUsage(broken).record(1, 'summary', { input: 1, output: 1 })).resolves.toBeUndefined();
  });
});
