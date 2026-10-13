import { describe, expect, it } from 'vitest';
import { isImportFailure, makeRecovery, PING_TRIES, RELOAD_GAP_MS, reloadMarker, type StaleDeps } from './stale.ts';

function fake(opts: { pingOkAfter?: number; last?: number | null } = {}) {
  let now = 1_000_000;
  let last = opts.last ?? null;
  let pings = 0;
  const log = { reloads: 0, slept: 0 };
  const deps: StaleDeps = {
    now: () => now,
    lastReload: () => last,
    setLastReload: (at) => (last = at),
    ping: async () => ++pings > (opts.pingOkAfter ?? 0),
    sleep: async (ms) => {
      log.slept += ms;
      now += ms;
    },
    reload: () => log.reloads++,
  };
  return { deps, log, advance: (ms: number) => (now += ms), pings: () => pings };
}

describe('recovering from a build that is gone (FD-STALE §2)', () => {
  it('knows each browser’s words for a failed code load', () => {
    expect(isImportFailure('Importing a module script failed.')).toBe(true);
    expect(isImportFailure('Failed to fetch dynamically imported module: http://localhost:4317/assets/News-x.js')).toBe(true);
    expect(isImportFailure('error loading dynamically imported module: http://localhost:4317/assets/News-x.js')).toBe(true);
    expect(isImportFailure('NetworkError when attempting to fetch resource.')).toBe(false);
  });

  it('reloads once the server answers, and not again within 30 seconds', async () => {
    const f = fake();
    const recover = makeRecovery(f.deps);
    expect(await recover()).toBe('reloaded');
    expect(f.log.reloads).toBe(1);
    // The reload did not help (a real problem): no loop.
    expect(await recover()).toBe('too-soon');
    f.advance(RELOAD_GAP_MS);
    expect(await recover()).toBe('reloaded');
    expect(f.log.reloads).toBe(2);
  });

  it('waits for a restarting server, and gives up after a minute', async () => {
    const restarting = fake({ pingOkAfter: 3 });
    expect(await makeRecovery(restarting.deps)()).toBe('reloaded');
    expect(restarting.log.slept).toBe(3 * 2_000);
    const down = fake({ pingOkAfter: 1_000 });
    expect(await makeRecovery(down.deps)()).toBe('server-down');
    expect(down.log.reloads).toBe(0);
    expect(down.pings()).toBe(PING_TRIES);
  });

  it('runs one recovery at a time (several pages failing together)', async () => {
    const f = fake({ pingOkAfter: 2 });
    const recover = makeRecovery(f.deps);
    const [a, b] = await Promise.all([recover(), recover()]);
    expect([a, b].sort()).toEqual(['busy', 'reloaded']);
    expect(f.log.reloads).toBe(1);
  });

  it('keeps the moment of the last reload across the reload, in sessionStorage or else in the tab’s name', () => {
    const store = new Map<string, string>();
    const win = { name: '' };
    const ok = reloadMarker(() => ({ getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) }), win);
    expect(ok.get()).toBeNull();
    ok.set(123);
    expect(ok.get()).toBe(123);
    expect(win.name).toBe('');
    // A private mode that refuses sessionStorage: the tab's name carries it, and is read back after the reload.
    const refused = () => ({
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    });
    const priv = reloadMarker(refused, win);
    priv.set(456);
    expect(win.name).toBe('sentiq:stale-reload=456');
    expect(reloadMarker(refused, win).get()).toBe(456);
    // A tab name the page did not set is left alone.
    const named = { name: 'something-else' };
    reloadMarker(refused, named).set(789);
    expect(named.name).toBe('something-else');
  });
});
