// Scores the news. The local model scores every item for everyone (the common score, on the news row: pending while
// sentiment_engine IS NULL); since FD-AIKEYS a user who chose so has their own AI score the last days' news too, with
// their key, kept apart (news_ai_scores) and used for them alone in place of the common score.
import { createHash } from 'node:crypto';
import type { Db } from '../db/database.ts';
import { BIN } from '../db/schema.ts';
import type { Logger } from '../log.ts';
import type { AiService } from '../ai/service.ts';
import { AiScorer, type AiScorerStatus } from './ai-scorer.ts';
import type { SentimentEngine, SentimentInput } from './engine.ts';
import { LocalEngine, type NliScorer } from './local.ts';

/** While the local model is (down)loading we wait this long before falling back to rules-only. */
export const MODEL_WAIT_MS = 3 * 60_000;
export const RESCORE_AFTER_MODEL_MS = 48 * 3_600_000;
/** How far back a user's AI scores the news: today and yesterday, the days whose index can still change. */
export const AI_WINDOW_MS = 48 * 3_600_000;
/** Headlines one user's AI scores per run (two batches): every user gets their turn. */
export const AI_PER_RUN = 50;
/**
 * Where the state of a user's AI scoring is kept (`market_cache`): the instance running the jobs scores, but the user's
 * page may be served by the other one (the Mac and Azure).
 */
export const scorerStateKey = (userId: number) => `ai:scorer:${userId}`;

interface StoredScorerState {
  /** Provider, model and key the state is about: another one starts clean. */
  sig: string;
  lastError: AiScorerStatus['lastError'];
  /** null: no pause; a refused key or model pauses until they change (`lastError.permanent`). */
  pausedUntil: number | null;
}

const signatureOf = (provider: string, model: string, key: string) => `${provider}|${model}|${createHash('sha256').update(key).digest('hex').slice(0, 16)}`;

export class SentimentService {
  private readonly local: LocalEngine;
  private readonly scorers = new Map<number, { sig: string; scorer: AiScorer }>();
  /** Each user's state writes, one after the other (an error and its end never land in the wrong order). */
  private readonly stateWrites = new Map<number, Promise<void>>();
  private loadingSince: number | null = null;
  private readonly db: Db;
  private readonly ai: AiService;
  private readonly nli: NliScorer;
  private readonly log: Logger;

  constructor(db: Db, ai: AiService, nli: NliScorer, log: Logger) {
    this.db = db;
    this.ai = ai;
    this.nli = nli;
    this.log = log;
    this.local = new LocalEngine(nli);
    nli.onReady(() => {
      // Items scored by the rules-only fallback get a proper score now.
      void this.reset(Date.now() - RESCORE_AFTER_MODEL_MS, 'rules').then(
        (n) => {
          if (n > 0) this.log.info(`model ready: ${n} rules-only scores queued for rescoring`);
        },
        (err: unknown) => this.log.warn(`model ready, but the rules-only scores were not queued: ${(err as Error).message}`),
      );
    });
  }

  /** The engine of the common score: always the local one since FD-AIKEYS. */
  engine(): SentimentEngine {
    return this.local;
  }

  async pendingCount(): Promise<number> {
    return (await this.db.get<{ n: number }>('SELECT count(*) AS n FROM news WHERE sentiment_engine IS NULL'))?.n ?? 0;
  }

  /** The common score: up to `limit` pending items, newest first. Returns how many were scored. */
  async scorePending(signal?: AbortSignal, limit = 64): Promise<number> {
    const st = this.nli.status().state;
    if (st === 'idle') this.nli.warmUp();
    if (st === 'idle' || st === 'loading') {
      this.loadingSince ??= Date.now();
      if (Date.now() - this.loadingSince < MODEL_WAIT_MS) return 0;
    } else {
      this.loadingSince = null;
    }
    const rows = await this.db.all<SentimentInput & { title_now: string }>(
      `SELECT TOP (?) id, title, summary, title AS title_now FROM news WHERE sentiment_engine IS NULL ORDER BY published_at DESC, id DESC`,
      [limit],
    );
    if (rows.length === 0) return 0;
    const scored = await this.local.score(rows, signal);
    if (scored.length === 0) return 0;
    const titles = new Map(rows.map((r) => [r.id, r.title_now]));
    // Only stored when the title did not change meanwhile (the update path resets the score); one statement for all.
    await this.db.run(
      `UPDATE n SET sentiment = j.score, sentiment_label = j.label, sentiment_engine = j.engine, sentiment_meta = j.meta, sentiment_impact = j.impact, scored_at = ?
       FROM news n JOIN OPENJSON(?) WITH (id nvarchar(64), score float, label nvarchar(20), engine nvarchar(100), meta nvarchar(max), impact float, title nvarchar(max)) j
         ON n.id = j.id COLLATE ${BIN}
       WHERE n.sentiment_engine IS NULL AND n.title = j.title COLLATE ${BIN}`,
      [
        Date.now(),
        JSON.stringify(scored.map((s) => ({ id: s.id, score: s.score, label: s.label, engine: s.engine, meta: JSON.stringify(s.meta), impact: s.impact ?? null, title: titles.get(s.id) ?? '' }))),
      ],
    );
    return scored.length;
  }

  /** The scorer of a user's AI, kept while their provider, model and key stay the same (it holds the pause). */
  private async scorerFor(userId: number): Promise<AiScorer | null> {
    const c = await this.ai.config(userId);
    if (!c.scoring || !c.key) {
      this.scorers.delete(userId);
      return null;
    }
    const sig = signatureOf(c.provider, c.model, c.key);
    const kept = this.scorers.get(userId);
    if (kept && kept.sig === sig) return kept.scorer;
    const model = c.model;
    const scorer = new AiScorer({
      client: this.ai.client(c.provider, c.key, model),
      log: this.log,
      onUsage: (use) => void this.ai.usage.record(userId, 'sentiment', { ...use, model }),
      onState: (st) => {
        const state = { sig, lastError: st.lastError, pausedUntil: st.pausedUntil === null || Number.isFinite(st.pausedUntil) ? st.pausedUntil : null };
        this.stateWrites.set(userId, (this.stateWrites.get(userId) ?? Promise.resolve()).then(() => this.saveState(userId, state)));
      },
    });
    this.scorers.set(userId, { sig, scorer });
    return scorer;
  }

  /** Never throws: the state is for the page, the scoring goes on without it. */
  private async saveState(userId: number, state: StoredScorerState): Promise<void> {
    try {
      await this.db.run(
        'UPDATE market_cache SET value = @v, fetched_at = @t WHERE [key] = @k; IF @@ROWCOUNT = 0 INSERT INTO market_cache([key], value, fetched_at) VALUES (@k, @v, @t)',
        { k: scorerStateKey(userId), v: JSON.stringify(state), t: Date.now() },
      );
    } catch (err) {
      this.log.warn(`AI scoring: the state of user ${userId} was not saved (${(err as Error).message})`);
    }
  }

  /**
   * The state of a user's own AI scoring (null when they do not use it), as the instance running the jobs left it; a
   * state of another provider, model or key does not count.
   */
  async aiStatus(userId: number, now = Date.now()): Promise<AiScorerStatus | null> {
    const c = await this.ai.config(userId);
    if (!c.scoring || !c.key) return null;
    const sig = signatureOf(c.provider, c.model, c.key);
    const row = await this.db.get<{ value: string }>('SELECT value FROM market_cache WHERE [key] = ?', [scorerStateKey(userId)]);
    let state: StoredScorerState | null = null;
    try {
      state = row ? (JSON.parse(row.value) as StoredScorerState) : null;
    } catch {
      state = null;
    }
    if (!state || state.sig !== sig) return { provider: c.provider, model: c.model, lastError: null, pausedUntil: null };
    const paused = state.lastError?.permanent ? null : state.pausedUntil !== null && state.pausedUntil > now ? state.pausedUntil : null;
    return { provider: c.provider, model: c.model, lastError: state.lastError, pausedUntil: paused };
  }

  /**
   * Each scoring user's AI scores up to `AI_PER_RUN` of the last days' news it has not scored yet, newest first.
   * Returns how many were scored in all.
   */
  async scoreUsers(signal?: AbortSignal, now = Date.now()): Promise<number> {
    const users = await this.ai.scoringUsers();
    for (const id of this.scorers.keys()) if (!users.includes(id)) this.scorers.delete(id);
    let total = 0;
    for (const userId of users) {
      if (signal?.aborted) break;
      const scorer = await this.scorerFor(userId);
      if (!scorer || scorer.paused()) continue;
      // Items that weigh nothing in the index are not worth paying for.
      const rows = await this.db.all<SentimentInput & { title_now: string }>(
        `SELECT TOP (?) n.id, n.title, n.summary, n.title AS title_now
         FROM news n JOIN sources s ON s.id = n.source_id
         WHERE s.enabled = 1 AND n.relevance > 0 AND n.published_at >= ?
           AND NOT EXISTS (SELECT 1 FROM news_ai_scores a WHERE a.user_id = ? AND a.news_id = n.id)
         ORDER BY n.published_at DESC, n.id DESC`,
        [AI_PER_RUN, now - AI_WINDOW_MS, userId],
      );
      if (rows.length === 0) continue;
      const scored = await scorer.score(rows, signal);
      if (scored.length === 0) continue;
      const titles = new Map(rows.map((r) => [r.id, r.title_now]));
      // Only for items still there with the same title (a new title is scored again).
      await this.db.run(
        `INSERT INTO news_ai_scores(user_id, news_id, score, label, engine, impact, scored_at)
         SELECT @u, j.id, j.score, j.label, j.engine, j.impact, @t
         FROM OPENJSON(@j) WITH (id nvarchar(64), score float, label nvarchar(20), engine nvarchar(100), impact float, title nvarchar(max)) j
         JOIN news n ON n.id = j.id COLLATE ${BIN} AND n.title = j.title COLLATE ${BIN}
         WHERE NOT EXISTS (SELECT 1 FROM news_ai_scores a WHERE a.user_id = @u AND a.news_id = n.id)`,
        { u: userId, t: Date.now(), j: JSON.stringify(scored.map((s) => ({ ...s, title: titles.get(s.id) ?? '' }))) },
      );
      total += scored.length;
    }
    // The states told during this run are saved before it ends (the page may read them at once).
    await Promise.all(this.stateWrites.values());
    return total;
  }

  /** Clears the common scores of news published since `since` (optionally only those from one engine). */
  async reset(since: number, engine?: string): Promise<number> {
    const sql = `UPDATE news SET sentiment = NULL, sentiment_label = NULL, sentiment_engine = NULL, sentiment_meta = NULL, sentiment_impact = NULL, scored_at = NULL
                 WHERE published_at >= ?${engine ? ' AND sentiment_engine = ?' : ''}`;
    return (await this.db.run(sql, engine ? [since, engine] : [since])).changes;
  }

  /** Clears a user's own AI scores of news published since `since` (their AI scores them again). */
  async resetUser(userId: number, since: number): Promise<number> {
    return (
      await this.db.run('DELETE a FROM news_ai_scores a JOIN news n ON n.id = a.news_id WHERE a.user_id = ? AND n.published_at >= ?', [userId, since])
    ).changes;
  }
}
