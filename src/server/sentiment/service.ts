// Picks the active engine and scores pending news (sentiment_engine IS NULL).
import type { Db } from '../db/database.ts';
import { BIN } from '../db/schema.ts';
import type { Logger } from '../log.ts';
import type { SettingsService } from '../settings.ts';
import { ClaudeEngine, type ClaudeStatus } from './claude.ts';
import type { SentimentEngine, SentimentInput } from './engine.ts';
import { LocalEngine, type NliScorer } from './local.ts';
import { ClaudeUsage } from './usage.ts';

/** While the local model is (down)loading we wait this long before falling back to rules-only. */
export const MODEL_WAIT_MS = 3 * 60_000;
export const RESCORE_AFTER_MODEL_MS = 48 * 3_600_000;

export class SentimentService {
  private readonly local: LocalEngine;
  private claude: { key: string; model: string; engine: ClaudeEngine } | null = null;
  private loadingSince: number | null = null;
  private readonly db: Db;
  private readonly settings: SettingsService;
  private readonly nli: NliScorer;
  private readonly log: Logger;
  /** What the Claude engine spends on the key (FD-AICLARITY). */
  readonly usage: ClaudeUsage;

  constructor(db: Db, settings: SettingsService, nli: NliScorer, log: Logger, usage: ClaudeUsage = new ClaudeUsage(db)) {
    this.db = db;
    this.usage = usage;
    this.settings = settings;
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

  async engine(): Promise<SentimentEngine> {
    const s = (await this.settings.get()).sentiment;
    if (s.engine === 'claude') {
      const key = await this.settings.getClaudeKey();
      if (key) {
        if (!this.claude || this.claude.key !== key || this.claude.model !== s.claudeModel) {
          const onUsage = (use: { items: number; input: number; output: number }) => void this.usage.record('sentiment', use);
          this.claude = { key, model: s.claudeModel, engine: new ClaudeEngine({ apiKey: key, model: s.claudeModel, log: this.log, onUsage }, this.local) };
        }
        return this.claude.engine;
      }
    }
    return this.local;
  }

  /** Status of the Claude engine when it is the selected one (null otherwise). */
  async claudeStatus(): Promise<ClaudeStatus | null> {
    const s = (await this.settings.get()).sentiment;
    if (s.engine !== 'claude' || !(await this.settings.getClaudeKey())) return null;
    const engine = await this.engine();
    return engine instanceof ClaudeEngine ? engine.status() : null;
  }

  async pendingCount(): Promise<number> {
    return (await this.db.get<{ n: number }>('SELECT count(*) AS n FROM news WHERE sentiment_engine IS NULL'))?.n ?? 0;
  }

  /** Scores up to `limit` pending items, newest first. Returns how many were scored. */
  async scorePending(signal?: AbortSignal, limit = 64): Promise<number> {
    const engine = await this.engine();
    if (engine === this.local) {
      const st = this.nli.status().state;
      if (st === 'idle') this.nli.warmUp();
      if (st === 'idle' || st === 'loading') {
        this.loadingSince ??= Date.now();
        if (Date.now() - this.loadingSince < MODEL_WAIT_MS) return 0;
      } else {
        this.loadingSince = null;
      }
    }
    const rows = await this.db.all<SentimentInput & { title_now: string }>(
      `SELECT TOP (?) id, title, summary, title AS title_now FROM news WHERE sentiment_engine IS NULL ORDER BY published_at DESC, id DESC`,
      [limit],
    );
    if (rows.length === 0) return 0;
    const scored = await engine.score(rows, signal);
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

  /** Clears scores of news published since `since` (optionally only those from one engine). */
  async reset(since: number, engine?: string): Promise<number> {
    const sql = `UPDATE news SET sentiment = NULL, sentiment_label = NULL, sentiment_engine = NULL, sentiment_meta = NULL, sentiment_impact = NULL, scored_at = NULL
                 WHERE published_at >= ?${engine ? ' AND sentiment_engine = ?' : ''}`;
    return (await this.db.run(sql, engine ? [since, engine] : [since])).changes;
  }
}
