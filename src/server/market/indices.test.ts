import { afterEach, describe, expect, it } from 'vitest';
import type { Candle } from '../../shared/indicator/slingshot.ts';
import { addDays, zonedTimeToUtc } from '../../shared/time.ts';
import { CboeClient, type CboeQuote, IndexData, INDEX_SOURCES, parseCboeHistory, parseCboeQuote } from './indices.ts';
import type { CnbcClient, CnbcQuote } from './cnbc.ts';
import { setFetchImpl } from '../net/http.ts';
import { MarketError } from './market.ts';
import { StockData, type NasdaqClient } from './stocks.ts';

const NY = 'America/New_York';
const day = (d: string) => zonedTimeToUtc(d, NY);

/** `n` weekdays of Cboe-like bars ending 2026-10-13 (the day before "now"). */
function cboeDays(n = 300): Candle[] {
  const out: Candle[] = [];
  for (let d = '2026-10-13'; out.length < n; d = addDays(d, -1)) {
    const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (wd !== 0 && wd !== 6) out.unshift({ t: day(d), o: 100, h: 110, l: 90, c: 105, v: 0 });
  }
  return out;
}

function fakeCboe(opts: { today?: Candle | null; fail?: boolean } = {}) {
  const calls = { quote: 0, daily: 0 };
  const c = {
    quote: async (code: string, scale: number): Promise<CboeQuote> => {
      calls.quote++;
      if (opts.fail) throw new MarketError('EXCHANGE_ERROR', 'Cboe: HTTP 503');
      return { last: 7752.88 * scale, change: -52.57 * scale, changePct: -0.67, today: opts.today === undefined ? { t: day('2026-10-14'), o: 7774 * scale, h: 7789 * scale, l: 7747 * scale, c: 7752.88 * scale, v: 0 } : opts.today };
    },
    daily: async () => {
      calls.daily++;
      if (opts.fail) throw new MarketError('EXCHANGE_ERROR', 'Cboe: HTTP 503');
      return cboeDays();
    },
  };
  return { c: c as unknown as CboeClient, calls };
}

function fakeNasdaq() {
  const calls: { method: string; sym: string; cls?: string }[] = [];
  const n = {
    quote: async (sym: string, now: number, cls?: string) => {
      calls.push({ method: 'quote', sym, cls });
      return { symbol: sym, name: 'NASDAQ-100', last: 30229.81, change: -339.7, changePct: -1.11, status: 'Market Open', fetchedAt: now };
    },
    daily: async (sym: string, _from: string, _to: string, _limit: number, cls?: string) => {
      calls.push({ method: 'daily', sym, cls });
      return cboeDays(200);
    },
    today: async (sym: string, cls?: string) => {
      calls.push({ method: 'today', sym, cls });
      return null;
    },
    marketStatus: async (now: number) => ({ state: 'open' as const, label: 'Market Open', opensAt: null, closesAt: null, fetchedAt: now }),
  };
  return { n: n as unknown as NasdaqClient, calls };
}

const NOW = Date.parse('2026-10-14T15:00:00Z');

describe('Cboe parsing (FD-INDICES §2)', () => {
  it('reads the daily history at New York midnight, skipping rows without a full positive OHLC', () => {
    const json = {
      data: [
        { date: '1995-12-29', open: '0.000000', high: '616.180000', low: '612.110000', close: '615.930000', volume: '0.0' },
        { date: '2026-10-13', open: '7795.270000', high: '7814.150000', low: '7786.110000', close: '7805.450000', volume: '0.0' },
        { date: '2026-10-12', open: '7813.040000', high: '7821.670000', low: '7796.940000', close: '7807.240000', volume: '0.0' },
        { date: 'bad', open: '1', high: '1', low: '1', close: '1' },
        { date: '2026-10-09', open: 'x', high: '1', low: '1', close: '1' },
      ],
    };
    const c = parseCboeHistory(json, 1);
    expect(c.map((x) => x.t)).toEqual([day('2026-10-12'), day('2026-10-13')]);
    expect(c[1]).toEqual({ t: day('2026-10-13'), o: 7795.27, h: 7814.15, l: 7786.11, c: 7805.45, v: 0 });
    expect(parseCboeHistory({}, 1)).toEqual([]);
    expect(parseCboeHistory({ data: 'nope' }, 1)).toEqual([]);
  });

  it('scales DJX to the Dow (a hundredth of it)', () => {
    const c = parseCboeHistory({ data: [{ date: '2026-10-13', open: '520.93', high: '523.17', low: '515.88', close: '516.70' }] }, 100);
    expect(c[0]?.c).toBeCloseTo(51670, 6);
    expect(c[0]?.h).toBeCloseTo(52317, 6);
    expect(INDEX_SOURCES['^DJI']).toEqual({ cnbc: '.DJI', fallback: { from: 'cboe', code: '_DJX', scale: 100 } });
  });

  it('reads the quote and the session bar, without a bar before the first price of the day', () => {
    const q = parseCboeQuote(
      { data: { current_price: 7752.8799, price_change: -52.5703, price_change_percent: -0.6735, open: 7774.1802, high: 7789.1499, low: 7747.46, last_trade_time: '2026-10-14T10:48:27' } },
      1,
    );
    expect(q.last).toBeCloseTo(7752.8799, 6);
    expect(q.changePct).toBeCloseTo(-0.6735, 6);
    expect(q.today).toEqual({ t: day('2026-10-14'), o: 7774.1802, h: 7789.1499, l: 7747.46, c: 7752.8799, v: 0 });
    const early = parseCboeQuote({ data: { current_price: 7805.45, price_change: 0, price_change_percent: 0, open: 0, high: 0, low: 0, last_trade_time: '2026-10-14T08:00:00' } }, 1);
    expect(early.today).toBeNull();
    expect(parseCboeQuote({}, 1)).toEqual({ last: null, change: null, changePct: null, today: null });
  });
});

describe('CboeClient', () => {
  afterEach(() => setFetchImpl(null));

  it('reads from the delayed-quotes CDN; a refusal is an error of the source, never an unknown index', async () => {
    const asked: string[] = [];
    setFetchImpl((async (input: string | URL | Request) => {
      asked.push(String(input));
      return new Response('<html>Attention Required! | Cloudflare</html>', { status: 403 });
    }) as typeof fetch);
    await expect(new CboeClient().quote('_SPX', 1)).rejects.toMatchObject({ code: 'EXCHANGE_ERROR', message: 'Cboe: HTTP 403' });
    expect(asked).toEqual(['https://cdn-api.cboe.com/api/global/delayed_quotes/quotes/_SPX.json']);
    setFetchImpl((async () => new Response('not json', { status: 200 })) as typeof fetch);
    await expect(new CboeClient().daily('_VIX', 1)).rejects.toMatchObject({ code: 'EXCHANGE_ERROR', message: 'Cboe: răspuns neașteptat' });
  });
});

/** CNBC down: every index falls back to Nasdaq / Cboe. */
const downCnbc = {
  quotes: async () => Promise.reject(new MarketError('EXCHANGE_ERROR', 'CNBC: HTTP 503')),
  bars: async () => Promise.reject(new MarketError('EXCHANGE_ERROR', 'CNBC: HTTP 503')),
} as unknown as CnbcClient;

describe('IndexData, with CNBC down (the fallback)', () => {
  it('adds the session bar once, keeps the history 5 minutes and shares one download between callers', async () => {
    let now = NOW;
    const cboe = fakeCboe();
    const ix = new IndexData({ nasdaq: fakeNasdaq().n, cboe: cboe.c, cnbc: downCnbc, now: () => now, status: async () => null });
    const [a, b] = await Promise.all([ix.history('^SPX'), ix.history('^SPX')]);
    expect(a).toBe(b);
    expect(a.from).toBe('cboe');
    expect(cboe.calls.daily).toBe(1);
    expect(a.candles.at(-1)?.t).toBe(day('2026-10-14'));
    expect(a.candles.at(-2)?.t).toBe(day('2026-10-13'));
    now += 4 * 60_000;
    await ix.history('^SPX');
    expect(cboe.calls.daily).toBe(1);
    now += 2 * 60_000;
    await ix.history('^SPX');
    expect(cboe.calls.daily).toBe(2);
  });

  it('does not add a session bar the history already has, nor one before the open', async () => {
    const same = new IndexData({ nasdaq: fakeNasdaq().n, cboe: fakeCboe({ today: { t: day('2026-10-13'), o: 1, h: 1, l: 1, c: 1, v: 0 } }).c, cnbc: downCnbc, now: () => NOW, status: async () => null });
    expect((await same.history('^SPX')).candles.at(-1)).toMatchObject({ t: day('2026-10-13'), c: 105 });
    const early = new IndexData({ nasdaq: fakeNasdaq().n, cboe: fakeCboe({ today: null }).c, cnbc: downCnbc, now: () => NOW, status: async () => null });
    expect((await early.history('^VIX')).candles.at(-1)?.t).toBe(day('2026-10-13'));
  });

  it('asks Nasdaq for its own indices with the index asset class, and names them from the list', async () => {
    const nq = fakeNasdaq();
    const ix = new IndexData({ nasdaq: nq.n, cboe: fakeCboe().c, cnbc: downCnbc, now: () => NOW, status: async () => null });
    const q = await ix.quote('^NDX');
    expect(q).toMatchObject({ symbol: '^NDX', name: 'Nasdaq-100', last: 30229.81, changePct: -1.11 });
    expect((await ix.history('^COMP')).from).toBe('nasdaq');
    expect(nq.calls).toEqual([
      { method: 'quote', sym: 'NDX', cls: 'index' },
      { method: 'daily', sym: 'COMP', cls: 'index' },
      { method: 'today', sym: 'COMP', cls: 'index' },
    ]);
  });

  it('gives a Cboe quote the market state of the stock market, marked as delayed', async () => {
    const ix = new IndexData({
      nasdaq: fakeNasdaq().n,
      cboe: fakeCboe().c,
      cnbc: downCnbc,
      now: () => NOW,
      status: async () => ({ state: 'closed', label: 'Market Closed', opensAt: null, closesAt: null, fetchedAt: NOW }),
    });
    const q = await ix.quote('^DJI');
    expect(q).toMatchObject({ symbol: '^DJI', name: 'Dow Jones Industrial Average', status: 'Market Closed', delayed: true });
    expect(q.last).toBeCloseTo(775288, 6);
  });

  it('refuses an index that is not in the list', async () => {
    const ix = new IndexData({ nasdaq: fakeNasdaq().n, cboe: fakeCboe().c, cnbc: downCnbc, now: () => NOW, status: async () => null });
    await expect(ix.history('^DAX')).rejects.toMatchObject({ code: 'UNKNOWN_SYMBOL' });
    await expect(ix.quote('^DAX')).rejects.toMatchObject({ code: 'UNKNOWN_SYMBOL', message: 'Indice necunoscut: DAX' });
  });
});

/** CNBC up: real-time quotes, 300 daily bars ending yesterday, hourly bars of the last sessions. */
function fakeCnbc() {
  const calls: { method: string; symbol?: string; interval?: string; from?: string; to?: string }[] = [];
  const quote = (symbol: string): CnbcQuote => ({ symbol, last: 7702.31, change: -103.14, changePct: -1.32, open: 7774.18, high: 7789.15, low: 7698.75, at: Date.parse('2026-10-14T14:55:00Z'), day: '2026-10-14', realTime: true });
  const c = {
    quotes: async (symbols: string[]) => {
      calls.push({ method: 'quotes' });
      return symbols.map(quote);
    },
    bars: async (symbol: string, interval: string, from: string, to: string) => {
      calls.push({ method: 'bars', symbol, interval, from, to });
      if (interval === '1D') return cboeDays();
      // Hourly bars, 9:00 to 15:00, for the 30 weekdays up to 2026-10-14 (today: 9:00 and 10:00 so far).
      const out: Candle[] = [];
      for (const d of cboeDays(30).map((x) => x.t)) for (const h of [9, 10, 11, 12, 13, 14, 15]) out.push({ t: d + h * 3_600_000, o: 100, h: 101, l: 99, c: 100.5, v: 0 });
      for (const h of [9, 10]) out.push({ t: day('2026-10-14') + h * 3_600_000, o: 100, h: 101, l: 99, c: 100.5, v: 0 });
      return out;
    },
  };
  return { c: c as unknown as CnbcClient, calls };
}

describe('IndexData with CNBC (FD-INDEXINTRA)', () => {
  it('quotes in real time, all the indices in one request', async () => {
    const cnbc = fakeCnbc();
    const ix = new IndexData({ nasdaq: fakeNasdaq().n, cboe: fakeCboe().c, cnbc: cnbc.c, now: () => NOW, status: async () => null });
    expect(await ix.quote('^SPX')).toMatchObject({ symbol: '^SPX', name: 'S&P 500', last: 7702.31, changePct: -1.32, delayed: false });
    expect(await ix.quote('^COMP')).toMatchObject({ symbol: '^COMP', name: 'Nasdaq Composite', delayed: false });
    expect(cnbc.calls.filter((c) => c.method === 'quotes')).toHaveLength(1);
  });

  it('takes the daily history from CNBC, with the bar of today from the quote', async () => {
    const cnbc = fakeCnbc();
    const cboe = fakeCboe();
    const ix = new IndexData({ nasdaq: fakeNasdaq().n, cboe: cboe.c, cnbc: cnbc.c, now: () => NOW, status: async () => null });
    const h = await ix.history('^DJI');
    expect(h.from).toBe('cnbc');
    expect(h.candles.at(-1)).toEqual({ t: day('2026-10-14'), o: 7774.18, h: 7789.15, l: 7698.75, c: 7702.31, v: 0 });
    expect(cnbc.calls.find((c) => c.method === 'bars')).toMatchObject({ symbol: '.DJI', interval: '1D', from: '2010-01-01', to: '2026-10-14' });
    expect(cboe.calls.daily).toBe(0);
  });

  it('gives intraday candles: 1h as CNBC has them, 4h merged, as many days as asked, kept 30 s', async () => {
    let now = NOW;
    const cnbc = fakeCnbc();
    const ix = new IndexData({ nasdaq: fakeNasdaq().n, cboe: fakeCboe().c, cnbc: cnbc.c, now: () => now, status: async () => null });
    const one = await ix.intraday('^SPX', '1h', 100);
    expect(one).toHaveLength(100);
    expect(one.at(-1)?.t).toBe(day('2026-10-14') + 10 * 3_600_000);
    // 100 bars of 7 a session: 26 days back (1.5 × 100 / 7 + 4).
    expect(cnbc.calls.at(-1)).toMatchObject({ method: 'bars', symbol: '.SPX', interval: '1H', from: '2026-09-18', to: '2026-10-14' });
    // 4h is merged from the same hourly bars: no second read (20 bars need fewer days than were read).
    const four = await ix.intraday('^SPX', '4h', 20);
    expect(four.at(-1)).toMatchObject({ t: day('2026-10-14') + 8 * 3_600_000, o: 100, h: 101, l: 99, c: 100.5 });
    expect(cnbc.calls.filter((c) => c.method === 'bars')).toHaveLength(1);
    now += 20_000;
    await ix.intraday('^SPX', '1h', 100);
    expect(cnbc.calls.filter((c) => c.method === 'bars')).toHaveLength(1);
    // A longer ask reads further back; after 30 s everything is read again.
    await ix.intraday('^SPX', '1h', 300);
    expect(cnbc.calls.filter((c) => c.method === 'bars')).toHaveLength(2);
    now += 31_000;
    await ix.intraday('^SPX', '1h', 100);
    expect(cnbc.calls.filter((c) => c.method === 'bars')).toHaveLength(3);
    await expect(ix.intraday('^SPX', '6h', 10)).rejects.toMatchObject({ code: 'UNSUPPORTED_TIMEFRAME', message: 'Indicii nu au 6h' });
  });

  it('through StockData: 1h candles named CNBC, the bar of the hour still open', async () => {
    const s = new StockData({ key: async () => null, nasdaq: fakeNasdaq().n, cboe: fakeCboe().c, cnbc: fakeCnbc().c, now: () => NOW });
    const r = await s.candles('^SPX', '1h', 50, 1);
    expect(r).toMatchObject({ exchange: 'cnbc', symbol: '^SPX', tf: '1h' });
    expect(r.candles).toHaveLength(50);
    // NOW is 11:00 in New York: the 10:00 bar has just closed.
    expect(r.lastClosedIndex).toBe(49);
  });
});

describe('StockData with indices', () => {
  const make = (cboe = fakeCboe(), cnbc: CnbcClient = downCnbc) => ({ s: new StockData({ key: async () => 'td-key', nasdaq: fakeNasdaq().n, cboe: cboe.c, cnbc, now: () => NOW }), cboe });

  it('serves daily and weekly from the fallback when CNBC is down, even with a Twelve Data key', async () => {
    const { s, cboe } = make();
    expect(await s.timeframesFor('^SPX', 1)).toEqual(['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '1d', '1w']);
    expect(await s.timeframesFor('AAPL', 1)).toContain('1h');
    const d = await s.candles('^SPX', '1d', 100, 1);
    expect(d).toMatchObject({ exchange: 'cboe', symbol: '^SPX', tf: '1d', pricePrecision: 2 });
    expect(d.candles).toHaveLength(100);
    expect(d.candles.at(-1)?.t).toBe(day('2026-10-14'));
    // The session's bar is still open.
    expect(d.lastClosedIndex).toBe(98);
    const w = await s.candles('^spx', '1w', 50, 1);
    expect(w.candles.length).toBeGreaterThan(40);
    expect(w.candles.length).toBeLessThanOrEqual(50);
    // 1d, 1w and the spark line came from one download.
    expect((await s.spark('^SPX')).closes).toHaveLength(60);
    expect(cboe.calls.daily).toBe(1);
    await expect(s.candles('^SPX', '6h', 100, 1)).rejects.toMatchObject({ code: 'UNSUPPORTED_TIMEFRAME', message: 'Indicii nu au 6h' });
    // Intraday has no fallback: the reason is said.
    await expect(s.candles('^SPX', '1h', 100, 1)).rejects.toMatchObject({ code: 'EXCHANGE_ERROR', message: expect.stringMatching(/^Datele intraday ale indicilor nu sunt disponibile acum/) });
    await expect(s.candles('^DAX', '1d', 100, 1)).rejects.toMatchObject({ code: 'UNKNOWN_SYMBOL' });
  });

  it('quotes an index under its id; a source that fails with nothing loaded yet is an error', async () => {
    const { s } = make();
    expect(await s.quote('^SPX')).toMatchObject({ symbol: '^SPX', name: 'S&P 500', last: 7752.88 });
    const failing = make(fakeCboe({ fail: true })).s;
    await expect(failing.candles('^SPX', '1d', 100, 1)).rejects.toMatchObject({ code: 'EXCHANGE_ERROR' });
  });
});
