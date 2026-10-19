// What an exchange key may do, read from its permissions (FD-TRADING §1, TD-TRADING §4): trade spot, trade futures,
// move funds. null where the exchange does not say (Kraken, the brokers) or the list cannot be read.
export interface TradeRights {
  spot: boolean | null;
  futures: boolean | null;
  /** Withdrawals or transfers: such a key never trades through Sentiq. */
  funds: boolean | null;
}

const UNKNOWN: TradeRights = { spot: null, futures: null, funds: null };

export function tradeRights(exchange: string, permissions: string | null): TradeRights {
  if (!permissions) return UNKNOWN;
  const list = permissions
    .split(/[,\s]+/)
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  const has = (re: RegExp) => list.some((p) => re.test(p));
  const funds = has(/withdraw|transfer/);
  switch (exchange) {
    case 'kucoin':
      return { spot: has(/^spot$/), futures: has(/^futures$/), funds };
    case 'binance':
      return { spot: has(/^spot-trade$/), futures: has(/^futures$/), funds };
    case 'bybit':
      // "read": a read-only key; "read-write" without the detail: not known.
      if (list.length === 1 && list[0] === 'read-write') return { spot: null, futures: null, funds: null };
      return { spot: has(/^spot:spottrade$/), futures: has(/^(contracttrade|derivatives):/), funds };
    case 'okx':
    case 'bitget':
      return { spot: has(/^trade$/), futures: has(/^trade$/), funds };
    case 'coinbase':
      return { spot: has(/^trade$/), futures: false, funds };
    default:
      return UNKNOWN;
  }
}
