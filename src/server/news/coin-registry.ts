// Builds the CoinDetector from the CoinGecko top list (market_cache) and the users' watchlists.
import type { Db } from '../db/database.ts';
import { CoinDetector, type CoinEntry } from './coins.ts';

export const COIN_LIST_CACHE_KEY = 'coingecko:markets';

export interface CachedCoin {
  symbol: string;
  name: string;
  rank: number | null;
}

export class CoinRegistry {
  private detector: CoinDetector | null = null;
  private classifying: CoinDetector | null = null;
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  invalidate(): void {
    this.detector = null;
    this.classifying = null;
  }

  coinList(): CachedCoin[] {
    const row = this.db.get<{ value: string }>('SELECT value FROM market_cache WHERE key = ?', [COIN_LIST_CACHE_KEY]);
    if (!row) return [];
    try {
      const parsed = JSON.parse(row.value) as CachedCoin[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /** The tags of the news (what each user's "favourites only" filter reads): every user's favourites and aliases. */
  get(): CoinDetector {
    this.detector ??= this.build(false);
    return this.detector;
  }

  /**
   * What weighs a news item in the common sentiment (relevance, impact): the coin list and the ADMIN's favourites
   * only (FD-USERS §2). Another user's free-text alias ("the" → BTC) tags news for their own filter, but never
   * changes the index everybody sees.
   */
  classifier(): CoinDetector {
    this.classifying ??= this.build(true);
    return this.classifying;
  }

  private build(adminOnly: boolean): CoinDetector {
    const entries: CoinEntry[] = this.coinList()
      .filter((c) => typeof c.symbol === 'string' && typeof c.name === 'string')
      .map((c) => ({ symbol: c.symbol.toUpperCase(), names: [c.name] }));
    const aliases: Record<string, string[]> = {};
    const stocks: Record<string, string[]> = {};
    // Every user's favourites (FD-USERS §2): news are tagged once for everybody, so the aliases of a symbol are the
    // union of what each user gave it.
    const rows = this.db.all<{ coin: string; aliases: string; kind: string }>(
      `SELECT coin, aliases, kind FROM watchlist ${adminOnly ? "WHERE user_id IN (SELECT id FROM users WHERE role = 'admin')" : ''} ORDER BY user_id, position`,
    );
    for (const w of rows) {
      let list: string[] = [];
      try {
        const parsed = JSON.parse(w.aliases) as unknown;
        if (Array.isArray(parsed)) list = parsed.filter((a): a is string => typeof a === 'string');
      } catch {
        list = [];
      }
      const into = w.kind === 'stock' ? stocks : aliases;
      into[w.coin] = [...new Set([...(into[w.coin] ?? []), ...list])];
    }
    return new CoinDetector(entries, aliases, stocks);
  }
}
