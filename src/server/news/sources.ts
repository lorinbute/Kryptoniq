// Built-in news sources (verified live on 2026-10-12, see docs/research.md §1).
import type { Db } from '../db/database.ts';

export type SourceCategory = 'crypto' | 'macro' | 'geopolitics';

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
];

/** Inserts missing built-in sources; never overrides the user's enable/weight choices. */
export function seedSources(db: Db): void {
  db.tx(() => {
    for (const s of BUILTIN_SOURCES) {
      // A custom source the user added earlier with the same URL keeps precedence.
      const sameUrl = db.get<{ id: string }>('SELECT id FROM sources WHERE url = ?', [s.url]);
      if (sameUrl && sameUrl.id !== s.id) continue;
      db.run(
        `INSERT INTO sources(id, name, url, category, enabled, weight, builtin)
         VALUES (?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, url = excluded.url, category = excluded.category, builtin = 1`,
        [s.id, s.name, s.url, s.category, s.enabled === false ? 0 : 1, s.weight],
      );
    }
  });
}

export interface SourceRow {
  id: string;
  name: string;
  url: string;
  category: SourceCategory;
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
}
