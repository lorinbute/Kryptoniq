// The trading bots' engine (FD-BOT §8, TD-BOT §4): every 30 s, on the instance that runs the jobs, each active bot of an
// active user reads its prices, checks a real account against what it holds, exits (always), enters (only while it runs,
// within its period), and saves what it did. One bot's failure never stops the others.
import { randomUUID } from 'node:crypto';
import { TRADING } from '../../shared/trading.ts';
import { areaOf, botInputSchema, perpetualOf, reached, type BotEndAction, type BotEventDetail, type BotEventKind, type BotInput, type BotScore, type BotSide, type BotStatus, type BotTradeReason, type DcaConfig, type GridConfig, type PremiumConfig } from '../../shared/bot.ts';
import { htfCandleCount, runSlingshot, type SlingshotResult, type SlingshotSignal } from '../../shared/indicator/slingshot.ts';
import { dayKey, tfSeconds, type Timeframe } from '../../shared/time.ts';
import type { AiService } from '../ai/service.ts';
import type { CalendarService } from '../calendar/service.ts';
import type { Db } from '../db/database.ts';
import type { AccountsService, Portfolio } from '../exchange/accounts.ts';
import type { TradingService } from '../exchange/trading/service.ts';
import type { Logger } from '../log.ts';
import { MarketError, type MarketData } from '../market/market.ts';
import type { MarketSource } from '../market/source.ts';
import type { StockData } from '../market/stocks.ts';
import type { DailySentimentService } from '../sentiment/daily.ts';
import type { SettingsService } from '../settings.ts';
import type { InstrumentInfo } from '../../shared/trading.ts';
import { afterClose, dcaStep, dealLevels, newDca } from './dca.ts';
import { floorToStep, PaperExec, RealExec, type BotOrder, type Executor, type Fill } from './exec.ts';
import { closeAllUnits, gridMoves, gridStopped, initGrid, netUnits, startMoves, triggered, type GridMove } from './grid.ts';
import { askAi, highImpact, readMood, readSymbolNews, type MarketMood, type SymbolNews } from './inputs.ts';
import { barEvents, exitAt, levelsFor, liquidationPrice, signalFate, sizeFor, type Sized } from './premium.ts';
import { areaAgainst, favoured, limitOf, marketScore, passes } from './score.ts';
import { num, price, qty, signed } from './format.ts';
import { closePnl, openPnl, parseState, type BotPosition, type BotState, type ClosedTrade, type GridState, type PendingOrder, type PremiumState } from './state.ts';

const MIN = 60_000;
/** No price for this long: a problem (FD-BOT §9). */
const NO_PRICE_MS = 10 * MIN;
/** After its own order on a symbol, the bot does not check the account there for this long (the platform catches up). */
const RECONCILE_GRACE_MS = MIN;
/** Less than this share of what the bot holds: the rest was closed outside it. */
const RECONCILE_TOLERANCE = 0.98;
const EXIT_FAILURES_MAX = 10;
const NO_PRICE = 'Prețul nu se poate citi de 10 minute.';
/** After the platform refused an entry: no new entry on that symbol for this long. */
const ENTRY_PAUSE_MS = 5 * MIN;
const ERRORS_MAX = 3;
const AI_PER_DAY = 30;
const EVENTS_KEPT = 1000;
const PRUNE_EVERY_MS = 60 * MIN;
/** Before a high-impact event the window is the user's; after it, 15 minutes (FD-BOT §6). */
const AFTER_EVENT_MS = 15 * MIN;

export interface BotRow {
  id: number;
  user_id: number;
  name: string;
  strategy: BotInput['strategy'];
  execution: BotInput['exec'];
  account_id: number | null;
  market: BotInput['market'];
  area: 'crypto' | 'stocks';
  symbols: string;
  tf: Timeframe;
  config: string;
  status: BotStatus;
  status_reason: string | null;
  command: string | null;
  state: string;
  starts_at: number;
  ends_at: number | null;
  created_at: number;
  updated_at: number;
  ran_at: number | null;
}

/** What the API asks the engine (TD-BOT §1): to end with an action, or to forget an order of a problem. */
export interface BotCommand {
  end?: BotEndAction;
  reason?: string;
  clearPending?: boolean;
}

/** What an order is for: applied once it went through (also after a restart, when it is sent again with its key). */
type Purpose =
  | { kind: 'p_open'; symbol: string; side: BotSide; sl: number; tp: number; lev: number; signalTime?: number }
  | { kind: 'p_close'; symbol: string; side: BotSide; reason: BotTradeReason }
  | { kind: 'g_moves'; moves: GridMove[]; start: boolean }
  | { kind: 'g_close'; reason: BotTradeReason; side?: BotSide }
  | { kind: 'd_open'; margin: number }
  | { kind: 'd_add'; ks: number[]; margin: number }
  | { kind: 'd_close'; reason: BotTradeReason };

type Pending = PendingOrder & { purpose: Purpose; lev: number; price: number; sl?: number | null };

export interface BotEngineDeps {
  db: Db;
  log: Logger;
  settings: SettingsService;
  market: MarketData;
  stocks: StockData | null;
  source: MarketSource;
  daily: DailySentimentService;
  calendar: CalendarService;
  ai: AiService;
  trading: TradingService;
  accounts: AccountsService;
  now?: () => number;
  uuid?: () => string;
  /** Tests: the closed bar and Slingshot on it, made by hand (as `runSlingshot` takes hand-made series). */
  bars?: (userId: number, input: BotInput, sym: string, now: number) => Promise<Bar | null>;
}

export const ACTIVE_BOTS = `SELECT b.* FROM bots b JOIN users u ON u.id = b.user_id WHERE b.status <> N'ended' AND u.disabled_at IS NULL ORDER BY b.id`;

/**
 * A symbol's price now (FD-BOT §8): a coin's last 1-minute close from the user's price source, a share's Nasdaq quote.
 * `open`: a share's only while the market trades ('closed' otherwise).
 */
export async function readPrice(d: Pick<BotEngineDeps, 'stocks' | 'source' | 'market'>, userId: number, market: BotInput['market'], sym: string, open: boolean): Promise<number | 'closed'> {
  if (market === 'stock') {
    const stocks = d.stocks;
    if (!stocks) throw new Error('datele pentru acțiuni nu sunt disponibile');
    if (open && (await stocks.confirmedStatus())?.state !== 'open') return 'closed';
    const q = await stocks.quote(sym);
    if (q.last === null || !(q.last > 0)) throw new Error('fără preț');
    return q.last;
  }
  const exchange = await d.source.forSymbol(userId, sym, '1m');
  let c;
  try {
    c = await d.market.candles(exchange, sym, '1m', 2);
  } catch (err) {
    if (!(err instanceof MarketError) || err.code !== 'UNSUPPORTED_TIMEFRAME') throw err;
    c = await d.market.candles(exchange, sym, '5m', 2);
  }
  const last = c.candles.at(-1);
  if (!last || !(last.c > 0)) throw new Error('fără preț');
  return last.c;
}

export function parseInput(row: Pick<BotRow, 'config'>): BotInput | null {
  try {
    const r = botInputSchema.safeParse(JSON.parse(row.config));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

export function parseCommand(raw: string | null): BotCommand | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as BotCommand;
  } catch {
    return null;
  }
}

export class BotEngine {
  readonly deps: BotEngineDeps;
  readonly now: () => number;
  readonly uuid: () => string;
  readonly instruments = new Map<string, { info: InstrumentInfo; at: number }>();
  private readonly pruned = new Map<number, number>();

  constructor(deps: BotEngineDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
    this.uuid = deps.uuid ?? randomUUID;
  }

  /** One look at every active bot. */
  async run(signal?: AbortSignal): Promise<void> {
    const rows = await this.deps.db.all<BotRow>(ACTIVE_BOTS);
    // The day's moods are read once a run per user and area (a decision on several bots of one user reads them once).
    const moods = new Map<string, Promise<MarketMood>>();
    for (const row of rows) {
      if (signal?.aborted) break;
      await this.look(row, moods);
    }
  }

  /** One bot (exported for the tests and for the bot just made, which looks at once). */
  async look(row: BotRow, moods = new Map<string, Promise<MarketMood>>()): Promise<void> {
    const run = new BotRun(this, row, moods);
    try {
      await run.go();
    } catch (err) {
      run.unexpected(err as Error);
    }
    await run.save();
    const last = this.pruned.get(row.id) ?? 0;
    if (this.now() - last > PRUNE_EVERY_MS) {
      this.pruned.set(row.id, this.now());
      await this.deps.db.run(`DELETE FROM bot_events WHERE bot_id = ? AND id NOT IN (SELECT TOP (${EVENTS_KEPT}) id FROM bot_events WHERE bot_id = ? ORDER BY id DESC)`, [row.id, row.id]);
    }
  }
}

export interface Bar {
  r: SlingshotResult;
  closed: number;
  closedTime: number;
  close: number;
}

class BotRun {
  private readonly e: BotEngine;
  private readonly row: BotRow;
  private readonly moods: Map<string, Promise<MarketMood>>;
  private readonly now: number;
  private readonly st: BotState;
  private readonly input: BotInput | null;
  private readonly events: { kind: BotEventKind; symbol: string | null; message: string; detail: BotEventDetail | null }[] = [];
  private readonly trades: ClosedTrade[] = [];
  private status: BotStatus;
  private reason: string | null;
  private commandSeen: string | null;
  private clearCommand = false;
  private exec: Executor | null = null;
  private tz = 'UTC';
  /** An order is waiting to be tried again, or the bot hit a problem: nothing more this look. */
  private halted = false;
  private portfolio: Portfolio | null | undefined = undefined;

  constructor(e: BotEngine, row: BotRow, moods: Map<string, Promise<MarketMood>>) {
    this.e = e;
    this.row = row;
    this.moods = moods;
    this.now = e.now();
    this.st = parseState(row.state);
    this.input = parseInput(row);
    this.status = row.status;
    this.reason = row.status_reason;
    this.commandSeen = row.command;
  }

  private get d() {
    return this.e.deps;
  }

  private note(kind: BotEventKind, message: string, symbol: string | null = null, detail: BotEventDetail | null = null): void {
    this.events.push({ kind, symbol, message: message.slice(0, 600), detail });
  }

  private setStatus(status: BotStatus, reason: string | null): void {
    this.status = status;
    this.reason = reason;
  }

  /** The bot cannot go on by itself (also while ending: a close whose fate is unknown is not sent again blindly). */
  private problem(message: string): void {
    this.halted = true;
    // Said once: the same problem found again at the next look is not news.
    if (this.status === 'problem' && this.reason === message) return;
    this.setStatus('problem', message);
    this.note('problem', message);
  }

  unexpected(err: Error): void {
    this.st.errors += 1;
    this.d.log.warn(`bot ${this.row.id}: ${err.message}`);
    this.note('problem', `Eroare neașteptată: ${err.message}`);
    if (this.st.errors >= ERRORS_MAX && this.status !== 'ending' && this.status !== 'ended') this.setStatus('problem', `Eroare neașteptată, de ${ERRORS_MAX} ori la rând: ${err.message}`);
  }

  async go(): Promise<void> {
    const input = this.input;
    if (!input) {
      this.setStatus('ended', 'Setările botului nu se mai pot citi.');
      return;
    }
    const settings = await this.d.settings.forUser(this.row.user_id);
    this.tz = settings.timezone;

    // The API's command: to end, or to forget an order after a problem (TD-BOT §1).
    const cmd = parseCommand(this.row.command);
    if (cmd) {
      this.clearCommand = true;
      if (cmd.clearPending) {
        this.st.pending = null;
        this.st.exitFailures = 0;
        this.st.errors = 0;
      }
      if (cmd.end && this.status === 'ending') {
        this.st.endAction = cmd.end;
        this.st.endReason = cmd.reason ?? 'Oprit de utilizator.';
      }
    }
    this.retf(input);

    // The account of a real bot.
    if (input.exec === 'real') {
      const access = this.row.account_id !== null ? await this.d.accounts.tradingAccess(this.row.account_id) : null;
      if (!access || access.userId !== this.row.user_id) {
        this.setStatus('ended', 'Contul a fost șters: pozițiile rămân pe platformă.');
        this.note('end', 'Contul a fost șters: botul s-a încheiat. Pozițiile lui rămân pe platformă.');
        return;
      }
      this.exec = new RealExec({
        trading: this.d.trading,
        userId: this.row.user_id,
        accountId: this.row.account_id as number,
        market: input.market,
        etoro: TRADING[access.exchange as keyof typeof TRADING]?.etoro === true,
        refs: this.st.refs,
        refsWait: this.st.refsWait,
        feePct: input.fee,
        instruments: this.e.instruments,
        now: this.e.now,
      });
    } else this.exec = new PaperExec(input.fee);

    // The period.
    if (this.status === 'scheduled') {
      if (this.now < this.row.starts_at) return;
      this.setStatus('running', null);
      this.note('start', 'Botul a pornit.');
    }
    if (this.row.ends_at !== null && this.now >= this.row.ends_at && (this.status === 'running' || this.status === 'paused' || this.status === 'problem')) {
      this.setStatus('ending', null);
      this.st.endAction = input.endAction;
      this.st.endReason = 'Perioada s-a terminat.';
      this.note('info', `Perioada s-a terminat: ${input.endAction === 'close' ? 'botul închide pozițiile' : input.endAction === 'finish' ? 'botul termină tranzacțiile deschise, fără altele noi' : 'pozițiile rămân deschise'}.`);
    }
    if (this.status === 'ending' && !this.st.endAction) this.st.endAction = input.endAction;
    if (this.status === 'ending' && this.st.endAction === 'leave') return this.end(this.st.endReason ?? 'Oprit.', this.hasPositions() ? 'Pozițiile rămân deschise.' : null);
    // Nothing open: nothing to close or to finish (also with the market closed or no price).
    if (this.status === 'ending' && !this.hasPositions() && !this.st.pending) return this.end(this.st.endReason ?? 'Oprit.', null);

    // The day (the user's), for the daily loss.
    const day = dayKey(this.now, this.tz);
    if (this.st.day !== day) {
      this.st.day = day;
      this.st.dayRealized = 0;
    }

    if (!(await this.readPrices(input))) return;

    // An order that did not go through last time goes first, with its key.
    if (this.st.pending) {
      await this.resend(this.st.pending as Pending);
      if (this.halted) return;
    }

    if (input.exec === 'real') await this.reconcile(input);
    if (this.halted) return;
    // A problem sends nothing until "Reia": an order whose fate is unknown may have gone through (FD-BOT §3).
    if (this.status === 'problem') return;

    this.limits(input);
    const closing = this.status === 'ending' && this.st.endAction === 'close';
    const entries = this.status === 'running' && this.st.dayBlocked !== day;
    if (input.strategy === 'grid') await this.grid(input, input.grid, entries, closing || this.status === 'ending');
    else if (input.strategy === 'dca') await this.dca(input, input.dca, entries, closing);
    else await this.premium(input, input.premium, entries, closing);
    if (this.halted) return;

    // A loss limit reached on this look, or the closing finished.
    this.limits(input);
    if (this.status === 'ending' && !this.hasPositions()) this.end(this.st.endReason ?? 'Oprit.', null);
  }

  /**
   * FD-BOTTF: the signals' timeframe changed since the last look. As at the start, only the bars that close from now on;
   * the open positions keep their SL / TP, and the signal they entered on (on the old timeframe) is no longer followed.
   */
  private retf(input: BotInput): void {
    const ps = this.st.premium;
    if (input.strategy !== 'premium' || !ps || ps.tf === input.tf) return;
    const was = ps.tf;
    ps.tf = input.tf;
    // A state from before FD-BOTTF: its bars are the bot's own.
    if (was === undefined) return;
    ps.lastBar = {};
    ps.nextRead = {};
    for (const sym of input.symbols) {
      const key = this.st.noted[sym];
      if (key === 'history' || key?.startsWith('read:')) delete this.st.noted[sym];
    }
    let followed = false;
    for (const pos of ps.positions) {
      if (pos.signalTime === undefined) continue;
      delete pos.signalTime;
      followed = true;
    }
    const pending = this.st.pending as Pending | null;
    if (pending?.purpose.kind === 'p_open' && pending.purpose.signalTime !== undefined) {
      delete pending.purpose.signalTime;
      followed = true;
    }
    this.note(
      'info',
      `Timeframe-ul semnalelor e acum ${input.tf} (era ${was}): botul ia semnalele de pe lumânările de ${input.tf} care se închid de acum.${followed ? ` Pozițiile deschise își păstrează SL / TP-ul; semnalul de ${was} pe care au intrat nu se mai urmărește.` : ''}`,
    );
  }

  private end(reason: string, more: string | null): void {
    this.setStatus('ended', reason);
    this.note('end', `Botul s-a încheiat. ${reason}${more ? ` ${more}` : ''}`);
  }

  // ---------------- prices ----------------

  /** The price of each symbol now; false when the bot can do nothing this look. */
  private async readPrices(input: BotInput): Promise<boolean> {
    let missing = false;
    let closedMarket = false;
    for (const sym of input.symbols) {
      try {
        const p = await this.price(input, sym);
        if (p === 'closed') {
          closedMarket = true;
          continue;
        }
        this.st.prices[sym] = { p, at: this.now };
      } catch (err) {
        missing = true;
        this.d.log.warn(`bot ${this.row.id} price ${sym}: ${(err as Error).message}`);
      }
    }
    if (!missing) {
      this.st.noPriceSince = null;
      // The prices are back: a problem that was only theirs is over by itself.
      if (this.status === 'problem' && this.reason === NO_PRICE) {
        this.setStatus('running', null);
        this.note('info', 'Prețul se citește din nou: botul merge mai departe.');
      }
      return !closedMarket || input.symbols.some((s) => this.fresh(s) !== null);
    }
    this.st.noPriceSince ??= this.now;
    if (this.now - this.st.noPriceSince >= NO_PRICE_MS && this.status !== 'problem' && this.status !== 'ending') {
      this.setStatus('problem', NO_PRICE);
      this.note('problem', 'Prețul nu se poate citi de 10 minute: botul nu face nimic până revine.');
    }
    return input.symbols.some((s) => this.fresh(s) !== null);
  }

  private price(input: BotInput, sym: string): Promise<number | 'closed'> {
    return readPrice(this.d, this.row.user_id, input.market, sym, true);
  }

  /** This look's price of a symbol (null: none now). */
  private fresh(sym: string): number | null {
    const v = this.st.prices[sym];
    return v && v.at === this.now ? v.p : null;
  }

  // ---------------- orders ----------------

  /** Sends an order for a purpose and applies it; false when it did not go through. */
  private async send(o: BotOrder, purpose: Purpose): Promise<boolean> {
    if (this.halted || !this.exec) return false;
    if (!(o.qty > 0)) return false;
    const key = this.e.uuid();
    // Real: the key is saved, with the quantity that leaves, before the order leaves (a restart sends it again with it).
    const ready =
      this.input?.exec === 'real'
        ? async (qty: number) => {
            const pending: Pending = { key, symbol: o.symbol, side: o.side, qty, reduce: o.reduce, at: this.now, purpose, lev: o.lev, price: o.price, sl: o.sl ?? null };
            this.st.pending = pending;
            await this.saveState();
          }
        : undefined;
    return this.finish(await this.exec.order(o, key, ready), purpose, o);
  }

  private async resend(p: Pending): Promise<void> {
    if (!this.exec) return;
    const price = this.fresh(p.symbol) ?? p.price;
    const o: BotOrder = { symbol: p.symbol, side: p.side, qty: p.qty, reduce: p.reduce, lev: p.lev, price, sl: p.sl ?? null, at: p.at };
    this.noteOnce(p.symbol, `resend:${p.key}`, 'order', `Ordinul de la ${new Date(p.at).toISOString().slice(11, 16)} UTC se trimite din nou, cu aceeași cheie.`);
    await this.finish(await this.exec.order(o, p.key, undefined, true), p.purpose, o);
  }

  private async finish(r: Awaited<ReturnType<Executor['order']>>, purpose: Purpose, o: BotOrder): Promise<boolean> {
    if (r.ok) {
      this.st.pending = null;
      this.st.lastOrderAt[o.symbol] = this.now;
      if (o.reduce) this.st.exitFailures = 0;
      this.apply(purpose, r.fill);
      return true;
    }
    const exit = purpose.kind === 'p_close' || purpose.kind === 'g_close' || purpose.kind === 'd_close';
    switch (r.kind) {
      case 'retry':
        this.noteOnce(o.symbol, `retry:${r.message}`, 'order', `Ordinul n-a plecat acum (${r.message}): se încearcă din nou la fiecare verificare, cu aceeași cheie.`);
        this.halted = true;
        return false;
      case 'refused':
        this.st.pending = null;
        if (exit) {
          this.st.exitFailures += 1;
          this.note('order', `Ieșirea a fost refuzată: ${r.message}`, o.symbol);
          if (this.st.exitFailures >= EXIT_FAILURES_MAX) this.problem(`Ieșirea a fost refuzată de ${EXIT_FAILURES_MAX} ori la rând: ${r.message}`);
        } else {
          // No new entry on the symbol for a while (the same refusal every 30 s says nothing new), said once.
          this.st.entryPause[o.symbol] = this.now + ENTRY_PAUSE_MS;
          this.noteOnce(o.symbol, `refused:${r.message}`, 'skip', `Intrarea a fost refuzată: ${r.message} Botul mai încearcă peste ${ENTRY_PAUSE_MS / MIN} minute.`);
        }
        return false;
      case 'gone':
        this.st.pending = null;
        this.end('Contul a fost șters: pozițiile rămân pe platformă.', null);
        this.halted = true;
        return false;
      default:
        this.st.pending = null;
        this.problem(`${r.message} Verifică pozițiile în Tranzacții, apoi apasă „Reia”.`);
        return false;
    }
  }

  private apply(purpose: Purpose, fill: Fill): void {
    const st = this.st;
    switch (purpose.kind) {
      case 'p_open': {
        const ps = this.premiumState();
        const pos: BotPosition = {
          symbol: purpose.symbol,
          side: purpose.side,
          qty: fill.qty,
          entry: fill.price,
          margin: (fill.qty * fill.price) / purpose.lev,
          lev: purpose.lev,
          fees: fill.fee,
          openedAt: this.now,
          sl: purpose.sl,
          tp: purpose.tp,
          signalTime: purpose.signalTime,
        };
        ps.positions.push(pos);
        st.fees += fill.fee;
        return;
      }
      case 'p_close': {
        const ps = this.premiumState();
        const i = ps.positions.findIndex((p) => p.symbol === purpose.symbol && p.side === purpose.side);
        if (i < 0) return;
        const pos = ps.positions[i] as BotPosition;
        ps.positions.splice(i, 1);
        const pnl = this.closeTrade(pos.symbol, pos.side, pos.qty, pos.entry, fill.price, pos.fees, fill.fee, pos.openedAt, purpose.reason);
        ps.recent = [...(ps.recent ?? []), pos.margin > 0 ? (pnl / pos.margin) * 100 : 0].slice(-5);
        if (pnl < 0 && this.input?.strategy === 'premium' && this.input.premium.cooldownMin > 0) ps.cooldownUntil = this.now + this.input.premium.cooldownMin * MIN;
        return;
      }
      case 'g_moves': {
        const g = st.grid;
        if (!g) return;
        for (const m of purpose.moves) {
          const s = g.slots[m.i];
          if (!s) continue;
          const fee = (g.qty * fill.price * (this.input?.fee ?? 0)) / 100;
          if (m.open) {
            s.entry = fill.price;
            s.openedAt = this.now;
            s.fees = fee;
            st.fees += fee;
          } else if (s.entry !== null) {
            this.closeTrade(this.input?.symbols[0] ?? '', s.side, g.qty, s.entry, fill.price, s.fees, fee, s.openedAt ?? this.now, 'grid');
            s.entry = null;
            s.openedAt = null;
            s.fees = 0;
          }
        }
        if (purpose.start) g.started = true;
        return;
      }
      case 'g_close': {
        const g = st.grid;
        if (!g) return;
        for (const s of g.slots) {
          if (s.entry === null || (purpose.side && s.side !== purpose.side)) continue;
          const fee = (g.qty * fill.price * (this.input?.fee ?? 0)) / 100;
          this.closeTrade(this.input?.symbols[0] ?? '', s.side, g.qty, s.entry, fill.price, s.fees, fee, s.openedAt ?? this.now, purpose.reason);
          s.entry = null;
          s.openedAt = null;
          s.fees = 0;
        }
        return;
      }
      case 'd_open': {
        const ds = (st.dca ??= newDca());
        const side = this.input?.strategy === 'dca' ? this.input.dca.direction : 'long';
        ds.cycle += 1;
        ds.deal = { side, basePrice: fill.price, filled: 0, qty: fill.qty, cost: fill.qty * fill.price, margin: purpose.margin, fees: fill.fee, openedAt: this.now };
        st.fees += fill.fee;
        return;
      }
      case 'd_add': {
        const deal = st.dca?.deal;
        if (!deal) return;
        deal.filled = Math.max(deal.filled, ...purpose.ks);
        deal.qty += fill.qty;
        deal.cost += fill.qty * fill.price;
        deal.margin += purpose.margin;
        deal.fees += fill.fee;
        st.fees += fill.fee;
        return;
      }
      case 'd_close': {
        const ds = st.dca;
        const deal = ds?.deal;
        if (!ds || !deal || this.input?.strategy !== 'dca') return;
        this.closeTrade(this.input.symbols[0] as string, deal.side, deal.qty, deal.cost / deal.qty, fill.price, deal.fees, fill.fee, deal.openedAt, purpose.reason);
        st.dca = afterClose(this.input.dca, ds, purpose.reason === 'tp' ? 'tp' : purpose.reason === 'sl' ? 'sl' : 'other', this.now);
        return;
      }
    }
  }

  /** Books a closed trade; its profit. */
  private closeTrade(symbol: string, side: BotSide, qty: number, entry: number, exit: number, entryFees: number, exitFee: number, openedAt: number, reason: BotTradeReason): number {
    const pnl = closePnl(side, entry, exit, qty, entryFees, exitFee);
    this.st.realized += pnl;
    this.st.dayRealized += pnl;
    this.st.fees += exitFee;
    this.st.trades += 1;
    if (pnl > 0) this.st.wins += 1;
    this.trades.push({ symbol, side, qty, entry, exit, pnl, fees: entryFees + exitFee, openedAt, closedAt: this.now, reason });
    return pnl;
  }

  private premiumState(): PremiumState {
    return (this.st.premium ??= { ...(this.input ? { tf: this.input.tf } : {}), lastBar: {}, nextRead: {}, positions: [], cooldownUntil: 0, ai: { day: '', n: 0 }, recent: [] });
  }

  // ---------------- positions, limits ----------------

  private hasPositions(): boolean {
    const st = this.st;
    return Boolean((st.premium?.positions.length ?? 0) > 0 || st.dca?.deal || st.grid?.slots.some((s) => s.entry !== null));
  }

  /** What the open positions would make now (null when a price is missing). */
  private unrealized(): number | null {
    const st = this.st;
    let sum = 0;
    for (const p of st.premium?.positions ?? []) {
      const price = this.fresh(p.symbol) ?? st.prices[p.symbol]?.p;
      if (price === undefined) return null;
      sum += openPnl(p.side, p.entry, price, p.qty);
    }
    const sym = this.input?.symbols[0] ?? '';
    const price = this.fresh(sym) ?? st.prices[sym]?.p;
    const deal = st.dca?.deal;
    if (deal) {
      if (price === undefined) return null;
      sum += (deal.side === 'long' ? 1 : -1) * (price * deal.qty - deal.cost);
    }
    for (const s of st.grid?.slots ?? []) {
      if (s.entry === null) continue;
      if (price === undefined) return null;
      sum += openPnl(s.side, s.entry, price, st.grid?.qty ?? 0);
    }
    return sum;
  }

  /** The daily loss (no entries until tomorrow) and the loss that stops the bot (FD-BOT §3). */
  private limits(input: BotInput): void {
    if (this.status === 'ended') return;
    const open = this.unrealized() ?? 0;
    if (input.dailyLoss !== null && this.st.dayBlocked !== this.st.day && this.st.dayRealized + open <= -input.dailyLoss) {
      this.st.dayBlocked = this.st.day;
      this.note('info', 'Pierderea maximă pe zi a fost atinsă: nicio intrare nouă până mâine. Ieșirile continuă.');
    }
    if (input.lossStop !== null && this.status !== 'ending' && this.status !== 'problem' && this.st.realized + open <= -input.lossStop) {
      this.setStatus('ending', null);
      this.st.endAction = 'close';
      this.st.endReason = 'Pierderea la care se oprește a fost atinsă.';
      this.note('info', 'Pierderea la care se oprește a fost atinsă: botul închide tot și se încheie.');
    }
  }

  // ---------------- the account (real) ----------------

  private async account(): Promise<Portfolio | null> {
    if (this.portfolio !== undefined) return this.portfolio;
    try {
      this.portfolio = this.row.account_id !== null ? await this.d.accounts.portfolio(this.row.account_id) : null;
    } catch (err) {
      this.d.log.warn(`bot ${this.row.id} portfolio: ${(err as Error).message}`);
      this.portfolio = null;
    }
    return this.portfolio;
  }

  /**
   * What the account holds of a symbol, each side apart (a hedge account, eToro's positions): the futures positions; on
   * spot the asset's total; for shares the holding plus eToro's positions (a short, a leveraged long). Null when unknown.
   */
  private async holdings(input: BotInput, sym: string): Promise<{ long: number; short: number } | null> {
    const pf = await this.account();
    if (!pf) return null;
    const sides = (rows: Portfolio['positions']) => ({
      long: rows.filter((p) => p.side !== 'short').reduce((a, p) => a + Math.abs(p.size ?? p.contracts), 0),
      short: rows.filter((p) => p.side === 'short').reduce((a, p) => a + Math.abs(p.size ?? p.contracts), 0),
    });
    if (input.market === 'futures') {
      if (pf.errors.positions || pf.stale.positions) return null;
      return sides(pf.positions.filter((p) => p.symbol === perpetualOf(sym)));
    }
    if (pf.errors.balances || pf.stale.balances) return null;
    const asset = input.market === 'stock' ? sym : sym.split('/')[0];
    const held = pf.balances.filter((b) => b.asset === asset).reduce((a, b) => a + b.total, 0);
    if (input.market === 'spot') return { long: held, short: 0 };
    if (pf.errors.positions || pf.stale.positions) return null;
    const open = sides(pf.positions.filter((p) => p.symbol === `${sym}/USD`));
    return { long: held + open.long, short: open.short };
  }

  /**
   * How much of a side the bot still holds on the account: at eToro its own positions by id (the user's on the same
   * share do not count, FD-BOT §10), elsewhere the account's holding of that side. Null when unknown.
   */
  private async mine(input: BotInput, sym: string, side: BotSide): Promise<number | null> {
    if (this.exec instanceof RealExec && this.exec.etoro) {
      try {
        return await this.exec.ownUnits(sym, side);
      } catch (err) {
        this.d.log.warn(`bot ${this.row.id} eToro positions ${sym}: ${(err as Error).message}`);
        return null;
      }
    }
    const h = await this.holdings(input, sym);
    return h === null ? null : h[side];
  }

  /** A position of the bot that is no longer on the account was closed outside it (FD-BOT §8). */
  private async reconcile(input: BotInput): Promise<void> {
    const recent = (sym: string) => this.now - (this.st.lastOrderAt[sym] ?? 0) < RECONCILE_GRACE_MS;
    if (input.strategy === 'premium') {
      const ps = this.st.premium;
      for (const pos of [...(ps?.positions ?? [])]) {
        if (recent(pos.symbol)) continue;
        const mine = await this.mine(input, pos.symbol, pos.side);
        if (mine === null || mine >= pos.qty * RECONCILE_TOLERANCE) continue;
        this.external(pos.symbol, pos.side, pos.qty, mine, pos.entry, pos.fees, pos.openedAt, () => {
          if (mine <= 0) ps!.positions.splice(ps!.positions.indexOf(pos), 1);
          else {
            pos.fees *= mine / pos.qty;
            pos.margin *= mine / pos.qty;
            pos.qty = mine;
          }
        });
      }
      return;
    }
    const sym = input.symbols[0] as string;
    if (recent(sym)) return;
    if (input.strategy === 'dca') {
      const ds = this.st.dca;
      const deal = ds?.deal;
      if (!ds || !deal) return;
      const mine = await this.mine(input, sym, deal.side);
      if (mine === null || mine >= deal.qty * RECONCILE_TOLERANCE) return;
      this.external(sym, deal.side, deal.qty, mine, deal.cost / deal.qty, deal.fees, deal.openedAt, () => {
        if (mine <= 0) this.st.dca = afterClose(input.dca, ds, 'other', this.now);
        else {
          deal.cost *= mine / deal.qty;
          deal.fees *= mine / deal.qty;
          deal.margin *= mine / deal.qty;
          deal.qty = mine;
        }
      });
      return;
    }
    const g = this.st.grid;
    if (!g?.started) return;
    const want = { long: 0, short: 0 };
    for (const s of g.slots) if (s.entry !== null) want[s.side] += g.qty;
    if (want.long === 0 && want.short === 0) return;
    const longHeld = want.long > 0 ? await this.mine(input, sym, 'long') : 0;
    const shortHeld = want.short > 0 ? await this.mine(input, sym, 'short') : 0;
    if (longHeld === null || shortHeld === null) return;
    const h = { long: longHeld, short: shortHeld };
    // One-way futures net the two sides: there only the side the grid holds is compared.
    const ok = input.market === 'futures' ? (want.long >= want.short ? h.long >= (want.long - want.short) * RECONCILE_TOLERANCE : h.short >= (want.short - want.long) * RECONCILE_TOLERANCE) : h.long >= want.long * RECONCILE_TOLERANCE && h.short >= want.short * RECONCILE_TOLERANCE;
    if (!ok) this.problem('Poziția grilei s-a schimbat în afara botului (închisă de mână, lichidată). Verifică în Tranzacții, apoi oprește sau reia botul.');
  }

  /** Books the part closed outside the bot at the price now. */
  private external(sym: string, side: BotSide, qty: number, left: number, entry: number, fees: number, openedAt: number, update: () => void): void {
    const price = this.fresh(sym) ?? this.st.prices[sym]?.p ?? entry;
    const gone = qty - Math.max(0, left);
    this.closeTrade(sym, side, gone, entry, price, fees * (gone / qty), 0, openedAt, 'external');
    update();
    this.note('exit', `${left > 0 ? 'O parte din poziție' : 'Poziția'} ${side} nu mai e în cont (închisă din afara botului: de mână, de platformă sau lichidată). Socotită închisă la ${fmtP(price)}.`, sym);
  }

  /** A futures position on a symbol where the bot holds nothing (one-way: the bot would mix with it). */
  private async foreign(input: BotInput, sym: string): Promise<boolean> {
    if (input.exec !== 'real' || input.market !== 'futures') return false;
    const h = await this.holdings(input, sym);
    return h !== null && h.long + h.short > 1e-12;
  }

  // ---------------- Grid ----------------

  private async grid(input: BotInput & { strategy: 'grid' }, cfg: GridConfig, open: boolean, ending: boolean): Promise<void> {
    const sym = input.symbols[0] as string;
    const entries = open && !this.entryPaused(sym);
    const p = this.fresh(sym);
    if (p === null) return;
    const order = (units: number): BotOrder => ({ symbol: sym, side: units > 0 ? 'buy' : 'sell', qty: Math.abs(units) * (this.st.grid?.qty ?? 0), reduce: false, lev: input.leverage, price: p });
    if (!this.st.grid) this.st.grid = await this.stepped(initGrid(cfg, input.maxAmount, input.leverage, p, this.st.refPrice), sym);
    let g = this.st.grid;
    if (!(g.qty > 0)) return this.problem('Cantitatea pe interval e sub pasul platformei: grila nu poate porni. Fă una nouă cu mai puține grile sau o sumă mai mare („Duplică”).');

    const closeAll = async (reason: BotTradeReason): Promise<boolean> => {
      if (this.separateGrids()) {
        // eToro: each side's positions closed by their own order.
        let ok = true;
        for (const side of ['long', 'short'] as const) {
          const n = g.slots.filter((s) => s.side === side && s.entry !== null).length;
          if (n > 0) ok = (await this.send({ ...order(side === 'long' ? -n : n), reduce: true }, { kind: 'g_close', reason, side })) && ok;
        }
        return ok;
      }
      const units = closeAllUnits(g);
      if (units === 0) return true;
      return this.send({ ...order(units), reduce: true }, { kind: 'g_close', reason });
    };

    if (ending) {
      // A grid has no trades to finish: ending closes it, unless its positions are left open.
      if (this.st.endAction !== 'leave') await closeAll(this.st.endReason?.startsWith('Pierderea') ? 'loss_limit' : this.row.ends_at !== null && this.now >= this.row.ends_at ? 'end' : 'stop');
      return;
    }
    const stopped = gridStopped(cfg, p);
    if (stopped && g.started) {
      if (await closeAll('grid_stop')) {
        this.setStatus('ending', null);
        this.st.endAction = 'close';
        this.st.endReason = stopped === 'below' ? `Prețul a coborât la „Oprește sub” (${fmtP(cfg.stopBelow as number)}).` : `Prețul a urcat la „Oprește peste” (${fmtP(cfg.stopAbove as number)}).`;
        this.note('exit', this.st.endReason, sym);
      }
      return;
    }
    if (g.waiting) {
      if (!triggered(g, p)) return;
      this.st.grid = g = await this.stepped(initGrid({ ...cfg, trigger: null }, input.maxAmount, input.leverage, p, p), sym);
      this.note('info', `Prețul de pornire (${fmtP(cfg.trigger as number)}) a fost atins.`, sym);
    }
    if (!g.started) {
      if (!entries) return;
      if (await this.foreign(input, sym)) return this.noteOnce(sym, 'foreign', 'skip', `Există deja o poziție pe ${perpetualOf(sym)} care nu e a botului: grila nu pornește.`);
      const moves = startMoves(cfg.direction, g, p);
      if (!moves.length) {
        g.started = true;
        this.note('info', `Grila a pornit la ${fmtP(p)}: ${g.slots.length} intervale, ${fmtQ(g.qty)} pe interval, nimic de cumpărat la pornire.`, sym);
        return;
      }
      if (await this.moveGrid(input, cfg, g, moves, p, true)) this.note('enter', `Grila a pornit la ${fmtP(p)}: ${moves.length} ${moves.length === 1 ? 'interval umplut' : 'intervale umplute'} la piață, ${fmtQ(g.qty)} pe interval.`, sym, { price: p, qty: g.qty * moves.length });
      return;
    }
    // In a pause, only the grids that empty move (FD-BOT §3).
    const moves = gridMoves(g, p).filter((m) => entries || !m.open);
    if (!moves.length) return;
    const units = netUnits(g, moves);
    const closes = moves.filter((m) => !m.open).length;
    const opens = moves.length - closes;
    const ok = units === 0 && !this.separateGrids() ? (this.apply({ kind: 'g_moves', moves, start: false }, { qty: 0, price: p, fee: 0 }), true) : await this.moveGrid(input, cfg, g, moves, p, false);
    if (ok) this.note(closes ? 'exit' : 'enter', `Grila la ${fmtP(p)}: ${[opens ? `${opens} ${opens === 1 ? 'interval umplut' : 'intervale umplute'}` : '', closes ? `${closes} ${closes === 1 ? 'interval golit' : 'intervale golite'}` : ''].filter(Boolean).join(', ')}.`, sym, { price: p });
  }

  /** eToro keeps every position apart: a grid's moves go as separate orders (opens, closes, each side), never netted. */
  private separateGrids(): boolean {
    return this.exec instanceof RealExec && this.exec.etoro;
  }

  /**
   * The grids the price reached: one net order (a short's stop loss with it), or at eToro one order per side and kind
   * (FD-BOT §10). The purpose of each order is its own grids.
   */
  private async moveGrid(input: BotInput & { strategy: 'grid' }, cfg: GridConfig, g: GridState, moves: GridMove[], p: number, start: boolean): Promise<boolean> {
    const sym = input.symbols[0] as string;
    const groups = this.separateGrids()
      ? (['long', 'short'] as const).flatMap((side) => [true, false].map((open) => moves.filter((m) => g.slots[m.i]?.side === side && m.open === open))).filter((x) => x.length > 0)
      : [moves];
    let all = true;
    for (const group of groups) {
      if (this.halted) return false;
      const units = netUnits(g, group);
      const long = g.slots[group[0]?.i ?? 0]?.side === 'long';
      // At eToro a group is all opens or all closes of one side; netted elsewhere, a mixed order is no close.
      const reduce = this.separateGrids() && !group[0]?.open;
      const opensShort = !long && Boolean(group[0]?.open);
      const ok = await this.send({ symbol: sym, side: units > 0 ? 'buy' : 'sell', qty: Math.abs(units) * g.qty, reduce, lev: input.leverage, price: p, sl: opensShort ? cfg.stopAbove : null }, { kind: 'g_moves', moves: group, start });
      all &&= ok;
    }
    return all;
  }

  /**
   * Real: a grid's unit in whole steps of the platform (KuCoin's BTC perpetual: 0.001), or the account would hold less
   * than the bot thinks and every check of it would find the difference.
   */
  private async stepped(g: GridState, sym: string): Promise<GridState> {
    if (this.exec instanceof RealExec) g.qty = floorToStep(g.qty, await this.exec.step(sym));
    return g;
  }

  // ---------------- DCA ----------------

  private async dca(input: BotInput & { strategy: 'dca' }, cfg: DcaConfig, open: boolean, closing: boolean): Promise<void> {
    const sym = input.symbols[0] as string;
    const entries = open && !this.entryPaused(sym);
    const p = this.fresh(sym);
    if (p === null) return;
    const ds = (this.st.dca ??= newDca());
    const lev = input.market === 'futures' ? input.leverage : 1;
    const buy = cfg.direction === 'long' ? 'buy' : 'sell';
    const sell = cfg.direction === 'long' ? 'sell' : 'buy';
    if (closing) {
      if (ds.deal) await this.send({ symbol: sym, side: sell, qty: ds.deal.qty, reduce: true, lev, price: p }, { kind: 'd_close', reason: this.st.endReason?.startsWith('Pierderea') ? 'loss_limit' : this.row.ends_at !== null && this.now >= this.row.ends_at ? 'end' : 'stop' });
      return;
    }
    const action = dcaStep(cfg, ds, p, this.now, entries);
    if (!action) return;
    if (action.kind === 'open') {
      if (await this.foreign(input, sym)) return this.noteOnce(sym, 'foreign', 'skip', `Există deja o poziție pe ${perpetualOf(sym)} care nu e a botului: ciclul nu pornește.`);
      // A short's stop loss goes with it (eToro asks for one): the cycle's, from this base price.
      const sl = cfg.direction === 'short' && cfg.stopLoss !== null ? p * (1 + cfg.stopLoss / 100) : null;
      if (await this.send({ symbol: sym, side: buy, qty: (action.margin * lev) / p, reduce: false, lev, price: p, sl }, { kind: 'd_open', margin: action.margin }))
        this.note('enter', `Ciclul ${ds.cycle} a pornit: ordinul de bază la ${fmtP(p)}.`, sym, { side: cfg.direction, price: p });
      return;
    }
    if (action.kind === 'add') {
      // A safety order the platform just refused waits like an entry.
      if (this.entryPaused(sym)) return;
      const sl = ds.deal && cfg.direction === 'short' ? dealLevels(cfg, ds.deal).sl : null;
      if (await this.send({ symbol: sym, side: buy, qty: (action.margin * lev) / p, reduce: false, lev, price: p, sl }, { kind: 'd_add', ks: action.ks, margin: action.margin }))
        this.note('enter', `${action.ks.length === 1 ? `Ordinul de siguranță ${action.ks[0]}` : `Ordinele de siguranță ${action.ks.join(', ')}`} la ${fmtP(p)}.`, sym, { side: cfg.direction, price: p });
      return;
    }
    const deal = ds.deal;
    if (!deal) return;
    const pnlBefore = this.st.realized;
    if (await this.send({ symbol: sym, side: sell, qty: deal.qty, reduce: true, lev, price: p }, { kind: 'd_close', reason: action.reason })) {
      const pnl = this.st.realized - pnlBefore;
      this.note('exit', `${action.reason === 'tp' ? 'Take profit' : 'Stop loss'} la ${fmtP(p)}: ciclul ${ds.cycle} s-a închis cu ${fmtSigned(pnl)}.${this.st.dca?.done && action.reason === 'sl' && cfg.slAction === 'stop' ? ' Botul se oprește (acțiunea la stop loss).' : ''}`, sym, { side: cfg.direction, price: p, pnl });
      if (this.st.dca?.done && !this.st.dca.deal) {
        this.setStatus('ending', null);
        this.st.endAction = 'close';
        this.st.endReason = action.reason === 'sl' && cfg.slAction === 'stop' ? 'Stop loss-ul unui ciclu oprește botul.' : 'Ciclurile s-au terminat.';
      }
    }
  }

  // ---------------- Slingshot Premium ----------------

  private async premium(input: BotInput & { strategy: 'premium' }, cfg: PremiumConfig, entries: boolean, closing: boolean): Promise<void> {
    const ps = this.premiumState();
    const futures = input.market === 'futures';
    const closeOrder = (pos: BotPosition, price: number): BotOrder => ({ symbol: pos.symbol, side: pos.side === 'long' ? 'sell' : 'buy', qty: pos.qty, reduce: true, lev: pos.lev, price });
    const close = async (pos: BotPosition, reason: BotTradeReason, price: number, why: string): Promise<boolean> => {
      const before = this.st.realized;
      const ok = await this.send(closeOrder(pos, price), { kind: 'p_close', symbol: pos.symbol, side: pos.side, reason });
      if (ok) {
        const pnl = this.st.realized - before;
        this.note('exit', `${why} Poziția ${pos.side} închisă la ${fmtP(price)} cu ${fmtSigned(pnl)}.`, pos.symbol, { side: pos.side, price, pnl });
      }
      return ok;
    };

    if (closing) {
      const reason: BotTradeReason = this.st.endReason?.startsWith('Pierderea') ? 'loss_limit' : this.row.ends_at !== null && this.now >= this.row.ends_at ? 'end' : 'stop';
      for (const pos of [...ps.positions]) {
        const p = this.fresh(pos.symbol);
        if (p !== null) await close(pos, reason, p, this.st.endReason ?? 'Oprit.');
        if (this.halted) return;
      }
      return;
    }

    // Exits at the price now: the stop loss, the take profit, a simulated liquidation.
    for (const pos of [...ps.positions]) {
      const p = this.fresh(pos.symbol);
      if (p === null) continue;
      const hit = exitAt(pos, p);
      const liq = input.exec === 'paper' && futures ? liquidationPrice(pos) : null;
      if (liq !== null && reached(p, liq, pos.side === 'short')) await close(pos, 'liquidation', p, `Prețul a atins lichidarea (${fmtP(liq)}).`);
      else if (hit) await close(pos, hit, p, hit === 'sl' ? `Stop loss atins (${fmtP(pos.sl as number)}).` : `Take profit atins (${fmtP(pos.tp as number)}).`);
      if (this.halted) return;
    }

    // The bars that closed since the last look.
    const tfMs = tfSeconds(input.tf) * 1000;
    for (const sym of input.symbols) {
      if (this.halted) return;
      if (this.now < (ps.nextRead[sym] ?? 0)) continue;
      let bar: Bar | null;
      try {
        bar = await this.bar(input, sym);
      } catch (err) {
        this.noteOnce(sym, `read:${(err as Error).message}`, 'info', `Lumânările nu se pot citi: ${(err as Error).message}`);
        ps.nextRead[sym] = this.now + MIN;
        continue;
      }
      if (!bar) {
        ps.nextRead[sym] = this.now + Math.min(tfMs, 15 * MIN);
        continue;
      }
      const seen = ps.lastBar[sym];
      if (seen === undefined) {
        // The first look waits for the first bar that closes after the start (FD-BOT §9).
        ps.lastBar[sym] = bar.closedTime;
        ps.nextRead[sym] = bar.closedTime + 2 * tfMs + 5000;
        continue;
      }
      if (bar.closedTime <= seen) {
        ps.nextRead[sym] = this.now + Math.min(tfMs, input.market === 'stock' ? 15 * MIN : MIN);
        continue;
      }
      ps.lastBar[sym] = bar.closedTime;
      ps.nextRead[sym] = bar.closedTime + 2 * tfMs + 5000;
      if (bar.r.warnings.includes('INSUFFICIENT_HISTORY')) this.noteOnce(sym, 'history', 'info', 'Istoricul e prea scurt pentru Slingshot: semnalele pot lipsi.');
      await this.onBar(input, cfg, sym, bar, entries, close);
    }
  }

  /** The platform refused the last entry on the symbol a moment ago. */
  private entryPaused(sym: string): boolean {
    return this.now < (this.st.entryPause[sym] ?? 0);
  }

  private noteOnce(sym: string, key: string, kind: BotEventKind, message: string): void {
    if (this.st.noted[sym] === key) return;
    this.st.noted[sym] = key;
    this.note(kind, message, sym);
  }

  /** The candles of the bot's timeframe and Slingshot on them, as the chart has them (the user's settings and history). */
  private async bar(input: BotInput, sym: string): Promise<Bar | null> {
    if (this.d.bars) return this.d.bars(this.row.user_id, input, sym, this.now);
    const settings = await this.d.settings.forUser(this.row.user_id);
    const params = settings.indicator;
    const tf = input.tf;
    const chartSec = tfSeconds(tf);
    const msSec = params.msTf ? tfSeconds(params.msTf) : chartSec;
    const count = (await this.d.source.forUser(this.row.user_id)).candles;
    let candles;
    let htf = null;
    if (input.market === 'stock') {
      const stocks = this.d.stocks;
      if (!stocks) throw new Error('datele pentru acțiuni nu sunt disponibile');
      const allowed = await stocks.timeframesFor(sym, this.row.user_id);
      if (!allowed.includes(tf)) throw new Error(`timeframe-ul ${tf} cere cheia ta Twelve Data (Setări → Date acțiuni)`);
      const c = await stocks.candles(sym, tf, count, this.row.user_id);
      candles = c;
      if (msSec > chartSec && params.msTf && allowed.includes(params.msTf as Timeframe)) {
        htf = (await stocks.candles(sym, params.msTf as Timeframe, htfCandleCount(count, chartSec, msSec, params.msSwing), this.row.user_id).catch(() => null))?.candles ?? null;
      }
    } else {
      const exchange = await this.d.source.forSymbol(this.row.user_id, sym, tf);
      candles = await this.d.market.candles(exchange, sym, tf, count);
      if (msSec > chartSec && params.msTf) {
        htf = (await this.d.market.candles(exchange, sym, params.msTf, htfCandleCount(count, chartSec, msSec, params.msSwing)).catch(() => null))?.candles ?? null;
      }
    }
    const closed = candles.lastClosedIndex;
    if (closed < 0) return null;
    const r = runSlingshot({ candles: candles.candles, htfCandles: htf, chartTfSec: chartSec, msTfSec: msSec, params, nowMs: this.now });
    const bar = candles.candles[closed];
    if (!bar) return null;
    return { r, closed, closedTime: bar.t, close: bar.c };
  }

  private async onBar(input: BotInput & { strategy: 'premium' }, cfg: PremiumConfig, sym: string, bar: Bar, entries: boolean, close: (pos: BotPosition, reason: BotTradeReason, price: number, why: string) => Promise<boolean>): Promise<void> {
    const ps = this.premiumState();
    const ev = barEvents(bar.r, bar.closed);
    const p = this.fresh(sym) ?? bar.close;

    // Exits by the bar: Slingshot's take profit signal, the trend turning, its own SL / TP touched between two looks,
    // a signal the other way.
    for (const pos of ps.positions.filter((x) => x.symbol === sym)) {
      const fate = pos.signalTime !== undefined ? signalFate(bar.r, pos.side, pos.signalTime, bar.closed) : null;
      const opposite = ev.signals.some((s) => s.side !== pos.side);
      let exit: { reason: BotTradeReason; why: string } | null = null;
      if (ev.tpSignal[pos.side] && cfg.exitOnTpSignal) exit = { reason: 'tp_signal', why: 'Semnalul de take profit Slingshot.' };
      else if (fate === 'flip' && cfg.exitOnFlip) exit = { reason: 'flip', why: 'Trendul s-a întors (semnalul a fost invalidat).' };
      else if (fate === 'sl' && cfg.levels === 'slingshot') exit = { reason: 'sl', why: 'Slingshot a marcat stop loss-ul atins pe lumânare.' };
      else if (fate === 'tp' && cfg.levels === 'slingshot') exit = { reason: 'tp', why: 'Slingshot a marcat take profit-ul atins pe lumânare.' };
      else if (opposite && cfg.exitOnOpposite) exit = { reason: 'opposite', why: 'Semnal în direcția opusă.' };
      if (exit) await close(pos, exit.reason, p, exit.why);
      if (this.halted) return;
    }

    if (!ev.signals.length) return;
    // Both sides on one bar: the rules first, for each; the side the market favours is tried first, and only it asks
    // the AI (one position per symbol).
    const tried: { s: SlingshotSignal; d: Decision }[] = [];
    for (const s of ev.signals) tried.push({ s, d: await this.decide(input, cfg, sym, s, bar, p, entries) });
    const rank = (t: (typeof tried)[number]) => (t.d.score ? favoured(t.s.side, t.d.score.score) : -1);
    tried.sort((a, b) => rank(b) - rank(a));
    let entered = false;
    for (const { s, d: rules } of tried) {
      if (this.halted) return;
      let d = rules;
      if (!d.skip && entered) d = { ...d, skip: 'botul a intrat deja pe semnalul celălalt.' };
      if (!d.skip) d = await this.confirm(input, cfg, sym, s, bar, p, d);
      if (d.skip) {
        this.note(d.kind ?? 'skip', `${s.side.toUpperCase()}: ${d.skip}`, sym, d.detail);
        continue;
      }
      const sized = d.sized!;
      const ok = await this.send({ symbol: sym, side: s.side === 'long' ? 'buy' : 'sell', qty: sized.qty, reduce: false, lev: sized.lev, price: p, sl: d.sl }, { kind: 'p_open', symbol: sym, side: s.side, sl: d.sl!, tp: d.tp!, lev: sized.lev, signalTime: s.time });
      if (ok) {
        entered = true;
        const lev = futures(input) ? ` ${sized.lev}×` : '';
        this.note('enter', `${s.side.toUpperCase()} la ${fmtP(p)}${lev}: SL ${fmtP(d.sl!)}, TP ${fmtP(d.tp!)}, scor ${fmtN(d.score!.score)}.${sized.notes.length ? ` ${sized.notes.join(' ')}` : ''}`, sym, { ...d.detail, qty: sized.qty, leverage: sized.lev });
      }
    }
  }

  /** The checks of FD-BOT §6, in their order; the first one that says no stops the entry. */
  private async decide(
    input: BotInput & { strategy: 'premium' },
    cfg: PremiumConfig,
    sym: string,
    s: SlingshotSignal,
    bar: Bar,
    price: number,
    entries: boolean,
  ): Promise<Decision> {
    const ps = this.premiumState();
    const detail: BotEventDetail = { side: s.side, price };
    if (!entries) return { skip: NO_ENTRIES[this.status] ?? 'pierderea maximă pe zi e atinsă: nicio intrare până mâine.', kind: 'signal', detail };
    if (cfg.direction !== 'both' && cfg.direction !== s.side) return { skip: `botul face doar ${cfg.direction}.`, kind: 'signal', detail };
    if (ps.positions.some((x) => x.symbol === sym)) return { skip: 'botul are deja o poziție pe simbol.', kind: 'signal', detail };
    if (this.entryPaused(sym)) return { skip: 'platforma a refuzat ultima intrare pe simbol: botul mai așteaptă câteva minute.', kind: 'signal', detail };
    const lv = levelsFor(cfg, s, price);
    if ('error' in lv) return { skip: lv.error, detail };
    Object.assign(detail, { sl: lv.sl, tp: lv.tp });
    if (cfg.newsWindowMin > 0) {
      const events = await highImpact(this.d.calendar, this.row.user_id, this.now - AFTER_EVENT_MS, this.now + cfg.newsWindowMin * MIN);
      const first = events[0];
      if (first) return { skip: `eveniment cu impact mare ${first.ts > this.now ? `peste ${Math.max(1, Math.round((first.ts - this.now) / MIN))} min` : 'chiar acum'}: ${first.title}.`, detail };
    }
    const mood = await this.mood(areaOf(input.market));
    if (cfg.areaVeto && areaAgainst(s.side, mood.area)) return { skip: `aria ${input.market === 'stock' ? 'Acțiuni' : 'Crypto'} e ${s.side === 'long' ? 'negativă' : 'pozitivă'} (${Math.round(mood.area!.index)}).`, detail };
    const coin = input.market === 'stock' ? sym : (sym.split('/')[0] as string);
    const news = await readSymbolNews(this.d.daily, this.row.user_id, coin, this.now);
    const structure = barEvents(bar.r, bar.closed).structure;
    // FD-BOTDIR: the market's score, the same for either side; each side has its threshold.
    const market = marketScore({ day: mood.day, area: mood.area, general: mood.general, symbol: news.score, slingshot: { structure: structure === null ? 'none' : structure === 'msBullish' ? 'up' : 'down' } }, cfg.weights);
    const score: BotScore = { score: market.score, limit: { side: s.side, value: limitOf(s.side, cfg) }, parts: market.parts };
    detail.score = score;
    if (!passes(s.side, score.score, cfg))
      return { skip: s.side === 'long' ? `scorul pieței ${fmtN(score.score)} e sub minimul pentru long (${cfg.longMin}).` : `scorul pieței ${fmtN(score.score)} e peste maximul pentru short (${cfg.shortMax}).`, detail, score };
    // Room for the trade.
    if (ps.positions.length >= cfg.maxOpen) return { skip: `sunt deja ${ps.positions.length} tranzacții deschise (cel mult ${cfg.maxOpen}).`, detail, score };
    if (this.now < ps.cooldownUntil) return { skip: `pauză după o pierdere, până la ${new Date(ps.cooldownUntil).toISOString().slice(11, 16)} UTC.`, detail, score };
    const committed = ps.positions.reduce((a, x) => a + x.margin, 0);
    const sized = sizeFor({ cfg, futures: futures(input), maxAmount: input.maxAmount, maxLeverage: input.leverage, free: input.maxAmount - committed, price, sl: lv.sl });
    if ('error' in sized) return { skip: sized.error, detail, score };
    return { detail, score, sl: lv.sl, tp: lv.tp, sized, news };
  }

  /** After the rules (FD-BOT §6, checks 8–9): the AI's last look, a position that is not the bot's, the account's money. */
  private async confirm(input: BotInput & { strategy: 'premium' }, cfg: PremiumConfig, sym: string, s: SlingshotSignal, bar: Bar, price: number, d: Decision): Promise<Decision> {
    const ps = this.premiumState();
    const { detail, score, sized } = d;
    const lv = { sl: d.sl as number, tp: d.tp as number };
    const structure = barEvents(bar.r, bar.closed).structure;
    // The AI can only stop an entry the rules approved.
    if (cfg.ai === 'confirm' && score) {
      const mood = await this.mood(areaOf(input.market));
      const news = d.news ?? (await readSymbolNews(this.d.daily, this.row.user_id, input.market === 'stock' ? sym : (sym.split('/')[0] as string), this.now));
      const day = new Date(this.now).toISOString().slice(0, 10);
      if (ps.ai.day !== day) ps.ai = { day, n: 0 };
      let verdict: Awaited<ReturnType<typeof askAi>>;
      if (ps.ai.n >= AI_PER_DAY) verdict = { error: `limita de ${AI_PER_DAY} întrebări pe zi a fost atinsă.` };
      else {
        ps.ai.n += 1;
        const events = await highImpact(this.d.calendar, this.row.user_id, this.now, this.now + 24 * 60 * MIN);
        const ms = bar.r.ms;
        verdict = await askAi(
          this.d.ai,
          this.d.log,
          this.row.user_id,
          {
            symbol: sym,
            side: s.side,
            tf: input.tf,
            price,
            sl: lv.sl,
            tp: lv.tp,
            levels: cfg.levels,
            trend: bar.r.uptrend[bar.closed] ? 'up' : 'down',
            structure: `${structure === 'msBullish' ? 'ultima rupere în sus' : structure === 'msBearish' ? 'ultima rupere în jos' : 'fără rupere'}${ms?.upper ? `, rezistență ${fmtP(ms.upper.price)}` : ''}${ms?.lower ? `, suport ${fmtP(ms.lower.price)}` : ''}`,
            score,
            mood,
            news,
            events,
            recent: ps.recent ?? [],
          },
          this.now,
        );
      }
      if ('error' in verdict) {
        if (cfg.aiFallback === 'skip') return { ...d, skip: `AI-ul nu a răspuns (${verdict.error}): fără intrare.` };
        this.note('info', `AI-ul nu a răspuns (${verdict.error}): intrarea merge după reguli.`, sym);
      } else {
        detail.ai = verdict.verdict;
        if (verdict.verdict.decision === 'skip') return { ...d, skip: `AI-ul a spus nu (${verdict.verdict.confidence}%): ${verdict.verdict.reason}` };
      }
    }
    if (await this.foreign(input, sym)) return { ...d, skip: `există deja o poziție pe ${perpetualOf(sym)} care nu e a botului.` };
    if (input.exec === 'real' && sized) {
      const free = await this.freeFunds(input, sym);
      if (free !== null && free < sized.margin) return { ...d, skip: `disponibil în cont ${fmtN(free, 2)}; tranzacția cere ${fmtN(sized.margin, 2)}.` };
    }
    return d;
  }

  private mood(area: 'crypto' | 'stocks'): Promise<MarketMood> {
    const key = `${this.row.user_id}|${area}`;
    let m = this.moods.get(key);
    if (!m) {
      m = readMood(this.d.daily, this.row.user_id, this.tz, area, this.now);
      this.moods.set(key, m);
    }
    return m;
  }

  /** The account's free money for an entry: USDT free for futures, the symbol's quote free on spot; null when unknown. */
  private async freeFunds(input: BotInput, sym: string): Promise<number | null> {
    const pf = await this.account();
    if (!pf) return null;
    if (input.market === 'futures') return pf.totals.futuresAvailable;
    const quote = sym.split('/')[1];
    const row = pf.balances.find((b) => b.asset === quote && (b.account === 'spot' || b.account === 'trade' || b.account === 'unified'));
    return row ? row.free : null;
  }

  // ---------------- saving ----------------

  private async saveState(): Promise<void> {
    await this.d.db.run('UPDATE bots SET state = ? WHERE id = ?', [JSON.stringify(this.st), this.row.id]);
  }

  async save(): Promise<void> {
    if (!this.halted && this.status !== 'problem' && this.events.every((e) => e.kind !== 'problem')) this.st.errors = 0;
    const db = this.d.db;
    await db.tx(async () => {
      await db.run('UPDATE bots SET state = ?, ran_at = ? WHERE id = ?', [JSON.stringify(this.st), this.now, this.row.id]);
      // The status changes only from the one this look started from: a pause or a stop sent meanwhile wins.
      if (this.status !== this.row.status || this.reason !== this.row.status_reason) {
        await db.run('UPDATE bots SET status = ?, status_reason = ?, updated_at = ? WHERE id = ? AND status = ?', [this.status, this.reason?.slice(0, 600) ?? null, this.now, this.row.id, this.row.status]);
      }
      if (this.clearCommand && this.commandSeen !== null) await db.run('UPDATE bots SET command = NULL WHERE id = ? AND command = ?', [this.row.id, this.commandSeen]);
      for (const t of this.trades) {
        await db.run('INSERT INTO bot_trades(bot_id, symbol, side, qty, entry, [exit], pnl, fees, opened_at, closed_at, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
          this.row.id,
          t.symbol,
          t.side,
          t.qty,
          t.entry,
          t.exit,
          t.pnl,
          t.fees,
          t.openedAt,
          t.closedAt,
          t.reason,
        ]);
      }
      for (const ev of this.events) {
        await db.run('INSERT INTO bot_events(bot_id, at, kind, symbol, message, detail) VALUES (?, ?, ?, ?, ?, ?)', [this.row.id, this.now, ev.kind, ev.symbol, ev.message, ev.detail ? JSON.stringify(ev.detail) : null]);
      }
    });
  }
}

const futures = (input: BotInput) => input.market === 'futures';

/** A signal checked: why it is not taken (`skip`), or its levels and size. */
interface Decision {
  skip?: string;
  kind?: BotEventKind;
  detail: BotEventDetail;
  score?: BotScore;
  sl?: number;
  tp?: number;
  sized?: Sized;
  /** The symbol's news read for the score (the AI reads them again otherwise). */
  news?: SymbolNews;
}

/** Why a signal is not taken while the bot cannot enter (running: the daily loss). */
const NO_ENTRIES: Partial<Record<BotStatus, string>> = { paused: 'botul e în pauză.', problem: 'botul are o problemă: nicio intrare până la „Reia”.', ending: 'botul se încheie: fără intrări noi.' };

const fmtN = (v: number, d = 1) => num(v, d);
const fmtP = price;
const fmtQ = qty;
const fmtSigned = signed;
