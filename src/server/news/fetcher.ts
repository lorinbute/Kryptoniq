// Fetches due sources with conditional requests and exponential backoff (TD §5.1, §4).
import type { Db } from '../db/database.ts';
import type { Logger } from '../log.ts';
import { fetchText, HttpError } from '../net/http.ts';
import type { CoinRegistry } from './coin-registry.ts';
import { ingestItems } from './ingest.ts';
import { FeedParseError, parseFeed } from './parser.ts';
import type { SourceRow } from './sources.ts';

export const FETCH_INTERVAL_MS = 5 * 60_000;
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

export async function fetchSource(db: Db, coins: CoinRegistry, source: SourceRow, now: () => number = Date.now): Promise<FetchOutcome> {
  const start = now();
  db.run('UPDATE sources SET last_attempt_at = ? WHERE id = ?', [start, source.id]);
  try {
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
      const r = ingestItems(db, source, items, coins.get(), now(), coins.classifier());
      inserted = r.inserted;
    }
    const t = now();
    db.run(
      `UPDATE sources SET last_success_at = ?, last_error = NULL, failures = 0, next_fetch_at = ?,
         etag = COALESCE(?, etag), last_modified = COALESCE(?, last_modified),
         last_new_item_at = CASE WHEN ? > 0 THEN ? ELSE last_new_item_at END,
         item_count = (SELECT count(*) FROM news WHERE source_id = ?)
       WHERE id = ?`,
      [t, t + FETCH_INTERVAL_MS, res.etag, res.lastModified, inserted, t, source.id, source.id],
    );
    return { sourceId: source.id, ok: true, inserted, notModified: res.notModified };
  } catch (err) {
    const code = err instanceof HttpError || err instanceof FeedParseError ? err.code : 'ERROR';
    const msg = `${code}: ${(err as Error).message}`.slice(0, 300);
    const failures = source.failures + 1;
    db.run('UPDATE sources SET last_error = ?, failures = ?, next_fetch_at = ? WHERE id = ?', [msg, failures, now() + backoffMs(failures), source.id]);
    return { sourceId: source.id, ok: false, inserted: 0, error: msg };
  }
}

/** Fetches every enabled source that is due, CONCURRENCY at a time. */
export async function fetchDueSources(db: Db, coins: CoinRegistry, log: Logger, signal?: AbortSignal, now: () => number = Date.now): Promise<FetchOutcome[]> {
  const due = db.all<SourceRow>('SELECT * FROM sources WHERE enabled = 1 AND next_fetch_at <= ? ORDER BY next_fetch_at', [now()]);
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
