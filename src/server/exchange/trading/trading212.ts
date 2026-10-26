// Trading 212 orders (FD-TRADING; docs.trading212.com, Orders): market (optionally outside the session), limit, stop
// and stop-limit on equities, by quantity (negative = sell), cancelling a pending order. The API is in beta and not
// idempotent: Sentiq's own journal is what keeps a double click from placing twice.
import { createHash } from 'node:crypto';
import { type InstrumentInfo, type OrderPreview, type OrderResult, type OrderTicket, type TradeMarket, type TradeSymbol, type ModifyPreview, type ModifyResult, type ModifyStepPlan, type ModifyTicket } from '../../../shared/trading.ts';
import { brokerCall } from './http.ts';
import { commonChecks, fmtPlain, TradingError, type CancelInput, type Trader, modifyStatus, protectionChecks, type ModifyPlan } from './types.ts';

const INSTRUMENTS_TTL_MS = 24 * 3_600_000;
/**
 * The account summary and the positions answer at most once every few seconds: checking an order and sending it reads
 * them twice in a row, so they are kept briefly (and forgotten once an order or a cancellation went out).
 */
const READ_TTL_MS = 6_000;
const FORBIDDEN = 'cheia nu are permisiunea „Orders: Execute” (fă o cheie nouă cu ea) sau IP-ul nu e permis';

interface T212Instrument {
  ticker: string;
  shortName: string;
  name: string;
  currency: string;
  isin: string | null;
  type: string;
}
/** The instrument list per key (it is the same for everybody, but each key pays its own 1-request-a-minute budget). */
const instrumentCache = new Map<string, { list: T212Instrument[]; at: number }>();

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : typeof v === 'number' ? String(v) : null);
/** AAPL_US_EQ → AAPL, VODl_EQ → VOD (as the portfolio shows them). */
export const t212Head = (ticker: string) => (ticker.split('_')[0] ?? ticker).replace(/[a-z]+$/, '') || ticker;

export class Trading212Trader implements Trader {
  private readonly base: string;
  private readonly auth: string;
  private readonly cacheKey: string;
  private readonly now: () => number;
  private readonly reads = new Map<string, { at: number; data: unknown }>();

  constructor(creds: Record<string, string>, env: string, now: () => number = Date.now) {
    this.base = env === 'demo' ? 'https://demo.trading212.com/api/v0' : 'https://live.trading212.com/api/v0';
    this.auth = `Basic ${Buffer.from(`${creds.apiKey ?? ''}:${creds.secret ?? ''}`).toString('base64')}`;
    this.cacheKey = createHash('sha256').update(this.auth).digest('hex').slice(0, 16);
    this.now = now;
  }

  private call(method: 'GET' | 'POST' | 'DELETE' | 'PATCH', path: string, body?: unknown): Promise<unknown> {
    return brokerCall('Trading 212', `${this.base}${path}`, { method, headers: { Authorization: this.auth }, body, write: method !== 'GET', forbidden: FORBIDDEN });
  }

  async symbols(_market: TradeMarket): Promise<TradeSymbol[]> {
    return [];
  }

  private async instruments(): Promise<T212Instrument[]> {
    const c = instrumentCache.get(this.cacheKey);
    if (c && this.now() - c.at < INSTRUMENTS_TTL_MS) return c.list;
    const raw = await this.call('GET', '/equity/metadata/instruments');
    const list = (Array.isArray(raw) ? raw : [])
      .map((r): T212Instrument | null => {
        const o = r as Record<string, unknown>;
        const ticker = str(o.ticker);
        if (!ticker) return null;
        return { ticker, shortName: (str(o.shortName) ?? t212Head(ticker)).toUpperCase(), name: str(o.name) ?? ticker, currency: str(o.currencyCode) ?? '', isin: str(o.isin), type: str(o.type) ?? '' };
      })
      .filter((x): x is T212Instrument => x !== null);
    instrumentCache.set(this.cacheKey, { list, at: this.now() });
    return list;
  }

  /** A GET kept for a few seconds (see READ_TTL_MS). */
  private async read(path: string): Promise<unknown> {
    const hit = this.reads.get(path);
    if (hit && this.now() - hit.at < READ_TTL_MS) return hit.data;
    const data = await this.call('GET', path);
    this.reads.set(path, { at: this.now(), data });
    return data;
  }

  private async summary(): Promise<{ currency: string; cash: number | null }> {
    const s = ((await this.read('/equity/account/summary')) ?? {}) as Record<string, unknown>;
    return { currency: str(s.currency) ?? 'EUR', cash: num((s.cash as Record<string, unknown> | undefined)?.availableToTrade) };
  }

  /** The instrument for a symbol: a ticker as is (AAPL_US_EQ), else by short name, the account's currency first, then US. */
  private async resolve(symbol: string, currency: string): Promise<T212Instrument> {
    const s = symbol.trim();
    const list = await this.instruments();
    if (s.includes('_')) {
      const exact = list.find((i) => i.ticker === s);
      if (exact) return exact;
    }
    const want = s.toUpperCase().replace(/\/.*$/, '');
    const found = list.filter((i) => (i.shortName === want || t212Head(i.ticker).toUpperCase() === want) && /STOCK|ETF/i.test(i.type));
    if (found.length === 0) throw new TradingError('INVALID', `Trading 212 nu are simbolul ${want}.`);
    return found.find((i) => i.currency === currency) ?? found.find((i) => i.ticker.endsWith('_US_EQ')) ?? (found[0] as T212Instrument);
  }

  private async holding(ticker: string): Promise<{ quantity: number; free: number; price: number | null; avg: number | null } | null> {
    try {
      const list = await this.read('/equity/positions');
      for (const p of Array.isArray(list) ? list : []) {
        const o = p as Record<string, unknown>;
        const ins = (o.instrument as Record<string, unknown> | undefined) ?? {};
        if ((str(ins.ticker) ?? str(o.ticker)) !== ticker) continue;
        const quantity = num(o.quantity) ?? 0;
        return { quantity, free: num(o.quantityAvailableForTrading) ?? quantity, price: num(o.currentPrice), avg: num(o.averagePricePaid) };
      }
    } catch {
      // Not readable now: no holding shown.
    }
    return null;
  }

  async instrument(_market: TradeMarket, symbol: string): Promise<InstrumentInfo> {
    const { currency, cash } = await this.summary();
    const ins = await this.resolve(symbol, currency);
    const held = await this.holding(ins.ticker);
    return {
      market: 'stock',
      symbol: t212Head(ins.ticker),
      ref: ins.ticker,
      name: `${ins.name}${ins.isin ? ` · ${ins.isin}` : ''}`,
      currency: ins.currency || currency,
      base: t212Head(ins.ticker),
      last: held?.price ?? null,
      amountStep: null,
      minAmount: null,
      minCost: null,
      priceStep: null,
      contractSize: null,
      maxLeverage: null,
      availableQuote: cash,
      availableBase: held?.free ?? 0,
      position: null,
    };
  }

  async normalize(t: OrderTicket): Promise<OrderPreview> {
    const { currency, cash } = await this.summary();
    const ins = await this.resolve(t.symbol, currency);
    const held = await this.holding(ins.ticker);
    const warnings: string[] = [];
    const errors: string[] = [];
    if (t.market !== 'stock') errors.push('Trading 212 are doar acțiuni și ETF-uri.');
    if (!['market', 'limit', 'stop', 'stop_limit'].includes(t.kind)) errors.push('Trading 212 primește ordine la piață, limită, stop și stop-limită.');
    if (t.amountIn !== 'base') errors.push('Trading 212 primește ordine doar pe cantitate (numărul de acțiuni).');
    if (t.takeProfit !== undefined || t.stopLoss !== undefined || t.leverage !== undefined) errors.push('Trading 212 nu are TP / SL atașate sau levier prin API.');
    const amount = Number(t.amount.toFixed(8));
    if (t.side === 'sell') {
      if (!held || held.free <= 0) errors.push(`Nu deții ${t212Head(ins.ticker)} în acest cont (Trading 212 nu vinde în lipsă).`);
      else if (amount > held.free + 1e-9) errors.push(`Ai disponibil ${fmtPlain(held.free)} ${t212Head(ins.ticker)}; vinzi ${fmtPlain(amount)}.`);
    }
    const ref = t.price ?? t.triggerPrice ?? held?.price ?? null;
    const value = ref !== null ? amount * ref : null;
    if (t.side === 'buy' && value !== null && cash !== null && ins.currency === currency) {
      if (value > cash) warnings.push(`Numerar disponibil: ${fmtPlain(cash)} ${currency}; ordinul cere aproximativ ${fmtPlain(value)}.`);
      else if (value > cash * 0.5) warnings.push(`Ordinul folosește peste jumătate din numerarul disponibil (${fmtPlain(cash)} ${currency}).`);
    }
    if (ins.currency && ins.currency !== currency) warnings.push(`Instrumentul e în ${ins.currency}, contul în ${currency}: Trading 212 face conversia la executare.`);
    if (t.kind === 'market') warnings.push('Dacă piața e închisă, Trading 212 execută ordinul la deschidere.');
    commonChecks(t, { last: held?.price ?? null, entry: null }, { warnings, errors }, fmtPlain);
    return {
      ticket: { ...t, symbol: ins.ticker, amount, amountIn: 'base' },
      // The exact instrument (the same short name trades on several exchanges): name, ISIN, Trading 212's ticker.
      displaySymbol: `${t212Head(ins.ticker)} · ${ins.name}${ins.isin ? ` · ${ins.isin}` : ''} (${ins.ticker})`,
      amount,
      contracts: null,
      price: t.price ?? null,
      triggerPrice: t.triggerPrice ?? null,
      last: held?.price ?? null,
      value,
      margin: null,
      available: t.side === 'buy' ? cash : (held?.free ?? 0),
      currency: ins.currency || currency,
      env: 'live',
      warnings,
      errors,
    };
  }

  async place(preview: OrderPreview): Promise<OrderResult> {
    const t = preview.ticket;
    const quantity = t.side === 'sell' ? -preview.amount : preview.amount;
    const validity = t.tif === 'day' ? 'DAY' : 'GOOD_TILL_CANCEL';
    const body: Record<string, unknown> = { ticker: t.symbol, quantity };
    let path = '/equity/orders/market';
    if (t.kind === 'market') {
      if (t.extendedHours) body.extendedHours = true;
    } else if (t.kind === 'limit') {
      path = '/equity/orders/limit';
      Object.assign(body, { limitPrice: t.price, timeValidity: validity });
    } else if (t.kind === 'stop') {
      path = '/equity/orders/stop';
      Object.assign(body, { stopPrice: t.triggerPrice, timeValidity: validity });
    } else {
      path = '/equity/orders/stop_limit';
      Object.assign(body, { stopPrice: t.triggerPrice, limitPrice: t.price, timeValidity: validity });
    }
    this.reads.clear();
    const r = ((await this.call('POST', path, body)) ?? {}) as Record<string, unknown>;
    const s = (str(r.status) ?? '').toUpperCase();
    const status = s === 'FILLED' ? 'filled' : s === 'REJECTED' ? 'rejected' : s === 'CANCELLED' ? 'cancelled' : 'open';
    return { status, orderId: str(r.id), message: s === 'REJECTED' ? 'Trading 212 a refuzat ordinul.' : null, followUps: [] };
  }

  async cancel(input: CancelInput): Promise<OrderResult> {
    if (!/^\d+$/.test(input.orderId)) throw new TradingError('INVALID', 'Ordinul nu e unul Trading 212.');
    this.reads.clear();
    await this.call('DELETE', `/equity/orders/${input.orderId}`);
    return { status: 'cancelled', orderId: input.orderId, message: 'Anularea a fost cerută (nu e garantată dacă ordinul se execută chiar acum).', followUps: [] };
  }

  // ---------------- FD-ORDEREDIT: Trading 212 has no change of an order: it is cancelled, then placed again ----------------

  async normalizeModify(t: ModifyTicket): Promise<ModifyPlan> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const steps: ModifyStepPlan[] = [];
    const orders: Record<string, unknown>[] = [];
    for (const [i, c] of t.changes.entries()) {
      if (c.orderId === null) {
        errors.push('La Trading 212, un SL / TP nou se pune cu un ordin nou (stop sau limită de vânzare).');
        continue;
      }
      if (!/^\d+$/.test(c.orderId)) {
        errors.push('Ordinul nu e unul Trading 212.');
        continue;
      }
      let o: Record<string, unknown>;
      try {
        o = ((await this.call('GET', `/equity/orders/${c.orderId}`)) ?? {}) as Record<string, unknown>;
      } catch (err) {
        if (err instanceof TradingError && err.code === 'NOT_FOUND') {
          errors.push('Ordinul nu mai e deschis (poate s-a executat sau a fost anulat).');
          continue;
        }
        throw err;
      }
      const type = (str(o.type) ?? '').toUpperCase();
      const qty = num(o.quantity) ?? 0;
      const side = qty < 0 ? 'sell' : 'buy';
      const before = { price: num(o.limitPrice), triggerPrice: num(o.stopPrice), amount: Math.abs(qty), takeProfit: null, stopLoss: null };
      const after = { ...before };
      if (type === 'MARKET' || !type) {
        errors.push('Un ordin la piață nu se modifică.');
        continue;
      }
      if (c.what === 'order') {
        if (c.takeProfit !== undefined || c.stopLoss !== undefined) errors.push('Trading 212 nu are TP / SL atașate.');
        if (c.price !== undefined) after.price = c.price;
        if (c.triggerPrice !== undefined) after.triggerPrice = c.triggerPrice;
        if (c.amount !== undefined) after.amount = c.amount;
      } else if (t.position && side !== (t.position.side === 'long' ? 'sell' : 'buy')) {
        errors.push('Ordinul nu închide această poziție.');
        continue;
      } else if (c.level === null) {
        steps.push({ change: i, how: 'cancel', orderId: c.orderId, side, kind: c.what, before, after: before, removes: true });
        orders.push(o);
        if (c.what === 'sl') warnings.push('Fără stop loss, pierderea poziției nu mai e limitată de un ordin.');
        continue;
      } else {
        if (before.triggerPrice !== null) after.triggerPrice = c.level;
        else after.price = c.level;
        if (t.position) protectionChecks(c.what, t.position.side === 'long', c.level, null, { errors }, fmtPlain);
      }
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      steps.push({ change: i, how: 'cancel-then-place', orderId: c.orderId, side, kind: type.toLowerCase(), before, after, removes: false });
      orders.push(o);
    }
    if (steps.some((s) => s.how === 'cancel-then-place')) {
      warnings.push('Trading 212 nu modifică un ordin: cel vechi se anulează, apoi se plasează unul nou. O clipă, ordinul nu există; dacă cel nou e refuzat, cel vechi rămâne anulat.');
      warnings.push('Trading 212 nu arată valabilitatea ordinului: cel nou e „până la anulare”.');
    }
    if (!steps.length && !errors.length) errors.push('Nimic nu se schimbă: valorile sunt cele de acum.');
    const preview: ModifyPreview = { ticket: t, displaySymbol: t.symbol, last: null, currency: '', env: '', steps, warnings: [...new Set(warnings)], errors };
    return { preview, internal: { orders } };
  }

  async modify(plan: ModifyPlan): Promise<ModifyResult> {
    const { orders } = plan.internal as { orders: Record<string, unknown>[] };
    const results: (ModifyResult['steps'][number] & { unknown?: boolean })[] = [];
    for (const [i, s] of plan.preview.steps.entries()) {
      const o = orders[i] as Record<string, unknown>;
      try {
        await this.cancel({ orderId: s.orderId as string, symbol: plan.preview.ticket.symbol, market: 'stock', trigger: false });
        results.push({ change: s.change, what: 'ordin vechi anulat', ok: true, orderId: s.orderId, message: null, ...(s.orderId ? { cancelled: s.orderId } : {}) });
      } catch (err) {
        // Not cancelled (it may have just been filled): nothing new goes out.
        results.push({ change: s.change, what: 'eroare', ok: false, orderId: s.orderId, message: (err as Error).message });
        continue;
      }
      if (s.how === 'cancel') continue;
      const ticker = str(o.ticker) as string;
      const quantity = s.side === 'sell' ? -(s.after.amount as number) : (s.after.amount as number);
      const kind = (str(o.type) ?? '').toUpperCase();
      const body: Record<string, unknown> = { ticker, quantity, timeValidity: 'GOOD_TILL_CANCEL' };
      if (kind === 'LIMIT' || kind === 'STOP_LIMIT') body.limitPrice = s.after.price;
      if (kind === 'STOP' || kind === 'STOP_LIMIT') body.stopPrice = s.after.triggerPrice;
      try {
        this.reads.clear();
        const r = ((await this.call('POST', `/equity/orders/${kind.toLowerCase()}`, body)) ?? {}) as Record<string, unknown>;
        results.push({ change: s.change, what: 'ordin nou plasat', ok: true, orderId: str(r.id), message: null });
      } catch (err) {
        const unknown = err instanceof TradingError && err.code === 'UNKNOWN_OUTCOME';
        results.push({ change: s.change, what: 'ordin nou plasat', ok: false, orderId: null, message: `Ordinul vechi a fost anulat, dar cel nou a fost refuzat: ${(err as Error).message}`, ...(unknown ? { unknown } : {}) });
        if (unknown) break;
      }
    }
    return { status: modifyStatus(results), steps: results.map(({ unknown: _u, ...r }) => r) };
  }
}

/** Test hook. */
export function resetTrading212Cache(): void {
  instrumentCache.clear();
}
