// PnL of the open trade at its stop-loss / take-profit orders and at the current price (FD-PNL / TD-PNL).
import type { BalanceRow, OrderRow, PositionRow } from '../../shared/api-types.ts';
import { etoroProtectionOf } from '../../shared/trading.ts';
import { fmtNum } from '../format.ts';
import type { PriceLineSpec } from './CandleChart.tsx';

/** Spot holdings worth less than this (in the quote coin) are leftovers, not a trade. */
export const DUST_VALUE = 1;

export const PNL_COLORS = { entry: '#E2B866', sl: '#FF5C5C', tp: '#00FFAA', other: '#8FB3FF', liquidation: '#FF5C5C' } as const;
/** The same roles on the light theme (FD-THEME §1): darker, to stand out on white. */
export const PNL_COLORS_LIGHT = { entry: '#0B6F80', sl: '#C2332B', tp: '#0F7444', other: '#1F5BC4', liquidation: '#C2332B' } as const;
export type PnlPalette = { readonly [K in keyof typeof PNL_COLORS]: string };

interface Trade {
  market: 'futures' | 'spot';
  long: boolean;
  entry: number;
  /** Quantity in the base coin. */
  qty: number;
  /** Futures: contracts in the position and base coin per contract (orders are sized in contracts). */
  contracts: number | null;
  perContract: number | null;
  /** Symbol of the closing orders. */
  symbol: string;
  quote: string;
  liquidation: number | null;
  /** eToro: the position's id (each one is apart, FD-HEDGEALL). */
  ref?: string;
}

export interface PnlInput {
  base: string;
  quote: string;
  /** Last price on the chart. */
  lastPrice: number | null;
  positions: PositionRow[];
  balances: BalanceRow[];
  orders: OrderRow[];
  /** The account's name, added to every title when several accounts are shown. */
  account?: string;
  /** The account's id: the lines' ids stay apart across accounts (FD-ORDEREDIT). */
  accountId?: number;
  /** A share at a broker (FD-SENTIQ): its holding is no "spot" trade, just shares. */
  stock?: boolean;
}

const signed = (v: number, digits: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtNum(Math.abs(v), digits, digits)}`;

/** "+31,45 USDT (+8,2%)". */
export function pnlText(pnl: number, cost: number, quote: string): string {
  const pct = cost > 0 ? (pnl / cost) * 100 : NaN;
  return `${signed(pnl, 2)} ${quote}${Number.isFinite(pct) ? ` (${signed(pct, 1)}%)` : ''}`;
}

/** What a level is worth for a trade (FD-PNL, FD-ORDEREDIT): its side, entry, the quantity it closes (coins) and quote. */
export interface PnlBasis {
  long: boolean;
  entry: number;
  qty: number;
  quote: string;
}

/** The PnL if the price reaches `level`, and its share of the cost. */
export function pnlAtLevel(b: PnlBasis, level: number): { pnl: number; pct: number; text: string } {
  const pnl = (b.long ? level - b.entry : b.entry - level) * b.qty;
  const cost = b.entry * b.qty;
  return { pnl, pct: cost > 0 ? (pnl / cost) * 100 : NaN, text: pnlText(pnl, cost, b.quote) };
}

/**
 * FD-ORDEREDIT: what moving a level does to the PnL. "−42,10 USDT (−1,6%) · înainte −56,00 USDT (−2,1%) · +13,90 USDT";
 * a level added has no "before", one removed no "after". `wasBasis`: the order as it was, when its amount changes too.
 */
export function pnlImpact(b: PnlBasis, before: number | null, after: number | null, wasBasis: PnlBasis = b): string {
  if (after === null) return before === null ? '' : `fără nivel (era ${pnlAtLevel(wasBasis, before).text})`;
  const now = pnlAtLevel(b, after);
  if (before === null || (before === after && wasBasis.qty === b.qty)) return now.text;
  const was = pnlAtLevel(wasBasis, before);
  return `${now.text} · înainte ${was.text} · ${signed(now.pnl - was.pnl, 2)} ${b.quote}`;
}

function tradesOf(input: PnlInput): Trade[] {
  const out: Trade[] = [];
  for (const p of input.positions) {
    if (!p.symbol.startsWith(`${input.base}/`) || !p.entryPrice || !p.size || p.size <= 0) continue;
    const settle = p.symbol.split(':')[1] ?? p.symbol.split('/')[1]?.split(':')[0] ?? input.quote;
    const ref = p.ref?.positionIds?.length === 1 ? p.ref.positionIds[0] : undefined;
    out.push({
      market: 'futures',
      long: p.side !== 'short',
      entry: p.entryPrice,
      qty: p.size,
      contracts: p.contracts > 0 ? p.contracts : null,
      perContract: p.contracts > 0 ? p.size / p.contracts : null,
      symbol: p.symbol,
      quote: settle,
      liquidation: p.liquidationPrice,
      ...(ref ? { ref } : {}),
    });
  }
  // Spot: the holding across accounts (trade + main), priced at its average buy price.
  const rows = input.balances.filter((b) => b.asset === input.base && b.avgPrice !== null && b.avgPrice > 0);
  const qty = rows.reduce((a, b) => a + b.total, 0);
  const avg = rows[0]?.avgPrice ?? null;
  // Dust (worth under 1 unit of the quote) is not a trade: no lines for it.
  const dust = input.lastPrice !== null && qty * input.lastPrice < DUST_VALUE;
  if (qty > 0 && avg && !dust) {
    // eToro keeps a holding as positions too (FD-HEDGEALL): one alone can have its SL / TP changed.
    const ids = rows.flatMap((b) => b.ref?.positionIds ?? []);
    out.push({ market: 'spot', long: true, entry: avg, qty, contracts: null, perContract: null, symbol: `${input.base}/${input.quote}`, quote: input.quote, liquidation: null, ...(ids.length === 1 ? { ref: ids[0] } : {}) });
  }
  return out;
}

/** Stop-loss or take-profit, from the side that closes the trade and the direction that triggers the order. */
export function roleOf(o: OrderRow, t: Trade, lastPrice: number | null): 'sl' | 'tp' | null {
  const closing = t.long ? 'sell' : 'buy';
  if (o.side !== closing) return null;
  // FD-KUCOINHEDGE: a hedge-mode order belongs to one position (a sell opening the short is no TP of the long).
  if (o.positionSide && o.positionSide !== (t.long ? 'long' : 'short')) return null;
  // eToro: a position's stop loss / take profit belong to it alone (two positions on one instrument stay apart).
  const own = etoroProtectionOf(o);
  if (own && t.ref && own.positionId !== t.ref) return null;
  // A perpetual's order (BTC/USDT:USDT) is futures wherever it is listed (KuCoin's unified account lists it with spot).
  const futuresOrder = o.market === 'futures' || o.symbol.includes(':');
  if (t.market === 'futures' ? !futuresOrder || o.symbol !== t.symbol : futuresOrder || o.symbol !== t.symbol) return null;
  if (o.triggerPrice === null) return o.price !== null ? 'tp' : null;
  const dir = o.stop ?? (lastPrice !== null ? (o.triggerPrice < lastPrice ? 'down' : 'up') : null);
  if (dir === null) return null;
  // A long loses when the price falls: a stop that fires on the way down protects it.
  return (dir === 'down') === t.long ? 'sl' : 'tp';
}

/**
 * The levels an order closing the trade stands for (FD-ORDEREDIT): its trigger (a stop: SL or TP by direction), the two
 * levels of an order with no trigger but a stop loss / take profit (OKX's conditional / oco), or its limit price (a TP).
 */
function legsOf(o: OrderRow, t: Trade, lastPrice: number | null): { role: 'sl' | 'tp'; price: number; leg: TradeLegKind }[] {
  if (o.triggerPrice === null && (o.stopLoss != null || o.takeProfit != null)) {
    // Its own levels: only an order that closes this trade.
    if (roleOf({ ...o, triggerPrice: null, price: o.price ?? 0 }, t, lastPrice) === null) return [];
    const out: { role: 'sl' | 'tp'; price: number; leg: TradeLegKind }[] = [];
    if (o.stopLoss != null) out.push({ role: 'sl', price: o.stopLoss, leg: 'sl' });
    if (o.takeProfit != null) out.push({ role: 'tp', price: o.takeProfit, leg: 'tp' });
    return out;
  }
  const role = roleOf(o, t, lastPrice);
  const price = o.triggerPrice ?? o.price;
  if (!role || price === null || !Number.isFinite(price)) return [];
  return [{ role, price, leg: o.triggerPrice !== null ? 'trigger' : 'price' }];
}

/** Which of an order's values a line stands for. */
export type TradeLegKind = 'trigger' | 'price' | 'sl' | 'tp';
export type TradeLineRole = 'entry' | 'liquidation' | 'sl' | 'tp' | 'pnl' | 'order' | 'order-sl' | 'order-tp';

/** One line of the trades on the chart (FD-PNL, FD-ORDEREDIT): what it is, and what moving it would change. */
export interface TradeLine extends PriceLineSpec {
  /** Stable across reads: the account, the role and the order (or the trade). */
  id: string;
  role: TradeLineRole;
  /** The position or the order it belongs to: Confirm / Discard sit on the group's entry or order line. */
  group: string;
  /** The order this level is, and which of its values. */
  order?: OrderRow;
  leg?: TradeLegKind;
  /** For the PnL at another level. */
  basis?: PnlBasis;
  /** The title without its PnL ("SL (Main)"), for the title at another level (a dragged line). */
  name?: string;
  /** The position a SL / TP belongs to (for its change: the side, eToro's position id). */
  position?: { side: 'long' | 'short'; ref?: string; symbol: string; market: 'futures' | 'spot' };
}

/** The trades' lines: entry, liquidation, SL / TP with their PnL, the PnL now, and the other open orders on the symbol. */
export function tradeLinesOf(input: PnlInput, colors: PnlPalette = PNL_COLORS): { lines: TradeLine[]; usedOrders: Set<string> } {
  const lines: TradeLine[] = [];
  const used = new Set<string>();
  const trades = tradesOf(input);
  const both = trades.length > 1;
  // FD-KUCOINHEDGE: a long and a short on the pair (hedge mode) are told apart by their side, not "futures".
  const futures = trades.filter((t) => t.market === 'futures');
  const hedged = futures.some((t) => t.long) && futures.some((t) => !t.long);
  const acct = input.account ? ` (${input.account})` : '';
  const ns = `${input.accountId ?? 0}`;
  for (const t of trades) {
    const side = t.long ? 'LONG' : 'SHORT';
    const tag = `${both ? ` ${hedged && t.market === 'futures' ? side : t.market}` : ''}${acct}`;
    const group = `${ns}|trade|${t.symbol}|${side}|${t.ref ?? ''}`;
    const position = { side: (t.long ? 'long' : 'short') as 'long' | 'short', symbol: t.symbol, market: t.market, ...(t.ref ? { ref: t.ref } : {}) };
    lines.push({
      id: `${group}|entry`,
      role: 'entry',
      group,
      price: t.entry,
      color: colors.entry,
      title: `Intrare ${t.market === 'spot' ? (input.stock ? '' : 'spot ') : `${side} `}${t.market === 'futures' && both && !input.stock ? 'futures ' : ''}${fmtNum(t.qty, 8)} ${input.base}${acct}`,
      style: 'solid',
      position,
      basis: { long: t.long, entry: t.entry, qty: t.qty, quote: t.quote },
    });
    if (t.liquidation) lines.push({ id: `${group}|liq`, role: 'liquidation', group, price: t.liquidation, color: colors.liquidation, title: `Lichidare${tag}`, style: 'dotted' });
    for (const o of input.orders) {
      const legs = legsOf(o, t, input.lastPrice);
      if (!legs.length) continue;
      // An order that closes part of the trade realises the PnL of that part only.
      const orderQty = o.amount !== null && o.amount > 0 ? (t.market === 'futures' ? (t.contracts && t.perContract ? Math.min(o.amount, t.contracts) * t.perContract : t.qty) : Math.min(o.amount, t.qty)) : t.qty;
      const basis = { long: t.long, entry: t.entry, qty: orderQty, quote: t.quote };
      used.add(`${o.market}:${o.id}`);
      for (const { role, price, leg } of legs) {
        const label = `${role === 'sl' ? 'SL' : 'TP'}${tag}`;
        lines.push({
          id: `${ns}|${role}|${o.market}:${o.id}|${leg}`,
          role,
          group,
          price,
          color: role === 'sl' ? colors.sl : colors.tp,
          title: `${label} ${pnlAtLevel(basis, price).text}`,
          name: label,
          style: 'dashed',
          order: o,
          leg,
          basis,
          position,
        });
      }
    }
    if (input.lastPrice !== null && Number.isFinite(input.lastPrice)) {
      const now = pnlAtLevel({ long: t.long, entry: t.entry, qty: t.qty, quote: t.quote }, input.lastPrice);
      lines.push({
        id: `${group}|pnl`,
        role: 'pnl',
        group,
        price: input.lastPrice,
        color: now.pnl >= 0 ? colors.tp : colors.sl,
        title: `PnL${tag} ${now.text}`,
        style: 'solid',
        // The library draws a price line's title only with its axis label: the label sits on the current price.
        lineVisible: false,
      });
    }
  }
  // Other orders on this coin: their own line, and the TP / SL attached to them (FD-ORDEREDIT).
  for (const o of input.orders) {
    if (used.has(`${o.market}:${o.id}`)) continue;
    if (!o.symbol.startsWith(`${input.base}/`) || (o.market === 'spot' && !o.symbol.startsWith(`${input.base}/${input.quote}`))) continue;
    const price = o.triggerPrice ?? o.price;
    if (!price) continue;
    const group = `${ns}|order|${o.market}:${o.id}`;
    const title = `${o.side} ${o.type}${o.triggerPrice ? ' stop' : ''}`;
    lines.push({ id: `${group}|line`, role: 'order', group, price, color: colors.other, title, name: title, style: 'dashed', order: o, leg: o.triggerPrice !== null ? 'trigger' : 'price' });
    const qty = o.amount !== null && o.amount > 0 ? o.amount * (o.market === 'futures' ? (o.contractSize ?? 1) : 1) : null;
    const quote = o.symbol.split(':')[1] ?? o.symbol.split('/')[1]?.split(':')[0] ?? input.quote;
    const basis = qty !== null ? { long: o.side === 'buy', entry: o.price ?? price, qty, quote } : undefined;
    for (const [role, level, leg] of [
      ['order-sl', o.stopLoss, 'sl'],
      ['order-tp', o.takeProfit, 'tp'],
    ] as const) {
      // An entry's attached levels only: an order that only closes is a level itself (some platforms repeat it).
      if (o.reduceOnly || level == null || !Number.isFinite(level)) continue;
      lines.push({
        id: `${group}|${leg}`,
        role,
        group,
        price: level,
        color: role === 'order-sl' ? colors.sl : colors.tp,
        title: `${leg === 'sl' ? 'SL' : 'TP'} ordin${basis ? ` ${pnlAtLevel(basis, level).text}` : ''}`,
        name: `${leg === 'sl' ? 'SL' : 'TP'} ordin`,
        style: 'dashed',
        order: o,
        leg,
        ...(basis ? { basis } : {}),
      });
    }
  }
  return { lines, usedOrders: used };
}

/** The trade's lines: entry, liquidation, SL / TP orders with their PnL, and the PnL at the current price. */
export function pnlLines(input: PnlInput, colors: PnlPalette = PNL_COLORS): { lines: PriceLineSpec[]; usedOrders: Set<string> } {
  const r = tradeLinesOf(input, colors);
  return {
    lines: r.lines
      .filter((l) => l.role !== 'order' && l.role !== 'order-sl' && l.role !== 'order-tp')
      .map(({ price, color, title, style, lineVisible, axisLabelVisible }) => ({ price, color, title, style, ...(lineVisible !== undefined ? { lineVisible } : {}), ...(axisLabelVisible !== undefined ? { axisLabelVisible } : {}) })),
    usedOrders: r.usedOrders,
  };
}
