// Orders on the crypto exchanges through ccxt (FD-TRADING, TD-TRADING §3): spot on all seven, USDT perpetuals on
// KuCoin, Binance, Bybit, OKX and Bitget. ccxt builds each exchange's request; this file chooses the client, rounds
// and checks the order, sets leverage / margin where the exchange wants it before the order, and maps the errors.
// Nothing here is retried: an order sent twice could be filled twice.
import ccxt, { type Exchange, type MarketInterface as Market } from 'ccxt';
import { TRADING, type InstrumentInfo, type OrderFollowUp, type OrderPreview, type OrderResult, type OrderTicket, type TradeMarket, type TradeSymbol } from '../../../shared/trading.ts';
import type { Logger } from '../../log.ts';
import { FUTURES_BALANCE, type ExchangeClients } from '../accounts.ts';
import { clientIdOf, commonChecks, fmtPlain, TradingError, UNKNOWN_OUTCOME_MESSAGE, type CancelInput, type Trader } from './types.ts';

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const QUOTE_ORDER = ['USDT', 'USDC', 'USD', 'EUR', 'BTC'];
const POSITION_MODE_TTL_MS = 10 * 60_000;

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
  if (/position\s*(idx|side)|hedge|positionSide|posSide/i.test(raw)) {
    return new TradingError('HEDGE_MODE', 'Contul pare să fie în modul hedge (poziții long și short separate). Sentiq trimite ordine futures doar în modul one-way: îl schimbi din setările exchange-ului.');
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

  /** Free quote and base (spot), or free USDT and the open position (futures); null where it cannot be read. */
  private async availability(ex: Exchange, market: TradeMarket, m: Market): Promise<Pick<InstrumentInfo, 'availableQuote' | 'availableBase' | 'position'>> {
    const free = (bal: unknown, code: string) => num(((bal as { free?: Record<string, unknown> }).free ?? {})[code]);
    try {
      if (market === 'spot') {
        const classicKucoin = this.exchange === 'kucoin' && !(await this.isUta());
        const bal = await ex.fetchBalance(classicKucoin ? { type: 'trade' } : {});
        return { availableQuote: free(bal, m.quote) ?? 0, availableBase: free(bal, m.base) ?? 0, position: null };
      }
      const how = FUTURES_BALANCE[this.exchange];
      const bal = this.exchange === 'kucoin' && ex === this.clients.futures ? await ex.fetchBalance({ code: 'USDT' }) : await ex.fetchBalance(how && how !== 'spot' ? how : {});
      let position: InstrumentInfo['position'] = null;
      try {
        const list = await ex.fetchPositions([m.symbol]);
        const p = list.find((x) => x.symbol === m.symbol && (num(x.contracts) ?? 0) > 0);
        if (p) position = { side: p.side === 'short' ? 'short' : 'long', amount: (num(p.contracts) ?? 0) * (m.contractSize ?? 1), entryPrice: num(p.entryPrice) };
      } catch {
        // No position read: the form simply shows none.
      }
      return { availableQuote: free(bal, 'USDT') ?? 0, availableBase: null, position };
    } catch {
      return { availableQuote: null, availableBase: null, position: null };
    }
  }

  async instrument(market: TradeMarket, symbol: string): Promise<InstrumentInfo> {
    const ex = await this.withMarkets(market);
    const m = this.marketOf(ex, market, symbol);
    const size = market === 'futures' ? (m.contractSize ?? 1) : 1;
    const step = num(m.precision?.amount);
    const [{ last }, avail] = await Promise.all([this.lastPrice(ex, symbol), this.availability(ex, market, m)]);
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
    if ((t.takeProfit !== undefined || t.stopLoss !== undefined) && !futures) errors.push('TP / SL se pot atașa doar ordinelor futures.');
    if ((t.takeProfit !== undefined || t.stopLoss !== undefined) && t.reduceOnly) errors.push('TP / SL nu se atașează unui ordin reduce-only (el doar închide).');
    if (futures && (t.takeProfit !== undefined || t.stopLoss !== undefined)) {
      if (p.futures?.tpsl === 'none') errors.push('TP / SL nu se pot atașa aici.');
      if (p.futures?.tpsl === 'after-market' && t.kind !== 'market') errors.push('Pe acest exchange TP / SL se trimit după o intrare la piață: pentru alt tip de ordin, pune-le după ce se execută.');
    }

    const [{ last, bid, ask }, avail] = await Promise.all([this.lastPrice(ex, t.symbol), this.availability(ex, t.market, m)]);
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
    if (t.reduceOnly && futures && !avail.position) warnings.push(`Nu e nicio poziție deschisă pe ${t.symbol}: un ordin reduce-only nu are ce micșora.`);
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
      warnings,
      errors,
    };
  }

  /** Hedge mode (separate long and short positions) is refused: the orders here are one-way. */
  private async assertOneWay(ex: Exchange, m: Market): Promise<{ bitgetOneWay: boolean }> {
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
        } else if (ex.has.fetchPositionMode) {
          hedged = Boolean((await ex.fetchPositionMode(m.symbol)).hedged);
        }
      } catch (err) {
        throw tradingErrorOf(err, false);
      }
      if (hedged !== null) this.positionModes.set(key, { hedged, at: Date.now() });
    }
    if (hedged === true) {
      throw new TradingError('HEDGE_MODE', 'Contul e în modul hedge (poziții long și short separate). Sentiq trimite ordine futures doar în modul one-way: îl schimbi din setările exchange-ului.');
    }
    // Classic Bitget wants one-way named with every order; the unified account reads it from the account.
    return { bitgetOneWay: this.exchange === 'bitget' && !(await this.bitgetMode(ex)).uta };
  }

  /**
   * Leverage and margin mode before the order, where the exchange keeps them per symbol. A reduce-only order (closing)
   * changes neither: it only names the position's margin mode where the exchange asks for it with every order.
   */
  private async prepareFutures(ex: Exchange, m: Market, t: OrderTicket, params: Record<string, unknown>): Promise<void> {
    const lev = t.leverage ?? 1;
    const mode = t.marginMode;
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
        await setIgnoring(() => ex.setLeverage(lev, m.symbol, { marginMode: mode ?? 'cross' }));
        params.marginMode = mode ?? 'cross';
        return;
      case 'bitget':
        if (bitgetUta) {
          // Cross only from here (isolated is refused by the check): the v3 leverage call defaults to it.
          await setIgnoring(() => ex.setLeverage(lev, m.symbol));
          params.marginMode = 'crossed';
          return;
        }
        await setIgnoring(() => ex.setLeverage(lev, m.symbol, { marginMode: mode ?? 'cross' }));
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
  private async stopParams(m: Market, t: OrderTicket, trigger: number, params: Record<string, unknown>): Promise<void> {
    const up = t.side === 'buy';
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
    if (futures) {
      const { bitgetOneWay } = await this.assertOneWay(ex, m);
      if (bitgetOneWay) params.oneWayMode = true;
      await this.prepareFutures(ex, m, t, params);
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
          const o = await ex.createOrder(t.symbol, 'market', closing, contracts, undefined, { [key]: v, reduceOnly: true });
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
}
