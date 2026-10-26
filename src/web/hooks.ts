import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SettingsView } from '../shared/settings.ts';
import type { AccountInfo, CalendarResponse, MarketSourceInfo, StocksInfo, WatchItem, WatchView } from '../shared/api-types.ts';
import { api, qs } from './api.ts';

/** The signed-in user's own account (Security; the passkeys the trading switch can confirm with, FD-TRADEUNLOCK). */
export const ACCOUNT_KEY = ['account'] as const;
export function useAccountInfo(enabled = true) {
  return useQuery({ queryKey: ACCOUNT_KEY, queryFn: () => api.get<AccountInfo>('/api/account'), enabled });
}

export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: () => api.get<SettingsView>('/api/settings'), staleTime: 60_000 });
}

/** Saves a patch of the settings (the user's own, or the global ones for the admin) and refreshes what depends on them. */
export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: unknown) => api.put<SettingsView>('/api/settings', patch),
    onSuccess: (data) => {
      qc.setQueryData(['settings'], data);
      void qc.invalidateQueries({ queryKey: ['sentiment'] });
      void qc.invalidateQueries({ queryKey: ['scanner'] });
    },
  });
}

/** Links such as /settings#market land on their section once the page has rendered (`ready`). */
export function useHashScroll(ready: boolean) {
  const { hash } = useLocation();
  useEffect(() => {
    if (!ready || !hash) return;
    document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: 'start' });
  }, [ready, hash]);
}

/**
 * Where the user's crypto prices come from (FD-MARKETSRC), for one pair when given. Accounts added or removed and the
 * choice among several invalidate ['market-source'].
 */
export function useMarketSource(symbol?: string) {
  return useQuery({
    queryKey: ['market-source', symbol ?? ''],
    queryFn: () => api.get<MarketSourceInfo>(`/api/market/source${qs({ symbol })}`),
    staleTime: 30_000,
  });
}

/** After an account is added or removed (FD-MARKETSRC §3): prices may now come from another exchange. */
export function invalidatePriceSource(qc: ReturnType<typeof useQueryClient>) {
  for (const key of ['market-source', 'spark', 'candles', 'scanner', 'symbols']) void qc.invalidateQueries({ queryKey: [key] });
}

/** The user's time zone (falls back to the browser's until settings load). */
export function useTz(): string {
  const s = useSettings();
  return s.data?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function useWatchlist() {
  return useQuery({ queryKey: ['watchlist'], queryFn: () => api.get<WatchItem[]>('/api/watchlist'), staleTime: 60_000 });
}

/** FD-WATCHLISTS: the user's lists, with all their symbols together (`items`, the same as `useWatchlist`). */
export const WATCHLISTS_KEY = ['watchlists'] as const;
export function useWatchlists() {
  return useQuery({ queryKey: WATCHLISTS_KEY, queryFn: () => api.get<WatchView>('/api/watchlists'), staleTime: 60_000 });
}

/** `coins` in the order of `order` (those missing from it keep their place at the end). */
export function orderCoins(coins: string[], order: string[]): string[] {
  const have = new Set(coins);
  const moved = order.filter((c) => have.has(c));
  const set = new Set(moved);
  return [...moved, ...coins.filter((c) => !set.has(c))];
}

/**
 * Puts the server's answer about the lists where everything reads it: the lists, and all their symbols together (Today,
 * the strip, ⌘K). `followed`: the symbols followed changed, so what depends on them is read again.
 */
export function useApplyWatchView() {
  const qc = useQueryClient();
  return (v: WatchView, followed: boolean) => {
    qc.setQueryData<WatchView>(WATCHLISTS_KEY, { lists: v.lists, items: v.items });
    qc.setQueryData<WatchItem[]>(['watchlist'], v.items);
    if (!followed) return;
    void qc.invalidateQueries({ queryKey: ['scanner'] });
    void qc.invalidateQueries({ queryKey: ['news'] });
    void qc.invalidateQueries({ queryKey: ['sources'] });
    void qc.invalidateQueries({ queryKey: ['calendar'] });
  };
}

export interface ListReorder {
  save: (coins: string[]) => void;
  isError: boolean;
  error: unknown;
}

/**
 * Saves a new order of a list's symbols (FD-CHARTFAV §2, in each list since FD-WATCHLISTS). `save(coins)` takes the
 * whole list in its new order: it is shown at once; the saves go one after the other, in the order of the moves; if
 * one fails, the lists are read again.
 */
export function useReorderList(listId: number | null): ListReorder {
  const qc = useQueryClient();
  const apply = useApplyWatchView();
  const mutationKey = ['watchlists', 'order', listId];
  const m = useMutation({
    mutationKey,
    scope: { id: `watchlist-order-${listId}` },
    mutationFn: (coins: string[]) => api.put<WatchView>(`/api/watchlists/${listId}/items/order`, { coins }),
    // While a later move is still waiting, its order (already shown) stays on screen.
    onSuccess: (data) => {
      if (qc.isMutating({ mutationKey }) <= 1) apply(data, false);
    },
    onError: () => void qc.invalidateQueries({ queryKey: WATCHLISTS_KEY }),
  });
  const save = (coins: string[]) => {
    if (listId === null) return;
    void qc.cancelQueries({ queryKey: WATCHLISTS_KEY });
    const prev = qc.getQueryData<WatchView>(WATCHLISTS_KEY);
    if (prev) qc.setQueryData<WatchView>(WATCHLISTS_KEY, { ...prev, lists: prev.lists.map((l) => (l.id === listId ? { ...l, coins: orderCoins(l.coins, coins) } : l)) });
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
