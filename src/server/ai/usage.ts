// What each user's own AI key spends through Sentiq (FD-AICLARITY, FD-AIKEYS §3): per user and UTC day, the news
// scores and the day summaries, in calls, headlines and tokens, with the model last used. Kept in the database, so the
// Mac and Azure add to the same day.
import type { Db } from '../db/database.ts';

export interface UsageCounts {
  calls: number;
  /** Headlines sent (scores only). */
  items: number;
  input: number;
  output: number;
  /** The model of the latest call (null before the first one of the day). */
  model: string | null;
}

export interface AiUsageDay {
  /** YYYY-MM-DD, UTC. */
  day: string;
  sentiment: UsageCounts;
  summary: UsageCounts;
}

const keyOf = (userId: number) => `ai:usage:${userId}`;
const zero = (): UsageCounts => ({ calls: 0, items: 0, input: 0, output: 0, model: null });
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
const counts = (v: unknown): UsageCounts => {
  const o = (v ?? {}) as Record<string, unknown>;
  return { calls: num(o.calls), items: num(o.items), input: num(o.input), output: num(o.output), model: typeof o.model === 'string' ? o.model : null };
};

export class AiUsage {
  private readonly db: Db;
  private readonly now: () => number;

  constructor(db: Db, now: () => number = Date.now) {
    this.db = db;
    this.now = now;
  }

  private day(): string {
    return new Date(this.now()).toISOString().slice(0, 10);
  }

  private parse(raw: string | undefined, day: string): AiUsageDay {
    try {
      const v = JSON.parse(raw ?? '') as Record<string, unknown>;
      if (v.day === day) return { day, sentiment: counts(v.sentiment), summary: counts(v.summary) };
    } catch {
      // nothing usable: a new day
    }
    return { day, sentiment: zero(), summary: zero() };
  }

  /** The user's use today (zeros on a new day). */
  async today(userId: number): Promise<AiUsageDay> {
    const row = await this.db.get<{ value: string }>('SELECT value FROM market_cache WHERE [key] = ?', [keyOf(userId)]);
    return this.parse(row?.value, this.day());
  }

  /** Adds one answered call. Never throws: counting must not stop the scoring or the summary. */
  async record(userId: number, kind: 'sentiment' | 'summary', use: { items?: number; input?: number; output?: number; model?: string }): Promise<void> {
    try {
      await this.db.tx(async () => {
        const key = keyOf(userId);
        const row = await this.db.get<{ value: string }>('SELECT value FROM market_cache WHERE [key] = ?', [key]);
        const d = this.parse(row?.value, this.day());
        const c = d[kind];
        c.calls += 1;
        c.items += num(use.items);
        c.input += num(use.input);
        c.output += num(use.output);
        if (typeof use.model === 'string') c.model = use.model;
        await this.db.run(
          `UPDATE market_cache SET value = @v, fetched_at = @t WHERE [key] = @k; IF @@ROWCOUNT = 0 INSERT INTO market_cache([key], value, fetched_at) VALUES (@k, @v, @t)`,
          { k: key, v: JSON.stringify(d), t: this.now() },
        );
      });
    } catch {
      // the count of this call is lost; the work itself went through
    }
  }

  /** Forgets a user's counts (the user was deleted). */
  async forget(userId: number): Promise<void> {
    await this.db.run('DELETE FROM market_cache WHERE [key] = ?', [keyOf(userId)]);
  }
}
