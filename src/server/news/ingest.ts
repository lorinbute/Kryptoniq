// Stores parsed feed items: dedup, coin tagging, classification, clustering (TD §5.7).
import { createHash } from 'node:crypto';
import type { Db } from '../db/database.ts';
import { BIN } from '../db/schema.ts';
import { readJobData, writeJobData } from '../jobs/scheduler.ts';
import { classify, type Classification } from './classify.ts';
import { categorize, isCompany, sourceCategories, subjectOf, type NewsCategory } from './categorize.ts';
import { INSTITUTIONS, macroVerdict } from './macro.ts';
import { findCluster, titleTokens, type ClusterCandidate } from './cluster.ts';
import { detectCoins, type CoinDetector } from './coins.ts';
import { canonicalUrl, effectivePublishedAt } from './normalize.ts';
import type { ParsedItem } from './parser.ts';
import type { SourceRow } from './sources.ts';

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

/** FD-MACRORULES: how many companies a title names (the institutions commenting on the economy left out). */
export function companiesInTitle(title: string, detector: CoinDetector): number {
  return detector.detect(title.replace(INSTITUTIONS, ' ')).filter((s) => isCompany(s, (x) => detector.isCrypto(x))).length;
}

const outOfIndex = (cls: Classification): Classification => ({ ...cls, relevance: 0, flags: cls.flags.includes('lowRelevance') ? cls.flags : [...cls.flags, 'lowRelevance'] });

/**
 * The category and the weighing of an item (FD-MULTICAT): a source of one category gives it that one; a source of several,
 * the one the item speaks of (an item about none of them: the source's first, relevance 0, so out of the index).
 * FD-MACRORULES: an item is macro only by the user's rules; one that would be macro without them goes to its subject
 * (crypto, stocks, geopolitics) or, about none, to "other" (relevance 0).
 * `coins`: the tagging detector's (they name the subject); `weighCoins`: the classifier's (they weigh it).
 */
export function weighItem(
  source: Pick<SourceRow, 'category'> & { categories?: string | null },
  title: string,
  summary: string,
  coins: string[],
  weighCoins: string[],
  detector: CoinDetector,
): Classification & { category: NewsCategory } {
  const isCrypto = (s: string) => detector.isCrypto(s);
  const allowed = sourceCategories(source);
  const macro = macroVerdict(title, summary, companiesInTitle(title, detector));
  const { category, matched } = allowed.length === 1 ? { category: source.category, matched: true } : categorize(title, summary, coins, allowed, isCrypto, macro);
  if (category === 'macro' && !macro.macro) {
    const subject = subjectOf(title, summary, coins, isCrypto);
    if (subject) return { category: subject, ...classify(subject, title, summary, weighCoins) };
    return { category: 'other', ...outOfIndex(classify('macro', title, summary, weighCoins)) };
  }
  const cls = classify(category, title, summary, weighCoins);
  return matched ? { category, ...cls } : { category, ...outOfIndex(cls) };
}

/**
 * `detector` tags the news (`news_coins`); `classifier` gives the coins that weigh them in the common sentiment
 * (FD-USERS §2: the coin list and the admin's favourites; the same detector when there is only one).
 */
export async function ingestItems(
  db: Db,
  // `categories` absent: a source of one category (as before FD-MULTICAT).
  source: Pick<SourceRow, 'id' | 'category'> & { categories?: string | null },
  items: ParsedItem[],
  detector: CoinDetector,
  now: number,
  classifier: CoinDetector = detector,
): Promise<IngestResult> {
  const weigh = (title: string, summary: string, coins: string[]) =>
    weighItem(source, title, summary, coins, classifier === detector ? coins : detectCoins(classifier, title, summary), detector);
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
          // A new title may be about another category (FD-MULTICAT); one category: the source's, as before.
          await db.run(
            `UPDATE news SET title = ?, summary = ?, category = ?, relevance = ?, impact = ?, flags = ?,
               sentiment = NULL, sentiment_label = NULL, sentiment_engine = NULL, sentiment_meta = NULL, sentiment_impact = NULL, scored_at = NULL
             WHERE id = ?`,
            [item.title, item.summary, cls.category, cls.relevance, cls.impact, JSON.stringify(cls.flags), id],
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
        category: cls.category,
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

/**
 * Re-tags coins and re-classifies recent news (after the coin list or the watchlist changes); see `ingestItems`. An item
 * of a source of one category keeps its category; of a source of several, it is chosen again (FD-MULTICAT).
 */
export async function retagRecent(db: Db, detector: CoinDetector, since: number, classifier: CoinDetector = detector): Promise<number> {
  return reclassify(db, detector, classifier, 'n.published_at >= ?', [since]);
}

/** FD-MULTICAT: every stored item of a source classified again (its categories changed). */
export async function reclassifySource(db: Db, sourceId: string, detector: CoinDetector, classifier: CoinDetector = detector): Promise<number> {
  return reclassify(db, detector, classifier, 'n.source_id = ?', [sourceId]);
}

async function reclassify(db: Db, detector: CoinDetector, classifier: CoinDetector, where: string, params: (string | number)[]): Promise<number> {
  // FD-MACRORULES: the source's category, not the item's (an item moved off macro keeps following its source's rules).
  const rows = await db.all<{ id: string; title: string; summary: string; category: SourceRow['category']; categories: string | null }>(
    `SELECT n.id, n.title, n.summary, s.category, s.categories FROM news n JOIN sources s ON s.id = n.source_id WHERE ${where}`,
    params,
  );
  if (!rows.length) return 0;
  // In batches: every stored item at once (FD-MACRORULES' upgrade) would make one very large update.
  for (let i = 0; i < rows.length; i += RECLASSIFY_BATCH) await reclassifyRows(db, detector, classifier, rows.slice(i, i + RECLASSIFY_BATCH));
  return rows.length;
}

const RECLASSIFY_BATCH = 500;

async function reclassifyRows(
  db: Db,
  detector: CoinDetector,
  classifier: CoinDetector,
  rows: { id: string; title: string; summary: string; category: SourceRow['category']; categories: string | null }[],
): Promise<void> {
  const updates = rows.map((r) => {
    const coins = detectCoins(detector, r.title, r.summary);
    const cls = weighItem({ category: r.category, categories: r.categories }, r.title, r.summary, coins, classifier === detector ? coins : detectCoins(classifier, r.title, r.summary), detector);
    return { id: r.id, category: cls.category, relevance: cls.relevance, impact: cls.impact, flags: JSON.stringify(cls.flags), coins };
  });
  await db.tx(async () => {
    await db.run(
      `UPDATE n SET category = j.category, relevance = j.relevance, impact = j.impact, flags = j.flags
       FROM news n JOIN OPENJSON(?) WITH (id nvarchar(64), category nvarchar(20), relevance float, impact float, flags nvarchar(max)) j ON n.id = j.id COLLATE ${BIN}`,
      [JSON.stringify(updates.map(({ coins: _c, ...u }) => u))],
    );
    await writeNewsCoins(
      db,
      updates.map((u) => u.id),
      updates.flatMap((u) => coinPairs(u.id, u.coins)),
    );
  });
}

/** FD-MACRORULES: the version of the rules the stored news were classified with (kept in the daily job's data). */
export const CLASSIFY_VERSION = 2;

/**
 * Once after an update that changes how news are classified: every stored item classified again, before the history is
 * recomputed (the daily job runs this first). True when it ran.
 */
export async function upgradeClassification(db: Db, detector: CoinDetector, classifier: CoinDetector, job: string): Promise<boolean> {
  const state = await readJobData(db, job, { classifyVersion: 1 } as Record<string, unknown> & { classifyVersion: number });
  if (state.classifyVersion >= CLASSIFY_VERSION) return false;
  await reclassify(db, detector, classifier, '1 = 1', []);
  await writeJobData(db, job, { ...state, classifyVersion: CLASSIFY_VERSION });
  return true;
}
