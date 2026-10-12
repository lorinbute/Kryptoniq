// The market strip under the top navigation (FD-REDESIGN): favourite coins with price, 24 h change and a
// 48 h sparkline, then the market context and the next high-impact event.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { clsx } from 'clsx';
import type { CandlesResult, MarketContext } from '../../shared/api-types.ts';
import { api, qs } from '../api.ts';
import { fmtCountdown, fmtPct, fmtPrice, fmtUsd } from '../format.ts';
import { useNextHighImpact, useNow, useSettings, useWatchlist } from '../hooks.ts';
import { sparkChange, sparkPath } from '../spark.ts';
import { CoinLogo, EventIcon } from './icons.tsx';
import { ChartPie, Gauge } from 'lucide-react';

const FNG_RO: Record<string, string> = { 'Extreme Fear': 'frică extremă', Fear: 'frică', Neutral: 'neutru', Greed: 'lăcomie', 'Extreme Greed': 'lăcomie extremă' };

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
    <div ref={box} className="ticker overflow-hidden border-b border-line-soft bg-ink-2" aria-label={label} role="region">
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
  const coins = watchlist.data ?? [];
  const sparks = useSparks(coins.map((w) => `${w.coin}/${w.quote}`));
  const ctx = useQuery({ queryKey: ['market', 'context'], queryFn: () => api.get<MarketContext>('/api/market/context'), refetchInterval: 10 * 60_000 });
  const next = useNextHighImpact(now);
  const fg = ctx.data?.fearGreed;
  const gl = ctx.data?.global;
  return (
    <Ticker label="Piața acum">
      {coins.map((w, i) => {
        const s = sparks[i]?.data;
        const failed = sparks[i]?.isError && !s;
        const closes = s?.closes ?? [];
        const last = closes.at(-1);
        // 24 h change from the hourly closes (the strip has no other price source).
        const change = closes.length >= 25 ? sparkChange(closes.slice(-25)) : null;
        return (
          <Link key={`${w.coin}/${w.quote}`} to={`/charts/${w.coin}/${w.quote}`} className="inline-flex items-center gap-2 text-text no-underline hover:no-underline">
            <CoinLogo coin={w.coin} size={16} />
            <span className="font-semibold">{w.coin}</span>
            <span className={clsx('num', failed && 'text-faint')} title={failed ? 'Prețul nu s-a putut încărca' : undefined}>
              {last !== undefined ? fmtPrice(last, s?.precision ?? 2) : failed ? '—' : '…'}
            </span>
            {change !== null && <span className={clsx('num', change >= 0 ? 'text-bull' : 'text-bear')}>{fmtPct(change)}</span>}
            <Sparkline values={closes} width={48} height={18} className="max-sm:hidden" change={change} />
          </Link>
        );
      })}
      {coins.length > 0 && <span className="h-4 w-px shrink-0 bg-line-strong" aria-hidden />}
      {next && (
        <Link to="/calendar" className="inline-flex items-center gap-2 text-text no-underline hover:no-underline" title="Următorul eveniment cu impact mare">
          <EventIcon title={next.title} impact={next.impact} source={next.source} className="text-impact-high" />
          <span>
            {next.currency === 'ALL' ? 'Global' : next.currency} {next.title}
          </span>
          <span className={clsx('num font-semibold', next.ts - now < 15 * 60_000 ? 'text-warn' : 'text-brass')}>{next.ts <= now ? 'acum' : fmtCountdown(next.ts, now)}</span>
        </Link>
      )}
      {next && <span className="h-4 w-px shrink-0 bg-line-strong" aria-hidden />}
      {fg && (
        <span className="inline-flex items-center gap-1.5 text-muted" title="Fear & Greed Index">
          <Gauge size={14} aria-hidden className="text-brass" />
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
    </Ticker>
  );
}
