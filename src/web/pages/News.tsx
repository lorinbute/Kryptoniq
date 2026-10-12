import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import type { NewsItemDto, NewsPage, SourceRow } from '../../shared/api-types.ts';
import { dayKey } from '../../shared/time.ts';
import { api, qs } from '../api.ts';
import { fmtAgo, fmtDate, fmtDateTime, fmtTime } from '../format.ts';
import { useTz, useWatchlist } from '../hooks.ts';
import { useSearchParams } from 'react-router';
import { Empty, ErrorNote, Loading, ScoreBar, Seg } from '../components/ui.tsx';
import { CoinLogo, TopicIcon } from '../components/icons.tsx';

type Range = '24h' | 'today' | 'yesterday' | '7d';
type Cat = '' | 'crypto' | 'macro' | 'geopolitics';
type Sent = '' | 'positive' | 'neutral' | 'negative' | 'pending';

/** Items first seen within this window carry the "nou" badge. */
const NEW_MS = 15 * 60_000;
const CAT_LABEL: Record<string, string> = { crypto: 'Crypto', macro: 'Macro', geopolitics: 'Geopolitică' };
const FLAG_LABEL: Record<string, string> = { sponsored: 'sponsorizat', speculative: 'speculativ', recap: 'rezumat', lowRelevance: 'relevanță scăzută' };
const ENGINE_LABEL = (e: string) => (e === 'local' ? 'model local + reguli' : e === 'rules' ? 'doar reguli' : e.startsWith('claude:') ? `Claude (${e.slice(7)})` : e);

function NewsRow({ item, tz }: { item: NewsItemDto; tz: string }) {
  const [open, setOpen] = useState(false);
  const meta = item.sentiment?.meta as { model?: number | null; rules?: { id: string; score: number; text: string; negated: boolean }[]; impact?: number } | null;
  const today = dayKey(item.publishedAt, tz) === dayKey(Date.now(), tz);
  return (
    <li
      className={clsx(
        'grid grid-cols-[52px_minmax(0,1fr)] gap-x-3 gap-y-2 px-4 py-3.5 sm:grid-cols-[64px_30px_minmax(0,1fr)_110px] sm:gap-x-4 sm:px-5',
      )}
    >
      {/* Another day: the date on its own line above the time, so it can never run into the title. */}
      <div className="num flex flex-col pt-0.5 text-[12.5px] leading-tight text-muted" title={fmtDateTime(item.publishedAt, tz)}>
        {!today && <span className="text-[11.5px] text-faint">{fmtDate(item.publishedAt, tz)}</span>}
        <span>{fmtTime(item.publishedAt, tz)}</span>
      </div>
      <div className="max-sm:hidden">
        <TopicIcon title={item.title} summary={item.summary} category={item.category} coins={item.coins} size={16} boxed />
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 text-[12px] text-faint">
          <span className="inline-flex sm:hidden">
            <TopicIcon title={item.title} summary={item.summary} category={item.category} coins={item.coins} size={13} />
          </span>
          {Date.now() - item.fetchedAt < NEW_MS && <span className="rounded-[5px] bg-brass/15 px-1.5 font-semibold text-brass">nou</span>}
          <span className="text-muted">{item.source.name}</span>
          <span>{CAT_LABEL[item.category] ?? item.category}</span>
          {item.flags.map((f) => (
            <span key={f} className="text-warn">
              {FLAG_LABEL[f] ?? f}
            </span>
          ))}
        </div>
        {/* Low-relevance items are toned down by colour (not opacity), keeping small text readable. */}
        <h3 className={clsx('mt-0.5 text-[15px] leading-snug tracking-[-0.01em]', item.flags.includes('lowRelevance') ? 'font-normal' : 'font-[550]')}>
          {item.url ? (
            <a href={item.url} target="_blank" rel="noopener noreferrer" className={item.flags.includes('lowRelevance') ? 'text-muted' : 'text-text'}>
              {item.title}
            </a>
          ) : (
            item.title
          )}
        </h3>
        {item.summary && <p className="mt-1 line-clamp-1 text-[13px] text-muted">{item.summary}</p>}
        {(item.coins.length > 0 || item.related.length > 0 || item.sentiment) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {item.coins.map((c) => (
              <span key={c} className="tag gap-1 pl-1">
                <CoinLogo coin={c} size={12} />
                {c}
              </span>
            ))}
            {item.related.length > 0 && (
              <button type="button" className="text-[12px] text-link" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
                {open ? <ChevronDown size={12} className="inline" aria-hidden /> : <ChevronRight size={12} className="inline" aria-hidden />} încă {item.related.length}{' '}
                {item.related.length === 1 ? 'sursă' : 'surse'}
              </button>
            )}
            {item.sentiment && (
              <details className="text-[12px] text-faint">
                <summary className="cursor-pointer hover:text-muted">De ce acest scor?</summary>
                <div className="mt-1.5 space-y-0.5">
                  <div>Motor: {ENGINE_LABEL(item.sentiment.engine)}</div>
                  {typeof meta?.model === 'number' && <div>Model: {meta.model.toFixed(2)}</div>}
                  {meta?.rules?.map((r, i) => (
                    <div key={i}>
                      Regula „{r.id}” pe „{r.text}”: {r.score > 0 ? '+' : ''}
                      {r.score}
                      {r.negated ? ' (negată)' : ''}
                    </div>
                  ))}
                  <div>
                    Relevanță {item.relevance}, impact {item.impact}
                  </div>
                </div>
              </details>
            )}
          </div>
        )}
        {open && (
          <ul className="mt-2.5 space-y-1.5 border-l-2 border-line-strong pl-3 text-[13px]">
            {item.related.map((r) => (
              <li key={r.id}>
                <span className="text-faint">{r.source}, {fmtAgo(r.publishedAt)}: </span>
                {r.url ? (
                  <a href={r.url} target="_blank" rel="noopener noreferrer">
                    {r.title}
                  </a>
                ) : (
                  r.title
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="col-start-2 sm:col-start-4 sm:justify-self-end">
        <ScoreBar score={item.sentiment ? item.sentiment.score : null} />
      </div>
    </li>
  );
}

const CATEGORIES: { value: Cat; label: string }[] = [
  { value: '', label: 'Toate' },
  { value: 'crypto', label: 'Crypto' },
  { value: 'macro', label: 'Macro' },
  { value: 'geopolitics', label: 'Geopolitică' },
];
const SENTIMENTS: { value: Sent; label: string; cls?: string }[] = [
  { value: '', label: 'Oricare' },
  { value: 'positive', label: 'Pozitive', cls: 'text-bull' },
  { value: 'neutral', label: 'Neutre' },
  { value: 'negative', label: 'Negative', cls: 'text-bear' },
  { value: 'pending', label: 'În analiză' },
];

export default function NewsPageView() {
  const tz = useTz();
  const watchlist = useWatchlist();
  const sources = useQuery({ queryKey: ['sources'], queryFn: () => api.get<SourceRow[]>('/api/sources'), staleTime: 5 * 60_000 });
  const [urlParams, setUrlParams] = useSearchParams();
  const urlQ = urlParams.get('q') ?? '';
  const [range, setRange] = useState<Range>('24h');
  const [favorites, setFavorites] = useState(false);
  const [coins, setCoins] = useState<string[]>([]);
  const [category, setCategory] = useState<Cat>('');
  const [sentiment, setSentiment] = useState<Sent>('');
  const [source, setSource] = useState('');
  const [text, setText] = useState(urlQ);
  const [search, setSearch] = useState(urlQ);
  // ⌘K "Caută în știri" lands here with ?q=…, also while the page is already open.
  useEffect(() => {
    setText(urlQ);
    setSearch(urlQ);
  }, [urlQ]);
  const applySearch = (v: string) => {
    setSearch(v);
    if (v !== urlQ) setUrlParams(v ? { q: v } : {}, { replace: true });
  };

  const favList = watchlist.data?.map((w) => w.coin) ?? [];
  // Coins removed from the watchlist meanwhile no longer filter anything.
  const activeCoins = coins.filter((c) => favList.includes(c));
  const onlyFavorites = favorites && favList.length > 0;
  const params = { range, favorites: onlyFavorites ? 1 : undefined, coins: activeCoins, category: category || undefined, sentiment: sentiment || undefined, source: source || undefined, q: search || undefined, limit: 50 };
  const q = useInfiniteQuery({
    queryKey: ['news', params],
    queryFn: ({ pageParam }) => api.get<NewsPage>(`/api/news${qs({ ...params, cursor: pageParam })}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: 60_000,
  });

  // Clusters may straddle pages: keep the first occurrence of each story.
  const items = useMemo(() => {
    const seen = new Set<string>();
    const out: NewsItemDto[] = [];
    for (const p of q.data?.pages ?? []) {
      for (const it of p.items) {
        if (seen.has(it.clusterId)) continue;
        seen.add(it.clusterId);
        out.push(it);
      }
    }
    return out;
  }, [q.data]);

  const toggleCoin = (c: string) => setCoins((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));

  return (
    <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h1 className="page-title">Știri</h1>
        <span className="inline-flex items-center gap-2 text-[12.5px] text-muted">
          <span className="size-[7px] rounded-full bg-bull shadow-[0_0_0_4px_rgb(61_220_151/0.15)]" aria-hidden />
          {q.isFetching && !q.isFetchingNextPage && q.data ? 'se actualizează…' : 'se actualizează la fiecare minut'}
        </span>
      </div>

      <div role="toolbar" aria-label="Filtre" className="panel flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-[14px] px-3 py-2.5">
        <Seg
          label="Interval"
          value={range}
          onChange={setRange}
          options={[
            { value: '24h', label: '24 h' },
            { value: 'today', label: 'Azi' },
            { value: 'yesterday', label: 'Ieri' },
            { value: '7d', label: '7 zile' },
          ]}
        />
        <div role="group" aria-label="Categorie" className="flex flex-wrap gap-1">
          {CATEGORIES.map((c) => (
            <button key={c.value} type="button" className="chip-soft" aria-pressed={category === c.value} onClick={() => setCategory(c.value)}>
              {c.label}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Sentiment" className="flex flex-wrap gap-1">
          {SENTIMENTS.map((x) => (
            <button key={x.value} type="button" className={clsx('chip-soft', sentiment !== x.value && x.cls)} aria-pressed={sentiment === x.value} onClick={() => setSentiment(x.value)}>
              {x.label}
            </button>
          ))}
        </div>
        <select aria-label="Sursă" value={source} onChange={(e) => setSource(e.target.value)} className="h-8 max-w-[220px] py-0 text-[12.5px]">
          <option value="">Toate sursele active</option>
          {(sources.data ?? [])
            .filter((s) => s.enabled)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
        </select>
        {favList.length > 0 && (
          <div role="group" aria-label="Monedele mele" className="flex flex-wrap items-center gap-1.5">
            {favList.map((c) => (
              <button key={c} type="button" className="chip gap-1.5 pl-1.5" aria-pressed={activeCoins.includes(c)} onClick={() => toggleCoin(c)}>
                <CoinLogo coin={c} size={16} />
                {c}
              </button>
            ))}
            <label className="ml-1 inline-flex items-center gap-2 text-[12.5px] text-muted">
              <input type="checkbox" checked={favorites} onChange={(e) => setFavorites(e.target.checked)} />
              doar favorite
            </label>
          </div>
        )}
        <form
          className="flex h-8 min-w-[220px] flex-1 items-center gap-2 rounded-[9px] border border-line-strong bg-ink px-2.5 focus-within:border-brass-dim lg:max-w-[300px]"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            applySearch(text.trim());
          }}
        >
          <Search size={14} aria-hidden className="shrink-0 text-faint" />
          <input
            aria-label="Caută în știri"
            placeholder="Caută în titluri și rezumate"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => applySearch(text.trim())}
            className="h-full w-full min-w-0 rounded-none border-0 bg-transparent px-0 py-0 text-[12.5px] focus:border-0"
          />
        </form>
      </div>
      {favList.length > 0 && (onlyFavorites || activeCoins.length > 0) && (
        <p className="text-[12.5px] text-faint">Filtrele schimbă doar lista. Sentimentul zilei se calculează mereu din toate știrile.</p>
      )}
      {favList.length === 0 && watchlist.data && <p className="text-[12.5px] text-faint">Adaugă monede favorite din Setări ca să poți filtra știrile după ele.</p>}

      <section className="panel overflow-hidden" aria-label="Lista de știri">
        {!q.data && !q.isError ? (
          <div className="px-5">
            <Loading />
          </div>
        ) : !q.data ? (
          <div className="p-5">
            <ErrorNote error={q.error} onRetry={() => q.refetch()} />
          </div>
        ) : items.length === 0 ? (
          <div className="px-5 py-2">
            <Empty>
              {onlyFavorites || activeCoins.length
                ? `Nicio știre despre ${(activeCoins.length ? activeCoins : favList).join(', ')} în intervalul ales.`
                : 'Nicio știre pentru filtrele alese. Încearcă un interval mai lung.'}
            </Empty>
          </div>
        ) : (
          <>
            <ul className="divide-y divide-line-soft">
              {items.map((it) => (
                <NewsRow key={it.clusterId} item={it} tz={tz} />
              ))}
            </ul>
            {q.hasNextPage && (
              <div className="border-t border-line-soft px-5 py-3.5">
                <button className="btn" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
                  {q.isFetchingNextPage ? 'Se încarcă…' : 'Încarcă mai multe'}
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
