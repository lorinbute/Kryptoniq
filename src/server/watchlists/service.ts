// FD-WATCHLISTS: each user's named lists of symbols. `watchlist` stays the register of the symbols in any of the lists
// (their pair, aliases, name): what the rest of Sentiq reads (Today, the strip, the scanner, the news, the calendar)
// is the lists together, in their order. Every change is made in one transaction and leaves the register matching.
import type { Db } from '../db/database.ts';
import { BIN } from '../db/schema.ts';
import { ConflictError, NotFoundError } from '../http/errors.ts';
import { defaultStockAliases } from '../market/stocks.ts';
import { ValidationError } from '../settings.ts';
import { indexById, plainSymbol } from '../../shared/indices.ts';
import type { WatchItem } from '../../shared/api-types.ts';

/** Different symbols in all of a user's lists together (FD-WATCHLISTS §6): the scanner's and the feeds' budget. */
export const MAX_WATCHED = 50;
export const MAX_LISTS = 20;
export const LIST_NAME_MAX = 40;
/** The list every user starts with, and the favourites so far became. */
export const FIRST_LIST_NAME = 'Favorite';

/** A symbol to add, as the routes validated it (FD-SENTIQ §4.1, FD-INDICES). */
export type WatchAdd =
  | { kind: 'crypto'; coin: string; quote: string; aliases: string[] }
  | { kind: 'stock'; coin: string; name?: string; exchange?: string; aliases?: string[] }
  | { kind: 'index'; coin: string; aliases?: string[] };

export interface WatchListView {
  id: number;
  name: string;
  /** Its symbols, in its order. */
  coins: string[];
}

export interface WatchView {
  lists: WatchListView[];
  /** The symbols of all the lists, once each, in the common order (what `GET /api/watchlist` gives). */
  items: WatchItem[];
}

/** What changed in the symbols followed (the rest of the app must hear of it). */
export interface UnionChange {
  /** New to the register (a stock needs its feed and its results). */
  added: { coin: string; kind: WatchItem['kind'] }[];
  /** In no list any more: gone from the rest of the app. */
  gone: string[];
}

export interface BulkResult {
  done: number;
  /** Already in the target list (copy, move). */
  already: number;
  /** Not in the source list any more (another tab). */
  missing: number;
}

type RegisterRow = { coin: string; quote: string; position: number; aliases: string; kind: string; name: string | null; exchange: string | null; added_at: number };

const kindOf = (kind: string): WatchItem['kind'] => (kind === 'stock' || kind === 'index' ? kind : 'crypto');
const kindLabel = (kind: string) => (kind === 'stock' ? 'acțiune' : kind === 'index' ? 'indice' : 'monedă');
const fold = (s: string) => s.trim().toLocaleLowerCase('ro');

export function toWatchItem(w: RegisterRow): WatchItem {
  let aliases: string[] = [];
  try {
    const v = JSON.parse(w.aliases) as unknown;
    if (Array.isArray(v)) aliases = v.filter((a): a is string => typeof a === 'string');
  } catch {
    // unreadable: none
  }
  return { coin: w.coin, quote: w.quote, position: w.position, aliases, kind: kindOf(w.kind), name: w.name, exchange: w.exchange };
}

/** A list name as stored: trimmed, 1–40 characters (FD-WATCHLISTS §6). */
export function listName(raw: string): string {
  const name = raw.replace(/\s+/g, ' ').trim();
  if (!name) throw new ValidationError('Lista are nevoie de un nume');
  if (name.length > LIST_NAME_MAX) throw new ValidationError(`Numele listei are cel mult ${LIST_NAME_MAX} de caractere`);
  return name;
}

export class WatchlistService {
  private readonly db: Db;
  private readonly now: () => number;

  constructor(db: Db, now: () => number = Date.now) {
    this.db = db;
    this.now = now;
  }

  private lists(userId: number) {
    return this.db.all<{ id: number; name: string; position: number }>('SELECT id, name, position FROM watch_lists WHERE user_id = ? ORDER BY position, id', [userId]);
  }

  private items(userId: number) {
    return this.db.all<{ list_id: number; coin: string; position: number }>(
      'SELECT i.list_id, i.coin, i.position FROM watch_list_items i JOIN watch_lists l ON l.id = i.list_id WHERE l.user_id = ? ORDER BY l.position, l.id, i.position, i.coin',
      [userId],
    );
  }

  private register(userId: number) {
    return this.db.all<RegisterRow>('SELECT coin, quote, position, aliases, kind, name, exchange, added_at FROM watchlist WHERE user_id = ? ORDER BY position, coin', [userId]);
  }

  /** The user's list, or "Lista nu mai există" (another tab deleted it, or it is somebody else's). */
  private async ownList(userId: number, listId: number): Promise<{ id: number; name: string }> {
    const l = await this.db.get<{ id: number; name: string }>('SELECT id, name FROM watch_lists WHERE id = ? AND user_id = ?', [listId, userId]);
    if (!l) throw new NotFoundError('Lista nu mai există');
    return l;
  }

  private async nextItemPosition(listId: number): Promise<number> {
    return ((await this.db.get<{ p: number | null }>('SELECT max(position) AS p FROM watch_list_items WHERE list_id = ?', [listId]))?.p ?? -1) + 1;
  }

  /**
   * The lists and the register agree (FD-WATCHLISTS §7): a user without lists gets "Favorite" with what they follow;
   * a symbol an older Sentiq added goes at the end of the first list; one it removed leaves the lists. Writes only when
   * something is off.
   */
  private async reconcile(userId: number): Promise<void> {
    let lists = await this.lists(userId);
    if (lists.length > 0 && !(await this.offBalance(userId))) return;
    const register = await this.register(userId);
    if (lists.length === 0) {
      await this.db.run('INSERT INTO watch_lists(user_id, name, position, created_at) VALUES (?, ?, 0, ?)', [userId, FIRST_LIST_NAME, this.now()]);
      lists = await this.lists(userId);
    }
    const first = lists[0];
    if (!first) return;
    const items = await this.items(userId);
    const listed = new Set(items.map((i) => i.coin));
    const known = new Set(register.map((r) => r.coin));
    const orphans = register.filter((r) => !listed.has(r.coin));
    if (orphans.length > 0) {
      let pos = await this.nextItemPosition(first.id);
      for (const o of orphans) await this.db.run('INSERT INTO watch_list_items(list_id, coin, position, added_at) VALUES (?, ?, ?, ?)', [first.id, o.coin, pos++, o.added_at]);
    }
    const stray = [...new Set(items.filter((i) => !known.has(i.coin)).map((i) => i.coin))];
    if (stray.length > 0) {
      await this.db.run(
        `DELETE i FROM watch_list_items i JOIN watch_lists l ON l.id = i.list_id WHERE l.user_id = ? AND i.coin IN (SELECT value COLLATE ${BIN} FROM OPENJSON(?))`,
        [userId, JSON.stringify(stray)],
      );
    }
    if (orphans.length > 0 || stray.length > 0) await this.syncUnion(userId);
  }

  /** Is there a symbol in the register but in no list, or in a list but not in the register? (One read, no lock.) */
  private async offBalance(userId: number): Promise<boolean> {
    const r = await this.db.get<{ n: number }>(
      `SELECT
         (SELECT count(*) FROM watchlist w WHERE w.user_id = @u
            AND NOT EXISTS (SELECT 1 FROM watch_list_items i JOIN watch_lists l ON l.id = i.list_id WHERE l.user_id = @u AND i.coin = w.coin))
       + (SELECT count(*) FROM watch_list_items i JOIN watch_lists l ON l.id = i.list_id WHERE l.user_id = @u
            AND NOT EXISTS (SELECT 1 FROM watchlist w WHERE w.user_id = @u AND w.coin = i.coin)) AS n`,
      { u: userId },
    );
    return (r?.n ?? 0) > 0;
  }

  /**
   * The register follows the lists: its order is the first place of each symbol (lists in their order, then the
   * items); a symbol in no list leaves it. Returns the symbols that left.
   */
  private async syncUnion(userId: number): Promise<string[]> {
    const items = await this.items(userId);
    const order: string[] = [];
    const seen = new Set<string>();
    for (const i of items) {
      if (seen.has(i.coin)) continue;
      seen.add(i.coin);
      order.push(i.coin);
    }
    const register = await this.register(userId);
    const gone = register.filter((r) => !seen.has(r.coin)).map((r) => r.coin);
    if (gone.length > 0) {
      await this.db.run(`DELETE FROM watchlist WHERE user_id = ? AND coin IN (SELECT value COLLATE ${BIN} FROM OPENJSON(?))`, [userId, JSON.stringify(gone)]);
    }
    // One statement: each symbol gets its index (OPENJSON's [key]) as position.
    await this.db.run(`UPDATE w SET position = CAST(j.[key] AS int) FROM watchlist w JOIN OPENJSON(?) j ON w.coin = j.value COLLATE ${BIN} WHERE w.user_id = ?`, [
      JSON.stringify(order),
      userId,
    ]);
    return gone;
  }

  private async read(userId: number): Promise<WatchView> {
    const lists = await this.lists(userId);
    const items = await this.items(userId);
    const register = await this.register(userId);
    return {
      lists: lists.map((l) => ({ id: l.id, name: l.name, coins: items.filter((i) => i.list_id === l.id).map((i) => i.coin) })),
      items: register.map(toWatchItem),
    };
  }

  private tx<T>(userId: number, fn: () => Promise<T>): Promise<T> {
    return this.db.tx(async () => {
      await this.reconcile(userId);
      return fn();
    });
  }

  /** The lists; the write lock only when they must first be put right (a new user, an older Sentiq's change). */
  async view(userId: number): Promise<WatchView> {
    const lists = await this.lists(userId);
    if (lists.length === 0 || (await this.offBalance(userId))) return this.tx(userId, () => this.read(userId));
    return this.read(userId);
  }

  /** The id of the user's first list (the older routes add to it). */
  async firstListId(userId: number): Promise<number> {
    return this.tx(userId, async () => (await this.lists(userId))[0]?.id ?? 0);
  }

  private async checkName(userId: number, name: string, except?: number): Promise<void> {
    const clash = (await this.lists(userId)).find((l) => l.id !== except && fold(l.name) === fold(name));
    if (clash) throw new ConflictError(`Ai deja o listă „${clash.name}”`);
  }

  async create(userId: number, rawName: string): Promise<WatchView & { id: number }> {
    const name = listName(rawName);
    return this.tx(userId, async () => {
      const lists = await this.lists(userId);
      if (lists.length >= MAX_LISTS) throw new ValidationError(`Poți avea cel mult ${MAX_LISTS} de liste`);
      await this.checkName(userId, name);
      const pos = (lists.at(-1)?.position ?? -1) + 1;
      const { lastInsertRowid: id } = await this.db.run('INSERT INTO watch_lists(user_id, name, position, created_at) VALUES (?, ?, ?, ?)', [userId, name, pos, this.now()]);
      return { ...(await this.read(userId)), id };
    });
  }

  async rename(userId: number, listId: number, rawName: string): Promise<WatchView> {
    const name = listName(rawName);
    return this.tx(userId, async () => {
      await this.ownList(userId, listId);
      await this.checkName(userId, name, listId);
      await this.db.run('UPDATE watch_lists SET name = ? WHERE id = ? AND user_id = ?', [name, listId, userId]);
      return this.read(userId);
    });
  }

  /** Deletes a list (never the last one); its symbols in no other list stop being followed. */
  async remove(userId: number, listId: number): Promise<WatchView & UnionChange> {
    return this.tx(userId, async () => {
      await this.ownList(userId, listId);
      if ((await this.lists(userId)).length <= 1) throw new ValidationError('Păstrează cel puțin o listă; o poți goli');
      await this.db.run('DELETE FROM watch_lists WHERE id = ? AND user_id = ?', [listId, userId]);
      const gone = await this.syncUnion(userId);
      return { ...(await this.read(userId)), added: [], gone };
    });
  }

  async orderLists(userId: number, ids: number[]): Promise<WatchView> {
    return this.tx(userId, async () => {
      await this.db.run('UPDATE l SET position = CAST(j.[key] AS int) FROM watch_lists l JOIN OPENJSON(?) j ON l.id = CAST(j.value AS int) WHERE l.user_id = ?', [JSON.stringify(ids), userId]);
      await this.syncUnion(userId);
      return this.read(userId);
    });
  }

  /**
   * Adds a symbol to a list. One the user does not follow yet joins the register (within the limit); one followed
   * already joins the list as it is (its pair stays: the same in every list), with a `note` when another was asked.
   */
  async add(userId: number, listId: number, w: WatchAdd): Promise<WatchView & UnionChange & { note: string | null }> {
    return this.tx(userId, async () => {
      const list = await this.ownList(userId, listId);
      const shown = plainSymbol(w.coin);
      if (await this.db.get('SELECT 1 AS x FROM watch_list_items WHERE list_id = ? AND coin = ?', [listId, w.coin])) {
        throw new ConflictError(`${shown} e deja în ${list.name}`);
      }
      const existing = await this.db.get<{ kind: string; quote: string }>('SELECT kind, quote FROM watchlist WHERE user_id = ? AND coin = ?', [userId, w.coin]);
      let note: string | null = null;
      const added: UnionChange['added'] = [];
      if (existing) {
        if (kindOf(existing.kind) !== w.kind) throw new ConflictError(`${shown} e deja urmărit ca ${kindLabel(existing.kind)}`);
        if (w.kind === 'crypto' && existing.quote !== w.quote) note = `${shown} e deja urmărit ca ${shown}/${existing.quote}; perechea e aceeași în toate listele.`;
      } else {
        const n = (await this.db.get<{ n: number }>('SELECT count(*) AS n FROM watchlist WHERE user_id = ?', [userId]))?.n ?? 0;
        if (n >= MAX_WATCHED) throw new ValidationError(`Listele au împreună cel mult ${MAX_WATCHED} de simboluri diferite`);
        const now = this.now();
        if (w.kind === 'crypto') {
          await this.db.run("INSERT INTO watchlist(user_id, coin, quote, position, aliases, added_at, kind) VALUES (?, ?, ?, ?, ?, ?, N'crypto')", [userId, w.coin, w.quote, n, JSON.stringify(w.aliases), now]);
        } else if (w.kind === 'index') {
          const info = indexById(w.coin);
          await this.db.run("INSERT INTO watchlist(user_id, coin, quote, position, aliases, added_at, kind, name, exchange) VALUES (?, ?, N'USD', ?, ?, ?, N'index', ?, NULL)", [
            userId,
            w.coin,
            n,
            JSON.stringify(w.aliases ?? info?.aliases ?? []),
            now,
            info?.name ?? null,
          ]);
        } else {
          const name = w.name || null;
          await this.db.run("INSERT INTO watchlist(user_id, coin, quote, position, aliases, added_at, kind, name, exchange) VALUES (?, ?, N'USD', ?, ?, ?, N'stock', ?, ?)", [
            userId,
            w.coin,
            n,
            JSON.stringify(w.aliases ?? defaultStockAliases(name)),
            now,
            name,
            w.exchange || null,
          ]);
        }
        added.push({ coin: w.coin, kind: w.kind });
      }
      await this.db.run('INSERT INTO watch_list_items(list_id, coin, position, added_at) VALUES (?, ?, ?, ?)', [listId, w.coin, await this.nextItemPosition(listId), this.now()]);
      await this.syncUnion(userId);
      return { ...(await this.read(userId)), added, gone: [], note };
    });
  }

  async orderItems(userId: number, listId: number, coins: string[]): Promise<WatchView> {
    return this.tx(userId, async () => {
      await this.ownList(userId, listId);
      await this.db.run(`UPDATE i SET position = CAST(j.[key] AS int) FROM watch_list_items i JOIN OPENJSON(?) j ON i.coin = j.value COLLATE ${BIN} WHERE i.list_id = ?`, [
        JSON.stringify(coins),
        listId,
      ]);
      await this.syncUnion(userId);
      return this.read(userId);
    });
  }

  /** The symbols of `coins` still in the list, in the list's order. */
  private async present(listId: number, coins: string[]): Promise<string[]> {
    const wanted = new Set(coins);
    return (await this.db.all<{ coin: string }>('SELECT coin FROM watch_list_items WHERE list_id = ? ORDER BY position, coin', [listId])).map((r) => r.coin).filter((c) => wanted.has(c));
  }

  private async copyInto(userId: number, from: number, to: number, coins: string[]): Promise<BulkResult & { moved: string[] }> {
    await this.ownList(userId, from);
    await this.ownList(userId, to);
    if (from === to) throw new ValidationError('Alege altă listă');
    const unique = [...new Set(coins)];
    const here = await this.present(from, unique);
    const there = new Set(await this.present(to, here));
    let pos = await this.nextItemPosition(to);
    for (const c of here) {
      if (there.has(c)) continue;
      await this.db.run('INSERT INTO watch_list_items(list_id, coin, position, added_at) VALUES (?, ?, ?, ?)', [to, c, pos++, this.now()]);
    }
    return { done: here.length - there.size, already: there.size, missing: unique.length - here.length, moved: here };
  }

  /** Copies the symbols to another list, at its end, in their order; those already there keep their place. */
  async copy(userId: number, from: number, to: number, coins: string[]): Promise<WatchView & BulkResult> {
    return this.tx(userId, async () => {
      const { moved: _, ...r } = await this.copyInto(userId, from, to, coins);
      await this.syncUnion(userId);
      return { ...(await this.read(userId)), ...r };
    });
  }

  /** As `copy`, then out of the source list (also those the target had already). */
  async move(userId: number, from: number, to: number, coins: string[]): Promise<WatchView & BulkResult> {
    return this.tx(userId, async () => {
      const { moved, ...r } = await this.copyInto(userId, from, to, coins);
      if (moved.length > 0) {
        await this.db.run(`DELETE FROM watch_list_items WHERE list_id = ? AND coin IN (SELECT value COLLATE ${BIN} FROM OPENJSON(?))`, [from, JSON.stringify(moved)]);
      }
      await this.syncUnion(userId);
      return { ...(await this.read(userId)), ...r, done: moved.length };
    });
  }

  /** Out of the list; those in no other list stop being followed (`gone`). */
  async removeItems(userId: number, listId: number, coins: string[]): Promise<WatchView & UnionChange & { done: number; missing: number }> {
    return this.tx(userId, async () => {
      await this.ownList(userId, listId);
      const unique = [...new Set(coins)];
      const here = await this.present(listId, unique);
      if (here.length > 0) {
        await this.db.run(`DELETE FROM watch_list_items WHERE list_id = ? AND coin IN (SELECT value COLLATE ${BIN} FROM OPENJSON(?))`, [listId, JSON.stringify(here)]);
      }
      const gone = await this.syncUnion(userId);
      return { ...(await this.read(userId)), added: [], gone, done: here.length, missing: unique.length - here.length };
    });
  }

  /** The older route's delete (a tab from before FD-WATCHLISTS): out of every list. */
  async removeEverywhere(userId: number, coin: string): Promise<WatchView & UnionChange & { done: number }> {
    return this.tx(userId, async () => {
      const r = await this.db.run('DELETE i FROM watch_list_items i JOIN watch_lists l ON l.id = i.list_id WHERE l.user_id = ? AND i.coin = ?', [userId, coin]);
      const gone = await this.syncUnion(userId);
      return { ...(await this.read(userId)), added: [], gone, done: r.changes };
    });
  }
}
