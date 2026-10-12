// Coin detection in headlines (docs/technical-design.md §5.5).

export interface CoinEntry {
  /** Ticker, upper case (e.g. BTC). */
  symbol: string;
  /**
   * Full names / aliases (e.g. Bitcoin). A leading "=" makes the name case-sensitive (plus its
   * ALL-CAPS form): "=Ripple" matches "Ripple" but not "ripple effects".
   */
  names: string[];
}

/** Upper-case words that are not coins in a news context. */
export const SYMBOL_BLACKLIST = new Set([
  'CEO', 'CFO', 'CTO', 'ETF', 'ETFS', 'SEC', 'USD', 'USA', 'GDP', 'CPI', 'PPI', 'PCE', 'IPO', 'NFT', 'NFTS', 'DAO', 'DEX', 'CEX', 'API', 'ATH',
  'ONE', 'GAS', 'SUN', 'NEW', 'TOP', 'BIG', 'ALL', 'FOR', 'THE', 'AND', 'NOW', 'OUT', 'KEY', 'WIN', 'ACT', 'ME', 'AI', 'IT', 'US', 'UK', 'EU',
  'UN', 'OK', 'FED', 'FOMC', 'IMF', 'ECB', 'BOJ', 'GMT', 'UTC', 'EST', 'EDT', 'PST', 'FBI', 'DOJ', 'IRS', 'NYSE', 'LLC', 'INC', 'LTD', 'PLC',
  'TV', 'NEWS', 'CNBC', 'BBC', 'FT', 'WSJ', 'OPEC', 'NATO', 'G7', 'G20', 'ESG', 'APY', 'APR', 'TVL', 'KYC', 'AML', 'OTC', 'P2P', 'DEFI', 'CEFI',
  'RWA', 'L1', 'L2', 'EVM', 'ZK', 'MEV', 'POS', 'POW', 'PAY', 'OPEN', 'TRUMP', 'MAGA', 'META', 'X', 'BOND', 'BONDS', 'GOLD', 'OIL', 'HOT',
  'MORE', 'JUST', 'LIKE', 'REAL', 'SAFE', 'TRUE', 'WAVE', 'WELL', 'LOOM', 'BEST', 'EDGE', 'FLOW', 'FUN', 'LOVE', 'HIGH', 'MOVE', 'BREAKING',
  'CORE', 'SKY', 'FLARE', 'BEAM', 'PLASMA', 'QUANT', 'NEO', 'MANTLE', 'HELIUM', 'MAKER', 'STORY', 'SONIC', 'VIRTUAL', 'PUMP', 'ZERO', 'HAS',
  'ARE', 'WAS', 'GET', 'GOT', 'SET', 'RUN', 'OFF', 'LOW', 'MAX', 'MIN', 'ANY', 'CAN', 'WILL', 'SAYS', 'DUMP', 'MOON', 'BULL', 'BEAR', 'FIRE',
  'STOP', 'TIME', 'DEAL', 'CASH', 'BANK', 'LIVE', 'WORLD', 'OPEN', 'BACK', 'FREE', 'GOOD', 'HOLD', 'SAFU', 'SAND', 'MANA', 'ICE', 'GOLD', 'DOGS',
]);

/** Names that are ordinary English words; matched only through their ticker unless the user adds them as aliases. */
export const AMBIGUOUS_NAMES = new Set([
  'near', 'link', 'sui', 'flow', 'gas', 'one', 'sun', 'act', 'ankr', 'just', 'stacks', 'render', 'graph', 'the graph', 'theta', 'maker',
  'compound', 'curve', 'injective', 'optimism', 'polygon', 'cosmos', 'pepe', 'bonk', 'floki', 'gala', 'stellar', 'avalanche',
  'ocean', 'band', 'mask', 'storj', 'loom', 'origin', 'harmony', 'oasis', 'kava', 'iota', 'waves', 'zcash', 'dash', 'decentraland',
  'sandbox', 'the sandbox', 'immutable', 'ethena', 'jupiter', 'pyth', 'ondo', 'worldcoin', 'virtual', 'virtuals', 'trump', 'official trump',
  'hyperliquid', 'pi', 'pi network', 'mantra', 'story', 'kaito', 'sonic', 'berachain', 'movement', 'walrus', 'plume', 'bitget token',
]);

/**
 * Curated names that are safe to match (proper nouns that are not ordinary words). Names coming from the
 * CoinGecko list are only used when they have several words (e.g. "Wrapped Bitcoin"): single-word names
 * there are too often plain English ("Core", "Sky", "Quant") to be trusted.
 */
export const CORE_COINS: CoinEntry[] = [
  { symbol: 'BTC', names: ['Bitcoin', 'bitcoins'] },
  { symbol: 'ETH', names: ['Ethereum', '=Ether'] },
  { symbol: 'XRP', names: ['=Ripple'] },
  { symbol: 'BNB', names: ['BNB Chain'] },
  { symbol: 'SOL', names: ['Solana'] },
  { symbol: 'DOGE', names: ['Dogecoin'] },
  { symbol: 'ADA', names: ['Cardano'] },
  { symbol: 'TRX', names: ['=Tron'] },
  { symbol: 'AVAX', names: ['Avalanche'] },
  { symbol: 'LINK', names: ['Chainlink'] },
  { symbol: 'TON', names: ['Toncoin'] },
  { symbol: 'DOT', names: ['Polkadot'] },
  { symbol: 'LTC', names: ['Litecoin'] },
  { symbol: 'BCH', names: ['Bitcoin Cash'] },
  { symbol: 'ETC', names: ['Ethereum Classic'] },
  { symbol: 'XLM', names: ['Stellar'] },
  { symbol: 'XMR', names: ['Monero'] },
  { symbol: 'SHIB', names: ['Shiba Inu'] },
  { symbol: 'USDT', names: ['=Tether'] },
  { symbol: 'USDC', names: ['USD Coin'] },
  { symbol: 'HBAR', names: ['Hedera'] },
  { symbol: 'FIL', names: ['Filecoin'] },
  { symbol: 'ATOM', names: [] },
  { symbol: 'ARB', names: ['Arbitrum'] },
  { symbol: 'OP', names: [] },
  { symbol: 'NEAR', names: ['NEAR Protocol'] },
  { symbol: 'SUI', names: [] },
  { symbol: 'APT', names: ['Aptos'] },
  { symbol: 'UNI', names: ['Uniswap'] },
  { symbol: 'AAVE', names: [] },
  { symbol: 'HYPE', names: ['Hyperliquid'] },
  { symbol: 'TAO', names: ['Bittensor'] },
  { symbol: 'KAS', names: ['Kaspa'] },
  { symbol: 'ENA', names: ['Ethena'] },
  { symbol: 'WLD', names: ['Worldcoin'] },
  { symbol: 'ALGO', names: ['Algorand'] },
  { symbol: 'XTZ', names: ['Tezos'] },
  { symbol: 'CRO', names: ['Cronos'] },
  { symbol: 'ZEC', names: ['Zcash'] },
  { symbol: 'PEPE', names: [] },
  { symbol: 'TIA', names: ['Celestia'] },
  { symbol: 'KCS', names: ['KuCoin Token'] },
];

interface Matcher {
  symbol: string;
  re: RegExp;
  len: number;
}

interface NameDef {
  symbol: string;
  name: string;
  caseSensitive: boolean;
}

/** Coins of a news item: title and summary are scanned separately (each has its own ALL-CAPS check). */
export function detectCoins(detector: CoinDetector, title: string, summary: string): string[] {
  return [...new Set([...detector.detect(title), ...detector.detect(summary.slice(0, 300))])].sort();
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Compiled detector; rebuild when the coin list or the watchlist changes. */
export class CoinDetector {
  private readonly nameMatchers: Matcher[];
  private readonly symbols: Set<string>;
  /** Watchlist coins: their tickers are always accepted, even when short or blacklisted. */
  private readonly userSymbols: Set<string>;

  constructor(entries: CoinEntry[], userAliases: Record<string, string[]> = {}) {
    const names = new Map<string, NameDef>(); // lower-case name → definition
    const symbols = new Set<string>();
    const add = (symbol: string, raw: string, force = false) => {
      const caseSensitive = raw.startsWith('=');
      const n = (caseSensitive ? raw.slice(1) : raw).trim();
      if (n.length < 3) return;
      const lower = n.toLowerCase();
      if (!force && AMBIGUOUS_NAMES.has(lower)) return;
      if (!names.has(lower) || force) names.set(lower, { symbol, name: n, caseSensitive: caseSensitive && !force });
    };
    for (const e of CORE_COINS) {
      symbols.add(e.symbol);
      for (const name of e.names) add(e.symbol, name);
    }
    for (const e of entries) {
      const sym = e.symbol.toUpperCase();
      if (/^[A-Z0-9]{2,10}$/.test(sym)) symbols.add(sym);
      for (const name of e.names) if (/\s/.test(name.trim())) add(sym, name.replace(/^=/, ''));
    }
    for (const [sym, aliases] of Object.entries(userAliases)) {
      const s = sym.toUpperCase();
      symbols.add(s);
      for (const a of aliases) add(s, a.replace(/^=/, ''), true);
    }
    this.symbols = symbols;
    const bounded = (alt: string) => `(?<![\\p{L}\\p{N}])(?:${alt})(?![\\p{L}\\p{N}])`;
    this.nameMatchers = [...names.values()]
      .map((d) => ({
        symbol: d.symbol,
        len: d.name.length,
        re: d.caseSensitive
          ? new RegExp(bounded(`${escapeRe(d.name)}|${escapeRe(d.name.toUpperCase())}`), 'gu')
          : new RegExp(bounded(escapeRe(d.name)), 'giu'),
      }))
      .sort((a, b) => b.len - a.len);
    this.userSymbols = new Set(Object.keys(userAliases).map((s) => s.toUpperCase()));
  }

  detect(text: string): string[] {
    const found = new Set<string>();
    const used: [number, number][] = [];
    const overlaps = (s: number, e: number) => used.some(([a, b]) => s < b && e > a);
    // 1) names, longest first, each span consumed once ("Bitcoin Cash" before "Bitcoin")
    for (const m of this.nameMatchers) {
      m.re.lastIndex = 0;
      for (let r = m.re.exec(text); r; r = m.re.exec(text)) {
        const s = r.index;
        const e = s + r[0].length;
        if (overlaps(s, e)) continue;
        used.push([s, e]);
        found.add(m.symbol);
      }
    }
    // 2) $tickers in any case
    for (const r of text.matchAll(/\$([A-Za-z][A-Za-z0-9]{1,9})\b/g)) {
      const sym = (r[1] as string).toUpperCase();
      if (this.symbols.has(sym)) found.add(sym);
    }
    // 3) bare upper-case tickers with word boundaries — skipped for ALL-CAPS text ("JUST IN: …"),
    //    where every upper-case word would look like a ticker.
    const letters = text.replace(/[^\p{L}]/gu, '');
    const upper = letters.replace(/[^\p{Lu}]/gu, '').length;
    if (letters.length >= 12 && upper / letters.length > 0.6) return [...found].sort();
    for (const r of text.matchAll(/(?<![A-Za-z0-9$])([A-Z][A-Z0-9]{1,9})(?![A-Za-z0-9])/g)) {
      const sym = r[1] as string;
      const s = r.index ?? 0;
      if (overlaps(s, s + sym.length)) continue;
      if (!this.symbols.has(sym)) continue;
      if (!this.userSymbols.has(sym) && (SYMBOL_BLACKLIST.has(sym) || sym.length < 3)) continue;
      found.add(sym);
    }
    return [...found].sort();
  }
}
