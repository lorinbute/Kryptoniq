import { describe, expect, it } from 'vitest';
import { testDb } from '../test/db.ts';
import { ClaudeUsage } from './usage.ts';

describe('what Sentiq spends on the Claude key (FD-AICLARITY)', () => {
  it('adds the calls of the day, apart for the sentiment and the summaries, and starts again on a new UTC day', async () => {
    const db = await testDb();
    let now = Date.parse('2026-10-14T23:50:00Z');
    const u = new ClaudeUsage(db, () => now);
    expect(await u.today()).toEqual({ day: '2026-10-14', sentiment: { calls: 0, items: 0, input: 0, output: 0 }, summary: { calls: 0, items: 0, input: 0, output: 0 } });
    await u.record('sentiment', { items: 25, input: 1200, output: 800 });
    await u.record('sentiment', { items: 7, input: 500, output: 210 });
    await u.record('summary', { input: 9000, output: 3000 });
    expect(await u.today()).toEqual({
      day: '2026-10-14',
      sentiment: { calls: 2, items: 32, input: 1700, output: 1010 },
      summary: { calls: 1, items: 0, input: 9000, output: 3000 },
    });
    now = Date.parse('2026-10-15T00:05:00Z');
    expect((await u.today()).sentiment.calls).toBe(0);
    await u.record('sentiment', { items: 1, input: 10, output: 5, junk: 1 } as never);
    expect(await u.today()).toMatchObject({ day: '2026-10-15', sentiment: { calls: 1, items: 1, input: 10, output: 5 }, summary: { calls: 0 } });
  });

  it('two writers at once (the Mac and Azure) lose nothing; bad values count as zero', async () => {
    const db = await testDb();
    const now = () => Date.parse('2026-10-14T12:00:00Z');
    const a = new ClaudeUsage(db, now);
    const b = new ClaudeUsage(db, now);
    await Promise.all([...Array.from({ length: 4 }, () => a.record('sentiment', { items: 25, input: 100, output: 50 })), ...Array.from({ length: 4 }, () => b.record('summary', { input: 10, output: 5 }))]);
    await a.record('sentiment', { items: -3, input: Number.NaN, output: Number.POSITIVE_INFINITY });
    expect(await a.today()).toMatchObject({ sentiment: { calls: 5, items: 100, input: 400, output: 200 }, summary: { calls: 4, input: 40, output: 20 } });
  });

  it('never stops the work it counts', async () => {
    const broken = { tx: async () => Promise.reject(new Error('Baza de date nu răspunde acum.')) } as never;
    await expect(new ClaudeUsage(broken).record('summary', { input: 1, output: 1 })).resolves.toBeUndefined();
  });
});
