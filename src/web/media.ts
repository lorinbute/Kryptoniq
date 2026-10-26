// A CSS media query as React state (FD-WATCHDRAWER): the chart page lays its symbol list out differently on a phone.
import { useEffect, useState } from 'react';

/** Whether the query matches now; false where there is no `matchMedia` (tests, a server). */
export function mediaMatches(query: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false;
}

/** The query's match, kept up to date (a rotated phone, a resized window). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => mediaMatches(query));
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [query]);
  return matches;
}
