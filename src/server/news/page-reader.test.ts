// FD-HTMLFEED: reading news out of a site's page, its JSON-LD, its sitemaps and its robots.txt.
import { describe, expect, it } from 'vitest';
import { absoluteUrl, declaredFeeds, isBlocked, jsonLdItems, pageItems, parseRobots, parseSitemap, sameSite, siteOf, urlDate } from './page-reader.ts';

const BASE = 'https://www.example-news.com/markets/';

/** A listing page as CoinDesk / CNBC build them: menus, cards with a <time>, a picture link and a title link, a footer. */
const LISTING = `<!doctype html><html><head><title>Markets</title>
<link rel="alternate" hrefLang="en" href="https://www.example-news.com/markets"/>
<script>var headline = "<a href='/markets/2026/10/20/not-a-headline-from-a-script'>Not a headline from a script at all</a>";</script>
</head><body>
<header><nav><a href="/price/stock">See all US stock prices and much more here</a><a href="/research/exchange-benchmark">Exchange Benchmark the institutional standard</a></nav></header>
<main><h1>Markets</h1>
<div class="grid"><div class="flex">
  <a class="content-card-title" href="/markets/2026/10/20/blackrock-seeks-to-shield-bitcoin-investors"><h2>BlackRock seeks to shield bitcoin investors from losses</h2></a>
  <p>Summary.</p><p><span>By <a href="/author/helene-braun">Helene Braun</a></span><time dateTime="2026-10-20T14:28:39.518Z">1 hour ago</time></p>
  <a title="BlackRock seeks to shield bitcoin investors from losses" href="/markets/2026/10/20/blackrock-seeks-to-shield-bitcoin-investors"><img alt=""/></a>
</div>
<div class="flex">
  <a href="/markets/2026/10/20/jpmorgan-sees-10-annual-bitcoin-returns"><h3>JPMorgan sees 10% annual bitcoin returns, topping stocks &amp; bonds</h3></a>
  <time datetime="2026-10-20T11:10:40Z">4 hours ago</time>
</div></div>
<ul class="river">
  <li><a href="https://www.example-news.com/2026/10/19/coreweave-oracle-ai-credit-stress.html">Stock investors are ready to move on from the AI rout</a></li>
  <li><a href="https://www.example-news.com/2026/10/19/coreweave-oracle-ai-credit-stress.html">Stock investors are ready to move on from the AI rout. Credit investors are not</a></li>
  <li><a href="/markets/">Markets home page link that is long enough</a></li>
  <li><a href="/tag/bitcoin">All the news tagged with the word bitcoin</a></li>
  <li><a href="https://other-site.com/markets/2026/10/20/something-elsewhere-entirely">Something elsewhere entirely on another site</a></li>
  <li><a href="/markets/2026/10/20/short">Too short</a></li>
  <li><a href="#top">Back to the top of this page please</a></li>
</ul>
<p><a href="/markets/live-blog-of-the-day-with-many-words">A link in a paragraph, not a headline anywhere</a></p>
</main>
<footer><a href="/about/careers-at-example-news-and-more">Careers at Example News and so much more</a></footer>
</body></html>`;

describe('the headlines of a listing page', () => {
  it('reads the article links with their headline, the date of their own card, in the page\'s order', () => {
    const items = pageItems(LISTING, BASE);
    expect(items.map((i) => [i.title, i.link, i.publishedAt && new Date(i.publishedAt).toISOString()])).toEqual([
      ['BlackRock seeks to shield bitcoin investors from losses', 'https://www.example-news.com/markets/2026/10/20/blackrock-seeks-to-shield-bitcoin-investors', '2026-10-20T14:28:39.518Z'],
      ['JPMorgan sees 10% annual bitcoin returns, topping stocks & bonds', 'https://www.example-news.com/markets/2026/10/20/jpmorgan-sees-10-annual-bitcoin-returns', '2026-10-20T11:10:40.000Z'],
      // Linked twice: the longer headline; no <time> of its own: the date of its address (noon UTC).
      ['Stock investors are ready to move on from the AI rout. Credit investors are not', 'https://www.example-news.com/2026/10/19/coreweave-oracle-ai-credit-stress.html', '2026-10-19T12:00:00.000Z'],
    ]);
  });

  it('leaves out menus, footers, scripts, lists, other sites, short texts and links outside headings or cards', () => {
    const titles = pageItems(LISTING, BASE).map((i) => i.title).join(' | ');
    for (const no of ['See all US stock prices', 'Exchange Benchmark', 'Careers', 'Not a headline', 'Markets home page', 'tagged', 'elsewhere', 'Too short', 'Back to the top', 'paragraph']) expect(titles).not.toContain(no);
  });

  it('the same headline at two addresses: once, the first', () => {
    const html = `<article><h3><a href="/news/2026/10/20/fed-holds?ref=top">The Fed holds its rates steady again</a></h3></article><article><h3><a href="/news/2026/10/20/fed-holds-rates">The Fed holds its rates steady again</a></h3></article>`;
    expect(pageItems(html, 'https://site.example/').map((i) => i.link)).toEqual(['https://site.example/news/2026/10/20/fed-holds?ref=top']);
  });

  it('a date in a card of several headlines is not theirs (a list, not a card)', () => {
    const html = `<ul class="list"><li><h3><a href="/news/one-two-three-four">One two three four five six</a></h3></li><li><h3><a href="/news/seven-eight-nine-ten">Seven eight nine ten eleven twelve</a></h3></li><time datetime="2026-10-20T09:00:00Z"></time></ul>`;
    expect(pageItems(html, 'https://site.example/').map((i) => i.publishedAt)).toEqual([null, null]);
  });
});

describe('what a page declares', () => {
  it('its feeds (same site only), as absolute addresses', () => {
    const html = `<link rel="alternate" type="application/rss+xml" href="/rss/markets.xml"><link rel="alternate" type="application/atom+xml" href="https://feeds.example-news.com/atom"><link rel="alternate" type="application/rss+xml" href="https://evil.example/feed"><link rel="stylesheet" href="/x.css">`;
    expect(declaredFeeds(html, BASE)).toEqual(['https://www.example-news.com/rss/markets.xml', 'https://feeds.example-news.com/atom']);
  });

  it('the articles of its JSON-LD: an ItemList, a @graph, an article; broken blocks skipped', () => {
    const html = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"ItemList","itemListElement":[{"@type":"ListItem","item":{"@type":"NewsArticle","headline":"Fed holds rates steady","url":"/2026/10/20/fed","datePublished":"2026-10-20T18:00:00Z"}}]}</script>
<script type="application/ld+json">{"@graph":[{"@type":"WebPage","name":"Markets"},{"@type":["Article"],"headline":"Oil jumps on supply fears","mainEntityOfPage":{"@id":"https://www.example-news.com/2026/10/20/oil"}}]}</script>
<script type="application/ld+json">{ broken </script>`;
    expect(jsonLdItems(html, BASE)).toEqual([
      { guid: 'https://www.example-news.com/2026/10/20/fed', link: 'https://www.example-news.com/2026/10/20/fed', title: 'Fed holds rates steady', summary: '', publishedAt: Date.parse('2026-10-20T18:00:00Z') },
      { guid: 'https://www.example-news.com/2026/10/20/oil', link: 'https://www.example-news.com/2026/10/20/oil', title: 'Oil jumps on supply fears', summary: '', publishedAt: null },
    ]);
  });
});

describe('sitemaps', () => {
  it('an index: its sitemaps, newest first', () => {
    const xml = `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://x.com/old.xml</loc><lastmod>2026-10-19T10:00:00Z</lastmod></sitemap><sitemap><loc>https://x.com/new.xml</loc><lastmod>2026-10-20T15:57:04Z</lastmod></sitemap></sitemapindex>`;
    expect(parseSitemap(xml)).toEqual({ kind: 'index', children: ['https://x.com/new.xml', 'https://x.com/old.xml'] });
  });

  it('a news sitemap (as Reuters\' and Benzinga\'s): address, title and publication time', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"><url><loc>https://x.com/business/ferragamo-revenue-falls-2026-10-20/</loc><lastmod>2026-10-20T15:59:14.737Z</lastmod><news:news><news:publication><news:name>X</news:name></news:publication><news:publication_date>2026-10-20T15:59:09.29Z</news:publication_date><news:title>Ferragamo third-quarter revenue falls &amp; wholesale drops</news:title></news:news></url><url><loc>https://x.com/page-without-news</loc></url></urlset>`;
    expect(parseSitemap(xml)).toEqual({
      kind: 'urls',
      untitled: 1,
      items: [{ guid: 'https://x.com/business/ferragamo-revenue-falls-2026-10-20/', link: 'https://x.com/business/ferragamo-revenue-falls-2026-10-20/', title: 'Ferragamo third-quarter revenue falls & wholesale drops', summary: '', publishedAt: Date.parse('2026-10-20T15:59:09.29Z') }],
    });
  });

  it('a page, a feed or broken XML is no sitemap', () => {
    expect(parseSitemap('<html><body>x</body></html>')).toBeNull();
    expect(parseSitemap('<?xml version="1.0"?><rss><channel></channel></rss>')).toBeNull();
    expect(parseSitemap('<?xml version="1.0"?><urlset><url><loc>')).not.toEqual(expect.objectContaining({ kind: 'index' }));
  });
});

describe('robots.txt', () => {
  it('reads the group of every reader (*), its sitemaps, the longest rule winning', () => {
    const r = parseRobots(`# notice
User-agent: Googlebot
User-agent: Bingbot
Disallow: /search

User-agent: *
Allow: /plus/
Disallow: /
Allow: /markets/live$

SITEMAP: https://x.com/news-sitemap-index.xml
Sitemap: https://x.com/sitemap.xml`);
    expect(r.sitemaps).toEqual(['https://x.com/news-sitemap-index.xml', 'https://x.com/sitemap.xml']);
    expect(r.disallowed('/markets/')).toBe(true);
    expect(r.disallowed('/plus/story')).toBe(false);
    expect(r.disallowed('/markets/live')).toBe(false);
    expect(r.disallowed('/markets/live/2')).toBe(true);
  });

  it('nothing for every reader: all allowed; wildcards in the middle', () => {
    expect(parseRobots('User-agent: Googlebot\nDisallow: /').disallowed('/x')).toBe(false);
    const r = parseRobots('User-agent: *\nDisallow: /*/widgets/\nDisallow: /search?q=*');
    expect(r.disallowed('/a/widgets/b')).toBe(true);
    expect(r.disallowed('/search?q=btc')).toBe(true);
    expect(r.disallowed('/markets/x')).toBe(false);
  });
});

describe('small parts', () => {
  it('a blocked page: a refusal, or a bot challenge', () => {
    expect(isBlocked(403, '')).toBe(true);
    expect(isBlocked(401, '')).toBe(true);
    expect(isBlocked(200, '<!DOCTYPE html><html><head><title>Just a moment...</title>')).toBe(true);
    expect(isBlocked(200, '<html><head><title>Markets</title>')).toBe(false);
    expect(isBlocked(404, '')).toBe(false);
  });

  it('the same site, addresses, dates in addresses', () => {
    expect(siteOf('www.cnbc.com')).toBe('cnbc.com');
    expect(siteOf('news.bbc.co.uk')).toBe('bbc.co.uk');
    expect(sameSite('https://feeds.cnbc.com/x', 'https://www.cnbc.com/markets/')).toBe(true);
    expect(sameSite('https://evil.example/x', 'https://www.cnbc.com/')).toBe(false);
    expect(absoluteUrl('/a?b=1#c', BASE)).toBe('https://www.example-news.com/a?b=1');
    expect(absoluteUrl('javascript:void(0)', BASE)).toBeNull();
    expect(absoluteUrl('mailto:x@y.z', BASE)).toBeNull();
    expect(urlDate('https://x.com/2026/10/20/story.html')).toBe(Date.UTC(2026, 9, 20, 12));
    expect(urlDate('https://x.com/business/ferragamo-2026-10-20/')).toBe(Date.UTC(2026, 9, 20, 12));
    expect(urlDate('https://x.com/news/20261020/story')).toBe(Date.UTC(2026, 9, 20, 12));
    expect(urlDate('https://x.com/news/story-1234')).toBeNull();
  });
});
