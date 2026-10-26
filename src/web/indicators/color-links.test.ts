// FD-COLORUNIFY: every colour box in Stil changes what is drawn, and a colour input that colours a whole line is that
// line's box. Checked on every indicator, with its defaults and with each bool / list input changed in turn.
import { describe, expect, it } from 'vitest';
import type { IndicatorResult } from 'oakscriptjs';
import type { Candle } from '../../shared/indicator/slingshot.ts';
import type { Study, StudyId } from '../../shared/studies.ts';
import { STUDY_MODULES } from './catalog.ts';
import { colorKey, INPUT_COLORED, INPUT_LINES, lineInput, linkStyle, PLOT_PALETTES } from './color-links.ts';
import { chartContext, sanitizeInputs, toBars } from './compute.ts';
import { stylePlots } from './style.ts';
import { parseColor } from '../color.ts';

/** Hourly candles of a made-up market: waves, a trend, volume (as catalog.test.ts). */
function candles(n: number): Candle[] {
  const out: Candle[] = [];
  let p = 100;
  const t0 = Date.UTC(2026, 0, 5);
  for (let i = 0; i < n; i++) {
    const o = p;
    p = Math.max(1, p * (1 + (Math.sin(i / 7) + Math.cos(i / 13) + 0.05) * 0.004));
    out.push({ t: t0 + i * 3_600_000, o, h: Math.max(o, p) * 1.003, l: Math.min(o, p) * 0.997, c: p, v: 1000 + (i % 50) * 10 + (i % 7) * 30 });
  }
  return out;
}
const bars = toBars(candles(700));
const ctx = chartContext({ kind: 'crypto', exchange: 'kucoin', symbol: 'BTC/USDT', tf: '1h', precision: 2 });
const SENTINEL = '#123457';
const ids = Object.keys(STUDY_MODULES) as StudyId[];

function run(id: StudyId, inputs: Record<string, unknown>): IndicatorResult | null {
  try {
    return STUDY_MODULES[id].calculate(bars, inputs, ctx);
  } catch {
    // Two read other symbols (catalog.test.ts covers them): nothing to check here.
    return null;
  }
}

/** The inputs each run uses: the defaults, then each bool flipped and each list value, one change at a time. */
function variants(id: StudyId): Record<string, unknown>[] {
  const mod = STUDY_MODULES[id];
  const base = sanitizeInputs(mod, {});
  const out = [base];
  for (const cfg of mod.inputConfig) {
    if (cfg.type === 'bool') out.push({ ...base, [cfg.id]: !base[cfg.id] });
    else if (cfg.options?.length) for (const o of cfg.options) if (o !== base[cfg.id]) out.push({ ...base, [cfg.id]: o });
  }
  return out;
}

/** The colours a plot's drawn points have (a transparent one draws nothing: left out). */
function drawnColors(r: IndicatorResult, plotId: string): Set<string> {
  const out = new Set<string>();
  for (const p of (r.plots?.[plotId] ?? []) as { value: number; color?: string }[]) {
    if (p.color === undefined || !Number.isFinite(p.value) || parseColor(p.color).alpha === 0) continue;
    out.add(colorKey(p.color));
  }
  return out;
}

describe('FD-COLORUNIFY on every indicator', () => {
  it('every colour a Stil line is drawn in has its box (its own colour or one of its palette), or comes from an input', () => {
    const paletteSeen = new Map<string, Set<string>>();
    for (const id of ids) {
      const mod = STUDY_MODULES[id];
      for (const inputs of variants(id)) {
        const r = run(id, inputs);
        if (!r) continue;
        for (const def of stylePlots(mod)) {
          const drawn = drawnColors(r, def.id);
          const input = lineInput(id, def.id);
          if (input) {
            // The whole line in its input's colour.
            expect([...drawn].every((c) => c === colorKey(String(inputs[input]))), `${id} ${def.id}`).toBe(true);
            continue;
          }
          if (INPUT_COLORED[id]?.[def.id]) continue;
          const known = new Set([def.color, ...(def.palette ?? [])].filter(Boolean).map((c) => colorKey(c as string)));
          const foreign = [...drawn].filter((c) => !known.has(c));
          expect(foreign, `${id} ${def.id} (${JSON.stringify(inputs).slice(0, 80)})`).toEqual([]);
          const seen = paletteSeen.get(`${id}|${def.id}`) ?? new Set<string>();
          for (const c of drawn) seen.add(c);
          paletteSeen.set(`${id}|${def.id}`, seen);
        }
      }
    }
    // Every declared palette colour is drawn in some run: a box for a colour the line never has would be useless.
    for (const [id, plots] of Object.entries(PLOT_PALETTES)) {
      for (const [pid, colors] of Object.entries(plots)) {
        const seen = paletteSeen.get(`${id}|${pid}`) ?? new Set();
        expect(
          colors.filter((c) => !seen.has(colorKey(c))),
          `${id} ${pid}`,
        ).toEqual([]);
        // and the catalog carries it
        expect(STUDY_MODULES[id as StudyId].plotConfig.find((p) => p.id === pid)?.palette, `${id} ${pid}`).toEqual(colors);
      }
    }
  });

  it('a colour input colours whole lines exactly as INPUT_LINES says; a line it colours in part is INPUT_COLORED', () => {
    for (const id of ids) {
      const mod = STUDY_MODULES[id];
      const base = sanitizeInputs(mod, {});
      const r0 = run(id, base);
      if (!r0) continue;
      for (const cfg of mod.inputConfig.filter((c) => c.type === 'color')) {
        const r1 = run(id, { ...base, [cfg.id]: SENTINEL });
        if (!r1) continue;
        const whole: string[] = [];
        for (const def of stylePlots(mod)) {
          const a = (r0.plots?.[def.id] ?? []) as { color?: string }[];
          const b = (r1.plots?.[def.id] ?? []) as { value: number; color?: string }[];
          const changed = b.filter((p, i) => p.color !== a[i]?.color);
          if (!changed.length) continue;
          const all = b.filter((p) => Number.isFinite(p.value)).every((p) => p.color && colorKey(p.color) === SENTINEL);
          if (all) whole.push(def.id);
          else expect(INPUT_COLORED[id]?.[def.id], `${id} ${cfg.id} colours ${def.id} in part`).toBeDefined();
        }
        expect(whole, `${id} ${cfg.id}`).toEqual([...(INPUT_LINES[id]?.[cfg.id] ?? [])]);
      }
    }
  });

  it('INPUT_COLORED names inputs of its indicator', () => {
    for (const [id, plots] of Object.entries(INPUT_COLORED)) {
      const mod = STUDY_MODULES[id as StudyId];
      for (const [pid, c] of Object.entries(plots)) {
        expect(mod.plotConfig.some((p) => p.id === pid), `${id} ${pid}`).toBe(true);
        for (const i of c.inputs) expect(mod.inputConfig.find((x) => x.id === i)?.type, `${id} ${i}`).toBe('color');
      }
    }
  });
});

describe('linkStyle (FD-COLORUNIFY, settings saved before)', () => {
  const base = (over: Partial<Study>): Study => ({ uid: 'abcdef', id: 'ma-ribbon', inputs: {}, visible: true, ...over });

  it('a colour chosen in Stil while the input kept its default becomes the input', () => {
    const out = linkStyle(base({ plots: { plot0: { color: '#FF0000', width: 3 } } }));
    expect(out.inputs).toEqual({ ma1Color: '#FF0000' });
    expect(out.plots).toEqual({ plot0: { width: 3 } });
  });

  it('a colour chosen in Stil while the input was changed is dropped: the input was the one drawn', () => {
    const out = linkStyle(base({ inputs: { ma1Color: '#00FF00' }, plots: { plot0: { color: '#FF0000' } } }));
    expect(out.inputs).toEqual({ ma1Color: '#00FF00' });
    expect(out.plots).toBeUndefined();
  });

  it('leaves other indicators, unlinked plots and the linked form as they are (idempotent)', () => {
    const macd: Study = { uid: 'abcdef', id: 'macd', inputs: {}, visible: true, plots: { plot1: { color: '#FF0000' } } };
    expect(linkStyle(macd)).toBe(macd);
    const linked = base({ inputs: { ma2Color: '#00FF00' }, plots: { plot1: { width: 2 } } });
    expect(linkStyle(linked)).toBe(linked);
    const once = linkStyle(base({ plots: { plot0: { color: '#FF0000' }, plot2: { color: '#0000FF', style: 'dashed' } } }));
    expect(once).toEqual(base({ inputs: { ma1Color: '#FF0000', ma3Color: '#0000FF' }, plots: { plot2: { style: 'dashed' } } }));
    expect(linkStyle(once)).toBe(once);
  });
});
