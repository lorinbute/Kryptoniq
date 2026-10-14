// Moves data/kryptoniq.db into the Azure SQL database of data/database.env, once (FD-AZURE §3, TD-AZURE §9):
//   scripts/sentiq.sh import-sqlite [--replace] [--force] [file]
// --replace: the Azure database already has data and is to be replaced by the file's.
// --force:   import although something answers on Sentiq's port (whatever it saves after the copy is lost).
import { rmSync } from 'node:fs';
import { loadConfig } from '../src/server/config.ts';
import { describeDb } from '../src/server/db/config.ts';
import { Db } from '../src/server/db/database.ts';
import { ImportError, importSqlite, snapshot } from '../src/server/db/import-sqlite.ts';
import { SecretBox } from '../src/server/secrets/crypto.ts';

const args = process.argv.slice(2);
const replace = args.includes('--replace');
const force = args.includes('--force');
const file = args.find((a) => !a.startsWith('--'));
const config = loadConfig();
if (!config.db) {
  console.error(config.dbError);
  process.exit(1);
}
const source = file ?? config.legacyDbPath;

// The old Sentiq must be stopped: what it saves after the copy would be lost.
if (!force) {
  const running = await fetch(`http://127.0.0.1:${config.port}/api/ping`, { signal: AbortSignal.timeout(2000) })
    .then(() => true)
    .catch(() => false);
  if (running) {
    console.error('Oprește întâi Sentiq (scripts/sentiq.sh stop): ce se salvează după copie s-ar pierde.');
    process.exit(1);
  }
}

let snap: ReturnType<typeof snapshot> | null = null;
let db: Db | null = null;
try {
  snap = snapshot(source);
  console.log(`Fișierul: ${source} (versiunea ${snap.fromVersion})`);
  db = await Db.open(config.db);
  console.log(`Baza: ${describeDb(config.db)}`);
  const t0 = Date.now();
  const r = await importSqlite(db, snap.copy, { replace, fromVersion: snap.fromVersion });
  console.log(`Copiat în ${((Date.now() - t0) / 1000).toFixed(1)} s:`);
  for (const [t, n] of Object.entries(r.copied)) if (n) console.log(`  ${t}: ${n}`);
  // The keys saved with this Mac's master key must open with the one Sentiq will use.
  const sample =
    (await db.get<{ v: string }>('SELECT TOP (1) credentials AS v FROM exchange_accounts WHERE credentials IS NOT NULL')) ??
    (await db.get<{ v: string }>("SELECT TOP (1) value AS v FROM settings WHERE [key] IN (N'claude_key', N'resend_key', N'twelvedata_key')"));
  if (sample && !SecretBox.available(config.dataDir)) {
    // Never made here: a new key would not open them anyway.
    console.warn(`ATENȚIE: nu găsesc cheia master (${config.dataDir}/master.key sau SENTIQ_MASTER_KEY): pune-o pe cea cu care au fost salvate cheile, altfel Sentiq nu pornește.`);
  } else if (sample) {
    try {
      SecretBox.load(config.dataDir).decrypt(sample.v);
      console.log('Cheia master deschide cheile salvate.');
    } catch {
      console.warn('ATENȚIE: cheia master nu deschide cheile salvate: folosește același data/master.key cu care au fost salvate.');
    }
  }
  console.log('Gata. Pornește Sentiq: scripts/sentiq.sh start');
} catch (err) {
  console.error(err instanceof ImportError ? err.message : `Importul nu s-a făcut (nimic nu s-a schimbat): ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await db?.close();
  if (snap) rmSync(snap.dir, { recursive: true, force: true });
}
