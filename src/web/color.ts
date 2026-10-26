// Colours with their opacity (FD-OPACITY): what the colour boxes read and save, and the transparency a drawing adds on top.

/** A colour as the colour box edits it: #RRGGBB (upper case) and its opacity, 0–255. */
export interface EditableColor {
  hex: string;
  alpha: number;
}

const byte = (n: number) => Math.round(Math.min(255, Math.max(0, n)));
const hex2 = (n: number) => byte(n).toString(16).padStart(2, '0').toUpperCase();

/**
 * Reads #RGB(A), #RRGGBB(AA), rgb() / rgba() and 'transparent', the forms the indicators give their colours in; anything
 * else reads as opaque black.
 */
export function parseColor(css: string): EditableColor {
  const s = css.trim();
  if (s.toLowerCase() === 'transparent') return { hex: '#000000', alpha: 0 };
  const m8 = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s);
  if (m8) return { hex: `#${(m8[1] as string).toUpperCase()}`, alpha: m8[2] ? parseInt(m8[2], 16) : 255 };
  const m3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])?$/i.exec(s);
  if (m3) {
    const [, r, g, b, a] = m3 as unknown as [string, string, string, string, string | undefined];
    return { hex: `#${r}${r}${g}${g}${b}${b}`.toUpperCase(), alpha: a ? parseInt(`${a}${a}`, 16) : 255 };
  }
  const rgb = /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s);
  if (rgb) {
    const alpha = rgb[4] !== undefined ? byte(Math.min(1, Number(rgb[4])) * 255) : 255;
    return { hex: `#${hex2(Number(rgb[1]))}${hex2(Number(rgb[2]))}${hex2(Number(rgb[3]))}`, alpha };
  }
  return { hex: '#000000', alpha: 255 };
}

/** What is saved: #RRGGBB when fully opaque, else #RRGGBBAA. */
export function formatColor(hex: string, alpha: number): string {
  const h = parseColor(hex).hex;
  return byte(alpha) >= 255 ? h : `${h}${hex2(alpha)}`;
}

/** Opacity in percent (0–100), as the slider shows it. */
export const alphaToPercent = (alpha: number) => Math.round((byte(alpha) / 255) * 100);
export const percentToAlpha = (percent: number) => byte((Math.min(100, Math.max(0, percent)) / 100) * 255);

/**
 * The colour with its own opacity times `k`, as rgba(): what a drawing that makes a colour transparent itself (the cloud
 * at half, a label's background) uses, so the opacity the user chose still counts.
 */
export function fade(css: string, k: number): string {
  const { hex, alpha } = parseColor(css);
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.round((alpha / 255) * k * 1000) / 1000})`;
}

/**
 * The colour `t` (0–1) of the way from `a` to `b`, opacity included, as rgba(): a point of the chart's background
 * gradient (FD-CHARTSETTINGS), which the library paints from each pane's top to its bottom the same way.
 */
export function mixColor(a: string, b: string, t: number): string {
  if (a === b) return a;
  const k = Math.min(1, Math.max(0, t));
  const x = parseColor(a);
  const y = parseColor(b);
  const ch = (hex: string, i: number) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16);
  const m = (p: number, q: number) => Math.round(p + (q - p) * k);
  const alpha = Math.round(((x.alpha + (y.alpha - x.alpha) * k) / 255) * 1000) / 1000;
  return `rgba(${m(ch(x.hex, 0), ch(y.hex, 0))}, ${m(ch(x.hex, 1), ch(y.hex, 1))}, ${m(ch(x.hex, 2), ch(y.hex, 2))}, ${alpha})`;
}
