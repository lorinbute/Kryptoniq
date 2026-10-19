// @ts-nocheck
/**
 * Correlation Coefficient
 *
 * Pearson correlation, over the last 'Length' bars, between the source of the chart symbol and the same source of
 * another symbol ('Symbol') on the chart timeframe. +1: the two move together, -1: they move in opposite directions.
 *
 * Based on the standard Correlation Coefficient indicator.
 *
 * The bars of the other symbol come from the chart context (`chart.bars(symbol, chart timeframe)`, see
 * `requiredSymbols`); without them `calculate` throws a `MissingSymbolDataError`. The source is computed on the bars
 * of the other symbol, then each chart bar shows the last bar of the other symbol that closed at or before it (no
 * lookahead, no gaps; repeated on chart bars where the other symbol has no bar). The close times and trading days
 * come from the time zone and session of both symbols (`chart` and `chart.symbolInfo(symbol)`); without them the
 * UTC rule of the library is used.
 */

import { ta, Series, type Bar, type IndicatorResult, type InputConfig, type PlotConfig, type HLineConfig, type SourceType, getSource } from 'oakscriptjs';
import { symbolBarsOf, type ChartContext, type SymbolRequest } from '../chart-context';
import { chartTimeframe } from '../anchor-period';
import { otherSymbolChart, securityOtherValues } from '../other-symbol';

export interface CorrelationCoefficientInputs {
  /** Other symbol */
  symbol: string;
  /** Source, read on both symbols */
  source: SourceType | 'volume';
  /** Number of bars of the correlation */
  length: number;
}

export const defaultInputs: CorrelationCoefficientInputs = {
  symbol: 'GOOG',
  source: 'close',
  length: 20,
};

export const inputConfig: InputConfig[] = [
  { id: 'symbol', type: 'symbol', title: 'Symbol', defval: 'GOOG', confirm: true },
  { id: 'source', type: 'source', title: 'Source', defval: 'close' },
  { id: 'length', type: 'int', title: 'Length', defval: 20 },
];

export const plotConfig: PlotConfig[] = [
  { id: 'plot0', title: 'Correlation', color: '#2962FF', lineWidth: 1 },
];

export const hlineConfig: HLineConfig[] = [
  { id: 'hline_1', price: 1, color: '#787B86', linestyle: 'dashed', linewidth: 1 },
  { id: 'hline_0', price: 0, color: '#787B8680', linestyle: 'dashed', linewidth: 1 },
  { id: 'hline_minus1', price: -1, color: '#787B86', linestyle: 'dashed', linewidth: 1 },
];

export const metadata = {
  title: 'Correlation Coefficient',
  shortTitle: 'CC',
  overlay: false,
};

/** Bars of the other symbol the indicator needs: 'Symbol' on the chart timeframe. */
export function requiredSymbols(inputs: Partial<CorrelationCoefficientInputs> = {}, chart?: ChartContext): SymbolRequest[] {
  const { symbol } = { ...defaultInputs, ...inputs };
  return [{ symbol, timeframe: chartTimeframe([], chart) }];
}

/** Source value of each bar (input.source: the price sources and volume) */
function sourceOf(bars: ReadonlyArray<Bar>, source: SourceType | 'volume'): number[] {
  return bars.map((b) => {
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
  });
}

export function calculate(bars: Bar[], inputs: Partial<CorrelationCoefficientInputs> = {}, chart?: ChartContext): IndicatorResult {
  const { symbol, source, length } = { ...defaultInputs, ...inputs };
  const tf = chartTimeframe(bars, chart);
  const [other] = symbolBarsOf([{ symbol, timeframe: tf }], chart);

  // requestedData = request.security(ticker.modify(symbolInput), timeframe.period, sourceInput)
  const requested = securityOtherValues(bars, other, '', sourceOf(other, source), otherSymbolChart(bars, chart),
    { other: chart?.symbolInfo?.(symbol) });
  // correlation = ta.correlation(sourceInput, requestedData, lengthInput)
  const correlation = ta.correlation(Series.fromArray(bars, getSource(bars, source as SourceType)), Series.fromArray(bars, requested), length)
    .toArray();

  return {
    metadata: { title: metadata.title, shorttitle: metadata.shortTitle, overlay: metadata.overlay },
    plots: {
      plot0: bars.map((b, i) => {
        const v = correlation[i];
        return { time: b.time, value: v === null || v === undefined || !Number.isFinite(v) ? NaN : v };
      }),
    },
  };
}

export const CorrelationCoefficient = {
  calculate,
  metadata,
  defaultInputs,
  inputConfig,
  plotConfig,
  hlineConfig,
};
