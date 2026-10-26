import { describe, expect, it } from 'vitest';
import { botInputSchema, dcaOrders, dcaPlan, DEFAULT_WEIGHTS, defaultBotName, gridLines, gridPlan, gridProfit, gridSlots, liqDistance, perpetualOf } from './bot.ts';

const common = {
  name: 'Test',
  exec: 'paper' as const,
  accountId: null,
  market: 'spot' as const,
  symbols: ['BTC/USDT'],
  tf: '1h' as const,
  maxAmount: 1000,
  leverage: 1,
  startsAt: null,
  endsAt: null,
  endAction: 'close' as const,
  dailyLoss: null,
  lossStop: null,
  fee: 0.1,
};
const grid = { lower: 90, upper: 110, grids: 4, spacing: 'arithmetic' as const, direction: 'long' as const, stopBelow: null, stopAbove: null, trigger: null };
const dca = { direction: 'long' as const, baseOrder: 100, safetyOrders: 3, safetyOrder: 100, volumeScale: 2, deviation: 1, stepScale: 2, takeProfit: 1.5, stopLoss: null, slAction: 'stop' as const, repeat: true, maxCycles: null, cooldownMin: 0 };
const premium = {
  direction: 'long' as const,
  sizing: 'fixed' as const,
  amount: 100,
  riskPct: 1,
  maxPerTrade: null,
  sl: 'slingshot' as const,
  slPct: 2,
  tp: 'slingshot' as const,
  rr: 2,
  exitOnTpSignal: true,
  exitOnFlip: true,
  exitOnOpposite: true,
  minScore: 50,
  areaVeto: true,
  newsWindowMin: 60,
  minRr: 1,
  weights: DEFAULT_WEIGHTS,
  ai: 'off' as const,
  aiFallback: 'skip' as const,
  maxOpen: 1,
  cooldownMin: 0,
};
const errors = (v: unknown) => {
  const r = botInputSchema.safeParse(v);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

describe('the bot settings (FD-BOT §3–§6)', () => {
  it('takes a well-formed bot of each kind', () => {
    expect(errors({ strategy: 'grid', ...common, grid })).toEqual([]);
    expect(errors({ strategy: 'dca', ...common, endAction: 'finish', dca })).toEqual([]);
    expect(errors({ strategy: 'premium', ...common, endAction: 'finish', premium })).toEqual([]);
    expect(errors({ strategy: 'premium', ...common, market: 'stock', symbols: ['AAPL', 'MSFT'], premium: { ...premium, maxOpen: 2 } })).toEqual([]);
  });

  it('a real bot on an account (shares too: FD-BOT §10), the leverage on futures', () => {
    expect(errors({ strategy: 'premium', ...common, exec: 'real', accountId: 1, market: 'stock', symbols: ['AAPL'], premium })).toEqual([]);
    expect(errors({ strategy: 'premium', ...common, exec: 'real', premium })).toContain('Alege contul în care tranzacționează botul.');
    expect(errors({ strategy: 'premium', ...common, accountId: 3, premium })).toContain('Simularea nu folosește un cont.');
    expect(errors({ strategy: 'premium', ...common, leverage: 3, premium })).toContain('Levierul se aplică doar pe futures.');
    expect(errors({ strategy: 'premium', ...common, market: 'futures', leverage: 3, premium: { ...premium, direction: 'both' } })).toEqual([]);
  });

  it('checks the symbols, the period and the number of symbols per kind', () => {
    expect(errors({ strategy: 'premium', ...common, symbols: ['BTCUSDT'], premium })).toContain('„BTCUSDT” nu e o pereche crypto (BTC/USDT)');
    expect(errors({ strategy: 'premium', ...common, market: 'stock', symbols: ['BTC/USDT'], premium })).toContain('„BTC/USDT” nu e simbolul unei acțiuni (AAPL)');
    expect(errors({ strategy: 'premium', ...common, symbols: ['BTC/USDT', 'BTC/USDT'], premium })).toContain('„BTC/USDT” apare de două ori');
    expect(errors({ strategy: 'grid', ...common, symbols: ['BTC/USDT', 'ETH/USDT'], grid })).toContain('Un bot Grid are un singur simbol.');
    expect(errors({ strategy: 'grid', ...common, startsAt: 2000, endsAt: 1000, grid })).toContain('Sfârșitul trebuie să fie după început.');
    expect(errors({ strategy: 'premium', ...common, symbols: ['BTC/USDT'], premium: { ...premium, maxOpen: 2 } })).toContain('Botul are 1 simbol: cel mult atâtea tranzacții deschise odată.');
  });

  it('a grid: its range, its direction on spot, its stops outside it, a step that pays the fees; nothing to finish', () => {
    expect(errors({ strategy: 'grid', ...common, grid: { ...grid, lower: 110, upper: 90 } })).toContain('Limita de sus trebuie să fie peste cea de jos.');
    expect(errors({ strategy: 'grid', ...common, grid: { ...grid, direction: 'neutral' } })).toContain('Pe spot nu se poate short: doar Long (short pe futures sau pe acțiuni).');
    // Shares may go short (the broker is checked by the server).
    expect(errors({ strategy: 'grid', ...common, market: 'stock', symbols: ['AAPL'], grid: { ...grid, direction: 'neutral' } })).toEqual([]);
    expect(errors({ strategy: 'grid', ...common, grid: { ...grid, stopBelow: 95 } })).toContain('„Oprește sub” trebuie să fie sub limita de jos.');
    expect(errors({ strategy: 'grid', ...common, grid: { ...grid, stopAbove: 105 } })).toContain('„Oprește peste” trebuie să fie peste limita de sus.');
    expect(errors({ strategy: 'grid', ...common, grid: { ...grid, lower: 100, upper: 100.5, grids: 10 } })).toContain('Pasul unei grile nu acoperă comisioanele: mai puține grile sau un interval mai larg.');
    expect(errors({ strategy: 'grid', ...common, endAction: 'finish', grid })[0]).toMatch(/O grilă nu are tranzacții de terminat/);
  });

  it('a DCA: no short on spot, its stop loss beyond the last safety order, its orders within the maximum', () => {
    expect(errors({ strategy: 'dca', ...common, dca: { ...dca, direction: 'short' } })).toContain('Pe spot nu se poate short: doar Long (short pe futures sau pe acțiuni).');
    expect(errors({ strategy: 'dca', ...common, market: 'stock', symbols: ['AAPL'], dca: { ...dca, direction: 'short' } })).toEqual([]);
    // The 3rd safety order is 1 + 2 + 4 = 7% away.
    expect(errors({ strategy: 'dca', ...common, dca: { ...dca, stopLoss: 7 } })[0]).toMatch(/Stop loss-ul \(7%\) e mai aproape decât ultimul ordin de siguranță \(7%\)/);
    expect(errors({ strategy: 'dca', ...common, dca: { ...dca, stopLoss: 8 } })).toEqual([]);
    // 100 + 100 + 200 + 400 = 800.
    expect(errors({ strategy: 'dca', ...common, maxAmount: 799, dca })[0]).toMatch(/Ordinele cer 800, peste suma maximă \(799\)/);
    expect(errors({ strategy: 'dca', ...common, dca: { ...dca, deviation: 30, stepScale: 2 } })).toContain('Ultimul ordin de siguranță ar fi la un preț sub zero: abateri mai mici.');
  });

  it('Premium: no short on spot, the amounts within the maximum, a weight above zero', () => {
    expect(errors({ strategy: 'premium', ...common, premium: { ...premium, direction: 'both' } })).toContain('Pe spot nu se poate short: doar Long (short pe futures sau pe acțiuni).');
    expect(errors({ strategy: 'premium', ...common, premium: { ...premium, amount: 2000 } })).toContain('Suma pe tranzacție nu poate trece de suma maximă.');
    expect(errors({ strategy: 'premium', ...common, premium: { ...premium, maxPerTrade: 2000 } })).toContain('Suma maximă pe tranzacție nu poate trece de suma maximă.');
    expect(errors({ strategy: 'premium', ...common, premium: { ...premium, weights: { day: 0, area: 0, general: 0, symbol: 0, slingshot: 0 } } })).toContain('Cel puțin o pondere a scorului trebuie să fie peste zero.');
    expect(errors({ strategy: 'premium', ...common, premium: { ...premium, extra: 1 } }).length).toBeGreaterThan(0);
  });
});

describe('the plans the form and the engine share', () => {
  it('lines: arithmetic and geometric, the top one exact', () => {
    expect(gridLines(90, 110, 4, 'arithmetic')).toEqual([90, 95, 100, 105, 110]);
    const g = gridLines(100, 400, 2, 'geometric');
    expect(g[1]).toBeCloseTo(200, 9);
    expect(g[2]).toBe(400);
    expect(gridProfit({ lower: 100, upper: 400, grids: 2, spacing: 'geometric' }, 0.1).min).toBeCloseTo(99.8, 9);
    // Arithmetic: the top grid earns the least.
    const p = gridProfit({ lower: 90, upper: 110, grids: 4, spacing: 'arithmetic' }, 0);
    expect(p.min).toBeCloseTo((110 / 105 - 1) * 100, 9);
    expect(p.max).toBeCloseTo((95 / 90 - 1) * 100, 9);
  });

  it('sides and the grids full at the start: Long above the price, Short below it, Neutral none', () => {
    const lines = [90, 95, 100, 105, 110];
    expect(gridSlots(lines, 'long', 101).map((s) => s.holding)).toEqual([false, false, true, true]);
    expect(gridSlots(lines, 'short', 101).map((s) => s.holding)).toEqual([true, true, true, false]);
    expect(gridSlots(lines, 'neutral', 101).map((s) => s.side)).toEqual(['long', 'long', 'long', 'short']);
    expect(gridSlots(lines, 'neutral', 101).some((s) => s.holding)).toBe(false);
    // On a line: the grid above it starts full (a Long grid).
    expect(gridSlots(lines, 'long', 100).map((s) => s.holding)).toEqual([false, false, true, true]);
  });

  it('a grid never uses more than the investment with all its grids full', () => {
    const g = { ...grid };
    const plan = gridPlan(g, 1000, 1, 0.1, 101);
    // Long: each grid enters at its low line: 90 + 95 + 100 + 105.
    expect(plan.qty * (90 + 95 + 100 + 105)).toBeCloseTo(1000, 9);
    expect(plan.atStart).toBe(2);
    expect(plan.startCost).toBeCloseTo(2 * plan.qty * 101, 9);
    expect(plan.minOrder).toBeCloseTo(plan.qty * 90, 9);
    // Futures × 5: five times the quantity, the margin the same.
    expect(gridPlan(g, 1000, 5, 0.1, 101).qty).toBeCloseTo(plan.qty * 5, 9);
  });

  it('DCA orders: deviations by the step multiplier, amounts by the volume one', () => {
    expect(dcaOrders(dca)).toEqual([
      { k: 0, deviation: 0, amount: 100, total: 100 },
      { k: 1, deviation: 1, amount: 100, total: 200 },
      { k: 2, deviation: 3, amount: 200, total: 400 },
      { k: 3, deviation: 7, amount: 400, total: 800 },
    ]);
    const plan = dcaPlan(dca, 100, 1);
    expect(plan[1]?.price).toBeCloseTo(99, 9);
    expect(plan[3]?.price).toBeCloseTo(93, 9);
    // The average after the second order, and its take profit.
    const avg = 200 / (1 + 100 / 99);
    expect(plan[1]?.avg).toBeCloseTo(avg, 9);
    expect(plan[1]?.tp).toBeCloseTo(avg * 1.015, 9);
    // A short's orders go up.
    expect(dcaPlan({ ...dca, direction: 'short' }, 100, 1)[2]?.price).toBeCloseTo(103, 9);
  });

  it('the liquidation distance, the perpetual of a pair, the default name', () => {
    expect(liqDistance(10)).toBeCloseTo(0.095, 9);
    expect(liqDistance(1)).toBeCloseTo(0.995, 9);
    expect(perpetualOf('BTC/USDT')).toBe('BTC/USDT:USDT');
    expect(perpetualOf('BTC/USDT:USDT')).toBe('BTC/USDT:USDT');
    expect(defaultBotName('premium', ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'])).toBe('BTC/USDT +2 · Slingshot');
    expect(defaultBotName('grid', ['AAPL'])).toBe('AAPL · Grid');
  });
});

