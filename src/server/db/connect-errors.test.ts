// Start-up connection failures as the driver really reports them (FD-AZURE §2): a refused login comes as an mssql
// ConnectionError over a tedious one with code ELOGIN and no error number.
import sql from 'mssql';
import { ConnectionError as TediousConnectionError } from 'tedious';
import { describe, expect, it } from 'vitest';
import type { DbConfig } from './config.ts';
import { connectRetryable, DbUnavailableError, explainConnectError } from './database.ts';

const cfg: DbConfig = { server: 'srv.database.windows.net', port: 1433, database: 'sentiq', user: 'sentiq_app', password: 'S3cret!pw' };

function loginError(message: string, transient = false): sql.ConnectionError {
  const inner = new TediousConnectionError(message, 'ELOGIN') as TediousConnectionError & { isTransient?: boolean };
  if (transient) inner.isTransient = true;
  return new sql.ConnectionError(inner);
}

const FIREWALL =
  "Cannot open server 'srv' requested by the login. Client with IP address '68.210.131.80' is not allowed to access the server.  To enable access, use the Azure Management Portal or run sp_set_firewall_rule on the master database to create a firewall rule for this IP address or address range.  It may take up to five minutes for this change to take effect.";

describe('connectRetryable', () => {
  it('does not retry a refused login', () => {
    expect(connectRetryable(loginError(FIREWALL))).toBe(false);
    expect(connectRetryable(loginError("Login failed for user 'sentiq_app'."))).toBe(false);
    expect(connectRetryable(loginError('Cannot open database "sentiq" requested by the login. The login failed.'))).toBe(false);
  });

  it('retries the logins tedious marks as passing, and socket failures', () => {
    expect(connectRetryable(loginError('Database is not currently available.', true))).toBe(true);
    expect(connectRetryable(new sql.ConnectionError(new TediousConnectionError('Failed to connect to srv:1433 in 30000ms', 'ETIMEOUT')))).toBe(true);
    expect(connectRetryable(new sql.ConnectionError(new TediousConnectionError('Connection lost - read ECONNRESET', 'ESOCKET')))).toBe(true);
  });
});

describe('explainConnectError', () => {
  it('names the IP the firewall refused, also when it comes as the cause of the retries', () => {
    const want = 'Serverul Azure SQL nu acceptă conexiuni de la IP-ul 68.210.131.80: adaugă-l în Networking → Firewall rules.';
    expect(explainConnectError(loginError(FIREWALL), cfg).message).toBe(want);
    expect(explainConnectError(new DbUnavailableError(undefined, { cause: loginError(FIREWALL) }), cfg).message).toBe(want);
  });

  it('tells a wrong user or password from a missing database', () => {
    expect(explainConnectError(loginError("Login failed for user 'sentiq_app'."), cfg).message).toMatch(/a refuzat utilizatorul sentiq_app/);
    expect(explainConnectError(loginError('Cannot open database "sentiq" requested by the login. The login failed.'), cfg).message).toMatch(/Baza sentiq nu există/);
  });

  it('keeps the driver words of a network failure, never the password', () => {
    const err = new sql.ConnectionError(new TediousConnectionError(`Failed to connect to srv:1433 - getaddrinfo ENOTFOUND (${cfg.password})`, 'ESOCKET'));
    const msg = explainConnectError(new DbUnavailableError(undefined, { cause: err }), cfg).message;
    expect(msg).toMatch(/nu răspunde \(srv\.database\.windows\.net\).*Detaliu: Failed to connect to srv:1433 - getaddrinfo ENOTFOUND/);
    expect(msg).not.toContain(cfg.password);
  });
});
