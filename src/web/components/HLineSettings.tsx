// The settings of one horizontal line (FD-HLINE §4): TradingView's Style, Text, Coordinates and Visibility, one under
// the other in the side panel. Every change shows on the chart at once (preview); "Salvează" keeps it, "Anulează" (or
// closing the panel) puts back what was saved.
import { useEffect, useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { Bold, Italic } from 'lucide-react';
import { HLINE_DEFAULT_STYLE, HLINE_H_ALIGNS, HLINE_STYLES, HLINE_TEXT_SIZES, HLINE_UNIT_IDS, HLINE_UNITS, HLINE_V_ALIGNS, hlineSchema, styleOf, type HLine, type HLineStyle, type HLineUnit } from '../../shared/hlines.ts';
import { errorMessage } from '../api.ts';

const STYLE_RO: Record<HLine['style'], string> = { solid: 'Continuă', dashed: 'Liniuțe', dotted: 'Puncte' };
const V_RO: Record<HLine['vAlign'], string> = { top: 'Sus', middle: 'Mijloc', bottom: 'Jos' };
const H_RO: Record<HLine['hAlign'], string> = { left: 'Stânga', center: 'Centru', right: 'Dreapta' };
const UNIT_RO: Record<HLineUnit, { label: string; tfs: string }> = {
  minutes: { label: 'Minute', tfs: '1m, 3m, 5m, 15m, 30m' },
  hours: { label: 'Ore', tfs: '1h, 2h, 4h, 6h, 8h, 12h' },
  days: { label: 'Zile', tfs: '1d' },
  weeks: { label: 'Săptămâni', tfs: '1w' },
};

/** #RRGGBB of a colour (the picker has no alpha) and its "AA" suffix, kept on a change. */
const splitAlpha = (c: string) => ({ hex: c.slice(0, 7), alpha: c.slice(7) });

function Color({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const { hex, alpha } = splitAlpha(value);
  return <input type="color" aria-label={label} value={hex.toLowerCase()} onChange={(e) => onChange(`${e.target.value.toUpperCase()}${alpha.toUpperCase()}`)} className="h-8 w-12 shrink-0 p-1" />;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="mb-5 flex flex-col gap-3">
      <legend className="mb-2 text-[13px] font-semibold text-accent">{title}</legend>
      {children}
    </fieldset>
  );
}

/** Why a draft cannot be saved (the first problem, in words), or null. */
function problemOf(d: HLine): string | null {
  if (!Number.isFinite(d.price) || d.price <= 0) return 'Prețul trebuie să fie un număr pozitiv.';
  for (const u of HLINE_UNIT_IDS) {
    const r = d.visibility[u];
    const { min, max } = HLINE_UNITS[u];
    if (!Number.isInteger(r.from) || !Number.isInteger(r.to) || r.from < min || r.to > max) return `${UNIT_RO[u].label}: intervalul trebuie să fie între ${min} și ${max}.`;
    if (r.from > r.to) return `${UNIT_RO[u].label}: „de la” trebuie să fie cel mult „până la”.`;
  }
  return hlineSchema.safeParse(d).success ? null : 'Setările nu sunt valide.';
}

export function HLineSettings({
  line,
  precision,
  template,
  onDraft,
  onSave,
  onSaveTemplate,
  onDelete,
  onCancel,
}: {
  /** The line as saved. */
  line: HLine;
  precision: number;
  template: HLineStyle | null;
  /** The draft to preview on the chart (only a valid one). */
  onDraft: (d: HLine) => void;
  onSave: (next: HLine) => Promise<unknown>;
  onSaveTemplate: (style: HLineStyle) => Promise<unknown>;
  onDelete: () => Promise<unknown>;
  /** Back to the saved line, and the panel closes. */
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<HLine>(line);
  // The price as typed (a half-typed "2." stays as it is).
  const [priceText, setPriceText] = useState(line.price.toFixed(precision));
  const [busy, setBusy] = useState<'save' | 'delete' | 'template' | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const problem = useMemo(() => problemOf(draft), [draft]);
  // The line dragged on the chart while its panel is open: the form takes the new price.
  useEffect(() => {
    setDraft((d) => (d.price === line.price ? d : { ...d, price: line.price }));
    setPriceText(line.price.toFixed(precision));
  }, [line.price, precision]);
  useEffect(() => {
    if (!problem) onDraft(draft);
  }, [draft, problem, onDraft]);

  const set = (patch: Partial<HLine>) => {
    setNote(null);
    setDraft((d) => ({ ...d, ...patch }));
  };
  const setUnit = (u: HLineUnit, patch: Partial<HLine['visibility'][HLineUnit]>) => set({ visibility: { ...draft.visibility, [u]: { ...draft.visibility[u], ...patch } } });
  const applyStyle = (st: HLineStyle) => set({ ...styleOf(st) });
  const run = async (what: 'save' | 'delete' | 'template', fn: () => Promise<unknown>, done: string) => {
    setBusy(what);
    setNote(null);
    try {
      await fn();
      setNote({ ok: true, text: done });
    } catch (err) {
      setNote({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  };
  const allOff = HLINE_UNIT_IDS.every((u) => !draft.visibility[u].on);
  const step = precision > 0 ? Number(`1e-${precision}`) : 1;

  return (
    <form
      noValidate
      className="flex flex-1 flex-col overflow-y-auto overscroll-contain px-5 pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!problem) void run('save', () => onSave(draft), 'Linia a fost salvată.');
      }}
    >
      <Section title="Linie">
        <div className="flex flex-wrap items-center gap-2">
          <Color label="Culoarea liniei" value={draft.color} onChange={(color) => set({ color })} />
          <select aria-label="Grosimea liniei" value={draft.width} onChange={(e) => set({ width: Number(e.target.value) })} className="w-[84px]">
            {[1, 2, 3, 4].map((w) => (
              <option key={w} value={w}>
                {w} px
              </option>
            ))}
          </select>
          <select aria-label="Tipul liniei" value={draft.style} onChange={(e) => set({ style: e.target.value as HLine['style'] })} className="w-[110px]">
            {HLINE_STYLES.map((s) => (
              <option key={s} value={s}>
                {STYLE_RO[s]}
              </option>
            ))}
          </select>
        </div>
        <label className="inline-flex items-center gap-2.5 text-[13.5px]">
          <input type="checkbox" checked={draft.priceLabel} onChange={(e) => set({ priceLabel: e.target.checked })} /> Eticheta prețului
        </label>
      </Section>

      <Section title="Text">
        <div className="flex flex-wrap items-center gap-2">
          <Color label="Culoarea textului" value={draft.textColor} onChange={(textColor) => set({ textColor })} />
          <select aria-label="Mărimea textului" value={draft.textSize} onChange={(e) => set({ textSize: Number(e.target.value) })} className="w-[84px]">
            {HLINE_TEXT_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <button type="button" aria-label="Îngroșat" title="Îngroșat" aria-pressed={draft.bold} onClick={() => set({ bold: !draft.bold })} className={clsx('btn w-[38px] px-0', draft.bold && 'border-accent bg-hover text-accent')}>
            <Bold size={15} aria-hidden />
          </button>
          <button type="button" aria-label="Cursiv" title="Cursiv" aria-pressed={draft.italic} onClick={() => set({ italic: !draft.italic })} className={clsx('btn w-[38px] px-0', draft.italic && 'border-accent bg-hover text-accent')}>
            <Italic size={15} aria-hidden />
          </button>
        </div>
        <textarea aria-label="Textul liniei" placeholder="Adaugă text" rows={3} maxLength={500} value={draft.text} onChange={(e) => set({ text: e.target.value })} className="w-full resize-y" />
        <div className="flex flex-wrap items-center gap-2 text-[13.5px]">
          <span className="text-muted">Aliniere</span>
          <select aria-label="Alinierea verticală a textului" value={draft.vAlign} onChange={(e) => set({ vAlign: e.target.value as HLine['vAlign'] })} className="w-[104px]">
            {HLINE_V_ALIGNS.map((a) => (
              <option key={a} value={a}>
                {V_RO[a]}
              </option>
            ))}
          </select>
          <select aria-label="Alinierea orizontală a textului" value={draft.hAlign} onChange={(e) => set({ hAlign: e.target.value as HLine['hAlign'] })} className="w-[110px]">
            {HLINE_H_ALIGNS.map((a) => (
              <option key={a} value={a}>
                {H_RO[a]}
              </option>
            ))}
          </select>
        </div>
      </Section>

      <Section title="Preț">
        <input
          aria-label="Prețul liniei"
          type="number"
          inputMode="decimal"
          step={step}
          value={priceText}
          onChange={(e) => {
            setPriceText(e.target.value);
            set({ price: e.target.value.trim() === '' ? NaN : Number(e.target.value) });
          }}
          className="w-40 text-right"
        />
      </Section>

      <Section title="Vizibilitate">
        {HLINE_UNIT_IDS.map((u) => {
          const r = draft.visibility[u];
          const { min, max } = HLINE_UNITS[u];
          return (
            <div key={u} className="flex flex-col gap-1 text-[13.5px]">
              <div className="flex items-center gap-2">
                <label className="inline-flex w-[120px] items-center gap-2.5" title={UNIT_RO[u].tfs}>
                  <input type="checkbox" checked={r.on} onChange={(e) => setUnit(u, { on: e.target.checked })} /> {UNIT_RO[u].label}
                </label>
                <input
                  aria-label={`${UNIT_RO[u].label}: de la`}
                  type="number"
                  min={min}
                  max={max}
                  step={1}
                  disabled={!r.on}
                  value={Number.isFinite(r.from) ? r.from : ''}
                  onChange={(e) => setUnit(u, { from: e.target.value === '' ? NaN : Number(e.target.value) })}
                  className="w-[72px] text-right disabled:opacity-60"
                />
                <span className="text-faint">–</span>
                <input
                  aria-label={`${UNIT_RO[u].label}: până la`}
                  type="number"
                  min={min}
                  max={max}
                  step={1}
                  disabled={!r.on}
                  value={Number.isFinite(r.to) ? r.to : ''}
                  onChange={(e) => setUnit(u, { to: e.target.value === '' ? NaN : Number(e.target.value) })}
                  className="w-[72px] text-right disabled:opacity-60"
                />
              </div>
              {/* Sentiq's timeframes of this unit, always under the row. */}
              <span className="pl-[30px] text-[12px] text-faint">{UNIT_RO[u].tfs}</span>
            </div>
          );
        })}
        {allOff && <p className="text-[12.5px] text-warn">Cu toate debifate, linia nu apare pe niciun interval.</p>}
      </Section>

      <Section title="Șablon">
        <p className="-mt-1 text-[12.5px] text-faint">Stilul (fără preț și text) cu care încep liniile noi.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn" disabled={busy !== null || problem !== null} onClick={() => void run('template', () => onSaveTemplate(styleOf(draft)), 'Șablonul a fost salvat: liniile noi încep cu acest stil.')}>
            Salvează ca șablon
          </button>
          <button type="button" className="btn" disabled={!template} title={template ? undefined : 'Nu ai salvat încă un șablon.'} onClick={() => template && applyStyle(template)}>
            Aplică șablonul
          </button>
          <button type="button" className="btn" onClick={() => applyStyle(HLINE_DEFAULT_STYLE)}>
            Stilul inițial
          </button>
        </div>
      </Section>

      {problem && <div className="mb-2 text-[13px] text-bear">{problem}</div>}
      {note && <div className={clsx('mb-2 text-[13px]', note.ok ? 'text-bull' : 'text-bear')}>{note.text}</div>}
      <div className="sticky bottom-0 z-10 -mx-5 mt-auto flex flex-wrap gap-2 border-t border-line bg-panel px-5 py-4">
        <button className="btn btn-primary" disabled={busy !== null || problem !== null}>
          Salvează
        </button>
        <button type="button" className="btn" disabled={busy !== null} onClick={onCancel}>
          Anulează
        </button>
        <button
          type="button"
          className="btn ml-auto text-bear hover:border-bear"
          disabled={busy !== null}
          onClick={() => {
            if (window.confirm('Ștergi linia de pe grafic?')) void run('delete', onDelete, 'Linia a fost ștearsă.');
          }}
        >
          Șterge linia
        </button>
      </div>
    </form>
  );
}
