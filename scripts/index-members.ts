// Regenerates the member lists shipped with the app (FD-INDEXNEWS, TD-INDEXNEWS §2):
//   node scripts/index-members.ts
// reads the Nasdaq-100 (Nasdaq), the S&P 500 and the Dow (Wikipedia) and every US-listed stock (Nasdaq's screener),
// gives each member its news names (a single word found in the system dictionary is an ordinary word, so not a name),
// and writes src/server/news/index-members.snapshot.json. Prints the members found only by their ticker, to review.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { FILTER_INDEX_IDS, type FilterIndexId } from '../src/shared/stock-indices.ts';
import { httpSources, memberAliases, parseNasdaq100, parseScreener, parseWikiConstituents, plausible, WIKI_PAGES, type IndexMember, type IndexMembers } from '../src/server/news/index-members.ts';

const DICT = '/usr/share/dict/words';
if (!existsSync(DICT)) throw new Error(`${DICT} lipsește: dicționarul spune care nume sunt cuvinte obișnuite.`);
const words = new Set(readFileSync(DICT, 'utf8').split('\n').map((w) => w.trim().toLowerCase()).filter(Boolean));
const isWord = (w: string) => words.has(w);

const lists: Record<FilterIndexId, { symbol: string; name: string }[]> = {
  NDX: parseNasdaq100(await httpSources.nasdaq100()),
  SPX: parseWikiConstituents(await httpSources.wikitext(WIKI_PAGES.SPX)),
  DJI: parseWikiConstituents(await httpSources.wikitext(WIKI_PAGES.DJI)),
};
for (const id of FILTER_INDEX_IDS) if (!plausible(id, lists[id])) throw new Error(`${id}: ${lists[id].length} companii, nu pare lista întreagă.`);
const listed = parseScreener(await httpSources.screener());
if (listed.length < 5000) throw new Error(`acțiuni listate: ${listed.length}`);

// One name per company: the Wikipedia one is clean ("Apple Inc."); Nasdaq adds "Common Stock".
const names = new Map<string, string>();
for (const id of ['SPX', 'DJI', 'NDX'] as const) for (const m of lists[id]) if (!names.has(m.symbol)) names.set(m.symbol, m.name);
const members = {} as Record<FilterIndexId, IndexMember[]>;
const tickerOnly = new Set<string>();
for (const id of FILTER_INDEX_IDS) {
  members[id] = lists[id].map((m) => {
    const name = names.get(m.symbol) ?? m.name;
    const aliases = memberAliases(m.symbol, name, isWord);
    if (aliases.length === 0) tickerOnly.add(`${m.symbol} (${name})`);
    return { symbol: m.symbol, name, aliases };
  });
}
const out: IndexMembers = { asOf: Date.now(), members, listed };
writeFileSync(new URL('../src/server/news/index-members.snapshot.json', import.meta.url), `${JSON.stringify(out)}\n`);
console.log(`NDX ${members.NDX.length}, SPX ${members.SPX.length}, DJI ${members.DJI.length}, listed ${listed.length}`);
console.log(`Doar după ticker (${tickerOnly.size}): ${[...tickerOnly].sort().join('; ')}`);
