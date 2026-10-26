// FD-BOT §4–§6: the strategies on their own (no network, no database).
import { describe, expect, it } from 'vitest';
import { botInputSchema, DEFAULT_WEIGHTS, rrText, type DcaConfig, type GridConfig, type PremiumConfig } from '../../shared/bot.ts';
import type { SlingshotResult, SlingshotSignal } from '../../shared/indicator/slingshot.ts';
import { afterClose, dcaStep, dealLevels, newDca, nextSafety } from './dca.ts';
import { closeAllUnits, gridMoves, gridStopped, initGrid, netUnits, startMoves, triggered } from './grid.ts';
import { barEvents, exitAt, levelsFor, liquidationPrice, signalFate, sizeFor } from './premium.ts';
import { areaAgainst, favoured, marketScore, passes, scoreReach } from './score.ts';

const grid: GridConfig = { lower: 90, upper: 110, grids: 4, spacing: 'arithmetic', direction: 'long', stopBelow: 85, stopAbove: 120, trigger: null };

describe('Grid (FD-BOT §4)', () => {
  it('starts Long by filling the grids above the price, then buys low and sells high, one order per look', () => {
    const g = initGrid(grid, 1000, 1, 101, null);
    expect(g.waiting).toBeNull();
    const start = startMoves('long', g, 101);
    expect(start).toEqual([
      { i: 2, open: true },
      { i: 3, open: true },
    ]);
    expect(netUnits(g, start)).toBe(2);
    for (const m of start) g.slots[m.i]!.entry = 101;
    // Up to 105: grid 2 (100–105) empties.
    expect(gridMoves(g, 105)).toEqual([{ i: 2, open: false }]);
    // A fall to 94 fills grid 1 (95) and grid 0 waits for 90; grid 2 (empty) fills too, at 100 and below.
    g.slots[2]!.entry = null;
    const down = gridMoves(g, 94);
    expect(down).toEqual([
      { i: 1, open: true },
      { i: 2, open: true },
    ]);
    expect(netUnits(g, down)).toBe(2);
    // A jump past every line: everything full empties at once, nothing fills again on the same look.
    for (const m of down) g.slots[m.i]!.entry = 94;
    const up = gridMoves(g, 111);
    expect(up.every((m) => !m.open)).toBe(true);
    expect(netUnits(g, up)).toBe(-3);
    expect(closeAllUnits(g)).toBe(-3);
  });

  it('Short sells below the price at the start; Neutral starts empty, long below and short above', () => {
    const s = initGrid({ ...grid, direction: 'short' }, 1000, 2, 101, null);
    expect(startMoves('short', s, 101).map((m) => m.i)).toEqual([0, 1, 2]);
    expect(netUnits(s, startMoves('short', s, 101))).toBe(-3);
    const n = initGrid({ ...grid, direction: 'neutral' }, 1000, 2, 101, null);
    expect(startMoves('neutral', n, 101)).toEqual([]);
    expect(n.slots.map((x) => x.side)).toEqual(['long', 'long', 'long', 'short']);
    // The short grid (105–110) opens by selling at 110 and closes by buying back at 105.
    expect(gridMoves(n, 110)).toEqual([{ i: 3, open: true }]);
    n.slots[3]!.entry = 110;
    expect(netUnits(n, gridMoves(n, 110))).toBe(0);
    expect(gridMoves(n, 105)).toEqual([{ i: 3, open: false }]);
    expect(closeAllUnits(n)).toBe(1);
  });

  it('waits for its start price, up or down from the price when it was made; stops below / above', () => {
    const up = initGrid({ ...grid, trigger: 102 }, 1000, 1, 100, 100);
    expect(up.waiting).toEqual({ trigger: 102, above: true });
    expect(triggered(up, 101)).toBe(false);
    expect(triggered(up, 102)).toBe(true);
    const down = initGrid({ ...grid, trigger: 98 }, 1000, 1, 100, 100);
    expect(triggered(down, 99)).toBe(false);
    expect(triggered(down, 97)).toBe(true);
    // Already passed when the bot first looks: it starts at once.
    expect(initGrid({ ...grid, trigger: 102 }, 1000, 1, 103, 100).waiting).toBeNull();
    expect(gridStopped(grid, 85)).toBe('below');
    expect(gridStopped(grid, 120)).toBe('above');
    expect(gridStopped(grid, 100)).toBeNull();
  });
});

const dca: DcaConfig = { direction: 'long', baseOrder: 100, safetyOrders: 3, safetyOrder: 100, volumeScale: 2, deviation: 1, stepScale: 2, takeProfit: 1.5, stopLoss: 10, slAction: 'stop', repeat: true, maxCycles: 2, cooldownMin: 5 };

describe('DCA (FD-BOT §5)', () => {
  it('opens, adds the safety orders reached (several at once), takes profit from the average, stops from the base', () => {
    const st = newDca();
    expect(dcaStep(dca, st, 100, 0, false)).toBeNull();
    expect(dcaStep(dca, st, 100, 0, true)).toEqual({ kind: 'open', margin: 100 });
    st.deal = { side: 'long', basePrice: 100, filled: 0, qty: 1, cost: 100, margin: 100, fees: 0, openedAt: 0 };
    expect(dcaStep(dca, st, 99.5, 0, true)).toBeNull();
    // 96.5: the 1st (99) and the 2nd (97) at once; the 3rd (93) still waits.
    expect(dcaStep(dca, st, 96.5, 0, false)).toEqual({ kind: 'add', ks: [1, 2], margin: 300 });
    st.deal = { ...st.deal, filled: 2, qty: 1 + 100 / 96.5 + 200 / 96.5, cost: 400 };
    const lv = dealLevels(dca, st.deal);
    expect(lv.tp).toBeCloseTo((400 / st.deal.qty) * 1.015, 9);
    expect(lv.sl).toBeCloseTo(90, 9);
    expect(nextSafety(dca, st.deal)).toEqual([{ k: 3, price: 93, amount: 400 }]);
    expect(dcaStep(dca, st, lv.tp, 0, true)).toEqual({ kind: 'close', reason: 'tp' });
    expect(dcaStep(dca, st, 90, 0, true)).toEqual({ kind: 'close', reason: 'sl' });
  });

  it('after a cycle: the pause, the limit of cycles, a stop loss that stops, no repeat', () => {
    const one = afterClose(dca, { cycle: 1, cooldownUntil: 0, done: false, deal: null }, 'tp', 1000);
    expect(one).toEqual({ cycle: 1, cooldownUntil: 1000 + 5 * 60_000, done: false, deal: null });
    expect(dcaStep(dca, one, 100, 1000, true)).toBeNull();
    expect(dcaStep(dca, one, 100, 1000 + 5 * 60_000, true)).toEqual({ kind: 'open', margin: 100 });
    expect(afterClose(dca, { cycle: 2, cooldownUntil: 0, done: false, deal: null }, 'tp', 0).done).toBe(true);
    expect(afterClose(dca, { cycle: 1, cooldownUntil: 0, done: false, deal: null }, 'sl', 0).done).toBe(true);
    expect(afterClose({ ...dca, slAction: 'restart' }, { cycle: 1, cooldownUntil: 0, done: false, deal: null }, 'sl', 0).done).toBe(false);
    expect(afterClose({ ...dca, repeat: false }, { cycle: 1, cooldownUntil: 0, done: false, deal: null }, 'tp', 0).done).toBe(true);
  });

  it('a short adds above and takes profit below', () => {
    const st = { ...newDca(), deal: { side: 'short' as const, basePrice: 100, filled: 0, qty: 1, cost: 100, margin: 100, fees: 0, openedAt: 0 } };
    const short = { ...dca, direction: 'short' as const };
    expect(dcaStep(short, st, 101, 0, true)).toEqual({ kind: 'add', ks: [1], margin: 100 });
    expect(dcaStep(short, st, 98.5, 0, true)).toEqual({ kind: 'close', reason: 'tp' });
    expect(dcaStep(short, st, 110, 0, true)).toEqual({ kind: 'close', reason: 'sl' });
  });
});

const premium: PremiumConfig = {
  direction: 'both',
  sizing: 'fixed',
  amount: 100,
  riskPct: 1,
  maxPerTrade: null,
  levels: 'slingshot',
  slPct: 1,
  tpPct: 2,
  exitOnTpSignal: true,
  exitOnFlip: true,
  exitOnOpposite: true,
  longMin: 50,
  shortMax: 50,
  areaVeto: true,
  newsWindowMin: 60,
  weights: DEFAULT_WEIGHTS,
  ai: 'off',
  aiFallback: 'skip',
  maxOpen: 1,
  cooldownMin: 0,
};
const signal = (over: Partial<SlingshotSignal>): SlingshotSignal => ({ side: 'long', bar: 8, time: 8000, confirmBar: 10, confirmTime: 10_000, entry: 95, sl: 90, tp: 110, breakout: 100, outcome: 'active', provisional: false, ...over });
const result = (signals: SlingshotSignal[], alerts: SlingshotResult['alerts'] = []): SlingshotResult => ({ emaFast: [], emaSlow: [], uptrend: [], markers: [], signals, alerts, atr: null, atrShort: null, ms: null, last: null, warnings: [] });

describe('Slingshot Premium (FD-BOT §6)', () => {
  it('takes only the signals confirmed on the closed bar, and the take profit signals there', () => {
    const r = result(
      [signal({}), signal({ confirmBar: 9 }), signal({ side: 'short', confirmBar: 11, provisional: true })],
      [
        { bar: 10, time: 10_000, type: 'shortTakeProfitSignal', provisional: false },
        { bar: 7, time: 7000, type: 'msBearish', provisional: false },
        { bar: 9, time: 9000, type: 'msBullish', provisional: false },
        { bar: 11, time: 11_000, type: 'takeProfitSignal', provisional: true },
      ],
    );
    const ev = barEvents(r, 10);
    expect(ev.signals).toHaveLength(1);
    expect(ev.tpSignal).toEqual({ long: false, short: true });
    expect(ev.structure).toBe('msBullish');
  });

  it("knows what became of a position's signal: SL, the ATR TP, the TP signal, the trend's turn; a superseded one is kept", () => {
    const at = (s: Partial<SlingshotSignal>) => signalFate(result([signal(s)]), 'long', 8000, 12);
    expect(at({})).toBeNull();
    expect(at({ outcome: 'sl', outcomeReason: 'stopLoss', closedBar: 12 })).toBe('sl');
    expect(at({ outcome: 'tp', outcomeReason: 'atrTakeProfit', closedBar: 11 })).toBe('tp');
    expect(at({ outcome: 'tp', outcomeReason: 'takeProfitSignal', closedBar: 11 })).toBe('tp_signal');
    expect(at({ outcome: 'invalidated', outcomeReason: 'trendFlip', closedBar: 11 })).toBe('flip');
    expect(at({ outcome: 'invalidated', outcomeReason: 'superseded', closedBar: 11 })).toBeNull();
    // Closed on the forming bar: not yet.
    expect(at({ outcome: 'sl', outcomeReason: 'stopLoss', closedBar: 13 })).toBeNull();
  });

  it("levels: the signal's, or the user's percents from the entry; refused past the stop loss or the take profit", () => {
    expect(levelsFor(premium, signal({}), 100)).toEqual({ sl: 90, tp: 110 });
    // FD-BOTPCT: 1% and 2% from the entry, a long and a short.
    const long = levelsFor({ ...premium, levels: 'percent' }, signal({}), 100) as { sl: number; tp: number };
    expect(long.sl).toBeCloseTo(99, 9);
    expect(long.tp).toBeCloseTo(102, 9);
    const short = levelsFor({ ...premium, levels: 'percent', slPct: 2, tpPct: 3 }, signal({ side: 'short' }), 100) as { sl: number; tp: number };
    expect(short.sl).toBeCloseTo(102, 9);
    expect(short.tp).toBeCloseTo(97, 9);
    expect(levelsFor({ ...premium, levels: 'percent', slPct: 10, tpPct: 100 }, signal({ side: 'short' }), 100)).toEqual({ error: 'Take profit-ul ar fi la un preț sub zero.' });
    expect(levelsFor(premium, signal({}), 89)).toEqual({ error: 'Prețul a trecut deja de stop loss.' });
    expect(levelsFor(premium, signal({}), 111)).toEqual({ error: 'Prețul a atins deja take profit-ul.' });
  });

  it("FD-BOTSLRR: Slingshot's levels are taken as they are, whatever the R:R from the price now", () => {
    // Entered late: 0.2 of reward for 1 of risk from the price now, still the signal's levels.
    expect(levelsFor(premium, signal({ sl: 90, tp: 110 }), 106.6)).toEqual({ sl: 90, tp: 110 });
    expect(levelsFor(premium, signal({ side: 'short', sl: 103.97, tp: 103.55 }), 103.75)).toEqual({ sl: 103.97, tp: 103.55 });
    // The hidden percents play no part.
    expect(levelsFor({ ...premium, slPct: 5, tpPct: 1 }, signal({}), 100)).toEqual({ sl: 90, tp: 110 });
  });

  it('FD-BOTPCT: the settings saved before read with the same levels; the ratio 1:x within 2:1 … 1:10', () => {
    const base = { name: 'B', exec: 'paper', accountId: null, market: 'spot', symbols: ['BTC/USDT'], tf: '1h', maxAmount: 1000, leverage: 1, startsAt: null, endsAt: null, endAction: 'finish', dailyLoss: null, lossStop: null, fee: 0.1, strategy: 'premium' };
    const { levels: _l, slPct: _s, tpPct: _t, ...rest } = premium;
    const read = (old: Record<string, unknown>) => {
      const r = botInputSchema.safeParse({ ...base, premium: { ...rest, direction: 'long', ...old } });
      expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
      return (r.data as { premium: PremiumConfig }).premium;
    };
    // The SOL bot (Slingshot, SL 2%, R 2, a minimum R:R): Slingshot, the hidden percents 2% and 4%.
    const sol = read({ sl: 'slingshot', slPct: 2, tp: 'slingshot', rr: 2, minRr: 1 });
    expect(sol).toMatchObject({ levels: 'slingshot', slPct: 2, tpPct: 4 });
    for (const k of ['sl', 'tp', 'rr', 'rrRisk', 'rrReward', 'minRr']) expect(k in sol).toBe(false);
    // "Risc / câștig" with a stop of 1.5% and R 3 (before FD-BOTSLRR), with 2:3 (FD-BOTSLRR): the same levels.
    expect(read({ sl: 'percent', slPct: 1.5, tp: 'rr', rr: 3, minRr: 1 })).toMatchObject({ levels: 'percent', slPct: 1.5, tpPct: 4.5 });
    expect(read({ sl: 'percent', slPct: 2, tp: 'rr', rrRisk: 2, rrReward: 3 })).toMatchObject({ levels: 'percent', slPct: 2, tpPct: 3 });
    expect(rrText(2, 3)).toBe('1:1,5');
    expect(rrText(1.5, 2)).toBe('1:1,33');
    const pct = (slPct: number, tpPct: number) => botInputSchema.safeParse({ ...base, premium: { ...premium, direction: 'long', levels: 'percent', slPct, tpPct } });
    expect(pct(2, 1).success).toBe(true);
    expect(pct(1, 10).success).toBe(true);
    expect(pct(1, 20).error?.issues[0]).toMatchObject({ path: ['premium', 'tpPct'], message: 'Raportul risc : câștig 1:20 iese din limite: take profit-ul e între jumătate și de 10 ori distanța stop loss-ului (de la 2:1 la 1:10).' });
    expect(pct(3, 1).success).toBe(false);
    expect(pct(60, 100).error?.issues[0]?.message).toBe('Stop loss-ul: cel mult 50');
    // With Slingshot's levels the percents are not checked against each other.
    expect(botInputSchema.safeParse({ ...base, premium: { ...premium, direction: 'long', slPct: 5, tpPct: 1 } }).success).toBe(true);
  });

  it('FD-BOTDIR: one minimum M saved before reads as a long from M and a short to 100 − M; with both ways the thresholds win', () => {
    const base = { name: 'B', exec: 'paper', accountId: null, market: 'futures', symbols: ['SOL/USDT'], tf: '2h', maxAmount: 450, leverage: 3, startsAt: null, endsAt: null, endAction: 'finish', dailyLoss: null, lossStop: null, fee: 0.1, strategy: 'premium' };
    const { longMin: _l, shortMax: _s, ...rest } = premium;
    const parse = (old: Record<string, unknown>) => botInputSchema.safeParse({ ...base, premium: { ...rest, direction: 'both', ...old } });
    const read = (old: Record<string, unknown>) => {
      const r = parse(old);
      expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
      return (r.data as { premium: PremiumConfig }).premium;
    };
    const sol = read({ minScore: 39 });
    expect(sol).toMatchObject({ longMin: 39, shortMax: 61 });
    expect('minScore' in sol).toBe(false);
    // The SOL bot as it was first saved (before FD-BOTPCT too): both upgrades.
    const { levels: _v, slPct: _p, tpPct: _t, ...older } = rest;
    const first = botInputSchema.safeParse({ ...base, premium: { ...older, direction: 'both', sl: 'slingshot', slPct: 2, tp: 'slingshot', rr: 2, minRr: 1, minScore: 45 } });
    expect(first.success, JSON.stringify(first.error?.issues)).toBe(true);
    expect((first.data as { premium: PremiumConfig }).premium).toMatchObject({ levels: 'slingshot', slPct: 2, tpPct: 4, longMin: 45, shortMax: 55 });
    expect(read({ minScore: 70, longMin: 40, shortMax: 60 })).toMatchObject({ longMin: 40, shortMax: 60 });
    expect(read({ longMin: 0, shortMax: 100 })).toMatchObject({ longMin: 0, shortMax: 100 });
    expect(parse({ minScore: 'x' }).error?.issues[0]?.message).toBe('Scorul minim pentru long: lipsește');
    expect(parse({ longMin: 101, shortMax: 50 }).error?.issues[0]?.message).toBe('Scorul minim pentru long: cel mult 100');
    expect(parse({ longMin: 50, shortMax: 2.5 }).error?.issues[0]?.message).toBe('Scorul maxim pentru short: un număr întreg');
  });

  it('size: a fixed amount at the maximum leverage, cut to what is free; the leverage lowered for the liquidation', () => {
    const fixed = sizeFor({ cfg: premium, futures: true, maxAmount: 1000, maxLeverage: 5, free: 1000, price: 100, sl: 98 });
    expect(fixed).toMatchObject({ margin: 100, lev: 5, notional: 500, qty: 5, notes: [] });
    expect(sizeFor({ cfg: premium, futures: true, maxAmount: 1000, maxLeverage: 5, free: 60, price: 100, sl: 98 })).toMatchObject({ margin: 60, notional: 300 });
    // A stop loss 9% away: at 10× the liquidation is ~9.5% away; the leverage comes down to 8× (80% of 12% > 9%).
    const far = sizeFor({ cfg: premium, futures: true, maxAmount: 1000, maxLeverage: 10, free: 1000, price: 100, sl: 91 }) as { lev: number; notes: string[] };
    expect(far.lev).toBe(8);
    expect(far.notes[0]).toMatch(/Levierul a fost coborât/);
    expect(sizeFor({ cfg: premium, futures: false, maxAmount: 1000, maxLeverage: 1, free: 0, price: 100, sl: 98 })).toEqual({ error: 'Suma maximă e toată în tranzacții deschise.' });
  });

  it('size by risk: the loss at the stop loss is the share asked for, at the smallest leverage that fits', () => {
    const cfg = { ...premium, sizing: 'risk' as const, riskPct: 1 };
    // 1% of 1000 = 10 at a stop 2% away: 500 of position; 100 free → 5×.
    const r = sizeFor({ cfg, futures: true, maxAmount: 1000, maxLeverage: 10, free: 100, price: 100, sl: 98 }) as { notional: number; lev: number; margin: number };
    expect(r.notional).toBeCloseTo(500, 9);
    expect(r.lev).toBe(5);
    expect(r.margin).toBeCloseTo(100, 9);
    // Spot: no leverage, so the position is cut to what is free.
    const spot = sizeFor({ cfg, futures: false, maxAmount: 1000, maxLeverage: 1, free: 100, price: 100, sl: 98 }) as { notional: number; notes: string[] };
    expect(spot.notional).toBe(100);
    expect(spot.notes[0]).toMatch(/Riscul e mai mic/);
  });

  it('exits at the stop loss or the take profit; a simulated liquidation price', () => {
    expect(exitAt({ side: 'long', sl: 90, tp: 110 }, 89)).toBe('sl');
    expect(exitAt({ side: 'long', sl: 90, tp: 110 }, 110)).toBe('tp');
    expect(exitAt({ side: 'short', sl: 110, tp: 90 }, 111)).toBe('sl');
    expect(exitAt({ side: 'short', sl: 110, tp: 90 }, 100)).toBeNull();
    expect(liquidationPrice({ side: 'long', entry: 100, lev: 10 })).toBeCloseTo(90.5, 9);
    expect(liquidationPrice({ side: 'short', entry: 100, lev: 10 })).toBeCloseTo(109.5, 9);
    expect(liquidationPrice({ side: 'long', entry: 100, lev: 1 })).toBeNull();
  });
});

describe("the market's score (FD-BOT §6, FD-BOTDIR)", () => {
  const none = { day: null, area: null, general: null, symbol: null };
  const neutral = { day: { index: 50, confidence: 'high' as const }, area: { index: 50, count: 20 }, general: 50, symbol: { index: 50, confidence: 'high' as const, count: 3 } };

  it('only the parts with data count; a neutral context is 50; the structure up or down moves it; no R:R in it (FD-BOTSLRR)', () => {
    const s = marketScore({ ...none, slingshot: { structure: 'up' } }, DEFAULT_WEIGHTS);
    // Slingshot alone: the last break up, a = 0.4 → 50 + 50 × 0.4.
    expect(s.score).toBe(70);
    expect(s.parts.find((p) => p.key === 'slingshot')).toMatchObject({ value: 1, a: 0.4, note: 'ultima rupere în sus' });
    expect(s.parts.find((p) => p.key === 'area')).toMatchObject({ value: null, a: 0, note: 'fără date' });
    expect(marketScore({ ...none, slingshot: { structure: 'down' } }, DEFAULT_WEIGHTS).score).toBe(30);
    expect(marketScore({ ...neutral, slingshot: { structure: 'none' } }, DEFAULT_WEIGHTS).score).toBe(50);
    expect(marketScore({ ...neutral, slingshot: { structure: 'up' } }, DEFAULT_WEIGHTS).score).toBe(54);
    const down = marketScore({ ...neutral, slingshot: { structure: 'down' } }, DEFAULT_WEIGHTS);
    expect(down.score).toBe(46);
    expect(down.parts.find((p) => p.key === 'slingshot')).toMatchObject({ value: -1, a: -0.4, note: 'ultima rupere în jos' });
  });

  it('a negative market is a low score, the same whichever side the signal: it lets a short in and keeps a long out', () => {
    const bearish = { day: { index: 30, confidence: 'high' as const }, area: { index: 25, count: 40 }, general: 40, symbol: { index: 30, confidence: 'medium' as const, count: 5 }, slingshot: { structure: 'down' as const } };
    const s = marketScore(bearish, DEFAULT_WEIGHTS);
    expect(s.score).toBeLessThan(40);
    expect(s.parts.every((p) => p.a < 0)).toBe(true);
    const cfg = { longMin: 50, shortMax: 50 };
    expect(passes('short', s.score, cfg)).toBe(true);
    expect(passes('long', s.score, cfg)).toBe(false);
    // Few news: the area counts less.
    expect(marketScore({ ...none, area: { index: 0, count: 2 }, slingshot: { structure: 'none' } }, { ...DEFAULT_WEIGHTS, slingshot: 0 }).score).toBe(25);
  });

  it('each side its threshold, the value itself included; the side the market favours goes first; the score a weighing can reach', () => {
    const cfg = { longMin: 55, shortMax: 45 };
    expect(passes('long', 55, cfg)).toBe(true);
    expect(passes('long', 54.9, cfg)).toBe(false);
    expect(passes('short', 45, cfg)).toBe(true);
    expect(passes('short', 45.1, cfg)).toBe(false);
    // Overlapping thresholds: both sides in between.
    expect(passes('long', 50, { longMin: 39, shortMax: 61 }) && passes('short', 50, { longMin: 39, shortMax: 61 })).toBe(true);
    expect(passes('long', 0, { longMin: 0, shortMax: 100 }) && passes('short', 100, { longMin: 0, shortMax: 100 })).toBe(true);
    expect(favoured('long', 70)).toBeGreaterThan(favoured('short', 70));
    expect(favoured('short', 30)).toBeGreaterThan(favoured('long', 30));
    expect(favoured('short', 50)).toBe(favoured('long', 50));
    // The default weights: 50 + 50 × (80 + 0.4 × 20) / 100 = 94; without the structure, the indices reach 100.
    expect(scoreReach(DEFAULT_WEIGHTS)).toBe(94);
    expect(scoreReach({ ...DEFAULT_WEIGHTS, slingshot: 0 })).toBe(100);
    expect(scoreReach({ day: 0, area: 0, general: 0, symbol: 0, slingshot: 10 })).toBe(70);
    const top = marketScore({ day: { index: 100, confidence: 'high' }, area: { index: 100, count: 10 }, general: 100, symbol: { index: 100, confidence: 'high', count: 3 }, slingshot: { structure: 'up' } }, DEFAULT_WEIGHTS);
    expect(top.score).toBe(94);
  });

  it('the area against: a long under 40, a short from 60; no news, no veto', () => {
    expect(areaAgainst('long', { index: 39.9, count: 5 })).toBe(true);
    expect(areaAgainst('long', { index: 40, count: 5 })).toBe(false);
    expect(areaAgainst('short', { index: 60, count: 5 })).toBe(true);
    expect(areaAgainst('short', { index: 59, count: 5 })).toBe(false);
    expect(areaAgainst('long', null)).toBe(false);
  });
});
