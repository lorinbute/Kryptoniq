// After the symbols followed change (a watch list, an alias, a deleted user), the last 7 days of news are tagged again
// (which coins and stocks each one names). That takes seconds (~20 s for 10,000 news seen from the Mac), so it runs in
// the background, one pass at a time, and the answer does not wait for it (FD-WATCHLISTS); a change made during a pass
// asks for one more after it.
import type { Logger } from '../log.ts';

export class RetagQueue {
  private running: Promise<void> | null = null;
  private again = false;
  private readonly pass: () => Promise<unknown>;
  private readonly log: Logger;

  constructor(pass: () => Promise<unknown>, log: Logger) {
    this.pass = pass;
    this.log = log;
  }

  /** Asks for a pass; returns at once. */
  request(): void {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = this.loop().finally(() => {
      this.running = null;
    });
  }

  private async loop(): Promise<void> {
    do {
      this.again = false;
      try {
        await this.pass();
      } catch (err) {
        // The daily retagging job and the next change put it right.
        this.log.warn(`news: retagging after a change of the symbols followed failed (${(err as Error).message})`);
      }
    } while (this.again);
  }

  /** Resolves once no pass is under way or asked for (tests). */
  async idle(): Promise<void> {
    while (this.running) await this.running;
  }
}
