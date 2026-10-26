// FD-ORDEREDIT: the chart's trade lines that can be dragged, the drafts (lines dragged, not yet sent) and the changes
// they make: a position's stop losses / take profits, or one order's price, trigger and attached TP / SL.
import type { AccountView, OrderRow, Portfolio } from '../../shared/api-types.ts';
import { orderEditMode, type ModifyChange, type ModifyResult, type ModifyTicket, type TradeMarket } from '../../shared/trading.ts';
import type { LineAction } from '../components/LineActionDialog.tsx';
import { stepImpact } from '../components/modify-seeds.ts';
import type { TicketSeed } from '../components/OrderTicket.tsx';
import { closeSeed, sellSeed } from '../components/trade-seeds.ts';
import { pnlAtLevel, type TradeLine } from './pnl.ts';

/** A trade line and the account it is on. */
export interface AccountLine extends TradeLine {
  account: AccountView;
}

/** Lines dragged and not yet sent: the new price, by line id. */
export type Drafts = Readonly<Record<string, number>>;

/** The market an order is on, as the server reads it: a perpetual's order is futures wherever it is listed. */
export const orderMarket = (account: AccountView, o: Pick<OrderRow, 'symbol' | 'market'>): TradeMarket => (account.kind === 'stocks' ? 'stock' : o.symbol.includes(':') ? 'futures' : o.market);

const DRAGGABLE_ROLES = new Set<TradeLine['role']>(['sl', 'tp', 'order', 'order-sl', 'order-tp']);

/**
 * Whether a line can be dragged: an order's level (a position's SL / TP, an order's price or trigger, its attached TP /
 * SL), on an account trading that market, where the platform changes (or replaces) the order.
 */
export function isDraggable(l: TradeLine, account: AccountView): boolean {
  if (!account.trading.enabled || !l.order || !DRAGGABLE_ROLES.has(l.role)) return false;
  if ((l.role === 'sl' || l.role === 'tp') && !l.position) return false;
  if (!account.trading.markets.includes(orderMarket(account, l.order))) return false;
  return orderEditMode(account.exchange, l.order) !== null;
}

/** The line Confirm / Discard sit on: the position's entry, or the order's own line. */
export const anchorOf = <L extends TradeLine>(group: string, lines: readonly L[]): L | undefined => lines.find((l) => l.group === group && (l.role === 'entry' || l.role === 'order'));

/** A line's title at another level: its label and the PnL there (an order's TP / SL: from the order's new price). */
export function titleAt(l: TradeLine, price: number, entry?: number): string {
  const label = l.name ?? l.title;
  if (!l.basis) return label;
  const basis = entry !== undefined && (l.role === 'order-sl' || l.role === 'order-tp') ? { ...l.basis, entry } : l.basis;
  return `${label} ${pnlAtLevel(basis, price).text}`;
}

/** The lines as shown: a dragged one at its new price (dotted), with the PnL there. */
export function withDrafts<L extends TradeLine>(lines: readonly L[], drafts: Drafts): L[] {
  return lines.map((l) => {
    const d = drafts[l.id];
    // An order's TP / SL count from the order's price: dragged, theirs follow.
    const entry = l.role === 'order-sl' || l.role === 'order-tp' ? drafts[`${l.group}|line`] : undefined;
    if (d === undefined && entry === undefined) return l;
    const price = d ?? l.price;
    return { ...l, price, title: titleAt(l, price, entry), ...(d !== undefined ? { style: 'dotted' as const } : {}) };
  });
}

/** The drafts still standing: a line gone (the order filled or cancelled) or no longer draggable takes its draft along. */
export function liveDrafts(lines: readonly AccountLine[], drafts: Drafts): Drafts {
  const ok = new Set(lines.filter((l) => isDraggable(l, l.account)).map((l) => l.id));
  const out: Record<string, number> = {};
  for (const [id, v] of Object.entries(drafts)) if (ok.has(id)) out[id] = v;
  return Object.keys(out).length === Object.keys(drafts).length ? drafts : out;
}

/** The groups (a position, an order) with lines dragged. */
export const draftGroups = (lines: readonly TradeLine[], drafts: Drafts): string[] => [...new Set(lines.filter((l) => drafts[l.id] !== undefined).map((l) => l.group))];

/**
 * What a group's drafts change, as the check / send take it: a position's SL / TP moved (each its order), or one order
 * with its new price, trigger and attached TP / SL. Null when nothing in the group is dragged.
 */
export function draftTicket(lines: readonly AccountLine[], drafts: Drafts, group: string): Omit<ModifyTicket, 'idemKey'> | null {
  const dragged = lines.filter((l) => l.group === group && drafts[l.id] !== undefined && l.order);
  const first = dragged[0];
  if (!first?.order) return null;
  const { account, order: o } = first;
  const market = orderMarket(account, o);
  const symbol = account.kind === 'stocks' ? (o.symbol.split('/')[0] ?? o.symbol) : o.symbol;
  if (first.role === 'sl' || first.role === 'tp') {
    const pos = first.position;
    if (!pos) return null;
    const changes: ModifyChange[] = dragged.flatMap((l) => (l.order && (l.role === 'sl' || l.role === 'tp') ? [{ what: l.role, orderId: l.order.id, level: drafts[l.id] as number }] : []));
    return { accountId: account.id, market, symbol, position: { side: pos.side, ...(pos.ref ? { ref: pos.ref } : {}) }, changes };
  }
  const c: Extract<ModifyChange, { what: 'order' }> = { what: 'order', orderId: o.id, trigger: o.triggerPrice !== null };
  for (const l of dragged) {
    const v = drafts[l.id] as number;
    if (l.leg === 'trigger') c.triggerPrice = v;
    else if (l.leg === 'price') c.price = v;
    else if (l.leg === 'sl') c.stopLoss = v;
    else if (l.leg === 'tp') c.takeProfit = v;
  }
  return { accountId: account.id, market, symbol, changes: [c] };
}

/** FIX-SLTPDUP: a level confirmed and sent, shown until the platform lists it. */
export interface SentLevel {
  /** The line as it was dragged (its account, role, position or order). */
  line: AccountLine;
  price: number;
  until: number;
}

/** How long a sent level is shown while the platform does not list it yet. */
export const SENT_MS = 60_000;

/** The dragged lines a confirmed change moved: all of them when it was done, the ones whose change went through otherwise. */
export function sentLevels(lines: readonly AccountLine[], drafts: Drafts, group: string, ticket: Omit<ModifyTicket, 'idemKey'>, result: ModifyResult, now: number): SentLevel[] {
  const dragged = lines.filter((l) => l.group === group && drafts[l.id] !== undefined && l.order);
  const through = (i: number) => {
    const steps = result.steps.filter((x) => x.change === i);
    return result.status === 'done' || (steps.length > 0 && steps.every((x) => x.ok));
  };
  const out: SentLevel[] = [];
  ticket.changes.forEach((c, i) => {
    if (!through(i) || c.orderId === null) return;
    for (const l of dragged) {
      if (l.order?.id !== c.orderId || (c.what !== 'order' && l.role !== c.what)) continue;
      out.push({ line: l, price: drafts[l.id] as number, until: now + SENT_MS });
    }
  });
  return out;
}

/**
 * FIX-SLTPDUP: the lines the platform lists, with the levels just sent. A level the platform does not list yet stays at
 * its new price (its old line moved there, or drawn alone, without an order: it cannot be dragged meanwhile); once it
 * shows, an old order the platform still lists for a moment is hidden. `waiting`: the levels still to settle.
 */
export function withSent(lines: readonly AccountLine[], sent: readonly SentLevel[], now: number): { lines: AccountLine[]; waiting: SentLevel[] } {
  let out = [...lines];
  const waiting: SentLevel[] = [];
  for (const s of sent) {
    if (s.until <= now) continue;
    const near = (p: number) => Math.abs(p - s.price) <= Math.max(Math.abs(s.price) * 1e-4, 1e-12);
    // The same level: a position's SL / TP in its group; an order (replaced under a new id) by its symbol and side.
    const same = (l: AccountLine) =>
      l.account.id === s.line.account.id &&
      l.role === s.line.role &&
      (l.role === 'sl' || l.role === 'tp' ? l.group === s.line.group : l.order?.symbol === s.line.order?.symbol && l.order?.side === s.line.order?.side);
    const landed = out.find((l) => same(l) && near(l.price));
    const old = out.find((l) => l.id === s.line.id);
    if (landed) {
      if (old && old !== landed) {
        out = out.filter((l) => l !== old);
        waiting.push(s);
      }
      continue;
    }
    waiting.push(s);
    const { order: _order, leg: _leg, ...base } = old ?? s.line;
    const shown: AccountLine = { ...base, price: s.price, title: titleAt(s.line, s.price), style: s.line.style };
    out = old ? out.map((l) => (l === old ? shown : l)) : [...out, { ...shown, id: `${s.line.id}|sent` }];
  }
  return { lines: out, waiting };
}

/**
 * FD-TRADEUI: what the × of a line's box does. A position's entry: its order form ("Închide" / "Vinde", with its own
 * confirmation); a stop loss / take profit: removed (checked, then confirmed); an order: cancelled (confirmed); an
 * order's attached TP / SL: taken off it. Null where there is no × (liquidation, trading off for that market, a row the
 * platform cannot change).
 */
export function lineActionOf(l: AccountLine, p: Portfolio | undefined): { kind: 'ticket'; seed: TicketSeed } | { kind: 'dialog'; action: LineAction } | null {
  const a = l.account;
  if (!a.trading.enabled) return null;
  const o = l.order;
  const stocks = a.kind === 'stocks';
  const symbolOf = (x: OrderRow) => (stocks ? (x.symbol.split('/')[0] ?? x.symbol) : x.symbol);
  switch (l.role) {
    case 'entry': {
      const pos = l.position;
      if (!p || !pos) return null;
      if (pos.market === 'futures') {
        const row = p.positions.find((x) => x.symbol === pos.symbol && (x.side === 'short' ? 'short' : 'long') === pos.side && (!pos.ref || x.ref?.positionIds?.includes(pos.ref)));
        const seed = row ? closeSeed(a, row) : null;
        return seed ? { kind: 'ticket', seed } : null;
      }
      // A holding: sold from the trading account (KuCoin's "main" balance first goes there, on KuCoin).
      const base = pos.symbol.split('/')[0] ?? pos.symbol;
      const row = p.balances.find((x) => x.asset === base && x.account !== 'main' && x.free > 0 && (!pos.ref || x.ref?.positionIds?.includes(pos.ref)));
      const seed = row ? sellSeed(a, row) : null;
      return seed ? { kind: 'ticket', seed } : null;
    }
    case 'sl':
    case 'tp': {
      if (!o || !l.position || !isDraggable(l, a)) return null;
      const what = l.role;
      const basis = l.basis ?? null;
      return {
        kind: 'dialog',
        action: {
          kind: 'modify',
          account: a,
          ticket: { accountId: a.id, market: orderMarket(a, o), symbol: symbolOf(o), position: { side: l.position.side, ...(l.position.ref ? { ref: l.position.ref } : {}) }, changes: [{ what, orderId: o.id, level: null }] },
          title: `Șterge ${what === 'sl' ? 'stop loss-ul' : 'take profit-ul'} ${symbolOf(o)}`,
          impact: (s) => stepImpact(s, { kind: 'protection', basisOf: () => basis }),
        },
      };
    }
    case 'order-sl':
    case 'order-tp': {
      if (!o || !isDraggable(l, a)) return null;
      const sl = l.role === 'order-sl';
      return {
        kind: 'dialog',
        action: {
          kind: 'modify',
          account: a,
          ticket: { accountId: a.id, market: orderMarket(a, o), symbol: symbolOf(o), changes: [{ what: 'order', orderId: o.id, trigger: o.triggerPrice !== null, ...(sl ? { stopLoss: null } : { takeProfit: null }) }] },
          title: `Scoate ${sl ? 'stop loss-ul' : 'take profit-ul'} ordinului ${symbolOf(o)}`,
        },
      };
    }
    case 'order': {
      if (!o || o.cancellable === false) return null;
      const market = orderMarket(a, o);
      if (!a.trading.markets.includes(market)) return null;
      return { kind: 'dialog', action: { kind: 'cancel', account: a, order: o, market, title: `Anulează ordinul ${symbolOf(o)}` } };
    }
    default:
      return null;
  }
}

/** Whether a line's box has an × (its action exists). */
export const lineCloses = (l: AccountLine, p: Portfolio | undefined): boolean => lineActionOf(l, p) !== null;
