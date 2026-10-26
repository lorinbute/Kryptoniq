// A user's own AI scoring the news (FD-AIKEYS §2, TD-AIKEYS §4), the former Claude engine for any provider: batches of
// headlines → a score and an importance each. A failed call leaves the items for later; an answer the model would not
// or could not give leaves them to the local score (stored with no score: they are not sent again).
import { z } from 'zod';
import { aiEngineId } from '../../shared/ai.ts';
import type { Logger } from '../log.ts';
import { AiError, aiErrorLine, describeAiError, type AiClient } from '../ai/types.ts';
import { clampScore, labelFor, type SentimentInput } from './engine.ts';

export const AI_BATCH = 25;
/** How long a batch may take (FD-AISLOW §1): a busy provider can take a minute or two to answer. */
export const AI_CALL_TIMEOUT_MS = 180_000;
const RETRY_AFTER_ERROR_MS = 5 * 60_000;
const RETRY_AFTER_QUOTA_MS = 30 * 60_000;
/** After a passing error (FD-AISLOW §2): a minute, doubled with each one in a row, at most a quarter of an hour. */
export const PASSING_PAUSE_MS = 60_000;
export const PASSING_PAUSE_MAX_MS = 15 * 60_000;
/** A batch answered slower than this is noted in the log (FD-AISLOW §5). */
const SLOW_ANSWER_MS = 60_000;

const resultSchema = z.object({
  results: z.array(
    z.object({
      n: z.number().describe('The headline number from the input list'),
      score: z.number().describe('Sentiment for crypto and risk-asset prices, from -1 (very bearish) to 1 (very bullish); 0 when neutral or irrelevant'),
      impact: z.number().describe('Expected market impact: 1 = minor, 2 = notable, 3 = major market mover'),
      // FD-WHYPLAIN §3 (required: OpenAI's strict schemas allow no optional field; empty when there is nothing to say).
      reason: z.string().describe('Why this score, in Romanian: one short sentence, at most 120 characters'),
    }),
  ),
});

export const SCORE_SYSTEM = [
  'You rate financial and crypto news headlines for a day trader.',
  'For each numbered headline, judge how it is likely to move crypto and risk-asset (stock) prices today.',
  'Think like a macro-aware trader: rate cuts, cooling inflation, ETF inflows, approvals and adoption are bullish;',
  'rate hikes, hot inflation, rising yields, a strong dollar, hacks, liquidations, lawsuits, bans, war and tariffs are bearish;',
  'educational pieces, scheduled events without new information and routine announcements are neutral (0).',
  'For each headline, also give the reason for its score in Romanian: one short plain sentence (at most 120 characters).',
  'Return one result for every headline number.',
].join(' ');

/** FD-WHYPLAIN §3: the longest reason kept (the model is asked for 120 characters). */
export const REASON_MAX = 160;

/** The model's reason, trimmed and cut; none when it gave an empty one. */
export function cleanReason(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const t = s.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.length > REASON_MAX ? `${t.slice(0, REASON_MAX - 1).trimEnd()}…` : t;
}

/** One item's AI score; `score` null: the model gave none (the local score stands). */
export interface AiScore {
  id: string;
  score: number | null;
  label: string | null;
  impact: number | null;
  engine: string;
  /** Why the score, in Romanian (FD-WHYPLAIN §3); null without one. */
  reason: string | null;
}

export interface AiScorerStatus {
  provider: string;
  model: string;
  lastError: {
    at: number;
    message: string;
    permanent: boolean;
    /** The provider's own words (FD-AIQUOTA; absent from states saved before it). */
    detail?: string | null;
    /** When the daily limit refused resets (FD-AIQUOTA). */
    resetsAt?: number | null;
    /** A busy or slow provider, tried again soon (FD-AISLOW §2; absent from states saved before it). */
    passing?: boolean;
  } | null;
  pausedUntil: number | null;
  /** Failed calls in a row since the last answer (FD-AISLOW §2; absent from states saved before it). */
  failures?: number;
}

export interface AiScorerOptions {
  client: AiClient;
  log: Logger;
  /** Told after every answered call: the headlines sent and the tokens counted (FD-AICLARITY). */
  onUsage?: (use: { items: number; input: number; output: number }) => void;
  /** Told when the state changes (an error, the end of one): kept where every instance can read it. */
  onState?: (status: AiScorerStatus) => void;
  /** The state saved before a restart (FD-AIQUOTA §2): its pause holds, and its error goes at the first answer. */
  restored?: Pick<AiScorerStatus, 'lastError' | 'pausedUntil' | 'failures'> | null;
  now?: () => number;
}

export class AiScorer {
  readonly engine: string;
  private readonly client: AiClient;
  private readonly log: Logger;
  private readonly onUsage: AiScorerOptions['onUsage'];
  private readonly onState: AiScorerOptions['onState'];
  private readonly now: () => number;
  /** Circuit breaker: a refused key or model stops the calls for good (until they change), other errors for a while. */
  private pausedUntil = 0;
  private lastError: AiScorerStatus['lastError'] = null;
  /** Failed calls since the last answer: the pause after a passing error grows with them. */
  private failures = 0;

  constructor(opts: AiScorerOptions) {
    this.client = opts.client;
    this.engine = aiEngineId(opts.client.provider, opts.client.model);
    this.log = opts.log;
    this.onUsage = opts.onUsage;
    this.onState = opts.onState;
    this.now = opts.now ?? Date.now;
    if (opts.restored) {
      this.lastError = opts.restored.lastError;
      // A state saved before FD-AISLOW has no count: its error was at least one.
      this.failures = opts.restored.failures ?? (opts.restored.lastError ? 1 : 0);
      this.pausedUntil = opts.restored.lastError?.permanent ? Number.POSITIVE_INFINITY : (opts.restored.pausedUntil ?? 0);
    }
  }

  status(): AiScorerStatus {
    return {
      provider: this.client.provider,
      model: this.client.model,
      lastError: this.lastError,
      pausedUntil: this.pausedUntil > this.now() ? this.pausedUntil : null,
      failures: this.failures,
    };
  }

  paused(): boolean {
    return this.now() < this.pausedUntil;
  }

  /** Tries again at the next run (the user saved their key or AI choice again); the error stays until an answer. */
  resume(): void {
    this.pausedUntil = 0;
    this.failures = 0;
  }

  /** Scores what it can, batch by batch; stops at the first failed call (the rest waits for the next run). */
  async score(items: SentimentInput[], signal?: AbortSignal): Promise<AiScore[]> {
    const out: AiScore[] = [];
    for (let i = 0; i < items.length; i += AI_BATCH) {
      if (signal?.aborted || this.paused()) break;
      const batch = items.slice(i, i + AI_BATCH);
      try {
        out.push(...(await this.scoreBatch(batch, signal)));
        if (this.lastError || this.failures > 0) {
          this.lastError = null;
          this.failures = 0;
          this.onState?.(this.status());
        }
      } catch (err) {
        if (signal?.aborted) break;
        const ai = err instanceof AiError ? err : null;
        const permanent = ai?.permanent ?? false;
        const passing = ai?.passing ?? false;
        this.failures++;
        const wait = permanent
          ? Number.POSITIVE_INFINITY
          : ai?.kind === 'quota'
            ? RETRY_AFTER_QUOTA_MS
            : passing
              ? Math.min(PASSING_PAUSE_MAX_MS, PASSING_PAUSE_MS * 2 ** (this.failures - 1))
              : RETRY_AFTER_ERROR_MS;
        this.lastError = { at: this.now(), message: describeAiError(err), permanent, detail: ai?.detail ?? null, resetsAt: ai?.resetsAt ?? null, passing };
        this.pausedUntil = this.now() + wait;
        this.onState?.(this.status());
        this.log.warn(`AI scoring (${this.engine}) failed, the local scores stand meanwhile: ${aiErrorLine(err)}`);
        break;
      }
    }
    return out;
  }

  private async scoreBatch(batch: SentimentInput[], signal?: AbortSignal): Promise<AiScore[]> {
    const list = batch.map((b, idx) => `${idx + 1}. ${b.title.replace(/\s+/g, ' ').slice(0, 300)}`).join('\n');
    const started = this.now();
    const answer = await this.client.generate({
      system: SCORE_SYSTEM,
      prompt: `Headlines:\n${list}`,
      schema: resultSchema,
      name: 'headline_scores',
      maxTokens: 8192,
      effort: 'low',
      timeoutMs: AI_CALL_TIMEOUT_MS,
      signal,
    });
    const took = this.now() - started;
    if (took > SLOW_ANSWER_MS) this.log.info(`AI scoring (${this.engine}): ${batch.length} headlines answered in ${Math.round(took / 1000)} s`);
    // Billed whatever the answer: counted before it is read.
    if (answer.usage) this.onUsage?.({ items: batch.length, input: answer.usage.input, output: answer.usage.output });
    const scored = new Map<string, AiScore>();
    if (answer.parsed) {
      for (const r of answer.parsed.results) {
        const item = batch[Math.round(r.n) - 1];
        if (!item || scored.has(item.id)) continue;
        const score = clampScore(r.score);
        const impact = Number.isFinite(r.impact) ? Math.max(1, Math.min(3, Math.round(r.impact))) : null;
        scored.set(item.id, { id: item.id, score, label: labelFor(score), impact, engine: this.engine, reason: cleanReason(r.reason) });
      }
    } else {
      this.log.warn(`AI scoring (${this.engine}): no usable answer (${answer.stop}); the local scores stand for ${batch.length} headlines`);
    }
    // What the model left out (or would not answer) keeps the local score and is not sent again.
    return batch.map((b) => scored.get(b.id) ?? { id: b.id, score: null, label: null, impact: null, engine: this.engine, reason: null });
  }
}
