// Slingshot Premium (FD-BOT §6): what the bar that just closed says (a confirmed signal, a take profit signal, what
// became of the signal a position entered on), the levels and the size of a trade, and its exit at the price now.
import { liqDistance, LIQ_SAFETY, reached, type BotSide, type PremiumConfig } from '../../shared/bot.ts';
import type { SlingshotResult, SlingshotSignal } from '../../shared/indicator/slingshot.ts';
import type { BotPosition } from './state.ts';

export interface BarEvents {
  /** Signals confirmed on the closed bar (never one on the forming bar). */
  signals: SlingshotSignal[];
  /** Slingshot's take profit signal of each side on the closed bar. */
  tpSignal: Record<BotSide, boolean>;
  /** The last break of the market structure up to the closed bar. */
  structure: 'msBullish' | 'msBearish' | null;
}

export function barEvents(r: SlingshotResult, closed: number): BarEvents {
  const signals = r.signals.filter((s) => s.confirmBar === closed && !s.provisional);
  const at = r.alerts.filter((a) => a.bar === closed && !a.provisional);
  let structure: BarEvents['structure'] = null;
  for (const a of r.alerts) if (a.bar <= closed && (a.type === 'msBullish' || a.type === 'msBearish')) structure = a.type;
  return {
    signals,
    tpSignal: { long: at.some((a) => a.type === 'takeProfitSignal'), short: at.some((a) => a.type === 'shortTakeProfitSignal') },
    structure,
  };
}

export type SignalFate = 'sl' | 'tp' | 'tp_signal' | 'flip' | null;

/** What Slingshot did with the signal a position entered on, by a closed bar (a superseded one keeps the position). */
export function signalFate(r: SlingshotResult, side: BotSide, time: number, closed: number): SignalFate {
  const s = r.signals.find((x) => x.side === side && x.time === time);
  if (!s || s.outcome === 'active' || s.closedBar === undefined || s.closedBar > closed) return null;
  if (s.outcome === 'sl') return 'sl';
  if (s.outcome === 'tp') return s.outcomeReason === 'takeProfitSignal' ? 'tp_signal' : 'tp';
  return s.outcomeReason === 'trendFlip' ? 'flip' : null;
}

/**
 * The stop loss and the take profit of a trade entered at `price` (FD-BOT §6), or why it cannot be entered: Slingshot's
 * are the signal's both, as they are, whatever the R:R from the price now (FD-BOTSLRR); "Risc / câștig" puts them at the
 * user's percents from the entry (FD-BOTPCT).
 */
export function levelsFor(cfg: PremiumConfig, signal: Pick<SlingshotSignal, 'side' | 'sl' | 'tp'>, price: number): { sl: number; tp: number } | { error: string } {
  const dir = signal.side === 'long' ? 1 : -1;
  const slingshot = cfg.levels === 'slingshot';
  const sl = slingshot ? signal.sl : price * (1 - (dir * cfg.slPct) / 100);
  if (!(dir * (price - sl) > 0)) return { error: 'Prețul a trecut deja de stop loss.' };
  const tp = slingshot ? signal.tp : price * (1 + (dir * cfg.tpPct) / 100);
  if (!(dir * (tp - price) > 0)) return { error: 'Prețul a atins deja take profit-ul.' };
  if (!(tp > 0)) return { error: 'Take profit-ul ar fi la un preț sub zero.' };
  return { sl, tp };
}

export interface SizeIn {
  cfg: PremiumConfig;
  futures: boolean;
  maxAmount: number;
  maxLeverage: number;
  /** What is still free of the maximum amount. */
  free: number;
  price: number;
  sl: number;
}

export interface Sized {
  qty: number;
  margin: number;
  lev: number;
  notional: number;
  /** Said in the journal: the risk was cut by the free amount, or the leverage lowered for the liquidation. */
  notes: string[];
}

/**
 * The size of a trade (FD-BOT §6): a fixed amount at the maximum leverage, or the risk wished for at the smallest leverage
 * the free amount allows; on futures, the stop loss well before the liquidation (the leverage comes down until it is).
 */
export function sizeFor(x: SizeIn): Sized | { error: string } {
  const cap = Math.min(x.free, x.cfg.maxPerTrade ?? Infinity);
  if (!(cap > 0)) return { error: 'Suma maximă e toată în tranzacții deschise.' };
  const dist = Math.abs(x.price - x.sl) / x.price;
  const notes: string[] = [];
  const maxLev = x.futures ? Math.max(1, x.maxLeverage) : 1;
  let lev: number;
  let notional: number;
  let margin: number;
  if (x.cfg.sizing === 'fixed') {
    margin = Math.min(x.cfg.amount, cap);
    if (margin < x.cfg.amount) notes.push('Suma pe tranzacție a fost micșorată la cât e liber din suma maximă.');
    lev = maxLev;
    notional = margin * lev;
  } else {
    const wanted = (x.maxAmount * x.cfg.riskPct) / 100 / dist;
    lev = Math.min(maxLev, Math.max(1, Math.ceil(wanted / cap - 1e-9)));
    notional = Math.min(wanted, cap * lev);
    if (notional < wanted * (1 - 1e-9)) notes.push('Riscul e mai mic decât cel cerut: suma liberă nu ajunge pentru el.');
    margin = notional / lev;
  }
  // The stop loss must come well before the liquidation.
  while (x.futures && lev > 1 && dist >= LIQ_SAFETY * liqDistance(lev)) {
    lev -= 1;
    if (x.cfg.sizing === 'fixed') notional = margin * lev;
    else {
      margin = notional / lev;
      if (margin > cap) {
        margin = cap;
        notional = cap * lev;
      }
    }
    if (!notes.includes(LIQ_NOTE)) notes.push(LIQ_NOTE);
  }
  if (x.futures && dist >= LIQ_SAFETY * liqDistance(lev)) return { error: 'Stop loss-ul e prea departe: poziția s-ar lichida înaintea lui.' };
  return { qty: notional / x.price, margin, lev, notional, notes };
}

const LIQ_NOTE = 'Levierul a fost coborât: stop loss-ul trebuie atins cu mult înaintea lichidării.';

/** The stop loss or the take profit reached at `price`. */
export function exitAt(p: Pick<BotPosition, 'side' | 'sl' | 'tp'>, price: number): 'sl' | 'tp' | null {
  const long = p.side === 'long';
  if (p.sl !== null && reached(price, p.sl, !long)) return 'sl';
  if (p.tp !== null && reached(price, p.tp, long)) return 'tp';
  return null;
}

/** A simulated futures position's liquidation price (FD-BOT §6). */
export const liquidationPrice = (p: Pick<BotPosition, 'side' | 'entry' | 'lev'>): number | null => (p.lev > 1 ? p.entry * (1 - (p.side === 'long' ? 1 : -1) * liqDistance(p.lev)) : null);
