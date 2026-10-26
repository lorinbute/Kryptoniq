// How a bot's order is carried out (TD-BOT §4): in a simulation at the price of the look, with the fee of the settings;
// for real through the trading service (the same checks, journal and key as the order form), rounded to the platform's
// step first. Every real order's key is saved before it leaves, so a restart sends it again with the same key.
import { perpetualOf, type BotMarket, type BotSide } from '../../shared/bot.ts';
import type { ClosablePosition, InstrumentInfo, OrderTicket } from '../../shared/trading.ts';
import type { TradingService } from '../exchange/trading/service.ts';
import { TradingError } from '../exchange/trading/types.ts';
import type { BrokerRefs, RefsWait } from './state.ts';

export interface BotOrder {
  /** The chart's symbol (BTC/USDT, AAPL); a futures bot trades its perpetual. */
  symbol: string;
  side: 'buy' | 'sell';
  /** In the asset. */
  qty: number;
  /** Closing what the bot holds (reduce-only on futures; at eToro, the bot's own positions). */
  reduce: boolean;
  lev: number;
  /** The price of the look: the fill of a simulation, the estimate of a real one. */
  price: number;
  /** eToro: the stop loss a short opens with (the platform asks for one, FD-BOT §10). */
  sl?: number | null;
  /** When the order was first decided (an order sent again after a restart keeps its time). */
  at?: number;
}

export interface Fill {
  qty: number;
  price: number;
  fee: number;
}

/**
 * `retry`: try again at the next look with the same key; `refused`: the platform said no to this order (the key is
 * free again); `problem`: the bot cannot go on by itself; `gone`: the account is no more.
 */
export type ExecResult = { ok: true; fill: Fill } | { ok: false; kind: 'retry' | 'refused' | 'problem' | 'gone'; message: string };

export interface Executor {
  /**
   * `ready`: called with the quantity that will leave, just before it leaves (the engine saves the key then). `again`: an
   * order sent before with this key, sent as it was (no new rounding or checks: it may have gone through already).
   */
  order(o: BotOrder, key: string, ready?: (qty: number) => Promise<void>, again?: boolean): Promise<ExecResult>;
}

/** A simulation: everything fills at the look's price. */
export class PaperExec implements Executor {
  private readonly feePct: number;

  constructor(feePct: number) {
    this.feePct = feePct;
  }

  async order(o: BotOrder): Promise<ExecResult> {
    return { ok: true, fill: { qty: o.qty, price: o.price, fee: (o.qty * o.price * this.feePct) / 100 } };
  }
}

const RETRY = new Set(['RATE_LIMIT', 'IN_PROGRESS']);
const REFUSED = new Set(['INVALID', 'MIN_SIZE', 'INSUFFICIENT', 'REJECTED', 'MARKET_CLOSED']);
const INSTRUMENT_TTL_MS = 60 * 60_000;

/** What the trading service's answer means for the bot. */
function outcomeOf(err: unknown): ExecResult {
  if (err instanceof TradingError) {
    if (RETRY.has(err.code)) return { ok: false, kind: 'retry', message: err.message };
    if (REFUSED.has(err.code)) return { ok: false, kind: 'refused', message: err.message };
    if (err.code === 'NO_ACCOUNT') return { ok: false, kind: 'gone', message: err.message };
    return { ok: false, kind: 'problem', message: err.message };
  }
  // The network, the database: the same key next time (the journal answers for an order that did leave).
  return { ok: false, kind: 'retry', message: (err as Error).message };
}

/** Rounds down to the platform's step (a step of 0.001 keeps 0.0019 as 0.001). */
export function floorToStep(qty: number, step: number | null): number {
  if (step === null || !(step > 0)) return qty;
  const n = Math.floor(qty / step + 1e-9);
  return Number((n * step).toFixed(12));
}

export interface RealExecDeps {
  trading: TradingService;
  userId: number;
  accountId: number;
  market: BotMarket;
  /** The account's platform: eToro closes by position (FD-BOT §10). */
  etoro: boolean;
  /** eToro: the bot's positions (the engine's state, changed here) and the openings still to find. */
  refs: Record<string, BrokerRefs>;
  refsWait: Record<string, RefsWait>;
  feePct: number;
  /** Instruments read in the last hour (one per account, market and symbol), shared by the engine's looks. */
  instruments: Map<string, { info: InstrumentInfo; at: number }>;
  now: () => number;
}

export class RealExec implements Executor {
  private readonly d: RealExecDeps;

  constructor(d: RealExecDeps) {
    this.d = d;
  }

  /** eToro: positions apart, closed by id (FD-BOT §10). */
  get etoro(): boolean {
    return this.d.etoro;
  }

  /** The symbol the platform trades: the perpetual on futures. */
  tradeSymbol(symbol: string): string {
    return this.d.market === 'futures' ? perpetualOf(symbol) : symbol;
  }

  /** The platform's step for a symbol's quantity (a grid's units are whole steps). */
  async step(symbol: string): Promise<number | null> {
    return (await this.instrument(this.tradeSymbol(symbol), false)).amountStep;
  }

  private async instrument(symbol: string, fresh: boolean): Promise<InstrumentInfo> {
    const key = `${this.d.accountId}|${this.d.market}|${symbol}`;
    const known = this.d.instruments.get(key);
    if (!fresh && known && this.d.now() - known.at < INSTRUMENT_TTL_MS) return known.info;
    const info = await this.d.trading.instrument(this.d.userId, this.d.accountId, this.d.market, symbol);
    this.d.instruments.set(key, { info, at: this.d.now() });
    return info;
  }

  /** eToro: the bot's position ids on a symbol. */
  private pool(symbol: string): BrokerRefs {
    return (this.d.refs[symbol] ??= { long: [], short: [] });
  }

  /**
   * eToro: the positions open now on the instrument; an opening still to find is found among them (the new ones of its
   * side: not seen before it, or opened since it), and the bot's ids that are gone are forgotten.
   */
  private async positions(o: BotOrder): Promise<ClosablePosition[]> {
    const open = (await this.instrument(o.symbol, true)).positions ?? [];
    const pool = this.pool(o.symbol);
    const wait = this.d.refsWait[o.symbol];
    if (wait) {
      const mine = new Set([...pool.long, ...pool.short]);
      const found = open.filter((p) => p.isBuy === (wait.side === 'long') && !mine.has(p.id) && (wait.before ? !wait.before.includes(p.id) : (p.openedAt ?? 0) >= wait.at - 60_000)).map((p) => p.id);
      if (found.length) {
        pool[wait.side].push(...found);
        delete this.d.refsWait[o.symbol];
      }
    }
    const ids = new Set(open.map((p) => p.id));
    pool.long = pool.long.filter((id) => ids.has(id));
    pool.short = pool.short.filter((id) => ids.has(id));
    return open;
  }

  /**
   * eToro: the units the bot's own positions of a side still have (their ids read again); null while an opening of that
   * side has not shown yet (nothing can be told).
   */
  async ownUnits(symbol: string, side: BotSide): Promise<number | null> {
    const open = await this.positions({ symbol, side: 'buy', qty: 0, reduce: false, lev: 1, price: 0 });
    if (this.d.refsWait[symbol]?.side === side) return null;
    const ids = this.pool(symbol)[side];
    return open.filter((p) => ids.includes(p.id)).reduce((a, p) => a + p.units, 0);
  }

  async order(o: BotOrder, key: string, ready?: (qty: number) => Promise<void>, again = false): Promise<ExecResult> {
    try {
      if (this.d.etoro) return await this.etoroOrder(o, key, ready, again);
    } catch (err) {
      return outcomeOf(err);
    }
    const symbol = this.tradeSymbol(o.symbol);
    const futures = this.d.market === 'futures';
    let qty = o.qty;
    try {
      if (!again) {
        // A spot sale never asks for more than is free (a fee taken in the asset leaves a little less than was bought).
        const info = await this.instrument(symbol, !futures && o.side === 'sell');
        if (!futures && o.side === 'sell' && info.availableBase !== null) qty = Math.min(qty, info.availableBase);
        qty = floorToStep(qty, info.amountStep);
        if (!(qty > 0) || (info.minAmount !== null && qty < info.minAmount)) return { ok: false, kind: 'refused', message: `Cantitatea (${qty}) e sub minimul platformei pe ${symbol}.` };
        if (info.minCost !== null && qty * o.price < info.minCost) return { ok: false, kind: 'refused', message: `Ordinul (${(qty * o.price).toFixed(2)} ${info.currency}) e sub minimul platformei pe ${symbol} (${info.minCost} ${info.currency}).` };
        await ready?.(qty);
      }
      await this.d.trading.place(this.d.userId, {
        accountId: this.d.accountId,
        idemKey: key,
        market: this.d.market,
        symbol,
        side: o.side,
        kind: 'market',
        amount: qty,
        amountIn: 'base',
        ...(futures && !o.reduce ? { leverage: Math.max(1, Math.min(125, Math.round(o.lev))) } : {}),
        ...(futures && o.reduce ? { reduceOnly: true } : {}),
      });
      return { ok: true, fill: { qty, price: o.price, fee: (qty * o.price * this.d.feePct) / 100 } };
    } catch (err) {
      return outcomeOf(err);
    }
  }

  /**
   * eToro (FD-BOT §10): an opening is a new position (a short with its stop loss), whose id becomes the bot's; a closing
   * closes the bot's positions of that side, all or `qty` units of them, never the user's.
   */
  private async etoroOrder(o: BotOrder, key: string, ready?: (qty: number) => Promise<void>, again = false): Promise<ExecResult> {
    const side: BotSide = o.reduce ? (o.side === 'sell' ? 'long' : 'short') : o.side === 'buy' ? 'long' : 'short';
    const base: OrderTicket = { accountId: this.d.accountId, idemKey: key, market: 'stock', symbol: o.symbol, side: o.side, kind: 'market', amount: o.qty, amountIn: 'base' };
    if (o.reduce) {
      const open = await this.positions(o);
      const ids = this.pool(o.symbol)[side];
      if (!ids.length) return { ok: false, kind: 'refused', message: `Botul nu mai are poziții ${side} pe ${o.symbol} la eToro (închise din afara lui?).` };
      const units = open.filter((p) => ids.includes(p.id)).reduce((a, p) => a + p.units, 0);
      const qty = Math.min(o.qty, units);
      if (!again) await ready?.(qty);
      await this.d.trading.place(this.d.userId, { ...base, amount: qty, close: { positionIds: [...ids], ...(qty < units - 1e-9 ? { units: qty } : {}) } });
      return { ok: true, fill: { qty, price: o.price, fee: (qty * o.price * this.d.feePct) / 100 } };
    }
    if (side === 'short' && !(o.sl && o.sl > 0)) return { ok: false, kind: 'refused', message: 'eToro cere stop loss la un short: botul nu are unul pentru această intrare.' };
    // The positions before: the new one after the order is the bot's.
    const before = again ? null : (await this.positions(o)).map((p) => p.id);
    if (!again) await ready?.(o.qty);
    const at = o.at ?? this.d.now();
    await this.d.trading.place(this.d.userId, { ...base, ...(side === 'short' ? { stopLoss: o.sl as number } : {}) });
    this.d.refsWait[o.symbol] = { side, at, before };
    try {
      await this.positions(o);
    } catch {
      // found at the next reading of the positions
    }
    return { ok: true, fill: { qty: o.qty, price: o.price, fee: (o.qty * o.price * this.d.feePct) / 100 } };
  }
}
