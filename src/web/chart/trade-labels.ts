// FD-TRADEUI: the trades on the chart as TradingView draws them. Each line (entry, take profit, stop loss, order, an
// order's TP / SL, liquidation) carries a box away from the price scale: quantity | PnL (or what it is) | ×. The × closes
// the position or cancels / removes the order. Colours, contents and the box's geometry (shared by the drawing, the
// pointer and the Confirm / Discard bar placed before it).
import { formatColor } from '../color.ts';
import { fmtNum } from '../format.ts';
import { pnlAtLevel, type TradeLine } from './pnl.ts';
import type { AccountLine } from './trade-drafts.ts';
import type { PriceLineSpec } from './CandleChart.tsx';

/** TradingView's colours: a long blue, a short red, take profit green, stop loss orange, buy / sell orders as their side. */
export const TRADE_COLORS = { long: '#2962FF', short: '#F23645', tp: '#089981', sl: '#F7A600', buy: '#2962FF', sell: '#F23645', liquidation: '#F23645', up: '#22AB94', down: '#F23645' } as const;
/** The same on the light theme: darker, to stand out on white. */
export const TRADE_COLORS_LIGHT = { long: '#1E53E5', short: '#D32F3C', tp: '#067A6E', sl: '#B86E00', buy: '#1E53E5', sell: '#D32F3C', liquidation: '#D32F3C', up: '#067A6E', down: '#D32F3C' } as const;
export type TradePalette = { readonly [K in keyof typeof TRADE_COLORS]: string };

/** What a line's box shows. */
export interface TradeLabelSpec {
  /** The quantity (coins / shares), or null (liquidation). */
  qty: string | null;
  text: string;
  textColor: string;
  /** An × (close the position, cancel or remove the order). */
  close: boolean;
  /** The quantity on the line's colour (the position's entry), else outlined. */
  fill: boolean;
  /** Moved and not yet confirmed (TradingView: the box tinted with the line's colour, its content dimmed). */
  pending?: boolean;
}

/** The box: 12 px text, 20 px tall, its right edge 64 px from the price scale (TradingView's place). */
export const LABEL_FONT = '12px "Geist Variable", ui-sans-serif, system-ui, sans-serif';
export const LABEL_HEIGHT = 20;
export const LABEL_RIGHT = 64;
const PAD = 7;
const CLOSE_W = 20;

/** Where a box's parts are, from its left edge (CSS px). */
export interface LabelGeometry {
  x: number;
  w: number;
  qtyW: number;
  textW: number;
  closeW: number;
}

/** The box of `spec` on a pane `plotWidth` wide; `measure` gives a text's width in LABEL_FONT. */
export function labelGeometry(spec: TradeLabelSpec, plotWidth: number, measure: (text: string) => number): LabelGeometry {
  const qtyW = spec.qty === null ? 0 : Math.ceil(measure(spec.qty)) + 2 * PAD;
  const textW = Math.ceil(measure(spec.text)) + 2 * PAD;
  const closeW = spec.close ? CLOSE_W : 0;
  const w = qtyW + textW + closeW;
  // Kept inside the pane on a narrow chart (a phone), as far right as it then fits.
  const x = Math.max(4, plotWidth - LABEL_RIGHT - w);
  return { x, w, qtyW, textW, closeW };
}

/** Which part of a box `x` is on (CSS px from the pane's left), or null. */
export function labelPartAt(g: LabelGeometry, x: number): 'body' | 'close' | null {
  if (x < g.x || x > g.x + g.w) return null;
  return g.closeW > 0 && x >= g.x + g.w - g.closeW ? 'close' : 'body';
}

const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtNum(Math.abs(v), 2, 2)}`;
const quoteOf = (l: TradeLine) => l.basis?.quote ?? (l.order?.symbol.split('/')[1]?.split(':')[0] || 'USDT');

/** An order's kind and side, as its box names it: "Limită cumpărare", "Stop vânzare". */
export function orderText(o: NonNullable<TradeLine['order']>): string {
  const kind = o.triggerPrice !== null ? (o.price !== null ? 'Stop-limită' : 'Stop') : 'Limită';
  return `${kind} ${o.side === 'buy' ? 'cumpărare' : 'vânzare'}`;
}

/**
 * A line's text at `price`: the PnL there (an entry: the PnL now, at `last`), in the quote; an order its kind; the
 * liquidation its name. `entry`: an order's TP / SL count from the order's new price when that one is dragged.
 */
export function labelText(l: TradeLine, price: number, last: number | null, entry?: number): { text: string; tone: 'up' | 'down' | null } {
  if (l.role === 'liquidation') return { text: 'Lichidare', tone: null };
  if (l.role === 'order' && l.order) return { text: orderText(l.order), tone: null };
  const at = l.role === 'entry' ? last : price;
  if (!l.basis || at === null) return { text: '—', tone: null };
  const basis = entry !== undefined && (l.role === 'order-sl' || l.role === 'order-tp') ? { ...l.basis, entry } : l.basis;
  const pnl = pnlAtLevel(basis, at).pnl;
  return { text: `${signed(pnl)} ${quoteOf(l)}`, tone: pnl > 0 ? 'up' : pnl < 0 ? 'down' : null };
}

/** The line's colour: an entry its side's, a SL / TP theirs, an order its side's. */
export function lineColor(l: TradeLine, p: TradePalette): string {
  switch (l.role) {
    case 'entry':
      return l.position?.side === 'short' ? p.short : p.long;
    case 'sl':
    case 'order-sl':
      return p.sl;
    case 'tp':
    case 'order-tp':
      return p.tp;
    case 'order':
      return l.order?.side === 'sell' ? p.sell : p.buy;
    default:
      return p.liquidation;
  }
}

/** How many coins / shares a line stands for: what it closes (SL / TP), the position (entry), what an order trades. */
export function lineQty(l: TradeLine): number | null {
  if (l.role === 'liquidation') return null;
  if (l.role === 'order' && l.order) return l.order.amount !== null ? l.order.amount * (l.order.market === 'futures' ? (l.order.contractSize ?? 1) : 1) : null;
  return l.basis?.qty ?? null;
}

/**
 * The chart's line for a trade line: its colour, style (solid; liquidation dotted; an order dashed; dragged dotted), and
 * its box. The library draws the line and the price on the scale; the box is Sentiq's (no title of the library's).
 */
export function chartLineOf(l: AccountLine, o: { last: number | null; drafted: boolean; entryDraft?: number; several: boolean; palette: TradePalette; close: boolean; draggable: boolean }): PriceLineSpec {
  const color = lineColor(l, o.palette);
  const { text, tone } = labelText(l, l.price, o.last, o.entryDraft);
  const qty = lineQty(l);
  const style: PriceLineSpec['style'] = o.drafted || l.role === 'liquidation' ? 'dotted' : l.role === 'order' ? 'dashed' : 'solid';
  return {
    id: l.id,
    price: l.price,
    // A pending change: the line dimmed, its price on the scale solid (as TradingView).
    color: o.drafted ? formatColor(color, 153) : color,
    ...(o.drafted ? { axisLabelColor: color } : {}),
    title: '',
    style,
    draggable: o.draggable,
    // A position's SL / TP from its entry; an order's TP / SL from the order's price (its new one, when dragged).
    ...(l.basis && (l.role === 'sl' || l.role === 'tp' || l.role === 'order-sl' || l.role === 'order-tp') ? { zoneFrom: o.entryDraft ?? l.basis.entry } : {}),
    label: {
      qty: qty === null ? null : fmtNum(qty, 8),
      text: o.several ? `${text} · ${l.account.label}` : text,
      textColor: tone === 'up' ? o.palette.up : tone === 'down' ? o.palette.down : color,
      close: o.close,
      fill: l.role === 'entry',
      ...(o.drafted ? { pending: true } : {}),
    },
  };
}
