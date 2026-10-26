// FD-EARNTV: the earnings date a company confirmed, from TradingView, over Nasdaq's estimate (SpaceX on 20 Oct 2026).
import { afterEach, describe, expect, it } from 'vitest';
import { testDb } from '../test/db.ts';
import { silentLogger, type Logger } from '../log.ts';
import { setFetchImpl } from '../net/http.ts';
import type { EarningsRow } from '../market/stocks.ts';
import { CalendarService, EARN_STALE_DAYS, formatEps, planEarnings } from './service.ts';
import { fetchTvEarnings, parseTvEarnings, TV_EARN_COLUMNS, TV_SCAN_URL, type TvEarnings } from './sources.ts';

/** A date as TradingView gives it: seconds at midnight UTC. */
const sec = (day: string) => Date.parse(`${day}T00:00:00Z`) / 1000;
/** One screener row, in the order of TV_EARN_COLUMNS. */
const tvRow = (
  exchange: string,
  name: string,
  o: { primary?: boolean; next?: string | null; pub?: number | null; time?: number; period?: string; eps?: number | null; last?: string | null; type?: string } = {},
) => ({
  s: `${exchange}:${name}`,
  d: [
    name,
    o.primary ?? true,
    o.next === undefined ? null : o.next && sec(o.next),
    o.pub ?? null,
    o.time ?? 0,
    o.period ? sec(o.period) : null,
    o.eps ?? null,
    o.last ? sec(o.last) : null,
    o.type ?? 'stock',
  ],
});
const answer = (...rows: unknown[]) => JSON.stringify({ totalCount: rows.length, data: rows });

describe("TradingView's earnings dates (FD-EARNTV)", () => {
  it('reads the next date, whether it is confirmed and when, the quarter, the EPS expected, the last publication', () => {
    const got = parseTvEarnings(
      answer(
        tvRow('NASDAQ', 'SPCX', { next: '2026-10-20', pub: 12, time: 1, period: '2026-09-30', eps: 0.134573, last: '2026-08-04' }),
        tvRow('NYSE', 'GE', { next: '2027-01-26', pub: 10, time: 0, period: '2026-12-31', eps: 2.04, last: '2026-10-20' }),
        tvRow('NYSE', 'ELV', { next: '2026-10-21', pub: 11, time: -1, period: '2026-09-30', eps: 7.1, last: '2026-07-17' }),
        tvRow('NYSE', 'NSC', { next: '2026-10-22', pub: 13, time: 0, period: '2026-09-30', eps: null, last: '2026-07-24' }),
        tvRow('AMEX', 'SPY', { type: 'fund' }),
      ),
    );
    expect(got.get('SPCX')).toEqual({ next: { day: '2026-10-20', time: 'after', confirmed: true, quarter: 'Sep/2026', eps: 0.134573 }, lastDay: '2026-08-04' });
    expect(got.get('GE')).toEqual({ next: { day: '2027-01-26', time: 'unknown', confirmed: false, quarter: 'Dec/2026', eps: 2.04 }, lastDay: '2026-10-20' });
    expect(got.get('ELV')?.next).toMatchObject({ time: 'pre', confirmed: true });
    expect(got.get('NSC')?.next).toMatchObject({ time: 'unknown', confirmed: true, eps: null });
    // A fund: no earnings.
    expect(got.get('SPY')).toEqual({ next: null, lastDay: null });
  });

  it('the same name twice: the row with earnings data, then the primary listing; broken rows skipped', () => {
    const got = parseTvEarnings(
      answer(
        tvRow('OTC', 'ABC', { primary: false }),
        tvRow('NYSE', 'ABC', { primary: false, next: '2026-10-22', pub: 12, time: 1 }),
        tvRow('NASDAQ', 'ABC', { primary: true }),
        tvRow('NYSE', 'XYZ', { primary: false, next: '2026-10-23', pub: 10 }),
        tvRow('NASDAQ', 'XYZ', { primary: true, next: '2026-10-24', pub: 12 }),
        { s: 'NYSE:BAD' },
        { s: 'NYSE:BAD2', d: [42] },
      ),
    );
    expect(got.get('ABC')?.next?.day).toBe('2026-10-22');
    expect(got.get('XYZ')?.next?.day).toBe('2026-10-24');
    expect([...got.keys()].sort()).toEqual(['ABC', 'XYZ']);
    expect(() => parseTvEarnings('<html>')).toThrow('TradingView: răspunsul nu e JSON');
    expect(() => parseTvEarnings('[1]')).toThrow('TradingView: răspuns neașteptat');
    expect(parseTvEarnings('{"totalCount":0,"data":[]}').size).toBe(0);
  });

  it('stocks without a single date: TradingView changed its columns (an error, so Nasdaq alone, with a warning); funds alone are fine', () => {
    expect(() => parseTvEarnings(answer(tvRow('NASDAQ', 'TSLA'), tvRow('NYSE', 'GE'), tvRow('AMEX', 'SPY', { type: 'fund' })))).toThrow(
      'TradingView: nicio dată de rezultate pentru 2 acțiuni (s-au schimbat coloanele?)',
    );
    expect(parseTvEarnings(answer(tvRow('AMEX', 'SPY', { type: 'fund' }), tvRow('NASDAQ', 'QQQ', { type: 'fund' }))).get('SPY')).toEqual({ next: null, lastDay: null });
    // A date out of range is none (not a crash).
    const odd = { s: 'NASDAQ:ODD', d: ['ODD', true, 1e20, 12, 1, 1e20, 1, null, 'stock'] };
    expect(parseTvEarnings(answer(odd, tvRow('NASDAQ', 'TSLA', { next: '2026-10-21', pub: 12 }))).get('ODD')).toEqual({ next: null, lastDay: null });
  });

  describe('the request', () => {
    afterEach(() => setFetchImpl(null));

    it('one POST for the stocks only (not indices); none without any; an HTTP error is an error', async () => {
      const sent: { url: string; init?: RequestInit }[] = [];
      setFetchImpl((async (url: string | URL | Request, init?: RequestInit) => {
        sent.push({ url: String(url), init });
        return new Response(answer(tvRow('NASDAQ', 'SPCX', { next: '2026-10-20', pub: 12, time: 1 })), { status: 200 });
      }) as typeof fetch);
      const got = await fetchTvEarnings(['SPCX', 'BRK.B', '^SPX', 'SPCX', 'bad one']);
      expect(got.get('SPCX')?.next?.confirmed).toBe(true);
      expect(sent).toHaveLength(1);
      expect(sent[0]?.url).toBe(TV_SCAN_URL);
      expect(sent[0]?.init?.method).toBe('POST');
      expect(JSON.parse(String(sent[0]?.init?.body))).toEqual({ filter: [{ left: 'name', operation: 'in_range', right: ['SPCX', 'BRK.B'] }], columns: [...TV_EARN_COLUMNS], range: [0, 6] });
      expect(await fetchTvEarnings(['^SPX'])).toEqual(new Map());
      expect(sent).toHaveLength(1);
      setFetchImpl((async () => new Response('denied', { status: 403 })) as typeof fetch);
      await expect(fetchTvEarnings(['SPCX'])).rejects.toThrow('TradingView a răspuns cu eroarea HTTP 403');
    });
  });
});

describe('the day planned from both (FD-EARNTV §1)', () => {
  const row = (symbol: string, time: EarningsRow['time'] = 'after'): EarningsRow => ({ symbol, name: symbol, time, quarter: 'Sep/2026', epsForecast: '$1.11', lastYearEps: '$1.06' });
  const tvOf = (o: Record<string, TvEarnings>) => new Map(Object.entries(o));
  const next = (day: string, confirmed = true, time: 'pre' | 'after' | 'unknown' = 'after', eps: number | null = 0.134573) => ({ day, time, confirmed, quarter: 'Sep/2026', eps });
  const ids = (events: { extId: string; period: string | null }[]) => events.map((e) => `${e.extId} ${e.period}`);
  const all = new Set(['SPCX', 'TSLA', 'GE', 'NVDA']);

  it('a date confirmed at TradingView alone shows (SpaceX today), with its EPS expected and no year-ago EPS', () => {
    const tv = tvOf({ SPCX: { next: next('2026-10-20'), lastDay: '2026-08-04' } });
    const events = planEarnings('2026-10-20', [row('GE', 'pre'), row('NFLX')], all, tv);
    expect(ids(events)).toEqual(['GE:2026-10-20 pre|Sep/2026||', 'SPCX:2026-10-20 after|Sep/2026|tv|tv']);
    expect(events[1]).toMatchObject({ title: 'SPCX: rezultate trimestriale', ts: Date.parse('2026-10-20T20:30:00Z'), allDay: false, forecast: '$0.13', previous: null });
  });

  it("Nasdaq's other date for a confirmed one goes; on the confirmed day, TradingView's time and Nasdaq's numbers", () => {
    const tv = tvOf({ SPCX: { next: next('2026-10-20'), lastDay: '2026-08-04' }, TSLA: { next: next('2026-10-21', true, 'pre'), lastDay: '2026-07-22' } });
    expect(planEarnings('2026-11-03', [row('SPCX', 'unknown')], all, tv)).toEqual([]);
    const tsla = planEarnings('2026-10-21', [row('TSLA', 'after')], all, tv);
    expect(ids(tsla)).toEqual(['TSLA:2026-10-21 pre|Sep/2026|tv|']);
    expect(tsla[0]).toMatchObject({ ts: Date.parse('2026-10-21T12:00:00Z'), forecast: '$1.11', previous: '$1.06' });
    // Confirmed with no time: Nasdaq's.
    const noTime = tvOf({ TSLA: { next: next('2026-10-21', true, 'unknown'), lastDay: null } });
    expect(ids(planEarnings('2026-10-21', [row('TSLA', 'pre')], all, noTime))).toEqual(['TSLA:2026-10-21 pre|Sep/2026|tv|']);
    expect(ids(planEarnings('2026-10-21', [row('TSLA', 'unknown')], all, noTime))).toEqual(['TSLA:2026-10-21 unknown|Sep/2026|tv|']);
  });

  it("an estimate at TradingView changes nothing; no word from TradingView: Nasdaq's, as before", () => {
    const tv = tvOf({ NVDA: { next: next('2026-11-25', false, 'unknown'), lastDay: '2026-08-26' } });
    expect(ids(planEarnings('2026-11-19', [row('NVDA', 'unknown')], all, tv))).toEqual(['NVDA:2026-11-19 unknown|Sep/2026||']);
    expect(planEarnings('2026-11-25', [], all, tv)).toEqual([]);
    expect(ids(planEarnings('2026-10-21', [row('TSLA'), row('NOT_WATCHED'), row('TSLA')], all, new Map()))).toEqual(['TSLA:2026-10-21 after|Sep/2026||']);
  });

  it('after a publication: that day stays; a Nasdaq date soon after is a stale estimate; the next quarter’s is not', () => {
    // SpaceX the day after its report: TradingView's next is an estimate months away, Nasdaq still says 3 Nov.
    const after = tvOf({ SPCX: { next: next('2027-02-02', false, 'unknown'), lastDay: '2026-10-20' }, GE: { next: next('2027-01-26', false), lastDay: '2026-10-20' } });
    expect(planEarnings('2026-11-03', [row('SPCX', 'unknown')], all, after)).toEqual([]);
    // The day of the report itself stays (results out today), with Nasdaq's time.
    expect(ids(planEarnings('2026-10-20', [row('GE', 'pre')], all, after))).toEqual(['GE:2026-10-20 pre|Sep/2026||']);
    // Even when TradingView already confirmed the next one.
    const confirmedNext = tvOf({ GE: { next: next('2027-01-27'), lastDay: '2026-10-20' } });
    expect(ids(planEarnings('2026-10-20', [row('GE', 'pre')], all, confirmedNext))).toEqual(['GE:2026-10-20 pre|Sep/2026||']);
    // 45 days on, a Nasdaq date can be the next quarter's.
    const day = (n: number) => new Date(Date.parse('2026-10-20T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
    expect(planEarnings(day(EARN_STALE_DAYS - 1), [row('SPCX')], all, after)).toEqual([]);
    expect(ids(planEarnings(day(EARN_STALE_DAYS), [row('SPCX')], all, after))).toEqual([`SPCX:${day(EARN_STALE_DAYS)} after|Sep/2026||`]);
  });

  it('the EPS written as Nasdaq writes it', () => {
    expect([formatEps(0.134573), formatEps(-0.09), formatEps(2), formatEps(null)]).toEqual(['$0.13', '-$0.09', '$2.00', null]);
    // Rounded before the sign: a tiny loss is no "-$0.00".
    expect([formatEps(-0.004), formatEps(-0.006), formatEps(0.004)]).toEqual(['$0.00', '-$0.01', '$0.00']);
  });
});

describe('the refresh with TradingView, on the test schema (FD-EARNTV §2, §3)', () => {
  const now = Date.parse('2026-10-20T19:30:00Z');
  const tv = new Map<string, TvEarnings>([
    ['SPCX', { next: { day: '2026-10-20', time: 'after', confirmed: true, quarter: 'Sep/2026', eps: 0.134573 }, lastDay: '2026-08-04' }],
    ['TSLA', { next: { day: '2026-10-21', time: 'after', confirmed: true, quarter: 'Sep/2026', eps: 0.45 }, lastDay: '2026-07-22' }],
  ]);
  const nasdaq = async (day: string): Promise<EarningsRow[]> =>
    day === '2026-10-21'
      ? [{ symbol: 'TSLA', name: 'Tesla, Inc.', time: 'after', quarter: 'Sep/2026', epsForecast: '$0.22', lastYearEps: '$0.37' }]
      : day === '2026-11-03'
        ? [{ symbol: 'SPCX', name: 'Space Exploration Technologies Corp.', time: 'unknown', quarter: 'Sep/2026', epsForecast: '$0.11', lastYearEps: null }]
        : [];

  async function setup() {
    const db = await testDb();
    for (const [i, [coin, name]] of [
      ['SPCX', 'Space Exploration Technologies Corp. Class A Common Stock'],
      ['TSLA', 'Tesla, Inc.'],
    ].entries()) {
      await db.run("INSERT INTO watchlist(coin, quote, position, aliases, added_at, kind, name) VALUES (?, 'USD', ?, '[]', 1, 'stock', ?)", [coin, i, name]);
    }
    return db;
  }

  it('SpaceX today from TradingView, Tesla tomorrow with Nasdaq’s numbers; the notes say where the date and numbers come from', async () => {
    const db = await setup();
    const cal = new CalendarService(db, silentLogger);
    let asked: string[] = [];
    expect(await cal.refreshEarnings(['SPCX', 'TSLA'], nasdaq, now, async (s) => ((asked = s), tv))).toBe(2);
    expect(asked).toEqual(['SPCX', 'TSLA']);
    const events = await cal.query({ userId: 1, from: now - 86_400_000, to: now + 14 * 86_400_000 });
    expect(events.map((e) => [e.title, e.ts, e.forecast, e.previous])).toEqual([
      ['Rezultate trimestriale Space Exploration Technologies', Date.parse('2026-10-20T20:30:00Z'), '$0.13', null],
      ['Rezultate trimestriale Tesla', Date.parse('2026-10-21T20:30:00Z'), '$0.22', '$0.37'],
    ]);
    expect(events[0]?.note).toBe(
      'Space Exploration Technologies își publică rezultatele trimestrului încheiat în septembrie 2026 după închiderea bursei (în jur de 16:30, ora New York-ului). Data e confirmată (TradingView). Prognoza este EPS-ul estimat de analiști (TradingView); Nasdaq nu are încă rezultatele în calendar.',
    );
    expect(events[1]?.note).toBe(
      'Tesla își publică rezultatele trimestrului încheiat în septembrie 2026 după închiderea bursei (în jur de 16:30, ora New York-ului). Data e confirmată (TradingView). Prognoza este EPS-ul estimat de analiști, iar Anterior este EPS-ul din același trimestru de anul trecut (Nasdaq).',
    );
  });

  it("TradingView down: Nasdaq's dates only, a warning, no job error; a Nasdaq day down keeps what it had", async () => {
    const db = await setup();
    const warned: string[] = [];
    const log: Logger = { ...silentLogger, warn: (m: string) => void warned.push(m) };
    const cal = new CalendarService(db, log);
    expect(await cal.refreshEarnings(['SPCX', 'TSLA'], nasdaq, now, async () => Promise.reject(new Error('TradingView a răspuns cu eroarea HTTP 403')))).toBe(1);
    expect(warned).toEqual(["earnings: TradingView unavailable, Nasdaq's dates only (TradingView a răspuns cu eroarea HTTP 403)"]);
    const ids = async () => (await db.all<{ ext_id: string }>("SELECT ext_id FROM calendar_raw WHERE source = N'earn' ORDER BY ts")).map((r) => r.ext_id);
    expect(await ids()).toEqual(['TSLA:2026-10-21']);
    // Today's Nasdaq request fails: today stays as it was, TradingView adds nothing to it.
    const failToday = async (day: string) => (day === '2026-10-20' ? Promise.reject(new Error('HTTP 503')) : nasdaq(day));
    await cal.refreshEarnings(['SPCX', 'TSLA'], failToday, now, async () => tv);
    expect(await ids()).toEqual(['TSLA:2026-10-21']);
    // Without TradingView at all (the old call): as before.
    await cal.refreshEarnings(['SPCX', 'TSLA'], nasdaq, now);
    expect(await ids()).toEqual(['TSLA:2026-10-21']);
  });

  it('an event stored before FD-EARNTV (no sources in its period) reads with the Nasdaq note', async () => {
    const db = await setup();
    const cal = new CalendarService(db, silentLogger);
    await db.run(
      `INSERT INTO calendar_raw(source, ext_id, title, currency, country, ts, all_day, impact, forecast, previous, period, fetched_at)
       VALUES (N'earn', N'TSLA:2026-10-21', N'TSLA: rezultate trimestriale', N'USD', N'US', ?, 0, N'High', N'$0.22', N'$0.37', N'after|Sep/2026', 1)`,
      [Date.parse('2026-10-21T20:30:00Z')],
    );
    const [e] = await cal.query({ userId: 1, from: now, to: now + 7 * 86_400_000 });
    expect(e?.note).toBe(
      'Tesla își publică rezultatele trimestrului încheiat în septembrie 2026 după închiderea bursei (în jur de 16:30, ora New York-ului). Prognoza este EPS-ul estimat de analiști, iar Anterior este EPS-ul din același trimestru de anul trecut (Nasdaq).',
    );
  });
});
