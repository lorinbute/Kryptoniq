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
  /** FD-SCOREWHY: what gave the item its score, for today's drivers as served (never stored). */
  why?: ScoreWhy;
  /** FD-WHYPLAIN, as served: the index without this item (unrounded), and how much it moved it. */
  without?: number;
  effect?: number;
  /** FD-WHYPLAIN, as served: why it weighs what it weighs. */
  weighs?: { relevance: number; impact: number; sourceWeight: number; spec: number; flags: string[]; decay: number; clusterN: number; cap: number; share: number };
}

/** "De ce acest scor?" (FD-SCOREWHY): the engine and its details, and what weighs the item, as the News page shows them. */
export interface ScoreWhy {
  engine: string;
  /** The local engine's details (model score, rules); null for an AI's score. */
  meta: unknown;
  relevance: number;
  /** The importance the index used: the AI's where it gave one, else the keywords'. */
  impact: number;
  impactSource: 'ai' | 'rules';
  ruleImpact: number;
  /** The AI's reason for the score, in Romanian (FD-WHYPLAIN §3); null for a local score or one given before. */
  reason?: string | null;
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
const SPEC = { sponsored: 0.2, speculative: 0.5, recap: 0.5 } as const;
const CONFIDENCE = { medium: 3, high: 10 } as const;

export function specFactor(flags: string[]): number {
  if (flags.includes('sponsored')) return SPEC.sponsored;
  if (flags.includes('speculative') || flags.includes('recap')) return SPEC.speculative;
  return 1;
}

export function confidenceFor(weight: number): Confidence {
  if (weight < CONFIDENCE.medium) return 'low';
  if (weight < CONFIDENCE.high) return 'medium';
  return 'high';
}

export function toIndex(raw: number, weight: number, p: IndexParams): number {
  return Math.round(indexValue(raw, weight, p) * 10) / 10;
}

/** The index before its rounding to 0.1 (FD-WHYPLAIN: one item's effect is often a tenth of a point). */
export function indexValue(raw: number, weight: number, p: IndexParams): number {
  const shrunk = weight > 0 ? (raw * weight) / (weight + p.shrinkK) : 0;
  return 50 + 50 * Math.tanh(p.gamma * shrunk);
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
  /** The terms of `w` besides the item's own relevance, importance and source weight (FD-INDEXWHY). */
  decay: number;
  clusterN: number;
  cluster: number;
  spec: number;
  /** The source cap's factor on `w` (1 when the cap did not touch the source); set by `aggregate`. */
  cap: number;
}

function weigh(items: IndexItem[], asOf: number, p: IndexParams): Weighted[] {
  const clusterSize = new Map<string, number>();
  for (const it of items) clusterSize.set(it.clusterId, (clusterSize.get(it.clusterId) ?? 0) + 1);
  const halfLifeMs = p.halfLifeH * 3_600_000;
  return items.map((it) => {
    const age = Math.max(0, asOf - it.publishedAt);
    const decay = Math.pow(0.5, age / halfLifeMs);
    const n = clusterSize.get(it.clusterId) ?? 1;
    const spec = specFactor(it.flags);
    const base = it.relevance * it.impact * it.sourceWeight * spec * decay;
    // In this order (as before FD-INDEXWHY): the same weights to the last digit, so the history stays as it was.
    const w = (base * (1 + p.clusterBoost * Math.log2(n))) / n;
    const cluster = (1 + p.clusterBoost * Math.log2(n)) / n;
    return { item: it, w: Number.isFinite(w) && w > 0 ? w : 0, s: it.sentiment as number, decay, clusterN: n, cluster, spec, cap: 1 };
  });
}

function aggregate(rows: Weighted[], p: IndexParams): { raw: number; weight: number; rows: Weighted[]; bySource: Map<string, number>; capped: Map<string, number> } {
  const bySource = new Map<string, number>();
  for (const r of rows) bySource.set(r.item.sourceId, (bySource.get(r.item.sourceId) ?? 0) + r.w);
  const capped = capSourceShares(bySource, p.sourceCap);
  const scaled = rows.map((r) => {
    const orig = bySource.get(r.item.sourceId) ?? 0;
    // A source weighing nothing has nothing to cap (its items weigh 0 either way): its factor stays 1.
    const factor = orig > 0 ? (capped.get(r.item.sourceId) ?? 0) / orig : 1;
    return { ...r, w: r.w * factor, cap: factor };
  });
  const W = scaled.reduce((a, r) => a + r.w, 0);
  const raw = W > 0 ? scaled.reduce((a, r) => a + r.w * r.s, 0) / W : 0;
  return { raw, weight: W, rows: scaled, bySource, capped };
}

type Counts = IndexResult['counts'];

/** The day's items as the index takes them: in the window up to `asOf`; the irrelevant left out, the unscored waiting. */
function select(allItems: IndexItem[], window: { start: number; end: number }, asOf: number): { counts: Counts; eligible: IndexItem[] } {
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
  return { counts, eligible };
}

function breakdownOf(weighted: Weighted[], p: IndexParams): Record<SourceCategory, SubIndex> {
  const breakdown = {} as Record<SourceCategory, SubIndex>;
  for (const cat of ['crypto', 'macro', 'geopolitics', 'stocks'] as const) {
    const sub = aggregate(
      weighted.filter((r) => r.item.category === cat),
      p,
    );
    breakdown[cat] = { index: toIndex(sub.raw, sub.weight, p), raw: sub.raw, weight: sub.weight, count: sub.rows.length };
  }
  return breakdown;
}

export function computeIndex(allItems: IndexItem[], window: { start: number; end: number }, asOf: number, p: IndexParams = DEFAULT_INDEX_PARAMS): IndexResult {
  const { counts, eligible } = select(allItems, window, asOf);
  const weighted = weigh(eligible, asOf, p);
  const total = aggregate(weighted, p);
  const breakdown = breakdownOf(weighted, p);

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

/** The rules besides `IndexParams` (FD-INDEXWHY: shown with the explanation). */
export const INDEX_RULES = { labelT: LABEL_T, confidence: CONFIDENCE, spec: SPEC } as const;

export interface ExplainItem {
  id: string;
  title: string;
  url: string | null;
  source: string;
  category: SourceCategory;
  publishedAt: number;
  flags: string[];
  sentiment: number;
  relevance: number;
  impact: number;
  sourceWeight: number;
  spec: number;
  decay: number;
  clusterN: number;
  cluster: number;
  cap: number;
  /** relevance × impact × sourceWeight × spec × decay × cluster × cap. */
  weight: number;
  /** weight ÷ the day's total weight. */
  share: number;
  /** weight × sentiment ÷ the total weight: the item's part of the weighted mean (they add up to `raw`). */
  contribution: number;
}

export interface IndexExplain {
  counts: Counts;
  /** `value`: the index before rounding. */
  total: { raw: number; weight: number; shrunk: number; index: number; value: number; confidence: Confidence };
  breakdown: Record<SourceCategory, SubIndex>;
  /** Each source with items today: their weight before (`base`) and after the cap; heaviest first. */
  sources: { id: string; name: string; sourceWeight: number; count: number; base: number; weight: number }[];
  /** At least 4 sources weigh: the cap applies (it may still touch none). */
  capActive: boolean;
  /** Every item that counts, heaviest first. */
  items: ExplainItem[];
}

/** FD-INDEXWHY: `computeIndex` step by step, from the same selection, weighing and cap (the same numbers). */
export function explainIndex(allItems: IndexItem[], window: { start: number; end: number }, asOf: number, p: IndexParams = DEFAULT_INDEX_PARAMS): IndexExplain {
  const { counts, eligible } = select(allItems, window, asOf);
  const weighted = weigh(eligible, asOf, p);
  const total = aggregate(weighted, p);
  const W = total.weight;
  const shrunk = W > 0 ? (total.raw * W) / (W + p.shrinkK) : 0;
  const names = new Map(eligible.map((it) => [it.sourceId, it.sourceName]));
  const sourceWeights = new Map(eligible.map((it) => [it.sourceId, it.sourceWeight]));
  const sourceCount = new Map<string, number>();
  for (const it of eligible) sourceCount.set(it.sourceId, (sourceCount.get(it.sourceId) ?? 0) + 1);
  const sources = [...total.bySource.keys()]
    .map((id) => ({ id, name: names.get(id) ?? id, sourceWeight: sourceWeights.get(id) ?? 1, count: sourceCount.get(id) ?? 0, base: total.bySource.get(id) ?? 0, weight: total.capped.get(id) ?? 0 }))
    .sort((a, b) => b.weight - a.weight || b.base - a.base || a.name.localeCompare(b.name));
  const items = total.rows
    .map((r) => ({
      id: r.item.id,
      title: r.item.title,
      url: r.item.url,
      source: r.item.sourceName,
      category: r.item.category,
      publishedAt: r.item.publishedAt,
      flags: r.item.flags,
      sentiment: r.s,
      relevance: r.item.relevance,
      impact: r.item.impact,
      sourceWeight: r.item.sourceWeight,
      spec: r.spec,
      decay: r.decay,
      clusterN: r.clusterN,
      cluster: r.cluster,
      cap: r.cap,
      weight: r.w,
      share: W > 0 ? r.w / W : 0,
      contribution: W > 0 ? (r.w * r.s) / W : 0,
    }))
    .sort((a, b) => b.weight - a.weight || b.publishedAt - a.publishedAt || a.id.localeCompare(b.id));
  return {
    counts,
    total: { raw: total.raw, weight: W, shrunk, index: toIndex(total.raw, W, p), value: indexValue(total.raw, W, p), confidence: confidenceFor(W) },
    breakdown: breakdownOf(weighted, p),
    sources,
    capActive: [...total.bySource.values()].filter((w) => w > 0).length >= 4,
    items,
  };
}

/**
 * FD-WHYPLAIN: how much each of these items moved the index: the index computed again without it (the same selection,
 * weighing, cap and pull towards neutral), unrounded. `effect` = the index − `without`.
 */
export function effects(allItems: IndexItem[], window: { start: number; end: number }, asOf: number, ids: string[], p: IndexParams = DEFAULT_INDEX_PARAMS): Map<string, { without: number; effect: number }> {
  const valueOf = (items: IndexItem[]) => {
    const t = aggregate(weigh(select(items, window, asOf).eligible, asOf, p), p);
    return indexValue(t.raw, t.weight, p);
  };
  const full = valueOf(allItems);
  const out = new Map<string, { without: number; effect: number }>();
  for (const id of ids) {
    const without = valueOf(allItems.filter((it) => it.id !== id));
    out.set(id, { without, effect: full - without });
  }
  return out;
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
