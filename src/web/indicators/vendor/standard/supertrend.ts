// @ts-nocheck
/**
 * Supertrend Indicator
 *
 * A trend-following overlay indicator that uses ATR to calculate
 * dynamic support/resistance levels.
 *
 * PineScript display:
 *   upTrend =   plot(direction < 0 ? supertrend : na, "Up Trend",   style = plot.style_linebr)
 *   downTrend = plot(direction < 0 ? na : supertrend, "Down Trend", style = plot.style_linebr)
 *   bodyMiddle = plot((open + close) / 2, display = display.none)
 *   fill(bodyMiddle, upTrend,   color = color.new(color.green, 90), fillgaps = false)
 *   fill(bodyMiddle, downTrend, color = color.new(color.red,   90), fillgaps = false)
 */

import { ta, type IndicatorResult, type InputConfig, type PlotConfig, type FillData, type Bar } from 'oakscriptjs';
import { alertStates, type AlertConditionDecl, type AlertConditionState } from '../alert-states';

/**
 * Supertrend indicator input parameters
 */
export interface SupertrendInputs {
  /** ATR period length */
  atrPeriod: number;
  /** ATR multiplier factor */
  factor: number;
}

/**
 * Default input values matching the standard indicator defaults
 */
export const defaultInputs: SupertrendInputs = {
  atrPeriod: 10,
  factor: 3.0,
};

/**
 * Input configuration for UI
 */
export const inputConfig: InputConfig[] = [
  { id: 'atrPeriod', type: 'int', title: 'ATR Length', defval: 10, min: 1 },
  { id: 'factor', type: 'float', title: 'Factor', defval: 3.0, min: 0.01, step: 0.01 },
];

/**
 * Plot configuration
 * plot2 (bodyMiddle) is invisible — used only as a fill anchor
 */
export const plotConfig: PlotConfig[] = [
  { id: 'plot0', title: 'Up Trend', color: '#089981', lineWidth: 1, style: 'linebr' },
  { id: 'plot1', title: 'Down Trend', color: '#F23645', lineWidth: 1, style: 'linebr' },
  { id: 'plot2', title: 'Body Middle', color: '#00000000', lineWidth: 0, display: 'none' },
];

/**
 * Indicator metadata
 */
export const metadata = {
  title: 'Supertrend',
  shortTitle: 'ST',
  overlay: true,
};

/**
 * Calculate Supertrend indicator
 */
/** Reference alertconditions on the direction (-1 up, 1 down) */
export const alertConditions: AlertConditionDecl[] = [
  { id: 'alert0', title: 'Downtrend to Uptrend', message: 'The Supertrend value switched from Downtrend to Uptrend ' },
  { id: 'alert1', title: 'Uptrend to Downtrend', message: 'The Supertrend value switched from Uptrend to Downtrend' },
  { id: 'alert2', title: 'Trend Change', message: 'The Supertrend value switched from Uptrend to Downtrend or vice versa' },
];

export function calculate(bars: Bar[], inputs: Partial<SupertrendInputs> = {}): IndicatorResult & { alerts: AlertConditionState[] } {
  const { atrPeriod, factor } = { ...defaultInputs, ...inputs };

  const [supertrendSeries, directionSeries] = ta.supertrend(bars, factor, atrPeriod);
  // supertrend := barstate.isfirst ? na : supertrend
  const supertrendValues = supertrendSeries.toArray().map((v: number | null, i: number) => (i === 0 ? null : v));
  const directions = directionSeries.toArray();

  const upTrendData = supertrendValues.map((value: number | null, i: number) => ({
    time: bars[i].time,
    value: (directions[i] ?? 1) < 0 ? (value ?? NaN) : NaN,
  }));

  const downTrendData = supertrendValues.map((value: number | null, i: number) => ({
    time: bars[i].time,
    value: (directions[i] ?? 1) >= 0 ? (value ?? NaN) : NaN,
  }));

  const bodyMiddleData = bars.map((bar, i) => ({
    time: bar.time,
    value: i === 0 ? NaN : (bar.open + bar.close) / 2,
  }));

  const fills: FillData[] = [
    { plot1: 'plot2', plot2: 'plot0', options: { color: '#089981', transp: 90, title: 'Uptrend background', fillgaps: false } },
    { plot1: 'plot2', plot2: 'plot1', options: { color: '#F23645', transp: 90, title: 'Downtrend background', fillgaps: false } },
  ];

  return {
    metadata: {
      title: metadata.title,
      shorttitle: metadata.shortTitle,
      overlay: metadata.overlay,
    },
    plots: {
      'plot0': upTrendData,
      'plot1': downTrendData,
      'plot2': bodyMiddleData,
    },
    fills,
    // direction[1] > direction, direction[1] < direction, direction[1] != direction (na compares false)
    alerts: (() => {
      const d = (i: number) => directions[i] ?? NaN;
      const at = (f: (a: number, b: number) => boolean) => bars.map((_, i) => i > 0 && f(d(i - 1), d(i)));
      return alertStates(alertConditions, bars, [at((a, b) => a > b), at((a, b) => a < b), at((a, b) => Number.isFinite(a) && Number.isFinite(b) && a !== b)]);
    })(),
  };
}

/**
 * Supertrend indicator module
 */
export const Supertrend = {
  calculate,
  alertConditions,
  metadata,
  defaultInputs,
  inputConfig,
  plotConfig,
};
