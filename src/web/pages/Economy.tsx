// The Economy page (FD-ECON): the latest economic indicators of the main markets, by country, with the next
// release of each. Data: the TradingView economic calendar, through /api/economy.
import { Fragment, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { clsx } from 'clsx';
import { ChevronDown, ChevronRight, ExternalLink, Search } from 'lucide-react';
import type { EconIndicator, EconomyView } from '../../shared/api-types.ts';
import { api, qs } from '../api.ts';
import { filterEconomy, fmtEconChange, fmtEconPeriod, fmtEconValue, surprise, TONE_FILL, TONE_TEXT, toneOf, type Tone } from '../econ-format.ts';
import { fmtAgo, fmtDate, fmtDateTime, fmtIn } from '../format.ts';
import { useNow, useTz } from '../hooks.ts';
import { sparkPath } from '../spark.ts';
import { ErrorNote, Loading, Panel, Warning } from '../components/ui.tsx';

const GROUPS: { id: EconIndicator['group']; name: string }[] = [
  { id: 'prce', name: 'Prețuri și inflație' },
  { id: 'lbr', name: 'Piața muncii' },
  { id: 'gdp', name: 'PIB și creștere' },
  { id: 'bsnss', name: 'Industrie și afaceri' },
  { id: 'cnsm', name: 'Consum' },
  { id: 'hse', name: 'Locuințe' },
  { id: 'mny', name: 'Bani și dobânzi' },
  { id: 'trd', name: 'Comerț exterior' },
  { id: 'gov', name: 'Buget public' },
  { id: 'enrg', name: 'Energie' },
  { id: 'bnd', name: 'Obligațiuni' },
  { id: 'other', name: 'Altele' },
];

const groupRank = (i: EconIndicator) => GROUPS.findIndex((g) => g.id === i.group);

const IMPORTANT_KEY = 'sentiq.economy.importantOnly';
function readImportantOnly(): boolean {
  try {
    return localStorage.getItem(IMPORTANT_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * The history line, golden like everywhere on the page, with a dot at its end in the colour of the latest change
 * (FD-ECONCOLOR). `fill`: as wide as its box (the cards); otherwise `w` × `h` px (the tables).
 */
function Spark({ values, tone, w = 96, h = 26, fill }: { values: number[]; tone: Tone; w?: number; h?: number; fill?: boolean }) {
  const d = sparkPath(values, w, h);
  // One value is no line: nothing in a card, a dash in a table.
  if (!d) return fill ? null : <span className="text-[12px] text-faint">—</span>;
  // The last point of the path ("…L x y"): where the dot goes.
  const end = /([\d.]+) ([\d.]+)$/.exec(d);
  const line = (
    <svg
      width={fill ? '100%' : w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio={fill ? 'none' : undefined}
      className="block overflow-visible text-accent"
      aria-hidden
    >
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {/* A stretched card line would turn a circle into an ellipse: there the dot is drawn by the wrapper. */}
      {!fill && end && <circle cx={end[1]} cy={end[2]} r={2.75} className={TONE_FILL[tone]} />}
    </svg>
  );
  if (!fill || !end) return line;
  return (
    <span className="relative block">
      {line}
      <span
        className={clsx('absolute size-[6px] -translate-x-1/2 -translate-y-1/2 rounded-full', tone === 'good' ? 'bg-bull' : tone === 'bad' ? 'bg-bear' : 'bg-muted')}
        style={{ left: '100%', top: `${(Number(end[2]) / h) * 100}%` }}
      />
    </span>
  );
}

/** The change, with its direction (▲ / ▼) and the colour of good / bad for the economy. */
function Change({ i, className }: { i: EconIndicator; className?: string }) {
  const tone = toneOf(i.change, i.polarity);
  const arrow = i.change === null || Math.round(i.change * 1000) === 0 ? '' : i.change > 0 ? '▲ ' : '▼ ';
  // A neutral change stays quiet (muted), so the coloured ones stand out. Good / bad is also said in words, for whoever
  // does not see the colours (screen reader, tooltip).
  const meaning = tone === 'good' ? 'bine pentru economie' : tone === 'bad' ? 'rău pentru economie' : undefined;
  return (
    // relative: the hidden words stay inside the table's own scroll box (else they widen the page on a phone).
    <span className={clsx('num relative whitespace-nowrap', tone === 'neutral' ? 'text-muted' : TONE_TEXT[tone], className)} title={meaning}>
      {arrow + fmtEconChange(i.change, i.unit, i.scale)}
      {meaning && <span className="sr-only"> ({meaning})</span>}
    </span>
  );
}

const values = (i: EconIndicator) => i.history.map((h) => h[1]);

/**
 * "15 oct., 15:30 · în 2 z 3 h", "în așteptare (trebuia la …)", or that it is not scheduled yet. `stacked`: the
 * countdown on its own line (a narrow card on a phone).
 */
function NextRelease({ i, tz, now, stacked }: { i: EconIndicator; tz: string; now: number; stacked?: boolean }) {
  if (!i.next) return <span className="text-faint">nu e anunțată încă</span>;
  if (i.next.overdue) return <span className="text-warn">în așteptare (trebuia {fmtDateTime(i.next.ts, tz)})</span>;
  return (
    <span>
      <span className="num whitespace-nowrap">{fmtDateTime(i.next.ts, tz)}</span>
      <span className={clsx('whitespace-nowrap text-faint', stacked && 'block sm:inline')}>
        <span className={clsx(stacked && 'sm:inline hidden')}> · </span>
        {fmtIn(i.next.ts, now)}
      </span>
    </span>
  );
}

function Name({ i }: { i: EconIndicator }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="font-medium text-text">
        {i.name}
        {i.countryName && <span className="tag ml-2 align-middle">{i.countryName}</span>}
      </span>
      {i.original !== i.name && <span className="text-[12px] text-faint">{i.original}</span>}
    </span>
  );
}

function EssentialCard({ i, tz, now }: { i: EconIndicator; tz: string; now: number }) {
  return (
    <div className="panel flex min-w-0 flex-col gap-2 px-3 py-3 sm:px-4 sm:py-3.5">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 text-[13px] leading-snug text-muted">
          {i.name}
          {i.countryName && <span className="tag ml-1.5 align-middle">{i.countryName}</span>}
        </span>
        <span className="shrink-0 text-[12px] text-faint">{fmtEconPeriod(i.latest.period)}</span>
      </div>
      <span className={clsx('num truncate text-[21px] leading-none font-[600] tracking-[-0.02em] sm:text-[26px]', TONE_TEXT[toneOf(i.change, i.polarity)])}>
        {fmtEconValue(i.latest.value, i.unit, i.scale)}
      </span>
      <Spark values={values(i)} tone={toneOf(i.change, i.polarity)} w={200} h={28} fill />
      <div className="flex flex-wrap items-baseline gap-x-2 text-[12.5px] text-muted">
        <span>anterior {fmtEconValue(i.previous, i.unit, i.scale)}</span>
        <Change i={i} />
      </div>
      <div className="border-t border-line-soft pt-2 text-[12.5px]">
        <span className="text-faint">Următoarea: </span>
        <NextRelease i={i} tz={tz} now={now} stacked />
      </div>
    </div>
  );
}

function IndicatorRow({ i, tz, now }: { i: EconIndicator; tz: string; now: number }) {
  const [open, setOpen] = useState(false);
  const surp = surprise(i.latest.value, i.latest.forecast, i.unit, i.scale);
  return (
    <Fragment>
      <tr className="cursor-pointer" onClick={() => setOpen((o) => !o)}>
        <td className="min-w-[240px]">
          <button
            type="button"
            className="flex items-start gap-1.5 text-left"
            aria-expanded={open}
            onClick={(e) => {
              e.stopPropagation();
              setOpen((o) => !o);
            }}
          >
            {/* On the name's first line, however it wraps. */}
            <span className="flex h-[1lh] shrink-0 items-center">{open ? <ChevronDown size={14} className="text-faint" aria-hidden /> : <ChevronRight size={14} className="text-faint" aria-hidden />}</span>
            <Name i={i} />
          </button>
        </td>
        <td className={clsx('num text-right font-semibold whitespace-nowrap', TONE_TEXT[toneOf(i.change, i.polarity)])}>{fmtEconValue(i.latest.value, i.unit, i.scale)}</td>
        <td className="num text-right whitespace-nowrap text-faint">{fmtEconValue(i.previous, i.unit, i.scale)}</td>
        <td className="text-right">
          <Change i={i} />
        </td>
        <td className="whitespace-nowrap text-muted">
          {fmtEconPeriod(i.latest.period)}
          <span className="block text-[12px] text-faint">publicat {fmtDate(i.latest.ts, tz)}</span>
        </td>
        <td className="whitespace-nowrap">
          <NextRelease i={i} tz={tz} now={now} />
          {i.next && !i.next.overdue && i.next.forecast !== null && (
            <span className="block text-[12px] text-faint">prognoză {fmtEconValue(i.next.forecast, i.unit, i.scale)}</span>
          )}
        </td>
        <td className="text-muted">
          <Spark values={values(i)} tone={toneOf(i.change, i.polarity)} w={88} h={22} />
        </td>
      </tr>
      {open && (
        <tr className="table-detail">
          <td colSpan={7} className="bg-ink-2/60">
            <div className="flex max-w-[90ch] flex-col gap-1.5 py-1 text-[13px]">
              {i.explanation && <p>{i.explanation}</p>}
              {surp && (
                <p className="text-muted">
                  La ultima publicare:{' '}
                  <span className={TONE_TEXT[i.latest.forecast === null ? 'neutral' : toneOf(i.latest.value - i.latest.forecast, i.polarity)]}>{surp}</span>.
                </p>
              )}
              {i.history.length > 1 && (
                <p className="num text-[12.5px] text-muted">
                  {i.history.map(([period, value]) => `${fmtEconPeriod(period)} ${fmtEconValue(value, i.unit, i.scale)}`).join(' · ')}
                </p>
              )}
              {i.hasDescription && <SourceDescription indicatorKey={i.key} />}
              {i.source && (
                <p className="text-[12.5px] text-faint">
                  Sursa oficială:{' '}
                  {i.sourceUrl ? (
                    <a href={i.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1">
                      {i.source}
                      <ExternalLink size={11} aria-hidden />
                    </a>
                  ) : (
                    i.source
                  )}
                </p>
              )}
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

/** The source's description, read when asked for (it is in English and long, so not part of the page's answer). */
function SourceDescription({ indicatorKey }: { indicatorKey: string }) {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ['economy', 'description', indicatorKey],
    queryFn: () => api.get<{ description: string }>(`/api/economy/description${qs({ key: indicatorKey })}`),
    enabled: open,
    staleTime: Infinity,
  });
  return (
    <details className="text-[12.5px] text-faint" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer transition-colors hover:text-accent">Descrierea sursei (în engleză)</summary>
      <p className="mt-1">{q.data?.description ?? (q.isError ? 'Descrierea nu s-a putut încărca.' : 'Se încarcă…')}</p>
    </details>
  );
}

function GroupTable({ name, items, tz, now }: { name: string; items: EconIndicator[]; tz: string; now: number }) {
  return (
    <Panel title={name} flush>
      <table className="table">
        <thead>
          <tr>
            <th>Indicator</th>
            <th className="text-right">Ultima</th>
            <th className="text-right">Anterior</th>
            <th className="text-right">Schimbare</th>
            <th>Perioadă</th>
            <th>Următoarea publicare</th>
            <th>Istoric</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <IndicatorRow key={i.key} i={i} tz={tz} now={now} />
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

export default function EconomyPage() {
  const tz = useTz();
  // The countdowns are in minutes; hundreds of rows need no more than one render a minute.
  const now = useNow(60_000);
  const q = useQuery({ queryKey: ['economy'], queryFn: () => api.get<EconomyView>('/api/economy'), refetchInterval: 5 * 60_000 });
  const [search, setSearch] = useState('');
  const [importantOnly, setImportantOnly] = useState(readImportantOnly);
  const toggleImportant = (on: boolean) => {
    setImportantOnly(on);
    try {
      localStorage.setItem(IMPORTANT_KEY, on ? '1' : '0');
    } catch {
      // remembered only for this visit
    }
  };
  const countries = useMemo(() => filterEconomy(q.data?.countries ?? [], { search, importantOnly }), [q.data, search, importantOnly]);
  // The country filter lives in the address (FD-ECONFILTER §1): kept on reload and in a shared link.
  const [params, setParams] = useSearchParams();
  const wanted = params.get('tara');
  const selected = countries.some((c) => c.code === wanted) ? wanted : null;
  const choose = (code: string | null) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (code === null || code === selected) next.delete('tara');
        else next.set('tara', code);
        return next;
      },
      { replace: true },
    );

  if (q.isPending) return <Loading />;
  if (!q.data) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const withResults = countries.filter((c) => c.indicators.length > 0);
  const selectedCountry = selected ? countries.find((c) => c.code === selected) ?? null : null;
  // The chosen country only, or every country that has something to show.
  const shown = selectedCountry ? (selectedCountry.indicators.length ? [selectedCountry] : []) : withResults;
  const total = withResults.reduce((n, c) => n + c.indicators.length, 0);
  const stale = q.data.updatedAt !== null && now - q.data.updatedAt > 6 * 3_600_000;

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="page-title">Economie</h1>
        <p className="text-[13.5px] text-muted">
          Ultimele valori ale indicatorilor economici, pe țări, și când apare următoarea publicare. Sursa: calendarul economic TradingView
          {q.data.updatedAt !== null && <>; actualizat {fmtAgo(q.data.updatedAt, now)}</>}.
        </p>
        <p className="text-[13px] text-muted">
          <span className="font-semibold text-bull">Verde</span> = schimbare bună pentru economie, <span className="font-semibold text-bear">roșu</span> = rea (ex.
          inflația în creștere e roșie, PIB-ul în creștere e verde); fără culoare = indicator neutru sau fără schimbare. Săgeata arată direcția.
        </p>
      </div>
      {stale && <Warning>Datele nu s-au mai actualizat de {fmtAgo(q.data.updatedAt as number, now).replace(/^acum /, '')}: sursa nu răspunde. Valorile pot fi vechi.</Warning>}
      {!q.data.historyReady && <Warning>Se încarcă istoricul indicatorilor (prima pornire, câteva minute). Pagina se completează singură.</Warning>}

      {/* Two rows on purpose: the countries (filters) above, the search and "important only" under them. */}
      <div className="flex flex-col gap-2.5 rounded-[14px] border border-line bg-panel px-3 py-2.5">
        <div role="group" aria-label="Filtrează după țară" className="flex flex-wrap gap-1.5">
          <button type="button" className="chip" aria-pressed={selected === null} onClick={() => choose(null)}>
            Toate <span className="num text-faint">{total}</span>
          </button>
          {/* The countries the search and "important only" leave something in, and the chosen one in any case. */}
          {countries
            .filter((c) => c.indicators.length > 0 || c.code === selected)
            .map((c) => (
              <button key={c.code} type="button" className="chip" aria-pressed={c.code === selected} onClick={() => choose(c.code)}>
                {c.name} <span className="num text-faint">{c.indicators.length}</span>
              </button>
            ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="relative flex items-center">
            <Search size={14} className="pointer-events-none absolute left-2.5 text-faint" aria-hidden />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Caută un indicator" aria-label="Caută un indicator" className="w-60 max-w-full pl-8" />
          </label>
          <label className="inline-flex items-center gap-2 text-[13px] whitespace-nowrap">
            <input type="checkbox" checked={importantOnly} onChange={(e) => toggleImportant(e.target.checked)} />
            Doar importante
          </label>
        </div>
      </div>

      {shown.length === 0 && (
        <div className="flex flex-wrap items-center gap-3 py-6 text-[14px] text-muted">
          {q.data.countries.every((c) => c.indicators.length === 0)
            ? 'Încă nu există date. Revino în câteva minute.'
            : selectedCountry && withResults.length > 0
              ? `Niciun indicator din ${selectedCountry.name} nu se potrivește.`
              : 'Niciun indicator nu se potrivește.'}
          {selectedCountry && withResults.length > 0 && (
            <button type="button" className="btn" onClick={() => choose(null)}>
              Caută în toate țările
            </button>
          )}
        </div>
      )}

      {shown.map((c) => {
        // Prices first, then labour, growth…; inside a group, the source's order of importance is kept by name.
        const essentials = c.indicators.filter((i) => i.important).sort((a, b) => groupRank(a) - groupRank(b) || a.name.localeCompare(b.name, 'ro'));
        return (
          <section key={c.code} id={`econ-${c.code}`} className="flex flex-col gap-3" aria-labelledby={`econ-h-${c.code}`}>
            <h2 id={`econ-h-${c.code}`} className="mt-2 text-[22px] font-[650] tracking-[-0.02em]">
              {c.name}
            </h2>
            {c.code === 'EU' && (
              <p className="-mt-1.5 text-[12.5px] text-faint">Indicatorii zonei euro; ai Germaniei, Franței, Italiei și Spaniei apar doar unde zona euro nu publică același indicator.</p>
            )}
            {essentials.length > 0 && (
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-[repeat(auto-fill,minmax(232px,1fr))] sm:gap-3">
                {essentials.map((i) => (
                  <EssentialCard key={i.key} i={i} tz={tz} now={now} />
                ))}
              </div>
            )}
            {GROUPS.map((g) => {
              const items = c.indicators.filter((i) => i.group === g.id).sort((a, b) => Number(b.important) - Number(a.important) || a.name.localeCompare(b.name, 'ro'));
              return items.length ? <GroupTable key={g.id} name={g.name} items={items} tz={tz} now={now} /> : null;
            })}
          </section>
        );
      })}
    </div>
  );
}
