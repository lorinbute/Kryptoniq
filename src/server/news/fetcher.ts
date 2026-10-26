// Fetches due sources with conditional requests and exponential backoff (TD §5.1, §4).
import type { Db } from '../db/database.ts';
import type { Logger } from '../log.ts';
import { fetchText, HttpError } from '../net/http.ts';
import type { CoinRegistry } from './coin-registry.ts';
import { ingestItems } from './ingest.ts';
import { FeedParseError, parseFeed, type ParsedItem } from './parser.ts';
import { SOURCE_COLUMNS, type SourceRow } from './sources.ts';
import { httpFetch, PageReadError, readSource, type PageFetch } from './page-feed.ts';
import { urlDate } from './page-reader.ts';
import { PUT_CACHE } from '../market/stock-context.ts';

export const FETCH_INTERVAL_MS = 5 * 60_000;
/** FD-HTMLFEED §4: a site's page or sitemap, read more gently than a feed. */
export const PAGE_INTERVAL_MS = 10 * 60_000;
/** The undated headlines of a page remembered as already seen (FD-HTMLFEED §3). */
const SEEN_MAX = 1000;
const seenKey = (id: string) => `page-seen:${id}`;

/**
 * FD-HTMLFEED §3: a page's headlines without a date. At its first reading their age is unknown: remembered as seen, not
 * added (else a whole page of old headlines would come in as news of now). After that, an undated one not seen before is
 * new (it comes in with the time it was seen); the dated ones always come in by their date (as a feed's).
 */
export async function withoutOldUndated(db: Db, source: Pick<SourceRow, 'id' | 'last_success_at'>, items: ParsedItem[], now: number): Promise<ParsedItem[]> {
  const undated = items.filter((i) => i.publishedAt === null).map((i) => i.link ?? i.guid ?? i.title);
  if (undated.length === 0) return items;
  const row = await db.get<{ value: string }>('SELECT value FROM market_cache WHERE [key] = ?', [seenKey(source.id)]);
  let seen: string[] = [];
  try {
    seen = row ? (JSON.parse(row.value) as string[]) : [];
  } catch {
    seen = [];
  }
  const was = new Set(seen);
  const first = source.last_success_at === null;
  const keep = items.filter((i) => i.publishedAt !== null || (!first && !was.has(i.link ?? i.guid ?? i.title)));
  const next = [...new Set([...undated, ...seen])].slice(0, SEEN_MAX);
  await db.run(PUT_CACHE, { k: seenKey(source.id), v: JSON.stringify(next), t: now });
  return keep;
}

/**
 * FD-HTMLFEED §3: a date that is only the day of the address (noon UTC) and that day today: after the first reading, the
 * item is new (the ones already stored are not added again), so it comes in with the time it was seen.
 */
export function seenToday(source: Pick<SourceRow, 'last_success_at'>, items: ParsedItem[], now: number): ParsedItem[] {
  if (source.last_success_at === null) return items;
  const today = new Date(now).toISOString().slice(0, 10);
  return items.map((i) => (i.publishedAt !== null && i.link && i.publishedAt === urlDate(i.link) && new Date(i.publishedAt).toISOString().slice(0, 10) === today ? { ...i, publishedAt: now } : i));
}
export const MAX_BACKOFF_MS = 60 * 60_000;
const CONCURRENCY = 4;

export function backoffMs(failures: number): number {
  return Math.min(MAX_BACKOFF_MS, FETCH_INTERVAL_MS * 2 ** Math.max(0, failures - 1));
}

export interface FetchOutcome {
  sourceId: string;
  ok: boolean;
  inserted: number;
  notModified?: boolean;
  error?: string;
}

const FEED_ACCEPT = 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.8';

export async function fetchSource(db: Db, coins: CoinRegistry, source: SourceRow, now: () => number = Date.now, pageFetch: PageFetch = httpFetch): Promise<FetchOutcome> {
  const start = now();
  await db.run('UPDATE sources SET last_attempt_at = ? WHERE id = ?', [start, source.id]);
  try {
    if (source.read_as) {
      // FD-HTMLFEED: read the way found when the source was added (no conditional requests: a page changes all the time).
      const items = seenToday(source, await withoutOldUndated(db, source, await readSource(source, pageFetch), start), start);
      const r = await ingestItems(db, source, items, await coins.get(), now(), await coins.classifier());
      const t = now();
      await db.run(
        `UPDATE sources SET last_success_at = ?, last_error = NULL, failures = 0, next_fetch_at = ?,
           last_new_item_at = CASE WHEN ? > 0 THEN ? ELSE last_new_item_at END,
           item_count = (SELECT count(*) FROM news WHERE source_id = ?)
         WHERE id = ?`,
        [t, t + PAGE_INTERVAL_MS, r.inserted, t, source.id, source.id],
      );
      return { sourceId: source.id, ok: true, inserted: r.inserted };
    }
    // Conditional headers only once the source has produced a good response.
    const conditional = source.failures === 0 && source.last_success_at !== null;
    const res = await fetchText(source.url, {
      headers: { Accept: FEED_ACCEPT },
      etag: conditional ? source.etag : null,
      lastModified: conditional ? source.last_modified : null,
    });
    let inserted = 0;
    if (!res.notModified) {
      const items = parseFeed(res.body);
      const r = await ingestItems(db, source, items, await coins.get(), now(), await coins.classifier());
      inserted = r.inserted;
    }
    const t = now();
    await db.run(
      `UPDATE sources SET last_success_at = ?, last_error = NULL, failures = 0, next_fetch_at = ?,
         etag = COALESCE(?, etag), last_modified = COALESCE(?, last_modified),
         last_new_item_at = CASE WHEN ? > 0 THEN ? ELSE last_new_item_at END,
         item_count = (SELECT count(*) FROM news WHERE source_id = ?)
       WHERE id = ?`,
      [t, t + FETCH_INTERVAL_MS, res.etag, res.lastModified, inserted, t, source.id, source.id],
    );
    return { sourceId: source.id, ok: true, inserted, notModified: res.notModified };
  } catch (err) {
    const code = err instanceof HttpError || err instanceof FeedParseError || err instanceof PageReadError ? err.code : 'ERROR';
    const msg = `${code}: ${(err as Error).message}`.slice(0, 300);
    const failures = source.failures + 1;
    await db.run('UPDATE sources SET last_error = ?, failures = ?, next_fetch_at = ? WHERE id = ?', [msg, failures, now() + backoffMs(failures), source.id]);
    return { sourceId: source.id, ok: false, inserted: 0, error: msg };
  }
}

/** Fetches every enabled source that is due, CONCURRENCY at a time. */
export async function fetchDueSources(db: Db, coins: CoinRegistry, log: Logger, signal?: AbortSignal, now: () => number = Date.now): Promise<FetchOutcome[]> {
  const due = await db.all<SourceRow>(`SELECT ${SOURCE_COLUMNS} FROM sources WHERE enabled = 1 AND next_fetch_at <= ? ORDER BY next_fetch_at, id`, [now()]);
  const results: FetchOutcome[] = [];
  let idx = 0;
  const worker = async () => {
    while (idx < due.length && !signal?.aborted) {
      const s = due[idx++] as SourceRow;
      const r = await fetchSource(db, coins, s, now);
      if (!r.ok) log.warn(`source ${s.id}: ${r.error}`);
      results.push(r);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, due.length) }, worker));
  return results;
}
