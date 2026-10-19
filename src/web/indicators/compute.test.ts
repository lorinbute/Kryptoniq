// TD-INDICATORS §6: the inputs an indicator runs with, the timeframes, the chart context, what the legend shows.
import { describe, expect, it } from 'vitest';
import type { InputConfig, PlotConfig } from 'oakscriptjs';
import { changedInputs, chartContext, fmtStudyValue, inputProblem, pineTf, plotShown, sanitizeInputs, sentiqTf, tickerIdOf } from './compute.ts';

const cfg = (c: Partial<InputConfig> & Pick<InputConfig, 'id' | 'type'>): InputConfig => ({ defval: null, ...c }) as InputConfig;

describe('the inputs an indicator runs with', () => {
  const mod = {
    defaultInputs: { length: 14, mult: 2, src: 'close', show: true, kind: 'SMA', color: '#2962FF', tf: '', session: '0930-1600', sym: 'GOOG' },
    inputConfig: [
      cfg({ id: 'length', type: 'int', min: 1, max: 500 }),
      cfg({ id: 'mult', type: 'float', min: 0.001, max: 50 }),
      cfg({ id: 'src', type: 'source' }),
      cfg({ id: 'show', type: 'bool' }),
      cfg({ id: 'kind', type: 'string', options: ['SMA', 'EMA'] }),
      cfg({ id: 'color', type: 'color' }),
      cfg({ id: 'tf', type: 'timeframe' }),
      cfg({ id: 'session', type: 'session' }),
      cfg({ id: 'sym', type: 'symbol' }),
    ],
  };

  it('keeps each saved value that fits, the default for the rest, and ignores unknown keys', () => {
    expect(sanitizeInputs(mod, { length: 21, mult: 2.5, src: 'hl2', show: false, kind: 'EMA', color: '#FF000080', tf: '1D', session: '0800-1700:23456', sym: 'NASDAQ:AAPL', junk: 1 })).toEqual({
      length: 21, mult: 2.5, src: 'hl2', show: false, kind: 'EMA', color: '#FF000080', tf: '1D', session: '0800-1700:23456', sym: 'NASDAQ:AAPL',
    }); // prettier-ignore
    expect(sanitizeInputs(mod, { length: 0, mult: Number.NaN, src: 'median', show: 'yes', kind: 'WMA', color: 'red', tf: 'hourly', session: '9-5', sym: 7 })).toEqual(mod.defaultInputs);
    expect(sanitizeInputs(mod, { length: 14.5 }).length).toBe(14);
  });

  it('says why a value does not fit (the form lists the field and its limits)', () => {
    expect(inputProblem(mod.inputConfig[0] as InputConfig, 501)).toBe('cel mult 500');
    expect(inputProblem(mod.inputConfig[0] as InputConfig, 2.5)).toBe('trebuie să fie un număr întreg');
    expect(inputProblem(mod.inputConfig[1] as InputConfig, 0)).toBe('cel puțin 0.001');
    expect(inputProblem(mod.inputConfig[4] as InputConfig, 'EMA')).toBeNull();
  });

  it('saves only what differs from the defaults', () => {
    expect(changedInputs(mod, { ...mod.defaultInputs, length: 21, kind: 'EMA' })).toEqual({ length: 21, kind: 'EMA' });
    expect(changedInputs(mod, mod.defaultInputs)).toEqual({});
  });
});

describe('timeframes and the chart context', () => {
  it('Sentiq ↔ PineScript', () => {
    expect(pineTf('1h')).toBe('60');
    expect(pineTf('1d')).toBe('1D');
    expect(sentiqTf('240')).toBe('4h');
    expect(sentiqTf('D')).toBe('1d');
    expect(sentiqTf('W')).toBe('1w');
    expect(sentiqTf('M')).toBe('1M');
    expect(sentiqTf('1M')).toBe('1M');
    expect(sentiqTf('1S')).toBeNull();
    expect(sentiqTf('2D')).toBeNull();
    expect(sentiqTf('45')).toBeNull();
  });

  it('the symbol as TradingView names it, its zone and tick', () => {
    expect(tickerIdOf({ kind: 'crypto', exchange: 'kucoin', symbol: 'BTC/USDT', tf: '1h', precision: 1 })).toBe('KUCOIN:BTCUSDT');
    expect(tickerIdOf({ kind: 'stock', exchange: 'stock', symbol: 'AAPL', tf: '1d', precision: 2 })).toBe('NASDAQ:AAPL');
    expect(tickerIdOf({ kind: 'index', exchange: 'index', symbol: '^SPX', tf: '1d', precision: 2 })).toBe('INDEX:SPX');
    expect(chartContext({ kind: 'crypto', exchange: 'binance', symbol: 'ETH/USDC', tf: '15m', precision: 2 })).toMatchObject({
      timeframe: '15', timezone: 'Etc/UTC', session: '24x7', tickerid: 'BINANCE:ETHUSDC', symbolType: 'crypto', currency: 'USDC', basecurrency: 'ETH', mintick: 0.01, lastBarConfirmed: false,
    }); // prettier-ignore
    expect(chartContext({ kind: 'stock', exchange: 'stock', symbol: 'AAPL', tf: '1d', precision: 2 })).toMatchObject({ timezone: 'America/New_York', session: '0930-1600', currency: 'USD' });
  });
});

describe('the legend', () => {
  const plot = (p: Partial<PlotConfig>): PlotConfig => ({ id: 'plot0', title: 'P', color: '#fff', ...p });
  it('shows a plot as the renderer draws it', () => {
    expect(plotShown(plot({}), undefined, {}, null)).toBe(true);
    expect(plotShown(plot({ display: 'none' }), undefined, {}, null)).toBe(false);
    expect(plotShown(plot({ display: 'none' }), { visible: true }, {}, null)).toBe(true);
    expect(plotShown(plot({ visible: 'showMA' }), undefined, { showMA: false }, null)).toBe(false);
    expect(plotShown(plot({}), { visible: false }, {}, null)).toBe(false);
  });

  it('values: the chart precision over the candles, a few digits in a pane', () => {
    expect(fmtStudyValue(1234.5678, true, 1)).toBe('1234.6');
    expect(fmtStudyValue(54.321, false, 1)).toBe('54.321');
    expect(fmtStudyValue(0.000123456, false, 1)).toBe('0.000123');
    expect(fmtStudyValue(Number.NaN, false, 2)).toBe('—');
  });
});
