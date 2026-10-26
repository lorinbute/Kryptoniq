// FD-CHARTSETTINGS: the chart's settings, as TradingView's "Settings…" window: the tabs on the left (on a phone, a row on
// top), the options on the right, "Renunță" and "OK" at the bottom. Every change shows on the chart at once (the page
// stays sharp behind the window); OK saves them on the account, anything else (Renunță, ×, Esc, a click outside) puts
// back what was saved.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { AlarmClock, ChartCandlestick, Loader2, Paintbrush, PanelTop, RotateCcw } from 'lucide-react';
import { BUTTON_VISIBILITY, DEFAULT_CHART_STYLE, SCALE_FONT_SIZES, TITLE_MODES, type ButtonVisibility, type ChartStyle } from '../../shared/chart-style.ts';
import { errorMessage } from '../api.ts';
import { useMediaQuery } from '../media.ts';
import { fade } from '../color.ts';
import { themeColors } from '../theme.ts';
import { ColorPicker } from './ColorPicker.tsx';
import { Modal } from './Modal.tsx';

const TABS = [
  { id: 'symbol', label: 'Simbol', icon: ChartCandlestick },
  { id: 'status', label: 'Linia de stare', icon: PanelTop },
  { id: 'canvas', label: 'Canvas', icon: Paintbrush },
  { id: 'alerts', label: 'Alerte', icon: AlarmClock },
] as const;
type Tab = (typeof TABS)[number]['id'];

const TITLE_RO: Record<(typeof TITLE_MODES)[number], string> = { symbol: 'Simbol', name: 'Nume', both: 'Simbol și nume' };
const BUTTONS_RO: Record<ButtonVisibility, string> = { hover: 'Vizibile la mouse', always: 'Mereu vizibile', never: 'Ascunse' };
/** The decimals as TradingView lists them: 1, 0,1, 0,01… */
const stepText = (n: number) => (n === 0 ? '1' : `0,${'0'.repeat(n - 1)}1`);

/** A section, as in the indicators' settings. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="mb-6 flex flex-col gap-3 last:mb-0">
      <legend className="mb-2.5 text-[13px] font-semibold text-accent">{title}</legend>
      {children}
    </fieldset>
  );
}

/**
 * One option: its name (with a box to tick, when it can be turned off) and its controls. The controls make a column, as
 * in TradingView, from 640 px; narrower they go to the right, or under the name when they do not fit beside it. A name
 * without controls takes the whole row.
 */
function Row({ label, check, indent = false, children }: { label: string; check?: { on: boolean; set: (on: boolean) => void; disabled?: boolean }; indent?: boolean; children?: ReactNode }) {
  const name = check ? (
    <label className={clsx('flex min-w-0 items-start gap-2.5', indent && 'pl-[26px]', check.disabled && 'opacity-55', !children && 'col-span-full')}>
      {/* The box on the first line's middle, however the name wraps. */}
      <span className="flex h-[1lh] shrink-0 items-center">
        <input type="checkbox" checked={check.on} disabled={check.disabled} onChange={(e) => check.set(e.target.checked)} />
      </span>
      <span>{label}</span>
    </label>
  ) : (
    <span className={clsx('min-w-0', indent && 'pl-[26px]', !children && 'col-span-full')}>{label}</span>
  );
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13.5px] sm:grid sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]">
      {name}
      {children && <span className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2 sm:ml-0 sm:justify-start">{children}</span>}
    </div>
  );
}

/** A whole number typed in a box: kept while valid, put back to the last valid one when the box is left. */
function NumberBox({ label, value, min, max, unit, onChange }: { label: string; value: number; min: number; max: number; unit: string; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    setText(String(value));
  }, [value]);
  return (
    <span className="flex items-center gap-2">
      <input
        type="number"
        inputMode="numeric"
        aria-label={label}
        min={min}
        max={max}
        step={1}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value.trim() !== '' && Number.isInteger(n) && n >= min && n <= max) onChange(n);
        }}
        onBlur={() => setText(String(value))}
        className="num w-[84px] text-right"
      />
      <span className="w-8 text-faint">{unit}</span>
    </span>
  );
}

export function ChartSettingsDialog({
  saved,
  pairPrecision,
  accountTz,
  onPreview,
  onSave,
  onClose,
}: {
  /** The settings as saved. */
  saved: ChartStyle;
  /** The pair's own decimals (the "default" precision). */
  pairPrecision: number;
  /** The account's time zone (the chart's default one). */
  accountTz: string;
  /** What to show on the chart while the window is open. */
  onPreview: (look: ChartStyle) => void;
  onSave: (look: ChartStyle) => Promise<unknown>;
  /** Closed: the chart back to `saved` (after OK, `saved` is the new one). */
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>('symbol');
  const [draft, setDraft] = useState<ChartStyle>(saved);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tabs = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    onPreview(draft);
  }, [draft, onPreview]);
  // Another tab starts at its top; on a phone's row of tabs, the chosen one is always in sight (braces: Chrome's
  // scrollIntoView returns a promise, which React would take for the effect's cleanup).
  useEffect(() => {
    panel.current?.scrollTo({ top: 0 });
    void tabs.current?.querySelector(`#chart-settings-tab-${tab}`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [tab]);
  const zones = useMemo(() => (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [], []);
  // The tabs: a column from 640 px, a row on a phone.
  const column = useMediaQuery('(min-width: 640px)');

  const c = themeColors();
  const k = draft.candles;
  const st = draft.status;
  const cv = draft.canvas;
  // Each change from the draft as it is then (two quick ones both count).
  const update = (fn: (d: ChartStyle) => ChartStyle) => {
    setError(null);
    setDraft(fn);
  };
  const set = <K extends keyof ChartStyle>(key: K, patch: Partial<ChartStyle[K]>) => update((d) => ({ ...d, [key]: { ...(d[key] as object), ...patch } }));
  const setCandles = (part: 'body' | 'borders' | 'wick', patch: Partial<ChartStyle['candles']['body']>) => update((d) => ({ ...d, candles: { ...d.candles, [part]: { ...d.candles[part], ...patch } } }));
  const setCanvas = <K extends keyof ChartStyle['canvas']>(key: K, patch: Partial<ChartStyle['canvas'][K]>) => update((d) => ({ ...d, canvas: { ...d.canvas, [key]: { ...(d.canvas[key] as object), ...patch } } }));
  const setStatus = (patch: Partial<ChartStyle['status']>) => set('status', patch);

  const resetTab = () =>
    update((d) =>
      tab === 'symbol'
        ? { ...d, candles: DEFAULT_CHART_STYLE.candles, precision: DEFAULT_CHART_STYLE.precision, timezone: DEFAULT_CHART_STYLE.timezone }
        : tab === 'status'
          ? { ...d, status: DEFAULT_CHART_STYLE.status }
          : tab === 'canvas'
            ? { ...d, canvas: DEFAULT_CHART_STYLE.canvas }
            : { ...d, alerts: DEFAULT_CHART_STYLE.alerts },
    );
  const ok = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };
  // The tabs as one control: the arrows move along them, Home / End to the ends (as a tab list should).
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = TABS.findIndex((t) => t.id === tab);
    const next = { ArrowDown: i + 1, ArrowRight: i + 1, ArrowUp: i - 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const t = TABS[(next + TABS.length) % TABS.length] as (typeof TABS)[number];
    setTab(t.id);
    tabs.current?.querySelector<HTMLElement>(`#chart-settings-tab-${t.id}`)?.focus();
  };

  return (
    <Modal title="Setări" onClose={onClose} width={720} locked={saving} clear flush>
      <div className="flex h-[540px] min-h-0 shrink flex-col sm:flex-row">
        <div
          ref={tabs}
          role="tablist"
          aria-label="Setările graficului"
          aria-orientation={column ? 'vertical' : 'horizontal'}
          onKeyDown={onTabKey}
          className="flex shrink-0 gap-1 overflow-x-auto overscroll-contain border-b border-line px-3 py-2 sm:w-[184px] sm:flex-col sm:overflow-visible sm:border-r sm:border-b-0 sm:py-3"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              id={`chart-settings-tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              aria-controls="chart-settings-panel"
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => setTab(t.id)}
              className={clsx('flex h-9 shrink-0 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] whitespace-nowrap transition-colors sm:px-3', tab === t.id ? 'bg-hover font-medium text-text' : 'text-muted hover:bg-hover hover:text-text')}
            >
              {/* On a phone the names alone, so the four fit on the row. */}
              <t.icon size={16} className="hidden shrink-0 sm:block" aria-hidden />
              {t.label}
            </button>
          ))}
        </div>
        <div ref={panel} id="chart-settings-panel" role="tabpanel" aria-labelledby={`chart-settings-tab-${tab}`} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          {tab === 'symbol' && (
            <>
              <Section title="Lumânări">
                <Row label="Colorează lumânările după închiderea anterioară" check={{ on: k.prevClose, set: (on) => set('candles', { prevClose: on }) }} />
                {(
                  [
                    ['body', 'Corp'],
                    ['borders', 'Margini'],
                    ['wick', 'Fitil'],
                  ] as const
                ).map(([part, label]) => (
                  <Row key={part} label={label} check={{ on: k[part].visible, set: (on) => setCandles(part, { visible: on }) }}>
                    <ColorPicker label={`${label}: creștere`} value={k[part].up} onChange={(up) => setCandles(part, { up })} />
                    <ColorPicker label={`${label}: scădere`} value={k[part].down} onChange={(down) => setCandles(part, { down })} />
                  </Row>
                ))}
              </Section>
              <Section title="Modificarea datelor">
                <Row label="Precizia">
                  <select
                    aria-label="Precizia"
                    value={String(draft.precision)}
                    onChange={(e) => {
                      const v = e.target.value;
                      update((d) => ({ ...d, precision: v === 'default' ? 'default' : Number(v) }));
                    }}
                    className="w-[180px]"
                  >
                    <option value="default">Implicită ({stepText(pairPrecision)})</option>
                    {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                      <option key={n} value={n}>
                        {stepText(n)}
                      </option>
                    ))}
                  </select>
                </Row>
                <Row label="Fusul orar">
                  <select
                    aria-label="Fusul orar"
                    value={draft.timezone ?? ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      update((d) => ({ ...d, timezone: v || null }));
                    }}
                    className="w-[264px] max-w-full"
                  >
                    <option value="">Al contului ({accountTz})</option>
                    {(draft.timezone && !zones.includes(draft.timezone) ? [draft.timezone, ...zones] : zones).map((z) => (
                      <option key={z} value={z}>
                        {z}
                      </option>
                    ))}
                  </select>
                </Row>
              </Section>
            </>
          )}

          {tab === 'status' && (
            <>
              <Section title="Simbol">
                <Row label="Logo" check={{ on: st.logo, set: (logo) => setStatus({ logo }) }} />
                <Row label="Titlul" check={{ on: st.title, set: (title) => setStatus({ title }) }}>
                  <select aria-label="Titlul ca" value={st.titleMode} disabled={!st.title} onChange={(e) => setStatus({ titleMode: e.target.value as ChartStyle['status']['titleMode'] })} className="w-[180px] disabled:opacity-55">
                    {TITLE_MODES.map((m) => (
                      <option key={m} value={m}>
                        {TITLE_RO[m]}
                      </option>
                    ))}
                  </select>
                </Row>
                <Row label="Starea pieței" check={{ on: st.marketStatus, set: (marketStatus) => setStatus({ marketStatus }) }} />
                <Row label="Valorile lumânării" check={{ on: st.values, set: (values) => setStatus({ values }) }} />
                <Row label="Variația lumânării" check={{ on: st.barChange, set: (barChange) => setStatus({ barChange }) }} />
                <Row label="Volumul" check={{ on: st.volume, set: (volume) => setStatus({ volume }) }} />
                <Row label="Variația față de ziua precedentă" check={{ on: st.dayChange, set: (dayChange) => setStatus({ dayChange }) }} />
              </Section>
              <Section title="Indicatori">
                <Row label="Titlurile" check={{ on: st.indicatorTitles, set: (indicatorTitles) => setStatus({ indicatorTitles }) }} />
                <Row label="Parametrii" indent check={{ on: st.indicatorInputs, set: (indicatorInputs) => setStatus({ indicatorInputs }), disabled: !st.indicatorTitles }} />
                <Row label="Valorile" check={{ on: st.indicatorValues, set: (indicatorValues) => setStatus({ indicatorValues }) }} />
                <Row label="Fundalul" check={{ on: st.indicatorBackground, set: (indicatorBackground) => setStatus({ indicatorBackground }) }}>
                  <input
                    type="range"
                    aria-label="Opacitatea fundalului"
                    min={0}
                    max={100}
                    step={1}
                    value={st.backgroundOpacity}
                    disabled={!st.indicatorBackground}
                    onChange={(e) => setStatus({ backgroundOpacity: Number(e.target.value) })}
                    className="w-[128px] accent-accent disabled:opacity-55"
                  />
                  <span className="num w-10 text-right text-muted">{st.backgroundOpacity}%</span>
                </Row>
              </Section>
            </>
          )}

          {tab === 'canvas' && (
            <>
              <Section title="Stilurile graficului">
                <Row label="Fundal">
                  <select aria-label="Tipul fundalului" value={cv.background.type} onChange={(e) => setCanvas('background', { type: e.target.value as 'solid' | 'gradient' })} className="w-[120px]">
                    <option value="solid">Plin</option>
                    <option value="gradient">Degrade</option>
                  </select>
                  <ColorPicker label={cv.background.type === 'gradient' ? 'Fundal: sus' : 'Fundal'} value={cv.background.top ?? c.background} onChange={(top) => setCanvas('background', { top })} />
                  {cv.background.type === 'gradient' && <ColorPicker label="Fundal: jos" value={cv.background.bottom ?? c.background} onChange={(bottom) => setCanvas('background', { bottom })} />}
                </Row>
                {(
                  [
                    ['vertGrid', 'Liniile grilei verticale'],
                    ['horzGrid', 'Liniile grilei orizontale'],
                  ] as const
                ).map(([key, label]) => (
                  <Row key={key} label={label} check={{ on: cv[key].visible, set: (visible) => setCanvas(key, { visible }) }}>
                    <ColorPicker label={label} value={cv[key].color ?? c.line} onChange={(color) => setCanvas(key, { color })} lineStyle={cv[key].style} onLineStyle={(style) => setCanvas(key, { style })} />
                  </Row>
                ))}
                <Row label="Separatoarele panourilor">
                  <ColorPicker label="Separatoarele panourilor" value={cv.separators ?? c.line} onChange={(separators) => set('canvas', { separators })} />
                </Row>
                <Row label="Cursorul în cruce">
                  <ColorPicker
                    label="Cursorul în cruce"
                    value={cv.crosshair.color ?? c.text}
                    onChange={(color) => setCanvas('crosshair', { color })}
                    lineWidth={cv.crosshair.width}
                    onLineWidth={(width) => setCanvas('crosshair', { width })}
                    lineStyle={cv.crosshair.style}
                    onLineStyle={(style) => setCanvas('crosshair', { style })}
                  />
                </Row>
                <Row label="Filigran" check={{ on: cv.watermark.visible, set: (visible) => setCanvas('watermark', { visible }) }}>
                  <ColorPicker label="Filigran" value={cv.watermark.color ?? fade(c.text, 0.12)} onChange={(color) => setCanvas('watermark', { color })} />
                </Row>
              </Section>
              <Section title="Scale">
                <Row label="Text">
                  <ColorPicker label="Textul scalelor" value={cv.scaleText.color ?? c.text} onChange={(color) => setCanvas('scaleText', { color })} />
                  <select aria-label="Mărimea textului scalelor" value={cv.scaleText.size} onChange={(e) => setCanvas('scaleText', { size: Number(e.target.value) })} className="w-[84px]">
                    {SCALE_FONT_SIZES.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </Row>
                <Row label="Linii">
                  <ColorPicker label="Liniile scalelor" value={cv.scaleLines ?? c.line} onChange={(scaleLines) => set('canvas', { scaleLines })} />
                </Row>
              </Section>
              <Section title="Butoane">
                {(
                  [
                    ['navigation', 'Navigare'],
                    ['paneButtons', 'Panou'],
                  ] as const
                ).map(([key, label]) => (
                  <Row key={key} label={label}>
                    <select aria-label={`Butoanele: ${label.toLowerCase()}`} value={cv[key]} onChange={(e) => set('canvas', { [key]: e.target.value as ButtonVisibility })} className="w-[180px]">
                      {BUTTON_VISIBILITY.map((v) => (
                        <option key={v} value={v}>
                          {BUTTONS_RO[v]}
                        </option>
                      ))}
                    </select>
                  </Row>
                ))}
              </Section>
              <Section title="Margini">
                <Row label="Sus">
                  <NumberBox label="Marginea de sus" value={cv.margins.top} min={0} max={40} unit="%" onChange={(top) => setCanvas('margins', { top })} />
                </Row>
                <Row label="Jos">
                  <NumberBox label="Marginea de jos" value={cv.margins.bottom} min={0} max={40} unit="%" onChange={(bottom) => setCanvas('margins', { bottom })} />
                </Row>
                <Row label="Dreapta">
                  <NumberBox label="Marginea din dreapta" value={cv.margins.right} min={0} max={200} unit="bare" onChange={(right) => setCanvas('margins', { right })} />
                </Row>
              </Section>
            </>
          )}

          {tab === 'alerts' && (
            <Section title="Notificări">
              <Row label="Ascunde automat mesajele" check={{ on: draft.alerts.autoHideToasts, set: (autoHideToasts) => set('alerts', { autoHideToasts }) }} />
              <p className="text-[12.5px] text-faint">Debifat, mesajele de jos (de exemplu „Modificat.”) rămân până le închizi cu ×.</p>
              <Row label="Sunet la închiderea unui trade" check={{ on: draft.alerts.tradeSound, set: (tradeSound) => set('alerts', { tradeSound }) }} />
              <p className="text-[12.5px] text-faint">Un trade terminat (stop loss, take profit sau închis de tine), în oricare cont, cât timp graficul e deschis și se vede.</p>
            </Section>
          )}
        </div>
      </div>
      {error && (
        <div role="alert" className="border-t border-line px-5 py-2.5 text-[13px] text-bear">
          {error}
        </div>
      )}
      <div className="flex shrink-0 items-center gap-2 border-t border-line px-5 py-3">
        <button type="button" className="btn" disabled={saving} onClick={resetTab} aria-label="Valorile implicite" title="Pune tab-ul acesta la valorile implicite">
          <RotateCcw size={15} aria-hidden />
          <span className="hidden min-[420px]:inline">Valorile implicite</span>
        </button>
        <span className="flex-1" />
        <button type="button" className="btn" disabled={saving} onClick={onClose}>
          Renunță
        </button>
        <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void ok()}>
          {saving && <Loader2 size={15} className="animate-spin" aria-hidden />}
          OK
        </button>
      </div>
    </Modal>
  );
}
