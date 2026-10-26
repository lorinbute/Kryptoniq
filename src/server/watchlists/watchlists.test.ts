// FD-WATCHLISTS: the lists and the register of the symbols followed, on the test schema.
import { describe, expect, it } from 'vitest';
import { testDb } from '../test/db.ts';
import { FIRST_LIST_NAME, listName, WatchlistService } from './service.ts';

async function setup() {
  const db = await testDb();
  await db.run("INSERT INTO users(email, name, role, created_at) VALUES (N'ana@example.com', N'Ana', N'user', 1)");
  // As a new user starts (FD-USERS): three coins in the register, no list yet.
  await db.run(
    "INSERT INTO watchlist(user_id, coin, quote, position, aliases, added_at, kind) VALUES (2, N'BTC', N'USDT', 0, N'[]', 1, N'crypto'), (2, N'ETH', N'USDT', 1, N'[]', 1, N'crypto'), (2, N'SOL', N'USDT', 2, N'[]', 1, N'crypto')",
  );
  return { db, w: new WatchlistService(db, () => 1_000) };
}

describe('the watch lists (FD-WATCHLISTS)', () => {
  it('a user without lists gets "Favorite" with what they follow, at the first read', async () => {
    const { db, w } = await setup();
    expect(await db.get<{ n: number }>('SELECT count(*) AS n FROM watch_lists WHERE user_id = 2')).toEqual({ n: 0 });
    const v = await w.view(2);
    expect(v.lists).toEqual([{ id: expect.any(Number), name: FIRST_LIST_NAME, coins: ['BTC', 'ETH', 'SOL'] }]);
    expect(v.items.map((i) => i.coin)).toEqual(['BTC', 'ETH', 'SOL']);
    // A second read changes nothing.
    expect((await w.view(2)).lists).toEqual(v.lists);
  });

  it("one user's lists are not another's", async () => {
    const { w } = await setup();
    const ana = (await w.view(2)).lists[0]?.id as number;
    await expect(w.add(1, ana, { kind: 'crypto', coin: 'DOGE', quote: 'USDT', aliases: [] })).rejects.toThrow('Lista nu mai există');
    await expect(w.rename(1, ana, 'Mea')).rejects.toThrow('Lista nu mai există');
    await expect(w.removeItems(1, ana, ['BTC'])).rejects.toThrow('Lista nu mai există');
    // The order of somebody else's list ids moves nothing.
    await w.view(1);
    await w.orderLists(1, [ana]);
    expect((await w.view(2)).lists.map((l) => l.id)).toEqual([ana]);
  });

  it('a move takes the symbols out of the source, also those the target had; copy keeps the target’s order', async () => {
    const { w } = await setup();
    const fav = (await w.view(2)).lists[0]?.id as number;
    const b = (await w.create(2, 'B')).id;
    await w.copy(2, fav, b, ['SOL']);
    const r = await w.move(2, fav, b, ['ETH', 'SOL']);
    expect(r).toMatchObject({ done: 2, already: 1, missing: 0 });
    expect(r.lists.map((l) => l.coins)).toEqual([['BTC'], ['SOL', 'ETH']]);
    // Nothing left the symbols followed.
    expect(r.items.map((i) => i.coin)).toEqual(['BTC', 'SOL', 'ETH']);
    // The older delete: out of every list, and no longer followed.
    const gone = await w.removeEverywhere(2, 'SOL');
    expect(gone).toMatchObject({ done: 1, gone: ['SOL'] });
    expect(gone.lists.map((l) => l.coins)).toEqual([['BTC'], ['ETH']]);
  });

  it('list names: spaces folded and trimmed, 1–40 characters', () => {
    expect(listName('  Tech   AI ')).toBe('Tech AI');
    expect(() => listName('   ')).toThrow('Lista are nevoie de un nume');
    expect(() => listName('x'.repeat(41))).toThrow('Numele listei are cel mult 40 de caractere');
    expect(listName('x'.repeat(40))).toHaveLength(40);
  });
});
