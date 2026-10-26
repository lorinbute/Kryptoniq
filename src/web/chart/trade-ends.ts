// FD-TRADESOUND: which trades ended between two readings of an account's portfolio. A trade is an open position (one per
// eToro position, else per symbol and side) or a holding worth at least 1; it ended when it is gone, or (a holding) when at
// most 1 % of it is left. A section the platform did not answer for (an error, the last good data) is not compared.
import type { Portfolio } from '../../shared/api-types.ts';

/** Cash and stablecoins: their balance moving is money, not a trade. */
const CASH = new Set(['USD', 'USDT', 'USDC', 'EUR', 'GBP', 'RON', 'CHF', 'JPY', 'CAD', 'AUD', 'DAI', 'FDUSD', 'TUSD', 'USDE', 'PYUSD', 'USDS', 'USD1', 'BUSD']);
/** What is left of a holding when it was sold (dust). */
const LEFT = 0.01;

interface Trade {
  section: 'positions' | 'balances';
  qty: number;
  /** A holding counts only from a value of 1 (dust and coins without a price do not). */
  counted: boolean;
}

export interface TradeSnapshot {
  /** When it was read (the page's clock). */
  at: number;
  trades: Map<string, Trade>;
  /** Sections without a fresh answer this time. */
  skip: { positions: boolean; balances: boolean };
}

/**
 * The trades of a portfolio reading. With `base` (FIX-COINSOUND2), only those of the chart's asset, as its lines are drawn
 * (FD-PNL): a position on any of its pairs (`SOL/USDT:USDT`, `TSLA/USD`), a holding of it.
 */
export function tradeKeys(p: Portfolio, at: number, base?: string): TradeSnapshot {
  const trades = new Map<string, Trade>();
  for (const pos of p.positions) {
    if (base !== undefined && !pos.symbol.startsWith(`${base}/`)) continue;
    const qty = Math.abs(pos.contracts || pos.size || 0);
    if (!(qty > 0)) continue;
    const ids = pos.ref?.positionIds ?? [];
    if (ids.length) for (const id of ids) trades.set(`pos:${id}`, { section: 'positions', qty, counted: true });
    else trades.set(`${pos.symbol}|${pos.side}`, { section: 'positions', qty, counted: true });
  }
  for (const b of p.balances) {
    if (base !== undefined && b.asset !== base) continue;
    if (CASH.has(b.asset.toUpperCase()) || !(b.total > 0)) continue;
    const ids = b.ref?.positionIds ?? [];
    if (ids.length) for (const id of ids) trades.set(`pos:${id}`, { section: 'balances', qty: b.total, counted: true });
    else trades.set(`bal:${b.asset}`, { section: 'balances', qty: b.total, counted: b.value !== null && b.value >= 1 });
  }
  const off = (s: 'positions' | 'balances') => Boolean(p.errors[s]) || p.stale[s] !== undefined;
  return { at, trades, skip: { positions: off('positions'), balances: off('balances') } };
}

/**
 * FIX-COINSOUND: two readings this far apart (or more) were not made while watching: the computer slept, the phone kept
 * the app in the background, the window waited behind others. What ended in between closed while nobody watched.
 */
export const MAX_GAP_MS = 50_000;

/**
 * The trades of `prev` that ended by `next` (an empty list when none did, nothing could be compared, or the two readings
 * are too far apart to have been made while watching).
 */
export function endedTrades(prev: TradeSnapshot, next: TradeSnapshot): string[] {
  if (next.at - prev.at > MAX_GAP_MS) return [];
  const out: string[] = [];
  for (const [key, t] of prev.trades) {
    if (!t.counted || next.skip[t.section] || prev.skip[t.section]) continue;
    const now = next.trades.get(key);
    if (!now || (key.startsWith('bal:') && now.qty <= t.qty * LEFT)) out.push(key);
  }
  return out;
}
