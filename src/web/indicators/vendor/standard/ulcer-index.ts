// @ts-nocheck
/**
 * Ulcer Index (UI)
 *
 * Volatility/risk measure that only considers downside movement. It is the
 * square root of the mean of squared percentage drawdowns from the highest
 * source over the lookback window.
 *
 *   drawdown_i = 100 * (src - highest(src, length)) / highest(src, length)
 *   UI        = sqrt( sma(drawdown^2, length) )
 *
 * Based on the standard "Ulcer Index" indicator.
 */

import { Series, ta, getSourceSeries, type IndicatorResult, type InputConfig, type PlotConfig, type HLineConfig, type Bar, type SourceType } from 'oakscriptjs';

export interface UlcerIndexInputs {
  /** Source */
  src: SourceType;
  /** Lookback length */
  length: number;
}

export const defaultInputs: UlcerIndexInputs = {
  src: 'close',
  length: 14,
};

export const inputConfig: InputConfig[] = [
  { id: 'src', type: 'source', title: 'Source', defval: 'close' },
  { id: 'length', type: 'int', title: 'Length', defval: 14, min: 1 },
];

export const plotConfig: PlotConfig[] = [
  { id: 'plot0', title: 'Ulcer Index', color: '#2962FF', lineWidth: 1 },
  // Reference: a hidden zero plot, the other side of the "Plots Background" fill
  { id: 'plot1', title: '', color: '#2962FF', lineWidth: 1, display: 'none', editable: false },
];

/** Reference: the "Zero" level (grey, dashed) */
export const hlineConfig: HLineConfig[] = [
  { id: 'hline_zero', price: 0, title: 'Zero', color: '#808080', linestyle: 'dashed', linewidth: 1 },
];

export const metadata = {
  title: 'Ulcer Index',
  shortTitle: 'UI',
  overlay: false,
};

export function calculate(bars: Bar[], inputs: Partial<UlcerIndexInputs> = {}): IndicatorResult {
  const { length, src } = { ...defaultInputs, ...inputs };

  const srcSeries = getSourceSeries(bars, src);
  const srcArr = srcSeries.toArray();
  const highestArr = ta.highest(srcSeries, length).toArray();

  // Squared percentage drawdown from the running highest close.
  const drawdownSq: number[] = bars.map((_, i) => {
    const hi = highestArr[i];
    if (hi == null || hi === 0) return NaN;
    const dd = (100 * ((srcArr[i] ?? NaN) - hi)) / hi;
    return dd * dd;
  });

  const ddSeries = new Series(bars, (_, i) => drawdownSq[i]);
  const meanSqArr = ta.sma(ddSeries, length).toArray();

  const plotData = meanSqArr.map((value, i) => ({
    time: bars[i].time,
    value: value != null && !isNaN(value) ? Math.sqrt(value) : NaN,
  }));

  return {
    metadata: {
      title: metadata.title,
      shorttitle: metadata.shortTitle,
      overlay: metadata.overlay,
    },
    plots: {
      'plot0': plotData,
      'plot1': bars.map((b) => ({ time: b.time, value: 0 })),
    },
    // Reference: fill between the index and the zero plot
    fills: [{ id: 'fill_0', plot1: 'plot0', plot2: 'plot1', options: { color: 'rgba(33,150,243,0.1)', title: 'Plots Background' } }],
  };
}

export const UlcerIndex = {
  calculate,
  metadata,
  defaultInputs,
  inputConfig,
  plotConfig,
  hlineConfig,
};
