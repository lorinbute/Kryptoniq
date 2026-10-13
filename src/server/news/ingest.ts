// Stores parsed feed items: dedup, coin tagging, classification, clustering (TD §5.7).
import { createHash } from 'node:crypto';
import type { Db } from '../db/database.ts';
import { classify } from './classify.ts';
import { findCluster, titleTokens, type ClusterCandidate } from './cluster.ts';
import { detectCoins, type CoinDetector } from './coins.ts';
import { canonicalUrl, effectivePublishedAt } from './normalize.ts';
import type { ParsedItem } from './parser.ts';
import type { SourceCategory, SourceRow } from './sources.ts';

export const CLUSTER_WINDOW_MS = 36 * 3_600_000;

export const newsId = (sourceId: string, item: Pick<ParsedItem, 'guid' | 'link' | 'title'>): string =>
  createHash('sha1')
    .update(`${sourceId}|${item.guid || canonicalUrl(item.link) || item.title}`)
    .digest('hex');

function loadCandidates(db: Db, now: number): ClusterCandidate[] {
  const rows = db.all<{ id: string; cluster_id: string; title: string; coins: string | null }>(
    `SELECT n.id, n.cluster_id, n.title, (SELECT group_concat(coin) FROM news_coins c WHERE c.news_id = n.id) AS coins
     FROM news n WHERE n.published_at >= ?`,
    [now - CLUSTER_WINDOW_MS],
  );
  return rows.map((r) => ({ id: r.id, clusterId: r.cluster_id, tokens: titleTokens(r.title), coins: r.coins ? r.coins.split(',') : [] }));
}

export interface IngestResult {
  inserted: number;
  updated: number;
  skipped: number;
}

/**
 * `detector` tags the news (`news_coins`); `classifier` gives the coins that weigh them in the common sentiment
 * (FD-USERS §2: the coin list and the admin's favourites; the same detector when there is only one).
 */
export function ingestItems(
  db: Db,
  source: Pick<SourceRow, 'id' | 'category'>,
  items: ParsedItem[],
  detector: CoinDetector,
  now: number,
  classifier: CoinDetector = detector,
): IngestResult {
  const weigh = (title: string, summary: string, coins: string[]) =>
    classify(source.category, title, summary, classifier === detector ? coins : detectCoins(classifier, title, summary));
  const res: IngestResult = { inserted: 0, updated: 0, skipped: 0 };
  if (items.length === 0) return res;
  db.tx(() => {
    const candidates = loadCandidates(db, now);
    const seenInBatch = new Set<string>();
    for (const item of items) {
      const id = newsId(source.id, item);
      if (seenInBatch.has(id)) {
        res.skipped++;
        continue;
      }
      seenInBatch.add(id);
      const canonical = canonicalUrl(item.link);
      const existing = db.get<{ id: string; title: string; published_at: number }>('SELECT id, title, published_at FROM news WHERE id = ?', [id]);
      if (existing) {
        if (existing.title !== item.title) {
          const coins = detectCoins(detector, item.title, item.summary);
          const cls = weigh(item.title, item.summary, coins);
          db.run(
            `UPDATE news SET title = ?, summary = ?, relevance = ?, impact = ?, flags = ?,
               sentiment = NULL, sentiment_label = NULL, sentiment_engine = NULL, sentiment_meta = NULL, sentiment_impact = NULL, scored_at = NULL
             WHERE id = ?`,
            [item.title, item.summary, cls.relevance, cls.impact, JSON.stringify(cls.flags), id],
          );
          db.run('DELETE FROM news_coins WHERE news_id = ?', [id]);
          for (const c of coins) db.run('INSERT OR IGNORE INTO news_coins(news_id, coin) VALUES (?, ?)', [id, c]);
          res.updated++;
        } else {
          res.skipped++;
        }
        continue;
      }
      if (canonical) {
        const dup = db.get<{ id: string }>('SELECT id FROM news WHERE canonical_url = ? LIMIT 1', [canonical]);
        if (dup) {
          res.skipped++;
          continue;
        }
      }
      const publishedAt = effectivePublishedAt(item.publishedAt, now);
      if (publishedAt === null) {
        res.skipped++;
        continue;
      }
      const coins = detectCoins(detector, item.title, item.summary);
      const cls = weigh(item.title, item.summary, coins);
      const tokens = titleTokens(item.title);
      const clusterId = findCluster(tokens, coins, candidates) ?? id;
      db.run(
        `INSERT INTO news(id, source_id, guid, url, canonical_url, title, summary, published_at, fetched_at, category,
                          relevance, impact, flags, cluster_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, source.id, item.guid, item.link, canonical, item.title, item.summary, publishedAt, now, source.category, cls.relevance, cls.impact, JSON.stringify(cls.flags), clusterId],
      );
      for (const c of coins) db.run('INSERT OR IGNORE INTO news_coins(news_id, coin) VALUES (?, ?)', [id, c]);
      candidates.push({ id, clusterId, tokens, coins });
      res.inserted++;
    }
  });
  return res;
}

/** Re-tags coins and re-classifies recent news (after the coin list or the watchlist changes); see `ingestItems`. */
export function retagRecent(db: Db, detector: CoinDetector, since: number, classifier: CoinDetector = detector): number {
  const rows = db.all<{ id: string; title: string; summary: string; category: SourceCategory }>(
    'SELECT id, title, summary, category FROM news WHERE published_at >= ?',
    [since],
  );
  db.tx(() => {
    for (const r of rows) {
      const coins = detectCoins(detector, r.title, r.summary);
      const cls = classify(r.category, r.title, r.summary, classifier === detector ? coins : detectCoins(classifier, r.title, r.summary));
      db.run('UPDATE news SET relevance = ?, impact = ?, flags = ? WHERE id = ?', [cls.relevance, cls.impact, JSON.stringify(cls.flags), r.id]);
      db.run('DELETE FROM news_coins WHERE news_id = ?', [r.id]);
      for (const c of coins) db.run('INSERT OR IGNORE INTO news_coins(news_id, coin) VALUES (?, ?)', [r.id, c]);
    }
  });
  return rows.length;
}
