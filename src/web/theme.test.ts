// FD-THEME: the theme on <html>, kept in localStorage, followed across tabs. No DOM in these tests: a small fake.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

type Listener = (e: Event) => void;
let store: Map<string, string>;
let storageThrows: boolean;
let listeners: Map<string, Set<Listener>>;
let meta: { content: string };
let root: { dataset: Record<string, string | undefined> };

beforeEach(() => {
  store = new Map();
  storageThrows = false;
  listeners = new Map();
  meta = { content: 'dark' };
  root = { dataset: {} };
  const win = {
    localStorage: {
      getItem: (k: string) => {
        if (storageThrows) throw new Error('SecurityError');
        return store.get(k) ?? null;
      },
      setItem: (k: string, v: string) => {
        if (storageThrows) throw new Error('QuotaExceededError');
        store.set(k, v);
      },
    },
    addEventListener: (t: string, f: Listener) => void (listeners.get(t) ?? listeners.set(t, new Set()).get(t)!).add(f),
    removeEventListener: (t: string, f: Listener) => void listeners.get(t)?.delete(f),
    dispatchEvent: (e: Event) => {
      for (const f of listeners.get(e.type) ?? []) f(e);
      return true;
    },
  };
  Object.assign(globalThis, {
    window: win,
    document: { documentElement: root, querySelector: (s: string) => (s === 'meta[name="color-scheme"]' ? { setAttribute: (_: string, v: string) => (meta.content = v) } : null) },
    getComputedStyle: () => ({ getPropertyValue: (n: string) => ({ '--color-chart': ' #ffffff', '--color-muted': '#475467' })[n] ?? '' }),
  });
});
afterEach(() => {
  for (const k of ['window', 'document', 'getComputedStyle']) delete (globalThis as Record<string, unknown>)[k];
});

describe('the theme (FD-THEME §3)', () => {
  it('is dark unless "light" was chosen; anything else is dark', async () => {
    const { getTheme, parseTheme } = await import('./theme.ts');
    expect(getTheme()).toBe('dark');
    root.dataset.theme = 'light';
    expect(getTheme()).toBe('light');
    for (const v of [null, undefined, '', 'Light', 'blue', 1]) expect(parseTheme(v), String(v)).toBe('dark');
  });

  it('switches the page, the browser’s colour scheme and the stored choice, and tells the page', async () => {
    const { setTheme, THEME_EVENT, THEME_KEY } = await import('./theme.ts');
    let told = 0;
    window.addEventListener(THEME_EVENT, () => told++);
    setTheme('light');
    expect(root.dataset.theme).toBe('light');
    expect(meta.content).toBe('light');
    expect(store.get(THEME_KEY)).toBe('light');
    setTheme('dark');
    expect(root.dataset.theme).toBeUndefined();
    expect(meta.content).toBe('dark');
    expect(store.get(THEME_KEY)).toBe('dark');
    expect(told).toBe(2);
    // Storage refused (strict private mode): the switch still holds for the page.
    storageThrows = true;
    setTheme('light');
    expect(root.dataset.theme).toBe('light');
  });

  it('follows a switch made in another tab', async () => {
    const { subscribeTheme, THEME_EVENT, THEME_KEY } = await import('./theme.ts');
    // useTheme's subscription also listens to other tabs (the storage event).
    let told = 0;
    const unsubscribe = subscribeTheme(() => told++);
    const fire = (newValue: string | null) => window.dispatchEvent(Object.assign(new Event('storage'), { key: THEME_KEY, newValue }));
    fire('light');
    expect(root.dataset.theme).toBe('light');
    fire('dark');
    expect(root.dataset.theme).toBeUndefined();
    // Another key, or the same theme again: nothing happens.
    window.dispatchEvent(Object.assign(new Event('storage'), { key: 'other', newValue: 'light' }));
    expect(root.dataset.theme).toBeUndefined();
    expect(told).toBe(2);
    unsubscribe();
    window.dispatchEvent(new Event(THEME_EVENT));
    expect(told).toBe(2);
  });

  it('gives the canvas the theme’s colours (its own surface, FD-THEME2 §2), with the dark ones as a fallback', async () => {
    const { themeColors } = await import('./theme.ts');
    expect(themeColors()).toEqual({ background: '#ffffff', text: '#475467', line: '#1a202b', lineStrong: '#262d3a' });
  });
});
