// The bots as the API serves them (FD-BOT §1, §7; TD-BOT §5): the list, the details, the form's check, making one, and
// what the user may do to it. The API writes the settings and asks; the engine alone moves positions (TD-BOT §1).
import {
  botInputSchema,
  botCurrency,
  dcaPlan,
  END_ACTION_RO,
  gridPlan,
  MAX_ACTIVE_BOTS,
  perpetualOf,
  rrText,
  STRATEGY_RO,
  type BotCheck,
  type BotDetail,
  type BotEdit,
  type BotEndAction,
  type BotEventRow,
  type BotInput,
  type BotPositionView,
  type BotTradeRow,
  type BotView,
} from '../../shared/bot.ts';
import { providerById } from '../../shared/providers.ts';
import { TRADING } from '../../shared/trading.ts';
import type { Db } from '../db/database.ts';
import { ConflictError, NotFoundError } from '../http/errors.ts';
import { formatIssues, ValidationError } from '../settings.ts';
import { dealAvg, dealLevels, nextSafety } from './dca.ts';
import { parseInput, readPrice, type BotCommand, type BotEngine, type BotRow } from './engine.ts';
import { num, price } from './format.ts';
import { scoreReach } from './score.ts';
import { newState, openPnl, parseState, type BotState } from './state.ts';

const fmtNum = num;
const fmtPrice = price;

/** What the bot has in play (margin on futures, the cost on spot), and what its positions would make at the last prices. */
export function exposure(input: BotInput, st: BotState): { committed: number; unrealized: number | null; positions: BotPositionView[] } {
  const positions: BotPositionView[] = [];
  let committed = 0;
  let unrealized: number | null = 0;
  const priceOf = (sym: string) => st.prices[sym]?.p ?? null;
  const add = (p: BotPositionView) => {
    positions.push(p);
    committed += p.margin;
    if (unrealized !== null) unrealized = p.unrealized === null ? null : unrealized + p.unrealized;
  };
  for (const p of st.premium?.positions ?? []) {
    const price = priceOf(p.symbol);
    add({ symbol: p.symbol, side: p.side, qty: p.qty, entry: p.entry, price, sl: p.sl, tp: p.tp, unrealized: price === null ? null : openPnl(p.side, p.entry, price, p.qty), leverage: p.lev, margin: p.margin, openedAt: p.openedAt });
  }
  const sym = input.symbols[0] as string;
  const price = priceOf(sym);
  const deal = st.dca?.deal;
  if (deal && input.strategy === 'dca') {
    const lv = dealLevels(input.dca, deal);
    const avg = dealAvg(deal);
    add({ symbol: sym, side: deal.side, qty: deal.qty, entry: avg, price, sl: lv.sl, tp: lv.tp, unrealized: price === null ? null : openPnl(deal.side, avg, price, deal.qty), leverage: input.leverage, margin: deal.margin, openedAt: deal.openedAt });
  }
  const g = st.grid;
  if (g) {
    let net = 0;
    let cost = 0;
    let margin = 0;
    let pnl = 0;
    let opened = Infinity;
    for (const s of g.slots) {
      if (s.entry === null) continue;
      const dir = s.side === 'long' ? 1 : -1;
      net += dir * g.qty;
      cost += dir * g.qty * s.entry;
      margin += (g.qty * s.entry) / g.lev;
      if (price !== null) pnl += openPnl(s.side, s.entry, price, g.qty);
      opened = Math.min(opened, s.openedAt ?? Infinity);
    }
    if (margin > 0) add({ symbol: sym, side: net >= 0 ? 'long' : 'short', qty: Math.abs(net), entry: net !== 0 ? cost / net : 0, price, sl: null, tp: null, unrealized: price === null ? null : pnl, leverage: g.lev, margin, openedAt: Number.isFinite(opened) ? opened : 0 });
  }
  return { committed, unrealized, positions };
}

const COLUMNS = 'id, user_id, name, strategy, execution, account_id, market, area, symbols, tf, config, status, status_reason, command, state, starts_at, ends_at, created_at, updated_at, ran_at';

export class BotService {
  private readonly db: Db;
  private readonly engine: BotEngine;
  private readonly now: () => number;

  constructor(db: Db, engine: BotEngine) {
    this.db = db;
    this.engine = engine;
    this.now = engine.now;
  }

  private get d() {
    return this.engine.deps;
  }

  private async own(userId: number, id: number): Promise<BotRow> {
    const row = await this.db.get<BotRow>(`SELECT ${COLUMNS} FROM bots WHERE id = ? AND user_id = ?`, [id, userId]);
    if (!row) throw new NotFoundError('Botul nu există.');
    return row;
  }

  private async accountsOf(userId: number) {
    return new Map((await this.d.accounts.list(userId)).map((a) => [a.id, a]));
  }

  private view(row: BotRow, accounts: Map<number, { id: number; label: string; exchange: string; env: string }>): BotView {
    const input = parseInput(row);
    const st = parseState(row.state);
    const symbols = input?.symbols ?? (JSON.parse(row.symbols) as string[]);
    const x = input ? exposure(input, st) : { committed: 0, unrealized: null, positions: [] };
    const acc = row.account_id !== null ? accounts.get(row.account_id) : undefined;
    return {
      id: row.id,
      name: row.name,
      strategy: row.strategy,
      exec: row.execution,
      market: row.market,
      area: row.area,
      symbols,
      tf: row.tf,
      account: acc ? { id: acc.id, label: acc.label, exchange: acc.exchange, env: acc.env } : null,
      status: row.status,
      statusReason: row.status_reason,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      currency: botCurrency(row.market, symbols),
      maxAmount: input?.maxAmount ?? 0,
      committed: x.committed,
      realized: st.realized,
      unrealized: x.positions.length ? x.unrealized : 0,
      trades: st.trades,
      wins: st.wins,
      openPositions: x.positions.length,
      createdAt: row.created_at,
      ranAt: row.ran_at,
    };
  }

  async list(userId: number): Promise<BotView[]> {
    const rows = await this.db.all<BotRow>(`SELECT ${COLUMNS} FROM bots WHERE user_id = ? ORDER BY CASE WHEN status = N'ended' THEN 1 ELSE 0 END, created_at DESC, id DESC`, [userId]);
    const accounts = rows.some((r) => r.account_id !== null) ? await this.accountsOf(userId) : new Map();
    return rows.map((r) => this.view(r, accounts));
  }

  async detail(userId: number, id: number): Promise<BotDetail> {
    const row = await this.own(userId, id);
    const input = parseInput(row);
    if (!input) throw new NotFoundError('Setările botului nu se mai pot citi.');
    const st = parseState(row.state);
    const accounts = row.account_id !== null ? await this.accountsOf(userId) : new Map();
    const history = await this.db.all<{ id: number; symbol: string; side: 'long' | 'short'; qty: number; entry: number; exit: number; pnl: number; fees: number; opened_at: number; closed_at: number; reason: BotTradeRow['reason'] }>(
      'SELECT TOP (200) id, symbol, side, qty, entry, [exit], pnl, fees, opened_at, closed_at, reason FROM bot_trades WHERE bot_id = ? ORDER BY closed_at DESC, id DESC',
      [id],
    );
    const events = await this.db.all<{ id: number; at: number; kind: BotEventRow['kind']; symbol: string | null; message: string; detail: string | null }>(
      'SELECT TOP (300) id, at, kind, symbol, message, detail FROM bot_events WHERE bot_id = ? ORDER BY id DESC',
      [id],
    );
    const g = st.grid;
    const deal = st.dca?.deal ?? null;
    return {
      ...this.view(row, accounts),
      input,
      positions: exposure(input, st).positions,
      grid: g ? { lines: g.lines, qty: g.qty, armed: g.waiting !== null, trigger: g.waiting?.trigger ?? null, slots: g.slots.map((s) => ({ side: s.side, entry: s.entry })) } : null,
      dca:
        st.dca && input.strategy === 'dca'
          ? {
              cycle: st.dca.cycle,
              cooldownUntil: st.dca.cooldownUntil > this.now() ? st.dca.cooldownUntil : null,
              deal: deal ? { side: deal.side, basePrice: deal.basePrice, avg: dealAvg(deal), qty: deal.qty, filled: deal.filled, ...dealLevels(input.dca, deal), next: nextSafety(input.dca, deal) } : null,
            }
          : null,
      history: history.map((t) => ({ id: t.id, symbol: t.symbol, side: t.side, qty: t.qty, entry: t.entry, exit: t.exit, pnl: t.pnl, fees: t.fees, openedAt: t.opened_at, closedAt: t.closed_at, reason: t.reason })),
      events: events.map((e) => {
        let detail = null;
        try {
          detail = e.detail ? JSON.parse(e.detail) : null;
        } catch {
          detail = null;
        }
        return { id: e.id, at: e.at, kind: e.kind, symbol: e.symbol, message: e.message, detail };
      }),
    };
  }

  /** The form's summary (FD-BOT §1): what the bot will do, the money it uses, and what is wrong with it. */
  async check(userId: number, input: BotInput): Promise<BotCheck> {
    const now = this.now();
    const errors: string[] = [];
    const warnings: string[] = [];
    const summary: string[] = [];
    const tz = (await this.d.settings.forUser(userId)).timezone;
    const cur = botCurrency(input.market, input.symbols);
    const futures = input.market === 'futures';
    const lev = futures ? input.leverage : 1;

    // The prices (and so that every symbol exists where the prices come from).
    let price: number | null = null;
    for (const [i, sym] of input.symbols.entries()) {
      try {
        const p = await readPrice(this.d, userId, input.market, sym, false);
        if (i === 0 && p !== 'closed') price = p;
      } catch (err) {
        if (input.market === 'stock') warnings.push(`Prețul lui ${sym} nu se poate citi acum (${(err as Error).message}).`);
        else errors.push(`${sym} nu se poate citi la sursa de prețuri: ${(err as Error).message}`);
      }
    }
    if (input.market === 'stock' && input.strategy === 'premium' && this.d.stocks) {
      for (const sym of input.symbols) {
        const allowed = await this.d.stocks.timeframesFor(sym, userId);
        if (!allowed.includes(input.tf)) errors.push(`${sym} pe ${input.tf} cere cheia ta Twelve Data (Setări → Date acțiuni); fără ea, botul merge pe 1d și 1w.`);
      }
    }

    // The account and its platform's minimums (real).
    let minCost: number | null = null;
    let minAmount: number | null = null;
    if (input.exec === 'real') {
      const caps = (await this.d.trading.caps(userId)).find((a) => a.accountId === input.accountId);
      const platform = caps ? (providerById(caps.exchange)?.name ?? caps.exchange) : '';
      const stocks = input.market === 'stock';
      if (!caps) errors.push('Contul ales nu există.');
      else if (caps.kind !== (stocks ? 'stocks' : 'crypto')) errors.push(stocks ? `${caps.label} nu e un cont de acțiuni.` : `${caps.label} nu e un cont crypto.`);
      else if (!caps.enabled) errors.push(`Tranzacționarea e oprită pe contul ${caps.label}: pornește-o din pagina Tranzacții.`);
      else if (!caps.markets.includes(input.market)) errors.push(`Contul ${caps.label} nu tranzacționează pe ${stocks ? 'acțiuni' : futures ? 'futures' : 'spot'} (pornește-o din Tranzacții, cu o cheie care are dreptul).`);
      else {
        // FD-BOT §10: shares go short only at eToro (Trading 212 has no short; Alpaca nets one position per symbol), and
        // eToro opens a short only with a stop loss.
        if (stocks) {
          const etoro = TRADING[caps.exchange as keyof typeof TRADING]?.etoro === true;
          const short = input.strategy === 'grid' ? input.grid.direction !== 'long' : input.strategy === 'dca' ? input.dca.direction === 'short' : input.premium.direction !== 'long';
          if (short && !etoro) errors.push(`La ${platform}, botul face doar long: short pe acțiuni doar la eToro.`);
          if (short && etoro && input.strategy === 'dca' && input.dca.stopLoss === null) errors.push('eToro cere stop loss la un short: pune stop loss-ul ciclului.');
          if (short && etoro && input.strategy === 'grid' && input.grid.stopAbove === null) errors.push('eToro cere stop loss la un short: pune „Oprește peste” (e stop loss-ul fiecărui interval short).');
          warnings.push('Pe acțiuni, botul tranzacționează doar cât bursa e deschisă (sesiunea obișnuită). Sumele lui sunt în USD; un cont în altă monedă plătește în moneda lui.');
        }
        for (const sym of input.symbols) {
          const tradeSym = futures ? perpetualOf(sym) : sym;
          try {
            const info = await this.d.trading.instrument(userId, input.accountId as number, input.market, tradeSym);
            if (sym === input.symbols[0]) {
              minCost = info.minCost;
              minAmount = info.minAmount;
            }
            if (futures && info.maxLeverage !== null && input.leverage > info.maxLeverage) errors.push(`Levierul maxim pe ${tradeSym} e ${info.maxLeverage}×.`);
            // FD-BOT §9: on one-way futures the bot would mix with a position that is not its own; it waits for it to go.
            if (futures && (info.position || info.hedgePositions?.long || info.hedgePositions?.short)) warnings.push(`Pe ${tradeSym} e deja o poziție deschisă: botul nu intră cât timp ea e acolo (s-ar amesteca cu a lui). Nu deschide de mână poziții pe simbolul unui bot.`);
          } catch (err) {
            errors.push(`${platform} nu are ${tradeSym}${futures ? ' pe futures' : ''}: ${(err as Error).message}`);
          }
        }
      }
      warnings.push(`Botul trimite ordine reale și închide pozițiile el însuși, la piață. Cu serverul Sentiq oprit, nu poate închide nimic: pierderea pe zi${futures ? ', oprirea la o pierdere și levierul limitează' : ' și oprirea la o pierdere limitează'} riscul.`);
    }
    if (futures && input.leverage > 10) warnings.push(`Levier ${input.leverage}×: o mișcare de ${fmtNum(100 / input.leverage)}% împotriva poziției îi consumă marja.`);

    // What the strategy will do.
    let capital = input.maxAmount;
    let grid: BotCheck['grid'] = null;
    let dca: BotCheck['dca'] = null;
    if (input.strategy === 'grid') {
      const g = input.grid;
      const at = price ?? (g.lower + g.upper) / 2;
      grid = gridPlan(g, input.maxAmount, lev, input.fee, at);
      summary.push(
        `Între ${fmtPrice(g.lower)} și ${fmtPrice(g.upper)}, ${g.grids} grile ${g.spacing === 'geometric' ? 'geometrice' : 'aritmetice'}: ${fmtNum(grid.qty, 8)} ${input.market === 'stock' ? 'acțiuni' : (input.symbols[0]?.split('/')[0] ?? '')} pe grilă, câștig pe grilă ${fmtNum(grid.profit.min)}–${fmtNum(grid.profit.max)}% după comisioane.`,
      );
      if (g.direction === 'neutral') summary.push('Pornește fără poziție: long sub preț, short peste el.');
      else if (price !== null) summary.push(grid.atStart > 0 ? `La pornire ${g.direction === 'long' ? 'cumpără' : 'vinde'} ${grid.atStart} ${grid.atStart === 1 ? 'grilă' : 'grile'} la piață (${fmtNum(grid.startCost)} ${cur}${futures ? ' marjă' : ''}).` : 'La pornire nu e nimic de cumpărat: prețul e peste grilă.');
      if (g.trigger !== null) summary.push(`Așteaptă până când prețul atinge ${fmtPrice(g.trigger)}.`);
      if (g.stopBelow !== null || g.stopAbove !== null) summary.push(`Se oprește și închide tot ${[g.stopBelow !== null ? `sub ${fmtPrice(g.stopBelow)}` : '', g.stopAbove !== null ? `peste ${fmtPrice(g.stopAbove)}` : ''].filter(Boolean).join(' sau ')}.`);
      if (price !== null && (price < g.lower || price > g.upper)) warnings.push(`Prețul de acum (${fmtPrice(price)}) e în afara grilei: botul nu face nimic până intră în ea.`);
      if (minCost !== null && grid.minOrder < minCost) errors.push(`Ordinul unei grile (${fmtNum(grid.minOrder)} ${cur}) e sub minimul platformei (${fmtNum(minCost)} ${cur}): mai puține grile sau o sumă mai mare.`);
      if (minAmount !== null && grid.qty < minAmount) errors.push(`Cantitatea pe grilă (${fmtNum(grid.qty, 8)}) e sub minimul platformei (${minAmount}): mai puține grile sau o sumă mai mare.`);
    } else if (input.strategy === 'dca') {
      const d = input.dca;
      dca = dcaPlan(d, price ?? 1, lev);
      capital = dca.at(-1)?.total ?? d.baseOrder;
      const last = dca.at(-1);
      summary.push(
        `Ordinul de bază ${fmtNum(d.baseOrder)} ${cur}${d.safetyOrders ? `, apoi ${d.safetyOrders} ${d.safetyOrders === 1 ? 'ordin' : 'ordine'} de siguranță până la ${d.direction === 'long' ? '−' : '+'}${fmtNum(last?.deviation ?? 0)}%` : ''}; take profit ${fmtNum(d.takeProfit)}% din prețul mediu${d.stopLoss !== null ? `, stop loss ${fmtNum(d.stopLoss)}% din prețul de bază` : ''}.`,
      );
      summary.push(`Capitalul unui ciclu: ${fmtNum(capital)} ${cur}${futures ? ` (marjă, poziția până la ${fmtNum(capital * lev)} ${cur})` : ''}. ${d.repeat ? `Ciclurile se repetă${d.maxCycles !== null ? `, cel mult ${d.maxCycles}` : ''}${d.cooldownMin ? `, cu ${d.cooldownMin} min pauză` : ''}.` : 'Un singur ciclu.'}`);
      if (price === null) dca = null;
      const smallest = Math.min(d.baseOrder, d.safetyOrders ? d.safetyOrder : Infinity) * lev;
      if (minCost !== null && smallest < minCost) errors.push(`Cel mai mic ordin (${fmtNum(smallest)} ${cur}) e sub minimul platformei (${fmtNum(minCost)} ${cur}).`);
    } else {
      const p = input.premium;
      const dirRo = p.direction === 'both' ? 'long și short' : p.direction;
      // FD-BOTDIR: each side with its threshold on the market's score.
      const when = p.direction === 'both' ? `: long când scorul pieței e cel puțin ${p.longMin}, short când e cel mult ${p.shortMax}` : p.direction === 'long' ? `, când scorul pieței e cel puțin ${p.longMin}` : `, când scorul pieței e cel mult ${p.shortMax}`;
      summary.push(`Intră pe semnalele Slingshot ${dirRo} de pe ${input.tf}${when}.${p.ai === 'confirm' ? ' AI-ul confirmă fiecare intrare.' : ''}`);
      const reach = scoreReach(p.weights);
      if (p.direction !== 'short' && p.longMin > reach) warnings.push(`Cu ponderile alese, scorul pieței ajunge cel mult la ${fmtNum(reach, 1)}: cu minimul ${p.longMin}, botul nu intră niciodată long.`);
      if (p.direction !== 'long' && p.shortMax < 100 - reach) warnings.push(`Cu ponderile alese, scorul pieței coboară cel mult până la ${fmtNum(100 - reach, 1)}: cu maximul ${p.shortMax}, botul nu intră niciodată short.`);
      summary.push(
        `Mărimea: ${p.sizing === 'fixed' ? `${fmtNum(p.amount)} ${cur}${futures ? ` × până la ${input.leverage}×` : ''}` : `riscul de ${fmtNum(p.riskPct)}% din suma maximă (${fmtNum((input.maxAmount * p.riskPct) / 100)} ${cur}) la stop loss`}. ${p.levels === 'slingshot' ? 'SL și TP: ale semnalului Slingshot.' : `SL ${fmtNum(p.slPct)}% și TP ${fmtNum(p.tpPct)}% de la intrare (risc : câștig ${rrText(p.slPct, p.tpPct)}).`}`,
      );
      if (p.ai === 'confirm' && !(await this.d.ai.config(userId)).key) warnings.push(`„AI confirmă” cere o cheie AI (Setări → AI): fără ea, ${p.aiFallback === 'skip' ? 'botul nu intră deloc' : 'intrările merg după reguli'}.`);
      if (minCost !== null && p.sizing === 'fixed' && p.amount * lev < minCost) errors.push(`O tranzacție de ${fmtNum(p.amount * lev)} ${cur} e sub minimul platformei (${fmtNum(minCost)} ${cur}).`);
    }

    // The period.
    const when = (t: number) => new Intl.DateTimeFormat('ro-RO', { timeZone: tz, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(t);
    const start = input.startsAt !== null && input.startsAt > now ? input.startsAt : null;
    if (input.endsAt !== null && input.endsAt <= now) errors.push('Sfârșitul e în trecut.');
    summary.push(`${start !== null ? `Pornește pe ${when(start)}` : 'Pornește acum'}${input.endsAt !== null ? `, până pe ${when(input.endsAt)}; la sfârșit: ${END_ACTION_RO[input.endAction].toLowerCase()}` : ', fără sfârșit'}.`);
    if (input.dailyLoss !== null || input.lossStop !== null)
      summary.push([input.dailyLoss !== null ? `După o pierdere de ${fmtNum(input.dailyLoss)} ${cur} într-o zi, nicio intrare până a doua zi.` : '', input.lossStop !== null ? `La o pierdere de ${fmtNum(input.lossStop)} ${cur}, închide tot și se oprește.` : ''].filter(Boolean).join(' '));
    if (input.exec === 'paper') summary.push(`Simulare: nicio comandă nu pleacă; comision simulat ${fmtNum(input.fee)}% la fiecare execuție.`);
    return { price, capital, errors, warnings, summary, grid, dca };
  }

  async create(userId: number, input: BotInput): Promise<BotDetail> {
    const now = this.now();
    const active = (await this.db.get<{ n: number }>("SELECT count(*) AS n FROM bots WHERE user_id = ? AND status <> N'ended'", [userId]))?.n ?? 0;
    if (active >= MAX_ACTIVE_BOTS) throw new ConflictError(`Cel mult ${MAX_ACTIVE_BOTS} boți activi: oprește sau șterge unul.`);
    if (input.exec === 'real') {
      const same = await this.db.all<{ name: string; config: string }>("SELECT name, config FROM bots WHERE user_id = ? AND execution = N'real' AND account_id = ? AND status <> N'ended'", [userId, input.accountId]);
      for (const b of same) {
        const other = parseInput(b);
        const shared = other && other.market === input.market ? other.symbols.find((s) => input.symbols.includes(s)) : undefined;
        if (shared) throw new ConflictError(`Botul „${b.name}” tranzacționează deja ${shared} pe acest cont: doi boți s-ar încurca pe aceeași poziție.`);
      }
    }
    const check = await this.check(userId, input);
    if (check.errors.length) throw new ValidationError(check.errors.join(' '));
    const startsAt = input.startsAt !== null && input.startsAt > now ? input.startsAt : now;
    const stored: BotInput = { ...input, startsAt };
    const status = startsAt > now ? 'scheduled' : 'running';
    const id = await this.db.tx(async () => {
      const r = await this.db.run(
        `INSERT INTO bots(user_id, name, strategy, execution, account_id, market, area, symbols, tf, config, status, state, starts_at, ends_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, input.name, input.strategy, input.exec, input.accountId, input.market, input.market === 'stock' ? 'stocks' : 'crypto', JSON.stringify(input.symbols), input.tf, JSON.stringify(stored), status, JSON.stringify(newState(check.price)), startsAt, input.endsAt, now, now],
      );
      const botId = r.lastInsertRowid;
      const when = new Intl.DateTimeFormat('ro-RO', { timeZone: (await this.d.settings.forUser(userId)).timezone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(startsAt);
      await this.db.run('INSERT INTO bot_events(bot_id, at, kind, symbol, message, detail) VALUES (?, ?, ?, NULL, ?, NULL)', [
        botId,
        now,
        status === 'running' ? 'start' : 'info',
        status === 'running' ? `Botul ${STRATEGY_RO[input.strategy]} a pornit${input.exec === 'paper' ? ', în simulare' : ''}.` : `Botul e programat să pornească pe ${when}.`,
      ]);
      return botId;
    });
    return this.detail(userId, id);
  }

  async edit(userId: number, id: number, e: BotEdit): Promise<BotDetail> {
    const row = await this.own(userId, id);
    if (row.status === 'ended') throw new ConflictError('Botul s-a încheiat: nu se mai poate edita. „Duplică” face unul nou.');
    const input = parseInput(row);
    if (!input) throw new ConflictError('Setările botului nu se mai pot citi.');
    const now = this.now();
    const next: Record<string, unknown> = { ...input, name: e.name, endsAt: e.endsAt, endAction: e.endAction, dailyLoss: e.dailyLoss, lossStop: e.lossStop, fee: e.fee };
    const st = parseState(row.state);
    if (e.maxAmount !== undefined && e.maxAmount !== input.maxAmount) {
      if (input.strategy === 'grid') throw new ValidationError('Suma unei grile e investită la pornire: nu se mai schimbă. „Duplică” face o grilă nouă.');
      const { committed } = exposure(input, st);
      if (e.maxAmount < committed - 1e-9) throw new ValidationError(`Suma maximă nu poate coborî sub cât e angajat acum (${fmtNum(committed)}).`);
      next.maxAmount = e.maxAmount;
    }
    if (e.leverage !== undefined && e.leverage !== input.leverage) {
      if (input.strategy !== 'premium') throw new ValidationError('Levierul unei grile sau al unui DCA nu se schimbă după pornire.');
      next.leverage = e.leverage;
    }
    if (e.premium !== undefined) {
      if (input.strategy !== 'premium') throw new ValidationError('Doar un bot Slingshot are aceste setări.');
      // FD-BOT §10: shares go short only at eToro.
      if (input.exec === 'real' && input.market === 'stock' && e.premium.direction !== 'long') {
        const caps = (await this.d.trading.caps(userId)).find((a) => a.accountId === input.accountId);
        if (!caps || TRADING[caps.exchange as keyof typeof TRADING]?.etoro !== true) throw new ValidationError(`La ${caps ? (providerById(caps.exchange)?.name ?? caps.exchange) : 'acest broker'}, botul face doar long: short pe acțiuni doar la eToro.`);
      }
      next.premium = e.premium;
    }
    // FD-BOTTF: the engine sees the change at its next look (TD-BOTTF).
    if (e.tf !== undefined && e.tf !== input.tf) {
      if (input.strategy !== 'premium') throw new ValidationError('Timeframe-ul contează doar la un bot Slingshot.');
      if (input.market === 'stock' && this.d.stocks) {
        for (const sym of input.symbols) {
          const allowed = await this.d.stocks.timeframesFor(sym, userId);
          if (!allowed.includes(e.tf)) throw new ValidationError(`${sym} pe ${e.tf} cere cheia ta Twelve Data (Setări → Date acțiuni); fără ea, botul merge pe 1d și 1w.`);
        }
      }
      next.tf = e.tf;
    }
    if (e.endsAt !== null && e.endsAt <= now && e.endsAt !== input.endsAt) throw new ValidationError('Sfârșitul e în trecut.');
    const r = botInputSchema.safeParse(next);
    if (!r.success) throw new ValidationError(`Setări invalide: ${formatIssues(r.error.issues)}`, r.error.issues);
    const changed = await this.db.run("UPDATE bots SET name = ?, config = ?, tf = ?, ends_at = ?, updated_at = ? WHERE id = ? AND user_id = ? AND status <> N'ended'", [r.data.name, JSON.stringify(r.data), r.data.tf, r.data.endsAt, now, id, userId]);
    if (!changed.changes) throw new ConflictError('Botul s-a încheiat între timp.');
    await this.db.run("INSERT INTO bot_events(bot_id, at, kind, symbol, message, detail) VALUES (?, ?, N'info', NULL, N'Setările au fost schimbate.', NULL)", [id, now]);
    return this.detail(userId, id);
  }

  async pause(userId: number, id: number): Promise<BotDetail> {
    await this.own(userId, id);
    const r = await this.db.run("UPDATE bots SET status = N'paused', status_reason = NULL, updated_at = ? WHERE id = ? AND user_id = ? AND status IN (N'running', N'scheduled')", [this.now(), id, userId]);
    if (!r.changes) throw new ConflictError('Botul nu se poate pune pe pauză acum.');
    await this.event(id, 'info', 'Pus pe pauză: nicio intrare nouă; ieșirile continuă.');
    return this.detail(userId, id);
  }

  async resume(userId: number, id: number): Promise<BotDetail> {
    await this.own(userId, id);
    const now = this.now();
    const cmd: BotCommand = { clearPending: true };
    const r = await this.db.run(
      "UPDATE bots SET status = CASE WHEN starts_at > ? THEN N'scheduled' ELSE N'running' END, status_reason = NULL, command = ?, updated_at = ? WHERE id = ? AND user_id = ? AND status IN (N'paused', N'problem')",
      [now, JSON.stringify(cmd), now, id, userId],
    );
    if (!r.changes) throw new ConflictError('Botul nu e pe pauză.');
    await this.event(id, 'info', 'Reluat.');
    return this.detail(userId, id);
  }

  async stop(userId: number, id: number, action: BotEndAction): Promise<BotDetail> {
    const row = await this.own(userId, id);
    if (row.strategy === 'grid' && action === 'finish') throw new ValidationError('O grilă nu are tranzacții de terminat: alege „Închide pozițiile” sau „Lasă pozițiile deschise”.');
    const cmd: BotCommand = { end: action, reason: 'Oprit de utilizator.' };
    const r = await this.db.run("UPDATE bots SET status = N'ending', status_reason = NULL, command = ?, updated_at = ? WHERE id = ? AND user_id = ? AND status <> N'ended'", [JSON.stringify(cmd), this.now(), id, userId]);
    if (!r.changes) throw new ConflictError('Botul s-a încheiat deja.');
    await this.event(id, 'info', `Oprire cerută: ${END_ACTION_RO[action].toLowerCase()}.`);
    return this.detail(userId, id);
  }

  async remove(userId: number, id: number): Promise<void> {
    await this.own(userId, id);
    const r = await this.db.run("DELETE FROM bots WHERE id = ? AND user_id = ? AND status = N'ended'", [id, userId]);
    if (!r.changes) throw new ConflictError('Doar un bot încheiat se poate șterge: oprește-l întâi.');
  }

  private async event(id: number, kind: BotEventRow['kind'], message: string): Promise<void> {
    await this.db.run('INSERT INTO bot_events(bot_id, at, kind, symbol, message, detail) VALUES (?, ?, ?, NULL, ?, NULL)', [id, this.now(), kind, message]);
  }
}
