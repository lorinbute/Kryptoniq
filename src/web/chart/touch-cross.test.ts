// FD-CHARTAUDIT §14: the library's touch cross mode is ended by a tap of our own, far off, on each pane.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { endTouchCross } from './touch-cross.ts';

afterEach(() => vi.unstubAllGlobals());

class FakeTouch {
  readonly init: { identifier: number; target: unknown; clientX: number; clientY: number };
  constructor(init: FakeTouch['init']) {
    this.init = init;
  }
}
class FakeTouchEvent {
  readonly type: string;
  readonly init: { touches: FakeTouch[]; changedTouches: FakeTouch[]; bubbles: boolean };
  constructor(type: string, init: FakeTouchEvent['init']) {
    this.type = type;
    this.init = init;
  }
}
const canvas = () => {
  const got: FakeTouchEvent[] = [];
  return { got, dispatchEvent: (e: FakeTouchEvent) => got.push(e) };
};
const pane = (canvases: ReturnType<typeof canvas>[] | null) => ({ getHTMLElement: () => (canvases ? { querySelectorAll: () => canvases } : null) });
const chartOf = (...panes: ReturnType<typeof pane>[]) => ({ panes: () => panes }) as never;

describe('ending the touch cross mode', () => {
  it('taps each pane\'s top canvas (its second), far off the chart: a start, then an end with no finger left', () => {
    vi.stubGlobal('Touch', FakeTouch);
    vi.stubGlobal('TouchEvent', FakeTouchEvent);
    const [a0, a1, b0, b1] = [canvas(), canvas(), canvas(), canvas()];
    endTouchCross(chartOf(pane([a0, a1]), pane([b0, b1])));
    for (const [bottom, top] of [[a0, a1], [b0, b1]] as const) {
      expect(bottom.got).toEqual([]);
      expect(top.got.map((e) => e.type)).toEqual(['touchstart', 'touchend']);
      const [start, end] = top.got as [FakeTouchEvent, FakeTouchEvent];
      expect(start.init.bubbles).toBe(true);
      expect(start.init.touches).toHaveLength(1);
      expect(end.init.touches).toHaveLength(0);
      expect(end.init.changedTouches[0]).toBe(start.init.touches[0]);
      const t = start.init.touches[0]!.init;
      expect(t.target).toBe(top);
      expect(t.clientX).toBeLessThan(-1000);
      expect(t.clientY).toBeLessThan(-1000);
    }
  });

  it('skips a pane without its element or its canvases', () => {
    vi.stubGlobal('Touch', FakeTouch);
    vi.stubGlobal('TouchEvent', FakeTouchEvent);
    const [c0, c1, lone] = [canvas(), canvas(), canvas()];
    endTouchCross(chartOf(pane(null), pane([lone]), pane([c0, c1])));
    expect(lone.got).toEqual([]);
    expect(c1.got.map((e) => e.type)).toEqual(['touchstart', 'touchend']);
  });

  it('does nothing in a browser that cannot make touches', () => {
    vi.stubGlobal('Touch', undefined);
    vi.stubGlobal('TouchEvent', undefined);
    const [c0, c1] = [canvas(), canvas()];
    endTouchCross(chartOf(pane([c0, c1])));
    expect(c1.got).toEqual([]);
  });
});
