// What every platform's trader offers the trading service (TD-TRADING §3). The only place, with the traders next to it,
// where Sentiq sends orders: the rest of src/server/exchange reads, and nothing anywhere moves funds.
import type { InstrumentInfo, ModifyPreview, ModifyResult, ModifyTicket, OrderPreview, OrderResult, OrderTicket, ReversePreview, ReverseTicket, TradeMarket, TradeSymbol } from '../../../shared/trading.ts';

export type TradingErrorCode =
  | 'INVALID'
  | 'PERMISSION'
  | 'INSUFFICIENT'
  | 'MIN_SIZE'
  | 'HEDGE_MODE'
  | 'MARKET_CLOSED'
  | 'NOT_FOUND'
  | 'RATE_LIMIT'
  | 'REJECTED'
  | 'UNKNOWN_OUTCOME'
  | 'UNSUPPORTED'
  | 'DISABLED'
  | 'IN_PROGRESS'
  /** The password or the code to switch trading on was wrong (counts against the account's attempts). */
  | 'BAD_FACTORS'
  /** The account is not there, or not the user's (404). */
  | 'NO_ACCOUNT';

/** A trading failure the page can explain (the platform's own words kept in the message). */
export class TradingError extends Error {
  readonly code: TradingErrorCode;
  constructor(code: TradingErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export const UNKNOWN_OUTCOME_MESSAGE = 'Nu știm sigur dacă ordinul a ajuns. Verifică ordinele deschise înainte să-l trimiți din nou.';

export interface CancelInput {
  orderId: string;
  symbol: string;
  market: TradeMarket;
  /** A stop / trigger order (several exchanges keep them apart). */
  trigger: boolean;
}

/**
 * FD-ORDEREDIT: changes checked and planned. `internal` is what the trader needs to send them (the orders as read, the
 * position): kept on the server, never sent to the page.
 */
export interface ModifyPlan {
  preview: ModifyPreview;
  internal: unknown;
}

export interface Trader {
  /** The pairs of a crypto market (brokers: none, the symbol is typed). */
  symbols(market: TradeMarket): Promise<TradeSymbol[]>;
  instrument(market: TradeMarket, symbol: string): Promise<InstrumentInfo>;
  /** Rounds and checks the order; `errors` block it, `warnings` are shown in the confirmation. */
  normalize(ticket: OrderTicket): Promise<OrderPreview>;
  /** Sends exactly what `normalize` returned; never retried. */
  place(preview: OrderPreview): Promise<OrderResult>;
  cancel(input: CancelInput): Promise<OrderResult>;
  /** FD-ORDEREDIT: reads the orders / position again, rounds and checks the changes, and decides how each goes out. */
  normalizeModify(ticket: ModifyTicket): Promise<ModifyPlan>;
  /** Sends exactly what `normalizeModify` planned, step by step; never retried. */
  modify(plan: ModifyPlan): Promise<ModifyResult>;
  /** FD-REVERSE: the position turned the other way, checked (where the platform can: crypto futures). */
  normalizeReverse?(ticket: ReverseTicket): Promise<ReversePlan>;
  /** Sends what `normalizeReverse` planned: the position closed, the opposite one opened, its old SL / TP cancelled. */
  reverse?(plan: ReversePlan): Promise<ModifyResult>;
}

/** FD-REVERSE: a reversal checked; `internal` (the orders to send and to cancel) stays on the server. */
export interface ReversePlan {
  preview: ReversePreview;
  internal: unknown;
}

/**
 * FD-ORDEREDIT: a position's stop loss / take profit against the price now. A long's stop loss under it and take profit
 * over it (else it would fire at once); a short's the other way round.
 */
export function protectionChecks(what: 'sl' | 'tp', long: boolean, level: number, last: number | null, out: { errors: string[] }, digits: (v: number) => string): void {
  if (last === null || !(last > 0)) return;
  const below = (what === 'sl') === long;
  if (below && level >= last) out.errors.push(`${what === 'sl' ? 'Stop loss-ul' : 'Take profit-ul'} unui ${long ? 'long' : 'short'} trebuie să fie sub prețul de acum (${digits(last)}): altfel s-ar executa imediat.`);
  if (!below && level <= last) out.errors.push(`${what === 'sl' ? 'Stop loss-ul' : 'Take profit-ul'} unui ${long ? 'long' : 'short'} trebuie să fie peste prețul de acum (${digits(last)}): altfel s-ar executa imediat.`);
}

/** The step results' overall outcome: all done, some, none, or one whose outcome is unknown. */
export function modifyStatus(steps: { ok: boolean; unknown?: boolean }[]): 'done' | 'partial' | 'failed' | 'unknown' {
  if (steps.some((s) => s.unknown)) return 'unknown';
  if (steps.every((s) => s.ok)) return 'done';
  return steps.some((s) => s.ok) ? 'partial' : 'failed';
}

/** A client order id the platforms accept (letters and digits, 32 characters) from the form's idempotency key. */
export const clientIdOf = (idemKey: string) => idemKey.replace(/-/g, '').toLowerCase().slice(0, 32);

/** The checks every platform shares (price sides, stops, TP / SL), added to `warnings` / `errors`. */
export function commonChecks(t: OrderTicket, ref: { last: number | null; entry: number | null }, out: { warnings: string[]; errors: string[] }, digits: (v: number) => string): void {
  const { last } = ref;
  const long = t.side === 'buy';
  if (last !== null && last > 0) {
    if (t.triggerPrice !== undefined && (t.kind === 'stop' || t.kind === 'stop_limit')) {
      if (long && t.triggerPrice <= last) out.errors.push(`Un stop de cumpărare se declanșează peste prețul de acum (${digits(last)}); pentru a cumpăra mai jos, folosește un ordin limită.`);
      if (!long && t.triggerPrice >= last) out.errors.push(`Un stop de vânzare se declanșează sub prețul de acum (${digits(last)}); pentru a vinde mai sus, folosește un ordin limită.`);
    }
    if (t.price !== undefined && (t.kind === 'limit' || t.kind === 'limit_ioc')) {
      if (long && t.price > last * 1.001) out.warnings.push(`Prețul limită e peste prețul de acum (${digits(last)}): ordinul se execută imediat, la cel mai bun preț disponibil până la limită.`);
      if (!long && t.price < last * 0.999) out.warnings.push(`Prețul limită e sub prețul de acum (${digits(last)}): ordinul se execută imediat, la cel mai bun preț disponibil până la limită.`);
      if (Math.abs(t.price - last) / last > 0.1) out.warnings.push(`Prețul limită e la peste 10% de prețul de acum (${digits(last)}).`);
    }
  }
  // TP above and SL below the entry for a long; the other way for a short.
  const entry = ref.entry ?? last;
  if (entry !== null && entry > 0 && !t.reduceOnly) {
    if (t.takeProfit !== undefined && (long ? t.takeProfit <= entry : t.takeProfit >= entry)) out.errors.push(`Take profit-ul trebuie să fie ${long ? 'peste' : 'sub'} prețul de intrare (${digits(entry)}).`);
    if (t.stopLoss !== undefined && (long ? t.stopLoss >= entry : t.stopLoss <= entry)) out.errors.push(`Stop loss-ul trebuie să fie ${long ? 'sub' : 'peste'} prețul de intrare (${digits(entry)}).`);
  }
  if (t.kind === 'market') out.warnings.push('Un ordin la piață se execută la prețul din momentul trimiterii, care poate diferi de cel de acum.');
}

/** Few digits for big numbers, more for small ones (the confirmation's prices). */
export function fmtPlain(v: number): string {
  const abs = Math.abs(v);
  const d = abs >= 1000 ? 2 : abs >= 1 ? 4 : abs >= 0.01 ? 6 : 8;
  return String(Number(v.toFixed(d)));
}
