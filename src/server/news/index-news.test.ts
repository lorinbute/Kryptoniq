// FD-INDEXNEWS: the companies of the filter indices (lists, names, tags) and the stock news and score limited to them.
import { describe, expect, it } from 'vitest';
import type { Db } from '../db/database.ts';
import { testDb } from '../test/db.ts';
import { SecretBox } from '../secrets/crypto.ts';
import { SettingsService } from '../settings.ts';
import { readJobData } from '../jobs/scheduler.ts';
import { settingsSchema } from '../../shared/settings.ts';
import { stockNewsSchema } from '../../shared/stock-indices.ts';
import { DailySentimentService } from '../sentiment/daily.ts';
import { CoinDetector, detectCoins } from './coins.ts';
import { memberIndex } from './coin-registry.ts';
import { IndexMembersService, MEMBERS_JOB, memberAliases, membersSignature, normalizeSymbol, parseNasdaq100, parseScreener, parseWikiConstituents, plausible, snapshotMembers, type IndexMembers, type MemberSources } from './index-members.ts';
import { newsQuerySchema, queryNews } from './query.ts';
import { stockScopeFor, usersWithStockScope } from './stock-scope.ts';

const SP_WIKI = `intro
{| class="wikitable sortable" id="constituents"
|-
![[Ticker symbol|Symbol]]
! Security !! GICS Sector
|-
|| {{NyseSymbol|MMM}}
|| [[3M]]
|| Industrials
|-
|| {{NasdaqSymbol|AMD}}
|| [[AMD|Advanced Micro Devices]]
|| Information Technology
|-
|| {{NyseSymbol|BRK.B}} <!-- DO NOT CHANGE -->
|| [[Berkshire Hathaway]]
|| Financials
|-
|| {{NasdaqSymbol|PODD}}
|| Insulet Corporation
|| [[Acton, Massachusetts]]
|}
after`;

const DOW_WIKI = `{| class="wikitable" id="constituents"
|-
!scope="col"| Company
!scope="col"| Exchange
!scope="col"| Symbol
|-
!scope="row"| [[Alphabet Inc.|Alphabet]]<br/>(Class A)
| [[NASDAQ]]
| {{NASDAQ link|GOOGL}}
|-
!scope="row"| [[Apple Inc.|Apple]]
| [[NASDAQ]]
| {{NASDAQ link|AAPL}}
|}`;

describe('the lists, from their sources', () => {
  it('Wikipedia tables: ticker first (S&P 500) or company first (Dow); unlinked names; no headquarters as a name', () => {
    expect(parseWikiConstituents(SP_WIKI)).toEqual([
      { symbol: 'MMM', name: '3M' },
      { symbol: 'AMD', name: 'Advanced Micro Devices' },
      { symbol: 'BRK.B', name: 'Berkshire Hathaway' },
      { symbol: 'PODD', name: 'Insulet Corporation' },
    ]);
    expect(parseWikiConstituents(DOW_WIKI)).toEqual([
      { symbol: 'GOOGL', name: 'Alphabet' },
      { symbol: 'AAPL', name: 'Apple' },
    ]);
    expect(parseWikiConstituents('no table here')).toEqual([]);
  });

  it("Nasdaq's Nasdaq-100 and screener answers", () => {
    expect(parseNasdaq100({ data: { data: { rows: [{ symbol: 'AAPL', companyName: 'Apple Inc. Common Stock' }, { symbol: '', companyName: 'x' }] } } })).toEqual([{ symbol: 'AAPL', name: 'Apple Inc. Common Stock' }]);
    expect(parseScreener({ data: { rows: [{ symbol: 'BRK/B' }, { symbol: 'AAPL' }, { symbol: 'ABC^W' }, { symbol: 'AAPL' }, { symbol: 'TOOLONGSYMB' }] } })).toEqual(['AAPL', 'BRK.B']);
    expect(parseNasdaq100('nonsense')).toEqual([]);
    expect(normalizeSymbol('brk-b')).toBe('BRK.B');
    expect(normalizeSymbol('A B')).toBeNull();
  });

  it('a list is believed only with about the right number of companies, each once', () => {
    const list = (n: number) => Array.from({ length: n }, (_, i) => ({ symbol: `S${i}` }));
    expect(plausible('DJI', list(30))).toBe(true);
    expect(plausible('DJI', list(29))).toBe(false);
    expect(plausible('NDX', list(101))).toBe(true);
    expect(plausible('SPX', list(120))).toBe(false);
    expect(plausible('DJI', [...list(29), { symbol: 'S0' }])).toBe(false);
  });
});

describe('the names a company is found by', () => {
  const dict = new Set(['target', 'visa', 'carrier', 'southern', 'pool', 'apple']);
  const isWord = (w: string) => dict.has(w);

  it('curated for the large ones; a single ordinary word is not a name, the full legal one is', () => {
    expect(memberAliases('GOOGL', 'Alphabet Inc.', isWord)).toEqual(['Alphabet', 'Google']);
    expect(memberAliases('USB', 'U.S. Bancorp', isWord)).toEqual(['U.S. Bancorp', 'US Bancorp']);
    expect(memberAliases('CARR', 'Carrier Global', isWord)).toEqual(['Carrier Global']);
    expect(memberAliases('SO', 'Southern Company', isWord)).toEqual(['Southern Company']);
    expect(memberAliases('POOL', 'Pool Corporation', isWord)).toEqual(['Pool Corporation']);
    expect(memberAliases('PLTR', 'Palantir Technologies', isWord)).toEqual(['Palantir']);
    expect(memberAliases('ZZZ', 'Zeta Widgets Holdings', isWord)).toEqual(['Zeta Widgets']);
    // "& Co." does not leave a hanging "&".
    expect(memberAliases('XX', 'Smith & Co.', isWord)).toEqual(['Smith']);
  });

  it('a member new since the snapshot (no dictionary on the server): names of two words or more only', () => {
    // A single word could be an ordinary one: its full legal name instead.
    expect(memberAliases('NEWC', 'Frobnicator Inc.')).toEqual(['Frobnicator Inc']);
    expect(memberAliases('NEWE', 'Frobnicator')).toEqual([]);
    expect(memberAliases('NEWD', 'Frobnicator Systems Inc.')).toEqual(['Frobnicator Systems']);
  });

  it('the snapshot shipped: believable lists, no name that is a country, the market or an ordinary word', () => {
    const s = snapshotMembers();
    expect(plausible('SPX', s.members.SPX)).toBe(true);
    expect(plausible('NDX', s.members.NDX)).toBe(true);
    expect(plausible('DJI', s.members.DJI)).toBe(true);
    expect(s.listed.length).toBeGreaterThan(5000);
    const all = Object.values(s.members).flat();
    const names = new Set(all.flatMap((m) => m.aliases));
    for (const bad of ['U.S.', 'Nasdaq', 'Target', 'Visa', 'Edison', 'Regions', 'Waters', 'Southern', 'Carrier', 'Dow', 'Pool']) expect(names.has(bad), bad).toBe(false);
    expect(all.find((m) => m.symbol === 'AAPL')?.aliases).toContain('Apple');
  });
});

describe('the news tags of the companies', () => {
  const members: IndexMembers = {
    asOf: 1,
    members: {
      SPX: [
        { symbol: 'AAPL', name: 'Apple', aliases: ['Apple'] },
        { symbol: 'JPM', name: 'JPMorgan Chase', aliases: ['JPMorgan'] },
        { symbol: 'TGT', name: 'Target Corporation', aliases: ['Target Corporation'] },
        { symbol: 'USB', name: 'U.S. Bancorp', aliases: ['U.S. Bancorp'] },
        { symbol: 'DOW', name: 'Dow Inc.', aliases: ['Dow Inc.'] },
        { symbol: 'MMM', name: '3M', aliases: ['3M'] },
      ],
      NDX: [{ symbol: 'AAPL', name: 'Apple', aliases: ['Apple'] }],
      DJI: [{ symbol: 'AAPL', name: 'Apple', aliases: ['Apple'] }],
    },
    listed: ['AAPL', 'JPM', 'TGT', 'USB', 'DOW', 'MMM', 'ACAD', 'XYZW'],
  };
  const det = new CoinDetector([], {}, {}, { '^DJI': ['Dow Jones'] }, memberIndex(members));
  const tags = (t: string) => detectCoins(det, t, '');

  it('names, $tickers, "(NYSE: X)" and bare tickers of 3+ letters; each member with its indices and "#CO"', () => {
    expect(tags('Apple shares jump after record iPhone sales')).toEqual(['#CO', '#DJI', '#NDX', '#SPX', 'AAPL']);
    expect(tags('JPMorgan beats estimates (NYSE: JPM)')).toEqual(['#CO', '#SPX', 'JPM']);
    expect(tags('Why JPM stock is rising')).toEqual(['#CO', '#SPX', 'JPM']);
    expect(tags('apple pie season')).toEqual([]);
    // A name of two characters with a digit.
    expect(tags('3M settles water lawsuits')).toEqual(['#CO', '#SPX', 'MMM']);
  });

  it('ordinary words, common acronyms and short tickers alone are not companies', () => {
    expect(tags('Target cuts forecast as shoppers pull back')).toEqual([]);
    expect(tags('New USB standard ships next year')).toEqual([]);
    expect(tags('$TGT slides after earnings')).toEqual(['#CO', '#SPX', 'TGT']);
    expect(tags('U.S. Bancorp raises dividend')).toEqual(['#CO', '#SPX', 'USB']);
  });

  it('a listed share outside the indices only when named explicitly; "Dow" is the index, "Dow Inc." the company', () => {
    expect(tags('Small biotech soars after FDA nod (NASDAQ: ACAD)')).toEqual(['#CO', 'ACAD']);
    expect(tags('ACAD soars after FDA nod')).toEqual([]);
    expect(tags('Dow Jones rises 300 points; Dow Inc. shares slip')).toEqual(['#CO', '#SPX', 'DOW', '^DJI']);
  });

  it('a detector without the lists (the classifier of the common score) adds no tags of its own', () => {
    expect(detectCoins(new CoinDetector([]), 'Apple (NASDAQ: AAPL) jumps', '')).toEqual([]);
  });
});

describe('the setting', () => {
  it('all stock news by default; indices need one at least, each once', () => {
    expect(settingsSchema.parse({}).stockNews).toEqual({ mode: 'all', indices: [] });
    expect(stockNewsSchema.parse({ mode: 'indices', indices: ['NDX', 'SPX'] })).toEqual({ mode: 'indices', indices: ['NDX', 'SPX'] });
    for (const bad of [{ mode: 'indices', indices: [] }, { mode: 'indices', indices: ['NDX', 'NDX'] }, { mode: 'indices', indices: ['RUT'] }, { mode: 'some' }]) expect(stockNewsSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
});

/** Sources that answer as given; a function that throws stands for a source that failed. */
function sources(over: Partial<{ ndx: number; spx: number; dji: number; listed: number; fail: string[] }> = {}): MemberSources {
  const rows = (n: number, p: string) => Array.from({ length: n }, (_, i) => ({ symbol: `${p}${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`, companyName: `${p} Company ${i} Inc.` }));
  const wiki = (n: number, p: string) => `{| id="constituents"\n${rows(n, p)
    .map((r) => `|-\n|| {{NyseSymbol|${r.symbol}}}\n|| [[${r.companyName}]]`)
    .join('\n')}\n|}`;
  const fail = (k: string) => {
    if (over.fail?.includes(k)) throw new Error(`${k} down`);
  };
  return {
    nasdaq100: async () => (fail('ndx'), { data: { data: { rows: rows(over.ndx ?? 101, 'N') } } }),
    screener: async () => (fail('listed'), { data: { rows: Array.from({ length: over.listed ?? 6000 }, (_, i) => ({ symbol: `L${i.toString(36).toUpperCase()}` })) } }),
    wikitext: async (page: string) => (page.includes('S&P') ? (fail('spx'), wiki(over.spx ?? 503, 'S')) : (fail('dji'), wiki(over.dji ?? 30, 'D'))),
  };
}

describe('keeping the lists up to date', () => {
  it('reads every source once a week; a source that fails or looks wrong keeps its previous list', async () => {
    const db = await testDb();
    const svc = new IndexMembersService(db, sources());
    const snap = await svc.get();
    expect(snap).toBe(snapshotMembers());
    // Fresher than a week: nothing read.
    expect(await svc.refresh(snap.asOf + 86_400_000)).toBe(false);
    const t = snap.asOf + 8 * 86_400_000;
    expect(await svc.refresh(t)).toBe(true);
    const read = await svc.get();
    expect(read.members.NDX).toHaveLength(101);
    expect(read.members.SPX[0]).toMatchObject({ symbol: 'SAA', name: 'S Company 0 Inc.' });
    expect((await readJobData<IndexMembers | null>(db, MEMBERS_JOB, null))?.asOf).toBe(t);
    // A week later: the Dow page lost rows and the screener is down; those keep what they had.
    const svc2 = new IndexMembersService(db, sources({ dji: 12, fail: ['listed'] }));
    expect(await svc2.refresh(t + 8 * 86_400_000)).toBe(false);
    expect((await svc2.get()).members.DJI).toEqual(read.members.DJI);
    expect(svc2.lastErrors.join('; ')).toMatch(/DJI: 12 companii.*acțiuni listate: listed down/);
    // Every source down: the date stays, so the next run tries again.
    const svc3 = new IndexMembersService(db, sources({ fail: ['ndx', 'spx', 'dji', 'listed'] }));
    expect(await svc3.refresh(t + 30 * 86_400_000)).toBe(false);
    expect((await svc3.get()).asOf).toBe(t + 8 * 86_400_000);
    expect(membersSignature(await svc3.get())).toBe(membersSignature(await svc2.get()));
  });
});

const DAY = 86_400_000;

async function newsSetup() {
  const db = await testDb();
  const settings = new SettingsService(db, new SecretBox(Buffer.alloc(32, 4)));
  await settings.updateFor(1, true, { timezone: 'UTC' });
  await db.run("INSERT INTO sources(id, name, url, category, builtin) VALUES ('st', 'Stocks', 'https://st.example/rss', 'stocks', 0), ('cr', 'Crypto', 'https://cr.example/rss', 'crypto', 0)");
  return { db, settings };
}

/** A scored news with its tags. */
async function addNews(db: Db, id: string, category: 'stocks' | 'crypto', at: number, sentiment: number, tags: string[]) {
  await db.run(
    `INSERT INTO news(id, source_id, title, published_at, fetched_at, category, relevance, impact, cluster_id, sentiment, sentiment_label, sentiment_engine)
     VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?, 'x', 'local')`,
    [id, category === 'stocks' ? 'st' : 'cr', `Story ${id}`, at, at, category, id, sentiment],
  );
  for (const t of tags) await db.run('INSERT INTO news_coins(news_id, coin) VALUES (?, ?)', [id, t]);
}

describe('the stock news and score limited to indices', () => {
  it('keeps general stock news, members of the picked indices, the index named and favourite stocks; other categories stay', async () => {
    const { db, settings } = await newsSetup();
    const now = Date.now();
    await addNews(db, 'general', 'stocks', now - 60_000, 0.5, []);
    await addNews(db, 'apple', 'stocks', now - 70_000, 0.5, ['#CO', '#NDX', '#SPX', 'AAPL']);
    await addNews(db, 'jpm', 'stocks', now - 80_000, -0.9, ['#CO', '#SPX', 'JPM']);
    await addNews(db, 'acad', 'stocks', now - 90_000, -0.9, ['#CO', 'ACAD']);
    await addNews(db, 'ndx', 'stocks', now - 100_000, 0.5, ['^NDX']);
    await addNews(db, 'fav', 'stocks', now - 110_000, 0.5, ['#CO', 'SMCO']);
    await addNews(db, 'btc', 'crypto', now - 120_000, -0.9, ['#CO', 'BTC']);
    await db.run("INSERT INTO watchlist(user_id, coin, position, kind, aliases, added_at) VALUES (1, 'SMCO', 0, 'stock', '[]', ?)", [now]);
    const list = async () => {
      const page = await queryNews(db, newsQuerySchema.parse({ range: '24h' }), 'UTC', 1, now, false, await stockScopeFor(db, settings, 1));
      return { ids: page.items.map((i) => i.id).sort(), scope: page.stockScope, coins: page.items.find((i) => i.id === 'apple')?.coins };
    };
    // All stock news by default; the index tags never show.
    expect(await list()).toEqual({ ids: ['acad', 'apple', 'btc', 'fav', 'general', 'jpm', 'ndx'], scope: null, coins: ['AAPL'] });
    expect(await usersWithStockScope(db)).toEqual([]);
    await settings.updateFor(1, true, { stockNews: { mode: 'indices', indices: ['NDX'] } });
    expect(await list()).toEqual({ ids: ['apple', 'btc', 'fav', 'general', 'ndx'], scope: { indices: ['NDX'] }, coins: ['AAPL'] });
    await settings.updateFor(1, true, { stockNews: { mode: 'indices', indices: ['NDX', 'SPX'] } });
    expect((await list()).ids).toEqual(['apple', 'btc', 'fav', 'general', 'jpm', 'ndx']);
    expect(await usersWithStockScope(db)).toEqual([1]);
  });

  it("the user's own score: only the stock news kept count; a change of filter computes their days again", async () => {
    const { db, settings } = await newsSetup();
    const daily = new DailySentimentService(db, settings, null, (u) => stockScopeFor(db, settings, u));
    const now = Date.now();
    await addNews(db, 'apple', 'stocks', now - 60_000, 0.8, ['#CO', '#NDX', 'AAPL']);
    await addNews(db, 'jpm', 'stocks', now - 70_000, -0.8, ['#CO', '#SPX', 'JPM']);
    expect(await daily.scopeFor(1)).toBeNull();
    const common = await daily.today('UTC', now, null);
    await settings.updateFor(1, true, { stockNews: { mode: 'indices', indices: ['NDX'] } });
    expect(await daily.scopeFor(1)).toBe(1);
    const mine = await daily.today('UTC', now, 1);
    expect(mine.breakdown.stocks.count).toBe(1);
    expect(common.breakdown.stocks.count).toBe(2);
    expect(mine.index).toBeGreaterThan(common.index);
    // An elapsed day, then the filter changed: its stored day goes, `refresh` computes it again.
    await addNews(db, 'old-jpm', 'stocks', now - 2 * DAY, -0.8, ['#CO', '#SPX', 'JPM']);
    await addNews(db, 'old-apple', 'stocks', now - 2 * DAY - 60_000, 0.8, ['#CO', '#NDX', 'AAPL']);
    await daily.refresh(now);
    const day2 = async () => db.get<{ n: number }>("SELECT count(*) AS n FROM ai_daily_sentiment WHERE user_id = 1 AND day < CONVERT(char(10), GETUTCDATE(), 23)");
    expect((await day2())?.n).toBeGreaterThan(0);
    await settings.updateFor(1, true, { stockNews: { mode: 'indices', indices: ['SPX'] } });
    await daily.resetUser(1);
    expect((await day2())?.n).toBe(0);
    await daily.refresh(now);
    expect((await day2())?.n).toBeGreaterThan(0);
  });
});
