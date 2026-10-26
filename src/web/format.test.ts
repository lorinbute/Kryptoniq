import { describe, expect, it } from 'vitest';
import { countRo, fmtBytes, fmtCountdown } from './format.ts';

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

describe('fmtBytes', () => {
  it('goes up to GB for the database limits (FD-AZURE §5)', () => {
    expect(fmtBytes(512)).toBe('512 B');
    expect(fmtBytes(4.4 * 1024 ** 2)).toBe('4.4 MB');
    expect(fmtBytes(2 * 1024 ** 3)).toBe('2 GB');
    expect(fmtBytes(10 * 1024 ** 3)).toBe('10 GB');
    expect(fmtBytes(1.5 * 1024 ** 3)).toBe('1.5 GB');
  });
});

describe('countRo', () => {
  it('says the count as Romanian does', () => {
    expect(countRo(1, 'desen', 'desene')).toBe('1 desen');
    expect(countRo(3, 'desen', 'desene')).toBe('3 desene');
    expect(countRo(19, 'indicator', 'indicatori')).toBe('19 indicatori');
    expect(countRo(20, 'indicator', 'indicatori')).toBe('20 de indicatori');
    expect(countRo(101, 'desen', 'desene')).toBe('101 desene');
    expect(countRo(120, 'desen', 'desene')).toBe('120 de desene');
    expect(countRo(200, 'desen', 'desene')).toBe('200 de desene');
  });
});
