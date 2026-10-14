import { afterEach, describe, expect, it } from 'vitest';
import { zonedTimeToUtc } from '../../shared/time.ts';
import { setFetchImpl } from '../net/http.ts';
import { CnbcClient, parseCnbcBars, parseCnbcQuotes } from './cnbc.ts';
import { mergeNy } from './indices.ts';

const NY = 'America/New_York';
const at = (day: string, hh: number, mm = 0) => zonedTimeToUtc(day, NY, hh, mm);
const bar = (day: string, hh: number, mm: number, o: number, h: number, l: number, c: number) => ({
  open: o.toFixed(4),
  high: h.toFixed(4),
  low: l.toFixed(4),
  close: c.toFixed(4),
  volume: 0,
  tradeTime: `${day.replace(/-/g, '')}${String(hh).padStart(2, '0')}${String(mm).padStart(2, '0')}00`,
  tradeTimeinMills: at(day, hh, mm),
});

describe('CNBC (FD-INDEXINTRA)', () => {
  afterEach(() => setFetchImpl(null));

  it('reads quotes: numbers with thousands separators and signs, the real-time flag, the New York day', () => {
    const q = parseCnbcQuotes({
      FormattedQuoteResult: {
        FormattedQuote: [
          { symbol: '.SPX', last: '7,702.31', change: '-103.14', change_pct: '-1.32%', open: '7,774.18', high: '7,789.15', low: '7,698.75', last_time: '2026-10-14T14:05:44.000-0400', realTime: 'true' },
          { symbol: '.VIX', last: '17.24', change: 'UNCH', change_pct: '+12.90%', last_time: 'n/a', realTime: 'false' },
        ],
      },
    });
    expect(q[0]).toEqual({ symbol: '.SPX', last: 7702.31, change: -103.14, changePct: -1.32, open: 7774.18, high: 7789.15, low: 7698.75, at: Date.parse('2026-10-14T18:05:44Z'), day: '2026-10-14', realTime: true });
    expect(q[1]).toMatchObject({ last: 17.24, change: null, changePct: 12.9, at: null, day: null, realTime: false });
    expect(parseCnbcQuotes({})).toEqual([]);
  });

  it('keeps only the regular session on intraday bars (the 9:00 hour bar is 9:30–10:00); daily keeps every full bar', () => {
    const json = {
      barData: {
        priceBars: [
          bar('2026-10-13', 9, 0, 100, 102, 99, 101),
          bar('2026-10-13', 15, 0, 101, 103, 100, 102),
          bar('2026-10-13', 16, 0, 102, 102, 102, 102),
          bar('2026-10-13', 18, 0, 102, 102, 102, 102),
          bar('2026-10-13', 8, 0, 99, 99, 99, 99),
          { ...bar('2026-10-13', 10, 0, 1, 1, 1, 1), open: '0.0000' },
        ],
      },
    };
    expect(parseCnbcBars(json, '1H').map((c) => c.t)).toEqual([at('2026-10-13', 9), at('2026-10-13', 15)]);
    // 5-minute bars: 9:25 ends at 9:30 (out), 9:30 is the first, 15:55 the last.
    const five = { barData: { priceBars: [bar('2026-10-13', 9, 25, 1, 1, 1, 1), bar('2026-10-13', 9, 30, 2, 3, 1, 2), bar('2026-10-13', 15, 55, 2, 2, 2, 2), bar('2026-10-13', 16, 0, 2, 2, 2, 2)] } };
    expect(parseCnbcBars(five, '5M').map((c) => c.c)).toEqual([2, 2]);
    expect(parseCnbcBars({ barData: { priceBars: [{ ...bar('2026-10-12', 0, 0, 7813.04, 7821.67, 7796.94, 7807.24) }] } }, '1D')[0]).toEqual({ t: at('2026-10-12', 0), o: 7813.04, h: 7821.67, l: 7796.94, c: 7807.24, v: 0 });
  });

  it('merges on the New York clock: 2h and 4h from 1h, 15m from 5m, never across days, each at its bucket start', () => {
    const hours = [9, 10, 11, 12, 13, 14, 15].map((h, i) => ({ t: at('2026-10-13', h), o: 100 + i, h: 110 + i, l: 90 + i, c: 105 + i, v: 1 }));
    const next = { t: at('2026-10-14', 9), o: 200, h: 210, l: 190, c: 205, v: 1 };
    const two = mergeNy([...hours, next], 120);
    expect(two.map((c) => c.t)).toEqual([at('2026-10-13', 8), at('2026-10-13', 10), at('2026-10-13', 12), at('2026-10-13', 14), at('2026-10-14', 8)]);
    expect(two[1]).toEqual({ t: at('2026-10-13', 10), o: 101, h: 112, l: 91, c: 107, v: 2 });
    const four = mergeNy(hours, 240);
    expect(four).toEqual([
      { t: at('2026-10-13', 8), o: 100, h: 112, l: 90, c: 107, v: 3 },
      { t: at('2026-10-13', 12), o: 103, h: 116, l: 93, c: 111, v: 4 },
    ]);
    const fives = [30, 35, 40, 45].map((m, i) => ({ t: at('2026-10-13', 9, m), o: i + 1, h: i + 2, l: i, c: i + 1.5, v: 0 }));
    expect(mergeNy(fives, 15)).toEqual([
      { t: at('2026-10-13', 9, 30), o: 1, h: 4, l: 0, c: 3.5, v: 0 },
      { t: at('2026-10-13', 9, 45), o: 4, h: 5, l: 3, c: 4.5, v: 0 },
    ]);
  });

  it('asks for the bars up to the day after the last one wanted (CNBC excludes the end), and says when it fails', async () => {
    const asked: string[] = [];
    setFetchImpl((async (input: string | URL | Request) => {
      asked.push(String(input));
      return new Response(JSON.stringify({ barData: { priceBars: [] } }), { status: 200 });
    }) as typeof fetch);
    await new CnbcClient().bars('.SPX', '1H', '2026-07-07', '2026-10-14');
    expect(asked).toEqual(['https://ts-api.cnbc.com/harmony/app/bars/.SPX/1H/20260707000000/20261015000000/adjusted/EST5EDT.json']);
    setFetchImpl((async () => new Response('{}', { status: 200 })) as typeof fetch);
    await expect(new CnbcClient().bars('.SPX', '1H', '2026-07-07', '2026-10-14')).rejects.toMatchObject({ message: 'CNBC: răspuns fără lumânări' });
    setFetchImpl((async () => new Response('busy', { status: 503 })) as typeof fetch);
    await expect(new CnbcClient().quotes(['.SPX'])).rejects.toMatchObject({ code: 'EXCHANGE_ERROR', message: 'CNBC: HTTP 503' });
  });
});
