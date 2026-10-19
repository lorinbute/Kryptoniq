// The settings of one standard indicator (FD-INDICATORS §3): the "Intrări" tab with exactly TradingView's inputs (names,
// groups, defaults, limits, lists, tooltips; an input that depends on another greyed out while it does not apply) and the
// "Stil" tab with its lines and horizontal lines. "Salvează" applies and remembers; "Valorile implicite" fills the form.
import { useEffect, useId, useState } from 'react';
import { clsx } from 'clsx';
import { Info } from 'lucide-react';
import type { InputConfig } from 'oakscriptjs';
import { LINE_STYLE_IDS, type LineStyleId, type Study } from '../../shared/studies.ts';
import { TIMEFRAMES } from '../../shared/time.ts';
import { errorMessage } from '../api.ts';
import { changedInputs, inputProblem, pineTf, sanitizeInputs, SOURCES } from '../indicators/compute.ts';
import type { StudyModule } from '../indicators/catalog.ts';
import type { StudyRuntime } from '../indicators/runtime.ts';
import { hlineShown, lineKind, plotWidth, styleHlines, stylePlots, widthChoices } from '../indicators/style.ts';

/** FD-STUDYUX §3: a line's kind and its three widths, as the Style tab names them. */
const LINE_STYLE_RO: Record<LineStyleId, string> = { solid: 'Continuă', dashed: 'Liniuțe', dotted: 'Puncte' };
const WIDTH_RO = ['Implicită', 'Groasă', 'Foarte groasă'] as const;

function LineStyleField({ label, value, onChange }: { label: string; value: LineStyleId; onChange: (v: LineStyleId) => void }) {
  return (
    <select aria-label={`${label}: tip`} value={value} onChange={(e) => onChange(e.target.value as LineStyleId)} className="w-[104px]">
      {LINE_STYLE_IDS.map((id) => (
        <option key={id} value={id}>
          {LINE_STYLE_RO[id]}
        </option>
      ))}
    </select>
  );
}

/** A width saved in pixels before the three choices (1–4 px) stays listed until another is picked. */
function LineWidthField({ label, drawn, value, onChange }: { label: string; drawn: number; value: number | undefined; onChange: (v: number) => void }) {
  const choices = widthChoices(drawn);
  const current = value ?? choices[0];
  return (
    <select aria-label={`${label}: grosime`} value={String(current)} onChange={(e) => onChange(Number(e.target.value))} className="w-[128px]">
      {!choices.includes(current) && <option value={current}>{current} px</option>}
      {choices.map((w, i) => (
        <option key={w} value={w}>
          {WIDTH_RO[i]}
        </option>
      ))}
    </select>
  );
}

type Draft = Record<string, unknown>;
type PlotStyle = NonNullable<Study['plots']>[string];
type HlineStyle = NonNullable<Study['hlines']>[string];

/** The timeframes an input can take: the chart's, Sentiq's, the month (from daily bars). */
const TF_OPTIONS: { value: string; label: string }[] = [{ value: '', label: 'Grafic' }, ...TIMEFRAMES.map((t) => ({ value: pineTf(t), label: t })), { value: '1M', label: '1M' }];

/** #RRGGBB of a colour (the colour picker has no alpha); `alpha`: its "AA" suffix, kept on a change. */
function hexOf(c: string): { hex: string; alpha: string } {
  const s = c.trim();
  const m8 = /^#([0-9a-f]{6})([0-9a-f]{2})$/i.exec(s);
  if (m8) return { hex: `#${m8[1]}`, alpha: m8[2] ?? '' };
  if (/^#[0-9a-f]{6}$/i.test(s)) return { hex: s, alpha: '' };
  const m3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])?$/i.exec(s);
  if (m3) return { hex: `#${m3[1]}${m3[1]}${m3[2]}${m3[2]}${m3[3]}${m3[3]}`, alpha: m3[4] ? `${m3[4]}${m3[4]}` : '' };
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s);
  if (rgb) {
    const h = (n: string | undefined) => Math.min(255, Number(n ?? 0)).toString(16).padStart(2, '0');
    const a = rgb[4] !== undefined ? Math.round(Math.min(1, Number(rgb[4])) * 255).toString(16).padStart(2, '0') : '';
    return { hex: `#${h(rgb[1])}${h(rgb[2])}${h(rgb[3])}`, alpha: a };
  }
  return { hex: '#000000', alpha: '' };
}

function ColorField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const { hex, alpha } = hexOf(value);
  return <input type="color" aria-label={label} value={hex} onChange={(e) => onChange(`${e.target.value.toUpperCase()}${alpha.toUpperCase()}`)} className="h-8 w-12 shrink-0 p-1" />;
}

/** Consecutive inputs of one group (Pine `group`), and in it the rows of inputs that share `inline`. */
function groupsOf(inputs: readonly InputConfig[]): { title: string | null; rows: InputConfig[][] }[] {
  const out: { title: string | null; rows: InputConfig[][] }[] = [];
  for (const cfg of inputs) {
    const title = cfg.group ?? null;
    let g = out.at(-1);
    if (!g || g.title !== title) {
      g = { title, rows: [] };
      out.push(g);
    }
    const row = g.rows.at(-1);
    if (cfg.inline && row && row[0]?.inline === cfg.inline) row.push(cfg);
    else g.rows.push([cfg]);
  }
  return out;
}

export function StudySettings({ name, mod, runtime, study, onSave }: { name: string; mod: StudyModule; runtime: StudyRuntime; study: Study; onSave: (next: Study) => Promise<unknown> }) {
  const formId = useId();
  const [tab, setTab] = useState<'inputs' | 'style'>('inputs');
  const initial = () => ({ inputs: sanitizeInputs(mod, study.inputs), plots: { ...(study.plots ?? {}) }, hlines: { ...(study.hlines ?? {}) } });
  const [draft, setDraft] = useState(initial);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | { error: unknown }>('idle');
  // A save elsewhere (another tab, the defaults of another instance) resets the form only when the saved values change.
  const savedKey = JSON.stringify([study.uid, study.inputs, study.plots, study.hlines]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setDraft(initial()), [savedKey]);

  const setInput = (id: string, v: unknown) => setDraft((d) => ({ ...d, inputs: { ...d.inputs, [id]: v } }));
  const setPlot = (id: string, patch: Partial<PlotStyle>) => setDraft((d) => ({ ...d, plots: { ...d.plots, [id]: { ...d.plots[id], ...patch } } }));
  const setHline = (id: string, patch: Partial<HlineStyle>) => setDraft((d) => ({ ...d, hlines: { ...d.hlines, [id]: { ...d.hlines[id], ...patch } } }));
  const active = (cfg: InputConfig) => {
    try {
      return runtime.isInputActive(cfg, draft.inputs, mod.inputConfig);
    } catch {
      return true;
    }
  };
  const tip = (t?: string) =>
    t ? (
      <span className="inline-flex shrink-0 cursor-help text-faint" title={t} aria-hidden>
        <Info size={13} />
      </span>
    ) : null;

  const field = (cfg: InputConfig, inRow: boolean) => {
    const id = `${formId}-${cfg.id}`;
    const v = draft.inputs[cfg.id];
    const off = !active(cfg);
    const label = cfg.title ?? cfg.id;
    if (cfg.type === 'bool') {
      return (
        <label key={cfg.id} htmlFor={id} className={clsx('flex min-w-0 items-center gap-2.5 text-[13px]', off && 'opacity-55')}>
          <input id={id} type="checkbox" checked={Boolean(v)} disabled={off} title={cfg.tooltip} onChange={(e) => setInput(cfg.id, e.target.checked)} />
          <span className="text-muted">{label}</span>
          {tip(cfg.tooltip)}
        </label>
      );
    }
    let control;
    const options = cfg.options?.length ? cfg.options.map((o) => ({ value: o, label: o })) : cfg.type === 'source' ? SOURCES.map((s) => ({ value: s, label: s })) : cfg.type === 'timeframe' ? TF_OPTIONS : null;
    if (cfg.type === 'color') control = <ColorField label={label} value={String(v ?? '#000000')} onChange={(c) => setInput(cfg.id, c)} />;
    else if (options)
      control = (
        <select id={id} value={String(v ?? '')} disabled={off} title={cfg.tooltip} onChange={(e) => setInput(cfg.id, e.target.value)} className="w-40">
          {/* A saved value no longer in the list stays visible until changed. */}
          {!options.some((o) => o.value === String(v ?? '')) && <option value={String(v ?? '')}>{String(v ?? '')}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    else if (cfg.type === 'int' || cfg.type === 'float')
      control = (
        <input
          id={id}
          type="number"
          disabled={off}
          title={cfg.tooltip}
          step={cfg.type === 'int' ? 1 : (cfg.step ?? 'any')}
          min={cfg.min}
          max={cfg.max}
          value={typeof v === 'number' && Number.isFinite(v) ? v : ''}
          onChange={(e) => setInput(cfg.id, e.target.value === '' ? NaN : Number(e.target.value))}
          className="w-24 text-right disabled:opacity-60"
        />
      );
    else if (cfg.type === 'text_area')
      control = <textarea id={id} value={String(v ?? '')} disabled={off} maxLength={300} rows={3} onChange={(e) => setInput(cfg.id, e.target.value)} className="w-56" />;
    else if (cfg.type === 'time')
      control = (
        <input
          id={id}
          type="datetime-local"
          disabled={off}
          value={typeof v === 'number' && Number.isFinite(v) ? new Date(v).toISOString().slice(0, 16) : ''}
          onChange={(e) => setInput(cfg.id, e.target.value ? Date.parse(`${e.target.value}Z`) : NaN)}
        />
      );
    else control = <input id={id} value={String(v ?? '')} disabled={off} maxLength={300} title={cfg.tooltip} onChange={(e) => setInput(cfg.id, e.target.value)} className="w-40" spellCheck={false} />;
    return (
      <label key={cfg.id} htmlFor={id} className={clsx('flex items-center gap-3 text-[13px]', !inRow && 'justify-between', off && 'opacity-55')}>
        <span className="inline-flex items-center gap-1.5 text-muted">
          {label}
          {tip(cfg.tooltip)}
        </span>
        {control}
      </label>
    );
  };

  const save = async () => {
    // Only the inputs that apply are checked (an inactive one keeps its value, as in TradingView).
    const bad = mod.inputConfig
      .filter((cfg) => active(cfg) && inputProblem(cfg, draft.inputs[cfg.id]) !== null)
      .map((cfg) => {
        const range = (cfg.type === 'int' || cfg.type === 'float') && (cfg.min !== undefined || cfg.max !== undefined) ? ` (${cfg.min ?? '…'} – ${cfg.max ?? '…'})` : '';
        return `${cfg.title ?? cfg.id}${range}`;
      });
    if (bad.length) {
      setInvalid(`Valori invalide: ${bad.join(', ')}.`);
      setTab('inputs');
      return;
    }
    // FD-HLINELEVELS: a level left empty (or not a number) is refused with the line's name.
    const badLevels = styleHlines(mod).filter((h) => {
      const v = draft.hlines[h.id]?.price;
      return v !== undefined && (!Number.isFinite(v) || Math.abs(v) > 1e12);
    });
    if (badLevels.length) {
      setInvalid(`Nivel invalid: ${badLevels.map((h) => h.title ?? h.id).join(', ')}.`);
      setTab('style');
      return;
    }
    setInvalid(null);
    const clean = <T extends Record<string, unknown>>(r: Record<string, T>) => {
      const out: Record<string, T> = {};
      for (const [k, o] of Object.entries(r)) {
        const kept = Object.fromEntries(Object.entries(o).filter(([, x]) => x !== undefined)) as T;
        if (Object.keys(kept).length) out[k] = kept;
      }
      return Object.keys(out).length ? out : undefined;
    };
    const next: Study = { uid: study.uid, id: study.id, visible: study.visible, inputs: changedInputs(mod, draft.inputs) };
    const plots = clean(draft.plots);
    const hlines = clean(draft.hlines);
    if (plots) next.plots = plots;
    if (hlines) next.hlines = hlines;
    if (study.height !== undefined) next.height = study.height;
    setStatus('saving');
    try {
      await onSave(next);
      setStatus('saved');
    } catch (error) {
      setStatus({ error });
    }
  };

  const plots = stylePlots(mod);
  const hlines = styleHlines(mod);
  return (
    <form
      noValidate
      className="flex flex-1 flex-col overflow-y-auto overscroll-contain px-5 pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      aria-label={`Setările ${name}`}
    >
      <div className="seg mb-4 self-start" role="tablist" aria-label="Setări">
        {(['inputs', 'style'] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t === 'inputs' ? 'Intrări' : 'Stil'}
          </button>
        ))}
      </div>
      {tab === 'inputs' ? (
        mod.inputConfig.length === 0 ? (
          <p className="mb-4 text-[13px] text-faint">Indicatorul nu are intrări.</p>
        ) : (
          <>
            <p className="mb-4 text-[12.5px] text-faint">Aceleași nume, limite și valori implicite ca în TradingView.</p>
            {groupsOf(mod.inputConfig).map((g, gi) => (
              <fieldset key={`${g.title ?? ''}-${gi}`} className="mb-5">
                {g.title && <legend className="mb-2.5 text-[13.5px] font-semibold text-accent">{g.title}</legend>}
                <div className="flex flex-col gap-2.5">
                  {g.rows.map((row) =>
                    row.length > 1 ? (
                      <div key={row[0]?.id} className="flex flex-wrap items-center gap-x-4 gap-y-2">
                        {row.map((cfg) => field(cfg, true))}
                      </div>
                    ) : (
                      field(row[0] as InputConfig, false)
                    ),
                  )}
                </div>
              </fieldset>
            ))}
          </>
        )
      ) : (
        <div className="flex flex-col gap-2.5">
          {plots.length === 0 && hlines.length === 0 && <p className="text-[13px] text-faint">Nimic de stilizat.</p>}
          {plots.map((def) => {
            const o = draft.plots[def.id] ?? {};
            const shown = o.visible ?? !(def.display === 'none' || (typeof def.visible === 'boolean' && !def.visible) || (typeof def.visible === 'string' && draft.inputs[def.visible] === false));
            const palette = def.palette?.length ? def.palette : null;
            return (
              <div key={def.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-[13px]">
                <label className="flex min-w-0 items-center gap-2.5">
                  <input type="checkbox" checked={shown} onChange={(e) => setPlot(def.id, { visible: e.target.checked })} />
                  <span className="text-muted">{def.title || def.id}</span>
                </label>
                <span className="flex flex-wrap items-center gap-2">
                  {palette ? (
                    palette.map((c) => (
                      <ColorField key={c} label={`${def.title}: culoarea ${c}`} value={o.palette?.[c] ?? c} onChange={(v) => setPlot(def.id, { palette: { ...o.palette, [c]: v } })} />
                    ))
                  ) : (
                    <ColorField label={`${def.title}: culoare`} value={o.color ?? def.color} onChange={(v) => setPlot(def.id, { color: v })} />
                  )}
                  {lineKind(def) === 'line' && (
                    <LineStyleField label={def.title || def.id} value={o.style ?? def.linestyle ?? 'solid'} onChange={(v) => setPlot(def.id, { style: v })} />
                  )}
                  {lineKind(def) && <LineWidthField label={def.title || def.id} drawn={plotWidth(def)} value={o.width} onChange={(v) => setPlot(def.id, { width: v })} />}
                </span>
              </div>
            );
          })}
          {hlines.map((h) => {
            const o = draft.hlines[h.id] ?? {};
            return (
              <div key={h.id} className="flex flex-col gap-2 text-[13px]">
                {/* The name and its level on one line (FD-HLINELEVELS), the look of the line below: the drawer is narrow. */}
                <div className="flex items-center justify-between gap-3">
                  <label className="flex min-w-0 items-center gap-2.5">
                    <input type="checkbox" checked={hlineShown(h, o)} onChange={(e) => setHline(h.id, { visible: e.target.checked })} />
                    <span className="text-muted">{h.title || h.id}</span>
                  </label>
                  <label className="flex shrink-0 items-center gap-2">
                    <span className="text-faint">nivel</span>
                    <input
                      type="number"
                      step="any"
                      aria-label={`${h.title ?? h.id}: nivel`}
                      value={o.price === undefined ? h.price : Number.isFinite(o.price) ? o.price : ''}
                      onChange={(e) => setHline(h.id, { price: e.target.value === '' ? NaN : Number(e.target.value) })}
                      className="num w-[96px] text-right"
                    />
                  </label>
                </div>
                <span className="flex flex-wrap items-center gap-2">
                  <ColorField label={`${h.title ?? h.id}: culoare`} value={o.color ?? h.color ?? '#787B86'} onChange={(v) => setHline(h.id, { color: v })} />
                  <LineStyleField label={h.title ?? h.id} value={o.style ?? h.linestyle ?? 'solid'} onChange={(v) => setHline(h.id, { style: v })} />
                  <LineWidthField label={h.title ?? h.id} drawn={h.linewidth ?? 1} value={o.width} onChange={(v) => setHline(h.id, { width: v })} />
                </span>
              </div>
            );
          })}
        </div>
      )}
      {invalid && <div className="mt-3 text-[13px] text-bear">{invalid}</div>}
      {typeof status === 'object' && <div className="mt-3 text-[13px] text-bear">{errorMessage(status.error)}</div>}
      {status === 'saved' && !invalid && <div className="mt-3 text-[13px] text-bull">Setările au fost salvate.</div>}
      <div className="sticky bottom-0 z-10 -mx-5 mt-auto flex gap-2 border-t border-line bg-panel px-5 py-4">
        <button className="btn btn-primary" disabled={status === 'saving'}>
          Salvează
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setInvalid(null);
            setDraft({ inputs: { ...mod.defaultInputs }, plots: {}, hlines: {} });
          }}
        >
          Valorile implicite
        </button>
      </div>
    </form>
  );
}
