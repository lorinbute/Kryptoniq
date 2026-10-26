// Scores the news. The local model scores every item for everyone (the common score, on the news row: pending while
// sentiment_engine IS NULL); since FD-AIKEYS a user who chose so has their own AI score the last days' news too, with
// their key, kept apart (news_ai_scores) and used for them alone in place of the common score.
import { createHash } from 'node:crypto';
import type { Db } from '../db/database.ts';
import { BIN } from '../db/schema.ts';
import type { Logger } from '../log.ts';
import type { AiService } from '../ai/service.ts';
import { AI_BATCH, AiScorer, type AiScorerStatus } from './ai-scorer.ts';
import type { SentimentEngine, SentimentInput } from './engine.ts';
import { LocalEngine, type NliScorer } from './local.ts';

/** While the local model is (down)loading we wait this long before falling back to rules-only. */
export const MODEL_WAIT_MS = 3 * 60_000;
export const RESCORE_AFTER_MODEL_MS = 48 * 3_600_000;
/** How far back a user's AI scores the news: today and yesterday, the days whose index can still change. */
export const AI_WINDOW_MS = 48 * 3_600_000;
/** Headlines one user's AI scores per round (one batch, FD-AISLOW §3): a slow provider holds the round up once. */
export const AI_PER_RUN = AI_BATCH;
/** Users whose AI scores at the same time (FD-AISLOW §3): each has their own provider and key. */
export const AI_USERS_AT_ONCE = 4;
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
  /** Failed calls in a row (FD-AISLOW §2); absent from states saved before it. */
  failures?: number;
}

/** How far a user's AI got with the news it scores (FD-AISLOW §4). */
export interface AiProgress {
  /** The last days' news it scores. */
  total: number;
  /** Of those, the ones it went through. */
  scored: number;
  /** Its last score (any news); null: none yet. */
  lastAt: number | null;
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
    if (kept && kept.sig === sig) {
      // FD-AIQUOTA §2: the user asked again (their key or AI choice saved, on either instance): its state is gone. Also
      // when its pause is over, for the errors in a row it counts (FD-AISLOW §2).
      if ((kept.scorer.paused() || (kept.scorer.status().failures ?? 0) > 0) && !(await this.storedState(userId, sig))) kept.scorer.resume();
      return kept.scorer;
    }
    const model = c.model;
    const scorer = new AiScorer({
      client: this.ai.client(c.provider, c.key, model),
      log: this.log,
      // FD-AIQUOTA §2: after a restart, the pause and the error of the same provider, model and key hold.
      restored: await this.storedState(userId, sig),
      onUsage: (use) => void this.ai.usage.record(userId, 'sentiment', { ...use, model }),
      onState: (st) => {
        const state = { sig, lastError: st.lastError, pausedUntil: st.pausedUntil === null || Number.isFinite(st.pausedUntil) ? st.pausedUntil : null, failures: st.failures };
        this.stateWrites.set(userId, (this.stateWrites.get(userId) ?? Promise.resolve()).then(() => this.saveState(userId, state)));
      },
    });
    this.scorers.set(userId, { sig, scorer });
    return scorer;
  }

  /** The saved state of a user's scoring with this provider, model and key; null when there is none (or another's). */
  private async storedState(userId: number, sig: string): Promise<StoredScorerState | null> {
    const row = await this.db.get<{ value: string }>('SELECT value FROM market_cache WHERE [key] = ?', [scorerStateKey(userId)]);
    try {
      const state = row ? (JSON.parse(row.value) as StoredScorerState) : null;
      return state && state.sig === sig ? state : null;
    } catch {
      return null;
    }
  }

  /** FD-AIQUOTA §2: the user saved their key or AI choice: no pause, the next run tries again (on any instance). */
  async retryNow(userId: number): Promise<void> {
    await this.db.run('DELETE FROM market_cache WHERE [key] = ?', [scorerStateKey(userId)]);
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
    const state = await this.storedState(userId, signatureOf(c.provider, c.model, c.key));
    if (!state) return { provider: c.provider, model: c.model, lastError: null, pausedUntil: null, failures: 0 };
    const paused = state.lastError?.permanent ? null : state.pausedUntil !== null && state.pausedUntil > now ? state.pausedUntil : null;
    return { provider: c.provider, model: c.model, lastError: state.lastError, pausedUntil: paused, ...(state.failures !== undefined ? { failures: state.failures } : {}) };
  }

  /** How far a user's AI got with the last days' news (FD-AISLOW §4): the same news `scoreUsers` gives it. */
  async aiProgress(userId: number, now = Date.now()): Promise<AiProgress> {
    const counts = await this.db.get<{ total: number; scored: number }>(
      `SELECT count(*) AS total, count(a.news_id) AS scored
       FROM news n JOIN sources s ON s.id = n.source_id
       LEFT JOIN news_ai_scores a ON a.user_id = ? AND a.news_id = n.id
       WHERE s.enabled = 1 AND n.relevance > 0 AND n.published_at >= ?`,
      [userId, now - AI_WINDOW_MS],
    );
    const last = await this.db.get<{ t: number | null }>('SELECT max(scored_at) AS t FROM news_ai_scores WHERE user_id = ?', [userId]);
    return { total: counts?.total ?? 0, scored: counts?.scored ?? 0, lastAt: last?.t ?? null };
  }

  /**
   * Each scoring user's AI scores up to `AI_PER_RUN` of the last days' news it has not scored yet, newest first; a few
   * users at a time, so that one's slow provider does not hold the others up (FD-AISLOW §3). Returns how many were
   * scored in all; one user's failure is thrown once the others are done.
   */
  async scoreUsers(signal?: AbortSignal, now = Date.now()): Promise<number> {
    const users = await this.ai.scoringUsers();
    for (const id of this.scorers.keys()) if (!users.includes(id)) this.scorers.delete(id);
    const queue = [...users];
    let total = 0;
    const errors: unknown[] = [];
    const worker = async () => {
      for (let id = queue.shift(); id !== undefined && !signal?.aborted; id = queue.shift()) {
        try {
          // Not `total += await …`: that reads the total before the wait, and another user's count would be lost.
          const n = await this.scoreUser(id, signal, now);
          total += n;
        } catch (err) {
          errors.push(err);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(AI_USERS_AT_ONCE, queue.length) }, worker));
    // The states told during this run are saved before it ends (the page may read them at once).
    await Promise.all(this.stateWrites.values());
    if (errors.length > 0) throw errors[0];
    return total;
  }

  /** One user's turn: up to `AI_PER_RUN` news their AI has not scored yet. Returns how many it scored. */
  private async scoreUser(userId: number, signal: AbortSignal | undefined, now: number): Promise<number> {
    const scorer = await this.scorerFor(userId);
    if (!scorer || scorer.paused()) return 0;
    // Items that weigh nothing in the index are not worth paying for.
    const rows = await this.db.all<SentimentInput & { title_now: string }>(
      `SELECT TOP (?) n.id, n.title, n.summary, n.title AS title_now
       FROM news n JOIN sources s ON s.id = n.source_id
       WHERE s.enabled = 1 AND n.relevance > 0 AND n.published_at >= ?
         AND NOT EXISTS (SELECT 1 FROM news_ai_scores a WHERE a.user_id = ? AND a.news_id = n.id)
       ORDER BY n.published_at DESC, n.id DESC`,
      [AI_PER_RUN, now - AI_WINDOW_MS, userId],
    );
    if (rows.length === 0) return 0;
    const scored = await scorer.score(rows, signal);
    if (scored.length === 0) return 0;
    const titles = new Map(rows.map((r) => [r.id, r.title_now]));
    // Only for items still there with the same title (a new title is scored again).
    await this.db.run(
      `INSERT INTO news_ai_scores(user_id, news_id, score, label, engine, impact, reason, scored_at)
       SELECT @u, j.id, j.score, j.label, j.engine, j.impact, j.reason, @t
       FROM OPENJSON(@j) WITH (id nvarchar(64), score float, label nvarchar(20), engine nvarchar(100), impact float, reason nvarchar(400), title nvarchar(max)) j
       JOIN news n ON n.id = j.id COLLATE ${BIN} AND n.title = j.title COLLATE ${BIN}
       WHERE NOT EXISTS (SELECT 1 FROM news_ai_scores a WHERE a.user_id = @u AND a.news_id = n.id)`,
      { u: userId, t: Date.now(), j: JSON.stringify(scored.map((s) => ({ ...s, title: titles.get(s.id) ?? '' }))) },
    );
    return scored.length;
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
