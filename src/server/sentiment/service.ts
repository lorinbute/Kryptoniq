// Picks the active engine and scores pending news (sentiment_engine IS NULL).
import type { Db } from '../db/database.ts';
import type { Logger } from '../log.ts';
import type { SettingsService } from '../settings.ts';
import { ClaudeEngine, type ClaudeStatus } from './claude.ts';
import type { SentimentEngine, SentimentInput } from './engine.ts';
import { LocalEngine, type NliScorer } from './local.ts';

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

  constructor(db: Db, settings: SettingsService, nli: NliScorer, log: Logger) {
    this.db = db;
    this.settings = settings;
    this.nli = nli;
    this.log = log;
    this.local = new LocalEngine(nli);
    nli.onReady(() => {
      // Items scored by the rules-only fallback get a proper score now.
      const n = this.reset(Date.now() - RESCORE_AFTER_MODEL_MS, 'rules');
      if (n > 0) this.log.info(`model ready: ${n} rules-only scores queued for rescoring`);
    });
  }

  engine(): SentimentEngine {
    const s = this.settings.get().sentiment;
    if (s.engine === 'claude') {
      const key = this.settings.getClaudeKey();
      if (key) {
        if (!this.claude || this.claude.key !== key || this.claude.model !== s.claudeModel) {
          this.claude = { key, model: s.claudeModel, engine: new ClaudeEngine({ apiKey: key, model: s.claudeModel, log: this.log }, this.local) };
        }
        return this.claude.engine;
      }
    }
    return this.local;
  }

  /** Status of the Claude engine when it is the selected one (null otherwise). */
  claudeStatus(): ClaudeStatus | null {
    const s = this.settings.get().sentiment;
    if (s.engine !== 'claude' || !this.settings.getClaudeKey()) return null;
    const engine = this.engine();
    return engine instanceof ClaudeEngine ? engine.status() : null;
  }

  pendingCount(): number {
    return this.db.get<{ n: number }>('SELECT count(*) AS n FROM news WHERE sentiment_engine IS NULL')?.n ?? 0;
  }

  /** Scores up to `limit` pending items, newest first. Returns how many were scored. */
  async scorePending(signal?: AbortSignal, limit = 64): Promise<number> {
    const engine = this.engine();
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
    const rows = this.db.all<SentimentInput & { title_now: string }>(
      `SELECT id, title, summary, title AS title_now FROM news WHERE sentiment_engine IS NULL ORDER BY published_at DESC LIMIT ?`,
      [limit],
    );
    if (rows.length === 0) return 0;
    const scored = await engine.score(rows, signal);
    const now = Date.now();
    this.db.tx(() => {
      for (const s of scored) {
        // Only store when the title did not change meanwhile (the update path resets the score).
        this.db.run(
          `UPDATE news SET sentiment = ?, sentiment_label = ?, sentiment_engine = ?, sentiment_meta = ?, scored_at = ?
           WHERE id = ? AND sentiment_engine IS NULL AND title = ?`,
          [s.score, s.label, s.engine, JSON.stringify(s.meta), now, s.id, rows.find((r) => r.id === s.id)?.title_now ?? ''],
        );
      }
    });
    return scored.length;
  }

  /** Clears scores of news published since `since` (optionally only those from one engine). */
  reset(since: number, engine?: string): number {
    const sql = `UPDATE news SET sentiment = NULL, sentiment_label = NULL, sentiment_engine = NULL, sentiment_meta = NULL, scored_at = NULL
                 WHERE published_at >= ?${engine ? ' AND sentiment_engine = ?' : ''}`;
    return this.db.run(sql, engine ? [since, engine] : [since]).changes;
  }
}
