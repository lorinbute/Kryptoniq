// Addresses of the Charts page: /charts/BTC/USDT for a pair, /charts/s/AAPL for a stock (FD-SENTIQ §4.3),
// /charts/i/SPX for an index (FD-INDICES).
import { plainSymbol } from '../../shared/indices.ts';
import { tfSeconds, type Timeframe } from '../../shared/time.ts';

export const stockChartPath = (sym: string) => `/charts/s/${encodeURIComponent(sym)}`;

/** An index by its id ("^SPX") or symbol ("SPX"): the address has the symbol. */
export const indexChartPath = (id: string) => `/charts/i/${encodeURIComponent(plainSymbol(id))}`;

export const chartPathOf = (w: { kind?: 'crypto' | 'stock' | 'index'; coin: string; quote: string }) =>
  w.kind === 'stock' ? stockChartPath(w.coin) : w.kind === 'index' ? indexChartPath(w.coin) : `/charts/${w.coin}/${w.quote}`;

/** `charts.symbol` as saved ("BTC/USDT", "stock:AAPL" or "index:SPX") → its address. */
export function rememberedPath(saved: string): string {
  if (saved.startsWith('stock:')) return stockChartPath(saved.slice('stock:'.length));
  if (saved.startsWith('index:')) return indexChartPath(saved.slice('index:'.length));
  const [b = 'BTC', q = 'USDT'] = saved.split('/');
  return `/charts/${b}/${q}`;
}

/**
 * The timeframe a chart shows for the saved one: itself when the source has it (the stock source, or the exchange of a
 * coin, FD-MARKETSRC), else the closest (longer on a tie).
 */
export function nearestTimeframe(tf: Timeframe, supported: readonly Timeframe[]): Timeframe {
  if (supported.includes(tf) || supported.length === 0) return supported.length === 0 ? '1d' : tf;
  const sec = tfSeconds(tf);
  return [...supported].sort((a, b) => Math.abs(tfSeconds(a) - sec) - Math.abs(tfSeconds(b) - sec) || tfSeconds(b) - tfSeconds(a))[0] as Timeframe;
}
