// Stock brokers with an API key (FD-SENTIQ §3, TD-SENTIQ §4): Trading 212, eToro, Interactive Brokers (Flex Web
// Service) and Alpaca. Read-only: every request here is a GET (orders are in exchange/trading/, FD-TRADING). The rows use the same shapes as the crypto portfolio.
import { randomUUID } from 'node:crypto';
import { HttpError, httpRequest, type HttpResponse } from '../net/http.ts';
import { addDays, DAY_MS, dayKey, zonedTimeToUtc } from '../../shared/time.ts';
import type { BalanceRow, ErrorCode, FillRow, OrderRow, PositionRow } from './accounts.ts';

export type BrokerId = 'trading212' | 'etoro' | 'ibkr' | 'alpaca';
export const BROKER_IDS: readonly BrokerId[] = ['trading212', 'etoro', 'ibkr', 'alpaca'];

export class BrokerError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

type Section = 'balances' | 'positions' | 'orders' | 'fills';

export interface BrokerSnapshot {
  /** Currency of the values (the account's). */
  currency: string;
  balances: BalanceRow[];
  positions: PositionRow[];
  orders: OrderRow[];
  fills: FillRow[];
  cash: number | null;
  /** IBKR Flex: the date the report describes (end of that day). */
  asOf?: number;
  /** Sections that failed while the others loaded. */
  errors: Partial<Record<Section, { code: ErrorCode; message: string }>>;
}

export interface BrokerAdapter {
  /** Throws BrokerError when the key cannot read the account. */
  test(): Promise<void>;
  load(): Promise<BrokerSnapshot>;
  /** FD-BROKERSTATS: the trades closed since `from` (without it, the account has no closed-trade stats). */
  closedTrades?(from: number): Promise<ClosedTrades>;
}

/** FD-BROKERSTATS: one closed trade (a closed position, or an order that closed or reduced one). */
export interface ClosedTrade {
  id: string;
  closedAt: number;
  /** Its result; null when it cannot be known (not counted). */
  pnl: number | null;
  /** The result in the account's currency; null without an exchange rate (counted, not summed). */
  net: number | null;
}

export interface ClosedTrades {
  /** The account's currency; null when no trade said it (the portfolio's is used). */
  currency: string | null;
  trades: ClosedTrade[];
  /** Every trade closed from this moment on is in `trades` (0: the whole history; +Infinity: nothing is sure). */
  coveredFrom: number;
  /** IBKR Flex: the data ends at the close of this day. */
  asOf: number | null;
}

export interface BrokerOptions {
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const FILLS_WINDOW_MS = 7 * 86_400_000;
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
/** An ISO time; one written without a zone is UTC. */
export function utcTime(v: unknown): number | null {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return null;
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(s) || !/T\d{2}:\d{2}/.test(s);
  const t = Date.parse(zoned ? s : `${s}Z`);
  return Number.isFinite(t) ? t : null;
}
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : typeof v === 'number' ? String(v) : null);
/** The first of several spellings a broker uses for the same field (eToro mixes `positionID` and `positionId`). */
const pick = (o: Record<string, unknown> | undefined, ...keys: string[]): unknown => {
  if (!o) return undefined;
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
};
const obj = (v: unknown): Record<string, unknown> | undefined => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null) : []);

/** A short, safe excerpt of a broker's error body. */
function bodyMessage(body: string): string {
  try {
    const j = JSON.parse(body) as Record<string, unknown>;
    const m = pick(j, 'message', 'errorMessage', 'error', 'detail', 'title');
    if (typeof m === 'string') return m.slice(0, 200);
    if (obj(m)) return String(pick(obj(m), 'message', 'description') ?? '').slice(0, 200);
  } catch {
    // not JSON
  }
  return body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

/** HTTP status → the same error codes as the crypto exchanges. */
function statusError(broker: string, r: HttpResponse, hints: { forbidden?: string; unauthorized?: string } = {}): BrokerError {
  const detail = bodyMessage(r.body);
  const tail = detail ? ` (${detail})` : '';
  if (r.status === 401) return new BrokerError('AUTH', `${broker}: ${hints.unauthorized ?? 'cheia nu e validă'}${tail}`);
  if (r.status === 403) return new BrokerError('PERMISSION', `${broker}: ${hints.forbidden ?? 'cheia nu are permisiunea necesară'}${tail}`);
  if (r.status === 429) return new BrokerError('RATE_LIMIT', `${broker}: prea multe cereri${tail}`);
  if (r.status === 408 || r.status === 504) return new BrokerError('NETWORK', `${broker}: răspunsul a întârziat${tail}`);
  if (r.status >= 500) return new BrokerError('MAINTENANCE', `${broker}: serverul brokerului nu răspunde (HTTP ${r.status})${tail}`);
  return new BrokerError('EXCHANGE', `${broker}: HTTP ${r.status}${tail}`);
}

function parseJson(broker: string, body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new BrokerError('EXCHANGE', `${broker}: răspuns neașteptat (nu e JSON)`);
  }
}

/** Runs each section on its own: a failing section is reported, the others still load. */
async function section<T>(errors: BrokerSnapshot['errors'], name: Section, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    errors[name] =
      err instanceof BrokerError
        ? { code: err.code, message: err.message }
        : { code: err instanceof HttpError ? 'NETWORK' : 'EXCHANGE', message: (err as Error).message.slice(0, 300) };
    return fallback;
  }
}

const pct = (pnl: number | null, cost: number | null) => (pnl !== null && cost !== null && cost > 0 ? (pnl / cost) * 100 : null);

// ---------------------------------------------------------------- Trading 212

/** History pages read for the closed-trade stats (50 orders each; Trading 212 allows 20 requests a minute there). */
const T212_HISTORY_PAGES = 10;

/** `walletImpact.taxes`: a list of charges (each a `quantity`) in the documented API, a number in older answers. */
function t212Taxes(w: Record<string, unknown>): number | null {
  if (Array.isArray(w.taxes)) {
    const own = str(w.currency);
    const list = arr(w.taxes)
      .filter((t) => !own || !str(t.currency) || str(t.currency) === own)
      .map((t) => num(t.quantity))
      .filter((q): q is number => q !== null);
    return list.length ? list.reduce((a, q) => a + Math.abs(q), 0) : null;
  }
  const n = num(w.taxes);
  return n !== null ? Math.abs(n) : null;
}

/** `AAPL_US_EQ` → AAPL, `VUSAl_EQ` (London) → VUSA. */
export function t212Symbol(ticker: string): string {
  const head = ticker.split('_')[0] ?? ticker;
  return head.replace(/[a-z]+$/, '') || head;
}

class Trading212 implements BrokerAdapter {
  private readonly base: string;
  private readonly auth: string;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  constructor(creds: Record<string, string>, env: string, opts: BrokerOptions) {
    this.base = env === 'demo' ? 'https://demo.trading212.com/api/v0' : 'https://live.trading212.com/api/v0';
    this.auth = `Basic ${Buffer.from(`${creds.apiKey ?? ''}:${creds.secret ?? ''}`).toString('base64')}`;
    this.sleep = opts.sleep ?? defaultSleep;
    this.now = opts.now ?? Date.now;
  }

  private async get(path: string): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      const r = await httpRequest(`${this.base}${path}`, { headers: { Authorization: this.auth, Accept: 'application/json' } });
      if (r.status === 200) return parseJson('Trading 212', r.body);
      // Per-endpoint limits (1 / s to 1 / 5 s): wait for the reset once, then give up until the next refresh.
      if (r.status === 429 && attempt === 0) {
        const reset = num(r.headers.get('x-ratelimit-reset'));
        const waitMs = reset !== null ? Math.max(0, reset * 1000 - this.now()) : 5_000;
        if (waitMs <= 6_000) {
          await this.sleep(waitMs + 250);
          continue;
        }
      }
      const scope = /Scope\(\s*([\w:]+)\s*\)/i.exec(r.body)?.[1];
      throw statusError('Trading 212', r, {
        forbidden: scope ? `activează permisiunea „${scope}” la cheia API` : 'cheia nu are permisiunea necesară (sau IP-ul nu e permis)',
        unauthorized: 'cheie sau secret greșit, ori cheie pentru alt mediu (Live / Demo); doar conturile Invest și Stocks ISA au API',
      });
    }
  }

  async test(): Promise<void> {
    await this.get('/equity/account/summary');
  }

  async load(): Promise<BrokerSnapshot> {
    const errors: BrokerSnapshot['errors'] = {};
    const summary = obj(await this.get('/equity/account/summary')) ?? {};
    const currency = str(summary.currency) ?? 'EUR';
    const cash = num(obj(summary.cash)?.availableToTrade);
    const balances = await section(errors, 'balances', async () => {
      const list = arr(await this.get('/equity/positions'));
      return list.map((p): BalanceRow => {
        const ins = obj(p.instrument) ?? {};
        const w = obj(p.walletImpact) ?? {};
        const ticker = str(ins.ticker) ?? '?';
        const pnl = num(w.unrealizedProfitLoss);
        return {
          asset: t212Symbol(ticker),
          account: 'invest',
          total: num(p.quantity) ?? 0,
          free: num(p.quantityAvailableForTrading) ?? num(p.quantity) ?? 0,
          used: num(p.quantityInPies) ?? 0,
          price: num(p.currentPrice),
          value: num(w.currentValue),
          avgPrice: num(p.averagePricePaid),
          avgSource: 'broker',
          pnl,
          pnlPct: pct(pnl, num(w.totalCost)),
          currency: str(w.currency) ?? currency,
          priceCurrency: str(ins.currency) ?? undefined,
          name: str(ins.name) ?? undefined,
          // FD-TRADING: the exact instrument, for "Vinde".
          ref: { ticker },
        };
      });
    }, []);
    const orders = await section(errors, 'orders', async () => {
      const list = arr(await this.get('/equity/orders'));
      return list.map((o): OrderRow => {
        const ins = obj(o.instrument) ?? {};
        const ticker = str(o.ticker) ?? str(ins.ticker) ?? '?';
        const qty = num(o.quantity);
        const side = (str(o.side) ?? (qty !== null && qty < 0 ? 'SELL' : 'BUY')).toLowerCase();
        const type = (str(o.type) ?? '').toLowerCase();
        const stop = num(o.stopPrice);
        return {
          id: str(o.id) ?? randomUUID(),
          market: 'spot',
          symbol: `${t212Symbol(ticker)}/${str(o.currency) ?? str(ins.currency) ?? 'USD'}`,
          type,
          side,
          price: num(o.limitPrice),
          triggerPrice: stop,
          amount: qty !== null ? Math.abs(qty) : null,
          filled: num(o.filledQuantity),
          status: str(o.status),
          timestamp: Date.parse(String(o.createdAt ?? '')) || null,
          reduceOnly: false,
          // A sell stop fires when the price falls, a buy stop when it rises.
          stop: stop !== null ? (side === 'sell' ? 'down' : 'up') : null,
        };
      });
    }, []);
    const fills = await section(errors, 'fills', async () => {
      const since = this.now() - FILLS_WINDOW_MS;
      const out: FillRow[] = [];
      let path: string | null = '/equity/history/orders?limit=50';
      for (let page = 0; path && page < 2; page++) {
        const resp = obj(await this.get(path)) ?? {};
        let older = false;
        for (const it of arr(resp.items)) {
          const o = obj(it.order) ?? {};
          const f = obj(it.fill);
          if (!f || (str(f.type) ?? 'TRADE') !== 'TRADE') continue;
          const ts = Date.parse(String(f.filledAt ?? ''));
          if (!Number.isFinite(ts)) continue;
          if (ts < since) {
            older = true;
            continue;
          }
          const price = num(f.price);
          const qty = num(f.quantity);
          if (price === null || qty === null) continue;
          const ins = obj(o.instrument) ?? {};
          const w = obj(f.walletImpact) ?? {};
          out.push({
            id: str(f.id) ?? `${str(o.id)}-${ts}`,
            market: 'spot',
            symbol: `${t212Symbol(str(o.ticker) ?? str(ins.ticker) ?? '?')}/${str(o.currency) ?? str(ins.currency) ?? 'USD'}`,
            side: (str(o.side) ?? (qty < 0 ? 'SELL' : 'BUY')).toLowerCase(),
            price,
            amount: Math.abs(qty),
            cost: price * Math.abs(qty),
            fee: t212Taxes(w),
            feeCurrency: str(w.currency),
            timestamp: ts,
          });
        }
        // The history is newest first: once a page reaches older fills there is nothing newer further on.
        const next = str(resp.nextPagePath);
        path = older || !next ? null : next.replace(/^\/api\/v0/, '');
      }
      return out;
    }, []);
    return { currency, balances, positions: [], orders, fills, cash, errors };
  }

  /**
   * FD-BROKERSTATS: the executed sells since `from`, one per order, with the realised result Trading 212 gives
   * (`walletImpact.realisedProfitLoss`, in the account's currency). The history is newest first.
   */
  async closedTrades(from: number): Promise<ClosedTrades> {
    const byOrder = new Map<string, ClosedTrade>();
    let currency: string | null = null;
    let path: string | null = '/equity/history/orders?limit=50';
    let oldest = Number.POSITIVE_INFINITY;
    let reached = false;
    for (let page = 0; path && page < T212_HISTORY_PAGES; page++) {
      const resp = obj(await this.get(path)) ?? {};
      for (const it of arr(resp.items)) {
        const o = obj(it.order) ?? {};
        const f = obj(it.fill);
        const t = utcTime(f?.filledAt) ?? utcTime(o.createdAt);
        if (t === null) continue;
        oldest = Math.min(oldest, t);
        if (t < from) reached = true;
        // Buys, cancelled orders and corporate events (splits, distributions) close nothing.
        if (!f || t < from || (str(f.type) ?? 'TRADE') !== 'TRADE') continue;
        const qty = num(f.quantity);
        if ((str(o.side) ?? (qty !== null && qty < 0 ? 'SELL' : 'BUY')).toUpperCase() !== 'SELL') continue;
        const w = obj(f.walletImpact) ?? {};
        currency ??= str(w.currency);
        const id = str(o.id) ?? str(f.id) ?? String(t);
        const pnl = num(w.realisedProfitLoss);
        const prev = byOrder.get(id);
        const sum = prev ? (prev.pnl === null || pnl === null ? null : prev.pnl + pnl) : pnl;
        byOrder.set(id, { id, closedAt: Math.max(prev?.closedAt ?? t, t), pnl: sum, net: sum });
      }
      const next = str(resp.nextPagePath);
      path = reached || !next ? null : next.replace(/^\/api\/v0/, '');
    }
    // Stopped at the period's start, at the end of the history, or at the page limit (then complete only back to the oldest seen).
    const coveredFrom = path === null ? (reached ? from : 0) : oldest;
    return { currency, trades: [...byOrder.values()], coveredFrom, asOf: null };
  }
}

// ---------------------------------------------------------------- eToro

interface EtoroInstrument {
  symbol: string;
  name: string;
  type: string;
}
/** Instrument id → symbol, shared by the eToro accounts (metadata rarely changes). */
const etoroInstruments = new Map<number, { info: EtoroInstrument; at: number }>();
const ETORO_META_TTL = 24 * 3_600_000;
/** Trade history pages: 100 trades each (the page size eToro allows elsewhere), at most 20 (2 000 trades). */
const ETORO_PAGE_SIZE = 100;
const ETORO_HISTORY_PAGES = 20;

class Etoro implements BrokerAdapter {
  private readonly headers: Record<string, string>;
  private readonly env: 'real' | 'demo';
  private readonly now: () => number;
  constructor(creds: Record<string, string>, env: string, opts: BrokerOptions) {
    this.headers = { 'x-api-key': creds.publicKey ?? '', 'x-user-key': creds.userKey ?? '', Accept: 'application/json' };
    this.env = env === 'demo' ? 'demo' : 'real';
    this.now = opts.now ?? Date.now;
  }

  private async get(path: string): Promise<unknown> {
    const r = await httpRequest(`https://public-api.etoro.com${path}`, { headers: { ...this.headers, 'x-request-id': randomUUID() } });
    if (r.status === 200) return parseJson('eToro', r.body);
    throw statusError('eToro', r, {
      unauthorized: 'cheile nu sunt valide sau sunt pentru alt mediu (Real / Demo)',
      forbidden: 'cheia nu are permisiunea „Read” pentru acest mediu (sau IP-ul nu e în listă)',
    });
  }

  private pnlPath(): string {
    return `/api/v1/trading/info/${this.env}/pnl`;
  }

  async test(): Promise<void> {
    await this.get(this.pnlPath());
  }

  /** Symbols for the instrument ids, in batches of 100; ids that cannot be resolved keep their number. */
  private async instruments(ids: number[]): Promise<Map<number, EtoroInstrument>> {
    const now = this.now();
    const missing = [...new Set(ids)].filter((id) => {
      const c = etoroInstruments.get(id);
      return !c || now - c.at > ETORO_META_TTL;
    });
    for (let i = 0; i < missing.length; i += 100) {
      const batch = missing.slice(i, i + 100);
      try {
        const q = batch.map((id) => `instrumentsIds=${id}`).join('&');
        const resp = obj(await this.get(`/api/v2/market-data/instruments?${q}&pageSize=100`)) ?? {};
        for (const r of arr(resp.results)) {
          const id = num(pick(r, 'instrumentId', 'instrumentID'));
          const symbol = str(r.symbol);
          if (id === null || !symbol) continue;
          etoroInstruments.set(id, { info: { symbol: symbol.toUpperCase(), name: str(r.displayName) ?? symbol, type: str(r.type) ?? '' }, at: now });
        }
      } catch {
        // Unresolved ids are shown by number; the portfolio itself still loads.
      }
    }
    const out = new Map<number, EtoroInstrument>();
    for (const id of ids) {
      const c = etoroInstruments.get(id);
      out.set(id, c?.info ?? { symbol: `#${id}`, name: `Instrument ${id}`, type: '' });
    }
    return out;
  }

  async load(): Promise<BrokerSnapshot> {
    const errors: BrokerSnapshot['errors'] = {};
    const root = obj(await this.get(this.pnlPath())) ?? {};
    const pf = obj(root.clientPortfolio) ?? root;
    const own = arr(pf.positions).map((p) => ({ p, copiedFrom: null as string | null }));
    const copied = arr(pf.mirrors).flatMap((m) => arr(m.positions).map((p) => ({ p, copiedFrom: str(m.parentUsername) })));
    const all = [...own, ...copied];
    const entry = [...arr(pf.orders), ...arr(pf.entryOrders), ...arr(pf.stockOrders)];
    const ids = [...all.map(({ p }) => num(pick(p, 'instrumentID', 'instrumentId'))), ...entry.map((o) => num(pick(o, 'instrumentID', 'instrumentId')))].filter((x): x is number => x !== null);
    const meta = await this.instruments(ids);

    // Unleveraged buys are holdings (summed per instrument); leveraged or short ones are positions.
    const holdings = new Map<string, { units: number; cost: number; pnl: number; value: number; avgSum: number; price: number | null; name: string; crypto: boolean; notes: Set<string>; ids: string[]; instrumentId: number | null }>();
    const positions: PositionRow[] = [];
    const orders: OrderRow[] = [];
    for (const { p, copiedFrom } of all) {
      const id = num(pick(p, 'instrumentID', 'instrumentId'));
      const info = id !== null ? (meta.get(id) as EtoroInstrument) : { symbol: '?', name: '?', type: '' };
      const units = num(p.units) ?? 0;
      const openRate = num(p.openRate);
      const lev = num(p.leverage) ?? 1;
      const isBuy = p.isBuy !== false;
      const u = obj(p.unrealizedPnL) ?? {};
      const pnl = num(pick(u, 'pnL', 'pnl')) ?? num(p.netProfit);
      const close = num(u.closeRate) ?? num(p.currentRate);
      const posId = str(pick(p, 'positionID', 'positionId')) ?? randomUUID();
      const holding = lev === 1 && isBuy;
      const symbol = `${info.symbol}/USD`;
      if (holding) {
        const h = holdings.get(info.symbol) ?? { units: 0, cost: 0, pnl: 0, value: 0, avgSum: 0, price: close, name: info.name, crypto: /crypto/i.test(info.type), notes: new Set<string>(), ids: [], instrumentId: id };
        // FD-TRADING: a holding is closed position by position (copied ones belong to the copy, not to the user).
        if (!copiedFrom) h.ids.push(posId);
        // `amount` (invested) and the PnL are in USD; rates are in the instrument's currency (EUR for a German share).
        const invested = num(p.amount);
        h.units += units;
        h.avgSum += (openRate ?? 0) * units;
        h.cost += invested ?? (openRate ?? 0) * units;
        h.pnl += pnl ?? 0;
        h.value += invested !== null && pnl !== null ? invested + pnl : close !== null ? close * units : 0;
        h.price = close ?? h.price;
        if (copiedFrom) h.notes.add(`copiat de la ${copiedFrom}`);
        holdings.set(info.symbol, h);
      } else {
        positions.push({
          symbol,
          side: isBuy ? 'long' : 'short',
          contracts: units,
          size: units,
          entryPrice: openRate,
          markPrice: close,
          unrealizedPnl: pnl,
          percentage: pct(pnl, num(p.amount)),
          liquidationPrice: null,
          leverage: lev,
          marginMode: copiedFrom ? `copiat de la ${copiedFrom}` : null,
          notional: close !== null ? close * units : null,
          ...(copiedFrom || id === null ? {} : { ref: { positionIds: [posId], instrumentId: id } }),
        });
      }
      // The position's stop-loss / take-profit become orders, so the chart can show them with their PnL (FD-PNL).
      const market = holding ? 'spot' : 'futures';
      const closing = isBuy ? 'sell' : 'buy';
      const sl = num(p.stopLossRate);
      const tp = num(p.takeProfitRate);
      if (sl !== null && sl > 0 && p.isNoStopLoss !== true) {
        orders.push({ id: `sl-${posId}`, market, symbol, type: 'stop', side: closing, price: null, triggerPrice: sl, amount: units, filled: null, status: 'open', timestamp: null, reduceOnly: true, stop: isBuy ? 'down' : 'up', cancellable: false });
      }
      if (tp !== null && tp > 0 && p.isNoTakeProfit !== true) {
        orders.push({ id: `tp-${posId}`, market, symbol, type: 'limit', side: closing, price: tp, triggerPrice: null, amount: units, filled: null, status: 'open', timestamp: null, reduceOnly: true, stop: null, cancellable: false });
      }
    }
    for (const o of entry) {
      const id = num(pick(o, 'instrumentID', 'instrumentId'));
      const info = id !== null ? (meta.get(id) as EtoroInstrument) : { symbol: '?', name: '?', type: '' };
      orders.push({
        id: str(pick(o, 'orderID', 'orderId')) ?? randomUUID(),
        market: (num(o.leverage) ?? 1) > 1 ? 'futures' : 'spot',
        symbol: `${info.symbol}/USD`,
        type: 'limit',
        side: o.isBuy === false ? 'sell' : 'buy',
        price: num(pick(o, 'rate', 'openRate')),
        triggerPrice: null,
        amount: num(o.units) ?? num(o.amount),
        filled: null,
        status: 'open',
        timestamp: Date.parse(String(pick(o, 'openDateTime', 'occurred') ?? '')) || null,
        reduceOnly: false,
        stop: null,
      });
    }
    const balances: BalanceRow[] = [...holdings.entries()].map(([sym, h]) => ({
      asset: sym,
      account: 'etoro',
      total: h.units,
      free: h.units,
      used: 0,
      price: h.price,
      value: h.value || null,
      avgPrice: h.units > 0 ? h.avgSum / h.units : null,
      avgSource: 'broker',
      pnl: h.pnl,
      pnlPct: pct(h.pnl, h.cost),
      currency: 'USD',
      priceCurrency: 'USD',
      name: h.name,
      note: h.notes.size ? [...h.notes].join(', ') : undefined,
      ...(h.crypto ? { crypto: true } : {}),
      ...(h.ids.length && h.instrumentId !== null ? { ref: { positionIds: h.ids, instrumentId: h.instrumentId } } : {}),
    }));
    return { currency: 'USD', balances, positions, orders, fills: [], cash: num(pf.credit), errors };
  }

  /**
   * FD-BROKERSTATS: the positions closed since `from` (a partial close is one of them), each with eToro's `netProfit`
   * in USD. Pages are numbered from 1, as everywhere in eToro's API; the order of the rows is not documented.
   */
  async closedTrades(from: number): Promise<ClosedTrades> {
    const path = this.env === 'demo' ? '/api/v1/trading/info/trade/demo/history' : '/api/v1/trading/info/trade/history';
    // A date without a zone: a day earlier, so the period's first hours are surely in; the rows are filtered below.
    const minDate = new Date(from - DAY_MS).toISOString().slice(0, 10);
    const byId = new Map<string, ClosedTrade>();
    const seen = new Set<string>();
    const times: number[] = [];
    let capped = false;
    for (let page = 1; ; page++) {
      if (page > ETORO_HISTORY_PAGES) {
        capped = true;
        break;
      }
      const body = await this.get(`${path}?minDate=${minDate}&page=${page}&pageSize=${ETORO_PAGE_SIZE}`);
      const rows = Array.isArray(body) ? arr(body) : arr(pick(obj(body), 'trades', 'items', 'results', 'data'));
      let fresh = 0;
      for (const r of rows) {
        const id = str(pick(r, 'positionId', 'positionID'));
        const closedAt = utcTime(pick(r, 'closeTimestamp', 'closeDateTime'));
        if (!id || closedAt === null || seen.has(id)) continue;
        seen.add(id);
        fresh++;
        times.push(closedAt);
        if (closedAt < from) continue;
        const pnl = num(r.netProfit);
        byId.set(id, { id, closedAt, pnl, net: pnl });
      }
      // The end of the history; or a page that repeats the last one (a full page repeated: the paging is not followed).
      if (rows.length === 0) break;
      if (fresh === 0) {
        capped = rows.length >= ETORO_PAGE_SIZE;
        break;
      }
    }
    // Cut short: complete back to the oldest row only if the rows come newest first.
    const newestFirst = times.every((t, i) => i === 0 || t <= (times[i - 1] as number));
    const coveredFrom = !capped ? from : newestFirst && times.length ? (times[times.length - 1] as number) : Number.POSITIVE_INFINITY;
    return { currency: 'USD', trades: [...byId.values()], coveredFrom, asOf: null };
  }
}

// ---------------------------------------------------------------- Interactive Brokers (Flex Web Service)

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodeXml = (s: string) => s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e: string) => (e[0] === '#' ? String.fromCodePoint(e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (XML_ENTITIES[e.toLowerCase()] ?? _)));

/** The attributes of every `<tag …>` element (Flex reports put all their data in attributes). */
export function xmlElements(xml: string, tag: string): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  const re = new RegExp(`<${tag}(\\s[^>]*?)?\\/?>`, 'g');
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const attrs: Record<string, string> = {};
    const ar = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    for (let a = ar.exec(m[1] ?? ''); a; a = ar.exec(m[1] ?? '')) attrs[a[1] as string] = decodeXml(a[2] ?? a[3] ?? '');
    out.push(attrs);
  }
  return out;
}

const xmlText = (xml: string, tag: string): string | null => {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml);
  return m ? decodeXml((m[1] ?? '').trim()) : null;
};

/** Flex Web Service error codes (IBKR documentation) → our codes and a plain sentence. */
function flexError(code: string, message: string): BrokerError {
  const c = Number(code);
  if (c === 1012) return new BrokerError('AUTH', 'Interactive Brokers: tokenul Flex a expirat. Generează unul nou (cu expirare cât mai lungă) la Flex Web Service Configuration.');
  if (c === 1015) return new BrokerError('AUTH', 'Interactive Brokers: tokenul Flex nu e valid.');
  if (c === 1013) return new BrokerError('PERMISSION', 'Interactive Brokers: tokenul e restricționat la alt IP.');
  if (c === 1014) return new BrokerError('EXCHANGE', 'Interactive Brokers: Flex Query ID-ul nu e valid.');
  if (c === 1018) return new BrokerError('RATE_LIMIT', 'Interactive Brokers: prea multe cereri Flex (maximum 10 pe minut).');
  if (c === 1009 || c === 1021) return new BrokerError('MAINTENANCE', `Interactive Brokers: ${message || 'serviciul Flex e ocupat'}`);
  // 1001, 1003–1008: the report (or its P/L data) is not ready yet.
  if (c === 1001 || (c >= 1003 && c <= 1008)) return new BrokerError('MAINTENANCE', `Interactive Brokers: raportul Flex nu e gata încă (${message || `cod ${code}`}); se reîncearcă la următoarea citire.`);
  return new BrokerError('EXCHANGE', `Interactive Brokers (cod ${code}): ${message}`);
}

/** Flex dates: `20261012` or `20261012;153045` (US Eastern time, as IBKR writes them). */
export function flexDate(s: string | undefined): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:[;,\s]?(\d{2}):?(\d{2}):?(\d{2}))?/.exec(s ?? '');
  if (!m) return null;
  const [, y, mo, d, h = '0', mi = '0', se = '0'] = m;
  // Eastern time: UTC−4 in summer, UTC−5 in winter (US DST: 2nd Sunday of March to 1st Sunday of November).
  const guess = Date.UTC(+y!, +mo! - 1, +d!, +h, +mi, +se);
  const year = +y!;
  const dstStart = nthSunday(year, 2, 2) + 7 * 3_600_000; // 02:00 EST = 07:00 UTC
  const dstEnd = nthSunday(year, 10, 1) + 6 * 3_600_000; // 02:00 EDT = 06:00 UTC
  const offsetH = guess + 5 * 3_600_000 >= dstStart && guess + 4 * 3_600_000 < dstEnd ? 4 : 5;
  return guess + offsetH * 3_600_000;
}

function nthSunday(year: number, month: number, n: number): number {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const day = 1 + ((7 - first) % 7) + (n - 1) * 7;
  return Date.UTC(year, month, day);
}

const FLEX_BASE = 'https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService';
const FLEX_CACHE_MS = 15 * 60_000;
const flexCache = new Map<string, { xml: string; at: number }>();
/** One report at a time per token, a little over a second apart (IBKR: one request a second, ten a minute). */
const flexChains = new Map<string, Promise<void>>();
const FLEX_GAP_MS = 1_100;
const ET = 'America/New_York';

/** The weekday (Monday to Friday) before `day` (YYYY-MM-DD). */
function previousWeekday(day: string): string {
  let d = addDays(day, -1);
  while ([0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())) d = addDays(d, -1);
  return d;
}

class Ibkr implements BrokerAdapter {
  private readonly token: string;
  private readonly queryId: string;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  constructor(creds: Record<string, string>, _env: string, opts: BrokerOptions) {
    this.token = creds.token ?? '';
    this.queryId = creds.queryId ?? '';
    this.sleep = opts.sleep ?? defaultSleep;
    this.now = opts.now ?? Date.now;
  }

  private async getXml(url: string): Promise<string> {
    const r = await httpRequest(url, { headers: { Accept: 'application/xml, text/xml' }, timeoutMs: 60_000 });
    if (r.status !== 200) throw statusError('Interactive Brokers', r);
    return r.body;
  }

  /** Runs `fn` after the token's previous report, with a gap after it. */
  private queued<T>(fn: () => Promise<T>): Promise<T> {
    const prev = flexChains.get(this.token) ?? Promise.resolve();
    const run = prev.then(fn);
    const tail = run.then(
      () => this.sleep(FLEX_GAP_MS),
      () => this.sleep(FLEX_GAP_MS),
    );
    flexChains.set(this.token, tail);
    void tail.then(() => {
      if (flexChains.get(this.token) === tail) flexChains.delete(this.token);
    });
    return run;
  }

  /**
   * SendRequest, then GetStatement until the report is ready (IBKR: 1 request / s, 10 / min). `range` (yyyymmdd)
   * overrides the query's period (FD-BROKERSTATS: IBKR allows up to 365 days).
   */
  private async statement(force = false, range?: { fd: string; td: string }): Promise<string> {
    const key = `${this.token}|${this.queryId}${range ? `|${range.fd}|${range.td}` : ''}`;
    const fresh = (): string | null => {
      const cached = flexCache.get(key);
      return !force && cached && this.now() - cached.at < FLEX_CACHE_MS ? cached.xml : null;
    };
    const ready = fresh();
    if (ready !== null) return ready;
    // Waiting for another report of the same token may have brought this one.
    return this.queued(async () => fresh() ?? this.generate(key, range));
  }

  private async generate(key: string, range?: { fd: string; td: string }): Promise<string> {
    const period = range ? `&fd=${range.fd}&td=${range.td}` : '';
    const sent = await this.getXml(`${FLEX_BASE}/SendRequest?t=${encodeURIComponent(this.token)}&q=${encodeURIComponent(this.queryId)}&v=3${period}`);
    if (xmlText(sent, 'Status') !== 'Success') throw flexError(xmlText(sent, 'ErrorCode') ?? '?', xmlText(sent, 'ErrorMessage') ?? sent.slice(0, 200));
    const ref = xmlText(sent, 'ReferenceCode');
    const url = xmlText(sent, 'Url') ?? `${FLEX_BASE}/GetStatement`;
    if (!ref || !/^https:\/\/[\w.-]+\.interactivebrokers\.com\//.test(url)) throw new BrokerError('EXCHANGE', 'Interactive Brokers: răspuns neașteptat la SendRequest');
    for (let i = 0; i < 20; i++) {
      await this.sleep(i === 0 ? 1_500 : 2_000);
      const xml = await this.getXml(`${url}?t=${encodeURIComponent(this.token)}&q=${encodeURIComponent(ref)}&v=3`);
      const code = xmlText(xml, 'ErrorCode');
      if (code === '1019' || /Statement generation in progress/i.test(xml.slice(0, 500))) continue;
      if (code) throw flexError(code, xmlText(xml, 'ErrorMessage') ?? '');
      if (!/<FlexQueryResponse|<FlexStatement/.test(xml)) throw new BrokerError('EXCHANGE', 'Interactive Brokers: raportul nu are formatul XML așteptat (alege XML la Flex Query)');
      // The stats' reports change key every day: the expired ones go, so they do not pile up in memory.
      for (const [k, v] of flexCache) if (this.now() - v.at >= FLEX_CACHE_MS) flexCache.delete(k);
      flexCache.set(key, { xml, at: this.now() });
      return xml;
    }
    throw new BrokerError('MAINTENANCE', 'Interactive Brokers: raportul Flex nu a fost gata în 40 s; se reîncearcă la următoarea reîmprospătare');
  }

  async test(): Promise<void> {
    const xml = await this.statement(true);
    if (!/<OpenPositions/.test(xml)) throw new BrokerError('EXCHANGE', 'Interactive Brokers: Flex Query-ul nu conține secțiunea „Open Positions”. Bifeaz-o (plus Trades și Cash Report) în configurarea query-ului.');
  }

  async load(): Promise<BrokerSnapshot> {
    const errors: BrokerSnapshot['errors'] = {};
    const xml = await this.statement();
    const stmt = xmlElements(xml, 'FlexStatement')[0] ?? {};
    const toDate = flexDate(stmt.toDate);
    const asOf = toDate !== null ? toDate + 16 * 3_600_000 : undefined; // the close of that day
    const info = xmlElements(xml, 'AccountInformation')[0] ?? {};
    const base = info.currency || 'USD';
    if (!/<OpenPositions/.test(xml)) errors.balances = { code: 'EXCHANGE', message: 'Flex Query-ul nu conține secțiunea „Open Positions”.' };
    const balances: BalanceRow[] = [];
    const positions: PositionRow[] = [];
    for (const p of xmlElements(xml, 'OpenPosition')) {
      if (p.levelOfDetail && p.levelOfDetail !== 'SUMMARY') continue; // LOT rows repeat the summary
      const qty = num(p.position) ?? 0;
      if (qty === 0) continue;
      const cat = p.assetCategory ?? '';
      const mark = num(p.markPrice);
      const cost = num(p.costBasisPrice);
      const pnl = num(p.fifoPnlUnrealized);
      const ccy = p.currency || base;
      if ((cat === 'STK' || cat === 'ETF' || cat === 'FUND' || cat === 'CRYPTO') && qty > 0) {
        balances.push({
          asset: p.symbol ?? '?',
          account: p.accountId ? `IBKR ${p.accountId}` : 'IBKR',
          total: qty,
          free: qty,
          used: 0,
          price: mark,
          value: num(p.positionValue),
          avgPrice: cost,
          avgSource: 'broker',
          pnl,
          pnlPct: pct(pnl, num(p.costBasisMoney)),
          currency: ccy,
          priceCurrency: ccy,
          name: p.description || undefined,
          ...(cat === 'CRYPTO' ? { crypto: true } : {}),
        });
      } else {
        const mult = num(p.multiplier) ?? 1;
        positions.push({
          symbol: `${p.symbol ?? '?'}/${ccy}`,
          side: qty < 0 || p.side === 'Short' ? 'short' : 'long',
          contracts: Math.abs(qty),
          size: Math.abs(qty) * mult,
          entryPrice: cost,
          markPrice: mark,
          unrealizedPnl: pnl,
          percentage: pct(pnl, num(p.costBasisMoney) !== null ? Math.abs(num(p.costBasisMoney) as number) : null),
          liquidationPrice: null,
          leverage: null,
          marginMode: cat || null,
          notional: num(p.positionValue),
        });
      }
    }
    const fills: FillRow[] = xmlElements(xml, 'Trade')
      .filter((t) => !t.levelOfDetail || t.levelOfDetail === 'EXECUTION')
      .map((t): FillRow | null => {
        const price = num(t.tradePrice);
        const qty = num(t.quantity);
        const ts = flexDate(t.dateTime ?? t.tradeDate);
        if (price === null || qty === null || ts === null) return null;
        const fee = num(t.ibCommission);
        return {
          id: t.tradeID || t.transactionID || `${t.symbol}-${ts}`,
          market: t.assetCategory === 'STK' || t.assetCategory === 'ETF' ? 'spot' : 'futures',
          symbol: `${t.symbol ?? '?'}/${t.currency || base}`,
          side: (t.buySell ?? (qty < 0 ? 'SELL' : 'BUY')).toLowerCase().replace(/\s.*$/, ''),
          price,
          amount: Math.abs(qty),
          cost: price * Math.abs(qty),
          fee: fee !== null ? Math.abs(fee) : null,
          feeCurrency: t.ibCommissionCurrency || null,
          timestamp: ts,
        };
      })
      .filter((f): f is FillRow => f !== null);
    const cashRow = xmlElements(xml, 'CashReportCurrency').find((c) => c.currency === 'BASE_SUMMARY');
    return { currency: base, balances, positions, orders: [], fills, cash: num(cashRow?.endingCash), asOf, errors };
  }

  /**
   * FD-BROKERSTATS: the orders that closed (or reduced) a position since `from`, from a report of those days up to the
   * last weekday (an Activity report has only finished days), each with IBKR's realised FIFO P/L (commissions in),
   * in the account's base currency. Kept 15 minutes, as the portfolio's report.
   */
  async closedTrades(from: number): Promise<ClosedTrades> {
    const fd = dayKey(from, ET);
    const td = previousWeekday(dayKey(this.now(), ET));
    // Nothing finished since `from` yet (it is today, or the weekend after it): no report to ask for.
    if (td < fd) return { currency: null, trades: [], coveredFrom: from, asOf: zonedTimeToUtc(td, ET, 16) };
    const xml = await this.statement(false, { fd: fd.replaceAll('-', ''), td: td.replaceAll('-', '') });
    if (!/<Trades[\s>/]/.test(xml)) throw new BrokerError('EXCHANGE', 'Interactive Brokers: Flex Query-ul nu conține secțiunea „Trades”. Bifeaz-o (nivelul „Execution”, toate câmpurile) în configurarea query-ului.');
    const all = xmlElements(xml, 'Trade');
    const execs = all.filter((t) => !t.levelOfDetail || t.levelOfDetail === 'EXECUTION');
    const rows = execs.length ? execs : all.filter((t) => t.levelOfDetail === 'ORDER');
    if (all.length && !rows.length) throw new BrokerError('EXCHANGE', 'Interactive Brokers: secțiunea „Trades” din Flex Query nu are execuțiile. Alege nivelul „Execution” la Trades.');
    if (rows.length && !rows.some((t) => t.fifoPnlRealized !== undefined)) throw new BrokerError('EXCHANGE', 'Interactive Brokers: secțiunea „Trades” din Flex Query nu are câmpul „Realized P/L”. Bifează toate câmpurile („Select All”) la Trades.');
    const base = xmlElements(xml, 'AccountInformation')[0]?.currency || null;
    const byOrder = new Map<string, ClosedTrade>();
    for (const t of rows) {
      // Currency conversions are not positions.
      if (t.assetCategory === 'CASH') continue;
      const pnl = num(t.fifoPnlRealized);
      if (pnl === null) continue;
      const oc = t.openCloseIndicator;
      if (!(oc ? oc.includes('C') : pnl !== 0)) continue;
      const ts = flexDate(t.dateTime || t.tradeDate);
      if (ts === null || ts < from) continue;
      const rate = !t.currency || t.currency === base ? 1 : num(t.fxRateToBase);
      const id = t.ibOrderID || t.orderID || t.tradeID || t.transactionID || `${t.symbol ?? '?'}-${ts}`;
      const prev = byOrder.get(id);
      const net = rate === null ? null : pnl * rate;
      byOrder.set(id, {
        id,
        closedAt: Math.max(prev?.closedAt ?? ts, ts),
        pnl: (prev?.pnl ?? 0) + pnl,
        net: prev && prev.net === null ? null : net === null ? null : (prev?.net ?? 0) + net,
      });
    }
    const toDate = flexDate(xmlElements(xml, 'FlexStatement')[0]?.toDate);
    return { currency: base, trades: [...byOrder.values()], coveredFrom: from, asOf: toDate !== null ? toDate + 16 * 3_600_000 : null };
  }
}

// ---------------------------------------------------------------- Alpaca

/** Fill pages read for the closed-trade stats (100 each, newest first). */
const ALPACA_PAGE_SIZE = 100;
const ALPACA_HISTORY_PAGES = 40;
/** An OCC option symbol (AAPL261120C00300000): one contract is 100 shares. */
const OCC_OPTION = /^[A-Z]{1,6}\d{6}[CP]\d{8}$/;
const QTY_EPS = 1e-9;

export interface FifoExec {
  id: string;
  orderId: string;
  symbol: string;
  side: 'buy' | 'sell';
  /** A sale Alpaca marks as short (`sell_short`): what it sells beyond the shares held is a short, whatever is known. */
  short?: boolean;
  qty: number;
  price: number;
  time: number;
}

/**
 * FD-BROKERSTATS: the realised result of each order that closed (or reduced) a position, first in first out. A sell
 * beyond the shares held opens a short only when the history is complete and the account may short; otherwise its
 * cost is unknown (shares bought before the history read, transferred in, split) and the order's result is null.
 */
export function fifoResults(execs: FifoExec[], opts: { complete: boolean; shorting: boolean }): ClosedTrade[] {
  const sorted = [...execs].sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  // Per symbol, the open lots oldest first: quantity > 0 long, < 0 short (never both).
  const books = new Map<string, { qty: number; price: number }[]>();
  const orders = new Map<string, { closedAt: number; sum: number; unknown: boolean }>();
  for (const e of sorted) {
    const symbol = e.symbol.replace('/', '').toUpperCase();
    const mult = OCC_OPTION.test(symbol) ? 100 : 1;
    const book = books.get(symbol) ?? [];
    books.set(symbol, book);
    const sign = e.side === 'buy' ? 1 : -1;
    let left = e.qty;
    let realised = 0;
    let closed = false;
    while (left > QTY_EPS && book.length > 0 && Math.sign((book[0] as { qty: number }).qty) === -sign) {
      const lot = book[0] as { qty: number; price: number };
      const m = Math.min(left, Math.abs(lot.qty));
      // A sell closes a long (price − cost); a buy closes a short (entry − price).
      realised += (sign === -1 ? e.price - lot.price : lot.price - e.price) * m * mult;
      lot.qty += sign * m;
      left -= m;
      closed = true;
      if (Math.abs(lot.qty) <= QTY_EPS) book.shift();
    }
    let unknown = false;
    if (left > QTY_EPS) {
      if (sign === 1 || e.short || (opts.complete && opts.shorting)) book.push({ qty: sign * left, price: e.price });
      else unknown = true;
    }
    if (!closed && !unknown) continue;
    const prev = orders.get(e.orderId);
    orders.set(e.orderId, { closedAt: e.time, sum: (prev?.sum ?? 0) + realised, unknown: (prev?.unknown ?? false) || unknown });
  }
  return [...orders.entries()].map(([id, o]) => ({ id, closedAt: o.closedAt, pnl: o.unknown ? null : o.sum, net: o.unknown ? null : o.sum }));
}

class Alpaca implements BrokerAdapter {
  private readonly base: string;
  private readonly headers: Record<string, string>;
  private readonly now: () => number;
  constructor(creds: Record<string, string>, env: string, opts: BrokerOptions) {
    this.base = env === 'paper' ? 'https://paper-api.alpaca.markets' : 'https://api.alpaca.markets';
    this.headers = { 'APCA-API-KEY-ID': creds.keyId ?? '', 'APCA-API-SECRET-KEY': creds.secret ?? '', Accept: 'application/json' };
    this.now = opts.now ?? Date.now;
  }

  private async get(path: string): Promise<unknown> {
    const r = await httpRequest(`${this.base}${path}`, { headers: this.headers });
    if (r.status === 200) return parseJson('Alpaca', r.body);
    throw statusError('Alpaca', r, { unauthorized: 'cheia nu e validă pentru mediul ales (cheile Paper merg doar cu Paper, cele Live doar cu Live)', forbidden: 'cheia nu are acces la acest cont' });
  }

  async test(): Promise<void> {
    await this.get('/v2/account');
  }

  async load(): Promise<BrokerSnapshot> {
    const errors: BrokerSnapshot['errors'] = {};
    const account = obj(await this.get('/v2/account')) ?? {};
    const currency = str(account.currency) ?? 'USD';
    const balances: BalanceRow[] = [];
    const positions: PositionRow[] = [];
    await section(errors, 'balances', async () => {
      for (const p of arr(await this.get('/v2/positions'))) {
        const qty = num(p.qty) ?? 0;
        // Alpaca writes its coins as BTCUSD (positions) or BTC/USD (orders): the coin is what is held.
        const crypto = str(p.asset_class) === 'crypto';
        const sym = crypto ? (str(p.symbol) ?? '?').replace(/\/?(USDT|USDC|USD)$/, '') : (str(p.symbol) ?? '?');
        const price = num(p.current_price);
        const avg = num(p.avg_entry_price);
        const pnl = num(p.unrealized_pl);
        if (str(p.side) !== 'short' && qty > 0) {
          balances.push({ asset: sym, account: 'alpaca', total: qty, free: num(p.qty_available) ?? qty, used: 0, price, value: num(p.market_value), avgPrice: avg, avgSource: 'broker', pnl, pnlPct: pct(pnl, num(p.cost_basis)), currency, priceCurrency: currency, ...(crypto ? { crypto: true } : {}) });
        } else {
          positions.push({ symbol: `${sym}/${currency}`, side: 'short', contracts: Math.abs(qty), size: Math.abs(qty), entryPrice: avg, markPrice: price, unrealizedPnl: pnl, percentage: pct(pnl, num(p.cost_basis) !== null ? Math.abs(num(p.cost_basis) as number) : null), liquidationPrice: null, leverage: null, marginMode: null, notional: num(p.market_value) });
        }
      }
    }, undefined);
    const shortSyms = new Set(positions.map((p) => p.symbol));
    const orders = await section(errors, 'orders', async () => {
      const out: OrderRow[] = [];
      const add = (o: Record<string, unknown>) => {
        const sym = str(o.symbol) ?? '?';
        const side = (str(o.side) ?? 'buy').toLowerCase();
        const type = (str(o.type) ?? '').toLowerCase();
        const stop = num(o.stop_price);
        const symbol = `${sym}/${currency}`;
        out.push({
          id: str(o.id) ?? randomUUID(),
          // Orders that close a short belong with the short position (futures-like row), the rest with holdings.
          market: shortSyms.has(symbol) ? 'futures' : 'spot',
          symbol,
          type,
          side,
          price: num(o.limit_price),
          triggerPrice: stop ?? (type === 'trailing_stop' ? num(o.hwm) : null),
          amount: num(o.qty),
          filled: num(o.filled_qty),
          status: str(o.status),
          timestamp: Date.parse(String(o.created_at ?? '')) || null,
          reduceOnly: false,
          stop: stop !== null || type === 'trailing_stop' ? (side === 'sell' ? 'down' : 'up') : null,
        });
        for (const leg of arr(o.legs)) add(leg);
      };
      for (const o of arr(await this.get('/v2/orders?status=open&nested=true&limit=200'))) add(o);
      return out;
    }, []);
    const fills = await section(errors, 'fills', async () => {
      const after = new Date(this.now() - FILLS_WINDOW_MS).toISOString();
      return arr(await this.get(`/v2/account/activities/FILL?after=${encodeURIComponent(after)}&page_size=100&direction=desc`))
        .map((a): FillRow | null => {
          const price = num(a.price);
          const qty = num(a.qty);
          const ts = Date.parse(String(a.transaction_time ?? ''));
          if (price === null || qty === null || !Number.isFinite(ts)) return null;
          return { id: str(a.id) ?? `${str(a.order_id)}-${ts}`, market: 'spot', symbol: `${str(a.symbol) ?? '?'}/${currency}`, side: (str(a.side) ?? 'buy').toLowerCase(), price, amount: Math.abs(qty), cost: price * Math.abs(qty), fee: null, feeCurrency: null, timestamp: ts };
        })
        .filter((f): f is FillRow => f !== null);
    }, []);
    return { currency, balances, positions, orders, fills, cash: num(account.cash), errors };
  }

  /**
   * FD-BROKERSTATS: Alpaca gives no realised result, so it is computed (FIFO) from the account's fills, read newest
   * first up to 4 000; the orders that closed something since `from`, in the account's currency.
   */
  async closedTrades(from: number): Promise<ClosedTrades> {
    const account = obj(await this.get('/v2/account')) ?? {};
    const execs: FifoExec[] = [];
    let token: string | null = null;
    let complete = false;
    for (let page = 0; page < ALPACA_HISTORY_PAGES; page++) {
      const rows = arr(await this.get(`/v2/account/activities/FILL?direction=desc&page_size=${ALPACA_PAGE_SIZE}${token ? `&page_token=${encodeURIComponent(token)}` : ''}`));
      for (const a of rows) {
        const price = num(a.price);
        const qty = num(a.qty);
        const time = utcTime(a.transaction_time);
        // `buy`, `sell` or `sell_short`.
        const side = (str(a.side) ?? '').toLowerCase();
        if (price === null || qty === null || time === null || (side !== 'buy' && !side.startsWith('sell'))) continue;
        execs.push({ id: str(a.id) ?? `${time}`, orderId: str(a.order_id) ?? str(a.id) ?? `${time}`, symbol: str(a.symbol) ?? '?', side: side === 'buy' ? 'buy' : 'sell', short: side === 'sell_short', qty: Math.abs(qty), price, time });
      }
      if (rows.length < ALPACA_PAGE_SIZE) {
        complete = true;
        break;
      }
      // The next page starts after the last activity's id; without one there is no next page to ask for.
      const last = str(rows[rows.length - 1]?.id);
      if (!last || last === token) break;
      token = last;
    }
    const oldest = execs.reduce((m, e) => Math.min(m, e.time), Number.POSITIVE_INFINITY);
    const trades = fifoResults(execs, { complete, shorting: account.shorting_enabled === true }).filter((t) => t.closedAt >= from);
    return { currency: str(account.currency) ?? 'USD', trades, coveredFrom: complete ? 0 : oldest, asOf: null };
  }
}

export function brokerAdapter(id: BrokerId, creds: Record<string, string>, env: string, opts: BrokerOptions = {}): BrokerAdapter {
  switch (id) {
    case 'trading212':
      return new Trading212(creds, env, opts);
    case 'etoro':
      return new Etoro(creds, env, opts);
    case 'ibkr':
      return new Ibkr(creds, env, opts);
    case 'alpaca':
      return new Alpaca(creds, env, opts);
  }
}

/** Test hook: how much the shared caches hold. */
export const brokerCacheSizes = () => ({ flex: flexCache.size, instruments: etoroInstruments.size });

/** Test hook: forget the shared caches. */
export function resetBrokerCaches(): void {
  etoroInstruments.clear();
  flexCache.clear();
  flexChains.clear();
}
