import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Activity, CalendarDays, ChartCandlestick, Gauge, Landmark, LogOut, Moon, Newspaper, Search, Settings as SettingsIcon, ShieldCheck, SlidersHorizontal, Sparkles, Sun, Users, Wallet } from 'lucide-react';
import type { AccountRequest, PublicUser } from '../shared/api-types.ts';
import { api, errorMessage } from './api.ts';
import { AUTH_PATHS, clearAfterSignIn, landAfterSignOut, REQUESTS_KEY, SIGNED_OUT_EVENT, useAuthChange, useAuthState } from './auth.ts';
import { SignedInAuthRoutes, SignedOutApp } from './pages/Auth.tsx';
import { fmtTime } from './format.ts';
import { useNow, useTz } from './hooks.ts';
import { Loading } from './components/ui.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { CommandPalette, isMac } from './components/CommandPalette.tsx';
import { MarketStrip } from './components/MarketStrip.tsx';
import { ThemeToggle } from './components/ThemeToggle.tsx';
import { setTheme, useTheme } from './theme.ts';
import { EXIT_FULLSCREEN_EVENT } from './chart/fullscreen.ts';
import { isImportFailure } from './stale.ts';
import { TodayPage } from './pages/Today.tsx';

const NewsPage = lazy(() => import('./pages/News.tsx'));
const CalendarPage = lazy(() => import('./pages/Calendar.tsx'));
const EconomyPage = lazy(() => import('./pages/Economy.tsx'));
const ChartsPage = lazy(() => import('./pages/Charts.tsx'));
const TradesPage = lazy(() => import('./pages/Trades.tsx'));
const SettingsPage = lazy(() => import('./pages/Settings.tsx'));
const AdminSettingsPage = lazy(() => import('./pages/SettingsAdmin.tsx'));
const HealthPage = lazy(() => import('./pages/Health.tsx'));
const SecurityPage = lazy(() => import('./pages/Security.tsx'));
const DaySummary = lazy(() => import('./components/DaySummary.tsx').then((m) => ({ default: m.DaySummary })));
const UsersPage = lazy(() => import('./pages/Users.tsx'));

/** `admin`: only the admin sees it (FD-USERS §1). */
const NAV = [
  { to: '/', label: 'Azi', icon: Gauge, end: true },
  { to: '/news', label: 'Știri', icon: Newspaper },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/economy', label: 'Economie', icon: Landmark },
  { to: '/charts', label: 'Grafice', icon: ChartCandlestick },
  { to: '/trades', label: 'Tranzacții', icon: Wallet },
  { to: '/settings', label: 'Setări', icon: SettingsIcon },
  { to: '/health', label: 'Stare sistem', icon: Activity, admin: true },
];
/** In the user menu (and the search). */
const ACCOUNT_PAGES = [
  { to: '/security', label: 'Securitate', icon: ShieldCheck },
  { to: '/users', label: 'Utilizatori', icon: Users, admin: true },
];
/** Only in the search (⌘K): the admin's tab of Settings (FD-ADMINSET). */
const SEARCH_PAGES = [{ to: '/settings/admin', label: 'Setări admin', icon: SlidersHorizontal, admin: true }];
const forRole = <T extends { admin?: boolean }>(items: T[], user: PublicUser) => items.filter((i) => !i.admin || user.role === 'admin');

/** Polled by the top bar status dot and the offline banner (one shared query). */
function usePing() {
  return useQuery({ queryKey: ['ping'], queryFn: () => api.get<{ ok: boolean }>('/api/ping'), refetchInterval: 15_000, retry: 0 });
}

/** The Sentiq icon (the name follows it in the menu, so the image itself is decorative). */
function Monogram({ size = 28 }: { size?: number }) {
  return <img src="/brand/sentiq-64.png" alt="" width={size} height={size} className="shrink-0" style={{ width: size, height: size }} aria-hidden />;
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

/** The signed-in user's menu: Security, Users (admin), sign out. */
function UserMenu({ user }: { user: PublicUser }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const change = useAuthChange();
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const signOut = async () => {
    try {
      await api.post('/api/auth/logout');
      landAfterSignOut();
      change(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  const label = user.name || user.email || 'Cont';
  // FD-INVITE §1: the admin sees waiting account requests from anywhere.
  const requests = useQuery({
    queryKey: REQUESTS_KEY,
    queryFn: () => api.get<AccountRequest[]>('/api/admin/account-requests'),
    enabled: user.role === 'admin',
    refetchInterval: 120_000,
  });
  const waiting = user.role === 'admin' ? (requests.data?.length ?? 0) : 0;
  const theme = useTheme();
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="group inline-flex h-9 items-center gap-2 rounded-[10px] border border-line-strong bg-panel px-2 text-[13px] text-muted transition-colors hover:border-accent hover:bg-hover hover:text-text"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
        title={user.email ?? undefined}
        aria-label={`Contul tău: ${label}${waiting ? `, ${waiting === 1 ? 'o cerere de cont' : `${waiting} cereri de cont`}` : ''}`}
      >
        <span className="relative grid size-6 place-items-center rounded-full bg-panel-3 text-[12px] font-semibold text-accent" aria-hidden>
          {label.trim().charAt(0).toUpperCase()}
          {waiting > 0 && <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-accent ring-2 ring-panel group-hover:ring-hover" />}
        </span>
        <span className="hidden max-w-[140px] truncate md:inline" aria-hidden>
          {label}
        </span>
      </button>
      {open && (
        <div role="menu" className="theme-page absolute right-0 z-40 mt-2 w-[240px] rounded-[14px] border border-line-strong bg-panel-2 p-1.5 shadow-pop">
          <div className="px-3 pt-2 pb-2.5 text-[12.5px]">
            <div className="truncate font-semibold text-text">{label}</div>
            <div className="truncate text-faint">{user.role === 'admin' ? 'Admin' : 'Utilizator'}{user.email && user.name ? ` · ${user.email}` : ''}</div>
          </div>
          {forRole(ACCOUNT_PAGES, user).map(({ to, label: l, icon: Icon }) => (
            <Link key={to} role="menuitem" to={to} className="flex items-center gap-2.5 rounded-[9px] px-3 py-2 text-[13.5px] text-text no-underline transition-colors hover:bg-hover hover:no-underline">
              <Icon size={15} className="text-faint" aria-hidden />
              {l}
              {to === '/users' && waiting > 0 && (
                <span className="ml-auto text-[12px] font-medium text-accent">
                  {waiting === 1 ? '1 cerere' : `${waiting} cereri`}
                </span>
              )}
            </Link>
          ))}
          {/* The theme switch on a phone (the bar shows it from sm up). */}
          <button
            type="button"
            role="menuitem"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="flex w-full items-center gap-2.5 rounded-[9px] px-3 py-2 text-left text-[13.5px] text-text transition-colors hover:bg-hover sm:hidden"
          >
            {theme === 'dark' ? <Sun size={15} className="text-faint" aria-hidden /> : <Moon size={15} className="text-faint" aria-hidden />}
            {theme === 'dark' ? 'Temă luminoasă' : 'Temă întunecată'}
          </button>
          <button type="button" role="menuitem" onClick={() => void signOut()} className="flex w-full items-center gap-2.5 rounded-[9px] px-3 py-2 text-left text-[13.5px] text-text transition-colors hover:bg-hover">
            <LogOut size={15} className="text-faint" aria-hidden />
            Ieși din cont
          </button>
          {error && <div className="px-3 py-1.5 text-[12.5px] text-bear">{error}</div>}
        </div>
      )}
    </div>
  );
}

/** `onSummary`: the "Rezumat" button, on the Today page only (FD-SUMMARY §1). */
function TopNav({ onSearch, onSummary, user }: { onSearch: () => void; onSummary?: () => void; user: PublicUser }) {
  const shortcut = isMac() ? '⌘K' : 'Ctrl K';
  return (
    <header className="theme-bar sticky top-0 z-30 border-b border-line-soft bg-bar/90 backdrop-blur">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5 sm:px-6">
        <NavLink to="/" className="inline-flex items-center gap-2.5 text-[16px] font-[650] tracking-[-0.02em] text-text no-underline hover:no-underline" title="Sentiq">
          <Monogram />
          Sentiq
        </NavLink>
        <nav
          aria-label="Navigare"
          className="order-last -mx-4 flex w-[calc(100%+2rem)] gap-1 overflow-x-auto px-4 [mask-image:linear-gradient(to_right,black_calc(100%-40px),transparent)] lg:order-none lg:mx-0 lg:w-auto lg:px-0 lg:[mask-image:none]"
        >
          {forRole(NAV, user).map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                clsx(
                  'inline-flex h-[34px] shrink-0 items-center gap-2 rounded-lg px-3 text-[14px] whitespace-nowrap no-underline transition-colors hover:no-underline',
                  isActive ? 'bg-nav-active font-semibold text-on-nav-active [&>svg]:text-nav-active-icon' : 'text-muted hover:bg-nav-hover hover:text-text',
                )
              }
            >
              <Icon size={15} strokeWidth={1.9} aria-hidden className="shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-5">
          {onSummary && (
            <button
              type="button"
              onClick={onSummary}
              className="-mr-2 inline-flex h-9 items-center gap-2 rounded-[10px] border border-accent-dim bg-accent/[0.08] px-3 text-[13px] font-semibold text-accent transition-colors hover:border-accent hover:bg-accent hover:text-on-accent"
              aria-haspopup="dialog"
            >
              <Sparkles size={15} aria-hidden className="shrink-0" />
              Rezumat
            </button>
          )}
          <button
            type="button"
            onClick={onSearch}
            className="inline-flex h-9 items-center gap-2.5 rounded-[10px] border border-line-strong bg-panel px-3 text-left text-[13px] text-faint transition-colors hover:border-accent hover:bg-hover hover:text-text xl:w-[280px]"
            aria-keyshortcuts={isMac() ? 'Meta+K' : 'Control+K'}
          >
            <Search size={15} aria-hidden className="shrink-0" />
            <span className="hidden flex-1 truncate whitespace-nowrap sm:inline">Caută monede, acțiuni, știri</span>
            <span className="sr-only sm:hidden">Caută</span>
            <kbd className="num hidden rounded-[5px] border border-line-strong px-1.5 py-px text-[11px] sm:inline">{shortcut}</kbd>
          </button>
          <Clocks />
          {/* On a phone the switch lives in the account menu: the bar keeps one row (FD-THEME §2). */}
          <ThemeToggle className="-ml-2 max-sm:hidden" />
          <UserMenu user={user} />
        </div>
      </div>
    </header>
  );
}

/** Sentiq opened on the computer that runs it (http://localhost), not on its public or network address. */
const isThisComputer = () => ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);

/** Shown when the server stops answering: pages keep their last data, this says it may be stale. */
function OfflineBanner() {
  const ping = usePing();
  if (!ping.isError) return null;
  return (
    <div role="alert" className="border-b border-bear/40 bg-bear/10 px-4 py-2.5 text-[13.5px] sm:px-6">
      {/* FD-ONLINE §3: what to do depends on where Sentiq is opened (this Mac, or the public address). */}
      {isThisComputer() ? (
        <>
          Serverul Sentiq nu răspunde. Datele afișate pot fi vechi; deschide <strong>Sentiq.app</strong> sau rulează <code>scripts/sentiq.sh start</code>.
        </>
      ) : (
        'Serverul Sentiq nu răspunde. Datele afișate pot fi vechi; pagina revine singură când serverul răspunde.'
      )}
    </div>
  );
}

export function App() {
  const auth = useAuthState();
  const change = useAuthChange();
  const location = useLocation();
  useEffect(() => {
    // A 401 from any request: the session ended elsewhere (signed out everywhere, disabled, expired).
    const onSignedOut = () => change(null);
    window.addEventListener(SIGNED_OUT_EVENT, onSignedOut);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, onSignedOut);
  }, [change]);
  if (!auth.data) {
    if (auth.isError) {
      return (
        <div className="mx-auto flex min-h-screen max-w-[480px] flex-col justify-center gap-3 px-4">
          <p className="text-[15px]">{errorMessage(auth.error)}</p>
          <button className="btn self-start" onClick={() => void auth.refetch()}>
            Reîncearcă
          </button>
        </div>
      );
    }
    return (
      <div className="grid min-h-screen place-items-center">
        <Loading />
      </div>
    );
  }
  const user = auth.data.user;
  if (!user) return <SignedOutApp state={auth.data} />;
  if (AUTH_PATHS.includes(location.pathname)) return <SignedInAuthRoutes state={auth.data} />;
  return <SignedInApp user={user} />;
}

/** The summary window could not be shown (e.g. its code changed under an old tab): say so in a window of its own. */
function SummaryFailed({ error, onClose }: { error: Error; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-scrim p-4 pt-[12vh] backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
        else if (e.key === 'Tab') {
          // Tab stays on the window's two buttons.
          e.preventDefault();
          const buttons = [...e.currentTarget.querySelectorAll('button')];
          const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
          buttons[(at + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
        }
      }}
    >
      <div role="alertdialog" aria-modal="true" aria-labelledby="summary-failed" className="panel w-full max-w-[460px] p-5">
        <h2 id="summary-failed" className="text-[16px] font-semibold">
          Rezumatul nu a putut fi afișat
        </h2>
        <p className="mt-2 text-[13px] text-muted">
          {/* A code file that is no longer there (FD-STALE): the page reloads by itself when it can. */}
          {isImportFailure(error.message)
            ? 'Aplicația a fost actualizată între timp: reîncarcă pagina.'
            : error.message}
        </p>
        <div className="mt-4 flex gap-2">
          <button type="button" className="btn btn-primary" autoFocus onClick={() => window.location.reload()}>
            Reîncarcă pagina
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Închide
          </button>
        </div>
      </div>
    </div>
  );
}

function SignedInApp({ user }: { user: PublicUser }) {
  const location = useLocation();
  const [search, setSearch] = useState(false);
  const [summary, setSummary] = useState(false);
  const closeSummary = useCallback(() => setSummary(false), []);
  // The summary belongs to the Today page: leaving it closes the window.
  useEffect(() => setSummary(false), [location.pathname]);
  // Landed: the next sign-in starts from its own page again.
  useEffect(() => clearAfterSignIn(), []);
  const closeSearch = useCallback(() => setSearch(false), []);
  useEffect(() => {
    // ⌘K / Ctrl+K opens the search from anywhere, including text fields (macOS convention).
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        // A chart in full screen would hide the search: leave full screen first (FD-CHARTUX §4); the day summary too.
        window.dispatchEvent(new Event(EXIT_FULLSCREEN_EVENT));
        setSummary(false);
        setSearch((s) => !s);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="flex min-h-screen flex-col">
      <TopNav onSearch={() => setSearch(true)} onSummary={location.pathname === '/' ? () => setSummary(true) : undefined} user={user} />
      <MarketStrip />
      <OfflineBanner />
      <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-5 sm:px-6">
        <ErrorBoundary resetKey={location.pathname}>
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route path="/" element={<TodayPage />} />
              <Route path="/news" element={<NewsPage />} />
              <Route path="/calendar" element={<CalendarPage />} />
              <Route path="/economy" element={<EconomyPage />} />
              <Route path="/charts" element={<ChartsPage />} />
              {/* Case-sensitive: /charts/S/USDT is the Sonic pair, /charts/s/AAPL a stock, /charts/i/SPX an index. */}
              <Route path="/charts/s/:ticker" caseSensitive element={<ChartsPage />} />
              <Route path="/charts/i/:index" caseSensitive element={<ChartsPage />} />
              <Route path="/charts/:base/:quote" element={<ChartsPage />} />
              <Route path="/trades" element={<TradesPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              {user.role === 'admin' && <Route path="/settings/admin" element={<AdminSettingsPage />} />}
              {user.role === 'admin' && <Route path="/health" element={<HealthPage />} />}
              <Route path="/security" element={<SecurityPage />} />
              {user.role === 'admin' && <Route path="/users" element={<UsersPage />} />}
              <Route path="*" element={<p className="text-muted">Pagina nu există.</p>} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </main>
      <CommandPalette open={search} onClose={closeSearch} pages={[...forRole(NAV, user), ...forRole(ACCOUNT_PAGES, user), ...forRole(SEARCH_PAGES, user)]} />
      {summary && (
        // Its own boundary: a window that cannot load (an old tab after an update) must not blank the app.
        <ErrorBoundary resetKey={location.pathname} fallback={(err) => <SummaryFailed error={err} onClose={closeSummary} />}>
          <Suspense fallback={null}>
            <DaySummary onClose={closeSummary} />
          </Suspense>
        </ErrorBoundary>
      )}
    </div>
  );
}
