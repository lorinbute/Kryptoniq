// Market context (not part of the news sentiment): Crypto Fear & Greed + CoinGecko global and coin list.
import { z } from 'zod';
import type { Db } from '../db/database.ts';
import { fetchJson } from '../net/http.ts';
import { COIN_LIST_CACHE_KEY, type CachedCoin } from '../news/coin-registry.ts';
import { PUT_CACHE, readStockContext, type StockContext } from './stock-context.ts';

export const FNG_KEY = 'fng';
export const GLOBAL_KEY = 'coingecko:global';
const COINLIST_MAX_AGE_MS = 24 * 3_600_000;

const fngSchema = z.object({
  data: z.array(z.object({ value: z.string(), value_classification: z.string(), timestamp: z.string() })),
});

const globalSchema = z.object({
  data: z.object({
    total_market_cap: z.record(z.string(), z.number()),
    total_volume: z.record(z.string(), z.number()),
    market_cap_percentage: z.record(z.string(), z.number()),
    market_cap_change_percentage_24h_usd: z.number().nullable().optional(),
  }),
});

const coinsSchema = z.array(z.object({ symbol: z.string(), name: z.string(), market_cap_rank: z.number().nullable().optional() }));

export interface FearGreed {
  value: number;
  classification: string;
  timestamp: number;
  history: { value: number; timestamp: number }[];
}

export interface GlobalMarket {
  totalMarketCapUsd: number;
  totalVolumeUsd: number;
  btcDominance: number;
  ethDominance: number;
  marketCapChange24h: number | null;
}

export interface MarketContext {
  fearGreed: (FearGreed & { fetchedAt: number }) | null;
  global: (GlobalMarket & { fetchedAt: number }) | null;
  /** FD-SENTIQ §4.2. */
  stocks: StockContext;
}

async function put(db: Db, key: string, value: unknown, now: number): Promise<void> {
  await db.run(PUT_CACHE, { k: key, v: JSON.stringify(value), t: now });
}

async function get<T>(db: Db, key: string): Promise<(T & { fetchedAt: number }) | null> {
  const row = await db.get<{ value: string; fetched_at: number }>('SELECT value, fetched_at FROM market_cache WHERE [key] = ?', [key]);
  if (!row) return null;
  try {
    return { ...(JSON.parse(row.value) as T), fetchedAt: row.fetched_at };
  } catch {
    return null;
  }
}

export function parseFearGreed(raw: unknown): FearGreed {
  const d = fngSchema.parse(raw).data;
  const first = d[0];
  if (!first) throw new Error('Fear & Greed: empty response');
  return {
    value: Number(first.value),
    classification: first.value_classification,
    timestamp: Number(first.timestamp) * 1000,
    history: d.map((x) => ({ value: Number(x.value), timestamp: Number(x.timestamp) * 1000 })).reverse(),
  };
}

export function parseGlobal(raw: unknown): GlobalMarket {
  const d = globalSchema.parse(raw).data;
  return {
    totalMarketCapUsd: d.total_market_cap.usd ?? 0,
    totalVolumeUsd: d.total_volume.usd ?? 0,
    btcDominance: d.market_cap_percentage.btc ?? 0,
    ethDominance: d.market_cap_percentage.eth ?? 0,
    marketCapChange24h: d.market_cap_change_percentage_24h_usd ?? null,
  };
}

/** Refreshes F&G and global stats; the coin list at most daily. Returns true when the coin list changed. */
export async function refreshContext(db: Db, now = Date.now()): Promise<{ coinListUpdated: boolean; errors: string[] }> {
  const errors: string[] = [];
  try {
    await put(db, FNG_KEY, parseFearGreed(await fetchJson('https://api.alternative.me/fng/?limit=31')), now);
  } catch (err) {
    errors.push(`fear&greed: ${(err as Error).message}`);
  }
  try {
    await put(db, GLOBAL_KEY, parseGlobal(await fetchJson('https://api.coingecko.com/api/v3/global')), now);
  } catch (err) {
    errors.push(`coingecko global: ${(err as Error).message}`);
  }
  let coinListUpdated = false;
  const coinRow = await db.get<{ fetched_at: number }>('SELECT fetched_at FROM market_cache WHERE [key] = ?', [COIN_LIST_CACHE_KEY]);
  if (!coinRow || now - coinRow.fetched_at > COINLIST_MAX_AGE_MS) {
    try {
      const all: CachedCoin[] = [];
      for (const page of [1, 2]) {
        const list = coinsSchema.parse(await fetchJson(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=125&page=${page}`));
        for (const c of list) all.push({ symbol: c.symbol.toUpperCase(), name: c.name, rank: c.market_cap_rank ?? null });
      }
      if (all.length > 0) {
        await put(db, COIN_LIST_CACHE_KEY, all, now);
        coinListUpdated = true;
      }
    } catch (err) {
      errors.push(`coingecko coins: ${(err as Error).message}`);
    }
  }
  return { coinListUpdated, errors };
}

export async function readContext(db: Db): Promise<MarketContext> {
  return { fearGreed: await get<FearGreed>(db, FNG_KEY), global: await get<GlobalMarket>(db, GLOBAL_KEY), stocks: await readStockContext(db) };
}
