import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { KEEP_OLD_ASSETS_MS, pruneOldAssets, pruneRemovedPublic } from './prune-assets.ts';

let dir = '';
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = '';
});

describe('the files of earlier builds (FD-STALE §2)', () => {
  it('stay a week, then go; the new build’s own files always stay', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'sq-assets-'));
    const now = Date.UTC(2026, 9, 13, 12);
    const file = (name: string, ageMs: number) => {
      writeFileSync(path.join(dir, name), 'x');
      const t = (now - ageMs) / 1000;
      utimesSync(path.join(dir, name), t, t);
    };
    file('index-new.js', 0);
    file('News-new.js', 30 * 86_400_000); // written by the new build long ago? the build name keeps it
    file('News-old.js', 2 * 86_400_000); // last week's build, still young
    file('News-older.js', KEEP_OLD_ASSETS_MS + 60_000); // older than a week
    file('styles-older.css', 30 * 86_400_000);
    const gone = pruneOldAssets(dir, new Set(['index-new.js', 'News-new.js']), now);
    expect(gone.sort()).toEqual(['News-older.js', 'styles-older.css']);
    expect(readdirSync(dir).sort()).toEqual(['News-new.js', 'News-old.js', 'index-new.js']);
    expect(pruneOldAssets(path.join(dir, 'missing'), new Set(), now)).toEqual([]);
  });

  it('files taken out of public/ (a provider logo) go from the build after the same week (FD-NOAPI)', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'sq-public-'));
    const now = Date.UTC(2026, 9, 13, 12);
    const file = (rel: string, ageMs: number) => {
      mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      writeFileSync(path.join(dir, rel), 'x');
      const t = (now - ageMs) / 1000;
      utimesSync(path.join(dir, rel), t, t);
    };
    file('public/provider-logos/kucoin.svg', 0);
    file('public/.hidden/a.txt', 0);
    file('out/provider-logos/kucoin.svg', 30 * 86_400_000); // still in public: stays, however old
    file('out/provider-logos/xtb.png', KEEP_OLD_ASSETS_MS + 60_000); // taken out more than a week ago
    file('out/provider-logos/revolut.svg', 86_400_000); // taken out yesterday: an open tab may still show it
    file('out/.hidden/b.txt', 30 * 86_400_000); // dot folders are not ours
    file('out/index.html', 30 * 86_400_000); // outside public's folders
    const gone = pruneRemovedPublic(path.join(dir, 'out'), path.join(dir, 'public'), now);
    expect(gone).toEqual([path.join('provider-logos', 'xtb.png')]);
    expect(readdirSync(path.join(dir, 'out/provider-logos')).sort()).toEqual(['kucoin.svg', 'revolut.svg']);
    expect(readdirSync(path.join(dir, 'out/.hidden'))).toEqual(['b.txt']);
    expect(pruneRemovedPublic(path.join(dir, 'out'), path.join(dir, 'missing'), now)).toEqual([]);
  });
});
