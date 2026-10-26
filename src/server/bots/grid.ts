// The grid (FD-BOT §4): each grid between two lines buys at its low line and sells at its high one (a long), or the
// other way round (a short). At each look, every grid the price has reached moves; together they make one order.
import { gridPlan, reached, type GridConfig } from '../../shared/bot.ts';
import type { GridState } from './state.ts';

/**
 * The grid at `price`, before its start order (the grids that start full are filled by it). With a start price not yet
 * reached it waits; `refPrice` (the price when the bot was made) says whether the price has to rise or fall to it. A
 * Neutral grid's sides follow the price it starts at: it is made again then.
 */
export function initGrid(cfg: GridConfig, investment: number, lev: number, price: number, refPrice: number | null): GridState {
  const plan = gridPlan(cfg, investment, lev, 0, price);
  const ref = refPrice ?? price;
  const waiting = cfg.trigger !== null ? { trigger: cfg.trigger, above: cfg.trigger > ref } : null;
  return {
    lines: plan.lines,
    qty: plan.qty,
    lev,
    waiting: waiting && !reached(price, waiting.trigger, waiting.above) ? waiting : null,
    started: false,
    slots: plan.slots.map((s) => ({ side: s.side, entry: null, openedAt: null, fees: 0 })),
  };
}

/** The start price reached (or none to wait for). */
export const triggered = (g: GridState, price: number): boolean => !g.waiting || reached(price, g.waiting.trigger, g.waiting.above);

export interface GridMove {
  /** Grid index, and whether it opens (fills) or closes (empties). */
  i: number;
  open: boolean;
}

/**
 * The grids the price has reached: an empty long at or under its low line fills, a full long at or over its high line
 * empties; a short the other way round. A grid that empties is never filled again on the same look.
 */
export function gridMoves(g: GridState, price: number): GridMove[] {
  const out: GridMove[] = [];
  g.slots.forEach((s, i) => {
    const low = g.lines[i] as number;
    const high = g.lines[i + 1] as number;
    const full = s.entry !== null;
    if (s.side === 'long') {
      if (!full && reached(price, low, false)) out.push({ i, open: true });
      else if (full && reached(price, high, true)) out.push({ i, open: false });
    } else if (!full && reached(price, high, true)) out.push({ i, open: true });
    else if (full && reached(price, low, false)) out.push({ i, open: false });
  });
  return out;
}

/** The grids that start full: a Long grid's above the price, a Short grid's below it; a Neutral one none (FD-BOT §4). */
export function startMoves(direction: GridConfig['direction'], g: GridState, price: number): GridMove[] {
  if (direction === 'neutral') return [];
  return g.slots.flatMap((_, i) => ((direction === 'long' ? (g.lines[i + 1] as number) > price : (g.lines[i] as number) < price) ? [{ i, open: true }] : []));
}

/** Units bought minus units sold by these moves (a long fills by buying, a short by selling). */
export function netUnits(g: GridState, moves: GridMove[]): number {
  let net = 0;
  for (const m of moves) {
    const long = (g.slots[m.i] as GridState['slots'][number]).side === 'long';
    net += long === m.open ? 1 : -1;
  }
  return net;
}

/** Closing every full grid: the units to buy (positive) or sell. */
export function closeAllUnits(g: GridState): number {
  let net = 0;
  for (const s of g.slots) if (s.entry !== null) net += s.side === 'long' ? -1 : 1;
  return net;
}

/** Stopped by "Oprește sub / peste". */
export function gridStopped(cfg: GridConfig, price: number): 'below' | 'above' | null {
  if (cfg.stopBelow !== null && reached(price, cfg.stopBelow, false)) return 'below';
  if (cfg.stopAbove !== null && reached(price, cfg.stopAbove, true)) return 'above';
  return null;
}
