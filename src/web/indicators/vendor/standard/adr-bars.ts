// @ts-nocheck
/**
 * Advance/Decline Ratio (Bars)
 *
 * Ratio of up bars to down bars over the last `length` bars of the chart symbol. A bar is up when close - open >= 0:
 *
 *   upBars   = sum(isUp ? 1 : 0, length)
 *   downBars = sum(isUp ? 0 : 1, length)
 *   ADR_B    = downBars == 0 ? upBars : upBars / downBars
 *
 * Drawn with an equality line at 1.
 *
 * Based on the standard Advance/Decline Ratio (Bars) indicator.
 */

import { math, type IndicatorResult, type InputConfig, type PlotConfig, type HLineConfig, type Bar } from 'oakscriptjs';

export interface AdvanceDeclineRatioBarsInputs {
  /** Number of bars counted */
  length: number;
}

export const defaultInputs: AdvanceDeclineRatioBarsInputs = {
  length: 9,
};

export const inputConfig: InputConfig[] = [
  { id: 'length', type: 'int', title: 'length', defval: 9, min: 1 },
];

export const plotConfig: PlotConfig[] = [
  { id: 'plot0', title: 'ADR_B', color: '#2962FF', lineWidth: 1 },
];

export const hlineConfig: HLineConfig[] = [
  { id: 'hline_equality', price: 1, color: '#787B86', linestyle: 'dashed', linewidth: 1, title: 'Equality Line' },
];

export const metadata = {
  title: 'Advance/Decline Ratio (Bars)',
  shortTitle: 'ADR_B',
  overlay: false,
};

/** Pine float equality: within 1e-10 (na compares false) */
const eq = (a: number, b: number) => Math.abs(a - b) <= 1e-10;

export function calculate(bars: Bar[], inputs: Partial<AdvanceDeclineRatioBarsInputs> = {}): IndicatorResult {
  const { length } = { ...defaultInputs, ...inputs };
  const n = bars.length;

  // isUp = (close - open) >= 0.0 (Pine comparison: false only when 0 - x > 1e-10)
  const up: number[] = new Array(n);
  const down: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const d = bars[i].close - bars[i].open;
    const isUp = !isNaN(d) && !(0 - d > 1e-10);
    up[i] = isUp ? 1 : 0;
    down[i] = isUp ? 0 : 1;
  }
  const upBars = math.sum(up, length) as number[];
  const downBars = math.sum(down, length) as number[];

  const data = bars.map((bar, i) => {
    const u = upBars[i];
    const dn = downBars[i];
    const ad = eq(dn, 0) ? u : u / dn;
    return { time: bar.time, value: Number.isFinite(ad) ? ad : NaN };
  });

  return {
    metadata: { title: metadata.title, shorttitle: metadata.shortTitle, overlay: metadata.overlay },
    plots: { plot0: data },
  };
}

export const AdvanceDeclineRatioBars = { calculate, metadata, defaultInputs, inputConfig, plotConfig, hlineConfig };
