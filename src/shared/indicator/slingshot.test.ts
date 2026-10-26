import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SLINGSHOT_PARAMS, ONE_SIDE_MESSAGE, slingshotParamsSchema, type SlingshotParams } from './params.ts';
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
    expect(s.side).toBe('long');
    expect(s.entry).toBe(106);
    expect(s.breakout).toBe(130); // highest high of the previous `lookback` bars
    expect(s.tp).toBe(132);
    expect(s.sl).toBe(104);
    expect(s.outcome).toBe('active');
    expect(r.alerts.map((a) => [a.bar, a.type])).toEqual([[5, 'longSignal']]);
    expect(r.markers).toEqual([expect.objectContaining({ kind: 'long', bar: 4, color: 'signal' })]);
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
    expect(r.markers.find((m) => m.kind === 'long')!.color).toBe('signal');
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
    expect(r.markers.find((m) => m.kind === 'long')!.color).toBe('failed');
    expect(r.markers.some((m) => m.kind === 'takeProfit')).toBe(false);
    expect(r.atr).toBeNull();
  });

  it('a trend flip invalidates the active signal (red)', () => {
    const candles = bars([...SETUP, [111, 108]]);
    const fast = [...new Array(6).fill(110), 95];
    const r = run(candles, upSeries([...SETUP_K, 40], { fast }));
    expect(r.signals[0]).toMatchObject({ outcome: 'invalidated', outcomeReason: 'trendFlip', closedBar: 6 });
    expect(r.markers.find((m) => m.kind === 'long')!.color).toBe('invalid');
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
      [4, 'invalid'],
      [7, 'signal'],
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

describe('FD-SS34LIVE — live invalidation', () => {
  // SETUP confirms a LONG at bar 5 (label on bar 4, SL 104, breakout 130). Bar 6 is a new deal (V1 = bar 4, low 106),
  // bar 7 starts a new V2 search (the new LONG forming), bar 8 breaks the V1 low (the search is cancelled), bar 9 starts
  // it again and bar 10 confirms the new LONG.
  const candles = bars([...SETUP, [125, 115], [111, 108], [109, 105], [110, 107], [112, 109]]);
  const k = [...SETUP_K, 85, 15, 12, 15, 40];
  const upTo = (n: number) => run(candles.slice(0, n), upSeries(k.slice(0, n)));
  const looks = (r: ReturnType<typeof run>) => r.markers.map((m) => [m.bar, m.kind, m.color]);

  it('the old LONG shows as invalidated while a new one forms, valid again when it goes away, for good once it confirms', () => {
    expect(looks(upTo(7))).toEqual([[4, 'long', 'signal']]);
    const forming = upTo(8);
    expect(looks(forming)).toEqual([
      [4, 'long', 'invalid'],
      [7, 'longPreview', 'signal'],
    ]);
    // only its look: the signal itself is still active (its TP/SL tracked, as in 3.3)
    expect(forming.signals.map((s) => s.outcome)).toEqual(['active']);
    expect(forming.last).toMatchObject({ liveSignal: true, waitingLongTP: true });
    const cancelled = upTo(9);
    expect(looks(cancelled)).toEqual([[4, 'long', 'signal']]);
    expect(cancelled.last?.liveSignal).toBe(false);
    expect(looks(upTo(10))).toEqual([
      [4, 'long', 'invalid'],
      [9, 'longPreview', 'signal'],
    ]);
    const confirmed = upTo(11);
    expect(looks(confirmed)).toEqual([
      [4, 'long', 'invalid'],
      [9, 'long', 'signal'],
    ]);
    expect(confirmed.signals.map((s) => [s.bar, s.outcome, s.outcomeReason ?? null])).toEqual([
      [4, 'invalidated', 'superseded'],
      [9, 'active', null],
    ]);
  });

  it('a take profit while the new one forms is a success: valid again', () => {
    const c = bars([...SETUP, [125, 115], [111, 108], [131, 108]]);
    const r = run(c, upSeries([...SETUP_K, 85, 15, 12]));
    expect(r.signals[0]).toMatchObject({ outcome: 'tp', outcomeReason: 'takeProfitSignal', closedBar: 8 });
    expect(looks(r)).toEqual([
      [4, 'long', 'signal'],
      [7, 'longPreview', 'signal'],
      [8, 'takeProfit', 'signal'],
    ]);
  });

  it('a stop loss while the new one forms is a failure', () => {
    const c = bars([...SETUP, [125, 115], [111, 108], [109, 103]]);
    const r = run(c, upSeries([...SETUP_K, 85, 15, 12]));
    expect(r.signals[0]).toMatchObject({ outcome: 'sl', closedBar: 8 });
    // FD-SSSL: and the bar where it failed is marked
    expect(looks(r)).toEqual([
      [4, 'long', 'failed'],
      [8, 'stopLoss', 'signal'],
    ]);
  });

  it('FD-SSLIVEBOX: the TP/SL shown are the forming signal\'s while one forms, the tracked one\'s otherwise', () => {
    // tracked: SL 106 - 2 = 104, TP 130 + 2 = 132; forming at bar 7: SL 108 - 2 = 106, TP = highest high of the 20 bars
    // before bar 7 (130) + 2
    expect(upTo(7).atr).toMatchObject({ tp: 132, sl: 104, fromBar: 4 });
    const forming = upTo(8);
    expect(forming.atr).toMatchObject({ tp: 132, sl: 106, fromBar: 7 });
    // the old one is still the one tracked: its levels and alerts go on
    expect(forming.last).toMatchObject({ waitingLongTP: true, liveSignal: true });
    expect(upTo(9).atr).toMatchObject({ tp: 132, sl: 104, fromBar: 4 });
    expect(upTo(10).atr).toMatchObject({ sl: 105, fromBar: 9 });
    // confirmed: the new one is the tracked one
    expect(upTo(11).atr).toMatchObject({ sl: 105, fromBar: 9 });
    expect(upTo(11).last).toMatchObject({ waitingLongTP: true, liveSignal: false });
  });

  it('FD-SSLIVEBOX: a tracked one whose take profit hid its levels no longer hides a forming one', () => {
    // bar 6 goes above the breakout (130): TAKE PROFIT, levels hidden (hideAtrOnTP); bars 7-8 a new deal and a V2 forming
    const c = bars([...SETUP, [131, 120], [126, 116], [111, 108]]);
    const kk = [...SETUP_K, 60, 85, 15];
    expect(run(c.slice(0, 8), upSeries(kk.slice(0, 8))).atr).toBeNull();
    const r = run(c, upSeries(kk));
    expect(r.last).toMatchObject({ waitingLongTP: true, tpHit: true, liveSignal: true });
    expect(r.atr).toMatchObject({ sl: 106, fromBar: 8 });
  });

  it('the SHORT the same way, and a forming SHORT leaves a LONG alone', () => {
    // the LONG scenario upside down (prices around 210 - x, K around 100 - K)
    const flip = (cs: Candle[]) => cs.map((x) => ({ ...x, o: 210 - x.o, h: 210 - x.l, l: 210 - x.h, c: 210 - x.c }));
    const down = (n: number): SlingshotSeries => ({ emaFast: new Array(n).fill(100), emaSlow: new Array(n).fill(110), kLine: k.slice(0, n).map((v) => 100 - v), atr: new Array(n).fill(2) });
    const short = (n: number) => run(flip(candles.slice(0, n)), down(n), { showLong: false, showShort: true });
    expect(looks(short(8))).toEqual([
      [4, 'short', 'invalid'],
      [7, 'shortPreview', 'signal'],
    ]);
    expect(looks(short(9))).toEqual([[4, 'short', 'signal']]);
    expect(looks(short(11))).toEqual([
      [4, 'short', 'invalid'],
      [9, 'short', 'signal'],
    ]);
    // with both sides on, the LONG side of the LONG scenario is unchanged (no SHORT can form in an uptrend anyway)
    expect(looks(run(candles.slice(0, 8), upSeries(k.slice(0, 8)), { showShort: true }))).toEqual(looks(upTo(8)));
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
    const sig = r.signals.map((x) => ({ bar: x.bar, confirmBar: x.confirmBar, entryLow: x.entry, sl: x.sl, tp: x.tp, outcome: x.outcome, outcomeReason: x.outcomeReason ?? null, closedBar: x.closedBar ?? null }));
    expect(sig).toEqual(snap.signals);
    // FD-SS34LIVE: the same colours, read as 3.2's green (valid) and red (failed or invalidated)
    expect(r.markers.filter((m) => m.kind === 'long').map((m) => [m.bar, m.color === 'signal' ? 'tp' : 'sl'])).toEqual(snap.longMarkers);
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
    const ids = Array.from({ length: 502 }, (_, i) => reg.create(i, 'long', 'signal'));
    reg.delete(ids[5]!);
    reg.create(600, 'long', 'signal');
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
      expect(s.sl).toBeLessThan(s.entry);
      expect(s.tp).toBeGreaterThan(s.breakout);
      expect(s.confirmBar).toBeGreaterThan(s.bar);
      const m = markerByBar.get(s.bar);
      expect(m).toBeDefined();
      expect(m!.color).toBe(s.outcome === 'sl' ? 'failed' : s.outcome === 'invalidated' || (s.outcome === 'active' && r.last?.liveSignal) ? 'invalid' : 'signal');
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

describe('v3.4 — SHORT signals (FD-SLINGSHOT34)', () => {
  /** Constant downtrend cloud between 100 (fast) and 110 (slow), ATR 2, with a K path. */
  const downSeries = (k: number[]): SlingshotSeries => ({ emaFast: new Array(k.length).fill(100), emaSlow: new Array(k.length).fill(110), kLine: k, atr: new Array(k.length).fill(2) });
  // SETUP mirrored around 210: V1 at bar 0 (high 105), deal at bar 2, V2 search bars 3-4 (best high 104), exit at bar 5.
  const SHORT_SETUP: [number, number, number?][] = [
    [105, 98], // 0: K 90, touches the cloud → V1 candidate (high 105)
    [95, 85], // 1: K 50
    [90, 80], // 2: K 15 → deal locked, V1 = bar 0
    [103, 99], // 3: K 85, touches the cloud, high 103 < 105 → V2 search starts
    [104, 100], // 4: K 88, higher high 104 → best V2
  ];
  const SHORT_K = [90, 50, 15, 85, 88, 70];
  const shortOnly = { showLong: false, showShort: true };

  it('confirms a SHORT on exit from overbought, mirrored TP/SL', () => {
    const r = run(bars([...SHORT_SETUP, [102, 98]]), downSeries(SHORT_K), shortOnly);
    expect(r.signals).toHaveLength(1);
    expect(r.signals[0]).toMatchObject({ side: 'short', bar: 4, confirmBar: 5, entry: 104, breakout: 80, tp: 78, sl: 106, outcome: 'active' });
    expect(r.alerts.map((a) => [a.bar, a.type])).toEqual([[5, 'shortSignal']]);
    expect(r.markers.map((m) => [m.bar, m.kind, m.color])).toEqual([[4, 'short', 'signal']]);
    expect(r.atrShort).toMatchObject({ side: 'short', tp: 78, sl: 106, fromBar: 4 });
    expect(r.atr).toBeNull();
    expect(r.last).toMatchObject({ waitingShortTP: true, waitingLongTP: false, liveShortSignal: false });
  });

  it('only the LONG rules, reversed: the confirming close can be anywhere (above the cloud too)', () => {
    // close 102: inside the cloud (100-110), not below it; a touch of the cloud is all the rules ask
    const r = run(bars([...SHORT_SETUP, [103, 99, 102]]), downSeries(SHORT_K), shortOnly);
    expect(r.signals.map((x) => [x.side, x.bar, x.confirmBar])).toEqual([['short', 4, 5]]);
  });

  it('a rally up to the V1 high cancels the V2 search (no signal)', () => {
    const r = run(bars([...SHORT_SETUP.slice(0, 4), [105, 100], [102, 98]]), downSeries(SHORT_K), shortOnly);
    expect(r.signals).toHaveLength(0);
    expect(r.markers).toHaveLength(0);
  });

  it('the forming SHORT shows its levels; the preview sits on the best V2 high', () => {
    const r = run(bars(SHORT_SETUP), downSeries(SHORT_K.slice(0, 5)), shortOnly);
    expect(r.markers.map((m) => [m.bar, m.kind])).toEqual([[4, 'shortPreview']]);
    expect(r.last?.liveShortSignal).toBe(true);
    expect(r.atrShort).toMatchObject({ side: 'short', sl: 106, tp: 78 });
  });

  it('take profit, then stop loss of the tracked SHORT', () => {
    const tp = run(bars([...SHORT_SETUP, [102, 98, 99], [90, 79]]), downSeries([...SHORT_K, 30]), shortOnly);
    expect(tp.alerts.map((a) => [a.bar, a.type])).toEqual([
      [5, 'shortSignal'],
      [6, 'shortTakeProfitSignal'],
    ]);
    expect(tp.markers.filter((m) => m.kind === 'shortTakeProfit').map((m) => [m.bar, m.color])).toEqual([[6, 'signal']]);
    expect(tp.signals[0]).toMatchObject({ outcome: 'tp', outcomeReason: 'takeProfitSignal', closedBar: 6 });
    const sl = run(bars([...SHORT_SETUP, [102, 98, 99], [107, 101]]), downSeries([...SHORT_K, 75]), shortOnly);
    expect(sl.alerts.map((a) => [a.bar, a.type])).toEqual([
      [5, 'shortSignal'],
      [6, 'shortAtrStopLoss'],
    ]);
    expect(sl.signals[0]).toMatchObject({ outcome: 'sl', closedBar: 6 });
    expect(sl.markers.find((m) => m.kind === 'short')?.color).toBe('failed');
    expect(sl.last?.waitingShortTP).toBe(false);
  });

  it('independent sides: a SHORT confirmed after a LONG leaves the LONG tracked until its own stop loss', () => {
    // SETUP confirms a LONG at bar 5 (entry 106, ATR 20 → SL 86); the trend turns down at bar 6 (cloud 95-100) and a
    // SHORT confirms at bar 9 (V1 bar 6, deal 7, V2 bar 8). Bar 10 goes below the LONG's stop and the SHORT's breakout.
    const candles = bars([...SETUP, [99, 96], [94, 90], [98, 94], [96, 92, 93], [95, 85]]);
    const fast = [...new Array(6).fill(110), 95, 95, 95, 95, 95];
    const k = [...SETUP_K, 85, 15, 85, 60, 30];
    const upTo = (n: number): SlingshotSeries => ({ emaFast: fast.slice(0, n), emaSlow: new Array(n).fill(100), kLine: k.slice(0, n), atr: new Array(n).fill(20) });
    const both = { showLong: true, showShort: true };
    // bar 8: the LONG tracked and the SHORT forming, each with its own levels
    const forming = run(candles.slice(0, 9), upTo(9), both);
    expect(forming.last).toMatchObject({ waitingLongTP: true, liveShortSignal: true });
    expect(forming.atr).toMatchObject({ side: 'long', sl: 86 });
    expect(forming.atrShort).toMatchObject({ side: 'short', sl: 118, tp: 70 });
    // bar 9: both tracked
    const tracked = run(candles.slice(0, 10), upTo(10), both);
    expect(tracked.last).toMatchObject({ waitingLongTP: true, waitingShortTP: true });
    expect(tracked.atr).toMatchObject({ side: 'long', sl: 86 });
    expect(tracked.atrShort).toMatchObject({ side: 'short', sl: 118, tp: 70, fromBar: 8 });
    const r = run(candles, upTo(11), both);
    expect(r.signals.map((x) => [x.side, x.confirmBar, x.outcome])).toEqual([
      ['long', 5, 'invalidated'],
      ['short', 9, 'tp'],
    ]);
    expect(r.alerts.map((a) => [a.bar, a.type])).toEqual([
      [5, 'longSignal'],
      [9, 'shortSignal'],
      [10, 'atrStopLoss'],
      [10, 'shortTakeProfitSignal'],
    ]);
    expect(r.last).toMatchObject({ waitingLongTP: false, waitingShortTP: true });
    // the LONG side is exactly what Long alone gives (3.3)
    const longOnly = run(candles, upTo(11));
    expect(longOnly.alerts.map((a) => [a.bar, a.type])).toEqual([
      [5, 'longSignal'],
      [10, 'atrStopLoss'],
    ]);
  });

  it('Long Signals off: no LONG at all', () => {
    const r = run(bars(SETUP), upSeries(SETUP_K), shortOnly);
    expect(r.signals).toHaveLength(0);
    expect(r.markers).toHaveLength(0);
    expect(r.atr).toBeNull();
    expect(r.atrShort).toBeNull();
  });

  const real = (name: string, tf: number) => ({ candles: loadFixture(name), tf });
  const negate = (cs: Candle[]): Candle[] => cs.map((k) => ({ t: k.t, o: -k.o, h: -k.l, l: -k.h, c: -k.c, v: k.v }));
  const KIND: Record<string, string> = { long: 'short', longPreview: 'shortPreview', takeProfit: 'shortTakeProfit', stopLoss: 'shortStopLoss' };
  const ALERT: Record<string, string> = { longSignal: 'shortSignal', takeProfitSignal: 'shortTakeProfitSignal', atrTakeProfit: 'shortAtrTakeProfit', atrStopLoss: 'shortAtrStopLoss' };

  it.each([
    ['btc-usdt-1h.json', 3600],
    ['btc-usdt-4h.json', 14400],
  ])('real data (%s): the SHORT is the exact mirror of the LONG (the LONG on the upside-down chart)', (name, tf) => {
    const { candles } = real(name, tf);
    const nowMs = Date.parse('2026-10-12T00:00:00Z');
    const base = { ...DEFAULT_SLINGSHOT_PARAMS, showMS: false };
    const S = runSlingshot({ candles, chartTfSec: tf, msTfSec: tf, nowMs, params: { ...base, showLong: false, showShort: true } });
    const L = runSlingshot({ candles: negate(candles), chartTfSec: tf, msTfSec: tf, nowMs, params: base });
    expect(L.signals.length).toBeGreaterThan(0);
    expect(S.signals.map((x) => [x.side, x.bar, x.confirmBar, x.entry, x.sl, x.tp, x.breakout, x.outcome, x.outcomeReason, x.closedBar])).toEqual(
      L.signals.map((x) => ['short', x.bar, x.confirmBar, -x.entry, -x.sl, -x.tp, -x.breakout, x.outcome, x.outcomeReason, x.closedBar]),
    );
    expect(S.markers.map((m) => [m.bar, m.kind, m.color])).toEqual(L.markers.map((m) => [m.bar, KIND[m.kind], m.color]));
    const own = (x: typeof S) => x.alerts.filter((a) => !a.type.startsWith('ms'));
    expect(own(S).map((a) => [a.bar, a.type])).toEqual(own(L).map((a) => [a.bar, ALERT[a.type]]));
    expect(S.atrShort).toEqual(L.atr && { ...L.atr, side: 'short', tp: -L.atr.tp, sl: -L.atr.sl });
    expect(S.atr).toBeNull();
    const l = L.last as NonNullable<typeof L.last>;
    expect(S.last && [S.last.waitingShortTP, S.last.shortTpHit, S.last.liveShortSignal]).toEqual([l.waitingLongTP, l.tpHit, l.liveSignal]);
  });

  it.each([
    ['btc-usdt-1h.json', 3600],
    ['btc-usdt-4h.json', 14400],
  ])('real data (%s): with both sides on, each side is exactly what it gives alone', (name, tf) => {
    const candles = loadFixture(name);
    const go = (over: Partial<SlingshotParams>) => runSlingshot({ candles, chartTfSec: tf, msTfSec: tf, nowMs: Date.parse('2026-10-12T00:00:00Z'), params: { ...DEFAULT_SLINGSHOT_PARAMS, ...over } });
    const both = go({ showShort: true });
    const long = go({});
    const short = go({ showLong: false, showShort: true });
    expect(short.signals.length).toBeGreaterThan(0);
    const side = (x: typeof both, s: 'long' | 'short') => ({
      signals: x.signals.filter((g) => g.side === s),
      markers: x.markers.filter((m) => (s === 'short') === m.kind.startsWith('short')).map((m) => [m.bar, m.kind, m.color]),
      alerts: x.alerts.filter((a) => !a.type.startsWith('ms') && (s === 'short') === a.type.startsWith('short')).map((a) => [a.bar, a.type]),
      atr: s === 'short' ? x.atrShort : x.atr,
      last: s === 'short' ? x.last && [x.last.waitingShortTP, x.last.shortTpHit, x.last.liveShortSignal] : x.last && [x.last.waitingLongTP, x.last.tpHit, x.last.liveSignal],
    });
    expect(side(both, 'long')).toEqual(side(long, 'long'));
    expect(side(both, 'short')).toEqual(side(short, 'short'));
  });

  it.each([
    ['btc-usdt-1h.json', 3600],
    ['btc-usdt-4h.json', 14400],
  ])('real data (%s): Long only (the default) is identical to v3.3', (name, tf) => {
    const snap = (JSON.parse(readFileSync(fileURLToPath(new URL('./__fixtures__/btc-usdt.v3.3.json', import.meta.url)), 'utf8')) as Record<string, Record<string, unknown>>)[name] as Record<string, unknown>;
    const r = runSlingshot({ candles: loadFixture(name), chartTfSec: tf, msTfSec: tf, params: DEFAULT_SLINGSHOT_PARAMS, nowMs: Date.parse('2026-10-12T00:00:00Z') });
    expect(r.signals.map((s) => ({ bar: s.bar, confirmBar: s.confirmBar, entry: s.entry, sl: s.sl, tp: s.tp, breakout: s.breakout, outcome: s.outcome, outcomeReason: s.outcomeReason ?? null, closedBar: s.closedBar ?? null }))).toEqual(snap.signals);
    expect(r.signals.every((s) => s.side === 'long')).toBe(true);
    // FD-SS34LIVE: 3.3's green is 'signal'; its red is 'failed' (a stop loss) or 'invalid' (replaced, trend flip), an X.
    // FD-SSSL: the STOP LOSS labels are new, one on the bar where each failed signal ended.
    const own = r.markers.filter((m) => m.kind !== 'stopLoss');
    expect(own.map((m) => [m.bar, m.kind, m.color === 'signal' ? 'tp' : 'sl'])).toEqual(snap.markers);
    expect(r.markers.filter((m) => m.kind === 'stopLoss').map((m) => m.bar)).toEqual(r.signals.filter((g) => g.outcome === 'sl').map((g) => g.closedBar).sort((a, b) => (a ?? 0) - (b ?? 0)));
    const outcomeAt = new Map(r.signals.map((s) => [s.bar, s.outcome]));
    for (const m of r.markers.filter((x) => x.kind === 'long')) {
      const o = outcomeAt.get(m.bar);
      expect(m.color).toBe(o === 'sl' ? 'failed' : o === 'invalidated' ? 'invalid' : 'signal');
    }
    expect(r.alerts.map((a) => [a.bar, a.type])).toEqual(snap.alerts);
    const { side, ...atr } = r.atr ?? { side: 'long' };
    expect(side).toBe('long');
    expect(r.atr ? atr : null).toEqual(snap.atr);
    expect(r.atrShort).toBeNull();
    expect(r.ms).toEqual(snap.ms);
    const { waitingShortTP, shortTpHit, liveShortSignal, ...last } = r.last as NonNullable<typeof r.last>;
    expect([waitingShortTP, shortTpHit, liveShortSignal]).toEqual([false, false, false]);
    expect(last).toEqual(snap.last);
  });

  it('settings: Long on and Short off by default; never both sides off; the old cloud rule key is dropped', () => {
    expect(DEFAULT_SLINGSHOT_PARAMS).toMatchObject({
      showLong: true,
      showShort: false,
      longColor: '#00FFAA',
      longTpColor: '#00FFAA',
      shortColor: '#2196F3',
      shortTpColor: '#00FFAA',
      // FD-STYLEUNIFY: each state of each side, the look it had
      longFormingColor: '#00FFAA',
      shortFormingColor: '#2196F3',
      longFailedColor: '#FF5252',
      shortFailedColor: '#FF5252',
      longInvalidColor: '#FF5252',
      shortInvalidColor: '#FF5252',
      longSize: 'Small',
      shortInvalidSize: 'Small',
      cloudUpColor: '#00FFAA',
      cloudDownColor: '#FF5252',
    });
    // FD-OPACITY: a colour may carry its opacity
    expect(slingshotParamsSchema.safeParse({ longColor: '#00FFAA80', cloudUpColor: '#00ffaa1a' }).success).toBe(true);
    expect(slingshotParamsSchema.safeParse({ longColor: '#00FFAA8' }).success).toBe(false);
    expect(slingshotParamsSchema.safeParse({ longSize: 'Giant' }).success).toBe(false);
    expect(slingshotParamsSchema.parse({ showShort: true, shortCloseBelowCloud: true })).not.toHaveProperty('shortCloseBelowCloud');
    const both = slingshotParamsSchema.safeParse({ showLong: false, showShort: false });
    expect(both.success).toBe(false);
    expect(both.error?.issues.map((i) => i.message)).toEqual([ONE_SIDE_MESSAGE]);
    expect(slingshotParamsSchema.safeParse({ showLong: false, showShort: true }).success).toBe(true);
  });

  it('FD-STYLEUNIFY: settings saved before keep their look; the lines and the sizes have TradingView\'s limits', () => {
    const old = slingshotParamsSchema.parse({
      longColor: '#111111',
      shortColor: '#222222',
      failedColor: '#333333',
      invalidColor: '#44444480',
      signalSize: 'Large',
      longTPColor: '#555555',
      longSLColor: '#666666',
      msLineWidth: 5,
      msLineStyle: 'Dashed',
      msTextSize: 'Tiny',
    });
    expect(old).toMatchObject({
      longFormingColor: '#111111',
      shortFormingColor: '#222222',
      longFailedColor: '#333333',
      shortFailedColor: '#333333',
      longInvalidColor: '#44444480',
      shortInvalidColor: '#44444480',
      longFormingSize: 'Large',
      longSize: 'Large',
      shortTpSize: 'Large',
      shortSlSize: 'Large',
      shortTPColor: '#555555',
      shortSLColor: '#666666',
      msBullLineWidth: 5,
      msBearLineWidth: 5,
      msBullLineStyle: 'Dashed',
      msBearTextSize: 'Tiny',
    });
    // The old keys are gone once read.
    expect(old).not.toHaveProperty('failedColor');
    expect(old).not.toHaveProperty('signalSize');
    // A key saved already wins over the old one it would be filled from.
    expect(slingshotParamsSchema.parse({ failedColor: '#333333', longFailedColor: '#ABCDEF' }).longFailedColor).toBe('#ABCDEF');
    // Defaults: 2 px dashed levels, 1 px solid EMAs, dotted 1 px market structure.
    expect(DEFAULT_SLINGSHOT_PARAMS).toMatchObject({ longTpLineWidth: 2, shortSlLineStyle: 'Dashed', longTpLabelSize: 'Small', slowEmaWidth: 1, fastEmaStyle: 'Solid', msBullLineWidth: 1, msBearLineStyle: 'Dotted', msBullTextSize: 'Small' });
    for (const bad of [{ longTpLineWidth: 0 }, { longTpLineWidth: 5 }, { slowEmaStyle: 'Wavy' }, { msBullLineWidth: 6 }, { shortTpLabelSize: 'Giant' }]) {
      expect(slingshotParamsSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});
