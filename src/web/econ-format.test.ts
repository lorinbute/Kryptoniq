import { describe, expect, it } from 'vitest';
import { fmtEconChange, fmtEconPeriod, fmtEconValue, foldText, surprise } from './econ-format.ts';

describe('Economy page formatting (TD-ECON §6)', () => {
  it('writes values with their scale and unit', () => {
    expect(fmtEconValue(3.8, '%', null)).toBe('3,8%');
    expect(fmtEconValue(197, null, 'K')).toBe('197 mii');
    expect(fmtEconValue(1.275, null, 'M')).toBe('1,275 mil.');
    expect(fmtEconValue(14.2, '€', 'B')).toBe('14,2 mld. €');
    expect(fmtEconValue(6.748, '$', 'T')).toBe('6,748 tril. $');
    expect(fmtEconValue(-1105.6, '¥', 'B')).toBe('-1.105,6 mld. ¥');
    expect(fmtEconValue(54.5, null, null)).toBe('54,5');
    expect(fmtEconValue(null, '%', null)).toBe('—');
  });

  it('writes changes in percentage points or in the unit', () => {
    expect(fmtEconChange(0.2, '%', null)).toBe('+0,2 pp');
    expect(fmtEconChange(-0.10000000000000009, '%', null)).toBe('−0,1 pp');
    expect(fmtEconChange(-8, null, 'K')).toBe('−8 mii');
    expect(fmtEconChange(0, '%', null)).toBe('0');
    expect(fmtEconChange(null, '%', null)).toBe('—');
  });

  it('writes periods in Romanian', () => {
    expect(fmtEconPeriod('Aug')).toBe('aug.');
    expect(fmtEconPeriod('Sep')).toBe('sept.');
    expect(fmtEconPeriod('Q2')).toBe('T2');
    expect(fmtEconPeriod('H1')).toBe('S1');
    expect(fmtEconPeriod('Oct/03')).toBe('săpt. 3 oct.');
    expect(fmtEconPeriod('')).toBe('—');
    expect(fmtEconPeriod('2026')).toBe('2026');
  });

  it('compares the value with its forecast, and searches without diacritics', () => {
    expect(surprise(2.9, 2.8, '%', null)).toBe('peste prognoză (2,8%)');
    expect(surprise(190, 200, null, 'K')).toBe('sub prognoză (200 mii)');
    expect(surprise(2.8, 2.8, '%', null)).toBe('conform prognozei');
    expect(surprise(2.8, null, '%', null)).toBeNull();
    expect(foldText('Inflația de bază')).toBe('inflatia de baza');
  });
});

describe('good or bad for the economy (FD-ECONCOLOR)', () => {
  it('colours a change by its direction and the indicator’s sense', async () => {
    const { toneOf } = await import('./econ-format.ts');
    expect(toneOf(0.3, -1)).toBe('bad'); // inflation up
    expect(toneOf(-0.3, -1)).toBe('good'); // inflation down
    expect(toneOf(0.4, 1)).toBe('good'); // GDP up
    expect(toneOf(-0.4, 1)).toBe('bad'); // GDP down
    expect(toneOf(0.4, 0)).toBe('neutral'); // wages
    expect(toneOf(0.0000001, 1)).toBe('neutral');
    expect(toneOf(null, 1)).toBe('neutral');
  });
});

describe('filtering the Economy page (FD-ECONFILTER)', () => {
  it('keeps every country and only the indicators the search and "important only" let through', async () => {
    const { filterEconomy } = await import('./econ-format.ts');
    const ind = (name: string, original: string, important: boolean, countryName: string | null = null) => ({ name, original, important, countryName });
    const countries = [
      { code: 'US', indicators: [ind('Rata șomajului', 'Unemployment Rate', true), ind('Cereri inițiale de șomaj', 'Initial Jobless Claims', true), ind('Stocuri en-gros', 'Wholesale Inventories', false)] },
      { code: 'EU', indicators: [ind('Inflația (anuală)', 'Inflation Rate', true), ind('Încrederea mediului de afaceri', 'Business Confidence', true, 'Germania')] },
    ];
    const count = (opts: { search: string; importantOnly: boolean }) => filterEconomy(countries, opts).map((c) => [c.code, c.indicators.length]);
    expect(count({ search: '', importantOnly: false })).toEqual([['US', 3], ['EU', 2]]);
    expect(count({ search: 'somaj', importantOnly: false })).toEqual([['US', 2], ['EU', 0]]);
    expect(count({ search: 'jobless', importantOnly: false })).toEqual([['US', 1], ['EU', 0]]);
    expect(count({ search: 'germania', importantOnly: false })).toEqual([['US', 0], ['EU', 1]]);
    expect(count({ search: '', importantOnly: true })).toEqual([['US', 2], ['EU', 2]]);
    expect(count({ search: '  INFLATIA  anuala ', importantOnly: true })).toEqual([['US', 0], ['EU', 1]]);
  });
});
