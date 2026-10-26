// FD-WATCHLISTS §3: what the "Date financiare" popup shows: TradingView's quarters, CoinGecko's description, the cache,
// and the description translated once with the user's AI.
import { afterEach, describe, expect, it } from 'vitest';
import { testDb } from '../test/db.ts';
import { silentLogger } from '../log.ts';
import { setFetchImpl } from '../net/http.ts';
import type { AiService } from '../ai/service.ts';
import type { AiClient } from '../ai/types.ts';
import { MIGRATIONS } from '../db/schema.ts';
import { DESCRIPTION_MAX, parseTvFundamentals, pickCoinId, plainDescription, SymbolProfiles } from './profile.ts';

const sec = (day: string) => Date.parse(`${day}T00:00:00Z`) / 1000;
const tvBody = (...rows: unknown[][]) => JSON.stringify({ totalCount: rows.length, data: rows.map((d) => ({ s: `NASDAQ:${String(d[0])}`, d })) });
/** A TradingView row in the order of TV_PROFILE_COLUMNS. */
const row = (name: string, o: { primary?: boolean; type?: string; rev?: number[] | null; eps?: number[] | null; end?: string | null; next?: string; pub?: number; time?: number } = {}) => [
  name,
  o.primary ?? true,
  o.type ?? 'stock',
  o.rev === undefined ? [100, 90, 80, 70, 50, 45] : o.rev,
  [40, 36, 30, 28],
  [30, 25, 20, 18],
  [10, -5, 8, 7],
  o.eps === undefined ? [1, -0.5, 0.8, 0.7, 0.5, 0.25] : o.eps,
  [5, 4, 3, 2],
  o.end === null ? null : sec(o.end ?? '2026-06-30'),
  o.next ? sec(o.next) : null,
  o.pub ?? null,
  o.time ?? 0,
  0.45,
  'Communications',
  'Specialty Telecommunications',
];

describe("TradingView's quarters (FD-WATCHLISTS §3)", () => {
  it('the last four, newest first, with the months they ended in and the change against a year before', () => {
    const t = parseTvFundamentals(tvBody(row('SPCX', { next: '2026-10-20', pub: 12, time: 1 })), 'SPCX');
    expect(t?.quarters.map((q) => q.end)).toEqual(['2026-06-30', '2026-03-31', '2025-12-31', '2025-09-30']);
    expect(t?.quarters[0]).toEqual({ end: '2026-06-30', revenue: 100, grossProfit: 40, ebitda: 30, netIncome: 10, eps: 1, freeCashFlow: 5, revenueYoY: 1, epsYoY: 1 });
    // The year before: −0.5 against 0.25 is −300%; without the quarter of a year before, none.
    expect(t?.quarters[1]).toMatchObject({ revenueYoY: 1, epsYoY: -3 });
    expect(t?.quarters[2]).toMatchObject({ revenueYoY: null, epsYoY: null });
    expect(t?.next).toEqual({ day: '2026-10-20', time: 'after', confirmed: true, eps: 0.45 });
    expect(t).toMatchObject({ type: 'stock', sector: 'Communications', industry: 'Specialty Telecommunications' });
  });

  it('fewer quarters for a new listing; none without a period; a fund; the row with results, then the primary', () => {
    expect(parseTvFundamentals(tvBody(row('NEW', { rev: [7, 4], eps: [0.1, 0.2] })), 'NEW')?.quarters).toHaveLength(2);
    expect(parseTvFundamentals(tvBody(row('X', { end: null })), 'X')?.quarters).toEqual([]);
    expect(parseTvFundamentals(tvBody(row('QQQ', { type: 'fund', rev: null, eps: null })), 'QQQ')).toMatchObject({ type: 'fund', quarters: [] });
    expect(parseTvFundamentals(tvBody(row('ABC', { primary: true, rev: null }), row('ABC', { primary: false })), 'ABC')?.quarters).toHaveLength(4);
    expect(parseTvFundamentals(tvBody(row('OTHER')), 'ABC')).toBeNull();
    // Revenue a year before at 0 or less: no change shown (no division by it).
    expect(parseTvFundamentals(tvBody(row('Z', { rev: [5, 5, 5, 5, 0], eps: [1, 1, 1, 1, 0] })), 'Z')?.quarters[0]).toMatchObject({ revenueYoY: null, epsYoY: null });
    expect(() => parseTvFundamentals('<html>', 'X')).toThrow('TradingView: răspunsul nu e JSON');
  });
});

describe("CoinGecko's description (FD-WATCHLISTS §3)", () => {
  it('plain text: paragraphs kept, links and tags out, entities read', () => {
    // A line break inside a paragraph folds into a space; paragraphs stay apart.
    expect(plainDescription('<p>Solana is <a href="https://x">fast</a> &amp; cheap.</p><p>It&#39;s a  L1.<br>Really.</p>')).toBe("Solana is fast & cheap.\n\nIt's a L1. Really.");
    expect(plainDescription('A&nbsp;B &#x41; &bogus;')).toBe('A B A &bogus;');
  });

  it('a long one cut at a sentence end in its second half, otherwise at a word', () => {
    const long = `${'Word '.repeat(150)}End of one. ${'More text here. '.repeat(200)}`;
    const cut = plainDescription(long);
    expect(cut.length).toBeLessThanOrEqual(DESCRIPTION_MAX + 1);
    expect(cut.endsWith('.…')).toBe(true);
    const words = plainDescription('word '.repeat(600));
    expect(words.endsWith('word…')).toBe(true);
  });

  it('the coin with this exact symbol and the best rank; none ranked last; none at all', () => {
    const body = {
      coins: [
        { id: 'solv', symbol: 'SOLV', market_cap_rank: 700 },
        { id: 'sol-wormhole', symbol: 'SOL', market_cap_rank: null },
        { id: 'solana', symbol: 'SOL', market_cap_rank: 7 },
      ],
    };
    expect(pickCoinId(body, 'sol')).toBe('solana');
    expect(pickCoinId({ coins: [{ id: 'only', symbol: 'ABC', market_cap_rank: null }] }, 'ABC')).toBe('only');
    expect(pickCoinId({ coins: [] }, 'ABC')).toBeNull();
    expect(pickCoinId({ nope: 1 }, 'ABC')).toBeNull();
  });
});

describe('the profiles, on the test schema', () => {
  afterEach(() => setFetchImpl(null));
  const noAi = {} as AiService;

  it("a coin's profile from CoinGecko, kept a week; one with a part that failed is not kept", async () => {
    const db = await testDb();
    let calls = 0;
    let fail = true;
    setFetchImpl((async (input: string | URL | Request) => {
      calls++;
      const url = String(input);
      if (fail) return new Response('busy', { status: 429 });
      if (url.includes('/search')) return new Response(JSON.stringify({ coins: [{ id: 'solana', symbol: 'SOL', market_cap_rank: 7 }] }), { status: 200 });
      return new Response(
        JSON.stringify({ name: 'Solana', description: { en: '<p>Solana is a chain.</p>' }, categories: ['Layer 1 (L1)', null, 'Smart Contract Platform'], genesis_date: '2020-03-16', links: { homepage: ['https://solana.com/', ''] } }),
        { status: 200 },
      );
    }) as typeof fetch);
    const p = new SymbolProfiles(db, noAi, silentLogger, { companyProfile: async () => null });
    const failed = await p.profile('crypto', 'SOL');
    expect(failed.problems).toEqual([{ part: 'description', message: 'CoinGecko: prea multe cereri acum' }]);
    fail = false;
    const ok = await p.profile('crypto', 'SOL');
    expect(ok).toMatchObject({
      kind: 'crypto',
      name: 'Solana',
      description: { text: 'Solana is a chain.', source: 'CoinGecko', lang: 'en' },
      facts: [
        { label: 'Categorii', value: 'Layer 1 (L1), Smart Contract Platform' },
        { label: 'Lansare', value: '16 mar. 2020' },
        { label: 'Site', value: 'solana.com', href: 'https://solana.com/' },
      ],
      quarters: [],
      problems: [],
    });
    const n = calls;
    await p.profile('crypto', 'SOL');
    expect(calls).toBe(n);
  });

  it('a stock Nasdaq has no description of (a fund, by TradingView): no results, no description', async () => {
    const db = await testDb();
    setFetchImpl((async () => new Response(tvBody(row('QQQ', { type: 'fund', rev: null, eps: null })), { status: 200 })) as typeof fetch);
    const p = new SymbolProfiles(db, noAi, silentLogger, { companyProfile: async () => null });
    expect(await p.profile('stock', 'QQQ', 'Invesco QQQ Trust')).toMatchObject({ kind: 'fund', name: 'Invesco QQQ Trust', description: null, quarters: [], next: null, problems: [] });
    // Nasdaq down: said in its place, the results still there.
    setFetchImpl((async () => new Response(tvBody(row('TSLA')), { status: 200 })) as typeof fetch);
    const down = new SymbolProfiles(db, noAi, silentLogger, { companyProfile: async () => Promise.reject(new Error('Nasdaq: HTTP 503')) });
    const t = await down.profile('stock', 'TSLA');
    expect(t.problems).toEqual([{ part: 'description', message: 'Nasdaq: HTTP 503' }]);
    expect(t.quarters).toHaveLength(4);
  });

  it('the translation: once per text, with the user’s AI, counted; then for everyone without asking again', async () => {
    const db = await testDb();
    const asked: string[] = [];
    const used: unknown[] = [];
    const client: AiClient = {
      provider: 'gemini',
      model: 'gemini-3.8-flash',
      generate: async (req) => {
        asked.push(req.prompt);
        return { parsed: { text: ' Tesla face mașini electrice. ' } as never, stop: 'done', usage: { input: 30, output: 12 } };
      },
    };
    const ai = {
      config: async (userId: number) => ({ provider: 'gemini', model: 'gemini-3.8-flash', key: userId === 1 ? 'AIza-k' : null, scoring: false }),
      client: () => client,
      usage: { record: async (...a: unknown[]) => void used.push(a) },
    } as unknown as AiService;
    const p = new SymbolProfiles(db, ai, silentLogger, { companyProfile: async () => null });
    expect(await p.translate(1, 'Tesla makes electric cars.')).toBe('Tesla face mașini electrice.');
    expect(used).toEqual([[1, 'translate', { items: 1, input: 30, output: 12, model: 'gemini-3.8-flash' }]]);
    // Another user, even one without a key: the one made already.
    expect(await p.translate(2, 'Tesla makes electric cars.')).toBe('Tesla face mașini electrice.');
    expect(asked).toHaveLength(1);
    await expect(p.translate(2, 'Another text.')).rejects.toThrow('Fără o cheie AI, descrierea rămâne în engleză');
    expect(await p.translation('Tesla makes electric cars.')).toBe('Tesla face mașini electrice.');
  });
});

describe('the lists made from the favourites (migration 9)', () => {
  it('each user with favourites gets "Favorite", in their order; a user without any gets nothing yet', async () => {
    const db = await testDb();
    await db.run("INSERT INTO users(email, name, role, created_at) VALUES (N'a@example.com', N'A', N'user', 1), (N'b@example.com', N'B', N'user', 1)");
    await db.run(
      "INSERT INTO watchlist(user_id, coin, quote, position, aliases, added_at, kind) VALUES (1, N'ETH', N'USDT', 1, N'[]', 5, N'crypto'), (1, N'BTC', N'USDT', 0, N'[]', 6, N'crypto'), (2, N'AAPL', N'USD', 0, N'[]', 7, N'stock')",
    );
    await db.run('DELETE FROM watch_lists');
    for (const batch of MIGRATIONS[8]?.slice(1) ?? []) await db.run(batch);
    const lists = await db.all<{ user_id: number; name: string; id: number }>('SELECT user_id, name, id FROM watch_lists ORDER BY user_id');
    expect(lists.map((l) => [l.user_id, l.name])).toEqual([
      [1, 'Favorite'],
      [2, 'Favorite'],
    ]);
    const items = await db.all<{ list_id: number; coin: string; added_at: number }>('SELECT list_id, coin, added_at FROM watch_list_items ORDER BY list_id, position');
    expect(items.map((i) => [lists.find((l) => l.id === i.list_id)?.user_id, i.coin, i.added_at])).toEqual([
      [1, 'BTC', 6],
      [1, 'ETH', 5],
      [2, 'AAPL', 7],
    ]);
  });
});
