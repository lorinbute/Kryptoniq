// Stores parsed feed items: dedup, coin tagging, classification, clustering (TD §5.7).
import { createHash } from 'node:crypto';
import type { Db } from '../db/database.ts';
import { BIN } from '../db/schema.ts';
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

async function loadCandidates(db: Db, now: number): Promise<ClusterCandidate[]> {
  const rows = await db.all<{ id: string; cluster_id: string; title: string; coins: string | null }>(
    `SELECT n.id, n.cluster_id, n.title, (SELECT STRING_AGG(coin, ',') FROM news_coins c WHERE c.news_id = n.id AND c.coin NOT LIKE N'#%') AS coins
     FROM news n WHERE n.published_at >= ? ORDER BY n.published_at, n.id`,
    [now - CLUSTER_WINDOW_MS],
  );
  return rows.map((r) => ({ id: r.id, clusterId: r.cluster_id, tokens: titleTokens(r.title), coins: r.coins ? r.coins.split(',') : [] }));
}

export interface IngestResult {
  inserted: number;
  updated: number;
  skipped: number;
}

interface NewsInsert {
  id: string;
  source_id: string;
  guid: string | null;
  url: string | null;
  canonical_url: string | null;
  title: string;
  summary: string;
  published_at: number;
  fetched_at: number;
  category: string;
  relevance: number;
  impact: number;
  flags: string;
  cluster_id: string;
}

/** Many rows in one statement (TD-AZURE §4): the rows go as one JSON parameter, read back with OPENJSON. */
const INSERT_NEWS = `INSERT INTO news(id, source_id, guid, url, canonical_url, title, summary, published_at, fetched_at, category, relevance, impact, flags, cluster_id)
SELECT id, source_id, guid, url, canonical_url, title, summary, published_at, fetched_at, category, relevance, impact, flags, cluster_id
FROM OPENJSON(?) WITH (id nvarchar(64), source_id nvarchar(200), guid nvarchar(max), url nvarchar(max), canonical_url nvarchar(max), title nvarchar(max),
  summary nvarchar(max), published_at bigint, fetched_at bigint, category nvarchar(20), relevance float, impact float, flags nvarchar(max), cluster_id nvarchar(64))`;

/** Replaces the coins of the given news (`[{ news_id, coin }]`, unique pairs). */
export async function writeNewsCoins(db: Db, ids: readonly string[], pairs: readonly { news_id: string; coin: string }[]): Promise<void> {
  if (ids.length) await db.run(`DELETE FROM news_coins WHERE news_id IN (SELECT value COLLATE ${BIN} FROM OPENJSON(?))`, [JSON.stringify(ids)]);
  if (pairs.length) await db.run('INSERT INTO news_coins(news_id, coin) SELECT news_id, coin FROM OPENJSON(?) WITH (news_id nvarchar(64), coin nvarchar(64))', [JSON.stringify(pairs)]);
}

const coinPairs = (id: string, coins: readonly string[]) => [...new Set(coins)].map((coin) => ({ news_id: id, coin }));

/**
 * `detector` tags the news (`news_coins`); `classifier` gives the coins that weigh them in the common sentiment
 * (FD-USERS §2: the coin list and the admin's favourites; the same detector when there is only one).
 */
export async function ingestItems(
  db: Db,
  source: Pick<SourceRow, 'id' | 'category'>,
  items: ParsedItem[],
  detector: CoinDetector,
  now: number,
  classifier: CoinDetector = detector,
): Promise<IngestResult> {
  const weigh = (title: string, summary: string, coins: string[]) =>
    classify(source.category, title, summary, classifier === detector ? coins : detectCoins(classifier, title, summary));
  const res: IngestResult = { inserted: 0, updated: 0, skipped: 0 };
  if (items.length === 0) return res;
  // One item per id (the first), in feed order.
  const batch: { item: ParsedItem; id: string }[] = [];
  const seenInBatch = new Set<string>();
  for (const item of items) {
    const id = newsId(source.id, item);
    if (seenInBatch.has(id)) {
      res.skipped++;
      continue;
    }
    seenInBatch.add(id);
    batch.push({ item, id });
  }
  await db.tx(async () => {
    const candidates = await loadCandidates(db, now);
    const existing = new Map(
      (await db.all<{ id: string; title: string }>(`SELECT id, title FROM news WHERE id IN (SELECT value COLLATE ${BIN} FROM OPENJSON(?))`, [JSON.stringify(batch.map((b) => b.id))])).map((r) => [
        r.id,
        r.title,
      ]),
    );
    // Duplicates across sources: the same canonical address already stored (found through its hash, TD-AZURE §3).
    const wanted = [...new Set(batch.filter((b) => !existing.has(b.id)).map((b) => canonicalUrl(b.item.link)).filter((c): c is string => !!c))];
    const canonicals = new Set(
      wanted.length
        ? (
            await db.all<{ canonical_url: string }>(
              "SELECT canonical_url FROM news WHERE canonical_hash IN (SELECT CAST(HASHBYTES('SHA2_256', value) AS BINARY(32)) FROM OPENJSON(?))",
              [JSON.stringify(wanted)],
            )
          ).map((r) => r.canonical_url)
        : [],
    );
    const inserts: NewsInsert[] = [];
    const insertCoins: { news_id: string; coin: string }[] = [];
    for (const { item, id } of batch) {
      const canonical = canonicalUrl(item.link);
      const title = existing.get(id);
      if (title !== undefined) {
        if (title !== item.title) {
          const coins = detectCoins(detector, item.title, item.summary);
          const cls = weigh(item.title, item.summary, coins);
          await db.run(
            `UPDATE news SET title = ?, summary = ?, relevance = ?, impact = ?, flags = ?,
               sentiment = NULL, sentiment_label = NULL, sentiment_engine = NULL, sentiment_meta = NULL, sentiment_impact = NULL, scored_at = NULL
             WHERE id = ?`,
            [item.title, item.summary, cls.relevance, cls.impact, JSON.stringify(cls.flags), id],
          );
          // The users' own AI scores were of the old title (FD-AIKEYS): scored again.
          await db.run('DELETE FROM news_ai_scores WHERE news_id = ?', [id]);
          await writeNewsCoins(db, [id], coinPairs(id, coins));
          res.updated++;
        } else {
          res.skipped++;
        }
        continue;
      }
      if (canonical && canonicals.has(canonical)) {
        res.skipped++;
        continue;
      }
      const publishedAt = effectivePublishedAt(item.publishedAt, now);
      if (publishedAt === null) {
        res.skipped++;
        continue;
      }
      const coins = detectCoins(detector, item.title, item.summary);
      const cls = weigh(item.title, item.summary, coins);
      const tokens = titleTokens(item.title);
      // The same story by its words and its tickers, not by the index tags (FD-INDEXNEWS: "#CO", "#SPX").
      const named = coins.filter((c) => !c.startsWith('#'));
      const clusterId = findCluster(tokens, named, candidates) ?? id;
      inserts.push({
        id,
        source_id: source.id,
        guid: item.guid,
        url: item.link,
        canonical_url: canonical,
        title: item.title,
        summary: item.summary,
        published_at: publishedAt,
        fetched_at: now,
        category: source.category,
        relevance: cls.relevance,
        impact: cls.impact,
        flags: JSON.stringify(cls.flags),
        cluster_id: clusterId,
      });
      insertCoins.push(...coinPairs(id, coins));
      if (canonical) canonicals.add(canonical);
      candidates.push({ id, clusterId, tokens, coins: named });
      res.inserted++;
    }
    if (inserts.length) await db.run(INSERT_NEWS, [JSON.stringify(inserts)]);
    if (insertCoins.length) await writeNewsCoins(db, [], insertCoins);
  });
  return res;
}

/**
 * Re-tags the news of a period without re-classifying them (FD-INDEXNEWS §5: the member lists changed): only `news_coins`,
 * so relevance and importance, and the common index, stay as they were.
 */
export async function retagCoins(db: Db, detector: CoinDetector, from: number, to: number): Promise<number> {
  const rows = await db.all<{ id: string; title: string; summary: string }>('SELECT id, title, summary FROM news WHERE published_at >= ? AND published_at < ?', [from, to]);
  if (!rows.length) return 0;
  const tagged = rows.map((r) => ({ id: r.id, coins: detectCoins(detector, r.title, r.summary) }));
  await db.tx(() =>
    writeNewsCoins(
      db,
      tagged.map((t) => t.id),
      tagged.flatMap((t) => coinPairs(t.id, t.coins)),
    ),
  );
  return rows.length;
}

/** Re-tags coins and re-classifies recent news (after the coin list or the watchlist changes); see `ingestItems`. */
export async function retagRecent(db: Db, detector: CoinDetector, since: number, classifier: CoinDetector = detector): Promise<number> {
  const rows = await db.all<{ id: string; title: string; summary: string; category: SourceCategory }>('SELECT id, title, summary, category FROM news WHERE published_at >= ?', [since]);
  if (!rows.length) return 0;
  const updates = rows.map((r) => {
    const coins = detectCoins(detector, r.title, r.summary);
    const cls = classify(r.category, r.title, r.summary, classifier === detector ? coins : detectCoins(classifier, r.title, r.summary));
    return { id: r.id, relevance: cls.relevance, impact: cls.impact, flags: JSON.stringify(cls.flags), coins };
  });
  await db.tx(async () => {
    await db.run(
      `UPDATE n SET relevance = j.relevance, impact = j.impact, flags = j.flags
       FROM news n JOIN OPENJSON(?) WITH (id nvarchar(64), relevance float, impact float, flags nvarchar(max)) j ON n.id = j.id COLLATE ${BIN}`,
      [JSON.stringify(updates.map(({ coins: _c, ...u }) => u))],
    );
    await writeNewsCoins(
      db,
      updates.map((u) => u.id),
      updates.flatMap((u) => coinPairs(u.id, u.coins)),
    );
  });
  return rows.length;
}
