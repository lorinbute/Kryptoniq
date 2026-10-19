// The horizontal lines drawn on a chart (FD-HLINE): their style (TradingView's settings, in one panel), where they show,
// and how they are kept in the user's settings (per symbol).
import { z } from 'zod';
import type { Timeframe } from './time.ts';

/** `#RRGGBB` or `#RRGGBBAA` (the colour picker keeps the transparency). */
const hex = z.string().regex(/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/);

export const HLINE_TEXT_SIZES = [10, 11, 12, 14, 16, 20, 24, 28, 32, 40] as const;
export const HLINE_STYLES = ['solid', 'dashed', 'dotted'] as const;
export type HLineStyleId = (typeof HLINE_STYLES)[number];
export const HLINE_V_ALIGNS = ['top', 'middle', 'bottom'] as const;
export const HLINE_H_ALIGNS = ['left', 'center', 'right'] as const;

/** The timeframe units of Sentiq and the numbers each can take (as TradingView's "Visibility"). */
export const HLINE_UNITS = {
  minutes: { min: 1, max: 59 },
  hours: { min: 1, max: 24 },
  days: { min: 1, max: 366 },
  weeks: { min: 1, max: 52 },
} as const;
export type HLineUnit = keyof typeof HLINE_UNITS;
export const HLINE_UNIT_IDS = Object.keys(HLINE_UNITS) as HLineUnit[];

const range = (unit: HLineUnit) => {
  const { min, max } = HLINE_UNITS[unit];
  return z
    .object({ on: z.boolean(), from: z.number().int().min(min).max(max), to: z.number().int().min(min).max(max) })
    .strict()
    .refine((r) => r.from <= r.to, '„de la” trebuie să fie cel mult „până la”');
};

export const hlineStyleSchema = z
  .object({
    color: hex,
    width: z.number().int().min(1).max(4),
    style: z.enum(HLINE_STYLES),
    priceLabel: z.boolean(),
    textColor: hex,
    textSize: z.number().refine((n) => (HLINE_TEXT_SIZES as readonly number[]).includes(n), 'mărime de text necunoscută'),
    bold: z.boolean(),
    italic: z.boolean(),
    vAlign: z.enum(HLINE_V_ALIGNS),
    hAlign: z.enum(HLINE_H_ALIGNS),
    visibility: z.object({ minutes: range('minutes'), hours: range('hours'), days: range('days'), weeks: range('weeks') }).strict(),
  })
  .strict();
export type HLineStyle = z.infer<typeof hlineStyleSchema>;

export const hlineSchema = hlineStyleSchema.extend({
  id: z.string().regex(/^[a-z0-9]{6,24}$/),
  price: z.number().finite(),
  text: z.string().max(500),
});
export type HLine = z.infer<typeof hlineSchema>;

/** At most this many lines on one symbol, and this many symbols with lines. */
export const HLINE_MAX = 50;
export const HLINE_SYMBOLS_MAX = 100;

/** TradingView's horizontal line: blue, 1 px, solid, with its price label, visible on every timeframe. */
export const HLINE_DEFAULT_STYLE: HLineStyle = {
  color: '#2962FF',
  width: 1,
  style: 'solid',
  priceLabel: true,
  textColor: '#2962FF',
  textSize: 14,
  bold: false,
  italic: false,
  vAlign: 'middle',
  hAlign: 'right',
  visibility: {
    minutes: { on: true, from: 1, to: 59 },
    hours: { on: true, from: 1, to: 24 },
    days: { on: true, from: 1, to: 366 },
    weeks: { on: true, from: 1, to: 52 },
  },
};

/** The lines of each symbol (a key of the charts' symbols); a symbol left without lines is not kept. */
export const chartLinesSchemaFor = (keyRe: RegExp) =>
  z
    .record(z.string().regex(keyRe), z.array(hlineSchema).max(HLINE_MAX))
    .transform((r) => Object.fromEntries(Object.entries(r).filter(([, lines]) => lines.length > 0)))
    .refine((r) => Object.keys(r).length <= HLINE_SYMBOLS_MAX, `cel mult ${HLINE_SYMBOLS_MAX} de simboluri cu linii`);

/** What stored lines keep when they no longer parse whole: the valid lines of the valid symbols, within the limits. */
export function salvageChartLines(stored: unknown, keyRe: RegExp): Record<string, HLine[]> {
  const out: Record<string, HLine[]> = {};
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return out;
  for (const [key, list] of Object.entries(stored)) {
    if (!keyRe.test(key) || !Array.isArray(list) || Object.keys(out).length >= HLINE_SYMBOLS_MAX) continue;
    const lines = list.flatMap((l) => {
      const r = hlineSchema.safeParse(l);
      return r.success ? [r.data] : [];
    });
    if (lines.length) out[key] = lines.slice(0, HLINE_MAX);
  }
  return out;
}

/** The unit and the number of a timeframe (1m → minutes 1, 4h → hours 4, 1d → days 1, 1w → weeks 1). */
export function timeframeUnit(tf: Timeframe): { unit: HLineUnit; n: number } {
  const n = Number(tf.slice(0, -1));
  const u = tf.slice(-1);
  return { unit: u === 'm' ? 'minutes' : u === 'h' ? 'hours' : u === 'd' ? 'days' : 'weeks', n };
}

/** Whether a line shows on a timeframe: its unit ticked and the number in its range. */
export function hlineVisibleOn(style: Pick<HLineStyle, 'visibility'>, tf: Timeframe): boolean {
  const { unit, n } = timeframeUnit(tf);
  const r = style.visibility[unit];
  return r.on && n >= r.from && n <= r.to;
}

/** The style part of a line (for the template). */
export function styleOf(line: HLineStyle): HLineStyle {
  const { color, width, style, priceLabel, textColor, textSize, bold, italic, vAlign, hAlign, visibility } = line;
  return { color, width, style, priceLabel, textColor, textSize, bold, italic, vAlign, hAlign, visibility: structuredClone(visibility) };
}
