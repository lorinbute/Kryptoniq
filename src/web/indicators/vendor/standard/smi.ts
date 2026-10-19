// @ts-nocheck
/**
 * Stochastic Momentum Index (SMI)
 *
 * Position of the close relative to the middle of the highest high / lowest low range of the last %K Length bars,
 * smoothed twice with an EMA of %D Length:
 *
 *   range    = highest(high, lengthK) - lowest(low, lengthK)
 *   relative = close - (highest + lowest) / 2
 *   SMI      = 200 * ema(ema(relative, lengthD), lengthD) / ema(ema(range, lengthD), lengthD)
 *   signal   = ema(SMI, lengthEMA)  ("SMI-based EMA")
 *
 * Drawn with overbought / oversold lines at 40 / -40 (filled), a middle line at 0 and gradient fills between the
 * SMI and 0 above 40 (green) and below -40 (red).
 *
 * Based on the standard Stochastic Momentum Index indicator.
 */

import { taCore, type IndicatorResult, type InputConfig, type PlotConfig, type HLineConfig, type FillConfig, type FillData, type Bar } from 'oakscriptjs';

export interface StochasticMomentumIndexStandardInputs {
  /** Lookback of the highest high / lowest low */
  lengthK: number;
  /** Length of the two EMAs of the relative range and of the range */
  lengthD: number;
  /** Length of the EMA of the SMI */
  lengthEMA: number;
}

export const defaultInputs: StochasticMomentumIndexStandardInputs = {
  lengthK: 10,
  lengthD: 3,
  lengthEMA: 3,
};

export const inputConfig: InputConfig[] = [
  { id: 'lengthK', type: 'int', title: '%K Length', defval: 10, min: 1, max: 15000 },
  { id: 'lengthD', type: 'int', title: '%D Length', defval: 3, min: 1, max: 4999 },
  { id: 'lengthEMA', type: 'int', title: 'EMA Length', defval: 3, min: 1, max: 4999 },
];

export const plotConfig: PlotConfig[] = [
  { id: 'plot0', title: 'SMI', color: '#2962FF', lineWidth: 1 },
  { id: 'plot1', title: 'SMI-based EMA', color: '#FF9800', lineWidth: 1 },
  // midLinePlot = plot(0, color = na, editable = false, display = display.none): base of the gradient fills
  { id: 'plot2', title: 'Plot', color: 'transparent', lineWidth: 1, display: 'none' },
];

export const hlineConfig: HLineConfig[] = [
  { id: 'hline_overbought', price: 40, color: '#787B86', linestyle: 'dashed', linewidth: 1, title: 'Overbought Line' },
  { id: 'hline_oversold', price: -40, color: '#787B86', linestyle: 'dashed', linewidth: 1, title: 'Oversold Line' },
  { id: 'hline_middle', price: 0, color: '#787B8680', linestyle: 'dashed', linewidth: 1, title: 'Middle Line' },
];

export const fillConfig: FillConfig[] = [
  { id: 'fill_hlines', plot1: 'hline_overbought', plot2: 'hline_oversold', color: '#2962FF1A', title: 'Hlines Background' },
];

export const metadata = {
  title: 'Stochastic Momentum Index',
  shortTitle: 'SMI',
  overlay: false,
};

export function calculate(bars: Bar[], inputs: Partial<StochasticMomentumIndexStandardInputs> = {}): IndicatorResult {
  const { lengthK, lengthD, lengthEMA } = { ...defaultInputs, ...inputs };
  const n = bars.length;
  const high = bars.map((b) => b.high);
  const low = bars.map((b) => b.low);

  const highestHigh = taCore.highest(high, lengthK);
  const lowestLow = taCore.lowest(low, lengthK);
  const highestLowestRange: number[] = new Array(n);
  const relativeRange: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    highestLowestRange[i] = highestHigh[i] - lowestLow[i];
    relativeRange[i] = bars[i].close - (highestHigh[i] + lowestLow[i]) / 2;
  }

  // emaEma(source, length) => ta.ema(ta.ema(source, length), length)
  const emaEma = (src: number[], len: number) => taCore.ema(taCore.ema(src, len), len);
  const num = emaEma(relativeRange, lengthD);
  const den = emaEma(highestLowestRange, lengthD);
  // x / 0 is +-infinity and 0 / 0 is na, as in Pine; ta.ema skips the non-finite values
  const smi = num.map((v, i) => 200 * (v / den[i]));
  const smiEma = taCore.ema(smi, lengthEMA);

  const point = (v: number, i: number) => ({ time: bars[i].time, value: Number.isFinite(v) ? v : NaN });
  const constant = <T>(v: T): T[] => new Array(n).fill(v);

  // fill(smiPlot, midLinePlot, 120, 40, top_color = color.new(#4caf4f, 50), bottom_color = color.new(color.green, 100))
  // fill(smiPlot, midLinePlot, -40, -120, top_color = color.new(color.red, 100), bottom_color = color.new(color.red, 50))
  const fills: FillData[] = [
    {
      plot1: 'plot0', plot2: 'plot2', options: { title: 'Overbought Gradient Fill' },
      gradient: { topValue: constant(120), bottomValue: constant(40), topColor: constant('#4CAF4F80'), bottomColor: constant('#4CAF5000') },
    },
    {
      plot1: 'plot0', plot2: 'plot2', options: { title: 'Oversold Gradient Fill' },
      gradient: { topValue: constant(-40), bottomValue: constant(-120), topColor: constant('#F2364500'), bottomColor: constant('#F2364580') },
    },
  ];

  return {
    metadata: { title: metadata.title, shorttitle: metadata.shortTitle, overlay: metadata.overlay },
    plots: {
      plot0: smi.map(point),
      plot1: smiEma.map(point),
      plot2: bars.map((b) => ({ time: b.time, value: 0 })),
    },
    fills,
  };
}

export const StochasticMomentumIndexStandard = { calculate, metadata, defaultInputs, inputConfig, plotConfig, hlineConfig, fillConfig };
