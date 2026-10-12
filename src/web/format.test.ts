import { describe, expect, it } from 'vitest';
import { fmtCountdown } from './format.ts';

describe('fmtCountdown', () => {
  const now = Date.parse('2026-10-12T18:46:00Z');
  it('shows days, hours and minutes when more than a day is left', () => {
    expect(fmtCountdown(now + (41 * 60 + 44) * 60_000, now)).toBe('1z 17h 44m');
  });
  it('drops the days, then the hours', () => {
    expect(fmtCountdown(now + (3 * 60 + 5) * 60_000, now)).toBe('3h 05m');
    expect(fmtCountdown(now + 12 * 60_000 + 9_000, now)).toBe('12m 09s');
  });
  it('never goes negative', () => {
    expect(fmtCountdown(now - 60_000, now)).toBe('0m 00s');
  });
});
