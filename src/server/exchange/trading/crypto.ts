// Orders on the crypto exchanges through ccxt (FD-TRADING, TD-TRADING §3): spot on all seven, USDT perpetuals on
// KuCoin, Binance, Bybit, OKX and Bitget. ccxt builds each exchange's request; this file chooses the client, rounds
// and checks the order, sets leverage / margin where the exchange wants it before the order, and maps the errors.
// Nothing here is retried: an order sent twice could be filled twice.
import ccxt, { type Exchange, type MarketInterface as Market, type Order } from 'ccxt';
import { providerById } from '../../../shared/providers.ts';
import {
  orderEditMode,
  TRADING,
  type HeldPosition,
  type InstrumentInfo,
  type ModifyHow,
  type ModifyPreview,
  type ModifyResult,
  type ModifyStepPlan,
  type ModifyStepResult,
  type ModifyTicket,
  type ModifyValues,
  type OrderFollowUp,
  type OrderPreview,
  type OrderResult,
  type OrderTicket,
  type ReversePreview,
  type ReverseTicket,
  subKey,
  type TradeMarket,
  type TradeSymbol,
} from '../../../shared/trading.ts';
import type { Logger } from '../../log.ts';
import { FUTURES_BALANCE, orderPositionSide, positionSideOf, stopDirection, type ExchangeClients } from '../accounts.ts';
import { clientIdOf, commonChecks, fmtPlain, modifyStatus, protectionChecks, TradingError, UNKNOWN_OUTCOME_MESSAGE, type CancelInput, type ModifyPlan, type ReversePlan, type Trader } from './types.ts';

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const QUOTE_ORDER = ['USDT', 'USDC', 'USD', 'EUR', 'BTC'];
const POSITION_MODE_TTL_MS = 10 * 60_000;

/**
 * FD-ORDEREDIT: the listings an order on a symbol may be in, besides the plain one (its kind is not known yet): stop
 * orders, and OKX's / Bitget's TP / SL orders, which are of kinds of their own.
 */
const MODIFY_READS: Record<string, { spot: Record<string, unknown>[]; futures: Record<string, unknown>[] }> = {
  // Both TP / SL kinds in one read, sent to the algo listing by name (ccxt routes only a single kind there by itself).
  okx: {
    spot: [{}, { trigger: true }, { method: 'privateGetTradeOrdersAlgoPending', ordType: 'conditional,oco' }],
    futures: [{}, { trigger: true }, { method: 'privateGetTradeOrdersAlgoPending', ordType: 'conditional,oco' }],
  },
  bitget: { spot: [{}, { trigger: true }], futures: [{}, { trigger: true }, { planType: 'profit_loss' }] },
  // A unified account lists every kind of order (stops and TP / SL included) in one.
  bybit: { spot: [{}], futures: [{}] },
  kraken: { spot: [{}], futures: [] },
  coinbase: { spot: [{}], futures: [] },
};
const DEFAULT_MODIFY_READS = { spot: [{}, { trigger: true }], futures: [{}, { trigger: true }] };
/** Bybit's TP / SL of a whole position: moved (or removed with 0) through trading-stop, not as orders. */
const BYBIT_POSITION_TPSL = new Set(['TakeProfit', 'StopLoss']);
/** Bitget's TP / SL orders: cancelled as "profit_loss" plans. */
const BITGET_TPSL_PLANS = new Set(['profit_plan', 'loss_plan', 'pos_profit', 'pos_loss', 'moving_plan']);

/** What the trader keeps between the check and the send (FD-ORDEREDIT): the orders as read, the position. */
interface ModifyInternal {
  symbol: string;
  market: TradeMarket;
  hedged: boolean;
  /** The position the protection belongs to (contracts, entry, margin mode). */
  position: { side: 'long' | 'short'; contracts: number; entry: number | null; marginMode: string | null } | null;
  steps: {
    plan: ModifyStepPlan;
    order: Order | null;
    role: 'sl' | 'tp' | null;
    leg: 'trigger' | 'price' | 'sl' | 'tp' | null;
    /** Which way the order's trigger fires (kept by a replacement): up (the price rising to it) or down. */
    dir: 'up' | 'down' | null;
    /** The margin mode a futures replacement goes out in (the order's, else its position's). */
    mode: 'cross' | 'isolated' | null;
  }[];
}

/** A margin mode as the exchanges write it ("ISOLATED", "crossed", "cross"). */
const marginModeOf = (v: unknown): 'cross' | 'isolated' | null => {
  const s = String(v ?? '').toLowerCase();
  return s.startsWith('cross') ? 'cross' : s.startsWith('isol') ? 'isolated' : null;
};
/**
 * Which way an open trigger order fires: as the exchange says (KuCoin's stop), else from where it stands: an order not
 * yet triggered waits above the price for a rise, below it for a fall.
 */
const triggerDirOf = (o: Order, trigger: number, last: number | null): 'up' | 'down' | null => stopDirection(o.info) ?? (last !== null && last > 0 && trigger !== last ? (trigger > last ? 'up' : 'down') : null);
/** A position's stop loss / take profit fires as such: a long's stop loss on a fall, its take profit on a rise. */
const protectionDir = (role: 'sl' | 'tp', closing: 'buy' | 'sell'): 'up' | 'down' => ((role === 'sl') === (closing === 'sell') ? 'down' : 'up');

const values = (v: Partial<ModifyValues> = {}): ModifyValues => ({ price: v.price ?? null, triggerPrice: v.triggerPrice ?? null, amount: v.amount ?? null, takeProfit: v.takeProfit ?? null, stopLoss: v.stopLoss ?? null });
const infoOf = (o: Order) => (o.info ?? {}) as Record<string, unknown>;

const KUCOIN_UTA_HEDGE =
  'Pe contul unificat KuCoin (UTA), API-ul KuCoin primește ordine futures doar în modul one-way. Schimbă modul pozițiilor în KuCoin (Futures → Preferințe → Mod poziție, fără poziții deschise), sau tranzacționează din aplicația KuCoin.';
const modeChanged = (name: string) => `Modul pozițiilor (one-way / hedge) s-a schimbat pe ${name}: ordinul n-a fost primit. Trimite-l din nou.`;
/**
 * An exchange's answer to an order sent in the other position mode (FD-HEDGEALL): KuCoin 330012 ("Your order is in
 * One-Way Mode, while…"), Binance -4061 ("Order's position side does not match user's setting"), Bybit ("position idx
 * not match position mode"), OKX (posSide), Bitget 40774 ("…for unilateral position…").
 */
const modeMismatch = (err: unknown) =>
  err instanceof ccxt.ExchangeError && /\b330012\b|-4061\b|\b40774\b|position\s*(idx|side)|\bposSide\b|unilateral position|one-?way mode|hedge mode/i.test(err.message);

/** A ccxt error, in the words the page shows (the exchange's own message kept). */
export function tradingErrorOf(err: unknown, sent: boolean): TradingError {
  if (err instanceof TradingError) return err;
  const raw = err instanceof Error ? err.message : String(err);
  // ccxt prefixes "<exchange> " and often the raw JSON: keep it short.
  const msg = raw.replace(/\s+/g, ' ').slice(0, 300);
  if (err instanceof ccxt.InsufficientFunds) return new TradingError('INSUFFICIENT', `Sold insuficient (${msg})`);
  // Binance's -2015 (no right for the action) comes as DDoSProtection once the key has worked: a permission, not a limit.
  const binanceDenied = err instanceof ccxt.DDoSProtection && /-2015\b/.test(raw);
  if (binanceDenied || err instanceof ccxt.PermissionDenied || err instanceof ccxt.AuthenticationError || err instanceof ccxt.AccountSuspended) {
    return new TradingError('PERMISSION', `Cheia nu are permisiunea de tranzacționare sau nu mai e validă (${msg})`);
  }
  if (err instanceof ccxt.OrderNotFound) return new TradingError('NOT_FOUND', 'Ordinul nu mai e deschis (poate s-a executat sau a fost anulat).');
  if (err instanceof ccxt.RateLimitExceeded || err instanceof ccxt.DDoSProtection) return new TradingError('RATE_LIMIT', `Exchange-ul limitează cererile acum; încearcă din nou peste un minut (${msg})`);
  if (err instanceof ccxt.InvalidOrder) return new TradingError('REJECTED', `Ordin refuzat de exchange: ${msg}`);
  if (err instanceof ccxt.RequestTimeout || err instanceof ccxt.NetworkError) {
    return sent ? new TradingError('UNKNOWN_OUTCOME', UNKNOWN_OUTCOME_MESSAGE) : new TradingError('REJECTED', `Exchange-ul nu răspunde acum (${msg})`);
  }
  // After sending, an answer that could not be read (or a failure outside ccxt's errors, while reading it) is not a
  // refusal either: the order may be on the book.
  if (sent && (err instanceof ccxt.BadResponse || !(err instanceof ccxt.BaseError))) return new TradingError('UNKNOWN_OUTCOME', UNKNOWN_OUTCOME_MESSAGE);
  // FD-HEDGEALL: hedge mode is traded everywhere now; a refusal about the position mode keeps the exchange's words.
  if (/position\s*(idx|side)|hedge|positionSide|posSide/i.test(raw)) {
    return new TradingError('HEDGE_MODE', `Exchange-ul a refuzat din cauza modului pozițiilor (one-way / hedge): ${msg}. Verifică modul pe exchange și încearcă din nou.`);
  }
  return new TradingError('REJECTED', `Exchange-ul a refuzat: ${msg}`);
}

/** "Already like that" answers to setting leverage or margin mode: not errors. */
const alreadySet = (err: unknown) => err instanceof ccxt.MarginModeAlreadySet || /not modified|no need to change|same|already/i.test(err instanceof Error ? err.message : '');

export class CcxtTrader implements Trader {
  private readonly exchange: string;
  private readonly clients: ExchangeClients;
  private readonly log: Logger;
  private readonly positionModes = new Map<string, { hedged: boolean; at: number }>();
  private uta: boolean | null = null;
  private bitget: { uta: boolean; hedged: boolean | null; at: number } | null = null;

  constructor(exchange: string, clients: ExchangeClients, log: Logger) {
    this.exchange = exchange;
    this.clients = clients;
    this.log = log;
  }

  private get platform() {
    return TRADING[this.exchange as keyof typeof TRADING];
  }

  /** KuCoin's unified account trades everything through the spot client; its classic one keeps futures apart. */
  private async isUta(): Promise<boolean> {
    if (this.exchange !== 'kucoin') return false;
    if (this.uta === null) {
      const fn = (this.clients.spot as unknown as { isUTAEnabled?: () => Promise<boolean> }).isUTAEnabled;
      try {
        this.uta = typeof fn === 'function' ? await fn.call(this.clients.spot) : false;
      } catch (err) {
        throw tradingErrorOf(err, false);
      }
    }
    return this.uta;
  }

  /**
   * Bitget's unified account (UTA) and its classic one take different requests. Read from the v3 settings, which only
   * a unified account answers and which also give the position mode; handed to ccxt so it routes the orders the same
   * way. A network failure is not taken for "classic" (ccxt would keep that guess).
   */
  private async bitgetMode(ex: Exchange): Promise<{ uta: boolean; hedged: boolean | null }> {
    if (this.bitget && Date.now() - this.bitget.at < POSITION_MODE_TTL_MS) return this.bitget;
    const fn = (ex as unknown as Record<string, (p?: object) => Promise<unknown>>).privateUtaGetV3AccountSettings;
    let uta = false;
    let hedged: boolean | null = null;
    if (fn) {
      let data: { accountMode?: string; holdMode?: string } | undefined;
      try {
        data = ((await fn.call(ex)) as { data?: { accountMode?: string; holdMode?: string } } | undefined)?.data;
      } catch (err) {
        if (err instanceof ccxt.NetworkError) throw tradingErrorOf(err, false);
        // Refused: a classic account (unless ccxt already found it unified, below).
      }
      if (data) {
        if (data.accountMode === 'upgrading' || data.accountMode === 'switching') {
          throw new TradingError('REJECTED', 'Contul Bitget își schimbă acum modul (unificat / clasic): încearcă după ce se termină.');
        }
        uta = true;
        hedged = data.holdMode === 'hedge_mode' ? true : data.holdMode === 'one_way_mode' ? false : null;
      } else if ((ex.options as Record<string, unknown> | undefined)?.uta === true) {
        // Our read refused, but ccxt already found the account unified (its own check): kept, the mode left unknown.
        uta = true;
      }
    }
    if (ex.options) (ex.options as Record<string, unknown>).uta = uta;
    this.bitget = { uta, hedged, at: Date.now() };
    return this.bitget;
  }

  private async client(market: TradeMarket): Promise<Exchange> {
    if (market === 'futures' && this.exchange === 'kucoin' && this.clients.futures && !(await this.isUta())) return this.clients.futures;
    // (A classic KuCoin account moved to "high-frequency" trading: ccxt reads that while loading the markets with the
    // key, and then sends the spot orders to the right endpoints.)
    return this.clients.spot;
  }

  private async withMarkets(market: TradeMarket): Promise<Exchange> {
    if (market === 'stock') throw new TradingError('UNSUPPORTED', 'Un exchange crypto nu are acțiuni.');
    if (!this.platform.markets.includes(market)) throw new TradingError('UNSUPPORTED', `${market === 'futures' ? 'Futures' : 'Spot'} nu se poate tranzacționa pe acest exchange din Sentiq.`);
    const ex = await this.client(market);
    if (!ex.markets) {
      try {
        await ex.loadMarkets();
      } catch (err) {
        throw tradingErrorOf(err, false);
      }
    }
    return ex;
  }

  private tradable(m: Market | undefined, market: TradeMarket): boolean {
    if (!m || m.active === false) return false;
    return market === 'spot' ? m.spot === true : m.swap === true && m.linear === true && m.settle === 'USDT';
  }

  private marketOf(ex: Exchange, market: TradeMarket, symbol: string): Market {
    const m = ex.markets?.[symbol];
    if (!this.tradable(m, market)) throw new TradingError('INVALID', `Perechea ${symbol} nu se tranzacționează pe ${market === 'futures' ? 'futures' : 'spot'} la acest exchange.`);
    return m as Market;
  }

  async symbols(market: TradeMarket): Promise<TradeSymbol[]> {
    const ex = await this.withMarkets(market);
    const out: TradeSymbol[] = [];
    for (const m of Object.values(ex.markets ?? {})) {
      if (this.tradable(m, market) && m.base && m.quote) out.push({ symbol: m.symbol, base: m.base, quote: m.quote });
    }
    const rank = (q: string) => {
      const i = QUOTE_ORDER.indexOf(q);
      return i < 0 ? QUOTE_ORDER.length : i;
    };
    return out.sort((a, b) => rank(a.quote) - rank(b.quote) || a.base.localeCompare(b.base));
  }

  private async lastPrice(ex: Exchange, symbol: string): Promise<{ last: number | null; bid: number | null; ask: number | null }> {
    try {
      const t = await ex.fetchTicker(symbol);
      return { last: num(t.last) ?? num(t.close), bid: num(t.bid), ask: num(t.ask) };
    } catch {
      return { last: null, bid: null, ask: null };
    }
  }

  /**
   * Free quote and base (spot), or free USDT and the open position (futures); null where it cannot be read. In hedge
   * mode (FD-KUCOINHEDGE) the long and the short are given apart, and `position` is null.
   */
  private async availability(ex: Exchange, market: TradeMarket, m: Market, hedged = false): Promise<Pick<InstrumentInfo, 'availableQuote' | 'availableBase' | 'position' | 'hedgePositions'>> {
    const free = (bal: unknown, code: string) => num(((bal as { free?: Record<string, unknown> }).free ?? {})[code]);
    try {
      if (market === 'spot') {
        const classicKucoin = this.exchange === 'kucoin' && !(await this.isUta());
        const bal = await ex.fetchBalance(classicKucoin ? { type: 'trade' } : {});
        return { availableQuote: free(bal, m.quote) ?? 0, availableBase: free(bal, m.base) ?? 0, position: null };
      }
      const how = FUTURES_BALANCE[this.exchange];
      const bal = this.exchange === 'kucoin' && ex === this.clients.futures ? await ex.fetchBalance({ code: 'USDT' }) : await ex.fetchBalance(how && how !== 'spot' ? how : {});
      let held: HeldPosition[] = [];
      try {
        const list = await ex.fetchPositions([m.symbol]);
        held = list
          .filter((x) => x.symbol === m.symbol && (num(x.contracts) ?? 0) > 0)
          .map((p): HeldPosition => ({ side: positionSideOf(p) === 'short' ? 'short' : 'long', amount: (num(p.contracts) ?? 0) * (m.contractSize ?? 1), entryPrice: num(p.entryPrice) }));
      } catch {
        // No position read: the form simply shows none.
      }
      const availableQuote = free(bal, 'USDT') ?? 0;
      if (hedged) {
        return { availableQuote, availableBase: null, position: null, hedgePositions: { long: held.find((h) => h.side === 'long') ?? null, short: held.find((h) => h.side === 'short') ?? null } };
      }
      return { availableQuote, availableBase: null, position: held[0] ?? null };
    } catch {
      return { availableQuote: null, availableBase: null, position: null };
    }
  }

  async instrument(market: TradeMarket, symbol: string): Promise<InstrumentInfo> {
    const ex = await this.withMarkets(market);
    const m = this.marketOf(ex, market, symbol);
    const size = market === 'futures' ? (m.contractSize ?? 1) : 1;
    const step = num(m.precision?.amount);
    // Futures (FD-KUCOINHEDGE, FD-HEDGEALL): the form tells hedge mode; a mode that cannot be read now is just not shown.
    const hedged = market === 'futures' ? await this.hedgedOf(ex, m).catch(() => null) : null;
    const [{ last }, avail] = await Promise.all([this.lastPrice(ex, symbol), this.availability(ex, market, m, hedged === true)]);
    return {
      market,
      symbol,
      ref: null,
      name: null,
      currency: m.quote,
      base: m.base,
      last,
      amountStep: step !== null ? step * size : null,
      minAmount: num(m.limits?.amount?.min) !== null ? (num(m.limits?.amount?.min) as number) * size : null,
      minCost: num(m.limits?.cost?.min),
      priceStep: num(m.precision?.price),
      contractSize: market === 'futures' ? size : null,
      maxLeverage: market === 'futures' ? (num(m.limits?.leverage?.max) ?? this.platform.futures?.maxLeverage ?? null) : null,
      ...avail,
      ...(hedged !== null ? { positionMode: hedged ? 'hedge' : 'one-way' } : {}),
    };
  }

  async normalize(t: OrderTicket): Promise<OrderPreview> {
    const ex = await this.withMarkets(t.market);
    const m = this.marketOf(ex, t.market, t.symbol);
    const p = this.platform;
    const warnings: string[] = [];
    const errors: string[] = [];
    const futures = t.market === 'futures';
    if (!(p.kinds[t.market] ?? []).includes(t.kind)) errors.push(`Tipul de ordin „${t.kind}” nu e disponibil aici pe ${futures ? 'futures' : 'spot'}.`);
    if (futures && t.marginMode && p.futures?.marginModes === null) warnings.push('Pe acest exchange marja (cross / isolated) e a contului: se folosește cea aleasă pe exchange.');
    if (futures && t.marginMode && p.futures?.marginModes && !p.futures.marginModes.includes(t.marginMode)) errors.push(`Marja ${t.marginMode} nu e disponibilă aici.`);
    // KuCoin's unified account sets futures leverage only for cross margin (ccxt 4.5): isolated is not sent from here.
    if (futures && this.exchange === 'kucoin' && !t.reduceOnly && (t.marginMode ?? 'isolated') === 'isolated' && (await this.isUta())) {
      errors.push('Pe contul unificat KuCoin (UTA), Sentiq trimite ordine futures doar cu marjă cross: alege „Cross”.');
    }
    // Bitget's unified account: ccxt 4.5 builds no stop orders for it (the trigger would be dropped), and its isolated
    // leverage wants the position side; both stay on Bitget's own app.
    if (this.exchange === 'bitget' && (await this.bitgetMode(ex)).uta) {
      if (t.kind === 'stop' || t.kind === 'stop_limit') errors.push('Pe contul unificat Bitget, Sentiq nu trimite ordine stop: pune-l din aplicația Bitget.');
      if (futures && !t.reduceOnly && t.marginMode === 'isolated') errors.push('Pe contul unificat Bitget, Sentiq trimite ordine futures doar cu marjă cross: alege „Cross”.');
    }
    // FD-KUCOINHEDGE, FD-HEDGEALL: futures go out in the account's (Bybit: the pair's) position mode; KuCoin's unified
    // account takes one-way only.
    const hedged = futures ? await this.hedgedOf(ex, m) : null;
    if (hedged === true && this.exchange === 'kucoin' && (await this.isUta())) errors.push(KUCOIN_UTA_HEDGE);
    if ((t.takeProfit !== undefined || t.stopLoss !== undefined) && !futures) errors.push('TP / SL se pot atașa doar ordinelor futures.');
    if ((t.takeProfit !== undefined || t.stopLoss !== undefined) && t.reduceOnly) errors.push('TP / SL nu se atașează unui ordin reduce-only (el doar închide).');
    if (futures && (t.takeProfit !== undefined || t.stopLoss !== undefined)) {
      if (p.futures?.tpsl === 'none') errors.push('TP / SL nu se pot atașa aici.');
      if (p.futures?.tpsl === 'after-market' && t.kind !== 'market') errors.push('Pe acest exchange TP / SL se trimit după o intrare la piață: pentru alt tip de ordin, pune-le după ce se execută.');
    }

    const [{ last, bid, ask }, avail] = await Promise.all([this.lastPrice(ex, t.symbol), this.availability(ex, t.market, m, hedged === true)]);
    const touch = t.side === 'buy' ? (ask ?? last) : (bid ?? last);
    const ref = t.price ?? t.triggerPrice ?? touch;
    if (ref === null) errors.push('Prețul de acum nu se poate citi: încearcă din nou.');
    const size = futures ? (m.contractSize ?? 1) : 1;
    const baseWanted = t.amountIn === 'quote' ? (ref ? t.amount / ref : 0) : t.amount;
    let contracts = 0;
    try {
      contracts = Number(ex.amountToPrecision(t.symbol, baseWanted / size));
    } catch {
      contracts = 0;
    }
    const amount = contracts * size;
    const rnd = (v: number | undefined) => (v === undefined ? null : Number(ex.priceToPrecision(t.symbol, v)));
    const price = rnd(t.price);
    const triggerPrice = rnd(t.triggerPrice);
    const takeProfit = rnd(t.takeProfit);
    const stopLoss = rnd(t.stopLoss);
    const minContracts = num(m.limits?.amount?.min);
    if (!(contracts > 0)) {
      errors.push(`Cantitatea e sub pasul minim al perechii ${t.symbol}${futures ? ` (un contract = ${fmtPlain(size)} ${m.base})` : ''}.`);
    } else if (minContracts !== null && contracts < minContracts) {
      errors.push(`Minimul pe ${t.symbol} e ${fmtPlain(minContracts * size)} ${m.base}${futures && size !== 1 ? ` (${fmtPlain(minContracts)} contracte)` : ''}.`);
    }
    if (contracts > 0 && Math.abs(amount - baseWanted) / baseWanted > 1e-9) warnings.push(`Cantitatea a fost rotunjită la ${fmtPlain(amount)} ${m.base}${futures && size !== 1 ? ` (${fmtPlain(contracts)} contracte)` : ''}.`);
    const value = ref !== null ? amount * ref : null;
    const minCost = num(m.limits?.cost?.min);
    if (value !== null && minCost !== null && value < minCost && contracts > 0) errors.push(`Valoarea minimă a unui ordin pe ${t.symbol} e ${fmtPlain(minCost)} ${m.quote}.`);

    const leverage = futures && !t.reduceOnly ? (t.leverage ?? 1) : null;
    const maxLev = futures ? (num(m.limits?.leverage?.max) ?? p.futures?.maxLeverage ?? 125) : null;
    if (leverage !== null && maxLev !== null && leverage > maxLev) errors.push(`Levierul maxim pe ${t.symbol} e ${maxLev}×.`);
    if (leverage !== null && leverage > 10) warnings.push(`Levier ${leverage}×: o mișcare de ${fmtPlain(100 / leverage)}% împotriva poziției îți consumă marja.`);
    const margin = leverage && value !== null ? value / leverage : null;
    const available = avail.availableQuote;
    if (t.side === 'buy' || futures) {
      const need = futures ? margin : value;
      if (!t.reduceOnly && need !== null && available !== null) {
        if (need > available) warnings.push(`Disponibil: ${fmtPlain(available)} ${futures ? 'USDT' : m.quote}; ordinul cere ${fmtPlain(need)}.`);
        else if (need > available * 0.5) warnings.push(`Ordinul folosește peste jumătate din disponibil (${fmtPlain(available)} ${futures ? 'USDT' : m.quote}).`);
      }
    } else if (avail.availableBase !== null && amount > avail.availableBase) {
      warnings.push(`Ai liber ${fmtPlain(avail.availableBase)} ${m.base}; vinzi ${fmtPlain(amount)}.`);
    }
    if (futures && hedged === true) {
      // Hedge: a buy opens the long and a sell the short, side by side; reduce-only, a sell closes the long, a buy the short.
      const h = avail.hedgePositions ?? { long: null, short: null };
      // The position on the other side of the order: the one a reduce-only order closes, or the one an opening order
      // leaves open.
      const opposite = t.side === 'buy' ? h.short : h.long;
      if (!t.reduceOnly && opposite) {
        const [opens, stays] = t.side === 'buy' ? ['Long', 'short'] : ['Short', 'long'];
        warnings.push(`Contul e în modul hedge: «${opens}» deschide un ${opens.toLowerCase()} separat, iar ${stays}-ul de ${fmtPlain(opposite.amount)} ${m.base} rămâne deschis. Ca să-l închizi, bifează reduce-only («Închide ${stays}»).`);
      }
      if (t.reduceOnly && !opposite) {
        const closes = t.side === 'buy' ? 'short' : 'long';
        warnings.push(`Nu e niciun ${closes} deschis pe ${t.symbol}: «Închide ${closes}» nu are ce închide.`);
      }
    } else if (t.reduceOnly && futures && !avail.position) {
      warnings.push(`Nu e nicio poziție deschisă pe ${t.symbol}: un ordin reduce-only nu are ce micșora.`);
    }
    // KuCoin cancels a reduce-only order larger than the position it closes (FD-KUCOINHEDGE §3), in either mode.
    const pos = avail.position;
    const closed = hedged === true ? (t.side === 'buy' ? avail.hedgePositions?.short : avail.hedgePositions?.long) : pos && (pos.side === 'long') === (t.side === 'sell') ? pos : null;
    if (futures && this.exchange === 'kucoin' && t.reduceOnly && closed && amount > closed.amount * (1 + 1e-9)) {
      warnings.push(`Închizi ${fmtPlain(amount)} ${m.base}, iar poziția are ${fmtPlain(closed.amount)} ${m.base}: KuCoin anulează un ordin reduce-only mai mare decât poziția.`);
    }
    commonChecks({ ...t, price: price ?? undefined, triggerPrice: triggerPrice ?? undefined, takeProfit: takeProfit ?? undefined, stopLoss: stopLoss ?? undefined }, { last, entry: price ?? triggerPrice ?? last }, { warnings, errors }, fmtPlain);
    return {
      ticket: {
        ...t,
        amount,
        amountIn: 'base',
        ...(price !== null ? { price } : {}),
        ...(triggerPrice !== null ? { triggerPrice } : {}),
        ...(takeProfit !== null ? { takeProfit } : {}),
        ...(stopLoss !== null ? { stopLoss } : {}),
        ...(leverage !== null ? { leverage } : {}),
      },
      displaySymbol: futures ? `${m.base}/${m.quote} perpetuu` : t.symbol,
      amount,
      contracts: futures ? contracts : null,
      price,
      triggerPrice,
      last,
      value,
      margin: futures ? margin : null,
      available,
      currency: futures ? 'USDT' : m.quote,
      env: 'live',
      ...(hedged !== null ? { positionMode: hedged ? 'hedge' : 'one-way' } : {}),
      warnings,
      errors,
    };
  }

  /**
   * The account's position mode (Bybit: the pair's): true for hedge (separate long and short positions), false for
   * one-way, null where it cannot be read here. Kept 10 minutes; forgotten when the exchange answers that it changed.
   */
  private async hedgedOf(ex: Exchange, m: Market): Promise<boolean | null> {
    const key = `${ex.id}|${m.symbol}`;
    const cached = this.positionModes.get(key);
    let hedged: boolean | null = cached && Date.now() - cached.at < POSITION_MODE_TTL_MS ? cached.hedged : null;
    if (hedged === null) {
      try {
        if (this.exchange === 'bitget') {
          const bm = await this.bitgetMode(ex);
          if (bm.uta) hedged = bm.hedged;
          else {
            const fn = (ex as unknown as Record<string, (p: object) => Promise<unknown>>).privateMixGetV2MixAccountAccount;
            const r = fn ? await fn.call(ex, { symbol: m.id, productType: 'USDT-FUTURES', marginCoin: 'USDT' }) : null;
            const data = (r as { data?: { posMode?: string } } | null)?.data;
            hedged = data?.posMode === 'hedge_mode';
          }
        } else if (this.exchange === 'bybit') {
          // Bybit keeps the mode per pair; the pair's position list answers even without a position (FD-HEDGEALL):
          // positionIdx 0 is one-way, 1 / 2 the two sides of hedge mode.
          const fn = (ex as unknown as Record<string, (p: object) => Promise<unknown>>).privateGetV5PositionList;
          const r = fn ? await fn.call(ex, { category: 'linear', symbol: m.id }) : null;
          const idx = ((r as { result?: { list?: { positionIdx?: unknown }[] } } | null)?.result?.list ?? []).map((x) => Number(x.positionIdx));
          hedged = idx.some((i) => i === 1 || i === 2) ? true : idx.includes(0) ? false : null;
        } else if (ex.has.fetchPositionMode) {
          hedged = Boolean((await ex.fetchPositionMode(m.symbol)).hedged);
        }
      } catch (err) {
        throw tradingErrorOf(err, false);
      }
      if (hedged !== null) this.positionModes.set(key, { hedged, at: Date.now() });
    }
    return hedged;
  }

  /**
   * Leverage and margin mode before the order, where the exchange keeps them per symbol. A reduce-only order (closing)
   * changes neither: it only names the position's margin mode where the exchange asks for it with every order.
   */
  private async prepareFutures(ex: Exchange, m: Market, t: OrderTicket, params: Record<string, unknown>, hedged: boolean): Promise<void> {
    const lev = t.leverage ?? 1;
    const mode = t.marginMode;
    // Hedge mode, isolated margin: OKX and classic Bitget keep a leverage per side, set on the side the order opens.
    const side = t.side === 'buy' ? 'long' : 'short';
    // Bitget's unified account names the margin modes "crossed" / "isolated", and ccxt passes them on as given.
    const bitgetUta = this.exchange === 'bitget' && (await this.bitgetMode(ex)).uta;
    if (t.reduceOnly) {
      if (bitgetUta) params.marginMode = mode === 'isolated' ? 'isolated' : 'crossed';
      else if (this.exchange === 'okx' || this.exchange === 'bitget') params.marginMode = mode ?? 'cross';
      if (this.exchange === 'kucoin') params.marginMode = mode ?? 'isolated';
      return;
    }
    const setIgnoring = async (fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (err) {
        if (!alreadySet(err)) throw tradingErrorOf(err, false);
      }
    };
    switch (this.exchange) {
      case 'binance':
        if (mode) await setIgnoring(() => ex.setMarginMode(mode, m.symbol));
        await setIgnoring(() => ex.setLeverage(lev, m.symbol));
        return;
      case 'bybit':
        // The unified account's margin mode stays as chosen on Bybit.
        await setIgnoring(() => ex.setLeverage(lev, m.symbol));
        return;
      case 'okx':
        await setIgnoring(() => ex.setLeverage(lev, m.symbol, { marginMode: mode ?? 'cross', ...(hedged && mode === 'isolated' ? { posSide: side } : {}) }));
        params.marginMode = mode ?? 'cross';
        return;
      case 'bitget':
        if (bitgetUta) {
          // Cross only from here (isolated is refused by the check): the v3 leverage call defaults to it.
          await setIgnoring(() => ex.setLeverage(lev, m.symbol));
          params.marginMode = 'crossed';
          return;
        }
        await setIgnoring(() => ex.setLeverage(lev, m.symbol, { marginMode: mode ?? 'cross', ...(hedged && mode === 'isolated' ? { holdSide: side } : {}) }));
        params.marginMode = mode ?? 'cross';
        return;
      case 'kucoin': {
        const m2 = mode ?? 'isolated';
        params.marginMode = m2;
        // (Isolated on the unified account is refused by the check: its leverage call takes cross only.)
        if (m2 === 'cross') await setIgnoring(() => ex.setLeverage(lev, m.symbol, { marginMode: m2 }));
        else params.leverage = lev;
        return;
      }
      default:
        throw new TradingError('UNSUPPORTED', 'Futures nu se pot tranzacționa pe acest exchange din Sentiq.');
    }
  }

  /** The stop's direction where the exchange asks for it: a buy stop above the price, a sell stop below. */
  private async stopParams(m: Market, t: OrderTicket, trigger: number, params: Record<string, unknown>, dir?: 'up' | 'down'): Promise<void> {
    // A buy stop rises to its trigger, a sell stop falls to it; a replaced order keeps the way it had (`dir`).
    const up = dir ? dir === 'up' : t.side === 'buy';
    if (this.exchange === 'kraken') {
      // Kraken calls every stop a "stop-loss": a buy triggers above, a sell below.
      params.stopLossPrice = trigger;
      return;
    }
    params.triggerPrice = trigger;
    if (this.exchange === 'coinbase') params.stop_direction = up ? 'STOP_DIRECTION_STOP_UP' : 'STOP_DIRECTION_STOP_DOWN';
    if (this.exchange === 'bybit' && m.contract) params.triggerDirection = up ? 'ascending' : 'descending';
    if (this.exchange === 'kucoin') {
      if (await this.isUta()) params.triggerDirection = up ? 'ascending' : 'descending';
      else if (m.spot) params.stop = up ? 'entry' : 'loss';
    }
  }

  async place(preview: OrderPreview): Promise<OrderResult> {
    const t = preview.ticket;
    const ex = await this.withMarkets(t.market);
    const m = this.marketOf(ex, t.market, t.symbol);
    const futures = t.market === 'futures';
    const contracts = preview.contracts ?? preview.amount;
    const params: Record<string, unknown> = { clientOrderId: clientIdOf(t.idemKey) };
    const hedged = futures && (await this.hedgedOf(ex, m)) === true;
    if (futures) {
      if (hedged) {
        // FD-KUCOINHEDGE, FD-HEDGEALL: ccxt names the position from the side and reduce-only (KuCoin / Binance
        // positionSide, Bybit positionIdx, OKX / Bitget posSide, classic Bitget open / close); KuCoin's unified account
        // takes no hedge orders.
        if (this.exchange === 'kucoin' && (await this.isUta())) throw new TradingError('HEDGE_MODE', KUCOIN_UTA_HEDGE);
        params.hedged = true;
      }
      // Classic Bitget wants one-way named with every order (it would override `hedged`); the unified account reads it
      // from the account.
      if (this.exchange === 'bitget' && !hedged && !(await this.bitgetMode(ex)).uta) params.oneWayMode = true;
      await this.prepareFutures(ex, m, t, params, hedged);
      if (t.reduceOnly) params.reduceOnly = true;
      if (this.platform.futures?.tpsl === 'attached') {
        if (t.stopLoss !== undefined) params.stopLoss = { triggerPrice: t.stopLoss };
        if (t.takeProfit !== undefined) params.takeProfit = { triggerPrice: t.takeProfit };
      }
    }
    const isLimit = t.kind === 'limit' || t.kind === 'stop_limit';
    if (t.kind === 'stop' || t.kind === 'stop_limit') await this.stopParams(m, t, t.triggerPrice as number, params);
    // Bitget's unified account takes a spot market buy as the quote sum (v3 `qty`), and ccxt 4.5 passes the amount on
    // as is (1000 DOGE would spend 1000 USDT): the sum the check showed is named instead.
    if (this.exchange === 'bitget' && !futures && t.kind === 'market' && t.side === 'buy' && (await this.bitgetMode(ex)).uta) {
      const cost = preview.value ?? (preview.last !== null ? preview.amount * preview.last : null);
      if (cost === null || !(cost > 0)) throw new TradingError('INVALID', 'Prețul de acum nu se poate citi: încearcă din nou.');
      params.qty = ex.costToPrecision(t.symbol, cost);
    }
    // A market order carries the current price, so ccxt can turn the amount into the quote sum where the exchange
    // takes a market buy by value (Coinbase, Bybit spot, Bitget spot, OKX spot).
    const price = isLimit ? t.price : (preview.last ?? undefined);
    let order;
    try {
      order = await ex.createOrder(t.symbol, isLimit ? 'limit' : 'market', t.side, contracts, price, params);
    } catch (err) {
      // The mode changed on the exchange since it was read: refused (nothing placed), and read again next time (every
      // pair: on most exchanges the mode is the account's). KuCoin's unified account takes no hedge orders at all.
      if (futures && modeMismatch(err)) {
        this.positionModes.clear();
        this.bitget = null;
        if (this.exchange === 'kucoin' && (await this.isUta())) throw new TradingError('HEDGE_MODE', KUCOIN_UTA_HEDGE);
        throw new TradingError('REJECTED', modeChanged(providerById(this.exchange)?.name ?? this.exchange));
      }
      throw tradingErrorOf(err, true);
    }
    const followUps: OrderFollowUp[] = [];
    if (futures && this.platform.futures?.tpsl === 'after-market' && t.kind === 'market') {
      // Binance: TP / SL go out as their own reduce-only orders once the entry is in.
      const closing = t.side === 'buy' ? 'sell' : 'buy';
      for (const [what, key, v] of [
        ['stop-loss', 'stopLossPrice', t.stopLoss],
        ['take-profit', 'takeProfitPrice', t.takeProfit],
      ] as const) {
        if (v === undefined) continue;
        try {
          // In hedge mode Binance takes no reduce-only: ccxt names the position instead (FD-HEDGEALL).
          const o = await ex.createOrder(t.symbol, 'market', closing, contracts, undefined, { [key]: v, reduceOnly: true, ...(hedged ? { hedged: true } : {}) });
          followUps.push({ what, ok: true, orderId: o.id ? String(o.id) : null, message: null });
        } catch (err) {
          followUps.push({ what, ok: false, orderId: null, message: tradingErrorOf(err, true).message });
        }
      }
    }
    const status = order.status === 'closed' ? 'filled' : order.status === 'canceled' ? 'cancelled' : order.status === 'open' ? 'open' : 'sent';
    this.log.info(`trading: ${this.exchange} ${t.market} ${t.side} ${t.kind} ${preview.amount} ${t.symbol} → ${status} ${order.id ?? ''}`);
    return { status, orderId: order.id ? String(order.id) : null, message: null, followUps };
  }

  async cancel(input: CancelInput): Promise<OrderResult> {
    const ex = await this.withMarkets(input.market === 'futures' ? 'futures' : 'spot');
    const params: Record<string, unknown> = {};
    if (input.trigger) {
      params.trigger = true;
      if (this.exchange === 'kucoin' && input.market === 'spot' && !(await this.isUta())) params.stop = true;
    }
    try {
      await ex.cancelOrder(input.orderId, input.symbol, params);
    } catch (err) {
      throw tradingErrorOf(err, false);
    }
    this.log.info(`trading: ${this.exchange} cancelled ${input.orderId} (${input.symbol})`);
    return { status: 'cancelled', orderId: input.orderId, message: null, followUps: [] };
  }

  // ---------------- FD-ORDEREDIT: changing open orders and a position's stop loss / take profit ----------------

  /**
   * The open orders on a symbol, from every listing an order may be in. A listing that fails is skipped (one the account
   * cannot do), and said: an order not found may be in it.
   */
  private async openOrdersOn(ex: Exchange, m: Market, market: TradeMarket): Promise<{ orders: Order[]; missed: string | null }> {
    const reads = (MODIFY_READS[this.exchange] ?? DEFAULT_MODIFY_READS)[market === 'futures' ? 'futures' : 'spot'];
    const classicKucoinSpot = this.exchange === 'kucoin' && market === 'spot' && !(await this.isUta());
    const out = new Map<string, Order>();
    let failures = 0;
    let last: unknown = null;
    for (const params of reads) {
      try {
        // A classic KuCoin account keeps its spot stop orders apart (not "high-frequency").
        const p = classicKucoinSpot && params.trigger ? { ...params, hf: false } : params;
        for (const o of await ex.fetchOpenOrders(m.symbol, undefined, undefined, { ...p })) if (o.id) out.set(String(o.id), o);
      } catch (err) {
        failures++;
        last = err;
      }
    }
    if (failures === reads.length) throw tradingErrorOf(last, false);
    return { orders: [...out.values()], missed: failures ? tradingErrorOf(last, false).message : null };
  }

  /** The open position on the symbol, on the side named (hedge) or the only one. */
  private async positionOn(ex: Exchange, m: Market, side: 'long' | 'short'): Promise<ModifyInternal['position']> {
    let list;
    try {
      list = await ex.fetchPositions([m.symbol]);
    } catch (err) {
      throw tradingErrorOf(err, false);
    }
    const p = list.find((x) => x.symbol === m.symbol && (num(x.contracts) ?? 0) > 0 && (positionSideOf(x) ?? 'long') === side);
    if (!p) return null;
    return { side, contracts: num(p.contracts) ?? 0, entry: num(p.entryPrice), marginMode: typeof p.marginMode === 'string' ? p.marginMode : null };
  }

  /** The order's trigger and the levels it carries. */
  private valuesOf(o: Order): ModifyValues {
    return values({ price: num(o.price), triggerPrice: num(o.triggerPrice) ?? num((o as { stopPrice?: unknown }).stopPrice), amount: num(o.amount), stopLoss: num(o.stopLossPrice), takeProfit: num(o.takeProfitPrice) });
  }

  /**
   * Whether a new trigger order can fire `dir` (a replacement keeps the old one's way): a buy rising and a sell falling
   * everywhere; an order that only closes a futures position as its stop loss / take profit; KuCoin's and Coinbase's
   * spot stops, which name their way.
   */
  private keepsDirection(futures: boolean, reduceOnly: boolean, side: 'buy' | 'sell', dir: 'up' | 'down'): boolean {
    if (dir === (side === 'buy' ? 'up' : 'down')) return true;
    if (futures) return reduceOnly;
    return this.exchange === 'kucoin' || this.exchange === 'coinbase';
  }

  /** Cancels an open order as read, in the listing it is in (a stop / trigger, an OKX algo, a Bitget TP / SL plan). */
  private async cancelOpen(ex: Exchange, o: Order, symbol: string, market: TradeMarket): Promise<void> {
    const params: Record<string, unknown> = {};
    const plan = BITGET_TPSL_PLANS.has(String(infoOf(o).planType ?? ''));
    if (this.valuesOf(o).triggerPrice !== null || this.okxAlgo(o) || plan) {
      params.trigger = true;
      if (this.exchange === 'kucoin' && market === 'spot' && !(await this.isUta())) params.stop = true;
      if (this.exchange === 'bitget' && plan) params.planType = 'profit_loss';
    }
    await ex.cancelOrder(String(o.id), symbol, params);
  }

  /** An OKX algo order (trigger, conditional, oco): changed through amend-algos and cancelled as an algo. */
  private okxAlgo(o: Order): boolean {
    const i = infoOf(o);
    return this.exchange === 'okx' && (i.algoId !== undefined && i.algoId !== '');
  }

  async normalizeModify(t: ModifyTicket): Promise<ModifyPlan> {
    const ex = await this.withMarkets(t.market);
    const m = this.marketOf(ex, t.market, t.symbol);
    const futures = t.market === 'futures';
    const warnings: string[] = [];
    const errors: string[] = [];
    const digits = fmtPlain;
    const rp = (v: number) => Number(ex.priceToPrecision(t.symbol, v));
    const ra = (v: number) => Number(ex.amountToPrecision(t.symbol, v));
    const [{ last }, { orders, missed }] = await Promise.all([this.lastPrice(ex, t.symbol), this.openOrdersOn(ex, m, t.market)]);
    // Not found: gone, unless a listing could not be read.
    const gone = (what: string) => (missed ? `${what} nu s-a găsit, iar o parte din ordine nu s-a putut citi (${missed}): mai încearcă.` : `${what} nu mai e deschis (poate s-a executat sau a fost anulat).`);
    const hedged = futures ? (await this.hedgedOf(ex, m)) === true : false;
    const position = t.position && futures ? await this.positionOn(ex, m, t.position.side) : null;
    if (t.position && futures && !position) errors.push('Poziția nu mai e deschisă.');
    const internal: ModifyInternal = { symbol: t.symbol, market: t.market, hedged, position, steps: [] };
    const find = (id: string) => orders.find((o) => String(o.id) === id) ?? null;
    const long = t.position ? t.position.side === 'long' : null;

    for (const [i, c] of t.changes.entries()) {
      if (c.what === 'order') {
        const o = find(c.orderId);
        if (!o) {
          errors.push(gone('Ordinul'));
          continue;
        }
        const before = this.valuesOf(o);
        const after: ModifyValues = { ...before };
        if (c.price !== undefined) after.price = rp(c.price);
        if (c.triggerPrice !== undefined) after.triggerPrice = rp(c.triggerPrice);
        if (c.amount !== undefined) after.amount = ra(c.amount);
        if (c.takeProfit !== undefined) after.takeProfit = c.takeProfit === null ? null : rp(c.takeProfit);
        if (c.stopLoss !== undefined) after.stopLoss = c.stopLoss === null ? null : rp(c.stopLoss);
        if (c.price !== undefined && before.price === null) errors.push('Ordinul nu are preț limită.');
        if (c.triggerPrice !== undefined && before.triggerPrice === null) errors.push('Ordinul nu are preț de declanșare.');
        if (after.amount !== null && !(after.amount > 0)) errors.push('Cantitatea, rotunjită la pasul pieței, e zero.');
        const side = o.side === 'sell' ? 'sell' : 'buy';
        const reduceOnly = Boolean(o.reduceOnly);
        const mode = orderEditMode(this.exchange, { id: String(o.id), market: t.market === 'futures' ? 'futures' : 'spot', type: String(o.type ?? ''), price: before.price, triggerPrice: before.triggerPrice, reduceOnly });
        if (mode === null) errors.push('Ordinul nu se poate modifica pe acest exchange.');
        // Which way its trigger fires; moved across the price now, it would fire at once.
        const dir = before.triggerPrice !== null ? triggerDirOf(o, before.triggerPrice, last) : null;
        if (after.triggerPrice !== null && after.triggerPrice !== before.triggerPrice && dir !== null && last !== null && (dir === 'up' ? after.triggerPrice <= last : after.triggerPrice >= last)) {
          errors.push(`Declanșarea nouă e ${dir === 'up' ? 'sub' : 'peste'} prețul de acum (${digits(last)}), iar ordinul se declanșează la ${dir === 'up' ? 'urcare' : 'coborâre'}: s-ar executa imediat.`);
        }
        // An entry's TP / SL against its own price (the rules of a new order).
        if (!reduceOnly && (after.takeProfit !== null || after.stopLoss !== null)) {
          const entry = after.price ?? after.triggerPrice ?? last;
          commonChecks({ accountId: 1, idemKey: '00000000-0000-4000-8000-000000000000', market: t.market, symbol: t.symbol, side, kind: 'limit', amount: 1, amountIn: 'base', ...(after.takeProfit !== null ? { takeProfit: after.takeProfit } : {}), ...(after.stopLoss !== null ? { stopLoss: after.stopLoss } : {}) }, { last: null, entry }, { warnings: [], errors }, digits);
        }
        const changesTpsl = after.takeProfit !== before.takeProfit || after.stopLoss !== before.stopLoss;
        if (changesTpsl && !futures) errors.push('TP / SL se pot atașa doar ordinelor futures.');
        else if (changesTpsl && reduceOnly) errors.push('Un ordin care doar închide nu are TP / SL atașate: e el însuși un stop loss sau take profit.');
        // An order that only closes a futures position is replaced new-first (the position is never without it), as its
        // stop loss / take profit would be; any other old-first (it holds funds, or could open twice).
        let how: ModifyHow = mode === 'amend' ? 'amend' : reduceOnly && futures ? 'place-then-cancel' : 'cancel-then-place';
        if (this.exchange === 'bybit' && BYBIT_POSITION_TPSL.has(String(infoOf(o).stopOrderType ?? ''))) how = 'position';
        if (how === 'cancel-then-place') warnings.push('Ordinul vechi se anulează întâi, apoi se plasează cel nou: o clipă, ordinul nu există. Dacă cel nou e refuzat, cel vechi rămâne anulat.');
        // A replaced entry keeps its leverage: one that cannot be read stops it here, before anything is cancelled.
        if ((how === 'cancel-then-place' || how === 'place-then-cancel') && futures && !reduceOnly && num(infoOf(o).leverage) === null && num((o as { leverage?: unknown }).leverage) === null) {
          errors.push('Levierul ordinului nu se poate citi: ordinul nu se poate înlocui de aici. Anulează-l și pune altul.');
        }
        if (how !== 'amend' && how !== 'position' && !reduceOnly && futures && this.platform.futures?.tpsl === 'attached' && before.takeProfit === null && before.stopLoss === null && c.takeProfit === undefined && c.stopLoss === undefined) {
          warnings.push('Exchange-ul nu arată TP / SL atașate unui ordin în așteptare: ordinul nou pleacă doar cu TP / SL scrise în formular.');
        }
        const replacing = how === 'cancel-then-place' || how === 'place-then-cancel';
        // The new order fires the same way as the old one: known, and expressible on the exchange.
        if (replacing && before.triggerPrice !== null) {
          if (dir === null) errors.push('Nu se poate afla în ce direcție se declanșează ordinul (prețul de acum lipsește): ordinul nu se înlocuiește acum.');
          else if (!this.keepsDirection(futures, reduceOnly, side, dir)) errors.push('Ordinul nou nu s-ar declanșa în aceeași direcție pe acest exchange: anulează-l și pune altul.');
        }
        // A replacement's margin mode: the order's, else the position it closes or adds to.
        let marginMode = marginModeOf(infoOf(o).marginMode ?? infoOf(o).mgnMode ?? infoOf(o).marginType);
        if (replacing && futures && marginMode === null) {
          const posSide = (side === 'sell') === reduceOnly ? 'long' : 'short';
          marginMode = marginModeOf((await this.positionOn(ex, m, posSide).catch(() => null))?.marginMode);
        }
        const plan: ModifyStepPlan = { change: i, how, orderId: String(o.id), side, kind: String(o.type ?? ''), before, after, removes: false };
        if (JSON.stringify(before) === JSON.stringify(after)) continue;
        internal.steps.push({ plan, order: o, role: null, leg: null, dir, mode: marginMode });
        continue;
      }
      // A position's stop loss / take profit.
      if (long === null) continue;
      const what = c.what;
      if (c.level !== null) protectionChecks(what, long, rp(c.level), last, { errors }, digits);
      if (c.orderId === null) {
        // Added: Bybit's whole-position TP / SL, else a new order that only closes.
        if (!futures || !position) {
          errors.push('Un SL / TP nou se adaugă doar unei poziții futures deschise.');
          continue;
        }
        const level = rp(c.level as number);
        const plan: ModifyStepPlan = {
          change: i,
          how: this.exchange === 'bybit' ? 'position' : 'place',
          orderId: null,
          side: long ? 'sell' : 'buy',
          kind: what,
          before: values(),
          after: values(what === 'sl' ? { stopLoss: level, amount: position.contracts } : { takeProfit: level, amount: position.contracts }),
          removes: false,
        };
        internal.steps.push({ plan, order: null, role: what, leg: null, dir: null, mode: marginModeOf(position.marginMode) });
        continue;
      }
      const o = find(c.orderId);
      if (!o) {
        errors.push(gone(what === 'sl' ? 'Stop loss-ul' : 'Take profit-ul'));
        continue;
      }
      const closing = long ? 'sell' : 'buy';
      if ((o.side === 'sell' ? 'sell' : 'buy') !== closing) {
        errors.push('Ordinul nu închide această poziție.');
        continue;
      }
      const before = this.valuesOf(o);
      // Which of the order's values is this level: its own trigger (or limit), or one leg of an order with both (OKX oco).
      const leg: 'trigger' | 'price' | 'sl' | 'tp' = before.triggerPrice !== null ? 'trigger' : (what === 'sl' ? before.stopLoss : before.takeProfit) !== null ? what : 'price';
      const level = c.level === null ? null : rp(c.level);
      const after: ModifyValues = { ...before };
      if (leg === 'trigger') after.triggerPrice = level;
      else if (leg === 'price') after.price = level;
      else if (leg === 'sl') after.stopLoss = level;
      else after.takeProfit = level;
      const reduceOnly = Boolean(o.reduceOnly) || leg === 'sl' || leg === 'tp';
      const bybitWhole = this.exchange === 'bybit' && BYBIT_POSITION_TPSL.has(String(infoOf(o).stopOrderType ?? ''));
      let how: ModifyHow;
      if (level === null) {
        // Removed: OKX takes one leg of an oco off with 0; Bybit a whole-position TP / SL with 0; else the order goes.
        const okxBoth = this.okxAlgo(o) && before.stopLoss !== null && before.takeProfit !== null;
        how = bybitWhole ? 'position' : okxBoth ? 'amend' : 'cancel';
      } else if (bybitWhole) how = 'position';
      else {
        const mode = orderEditMode(this.exchange, { id: String(o.id), market: futures ? 'futures' : 'spot', type: String(o.type ?? ''), price: before.price, triggerPrice: before.triggerPrice, reduceOnly });
        how = mode === 'amend' ? 'amend' : reduceOnly && futures ? 'place-then-cancel' : 'cancel-then-place';
        if (how === 'cancel-then-place') warnings.push('Ordinul vechi se anulează întâi, apoi se plasează cel nou: o clipă, poziția nu are acest ordin. Dacă cel nou e refuzat, cel vechi rămâne anulat.');
      }
      if (level === null && what === 'sl') warnings.push('Fără stop loss, pierderea poziției nu mai e limitată de un ordin.');
      // A trigger fires as the stop loss / take profit it is; one that fires the other way is not that level.
      const dir = leg === 'trigger' ? protectionDir(what, closing) : null;
      const actual = leg === 'trigger' && before.triggerPrice !== null ? triggerDirOf(o, before.triggerPrice, last) : null;
      if (dir !== null && actual !== null && actual !== dir) {
        errors.push(`Ordinul nu e ${what === 'sl' ? 'stop loss-ul' : 'take profit-ul'} poziției (se declanșează în cealaltă direcție).`);
        continue;
      }
      if ((how === 'place-then-cancel' || how === 'cancel-then-place') && dir !== null && !this.keepsDirection(futures, reduceOnly, closing, dir)) {
        errors.push('Ordinul nou nu s-ar declanșa în aceeași direcție pe acest exchange: anulează-l și pune altul.');
      }
      if (level !== null && level === (leg === 'trigger' ? before.triggerPrice : leg === 'price' ? before.price : leg === 'sl' ? before.stopLoss : before.takeProfit)) continue;
      const plan: ModifyStepPlan = { change: i, how, orderId: String(o.id), side: closing, kind: what, before, after, removes: level === null };
      internal.steps.push({ plan, order: o, role: what, leg, dir, mode: marginModeOf(position?.marginMode) });
    }
    if (!internal.steps.length && !errors.length) errors.push('Nimic nu se schimbă: valorile sunt cele de acum.');
    const preview: ModifyPreview = { ticket: t, displaySymbol: t.symbol, last, currency: m.quote, env: '', steps: internal.steps.map((s) => s.plan), warnings: [...new Set(warnings)], errors };
    return { preview, internal };
  }

  async modify(plan: ModifyPlan): Promise<ModifyResult> {
    const it = plan.internal as ModifyInternal;
    const ex = await this.withMarkets(it.market);
    const m = this.marketOf(ex, it.market, it.symbol);
    const results: (ModifyStepResult & { unknown?: boolean })[] = [];
    const push = (change: number, what: string, ok: boolean, orderId: string | null, message: string | null, unknown = false, cancelled?: string) =>
      results.push({ change, what, ok, orderId, message, ...(unknown ? { unknown } : {}), ...(cancelled ? { cancelled } : {}) });
    for (const step of it.steps) {
      const { plan: p, order: o } = step;
      try {
        await this.runStep(ex, m, it, step, (what, ok, orderId, message, unknown, cancelled) => push(p.change, what, ok, orderId, message, unknown, cancelled));
      } catch (caught) {
        const err = tradingErrorOf(caught, true);
        push(p.change, 'eroare', false, o ? String(o.id) : null, err.message, err.code === 'UNKNOWN_OUTCOME');
      }
      // A step whose outcome is unknown stops the rest: nothing more goes out on a guess.
      if (results.some((r) => r.unknown)) break;
    }
    this.log.info(`trading: ${this.exchange} modify ${it.symbol}: ${results.map((r) => `${r.what}:${r.ok ? 'ok' : 'fail'}`).join(', ')}`);
    return { status: modifyStatus(results), steps: results.map(({ unknown: _u, ...r }) => r) };
  }

  // ---------------- FD-REVERSE: a futures position turned the other way ----------------

  /**
   * The position checked for a reversal: closed (reduce-only, at market), then the same size opened the other way, with
   * its leverage and margin, then its stop loss / take profit orders cancelled. Each order is checked as a new one.
   */
  async normalizeReverse(t: ReverseTicket): Promise<ReversePlan> {
    const ex = await this.withMarkets('futures');
    const m = this.marketOf(ex, 'futures', t.symbol);
    const errors: string[] = [];
    const warnings: string[] = [];
    const hedged = (await this.hedgedOf(ex, m)) === true;
    let list;
    try {
      list = await ex.fetchPositions([m.symbol]);
    } catch (err) {
      throw tradingErrorOf(err, false);
    }
    const p = list.find((x) => x.symbol === m.symbol && (num(x.contracts) ?? 0) > 0 && (positionSideOf(x) ?? 'long') === t.side);
    const size = p ? (num(p.contracts) ?? 0) * (num(p.contractSize) ?? m.contractSize ?? 1) : 0;
    const leverage = p ? Math.min(125, Math.max(1, Math.round(num(p.leverage) ?? 1))) : null;
    const mode = p ? marginModeOf(p.marginMode) : null;
    const to: 'long' | 'short' = t.side === 'long' ? 'short' : 'long';
    const closing = t.side === 'long' ? 'sell' : 'buy';
    const base = { accountId: t.accountId, market: 'futures' as const, symbol: t.symbol, side: closing as 'buy' | 'sell', kind: 'market' as const, amountIn: 'base' as const, amount: size > 0 ? size : 1, ...(mode ? { marginMode: mode } : {}) };
    if (!p) errors.push('Poziția nu mai e deschisă.');
    // Checked as the two orders they are: the close (reduce-only) and the opposite one (its leverage kept).
    const close = await this.normalize({ ...base, idemKey: subKey(t.idemKey, 1), reduceOnly: true });
    const open = await this.normalize({ ...base, idemKey: subKey(t.idemKey, 2), leverage: leverage ?? 1 });
    if (p) {
      for (const e of [...close.errors, ...open.errors]) if (!errors.includes(e)) errors.push(e);
      // The hedge note of a new order ("the long stays open") does not hold: it is closed first.
      for (const w of [...close.warnings, ...open.warnings]) if (!w.startsWith('Contul e în modul hedge') && !warnings.includes(w)) warnings.push(w);
    }
    if (num(p?.leverage) !== null && leverage !== num(p?.leverage)) warnings.push(`Levierul poziției (${fmtPlain(num(p?.leverage) as number)}×) e rotunjit la ${leverage}× pentru poziția opusă.`);
    warnings.unshift('Întoarcerea sunt două ordine la piață: întâi se închide poziția, apoi se deschide cea opusă. Dacă al doilea e refuzat, poziția rămâne închisă.');
    // Its stop loss / take profit orders: a sell (long) or buy (short) that only closes, of this position in hedge mode.
    const { orders } = p ? await this.openOrdersOn(ex, m, 'futures') : { orders: [] as Order[] };
    const own = (o: Order) => o.side === closing && (!hedged || (orderPositionSide(o.info) ?? t.side) === t.side);
    const bybitTpsl = orders.filter((o) => own(o) && this.exchange === 'bybit' && BYBIT_POSITION_TPSL.has(String(infoOf(o).stopOrderType ?? '')));
    const cancels = orders.filter((o) => own(o) && !bybitTpsl.includes(o) && (Boolean(o.reduceOnly) || this.okxAlgo(o) || BITGET_TPSL_PLANS.has(String(infoOf(o).planType ?? ''))));
    if (cancels.length + bybitTpsl.length) warnings.push(`Ordinele de stop loss / take profit ale poziției (${cancels.length + bybitTpsl.length}) se anulează după întoarcere: pune-le din nou pentru poziția nouă.`);
    const preview: ReversePreview = {
      ticket: t,
      displaySymbol: close.displaySymbol,
      base: m.base,
      from: { side: t.side, amount: size },
      to: { side: to, amount: size },
      leverage,
      marginMode: mode,
      last: close.last,
      cancels: cancels.length + bybitTpsl.length,
      hedged,
      warnings,
      errors,
      env: '',
    };
    return { preview, internal: { close, open, cancels, bybitTpsl: bybitTpsl.length > 0, hedged } };
  }

  async reverse(plan: ReversePlan): Promise<ModifyResult> {
    const it = plan.internal as { close: OrderPreview; open: OrderPreview; cancels: Order[]; bybitTpsl: boolean; hedged: boolean };
    const t = plan.preview.ticket;
    const results: (ModifyStepResult & { unknown?: boolean })[] = [];
    const push = (what: string, ok: boolean, orderId: string | null, message: string | null, unknown = false, cancelled?: string) => results.push({ change: 0, what, ok, orderId, message, ...(unknown ? { unknown } : {}), ...(cancelled ? { cancelled } : {}) });
    const finish = (): ModifyResult => {
      this.log.info(`trading: ${this.exchange} reverse ${t.symbol} ${t.side}: ${results.map((r) => `${r.what}:${r.ok ? 'ok' : 'fail'}`).join(', ')}`);
      return { status: modifyStatus(results), steps: results.map(({ unknown: _u, ...r }) => r) };
    };
    // 1. The position closed. Nothing else goes out when that fails or is unknown.
    try {
      const r = await this.place(it.close);
      if (r.status === 'rejected') {
        push('închiderea poziției', false, r.orderId, r.message);
        return finish();
      }
      push('poziția închisă', true, r.orderId, null);
    } catch (caught) {
      const e = tradingErrorOf(caught, true);
      push('închiderea poziției', false, null, e.message, e.code === 'UNKNOWN_OUTCOME');
      return finish();
    }
    // 2. The opposite one opened.
    try {
      const r = await this.place(it.open);
      if (r.status === 'rejected') push('deschiderea poziției opuse', false, r.orderId, `Poziția a fost închisă, dar cea opusă a fost refuzată: ${r.message ?? ''}`.trim());
      else push('poziția opusă deschisă', true, r.orderId, null);
    } catch (caught) {
      const e = tradingErrorOf(caught, true);
      push('deschiderea poziției opuse', false, null, `Poziția a fost închisă, dar cea opusă ${e.code === 'UNKNOWN_OUTCOME' ? 'poate să nu se fi deschis' : 'n-a putut fi deschisă'}: ${e.message}`, e.code === 'UNKNOWN_OUTCOME');
      if (e.code === 'UNKNOWN_OUTCOME') return finish();
    }
    // 3. The old position's stop loss / take profit: they belonged to it.
    const ex = await this.withMarkets('futures');
    const m = this.marketOf(ex, 'futures', t.symbol);
    for (const o of it.cancels) {
      try {
        await this.cancelOpen(ex, o, t.symbol, 'futures');
        push('ordin SL / TP vechi anulat', true, String(o.id), null, false, String(o.id));
      } catch (caught) {
        push('ordin SL / TP vechi anulat', false, String(o.id), `Nu s-a putut anula (${tradingErrorOf(caught, false).message}): anulează-l din listă.`);
      }
    }
    if (it.bybitTpsl) {
      // Bybit: the old position's own TP / SL taken off (0), in its slot.
      const fn = (ex as unknown as Record<string, (q: object) => Promise<unknown>>).privatePostV5PositionTradingStop;
      try {
        await fn?.call(ex, { category: 'linear', symbol: m.id, tpslMode: 'Full', positionIdx: it.hedged ? (t.side === 'long' ? 1 : 2) : 0, stopLoss: '0', takeProfit: '0' });
        push('SL / TP vechi șterse', true, null, null);
      } catch (caught) {
        push('SL / TP vechi șterse', false, null, tradingErrorOf(caught, false).message);
      }
    }
    return finish();
  }

  /** One planned change, as one or two requests; each request's outcome is reported. */
  private async runStep(
    ex: Exchange,
    m: Market,
    it: ModifyInternal,
    step: ModifyInternal['steps'][number],
    report: (what: string, ok: boolean, orderId: string | null, message: string | null, unknown?: boolean, cancelled?: string) => void,
  ): Promise<void> {
    const { plan: p, order: o, role } = step;
    const futures = it.market === 'futures';
    const symbol = it.symbol;
    const a = p.after;
    const pos = it.position;
    const closing: 'buy' | 'sell' = pos ? (pos.side === 'long' ? 'sell' : 'buy') : (p.side ?? 'sell');
    const hedgeParams = (): Record<string, unknown> => (it.hedged ? { hedged: true } : {});
    const str = (v: number | null) => (v === null ? '0' : ex.priceToPrecision(symbol, v));

    // A new order that only closes the position at `level` (a stop loss or take profit), sized as the order or position.
    const placeProtection = async (what: 'sl' | 'tp', level: number, contracts: number): Promise<string | null> => {
      const params: Record<string, unknown> = { [what === 'sl' ? 'stopLossPrice' : 'takeProfitPrice']: level, reduceOnly: true, ...hedgeParams() };
      if (futures) await this.prepareFutures(ex, m, { side: closing, reduceOnly: true, marginMode: step.mode ?? undefined } as OrderTicket, params, it.hedged);
      const n = await ex.createOrder(symbol, 'market', closing, contracts, undefined, params);
      return n.id ? String(n.id) : null;
    };
    // A copy of an order with the values changed (a replacement), through the same requests as a new order. Its trigger
    // fires the way the old one did: an order that only closes a futures position goes out as the stop loss / take
    // profit it is (a limit one stays a limit), any other as a stop that rises or falls to its trigger.
    const placeCopy = async (): Promise<string | null> => {
      if (!o) return null;
      const side = o.side === 'sell' ? 'sell' : 'buy';
      const amount = a.amount ?? num(o.amount) ?? 0;
      const reduce = Boolean(o.reduceOnly) || role !== null;
      const params: Record<string, unknown> = { ...hedgeParams() };
      const info = infoOf(o);
      if (futures) {
        const lev = num(info.leverage) ?? num((o as { leverage?: unknown }).leverage);
        if (!reduce && lev === null) throw new TradingError('REJECTED', 'Levierul ordinului nu se poate citi: ordinul nu se poate înlocui de aici. Anulează-l și pune altul.');
        if (reduce) params.reduceOnly = true;
        await this.prepareFutures(ex, m, { side, reduceOnly: reduce, marginMode: step.mode ?? undefined, leverage: lev ?? undefined } as OrderTicket, params, it.hedged);
        if (!reduce && this.platform.futures?.tpsl === 'attached') {
          if (a.stopLoss !== null) params.stopLoss = { triggerPrice: a.stopLoss };
          if (a.takeProfit !== null) params.takeProfit = { triggerPrice: a.takeProfit };
        }
      }
      if (a.triggerPrice !== null) {
        const dir = step.dir ?? (side === 'buy' ? 'up' : 'down');
        if (futures && reduce) params[(dir === 'down') === (side === 'sell') ? 'stopLossPrice' : 'takeProfitPrice'] = a.triggerPrice;
        else await this.stopParams(m, { side } as OrderTicket, a.triggerPrice, params, dir);
      }
      const isLimit = a.price !== null;
      const n = await ex.createOrder(symbol, isLimit ? 'limit' : 'market', side, amount, isLimit ? (a.price as number) : undefined, params);
      return n.id ? String(n.id) : null;
    };
    const cancelOld = async () => {
      if (o) await this.cancelOpen(ex, o, symbol, it.market);
    };

    switch (p.how) {
      case 'position': {
        // Bybit: the whole position's TP / SL (0 removes it), in its position slot (hedge: 1 long, 2 short).
        const fn = (ex as unknown as Record<string, (q: object) => Promise<unknown>>).privatePostV5PositionTradingStop;
        if (!fn) throw new TradingError('UNSUPPORTED', 'Exchange-ul nu primește SL / TP de poziție.');
        const side = pos?.side ?? (o ? (orderPositionSide(o.info) ?? (o.side === 'sell' ? 'long' : 'short')) : 'long');
        // Which one: the change's (a position's SL / TP), else the order's own kind (its trigger changed in its form).
        const kind = role ?? (String(o ? infoOf(o).stopOrderType : '') === 'StopLoss' ? 'sl' : 'tp');
        // The new level: an added one's, else the order's trigger (null when removed: 0 takes it off).
        const level = p.removes ? null : o ? a.triggerPrice : kind === 'sl' ? a.stopLoss : a.takeProfit;
        const value = kind === 'sl' ? { stopLoss: str(level) } : { takeProfit: str(level) };
        await fn.call(ex, { category: 'linear', symbol: m.id, tpslMode: 'Full', positionIdx: it.hedged ? (side === 'long' ? 1 : 2) : 0, ...value });
        report(p.removes ? 'șters' : 'modificat', true, p.orderId, null);
        return;
      }
      case 'place': {
        const id = await placeProtection(role as 'sl' | 'tp', (role === 'sl' ? a.stopLoss : a.takeProfit) as number, pos?.contracts ?? (a.amount as number));
        report('ordin nou plasat', true, id, null);
        return;
      }
      case 'cancel':
        await cancelOld();
        report('anulat', true, p.orderId, null, false, p.orderId ?? undefined);
        return;
      case 'amend': {
        if (!o) return;
        const amount = a.amount !== p.before.amount ? (a.amount ?? undefined) : undefined;
        if (this.exchange === 'okx') {
          const okx = ex as unknown as Record<string, (q: object) => Promise<unknown>>;
          const info = infoOf(o);
          const req: Record<string, unknown> = { instId: m.id };
          if (amount !== undefined) req.newSz = ex.amountToPrecision(symbol, amount);
          const tp = a.takeProfit !== p.before.takeProfit ? { newTpTriggerPx: str(a.takeProfit), newTpOrdPx: a.takeProfit === null ? '0' : '-1' } : {};
          const sl = a.stopLoss !== p.before.stopLoss ? { newSlTriggerPx: str(a.stopLoss), newSlOrdPx: a.stopLoss === null ? '0' : '-1' } : {};
          if (this.okxAlgo(o)) {
            req.algoId = info.algoId;
            if (a.triggerPrice !== p.before.triggerPrice && a.triggerPrice !== null) Object.assign(req, { newTriggerPx: str(a.triggerPrice), newOrdPx: a.price !== null ? str(a.price) : '-1' });
            Object.assign(req, tp, sl);
            await okx.privatePostTradeAmendAlgos!.call(ex, req);
          } else {
            req.ordId = String(o.id);
            if (a.price !== p.before.price && a.price !== null) req.newPx = str(a.price);
            const attached = Array.isArray(info.attachAlgoOrds) ? (info.attachAlgoOrds as { attachAlgoId?: string }[])[0] : undefined;
            if (Object.keys(tp).length || Object.keys(sl).length) req.attachAlgoOrds = [{ ...(attached?.attachAlgoId ? { attachAlgoId: attached.attachAlgoId } : {}), ...tp, ...sl }];
            await okx.privatePostTradeAmendOrder!.call(ex, req);
          }
          report(p.removes ? 'șters' : 'modificat', true, p.orderId, null);
          return;
        }
        const params: Record<string, unknown> = {};
        const type = String(o.type ?? (a.price !== null ? 'limit' : 'market'));
        if (this.exchange === 'bybit') {
          if (a.triggerPrice !== p.before.triggerPrice && a.triggerPrice !== null) params.triggerPrice = str(a.triggerPrice);
          if (a.stopLoss !== p.before.stopLoss) params.stopLoss = str(a.stopLoss);
          if (a.takeProfit !== p.before.takeProfit) params.takeProfit = str(a.takeProfit);
        } else if (this.exchange === 'kraken') {
          if (a.triggerPrice !== p.before.triggerPrice && a.triggerPrice !== null) params.stopLossPrice = a.triggerPrice;
        } else if (a.triggerPrice !== null) {
          // Binance spot: a cancel-replace that takes the whole order again, its trigger included.
          params.triggerPrice = a.triggerPrice;
        }
        // Binance futures and Coinbase want the amount and the price even when unchanged.
        const sendAmount = amount ?? (this.exchange === 'binance' || this.exchange === 'coinbase' ? (num(o.amount) ?? undefined) : undefined);
        const price = a.price !== null && (a.price !== p.before.price || this.exchange === 'binance' || this.exchange === 'coinbase') ? a.price : undefined;
        const n = await ex.editOrder(String(o.id), symbol, type, o.side === 'sell' ? 'sell' : 'buy', sendAmount, price, params);
        // A cancel-replace (Binance spot) leaves the old id behind.
        const newId = n?.id ? String(n.id) : p.orderId;
        report('modificat', true, newId, null, false, newId !== p.orderId && p.orderId ? p.orderId : undefined);
        return;
      }
      case 'place-then-cancel': {
        const id = await placeCopy();
        report('ordin nou plasat', true, id, null);
        try {
          await cancelOld();
          report('ordin vechi anulat', true, p.orderId, null, false, p.orderId ?? undefined);
        } catch (err) {
          report('ordin vechi anulat', false, p.orderId, `Ordinul nou e plasat, dar cel vechi n-a putut fi anulat (${tradingErrorOf(err, false).message}): acum sunt amândouă. Anulează-l pe cel vechi din listă.`);
        }
        return;
      }
      case 'cancel-then-place': {
        await cancelOld();
        report('ordin vechi anulat', true, p.orderId, null, false, p.orderId ?? undefined);
        try {
          const id = await placeCopy();
          report('ordin nou plasat', true, id, null);
        } catch (err) {
          const e = tradingErrorOf(err, true);
          report('ordin nou plasat', false, null, `Ordinul vechi a fost anulat, dar cel nou a fost refuzat: ${e.message}`, e.code === 'UNKNOWN_OUTCOME');
        }
        return;
      }
    }
  }
}
