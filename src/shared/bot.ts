// Trading bots (FD-BOT, TD-BOT §2): their settings (the same rules on the page and on the server), the plans the form and
// the engine both compute (a grid's lines and quantity, a DCA's orders), and what the API returns.
import { z } from 'zod';
import { TIMEFRAMES, type Timeframe } from './time.ts';

export const BOT_STRATEGIES = ['grid', 'dca', 'premium'] as const;
export type BotStrategy = (typeof BOT_STRATEGIES)[number];
export type BotExec = 'paper' | 'real';
export type BotMarket = 'spot' | 'futures' | 'stock';
export type BotArea = 'crypto' | 'stocks';
export const BOT_STATUSES = ['scheduled', 'running', 'paused', 'problem', 'ending', 'ended'] as const;
export type BotStatus = (typeof BOT_STATUSES)[number];
export type BotEndAction = 'close' | 'finish' | 'leave';
export type BotSide = 'long' | 'short';
export type BotTradeReason = 'tp' | 'sl' | 'tp_signal' | 'flip' | 'opposite' | 'grid' | 'end' | 'stop' | 'liquidation' | 'external' | 'loss_limit' | 'grid_stop';
export type BotEventKind = 'start' | 'signal' | 'skip' | 'enter' | 'exit' | 'order' | 'problem' | 'info' | 'end';

/** Bots a user may have that have not ended (FD-BOT §3). */
export const MAX_ACTIVE_BOTS = 10;
export const MAX_BOT_SYMBOLS = 10;
/** How often the engine looks (FD-BOT §8). */
export const BOT_TICK_MS = 30_000;
/** The maintenance margin taken for the liquidation distance (FD-BOT §6). */
export const MAINT_MARGIN = 0.005;
/** The SL must sit within this share of the liquidation distance (FD-BOT §6). */
export const LIQ_SAFETY = 0.8;

export const STRATEGY_RO: Record<BotStrategy, string> = { grid: 'Grid', dca: 'DCA', premium: 'Slingshot' };
export const STATUS_RO: Record<BotStatus, string> = { scheduled: 'Programat', running: 'Rulează', paused: 'Pauză', problem: 'Problemă', ending: 'Se încheie', ended: 'Încheiat' };
export const END_ACTION_RO: Record<BotEndAction, string> = { close: 'Închide pozițiile', finish: 'Termină tranzacțiile deschise', leave: 'Lasă pozițiile deschise' };
export const TRADE_REASON_RO: Record<BotTradeReason, string> = {
  tp: 'take profit',
  sl: 'stop loss',
  tp_signal: 'semnal TP',
  flip: 'invalidare',
  opposite: 'semnal opus',
  grid: 'grilă',
  end: 'sfârșit',
  stop: 'oprire',
  liquidation: 'lichidare',
  external: 'din afară',
  loss_limit: 'pierderea maximă',
  grid_stop: 'oprește sub / peste',
};

export const WEIGHT_KEYS = ['day', 'area', 'general', 'symbol', 'slingshot'] as const;
export type WeightKey = (typeof WEIGHT_KEYS)[number];
export const WEIGHT_RO: Record<WeightKey, string> = { day: 'Scorul zilei', area: 'Aria', general: 'Sentimentul general', symbol: 'Știrile simbolului', slingshot: 'Slingshot' };
export const DEFAULT_WEIGHTS: Record<WeightKey, number> = { day: 20, area: 30, general: 15, symbol: 15, slingshot: 20 };

const number = (label: string, min: number, max: number) =>
  z
    .number({ error: `${label}: lipsește` })
    .finite(`${label}: lipsește`)
    .min(min, `${label}: cel puțin ${String(min).replace('.', ',')}`)
    .max(max, `${label}: cel mult ${String(max).replace('.', ',')}`);
const whole = (label: string, min: number, max: number) => number(label, min, max).int(`${label}: un număr întreg`);
const positive = (label: string) => z.number({ error: `${label}: lipsește` }).finite(`${label}: lipsește`).positive(`${label} trebuie să fie pozitiv`);

/** A coin pair as the charts name it (BTC/USDT), or a share (AAPL). */
export const CRYPTO_PAIR_RE = /^[A-Z0-9][A-Z0-9.-]{0,19}\/[A-Z0-9]{2,10}$/;
export const STOCK_TICKER_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;

export const gridSchema = z
  .object({
    lower: positive('Limita de jos'),
    upper: positive('Limita de sus'),
    grids: whole('Grilele', 2, 100),
    spacing: z.enum(['arithmetic', 'geometric']),
    direction: z.enum(['long', 'short', 'neutral']),
    stopBelow: positive('Oprește sub').nullable(),
    stopAbove: positive('Oprește peste').nullable(),
    trigger: positive('Prețul de pornire').nullable(),
  })
  .strict();
export type GridConfig = z.infer<typeof gridSchema>;

export const dcaSchema = z
  .object({
    direction: z.enum(['long', 'short']),
    baseOrder: positive('Ordinul de bază'),
    safetyOrders: whole('Ordinele de siguranță', 0, 25),
    safetyOrder: positive('Primul ordin de siguranță'),
    volumeScale: number('Multiplicatorul de volum', 1, 5),
    deviation: number('Abaterea până la primul', 0.1, 50),
    stepScale: number('Multiplicatorul de pas', 0.5, 5),
    takeProfit: number('Take profit', 0.1, 100),
    stopLoss: number('Stop loss', 0.1, 99).nullable(),
    slAction: z.enum(['restart', 'stop']),
    repeat: z.boolean(),
    maxCycles: whole('Ciclurile', 1, 100_000).nullable(),
    cooldownMin: whole('Pauza între cicluri', 0, 10_080),
  })
  .strict();
export type DcaConfig = z.infer<typeof dcaSchema>;

/**
 * Settings saved before, so they still read; the next save writes them the new way.
 * - Before FD-BOTPCT (a stop loss and a take profit chosen apart, a ratio, a minimum R:R): "Risc / câștig" becomes the
 *   stop's percent and the take profit's (the stop's times the ratio, the same levels).
 * - Before FD-BOTDIR (one minimum M of the trade's score): on the market's scale, a long from M up, a short from
 *   100 − M down, the same entries.
 */
const upgradePremium = (v: unknown): unknown => {
  if (!v || typeof v !== 'object') return v;
  let o = v as Record<string, unknown>;
  if (!('levels' in o)) {
    const { sl: _sl, tp, rr, rrRisk, rrReward, minRr: _minRr, ...rest } = o;
    const ratio = typeof rrReward === 'number' && typeof rrRisk === 'number' && rrRisk > 0 ? rrReward / rrRisk : typeof rr === 'number' ? rr : 2;
    const slPct = typeof rest.slPct === 'number' ? rest.slPct : 1;
    o = { ...rest, levels: tp === 'rr' ? 'percent' : 'slingshot', slPct, tpPct: Number((slPct * ratio).toFixed(8)) };
  }
  if ('minScore' in o) {
    const { minScore, ...rest } = o;
    // Both ways at once: the thresholds win. A minimum that is not a number fails as the long's threshold.
    o = 'longMin' in rest ? rest : { ...rest, longMin: minScore, shortMax: typeof minScore === 'number' ? 100 - minScore : minScore };
  }
  return o;
};

export const premiumSchema = z.preprocess(
  upgradePremium,
  z.object({
    direction: z.enum(['long', 'short', 'both']),
    sizing: z.enum(['fixed', 'risk']),
    amount: positive('Suma pe tranzacție'),
    riskPct: number('Riscul', 0.1, 10),
    maxPerTrade: positive('Suma maximă pe tranzacție').nullable(),
    /** FD-BOTPCT: the signal's stop loss and take profit, or "Risc / câștig": one's own, in percent from the entry. */
    levels: z.enum(['slingshot', 'percent']),
    slPct: number('Stop loss-ul', 0.1, 50),
    tpPct: number('Take profit-ul', 0.1, 500),
    exitOnTpSignal: z.boolean(),
    exitOnFlip: z.boolean(),
    exitOnOpposite: z.boolean(),
    /** FD-BOTDIR: on the market's score, a long enters from this up, a short from `shortMax` down. */
    longMin: whole('Scorul minim pentru long', 0, 100),
    shortMax: whole('Scorul maxim pentru short', 0, 100),
    areaVeto: z.boolean(),
    newsWindowMin: whole('Minutele dinaintea știrilor economice importante', 0, 720),
    weights: z
      .object({
        day: whole('Ponderea scorului zilei', 0, 100),
        area: whole('Ponderea ariei', 0, 100),
        general: whole('Ponderea sentimentului general', 0, 100),
        symbol: whole('Ponderea știrilor simbolului', 0, 100),
        slingshot: whole('Ponderea Slingshot', 0, 100),
      })
      .strict(),
    ai: z.enum(['off', 'confirm']),
    aiFallback: z.enum(['skip', 'rules']),
    maxOpen: whole('Tranzacțiile deschise odată', 1, MAX_BOT_SYMBOLS),
    cooldownMin: whole('Pauza după o pierdere', 0, 10_080),
  })
  .strict(),
);
export type PremiumConfig = z.infer<typeof premiumSchema>;

const common = {
  name: z.string().trim().min(1, 'Numele lipsește').max(60, 'Numele: cel mult 60 de caractere'),
  exec: z.enum(['paper', 'real']),
  accountId: z.number().int().positive().nullable(),
  market: z.enum(['spot', 'futures', 'stock']),
  symbols: z
    .array(z.string().trim().toUpperCase().min(1, 'Simbolul lipsește').max(40))
    .min(1, 'Alege cel puțin un simbol')
    .max(MAX_BOT_SYMBOLS, `Cel mult ${MAX_BOT_SYMBOLS} simboluri`),
  tf: z.enum(TIMEFRAMES),
  maxAmount: positive('Suma maximă'),
  leverage: whole('Levierul', 1, 125),
  /** null: now. */
  startsAt: z.number().int().nonnegative().nullable(),
  /** null: no end. */
  endsAt: z.number().int().positive().nullable(),
  endAction: z.enum(['close', 'finish', 'leave']),
  dailyLoss: positive('Pierderea maximă pe zi').nullable(),
  lossStop: positive('Pierderea la care se oprește').nullable(),
  /** Per execution, in percent (simulated, or the estimate of the real one). */
  fee: number('Comisionul', 0, 1),
};

/** The area of a market: a bot trades either coins or shares. */
export const areaOf = (market: BotMarket): BotArea => (market === 'stock' ? 'stocks' : 'crypto');

const SPOT_LONG = 'Pe spot nu se poate short: doar Long (short pe futures sau pe acțiuni).';

/** The rules across fields (FD-BOT §3–§6), shared by the form and the server. */
function checkBot(b: BotInputBase & { grid?: GridConfig; dca?: DcaConfig; premium?: PremiumConfig }, ctx: z.RefinementCtx): void {
  const fail = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message });
  const futures = b.market === 'futures';
  // Spot holds what it bought, nothing to sell short; shares may go short (in a simulation, at eToro: FD-BOT §10).
  const spot = b.market === 'spot';
  const area = areaOf(b.market);
  const seen = new Set<string>();
  b.symbols.forEach((s, i) => {
    if (area === 'stocks' ? !STOCK_TICKER_RE.test(s) : !CRYPTO_PAIR_RE.test(s)) fail(['symbols', i], area === 'stocks' ? `„${s}” nu e simbolul unei acțiuni (AAPL)` : `„${s}” nu e o pereche crypto (BTC/USDT)`);
    if (seen.has(s)) fail(['symbols', i], `„${s}” apare de două ori`);
    seen.add(s);
  });
  if (b.exec === 'real' && b.accountId === null) fail(['accountId'], 'Alege contul în care tranzacționează botul.');
  if (b.exec === 'paper' && b.accountId !== null) fail(['accountId'], 'Simularea nu folosește un cont.');
  if (!futures && b.leverage !== 1) fail(['leverage'], 'Levierul se aplică doar pe futures.');
  if (b.startsAt !== null && b.endsAt !== null && b.endsAt <= b.startsAt) fail(['endsAt'], 'Sfârșitul trebuie să fie după început.');
  if (b.strategy !== 'premium' && b.symbols.length !== 1) fail(['symbols'], `Un bot ${STRATEGY_RO[b.strategy]} are un singur simbol.`);
  if (b.strategy === 'grid' && b.grid) {
    const g = b.grid;
    if (b.endAction === 'finish') fail(['endAction'], 'O grilă nu are tranzacții de terminat: alege „Închide pozițiile” sau „Lasă pozițiile deschise”.');
    if (g.lower >= g.upper) fail(['grid', 'upper'], 'Limita de sus trebuie să fie peste cea de jos.');
    if (spot && g.direction !== 'long') fail(['grid', 'direction'], SPOT_LONG);
    if (g.stopBelow !== null && g.stopBelow >= g.lower) fail(['grid', 'stopBelow'], '„Oprește sub” trebuie să fie sub limita de jos.');
    if (g.stopAbove !== null && g.stopAbove <= g.upper) fail(['grid', 'stopAbove'], '„Oprește peste” trebuie să fie peste limita de sus.');
    if (g.lower < g.upper) {
      const step = gridProfit(g, b.fee);
      if (step.min <= 0) fail(['grid', 'grids'], 'Pasul unei grile nu acoperă comisioanele: mai puține grile sau un interval mai larg.');
    }
  }
  if (b.strategy === 'dca' && b.dca) {
    const d = b.dca;
    if (spot && d.direction === 'short') fail(['dca', 'direction'], SPOT_LONG);
    const orders = dcaOrders(d);
    const last = orders.at(-1);
    if (d.stopLoss !== null && last && d.safetyOrders > 0 && d.stopLoss <= last.deviation) fail(['dca', 'stopLoss'], `Stop loss-ul (${fmtPctPlain(d.stopLoss)}) e mai aproape decât ultimul ordin de siguranță (${fmtPctPlain(last.deviation)}): ordinele de după el n-ar avea loc.`);
    if (last && d.direction === 'long' && last.deviation >= 100) fail(['dca', 'deviation'], 'Ultimul ordin de siguranță ar fi la un preț sub zero: abateri mai mici.');
    const capital = last?.total ?? 0;
    if (capital > b.maxAmount * (1 + 1e-9)) fail(['maxAmount'], `Ordinele cer ${fmtAmountPlain(capital)}, peste suma maximă (${fmtAmountPlain(b.maxAmount)}).`);
  }
  if (b.strategy === 'premium' && b.premium) {
    const p = b.premium;
    if (spot && p.direction !== 'long') fail(['premium', 'direction'], SPOT_LONG);
    const r = p.tpPct / p.slPct;
    if (p.levels === 'percent' && !(r >= 0.5 - 1e-9 && r <= 10 + 1e-9)) fail(['premium', 'tpPct'], `Raportul risc : câștig ${rrText(p.slPct, p.tpPct)} iese din limite: take profit-ul e între jumătate și de 10 ori distanța stop loss-ului (de la 2:1 la 1:10).`);
    if (p.sizing === 'fixed' && p.amount > b.maxAmount * (1 + 1e-9)) fail(['premium', 'amount'], 'Suma pe tranzacție nu poate trece de suma maximă.');
    if (p.maxPerTrade !== null && p.maxPerTrade > b.maxAmount * (1 + 1e-9)) fail(['premium', 'maxPerTrade'], 'Suma maximă pe tranzacție nu poate trece de suma maximă.');
    if (WEIGHT_KEYS.every((k) => p.weights[k] === 0)) fail(['premium', 'weights'], 'Cel puțin o pondere a scorului trebuie să fie peste zero.');
    if (p.maxOpen > b.symbols.length) fail(['premium', 'maxOpen'], `Botul are ${b.symbols.length} ${b.symbols.length === 1 ? 'simbol' : 'simboluri'}: cel mult atâtea tranzacții deschise odată.`);
  }
}

type BotInputBase = z.infer<z.ZodObject<typeof common>> & { strategy: BotStrategy };

export const botInputSchema = z
  .discriminatedUnion('strategy', [
    z.object({ strategy: z.literal('grid'), ...common, grid: gridSchema }).strict(),
    z.object({ strategy: z.literal('dca'), ...common, dca: dcaSchema }).strict(),
    z.object({ strategy: z.literal('premium'), ...common, premium: premiumSchema }).strict(),
  ])
  .superRefine(checkBot);
export type BotInput = z.infer<typeof botInputSchema>;

/** What may change on a bot that has started (FD-BOT §7); the server checks the strategy's own limits. */
export const botEditSchema = z
  .object({
    name: common.name,
    endsAt: common.endsAt,
    endAction: common.endAction,
    dailyLoss: common.dailyLoss,
    lossStop: common.lossStop,
    fee: common.fee,
    /** DCA and Premium (a grid invests it all at the start). */
    maxAmount: common.maxAmount.optional(),
    /** Premium: for the trades to come. */
    leverage: common.leverage.optional(),
    premium: premiumSchema.optional(),
    /** Premium: the signals' timeframe (FD-BOTTF; the engine starts again from the bars that close after it). */
    tf: common.tf.optional(),
  })
  .strict();
export type BotEdit = z.infer<typeof botEditSchema>;

export const botStopSchema = z.object({ action: z.enum(['close', 'finish', 'leave']) }).strict();

// ---------------- Plans (the form's summary and the engine) ----------------

/** The risk : reward of a stop and a take profit (their distances), risk first and brought to 1: „1:2”, „1:1,33” (FD-BOTPCT). */
export const rrText = (sl: number, tp: number): string => `1:${fmtAmountPlain(tp / sl)}`;
const fmtPctPlain = (v: number) => `${String(Number(v.toFixed(2))).replace('.', ',')}%`;
const fmtAmountPlain = (v: number) => String(Number(v.toFixed(2))).replace('.', ',');

/** The grid's n + 1 lines, low to high. */
export function gridLines(lower: number, upper: number, n: number, spacing: GridConfig['spacing']): number[] {
  const out: number[] = [];
  for (let i = 0; i <= n; i++) out.push(spacing === 'geometric' ? lower * (upper / lower) ** (i / n) : lower + ((upper - lower) * i) / n);
  out[n] = upper;
  return out;
}

/** The profit of one grid after both fees, in percent: the smallest (the top grid, arithmetic) and the largest. */
export function gridProfit(g: Pick<GridConfig, 'lower' | 'upper' | 'grids' | 'spacing'>, feePct: number): { min: number; max: number } {
  const lines = gridLines(g.lower, g.upper, g.grids, g.spacing);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < g.grids; i++) {
    const pct = ((lines[i + 1] as number) / (lines[i] as number) - 1) * 100 - 2 * feePct;
    min = Math.min(min, pct);
    max = Math.max(max, pct);
  }
  return { min, max };
}

export interface GridSlotPlan {
  side: BotSide;
  /** Bought (a long) or sold (a short) at the start, at the market. */
  holding: boolean;
}

/**
 * Each grid's side and whether it starts full (FD-BOT §4): a Long grid buys the grids above the price, a Short one sells
 * the grids below it; a Neutral one starts empty, long below the price and short above it.
 */
export function gridSlots(lines: number[], direction: GridConfig['direction'], price: number): GridSlotPlan[] {
  const out: GridSlotPlan[] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    const low = lines[i] as number;
    const high = lines[i + 1] as number;
    if (direction === 'long') out.push({ side: 'long', holding: high > price });
    else if (direction === 'short') out.push({ side: 'short', holding: low < price });
    else out.push(low >= price ? { side: 'short', holding: false } : { side: 'long', holding: false });
  }
  return out;
}

/** The price a grid enters at: a long buys at its low line, a short sells at its high one. */
export const slotEntryLine = (lines: number[], i: number, side: BotSide): number => (side === 'long' ? (lines[i] as number) : (lines[i + 1] as number));

export interface GridPlan {
  lines: number[];
  /** In the asset, the same on every grid. */
  qty: number;
  slots: GridSlotPlan[];
  /** Grids filled at the start, at the market, and what that costs (margin on futures). */
  atStart: number;
  startCost: number;
  /** One grid's order, in the quote (the smallest: at the lowest entry line). */
  minOrder: number;
  profit: { min: number; max: number };
}

/** The grid at `price`: all its grids full at once never use more than the investment (FD-BOT §4). */
export function gridPlan(g: GridConfig, investment: number, leverage: number, feePct: number, price: number): GridPlan {
  const lines = gridLines(g.lower, g.upper, g.grids, g.spacing);
  const slots = gridSlots(lines, g.direction, price);
  const entries = slots.map((s, i) => slotEntryLine(lines, i, s.side));
  const qty = (investment * leverage) / entries.reduce((a, b) => a + b, 0);
  const atStart = slots.filter((s) => s.holding).length;
  return { lines, qty, slots, atStart, startCost: (atStart * qty * price) / leverage, minOrder: qty * Math.min(...entries), profit: gridProfit(g, feePct) };
}

export interface DcaOrderPlan {
  /** 0: the base order; 1…: the safety orders. */
  k: number;
  /** From the base order's price, in percent. */
  deviation: number;
  /** What it uses (margin on futures). */
  amount: number;
  /** All the orders so far. */
  total: number;
}

/** The base order and the safety orders (FD-BOT §5): the price does not change these. */
export function dcaOrders(d: Pick<DcaConfig, 'baseOrder' | 'safetyOrders' | 'safetyOrder' | 'volumeScale' | 'deviation' | 'stepScale'>): DcaOrderPlan[] {
  const out: DcaOrderPlan[] = [{ k: 0, deviation: 0, amount: d.baseOrder, total: d.baseOrder }];
  let deviation = 0;
  let step = d.deviation;
  let amount = d.safetyOrder;
  let total = d.baseOrder;
  for (let k = 1; k <= d.safetyOrders; k++) {
    deviation += step;
    total += amount;
    out.push({ k, deviation, amount, total });
    step *= d.stepScale;
    amount *= d.volumeScale;
  }
  return out;
}

export interface DcaPricedOrder extends DcaOrderPlan {
  price: number;
  /** The average entry after this order, and the take profit then. */
  avg: number;
  tp: number;
}

/** The orders at a base price: their prices, and the average and the take profit after each. */
export function dcaPlan(d: DcaConfig, basePrice: number, leverage: number): DcaPricedOrder[] {
  const dir = d.direction === 'long' ? 1 : -1;
  let qty = 0;
  let cost = 0;
  return dcaOrders(d).map((o) => {
    const price = basePrice * (1 - (dir * o.deviation) / 100);
    const q = (o.amount * leverage) / price;
    qty += q;
    cost += q * price;
    const avg = cost / qty;
    return { ...o, price, avg, tp: avg * (1 + (dir * d.takeProfit) / 100) };
  });
}

/**
 * The price at or past a level (FD-BOT §4–§6): `up` = at or above it. A level computed as 100 × 1.1 is 110.00000000000001:
 * a price of 110 reaches it.
 */
export const reached = (price: number, level: number, up: boolean): boolean => (up ? price >= level * (1 - 1e-9) : price <= level * (1 + 1e-9));

/** How far the price may move against a position before liquidation, as a share of the entry (FD-BOT §6). */
export const liqDistance = (leverage: number): number => 1 / leverage - MAINT_MARGIN;

/** A chart's coin pair as its USDT-margined perpetual: BTC/USDT → BTC/USDT:USDT. */
export const perpetualOf = (pair: string): string => {
  const quote = pair.split('/')[1] ?? '';
  return pair.includes(':') ? pair : `${pair}:${quote}`;
};

/** The quote a bot counts in: a pair's (USDT), or USD for shares. */
export const botCurrency = (market: BotMarket, symbols: string[]): string => (market === 'stock' ? 'USD' : (symbols[0]?.split('/')[1] ?? 'USDT'));

export const defaultBotName = (strategy: BotStrategy, symbols: string[]): string =>
  `${symbols.length > 1 ? `${symbols[0]} +${symbols.length - 1}` : (symbols[0] ?? '')} · ${STRATEGY_RO[strategy]}`.slice(0, 60);

// ---------------- API ----------------

export interface BotAccountView {
  id: number;
  label: string;
  exchange: string;
  env: string;
}

export interface BotView {
  id: number;
  name: string;
  strategy: BotStrategy;
  exec: BotExec;
  market: BotMarket;
  area: BotArea;
  symbols: string[];
  tf: Timeframe;
  /** The account (real); null in a simulation, or when the account is gone. */
  account: BotAccountView | null;
  status: BotStatus;
  statusReason: string | null;
  startsAt: number;
  endsAt: number | null;
  currency: string;
  maxAmount: number;
  /** What the bot has in play now (margin on futures). */
  committed: number;
  realized: number;
  /** At the prices the engine last read; null when a price is missing. */
  unrealized: number | null;
  trades: number;
  wins: number;
  openPositions: number;
  createdAt: number;
  ranAt: number | null;
}

export interface BotPositionView {
  symbol: string;
  side: BotSide;
  qty: number;
  entry: number;
  price: number | null;
  sl: number | null;
  tp: number | null;
  unrealized: number | null;
  leverage: number;
  margin: number;
  openedAt: number;
}

export interface BotTradeRow {
  id: number;
  symbol: string;
  side: BotSide;
  qty: number;
  entry: number;
  exit: number;
  pnl: number;
  fees: number;
  openedAt: number;
  closedAt: number;
  reason: BotTradeReason;
}

export interface ScorePart {
  key: WeightKey;
  /**
   * What was read: an index (0–100), or for Slingshot the last break of the market structure (+1 up, −1 down, 0 none;
   * before FD-BOTDIR +1 with the trade, −1 against); null when there was no data.
   */
  value: number | null;
  /** FD-BOTDIR: where it leans the market, −1 (down: a short's side) … +1 (up: a long's); before it, the agreement with the trade. */
  a: number;
  weight: number;
  /** What the value means, in Romanian („pozitiv”, „ultima rupere în sus”). */
  note: string;
}

export interface BotScore {
  /** FD-BOTDIR: the market's score, 0–100, 50 neutral (high favours longs, low shorts); before it, the trade's. */
  score: number;
  /** FD-BOTDIR: the side's threshold (a long from it up, a short from it down); absent on the events before it. */
  limit?: { side: BotSide; value: number };
  /** Before FD-BOTDIR: the one minimum of the trade's score, for either side. */
  min?: number;
  parts: ScorePart[];
}

export interface BotAiVerdict {
  decision: 'enter' | 'skip';
  confidence: number;
  reason: string;
  risks: string[];
}

export interface BotEventDetail {
  side?: BotSide;
  price?: number;
  sl?: number;
  tp?: number;
  score?: BotScore;
  ai?: BotAiVerdict;
  qty?: number;
  leverage?: number;
  pnl?: number;
}

export interface BotEventRow {
  id: number;
  at: number;
  kind: BotEventKind;
  symbol: string | null;
  message: string;
  detail: BotEventDetail | null;
}

export interface BotGridView {
  lines: number[];
  qty: number;
  /** Waiting for its start price. */
  armed: boolean;
  trigger: number | null;
  slots: { side: BotSide; entry: number | null }[];
}

export interface BotDcaView {
  cycle: number;
  cooldownUntil: number | null;
  deal: {
    side: BotSide;
    basePrice: number;
    avg: number;
    qty: number;
    filled: number;
    tp: number;
    sl: number | null;
    next: { k: number; price: number; amount: number }[];
  } | null;
}

export interface BotDetail extends BotView {
  input: BotInput;
  positions: BotPositionView[];
  grid: BotGridView | null;
  dca: BotDcaView | null;
  /** The closed trades, newest first. */
  history: BotTradeRow[];
  events: BotEventRow[];
}

/** The form's summary (POST /api/bots/check). */
export interface BotCheck {
  price: number | null;
  capital: number;
  errors: string[];
  warnings: string[];
  summary: string[];
  grid: GridPlan | null;
  dca: DcaPricedOrder[] | null;
}
