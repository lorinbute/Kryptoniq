// @ts-nocheck
/**
 * PineScript `request.security(symbol, timeframe, expression, gaps, lookahead)` of another symbol, for ports. The
 * merge is the library's: `securityOther` gives the index of the bar of the other symbol shown on each chart bar,
 * `securityOtherValues` the values of an expression, `securityLowerTf` the lower-timeframe bars inside each chart bar
 * (`request.security_lower_tf`). The bars of the other symbol come from the `bars` accessor of the chart context
 * (`symbolBarsOf`), already on the requested timeframe; the port computes its expression on them.
 *
 * `otherSymbolChart(chartBars, chart)` gives the chart argument of these functions from the chart context (timeframe
 * read from the bar spacing when the context has none); `{ other: chart?.symbolInfo?.(symbol) }` gives them the
 * exchange calendar of the other symbol. Rules and fallbacks without calendars: see the library's `securityOther`.
 *
 * Spread symbols ("A * B", "A / B") are not in the library: `spreadSymbols`, `spreadBars` and `spreadOptions` below.
 */

import { chartSessions, tradingDayTime, type Bar, type OtherSymbolChart, type OtherSymbolOptions, type SessionContext } from 'oakscriptjs';
import type { ChartContext } from './chart-context';
import { chartTimeframe } from './anchor-period';

export {
  securityOther, securityOtherValues, securityLowerTf, type OtherSymbolChart, type OtherSymbolOptions, type SymbolCalendar,
} from 'oakscriptjs';

/**
 * The chart argument of `securityOther` / `securityOtherValues` / `securityLowerTf`: the chart timeframe (the
 * context's, else read from the bar spacing, else "1D"), its exchange calendar (`timezone`, `session`), the time unit
 * of the bars (`timeUnit`, else ms when the first bar time is 1e12 or more) and the state of the last bar.
 */
export function otherSymbolChart(chartBars: ReadonlyArray<{ time: number }>, chart?: ChartContext): OtherSymbolChart {
  return {
    timeframe: chartTimeframe(chartBars, chart) || '1D',
    timezone: chart?.timezone,
    session: chart?.session,
    timeUnit: chart?.timeUnit ?? (chartBars.length > 0 && chartBars[0].time >= 1e12 ? 'ms' : 's'),
    lastBarConfirmed: chart?.lastBarConfirmed,
  };
}

const DAY = 86400000;
const UTC_24X7 = { timezone: 'Etc/UTC', session: '24x7' };

/** Time zone and session of a symbol, or null without them. */
interface Zone {
  timezone: string;
  session: NonNullable<ChartContext['session']>;
}

const calendars = new Map<string, SessionContext | null>();

/** The daily session context of the library for a zone (bar times in ms); null when it cannot read it. */
function dailyCalendarOf(zone: Zone | null): SessionContext | null {
  if (!zone) return null;
  const key = `${zone.timezone}|${typeof zone.session === 'string' ? zone.session : JSON.stringify(zone.session)}`;
  let context = calendars.get(key);
  if (context === undefined) {
    context = { timeframe: '1D', timezone: zone.timezone, session: zone.session, timeUnit: 'ms' };
    try {
      chartSessions(context);
    } catch {
      context = null;
    }
    // a few calendars per chart: keep the cache small
    if (calendars.size > 64) calendars.clear();
    calendars.set(key, context);
  }
  return context;
}

/**
 * Spread symbols: an expression of two tickers and an operator ("ECONOMICS:CNM2 * FX_IDC:CNYUSD", "A / B"), as the
 * symbol of `request.security`. The library has no spread symbols: a port asks for the bars of both tickers
 * (`spreadSymbols`), builds the bars of the spread (`spreadBars`) and merges them with `securityOtherValues` and the
 * options of the expression (`spreadOptions`). Rule measured on reference runs (41 spreads of economic series and
 * exchange rates, every close equal):
 * - one bar per trading day of either part, from the later of the first trading days of the two parts
 * - close = last close of A at or before that day (op) last close of B at or before that day (open = high = low =
 *   close, volume 0); the bar opens at 00:00 UTC of the day
 * - the spread trades every day on the UTC calendar ("24x7")
 * The trading day of a part comes from its time zone and session (`chart.symbolInfo`; an FX_IDC rate trades from
 * 22:00 UTC the day before, an FX rate from 17:00 New York); without them a bar that opens at 12:00 UTC or later
 * belongs to the next UTC day.
 */

/** An expression of `spreadSymbols`: one ticker, or two tickers and an operator. */
interface SpreadExpression {
  a: string;
  op?: '*' | '/';
  b?: string;
}

function parseSpread(expr: string): SpreadExpression {
  const s = expr.replace(/\s+/g, '');
  const m = /^([^*/]+)([*/])([^*/]+)$/.exec(s);
  return m ? { a: m[1], op: m[2] as '*' | '/', b: m[3] } : { a: s };
}

/**
 * Tickers of a symbol expression, once each, in their order: ["A", "B"] for "A * B" or "A / B", ["A"] for one ticker
 * (spaces removed).
 */
export function spreadSymbols(expr: string): string[] {
  const e = parseSpread(expr);
  return e.b !== undefined && e.b !== e.a ? [e.a, e.b] : [e.a];
}

/**
 * Options of `securityOther` / `securityOtherValues` for the bars of `spreadBars(expr, ...)`: the calendar of the
 * ticker for one ticker (`chart.symbolInfo`), the 24x7 UTC calendar for a spread.
 */
export function spreadOptions(expr: string, chart?: ChartContext): OtherSymbolOptions {
  const e = parseSpread(expr);
  return { other: e.op ? { ...UTC_24X7 } : chart?.symbolInfo?.(e.a) };
}

/** Trading day (00:00 UTC, ms) of each bar opening at `times` (ms); without a calendar, the noon rule of spreads. */
function spreadTradingDays(times: number[], zone: Zone | null): number[] {
  const calendar = dailyCalendarOf(zone);
  return times.map((t) => {
    const d = calendar ? tradingDayTime(t, calendar) : NaN;
    if (!Number.isNaN(d)) return d;
    const day = Math.floor(t / DAY) * DAY;
    return t - day >= DAY / 2 ? day + DAY : day;
  });
}

/**
 * Bars of a symbol expression (see `spreadSymbols`): for one ticker its bars as given; for a spread "A op B" the bars
 * built by the measured rule (see above), times in the unit of the given bars (`chart.timeUnit`; without it, ms when
 * the first bar time is 1e12 or more, else seconds). `barsBySymbol` gives the bars of each ticker (a Map or a
 * function), on a daily or higher timeframe.
 * @throws RangeError when the bars of a ticker of the expression are missing
 */
export function spreadBars(
  expr: string,
  barsBySymbol: ReadonlyMap<string, ReadonlyArray<Bar>> | ((symbol: string) => ReadonlyArray<Bar> | undefined),
  chart?: ChartContext,
): Bar[] {
  const get = (symbol: string): ReadonlyArray<Bar> => {
    const bars = typeof barsBySymbol === 'function' ? barsBySymbol(symbol) : barsBySymbol.get(symbol);
    if (!bars) throw new RangeError(`No bars for the symbol "${symbol}" of "${expr}"`);
    return bars;
  };
  const e = parseSpread(expr);
  if (!e.op || e.b === undefined) return get(e.a).slice();
  const a = get(e.a);
  const b = get(e.b);
  if (a.length === 0 || b.length === 0) return [];
  const unit = chart?.timeUnit === 'ms' || (chart?.timeUnit === undefined && a[0].time >= 1e12) ? 1 : 1000;
  const days = (bars: ReadonlyArray<Bar>, symbol: string) => {
    const info = chart?.symbolInfo?.(symbol);
    const zone = info?.timezone && info.session ? { timezone: info.timezone, session: info.session } : null;
    return spreadTradingDays(bars.map((x) => x.time * unit), zone);
  };
  const aDays = days(a, e.a);
  const bDays = days(b, e.b);
  const start = Math.max(aDays[0], bDays[0]);
  const out: Bar[] = [];
  let i = -1;
  let j = -1;
  while (i + 1 < a.length || j + 1 < b.length) {
    const next = Math.min(i + 1 < a.length ? aDays[i + 1] : Infinity, j + 1 < b.length ? bDays[j + 1] : Infinity);
    while (i + 1 < a.length && aDays[i + 1] <= next) i++;
    while (j + 1 < b.length && bDays[j + 1] <= next) j++;
    if (next < start) continue;
    const c = e.op === '*' ? a[i].close * b[j].close : a[i].close / b[j].close;
    out.push({ time: next / unit, open: c, high: c, low: c, close: c, volume: 0 });
  }
  return out;
}
