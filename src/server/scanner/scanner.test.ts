import { afterEach, describe, expect, it, vi } from 'vitest';
import { testDb } from '../test/db.ts';
import { silentLogger } from '../log.ts';
import type { MarketData } from '../market/market.ts';
import type { MarketStatus, StockData } from '../market/stocks.ts';
import { SecretBox } from '../secrets/crypto.ts';
import { SettingsService } from '../settings.ts';
import type { Timeframe } from '../../shared/time.ts';
import { Scanner } from './scanner.ts';
import { INDEX_TIMEFRAMES } from '../../shared/indices.ts';

afterEach(() => vi.useRealTimers());

/** Rising daily candles: enough history for the indicator. */
const candles = (n: number) => Array.from({ length: n }, (_, i) => ({ t: Date.UTC(2025, 0, 1) + i * 86_400_000, o: 100 + i, h: 102 + i, l: 99 + i, c: 101 + i, v: 1000 }));

async function setup(opts: { tfs: Timeframe[]; state: MarketStatus['state']; index?: boolean }) {
  const db = await testDb();
  const settings = new SettingsService(db, new SecretBox(Buffer.alloc(32, 3)));
  await db.run("INSERT INTO watchlist(coin, quote, position, aliases, added_at, kind) VALUES ('AAPL', 'USD', 0, '[]', 1, 'stock')");
  if (opts.index) await db.run("INSERT INTO watchlist(coin, quote, position, aliases, added_at, kind) VALUES ('^SPX', 'USD', 1, '[]', 1, 'index')");
  const asked: Timeframe[] = [];
  const stocks = {
    timeframes: async () => opts.tfs,
    // FD-TDKEYS: the user's own key gives the intraday timeframes.
    hasKey: async () => opts.tfs.includes('1h'),
    // An index has its own timeframes (FD-INDEXINTRA).
    timeframesFor: async (sym: string) => (sym.startsWith('^') ? [...INDEX_TIMEFRAMES] : opts.tfs),
    confirmedStatus: async (): Promise<MarketStatus> => ({ state: opts.state, label: '', opensAt: null, closesAt: null, fetchedAt: Date.now() }),
    candles: async (sym: string, tf: Timeframe, count: number) => {
      asked.push(tf);
      return { exchange: 'nasdaq', symbol: sym, tf, candles: candles(Math.min(count, 400)), pricePrecision: 2, lastClosedIndex: 0, fetchedAt: Date.now() };
    },
  } as unknown as StockData;
  const market = { candles: async () => Promise.reject(new Error('no crypto here')) } as unknown as MarketData;
  return { scanner: new Scanner(db, settings, market, silentLogger, stocks), settings, asked };
}

describe('scanner for stocks (FD-SENTIQ §4.6)', () => {
  it('uses daily candles when the source lacks the scanner timeframe, and says so', async () => {
    const { scanner } = await setup({ tfs: ['1d', '1w'], state: 'open' });
    await scanner.run();
    const r = scanner.result(1)!;
    expect(r.rows[0]).toMatchObject({ coin: 'AAPL', kind: 'stock', symbol: 'AAPL/USD', tf: '1d', ok: true });
    expect(r.rows[0]?.warnings).toContain('STOCK_TF_FALLBACK');
  });

  it('recomputes every 30 minutes while the market trades, and at once after a settings change', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.UTC(2026, 9, 13, 15) });
    const { scanner, settings, asked } = await setup({ tfs: ['1h', '1d', '1w'], state: 'open' });
    await scanner.run();
    await scanner.run();
    expect(asked).toEqual(['1h']);
    vi.setSystemTime(Date.UTC(2026, 9, 13, 15, 31));
    await scanner.run();
    expect(asked).toEqual(['1h', '1h']);
    await settings.updateFor(1, true, { indicator: { lenFastEma: 21 } });
    await scanner.run();
    expect(asked).toEqual(['1h', '1h', '1h']);
  });

  it('scans an index under its own kind, on the scanner timeframe (FD-INDEXINTRA: 15m, 1h, 4h and 1d all exist for indices)', async () => {
    const { scanner, asked } = await setup({ tfs: ['1h', '1d', '1w'], state: 'open', index: true });
    await scanner.run();
    const rows = scanner.result(1)!.rows;
    expect(rows[0]).toMatchObject({ coin: 'AAPL', kind: 'stock', tf: '1h' });
    expect(rows[1]).toMatchObject({ coin: '^SPX', kind: 'index', symbol: '^SPX/USD', tf: '1h', ok: true });
    expect(rows[1]?.warnings ?? []).not.toContain('STOCK_TF_FALLBACK');
    expect(asked).toEqual(['1h', '1h']);
  });

  it("FD-TDKEYS: a share is read with each user's own key (their row), without a key on the daily (one row for all)", async () => {
    const db = await testDb();
    const settings = new SettingsService(db, new SecretBox(Buffer.alloc(32, 3)));
    // Three users with AAPL in their favourites: 1 and 2 with a Twelve Data key, 3 without.
    await db.run("INSERT INTO users(email, name, role, email_verified_at, created_at) VALUES (N'ana@example.com', N'Ana', N'user', 1, 1), (N'bob@example.com', N'Bob', N'user', 1, 1)");
    for (const u of [1, 2, 3]) await db.run("INSERT INTO watchlist(user_id, coin, quote, position, aliases, added_at, kind) VALUES (?, 'AAPL', 'USD', 0, '[]', 1, 'stock')", [u]);
    const withKey = new Set([1, 2]);
    const asked: string[] = [];
    const stocks = {
      hasKey: async (u: number) => withKey.has(u),
      timeframesFor: async (_sym: string, u: number) => (withKey.has(u) ? ['1h', '1d', '1w'] : ['1d', '1w']),
      confirmedStatus: async (): Promise<MarketStatus> => ({ state: 'open', label: '', opensAt: null, closesAt: null, fetchedAt: Date.now() }),
      candles: async (sym: string, tf: Timeframe, count: number, u: number) => {
        asked.push(`${u}:${tf}`);
        return { exchange: withKey.has(u) && tf !== '1d' ? 'twelvedata' : 'nasdaq', symbol: sym, tf, candles: candles(Math.min(count, 400)), pricePrecision: 2, lastClosedIndex: 0, fetchedAt: Date.now() };
      },
    } as unknown as StockData;
    const market = { candles: async () => Promise.reject(new Error('no crypto here')) } as unknown as MarketData;
    for (const u of [1, 2, 3]) await settings.updateFor(u, u === 1, { scanner: { tf: '1h' } });
    const scanner = new Scanner(db, settings, market, silentLogger, stocks);
    await scanner.run();
    expect(asked.sort()).toEqual(['1:1h', '2:1h', '3:1d']);
    expect(scanner.result(1)?.rows[0]).toMatchObject({ coin: 'AAPL', tf: '1h', ok: true });
    expect(scanner.result(3)?.rows[0]).toMatchObject({ coin: 'AAPL', tf: '1d', ok: true, warnings: expect.arrayContaining(['STOCK_TF_FALLBACK']) });
    // User 2 removes the key: from then on the shared daily row, already read for user 3 (no new request).
    withKey.delete(2);
    asked.length = 0;
    await scanner.run();
    expect(asked).toEqual([]);
    expect(scanner.result(2)?.rows[0]).toMatchObject({ tf: '1d', warnings: expect.arrayContaining(['STOCK_TF_FALLBACK']) });
    expect(scanner.result(1)?.rows[0]).toMatchObject({ tf: '1h' });
  });

  it('with the market closed, computes once and then reuses the row', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.UTC(2026, 9, 17, 12) });
    const { scanner, asked } = await setup({ tfs: ['1h', '1d', '1w'], state: 'closed' });
    await scanner.run();
    vi.setSystemTime(Date.UTC(2026, 9, 18, 12));
    await scanner.run();
    expect(asked).toEqual(['1h']);
  });
});
