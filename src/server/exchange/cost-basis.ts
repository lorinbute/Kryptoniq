// Average acquisition price of a spot holding from its fills (TD §10). Pure.

export const STABLES = new Set(['USDT', 'USDC', 'USD', 'DAI', 'FDUSD', 'TUSD', 'USDE', 'PYUSD', 'USDS', 'USD1']);

export interface FillLike {
  symbol: string;
  side: 'buy' | 'sell';
  price: number;
  amount: number;
  timestamp: number;
  fee?: { cost?: number; currency?: string } | null;
}

export interface CostBasis {
  avgPrice: number | null;
  /** Quantity explained by the available fills. */
  coveredQty: number;
  complete: boolean;
}

/**
 * Average-cost method over fills quoted in a stablecoin: buys add cost (+ quote fees),
 * sells remove quantity at the running average. Returns null when the fills cannot explain
 * at least 98% of the current holding (older purchases are outside the fill history).
 */
export function costBasis(asset: string, holding: number, fills: FillLike[]): CostBasis {
  const relevant = fills
    .filter((f) => {
      const [base, quote] = f.symbol.split('/');
      return base === asset && quote !== undefined && STABLES.has(quote.split(':')[0] as string);
    })
    .filter((f) => Number.isFinite(f.price) && Number.isFinite(f.amount) && f.amount > 0 && f.price > 0)
    .sort((a, b) => a.timestamp - b.timestamp);
  let qty = 0;
  let cost = 0;
  for (const f of relevant) {
    const fee = f.fee && Number.isFinite(f.fee.cost) ? (f.fee.cost as number) : 0;
    const feeCur = f.fee?.currency;
    if (f.side === 'buy') {
      const received = feeCur === asset ? f.amount - fee : f.amount;
      qty += Math.max(0, received);
      cost += f.price * f.amount + (feeCur && STABLES.has(feeCur) ? fee : 0);
    } else {
      const avg = qty > 0 ? cost / qty : 0;
      const sold = Math.min(qty, f.amount);
      qty -= sold;
      cost -= avg * sold;
      if (qty <= 1e-12) {
        qty = 0;
        cost = 0;
      }
    }
  }
  if (holding <= 0) return { avgPrice: null, coveredQty: qty, complete: false };
  const complete = qty >= 0.98 * holding;
  return { avgPrice: complete && qty > 0 ? cost / qty : null, coveredQty: qty, complete };
}
