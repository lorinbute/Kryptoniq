// Built-in news sources (verified live on 2026-10-12, see docs/research.md §1).
import type { Db } from '../db/database.ts';

export type SourceCategory = 'crypto' | 'macro' | 'geopolitics' | 'stocks';

export interface SourceDef {
  id: string;
  name: string;
  url: string;
  category: SourceCategory;
  weight: number;
  enabled?: boolean;
}

export const BUILTIN_SOURCES: SourceDef[] = [
  // Crypto
  { id: 'coindesk', name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss', category: 'crypto', weight: 1.2 },
  { id: 'cointelegraph', name: 'Cointelegraph', url: 'https://cointelegraph.com/rss', category: 'crypto', weight: 1 },
  { id: 'theblock', name: 'The Block', url: 'https://www.theblock.co/rss.xml', category: 'crypto', weight: 1.2 },
  { id: 'decrypt', name: 'Decrypt', url: 'https://decrypt.co/feed', category: 'crypto', weight: 1 },
  { id: 'cryptoslate', name: 'CryptoSlate', url: 'https://cryptoslate.com/feed/', category: 'crypto', weight: 0.9 },
  { id: 'beincrypto', name: 'BeInCrypto', url: 'https://beincrypto.com/feed/', category: 'crypto', weight: 0.8 },
  { id: 'watcherguru', name: 'Watcher.Guru', url: 'https://watcher.guru/news/feed', category: 'crypto', weight: 0.9 },
  { id: 'utoday', name: 'U.Today', url: 'https://u.today/rss', category: 'crypto', weight: 0.6 },
  { id: 'newsbtc', name: 'NewsBTC', url: 'https://www.newsbtc.com/feed/', category: 'crypto', weight: 0.6 },
  // Macro / markets
  { id: 'cnbc-top', name: 'CNBC Top News', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', category: 'macro', weight: 1 },
  { id: 'cnbc-economy', name: 'CNBC Economy', url: 'https://www.cnbc.com/id/20910258/device/rss/rss.html', category: 'macro', weight: 1.1 },
  { id: 'cnbc-finance', name: 'CNBC Finance', url: 'https://www.cnbc.com/id/10000664/device/rss/rss.html', category: 'macro', weight: 1 },
  { id: 'cnbc-investing', name: 'CNBC Investing', url: 'https://www.cnbc.com/id/15839069/device/rss/rss.html', category: 'macro', weight: 0.8 },
  { id: 'bloomberg-markets', name: 'Bloomberg Markets', url: 'https://feeds.bloomberg.com/markets/news.rss', category: 'macro', weight: 1.2 },
  { id: 'bloomberg-economics', name: 'Bloomberg Economics', url: 'https://feeds.bloomberg.com/economics/news.rss', category: 'macro', weight: 1.2 },
  { id: 'marketwatch', name: 'MarketWatch', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories', category: 'macro', weight: 0.9 },
  { id: 'ft-markets', name: 'FT Markets', url: 'https://www.ft.com/markets?format=rss', category: 'macro', weight: 1.1 },
  { id: 'seekingalpha', name: 'Seeking Alpha Market Currents', url: 'https://seekingalpha.com/market_currents.xml', category: 'macro', weight: 0.8 },
  { id: 'fxstreet', name: 'FXStreet', url: 'https://www.fxstreet.com/rss/news', category: 'macro', weight: 0.8 },
  { id: 'investinglive', name: 'InvestingLive', url: 'https://investinglive.com/feed/', category: 'macro', weight: 0.9 },
  { id: 'investing', name: 'Investing.com', url: 'https://www.investing.com/rss/news.rss', category: 'macro', weight: 0.8 },
  { id: 'fed', name: 'Federal Reserve', url: 'https://www.federalreserve.gov/feeds/press_all.xml', category: 'macro', weight: 1.3 },
  { id: 'sec', name: 'SEC Press Releases', url: 'https://www.sec.gov/news/pressreleases.rss', category: 'macro', weight: 1 },
  // Geopolitics
  { id: 'bbc-world', name: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', category: 'geopolitics', weight: 1 },
  { id: 'bbc-business', name: 'BBC Business', url: 'https://feeds.bbci.co.uk/news/business/rss.xml', category: 'geopolitics', weight: 0.9 },
  { id: 'cnbc-world', name: 'CNBC International', url: 'https://www.cnbc.com/id/100727362/device/rss/rss.html', category: 'geopolitics', weight: 1 },
  { id: 'cnbc-politics', name: 'CNBC Politics & Policy', url: 'https://www.cnbc.com/id/10000113/device/rss/rss.html', category: 'geopolitics', weight: 0.9 },
  { id: 'guardian-economics', name: 'The Guardian Economics', url: 'https://www.theguardian.com/business/economics/rss', category: 'geopolitics', weight: 0.8 },
  // Stocks (FD-SENTIQ §4.4, docs/research.md §8)
  { id: 'nasdaq-stocks', name: 'Nasdaq Stocks', url: 'https://www.nasdaq.com/feed/rssoutbound?category=Stocks', category: 'stocks', weight: 0.9 },
  { id: 'investing-stocks', name: 'Investing.com Stock News', url: 'https://www.investing.com/rss/news_25.rss', category: 'stocks', weight: 0.8 },
  { id: 'cnbc-business', name: 'CNBC Business', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10001147', category: 'stocks', weight: 0.9 },
];

/** The Nasdaq feed of one stock, managed together with the watchlist (`auto = 'nasdaq:AAPL'`). */
export const nasdaqFeedUrl = (sym: string) => `https://www.nasdaq.com/feed/rssoutbound?symbol=${encodeURIComponent(sym)}`;
const autoId = (sym: string) => `nasdaq-${sym.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

/**
 * Keeps one Nasdaq feed per stock in anybody's watchlist. `added` re-enables the feed of a stock the user has just
 * added; otherwise a feed the admin disabled stays disabled. The feed of a stock in nobody's watchlist is deleted
 * at once, with the news that came only through it (FD-AUTOFEED). Returns the symbols whose feed was deleted.
 */
export async function syncStockSources(db: Db, added?: string): Promise<string[]> {
  return db.tx(async () => {
    const stocks = new Set((await db.all<{ coin: string }>("SELECT DISTINCT coin FROM watchlist WHERE kind = N'stock' ORDER BY coin")).map((r) => r.coin));
    const sources = await db.all<{ id: string; url: string; auto: string | null }>('SELECT id, url, auto FROM sources');
    const byAuto = new Map(sources.filter((s) => s.auto).map((s) => [s.auto as string, s.id]));
    const urls = new Set(sources.map((s) => s.url));
    const ids = new Set(sources.map((s) => s.id));
    for (const sym of stocks) {
      const auto = `nasdaq:${sym}`;
      const url = nasdaqFeedUrl(sym);
      const own = byAuto.get(auto);
      if (own) {
        if (sym === added) await db.run('UPDATE sources SET enabled = 1, next_fetch_at = 0 WHERE id = ?', [own]);
        continue;
      }
      // A custom source with the same address already brings this feed.
      if (urls.has(url)) continue;
      let id = autoId(sym);
      if (ids.has(id)) id = `${id}-${Date.now().toString(36)}`;
      await db.run(`INSERT INTO sources(id, name, url, category, enabled, weight, builtin, auto) VALUES (?, ?, ?, N'stocks', 1, 1, 1, ?)`, [id, `Nasdaq: ${sym}`, url, auto]);
      urls.add(url);
      ids.add(id);
    }
    const removed: string[] = [];
    for (const s of sources) {
      if (!s.auto?.startsWith('nasdaq:') || stocks.has(s.auto.slice('nasdaq:'.length))) continue;
      // Its news go too (ON DELETE CASCADE): nobody follows the stock any more.
      await db.run('DELETE FROM sources WHERE id = ?', [s.id]);
      removed.push(s.auto.slice('nasdaq:'.length));
    }
    return removed;
  });
}

/** Inserts missing built-in sources; never overrides the user's enable/weight choices. */
export async function seedSources(db: Db): Promise<void> {
  await db.tx(async () => {
    const byUrl = new Map((await db.all<{ id: string; url: string }>('SELECT id, url FROM sources')).map((r) => [r.url, r.id]));
    for (const s of BUILTIN_SOURCES) {
      // A custom source the user added earlier with the same URL keeps precedence.
      const sameUrl = byUrl.get(s.url);
      if (sameUrl !== undefined && sameUrl !== s.id) continue;
      await db.run(
        `UPDATE sources SET name = @name, url = @url, category = @category, builtin = 1 WHERE id = @id;
         IF @@ROWCOUNT = 0 INSERT INTO sources(id, name, url, category, enabled, weight, builtin) VALUES (@id, @name, @url, @category, @enabled, @weight, 1)`,
        { id: s.id, name: s.name, url: s.url, category: s.category, enabled: s.enabled === false ? 0 : 1, weight: s.weight },
      );
    }
  });
}

/** The columns of `SourceRow` (not the computed `url_hash`, TD-AZURE §3): use instead of `SELECT *`. */
export const SOURCE_COLUMNS =
  'id, name, url, category, categories, read_as, read_url, enabled, weight, builtin, etag, last_modified, last_attempt_at, last_success_at, last_new_item_at, last_error, failures, next_fetch_at, item_count, auto';

export interface SourceRow {
  id: string;
  name: string;
  url: string;
  /** The source's first category (FD-MULTICAT: the only one, or the first of several). */
  category: SourceCategory;
  /** FD-MULTICAT: the categories of a source covering several ("crypto,macro"), in a fixed order; null for one. */
  categories: string | null;
  /** FD-HTMLFEED: how the source is read (`declared`, `sitemap`, `jsonld`, `page`); null: its address is a feed. */
  read_as: string | null;
  /** FD-HTMLFEED: the feed or sitemap then read (for `declared`, `sitemap`). */
  read_url: string | null;
  enabled: number;
  weight: number;
  builtin: number;
  etag: string | null;
  last_modified: string | null;
  last_attempt_at: number | null;
  last_success_at: number | null;
  last_new_item_at: number | null;
  last_error: string | null;
  failures: number;
  next_fetch_at: number;
  item_count: number;
  /** Set on sources the app manages by itself (`nasdaq:AAPL`). */
  auto: string | null;
}
