// Exchange accounts (read-only keys, encrypted at rest) and portfolio snapshots (FD §6, TD §10).
// This module only READS from exchanges: it never places, edits or cancels orders and never moves funds.
import ccxt, { type Exchange } from 'ccxt';
import { z } from 'zod';
import { ACCOUNT_EXCHANGES } from '../../shared/settings.ts';
import type { Db } from '../db/database.ts';
import type { Logger } from '../log.ts';
import { secretHint, type SecretBox } from '../secrets/crypto.ts';
import { formatIssues, ValidationError } from '../settings.ts';
import { costBasis, STABLES, type FillLike } from './cost-basis.ts';
import { isRateLimitError, withRetry } from './retry.ts';

export const accountInputSchema = z.object({
  exchange: z.enum(ACCOUNT_EXCHANGES),
  label: z.string().trim().min(1).max(60),
  apiKey: z.string().trim().min(8).max(200),
  secret: z.string().trim().min(8).max(300),
  password: z.string().max(200).optional().default(''),
});

export interface AccountView {
  id: number;
  exchange: string;
  label: string;
  keyHint: string;
  createdAt: number;
  lastOkAt: number | null;
  lastError: string | null;
  permissions: string | null;
  permissionWarning: boolean;
}

export type ErrorCode = 'AUTH' | 'PERMISSION' | 'RATE_LIMIT' | 'NETWORK' | 'MAINTENANCE' | 'EXCHANGE';

export function mapExchangeError(err: unknown): { code: ErrorCode; message: string } {
  const message = err instanceof Error ? err.message.slice(0, 300) : String(err);
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
  avgSource: 'fills' | 'manual' | null;
  pnl: number | null;
  pnlPct: number | null;
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
}

/** KuCoin's stop direction from the raw order (futures: down / up; spot: loss / entry). */
export function stopDirection(info: unknown): OrderRow['stop'] {
  const raw = typeof info === 'object' && info !== null ? (info as { stop?: unknown }).stop : undefined;
  const v = typeof raw === 'string' ? raw.toLowerCase() : '';
  return v === 'down' || v === 'loss' ? 'down' : v === 'up' || v === 'entry' ? 'up' : null;
}

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
  mode: 'unified' | 'classic' | 'unknown';
  balances: BalanceRow[];
  positions: PositionRow[];
  orders: OrderRow[];
  fills: FillRow[];
  totals: { spotValue: number; unrealizedPnl: number };
  errors: Partial<Record<'balances' | 'positions' | 'orders' | 'fills' | 'prices' | 'mode', { code: ErrorCode; message: string }>>;
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

// KuCoin accepts at most 7 days per fills query; stay a minute inside the limit.
const FILLS_WINDOW_MS = 7 * 86_400_000 - 60_000;
const PORTFOLIO_TTL_MS = 20_000;
const CLIENT_TTL_MS = 10 * 60_000;
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

interface AccountRow {
  id: number;
  exchange: string;
  label: string;
  api_key: string;
  secret: string;
  password: string | null;
  key_hint: string;
  created_at: number;
  last_ok_at: number | null;
  last_error: string | null;
  permissions: string | null;
}

export type ClientFactory = (exchange: string, creds: { apiKey: string; secret: string; password: string }) => ExchangeClients;

export const defaultClientFactory =
  (proxy?: string): ClientFactory =>
  (exchange, creds) => {
    const opts = {
      apiKey: creds.apiKey,
      secret: creds.secret,
      password: creds.password,
      enableRateLimit: true,
      timeout: 20_000,
      // Market loading would also download the full ticker list (KuCoin's heaviest public call) just for fee rates.
      options: { adjustForTimeDifference: true, fetchMarkets: { fetchTickersFees: false } },
      ...(proxy ? { httpsProxy: proxy } : {}),
    };
    if (exchange === 'kucoin') return { spot: new ccxt.kucoin(opts), futures: new ccxt.kucoinfutures(opts) };
    throw new ValidationError(`Exchange nesuportat: ${exchange}`);
  };

/** Any permission beyond read access deserves a warning. */
export function hasRiskyPermissions(permissions: string | null): boolean {
  if (!permissions) return false;
  return permissions
    .split(/[,\s]+/)
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean)
    .some((p) => p !== 'general');
}

export class AccountsService {
  private readonly clients = new Map<number, { clients: ExchangeClients; at: number }>();
  private readonly portfolios = new Map<number, { data: Portfolio; at: number }>();
  private readonly inflight = new Map<number, Promise<Portfolio>>();
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

  constructor(db: Db, box: SecretBox, log: Logger, factory: ClientFactory, opts: { retryDelaysMs?: readonly number[] } = {}) {
    this.db = db;
    this.box = box;
    this.log = log;
    this.factory = factory;
    this.retryDelaysMs = opts.retryDelaysMs;
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
    return {
      id: r.id,
      exchange: r.exchange,
      label: r.label,
      keyHint: r.key_hint,
      createdAt: r.created_at,
      lastOkAt: r.last_ok_at,
      lastError: r.last_error,
      permissions: r.permissions,
      permissionWarning: hasRiskyPermissions(r.permissions),
    };
  }

  list(): AccountView[] {
    return this.db.all<AccountRow>('SELECT * FROM exchange_accounts ORDER BY id').map((r) => this.toView(r));
  }

  create(input: unknown): AccountView {
    const r = accountInputSchema.safeParse(input);
    if (!r.success) throw new ValidationError(`Date de cont invalide: ${formatIssues(r.error.issues)}`, r.error.issues);
    const a = r.data;
    if (a.exchange === 'kucoin' && !a.password) throw new ValidationError('KuCoin cere și API Passphrase');
    const id = this.db.run(
      'INSERT INTO exchange_accounts(exchange, label, api_key, secret, password, key_hint, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [a.exchange, a.label, this.box.encrypt(a.apiKey), this.box.encrypt(a.secret), a.password ? this.box.encrypt(a.password) : null, secretHint(a.apiKey), Date.now()],
    ).lastInsertRowid;
    return this.toView(this.row(id) as AccountRow);
  }

  delete(id: number): boolean {
    this.clients.delete(id);
    this.portfolios.delete(id);
    this.lastGood.delete(id);
    return this.db.run('DELETE FROM exchange_accounts WHERE id = ?', [id]).changes > 0;
  }

  private row(id: number): AccountRow | undefined {
    return this.db.get<AccountRow>('SELECT * FROM exchange_accounts WHERE id = ?', [id]);
  }

  private clientsFor(id: number): ExchangeClients {
    const cached = this.clients.get(id);
    if (cached && Date.now() - cached.at < CLIENT_TTL_MS) return cached.clients;
    const row = this.row(id);
    if (!row) throw new ValidationError(`Contul ${id} nu există`);
    const clients = this.factory(row.exchange, {
      apiKey: this.box.decrypt(row.api_key),
      secret: this.box.decrypt(row.secret),
      password: row.password ? this.box.decrypt(row.password) : '',
    });
    this.clients.set(id, { clients, at: Date.now() });
    return clients;
  }

  /** Verifies the key with a balance call and reads its permissions (KuCoin). */
  async test(id: number): Promise<AccountView> {
    const row = this.row(id);
    if (!row) throw new ValidationError(`Contul ${id} nu există`);
    const { spot } = this.clientsFor(id);
    try {
      await this.ensureMarkets(spot);
      await this.retryOn(spot, () => spot.fetchBalance());
      let permissions: string | null = null;
      const getKeyInfo = (spot as unknown as { privateGetUserApiKey?: () => Promise<{ data?: { permission?: string } }> }).privateGetUserApiKey;
      if (typeof getKeyInfo === 'function') {
        try {
          const info = await getKeyInfo.call(spot);
          permissions = typeof info?.data?.permission === 'string' ? info.data.permission : null;
        } catch {
          permissions = null;
        }
      }
      this.db.run('UPDATE exchange_accounts SET last_ok_at = ?, last_error = NULL, permissions = ? WHERE id = ?', [Date.now(), permissions, id]);
    } catch (err) {
      const e = mapExchangeError(err);
      const text = e.code === 'RATE_LIMIT' ? 'exchange-ul limitează temporar cererile; încearcă din nou peste un minut' : e.message;
      this.db.run('UPDATE exchange_accounts SET last_error = ? WHERE id = ?', [`${e.code}: ${text}`, id]);
      this.clients.delete(id);
    }
    return this.toView(this.row(id) as AccountRow);
  }

  setCostBasis(accountId: number, asset: string, avgPrice: number | null): void {
    if (!this.row(accountId)) throw new ValidationError(`Contul ${accountId} nu există`);
    const a = asset.trim().toUpperCase();
    if (!/^[A-Z0-9]{1,20}$/.test(a)) throw new ValidationError('Activ invalid');
    if (avgPrice === null) {
      this.db.run('DELETE FROM cost_basis WHERE account_id = ? AND asset = ?', [accountId, a]);
    } else {
      if (!Number.isFinite(avgPrice) || avgPrice <= 0) throw new ValidationError('Prețul mediu trebuie să fie pozitiv');
      this.db.run(
        'INSERT INTO cost_basis(account_id, asset, avg_price, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(account_id, asset) DO UPDATE SET avg_price = excluded.avg_price, updated_at = excluded.updated_at',
        [accountId, a, avgPrice, Date.now()],
      );
    }
    this.portfolios.delete(accountId);
  }

  async portfolio(id: number, force = false): Promise<Portfolio> {
    const cached = this.portfolios.get(id);
    if (!force && cached && Date.now() - cached.at < PORTFOLIO_TTL_MS) return cached.data;
    const pending = this.inflight.get(id);
    if (pending) return pending;
    const p = this.loadPortfolio(id).finally(() => this.inflight.delete(id));
    this.inflight.set(id, p);
    return p;
  }

  private async loadPortfolio(id: number): Promise<Portfolio> {
    const row = this.row(id);
    if (!row) throw new ValidationError(`Contul ${id} nu există`);
    const { spot, futures } = this.clientsFor(id);
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

    let mode: Portfolio['mode'] = 'unknown';
    const isUta = await call('mode', async () => {
      const fn = (spot as unknown as { isUTAEnabled?: () => Promise<boolean> }).isUTAEnabled;
      return typeof fn === 'function' ? await r(() => fn.call(spot)) : false;
    });
    if (isUta !== null) mode = isUta ? 'unified' : 'classic';
    const classic = mode !== 'unified';
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
    const [balancesRaw, positionsRaw, triggerOrders, futuresOrders, futuresFills] = await Promise.all([
      call('balances', async () => {
        if (!classic) return [{ account: 'unified', bal: await rs(() => spot.fetchBalance()) }];
        const out: { account: string; bal: Awaited<ReturnType<Exchange['fetchBalance']>> }[] = [];
        out.push({ account: 'trade', bal: await rs(() => spot.fetchBalance({ type: 'trade' })) });
        out.push({ account: 'main', bal: await rs(() => spot.fetchBalance({ type: 'main' })) });
        return out;
      }),
      call('positions', async () => [...(await rs(() => spot.fetchPositions()))]),
      call('orders', async () => (await rs(() => spot.fetchOpenOrders(undefined, undefined, 200, { trigger: true, hf: false }))).map((o): OrderIn => ({ o, market: 'spot' }))),
      call('orders', async () =>
        classic && futures
          ? [...(await rf(() => futures.fetchOpenOrders())), ...(await rf(() => futures.fetchOpenOrders(undefined, undefined, undefined, { trigger: true })))].map(
              (o): OrderIn => ({ o, market: 'futures' }),
            )
          : [],
      ),
      call('fills', async () => (classic && futures ? (await rf(() => futures.fetchMyTrades(undefined, since, 200))).map((t): FillIn => ({ t, market: 'futures' })) : [])),
    ]);

    // Non-stable assets with a balance, across all accounts (trade + main).
    const held = new Set<string>();
    for (const { bal } of balancesRaw ?? []) {
      for (const [asset, t] of Object.entries((bal.total ?? {}) as unknown as Record<string, number | undefined>)) if ((num(t) ?? 0) > 0 && !STABLES.has(asset)) held.add(asset);
    }

    let spotOrders: OrderIn[] | null = null;
    let spotFills: FillIn[] | null = null;
    if (hf) {
      const wanted = new Set(held);
      for (const w of this.db.all<{ coin: string }>('SELECT coin FROM watchlist')) wanted.add(w.coin);
      const symbols = [...wanted].map((a) => `${a}/USDT`).filter((sym) => Boolean(spot.markets?.[sym])).slice(0, 25);
      spotOrders = await call('orders', async () => {
        const out: OrderIn[] = [];
        for (const sym of symbols) for (const o of await rs(() => spot.fetchOpenOrders(sym))) out.push({ o, market: 'spot' });
        return out;
      });
      spotFills = await call('fills', async () => {
        const out: FillIn[] = [];
        for (const sym of symbols) for (const t of await rs(() => spot.fetchMyTrades(sym, since, 100))) out.push({ t, market: 'spot' });
        return out;
      });
    } else {
      spotOrders = await call('orders', async () => (await rs(() => spot.fetchOpenOrders(undefined, undefined, 200))).map((o): OrderIn => ({ o, market: 'spot' })));
      spotFills = await call('fills', async () => (await rs(() => spot.fetchMyTrades(undefined, since, 200))).map((t): FillIn => ({ t, market: 'spot' })));
    }
    const ordersRaw: OrderIn[] = [...(spotOrders ?? []), ...(triggerOrders ?? []), ...(futuresOrders ?? [])];
    const fillsRaw: FillIn[] = [...(spotFills ?? []), ...(futuresFills ?? [])];

    // Prices: the shared ticker list; when it is refused, held assets one by one, then the last good list.
    const QUOTES = ['USDT', 'USDC'];
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
        market,
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

    const manual = new Map(this.db.all<{ asset: string; avg_price: number }>('SELECT asset, avg_price FROM cost_basis WHERE account_id = ?', [id]).map((r) => [r.asset, r.avg_price]));
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
        side: String(p.side ?? ''),
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
      market,
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

    const portfolio: Portfolio = {
      accountId: id,
      exchange: row.exchange,
      mode,
      balances: finalBalances,
      positions: finalPositions,
      orders: finalOrders,
      fills: finalFills,
      totals: {
        spotValue: finalBalances.reduce((a, b) => a + (b.value ?? 0), 0),
        unrealizedPnl: finalPositions.reduce((a, b) => a + (b.unrealizedPnl ?? 0), 0),
      },
      errors,
      stale,
      fetchedAt,
    };
    const hardFailure = errors.balances?.code === 'AUTH' || errors.balances?.code === 'PERMISSION';
    this.db.run('UPDATE exchange_accounts SET last_ok_at = CASE WHEN ? THEN last_ok_at ELSE ? END, last_error = ? WHERE id = ?', [
      hardFailure ? 1 : 0,
      Date.now(),
      hardFailure ? `${errors.balances?.code}: ${errors.balances?.message}` : null,
      id,
    ]);
    if (hardFailure) this.clients.delete(id);
    else this.portfolios.set(id, { data: portfolio, at: Date.now() });
    if (Object.keys(errors).length) this.log.warn(`portfolio ${id}: ${Object.entries(errors).map(([k, v]) => `${k}=${v?.code}`).join(', ')}`);
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
