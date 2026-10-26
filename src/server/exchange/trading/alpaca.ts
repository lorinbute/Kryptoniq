// Alpaca orders (FD-TRADING; docs.alpaca.markets, POST /v2/orders): shares market / limit / stop / stop-limit, day or
// good-till-cancelled; fractional or by dollar amount (any of the four, day only); TP / SL as a bracket (whole shares,
// not outside the session); extended hours (limit); crypto market / limit / stop-limit, good-till-cancelled. Cancelling,
// closing a position.
import { type InstrumentInfo, type OrderPreview, type OrderResult, type OrderTicket, type TradeMarket, type TradeSymbol, type ModifyPreview, type ModifyResult, type ModifyStepPlan, type ModifyTicket } from '../../../shared/trading.ts';
import { brokerCall } from './http.ts';
import { commonChecks, fmtPlain, TradingError, type CancelInput, type Trader, modifyStatus, protectionChecks, type ModifyPlan } from './types.ts';

const FORBIDDEN = 'cheia nu are acces la tranzacționare pe acest cont';
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : typeof v === 'number' ? String(v) : null);
const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Alpaca's coins are pairs (BTC/USD); a bare coin symbol from a chart is turned into one. */
const CRYPTO = /^(BTC|ETH|SOL|LTC|DOGE|AVAX|LINK|UNI|AAVE|DOT|BCH|SHIB|XRP|XTZ|SUSHI|YFI|BAT|CRV|GRT|MKR|PEPE|TRUMP|USDT|USDC)$/;

export class AlpacaTrader implements Trader {
  private readonly base: string;
  private readonly headers: Record<string, string>;

  constructor(creds: Record<string, string>, env: string) {
    this.base = env === 'paper' ? 'https://paper-api.alpaca.markets' : 'https://api.alpaca.markets';
    this.headers = { 'APCA-API-KEY-ID': creds.keyId ?? '', 'APCA-API-SECRET-KEY': creds.secret ?? '' };
  }

  private call(method: 'GET' | 'POST' | 'DELETE' | 'PATCH', url: string, body?: unknown): Promise<unknown> {
    return brokerCall('Alpaca', url.startsWith('http') ? url : `${this.base}${url}`, { method, headers: this.headers, body, write: method !== 'GET', forbidden: FORBIDDEN });
  }

  async symbols(_market: TradeMarket): Promise<TradeSymbol[]> {
    return [];
  }

  private symbolOf(raw: string): string {
    const s = raw.trim().toUpperCase();
    if (s.includes('/')) return s.replace(/\/USDT$/, '/USD');
    return CRYPTO.test(s) ? `${s}/USD` : s;
  }

  private async asset(symbol: string): Promise<{ symbol: string; name: string; crypto: boolean; fractionable: boolean }> {
    let a: Record<string, unknown>;
    try {
      a = obj(await this.call('GET', `/v2/assets/${encodeURIComponent(symbol)}`));
    } catch (err) {
      if (err instanceof TradingError && err.code === 'NOT_FOUND') throw new TradingError('INVALID', `Alpaca nu are simbolul ${symbol}.`);
      throw err;
    }
    if (a.tradable === false) throw new TradingError('INVALID', `${symbol} nu se poate tranzacționa la Alpaca acum.`);
    return { symbol: str(a.symbol) ?? symbol, name: str(a.name) ?? symbol, crypto: str(a.class) === 'crypto', fractionable: a.fractionable === true };
  }

  private async last(symbol: string, crypto: boolean): Promise<number | null> {
    try {
      if (crypto) {
        const r = obj(await this.call('GET', `https://data.alpaca.markets/v1beta3/crypto/us/latest/trades?symbols=${encodeURIComponent(symbol)}`));
        return num(obj(obj(r.trades)[symbol]).p);
      }
      const r = obj(await this.call('GET', `https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol)}/trades/latest?feed=iex`));
      return num(obj(r.trade).p);
    } catch {
      return null;
    }
  }

  private async account(): Promise<{ buyingPower: number | null; cash: number | null }> {
    const a = obj(await this.call('GET', '/v2/account'));
    return { buyingPower: num(a.buying_power), cash: num(a.cash) };
  }

  private async position(symbol: string): Promise<{ qty: number; free: number; side: 'long' | 'short'; entry: number | null; price: number | null } | null> {
    try {
      const p = obj(await this.call('GET', `/v2/positions/${encodeURIComponent(symbol.replace('/', ''))}`));
      const qty = num(p.qty) ?? 0;
      return { qty: Math.abs(qty), free: Math.abs(num(p.qty_available) ?? qty), side: str(p.side) === 'short' ? 'short' : 'long', entry: num(p.avg_entry_price), price: num(p.current_price) };
    } catch {
      return null;
    }
  }

  async instrument(_market: TradeMarket, raw: string): Promise<InstrumentInfo> {
    const a = await this.asset(this.symbolOf(raw));
    const [acct, pos, last] = await Promise.all([this.account(), this.position(a.symbol), this.last(a.symbol, a.crypto)]);
    return {
      market: 'stock',
      symbol: a.symbol,
      ref: null,
      name: a.name,
      currency: 'USD',
      base: a.symbol.replace(/\/USD$/, ''),
      last: last ?? pos?.price ?? null,
      amountStep: a.fractionable || a.crypto ? null : 1,
      minAmount: null,
      minCost: a.fractionable || a.crypto ? 1 : null,
      priceStep: null,
      contractSize: null,
      maxLeverage: null,
      availableQuote: acct.buyingPower,
      availableBase: pos && pos.side === 'long' ? pos.free : 0,
      position: pos ? { side: pos.side, amount: pos.qty, entryPrice: pos.entry } : null,
    };
  }

  async normalize(t: OrderTicket): Promise<OrderPreview> {
    const a = await this.asset(this.symbolOf(t.symbol));
    const [acct, pos, lastRead] = await Promise.all([this.account(), this.position(a.symbol), this.last(a.symbol, a.crypto)]);
    const last = lastRead ?? pos?.price ?? null;
    const warnings: string[] = [];
    const errors: string[] = [];
    const tif = a.crypto ? 'gtc' : (t.tif ?? 'day');
    const bracket = t.takeProfit !== undefined || t.stopLoss !== undefined;
    if (!['market', 'limit', 'stop', 'stop_limit'].includes(t.kind) || (a.crypto && t.kind === 'stop')) errors.push(a.crypto ? 'Pentru crypto, Alpaca primește ordine la piață, limită și stop-limită.' : 'Alpaca primește ordine la piață, limită, stop și stop-limită.');
    if (t.leverage !== undefined) errors.push('Levierul la Alpaca e al contului (marja), nu al ordinului.');
    const byValue = t.amountIn === 'quote';
    const fractional = !byValue && !Number.isInteger(t.amount);
    if ((byValue || fractional) && !a.crypto) {
      if (!a.fractionable) errors.push(`${a.symbol} nu se tranzacționează fracționat la Alpaca: cantitatea trebuie să fie un număr întreg de acțiuni.`);
      if (tif !== 'day') errors.push(`${byValue ? 'Pe sumă' : 'Fracționat'}, Alpaca primește doar ordine valabile o zi: alege „până la sfârșitul zilei”.`);
    }
    if (bracket) {
      if (a.crypto) errors.push('Alpaca nu are TP / SL atașate pentru crypto.');
      if (fractional || byValue) errors.push('TP / SL (bracket) cer o cantitate întreagă de acțiuni.');
      if (t.kind === 'stop' || t.kind === 'stop_limit') errors.push('TP / SL (bracket) se pot atașa doar unui ordin la piață sau limită.');
      if (t.extendedHours) errors.push('TP / SL (bracket) nu merg în afara orelor de tranzacționare.');
    }
    if (t.extendedHours && (t.kind !== 'limit' || a.crypto)) errors.push('În afara orelor, Alpaca primește doar ordine limită pe acțiuni.');
    const ref = t.price ?? t.triggerPrice ?? last;
    const amount = byValue ? (ref ? t.amount / ref : 0) : t.amount;
    const value = byValue ? t.amount : ref !== null ? t.amount * ref : null;
    if (t.side === 'buy' && value !== null && acct.buyingPower !== null) {
      if (value > acct.buyingPower) warnings.push(`Putere de cumpărare: ${fmtPlain(acct.buyingPower)} USD; ordinul cere ${fmtPlain(value)}.`);
      else if (value > acct.buyingPower * 0.5) warnings.push(`Ordinul folosește peste jumătate din puterea de cumpărare (${fmtPlain(acct.buyingPower)} USD).`);
    }
    // FD-HEDGEALL: Alpaca keeps one position per symbol (long or short, net): no long and short side by side.
    if (t.side === 'sell' && (!pos || pos.side === 'long')) {
      const free = pos?.free ?? 0;
      if (amount > free + 1e-9) {
        warnings.push(
          free > 0
            ? `Alpaca ține o singură poziție pe simbol: vânzarea închide întâi long-ul de ${fmtPlain(free)} ${a.symbol}, iar peste el deschide un short (dacă contul permite short). Nu există long și short în același timp.`
            : `Nu deții ${a.symbol}: vânzarea deschide o poziție short (dacă contul permite).`,
        );
      }
    }
    if (t.side === 'buy' && pos?.side === 'short') {
      warnings.push(
        amount > pos.qty + 1e-9
          ? `Alpaca ține o singură poziție pe simbol: cumpărarea acoperă întâi short-ul de ${fmtPlain(pos.qty)} ${a.symbol}, iar peste el deschide un long.`
          : `Alpaca ține o singură poziție pe simbol: cumpărarea micșorează short-ul de ${fmtPlain(pos.qty)} ${a.symbol} (nu deschide un long separat).`,
      );
    }
    if (!a.crypto && t.kind === 'market') warnings.push('Dacă piața e închisă, Alpaca execută ordinul la deschidere (valabil o zi).');
    commonChecks(t, { last, entry: t.price ?? last }, { warnings, errors }, fmtPlain);
    return {
      ticket: { ...t, symbol: a.symbol, tif },
      displaySymbol: `${a.symbol} · ${a.name}`,
      amount,
      contracts: null,
      price: t.price ?? null,
      triggerPrice: t.triggerPrice ?? null,
      last,
      value,
      margin: null,
      available: t.side === 'buy' ? acct.buyingPower : (pos?.free ?? 0),
      currency: 'USD',
      env: 'live',
      warnings,
      errors,
    };
  }

  async place(preview: OrderPreview): Promise<OrderResult> {
    const t = preview.ticket;
    const type = t.kind === 'stop_limit' ? 'stop_limit' : t.kind;
    const body: Record<string, unknown> = {
      symbol: t.symbol,
      side: t.side,
      type,
      time_in_force: t.tif ?? 'day',
      client_order_id: t.idemKey,
      ...(t.amountIn === 'quote' ? { notional: String(t.amount) } : { qty: String(t.amount) }),
      ...(t.price !== undefined ? { limit_price: String(t.price) } : {}),
      ...(t.triggerPrice !== undefined ? { stop_price: String(t.triggerPrice) } : {}),
      ...(t.extendedHours ? { extended_hours: true } : {}),
    };
    if (t.takeProfit !== undefined || t.stopLoss !== undefined) {
      body.order_class = t.takeProfit !== undefined && t.stopLoss !== undefined ? 'bracket' : 'oto';
      if (t.takeProfit !== undefined) body.take_profit = { limit_price: String(t.takeProfit) };
      if (t.stopLoss !== undefined) body.stop_loss = { stop_price: String(t.stopLoss) };
    }
    const r = obj(await this.call('POST', '/v2/orders', body));
    const s = str(r.status) ?? '';
    const status = s === 'filled' ? 'filled' : s === 'rejected' ? 'rejected' : s === 'canceled' || s === 'expired' ? 'cancelled' : s === 'pending_new' || s === 'accepted' ? 'pending' : 'open';
    return { status, orderId: str(r.id), message: s === 'rejected' ? 'Alpaca a refuzat ordinul.' : null, followUps: [] };
  }

  async cancel(input: CancelInput): Promise<OrderResult> {
    try {
      await this.call('DELETE', `/v2/orders/${encodeURIComponent(input.orderId)}`);
    } catch (err) {
      // 422: the order is no longer cancelable (filled or being filled).
      if (err instanceof TradingError && err.code === 'REJECTED') throw new TradingError('NOT_FOUND', 'Ordinul nu mai poate fi anulat (poate s-a executat).');
      throw err;
    }
    return { status: 'cancelled', orderId: input.orderId, message: null, followUps: [] };
  }

  // ---------------- FD-ORDEREDIT: an open order's price, trigger or quantity (PATCH /v2/orders/{id}) ----------------

  async normalizeModify(t: ModifyTicket): Promise<ModifyPlan> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const steps: ModifyStepPlan[] = [];
    let last: number | null = null;
    for (const [i, c] of t.changes.entries()) {
      if (c.orderId === null) {
        errors.push('La Alpaca, un SL / TP nou se pune cu un ordin nou (stop sau limită de vânzare).');
        continue;
      }
      let o: Record<string, unknown>;
      try {
        o = obj(await this.call('GET', `/v2/orders/${encodeURIComponent(c.orderId)}`));
      } catch (err) {
        if (err instanceof TradingError && err.code === 'NOT_FOUND') {
          errors.push('Ordinul nu mai e deschis (poate s-a executat sau a fost anulat).');
          continue;
        }
        throw err;
      }
      const status = str(o.status) ?? '';
      if (!['new', 'partially_filled', 'held', 'accepted', 'pending_new'].includes(status)) {
        errors.push('Ordinul nu mai e deschis (poate s-a executat sau a fost anulat).');
        continue;
      }
      if (['accepted', 'pending_new', 'pending_replace', 'pending_cancel'].includes(status)) errors.push('Alpaca încă procesează ordinul: mai încearcă peste câteva secunde.');
      const symbol = str(o.symbol) ?? t.symbol;
      last = last ?? (await this.last(symbol, str(o.asset_class) === 'crypto'));
      const before = { price: num(o.limit_price), triggerPrice: num(o.stop_price), amount: num(o.qty), takeProfit: null, stopLoss: null };
      const after = { ...before };
      const side = str(o.side) === 'sell' ? 'sell' : 'buy';
      if (c.what === 'order') {
        if (c.takeProfit !== undefined || c.stopLoss !== undefined) errors.push('La Alpaca, TP / SL-ul unui bracket sunt ordine separate: modifică-le pe ele.');
        if (c.price !== undefined) after.price = Number(c.price.toFixed(c.price >= 1 ? 2 : 4));
        if (c.triggerPrice !== undefined) after.triggerPrice = Number(c.triggerPrice.toFixed(c.triggerPrice >= 1 ? 2 : 4));
        if (c.amount !== undefined) {
          if (!Number.isInteger(c.amount) || o.notional !== null && o.notional !== undefined) errors.push('Alpaca schimbă doar cantitatea întreagă a unui ordin în acțiuni (nu una fracționară sau în valoare).');
          after.amount = c.amount;
        }
        // A sell stop falls to its price, a buy stop rises to it: moved across the price now, it would fire at once.
        if (after.triggerPrice !== null && after.triggerPrice !== before.triggerPrice && last !== null && (side === 'sell' ? after.triggerPrice >= last : after.triggerPrice <= last)) {
          errors.push(`Declanșarea nouă e ${side === 'sell' ? 'peste' : 'sub'} prețul de acum (${fmtPlain(last)}): un stop de ${side === 'sell' ? 'vânzare' : 'cumpărare'} s-ar executa imediat.`);
        }
      } else {
        // A stop loss / take profit order of a position: its stop (or limit) price is the level.
        if (t.position && side !== (t.position.side === 'long' ? 'sell' : 'buy')) {
          errors.push('Ordinul nu închide această poziție.');
          continue;
        }
        if (c.level === null) {
          steps.push({ change: i, how: 'cancel', orderId: c.orderId, side, kind: c.what, before, after: before, removes: true });
          if (c.what === 'sl') warnings.push('Fără stop loss, pierderea poziției nu mai e limitată de un ordin.');
          continue;
        }
        const level = Number(c.level.toFixed(c.level >= 1 ? 2 : 4));
        if (before.triggerPrice !== null) after.triggerPrice = level;
        else after.price = level;
        if (t.position) protectionChecks(c.what, t.position.side === 'long', level, last, { errors }, fmtPlain);
      }
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      steps.push({ change: i, how: 'amend', orderId: c.orderId, side, kind: str(o.type), before, after, removes: false });
    }
    if (!steps.length && !errors.length) errors.push('Nimic nu se schimbă: valorile sunt cele de acum.');
    const preview: ModifyPreview = { ticket: t, displaySymbol: t.symbol, last, currency: 'USD', env: '', steps, warnings: [...new Set(warnings)], errors };
    return { preview, internal: null };
  }

  async modify(plan: ModifyPlan): Promise<ModifyResult> {
    const results: (ModifyResult['steps'][number] & { unknown?: boolean })[] = [];
    for (const s of plan.preview.steps) {
      try {
        if (s.how === 'cancel') {
          await this.cancel({ orderId: s.orderId as string, symbol: plan.preview.ticket.symbol, market: 'stock', trigger: false });
          results.push({ change: s.change, what: 'anulat', ok: true, orderId: s.orderId, message: null, ...(s.orderId ? { cancelled: s.orderId } : {}) });
          continue;
        }
        const body: Record<string, unknown> = {};
        if (s.after.price !== s.before.price && s.after.price !== null) body.limit_price = String(s.after.price);
        if (s.after.triggerPrice !== s.before.triggerPrice && s.after.triggerPrice !== null) body.stop_price = String(s.after.triggerPrice);
        if (s.after.amount !== s.before.amount && s.after.amount !== null) body.qty = String(s.after.amount);
        // A replacement: a new order (another id) takes the old one's place.
        const r = obj(await this.call('PATCH', `/v2/orders/${encodeURIComponent(s.orderId as string)}`, body));
        // Alpaca replaces the order under a new id: the old one is gone.
        results.push({ change: s.change, what: 'modificat (ordin nou)', ok: true, orderId: str(r.id), message: null, ...(s.orderId && str(r.id) !== s.orderId ? { cancelled: s.orderId } : {}) });
      } catch (err) {
        const unknown = err instanceof TradingError && err.code === 'UNKNOWN_OUTCOME';
        results.push({ change: s.change, what: 'eroare', ok: false, orderId: s.orderId, message: (err as Error).message, ...(unknown ? { unknown } : {}) });
        if (unknown) break;
      }
    }
    return { status: modifyStatus(results), steps: results.map(({ unknown: _u, ...r }) => r) };
  }
}
