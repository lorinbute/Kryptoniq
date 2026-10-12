// Local engine: zero-shot NLI (deberta-v3-small, ONNX q8) + domain rules (TD §6.2, research §3).
import type { Logger } from '../log.ts';
import { combine, labelFor, type ScoredItem, type SentimentEngine, type SentimentInput } from './engine.ts';
import { applyRules } from './rules.ts';

export const NLI_MODEL = 'Xenova/nli-deberta-v3-small';
export const NLI_LABELS = ['good news for crypto and stock prices', 'bad news for crypto and stock prices', 'neutral news'] as const;
export const NLI_TEMPLATE = 'This is {}.';
const RETRY_MS = 30 * 60_000;

export type ModelState = 'idle' | 'loading' | 'ready' | 'failed';

export interface ModelStatus {
  state: ModelState;
  progress: number | null;
  error: string | null;
  model: string;
}

type ZeroShot = (text: string, labels: string[], opts: { hypothesis_template: string }) => Promise<{ labels: string[]; scores: number[] }>;

export interface NliScorer {
  status(): ModelStatus;
  /** Starts loading in the background (idempotent). */
  warmUp(): void;
  /** P(good) − P(bad), or null when the model is not available. */
  score(text: string): Promise<number | null>;
  onReady(cb: () => void): void;
}

/** Lazily loads the transformers.js pipeline; never throws from score(). */
export class TransformersNli implements NliScorer {
  private state: ModelState = 'idle';
  private progress: number | null = null;
  private error: string | null = null;
  private failedAt = 0;
  private loading: Promise<ZeroShot | null> | null = null;
  private pipe: ZeroShot | null = null;
  private readonly readyCallbacks: (() => void)[] = [];
  private readonly cacheDir: string;
  private readonly log: Logger;

  constructor(cacheDir: string, log: Logger) {
    this.cacheDir = cacheDir;
    this.log = log;
  }

  status(): ModelStatus {
    return { state: this.state, progress: this.progress, error: this.error, model: NLI_MODEL };
  }

  onReady(cb: () => void): void {
    this.readyCallbacks.push(cb);
  }

  warmUp(): void {
    void this.load();
  }

  private load(): Promise<ZeroShot | null> {
    if (this.pipe) return Promise.resolve(this.pipe);
    if (this.loading) return this.loading;
    if (this.state === 'failed' && Date.now() - this.failedAt < RETRY_MS) return Promise.resolve(null);
    this.state = 'loading';
    this.progress = 0;
    this.loading = (async () => {
      try {
        const tf = await import('@huggingface/transformers');
        tf.env.cacheDir = this.cacheDir;
        tf.env.allowLocalModels = false;
        const files = new Map<string, { loaded: number; total: number }>();
        const pipe = await tf.pipeline('zero-shot-classification', NLI_MODEL, {
          dtype: 'q8',
          progress_callback: (p: { status?: string; file?: string; loaded?: number; total?: number }) => {
            if (p.status === 'progress' && p.file && p.total) {
              files.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
              let loaded = 0;
              let total = 0;
              for (const f of files.values()) {
                loaded += f.loaded;
                total += f.total;
              }
              this.progress = total > 0 ? Math.round((loaded / total) * 100) : null;
            }
          },
        });
        this.pipe = pipe as unknown as ZeroShot;
        this.state = 'ready';
        this.progress = 100;
        this.error = null;
        this.log.info(`sentiment model ${NLI_MODEL} ready`);
        for (const cb of this.readyCallbacks) {
          try {
            cb();
          } catch {
            // ignore listener errors
          }
        }
        return this.pipe;
      } catch (err) {
        this.state = 'failed';
        this.failedAt = Date.now();
        this.error = (err as Error).message.slice(0, 300);
        this.log.warn(`sentiment model failed to load: ${this.error}`);
        return null;
      } finally {
        this.loading = null;
      }
    })();
    return this.loading;
  }

  async score(text: string): Promise<number | null> {
    // Never wait for a (170 MB) download here: start it and let the caller fall back to the rules.
    if (!this.pipe) {
      this.warmUp();
      return null;
    }
    const pipe = this.pipe;
    try {
      const out = await pipe(text, [...NLI_LABELS], { hypothesis_template: NLI_TEMPLATE });
      const p = (label: string) => out.scores[out.labels.indexOf(label)] ?? 0;
      return p(NLI_LABELS[0]) - p(NLI_LABELS[1]);
    } catch (err) {
      this.log.warn(`NLI inference failed: ${(err as Error).message}`);
      return null;
    }
  }
}

export class LocalEngine implements SentimentEngine {
  readonly id = 'local';
  private readonly nli: NliScorer;

  constructor(nli: NliScorer) {
    this.nli = nli;
  }

  async score(items: SentimentInput[], signal?: AbortSignal): Promise<ScoredItem[]> {
    const out: ScoredItem[] = [];
    for (const it of items) {
      if (signal?.aborted) break;
      const rules = applyRules(it.title);
      const model = await this.nli.score(it.title);
      const score = combine(model, rules.score, rules.hits.length);
      out.push({
        id: it.id,
        score,
        label: labelFor(score),
        engine: model === null ? 'rules' : 'local',
        meta: {
          model: model === null ? null : Math.round(model * 1000) / 1000,
          rules: rules.hits.map((h) => ({ id: h.id, score: h.score, text: h.text, negated: h.negated })),
        },
      });
    }
    return out;
  }
}
