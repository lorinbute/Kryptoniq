import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Activity, CalendarDays, ChartCandlestick, Gauge, Newspaper, Search, Settings as SettingsIcon, Wallet } from 'lucide-react';
import { api } from './api.ts';
import { fmtTime } from './format.ts';
import { useNow, useTz } from './hooks.ts';
import { Loading } from './components/ui.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { CommandPalette, isMac } from './components/CommandPalette.tsx';
import { MarketStrip } from './components/MarketStrip.tsx';
import { EXIT_FULLSCREEN_EVENT } from './chart/fullscreen.ts';
import { TodayPage } from './pages/Today.tsx';

const NewsPage = lazy(() => import('./pages/News.tsx'));
const CalendarPage = lazy(() => import('./pages/Calendar.tsx'));
const ChartsPage = lazy(() => import('./pages/Charts.tsx'));
const TradesPage = lazy(() => import('./pages/Trades.tsx'));
const SettingsPage = lazy(() => import('./pages/Settings.tsx'));
const HealthPage = lazy(() => import('./pages/Health.tsx'));

const NAV = [
  { to: '/', label: 'Azi', icon: Gauge, end: true },
  { to: '/news', label: 'Știri', icon: Newspaper },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/charts', label: 'Grafice', icon: ChartCandlestick },
  { to: '/trades', label: 'Tranzacții', icon: Wallet },
  { to: '/settings', label: 'Setări', icon: SettingsIcon },
  { to: '/health', label: 'Stare sistem', icon: Activity },
];

/** Polled by the top bar status dot and the offline banner (one shared query). */
function usePing() {
  return useQuery({ queryKey: ['ping'], queryFn: () => api.get<{ ok: boolean }>('/api/ping'), refetchInterval: 15_000, retry: 0 });
}

function Monogram({ size = 26 }: { size?: number }) {
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-[7px] bg-brass font-extrabold text-ink" style={{ width: size, height: size, fontSize: Math.round(size * 0.54) }} aria-hidden>
      K
    </span>
  );
}

function Clocks() {
  const tz = useTz();
  const now = useNow(1000);
  const ping = usePing();
  return (
    <div className="hidden items-center gap-4 text-[12.5px] text-muted xl:flex">
      <span className="inline-flex items-center gap-1.5">
        <span
          className={clsx('size-[7px] rounded-full', ping.isError ? 'bg-bear' : ping.data ? 'bg-bull' : 'bg-faint')}
          role="img"
          aria-label={ping.isError ? 'Serverul nu răspunde' : ping.data ? 'Server local activ' : 'Se verifică serverul'}
        />
        Local <span className="num text-text">{fmtTime(now, tz)}</span>
      </span>
      <span>
        NY <span className="num text-text">{fmtTime(now, 'America/New_York')}</span>
      </span>
    </div>
  );
}

function TopNav({ onSearch }: { onSearch: () => void }) {
  const shortcut = isMac() ? '⌘K' : 'Ctrl K';
  return (
    <header className="sticky top-0 z-30 border-b border-line-soft bg-ink/90 backdrop-blur">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5 sm:px-6">
        <NavLink to="/" className="inline-flex items-center gap-2.5 text-[16px] font-[650] tracking-[-0.02em] text-text no-underline hover:no-underline" title="Kryptoniq">
          <Monogram />
          Kryptoniq
        </NavLink>
        <nav
          aria-label="Navigare"
          className="order-last -mx-4 flex w-[calc(100%+2rem)] gap-1 overflow-x-auto px-4 [mask-image:linear-gradient(to_right,black_calc(100%-40px),transparent)] lg:order-none lg:mx-0 lg:w-auto lg:px-0 lg:[mask-image:none]"
        >
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                clsx(
                  'inline-flex h-[34px] shrink-0 items-center gap-2 rounded-lg px-3 text-[14px] whitespace-nowrap no-underline transition-colors hover:no-underline',
                  isActive ? 'bg-panel-2 font-semibold text-text [&>svg]:text-brass' : 'text-muted hover:text-text',
                )
              }
            >
              <Icon size={15} strokeWidth={1.9} aria-hidden className="shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-5">
          <button
            type="button"
            onClick={onSearch}
            className="inline-flex h-9 items-center gap-2.5 rounded-[10px] border border-line-strong bg-panel px-3 text-left text-[13px] text-faint transition-colors hover:border-brass-dim hover:text-muted xl:w-[280px]"
            aria-keyshortcuts={isMac() ? 'Meta+K' : 'Control+K'}
          >
            <Search size={15} aria-hidden className="shrink-0" />
            <span className="hidden flex-1 truncate whitespace-nowrap sm:inline">Caută monede, pagini, știri</span>
            <span className="sr-only sm:hidden">Caută</span>
            <kbd className="num hidden rounded-[5px] border border-line-strong px-1.5 py-px text-[11px] sm:inline">{shortcut}</kbd>
          </button>
          <Clocks />
        </div>
      </div>
    </header>
  );
}

/** Shown when the local server stops answering: pages keep their last data, this says it may be stale. */
function OfflineBanner() {
  const ping = usePing();
  if (!ping.isError) return null;
  return (
    <div role="alert" className="border-b border-bear/40 bg-bear/10 px-4 py-2.5 text-[13.5px] sm:px-6">
      Serverul Kryptoniq nu răspunde. Datele afișate pot fi vechi; deschide <strong>Kryptoniq.app</strong> sau rulează <code>scripts/kryptoniq.sh start</code>.
    </div>
  );
}

export function App() {
  const location = useLocation();
  const [search, setSearch] = useState(false);
  const closeSearch = useCallback(() => setSearch(false), []);
  useEffect(() => {
    // ⌘K / Ctrl+K opens the search from anywhere, including text fields (macOS convention).
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        // A chart in full screen would hide the search: leave full screen first (FD-CHARTUX §4).
        window.dispatchEvent(new Event(EXIT_FULLSCREEN_EVENT));
        setSearch((s) => !s);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="flex min-h-screen flex-col">
      <TopNav onSearch={() => setSearch(true)} />
      <MarketStrip />
      <OfflineBanner />
      <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-5 sm:px-6">
        <ErrorBoundary resetKey={location.pathname}>
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route path="/" element={<TodayPage />} />
              <Route path="/news" element={<NewsPage />} />
              <Route path="/calendar" element={<CalendarPage />} />
              <Route path="/charts" element={<ChartsPage />} />
              <Route path="/charts/:base/:quote" element={<ChartsPage />} />
              <Route path="/trades" element={<TradesPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/health" element={<HealthPage />} />
              <Route path="*" element={<p className="text-muted">Pagina nu există.</p>} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </main>
      <CommandPalette open={search} onClose={closeSearch} pages={NAV} />
    </div>
  );
}
