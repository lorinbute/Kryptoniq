// eToro orders (FD-TRADING; api-portal.etoro.com, Trading - Real / Demo): opening a position (market, market-if-touched,
// immediate limit; by USD amount or units; buy or short; leverage, SL / TP), closing positions (all or some units),
// cancelling a pending order. A 200 means "accepted for processing": the outcome is read back from the order lookup.
import { randomUUID } from 'node:crypto';
import type { ClosablePosition, InstrumentInfo, OrderPreview, OrderResult, OrderTicket, TradeMarket, TradeSymbol } from '../../../shared/trading.ts';
import { brokerCall } from './http.ts';
import { commonChecks, fmtPlain, TradingError, type CancelInput, type Trader } from './types.ts';

const BASE = 'https://public-api.etoro.com';
const FORBIDDEN = 'cheia nu are permisiunea „Write” pentru acest mediu (fă o cheie nouă cu ea) sau IP-ul nu e permis';
const LOOKUP_TRIES = 5;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : typeof v === 'number' ? String(v) : null);
const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null) : []);

/** The form's key with its last digits replaced by `i`: one valid request id per closed position. */
export function nthRequestId(idemKey: string, i: number): string {
  if (i === 0) return idemKey;
  const hex = i.toString(16).padStart(4, '0');
  return `${idemKey.slice(0, -4)}${hex}`;
}

/**
 * What closing `units` of several positions sends (FD-ETOROUNITS): whole positions in the order given, then part of the
 * next one. Without `units`, every position whole. A position no longer held is left out (its units are not there).
 */
export function closePlan(held: readonly { id: string; units: number }[], ids: readonly string[], units: number | undefined): { id: string; units: number | null }[] {
  if (units === undefined) return ids.map((id) => ({ id, units: null }));
  const byId = new Map(held.map((p) => [p.id, p.units]));
  const out: { id: string; units: number | null }[] = [];
  let left = units;
  for (const id of ids) {
    const has = byId.get(id);
    if (has === undefined || left <= 1e-9) continue;
    if (left >= has - 1e-9) {
      out.push({ id, units: null });
      left -= has;
    } else {
      out.push({ id, units: Number(left.toFixed(8)) });
      left = 0;
    }
  }
  return out;
}

interface Held {
  instrumentId: number;
  units: number;
  positions: ClosablePosition[];
  rate: number | null;
}

export class EtoroTrader implements Trader {
  private readonly headers: Record<string, string>;
  private readonly demo: boolean;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(creds: Record<string, string>, env: string, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))) {
    this.headers = { 'x-api-key': creds.publicKey ?? '', 'x-user-key': creds.userKey ?? '' };
    this.demo = env === 'demo';
    this.sleep = sleep;
  }

  private call(method: 'GET' | 'POST' | 'DELETE', path: string, requestId: string, body?: unknown): Promise<unknown> {
    return brokerCall('eToro', `${BASE}${path}`, { method, headers: { ...this.headers, 'x-request-id': requestId }, body, write: method !== 'GET', forbidden: FORBIDDEN });
  }

  private seg(): string {
    return this.demo ? 'demo/' : '';
  }

  async symbols(_market: TradeMarket): Promise<TradeSymbol[]> {
    return [];
  }

  /** The instrument id of a symbol (exact match on eToro's full symbol). */
  private async resolve(symbol: string): Promise<{ instrumentId: number; symbol: string; name: string }> {
    const want = symbol.trim().toUpperCase().replace(/\/.*$/, '');
    if (/^#\d+$/.test(want)) return { instrumentId: Number(want.slice(1)), symbol: want, name: want };
    const r = obj(await this.call('GET', `/api/v1/market-data/search?internalSymbolFull=${encodeURIComponent(want)}`, randomUUID()));
    const hit = arr(r.items).find((i) => (str(i.internalSymbolFull) ?? '').toUpperCase() === want);
    const id = hit ? num(hit.instrumentId ?? hit.instrumentID ?? hit.InstrumentID) : null;
    if (!hit || id === null) throw new TradingError('INVALID', `eToro nu are simbolul ${want}.`);
    return { instrumentId: id, symbol: want, name: str(hit.displayname ?? hit.instrumentDisplayName ?? hit.displayName) ?? want };
  }

  private async rate(instrumentId: number): Promise<number | null> {
    try {
      const r = obj(await this.call('GET', `/api/v1/market-data/instruments/rates?instrumentIds=${instrumentId}`, randomUUID()));
      const row = arr(r.rates)[0] ?? arr(r.items)[0] ?? {};
      return num(row.lastExecution ?? row.ask ?? row.bid ?? row.rate);
    } catch {
      return null;
    }
  }

  /** Free cash and the open positions on an instrument. */
  private async portfolio(instrumentId: number): Promise<{ cash: number | null; held: Held }> {
    const root = obj(await this.call('GET', `/api/v1/trading/info/${this.demo ? 'demo' : 'real'}/pnl`, randomUUID()));
    const pf = Object.keys(obj(root.clientPortfolio)).length ? obj(root.clientPortfolio) : root;
    const held: Held = { instrumentId, units: 0, positions: [], rate: null };
    for (const p of arr(pf.positions)) {
      if (num(p.instrumentID ?? p.instrumentId) !== instrumentId) continue;
      const units = num(p.units) ?? 0;
      const id = str(p.positionID ?? p.positionId);
      if (!id) continue;
      const opened = Date.parse(str(p.openDateTime) ?? '');
      held.positions.push({
        id,
        units,
        isBuy: p.isBuy !== false,
        leverage: num(p.leverage) ?? 1,
        openRate: num(p.openRate),
        openedAt: Number.isFinite(opened) ? opened : null,
        pnl: num(obj(p.unrealizedPnL).pnL ?? obj(p.unrealizedPnL).pnl) ?? num(p.netProfit),
        invested: num(p.amount),
      });
      held.units += units;
      held.rate = num(obj(p.unrealizedPnL).closeRate) ?? num(p.currentRate) ?? held.rate;
    }
    return { cash: num(pf.credit), held };
  }

  async instrument(_market: TradeMarket, symbol: string): Promise<InstrumentInfo> {
    const ins = await this.resolve(symbol);
    const [{ cash, held }, rate] = await Promise.all([this.portfolio(ins.instrumentId), this.rate(ins.instrumentId)]);
    const longs = held.positions.filter((p) => p.isBuy);
    const shorts = held.positions.filter((p) => !p.isBuy);
    const pos = longs.length ? { side: 'long' as const, list: longs } : shorts.length ? { side: 'short' as const, list: shorts } : null;
    return {
      market: 'stock',
      symbol: ins.symbol,
      ref: String(ins.instrumentId),
      name: ins.name,
      currency: 'USD',
      base: ins.symbol,
      last: rate ?? held.rate,
      amountStep: null,
      minAmount: null,
      minCost: null,
      priceStep: null,
      contractSize: null,
      maxLeverage: null,
      availableQuote: cash,
      availableBase: longs.reduce((s, p) => s + p.units, 0),
      position: pos ? { side: pos.side, amount: pos.list.reduce((s, p) => s + p.units, 0), entryPrice: pos.list[0]?.openRate ?? null } : null,
      // FD-ETOROPICK: each position, so the form can close the ones picked.
      positions: held.positions,
    };
  }

  async normalize(t: OrderTicket): Promise<OrderPreview> {
    const ins = await this.resolve(t.symbol);
    const [{ cash, held }, rate] = await Promise.all([this.portfolio(ins.instrumentId), this.rate(ins.instrumentId)]);
    const last = rate ?? held.rate;
    const warnings: string[] = [];
    const errors: string[] = [];
    if (t.market !== 'stock') errors.push('Pe eToro, instrumentele se tranzacționează ca acțiuni (simbolul eToro).');
    let amount = t.amount;
    let value: number | null = null;
    if (t.close) {
      // Closing: the positions must be this instrument's, the units within them.
      const ids = new Set(held.positions.map((p) => p.id));
      const missing = t.close.positionIds.filter((id) => !ids.has(id));
      if (missing.length) errors.push(`Poziția ${missing.join(', ')} nu mai e deschisă.`);
      const units = held.positions.filter((p) => t.close?.positionIds.includes(p.id)).reduce((s, p) => s + p.units, 0);
      const many = t.close.positionIds.length > 1;
      if (t.close.units !== undefined && t.close.units > units + 1e-9) errors.push(`${many ? 'Pozițiile au' : 'Poziția are'} ${fmtPlain(units)} unități; închizi ${fmtPlain(t.close.units)}.`);
      // Units of several positions: whole ones first, then part of the next (said, so the confirmation shows it).
      if (t.close.units !== undefined && many && !errors.length) {
        const plan = closePlan(held.positions, t.close.positionIds, t.close.units);
        const whole = plan.filter((x) => x.units === null).length;
        const part = plan.find((x) => x.units !== null);
        warnings.push(
          [whole ? `Se închid complet ${whole} ${whole === 1 ? 'poziție' : 'poziții'}` : '', part ? `${whole ? 'și' : 'Se închide'} parțial poziția ${part.id} (${fmtPlain(part.units as number)} ${part.units === 1 ? 'unitate' : 'unități'})` : '']
            .filter(Boolean)
            .join(' ') + '.',
        );
      }
      amount = t.close.units ?? units;
      value = last !== null ? amount * last : null;
      warnings.push('Închiderea se face la prețul pieței.');
    } else {
      if (!['market', 'mit', 'limit_ioc'].includes(t.kind)) errors.push('eToro deschide poziții la piață, la un preț țintă (market-if-touched) sau cu o limită imediată.');
      const lev = t.leverage ?? 1;
      if ((lev > 1 || t.side === 'sell') && t.stopLoss === undefined) errors.push(lev > 1 ? 'eToro cere stop loss la un levier peste 1×.' : 'eToro cere stop loss la o poziție short.');
      if (t.kind === 'limit_ioc' && t.price !== undefined && last !== null && Math.abs(t.price - last) / last > 0.1) errors.push(`eToro refuză o limită la peste 10% de prețul de acum (${fmtPlain(last)}).`);
      value = t.amountIn === 'quote' ? t.amount : last !== null ? t.amount * last : null;
      if (t.amountIn === 'quote' && last !== null) amount = t.amount / last;
      if (value !== null && cash !== null) {
        if (value / lev > cash) warnings.push(`Disponibil: ${fmtPlain(cash)} USD; poziția cere ${fmtPlain(value / lev)}.`);
        else if (value / lev > cash * 0.5) warnings.push(`Poziția folosește peste jumătate din disponibil (${fmtPlain(cash)} USD).`);
      }
      if (lev > 10) warnings.push(`Levier ${lev}×: o mișcare de ${fmtPlain(100 / lev)}% împotriva poziției o închide.`);
      if (t.side === 'sell') warnings.push('Pe eToro, „Vinde” deschide o poziție short; o deținere se vinde cu „Închide”.');
      commonChecks({ ...t, kind: t.kind === 'mit' ? 'limit' : t.kind, price: t.kind === 'mit' ? undefined : t.price }, { last, entry: t.triggerPrice ?? t.price ?? last }, { warnings, errors }, fmtPlain);
    }
    return {
      ticket: t,
      displaySymbol: `${ins.symbol} · ${ins.name}`,
      amount,
      contracts: null,
      price: t.price ?? null,
      triggerPrice: t.triggerPrice ?? null,
      last,
      value,
      margin: !t.close && value !== null ? value / (t.leverage ?? 1) : null,
      available: cash,
      currency: 'USD',
      env: 'live',
      warnings,
      errors,
    };
  }

  /** Reads the order back: filled, rejected (with the reason) or still in flight after a few seconds. */
  private async outcome(orderId: string | null, requestId: string): Promise<OrderResult> {
    for (let i = 0; i < LOOKUP_TRIES; i++) {
      await this.sleep(1000);
      let r: Record<string, unknown>;
      try {
        const q = orderId ? `orderId=${encodeURIComponent(orderId)}` : `referenceId=${encodeURIComponent(requestId)}`;
        r = obj(await this.call('GET', `/api/v2/trading/info/${this.seg()}orders:lookup?${q}`, randomUUID()));
      } catch {
        continue;
      }
      const status = obj(r.status);
      const id = num(status.id);
      const oid = str(r.orderId) ?? orderId;
      if (id === 3 || id === 5) return { status: 'filled', orderId: oid, message: null, followUps: [] };
      if (id === 4 || id === 10) return { status: 'rejected', orderId: oid, message: `Refuzat de eToro: ${str(status.errorMessage) ?? str(status.errorCode) ?? 'fără motiv'}`, followUps: [] };
      if (id === 7 || id === 9) return { status: 'cancelled', orderId: oid, message: null, followUps: [] };
    }
    return { status: 'pending', orderId, message: 'Primit de eToro; se execută când piața permite (verifică pagina Tranzacții).', followUps: [] };
  }

  async place(preview: OrderPreview): Promise<OrderResult> {
    const t = preview.ticket;
    const ins = await this.resolve(t.symbol);
    if (t.close) {
      // Position by position: one that fails does not hide the ones already closed.
      const out: string[] = [];
      const failed: string[] = [];
      // A close whose answer was lost may have gone through: told apart from a refusal.
      const unsure: string[] = [];
      let firstError: unknown = null;
      let unsureError: unknown = null;
      // Units of several positions: split on the positions held now (whole ones, then part of the next).
      const plan =
        t.close.units !== undefined && t.close.positionIds.length > 1
          ? closePlan((await this.portfolio(ins.instrumentId)).held.positions, t.close.positionIds, t.close.units)
          : t.close.positionIds.map((id) => ({ id, units: t.close?.units ?? null }));
      if (plan.length === 0) throw new TradingError('REJECTED', 'Pozițiile nu mai sunt deschise.');
      for (const [i, { id: positionId, units: deduct }] of plan.entries()) {
        try {
          const body = { InstrumentId: ins.instrumentId, UnitsToDeduct: deduct };
          const r = obj(await this.call('POST', `/api/v1/trading/execution/${this.seg()}market-close-orders/positions/${encodeURIComponent(positionId)}`, nthRequestId(t.idemKey, i), body));
          const oid = str(obj(r.orderForClose).orderID ?? obj(r.orderForClose).orderId ?? r.orderId);
          if (oid) out.push(oid);
        } catch (err) {
          firstError ??= err;
          if (err instanceof TradingError && err.code === 'UNKNOWN_OUTCOME') {
            unsureError ??= err;
            unsure.push(positionId);
          } else failed.push(`${positionId} (${(err as Error).message})`);
        }
      }
      const total = plan.length;
      const received = total - failed.length - unsure.length;
      if (received === 0) throw unsureError ?? firstError;
      const parts = [`Închiderea a fost primită pentru ${received} ${received === 1 ? 'poziție' : 'poziții'}`];
      if (failed.length) parts.push(`NU s-au închis: ${failed.join('; ')}`);
      if (unsure.length) parts.push(`nu știm sigur dacă s-au închis (verifică pe eToro): ${unsure.join(', ')}`);
      const message = received === total ? 'Cererea de închidere a fost primită de eToro.' : `${parts.join('; ')}.`;
      return { status: 'sent', orderId: out.join(', ') || null, message, followUps: [] };
    }
    const body: Record<string, unknown> = {
      action: 'open',
      transaction: t.side === 'buy' ? 'buy' : 'sellShort',
      instrumentId: ins.instrumentId,
      orderType: t.kind === 'mit' ? 'mit' : t.kind === 'limit_ioc' ? 'limitIOC' : 'mkt',
      leverage: t.leverage ?? 1,
      ...(t.amountIn === 'quote' ? { amount: t.amount, orderCurrency: 'usd' } : { units: t.amount }),
      ...(t.kind === 'mit' ? { triggerRate: t.triggerPrice } : {}),
      ...(t.kind === 'limit_ioc' ? { limitRate: t.price } : {}),
      ...(t.stopLoss !== undefined ? { stopLossRate: t.stopLoss } : {}),
      ...(t.takeProfit !== undefined ? { takeProfitRate: t.takeProfit } : {}),
    };
    const r = obj(await this.call('POST', `/api/v2/trading/execution/${this.seg()}orders`, t.idemKey, body));
    return this.outcome(str(r.orderId), t.idemKey);
  }

  async cancel(input: CancelInput): Promise<OrderResult> {
    if (!/^\d+$/.test(input.orderId)) throw new TradingError('INVALID', 'Acesta e un SL / TP al unei poziții eToro: se schimbă din eToro.');
    await this.call('DELETE', `/api/v2/trading/execution/${this.seg()}orders/${input.orderId}`, randomUUID());
    return { status: 'cancelled', orderId: input.orderId, message: 'Anularea a fost cerută (dacă ordinul nu s-a executat deja).', followUps: [] };
  }
}
