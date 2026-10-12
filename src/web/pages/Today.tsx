// The Today page as a cockpit (FD-REDESIGN): one screen of tiles at 1440 × 900, fewer columns below.
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { clsx } from 'clsx';
import type { CalendarResponse, DaySentiment, HistoryPoint, NewsPage, ScanResult, ScanRow } from '../../shared/api-types.ts';
import { addDays, dayBounds, dayKey } from '../../shared/time.ts';
import { api, qs } from '../api.ts';
import { confidenceLabel, fmtAgo, fmtCountdown, fmtDate, fmtPct, fmtPrice, fmtTime, fmtWeekday, indexLabel, indexTone, type Tone } from '../format.ts';
import { useNextHighImpact, useNow, useSettings, useTz, useWatchlist } from '../hooks.ts';
import { Sparkline, useSparks } from '../components/MarketStrip.tsx';
import { sparkChange } from '../spark.ts';
import { ErrorNote, fmtScore, Loading } from '../components/ui.tsx';
import { CoinLogo, EventIcon, TopicIcon } from '../components/icons.tsx';
import { CalendarClock, Flame, Gauge, History, Radio, type LucideIcon } from 'lucide-react';

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
}: {
  label: string;
  labelId: string;
  icon: LucideIcon;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <section aria-labelledby={labelId} className={clsx('panel flex min-w-0 flex-col gap-3 px-5 py-4', accent && 'border-brass-dim/60', className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 id={labelId} className="panel-title inline-flex items-center gap-2">
          <Icon size={15} strokeWidth={1.9} className="shrink-0 text-faint" aria-hidden />
          {label}
        </h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** 0–100 as a spectrum from very negative to very positive, with a brass marker at the index. */
function Spectrum({ index }: { index: number | null }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="relative h-2.5 rounded-full" style={{ background: 'linear-gradient(90deg, #ff5d5d 0%, #8a4250 25%, #2b3346 50%, #2c6b58 75%, #3ddc97 100%)' }}>
        {index !== null && (
          <span
            className="absolute -top-1.5 h-[22px] w-1 -translate-x-1/2 rounded-sm bg-brass shadow-[0_0_0_3px_var(--color-panel)]"
            style={{ left: `${Math.min(100, Math.max(0, index))}%` }}
            aria-hidden
          />
        )}
      </div>
      <div className="flex justify-between text-[11.5px] text-faint" aria-hidden>
        <span>Foarte negativ</span>
        <span className="max-sm:hidden">Negativ</span>
        <span>Neutru</span>
        <span className="max-sm:hidden">Pozitiv</span>
        <span>Foarte pozitiv</span>
      </div>
    </div>
  );
}

/** The day hour by hour: brass line over a soft area; the scale zooms in but always shows 50. */
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
            <stop offset="0" stopColor="var(--color-brass)" stopOpacity="0.22" />
            <stop offset="1" stopColor="var(--color-brass)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1={0} x2={W} y1={y(50)} y2={y(50)} stroke="var(--color-line-strong)" strokeDasharray="3 5" />
        <text x={W - 2} y={y(50) - 5} textAnchor="end" fontSize="10.5" fill="var(--color-faint)" fontFamily="var(--font-mono)">
          50
        </text>
        <path d={area} fill="url(#day-area)" />
        <path d={line} fill="none" stroke="var(--color-brass)" strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(last.t)} cy={y(last.index)} r={4} fill="var(--color-brass)" stroke="var(--color-panel)" strokeWidth={2} />
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
      className="gap-4 px-6 py-5 xl:col-span-7 xl:row-span-2 md:col-span-2"
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
          <div className="grid grid-cols-3 gap-2 sm:gap-2.5">
            {(
              [
                ['Crypto', s.breakdown.crypto],
                ['Macro', s.breakdown.macro],
                ['Geopolitică', s.breakdown.geopolitics],
              ] as const
            ).map(([label, b]) => (
              <div key={label} className="min-w-0 rounded-xl bg-panel-2 px-3 py-2.5 sm:px-3.5">
                <div className="truncate text-[12px] text-muted">
                  {label}
                  <span className="max-sm:hidden">, {b.count} știri</span>
                </div>
                <div className={clsx('num-display mt-0.5 text-[22px] font-semibold', b.count ? TONE_TEXT[indexTone(b.index)] : 'text-faint')}>{b.count ? b.index.toFixed(1) : '—'}</div>
              </div>
            ))}
          </div>
          {s.counts.pending > 0 && <span className="text-[12.5px] text-faint">{s.counts.pending} știri încă în analiză</span>}
        </>
      )}
    </Tile>
  );
}

function NextEventTile() {
  const tz = useTz();
  const now = useNow(1000);
  const next = useNextHighImpact(now);
  const currencies = useSettings().data?.calendar.currencies;
  const { start, end } = dayBounds(dayKey(now, tz), tz);
  const today = useQuery({
    queryKey: ['calendar', 'today', start, currencies?.join()],
    queryFn: () => api.get<CalendarResponse>(`/api/calendar${qs({ from: start, to: end, impact: 'High,Medium', currencies })}`),
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
          <div className={clsx('num text-[36px] leading-none tracking-[-0.03em]', next.ts - now < 15 * 60_000 ? 'text-warn' : 'text-brass')}>
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
                      <span className="text-brass">{fmtCountdown(e.ts, now)}</span>
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
        <ul className="-mt-1 divide-y divide-line-soft">
          {q.data.items.map((n) => (
            <li key={n.clusterId} className="grid grid-cols-[44px_16px_minmax(0,1fr)_48px] items-center gap-2.5 py-2 text-[13px]">
              <span className="num text-faint">{fmtTime(n.publishedAt, tz)}</span>
              <TopicIcon title={n.title} summary={n.summary} category={n.category} coins={n.coins} size={16} />
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
  if (!s) return <span className="text-faint">fără semnal LONG</span>;
  const outcome: Record<string, [string, string]> = { active: ['activ', 'text-text'], tp: ['TP atins', 'text-bull'], sl: ['SL atins', 'text-bear'], invalidated: ['invalidat', 'text-bear'] };
  const [label, cls] = outcome[s.outcome] ?? [s.outcome, 'text-text'];
  return (
    <span title={`LONG ${fmtDate(s.time, tz)}, ${fmtAgo(s.time)}`}>
      LONG {fmtDate(s.time, tz)}, <span className={cls}>{label}</span>
      {s.provisional ? ', neconfirmat' : ''}
    </span>
  );
}

function CoinsTile() {
  const tz = useTz();
  const settings = useSettings();
  const watchlist = useWatchlist();
  const coins = watchlist.data ?? [];
  const sparks = useSparks(coins.map((w) => `${w.coin}/${w.quote}`));
  const scan = useQuery({ queryKey: ['scanner'], queryFn: () => api.get<ScanResult | { computedAt: null; rows: [] }>('/api/scanner'), refetchInterval: 60_000 });
  const rows = new Map(scan.data?.rows.map((r) => [r.symbol, r]) ?? []);
  const tf = settings.data?.scanner.tf ?? '1h';
  return (
    <section aria-labelledby="tile-coins" className="flex min-w-0 flex-col gap-2 md:col-span-2 xl:col-span-6">
      <h2 id="tile-coins" className="sr-only">
        Monedele mele
      </h2>
      {watchlist.data && coins.length === 0 ? (
        <div className="panel flex h-full flex-col items-start justify-center gap-3 px-5 py-4 text-[13.5px] text-muted">
          Nu ai monede favorite încă.
          <Link to="/settings" className="btn">
            Adaugă monede
          </Link>
        </div>
      ) : (
        <div className="grid h-full grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3.5">
          {coins.map((w, i) => {
            const sym = `${w.coin}/${w.quote}`;
            const r = rows.get(sym);
            const spark = sparks[i]?.data;
            const closes = spark?.closes ?? [];
            const digits = r?.pricePrecision ?? spark?.precision ?? 2;
            const price = r?.price ?? closes.at(-1);
            // Until the scanner has run, the 24 h change comes from the hourly closes.
            const change = r?.change24h ?? (closes.length >= 25 ? sparkChange(closes.slice(-25)) : null);
            return (
              <Link key={sym} to={`/charts/${w.coin}/${w.quote}`} className="panel flex flex-col gap-2 px-5 py-4 text-text no-underline transition-colors hover:border-line-strong hover:no-underline">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-2 text-[15px] font-semibold">
                    <CoinLogo coin={w.coin} size={22} />
                    <span>
                      {w.coin}
                      <span className="font-normal text-faint">/{w.quote}</span>
                    </span>
                  </span>
                  {r?.ok && <span className={clsx('text-[12px]', r.uptrend ? 'text-bull' : 'text-bear')}>{r.uptrend ? 'Uptrend' : 'Downtrend'}</span>}
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="num text-[20px] tracking-[-0.02em]">{price !== undefined ? fmtPrice(price, digits) : '…'}</span>
                  {change !== null && <span className={clsx('num text-[12.5px]', change >= 0 ? 'text-bull' : 'text-bear')}>{fmtPct(change)}</span>}
                </div>
                <Sparkline values={closes} width={200} height={40} className="h-10 w-full" change={change} />
                {r && !r.ok ? (
                  <span className="text-[12px] text-bear">{r.error}</span>
                ) : r ? (
                  <div className="flex flex-col gap-0.5 text-[12px] text-muted">
                    <div className="flex justify-between gap-2">
                      {signalLine(r, tz)}
                      {r.ms?.lastBreak && <span className={r.ms.lastBreak.type === 'msBullish' ? 'text-bull' : 'text-bear'}>{r.ms.lastBreak.type === 'msBullish' ? 'Bullish' : 'Bearish'}</span>}
                    </div>
                    {r.atr && (
                      <span className="num">
                        TP <span className="text-bull">{fmtPrice(r.atr.tp, digits)}</span> SL <span className="text-bear">{fmtPrice(r.atr.sl, digits)}</span>
                      </span>
                    )}
                    {r.liveSignal && <span className="text-bull">LONG în formare</span>}
                  </div>
                ) : (
                  <span className="text-[12px] text-faint">Slingshot pe {tf}: se calculează…</span>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

function DriversTile() {
  const q = useSentiment();
  const [all, setAll] = useState(false);
  const d = q.data?.drivers;
  const total = d ? d.positive.length + d.negative.length : 0;
  // Two strongest each way by default; "Arată toate" lists every driver of the day.
  const list = d ? [...d.positive.slice(0, all ? undefined : 2), ...d.negative.slice(0, all ? undefined : 2)] : [];
  return (
    <Tile
      label="Ce mișcă piața"
      labelId="tile-drivers"
      icon={Flame}
      className="xl:col-span-3"
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
        <ul className="flex flex-col gap-2.5">
          {list.map((x) => (
            <li key={x.id} className="grid grid-cols-[16px_46px_minmax(0,1fr)] gap-2.5 text-[13px] leading-snug">
              <span className="pt-px">
                <TopicIcon title={x.title} category={x.category} coins={x.coins} size={16} />
              </span>
              <span className={clsx('num', SCORE_TEXT(x.sentiment))}>{fmtScore(x.sentiment)}</span>
              {x.url ? (
                <a href={x.url} target="_blank" rel="noopener noreferrer" className="line-clamp-2 text-text" title={`${x.source}, ${fmtAgo(x.publishedAt)}`}>
                  {x.title}
                </a>
              ) : (
                <span className="line-clamp-2">{x.title}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Tile>
  );
}

function HistoryTile() {
  const tz = useTz();
  const q = useQuery({ queryKey: ['sentiment', 'history'], queryFn: () => api.get<{ tz: string; points: HistoryPoint[] }>('/api/sentiment/history?days=30'), refetchInterval: 10 * 60_000 });
  const pts = q.data?.points ?? [];
  const DAYS = 30;
  // One fixed slot per calendar day (oldest left), so missing days stay visible as gaps.
  const today = dayKey(Date.now(), tz);
  const slots = Array.from({ length: DAYS }, (_, k) => addDays(today, k - (DAYS - 1)));
  const byDay = new Map(pts.map((p) => [p.day, p]));
  return (
    <Tile label="Ultimele 30 de zile" labelId="tile-history" icon={History} className="xl:col-span-3">
      <div className="grid h-16 grid-cols-[repeat(30,minmax(0,1fr))] gap-[3px]" role="img" aria-label="Indicele zilnic din ultimele 30 de zile, față de pragul neutru 50">
        {slots.map((day) => {
          const p = byDay.get(day);
          const h = p ? Math.max(2, (Math.abs(p.index - 50) / 50) * 30) : 0;
          return (
            <span key={day} className="relative rounded-[2px] bg-panel-2" title={p ? `${day}: ${p.index.toFixed(1)} (${p.count} știri)${p.final ? '' : ', provizoriu'}` : day}>
              {p && (
                <span
                  className={clsx('absolute inset-x-0 rounded-[2px]', p.index >= 60 ? 'bg-bull' : p.index < 40 ? 'bg-bear' : 'bg-muted')}
                  style={{ height: h, ...(p.index >= 50 ? { bottom: 32 } : { top: 32 }), opacity: p.final ? 0.9 : 0.5 }}
                />
              )}
            </span>
          );
        })}
      </div>
      {pts.length < 2 && <p className="text-[12px] text-faint">Istoricul se construiește zi de zi; revino mâine.</p>}
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
      <CoinsTile />
      <DriversTile />
      <HistoryTile />
    </div>
  );
}
