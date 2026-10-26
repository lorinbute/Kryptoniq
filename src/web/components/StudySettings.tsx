// The settings of one standard indicator (FD-INDICATORS §3): the "Intrări" tab with exactly TradingView's inputs (names,
// groups, defaults, limits, lists, tooltips; an input that depends on another greyed out while it does not apply) and the
// "Stil" tab with its lines and horizontal lines. "Salvează" applies and remembers; "Valorile implicite" fills the form.
import { useEffect, useId, useState } from 'react';
import { clsx } from 'clsx';
import type { IndicatorResult, InputConfig, PlotConfig } from 'oakscriptjs';
import type { LineStyleId, Study } from '../../shared/studies.ts';
import { TIMEFRAMES } from '../../shared/time.ts';
import { errorMessage } from '../api.ts';
import { changedInputs, inputProblem, pineTf, sanitizeInputs, SOURCES } from '../indicators/compute.ts';
import type { StudyModule } from '../indicators/catalog.ts';
import type { StudyRuntime } from '../indicators/runtime.ts';
import { hlineDefault, hlineShown, lineKind, plotWidth, styleFills, styleHlines, stylePlots } from '../indicators/style.ts';
import { colorKey, INPUT_COLORED, INPUT_LINES, lineInput, linkStyle } from '../indicators/color-links.ts';
import { ColorPicker } from './ColorPicker.tsx';
import { InfoTip } from './InfoTip.tsx';

/** FD-STYLEUNIFY: a line's style as the script declares it (TradingView's names), solid when it declares none. */
const styleId = (v: unknown): LineStyleId => (v === 'dashed' || v === 'dotted' ? v : 'solid');

type PlotStyle = NonNullable<Study['plots']>[string];
type HlineStyle = NonNullable<Study['hlines']>[string];
type FillStyle = NonNullable<Study['fills']>[string];

/** The timeframes an input can take: the chart's, Sentiq's, the month (from daily bars). */
const TF_OPTIONS: { value: string; label: string }[] = [{ value: '', label: 'Grafic' }, ...TIMEFRAMES.map((t) => ({ value: pineTf(t), label: t })), { value: '1M', label: '1M' }];

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

export function StudySettings({
  name,
  mod,
  runtime,
  study,
  result,
  onSave,
}: {
  name: string;
  mod: StudyModule;
  runtime: StudyRuntime;
  study: Study;
  /** Its current result: the fills it draws now are listed with the declared ones (FD-FILLS). */
  result: IndicatorResult | null;
  onSave: (next: Study) => Promise<unknown>;
}) {
  const formId = useId();
  const [tab, setTab] = useState<'inputs' | 'style'>('inputs');
  // FD-COLORUNIFY: in the linked form (a line's colour chosen before in Stil, where it is now its input's).
  const initial = () => {
    const st = linkStyle(study);
    return { inputs: sanitizeInputs(mod, st.inputs), plots: { ...(st.plots ?? {}) }, hlines: { ...(st.hlines ?? {}) }, fills: { ...(st.fills ?? {}) } };
  };
  const [draft, setDraft] = useState(initial);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | { error: unknown }>('idle');
  // A save elsewhere (another tab, the defaults of another instance) resets the form only when the saved values change.
  const savedKey = JSON.stringify([study.uid, study.inputs, study.plots, study.hlines, study.fills]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setDraft(initial()), [savedKey]);

  const setInput = (id: string, v: unknown) => setDraft((d) => ({ ...d, inputs: { ...d.inputs, [id]: v } }));
  const setPlot = (id: string, patch: Partial<PlotStyle>) => setDraft((d) => ({ ...d, plots: { ...d.plots, [id]: { ...d.plots[id], ...patch } } }));
  const setHline = (id: string, patch: Partial<HlineStyle>) => setDraft((d) => ({ ...d, hlines: { ...d.hlines, [id]: { ...d.hlines[id], ...patch } } }));
  const setFill = (key: string, patch: Partial<FillStyle>) => setDraft((d) => ({ ...d, fills: { ...d.fills, [key]: { ...d.fills[key], ...patch } } }));
  const active = (cfg: InputConfig) => {
    try {
      return runtime.isInputActive(cfg, draft.inputs, mod.inputConfig);
    } catch {
      return true;
    }
  };
  /**
   * FD-COLORUNIFY: a line's width and style in its box, written to every plot in `ids` (a colour input that colours
   * several lines sets them all; the box shows the first one's).
   */
  const lineBox = (def: PlotConfig, ids: readonly string[]) => {
    const o = draft.plots[def.id] ?? {};
    const all = (patch: Partial<PlotStyle>) => setDraft((d) => ({ ...d, plots: { ...d.plots, ...Object.fromEntries(ids.map((pid) => [pid, { ...d.plots[pid], ...patch }])) } }));
    return {
      ...(lineKind(def) ? { lineWidth: o.width ?? plotWidth(def), onLineWidth: (w: number) => all({ width: w }) } : {}),
      ...(lineKind(def) === 'line' ? { lineStyle: o.style ?? styleId(def.linestyle), onLineStyle: (st: LineStyleId) => all({ style: st }) } : {}),
    };
  };
  // FIX-INFOTIP: the Pine tooltip behind an (i), on hover and on a click or a tap.
  const tip = (t?: string) => (t ? <InfoTip text={t} /> : null);

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
    if (cfg.type === 'color') {
      // FD-COLORUNIFY: the colour of whole lines (MA Ribbon) is the same box as theirs in Stil: width and style too.
      const ids = INPUT_LINES[study.id]?.[cfg.id] ?? [];
      const line = ids.length ? mod.plotConfig.find((p) => p.id === ids[0]) : undefined;
      const boxName = label.trim() || line?.title || cfg.inline || cfg.id;
      control = <ColorPicker label={line ? `${boxName}: linie` : boxName} value={String(v ?? '#000000')} onChange={(c) => setInput(cfg.id, c)} {...(line ? lineBox(line, ids) : {})} />;
    } else if (options)
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
    const fills = clean(draft.fills);
    if (plots) next.plots = plots;
    if (hlines) next.hlines = hlines;
    if (fills) next.fills = fills;
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
  const fills = styleFills(mod, result);
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
          {plots.length === 0 && hlines.length === 0 && fills.length === 0 && <p className="text-[13px] text-faint">Nimic de stilizat.</p>}
          {plots.map((def) => {
            const o = draft.plots[def.id] ?? {};
            const shown = o.visible ?? !(def.display === 'none' || (typeof def.visible === 'boolean' && !def.visible) || (typeof def.visible === 'string' && draft.inputs[def.visible] === false));
            const palette = def.palette?.length ? def.palette : null;
            const title = def.title || def.id;
            // FD-COLORUNIFY: a line whose colour is an input (MA Ribbon) edits that input, as its box in Intrări does.
            const input = lineInput(study.id, def.id);
            const colored = INPUT_COLORED[study.id]?.[def.id];
            let boxes;
            if (input)
              boxes = <ColorPicker label={`${title}: linie`} value={String(draft.inputs[input] ?? def.color ?? '#2962FF')} onChange={(v) => setInput(input, v)} {...lineBox(def, [def.id])} />;
            else if (colored)
              // Coloured from the inputs by a calculation: the box shows those colours and says where they are chosen.
              boxes = (
                <ColorPicker
                  label={`${title}: culori`}
                  value={`linear-gradient(to right, ${colored.inputs.map((i) => String(draft.inputs[i] ?? '#787B86')).join(', ')})`}
                  colorNote={colored.note}
                  {...lineBox(def, [def.id])}
                />
              );
            else
              // FD-STYLEUNIFY: one box per colour, with the line's width (a line, a histogram…) and style (a line); a plot
              // of several colours has one box each, sharing the width and the style. A colour chosen before for the
              // plot's own colour shows in its palette box until that box is used (FD-COLORUNIFY B).
              boxes = (palette ?? [null]).map((c) => (
                <ColorPicker
                  key={c ?? 'color'}
                  label={c ? `${title}: culoarea ${c}` : `${title}: culoare`}
                  value={c ? (o.palette?.[c] ?? (o.color && def.color && colorKey(def.color) === colorKey(c) ? o.color : c)) : (o.color ?? def.color ?? '#2962FF')}
                  onChange={(v) => setPlot(def.id, c ? { palette: { ...o.palette, [c]: v } } : { color: v })}
                  {...lineBox(def, [def.id])}
                />
              ));
            return (
              <div key={def.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-[13px]">
                <label className="flex min-w-0 items-center gap-2.5">
                  <input type="checkbox" checked={shown} onChange={(e) => setPlot(def.id, { visible: e.target.checked })} />
                  <span className="text-muted">{title}</span>
                </label>
                <span className="flex flex-wrap items-center gap-2">{boxes}</span>
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
                  <ColorPicker
                    label={`${h.title ?? h.id}: culoare`}
                    value={o.color ?? hlineDefault(mod, h, result)}
                    onChange={(v) => setHline(h.id, { color: v })}
                    lineWidth={o.width ?? h.linewidth ?? 1}
                    onLineWidth={(w) => setHline(h.id, { width: w })}
                    lineStyle={o.style ?? styleId(h.linestyle)}
                    onLineStyle={(st) => setHline(h.id, { style: st })}
                  />
                </span>
              </div>
            );
          })}
          {fills.length > 0 && (
            // FD-FILLS: each fill shown or hidden; a single-coloured one also gets its colour, with its opacity.
            <fieldset className="mt-2 flex flex-col gap-2.5">
              <legend className="mb-2 text-[13px] font-semibold text-accent">Umpleri</legend>
              {fills.map((f) => {
                const o = draft.fills[f.key] ?? {};
                return (
                  <div key={f.key} className="flex items-center justify-between gap-3 text-[13px]">
                    <label className="flex min-w-0 items-center gap-2.5">
                      <input type="checkbox" className="shrink-0" checked={o.visible ?? true} onChange={(e) => setFill(f.key, { visible: e.target.checked })} />
                      <span className="truncate text-muted" title={f.title}>
                        {f.title}
                      </span>
                    </label>
                    {f.color !== null && <ColorPicker label={`${f.title}: culoare`} value={o.color ?? f.color} onChange={(v) => setFill(f.key, { color: v })} />}
                  </div>
                );
              })}
            </fieldset>
          )}
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
            setDraft({ inputs: { ...mod.defaultInputs }, plots: {}, hlines: {}, fills: {} });
          }}
        >
          Valorile implicite
        </button>
      </div>
    </form>
  );
}
