// What Slingshot draws over the candles (TD-SLINGSHOT34): the LONG / SHORT / TAKE PROFIT triangles and the TP/SL and market
// structure lines with their labels. Pure, so it is tested without a chart. FD-STYLEUNIFY: every state of every label and
// every line has its own look (colour with its opacity, size, width, style), each side its own.
import type { Candle, SlingshotMarker, SlingshotResult } from '../../shared/indicator/slingshot.ts';
import type { PineLineStyle, SignalSizeName, SignalState, SlingshotParams } from '../../shared/indicator/params.ts';
import type { Segment, ShapeLabel, ShapeSize } from './primitives.ts';

/** Pine's line style names as the chart draws them. */
export const styleOf = (s: PineLineStyle): 'solid' | 'dashed' | 'dotted' => (s === 'Solid' ? 'solid' : s === 'Dashed' ? 'dashed' : 'dotted');

/** The shapes' size for each Pine label size: "Small" as TradingView draws it (~24 px), the others scaled (FD-SS34LIVE). */
export const SIGNAL_SIZES: Record<SignalSizeName, ShapeSize> = {
  Tiny: { w: 14, h: 11, text: 9 },
  Small: { w: 24, h: 18, text: 11 },
  Normal: { w: 32, h: 24, text: 13 },
  Large: { w: 44, h: 33, text: 16 },
  Huge: { w: 60, h: 45, text: 20 },
};

/** FD-STYLEUNIFY: a text's size for each size name, the same everywhere (labels, levels, market structure). */
export const textPx = (s: SignalSizeName): number => (SIGNAL_SIZES[s] ?? SIGNAL_SIZES.Small).text;

export function buildSegments(r: SlingshotResult, p: SlingshotParams, precision: number): Segment[] {
  const out: Segment[] = [];
  const fmt = (v: number) => v.toFixed(precision);
  // Each side's TP/SL, the LONG's first (FD-SLINGSHOT34: the two sides are independent and may show together).
  for (const a of [r.atr, r.atrShort]) {
    if (!a || !Number.isFinite(a.fromBar)) continue;
    const { tp, sl, fromBar, toBarTp, toBarSl, labelBar, showLines, showLabels } = a;
    // A SHORT's take profit is below the price, its label under the line; its stop loss above.
    const short = a.side === 'short';
    const look = short
      ? {
          tp: { color: p.shortTPColor, width: p.shortTpLineWidth, style: styleOf(p.shortTpLineStyle), size: textPx(p.shortTpLabelSize) },
          sl: { color: p.shortSLColor, width: p.shortSlLineWidth, style: styleOf(p.shortSlLineStyle), size: textPx(p.shortSlLabelSize) },
        }
      : {
          tp: { color: p.longTPColor, width: p.longTpLineWidth, style: styleOf(p.longTpLineStyle), size: textPx(p.longTpLabelSize) },
          sl: { color: p.longSLColor, width: p.longSlLineWidth, style: styleOf(p.longSlLineStyle), size: textPx(p.longSlLabelSize) },
        };
    if (showLines && Number.isFinite(tp)) out.push({ fromBar, toBar: toBarTp, price: tp, color: look.tp.color, width: look.tp.width, style: look.tp.style });
    if (showLines && Number.isFinite(sl)) out.push({ fromBar, toBar: toBarSl, price: sl, color: look.sl.color, width: look.sl.width, style: look.sl.style });
    if (showLabels && Number.isFinite(tp)) out.push({ fromBar: labelBar, toBar: labelBar, price: tp, color: look.tp.color, width: 0, style: 'solid', label: { text: ['TAKE PROFIT', fmt(tp)], bar: labelBar, placement: short ? 'below' : 'above', size: look.tp.size } });
    if (showLabels && Number.isFinite(sl)) out.push({ fromBar: labelBar, toBar: labelBar, price: sl, color: look.sl.color, width: 0, style: 'solid', label: { text: ['STOP LOSS', fmt(sl)], bar: labelBar, placement: short ? 'above' : 'below', size: look.sl.size } });
  }
  if (r.ms) {
    if (r.ms.upper && Number.isFinite(r.ms.upper.fromBar)) {
      out.push({
        fromBar: r.ms.upper.fromBar,
        toBar: r.ms.rightEdgeBar,
        price: r.ms.upper.price,
        color: p.msBullColor,
        width: p.msBullLineWidth,
        style: styleOf(p.msBullLineStyle),
        label: p.msBullText ? { text: [p.msBullText], bar: r.ms.rightEdgeBar, placement: 'right', size: textPx(p.msBullTextSize) } : undefined,
      });
    }
    if (r.ms.lower && Number.isFinite(r.ms.lower.fromBar)) {
      out.push({
        fromBar: r.ms.lower.fromBar,
        toBar: r.ms.rightEdgeBar,
        price: r.ms.lower.price,
        color: p.msBearColor,
        width: p.msBearLineWidth,
        style: styleOf(p.msBearLineStyle),
        label: p.msBearText ? { text: [p.msBearText], bar: r.ms.rightEdgeBar, placement: 'right', size: textPx(p.msBearTextSize) } : undefined,
      });
    }
  }
  return out;
}

/**
 * FD-STYLEUNIFY: the state a marker is drawn in. A signal label: in formation, valid, failed (its stop loss) or
 * invalidated (an X); a TAKE PROFIT / STOP LOSS label: its own.
 */
export function markerState(m: Pick<SlingshotMarker, 'kind' | 'color'>): SignalState {
  if (m.kind === 'takeProfit' || m.kind === 'shortTakeProfit') return 'Tp';
  if (m.kind === 'stopLoss' || m.kind === 'shortStopLoss') return 'Sl';
  if (m.color === 'invalid') return 'Invalid';
  if (m.color === 'failed') return 'Failed';
  return m.kind === 'longPreview' || m.kind === 'shortPreview' ? 'Forming' : '';
}

const SHORT_KINDS: ReadonlySet<SlingshotMarker['kind']> = new Set(['short', 'shortPreview', 'shortTakeProfit', 'shortStopLoss']);

/** A marker's colour and size: its side's, for its state. */
export function markerLook(m: Pick<SlingshotMarker, 'kind' | 'color'>, p: SlingshotParams): { color: string; size: SignalSizeName } {
  const side = SHORT_KINDS.has(m.kind) ? 'short' : 'long';
  const st = markerState(m);
  const params = p as unknown as Record<string, string>;
  return { color: params[`${side}${st}Color`] as string, size: params[`${side}${st}Size`] as SignalSizeName };
}

/**
 * The labels' shapes: above the candle (Pine yloc.abovebar, triangle down) a LONG's TAKE PROFIT, a SHORT and a SHORT's
 * STOP LOSS; below it a LONG, a LONG's STOP LOSS and a SHORT's TAKE PROFIT (FD-SSSL). Each in its state's colour and size
 * (FD-STYLEUNIFY); an invalidated one is an X (FD-SS34LIVE).
 */
export function slingshotShapes(markers: SlingshotMarker[], candles: Candle[], p: SlingshotParams): ShapeLabel[] {
  return markers
    .filter((m) => m.bar >= 0 && m.bar < candles.length)
    .map((m) => {
      const c = candles[m.bar] as Candle;
      // A LONG's take profit is a high above the bar, its stop loss a low below it; a SHORT the other way round.
      const above = m.kind === 'takeProfit' || m.kind === 'short' || m.kind === 'shortPreview' || m.kind === 'shortStopLoss';
      const text =
        m.kind === 'takeProfit' || m.kind === 'shortTakeProfit' ? 'TAKE PROFIT' : m.kind === 'stopLoss' || m.kind === 'shortStopLoss' ? 'STOP LOSS' : m.kind === 'long' || m.kind === 'longPreview' ? 'LONG' : 'SHORT';
      const look = markerLook(m, p);
      return { bar: m.bar, price: above ? c.h : c.l, position: above ? 'above' : 'below', color: look.color, text, shape: m.color === 'invalid' ? 'x' : 'triangle', size: SIGNAL_SIZES[look.size] ?? SIGNAL_SIZES.Small };
    });
}
