import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SettingsView } from '../shared/settings.ts';
import type { CalendarResponse, StocksInfo, WatchItem } from '../shared/api-types.ts';
import { api, qs } from './api.ts';

export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: () => api.get<SettingsView>('/api/settings'), staleTime: 60_000 });
}

/** The user's time zone (falls back to the browser's until settings load). */
export function useTz(): string {
  const s = useSettings();
  return s.data?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function useWatchlist() {
  return useQuery({ queryKey: ['watchlist'], queryFn: () => api.get<WatchItem[]>('/api/watchlist'), staleTime: 60_000 });
}

/** `list` in the order of `coins` (favourites missing from `coins` keep their place at the end). */
export function orderWatchlist(list: WatchItem[], coins: string[]): WatchItem[] {
  const byCoin = new Map(list.map((w) => [w.coin, w]));
  const moved = coins.map((c) => byCoin.get(c)).filter((w): w is WatchItem => w !== undefined);
  return [...moved, ...list.filter((w) => !coins.includes(w.coin))];
}

/**
 * Saves a new order of the favourites (FD-CHARTFAV §2). `save(coins)` takes the whole list in its new order: it is
 * shown at once everywhere; the saves go one after the other, in the order of the moves; if one fails, the list is
 * read again from the server.
 */
export function useReorderWatchlist() {
  const qc = useQueryClient();
  const mutationKey = ['watchlist', 'order'];
  const m = useMutation({
    mutationKey,
    scope: { id: 'watchlist-order' },
    mutationFn: (coins: string[]) => api.put<WatchItem[]>('/api/watchlist/order', { coins }),
    // While a later move is still waiting, its order (already shown) stays on screen.
    onSuccess: (data) => {
      if (qc.isMutating({ mutationKey }) <= 1) qc.setQueryData(['watchlist'], data);
    },
    onError: () => void qc.invalidateQueries({ queryKey: ['watchlist'] }),
  });
  const save = (coins: string[]) => {
    void qc.cancelQueries({ queryKey: ['watchlist'] });
    const prev = qc.getQueryData<WatchItem[]>(['watchlist']);
    if (prev) qc.setQueryData<WatchItem[]>(['watchlist'], orderWatchlist(prev, coins));
    m.mutate(coins);
  };
  return { save, isError: m.isError, error: m.error };
}

/** Tickers of the watchlist stocks, to draw their tags as company badges (not coin logos). */
export function useStockSet(): ReadonlySet<string> {
  const data = useWatchlist().data;
  return useMemo(() => new Set((data ?? []).filter((w) => w.kind === 'stock').map((w) => w.coin)), [data]);
}

/** Stock data: the timeframes the source has, whether the Twelve Data key is set, the US market state. */
export function useStocksInfo(enabled = true) {
  return useQuery({ queryKey: ['stocks', 'info'], queryFn: () => api.get<StocksInfo>('/api/stocks/info'), staleTime: 60_000, refetchInterval: 5 * 60_000, enabled });
}

/** Re-renders every `ms` milliseconds (clocks, countdowns, "x min ago"). */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/**
 * High-impact events of the next 8 days for the user's currencies (top bar and the Today calendar share
 * this query). `next` is the first timed event that has not started more than 2 minutes ago.
 */
export function useNextHighImpact(now: number) {
  const calendar = useSettings().data?.calendar;
  const currencies = calendar?.currencies;
  // Quarterly results of the watchlist stocks count too, unless switched off (FD-SENTIQ §4.5).
  const earnings = calendar?.earnings === false ? '0' : '1';
  const q = useQuery({
    queryKey: ['calendar', 'next-high', currencies?.join(), earnings],
    queryFn: () => {
      const from = Date.now() - 5 * 60_000;
      return api.get<CalendarResponse>(`/api/calendar${qs({ from, to: from + 8 * 86_400_000, impact: 'High', currencies, earnings })}`);
    },
    refetchInterval: 5 * 60_000,
    enabled: currencies !== undefined,
  });
  return q.data?.events.find((e) => !e.allDay && e.ts > now - 2 * 60_000) ?? null;
}
