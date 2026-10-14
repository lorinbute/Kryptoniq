// Builds the CoinDetector from the CoinGecko top list (market_cache) and the users' watchlists.
import type { Db } from '../db/database.ts';
import { CoinDetector, type CoinEntry } from './coins.ts';

export const COIN_LIST_CACHE_KEY = 'coingecko:markets';

export interface CachedCoin {
  symbol: string;
  name: string;
  rank: number | null;
}

/**
 * How long a built detector is reused: another process on the same database (TD-AZURE §6) may change a watchlist
 * without calling `invalidate` here.
 */
export const DETECTOR_TTL_MS = 5 * 60_000;

export class CoinRegistry {
  private detector: { value: Promise<CoinDetector>; at: number } | null = null;
  private classifying: { value: Promise<CoinDetector>; at: number } | null = null;
  private readonly db: Db;
  private readonly now: () => number;

  constructor(db: Db, now: () => number = Date.now) {
    this.db = db;
    this.now = now;
  }

  invalidate(): void {
    this.detector = null;
    this.classifying = null;
  }

  async coinList(): Promise<CachedCoin[]> {
    const row = await this.db.get<{ value: string }>('SELECT value FROM market_cache WHERE [key] = ?', [COIN_LIST_CACHE_KEY]);
    if (!row) return [];
    try {
      const parsed = JSON.parse(row.value) as CachedCoin[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /** The tags of the news (what each user's "favourites only" filter reads): every user's favourites and aliases. */
  get(): Promise<CoinDetector> {
    if (!this.detector || this.now() - this.detector.at >= DETECTOR_TTL_MS) this.detector = this.cached(false);
    return this.detector.value;
  }

  /**
   * What weighs a news item in the common sentiment (relevance, impact): the coin list and the ADMIN's favourites
   * only (FD-USERS §2). Another user's free-text alias ("the" → BTC) tags news for their own filter, but never
   * changes the index everybody sees.
   */
  classifier(): Promise<CoinDetector> {
    if (!this.classifying || this.now() - this.classifying.at >= DETECTOR_TTL_MS) this.classifying = this.cached(true);
    return this.classifying.value;
  }

  /** One build shared by every caller meanwhile; a failed build is not kept. */
  private cached(adminOnly: boolean): { value: Promise<CoinDetector>; at: number } {
    const entry = { value: this.build(adminOnly), at: this.now() };
    void entry.value.catch(() => {
      if (adminOnly ? this.classifying === entry : this.detector === entry) {
        if (adminOnly) this.classifying = null;
        else this.detector = null;
      }
    });
    return entry;
  }

  private async build(adminOnly: boolean): Promise<CoinDetector> {
    const entries: CoinEntry[] = (await this.coinList())
      .filter((c) => typeof c.symbol === 'string' && typeof c.name === 'string')
      .map((c) => ({ symbol: c.symbol.toUpperCase(), names: [c.name] }));
    const aliases: Record<string, string[]> = {};
    const stocks: Record<string, string[]> = {};
    const indices: Record<string, string[]> = {};
    // Every user's favourites (FD-USERS §2): news are tagged once for everybody, so the aliases of a symbol are the
    // union of what each user gave it.
    const rows = await this.db.all<{ coin: string; aliases: string; kind: string }>(
      `SELECT coin, aliases, kind FROM watchlist ${adminOnly ? "WHERE user_id IN (SELECT id FROM users WHERE role = N'admin')" : ''} ORDER BY user_id, position, coin`,
    );
    for (const w of rows) {
      let list: string[] = [];
      try {
        const parsed = JSON.parse(w.aliases) as unknown;
        if (Array.isArray(parsed)) list = parsed.filter((a): a is string => typeof a === 'string');
      } catch {
        list = [];
      }
      const into = w.kind === 'stock' ? stocks : w.kind === 'index' ? indices : aliases;
      into[w.coin] = [...new Set([...(into[w.coin] ?? []), ...list])];
    }
    return new CoinDetector(entries, aliases, stocks, indices);
  }
}
