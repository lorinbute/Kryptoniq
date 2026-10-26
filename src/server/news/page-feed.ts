// FD-HTMLFEED: a news source read from a site's page: how (found once, when it is added), and reading it that way.
import { fetchText, HttpError } from '../net/http.ts';
import { FeedParseError, parseFeed, type ParsedItem } from './parser.ts';
import { declaredFeeds, isBlocked, jsonLdItems, pageItems, parseRobots, parseSitemap, sameSite } from './page-reader.ts';

/** How a source is read: null, its address is a feed (as before FD-HTMLFEED). */
export type ReadAs = 'declared' | 'sitemap' | 'jsonld' | 'page';

export const READ_AS_LABEL: Record<ReadAs | 'feed', string> = {
  feed: 'feed RSS',
  declared: 'feed găsit în pagină',
  sitemap: 'sitemap-ul de știri al site-ului',
  jsonld: 'datele structurate ale paginii',
  page: 'titlurile din pagină',
};

/** Fewer headlines than this on a page: not a news listing (its sitemap is tried). */
const MIN_ITEMS = 3;

export interface Fetched {
  status: number;
  body: string;
}
/** A GET that gives the status of a refusal instead of throwing (a blocked page is an answer). */
export type PageFetch = (url: string) => Promise<Fetched>;

const ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,application/rss+xml;q=0.9,*/*;q=0.8';

export const httpFetch: PageFetch = async (url) => {
  try {
    const r = await fetchText(url, { headers: { Accept: ACCEPT }, timeoutMs: 15_000 });
    return { status: r.status, body: r.body };
  } catch (err) {
    if (err instanceof HttpError && err.status) return { status: err.status, body: '' };
    throw err;
  }
};

export class PageReadError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** An address meant for readers by its name (".xml", "/feed", "/rss"…): read without asking robots.txt, like any feed. */
const looksLikeFeed = (url: string) => /(?:\.(?:xml|rss|atom)$|\/(?:feeds?|rss|atom)(?:\/|$)|[?&](?:format|output|outputType)=(?:rss|xml|atom))/i.test(new URL(url).pathname + new URL(url).search);

/** What robots.txt lets every reader read on a site; "unavailable" when the site's server fails to say (read later). */
async function robotsOf(url: string, fetch: PageFetch): Promise<{ allowed: (u: string) => boolean; sitemaps: string[] }> {
  const origin = new URL(url).origin;
  let r: Fetched;
  try {
    r = await fetch(`${origin}/robots.txt`);
  } catch {
    throw new PageReadError('ROBOTS_UNAVAILABLE', 'robots.txt al site-ului nu răspunde: se reîncearcă mai târziu');
  }
  if (r.status >= 500) throw new PageReadError('ROBOTS_UNAVAILABLE', `robots.txt al site-ului răspunde cu eroarea ${r.status}: se reîncearcă mai târziu`);
  // None (404) or refused: nothing is forbidden (only the server's own failure stops a reader).
  if (r.status !== 200) return { allowed: () => true, sitemaps: [] };
  const p = parseRobots(r.body);
  return { allowed: (u) => !p.disallowed(new URL(u).pathname + new URL(u).search), sitemaps: p.sitemaps.filter((s) => sameSite(s, url)) };
}

/** The section of a page's address ("/markets/" → "/markets"), none for the home page. */
function sectionOf(url: string): string | null {
  const path = new URL(url).pathname.replace(/\/+$/, '');
  return path ? path : null;
}
const inSection = (link: string, section: string | null) => {
  if (!section) return true;
  const p = new URL(link).pathname;
  return p === section || p.startsWith(`${section}/`);
};

/** The news of a news sitemap (an index: its newest sitemap), in a section, or why there are none. */
async function readSitemap(url: string, section: string | null, fetch: PageFetch, allowed: (u: string) => boolean): Promise<{ items: ParsedItem[]; note?: string }> {
  let at = url;
  for (let depth = 0; depth < 2; depth++) {
    if (!allowed(at)) return { items: [], note: 'robots.txt interzice sitemap-ul' };
    const r = await fetch(at);
    if (r.status !== 200) return { items: [], note: `sitemap-ul răspunde cu eroarea ${r.status}` };
    const sm = parseSitemap(r.body);
    if (!sm) return { items: [], note: 'nu e un sitemap' };
    if (sm.kind === 'index') {
      const next = sm.children.find((c) => sameSite(c, url));
      if (!next) return { items: [], note: 'indexul sitemap-ului e gol' };
      at = next;
      continue;
    }
    if (sm.items.length === 0) return { items: [], note: sm.untitled ? 'sitemap-ul nu are titluri de știri (nu e un sitemap de știri)' : 'sitemap-ul e gol' };
    const kept = sm.items.filter((i) => i.link && sameSite(i.link, url) && inSection(i.link, section));
    if (kept.length === 0) return { items: [], note: `sitemap-ul are ${sm.items.length} știri, dar niciuna din ${section}/` };
    return { items: kept };
  }
  return { items: [], note: 'prea multe indexuri de sitemap' };
}

export interface Resolved {
  readAs: ReadAs | null;
  readUrl: string | null;
  items: ParsedItem[];
  /** For the admin: what was found, or why nothing was. */
  note?: string;
}

/** FD-HTMLFEED §2: how to read an address: a feed, the feed the page declares, its JSON-LD, its headlines, its news sitemap. */
export async function resolveSource(url: string, fetch: PageFetch = httpFetch): Promise<Resolved> {
  const reasons: string[] = [];
  let robots: Awaited<ReturnType<typeof robotsOf>> | null = null;
  const robotsNow = async () => (robots ??= await robotsOf(url, fetch));
  const feedLike = looksLikeFeed(url);
  let pageOk = true;
  if (!feedLike && !(await robotsNow()).allowed(url)) {
    pageOk = false;
    reasons.push('robots.txt interzice pagina');
  }
  const page = pageOk ? await fetch(url) : null;
  if (page && page.status === 200) {
    try {
      const items = parseFeed(page.body);
      if (items.length) return { readAs: null, readUrl: null, items };
      reasons.push('feed-ul nu conține articole');
    } catch (err) {
      if (!(err instanceof FeedParseError)) throw err;
    }
    // A sitemap given as the address.
    const sm = parseSitemap(page.body);
    if (sm) {
      const r = await readSitemap(url, null, fetch, (await robotsNow()).allowed);
      if (r.items.length) return { readAs: 'sitemap', readUrl: url, items: r.items };
      if (r.note) reasons.push(r.note);
    } else if (feedLike && !(await robotsNow()).allowed(url)) {
      reasons.push('robots.txt interzice pagina');
    } else {
      for (const f of declaredFeeds(page.body, url)) {
        const r = await fetch(f);
        if (r.status !== 200) continue;
        try {
          const items = parseFeed(r.body);
          if (items.length) return { readAs: 'declared', readUrl: f, items };
        } catch {
          // Not a feed after all: the next one, or the page itself.
        }
      }
      const ld = jsonLdItems(page.body, url);
      if (ld.length >= MIN_ITEMS) return { readAs: 'jsonld', readUrl: null, items: ld };
      const heads = pageItems(page.body, url);
      if (heads.length >= MIN_ITEMS) return { readAs: 'page', readUrl: null, items: heads };
      reasons.push(heads.length ? `pagina are doar ${heads.length} titluri` : 'pagina nu are titluri care să se poată citi fără browser');
    }
  } else if (page) {
    reasons.push(isBlocked(page.status, page.body) ? `site-ul blochează cititorii automați (HTTP ${page.status})` : `pagina răspunde cu eroarea HTTP ${page.status}`);
  }
  // The site's news sitemap: for a page refused, blocked, or without headlines.
  const rb = await robotsNow();
  // The first few news sitemaps (a site may declare dozens: per language, per year).
  const news = rb.sitemaps.filter((s) => /news/i.test(s)).slice(0, 3);
  for (const s of news) {
    const r = await readSitemap(s, sectionOf(url), fetch, rb.allowed);
    if (r.items.length) return { readAs: 'sitemap', readUrl: s, items: r.items, note: reasons.length ? `${[...new Set(reasons)].join('; ')}: citită din sitemap-ul de știri` : undefined };
    if (r.note) reasons.push(r.note);
  }
  if (!news.length) reasons.push('site-ul nu declară un sitemap de știri');
  throw new PageReadError('NO_NEWS', `Nu s-au găsit știri: ${[...new Set(reasons)].join('; ')}`);
}

/** A source read the way found when it was added (FD-HTMLFEED §2), every time without searching again. */
export async function readSource(source: { url: string; read_as: string | null; read_url: string | null }, fetch: PageFetch = httpFetch): Promise<ParsedItem[]> {
  const readAs = source.read_as as ReadAs;
  if (readAs === 'declared') {
    const r = await fetch(source.read_url as string);
    if (r.status !== 200) throw new PageReadError('HTTP_STATUS', `Feed-ul găsit în pagină răspunde cu eroarea HTTP ${r.status}`);
    return parseFeed(r.body);
  }
  const robots = await robotsOf(source.url, fetch);
  if (readAs === 'sitemap') {
    const at = source.read_url as string;
    const section = at === source.url ? null : sectionOf(source.url);
    const r = await readSitemap(at, section, fetch, robots.allowed);
    if (!r.items.length) throw new PageReadError('NO_NEWS', `Sitemap-ul nu mai dă știri: ${r.note ?? 'gol'}`);
    return r.items;
  }
  if (!robots.allowed(source.url)) throw new PageReadError('ROBOTS', 'robots.txt interzice acum pagina');
  const page = await fetch(source.url);
  if (page.status !== 200) throw new PageReadError('HTTP_STATUS', isBlocked(page.status, page.body) ? `Site-ul blochează cititorii automați (HTTP ${page.status})` : `Pagina răspunde cu eroarea HTTP ${page.status}`);
  const items = readAs === 'jsonld' ? jsonLdItems(page.body, source.url) : pageItems(page.body, source.url);
  if (!items.length) throw new PageReadError('NO_NEWS', 'Pagina nu mai are titluri (s-a schimbat?)');
  return items;
}
