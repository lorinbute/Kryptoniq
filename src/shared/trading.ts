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
      'Modul de marjă (cross / isolated) și modul one-way se aleg din Bybit: Sentiq nu le schimbă.',
    ],
  },
  okx: {
    supported: true,
    markets: ['spot', 'futures'],
    kinds: { spot: CRYPTO_SPOT, futures: CRYPTO_SPOT },
    amountIn: ['base', 'quote'],
    tif: ['gtc'],
    futures: { marginModes: ['cross', 'isolated'], tpsl: 'attached', maxLeverage: 100 },
    tradeSteps: ['Pe OKX: Profil → API → editează cheia (sau Create API key).', 'Bifează „Trade”, pe lângă „Read”.', NO_WITHDRAW, 'Pentru futures, contul trebuie să fie în modul „net” (one-way).'],
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
  /** Futures / leveraged: the open position on this symbol. */
  position: { side: 'long' | 'short'; amount: number; entryPrice: number | null } | null;
  /** eToro: each open position on the instrument, to pick the ones to close (FD-ETOROPICK). */
  positions?: ClosablePosition[];
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
  action: 'order' | 'cancel' | 'enable' | 'disable';
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
