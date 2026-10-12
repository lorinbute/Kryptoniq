// Optional Claude engine (TD §6.3): batches of headlines → structured scores. Any failure falls back to local.
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import type { Logger } from '../log.ts';
import { clampScore, labelFor, type ScoredItem, type SentimentEngine, type SentimentInput } from './engine.ts';

export const CLAUDE_BATCH = 25;

const resultSchema = z.object({
  results: z.array(
    z.object({
      n: z.number().describe('The headline number from the input list'),
      score: z.number().describe('Sentiment for crypto and risk-asset prices, from -1 (very bearish) to 1 (very bullish); 0 when neutral or irrelevant'),
      impact: z.number().describe('Expected market impact: 1 = minor, 2 = notable, 3 = major market mover'),
    }),
  ),
});

const SYSTEM = [
  'You rate financial and crypto news headlines for a day trader.',
  'For each numbered headline, judge how it is likely to move crypto and risk-asset (stock) prices today.',
  'Think like a macro-aware trader: rate cuts, cooling inflation, ETF inflows, approvals and adoption are bullish;',
  'rate hikes, hot inflation, rising yields, a strong dollar, hacks, liquidations, lawsuits, bans, war and tariffs are bearish;',
  'educational pieces, scheduled events without new information and routine announcements are neutral (0).',
  'Return one result for every headline number.',
].join(' ');

export interface ClaudeEngineOptions {
  apiKey: string;
  model: string;
  log: Logger;
  /** Test hook. */
  client?: Pick<Anthropic, 'beta'>;
}

const RETRY_AFTER_ERROR_MS = 5 * 60_000;

export interface ClaudeStatus {
  model: string;
  lastError: { at: number; message: string; permanent: boolean } | null;
  pausedUntil: number | null;
}

export class ClaudeEngine implements SentimentEngine {
  readonly id: string;
  private readonly client: Pick<Anthropic, 'beta'>;
  private readonly model: string;
  private readonly fallback: SentimentEngine;
  private readonly log: Logger;
  /** Circuit breaker: an invalid key stops Claude calls for good (until the key changes), other errors for 5 minutes. */
  private pausedUntil = 0;
  private lastError: ClaudeStatus['lastError'] = null;

  constructor(opts: ClaudeEngineOptions, fallback: SentimentEngine) {
    this.model = opts.model;
    this.id = `claude:${opts.model}`;
    this.log = opts.log;
    this.fallback = fallback;
    this.client = opts.client ?? new Anthropic({ apiKey: opts.apiKey, maxRetries: 2, timeout: 60_000 });
  }

  status(): ClaudeStatus {
    return { model: this.model, lastError: this.lastError, pausedUntil: this.pausedUntil > Date.now() ? this.pausedUntil : null };
  }

  async score(items: SentimentInput[], signal?: AbortSignal): Promise<ScoredItem[]> {
    const out: ScoredItem[] = [];
    for (let i = 0; i < items.length; i += CLAUDE_BATCH) {
      if (signal?.aborted) break;
      const batch = items.slice(i, i + CLAUDE_BATCH);
      let scored: ScoredItem[] = [];
      if (Date.now() >= this.pausedUntil) {
        try {
          scored = await this.scoreBatch(batch, signal);
          this.lastError = null;
        } catch (err) {
          const permanent = err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError;
          this.lastError = { at: Date.now(), message: describeError(err), permanent };
          this.pausedUntil = permanent ? Number.POSITIVE_INFINITY : Date.now() + RETRY_AFTER_ERROR_MS;
          this.log.warn(`Claude sentiment failed, using local engine: ${describeError(err)}`);
        }
      }
      const done = new Set(scored.map((s) => s.id));
      const missing = batch.filter((b) => !done.has(b.id));
      if (missing.length) scored.push(...(await this.fallback.score(missing, signal)));
      out.push(...scored);
    }
    return out;
  }

  private async scoreBatch(batch: SentimentInput[], signal?: AbortSignal): Promise<ScoredItem[]> {
    const list = batch.map((b, idx) => `${idx + 1}. ${b.title.replace(/\s+/g, ' ').slice(0, 300)}`).join('\n');
    const supportsFallback = !this.model.includes('haiku');
    const response = await this.client.beta.messages.parse(
      {
        model: this.model,
        max_tokens: 4096,
        system: SYSTEM,
        messages: [{ role: 'user', content: `Headlines:\n${list}` }],
        output_config: { effort: 'low', format: betaZodOutputFormat(resultSchema) },
        ...(supportsFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      },
      { signal },
    );
    if (response.stop_reason === 'refusal') throw new Error('request declined (refusal)');
    const parsed = response.parsed_output;
    if (!parsed) throw new Error(`no structured output (stop_reason=${response.stop_reason})`);
    const out: ScoredItem[] = [];
    const seen = new Set<number>();
    for (const r of parsed.results) {
      const n = Math.round(r.n);
      const item = batch[n - 1];
      if (!item || seen.has(n)) continue;
      seen.add(n);
      const score = clampScore(r.score);
      out.push({
        id: item.id,
        score,
        label: labelFor(score),
        engine: this.id,
        meta: { impact: Math.max(1, Math.min(3, Math.round(r.impact))) },
      });
    }
    return out;
  }
}

function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'cheia API Anthropic este invalidă';
  if (err instanceof Anthropic.PermissionDeniedError) return 'cheia API nu are acces la acest model';
  if (err instanceof Anthropic.RateLimitError) return 'limită de cereri Anthropic atinsă';
  if (err instanceof Anthropic.BadRequestError) return `cerere respinsă: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return 'nu se poate conecta la Anthropic';
  if (err instanceof Anthropic.APIError) return `eroare Anthropic ${err.status ?? ''}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}
