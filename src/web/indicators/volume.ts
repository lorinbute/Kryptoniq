// Volume (FD-INDICATORS, TD-INDICATORS §3): the traded volume of each bar as columns, green when the bar went up and red
// when it went down, with an optional moving average. Not in the vendored set; same module shape as its indicators and
// TradingView's defaults (50 % transparent colours, "Color based on previous close" off, MA 20 hidden).
import type { Bar, IndicatorResult, InputConfig, PlotConfig } from 'oakscriptjs';

export interface VolumeInputs {
  showMA: boolean;
  maLength: number;
  colorBasedOnPrevClose: boolean;
}

export const defaultInputs: VolumeInputs = { showMA: false, maLength: 20, colorBasedOnPrevClose: false };

export const UP_COLOR = '#26A69A80';
export const DOWN_COLOR = '#EF535080';

export const inputConfig: InputConfig[] = [
  { id: 'showMA', type: 'bool', title: 'Volume MA', defval: false },
  { id: 'maLength', type: 'int', title: 'MA Length', defval: 20, min: 1, max: 5000, active: { input: 'showMA', eq: true } },
  { id: 'colorBasedOnPrevClose', type: 'bool', title: 'Color based on previous close', defval: false },
];

export const plotConfig: PlotConfig[] = [
  { id: 'plot0', title: 'Volume', color: UP_COLOR, style: 'columns', palette: [UP_COLOR, DOWN_COLOR] },
  { id: 'plot1', title: 'Volume MA', color: '#2196F3', lineWidth: 1, visible: 'showMA' },
];

export const metadata = { title: 'Volume', shortTitle: 'Vol', overlay: false };

export function calculate(bars: Bar[], inputs: Partial<VolumeInputs> = {}): IndicatorResult {
  const { maLength, colorBasedOnPrevClose } = { ...defaultInputs, ...inputs };
  const len = Math.max(1, Math.round(maLength));
  const volume: IndicatorResult['plots'][string] = [];
  const ma: IndicatorResult['plots'][string] = [];
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i] as Bar;
    const v = Number.isFinite(b.volume) ? (b.volume as number) : 0;
    const prev = bars[i - 1];
    const down = colorBasedOnPrevClose && prev ? b.close < prev.close : b.close < b.open;
    volume.push({ time: b.time, value: v, color: down ? DOWN_COLOR : UP_COLOR } as IndicatorResult['plots'][string][number]);
    sum += v;
    if (i >= len) sum -= Number.isFinite(bars[i - len]?.volume) ? (bars[i - len]?.volume as number) : 0;
    ma.push({ time: b.time, value: i >= len - 1 ? sum / len : NaN });
  }
  return { metadata: { title: metadata.title, shorttitle: metadata.shortTitle, overlay: false }, plots: { plot0: volume, plot1: ma } };
}

export const VolumeStudy = { overlay: false, calculate, metadata, defaultInputs, inputConfig, plotConfig };
