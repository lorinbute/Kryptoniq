// Combines ForexFactory and TradingView events at read time (TD §7.3). Pure functions.
import { addDays, dayKey, zonedTimeToUtc } from '../../shared/time.ts';
import type { CalImpact, RawEvent } from './sources.ts';

const NY = 'America/New_York';

export interface CalendarEvent {
  id: string;
  source: 'ff' | 'tv' | 'custom';
  title: string;
  currency: string;
  ts: number;
  allDay: boolean;
  impact: CalImpact;
  actual: string | null;
  forecast: string | null;
  previous: string | null;
  /** actual − forecast in the same scale, when both are numeric. */
  deviation: number | null;
  /** True when the Actual came from the TradingView match. */
  matched: boolean;
  note: string | null;
}

const SYNONYMS: [RegExp, string][] = [
  [/\bconsumer price index\b|\binflation rate\b/g, 'cpi'],
  [/\bproducer price(?:s)?(?: inflation)?\b/g, 'ppi'],
  [/\badp non-?farm employment change\b|\badp employment change\b/g, 'adpemployment'],
  [/\bnon-?farm (?:employment change|payrolls)\b|\bnonfarm payrolls\b/g, 'nfp'],
  [/\b(?:initial )?jobless claims\b|\bunemployment claims\b/g, 'joblessclaims'],
  [/\bfederal funds rate\b|\bfed interest rate decision\b/g, 'fedrate'],
  [/\buom\b|\bmichigan\b/g, 'michigan'],
  [/\bprel(?:im(?:inary)?)?\b/g, 'prelim'],
  [/\brevised\b|\bfinal\b/g, 'final'],
  [/\badv(?:ance)?\b/g, 'advance'],
  [/\bcore retail sales\b/g, 'retail sales ex autos'],
  [/\btrade balance\b|\bbalance of trade\b/g, 'tradebalance'],
  [/\bism non-?manufacturing pmi\b|\bism services pmi\b/g, 'ism services pmi'],
  [/\bphilly fed\b|\bphiladelphia fed\b/g, 'phillyfed'],
  [/\bny empire state\b|\bempire state\b/g, 'empirestate'],
  [/\bcrude oil inventories\b|\beia crude oil stocks change\b/g, 'crudeinventories'],
  [/\bgdp growth rate\b/g, 'gdp'],
  [/\bproducer prices\b/g, 'ppi'],
];

const PERIOD_RE = /\b(m\/m|y\/y|q\/q|mom|yoy|qoq)\b/g;
const STOP = new Set(['the', 'of', 'and', 'index', 'rate', 's.a', 'sa', 'change', 'level']);

export function normalizeTitle(title: string): { tokens: Set<string>; period: string | null } {
  let t = title.toLowerCase();
  let period: string | null = null;
  t = t.replace(PERIOD_RE, (m) => {
    const p = m.replace('/', '');
    period = p === 'mm' ? 'mom' : p === 'yy' ? 'yoy' : p === 'qq' ? 'qoq' : p;
    return ' ';
  });
  for (const [re, rep] of SYNONYMS) t = t.replace(re, rep);
  const tokens = new Set(
    t
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter((x) => x && !STOP.has(x)),
  );
  return { tokens, period };
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

const MATCH_WINDOW_MS = 60_000;
const MIN_SCORE = 0.34;

/** Pairs FF events with TV events (same currency, ±60 s, compatible period, best title similarity, unambiguous). */
export function matchEvents(ff: RawEvent[], tv: RawEvent[]): Map<string, RawEvent> {
  const pairs: { ffId: string; tvId: string; score: number; tie: boolean }[] = [];
  const tvById = new Map(tv.map((e) => [e.extId, e]));
  const tvNorm = new Map(tv.map((e) => [e.extId, normalizeTitle(e.title)]));
  for (const f of ff) {
    if (f.allDay) continue;
    const fn = normalizeTitle(f.title);
    const scored: { id: string; score: number }[] = [];
    for (const t of tv) {
      if (t.currency !== f.currency || Math.abs(t.ts - f.ts) > MATCH_WINDOW_MS) continue;
      const tn = tvNorm.get(t.extId) as ReturnType<typeof normalizeTitle>;
      if (fn.period && tn.period && fn.period !== tn.period) continue;
      let score = jaccard(fn.tokens, tn.tokens);
      if (fn.period && !tn.period) score -= 0.1; // prefer candidates that state the same period
      if (score >= MIN_SCORE) scored.push({ id: t.extId, score });
    }
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (!best) continue;
    const tie = scored.length > 1 && Math.abs((scored[1] as { score: number }).score - best.score) < 1e-9;
    pairs.push({ ffId: f.extId, tvId: best.id, score: best.score, tie });
  }
  pairs.sort((a, b) => b.score - a.score);
  const usedTv = new Set<string>();
  const out = new Map<string, RawEvent>();
  for (const p of pairs) {
    if (p.tie || usedTv.has(p.tvId)) continue;
    usedTv.add(p.tvId);
    out.set(p.ffId, tvById.get(p.tvId) as RawEvent);
  }
  return out;
}

const SCALE: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };

/** Numeric value of "0.3%", "20.0K", "-105.6B", "1.25" (+ optional TradingView scale letter). */
export function parseValue(s: string | null, scale: string | null = null): number | null {
  if (s === null) return null;
  const m = /^\s*([+-]?\d+(?:\.\d+)?)\s*([KMBT])?\s*%?\s*$/i.exec(s.replace(/,/g, ''));
  if (!m) return null;
  const n = Number(m[1]);
  const suffix = (m[2] ?? scale ?? '').toUpperCase();
  return n * (SCALE[suffix] ?? 1);
}

/** Display string for a TradingView number using its unit/scale (197 + K → "197K", 3.6 + % → "3.6%"). */
export function formatTv(value: string | null, unit: string | null, scale: string | null): string | null {
  if (value === null) return null;
  const sc = scale && SCALE[scale.toUpperCase()] ? scale.toUpperCase() : '';
  if (unit === '%') return `${value}%`;
  if (unit && unit.trim()) return `${value}${sc} ${unit.trim()}`.replace(/\s+/g, ' ');
  return `${value}${sc}`;
}

function tvToEvent(t: RawEvent): CalendarEvent {
  const actual = formatTv(t.actual, t.unit, t.scale);
  const forecast = formatTv(t.forecast, t.unit, t.scale);
  const a = parseValue(t.actual, t.scale);
  const f = parseValue(t.forecast, t.scale);
  return {
    id: `tv:${t.extId}`,
    source: 'tv',
    title: t.title,
    currency: t.currency,
    ts: t.ts,
    allDay: t.allDay,
    impact: t.impact,
    actual,
    forecast,
    previous: formatTv(t.previous, t.unit, t.scale),
    deviation: a !== null && f !== null ? roundDev(a - f) : null,
    matched: false,
    note: null,
  };
}

const roundDev = (x: number) => Math.round(x * 1e6) / 1e6;

export interface MergeInput {
  ff: RawEvent[];
  tv: RawEvent[];
  /** [start, end) ranges covered by an FF weekly file. */
  ffCoverage: { start: number; end: number }[];
}

export function mergeCalendar({ ff, tv, ffCoverage }: MergeInput): CalendarEvent[] {
  const covered = (ts: number) => ffCoverage.some((c) => ts >= c.start && ts < c.end);
  const ffIn = ff.filter((e) => covered(e.ts));
  const tvCovered = tv.filter((e) => covered(e.ts));
  const matches = matchEvents(ffIn, tvCovered);
  const out: CalendarEvent[] = [];
  for (const f of ffIn) {
    const t = matches.get(f.extId);
    const tvActual = t ? formatTv(t.actual, t.unit, t.scale) : null;
    const forecast = f.forecast ?? (t ? formatTv(t.forecast, t.unit, t.scale) : null);
    const previous = f.previous ?? (t ? formatTv(t.previous, t.unit, t.scale) : null);
    let deviation: number | null = null;
    if (t && t.actual !== null) {
      const a = parseValue(t.actual, t.scale);
      // Compare against the same source's forecast when available (same consensus), else FF's.
      const fc = t.forecast !== null ? parseValue(t.forecast, t.scale) : parseValue(f.forecast);
      if (a !== null && fc !== null) deviation = roundDev(a - fc);
    }
    out.push({
      id: `ff:${f.extId}`,
      source: 'ff',
      title: f.title,
      currency: f.currency,
      ts: f.ts,
      allDay: f.allDay,
      impact: f.impact,
      actual: tvActual,
      forecast,
      previous,
      deviation,
      matched: Boolean(t),
      note: null,
    });
  }
  for (const t of tv) if (!covered(t.ts)) out.push(tvToEvent(t));
  return out.sort((a, b) => a.ts - b.ts || a.title.localeCompare(b.title));
}

/** Sunday 00:00 America/New_York of the week containing `ts` (ForexFactory weeks). */
export function ffWeekStart(ts: number): number {
  const day = dayKey(ts, NY);
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
  return zonedTimeToUtc(addDays(day, -dow), NY);
}

/** [start, end) of the ForexFactory week containing `ts`. */
export function ffWeekRange(ts: number): { start: number; end: number } {
  const start = ffWeekStart(ts);
  return { start, end: zonedTimeToUtc(addDays(dayKey(start, NY), 7), NY) };
}
