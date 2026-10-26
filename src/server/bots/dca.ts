// DCA (FD-BOT §5): a cycle opens with the base order; each safety order the price reaches adds to it (all of them at
// once after a sudden fall); the take profit follows the average price, the stop loss stays where the base order was.
import { dcaOrders, reached, type DcaConfig } from '../../shared/bot.ts';
import type { DcaDeal, DcaState } from './state.ts';

export const newDca = (): DcaState => ({ cycle: 0, cooldownUntil: 0, done: false, deal: null });

export const dealAvg = (d: DcaDeal): number => d.cost / d.qty;

/** The take profit (from the average) and the stop loss (from the base order's price) of a cycle. */
export function dealLevels(cfg: DcaConfig, d: DcaDeal): { tp: number; sl: number | null } {
  const dir = d.side === 'long' ? 1 : -1;
  return {
    tp: dealAvg(d) * (1 + (dir * cfg.takeProfit) / 100),
    sl: cfg.stopLoss !== null ? d.basePrice * (1 - (dir * cfg.stopLoss) / 100) : null,
  };
}

/** The safety orders still to come: their number, price and amount. */
export function nextSafety(cfg: DcaConfig, d: DcaDeal): { k: number; price: number; amount: number }[] {
  const dir = d.side === 'long' ? 1 : -1;
  return dcaOrders(cfg)
    .filter((o) => o.k > d.filled)
    .map((o) => ({ k: o.k, price: d.basePrice * (1 - (dir * o.deviation) / 100), amount: o.amount }));
}

export type DcaAction =
  | { kind: 'open'; margin: number }
  | { kind: 'add'; ks: number[]; margin: number }
  | { kind: 'close'; reason: 'tp' | 'sl' }
  | null;

/** What the cycle does at `price`: the take profit and the stop loss first, then the safety orders reached. */
export function dcaStep(cfg: DcaConfig, st: DcaState, price: number, now: number, canOpen: boolean): DcaAction {
  const d = st.deal;
  if (!d) return !st.done && now >= st.cooldownUntil && canOpen ? { kind: 'open', margin: cfg.baseOrder } : null;
  const long = d.side === 'long';
  const { tp, sl } = dealLevels(cfg, d);
  if (reached(price, tp, long)) return { kind: 'close', reason: 'tp' };
  if (sl !== null && reached(price, sl, !long)) return { kind: 'close', reason: 'sl' };
  const due = nextSafety(cfg, d).filter((o) => reached(price, o.price, !long));
  if (!due.length) return null;
  return { kind: 'add', ks: due.map((o) => o.k), margin: due.reduce((a, o) => a + o.amount, 0) };
}

/** After a cycle closed: the next one waits for the pause, or there is none (no repeat, the limit, a stop loss that stops). */
export function afterClose(cfg: DcaConfig, st: DcaState, reason: 'tp' | 'sl' | 'other', now: number): DcaState {
  const cycle = st.cycle;
  const limit = cfg.maxCycles !== null && cycle >= cfg.maxCycles;
  const done = st.done || !cfg.repeat || limit || (reason === 'sl' && cfg.slAction === 'stop');
  return { cycle, cooldownUntil: now + cfg.cooldownMin * 60_000, done, deal: null };
}
