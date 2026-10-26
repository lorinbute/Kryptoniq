// The legend of an indicator on the chart (FD-INDICATORS §2): its short name and main inputs, its buttons, then its
// values at the bar under the cursor (the last bar without one) in each line's colour, or what went wrong if anything.
// The buttons come before the values (FD-CHARTSTEADY §2): values change with the cursor and must not move them.
import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { Eye, EyeOff, Settings2, X } from 'lucide-react';
import type { Study } from '../../shared/studies.ts';
import type { StudyModule } from '../indicators/catalog.ts';
import { fmtStudyValue, plotShown } from '../indicators/compute.ts';
import { plotHasData, plotValueAt, pointColor } from '../indicators/style.ts';
import type { StudyState } from '../indicators/useStudies.ts';

const iconBtn = 'rounded-md p-1 text-faint transition-colors hover:bg-hover hover:text-accent';

export function LegendButtons({ name, hidden, onToggle, onSettings, onRemove }: { name: string; hidden?: boolean; onToggle?: () => void; onSettings: () => void; onRemove: () => void }) {
  return (
    // FD-CHARTSETTINGS: "Butoane → Panou" (the chart says whether they show now).
    <span className="pointer-events-auto inline-flex gap-0.5 in-data-[pane-buttons=hidden]:hidden">
      {onToggle && (
        <button type="button" className={iconBtn} onClick={onToggle} aria-label={hidden ? `Arată ${name}` : `Ascunde ${name}`} title={hidden ? 'Arată' : 'Ascunde'}>
          {hidden ? <EyeOff size={13} aria-hidden /> : <Eye size={13} aria-hidden />}
        </button>
      )}
      <button type="button" className={iconBtn} onClick={onSettings} aria-label={`Setările ${name}`} title="Setări">
        <Settings2 size={13} aria-hidden />
      </button>
      <button type="button" className={iconBtn} onClick={onRemove} aria-label={`Scoate ${name} de pe grafic`} title="Scoate de pe grafic">
        <X size={13} aria-hidden />
      </button>
    </span>
  );
}

/**
 * One legend row: a translucent plate so the text stays readable over the candles (FD-CHARTSETTINGS: as opaque as the
 * status line's "Fundal" says, none without it).
 */
export function LegendRow({ children, dim }: { children: ReactNode; dim?: boolean }) {
  return <div className={clsx('flex max-w-full flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md bg-[color-mix(in_srgb,var(--color-chart)_var(--legend-bg,75%),transparent)] px-1.5 text-[12px] leading-5', dim && 'opacity-60')}>{children}</div>;
}

/** FD-CHARTSETTINGS: an indicator's title, its inputs and its values, each shown as the status line's settings say. */
export const LEGEND_TITLE = 'in-data-[legend-titles=off]:hidden';
export const LEGEND_INPUTS = 'in-data-[legend-titles=off]:hidden in-data-[legend-inputs=off]:hidden';
export const LEGEND_VALUES = 'in-data-[legend-values=off]:hidden';

export function StudyLegendRow({
  shortName,
  params,
  number,
  study,
  mod,
  state,
  time,
  precision,
  loading,
  onToggle,
  onSettings,
  onRemove,
}: {
  shortName: string;
  params: string;
  /** "#2" for the same indicator with the same parameters added again. */
  number?: number;
  study: Study;
  /** Null while the indicator code loads. */
  mod: StudyModule | null;
  state: StudyState | undefined;
  /** Bar time (s) whose values are shown. */
  time: number | null;
  precision: number;
  /** The code or the first calculation is still on its way. */
  loading: boolean;
  onToggle: () => void;
  onSettings: () => void;
  onRemove: () => void;
}) {
  const hidden = !study.visible;
  const label = `${shortName}${number ? ` #${number}` : ''}`;
  let body: ReactNode = null;
  if (!hidden) {
    if (state?.error) body = <span className="text-bear">{state.error}</span>;
    else if (state?.missing) body = <span className="text-bear">Sentiq nu are datele pentru: {state.missing.join(', ')}. Schimbă simbolurile din setări.</span>;
    else if (state?.waiting || (loading && !state)) body = <span className="text-faint">Se încarcă…</span>;
    else if (state?.result && mod && time !== null) {
      const values = mod.plotConfig
        .filter(
          (def) =>
            def.display !== 'pane' &&
            def.color !== 'transparent' &&
            plotShown(def, study.plots?.[def.id], state.inputs, state.result) &&
            plotHasData(state.result as NonNullable<StudyState['result']>, def.id),
        )
        .slice(0, 8)
        .map((def) => {
          const p = plotValueAt(state.result as NonNullable<StudyState['result']>, def.id, time);
          const o = study.plots?.[def.id];
          const color = pointColor(def, o, p?.color);
          return (
            <span key={def.id} className="num font-semibold" style={{ color }} title={def.title}>
              {p && p.value !== null && p.value !== undefined ? fmtStudyValue(p.value, mod.overlay, precision) : '—'}
            </span>
          );
        });
      body = (
        <>
          {values}
          {state.approximated && <span className="text-[11.5px] text-faint">aproximat din lumânările graficului</span>}
        </>
      );
    }
  }
  return (
    <LegendRow dim={hidden}>
      <span className={clsx('font-medium text-muted', LEGEND_TITLE)}>{label}</span>
      {/* A wrapper of its own: "hidden sm:inline" and the settings' hiding never meet on one element. */}
      {params && (
        <span className={clsx('contents', LEGEND_INPUTS)}>
          <span className="num hidden text-faint sm:inline">{params}</span>
        </span>
      )}
      <LegendButtons name={label} hidden={hidden} onToggle={onToggle} onSettings={onSettings} onRemove={onRemove} />
      {body && <span className={clsx('contents', LEGEND_VALUES)}>{body}</span>}
    </LegendRow>
  );
}
