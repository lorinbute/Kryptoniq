// FD-CHARTTV §5: the countdown under the current price.
import { describe, expect, it } from 'vitest';
import { fmtBarCountdown } from './countdown.ts';

describe('the countdown to the candle close', () => {
  it('shows minutes, then hours, then days', () => {
    expect(fmtBarCountdown(50 * 60_000 + 31_000)).toBe('50:31');
    expect(fmtBarCountdown(3_599_999)).toBe('59:59');
    expect(fmtBarCountdown(3_600_000)).toBe('01:00:00');
    expect(fmtBarCountdown(86_399_000)).toBe('23:59:59');
    expect(fmtBarCountdown(86_400_000)).toBe('1z 00:00');
    expect(fmtBarCountdown(3 * 86_400_000 + 4 * 3_600_000 + 10 * 60_000)).toBe('3z 04:10');
  });

  it('shows 00:00 for a candle already due (the next one is on its way)', () => {
    expect(fmtBarCountdown(0)).toBe('00:00');
    expect(fmtBarCountdown(-5_000)).toBe('00:00');
  });
});
