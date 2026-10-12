import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SettingsView } from '../shared/settings.ts';
import type { CalendarResponse, WatchItem } from '../shared/api-types.ts';
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
  const currencies = useSettings().data?.calendar.currencies;
  const q = useQuery({
    queryKey: ['calendar', 'next-high', currencies?.join()],
    queryFn: () => {
      const from = Date.now() - 5 * 60_000;
      return api.get<CalendarResponse>(`/api/calendar${qs({ from, to: from + 8 * 86_400_000, impact: 'High', currencies })}`);
    },
    refetchInterval: 5 * 60_000,
    enabled: currencies !== undefined,
  });
  return q.data?.events.find((e) => !e.allDay && e.ts > now - 2 * 60_000) ?? null;
}
