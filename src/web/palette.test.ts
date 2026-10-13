import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// FD-THEME2 / TD-THEME2: the palettes in styles.css keep every text readable (WCAG 4.5:1) on every background
// of their theme, and the bar island never leaves a token behind in what opens from it (`.theme-page`).
const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

/** The custom properties declared in the block whose selector ends just before its `{`. */
function block(selector: string): Map<string, string> {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`no block ${selector}`);
  const body = css.slice(at + selector.length + 2, css.indexOf('}', at));
  return new Map([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
}

const dark = block('@theme');
const light = new Map([...dark, ...block(":root[data-theme='light'] .theme-page")]);
const bar = new Map([...light, ...block(":root[data-theme='light'] .theme-bar")]);

type Rgba = [number, number, number, number];
function parse(v: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(v);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1]!.slice(i, i + 2), 16)).concat(1) as Rgba;
  const rgb = /^rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)$/.exec(v);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), Number(rgb[4])];
  throw new Error(`colour ${v}`);
}
/** `fg` painted over `bg` (opaque). */
const over = ([r, g, b, a]: Rgba, [R, G, B]: Rgba): Rgba => [r * a + R * (1 - a), g * a + G * (1 - a), b * a + B * (1 - a), 1];
const lum = ([r, g, b]: Rgba) => {
  const c = (x: number) => ((x /= 255) <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
};
const ratio = (a: Rgba, b: Rgba) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

/** Every text token on every background (a translucent one over the base under it), below `min`. */
function failures(theme: Map<string, string>, texts: string[], backgrounds: string[], base: string, min = 4.5): string[] {
  const col = (name: string) => {
    const v = theme.get(`--color-${name}`);
    if (!v) throw new Error(`no --color-${name}`);
    return parse(v);
  };
  const out: string[] = [];
  for (const bg of backgrounds) {
    const [name, alpha] = bg.split('/');
    const b = alpha ? over([...col(name!).slice(0, 3), Number(alpha) / 100] as Rgba, col(base)) : over(col(name!), col(base));
    for (const t of texts) {
      const r = ratio(over(col(t), b), b);
      if (r < min) out.push(`${t} on ${bg}: ${r.toFixed(2)}`);
    }
  }
  return out;
}

const TEXTS = ['text', 'muted', 'faint', 'accent', 'bull', 'bear', 'warn', 'link', 'impact-high', 'impact-medium', 'impact-low'];
const SURFACES = ['ink', 'ink-2', 'panel', 'panel-2', 'panel-3', 'chart', 'row-alt', 'row-head', 'hover', 'hover-soft'];

describe('palette contrast (FD-THEME2)', () => {
  it('the light theme: every text on every surface, stripe, hover and tint', () => {
    expect(failures(light, TEXTS, SURFACES, 'panel')).toEqual([]);
    expect(failures(light, ['text', 'muted', 'bull'], ['bull/10'], 'panel')).toEqual([]);
    expect(failures(light, ['text', 'muted', 'bear'], ['bear/10'], 'panel')).toEqual([]);
    expect(failures(light, ['on-accent'], ['accent', 'accent-hover'], 'panel')).toEqual([]);
    expect(failures(light, ['on-selected'], ['selected', 'selected-hover'], 'panel')).toEqual([]);
    expect(failures(light, ['on-nav-active'], ['nav-active'], 'panel')).toEqual([]);
  });

  it('the dark theme: the same, with the brass accent', () => {
    expect(failures(dark, TEXTS, SURFACES, 'panel')).toEqual([]);
    expect(failures(dark, ['on-accent'], ['accent', 'accent-hover'], 'panel')).toEqual([]);
    expect(failures(dark, ['on-selected', 'text'], ['selected', 'selected-hover'], 'panel')).toEqual([]);
    expect(failures(dark, ['text', 'muted'], ['bar', 'strip', 'nav-hover'], 'bar')).toEqual([]);
    expect(failures(dark, ['on-nav-active'], ['nav-active'], 'bar')).toEqual([]);
    expect(failures(dark, ['nav-active-icon'], ['nav-active'], 'bar', 3)).toEqual([]);
  });

  it('the navy bar and market strip of the light theme', () => {
    const onBar = ['bar', 'strip', 'panel', 'panel-3', 'hover', 'nav-hover'];
    expect(failures(bar, TEXTS, onBar, 'bar')).toEqual([]);
    expect(failures(bar, TEXTS, ['hover'], 'strip')).toEqual([]);
    expect(failures(bar, ['on-accent'], ['accent'], 'bar')).toEqual([]);
    expect(failures(bar, ['on-nav-active'], ['nav-active'], 'bar')).toEqual([]);
    expect(failures(bar, ['nav-active-icon'], ['nav-active'], 'bar', 3)).toEqual([]);
  });

  it('a pressed chip of the light theme: its count and name read on the navy fill', () => {
    const chip = new Map([...light, ...block(":root[data-theme='light'] .chip[aria-current='page']")]);
    expect(failures(chip, ['text', 'muted', 'faint', 'on-selected'], ['selected', 'selected-hover'], 'panel')).toEqual([]);
  });

  it('accent edges (hover, focus) stand out at 3:1 on the tiles', () => {
    expect(failures(light, ['accent', 'accent-dim'], ['panel', 'panel-2'], 'panel', 3)).toEqual([]);
    expect(failures(dark, ['accent', 'accent-dim'], ['panel', 'panel-2'], 'panel', 3)).toEqual([]);
    expect(failures(bar, ['accent'], ['bar', 'panel'], 'bar', 3)).toEqual([]);
  });
});

describe('palette tokens', () => {
  it('everything the bar island changes is reset by .theme-page (the light palette)', () => {
    const island = [...block(":root[data-theme='light'] .theme-bar").keys()].filter((k) => k.startsWith('--color-'));
    const page = block(":root[data-theme='light'] .theme-page");
    expect(island.filter((k) => !page.has(k))).toEqual([]);
  });

  it('the light palette only redefines tokens the dark theme has', () => {
    const page = [...block(":root[data-theme='light'] .theme-page").keys()].filter((k) => k.startsWith('--color-'));
    expect(page.filter((k) => !dark.has(k))).toEqual([]);
  });

  it('no component still uses the brass token names (the accent is teal on the light theme)', () => {
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        return statSync(p).isDirectory() ? files(p) : /\.(tsx?|css)$/.test(f) && !f.endsWith('.test.ts') ? [p] : [];
      });
    const left = files(new URL('.', import.meta.url).pathname).filter((p) => /\b(?:text|bg|border|stroke|fill|ring|outline|decoration|from|via|to|on|color)-brass\b/.test(readFileSync(p, 'utf8')));
    expect(left).toEqual([]);
  });
});
