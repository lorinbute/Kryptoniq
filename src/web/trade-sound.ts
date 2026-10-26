// FD-TRADESOUND: the coin sound of a trade that ended. One audio element; Safari on iPhone / iPad plays nothing before a
// touch, so the first touch (or key) of the page readies it, silently. Two calls within 1.5 s make one sound.
// FIX-COINSOUND2: Safari (WebKit) does not stop the readying play at `pause()`: the clip runs on to its end. The element
// therefore stays muted after it, and only a trade's sound turns it up.
const SRC = '/audio/coin-money.mp3';
const ONCE_MS = 1500;

let audio: HTMLAudioElement | null = null;
let readied = false;
let lastAt = -Infinity;

function element(): HTMLAudioElement | null {
  if (!audio && typeof Audio !== 'undefined') {
    audio = new Audio(SRC);
    audio.preload = 'auto';
  }
  return audio;
}

/** Readies the sound within a gesture (a muted play, then a pause): a later play is allowed. It stays muted after. */
export function readyTradeSound(): void {
  const a = element();
  if (!a || readied) return;
  readied = true;
  // Muted and at volume 0 (silent on every browser, also where one of the two is ignored: an iPhone's volume is fixed).
  a.muted = true;
  a.volume = 0;
  void a
    .play()
    // A trade's sound started meanwhile (it unmuted the element) keeps playing.
    ?.then(() => a.muted && a.pause())
    .catch(() => {
      readied = false;
    });
}

/** The sound, once (from the start, turned up only now); a browser that refuses to play it stays silent. */
export function playTradeSound(now = Date.now()): boolean {
  if (now - lastAt < ONCE_MS) return false;
  lastAt = now;
  const a = element();
  if (!a) return false;
  a.muted = false;
  a.volume = 1;
  a.currentTime = 0;
  void a.play()?.catch(() => undefined);
  return true;
}
