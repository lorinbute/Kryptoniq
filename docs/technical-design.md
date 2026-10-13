# Sentiq — Technical Design

> Implementează [functional-design.md](functional-design.md). Deciziile de surse / modele sunt justificate în [research.md](research.md).
>
> Două părți, ca FD-ul: **Partea I — arhitectura de azi** (referința) și **Partea a II-a — istoricul** (secțiunile TD-… scrise pentru fiecare schimbare). Numerotarea §1–§15 e cea din v1 (codul trimite la ea, ex. „TD §6.4”); subiectele apărute după v1 sunt §16–§18. Sentiq se numea **Kryptoniq** până pe 13 oct 2026 (TD-SENTIQ §1).

# Partea I — Arhitectura de azi

## 1. Stack

| Strat | Alegere | De ce |
|---|---|---|
| Runtime | **Node ≥ 24** (testat pe 25.9), TypeScript rulat nativ (type stripping), `erasableSyntaxOnly`; TypeScript 7 doar pentru verificare | o singură limbă peste tot, fără pas de build pentru server |
| HTTP | **Fastify 5** + `@fastify/static` | rapid, hook-uri simple, `inject()` pentru teste |
| DB | **SQLite prin `node:sqlite`** (WAL) | zero dependențe native, un fișier |
| Validare | **zod 4** | input API, setări, răspunsuri externe, ieșirile lui Claude |
| Feed-uri | **fast-xml-parser 5** + `he` | RSS 2.0 / Atom / RDF, CDATA, entități |
| Sentiment local | **@huggingface/transformers 4** (onnxruntime-node), `Xenova/nli-deberta-v3-small` q8 + reguli | cel mai bun scor la evaluare (research §3), offline |
| Claude | **@anthropic-ai/sdk** (structured outputs) | sentiment opțional, rezumatul zilei |
| Connector | **@modelcontextprotocol/server 2** (+ `/client` în teste) | MCP peste Streamable HTTP, OAuth 2.1 |
| Autentificare | `scrypt` (node:crypto), TOTP propriu, **@simplewebauthn/server 13** (passkey), `uqr` (codul QR) | fără add-on-uri native |
| Piață / exchange | **ccxt 4.5** (crypto, public și privat); REST propriu pentru brokeri, Nasdaq, Twelve Data | o singură bibliotecă pentru 7 exchange-uri |
| Frontend | **React 19 + Vite 8 + Tailwind 4 + TanStack Query 5 + react-router 8**, `lucide-react`, `@dnd-kit`, fonturile Geist / Geist Mono (`@fontsource-variable`) | standard, rapid |
| Grafice | **lightweight-charts 5.2** + primitive proprii | aspect TradingView, plugin API |
| Logo-uri | `@web3icons/core` (monede, servite de server la cerere), PNG / SVG oficiale (exchange-uri și brokeri) | fără resurse externe în pagină |
| Teste | **vitest 5** | unit + integrare (Fastify `inject`, DB temporară, rețea simulată) |

Un singur `package.json` (`sentiq`, fără workspaces). Structura:

```
src/
  shared/                 # TS pur, folosit de server ȘI de web
    api-types.ts          # tipurile DTO ale API-ului
    settings.ts           # schema setărilor (zod) și constantele lor
    providers.ts          # exchange-urile și brokerii: câmpuri, pași, ce se citește
    time.ts               # zile în fus orar, timeframe-uri
    indicator/            # pine.ts, slingshot.ts + params.ts, lma.ts + lma-params.ts
  server/
    main.ts, context.ts   # pornirea, serviciile aplicației
    config.ts, log.ts, settings.ts
    auth/                 # utilizatori, parole, sesiuni, TOTP, coduri de recuperare, passkey, limitare, email
    db/                   # conexiune, migrații
    http/                 # app Fastify, securitate, cookie-uri, autentificare, rute
    jobs/                 # scheduler + job-urile
    net/http.ts           # fetch cu timeout, limită de mărime, proxy, UA
    news/                 # surse, parser, normalizare, clasificare, monede, cluster, ingestie, interogare
    sentiment/            # motoare, reguli, indice zilnic
    calendar/             # FF, TradingView, rezultate companii, potrivire, glosar
    economy/              # indicatorii pe țări
    market/               # ccxt public, acțiuni (Nasdaq, Twelve Data), context, logo-uri
    exchange/             # conturi, brokeri, reîncercări, cost mediu
    scanner/, summary/, mcp/, secrets/crypto.ts
  web/                    # aplicația React: pages/, components/, chart/, public/ (theme.js, brand/, provider-logos/)
  build/prune-assets.ts   # curățenia build-ului (FD-STALE, FD-NOAPI)
scripts/                  # sentiq.sh (lansator, Sentiq.app), admin.ts, check-node.mjs, smoke.ts, app-icon/
docs/
data/                     # runtime (gitignored): kryptoniq.db (sentiq.db la o instalare nouă), master.key, models/, logs/, backups/
```

Scripturi: `npm run dev` (server `node --watch` + Vite cu proxy `/api`), `npm start` (build web + server care servește `dist/web`), `npm run serve`, `npm test`, `npm run typecheck`, `npm run smoke`. Toate setează `NODE_USE_ENV_PROXY=1` (respectă `HTTPS_PROXY` dacă există). `scripts/sentiq.sh` pornește / oprește serverul în fundal și construiește `Sentiq.app` (TD-LAUNCH); scurtătura veche `scripts/kryptoniq.sh` nu mai există.

Porturi: server **4317** pe toate interfețele (`SENTIQ_BIND`, implicit `::`), Vite dev **5317** (`localhost`). Variabile: `SENTIQ_PORT`, `SENTIQ_BIND`, `SENTIQ_DATA_DIR`, `SENTIQ_ALLOWED_HOSTS`, `SENTIQ_MASTER_KEY`, `SENTIQ_PUBLIC_URL`, `SENTIQ_MCP`, `SENTIQ_MCP_CLIENTS`, `SENTIQ_DISABLE_JOBS` (teste), `SENTIQ_QUIET` (lansatorul); fiecare acceptă și numele `KRYPTONIQ_*`.

## 2. Securitate

1. **Host allowlist** (anti DNS rebinding, `http/security.ts`): răspunde doar la `localhost`, adresele IPv4 / IPv6 ale Mac-ului, numele lui (cu și fără `.local`), `SENTIQ_ALLOWED_HOSTS` și gazda adresei publice; recitită la un minut. Altfel 403 „Sentiq răspunde doar pe adresele acestui Mac”.
2. **Origin**: dacă există, trebuie să fie exact gazda cererii (același origin), altfel 403.
3. **CSRF**: orice metodă ne-GET cere header-ul `X-Sentiq: 1` (`X-Kryptoniq: 1` încă acceptat, pentru taburile de dinainte de redenumire) și, cu corp, `Content-Type: application/json` (forțează preflight CORS, pe care nu îl permitem). Excepție: rutele connectorului cu token Bearer (`/mcp`, `/oauth/token|revoke|register`), care nu citesc cookie-ul. Verificarea folosește ruta potrivită de router, nu URL-ul brut.
4. **Autentificare** (`http/auth.ts`, TD-USERS): cookie `sentiq_session` (HttpOnly, SameSite=Strict, Secure pe HTTPS), sesiuni în DB după hash (`full` 30 de zile glisante, `pending` 5 minute între parolă și codul 2FA). Rute publice doar pentru login / cerere de cont / activare / resetare / passkey și `GET /api/ping`; restul cer sesiune `full`; `/api/admin/*`, `/api/health`, sursele, rescorarea și cheile globale cer rolul `admin`.
5. **Parole**: `scrypt` (format `scrypt$N$r$p$salt$hash`, parametrii pot crește), minimum 12 caractere cu literă mare, mică și cifră. **TOTP**: SHA-1, 6 cifre, 30 s, ±1 pas, secretul criptat, un cod nu se poate refolosi (`totp_last_step`); 10 coduri de recuperare de unică folosință (SHA-256). **Passkey**: WebAuthn cu `userVerification: required`, RP = gazda cererii (merge pe `localhost`, nu pe IP). **Limitare**: 3 încercări greșite / dispozitiv → 15 minute.
6. **Secrete** (chei exchange / broker, Claude, Twelve Data, Resend, secretul TOTP): AES-256-GCM cu cheia master de 32 de octeți din `SENTIQ_MASTER_KEY` (base64) sau `data/master.key` (generată la prima pornire, `chmod 600`). Format: `v1:<iv b64>:<tag b64>:<ct b64>`. API-ul nu returnează niciodată secretul, doar un indiciu (`abcd…wxyz`).
7. **Fără cod de tranzacționare**: modulele exchange / broker fac doar citiri (`fetch*`, GET); un test verifică că nu există apeluri `createOrder|cancelOrder|cancelAllOrders|editOrder|withdraw|transfer|setLeverage|setMarginMode` în `src/server/exchange`.
8. **Conținut din feed-uri**: doar text simplu (HTML eliminat, entități decodate); React escapează; link-urile doar `http(s)`, cu `rel="noopener noreferrer"`.
9. **Header-e**: CSP pe HTML `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'` (tema se aplică dintr-un fișier, `public/theme.js`, nu inline), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.
10. **Log-uri** fără secrete (redactare `apiKey|api_key|secret|password|passphrase|claudeKey|x-api-key`); linkurile de activare / resetare nu apar niciodată în jurnal.
11. Primul acces al adminului (parola) e permis doar de pe Mac (loopback). `scripts/sentiq.sh admin-reset` șterge parola, 2FA și passkey-urile adminului.

## 3. Baza de date

`PRAGMA journal_mode=WAL; foreign_keys=ON; busy_timeout=5000`. Migrații versionate prin `PRAGMA user_version` (`db/migrations.ts`, listă care doar crește, fiecare într-o tranzacție; azi **8**). Timp = **epoch ms (INTEGER)** peste tot. Fișierul: `data/kryptoniq.db` dacă există (instalările de dinainte de redenumire), altfel `data/sentiq.db`. Înainte de o repornire cu o migrare nouă se face un backup (`VACUUM INTO data/backups/…`).

| Tabel | Ce ține | Migrarea |
|---|---|---|
| `settings` | setările globale (JSON) și cheile criptate ale aplicației | 1 |
| `sources` | sursele de știri (`category` ∈ crypto / macro / geopolitics / stocks; `auto` = feed gestionat de aplicație, ex. `nasdaq:AAPL`), starea fetch-ului | 1, 2 |
| `news`, `news_coins` | știrile (relevanță, impact, flags, cluster, sentiment, `sentiment_impact` dat de Claude) și monedele / acțiunile detectate | 1, 4 |
| `daily_sentiment` | indicele pe zi și fus (`final` după îngheț) | 1 |
| `calendar_raw`, `calendar_custom` | evenimentele FF / TV / rezultate; evenimentele personale (`user_id`) | 1, 3 |
| `job_state` | starea job-urilor (și date persistate, ex. săptămânile FF, bugetul Twelve Data) | 1 |
| `watchlist` | favoritele per utilizator (`kind` crypto / stock, `name`, `exchange`, aliasuri, ordine) | 1–3 |
| `exchange_accounts`, `cost_basis` | conturile (credențiale criptate, `env`, `user_id`) și prețul mediu introdus manual | 1–3 |
| `market_cache` | contextul pieței (F&G, CoinGecko, CNN, Nasdaq), lista de monede | 1 |
| `users`, `sessions`, `passkeys`, `user_tokens`, `user_settings` | conturi, sesiuni (hash), passkey-uri, linkuri unice (`reset`, `activate`; hash), setările personale | 3, 8 |
| `econ_indicators`, `econ_releases` | indicatorii pagina Economie și publicările lor | 5 |
| `day_summaries` | ultimul rezumat al zilei, per utilizator și zi | 6 |
| `mcp_clients`, `mcp_grants`, `mcp_codes`, `mcp_tokens` | OAuth-ul connectorului (doar hash-uri) | 7 |
| `account_requests` | cererile de cont | 8 |

`news.id = sha1(source_id | guid ∥ canonical_url ∥ title)`. Duplicat între surse: același `canonical_url` deja existent → item ignorat.

Retenție (job `maintenance`, zilnic): știrile mai vechi de `retentionDays` (implicit 90), `calendar_raw` > 400 de zile, sesiunile expirate, cererile de cont mai vechi de 30 de zile, feed-urile acțiunilor scoase din favorite, istoricul economic vechi, codurile / tokenurile connectorului expirate, log-urile > 30 de zile, `PRAGMA optimize`. `daily_sentiment` se păstrează.

## 4. Scheduler și job-uri

`Scheduler` în proces (`jobs/scheduler.ts`): fiecare job `{name, everyMs, runOnStart | firstDelayMs, timeoutMs, run(signal)}`; un `setTimeout` per job cu jitter ±10%; **nu se suprapun**; timeout per rulare (cu `AbortSignal`); erorile sunt prinse și scrise în `job_state`; `nudge(name, ms)` aduce o rulare mai aproape; `stop()` la SIGINT / SIGTERM așteaptă job-urile curente (max 5 s) și închide DB. `SENTIQ_DISABLE_JOBS=1` le oprește (teste).

| Job | Interval | Ce face |
|---|---|---|
| `news.fetch` | 60 s tick | sursele active cu `next_fetch_at ≤ now` (max 4 în paralel): fetch condițional, parse, ingest; interval normal 5 min; eșec → backoff `min(60, 5·2^(failures−1))` min |
| `sentiment.score` | 20 s + după ingest | scorează știrile fără sentiment (cele mai noi primele), loturi de 16 (local) / 25 (Claude) |
| `sentiment.daily` | 2 min | recalculează ziua curentă, finalizează zilele trecute; o dată după o schimbare de ponderare, recalculează istoricul (FD-IMPACT §3) |
| `calendar.ff` | 15 min tick | descarcă FF doar dacă `now − last_ok ≥ 60 min` și `now ≥ blocked_until` |
| `calendar.tv` | 15 min + rafale | [azi−7z, azi+14z]; alimentează și pagina Economie; aproape de un eveniment High / Medium și până apare Actual, rulări la ~1–2 min |
| `calendar.earnings` | 6 h | rezultatele trimestriale ale acțiunilor din favoritele tuturor (Nasdaq) |
| `econ.history` | 24 h | istoricul indicatorilor (~400 de zile, o dată) și calendarul publicărilor |
| `market.context` | 60 min | Fear & Greed, CoinGecko global, top 250 monede (pentru detectare; la schimbare, reetichetarea ultimelor 3 zile) |
| `stocks.market` | 5 min | starea bursei SUA, S&P 500, Nasdaq 100, VIX, Fear & Greed CNN |
| `scanner` | 5 min | Slingshot pe favoritele fiecărui cont activ, cu timeframe-ul și setările indicatorului lui (aceeași pereche cu aceleași setări se calculează o dată) |
| `maintenance` | 24 h | retenție și curățenie (§3) |

Stările sunt expuse la `GET /api/health` (admin).

## 5. Știri

### 5.1 Fetch (`net/http.ts`)
`fetchText(url, {etag, lastModified, timeoutMs: 15000, maxBytes: 5 MB, headers})`: `User-Agent: Mozilla/5.0 (Macintosh; …) Sentiq/0.2`, `Accept: application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8`, `If-None-Match` / `If-Modified-Since`. Citire în stream cu oprire la `maxBytes`. 304 → „nemodificat” (succes, fără item-uri). 429 / 5xx / timeout → eroare (backoff). Sursele implicite (31: crypto 9, macro 14, geopolitică 5, acțiuni 3) sunt în `news/sources.ts`; pentru fiecare acțiune favorită se adaugă feed-ul Nasdaq al simbolului (`auto`), șters după ce acțiunea iese din favorite și știrile ei au ieșit din retenție.

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
- **Relevanță**: crypto 1.0; acțiuni 1.0 dacă are acțiuni / monede detectate sau termeni de piață, altfel 0.8; macro 1.0 cu termeni de piață (stocks, S&P, Nasdaq, Fed, rates, inflation, CPI, PCE, yields, dollar, earnings, recession, GDP, jobs, tariffs, oil, ECB, BoJ…), altfel 0.8; geopolitică **0.8** (`GEO_RELEVANCE`, FD-IMPACT §2) dacă are termeni care mișcă piețele (război, sancțiuni, tarife, petrol, OPEC, alegeri, conflict, Strâmtoarea Hormuz, export controls…), altfel 0 + flag `lowRelevance`.
- **Impact** ∈ {1, 1.5, 2, 3}: 3 → Fed/FOMC/Powell/rate decision/CPI/inflation/payrolls/jobs report/recession/war/tariff/SEC+ETF/hack/exploit/liquidat/bankrupt/crash/default; 2 → BTC/ETH (detectate), ETF, regulation, yields, dollar, stablecoin, Treasury; 1.5 → monede din top 10; altfel 1.

### 5.5 Detectarea monedelor (`news/coins.ts`)
Dicționar = top 250 CoinGecko (nume, simbol) + watchlist (cu aliasuri) + suprascrieri manuale. Reguli:
- Nume: case-insensitive, granițe de cuvânt, cel mai lung întâi (span-urile potrivite nu se mai refolosesc).
- Simbol: doar MAJUSCULE exacte cu granițe (`\bSOL\b`) sau `$sol`/`$SOL`; lungime ≥ 3 (sau `$` explicit); listă neagră: `CEO, ETF, SEC, USD, USA, GDP, CPI, IPO, NFT, DAO, DEX, CEX, API, ATH, ONE, GAS, SUN, NEW, TOP, BIG, ALL, FOR, THE, AND, NOW, OUT, KEY, WIN, ACT, ME, AI, IT, US, UK, EU, UN, OK`.
- Nume ambigue (cuvinte englezești: `Near`, `Link`, `Stellar`, `Avalanche`…) → doar prin simbol, dacă nu sunt în watchlist cu alias explicit. Lista `AMBIGUOUS_NAMES`.
- Din lista CoinGecko se folosesc doar numele din mai multe cuvinte („Wrapped Bitcoin”); numele dintr-un singur cuvânt sunt prea des cuvinte obișnuite („Core”, „Sky”, „Quant”). Numele sigure sunt într-o listă curatoriată (`CORE_COINS`).
- Titlul și rezumatul se scanează separat; într-un text scris în mare parte cu MAJUSCULE („JUST IN: …”) simbolurile „goale” nu se mai caută (doar numele și `$TICKER`).
- Stablecoin-urile (USDT, USDC, DAI, FDUSD, TUSD, USDE) se detectează dar nu contează la „impact top 10”.

- **Acțiunile** favorite (FD-SENTIQ §4) intră în dicționar cu simbolul și aliasurile lor (numele companiei, editabil); se etichetează ca monedele (`news_coins`).

### 5.6 Clustering (`news/cluster.ts`)
Tokeni de titlu: lowercase, fără punctuație, fără stopwords, plural simplu (`s` final eliminat pentru cuvinte > 3 litere), numerele păstrate. Pentru fiecare item nou: candidați = știri din ultimele 36 h. `sim = |A∩B| / |A∪B|`. Dacă `sim ≥ 0.5`, sau `sim ≥ 0.34` și au aceleași monede ne-goale și un token numeric comun → același cluster (`cluster_id` = cel al candidatului cel mai similar; altfel `cluster_id = id`).

### 5.7 Ingestie
Într-o tranzacție per sursă: insert nou / update titlu (dacă s-a schimbat → `sentiment = NULL` pentru rescorare); `news_coins`; actualizarea stării sursei (`last_success_at`, `last_new_item_at`, `failures=0`, `next_fetch_at`, `etag`, `last_modified`). Interogarea listei (`news/query.ts`): paginare keyset `(published_at, id)`, clustere grupate, filtrele din FD §2.2.

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
- `@anthropic-ai/sdk`, `messages.parse` cu `output_config: {format: zodOutputFormat(schema), effort: 'low'}`, `max_tokens: 4096`, loturi de 25 de titluri numerotate. Modele: `claude-opus-5-5` (implicit), `claude-sonnet-5-5`, `claude-haiku-5-5`.
- Schema: `{results: [{n: int, score: number(−1..1), impact: 1|2|3}]}`; fiecare `n` din lot trebuie să aibă rezultat; lipsă → acele item-uri trec la motorul local. `impact` se salvează în `news.sentiment_impact` (FD-IMPACT).
- `stop_reason === 'refusal'` sau orice eroare → lotul trece pe motorul local (și se loghează). Pentru Opus / Sonnet 5.5 se trimite și `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`), dacă SDK-ul îl suportă pe calea `parse`.
- Cheia (a adminului) se citește decriptată doar în memorie, la crearea clientului.

### 6.4 Indicele zilei (`sentiment/daily-index.ts`) — funcție pură
Intrare: știrile cu `published_at ∈ [start, end)` și `published_at ≤ asOf`, `relevance > 0`, sursă activă, `sentiment != NULL`. Parametri impliciți: `halfLifeH=8, shrinkK=4, gamma=1.6, sourceCap=0.25, clusterBoost=0.5`.

Pentru fiecare știre *i*:
```
spec_i   = sponsored ? 0.2 : speculative ? 0.5 : recap ? 0.5 : 1
decay_i  = 0.5 ^ ((asOf − t_i) / halfLife)
base_i   = relevance_i · impact_i · sourceWeight_i · spec_i · decay_i     (impact_i: TD-IMPACT §4)
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
Ieșiri: `index, raw=S, confidence, counts{positive,neutral,negative,pending}, breakdown{crypto,macro,geopolitics,stocks}` (aceeași formulă pe subset), `drivers` (top 5 pozitive și top 5 negative după `w_i·s_i`, cu titlu/sursă/link), `intraday[]` (indicele recalculat la sfârșitul fiecărei ore trecute din zi).

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

### 7.4 Rezultatele companiilor (`calendar/service.ts`)
Pentru acțiunile din favoritele tuturor, calendarul de rezultate Nasdaq pe zilele lucrătoare următoare (o cerere pe zi), salvat în `calendar_raw` cu sursa `earn`: înainte de deschidere la 08:00 ET, după închidere la 16:30 ET, altfel toată ziua; EPS estimat și EPS-ul de anul trecut. Fiecare utilizator vede doar rezultatele acțiunilor lui (filtrul `calendar.earnings`).

## 8. Piață

### 8.1 Crypto (ccxt public, `market/market.ts`)
- Instanță ccxt cache-uită per exchange (`kucoin, binance, bybit, okx`), `enableRateLimit`, proxy din env; `loadMarkets()` memoizat (24 h).
- `getCandles(ex, symbol, tf, limit)`: cache în memorie (LRU), TTL 10 s (TF ≤ 15m) / 30 s; cereri identice simultane deduplicate; reîmprospătare incrementală (doar lumânările de la ultimul `open time`) cât cache-ul are < 1 h, altfel descărcare completă (`paginate` peste 1500). Rezultat sortat, fără duplicate, fără valori ne-finite.
- Răspuns: `{candles: [t,o,h,l,c,v][], pricePrecision, tickSize, lastClosedIndex, fetchedAt}`.
- Reîncercări și limitele exchange-ului (KuCoin `429000` etc.): TD-RATELIMIT.

### 8.2 Acțiuni (`market/stocks.ts`, TD-SENTIQ §5)
- **Nasdaq** (fără cheie): lumânări zilnice / săptămânale, cotații, căutare, informații despre companie, rezultate, starea bursei, graficul pe 60 de zile din bandă.
- **Twelve Data** (cheia adminului, plan gratuit 8 credite / minut și 800 / zi UTC, buget local persistat): lumânările 1m – 4h; fără 3m / 6h / 8h / 12h (se alege cel mai apropiat). În afara ședinței regulate nu se cer lumânări noi; la limită se servesc ultimele, cu ora revenirii.

### 8.3 Context
- Crypto: Fear & Greed (`api.alternative.me/fng`), CoinGecko `global` + `coins/markets` top 250.
- Acțiuni: Fear & Greed CNN (cu S&P 500 și VIX), Nasdaq 100, starea bursei (Nasdaq).
- Salvate în `market_cache`; la eroare se servește cache-ul cu `stale=true`.

### 8.4 Logo-uri
`GET /api/logo/:symbol`: SVG-ul monedei din `@web3icons/core`, servit la cerere (nu e inclus în pagină); fallback cu inițialele în UI. Logo-urile platformelor sunt în `public/provider-logos/`.

## 9. Portul Slingshot și LMA (`shared/indicator`)

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

### 9.4 LMA (`lma.ts`, `lma-params.ts`, TD-CHARTUX §2)
Portul [DI] Logarithmic Moving Average: linia de semnal, pragurile long / short / neutru, starea BULLISH / BEARISH / NEUTRAL, „Color Price Bars”; aceleași input-uri și valori implicite ca în TradingView. Desenat în panoul de jos al graficului.

## 10. Exchange-uri și brokeri (`exchange/`)
- **Platformele** (`shared/providers.ts`, FD-NOAPI): pentru fiecare, câmpurile cerute (cu validare), mediile (live / demo / paper), pașii pentru o cheie doar de citire, pagina cheilor, ce se citește și logo-ul. Doar platformele cu API.
- **Crypto** (KuCoin, Binance, Bybit, OKX, Kraken, Coinbase, Bitget): client ccxt privat (`adjustForTimeDifference`, proxy), cache-uit 10 min. `testAccount`: `fetchBalance()` + permisiunile cheii unde exchange-ul le spune (ex. KuCoin „General”, OKX `read_only`); orice drept peste citire → avertisment.
- **Brokeri** (`brokers.ts`): REST doar cu GET — Trading 212 (live / demo), eToro (real / demo), Interactive Brokers (Flex Web Service: cerere de raport + descărcare XML, ziua precedentă), Alpaca (live / paper). Aceleași forme de rânduri ca la crypto.
- `getPortfolio(accountId)` (cache 20 s, dedup): solduri, poziții, ordine deschise (inclusiv trigger / stop), tranzacțiile din 7 zile, evaluare în USDT / moneda contului; erorile izolate per secțiune; o secțiune eșuată păstrează ultimele date bune, cu ora (`stale`).
- KuCoin: conturi UTA și clasice (inclusiv HF), futures prin `kucoinfutures`.
- **Cost mediu spot** (`cost-basis.ts`, funcție pură): fills cotate în stablecoin, cronologic; buy → `qty += a, cost += a·p + fee`; sell → `cost −= a·avg, qty −= a` (min 0); dacă `qty_calc < 0.98·deținerea` → necunoscut (dacă nu există valoare manuală, care are prioritate).
- Erori mapate: `AUTH`, `PERMISSION`, `RATE_LIMIT` (reîncercări în `retry.ts`, TD-RATELIMIT), `NETWORK`, `MAINTENANCE`, `EXCHANGE`.

## 11. API HTTP (JSON)
Prefix `/api`; erorile au forma `{error: {code, message}}` cu 400 (validare), 401 (fără sesiune), 403 (rol / host / CSRF), 404, 409, 415, 429, 502 (sursă externă), 500.

| Grup | Rute | Acces |
|---|---|---|
| Stare | `GET /ping`; `GET /health` | public; admin |
| Autentificare | `GET /auth/state`; `POST /auth/setup`, `/auth/request-account`, `/auth/activate[/check]`, `/auth/login`, `/auth/login/2fa`, `/auth/logout`, `/auth/forgot`, `/auth/reset[/check]`, `/auth/passkey/options`, `/auth/passkey` | public |
| Contul meu | `GET /account`; `PUT /account/name`, `/account/password`; `POST /account/logout-all`; `GET /account/2fa`, `POST /account/2fa/start\|cancel\|enable\|disable\|recovery-codes`; `GET\|POST /account/passkeys`, `POST /account/passkeys/options`, `PUT\|DELETE /account/passkeys/:id` | utilizator |
| Admin | `GET /admin/users`, `POST /admin/users/:id/disable\|enable\|reset-2fa\|activation-link`, `DELETE /admin/users/:id`; `GET /admin/account-requests`, `POST /admin/account-requests/:id/approve`, `DELETE /admin/account-requests/:id` | admin |
| Sentiment | `GET /sentiment/today`, `/sentiment/history?days=30`, `/sentiment/day/:day`; `POST /sentiment/rescore`, `/sentiment/recompute-history` | utilizator; POST admin |
| Știri | `GET /news?range&coins&favorites&category&source&sentiment&q&cursor&limit` | utilizator |
| Surse | `GET /sources`; `POST /sources`, `/sources/test`; `PUT\|DELETE /sources/:id` | GET utilizator; restul admin |
| Calendar | `GET /calendar?from&to&impact&currencies`; `POST /calendar/custom`, `DELETE /calendar/custom/:id` | utilizator (evenimentele personale ale lui) |
| Economie | `GET /economy`, `/economy/description` | utilizator |
| Piață | `GET /market/candles`, `/market/symbols`, `/market/context`, `/logo/:symbol`; `GET /stocks/search\|info\|quotes\|spark` | utilizator |
| Scanner | `GET /scanner`; `POST /scanner/run` | utilizator |
| Favorite | `GET\|POST /watchlist`; `PUT /watchlist/order`; `PUT\|DELETE /watchlist/:coin` | utilizator |
| Conturi | `GET\|POST /accounts`; `DELETE /accounts/:id`; `POST /accounts/:id/test`; `GET /portfolio/:id`; `PUT /portfolio/:id/cost-basis/:asset` | utilizator (doar conturile lui) |
| Setări | `GET\|PUT /settings`; `PUT /settings/claude-key\|twelvedata-key\|resend` | utilizator (globalele doar admin, §12); cheile admin |
| Rezumat | `GET\|POST /summary` | utilizator |
| Connector | `GET /mcp/status`, `DELETE /mcp/connections/:id`; `GET\|POST /oauth/requests/:id` (consimțământul) | utilizator |

Connectorul, doar când e pornit (TD-MCP): `/mcp` (GET / POST / DELETE, Bearer), `/oauth/authorize`, `/oauth/token`, `/oauth/register`, `/oauth/revoke`, `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource[/mcp]`. Orice altă rută ne-`/api` → `index.html` (SPA).

## 12. Setări (`shared/settings.ts`, `server/settings.ts`)
```ts
{
  timezone: string /* IANA */, retentionDays: 7..365 (90),
  sentiment: {engine: 'local'|'claude', claudeModel: 'claude-opus-5-5'|'claude-sonnet-5-5'|'claude-haiku-5-5'},
  market: {exchange: 'kucoin'|'binance'|'bybit'|'okx', defaultTf: Tf ('1h'), candles: 1500|3000|5000},
  scanner: {tf: Tf ('1h')},
  calendar: {impacts: Impact[] (High, Medium), currencies: string[] (USD, EUR, GBP, JPY, CNY, ALL), earnings: boolean (true)},
  indicator: SlingshotParams, lma: LmaParams /* aceleași valori implicite ca în Pine */,
  charts: {symbol, showPositions, showLma, showSlingshot, lmaPane: 0.1..0.7 (0.25)}
}
```
- **Personale** (`user_settings`, câte un rând): `timezone, market, scanner, calendar, indicator, lma, charts`. **Globale** (`settings`, doar adminul le schimbă, altfel 403): `retentionDays, sentiment` și cheile (Claude, Twelve Data, Resend — criptate, în API doar `…KeySet` și un indiciu).
- `PUT /settings`: merge parțial, validare completă (zod), nimic salvat parțial.

## 13. Frontend
- Rute: `/` (Azi), `/news`, `/calendar`, `/economy`, `/charts[/:base/:quote | /s/:ticker]`, `/trades`, `/settings`, `/security`, `/health` și `/users` (admin); fără cont: `/login`, `/request-account`, `/activate`, `/forgot`, `/reset-password`, `/setup`; `/oauth/consent` (connectorul).
- Date: TanStack Query; polling (cât tab-ul e vizibil): știri, sentiment și calendar 60 s, lumânări 10 s (TF ≤ 15m) / 30 s / acțiuni 60 s, portofoliu 30 s, piață și bandă 1–10 min, Economie 5 min, Stare sistem 10 s, ping 15 s. O reîmprospătare eșuată nu șterge datele afișate; banner global când serverul nu răspunde.
- Client API: `fetch` cu `X-Sentiq: 1` pe mutații; un 401 trimite la login. `ErrorBoundary` pe pagină; o pagină încărcată la cerere care lipsește după o actualizare → o reîncărcare automată (`stale.ts`, FD-STALE).
- **Teme** (`styles.css`, TD-THEME, TD-THEME2): tokenuri Tailwind 4 (`--color-*`) pentru tema întunecată în `@theme`, cea luminoasă sub `:root[data-theme='light']`, „insula” barei (`.theme-bar` / `.theme-page`); `public/theme.js` aplică tema înainte de desen; `theme.ts` (localStorage `sentiq:theme`, sincronizare între taburi). Componentele folosesc doar tokenuri (accent `accent`, hover `hover`, rânduri `row-alt`); `palette.test.ts` verifică contrastul.
- Componente principale: `MarketStrip`, `CommandPalette`, `DaySummary`, `AccountWizard`, `ThemeToggle`, `CandleChart` (+ primitive), `SortableFavorites`, paginile din `pages/`.

## 14. Testare
- `shared/indicator`: primitive vs referință naivă (2000 de lumânări + cazuri limită); scenarii Slingshot (LONG, invalidare, TP, ATR TP / SL, Market Structure, HTF, 500 de etichete, istoric insuficient); semnalele 3.2 / 3.3 pe date reale; LMA.
- `news`, `sentiment`, `calendar`, `economy`: parser, normalizare, monede și acțiuni, cluster, clasificare, reguli (setul de 50), indicele zilnic (ponderi, plafon, cluster, DST, impactul Claude), potrivirea FF ↔ TV, rezultate, indicatori.
- `auth` și `http`: parole, TOTP, sesiuni, limitare, passkey, cereri de cont, activare, rolurile pe rute, Host / Origin / CSRF; rutele API cu `fastify.inject` pe DB temporară și rețea simulată; brokerii cu răspunsurile documentate.
- `mcp`: OAuth (DCR, PKCE, rotația tokenurilor) și instrumentele, cu clientul MCP oficial.
- `web`: formatare, iconițe, tema, paleta (contrast), reîncărcarea după actualizare, ordonarea favoritelor, PnL, magazinul de zoom; `build`: curățenia `dist`.
- Verificare manuală în Chrome (headless, CDP) pe o copie a datelor, în ambele teme, la 1440 și 390 px; smoke (`npm run smoke`) cu date reale.

## 15. Riscuri și conflicte cunoscute
| Risc | Atenuare |
|---|---|
| Endpoint-ul TradingView neoficial dispare | Calendarul merge doar cu FF (fără Actual); pagina Economie rămâne cu ultimele date; eroare în Stare sistem |
| FF blochează IP-ul | o cerere / oră, `blocked_until`, DB ca rezervă |
| Feed RSS mort / schimbat | sănătate per sursă, backoff, surse editabile |
| Modelul ML (170 MB) nu se descarcă | motor `rules`, reîncercare la 30 min, rescorare la recuperare |
| Diferențe față de TradingView în primele bare | documentat (FD §5.2); semnalele recente coincid |
| Versiuni noi ale indicatorilor Pine | porturile sunt izolate în `shared/indicator`; testele de scenariu descriu comportamentul |
| Exchange-urile / brokerii își schimbă API-ul | ccxt actualizat; brokerii testați pe răspunsurile documentate; erori clare per secțiune |
| Limitele Twelve Data | buget local, fără cereri în afara ședinței, ultimele lumânări + ora revenirii |
| Ceas local decalat | `adjustForTimeDifference` (exchange); TOTP ±1 pas |
| Fus orar schimbat | indicii sunt per `(day, tz)` |
| Pierderea `data/master.key` | cheile salvate nu mai pot fi citite (se reintroduc); documentat în ghid |

## 16. Economie (`economy/`, TD-ECON)
Indicatorii din calendarul TradingView pentru țările din `TV_COUNTRIES` (`econ_indicators`, `econ_releases`): istoricul (~400 de zile) se citește o dată (job `econ.history`), valorile noi vin din citirile calendarului (`calendar.tv`), calendarul publicărilor zilnic. Grupele, „Esențialele”, polaritatea (bun / rău pentru economie) și numele în română: `economy/names.ts`; descrierea sursei la cerere (`/api/economy/description`).

## 17. Rezumatul zilei (`summary/`, TD-SUMMARY)
`summary/context.ts` adună datele zilei utilizatorului (sentimentul, titlurile, calendarul, indicatorii publicați, contextul pieței, favoritele); `summary/service.ts` cere lui Claude (`claude-opus-5-5`, cheia adminului, structured output) verdictul, secțiunile și alegerea a 0–4 grafice din lista celor disponibile (cifrele graficelor sunt ale aplicației). Ultimul rezumat se ține per utilizator și zi (`day_summaries`); o cerere nouă cel mult la 2 minute.

## 18. Connectorul Claude (`mcp/`, TD-MCP)
- Pornit doar cu `SENTIQ_MCP=1` și `SENTIQ_PUBLIC_URL` valid; altfel rutele lipsesc.
- OAuth 2.1 (`mcp/oauth.ts`): clienți prin CIMD (documentul publicat de Claude) sau DCR, doar de la gazdele din `SENTIQ_MCP_CLIENTS` (implicit `claude.ai, claude.com`); PKCE S256; consimțământul în pagina Sentiq; cod 60 s, access token 1 h, refresh 30 de zile cu rotație; doar hash-uri în DB.
- Serverul MCP (`mcp/server.ts`, fără stare, câte unul pe cerere, pentru utilizatorul tokenului): instrumentele `get_day_overview`, `get_sentiment`, `search_news`, `get_calendar`, `get_economy`, `get_watchlist`, `get_chart`, `get_market_context` și prompturile `day_summary`, `analyze_symbol`; doar citire, doar datele utilizatorului.

---

# Partea a II-a — Istoricul

Secțiunile de mai jos au fost scrise pentru fiecare schimbare și descriu implementarea de atunci; Partea I spune ce e valabil azi. Înlocuite ulterior: v1 (`127.0.0.1`, fără login, doar KuCoin, meniu lateral, paleta inițială) → Partea I; TD-REDESIGN (numele tokenului `brass`) → TD-THEME2 (`accent`); TD-SENTIQ (lista de platforme cu XTB, Tradeville, Revolut, Degiro și câmpul `available`) → TD-NOAPI; TD-USERS (înregistrarea și confirmarea emailului) → TD-INVITE; TD-SENTIQ (scurtătura `scripts/kryptoniq.sh`) și TD-LAUNCH (`kryptoniq.sh`, `Kryptoniq.app`) → `scripts/sentiq.sh`, `Sentiq.app`.

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

---

## TD-SENTIQ — implementează FD-SENTIQ

### 1. Redenumire
- **Interfață:**
  - `index.html` `<title>Sentiq</title>`; în meniu, iconița Sentiq și „Sentiq”;
  - **iconița** (13 oct 2026, de la utilizator): sursa `public/Sentiq-iOS-Default-1024@1x.png` (+ `Sentiq.icon`, proiectul Icon Composer) e redusă (Lanczos, RGBA pe 8 biți) în `public/brand/`: `favicon-16/32/48.png` (tab-ul browserului), `sentiq-64.png` (meniul, afișată la 28 px), `apple-touch-icon.png` (180 px, colțurile umplute cu `#07090E`, pentru ecranul principal / „Add to Dock”);
  - ⌘K: „Caută în Sentiq”; bannerul offline, Tranzacții, `ErrorBoundary` și comentariile spun „Sentiq”.
- **Antetul CSRF:** clientul trimite `X-Sentiq: 1`; serverul acceptă `X-Sentiq` **sau** `X-Kryptoniq`, ca o filă deschisă înaintea actualizării să poată salva în continuare. Mesajul de eroare spune „Lipsește header-ul X-Sentiq”.
- **Config:**
  - `env.SENTIQ_X ?? env.KRYPTONIQ_X` pentru `DATA_DIR`, `PORT`, `QUIET`, `DISABLE_JOBS`, `MASTER_KEY`;
  - baza de date: `data/kryptoniq.db` dacă există (instalări existente), altfel `data/sentiq.db`;
  - `master.key` rămâne neschimbat;
  - `USER_AGENT` `… Sentiq/0.2`.
- **Jurnale:** fișierul zilei devine `sentiq-YYYY-MM-DD.log`; curățarea șterge ambele prefixe (`/^(sentiq|kryptoniq)-…\.log$/`).
- **Lansator:**
  - `scripts/sentiq.sh`: conținutul lui `kryptoniq.sh`, cu numele noi. Fișierul PID e `data/sentiq.pid`, dar oprirea recunoaște și un `kryptoniq.pid` rămas de la o versiune veche. Aplicația generată e `Sentiq.app`, iar jurnalul lansatorului e `data/logs/launcher.log`, neschimbat.
  - `scripts/kryptoniq.sh` devine: `exec "$(cd "$(dirname "$0")" && pwd)/sentiq.sh" "$@"`.
  - `.gitignore`: `Sentiq.app/`.
  - **Iconița aplicației** (13 oct 2026): `scripts/app-icon/Assets.car` (catalogul cu iconița Icon Composer, pentru macOS 26+) și `Sentiq.icns` (pentru sistemele mai vechi), compilate de `scripts/app-icon/build.sh` (`actool`, are nevoie de Xcode) din `src/web/public/Sentiq.icon`. `sentiq.sh app` le copiază în `Contents/Resources`, scoate `applet.icns`, setează `CFBundleIconFile` / `CFBundleIconName` = `Sentiq` înainte de semnare și atinge pachetul ca Finder și Dock să recitească iconița; fără fișiere, aplicația păstrează iconița generică și scriptul spune asta. Fișierele compilate sunt în repo, deci regenerarea aplicației nu cere Xcode.
- **Browser:**
  - `localStorage['sentiq.chartViews']`, cu migrare unică din `kryptoniq.chartViews` (citire, apoi scriere sub cheia nouă);
  - evenimentul `sentiq:exit-fullscreen`.
- **Altele:**
  - `package.json` `name: "sentiq"`;
  - `scripts/smoke.ts` cere `SENTIQ_DATA_DIR`, cu `KRYPTONIQ_DATA_DIR` acceptat ca înainte;
  - README și ghidul utilizatorului.
  - Folderul proiectului rămâne `Kryptoniq`, pentru că nu face parte din aplicație.

### 2. Migrarea bazei de date (migrarea 2)
Runner-ul (`Db.migrate`) rulează migrările cu `PRAGMA foreign_keys = OFF`, iar după ultima rulează `PRAGMA foreign_key_check`, care trebuie să fie gol, apoi `foreign_keys = ON`. Altfel, `DROP TABLE sources` din procedura SQLite de reconstruire ar șterge în cascadă știrile.

```sql
-- conturi: credențiale generice (JSON criptat) și mediu
ALTER TABLE exchange_accounts ADD COLUMN credentials TEXT;   -- box.encrypt(JSON.stringify({ field: value }))
ALTER TABLE exchange_accounts ADD COLUMN env TEXT NOT NULL DEFAULT 'live';
-- favorite: tipul și datele acțiunii
ALTER TABLE watchlist ADD COLUMN kind TEXT NOT NULL DEFAULT 'crypto';  -- 'crypto' | 'stock'
ALTER TABLE watchlist ADD COLUMN name TEXT;
ALTER TABLE watchlist ADD COLUMN exchange TEXT;
-- surse: categoria nouă 'stocks' (CHECK nu se poate modifica: reconstruirea în 12 pași)
CREATE TABLE sources_new ( …aceleași coloane…, category TEXT NOT NULL CHECK (category IN ('crypto','macro','geopolitics','stocks')), auto TEXT );
INSERT INTO sources_new SELECT …, NULL FROM sources;
DROP TABLE sources;
ALTER TABLE sources_new RENAME TO sources;
```
- `sources.auto`: sursele administrate automat. `nasdaq:<SYM>` pentru favoritele-acțiuni, ascunse din lista editabilă.
- Rândurile vechi din `exchange_accounts` (KuCoin) se citesc din `api_key` / `secret` / `password` cât timp `credentials` e NULL. Conturile noi scriu `credentials` și pun `''` în coloanele vechi, care au `NOT NULL`.

### 3. Furnizorii (`shared/providers.ts`)
```ts
interface ProviderField { key: string; label: string; secret?: boolean; multiline?: boolean; placeholder?: string; pattern?: string; help?: string }
interface ProviderDef {
  id: 'kucoin'|'binance'|'bybit'|'okx'|'kraken'|'coinbase'|'bitget'|'trading212'|'etoro'|'ibkr'|'alpaca'|'xtb'|'tradeville'|'revolut'|'degiro';
  name: string; kind: 'crypto'|'stocks'; available: boolean; unavailableReason?: string;
  fields: ProviderField[]; envs?: { id: string; label: string }[];
  steps: string[]; keysUrl?: string; reads: string; logo: string /* /provider-logos/<id>.(svg|png) */;
}
```
- **Validarea pe server:** zod, construit din câmpurile furnizorului (șiruri trim, lungime 4–4000, pentru PEM-ul Coinbase) + `label` + `env` din listă.
- `key_hint` = `secretHint` pe primul câmp.
- **Logo-uri:**
  - în `src/web/public/provider-logos/` (servite din `dist/web`, `immutable`);
  - exchange-urile crypto: SVG din `@web3icons/core/dist/svgs/exchanges/background/<id>.svg` (varianta cu fundal: pe tema închisă, logo-urile negre OKX / Bybit din varianta `branded` nu se văd), copiate o dată în `src/web/public/provider-logos/`;
  - brokerii: PNG-urile oficiale descărcate în cercetare (IBKR, Trading 212, eToro, Alpaca, XTB, Tradeville), plus `simple-icons` pentru Revolut și o descărcare pentru Degiro;
  - lipsă → insignă cu inițiale.

### 4. Adaptoarele de portofoliu (`server/exchange/adapters/*.ts`)
```ts
interface PortfolioAdapter {
  test(): Promise<{ permissions: string | null }>;   // aruncă ProviderError(code, message)
  load(prev: LastGood): Promise<Omit<Portfolio, 'accountId' | 'fetchedAt'>>;
}
```
`AccountsService` păstrează ce are acum: cache 20 s, dedup, ultimele date bune pe secțiuni, maparea erorilor, ștergerea clientului la AUTH. Alege adaptorul după `exchange`.

- **kucoin**: logica actuală mutată fără schimbări de comportament (UTA / clasic / HF, prețuri comune, reîncercări).
- **ccxt** (binance, bybit, okx, kraken, coinbase, bitget):
  - client `new ccxt[id]({ apiKey, secret, password, enableRateLimit, options: { adjustForTimeDifference } })`;
  - `ensureMarkets`, apoi `fetchBalance()` (pentru Bybit `{ type: 'unified' }`, cu rezervă `{}`);
  - `fetchPositions()` când `has.fetchPositions`, ignorat dacă dă NotSupported;
  - `fetchOpenOrders()` fără simbol; pentru Binance `options.warnOnFetchOpenOrdersWithoutSymbol = false`;
  - `fetchMyTrades(sym, since, 100)` pentru perechile `<ACTIV>/USDT` ale activelor deținute + favorite (maximum 25, ca la HF);
  - prețurile din `fetchTickers` (cache 15 s per exchange, aceeași rezervă ca la KuCoin);
  - costul mediu, cu `costBasis` din tranzacții;
  - `test()`: `fetchBalance()`.
- **trading212** (`fetch`, Basic):
  - `GET /equity/account/summary` (rezervă: `/equity/account/cash` + `/equity/account/info`) pentru moneda contului și numerar;
  - `GET /equity/positions`: `ticker` (`AAPL_US_EQ` → `AAPL`), `quantity`, `averagePrice`, `currentPrice`, `ppl`;
  - `GET /equity/orders` pentru ordinele în așteptare;
  - `GET /equity/history/orders?limit=50`, primele 2 pagini, filtrate pe 7 zile, pentru tranzacții;
  - pacing: o cerere / s pe cont, serializată; 429 → `RATE_LIMIT`, cu retry după `x-ratelimit-reset`;
  - 401 → AUTH; 403 → PERMISSION, cu mesajul „activează permisiunea <scope> la cheie”.
- **etoro**:
  - `GET /api/v1/trading/info/{real|demo}/pnl`, cu antetele `x-api-key`, `x-user-key`, `x-request-id`;
  - simbolurile: `GET /api/v2/market-data/instruments?instrumentsIds=…` (în loturi de 100, cache 24 h în `market_cache`);
  - pozițiile cu `leverage === 1 && isBuy` → dețineri (cantitate = `units`, preț mediu = `openRate`, preț = `unrealizedPnL.closeRate`, PnL = `unrealizedPnL.pnL`);
  - restul → poziții (`side`, `leverage`, `stopLossRate`, `takeProfitRate`, care devin ordinele SL / TP pentru liniile de pe grafic, `stop` dedus);
  - `orders` / `entryOrders` → ordine; `mirrors` → pozițiile marcate „copiat de la <parentUsername>”;
  - numerarul: `credit`.
- **ibkr** (Flex):
  - `SendRequest` (`https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest?t=&q=&v=3`) → `ReferenceCode` + `Url`;
  - `GET <Url>?t=&q=<ref>&v=3`, reîncercat la 1 s (cel mult 20 de încercări) cât timp răspunsul e „in progress” (cod 1019);
  - parsarea XML (fără dependență nouă: un parser mic de elemente cu atribute; Flex pune datele în atribute):
    - `OpenPosition` (`symbol`, `assetCategory`, `position`, `costBasisPrice`, `markPrice`, `fifoPnlUnrealized`, `currency`, `side`);
    - `Trade` (`symbol`, `buySell`, `quantity`, `tradePrice`, `dateTime`, `ibCommission`);
    - `CashReportCurrency`;
  - `STK`/`ETF` long → dețineri; restul (`OPT`, `FUT`, short) → poziții;
  - cache 15 min (limita IBKR e 10 cereri / min);
  - **erori:** 1012 / 1015 → AUTH (token expirat / invalid); 1014 → „Query ID invalid”; 1018 → `RATE_LIMIT`;
  - lipsa secțiunii `OpenPositions` → `EXCHANGE` cu mesajul secțiunilor de bifat;
  - **data raportului:** `FlexStatement@toDate`, pusă în `asOf`.
- **alpaca**:
  - `GET /v2/account` (`currency`, `cash`, `equity`);
  - `GET /v2/positions` (`symbol`, `qty`, `avg_entry_price`, `current_price`, `unrealized_pl`, `side`);
  - `GET /v2/orders?status=open&limit=200` (`type`, `stop_price`, `limit_price`, `side`; `stop` din tip și sens);
  - `GET /v2/account/activities/FILL?after=<7 zile>`;
  - 401 / 403 → AUTH, cu mesajul despre Live / Paper.

**`Portfolio` se extinde:**
- `currency` (moneda valorilor);
- `asOf?: number` (IBKR);
- `kind: 'crypto' | 'stocks'`;
- `BalanceRow.avgSource` primește `'broker'`;
- `BalanceRow.note?` (ex. „copiat de la …”);
- `PositionRow` rămâne.

Tranzacții afișează titlurile după tip: „Dețineri” / „Poziții” la acțiuni, „Dețineri spot” / „Poziții futures” la crypto.

### 5. Date de piață pentru acțiuni (`server/market/stocks.ts`)
- **`NasdaqClient`** (`api.nasdaq.com`, User-Agent de browser, `Accept: application/json`):
  - `quote(sym)` → `{ last, change, changePct, marketStatus }`;
  - `daily(sym, from, to)` (istoric, maximum 10 ani, paginat după `limit`);
  - `intradayToday(sym)` (`/chart`);
  - `search(q)` (`/autocomplete/slookup/10`);
  - `earnings(date)`;
  - `marketInfo()` (`marketIndicator`, orele de deschidere / închidere);
  - indicele NDX (`/quote/NDX/info?assetclass=index`).
  - Prețurile vin ca șir (`"$340.97"`, `"25,900,600"`) și se curăță.
- **`TwelveDataClient`** (cheia criptată, salvată ca cheia Claude în tabela `settings`, sub `twelvedata_key`):
  - `timeSeries(sym, interval, outputsize ≤ 5000)` → candele (`datetime` în fusul bursei, convertit cu `exchange_timezone`);
  - `symbolSearch(q)` (gratuit);
  - `quote` nu se folosește (consumă credite).
- **Bugetul:** `CreditBudget` (8 / min glisant, 800 / zi UTC):
  - o cerere peste buget → `MarketError('EXCHANGE_ERROR', „limita … a fost atinsă; revine …”)`, cu ora de revenire;
  - o eroare `429` / `code: 429` de la Twelve Data → pauză până la minutul următor;
  - consumul apare în `/api/health`.
- **`StockData.candles(sym, tf, count)`:**
  - `tf` în `TD_INTERVALS` (1m→`1min`, 5m, 15m, 30m, 1h, 2h, 4h, 1d→`1day`, 1w→`1week`);
  - cu cheie → Twelve Data; fără cheie → Nasdaq pentru 1d / 1w (1w agregat din zilnic, cu săptămâna începând luni), altfel `MarketError('UNSUPPORTED_TIMEFRAME')` cu mesajul care cere cheia;
  - **cache:** TTL 60 s pentru tf ≤ 1h, 5 min pentru 2h–4h, 15 min pentru 1d / 1w; lumânările citite în afara ședinței regulate (pre-market, after-hours, noapte, weekend, sărbători; starea din `marketInfo`, recitită la 5 min) rămân valabile până la deschidere, fiindcă sursele dau doar barele ședinței regulate;
  - starea bursei contează doar dacă Nasdaq a confirmat-o în ultimele 15 min (`confirmedStatus`); altfel e „necunoscută” și se aplică TTL-ul normal (la fel pentru scanner, contextul din bandă și `/api/stocks/info`);
  - aceeași formă `CandlesResult` (`exchange: 'twelvedata' | 'nasdaq'`, `pricePrecision`: 2, sau 4 sub 1 $), `lastClosedIndex` din durata barei;
  - când sursa refuză (buget, rețea) și există lumânări în cache, acestea se întorc cu `notice` = motivul (graficul îl afișează);
  - lumânarea zilei în curs e inclusă.
- **Rute:**
  - `GET /api/market/candles?asset=stock&symbol=AAPL&tf=1h&limit=…` (fără `asset` → crypto, ca acum);
  - `GET /api/stocks/info` (timeframe-urile sursei, dacă e cheia, starea bursei, bugetul Twelve Data);
  - `GET /api/stocks/quotes?symbols=AAPL,MSFT` (Nasdaq, cache 60 s, 15 min cu bursa închisă; maximum 50, câte 5 în paralel; un simbol care eșuează vine cu `error`);
  - `GET /api/stocks/search?q=apple` (Twelve Data dacă există cheia, altfel Nasdaq; filtrat pe SUA);
  - `GET /api/stocks/spark?symbol=AAPL` (zilnic 60 de zile, Nasdaq, cache 1 h);
  - `PUT /api/settings/twelvedata-key` (formatul se verifică local, apoi cheia cu `time_series AAPL 1day outputsize=1`; cheia greșită → 400).
- **Contextul de piață** (jobul `market.context`):
  - CNN `production.dataviz.cnn.io/index/fearandgreed/graphdata`, cu `Referer` / `Origin` CNN: scorul, ratingul, `market_momentum_sp500` (ultima valoare S&P 500) și `market_volatility_vix`;
  - Nasdaq NDX;
  - `marketInfo` la 5 min, într-un job nou, `stocks.market`.
  - Totul ajunge în `market_cache` (`stocks:fng`, `stocks:indices`, `stocks:market`); `readContext` le întoarce în `stocks`.

### 6. Favorite, știri, calendar, scanner
- **Favorite:**
  - `POST /api/watchlist` primește `kind: 'crypto' | 'stock'` (fără `kind` → crypto, pentru clienții vechi); la acțiuni `{ coin: 'AAPL', name, exchange }`, cu `quote` fix `USD`;
  - regex simbol: `^[A-Z][A-Z0-9.\-]{0,9}$` (BRK.B); rutele care adresează un rând existent (PUT, DELETE, ordine) acceptă ambele tipuri;
  - conflict pe `coin` → 409 „AAPL este deja în favorite (ca acțiune / monedă)”; maximum 50 în total;
  - aliasurile implicite (`defaultStockAliases`): numele curățat (`cleanCompanyName` scoate `Inc.`, `Corp.`, `Common Stock`, `Class A`, `(The)` …) plus primul cuvânt, când al doilea e generic („Palantir Technologies” → „Palantir”) și primul nu e un cuvânt comun („General Motors” rămâne întreg).
- **Sursele `nasdaq:<SYM>`:** `syncStockSources(db, added?)` rulează după fiecare schimbare a favoritelor, la pornire și în jobul de întreținere:
  - creează sursa (`category 'stocks'`, `auto = 'nasdaq:SYM'`, `builtin = 1`, id `nasdaq-<sym>`) dacă nu există deja un feed cu aceeași adresă;
  - o reactivează doar când acțiunea tocmai a fost adăugată (o sursă dezactivată de utilizator rămâne dezactivată);
  - la scoaterea acțiunii: o șterge dacă nu mai are știri (altfel `ON DELETE CASCADE` le-ar șterge), altfel o dezactivează până le scoate retenția.
  - Sursele noi `nasdaq-stocks`, `investing-stocks` (news_25), `cnbc-business` au `category 'stocks'`.
- **Detector (`CoinDetector`, al treilea parametru: acțiunile favorite → aliasuri):**
  - numele companiilor se potrivesc în forma lor, cu majuscule sau Title Case („NVIDIA” → „Nvidia”), niciodată cu litere mici („apple pie”, „target” nu);
  - `$AAPL`, `$F`, `$BRK.B` și `(NASDAQ: AAPL)` / `NYSE:BRK.B` se acceptă mereu;
  - simbolul simplu (`AAPL`, `BRK.B`, minimum 2 litere) se acceptă în afara `SYMBOL_BLACKLIST` (deci `AI`, `NOW` scrise simplu rămân cuvinte) și în afara titlurilor scrise integral cu majuscule;
  - **`INDEX_TICKERS`** (`SPX`, `NDX`, `VIX`, `DJI`, `DXY` …): știrile despre acțiuni scriu `$SPX` pentru S&P 500; nu se mai etichetează ca monedă (SPX6900) decât dacă e în favorite;
  - eticheta merge în `news_coins` (simbolul e unic între tipuri).
- **Știri și sentiment:**
  - `classify`: `stocks` → `relevance 1` când știrea are o acțiune etichetată sau termeni de piață, altfel `0.8` (feed-urile bursiere au și articole despre mărfuri);
  - `newsQuerySchema.category` și rutele surselor primesc `'stocks'`;
  - `daily-index` adaugă `'stocks'` în defalcare (zilele salvate înainte nu o au; interfața arată „—”);
  - `icons.ts`: categoria `stocks` → topicul `earnings`; eticheta unei acțiuni favorite = insigna pătrată cu inițiale (`CoinLogo badge square`), prin `useStockSet()`.
- **Calendar:**
  - sursa nouă `earn` în `calendar_raw`, cu jobul `calendar.earnings` (la 6 h, primul la 30 s; o cerere Nasdaq pe zi lucrătoare, 10 zile lucrătoare din ziua curentă de la New York);
  - se păstrează doar simbolurile favorite; fiecare zi se înlocuiește doar dacă cererea ei a reușit; evenimentele viitoare ale simbolurilor scoase se șterg; dacă toate zilele eșuează, jobul raportează eroarea;
  - `ext_id` `SYM:YYYY-MM-DD`, `period` `pre|after|unknown` + trimestrul (`Sep/2026`);
  - la citire: titlul „Rezultate trimestriale <nume curățat>”, `currency` = simbolul (eticheta din colț), nota în română (ora, trimestrul „septembrie 2026”, ce înseamnă Prognoză / Anterior), doar pentru acțiunile aflate acum în favorite;
  - ora: pre-market → 08:00 ET, after-hours → 16:30 ET, altfel toată ziua;
  - `forecast` = `epsForecast`, `previous` = `lastYearEPS`, `impact 'High'`;
  - filtrul: setarea `calendar.earnings` (implicit `true`), parametrul `earnings=0|1`; evenimentele `earn` ignoră filtrul de valute, dar respectă impactul;
  - `nextImportant` (rafalele TradingView) ignoră `earn`.
- **Context de piață (`server/market/stock-context.ts`, jobul `stocks.market`, la 5 min):**
  - starea bursei la fiecare rulare; CNN și NDX la fiecare rulare cât bursa e în pre-market / deschisă / after-hours, altfel o dată pe oră;
  - CNN: scorul, ratingul, istoricul pe 31 de zile (o valoare pe zi), S&P 500 și VIX (ultima valoare și variația față de ziua anterioară);
  - o sursă căzută își păstrează ultima valoare; `readContext(db).stocks = { fearGreed, indices, market }`.
- **Scanner:**
  - rândurile acțiunilor (`kind 'stock'`, `symbol 'AAPL/USD'`) se calculează cu `StockData` pe `scanner.tf`, dacă e suportat (altfel `1d`, cu avertismentul `STOCK_TF_FALLBACK`);
  - doar dacă trecuseră 30 min de la ultima lor rulare și bursa e deschisă, sau ultima rulare a fost înaintea închiderii de azi;
  - altfel se refolosesc rândurile vechi.

### 7. Interfață
- **Wizard (`components/AccountWizard.tsx`):** dialog modal, cu focus capturat și Esc.
  - pas 1: grila cu filtre;
  - pas 2: instrucțiuni + formular generat din `ProviderDef`;
  - pas 3: `POST /api/accounts` → `test()`; permisiunile cheii se citesc unde exchange-ul le spune (`keyPermissions`: KuCoin `GET /api/v1/user/api-key`, Binance `/sapi/v1/account/apiRestrictions`, Bybit `/v5/user/query-api`, OKX `/api/v5/account/config` → `perm`, Bitget `authorities`, doar numele recunoscute); orice permisiune în afara citirii aduce avertismentul.
  - Folosit în Setări (lista cu logo-uri) și în Tranzacții.
- **Logo-ul furnizorului:** `<ProviderLogo id>` (`img`, cu insignă la eroare).
- **Adrese (`chart/paths.ts`):** `/charts/s/:ticker` (rută `caseSensitive`: `/charts/S/USDT` rămâne perechea Sonic), `chartPathOf`, `rememberedPath`, `stockTimeframe` (timeframe-ul cel mai apropiat pe care sursa îl are; la egalitate cel mai lung).
- **Favorite (Setări):** comutator Crypto / Acțiuni; la acțiuni, căutarea trece prin `/api/stocks/search`; în tabel, coloanele Tip și Pereche / bursă; câmpul „Cheie Twelve Data” (verificată la salvare, cu consumul zilei), secțiunea are ancora `#market`.
- **Grafice:**
  - `ChartView stock` → `/api/market/candles?asset=stock`, reîmprospătare la 60 s (serverul ține cache-ul);
  - timeframe-urile nesuportate sunt `disabled`, cu `title`; dacă cel salvat lipsește, se arată cel mai apropiat și o notă cu linkul spre Setări (cel salvat rămâne pentru monede);
  - `viewKey` `stock|AAPL|1h`; `charts.symbol` acceptă `stock:AAPL`;
  - antet: insigna, numele companiei, variația zilei (Nasdaq), sursa („Twelve Data” / „Nasdaq”) și starea bursei; „Date vechi” nu apare cât bursa e închisă;
  - PnL: se cer doar portofoliile conturilor potrivite (brokeri pe acțiuni, exchange-uri pe monede), simbolul `AAPL/USD`, intrarea „Intrare 3 AAPL” (fără „spot”).
- **⌘K:** grupurile „Favorite” (monede și acțiuni, caută și în nume) și „Acțiuni” (`/api/stocks/search` de la 2 caractere).
- **Banda și Azi:** `useStockQuotes` (o cerere pentru toate, 60 s) + `useStockSparks` (60 de închideri zilnice, 1 h); variația afișată e cea a zilei; „închis” când bursa e închisă; contextul adaugă bursa SUA (cu numărătoare inversă), S&P 500, Nasdaq 100, VIX (roșu când crește) și F&G acțiuni; Azi are defalcarea „Acțiuni”.
- **Știri:** filtrul „Acțiuni”, acțiunile favorite printre cipuri.
- **Calendar:** cipul „Rezultate companii” (iconița `Building2`, tipul de eveniment `earnings`).
- **Stare sistem:** joburile noi și consumul Twelve Data.

### 8. Teste
- **Adaptoare:** `fetch` fals (răspunsurile documentate) pentru T212, eToro, Alpaca și IBKR (XML real de formă Flex), plus ccxt fals pentru adaptorul generic. Cazuri: mapare, erori (401 / 403 / 429 / 1012 / 1019 → reîncercare), monede, copy trading.
- **Migrarea 2** pe o bază v1 cu date: știrile rămân, iar sursele primesc `category stocks` permis.
- **Furnizori:** validare per câmpuri; contul KuCoin vechi se citește.
- **`stocks.test.ts`:** nume de companii și aliasuri, parsarea Nasdaq (șiruri cu $ și virgule, ore ET peste DST), săptămânal din zilnic, bugetul (8 / min, 800 / zi, persistat, ziua UTC), Twelve Data (fusul bursei, erori 401 / 400 / 429, căutarea filtrată pe SUA), `StockData` (cheia cerută pe intraday, cache, date vechi la eroare, bursa închisă), contextul CNN / NDX.
- **Detector:** nume în forma lor / Title Case, nu cu litere mici; `$F`, `(NYSE: BRK.B)`; `AI` / `NOW` simple nu; `$SPX` nu e moneda SPX6900.
- **Surse automate:** creare, dezactivare păstrată, reactivare la re-adăugare, ștergere doar fără știri, fără dubluri.
- **Calendar:** zilele lucrătoare la New York, orele 08:00 / 16:30 ET, doar favorite, zi eșuată păstrată, filtrul `earnings`, rafalele TradingView neafectate.
- **Rute:** favorite cu acțiuni (BRK.B), lumânări zilnice fără cheie, cotații cu rând de eroare, cheia Twelve Data verificată, `stock:AAPL` în setări.
- **Interfață:** adrese și timeframe-ul cel mai apropiat, iconițele, PnL pe acțiuni.
- **Redenumire:** CSRF cu ambele antete, env vechi, prefixele de jurnal.
- **CDP:** wizard-ul, favorite cu o acțiune (căutare „Microsoft” → MSFT, alias „Microsoft”), graficul TSLA din ⌘K (Nasdaq 1d, timeframe-uri dezactivate), MSFT din căutarea graficului, `/charts/S/USDT` rămâne Sonic, PnL pe AAPL cu un cont Trading 212 simulat, calendarul cu și fără rezultate, 1440 și 390 px.

### 9. Riscuri
- API-urile neoficiale Nasdaq și CNN se pot schimba sau bloca. Sunt izolate în clienți; erorile apar în Stare sistem, iar interfața arată ultimele date.
- Twelve Data, planul gratuit: limitele pot schimba disponibilitatea (bugetul e verificat local).
- Brokerii (T212 beta, eToro nou) își pot schimba API-urile; adaptoarele validează răspunsurile cu zod și dau „răspuns neașteptat de la <broker>” în loc să cadă.
- Nu am putut testa adaptoarele pe conturi reale: testele folosesc răspunsurile documentate, iar prima conectare reală e verificarea finală. Ghidul spune asta.

---

## TD-CHARTFAV — implementează FD-CHARTFAV

### 1. Slingshot pornit / oprit
- `shared/settings.ts`: `charts.showSlingshot: z.boolean().default(true)` (setările vechi primesc `true`).
- `Charts.tsx`:
  - bifa „Slingshot” lângă „LMA”, salvată ca celelalte (`remember({ charts: { showSlingshot } })`, optimist);
  - `CandleChart` primește `result={prefs.showSlingshot ? result : null}`: ramura existentă `result === null` golește mediile, norul, triunghiurile și segmentele (ATR + MS);
  - caseta TP / SL (`mainOverlay`) doar când Slingshot e pornit;
  - calculul (`runSlingshot`, lumânările HTF) rămâne, pentru panourile „Semnale” și „Alerte”;
  - `DEFAULT_CHART_PREFS.showSlingshot = true` (server vechi).
- Fără schimbări în `CandleChart` și în server.

### 2. Reordonare prin tragere
- Biblioteca **`@dnd-kit/core` 6.3.1 + `@dnd-kit/sortable` 10.0.0 + `@dnd-kit/utilities` 3.2.2** (stabile; React ≥ 16.8; mouse, touch, animații de sortare, liste pe mai multe rânduri cu `rectSortingStrategy`). Puse în `devDependencies`, ca restul bibliotecilor de interfață.
- **Senzori:** `MouseSensor` (pornește după 6 px de mișcare, deci click-ul rămâne click) și `TouchSensor` (ținut apăsat 250 ms, toleranță 6 px, deci derularea paginii merge). Fără `KeyboardSensor`: el pornește tragerea la Space / Enter și ar bloca deschiderea graficului de pe cip; tastatura folosește Alt + ← / →.
- **`hooks.ts` → `useReorderWatchlist().save(coins)`:** pune imediat noua ordine în `['watchlist']` (`orderWatchlist`), apoi `PUT /api/watchlist/order` cu lista completă. Salvările au `scope` comun, deci pleacă una după alta, în ordinea mutărilor; răspunsul unei salvări nu suprascrie ecranul cât mai așteaptă alta; la eroare lista se recitește de pe server.
- **Mutările se calculează din ultima ordine** (un ref actualizat la fiecare mutare și la fiecare listă nouă primită), nu din lista randată: apăsările rapide de Alt + → se adună.
- Avertismentele despre liniile Market Structure (HTF indisponibil, sursa acțiunilor fără `msTf`) apar doar cu Slingshot pornit.
- **`components/SortableFavorites.tsx`:** `DndContext` + `SortableContext` comune; textele de accesibilitate (instrucțiuni și anunțuri) în română; un `aria-live` pentru mutările de la tastatură.
  - **Cipurile (Grafice):** fiecare cip e `useSortable` (mânerul e tot cipul); după o tragere, click-ul care urmează e ignorat (un ref setat la `onDragEnd`, golit după un tick); `Alt+←/→` pe cip mută cu o poziție.
  - **Tabelul (Setări):** rândurile `useSortable` cu mâner separat (iconița `GripVertical`), mișcare doar pe verticală (modificator care pune `x = 0`); săgețile rămân; aceeași funcție de mutare.
- Serverul nu se schimbă (`PUT /api/watchlist/order` există și primește lista completă).

### 3. Teste
- Unitar: funcția de mutare (`moveItem`: de la / la, capete, același loc), schema setărilor (`showSlingshot` implicit `true`).
- CDP: bifa Slingshot (desenele dispar / revin, setarea rămâne după reîncărcare, ambele bife oprite → doar lumânări), tragerea unui cip cu mouse-ul (ordinea nouă pe server, graficul nu se schimbă), Alt + → pe un cip, tragerea unui rând în Setări, eroare simulată la salvare (revine ordinea).

---

## TD-USERS — implementează FD-USERS
> Înregistrarea, confirmarea emailului și retrimiterea ei (rutele `register` / `verify` / `resend-verification`, paginile `/register` și `/verify-email`, acțiunea `verify` a adminului) sunt înlocuite de **TD-INVITE**.


### 1. Baza de date (migrarea 3)
- `users`: `id`, `email` (UNIQUE COLLATE NOCASE, NULL doar la adminul neconfigurat), `name`, `password_hash` (NULL = fără parolă), `role` (`admin` | `user`), `email_verified_at`, `created_at`, `last_login_at`, `disabled_at`, `totp_secret` (criptat cu `SecretBox`), `totp_confirmed_at`, `totp_last_step`, `recovery_codes` (JSON cu SHA-256), `passkey_user_handle` (BLOB, 32 de octeți, creat la primul passkey).
  - Migrarea inserează adminul `id = 1`, `role = 'admin'`, fără email și parolă, confirmat. Toate datele existente devin ale lui (`user_id = 1`).
- `user_tokens`: `user_id`, `kind` (`verify` | `reset`), `token_hash` (SHA-256), `expires_at`, `created_at`; PK (`user_id`, `kind`): un singur link viu pe tip.
- `sessions`: `id_hash` (PK, SHA-256 al tokenului din cookie), `user_id`, `kind` (`full` | `pending`), `created_at`, `last_seen_at`, `expires_at`, `ip`, `user_agent`.
- `passkeys`: `id`, `user_id`, `credential_id` (TEXT base64url, UNIQUE), `public_key` (BLOB COSE), `counter`, `transports`, `device_type`, `backed_up`, `name`, `created_at`, `last_used_at`.
- `user_settings`: `user_id` PK, `value` (JSON: doar cheile utilizatorului).
- `watchlist` reconstruit cu `user_id` și PK (`user_id`, `coin`); `exchange_accounts` și `calendar_custom` primesc `user_id` (`ON DELETE CASCADE`, implicit 1).
- Toate tabelele noi au `ON DELETE CASCADE` spre `users`.

### 2. Module noi (`server/auth/`)
- **`passwords.ts`:** `scrypt` (N = 2^15, r = 8, p = 1, sare de 16 octeți, cheie de 32), format `scrypt$N$r$p$salt$hash`; `timingSafeEqual`; `passwordProblem(pw)` (12–200, literă mare, literă mică, cifră).
- **`totp.ts`:** portul `Totp.cs`:
  - HMAC-SHA1, pas de 30 s, 6 cifre, fereastră ±1;
  - pragul `last_step` (anti-replay);
  - base32 RFC 4648, URI `otpauth://totp/Sentiq:<email>?…&issuer=Sentiq`;
  - testat cu vectorii RFC 6238.
- **`recovery.ts`:** 10 coduri `XXXXX-XXXXX` (alfabet base32), stocate ca SHA-256 al formei normalizate; consumate la folosire; normalizarea (litere mari, fără spații / cratime) ca în Serento.
- **`throttle.ts`:** portul `LoginThrottle` (3 eșecuri → 15 min, 4000 / 3000 intrări, compactare). Cheia apelantului: IPv4 întreg, IPv6 `/64`. Partiții `login:` (parola și codul, împreună), `register:` și `mail:` (fiecare cerere acceptată contează), `account:<id>` (acțiunile cu parolă / cod ale unei sesiuni: schimbarea parolei, 2FA). În memorie: o repornire le golește.
- **`sessions.ts`:**
  - tokenul: 32 de octeți aleatori (base64url); în baza de date stă doar SHA-256;
  - cookie `sentiq_session`: `HttpOnly`, `SameSite=Strict`, `Path=/`, `Secure` doar pe HTTPS;
  - `full`: 30 de zile, glisant; `last_seen_at` și expirarea se actualizează cel mult o dată la 5 min, iar atunci (`slid`) hook-ul retrimite și cookie-ul cu `Max-Age` nou;
  - `pending` (după parola corectă, cu 2FA pornit): 5 minute, fix; nu deschide nicio rută, doar pasul cu codul (pagina ține ținta de după login);
  - schimbarea sau resetarea parolei, dezactivarea și „ieși de peste tot” șterg sesiunile utilizatorului (în afară de cea curentă, unde e cazul).
- **`email.ts`:** Resend (`POST https://api.resend.com/emails`, `Authorization: Bearer`):
  - cheia și expeditorul în setările globale (cheia criptată, `settings.getResend()` / `setResend()`); `isDevMail()` = fără cheie sau expeditorul de test `onboarding@resend.dev`;
  - trimiterea e în fundal (`void`), ca răspunsul să dureze la fel cu sau fără email (nu spune dacă adresa există);
  - fără cheie: linkul de confirmare și cel de resetare în jurnal (`warn`);
  - cu cheie refuzată: doar linkul de confirmare în jurnal, nu cel de resetare;
  - textele în română, HTML escapat.
- **`users.ts`:** `UserService`:
  - înregistrare, confirmare, login cu parolă (rezultat `ok` / `2fa` / `unverified` / `disabled` / `invalid`);
  - 2FA (start / cancel / enable / disable / regenerate / verify) cu regulile din Serento: parola verificată înaintea codului, ca o parolă greșită să nu consume un cod de recuperare; enable doar cu secret în așteptare; disable și regenerate cer ambii factori;
  - reset (un singur link viu), setup admin, administrare.
- **`passkeys.ts`:**
  - `@simplewebauthn/server` 13.3.3: `residentKey: 'required'`, `userVerification: 'required'` (verificat), `attestationType: 'none'`, algoritmi −8 / −7 / −257, `excludeCredentials` = passkey-urile utilizatorului;
  - provocarea în memorie, cu cheia într-un cookie `sentiq_webauthn` (5 min, scop `create` / `get`, consumată înainte de verificare, legată de sesiune la înregistrare);
  - RP ID = hostname-ul cererii (validat de lista de gazde), originea = `protocol://host`;
  - la login: credentialul se caută după ID, `userHandle` (când există) trebuie să fie al utilizatorului găsit, contorul crește (sau rămâne 0 la cele sincronizate), utilizatorul e confirmat și activ.

### 3. HTTP
- **Gazde** (`security.ts`): `localhost`, `127.0.0.1`, `::1`, adresele IPv4 / IPv6 ale interfețelor Mac-ului (recitite la un minut), `<hostname>` și `<hostname>.local`, plus `SENTIQ_ALLOWED_HOSTS`.
- **`Origin`:** dacă există, gazda și portul lui trebuie să fie egale cu `Host` (aceeași origine).
- **`X-Sentiq`** rămâne obligatoriu pe modificări.
- **Regulile de acces se aplică rutei găsite de router** (`req.routeOptions.url`), nu URL-ului brut: routerul decodifică `%61` → `a`, deci o verificare pe text ar putea fi ocolită. Antetul `X-Sentiq` se cere pe orice metodă care modifică, indiferent de cale.
- **Autentificare** (`http/auth.ts`, `onRequest`, după securitate): rutele `/api/*`, în afară de lista publică, cer o sesiune `full` validă și un utilizator activ (neblocat, cu parolă, confirmat sau admin); altfel 401 `AUTH_REQUIRED`. Sesiunile unui cont dezactivat / șters se șterg la prima lui cerere. `req.user` = { id, role, email, name }; rutele îl citesc cu `me(req)`.
- **Doar admin** (403 `FORBIDDEN` din același hook, după tabelul `ADMIN_ONLY`):
  - `POST /api/sources*` (inclusiv `/test`), `PUT` / `DELETE /api/sources/:id` (`GET /api/sources` rămâne pentru filtrul din Știri);
  - `/api/sentiment/rescore`, `/api/sentiment/recompute-history`;
  - `PUT /api/settings/claude-key`, `/twelvedata-key`, `/resend`;
  - `/api/health`, `/api/admin/*`;
  - partea globală din `PUT /api/settings` (`SettingsForbiddenError`, 403).
- **Rute noi** (`auth-routes.ts`):
  - `GET /api/auth/state` → { `user`, `setupNeeded`, `setupHere` (loopback), `adminEmail` (doar cât lipsește parola), `passkeys` (adresa permite), `devMail`, `passwordRule` };
  - `POST /api/auth/setup` (doar loopback, doar fără parolă; intră direct);
  - `POST /api/auth/register`, `POST /api/auth/verify`, `POST /api/auth/resend-verification`;
  - `POST /api/auth/login` (→ `ok` + user, sau `2fa` cu sesiune `pending`), `POST /api/auth/login/2fa` (→ `usedRecoveryCode`), `POST /api/auth/logout`;
  - `POST /api/auth/forgot`, `POST /api/auth/reset/check` (tokenul în corp, nu în adresă), `POST /api/auth/reset`;
  - `POST /api/auth/passkey/options`, `POST /api/auth/passkey`;
  - `GET /api/account` (user, 2FA, passkey-uri, `passkeysHere`), `PUT /api/account/name`, `PUT /api/account/password`, `POST /api/account/logout-all`;
  - `GET /api/account/2fa`, `POST /api/account/2fa/start | cancel | enable | disable | recovery-codes`;
  - `GET /api/account/passkeys`, `POST /api/account/passkeys/options`, `POST /api/account/passkeys`, `PUT` / `DELETE /api/account/passkeys/:id`;
  - `GET /api/admin/users`, `POST /api/admin/users/:id/verify | disable | enable | reset-2fa`, `DELETE /api/admin/users/:id`;
  - `PUT /api/settings/resend` { key?, from? }.
- **Linkurile din emailuri** folosesc `protocol://Host` al cererii (Host-ul e deja pe lista permisă, deci nu poate fi al altui site).
- **Răspunsuri:** erorile de autentificare în română; aceleași mesaje generice unde FD cere (register, forgot, resend).

### 4. Date pe utilizator
- **`SettingsService`:**
  - `USER_KEYS` = `timezone`, `market`, `scanner`, `calendar`, `indicator`, `lma`, `charts`;
  - `forUser(id)` = setările globale peste care se pun cele ale utilizatorului (validate cu aceeași schemă);
  - `updateFor(user, patch)` împarte patch-ul: cheile utilizatorului în `user_settings`, celelalte doar pentru admin (altfel 403);
  - la prima pornire după migrare, `user_settings` pentru adminul 1 se copiază din setările de acum (`migrateLegacyToAdmin`);
  - `viewFor(user, isAdmin)`: indiciile cheilor doar pentru admin; plus `resendKeySet`, `resendFrom`, `resendDev`;
  - cache pe utilizator, golit la orice schimbare globală.
- **Rute:** favorite, conturi (listă / creare / test / ștergere / portofoliu / preț mediu: doar ale utilizatorului, altfel 404), calendar (evenimentele personale ale utilizatorului și rezultatele companiilor din favoritele lui), știri (filtrul de favorite), scanner (rezultatul lui), sentiment (`today` / `history` / `day` în fusul lui), lumânări (exchange-ul și numărul de lumânări din setările lui).
- **Comune, peste favoritele tuturor:** `CoinRegistry.get()` (etichetele: aliasurile tuturor, reunite pe simbol), `syncStockSources`, jobul de rezultate. `CoinRegistry.classifier()` (lista de monede + favoritele adminului) dă monedele care intră în `classify()` (relevanță, impact) la `ingestItems` / `retagRecent`: aliasurile altor utilizatori nu schimbă ponderile sentimentului comun.
- **Scanner:** `run()` trece prin utilizatorii activi; într-o rulare, aceeași pereche cu aceiași parametri se calculează o dată (memo pe exchange, simbol, timeframe, lumânări, parametri); rândurile acțiunilor sunt ținute pe (simbol, parametri) și se șterg după o zi; `result(userId)`.
- **`DailySentimentService`:** `today(tz)`, `history(days, tz)`, `refreshZone(tz)`; `refresh()` (jobul) trece prin fusurile tuturor utilizatorilor (`settings.timezones()`); `recomputeHistory()` pentru toate.
- **Ștergerea unui utilizator:** clienții de exchange din memorie ai conturilor lui, cache-ul setărilor, eticheta știrilor (`CoinRegistry`) și feed-urile Nasdaq rămase fără acțiune.
- **Întreținere (zilnic):** sesiunile expirate și conturile neconfirmate de peste 7 zile.
- **Utilizator nou:** BTC / ETH / SOL la favorite, fără `user_settings` (implicitele).

### 5. Interfață
- **`auth.ts`:** `useAuthState()` (`/api/auth/state`, cheia `['auth']`) conduce toată aplicația; `useAuthChange()(user)` pune noul utilizator și șterge din cache toate celelalte date (nimic de la utilizatorul anterior nu rămâne pe ecran).
- **`App.tsx`:**
  - fără utilizator → `SignedOutApp` (`pages/Auth.tsx`): `/login` (parola, apoi codul în același ecran; passkey), `/register`, `/verify-email?token=`, `/forgot`, `/reset-password?token=`, `/setup`; orice altă adresă → `/login?next=…`;
  - cu utilizator → aplicația; `/verify-email` și `/reset-password` merg și așa, celelalte ecrane de login duc mai departe.
- **Aterizarea după login / ieșire:** ținta se pune într-o variabilă (`landAfterSignIn` / `landAfterSignOut`) înainte de schimbarea utilizatorului, iar redirecționarea o citește. Motiv: routerul schimbă adresa într-o tranziție, iar utilizatorul nou ajunge sincron; un `navigate()` făcut în același timp pierdea cursa (o redirecționare calculată din adresa veche câștiga) sau era ignorat (componenta demontată).
- **Tokenurile din linkuri** se citesc o dată și se scot din bara de adrese (`history.replaceState`).
- **`api.ts`:** un 401 `AUTH_REQUIRED` pe orice cerere trimite evenimentul `sentiq:signed-out` → utilizatorul devine null → login cu `next` = pagina curentă. `newSessionEpoch()` (chemat de `useAuthChange`): răspunsurile cererilor plecate înainte de o schimbare de utilizator se aruncă (`STALE`), ca o salvare întârziată a utilizatorului anterior să nu scrie în cache-ul celui nou.
- **Meniu:** iconița utilizatorului (inițiale) cu „Securitate”, „Utilizatori” (admin) și „Ieși”; „Stare sistem” doar pentru admin.
- **Setări:** secțiunile globale (surse, sentiment, cheia Twelve Data, retenția, emailul / Resend) doar pentru admin; restul pentru toți.
- **`pages/Security.tsx`:**
  - parola;
  - 2FA: QR SVG generat pe server cu `uqr`, inline, ca secretul să nu apară într-o adresă de imagine;
  - codurile de recuperare (o singură afișare, „Copiază” / „Descarcă .txt”);
  - passkey-urile (`@simplewebauthn/browser` 13.3.0: `startRegistration` / `startAuthentication`, `browserSupportsWebAuthn`);
  - „Ieși de pe toate dispozitivele”.
- **`pages/Users.tsx`:** tabelul și acțiunile adminului, cu confirmări.

### 6. Server și lansator
- `config.ts`: `host` = `SENTIQ_BIND` (implicit `::`, adică IPv6 și IPv4 pe toate interfețele); `allowedHosts` = `SENTIQ_ALLOWED_HOSTS` (listă cu virgulă).
- `main.ts` ascultă pe `host` (pe un Mac cu IPv6 oprit, `::` dă `EAFNOSUPPORT` și se reîncearcă `0.0.0.0`) și scrie în jurnal adresele din rețea.
- `sentiq.sh`: `ping` pe `127.0.0.1`, browserul pe `http://localhost:PORT` (`Sentiq.app` cheamă lansatorul, deci tot `localhost`); `status` listează adresele din rețea (`ipconfig getifaddr en0…en5`), dacă `SENTIQ_BIND` nu e loopback.
- `sentiq.sh admin-email <adresa>` / `admin-reset` → `scripts/admin.ts` (refuză dacă baza de date nu există; `admin-reset` cere „da” în Terminal).

### 7. Teste
- `totp.ts`: vectorii RFC 6238 (SHA-1, 8 cifre), fereastra, anti-replay, base32, URI.
- Parole, throttle (blocare, partiții, IPv6 `/64`), recovery.
- Fluxuri pe rute:
  - setup doar loopback;
  - register (mesaj generic, email existent), verify, login neconfirmat / dezactivat, login cu 2FA, cod reutilizat, cod de recuperare, blocarea după 3 încercări comune parolă + cod;
  - forgot / reset (un link viu, sesiunile închise), schimbarea parolei;
  - izolarea datelor (favorite, conturi, setări, evenimente, portofoliul altuia → 404, scanner);
  - admin (403 pentru user; verify / disable / delete / oprește 2FA; adminul nu se poate șterge);
  - Host / Origin din rețea.
- Passkey: înregistrare și autentificare cu un autentificator construit în test (cheie EC P-256 din `node:crypto`, CBOR prin `isoCBOR` din `@simplewebauthn/server/helpers`), plus în Chrome prin autentificatorul virtual CDP (`WebAuthn.addVirtualAuthenticator`) pe `localhost`.
- CDP: înregistrare (linkul din jurnal), confirmare, login, 2FA cu codul calculat în test, codurile de recuperare, admin, rețea (Host = IP-ul LAN).

## TD-IMPACT — implementează FD-IMPACT

### 1. Baza de date (migrarea 4)
- `ALTER TABLE news ADD COLUMN sentiment_impact REAL` — importanța dată de motorul de sentiment (Claude), `NULL` când motorul n-a dat una.
- Completare: `sentiment_impact = json_extract(sentiment_meta, '$.impact')` pentru `sentiment_engine LIKE 'claude:%'` cu meta JSON valid și valoare numerică.
- `UPDATE news SET relevance = 0.8 WHERE category = 'geopolitics' AND relevance = 0.6` (știrile salvate, ca cele noi).

### 2. Motoare și notare
- `ScoredItem.impact?: number` (1–3). `ClaudeEngine` îl pune (rotunjit, limitat 1–3); `meta.impact` rămâne pentru afișare.
- `SentimentService.scorePending` scrie `sentiment_impact = s.impact ?? NULL` odată cu scorul; `reset()` îl golește odată cu scorul; în `ingestItems`, un titlu schimbat îl golește.
- `retagRecent` / `classify` schimbă doar `impact` (cuvintele-cheie), niciodată `sentiment_impact`.

### 3. Clasificare
- `classify.ts`: `GEO_RELEVANCE = 0.8` pentru `geopolitics` cu termeni de piață (înainte 0,6); fără termeni → 0.

### 4. Indexul
- `DailySentimentService.loadItems`: `COALESCE(n.sentiment_impact, n.impact) AS impact`; `computeIndex` neschimbat.
- `INDEX_VERSION = 2` (`sentiment/daily.ts`). `upgradeHistory()`: dacă `readJobData('sentiment.daily').indexVersion < INDEX_VERSION` → `recomputeHistory()`, apoi scrie versiunea. Jobul `sentiment.daily` îl cheamă înainte de `refresh()` (la pornire, apoi la 2 minute: fără efect după prima dată).
- `recomputeHistory()` lucrează pe fusurile în uz și pe cele care au deja snapshot-uri (un fus părăsit și ales din nou primește zilele calculate la fel ca restul); șterge snapshot-urile doar din prima zi completă: jobul `maintenance` scrie în datele lui `retentionCutoff` (maximul pragurilor de retenție aplicate); prima zi completă = ziua de după cea care conține pragul (în fusul respectiv); fără prag → toate zilele. `refresh()` le reface; zilele dinainte, cu snapshot final, sunt sărite.

### 5. API și interfață
- `NewsItemDto`: `impact` = importanța folosită în index, `impactSource` = `'ai'` | `'rules'`, `ruleImpact` = cea din cuvinte-cheie.
- `News.tsx`, „De ce acest scor?”: „Relevanță 0,8 · importanță 1 (Claude; după cuvinte-cheie ar fi 3)” sau „importanță 2 (după cuvinte-cheie)”.

### 6. Teste
- Migrarea 4: completarea din meta (Claude da, local nu, meta invalid), relevanța geopolitică 0,6 → 0,8 (doar ea).
- `classify`: geopolitică cu termeni de piață → 0,8; fără → 0.
- Notare: Claude scrie `sentiment_impact`; fallback-ul local nu; `reset` și titlul schimbat îl golesc; `retagRecent` nu-l atinge.
- Index: o știre cu importanța 1 de la Claude și 3 din cuvinte-cheie cântărește ca 1; fără Claude, ca 3.
- `upgradeHistory`: recalculează o dată; nu atinge zilele dinaintea pragului de retenție.
- `queryNews`: `impact` / `impactSource` / `ruleImpact`.

## TD-ECON — implementează FD-ECON

### 1. Baza de date (migrarea 5)
- `econ_indicators`: `key` PK (`ticker` sau `țară:indicator` cu litere mici), `country`, `name` (indicator, engleză), `category`, `unit`, `scale`, `currency`, `importance` (maximul văzut), `source`, `source_url`, `comment`, `updated_at`.
- `econ_releases`: `id` PK (id-ul evenimentului TradingView), `key` → `econ_indicators` (`ON DELETE CASCADE`), `ts` (ora publicării), `period`, `reference_date`, `actual`, `previous`, `forecast` (REAL, NULL), `fetched_at`; index (`key`, `ts`).
- Excluse la scriere: evenimentele fără `indicator`, `Calendar`, `Holidays`.

### 2. Citirea (`calendar/sources.ts`, `economy/source.ts`)
- `parseTradingView` păstrează în `RawEvent.tv` câmpurile în plus: `ticker`, `indicator`, `category`, `referenceDate`, `source`, `sourceUrl`, `comment`, `importance`, valorile numerice. Calendarul nu le folosește.
- `fetchTradingView(from, to, countries = TV_COUNTRIES)`.
- `fetchEconRange(from, to, countries)`: dacă un răspuns are ≥ 2.000 de evenimente (limita sursei), intervalul se împarte în două și se cere din nou (recursiv, până la o zi); între cereri, 500 ms.

### 3. `EconomyService` (`economy/service.ts`)
- `ingest(events)`: upsert indicatori + publicări (într-o tranzacție); `actual` / `previous` / `forecast` din valorile numerice.
- `backfill()`: o dată (marcaj în datele jobului `econ.history`): pentru fiecare țară, −400 … −7 zile.
- `refreshSchedule()`: zilnic, +14 … +60 de zile, toate țările.
- `view(now)`: răspunsul paginii (§4), ținut 60 s în memorie, golit la `ingest`.
- `prune(now)`: publicările mai vechi de 2 ani (din jobul de întreținere).

### 4. API: `GET /api/economy`
```
{ updatedAt, historyReady, countries: [{ code, name, indicators: [{
  key, country, countryName, group, name, original, unit, scale, important,
  latest: { value, period, ts, forecast }, previous: number | null, change: number | null,
  next: { ts, forecast, overdue } | null, history: [period, value][],
  source, sourceUrl, explanation, hasDescription }] }] }
```
- Descrierea sursei (engleză, ~400 de caractere pe indicator, ar fi cam o treime din răspuns): `GET /api/economy/description?key=…`, cerută când utilizatorul o deschide.
- Grupul zonei euro: `EU` + indicatorii `DE` / `FR` / `IT` / `ES` al căror nume (litere mici) nu există la `EU`.
- `latest` = ultima publicare cu `actual`; `previous` = `previous` din ea (revizuit); `next` = prima publicare cu `ts > now`, sau cea trecută de ≤ 1 zi fără `actual` (`overdue`); `history` = ultima publicare pentru fiecare perioadă (după `reference_date`), cel mult 13 (26 la cele săptămânale).
- `important` = `importance ≥ 1` la sursă, plus lista proprie de esențiale (`economy/names.ts`), ca fiecare țară să-și aibă inflația, șomajul, PIB-ul și dobânda în „Esențiale”.
- Numele în română și explicațiile: `economy/names.ts` (după numele original, litere mici) și `explain()` din glosarul Calendarului.

### 5. Joburi
- `TV_JOB` (calendarul): `feedingEconomy()` trimite aceleași evenimente și la `economy.ingest` (o eroare acolo nu oprește calendarul). Un răspuns gol sau la limita de 2.000 nu șterge publicări programate.
- `econ.history` (la 30 s după pornire, apoi zilnic): `backfill()` dacă nu e făcut, apoi `refreshSchedule()`.
- `maintenance`: `economy.prune()`.

### 6. Interfață (`pages/Economy.tsx`)
- Rută `/economy`, în meniu după Calendar (iconița `Landmark`), în ⌘K.
- Bară: actualizare, cipuri cu țările (ancore), căutare, „Doar importante” (ținut în `localStorage`).
- Pe țară: fișele „Esențiale” (valoarea, schimbarea, perioada, următoarea publicare cu numărătoare, mini-grafic), apoi tabele pe grupe (`Panel flush`): Indicator · Ultima · Anterior · Schimbare · Perioadă · Publicat · Următoarea · Istoric.
- Formatul: `economy/format.ts` în `web/` (valoare + scară „mii / mil. / mld. / tril.” + unitate / monedă, perioadă în română: „Aug” → „aug.”, „Q2” → „T2”, „Oct/03” → „săpt. 3 oct.”).
- Explicația și sursa: rândul se deschide (detalii) la click.

### 7. Teste
- `parseTradingView` păstrează câmpurile în plus; calendarul neschimbat.
- `fetchEconRange` împarte intervalul la limita de 2.000.
- `ingest`: upsert, excluderile, cheia fără `ticker`.
- `view`: ultima valoare, flash / final, anteriorul revizuit, următoarea (viitoare, în așteptare, necunoscută), istoricul pe perioade, grupul zonei euro (fallback-ul DE fără dublură), „Esențiale”.
- Formatul web: scări, monede, perioade.
- Ruta: 401 fără sesiune, răspunsul pentru un utilizator normal.

## TD-ECONCOLOR — implementează FD-ECONCOLOR

- `economy/names.ts`: `polarityOf(category, name)` → `1` (creșterea bună) / `-1` (rea) / `0` (neutră): întâi excepțiile după nume (expresii regulate, în ordine: prețuri plătite, dobânzi, randamente, șomaj, salarii, stocuri, prețul locuințelor, importuri, credit…), apoi valoarea grupei (`prce` −1; `lbr`, `gdp`, `bsnss`, `cnsm`, `hse`, `trd`, `gov` +1; `bnd` / `mrkt` −1; `mny`, `enrg`, `other` 0; PMI fără categorie +1).
- `EconIndicator.polarity` în răspunsul `/api/economy`.
- `web/econ-format.ts`: `toneOf(delta, polarity)` → `'good' | 'bad' | 'neutral'`; clasele `text-bull` / `text-bear` / `text-text`.
- `Economy.tsx`: valoarea și schimbarea (▲ / ▼) colorate în fișe și în tabele; `Spark` cu linia `brass` și un punct la capăt (`fill` după ton); „peste / sub prognoză” colorat; legenda sub titlu.
- Teste: `polarityOf` pe nume reprezentative din fiecare rând al tabelului din research §11 și pe unul necunoscut; `toneOf`.

## TD-ECONFILTER — implementează FD-ECONFILTER

- `web/econ-format.ts`: `filterEconomy(countries, { search, importantOnly })` (funcție pură: căutarea fără diacritice pe nume / numele original / țara membră, „Doar importante”), folosită și pentru numerele de pe cipuri.
- `Economy.tsx`: `useSearchParams` → `tara` (validat față de codurile din răspuns; altfel toate); cipurile sunt `<button aria-pressed>` cu numărul; click pe cel activ sau pe „Toate” șterge parametrul (`replace`, fără intrări noi în istoricul browserului); secțiunile afișate = țara activă sau toate cele cu rezultate; mesajul și butonul pentru țara activă fără rezultate.
- Teste: `filterEconomy` (căutare, importante, membrii zonei euro găsiți după numele țării).

## TD-SUMMARY — implementează FD-SUMMARY

### 1. Baza de date (migrarea 6)
- `day_summaries`: `user_id` → `users` (`ON DELETE CASCADE`), `day`, `tz`, `created_at`, `model`, `content` (JSON: ce a scris Claude), `charts` (JSON: seriile graficelor alese, din momentul generării); PK (`user_id`, `day`): păstrăm ultimul rezumat al zilei.

### 2. Contextul zilei (`summary/context.ts`)
- `buildDayContext(ctx, userId, now)` → `{ day, tz, asOf, prompt, charts }`:
  - `prompt`: text compact (secțiuni etichetate, cifre rotunjite): ora și ziua în fusul utilizatorului, starea bursei SUA, sentimentul (index, încredere, defalcare, evoluția pe ore, 7 zile, motoarele +/−), ~40 de știri ale zilei (după relevanță × importanță × |scor|), calendarul de azi (High / Medium, valoare / prognoză / anterior; plus evenimentele utilizatorului, marcate „notat de utilizator”, fără notiță) și următoarele 24 h, indicatorii economici publicați azi (cu sensul bine / rău) și cei programați azi, contextul pieței, favoritele din scanner;
  - `charts`: seriile disponibile, cu id stabil: `sentiment-today`, `sentiment-week`, `sentiment-breakdown`, `favorites-24h`, `econ:<cheie>` pentru fiecare indicator publicat azi (istoric + prognoză + sens).
- Listele din prompt includ id-urile graficelor, ca Claude să le poată alege.

### 3. `SummaryService` (`summary/service.ts`)
- `latest(userId, day)`; `retryAt(userId, day)`; `generate(userId, day, now)`:
  - o singură generare în curs pe utilizator (aceeași promisiune pentru cereri simultane); pauză de 2 min între generări (`SummaryCooldownError` → 429 cu `retryAt`);
  - o eroare la citirea datelor zilei → `SummaryFailedError` (Claude nu e întrebat);
  - `client.messages.stream` (`model` = `claude-opus-5-5`, `max_tokens` 16000, `output_config: { effort: 'medium', format: zodOutputFormat(schema) }`), `finalMessage()`; refuz / fără `parsed_output` → eroare; tokenii (`usage`) se scriu în jurnal;
  - schema: `verdict` (`buna` | `mixta` | `slaba`), `confidence` (`scazuta` | `medie` | `ridicata`), `headline`, `overview`, `sections[{ title, body }]`, `opportunities[]`, `risks[]`, `upcoming[{ time, event, why }]`, `charts[{ id, caption }]`; după validare: graficele cu id necunoscut (`Object.hasOwn`, ca „constructor” să nu treacă) sau repetat se scot, cel mult 4 (aceeași listă în conținut și în serii), listele limitate;
  - salvează în `day_summaries` (cu seriile graficelor alese) și întoarce.
- Clientul Anthropic se creează din cheia Claude a setărilor (decriptată în memorie); `clientFactory` injectabil pentru teste.
- Erorile Anthropic → mesaje în română (ca motorul de sentiment).

### 4. API
- `GET /api/summary` → `{ summary | null, hasKey, retryAt }` (rezumatul de azi al utilizatorului, în fusul lui).
- `POST /api/summary` → generează și întoarce `{ summary, hasKey, retryAt }`; 400 fără cheie, 429 în pauză, 502 la eroare Claude.

### 5. Interfață
- `App.tsx`: butonul „Rezumat” (`Sparkles`) în `TopNav`, doar pe `/`, la stânga căutării; deschide `DaySummary` (încărcat la cerere, în propriul `ErrorBoundary` cu fereastra `SummaryFailed`); schimbarea paginii și ⌘K închid rezumatul.
- `components/DaySummary.tsx`: fereastra (`role="dialog"`, `aria-modal`, Esc / click afară / ×, focus pe deschidere, Tab ținut în fereastră, focus înapoi la buton la închidere); la deschidere `GET`, apoi `POST` automat dacă nu există rezumat azi; „Actualizează” (cu numărătoare în pauză); verdictul colorat; secțiuni; oportunități / riscuri / ce urmează; graficele (`SummaryChart`: linie cu axe minime, prognoză și punctul final colorat; bare orizontale cu valoarea).
- Graficele se desenează din seriile salvate odată cu rezumatul (aceleași cifre pe care le-a văzut Claude).

### 6. Teste
- `buildDayContext` pe o bază de test: secțiunile, id-urile graficelor, indicatorul publicat azi.
- `SummaryService` cu un client fals: salvare, graficele necunoscute scoase, o singură generare pentru cereri simultane, pauza de 2 min, refuz / răspuns fără JSON, fără cheie.
- Rutele: 401 fără sesiune, fără cheie, rezumatul fiecărui utilizator separat.

---

## TD-MCP — implementează FD-MCP

### 1. Configurare (`config.ts`)
- `publicUrl`: `SENTIQ_PUBLIC_URL`, normalizat la origine (`https://host[:port]`, fără cale, query sau fragment, litere mici). Valid doar `https:`, sau `http:` pe `localhost` / `127.0.0.1` (teste locale). Invalid → `null`.
- `mcp: { requested, enabled, clientHosts }`: `requested = SENTIQ_MCP === '1'`; `enabled = requested && publicUrl !== null`; `clientHosts` din `SENTIQ_MCP_CLIENTS` (implicit `claude.ai,claude.com`).
- Hostul din `publicUrl` se adaugă la `allowedHosts`.
- `main.ts`: `requested` fără `enabled` → `log.warn`; `enabled` → `log.info` cu adresa connectorului.

### 2. Baza de date (migrarea 7)
- `mcp_clients` (DCR): `client_id` PK, `client_name`, `redirect_uris` (JSON), `created_at`, `last_used_at`.
- `mcp_grants`: `id` PK, `user_id` → `users` (`ON DELETE CASCADE`), `client_id`, `client_name`, `client_host`, `redirect_host`, `scope`, `resource`, `created_at`, `last_used_at`, `revoked_at`; index pe `user_id`.
- `mcp_codes`: `hash` PK (SHA-256 al codului), `user_id` → `users` (cascade), `client_id`, `client_name`, `client_host`, `redirect_uri`, `redirect_host`, `code_challenge`, `scope`, `resource`, `expires_at`, `used_at`, `grant_id`.
- `mcp_tokens`: `hash` PK (SHA-256), `grant_id` → `mcp_grants` (cascade), `kind` (`access` | `refresh`), `expires_at`, `rotated_at`; index pe `grant_id`.
- Token-urile și codurile sunt 32 de octeți aleatori (base64url), cu prefix (`sq_at_`, `sq_rt_`, `sq_ac_`); în bază doar hash-ul. Nimic nu se scrie în jurnal.
- Curățenie (`pruneMcp`, în job-ul `maintenance` existent, și cu connectorul oprit): coduri expirate, token-uri expirate, conexiuni revocate mai vechi de 30 de zile, clienți DCR nefolosiți de 30 de zile fără conexiuni.

### 3. Serverul de autorizare (`server/mcp/oauth.ts`, `OAuthService`)
- **Clienți:**
  - *CIMD*: `client_id` URL `https:` cu cale, hostul în `clientHosts`; se descarcă (`fetch` cu `redirect: 'error'`, 5 s, max 10 KB, `Accept: application/json`), se validează (`client_id` identic, `redirect_uris` listă de URL-uri, `client_name`, `token_endpoint_auth_method` absent sau `none`) și se ține în memorie cât spune `Cache-Control: max-age` (între 60 s și 1 h; implicit 5 min). Funcția de descărcare e injectabilă (teste).
  - *DCR*: `client_id` `sq_dcr_…` din `mcp_clients`.
  - Un redirect e permis doar dacă e `https:` cu hostul în `clientHosts` sau loopback (`http://localhost|127.0.0.1|[::1]`, orice port); la CIMD trebuie să fie și în `redirect_uris` (loopback comparat fără port), la DCR identic cu unul înregistrat.
- **Cereri de autorizare în curs:** în memorie (`Map`, id aleator de 128 de biți, 10 min, max 500, cele mai vechi scoase), fiecare cu un `binding` aleator pus în cookie-ul `sentiq_oauth` (HttpOnly, SameSite=Strict, 10 min) de `/oauth/authorize`; pagina de consimțământ o poate citi / aproba doar cu acel cookie (comparat în timp constant), apoi cookie-ul se șterge. `redirect_uri` e obligatoriu.
- **Conexiuni:** `approve(reqId, userId)` → cod (60 s) → redirect cu `code`, `state`, `iss`; `deny` → `error=access_denied`, `state`, `iss`. O cerere se folosește o singură dată.
- **Token:** `authorization_code` (cod existent, neexpirat, nefolosit; același `client_id` și `redirect_uri`; `BASE64URL(SHA256(code_verifier)) === code_challenge`; `resource`, dacă vine, egal cu resursa) → conexiune nouă + acces (1 h) + refresh (30 de zile). Cod folosit a doua oară → conexiunea lui se revocă, `invalid_grant`. `refresh_token` → același `client_id`, conexiune activă, utilizator activ; token nou de acces + refresh nou, cel vechi marcat `rotated_at`; un refresh deja rotit: după 60 s revocă conexiunea, în 60 s doar refuză; ambele `invalid_grant`. Răspunsuri cu `Cache-Control: no-store`.
- **Verificarea Bearer:** hash → token `access` neexpirat → conexiune nerevocată → utilizator activ (`isActive`) → `resource` egal cu resursa serverului → `AuthInfo { token, clientId, scopes, expiresAt (secunde), resource, extra: { userId, grantId } }`; `last_used_at` scris cel mult o dată pe minut.
- **Revocare:** `revokeGrant(id, userId)`, `revokeAllForUser(userId)`, `revokeByToken(token)` (RFC 7009).
- `scope`: unul singur, `sentiq:read`; `offline_access` acceptat în cerere (doar semnal că se vrea refresh, care se dă oricum). Un scope necunoscut → `invalid_scope`.

### 4. Rutele (`server/mcp/routes.ts`, înregistrate doar când `enabled`)
- `GET /.well-known/oauth-protected-resource` și `/.well-known/oauth-protected-resource/mcp` → `{ resource: <base>/mcp, authorization_servers: [<base>], scopes_supported: ['sentiq:read'], bearer_methods_supported: ['header'], resource_name: 'Sentiq' }`.
- `GET /.well-known/oauth-authorization-server` → `issuer`, `authorization_endpoint`, `token_endpoint`, `registration_endpoint`, `revocation_endpoint`, `response_types_supported: ['code']`, `grant_types_supported: ['authorization_code','refresh_token']`, `code_challenge_methods_supported: ['S256']`, `token_endpoint_auth_methods_supported: ['none']`, `revocation_endpoint_auth_methods_supported: ['none']`, `scopes_supported: ['sentiq:read','offline_access']`, `client_id_metadata_document_supported: true`, `authorization_response_iss_parameter_supported: true`.
- `GET /oauth/authorize`: client sau redirect invalid (sau lipsă) → pagină HTML de eroare (400), fără redirect; celelalte erori → redirect cu `error`, `state`, `iss`; altfel cererea intră în memorie, cookie-ul `sentiq_oauth` se setează și `302` la `/oauth/consent?req=<id>`.
- `POST /oauth/token`, `POST /oauth/revoke`: formular (parser propriu, doar în plugin-ul OAuth; JSON acceptat și el), limită 60 / min / IP.
- `POST /oauth/register`: JSON (RFC 7591): `redirect_uris` 1–5 permise, `token_endpoint_auth_method` absent sau `none`, `grant_types` / `response_types` doar cele suportate, `client_name` ≤ 100 → `201`; altfel `400 invalid_redirect_uri` / `invalid_client_metadata`; 10 / oră / IP, maxim 500 de clienți.
- `ALL /mcp` (`POST`, `GET`, `DELETE`): verificarea Bearer; fără token valid → `401` + `WWW-Authenticate: Bearer [error="invalid_token", ]resource_metadata="<base>/.well-known/oauth-protected-resource/mcp", scope="sentiq:read"`; scope lipsă → `403 insufficient_scope`; 300 de cereri / 5 min / conexiune → `429`. Altfel `Request` web (`<base>/mcp`, metoda, header-ele MCP, corpul JSON) → `handler.fetch(request, { authInfo, parsedBody })` → răspunsul (inclusiv SSE) trimis prin `reply` (`Readable.fromWeb`).
- **API pentru interfață** (rute `/api`, sesiune + `X-Sentiq`): `GET /api/mcp/status` → `{ enabled, url, connections }` (`enabled: false` și nimic altceva când e oprit); `DELETE /api/mcp/connections/:id`; `GET /api/oauth/requests/:id` → `{ client: { name, host }, redirectHost, loopback, scopes, account }`; `POST /api/oauth/requests/:id` `{ approve }` → `{ redirect }`. Cât e oprit, ultimele trei → 404.
- **Securitate (`security.ts`):** `registerSecurity(app, hosts, { bearerRoutes })`: pentru rutele `/mcp`, `/oauth/token`, `/oauth/revoke`, `/oauth/register` (după `req.routeOptions.url`, nu după URL-ul brut) nu se cer `X-Sentiq` și JSON; Host și Origin rămân verificate.
- **Revocări legate:** `/api/account/logout-all`, `/api/auth/reset`, dezactivarea de către admin → `revokeAllForUser`; ștergerea utilizatorului → cascadă.

### 5. Serverul MCP (`server/mcp/server.ts`)
- `createMcpHandler(({ authInfo }) => buildMcpServer(deps, userId))`; `McpServer({ name: 'sentiq', title: 'Sentiq', version }, { instructions, maxToolInputElements: 200 })`.
- Unelte (toate `readOnlyHint: true`, `openWorldHint: false`; nume în engleză pentru model, `title` în română pentru interfață; rezultat text compact, cel mult ~60 KB):
  `get_day_overview` (`buildDayContext(…, { forTools: true }).prompt`: cheile indicatorilor, fără lista de grafice), `get_sentiment({ days })`, `search_news({ query, range, category, coins, sentiment, limit })` (prin `newsQuerySchema` + `queryNews`), `get_calendar({ from_days, to_days, impact, currencies })`, `get_economy({ country, search, important_only, indicator })`, `get_watchlist()`, `get_chart({ symbol, timeframe, bars })` (crypto `BAZĂ/COTAȚIE` pe bursa din setări, acțiune după ticker; `runSlingshot` + `summarize` cu setările utilizatorului; ultimele ≤ 150 de lumânări), `get_market_context()`.
- Prompturi: `day_summary` („Rezumatul zilei”), `analyze_symbol({ symbol })` („Analiza unei monede sau acțiuni”).
- Erorile uneltelor (simbol necunoscut, bursa, limite) → `isError: true` cu mesajul în română; la o pereche necunoscută, și sugestiile bursei („Poate: …”).

### 6. Interfață
- `App.tsx`: `/oauth/consent` e o pagină fără meniu (`ConsentPage`), în afara `SignedInApp`; nelogat → login cu `next` înapoi (adresa scurtă).
- `pages/Consent.tsx`: aplicația și hostul, hostul de întoarcere (avertisment pentru loopback), ce vede și ce nu vede Claude, contul, **Permite** / **Refuză** → `window.location.assign(redirect)`; cerere expirată → mesaj.
- `pages/Security.tsx`: `McpSection` (doar dacă `enabled`): adresa (copiere), pașii, conexiunile cu **Deconectează**.

### 7. Teste
- Configurare: `publicUrl` (https, localhost, cale / query respinse), `enabled`.
- Oprit: toate rutele 404; `/api/mcp/status` → `enabled: false`; nimic schimbat în securitate.
- Metadata (ambele documente, câmpurile cerute de Claude).
- Autorizare: CIMD (client acceptat, host neacceptat, `client_id` diferit în document, redirect diferit, loopback pe alt port), lipsă PKCE / altă metodă, `resource` greșit, cerere → consimțământ → cod, refuz, cerere expirată / folosită.
- Token: schimb corect; verifier / redirect / client greșit; cod expirat; cod refolosit → conexiune revocată; refresh rotit; refolosire în grație / după grație; formular fără `X-Sentiq`.
- `/mcp`: `401` cu header-ul exact; client SDK real (prin `app.inject`) → `tools/list`, apeluri pe date de test, prompturi; fiecare utilizator își vede datele; token revocat / utilizator dezactivat / resursă greșită → 401; `Origin` străin → 403.
- DCR: redirect Claude acceptat, alt site refuzat, apoi autorizare cu clientul DCR.
- Revocări: `logout-all`, resetare parolă, dezactivare, „Deconectează”, `/oauth/revoke`.

---

## TD-INVITE — implementează FD-INVITE

### 1. Baza de date (migrarea 8)
- `account_requests`: `id` PK, `email` (UNIQUE, NOCASE), `name`, `created_at`.
- `user_tokens` refăcut cu `kind IN ('verify','reset','activate')` (SQLite nu schimbă un CHECK: tabel nou, copiere, ștergere, redenumire; migrările rulează cu cheile externe oprite).

### 2. `UserService`
- `requestAccount({ name, email })` → `'created' | 'ignored' | 'full'` (adresă cu cont sau cerere existentă → `ignored`; 50 în așteptare → `full`).
- `accountRequests()`; `approveRequest(id)` → `{ user, token }` (tranzacție: utilizator fără parolă, `email_verified_at` NULL, favoritele implicite, cererea ștearsă, token `activate` de 7 zile); `rejectRequest(id)`; `newActivation(userId)` (doar pentru conturi fără parolă) → token.
- `activationInfo(token)` → `{ email, name }` | null; `activate(token, password)`: regula parolei, cont existent, nedezactivat, fără parolă încă → parola, `email_verified_at`, token șters (tranzacție; doar primul din două cereri simultane reușește).
- `purgeOldRequests()` (30 de zile), în mentenanța zilnică.
- Scoase: `register`, `verifyEmail`, `resendVerification`, `setVerified`, `purgeUnverified`.
- `PublicUser.activated` (are parolă).

### 3. API
- Public: `POST /api/auth/request-account` `{ name, email }` (limita `register:` existentă, 3 / 15 min / IP) → `{ ok, message }`, iar la `created` emailul `request` către admin; `POST /api/auth/activate/check` `{ token }` → `{ valid, email, name }`; `POST /api/auth/activate` `{ token, password }` → `{ ok, email }`.
- Admin (`/api/admin/…`, deja doar pentru admin): `GET /api/admin/account-requests`; `POST /api/admin/account-requests/:id/approve` → `{ link, mailed, to, users, requests }` (pagina își pune la zi ambele liste); `DELETE /api/admin/account-requests/:id` → cererile rămase; `POST /api/admin/users/:id/activation-link` → `{ link, mailed, to }`.
- Scoase: `POST /api/auth/register`, `/api/auth/verify`, `/api/auth/resend-verification`, `/api/admin/users/:id/verify`.
- Linkurile: `config.publicUrl ?? originOf(req)`.

### 4. Emailuri (`auth/email.ts`)
- Tipuri: `activate` (linkul de activare; nu se scrie niciodată în jurnal), `request` (către admin, cu link spre `/users`), `reset`, `reset-done`; `verify` scos. `send` întoarce dacă Resend a acceptat; aprobarea îl așteaptă (max 15 s) ca să spună adminului dacă a plecat.

### 5. Interfață
- `pages/Auth.tsx`: `RequestAccountPage` (`/request-account`), `ActivatePage` (`/activate`, `useOneTimeToken`); login: „Cere un cont”; scoase `RegisterPage`, `VerifyEmailPage` și butonul de retrimitere; `/register` → `/request-account`, `/verify-email` → `/login`. `AUTH_PATHS` actualizat.
- `pages/Users.tsx`: „Cereri de cont” (Aprobă / Respinge), rezultatul aprobării / al linkului nou (trimis sau linkul cu Copiază, avertisment `localhost`), starea „Așteaptă activarea”, „Link nou de activare”; scos „Confirmă emailul”.
- `App.tsx` (meniul contului): pentru admin, cererile în așteptare (interogare la 2 minute) → punct auriu și „Utilizatori · N cereri”.

### 6. Teste
- Cererea: același răspuns pentru adresă nouă / cu cont / cerere dublă; limita pe IP; plafonul de 50; emailul către admin.
- Aprobarea: cont neactivat cu favorite, link, `mailed`; respingerea; dublă aprobare; adresă luată între timp; doar adminul.
- Activarea: verificarea linkului, parola slabă, linkul o singură dată, expirat, înlocuit de unul nou, cont dezactivat / șters; login după activare; „Am uitat parola” pentru un cont neactivat.
- Rutele vechi nu mai există; curățenia cererilor vechi.

---

## TD-STALE — implementează FD-STALE

### 1. Build (`vite.config.ts`)
- `build.emptyOutDir: false`: fișierele din `dist/web/assets` ale build-urilor anterioare rămân.
- Plugin `sentiq-prune-assets` (`apply: 'build'`, `writeBundle`): șterge din `assets/` fișierele care nu sunt în build-ul curent și au `mtime` mai vechi de 7 zile (fișierele build-ului curent sunt scrise atunci, deci sunt noi). Logica în `src/build/prune-assets.ts` (`pruneOldAssets`, testată), importată de `vite.config.ts`.

### 2. Client (`web/stale.ts`, apelat din `main.tsx`)
- `window.addEventListener('vite:preloadError', …)` (Vite îl emite pentru orice `import()` dinamic eșuat, inclusiv `React.lazy`), plus `unhandledrejection` cu mesajul de import (Safari / Chrome / Firefox) ca plasă.
- `makeRecovery()`: dacă ultima reîncărcare automată (`reloadMarker`: în `sessionStorage`, iar unde browserul îl refuză, în `window.name` al tabului, care supraviețuiește reîncărcării; fără așa ceva o eroare permanentă ar reîncărca la nesfârșit) a fost acum mai puțin de 30 s → nimic (eroarea merge la `ErrorBoundary`); altfel notează momentul, verifică `/api/ping` (`cache: 'no-store'`) la 2 s, cel mult 30 de încercări, apoi `location.reload()`. O singură recuperare în curs odată.
- Evenimentul nu e anulat (`preventDefault`): `React.lazy` primește eroarea și `ErrorBoundary` o arată cât durează așteptarea.

### 3. Teste
- `prune-assets`: păstrează fișierele build-ului curent (oricât de vechi), fișierele vechi recente; șterge fișierele vechi de peste 7 zile.
- `stale.ts`: reîncarcă după ping reușit; nu reîncarcă a doua oară în 30 s; așteaptă serverul; recunoaște mesajele de import ale celor trei browsere.

---

## TD-THEME — implementează FD-THEME

### 1. Tokenuri (`styles.css`)
- `@theme` primește în plus `--color-brass-hover`, `--color-on-brass` (textul pe auriu), `--color-scrim` (fundalul de sub ferestre), `--color-shadow` (umbrele) — cu valorile temei întunecate.
- `:root[data-theme='light']` redefinește toate `--color-*` (paleta din FD §1, contrast verificat) și `color-scheme: light`. Utilitarele Tailwind v4 citesc variabilele, iar `/opacitate` folosește `color-mix`, deci totul urmează tema.
- Înlocuiri: `#ecc87e` → `brass-hover`; `text-ink` pe auriu → `text-on-brass`; `bg-black/60` și `bg-ink/75` sub ferestre → `bg-scrim`; umbrele `rgba(0,0,0,…)` → clasele `.shadow-pop` (meniuri, liste) și `.shadow-modal` (ferestre) cu `--color-shadow`; gradientul barei de sentiment (Azi) și „pulsul” din Știri din variabile.

### 2. Aplicarea înainte de desen
- `public/theme.js` (script clasic, sincron, în `<head>` înaintea CSS-ului; CSP `'self'` îl permite): citește `localStorage['sentiq:theme']` (cu `try`) și, dacă e `light`, pune `data-theme="light"` pe `<html>` și `content="light"` în `<meta name="color-scheme">`.

### 3. `web/theme.ts`
- `getTheme()`, `setTheme(t)` (atributul, meta, localStorage cu `try`, evenimentul `sentiq:theme`), `useTheme()` (`useSyncExternalStore`), sincronizare între taburi prin evenimentul `storage`; `themeColors()` citește variabilele CSS calculate (pentru canvas).
- `components/ThemeToggle.tsx`: buton cu `Sun` / `Moon`, `aria-label` și `title` cu acțiunea; în `TopNav` (de la `sm` în sus) și în `Shell`-ul paginilor de autentificare; pe telefon, element în meniul contului (`UserMenu`, `sm:hidden`).

### 4. Grafice
- `CandleChart`: culorile layout-ului, axelor și separatorului din `themeColors()` la creare și `chart.applyOptions` la schimbarea temei (zoom-ul rămâne).
- `pnl.ts`: `PNL_COLORS` (întunecat) și `PNL_COLORS_LIGHT`; `pnlLines(…, palette)`; `Charts.tsx` alege după temă.
- `primitives.ts` (Slingshot / LMA): culorile Pine, neschimbate; tabelul TP / SL din `Charts.tsx` pe o placă închisă fixă (`#07090e` / `#262d3a`) în ambele teme.

### 5. Teste
- `theme.ts`: valoarea implicită, valori necunoscute, localStorage care aruncă, evenimentul, sincronizarea `storage`.
- `pnl.ts`: paleta luminoasă aleasă.
- Verificare în Chrome: toate paginile în ambele teme (1440 și 390), comutarea fără reîncărcare, fără clipire la încărcare, graficul recolorat.

## TD-THEME2 — implementează FD-THEME2

### 1. Accentul redenumit
- `--color-brass*` → `--color-accent`, `--color-accent-dim`, `--color-accent-hover`, `--color-on-accent`; toate utilitarele (`text-brass` → `text-accent`, `bg-brass/10` → `bg-accent/10` etc.) și `var(--color-brass)` din SVG-uri. Valorile întunecate rămân aurii (FD-REDESIGN).
- Notă: `accent-accent` (utilitarul `accent-color`) nu se folosește; checkbox-urile primesc `accent-color: var(--color-accent)` în `@layer base`.

### 2. Tokenuri noi (`@theme`, valorile întunecate) și paleta luminoasă
| Token | Întunecat | Luminos (Navy) | Rol |
|---|---|---|---|
| `chart` | `#0d1118` | `#ffffff` | canvas-ul graficului și placa lui |
| `row-alt` | `#12171f` | `#f5f7fa` | rândurile pare (tabele, liste `.rows`) |
| `row-head` | `#0a0d13` | `#e9edf2` | banda capului de tabel |
| `hover` | `#241f15` | `#dcf1f4` | hover pe rânduri, butoane, segmente, elemente de listă |
| `hover-soft` | `#17171a` | `#eef8fa` | hover pe carduri mari și cipuri |
| `selected` / `selected-line` / `on-selected` | auriu 10% / `#e2b866` / `#edeff3` | `#14233b` / `#14233b` / `#ffffff` | cipurile apăsate |
| `selected-hover` | auriu 22% | `#233b60` | cipul apăsat sub cursor |
| `bar` | `#07090e` | `#14233b` | bara de sus |
| `strip` | `#0a0d13` | `#1b2d4a` | banda pieței |
| `nav-hover` | `#151b27` | alb 14% | hover în navigare |
| `nav-active` / `on-nav-active` / `nav-active-icon` | `#1c2333` / `#edeff3` / `#e2b866` | `#ffffff` / `#14233b` / `#0b6f80` | pagina curentă |
- `--panel-shadow` (în afara `@theme`, nu e utilitar): `none` pe întunecat, umbră de 1–3 px pe luminos; `.panel` o folosește.
- Paleta luminoasă (FD §1): ink `#eef1f5`, ink-2 `#e6eaf0`, panel `#fff`, panel-2 `#f5f7fa`, panel-3 `#e9edf2`, line `#c3ccd8`, line-soft `#dde3ea`, line-strong `#a7b2c2`, text `#101828`, muted `#475467`, faint `#566174`, accent `#0b6f80` / dim `#3d8a97` / hover `#085766`, bull `#0f7444`, bear `#c2332b`, warn `#9a500a`, link `#1f5bc4`. Tema întunecată: doar `faint` trece la `#858ea0` (rămâne ≥4,5:1 și pe hover).
- Contrastul a fost calculat (WCAG) pentru fiecare text pe fiecare fundal al temei, inclusiv `row-alt`, `hover`, `row-head`, tintele verde/roșu și insula barei.

### 3. Bara închisă: „insula” `.theme-bar`
- `TopNav` (`<header>`) și `MarketStrip` primesc `theme-bar`. Pe tema luminoasă, `:root[data-theme='light'] .theme-bar` redefinește tokenurile de text, plăci, linii, accent, bull/bear/warn/link/impact și hover pentru fundal închis (`color-scheme: dark`) — componentele din bară (căutare, ceasuri, Rezumat, comutator, butonul contului, banda) nu se schimbă, iau culorile din insulă.
- Meniul contului (deschis din bară) primește `theme-page`: selectorul paletei luminoase este `:root[data-theme='light'], :root[data-theme='light'] .theme-page`, deci în meniu revin toate tokenurile paginii (fiecare token redefinit de insulă există și în paleta luminoasă).
- Pe tema întunecată ambele clase nu fac nimic (bara folosește `bar` / `strip`, egale cu vechile `ink` / `ink-2`).
- Navigarea: `bg-nav-active text-on-nav-active [&>svg]:text-nav-active-icon` pentru pagina curentă; `hover:bg-nav-hover hover:text-text` pentru celelalte.

### 4. Graficul
- `Charts.tsx`: placa graficului `bg-chart` (nu `bg-ink`); ecranul complet rămâne `bg-ink`.
- `theme.ts` `themeColors().background` citește `--color-chart`; `CandleChart` se recolorează ca până acum la evenimentul de temă.
- `pnl.ts` `PNL_COLORS_LIGHT.entry` → `#0B6F80`.

### 5. Tabele și liste (`styles.css`, `@layer components`)
- `.table thead th`: `bg-row-head`; `.table tbody tr:nth-child(even of :not(.table-detail))`: `bg-row-alt`; `.table tbody tr:not(.table-detail):hover`: `bg-hover`. Fundalul e pe `tr`, deci utilitarele de pe un rând (`bg-panel-2` la tragere) câștigă (stratul utilities > components).
- Economie: rândul de detalii primește `table-detail` (nu se numără la alternanță, fără hover) și păstrează fundalul lui adâncit; rândul indicatorului își pierde `hover:bg-panel-2/60` (hover-ul vine din `.table`).
- Tabelul favoritelor din Setări (singurul tabel într-o placă cu padding): wrapper-ul primește `table-bleed` (`margin-inline: -1.25rem`, prima / ultima celulă `pl-5` / `pr-5`); regula veche `.panel > .px-5 .table` (celule lipite de margine) dispare.
- `.rows` pentru liste: `> li:nth-child(even)` `bg-row-alt`, `> li:hover` `bg-hover`. Listele din plăci cu padding (Știri pe Azi, Alerte pe Grafice) primesc `-mx-5` pe `ul` și `px-5` pe `li`.

### 6. Hover (`@layer components` și utilitare)
- `.btn:hover`: `border-accent bg-hover text-accent`; `.btn-primary:hover`: `border-accent-hover bg-accent-hover text-on-accent`; `.btn-danger:hover`: `border-bear bg-bear/10 text-bear`; `.btn:disabled:hover`: fără schimbare (chenarul / fundalul de bază).
- `.chip:hover`: `border-accent bg-hover-soft text-accent`; apăsat: `border-selected-line bg-selected text-on-selected`, iar la hover `bg-selected-hover` cu chenar și inel `accent`. Pe tema luminoasă, cipul apăsat redefinește `text` / `muted` / `faint` (deschise), ca numărul din el (Economie) să se citească pe bleumarin.
- `.chip-soft:hover`: `bg-hover text-text`; apăsat: `border-line-strong bg-panel-3`.
- `.seg > button:hover`: `bg-hover text-accent`; selectat neschimbat (plin); dezactivat fără fundal.
- `transition-colors` (150 ms Tailwind) pe tot ce primește hover; `prefers-reduced-motion` le anulează deja.
- Toate hover-urile din `@layer components` sunt sub `@media (hover: hover)` (ca utilitarele `hover:` din Tailwind 4): pe telefon, o atingere nu lasă nimic colorat. Opțiunea selectată (segment, cip „soft”) e exclusă din hover (`:not(:disabled, [aria-pressed='true'], [aria-selected='true'])`), altfel specificitatea mai mare a hover-ului i-ar lua umplerea.
- Butoanele-icon mici (săgețile și mânerul din Setări, ochiul din asistent) și `summary`-urile („De ce acest scor?”, descrierea sursei): `hover:text-accent` (ochiul și `hover:bg-hover`).
- Ce se topea în placă pe alb: plăcuțele categoriilor de pe Azi primesc chenar `line-soft`; pista celor 30 de zile trece pe `panel-3`; lista de rezultate din Setări folosește `shadow-pop` (umbra temei).
- Utilitarele `hover:bg-panel-3` / `hover:bg-panel` / `hover:bg-panel-2/60` → `hover:bg-hover`; cardurile Azi `hover:border-accent hover:bg-hover-soft`; ProviderCard `hover:border-accent hover:bg-hover`; butoanele din bară `hover:border-accent hover:bg-hover hover:text-text`; banda: fiecare element cu `rounded-md px-1.5 -mx-1.5 hover:bg-hover`; evenimentele din Calendar cu detalii `hover:bg-hover`; opțiunea curentă din ⌘K `bg-hover`.

### 7. Teste și verificare
- `pnl.test.ts`: paleta luminoasă (culoarea de intrare).
- Test nou: tokenurile — fiecare token redefinit de `.theme-bar` există și în paleta luminoasă (altfel `.theme-page` nu l-ar reseta); niciun `brass` rămas în `src/web`.
- Chrome pe o copie a datelor: toate paginile, ambele teme, 1440 și 390 (overflow, erori în consolă), hover simulat pe rând / buton / cip / navigare, ecran complet pe grafic, meniul contului deschis pe tema luminoasă.

## TD-NOAPI — implementează FD-NOAPI

- `shared/providers.ts`: scoase `xtb`, `tradeville`, `revolut`, `degiro` din `PROVIDER_IDS` și `PROVIDERS`; câmpurile `available` și `unavailableReason` dispar din `ProviderDef` (orice platformă din listă se poate conecta).
- `server/exchange/accounts.ts` `create`: dispare verificarea `available`; un id necunoscut era deja refuzat („Platformă necunoscută”), deci și vechile id-uri.
- `web/components/AccountWizard.tsx`: `ProviderCard` fără starea dezactivată (fără `disabled`, grayscale, eticheta „fără API”); lista nu mai e sortată după disponibilitate (rămâne ordinea din `PROVIDERS`).
- `web/public/provider-logos/`: șterse `xtb.png`, `tradeville.png`, `revolut.svg`.
- Baza de date: fără migrare (coloana `exchange_accounts.exchange` nu are CHECK; niciun cont pe aceste platforme).
- Teste: `providers.test.ts` (fiecare platformă are câmpuri, pași, pagina cheii, logo; id-urile sunt unice); `server.test.ts`: `xtb` refuzat ca platformă necunoscută.
