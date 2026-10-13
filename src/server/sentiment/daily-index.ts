// "Sentiment of the day" (TD §6.4). Pure: the same input always gives the same index.
import type { SourceCategory } from '../news/sources.ts';

export interface IndexItem {
  id: string;
  title: string;
  url: string | null;
  sourceId: string;
  sourceName: string;
  sourceWeight: number;
  category: SourceCategory;
  publishedAt: number;
  relevance: number;
  impact: number;
  flags: string[];
  clusterId: string;
  /** null = not scored yet (pending). */
  sentiment: number | null;
}

export interface IndexParams {
  halfLifeH: number;
  shrinkK: number;
  gamma: number;
  sourceCap: number;
  clusterBoost: number;
}

export const DEFAULT_INDEX_PARAMS: IndexParams = { halfLifeH: 8, shrinkK: 4, gamma: 1.6, sourceCap: 0.25, clusterBoost: 0.5 };

export type Confidence = 'low' | 'medium' | 'high';

export interface Driver {
  id: string;
  title: string;
  url: string | null;
  source: string;
  sentiment: number;
  contribution: number;
  publishedAt: number;
  /** For the topic icon (FD-ICONS). Snapshots saved before 12 Oct 2026 lack these two fields. */
  category?: SourceCategory;
  /** Coins the item is about; filled in by DailySentimentService (the pure index has no coin data). */
  coins?: string[];
}

export interface SubIndex {
  index: number;
  raw: number;
  weight: number;
  count: number;
}

export interface IndexResult {
  index: number;
  raw: number;
  weight: number;
  confidence: Confidence;
  counts: { positive: number; neutral: number; negative: number; pending: number; excluded: number };
  breakdown: Record<SourceCategory, SubIndex>;
  drivers: { positive: Driver[]; negative: Driver[] };
}

const LABEL_T = 0.2;

export function specFactor(flags: string[]): number {
  if (flags.includes('sponsored')) return 0.2;
  if (flags.includes('speculative') || flags.includes('recap')) return 0.5;
  return 1;
}

export function confidenceFor(weight: number): Confidence {
  if (weight < 3) return 'low';
  if (weight < 10) return 'medium';
  return 'high';
}

export function toIndex(raw: number, weight: number, p: IndexParams): number {
  const shrunk = weight > 0 ? (raw * weight) / (weight + p.shrinkK) : 0;
  const idx = 50 + 50 * Math.tanh(p.gamma * shrunk);
  return Math.round(idx * 10) / 10;
}

/** Scales sources so none exceeds `cap` of the total (waterfall), when ≥ 4 sources contribute. */
export function capSourceShares(weights: Map<string, number>, cap: number): Map<string, number> {
  const out = new Map(weights);
  const active = [...out.values()].filter((w) => w > 0).length;
  if (active < 4 || cap <= 0 || cap >= 1) return out;
  for (let iter = 0; iter < 10; iter++) {
    const total = [...out.values()].reduce((a, b) => a + b, 0);
    if (total <= 0) return out;
    const limit = cap * total;
    const over = [...out.entries()].filter(([, w]) => w > limit * (1 + 1e-9));
    if (over.length === 0) break;
    // Solve for the cap level L so that every source above it is clipped and L = cap * newTotal.
    const sorted = [...out.values()].sort((a, b) => b - a);
    let clipped = 0;
    let L = limit;
    for (let k = 1; k <= sorted.length; k++) {
      const rest = sorted.slice(k).reduce((a, b) => a + b, 0);
      // k sources clipped to L: L = cap * (k * L + rest) → L = cap * rest / (1 - cap * k)
      const denom = 1 - cap * k;
      if (denom <= 0) break;
      const cand = (cap * rest) / denom;
      if ((sorted[k - 1] as number) > cand && (k === sorted.length || (sorted[k] as number) <= cand)) {
        L = cand;
        clipped = k;
        break;
      }
    }
    if (clipped === 0) break;
    for (const [k, w] of out) if (w > L) out.set(k, L);
  }
  return out;
}

interface Weighted {
  item: IndexItem;
  w: number;
  s: number;
}

function weigh(items: IndexItem[], asOf: number, p: IndexParams): Weighted[] {
  const clusterSize = new Map<string, number>();
  for (const it of items) clusterSize.set(it.clusterId, (clusterSize.get(it.clusterId) ?? 0) + 1);
  const halfLifeMs = p.halfLifeH * 3_600_000;
  return items.map((it) => {
    const age = Math.max(0, asOf - it.publishedAt);
    const decay = Math.pow(0.5, age / halfLifeMs);
    const n = clusterSize.get(it.clusterId) ?? 1;
    const base = it.relevance * it.impact * it.sourceWeight * specFactor(it.flags) * decay;
    const w = (base * (1 + p.clusterBoost * Math.log2(n))) / n;
    return { item: it, w: Number.isFinite(w) && w > 0 ? w : 0, s: it.sentiment as number };
  });
}

function aggregate(rows: Weighted[], p: IndexParams): { raw: number; weight: number; rows: Weighted[] } {
  const bySource = new Map<string, number>();
  for (const r of rows) bySource.set(r.item.sourceId, (bySource.get(r.item.sourceId) ?? 0) + r.w);
  const capped = capSourceShares(bySource, p.sourceCap);
  const scaled = rows.map((r) => {
    const orig = bySource.get(r.item.sourceId) ?? 0;
    const factor = orig > 0 ? (capped.get(r.item.sourceId) ?? 0) / orig : 0;
    return { ...r, w: r.w * factor };
  });
  const W = scaled.reduce((a, r) => a + r.w, 0);
  const raw = W > 0 ? scaled.reduce((a, r) => a + r.w * r.s, 0) / W : 0;
  return { raw, weight: W, rows: scaled };
}

export function computeIndex(allItems: IndexItem[], window: { start: number; end: number }, asOf: number, p: IndexParams = DEFAULT_INDEX_PARAMS): IndexResult {
  const inWindow = allItems.filter((it) => it.publishedAt >= window.start && it.publishedAt < window.end && it.publishedAt <= asOf);
  const counts = { positive: 0, neutral: 0, negative: 0, pending: 0, excluded: 0 };
  const eligible: IndexItem[] = [];
  for (const it of inWindow) {
    if (it.relevance <= 0) {
      counts.excluded++;
      continue;
    }
    if (it.sentiment === null || !Number.isFinite(it.sentiment)) {
      counts.pending++;
      continue;
    }
    if (it.sentiment > LABEL_T) counts.positive++;
    else if (it.sentiment < -LABEL_T) counts.negative++;
    else counts.neutral++;
    eligible.push(it);
  }
  const weighted = weigh(eligible, asOf, p);
  const total = aggregate(weighted, p);

  const breakdown = {} as Record<SourceCategory, SubIndex>;
  for (const cat of ['crypto', 'macro', 'geopolitics', 'stocks'] as const) {
    const sub = aggregate(
      weighted.filter((r) => r.item.category === cat),
      p,
    );
    breakdown[cat] = { index: toIndex(sub.raw, sub.weight, p), raw: sub.raw, weight: sub.weight, count: sub.rows.length };
  }

  const contributions = total.rows
    .filter((r) => r.w > 0 && r.s !== 0)
    .map((r) => ({
      id: r.item.id,
      title: r.item.title,
      url: r.item.url,
      source: r.item.sourceName,
      sentiment: r.s,
      contribution: total.weight > 0 ? (r.w * r.s) / total.weight : 0,
      publishedAt: r.item.publishedAt,
      category: r.item.category,
    }));
  const positive = contributions
    .filter((c) => c.contribution > 0)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 5);
  const negative = contributions
    .filter((c) => c.contribution < 0)
    .sort((a, b) => a.contribution - b.contribution)
    .slice(0, 5);

  return {
    index: toIndex(total.raw, total.weight, p),
    raw: total.raw,
    weight: total.weight,
    confidence: confidenceFor(total.weight),
    counts,
    breakdown,
    drivers: { positive, negative },
  };
}

/** Index at the end of each elapsed hour of the window (plus `asOf` for a partial last hour). */
export function intradaySeries(items: IndexItem[], window: { start: number; end: number }, asOf: number, p: IndexParams = DEFAULT_INDEX_PARAMS): { t: number; index: number; count: number }[] {
  const out: { t: number; index: number; count: number }[] = [];
  const last = Math.min(asOf, window.end);
  for (let t = window.start + 3_600_000; t <= last; t += 3_600_000) {
    const r = computeIndex(items, window, t, p);
    out.push({ t, index: r.index, count: r.counts.positive + r.counts.neutral + r.counts.negative });
  }
  if (out.length === 0 || (out.at(-1) as { t: number }).t < last) {
    const r = computeIndex(items, window, last, p);
    out.push({ t: last, index: r.index, count: r.counts.positive + r.counts.neutral + r.counts.negative });
  }
  return out;
}
