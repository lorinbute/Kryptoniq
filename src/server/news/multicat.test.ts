// FD-MULTICAT: a news source of several categories ("General": all four): each item gets the category it is about.
import { describe, expect, it } from 'vitest';
import { testDb } from '../test/db.ts';
import { CoinDetector } from './coins.ts';
import { categorize, encodeCategories, normalizeCategories, sourceCategories, subjectOf } from './categorize.ts';
import { ingestItems, reclassifySource, retagRecent, upgradeClassification } from './ingest.ts';
import type { ParsedItem } from './parser.ts';
import type { SourceCategory } from './sources.ts';

const ALL: SourceCategory[] = ['crypto', 'stocks', 'macro', 'geopolitics'];
// Bitcoin and Ether as coins, Apple as a stock of the favourites (as the app's detector knows them).
const det = new CoinDetector([{ symbol: 'BTC', names: ['Bitcoin'] }, { symbol: 'ETH', names: ['Ethereum', 'Ether'] }], {}, { AAPL: ['Apple'] });
const cat = (title: string, allowed: SourceCategory[] = ALL, summary = '') => {
  const coins = [...new Set([...det.detect(title), ...det.detect(summary)])];
  return categorize(title, summary, coins, allowed, (s) => det.isCrypto(s));
};

describe('the categories of a source', () => {
  it('are kept unique, in a fixed order; one is a plain source', () => {
    expect(normalizeCategories(['macro', 'crypto', 'macro', 'nope'])).toEqual(['crypto', 'macro']);
    expect(encodeCategories(['geopolitics', 'crypto'])).toEqual({ category: 'crypto', categories: 'crypto,geopolitics' });
    expect(encodeCategories(['stocks'])).toEqual({ category: 'stocks', categories: null });
    expect(encodeCategories(ALL)).toEqual({ category: 'crypto', categories: 'crypto,stocks,macro,geopolitics' });
    expect(() => encodeCategories([])).toThrow();
    expect(sourceCategories({ category: 'macro', categories: null })).toEqual(['macro']);
    expect(sourceCategories({ category: 'crypto', categories: 'crypto,macro' })).toEqual(['crypto', 'macro']);
    expect(sourceCategories({ category: 'macro' })).toEqual(['macro']);
  });
});

describe('the category of an item of a general source', () => {
  it('is what the item is about', () => {
    expect(cat('Bitcoin ETF inflows hit a record as institutions return')).toEqual({ category: 'crypto', matched: true });
    expect(cat('Apple earnings beat estimates; shares jump after hours')).toEqual({ category: 'stocks', matched: true });
    expect(cat('Fed holds interest rates steady as inflation cools')).toEqual({ category: 'macro', matched: true });
    expect(cat('Iran launches missiles at tankers as sanctions bite')).toEqual({ category: 'geopolitics', matched: true });
  });

  it('a coin named outweighs a word of another subject; ties go crypto, stocks, macro, geopolitics', () => {
    expect(cat('Bitcoin falls after the Fed decision').category).toBe('crypto');
    // "tariffs" is macro and geopolitics alike: macro first.
    expect(cat('New tariffs announced on steel imports').category).toBe('macro');
  });

  it('only among the source\'s categories; with no sign of any, its first, not matched', () => {
    expect(cat('Fed holds interest rates steady', ['crypto', 'stocks'])).toEqual({ category: 'crypto', matched: false });
    expect(cat('Iran launches missiles', ['macro', 'geopolitics'])).toEqual({ category: 'geopolitics', matched: true });
    expect(cat('The best credit cards of the year')).toEqual({ category: 'crypto', matched: false });
  });
});

describe('the subject of an item that is not macro (FD-MACRORULES)', () => {
  const subject = (title: string) => subjectOf(title, '', det.detect(title), (s) => det.isCrypto(s));
  it('a company the detector does not know reads as one by its story; gold miners are not crypto', () => {
    expect(subject('Fifth Third raised to Buy at Evercore ISI as Comerica integration boosts growth')).toBe('stocks');
    expect(subject('Zephyr Minerals closes $260,000 private placement financing')).toBe('stocks');
    expect(subject('Gordon Mining to acquire Tungsten Tail Project')).toBe('stocks');
    expect(subject('Australian miner Fortescue fires senior executive')).toBeNull();
    expect(subject('Bitcoin ETF inflows hit a record')).toBe('crypto');
    expect(subject('Thousands of Greek students, teachers protest over education, pay')).toBeNull();
  });
});

describe('a general source, stored', () => {
  const now = Date.parse('2026-10-20T12:00:00Z');
  const mk = (title: string, n: number): ParsedItem => ({ guid: `g${n}`, link: `https://benzinga.example/${n}`, title, summary: '', publishedAt: now - n * 60_000 });

  async function setup(categories: string | null = 'crypto,stocks,macro,geopolitics') {
    const db = await testDb();
    await db.run("INSERT INTO sources(id, name, url, category, categories, builtin) VALUES ('bz', 'Benzinga', 'https://benzinga.example/feed', 'crypto', ?, 0)", [categories]);
    return db;
  }
  const stored = (db: Awaited<ReturnType<typeof testDb>>) =>
    db.all<{ title: string; category: string; relevance: number; flags: string }>("SELECT title, category, relevance, flags FROM news WHERE source_id = 'bz' ORDER BY published_at DESC");

  it('gives each item its own category; one about none of them is out of the index (relevance 0)', async () => {
    const db = await setup();
    const items = [
      mk('Bitcoin ETF inflows hit a record', 1),
      mk('Apple earnings beat estimates; shares jump', 2),
      mk('Fed holds interest rates steady as inflation cools', 3),
      mk('Iran launches missiles at tankers as sanctions bite', 4),
      mk('The best credit cards of the year', 5),
    ];
    await ingestItems(db, { id: 'bz', category: 'crypto', categories: 'crypto,stocks,macro,geopolitics' }, items, det, now);
    const rows = await stored(db);
    expect(rows.map((r) => [r.category, r.relevance])).toEqual([
      ['crypto', 1],
      ['stocks', 1],
      ['macro', 1],
      // Geopolitics linked to markets (sanctions): as at BBC World.
      ['geopolitics', 0.8],
      ['crypto', 0],
    ]);
    expect(JSON.parse(rows[4]!.flags)).toContain('lowRelevance');
  });

  it('a new title is classified again; the daily re-tag keeps the rule (relevance 0 stays 0)', async () => {
    const db = await setup();
    const src = { id: 'bz', category: 'crypto' as const, categories: 'crypto,stocks,macro,geopolitics' };
    await ingestItems(db, src, [mk('Apple earnings beat estimates; shares jump', 1), mk('The best credit cards of the year', 2)], det, now);
    await ingestItems(db, src, [{ ...mk('Apple earnings beat estimates; shares jump', 1), title: 'Fed cuts interest rates by half a point' }], det, now);
    expect((await stored(db)).map((r) => [r.title, r.category])).toEqual([
      ['Fed cuts interest rates by half a point', 'macro'],
      ['The best credit cards of the year', 'crypto'],
    ]);
    await retagRecent(db, det, 0);
    expect((await stored(db)).map((r) => [r.category, r.relevance])).toEqual([
      ['macro', 1],
      ['crypto', 0],
    ]);
  });

  it('FD-MACRORULES: a macro source keeps the macro items; a company goes to stocks, a coin to crypto, a war to geopolitics, the rest to other', async () => {
    const db = await setup(null);
    await db.run("UPDATE sources SET category = 'macro' WHERE id = 'bz'");
    const src = { id: 'bz', category: 'macro' as const, categories: null };
    await ingestItems(
      db,
      src,
      [
        mk('Fed holds interest rates steady as inflation cools', 1),
        mk('Apple earnings beat estimates; shares jump', 2),
        mk('Apple says tariffs will cost $1.1 billion', 3),
        mk('Bitcoin ETF inflows hit a record', 4),
        mk('Iran launches missiles at tankers as sanctions bite', 5),
        mk('The best credit cards of the year', 6),
        mk('European shares slip as ECB holds rates', 7),
      ],
      det,
      now,
    );
    const rows = await stored(db);
    expect(rows.map((r) => [r.category, r.relevance])).toEqual([
      ['macro', 1],
      ['stocks', 1],
      ['stocks', 1],
      ['crypto', 1],
      ['geopolitics', 0.8],
      ['other', 0],
      ['macro', 1],
    ]);
    expect(JSON.parse(rows[5]!.flags)).toContain('lowRelevance');
    // The daily re-tag keeps them where they are: the source's category decides, not the item's.
    await retagRecent(db, det, 0);
    expect((await stored(db)).map((r) => r.category)).toEqual(['macro', 'stocks', 'stocks', 'crypto', 'geopolitics', 'other', 'macro']);
  });

  it('FD-MACRORULES: a general source whose first category is macro sends an item about none to other; the upgrade runs once', async () => {
    const db = await setup('macro,geopolitics');
    await db.run("UPDATE sources SET category = 'macro' WHERE id = 'bz'");
    await ingestItems(db, { id: 'bz', category: 'macro', categories: 'macro,geopolitics' }, [mk('The best credit cards of the year', 1), mk('Fed cuts interest rates by half a point', 2)], det, now);
    expect((await stored(db)).map((r) => [r.category, r.relevance])).toEqual([
      ['other', 0],
      ['macro', 1],
    ]);
    // Stored as an older version would have: a company item in macro. The upgrade classifies everything again, once.
    await db.run("UPDATE news SET category = 'macro', relevance = 1 WHERE source_id = 'bz'");
    await db.run("INSERT INTO job_state(name, data) VALUES ('sentiment.daily', '{\"indexVersion\":2}')");
    expect(await upgradeClassification(db, det, det, 'sentiment.daily')).toBe(true);
    expect((await stored(db)).map((r) => r.category)).toEqual(['other', 'macro']);
    expect(await upgradeClassification(db, det, det, 'sentiment.daily')).toBe(false);
    // The job's other data is kept.
    expect(JSON.parse((await db.get<{ data: string }>("SELECT data FROM job_state WHERE name = 'sentiment.daily'"))!.data)).toEqual({ indexVersion: 2, classifyVersion: 2 });
  });

  it('other categories for the source: its stored items classified again', async () => {
    const db = await setup(null);
    // A plain macro source first: macro only by the rules (FD-MACRORULES), the Bitcoin item goes to its subject.
    await db.run("UPDATE sources SET category = 'macro' WHERE id = 'bz'");
    await ingestItems(db, { id: 'bz', category: 'macro', categories: null }, [mk('Bitcoin ETF inflows hit a record', 1), mk('Fed holds interest rates steady', 2)], det, now);
    expect((await stored(db)).map((r) => r.category)).toEqual(['crypto', 'macro']);
    await db.run("UPDATE sources SET category = 'crypto', categories = 'crypto,macro' WHERE id = 'bz'");
    expect(await reclassifySource(db, 'bz', det)).toBe(2);
    expect((await stored(db)).map((r) => [r.category, r.relevance])).toEqual([
      ['crypto', 1],
      ['macro', 1],
    ]);
  });
});
