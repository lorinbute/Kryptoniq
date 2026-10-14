// Checks the Azure SQL connection of data/database.env (FD-AZURE §2, TD-AZURE §11) without changing anything and
// without ever showing the password: `scripts/sentiq.sh db-check`.
import { loadConfig } from '../src/server/config.ts';
import { describeDb } from '../src/server/db/config.ts';
import { Db } from '../src/server/db/database.ts';
import { MIGRATIONS, schemaVersion } from '../src/server/db/schema.ts';

const config = loadConfig();
if (!config.db) {
  console.error(config.dbError);
  process.exit(1);
}
let db: Db;
try {
  db = await Db.open(config.db, { migrate: false, poolMax: 1 });
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
try {
  const info = await db.info();
  const who = await db.get<{ user: string; schema: string; owner: number; compat: number; collation: string }>(
    `SELECT USER_NAME() AS [user], SCHEMA_NAME() AS [schema], IS_ROLEMEMBER('db_owner') AS owner,
            (SELECT compatibility_level FROM sys.databases WHERE name = DB_NAME()) AS compat,
            CAST(DATABASEPROPERTYEX(DB_NAME(), 'Collation') AS nvarchar(128)) AS collation`,
  );
  const version = await schemaVersion(db);
  const mb = (b: number | null) => (b === null ? '?' : `${(b / 1_048_576).toFixed(1)} MB`);
  console.log(`Conexiune: ${describeDb(config.db)}`);
  console.log(`Nivel: ${info.edition ?? '?'} ${info.objective ?? ''}; spațiu: ${mb(info.sizeBytes)} din ${mb(info.maxSizeBytes)}`);
  console.log(`Utilizator: ${who?.user} (schema ${who?.schema}), db_owner: ${who?.owner === 1 ? 'da' : 'nu'}`);
  console.log(`Nivel de compatibilitate: ${who?.compat} (Sentiq cere minimum 130); colația bazei: ${who?.collation}`);
  console.log(`Schema Sentiq: versiunea ${version} din ${MIGRATIONS.length}${version === 0 ? ' (tabelele se creează la prima pornire)' : ''}`);
  // The server's admin login is `dbo` in every database: it reaches the other databases of the server too.
  if (who?.user === 'dbo') console.log('ATENȚIE: contul e adminul serverului și ajunge și la celelalte baze de pe el; folosește un utilizator doar pentru baza Sentiq (ghidul, „Pornire”).');
  else console.log('Utilizatorul nu e adminul serverului.');
  if ((who?.compat ?? 0) < 130) console.log('ATENȚIE: nivelul de compatibilitate e sub 130; Sentiq folosește OPENJSON.');
  if (who?.owner !== 1) console.log('ATENȚIE: utilizatorul nu e db_owner pe această bază; Sentiq nu își poate crea tabelele.');
} finally {
  await db.close();
}
