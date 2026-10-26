// The bot form's state (FD-BOT §1–§6): what it starts with from the chart, and the settings it makes (or the first thing
// wrong with them, in the form's own words). Numbers are typed as text (a comma is a decimal point) and read here.
import { botInputSchema, DEFAULT_WEIGHTS, defaultBotName, rrText, WEIGHT_RO, type BotEndAction, type BotInput, type BotMarket, type BotStrategy, type DcaConfig, type GridConfig, type PremiumConfig, type WeightKey } from '../../../shared/bot.ts';
import type { Timeframe } from '../../../shared/time.ts';

/** Where the form starts: the chart's symbol, timeframe, price and the range of its last 100 candles. */
export interface BotSeed {
  kind: 'crypto' | 'stocks';
  symbol: string;
  tf: Timeframe;
  price: number | null;
  low: number | null;
  high: number | null;
}

type Text<T> = { [K in keyof T]: T[K] extends number | null ? string : T[K] extends Record<WeightKey, number> ? Record<WeightKey, string> : T[K] };

export interface BotForm {
  strategy: BotStrategy;
  name: string;
  /** The name follows the symbols until it is typed. */
  nameTyped: boolean;
  exec: 'paper' | 'real';
  accountId: number | null;
  market: BotMarket;
  symbols: string[];
  tf: Timeframe;
  maxAmount: string;
  leverage: string;
  /** `null`: now; else a `datetime-local` value. */
  startsAt: string | null;
  endsAt: string | null;
  endAction: BotEndAction;
  dailyLoss: string;
  lossStop: string;
  fee: string;
  grid: Text<GridConfig>;
  dca: Text<DcaConfig>;
  premium: Text<PremiumConfig>;
}

/** Every strategy long (spot has nothing to sell short; Trading 212 and Alpaca go only long on shares, FD-BOT §10). */
export const longPatch = (f: BotForm): Partial<BotForm> => ({ grid: { ...f.grid, direction: 'long' }, dca: { ...f.dca, direction: 'long' }, premium: { ...f.premium, direction: 'long' } });

/** Another market: on spot, every strategy is long only. */
export function marketPatch(f: BotForm, market: BotMarket): Partial<BotForm> {
  return market === 'spot' ? { market, ...longPatch(f) } : { market };
}

/** A typed number: '' is none, a comma is a decimal point. */
export function readNum(s: string): number | null {
  const t = s.trim().replace(/\s/g, '').replace(',', '.');
  if (t === '') return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : Number.NaN;
}

/** A number for a field: plain, with a comma, rounded to what matters. */
export function numText(v: number | null, digits = 8): string {
  if (v === null || !Number.isFinite(v)) return '';
  return String(Number(v.toFixed(digits))).replace('.', ',');
}

/** A price rounded to ~5 significant digits (the grid's default limits). */
const roundPrice = (v: number): number => {
  const d = Math.max(0, 4 - Math.floor(Math.log10(Math.abs(v))));
  return Number(v.toFixed(Math.min(10, d)));
};

/** A `datetime-local` value of a time (the browser's own zone). */
export function localInput(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

const text = <T extends Record<string, unknown>>(o: T): Text<T> => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === 'number') out[k] = numText(v);
    else if (v === null) out[k] = '';
    else if (k === 'weights') out[k] = Object.fromEntries(Object.entries(v as Record<string, number>).map(([w, n]) => [w, String(n)]));
    else out[k] = v;
  }
  return out as Text<T>;
};

export const DEFAULT_PREMIUM: PremiumConfig = {
  direction: 'long',
  sizing: 'fixed',
  amount: 100,
  riskPct: 1,
  maxPerTrade: null,
  levels: 'slingshot',
  slPct: 1,
  tpPct: 2,
  exitOnTpSignal: true,
  exitOnFlip: true,
  exitOnOpposite: true,
  longMin: 50,
  shortMax: 50,
  areaVeto: true,
  newsWindowMin: 60,
  weights: DEFAULT_WEIGHTS,
  ai: 'off',
  aiFallback: 'skip',
  maxOpen: 1,
  cooldownMin: 0,
};

export const DEFAULT_DCA: DcaConfig = { direction: 'long', baseOrder: 100, safetyOrders: 4, safetyOrder: 100, volumeScale: 1.5, deviation: 1.5, stepScale: 1.2, takeProfit: 1.5, stopLoss: null, slAction: 'stop', repeat: true, maxCycles: null, cooldownMin: 0 };

/** The grid's default range: the last 100 candles' low and high (±8% around the price without them). */
export function defaultGrid(seed: BotSeed): GridConfig {
  const p = seed.price ?? 100;
  const low = seed.low !== null && seed.low < p ? seed.low : p * 0.92;
  const high = seed.high !== null && seed.high > p ? seed.high : p * 1.08;
  return { lower: roundPrice(low), upper: roundPrice(high), grids: 10, spacing: 'arithmetic', direction: 'long', stopBelow: null, stopAbove: null, trigger: null };
}

export function initialForm(seed: BotSeed, strategy: BotStrategy): BotForm {
  const market: BotMarket = seed.kind === 'stocks' ? 'stock' : 'spot';
  const dcaCapital = 100 + 100 * (1 + 1.5 + 1.5 ** 2 + 1.5 ** 3);
  return {
    strategy,
    name: defaultBotName(strategy, [seed.symbol]),
    nameTyped: false,
    exec: 'paper',
    accountId: null,
    market,
    symbols: [seed.symbol],
    tf: seed.tf,
    maxAmount: numText(strategy === 'dca' ? Math.ceil(dcaCapital) : 1000),
    leverage: '3',
    startsAt: null,
    endsAt: null,
    endAction: strategy === 'grid' ? 'close' : 'finish',
    dailyLoss: numText(strategy === 'dca' ? Math.ceil(dcaCapital) / 10 : 100),
    lossStop: '',
    fee: '0,1',
    grid: text(defaultGrid(seed)),
    dca: text(DEFAULT_DCA),
    premium: text(DEFAULT_PREMIUM),
  };
}

/** The form of a bot that exists (to edit it, or to make a copy). */
export function formOf(input: BotInput): BotForm {
  return {
    strategy: input.strategy,
    name: input.name,
    nameTyped: true,
    exec: input.exec,
    accountId: input.accountId,
    market: input.market,
    symbols: [...input.symbols],
    tf: input.tf,
    maxAmount: numText(input.maxAmount),
    leverage: String(input.leverage),
    startsAt: null,
    endsAt: input.endsAt !== null ? localInput(input.endsAt) : null,
    endAction: input.endAction,
    dailyLoss: numText(input.dailyLoss),
    lossStop: numText(input.lossStop),
    fee: numText(input.fee),
    grid: text(input.strategy === 'grid' ? input.grid : defaultGrid({ kind: 'crypto', symbol: input.symbols[0] ?? '', tf: input.tf, price: null, low: null, high: null })),
    dca: text(input.strategy === 'dca' ? input.dca : DEFAULT_DCA),
    premium: text(input.strategy === 'premium' ? input.premium : DEFAULT_PREMIUM),
  };
}

const LABELS: Record<string, string> = {
  maxAmount: 'Suma maximă',
  leverage: 'Levierul',
  dailyLoss: 'Pierderea maximă pe zi',
  lossStop: 'Pierderea la care se oprește',
  fee: 'Comisionul',
};

/** Reads a typed number field; `required` fields cannot be empty. */
function field(label: string, s: string, required: boolean, errors: string[]): number | null {
  const v = readNum(s);
  if (v === null) {
    if (required) errors.push(`${label}: lipsește.`);
    return null;
  }
  if (Number.isNaN(v)) {
    errors.push(`${label}: nu e un număr.`);
    return null;
  }
  return v;
}

/** The strategies' number fields, in the form's words; the optional ones may stay empty. */
const NUMBER_FIELDS: Record<string, string> = {
  lower: 'Limita de jos',
  upper: 'Limita de sus',
  grids: 'Grilele',
  stopBelow: 'Oprește sub',
  stopAbove: 'Oprește peste',
  trigger: 'Prețul de pornire',
  baseOrder: 'Ordinul de bază',
  safetyOrders: 'Ordinele de siguranță',
  safetyOrder: 'Primul ordin de siguranță',
  volumeScale: 'Multiplicatorul de volum',
  deviation: 'Abaterea până la primul',
  stepScale: 'Multiplicatorul de pas',
  takeProfit: 'Take profit',
  stopLoss: 'Stop loss',
  maxCycles: 'Ciclurile',
  amount: 'Suma pe tranzacție',
  riskPct: 'Riscul',
  maxPerTrade: 'Suma maximă pe tranzacție',
  slPct: 'Stop loss-ul',
  tpPct: 'Take profit-ul',
  longMin: 'Scorul minim pentru long',
  shortMax: 'Scorul maxim pentru short',
  newsWindowMin: 'Minutele dinaintea știrilor economice importante',
  maxOpen: 'Tranzacțiile deschise odată',
};
const OPTIONAL = new Set(['stopBelow', 'stopAbove', 'trigger', 'stopLoss', 'maxCycles', 'maxPerTrade']);

function numbers<T extends Record<string, unknown>>(o: Text<T>, strategy: BotStrategy, errors: string[]): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (k === 'weights') out[k] = Object.fromEntries(Object.entries(v as Record<WeightKey, string>).map(([w, n]) => [w, field(`Ponderea „${WEIGHT_RO[w as WeightKey]}”`, n, true, errors) ?? 0]));
    else if (k === 'cooldownMin') out[k] = field(strategy === 'dca' ? 'Pauza între cicluri' : 'Pauza după o pierdere', v as string, true, errors);
    else if (k in NUMBER_FIELDS) out[k] = field(NUMBER_FIELDS[k] as string, v as string, !OPTIONAL.has(k), errors);
    else out[k] = v;
  }
  return out as T;
}

/** A typed number the form does not show: kept when valid, else its default (it must not block the save). */
const keepHidden = (s: string, def: number, min: number, max: number, int = false): string => {
  const v = readNum(s);
  return v !== null && v >= min && v <= max && (!int || Number.isInteger(v)) ? s : numText(def);
};

/** What the form hides: the percents of "Slingshot" (FD-BOTSLRR / FD-BOTPCT), the threshold of the side the bot does not trade (FD-BOTDIR). */
function shownPremium(p: Text<PremiumConfig>): Text<PremiumConfig> {
  const d = DEFAULT_PREMIUM;
  const out = { ...p };
  if (p.levels === 'slingshot') Object.assign(out, { slPct: keepHidden(p.slPct, d.slPct, 0.1, 50), tpPct: keepHidden(p.tpPct, d.tpPct, 0.1, 500) });
  if (p.direction === 'long') out.shortMax = keepHidden(p.shortMax, d.shortMax, 0, 100, true);
  if (p.direction === 'short') out.longMin = keepHidden(p.longMin, d.longMin, 0, 100, true);
  return out;
}

/** FD-BOTDIR: the thresholds in a sentence, under them („—” for one missing or wrong). */
export function zoneText(p: Pick<Text<PremiumConfig>, 'direction' | 'longMin' | 'shortMax'>): string {
  const read = (s: string) => {
    const v = readNum(s);
    return v !== null && Number.isInteger(v) && v >= 0 && v <= 100 ? v : null;
  };
  const lo = read(p.longMin);
  const hi = read(p.shortMax);
  const show = (v: number | null) => (v === null ? '—' : String(v));
  if (p.direction === 'long') return `Long de la scorul ${show(lo)} în sus.`;
  if (p.direction === 'short') return `Short de la scorul ${show(hi)} în jos.`;
  const both = `Long de la scorul ${show(lo)} în sus, short de la ${show(hi)} în jos`;
  if (lo === null || hi === null) return `${both}.`;
  if (lo === hi) return `${both}: la ${lo} pot intra amândouă.`;
  return lo < hi ? `${both}: între ${lo} și ${hi} pot intra amândouă.` : `${both}: peste ${hi} și sub ${lo}, botul nu intră.`;
}

/** FD-BOTPCT: the risk : reward of the typed percents („1:2”), or „—” while one is missing or wrong. */
export function ratioOf(sl: string, tp: string): string {
  const a = readNum(sl);
  const b = readNum(tp);
  return a !== null && b !== null && a > 0 && b > 0 ? rrText(a, b) : '—';
}

/**
 * The bot the form describes (`BotInput`), or the first problem with it. `now` turns a start in the past into "now".
 * The same rules as the server's (shared/bot.ts).
 */
export function toInput(f: BotForm, now = Date.now()): { input: BotInput | null; error: string | null } {
  const errors: string[] = [];
  const futures = f.market === 'futures';
  const at = (s: string | null) => (s === null || s === '' ? null : new Date(s).getTime());
  const startsAt = at(f.startsAt);
  const endsAt = at(f.endsAt);
  if (f.startsAt !== null && (startsAt === null || Number.isNaN(startsAt))) errors.push('Începutul: alege data și ora.');
  if (f.endsAt !== null && (endsAt === null || Number.isNaN(endsAt))) errors.push('Sfârșitul: alege data și ora.');
  const base = {
    name: f.name.trim() || defaultBotName(f.strategy, f.symbols),
    exec: f.exec,
    accountId: f.exec === 'real' ? f.accountId : null,
    market: f.market,
    symbols: f.symbols.map((s) => s.trim().toUpperCase()).filter(Boolean),
    tf: f.tf,
    maxAmount: field(LABELS.maxAmount as string, f.maxAmount, true, errors),
    leverage: futures ? field(LABELS.leverage as string, f.leverage, true, errors) : 1,
    startsAt: startsAt !== null && startsAt > now ? startsAt : null,
    endsAt,
    endAction: f.endAction,
    dailyLoss: field(LABELS.dailyLoss as string, f.dailyLoss, false, errors),
    lossStop: field(LABELS.lossStop as string, f.lossStop, false, errors),
    fee: field(LABELS.fee as string, f.fee, true, errors) ?? 0,
  };
  const strategy =
    f.strategy === 'grid'
      ? { strategy: 'grid' as const, grid: numbers<GridConfig>(f.grid, 'grid', errors) }
      : f.strategy === 'dca'
        ? { strategy: 'dca' as const, dca: numbers<DcaConfig>(f.dca, 'dca', errors) }
        : { strategy: 'premium' as const, premium: numbers<PremiumConfig>(shownPremium(f.premium), 'premium', errors) };
  if (errors.length) return { input: null, error: errors[0] as string };
  const r = botInputSchema.safeParse({ ...base, ...strategy });
  if (!r.success) return { input: null, error: r.error.issues[0]?.message ?? 'Setări invalide.' };
  return { input: r.data, error: null };
}
