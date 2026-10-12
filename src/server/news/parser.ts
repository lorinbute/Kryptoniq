// RSS 2.0 / RSS 1.0 (RDF) / Atom parser producing plain-text items.
import { XMLParser } from 'fast-xml-parser';
import { parseFeedDate, safeHttpUrl, toPlainText } from './normalize.ts';

export interface ParsedItem {
  guid: string | null;
  link: string | null;
  title: string;
  summary: string;
  publishedAt: number | null;
}

export class FeedParseError extends Error {
  readonly code: 'NOT_A_FEED' | 'MALFORMED';
  constructor(code: 'NOT_A_FEED' | 'MALFORMED', message: string) {
    super(message);
    this.code = code;
  }
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true,
  htmlEntities: true,
  isArray: (name) => name === 'item' || name === 'entry' || name === 'link' || name === 'category',
});

type Node = unknown;

function textOf(node: Node): string {
  if (node === undefined || node === null) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number' || typeof node === 'boolean') return String(node);
  if (Array.isArray(node)) return textOf(node[0]);
  if (typeof node === 'object') {
    const t = (node as Record<string, unknown>)['#text'];
    return typeof t === 'string' || typeof t === 'number' ? String(t) : '';
  }
  return '';
}

function field(obj: Record<string, unknown>, ...names: string[]): Node {
  for (const n of names) if (obj[n] !== undefined) return obj[n];
  return undefined;
}

function atomLink(links: Node): string | null {
  const arr = Array.isArray(links) ? links : links ? [links] : [];
  let fallback: string | null = null;
  for (const l of arr) {
    if (typeof l === 'string') {
      fallback ??= l;
      continue;
    }
    if (l && typeof l === 'object') {
      const o = l as Record<string, unknown>;
      const href = typeof o['@_href'] === 'string' ? (o['@_href'] as string) : textOf(o);
      const rel = typeof o['@_rel'] === 'string' ? (o['@_rel'] as string) : 'alternate';
      if (rel === 'alternate' && href) return href;
      fallback ??= href || null;
    }
  }
  return fallback;
}

export function parseFeed(xml: string): ParsedItem[] {
  let body = xml.replace(/^\uFEFF/, '').trimStart();
  if (!body.startsWith('<')) throw new FeedParseError('NOT_A_FEED', 'Răspunsul nu este XML (nu e un feed RSS/Atom)');
  if (/^<!doctype html|^<html[\s>]/i.test(body)) throw new FeedParseError('NOT_A_FEED', 'Adresa întoarce o pagină HTML, nu un feed RSS/Atom');
  // Never expand DOCTYPE-declared entities (entity-expansion attacks).
  body = body.replace(/<!DOCTYPE[^[>]*(\[[\s\S]*?\])?\s*>/gi, '');
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(body) as Record<string, unknown>;
  } catch (err) {
    throw new FeedParseError('MALFORMED', `XML invalid: ${(err as Error).message}`);
  }

  const rss = doc.rss as Record<string, unknown> | undefined;
  const rdf = (doc['rdf:RDF'] ?? doc.RDF) as Record<string, unknown> | undefined;
  const feed = doc.feed as Record<string, unknown> | undefined;

  let rawItems: Record<string, unknown>[] = [];
  let kind: 'rss' | 'atom';
  if (rss && typeof rss === 'object') {
    const channel = (Array.isArray(rss.channel) ? rss.channel[0] : rss.channel) as Record<string, unknown> | undefined;
    rawItems = (channel?.item as Record<string, unknown>[] | undefined) ?? [];
    kind = 'rss';
  } else if (rdf && typeof rdf === 'object') {
    rawItems = (rdf.item as Record<string, unknown>[] | undefined) ?? [];
    kind = 'rss';
  } else if (feed && typeof feed === 'object') {
    rawItems = (feed.entry as Record<string, unknown>[] | undefined) ?? [];
    kind = 'atom';
  } else {
    throw new FeedParseError('NOT_A_FEED', 'Documentul nu este un feed RSS/Atom');
  }

  const out: ParsedItem[] = [];
  for (const it of rawItems) {
    if (!it || typeof it !== 'object') continue;
    const title = toPlainText(textOf(field(it, 'title')), 500);
    if (!title) continue;
    const link = kind === 'atom' ? atomLink(it.link) : textOf(it.link) || atomLink(it.link);
    const guidRaw = textOf(field(it, 'guid', 'id', '@_rdf:about'));
    const summaryRaw = textOf(field(it, 'description', 'summary', 'content:encoded', 'content', 'dc:description'));
    const dateRaw = textOf(field(it, 'pubDate', 'published', 'updated', 'dc:date', 'pubdate'));
    out.push({
      guid: guidRaw ? guidRaw.trim().slice(0, 500) : null,
      link: safeHttpUrl(link),
      title,
      summary: toPlainText(summaryRaw, 600),
      publishedAt: parseFeedDate(dateRaw),
    });
  }
  return out;
}
