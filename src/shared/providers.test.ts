import { describe, expect, it } from 'vitest';
import { accountSchemaFor, providerById, PROVIDERS } from './providers.ts';

describe('providers (FD-SENTIQ §2)', () => {
  it('every provider can connect: fields, steps, a key page and a logo (FD-NOAPI: none without an API)', () => {
    for (const p of PROVIDERS) {
      expect(p.fields.length, p.id).toBeGreaterThan(0);
      expect(p.steps.length, p.id).toBeGreaterThan(0);
      expect(p.keysUrl, p.id).toMatch(/^https:\/\//);
      expect(p.logo, p.id).toBeTruthy();
    }
    expect(new Set(PROVIDERS.map((p) => p.id)).size).toBe(PROVIDERS.length);
  });

  it('turns the "\\n" of a key copied from Coinbase\'s JSON file into line breaks', () => {
    const coinbase = providerById('coinbase')!;
    const r = accountSchemaFor(coinbase).parse({
      exchange: 'coinbase',
      label: 'CB',
      credentials: { apiKey: 'organizations/abc/apiKeys/def', secret: '-----BEGIN EC PRIVATE KEY-----\\nMHcCAQ\\n-----END EC PRIVATE KEY-----\\n' },
    });
    expect(r.credentials.secret).toBe('-----BEGIN EC PRIVATE KEY-----\nMHcCAQ\n-----END EC PRIVATE KEY-----');
    expect(r.env).toBe('live');
  });

  it('explains a missing or malformed field in Romanian', () => {
    const ibkr = accountSchemaFor(providerById('ibkr')!).safeParse({ exchange: 'ibkr', label: 'IB', credentials: { token: '12ab34', queryId: undefined } });
    expect(ibkr.success).toBe(false);
    expect(ibkr.error?.issues.map((i) => i.message).sort()).toEqual(['Flex Query ID: lipsește', 'Token Flex Web Service: doar cifre']);
  });
});
