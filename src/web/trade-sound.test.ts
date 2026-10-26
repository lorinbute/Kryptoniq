import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('the coin sound (FD-TRADESOUND)', () => {
  it('plays from the start, once for trades ending together; a refused play stays silent', async () => {
    const plays: number[] = [];
    class FakeAudio {
      src: string;
      preload = '';
      muted = false;
      volume = 1;
      currentTime = 5;
      constructor(src: string) {
        this.src = src;
      }
      play() {
        if (!this.muted) plays.push(this.currentTime);
        return Promise.reject(new Error('NotAllowedError'));
      }
      pause() {}
    }
    vi.stubGlobal('Audio', FakeAudio);
    const { playTradeSound } = await import('./trade-sound.ts');
    expect(playTradeSound(10_000)).toBe(true);
    // A second account's trade in the same reading: one sound.
    expect(playTradeSound(10_800)).toBe(false);
    expect(playTradeSound(12_000)).toBe(true);
    expect(plays).toEqual([0, 0]);
  });

  /** Safari (WebKit): `pause()` after a play leaves the clip running to its end; what is heard is its unmuted part. */
  class WebKitAudio {
    static last: WebKitAudio | null = null;
    preload = '';
    muted = false;
    volume = 1;
    currentTime = 0;
    running = false;
    heard = 0;
    resolve: (() => void) | null = null;
    constructor() {
      WebKitAudio.last = this;
    }
    play() {
      this.running = true;
      if (!this.muted && this.volume > 0) this.heard++;
      return new Promise<void>((r) => (this.resolve = r));
    }
    pause() {
      // ignored by the platform: the clip runs on
    }
    /** The clip still running when the element is turned up: heard. */
    unmutedWhileRunning() {
      return this.running && !this.muted && this.volume > 0;
    }
  }

  it('FIX-COINSOUND2: readying it in a click is silent even where the pause does not stop the clip (Safari)', async () => {
    vi.stubGlobal('Audio', WebKitAudio);
    const { readyTradeSound, playTradeSound } = await import('./trade-sound.ts');
    readyTradeSound();
    const a = WebKitAudio.last as WebKitAudio;
    a.resolve?.();
    await new Promise((r) => setTimeout(r, 0));
    // The clip runs on after the pause, still muted: nothing heard.
    expect(a.unmutedWhileRunning()).toBe(false);
    expect(a.heard).toBe(0);
    // Readied once per page: a second click does nothing.
    readyTradeSound();
    expect(a.heard).toBe(0);
    // A trade ends: the sound, turned up now.
    expect(playTradeSound(50_000)).toBe(true);
    expect(a.heard).toBe(1);
    expect(a.currentTime).toBe(0);
  });

  it('a trade sound started before the readying play resolved is not paused by it', async () => {
    const paused: boolean[] = [];
    class SlowAudio extends WebKitAudio {
      override pause() {
        paused.push(this.muted);
      }
    }
    vi.stubGlobal('Audio', SlowAudio);
    const { readyTradeSound, playTradeSound } = await import('./trade-sound.ts');
    readyTradeSound();
    const a = WebKitAudio.last as WebKitAudio;
    const first = a.resolve;
    playTradeSound(60_000);
    first?.();
    await new Promise((r) => setTimeout(r, 0));
    expect(paused).toEqual([]);
    expect(a.heard).toBe(1);
  });
});
