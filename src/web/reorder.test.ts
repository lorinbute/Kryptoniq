import { describe, expect, it } from 'vitest';
import { settingsSchema } from '../shared/settings.ts';
import { moveItem } from './reorder.ts';

describe('moving a favourite (FD-CHARTFAV §2)', () => {
  const list = ['BTC', 'ETH', 'AAPL', 'SOL'];
  it('moves forward and back', () => {
    expect(moveItem(list, 0, 2)).toEqual(['ETH', 'AAPL', 'BTC', 'SOL']);
    expect(moveItem(list, 3, 1)).toEqual(['BTC', 'SOL', 'ETH', 'AAPL']);
    expect(moveItem(list, 2, 3)).toEqual(['BTC', 'ETH', 'SOL', 'AAPL']);
  });
  it('leaves the list as it is for the same place or a place outside it', () => {
    expect(moveItem(list, 1, 1)).toEqual(list);
    expect(moveItem(list, 0, -1)).toEqual(list);
    expect(moveItem(list, 3, 4)).toEqual(list);
    expect(moveItem(list, -1, 2)).toEqual(list);
    // A copy, never the list itself.
    expect(moveItem(list, 1, 1)).not.toBe(list);
  });
});

describe('Slingshot on the chart (FD-CHARTFAV §1)', () => {
  it('is on unless switched off, also for settings saved before the switch existed', () => {
    expect(settingsSchema.parse({}).charts.showSlingshot).toBe(true);
    expect(settingsSchema.parse({ charts: { showLma: false } }).charts).toMatchObject({ showSlingshot: true, showLma: false });
    expect(settingsSchema.parse({ charts: { showSlingshot: false } }).charts.showSlingshot).toBe(false);
  });
});
