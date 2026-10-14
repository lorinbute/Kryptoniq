// Where the database is (TD-AZURE §1) and how Sentiq runs behind Azure App Service (TD-AZURE §7).
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { loadConfig } from '../config.ts';
import { bareIp, HostAllowlist, registerSecurity } from '../http/security.ts';
import { setCookie } from '../http/cookies.ts';
import { DbConfigError, describeDb, loadDbConfig, parseDbEnv } from './config.ts';

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});
const dataDir = (text?: string) => {
  const d = mkdtempSync(path.join(tmpdir(), 'sq-dbcfg-'));
  dirs.push(d);
  if (text !== undefined) writeFileSync(path.join(d, 'database.env'), text);
  return d;
};

describe('data/database.env', () => {
  it('takes the value verbatim after the first =: #, quotes, $ and spaces stay in a password', () => {
    expect(parseDbEnv("# comment\nSENTIQ_DB_PASSWORD=p#ss'w\"o$rd x=y \r\n  SENTIQ_DB_USER = sentiq_app\nOTHER=1\nnoequals\n")).toEqual({
      SENTIQ_DB_PASSWORD: "p#ss'w\"o$rd x=y ",
      SENTIQ_DB_USER: ' sentiq_app',
    });
  });

  it('reads the four fields or the connection string; the environment wins key by key', () => {
    const d = dataDir('SENTIQ_DB_SERVER=tcp:x.database.windows.net,1433\nSENTIQ_DB_NAME=sentiq\nSENTIQ_DB_USER=app\nSENTIQ_DB_PASSWORD=pw#1\n');
    expect(loadDbConfig({}, d)).toEqual({ server: 'x.database.windows.net', port: 1433, database: 'sentiq', user: 'app', password: 'pw#1' });
    expect(loadDbConfig({ SENTIQ_DB_PASSWORD: 'from-env' }, d).password).toBe('from-env');
    const c = dataDir('SENTIQ_DB_CONNECTION=Server=tcp:y.database.windows.net,1433;Initial Catalog=db2;User ID=u2;Password=Abc#1=;Encrypt=True;\n');
    expect(loadDbConfig({}, c)).toEqual({ server: 'y.database.windows.net', port: 1433, database: 'db2', user: 'u2', password: 'Abc#1=' });
    expect(describeDb(loadDbConfig({}, c))).toBe('y.database.windows.net/db2 (u2)');
  });

  it('says what is missing, and catches the placeholder of the portal', () => {
    expect(() => loadDbConfig({}, dataDir())).toThrow(DbConfigError);
    expect(() => loadDbConfig({}, dataDir('SENTIQ_DB_SERVER=x\nSENTIQ_DB_NAME=n\nSENTIQ_DB_USER=u\n'))).toThrow(/completează data\/database\.env/);
    expect(() => loadDbConfig({}, dataDir('SENTIQ_DB_CONNECTION=Server=tcp:y,1433;Initial Catalog=d;User ID=u;Password={your_password};\n'))).toThrow(/your_password/);
    // Without a database Sentiq does not start; the error is kept for the log.
    const cfg = loadConfig({ SENTIQ_DATA_DIR: dataDir() } as NodeJS.ProcessEnv);
    expect(cfg.db).toBeNull();
    expect(cfg.dbError).toMatch(/nu e configurată/);
  });
});

describe('Azure App Service (TD-AZURE §1, §7)', () => {
  it('is recognised by WEBSITE_SITE_NAME: its port, /home/data and its own host name', () => {
    const cfg = loadConfig({ WEBSITE_SITE_NAME: 'sentiq', WEBSITE_HOSTNAME: 'Sentiq.AzureWebsites.net', PORT: '8080' } as NodeJS.ProcessEnv);
    expect(cfg.proxy).toBe('azure');
    expect(cfg.port).toBe(8080);
    expect(cfg.dataDir).toBe('/home/data');
    expect(cfg.allowedHosts).toContain('sentiq.azurewebsites.net');
    const mac = loadConfig({} as NodeJS.ProcessEnv);
    expect(mac.proxy).toBeNull();
    expect(mac.port).toBe(4317);
    expect(loadConfig({ SENTIQ_PROXY: 'azure' } as NodeJS.ProcessEnv).proxy).toBe('azure');
  });

  it('takes the visitor from X-Client-IP, HTTPS from X-Forwarded-Proto, answers the start-up probe, and only there', async () => {
    const make = async (proxy: 'azure' | null) => {
      const app = Fastify();
      registerSecurity(app, new HostAllowlist(['sentiq.example']), { proxy });
      app.get('/who', async (req, reply) => {
        setCookie(req, reply, 'c', 'v');
        return { ip: req.clientIp, https: req.viaHttps, proxy: req.behindProxy };
      });
      await app.ready();
      return app;
    };
    const azure = await make('azure');
    const r = await azure.inject({ url: '/who', headers: { host: 'sentiq.example', 'x-client-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.1:5555, 203.0.113.7:61234', 'x-forwarded-proto': 'https' } });
    expect(r.json()).toEqual({ ip: '203.0.113.7', https: true, proxy: true });
    expect(String(r.headers['set-cookie'])).toContain('Secure');
    expect(r.headers['strict-transport-security']).toBe('max-age=31536000');
    // Without X-Client-IP: the hop the front end added (the last), without its port.
    const x = await azure.inject({ url: '/who', headers: { host: 'sentiq.example', 'x-forwarded-for': '1.1.1.1, 203.0.113.9:443' } });
    expect(x.json()).toMatchObject({ ip: '203.0.113.9', https: false });
    expect(x.headers['strict-transport-security']).toBeUndefined();
    expect((await azure.inject({ url: '/robots933456.txt', headers: { host: '10.0.0.5:8080' } })).statusCode).toBe(404);
    expect((await azure.inject({ url: '/who', headers: { host: 'evil.example' } })).statusCode).toBe(403);
    // On the Mac the headers mean nothing: anybody could send them.
    const mac = await make(null);
    const m = await mac.inject({ url: '/who', headers: { host: 'sentiq.example', 'x-client-ip': '203.0.113.7', 'x-forwarded-proto': 'https' }, remoteAddress: '192.168.1.5' });
    expect(m.json()).toEqual({ ip: '192.168.1.5', https: false, proxy: false });
    expect(String(m.headers['set-cookie'])).not.toContain('Secure');
    expect((await mac.inject({ url: '/robots933456.txt', headers: { host: 'evil.example' } })).statusCode).toBe(403);
    await azure.close();
    await mac.close();
  });

  it('reads an address with or without its port', () => {
    expect(bareIp('203.0.113.7:61234')).toBe('203.0.113.7');
    expect(bareIp('[2001:db8::1]:443')).toBe('2001:db8::1');
    expect(bareIp('2001:DB8::1')).toBe('2001:db8::1');
    expect(bareIp('not an ip')).toBeNull();
    expect(bareIp(undefined)).toBeNull();
  });
});
