// Keeps the files of earlier builds for a while (FD-STALE §2, TD-STALE §1): a tab opened before an update still finds
// the pages it loads on demand. Run after each build; only what the new build did not write and is old goes.
import { readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

/** How long a previous build's files stay. */
export const KEEP_OLD_ASSETS_MS = 7 * 86_400_000;

/**
 * Deletes from `dir` the files that are not in `current` (the new build's file names) and were last written more
 * than `keepMs` ago. Returns the names deleted. A missing folder is not an error.
 */
export function pruneOldAssets(dir: string, current: ReadonlySet<string>, now = Date.now(), keepMs = KEEP_OLD_ASSETS_MS): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const gone: string[] = [];
  for (const name of names) {
    if (current.has(name)) continue;
    const file = path.join(dir, name);
    try {
      const st = statSync(file);
      if (!st.isFile() || now - st.mtimeMs <= keepMs) continue;
      rmSync(file);
      gone.push(name);
    } catch {
      // gone meanwhile, or not ours to delete
    }
  }
  return gone;
}

/**
 * The same for what the build copies from `publicDir` (the provider logos, the brand images): a file taken out of
 * one of its folders goes from the same folder of `outDir` after the same week (FD-NOAPI). Only the folders that
 * `publicDir` has are looked at, one level deep; dot folders are left alone. Returns the paths deleted.
 */
export function pruneRemovedPublic(outDir: string, publicDir: string, now = Date.now(), keepMs = KEEP_OLD_ASSETS_MS): string[] {
  let folders: string[];
  try {
    folders = readdirSync(publicDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name);
  } catch {
    return [];
  }
  return folders.flatMap((sub) =>
    pruneOldAssets(path.join(outDir, sub), new Set(readdirSync(path.join(publicDir, sub))), now, keepMs).map((name) => path.join(sub, name)),
  );
}
