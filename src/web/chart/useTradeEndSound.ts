// FD-TRADESOUND: while the chart is open and seen, the portfolios are read every 20 s (the server asks the platform no
// more often); a trade that ended between two readings made while watching plays the coin sound, once. What closed
// while the page was hidden (or before the chart opened) stays silent: the first reading after is the start.
// FIX-COINSOUND2: only the trades of the chart on screen (its asset, on the accounts that can hold it, as its lines);
// another symbol shown is a new start.
// FIX-COINSOUND: so does what closed while the readings stopped without the page being hidden (a computer asleep, an app
// kept in the background, a window behind others): two readings more than 50 s apart are not compared.
import { useEffect, useRef } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AccountView, Portfolio } from '../../shared/api-types.ts';
import { api } from '../api.ts';
import { playTradeSound, readyTradeSound } from '../trade-sound.ts';
import { endedTrades, tradeKeys, type TradeSnapshot } from './trade-ends.ts';

/** How often the portfolios are read while watching (the server keeps each one 20 s). */
export const WATCH_MS = 20_000;

/** `base`: the chart's asset ("SOL" of SOL/USDT, a share's ticker); `stock`: a share (brokers) or a coin (exchanges). */
export function useTradeEndSound(enabled: boolean, base: string, stock: boolean): void {
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => api.get<AccountView[]>('/api/accounts'), staleTime: 60_000, enabled });
  // The accounts that can hold the chart's asset, as for its lines: brokers for a share, exchanges for a coin.
  const relevant = (accounts.data ?? []).filter((a) => (a.kind === 'stocks') === stock);
  const portfolios = useQueries({
    queries: (enabled ? relevant : []).map((a) => ({
      queryKey: ['portfolio', a.id],
      queryFn: () => api.get<Portfolio>(`/api/portfolio/${a.id}`),
      // An account read at the day's close (IBKR Flex) has nothing new to say every 20 s.
      refetchInterval: (q: { state: { data?: Portfolio } }) => (q.state.data?.asOf ? false : WATCH_MS),
    })),
  });
  /** From when the readings count: the chart opened, the page was seen again, or another symbol was shown. */
  const watchFrom = useRef(Date.now());
  const seen = useRef(new Map<number, TradeSnapshot>());
  const qc = useQueryClient();
  /** The symbol watched until now (another one shown: its accounts are read at once, as when the chart opens). */
  const shown = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    // Switched on again, or another symbol shown: the readings count from now, compared only with readings of it.
    watchFrom.current = Date.now();
    seen.current.clear();
    const key = `${stock ? 's' : 'c'}:${base}`;
    if (shown.current !== null && shown.current !== key) for (const a of relevant) void qc.refetchQueries({ queryKey: ['portfolio', a.id] });
    shown.current = key;
    const onVisible = () => {
      if (document.visibilityState === 'visible') watchFrom.current = Date.now();
    };
    // Safari plays nothing before a touch: the first one readies the sound.
    const onGesture = () => readyTradeSound();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pointerdown', onGesture, { capture: true, once: true });
    window.addEventListener('keydown', onGesture, { capture: true, once: true });
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pointerdown', onGesture, { capture: true });
      window.removeEventListener('keydown', onGesture, { capture: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `relevant` derives from the accounts, read when the symbol changes
  }, [enabled, base, stock]);

  const stamp = portfolios.map((r) => (r.data ? `${r.data.accountId}:${r.dataUpdatedAt}` : '')).join('|');
  useEffect(() => {
    if (!enabled) return;
    let ended = false;
    for (const r of portfolios) {
      const d = r.data;
      if (!d) continue;
      const prev = seen.current.get(d.accountId);
      if (prev && prev.at === r.dataUpdatedAt) continue;
      const next = tradeKeys(d, r.dataUpdatedAt, base);
      // Compared only with a reading made while watching: one from before (the cache, a hidden page) is the start.
      if (prev && prev.at >= watchFrom.current && endedTrades(prev, next).length > 0) ended = true;
      seen.current.set(d.accountId, next);
    }
    if (ended && document.visibilityState === 'visible') playTradeSound();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the readings' times
  }, [enabled, stamp, base, stock]);
}
