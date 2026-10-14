// Azure SQL Database access (FD-AZURE, TD-AZURE §2): a connection pool, `?` or `@name` parameters, every write
// serialized through one application lock (as SQLite serialized its writers), transactions that follow the async code
// that runs in them, and retries for Azure's transient errors.
import { AsyncLocalStorage } from 'node:async_hooks';
import sql from 'mssql';
import { describeDb, type DbConfig } from './config.ts';
import { migrate } from './schema.ts';

export type SqlValue = string | number | bigint | boolean | null | undefined | Uint8Array;
export type Params = readonly SqlValue[] | Readonly<Record<string, SqlValue>>;

export interface RunResult {
  /** Rows touched by the last statement. */
  changes: number;
  /** Identity of the last INSERT (0 when there was none). */
  lastInsertRowid: number;
}

export interface DbInfo {
  server: string;
  database: string;
  edition: string | null;
  objective: string | null;
  /** Null when the user may not read the database's usage (VIEW DATABASE STATE). */
  sizeBytes: number | null;
  maxSizeBytes: number | null;
}

/** The database cannot be reached right now (after retries): the API answers 503. */
export class DbUnavailableError extends Error {
  readonly code = 'DB_UNAVAILABLE';
  constructor(message = 'Baza de date nu răspunde acum. Reîncearcă în câteva secunde.', options?: { cause?: unknown }) {
    super(message, options);
  }
}

/** A write waited too long for the write lock. */
export class DbBusyError extends DbUnavailableError {}

/** The connection was refused at start-up: the message says what to fix (FD-AZURE §2). */
export class DbConnectError extends Error {}

const LOCK_TIMEOUT_MS = 30_000;
const LOCK_ERROR = 51000;
const LEFTOVER_TX_ERROR = 51001;

// A write lock per schema (TD-AZURE §2): the app (dbo) and every test schema have their own.
const LOCK_SQL = `DECLARE @__lock int, @__res nvarchar(255) = N'sentiq:write:' + SCHEMA_NAME();
EXEC @__lock = sp_getapplock @Resource = @__res, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = ${LOCK_TIMEOUT_MS};
IF @__lock < 0 THROW ${LOCK_ERROR}, N'SENTIQ_WRITE_LOCK', 1;`;

// A batch that timed out on the client keeps its transaction open on the pooled connection (XACT_ABORT does not act on
// an attention): every batch first rolls back whatever such a leftover is.
const CLEAN_SQL = 'IF @@TRANCOUNT > 0 ROLLBACK;';

/** A Sentiq transaction holding the write lock this long is stuck: Sentiq's last seconds (FD-DBHEAL §2). */
export const STUCK_TX_MS = 5 * 60_000;
/** At most one look at the lock's holder per instance and minute. */
const HEAL_EVERY_MS = 60_000;

/** The session holding the write lock, as the server's views show it. */
export interface LockHolder {
  spid: number;
  login: Date;
  prog: string | null;
  host: string | null;
  /** Age of its open transaction, in seconds (null without one). */
  txAgeS: number | null;
  lastSql: string | null;
}

/** Whether the holder is one of Sentiq's own sessions, stuck in a transaction (FD-DBHEAL §2). */
export function isStuckHolder(h: LockHolder | undefined, stuckMs = STUCK_TX_MS): h is LockHolder {
  return Boolean(h && h.prog === 'Sentiq' && h.txAgeS !== null && h.txAgeS * 1000 >= stuckMs);
}

const HOLDER_SQL = `${CLEAN_SQL}
SELECT TOP (1) l.request_session_id AS spid, s.login_time AS login, s.program_name AS prog, s.host_name AS host,
       DATEDIFF(second, t.transaction_begin_time, SYSDATETIME()) AS txAgeS,
       LEFT(REPLACE(REPLACE(txt.text, CHAR(10), ' '), CHAR(13), ' '), 200) AS lastSql
FROM sys.dm_tran_locks l
JOIN sys.dm_exec_sessions s ON s.session_id = l.request_session_id
LEFT JOIN sys.dm_tran_session_transactions st ON st.session_id = s.session_id
LEFT JOIN sys.dm_tran_active_transactions t ON t.transaction_id = st.transaction_id
LEFT JOIN sys.dm_exec_connections c ON c.session_id = s.session_id
OUTER APPLY sys.dm_exec_sql_text(c.most_recent_sql_handle) txt
WHERE l.resource_type = N'APPLICATION' AND l.request_status = N'GRANT' AND l.resource_description LIKE N'%[[]sentiq:write:' + SCHEMA_NAME() + N']%'
ORDER BY txAgeS DESC`;
const RESULT_SQL = 'SELECT @@ROWCOUNT AS __changes, CAST(SCOPE_IDENTITY() AS BIGINT) AS __id;';

/** Errors after which the request certainly did not run (or ran and was rolled back): safe to send again. */
const NOT_RUN = new Set([40501, 49918, 49919, 49920, 10928, 10929, 1205, 40613]);
/** Transient errors of Azure SQL (connection dropped, failover, throttling): retried for reads. */
const TRANSIENT = new Set([...NOT_RUN, 40197, 4221, 233, 64, 10053, 10054, 10060]);
const CONN_CODES = new Set(['ESOCKET', 'ETIMEOUT', 'ECONNCLOSED', 'ECONNRESET', 'ENOTOPEN', 'EINSTLOOKUP', 'ENOCONN']);
const RETRY_DELAYS_MS = [250, 1000, 3000];

interface TxState {
  db: Db;
  tx: sql.Transaction;
  queue: Promise<unknown>;
  done: boolean;
}

const txStore = new AsyncLocalStorage<TxState>();

/** Error numbers of an mssql error and the ones before it in the same batch. */
function errorNumbers(err: unknown): number[] {
  const e = err as { number?: number; precedingErrors?: { number?: number }[]; originalError?: { number?: number } };
  return [e?.number, e?.originalError?.number, ...(e?.precedingErrors ?? []).map((p) => p.number)].filter((n): n is number => typeof n === 'number');
}

function errorCode(err: unknown): string | undefined {
  return (err as { code?: string })?.code;
}

/** A failure to get a connection: nothing was sent. */
function isConnectFailure(err: unknown): boolean {
  return err instanceof sql.ConnectionError || (CONN_CODES.has(errorCode(err) ?? '') && !(err instanceof sql.RequestError));
}

function isTransient(err: unknown): boolean {
  return isConnectFailure(err) || CONN_CODES.has(errorCode(err) ?? '') || errorNumbers(err).some((n) => TRANSIENT.has(n));
}

/**
 * Worth another connection attempt at start-up. A refused login (firewall, user or password, database) is refused
 * again: tedious keeps no error number on it (code ELOGIN) and marks only the passing ones (a database being moved)
 * as transient.
 */
export function connectRetryable(err: unknown): boolean {
  if (errorCode(err) === 'ELOGIN') return (err as { originalError?: { isTransient?: boolean } })?.originalError?.isTransient === true;
  return isTransient(err) && !errorNumbers(err).some((n) => n === 18456 || n === 40615 || n === 4060);
}

function notRun(err: unknown): boolean {
  return isConnectFailure(err) || errorNumbers(err).some((n) => NOT_RUN.has(n));
}

function isLockTimeout(err: unknown): boolean {
  return errorNumbers(err).includes(LOCK_ERROR);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function retrying<T>(work: () => Promise<T>, retryable: (err: unknown) => boolean): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await work();
    } catch (err) {
      if (isLockTimeout(err)) throw new DbBusyError(undefined, { cause: err });
      if (!retryable(err)) throw err;
      if (attempt >= RETRY_DELAYS_MS.length) throw new DbUnavailableError(undefined, { cause: err });
      await sleep(RETRY_DELAYS_MS[attempt]!);
    }
  }
}

/** `?` placeholders → `@p0…`, skipping string literals, quoted identifiers and comments. */
export function positional(text: string): { text: string; count: number } {
  let out = '';
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    let end = -1;
    if (c === "'") {
      end = i + 1;
      while (end < text.length && !(text[end] === "'" && text[end + 1] !== "'")) end += text[end] === "'" ? 2 : 1;
    } else if (c === '[') end = text.indexOf(']', i + 1);
    else if (c === '"') end = text.indexOf('"', i + 1);
    else if (c === '-' && text[i + 1] === '-') end = (text.indexOf('\n', i) + 1 || text.length + 1) - 1;
    else if (c === '/' && text[i + 1] === '*') end = text.indexOf('*/', i + 2) + 1;
    if (end > i) {
      out += text.slice(i, end + 1);
      i = end;
    } else if (c === '?') out += `@p${n++}`;
    else out += c;
  }
  return { text: out, count: n };
}

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function bindValue(req: sql.Request, name: string, value: SqlValue): void {
  if (value instanceof Uint8Array) {
    req.input(name, sql.VarBinary(sql.MAX), Buffer.isBuffer(value) ? value : Buffer.from(value.buffer, value.byteOffset, value.byteLength));
  } else if (typeof value === 'boolean') req.input(name, sql.Int, value ? 1 : 0);
  else if (value === undefined || value === null) req.input(name, sql.NVarChar, null);
  else if (typeof value === 'number' && !Number.isFinite(value)) req.input(name, sql.Float, null);
  else req.input(name, value);
}

/** BIGINT columns come back as text: to numbers (epoch milliseconds fit exactly in 2^53). */
function convertRows<T>(rs: sql.IRecordSet<Record<string, unknown>> | undefined): T[] {
  if (!rs) return [];
  const big = Object.values(rs.columns ?? {})
    .filter((c) => c.type === sql.BigInt)
    .map((c) => c.name);
  if (big.length > 0) {
    for (const row of rs) for (const k of big) if (typeof row[k] === 'string') row[k] = Number(row[k]);
  }
  return [...rs] as T[];
}

export class Db {
  private readonly pool: sql.ConnectionPool;
  private readonly ownsPool: boolean;
  private readonly cache = new Map<string, { text: string; count: number }>();
  /** `server/database (user)`, for the log and the health page. */
  readonly label: string;
  private readonly cfg: DbConfig;

  private constructor(pool: sql.ConnectionPool, cfg: DbConfig, ownsPool: boolean) {
    this.pool = pool;
    this.cfg = cfg;
    this.ownsPool = ownsPool;
    this.label = describeDb(cfg);
  }

  static poolFor(cfg: DbConfig, max = 10): sql.ConnectionPool {
    const pool = new sql.ConnectionPool({
      server: cfg.server,
      port: cfg.port,
      database: cfg.database,
      user: cfg.user,
      password: cfg.password,
      connectionTimeout: 30_000,
      requestTimeout: 60_000,
      pool: { max, min: 0, idleTimeoutMillis: 30_000 },
      options: { encrypt: true, trustServerCertificate: false, appName: 'Sentiq' },
    });
    // An idle connection the server dropped: the pool replaces it; never an unhandled 'error'.
    pool.on('error', () => undefined);
    return pool;
  }

  /** Connects (with the errors of FD-AZURE §2) and brings the schema up to date. */
  static async open(cfg: DbConfig, opts: { poolMax?: number; migrate?: boolean } = {}): Promise<Db> {
    const pool = Db.poolFor(cfg, opts.poolMax);
    try {
      await retrying(() => pool.connect(), connectRetryable);
    } catch (err) {
      await pool.close().catch(() => undefined);
      throw explainConnectError(err, cfg);
    }
    const db = new Db(pool, cfg, true);
    if (opts.migrate !== false) await migrate(db);
    return db;
  }

  /** A Db over a pool someone else owns (tests share one pool per worker): close() leaves it open. */
  static shared(pool: sql.ConnectionPool, cfg: DbConfig): Db {
    return new Db(pool, cfg, false);
  }

  private bind(req: sql.Request, text: string, params: Params | undefined): string {
    if (params === undefined || Array.isArray(params)) {
      let t = this.cache.get(text);
      if (!t) {
        t = positional(text);
        this.cache.set(text, t);
      }
      const list = (params ?? []) as readonly SqlValue[];
      if (list.length !== t.count) throw new Error(`SQL expects ${t.count} parameters, got ${list.length}: ${text.slice(0, 120)}`);
      if (list.length > 2000) throw new Error(`Too many SQL parameters (${list.length}); split the list`);
      list.forEach((v, i) => bindValue(req, `p${i}`, v));
      return t.text;
    }
    const named = params as Readonly<Record<string, SqlValue>>;
    for (const [k, v] of Object.entries(named)) {
      if (!NAME_RE.test(k)) throw new Error(`Bad SQL parameter name: ${k}`);
      bindValue(req, k, v);
    }
    return text;
  }

  /** Told when a stuck session was ended (FD-DBHEAL): the context sends it to the log. */
  onWarn: ((message: string) => void) | null = null;
  private lastHeal = 0;

  /** Runs `fn` outside any transaction of this process (FD-DBHEAL §2): lease renewals and jobs never join one. */
  detached<T>(fn: () => T): T {
    return txStore.exit(fn);
  }

  /** Who holds this schema's write lock (no lock taken; the views need VIEW DATABASE STATE). */
  private async lockHolder(): Promise<LockHolder | undefined> {
    const r = await this.pool.request().query(HOLDER_SQL);
    const row = r.recordset[0] as LockHolder | undefined;
    return row ? { ...row, login: new Date(row.login), txAgeS: row.txAgeS === null ? null : Number(row.txAgeS) } : undefined;
  }

  /**
   * A write that waited for the lock in vain: if Sentiq's own session holds it in a transaction open for minutes, that
   * session is ended (its transaction rolls back) and the caller tries once more (FD-DBHEAL). Checked again right before
   * the KILL (the same session, the same login). Without the right to see or end sessions: nothing, quietly.
   */
  async healStuckLock(now: number = Date.now()): Promise<boolean> {
    if (now - this.lastHeal < HEAL_EVERY_MS) return false;
    this.lastHeal = now;
    try {
      const holder = await this.lockHolder();
      if (!isStuckHolder(holder)) return false;
      const again = await this.lockHolder();
      if (!isStuckHolder(again) || again.spid !== holder.spid || again.login.getTime() !== holder.login.getTime()) return false;
      await this.pool.request().query(`KILL ${Math.trunc(again.spid)}`);
      this.onWarn?.(`database: ended a stuck session ${again.spid} (${again.host ?? '?'}, transaction open ${again.txAgeS} s; last: ${again.lastSql ?? '?'})`);
      return true;
    } catch {
      return false;
    }
  }

  /** A write that did not get the lock: one more try after a stuck session was ended. */
  private async healing<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (err) {
      if (!(err instanceof DbBusyError) || !(await this.healStuckLock())) throw err;
      return work();
    }
  }

  /** The transaction this call runs in, if it was started on this Db and is still open. */
  private current(): TxState | null {
    const s = txStore.getStore();
    return s && s.db === this && !s.done ? s : null;
  }

  /** Requests on one transaction go one after the other (a connection runs one at a time). */
  private enqueue<R>(state: TxState, work: () => Promise<R>): Promise<R> {
    const p = state.queue.then(work, work);
    state.queue = p.catch(() => undefined);
    return p;
  }

  private async query(text: string, params: Params | undefined, write: boolean): Promise<sql.IResult<Record<string, unknown>>> {
    const body = text.trim().replace(/;+\s*$/, '');
    const state = this.current();
    if (state) {
      return this.enqueue(state, async () => {
        const req = new sql.Request(state.tx);
        const t = this.bind(req, body, params);
        try {
          return await req.query(write ? `${t};\n${RESULT_SQL}` : t);
        } catch (err) {
          throw isTransient(err) ? new DbUnavailableError(undefined, { cause: err }) : err;
        }
      });
    }
    if (!write) {
      return retrying(async () => {
        const req = this.pool.request();
        const t = this.bind(req, body, params);
        return req.query(`${CLEAN_SQL}\n${t}`);
      }, isTransient);
    }
    return this.healing(() =>
      retrying(async () => {
        const req = this.pool.request();
        const t = this.bind(req, body, params);
        return req.query(`${CLEAN_SQL}\nSET XACT_ABORT ON;\nBEGIN TRANSACTION;\n${LOCK_SQL}\n${t};\n${RESULT_SQL}\nCOMMIT TRANSACTION;`);
      }, notRun),
    );
  }

  async all<T = Record<string, unknown>>(text: string, params?: Params): Promise<T[]> {
    const r = await this.query(text, params, false);
    return convertRows<T>(r.recordsets.length ? (r.recordsets[r.recordsets.length - 1] as sql.IRecordSet<Record<string, unknown>>) : r.recordset);
  }

  async get<T = Record<string, unknown>>(text: string, params?: Params): Promise<T | undefined> {
    return (await this.all<T>(text, params))[0];
  }

  /** A statement that changes something (or a batch of them), under the write lock. */
  async run(text: string, params?: Params): Promise<RunResult> {
    const r = await this.query(text, params, true);
    const last = r.recordsets[r.recordsets.length - 1] as sql.IRecordSet<{ __changes: number; __id: string | number | null }> | undefined;
    const row = last?.[0];
    return { changes: Number(row?.__changes ?? 0), lastInsertRowid: Number(row?.__id ?? 0) };
  }

  /**
   * Runs `fn` in one transaction holding the write lock: every query of `fn` (and of what it calls) uses it. Nested
   * calls join the outer transaction. `fn` must only use the database (no network): the lock blocks every writer.
   */
  async tx<T>(fn: () => Promise<T>): Promise<T> {
    if (this.current()) return fn();
    const tx = await this.healing(() => this.beginLocked());
    const state: TxState = { db: this, tx, queue: Promise.resolve(), done: false };
    try {
      const out = await txStore.run(state, fn);
      await state.queue;
      state.done = true;
      await tx.commit();
      return out;
    } catch (err) {
      await state.queue;
      state.done = true;
      await tx.rollback().catch(() => undefined);
      throw isTransient(err) && !(err instanceof DbUnavailableError) ? new DbUnavailableError(undefined, { cause: err }) : err;
    }
  }

  /** A transaction of its own holding the write lock (a leftover one on the connection is rolled back first). */
  private beginLocked(): Promise<sql.Transaction> {
    return retrying(async () => {
      const t = new sql.Transaction(this.pool);
      await t.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
      try {
        await new sql.Request(t).query(`IF @@TRANCOUNT > 1 THROW ${LEFTOVER_TX_ERROR}, N'SENTIQ_LEFTOVER_TX', 1;\nSET XACT_ABORT ON;\n${LOCK_SQL}`);
      } catch (err) {
        await t.rollback().catch(() => undefined);
        // A leftover transaction on that connection was just rolled back with ours: start again.
        if (errorNumbers(err).includes(LEFTOVER_TX_ERROR)) throw Object.assign(new Error('leftover transaction'), { number: 40501 });
        throw err;
      }
      return t;
    }, notRun);
  }

  async info(): Promise<DbInfo> {
    const base = await this.get<{ db: string; edition: string | null; objective: string | null; max_size: number | null }>(
      `SELECT DB_NAME() AS db, CAST(DATABASEPROPERTYEX(DB_NAME(), 'Edition') AS nvarchar(128)) AS edition,
              CAST(DATABASEPROPERTYEX(DB_NAME(), 'ServiceObjective') AS nvarchar(128)) AS objective,
              CAST(DATABASEPROPERTYEX(DB_NAME(), 'MaxSizeInBytes') AS bigint) AS max_size`,
    );
    let sizeBytes: number | null = null;
    try {
      sizeBytes = (await this.get<{ n: number }>('SELECT CAST(SUM(reserved_page_count) AS bigint) * 8192 AS n FROM sys.dm_db_partition_stats'))?.n ?? null;
    } catch {
      sizeBytes = null;
    }
    return { server: this.cfg.server, database: base?.db ?? this.cfg.database, edition: base?.edition ?? null, objective: base?.objective ?? null, sizeBytes, maxSizeBytes: base?.max_size ?? null };
  }

  async close(): Promise<void> {
    this.cache.clear();
    if (this.ownsPool) await this.pool.close().catch(() => undefined);
  }
}

/** Start-up failures in words the user can act on (FD-AZURE §2); never the password. */
export function explainConnectError(err: unknown, cfg: DbConfig): DbConnectError {
  // After the retries, the last failure is the cause.
  const e = err instanceof DbUnavailableError && err.cause !== undefined ? err.cause : err;
  const nums = errorNumbers(e);
  const msg = String((e as Error)?.message ?? e);
  const code = errorCode(e);
  if (nums.includes(40615) || /not allowed to access the server/i.test(msg)) {
    const ip = /IP address '([^']+)'/i.exec(msg)?.[1];
    return new DbConnectError(`Serverul Azure SQL nu acceptă conexiuni de la IP-ul ${ip ?? 'acestui calculator'}: adaugă-l în Networking → Firewall rules.`);
  }
  if (nums.includes(4060) || /Cannot open database/i.test(msg)) return new DbConnectError(`Baza ${cfg.database} nu există pe server sau utilizatorul ${cfg.user} nu are acces la ea.`);
  if (nums.includes(18456) || code === 'ELOGIN') return new DbConnectError(`Baza de date a refuzat utilizatorul ${cfg.user}: verifică utilizatorul și parola din data/database.env (pe Azure, setările SENTIQ_DB_* ale aplicației).`);
  if (code === 'ESOCKET' || code === 'ETIMEOUT' || code === 'EINSTLOOKUP' || e instanceof DbUnavailableError) {
    // The driver's words too (address, port, timeout): on App Service the log is all there is.
    const detail = e instanceof DbUnavailableError ? '' : ` Detaliu: ${msg.replaceAll(cfg.password, '***')}`;
    return new DbConnectError(`Serverul de baze de date nu răspunde (${cfg.server}): verifică adresa și conexiunea la internet.${detail}`);
  }
  return new DbConnectError(`Nu mă pot conecta la baza de date ${describeDb(cfg)}: ${msg.replaceAll(cfg.password, '***')}`);
}
