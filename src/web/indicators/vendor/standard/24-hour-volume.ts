// @ts-nocheck
/**
 * 24-hour Volume
 *
 * Traded value of the last 24 hours, as columns: the sum of price x volume of the bars of a lower timeframe whose
 * open time is less than 24 hours before the latest of them ("1" minute bars on seconds and minutes charts, "5" on
 * daily charts, "60" on weekly and monthly charts). Each chart bar shows the sum at the last lower bar that closed
 * by its close.
 *
 * Based on the standard 24-hour Volume indicator.
 *
 * Lower timeframe: the bars of the chart symbol on that timeframe come from the chart context
 * (`chart.bars(tickerid, timeframe)`, see `requiredSymbols`); with them the values are the original ones. When the
 * host does not give them, the port ESTIMATES the sums from the chart bars: the same 24-hour window on the chart bars,
 * with the price and the volume of each chart bar (the window covers the same 24 hours, but close x volume of a chart
 * bar is not the sum of close x volume of its lower bars). On a chart of the lower timeframe itself ("1" minute) the
 * chart bars are the lower bars and the values are exact; on seconds charts the 1-minute bars are built from the
 * chart bars. Also, the original only has values where its lower-timeframe data exists (na before), the estimate has
 * them on every bar.
 *
 * Limits:
 * - The volume of the symbol is taken in base units (price x volume). The original uses the volume as it is for
 *   symbols whose volume is quoted in the currency, and stops with an error for crypto symbols with tick volume; the
 *   chart context does not give the volume type.
 * - 'Target Currency': "Default" (no conversion) and the currency of the symbol (rate 1) are ported. The original
 *   converts to another currency with daily exchange rates that the port does not have: it throws an Error.
 * - As the original, an Error is thrown when the volume of every bar is 0 or missing.
 */

import {
  array, mapToChart, timeframe, type Bar, type IndicatorResult, type InputConfig, type PlotConfig, type SourceType,
} from 'oakscriptjs';
import { chartTimeframe, higherTimeframeBars } from '../anchor-period';
import { currencyOf, tickeridOf, type ChartContext, type SymbolRequest } from '../chart-context';
import { otherSymbolChart, securityOtherValues } from '../other-symbol';

type Currency = 'Default' | 'USD' | 'EUR' | 'CAD' | 'JPY' | 'GBP' | 'HKD' | 'CNY' | 'NZD' | 'RUB';

export interface TwentyFourHourVolumeInputs {
  /** Price multiplied by the volume (in base units) */
  price: SourceType | 'volume';
  /** Currency of the values ("Default": the currency of the symbol) */
  currency: Currency;
}

export const defaultInputs: TwentyFourHourVolumeInputs = {
  price: 'close',
  currency: 'Default',
};

export const inputConfig: InputConfig[] = [
  {
    id: 'price', type: 'source', title: 'Price Source', defval: 'close',
    tooltip: "If the symbol's volume is expressed in base units, it is multiplied by this value to convert it into a price.",
  },
  {
    id: 'currency', type: 'string', title: 'Target Currency', defval: 'Default',
    options: ['Default', 'USD', 'EUR', 'CAD', 'JPY', 'GBP', 'HKD', 'CNY', 'NZD', 'RUB'], display: 'data_window',
  },
];

export const plotConfig: PlotConfig[] = [
  { id: 'plot0', title: '24H Volume', color: '#2962FF', lineWidth: 1, style: 'columns' },
];

export const metadata = {
  title: '24-hour Volume',
  shortTitle: '24H Vol',
  overlay: false,
};

const NO_VOLUME_ERROR = "The data vendor doesn't provide volume data for this symbol.";
/** msIn24h = 24 * 60 * 60 * 1000 */
const MS_IN_24H = 24 * 60 * 60 * 1000;

/** sumVolTF: "1" on seconds and minutes charts, "5" on daily charts, "60" above; '' when the chart timeframe is unknown */
function sumVolTimeframe(chartTf: string): string {
  if (chartTf === '') return '';
  const info = timeframe.info(chartTf);
  return info.isminutes || info.isseconds ? '1' : info.isdaily ? '5' : '60';
}

/** How the lower timeframe is read: the chart bars, a request to the host, or 1-minute bars built from the chart bars */
function requestKind(chartTf: string, tf: string): 'chart' | 'lower' | 'higher' {
  if (tf === '') return 'chart';
  const a = timeframe.in_seconds(tf);
  const b = timeframe.in_seconds(chartTf);
  return a === b ? 'chart' : a < b ? 'lower' : 'higher';
}

/**
 * Bars the indicator reads from the chart context: the chart symbol on the lower timeframe of the sums (none on
 * 1-minute and seconds charts). Without them the values are estimated from the chart bars.
 */
export function requiredSymbols(_inputs: Partial<TwentyFourHourVolumeInputs> = {}, chart?: ChartContext): SymbolRequest[] {
  const chartTf = chartTimeframe([], chart);
  const tf = sumVolTimeframe(chartTf);
  return requestKind(chartTf, tf) === 'lower' ? [{ symbol: tickeridOf(chart), timeframe: tf }] : [];
}

/** input.source value of a bar */
function sourceOf(b: Bar, source: SourceType | 'volume'): number {
  switch (source) {
    case 'open': return b.open;
    case 'high': return b.high;
    case 'low': return b.low;
    case 'hl2': return (b.high + b.low) / 2;
    case 'hlc3': return (b.high + b.low + b.close) / 3;
    case 'ohlc4': return (b.open + b.high + b.low + b.close) / 4;
    case 'hlcc4': return (b.high + b.low + b.close + b.close) / 4;
    case 'volume': return b.volume ?? NaN;
    default: return b.close;
  }
}

/**
 * sum24hVol(src) on a series of bars: getSeries `rollOnTimeWhen(src, msIn24h)` (the values of the bars whose time is
 * less than 24 hours before the current bar, at least the current one) then `array.sum` (na values skipped).
 */
function sum24hVol(bars: ReadonlyArray<Bar>, values: number[], unitMs: number): number[] {
  const out: number[] = [];
  let first = 0;
  for (let i = 0; i < bars.length; i++) {
    // while sources.size() > math.max(minBars, 0) and time - times.first() >= timeWindow
    while (i - first + 1 > 1 && ((bars[i].time as number) - (bars[first].time as number)) * unitMs >= MS_IN_24H) first++;
    out.push(array.sum(values.slice(first, i + 1)));
  }
  return out;
}

export function calculate(bars: Bar[], inputs: Partial<TwentyFourHourVolumeInputs> = {}, chart?: ChartContext): IndicatorResult {
  const { price, currency: currencyInput } = { ...defaultInputs, ...inputs };
  const n = bars.length;

  // var cumVol = 0.; cumVol += nz(volume); if barstate.islast and cumVol == 0: runtime.error(noVolumeError)
  const cumVol = bars.reduce((s, b) => s + (Number.isNaN(b.volume ?? NaN) ? 0 : (b.volume as number)), 0);
  if (n > 0 && Math.abs(cumVol) <= 1e-10) throw new Error(NO_VOLUME_ERROR);

  // request.currency_rate(syminfo.currency, currency): 1 without a conversion
  if (currencyInput !== 'Default' && currencyInput !== currencyOf(chart)) {
    throw new Error(`24-hour Volume: the conversion to the target currency ${currencyInput} needs daily exchange rates that are not available; use "Default".`);
  }

  // expr = syminfo.volumetype == "quote" ? volume : price * volume (volume in base units)
  const exprOf = (series: ReadonlyArray<Bar>) => series.map((b) => sourceOf(b, price) * (b.volume ?? NaN));
  const unitMs = (chart?.timeUnit ?? (n > 0 && bars[0].time >= 1e12 ? 'ms' : 's')) === 'ms' ? 1 : 1000;

  // vol24h = request.security(syminfo.tickerid, sumVolTF, sum24hVol(expr * rate))
  const chartTf = chartTimeframe(bars, chart);
  const tf = sumVolTimeframe(chartTf);
  const kind = requestKind(chartTf, tf);
  let vol24h: number[];
  const symbol = tickeridOf(chart);
  const lower = kind === 'lower' ? chart?.bars?.(symbol, tf) : undefined;
  if (lower) {
    // the lower bars of the host: the original values
    vol24h = securityOtherValues(bars, lower, tf, sum24hVol(lower, exprOf(lower), unitMs), otherSymbolChart(bars, chart),
      { other: chart?.symbolInfo?.(symbol) });
  } else if (kind === 'higher') {
    // 1-minute bars built from the seconds bars; the value of the last completed one (no lookahead)
    const htf = higherTimeframeBars(bars, tf, chart);
    vol24h = mapToChart(sum24hVol(htf.htf, exprOf(htf.htf), unitMs), htf.group, htf.latest, false, false);
  } else {
    // the chart timeframe (exact), or the estimate from the chart bars when the lower bars are missing
    vol24h = sum24hVol(bars, exprOf(bars), unitMs);
  }

  return {
    metadata: { title: metadata.title, shorttitle: metadata.shortTitle, overlay: metadata.overlay },
    plots: {
      // plot(vol24h, title = "24H Volume", style = plot.style_columns)
      plot0: bars.map((b, i) => ({ time: b.time, value: Number.isFinite(vol24h[i]) ? vol24h[i] : NaN })),
    },
  };
}

export const TwentyFourHourVolume = {
  calculate,
  metadata,
  defaultInputs,
  inputConfig,
  plotConfig,
};
