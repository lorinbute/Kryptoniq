import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { mergePatch, saveSettingsPatch } from './prefs.ts';

describe('mergePatch', () => {
  it('merges nested objects, replaces values and arrays, ignores prototype keys', () => {
    const base = { a: { b: 1, c: [1, 2] }, d: 'x' };
    expect(mergePatch(base, { a: { c: [3] } })).toEqual({ a: { b: 1, c: [3] }, d: 'x' });
    expect(mergePatch(base, { d: 'y', e: { f: true } })).toEqual({ a: { b: 1, c: [1, 2] }, d: 'y', e: { f: true } });
    const out = mergePatch(base, JSON.parse('{"__proto__": {"polluted": 1}, "a": {"b": 2}}')) as Record<string, unknown>;
    expect(out).toEqual({ a: { b: 2, c: [1, 2] }, d: 'x' });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    // untouched branches keep their identity (no needless recomputation in the page)
    const next = mergePatch(base, { d: 'z' });
    expect(next.a).toBe(base.a);
  });
});

describe('saveSettingsPatch', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** A fake server: applies each PUT body, answers when `release()` is called. */
  function fakeServer(initial: Record<string, unknown>, fail = false) {
    let state = initial;
    const bodies: unknown[] = [];
    const gates: (() => void)[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as Record<string, unknown>;
      bodies.push(body);
      await new Promise<void>((r) => gates.push(r));
      if (fail) return new Response(JSON.stringify({ error: { code: 'VALIDATION', message: 'no' } }), { status: 400 });
      state = mergePatch(state, body);
      return new Response(JSON.stringify(state), { status: 200 });
    });
    const release = async () => {
      for (let i = 0; i < 20 && gates.length === 0; i++) await new Promise((r) => setTimeout(r, 0));
      gates.shift()?.();
      await new Promise((r) => setTimeout(r, 0));
    };
    return { bodies, release, state: () => state };
  }

  it('applies toggles at once and sends them one request at a time, merging the ones that wait', async () => {
    const qc = new QueryClient();
    const initial = { market: { defaultTf: '1h' }, charts: { showLma: true, symbol: '' } };
    qc.setQueryData(['settings'], initial);
    const srv = fakeServer(initial);
    const p1 = saveSettingsPatch(qc, { market: { defaultTf: '4h' } });
    const p2 = saveSettingsPatch(qc, { market: { defaultTf: '15m' } });
    const p3 = saveSettingsPatch(qc, { charts: { showLma: false } });
    // optimistic: the page sees the last choice immediately
    expect(qc.getQueryData(['settings'])).toEqual({ market: { defaultTf: '15m' }, charts: { showLma: false, symbol: '' } });
    await srv.release();
    await srv.release();
    await Promise.all([p1, p2, p3]);
    // the first went alone, the two that waited went together
    expect(srv.bodies).toEqual([{ market: { defaultTf: '4h' } }, { market: { defaultTf: '15m' }, charts: { showLma: false } }]);
    expect(srv.state()).toEqual({ market: { defaultTf: '15m' }, charts: { showLma: false, symbol: '' } });
    expect(qc.getQueryData(['settings'])).toEqual(srv.state());
  });

  it('keeps form saves separate and does not apply them before the server accepts them', async () => {
    const qc = new QueryClient();
    const initial = { lma: { period: 100 }, charts: { showLma: true } };
    qc.setQueryData(['settings'], initial);
    const srv = fakeServer(initial);
    const form = saveSettingsPatch(qc, { lma: { period: 120 } }, { optimistic: false });
    const toggle = saveSettingsPatch(qc, { charts: { showLma: false } });
    expect((qc.getQueryData(['settings']) as typeof initial).lma.period).toBe(100);
    await srv.release();
    await srv.release();
    await Promise.all([form, toggle]);
    expect(srv.bodies).toEqual([{ lma: { period: 120 } }, { charts: { showLma: false } }]);
    expect(qc.getQueryData(['settings'])).toEqual({ lma: { period: 120 }, charts: { showLma: false } });
  });

  it('re-reads the settings when an optimistic save is refused', async () => {
    const qc = new QueryClient();
    qc.setQueryData(['settings'], { charts: { lmaPane: 0.25 } });
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const srv = fakeServer({ charts: { lmaPane: 0.25 } }, true);
    const refused = expect(saveSettingsPatch(qc, { charts: { lmaPane: 0.3 } })).rejects.toThrow('no');
    await srv.release();
    await refused;
    expect(spy).toHaveBeenCalledWith({ queryKey: ['settings'] });
  });
});
