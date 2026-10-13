// Addresses of the Charts page: /charts/BTC/USDT for a pair, /charts/s/AAPL for a stock (FD-SENTIQ §4.3).
import { tfSeconds, type Timeframe } from '../../shared/time.ts';

export const stockChartPath = (sym: string) => `/charts/s/${encodeURIComponent(sym)}`;

export const chartPathOf = (w: { kind?: 'crypto' | 'stock'; coin: string; quote: string }) => (w.kind === 'stock' ? stockChartPath(w.coin) : `/charts/${w.coin}/${w.quote}`);

/** `charts.symbol` as saved ("BTC/USDT" or "stock:AAPL") → its address. */
export function rememberedPath(saved: string): string {
  if (saved.startsWith('stock:')) return stockChartPath(saved.slice('stock:'.length));
  const [b = 'BTC', q = 'USDT'] = saved.split('/');
  return `/charts/${b}/${q}`;
}

/** The timeframe a stock chart shows for the saved one: itself when the source has it, else the closest (longer on a tie). */
export function stockTimeframe(tf: Timeframe, supported: readonly Timeframe[]): Timeframe {
  if (supported.includes(tf) || supported.length === 0) return supported.length === 0 ? '1d' : tf;
  const sec = tfSeconds(tf);
  return [...supported].sort((a, b) => Math.abs(tfSeconds(a) - sec) - Math.abs(tfSeconds(b) - sec) || tfSeconds(b) - tfSeconds(a))[0] as Timeframe;
}
