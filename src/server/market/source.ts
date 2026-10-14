// Where a user's crypto prices come from (FD-MARKETSRC, TD-MARKETSRC §2): the exchange they connected, their choice
// among several, otherwise the admin's default; a pair (or timeframe) their exchange lacks comes from the default.
import { MARKET_EXCHANGES, type MarketExchange } from '../../shared/settings.ts';
import type { Timeframe } from '../../shared/time.ts';
import type { Db } from '../db/database.ts';
import type { SettingsService } from '../settings.ts';
import type { MarketData } from './market.ts';

/** How long a user's connected exchanges are reused: another instance (TD-AZURE §5) may add an account meanwhile. */
export const SOURCE_TTL_MS = 30_000;

const isMarketExchange = (id: string): id is MarketExchange => (MARKET_EXCHANGES as readonly string[]).includes(id);

export interface UserSource {
  /** The exchange of the user's prices. */
  exchange: MarketExchange;
  /** Their connected exchanges that can give prices, in the order they were added. */
  connected: MarketExchange[];
  /** The admin's default (no exchange of their own, or a pair theirs lacks). */
  defaultExchange: MarketExchange;
  /** Candles loaded per chart (everyone's, the admin's to set). */
  candles: number;
}

export class MarketSource {
  private readonly db: Db;
  private readonly settings: SettingsService;
  private readonly market: MarketData;
  private readonly now: () => number;
  private readonly cache = new Map<number, { value: MarketExchange[]; at: number }>();

  constructor(db: Db, settings: SettingsService, market: MarketData, now: () => number = Date.now) {
    this.db = db;
    this.settings = settings;
    this.market = market;
    this.now = now;
  }

  /** The user's connected exchanges that can give prices (Kraken, Coinbase and brokers cannot), first added first. */
  async connected(userId: number): Promise<MarketExchange[]> {
    const hit = this.cache.get(userId);
    if (hit && this.now() - hit.at < SOURCE_TTL_MS) return hit.value;
    const rows = await this.db.all<{ exchange: string }>('SELECT exchange FROM exchange_accounts WHERE user_id = ? ORDER BY id', [userId]);
    const value = [...new Set(rows.map((r) => r.exchange).filter(isMarketExchange))];
    this.cache.set(userId, { value, at: this.now() });
    return value;
  }

  /** An account was added or removed here: the next request reads the list again. */
  forget(userId: number): void {
    this.cache.delete(userId);
  }

  async forUser(userId: number): Promise<UserSource> {
    const [connected, s] = await Promise.all([this.connected(userId), this.settings.forUser(userId)]);
    const defaultExchange = s.marketData.exchange;
    const chosen = s.market.exchange;
    const exchange = connected.length === 0 ? defaultExchange : chosen && connected.includes(chosen) ? chosen : (connected[0] as MarketExchange);
    return { exchange, connected, defaultExchange, candles: s.marketData.candles };
  }

  /**
   * The exchange for one pair: the user's when it lists the pair (and has `tf`), else the default when that one does,
   * else the user's (its error reaches the page). An exchange whose markets cannot be read is not replaced: a pair is
   * moved to the default only when the user's exchange is known not to have it (FD-MARKETSRC §3).
   */
  async forSymbol(userId: number, symbol: string, tf?: Timeframe): Promise<MarketExchange> {
    const { exchange, defaultExchange } = await this.forUser(userId);
    if (exchange === defaultExchange || (await this.has(exchange, symbol, tf)) !== 'no') return exchange;
    return (await this.has(defaultExchange, symbol, tf)) === 'yes' ? defaultExchange : exchange;
  }

  private async has(exchange: MarketExchange, symbol: string, tf?: Timeframe): Promise<'yes' | 'no' | 'unknown'> {
    try {
      if (tf && !this.market.timeframes(exchange).includes(tf)) return 'no';
      return (await this.market.lists(exchange, symbol)) ? 'yes' : 'no';
    } catch {
      return 'unknown';
    }
  }
}
