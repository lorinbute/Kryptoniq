// News listing with filters (FD §2.2). Filters affect only what is shown, never the daily sentiment.
import { z } from 'zod';
import { addDays, dayBounds, dayKey } from '../../shared/time.ts';
import type { Db } from '../db/database.ts';

export const newsQuerySchema = z.object({
  range: z.enum(['24h', 'today', 'yesterday', '7d']).default('24h'),
  coins: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',').map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(c)) : [])),
  favorites: z
    .enum(['0', '1', 'true', 'false'])
    .optional()
    .transform((v) => v === '1' || v === 'true'),
  category: z.enum(['crypto', 'macro', 'geopolitics', 'stocks']).optional(),
  source: z.string().max(80).optional(),
  sentiment: z.enum(['positive', 'neutral', 'negative', 'pending']).optional(),
  q: z.string().trim().max(100).optional(),
  cursor: z
    .string()
    .regex(/^\d+:[0-9a-f]{40}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type NewsQuery = z.infer<typeof newsQuerySchema>;

export interface NewsItemDto {
  id: string;
  title: string;
  summary: string;
  url: string | null;
  source: { id: string; name: string };
  category: string;
  publishedAt: number;
  /** When Sentiq first saw the item (drives the "nou" badge). */
  fetchedAt: number;
  coins: string[];
  relevance: number;
  /** The importance the daily index uses (FD-IMPACT §1): the engine's (Claude) when it gave one, else the keywords'. */
  impact: number;
  impactSource: 'ai' | 'rules';
  /** The importance by keywords (shown next to Claude's when they differ). */
  ruleImpact: number;
  flags: string[];
  sentiment: { score: number; label: string; engine: string; meta: unknown } | null;
  clusterId: string;
  related: { id: string; title: string; url: string | null; source: string; publishedAt: number }[];
}

export interface NewsPage {
  items: NewsItemDto[];
  nextCursor: string | null;
  range: { from: number; to: number };
  favorites: string[];
}

interface Row {
  id: string;
  title: string;
  summary: string;
  url: string | null;
  source_id: string;
  source_name: string;
  category: string;
  published_at: number;
  fetched_at: number;
  relevance: number;
  impact: number;
  sentiment_impact: number | null;
  flags: string;
  sentiment: number | null;
  sentiment_label: string | null;
  sentiment_engine: string | null;
  sentiment_meta: string | null;
  cluster_id: string;
  coins: string | null;
}

const safeJson = (s: string | null, fallback: unknown): unknown => {
  if (!s) return fallback;
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
};

export function rangeBounds(range: NewsQuery['range'], tz: string, now: number): { from: number; to: number } {
  switch (range) {
    case 'today':
      return { from: dayBounds(dayKey(now, tz), tz).start, to: now + 5 * 60_000 };
    case 'yesterday': {
      const b = dayBounds(addDays(dayKey(now, tz), -1), tz);
      return { from: b.start, to: b.end };
    }
    case '7d':
      return { from: now - 7 * 86_400_000, to: now + 5 * 60_000 };
    default:
      return { from: now - 86_400_000, to: now + 5 * 60_000 };
  }
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

/** `userId`: whose favourites the "favourites only" filter uses (FD-USERS §2); the news themselves are common. */
export function queryNews(db: Db, q: NewsQuery, tz: string, userId: number, now = Date.now()): NewsPage {
  const { from, to } = rangeBounds(q.range, tz, now);
  const favorites = db.all<{ coin: string }>('SELECT coin FROM watchlist WHERE user_id = ? ORDER BY position, coin', [userId]).map((r) => r.coin);
  let coins = q.coins;
  if (q.favorites) coins = coins.length ? coins.filter((c) => favorites.includes(c)) : favorites;
  const where: string[] = ['s.enabled = 1', 'n.published_at >= ?', 'n.published_at < ?'];
  const params: (string | number)[] = [from, to];
  if (q.favorites && coins.length === 0) return { items: [], nextCursor: null, range: { from, to }, favorites };
  if (coins.length) {
    where.push(`n.id IN (SELECT news_id FROM news_coins WHERE coin IN (${coins.map(() => '?').join(',')}))`);
    params.push(...coins);
  }
  if (q.category) {
    where.push('n.category = ?');
    params.push(q.category);
  }
  if (q.source) {
    where.push('n.source_id = ?');
    params.push(q.source);
  }
  if (q.sentiment === 'pending') where.push('n.sentiment_engine IS NULL');
  else if (q.sentiment) {
    where.push('n.sentiment_label = ?');
    params.push(q.sentiment);
  }
  if (q.q) {
    where.push("(n.title LIKE ? ESCAPE '\\' OR n.summary LIKE ? ESCAPE '\\')");
    const like = `%${escapeLike(q.q)}%`;
    params.push(like, like);
  }
  if (q.cursor) {
    const [t, id] = q.cursor.split(':') as [string, string];
    where.push('(n.published_at < ? OR (n.published_at = ? AND n.id < ?))');
    params.push(Number(t), Number(t), id);
  }
  const rows = db.all<Row>(
    `SELECT n.id, n.title, n.summary, n.url, n.source_id, s.name AS source_name, n.category, n.published_at, n.fetched_at, n.relevance, n.impact, n.sentiment_impact, n.flags,
            n.sentiment, n.sentiment_label, n.sentiment_engine, n.sentiment_meta, n.cluster_id,
            (SELECT group_concat(coin) FROM news_coins c WHERE c.news_id = n.id) AS coins
     FROM news n JOIN sources s ON s.id = n.source_id
     WHERE ${where.join(' AND ')}
     ORDER BY n.published_at DESC, n.id DESC
     LIMIT ?`,
    [...params, q.limit + 1],
  );
  const hasMore = rows.length > q.limit;
  const page = rows.slice(0, q.limit);

  // Group the page by story: keep the newest item, attach the others (from any source) as `related`.
  const clusterIds = [...new Set(page.map((r) => r.cluster_id))];
  const members = new Map<string, NewsItemDto['related']>();
  if (clusterIds.length) {
    const all = db.all<{ id: string; title: string; url: string | null; source_name: string; published_at: number; cluster_id: string }>(
      `SELECT n.id, n.title, n.url, s.name AS source_name, n.published_at, n.cluster_id
       FROM news n JOIN sources s ON s.id = n.source_id
       WHERE s.enabled = 1 AND n.cluster_id IN (${clusterIds.map(() => '?').join(',')})
       ORDER BY n.published_at DESC`,
      clusterIds,
    );
    for (const m of all) {
      const list = members.get(m.cluster_id) ?? [];
      list.push({ id: m.id, title: m.title, url: m.url, source: m.source_name, publishedAt: m.published_at });
      members.set(m.cluster_id, list);
    }
  }
  const seen = new Set<string>();
  const items: NewsItemDto[] = [];
  for (const r of page) {
    if (seen.has(r.cluster_id)) continue;
    seen.add(r.cluster_id);
    items.push({
      id: r.id,
      title: r.title,
      summary: r.summary,
      url: r.url,
      source: { id: r.source_id, name: r.source_name },
      category: r.category,
      publishedAt: r.published_at,
      fetchedAt: r.fetched_at,
      coins: r.coins ? r.coins.split(',').sort() : [],
      relevance: r.relevance,
      impact: r.sentiment_impact ?? r.impact,
      impactSource: r.sentiment_impact !== null ? 'ai' : 'rules',
      ruleImpact: r.impact,
      flags: safeJson(r.flags, []) as string[],
      sentiment:
        r.sentiment_engine !== null && r.sentiment !== null
          ? { score: r.sentiment, label: r.sentiment_label ?? 'neutral', engine: r.sentiment_engine, meta: safeJson(r.sentiment_meta, null) }
          : null,
      clusterId: r.cluster_id,
      related: (members.get(r.cluster_id) ?? []).filter((m) => m.id !== r.id),
    });
  }
  const last = page.at(-1);
  return { items, nextCursor: hasMore && last ? `${last.published_at}:${last.id}` : null, range: { from, to }, favorites };
}
