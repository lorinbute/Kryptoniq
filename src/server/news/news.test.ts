import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { testDb } from '../test/db.ts';
import { classify } from './classify.ts';
import { findCluster, jaccard, titleTokens } from './cluster.ts';
import { CoinDetector, detectCoins } from './coins.ts';
import { backoffMs, FETCH_INTERVAL_MS, MAX_BACKOFF_MS } from './fetcher.ts';
import { ingestItems, newsId } from './ingest.ts';
import { canonicalUrl, effectivePublishedAt, MAX_ITEM_AGE_MS, parseFeedDate, safeHttpUrl, toPlainText } from './normalize.ts';
import { FeedParseError, parseFeed, type ParsedItem } from './parser.ts';
import { nasdaqFeedUrl, seedSources, syncStockSources } from './sources.ts';
import { newsQuerySchema } from './query.ts';

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), 'utf8');

describe('parseFeed', () => {
  it('parses a real CoinDesk RSS feed (CDATA titles, media, categories)', () => {
    const items = parseFeed(fixture('coindesk.xml'));
    expect(items).toHaveLength(2);
    for (const it of items) {
      expect(it.title.length).toBeGreaterThan(10);
      expect(it.title).not.toMatch(/<|CDATA/);
      expect(it.link).toMatch(/^https:\/\/www\.coindesk\.com\//);
      expect(it.publishedAt).toBeGreaterThan(Date.parse('2026-01-01'));
      expect(it.guid).toBeTruthy();
    }
  });

  it('parses RSS with BOM, CDATA pubDate and attributes on guid', () => {
    const xml = `\uFEFF<?xml version="1.0" encoding="utf-8" ?><rss version="2.0"><channel><title>FRB</title>
      <item><title>Federal Reserve Board announces &amp; approves</title>
      <link><![CDATA[https://www.federalreserve.gov/x.htm]]></link>
      <guid isPermaLink="false">abc-1</guid>
      <description><![CDATA[<p>Hello <b>world</b> &nbsp;&#x2019;s</p>]]></description>
      <pubDate><![CDATA[Fri, 9 Oct 2026 14:00:00 GMT]]></pubDate></item></channel></rss>`;
    const [it] = parseFeed(xml);
    expect(it).toEqual<ParsedItem>({
      guid: 'abc-1',
      link: 'https://www.federalreserve.gov/x.htm',
      title: 'Federal Reserve Board announces & approves',
      summary: 'Hello world ’s',
      publishedAt: Date.parse('2026-10-09T14:00:00Z'),
    });
  });

  it('parses Atom entries (alternate link, updated date)', () => {
    const xml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>t</title>
      <entry><title type="html">Bitcoin &lt;b&gt;rallies&lt;/b&gt;</title><id>tag:x,1</id>
      <link rel="self" href="https://x.com/self"/><link rel="alternate" href="https://x.com/a"/>
      <updated>2026-10-12T10:00:00Z</updated><summary>Sum</summary></entry></feed>`;
    const [it] = parseFeed(xml);
    expect(it).toMatchObject({ title: 'Bitcoin rallies', link: 'https://x.com/a', guid: 'tag:x,1', publishedAt: Date.parse('2026-10-12T10:00:00Z') });
  });

  it('parses RSS 1.0 / RDF with dc:date', () => {
    const xml = `<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <item rdf:about="https://x.com/1"><title>One</title><link>https://x.com/1</link><dc:date>2026-10-12T08:00:00+02:00</dc:date></item></rdf:RDF>`;
    const [it] = parseFeed(xml);
    expect(it).toMatchObject({ title: 'One', link: 'https://x.com/1', publishedAt: Date.parse('2026-10-12T06:00:00Z') });
  });

  it('rejects HTML pages (e.g. Cloudflare challenge) and non-XML bodies', () => {
    expect(() => parseFeed('<!DOCTYPE html><html><head><title>Attention Required!</title></head></html>')).toThrow(FeedParseError);
    expect(() => parseFeed('{"a":1}')).toThrow(/nu este XML/);
    expect(() => parseFeed('<?xml version="1.0"?><foo/>')).toThrow(/nu este un feed/);
  });

  it('does not expand DOCTYPE entities', () => {
    const xml = `<?xml version="1.0"?><!DOCTYPE rss [<!ENTITY a "AAAAAAAAAA"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;">]>
      <rss><channel><item><title>x &b; y</title></item></channel></rss>`;
    const items = parseFeed(xml);
    expect(items[0]?.title ?? '').not.toContain('AAAAAAAAAA');
  });

  it('skips items without a title and drops unsafe links', () => {
    const xml = `<rss><channel><item><title></title></item><item><title>Ok</title><link>javascript:alert(1)</link></item></channel></rss>`;
    const items = parseFeed(xml);
    expect(items).toHaveLength(1);
    expect(items[0]!.link).toBeNull();
  });
});

describe('normalize', () => {
  it('toPlainText strips markup, scripts and double-escaped entities', () => {
    expect(toPlainText('<p>A<script>alert(1)</script> <b>B</b>&amp;amp; C</p>')).toBe('A B & C');
    expect(toPlainText('&lt;img src=x onerror=alert(1)&gt;Hi')).toBe('Hi');
    expect(toPlainText(undefined)).toBe('');
  });
  it('canonicalUrl removes tracking params, fragment, www and trailing slash', () => {
    expect(canonicalUrl('http://WWW.Example.com/a/b/?utm_source=x&id=2&fbclid=y#frag')).toBe('https://example.com/a/b?id=2');
    expect(canonicalUrl('ftp://x.com/a')).toBeNull();
    expect(safeHttpUrl('https://user:pass@x.com')).toBeNull();
  });
  it('parseFeedDate handles RFC 822, ISO and naive UTC formats', () => {
    expect(parseFeedDate('Mon, 12 Oct 2026 14:18:49 +0000')).toBe(Date.parse('2026-10-12T14:18:49Z'));
    expect(parseFeedDate('Mon, 12 Oct 2026 12:20 GMT')).toBe(Date.parse('2026-10-12T12:20:00Z'));
    expect(parseFeedDate('2026-10-12 16:00:43')).toBe(Date.parse('2026-10-12T16:00:43Z'));
    expect(parseFeedDate('Mon, 12 Oct 2026 12:01:26 -0400')).toBe(Date.parse('2026-10-12T16:01:26Z'));
    expect(parseFeedDate('garbage')).toBeNull();
  });
  it('effectivePublishedAt clamps future dates and rejects stale items', () => {
    const now = Date.parse('2026-10-12T12:00:00Z');
    expect(effectivePublishedAt(null, now)).toBe(now);
    expect(effectivePublishedAt(now + 3600_000, now)).toBe(now);
    expect(effectivePublishedAt(now + 60_000, now)).toBe(now + 60_000);
    expect(effectivePublishedAt(now - MAX_ITEM_AGE_MS - 1, now)).toBeNull();
    expect(effectivePublishedAt(now - 1000, now)).toBe(now - 1000);
  });
});

describe('CoinDetector', () => {
  const det = new CoinDetector(
    [
      { symbol: 'PEPE', names: ['Pepe'] },
      { symbol: 'ONE', names: ['Harmony'] },
      { symbol: 'S', names: ['Sonic'] },
    ],
    { ARB: [], RNDR: ['Render Network'] },
  );
  it('detects names and tickers, longest name first', () => {
    expect(det.detect('Bitcoin Cash jumps while Bitcoin stalls')).toEqual(['BCH', 'BTC']);
    expect(det.detect('Ethereum Classic is not Ethereum')).toEqual(['ETC', 'ETH']);
    expect(det.detect('SOL and $eth rally')).toEqual(['ETH', 'SOL']);
  });
  it('ignores blacklisted words, lowercase tickers and ambiguous names', () => {
    expect(det.detect('CEO says the SEC ETF decision is near')).toEqual([]);
    expect(det.detect('ONE more thing about GAS prices')).toEqual([]);
    expect(det.detect('Click the link to see pepe memes')).toEqual([]);
    expect(det.detect('NEAR and LINK pump')).toEqual(['LINK', 'NEAR']);
  });
  it('ignores single-word CoinGecko names that are ordinary words, keeps multi-word ones', () => {
    const d = new CoinDetector([
      { symbol: 'CORE', names: ['Core'] },
      { symbol: 'WBTC', names: ['Wrapped Bitcoin'] },
    ]);
    expect(d.detect('Core inflation rises in September')).toEqual([]);
    expect(d.detect('Wrapped Bitcoin supply shrinks')).toEqual(['WBTC']);
  });
  it('does not treat words of ALL-CAPS headlines as tickers', () => {
    const d = new CoinDetector([{ symbol: 'TRUMP', names: [] }, { symbol: 'NEWS', names: [] }]);
    expect(d.detect('JUST IN: TRUMP SAYS NEW TARIFFS COMING')).toEqual([]);
    expect(d.detect('JUST IN: BITCOIN BREAKS $90,000')).toEqual(['BTC']);
    expect(detectCoins(d, 'BREAKING: SOL ETF APPROVED', 'Analysts expect SOL inflows.')).toEqual(['SOL']);
  });
  it('word-like names (Ripple, Tether) are case-sensitive; asset names are not', () => {
    const d = new CoinDetector([]);
    expect(d.detect('Ripple wins case')).toEqual(['XRP']);
    expect(d.detect('The ripple effects of tariffs')).toEqual([]);
    expect(d.detect('the price of bitcoin rose')).toEqual(['BTC']);
  });
  it('honours watchlist tickers and aliases', () => {
    expect(det.detect('ARB unlock next week')).toEqual(['ARB']);
    expect(det.detect('Render Network adds GPUs')).toEqual(['RNDR']);
  });
});

describe('clustering', () => {
  it('tokenises titles without stopwords and joins near-duplicates', () => {
    const a = titleTokens('Bitcoin surges past $80,000 as ETF inflows hit record');
    const b = titleTokens('Bitcoin Surges Past $80,000 on Record ETF Inflows');
    expect(jaccard(a, b)).toBeGreaterThanOrEqual(0.5);
    expect(findCluster(b, ['BTC'], [{ id: '1', clusterId: 'c1', tokens: a, coins: ['BTC'] }])).toBe('c1');
  });
  it('keeps unrelated stories apart', () => {
    const a = titleTokens('Bitcoin surges past $80,000 as ETF inflows hit record');
    const c = titleTokens('Solana network suffers outage for five hours');
    expect(findCluster(c, ['SOL'], [{ id: '1', clusterId: 'c1', tokens: a, coins: ['BTC'] }])).toBeNull();
  });
  it('uses the shared number + same coins rule for moderately similar titles', () => {
    const a = titleTokens('Exchange hacked for $200 million in ETH');
    const b = titleTokens('$200 million drained from exchange hot wallet, ETH stolen');
    expect(findCluster(b, ['ETH'], [{ id: '1', clusterId: 'c1', tokens: a, coins: ['ETH'] }])).toBe('c1');
  });
});

describe('classify', () => {
  it('scores impact and relevance', () => {
    expect(classify('crypto', 'Fed cuts rates by 50 bps', '', [])).toMatchObject({ relevance: 1, impact: 3 });
    expect(classify('crypto', 'Bitcoin steady near $82K', '', ['BTC'])).toMatchObject({ impact: 2 });
    expect(classify('crypto', 'Solana TVL climbs', '', ['SOL'])).toMatchObject({ impact: 1.5 });
    expect(classify('crypto', 'Small token lists on DEX', '', ['XYZ'])).toMatchObject({ impact: 1 });
    expect(classify('macro', 'How to save for retirement', '', [])).toMatchObject({ relevance: 0.8 });
    expect(classify('macro', 'Stocks rally on earnings', '', [])).toMatchObject({ relevance: 1 });
  });
  it('geopolitics counts only with market-moving terms', () => {
    expect(classify('geopolitics', 'Royal wedding draws crowds', '', [])).toMatchObject({ relevance: 0, flags: ['lowRelevance'] });
    expect(classify('geopolitics', 'Missile strikes hit oil facilities', '', [])).toMatchObject({ relevance: 0.8, impact: 2 }); // 0.6 before FD-IMPACT
    expect(classify('geopolitics', 'US-Iran war escalates', '', []).impact).toBe(3);
  });
  it('flags sponsored, speculative and recap pieces', () => {
    expect(classify('crypto', 'XYZ token could soar 100x, analysts say', 'Sponsored content', []).flags).toEqual(['sponsored', 'speculative']);
    expect(classify('crypto', 'Weekly recap: ETH upgrade', '', []).flags).toEqual(['recap']);
    expect(classify('crypto', 'Will Bitcoin hit $100K this year?', '', []).flags).toContain('speculative');
  });
});

describe('ingest', () => {
  const det = new CoinDetector([]);
  const mk = (title: string, link: string, publishedAt: number | null = Date.parse('2026-10-12T10:00:00Z'), guid: string | null = null): ParsedItem => ({
    guid,
    link,
    title,
    summary: '',
    publishedAt,
  });
  const now = Date.parse('2026-10-12T12:00:00Z');

  async function setup() {
    const db = await testDb();
    await seedSources(db);
    return db;
  }

  it('inserts, dedups by id and canonical URL, tags coins and clusters stories', async () => {
    const db = await setup();
    const r1 = await ingestItems(db, { id: 'coindesk', category: 'crypto' }, [mk('Bitcoin surges past $80,000 as ETF inflows hit record', 'https://a.com/1?utm_source=x')], det, now);
    expect(r1).toEqual({ inserted: 1, updated: 0, skipped: 0 });
    // same article again (same source), and the same URL from another source
    const r2 = await ingestItems(db, { id: 'coindesk', category: 'crypto' }, [mk('Bitcoin surges past $80,000 as ETF inflows hit record', 'https://a.com/1')], det, now);
    expect(r2.inserted).toBe(0);
    const r3 = await ingestItems(db, { id: 'decrypt', category: 'crypto' }, [mk('Different title', 'https://www.a.com/1/')], det, now);
    expect(r3.inserted).toBe(0);
    // same story, other outlet → same cluster
    await ingestItems(db, { id: 'decrypt', category: 'crypto' }, [mk('Bitcoin Surges Past $80,000 on Record ETF Inflows', 'https://b.com/2')], det, now);
    const rows = await db.all<{ cluster_id: string; title: string }>('SELECT cluster_id, title FROM news ORDER BY fetched_at, id');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.cluster_id).toBe(rows[1]!.cluster_id);
    expect(await db.all('SELECT coin FROM news_coins ORDER BY news_id, coin')).toEqual([{ coin: 'BTC' }, { coin: 'BTC' }]);
  });

  it('a changed title resets the sentiment for rescoring', async () => {
    const db = await setup();
    const item = mk('Old title', 'https://a.com/x', Date.parse('2026-10-12T10:00:00Z'), 'g1');
    await ingestItems(db, { id: 'coindesk', category: 'crypto' }, [item], det, now);
    await db.run("UPDATE news SET sentiment = 0.5, sentiment_label = 'positive', sentiment_engine = 'local'");
    const r = await ingestItems(db, { id: 'coindesk', category: 'crypto' }, [{ ...item, title: 'New title about Ethereum' }], det, now);
    expect(r.updated).toBe(1);
    const row = await db.get<{ title: string; sentiment: number | null; sentiment_engine: string | null }>('SELECT title, sentiment, sentiment_engine FROM news');
    expect(row).toEqual({ title: 'New title about Ethereum', sentiment: null, sentiment_engine: null });
    expect(await db.all('SELECT coin FROM news_coins ORDER BY news_id, coin')).toEqual([{ coin: 'ETH' }]);
  });

  it('rejects stale items and clamps future dates', async () => {
    const db = await setup();
    const r = await ingestItems(
      db,
      { id: 'coindesk', category: 'crypto' },
      [mk('Stale', 'https://a.com/s', now - 4 * 86_400_000), mk('Future', 'https://a.com/f', now + 86_400_000), mk('Undated', 'https://a.com/u', null)],
      det,
      now,
    );
    expect(r).toEqual({ inserted: 2, updated: 0, skipped: 1 });
    expect(await db.all('SELECT published_at FROM news')).toEqual([{ published_at: now }, { published_at: now }]);
  });

  it('newsId prefers guid, then canonical URL, then title', () => {
    expect(newsId('s', { guid: 'g', link: 'https://a.com', title: 't' })).not.toBe(newsId('s', { guid: null, link: 'https://a.com', title: 't' }));
    expect(newsId('s', { guid: null, link: 'https://a.com/?utm_source=1', title: 'x' })).toBe(newsId('s', { guid: null, link: 'https://www.a.com', title: 'y' }));
  });

  it('seeding keeps a custom source that already uses a built-in URL', async () => {
    const db = await testDb();
    await db.run("INSERT INTO sources(id, name, url, category) VALUES ('mine', 'Mine', 'https://cointelegraph.com/rss', 'crypto')");
    await seedSources(db);
    expect(await db.get("SELECT count(*) AS n FROM sources WHERE url = 'https://cointelegraph.com/rss'")).toEqual({ n: 1 });
    expect(await db.get("SELECT id FROM sources WHERE id = 'cointelegraph'")).toBeUndefined();
  });
});

describe('stocks in the news (FD-SENTIQ §4.4)', () => {
  const det = new CoinDetector([{ symbol: 'AAPL', names: ['Apple Token Network'] }], { SOL: [] }, { AAPL: ['Apple'], NVDA: ['NVIDIA'], 'BRK.B': ['Berkshire Hathaway'], F: ['Ford Motor'], AI: ['C3.ai'], META: ['Meta Platforms', 'Meta'], TGT: ['Target'], NOW: ['ServiceNow'] });
  const tags = (t: string) => detectCoins(det, t, '');

  it('finds a company by its name in its own case, in capitals or in Title Case, never in lower case', () => {
    expect(tags('Apple unveils a new iPhone')).toEqual(['AAPL']);
    expect(tags('an apple a day')).toEqual([]);
    expect(tags('Nvidia beats estimates')).toEqual(['NVDA']);
    expect(tags('Retailers hit their target')).toEqual([]);
    expect(tags('Target lifts guidance')).toEqual(['TGT']);
  });

  it('accepts $TICKER and (EXCHANGE: TICKER) always, bare tickers only outside the plain-word list', () => {
    expect(tags('Ford (NYSE: F) recalls trucks')).toEqual(['F']);
    expect(tags('BRK.B and $F rally')).toEqual(['BRK.B', 'F']);
    expect(tags('Berkshire Hathaway (NYSE:BRK.B) buys more')).toEqual(['BRK.B']);
    expect(tags('AI stocks soar as investors pile in')).toEqual([]);
    expect(tags('$AI jumps after earnings')).toEqual(['AI']);
    // "NOW" is a plain word: the ServiceNow ticker counts only as $NOW or after an exchange.
    expect(tags('Stocks to buy NOW, analysts say')).toEqual([]);
    expect(tags('ServiceNow (NYSE: NOW) beats')).toEqual(['NOW']);
    // The company name in capitals still counts.
    expect(tags('META hits a record')).toEqual(['META']);
    expect(tags('Shares of NVDA slide')).toEqual(['NVDA']);
    // ALL-CAPS headlines: no bare tickers, names still count.
    expect(tags('JUST IN: APPLE AND NVDA SURGE TODAY')).toEqual(['AAPL']);
  });

  it('stock index tickers are not coins, unless the user follows that coin', () => {
    const d = new CoinDetector([{ symbol: 'SPX', names: ['SPX6900'] }]);
    expect(detectCoins(d, 'Stocks settle lower', 'The S&P 500 Index ($SPX) closed down 0.05%')).toEqual([]);
    const mine = new CoinDetector([{ symbol: 'SPX', names: ['SPX6900'] }], { SPX: [] });
    expect(detectCoins(mine, 'Traders pile into $SPX', '')).toEqual(['SPX']);
  });

  it('indices by their aliases, tagged with their id, before a coin of the same ticker (FD-INDICES)', () => {
    const d = new CoinDetector([{ symbol: 'SPX', names: ['SPX6900'] }], { SPX: [] }, {}, { '^SPX': ['S&P 500', 'S&P500', 'SPX'], '^DJI': ['Dow Jones', 'DJIA'], '^VIX': ['VIX', 'volatility index'] });
    expect(detectCoins(d, 'S&P 500 closes at a record', '')).toEqual(['^SPX']);
    // The user follows SPX6900 too: a bare "SPX" is the index's alias, matched first.
    expect(detectCoins(d, 'SPX slips as yields rise', '')).toEqual(['^SPX']);
    expect(detectCoins(d, 'SPX6900 rallies', '')).toEqual([]);
    // "Dow" alone is not an alias (Dow Inc.).
    expect(detectCoins(d, 'Dow Jones drops 400 points; Dow Inc. reports next week', '')).toEqual(['^DJI']);
    expect(detectCoins(d, 'The Volatility Index jumps', '')).toEqual(['^VIX']);
    expect(detectCoins(d, 'a vix of nothing', '')).toEqual([]);
    expect(newsQuerySchema.parse({ coins: '^spx,SOL,^' })).toMatchObject({ coins: ['^SPX', 'SOL'] });
  });

  it('the news filter takes dotted tickers too', () => {
    expect(newsQuerySchema.parse({ coins: 'brk.b,SOL,bad!', category: 'stocks' })).toMatchObject({ coins: ['BRK.B', 'SOL'], category: 'stocks' });
  });

  it('stock news count fully when about a share or the market', () => {
    expect(classify('stocks', 'Apple unveils a new iPhone', '', ['AAPL'])).toMatchObject({ relevance: 1 });
    expect(classify('stocks', 'Stocks settle lower as chipmakers fall', '', [])).toMatchObject({ relevance: 1 });
    expect(classify('stocks', 'Corn gets a dead cat bounce on Monday', '', [])).toMatchObject({ relevance: 0.8 });
  });

  it('keeps one Nasdaq feed per watchlist stock and deletes it, with its news, once nobody follows the stock (FD-AUTOFEED)', async () => {
    const db = await testDb();
    await seedSources(db);
    expect(await db.all("SELECT id FROM sources WHERE category = 'stocks' ORDER BY id")).toEqual([{ id: 'cnbc-business' }, { id: 'investing-stocks' }, { id: 'nasdaq-stocks' }]);
    const add = (coin: string, userId = 1) => db.run("INSERT INTO watchlist(user_id, coin, quote, position, aliases, added_at, kind) VALUES (?, ?, 'USD', 0, '[]', 1, 'stock')", [userId, coin]);
    await add('AAPL');
    await add('BRK.B');
    expect(await syncStockSources(db, 'AAPL')).toEqual([]);
    expect(await db.all("SELECT id, url, auto, enabled, builtin FROM sources WHERE auto IS NOT NULL ORDER BY id")).toEqual([
      { id: 'nasdaq-aapl', url: nasdaqFeedUrl('AAPL'), auto: 'nasdaq:AAPL', enabled: 1, builtin: 1 },
      { id: 'nasdaq-brk-b', url: 'https://www.nasdaq.com/feed/rssoutbound?symbol=BRK.B', auto: 'nasdaq:BRK.B', enabled: 1, builtin: 1 },
    ]);
    // The admin switched AAPL's feed off: it stays off while AAPL is followed, unless AAPL is added again.
    await db.run("UPDATE sources SET enabled = 0 WHERE id = 'nasdaq-aapl'");
    await syncStockSources(db);
    expect(await db.get("SELECT enabled FROM sources WHERE id = 'nasdaq-aapl'")).toEqual({ enabled: 0 });
    await syncStockSources(db, 'AAPL');
    expect(await db.get("SELECT enabled FROM sources WHERE id = 'nasdaq-aapl'")).toEqual({ enabled: 1 });
    // Another user follows AAPL too: the feed stays until neither does.
    await db.run("INSERT INTO users(email, name, role, created_at) VALUES ('ana@example.com', 'Ana', 'user', 1)");
    const other = (await db.get<{ id: number }>("SELECT id FROM users WHERE email = 'ana@example.com'"))!.id;
    await add('AAPL', other);
    await db.run("INSERT INTO news(id, source_id, title, published_at, fetched_at, category, relevance, impact, cluster_id) VALUES ('n1', 'nasdaq-aapl', 'Apple', 1, 1, 'stocks', 1, 1, 'c1')");
    await db.run("INSERT INTO news_coins(news_id, coin) VALUES ('n1', 'AAPL')");
    await db.run("DELETE FROM watchlist WHERE user_id = 1 AND coin IN ('AAPL', 'BRK.B')");
    expect(await syncStockSources(db)).toEqual(['BRK.B']);
    expect(await db.all('SELECT id, enabled FROM sources WHERE auto IS NOT NULL')).toEqual([{ id: 'nasdaq-aapl', enabled: 1 }]);
    // Nobody follows it any more: the feed goes at once, with its news (even though it has some).
    await db.run('DELETE FROM watchlist WHERE user_id = ?', [other]);
    expect(await syncStockSources(db)).toEqual(['AAPL']);
    expect(await db.all('SELECT id FROM sources WHERE auto IS NOT NULL')).toEqual([]);
    expect(await db.all("SELECT id FROM news WHERE id = 'n1'")).toEqual([]);
    expect(await db.all("SELECT news_id FROM news_coins WHERE news_id = 'n1'")).toEqual([]);
  });

  it('deletes a feed left switched off by the old rule (FD-AUTOFEED §2: BSOL)', async () => {
    const db = await testDb();
    await db.run("INSERT INTO sources(id, name, url, category, enabled, weight, builtin, auto) VALUES ('nasdaq-bsol', 'Nasdaq: BSOL', ?, 'stocks', 0, 1, 1, 'nasdaq:BSOL')", [nasdaqFeedUrl('BSOL')]);
    await db.run("INSERT INTO news(id, source_id, title, published_at, fetched_at, category, relevance, impact, cluster_id) VALUES ('b1', 'nasdaq-bsol', 'Bitwise Solana', 1, 1, 'stocks', 1, 1, 'c9')");
    expect(await syncStockSources(db)).toEqual(['BSOL']);
    expect(await db.all("SELECT id FROM sources WHERE id = 'nasdaq-bsol'")).toEqual([]);
    expect(await db.all("SELECT id FROM news WHERE id = 'b1'")).toEqual([]);
    expect(await syncStockSources(db)).toEqual([]);
  });

  it('does not duplicate a feed the user already added by hand', async () => {
    const db = await testDb();
    await db.run("INSERT INTO sources(id, name, url, category) VALUES ('mine', 'Apple news', ?, 'stocks')", [nasdaqFeedUrl('AAPL')]);
    await db.run("INSERT INTO watchlist(coin, quote, position, aliases, added_at, kind) VALUES ('AAPL', 'USD', 0, '[]', 1, 'stock')");
    await syncStockSources(db, 'AAPL');
    expect(await db.all('SELECT id FROM sources')).toEqual([{ id: 'mine' }]);
    // Not an automatic feed: it stays when the stock leaves the watchlist.
    await db.run("DELETE FROM watchlist WHERE coin = 'AAPL'");
    expect(await syncStockSources(db)).toEqual([]);
    expect(await db.all('SELECT id FROM sources')).toEqual([{ id: 'mine' }]);
  });
});

describe('fetch backoff', () => {
  it('doubles from 5 minutes up to 60', () => {
    expect([1, 2, 3, 4, 5, 9].map(backoffMs)).toEqual([FETCH_INTERVAL_MS, 2 * FETCH_INTERVAL_MS, 4 * FETCH_INTERVAL_MS, 8 * FETCH_INTERVAL_MS, MAX_BACKOFF_MS, MAX_BACKOFF_MS]);
  });
});
