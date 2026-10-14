import { describe, expect, it } from 'vitest';
import { indexById, indexId, INDICES, isIndexId, LISTED_SYMBOL_RE, plainSymbol, searchIndices } from './indices.ts';

describe('indices catalog (FD-INDICES)', () => {
  it('has the seven US indices, each with an id, a name and aliases of at least 3 letters', () => {
    expect(INDICES.map((i) => i.id)).toEqual(['^SPX', '^NDX', '^COMP', '^DJI', '^RUT', '^VIX', '^SOX']);
    for (const i of INDICES) {
      expect(i.id).toBe(`^${i.symbol}`);
      expect(i.name.length).toBeGreaterThan(2);
      expect(i.aliases.every((a) => a.length >= 3 && a.length <= 40)).toBe(true);
    }
    // Not the words that would tag other things: "Dow" (Dow Inc.), "COMP" (Compound).
    expect(INDICES.flatMap((i) => i.aliases)).not.toContain('Dow');
    expect(INDICES.flatMap((i) => i.aliases)).not.toContain('COMP');
  });

  it('normalizes a symbol or an id, and refuses what is not in the list', () => {
    expect(indexId('spx')).toBe('^SPX');
    expect(indexId(' SPX ')).toBe('^SPX');
    expect(indexId('^dji')).toBe('^DJI');
    expect(indexId('DAX')).toBeNull();
    expect(indexId('AAPL')).toBeNull();
    expect(indexById('^RUT')?.name).toBe('Russell 2000');
    expect(indexById('RUT')).toBeUndefined();
    expect(isIndexId('^SPX')).toBe(true);
    expect(isIndexId('SPX')).toBe(false);
  });

  it('shows the symbol without its "^"', () => {
    expect(plainSymbol('^SPX')).toBe('SPX');
    expect(plainSymbol('AAPL')).toBe('AAPL');
    expect(plainSymbol('BTC')).toBe('BTC');
  });

  it('finds indices by symbol, name or alias, however written', () => {
    expect(searchIndices('').length).toBe(7);
    expect(searchIndices('  ').length).toBe(7);
    expect(searchIndices('spx').map((i) => i.symbol)).toEqual(['SPX']);
    expect(searchIndices('s&p').map((i) => i.symbol)).toEqual(['SPX', 'VIX']);
    // VIX's name says what it measures: the S&P 500's volatility.
    expect(searchIndices('sp500').map((i) => i.symbol)).toEqual(['SPX', 'VIX']);
    expect(searchIndices('dow').map((i) => i.symbol)).toEqual(['DJI']);
    expect(searchIndices('NASDAQ').map((i) => i.symbol)).toEqual(['NDX', 'COMP']);
    expect(searchIndices('volatilitatea').map((i) => i.symbol)).toEqual(['VIX']);
    expect(searchIndices('DAX')).toEqual([]);
  });

  it('accepts shares and index ids as listed symbols', () => {
    for (const ok of ['AAPL', 'BRK.B', '^SPX', '^COMP']) expect(LISTED_SYMBOL_RE.test(ok)).toBe(true);
    for (const bad of ['^', '^S', '^SPXSPXS', 'aapl', '^1A', 'BTC/USDT']) expect(LISTED_SYMBOL_RE.test(bad)).toBe(false);
  });
});
