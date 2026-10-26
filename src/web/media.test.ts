// FD-WATCHDRAWER: the media query behind the phone / wide layout of the chart's symbol list.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mediaMatches } from './media.ts';

afterEach(() => vi.unstubAllGlobals());

describe('a media query', () => {
  it('is false where there is no matchMedia (tests, a server)', () => {
    expect(mediaMatches('(min-width: 768px)')).toBe(false);
  });

  it("is the browser's answer where there is one", () => {
    const asked: string[] = [];
    vi.stubGlobal('window', { matchMedia: (q: string) => (asked.push(q), { matches: q === '(min-width: 768px)' }) });
    expect(mediaMatches('(min-width: 768px)')).toBe(true);
    expect(mediaMatches('(min-width: 1200px)')).toBe(false);
    expect(asked).toEqual(['(min-width: 768px)', '(min-width: 1200px)']);
  });
});
