// The Today page as a cockpit (FD-REDESIGN): one screen of tiles at 1440 × 900, fewer columns below.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { clsx } from 'clsx';
import type { CalendarResponse, DaySentiment, HistoryPoint, MarketContext, NewsPage, ScanResult, ScanRow, WatchItem } from '../../shared/api-types.ts';
import { dayBounds, dayKey, type Timeframe } from '../../shared/time.ts';
import { INDEX_DELAY_NOTE, plainSymbol } from '../../shared/indices.ts';
import { SCANNER_TFS } from '../../shared/settings.ts';
import { api, errorMessage, qs } from '../api.ts';
import { confidenceLabel, fmtAgo, fmtCountdown, fmtDate, fmtPct, fmtPrice, fmtTime, fmtWeekday, indexLabel, indexTone, type Tone } from '../format.ts';
import { useNextHighImpact, useNow, useSaveSettings, useSettings, useStockSet, useTz, useWatchlist } from '../hooks.ts';
import { Sparkline, useSparks, useStockQuotes, useStockSparks } from '../components/MarketStrip.tsx';
import { chartPathOf } from '../chart/paths.ts';
import { byDay, chartScale, cnnDay, cryptoDay, daySlots, fearGreedLabel, joined, segments } from '../history-chart.ts';
import { sparkChange } from '../spark.ts';
import { ErrorNote, fmtScore, Loading } from '../components/ui.tsx';
import { CoinLogo, EventIcon, TopicIcon } from '../components/icons.tsx';
import { aiNameOf, ScoreWhy } from '../components/ScoreWhy.tsx';
import { effectLine, weighLine } from '../why-text.ts';
import { IndexExplain } from '../components/IndexExplain.tsx';
import { CalendarClock, Flame, Gauge, History, Radio, TrendingDown, TrendingUp, type LucideIcon } from 'lucide-react';

const HOUR = 3_600_000;
const TONE_TEXT: Record<Tone, string> = { bull: 'text-bull', bear: 'text-bear', neutral: 'text-text' };
const SCORE_TEXT = (s: number) => (s > 0.2 ? 'text-bull' : s < -0.2 ? 'text-bear' : 'text-muted');

function useSentiment() {
  return useQuery({ queryKey: ['sentiment', 'today'], queryFn: () => api.get<DaySentiment>('/api/sentiment/today'), refetchInterval: 60_000 });
}

/** Width of an element, kept up to date (so SVG text stays at its real size on every screen). */
function useWidth<T extends HTMLElement>(fallback: number): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry?.contentRect.width ?? 0);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

function Tile({
  label,
  labelId,
  icon: Icon,
  actions,
  className,
  children,
  accent,
  onLabel,
  labelHint,
}: {
  label: string;
  labelId: string;
  icon: LucideIcon;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
  accent?: boolean;
  /** The title itself opens something (FD-WHYPLAIN §2: "Sentimentul zilei" opens how it was computed). */
  onLabel?: () => void;
  /** What the title opens, said on hover and to screen readers. */
  labelHint?: string;
}) {
  return (
    <section aria-labelledby={labelId} className={clsx('panel flex min-w-0 flex-col gap-3 px-5 py-4', accent && 'border-accent-dim/60', className)}>
      {/* A title that opens something sits above what follows: the sentiment's big figure (tight lines) reaches up over
          the title row with its text box, and took the pointer coming from below. */}
      <div className={clsx('flex flex-wrap items-center justify-between gap-x-3 gap-y-1', onLabel && 'relative z-[1]')}>
        <h2 id={labelId} className="panel-title inline-flex items-center gap-2">
          <Icon size={15} strokeWidth={1.9} className="shrink-0 text-faint" aria-hidden />
          {onLabel ? (
            // A link on the title: dotted underline so it reads as one on a touch screen too (no hover there).
            <button
              type="button"
              onClick={onLabel}
              aria-haspopup="dialog"
              title={labelHint}
              aria-description={labelHint}
              // A few px more above and below (same place on screen): the dotted underline is inside what takes the pointer.
              className="-my-1 cursor-pointer py-1 underline decoration-dotted underline-offset-4 transition-colors hover:text-accent hover:decoration-solid"
            >
              {label}
            </button>
          ) : (
            label
          )}
        </h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** 0–100 as a spectrum from very negative to very positive, with an accent marker at the index. */
function Spectrum({ index }: { index: number | null }) {
  return (
    <div className="flex flex-col gap-2">
      {/* From the theme's colours (FD-THEME): bear → neutral → bull, the in-betweens mixed. */}
      <div
        className="relative h-2.5 rounded-full"
        style={{
          background:
            'linear-gradient(90deg, var(--color-bear) 0%, color-mix(in oklab, var(--color-bear) 45%, var(--color-neutral-bar)) 25%, var(--color-neutral-bar) 50%, color-mix(in oklab, var(--color-bull) 45%, var(--color-neutral-bar)) 75%, var(--color-bull) 100%)',
        }}
      >
        {index !== null && (
          <span
            className="absolute -top-1.5 h-[22px] w-1 -translate-x-1/2 rounded-sm bg-accent shadow-[0_0_0_3px_var(--color-panel)]"
            style={{ left: `${Math.min(100, Math.max(0, index))}%` }}
            aria-hidden
          />
        )}
      </div>
      <div className="flex justify-between text-[11.5px] text-faint" aria-hidden>
        <span>Foarte negativ</span>
        <span className="@max-sm:hidden">Negativ</span>
        <span>Neutru</span>
        <span className="@max-sm:hidden">Pozitiv</span>
        <span>Foarte pozitiv</span>
      </div>
    </div>
  );
}

/** The day hour by hour: an accent line over a soft area; the scale zooms in but always shows 50. */
function DayChart({ s, tz }: { s: DaySentiment; tz: string }) {
  const [box, W] = useWidth<HTMLDivElement>(640);
  const H = 120;
  const { start, end } = dayBounds(s.day, tz);
  const pts = [{ t: start, index: 50 }, ...s.intraday];
  const values = pts.map((p) => p.index);
  // Zoom to the day's range (at least 45–55, so 50 is always visible), with a little headroom.
  const lo = Math.max(0, Math.floor(Math.min(45, ...values) - 3));
  const hi = Math.min(100, Math.ceil(Math.max(55, ...values) + 3));
  const x = (t: number) => ((t - start) / (end - start)) * W;
  const y = (v: number) => 4 + (1 - (v - lo) / (hi - lo)) * (H - 8);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p.index).toFixed(1)}`).join('');
  const last = pts.at(-1) as { t: number; index: number };
  const area = `${line}L${x(last.t).toFixed(1)} ${H}L0 ${H}Z`;
  const ticks = [0, 6, 12, 18, 24].map((h) => start + h * HOUR);
  return (
    <div ref={box} className="w-full">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block max-w-full" role="img" aria-label={`Sentimentul pe ore azi, acum ${s.index.toFixed(1)}`}>
        <defs>
          <linearGradient id="day-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--color-accent)" stopOpacity="0.22" />
            <stop offset="1" stopColor="var(--color-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1={0} x2={W} y1={y(50)} y2={y(50)} stroke="var(--color-line-strong)" strokeDasharray="3 5" />
        <text x={W - 2} y={y(50) - 5} textAnchor="end" fontSize="10.5" fill="var(--color-faint)" fontFamily="var(--font-mono)">
          50
        </text>
        <path d={area} fill="url(#day-area)" />
        <path d={line} fill="none" stroke="var(--color-accent)" strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(last.t)} cy={y(last.index)} r={4} fill="var(--color-accent)" stroke="var(--color-panel)" strokeWidth={2} />
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-faint" aria-hidden>
        {ticks.map((t, i) => (
          <span key={t} className="num">
            {i === ticks.length - 1 ? '24:00' : fmtTime(t, tz)}
          </span>
        ))}
      </div>
    </div>
  );
}

function SentimentTile() {
  const tz = useTz();
  const q = useSentiment();
  const [explain, setExplain] = useState(false);
  const closeExplain = useCallback(() => setExplain(false), []);
  const s = q.data;
  const scored = s ? s.counts.positive + s.counts.neutral + s.counts.negative : 0;
  // Change over the last hour, from the hourly points.
  const last = s?.intraday.at(-1);
  const hourAgo = last ? [...(s?.intraday ?? [])].reverse().find((p) => p.t <= last.t - HOUR) : undefined;
  const delta = last && hourAgo ? last.index - hourAgo.index : null;
  return (
    <Tile
      label="Sentimentul zilei"
      labelId="tile-sentiment"
      icon={Gauge}
      // FD-WHYPLAIN §2: the title opens how the index was computed (once there is a day to explain).
      onLabel={s ? () => setExplain(true) : undefined}
      labelHint="Cum s-a calculat sentimentul zilei"
      // From 768 px: the left column, as tall as the two tiles beside it (FD-TODAYGRID §2). A container: its parts follow its width.
      className="@container gap-4 px-6 py-5 md:row-span-2 xl:col-span-7"
      actions={
        s ? (
          <span className="text-right text-[12.5px] text-faint">
            {scored ? (
              <>
                {scored} știri, {confidenceLabel[s.confidence]}: <span className="text-bull">{s.counts.positive}</span> / <span className="text-muted">{s.counts.neutral}</span> /{' '}
                <span className="text-bear">{s.counts.negative}</span>
              </>
            ) : (
              'încă nu sunt știri analizate azi'
            )}
          </span>
        ) : null
      }
    >
      {!s && !q.isError ? (
        <Loading />
      ) : !s ? (
        <ErrorNote error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
            <span className={clsx('num-display text-[clamp(72px,8vw,104px)] leading-[0.85] font-semibold', TONE_TEXT[indexTone(s.index)])}>{s.index.toFixed(1)}</span>
            <div className="flex flex-col gap-1 pb-1.5">
              <span className="text-[24px] font-semibold tracking-[-0.02em]">{indexLabel(s.index)}</span>
              {delta !== null && (
                <span className="text-[13px] text-muted">
                  <span className={clsx('num', delta > 0 ? 'text-bull' : delta < 0 ? 'text-bear' : 'text-muted')}>
                    {delta > 0 ? '+' : delta < 0 ? '−' : '±'}
                    {Math.abs(delta).toFixed(1)}
                  </span>{' '}
                  față de acum o oră
                </span>
              )}
            </div>
          </div>
          <Spectrum index={scored ? s.index : null} />
          <DayChart s={s} tz={tz} />
          <div className="grid grid-cols-2 gap-2 @lg:grid-cols-4 @lg:gap-2.5">
            {(
              [
                ['Crypto', s.breakdown.crypto],
                // Days saved before FD-SENTIQ have no stocks part.
                ['Acțiuni', s.breakdown.stocks ?? { index: 50, raw: 0, weight: 0, count: 0 }],
                ['Macro', s.breakdown.macro],
                ['Geopolitică', s.breakdown.geopolitics],
              ] as const
            ).map(([label, b]) => (
              <div key={label} className="min-w-0 rounded-xl border border-line-soft bg-panel-2 px-3 py-2.5 sm:px-3.5">
                <div className="truncate text-[12px] text-muted">
                  {label}
                  <span className="@max-sm:hidden">, {b.count} știri</span>
                </div>
                <div className={clsx('num-display mt-0.5 text-[22px] font-semibold', b.count ? TONE_TEXT[indexTone(b.index)] : 'text-faint')}>{b.count ? b.index.toFixed(1) : '—'}</div>
              </div>
            ))}
          </div>
          {s.counts.pending > 0 && <span className="text-[12.5px] text-faint">{s.counts.pending} știri încă în analiză</span>}
          {explain && <IndexExplain onClose={closeExplain} />}
        </>
      )}
    </Tile>
  );
}

function NextEventTile() {
  const tz = useTz();
  const now = useNow(1000);
  const next = useNextHighImpact(now);
  const calendar = useSettings().data?.calendar;
  const currencies = calendar?.currencies;
  const earnings = calendar?.earnings === false ? '0' : '1';
  const { start, end } = dayBounds(dayKey(now, tz), tz);
  const today = useQuery({
    queryKey: ['calendar', 'today', start, currencies?.join(), earnings],
    queryFn: () => api.get<CalendarResponse>(`/api/calendar${qs({ from: start, to: end, impact: 'High,Medium', currencies, earnings })}`),
    refetchInterval: 60_000,
    enabled: currencies !== undefined,
  });
  const events = today.data?.events ?? [];
  const left = events.filter((e) => e.allDay || e.ts > now);
  return (
    <Tile label="Următorul eveniment major" labelId="tile-next" icon={CalendarClock} accent={Boolean(next)} className="xl:col-span-5" actions={<Link to="/calendar" className="link-accent">Calendar</Link>}>
      {next ? (
        <>
          <div className="flex items-center gap-2.5">
            <EventIcon title={next.title} impact={next.impact} source={next.source} size={20} className="text-impact-high" />
            <span className="text-[20px] font-semibold tracking-[-0.02em]">
              {next.currency === 'ALL' ? 'Global' : next.currency} {next.title}
            </span>
          </div>
          <div className={clsx('num text-[36px] leading-none tracking-[-0.03em]', next.ts - now < 15 * 60_000 ? 'text-warn' : 'text-accent')}>
            {next.ts <= now ? 'acum' : fmtCountdown(next.ts, now)}
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-muted">
            <span>
              {fmtWeekday(next.ts, tz)}, <span className="num">{fmtTime(next.ts, tz)}</span>
            </span>
            {next.forecast && (
              <span>
                Prognoză <span className="num text-text">{next.forecast}</span>
              </span>
            )}
            {next.previous && (
              <span>
                Anterior <span className="num text-text">{next.previous}</span>
              </span>
            )}
          </div>
        </>
      ) : (
        <p className="text-[13.5px] text-muted">Niciun eveniment cu impact mare în următoarele 8 zile pentru valutele alese.</p>
      )}
      <div className="mt-auto border-t border-line-soft pt-3 text-[12.5px]">
        {today.isError ? (
          <span className="text-faint">Calendarul zilei nu s-a putut încărca.</span>
        ) : !today.data ? (
          <span className="text-faint">Se încarcă calendarul zilei…</span>
        ) : events.length === 0 ? (
          <span className="text-faint">Azi nu sunt evenimente macro importante. O zi „curată” pentru analiza tehnică.</span>
        ) : (
          <>
            <div className="mb-1.5 text-faint">
              Azi: {events.length} {events.length === 1 ? 'eveniment important' : 'evenimente importante'}
              {left.length === 0 ? ', toate au trecut' : ''}
            </div>
            <ul className="flex flex-col gap-1">
              {(left.length ? left : events).slice(0, 3).map((e) => (
                <li key={e.id} className={clsx('grid grid-cols-[44px_14px_minmax(0,1fr)_auto] items-center gap-2.5', e.ts <= now && !e.allDay && 'text-muted')}>
                  <span className="num text-faint">{e.allDay ? 'ziua' : fmtTime(e.ts, tz)}</span>
                  <EventIcon title={e.title} impact={e.impact} source={e.source} size={14} className={e.impact === 'High' ? 'text-impact-high' : 'text-impact-medium'} />
                  <span className="truncate">
                    {e.currency === 'ALL' ? 'Global' : e.currency} {e.title}
                  </span>
                  <span className="num text-right">
                    {e.actual ? (
                      <span className={clsx('font-semibold', e.deviation === null ? '' : e.deviation > 0 ? 'text-link' : e.deviation < 0 ? 'text-warn' : '')}>{e.actual}</span>
                    ) : e.ts > now ? (
                      <span className="text-accent">{fmtCountdown(e.ts, now)}</span>
                    ) : (
                      <span className="text-faint">{now - e.ts < 15 * 60_000 && e.forecast ? 'în așteptare' : '—'}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            {(left.length ? left : events).length > 3 && (
              <Link to="/calendar" className="link-accent mt-1.5 inline-block">
                încă {(left.length ? left : events).length - 3} în calendar
              </Link>
            )}
          </>
        )}
      </div>
    </Tile>
  );
}

function LiveNewsTile() {
  const stocks = useStockSet();
  const tz = useTz();
  const q = useQuery({ queryKey: ['news', 'live'], queryFn: () => api.get<NewsPage>('/api/news?limit=5'), refetchInterval: 60_000 });
  return (
    <Tile
      label="Știri live"
      labelId="tile-live"
      icon={Radio}
      className="xl:col-span-5"
      actions={
        <Link to="/news" className="link-accent">
          Toate
        </Link>
      }
    >
      {!q.data && !q.isError ? (
        <Loading />
      ) : !q.data ? (
        <ErrorNote error={q.error} />
      ) : q.data.items.length === 0 ? (
        <p className="text-[13.5px] text-faint">Nicio știre în ultimele 24 h.</p>
      ) : (
        <ul className="rows -mx-5 -mt-1 divide-y divide-line-soft">
          {q.data.items.map((n) => (
            <li key={n.clusterId} className="grid grid-cols-[44px_16px_minmax(0,1fr)_48px] items-center gap-2.5 px-5 py-2 text-[13px]">
              <span className="num text-faint">{fmtTime(n.publishedAt, tz)}</span>
              <TopicIcon title={n.title} summary={n.summary} category={n.category} coins={n.coins} size={16} stocks={stocks} />
              {n.url ? (
                <a href={n.url} target="_blank" rel="noopener noreferrer" className="truncate text-text" title={`${n.title} (${n.source.name})`}>
                  {n.title}
                </a>
              ) : (
                <span className="truncate" title={n.title}>
                  {n.title}
                </span>
              )}
              <span className={clsx('num text-right', n.sentiment ? SCORE_TEXT(n.sentiment.score) : 'text-faint')}>{n.sentiment ? fmtScore(n.sentiment.score) : '…'}</span>
            </li>
          ))}
        </ul>
      )}
    </Tile>
  );
}

function signalLine(r: ScanRow, tz: string) {
  const s = r.lastSignal;
  if (!s) return <span className="text-faint">fără semnal</span>;
  // FD-SLINGSHOT34: the side of the last signal (LONG, or SHORT with Short Signals on).
  const side = s.side === 'short' ? 'SHORT' : 'LONG';
  const outcome: Record<string, [string, string]> = { active: ['activ', 'text-text'], tp: ['TP atins', 'text-bull'], sl: ['SL atins', 'text-bear'], invalidated: ['invalidat', 'text-bear'] };
  const [label, cls] = outcome[s.outcome] ?? [s.outcome, 'text-text'];
  return (
    <span title={`${side} ${fmtDate(s.time, tz)}, ${fmtAgo(s.time)}`}>
      {side} {fmtDate(s.time, tz)}, <span className={cls}>{label}</span>
      {s.provisional ? ', neconfirmat' : ''}
    </span>
  );
}

function ScanLines({ r, digits, tf }: { r: ScanRow | undefined; digits: number; tf: string }) {
  const tz = useTz();
  if (r && !r.ok) return <span className="text-[12px] text-bear">{r.error}</span>;
  if (!r) return <span className="text-[12px] text-faint">Slingshot pe {tf}: se calculează…</span>;
  return (
    <div className="flex flex-col gap-0.5 text-[12px] text-muted">
      <div className="flex justify-between gap-2">
        {signalLine(r, tz)}
        {r.ms?.lastBreak && <span className={r.ms.lastBreak.type === 'msBullish' ? 'text-bull' : 'text-bear'}>{r.ms.lastBreak.type === 'msBullish' ? 'Bullish' : 'Bearish'}</span>}
      </div>
      {/* FD-SLINGSHOT34: each side's TP/SL, the LONG's first; the two sides are independent. */}
      {[r.atr, r.atrShort].map(
        (a) =>
          a && (
            <span key={a.side} className="num">
              {a.side === 'short' && 'SHORT · '}TP <span className="text-bull">{fmtPrice(a.tp, digits)}</span> SL <span className="text-bear">{fmtPrice(a.sl, digits)}</span>
            </span>
          ),
      )}
      {r.liveSignal && <span className="text-bull">LONG în formare</span>}
      {r.liveShortSignal && <span className="text-bear">SHORT în formare</span>}
      {/* A stock without the Twelve Data key is scanned on daily candles (FD-SENTIQ §4.6). */}
      {r.warnings?.includes('STOCK_TF_FALLBACK') && <span className="text-faint">Slingshot pe {r.tf} (sursa nu are {tf})</span>}
    </div>
  );
}

/** FD-MARKETSRC §2: the timeframe of the Slingshot signals on the cards, chosen here where they are seen. */
function SignalTimeframe({ tf }: { tf: Timeframe }) {
  const save = useSaveSettings();
  // A timeframe saved before (e.g. 30m) stays on the switch until another one is chosen.
  const options: Timeframe[] = (SCANNER_TFS as readonly Timeframe[]).includes(tf) ? [...SCANNER_TFS] : [...SCANNER_TFS, tf];
  return (
    <div className="flex flex-wrap items-center justify-end gap-2.5 text-[12.5px] text-muted">
      <span id="signal-tf">Semnale Slingshot pe</span>
      <div className="seg" role="group" aria-labelledby="signal-tf">
        {options.map((t) => (
          <button key={t} type="button" aria-pressed={t === tf} disabled={save.isPending} onClick={() => t !== tf && save.mutate({ scanner: { tf: t } })}>
            {t}
          </button>
        ))}
      </div>
      {save.error && <span className="text-bear">{errorMessage(save.error)}</span>}
    </div>
  );
}

/** The Slingshot trend on a card (FD-UIPOLISH): an arrow, green up or red down; the word in its tooltip and label. */
function TrendArrow({ up }: { up: boolean }) {
  const label = up ? 'Uptrend (Slingshot)' : 'Downtrend (Slingshot)';
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={clsx('inline-flex shrink-0', up ? 'text-bull' : 'text-bear')} title={label} role="img" aria-label={label}>
      <Icon size={18} strokeWidth={2.2} aria-hidden />
    </span>
  );
}

function CoinsTile() {
  const settings = useSettings();
  const watchlist = useWatchlist();
  const all = watchlist.data ?? [];
  // Shares and indices (FD-INDICES) share the stock card and its data; everything else is a coin.
  const coins = all.filter((w) => w.kind === 'crypto');
  const stocks = all.filter((w) => w.kind !== 'crypto');
  const sparks = useSparks(coins.map((w) => `${w.coin}/${w.quote}`));
  const stockSymbols = stocks.map((w) => w.coin);
  const quotes = useStockQuotes(stockSymbols);
  const stockSparks = useStockSparks(stockSymbols);
  const scan = useQuery({ queryKey: ['scanner'], queryFn: () => api.get<ScanResult | { computedAt: null; rows: [] }>('/api/scanner'), refetchInterval: 60_000 });
  const rows = new Map(scan.data?.rows.map((r) => [r.symbol, r]) ?? []);
  const tf = settings.data?.scanner.tf ?? '1h';
  const card = 'panel flex flex-col gap-2 px-5 py-4 text-text no-underline transition-colors hover:border-accent hover:bg-hover-soft hover:no-underline';
  const coinCard = (w: WatchItem, i: number) => {
    const sym = `${w.coin}/${w.quote}`;
    const r = rows.get(sym);
    const spark = sparks[i]?.data;
    const closes = spark?.closes ?? [];
    const digits = r?.pricePrecision ?? spark?.precision ?? 2;
    const price = r?.price ?? closes.at(-1);
    // Until the scanner has run, the 24 h change comes from the hourly closes.
    const change = r?.change24h ?? (closes.length >= 25 ? sparkChange(closes.slice(-25)) : null);
    return (
      <Link key={sym} to={`/charts/${w.coin}/${w.quote}`} className={card}>
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex min-w-0 items-center gap-2 text-[15px] font-semibold">
            <CoinLogo coin={w.coin} size={22} />
            <span className="truncate">
              {w.coin}
              <span className="font-normal text-faint">/{w.quote}</span>
            </span>
          </span>
          {r?.ok && <TrendArrow up={Boolean(r.uptrend)} />}
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="num text-[20px] tracking-[-0.02em]">{price !== undefined ? fmtPrice(price, digits) : '…'}</span>
          {change !== null && <span className={clsx('num text-[12.5px]', change >= 0 ? 'text-bull' : 'text-bear')}>{fmtPct(change)}</span>}
        </div>
        <Sparkline values={closes} width={200} height={40} className="h-10 w-full" change={change} />
        <ScanLines r={r} digits={digits} tf={tf} />
      </Link>
    );
  };
  const stockCard = (w: WatchItem, i: number) => {
    const r = rows.get(`${w.coin}/USD`);
    const q = quotes.data?.get(w.coin);
    const closes = stockSparks[i]?.data ?? [];
    const price = q?.last ?? r?.price ?? closes.at(-1);
    const digits = r?.pricePrecision ?? (price !== undefined && price < 1 ? 4 : 2);
    // The day's change, as brokers show it (the 60-day line is the context).
    const change = q?.changePct ?? null;
    const closed = q?.status ? /closed/i.test(q.status) : false;
    return (
      <Link key={`stock:${w.coin}`} to={chartPathOf(w)} className={card}>
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex min-w-0 items-center gap-2 text-[15px] font-semibold">
            <CoinLogo coin={w.coin} size={22} badge square />
            <span className="shrink-0">{plainSymbol(w.coin)}</span>
            {w.name && <span className="truncate text-[12.5px] font-normal text-faint">{w.name}</span>}
          </span>
          {r?.ok && <TrendArrow up={Boolean(r.uptrend)} />}
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="num text-[20px] tracking-[-0.02em]" title={w.kind === 'index' && q?.delayed ? INDEX_DELAY_NOTE : undefined}>
            {price !== undefined ? fmtPrice(price, digits) : q?.error ? '—' : '…'}
          </span>
          <span className="flex items-baseline gap-2">
            {closed && <span className="text-[11.5px] text-faint">închis</span>}
            {change !== null && <span className={clsx('num text-[12.5px]', change >= 0 ? 'text-bull' : 'text-bear')}>{fmtPct(change)}</span>}
          </span>
        </div>
        <Sparkline values={closes} width={200} height={40} className="h-10 w-full" change={change} />
        <ScanLines r={r} digits={digits} tf={tf} />
      </Link>
    );
  };
  return (
    <section aria-labelledby="tile-coins" className="flex min-w-0 flex-col gap-2 md:col-span-2 xl:col-span-12">
      <h2 id="tile-coins" className="sr-only">
        Simbolurile urmărite
      </h2>
      {all.length > 0 && <SignalTimeframe tf={tf} />}
      {watchlist.data && all.length === 0 ? (
        <div className="panel flex h-full flex-col items-start justify-center gap-3 px-5 py-4 text-[13.5px] text-muted">
          Nu urmărești încă nicio monedă sau acțiune.
          <Link to="/watchlists" className="btn">
            Adaugă simboluri
          </Link>
        </div>
      ) : (
        <div className="grid h-full grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3.5">
          {/* In the common order of the watch lists (FD-WATCHLISTS §6), coins and stocks mixed. */}
          {all.map((w) => (w.kind !== 'crypto' ? stockCard(w, stockSymbols.indexOf(w.coin)) : coinCard(w, coins.indexOf(w))))}
        </div>
      )}
    </section>
  );
}

function DriversTile() {
  const stocks = useStockSet();
  const q = useSentiment();
  const [all, setAll] = useState(false);
  const d = q.data?.drivers;
  const total = d ? d.positive.length + d.negative.length : 0;
  const counted = q.data ? q.data.counts.positive + q.data.counts.neutral + q.data.counts.negative : 0;
  // Two strongest each way by default; "Arată toate" lists every driver of the day.
  const list = d ? [...d.positive.slice(0, all ? undefined : 2), ...d.negative.slice(0, all ? undefined : 2)] : [];
  return (
    <Tile
      label="Ce mișcă piața"
      labelId="tile-drivers"
      icon={Flame}
      className="xl:col-span-7"
      actions={
        total > 4 ? (
          <button type="button" className="link-accent" onClick={() => setAll((a) => !a)} aria-expanded={all}>
            {all ? 'Mai puține' : `Arată toate (${total})`}
          </button>
        ) : null
      }
    >
      {!q.data && !q.isError ? (
        <Loading />
      ) : list.length === 0 ? (
        <p className="text-[13px] text-faint">Nimic notabil încă.</p>
      ) : (
        <>
        {/* FD-WHYPLAIN: why these and not others. */}
        <p className="-mt-1 text-[12.5px] text-faint">
          Din cele {counted} știri de azi: cele care au împins indicele cel mai mult în sus și cele care l-au tras cel mai mult în jos (pondere × scor).
        </p>
        <ul className="flex flex-col gap-2.5">
          {list.map((x) => (
            <li key={x.id} className="grid grid-cols-[16px_46px_minmax(0,1fr)] gap-2.5 text-[13px] leading-snug">
              <span className="pt-px">
                <TopicIcon title={x.title} category={x.category} coins={x.coins} size={16} stocks={stocks} />
              </span>
              <span className={clsx('num', SCORE_TEXT(x.sentiment))}>{fmtScore(x.sentiment)}</span>
              <div className="flex min-w-0 flex-col gap-0.5">
                {x.url ? (
                  <a href={x.url} target="_blank" rel="noopener noreferrer" className="line-clamp-2 text-text" title={`${x.source}, ${fmtAgo(x.publishedAt)}`}>
                    {x.title}
                  </a>
                ) : (
                  <span className="line-clamp-2">{x.title}</span>
                )}
                {/* FD-WHYPLAIN: how much it moved the index, always in sight; why it weighs that much, with its score's why. */}
                {x.effect !== undefined && x.without !== undefined && q.data && <span className="text-[12px] text-muted">{effectLine(q.data.index, x.without, x.effect)}</span>}
                <ScoreWhy why={x.why ?? null}>
                  {x.weighs && <div>{weighLine(x.weighs, counted, x.source, x.publishedAt, Date.now(), x.why?.impactSource === 'ai' ? aiNameOf(x.why.engine) : 'cuvinte-cheie')}</div>}
                </ScoreWhy>
              </div>
            </li>
          ))}
        </ul>
        </>
      )}
    </Tile>
  );
}

type SeriesKey = 'sentiq' | 'crypto' | 'cnn';
/** FD-HISTORYCHART: the three lines, all 0–100. */
const SERIES: Record<SeriesKey, { label: string; source: string; color: string; width: number; dash?: string }> = {
  sentiq: { label: 'Sentiq', source: 'Sentimentul zilei, din știri', color: 'var(--color-accent)', width: 2.25 },
  crypto: { label: 'Crypto F&G', source: 'Fear & Greed crypto (alternative.me)', color: 'var(--color-link)', width: 1.5 },
  // CNN's index is the US stock market's only (S&P 500, NYSE highs / lows, VIX, put / call, junk bonds…): not global.
  cnn: { label: 'Stocks F&G', source: 'Fear & Greed al bursei americane (CNN)', color: 'var(--color-muted)', width: 1.5, dash: '4 4' },
};
const SERIES_KEYS: SeriesKey[] = ['sentiq', 'crypto', 'cnn'];

/** Width and height of an element, kept up to date. */
function useSize<T extends HTMLElement>(fallback: { w: number; h: number }): [React.RefObject<T | null>, { w: number; h: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry?.contentRect.width ?? 0);
      const h = Math.round(entry?.contentRect.height ?? 0);
      if (w > 0 && h > 0) setSize((was) => (was.w === w && was.h === h ? was : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

/** "20 oct." for a day key. */
const dayLabel = (day: string) => fmtDate(Date.parse(`${day}T12:00:00Z`), 'UTC');

function HistoryTile() {
  const tz = useTz();
  const q = useQuery({ queryKey: ['sentiment', 'history'], queryFn: () => api.get<{ tz: string; points: HistoryPoint[] }>('/api/sentiment/history?days=30'), refetchInterval: 10 * 60_000 });
  // The same query as the market strip (one request for both).
  const ctx = useQuery({ queryKey: ['market', 'context'], queryFn: () => api.get<MarketContext>('/api/market/context'), refetchInterval: 10 * 60_000 });
  const [hidden, setHidden] = useState<ReadonlySet<SeriesKey>>(new Set());
  const [hover, setHover] = useState<number | null>(null);
  const [box, size] = useSize<HTMLDivElement>({ w: 420, h: 160 });
  // Today as on the card (the live index): the history has it only from its last save, which can still be yesterday's.
  const live = useSentiment().data;
  const tip = useRef<HTMLDivElement>(null);
  const [tipW, setTipW] = useState(0);
  const DAYS = 30;
  const saved = q.data?.points ?? [];
  // One fixed slot per calendar day (oldest left), so missing days stay visible as gaps.
  const today = dayKey(Date.now(), tz);
  const slots = daySlots(today, DAYS);
  const inSlots = new Set(slots);
  const pts: HistoryPoint[] =
    live && live.day === today
      ? [...saved.filter((p) => p.day !== today), { day: today, index: live.index, confidence: live.confidence, count: live.counts.positive + live.counts.neutral + live.counts.negative, final: false }]
      : saved;
  const point = new Map(pts.map((p) => [p.day, p]));
  const fg = ctx.data?.fearGreed;
  const cnnFg = ctx.data?.stocks?.fearGreed;
  const series: Record<SeriesKey, Map<string, number>> = {
    sentiq: byDay(pts, (p) => p.day, (p) => p.index),
    crypto: fg ? byDay(fg.history, (h) => cryptoDay(h.timestamp), (h) => h.value) : new Map(),
    cnn: cnnFg ? byDay(cnnFg.history, (h) => cnnDay(h.timestamp), (h) => h.value) : new Map(),
  };
  // Fear & Greed only when it has days in these 30; Sentiq always (its note says when it has none yet).
  const available = SERIES_KEYS.filter((k) => k === 'sentiq' || [...series[k].keys()].some((d) => inSlots.has(d)));
  const shown = available.filter((k) => !hidden.has(k));
  const values = shown.flatMap((k) => slots.flatMap((d) => (series[k].has(d) ? [series[k].get(d) as number] : [])));
  const { lo, hi } = chartScale(values);
  const W = size.w;
  const H = size.h;
  // A gutter on the right for the scale's labels (top, 50, bottom), off the lines.
  const GUTTER = 24;
  const PW = Math.max(1, W - GUTTER);
  const slotW = PW / DAYS;
  const x = (i: number) => (i + 0.5) * slotW;
  const y = (v: number) => 6 + (1 - (v - lo) / (hi - lo)) * (H - 12);
  const path = (run: { i: number; v: number }[]) => run.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)} ${y(p.v).toFixed(1)}`).join('');
  const latest: Record<SeriesKey, number | undefined> = { sentiq: series.sentiq.get(today), crypto: fg?.value, cnn: cnnFg?.value };
  const fmtValue = (k: SeriesKey, v: number) => (k === 'sentiq' ? v.toFixed(1) : String(Math.round(v)));
  const toggle = (k: SeriesKey) =>
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(k)) next.delete(k);
      // The last line shown stays.
      else if (shown.length > 1) next.add(k);
      return next;
    });
  const pick = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setHover(Math.min(DAYS - 1, Math.max(0, Math.floor(((e.clientX - r.left) / Math.max(1, r.width - GUTTER)) * DAYS))));
  };
  const hoverDay = hover !== null ? slots[hover] : undefined;
  useLayoutEffect(() => setTipW(tip.current?.offsetWidth ?? 0), [hover, W]);
  // Beside the day's line, on the side with room; never out of the tile (a phone has room on neither side).
  const tipLeft = hover === null ? 0 : (() => {
    const right = x(hover) + 8;
    const left = x(hover) - 8 - tipW;
    const want = right + tipW <= W - 4 ? right : left >= 4 ? left : W - tipW - 4;
    return Math.max(4, Math.min(want, W - tipW - 4));
  })();
  const sentiqValues = slots.flatMap((d) => (series.sentiq.has(d) ? [series.sentiq.get(d) as number] : []));
  const summary = [
    sentiqValues.length
      ? `Sentiq în ultimele 30 de zile: între ${Math.min(...sentiqValues).toFixed(1)} și ${Math.max(...sentiqValues).toFixed(1)}${latest.sentiq !== undefined ? `, azi ${latest.sentiq.toFixed(1)}` : ''}`
      : 'Sentiq: încă fără istoric',
    ...(available.includes('crypto') && fg ? [`Fear & Greed crypto azi ${fg.value}`] : []),
    ...(available.includes('cnn') && cnnFg ? [`Fear & Greed al bursei americane (CNN) azi ${cnnFg.value}`] : []),
  ].join('; ');
  return (
    <Tile label="Ultimele 30 de zile" labelId="tile-history" icon={History} className="xl:col-span-5">
      {/* FD-HISTORYCHART: each line shown or hidden; today's value of each. */}
      <div className="-mt-1 flex flex-wrap gap-1.5" role="group" aria-label="Liniile graficului">
        {available.map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={!hidden.has(k)}
            title={SERIES[k].source}
            onClick={() => toggle(k)}
            className={clsx('inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[12px] transition-colors', hidden.has(k) ? 'border-line text-faint' : 'border-line-strong text-text')}
          >
            <svg width="14" height="6" aria-hidden className="shrink-0">
              <line x1="0" x2="14" y1="3" y2="3" stroke={SERIES[k].color} strokeWidth={k === 'sentiq' ? 2.5 : 1.75} strokeDasharray={SERIES[k].dash} opacity={hidden.has(k) ? 0.4 : 1} />
            </svg>
            {SERIES[k].label}
            {latest[k] !== undefined && <span className="num text-muted">{fmtValue(k, latest[k] as number)}</span>}
          </button>
        ))}
      </div>
      <div className="flex min-h-[160px] flex-1 flex-col gap-1">
        <div ref={box} className="relative min-h-[140px] flex-1 touch-pan-y" onPointerMove={pick} onPointerDown={pick} onPointerLeave={(e) => e.pointerType === 'mouse' && setHover(null)}>
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 block" role="img" aria-label={summary}>
            <line x1={0} x2={PW} y1={y(50)} y2={y(50)} stroke="var(--color-line-strong)" strokeDasharray="3 5" />
            {/* The scale: its ends and 50 (an end too close to 50 is left out). */}
            {[hi, 50, lo]
              .filter((v, k) => k === 1 || Math.abs(y(v) - y(50)) >= 14)
              .map((v) => (
                <text key={v} x={W - 2} y={y(v) + 3.5} textAnchor="end" fontSize="10.5" fill="var(--color-faint)" fontFamily="var(--font-mono)">
                  {v}
                </text>
              ))}
            {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={0} y2={H} stroke="var(--color-line-strong)" />}
            {shown.includes('cnn') && <path d={path(joined(slots, series.cnn))} fill="none" stroke={SERIES.cnn.color} strokeWidth={SERIES.cnn.width} strokeDasharray={SERIES.cnn.dash} strokeLinejoin="round" />}
            {shown.includes('crypto') && <path d={path(joined(slots, series.crypto))} fill="none" stroke={SERIES.crypto.color} strokeWidth={SERIES.crypto.width} strokeLinejoin="round" />}
            {shown.includes('sentiq') && (
              <>
                {segments(slots, series.sentiq).map((run) => (
                  <path key={run[0]?.i} d={path(run)} fill="none" stroke={SERIES.sentiq.color} strokeWidth={SERIES.sentiq.width} strokeLinejoin="round" strokeLinecap="round" />
                ))}
                {slots.map((d, i) => {
                  const p = point.get(d);
                  if (!p) return null;
                  // Today and the days not frozen yet: a hollow dot.
                  return <circle key={d} cx={x(i)} cy={y(p.index)} r={hover === i ? 4 : 2.75} fill={p.final ? SERIES.sentiq.color : 'var(--color-panel)'} stroke={SERIES.sentiq.color} strokeWidth={1.5} />;
                })}
              </>
            )}
          </svg>
          {hoverDay && (
            <div
              ref={tip}
              className="pointer-events-none absolute top-1 z-[1] flex max-w-[calc(100%-8px)] flex-col gap-0.5 rounded-lg border border-line-strong bg-panel-2 px-2.5 py-1.5 text-[12px] shadow-pop"
              style={{ left: tipLeft, visibility: tipW ? 'visible' : 'hidden' }}
            >
              <span className="font-medium text-text">{hoverDay === today ? `azi, ${dayLabel(hoverDay)}` : dayLabel(hoverDay)}</span>
              {available.map((k) => {
                const v = series[k].get(hoverDay);
                const p = k === 'sentiq' ? point.get(hoverDay) : undefined;
                return (
                  <span key={k} className="flex items-center gap-1.5 whitespace-nowrap text-muted">
                    <span className="inline-block size-2 rounded-full" style={{ background: SERIES[k].color }} aria-hidden />
                    {SERIES[k].label}{' '}
                    {v === undefined ? (
                      <span className="text-faint">—</span>
                    ) : (
                      <span className="num text-text">
                        {fmtValue(k, v)}
                        {k === 'sentiq' ? (p && !p.final ? ' (provizoriu)' : '') : `, ${fearGreedLabel(v, k)}`}
                      </span>
                    )}
                    {p && <span className="text-faint">· {p.count} știri</span>}
                  </span>
                );
              })}
            </div>
          )}
        </div>
        <div className="flex justify-between text-[11px] text-faint" aria-hidden>
          <span className="num">{dayLabel(slots[0] as string)}</span>
          <span className="num">{dayLabel(slots[Math.floor(DAYS / 2)] as string)}</span>
          <span>azi</span>
        </div>
      </div>
      {pts.length < 2 && <p className="text-[12px] text-faint">Istoricul Sentiq se construiește zi de zi; revino mâine.</p>}
    </Tile>
  );
}

export function TodayPage() {
  return (
    <div className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-12">
      <h1 className="sr-only">Azi</h1>
      <SentimentTile />
      <NextEventTile />
      <LiveNewsTile />
      {/* Above the favourites at every width, never beside them (FD-TODAYGRID): a long watchlist stretched them. */}
      <DriversTile />
      <HistoryTile />
      <CoinsTile />
    </div>
  );
}
