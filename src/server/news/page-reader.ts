// FD-HTMLFEED: news from a site without an RSS feed: the feed the page declares, its news sitemap, its JSON-LD, or the
// headlines it links to. Pure functions over the text of a page; `page-feed.ts` does the fetching.
import { XMLParser } from 'fast-xml-parser';
import { decode as decodeEntities } from 'he';
import type { ParsedItem } from './parser.ts';

/** Elements that never have content (no closing tag to wait for). */
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
/** Elements whose content is not text of the page. */
const RAW = new Set(['script', 'style', 'noscript', 'template', 'svg', 'iframe']);
/** A card of a listing: what groups a headline with its date. */
const CARD_CLASS = /(?:^|[\s_-])(card|story|item|post|article|teaser|headline|entry|news|tile|promo|river|feed|stream)(?:$|[\s_-]|s\b)/i;

const decode = (s: string) => decodeEntities(s);
const text = (s: string) => decode(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

/** The attributes of a tag's inside ("a href=x class=y" → { href, class }), names lower case, values decoded. */
export function attributesOf(inside: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of inside.matchAll(/([^\s=/"'<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    const name = (m[1] as string).toLowerCase();
    if (!(name in out)) out[name] = decode(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
}

/** An absolute http(s) address from a link of the page (none for anchors, scripts, mail). */
export function absoluteUrl(href: string, base: string): string | null {
  const h = href.trim();
  if (!h || h.startsWith('#') || /^(?:javascript|mailto|tel|data):/i.test(h)) return null;
  try {
    const u = new URL(h, base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

/** The site of a host ("www.cnbc.com" → "cnbc.com", "news.bbc.co.uk" → "bbc.co.uk"): what counts as the same site. */
export function siteOf(host: string): string {
  const parts = host.toLowerCase().replace(/\.$/, '').split('.');
  if (parts.length <= 2) return parts.join('.');
  // Two-part public suffixes ("co.uk", "com.au", "co.jp"…): one label more.
  const two = parts.slice(-2).join('.');
  const take = /^(?:co|com|net|org|gov|ac|edu|ne|or)\.[a-z]{2}$/.test(two) ? 3 : 2;
  return parts.slice(-take).join('.');
}

export const sameSite = (a: string, b: string): boolean => {
  try {
    return siteOf(new URL(a).hostname) === siteOf(new URL(b).hostname);
  } catch {
    return false;
  }
};

/** The feeds a page declares (`<link rel="alternate" type="application/rss+xml" href="…">`), absolute, of the same site. */
export function declaredFeeds(html: string, base: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<link\b([^>]*)>/gi)) {
    const a = attributesOf(m[1] as string);
    if (!/\balternate\b/i.test(a.rel ?? '') || !/application\/(?:rss|atom)\+xml/i.test(a.type ?? '')) continue;
    const url = a.href ? absoluteUrl(a.href, base) : null;
    if (url && sameSite(url, base) && !out.includes(url)) out.push(url);
  }
  return out;
}

/** A date written in a page ("2026-10-20T14:28:39Z", "Tue, 20 Oct 2026 14:28:39 GMT"), or none. */
export function dateOf(s: string | undefined | null): number | null {
  if (!s) return null;
  const t = Date.parse(s.trim());
  return Number.isFinite(t) && t > Date.UTC(2000, 0, 1) ? t : null;
}

/** The date in an article's address ("/2026/10/20/…", "…-2026-10-20/", "/20261020/"), noon UTC of that day. */
export function urlDate(url: string): number | null {
  const m = /(?:^|[/_-])(20\d{2})[/_-]?(0[1-9]|1[0-2])[/_-]?(0[1-9]|[12]\d|3[01])(?=$|[/_.-])/.exec(new URL(url).pathname);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  return Number.isFinite(t) ? t : null;
}

const asArray = <T>(v: T | T[] | undefined | null): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const ARTICLE_TYPES = /^(?:NewsArticle|Article|BlogPosting|ReportageNews|AnalysisNewsArticle|LiveBlogPosting|TechArticle|OpinionNewsArticle)$/;

/** The articles a page lists in its JSON-LD (an `ItemList`, a `@graph`, or articles), of the same site. */
export function jsonLdItems(html: string, base: string): ParsedItem[] {
  const out = new Map<string, ParsedItem>();
  const visit = (node: unknown, depth: number): void => {
    if (depth > 6 || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const n of node) visit(n, depth + 1);
      return;
    }
    const o = node as Record<string, unknown>;
    const types = asArray(o['@type'] as string | string[]).map(String);
    if (types.some((t) => ARTICLE_TYPES.test(t))) {
      const title = typeof o.headline === 'string' ? o.headline : typeof o.name === 'string' ? o.name : '';
      const href = typeof o.url === 'string' ? o.url : typeof o.mainEntityOfPage === 'string' ? o.mainEntityOfPage : (o.mainEntityOfPage as { '@id'?: string } | undefined)?.['@id'];
      const url = href ? absoluteUrl(href, base) : null;
      const t = text(title);
      if (url && t && sameSite(url, base) && url !== absoluteUrl(base, base) && !out.has(url)) {
        out.set(url, { guid: url, link: url, title: t, summary: typeof o.description === 'string' ? text(o.description) : '', publishedAt: dateOf(o.datePublished as string) ?? dateOf(o.dateCreated as string) });
      }
    }
    for (const key of ['@graph', 'itemListElement', 'item', 'hasPart', 'mainEntity']) if (key in o) visit(o[key], depth + 1);
  };
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      visit(JSON.parse((m[1] as string).trim()), 0);
    } catch {
      // A broken block: the others still count.
    }
  }
  return [...out.values()];
}

/** Paths that are not articles: lists, people, pages of the site. */
const NOT_ARTICLE =
  /^\/(?:$|tags?\/|topics?\/|authors?\/|people\/|category\/|categories\/|section\/|search|login|signin|sign-in|register|subscribe|subscription|newsletters?|about|contact|careers|jobs|privacy|terms|cookies?|legal|help|faq|advertis\w*|video\/?$|videos\/?$|podcasts?\/?$|live\/?$|events?\/?$|shop|store|account|profile|settings|feed\/?$|rss)/i;

/** Parts of a page that are not its news: menus, its header and footer, side boxes. */
const CHROME = new Set(['nav', 'header', 'footer', 'aside', 'menu', 'dialog', 'form']);

/** One headline of a page: its link, text, and where it sits. */
interface Anchor {
  url: string;
  text: string;
  heading: boolean;
  /** The cards around it, the innermost first. */
  cards: number[];
  /** Every element around it, the innermost first (where its date is looked for). */
  chain: number[];
  order: number;
}

/**
 * The headlines a listing page links to: links of the same site to an article (a path of its own, not a list), with a
 * headline's text (4 words, 20–220 characters), in a heading or a card, not in the page's menus, header or footer. The
 * date: the first `<time>` of the smallest element around it that holds no other headline (its card, whatever its markup),
 * or the one in its address. In the page's order (the first ones are its top news).
 */
export function pageItems(html: string, base: string, max = 60): ParsedItem[] {
  const anchors: Anchor[] = [];
  /** Each `<time>` with the elements around it. */
  const times: { date: number; chain: number[] }[] = [];
  // The open elements: name, their number, and the card they make (if any).
  const stack: { name: string; id: number; card: number | null }[] = [];
  let ids = 0;
  let cards = 0;
  let open: { url: string; buf: string[]; heading: boolean; cards: number[]; chain: number[]; label: string } | null = null;
  const tag = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*?)(\/?)>|<!--[\s\S]*?-->/g;
  let last = 0;
  let order = 0;
  const cardsHere = () => stack.flatMap((e) => (e.card !== null ? [e.card] : [])).reverse();
  const chainHere = () => stack.map((e) => e.id).reverse();
  const inHeading = () => stack.some((e) => /^h[1-4]$/.test(e.name));
  const inChrome = () => stack.some((e) => CHROME.has(e.name));
  const lower = html.toLowerCase();
  for (let m = tag.exec(html); m; m = tag.exec(html)) {
    if (open) open.buf.push(html.slice(last, m.index));
    last = tag.lastIndex;
    if (!m[2]) continue; // a comment
    const closing = m[1] === '/';
    const name = m[2].toLowerCase();
    if (!closing && RAW.has(name)) {
      // Skip to the end of a script / style (its text is no headline).
      const end = lower.indexOf(`</${name}`, tag.lastIndex);
      tag.lastIndex = end < 0 ? html.length : end;
      last = tag.lastIndex;
      continue;
    }
    if (closing) {
      if (name === 'a' && open) {
        const t = text(open.buf.join('')) || open.label;
        anchors.push({ url: open.url, text: t, heading: open.heading || inHeading(), cards: open.cards, chain: open.chain, order: order++ });
        open = null;
      }
      const at = stack.map((e) => e.name).lastIndexOf(name);
      if (at >= 0) stack.length = at;
      continue;
    }
    const attrs = attributesOf(m[3] as string);
    if (name === 'time' || attrs.datetime || attrs.itemprop === 'datePublished') {
      const d = dateOf(attrs.datetime ?? attrs.content);
      if (d !== null) times.push({ date: d, chain: chainHere() });
    }
    // A heading inside the link ("<a><h2>…</h2></a>", as CoinDesk writes them): the link is a headline.
    if (open && /^h[1-4]$/.test(name)) open.heading = true;
    if (name === 'a' && attrs.href && !inChrome()) {
      const url = absoluteUrl(attrs.href, base);
      if (url) open = { url, buf: [], heading: inHeading(), cards: cardsHere(), chain: chainHere(), label: text(attrs['aria-label'] ?? attrs.title ?? '') };
    }
    if (VOID.has(name) || m[4] === '/') continue;
    const card = name === 'article' || name === 'li' || CARD_CLASS.test(attrs.class ?? '') ? ++cards : null;
    stack.push({ name, id: ++ids, card });
  }
  const self = absoluteUrl(base, base);
  const articleLike = (url: string) => {
    if (url === self || !sameSite(url, base)) return false;
    const path = new URL(url).pathname;
    if (NOT_ARTICLE.test(path)) return false;
    // An article has a path of its own: two parts, a date, or a long slug ("/markets/…", "/2026/10/20/…", "/fed-holds-rates").
    const parts = path.split('/').filter(Boolean);
    const slug = parts.at(-1) ?? '';
    return parts.length >= 2 || urlDate(url) !== null || (slug.match(/-/g) ?? []).length >= 3;
  };
  const byUrl = new Map<string, Anchor>();
  for (const a of anchors) {
    if (!articleLike(a.url)) continue;
    const words = a.text.split(' ').length;
    if (a.text.length < 20 || a.text.length > 220 || words < 4) continue;
    if (!a.heading && a.cards.length === 0) continue;
    const had = byUrl.get(a.url);
    // The same article linked twice (its picture, its title): the longer text, the first place.
    if (!had) byUrl.set(a.url, a);
    else if (a.text.length > had.text.length) byUrl.set(a.url, { ...a, order: had.order, cards: had.cards.length ? had.cards : a.cards, chain: had.chain, heading: had.heading || a.heading });
  }
  // The same headline at two addresses (a page's variants, a tracking parameter): once, the first.
  const titles = new Set<string>();
  const kept = [...byUrl.values()]
    .sort((a, b) => a.order - b.order)
    .filter((a) => {
      const t = a.text.toLowerCase();
      if (titles.has(t)) return false;
      titles.add(t);
      return true;
    })
    .slice(0, max);
  // How many articles each element links to (a headline kept or not): one, it is that headline's card, whatever its
  // markup; more, a list (its dates are not this headline's).
  const holds = new Map<number, Set<string>>();
  for (const a of anchors) if (articleLike(a.url)) for (const id of a.chain) holds.set(id, (holds.get(id) ?? new Set()).add(a.url));
  // The first date inside each element.
  const firstDate = new Map<number, number>();
  for (const t of times) for (const id of t.chain) if (!firstDate.has(id)) firstDate.set(id, t.date);
  const own = (a: Anchor) => {
    // A card is near its headline: a few levels up at most.
    for (const id of a.chain.slice(0, 6)) {
      if ((holds.get(id)?.size ?? 0) > 1) break;
      const d = firstDate.get(id);
      if (d !== undefined) return d;
    }
    return null;
  };
  return kept.map((a) => ({ guid: a.url, link: a.url, title: a.text, summary: '', publishedAt: own(a) ?? urlDate(a.url) }));
}

const sitemapParser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, processEntities: true, trimValues: true, parseTagValue: false });

/** A sitemap: an index of sitemaps (newest first), or the news it lists (only entries with a news title: a news sitemap). */
export type Sitemap = { kind: 'index'; children: string[] } | { kind: 'urls'; items: ParsedItem[]; untitled: number };

export function parseSitemap(xml: string): Sitemap | null {
  const body = xml.replace(/^﻿/, '').trimStart();
  if (!/^<(\?xml|urlset|sitemapindex)/i.test(body) || !/<(urlset|sitemapindex)\b/i.test(body)) return null;
  // Never expand DOCTYPE-declared entities (entity-expansion attacks), as for the feeds.
  let doc: Record<string, unknown>;
  try {
    doc = sitemapParser.parse(body.replace(/<!DOCTYPE[^[>]*(\[[\s\S]*?\])?\s*>/gi, '')) as Record<string, unknown>;
  } catch {
    return null;
  }
  const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
  const index = doc.sitemapindex as { sitemap?: unknown } | undefined;
  if (index) {
    const children = asArray(index.sitemap as Record<string, unknown> | Record<string, unknown>[])
      .map((s) => ({ loc: str(s.loc).trim(), lastmod: dateOf(str(s.lastmod)) ?? 0 }))
      .filter((s) => s.loc);
    // Newest first (by lastmod; in the index's order when it has none).
    const ordered = children.map((c, k) => ({ ...c, k })).sort((a, b) => b.lastmod - a.lastmod || a.k - b.k);
    return { kind: 'index', children: ordered.map((c) => c.loc) };
  }
  const urlset = doc.urlset as { url?: unknown } | undefined;
  if (!urlset) return null;
  let untitled = 0;
  const items: ParsedItem[] = [];
  for (const u of asArray(urlset.url as Record<string, unknown> | Record<string, unknown>[])) {
    const loc = str(u.loc).trim();
    const news = (Array.isArray(u.news) ? u.news[0] : u.news) as Record<string, unknown> | undefined;
    const title = news ? text(str(news.title)) : '';
    if (!loc || !title) {
      untitled++;
      continue;
    }
    items.push({ guid: loc, link: loc, title, summary: '', publishedAt: dateOf(str(news?.publication_date)) ?? dateOf(str(u.lastmod)) });
  }
  return { kind: 'urls', items, untitled };
}

/** What `robots.txt` says to every reader (`User-agent: *`): the sitemaps it declares, and whether a path is off limits. */
export function parseRobots(txt: string): { sitemaps: string[]; disallowed: (path: string) => boolean } {
  const sitemaps: string[] = [];
  const rules: { allow: boolean; pattern: string }[] = [];
  let agents: string[] = [];
  let inRules = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = (m[1] as string).toLowerCase();
    const value = (m[2] as string).trim();
    if (key === 'sitemap') {
      if (value) sitemaps.push(value);
      continue;
    }
    if (key === 'user-agent') {
      // A new group starts with the first user-agent after rules.
      if (inRules) agents = [];
      inRules = false;
      agents.push(value.toLowerCase());
      continue;
    }
    if (key === 'allow' || key === 'disallow') {
      inRules = true;
      if (agents.includes('*') && value) rules.push({ allow: key === 'allow', pattern: value });
    }
  }
  const matches = (pattern: string, path: string) => {
    const re = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$')}`);
    return re.test(path);
  };
  return {
    sitemaps,
    disallowed: (path: string) => {
      // The longest matching rule wins; between equals, allow.
      let best: { allow: boolean; len: number } | null = null;
      for (const r of rules) {
        if (!matches(r.pattern, path)) continue;
        if (!best || r.pattern.length > best.len || (r.pattern.length === best.len && r.allow)) best = { allow: r.allow, len: r.pattern.length };
      }
      return best !== null && !best.allow;
    },
  };
}

/** A page that turns automatic readers away: refused, too many requests, or a bot challenge (Cloudflare & co.). */
export function isBlocked(status: number, body: string): boolean {
  if ([401, 403, 429, 503].includes(status)) return true;
  const head = body.slice(0, 20_000);
  return /<title>\s*(?:Just a moment|Attention Required|Access denied|Please verify)/i.test(head) || /cf-chl|challenge-platform|captcha-delivery|px-captcha/i.test(head);
}
