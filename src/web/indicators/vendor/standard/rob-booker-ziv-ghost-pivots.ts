// @ts-nocheck
/**
 * Rob Booker - Ziv Ghost Pivots
 *
 * The typical price (hlc3) of the current 4-hour, day, week and month bar, shown on every chart bar of that period
 * as a character at that price ("8", "d", "w", "m"), with the close as a line. The higher-timeframe values are read
 * with lookahead: a bar shows the hlc3 of its whole period (including the bars after it), and the bars of the last
 * period show the hlc3 of the bars so far.
 *
 * Based on the standard Rob Booker - Ziv Ghost Pivots indicator. As in the original, the "8" character follows
 * 'Show Next Day (8 HR) Pivot' and 'Show Next 4 HR Pivot' has no effect.
 *
 * Timeframes above the chart timeframe: the original reads the bars of the data vendor on that timeframe. For D / W / M
 * the port takes the bars of the chart symbol on that timeframe from the chart context when the host gives them
 * (`chart.bars(tickerid, timeframe)`, listed by `requiredSymbols` on intraday charts): each chart bar shows the bar
 * that opened at or before it. This matters on stocks, whose daily bars (official close, consolidated high / low)
 * differ from the intraday bars of the day. When the host does not give them, and for 240, the bars of the
 * timeframe are built from the chart bars; with the time zone and session of the chart context the periods are those
 * of the exchange calendar, else the UTC rule of src/anchor-period.ts. A timeframe equal to the chart timeframe is
 * the chart bars. A timeframe below the chart timeframe (4 hours on a daily chart, ...) needs the bars of the chart
 * symbol on that timeframe from the chart context; each chart bar then shows the first of its lower bars (the last
 * one that opened by the open of the chart bar). Without them `calculate` throws a `MissingSymbolDataError`.
 */

import { mapToChart, timeframe, type Bar, type IndicatorResult, type InputConfig, type PlotConfig } from 'oakscriptjs';
import type { MarkerData, OutputDecl, OutputValues } from '../types';
import { chartTimeframe, higherTimeframeBars } from '../anchor-period';
import { symbolBarsOf, tickeridOf, type ChartContext, type SymbolRequest } from '../chart-context';
import { otherSymbolChart, securityOtherValues } from '../other-symbol';

export interface RobBookerZivGhostPivotsInputs {
  /** Show Next 4 HR Pivot (no effect, as in the original) */
  s4: boolean;
  /** Show Next Day (8 HR) Pivot: the "8" and "d" characters */
  sd: boolean;
  /** Show Next Week Pivot */
  sw: boolean;
  /** Show Next Month Pivot */
  sm: boolean;
}

export const defaultInputs: RobBookerZivGhostPivotsInputs = {
  s4: true,
  sd: true,
  sw: true,
  sm: true,
};

export const inputConfig: InputConfig[] = [
  { id: 's4', type: 'bool', title: 'Show Next 4 HR Pivot', defval: true, display: 'none' },
  { id: 'sd', type: 'bool', title: 'Show Next Day (8 HR) Pivot', defval: true, display: 'none' },
  { id: 'sw', type: 'bool', title: 'Show Next Week Pivot', defval: true, display: 'none' },
  { id: 'sm', type: 'bool', title: 'Show Next Month Pivot', defval: true, display: 'none' },
];

export const plotConfig: PlotConfig[] = [
  { id: 'plot0', title: 'Close Price', color: '#00BCD4', lineWidth: 1 },
];

export const metadata = {
  title: 'Rob Booker - Ziv Ghost Pivots',
  shortTitle: 'Ghost Pivots',
  overlay: true,
};

/** The four requests: timeframe, character, colour, input that shows it */
const PIVOTS: ReadonlyArray<{ tf: string; char: string; color: string; show: keyof RobBookerZivGhostPivotsInputs }> = [
  { tf: '240', char: '8', color: '#00BCD4', show: 'sd' },
  { tf: 'D', char: 'd', color: '#2962FF', show: 'sd' },
  { tf: 'W', char: 'w', color: '#673AB7', show: 'sw' },
  { tf: 'M', char: 'm', color: '#E91E63', show: 'sm' },
];

/** Timeframes of the requests in use that are below the chart timeframe */
function lowerRequests(cfg: RobBookerZivGhostPivotsInputs, chartTf: string): string[] {
  if (chartTf === '') return [];
  const chartSeconds = timeframe.in_seconds(chartTf);
  return PIVOTS.filter((p) => cfg[p.show] && timeframe.in_seconds(p.tf) < chartSeconds).map((p) => p.tf);
}

/** Timeframes of the requests in use that are above the chart timeframe and read from the host when it has them (D / W / M) */
function higherRequests(cfg: RobBookerZivGhostPivotsInputs, chartTf: string): string[] {
  if (chartTf === '') return [];
  const chartSeconds = timeframe.in_seconds(chartTf);
  return PIVOTS.filter((p) => cfg[p.show] && p.tf !== '240' && timeframe.in_seconds(p.tf) > chartSeconds).map((p) => p.tf);
}

/**
 * Bars the indicator reads from the chart context: the chart symbol on the timeframes of the requests in use that are
 * below the chart timeframe (needed: none on charts of 4 hours or less), and on intraday charts on D / W / M (optional:
 * without them these bars are built from the chart bars).
 */
export function requiredSymbols(inputs: Partial<RobBookerZivGhostPivotsInputs> = {}, chart?: ChartContext): SymbolRequest[] {
  const cfg = { ...defaultInputs, ...inputs };
  const symbol = tickeridOf(chart);
  const chartTf = chartTimeframe([], chart);
  const intraday = chartTf !== '' && timeframe.in_seconds(chartTf) < 86400;
  return [...lowerRequests(cfg, chartTf), ...(intraday ? higherRequests(cfg, chartTf) : [])]
    .map((tf) => ({ symbol, timeframe: tf }));
}

const hlc3 = (b: Bar) => (b.high + b.low + b.close) / 3;

export function calculate(bars: Bar[], inputs: Partial<RobBookerZivGhostPivotsInputs> = {}, chart?: ChartContext): IndicatorResult & { outputValues: OutputValues } {
  const cfg = { ...defaultInputs, ...inputs };
  const chartTf = chartTimeframe(bars, chart);
  const chartSeconds = chartTf === '' ? NaN : timeframe.in_seconds(chartTf);
  const symbol = tickeridOf(chart);
  const lower = lowerRequests(cfg, chartTf);
  const lowerBars = symbolBarsOf(lower.map((tf) => ({ symbol, timeframe: tf })), chart);

  // request.security(syminfo.tickerid, tf, hlc3[0], barmerge.gaps_off, barmerge.lookahead_on)
  const security = (tf: string): number[] => {
    const k = lower.indexOf(tf);
    if (k >= 0) {
      const other = lowerBars[k];
      return securityOtherValues(bars, other, tf, other.map(hlc3), otherSymbolChart(bars, chart),
        { lookahead: true, other: chart?.symbolInfo?.(symbol) });
    }
    if (chartTf === '' || timeframe.in_seconds(tf) === chartSeconds) return bars.map(hlc3);
    // D / W / M bars of the host when it gives them
    const own = tf !== '240' ? chart?.bars?.(symbol, tf) : undefined;
    if (own) {
      return securityOtherValues(bars, own, tf, own.map(hlc3), otherSymbolChart(bars, chart),
        { lookahead: true, other: chart?.symbolInfo?.(symbol) });
    }
    // else the bars of the timeframe built from the chart bars
    const htf = higherTimeframeBars(bars, tf, chart);
    return mapToChart(htf.htf.map(hlc3), htf.group, htf.latest, true, false);
  };

  const markers: MarkerData[] = [];
  const outputValues: OutputValues = {};
  for (const p of PIVOTS) {
    // x = show == true ? request.security(...) : na
    if (!cfg[p.show]) continue;
    const values = security(p.tf);
    outputValues[`pivot${p.tf}`] = bars.flatMap((b, i) => (Number.isFinite(values[i]) ? [{ time: b.time as number, value: values[i] }] : []));
    // plotchar(x, color = c, char = ch, text = "", location = location.absolute)
    bars.forEach((b, i) => {
      const v = values[i];
      if (!Number.isFinite(v)) return;
      markers.push({ time: b.time as number, position: 'atPriceMiddle', price: v, shape: 'circle', char: p.char, color: p.color, id: `pivot${p.tf}` });
    });
  }

  return {
    metadata: { title: metadata.title, shorttitle: metadata.shortTitle, overlay: metadata.overlay },
    plots: {
      // plot(close, "Close Price", color = #00BCD4)
      plot0: bars.map((b) => ({ time: b.time, value: b.close })),
    },
    markers,
    outputValues,
  };
}

/** Reference outputs: the close line, then one character per period (4 hours, day, week, month). */
export const outputs: OutputDecl[] = [
  { kind: 'plot', id: 'plot0' },
  ...PIVOTS.map((p): OutputDecl => ({ kind: 'char', id: `pivot${p.tf}`, title: 'Chars' })),
];

export const RobBookerZivGhostPivots = {
  outputs,
  calculate,
  metadata,
  defaultInputs,
  inputConfig,
  plotConfig,
};
