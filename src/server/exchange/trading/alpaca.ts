// Alpaca orders (FD-TRADING; docs.alpaca.markets, POST /v2/orders): shares market / limit / stop / stop-limit, day or
// good-till-cancelled; fractional or by dollar amount (any of the four, day only); TP / SL as a bracket (whole shares,
// not outside the session); extended hours (limit); crypto market / limit / stop-limit, good-till-cancelled. Cancelling,
// closing a position.
import type { InstrumentInfo, OrderPreview, OrderResult, OrderTicket, TradeMarket, TradeSymbol } from '../../../shared/trading.ts';
import { brokerCall } from './http.ts';
import { commonChecks, fmtPlain, TradingError, type CancelInput, type Trader } from './types.ts';

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

  private call(method: 'GET' | 'POST' | 'DELETE', url: string, body?: unknown): Promise<unknown> {
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
    if (t.side === 'sell' && (!pos || pos.side === 'long')) {
      const free = pos?.free ?? 0;
      if (amount > free + 1e-9) warnings.push(free > 0 ? `Ai disponibil ${fmtPlain(free)} ${a.symbol}; peste atât, vânzarea deschide o poziție short (dacă contul permite).` : `Nu deții ${a.symbol}: vânzarea deschide o poziție short (dacă contul permite).`);
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
}
