// A page that cannot load its code after an update (FD-STALE): "Importing a module script failed." (Safari), "Failed
// to fetch dynamically imported module" (Chrome), "error loading dynamically imported module" (Firefox). The page
// reloads once, onto the new version, after the server answers; never in a loop.

/** At most one automatic reload in this long: a second failure is a real problem and is shown. */
export const RELOAD_GAP_MS = 30_000;
/** Waiting for the server (a restart): every 2 s, for a minute at most. */
export const PING_EVERY_MS = 2_000;
export const PING_TRIES = 30;
const LAST_RELOAD_KEY = 'sentiq:stale-reload';

/** A failed load of a code file, as each browser words it. */
export function isImportFailure(message: string): boolean {
  return /importing a module script failed|failed to fetch dynamically imported module|error loading dynamically imported module/i.test(message);
}

export interface StaleDeps {
  now: () => number;
  /** The last automatic reload (sessionStorage), or null. */
  lastReload: () => number | null;
  setLastReload: (at: number) => void;
  /** Does the server answer? */
  ping: () => Promise<boolean>;
  sleep: (ms: number) => Promise<void>;
  reload: () => void;
}

export type StaleOutcome = 'reloaded' | 'too-soon' | 'server-down' | 'busy';

/** The recovery: one at a time; reloads once the server answers, unless it already did so just now. */
export function makeRecovery(deps: StaleDeps): () => Promise<StaleOutcome> {
  let running = false;
  return async () => {
    if (running) return 'busy';
    const last = deps.lastReload();
    if (last !== null && deps.now() - last < RELOAD_GAP_MS) return 'too-soon';
    running = true;
    try {
      for (let i = 0; i < PING_TRIES; i++) {
        if (await deps.ping()) {
          deps.setLastReload(deps.now());
          deps.reload();
          return 'reloaded';
        }
        await deps.sleep(PING_EVERY_MS);
      }
      return 'server-down';
    } finally {
      running = false;
    }
  };
}

interface SessionLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Where the moment of the last automatic reload is kept across the reload: sessionStorage, or, where the browser
 * refuses it (private modes), the tab's `window.name`, which also survives a reload. Without either, a lasting
 * failure could reload forever.
 */
export function reloadMarker(session: () => SessionLike, win: { name: string }): { get: () => number | null; set: (at: number) => void } {
  const prefix = `${LAST_RELOAD_KEY}=`;
  const parse = (v: string | null | undefined) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  return {
    get: () => {
      let stored: number | null = null;
      try {
        stored = parse(session().getItem(LAST_RELOAD_KEY));
      } catch {
        // refused: the tab's name below
      }
      return stored ?? (win.name.startsWith(prefix) ? parse(win.name.slice(prefix.length)) : null);
    },
    set: (at) => {
      try {
        session().setItem(LAST_RELOAD_KEY, String(at));
        return;
      } catch {
        // refused: keep it in the tab's name (only when the page does not use it for anything else)
      }
      if (!win.name || win.name.startsWith(prefix)) win.name = `${prefix}${at}`;
    },
  };
}

/** Wires the recovery to the browser (main.tsx). */
export function installStaleRecovery(): void {
  const marker = reloadMarker(() => window.sessionStorage, window);
  const recover = makeRecovery({
    now: () => Date.now(),
    lastReload: marker.get,
    setLastReload: marker.set,
    ping: async () => {
      try {
        return (await fetch('/api/ping', { cache: 'no-store' })).ok;
      } catch {
        return false;
      }
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    reload: () => window.location.reload(),
  });
  // Vite raises this for every failed import(), React.lazy included; the error still reaches the page's boundary.
  window.addEventListener('vite:preloadError', () => void recover());
  // A safety net for an import outside Vite's helper.
  window.addEventListener('unhandledrejection', (e) => {
    const msg = e.reason instanceof Error ? e.reason.message : String(e.reason ?? '');
    if (isImportFailure(msg)) void recover();
  });
}
