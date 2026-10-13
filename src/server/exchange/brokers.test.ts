import { afterEach, describe, expect, it } from 'vitest';
import { setFetchImpl } from '../net/http.ts';
import { brokerAdapter, BrokerError, flexDate, resetBrokerCaches, t212Symbol, xmlElements } from './brokers.ts';

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
