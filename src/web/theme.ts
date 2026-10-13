// The light / dark theme (FD-THEME, TD-THEME §3): `data-theme` on <html>, the choice kept in localStorage on this
// browser. public/theme.js applies it before the first paint; this module switches it and lets the page follow.
import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';
export const THEME_KEY = 'sentiq:theme';
/** Raised on window when the theme changes (the chart recolours its canvas). */
export const THEME_EVENT = 'sentiq:theme';

/** A stored value as a theme: anything but "light" is the default, dark. */
export const parseTheme = (v: unknown): Theme => (v === 'light' ? 'light' : 'dark');

export function getTheme(): Theme {
  return parseTheme(document.documentElement.dataset.theme);
}

/** Applies a theme to the page: the attribute, the browser's colour scheme (form controls, scroll bars). */
export function applyTheme(t: Theme): void {
  const root = document.documentElement;
  if (t === 'light') root.dataset.theme = 'light';
  else delete root.dataset.theme;
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', t);
  window.dispatchEvent(new Event(THEME_EVENT));
}

/** Switches the theme and remembers it on this browser (where storage works; otherwise until the next load). */
export function setTheme(t: Theme): void {
  try {
    window.localStorage.setItem(THEME_KEY, t);
  } catch {
    // private mode: the switch still holds for this page
  }
  applyTheme(t);
}

/** Another tab switched: follow it. */
function onStorage(e: StorageEvent): void {
  if (e.key === THEME_KEY && parseTheme(e.newValue) !== getTheme()) applyTheme(parseTheme(e.newValue));
}

/** The window already listening to other tabs (once per window). */
let listeningOn: Window | null = null;

/** Calls `cb` when the theme changes, here or in another tab (useTheme's subscription). */
export function subscribeTheme(cb: () => void): () => void {
  if (listeningOn !== window) {
    window.addEventListener('storage', onStorage);
    listeningOn = window;
  }
  window.addEventListener(THEME_EVENT, cb);
  return () => window.removeEventListener(THEME_EVENT, cb);
}

/** The current theme, re-rendering when it changes (here or in another tab). */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribeTheme, getTheme, () => 'dark');
}

/** The theme's colours for what draws on a canvas (the candle chart), read from the CSS variables. */
export function themeColors(): { background: string; text: string; line: string; lineStrong: string } {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    background: v('--color-chart', '#0d1118'),
    text: v('--color-muted', '#8d96a8'),
    line: v('--color-line', '#1a202b'),
    lineStrong: v('--color-line-strong', '#262d3a'),
  };
}
