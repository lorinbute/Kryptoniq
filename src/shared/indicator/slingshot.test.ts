import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SLINGSHOT_PARAMS, type SlingshotParams } from './params.ts';
import { computeSlingshotSeries, htfCandleCount, LabelRegistry, makeHtfMapper, runSlingshot, type Candle, type SlingshotSeries } from './slingshot.ts';

const H = 3600_000;
const loadFixture = (name: string): Candle[] =>
  (JSON.parse(readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), 'utf8')) as number[][]).map(
    ([t, o, h, l, c, v]) => ({ t: t as number, o: o as number, h: h as number, l: l as number, c: c as number, v: v as number }),
  );

/** Bars described as [high, low, close?]; open = close = midpoint when not given. */
function bars(spec: [number, number, number?][]): Candle[] {
  return spec.map(([h, l, c], i) => {
    const close = c ?? (h + l) / 2;
    return { t: i * H, o: close, h, l, c: close, v: 1 };
  });
}

/** Constant uptrend cloud between 100 and 110, ATR 2, with a K path. */
function upSeries(k: number[], overrides: Partial<{ fast: number[]; slow: number[]; atr: number }> = {}): SlingshotSeries {
  const n = k.length;
  return {
    emaFast: overrides.fast ?? new Array(n).fill(110),
    emaSlow: overrides.slow ?? new Array(n).fill(100),
    kLine: k,
    atr: new Array(n).fill(overrides.atr ?? 2),
  };
}

const params = (over: Partial<SlingshotParams> = {}): SlingshotParams => ({ ...DEFAULT_SLINGSHOT_PARAMS, showMS: false, ...over });

const run = (candles: Candle[], series: SlingshotSeries, over: Partial<SlingshotParams> = {}) =>
  runSlingshot({ candles, series, chartTfSec: 3600, msTfSec: 3600, params: params(over), nowMs: 10_000 * H });

// V1 at bar 0, deal at bar 2, V2 search bars 3-4 (best low 106 at bar 4), confirmation at bar 5.
const SETUP: [number, number, number?][] = [
  [112, 105], // 0: K 10, touches cloud → V1 candidate (low 105)
  [125, 115], // 1: K 50
  [130, 120], // 2: K 85 → deal locked, V1 = bar 0
  [111, 107], // 3: K 15, touches cloud, low 107 > 105 → V2 search starts
  [110, 106], // 4: K 12, lower low 106 → best V2
  [112, 108], // 5: K 30 → exit oversold → LONG confirmed (label on bar 4)
];
const SETUP_K = [10, 50, 85, 15, 12, 30];

describe('Slingshot state machine', () => {
  it('confirms a LONG on exit from oversold and sets TP/SL from ATR and the lookback high', () => {
    const r = run(bars(SETUP), upSeries(SETUP_K));
    expect(r.signals).toHaveLength(1);
    const s = r.signals[0]!;
    expect(s.bar).toBe(4);
    expect(s.confirmBar).toBe(5);
    expect(s.entryLow).toBe(106);
    expect(s.breakout).toBe(130); // highest high of the previous `lookback` bars
    expect(s.tp).toBe(132);
    expect(s.sl).toBe(104);
    expect(s.outcome).toBe('active');
    expect(r.alerts.map((a) => [a.bar, a.type])).toEqual([[5, 'longSignal']]);
    expect(r.markers).toEqual([expect.objectContaining({ kind: 'long', bar: 4, color: 'tp' })]);
    expect(r.atr).toMatchObject({ tp: 132, sl: 104, fromBar: 4, toBarTp: 55, toBarSl: 55, labelBar: 10 });
  });

  it('take profit: TP label follows higher highs, success keeps the signal green', () => {
    const candles = bars([...SETUP, [131, 120], [133, 125], [132, 126]]);
    const r = run(candles, upSeries([...SETUP_K, 60, 70, 75]));
    expect(r.signals[0]).toMatchObject({ outcome: 'tp', outcomeReason: 'takeProfitSignal', closedBar: 6 });
    expect(r.alerts.map((a) => [a.bar, a.type])).toEqual([
      [5, 'longSignal'],
      [6, 'takeProfitSignal'],
      [7, 'atrTakeProfit'],
      [8, 'atrTakeProfit'], // fires on every bar whose high is at/above the ATR target, like the Pine alertcondition
    ]);
    const tp = r.markers.filter((m) => m.kind === 'takeProfit');
    expect(tp).toHaveLength(1);
    expect(tp[0]!.bar).toBe(7); // moved to the highest high
    expect(r.markers.find((m) => m.kind === 'long')!.color).toBe('tp');
    expect(r.atr).toBeNull(); // hideAtrOnTP
  });

  it('keeps showing TP/SL after the take profit when hideAtrOnTP is off', () => {
    const candles = bars([...SETUP, [131, 120]]);
    const r = run(candles, upSeries([...SETUP_K, 60]), { hideAtrOnTP: false });
    expect(r.atr).toMatchObject({ tp: 132, sl: 104 });
  });

  it('stop loss turns the signal red and stops the TP tracking', () => {
    const candles = bars([...SETUP, [109, 103], [131, 120]]);
    const r = run(candles, upSeries([...SETUP_K, 25, 60]));
    expect(r.signals[0]).toMatchObject({ outcome: 'sl', outcomeReason: 'stopLoss', closedBar: 6 });
    expect(r.alerts.map((a) => a.type)).toEqual(['longSignal', 'atrStopLoss']);
    expect(r.markers.find((m) => m.kind === 'long')!.color).toBe('sl');
    expect(r.markers.some((m) => m.kind === 'takeProfit')).toBe(false);
    expect(r.atr).toBeNull();
  });

  it('a trend flip invalidates the active signal (red)', () => {
    const candles = bars([...SETUP, [111, 108]]);
    const fast = [...new Array(6).fill(110), 95];
    const r = run(candles, upSeries([...SETUP_K, 40], { fast }));
    expect(r.signals[0]).toMatchObject({ outcome: 'invalidated', outcomeReason: 'trendFlip', closedBar: 6 });
    expect(r.markers.find((m) => m.kind === 'long')!.color).toBe('sl');
    expect(r.uptrend.at(-1)).toBe(false);
    // The label history and the TP/SL tracking are independent (as in Pine): the levels are still tracked.
    expect(r.last?.waitingLongTP).toBe(true);
    expect(r.atr).toMatchObject({ tp: 132, sl: 104, fromBar: 4 });
  });

  it('a new signal supersedes the still-active one (old turns red)', () => {
    const candles = bars([
      ...SETUP,
      [125, 115], // 6: K 85 → new deal (V1 = last candidate, bar 4 low 106)
      [111, 108], // 7: K 15, touch, low 108 > 106 → V2 search
      [112, 109], // 8: K 40 → second LONG confirmed
    ]);
    const r = run(candles, upSeries([...SETUP_K, 85, 15, 40]));
    expect(r.signals).toHaveLength(2);
    expect(r.signals[0]).toMatchObject({ outcome: 'invalidated', outcomeReason: 'superseded', closedBar: 8 });
    expect(r.signals[1]).toMatchObject({ bar: 7, outcome: 'active' });
    const longs = r.markers.filter((m) => m.kind === 'long').sort((a, b) => a.bar - b.bar);
    expect(longs.map((m) => [m.bar, m.color])).toEqual([
      [4, 'sl'],
      [7, 'tp'],
    ]);
  });

  it('a pullback below the V1 low cancels the V2 search (no signal)', () => {
    const candles = bars([...SETUP.slice(0, 4), [110, 104], [112, 108]]);
    const r = run(candles, upSeries([10, 50, 85, 15, 12, 30]));
    expect(r.signals).toHaveLength(0);
    expect(r.markers).toHaveLength(0);
  });

  it('shows the live LONG preview and live TP/SL while V2 is forming', () => {
    const candles = bars(SETUP.slice(0, 5));
    const r = run(candles, upSeries(SETUP_K.slice(0, 5)));
    expect(r.markers).toEqual([expect.objectContaining({ kind: 'longPreview', bar: 4 })]);
    expect(r.atr).toMatchObject({ tp: 132, sl: 104, fromBar: 4 });
    expect(r.last).toMatchObject({ liveSignal: true, waitingLongTP: false });
  });

  it('marks markers/alerts on a still-forming last candle as provisional', () => {
    const candles = bars(SETUP);
    const r = runSlingshot({ candles, series: upSeries(SETUP_K), chartTfSec: 3600, msTfSec: 3600, params: params(), nowMs: 5 * H + 1 });
    expect(r.alerts[0]).toMatchObject({ type: 'longSignal', provisional: true });
    expect(r.signals[0]!.provisional).toBe(true);
    expect(r.markers[0]!.provisional).toBe(false); // the label sits on bar 4, which is closed
  });

  it('no deal without an overbought K', () => {
    const r = run(bars(SETUP), upSeries([10, 50, 70, 15, 12, 30]));
    expect(r.signals).toHaveLength(0);
  });

  it('kTol widens the oversold / overbought thresholds', () => {
    const r = run(bars(SETUP), upSeries([10, 50, 79, 15, 21, 30]), { kTol: 1.5 });
    // 79 ≥ 80 - 1.5 locks the deal; 21 ≤ 20 + 1.5 keeps tracking V2 (start needs K ≤ 20 strictly, bar 3 has 15)
    expect(r.signals).toHaveLength(1);
    expect(r.signals[0]!.bar).toBe(4);
  });
});

describe('v3.3 — a confirmed signal keeps its TP/SL tracking', () => {
  // SETUP confirms a LONG at bar 5 (entry 106, SL 104, breakout 130, ATR TP 132), then a new deal locks at bar 6.
  const NEW_DEAL: [number, number, number?][] = [...SETUP, [125, 115]];
  const NEW_DEAL_K = [...SETUP_K, 85];

  it('trend flip after a new deal: levels stay, the stop loss still fires', () => {
    const candles = bars([...NEW_DEAL, [111, 108], [109, 103]]);
    const fast = [...new Array(7).fill(110), 95, 95];
    const k = [...NEW_DEAL_K, 40, 30];
    // up to the trend flip (bar 7): still tracked, no NaN
    const mid = run(candles.slice(0, 8), upSeries(k.slice(0, 8), { fast: fast.slice(0, 8) }));
    expect(mid.atr).toMatchObject({ tp: 132, sl: 104, fromBar: 4 });
    expect(mid.last).toMatchObject({ waitingLongTP: true, uptrend: false });
    // bar 8 breaks the stop
    const r = run(candles, upSeries(k, { fast }));
    expect(r.alerts.map((a) => [a.bar, a.type])).toEqual([
      [5, 'longSignal'],
      [8, 'atrStopLoss'],
    ]);
    expect(r.last?.waitingLongTP).toBe(false);
    expect(r.signals[0]).toMatchObject({ outcome: 'sl', closedBar: 8 });
  });

  it('trend flip after a new deal: the take profit still fires', () => {
    const candles = bars([...NEW_DEAL, [111, 108], [131, 112]]);
    const fast = [...new Array(7).fill(110), 95, 95];
    const r = run(candles, upSeries([...NEW_DEAL_K, 40, 50], { fast }));
    expect(r.alerts.map((a) => [a.bar, a.type])).toEqual([
      [5, 'longSignal'],
      [8, 'takeProfitSignal'],
    ]);
    expect(r.markers.filter((m) => m.kind === 'takeProfit').map((m) => m.bar)).toEqual([8]);
  });

  it('new V2 pullback breaking the V1 low: levels stay, the stop loss still fires', () => {
    const candles = bars([
      ...NEW_DEAL,
      [111, 108], // 7: K 15, touches the cloud above V1 (106) → V2 search
      [110, 105], // 8: K 12, low 105 ≤ V1 low 106 → V2 cancelled
      [109, 103], // 9: low 103 < 106 − 2 → stop loss of the confirmed signal
    ]);
    const k = [...NEW_DEAL_K, 15, 12, 30];
    const mid = run(candles.slice(0, 9), upSeries(k.slice(0, 9)));
    expect(mid.atr).toMatchObject({ tp: 132, sl: 104, fromBar: 4 });
    expect(mid.markers.some((m) => m.kind === 'longPreview')).toBe(false);
    const r = run(candles, upSeries(k));
    expect(r.alerts.map((a) => [a.bar, a.type])).toEqual([
      [5, 'longSignal'],
      [9, 'atrStopLoss'],
    ]);
  });

  it('without a tracked signal the cycle resets exactly as before', () => {
    const candles = bars([...SETUP.slice(0, 4), [110, 104], [112, 108]]);
    const r = run(candles, upSeries([10, 50, 85, 15, 12, 30]));
    expect(r.signals).toHaveLength(0);
    expect(r.atr).toBeNull();
    expect(r.last).toMatchObject({ waitingLongTP: false, liveSignal: false });
  });

  it('real data (BTC/USDT 1h): signal history and LONG colours are identical to v3.2', () => {
    const candles = loadFixture('btc-usdt-1h.json');
    const snap = JSON.parse(readFileSync(fileURLToPath(new URL('./__fixtures__/btc-usdt-1h.signals-v3.2.json', import.meta.url)), 'utf8')) as {
      signals: unknown[];
      longMarkers: [number, string][];
    };
    const r = runSlingshot({ candles, chartTfSec: 3600, msTfSec: 3600, params: DEFAULT_SLINGSHOT_PARAMS, nowMs: Date.parse('2026-10-12T00:00:00Z') });
    const sig = r.signals.map((x) => ({ bar: x.bar, confirmBar: x.confirmBar, entryLow: x.entryLow, sl: x.sl, tp: x.tp, outcome: x.outcome, outcomeReason: x.outcomeReason ?? null, closedBar: x.closedBar ?? null }));
    expect(sig).toEqual(snap.signals);
    expect(r.markers.filter((m) => m.kind === 'long').map((m) => [m.bar, m.color])).toEqual(snap.longMarkers);
  });
});

describe('Market structure', () => {
  const msParams = { showMS: true, msSwing: 1, msLineLength: 3, msRightExtend: 2 };
  const flat = (n: number): SlingshotSeries => ({
    emaFast: new Array(n).fill(NaN),
    emaSlow: new Array(n).fill(NaN),
    kLine: new Array(n).fill(NaN),
    atr: new Array(n).fill(NaN),
  });

  it('initialises from the first swing pair and detects a bullish break on close', () => {
    const candles = bars([
      [10, 8, 9],
      [12, 9, 11],
      [11, 7, 8],
      [11.5, 8, 10],
      [12.5, 9, 12.4],
      [13, 12, 12.8],
    ]);
    const r = run(candles, flat(candles.length), msParams);
    expect(r.alerts.map((a) => [a.bar, a.type])).toEqual([[4, 'msBullish']]);
    expect(r.ms).toEqual({ upper: { price: 13, fromBar: 5 }, lower: { price: 7, fromBar: 2 }, rightEdgeBar: 8 });
  });

  it('a wick through the boundary is not a break when msBreakOnClose is on', () => {
    const candles = bars([
      [10, 8, 9],
      [12, 9, 11],
      [11, 7, 8],
      [11.5, 8, 10],
      [12.5, 9, 11.9],
    ]);
    const r = run(candles, flat(candles.length), msParams);
    expect(r.alerts).toHaveLength(0);
    expect(r.ms!.upper).toEqual({ price: 12.5, fromBar: 4 }); // the boundary just moves out
    const r2 = run(candles, flat(candles.length), { ...msParams, msBreakOnClose: false });
    expect(r2.alerts.map((a) => a.type)).toEqual(['msBullish']);
  });

  it('detects a bearish break', () => {
    const candles = bars([
      [10, 8, 9],
      [12, 9, 11],
      [11, 7, 8],
      [11.5, 8, 10],
      [9, 6, 6.5],
    ]);
    const r = run(candles, flat(candles.length), msParams);
    expect(r.alerts.map((a) => [a.bar, a.type])).toEqual([[4, 'msBearish']]);
    expect(r.ms!.lower).toEqual({ price: 6, fromBar: 4 });
  });

  it('HTF without data disables the structure and warns', () => {
    const candles = bars([
      [10, 8],
      [12, 9],
      [11, 7],
    ]);
    const r = runSlingshot({ candles, series: flat(3), chartTfSec: 3600, msTfSec: 4 * 3600, params: params(msParams), nowMs: 100 * H, htfCandles: null });
    expect(r.warnings).toContain('HTF_UNAVAILABLE');
    expect(r.ms).toBeNull();
  });
});

describe('HTF mapping (request.security, lookahead_off)', () => {
  const htf: Candle[] = [0, 4, 8].map((h) => ({ t: h * H, o: 1, h: 1, l: 1, c: 1, v: 1 }));
  it('historical chart bars see the last HTF bar closed by their own close', () => {
    const map = makeHtfMapper(htf, 4 * 3600, 3600);
    expect([0, 1, 2, 3, 4, 7, 8, 11].map((h) => map(h * H, false))).toEqual([-1, -1, -1, 0, 0, 1, 1, 2]);
  });
  it('a forming chart bar sees the developing HTF bar', () => {
    const map = makeHtfMapper(htf, 4 * 3600, 3600);
    expect(map(5 * H, true)).toBe(1);
  });
});

describe('htfCandleCount', () => {
  it('covers the chart history plus pivot warm-up, within API limits', () => {
    expect(htfCandleCount(5000, 3600, 4 * 3600, 5)).toBe(1250 + 20);
    expect(htfCandleCount(1500, 3600, 86400, 5)).toBe(100);
    expect(htfCandleCount(5000, 60, 60 * 60 * 24 * 7, 100)).toBe(211);
    expect(htfCandleCount(5000, 86400, 3600, 5)).toBe(5000);
  });
});

describe('LabelRegistry', () => {
  it('garbage-collects the oldest alive labels beyond 500', () => {
    const reg = new LabelRegistry();
    const ids = Array.from({ length: 502 }, (_, i) => reg.create(i, 'long', 'tp'));
    reg.delete(ids[5]!);
    reg.create(600, 'long', 'tp');
    const alive = reg.aliveOf(['long']);
    expect(alive).toHaveLength(500);
    expect(alive[0]!.bar).toBe(2); // 0 and 1 collected; 5 deleted manually so no further collection
  });
});

describe('real data (BTC/USDT 1h, KuCoin)', () => {
  const candles = loadFixture('btc-usdt-1h.json');
  const htf = loadFixture('btc-usdt-4h.json');
  const p = { ...DEFAULT_SLINGSHOT_PARAMS };

  it('runs on 2000 bars and produces internally consistent signals', () => {
    const r = runSlingshot({ candles, chartTfSec: 3600, msTfSec: 3600, params: p, nowMs: Date.parse('2026-10-12T00:00:00Z') });
    expect(r.warnings).toEqual([]);
    expect(r.signals.length).toBeGreaterThan(0);
    const markerByBar = new Map(r.markers.filter((m) => m.kind === 'long').map((m) => [m.bar, m]));
    for (const s of r.signals) {
      expect(s.sl).toBeLessThan(s.entryLow);
      expect(s.tp).toBeGreaterThan(s.breakout);
      expect(s.confirmBar).toBeGreaterThan(s.bar);
      const m = markerByBar.get(s.bar);
      expect(m).toBeDefined();
      expect(m!.color).toBe(s.outcome === 'sl' || s.outcome === 'invalidated' ? 'sl' : 'tp');
    }
    // at most one signal can still be tracked as the "current" one after a newer confirmation
    const activeAfterLast = r.signals.slice(0, -1).filter((s) => s.outcome === 'active');
    expect(activeAfterLast).toHaveLength(0);
    // EMA series equal the standalone computation
    const series = computeSlingshotSeries(candles, p);
    expect(r.emaFast).toEqual(series.emaFast);
  });

  it('market structure on a higher timeframe uses HTF swings', () => {
    const r = runSlingshot({ candles, htfCandles: htf, chartTfSec: 3600, msTfSec: 4 * 3600, params: p, nowMs: Date.parse('2026-10-12T00:00:00Z') });
    expect(r.warnings).toEqual([]);
    expect(r.ms?.upper?.price).toBeGreaterThan(r.ms?.lower?.price ?? Infinity);
    const local = runSlingshot({ candles, chartTfSec: 3600, msTfSec: 3600, params: p, nowMs: Date.parse('2026-10-12T00:00:00Z') });
    const count = (x: typeof r) => x.alerts.filter((a) => a.type === 'msBullish' || a.type === 'msBearish').length;
    expect(count(r)).toBeLessThan(count(local)); // fewer, more significant structures on 4h
  });

  it('is fast enough to run in the browser', () => {
    const t0 = performance.now();
    for (let k = 0; k < 5; k++) runSlingshot({ candles, chartTfSec: 3600, msTfSec: 3600, params: p, nowMs: 0 });
    expect((performance.now() - t0) / 5).toBeLessThan(150);
  });
});
