// FD-CHARTTV §3: the symbol list's width and visibility, per browser.
import { describe, expect, it } from 'vitest';
import { clampWidth, parsePrefs, WATCHLIST_DEFAULT, WATCHLIST_MAX, WATCHLIST_MIN } from './watchlist-prefs.ts';

describe('the symbol list prefs', () => {
  it('keep the width between 200 px and the smaller of 560 px and half the row', () => {
    expect(clampWidth(100)).toBe(WATCHLIST_MIN);
    expect(clampWidth(900)).toBe(WATCHLIST_MAX);
    expect(clampWidth(420, 700)).toBe(350);
    // A row under 400 px: still at least the minimum.
    expect(clampWidth(300, 300)).toBe(WATCHLIST_MIN);
    expect(clampWidth(Number.NaN)).toBe(WATCHLIST_DEFAULT);
  });

  it('read a stored value, or the default for anything unreadable', () => {
    expect(parsePrefs(JSON.stringify({ width: 340, hidden: true }))).toEqual({ width: 340, hidden: true });
    expect(parsePrefs(JSON.stringify({ width: 5000 }))).toEqual({ width: WATCHLIST_MAX, hidden: false });
    expect(parsePrefs('not json')).toEqual({ width: WATCHLIST_DEFAULT, hidden: false });
    expect(parsePrefs(null)).toEqual({ width: WATCHLIST_DEFAULT, hidden: false });
  });
});
