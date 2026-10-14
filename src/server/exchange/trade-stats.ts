// The results of closed futures positions (FD-TRADESTATS, TD-TRADESTATS §2): read in pieces the exchanges allow,
// deduplicated, counted as wins / losses / break-even, with the net result in dollars.
import type { Exchange, Position } from 'ccxt';
import { dayBounds, dayKey } from '../../shared/time.ts';
import { STABLES } from './cost-basis.ts';

export const STATS_PERIODS = ['today', '7d', '30d', '90d'] as const;
export type StatsPeriod = (typeof STATS_PERIODS)[number];

const HOUR = 3_600_000;
const DAY = 86_400_000;
/** KuCoin and Bybit answer at most 7 days per request. */
export const STATS_WINDOW_MS = 7 * DAY;
/** Windows asked at once. */
const PARALLEL = 3;
/** OKX: pages of 100 going back; at most this many (1000 closed positions). */
const MAX_PAGES = 10;

/** How each exchange gives its closed positions; the others have no such history in ccxt (Binance) or no futures here. */
export const HISTORY: Record<string, { limit: number; mode: 'windows' | 'pages'; params: Record<string, unknown> }> = {
  kucoin: { limit: 200, mode: 'windows', params: {} },
  bybit: { limit: 100, mode: 'windows', params: { subType: 'linear' } },
  bitget: { limit: 100, mode: 'windows', params: {} },
  okx: { limit: 100, mode: 'pages', params: {} },
};

/** Where a period starts: today at 00:00 in the user's time zone, otherwise N days back. */
export function periodStart(period: StatsPeriod, now: number, tz: string): number {
  if (period === 'today') return dayBounds(dayKey(now, tz), tz).start;
  return now - Number(period.slice(0, -1)) * DAY;
}

/** When a closed position was closed (KuCoin `closeTime`, the others' update time). */
export const closedAt = (p: Position): number => Number(p.lastUpdateTimestamp ?? p.timestamp ?? 0);

/** A closed position's identity across overlapping requests. */
function keyOf(p: Position): string {
  const info = (p.info ?? {}) as Record<string, unknown>;
  const id = p.id ?? info.closeId ?? info.posId ?? info.orderId;
  return id !== undefined && id !== null && id !== '' ? `${p.symbol}|${String(id)}` : `${p.symbol}|${closedAt(p)}|${String(p.realizedPnl)}`;
}

type Fetch = (since: number | undefined, until: number | undefined, limit: number, params: Record<string, unknown>) => Promise<Position[]>;

/**
 * Every position closed in [from, to]. Windows of 7 days (three at a time); a window that comes back full is halved
 * until it is not (or is under an hour). OKX instead pages back from now with `after`.
 */
export async function fetchClosedPositions(exchange: string, fetch: Fetch, from: number, to: number): Promise<Position[]> {
  const h = HISTORY[exchange];
  if (!h) return [];
  const found: Position[] = [];
  if (h.mode === 'pages') {
    let after: number | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const got = await fetch(undefined, undefined, h.limit, after === undefined ? h.params : { ...h.params, after });
      found.push(...got);
      const oldest = Math.min(...got.map(closedAt).filter((t) => t > 0));
      if (got.length < h.limit || !Number.isFinite(oldest) || oldest < from || (after !== undefined && oldest >= after)) break;
      after = oldest;
    }
  } else {
    const window = async (since: number, until: number): Promise<Position[]> => {
      const got = await fetch(since, until, h.limit, h.params);
      if (got.length < h.limit || until - since <= HOUR) return got;
      const mid = Math.floor((since + until) / 2);
      return [...(await window(since, mid)), ...(await window(mid + 1, until))];
    };
    const windows: [number, number][] = [];
    for (let end = to; end > from; end -= STATS_WINDOW_MS) windows.push([Math.max(from, end - STATS_WINDOW_MS + 1), end]);
    for (let i = 0; i < windows.length; i += PARALLEL) {
      for (const got of await Promise.all(windows.slice(i, i + PARALLEL).map(([s, u]) => window(s, u)))) found.push(...got);
    }
  }
  const seen = new Set<string>();
  return found.filter((p) => {
    const t = closedAt(p);
    if (t < from || t > to) return false;
    const k = keyOf(p);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** The currency a position settles in: after ":" in a contract symbol (BTC/USDT:USDT), else its quote. */
export function settleOf(p: Position): string {
  const sym = String(p.symbol ?? '');
  const [pair = '', settle] = sym.split(':');
  return (settle ?? pair.split('/')[1] ?? '').toUpperCase();
}

export interface ClosedSummary {
  wins: number;
  losses: number;
  breakeven: number;
  /** Wins out of wins + losses, in percent; null without either. */
  successRate: number | null;
  /** In dollars. */
  net: number;
  /** Some results settled in a coin without a price: counted, but not in `net`. */
  netPartial: boolean;
}

/**
 * A closed position's net result: the exchange's own net figure where ccxt reads a gross one (Bitget `netProfit`, after
 * fees; ccxt's `realizedPnl` is its `pnl`), otherwise `realizedPnl` (KuCoin `pnl`, Bybit `closedPnl`, OKX `realizedPnl`:
 * all after fees and funding).
 */
export function netResult(p: Position): number {
  const info = (p.info ?? {}) as Record<string, unknown>;
  const net = info.netProfit !== undefined && info.netProfit !== null && info.netProfit !== '' ? Number(info.netProfit) : NaN;
  return Number.isFinite(net) ? net : Number(p.realizedPnl);
}

/** `price(asset)`: dollars per unit of a settlement coin (stablecoins are 1), or null when unknown. */
export function summarizeClosed(positions: Position[], price: (asset: string) => number | null): ClosedSummary {
  let wins = 0;
  let losses = 0;
  let breakeven = 0;
  let net = 0;
  let netPartial = false;
  for (const p of positions) {
    const pnl = netResult(p);
    if (!Number.isFinite(pnl)) continue;
    if (pnl > 0) wins++;
    else if (pnl < 0) losses++;
    else breakeven++;
    const settle = settleOf(p);
    const rate = STABLES.has(settle) ? 1 : price(settle);
    if (rate === null) netPartial = true;
    else net += pnl * rate;
  }
  return { wins, losses, breakeven, successRate: wins + losses ? Math.round((wins / (wins + losses)) * 1000) / 10 : null, net, netPartial };
}

/** The coins (not stablecoins) the results settle in, for their prices. */
export const settleCoins = (positions: Position[]): string[] => [...new Set(positions.map(settleOf).filter((c) => c && !STABLES.has(c)))];

/** ccxt's call with the shape `fetchClosedPositions` needs. */
export const historyFetch =
  (ex: Exchange, retry: <T>(fn: () => Promise<T>) => Promise<T>): Fetch =>
  (since, until, limit, params) =>
    retry(() => ex.fetchPositionsHistory(undefined, since, limit, until === undefined ? params : { ...params, until }));
