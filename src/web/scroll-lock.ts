// While a side panel, a dialog or the chart's full screen is open, the page behind it does not scroll (FD-SCROLLLOCK):
// one lock for all of them, counted, so two open at once never unlock each other.
import { useEffect } from 'react';

let count = 0;
let saved: { overflow: string; paddingRight: string } | null = null;

/** Locks the page's scrolling; the function returned releases this lock (once). */
export function lockScroll(): () => void {
  const html = document.documentElement;
  if (count++ === 0) {
    // The scrollbar's width: its place stays taken, so the page does not move sideways when it goes.
    const gap = window.innerWidth - html.clientWidth;
    saved = { overflow: html.style.overflow, paddingRight: html.style.paddingRight };
    html.style.overflow = 'hidden';
    if (gap > 0) html.style.paddingRight = `${gap}px`;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--count > 0 || !saved) return;
    html.style.overflow = saved.overflow;
    html.style.paddingRight = saved.paddingRight;
    saved = null;
  };
}

/** Locks the page while `active` and the component is on screen. */
export function useScrollLock(active = true): void {
  useEffect(() => (active ? lockScroll() : undefined), [active]);
}
