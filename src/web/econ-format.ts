// Values and periods of the Economy page (FD-ECON §2, TD-ECON §6), in Romanian.
import { fmtNum } from './format.ts';

const SCALE: Record<string, string> = { K: 'mii', M: 'mil.', B: 'mld.', T: 'tril.' };
const MONTHS: Record<string, string> = {
  jan: 'ian.',
  feb: 'feb.',
  mar: 'mar.',
  apr: 'apr.',
  may: 'mai',
  jun: 'iun.',
  jul: 'iul.',
  aug: 'aug.',
  sep: 'sept.',
  oct: 'oct.',
  nov: 'nov.',
  dec: 'dec.',
};

/** "3,8%", "197 mii", "1,275 mil.", "14,2 mld. €", "6,748 tril. $", "54,5". */
export function fmtEconValue(value: number | null | undefined, unit: string | null, scale: string | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const n = fmtNum(value, 3);
  if (unit === '%') return `${n}%`;
  const parts = [n];
  if (scale && SCALE[scale]) parts.push(SCALE[scale]);
  if (unit) parts.push(unit);
  return parts.join(' ');
}

/** A change, signed: percentages in percentage points ("+0,2 pp"), the rest in the value's own unit. */
export function fmtEconChange(change: number | null | undefined, unit: string | null, scale: string | null): string {
  if (change === null || change === undefined || !Number.isFinite(change)) return '—';
  const rounded = Math.round(change * 1000) / 1000;
  if (rounded === 0) return '0';
  const sign = rounded > 0 ? '+' : '−';
  const abs = Math.abs(rounded);
  if (unit === '%') return `${sign}${fmtNum(abs, 3)} pp`;
  return `${sign}${fmtEconValue(abs, unit, scale)}`;
}

/** The source's period: "Aug" → "aug.", "Q2" → "T2", "H1" → "S1", "Oct/03" → "săpt. 3 oct.", "" → "—". */
export function fmtEconPeriod(period: string | null | undefined): string {
  const p = (period ?? '').trim();
  if (!p) return '—';
  const week = /^([A-Za-z]{3})\/(\d{1,2})$/.exec(p);
  if (week) {
    const m = MONTHS[(week[1] as string).toLowerCase()];
    if (m) return `săpt. ${Number(week[2])} ${m}`;
  }
  const month = MONTHS[p.toLowerCase()];
  if (month) return month;
  if (/^Q[1-4]$/i.test(p)) return `T${p.slice(1)}`;
  if (/^H[12]$/i.test(p)) return `S${p.slice(1)}`;
  return p;
}

/** Actual against the forecast of the same release: "peste prognoză (2,9%)", "sub prognoză (…)", "conform prognozei". */
export function surprise(actual: number, forecast: number | null, unit: string | null, scale: string | null): string | null {
  if (forecast === null || !Number.isFinite(forecast)) return null;
  const d = Math.round((actual - forecast) * 1000) / 1000;
  if (d === 0) return 'conform prognozei';
  return `${d > 0 ? 'peste' : 'sub'} prognoză (${fmtEconValue(forecast, unit, scale)})`;
}

/** The page's countries with only the indicators the search and "important only" let through (FD-ECONFILTER). */
export function filterEconomy<C extends { indicators: I[] }, I extends { name: string; original: string; countryName: string | null; important: boolean }>(
  countries: C[],
  opts: { search: string; importantOnly: boolean },
): C[] {
  const words = foldText(opts.search.trim()).split(/\s+/).filter(Boolean);
  const match = (i: I) => {
    if (opts.importantOnly && !i.important) return false;
    if (!words.length) return true;
    const text = foldText(`${i.name} ${i.original} ${i.countryName ?? ''}`);
    return words.every((w) => text.includes(w));
  };
  return countries.map((c) => ({ ...c, indicators: c.indicators.filter(match) }));
}

/** Letters without diacritics, lower case: search that does not care how the name is written. */
export const foldText = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

export type Tone = 'good' | 'bad' | 'neutral';

/**
 * Good or bad for the economy (FD-ECONCOLOR): the direction of a change times the indicator's polarity (1 = a rise
 * is good, -1 = bad, 0 = neither). No change, no previous value or a neutral indicator: neutral.
 */
export function toneOf(delta: number | null | undefined, polarity: number): Tone {
  if (delta === null || delta === undefined || !Number.isFinite(delta) || polarity === 0) return 'neutral';
  const d = Math.round(delta * 1000) / 1000;
  if (d === 0) return 'neutral';
  return d * polarity > 0 ? 'good' : 'bad';
}

/** Text colour of a tone. */
export const TONE_TEXT: Record<Tone, string> = { good: 'text-bull', bad: 'text-bear', neutral: 'text-text' };
/** Fill colour of a tone (the dot at the end of a history line). */
export const TONE_FILL: Record<Tone, string> = { good: 'fill-bull', bad: 'fill-bear', neutral: 'fill-muted' };
