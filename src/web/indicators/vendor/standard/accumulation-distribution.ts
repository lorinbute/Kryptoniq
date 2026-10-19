// @ts-nocheck
/**
 * Accumulation/Distribution
 *
 * Running total of the close location value times the volume:
 *
 *   ad = cum( close == high and close == low or high == low ? 0 : ((2 * close - low - high) / (high - low)) * volume )
 *
 * When the sum of the volume of all bars is 0 on the last bar, the original stops with the runtime error "No volume
 * is provided by the data vendor."; the port throws the same message.
 *
 * Based on the standard Accumulation/Distribution indicator.
 */

import { taCore, type IndicatorResult, type InputConfig, type PlotConfig, type Bar } from 'oakscriptjs';

export interface AccumulationDistributionInputs {}

export const defaultInputs: AccumulationDistributionInputs = {};

export const inputConfig: InputConfig[] = [];

export const plotConfig: PlotConfig[] = [
  { id: 'plot0', title: 'Accumulation/Distribution', color: '#999915', lineWidth: 1 },
];

export const metadata = {
  title: 'Accumulation/Distribution',
  shortTitle: 'Accum/Dist',
  overlay: false,
};

/** Pine float equality: within 1e-10 (na compares false) */
const eq = (a: number, b: number) => Math.abs(a - b) <= 1e-10;

export function calculate(bars: Bar[], _inputs: Partial<AccumulationDistributionInputs> = {}): IndicatorResult {
  const n = bars.length;

  // var cumVol = 0.; cumVol += nz(volume); runtime error on the last bar when it is 0
  let cumVol = 0;
  for (const b of bars) {
    const v = b.volume ?? NaN;
    cumVol += Number.isFinite(v) ? v : 0;
  }
  if (n > 0 && eq(cumVol, 0)) {
    throw new Error('No volume is provided by the data vendor.');
  }

  const mfv: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const { high, low, close } = bars[i];
    const volume = bars[i].volume ?? NaN;
    mfv[i] = (eq(close, high) && eq(close, low)) || eq(high, low)
      ? 0
      : ((2 * close - low - high) / (high - low)) * volume;
  }
  const ad = taCore.cum(mfv);

  return {
    metadata: { title: metadata.title, shorttitle: metadata.shortTitle, overlay: metadata.overlay },
    plots: {
      plot0: ad.map((v, i) => ({ time: bars[i].time, value: Number.isFinite(v) ? v : NaN })),
    },
  };
}

export const AccumulationDistribution = { calculate, metadata, defaultInputs, inputConfig, plotConfig };
