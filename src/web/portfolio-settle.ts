// FIX-SLTPDUP: after an order, a cancellation or a change, the platform lists the new state a few seconds late. The
// account's portfolio is then read again every 3 s for 30 s (the server reads the platform as often), instead of every
// minute, so the chart and Tranzacții catch up within seconds.
import type { QueryClient } from '@tanstack/react-query';

export const SETTLE_MS = 30_000;
export const SETTLE_POLL_MS = 3_000;

const until = new Map<number, number>();

/** A trading action on the account: its portfolio read now, and again every few seconds for a while. */
export function settlePortfolio(qc: QueryClient, accountId: number | undefined, now = Date.now()): void {
  if (accountId === undefined) return;
  until.set(accountId, now + SETTLE_MS);
  void qc.invalidateQueries({ queryKey: ['portfolio', accountId] });
}

/** How often to read an account's portfolio: every few seconds while it settles, `normal` otherwise. */
export function portfolioInterval(accountId: number, normal: number | false, now = Date.now()): number | false {
  return (until.get(accountId) ?? 0) > now ? SETTLE_POLL_MS : normal;
}
