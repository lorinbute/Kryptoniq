// "Rezumat": the day so far, summarised by the user's own AI (FD-AIKEYS), with a verdict and the charts it chose
// (FD-SUMMARY §2–§3).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { AlertTriangle, CircleCheck, Clock, Loader2, RefreshCw, Sparkles, X } from 'lucide-react';
import { AI_PROVIDER_INFO, modelLabel, providerOfModel } from '../../shared/ai.ts';
import type { StoredSummary, SummaryChart, SummaryState } from '../../shared/api-types.ts';
import { api, ApiError, errorMessage } from '../api.ts';
import { fmtEconPeriod, fmtEconValue, toneOf } from '../econ-format.ts';
import { fmtAgo, fmtIn, fmtTime } from '../format.ts';
import { lockScroll } from '../scroll-lock.ts';
import { useVisibleArea } from '../visible-area.ts';
import { useNow, useTz } from '../hooks.ts';

const KEY = ['summary'] as const;

const VERDICT: Record<StoredSummary['content']['verdict'], { label: string; box: string; text: string }> = {
  buna: { label: 'Zi bună de trading', box: 'border-bull/50 bg-bull/[0.07]', text: 'text-bull' },
  mixta: { label: 'Zi mixtă', box: 'border-warn/50 bg-warn/[0.07]', text: 'text-warn' },
  slaba: { label: 'Zi slabă: prudență', box: 'border-bear/50 bg-bear/[0.07]', text: 'text-bear' },
};
const CONFIDENCE: Record<StoredSummary['content']['confidence'], string> = { scazuta: 'încredere scăzută', medie: 'încredere medie', ridicata: 'încredere ridicată' };
/** "Claude", "ChatGPT", "Gemini" for a model id ("AI" for one Sentiq does not know). */
const productOf = (model: string | undefined) => {
  const p = model ? providerOfModel(model) : null;
  return p ? AI_PROVIDER_INFO[p].product : 'AI';
};

/** A line chart: the app's numbers, the last point in the colour of good / bad, the forecast as a hollow dot. */
function LineChart({ c }: { c: Extract<SummaryChart, { kind: 'line' }> }) {
  const W = 400;
  const H = 120;
  const values = c.points.map((p) => p.value);
  if (values.length < 2) return <p className="py-6 text-center text-[12.5px] text-faint">Prea puține puncte pentru un grafic.</p>;
  // The reference line (50 for the sentiment) and the forecast stay inside the drawing.
  const extra = [c.baseline, c.forecast].filter((v): v is number => v !== null);
  const all = [...values, ...extra];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const pad = hi === lo ? 1 : (hi - lo) * 0.12;
  const y = (v: number) => H - 6 - ((v - (lo - pad)) / (hi + pad - (lo - pad))) * (H - 12);
  const x = (i: number) => (i / (values.length - 1)) * (W - 8) + 4;
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join('');
  const last = values.length - 1;
  const tone = toneOf((values[last] as number) - (values[last - 1] as number), c.polarity);
  const label = (s: string) => (c.id.startsWith('econ:') ? fmtEconPeriod(s) : s);
  const fmt = (v: number) => (c.id.startsWith('econ:') ? fmtEconValue(v, c.unit, c.scale) : String(Math.round(v * 10) / 10));
  return (
    <div className="flex flex-col gap-1">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full overflow-visible" role="img" aria-label={`${c.title}: ultima valoare ${fmt(values[last] as number)}`}>
        {c.baseline !== null && <line x1={0} x2={W} y1={y(c.baseline)} y2={y(c.baseline)} className="stroke-line-strong" strokeDasharray="4 4" />}
        <path d={d} fill="none" className="stroke-accent" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {c.forecast !== null && <circle cx={x(last)} cy={y(c.forecast)} r={4} className="fill-none stroke-muted" strokeWidth={1.5} />}
        <circle cx={x(last)} cy={y(values[last] as number)} r={4.5} className={tone === 'good' ? 'fill-bull' : tone === 'bad' ? 'fill-bear' : 'fill-muted'} />
      </svg>
      <div className="flex justify-between text-[11.5px] text-faint">
        <span>{label(c.points[0]?.label ?? '')}</span>
        {values.length > 4 && <span>{label(c.points[Math.floor(last / 2)]?.label ?? '')}</span>}
        <span>{label(c.points[last]?.label ?? '')}</span>
      </div>
      <div className="flex flex-wrap gap-x-3 text-[12px] text-muted">
        <span>
          ultima <span className={clsx('num font-semibold', tone === 'good' ? 'text-bull' : tone === 'bad' ? 'text-bear' : 'text-text')}>{fmt(values[last] as number)}</span>
        </span>
        <span>
          minim <span className="num">{fmt(Math.min(...values))}</span>, maxim <span className="num">{fmt(Math.max(...values))}</span>
        </span>
        {c.forecast !== null && (
          <span>
            prognoză <span className="num">{fmt(c.forecast)}</span> (cercul gol)
          </span>
        )}
      </div>
    </div>
  );
}

/** Horizontal bars around a baseline (0 for changes, 50 for the sentiment), green / red by good / bad. */
function BarChart({ c }: { c: Extract<SummaryChart, { kind: 'bars' }> }) {
  const span = Math.max(...c.bars.map((b) => Math.abs(b.value - c.baseline)), 1);
  return (
    <ul className="flex flex-col gap-1.5" aria-label={c.title}>
      {c.bars.map((b, k) => {
        const delta = b.value - c.baseline;
        const tone = toneOf(delta, c.polarity);
        const width = `${(Math.abs(delta) / span) * 50}%`;
        return (
          <li key={k} className="grid grid-cols-[72px_1fr_64px] items-center gap-2 text-[12.5px]">
            <span className="truncate text-muted">{b.label}</span>
            <span className="relative h-2.5 rounded-sm bg-line/60">
              <span className="absolute top-0 left-1/2 h-2.5 w-px bg-line-strong" aria-hidden />
              <span
                className={clsx('absolute top-0 h-2.5 rounded-sm', tone === 'good' ? 'bg-bull' : tone === 'bad' ? 'bg-bear' : 'bg-muted')}
                style={delta >= 0 ? { left: '50%', width } : { right: '50%', width }}
              />
            </span>
            <span className={clsx('num text-right', tone === 'good' ? 'text-bull' : tone === 'bad' ? 'text-bear' : 'text-text')}>
              {c.unit === '%' ? `${b.value > 0 ? '+' : ''}${fmtEconValue(b.value, '%', null)}` : fmtEconValue(b.value, null, null)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function ChartCard({ c }: { c: SummaryChart }) {
  return (
    <figure className="flex min-w-0 flex-col gap-2.5 rounded-[14px] border border-line bg-ink-2/60 p-4">
      <figcaption className="text-[13px] font-medium text-text">{c.title}</figcaption>
      {c.kind === 'line' ? <LineChart c={c} /> : <BarChart c={c} />}
      {c.caption && <p className="text-[12.5px] leading-snug text-muted">{c.caption}</p>}
    </figure>
  );
}

function List({ title, icon, items, tone }: { title: string; icon: ReactNode; items: string[]; tone: 'bull' | 'bear' }) {
  if (!items.length) return null;
  return (
    <section className="flex flex-col gap-2">
      <h3 className={clsx('inline-flex items-center gap-1.5 text-[13px] font-semibold', tone === 'bull' ? 'text-bull' : 'text-bear')}>
        {icon}
        {title}
      </h3>
      <ul className="flex flex-col gap-1.5 text-[13.5px] leading-snug">
        {items.map((t, k) => (
          <li key={k} className="flex gap-2">
            <span className={clsx('mt-[7px] size-1.5 shrink-0 rounded-full', tone === 'bull' ? 'bg-bull' : 'bg-bear')} aria-hidden />
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SummaryBody({ s, dim }: { s: StoredSummary; dim: boolean }) {
  const c = s.content;
  const v = VERDICT[c.verdict];
  return (
    <div className={clsx('flex flex-col gap-5 transition-opacity', dim && 'opacity-50')}>
      <section className={clsx('flex flex-col gap-2 rounded-[16px] border px-5 py-4', v.box)}>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className={clsx('text-[22px] font-[650] tracking-[-0.02em]', v.text)}>{v.label}</span>
          <span className="text-[12.5px] text-muted">{CONFIDENCE[c.confidence]}</span>
        </div>
        <p className="text-[16px] font-medium leading-snug text-text">{c.headline}</p>
        <p className="max-w-[90ch] text-[14px] leading-relaxed text-muted">{c.overview}</p>
      </section>

      <div className="grid gap-6 md:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          {c.sections.map((sec, k) => (
            <section key={k} className="flex flex-col gap-1">
              <h3 className="text-[14px] font-semibold text-text">{sec.title}</h3>
              <p className="text-[14px] leading-relaxed text-muted">{sec.body}</p>
            </section>
          ))}
        </div>
        <div className="flex flex-col gap-5">
          <List title="Oportunități" icon={<CircleCheck size={15} aria-hidden />} items={c.opportunities} tone="bull" />
          <List title="Riscuri" icon={<AlertTriangle size={15} aria-hidden />} items={c.risks} tone="bear" />
          {c.upcoming.length > 0 && (
            <section className="flex flex-col gap-2">
              <h3 className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent">
                <Clock size={15} aria-hidden />
                Ce urmează
              </h3>
              <ol className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-[13.5px] leading-snug">
                {c.upcoming.map((u, k) => (
                  // Subgrid: the time column fits its longest entry ("mâine 05:10") and each item stays a list item.
                  <li key={k} className="col-span-2 grid grid-cols-subgrid">
                    <span className="num whitespace-nowrap text-accent">{u.time}</span>
                    <span>
                      <span className="text-text">{u.event}</span>
                      <span className="block text-[12.5px] text-muted">{u.why}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      </div>

      {s.charts.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {s.charts.map((ch) => (
            <ChartCard key={ch.id} c={ch} />
          ))}
        </div>
      )}
    </div>
  );
}

export function DaySummary({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const tz = useTz();
  const now = useNow(1000);
  const dialog = useRef<HTMLDivElement>(null);
  const area = useVisibleArea();
  const q = useQuery({ queryKey: KEY, queryFn: () => api.get<SummaryState>('/api/summary'), staleTime: 0 });
  const gen = useMutation({
    mutationFn: () => api.post<SummaryState>('/api/summary'),
    onSuccess: (data) => qc.setQueryData(KEY, data),
    onError: (err) => {
      // Another tab made one meanwhile, or the key went away: read the state again.
      if (err instanceof ApiError && (err.status === 429 || err.status === 400)) void qc.invalidateQueries({ queryKey: KEY });
    },
  });
  // The first opening of the day writes one (FD-SUMMARY §3).
  const [autoTried, setAutoTried] = useState(false);
  useEffect(() => {
    if (!autoTried && q.data && !q.data.summary && q.data.hasKey && !q.data.retryAt && !gen.isPending) {
      setAutoTried(true);
      gen.mutate();
    }
  }, [autoTried, q.data, gen]);

  // Esc closes; focus moves into the window, Tab stays inside it, and the focus goes back to the button afterwards.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Tab' && dialog.current) {
        const els = [...dialog.current.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), [tabindex]:not([tabindex="-1"])')];
        const first = els[0];
        const last = els[els.length - 1];
        if (!first || !last) return;
        const at = document.activeElement;
        if (e.shiftKey && (at === first || at === dialog.current)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (at === last || !dialog.current.contains(at))) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    // FD-SCROLLLOCK: the shared lock, so another window or the chart's full screen cannot undo it.
    const release = lockScroll();
    return () => {
      window.removeEventListener('keydown', onKey);
      release();
      before?.focus?.();
    };
  }, [onClose]);

  const s = q.data?.summary ?? null;
  const retryAt = q.data?.retryAt && q.data.retryAt > now ? q.data.retryAt : null;
  const busy = gen.isPending;
  const noKey = q.data && !q.data.hasKey;
  // Who writes it now (the user's choice), and who wrote the one shown.
  const writer = q.data?.ai ? AI_PROVIDER_INFO[q.data.ai.provider].product : productOf(s?.model);

  return (
    // FD-MODALFIT: as tall as the part of the window seen at most (`vh` is more than that on iPhone / iPad).
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-scrim p-0 backdrop-blur-sm sm:p-4 sm:pt-[3vh]" style={area} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="summary-title"
        tabIndex={-1}
        className="flex h-full w-full max-w-[1120px] flex-col overflow-hidden border border-line-strong bg-panel shadow-modal outline-none sm:h-auto sm:max-h-full sm:rounded-[20px]"
      >
        <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-5 py-3.5">
          <div className="flex min-w-0 flex-1 items-start gap-2.5">
            {/* On the title's line (not between it and the line under it): as tall as a line of the title. */}
            <span className="flex h-[1lh] shrink-0 items-center text-[17px]">
              <Sparkles size={18} className="text-accent" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 id="summary-title" className="text-[17px] font-[650] tracking-[-0.01em]">
                Rezumatul zilei
              </h2>
              <p className="text-[12.5px] text-pretty text-faint">
                {/* Each part whole on its line when the header is narrow; the model only where there is room. */}
                {s ? (
                  <>
                    <span className="whitespace-nowrap">azi până la {fmtTime(s.createdAt, tz)}</span> · <span className="whitespace-nowrap">generat {fmtAgo(s.createdAt, now)}</span>
                    <span className="whitespace-nowrap max-sm:hidden"> · {modelLabel(s.model)}</span>
                  </>
                ) : (
                  'ziua de azi, până acum'
                )}
              </p>
            </div>
          </div>
          <button type="button" className="btn" disabled={busy || !!retryAt || !!noKey} onClick={() => gen.mutate()} title={retryAt ? 'Un rezumat nou se poate cere la 2 minute după cel anterior.' : undefined}>
            {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <RefreshCw size={15} aria-hidden />}
            {/* On a phone the icon alone (the title needs the room); the words stay for screen readers. */}
            <span className="max-sm:sr-only">{busy ? 'Se generează…' : retryAt ? `Actualizează ${fmtIn(retryAt, now)}` : 'Actualizează'}</span>
          </button>
          <button type="button" className="btn px-2.5" onClick={onClose} aria-label="Închide">
            <X size={16} aria-hidden />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-5">
          {q.isPending && (
            <div className="flex items-center gap-2 py-10 text-muted" role="status">
              <Loader2 size={16} className="animate-spin text-accent" aria-hidden />
              Se încarcă…
            </div>
          )}
          {q.isError && <p className="py-6 text-bear">{errorMessage(q.error)}</p>}
          {noKey && (
            <div className="flex flex-col items-start gap-3 py-8 text-[14px]">
              <p>
                Rezumatul îl scrie AI-ul tău (Claude, ChatGPT sau Gemini), cu cheia ta API{q.data?.ai ? ` ${AI_PROVIDER_INFO[q.data.ai.provider].name}` : ''}. Plătești direct la
                furnizor, după consum.
              </p>
              <Link to="/settings#ai" className="btn btn-primary" onClick={onClose}>
                Pune cheia în Setări
              </Link>
            </div>
          )}
          {busy && (
            <div className="mb-4 flex items-center gap-2.5 rounded-[12px] border border-accent-dim/60 bg-accent/[0.06] px-4 py-3 text-[13.5px]" role="status">
              <Loader2 size={16} className="shrink-0 animate-spin text-accent" aria-hidden />
              {writer} citește ziua: sentimentul, știrile, calendarul, indicatorii economici și simbolurile tale urmărite. Durează de obicei 20–60 de secunde.
            </div>
          )}
          {/* No key and too soon have their own messages (above and on the button). */}
          {gen.isError && !busy && !noKey && !(gen.error instanceof ApiError && (gen.error.status === 429 || gen.error.status === 400)) && (
            <div className="mb-4 flex flex-wrap items-center gap-3 rounded-[12px] border border-bear/40 bg-bear/[0.06] px-4 py-3 text-[13.5px]" role="alert">
              <span className="flex-1">{errorMessage(gen.error)}</span>
              {!retryAt && (
                <button type="button" className="btn" onClick={() => gen.mutate()}>
                  Încearcă din nou
                </button>
              )}
            </div>
          )}
          {s && <SummaryBody s={s} dim={busy} />}
        </div>

        <footer className="border-t border-line px-5 py-2.5 text-[11.5px] text-faint">
          Scris de {s ? `${productOf(s.model)} (${s.model})` : q.data?.hasKey ? writer : 'AI-ul tău'} din datele Sentiq de azi (sentiment, știri, calendar, indicatori economici, contextul pieței, simbolurile tale urmărite), cu
          cheia ta API; cifrele graficelor sunt ale aplicației. Nu este un sfat de investiții.
        </footer>
      </div>
    </div>
  );
}
