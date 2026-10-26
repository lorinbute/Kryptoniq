// A colour box with its opacity (FD-OPACITY), its panel as TradingView's (FD-CHARTSETTINGS): the colour over a
// checkerboard, so a see-through one shows as such; a click opens a small panel over the page (it never pushes anything)
// with TradingView's palette (greys, base colours, six rows of shades), the colours of one's own (+: any colour, by its
// hex code or the browser's picker; kept in this browser), the opacity, and a line's style where the colour is a line's.
// FD-STYLEUNIFY: the one control for a line everywhere: its colour, opacity, width (1–4 px) and style in one box, as in
// TradingView; a colour that comes from elsewhere (a line coloured by its state) shows in the box but is not chosen here.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { overlayRoot } from '../chart/fullscreen.ts';
import { clsx } from 'clsx';
import { Plus } from 'lucide-react';
import type { ChartLineStyle } from '../../shared/chart-style.ts';
import { alphaToPercent, formatColor, parseColor, percentToAlpha } from '../color.ts';

/** The checkerboard behind a colour, as colour pickers show transparency. */
export const CHECKER = 'repeating-conic-gradient(#9aa0a6 0% 25%, #ffffff 0% 50%) 50% / 10px 10px';
/** Space kept between the panel and the window's edges, and between it and the box. */
const MARGIN = 8;
const GAP = 6;

/** TradingView's palette: a row of greys, a row of base colours, six rows of their shades (light to dark). */
export const PALETTE: readonly (readonly string[])[] = [
  ['#FFFFFF', '#D1D4DC', '#B2B5BE', '#9598A1', '#787B86', '#5D606B', '#434651', '#2A2E39', '#131722', '#000000'],
  ['#F23645', '#FF9800', '#FFEB3B', '#4CAF50', '#089981', '#00BCD4', '#2962FF', '#673AB7', '#9C27B0', '#E91E63'],
  ['#FCCBCD', '#FFE0B2', '#FFF9C4', '#C8E6C9', '#ACE5DC', '#B2EBF2', '#BBD9FB', '#D1C4E9', '#E1BEE7', '#F8BBD0'],
  ['#FAA1A4', '#FFCC80', '#FFF59D', '#A5D6A7', '#70CCBD', '#80DEEA', '#90BFF9', '#B39DDB', '#CE93D8', '#F48FB1'],
  ['#F77C80', '#FFB74D', '#FFF176', '#81C784', '#42BDA8', '#4DD0E1', '#5B9CF6', '#9575CD', '#BA68C8', '#F06292'],
  ['#F7525F', '#FFA726', '#FFEE58', '#66BB6A', '#22AB94', '#26C6DA', '#3179F5', '#7E57C2', '#AB47BC', '#EC407A'],
  ['#B22833', '#F57C00', '#FBC02D', '#388E3C', '#056656', '#0097A7', '#1848CC', '#512DA8', '#7B1FA2', '#C2185B'],
  ['#801922', '#E65100', '#F57F17', '#1B5E20', '#00332A', '#006064', '#0C3299', '#311B92', '#4A148C', '#880E4F'],
];

/** One's own colours (the "+" row), most recent first, at most 10; kept in this browser. */
const CUSTOM_KEY = 'sentiq:custom-colors';
const CUSTOM_MAX = 10;
function readCustom(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && /^#[0-9A-F]{6}$/.test(x)).slice(0, CUSTOM_MAX) : [];
  } catch {
    return [];
  }
}
function saveCustom(list: string[]): void {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(list));
  } catch {
    // private window: the colours last this visit
  }
}

/** The names of a line's styles, the same in the whole app (FD-STYLEUNIFY). */
export const STYLE_RO: Record<ChartLineStyle, string> = { solid: 'Continuă', dashed: 'Întreruptă', dotted: 'Punctată' };
/** TradingView's widths: 1–4 px. */
export const LINE_WIDTHS = [1, 2, 3, 4] as const;
/** A style's dashes for a line `w` px thick (they grow with it, as the chart draws them). */
const dashOf = (s: ChartLineStyle, w: number) => (s === 'solid' ? '' : s === 'dashed' ? `${Math.max(4, 2.5 * w)} ${Math.max(3, 2 * w)}` : `${w} ${Math.max(2, 2 * w)}`);

/** A line as the box and the panel draw it: its width and style, in the text's colour. */
function LineSample({ width, style, length = 28 }: { width: number; style: ChartLineStyle; length?: number }) {
  const h = Math.max(2, width);
  return (
    <svg width={length} height={h} className="block" aria-hidden>
      <line x1="0" y1={h / 2} x2={length} y2={h / 2} stroke="currentColor" strokeWidth={width} strokeDasharray={dashOf(style, width)} />
    </svg>
  );
}

export function ColorPicker({
  value,
  onChange,
  label,
  id,
  lineStyle,
  onLineStyle,
  lineWidth,
  onLineWidth,
  colorNote,
}: {
  /** The colour (#RRGGBB(AA), rgba()); without `onChange`, any CSS background (e.g. a gradient of a line's colours). */
  value: string;
  /** Without it the colour is not chosen here (FD-STYLEUNIFY: it comes from elsewhere, `colorNote` says where). */
  onChange?: (v: string) => void;
  label: string;
  id?: string;
  /** A line's colour: its style too (solid, dashed, dotted), shown in the box and chosen in the panel. */
  lineStyle?: ChartLineStyle;
  onLineStyle?: (s: ChartLineStyle) => void;
  /** A line's width (1–4 px; a wider one saved before stays listed until another is picked). */
  lineWidth?: number;
  onLineWidth?: (w: number) => void;
  /** Where the colour is chosen, when not here. */
  colorNote?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [custom, setCustom] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const { hex, alpha } = parseColor(value);
  const pct = alphaToPercent(alpha);
  // The hex field is typed into freely; a complete code is applied at once, the field follows outside changes.
  const [hexText, setHexText] = useState(hex);
  useEffect(() => setHexText(hex), [hex]);

  const close = (focusBack: boolean) => {
    setOpen(false);
    setPos(null);
    setAdding(false);
    if (focusBack) btn.current?.focus();
  };

  // Under the box and right-aligned with it; above it when there is no room below; always inside the window.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const b = btn.current?.getBoundingClientRect();
      const p = pop.current;
      if (!b || !p) return;
      // The box scrolled out of sight takes its panel with it.
      if (b.bottom < 0 || b.top > innerHeight) return close(false);
      const w = p.offsetWidth;
      const h = p.offsetHeight;
      const left = Math.max(MARGIN, Math.min(b.left, innerWidth - w - MARGIN));
      let top = b.bottom + GAP;
      if (top + h > innerHeight - MARGIN && b.top - GAP - h >= MARGIN) top = b.top - GAP - h;
      setPos({ left, top: Math.max(MARGIN, Math.min(top, innerHeight - h - MARGIN)) });
    };
    place();
    let frame = 0;
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    // A scroll of the settings (not of the panel) or a resize (a phone's keyboard) moves it along with its box.
    const onScroll = (e: Event) => !pop.current?.contains(e.target as Node) && later();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', later);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', later);
    };
  }, [open, adding]);

  useEffect(() => {
    if (!open) return;
    setCustom(readCustom());
    // The keyboard starts on the colour chosen (else the first one).
    requestAnimationFrame(() => (pop.current?.querySelector<HTMLElement>('button[aria-pressed="true"]') ?? pop.current?.querySelector<HTMLElement>('button'))?.focus());
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!pop.current?.contains(t) && !btn.current?.contains(t)) close(false);
    };
    // Captured on the window, so it runs before the settings panel's own Esc (which then sees it used and stays open).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      close(true);
    };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const set = (h: string, a: number) => onChange?.(formatColor(h, a));
  const fixed = !onChange;
  const isLine = lineStyle !== undefined || lineWidth !== undefined;
  const widths = lineWidth !== undefined && !(LINE_WIDTHS as readonly number[]).includes(lineWidth) ? [...LINE_WIDTHS, lineWidth] : [...LINE_WIDTHS];
  /** A colour of one's own: applied, and first on the "+" row. */
  const addCustom = (h: string) => {
    const up = parseColor(h).hex;
    const next = [up, ...custom.filter((c) => c !== up)].slice(0, CUSTOM_MAX);
    setCustom(next);
    saveCustom(next);
    set(up, alpha);
  };
  const swatch = (c: string) => (
    <button
      key={c}
      type="button"
      aria-label={`${label}: ${c}`}
      aria-pressed={c === hex}
      title={c}
      onClick={() => set(c, alpha)}
      className={clsx('h-[18px] w-[18px] rounded-[3px] border border-black/10 transition-transform hover:scale-110', c === hex && 'ring-2 ring-accent ring-offset-1 ring-offset-panel-2')}
      style={{ background: c }}
    />
  );
  return (
    <>
      <button
        ref={btn}
        id={id}
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={[fixed ? colorNote : `${hex} · ${pct} %`, lineWidth !== undefined ? `${lineWidth} px` : null, lineStyle ? STYLE_RO[lineStyle] : null].filter(Boolean).join(' · ')}
        onClick={() => (open ? close(false) : setOpen(true))}
        className={clsx('relative h-8 shrink-0 overflow-hidden rounded-md border border-line-strong p-0', isLine ? 'w-[72px]' : 'w-12')}
        style={{ background: CHECKER }}
      >
        <span aria-hidden className={clsx('absolute inset-y-0 left-0', isLine ? 'w-8' : 'right-0')} style={{ background: value }} />
        {isLine && (
          // The line's width and style next to its colour, as TradingView's box.
          <span aria-hidden className="absolute inset-y-0 right-0 left-8 grid place-items-center bg-panel-2 text-text">
            <LineSample width={lineWidth ?? 2} style={lineStyle ?? 'solid'} />
          </span>
        )}
      </button>
      {open &&
        createPortal(
          <div
            ref={pop}
            role="dialog"
            aria-label={label}
            // Measured hidden first, then shown where it fits.
            style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }}
            className="theme-page fixed z-[60] flex w-[252px] flex-col gap-3 rounded-[14px] border border-line-strong bg-panel-2 p-3 text-[13px] shadow-pop"
            onBlur={(e) => {
              // Tab out of the panel closes it; the browser's own colour window (no element gets the focus) does not.
              const to = e.relatedTarget as Node | null;
              if (to && !pop.current?.contains(to) && !btn.current?.contains(to)) close(false);
            }}
          >
            {fixed && colorNote && <p className="text-[12.5px] text-faint">{colorNote}</p>}
            {!fixed && (
              <>
                <div className="flex flex-col gap-[5px]">
                  {PALETTE.map((row, i) => (
                    <div key={i} className={clsx('flex justify-between', i === 2 && 'mt-1.5')}>
                      {row.map(swatch)}
                    </div>
                  ))}
                </div>
                <div className="h-px bg-line" aria-hidden />
                {/* One's own colours, then "+": any colour, by its code or the browser's picker. */}
                <div className="flex flex-wrap items-center gap-[5px]">
                  {custom.map(swatch)}
                  <button
                    type="button"
                    aria-label={`${label}: o culoare a mea`}
                    aria-expanded={adding}
                    title="O culoare a mea"
                    onClick={() => setAdding((a) => !a)}
                    className="grid h-[18px] w-[18px] place-items-center rounded-[3px] text-muted hover:bg-hover hover:text-text"
                  >
                    <Plus size={14} aria-hidden />
                  </button>
                </div>
                {adding && (
                  <div className="flex items-center gap-2">
                    <input type="color" aria-label={`${label}: culoare`} value={hex.toLowerCase()} onChange={(e) => addCustom(e.target.value)} className="h-9 w-14 shrink-0 p-1" />
                    <input
                      aria-label={`${label}: cod hex`}
                      value={hexText}
                      maxLength={7}
                      spellCheck={false}
                      autoCapitalize="characters"
                      onChange={(e) => {
                        const v = e.target.value.trim();
                        setHexText(v);
                        const h = v.startsWith('#') ? v : `#${v}`;
                        if (/^#[0-9a-f]{6}$/i.test(h)) addCustom(h);
                      }}
                      onBlur={() => setHexText(hex)}
                      className="num min-w-0 flex-1 uppercase"
                    />
                  </div>
                )}
                <label className="flex flex-col gap-1.5">
                  <span className="text-muted">Opacitate</span>
                  <span className="flex items-center gap-2">
                    <span className="relative flex h-5 min-w-0 flex-1 items-center">
                      {/* The colour from clear to full over the checkerboard, under the slider. */}
                      <span aria-hidden className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full" style={{ background: `linear-gradient(to right, transparent, ${hex}), ${CHECKER}` }} />
                      <input type="range" min={0} max={100} step={1} value={pct} aria-label={`${label}: opacitate`} onChange={(e) => set(hex, percentToAlpha(Number(e.target.value)))} className="relative w-full bg-transparent" />
                    </span>
                    <span className="num w-11 shrink-0 text-right text-text">{pct} %</span>
                  </span>
                </label>
              </>
            )}
            {lineWidth !== undefined && onLineWidth && (
              <div className="flex flex-col gap-1.5">
                <span className="text-muted">Grosime</span>
                <div className="seg w-full" role="group" aria-label={`${label}: grosime`}>
                  {widths.map((w) => (
                    <button key={w} type="button" aria-pressed={lineWidth === w} aria-label={`${w} px`} title={`${w} px`} onClick={() => onLineWidth(w)} className="flex flex-1 items-center justify-center">
                      <LineSample width={w} style="solid" length={22} />
                    </button>
                  ))}
                </div>
              </div>
            )}
            {lineStyle && onLineStyle && (
              <div className="flex flex-col gap-1.5">
                <span className="text-muted">Stilul liniei</span>
                <div className="seg w-full" role="group" aria-label={`${label}: stilul liniei`}>
                  {(['solid', 'dashed', 'dotted'] as const).map((st) => (
                    <button key={st} type="button" aria-pressed={lineStyle === st} aria-label={STYLE_RO[st]} title={STYLE_RO[st]} onClick={() => onLineStyle(st)} className="flex flex-1 items-center justify-center">
                      <LineSample width={2} style={st} />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>,
          overlayRoot(),
        )}
    </>
  );
}
