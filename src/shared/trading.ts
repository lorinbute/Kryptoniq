// Trading from Sentiq (FD-TRADING, TD-TRADING §2): what each platform can do through its API, the order form both the
// server and the page validate, and the shapes the trading routes answer with. Shared by the server and the web.
import { z } from 'zod';
import type { ProviderId } from './providers.ts';

export type TradeMarket = 'spot' | 'futures' | 'stock';
export type OrderSide = 'buy' | 'sell';
/** `mit` (market-if-touched) and `limit_ioc` (an immediate limit) are eToro's. */
export type OrderKind = 'market' | 'limit' | 'stop' | 'stop_limit' | 'mit' | 'limit_ioc';
export type TimeInForce = 'gtc' | 'day';
export type MarginMode = 'cross' | 'isolated';

/** The order form's choices kept per account (FD-TICKETMEMORY): everything but the symbol, the amount and the prices. */
export const ticketPrefsSchema = z
  .object({
    market: z.enum(['spot', 'futures', 'stock']).optional(),
    side: z.enum(['buy', 'sell']).optional(),
    kind: z.enum(['market', 'limit', 'stop', 'stop_limit', 'mit', 'limit_ioc']).optional(),
    amountIn: z.enum(['base', 'quote']).optional(),
    tif: z.enum(['gtc', 'day']).optional(),
    leverage: z.number().int().min(1).max(125).optional(),
    marginMode: z.enum(['cross', 'isolated']).optional(),
    reduceOnly: z.boolean().optional(),
    extendedHours: z.boolean().optional(),
  })
  .strict();
export type TicketPrefs = z.infer<typeof ticketPrefsSchema>;
const ACCOUNT_KEY_RE = /^\d{1,9}$/;
const accountId = z.number().int().positive();
/** An object keyed by account: a patch of one field merges into the account's entry (the settings merge objects). */
export const orderTicketMemorySchema = z
  .object({
    /** The account picked last, for a coin and for a share (the chart's "Tranzacționează"). */
    lastAccount: z.object({ crypto: accountId.optional(), stocks: accountId.optional() }).strict().prefault({}),
    accounts: z
      .record(z.string().regex(ACCOUNT_KEY_RE), ticketPrefsSchema)
      .refine((r) => Object.keys(r).length <= 200, 'cel mult 200 de conturi')
      .prefault({}),
  })
  .strict();
export type OrderTicketMemory = z.infer<typeof orderTicketMemorySchema>;

/** What a stored memory keeps when it no longer parses whole: the valid account and the valid entries, up to 200. */
export function salvageOrderTicket(stored: unknown): OrderTicketMemory {
  const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  const last = obj(obj(stored).lastAccount);
  const lastAccount: OrderTicketMemory['lastAccount'] = {};
  for (const k of ['crypto', 'stocks'] as const) if (accountId.safeParse(last[k]).success) lastAccount[k] = last[k] as number;
  const accounts: OrderTicketMemory['accounts'] = {};
  for (const [k, v] of Object.entries(obj(obj(stored).accounts))) {
    const r = ticketPrefsSchema.safeParse(v);
    if (ACCOUNT_KEY_RE.test(k) && r.success && Object.keys(accounts).length < 200) accounts[k] = r.data;
  }
  return { lastAccount, accounts };
}

export const ORDER_KIND_RO: Record<OrderKind, string> = {
  market: 'La piață',
  limit: 'Limită',
  stop: 'Stop',
  stop_limit: 'Stop-limită',
  mit: 'La un preț țintă (market-if-touched)',
  limit_ioc: 'Limită imediată',
};

export interface PlatformTrading {
  supported: boolean;
  /** Why not (shown instead of the switch). */
  reason?: string;
  markets: TradeMarket[];
  kinds: Partial<Record<TradeMarket, OrderKind[]>>;
  /** How the amount may be given: in the asset (`base`) or as a value (`quote`, e.g. USDT / USD). */
  amountIn: ('base' | 'quote')[];
  tif: TimeInForce[];
  futures?: {
    /** null: the account's own margin mode is used (Bybit's unified account sets it account-wide). */
    marginModes: MarginMode[] | null;
    /** TP / SL with the entry (`attached`), sent right after a market entry (`after-market`), or not offered. */
    tpsl: 'attached' | 'after-market' | 'none';
    maxLeverage: number;
  };
  /** eToro: leverage and SL / TP on any position, short selling. */
  etoro?: true;
  /** Alpaca: TP / SL as a bracket order (whole shares), extended hours (limit orders). */
  alpaca?: true;
  /** How to make a key that can trade but never withdraw, step by step. */
  tradeSteps: string[];
}

const CRYPTO_SPOT: OrderKind[] = ['market', 'limit', 'stop', 'stop_limit'];
const NO_WITHDRAW = 'Nu bifa niciodată retrageri (Withdraw) sau transferuri: Sentiq refuză cheile care le permit.';

export const TRADING: Record<ProviderId, PlatformTrading> = {
  kucoin: {
    supported: true,
    markets: ['spot', 'futures'],
    kinds: { spot: CRYPTO_SPOT, futures: CRYPTO_SPOT },
    amountIn: ['base', 'quote'],
    tif: ['gtc'],
    futures: { marginModes: ['isolated', 'cross'], tpsl: 'attached', maxLeverage: 125 },
    tradeSteps: [
      'Pe KuCoin: Profil → API Management → Create API (sau editează cheia).',
      'Pe lângă „General”, bifează „Spot” (tranzacționare spot) și / sau „Futures”.',
      NO_WITHDRAW,
      'Recomandat: restricționează cheia la IP-urile serverului Sentiq (lista din pașii de mai sus).',
    ],
  },
  binance: {
    supported: true,
    markets: ['spot', 'futures'],
    // Binance spot has no stop-market order.
    kinds: { spot: ['market', 'limit', 'stop_limit'], futures: CRYPTO_SPOT },
    amountIn: ['base', 'quote'],
    tif: ['gtc'],
    futures: { marginModes: ['cross', 'isolated'], tpsl: 'after-market', maxLeverage: 125 },
    tradeSteps: [
      'Pe Binance: Profil → API Management → Edit restrictions.',
      'Bifează „Enable Spot & Margin Trading” și / sau „Enable Futures”.',
      'Binance cere restricția pe IP pentru tranzacționare: pune IP-urile serverului Sentiq (lista din pașii de mai sus).',
      NO_WITHDRAW,
    ],
  },
  bybit: {
    supported: true,
    markets: ['spot', 'futures'],
    kinds: { spot: CRYPTO_SPOT, futures: CRYPTO_SPOT },
    amountIn: ['base', 'quote'],
    tif: ['gtc'],
    futures: { marginModes: null, tpsl: 'attached', maxLeverage: 100 },
    tradeSteps: [
      'Pe Bybit: Profil → API → editează cheia (sau Create New Key) → „Read-Write”.',
      'Bifează „Spot → Trade” și / sau „Contracts → Orders, Positions”.',
      NO_WITHDRAW,
      'Modul de marjă (cross / isolated) se alege din Bybit: Sentiq nu-l schimbă. Modul pozițiilor (one-way / hedge) îl citește Sentiq.',
    ],
  },
  okx: {
    supported: true,
    markets: ['spot', 'futures'],
    kinds: { spot: CRYPTO_SPOT, futures: CRYPTO_SPOT },
    amountIn: ['base', 'quote'],
    tif: ['gtc'],
    futures: { marginModes: ['cross', 'isolated'], tpsl: 'attached', maxLeverage: 100 },
    tradeSteps: ['Pe OKX: Profil → API → editează cheia (sau Create API key).', 'Bifează „Trade”, pe lângă „Read”.', NO_WITHDRAW],
  },
  kraken: {
    supported: true,
    markets: ['spot'],
    kinds: { spot: CRYPTO_SPOT },
    amountIn: ['base', 'quote'],
    tif: ['gtc'],
    tradeSteps: [
      'Pe Kraken: Settings → API → editează cheia (sau Create API key).',
      'Bifează „Create & Modify Orders” și „Cancel & Close Orders”, pe lângă permisiunile de citire.',
      'Nu bifa „Withdraw Funds” sau „Deposit Funds”. Kraken nu spune permisiunile cheii, deci Sentiq nu le poate verifica.',
    ],
  },
  coinbase: {
    supported: true,
    markets: ['spot'],
    // Coinbase has no stop-market order.
    kinds: { spot: ['market', 'limit', 'stop_limit'] },
    amountIn: ['base', 'quote'],
    tif: ['gtc'],
    tradeSteps: ['Coinbase Developer Platform → API Keys → editează cheia (sau creează una nouă).', 'Permisiuni: „View” și „Trade”.', 'Nu bifa „Transfer”: Sentiq refuză cheile care pot muta fonduri.'],
  },
  bitget: {
    supported: true,
    markets: ['spot', 'futures'],
    kinds: { spot: CRYPTO_SPOT, futures: CRYPTO_SPOT },
    amountIn: ['base', 'quote'],
    tif: ['gtc'],
    futures: { marginModes: ['cross', 'isolated'], tpsl: 'attached', maxLeverage: 125 },
    tradeSteps: ['Pe Bitget: Profil → API Management → editează cheia (sau Create API).', 'Permisiuni: „Read-write”, cu „Trade” (spot și / sau futures).', NO_WITHDRAW],
  },
  trading212: {
    supported: true,
    markets: ['stock'],
    kinds: { stock: ['market', 'limit', 'stop', 'stop_limit'] },
    amountIn: ['base'],
    tif: ['day', 'gtc'],
    tradeSteps: [
      'În Trading 212: Settings → API (Beta) → generează o cheie nouă (permisiunile nu se pot schimba după).',
      'Bifează, pe lângă citire, „Orders: Execute”.',
      'Restricționează cheia la IP-urile serverului Sentiq (lista din pașii de mai sus). Cheia nouă se adaugă în Sentiq ca un cont nou.',
    ],
  },
  etoro: {
    supported: true,
    markets: ['stock'],
    kinds: { stock: ['market', 'mit', 'limit_ioc'] },
    amountIn: ['base', 'quote'],
    tif: ['gtc'],
    etoro: true,
    tradeSteps: [
      'Pe eToro: Settings → Trading → API Key Management → Create New Key.',
      'Alege mediul (Real sau Demo) și permisiunea „Write”.',
      'Cheia nouă se adaugă în Sentiq ca un cont nou (eToro nu schimbă permisiunea unei chei).',
    ],
  },
  ibkr: {
    supported: false,
    reason:
      'Interactive Brokers nu primește ordine prin raportul Flex pe care îl citește Sentiq. Ordinele cer Client Portal Gateway (un program pornit local, cu login zilnic din browser) sau OAuth (o înregistrare separată la IBKR).',
    markets: [],
    kinds: {},
    amountIn: [],
    tif: [],
    tradeSteps: [],
  },
  alpaca: {
    supported: true,
    markets: ['stock'],
    kinds: { stock: ['market', 'limit', 'stop', 'stop_limit'] },
    amountIn: ['base', 'quote'],
    tif: ['day', 'gtc'],
    alpaca: true,
    tradeSteps: ['Cheile Alpaca pot tranzacționa întotdeauna: nu e nimic de schimbat la cheie.', 'Pe un cont Paper ordinele sunt de test; pe Live sunt reale.'],
  },
};

const positive = (label: string) => z.number({ error: `${label}: lipsește` }).finite().positive(`${label} trebuie să fie pozitiv`);

/** The order form (TD-TRADING §2): the same rules on the page and on the server. */
export const orderTicketSchema = z
  .object({
    accountId: z.number().int().positive(),
    /** One per form: the same order sent twice (a double click, a retry) is placed once. */
    idemKey: z.string().uuid('Identificatorul formularului lipsește'),
    market: z.enum(['spot', 'futures', 'stock']),
    symbol: z.string().trim().min(1, 'Simbolul lipsește').max(40),
    side: z.enum(['buy', 'sell']),
    kind: z.enum(['market', 'limit', 'stop', 'stop_limit', 'mit', 'limit_ioc']),
    amount: positive('Cantitatea'),
    amountIn: z.enum(['base', 'quote']).default('base'),
    price: positive('Prețul').optional(),
    triggerPrice: positive('Prețul de declanșare').optional(),
    tif: z.enum(['gtc', 'day']).optional(),
    leverage: z.number().int().min(1).max(125).optional(),
    marginMode: z.enum(['cross', 'isolated']).optional(),
    reduceOnly: z.boolean().optional(),
    takeProfit: positive('Take profit').optional(),
    stopLoss: positive('Stop loss').optional(),
    extendedHours: z.boolean().optional(),
    /** Closing given positions (eToro: by position id, all or `units` of them). */
    close: z.object({ positionIds: z.array(z.string().min(1).max(40)).min(1).max(50), units: positive('Unitățile').optional() }).optional(),
  })
  .superRefine((t, ctx) => {
    const need = (ok: boolean, path: string, message: string) => {
      if (!ok) ctx.addIssue({ code: 'custom', path: [path], message });
    };
    need(!['limit', 'stop_limit', 'limit_ioc'].includes(t.kind) || t.price !== undefined, 'price', 'Prețul limită lipsește');
    need(!['stop', 'stop_limit', 'mit'].includes(t.kind) || t.triggerPrice !== undefined, 'triggerPrice', 'Prețul de declanșare lipsește');
    need(t.market === 'futures' || (t.marginMode === undefined && t.reduceOnly !== true), 'marginMode', 'Marja și reduce-only sunt doar pentru futures');
    need(t.leverage === undefined || t.market !== 'spot', 'leverage', 'Levierul nu se aplică pe spot');
  });
export type OrderTicket = z.infer<typeof orderTicketSchema>;

// ---------------- FD-ORDEREDIT: changing an open order, or a position's stop loss / take profit ----------------

/**
 * One change. `sl` / `tp`: a position's protection, an existing order (`orderId`) or a new one (`orderId` null); a null
 * `level` removes it. `order`: an open order's price, trigger, amount or attached TP / SL (null removes an attached one).
 */
export const modifyChangeSchema = z.discriminatedUnion('what', [
  z
    .object({
      what: z.enum(['sl', 'tp']),
      orderId: z.string().trim().min(1).max(120).nullable(),
      level: positive('Nivelul').nullable(),
    })
    .strict(),
  z
    .object({
      what: z.literal('order'),
      orderId: z.string().trim().min(1).max(120),
      /** A stop / trigger order (several platforms keep them apart). */
      trigger: z.boolean(),
      price: positive('Prețul').optional(),
      triggerPrice: positive('Prețul de declanșare').optional(),
      amount: positive('Cantitatea').optional(),
      takeProfit: positive('Take profit').nullable().optional(),
      stopLoss: positive('Stop loss').nullable().optional(),
    })
    .strict(),
]);
export type ModifyChange = z.infer<typeof modifyChangeSchema>;

export const modifyTicketSchema = z
  .object({
    accountId: z.number().int().positive(),
    /** One per form: the same changes sent twice go out once. */
    idemKey: z.string().uuid('Identificatorul formularului lipsește'),
    market: z.enum(['spot', 'futures', 'stock']),
    symbol: z.string().trim().min(1, 'Simbolul lipsește').max(60),
    /** The position whose stop loss / take profit change (`ref`: eToro's position id). */
    position: z.object({ side: z.enum(['long', 'short']), ref: z.string().trim().min(1).max(40).optional() }).strict().optional(),
    changes: z.array(modifyChangeSchema).min(1, 'Nicio schimbare').max(4, 'Cel mult 4 schimbări odată'),
  })
  .strict()
  .superRefine((t, ctx) => {
    const protection = t.changes.filter((c) => c.what !== 'order');
    if (protection.length && !t.position) ctx.addIssue({ code: 'custom', path: ['position'], message: 'Poziția lipsește' });
    // An addition (no order yet) needs a level; a removal needs the order (or the eToro position) it removes.
    for (const [i, c] of t.changes.entries()) {
      if (c.what === 'order') continue;
      if (c.orderId === null && c.level === null) ctx.addIssue({ code: 'custom', path: ['changes', i, 'level'], message: 'Nivelul lipsește' });
    }
    // One change per order and value: an order with both levels (OKX's oco) may have its stop loss and take profit changed.
    const keys = t.changes.flatMap((c) => (c.orderId ? [`${c.what}:${c.orderId}`] : []));
    const whole = new Set(t.changes.flatMap((c) => (c.what === 'order' ? [c.orderId] : [])));
    if (new Set(keys).size !== keys.length || t.changes.some((c) => c.what !== 'order' && c.orderId !== null && whole.has(c.orderId))) {
      ctx.addIssue({ code: 'custom', path: ['changes'], message: 'Același ordin de două ori' });
    }
    if (protection.filter((c) => c.what === 'sl' && c.orderId === null).length > 1 || protection.filter((c) => c.what === 'tp' && c.orderId === null).length > 1) {
      ctx.addIssue({ code: 'custom', path: ['changes'], message: 'Un singur SL și un singur TP nou' });
    }
  });
export type ModifyTicket = z.infer<typeof modifyTicketSchema>;

/**
 * How a change goes out (FD-ORDEREDIT): `amend` the order in place, `position` (a position-level TP / SL: Bybit
 * trading-stop, eToro), `place` a new order, `cancel` one, or a replacement: the new order first (an order that only
 * closes: never unprotected) or the old one cancelled first (one that holds funds or could double an entry).
 */
export type ModifyHow = 'amend' | 'position' | 'place' | 'cancel' | 'place-then-cancel' | 'cancel-then-place';

export interface ModifyValues {
  price: number | null;
  triggerPrice: number | null;
  amount: number | null;
  takeProfit: number | null;
  stopLoss: number | null;
}

export interface ModifyStepPlan {
  /** Index in the ticket's changes. */
  change: number;
  how: ModifyHow;
  /** The order changed (null: a new one). */
  orderId: string | null;
  /** The order's or the position's side and kind, for the confirmation. */
  side: OrderSide | null;
  kind: string | null;
  before: ModifyValues;
  /** Rounded as it will be sent; null where the change removes. */
  after: ModifyValues;
  /** The level removed (`sl` / `tp` null) or the amount the new protective order takes. */
  removes: boolean;
}

/** The changes as they would go out (POST /api/trading/:id/modify/preview). */
export interface ModifyPreview {
  ticket: ModifyTicket;
  displaySymbol: string;
  last: number | null;
  currency: string;
  env: string;
  steps: ModifyStepPlan[];
  warnings: string[];
  errors: string[];
}

export interface ModifyStepResult {
  change: number;
  /** What this request did: "modificat", "ordin nou plasat", "ordin vechi anulat"... */
  what: string;
  ok: boolean;
  orderId: string | null;
  message: string | null;
  /** The order this step took off the platform (cancelled, or replaced under a new id): no longer shown (FIX-SLTPDUP). */
  cancelled?: string;
}

/** What happened (POST /api/trading/:id/modify). */
export interface ModifyResult {
  status: 'done' | 'partial' | 'failed' | 'unknown';
  steps: ModifyStepResult[];
}

// ---------------- FD-REVERSE: a futures position turned the other way (TradingView's ⇅) ----------------

/** The position to turn: its symbol and side (hedge mode keeps a long and a short apart). */
export const reverseTicketSchema = z
  .object({
    accountId: z.number().int().positive(),
    /** One per confirmation: the same reversal sent twice goes out once. */
    idemKey: z.string().uuid('Identificatorul formularului lipsește'),
    symbol: z.string().trim().min(1, 'Simbolul lipsește').max(60),
    side: z.enum(['long', 'short']),
  })
  .strict();
export type ReverseTicket = z.infer<typeof reverseTicketSchema>;

/** What a reversal does, checked (POST /api/trading/:id/reverse/preview): nothing is sent. */
export interface ReversePreview {
  ticket: ReverseTicket;
  displaySymbol: string;
  base: string;
  /** The position now, and the one it becomes (the same size, the other way). */
  from: { side: 'long' | 'short'; amount: number };
  to: { side: 'long' | 'short'; amount: number };
  leverage: number | null;
  marginMode: string | null;
  last: number | null;
  /** The position's stop loss / take profit orders, cancelled once it is turned. */
  cancels: number;
  hedged: boolean;
  warnings: string[];
  errors: string[];
  env: string;
}

/**
 * A derived form key for the n-th order of one action (each order its own client id, the whole still sent once): the
 * key with its last byte changed.
 */
export function subKey(idemKey: string, n: number): string {
  const last = parseInt(idemKey.slice(-2), 16);
  return `${idemKey.slice(0, -2)}${((last + n) % 256).toString(16).padStart(2, '0')}`;
}

/** An open order, as much as deciding how it can change needs. */
export interface EditableOrderLike {
  id: string;
  market: 'spot' | 'futures';
  type: string;
  price: number | null;
  triggerPrice: number | null;
  reduceOnly: boolean;
  cancellable?: boolean;
}

/**
 * How an open order can change on its platform (FD-ORDEREDIT's table): in place (`amend`), only by a replacement, or not
 * at all. eToro's rows `sl-<id>` / `tp-<id>` are a position's stop loss / take profit (changed in place).
 */
export function orderEditMode(exchange: string, o: EditableOrderLike): 'amend' | 'replace' | null {
  const limit = o.type === 'limit' && o.triggerPrice === null;
  switch (exchange) {
    case 'bybit':
    case 'okx':
    case 'kraken':
    case 'alpaca':
      return 'amend';
    case 'binance':
      // Futures: only a limit order is modified in place; spot: cancel-replace in one request.
      return o.market === 'spot' || limit ? 'amend' : 'replace';
    case 'coinbase':
      return limit ? 'amend' : 'replace';
    case 'etoro':
      // A position's stop loss / take profit changes in place; a pending order is cancelled and placed again by hand.
      return o.cancellable === false && /^(sl|tp)-/.test(o.id) ? 'amend' : null;
    case 'kucoin':
    case 'bitget':
    case 'trading212':
      return 'replace';
    default:
      return null;
  }
}

/**
 * The fields an order's form offers (FD-ORDEREDIT): only what its kind has, and TP / SL on an entry where the platform
 * attaches them. (eToro's `sl-` / `tp-` rows are changed through their position's form.)
 */
export function orderEditFields(exchange: string, o: EditableOrderLike & { stopLoss?: number | null; takeProfit?: number | null }): { price: boolean; triggerPrice: boolean; amount: boolean; tpsl: boolean } {
  const tpslAttached = o.market === 'futures' && !o.reduceOnly && TRADING[exchange as ProviderId]?.futures?.tpsl === 'attached';
  return {
    price: o.price !== null,
    triggerPrice: o.triggerPrice !== null,
    amount: true,
    // An order that only closes is itself a stop loss / take profit (some platforms repeat its level as one).
    tpsl: !o.reduceOnly && (tpslAttached || o.stopLoss != null || o.takeProfit != null),
  };
}

/** eToro's rows standing for a position's stop loss / take profit (`sl-<positionId>` / `tp-<positionId>`). */
export const etoroProtectionOf = (o: Pick<EditableOrderLike, 'id' | 'cancellable'>): { what: 'sl' | 'tp'; positionId: string } | null => {
  const m = o.cancellable === false ? /^(sl|tp)-(.+)$/.exec(o.id) : null;
  return m ? { what: m[1] as 'sl' | 'tp', positionId: m[2] as string } : null;
};

/** What an account can trade now (GET /api/trading). */
export interface TradingCaps {
  accountId: number;
  exchange: string;
  label: string;
  env: string;
  kind: 'crypto' | 'stocks';
  supported: boolean;
  enabled: boolean;
  /** What trading was switched on for (the key's rights then): a subset of the platform's markets. */
  markets: TradeMarket[];
  reason: string | null;
}

/** One symbol of a crypto market, for the picker. */
export interface TradeSymbol {
  symbol: string;
  base: string;
  quote: string;
}

/** What the form needs about the chosen instrument (GET /api/trading/:id/instrument). */
export interface InstrumentInfo {
  market: TradeMarket;
  symbol: string;
  /** The platform's own name for it, when it differs (AAPL_US_EQ, an eToro instrument id). */
  ref: string | null;
  name: string | null;
  currency: string;
  base: string;
  last: number | null;
  /** Steps and minimums, in the asset (contracts converted). null: not known. */
  amountStep: number | null;
  minAmount: number | null;
  minCost: number | null;
  priceStep: number | null;
  /** Futures: one contract in the asset (KuCoin 0.001 BTC, OKX 0.01 BTC). */
  contractSize: number | null;
  maxLeverage: number | null;
  /** Free quote (cash / USDT) and free asset (spot). */
  availableQuote: number | null;
  availableBase: number | null;
  /** Futures / leveraged: the open position on this symbol (null in hedge mode: see `hedgePositions`). */
  position: HeldPosition | null;
  /** eToro: each open position on the instrument, to pick the ones to close (FD-ETOROPICK). */
  positions?: ClosablePosition[];
  /** Futures: the account's position mode (Bybit: the pair's), when it could be read; eToro: `hedge` with both sides held (FD-KUCOINHEDGE, FD-HEDGEALL). */
  positionMode?: PositionMode;
  /** Hedge mode: the long and the short kept apart on this instrument (either may be missing). */
  hedgePositions?: { long: HeldPosition | null; short: HeldPosition | null };
}

/** One way: one position per symbol; hedge: a long and a short side by side (FD-KUCOINHEDGE, FD-HEDGEALL). */
export type PositionMode = 'one-way' | 'hedge';

/** An open futures / leveraged position, in the asset. */
export interface HeldPosition {
  side: 'long' | 'short';
  amount: number;
  entryPrice: number | null;
}

/** One eToro position: its units, entry, when it opened, its unrealized P/L and what was put in (USD). */
export interface ClosablePosition {
  id: string;
  units: number;
  openRate: number | null;
  /** ms */
  openedAt: number | null;
  pnl: number | null;
  invested: number | null;
  isBuy: boolean;
  leverage: number;
}

/** The order as it would leave, rounded and checked (POST /api/trading/:id/preview). */
export interface OrderPreview {
  ticket: OrderTicket;
  displaySymbol: string;
  /** In the asset (shares, BTC), after rounding. */
  amount: number;
  /** Futures: the same amount in the platform's contracts / lots. */
  contracts: number | null;
  price: number | null;
  triggerPrice: number | null;
  last: number | null;
  /** Estimated value at the order or current price, in `currency`. */
  value: number | null;
  /** Futures / leveraged: value ÷ leverage. */
  margin: number | null;
  available: number | null;
  currency: string;
  env: string;
  /** Futures: the position mode the order goes out in (FD-KUCOINHEDGE, FD-HEDGEALL). */
  positionMode?: PositionMode;
  warnings: string[];
  /** Blocking problems: the order cannot be confirmed. */
  errors: string[];
}

export interface OrderFollowUp {
  what: 'take-profit' | 'stop-loss';
  ok: boolean;
  orderId: string | null;
  message: string | null;
}

/** What happened (POST /api/trading/:id/orders and /cancel). */
export interface OrderResult {
  status: 'sent' | 'filled' | 'open' | 'pending' | 'cancelled' | 'rejected' | 'unknown';
  orderId: string | null;
  message: string | null;
  followUps: OrderFollowUp[];
}

/** One line of "Ordinele trimise din Sentiq". */
export interface TradeLogRow {
  id: number;
  accountId: number | null;
  exchange: string;
  env: string;
  accountLabel: string;
  action: 'order' | 'cancel' | 'modify' | 'reverse' | 'enable' | 'disable';
  market: string | null;
  symbol: string | null;
  side: string | null;
  kind: string | null;
  amount: number | null;
  price: number | null;
  triggerPrice: number | null;
  leverage: number | null;
  status: 'pending' | 'sent' | 'rejected' | 'error' | 'unknown';
  orderId: string | null;
  message: string | null;
  createdAt: number;
}

/** A demo / paper / practice account: its orders are not real. */
export const isDemoEnv = (env: string) => env === 'demo' || env === 'paper';
