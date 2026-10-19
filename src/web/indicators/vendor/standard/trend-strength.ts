// @ts-nocheck
/**
 * Trend Strength Index
 *
 * Measures trend strength using the Pearson correlation between
 * closing prices and bar indices over a rolling window.
 * Range: -1 to 1, where positive = uptrend, negative = downtrend.
 * Formula: ta.correlation(close, bar_index, length)
 */

import { Series, ta, color, type IndicatorResult, type InputConfig, type PlotConfig, type HLineConfig, type FillData, type Bar } from 'oakscriptjs';

export interface TrendStrengthInputs {
  /** Period length */
  length: number;
  /** Bullish fill color */
  bullishColor: string;
  /** Bearish fill color */
  bearishColor: string;
}

export const defaultInputs: TrendStrengthInputs = {
  length: 14,
  bullishColor: '#0899811A',
  bearishColor: '#F236451A',
};

export const inputConfig: InputConfig[] = [
  { id: 'length', type: 'int', title: 'Length', defval: 14, min: 2 },
  { id: 'bullishColor', type: 'color', title: 'Bullish Color', defval: '#0899811A' },
  { id: 'bearishColor', type: 'color', title: 'Bearish Color', defval: '#F236451A' },
];

export const plotConfig: PlotConfig[] = [
  { id: 'plot0', title: 'Trend Strength Index', color: '#7E57C2', lineWidth: 1 },
  { id: 'plot3', title: 'Plot', color: 'transparent', lineWidth: 1, display: 'none' },
];

export const hlineConfig: HLineConfig[] = [
  { id: 'hline_mid',  price: 0, color: '#787B8680', linestyle: 'dashed', title: 'TSI Middle Band' },
  { id: 'hline_bull', price: 1, color: '#089981', linestyle: 'dashed', title: 'TSI Bullish Band' },
  { id: 'hline_bear', price: -1, color: '#F23645', linestyle: 'dashed', title: 'TSI Bearish Band' },
];

export const metadata = {
  title: 'Trend Strength Index',
  shortTitle: 'TSI',
  overlay: false,
};

export function calculate(bars: Bar[], inputs: Partial<TrendStrengthInputs> = {}): IndicatorResult {
  const { length, bullishColor, bearishColor } = { ...defaultInputs, ...inputs };

  const close = new Series(bars, b => b.close);
  const barIndex = new Series(bars, (_, i) => i);

  const tsArr = ta.correlation(close, barIndex, length).toArray();

  const tsData = tsArr.map((v, i) => ({ time: bars[i].time, value: v ?? NaN }));

  const midlineData = bars.map(b => ({ time: b.time, value: 0 }));

  // Pine: midLinePlot = plot(0, display = display.none)
  //   fill(tsiPlot, midLinePlot, 1, 0, top_color = bullishColorInput, bottom_color = color.new(bullishColorInput, 100))
  //   fill(tsiPlot, midLinePlot, 0, -1, top_color = color.new(bearishColorInput, 100), bottom_color = bearishColorInput)
  const n = bars.length;
  const constant = <T>(v: T): T[] => new Array(n).fill(v);
  const fills: FillData[] = [
    {
      plot1: 'plot0', plot2: 'plot3', options: { title: 'Bullish Gradient Fill' },
      gradient: { topValue: constant(1), bottomValue: constant(0), topColor: constant(bullishColor), bottomColor: constant(color.new_color(bullishColor, 100) as string) },
    },
    {
      plot1: 'plot0', plot2: 'plot3', options: { title: 'Bearish Gradient Fill' },
      gradient: { topValue: constant(0), bottomValue: constant(-1), topColor: constant(color.new_color(bearishColor, 100) as string), bottomColor: constant(bearishColor) },
    },
  ];

  return {
    metadata: {
      title: metadata.title,
      shorttitle: metadata.shortTitle,
      overlay: metadata.overlay,
    },
    plots: {
      'plot0': tsData,
      'plot3': midlineData,
    },
    // hline(1, color = color.new(bullishColorInput, 0)); hline(-1, color = color.new(bearishColorInput, 0))
    hlines: [
      { value: 0, options: { title: 'TSI Middle Band', color: '#787B8680', linestyle: 'dashed' } },
      { value: 1, options: { title: 'TSI Bullish Band', color: color.new_color(bullishColor, 0) as string, linestyle: 'dashed' } },
      { value: -1, options: { title: 'TSI Bearish Band', color: color.new_color(bearishColor, 0) as string, linestyle: 'dashed' } },
    ],
    fills,
  };
}

export const TrendStrengthIndex = {
  calculate,
  metadata,
  defaultInputs,
  inputConfig,
  plotConfig,
  hlineConfig,
};
