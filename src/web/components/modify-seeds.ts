// FD-ORDEREDIT: what "SL / TP" and "Modifică" open. A position's (or a holding's) stop losses / take profits, read as the
// chart reads them, with the PnL each one closes; or one open order, with what its levels are worth.
import type { AccountView, BalanceRow, OrderRow, Portfolio, PositionRow } from '../../shared/api-types.ts';
import { etoroProtectionOf, orderEditMode, type ModifyStepPlan, type ModifyValues, type TradeMarket } from '../../shared/trading.ts';
import { pnlImpact, tradeLinesOf, type PnlBasis, type PnlInput, type TradeLine } from '../chart/pnl.ts';

/** One stop loss / take profit of a position: an order (or eToro's level), or a new one (`orderId` null). */
export interface ProtectionRow {
  what: 'sl' | 'tp';
  orderId: string | null;
  level: number | null;
  /** What it closes, for the PnL at a level. */
  basis: PnlBasis | null;
}

export type ModifySeed =
  | {
      kind: 'protection';
      account: AccountView;
      market: TradeMarket;
      symbol: string;
      position: { side: 'long' | 'short'; ref?: string };
      rows: ProtectionRow[];
      /** The whole position, for a level added. */
      basis: PnlBasis | null;
      /** Whether a stop loss / take profit can be added (else only the orders there are change). */
      add: boolean;
      title: string;
    }
  | {
      kind: 'order';
      account: AccountView;
      market: TradeMarket;
      symbol: string;
      order: OrderRow;
      /** An order that closes a position: what it closes. An entry: what it opens (its price and amount). */
      basis: PnlBasis | null;
      closes: boolean;
      title: string;
    };

/** A level is added as a new order that only closes (futures) or as eToro's own position level. */
export const canAddProtection = (account: AccountView, market: TradeMarket): boolean => account.exchange === 'etoro' || (account.kind === 'crypto' && market === 'futures');

/** The quote a symbol is priced in: "BTC/USDT:USDT" → USDT, "AAPL/USD" → USD. */
const quoteOf = (symbol: string, fallback: string) => symbol.split('/')[1]?.split(':')[0] || fallback;

/** The stop losses / take profits of the trade a group of lines stands for. */
export function protectionRowsOf(lines: TradeLine[], group: string): ProtectionRow[] {
  return lines.flatMap((l) => (l.group === group && (l.role === 'sl' || l.role === 'tp') && l.order ? [{ what: l.role, orderId: l.order.id, level: l.price, basis: l.basis ?? null }] : []));
}

/** The form of the one trade `input` holds (a position or a holding), or null when it has nothing to change. */
function tradeSeed(account: AccountView, market: TradeMarket, input: PnlInput, symbol: string, label: string): ModifySeed | null {
  if (!account.trading.enabled || !account.trading.markets.includes(market)) return null;
  const { lines } = tradeLinesOf(input);
  const entry = lines.find((l) => l.role === 'entry');
  if (!entry?.position) return null;
  // eToro changes one position at a time: a holding made of several has its levels changed from the orders.
  if (account.exchange === 'etoro' && !entry.position.ref) return null;
  const rows = protectionRowsOf(lines, entry.group);
  const add = canAddProtection(account, market);
  if (!rows.length && !add) return null;
  return {
    kind: 'protection',
    account,
    market,
    symbol,
    position: { side: entry.position.side, ...(entry.position.ref ? { ref: entry.position.ref } : {}) },
    rows,
    basis: entry.basis ?? null,
    add,
    title: `SL / TP ${label}`,
  };
}

/** "SL / TP" on a position: its stop losses / take profits, and a new one where the platform takes it. */
export function positionSeed(account: AccountView, p: Pick<Portfolio, 'orders'>, pos: PositionRow): ModifySeed | null {
  const stocks = account.kind === 'stocks';
  const base = pos.symbol.split('/')[0] ?? pos.symbol;
  const input: PnlInput = { base, quote: quoteOf(pos.symbol, stocks ? 'USD' : 'USDT'), lastPrice: pos.markPrice, positions: [pos], balances: [], orders: p.orders, accountId: account.id, stock: stocks };
  return tradeSeed(account, stocks ? 'stock' : 'futures', input, stocks ? base : pos.symbol, stocks ? base : pos.symbol);
}

/** "SL / TP" on a holding (eToro: one position; elsewhere: the stop / limit sells there are). */
export function holdingSeed(account: AccountView, p: Pick<Portfolio, 'orders' | 'balances'>, b: BalanceRow): ModifySeed | null {
  const stocks = account.kind === 'stocks';
  const quote = stocks ? 'USD' : 'USDT';
  const input: PnlInput = { base: b.asset, quote, lastPrice: b.price, positions: [], balances: p.balances.filter((x) => x.asset === b.asset), orders: p.orders, accountId: account.id, stock: stocks };
  return tradeSeed(account, stocks ? 'stock' : 'spot', input, stocks ? b.asset : `${b.asset}/${quote}`, b.asset);
}

/**
 * "Modifică" on an open order. eToro's `sl-` / `tp-` rows open their position's form; an order that closes a position
 * carries what it closes (its PnL at the new level), an entry what it opens.
 */
export function orderSeed(account: AccountView, p: Pick<Portfolio, 'orders' | 'positions' | 'balances'>, o: OrderRow): ModifySeed | null {
  if (!account.trading.enabled || orderEditMode(account.exchange, o) === null) return null;
  const stocks = account.kind === 'stocks';
  const own = etoroProtectionOf(o);
  if (own) {
    const pos = p.positions.find((x) => x.ref?.positionIds?.includes(own.positionId));
    if (pos) return positionSeed(account, p, pos);
    const b = p.balances.find((x) => x.ref?.positionIds?.includes(own.positionId));
    if (b && b.ref?.positionIds?.length === 1) return holdingSeed(account, p, b);
    // One position of a holding made of several: its own levels, without a PnL (its own entry is not read).
    if (!account.trading.markets.includes('stock')) return null;
    const base = o.symbol.split('/')[0] ?? o.symbol;
    const rows = p.orders.flatMap((x) => {
      const w = etoroProtectionOf(x);
      return w && w.positionId === own.positionId ? [{ what: w.what, orderId: x.id, level: x.triggerPrice ?? x.price, basis: null }] : [];
    });
    return { kind: 'protection', account, market: 'stock', symbol: base, position: { side: o.side === 'sell' ? 'long' : 'short', ref: own.positionId }, rows, basis: null, add: true, title: `SL / TP ${base}` };
  }
  // The order's market as the server reads it: a perpetual's order is futures wherever it is listed.
  const market: TradeMarket = stocks ? 'stock' : o.symbol.includes(':') ? 'futures' : o.market;
  if (!account.trading.markets.includes(market)) return null;
  const base = o.symbol.split('/')[0] ?? o.symbol;
  const quote = quoteOf(o.symbol, stocks ? 'USD' : 'USDT');
  const symbol = stocks ? base : o.symbol;
  const title = `Modifică ordinul ${stocks ? base : o.symbol}`;
  // A stop loss / take profit of a position: the line the chart draws for it knows what it closes.
  const input: PnlInput = { base, quote, lastPrice: null, positions: p.positions, balances: p.balances.filter((x) => x.asset === base), orders: [o], accountId: account.id, stock: stocks };
  const mark = p.positions.find((x) => x.symbol === o.symbol)?.markPrice ?? p.balances.find((x) => x.asset === base)?.price ?? null;
  const line = tradeLinesOf({ ...input, lastPrice: mark }).lines.find((l) => (l.role === 'sl' || l.role === 'tp') && l.order?.id === o.id);
  if (line?.basis) return { kind: 'order', account, market, symbol, order: o, basis: line.basis, closes: true, title };
  return { kind: 'order', account, market, symbol, order: o, basis: entryBasisOf(o, quote), closes: false, title };
}

/** An entry order's PnL basis: what it opens (coins), at its own price; null for one that only closes. */
export function entryBasisOf(o: OrderRow, quote: string): PnlBasis | null {
  const entry = o.price ?? o.triggerPrice;
  const qty = o.amount !== null && o.amount > 0 ? o.amount * (o.market === 'futures' ? (o.contractSize ?? 1) : 1) : null;
  return entry !== null && qty !== null && !o.reduceOnly ? { long: o.side === 'buy', entry, qty, quote } : null;
}

/** What a step changes on: a position's SL / TP (the basis of the order it moves, or of the position for a new one), or one order. */
export type ImpactContext =
  | { kind: 'protection'; basisOf: (orderId: string | null, what: 'sl' | 'tp') => PnlBasis | null }
  | { kind: 'order'; basis: PnlBasis | null; closes: boolean; amount: number | null };

/**
 * FD-ORDEREDIT: a planned change's PnL, from the server's (rounded) values. A position's level: the PnL there, before
 * and after; an order that closes: at its level, for its amount; an entry: at its TP and SL, from its price and amount.
 */
export function stepImpact(s: ModifyStepPlan, ctx: ImpactContext): string | null {
  if (ctx.kind === 'protection') {
    const what = s.kind === 'tp' ? 'tp' : 'sl';
    const basis = ctx.basisOf(s.orderId, what);
    if (!basis) return null;
    // The value the level is, as the server picks it: the order's trigger, else its own SL / TP (OKX's oco), else its
    // limit price; a level added is its SL / TP.
    const own = (v: ModifyValues) => (what === 'sl' ? v.stopLoss : v.takeProfit);
    const levelOf = (v: ModifyValues) => (s.orderId === null ? own(v) : s.before.triggerPrice !== null ? v.triggerPrice : own(s.before) !== null ? own(v) : v.price);
    const after = s.removes ? null : levelOf(s.after);
    const text = pnlImpact(basis, s.orderId === null ? null : levelOf(s.before), after);
    return text || null;
  }
  if (!ctx.basis) return null;
  const base = ctx.basis;
  // The amount scales what it closes / opens; an entry's price is where it opens.
  const at = (v: ModifyValues): PnlBasis => {
    const qty = v.amount !== null && ctx.amount ? (base.qty * v.amount) / ctx.amount : base.qty;
    return ctx.closes ? { ...base, qty } : { ...base, entry: v.price ?? v.triggerPrice ?? base.entry, qty };
  };
  const b = at(s.after);
  const was = at(s.before);
  if (ctx.closes) {
    const after = s.after.triggerPrice ?? s.after.price;
    return after !== null ? pnlImpact(b, s.before.triggerPrice ?? s.before.price, after, was) : null;
  }
  const parts: string[] = [];
  if (s.after.takeProfit !== null || s.before.takeProfit !== null) parts.push(`la TP ${s.after.takeProfit !== null ? pnlImpact(b, s.before.takeProfit, s.after.takeProfit, was) : 'fără'}`);
  if (s.after.stopLoss !== null || s.before.stopLoss !== null) parts.push(`la SL ${s.after.stopLoss !== null ? pnlImpact(b, s.before.stopLoss, s.after.stopLoss, was) : 'fără'}`);
  return parts.join(' · ') || null;
}
