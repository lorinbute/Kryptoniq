import { afterEach, describe, expect, it } from 'vitest';
import { setFetchImpl } from '../net/http.ts';
import { brokerAdapter, brokerCacheSizes, BrokerError, fifoResults, flexDate, resetBrokerCaches, t212Symbol, utcTime, xmlElements, type ClosedTrade, type FifoExec } from './brokers.ts';

type Route = (url: URL, init: RequestInit) => { status?: number; body: unknown; headers?: Record<string, string> } | undefined;
const calls: { url: string; headers: Record<string, string> }[] = [];

/** Replaces the network with the given routes (first match wins); unknown URLs fail the test. */
function serve(...routes: Route[]) {
  setFetchImpl((async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url: url.toString(), headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])) });
    for (const r of routes) {
      const res = r(url, init);
      if (res) return new Response(typeof res.body === 'string' ? res.body : JSON.stringify(res.body), { status: res.status ?? 200, headers: res.headers });
    }
    throw new Error(`unexpected request ${url}`);
  }) as typeof fetch);
}
const at = (path: string, body: unknown, status = 200, headers?: Record<string, string>): Route => (u) => (u.pathname + u.search === path || u.pathname === path ? { status, body, headers } : undefined);
const noSleep = { sleep: async () => {} };
const NOW = Date.parse('2026-10-13T12:00:00Z');

afterEach(() => {
  setFetchImpl(null);
  calls.length = 0;
  resetBrokerCaches();
});

describe('Trading 212', () => {
  const creds = { apiKey: 'KEY1234', secret: 'SECRET123' };
  const summary = { currency: 'GBP', cash: { availableToTrade: 120.5 }, totalValue: 2000 };
  const positions = [
    { instrument: { ticker: 'AAPL_US_EQ', name: 'Apple', currency: 'USD' }, quantity: 3, quantityAvailableForTrading: 2, quantityInPies: 1, averagePricePaid: 200, currentPrice: 250, walletImpact: { currency: 'GBP', currentValue: 580, totalCost: 470, unrealizedProfitLoss: 110 } },
    { instrument: { ticker: 'VUSAl_EQ', name: 'Vanguard S&P 500', currency: 'GBP' }, quantity: 10, averagePricePaid: 80, currentPrice: 90, walletImpact: { currency: 'GBP', currentValue: 900, totalCost: 800, unrealizedProfitLoss: 100 } },
  ];
  const orders = [{ id: 11, ticker: 'AAPL_US_EQ', currency: 'USD', type: 'STOP', side: 'SELL', quantity: -3, stopPrice: 190, status: 'NEW', createdAt: '2026-10-12T10:00:00Z' }];
  const history = {
    items: [
      { order: { id: 9, ticker: 'AAPL_US_EQ', side: 'BUY', currency: 'USD' }, fill: { id: 99, type: 'TRADE', filledAt: '2026-10-10T15:00:00Z', price: 210, quantity: 1, walletImpact: { currency: 'GBP', taxes: -0.5 } } },
      { order: { id: 8, ticker: 'AAPL_US_EQ', side: 'BUY' }, fill: { id: 98, type: 'STOCK_SPLIT', filledAt: '2026-10-09T15:00:00Z', price: 0, quantity: 1 } },
      { order: { id: 7, ticker: 'MSFT_US_EQ', side: 'BUY' }, fill: { id: 97, type: 'TRADE', filledAt: '2026-09-01T15:00:00Z', price: 400, quantity: 1 } },
    ],
    nextPagePath: '/api/v0/equity/history/orders?limit=50&cursor=5',
  };

  it('maps holdings, orders and recent fills; uses Basic auth on the chosen environment', async () => {
    serve(at('/api/v0/equity/account/summary', summary), at('/api/v0/equity/positions', positions), at('/api/v0/equity/orders', orders), at('/api/v0/equity/history/orders?limit=50', history));
    const snap = await brokerAdapter('trading212', creds, 'demo', { now: () => NOW, ...noSleep }).load();
    expect(calls[0]?.url).toBe('https://demo.trading212.com/api/v0/equity/account/summary');
    expect(calls[0]?.headers.authorization).toBe(`Basic ${Buffer.from('KEY1234:SECRET123').toString('base64')}`);
    expect(snap.currency).toBe('GBP');
    expect(snap.cash).toBe(120.5);
    expect(snap.balances[0]).toMatchObject({ asset: 'AAPL', total: 3, free: 2, used: 1, price: 250, value: 580, avgPrice: 200, avgSource: 'broker', pnl: 110, currency: 'GBP', priceCurrency: 'USD', name: 'Apple' });
    expect(snap.balances[0]?.pnlPct).toBeCloseTo((110 / 470) * 100, 8);
    expect(snap.balances[1]?.asset).toBe('VUSA');
    expect(snap.orders[0]).toMatchObject({ id: '11', market: 'spot', symbol: 'AAPL/USD', type: 'stop', side: 'sell', triggerPrice: 190, amount: 3, stop: 'down' });
    // Only real trades of the last 7 days; the page already reached older fills, so the next one is not asked for.
    expect(snap.fills).toEqual([expect.objectContaining({ id: '99', symbol: 'AAPL/USD', side: 'buy', price: 210, amount: 1, fee: 0.5, feeCurrency: 'GBP' })]);
    expect(calls.some((c) => c.url.includes('cursor='))).toBe(false);
    expect(snap.errors).toEqual({});
  });

  it('explains 401 / 403 (with the missing scope) and waits once for a 429 reset', async () => {
    serve(at('/api/v0/equity/account/summary', 'Bad API key', 401));
    await expect(brokerAdapter('trading212', creds, 'live', noSleep).test()).rejects.toMatchObject({ code: 'AUTH' });
    serve(at('/api/v0/equity/account/summary', summary), at('/api/v0/equity/positions', 'Scope( portfolio ) missing for API key', 403), at('/api/v0/equity/orders', []), at('/api/v0/equity/history/orders?limit=50', { items: [] }));
    const snap = await brokerAdapter('trading212', creds, 'live', { now: () => NOW, ...noSleep }).load();
    expect(snap.errors.balances?.code).toBe('PERMISSION');
    expect(snap.errors.balances?.message).toContain('„portfolio”');
    let n = 0;
    serve((u) => (u.pathname.endsWith('/account/summary') ? (++n === 1 ? { status: 429, body: '', headers: { 'x-ratelimit-reset': String(NOW / 1000 + 2) } } : { body: summary }) : undefined));
    await brokerAdapter('trading212', creds, 'live', { now: () => NOW, ...noSleep }).test();
    expect(n).toBe(2);
  });

  it('turns exchange-suffixed tickers into plain symbols', () => {
    expect(t212Symbol('AAPL_US_EQ')).toBe('AAPL');
    expect(t212Symbol('VUSAl_EQ')).toBe('VUSA');
    expect(t212Symbol('BRK.B_US_EQ')).toBe('BRK.B');
  });
});

describe('eToro', () => {
  const creds = { publicKey: 'PUB-1234', userKey: 'USER-5678' };
  const pnl = {
    clientPortfolio: {
      credit: 1500,
      positions: [
        { positionID: 1, instrumentID: 1001, isBuy: true, leverage: 1, units: 2, openRate: 100, amount: 200, stopLossRate: 90, takeProfitRate: 0, isNoTakeProfit: true, unrealizedPnL: { pnL: 20, closeRate: 110 } },
        { positionId: 2, instrumentId: 1001, isBuy: true, leverage: 1, units: 1, openRate: 130, amount: 130, unrealizedPnL: { pnL: -20, closeRate: 110 } },
        { positionID: 3, instrumentID: 1002, isBuy: false, leverage: 2, units: 5, openRate: 50, amount: 125, stopLossRate: 55, takeProfitRate: 40, unrealizedPnL: { pnL: 10, closeRate: 48 } },
      ],
      mirrors: [{ parentUsername: 'trader1', positions: [{ positionID: 4, instrumentID: 9999, isBuy: true, leverage: 1, units: 1, openRate: 10, amount: 10, unrealizedPnL: { pnL: 1, closeRate: 11 } }] }],
      orders: [],
    },
  };
  const meta = { results: [{ instrumentId: 1001, symbol: 'aapl', displayName: 'Apple', type: 'Stocks' }, { instrumentId: 1002, symbol: 'TSLA', displayName: 'Tesla', type: 'Stocks' }] };

  it('reads the real or demo portfolio with its key headers, sums holdings, keeps leveraged / short ones as positions', async () => {
    serve(at('/api/v1/trading/info/demo/pnl', pnl), (u) => (u.pathname === '/api/v2/market-data/instruments' ? { body: meta } : undefined));
    const snap = await brokerAdapter('etoro', creds, 'demo', noSleep).load();
    const first = calls[0]!;
    expect(first.url).toBe('https://public-api.etoro.com/api/v1/trading/info/demo/pnl');
    expect(first.headers['x-api-key']).toBe('PUB-1234');
    expect(first.headers['x-user-key']).toBe('USER-5678');
    expect(first.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const metaCall = calls.find((c) => c.url.includes('market-data'))!;
    expect(new URL(metaCall.url).searchParams.getAll('instrumentsIds').sort()).toEqual(['1001', '1002', '9999']);
    expect(snap.currency).toBe('USD');
    expect(snap.cash).toBe(1500);
    const aapl = snap.balances.find((b) => b.asset === 'AAPL')!;
    expect(aapl).toMatchObject({ total: 3, avgPrice: (200 + 130) / 3, pnl: 0, price: 110, name: 'Apple' });
    expect(snap.balances.find((b) => b.asset === '#9999')).toMatchObject({ note: 'copiat de la trader1' });
    expect(snap.positions).toEqual([expect.objectContaining({ symbol: 'TSLA/USD', side: 'short', contracts: 5, entryPrice: 50, markPrice: 48, unrealizedPnl: 10, leverage: 2 })]);
    // Stop-loss / take-profit become orders for the chart (FD-PNL); "no take profit" adds none.
    expect(snap.orders.map((o) => `${o.id} ${o.market} ${o.symbol} ${o.side} ${o.type} ${o.triggerPrice ?? o.price} ${o.stop}`).sort()).toEqual([
      'sl-1 spot AAPL/USD sell stop 90 down',
      'sl-3 futures TSLA/USD buy stop 55 up',
      'tp-3 futures TSLA/USD buy limit 40 null',
    ]);
  });

  it('marks a coin held at eToro as crypto', async () => {
    const btc = { clientPortfolio: { positions: [{ positionID: 8, instrumentID: 100000, isBuy: true, leverage: 1, units: 0.01, openRate: 60000, amount: 600, unrealizedPnL: { pnL: 200, closeRate: 80000 } }] } };
    serve(at('/api/v1/trading/info/real/pnl', btc), (u) => (u.pathname === '/api/v2/market-data/instruments' ? { body: { results: [{ instrumentId: 100000, symbol: 'BTC', displayName: 'Bitcoin', type: 'Crypto' }] } } : undefined));
    const snap = await brokerAdapter('etoro', creds, 'real', noSleep).load();
    expect(snap.balances[0]).toMatchObject({ asset: 'BTC', crypto: true });
  });

  it('values a holding in USD from the invested amount and the PnL, whatever the instrument currency', async () => {
    // A German share: rates in EUR, `amount` and the PnL in USD.
    const eur = { clientPortfolio: { credit: 0, positions: [{ positionID: 7, instrumentID: 2001, isBuy: true, leverage: 1, units: 10, openRate: 50, amount: 540, unrealizedPnL: { pnL: 54, closeRate: 55 } }] } };
    serve(at('/api/v1/trading/info/real/pnl', eur), (u) => (u.pathname === '/api/v2/market-data/instruments' ? { body: { results: [{ instrumentId: 2001, symbol: 'SAP.DE', displayName: 'SAP' }] } } : undefined));
    const snap = await brokerAdapter('etoro', creds, 'real', noSleep).load();
    expect(snap.balances[0]).toMatchObject({ asset: 'SAP.DE', total: 10, avgPrice: 50, price: 55, value: 594, pnl: 54, pnlPct: 10 });
  });

  it('explains wrong or under-permitted keys', async () => {
    serve(at('/api/v1/trading/info/real/pnl', { message: 'Unauthorized' }, 401));
    const err = await brokerAdapter('etoro', creds, 'real', noSleep).test().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BrokerError);
    expect(err).toMatchObject({ code: 'AUTH' });
    expect((err as Error).message).toContain('Real / Demo');
    serve(at('/api/v1/trading/info/real/pnl', '', 403));
    await expect(brokerAdapter('etoro', creds, 'real', noSleep).test()).rejects.toMatchObject({ code: 'PERMISSION' });
  });
});

describe('Interactive Brokers (Flex)', () => {
  const creds = { token: '123456789012', queryId: '987654' };
  const sendOk = `<FlexStatementResponse timestamp="13 October, 2026"><Status>Success</Status><ReferenceCode>555</ReferenceCode><Url>https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement</Url></FlexStatementResponse>`;
  const inProgress = `<FlexStatementResponse><Status>Warn</Status><ErrorCode>1019</ErrorCode><ErrorMessage>Statement generation in progress. Please try again shortly.</ErrorMessage></FlexStatementResponse>`;
  const statement = `<FlexQueryResponse queryName="sentiq" type="AF"><FlexStatements count="1"><FlexStatement accountId="U123" fromDate="20261012" toDate="20261012" whenGenerated="20261013;030000">
    <AccountInformation accountId="U123" currency="EUR" />
    <OpenPositions>
      <OpenPosition accountId="U123" currency="USD" assetCategory="STK" symbol="AAPL" description="APPLE INC" position="10" markPrice="250.5" positionValue="2505" costBasisPrice="200" costBasisMoney="2000" fifoPnlUnrealized="505" side="Long" levelOfDetail="SUMMARY" multiplier="1" />
      <OpenPosition accountId="U123" currency="USD" assetCategory="STK" symbol="AAPL" position="10" levelOfDetail="LOT" />
      <OpenPosition accountId="U123" currency="USD" assetCategory="OPT" symbol="TSLA  261120C00300000" position="-2" markPrice="5" positionValue="-1000" costBasisPrice="6" costBasisMoney="-1200" fifoPnlUnrealized="200" side="Short" levelOfDetail="SUMMARY" multiplier="100" />
    </OpenPositions>
    <Trades>
      <Trade symbol="AAPL" assetCategory="STK" currency="USD" buySell="BUY" quantity="5" tradePrice="240" dateTime="20261012;153045" ibCommission="-1.0" ibCommissionCurrency="USD" tradeID="t1" levelOfDetail="EXECUTION" />
    </Trades>
    <CashReport><CashReportCurrency currency="BASE_SUMMARY" endingCash="1234.5" /><CashReportCurrency currency="USD" endingCash="999" /></CashReport>
  </FlexStatement></FlexStatements></FlexQueryResponse>`;

  it('requests the report, waits while it is generated, and maps positions, trades and cash', async () => {
    let gets = 0;
    serve(
      (u) => (u.pathname.endsWith('/SendRequest') ? { body: sendOk } : undefined),
      (u) => (u.pathname.endsWith('/GetStatement') ? { body: ++gets === 1 ? inProgress : statement } : undefined),
    );
    const snap = await brokerAdapter('ibkr', creds, 'live', noSleep).load();
    const send = new URL(calls[0]!.url);
    expect(send.searchParams.get('t')).toBe('123456789012');
    expect(send.searchParams.get('q')).toBe('987654');
    expect(send.searchParams.get('v')).toBe('3');
    expect(new URL(calls[2]!.url).searchParams.get('q')).toBe('555');
    expect(gets).toBe(2);
    expect(snap.currency).toBe('EUR');
    expect(snap.cash).toBe(1234.5);
    // The close of the report's day: 16:00 in New York (EDT) = 20:00 UTC.
    expect(snap.asOf).toBe(Date.parse('2026-10-12T20:00:00Z'));
    expect(snap.balances).toEqual([expect.objectContaining({ asset: 'AAPL', total: 10, price: 250.5, value: 2505, avgPrice: 200, pnl: 505, currency: 'USD', name: 'APPLE INC' })]);
    expect(snap.positions).toEqual([expect.objectContaining({ symbol: 'TSLA  261120C00300000/USD', side: 'short', contracts: 2, size: 200, entryPrice: 6, unrealizedPnl: 200 })]);
    expect(snap.fills).toEqual([expect.objectContaining({ id: 't1', symbol: 'AAPL/USD', side: 'buy', price: 240, amount: 5, fee: 1 })]);
    // 15:30:45 Eastern daylight time = 19:30:45 UTC.
    expect(snap.fills[0]?.timestamp).toBe(Date.parse('2026-10-12T19:30:45Z'));
    // The report is kept 15 minutes: a second load asks nothing.
    const before = calls.length;
    await brokerAdapter('ibkr', creds, 'live', noSleep).load();
    expect(calls.length).toBe(before);
  });

  it('turns Flex error codes into plain reasons; a query without Open Positions fails the test', async () => {
    serve((u) => (u.pathname.endsWith('/SendRequest') ? { body: '<FlexStatementResponse><Status>Fail</Status><ErrorCode>1012</ErrorCode><ErrorMessage>Token has expired.</ErrorMessage></FlexStatementResponse>' } : undefined));
    const err = await brokerAdapter('ibkr', creds, 'live', noSleep).test().catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'AUTH' });
    expect((err as Error).message).toContain('a expirat');
    resetBrokerCaches();
    serve(
      (u) => (u.pathname.endsWith('/SendRequest') ? { body: sendOk } : undefined),
      (u) => (u.pathname.endsWith('/GetStatement') ? { body: '<FlexQueryResponse><FlexStatements><FlexStatement toDate="20261012"><Trades /></FlexStatement></FlexStatements></FlexQueryResponse>' } : undefined),
    );
    await expect(brokerAdapter('ibkr', creds, 'live', noSleep).test()).rejects.toThrow('Open Positions');
  });

  it('reads Flex dates in US Eastern time across daylight saving', () => {
    expect(flexDate('20261012;093000')).toBe(Date.parse('2026-10-12T13:30:00Z'));
    expect(flexDate('20261215;093000')).toBe(Date.parse('2026-12-15T14:30:00Z'));
    expect(flexDate('nope')).toBeNull();
    expect(xmlElements('<A x="1 &amp; 2"/><A y=\'b\'></A>', 'A')).toEqual([{ x: '1 & 2' }, { y: 'b' }]);
  });
});

describe('network failures', () => {
  it('a section that times out is a network problem, the others still load', async () => {
    setFetchImpl((async (input: string | URL | Request) => {
      const u = new URL(String(input));
      if (u.pathname === '/v2/orders') throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
      const body = u.pathname === '/v2/account' ? { currency: 'USD', cash: '5' } : [];
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch);
    const snap = await brokerAdapter('alpaca', { keyId: 'PK12345678', secret: 'S12345678' }, 'live', { now: () => NOW }).load();
    expect(snap.errors.orders).toMatchObject({ code: 'NETWORK' });
    expect(snap.cash).toBe(5);
    expect(snap.errors.balances).toBeUndefined();
  });
});

describe('Alpaca', () => {
  const creds = { keyId: 'PKTEST1234', secret: 'SECRET5678' };
  it('maps the account, long holdings, shorts, bracket legs and fills on the paper environment', async () => {
    serve(
      at('/v2/account', { currency: 'USD', cash: '1000.50' }),
      at('/v2/positions', [
        { symbol: 'AAPL', qty: '4', qty_available: '4', side: 'long', avg_entry_price: '200', current_price: '250', market_value: '1000', unrealized_pl: '200', cost_basis: '800' },
        { symbol: 'TSLA', qty: '-2', side: 'short', avg_entry_price: '300', current_price: '280', market_value: '-560', unrealized_pl: '40', cost_basis: '-600' },
      ]),
      (u) => (u.pathname === '/v2/orders' ? { body: [{ id: 'o1', symbol: 'AAPL', side: 'buy', type: 'limit', qty: '1', limit_price: '240', status: 'new', legs: [{ id: 'o2', symbol: 'AAPL', side: 'sell', type: 'stop', qty: '1', stop_price: '230', status: 'held' }] }, { id: 'o3', symbol: 'TSLA', side: 'buy', type: 'stop', qty: '2', stop_price: '320' }] } : undefined),
      (u) => (u.pathname === '/v2/account/activities/FILL' ? { body: [{ id: 'f1', symbol: 'AAPL', side: 'buy', price: '210', qty: '1', transaction_time: '2026-10-12T15:00:00Z' }] } : undefined),
    );
    const snap = await brokerAdapter('alpaca', creds, 'paper', { now: () => NOW }).load();
    expect(calls[0]?.url).toBe('https://paper-api.alpaca.markets/v2/account');
    expect(calls[0]?.headers['apca-api-key-id']).toBe('PKTEST1234');
    expect(snap.cash).toBe(1000.5);
    expect(snap.balances).toEqual([expect.objectContaining({ asset: 'AAPL', total: 4, avgPrice: 200, price: 250, pnl: 200, pnlPct: 25 })]);
    expect(snap.positions).toEqual([expect.objectContaining({ symbol: 'TSLA/USD', side: 'short', contracts: 2, entryPrice: 300 })]);
    expect(snap.orders.map((o) => `${o.id} ${o.market} ${o.side} ${o.type} ${o.stop}`)).toEqual(['o1 spot buy limit null', 'o2 spot sell stop down', 'o3 futures buy stop up']);
    expect(snap.fills).toHaveLength(1);
    const ordersUrl = new URL(calls.find((c) => c.url.includes('/v2/orders'))!.url);
    expect(ordersUrl.searchParams.get('nested')).toBe('true');
  });

  it('a coin held at Alpaca is a coin (its chart is the crypto one)', async () => {
    serve(
      at('/v2/account', { currency: 'USD', cash: '0' }),
      at('/v2/positions', [{ symbol: 'BTCUSD', asset_class: 'crypto', qty: '0.1', side: 'long', avg_entry_price: '60000', current_price: '80000', market_value: '8000', unrealized_pl: '2000', cost_basis: '6000' }]),
      (u) => (u.pathname === '/v2/orders' ? { body: [] } : undefined),
      (u) => (u.pathname === '/v2/account/activities/FILL' ? { body: [] } : undefined),
    );
    const snap = await brokerAdapter('alpaca', creds, 'live', { now: () => NOW }).load();
    expect(snap.balances).toEqual([expect.objectContaining({ asset: 'BTC', crypto: true, total: 0.1 })]);
  });

  it('explains a key used on the wrong environment', async () => {
    serve(at('/v2/account', { message: 'forbidden' }, 401));
    await expect(brokerAdapter('alpaca', creds, 'live', noSleep).test()).rejects.toThrow('Paper');
  });
});

describe('closed trades (FD-BROKERSTATS)', () => {
  const byId = (ts: ClosedTrade[]) => [...ts].sort((a, b) => a.id.localeCompare(b.id));

  describe('Trading 212', () => {
    const creds = { apiKey: 'KEY1234', secret: 'SECRET123' };
    const sell = (order: number, fill: number, filledAt: string, wallet: Record<string, unknown>, type = 'TRADE') => ({ order: { id: order, ticker: 'AAPL_US_EQ', side: 'SELL' }, fill: { id: fill, type, filledAt, quantity: -1, price: 250, walletImpact: wallet } });

    it('the executed sells since the start, one per order, with the realised result; reading stops past the start', async () => {
      const from = Date.parse('2026-10-01T00:00:00Z');
      const page1 = {
        items: [
          sell(30, 301, '2026-10-12T10:00:01Z', { currency: 'EUR', realisedProfitLoss: 12.5 }),
          // The second piece of the same order.
          sell(30, 302, '2026-10-12T10:00:03Z', { currency: 'EUR', realisedProfitLoss: 2.5 }),
          { order: { id: 29, side: 'BUY' }, fill: { id: 291, type: 'TRADE', filledAt: '2026-10-11T10:00:00Z', quantity: 3, price: 100, walletImpact: { currency: 'EUR', realisedProfitLoss: 0 } } },
          { order: { id: 28, side: 'SELL', status: 'CANCELLED', createdAt: '2026-10-10T10:00:00Z' } },
          sell(27, 271, '2026-10-09T10:00:00Z', { realisedProfitLoss: 0 }, 'STOCK_SPLIT'),
          sell(26, 261, '2026-10-08T10:00:00Z', { currency: 'EUR', realisedProfitLoss: -4 }),
          // No realised result in the answer: not counted.
          sell(25, 251, '2026-10-07T10:00:00Z', { currency: 'EUR' }),
          // A sell without a side, by its negative quantity.
          { order: { id: 24 }, fill: { id: 241, type: 'TRADE', filledAt: '2026-10-02T10:00:00Z', quantity: -1, walletImpact: { currency: 'EUR', realisedProfitLoss: 0 } } },
        ],
        nextPagePath: '/api/v0/equity/history/orders?limit=50&cursor=24',
      };
      const page2 = { items: [sell(23, 231, '2026-10-01T09:00:00Z', { currency: 'EUR', realisedProfitLoss: 3 }), sell(22, 221, '2026-09-20T10:00:00Z', { currency: 'EUR', realisedProfitLoss: 50 })], nextPagePath: '/api/v0/equity/history/orders?limit=50&cursor=21' };
      serve(at('/api/v0/equity/history/orders?limit=50', page1), at('/api/v0/equity/history/orders?limit=50&cursor=24', page2));
      const h = await brokerAdapter('trading212', creds, 'live', { now: () => NOW, ...noSleep }).closedTrades!(from);
      expect(h.currency).toBe('EUR');
      expect(byId(h.trades)).toEqual([
        { id: '23', closedAt: Date.parse('2026-10-01T09:00:00Z'), pnl: 3, net: 3 },
        { id: '24', closedAt: Date.parse('2026-10-02T10:00:00Z'), pnl: 0, net: 0 },
        { id: '25', closedAt: Date.parse('2026-10-07T10:00:00Z'), pnl: null, net: null },
        { id: '26', closedAt: Date.parse('2026-10-08T10:00:00Z'), pnl: -4, net: -4 },
        { id: '30', closedAt: Date.parse('2026-10-12T10:00:03Z'), pnl: 15, net: 15 },
      ]);
      // The second page went past the start: the third is not asked for.
      expect(calls.some((c) => c.url.includes('cursor=21'))).toBe(false);
      expect(h).toMatchObject({ coveredFrom: from, asOf: null });
    });

    it('at most 10 pages: complete back to the oldest row read; the end of the history is complete', async () => {
      const t0 = Date.parse('2026-10-12T12:00:00Z');
      let pages = 0;
      serve((u) => {
        if (!u.pathname.endsWith('/history/orders')) return undefined;
        const page = Number(u.searchParams.get('cursor') ?? 0);
        pages++;
        const items = Array.from({ length: 50 }, (_, i) => sell(page * 50 + i, page * 50 + i, new Date(t0 - (page * 50 + i) * 600_000).toISOString(), { currency: 'GBP', realisedProfitLoss: 1 }));
        return { body: { items, nextPagePath: `/api/v0/equity/history/orders?limit=50&cursor=${page + 1}` } };
      });
      const h = await brokerAdapter('trading212', creds, 'live', { now: () => NOW, ...noSleep }).closedTrades!(t0 - 30 * 86_400_000);
      expect(pages).toBe(10);
      expect(h.trades).toHaveLength(500);
      expect(h.coveredFrom).toBe(t0 - 499 * 600_000);
      serve(at('/api/v0/equity/history/orders?limit=50', { items: [sell(1, 1, '2026-10-12T10:00:00Z', { currency: 'GBP', realisedProfitLoss: 1 })] }));
      expect(await brokerAdapter('trading212', creds, 'live', { now: () => NOW, ...noSleep }).closedTrades!(t0 - 30 * 86_400_000)).toMatchObject({ coveredFrom: 0, currency: 'GBP' });
      // No sell at all: the currency is left to the portfolio.
      serve(at('/api/v0/equity/history/orders?limit=50', { items: [] }));
      expect(await brokerAdapter('trading212', creds, 'live', { now: () => NOW, ...noSleep }).closedTrades!(t0)).toMatchObject({ currency: null, trades: [] });
    });

    it("a fill's charges are the documented list of taxes (each in the wallet currency)", async () => {
      const items = [{ order: { id: 9, ticker: 'AAPL_US_EQ', side: 'BUY', currency: 'USD' }, fill: { id: 99, type: 'TRADE', filledAt: '2026-10-12T15:00:00Z', price: 210, quantity: 1, walletImpact: { currency: 'GBP', taxes: [{ name: 'CURRENCY_CONVERSION_FEE', quantity: -0.3, currency: 'GBP' }, { name: 'FINRA_FEE', quantity: 0.02, currency: 'GBP' }, { name: 'X', quantity: 9, currency: 'USD' }] } } }];
      serve(at('/api/v0/equity/account/summary', { currency: 'GBP' }), at('/api/v0/equity/positions', []), at('/api/v0/equity/orders', []), at('/api/v0/equity/history/orders?limit=50', { items }));
      const snap = await brokerAdapter('trading212', creds, 'live', { now: () => NOW, ...noSleep }).load();
      expect(snap.fills[0]?.fee).toBeCloseTo(0.32, 9);
    });
  });

  describe('eToro', () => {
    const creds = { publicKey: 'PUB-1234', userKey: 'USER-5678' };
    const t0 = Date.parse('2026-10-12T12:00:00Z');
    const row = (id: number, hoursAgo: number, netProfit: number | undefined) => ({ positionId: id, closeTimestamp: new Date(t0 - hoursAgo * 3_600_000).toISOString(), netProfit, fees: 0.1, isBuy: true });

    it("the closed positions of the real history, page by page from 1, with eToro's net profit in USD", async () => {
      const from = Date.parse('2026-10-05T00:00:00Z');
      const page1 = Array.from({ length: 100 }, (_, i) => row(i, i, i % 4 === 0 ? -2 : 3));
      // A time written without a zone is UTC; a row before the start is left out; a row repeated is counted once.
      const page2 = [{ positionId: 500, closeTimestamp: '2026-10-06T08:00:00', netProfit: 0 }, row(501, 24 * 9, 7), row(5, 5, 3), row(502, 30, undefined)];
      serve((u) => {
        if (u.pathname !== '/api/v1/trading/info/trade/history') return undefined;
        const page = u.searchParams.get('page');
        return { body: page === '1' ? page1 : page === '2' ? page2 : [] };
      });
      const h = await brokerAdapter('etoro', creds, 'real', noSleep).closedTrades!(from);
      const first = new URL(calls[0]!.url);
      expect(first.searchParams.get('minDate')).toBe('2026-10-04');
      expect(first.searchParams.get('pageSize')).toBe('100');
      expect(calls.map((c) => new URL(c.url).searchParams.get('page'))).toEqual(['1', '2', '3']);
      expect(calls[0]?.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
      expect(h).toMatchObject({ currency: 'USD', coveredFrom: from, asOf: null });
      expect(h.trades).toHaveLength(102);
      expect(h.trades.find((t) => t.id === '500')).toEqual({ id: '500', closedAt: Date.parse('2026-10-06T08:00:00Z'), pnl: 0, net: 0 });
      expect(h.trades.find((t) => t.id === '502')).toMatchObject({ pnl: null });
      expect(h.trades.find((t) => t.id === '501')).toBeUndefined();
      expect(h.trades.filter((t) => (t.pnl ?? 0) < 0)).toHaveLength(25);
    });

    it('the demo history; at most 20 pages; a full page repeated is not followed', async () => {
      serve(at('/api/v1/trading/info/trade/demo/history', []));
      expect(await brokerAdapter('etoro', creds, 'demo', noSleep).closedTrades!(t0 - 86_400_000)).toMatchObject({ trades: [], coveredFrom: t0 - 86_400_000 });
      calls.length = 0;
      // Every page full of new rows, newest first: complete back to the oldest one read.
      serve((u) => {
        const page = Number(u.searchParams.get('page'));
        return { body: Array.from({ length: 100 }, (_, i) => row(page * 1000 + i, (page - 1) * 100 + i, 1)) };
      });
      const capped = await brokerAdapter('etoro', creds, 'real', noSleep).closedTrades!(t0 - 90 * 86_400_000);
      expect(calls).toHaveLength(20);
      expect(capped.coveredFrom).toBe(t0 - 1999 * 3_600_000);
      // Rows not newest first: nothing is sure.
      serve((u) => {
        const page = Number(u.searchParams.get('page'));
        return { body: Array.from({ length: 100 }, (_, i) => row(page * 1000 + i, 2000 - ((page - 1) * 100 + i), 1)) };
      });
      expect((await brokerAdapter('etoro', creds, 'real', noSleep).closedTrades!(t0 - 90 * 86_400_000)).coveredFrom).toBe(Number.POSITIVE_INFINITY);
      // The same full page whatever the number: read once, not trusted as complete.
      calls.length = 0;
      serve(() => ({ body: Array.from({ length: 100 }, (_, i) => row(i, i, 1)) }));
      const same = await brokerAdapter('etoro', creds, 'real', noSleep).closedTrades!(t0 - 90 * 86_400_000);
      expect(calls).toHaveLength(2);
      expect(same.trades).toHaveLength(100);
      expect(same.coveredFrom).toBe(t0 - 99 * 3_600_000);
    });
  });

  describe('Interactive Brokers', () => {
    const creds = { token: '123456789012', queryId: '987654' };
    const sendOk = `<FlexStatementResponse><Status>Success</Status><ReferenceCode>555</ReferenceCode><Url>https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement</Url></FlexStatementResponse>`;
    const report = (trades: string, info = '<AccountInformation accountId="U1" currency="EUR" />') =>
      `<FlexQueryResponse><FlexStatements count="1"><FlexStatement accountId="U1" fromDate="20260715" toDate="20261012">${info}<OpenPositions /><Trades>${trades}</Trades></FlexStatement></FlexStatements></FlexQueryResponse>`;
    const flex = (xml: string) => serve((u) => (u.pathname.endsWith('/SendRequest') ? { body: sendOk } : undefined), (u) => (u.pathname.endsWith('/GetStatement') ? { body: xml } : undefined));
    const trade = (a: Record<string, string>) => `<Trade ${Object.entries({ levelOfDetail: 'EXECUTION', assetCategory: 'STK', currency: 'USD', ...a }).map(([k, v]) => `${k}="${v}"`).join(' ')} />`;

    it('a report of the 90 days (fd / td, up to the last weekday) with the closing orders, grouped, in the base currency', async () => {
      flex(
        report(
          [
            trade({ ibOrderID: 'A', openCloseIndicator: 'C', fifoPnlRealized: '30', fxRateToBase: '0.9', dateTime: '20261012;100000' }),
            trade({ ibOrderID: 'A', openCloseIndicator: 'C', fifoPnlRealized: '20', fxRateToBase: '0.9', dateTime: '20261012;100500' }),
            trade({ ibOrderID: 'B', openCloseIndicator: 'C;O', fifoPnlRealized: '-10', currency: 'EUR', dateTime: '20261009;110000' }),
            trade({ ibOrderID: 'C', openCloseIndicator: 'O', fifoPnlRealized: '0', dateTime: '20261009;120000' }),
            trade({ ibOrderID: 'D', assetCategory: 'CASH', openCloseIndicator: 'C', fifoPnlRealized: '5', dateTime: '20261008;120000' }),
            trade({ ibOrderID: 'E', openCloseIndicator: 'C', fifoPnlRealized: '7', currency: 'GBP', dateTime: '20261008;130000' }),
            trade({ ibOrderID: 'F', openCloseIndicator: 'C', fifoPnlRealized: '99', dateTime: '20260601;100000' }),
            // No open / close field: a realised result means it closed.
            trade({ ibOrderID: 'G', fifoPnlRealized: '-1.5', fxRateToBase: '0.9', dateTime: '20261007;100000' }),
            trade({ ibOrderID: 'H', fifoPnlRealized: '0', dateTime: '20261007;110000' }),
            trade({ levelOfDetail: 'SYMBOL_SUMMARY', ibOrderID: '', openCloseIndicator: 'C', fifoPnlRealized: '40', dateTime: '20261012' }),
          ].join(''),
        ),
      );
      // Tuesday 13 Oct, 08:00 in New York.
      const h = await brokerAdapter('ibkr', creds, 'live', { now: () => NOW, ...noSleep }).closedTrades!(NOW - 90 * 86_400_000);
      const send = new URL(calls[0]!.url);
      expect(send.searchParams.get('fd')).toBe('20260715');
      expect(send.searchParams.get('td')).toBe('20261012');
      expect(h.currency).toBe('EUR');
      expect(h.asOf).toBe(Date.parse('2026-10-12T20:00:00Z'));
      expect(byId(h.trades).map((t) => [t.id, t.pnl, t.net === null ? null : Math.round(t.net * 100) / 100])).toEqual([
        ['A', 50, 45],
        ['B', -10, -10],
        ['E', 7, null],
        ['G', -1.5, -1.35],
      ]);
      expect(h.trades.find((t) => t.id === 'A')?.closedAt).toBe(Date.parse('2026-10-12T14:05:00Z'));
      // The report is kept 15 minutes.
      const n = calls.length;
      await brokerAdapter('ibkr', creds, 'live', { now: () => NOW, ...noSleep }).closedTrades!(NOW - 90 * 86_400_000);
      expect(calls.length).toBe(n);
    });

    it('on Monday the report ends on Friday; orders without executions; what the query lacks', async () => {
      const monday = Date.parse('2026-10-19T14:00:00Z');
      flex(report(trade({ levelOfDetail: 'ORDER', ibOrderID: 'X', openCloseIndicator: 'C', fifoPnlRealized: '3', dateTime: '20261016;100000' })));
      const h = await brokerAdapter('ibkr', creds, 'live', { now: () => monday, ...noSleep }).closedTrades!(monday - 7 * 86_400_000);
      expect(new URL(calls[0]!.url).searchParams.get('td')).toBe('20261016');
      expect(h.trades.map((t) => t.id)).toEqual(['X']);
      const fails = async (xml: string) => {
        resetBrokerCaches();
        flex(xml);
        return brokerAdapter('ibkr', creds, 'live', { now: () => monday, ...noSleep }).closedTrades!(monday - 7 * 86_400_000).catch((e: unknown) => e);
      };
      expect(await fails('<FlexQueryResponse><FlexStatements><FlexStatement toDate="20261016"><OpenPositions /></FlexStatement></FlexStatements></FlexQueryResponse>')).toMatchObject({ code: 'EXCHANGE', message: expect.stringContaining('„Trades”') });
      expect(await fails(report(trade({ ibOrderID: 'Y', dateTime: '20261016;100000' })))).toMatchObject({ message: expect.stringContaining('Realized P/L') });
      expect(await fails(report(trade({ levelOfDetail: 'SYMBOL_SUMMARY', fifoPnlRealized: '1' })))).toMatchObject({ message: expect.stringContaining('Execution') });
      // An empty Trades section: no trades, no error.
      expect(await fails(report(''))).toMatchObject({ trades: [] });
      resetBrokerCaches();
      serve((u) => (u.pathname.endsWith('/SendRequest') ? { body: '<FlexStatementResponse><Status>Fail</Status><ErrorCode>1006</ErrorCode><ErrorMessage>FIFO P/L data is not ready at this time. Please try again shortly.</ErrorMessage></FlexStatementResponse>' } : undefined));
      const err = await brokerAdapter('ibkr', creds, 'live', { now: () => monday, ...noSleep }).closedTrades!(monday - 7 * 86_400_000).catch((e: unknown) => e);
      expect(err).toMatchObject({ code: 'MAINTENANCE', message: expect.stringContaining('nu e gata') });
    });

    it('from today (or a weekend day after the last close): nothing to ask for yet', async () => {
      serve(() => undefined);
      const monday = Date.parse('2026-10-19T14:00:00Z');
      const h = await brokerAdapter('ibkr', creds, 'live', { now: () => monday, ...noSleep }).closedTrades!(Date.parse('2026-10-17T12:00:00Z'));
      expect(calls).toHaveLength(0);
      // Friday's close, 16:00 in New York.
      expect(h).toMatchObject({ trades: [], asOf: Date.parse('2026-10-16T20:00:00Z') });
    });

    it('an expired report is dropped when a new one comes (the period changes key every day)', async () => {
      let t = NOW;
      flex(report(''));
      const ib = () => brokerAdapter('ibkr', creds, 'live', { now: () => t, ...noSleep });
      await ib().closedTrades!(t - 90 * 86_400_000);
      await ib().closedTrades!(t - 30 * 86_400_000);
      expect(brokerCacheSizes().flex).toBe(2);
      t += 16 * 60_000;
      await ib().closedTrades!(t - 7 * 86_400_000);
      expect(brokerCacheSizes().flex).toBe(1);
    });

    it("the token's reports go one after another (IBKR: one request a second)", async () => {
      const order: string[] = [];
      const gaps: number[] = [];
      serve(
        (u) => {
          if (!u.pathname.endsWith('/SendRequest')) return undefined;
          order.push(u.searchParams.get('fd') ? 'send-stats' : 'send-portfolio');
          return { body: sendOk };
        },
        (u) => {
          if (!u.pathname.endsWith('/GetStatement')) return undefined;
          order.push('get');
          return { body: report('') };
        },
      );
      const opts = { now: () => NOW, sleep: async (ms: number) => void gaps.push(ms) };
      await Promise.all([brokerAdapter('ibkr', creds, 'live', opts).load(), brokerAdapter('ibkr', creds, 'live', opts).closedTrades!(NOW - 86_400_000)]);
      expect(order).toEqual(['send-portfolio', 'get', 'send-stats', 'get']);
      expect(gaps).toContain(1_100);
    });
  });

  describe('Alpaca', () => {
    let seq = 0;
    const ex = (orderId: string, symbol: string, side: 'buy' | 'sell', qty: number, price: number, time: number): FifoExec => ({ id: `${String(time).padStart(6, '0')}::${++seq}`, orderId, symbol, side, qty, price, time });

    it('first in, first out: partial fills, several lots, one result per closing order', () => {
      const r = fifoResults(
        [
          ex('o1', 'AAPL', 'buy', 10, 100, 1),
          ex('o2', 'AAPL', 'buy', 5, 110, 2),
          // One order filled in two pieces: 10 × (120 − 100) + 2 × (120 − 110).
          ex('o3', 'AAPL', 'sell', 7, 120, 3),
          ex('o3', 'AAPL', 'sell', 5, 120, 4),
          ex('o4', 'AAPL', 'sell', 3, 105, 5),
          // Coins written both ways are one book.
          ex('c1', 'BTC/USD', 'buy', 0.5, 60000, 6),
          ex('c2', 'BTCUSD', 'sell', 0.5, 62000, 7),
          // An option contract is 100 shares.
          ex('p1', 'AAPL261120C00300000', 'buy', 1, 5, 8),
          ex('p2', 'AAPL261120C00300000', 'sell', 1, 7, 9),
        ],
        { complete: true, shorting: false },
      );
      expect(byId(r).map((t) => [t.id, t.pnl, t.closedAt])).toEqual([
        ['c2', 1000, 7],
        ['o3', 220, 4],
        ['o4', -15, 5],
        ['p2', 200, 9],
      ]);
    });

    it('a sell beyond the shares held: a short where the account may short, otherwise an unknown result', () => {
      const execs = [ex('s1', 'TSLA', 'sell', 2, 300, 1), ex('b1', 'TSLA', 'buy', 2, 280, 2), ex('l1', 'NVDA', 'buy', 1, 100, 3), ex('r1', 'NVDA', 'sell', 3, 110, 4), ex('r2', 'NVDA', 'buy', 2, 90, 5)];
      // Shorting: the buy closes the short (+40); a reversal counts its closing part (+10), its short closes later (+40).
      expect(byId(fifoResults(execs, { complete: true, shorting: true })).map((t) => [t.id, t.pnl])).toEqual([
        ['b1', 40],
        ['r1', 10],
        ['r2', 40],
      ]);
      // No shorting (or a history read only in part): the sells beyond the shares have an unknown cost.
      const unknown = byId(fifoResults(execs, { complete: true, shorting: false })).map((t) => [t.id, t.pnl]);
      expect(unknown).toEqual([
        ['r1', null],
        ['s1', null],
      ]);
      expect(byId(fifoResults(execs, { complete: false, shorting: true })).map((t) => [t.id, t.pnl])).toEqual(unknown);
      // A sale Alpaca marks `sell_short` is a short even with a history read only in part.
      const marked = [{ ...ex('m1', 'AMD', 'sell', 3, 150, 10), short: true }, ex('m2', 'AMD', 'buy', 3, 140, 11)];
      expect(fifoResults(marked, { complete: false, shorting: false }).map((t) => [t.id, t.pnl])).toEqual([['m2', 30]]);
    });

    it('reads the fills newest first, page after page by the last id, up to 40 pages', async () => {
      const creds = { keyId: 'PKTEST1234', secret: 'SECRET5678' };
      const t0 = Date.parse('2026-10-12T12:00:00Z');
      // 130 fills, newest first: a buy 100 days ago, then sells of 1 share each hour.
      const fills = [
        ...Array.from({ length: 129 }, (_, i) => ({ id: `f${1000 - i}`, order_id: `o${i}`, symbol: 'AAPL', side: i === 3 ? 'sell_short' : 'sell', qty: '1', price: '120', transaction_time: new Date(t0 - i * 3_600_000).toISOString() })),
        { id: 'f0', order_id: 'buy', symbol: 'AAPL', side: 'buy', qty: '200', price: '100', transaction_time: new Date(t0 - 100 * 86_400_000).toISOString() },
      ];
      serve(at('/v2/account', { currency: 'USD', shorting_enabled: false }), (u) => {
        if (u.pathname !== '/v2/account/activities/FILL') return undefined;
        const token = u.searchParams.get('page_token');
        const start = token ? fills.findIndex((f) => f.id === token) + 1 : 0;
        return { body: fills.slice(start, start + 100) };
      });
      const h = await brokerAdapter('alpaca', creds, 'live', { now: () => NOW }).closedTrades!(t0 - 24 * 3_600_000);
      const pages = calls.filter((c) => c.url.includes('/activities/FILL')).map((c) => new URL(c.url).searchParams);
      expect(pages.map((q) => [q.get('direction'), q.get('page_size'), q.get('page_token')])).toEqual([
        ['desc', '100', null],
        ['desc', '100', 'f901'],
      ]);
      // Only the sells of the last 24 hours (25 of them, the start included), each + 20 (`sell_short` is a sale too).
      expect(h.trades).toHaveLength(25);
      expect(h.trades.every((t) => t.pnl === 20)).toBe(true);
      expect(h).toMatchObject({ currency: 'USD', coveredFrom: 0, asOf: null });
      // 40 full pages: the buy is never reached, so the sells have an unknown cost.
      calls.length = 0;
      serve(at('/v2/account', { currency: 'USD' }), (u) => {
        if (u.pathname !== '/v2/account/activities/FILL') return undefined;
        const n = Number((u.searchParams.get('page_token') ?? 'p0').slice(1));
        return { body: Array.from({ length: 100 }, (_, i) => ({ id: i === 99 ? `p${n + 1}` : `x${n}-${i}`, order_id: `s${n}-${i}`, symbol: 'AAPL', side: 'sell', qty: '1', price: '120', transaction_time: new Date(t0 - (n * 100 + i) * 60_000).toISOString() })) };
      });
      const cut = await brokerAdapter('alpaca', creds, 'live', { now: () => NOW }).closedTrades!(t0 - 3_600_000);
      expect(calls.filter((c) => c.url.includes('/activities/FILL'))).toHaveLength(40);
      expect(cut.coveredFrom).toBe(t0 - 3999 * 60_000);
      expect(cut.trades.length).toBeGreaterThan(0);
      expect(cut.trades.every((t) => t.pnl === null)).toBe(true);
    });
  });

  it('reads an ISO time without a zone as UTC', () => {
    expect(utcTime('2026-10-12T10:00:00')).toBe(Date.parse('2026-10-12T10:00:00Z'));
    expect(utcTime('2026-10-12T10:00:00.5+02:00')).toBe(Date.parse('2026-10-12T08:00:00.5Z'));
    expect(utcTime('2026-10-12')).toBe(Date.parse('2026-10-12T00:00:00Z'));
    expect(utcTime('')).toBeNull();
    expect(utcTime('nope')).toBeNull();
  });
});
