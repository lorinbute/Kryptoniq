// FD-STYLEUNIFY: the LMA's threshold lines as the chart draws them: each with the colour chosen (else the script's own),
// its width and its style (TradingView's Style tab).
import { colorNew, hexToRgba, PINE_GRAY, rgbaCss } from '../../shared/indicator/lma.ts';
import type { LineStyleName, LmaParams } from '../../shared/indicator/lma-params.ts';

/** The LMA script's own colours of its threshold lines (Pine `hline(…, color=color.new(bullishColor, 30))`…). */
export function lmaScriptLineColors(e: LmaParams): Record<'long' | 'short' | 'neutral', string> {
  return { long: rgbaCss(colorNew(hexToRgba(e.bullishColor), 30)), short: rgbaCss(colorNew(hexToRgba(e.bearishColor), 30)), neutral: PINE_GRAY };
}

/** FD-STYLEUNIFY: each threshold line with the colour chosen (else the script's), its width and its style. */
export function lmaHlines(e: LmaParams): { key: 'long' | 'short' | 'neutral'; price: number; color: string; width: 1 | 2 | 3 | 4; style: LineStyleName; visible: boolean }[] {
  const own = lmaScriptLineColors(e);
  const w = (n: number) => Math.min(4, Math.max(1, Math.round(n))) as 1 | 2 | 3 | 4;
  return [
    { key: 'long', price: e.longThreshold, color: e.longLineColor ?? own.long, width: w(e.longLineWidth), style: e.longLineStyle, visible: e.showLongLine },
    { key: 'short', price: e.shortThreshold, color: e.shortLineColor ?? own.short, width: w(e.shortLineWidth), style: e.shortLineStyle, visible: e.showShortLine },
    { key: 'neutral', price: 0, color: e.neutralLineColor ?? own.neutral, width: w(e.neutralLineWidth), style: e.neutralLineStyle, visible: e.showNeutralLine },
  ];
}
