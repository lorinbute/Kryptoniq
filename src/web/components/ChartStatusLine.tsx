// FD-CHARTSETTINGS: TradingView's status line, the chart's first row at the top left: the logo, the title (with the
// interval and the source), whether the market is open, the candle's values and change, its volume and the change since
// the day before; for the candle under the cursor (the last one without it). Each part as the settings say.
import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import type { ChartStyle } from '../../shared/chart-style.ts';
import type { Candle } from '../../shared/indicator/slingshot.ts';
import { barChange, dayChange, fmtVolume, type Change } from '../chart/chart-look.ts';
import { fmtPct, fmtPrice } from '../format.ts';
import { LegendRow } from './StudyLegend.tsx';

/** Whether the status line has anything to show. */
export const statusLineOn = (st: ChartStyle['status']): boolean => st.logo || st.title || st.marketStatus || st.values || st.barChange || st.volume || st.dayChange;

/** The title as chosen: the symbol, the name, or both (the name alone when there is none: the symbol). */
export function statusTitle(mode: ChartStyle['status']['titleMode'], symbol: string, name: string | null): string {
  const other = name && name !== symbol ? name : null;
  return mode === 'name' ? (other ?? symbol) : mode === 'both' && other ? `${symbol} · ${other}` : symbol;
}

// One minus sign for both numbers, TradingView's (−), as on the trade boxes.
const sign = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '');
/** A change as the status line writes it: "+141,4 (+0,17%)", "−207,5 (−0,25%)". */
export const fmtChange = (ch: Change, digits: number) => `${sign(ch.abs)}${fmtPrice(Math.abs(ch.abs), digits)}${ch.pct !== null ? ` (${sign(ch.pct)}${fmtPct(Math.abs(ch.pct), 2, false)})` : ''}`;

export function ChartStatusLine({
  look,
  logo,
  symbol,
  name,
  tf,
  source,
  market,
  candles,
  bar,
  precision,
  prevDay,
  hasVolume,
}: {
  look: ChartStyle;
  logo: ReactNode;
  /** "BTC/USDT", "AAPL". */
  symbol: string;
  name: string | null;
  tf: string;
  /** Where the prices come from ("KuCoin", "Twelve Data"). */
  source: string;
  /** Whether the market is open now, with its words; null: not known. */
  market: { open: boolean; text: string } | null;
  candles: readonly Candle[];
  bar: number | null;
  precision: number;
  /** The day before's close for each candle (null: a daily or longer interval, no such change). */
  prevDay: readonly (number | null)[] | null;
  /** The candles have a volume (an index has none: no "Vol 0"). */
  hasVolume: boolean;
}) {
  const st = look.status;
  if (!statusLineOn(st)) return null;
  const i = bar ?? candles.length - 1;
  const c = candles[i];
  const { up, down } = look.candles.body;
  const tone = (v: number) => (v >= 0 ? up : down);
  const bc = st.barChange ? barChange(candles, i) : null;
  const dc = st.dayChange && prevDay ? dayChange(candles, prevDay, i) : null;
  const ohlc = c && st.values ? ([['D', c.o], ['Max', c.h], ['Min', c.l], ['Î', c.c]] as const) : [];
  // The values in the candle's own colour: by its open, or by the previous close when the candles are coloured so.
  const prev = look.candles.prevClose && i > 0 ? candles[i - 1] : undefined;
  const dir = c ? c.c - (prev ? prev.c : c.o) : 0;
  return (
    <LegendRow>
      {st.logo && logo}
      {st.title && (
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="font-medium text-text">{statusTitle(st.titleMode, symbol, name)}</span>
          <span className="text-faint">
            · {tf}
            {source ? ` · ${source}` : ''}
          </span>
        </span>
      )}
      {st.marketStatus && market && (
        <span className="flex items-center" title={market.text.charAt(0).toUpperCase() + market.text.slice(1)}>
          <span className={clsx('size-2 rounded-full', market.open ? 'bg-bull' : 'bg-faint')} aria-hidden />
          <span className="sr-only">{market.text}</span>
        </span>
      )}
      {c && (ohlc.length > 0 || bc) && (
        <span className="num flex flex-wrap items-center gap-x-2" style={{ color: tone(dir) }}>
          {ohlc.map(([k, v]) => (
            <span key={k}>
              <span className="text-faint">{k}</span> {fmtPrice(v, precision)}
            </span>
          ))}
          {bc && <span style={{ color: tone(bc.abs) }}>{fmtChange(bc, precision)}</span>}
        </span>
      )}
      {st.volume && hasVolume && c && (
        <span className="num">
          <span className="text-faint">Vol</span> <span className="text-muted">{fmtVolume(c.v)}</span>
        </span>
      )}
      {dc && (
        <span className="num" title="Variația față de închiderea zilei precedente">
          <span className="text-faint">Zi</span> <span style={{ color: tone(dc.abs) }}>{fmtChange(dc, precision)}</span>
        </span>
      )}
    </LegendRow>
  );
}
