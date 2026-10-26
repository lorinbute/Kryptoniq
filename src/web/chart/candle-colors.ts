// FD-CHARTSETTINGS, FD-BARCOLORBODY: the candles' colours. An indicator that colours the candles (LMA's "Color Price
// Bars", any barcolor) changes the body's fill only; the border and the wick keep the chart settings' colours.
import type { ChartStyle } from '../../shared/chart-style.ts';

/** A part switched off: see-through. */
export const CLEAR = 'rgba(0, 0, 0, 0)';

/**
 * The colours one candle gets on top of the series' own (`{}`: the series' options already give them, up / down by its
 * open). With "by the previous close" every part is set, up / down by the close before (the first candle by its open).
 * `indicator`: the body's fill an indicator asks for.
 */
export function candleColors(k: ChartStyle['candles'], candles: readonly { o: number; c: number }[], i: number, indicator?: string): { color?: string; borderColor?: string; wickColor?: string } {
  const bar = candles[i];
  const prev = k.prevClose && i > 0 ? candles[i - 1] : undefined;
  if (!bar || !prev) return indicator ? { color: k.body.visible ? indicator : CLEAR } : {};
  const up = bar.c >= prev.c;
  return {
    color: k.body.visible ? (indicator ?? (up ? k.body.up : k.body.down)) : CLEAR,
    borderColor: up ? k.borders.up : k.borders.down,
    wickColor: up ? k.wick.up : k.wick.down,
  };
}

/** The library's candle width (bitmap px), even or odd as its wick (lightweight-charts' optimalCandlestickWidth). */
export function candleBarWidth(barSpacing: number, pixelRatio: number): number {
  let w: number;
  if (barSpacing >= 2.5 && barSpacing <= 4) {
    w = Math.floor(3 * pixelRatio);
  } else {
    const coeff = 1 - (0.2 * Math.atan(Math.max(4, barSpacing) - 4)) / (Math.PI * 0.5);
    w = Math.max(Math.floor(pixelRatio), Math.min(Math.floor(barSpacing * coeff * pixelRatio), Math.floor(barSpacing * pixelRatio)));
  }
  if (w >= 2 && Math.floor(pixelRatio) % 2 !== w % 2) w--;
  return w;
}

/** The library's border width for a candle `barWidth` wide (PaneRendererCandlesticks' _calculateBorderWidth). */
function borderWidthOf(barWidth: number, pixelRatio: number): number {
  let bw = Math.floor(pixelRatio);
  if (barWidth <= 2 * bw) bw = Math.floor((barWidth - 1) * 0.5);
  const res = Math.max(Math.floor(pixelRatio), bw);
  return barWidth <= res * 2 ? Math.floor(pixelRatio) : res;
}

/**
 * The candle's body as the library fills it (bitmap px): inside the border when borders are drawn, or null when there is
 * no inside (a candle too narrow, or a flat one within its border).
 */
export function candleBodyRect(x: number, openY: number, closeY: number, barSpacing: number, hpr: number, vpr: number, borderVisible: boolean): { left: number; top: number; width: number; height: number } | null {
  const barWidth = candleBarWidth(barSpacing, hpr);
  const bw = borderWidthOf(barWidth, hpr);
  if (borderVisible && barWidth <= bw * 2) return null;
  let top = Math.round(Math.min(openY, closeY) * vpr);
  let bottom = Math.round(Math.max(openY, closeY) * vpr);
  let left = Math.round(x * hpr) - Math.floor(barWidth * 0.5);
  let right = left + barWidth - 1;
  if (borderVisible) {
    left += bw;
    top += bw;
    right -= bw;
    bottom -= bw;
  }
  if (top > bottom) return null;
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}
