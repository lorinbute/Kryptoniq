// Common types for sentiment engines (TD §6.1).

export type SentimentLabel = 'positive' | 'neutral' | 'negative';

export interface SentimentInput {
  id: string;
  title: string;
  summary: string;
}

export interface ScoredItem {
  id: string;
  /** −1 … +1, from the point of view of crypto / risk-asset prices. */
  score: number;
  label: SentimentLabel;
  /** Engine that actually produced the score: 'local', 'rules' or 'claude:<model>'. */
  engine: string;
  meta: Record<string, unknown>;
}

export interface SentimentEngine {
  readonly id: string;
  score(items: SentimentInput[], signal?: AbortSignal): Promise<ScoredItem[]>;
}

export const LABEL_THRESHOLD = 0.2;

export function labelFor(score: number): SentimentLabel {
  if (score > LABEL_THRESHOLD) return 'positive';
  if (score < -LABEL_THRESHOLD) return 'negative';
  return 'neutral';
}

export const clampScore = (x: number): number => (Number.isFinite(x) ? Math.max(-1, Math.min(1, x)) : 0);

/** Weight of the domain rules when they fire (the model gets the rest). */
export const RULES_WEIGHT = 0.6;

export function combine(modelScore: number | null, rulesScore: number, ruleHits: number): number {
  if (modelScore === null) return clampScore(rulesScore);
  if (ruleHits === 0) return clampScore(modelScore);
  return clampScore(RULES_WEIGHT * rulesScore + (1 - RULES_WEIGHT) * modelScore);
}
