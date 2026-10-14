// What Sentiq itself spends on the admin's Claude key (FD-AICLARITY, TD-AICLARITY): per UTC day, the news sentiment and
// the day summaries, in calls, headlines and tokens. Kept in the database, so the Mac and Azure add to the same day.
import type { Db } from '../db/database.ts';

export interface UsageCounts {
  calls: number;
  /** Headlines sent (sentiment only). */
  items: number;
  input: number;
  output: number;
}

export interface ClaudeUsageDay {
  /** YYYY-MM-DD, UTC. */
  day: string;
  sentiment: UsageCounts;
  summary: UsageCounts;
}

const KEY = 'claude:usage';
const zero = (): UsageCounts => ({ calls: 0, items: 0, input: 0, output: 0 });
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
const counts = (v: unknown): UsageCounts => {
  const o = (v ?? {}) as Record<string, unknown>;
  return { calls: num(o.calls), items: num(o.items), input: num(o.input), output: num(o.output) };
};

export class ClaudeUsage {
  private readonly db: Db;
  private readonly now: () => number;

  constructor(db: Db, now: () => number = Date.now) {
    this.db = db;
    this.now = now;
  }

  private day(): string {
    return new Date(this.now()).toISOString().slice(0, 10);
  }

  private parse(raw: string | undefined, day: string): ClaudeUsageDay {
    try {
      const v = JSON.parse(raw ?? '') as Record<string, unknown>;
      if (v.day === day) return { day, sentiment: counts(v.sentiment), summary: counts(v.summary) };
    } catch {
      // nothing usable: a new day
    }
    return { day, sentiment: zero(), summary: zero() };
  }

  /** Today's use (zeros on a new day). */
  async today(): Promise<ClaudeUsageDay> {
    const row = await this.db.get<{ value: string }>('SELECT value FROM market_cache WHERE [key] = ?', [KEY]);
    return this.parse(row?.value, this.day());
  }

  /** Adds one answered call. Never throws: counting must not stop the scoring or the summary. */
  async record(kind: 'sentiment' | 'summary', use: { items?: number; input?: number; output?: number }): Promise<void> {
    try {
      await this.db.tx(async () => {
        const row = await this.db.get<{ value: string }>('SELECT value FROM market_cache WHERE [key] = ?', [KEY]);
        const d = this.parse(row?.value, this.day());
        const c = d[kind];
        c.calls += 1;
        c.items += num(use.items);
        c.input += num(use.input);
        c.output += num(use.output);
        await this.db.run(
          `UPDATE market_cache SET value = @v, fetched_at = @t WHERE [key] = @k; IF @@ROWCOUNT = 0 INSERT INTO market_cache([key], value, fetched_at) VALUES (@k, @v, @t)`,
          { k: KEY, v: JSON.stringify(d), t: this.now() },
        );
      });
    } catch {
      // the count of this call is lost; the work itself went through
    }
  }
}
