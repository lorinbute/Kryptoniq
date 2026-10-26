// FD-WATCHLISTS: a change of the lists shown at once, before the server answers (~1 s from the Mac to Azure); its
// answer then puts the exact state in place. Each function gives the lists as the server will most likely make them.
import type { WatchItem, WatchView } from '../shared/api-types.ts';
import { indexById } from '../shared/indices.ts';

export type AddBody =
  | { kind: 'crypto'; coin: string; quote?: string }
  | { kind: 'stock'; coin: string; name?: string; exchange?: string }
  | { kind: 'index'; coin: string };

/** The symbols of all the lists, once each, in the common order (lists in their order, a symbol at its first place). */
function withUnion(lists: WatchView['lists'], known: ReadonlyMap<string, WatchItem>): WatchView {
  const seen = new Set<string>();
  const items: WatchItem[] = [];
  for (const l of lists) {
    for (const c of l.coins) {
      if (seen.has(c)) continue;
      seen.add(c);
      const w = known.get(c);
      if (w) items.push({ ...w, position: items.length });
    }
  }
  return { lists, items };
}

const byCoin = (v: WatchView) => new Map(v.items.map((w) => [w.coin, w]));

/** A symbol added at the end of a list; one new to the user gets a provisional row (its aliases come with the answer). */
export function guessAdd(v: WatchView, listId: number, body: AddBody): WatchView {
  const list = v.lists.find((l) => l.id === listId);
  if (!list || list.coins.includes(body.coin)) return v;
  const known = byCoin(v);
  if (!known.has(body.coin)) {
    known.set(body.coin, {
      coin: body.coin,
      quote: body.kind === 'crypto' ? (body.quote ?? 'USDT') : 'USD',
      position: 0,
      aliases: [],
      kind: body.kind,
      name: body.kind === 'stock' ? (body.name ?? null) : body.kind === 'index' ? (indexById(body.coin)?.name ?? null) : null,
      exchange: body.kind === 'stock' ? (body.exchange ?? null) : null,
    });
  }
  return withUnion(
    v.lists.map((l) => (l.id === listId ? { ...l, coins: [...l.coins, body.coin] } : l)),
    known,
  );
}

/** Symbols out of a list; those in no other list leave the symbols followed. */
export function guessRemove(v: WatchView, listId: number, coins: readonly string[]): WatchView {
  const out = new Set(coins);
  return withUnion(
    v.lists.map((l) => (l.id === listId ? { ...l, coins: l.coins.filter((c) => !out.has(c)) } : l)),
    byCoin(v),
  );
}

/** Symbols copied at the end of another list (those there already keep their place); `move` takes them out of the first. */
export function guessCopy(v: WatchView, from: number, to: number, coins: readonly string[], move: boolean): WatchView {
  const source = v.lists.find((l) => l.id === from);
  if (!source || from === to || !v.lists.some((l) => l.id === to)) return v;
  const picked = source.coins.filter((c) => coins.includes(c));
  return withUnion(
    v.lists.map((l) => {
      if (l.id === to) return { ...l, coins: [...l.coins, ...picked.filter((c) => !l.coins.includes(c))] };
      if (move && l.id === from) return { ...l, coins: l.coins.filter((c) => !picked.includes(c)) };
      return l;
    }),
    byCoin(v),
  );
}

export function guessRename(v: WatchView, listId: number, name: string): WatchView {
  return { ...v, lists: v.lists.map((l) => (l.id === listId ? { ...l, name } : l)) };
}

/** A list deleted; its symbols in no other list leave the symbols followed. */
export function guessDropList(v: WatchView, listId: number): WatchView {
  return withUnion(
    v.lists.filter((l) => l.id !== listId),
    byCoin(v),
  );
}
