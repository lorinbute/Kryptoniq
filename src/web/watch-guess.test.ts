// FD-WATCHLISTS: the lists as a change makes them, shown before the server answers.
import { describe, expect, it } from 'vitest';
import type { WatchItem, WatchView } from '../shared/api-types.ts';
import { guessAdd, guessCopy, guessDropList, guessRemove, guessRename } from './watch-guess.ts';

const item = (coin: string, kind: WatchItem['kind'] = 'crypto'): WatchItem => ({ coin, quote: kind === 'crypto' ? 'USDT' : 'USD', position: 0, aliases: [], kind, name: null, exchange: null });
const view = (): WatchView => ({
  lists: [
    { id: 1, name: 'Favorite', coins: ['BTC', 'ETH', 'TSLA'] },
    { id: 2, name: 'Tech', coins: ['TSLA', 'NVDA'] },
  ],
  items: [item('BTC'), item('ETH'), item('TSLA', 'stock'), item('NVDA', 'stock')].map((w, i) => ({ ...w, position: i })),
});
const coins = (v: WatchView) => v.items.map((w) => `${w.coin}@${w.position}`);

describe('a change shown at once', () => {
  it('an add: at the end of the list; a symbol new to the user gets a provisional row; one there already, nothing', () => {
    const v = guessAdd(view(), 2, { kind: 'index', coin: '^SPX' });
    expect(v.lists[1]?.coins).toEqual(['TSLA', 'NVDA', '^SPX']);
    expect(v.items.at(-1)).toEqual({ coin: '^SPX', quote: 'USD', position: 4, aliases: [], kind: 'index', name: 'S&P 500', exchange: null });
    const btc = guessAdd(view(), 2, { kind: 'crypto', coin: 'BTC', quote: 'USDC' });
    expect(btc.lists[1]?.coins).toEqual(['TSLA', 'NVDA', 'BTC']);
    expect(btc.items.find((w) => w.coin === 'BTC')?.quote).toBe('USDT');
    expect(guessAdd(view(), 1, { kind: 'crypto', coin: 'ETH' })).toEqual(view());
    expect(guessAdd(view(), 9, { kind: 'crypto', coin: 'DOGE' })).toEqual(view());
    // In the first list: before the second list's symbols in the common order.
    const aapl = guessAdd(view(), 1, { kind: 'stock', coin: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' });
    expect(coins(aapl)).toEqual(['BTC@0', 'ETH@1', 'TSLA@2', 'AAPL@3', 'NVDA@4']);
    expect(aapl.items[3]).toMatchObject({ coin: 'AAPL', kind: 'stock', name: 'Apple Inc.', exchange: 'NASDAQ', quote: 'USD' });
  });

  it('a delete: out of the list; what is in no other list leaves the symbols followed, the rest keep the common order', () => {
    const v = guessRemove(view(), 1, ['BTC', 'TSLA']);
    expect(v.lists.map((l) => l.coins)).toEqual([['ETH'], ['TSLA', 'NVDA']]);
    expect(coins(v)).toEqual(['ETH@0', 'TSLA@1', 'NVDA@2']);
  });

  it('a copy keeps those there already in place; a move takes them out of the source; never into the same list', () => {
    const c = guessCopy(view(), 1, 2, ['ETH', 'TSLA', 'DOGE'], false);
    expect(c.lists.map((l) => l.coins)).toEqual([
      ['BTC', 'ETH', 'TSLA'],
      ['TSLA', 'NVDA', 'ETH'],
    ]);
    const m = guessCopy(view(), 1, 2, ['ETH', 'TSLA'], true);
    expect(m.lists.map((l) => l.coins)).toEqual([['BTC'], ['TSLA', 'NVDA', 'ETH']]);
    expect(coins(m)).toEqual(['BTC@0', 'TSLA@1', 'NVDA@2', 'ETH@3']);
    expect(guessCopy(view(), 1, 1, ['ETH'], true)).toEqual(view());
  });

  it('a list renamed or deleted', () => {
    expect(guessRename(view(), 2, 'AI').lists[1]?.name).toBe('AI');
    const d = guessDropList(view(), 2);
    expect(d.lists.map((l) => l.id)).toEqual([1]);
    expect(coins(d)).toEqual(['BTC@0', 'ETH@1', 'TSLA@2']);
  });
});
