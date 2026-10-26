// FD-STUDYMEMORY: an indicator removed and added again comes back with its last settings.
import { describe, expect, it } from 'vitest';
import type { Study } from '../../shared/studies.ts';
import { fromMemory, memoryOf, rememberStudy } from './memory.ts';

const rsi: Study = { uid: 'rsi0000001', id: 'rsi', inputs: { length: 21 }, visible: false, plots: { plot0: { style: 'dotted', width: 3 } }, hlines: { hline_upper: { visible: false } }, fills: { fill_band: { color: '#7E57C240' } }, height: 0.4 };

describe('the last settings of an indicator', () => {
  it('keep everything but the copy and whether it was shown', () => {
    expect(memoryOf(rsi)).toEqual({ id: 'rsi', inputs: { length: 21 }, plots: { plot0: { style: 'dotted', width: 3 } }, hlines: { hline_upper: { visible: false } }, fills: { fill_band: { color: '#7E57C240' } }, height: 0.4 });
    expect(memoryOf({ uid: 'ema0000001', id: 'ema', inputs: {}, visible: true })).toEqual({ id: 'ema', inputs: {} });
  });

  it("replace the indicator's entry whole, the others stay", () => {
    const ema = { id: 'ema' as const, inputs: { length: 50, src: 'hl2' } };
    const list = rememberStudy([ema, { id: 'rsi', inputs: { length: 7 } }], memoryOf(rsi));
    expect(list).toEqual([ema, memoryOf(rsi)]);
    // Saved again without `src`: it does not linger from the previous entry.
    expect(rememberStudy(list, { id: 'ema', inputs: { length: 20 } }).find((m) => m.id === 'ema')).toEqual({ id: 'ema', inputs: { length: 20 } });
  });

  it('give a new copy, always shown; without a memory, TradingView’s values', () => {
    expect(fromMemory('rsi', [memoryOf(rsi)], 'newuid0001')).toEqual({ ...rsi, uid: 'newuid0001', visible: true });
    expect(fromMemory('macd', [memoryOf(rsi)], 'newuid0002')).toEqual({ uid: 'newuid0002', id: 'macd', inputs: {}, visible: true });
  });
});
