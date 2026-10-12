// Builds the CoinDetector from the CoinGecko top list (market_cache) and the user's watchlist.
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
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  invalidate(): void {
    this.detector = null;
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

  get(): CoinDetector {
    if (this.detector) return this.detector;
    const entries: CoinEntry[] = this.coinList()
      .filter((c) => typeof c.symbol === 'string' && typeof c.name === 'string')
      .map((c) => ({ symbol: c.symbol.toUpperCase(), names: [c.name] }));
    const aliases: Record<string, string[]> = {};
    for (const w of this.db.all<{ coin: string; aliases: string }>('SELECT coin, aliases FROM watchlist')) {
      let list: string[] = [];
      try {
        const parsed = JSON.parse(w.aliases) as unknown;
        if (Array.isArray(parsed)) list = parsed.filter((a): a is string => typeof a === 'string');
      } catch {
        list = [];
      }
      aliases[w.coin] = list;
    }
    this.detector = new CoinDetector(entries, aliases);
    return this.detector;
  }
}
