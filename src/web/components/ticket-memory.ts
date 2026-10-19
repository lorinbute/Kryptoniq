// The order form's last choices per account (FD-TICKETMEMORY): which ones a new form takes, and the patches that keep them.
import type { OrderTicketMemory, TicketPrefs } from '../../shared/trading.ts';
import type { TicketSeed } from './OrderTicket.tsx';

/** A form that closes a position: its choices are the position's, so the memory is neither used nor changed. */
export const isClosing = (seed: TicketSeed) => !!seed.close || !!seed.reduceOnly;

/** What a new form takes from the memory of its account: everything the place it was opened from did not set. */
export function rememberedFields(memory: OrderTicketMemory | undefined, accountId: number, seed: TicketSeed): TicketPrefs {
  if (isClosing(seed)) return {};
  const m: TicketPrefs = { ...(memory?.accounts[String(accountId)] ?? {}) };
  if (seed.market) delete m.market;
  if (seed.side) delete m.side;
  if (seed.orderKind) delete m.kind;
  if (seed.marginMode) delete m.marginMode;
  return m;
}

/** The account a form opens on: the one asked for, else the one picked last for this kind of asset, if it can trade. */
export function initialAccount(memory: OrderTicketMemory | undefined, seed: TicketSeed, eligible: readonly number[]): number | null {
  if (seed.accountId !== undefined) return seed.accountId;
  const last = seed.kind ? memory?.lastAccount[seed.kind] : undefined;
  return last !== undefined && eligible.includes(last) ? last : null;
}

/** The settings patch that keeps one or more choices of an account. */
export const ticketPatch = (accountId: number, prefs: TicketPrefs) => ({ orderTicket: { accounts: { [String(accountId)]: prefs } } });
export const accountPatch = (kind: 'crypto' | 'stocks', accountId: number) => ({ orderTicket: { lastAccount: { [kind]: accountId } } });
