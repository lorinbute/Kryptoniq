// Zoom and position per exchange|pair|timeframe, kept in this browser (TD-CHARTUX §4). Storage may be unavailable
// (private window, blocked site data): every access is guarded and the chart then simply opens on the default view.

export interface ChartView {
  /** Pixels per bar (lightweight-charts `barSpacing`). */
  barSpacing: number;
  /** Bars between the last bar and the right edge (`timeScale().scrollPosition()`). */
  scroll: number;
  at: number;
}

const KEY = 'kryptoniq.chartViews';
export const MAX_VIEWS = 60;

const valid = (v: unknown): v is ChartView => {
  const o = v as ChartView | null;
  return (
    typeof o === 'object' && o !== null &&
    Number.isFinite(o.barSpacing) && o.barSpacing > 0.1 && o.barSpacing <= 500 &&
    Number.isFinite(o.scroll) && Math.abs(o.scroll) <= 100_000 &&
    Number.isFinite(o.at)
  ); // prettier-ignore
};

function readAll(storage: Storage | null): Record<string, ChartView> {
  try {
    const raw = storage?.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, ChartView> = {};
    for (const [k, v] of Object.entries(parsed)) if (valid(v)) out[k] = v;
    return out;
  } catch {
    return {};
  }
}

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadView(key: string, storage: Storage | null = defaultStorage()): ChartView | null {
  return readAll(storage)[key] ?? null;
}

export function saveView(key: string, view: Omit<ChartView, 'at'>, storage: Storage | null = defaultStorage(), now = Date.now()): void {
  const entry = { ...view, at: now };
  if (!valid(entry)) return;
  try {
    const all = readAll(storage);
    all[key] = entry;
    const keys = Object.keys(all).sort((a, b) => (all[b] as ChartView).at - (all[a] as ChartView).at);
    for (const k of keys.slice(MAX_VIEWS)) delete all[k];
    storage?.setItem(KEY, JSON.stringify(all));
  } catch {
    // Full or blocked storage: the view is simply not remembered.
  }
}
