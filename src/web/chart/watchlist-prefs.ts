// The symbol list's width and whether it is hidden (FD-CHARTTV §3): kept in this browser, as each screen wants its own.

export const WATCHLIST_MIN = 200;
export const WATCHLIST_MAX = 560;
export const WATCHLIST_DEFAULT = 300;
const KEY = 'sentiq:watchlist';

export interface WatchlistPrefs {
  width: number;
  hidden: boolean;
}

/** A width within the limits (and at most half the row, when its width is known). */
export function clampWidth(width: number, rowWidth?: number): number {
  const max = rowWidth && rowWidth > 0 ? Math.min(WATCHLIST_MAX, Math.floor(rowWidth / 2)) : WATCHLIST_MAX;
  const w = Number.isFinite(width) ? Math.round(width) : WATCHLIST_DEFAULT;
  return Math.max(WATCHLIST_MIN, Math.min(Math.max(WATCHLIST_MIN, max), w));
}

/** What a stored value says; anything unreadable is the default (shown, 300 px). */
export function parsePrefs(raw: string | null): WatchlistPrefs {
  try {
    const v = raw ? (JSON.parse(raw) as Partial<WatchlistPrefs>) : {};
    return { width: clampWidth(typeof v.width === 'number' ? v.width : WATCHLIST_DEFAULT), hidden: v.hidden === true };
  } catch {
    return { width: WATCHLIST_DEFAULT, hidden: false };
  }
}

export function readPrefs(): WatchlistPrefs {
  try {
    return parsePrefs(localStorage.getItem(KEY));
  } catch {
    return parsePrefs(null);
  }
}

export function writePrefs(p: WatchlistPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // A private window: the choice lasts this visit.
  }
}
