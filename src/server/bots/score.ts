// The market's score for a Slingshot bot (FD-BOT §6, FD-BOTDIR): five parts, each a lean a in −1 (down) … +1 (up),
// weighed; 50 is neutral, high favours longs, low shorts. Each side has its threshold.
import { WEIGHT_KEYS, type BotSide, type PremiumConfig, type ScorePart, type WeightKey } from '../../shared/bot.ts';
import type { Confidence } from '../sentiment/daily-index.ts';

export interface ScoreInputs {
  /** Today's index, all categories. */
  day: { index: number; confidence: Confidence } | null;
  /** Today's index of the area (Crypto or Acțiuni) and how many news it rests on. */
  area: { index: number; count: number } | null;
  /** The mean of the last 7 days' index. */
  general: number | null;
  /** The index of the news about the symbol in the last 24 h. */
  symbol: { index: number; confidence: Confidence; count: number } | null;
  /** The last break of the market structure (no R:R: Slingshot's levels are taken as they are, FD-BOTSLRR). */
  slingshot: { structure: 'up' | 'down' | 'none' };
}

const CONFIDENCE: Record<Confidence, number> = { high: 1, medium: 0.75, low: 0.5 };
const clamp = (v: number, lo = -1, hi = 1) => Math.min(hi, Math.max(lo, v));
/** How sure the area's index is, by its news: ≥ 10 → 1, 3–9 → 0.75, 1–2 → 0.5. */
export const areaConfidence = (count: number): number => (count >= 10 ? 1 : count >= 3 ? 0.75 : 0.5);

/** The words of an index (as the app's: ≥ 60 positive, < 40 negative). */
export const indexWord = (v: number): string => (v >= 60 ? 'pozitiv' : v < 40 ? 'negativ' : 'neutru');

/** Rounded as shown, so a refusal never reads "61 e peste 61". */
const round1 = (v: number) => Math.round(v * 10) / 10;
/** What the structure weighs beside the sentiment (it weighed as much beside the R:R, the R:R gone: FD-BOTSLRR). */
const STRUCTURE = 0.4;

/** The same for either side: what the market says, not whether it agrees with a trade (FD-BOTDIR). */
export function marketScore(x: ScoreInputs, weights: Record<WeightKey, number>): { score: number; parts: ScorePart[] } {
  const lean = (index: number) => (index - 50) / 50;
  const ms = x.slingshot.structure === 'up' ? 1 : x.slingshot.structure === 'down' ? -1 : 0;
  const parts: Record<WeightKey, Omit<ScorePart, 'key' | 'weight'> | null> = {
    day: x.day ? { value: x.day.index, a: clamp(lean(x.day.index) * CONFIDENCE[x.day.confidence]), note: `${indexWord(x.day.index)}, încredere ${x.day.confidence === 'high' ? 'mare' : x.day.confidence === 'medium' ? 'medie' : 'mică'}` } : null,
    area: x.area && x.area.count > 0 ? { value: x.area.index, a: clamp(lean(x.area.index) * areaConfidence(x.area.count)), note: `${indexWord(x.area.index)}, ${x.area.count} ${x.area.count === 1 ? 'știre' : 'știri'}` } : null,
    general: x.general !== null ? { value: x.general, a: clamp(lean(x.general)), note: `media pe 7 zile, ${indexWord(x.general)}` } : null,
    symbol: x.symbol && x.symbol.count > 0 ? { value: x.symbol.index, a: clamp(lean(x.symbol.index) * CONFIDENCE[x.symbol.confidence]), note: `${indexWord(x.symbol.index)}, ${x.symbol.count} ${x.symbol.count === 1 ? 'știre' : 'știri'} în 24 h` } : null,
    slingshot: {
      value: ms,
      a: STRUCTURE * ms,
      note: x.slingshot.structure === 'up' ? 'ultima rupere în sus' : x.slingshot.structure === 'down' ? 'ultima rupere în jos' : 'fără rupere de structură',
    },
  };
  let sum = 0;
  let total = 0;
  const out: ScorePart[] = [];
  for (const key of WEIGHT_KEYS) {
    const p = parts[key];
    const weight = weights[key];
    if (!p) {
      out.push({ key, value: null, a: 0, weight, note: 'fără date' });
      continue;
    }
    out.push({ key, ...p, weight });
    sum += weight * p.a;
    total += weight;
  }
  return { score: round1(total > 0 ? 50 + (50 * sum) / total : 50), parts: out };
}

/** The side's threshold: a long enters from it up, a short from it down. */
export const limitOf = (side: BotSide, cfg: Pick<PremiumConfig, 'longMin' | 'shortMax'>): number => (side === 'long' ? cfg.longMin : cfg.shortMax);

/** The shown score within the side's threshold, the threshold itself included. */
export const passes = (side: BotSide, score: number, cfg: Pick<PremiumConfig, 'longMin' | 'shortMax'>): boolean => (side === 'long' ? score >= cfg.longMin : score <= cfg.shortMax);

/** How much the market favours the side: two signals on one bar are tried in this order. */
export const favoured = (side: BotSide, score: number): number => (side === 'long' ? score : 100 - score);

/**
 * The highest score the weights allow, every part at its end (an index at 100 with full confidence, the structure up);
 * the lowest is 100 minus it. A part with no data never raises it.
 */
export function scoreReach(weights: Record<WeightKey, number>): number {
  const total = WEIGHT_KEYS.reduce((a, k) => a + weights[k], 0);
  if (total <= 0) return 50;
  const top = WEIGHT_KEYS.reduce((a, k) => a + weights[k] * (k === 'slingshot' ? STRUCTURE : 1), 0);
  return round1(50 + (50 * top) / total);
}

/** The area against the trade (FD-BOT §6, check 5): a long with a negative area, a short with a positive one. */
export function areaAgainst(side: BotSide, area: ScoreInputs['area']): boolean {
  if (!area || area.count === 0) return false;
  return side === 'long' ? area.index < 40 : area.index >= 60;
}
