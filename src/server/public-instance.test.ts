// FD-ONLINE §2: the public instance (Azure) writes its address in the database; the Mac reads it for the links it sends.
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';
import { SecretBox } from './secrets/crypto.ts';
import { parsePublicInstance, publishPublicInstance, SETTINGS_TTL_MS, SettingsService } from './settings.ts';
import { testDb } from './test/db.ts';

const BASE = 'https://sentiq.example';
const cfg = (env: Record<string, string>) => loadConfig({ SENTIQ_DATA_DIR: '/tmp/sentiq-public-instance', ...env } as NodeJS.ProcessEnv);
const row = async (db: Awaited<ReturnType<typeof testDb>>) => (await db.get<{ value: string }>("SELECT value FROM settings WHERE [key] = N'public_instance'"))?.value;

describe('the public instance (FD-ONLINE §2)', () => {
  it('reads only a public https origin; an older row with the connector flag reads the same (FD-MCPREMOVE)', () => {
    expect(parsePublicInstance(JSON.stringify({ url: 'https://Sentiq.Example/', at: 1 }))).toEqual({ url: BASE });
    expect(parsePublicInstance(JSON.stringify({ url: BASE, mcp: true, at: 1 }))).toEqual({ url: BASE });
    expect(parsePublicInstance(JSON.stringify({ url: 'http://sentiq.example' }))).toBeNull();
    expect(parsePublicInstance(JSON.stringify({ url: 'http://localhost:4317' }))).toBeNull();
    expect(parsePublicInstance(JSON.stringify({ url: 'https://sentiq.example/app' }))).toBeNull();
    expect(parsePublicInstance('not json')).toBeNull();
    expect(parsePublicInstance(undefined)).toBeNull();
  });

  it('is written by the instance with a public address, removed by an App Service one without it, left alone by the Mac', async () => {
    const db = await testDb();
    await publishPublicInstance(db, cfg({ SENTIQ_PUBLIC_URL: BASE }), 42);
    expect(JSON.parse((await row(db)) ?? '{}')).toEqual({ url: BASE, at: 42 });
    // The Mac: no public address, no proxy.
    await publishPublicInstance(db, cfg({}));
    expect(await row(db)).toBeDefined();
    // App Service without SENTIQ_PUBLIC_URL: nobody answers on the old address any more.
    await publishPublicInstance(db, { publicUrl: null, proxy: 'azure' });
    expect(await row(db)).toBeUndefined();
  });

  it('is read like the settings: kept 30 s, then read again', async () => {
    const db = await testDb();
    let t = 1_000_000;
    const settings = new SettingsService(db, new SecretBox(Buffer.alloc(32, 9)), () => t);
    expect(await settings.publicInstance()).toBeNull();
    await publishPublicInstance(db, cfg({ SENTIQ_PUBLIC_URL: BASE }));
    expect(await settings.publicInstance()).toBeNull();
    t += SETTINGS_TTL_MS;
    expect(await settings.publicInstance()).toEqual({ url: BASE });
  });
});
