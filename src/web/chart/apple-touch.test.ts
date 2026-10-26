// FD-IPADFS2: an iPhone or iPad never asks for the system's full screen (its pull down would leave it).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAppleTouch, nativeFullscreenAllowed } from './fullscreen.ts';

afterEach(() => vi.unstubAllGlobals());

const as = (userAgent: string, maxTouchPoints: number) => vi.stubGlobal('navigator', { userAgent, maxTouchPoints });

describe('an iPhone or iPad', () => {
  it('is told by its user agent, or by a "Mac" with touch points (iPadOS, an iPhone asking for desktop sites)', () => {
    as('Mozilla/5.0 (iPad; CPU OS 12_0 like Mac OS X) AppleWebKit/605.1.15', 5);
    expect(isAppleTouch()).toBe(true);
    as('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15', 5);
    expect(isAppleTouch()).toBe(true);
    as('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 5);
    expect(isAppleTouch()).toBe(true);
    as('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/130.0 Mobile/15E148 Safari/604.1', 5);
    expect(isAppleTouch()).toBe(true);
  });

  it('is not a Mac, an Android phone or a Windows tablet', () => {
    as('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15', 0);
    expect(isAppleTouch()).toBe(false);
    as('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36', 5);
    expect(isAppleTouch()).toBe(false);
    as('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 10);
    expect(isAppleTouch()).toBe(false);
  });

  it('covers the window instead of the system\'s full screen; everything else may ask for it', () => {
    as('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15', 5);
    expect(nativeFullscreenAllowed()).toBe(false);
    as('Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)', 5);
    expect(nativeFullscreenAllowed()).toBe(false);
    as('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15', 0);
    expect(nativeFullscreenAllowed()).toBe(true);
    as('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 10);
    expect(nativeFullscreenAllowed()).toBe(true);
  });
});
