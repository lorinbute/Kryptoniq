import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pruneOldAssets, pruneRemovedPublic } from './src/build/prune-assets.ts';

const root = fileURLToPath(new URL('./src/web', import.meta.url));
const outDir = fileURLToPath(new URL('./dist/web', import.meta.url));

/**
 * FD-STALE: the files of earlier builds stay a week (an open tab still finds the pages it loads on demand), then go.
 * The new build's own files are never touched; files taken out of `public/` go the same way (FD-NOAPI).
 */
function pruneAssets(): Plugin {
  return {
    name: 'sentiq-prune-assets',
    apply: 'build',
    writeBundle(options, bundle) {
      const out = options.dir ?? outDir;
      const current = new Set(Object.keys(bundle).map((f) => path.basename(f)));
      const gone = [...pruneOldAssets(path.join(out, 'assets'), current), ...pruneRemovedPublic(out, path.join(root, 'public'))];
      if (gone.length) this.info(`removed ${gone.length} files of builds older than a week`);
    },
  };
}

export default defineConfig({
  root,
  plugins: [react(), tailwindcss(), pruneAssets()],
  build: {
    outDir,
    // Kept (pruneAssets clears them after a week): deleting them broke the tabs opened before an update (FD-STALE).
    emptyOutDir: false,
    chunkSizeWarningLimit: 1500,
  },
  server: {
    // localhost, not 127.0.0.1: passkeys work only on a host name (FD-USERS §9).
    host: 'localhost',
    port: 5317,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:4317', changeOrigin: false },
    },
  },
});
