// The market strip under the top navigation (FD-REDESIGN): favourite coins with price, 24 h change and a
// 48 h sparkline, favourite stocks with price, day change and 60 days (FD-SENTIQ §4.2), then the next
// high-impact event and the market context (crypto, then US stocks).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { clsx } from 'clsx';
import type { CandlesResult, MarketContext, MarketStatus, StockQuoteRow, WatchItem } from '../../shared/api-types.ts';
import { api, qs } from '../api.ts';
import { fmtCountdown, fmtPct, fmtPrice, fmtUsd } from '../format.ts';
import { useNextHighImpact, useNow, useSettings, useWatchlist } from '../hooks.ts';
import { sparkChange, sparkPath } from '../spark.ts';
import { chartPathOf } from '../chart/paths.ts';
import { CoinLogo, EventIcon } from './icons.tsx';
import { Activity, ChartPie, Gauge, Landmark } from 'lucide-react';

const FNG_RO: Record<string, string> = { 'Extreme Fear': 'frică extremă', Fear: 'frică', Neutral: 'neutru', Greed: 'lăcomie', 'Extreme Greed': 'lăcomie extremă' };
/** CNN writes its ratings in lower case. */
const fngRo = (rating: string) => FNG_RO[rating.replace(/\b\w/g, (c) => c.toUpperCase())] ?? rating;
const MARKET_STATE_RO: Record<MarketStatus['state'], string> = { open: 'deschisă', pre: 'pre-market', after: 'after-hours', closed: 'închisă' };

/** Each coin, stock and event in the strip; the background shows what the pointer is on (FD-THEME2 §4). */
const TICKER_LINK = '-mx-1.5 -my-0.5 inline-flex items-center gap-2 rounded-md px-1.5 py-0.5 text-text no-underline transition-colors hover:bg-hover hover:no-underline';

/** Price and day change of the favourite stocks (Nasdaq, one request for all, cached a minute on the server). */
export function useStockQuotes(symbols: string[]) {
  return useQuery({
    queryKey: ['stocks', 'quotes', symbols.join(',')],
    queryFn: () => api.get<StockQuoteRow[]>(`/api/stocks/quotes${qs({ symbols: symbols.join(',') })}`),
    enabled: symbols.length > 0,
    refetchInterval: 60_000,
    staleTime: 30_000,
    select: (rows: StockQuoteRow[]) => new Map(rows.map((r) => [r.symbol, r])),
  });
}

/** 60 daily closes per favourite stock (Nasdaq, an hour on the server: no Twelve Data credits). */
export function useStockSparks(symbols: string[]) {
  return useQueries({
    queries: symbols.map((symbol) => ({
      queryKey: ['stocks', 'spark', symbol],
      queryFn: () => api.get<{ symbol: string; closes: number[] }>(`/api/stocks/spark${qs({ symbol })}`),
      staleTime: 30 * 60_000,
      refetchInterval: 60 * 60_000,
      select: (r: { closes: number[] }) => r.closes,
    })),
  });
}

/** "închisă, se deschide în 6h 40m" from the Nasdaq market state. */
export function marketStateText(m: MarketStatus, now: number): string {
  const state = MARKET_STATE_RO[m.state];
  if (m.state === 'open' && m.closesAt && m.closesAt > now) return `${state}, se închide în ${fmtCountdown(m.closesAt, now)}`;
  if (m.state !== 'open' && m.opensAt && m.opensAt > now) return `${state}, se deschide în ${fmtCountdown(m.opensAt, now)}`;
  return state;
}

function StockTicker({ w, q, closes }: { w: WatchItem; q: StockQuoteRow | undefined; closes: number[] | undefined }) {
  const change = q?.changePct ?? null;
  const closed = q?.status ? /closed/i.test(q.status) : false;
  const precision = q?.last != null && q.last < 1 ? 4 : 2;
  return (
    <Link to={chartPathOf(w)} className={TICKER_LINK} title={w.name ?? undefined}>
      <CoinLogo coin={w.coin} size={16} badge square />
      <span className="font-semibold">{w.coin}</span>
      <span className={clsx('num', q?.error && 'text-faint')} title={q?.error ? `Prețul nu s-a putut încărca: ${q.error}` : undefined}>
        {q?.last != null ? fmtPrice(q.last, precision) : q ? '—' : '…'}
      </span>
      {change !== null && <span className={clsx('num', change >= 0 ? 'text-bull' : 'text-bear')}>{fmtPct(change)}</span>}
      {closed && <span className="text-[11.5px] text-faint">închis</span>}
      <Sparkline values={closes ?? []} width={48} height={18} className="max-sm:hidden" change={change} />
    </Link>
  );
}

/** Hourly closes of the last 48 h for each favourite coin (shared with the coin tiles on the Today page). */
export function useSparks(symbols: string[]) {
  const settings = useSettings();
  const exchange = settings.data?.market.exchange ?? 'kucoin';
  return useQueries({
    queries: symbols.map((symbol) => ({
      queryKey: ['spark', exchange, symbol],
      queryFn: () => api.get<CandlesResult>(`/api/market/candles${qs({ exchange, symbol, tf: '1h', limit: 50 })}`),
      enabled: settings.isSuccess,
      staleTime: 30_000,
      refetchInterval: 60_000,
      select: (r: CandlesResult) => ({ closes: r.candles.slice(-48).map((c) => c.c), precision: r.pricePrecision }),
    })),
  });
}

/**
 * 48 h line. Its colour follows `change` when given (the 24 h change shown next to it, so the two never
 * disagree), otherwise the direction of the line itself.
 */
export function Sparkline({ values, width, height, className, change: shown }: { values: number[]; width: number; height: number; className?: string; change?: number | null }) {
  const d = sparkPath(values, 120, 36);
  if (!d) return null;
  const change = shown === undefined ? sparkChange(values) : shown;
  return (
    <svg viewBox="0 0 120 36" width={width} height={height} preserveAspectRatio="none" aria-hidden className={className}>
      <path d={d} fill="none" stroke={change === null ? 'var(--color-muted)' : change >= 0 ? 'var(--color-bull)' : 'var(--color-bear)'} strokeWidth={1.75} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

/** Pixels per second of the ticker. */
const TICKER_SPEED = 40;

/**
 * Endless left-scrolling strip: `children` is rendered once for real and repeated (inert, hidden from screen
 * readers) as often as needed to fill the width; the track moves by exactly one copy, so the loop is seamless.
 */
function Ticker({ children, label }: { children: ReactNode; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ copy: 0, box: 0 });
  useEffect(() => {
    const ro = new ResizeObserver(() => setSize({ copy: first.current?.offsetWidth ?? 0, box: box.current?.offsetWidth ?? 0 }));
    if (box.current) ro.observe(box.current);
    if (first.current) ro.observe(first.current);
    return () => ro.disconnect();
  }, []);
  const copies = size.copy > 0 ? Math.max(1, Math.ceil(size.box / size.copy)) : 1;
  const style = { '--ticker-shift': `${size.copy}px`, '--ticker-duration': `${Math.max(10, size.copy / TICKER_SPEED)}s` } as React.CSSProperties;
  return (
    <div ref={box} className="theme-bar ticker overflow-hidden border-b border-line-soft bg-strip" aria-label={label} role="region">
      <div className={clsx('flex w-max', size.copy > 0 && 'ticker-track')} style={style}>
        <div ref={first} className="flex shrink-0 items-center gap-x-6 py-2.5 pr-6 pl-6 text-[13px] whitespace-nowrap">
          {children}
        </div>
        {Array.from({ length: copies }, (_, k) => (
          <div key={k} className="ticker-copy flex shrink-0 items-center gap-x-6 py-2.5 pr-6 pl-6 text-[13px] whitespace-nowrap" aria-hidden inert>
            {children}
          </div>
        ))}
      </div>
    </div>
  );
}

export function MarketStrip() {
  const now = useNow(1000);
  const watchlist = useWatchlist();
  const all = watchlist.data ?? [];
  const coins = all.filter((w) => w.kind !== 'stock');
  const stocks = all.filter((w) => w.kind === 'stock');
  const sparks = useSparks(coins.map((w) => `${w.coin}/${w.quote}`));
  const stockSymbols = stocks.map((w) => w.coin);
  const quotes = useStockQuotes(stockSymbols);
  const stockSparks = useStockSparks(stockSymbols);
  const ctx = useQuery({ queryKey: ['market', 'context'], queryFn: () => api.get<MarketContext>('/api/market/context'), refetchInterval: 10 * 60_000 });
  const next = useNextHighImpact(now);
  const fg = ctx.data?.fearGreed;
  const gl = ctx.data?.global;
  // `?.`: a server from before FD-SENTIQ sends no `stocks` group.
  const st = ctx.data?.stocks;
  const coinItem = (w: WatchItem, i: number) => {
    const s = sparks[i]?.data;
    const failed = sparks[i]?.isError && !s;
    const closes = s?.closes ?? [];
    const last = closes.at(-1);
    // 24 h change from the hourly closes (the strip has no other price source).
    const change = closes.length >= 25 ? sparkChange(closes.slice(-25)) : null;
    return (
      <Link key={`${w.coin}/${w.quote}`} to={`/charts/${w.coin}/${w.quote}`} className={TICKER_LINK}>
        <CoinLogo coin={w.coin} size={16} />
        <span className="font-semibold">{w.coin}</span>
        <span className={clsx('num', failed && 'text-faint')} title={failed ? 'Prețul nu s-a putut încărca' : undefined}>
          {last !== undefined ? fmtPrice(last, s?.precision ?? 2) : failed ? '—' : '…'}
        </span>
        {change !== null && <span className={clsx('num', change >= 0 ? 'text-bull' : 'text-bear')}>{fmtPct(change)}</span>}
        <Sparkline values={closes} width={48} height={18} className="max-sm:hidden" change={change} />
      </Link>
    );
  };
  return (
    <Ticker label="Piața acum">
      {/* In the order of the watchlist, coins and stocks mixed. */}
      {all.map((w) =>
        w.kind === 'stock' ? (
          <StockTicker key={`stock:${w.coin}`} w={w} q={quotes.data?.get(w.coin)} closes={stockSparks[stockSymbols.indexOf(w.coin)]?.data} />
        ) : (
          coinItem(w, coins.indexOf(w))
        ),
      )}
      {all.length > 0 && <span className="h-4 w-px shrink-0 bg-line-strong" aria-hidden />}
      {next && (
        <Link to="/calendar" className={TICKER_LINK} title="Următorul eveniment cu impact mare">
          <EventIcon title={next.title} impact={next.impact} source={next.source} className="text-impact-high" />
          <span>
            {next.currency === 'ALL' ? 'Global' : next.currency} {next.title}
          </span>
          <span className={clsx('num font-semibold', next.ts - now < 15 * 60_000 ? 'text-warn' : 'text-accent')}>{next.ts <= now ? 'acum' : fmtCountdown(next.ts, now)}</span>
        </Link>
      )}
      {next && <span className="h-4 w-px shrink-0 bg-line-strong" aria-hidden />}
      {fg && (
        <span className="inline-flex items-center gap-1.5 text-muted" title="Fear & Greed Index">
          <Gauge size={14} aria-hidden className="text-accent" />
          F&amp;G <span className="num font-semibold text-text">{fg.value}</span> {FNG_RO[fg.classification] ?? fg.classification}
        </span>
      )}
      {gl && (
        <>
          <span className="inline-flex items-center gap-1.5 text-muted">
            <ChartPie size={14} aria-hidden className="text-link" />
            Cap. piață <span className="font-semibold text-text">{fmtUsd(gl.totalMarketCapUsd, true)}</span>{' '}
            <span className={clsx('num', (gl.marketCapChange24h ?? 0) >= 0 ? 'text-bull' : 'text-bear')}>{fmtPct(gl.marketCapChange24h)}</span>
          </span>
          <span className="inline-flex items-center gap-1.5 text-muted">
            <CoinLogo coin="BTC" size={14} />
            Dom. BTC <span className="num font-semibold text-text">{gl.btcDominance.toFixed(1)}%</span>
          </span>
        </>
      )}
      {st && (st.market || st.indices || st.fearGreed) && <span className="h-4 w-px shrink-0 bg-line-strong" aria-hidden />}
      {st?.market && (
        <span className="inline-flex items-center gap-1.5 text-muted" title={`Bursa americană (${st.market.label})`}>
          <Landmark size={14} aria-hidden className={st.market.state === 'open' ? 'text-bull' : st.market.state === 'closed' ? 'text-faint' : 'text-warn'} />
          Bursa SUA <span className="text-text">{marketStateText(st.market, now)}</span>
        </span>
      )}
      {st?.indices?.items.map((ix) => (
        <span key={ix.id} className="inline-flex items-center gap-1.5 text-muted">
          {ix.name} <span className="num font-semibold text-text">{fmtPrice(ix.last, 2)}</span>
          {ix.changePct !== null && (
            // A rising VIX is fear: red.
            <span className={clsx('num', (ix.id === 'VIX' ? -ix.changePct : ix.changePct) >= 0 ? 'text-bull' : 'text-bear')}>{fmtPct(ix.changePct)}</span>
          )}
        </span>
      ))}
      {st?.fearGreed && (
        <span className="inline-flex items-center gap-1.5 text-muted" title="Fear & Greed pentru acțiuni (CNN)">
          <Activity size={14} aria-hidden className="text-accent" />
          F&amp;G acțiuni <span className="num font-semibold text-text">{st.fearGreed.value}</span> {fngRo(st.fearGreed.rating)}
        </span>
      )}
    </Ticker>
  );
}
