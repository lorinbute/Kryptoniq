// FD-HTMLFEED: how an address is read (feed, declared feed, JSON-LD, headlines, news sitemap), robots.txt obeyed, and
// a page's undated headlines kept out at the first reading.
import { describe, expect, it } from 'vitest';
import { testDb } from '../test/db.ts';
import { CoinDetector } from './coins.ts';
import { fetchSource, seenToday } from './fetcher.ts';
import { readSource, resolveSource, type Fetched, type PageFetch } from './page-feed.ts';
import { SOURCE_COLUMNS, type SourceRow } from './sources.ts';

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>X</title><item><title>Fed holds rates</title><link>https://site.example/a</link><pubDate>Tue, 20 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>`;
const card = (n: number, date?: string) =>
  `<article><h3><a href="/markets/2026/10/20/headline-number-${n}">Headline number ${n} about the markets today</a></h3>${date ? `<time datetime="${date}"></time>` : ''}</article>`;
/** A headline with no date anywhere (none on the page, none in its address). */
const undated = (n: number) => `<article><h3><a href="/markets/headline-number-${n}-about-the-markets">Headline number ${n} about the markets today</a></h3></article>`;
const LISTING = (n: number, dated = true) => `<html><body><main>${Array.from({ length: n }, (_, k) => card(k + 1, dated ? `2026-10-20T0${k}:00:00Z` : undefined)).join('')}</main></body></html>`;
const NEWS_SITEMAP = (paths: string[]) =>
  `<?xml version="1.0"?><urlset xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">${paths
    .map((p, k) => `<url><loc>https://site.example${p}</loc><news:news><news:publication_date>2026-10-20T1${k}:00:00Z</news:publication_date><news:title>Story ${k + 1} from the news sitemap</news:title></news:news></url>`)
    .join('')}</urlset>`;

/** A site: its addresses and their answers; what was asked, in order. */
function site(pages: Record<string, Fetched | string>): PageFetch & { asked: string[] } {
  const asked: string[] = [];
  const f = (async (url: string) => {
    asked.push(url);
    const p = pages[url];
    if (p === undefined) return { status: 404, body: '' };
    return typeof p === 'string' ? { status: 200, body: p } : p;
  }) as PageFetch & { asked: string[] };
  f.asked = asked;
  return f;
}

describe('how an address is read', () => {
  it('a feed: as before (robots.txt not asked)', async () => {
    const f = site({ 'https://site.example/feed': RSS });
    expect(await resolveSource('https://site.example/feed', f)).toMatchObject({ readAs: null, readUrl: null, items: [{ title: 'Fed holds rates' }] });
    expect(f.asked).toEqual(['https://site.example/feed']);
  });

  it('a page that declares its feed: the feed', async () => {
    const f = site({ 'https://site.example/markets': '<html><head><link rel="alternate" type="application/rss+xml" href="/rss/markets.xml"></head><body></body></html>', 'https://site.example/rss/markets.xml': RSS });
    expect(await resolveSource('https://site.example/markets', f)).toMatchObject({ readAs: 'declared', readUrl: 'https://site.example/rss/markets.xml' });
  });

  it('a page without a feed: its JSON-LD articles, else its headlines', async () => {
    const ld = (n: number) => `{"@type":"NewsArticle","headline":"Article ${n} of the page","url":"/2026/10/20/a${n}","datePublished":"2026-10-20T10:00:00Z"}`;
    const withLd = site({ 'https://site.example/markets': `<html><script type="application/ld+json">[${[1, 2, 3].map(ld).join(',')}]</script>${LISTING(5)}</html>` });
    expect((await resolveSource('https://site.example/markets', withLd)).readAs).toBe('jsonld');
    const plain = site({ 'https://site.example/markets': LISTING(5) });
    const r = await resolveSource('https://site.example/markets', plain);
    expect(r).toMatchObject({ readAs: 'page', readUrl: null });
    expect(r.items).toHaveLength(5);
    expect(plain.asked).toEqual(['https://site.example/robots.txt', 'https://site.example/markets']);
  });

  it('a page blocked or forbidden: the site\'s news sitemap, only the section asked for', async () => {
    const robots = 'User-agent: *\nDisallow: /markets/\nSitemap: https://site.example/news-sitemap.xml\nSitemap: https://elsewhere.example/news.xml';
    const f = site({ 'https://site.example/robots.txt': robots, 'https://site.example/news-sitemap.xml': NEWS_SITEMAP(['/markets/a-story-1', '/world/b-story-2', '/markets/c-story-3']) });
    const r = await resolveSource('https://site.example/markets/', f);
    expect(r).toMatchObject({ readAs: 'sitemap', readUrl: 'https://site.example/news-sitemap.xml' });
    expect(r.items.map((i) => i.link)).toEqual(['https://site.example/markets/a-story-1', 'https://site.example/markets/c-story-3']);
    expect(r.note).toMatch(/robots\.txt interzice pagina/);
    // The forbidden page is never asked for; nor the sitemap of another site.
    expect(f.asked).not.toContain('https://site.example/markets/');
    expect(f.asked).not.toContain('https://elsewhere.example/news.xml');
    const blocked = site({ 'https://site.example/robots.txt': 'Sitemap: https://site.example/news-sitemap.xml', 'https://site.example/markets': { status: 403, body: '' }, 'https://site.example/news-sitemap.xml': NEWS_SITEMAP(['/markets/x-1']) });
    expect(await resolveSource('https://site.example/markets', blocked)).toMatchObject({ readAs: 'sitemap', note: expect.stringMatching(/blochează cititorii automați \(HTTP 403\)/) });
  });

  it('a site forbidding every reader (as Reuters): nothing read, and it says why', async () => {
    const f = site({ 'https://site.example/robots.txt': 'User-agent: *\nDisallow: /\nSitemap: https://site.example/news-sitemap.xml', 'https://site.example/news-sitemap.xml': NEWS_SITEMAP(['/markets/a']) });
    await expect(resolveSource('https://site.example/markets/', f)).rejects.toThrow(/robots\.txt interzice pagina; robots\.txt interzice sitemap-ul/);
    expect(f.asked).toEqual(['https://site.example/robots.txt']);
  });

  it('nothing to read: the reasons; robots.txt failing: later', async () => {
    await expect(resolveSource('https://site.example/markets', site({ 'https://site.example/markets': '<html><body><p>Nothing here</p></body></html>' }))).rejects.toThrow(
      /pagina nu are titluri care să se poată citi fără browser; site-ul nu declară un sitemap de știri/,
    );
    await expect(resolveSource('https://site.example/markets', site({ 'https://site.example/robots.txt': { status: 503, body: '' } }))).rejects.toThrow(/robots\.txt al site-ului răspunde cu eroarea 503/);
  });
});

describe('a source read the way it was found', () => {
  it('a page, a sitemap (newest of its index, the section), a declared feed', async () => {
    const f = site({
      'https://site.example/markets': LISTING(4),
      'https://site.example/news-index.xml': '<?xml version="1.0"?><sitemapindex><sitemap><loc>https://site.example/news-1.xml</loc></sitemap></sitemapindex>',
      'https://site.example/news-1.xml': NEWS_SITEMAP(['/markets/a', '/world/b']),
      'https://site.example/rss.xml': RSS,
    });
    expect(await readSource({ url: 'https://site.example/markets', read_as: 'page', read_url: null }, f)).toHaveLength(4);
    expect((await readSource({ url: 'https://site.example/markets', read_as: 'sitemap', read_url: 'https://site.example/news-index.xml' }, f)).map((i) => i.link)).toEqual(['https://site.example/markets/a']);
    expect(await readSource({ url: 'https://site.example/markets', read_as: 'declared', read_url: 'https://site.example/rss.xml' }, f)).toHaveLength(1);
    await expect(readSource({ url: 'https://site.example/other', read_as: 'page', read_url: null }, f)).rejects.toThrow(/eroarea HTTP 404/);
  });
});

describe('a page\'s headlines without a date (FD-HTMLFEED §3)', () => {
  const det = new CoinDetector([]);
  const coins = { get: async () => det, classifier: async () => det } as never;

  it('the first reading keeps them out (seen); later, new ones come in with the time they were seen; dated ones always', async () => {
    const db = await testDb();
    await db.run("INSERT INTO sources(id, name, url, category, read_as, builtin) VALUES ('pg', 'Page', 'https://site.example/markets', 'macro', 'page', 0)");
    const source = async () => (await db.get<SourceRow>(`SELECT ${SOURCE_COLUMNS} FROM sources WHERE id = 'pg'`)) as SourceRow;
    const now = Date.parse('2026-10-20T12:00:00Z');
    // Three undated headlines and one dated.
    const page1 = `<html><body><main>${[1, 2, 3].map(undated).join('')}${card(9, '2026-10-20T09:00:00Z')}</main></body></html>`;
    expect(await fetchSource(db, coins, await source(), () => now, site({ 'https://site.example/markets': page1 }))).toMatchObject({ ok: true, inserted: 1 });
    // A new undated headline appears; the three old ones are still on the page.
    const page2 = `<html><body><main>${undated(4)}${[1, 2, 3].map(undated).join('')}${card(9, '2026-10-20T09:00:00Z')}</main></body></html>`;
    const later = now + 10 * 60_000;
    expect(await fetchSource(db, coins, await source(), () => later, site({ 'https://site.example/markets': page2 }))).toMatchObject({ ok: true, inserted: 1 });
    const rows = await db.all<{ title: string; published_at: number }>("SELECT title, published_at FROM news WHERE source_id = 'pg' ORDER BY published_at");
    expect(rows).toEqual([
      { title: 'Headline number 9 about the markets today', published_at: Date.parse('2026-10-20T09:00:00Z') },
      { title: 'Headline number 4 about the markets today', published_at: later },
    ]);
    // Read every 10 minutes.
    expect((await source()).next_fetch_at).toBe(later + 10 * 60_000);
  });
});

describe('a date that is only the day of the address', () => {
  it('today, after the first reading: the time it was seen; other days, and the first reading: noon of the day', () => {
    const now = Date.parse('2026-10-20T19:30:00Z');
    const items = [
      { guid: null, link: 'https://x.com/2026/10/20/evening-story.html', title: 't', summary: '', publishedAt: Date.UTC(2026, 9, 20, 12) },
      { guid: null, link: 'https://x.com/2026/10/19/yesterday.html', title: 't', summary: '', publishedAt: Date.UTC(2026, 9, 19, 12) },
      { guid: null, link: 'https://x.com/2026/10/20/with-a-time.html', title: 't', summary: '', publishedAt: Date.parse('2026-10-20T15:05:00Z') },
    ];
    expect(seenToday({ last_success_at: now - 600_000 }, items, now).map((i) => i.publishedAt)).toEqual([now, Date.UTC(2026, 9, 19, 12), Date.parse('2026-10-20T15:05:00Z')]);
    expect(seenToday({ last_success_at: null }, items, now)).toEqual(items);
  });
});
