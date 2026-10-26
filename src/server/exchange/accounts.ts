// Exchange accounts (keys encrypted at rest) and portfolio snapshots (FD §6, TD §10).
// This module only READS from exchanges: orders are sent only by exchange/trading/ (FD-TRADING), on accounts where
// trading was switched on, and nothing anywhere moves funds.
import ccxt, { type Exchange } from 'ccxt';
import { accountSchemaFor, providerById, type ProviderDef } from '../../shared/providers.ts';
import type { Db } from '../db/database.ts';
import type { Logger } from '../log.ts';
import { HttpError } from '../net/http.ts';
import { secretHint, type SecretBox } from '../secrets/crypto.ts';
import { ValidationError } from '../settings.ts';
import { costBasis, STABLES, type FillLike } from './cost-basis.ts';
import { fetchClosedPositions, HISTORY, historyFetch, periodStart, settleCoins, summarizeClosed, summarizeResults, type StatsPeriod } from './trade-stats.ts';
import { isRateLimitError, isTransientError, withRetry } from './retry.ts';
import { BROKER_IDS, BrokerError, brokerAdapter, type BrokerAdapter, type BrokerId, type BrokerOptions, type ClosedTrades } from './brokers.ts';
import { TRADING, type TradeMarket } from '../../shared/trading.ts';
import { tradeRights } from './trading/rights.ts';

/** Exchanges read through ccxt (the rest are the stock brokers in brokers.ts). */
export const CCXT_PROVIDERS = ['kucoin', 'binance', 'bybit', 'okx', 'kraken', 'coinbase', 'bitget'] as const;
const isBroker = (id: string): id is BrokerId => (BROKER_IDS as readonly string[]).includes(id);

export interface AccountView {
  id: number;
  exchange: string;
  /** Crypto exchange or stock broker. */
  kind: 'crypto' | 'stocks';
  /** live / demo / paper (FD-SENTIQ §2). */
  env: string;
  label: string;
  keyHint: string;
  createdAt: number;
  lastOkAt: number | null;
  lastError: string | null;
  permissions: string | null;
  /** The key may do more than read (trade, move funds). */
  permissionWarning: boolean;
  /** FD-TRADING: the key may withdraw or transfer funds (such a key never trades through Sentiq). */
  fundsRisk: boolean;
  /** FD-TRADING: whether the platform trades through Sentiq, and whether trading is on for this account. */
  trading: { supported: boolean; enabled: boolean; markets: TradeMarket[]; reason: string | null };
}

export type ErrorCode = 'AUTH' | 'PERMISSION' | 'RATE_LIMIT' | 'NETWORK' | 'MAINTENANCE' | 'EXCHANGE';

export function mapExchangeError(err: unknown): { code: ErrorCode; message: string } {
  const message = err instanceof Error ? err.message.slice(0, 300) : String(err);
  if (err instanceof BrokerError) return { code: err.code, message };
  // The brokers' own HTTP layer: no answer, or no connection.
  if (err instanceof HttpError) return { code: 'NETWORK', message };
  if (err instanceof ccxt.AuthenticationError) return { code: 'AUTH', message };
  if (err instanceof ccxt.PermissionDenied || err instanceof ccxt.AccountSuspended) return { code: 'PERMISSION', message };
  if (isRateLimitError(err)) return { code: 'RATE_LIMIT', message };
  if (err instanceof ccxt.OnMaintenance || err instanceof ccxt.ExchangeNotAvailable) return { code: 'MAINTENANCE', message };
  if (err instanceof ccxt.NetworkError || err instanceof ccxt.RequestTimeout) return { code: 'NETWORK', message };
  return { code: 'EXCHANGE', message };
}

export interface BalanceRow {
  asset: string;
  account: string;
  total: number;
  free: number;
  used: number;
  price: number | null;
  value: number | null;
  avgPrice: number | null;
  avgSource: 'fills' | 'manual' | 'broker' | null;
  pnl: number | null;
  pnlPct: number | null;
  /** Currency of `value` / `pnl` (crypto: the quote, e.g. USDT; brokers: the account's). */
  currency?: string;
  /** Currency of `price` / `avgPrice` when it differs (a USD share in a EUR account). */
  priceCurrency?: string;
  /** Company / instrument name (brokers). */
  name?: string;
  /** E.g. "copiat de la <user>" (eToro copy trading). */
  note?: string;
  /** A coin held at a broker (eToro, IBKR, Alpaca): its chart is the crypto one, not a share's. */
  crypto?: boolean;
  /** FD-TRADING: the platform's own handles for selling it (Trading 212's ticker, eToro's positions). */
  ref?: TradeRef;
}

/** The platform's own handles of a holding or position, for trading it (FD-TRADING). */
export interface TradeRef {
  ticker?: string;
  instrumentId?: number;
  positionIds?: string[];
}

export interface PositionRow {
  symbol: string;
  side: string;
  contracts: number;
  size: number | null;
  entryPrice: number | null;
  markPrice: number | null;
  unrealizedPnl: number | null;
  percentage: number | null;
  liquidationPrice: number | null;
  leverage: number | null;
  marginMode: string | null;
  notional: number | null;
  /** FD-TRADING: the platform's own handles for closing it. */
  ref?: TradeRef;
}

export interface OrderRow {
  id: string;
  market: 'spot' | 'futures';
  symbol: string;
  type: string;
  side: string;
  price: number | null;
  triggerPrice: number | null;
  amount: number | null;
  filled: number | null;
  status: string | null;
  timestamp: number | null;
  reduceOnly: boolean;
  /** Direction that triggers a stop order: `down` (KuCoin futures `down`, spot `loss`) or `up` (`up` / `entry`). */
  stop: 'down' | 'up' | null;
  /** FD-TRADING: false for rows that are not orders on the platform (an eToro position's SL / TP). */
  cancellable?: boolean;
  /** FD-KUCOINHEDGE, FD-HEDGEALL: the position a hedge-mode futures order belongs to; null in one-way. */
  positionSide?: 'long' | 'short' | null;
  /**
   * FD-ORDEREDIT: the stop loss / take profit the order carries: an entry's attached ones, or the levels of a TP / SL order
   * that has no trigger of its own (OKX's conditional / oco: both legs in one order). Where the platform gives them.
   */
  stopLoss?: number | null;
  takeProfit?: number | null;
  /** Futures: coins per contract (the amount is in contracts), for the PnL of an order with no position yet. */
  contractSize?: number | null;
}

/** KuCoin's stop direction from the raw order (futures: down / up; spot: loss / entry). */
export function stopDirection(info: unknown): OrderRow['stop'] {
  const raw = typeof info === 'object' && info !== null ? (info as { stop?: unknown }).stop : undefined;
  const v = typeof raw === 'string' ? raw.toLowerCase() : '';
  return v === 'down' || v === 'loss' ? 'down' : v === 'up' || v === 'entry' ? 'up' : null;
}

/**
 * The hedge-mode side of a position or an order, as each exchange names it (FD-HEDGEALL): `positionSide` LONG / SHORT
 * (KuCoin, Binance; BOTH in one-way), `posSide` long / short (OKX, Bitget; net in one-way), `positionIdx` 1 / 2 (Bybit;
 * 0 in one-way). null for one-way or none.
 */
function hedgeSide(info: unknown): 'long' | 'short' | null {
  if (typeof info !== 'object' || info === null) return null;
  const i = info as { positionSide?: unknown; posSide?: unknown; positionIdx?: unknown };
  const named = (typeof i.positionSide === 'string' ? i.positionSide : typeof i.posSide === 'string' ? i.posSide : '').toUpperCase();
  if (named === 'LONG') return 'long';
  if (named === 'SHORT') return 'short';
  const idx = Number(i.positionIdx);
  return idx === 1 ? 'long' : idx === 2 ? 'short' : null;
}

/** A position's side (FD-KUCOINHEDGE): the one the exchange names in hedge mode, otherwise ccxt's (the sign of the size). */
export function positionSideOf(p: { side?: unknown; info?: unknown }): 'long' | 'short' | null {
  return hedgeSide(p.info) ?? (p.side === 'long' || p.side === 'short' ? p.side : null);
}

/** The position a hedge-mode order opens or closes; null in one-way mode. */
export const orderPositionSide = (info: unknown): 'long' | 'short' | null => hedgeSide(info);

export interface FillRow {
  id: string;
  market: 'spot' | 'futures';
  symbol: string;
  side: string;
  price: number;
  amount: number;
  cost: number | null;
  fee: number | null;
  feeCurrency: string | null;
  timestamp: number;
}

export interface Portfolio {
  accountId: number;
  exchange: string;
  kind: 'crypto' | 'stocks';
  /** Currency of the values and totals (USDT for crypto, the account's for brokers). */
  currency: string;
  /** Cash available, when the platform reports it. */
  cash: number | null;
  /** The moment the data describes when it is not live (IBKR Flex: the previous close). */
  asOf: number | null;
  mode: 'unified' | 'classic' | 'unknown';
  balances: BalanceRow[];
  positions: PositionRow[];
  orders: OrderRow[];
  fills: FillRow[];
  /** `futuresAvailable` (FD-TRADESTATS §2): free USDT in the futures account; null without futures (or before reading). */
  totals: { spotValue: number; unrealizedPnl: number; futuresAvailable: number | null };
  errors: Partial<Record<'balances' | 'positions' | 'orders' | 'fills' | 'prices' | 'mode' | 'futures', { code: ErrorCode; message: string }>>;
  /** Sections that failed now and show the last good data instead, with the time of that data. */
  stale: Partial<Record<StaleSection | 'prices', number>>;
  fetchedAt: number;
}

type StaleSection = 'balances' | 'positions' | 'orders' | 'fills';
interface LastGood {
  balances?: { data: BalanceRow[]; at: number };
  positions?: { data: PositionRow[]; at: number };
  orders?: { data: OrderRow[]; at: number };
  fills?: { data: FillRow[]; at: number };
}

export interface ExchangeClients {
  spot: Exchange;
  futures: Exchange | null;
}

/**
 * How the free USDT of the futures account is read (TD-TRADESTATS §1): ccxt params for `fetchBalance`, 'spot' when the
 * account read for the balances already is the one (unified accounts), absent without futures (Kraken, Coinbase).
 */
export const FUTURES_BALANCE: Record<string, Record<string, unknown> | 'spot'> = {
  kucoin: { type: 'contract', code: 'USDT' },
  binance: { type: 'future' },
  bybit: 'spot',
  okx: 'spot',
  bitget: { type: 'swap' },
};

/**
 * FD-TRADING §4: the open orders the plain listing (no symbol, the client's default market) leaves out, so each can be
 * cancelled: futures orders and stop (trigger) orders. ccxt params for `fetchOpenOrders` without a symbol.
 */
const EXTRA_ORDER_READS: Record<string, { params: Record<string, unknown>; limit?: number }[]> = {
  binance: [{ params: { type: 'swap', subType: 'linear' } }, { params: { type: 'swap', subType: 'linear', trigger: true } }],
  // A unified account lists every kind of order (stops included) per category.
  bybit: [{ params: { type: 'swap', subType: 'linear', settleCoin: 'USDT' }, limit: 50 }],
  // The plain listing already has every product's normal orders. FD-ORDEREDIT: a position's TP / SL are algo orders of
  // their own kinds (conditional, oco), not "trigger" ones; both in one read, which ccxt sends to the algo listing only
  // when told (it routes a single kind there by itself, not the pair).
  okx: [{ params: { trigger: true } }, { params: { method: 'privateGetTradeOrdersAlgoPending', ordType: 'conditional,oco' } }],
  bitget: [
    { params: { type: 'spot', trigger: true } },
    { params: { type: 'swap', productType: 'USDT-FUTURES' } },
    { params: { type: 'swap', productType: 'USDT-FUTURES', trigger: true } },
    // FD-ORDEREDIT: the TP / SL orders (a trigger listing reads only "normal_plan" ones).
    { params: { type: 'swap', productType: 'USDT-FUTURES', planType: 'profit_loss' } },
  ],
};

/**
 * The plain listings (open orders, fills) where the client's default market is not spot: Bybit's is linear, which
 * left its spot orders and fills out and brought its futures fills in as spot ones. With the pages it allows, and the
 * futures fills read on their own (`moreFills`).
 */
const SPOT_LISTING: Record<string, { params: Record<string, unknown>; orders: number; fills: number; moreFills?: Record<string, unknown> }> = {
  bybit: { params: { type: 'spot' }, orders: 50, fills: 100, moreFills: { type: 'swap', subType: 'linear' } },
};

/**
 * Binance's -2015 ("Invalid API-key, IP, or permissions for action": here, a key without futures), which ccxt raises
 * as DDoSProtection once a call with the key has succeeded. Not retried.
 */
const binanceDenied = (err: unknown) => err instanceof ccxt.DDoSProtection && /-2015\b/.test(err.message);

/** An extra order read the key or the account cannot do (no futures, the product not opened), or one asked wrongly. */
const skippableOrderRead = (err: unknown) =>
  binanceDenied(err) ||
  err instanceof ccxt.NotSupported ||
  err instanceof ccxt.PermissionDenied ||
  err instanceof ccxt.AuthenticationError ||
  err instanceof ccxt.AccountNotEnabled ||
  err instanceof ccxt.ArgumentsRequired ||
  err instanceof ccxt.BadRequest;

/** The results of closed trades (FD-TRADESTATS, FD-BROKERSTATS): the counts for one period of one account. */
export interface TradeStats {
  period: StatsPeriod;
  from: number;
  to: number;
  /** The platform gives a closed-trade history (KuCoin, Bybit, OKX, Bitget; the four brokers). */
  supported: boolean;
  wins: number | null;
  losses: number | null;
  breakeven: number | null;
  successRate: number | null;
  /** In `currency`. */
  net: number | null;
  netPartial: boolean;
  /** Crypto: USD; a broker: the account's currency. */
  currency: string;
  /** IBKR Flex: the data ends at the close of this day (before `from`: the period cannot be counted yet). */
  asOf: number | null;
  /** The history read is shorter than the period (a broker's page limit). */
  limited: boolean;
  /** Closed trades whose result is unknown (not counted). */
  unknownResults: number;
  error: { code: ErrorCode; message: string } | null;
  fetchedAt: number;
}
const STATS_TTL_MS = 5 * 60_000;
/** FD-BROKERSTATS: a broker's history is read once for the longest period and serves all of them. */
const BROKER_HISTORY_MS = 90 * 86_400_000;

// KuCoin accepts at most 7 days per fills query; stay a minute inside the limit.
const FILLS_WINDOW_MS = 7 * 86_400_000 - 60_000;
const PORTFOLIO_TTL_MS = 20_000;
/**
 * FIX-SLTPDUP: after an order, a cancellation or a change, the platform lists the new state a few seconds late; for this
 * long the portfolio is read again at most every SETTLE_TTL_MS, and the orders taken off stay hidden for GONE_MS.
 */
const SETTLE_MS = 30_000;
const SETTLE_TTL_MS = 3_000;
const GONE_MS = 120_000;
const CLIENT_TTL_MS = 10 * 60_000;
/** Connected accounts per user (each one is read over the network). */
export const MAX_ACCOUNTS_PER_USER = 20;
// The full ticker list is the heaviest public call (KuCoin weight 15, ~1 000 pairs): shared by all accounts for 15 s.
const TICKERS_TTL_MS = 15_000;
// When the list is refused, older prices are still better than none, up to this age (marked stale in the UI).
const TICKERS_STALE_MAX_MS = 3_600_000;
// Held assets priced one by one (light calls) when the full list is refused.
const SINGLE_PRICES_MAX = 30;
// After the list was refused (even after retries), leave that endpoint alone for a minute.
const TICKERS_COOLDOWN_MS = 60_000;

interface PriceSnapshot {
  prices: Map<string, number>;
  at: number;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
/** The free USDT of a balance (0 when the account has none). */
const usdtFree = (bal: object): number => num((((bal as { free?: unknown }).free ?? {}) as Record<string, unknown>).USDT) ?? 0;

interface AccountRow {
  id: number;
  exchange: string;
  label: string;
  api_key: string;
  secret: string;
  password: string | null;
  /** Encrypted JSON of the provider's fields (accounts added since FD-SENTIQ); NULL for the older KuCoin rows. */
  credentials: string | null;
  env: string;
  key_hint: string;
  created_at: number;
  last_ok_at: number | null;
  last_error: string | null;
  permissions: string | null;
  user_id: number;
  trading_enabled_at: number | null;
  trading_markets: string | null;
}

/** The provider's fields as entered (crypto: apiKey, secret and, where needed, password). */
export type Credentials = Record<string, string>;
export type ClientFactory = (exchange: string, creds: Credentials) => ExchangeClients;
export type BrokerFactory = (id: BrokerId, creds: Credentials, env: string) => BrokerAdapter;

export const defaultClientFactory =
  (proxy?: string): ClientFactory =>
  (exchange, creds) => {
    const base = {
      apiKey: creds.apiKey,
      secret: creds.secret,
      password: creds.password ?? '',
      enableRateLimit: true,
      timeout: 20_000,
      ...(proxy ? { httpsProxy: proxy } : {}),
    };
    if (exchange === 'kucoin') {
      // Market loading would also download the full ticker list (KuCoin's heaviest public call) just for fee rates.
      const opts = { ...base, options: { adjustForTimeDifference: true, fetchMarkets: { fetchTickersFees: false } } };
      return { spot: new ccxt.kucoin(opts), futures: new ccxt.kucoinfutures(opts) };
    }
    if (!(CCXT_PROVIDERS as readonly string[]).includes(exchange)) throw new ValidationError(`Exchange nesuportat: ${exchange}`);
    const Ctor = (ccxt as unknown as Record<string, new (cfg: object) => Exchange>)[exchange];
    if (!Ctor) throw new ValidationError(`Exchange nesuportat: ${exchange}`);
    // Binance refuses (with a warning error) to list open orders without a symbol unless told it is intended.
    const options = { adjustForTimeDifference: true, ...(exchange === 'binance' ? { warnOnFetchOpenOrdersWithoutSymbol: false } : {}) };
    return { spot: new Ctor({ ...base, options }), futures: null };
  };

export const defaultBrokerFactory =
  (opts: BrokerOptions = {}): BrokerFactory =>
  (id, creds, env) =>
    brokerAdapter(id, creds, env, opts);

/** Read-only permission names: KuCoin's „General”, OKX's `read_only`, Bybit / Bitget / Binance read access. */
const READ_PERMISSIONS = new Set(['general', 'read', 'read_only', 'readonly', 'fix-read']);

/** Any permission beyond read access deserves a warning. */
export function hasRiskyPermissions(permissions: string | null): boolean {
  if (!permissions) return false;
  return permissions
    .split(/[,\s]+/)
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean)
    .some((p) => !READ_PERMISSIONS.has(p));
}

type Api = (params?: object) => Promise<unknown>;
const field = (o: unknown, k: string): unknown => (typeof o === 'object' && o !== null ? (o as Record<string, unknown>)[k] : undefined);

/**
 * What an exchange key may do, where the exchange says it (FD-SENTIQ §2): a comma list of permission names, read
 * ones included; null when it cannot be read. Only names we recognise are kept, so an unknown code never warns.
 */
export async function keyPermissions(exchange: string, client: Exchange): Promise<string | null> {
  const call = (name: string): Api | null => {
    const fn = (client as unknown as Record<string, unknown>)[name];
    return typeof fn === 'function' ? (fn as Api).bind(client) : null;
  };
  try {
    if (exchange === 'kucoin') {
      const fn = call('privateGetUserApiKey');
      const perm = fn ? field(field(await fn(), 'data'), 'permission') : null;
      return typeof perm === 'string' ? perm : null;
    }
    if (exchange === 'binance') {
      const fn = call('sapiGetAccountApiRestrictions');
      const r = fn ? await fn() : null;
      if (!r || typeof r !== 'object') return null;
      const flags: [string, string][] = [
        ['enableReading', 'read'],
        ['enableSpotAndMarginTrading', 'spot-trade'],
        ['enableMargin', 'margin'],
        ['enableFutures', 'futures'],
        ['enableVanillaOptions', 'options'],
        ['enablePortfolioMarginTrading', 'portfolio-margin'],
        ['enableWithdrawals', 'withdraw'],
        ['enableInternalTransfer', 'internal-transfer'],
        ['permitsUniversalTransfer', 'universal-transfer'],
        ['enableFixApiTrade', 'fix-trade'],
        ['enableFixReadOnly', 'fix-read'],
      ];
      return flags.filter(([k]) => field(r, k) === true).map(([, v]) => v).join(',') || null;
    }
    if (exchange === 'bybit') {
      const fn = call('privateGetV5UserQueryApi');
      const res = fn ? field(await fn(), 'result') : null;
      if (!res) return null;
      if (Number(field(res, 'readOnly')) === 1) return 'read';
      const perms = field(res, 'permissions');
      const out: string[] = [];
      if (typeof perms === 'object' && perms !== null) {
        for (const [cat, list] of Object.entries(perms as Record<string, unknown>)) if (Array.isArray(list)) for (const p of list) out.push(`${cat}:${String(p)}`);
      }
      return out.join(',') || 'read-write';
    }
    if (exchange === 'okx') {
      const fn = call('privateGetAccountConfig');
      const data = fn ? field(await fn(), 'data') : null;
      const perm = Array.isArray(data) ? field(data[0], 'perm') : null;
      return typeof perm === 'string' && perm ? perm : null;
    }
    if (exchange === 'bitget') {
      const fn = call('privateSpotGetV2SpotAccountInfo');
      const list = fn ? field(field(await fn(), 'data'), 'authorities') : null;
      if (!Array.isArray(list)) return null;
      const known = list.map(String).filter((a) => /^(readonly|read|trade|withdraw|transfer)$/i.test(a));
      return known.join(',') || null;
    }
    if (exchange === 'coinbase') {
      // FD-TRADING: the CDP key's view / trade / transfer flags.
      const fn = call('v3PrivateGetBrokerageKeyPermissions');
      const r = fn ? await fn() : null;
      if (!r || typeof r !== 'object') return null;
      const flags: [string, string][] = [
        ['can_view', 'read'],
        ['can_trade', 'trade'],
        ['can_transfer', 'transfer'],
      ];
      return flags.filter(([k]) => field(r, k) === true).map(([, v]) => v).join(',') || null;
    }
  } catch {
    // Not readable with this key (or the endpoint changed): no warning rather than a wrong one.
  }
  return null;
}

export class AccountsService {
  private readonly clients = new Map<number, { clients: ExchangeClients; at: number }>();
  private readonly brokers = new Map<number, { adapter: BrokerAdapter; at: number }>();
  private readonly portfolios = new Map<number, { data: Portfolio; at: number }>();
  private readonly inflight = new Map<number, Promise<Portfolio>>();
  /** FIX-SLTPDUP: bumped by `invalidate`, so a read started before a trading action never fills the cache after it. */
  private readonly generation = new Map<number, number>();
  /** Until when an account's portfolio is read again every few seconds (its platform catching up with an action). */
  private readonly settling = new Map<number, number>();
  /** Orders taken off the platform (by id, until when they stay hidden), which it may still list for a moment. */
  private readonly gone = new Map<number, Map<string, number>>();
  private readonly stats = new Map<string, { data: TradeStats; at: number }>();
  private readonly statsInflight = new Map<string, Promise<TradeStats>>();
  private readonly brokerHistory = new Map<number, { data: ClosedTrades; at: number }>();
  private readonly brokerHistoryInflight = new Map<number, Promise<ClosedTrades>>();
  /** Last successful data per section, shown (marked stale) when a later refresh of that section fails. */
  private readonly lastGood = new Map<number, LastGood>();
  /** Latest good ticker list per exchange, and the request in flight for it. */
  private readonly snapshots = new Map<string, PriceSnapshot>();
  private readonly snapshotsInflight = new Map<string, Promise<PriceSnapshot>>();
  private readonly snapshotFailures = new Map<string, { at: number; err: unknown }>();
  private readonly db: Db;
  private readonly box: SecretBox;
  private readonly log: Logger;
  private readonly factory: ClientFactory;
  private readonly retryDelaysMs: readonly number[] | undefined;
  /** Extra order reads skipped for a while (FD-TRADING §4): `account|params` → until when. */
  private readonly skippedReads = new Map<string, number>();
  private readonly brokerFactory: BrokerFactory;

  constructor(db: Db, box: SecretBox, log: Logger, factory: ClientFactory, opts: { retryDelaysMs?: readonly number[]; brokerFactory?: BrokerFactory } = {}) {
    this.db = db;
    this.box = box;
    this.log = log;
    this.factory = factory;
    this.retryDelaysMs = opts.retryDelaysMs;
    this.brokerFactory = opts.brokerFactory ?? defaultBrokerFactory();
  }

  /** One exchange read, retried briefly when it is refused for a moment (TD-RATELIMIT). */
  private retry<T>(fn: () => Promise<T>): Promise<T> {
    return withRetry(fn, { delaysMs: this.retryDelaysMs });
  }

  /**
   * A read that needs the client's market list (every unified ccxt call). Without that list ccxt replays the failed
   * load at once, so retrying would only wait.
   */
  private retryOn<T>(ex: Exchange, fn: () => Promise<T>): Promise<T> {
    return ex.markets ? this.retry(fn) : fn();
  }

  /**
   * ccxt keeps a failed market load and replays its error to every later call on that client, so a refused load is
   * requested again here. A load that still fails is left to the reads, which then report it per section.
   */
  private async ensureMarkets(ex: Exchange): Promise<void> {
    if (ex.markets) return;
    await this.retry(() => ex.loadMarkets(true)).catch(() => undefined);
  }

  private toView(r: AccountRow): AccountView {
    const platform = TRADING[r.exchange as keyof typeof TRADING];
    const enabledMarkets = (r.trading_markets ?? '').split(',').filter((m): m is TradeMarket => m === 'spot' || m === 'futures' || m === 'stock');
    return {
      id: r.id,
      exchange: r.exchange,
      kind: providerById(r.exchange)?.kind ?? 'crypto',
      env: r.env ?? 'live',
      label: r.label,
      keyHint: r.key_hint,
      createdAt: r.created_at,
      lastOkAt: r.last_ok_at,
      lastError: r.last_error,
      permissions: r.permissions,
      permissionWarning: hasRiskyPermissions(r.permissions),
      fundsRisk: tradeRights(r.exchange, r.permissions).funds === true,
      trading: {
        supported: platform?.supported === true,
        enabled: r.trading_enabled_at !== null && platform?.supported === true,
        markets: r.trading_enabled_at !== null ? enabledMarkets : [],
        reason: platform?.supported === false ? (platform.reason ?? null) : null,
      },
    };
  }

  /**
   * What the trading service needs about an account (FD-TRADING): its owner, platform, switch, and either the
   * exchange clients (crypto; the same ones the portfolio reads with) or the broker's fields.
   */
  async tradingAccess(id: number): Promise<{
    id: number;
    userId: number;
    exchange: string;
    env: string;
    label: string;
    permissions: string | null;
    enabled: boolean;
    markets: TradeMarket[];
    clients: ExchangeClients | null;
    creds: Credentials | null;
  } | null> {
    const row = await this.row(id);
    if (!row) return null;
    const view = this.toView(row);
    return {
      id,
      userId: row.user_id,
      exchange: row.exchange,
      env: row.env ?? 'live',
      label: row.label,
      permissions: row.permissions,
      enabled: view.trading.enabled,
      markets: view.trading.markets,
      clients: isBroker(row.exchange) ? null : this.clientsFor(id, row),
      creds: isBroker(row.exchange) ? this.credsOf(row) : null,
    };
  }

  /**
   * Reads the key's permissions again (FD-TRADING §1). A read that gives nothing (the platform does not say, or the
   * endpoint failed just now) keeps the list already known: a key known to withdraw never looks unknown.
   */
  async refreshPermissions(id: number): Promise<string | null> {
    const row = await this.row(id);
    if (!row || isBroker(row.exchange)) return null;
    const { spot } = this.clientsFor(id, row);
    const permissions = await keyPermissions(row.exchange, spot);
    if (permissions === null) return row.permissions;
    await this.db.run('UPDATE exchange_accounts SET permissions = ? WHERE id = ?', [permissions, id]);
    return permissions;
  }

  /** Switches trading on (with the markets the key may trade) or off. */
  async setTrading(id: number, markets: TradeMarket[] | null): Promise<AccountView> {
    await this.db.run('UPDATE exchange_accounts SET trading_enabled_at = ?, trading_markets = ? WHERE id = ?', [markets ? Date.now() : null, markets ? markets.join(',') : null, id]);
    return this.toView((await this.row(id)) as AccountRow);
  }

  /**
   * After an order, a cancellation or a close: the next read of the portfolio (and of its closed trades) goes to the
   * platform, a read already on its way does not count, and for the next 30 s it is read again every 3 s (FIX-SLTPDUP).
   */
  invalidate(id: number): void {
    this.portfolios.delete(id);
    this.inflight.delete(id);
    this.generation.set(id, (this.generation.get(id) ?? 0) + 1);
    this.settling.set(id, Date.now() + SETTLE_MS);
    this.forgetStats(id);
  }

  /** Orders the platform confirmed it took off (cancelled, replaced): hidden for 2 minutes even when it still lists them. */
  forgetOrders(id: number, orderIds: readonly string[]): void {
    if (!orderIds.length) return;
    const list = this.gone.get(id) ?? new Map<string, number>();
    for (const o of orderIds) list.set(o, Date.now() + GONE_MS);
    this.gone.set(id, list);
  }

  /** The portfolio without the orders known to be gone. */
  private shown(id: number, p: Portfolio): Portfolio {
    const list = this.gone.get(id);
    if (!list?.size) return p;
    const now = Date.now();
    for (const [o, until] of list) if (until <= now) list.delete(o);
    if (!list.size || !p.orders.some((o) => list.has(o.id))) return p;
    return { ...p, orders: p.orders.filter((o) => !list.has(o.id)) };
  }

  /** Caches a portfolio read, unless a trading action came after the read started. */
  private keep(id: number, gen: number, data: Portfolio): void {
    if ((this.generation.get(id) ?? 0) === gen) this.portfolios.set(id, { data, at: Date.now() });
  }

  private forgetStats(id: number): void {
    this.brokerHistory.delete(id);
    for (const key of this.stats.keys()) if (key.startsWith(`${id}|`)) this.stats.delete(key);
  }

  /** A user's own accounts (FD-USERS §2: nobody sees anybody else's). */
  async list(userId: number): Promise<AccountView[]> {
    return (await this.db.all<AccountRow>('SELECT * FROM exchange_accounts WHERE user_id = ? ORDER BY id', [userId])).map((r) => this.toView(r));
  }

  /** Is account `id` this user's? Every route that names an account asks first (anybody else's is "not found"). */
  async owns(userId: number, id: number): Promise<boolean> {
    return (await this.db.get('SELECT 1 AS x FROM exchange_accounts WHERE id = ? AND user_id = ?', [id, userId])) !== undefined;
  }

  /**
   * Saves an account: `{ exchange, label, env?, credentials: { …provider fields } }` (FD-SENTIQ §2). The older KuCoin
   * shape `{ exchange, label, apiKey, secret, password }` is still accepted.
   */
  async create(userId: number, input: unknown): Promise<AccountView> {
    const raw = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
    const provider: ProviderDef | undefined = typeof raw.exchange === 'string' ? providerById(raw.exchange) : undefined;
    if (!provider) throw new ValidationError(`Platformă necunoscută: ${String(raw.exchange ?? '')}`);
    const body =
      raw.credentials === undefined && (raw.apiKey !== undefined || raw.secret !== undefined)
        ? { ...raw, credentials: { apiKey: raw.apiKey, secret: raw.secret, ...(raw.password !== undefined ? { password: raw.password } : {}) } }
        : raw;
    const r = accountSchemaFor(provider).safeParse(body);
    if (!r.success) {
      if (provider.id === 'kucoin' && r.error.issues.some((i) => i.path.join('.') === 'credentials.password')) throw new ValidationError('KuCoin cere și API Passphrase', r.error.issues);
      throw new ValidationError(`Date de cont invalide: ${r.error.issues.map((i) => i.message).join('; ')}`, r.error.issues);
    }
    const a = r.data;
    const first = provider.fields[0]?.key ?? '';
    // Counted and added in one transaction: two saves at once never pass the limit.
    const id = await this.db.tx(async () => {
      if (((await this.db.get<{ n: number }>('SELECT count(*) AS n FROM exchange_accounts WHERE user_id = ?', [userId]))?.n ?? 0) >= MAX_ACCOUNTS_PER_USER) {
        throw new ValidationError(`Poți conecta cel mult ${MAX_ACCOUNTS_PER_USER} conturi.`);
      }
      return (
        await this.db.run(
          'INSERT INTO exchange_accounts(user_id, exchange, label, api_key, secret, password, credentials, env, key_hint, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [userId, a.exchange, a.label, '', '', null, this.box.encrypt(JSON.stringify(a.credentials)), a.env, secretHint(a.credentials[first] ?? ''), Date.now()],
        )
      ).lastInsertRowid;
    });
    return this.toView((await this.row(id)) as AccountRow);
  }

  /**
   * The wizard's "Conectează" (FD-SENTIQ §2): saves the account, reads it once and keeps it only if that worked.
   * On failure the account is removed and the reason is thrown, so the form can show it and keep what was typed.
   */
  async connect(userId: number, input: unknown): Promise<AccountView> {
    const created = await this.create(userId, input);
    let view: AccountView;
    try {
      view = await this.test(created.id);
    } catch (err) {
      // E.g. a client that cannot even be built from these keys: nothing half-saved stays behind.
      await this.delete(created.id);
      throw err;
    }
    if (view.lastError) {
      await this.delete(created.id);
      throw new ValidationError(view.lastError.replace(/^[A-Z_]+:\s*/, ''));
    }
    return view;
  }

  /** The decrypted fields of an account (the older KuCoin rows keep them in their own columns). */
  private credsOf(row: AccountRow): Credentials {
    if (row.credentials) return JSON.parse(this.box.decrypt(row.credentials)) as Credentials;
    return { apiKey: this.box.decrypt(row.api_key), secret: this.box.decrypt(row.secret), password: row.password ? this.box.decrypt(row.password) : '' };
  }

  private brokerFor(id: number, row: AccountRow & { exchange: BrokerId }): BrokerAdapter {
    const cached = this.brokers.get(id);
    if (cached && Date.now() - cached.at < CLIENT_TTL_MS) return cached.adapter;
    const adapter = this.brokerFactory(row.exchange, this.credsOf(row), row.env ?? 'live');
    this.brokers.set(id, { adapter, at: Date.now() });
    return adapter;
  }

  /** Asks the skipped extra order reads again (the key was tested, maybe with futures now; or the account is gone). */
  private forgetSkippedReads(id: number): void {
    for (const key of this.skippedReads.keys()) if (key.startsWith(`${id}|`)) this.skippedReads.delete(key);
  }

  async delete(id: number): Promise<boolean> {
    this.forgetSkippedReads(id);
    this.clients.delete(id);
    this.brokers.delete(id);
    this.portfolios.delete(id);
    this.forgetStats(id);
    this.lastGood.delete(id);
    return (await this.db.run('DELETE FROM exchange_accounts WHERE id = ?', [id])).changes > 0;
  }

  private row(id: number): Promise<AccountRow | undefined> {
    return this.db.get<AccountRow>('SELECT * FROM exchange_accounts WHERE id = ?', [id]);
  }

  private clientsFor(id: number, row: AccountRow): ExchangeClients {
    const cached = this.clients.get(id);
    if (cached && Date.now() - cached.at < CLIENT_TTL_MS) return cached.clients;
    const clients = this.factory(row.exchange, this.credsOf(row));
    this.clients.set(id, { clients, at: Date.now() });
    return clients;
  }

  /** Verifies the key with a read (balance, account summary or report) and, on KuCoin, reads its permissions. */
  async test(id: number): Promise<AccountView> {
    const row = await this.row(id);
    if (!row) throw new ValidationError(`Contul ${id} nu există`);
    if (isBroker(row.exchange)) {
      try {
        await this.brokerFor(id, row as AccountRow & { exchange: BrokerId }).test();
        await this.db.run('UPDATE exchange_accounts SET last_ok_at = ?, last_error = NULL WHERE id = ?', [Date.now(), id]);
      } catch (err) {
        const e = mapExchangeError(err);
        await this.db.run('UPDATE exchange_accounts SET last_error = ? WHERE id = ?', [`${e.code}: ${e.message}`, id]);
        this.brokers.delete(id);
      }
      return this.toView((await this.row(id)) as AccountRow);
    }
    const { spot } = this.clientsFor(id, row);
    this.forgetSkippedReads(id);
    try {
      await this.ensureMarkets(spot);
      await this.retryOn(spot, () => spot.fetchBalance());
      // A read that gives nothing keeps the list already known (FD-TRADING §1: a key known to withdraw stays known).
      const permissions = (await keyPermissions(row.exchange, spot)) ?? row.permissions;
      await this.db.run('UPDATE exchange_accounts SET last_ok_at = ?, last_error = NULL, permissions = ? WHERE id = ?', [Date.now(), permissions, id]);
      // FD-TRADING §1: a key that may now move funds never trades: its switch goes off.
      if (tradeRights(row.exchange, permissions).funds === true) await this.db.run('UPDATE exchange_accounts SET trading_enabled_at = NULL, trading_markets = NULL WHERE id = ?', [id]);
    } catch (err) {
      const e = mapExchangeError(err);
      const text = e.code === 'RATE_LIMIT' ? 'exchange-ul limitează temporar cererile; încearcă din nou peste un minut' : e.message;
      await this.db.run('UPDATE exchange_accounts SET last_error = ? WHERE id = ?', [`${e.code}: ${text}`, id]);
      this.clients.delete(id);
    }
    return this.toView((await this.row(id)) as AccountRow);
  }

  async setCostBasis(accountId: number, asset: string, avgPrice: number | null): Promise<void> {
    if (!(await this.row(accountId))) throw new ValidationError(`Contul ${accountId} nu există`);
    const a = asset.trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9.-]{0,19}$/.test(a)) throw new ValidationError('Activ invalid');
    if (avgPrice === null) {
      await this.db.run('DELETE FROM cost_basis WHERE account_id = ? AND asset = ?', [accountId, a]);
    } else {
      if (!Number.isFinite(avgPrice) || avgPrice <= 0) throw new ValidationError('Prețul mediu trebuie să fie pozitiv');
      await this.db.run(
        'UPDATE cost_basis SET avg_price = @p, updated_at = @t WHERE account_id = @id AND asset = @a; IF @@ROWCOUNT = 0 INSERT INTO cost_basis(account_id, asset, avg_price, updated_at) VALUES (@id, @a, @p, @t)',
        { id: accountId, a, p: avgPrice, t: Date.now() },
      );
    }
    this.portfolios.delete(accountId);
  }

  async portfolio(id: number, force = false): Promise<Portfolio> {
    const now = Date.now();
    const ttl = (this.settling.get(id) ?? 0) > now ? SETTLE_TTL_MS : PORTFOLIO_TTL_MS;
    const cached = this.portfolios.get(id);
    if (!force && cached && now - cached.at < ttl) return this.shown(id, cached.data);
    const pending = this.inflight.get(id);
    if (pending) return this.shown(id, await pending);
    const p = this.loadPortfolio(id).finally(() => {
      if (this.inflight.get(id) === p) this.inflight.delete(id);
    });
    this.inflight.set(id, p);
    return this.shown(id, await p);
  }

  /** FD-TRADESTATS, FD-BROKERSTATS: closed trades of one period, kept 5 minutes per account and period. */
  async tradeStats(id: number, period: StatsPeriod, tz: string, force = false): Promise<TradeStats> {
    const key = `${id}|${period}|${tz}`;
    const cached = this.stats.get(key);
    if (!force && cached && Date.now() - cached.at < STATS_TTL_MS) return cached.data;
    const pending = this.statsInflight.get(key);
    if (pending) return pending;
    const p = this.loadStats(id, period, tz, force)
      .then((data) => {
        if (!data.error) this.stats.set(key, { data, at: Date.now() });
        return data;
      })
      .finally(() => this.statsInflight.delete(key));
    this.statsInflight.set(key, p);
    return p;
  }

  private async loadStats(id: number, period: StatsPeriod, tz: string, force: boolean): Promise<TradeStats> {
    const row = await this.row(id);
    if (!row) throw new ValidationError(`Contul ${id} nu există`);
    const now = Date.now();
    const from = periodStart(period, now, tz);
    const base = { period, from, to: now, wins: null, losses: null, breakeven: null, successRate: null, net: null, netPartial: false, currency: 'USD', asOf: null, limited: false, unknownResults: 0, error: null, fetchedAt: now };
    if (isBroker(row.exchange)) return this.loadBrokerStats(id, row as AccountRow & { exchange: BrokerId }, base, force);
    if (!HISTORY[row.exchange]) return { ...base, supported: false };
    const { spot } = this.clientsFor(id, row);
    const retry = <T>(fn: () => Promise<T>) => this.retryOn(spot, fn);
    try {
      await this.ensureMarkets(spot);
      const closed = await fetchClosedPositions(row.exchange, historyFetch(spot, retry), from, now);
      // Results settled in a coin (BTC-margined contracts) are turned into dollars at today's price.
      const prices = new Map<string, number | null>();
      for (const coin of settleCoins(closed)) {
        prices.set(coin, await retry(() => spot.fetchTicker(`${coin}/USDT`)).then((t) => num(t.last), () => null));
      }
      return { ...base, supported: true, ...summarizeClosed(closed, (c) => prices.get(c) ?? null) };
    } catch (err) {
      const error = mapExchangeError(err);
      this.log.warn(`trade stats ${id} (${period}): ${error.code}`);
      return { ...base, supported: true, error };
    }
  }

  /**
   * FD-BROKERSTATS: the trades the broker closed in the period, from its history of the last 90 days (read once for
   * all periods, kept 5 minutes; `force` reads it again).
   */
  private async loadBrokerStats(id: number, row: AccountRow & { exchange: BrokerId }, base: Omit<TradeStats, 'supported'>, force: boolean): Promise<TradeStats> {
    const adapter = this.brokerFor(id, row);
    const read = adapter.closedTrades?.bind(adapter);
    if (!read) return { ...base, supported: false };
    try {
      const h = await this.brokerClosed(id, read, base.to, force);
      const currency = h.currency ?? (await this.portfolio(id).then((p) => p.currency, () => null)) ?? base.currency;
      // IBKR before the day's report: nothing of the period can be counted yet.
      if (h.asOf !== null && h.asOf < base.from) return { ...base, supported: true, currency, asOf: h.asOf };
      const inPeriod = h.trades.filter((t) => t.closedAt >= base.from && t.closedAt <= base.to);
      const known = inPeriod.flatMap((t) => (t.pnl === null ? [] : [{ pnl: t.pnl, net: t.net }]));
      return { ...base, supported: true, currency, asOf: h.asOf, limited: base.from < h.coveredFrom, unknownResults: inPeriod.length - known.length, ...summarizeResults(known) };
    } catch (err) {
      const error = mapExchangeError(err);
      this.log.warn(`trade stats ${id} (${base.period}): ${error.code}`);
      return { ...base, supported: true, error };
    }
  }

  /** `now`: the stats' own clock, so a history read for them covers their 90 days exactly. */
  private brokerClosed(id: number, read: (from: number) => Promise<ClosedTrades>, now: number, force: boolean): Promise<ClosedTrades> {
    const cached = this.brokerHistory.get(id);
    if (!force && cached && Date.now() - cached.at < STATS_TTL_MS) return Promise.resolve(cached.data);
    const pending = this.brokerHistoryInflight.get(id);
    if (pending) return pending;
    const p = read(now - BROKER_HISTORY_MS)
      .then((data) => {
        this.brokerHistory.set(id, { data, at: Date.now() });
        return data;
      })
      .finally(() => this.brokerHistoryInflight.delete(id));
    this.brokerHistoryInflight.set(id, p);
    return p;
  }

  private async loadPortfolio(id: number): Promise<Portfolio> {
    const gen = this.generation.get(id) ?? 0;
    const row = await this.row(id);
    if (!row) throw new ValidationError(`Contul ${id} nu există`);
    if (isBroker(row.exchange)) return this.loadBroker(id, row as AccountRow & { exchange: BrokerId }, gen);
    const isKucoin = row.exchange === 'kucoin';
    const { spot, futures } = this.clientsFor(id, row);
    const errors: Portfolio['errors'] = {};
    const since = Date.now() - FILLS_WINDOW_MS;
    const call = async <T>(section: keyof Portfolio['errors'], fn: () => Promise<T>): Promise<T | null> => {
      try {
        return await fn();
      } catch (err) {
        if (!errors[section]) errors[section] = mapExchangeError(err);
        return null;
      }
    };

    // `r` for account calls that need no market list; `rs` / `rf` for unified calls on the spot / futures client.
    const r = <T>(fn: () => Promise<T>) => this.retry(fn);
    const rs = <T>(fn: () => Promise<T>) => this.retryOn(spot, fn);
    await this.ensureMarkets(spot);
    // The heaviest read starts first and runs alongside the account ones; its failure is handled below.
    const snapshotP = this.tickerSnapshot(row.exchange, spot).then(
      (snap) => ({ snap, err: null as unknown }),
      (err: unknown) => ({ snap: null, err }),
    );

    // KuCoin only: unified (UTA) vs classic accounts, and "high-frequency" classic accounts.
    let mode: Portfolio['mode'] = 'unknown';
    const isUta = isKucoin
      ? await call('mode', async () => {
          const fn = (spot as unknown as { isUTAEnabled?: () => Promise<boolean> }).isUTAEnabled;
          return typeof fn === 'function' ? await r(() => fn.call(spot)) : false;
        })
      : null;
    if (isUta !== null) mode = isUta ? 'unified' : 'classic';
    const classic = isKucoin && mode !== 'unified';
    // Classic KuCoin accounts migrated to "high-frequency" trading need a symbol for orders and fills.
    let hf = false;
    if (classic) {
      await call('mode', async () => {
        const fn = (spot as unknown as { loadMigrationStatus?: (force?: boolean) => Promise<void> }).loadMigrationStatus;
        if (typeof fn === 'function') await r(() => fn.call(spot));
        hf = Boolean((spot.options as Record<string, unknown> | undefined)?.hf);
      });
    }

    if (classic && futures) await this.ensureMarkets(futures);
    const rf = <T>(fn: () => Promise<T>) => (futures ? this.retryOn(futures, fn) : fn());

    type OrderIn = { o: Awaited<ReturnType<Exchange['fetchOpenOrders']>>[number]; market: 'spot' | 'futures' };
    type FillIn = { t: Awaited<ReturnType<Exchange['fetchMyTrades']>>[number]; market: 'spot' | 'futures' };
    const futuresHow = FUTURES_BALANCE[row.exchange];
    const [balancesRaw, positionsRaw, triggerOrders, futuresOrders, futuresFills, futuresOwn, extraOrders] = await Promise.all([
      call('balances', async () => {
        if (!isKucoin) return [{ account: 'spot', bal: await rs(() => spot.fetchBalance()) }];
        if (!classic) return [{ account: 'unified', bal: await rs(() => spot.fetchBalance()) }];
        const out: { account: string; bal: Awaited<ReturnType<Exchange['fetchBalance']>> }[] = [];
        out.push({ account: 'trade', bal: await rs(() => spot.fetchBalance({ type: 'trade' })) });
        out.push({ account: 'main', bal: await rs(() => spot.fetchBalance({ type: 'main' })) });
        return out;
      }),
      call('positions', async () => {
        if (spot.has?.fetchPositions === false) return [];
        try {
          return [...(await rs(() => spot.fetchPositions()))];
        } catch (err) {
          // Spot-only accounts on exchanges that also offer derivatives: no positions, not an error.
          if (err instanceof ccxt.NotSupported) return [];
          throw err;
        }
      }),
      call('orders', async () => (isKucoin ? (await rs(() => spot.fetchOpenOrders(undefined, undefined, 200, { trigger: true, hf: false }))).map((o): OrderIn => ({ o, market: 'spot' })) : [])),
      call('orders', async () =>
        classic && futures
          ? [...(await rf(() => futures.fetchOpenOrders())), ...(await rf(() => futures.fetchOpenOrders(undefined, undefined, undefined, { trigger: true })))].map(
              (o): OrderIn => ({ o, market: 'futures' }),
            )
          : [],
      ),
      call('fills', async () => (classic && futures ? (await rf(() => futures.fetchMyTrades(undefined, since, 200))).map((t): FillIn => ({ t, market: 'futures' })) : [])),
      // FD-TRADESTATS §2: the free USDT of the futures account (its own read, unless it is the unified one above).
      futuresHow && futuresHow !== 'spot' ? call('futures', async () => usdtFree(await rs(() => spot.fetchBalance(futuresHow)))) : Promise.resolve(null),
      // FD-TRADING §4: futures and stop orders, each read on its own. One the key or the account cannot do lists
      // nothing there (a read asked wrongly is logged); any other failure marks the orders section, as the plain one.
      call('orders', async () => {
        const out: OrderIn[] = [];
        for (const read of EXTRA_ORDER_READS[row.exchange] ?? []) {
          const key = `${id}|${JSON.stringify(read.params)}`;
          if ((this.skippedReads.get(key) ?? 0) > Date.now()) continue;
          try {
            const list = await withRetry(() => spot.fetchOpenOrders(undefined, undefined, read.limit, { ...read.params }), {
              delaysMs: spot.markets ? this.retryDelaysMs : [],
              retryIf: (e) => isTransientError(e) && !binanceDenied(e),
            });
            for (const o of list) out.push({ o, market: 'spot' });
          } catch (err) {
            if (!skippableOrderRead(err)) throw err;
            // Not asked again for a while: a key without futures for 15 minutes, a read asked wrongly for 6 hours.
            const wrong = err instanceof ccxt.ArgumentsRequired || err instanceof ccxt.BadRequest;
            this.skippedReads.set(key, Date.now() + (wrong ? 6 * 3_600_000 : 15 * 60_000));
            if (wrong) this.log.warn(`orders ${row.exchange} ${JSON.stringify(read.params)}: ${(err as Error).message.slice(0, 200)}`);
          }
        }
        return out;
      }),
    ]);
    const futuresAvailable = futuresHow === 'spot' ? (balancesRaw?.[0] ? usdtFree(balancesRaw[0].bal) : null) : (futuresOwn ?? null);

    // Non-stable assets with a balance, across all accounts (trade + main).
    const held = new Set<string>();
    for (const { bal } of balancesRaw ?? []) {
      for (const [asset, t] of Object.entries((bal.total ?? {}) as unknown as Record<string, number | undefined>)) if ((num(t) ?? 0) > 0 && !STABLES.has(asset)) held.add(asset);
    }

    // The pairs of the held coins and the favourites, for the exchanges (and KuCoin HF accounts) that need a symbol.
    const wanted = new Set(held);
    // The favourites of the account's owner (FD-USERS §2).
    for (const w of await this.db.all<{ coin: string; kind: string }>(
      'SELECT w.coin, w.kind FROM watchlist w JOIN exchange_accounts a ON a.user_id = w.user_id WHERE a.id = ? ORDER BY w.position, w.coin',
      [id],
    )) {
      // Coins only: a share or an index (^SPX) is not a pair on the exchange.
      if (w.kind !== 'stock' && w.kind !== 'index') wanted.add(w.coin);
    }
    const symbols = [...wanted].map((a) => `${a}/USDT`).filter((sym) => Boolean(spot.markets?.[sym])).slice(0, 25);
    const perSymbolOrders = async () => {
      const out: OrderIn[] = [];
      for (const sym of symbols) for (const o of await rs(() => spot.fetchOpenOrders(sym))) out.push({ o, market: 'spot' });
      return out;
    };
    const perSymbolFills = async () => {
      const out: FillIn[] = [];
      for (const sym of symbols) for (const t of await rs(() => spot.fetchMyTrades(sym, since, 100))) out.push({ t, market: 'spot' });
      return out;
    };
    const needsSymbol = (err: unknown) => err instanceof ccxt.ArgumentsRequired;
    let spotOrders: OrderIn[] | null = null;
    let spotFills: FillIn[] | null = null;
    if (hf) {
      spotOrders = await call('orders', perSymbolOrders);
      spotFills = await call('fills', perSymbolFills);
    } else {
      spotOrders = await call('orders', async () => {
        try {
          const plain = SPOT_LISTING[row.exchange];
          return (await rs(() => spot.fetchOpenOrders(undefined, undefined, plain?.orders ?? 200, { ...(plain?.params ?? {}) }))).map((o): OrderIn => ({ o, market: 'spot' }));
        } catch (err) {
          if (needsSymbol(err)) return perSymbolOrders();
          throw err;
        }
      });
      spotFills = await call('fills', async () => {
        try {
          const plain = SPOT_LISTING[row.exchange];
          const list = [...(await rs(() => spot.fetchMyTrades(undefined, since, plain?.fills ?? 200, { ...(plain?.params ?? {}) })))];
          if (plain?.moreFills) list.push(...(await rs(() => spot.fetchMyTrades(undefined, since, plain.fills, { ...plain.moreFills }))));
          return list.map((t): FillIn => ({ t, market: 'spot' }));
        } catch (err) {
          if (needsSymbol(err)) return perSymbolFills();
          throw err;
        }
      });
    }
    const ordersRaw: OrderIn[] = [...(spotOrders ?? []), ...(triggerOrders ?? []), ...(futuresOrders ?? []), ...(extraOrders ?? [])];
    const fillsRaw: FillIn[] = [...(spotFills ?? []), ...(futuresFills ?? [])];

    // Prices: the shared ticker list; when it is refused, held assets one by one, then the last good list.
    // Kraken and Coinbase list many coins only against USD (FD-SENTIQ): ≈ USDT for the values.
    const QUOTES = ['USDT', 'USDC', 'USD'];
    const { snap, err: pricesErr } = await snapshotP;
    let lookup: (symbol: string) => number | undefined;
    let pricesStaleAt: number | null = null;
    if (snap) {
      lookup = (symbol) => snap.prices.get(symbol);
    } else {
      // Without the market list nothing can be asked one by one, and every held asset may have a pair.
      const pairOf = (asset: string): string | null => QUOTES.map((q) => `${asset}/${q}`).find((symbol) => Boolean(spot.markets?.[symbol])) ?? null;
      const needed = [...held].filter((asset) => !spot.markets || pairOf(asset) !== null);
      const pairs = needed.map(pairOf).filter((symbol): symbol is string => symbol !== null);
      const single = await this.singlePrices(spot, pairs.slice(0, SINGLE_PRICES_MAX));
      const prev = this.snapshots.get(row.exchange);
      const old = prev && Date.now() - prev.at <= TICKERS_STALE_MAX_MS ? prev : null;
      lookup = (symbol) => single.get(symbol) ?? old?.prices.get(symbol);
      const notFresh = needed.filter((asset) => !QUOTES.some((q) => single.has(`${asset}/${q}`)));
      if (notFresh.length > 0) {
        errors.prices = mapExchangeError(pricesErr);
        if (old && notFresh.some((asset) => QUOTES.some((q) => old.prices.has(`${asset}/${q}`)))) pricesStaleAt = old.at;
      }
      this.log.warn(`prices ${row.exchange}: ticker list failed (${mapExchangeError(pricesErr).code}); ${single.size}/${needed.length} priced one by one`);
    }

    const priceOf = (asset: string): number | null => {
      if (STABLES.has(asset)) return 1;
      for (const q of QUOTES) {
        const p = lookup(`${asset}/${q}`);
        if (p !== undefined) return p;
      }
      return null;
    };

    const fills: FillRow[] = fillsRaw
      .map(({ t, market }) => ({
        id: String(t.id ?? `${t.order ?? ''}-${t.timestamp}`),
        // A perpetual's fill is futures whichever listing brought it: it never counts toward a spot cost.
        market: String(t.symbol ?? '').includes(':') ? 'futures' : market,
        symbol: String(t.symbol ?? ''),
        side: String(t.side ?? ''),
        price: num(t.price) ?? NaN,
        amount: num(t.amount) ?? NaN,
        cost: num(t.cost),
        fee: num(t.fee?.cost),
        feeCurrency: t.fee?.currency ?? null,
        timestamp: num(t.timestamp) ?? 0,
      }))
      .filter((f) => Number.isFinite(f.price) && Number.isFinite(f.amount))
      .sort((a, b) => b.timestamp - a.timestamp);

    const manual = new Map((await this.db.all<{ asset: string; avg_price: number }>('SELECT asset, avg_price FROM cost_basis WHERE account_id = ?', [id])).map((r) => [r.asset, r.avg_price]));
    const costFills: FillLike[] = fills
      .filter((f) => f.market === 'spot' && (f.side === 'buy' || f.side === 'sell'))
      .map((f) => ({ symbol: f.symbol, side: f.side as 'buy' | 'sell', price: f.price, amount: f.amount, timestamp: f.timestamp, fee: { cost: f.fee ?? 0, currency: f.feeCurrency ?? undefined } }));

    // The fills must explain the holding across all accounts (trade + main), not just one row.
    const totalByAsset = new Map<string, number>();
    for (const { bal } of balancesRaw ?? []) {
      for (const [asset, t] of Object.entries((bal.total ?? {}) as unknown as Record<string, number | undefined>)) {
        const v = num(t) ?? 0;
        if (v > 0) totalByAsset.set(asset, (totalByAsset.get(asset) ?? 0) + v);
      }
    }
    const avgFromFills = new Map<string, number | null>();

    const balances: BalanceRow[] = [];
    for (const { account, bal } of balancesRaw ?? []) {
      const totals = (bal.total ?? {}) as unknown as Record<string, number | undefined>;
      const free = (bal.free ?? {}) as unknown as Record<string, number | undefined>;
      const used = (bal.used ?? {}) as unknown as Record<string, number | undefined>;
      for (const [asset, totalRaw] of Object.entries(totals)) {
        const total = num(totalRaw) ?? 0;
        if (total <= 0) continue;
        const price = priceOf(asset);
        const value = price !== null ? price * total : null;
        let avgPrice: number | null = null;
        let avgSource: BalanceRow['avgSource'] = null;
        if (!STABLES.has(asset)) {
          if (manual.has(asset)) {
            avgPrice = manual.get(asset) as number;
            avgSource = 'manual';
          } else {
            if (!avgFromFills.has(asset)) avgFromFills.set(asset, costBasis(asset, totalByAsset.get(asset) ?? total, costFills).avgPrice);
            const avg = avgFromFills.get(asset) ?? null;
            if (avg !== null) {
              avgPrice = avg;
              avgSource = 'fills';
            }
          }
        }
        const pnl = avgPrice !== null && price !== null ? (price - avgPrice) * total : null;
        balances.push({
          asset,
          account,
          total,
          free: num(free[asset]) ?? 0,
          used: num(used[asset]) ?? 0,
          price,
          value,
          avgPrice,
          avgSource,
          pnl,
          pnlPct: avgPrice !== null && price !== null && avgPrice > 0 ? ((price - avgPrice) / avgPrice) * 100 : null,
        });
      }
    }
    balances.sort((a, b) => (b.value ?? -1) - (a.value ?? -1));

    const positions: PositionRow[] = (positionsRaw ?? [])
      .filter((p) => (num(p.contracts) ?? 0) !== 0)
      .map((p) => ({
        symbol: String(p.symbol),
        side: positionSideOf(p) ?? String(p.side ?? ''),
        contracts: num(p.contracts) ?? 0,
        size: num(p.contracts) !== null && num(p.contractSize) !== null ? (num(p.contracts) as number) * (num(p.contractSize) as number) : null,
        entryPrice: num(p.entryPrice),
        markPrice: num(p.markPrice),
        unrealizedPnl: num(p.unrealizedPnl),
        percentage: num(p.percentage),
        liquidationPrice: num(p.liquidationPrice),
        leverage: num(p.leverage),
        marginMode: p.marginMode ?? null,
        notional: num(p.notional),
      }));

    const orders: OrderRow[] = ordersRaw.map(({ o, market }) => ({
      id: String(o.id),
      // A perpetual's order (BTC/USDT:USDT) is futures, whichever listing brought it (KuCoin's unified account, OKX).
      market: String(o.symbol ?? '').includes(':') ? 'futures' : market,
      symbol: String(o.symbol ?? ''),
      type: String(o.type ?? ''),
      side: String(o.side ?? ''),
      price: num(o.price),
      triggerPrice: num(o.triggerPrice) ?? num((o as { stopPrice?: unknown }).stopPrice),
      amount: num(o.amount),
      filled: num(o.filled),
      status: o.status ?? null,
      timestamp: num(o.timestamp),
      reduceOnly: Boolean(o.reduceOnly),
      stop: stopDirection(o.info),
      positionSide: orderPositionSide(o.info),
      stopLoss: num((o as { stopLossPrice?: unknown }).stopLossPrice),
      takeProfit: num((o as { takeProfitPrice?: unknown }).takeProfitPrice),
      contractSize: num(spot.markets?.[String(o.symbol)]?.contractSize ?? futures?.markets?.[String(o.symbol)]?.contractSize),
    }));
    // The same order can come back from the normal and the trigger listing.
    const seenOrders = new Set<string>();
    const uniqueOrders = orders.filter((o) => (seenOrders.has(`${o.market}:${o.id}`) ? false : (seenOrders.add(`${o.market}:${o.id}`), true)));

    const fetchedAt = Date.now();
    const good = this.lastGood.get(id) ?? {};
    const stale: Portfolio['stale'] = pricesStaleAt !== null ? { prices: pricesStaleAt } : {};
    const pick = <T>(section: StaleSection, fresh: T[]): T[] => {
      const prev = good[section] as { data: T[]; at: number } | undefined;
      if (errors[section]) {
        if (prev) {
          stale[section] = prev.at;
          return prev.data;
        }
        return fresh;
      }
      (good as Record<StaleSection, { data: T[]; at: number }>)[section] = { data: fresh, at: fetchedAt };
      return fresh;
    };
    const finalBalances = pick('balances', balances);
    const finalPositions = pick('positions', positions);
    const finalOrders = pick('orders', uniqueOrders);
    const finalFills = pick('fills', fills.slice(0, 200));
    this.lastGood.set(id, good);

    const stableCash = finalBalances.filter((b) => STABLES.has(b.asset)).reduce((a, b) => a + b.free, 0);
    const portfolio: Portfolio = {
      accountId: id,
      exchange: row.exchange,
      kind: 'crypto',
      currency: 'USDT',
      cash: finalBalances.some((b) => STABLES.has(b.asset)) ? stableCash : null,
      asOf: null,
      mode,
      balances: finalBalances,
      positions: finalPositions,
      orders: finalOrders,
      fills: finalFills,
      totals: {
        spotValue: finalBalances.reduce((a, b) => a + (b.value ?? 0), 0),
        unrealizedPnl: finalPositions.reduce((a, b) => a + (b.unrealizedPnl ?? 0), 0),
        futuresAvailable,
      },
      errors,
      stale,
      fetchedAt,
    };
    const hardFailure = errors.balances?.code === 'AUTH' || errors.balances?.code === 'PERMISSION';
    await this.db.run('UPDATE exchange_accounts SET last_ok_at = CASE WHEN ? = 1 THEN last_ok_at ELSE ? END, last_error = ? WHERE id = ?', [
      hardFailure ? 1 : 0,
      Date.now(),
      hardFailure ? `${errors.balances?.code}: ${errors.balances?.message}` : null,
      id,
    ]);
    if (hardFailure) this.clients.delete(id);
    else this.keep(id, gen, portfolio);
    if (Object.keys(errors).length) this.log.warn(`portfolio ${id}: ${Object.entries(errors).map(([k, v]) => `${k}=${v?.code}`).join(', ')}`);
    return portfolio;
  }

  /** A stock broker's account (brokers.ts), with the same last-good, cost-basis and status rules as the exchanges. */
  private async loadBroker(id: number, row: AccountRow & { exchange: BrokerId }, gen: number): Promise<Portfolio> {
    const adapter = this.brokerFor(id, row);
    let snap: Awaited<ReturnType<BrokerAdapter['load']>>;
    try {
      snap = await adapter.load();
    } catch (err) {
      // The whole account could not be read: every section shows its last good data (or nothing) and the reason.
      const e = mapExchangeError(err);
      snap = { currency: this.portfolios.get(id)?.data.currency ?? 'USD', balances: [], positions: [], orders: [], fills: [], cash: null, errors: { balances: e, positions: e, orders: e, fills: e } };
    }
    const errors: Portfolio['errors'] = { ...snap.errors };
    const manual = new Map((await this.db.all<{ asset: string; avg_price: number }>('SELECT asset, avg_price FROM cost_basis WHERE account_id = ?', [id])).map((r) => [r.asset, r.avg_price]));
    const balances = snap.balances
      .map((b): BalanceRow => {
        const m = manual.get(b.asset);
        if (m === undefined) return b;
        // A price set by hand wins; the PnL can be recomputed only when price and value share a currency.
        const same = !b.priceCurrency || b.priceCurrency === b.currency;
        const pnl = b.price !== null && same ? (b.price - m) * b.total : null;
        return { ...b, avgPrice: m, avgSource: 'manual', pnl, pnlPct: b.price !== null ? ((b.price - m) / m) * 100 : null };
      })
      .sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
    const fetchedAt = Date.now();
    const good = this.lastGood.get(id) ?? {};
    const stale: Portfolio['stale'] = {};
    const pick = <T>(section: StaleSection, fresh: T[]): T[] => {
      const prev = good[section] as { data: T[]; at: number } | undefined;
      if (errors[section]) {
        if (prev) {
          stale[section] = prev.at;
          return prev.data;
        }
        return fresh;
      }
      (good as Record<StaleSection, { data: T[]; at: number }>)[section] = { data: fresh, at: fetchedAt };
      return fresh;
    };
    const finalBalances = pick('balances', balances);
    const finalPositions = pick('positions', snap.positions);
    const finalOrders = pick('orders', snap.orders);
    const finalFills = pick('fills', snap.fills.sort((a, b) => b.timestamp - a.timestamp).slice(0, 200));
    this.lastGood.set(id, good);
    const portfolio: Portfolio = {
      accountId: id,
      exchange: row.exchange,
      kind: 'stocks',
      currency: snap.currency,
      cash: snap.cash,
      asOf: snap.asOf ?? null,
      mode: 'unknown',
      balances: finalBalances,
      positions: finalPositions,
      orders: finalOrders,
      fills: finalFills,
      totals: {
        spotValue: finalBalances.reduce((a, b) => a + (b.value ?? 0), 0),
        unrealizedPnl: finalPositions.reduce((a, b) => a + (b.unrealizedPnl ?? 0), 0),
        futuresAvailable: null,
      },
      errors,
      stale,
      fetchedAt,
    };
    const first = errors.balances;
    const hardFailure = first?.code === 'AUTH' || first?.code === 'PERMISSION';
    await this.db.run('UPDATE exchange_accounts SET last_ok_at = CASE WHEN ? = 1 THEN last_ok_at ELSE ? END, last_error = ? WHERE id = ?', [
      hardFailure ? 1 : 0,
      Date.now(),
      hardFailure ? `${first?.code}: ${first?.message}` : null,
      id,
    ]);
    if (hardFailure) this.brokers.delete(id);
    else this.keep(id, gen, portfolio);
    if (Object.keys(errors).length) this.log.warn(`portfolio ${id} (${row.exchange}): ${Object.entries(errors).map(([k, v]) => `${k}=${v?.code}`).join(', ')}`);
    return portfolio;
  }

  /** The ticker list of an exchange: shared by all accounts for TICKERS_TTL_MS, one request at a time. */
  private async tickerSnapshot(exchange: string, spot: Exchange): Promise<PriceSnapshot> {
    const cached = this.snapshots.get(exchange);
    if (cached && Date.now() - cached.at < TICKERS_TTL_MS) return cached;
    const failed = this.snapshotFailures.get(exchange);
    if (failed && Date.now() - failed.at < TICKERS_COOLDOWN_MS) throw failed.err;
    const pending = this.snapshotsInflight.get(exchange);
    if (pending) return pending;
    const p = (async () => {
      try {
        const tickers = await this.retryOn(spot, () => spot.fetchTickers());
        const prices = new Map<string, number>();
        for (const [symbol, t] of Object.entries(tickers ?? {})) {
          const v = num(t?.last) ?? num(t?.close);
          if (v !== null && v > 0) prices.set(symbol, v);
        }
        // An empty answer must not replace good prices.
        if (prices.size === 0) throw new Error(`${exchange}: lista de prețuri a venit goală`);
        const snap = { prices, at: Date.now() };
        this.snapshots.set(exchange, snap);
        this.snapshotFailures.delete(exchange);
        return snap;
      } catch (err) {
        this.snapshotFailures.set(exchange, { at: Date.now(), err });
        throw err;
      }
    })().finally(() => this.snapshotsInflight.delete(exchange));
    this.snapshotsInflight.set(exchange, p);
    return p;
  }

  /** Prices of a few pairs, one light request each (KuCoin: best bid/ask, weight 2); failures stay unpriced. */
  private async singlePrices(spot: Exchange, symbols: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    const level1 = (spot as unknown as { publicGetMarketOrderbookLevel1?: (p: { symbol: string }) => Promise<{ data?: { price?: unknown } | null }> })
      .publicGetMarketOrderbookLevel1;
    await Promise.all(
      symbols.map(async (symbol) => {
        try {
          const id = spot.markets?.[symbol]?.id;
          let price: number | null;
          if (typeof level1 === 'function' && id) {
            price = num((await level1.call(spot, { symbol: id }))?.data?.price);
          } else {
            const t = await spot.fetchTicker(symbol);
            price = num(t.last) ?? num(t.close);
          }
          if (price !== null && price > 0) out.set(symbol, price);
        } catch {
          // Stays unpriced here; the last good list (or "—") covers it.
        }
      }),
    );
    return out;
  }
}
