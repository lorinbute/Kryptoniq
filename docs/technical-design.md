# Kryptoniq — Technical Design (v1)

> Implementează [functional-design.md](functional-design.md). Deciziile de surse/modele sunt justificate în [research.md](research.md).

## 1. Stack

| Strat | Alegere | De ce |
|---|---|---|
| Runtime | **Node ≥ 24** (testat pe 25.9), TypeScript rulat nativ (type stripping), `erasableSyntaxOnly` | o singură limbă peste tot, fără pas de build pentru server |
| HTTP | **Fastify 5** + `@fastify/static` | rapid, validare/hook-uri simple, `inject()` pentru teste |
| DB | **SQLite prin `node:sqlite`** (WAL) | zero dependențe native, un fișier, perfect pentru local |
| Validare | **zod 4** | input API + setări + răspunsuri externe |
| Feed-uri | **fast-xml-parser 5** + `he` | RSS 2.0 / Atom / RDF, CDATA, entități |
| Sentiment local | **@huggingface/transformers 4** (onnxruntime-node), `Xenova/nli-deberta-v3-small` q8 + reguli | cel mai bun scor la evaluare (research §3), offline |
| Sentiment opțional | **@anthropic-ai/sdk** (structured outputs) | calitate superioară pe implicații macro |
| Piață / exchange | **ccxt 4.5** | OHLCV public, KuCoin UTA + clasic, extensibil la alte burse |
| Frontend | **React 19 + Vite 8 + Tailwind 4 + TanStack Query 5 + react-router 8** | standard, rapid |
| Grafice | **lightweight-charts 5.2** + primitive custom | look TradingView, plugin API |
| Teste | **vitest** | unit + integrare (Fastify `inject`, DB temporară) |

Un singur `package.json` (fără workspaces). Structura:

```
src/
  shared/                 # TS pur, folosit de server ȘI de web
    types.ts              # tipuri DTO API
    time.ts               # zile în fus orar, timeframe-uri
    indicator/
      pine.ts             # primitive ta.* cu semantica Pine (na = NaN)
      slingshot.ts        # portul Slingshot System 3.3
      params.ts           # input-uri + valori implicite (identice cu Pine)
  server/
    main.ts               # bootstrap
    config.ts             # căi, port, constante
    db/                   # conexiune, migrații, repo-uri
    http/                 # app Fastify, securitate, rute
    jobs/scheduler.ts
    net/http.ts           # fetch cu timeout, limită de mărime, proxy, UA
    news/                 # surse, parser, normalizare, monede, cluster, ingestie
    sentiment/            # motoare, reguli, indice zilnic
    calendar/             # FF, TradingView, potrivire, glosar
    market/               # ccxt public, cache lumânări, context (F&G, CoinGecko)
    exchange/             # conturi, portofoliu, cost mediu
    scanner/
    secrets/crypto.ts
  web/                    # aplicația React
docs/
data/                     # runtime (gitignored): kryptoniq.db, master.key, models/, logs/
```

Scripturi: `npm run dev` (server `node --watch` + Vite cu proxy `/api`), `npm start` (build web + server care servește `dist/web`), `npm test`, `npm run typecheck`. Toate setează `NODE_USE_ENV_PROXY=1` (respectă `HTTPS_PROXY` dacă există; altfel fără efect).

Porturi: server **4317** (bind `127.0.0.1`), Vite dev **5317**.

## 2. Securitate (aplicație locală, fără login)

1. **Bind** doar pe `127.0.0.1`.
2. **DNS rebinding**: hook `onRequest` respinge (403) orice `Host` al cărui hostname nu e `localhost`, `127.0.0.1` sau `[::1]`.
3. **CSRF**: orice metodă ne-GET necesită header `X-Kryptoniq: 1` și `Content-Type: application/json` (forțează preflight CORS, pe care nu îl permitem); dacă există `Origin`, hostname-ul trebuie să fie local. Fără header-e CORS.
4. **Secrete** (chei exchange, cheie Anthropic): AES-256-GCM, cheie master de 32 octeți din `KRYPTONIQ_MASTER_KEY` (base64) sau `data/master.key` (generată la prima pornire, `chmod 600`). Format stocat: `v1:<iv b64>:<tag b64>:<ct b64>`. API-ul nu returnează niciodată secretul, doar `hint` (`abcd…wxyz`).
5. **Fără cod de tranzacționare**: modulul exchange expune doar metode `fetch*`; un test verifică că nu există apeluri `createOrder|cancelOrder|withdraw|transfer` în `src/server/exchange`.
6. **Conținut din feed-uri**: doar text simplu (HTML stripat, entități decodate); React escapează; link-urile acceptate doar `http(s)`, deschise cu `rel="noopener noreferrer"`.
7. **CSP** pe răspunsurile HTML: `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'`.
8. Log-urile nu conțin secrete (redactare a câmpurilor `apiKey|secret|password|passphrase`).

## 3. Baza de date

`PRAGMA journal_mode=WAL; foreign_keys=ON; busy_timeout=5000`. Migrații versionate prin `PRAGMA user_version` (array de SQL, rulate într-o tranzacție). Timp = **epoch ms (INTEGER)** peste tot.

```sql
settings(key TEXT PRIMARY KEY, value TEXT NOT NULL)                -- JSON
sources(id TEXT PK, name, url UNIQUE, category CHECK IN ('crypto','macro','geopolitics'),
        enabled INT, weight REAL, builtin INT,
        etag, last_modified, last_attempt_at, last_success_at, last_new_item_at,
        last_error, failures INT DEFAULT 0, next_fetch_at INT DEFAULT 0, item_count INT DEFAULT 0)
news(id TEXT PK, source_id REFERENCES sources ON DELETE CASCADE, guid, url, canonical_url,
     title, summary, published_at INT, fetched_at INT, category,
     relevance REAL, impact REAL, flags TEXT,              -- JSON: sponsored/speculative/recap/lowRelevance
     cluster_id TEXT,
     sentiment REAL, sentiment_label TEXT, sentiment_engine TEXT, sentiment_meta TEXT, scored_at INT)
  INDEX(published_at), INDEX(cluster_id), INDEX(canonical_url), INDEX(sentiment_engine, published_at)
news_coins(news_id REFERENCES news ON DELETE CASCADE, coin TEXT, PRIMARY KEY(news_id, coin)) INDEX(coin)
daily_sentiment(day TEXT, tz TEXT, value REAL, raw REAL, confidence TEXT, counts TEXT, breakdown TEXT,
                drivers TEXT, computed_at INT, final INT, PRIMARY KEY(day, tz))
calendar_raw(source TEXT, ext_id TEXT, title, currency, country, ts INT, all_day INT, impact TEXT,
             forecast TEXT, previous TEXT, actual TEXT, unit TEXT, scale TEXT, period TEXT,
             fetched_at INT, PRIMARY KEY(source, ext_id))  INDEX(ts)
calendar_custom(id INTEGER PK, title, ts INT, all_day INT, impact, currency, note, created_at)
job_state(name TEXT PK, last_start INT, last_end INT, last_ok INT, last_error TEXT, runs INT, data TEXT)
watchlist(coin TEXT PK, quote TEXT DEFAULT 'USDT', position INT, aliases TEXT, added_at INT)
exchange_accounts(id INTEGER PK, exchange TEXT, label TEXT, api_key TEXT, secret TEXT, password TEXT,
                  key_hint TEXT, created_at INT, last_ok_at INT, last_error TEXT, permissions TEXT)
cost_basis(account_id REFERENCES exchange_accounts ON DELETE CASCADE, asset TEXT, avg_price REAL,
           updated_at INT, PRIMARY KEY(account_id, asset))
market_cache(key TEXT PK, value TEXT, fetched_at INT)           -- F&G, CoinGecko global, lista monede
```

`news.id = sha1(source_id | guid ∥ canonical_url ∥ title)`. Duplicat cross-source: același `canonical_url` deja existent → item ignorat.

Retenție (job zilnic): `DELETE FROM news WHERE published_at < now − retentionDays`; `calendar_raw` > 400 zile; `daily_sentiment` se păstrează.

## 4. Scheduler și job-uri

`Scheduler` în proces: fiecare job `{name, everyMs, runOnStart, run(ctx)}`; un `setTimeout` per job cu jitter ±10%; **nu se suprapun** (dacă rulează încă, tick-ul se sare); timeout per rulare; erorile sunt prinse și scrise în `job_state`; `stop()` la shutdown (SIGINT/SIGTERM) așteaptă job-urile curente (max 5 s) și închide DB.

| Job | Interval | Ce face |
|---|---|---|
| `news.fetch` | 60 s tick | pentru sursele active cu `next_fetch_at ≤ now` (max 4 în paralel): fetch condițional, parse, ingest. Interval normal 5 min; eșec → backoff `min(60, 5·2^(failures−1))` min |
| `sentiment.score` | 20 s tick + declanșat după ingest | scorează știrile fără sentiment (cele mai noi primele), loturi de 16 (local) / 25 (Claude) |
| `sentiment.daily` | 2 min | recalculează ziua curentă; finalizează zilele trecute nefinalizate (care au știri) |
| `calendar.ff` | 15 min tick | descarcă FF doar dacă `now − last_ok ≥ 60 min` și `now ≥ blocked_until` |
| `calendar.tv` | 15 min + rafale | interval [azi−7z, azi+14z]; dacă următorul eveniment High/Medium e în < 15 min, o rulare la 1 min după ora lui; cât timp un eveniment High/Medium din ultimele 15 min nu are Actual, rulări la ~2 min |
| `market.context` | 60 min | Fear & Greed, CoinGecko global, top 250 monede (nume/simbol, pentru detectare) |
| `scanner` | 5 min | Slingshot pe watchlist, TF implicit |
| `maintenance` | 24 h | retenție știri (Setări) și calendar (400 zile), log-uri > 30 zile șterse, `PRAGMA optimize` |

Stările sunt expuse la `GET /api/health`.

## 5. Știri

### 5.1 Fetch (`net/http.ts`)
`fetchText(url, {etag, lastModified, timeoutMs: 15000, maxBytes: 5 MB, headers})`: `User-Agent: Mozilla/5.0 (Macintosh) Kryptoniq/1.0`, `Accept: application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8`, `If-None-Match` / `If-Modified-Since`. Citire în stream cu oprire la `maxBytes`. 304 → „nemodificat” (succes, fără item-uri). 429 / 5xx / timeout → eroare (backoff).

### 5.2 Parser (`news/parser.ts`)
- Elimină BOM, parsează cu `fast-xml-parser` (`ignoreAttributes:false`, `cdataPropName` → text, `processEntities:true`).
- Răspuns care nu e XML (ex. HTML Cloudflare) → eroare `NOT_A_FEED`.
- RSS 2.0 (`rss.channel.item`), RSS 1.0/RDF (`rdf:RDF.item`), Atom (`feed.entry`; link `rel=alternate` sau primul `href`).
- Câmpuri: `guid|id`, `link`, `title`, `description|summary|content:encoded` (primele 600 de caractere de text), `pubDate|published|updated|dc:date`.
- Date: RFC 822, ISO 8601, și formatul `YYYY-MM-DD HH:mm:ss` (Investing.com, interpretat UTC). Invalid → `null`.

### 5.3 Normalizare (`news/normalize.ts`)
- `toPlainText`: elimină `<script>/<style>`, tag-uri, decodează entități (`he`), comprimă spațiile.
- `canonicalUrl`: doar `http(s)`; host lowercase; șterge `utm_*`, `fbclid`, `gclid`, `mc_cid`, `mc_eid`, `ref`, `cmpid`; fără fragment; fără `/` final.
- Dată: `null` → `fetched_at`; `> now + 5 min` → `fetched_at`; `< now − 3 zile` → item respins.

### 5.4 Clasificare (`news/classify.ts`) — funcții pure
- **Categorie** = categoria sursei.
- **Flags**: `sponsored` (`/sponsored|press release|\bPR\b|partner content|paid/i`), `speculative` (`/price prediction|prediction:|could|might|\?$|forecast:|analyst says .* (to|could)/i`), `recap` (`/weekly recap|week in review|this week in|daily digest|morning brief/i`).
- **Relevanță**: crypto 1.0; macro 0.8 (1.0 dacă conține termeni de piață: stocks, S&P, Nasdaq, Dow, Fed, rate(s), inflation, CPI, yields, Treasury, dollar, earnings, recession, GDP, jobs/payrolls, tariff, oil); geopolitică 0.6 dacă conține termeni care mișcă piața (`war|missile|strike|sanction|tariff|trade (war|deal)|oil|opec|ceasefire|invasion|nuclear|attack|blockade|election|coup|default`), altfel 0 + flag `lowRelevance`.
- **Impact** ∈ {1, 1.5, 2, 3}: 3 → Fed/FOMC/Powell/rate decision/CPI/inflation/payrolls/jobs report/recession/war/tariff/SEC+ETF/hack/exploit/liquidat/bankrupt/crash/default; 2 → BTC/ETH (detectate), ETF, regulation, yields, dollar, stablecoin, Treasury; 1.5 → monede din top 10; altfel 1.

### 5.5 Detectarea monedelor (`news/coins.ts`)
Dicționar = top 250 CoinGecko (nume, simbol) + watchlist (cu aliasuri) + suprascrieri manuale. Reguli:
- Nume: case-insensitive, granițe de cuvânt, cel mai lung întâi (span-urile potrivite nu se mai refolosesc).
- Simbol: doar MAJUSCULE exacte cu granițe (`\bSOL\b`) sau `$sol`/`$SOL`; lungime ≥ 3 (sau `$` explicit); listă neagră: `CEO, ETF, SEC, USD, USA, GDP, CPI, IPO, NFT, DAO, DEX, CEX, API, ATH, ONE, GAS, SUN, NEW, TOP, BIG, ALL, FOR, THE, AND, NOW, OUT, KEY, WIN, ACT, ME, AI, IT, US, UK, EU, UN, OK`.
- Nume ambigue (cuvinte englezești: `Near`, `Link`, `Stellar`, `Avalanche`…) → doar prin simbol, dacă nu sunt în watchlist cu alias explicit. Lista `AMBIGUOUS_NAMES`.
- Din lista CoinGecko se folosesc doar numele din mai multe cuvinte („Wrapped Bitcoin”); numele dintr-un singur cuvânt sunt prea des cuvinte obișnuite („Core”, „Sky”, „Quant”). Numele sigure sunt într-o listă curatoriată (`CORE_COINS`).
- Titlul și rezumatul se scanează separat; într-un text scris în mare parte cu MAJUSCULE („JUST IN: …”) simbolurile „goale” nu se mai caută (doar numele și `$TICKER`).
- Stablecoin-urile (USDT, USDC, DAI, FDUSD, TUSD, USDE) se detectează dar nu contează la „impact top 10”.

### 5.6 Clustering (`news/cluster.ts`)
Tokeni de titlu: lowercase, fără punctuație, fără stopwords, plural simplu (`s` final eliminat pentru cuvinte > 3 litere), numerele păstrate. Pentru fiecare item nou: candidați = știri din ultimele 36 h. `sim = |A∩B| / |A∪B|`. Dacă `sim ≥ 0.5`, sau `sim ≥ 0.34` și au aceleași monede ne-goale și un token numeric comun → același cluster (`cluster_id` = cel al candidatului cel mai similar; altfel `cluster_id = id`).

### 5.7 Ingestie
Într-o tranzacție per sursă: insert nou / update titlu (dacă s-a schimbat → `sentiment = NULL` pentru rescorare); `news_coins`; actualizare stare sursă (`last_success_at`, `last_new_item_at`, `failures=0`, `next_fetch_at`, `etag`, `last_modified`).

## 6. Sentiment

### 6.1 Interfață
```ts
interface SentimentEngine {
  id: 'local' | 'rules' | `claude:${string}`;
  score(items: {id: string; title: string; summary: string}[]): Promise<ScoredItem[]>;
}
type ScoredItem = {id: string; score: number /* −1..1 */; label: 'positive'|'neutral'|'negative'; meta: {...}};
```
Etichetă: `> 0.2` pozitiv, `< −0.2` negativ, altfel neutru.

### 6.2 Motor local = NLI zero-shot + reguli
- Model: `Xenova/nli-deberta-v3-small`, `dtype:'q8'`, `env.cacheDir = data/models`. Încărcare leneșă, o singură instanță (promise memoizat). Stări: `idle → loading → ready | failed` (retry la 30 min).
- Etichete: `good news for crypto and stock prices` / `bad news for crypto and stock prices` / `neutral news`, template `This is {}.`, text = titlul. `s_model = P(good) − P(bad)`.
- **Reguli** (`sentiment/rules.ts`): listă ordonată `{id, re, score, note}`; o regulă consumă span-ul potrivit (o regulă mai specifică, ex. `ETF (approval )?(delayed|rejected|denied)`, are prioritate față de `ETF approval`). `s_rules = clamp(Σscore / max(1, n_hits), −1, 1)`. Negare simplă: `not|no|fails to|denies|won't` în fereastra de 3 cuvinte înainte → scor inversat.
  Categorii de reguli: politică monetară (cuts/hikes/pause, hawkish/dovish, yields up/down, dollar up/down, inflation hot/cool, jobs strong/weak), fluxuri (inflows/outflows, buys/sells/dumps, moves to exchange, mints), securitate (hack/exploit/stolen/drained), lichidări/crash/plunge vs rally/surge/ATH, reglementare (approves/rejects/sues/charges/bans/passes bill), operațional (outage/halt), macro (recession, shutdown, tariffs, war/ceasefire, safe-haven gold).
- Combinare: dacă există reguli → `s = 0.6·s_rules + 0.4·s_model`; altfel `s = s_model`. Model indisponibil → `s = s_rules` (motor `rules`); fără nicio regulă → 0.
- Țintă de calitate (test pe setul de 50): ≥ 44/50 exact, 0 polarități inversate.
- Când modelul devine `ready`, știrile din ultimele 48 h cu `sentiment_engine='rules'` se resetează la `NULL` (rescorare).

### 6.3 Motor Claude (opțional)
- `@anthropic-ai/sdk`, `client.messages.parse` cu `output_config: {format: zodOutputFormat(schema), effort: 'low'}`, `max_tokens: 4096`, loturi de 25 de titluri numerotate.
- Schema: `{results: [{n: int, score: number(−1..1), impact: 1|2|3}]}`; verificare că fiecare `n` din lot are rezultat; lipsă → acele item-uri trec la motorul local.
- `stop_reason === 'refusal'` sau orice eroare → lotul trece pe motorul local (și se loghează). Pentru modele Opus/Sonnet 5.5 se trimite și `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`), dacă SDK-ul instalat îl suportă pe calea `parse`.
- Cheia se citește decriptată doar în memorie, la creare client.

### 6.4 Indicele zilei (`sentiment/daily-index.ts`) — funcție pură
Intrare: știrile cu `published_at ∈ [start, end)` și `published_at ≤ asOf`, `relevance > 0`, sursă activă, `sentiment != NULL`. Parametri impliciți: `halfLifeH=8, shrinkK=4, gamma=1.6, sourceCap=0.25, clusterBoost=0.5`.

Pentru fiecare știre *i*:
```
spec_i   = sponsored ? 0.2 : speculative ? 0.5 : recap ? 0.5 : 1
decay_i  = 0.5 ^ ((asOf − t_i) / halfLife)
base_i   = relevance_i · impact_i · sourceWeight_i · spec_i · decay_i
n_c      = mărimea clusterului lui i (în fereastră)
w_i      = base_i · (1 + clusterBoost·log2(n_c)) / n_c
```
**Plafon pe sursă** (waterfall): dacă există ≥ 4 surse cu pondere, nicio sursă nu poate depăși `sourceCap` din total; excesul se scalează proporțional, iterativ, până converge (max 10 iterații).
```
W  = Σ w_i            S = Σ w_i·s_i / W          (W = 0 → S = 0)
S' = S · W / (W + shrinkK)
index = 50 + 50 · tanh(gamma · S')               ∈ (0, 100), rotunjit la 1 zecimală
confidence = W < 3 ? 'low' : W < 10 ? 'medium' : 'high'
```
Ieșiri: `index, raw=S, confidence, counts{positive,neutral,negative,pending}, breakdown{crypto,macro,geopolitics}` (aceeași formulă pe subset), `drivers` (top 5 pozitive și top 5 negative după `w_i·s_i`, cu titlu/sursă/link), `intraday[]` (indicele recalculat la sfârșitul fiecărei ore trecute din zi).

**Zile**: limitele zilei în fusul `tz` se calculează cu `Intl.DateTimeFormat` (offset-ul real la acel moment, deci corect la DST). Ziua curentă: `asOf = now`. Zi trecută: `asOf = end`; se salvează provizoriu (`final=0`) până când au trecut 2 ore de la sfârșitul zilei și nu mai are știri neevaluate, apoi `final=1` și nu se mai recalculează automat (zilele mai vechi de 3 zile se îngheață oricum). Istoricul începe cu ziua primei colectări (`min(fetched_at)`): zilele anterioare au doar backlog-ul feed-urilor.

## 7. Calendar

### 7.1 ForexFactory
`GET https://nfs.faireconomy.media/ff_calendar_thisweek.json`. Validare zod per eveniment (evenimentele invalide sunt sărite, nu tot payload-ul). Corp care începe cu `<` sau content-type ne-JSON → `RATE_LIMITED` → `blocked_until = now + 60 min`. `ext_id = sha1(title|country|date)`. Înlocuire atomică: șterge rândurile `ff` din săptămâna acoperită (duminică 00:00 ET a primului eveniment → +7 zile) și inserează noile rânduri; payload gol → nu se șterge nimic. Săptămânile acoperite se rețin în `job_state('calendar.ff').data.weeks`. `Holiday` → `all_day=1`. `country='All'` → valută `ALL`.

### 7.2 TradingView
`GET https://economic-calendar.tradingview.com/events?from&to&countries=US,EU,DE,FR,IT,ES,GB,JP,CN,CA,AU,NZ,CH` cu `Origin: https://www.tradingview.com`. `ext_id = id`. Înlocuire atomică a rândurilor `tv` din interval. `actual/forecast/previous` numerice + `unit`, `scale` → formatate la afișare (`197K`, `3.6%`, `-105.6 $B`).

### 7.3 Combinare (la citire, funcție pură `calendar/merge.ts`)
Pentru intervalul cerut:
1. Zilele (ET) acoperite de o săptămână FF → evenimentele FF; restul zilelor → evenimentele TV cu impact mapat `1→High, 0→Medium, −1→Low`.
2. **Potrivire FF↔TV** (doar pentru Actual și pentru `forecast/previous` lipsă): candidați TV cu aceeași valută și `|Δt| ≤ 60 s`. Titluri normalizate: lowercase → sinonime → tokeni; perioada (`mom|yoy|qoq|none`) extrasă din `m/m, y/y, q/q, mom, yoy, qoq`. Dacă ambele au perioadă, trebuie să coincidă. Scor = Jaccard pe tokeni (fără perioadă). Se acceptă cel mai bun scor ≥ 0.34; egalitate între ≥ 2 candidați → fără potrivire. Un eveniment TV se potrivește cu cel mult un eveniment FF (greedy pe scor descrescător).
   Sinonime: `consumer price index|inflation rate → cpi`, `producer price(s)? (inflation)?|ppi → ppi`, `non-?farm (employment change|payrolls) → nfp`, `adp non-?farm employment change → adp employment change`, `(initial )?jobless claims|unemployment claims → jobless claims`, `federal funds rate|fed interest rate decision → fed rate`, `uom|michigan → michigan`, `prelim|preliminary|prel → prelim`, `revised|final → final`, `advance|adv → advance`, `core retail sales → retail sales ex autos`, `trade balance|balance of trade → trade balance`, `ism non-?manufacturing pmi|ism services pmi → ism services pmi`, `philly fed|philadelphia fed → philly fed`, `empire state|ny empire state → empire state`, `crude oil inventories|eia crude oil stocks change → crude inventories`.
3. **Abatere**: valori numerice din șiruri (`%`, sufixe `K/M/B/T` și `scale` TV); `deviation = actual − forecast` dacă ambele există și sunt în aceeași scară.
4. Evenimentele personalizate se adaugă cu `source='custom'`.
5. Glosar RO (`calendar/glossary.ts`) atașat după cuvinte cheie normalizate.

## 8. Piață (ccxt public)
- `getPublicExchange(id)`: instanță ccxt cache-uită, `enableRateLimit:true`, `httpsProxy` din env dacă există; `loadMarkets()` memoizat (reîmprospătat la 24 h). Exchange-uri permise: `kucoin, binance, bybit, okx`.
- `getCandles(ex, symbol, tf, limit)`: cache în memorie (cheie `ex|symbol|tf`, max 50 intrări LRU); TTL 10 s (TF ≤ 15m) / 30 s; cereri identice simultane sunt deduplicate (promise partajat). Reîmprospătare incrementală: dacă cache-ul are < 1 h, se cer doar lumânările de la ultimul `open time` (limit 100) și se combină după timestamp (cea de la același timestamp e înlocuită). Altfel descărcare completă (`paginate` peste 1500). Rezultat sortat, fără duplicate; lumânările cu valori ne-finite sunt eliminate.
- Răspuns: `{candles: [t,o,h,l,c,v][], pricePrecision, tickSize, lastClosedIndex, fetchedAt}` (`lastClosedIndex` = ultima lumânare cu `t + tf ≤ now`).
- Context: F&G (`api.alternative.me/fng/?limit=31`), CoinGecko `global` + `coins/markets` top 250; salvate în `market_cache`; la eroare se servește cache-ul cu `stale=true`.

## 9. Portul Slingshot (`shared/indicator`)

### 9.1 Primitive (`pine.ts`) — clase incrementale, `na = NaN`
- `Sma(len)`: fereastră na-compactată (na → returnează NaN, nu se stochează); `NaN` până la `len` valori.
- `Ema(len)`: seed = SMA na-compactat; apoi `prev + α·(x − prev)`, `α = 2/(len+1)`; `x` na → NaN, starea nu avansează.
- `Rma(len)`: seed SMA; `(prev·(len−1) + x)/len`.
- `Rsi(len)`: prima valoare na; u/d prin `Rma`; `d ≤ 1e-10 → 100`, `u ≤ 1e-10 → 0`.
- `Highest/Lowest(len)` + `bars`: istoric intern al valorilor de la ultimul reset (na → reset + NaN; `barsform` → 0 la na); NaN dacă `bar_index < len−1`; scanare directă a ultimelor `len` valori disponibile; la egalitate: `highestbars` → cea mai **veche**.
- `pivotHigh(L,R)`: la bara `i`, centrul `c = i − R`; valid dacă `i ≥ L+R`, `src[c] > src[j]` pentru `j ∈ (c, i]` și `src[c] ≥ src[j]` pentru `j ∈ [c−L, c)`; returnează `src[c]` sau NaN. `pivotLow` simetric.
- `trueRange(handleNa=true)`, `Atr(len) = Rma(tr)`.
- `stoch(src,h,l,len)` = `100·(src − lowest)/(highest − lowest)` (fără clamp; 0/0 → NaN).
- Verificare: teste care compară implementarea incrementală cu o implementare de referință naivă (fereastră recalculată de la zero la fiecare bară) pe 2000 de lumânări reale + cazuri limită (egalități, valori constante, na la început).

### 9.2 Indicatorul (`slingshot.ts`)
`runSlingshot({candles, htfCandles, chartTfSec, msTfSec, params, nowMs}) → SlingshotResult`.
- Traducere **linie cu linie** a scriptului Pine (aceeași ordine a instrucțiunilor într-o buclă pe bare), cu variabilele `var` ca stare și variabilele ne-`var` resetate la fiecare bară. Toate comparațiile care implică variabile posibil-na folosesc forma Pine (`isNa()` explicit; niciodată `!=` direct pe NaN).
- **Etichete**: emulare `label.new/delete/set_xy/set_color` într-un registru (`id, bar, kind, text, color, alive`); la final se păstrează doar cele vii, ultimele 500 după ordinea creării (`max_labels_count`). Etichetele ATR/MS/tabel, recreate la fiecare bară, sunt reprezentate doar prin starea finală.
- **`request.security` HTF**: seriile `msPivots()` se calculează pe lumânările HTF (pivot, `valuewhen`, `time[msSwing]`). Pentru bara de chart `i` se folosește bara HTF `j` = ultima cu `T_j + htf ≤ t_i + tf` (închisă până la închiderea barei `i`); dacă `i` e ultima bară și e în formare (`t_i + tf > now`) → `j` = bara HTF care conține `t_i` (comportament realtime). `msUseHtf = msTfSec > chartTfSec`; altfel pivoți locali. Fără date HTF când e nevoie → structura de piață e dezactivată și `result.warnings` conține `HTF_UNAVAILABLE`.
- **Ieșiri**:
  - `series`: `emaFast[], emaSlow[], uptrend[]` (pentru nor și culori).
  - `markers`: `{bar, time, kind:'long'|'longPreview'|'takeProfit', color:'tp'|'sl'}`.
  - `atr`: `{tp, sl, fromBar, toBarTp, toBarSl} | null` + tabelul TP/SL.
  - `ms`: `{upper:{price, fromBar}, lower:{price, fromBar}, rightEdgeBar} | null`.
  - `alerts`: `{bar, time, type}` pentru cele 6 alertcondition.
  - `signals`: `{bar, time, entryLow, sl, tp, breakout, outcome:'active'|'tp'|'sl'|'invalidated', closedBar?}` — rezultatele urmează exact logica de culoare/eliminare din Pine.
  - `warnings`: `INSUFFICIENT_HISTORY`, `HTF_UNAVAILABLE`.
- Rulează în browser (graficul) și pe server (scanner). Cost: O(n·lookback) ≈ câteva ms la 5000 de bare.

### 9.3 Randare (web)
- Candlestick + 2 `LineSeries` pentru EMA cu culoare per punct (`color` pe datapoint după `uptrend`).
- Primitivă `CloudFill` (ISeriesPrimitive): poligoane între EMA-uri pe segmente de trend, opacitate 50%.
- Primitivă `HSegments`: segmente orizontale de la `fromBar` la `toBar` (poate depăși ultima bară: coordonata X din `timeScale().logicalToCoordinate(logical)`), stil solid/dashed/dotted, cu etichetă text la capăt (TP/SL/MS).
- `createSeriesMarkers` pentru LONG / TAKE PROFIT.
- Ora pe axă în fusul utilizatorului prin `localization.timeFormatter` + `tickMarkFormatter` (Intl).
- Tabel TP/SL ca overlay HTML în colțul dreapta-jos; precizie = `pricePrecision` al pieței.

## 10. Exchange / portofoliu
- `exchange/accounts.ts`: CRUD; secretele criptate; `buildPrivateClient(account)` → `new ccxt[exchange]({apiKey, secret, password, enableRateLimit:true, options:{adjustForTimeDifference:true}})` (+ `httpsProxy`). Clientul se cache-uiește 10 min în memorie.
- `testAccount`: `fetchBalance()`; pentru KuCoin și `privateGetUserApiKey()` → `permissions` (orice în afară de „General” → avertisment).
- `getPortfolio(accountId)` (cache 20 s, dedup): în paralel, cu erori izolate per secțiune: `fetchBalance` (UTA: unificat; clasic: conturile `trade` și `main`), `fetchPositions`, `fetchOpenOrders` (normal + trigger/stop; futures clasic prin `kucoinfutures`), `fetchMyTrades(since = now − 7 z + 1 min)`; `fetchTickers` pentru evaluarea în USDT. Răspuns: `{balances[], positions[], orders[], fills[], totals, errors{section: message}, fetchedAt}`.
- Dacă o secțiune (solduri, poziții, ordine, fills) eșuează la o reîmprospătare, se afișează ultimele ei date bune, cu ora lor (`stale`), iar eroarea apare deasupra.
- Conturi clasice migrate la **HF** (`loadMigrationStatus()` → `options.hf`): KuCoin cere simbolul pentru ordine și fills, deci se interoghează perechile `<ACTIV>/USDT` ale activelor deținute + watchlist (max 25); ordinele trigger se citesc o singură dată cu `hf:false`.
- **Cost mediu spot** (funcție pură `costBasis.ts`): fills ale activului (cotate în stablecoin) în ordine cronologică; buy → `qty += a, cost += a·p + fee`; sell → `cost −= a·avg, qty −= a` (min 0). Dacă `qty_calc < 0.98·deținerea totală` (toate conturile) → necunoscut (dacă nu există override manual). Override-ul din `cost_basis` are prioritate.
- Erori ccxt mapate: `AuthenticationError → AUTH`, `PermissionDenied → PERMISSION`, `RateLimitExceeded` / KuCoin `429000` (TD-RATELIMIT) `→ RATE_LIMIT`, `NetworkError/RequestTimeout → NETWORK`, `ExchangeNotAvailable/OnMaintenance → MAINTENANCE`.

## 11. API HTTP (JSON, prefix `/api`)
| Metodă | Rută | Note |
|---|---|---|
| GET | `/ping` | verificare rapidă (banner „serverul nu răspunde” în UI) |
| GET | `/health` | job-uri, surse, motor sentiment, dimensiune DB |
| GET | `/sentiment/today` | indice + breakdown + drivers + intraday + counts |
| GET | `/sentiment/history?days=30` | snapshot-uri (zile finale, provizorii și azi) |
| GET | `/sentiment/day/:day` | indicele unei zile anume (din știrile încă păstrate) |
| POST | `/sentiment/rescore` `{hours: 1..168}` | resetează scorurile din interval |
| POST | `/sentiment/recompute-history` | refinalizează zilele cu știri |
| GET | `/news?range=24h\|today\|yesterday\|7d&coins=&favorites=1&category=&source=&sentiment=&q=&cursor=&limit=` | paginare keyset `(published_at,id)`; clustere grupate |
| GET | `/calendar?from=&to=&impact=&currencies=` | listă combinată |
| POST/DELETE | `/calendar/custom[/:id]` | evenimente personalizate |
| GET | `/market/candles?exchange&symbol&tf&limit` | |
| GET | `/market/symbols?exchange&q` | căutare piețe (max 50) |
| GET | `/market/context` | F&G + global |
| GET | `/scanner` | rezultate scanner |
| POST | `/scanner/run` | rulare manuală (prin scheduler, fără suprapuneri) |
| GET/PUT | `/settings` | setări validate cu zod (merge parțial, validare completă) |
| GET/POST/PUT/DELETE | `/watchlist[/:coin]` | PUT pentru ordine/aliasuri |
| GET/POST/PUT/DELETE | `/sources[/:id]`, POST `/sources/test` | sursele builtin nu se șterg |
| GET/POST/DELETE | `/accounts[/:id]`, POST `/accounts/:id/test` | fără secrete în răspuns |
| GET | `/portfolio/:accountId` | |
| PUT/DELETE | `/portfolio/:accountId/cost-basis/:asset` | |

Erori: `{error: {code, message}}` cu status 400 (validare), 404, 409, 502 (sursă externă), 500.

## 12. Setări (cheie `settings` → JSON validat)
```ts
{
  timezone: string /* IANA, validat cu Intl */, retentionDays: 7..365 (90),
  sentiment: {engine: 'local'|'claude', claudeModel: string ('claude-opus-5-5'), claudeKey?: encrypted},
  market: {exchange: 'kucoin'|'binance'|'bybit'|'okx', defaultTf: Tf ('1h'), candles: 1500|3000|5000},
  scanner: {tf: Tf ('1h')},
  calendar: {impacts: Impact[], currencies: string[]},
  indicator: SlingshotParams /* aceleași valori implicite ca în Pine */
}
```

## 13. Frontend
- Rute: `/` (Azi), `/news`, `/calendar`, `/charts/:symbol?`, `/trades`, `/settings`, `/health`. Server: orice rută ne-`/api` → `index.html`.
- Date: TanStack Query; polling: știri 60 s, sentiment 60 s, calendar 60 s, lumânări 10/30 s, portofoliu 30 s, ping 15 s; polling-ul se oprește când tab-ul e ascuns (`refetchIntervalInBackground:false`). O reîmprospătare eșuată nu șterge datele afișate; când serverul nu răspunde apare un banner global.
- Client API: `fetch` cu `X-Kryptoniq: 1` pe mutații; erorile apar lângă acțiunea care le-a produs. Un `ErrorBoundary` per pagină împiedică un ecran alb la o eroare neașteptată.
- Temă: variabile CSS (fundal `#0b0e14`, panouri `#121722`, borduri `#1f2633`, text `#e6edf3`/`#8b95a7`, pozitiv `#00ffaa` (culoarea indicatorului), negativ `#ff4d4f`, accent `#5b8cff`, avertisment `#f5a524`), fonturi de sistem, cifre `tabular-nums`. Fără resurse externe (funcționează offline).
- Componente principale: `SentimentGauge`, `SentimentTimeline`, `DriversList`, `NewsList`/`NewsItem`, `FilterBar`, `CalendarTable`, `Countdown`, `CandleChart` (+ primitive), `IndicatorSettings`, `SignalsTable`, `AlertsList`, `PortfolioTables`, `SettingsForms`, `HealthTables`.

## 14. Testare
- `shared/indicator`: primitive vs referință naivă (2000 lumânări fixture + cazuri limită); scenarii Slingshot (semnal V1→deal→V2→LONG confirmat; invalidare la întoarcerea trendului; înlocuire semnal → roșu; TP signal; ATR TP/SL; ruptură MS bull/bear; HTF mapping; cap 500 etichete; istoric insuficient).
- `news`: parser (RSS/Atom/RDF/CDATA/BOM/dată non-RFC/HTML ne-feed), normalizare URL/text, date viitoare/vechi, monede (ambiguități, liste negre, cel mai lung nume), clustering, clasificare.
- `sentiment`: reguli (setul de 50, doar reguli: fără polarități inversate), combinare, indice zilnic (proprietăți: ponderi, plafon pe sursă, cluster, shrink, DST, zile goale).
- `calendar`: parse FF/TV, detecție rate-limit, potrivire (cazurile reale din research), abateri.
- `secrets`, `security` (Host, CSRF), `settings` (validare), `scheduler` (fără suprapuneri, erori), `costBasis`, rute API cu `fastify.inject` pe DB temporară și rețea mock-uită.
- Smoke manual: server pornit, verificare endpoint-uri cu date reale.

## 15. Riscuri și conflicte cunoscute
| Risc | Atenuare |
|---|---|
| Endpoint TradingView neoficial dispare | Calendarul merge doar cu FF (fără Actual); eroare vizibilă în Stare sistem |
| FF blochează IP-ul | o cerere/oră, `blocked_until`, DB ca rezervă |
| Feed RSS mort/schimbat | sănătate per sursă, backoff, surse editabile |
| Model ML de 170 MB nu se descarcă | motor `rules`, retry la 30 min, rescorare la recuperare |
| Diferențe față de TradingView în primele bare ale istoricului | documentat (FD §5.2); semnalele recente coincid la aceleași date |
| Viitoare versiuni ale indicatorului Pine | portul e izolat în `shared/indicator`; testele de scenariu descriu comportamentul; actualizarea = diff Pine → diff port |
| KuCoin schimbă API-ul (UTA) | ccxt actualizat (`npm update ccxt`) |
| Ceas local decalat | `adjustForTimeDifference` (exchange); zilele folosesc ceasul local |
| Fus orar schimbat | snapshot-urile sunt per `(day, tz)` |

---

## TD-SS33 — Slingshot System 3.3 (implementează FD-SS33)

### Cauza
Variabilele de urmărire a semnalului curent — `activeLongSignalBar`, `activeLongSignalLow`, `storedHighestHigh`, `storedHighestBar` — sunt citite **numai** sub `waitingLongTP` (TP logic, ATR TP, SL, afișarea ATR). Sunt resetate în 4 locuri ale mașinii de stări LONG; doar unul (exit oversold fără semnal valid) e protejat cu `if not waitingLongTP`. Celelalte trei nu:

| Loc (Pine 3.2) | Ramură | Atins pe date reale |
|---|---|---|
| A — l.181 | „Invalidate current long cycle if trend flips” | 82× |
| B — l.218 | căutare V2 + trend întors | 0× (A rulează înaintea lui pe aceeași bară și oprește căutarea; păstrat pentru consecvență) |
| C — l.231 | căutare V2 + `low <= bullV1Low` | 72× |

### Reparația
În A, B, C resetarea celor 4 variabile se face doar dacă `not waitingLongTP` — aceeași gardă ca la l.301. Nimic altceva nu se schimbă.

Corectitudine:
- Când `waitingLongTP` e fals, cele 4 variabile nu sunt citite nicăieri înainte de a fi rescrise la următoarea confirmare → comportament identic.
- Când e adevărat, ele aparțin semnalului confirmat, iar ciclul anulat (A/B/C) nu are dreptul să le atingă.
- Istoricul semnalelor (array-urile `activeSignal*`, culorile etichetelor) nu depinde de aceste variabile → rezultate identice (verificat pe 15 seturi).

### Implementare
1. `Sling Shot System/sling-shot-system.pine` → 3.3 (titlu, shorttitle, comentariu de versiune), garda în A, B, C.
2. Port: `src/shared/indicator/slingshot.ts` aceeași gardă; `SLINGSHOT_VERSION = '3.3'`.
3. `docs/slingshot-port.md`: particularitatea #1 marcată ca reparată în 3.3.
4. Teste noi (`slingshot.test.ts`, blocul „v3.3”): (a) semnal urmărit → deal nou → trend întors: tabelul nu are `NaN`, iar SL-ul atins apoi produce `ATR Stop Loss Hit`; (b) același început, dar maximul depășit apoi produce `Take Profit Signal` și eticheta TAKE PROFIT; (c) deal nou → pullback V2 sub V1: nivelurile rămân, iar SL-ul produce alerta; (d) nimic urmărit → comportament neschimbat; (e) pe datele reale BTC 1h istoricul semnalelor și culorile LONG sunt identice cu cele din 3.2 (`__fixtures__/btc-usdt-1h.signals-v3.2.json`, generat înainte de reparație). Testul existent „trend flip invalidates” verifică în plus că eticheta roșie și urmărirea TP/SL sunt independente.

### Impact asupra altor funcții
- Scanner-ul și graficele folosesc portul → afișează automat 3.3. Coloana „TP / SL active” din scanner nu mai poate fi `NaN`.
- Lista „Semnale” (istoric) din aplicație: neschimbată.
- Lista „Alerte”: poate conține alertele TP/SL care lipseau.

---

## TD-LAUNCH — Lansator fără Terminal (implementează FD-LAUNCH)

### Fișiere
| Fișier | Rol |
|---|---|
| `scripts/kryptoniq.sh` | lansatorul (bash 3.2, cel livrat cu macOS; fără array-uri sau sintaxă bash 4) |
| `Kryptoniq.app` | applet AppleScript generat de `kryptoniq.sh app` cu `osacompile`; ignorat de git (se regenerează) |
| `src/server/config.ts`, `main.ts` | `KRYPTONIQ_QUIET=1` → logger fără consolă (doar fișierul zilnic) |

### Mediul minim
Apletul rulează `do shell script` cu `PATH=/usr/bin:/bin:/usr/sbin:/sbin`, fără profilul shell-ului. Scriptul nu se bazează pe `PATH`:
- **Node**: `KRYPTONIQ_NODE` (dacă e setat; dacă nu e valid → eroare, nu se alege alt Node în tăcere), apoi `command -v node`, `/opt/homebrew/bin/node`, `/usr/local/bin/node`, `~/.volta/bin/node`, `~/.nvm/versions/node/*/bin/node`, `~/.local/share/fnm/aliases/default/bin/node`. Se alege primul executabil cu versiunea majoră ≥ 24.
- **Instrumente**: doar cele din macOS de bază (`curl`, `lsof`, `ps`, `find`, `open`, `osacompile`, `codesign`, `plutil`), apelate cu cale absolută acolo unde contează.
- Rădăcina proiectului = folderul părinte al scriptului (`cd "$(dirname "$0")/.." && pwd -P`). Toate comenzile rulează din ea.

### Detectarea serverului
- „Rulează Kryptoniq” = `GET http://127.0.0.1:$PORT/api/ping` răspunde `{"ok":true}`. `curl -q --noproxy '*'`: `-q` ignoră un `~/.curlrc` care ar putea schimba output-ul, iar `--noproxy` împiedică un `HTTP(S)_PROXY` din mediu să primească cererea locală. GET nu cere header-ul CSRF, iar Host-ul e `127.0.0.1`, deci trece de garda anti-rebinding.
- Procesul serverului = PID-ul care ascultă pe port (`lsof -nP -iTCP:$PORT -sTCP:LISTEN -t`), validat prin linia de comandă (`ps -o command=` conține `src/server/main.ts`). Nu există fișier PID: pornirile cu `npm start` sunt recunoscute la fel, iar un PID vechi nu poate ținti alt proces.
- `PORT` = `KRYPTONIQ_PORT` dacă e întreg 1–65535, altfel 4317 (aceeași regulă ca `loadConfig`).

### `start`
1. Dacă rulează → mesaj + deschide browserul (fără `--no-open`) → exit 0.
2. Dacă portul are alt ascultător → eroare cu PID-ul și comanda lui.
3. **Lacăt** `data/.launcher.lock` (`mkdir` atomic). Dacă există: dacă e mai vechi de 3 min e considerat rămas de la o pornire întreruptă și se șterge; altfel se așteaptă ca cealaltă pornire să termine (max 200 s), apoi se tratează ca la pasul 1. `stop` așteaptă la fel o pornire în curs, ca să nu „rateze” un server care tocmai pornește. `trap` eliberează lacătul la orice ieșire.
4. Verifică `node_modules/` și alege Node-ul.
5. **Build** dacă `dist/web/index.html` lipsește sau dacă vreun fișier din `src/web`, `src/shared`, `vite.config.ts`, `tsconfig.json`, `package.json` sau `package-lock.json` e mai nou (`find -newer`). Se ignoră `.DS_Store` (scris de Finder), `*.test.ts` și `__fixtures__/`, care nu intră în bundle. Se rulează `node node_modules/vite/bin/vite.js build` (fără `npm` în PATH). Output-ul merge în `data/logs/launcher.log`, iar la eșec se afișează ultimele linii.
6. Pornire detașată: `KRYPTONIQ_PORT=$PORT NODE_ENV=production NODE_USE_ENV_PROXY=1 KRYPTONIQ_QUIET=1 nohup node src/server/main.ts >/dev/null 2>>launcher.log </dev/null &`. Toate descriptorii sunt redirecționați, altfel `do shell script` ar aștepta procesul. Pornit dintr-un terminal (`[ -t 0 ]`), scriptul activează job control (`set -m`), deci serverul primește propriul grup de procese și un Ctrl+C în timpul așteptării oprește doar scriptul. `nohup` îl ține în viață când se închide fereastra de Terminal. `launcher.log` e trunchiat la fiecare `start`, deci dimensiunea e limitată la o rulare. Cu `KRYPTONIQ_QUIET`, în stderr ajung doar crash-urile și avertismentele Node.
7. Așteaptă `/api/ping` (pas 0,5 s, max 90 s). Dacă procesul moare → eroare cu ultimele linii din `launcher.log` și cu ce s-a adăugat în log-ul zilei de la această pornire (dimensiunea fișierului e notată înainte de pornire), nu linii vechi. Timeout → mesaj, iar procesul rămâne pornit.

### `stop`
SIGTERM către PID-ul validat → `main.ts` închide HTTP, scheduler-ul și DB, apoi `exit 0`. Se așteaptă max 20 s, după care SIGKILL (cu avertisment). Dacă procesul de pe port nu e Kryptoniq → eroare, nu se oprește nimic.

### `status` / `logs` / `open`
- `status`: exit 0 dacă rulează (PID, URL, durata de rulare din `ps -o etime=`, linia de comandă, deci și Node-ul folosit), exit 3 dacă nu rulează (convenția LSB), exit 1 dacă procesul Kryptoniq ascultă, dar nu răspunde.
- `logs`: `tail -f` pe `data/logs/kryptoniq-<data UTC>.log` (numele folosit de logger), altfel pe cel mai recent.
- `open`: `start` cu deschiderea browserului.

### `app` — apletul
- `osacompile` generează `Kryptoniq.app` în rădăcina proiectului. Calea absolută a proiectului e scrisă în script la generare. La rulare, apletul caută `scripts/kryptoniq.sh` mai întâi **lângă el** (folderul părinte al `.app`), apoi la calea scrisă. Așa merge și în proiect mutat, și mutat în Applications.
- `CFBundleIdentifier = com.dustyinvestments.kryptoniq.launcher`, `CFBundleName = Kryptoniq`, apoi semnătură ad-hoc refăcută (`codesign -f -s -`), pentru că modificarea `Info.plist` invalidează semnătura generată de `osacompile`. TCC ține minte accesul la Documents pe identitatea apletului. Regenerarea apletului poate cere din nou permisiunea.
- Scriptul e rulat cu `/bin/bash <cale> start`, nu direct, deci nu depinde de bitul de execuție (de ex. proiect copiat fără permisiuni). Erorile din `do shell script` sunt afișate cu `display alert`. Dacă mesajul conține „Operation not permitted”, alerta explică permisiunea Documents.
- `osacompile` are nevoie de sesiunea macOS normală (în sandbox-ul Claude Code nu încarcă Standard Additions).

### De ce nu `launchd`
Un LaunchAgent rulează `node` fără un „responsible process” cu acces la Documents. TCC refuză citirea proiectului (`Operation not permitted`) până când `node` primește Full Disk Access, și acesta se pierde la upgrade-ul Homebrew (alt binar). Pentru apletul pornit de utilizator (sau din Login Items), procesele copil sunt atribuite apletului, deci promptul TCC e cel obișnuit, doar pentru Documents.

### Impact asupra altor funcții
- `npm start` / `serve` / `dev` neschimbate. Fără `KRYPTONIQ_QUIET` logger-ul scrie în consolă ca înainte.
- Retenția log-urilor (`pruneLogs`) șterge doar `kryptoniq-YYYY-MM-DD.log`, deci `launcher.log` nu e atins (e trunchiat la fiecare start).
- Securitatea: serverul ascultă tot doar pe 127.0.0.1. Scriptul nu trimite nimic în afara mașinii.
- `.gitignore`: `Kryptoniq.app/`.

### Verificare
`bash -n`, ShellCheck, rulare reală (în afara sandbox-ului, cu `KRYPTONIQ_DATA_DIR`/`KRYPTONIQ_PORT` de test și `KRYPTONIQ_DISABLE_JOBS=1`) în mediul minim al apletului (`env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin`). Scenarii: start la rece cu build, start când rulează, două start simultane, lacăt vechi, port ocupat de alt program, Node invalid, stop/stop repetat, status (0/3), restart, eșec la pornire. Apletul: compilat și decompilat pentru verificarea scriptului. Rularea lui (dublu-click, promptul TCC) se poate face doar în sesiunea utilizatorului.

---

## TD-REDESIGN — Redesign „Cockpit” (implementează FD-REDESIGN)

### Principiu
Doar stratul de prezentare (`src/web`), plus o singură schimbare mică de comportament: pagina Știri citește căutarea din URL (`/news?q=…`), ca să poată fi deschisă din ⌘K. Fără schimbări de API sau de date. Specificația vizuală e canvas-ul Claude Design „Kryptoniq Redesign” (pagina „Cockpit”).

### Fonturi
`@fontsource-variable/geist` și `@fontsource-variable/geist-mono` (npm, servite local; CSP `default-src 'self'` rămâne). `--font-sans: Geist`, `--font-mono: Geist Mono`. Clasa `.num` (folosită pentru toate cifrele) trece pe Geist Mono cu cifre tabulare. Cifrele foarte mari (indicele zilei) rămân în Geist (`.num-display`). `@fontsource-variable/archivo` se elimină.

### Tokens (`styles.css`, `@theme`)
Numele rămân (`ink`, `panel`, `panel-2`, `line`, `text`, `muted`, `faint`, `brass`, `bull`, `bear` …), deci clasele existente continuă să funcționeze.

| Token | Valoare | Rol | Contrast text |
|---|---|---|---|
| `ink` | `#07090e` | fundal | — |
| `ink-2` | `#0a0d13` | benzi (bara de prețuri) | — |
| `panel` | `#0d1118` | tile-uri | — |
| `panel-2` | `#121722` | sub-tile-uri, controale | — |
| `panel-3` | `#161c28` | hover, selectat | — |
| `line` / `line-soft` / `line-strong` | `#1a202b` / `#161b25` / `#262d3a` | margini | — |
| `text` | `#edeff3` | text | 16,4:1 pe `panel` |
| `muted` | `#8d96a8` | secundar | 6,4:1 |
| `faint` | `#7a8395` | meta (în machetă `#6f7889`, prea slab: 4,25:1) | 4,96:1 pe `panel`, 4,70:1 pe `panel-2` |
| `brass` | `#e2b866` | accent Kryptoniq | 10,2:1 |
| `bull` / `bear` | `#3ddc97` / `#ff5d5d` | sus / jos | 10,7:1 / 6,3:1 |

Raze: tile 20 px, sub-tile 12 px, controale 10 px, pastile 999 px.

### Structură
- `App.tsx`: `TopNav` (logo, link-uri, buton ⌘K, ceasuri, starea serverului), `MarketStrip`, `main` (lățime maximă 1600 px). Bara laterală dispare.
- `components/MarketStrip.tsx`: monedele favorite (watchlist). Prețul, variația pe 24 h (ultimele 25 de închideri orare) și graficul mic pe 48 h vin din aceeași cerere pe monedă: `useSparks` → `useQueries` pe `/api/market/candles?tf=1h&limit=50` (API-ul cere minimum 50), `staleTime` 30 s, `refetchInterval` 60 s. Aceleași interogări sunt folosite și de fișele monedelor de pe *Azi* (cache comun). Urmează evenimentul următor (`useNextHighImpact`, numărătoare `fmtCountdown`) și contextul (`/api/market/context`). Dacă nu încape, derulează orizontal în cutia ei, cu o estompare la capătul din dreapta.
- `components/CommandPalette.tsx`: dialog modal (`role="dialog"`, `aria-modal`), deschis cu ⌘K / Ctrl+K sau din buton. Câmp de căutare, listă cu `role="listbox"` și `aria-activedescendant`, ↑/↓/Enter/Esc, focusul revine la închidere. Surse: paginile (statice), monedele favorite, perechile de pe exchange (`/api/market/symbols?q=`, debounce 200 ms, doar când textul are cel puțin 2 caractere) și „Caută în știri «…»” → `/news?q=…`.
- `spark.ts`: `sparkPath(values, w, h)` și `sparkChange(values)` (funcții pure, testate): ignoră valorile ne-finite, întorc `''`/`null` sub 2 puncte; o serie constantă e o linie orizontală la mijloc.
- `format.ts`: `fmtCountdown(ts, now)` = „1z 17h 44m” / „3h 05m” / „12m 09s” (testat), folosit în tile-uri, bandă și calendar.
- *Azi* (`pages/Today.tsx`): grilă de 12 coloane. Sentiment (7 col., 2 rânduri), eveniment următor (5), știri live (5; `/api/news?limit=5`, la 60 s), monedele (6), ce mișcă piața (3), 30 de zile (3). Sub 1280 px se trece la 6 coloane, sub 768 px la o coloană. `dial.ts` (din varianta respinsă) se șterge.
- *Calendar*: `grid-template-columns: repeat(7, minmax(0,1fr))` pe ≥ 1280 px. Sub, o zi pe rând. Ziua de azi e evidențiată. Fișele păstrează toate câmpurile și ștergerea evenimentelor personale.
- *Știri*: filtrele într-o bară orizontală (interval, categorie, sentiment, sursă, monede, căutare). Lista e neschimbată ca date. `q` se inițializează din URL.
- *Grafice*, *Tranzacții*, *Setări*, *Stare sistem*: aceleași componente, în stil tile.
- `CandleChart`: fundal `#07090e`, grilă `#1a202b`, text `#8d96a8`, font Geist. Lumânările și indicatorul rămân neschimbate.

### Riscuri
- **Cereri în plus**: banda de prețuri face câte o cerere de lumânări (50 × 1h) pe monedă la 60 s. Serverul are un cache de 30 s pe lumânări, deci la 3–10 monede e neglijabil pentru KuCoin.
- **Server pornit în timpul unui build**: vezi TD-STATIC (reparat: fișierele noi se servesc fără repornire).
- **⌘K în câmpuri de text**: scurtătura merge și din input-uri (convenția macOS). Esc închide doar paleta.
- **Lățime**: meniul are 7 link-uri. Sub 1100 px derulează orizontal în bara lui.

### Verificare
`typecheck`, teste (inclusiv `spark.test.ts`), build. Capturi headless la 1440 × 900 (*Azi* trebuie să încapă fără derulare), 1280, 1024 și 390 px pentru toate paginile, cu verificarea depășirii orizontale. Paleta ⌘K se testează cu tastatura prin CDP (deschidere, căutare, Enter, Esc). Bucla de review continuă până la o rundă cu 0 probleme.

---

## TD-STATIC — Servirea interfeței după un build (implementează FD-STATIC)

### Cauza
`@fastify/static` era înregistrat cu `wildcard: false`: la pornire listează fișierele din `dist/web` și creează câte o rută pentru fiecare, deci **nu servește fișiere apărute după pornire**. După un `vite build` (nume noi, cu hash), cererile pentru noile `/assets/*.js|css` ajungeau în not-found handler, care răspundea cu `index.html` și status 200. Browserul primea HTML în locul unui modul JavaScript (MIME `text/html`), nu rula aplicația și afișa doar fundalul (pagina neagră). Safari a păstrat starea până la ⌥⌘R.

### Reparația (`src/server/http/app.ts`)
1. `wildcard: true`: fișierele se caută pe disc la fiecare cerere, deci un build nou e servit fără repornire. Fișierul negăsit trece la not-found handler (`reply.callNotFound()`).
2. Not-found handler: o cale care se termină cu o extensie (`/assets/x.js`, `/favicon.ico`) primește **404 text** cu `Cache-Control: no-store`, nu `index.html`. Fallback-ul SPA rămâne doar pentru rutele fără extensie.
3. `index.html` (fallback-ul SPA și orice fișier din afara `assets/`): `Cache-Control: no-store` în loc de `no-cache`, ca browserul să nu păstreze o versiune veche a paginii. `/assets/*` rămâne `immutable` (numele conțin hash-ul conținutului).

### Teste (`server.test.ts`)
Cu un `dist/web` temporar: asset existent → 200 JavaScript `immutable`; asset creat după pornirea aplicației → 200; asset lipsă → 404 text, nu HTML; `/` și `/news` → `index.html` cu `no-store`; `/api/inexistent` → 404 JSON.

### Impact
- `scripts/kryptoniq.sh restart` nu mai e obligatoriu după un build (rămâne util pentru codul serverului).
- Securitate: `send` normalizează căile (fără ieșire din `dist/web`); pe un sistem de fișiere insensibil la majuscule, variantele cu alte majuscule ale unui fișier primesc 403 (comportamentul documentat al `@fastify/static` cu `wildcard: true`). Rutele aplicației nu sunt fișiere, deci nu sunt afectate.

---

## TD-ICONS — implementează FD-ICONS

### Logo-uri de monede
- Dependență: `@web3icons/core` (MIT, 1.788 de logo-uri „branded”, câte un modul ESM per simbol: `export default '<svg…>'`).
- Server: `GET /api/logo/:symbol`. Simbolul e validat (`^[A-Z0-9]{1,15}$`, după `toUpperCase`), apoi trece prin aliasuri (`RENDER → RNDR`) și se încarcă cu `import('@web3icons/core/svgs/tokens/branded/<SYM>.svg.js')`. Rezultatul (SVG-ul sau „lipsă”) se păstrează în memorie. Răspuns: `image/svg+xml`, `Cache-Control: public, max-age=86400`, `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'`. Lipsă → 404 cu același cache, ca browserul să nu reîncerce la fiecare randare.
- Client: `CoinLogo` (în `components/icons.tsx`) → `<img src="/api/logo/BTC" alt="">` (CSP `img-src 'self'`). La eroare se afișează o insignă cu inițiala, cu nuanța derivată stabil din simbol. Simbolurile eșuate sunt ținute într-un `Set` la nivel de modul, deci fără cereri repetate. SVG-ul în `<img>` nu poate rula scripturi.
- Bundle-ul interfeței nu crește: logo-urile vin la cerere.

### Iconițe după subiect (știri) și după tip (evenimente)
- `src/web/icons.ts` (fără React, testabil): `newsTopic(title, summary, category, coins)` → cheie de subiect, cu reguli de cuvinte-cheie (EN, cu limite de cuvânt), în ordine de prioritate: `central-bank`, `inflation`, `jobs`, `growth`, `energy`, `gold`, `bonds`, `fx`, `earnings`, `etf`, `stablecoin`, `hack`, `regulation`, `war`, `politics`, `defi`, `ai`; altfel `coin` (prima monedă detectată), altfel categoria. `eventKind(title, currency, source)` → `inflation`, `jobs`, `growth`, `retail`, `manufacturing`, `central-bank`, `housing`, `sentiment`, `trade`, `holiday`, `custom`, `other`.
- `components/icons.tsx`: maparea cheilor pe iconițe `lucide-react` (Landmark, Percent, BriefcaseBusiness, Factory, Fuel, Gem, ScrollText, Banknote, ChartCandlestick, PieChart, CircleDollarSign, ShieldAlert, Gavel, Swords, Vote, Blocks, Cpu, Globe, Newspaper, ShoppingCart, Home, Smile, Ship, CalendarOff, Star, Bitcoin…). Componentele `TopicIcon` (cu logo-ul monedei pentru `coin`) și `EventIcon`, cu `aria-hidden`.
- Alertele și rezultatele semnalelor: hărți fixe tip → iconiță.

### Bandă cu derulare automată (`MarketStrip`)
- Conținutul e randat o dată „real”, plus atâtea copii inerte câte trebuie să umple lățimea benzii (`ceil(lățime bandă / lățime copie)`), una după alta, într-un „track”. `@keyframes ticker { to { transform: translateX(calc(-1 * var(--ticker-shift))) } }`, cu `--ticker-shift` = lățimea unei copii, dă o buclă fără salt chiar și când conținutul e mai îngust decât ecranul.
- Durata: lățimea unei copii (măsurată cu `ResizeObserver`) / 40 px/s (minimum 10 s), ca variabila CSS `--ticker-duration`.
- `animation-play-state: paused` la `:hover` și `:focus-within`. `@media (prefers-reduced-motion: reduce)`: fără animație, a doua copie ascunsă, `overflow-x: auto`.
- Copia a doua: `aria-hidden="true"` și `inert` (fără focus și fără citire dublă).

### Cursor
În `@layer base`: `a[href], button:not(:disabled), [role="button"], [role="option"], summary, select:not(:disabled), input[type="checkbox"]:not(:disabled), input[type="radio"]:not(:disabled), label:has(> input[type="checkbox"]), input[type="color"]` → `cursor: pointer`. Preflight-ul Tailwind 4 pune `cursor: default` pe butoane, de aici lipsa.

### Data în Știri
Coloana orei: 64 px pe ecrane ≥ 640 px (52 px pe telefon). Pentru o știre din altă zi: data scurtă („12 oct.”) pe primul rând, ora pe al doilea, cu `whitespace-nowrap`. Titlul are coloana lui și nu mai poate fi acoperit.

### Teste
`icons.test.ts`: subiecte pe titluri reale din baza de date (Fed, CPI, petrol, aur, rezultate, ETF, hack, SEC, război, tarife, AI, stablecoin, o monedă), prioritatea (Fed înaintea inflației), fallback-ul pe categorie; tipuri de evenimente pe titluri ForexFactory reale (Core CPI m/m, Unemployment Claims, GDP m/m, Retail Sales m/m, Philly Fed Manufacturing Index, BOE Gov Bailey Speaks, FOMC Statement, Bank Holiday, eveniment personal). `server.test.ts`: `/api/logo/btc` → 200 SVG cu CSP; `RENDER` (alias); simbol necunoscut → 404; simbol invalid (`../x`) → 404 fără acces la disc.

---

## TD-RATELIMIT — implementează FD-RATELIMIT

### Cauza
- ccxt 4.5.85, `kucoin.handleErrors`: caută codul `429000` în `exceptions.exact` (unde există doar `429`), apoi aruncă `ExchangeError` pentru orice cod ≠ `200000`. `handleHttpStatusCode` (care ar fi dat `RateLimitExceeded` pentru HTTP 429) nu mai ajunge să ruleze. Rezultat: `mapExchangeError` → `EXCHANGE`, fără reîncercare.
- `loadPortfolio` cerea `fetchTickers()` (`GET /api/v1/market/allTickers`, pool Public, greutate 15, ~1 000 de perechi) la fiecare încărcare, fără cache comun și fără alternativă. Dacă cererea eșua, toate deținerile rămâneau fără preț.
- Documentația KuCoin (Rate Limit, conturi clasice): `429000` vine și din cota pe 30 s (headerele `gw-ratelimit-*` arată când se poate relua), și din protecția la supraîncărcare a serverului („temporary rate limits may be triggered when the server is overloaded”). În al doilea caz răspunsul nu are headerele cotei, nu consumă din cotă, iar recomandarea e reîncercarea mai târziu. Testul direct (`allTickers` × 3, din aceeași rețea) a răspuns 200, cu `gw-ratelimit-remaining` 1985 → 1955 din 2000.

- **Găsit la investigație — încărcarea piețelor rămânea „otrăvită”:**
  - `Exchange.loadMarkets(reload = false)` (ccxt `base/Exchange.js`) păstrează în `marketsLoading` și promisiunea **respinsă**.
  - Metodele unificate cheamă `loadMarkets()` doar `if (this.markets === undefined)`. Verificat pe toate apelurile din `kucoin` (95/95), `binance` (85/85), `bybit` (76/76) și `okx` (71/71).
  - Deci, **cât timp `markets` lipsește**, orice apel primește aceeași eroare fără nicio cerere în rețea. Verificat cu ccxt real: o cerere, apoi trei eșecuri fără rețea; `loadMarkets(true)` reîncarcă.
  - După o reîncărcare eșuată, când piețele vechi există, apelurile merg mai departe cu ele (verificat: `fetchOHLCV` și `fetchTicker` OK).
  - `MarketData` apela `loadMarkets(loadedAt > 0)`, adică `false` la prima încărcare. Un eșec la pornire bloca graficele, banda și scannerul până la repornire.
  - Clienții de cont sunt păstrați 10 min, deci rămâneau blocați tot atât.
- `kucoin.fetchMarkets` cere implicit și `market/allTickers` (`options.fetchMarkets.fetchTickersFees = true`), doar pentru comisioanele maker/taker, nefolosite de aplicație. Încărcarea piețelor depindea astfel de exact endpoint-ul supraîncărcat.

### Modul nou `src/server/exchange/retry.ts`
- `isRateLimitError(err)`: `ccxt.RateLimitExceeded`, `ccxt.DDoSProtection`, sau mesaj care conține codul `429000` (`/"code"\s*:\s*"?429000/`) ori „too many requests”.
- `isTransientError(err)`: limită de cereri, sau `ccxt.NetworkError` care nu e `RequestTimeout` (ar adăuga 20 s pe încercare) și nici `OnMaintenance`.
- `withRetry(fn, { delaysMs = [1500, 4000], retryIf = isTransientError, sleep })`: încearcă de `delaysMs.length + 1` ori; așteptarea are jitter ±25%. O eroare care nu e trecătoare se aruncă imediat. Funcția nu modifică erorile.

### `exchange/accounts.ts`
- `mapExchangeError`: `isRateLimitError` înaintea celorlalte verificări (ordinea rămâne: AUTH, PERMISSION, RATE_LIMIT, MAINTENANCE, NETWORK, EXCHANGE).
- `defaultClientFactory`: `options.fetchMarkets.fetchTickersFees = false` (spot și futures).
- `ensureMarkets(ex)`: dacă `ex.markets` lipsește, apelează `loadMarkets(true)` cu reîncercare. Rulează la începutul `loadPortfolio` (spot), înaintea citirilor futures (clasic) și în `test()`. Un eșec nu oprește încărcarea: citirile raportează apoi eroarea pe secțiuni.
- `retryOn(ex, fn)`: apelurile unificate ccxt (`fetchBalance`, `fetchPositions`, `fetchOpenOrders`, `fetchMyTrades`, `fetchTickers`) se reîncearcă doar dacă clientul are piețele încărcate. Altfel ccxt repetă instant eșecul încărcării, iar reîncercările doar ar aștepta (până la ~30 s în total). `isUTAEnabled` și `loadMigrationStatus` sunt cereri private directe, fără piețe, și se reîncearcă mereu.
- `tickerSnapshot`: după o listă refuzată (și după reîncercări), timp de 60 s nu se mai cere lista; se merge direct la prețurile individuale, ca endpoint-ul supraîncărcat să nu fie lovit la fiecare reîmprospătare.
- `AccountsService` primește opțional `{ retryDelaysMs }` (testele folosesc `[0, 0]`). Fiecare citire ccxt din `loadPortfolio` și `test()` trece prin `withRetry` **individual**, deci o reîncercare nu repetă citirile care au reușit (ex. contul `trade` după ce `main` a eșuat). Buclele HF (per simbol) se opresc la prima citire care eșuează și după reîncercări, ca până acum.
- **Prețuri:**
  - `tickerSnapshot(exchange, spot)`: hartă `simbol → preț` (`last`, altfel `close`, doar valori > 0) din `fetchTickers()`, cu reîncercare. E ținută 15 s per exchange (comun tuturor conturilor) și are deduplicare a cererilor simultane. O listă goală e eroare.
  - Cererea pornește în paralel cu celelalte secțiuni. Dacă eșuează: `held` = activele cu sold > 0 (din soldurile proaspete), fără stablecoin-uri. Pentru fiecare, prima pereche existentă din `USDT`, `USDC` (cel mult 30 de simboluri) primește un preț individual: KuCoin `publicGetMarketOrderbookLevel1({ symbol: market.id })` (greutate 2), altfel `fetchTicker`. Cererile merg în paralel, prin limitatorul ccxt, fără reîncercare.
  - Ce rămâne nerezolvat folosește ultimul snapshot bun, dacă are cel mult 1 h.
  - `errors.prices` se completează doar dacă o deținere cu pereche are preț vechi sau nu are preț. `stale.prices` = ora snapshot-ului folosit. Tipul `Portfolio['stale']` include acum `prices`.
  - Fără piețe încărcate (`spot.markets` lipsă), cererile individuale se sar, iar snapshot-ul vechi rămâne singura rezervă.
- Activele deținute se calculează o singură dată și se folosesc atât pentru prețuri, cât și pentru simbolurile HF.

### `market/market.ts`
- `MarketData` primește opțional `retryDelaysMs` (implicit `[1000, 3000]`). `ex.fetchOHLCV` (în `fetchRange`) și `ex.loadMarkets` trec prin `withRetry`.
- `loadMarkets(true)` mereu: fiecare încercare face o cerere nouă. TTL-ul de 24 h și deduplicarea rămân în `MarketData.loadMarkets`. Dacă o reîncărcare după 24 h eșuează, se păstrează piețele vechi (lumânările merg mai departe), iar reîncărcarea se reîncearcă după 5 minute (`MARKETS_RETRY_MS`), nu la fiecare cerere.
- Fabrica pentru `kucoin`: `options.fetchMarkets.fetchTickersFees = false`. Doar pentru KuCoin, pentru că la alte exchange-uri `options.fetchMarkets` poate avea altă formă. Verificat: `types` se păstrează prin `deepExtend`.
- Mesajul pentru o limită de cereri care persistă devine `"<exchange>: exchange-ul limitează temporar cererile; se reîncearcă automat"`, în locul JSON-ului brut. Rezerva cu ultimele lumânări bune rămâne neschimbată.

### Interfață (`pages/Trades.tsx`)
- `CODE_RO.RATE_LIMIT` = „exchange-ul limitează temporar cererile (prea multe cereri sau supraîncărcare la exchange); reîncerc automat”.
- Textul brut al exchange-ului apare în pagină doar pentru `AUTH`, `PERMISSION` și `EXCHANGE`, unde ajută la diagnostic. Pentru toate codurile e disponibil în `title`.

### Încărcarea proprie (verificată, neschimbată)
Banda de prețuri: 11 monede × 1 cerere de lumânări 1h pe minut (greutate 3, cache 30 s). Scanner: la 5 min, 1–2 cereri pe monedă. Portofoliu: la 30 s. Totalul e cu mult sub 2000 / 30 s pe pool-ul Public și sub 4000 / 30 s pe Spot, deci intervalele rămân aceleași.

### Teste
- `retry`: reîncearcă `429000` și `NetworkError`; nu reîncearcă `AuthenticationError`, `RequestTimeout` sau `OnMaintenance`; numărul de încercări e respectat.
- `mapExchangeError(new ccxt.ExchangeError('kucoin {"code":"429000",…}'))` → `RATE_LIMIT`.
- Portofoliu:
  - `fetchTickers` eșuează o dată cu `429000` → reîncercare → preț corect, fără eroare;
  - eșuează mereu → prețuri individuale, fără eroare;
  - eșuează mereu și prețurile individuale lipsesc → ultimul snapshot, cu `stale.prices`;
  - fără snapshot → `errors.prices.code === 'RATE_LIMIT'`, preț `null`;
  - două conturi → o singură cerere `fetchTickers` în 15 s.
- `MarketData`:
  - `fetchOHLCV` eșuează o dată cu `429000` → lumânările vin la a doua încercare;
  - o limită care persistă produce mesajul în cuvinte;
  - o încărcare a piețelor eșuată (fals care, ca ccxt, repetă eroarea fără `reload`) se recuperează la cererea următoare;
  - reîmprospătarea zilnică eșuată păstrează piețele vechi și se reîncearcă după 5 min, nu la fiecare cerere.
- Portofoliu:
  - piețe lipsă → `loadMarkets(true)` o singură dată; a doua încărcare nu mai cere;
  - piețe care nu se pot încărca → 3 încercări de încărcare, apoi citirile nu se mai reîncearcă (`fetchPositions` apelat o dată, eroare `RATE_LIMIT`).
- Testele noi au fost verificate prin mutație: cu `loadMarkets(loadedAt > 0)` sau `loadMarkets(false)`, testul corespunzător pică.
- Verificare cu ccxt real și KuCoin real (`allTickers` refuzat artificial): 3 încercări la listă, apoi BTC / ETH / RENDER prin `orderbook/level1`, fără eroare, total corect. Pentru `MarketData`: prima cerere (piețe refuzate de 3 ori) dă mesajul clar, a doua aduce lumânările; `allTickers` nu mai e cerut la încărcarea piețelor.

### Conflicte și impact
- Latență: în cel mai rău caz, o secțiune așteaptă în plus ~5,5 s (portofoliu) sau ~4 s pentru fiecare cerere de lumânări (scanner, grafice). Scannerul are timeout-ul jobului în scheduler. Cererile simultane pentru aceeași cheie sunt deja deduplicate.
- Cache-ul portofoliului (20 s) păstrează și erorile, ca înainte. Reîmprospătarea manuală (`force`) ocolește cache-ul portofoliului, nu și pe cel de 15 s al prețurilor, ca să nu lovească din nou endpoint-ul greu.

---

## TD-CHARTUX — implementează FD-CHARTUX

### 1. Opțiunile graficului (`web/chart/CandleChart.tsx`)
- `grid: { vertLines: { visible: false }, horzLines: { visible: false } }`.
- `crosshair: { mode: Normal, vertLine: { visible: false, labelVisible: true }, horzLine: { visible: false, labelVisible: true } }`. Liniile dispar, etichetele de pe axe rămân.
- `layout.panes: { separatorColor: '#1a202b', separatorHoverColor: '#2a3242', enableResize: true }`. Implicitul bibliotecii e `#E0E3EB`, o linie deschisă pe fundal închis.

### 2. Portul LMA (`shared/indicator/lma.ts`, `lma-params.ts`)
- **Parametri** (`lmaParamsSchema`, zod; limitele din `minval` / `maxval`):
  - `preset` ∈ {Default, Scalping, Swing Trading, Trend Following, Mean Reversion, Custom}, implicit Default;
  - `period` int 50–200 (100); `steepness` 1.5–5.0 (2.5); `maType` ∈ {EMA, SMA, WMA, RMA, VWMA} (EMA); `smooth` int 3–25 (10); `momentumWeight` 1.0–2.0 (1.2);
  - `longThreshold` 0.1–2.0 (0.5); `shortThreshold` −2.0 – −0.1 (−0.5);
  - `bullishColor` #00FFAA, `bearishColor` #B22833, `neutralColor` #FFFF00; `colorBars` true.
- `effectiveLmaParams(p)`: aplică preseturile exact ca în Pine. Doar cele 4 preseturi numite suprascriu `period`, `steepness`, `smooth` și pragurile; Default și Custom lasă valorile introduse.
- `runLma(candles, p)` → `{ signal, color, state, effective }`, aliniate cu lumânările. `NaN` = na. Pentru fiecare bară `b`:
  1. greutăți `w[i] = 1 / ln(max(i + steepness, 2))²`, i = 0…period−1; `totalWeight` = suma lor, în ordine;
  2. `lma = Σ_{i ≤ b} close[b−i]·w[i] / totalWeight`. Împărțirea la **toată** suma greutăților reproduce încălzirea din Pine;
  3. `lmaSlope` = `(lma − lma[10]) / lma[10] · 100` dacă `lma[10]` există și ≠ 0, altfel 0;
  4. `logReturns` = `ln(close / close[1])`, cu protecțiile Pine, altfel 0; `logMomentum = math.sum(logReturns, period) · 252 / period`. `math.sum` e na până la `period` valori (PyneCore: fereastră na-compactată);
  5. regresia pe `ln(close[i])` cu `validPoints > 10`; `denominator` na sau 0 lasă `correlation = 0`, pentru că în Pine comparația cu na e falsă; `rSquared = clamp(corr², 0, 1)`;
  6. `signal = lmaSlope · (0.5 + rSquared · 0.5)`, înmulțit cu `momentumWeight` dacă `sign(signal) == sign(logMomentum)` și `|logMomentum| > 0.01`;
  7. `smoothSignal = MA(signal, smooth)` cu primitivele din `pine.ts`:
     - `Ema`, `Sma` și `Rma` există deja;
     - noi: `Wma` (PyneCore: ponderi 1…len de la cea mai veche bară, normă = Σ1…len, na până la `len` valori) și `RollingSum`;
     - `VWMA = sma(src·volume) / sma(volume)`.
- **Culori:**
  - `fromGradient` reproduce PyneCore / TradingView:
    - poziția e strânsă în interval;
    - alfa se amestecă pe octet, iar canalele sunt premultiplicate cu alfa și trunchiate;
    - na, capete egale sau alfa 0 dau transparent.
  - `color.new(c, t)` → alfa = `floor((1 − t/100)·255 + 0.5)` (10 → 230, 30 → 179).
  - `color.gray` = #787B86, `color.black` = #363A45, `color.white` = #FFFFFF.
  - Culoarea textului din etichetă: luminozitate `0.299r + 0.587g + 0.114b > 150` → negru, altfel alb.
- `state`: BULLISH dacă `smoothSignal > long`, BEARISH dacă `< short`, altfel NEUTRAL (inclusiv na). Culoarea pentru na e neutră, ca în Pine, deci primele bare colorate de `barcolor` sunt galbene.

### 3. Desen (`CandleChart` + `primitives.ts`)
- **Seria LMA** (`LineSeries`, `lineWidth: 3`), în panoul 1:
  - culoare per punct, `priceLineVisible: false`, preț cu 2 zecimale;
  - `autoscaleInfoProvider` include pragurile și 0, ca `hline` din TradingView.
- **Price lines pe seria LMA:**
  - pragul long: bullish @ alfa 179, întrerupt, grosime 1;
  - pragul short: bearish @ 179, întrerupt;
  - 0: gri, continuu, grosime 2;
  - toate fără etichetă pe axă.
- **`GradientFill`** (primitivă nouă, sub serie): pentru fiecare segment (i−1, i), un poligon între linie și 0, umplut cu un gradient vertical:
  - deasupra lui 0: de la culoarea barei i (alfa 230), la linie, la transparent, la 0;
  - sub 0: invers.
- **`EdgeLabel`** (primitivă nouă): caseta `label_left` cu vârf spre stânga, la bara `n+1` (= `bar_index + 2`), la valoarea curentă:
  - fundal: culoarea semnalului @ alfa 230;
  - textul: BULLISH / BEARISH / NEUTRAL.
- **`barcolor`**: când `colorBars` e activ și LMA e afișat, lumânările primesc per bară `color` și `wickColor` = culoarea semnalului.
- **Panouri:**
  - LMA se creează sau se elimină odată cu `showLma`;
  - factorii de înălțime sunt `1 − share` / `share` (`charts.lmaPane`, implicit 0.25);
  - după tragerea separatorului (`pointerup` / `touchend` pe grafic) și la demontare se citesc `getStretchFactor()`; dacă partea LMA s-a schimbat cu peste 0,01, se salvează (strânsă la 0,1–0,7).
- **Stive de suprapunere:** canvas-urile bibliotecii au `z-index` 1–2, iar separatoarele de panouri 49–50. Gazda graficului are `isolation: isolate`, ca ele să rămână sub legende, sub meniul fix (`z-30`) și sub sertare (`z-40`).
- **Suprapuneri HTML aliniate pe panouri:**
  - `CandleChart` măsoară zona panoului principal și a panoului LMA cu `getHTMLElement().getBoundingClientRect()` (rândul panoului), iar lățimea zonei de desen ca lățimea gazdei minus `priceScale('right').width()`. Recalcularea se face pe ResizeObserver (gazda și rândurile panourilor) și pe `timeScale().subscribeSizeChange` (scala de preț care se lățește nu redimensionează niciun rând);
  - `mainOverlay` (tabelul TP/SL al Slingshot) stă în colțul de jos al panoului principal;
  - `lmaLegend(bar)` stă în colțul de sus al panoului LMA; `bar` vine din `subscribeCrosshairMove` și e ținut într-o componentă mică, ca mișcarea mouse-ului să nu re-randeze pagina.

### 4. Setări ținute minte
- **Schema** (`shared/settings.ts`):
  - `charts: { symbol: '' | /^[A-Z0-9][A-Z0-9._-]{0,29}\/[A-Z0-9]{1,15}$/, showPositions: true, showLma: true, lmaPane: 0.1–0.7 (0.25) }`;
  - `lma: lmaParamsSchema`.
  - Timeframe-ul = `market.defaultTf`; eticheta din Setări devine „Timeframe grafice”.
  - `salvage` (pe grupuri) acoperă blob-urile vechi fără `charts` / `lma`.
- **Salvare de pe client** (`web/chart/prefs.ts`, `saveSettingsPatch`):
  - actualizare optimistă a `['settings']` (`cancelQueries`, apoi `setQueryData` cu deep merge);
  - cererile `PUT /api/settings` pleacă **una câte una**, iar patch-urile care se adună între timp se unesc, deci ultima alegere ajunge ultima pe server;
  - răspunsul se pune în cache doar când nu mai e nimic în așteptare;
  - la eroare, `invalidateQueries(['settings'])` readuce adevărul de pe server.
- **Server pornit înaintea acestei versiuni** (interfața nouă e servită imediat după build, serverul vechi nu trimite `charts` / `lma`): pagina completează din valorile implicite (`{ ...DEFAULT_CHART_PREFS, ...s.charts }`, `{ ...DEFAULT_LMA_PARAMS, ...s.lma }`, `charts?.symbol`) și funcționează. Salvările acestor grupuri se pierd până la repornirea serverului.
- **`/charts` fără pereche**: după încărcarea setărilor și a watchlist-ului, `navigate(replace)` la `charts.symbol`, altfel la prima monedă favorită, altfel la BTC/USDT.
- **Perechea se salvează** doar când `candles.data.symbol === symbol` (încărcare reușită) și diferă de cea reținută.
- **Zoom** (`web/chart/view-store.ts`):
  - `localStorage['kryptoniq.chartViews']` = `{ [exchange|symbol|tf]: { barSpacing, scroll, at } }`, cel mult 60 de intrări (cele mai vechi ies);
  - toate accesările sunt în `try/catch`, ca să funcționeze și fără stocare;
  - la o cheie nouă: `applyOptions({ barSpacing })` + `scrollToPosition(scroll)`, altfel ultimele 180 de bare;
  - salvarea se face pe `subscribeVisibleLogicalRangeChange`, cu debounce de 400 ms.

### 5. Ecran complet (`web/chart/fullscreen.ts`, `useFullscreen`)
- **Starea**: `'off' | 'native' | 'css'`.
- **`enter()`**:
  - `el.requestFullscreen()` sau `webkitRequestFullscreen()`; dacă lipsesc sau sunt respinse → `'css'`;
  - `fullscreenchange` / `webkitfullscreenchange` sincronizează starea, inclusiv când ieși din meniul browserului.
- **`exit()`**: `document.exitFullscreen()` / `webkitExitFullscreen()` doar dacă elementul e chiar în ecran complet; în modul css trece la `'off'`.
- **Esc**: un `keydown` cu `Escape` iese din ecran complet (în modul css, și în modul nativ când tasta ajunge la pagină), mai puțin când `blockEsc` (sertarul de setări deschis): Esc îl închide întâi pe el. În modul nativ, de obicei browserul iese singur la Esc, iar `fullscreenchange` sincronizează starea.
- **Modul css**:
  - cadrul primește `fixed inset-0 z-[45]`, deasupra meniului `z-30`, sub ⌘K `z-50`;
  - `overflow: hidden` pe `html` cât durează;
  - aceleași clase și în modul nativ (`flex flex-col bg-ink p-3`); panoul graficului devine `flex-1 min-h-0`, iar `CandleChart` primește înălțimea `h-full`, cu `autoSize`.
- **Sertarele de setări** se randează în interiorul cadrului, ca să fie vizibile în ecran complet; cadrul nu are `transform` / `filter`, deci `fixed` rămâne raportat la fereastră.
- **⌘K** (`App.tsx`): la deschidere se trimite evenimentul `kryptoniq:exit-fullscreen`; hook-ul îl ascultă și iese.
- **Demontare** (navigare în altă parte): ieșire din ecran complet și refacerea `overflow`.

### 6. Pagina Grafice (`pages/Charts.tsx`)
- Starea locală `tf` / `showPositions` dispare; totul vine din `settings.data`.
- Butonul „Indicator” devine **„Indicatori”**: un sertar cu file (Slingshot 3.3 / [DI] LMA). Formularul e generic (`IndicatorForm`), cu câmpurile din `GROUPS`; LMA are grupurile Pine și câmpurile blocate de preset.
- Comutatoare noi: „LMA” (afișat / ascuns) lângă „Pozițiile mele”, și butonul de ecran complet (`Maximize2` / `Minimize2`).

### 7. Teste
- `pine.test.ts`: `Wma` (valori calculate de mână, na până la `len`), `RollingSum`.
- `lma.test.ts`:
  - greutățile și împărțirea la toată suma la încălzire;
  - panta 0 înainte de bara 10; `logMomentum` na înainte de `period−1`, deci fără amplificare;
  - preseturile, inclusiv că Default nu suprascrie;
  - prețuri constante → semnal 0, NEUTRAL;
  - `fromGradient` pe valori calculate după algoritmul PyneCore; `color.new`;
  - VWMA cu volum 0 → na; tipurile de MA aleg primitiva corectă;
  - comparație cu o implementare de referință directă, „ca în Pine” (bucle pe bare, fără optimizări), pe 600 de lumânări sintetice.
- `server.test.ts`: `charts` / `lma` acceptate, valori invalide respinse, `salvage` pentru un blob vechi.
- Teste web: `mergePatch`, `view-store` (limita de 60, `localStorage` indisponibil).
- **CDP** (Chrome) și **WebKit** (Playwright):
  - fără grilă / fără linii de cursor (captură cu cursorul pe grafic);
  - persistența: schimb timeframe, pereche, comutatoare și zoom, plec, revin și reîncarc;
  - panoul LMA și legenda;
  - ecranul complet: intrare, buton de ieșire, Esc (modul css), ⌘K din ecran complet;
  - fără erori în consolă.

### 8. Riscuri
- Fără un export TradingView al LMA, egalitatea numerică cu TV e verificată prin semantica funcțiilor (PyneCore), nu bară cu bară. Un export CSV din TradingView (pe aceeași pereche și același timeframe) ar permite comparația exactă.
- `math.sum` din TradingView folosește un acumulator compensat; portul reînsumează fereastra. Diferențele sunt pe ultimele zecimale și nu schimbă starea decât la egalitate exactă cu un prag.

### 9. Addendum: fila Style a LMA (FD-CHARTUX §7)
- **`lmaParamsSchema` primește câmpurile de stil:**
  - `showSignal` (true), `signalWidth` int 1–4 (3), `showFill` (true), `showBarColors` (true);
  - `showLongLine` / `showShortLine` / `showNeutralLine` (true);
  - `longLineStyle` / `shortLineStyle` ∈ {Solid, Dashed, Dotted} (Dashed); `neutralLineStyle` (Solid).
  - Valorile vechi salvate, fără aceste câmpuri, primesc valorile implicite: zod `default` pe câmpuri lipsă.
- **Desen:**
  - linia: `lineVisible = showSignal`, `lastValueVisible = showSignal`, `crosshairMarkerVisible = showSignal`, `lineWidth = signalWidth`; seria rămâne, ca pragurile, eticheta și legenda să rămână;
  - umplerea: `fill.setData([])` când `showFill` e fals;
  - culorile lumânărilor: `colorBars && showBarColors`;
  - pragurile: se creează doar cele afișate, cu stilul ales; `autoscaleInfoProvider` include doar liniile afișate.
- **Formular** (`IndicatorForm`, comun Slingshot / LMA):
  - `bool` are bifa în stânga etichetei;
  - câmpurile cu același `inline` se pun pe un rând;
  - `tip` → iconiță (i) cu `title` (textul Pine);
  - tip nou `line`: bifă + etichetă + mostră de culoare (calculată ca în desen) + stil + valoare (doar citire, din prag).

### 10. Addendum: triunghiurile Slingshot (FD-CHARTUX §8)
- Pine: `label.new(…, "LONG", style=label.style_triangleup, yloc=yloc.belowbar, size=size.small)` și `label.new(bar_index, high, "TAKE PROFIT", style=label.style_triangledown, yloc=yloc.abovebar, size=size.small)`.
- Markerii lightweight-charts au doar `arrowUp/arrowDown/circle/square`, deci se folosește o primitivă nouă, `ShapeLabels` (`primitives.ts`), pe seria lumânărilor:
  - triunghi de ~11 × 9 px, la 5 px de minimul (LONG) sau maximul (TAKE PROFIT) barei;
  - text de 11 px în aceeași culoare, sub triunghi pentru LONG și deasupra lui pentru TAKE PROFIT;
  - se desenează doar barele vizibile.
- `createSeriesMarkers` nu mai e folosit.

---

## TD-PNL — implementează FD-PNL
- **Server** (`exchange/accounts.ts`): `OrderRow.stop: 'down' | 'up' | null`, din `info.stop`:
  - futures: `down` / `up`;
  - spot: `loss` → `down`, `entry` → `up`;
  - altceva → `null`.
  - Test: ordinele false cu `info.stop` produc direcția corectă.
- **Client** (`web/chart/pnl.ts`, funcție pură): `pnlLines({ base, quote, lastPrice, positions, balances, orders })` → `PriceLineSpec[]`.
  - **Trade-uri:**
    - poziții futures cu `symbol` ce începe cu `${base}/` și `size > 0` (sens din `side`);
    - deținerea spot `asset === base` cu `avgPrice` (cantitatea însumată pe conturi), considerată long.
  - **Ordine care închid:**
    - futures: `market === 'futures'` și același `symbol`, cu sensul opus;
    - spot: `market === 'spot'` și simbolul `${base}/${quote}`, cu `side === 'sell'`.
  - **Clasificare:** cu `triggerPrice`, direcția = `stop` ?? (`trigger < lastPrice ? 'down' : 'up'`); long: `down` → SL, `up` → TP; short invers. Fără `triggerPrice` (limit) → TP.
  - **Cantitate:** futures `min(order.amount, pos.contracts) × (pos.size / pos.contracts)`; spot `min(order.amount, qty)`; fără `amount` → toată cantitatea.
  - **Text:** `SL −11,40 USDT (−3,0%)`, prin `fmtNum` (format ro), cu semn explicit; quote-ul e cel al poziției (`USDT` / `USDC`).
  - **PnL curent:** linie la `lastPrice`, `lineVisible: false`, titlul „PnL …”, culoare verde / roșie. Eticheta de pe axă rămâne: biblioteca desenează titlul doar împreună cu ea (verificat pe captură). Eticheta stă peste eticheta ultimului preț, cu același preț, colorată după semnul PnL-ului.
- `PriceLineSpec` primește opțional `lineVisible`, `axisLabelVisible`, `width`; `CandleChart` le transmite.
- `usePositionLines` (Charts) folosește `pnlLines` în locul liniilor pentru intrare și ordine. Liniile de lichidare rămân. Linia „Preț mediu” spot devine intrarea spot.
- **Teste** (`pnl.test.ts`):
  - long cu SL stop-down și TP limit;
  - short cu SL stop-up;
  - TP parțial;
  - direcție necunoscută decisă de prețul curent;
  - spot cu preț mediu, și spot fără preț mediu (fără PnL);
  - ordine care nu închid trade-ul (rămân albastre);
  - formatarea textului.
