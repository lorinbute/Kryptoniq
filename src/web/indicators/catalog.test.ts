// FD-INDICATORS / TD-INDICATORS §2–§3, §6: the catalog matches the saved ids and the list, and every indicator runs on a
// chart's candles (the two that read other symbols say which ones they miss).
import { describe, expect, it } from 'vitest';
import { STUDY_IDS, type StudyId } from '../../shared/studies.ts';
import type { Candle } from '../../shared/indicator/slingshot.ts';
import { STUDY_MODULES } from './catalog.ts';
import { STUDY_CATEGORIES, STUDY_META } from './catalog-meta.ts';
import { chartContext, legendParams, NO_VOLUME, runStudy, sanitizeInputs, toBars, type ChartInfo } from './compute.ts';
import { DOWN_COLOR, UP_COLOR } from './volume.ts';

/** Hourly candles of a made-up market: waves, a trend, volume. */
function candles(n: number, volume = true): Candle[] {
  const out: Candle[] = [];
  let p = 100;
  const t0 = Date.UTC(2026, 0, 5);
  for (let i = 0; i < n; i++) {
    const o = p;
    p = Math.max(1, p * (1 + (Math.sin(i / 7) + Math.cos(i / 13) + 0.05) * 0.004));
    out.push({ t: t0 + i * 3_600_000, o, h: Math.max(o, p) * 1.003, l: Math.min(o, p) * 0.997, c: p, v: volume ? 1000 + (i % 50) * 10 : 0 });
  }
  return out;
}

const info: ChartInfo = { kind: 'crypto', exchange: 'kucoin', symbol: 'BTC/USDT', tf: '1h', precision: 2 };

describe('the indicator catalog', () => {
  it('has the same ids as the saved list and the list window', () => {
    expect(Object.keys(STUDY_MODULES).sort()).toEqual([...STUDY_IDS].sort());
    expect(STUDY_META.map((m) => m.id).sort()).toEqual([...STUDY_IDS].sort());
    const cats = new Set(STUDY_CATEGORIES.map((c) => c.id));
    for (const m of STUDY_META) {
      expect(cats.has(m.category), m.id).toBe(true);
      // The list says "pe grafic" / "panou separat" from the meta; the chart draws from the module.
      expect(STUDY_MODULES[m.id].overlay, m.id).toBe(m.overlay);
      expect(m.name.length).toBeGreaterThan(1);
      // FD-RODESC: the description in Romanian (no English left from the upstream registry).
      expect(m.description.length, m.id).toBeGreaterThan(10);
      expect(m.description, m.id).not.toMatch(/\b(the|and|of|with|using|measures|shows|price|average)\b/i);
    }
  });

  it('every input of every indicator has a type the settings form knows, and its default fits', () => {
    const known = new Set(['int', 'float', 'bool', 'string', 'text_area', 'source', 'color', 'timeframe', 'session', 'time', 'symbol']);
    for (const id of STUDY_IDS) {
      const mod = STUDY_MODULES[id];
      for (const cfg of mod.inputConfig) {
        expect(known.has(cfg.type), `${id}.${cfg.id}: ${cfg.type}`).toBe(true);
        // The defaults survive the check (an indicator never runs with a value other than its own default).
        expect(sanitizeInputs(mod, {})[cfg.id], `${id}.${cfg.id}`).toEqual(mod.defaultInputs[cfg.id] ?? sanitizeInputs(mod, {})[cfg.id]);
      }
    }
  });

  it('every indicator runs on 1500 candles; Performance and Correlation name the symbols they miss', () => {
    const bars = toBars(candles(1500));
    const ctx = chartContext(info);
    const failures: string[] = [];
    for (const id of STUDY_IDS) {
      const mod = STUDY_MODULES[id];
      const run = runStudy(mod, id, bars, sanitizeInputs(mod, {}), ctx);
      if (id === 'performance' || id === 'correlation-coefficient') {
        expect(run.missing?.length, id).toBeGreaterThan(0);
        continue;
      }
      if (run.error || !run.result) failures.push(`${id}: ${run.error}`);
    }
    expect(failures).toEqual([]);
  });

  it('a volume indicator on candles without volume (an index) says so instead of drawing zeros', () => {
    const bars = toBars(candles(300, false));
    const ctx = chartContext({ ...info, kind: 'index', exchange: 'index', symbol: 'SPX', tf: '1d' });
    for (const id of ['obv', 'volume', 'vwap', 'mfi'] as StudyId[]) expect(runStudy(STUDY_MODULES[id], id, bars, sanitizeInputs(STUDY_MODULES[id], {}), ctx).error).toBe(NO_VOLUME);
    // Price indicators still run.
    expect(runStudy(STUDY_MODULES.rsi, 'rsi', bars, sanitizeInputs(STUDY_MODULES.rsi, {}), ctx).result).not.toBeNull();
  });

  it('an indicator that throws leaves an error message, not an exception', () => {
    const mod = { ...STUDY_MODULES.sma, calculate: () => { throw new Error('Not enough data'); } }; // prettier-ignore
    expect(runStudy(mod, 'sma', toBars(candles(10)), {}, chartContext(info))).toMatchObject({ result: null, error: 'Not enough data' });
  });

  it('the legend shows the inputs TradingView shows on its status line', () => {
    expect(legendParams(STUDY_MODULES.rsi, sanitizeInputs(STUDY_MODULES.rsi, {}))).toBe('14 close');
    // In the port's input order.
    expect(legendParams(STUDY_MODULES.macd, sanitizeInputs(STUDY_MODULES.macd, {}))).toBe('close 12 26 9');
    expect(legendParams(STUDY_MODULES.bb, sanitizeInputs(STUDY_MODULES.bb, { length: 50 }))).toMatch(/^50 /);
  });

  it('Volume: green up bars, red down bars, the moving average when asked', () => {
    const cs: Candle[] = [
      { t: 0, o: 10, h: 11, l: 9, c: 11, v: 100 },
      { t: 3_600_000, o: 11, h: 12, l: 10, c: 10, v: 300 },
      { t: 7_200_000, o: 10, h: 10, l: 9, c: 10, v: 200 },
    ];
    const r = STUDY_MODULES.volume.calculate(toBars(cs), { maLength: 2 });
    expect(r.plots.plot0?.map((p) => [p.value, (p as { color?: string }).color])).toEqual([
      [100, UP_COLOR],
      [300, DOWN_COLOR],
      [200, UP_COLOR],
    ]);
    expect(r.plots.plot1?.map((p) => p.value)).toEqual([NaN, 200, 250]);
    // Against the previous close: the third bar closed level with the second, not below it.
    const prev = STUDY_MODULES.volume.calculate(toBars(cs), { colorBasedOnPrevClose: true });
    expect(prev.plots.plot0?.map((p) => (p as { color?: string }).color)).toEqual([UP_COLOR, DOWN_COLOR, UP_COLOR]);
  });
});
