import { afterEach, describe, expect, it } from 'vitest';
import { Db } from '../db/database.ts';
import { setFetchImpl } from '../net/http.ts';
import { MarketError } from './market.ts';
import { parseCnn, readStockContext, refreshStockContext } from './stock-context.ts';
import {
  cleanCompanyName,
  CreditBudget,
  defaultStockAliases,
  editDistance,
  nasdaqNumber,
  parseNasdaqEt,
  StockData,
  stockTimeframes,
  TwelveDataClient,
  weeklyFromDaily,
  zonedToUtc,
  type MarketStatus,
  type NasdaqClient,
} from './stocks.ts';

type Route = (url: URL) => { status?: number; body: unknown } | undefined;
const seen: string[] = [];
function serve(...routes: Route[]) {
  setFetchImpl((async (input: string | URL | Request) => {
    const url = new URL(String(input));
    seen.push(url.toString());
    for (const r of routes) {
      const res = r(url);
      if (res) return new Response(typeof res.body === 'string' ? res.body : JSON.stringify(res.body), { status: res.status ?? 200 });
    }
    throw new Error(`unexpected request ${url}`);
  }) as typeof fetch);
}

afterEach(() => {
  setFetchImpl(null);
  seen.length = 0;
});

const NY = 'America/New_York';

describe('company names', () => {
  it('drops legal suffixes and share classes', () => {
    expect(cleanCompanyName('Alphabet Inc. Class A Common Stock')).toBe('Alphabet');
    expect(cleanCompanyName('Coinbase Global, Inc. - Class A Common Stock')).toBe('Coinbase Global');
    expect(cleanCompanyName('The Walt Disney Company')).toBe('Walt Disney');
    expect(cleanCompanyName('Coca-Cola Company (The)')).toBe('Coca-Cola');
    expect(cleanCompanyName('AT&T Inc.')).toBe('AT&T');
  });

  it('adds the brand when the second word is generic, never a plain first word', () => {
    expect(defaultStockAliases('Palantir Technologies Inc. Class A Common Stock')).toEqual(['Palantir Technologies', 'Palantir']);
    expect(defaultStockAliases('General Motors Company')).toEqual(['General Motors']);
    expect(defaultStockAliases('Advanced Micro Devices, Inc. Common Stock')).toEqual(['Advanced Micro Devices']);
    expect(defaultStockAliases('Booking Holdings Inc.')).toEqual(['Booking']);
    // Too short for an alias (the news detector needs 3 letters at least).
    expect(defaultStockAliases('3M Company')).toEqual([]);
    expect(defaultStockAliases(null)).toEqual([]);
  });
});

describe('Nasdaq parsing', () => {
  it('reads prices written as text', () => {
    expect(nasdaqNumber('$340.97')).toBe(340.97);
    expect(nasdaqNumber('25,900,600')).toBe(25_900_600);
    expect(nasdaqNumber('+1.29%')).toBe(1.29);
    expect(nasdaqNumber('N/A')).toBeNull();
    expect(nasdaqNumber('')).toBeNull();
  });

  it('reads New York times across the DST change', () => {
    expect(parseNasdaqEt('Oct 13, 2026 09:30 AM ET')).toBe(Date.parse('2026-10-13T13:30:00Z'));
    expect(parseNasdaqEt('Dec 1, 2026 04:00 PM ET')).toBe(Date.parse('2026-12-01T21:00:00Z'));
    expect(parseNasdaqEt('Dec 1, 2026 12:15 AM ET')).toBe(Date.parse('2026-12-01T05:15:00Z'));
    expect(parseNasdaqEt('soon')).toBeNull();
    expect(zonedToUtc(2026, 3, 9, 9, 30, 0, NY)).toBe(Date.parse('2026-03-09T13:30:00Z'));
  });

  it('builds weeks starting Monday in New York', () => {
    const day = (d: string, o: number, c: number) => ({ t: zonedToUtc(+d.slice(0, 4), +d.slice(5, 7), +d.slice(8, 10), 0, 0, 0, NY), o, h: Math.max(o, c) + 1, l: Math.min(o, c) - 1, c, v: 10 });
    const w = weeklyFromDaily([day('2026-10-02', 1, 2), day('2026-10-05', 2, 3), day('2026-10-07', 3, 5), day('2026-10-09', 5, 4), day('2026-10-12', 4, 6)]);
    expect(w.map((x) => new Date(x.t).toISOString())).toEqual(['2026-09-28T04:00:00.000Z', '2026-10-05T04:00:00.000Z', '2026-10-12T04:00:00.000Z']);
    expect(w[1]).toMatchObject({ o: 2, c: 4, h: 6, l: 1, v: 30 });
  });
});

describe('Twelve Data budget', () => {
  it('allows 8 a minute and 800 a day, and remembers the day across restarts', () => {
    const db = new Db(':memory:');
    let now = Date.parse('2026-10-13T10:00:00Z');
    const b = new CreditBudget({ db, now: () => now });
    for (let i = 0; i < 8; i++) b.take();
    expect(() => b.take()).toThrow(/8 cereri pe minut/);
    now += 61_000;
    b.take();
    expect(b.status()).toMatchObject({ used: 9, minuteUsed: 1, perDay: 800 });
    const again = new CreditBudget({ db, now: () => now });
    expect(again.status().used).toBe(9);
    // A new UTC day starts from zero.
    now = Date.parse('2026-10-14T00:00:01Z');
    expect(again.status().used).toBe(0);
  });

  it('stops at the daily limit with the time it comes back', () => {
    const now = Date.parse('2026-10-13T10:00:00Z');
    const b = new CreditBudget({ now: () => now, perMinute: 1000, perDay: 3 });
    b.take(3);
    expect(() => b.take()).toThrow(/limita zilnică Twelve Data \(3 cereri\).*00:00 UTC/);
  });
});

describe('Twelve Data client', () => {
  const td = (key: string | null = 'k'.repeat(32)) => new TwelveDataClient(() => key, new CreditBudget({ now: () => Date.parse('2026-10-13T15:00:00Z') }));

  it('maps the exchange-time datetimes to UTC, oldest first', async () => {
    serve((u) =>
      u.pathname === '/time_series'
        ? {
            body: {
              meta: { symbol: 'AAPL', exchange_timezone: NY, exchange: 'NASDAQ' },
              values: [
                { datetime: '2026-10-12 10:30:00', open: '2', high: '3', low: '1', close: '2.5', volume: '100' },
                { datetime: '2026-10-12 09:30:00', open: '1', high: '2', low: '0.5', close: '2', volume: '50' },
              ],
              status: 'ok',
            },
          }
        : undefined,
    );
    const r = await td().timeSeries('AAPL', '1h', 2);
    expect(r.candles.map((c) => new Date(c.t).toISOString())).toEqual(['2026-10-12T13:30:00.000Z', '2026-10-12T14:30:00.000Z']);
    expect(r.candles[1]).toMatchObject({ o: 2, h: 3, l: 1, c: 2.5, v: 100 });
    expect(seen[0]).toContain('interval=1h');
    expect(seen[0]).toContain('order=ASC');
  });

  it('explains its errors', async () => {
    serve(() => ({ body: { code: 401, message: '**apikey** parameter is incorrect', status: 'error' } }));
    await expect(td().timeSeries('AAPL', '1h', 2)).rejects.toThrow(/cheia nu e validă/);
    serve(() => ({ body: { code: 400, message: 'symbol not found', status: 'error' } }));
    await expect(td().timeSeries('ZZZZ', '1h', 2)).rejects.toMatchObject({ code: 'UNKNOWN_SYMBOL' });
    await expect(td(null).timeSeries('AAPL', '1h', 2)).rejects.toThrow(/Cheia Twelve Data lipsește/);
  });

  it('pauses for the rest of the minute after a 429', async () => {
    serve(() => ({ status: 429, body: { code: 429, message: 'You have run out of API credits for the current minute', status: 'error' } }));
    const c = td();
    await expect(c.timeSeries('AAPL', '1h', 2)).rejects.toThrow(/limita de cereri/);
    await expect(c.timeSeries('AAPL', '1h', 2)).rejects.toThrow(/pe minut a fost atinsă/);
    expect(seen).toHaveLength(1);
  });

  it('keeps US shares and ETFs from the symbol search', async () => {
    serve(() => ({
      body: {
        data: [
          { symbol: 'AAPL', instrument_name: 'Apple Inc', exchange: 'NASDAQ', country: 'United States', instrument_type: 'Common Stock' },
          { symbol: 'APC', instrument_name: 'Apple Inc', exchange: 'XETR', country: 'Germany', instrument_type: 'Common Stock' },
          { symbol: 'AAPX', instrument_name: 'T-Rex 2X Long Apple', exchange: 'CBOE', country: 'United States', instrument_type: 'ETF' },
        ],
        status: 'ok',
      },
    }));
    expect(await td().search('apple')).toEqual([
      { symbol: 'AAPL', name: 'Apple Inc', exchange: 'NASDAQ', type: 'Acțiune' },
      { symbol: 'AAPX', name: 'T-Rex 2X Long Apple', exchange: 'CBOE', type: 'ETF' },
    ]);
  });
});

/** A Nasdaq stand-in: `daily` returns `days` bars ending yesterday. */
function fakeNasdaq(opts: { fail?: boolean; status?: MarketStatus['state'] } = {}) {
  const calls = { daily: 0, today: 0, quote: 0 };
  const n = {
    daily: async () => {
      calls.daily++;
      if (opts.fail) throw new MarketError('EXCHANGE_ERROR', 'Nasdaq: HTTP 503');
      return Array.from({ length: 300 }, (_, i) => ({ t: Date.parse('2026-01-01T05:00:00Z') + i * 86_400_000, o: 1, h: 2, l: 0.5, c: 1.5, v: 1 }));
    },
    today: async () => {
      calls.today++;
      return null;
    },
    quote: async (sym: string, now: number) => {
      calls.quote++;
      if (opts.fail) throw new MarketError('UNKNOWN_SYMBOL', `${sym} nu e listat la Nasdaq / NYSE`);
      return { symbol: sym, name: 'Apple Inc. Common Stock', last: 340.97, change: 4.33, changePct: 1.29, status: 'Closed', fetchedAt: now };
    },
    marketStatus: async (now: number) => ({ state: opts.status ?? 'open', label: 'Market Open', opensAt: null, closesAt: null, fetchedAt: now }),
    search: async () => [{ symbol: 'AAPL', name: 'Apple Inc. Common Stock', exchange: 'NASDAQ-GS', type: 'Acțiune' }],
    earnings: async () => [],
    ndx: async (now: number) => ({ last: 30664.7, changePct: -0.71, fetchedAt: now }),
  };
  return { n: n as unknown as NasdaqClient, calls, opts };
}

describe('StockData', () => {
  it('has 1d and 1w without a key, everything Twelve Data has with one', () => {
    expect(stockTimeframes(false)).toEqual(['1d', '1w']);
    expect(stockTimeframes(true)).toEqual(['1m', '5m', '15m', '30m', '1h', '2h', '4h', '1d', '1w']);
  });

  it('asks for the key on intraday timeframes', async () => {
    const s = new StockData({ key: () => null, nasdaq: fakeNasdaq().n });
    await expect(s.candles('AAPL', '1h', 100)).rejects.toMatchObject({ code: 'UNSUPPORTED_TIMEFRAME' });
    await expect(s.candles('aapl!', '1d', 100)).rejects.toMatchObject({ code: 'UNKNOWN_SYMBOL' });
  });

  it('suggests listed symbols for one the source does not know', async () => {
    const f = fakeNasdaq();
    const n = f.n as unknown as { daily: () => Promise<never>; search: (q: string) => Promise<unknown[]> };
    n.daily = async () => Promise.reject(new MarketError('UNKNOWN_SYMBOL', 'FB nu are istoric la Nasdaq'));
    n.search = async () => [
      { symbol: 'FB', name: 'old', exchange: '', type: 'Acțiune' },
      { symbol: 'META', name: 'Meta Platforms, Inc. Class A Common Stock', exchange: 'NASDAQ-GS', type: 'Acțiune' },
    ];
    const s = new StockData({ key: () => null, nasdaq: f.n });
    await expect(s.candles('FB', '1d', 50)).rejects.toMatchObject({ code: 'UNKNOWN_SYMBOL', message: 'FB nu are istoric la Nasdaq; încearcă META', suggestions: ['META'] });
    // The closest spelling first.
    n.search = async () => ['AADX', 'AAOI', 'AAPL', 'APLE'].map((symbol) => ({ symbol, name: symbol, exchange: '', type: 'Acțiune' }));
    await expect(s.candles('APPL', '1d', 50)).rejects.toMatchObject({ suggestions: ['AAPL', 'APLE', 'AADX'] });
    expect(editDistance('APPL', 'AAPL')).toBe(1);
    expect(editDistance('BRK.B', 'BRKB')).toBe(1);
  });

  it('serves daily candles from Nasdaq, cached, and the last ones when Nasdaq fails', async () => {
    let now = Date.parse('2026-10-13T15:00:00Z');
    const f = fakeNasdaq();
    const s = new StockData({ key: () => null, nasdaq: f.n, now: () => now });
    const a = await s.candles('AAPL', '1d', 100);
    expect(a).toMatchObject({ exchange: 'nasdaq', symbol: 'AAPL', tf: '1d', pricePrecision: 2 });
    expect(a.candles).toHaveLength(100);
    await s.candles('AAPL', '1d', 100);
    expect(f.calls.daily).toBe(1);
    // Weekly bars come from the same daily history.
    const w = await s.candles('AAPL', '1w', 20);
    expect(w.candles.length).toBeLessThanOrEqual(20);
    now += 16 * 60_000;
    f.opts.fail = true;
    const stale = await s.candles('AAPL', '1d', 100);
    expect(stale.fetchedAt).toBeLessThan(now);
    expect(stale.candles).toHaveLength(100);
    expect(stale.notice).toBe('Nasdaq: HTTP 503');
  });

  it('keeps candles read outside the session until it opens again, whatever Nasdaq says about the next open', async () => {
    let now = Date.parse('2026-10-17T15:00:00Z'); // a Saturday
    let state: MarketStatus['state'] = 'closed';
    const f = fakeNasdaq();
    const n = f.n as unknown as { marketStatus: (now: number) => Promise<MarketStatus> };
    // On weekends the "opening time" Nasdaq reports can be in the past: it must not matter.
    n.marketStatus = async (t) => ({ state, label: '', opensAt: Date.parse('2026-10-16T13:30:00Z'), closesAt: null, fetchedAt: t });
    const s = new StockData({ key: () => null, nasdaq: f.n, now: () => now });
    await s.candles('AAPL', '1d', 50);
    now += 30 * 3_600_000;
    await s.candles('AAPL', '1d', 50);
    expect(f.calls.daily).toBe(1);
    // Monday's pre-market is still outside the session; the open brings fresh candles.
    state = 'pre';
    now = Date.parse('2026-10-19T12:00:00Z');
    await s.candles('AAPL', '1d', 50);
    expect(f.calls.daily).toBe(1);
    state = 'open';
    now = Date.parse('2026-10-19T13:40:00Z');
    await s.candles('AAPL', '1d', 50);
    expect(f.calls.daily).toBe(2);
    // Read during the session: the short TTL applies, then one more read after the close.
    now += 16 * 60_000;
    await s.candles('AAPL', '1d', 50);
    expect(f.calls.daily).toBe(3);
  });

  it('does not trust a market state Nasdaq could not confirm for a while', async () => {
    let now = Date.parse('2026-10-17T15:00:00Z');
    let down = false;
    const f = fakeNasdaq({ status: 'closed' });
    const n = f.n as unknown as { marketStatus: (now: number) => Promise<MarketStatus> };
    n.marketStatus = async (t) => {
      if (down) throw new Error('HTTP 403');
      return { state: 'closed', label: '', opensAt: null, closesAt: null, fetchedAt: t };
    };
    const s = new StockData({ key: () => null, nasdaq: f.n, now: () => now });
    await s.candles('AAPL', '1d', 50);
    // Nasdaq's state stops answering over the weekend; on Monday the chart refreshes on its normal TTL.
    down = true;
    now = Date.parse('2026-10-19T14:00:00Z');
    await s.candles('AAPL', '1d', 50);
    expect(f.calls.daily).toBe(2);
  });

  it('keeps quotes 15 minutes while the market is closed', async () => {
    let now = Date.parse('2026-10-17T15:00:00Z');
    const f = fakeNasdaq({ status: 'closed' });
    const s = new StockData({ key: () => null, nasdaq: f.n, now: () => now });
    await s.marketStatus();
    await s.quote('AAPL');
    now += 10 * 60_000;
    await s.marketStatus();
    await s.quote('AAPL');
    expect(f.calls.quote).toBe(1);
    now += 6 * 60_000;
    await s.marketStatus();
    await s.quote('AAPL');
    expect(f.calls.quote).toBe(2);
  });

  it('caches quotes a minute and keeps the last one on errors', async () => {
    let now = Date.parse('2026-10-13T15:00:00Z');
    const f = fakeNasdaq();
    const s = new StockData({ key: () => null, nasdaq: f.n, now: () => now });
    expect((await s.quote('AAPL')).last).toBe(340.97);
    await s.quote('AAPL');
    expect(f.calls.quote).toBe(1);
    now += 61_000;
    f.opts.fail = true;
    expect((await s.quote('AAPL')).last).toBe(340.97);
    await expect(s.quote('MSFT')).rejects.toThrow(/nu e listat/);
  });
});

describe('stock market context', () => {
  const cnn = {
    fear_and_greed: { score: 45.4, rating: 'neutral', timestamp: '2026-10-13T00:00:00+00:00', previous_close: 45.7, previous_1_week: 46.8 },
    fear_and_greed_historical: { data: [{ x: 1791763200000, y: 44 }, { x: 1791849600000, y: 45.4 }, { x: 1791849600000, y: 45.4 }] },
    market_momentum_sp500: { data: [{ x: 1791590400000, y: 7811.54 }, { x: 1791763200000, y: 7807.24 }, { x: 1791837301000, y: 7807.24 }] },
    market_volatility_vix: { data: [{ x: 1791590400000, y: 14.84 }, { x: 1791763200000, y: 15.21 }] },
  };

  it('reads CNN: one value a day, the change against the day before', () => {
    const r = parseCnn(cnn);
    expect(r.fearGreed).toMatchObject({ value: 45, rating: 'neutral', previousClose: 45.7 });
    expect(r.fearGreed.history).toEqual([
      { value: 44, timestamp: 1791763200000 },
      { value: 45.4, timestamp: 1791849600000 },
    ]);
    const spx = r.indices.find((i) => i.id === 'SPX');
    expect(spx?.last).toBe(7807.24);
    expect(spx?.changePct).toBeCloseTo(((7807.24 - 7811.54) / 7811.54) * 100, 6);
    expect(r.indices.find((i) => i.id === 'VIX')?.last).toBe(15.21);
  });

  it('stores the state always, CNN and the Nasdaq-100 hourly while the market is closed', async () => {
    const db = new Db(':memory:');
    let now = Date.parse('2026-10-13T06:00:00Z');
    const f = fakeNasdaq({ status: 'closed' });
    const s = new StockData({ key: () => null, nasdaq: f.n, now: () => now });
    let cnnCalls = 0;
    const fetchCnn = async () => {
      cnnCalls++;
      return cnn;
    };
    expect(await refreshStockContext(db, s, now, fetchCnn)).toEqual([]);
    const ctx = readStockContext(db);
    expect(ctx.market?.state).toBe('closed');
    expect(ctx.indices?.items.map((i) => i.id)).toEqual(['SPX', 'NDX', 'VIX']);
    expect(ctx.fearGreed?.value).toBe(45);
    now += 10 * 60_000;
    await refreshStockContext(db, s, now, fetchCnn);
    expect(cnnCalls).toBe(1);
    // A failing source keeps its last value.
    now += 61 * 60_000;
    await expect(refreshStockContext(db, s, now, async () => Promise.reject(new Error('HTTP 418')))).resolves.toEqual(['cnn fear&greed: HTTP 418']);
    expect(readStockContext(db).indices?.items.find((i) => i.id === 'SPX')?.last).toBe(7807.24);
  });
});
