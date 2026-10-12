// PnL of the open trade at its stop-loss / take-profit orders and at the current price (FD-PNL / TD-PNL).
import type { BalanceRow, OrderRow, PositionRow } from '../../shared/api-types.ts';
import { fmtNum } from '../format.ts';
import type { PriceLineSpec } from './CandleChart.tsx';

/** Spot holdings worth less than this (in the quote coin) are leftovers, not a trade. */
export const DUST_VALUE = 1;

export const PNL_COLORS = { entry: '#E2B866', sl: '#FF5C5C', tp: '#00FFAA', other: '#8FB3FF', liquidation: '#FF5C5C' } as const;

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
}

const signed = (v: number, digits: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtNum(Math.abs(v), digits, digits)}`;

/** "+31,45 USDT (+8,2%)". */
export function pnlText(pnl: number, cost: number, quote: string): string {
  const pct = cost > 0 ? (pnl / cost) * 100 : NaN;
  return `${signed(pnl, 2)} ${quote}${Number.isFinite(pct) ? ` (${signed(pct, 1)}%)` : ''}`;
}

function tradesOf(input: PnlInput): Trade[] {
  const out: Trade[] = [];
  for (const p of input.positions) {
    if (!p.symbol.startsWith(`${input.base}/`) || !p.entryPrice || !p.size || p.size <= 0) continue;
    const settle = p.symbol.split(':')[1] ?? p.symbol.split('/')[1]?.split(':')[0] ?? input.quote;
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
    });
  }
  // Spot: the holding across accounts (trade + main), priced at its average buy price.
  const rows = input.balances.filter((b) => b.asset === input.base && b.avgPrice !== null && b.avgPrice > 0);
  const qty = rows.reduce((a, b) => a + b.total, 0);
  const avg = rows[0]?.avgPrice ?? null;
  // Dust (worth under 1 unit of the quote) is not a trade: no lines for it.
  const dust = input.lastPrice !== null && qty * input.lastPrice < DUST_VALUE;
  if (qty > 0 && avg && !dust) {
    out.push({ market: 'spot', long: true, entry: avg, qty, contracts: null, perContract: null, symbol: `${input.base}/${input.quote}`, quote: input.quote, liquidation: null });
  }
  return out;
}

/** Stop-loss or take-profit, from the side that closes the trade and the direction that triggers the order. */
export function roleOf(o: OrderRow, t: Trade, lastPrice: number | null): 'sl' | 'tp' | null {
  const closing = t.long ? 'sell' : 'buy';
  if (o.side !== closing) return null;
  if (t.market === 'futures' ? o.market !== 'futures' || o.symbol !== t.symbol : o.market !== 'spot' || o.symbol !== t.symbol) return null;
  if (o.triggerPrice === null) return o.price !== null ? 'tp' : null;
  const dir = o.stop ?? (lastPrice !== null ? (o.triggerPrice < lastPrice ? 'down' : 'up') : null);
  if (dir === null) return null;
  // A long loses when the price falls: a stop that fires on the way down protects it.
  return (dir === 'down') === t.long ? 'sl' : 'tp';
}

/** The trade's lines: entry, liquidation, SL / TP orders with their PnL, and the PnL at the current price. */
export function pnlLines(input: PnlInput): { lines: PriceLineSpec[]; usedOrders: Set<string> } {
  const lines: PriceLineSpec[] = [];
  const used = new Set<string>();
  const trades = tradesOf(input);
  const both = trades.length > 1;
  const acct = input.account ? ` (${input.account})` : '';
  for (const t of trades) {
    const tag = `${both ? ` ${t.market}` : ''}${acct}`;
    const side = t.long ? 'LONG' : 'SHORT';
    const pnlAt = (price: number, qty: number) => (t.long ? price - t.entry : t.entry - price) * qty;
    lines.push({
      price: t.entry,
      color: PNL_COLORS.entry,
      title: `Intrare ${t.market === 'spot' ? 'spot' : side}${t.market === 'futures' && both ? ' futures' : ''} ${fmtNum(t.qty, 8)} ${input.base}${acct}`,
      style: 'solid',
    });
    if (t.liquidation) lines.push({ price: t.liquidation, color: PNL_COLORS.liquidation, title: `Lichidare${tag}`, style: 'dotted' });
    for (const o of input.orders) {
      const role = roleOf(o, t, input.lastPrice);
      if (!role) continue;
      const price = o.triggerPrice ?? o.price;
      if (price === null || !Number.isFinite(price)) continue;
      // An order that closes part of the trade realises the PnL of that part only.
      const orderQty = o.amount !== null && o.amount > 0 ? (t.market === 'futures' ? (t.contracts && t.perContract ? Math.min(o.amount, t.contracts) * t.perContract : t.qty) : Math.min(o.amount, t.qty)) : t.qty;
      const pnl = pnlAt(price, orderQty);
      used.add(`${o.market}:${o.id}`);
      lines.push({
        price,
        color: role === 'sl' ? PNL_COLORS.sl : PNL_COLORS.tp,
        title: `${role === 'sl' ? 'SL' : 'TP'}${tag} ${pnlText(pnl, t.entry * orderQty, t.quote)}`,
        style: 'dashed',
      });
    }
    if (input.lastPrice !== null && Number.isFinite(input.lastPrice)) {
      const pnl = pnlAt(input.lastPrice, t.qty);
      lines.push({
        price: input.lastPrice,
        color: pnl >= 0 ? PNL_COLORS.tp : PNL_COLORS.sl,
        title: `PnL${tag} ${pnlText(pnl, t.entry * t.qty, t.quote)}`,
        style: 'solid',
        // The library draws a price line's title only with its axis label: the label sits on the current price.
        lineVisible: false,
      });
    }
  }
  return { lines, usedOrders: used };
}
