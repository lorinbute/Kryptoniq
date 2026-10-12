import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { AlertTriangle, Loader2, type LucideIcon } from 'lucide-react';
import { errorMessage } from '../api.ts';

/**
 * A titled surface. `flush` drops the body padding for edge-to-edge tables (which then scroll sideways on
 * narrow screens) and lines their first and last columns up with the title.
 */
export function Panel({
  title,
  actions,
  children,
  className,
  bodyClass,
  flush,
  labelledBy,
  icon: Icon,
}: {
  icon?: LucideIcon;
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClass?: string;
  flush?: boolean;
  labelledBy?: string;
}) {
  return (
    <section className={clsx('panel', className)} aria-labelledby={labelledBy}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 pt-4 pb-2.5">
          {title ? (
            <h2 id={labelledBy} className="panel-title inline-flex items-center gap-2">
              {Icon && <Icon size={15} strokeWidth={1.9} className="shrink-0 text-faint" aria-hidden />}
              {title}
            </h2>
          ) : (
            <span />
          )}
          {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
        </header>
      )}
      <div className={clsx(flush ? 'panel-flush overflow-x-auto pb-2' : (bodyClass ?? 'px-5 pb-5'), flush && bodyClass)}>{children}</div>
    </section>
  );
}

export function Loading({ label = 'Se încarcă…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-muted" role="status">
      <Loader2 size={16} className="animate-spin text-brass" aria-hidden />
      {label}
    </div>
  );
}

export function ErrorNote({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="flex flex-wrap items-start gap-3 rounded-xl border border-bear/40 bg-bear/[0.06] px-4 py-3 text-[13.5px] text-text" role="alert">
      <AlertTriangle size={18} className="mt-px shrink-0 text-bear" aria-hidden />
      <div className="min-w-0 flex-1">{errorMessage(error)}</div>
      {onRetry && (
        <button className="btn" onClick={onRetry}>
          Reîncearcă
        </button>
      )}
    </div>
  );
}

export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 py-4 text-[14px] text-muted">
      <div>{children}</div>
      {action}
    </div>
  );
}

export function Warning({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-warn/40 bg-warn/[0.06] px-4 py-3 text-[13.5px]" role="status">
      <AlertTriangle size={18} className="mt-px shrink-0 text-warn" aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

const scoreTone = (score: number) => (score > 0.2 ? 'bull' : score < -0.2 ? 'bear' : 'neutral');

/** Signed score with two decimals and a real minus sign. */
export function fmtScore(score: number): string {
  const s = Math.abs(score).toFixed(2);
  return score > 0 && s !== '0.00' ? `+${s}` : score < 0 && s !== '0.00' ? `−${s}` : s;
}

/** A −1…+1 score as its value over a thin meter centred on zero. */
export function ScoreBar({ score, width = 90 }: { score: number | null; width?: number }) {
  if (score === null) return <span className="text-[12px] text-faint">în analiză</span>;
  const half = width / 2;
  const len = Math.min(half, Math.abs(score) * half);
  const tone = scoreTone(score);
  return (
    <span className="inline-flex flex-col items-end gap-1.5" title={`Sentiment ${score.toFixed(2)}`}>
      <span className={clsx('num text-[13px]', tone === 'bull' ? 'text-bull' : tone === 'bear' ? 'text-bear' : 'text-muted')}>{fmtScore(score)}</span>
      <span className="relative inline-block h-1 rounded-sm bg-line" style={{ width }} aria-hidden>
        <span
          className={clsx('absolute top-0 h-1 rounded-sm', tone === 'bull' ? 'bg-bull' : tone === 'bear' ? 'bg-bear' : 'bg-muted')}
          style={{ left: score >= 0 ? half : half - len, width: Math.max(2, len) }}
        />
      </span>
    </span>
  );
}

const IMPACT_COLOR: Record<string, string> = { High: 'bg-impact-high', Medium: 'bg-impact-medium', Low: 'bg-impact-low', Holiday: 'bg-impact-holiday' };
const IMPACT_TEXT: Record<string, string> = { High: 'text-impact-high font-semibold', Medium: 'text-impact-medium', Low: 'text-impact-low', Holiday: 'text-muted' };
const IMPACT_TITLE: Record<string, string> = { High: 'Impact mare', Medium: 'Impact mediu', Low: 'Impact mic', Holiday: 'Sărbătoare' };

/** Impact as a coloured square and a word; with `label` (e.g. the currency) the label replaces the word. */
export function ImpactMark({ impact, label }: { impact: string; label?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 text-[12.5px]', IMPACT_TEXT[impact] ?? 'text-muted')} title={IMPACT_TITLE[impact] ?? impact}>
      <span className={clsx('inline-block size-2 rounded-[2px]', IMPACT_COLOR[impact] ?? 'bg-faint')} aria-hidden />
      {label ? (
        <>
          <span>{label}</span>
          <span className="sr-only">, {IMPACT_TITLE[impact] ?? impact}</span>
        </>
      ) : (
        <span>{impact === 'High' ? 'Mare' : impact === 'Medium' ? 'Mediu' : impact === 'Low' ? 'Mic' : 'Liber'}</span>
      )}
    </span>
  );
}
