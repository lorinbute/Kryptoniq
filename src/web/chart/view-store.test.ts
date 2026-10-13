import { describe, expect, it } from 'vitest';
import { loadView, MAX_VIEWS, saveView } from './view-store.ts';

class MemoryStorage {
  data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
}

describe('chart view store', () => {
  it('remembers zoom and position per key and keeps only the most recent 60', () => {
    const st = new MemoryStorage() as unknown as Storage;
    saveView('kucoin|BTC/USDT|1h', { barSpacing: 8.5, scroll: 24 }, st, 1);
    expect(loadView('kucoin|BTC/USDT|1h', st)).toEqual({ barSpacing: 8.5, scroll: 24, at: 1 });
    expect(loadView('kucoin|ETH/USDT|1h', st)).toBeNull();
    for (let i = 0; i < MAX_VIEWS + 5; i++) saveView(`k${i}`, { barSpacing: 6, scroll: -100 }, st, 10 + i);
    const all = JSON.parse(st.getItem('sentiq.chartViews') as string) as Record<string, unknown>;
    expect(Object.keys(all)).toHaveLength(MAX_VIEWS);
    expect(loadView('kucoin|BTC/USDT|1h', st)).toBeNull(); // the oldest went first
    expect(loadView(`k${MAX_VIEWS + 4}`, st)).not.toBeNull();
  });

  it('ignores invalid or corrupt data and works without storage', () => {
    const st = new MemoryStorage() as unknown as Storage;
    saveView('a', { barSpacing: NaN, scroll: 1 }, st);
    expect(loadView('a', st)).toBeNull();
    st.setItem('sentiq.chartViews', '{not json');
    expect(loadView('a', st)).toBeNull();
    st.setItem('sentiq.chartViews', JSON.stringify({ a: { barSpacing: 'x', scroll: 1, at: 1 }, b: { barSpacing: 5, scroll: 2, at: 3 } }));
    expect(loadView('a', st)).toBeNull();
    expect(loadView('b', st)).toEqual({ barSpacing: 5, scroll: 2, at: 3 });
    const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } } as unknown as Storage; // prettier-ignore
    expect(loadView('b', throwing)).toBeNull();
    expect(() => saveView('b', { barSpacing: 5, scroll: 1 }, throwing)).not.toThrow();
    expect(loadView('b', null)).toBeNull();
  });
});
