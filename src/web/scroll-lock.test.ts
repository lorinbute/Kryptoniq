// FD-SCROLLLOCK: one counted lock for every panel, window and the chart's full screen.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lockScroll } from './scroll-lock.ts';

const html = { style: { overflow: '', paddingRight: '' }, clientWidth: 985 };
const g = globalThis as unknown as { document?: unknown; window?: unknown };
let saved: { document?: unknown; window?: unknown };

beforeEach(() => {
  saved = { document: g.document, window: g.window };
  html.style = { overflow: 'auto', paddingRight: '2px' };
  g.document = { documentElement: html };
  // A visible scrollbar of 15 px.
  g.window = { innerWidth: 1000 };
});
afterEach(() => {
  g.document = saved.document;
  g.window = saved.window;
});

describe('the page scroll lock', () => {
  it('locks on the first, keeps the scrollbar place, and unlocks only after the last, in any order', () => {
    const a = lockScroll();
    expect(html.style).toEqual({ overflow: 'hidden', paddingRight: '15px' });
    const b = lockScroll();
    // The first one closes while the second is still open: the page stays locked.
    a();
    expect(html.style.overflow).toBe('hidden');
    // Releasing the same lock twice changes nothing.
    a();
    expect(html.style.overflow).toBe('hidden');
    b();
    expect(html.style).toEqual({ overflow: 'auto', paddingRight: '2px' });
  });

  it('adds no padding where the scrollbar takes no room (overlay scrollbars)', () => {
    html.clientWidth = 1000;
    const a = lockScroll();
    expect(html.style).toEqual({ overflow: 'hidden', paddingRight: '2px' });
    a();
    expect(html.style).toEqual({ overflow: 'auto', paddingRight: '2px' });
    html.clientWidth = 985;
  });
});
