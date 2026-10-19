import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, newSessionEpoch } from './api.ts';

afterEach(() => vi.unstubAllGlobals());

describe('api client and the change of user (FD-USERS §10)', () => {
  it("drops an answer to a request sent before a sign-in / sign-out, keeps the next user's", async () => {
    let release: (r: Response) => void = () => {};
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((r) => (release = r))));
    const late = api.put('/api/watchlist/order', { coins: ['ETH', 'BTC'] });
    newSessionEpoch();
    release(new Response(JSON.stringify([{ coin: 'ETH' }]), { status: 200 }));
    await expect(late).rejects.toMatchObject({ code: 'STALE' });
    await expect(late).rejects.toBeInstanceOf(ApiError);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[{"coin":"SOL"}]', { status: 200 })));
    await expect(api.get('/api/watchlist')).resolves.toEqual([{ coin: 'SOL' }]);
  });

  it('tells the app when the session ended (401 AUTH_REQUIRED), not for other errors', async () => {
    const events: string[] = [];
    vi.stubGlobal('window', { dispatchEvent: (e: Event) => events.push(e.type) });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":{"code":"AUTH_REQUIRED","message":"Intră în cont"}}', { status: 401 })));
    await expect(api.get('/api/watchlist')).rejects.toMatchObject({ status: 401, code: 'AUTH_REQUIRED' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":{"code":"LOGIN_EXPIRED","message":"5 minute"}}', { status: 401 })));
    await expect(api.post('/api/auth/login/2fa', { code: '1' })).rejects.toMatchObject({ code: 'LOGIN_EXPIRED' });
    expect(events).toEqual(['sentiq:signed-out']);
  });

  it('tells the app when the account still has to set up two-factor (403 TWO_FACTOR_REQUIRED, FD-2FA)', async () => {
    const events: string[] = [];
    vi.stubGlobal('window', { dispatchEvent: (e: Event) => events.push(e.type) });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":{"code":"TWO_FACTOR_REQUIRED","message":"Configurează mai întâi autentificarea în doi pași."}}', { status: 403 })));
    await expect(api.get('/api/watchlist')).rejects.toMatchObject({ status: 403, code: 'TWO_FACTOR_REQUIRED' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":{"code":"FORBIDDEN","message":"Doar adminul"}}', { status: 403 })));
    await expect(api.get('/api/health')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(events).toEqual(['sentiq:two-factor-required']);
  });
});
