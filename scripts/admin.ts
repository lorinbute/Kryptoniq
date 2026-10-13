// The admin account from this Mac (FD-USERS §3), run through `scripts/sentiq.sh admin-email <address>` and
// `scripts/sentiq.sh admin-reset`:
//   email <address>  sets the admin's address before the first sign-in (the first-password page then shows it);
//   reset            clears the admin's password, two-factor, passkeys and sessions, so the first-password page shows
//                    again at http://localhost. Whoever can run this already holds the Mac and its data folder.
import { existsSync } from 'node:fs';
import { loadConfig } from '../src/server/config.ts';
import { Db } from '../src/server/db/database.ts';
import { SecretBox } from '../src/server/secrets/crypto.ts';
import { UserError, UserService } from '../src/server/auth/users.ts';

const [cmd, arg] = process.argv.slice(2);
const config = loadConfig();
if (!existsSync(config.dbPath)) {
  console.error(`Nu există o bază de date Sentiq în ${config.dataDir}. Pornește Sentiq o dată, apoi încearcă din nou.`);
  process.exit(1);
}
const db = new Db(config.dbPath);
// Neither command reads or writes a secret: the key box is never used here, so the real master key is not loaded.
const users = new UserService(db, new SecretBox(Buffer.alloc(32)));
try {
  const admin = users.admin();
  if (cmd === 'email') {
    if (admin.password_hash) {
      console.error('Contul de admin are deja parolă: adresa se schimbă după ce intri în cont (sau după admin-reset).');
      process.exit(1);
    }
    const u = users.setAdminEmail(arg);
    console.log(`Adresa adminului: ${u.email}. Deschide http://localhost:${config.port} pe acest Mac ca să-i setezi parola.`);
  } else if (cmd === 'reset') {
    db.tx(() => {
      db.run('UPDATE users SET password_hash = NULL, totp_secret = NULL, totp_confirmed_at = NULL, totp_last_step = 0, recovery_codes = NULL, disabled_at = NULL WHERE id = ?', [admin.id]);
      for (const table of ['passkeys', 'sessions', 'user_tokens']) db.run(`DELETE FROM ${table} WHERE user_id = ?`, [admin.id]);
    });
    console.log(`Parola, autentificarea în doi pași și passkey-urile adminului (${admin.email ?? 'fără adresă'}) au fost șterse.`);
    console.log(`Deschide http://localhost:${config.port} pe acest Mac și setează o parolă nouă.`);
  } else {
    console.error('Folosire: admin.ts email <adresa> | reset');
    process.exit(2);
  }
} catch (err) {
  console.error(err instanceof UserError ? err.message : (err as Error).stack);
  process.exit(1);
} finally {
  db.close();
}
