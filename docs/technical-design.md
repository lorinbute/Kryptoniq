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
| DB | **Azure SQL Database prin `mssql` 12** (`tedious`), TD-AZURE; `node:sqlite` doar pentru importul fișierului vechi | găzduit, backup automat, aceeași bază pentru Mac și Azure App Service |
| Validare | **zod 4** | input API, setări, răspunsuri externe, ieșirile lui Claude |
| Feed-uri | **fast-xml-parser 5** + `he` | RSS 2.0 / Atom / RDF, CDATA, entități |
| Sentiment local | **@huggingface/transformers 4** (onnxruntime-node), `Xenova/nli-deberta-v3-small` q8 + reguli | cel mai bun scor la evaluare (research §3), offline |
| Claude | **@anthropic-ai/sdk** (structured outputs) | sentiment opțional, rezumatul zilei |
| Autentificare | `scrypt` (node:crypto), TOTP propriu, **@simplewebauthn/server 13** (passkey), `uqr` (codul QR) | fără add-on-uri native |
| Piață / exchange | **ccxt 4.5** (crypto, public și privat); REST propriu pentru brokeri, Nasdaq, Twelve Data | o singură bibliotecă pentru 7 exchange-uri |
| Frontend | **React 19 + Vite 8 + Tailwind 4 + TanStack Query 5 + react-router 8**, `lucide-react`, `@dnd-kit`, fonturile Geist / Geist Mono (`@fontsource-variable`) | standard, rapid |
| Grafice | **lightweight-charts 5.2** + primitive proprii | aspect TradingView, plugin API |
| Logo-uri | `@web3icons/core` (monede, servite de server la cerere), PNG / SVG oficiale (exchange-uri și brokeri) | fără resurse externe în pagină |
| Teste | **vitest 5** | unit + integrare (Fastify `inject`, scheme de test în Azure SQL, rețea simulată) |

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
    db/                   # Azure SQL: configurare, conexiune și tranzacții, schemă și migrări, importul SQLite (+ codul SQLite vechi)
    http/                 # app Fastify, securitate, cookie-uri, autentificare, rute
    jobs/                 # scheduler + job-urile
    net/http.ts           # fetch cu timeout, limită de mărime, proxy, UA
    news/                 # surse, parser, normalizare, clasificare, monede, cluster, ingestie, interogare
    sentiment/            # motoare, reguli, indice zilnic
    calendar/             # FF, TradingView, rezultate companii, potrivire, glosar
    economy/              # indicatorii pe țări
    market/               # ccxt public, acțiuni (Nasdaq, Twelve Data), context, logo-uri
    exchange/             # conturi, brokeri, reîncercări, cost mediu
    scanner/, summary/, secrets/crypto.ts
    test/                 # schemele de test (setup-ul global Vitest, testDb)
  web/                    # aplicația React: pages/, components/, chart/, public/ (theme.js, brand/, provider-logos/)
  build/prune-assets.ts   # curățenia build-ului (FD-STALE, FD-NOAPI)
scripts/                  # sentiq.sh (lansator, Sentiq.app), admin.ts, db-check.ts, import-sqlite.ts, check-node.mjs, smoke.ts, app-icon/
docs/
data/                     # runtime (gitignored): database.env (conexiunea), master.key, models/, logs/; kryptoniq.db și backups/ doar ca rezervă (importul)
```

Scripturi: `npm run dev` (server `node --watch` + Vite cu proxy `/api`), `npm start` (build web + server care servește `dist/web`), `npm run serve`, `npm test`, `npm run typecheck`, `npm run smoke`. Toate setează `NODE_USE_ENV_PROXY=1` (respectă `HTTPS_PROXY` dacă există). `scripts/sentiq.sh` pornește / oprește serverul în fundal și construiește `Sentiq.app` (TD-LAUNCH); scurtătura veche `scripts/kryptoniq.sh` nu mai există.

Porturi: server **4317** pe toate interfețele (`SENTIQ_BIND`, implicit `::`), Vite dev **5317** (`localhost`); pe App Service, `PORT`. Variabile: `SENTIQ_PORT`, `SENTIQ_BIND`, `SENTIQ_DATA_DIR`, `SENTIQ_ALLOWED_HOSTS`, `SENTIQ_MASTER_KEY`, `SENTIQ_PUBLIC_URL`, `SENTIQ_DISABLE_JOBS` (teste), `SENTIQ_QUIET` (lansatorul), `SENTIQ_PROXY=azure`; fiecare acceptă și numele `KRYPTONIQ_*`. Baza: `SENTIQ_DB_SERVER` / `NAME` / `USER` / `PASSWORD` / `PORT` sau `SENTIQ_DB_CONNECTION`, din mediu sau din `data/database.env` (TD-AZURE §1). App Service e recunoscut după `WEBSITE_SITE_NAME` (și `WEBSITE_HOSTNAME`).

## 2. Securitate

1. **Host allowlist** (anti DNS rebinding, `http/security.ts`): răspunde doar la `localhost`, adresele IPv4 / IPv6 ale Mac-ului, numele lui (cu și fără `.local`), `SENTIQ_ALLOWED_HOSTS` și gazda adresei publice; recitită la un minut. Altfel 403 „Sentiq răspunde doar pe adresele acestui Mac”.
2. **Origin**: dacă există, trebuie să fie exact gazda cererii (același origin), altfel 403.
3. **CSRF**: orice metodă ne-GET cere header-ul `X-Sentiq: 1` (`X-Kryptoniq: 1` încă acceptat, pentru taburile de dinainte de redenumire) și, cu corp, `Content-Type: application/json` (forțează preflight CORS, pe care nu îl permitem).
4. **Autentificare** (`http/auth.ts`, TD-USERS): cookie `sentiq_session` (HttpOnly, SameSite=Strict, Secure pe HTTPS), sesiuni în DB după hash (`full` 30 de zile glisante, `pending` 5 minute între parolă și codul 2FA). Rute publice doar pentru login / cerere de cont / activare / resetare / passkey și `GET /api/ping`; restul cer sesiune `full` și un cont cu 2FA (TD-2FA: fără 2FA, doar configurarea; altfel 403 `TWO_FACTOR_REQUIRED`); `/api/admin/*`, `/api/health`, sursele, rescorarea și cheile globale cer rolul `admin`.
5. **Parole**: `scrypt` (format `scrypt$N$r$p$salt$hash`, parametrii pot crește), minimum 12 caractere cu literă mare, mică și cifră. **TOTP**: SHA-1, 6 cifre, 30 s, ±1 pas, secretul criptat, un cod nu se poate refolosi (`totp_last_step`); 10 coduri de recuperare de unică folosință (SHA-256). **Passkey**: WebAuthn cu `userVerification: required`, RP = gazda cererii (merge pe `localhost`, nu pe IP). **Limitare**: 3 încercări greșite / dispozitiv → 15 minute.
6. **Secrete** (chei exchange / broker, Claude, Twelve Data, Resend, secretul TOTP): AES-256-GCM cu cheia master de 32 de octeți din `SENTIQ_MASTER_KEY` (base64) sau `data/master.key` (generată la prima pornire, `chmod 600`). Format: `v1:<iv b64>:<tag b64>:<ct b64>`. API-ul nu returnează niciodată secretul, doar un indiciu (`abcd…wxyz`).
7. **Tranzacționare doar la cerere, fără mutări de fonduri** (TD-TRADING): ordinele, anulările, levierul și marja sunt doar în `src/server/exchange/trading/`, pe conturile cu tranzacționarea pornită (parola + 2FA). Retragerile și transferurile nu există nicăieri; un test verifică ambele reguli. Restul modulelor exchange / broker doar citesc.
8. **Conținut din feed-uri**: doar text simplu (HTML eliminat, entități decodate); React escapează; link-urile doar `http(s)`, cu `rel="noopener noreferrer"`.
9. **Header-e**: CSP pe HTML `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'` (tema se aplică dintr-un fișier, `public/theme.js`, nu inline), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.
10. **Log-uri** fără secrete (redactare `apiKey|api_key|secret|password|passphrase|claudeKey|x-api-key`); linkurile de activare / resetare nu apar niciodată în jurnal.
11. Primul acces al adminului (parola) e permis doar de pe Mac (loopback; niciodată în spatele unui proxy). `scripts/sentiq.sh admin-reset` șterge parola, 2FA și passkey-urile adminului.
12. **În spatele Azure App Service** (TD-AZURE §7): IP-ul vizitatorului din `X-Client-IP`, HTTPS din `X-Forwarded-Proto` (cookie `Secure`, passkey, `Strict-Transport-Security`), răspuns 404 la sonda `/robots933456.txt`. Pe Mac aceste header-e sunt ignorate.
13. **Baza de date**: un utilizator doar pentru baza Sentiq (`db_owner` pe ea, fără acces la celelalte baze ale serverului); parola în `data/database.env` (`chmod 600`, gitignored) sau în setările App Service, niciodată în jurnal sau în mesajele de eroare.

## 3. Baza de date

**Azure SQL Database** (TD-AZURE §2–§4), prin `server/db/database.ts`:
- **Parametrii**: `?` sau `@nume`.
- **Valorile**: `BIGINT` → `number`, `Uint8Array` → `VARBINARY`.
- **Scrierile** se fac una după alta, sub un lock de aplicație per schemă (`sp_getapplock`), ca în SQLite, în toate procesele legate la aceeași bază. Fiecare secvență citire → scriere e o tranzacție (`db.tx`, `AsyncLocalStorage`).
- **Citirile** nu așteaptă (`READ_COMMITTED_SNAPSHOT`).
- **Erorile trecătoare** se reîncearcă. Baza indisponibilă → 503.

Timp = **epoch ms (`BIGINT`)** peste tot. Schema e versionată în `schema_version` (`db/schema.ts`, migrări T-SQL care doar cresc; **1** = cele 8 migrări SQLite + `job_lease`; **2** = tabelele connectorului șterse, TD-MCPREMOVE; **3** = cheile personale, scorurile AI ale fiecăruia și indicele lor, TD-AIKEYS / TD-TDKEYS; **4** = `users.totp_next_secret`, TD-2FA; **5** = tranzacționarea pe cont și `trade_log`, TD-TRADING), aplicate la pornire într-o tranzacție. Tot textul compară binar (`Latin1_General_100_BIN2`), ca în SQLite, în afară de emailuri (`CI_AS`). URL-urile și ID-urile de passkey sunt unice prin hash-ul lor. Backup: cel automat al Azure SQL. Datele de dinainte se mută o dată din `data/kryptoniq.db` (`scripts/sentiq.sh import-sqlite`, TD-AZURE §9).

| Tabel | Ce ține | Din |
|---|---|---|
| `settings` | setările globale (JSON) și cheile criptate ale aplicației | v1 |
| `sources` | sursele de știri (`category` ∈ crypto / macro / geopolitics / stocks; `auto` = feed gestionat de aplicație, ex. `nasdaq:AAPL`), starea fetch-ului; `url_hash` unic | v1, FD-SENTIQ |
| `news`, `news_coins` | știrile (relevanță, impact, flags, cluster, sentiment, `sentiment_impact` dat de Claude; `canonical_hash`) și monedele / acțiunile detectate | v1, FD-IMPACT |
| `daily_sentiment` | indicele pe zi și fus (`final` după îngheț) | v1 |
| `calendar_raw`, `calendar_custom` | evenimentele FF / TV / rezultate; evenimentele personale (`user_id`) | v1, FD-USERS |
| `job_state` | starea job-urilor (și date persistate, ex. săptămânile FF, bugetul Twelve Data) | v1 |
| `job_lease` | ce proces rulează job-urile (§4) | FD-AZURE |
| `watchlist` | registrul simbolurilor urmărite de fiecare utilizator: reuniunea listelor lui (`kind` crypto / stock / index, `name`, `exchange`, aliasuri, ordinea comună) | v1–FD-USERS, FD-WATCHLISTS |
| `watch_lists`, `watch_list_items` | listele de urmărire (nume, ordine) și simbolurile lor, în ordine (TD-WATCHLISTS) | v9 |
| `exchange_accounts`, `cost_basis` | conturile (credențiale criptate, `env`, `user_id`, tranzacționarea pornită și piețele ei) și prețul mediu introdus manual | v1–FD-USERS, FD-TRADING |
| `trade_log` | ordinele, anulările și pornirile / opririle tranzacționării trimise din Sentiq (fără chei), cu cheia formularului (unică pe utilizator) | FD-TRADING |
| `market_cache` | contextul pieței (F&G, CoinGecko, CNN, Nasdaq), lista de monede | v1 |
| `users`, `sessions`, `passkeys`, `user_tokens`, `user_settings` | conturi (cu 2FA: secretul criptat, `totp_next_secret` cât se schimbă aplicația), sesiuni (hash), passkey-uri (`credential_hash` unic), linkuri unice (`reset`, `activate`; hash), setările personale | FD-USERS, FD-INVITE, FD-2FA |
| `user_keys` | cheile personale ale fiecăruia (AI: `anthropic` / `openai` / `gemini`; `twelvedata`), criptate | FD-AIKEYS, FD-TDKEYS |
| `news_ai_scores`, `ai_daily_sentiment` | scorurile date știrilor de AI-ul fiecăruia și indicele zilei făcut din ele | FD-AIKEYS |
| `econ_indicators`, `econ_releases` | indicatorii paginii Economie și publicările lor | FD-ECON |
| `day_summaries` | ultimul rezumat al zilei, per utilizator și zi | FD-SUMMARY |
| `account_requests` | cererile de cont | FD-INVITE |

`news.id = sha1(source_id | guid ∥ canonical_url ∥ title)`. Duplicat între surse: același `canonical_url` deja existent → item ignorat. Știrile, monedele lor, scorurile, calendarul și indicatorii se scriu în loturi (un parametru JSON citit cu `OPENJSON`), un singur drum la server pe lot.

Retenție (job `maintenance`, zilnic): știrile mai vechi de `retentionDays` (implicit 90), `calendar_raw` > 400 de zile, sesiunile expirate, cererile de cont mai vechi de 30 de zile, feed-urile acțiunilor scoase din favorite, istoricul economic vechi, log-urile > 30 de zile. `daily_sentiment` se păstrează.

## 4. Scheduler și job-uri

`Scheduler` în proces (`jobs/scheduler.ts`):
- fiecare job are forma `{name, everyMs, runOnStart | firstDelayMs, timeoutMs, run(signal)}`;
- un `setTimeout` per job, cu jitter ±10%;
- rulările **nu se suprapun**; fiecare are un timeout (cu `AbortSignal`);
- erorile sunt prinse și scrise în `job_state`;
- `nudge(name, ms)` aduce o rulare mai aproape;
- `stop()` la SIGINT / SIGTERM așteaptă job-urile curente (max 5 s) și eliberează contractul;
- `SENTIQ_DISABLE_JOBS=1` le oprește (teste).

Cu mai multe procese pe aceeași bază, **job-urile rulează doar în procesul care ține `job_lease`** (60 s, reînnoit la 20 s, cu ceasul bazei; TD-AZURE §6). Celelalte doar servesc paginile; `trigger` (scanarea cerută din pagină) merge oriunde.

| Job | Interval | Ce face |
|---|---|---|
| `news.fetch` | 60 s tick | sursele active cu `next_fetch_at ≤ now` (max 4 în paralel): fetch condițional, parse, ingest; interval normal 5 min; eșec → backoff `min(60, 5·2^(failures−1))` min |
| `sentiment.score` | 20 s + după ingest | scorează știrile fără sentiment (cele mai noi primele), loturi de 16 (local) / 25 (Claude) |
| `sentiment.ai` | 60 s + după ingest | AI-ul propriu al fiecărui utilizator (FD-AIKEYS): runde de câte un lot de 25 pe utilizator, utilizatorii în paralel (câte 4), nicio rundă nouă după 5 min; un lot are 3 min, reîncercările cu tot; pauza după o eroare trecătoare crește 1 → 15 min (FD-AISLOW) |
| `sentiment.daily` | 2 min | recalculează ziua curentă, finalizează zilele trecute; o dată după o schimbare de ponderare, recalculează istoricul (FD-IMPACT §3) |
| `calendar.ff` | 15 min tick | descarcă FF doar dacă `now − last_ok ≥ 60 min` și `now ≥ blocked_until` |
| `calendar.tv` | 15 min + rafale | [azi−7z, azi+14z]; alimentează și pagina Economie; aproape de un eveniment High / Medium și până apare Actual, rulări la ~1–2 min |
| `calendar.earnings` | 6 h | rezultatele trimestriale ale acțiunilor din favoritele tuturor (Nasdaq, cu data confirmată de la TradingView: FD-EARNTV) |
| `econ.history` | 24 h | istoricul indicatorilor (~400 de zile, o dată) și calendarul publicărilor |
| `market.context` | 60 min | Fear & Greed, CoinGecko global, top 250 monede (pentru detectare; la schimbare, reetichetarea ultimelor 3 zile) |
| `stocks.market` | 5 min | starea bursei SUA, S&P 500, Nasdaq 100, VIX, Fear & Greed CNN |
| `scanner` | 5 min | Slingshot pe favoritele fiecărui cont activ, cu timeframe-ul și setările indicatorului lui (aceeași pereche cu aceleași setări se calculează o dată) |
| `maintenance` | 24 h | retenție și curățenie (§3) |

Stările sunt expuse la `GET /api/health` (admin), cu `jobsLeader` (ce instanță rulează job-urile) și `db` (server, bază, nivel, spațiu).

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
- **Indicii** favoriți (FD-INDICES) intră doar cu aliasurile lor (ca numele de companii); eticheta e id-ul `^SPX`.

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
Pentru acțiunile din favoritele tuturor, calendarul de rezultate Nasdaq pe zilele lucrătoare următoare (o cerere pe zi), salvat în `calendar_raw` cu sursa `earn`: înainte de deschidere la 08:00 ET, după închidere la 16:30 ET, altfel toată ziua; EPS estimat și EPS-ul de anul trecut. Data pe care compania a confirmat-o (scanner-ul TradingView, o cerere pentru toate acțiunile) are întâietate asupra datei Nasdaq, iar o dată Nasdaq la mai puțin de 45 de zile după ultima publicare e sărită (TD-EARNTV). Fiecare utilizator vede doar rezultatele acțiunilor lui (filtrul `calendar.earnings`).

## 8. Piață

### 8.1 Crypto (ccxt public, `market/market.ts`)
- Instanță ccxt cache-uită per exchange (`kucoin, binance, bybit, okx, bitget`), `enableRateLimit`, proxy din env; `loadMarkets()` memoizat (24 h). `lists(id, symbol)` și `timeframes(id)` (TD-MARKETSRC §2).
- **Sursa fiecărui utilizator** (`market/source.ts`, TD-MARKETSRC): exchange-ul conectat (dintre cele 5), cel ales dintre mai multe, altfel `marketData.exchange` (al adminului); o pereche sau un timeframe pe care exchange-ul lui nu le are vin de la cel implicit. Folosită de `/api/market/candles` (fără `exchange`), `/api/market/source`, `/api/market/symbols`, scanner și `get_chart`.
- `getCandles(ex, symbol, tf, limit)`: cache în memorie (LRU), TTL 10 s (TF ≤ 15m) / 30 s; cereri identice simultane deduplicate; reîmprospătare incrementală (doar lumânările de la ultimul `open time`) cât cache-ul are < 1 h, altfel descărcare completă (`paginate` peste 1500). Rezultat sortat, fără duplicate, fără valori ne-finite.
- Răspuns: `{candles: [t,o,h,l,c,v][], pricePrecision, tickSize, lastClosedIndex, fetchedAt}`.
- Reîncercări și limitele exchange-ului (KuCoin `429000` etc.): TD-RATELIMIT.

### 8.2 Acțiuni (`market/stocks.ts`, TD-SENTIQ §5)
- **Nasdaq** (fără cheie): lumânări zilnice / săptămânale, cotații, căutare, informații despre companie, rezultate, starea bursei, graficul pe 60 de zile din bandă.
- **Twelve Data** (cheia adminului, plan gratuit 8 credite / minut și 800 / zi UTC, buget local persistat): lumânările 1m – 4h; fără 3m / 6h / 8h / 12h (se alege cel mai apropiat). În afara ședinței regulate nu se cer lumânări noi; la limită se servesc ultimele, cu ora revenirii.
- **Indici** (`market/indices.ts`, `market/cnbc.ts`, TD-INDICES, TD-INDEXINTRA): prin aceeași `StockData`, după id-ul `^SPX`. CNBC întâi: cotații în timp real, zilnic din 2010 și intraday (1m / 5m / 30m / 1h, ~100 de zile; 3m, 15m, 2h, 4h comasate). Rezervă (zilnic și cotații): Nasdaq (`assetclass=index`) pentru NDX / COMP / SOX și Cboe pentru SPX / VIX / RUT / DJI.
- **Planul Twelve Data** (TD-TDPLAN): limitele bugetului vin din `/api_usage` (la salvarea cheii, la pornire, la 6 ore, la cerere), ținute în `market_cache` (`td:plan`).

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
- **Crypto** (KuCoin, Binance, Bybit, OKX, Kraken, Coinbase, Bitget): client ccxt privat (`adjustForTimeDifference`, proxy), cache-uit 10 min. Portofoliul are și soldul liber din contul futures (`totals.futuresAvailable`); `tradeStats` numără pozițiile futures închise (`exchange/trade-stats.ts`, TD-TRADESTATS). `testAccount`: `fetchBalance()` + permisiunile cheii unde exchange-ul le spune (ex. KuCoin „General”, OKX `read_only`); orice drept peste citire → avertisment.
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
| Contul meu | `GET /account`; `PUT /account/name`, `/account/password`; `POST /account/logout-all`; `GET /account/2fa`, `POST /account/2fa/start\|enable\|recovery-codes\|replace\|replace/confirm\|replace/cancel` (TD-2FA); `GET\|POST /account/passkeys`, `POST /account/passkeys/options`, `PUT\|DELETE /account/passkeys/:id` | utilizator (fără 2FA: doar `GET /account/2fa`, `start`, `enable`) |
| Admin | `GET /admin/users`, `POST /admin/users/:id/disable\|enable\|reset-2fa\|activation-link`, `DELETE /admin/users/:id`; `GET /admin/account-requests`, `POST /admin/account-requests/:id/approve`, `DELETE /admin/account-requests/:id` | admin |
| Sentiment | `GET /sentiment/today`, `/sentiment/history?days=30`, `/sentiment/day/:day`; `POST /sentiment/rescore`, `/sentiment/recompute-history` | utilizator; POST admin |
| Știri | `GET /news?range&coins&favorites&category&source&sentiment&q&cursor&limit` | utilizator |
| Surse | `GET /sources`; `POST /sources`, `/sources/test`; `PUT\|DELETE /sources/:id` | GET utilizator; restul admin |
| Calendar | `GET /calendar?from&to&impact&currencies`; `POST /calendar/custom`, `DELETE /calendar/custom/:id` | utilizator (evenimentele personale ale lui) |
| Economie | `GET /economy`, `/economy/description` | utilizator |
| Piață | `GET /market/candles`, `/market/source`, `/market/symbols`, `/market/context`, `/logo/:symbol`; `GET /stocks/search\|info\|quotes\|spark` | utilizator |
| Scanner | `GET /scanner`; `POST /scanner/run` | utilizator |
| Favorite | `GET\|POST /watchlist`; `PUT /watchlist/order`; `PUT\|DELETE /watchlist/:coin` | utilizator |
| Conturi | `GET\|POST /accounts`; `DELETE /accounts/:id`; `POST /accounts/:id/test`; `GET /portfolio/:id`, `/portfolio/:id/stats?period=` (TD-TRADESTATS); `PUT /portfolio/:id/cost-basis/:asset` | utilizator (doar conturile lui) |
| Tranzacționare (TD-TRADING) | `GET /trading`, `/trading/log`; `POST /accounts/:id/trading`; `GET /trading/:id/symbols\|instrument`; `POST /trading/:id/preview\|orders\|cancel` | utilizator (doar conturile lui, cu tranzacționarea pornită) |
| Setări | `GET\|PUT /settings`; `PUT /settings/claude-key\|twelvedata-key\|resend` | utilizator (globalele doar admin, §12; detaliile Resend doar adminului); cheile admin |
| Rezumat | `GET\|POST /summary` | utilizator |

Orice altă rută ne-`/api` → `index.html` (SPA), în afară de adresele fostului connector (`/mcp`, `/oauth/…`, `/.well-known/…`), care răspund 404 (TD-MCPREMOVE).

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
- **Personale** (`user_settings`, câte un rând): `timezone, market` (exchange-ul ales dintre cele conectate, timeframe-ul graficului), `scanner, calendar, indicator, lma, charts`. **Globale** (`settings`, doar adminul le schimbă, altfel 403): `retentionDays, sentiment, marketData` (exchange-ul implicit și istoricul graficelor, TD-MARKETSRC) și cheile (Claude, Twelve Data, Resend — criptate, în API doar `…KeySet` și un indiciu; Resend doar pentru admin).
- Tot în `settings`: `public_instance` (`{ url, at }`), adresa publică scrisă la pornire de instanța care o are (TD-ONLINE §2) și citită de celelalte prin `SettingsService.publicInstance()` (cache 30 s).
- În interfață (TD-ADMINSET): `pages/Settings.tsx` („Ale mele”: favoritele, conturile, graficele și scanner-ul, fusul orar) și `pages/SettingsAdmin.tsx` (`/settings/admin`, doar admin: sursele, motorul de sentiment, Twelve Data, păstrarea știrilor, Resend), cu `components/SettingsTabs.tsx`.
- `PUT /settings`: merge parțial, validare completă (zod), nimic salvat parțial.

## 13. Frontend
- Rute: `/` (Azi), `/news`, `/calendar`, `/economy`, `/charts[/:base/:quote | /s/:ticker]`, `/trades`, `/settings`, `/security`, `/settings/admin`, `/health` și `/users` (admin); fără cont: `/login`, `/request-account`, `/activate`, `/forgot`, `/reset-password`, `/setup`.
- Date: TanStack Query; polling (cât tab-ul e vizibil): știri, sentiment și calendar 60 s, lumânări 10 s (TF ≤ 15m) / 30 s / acțiuni 60 s, portofoliu 30 s, piață și bandă 1–10 min, Economie 5 min, Stare sistem 10 s, ping 15 s. O reîmprospătare eșuată nu șterge datele afișate; banner global când serverul nu răspunde.
- Client API: `fetch` cu `X-Sentiq: 1` pe mutații; un 401 trimite la login. `ErrorBoundary` pe pagină; o pagină încărcată la cerere care lipsește după o actualizare → o reîncărcare automată (`stale.ts`, FD-STALE).
- **Teme** (`styles.css`, TD-THEME, TD-THEME2): tokenuri Tailwind 4 (`--color-*`) pentru tema întunecată în `@theme`, cea luminoasă sub `:root[data-theme='light']`, „insula” barei (`.theme-bar` / `.theme-page`); `public/theme.js` aplică tema înainte de desen; `theme.ts` (localStorage `sentiq:theme`, sincronizare între taburi). Componentele folosesc doar tokenuri (accent `accent`, hover `hover`, rânduri `row-alt`); `palette.test.ts` verifică contrastul.
- Componente principale: `MarketStrip`, `CommandPalette`, `DaySummary`, `AccountWizard`, `ThemeToggle`, `CandleChart` (+ primitive), `SortableFavorites`, paginile din `pages/`.

## 14. Testare
- `shared/indicator`: primitive vs referință naivă (2000 de lumânări + cazuri limită); scenarii Slingshot (LONG, invalidare, TP, ATR TP / SL, Market Structure, HTF, 500 de etichete, istoric insuficient); semnalele 3.2 / 3.3 pe date reale; LMA.
- `news`, `sentiment`, `calendar`, `economy`: parser, normalizare, monede și acțiuni, cluster, clasificare, reguli (setul de 50), indicele zilnic (ponderi, plafon, cluster, DST, impactul Claude), potrivirea FF ↔ TV, rezultate, indicatori.
- `auth` și `http`: parole, TOTP, sesiuni, limitare, passkey, cereri de cont, activare, rolurile pe rute, Host / Origin / CSRF, modul Azure (IP, HTTPS, sonda); rutele API cu `fastify.inject` și rețea simulată; brokerii cu răspunsurile documentate.
- `db`: parametri, tipuri, colații, unicitate prin hash, tranzacții și lock-ul de scriere (și între conexiuni), schema, importul SQLite (și migrările SQLite vechi), `data/database.env`; contractul job-urilor.
- **Baza de test**: testele cu bază rulează în baza din `data/database.env`, fiecare worker Vitest în schema lui (`t_…`), cu un utilizator conținut fără acces la `dbo`. Setup-ul global le creează și le șterge (TD-AZURE §10); `testDb()` golește schema înaintea fiecărui test. Fără `data/database.env` sau fără acces la bază, doar acele teste eșuează, cu motivul. Fișierele fac drumuri reale la server (~5–6 minute suita completă, de pe Mac).
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
| Pierderea `data/master.key` | cheile salvate nu mai pot fi citite (se reintroduc); documentat în ghid; pe Azure aceeași cheie e în `SENTIQ_MASTER_KEY` |
| Baza Azure indisponibilă (mentenanță, rețea) | reîncercări, 503 cu mesaj, joburile reîncearcă la următoarea rulare (TD-AZURE §2) |
| Două procese pe aceeași bază | scrieri serializate (lock de aplicație), job-uri pe o singură instanță (`job_lease`) |
| Latența către Azure (~30–40 ms de pe Mac) | scrieri în loturi, un singur drum pentru o scriere simplă; App Service în aceeași regiune cu baza |

## 16. Economie (`economy/`, TD-ECON)
Indicatorii din calendarul TradingView pentru țările din `TV_COUNTRIES` (`econ_indicators`, `econ_releases`): istoricul (~400 de zile) se citește o dată (job `econ.history`), valorile noi vin din citirile calendarului (`calendar.tv`), calendarul publicărilor zilnic. Grupele, „Esențialele”, polaritatea (bun / rău pentru economie) și numele în română: `economy/names.ts`; descrierea sursei la cerere (`/api/economy/description`).

## 17. Rezumatul zilei (`summary/`, TD-SUMMARY)
`summary/context.ts` adună datele zilei utilizatorului (sentimentul, titlurile, calendarul, indicatorii publicați, contextul pieței, favoritele); `summary/service.ts` cere lui Claude (`claude-opus-5-5`, cheia adminului, structured output) verdictul, secțiunile și alegerea a 0–4 grafice din lista celor disponibile (cifrele graficelor sunt ale aplicației). Ultimul rezumat se ține per utilizator și zi (`day_summaries`); o cerere nouă cel mult la 2 minute.

## 18. Fostul connector MCP
Scos pe 14 oct 2026 (TD-MCPREMOVE): codul (`mcp/`, pagina de consimțământ, panoul), dependențele `@modelcontextprotocol/*` și tabelele lui (migrarea 2). Istoria lui e în Partea a II-a (TD-MCP, TD-MCPMULTI).

---

# Partea a II-a — Istoricul

Secțiunile de mai jos au fost scrise pentru fiecare schimbare și descriu implementarea de atunci; Partea I spune ce e valabil azi. Înlocuite ulterior: v1 (`127.0.0.1`, fără login, doar KuCoin, meniu lateral, paleta inițială) → Partea I; SQLite (`node:sqlite`, `PRAGMA user_version`, `VACUUM INTO`) din v1 și din TD-* până la TD-NOAPI → TD-AZURE (Azure SQL; codul SQLite rămâne doar pentru import); TD-REDESIGN (numele tokenului `brass`) → TD-THEME2 (`accent`); TD-SENTIQ (lista de platforme cu XTB, Tradeville, Revolut, Degiro și câmpul `available`) → TD-NOAPI; TD-USERS (înregistrarea și confirmarea emailului) → TD-INVITE; TD-SENTIQ (scurtătura `scripts/kryptoniq.sh`) și TD-LAUNCH (`kryptoniq.sh`, `Kryptoniq.app`) → `scripts/sentiq.sh`, `Sentiq.app`.

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
- **`barcolor`**: când `colorBars` e activ și LMA e afișat, lumânările primesc per bară doar `color` (corpul) = culoarea semnalului; marginea și fitilul rămân ale setărilor graficului (FD-BARCOLORBODY).
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
  - pe iPhone / iPad nu le cere deloc → `'css'` (TD-IPADFS2);
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
  - `fetchOpenOrders()` fără simbol; pentru Binance `options.warnOnFetchOpenOrdersWithoutSymbol = false`; pentru Bybit `{ type: 'spot' }`, pagina 50 (clientul ccxt pornește pe linear: fără asta lipseau ordinele spot); la fel `fetchMyTrades` pe Bybit (`{ type: 'spot' }`, pagina 100), plus tranzacțiile linear separat (`{ type: 'swap', subType: 'linear' }`);
  - FD-TRADING §4, `EXTRA_ORDER_READS`: ordinele pe care lista simplă nu le are, ca fiecare să se poată anula:
    - Binance: futures USDⓈ-M (`{ type: 'swap', subType: 'linear' }`), obișnuite și cu declanșare (`trigger: true` → ordinele algo);
    - Bybit: linear (`settleCoin: 'USDT'`, pagina 50; contul unificat dă toate felurile de ordine, stop-urile incluse);
    - OKX: ordinele cu declanșare (`trigger: true` → algo `trigger`; cele obișnuite, din toate produsele, sunt deja în lista simplă);
    - Bitget: stop-urile spot (`{ type: 'spot', trigger: true }`), futures USDT-M obișnuite și cu declanșare;
    - fiecare citire separat; una pe care cheia sau contul nu o poate face (`NotSupported`, `PermissionDenied`, `AuthenticationError`, `AccountNotEnabled`, Binance `-2015` venit ca `DDoSProtection`, nereîncercat) nu listează nimic acolo și nu se mai cere 15 minute, iar una cerută greșit (`ArgumentsRequired`, `BadRequest`) se scrie o dată în jurnal și nu se mai cere 6 ore („Testează” și ștergerea contului le uită pe amândouă); orice altă eroare marchează secțiunea „orders”, ca la lista simplă;
  - piața unui ordin și a unei tranzacții se ia din simbol: un perpetuu (`BTC/USDT:USDT`) e futures, oricare listă l-ar fi adus (contul unificat KuCoin, OKX). O tranzacție futures nu intră niciodată în costul mediu spot;
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
- `News.tsx`, „De ce acest scor?”: fiecare importanță cu sursa ei în paranteză, ca valori separate: „Relevanță 0,8, importanță 1 (Claude), importanță 3 (cuvinte-cheie)” când diferă; „importanță 2 (Claude și cuvinte-cheie)” când coincid; „importanță 2 (cuvinte-cheie)” fără notă AI. Prima importanță e cea folosită în index (formularea veche „(Claude; după cuvinte-cheie ar fi 3)” lăsa impresia că 3 e nota lui Claude).

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

## TD-AZURE — implementează FD-AZURE

### 1. Driver și configurare
- Driver: **`mssql` 12.7.6** (peste `tedious` 20), singurul pachet nou la rulare. `node:sqlite` rămâne doar pentru importul din fișierul vechi (§9).
- `server/db/config.ts` — `loadDbConfig(env, dataDir)`:
  - citește `<dataDir>/database.env` cu un parser propriu: linii `NUME=valoare`; `#` doar la început de rând e comentariu; valoarea e **tot** ce urmează după primul `=` (fără ghilimele, fără `#` ca comentariu, fără expandare), doar `\r` final scos. Motiv: `util.parseEnv` taie parolele la `#` și la `'`. Doar cheile `SENTIQ_DB_*` sunt citite.
  - mediul (`process.env`) are prioritate, cheie cu cheie (App Service pune setările în mediu).
  - `SENTIQ_DB_CONNECTION` (connection string ADO.NET) → `ConnectionPool.parseConnectionString`; altfel `SENTIQ_DB_SERVER` / `NAME` / `USER` / `PASSWORD` (+ opțional `SENTIQ_DB_PORT`, implicit 1433). Lipsa oricăruia → `DbConfigError` cu mesajul din FD-AZURE §2.
  - opțiuni fixe: `encrypt: true`, `trustServerCertificate: false`, `appName: 'Sentiq'`, `connectTimeout: 30 s`, `requestTimeout: 60 s`, pool `max 10` (teste: 3), `min 0`, `idleTimeoutMillis 30 s`.
  - `describeDb()` pentru jurnal / Stare sistem: `server/bază (utilizator)`, niciodată parola.
- `config.ts`:
  - `db: DbConfig | null`, `dbError: string | null` (aplicația nu pornește fără `db`);
  - `proxy: 'azure' | null` — `'azure'` când există `WEBSITE_SITE_NAME` (pus de App Service) sau `SENTIQ_PROXY=azure`;
  - port: `SENTIQ_PORT`, apoi `PORT` (App Service), apoi 4317;
  - `dataDir`: `SENTIQ_DATA_DIR`, altfel `/home/data` în modul Azure (`wwwroot` se rescrie la fiecare publicare), altfel `data/`;
  - `allowedHosts` + `WEBSITE_HOSTNAME` (adresa `*.azurewebsites.net`);
  - `legacyDbPath`: `data/kryptoniq.db` / `data/sentiq.db`, doar pentru import.
- Jurnal: redactarea acoperă și `pwd` / `Password=` din connection string-uri.

### 2. `Db` (`server/db/database.ts`, rescris, asincron)
```ts
class Db {
  static open(cfg: DbConfig, opts?: { poolMax?: number; migrate?: boolean }): Promise<Db>;
  static shared(pool, cfg): Db;         // un pool al altcuiva (testele: unul per worker); close() nu-l închide
  all<T>(sql, params?): Promise<T[]>;   get<T>(sql, params?): Promise<T | undefined>;
  run(sql, params?): Promise<{ changes: number; lastInsertRowid: number }>;
  tx<T>(fn: () => Promise<T>): Promise<T>;
  info(): Promise<DbInfo>;   close(): Promise<void>;
}
```
- **Parametri**: `?` poziționali (array) se traduc o dată per text SQL (cache) în `@p0…@pN`, sărind peste literali `'…'`, identificatori `[…]` / `"…"` și comentarii; sau parametri numiți `@nume` (obiect), pentru instrucțiunile care folosesc aceeași valoare de două ori (upsert). Valori: `undefined` → `null`, `boolean` → 1 / 0, `Uint8Array` → `Buffer` (altfel `mssql` l-ar trimite ca text), restul după tipul JS (întreg ≤ int32 → `Int`, mai mare → `BigInt`, zecimal → `Float`, text → `NVarChar`). Peste 2000 de parametri → eroare (limita SQL Server e 2100): listele lungi și loturile merg ca un singur parametru JSON, citit cu `OPENJSON`. Un `NULL` pleacă drept `NVARCHAR`: într-o coloană `VARBINARY` intră doar cu `CONVERT(VARBINARY(MAX), …)` (importul o face).
- **Rezultate**: coloanele `BIGINT` vin de la `tedious` ca text → convertite în `number` după metadatele coloanei (timpii în ms încap exact în 2^53). `VARBINARY` vine ca `Buffer` (e și `Uint8Array`).
- **Scrieri serializate, ca în SQLite**: orice scriere ia întâi un lock exclusiv de aplicație, `sp_getapplock @Resource = 'sentiq:write:' + SCHEMA_NAME(), @LockOwner = 'Transaction', @LockTimeout = 30000`, deci scrierile se execută una după alta în toate procesele legate la aceeași bază (Mac + Azure, instanțele dintr-o actualizare). Citirile nu iau lock: Azure SQL are `READ_COMMITTED_SNAPSHOT` pornit, deci văd ultima stare salvată, fără să aștepte.
  - `run()` în afara unei tranzacții = **un singur drum la server**: `SET XACT_ABORT ON; BEGIN TRAN; <lock>; <instrucțiunea>; SELECT @@ROWCOUNT AS __changes, CAST(SCOPE_IDENTITY() AS BIGINT) AS __id; COMMIT`. `changes` = rândurile ultimei instrucțiuni, `lastInsertRowid` = identitatea ultimului `INSERT` (0 dacă nu există).
  - `tx(fn)`: `Transaction` `mssql` (READ COMMITTED) + `SET XACT_ABORT ON` + lock, apoi `fn` rulează într-un `AsyncLocalStorage`: orice `all/get/run` din `fn` (și din funcțiile chemate de ea) merge pe conexiunea tranzacției. Tranzacțiile imbricate se alătură celei exterioare. Pe o tranzacție, cererile se pun la coadă (`mssql` nu permite două deodată pe aceeași conexiune), deci și un `Promise.all` din `fn` merge. După `COMMIT` / `ROLLBACK`, starea e marcată „încheiată”: o promisiune lansată din `fn` și terminată mai târziu nu mai folosește tranzacția.
  - **Regulă**: în `fn` doar baza de date (fără rețea, fără Claude, fără exchange-uri), ca lock-ul să țină milisecunde.
  - Lock așteptat peste 30 s → `DbBusyError` → 503 (`DB_UNAVAILABLE`).
  - Un lot întrerupt de timeout-ul clientului lasă tranzacția deschisă pe conexiunea din pool (`XACT_ABORT` nu acționează la un „attention”). De aceea fiecare citire și fiecare scriere simplă începe cu `IF @@TRANCOUNT > 0 ROLLBACK`. O tranzacție care găsește la început `@@TRANCOUNT > 1` se anulează și se reia.
- **Erori trecătoare** (Azure): citirile și deschiderea tranzacțiilor se reîncearcă de 3 ori (0,25 / 1 / 3 s) la erori de conexiune (`ESOCKET`, `ETIMEOUT`, `ECONNCLOSED`, `ECONNRESET`) și la codurile 40613, 40197, 40501, 49918–49920, 10928, 10929, 4221, 233, 64, 1205. O scriere din afara unei tranzacții se reîncearcă doar dacă nu a ajuns la server (eroare la obținerea conexiunii) sau a fost respinsă înainte de execuție (40501, 49918–49920, 10928, 10929, 1205); altfel nu se știe dacă s-a salvat, deci eroarea urcă. Epuizat → `DbUnavailableError` → 503.
- **Erori de pornire** → mesajele din FD-AZURE §2: `ELOGIN` / 18456 (utilizator / parolă), 40615 (IP-ul din mesaj nu e în firewall), 4060 (baza nu există sau lipsește accesul), `ESOCKET` / `ETIMEOUT` / `EINSTLOOKUP` (serverul nu răspunde, cu cuvintele driverului la „Detaliu”).
  - Corectat 2026-10-14, după prima pornire pe App Service: tedious trimite un login refuzat (firewall, parolă, bază) ca `ConnectionError` cu codul `ELOGIN`, fără număr de eroare.
    - Pornirea îl reîncerca drept trecător, iar după reîncercări rămânea doar `DbUnavailableError`, raportat ca „serverul nu răspunde”.
    - Acum `connectRetryable` nu reîncearcă un `ELOGIN`, decât dacă tedious l-a marcat trecător (`isTransient`, de exemplu o bază în mutare).
    - `explainConnectError` citește cauza unui `DbUnavailableError`.
    - Teste: `db/connect-errors.test.ts`, cu erorile construite ca ale driverului.
- `info()`: serverul din config, `DB_NAME()`, `DATABASEPROPERTYEX(… 'Edition' | 'ServiceObjective' | 'MaxSizeInBytes')`, mărimea din `sys.dm_db_partition_stats` (`reserved_page_count · 8 KB`); fără permisiunea `VIEW DATABASE STATE` (utilizatorii de test) → `null`.

### 3. Schema (`server/db/schema.ts`)
- `schema_version(version INT)` + listă de migrări T-SQL care doar crește. Fiecare migrare e o listă de loturi (fără `GO`). Toate migrările lipsă rulează într-o singură tranzacție, sub lock-ul de scriere (§2), deci două procese care pornesc deodată nu migrează de două ori (al doilea găsește versiunea la zi). Existența tabelelor se verifică cu nume calificate (`QUOTENAME(SCHEMA_NAME()) + '.schema_version'`), ca un utilizator de test să nu vadă tabelele din `dbo`.
- **Migrarea 1** = starea finală a celor 8 migrări SQLite, plus `job_lease`. Conversii:

| SQLite | Azure SQL |
|---|---|
| `INTEGER` timp (ms) | `BIGINT` |
| `INTEGER` contor / boolean (0 / 1) / poziție | `INT`; `passkeys.counter` → `BIGINT` (contorul WebAuthn e pe 32 de biți fără semn) |
| `INTEGER PRIMARY KEY [AUTOINCREMENT]` | `INT IDENTITY(1,1)` |
| `REAL` | `FLOAT` |
| `BLOB` | `VARBINARY(MAX)` |
| `TEXT` cheie / în index | `NVARCHAR(n)` cu `n` pe măsură (PK ≤ 450 de caractere), colația `Latin1_General_100_BIN2` |
| `TEXT` liber (titluri, rezumate, JSON, URL-uri) | `NVARCHAR(MAX)`, `Latin1_General_100_BIN2` |
| `TEXT … COLLATE NOCASE` (emailuri) | `NVARCHAR(320) COLLATE Latin1_General_100_CI_AS` |
| `UNIQUE` pe coloană care poate fi `NULL` (`users.email`) | index unic filtrat `WHERE email IS NOT NULL` (SQL Server permite un singur `NULL` într-un `UNIQUE` simplu) |
| `UNIQUE` pe text lung (`sources.url`, `passkeys.credential_id`) | coloană calculată `… AS CAST(HASHBYTES('SHA2_256', col) AS BINARY(32)) PERSISTED` + index unic pe ea (cheia unui index are maxim 1700 de octeți) |
| index pe `news.canonical_url` | `canonical_hash` calculat + index; la ingest, hash-urile adreselor unui lot se calculează în SQL din lista JSON (`HASHBYTES('SHA2_256', value)`), iar adresa găsită se compară apoi exact |

- **Identitățile** continuă după cele importate (`IDENTITY_INSERT`). Spre deosebire de SQLite, un `INSERT` respins (de exemplu un email duplicat) consumă totuși un număr, deci id-urile pot avea goluri. Nimic din aplicație nu presupune id-uri consecutive.
- **Colația**: comparațiile și ordonările rămân exact ca în SQLite (binar, sensibil la litere mari / mici) pentru tot textul, în afară de emailuri, indiferent de colația implicită a bazei create de utilizator. Unde un text din `OPENJSON` se compară cu o coloană, primește `COLLATE Latin1_General_100_BIN2` explicit (altfel: „collation conflict”). Diferență acceptată: SQL Server ignoră spațiile de la final în `=` (textele sunt deja curățate la intrare).
- `ON DELETE CASCADE` ca în SQLite; nu există două drumuri de cascadă spre același tabel (verificat: `users → mcp_grants → mcp_tokens`, `users → exchange_accounts → cost_basis`, `sources → news → news_coins`).
- Rândul inițial al adminului (id 1, fără email și parolă): `SET IDENTITY_INSERT users ON`, timpul din `DATEDIFF_BIG(MILLISECOND, '19700101', SYSUTCDATETIME())`.
- `TABLES` (ordinea de ștergere, copiii întâi) e exportată pentru teste și import; un test verifică faptul că acoperă toate tabelele din schemă.

### 4. Dialectul (conversia interogărilor)
| SQLite | T-SQL |
|---|---|
| `INSERT … ON CONFLICT(k) DO UPDATE SET c = excluded.c` | `UPDATE t SET c = @c WHERE k = @k; IF @@ROWCOUNT = 0 INSERT …` (parametri numiți; fără cursă, pentru că scrierile sunt serializate) |
| `INSERT OR IGNORE` | `INSERT … SELECT … WHERE NOT EXISTS (…)` |
| `INSERT OR REPLACE` (`calendar_raw`) | upsert-ul de mai sus, cu toate coloanele |
| `LIMIT n` | `TOP (n)` (parametrul se mută la începutul listei) |
| `group_concat(x)` | `STRING_AGG(x, ',')` |
| `json_each(?)` | `OPENJSON(?)` + `COLLATE` |
| `substr(x, 1, instr(x, ':') - 1)` | `LEFT(x, CASE WHEN CHARINDEX(':', x) > 0 THEN CHARINDEX(':', x) - 1 ELSE 0 END)` (`LEFT` cu lungime negativă dă eroare) |
| `expr AS flag` (boolean în `SELECT`) | `CASE WHEN expr THEN 1 ELSE 0 END` |
| `CASE WHEN ? THEN` | `CASE WHEN ? = 1 THEN` |
| `PRAGMA optimize` | scos (statisticile sunt automate) |
| interogări fără `ORDER BY` al căror rezultat contează ca ordine | `ORDER BY` explicit (SQL Server nu garantează ordinea de inserare) |

### 5. Codul devine asincron
- Toate metodele care ating baza devin `async`, împreună cu apelanții lor: `createContext` (seed-ul surselor, setările, adminul), serviciile, rutele (deja `async`), job-urile, `Scheduler` (`job_state`), scripturile.
- Apelurile date ca funcții sincrone devin asincrone: cheia Twelve Data pentru `StockData`, setările Resend pentru `Mailer`, `userActive` pentru `OAuthService`.
- **Fiecare secvență citire → decizie → scriere** care până acum era atomică pentru că SQLite e sincron intră într-un `db.tx`: aprobarea cererilor de cont, activarea, prima parolă, resetarea, TOTP (pasul folosit, codurile de recuperare), passkey (contorul), înregistrarea clienților OAuth și schimbul codurilor / rotația tokenurilor, favoritele (poziția următoare, limita), conturile (limita), evenimentele personale (limita), sursele, ingestul știrilor, scorarea, upsert-urile.
- Cache-urile din memorie se actualizează după `COMMIT`, nu înainte, și expiră, pentru că alt proces poate schimba aceeași bază: setările după 30 s (`SETTINGS_TTL_MS`), detectorul de monede (favoritele tuturor) după 5 minute.
- Limitatorul de încercări (login, codul 2FA, acțiunile cu parolă din Securitate) tratează încercările aceluiași apelant una după alta (`Throttle.serial`). Altfel, încercări trimise în paralel ar fi trecut toate de verificare înainte să fie numărată vreuna. Cererile de cont se numără înainte de răspunsul bazei, dar doar cele valide.
- Mailurile pleacă în fundal (răspunsul durează la fel, cu sau fără mail) și își citesc setările din bază, deci linkul apare în jurnal puțin după răspuns.

### 6. Joburile pe o singură instanță (`job_lease`)
- Tabel `job_lease(name PK, owner, host, expires_at BIGINT)`; fiecare proces are un `owner` aleator și `host` = numele mașinii.
- La pornire și apoi la fiecare 20 s, `Scheduler` încearcă să ia / să prelungească contractul (60 s), în tranzacție, cu timpul serverului (`SYSUTCDATETIME`, nu ceasul local): îl ia dacă e al lui sau a expirat.
- Lider: rulează job-urile ca până acum. La câștigarea contractului își programează job-urile ca la o pornire. La pierderea lui își oprește timerele (rularea curentă se termină).
- Celelalte procese nu rulează job-uri (`nudge` e ignorat). `trigger` rulează local oricum: scanarea cerută din interfață și cea pornită de `GET /api/scanner` pe un proces care nu e lider (rezultatele scanner-ului sunt în memoria fiecărui proces), cel mult o dată pe minut.
- La oprire contractul e eliberat (`expires_at = 0`), ca noua instanță dintr-o actualizare să preia imediat.
- `/api/health` primește `jobsLeader: { host, self }`, citit din contract (`currentLeader`), deci corect și pe un proces cu joburile oprite.

### 7. În spatele Azure App Service (`proxy = 'azure'`)
- `registerSecurity` pune pe fiecare cerere `req.clientIp`, `req.viaHttps` și `req.behindProxy` (`clientIpOf`, `viaHttpsOf`, `http/security.ts`):
  - `clientIp`: `X-Client-IP` (pus și suprascris de front-end-ul App Service) dacă e un IP valid; altfel ultimul element din `X-Forwarded-For` (cel adăugat de front-end), fără port (App Service pune `ip:port`); altfel socket-ul. În afara Azure: socket-ul (ca înainte), iar header-ele sunt ignorate. Înlocuiește `req.ip` peste tot (limite, sesiuni, OAuth).
  - `viaHttps`: `X-Forwarded-Proto` = `https` în modul Azure, altfel `req.protocol`. Folosit pentru cookie-ul `Secure`, passkey (RP) și linkuri. `trustProxy` din Fastify rămâne oprit (ar lua `ip:port` drept IP).
- `isLoopback(req)` e mereu fals în spatele proxy-ului (prima parolă de admin nu se poate seta de acolo).
- `GET /robots933456.txt` (sonda de pornire App Service) → 404 înaintea verificării gazdei.
- `Strict-Transport-Security: max-age=31536000` pe răspunsurile HTTPS.

### 8. Pornire (`main.ts`)
Pașii pornirii:
1. `loadConfig`: dacă `db` lipsește, mesaj în jurnal și ieșire cu cod 1.
2. `Db.open`: conectare și migrare; erorile sunt traduse.
3. `createContext(config, log, { db })`. Dacă nu există cheia master (`SecretBox.available`), dar baza are ceva criptat (conturi, cheile aplicației, secrete TOTP), refuză în loc să facă o cheie nouă.
4. Aplicația, apoi job-urile (dacă nu sunt oprite).

O eroare la pașii 2–4 e scrisă în jurnal și oprește procesul cu cod 1. La oprire: `app.close`, `scheduler.stop` (eliberează contractul), `db.close`.

### 9. Importul (`scripts/import-sqlite.ts`, `sentiq.sh import-sqlite [--replace]`)
1. Dacă `http://localhost:<port>/api/ping` răspunde → refuză (FD-AZURE §3), cu `--force` ca ieșire.
2. Copie consistentă a fișierului (`VACUUM INTO` într-un fișier temporar; dacă nu merge, fișierul împreună cu `-wal` și `-shm`). Dacă `user_version` < 8, pe copie se aplică migrările SQLite vechi (`db/sqlite-legacy.ts`, codul SQLite de dinainte, păstrat doar pentru import și testele lui). La > 8, refuză.
3. `Db.open` pe Azure (migrează schema). Baza e „goală” dacă nu are niciun utilizator cu email sau parolă, nicio știre și niciun cont de exchange. Seed-ul unei porniri anterioare pe baza nouă (surse, setări, cele 3 favorite) nu contează ca date. Altfel e nevoie de `--replace`.
4. O singură tranzacție: șterge toate rândurile (ordinea din `TABLES`), apoi copiază tabelele în ordinea părinte → copil, în `INSERT`-uri pe mai multe rânduri (≤ 1000 de rânduri și ≤ 2000 de parametri pe instrucțiune), cu `IDENTITY_INSERT` pe tabelele cu identitate. Coloanele = cele comune ambelor scheme (fără cele calculate). `BLOB` → `Buffer`.
5. Verifică numărul de rânduri pe tabel (în tranzacție). Dacă există cheia master (`SecretBox.available`), încearcă să deschidă o cheie salvată cu ea (avertisment dacă nu merge). Dacă nu există, avertizează: o cheie nouă nu se face niciodată aici. Afișează un rezumat (tabel: rânduri).

### 10. Testele în aceeași bază (`server/test/`)
- `vitest.config.ts`: `globalSetup` + maxim 4 workeri (baza e mică); setup-ul face câte o schemă pentru fiecare worker posibil (`maxWorkers`).
- `global-setup.ts` (cu utilizatorul din `data/database.env`):
  1. șterge resturile mai vechi de 3 ore ale altor rulări (`t_<yyyymmddhhmm>_…`);
  2. pentru fiecare worker creează un utilizator conținut cu parolă aleatoare și o schemă cu același nume (`CREATE USER … WITH PASSWORD, DEFAULT_SCHEMA`; `CREATE SCHEMA … AUTHORIZATION`; `GRANT CREATE TABLE`; `DENY SELECT, INSERT, UPDATE, DELETE, ALTER, REFERENCES, EXECUTE ON SCHEMA::dbo`);
  3. migrează schema fiecăruia;
  4. dă credențialele workerilor prin `project.provide`;
  5. la final șterge (cheile străine, tabelele, schema, utilizatorul).
- `testDb()`: un `Db` pe utilizatorul workerului (`VITEST_POOL_ID`), cu pool comun pe worker (`close()` nu-l închide). La fiecare apel, într-o tranzacție, golește toate tabelele în afară de `schema_version`, resetează identitățile (doar unde au fost folosite: `sys.identity_columns.last_value`) și pune la loc rândul adminului — echivalentul unei baze noi `:memory:`.
- Un utilizator de test nu poate citi sau scrie în `dbo`, deci un test greșit nu atinge datele reale. Lock-ul de scriere e per schemă, deci testele nu blochează aplicația.
- Testele migrărilor SQLite rămân (`sqlite-legacy.test.ts`: importul unui fișier mai vechi le folosește); testele importului pornesc de la o bază SQLite v8 cu date de probă și verifică în Azure rândurile, tipurile, identitățile, BLOB-urile, emailurile fără diferență de litere și hash-ul URL-urilor.

### 11. Lansatorul și scripturile
- `sentiq.sh start`: înainte de pornire verifică faptul că există configurația bazei. Altfel afișează mesajul din FD-AZURE §2 și nu pornește.
- Comenzi noi:
  - `import-sqlite [--replace] [--force]`: §9;
  - `db-check`: `scripts/db-check.ts` — conectare, server, bază, nivel, spațiu, versiunea schemei, nivelul de compatibilitate (≥ 130 pentru `OPENJSON`), dacă utilizatorul e `db_owner` și dacă e adminul serverului (`dbo`, care ajunge și la celelalte baze); fără parolă.
- `scripts/admin.ts` folosește `Db.open` pe baza din `data/database.env`; `scripts/smoke.ts` rulează într-o schemă de test temporară (ca testele), ștearsă la final.
- `docs/deploy-azure.md`: pașii pentru App Service.
  - Planul: B1 Linux, în aceeași regiune cu serverul bazei, o instanță; B2 din 14 oct 2026 seara (build-ul nu încăpea lângă aplicație pe B1).
  - Runtime-ul: Node 24 LTS, cu startup `node src/server/main.ts`.
  - Setările:
    - Always On, HTTPS only, TLS ≥ 1.2;
    - FTP oprit, publicarea cu parolă (basic auth) oprită;
    - health check `/api/ping`.
  - Variabilele de mediu: `SENTIQ_DB_*`, `SENTIQ_MASTER_KEY` din Key Vault, `SENTIQ_PUBLIC_URL`, `NODE_ENV=production`, `SCM_DO_BUILD_DURING_DEPLOYMENT=true` (build-ul se face pe Linux, deci `onnxruntime-node` și `sharp` primesc binarele potrivite).
  - Build-ul (corectat 2026-10-14, după prima publicare eșuată): `CUSTOM_BUILD_COMMAND=bash scripts/azure-build.sh`.
    - Problema: Oryx face implicit `npm install` + `npm run build`, dar cu `NODE_ENV=production` npm sare peste devDependencies, iar `vite build` pica („vite: not found”).
    - Scriptul face `npm ci --include=dev`, apoi `npm run build`, apoi `npm prune --omit=dev`, ca la pornire să se despacheteze doar dependențele serverului.
    - Tot el exportă `ONNXRUNTIME_NODE_INSTALL=skip`: pe Linux x64, `onnxruntime-node` ar descărca fișierele CUDA (sute de MB), iar modelul rulează pe CPU, cu binarele din pachet.
    - Verificat local: scriptul rulat cu `NODE_ENV=production` pe o copie a zip-ului, apoi serverul pornit din copie (dependențe fără dev) pe o schemă de test.
  - Firewall-ul Azure SQL: **toate** IP-urile de ieșire ale aplicației (`outboundIpAddresses`; aplicația iese prin oricare dintre ele).
  - Domeniul și certificatul gestionat.
  - Publicarea: zip deploy.

### 12. Riscuri
| Risc | Atenuare |
|---|---|
| Latența: fiecare interogare face un drum la server (~1–2 ms din aceeași regiune, ~40–60 ms de pe Mac) | scrierile simple într-un singur drum; loturi la ingest, la import și la reset-ul testelor; citirile independente ale paginii Stare sistem și ale setărilor deodată; App Service și baza în aceeași regiune |
| Concurența apărută odată cu asincronul | lock-ul de scriere + tranzacții pe toate secvențele citire → scriere (§5); review dedicat |
| Două instanțe pe aceeași bază | `job_lease` (§6) + scrieri serializate |
| Testele încarcă baza reală (S0, 10 DTU) | maxim 4 workeri, scheme separate, lock per schemă |
| Uitarea `await` (o scriere care nu mai așteaptă) | tsc (tipurile `Promise`) + o căutare a apelurilor fără `await` / `return` la fiecare review |
| Parola în jurnal | nu se scrie niciodată; redactare pentru `Password=` / `pwd=` |
| Node 24 pe App Service (pe Mac e 25) | doar API-uri disponibile în 24 (`engines >= 24`); pornirea verificată pe Node 24.21 |
| Rosetta / Docker | nefolosite: nu e nevoie de un SQL Server local |

## TD-ONLINE — implementează FD-ONLINE

### 1. Connectorul
Doar configurare: app setting `SENTIQ_MCP=1` pe `sentiq` (App Service); `SENTIQ_PUBLIC_URL=https://sentiq.money` era deja pus de utilizator, iar domeniul e legat cu certificat SNI. Codul FD-MCP rămâne neschimbat.

### 2. Adresa publică în bază
- Rândul `settings` cu cheia `public_instance`, valoare JSON `{ "url": "https://sentiq.money", "mcp": true, "at": <ms> }`.
- `publishPublicInstance(db, config)` (în `settings.ts`), chemat din `createContext` după `seedSources`:
  - `config.publicUrl` setat și hostul nu e loopback → `UPSERT_SETTING`;
  - altfel, dacă `config.proxy === 'azure'` (App Service fără adresă publică) → `DELETE`;
  - altfel (Mac, teste) → nimic.
- `SettingsService.publicInstance()`: citește rândul, îl verifică prin `parsePublicInstance` (`url` trecut prin `parsePublicUrl` și nu loopback; `mcp` e adevărat doar pentru `true`) și îl ține în cache `SETTINGS_TTL_MS` (30 s). Rezultatul e `{ url, mcp } | null`; un JSON stricat sau o adresă nevalidă dau `null`.
- `publicBase(ctx)` (în `http/auth-routes.ts`): `ctx.config.publicUrl ?? (await ctx.settings.publicInstance())?.url ?? null`.
- `linkBase(req)` devine asincron: `publicBase ?? originOf(req)`. Îl folosesc linkul de activare și emailul către admin despre o cerere nouă. Linkul de parolă uitată rămâne pe `originOf(req)`, adică adresa de pe care a fost cerut.

### 3. Connectorul văzut de pe o instanță fără el
- `oauth.ts`: `listConnections(db, userId, now)` și `revokeGrantIn(db, log, id, userId, why, now)` devin funcții de modul. `OAuthService.connections` / `revokeGrant` le cheamă, deci comportamentul rămâne același.
- `registerMcpApi(app, ctx)` primește contextul (avea doar `oauth`):
  - `GET /api/mcp/status`:
    - cu `ctx.oauth`: ca înainte;
    - altfel, cu `publicInstance()?.mcp`: `{ enabled: true, url: <url>/mcp, connections }`;
    - altfel: `{ enabled: false }`.
  - `DELETE /api/mcp/connections/:id`: cu `ctx.oauth` → `oauth.revokeGrant`; altfel, cu `publicInstance()?.mcp` → `revokeGrantIn(…, userId)`; altfel 404.
  - Rutele consimțământului (`/api/oauth/requests/:id`) rămân doar pe instanța cu `oauth`. Cererile sunt în memoria ei.

### 4. Starea de login și textele
- `AuthState.publicUrl?: string | null` (`publicBase`; opțional, lipsește la un server mai vechi). Pagina de login o folosește în nota despre passkey-uri (FD-ONLINE §3).
- `App.tsx` / `OfflineBanner`: textul pentru Mac doar când `location.hostname` e `localhost`, `127.0.0.1` sau `[::1]`; altfel textul general.
- Textele din `Settings.tsx`, `SettingsAdmin.tsx` (motorul de sentiment, emailul), `AccountWizard.tsx`, `Security.tsx` și `Auth.tsx`, ca în FD-ONLINE §3; în jurnalul de pornire, nota despre passkey-uri pe adresele din rețea (`main.ts`).

### 5. Teste
- `publishPublicInstance`: scrie pentru o adresă publică; nu scrie pentru loopback; șterge pe Azure fără adresă; nu atinge nimic local.
- `publicInstance()`: valoare validă, JSON stricat, loopback ignorat, cache-ul.
- Linkul de activare pe o instanță fără `SENTIQ_PUBLIC_URL`, dar cu adresa în bază → `https://…/activate?token=`.
- `/api/mcp/status` fără connector local, dar cu `public_instance.mcp` → `enabled`, `url`, conexiunile utilizatorului (nu ale altuia); `DELETE` pe o conexiune proprie → revocată; pe una străină → 404.
- `/api/auth/state` → `publicUrl`.

## TD-ADMINSET — implementează FD-ADMINSET

### 1. Rute și fișiere
- `App.tsx`:
  - `/settings` → `SettingsPage`;
  - `/settings/admin` → `AdminSettingsPage`, doar pentru admin (altfel „Pagina nu există.”, ca `/users`).
  - Linkul „Setări” din meniu nu are `end`, deci rămâne activ și pe fila Admin.
  - Căutarea primește `{ to: '/settings/admin', label: 'Setări admin', admin: true }`, într-o listă doar pentru căutare (`SEARCH_PAGES`).
- `components/SettingsTabs.tsx`: bara cu file (`NavLink`-uri cu `end`, fila activă subliniată cu `border-accent`, `aria-current="page"` pus de router). Apare doar pentru admin.
- `pages/Settings.tsx` („Ale mele”): Favorite (`#watchlist`), Conturi (`#accounts`), Grafice și scanner (`#market`), General (`#general`, doar fusul orar).
- `pages/SettingsAdmin.tsx` („Admin”): nota „Aceste setări se aplică tuturor utilizatorilor.”, apoi Surse de știri (`#sources`), Motorul de sentiment (`#sentiment`), Date de piață (`#market-data`: cheia Twelve Data și consumul), Păstrarea știrilor (`#retention`), Email (`#email`).
- `hooks.ts`: `useSaveSettings()` (mutat din `Settings.tsx`) și `useHashScroll(ready)` (derularea la ancoră, folosită de ambele pagini). `ready` așteaptă și listele de deasupra ancorei: sursele pe Admin, favoritele și conturile pe „Ale mele”; altfel ancora ar fi împinsă în jos când se încarcă.
- Linkuri: `DaySummary.tsx` → `/settings/admin#sentiment`; `Charts.tsx` → `/settings/admin#market-data`.

### 2. Server
- `SettingsService.viewFor`: pentru un utilizator care nu e admin, `resendKeySet`, `resendKeyHint`, `resendFrom` și `resendDev` nu mai apar în răspuns (sunt opționale în `SettingsView`).
- Restul (403 la cheile globale, `USER_KEYS`) rămâne neschimbat.

### 3. Teste
- `GET /api/settings` ca utilizator: fără câmpurile Resend; ca admin: cu ele.
- Interfața: verificată în Chrome (admin: ambele file, ancorele, căutarea; utilizator: fără file, `/settings/admin` → „Pagina nu există.”).

## TD-AUTOFEED — implementează FD-AUTOFEED
- `syncStockSources(db, added?)`:
  - un feed automat (`auto = 'nasdaq:SYM'`) al cărui simbol nu mai e în niciun `watchlist` se **șterge** (`DELETE FROM sources`). Știrile lui pleacă prin `ON DELETE CASCADE` (`news` → `news_coins`);
  - întoarce simbolurile șterse, iar apelanții (pornirea, mentenanța, schimbarea favoritelor, ștergerea unui utilizator) le scriu în jurnal (`news: removed the automatic feed of BSOL (in nobody's favourites)`);
  - totul rămâne într-o singură tranzacție, ca înainte.
- Pornirea (`createContext`) rulează deja `syncStockSources`, deci feed-urile rămase de dinainte se șterg la prima pornire.
- `Settings → Admin → Surse`: textul etichetei „automată” (FD-AUTOFEED §2).
- Teste (`news.test.ts`):
  - acțiunea scoasă din singurele favorite → feed-ul și știrile lui șterse;
  - acțiunea încă în favoritele altui utilizator → feed-ul rămâne;
  - un feed automat oprit de admin, cu acțiunea încă în favorite → rămâne oprit;
  - un feed rămas de dinainte (oprit, cu știri, fără favorite) → șters la `syncStockSources`;
  - o sursă manuală cu aceeași adresă → nu se dublează și rămâne după ce acțiunea iese din favorite.

## TD-TODAYGRID — implementează FD-TODAYGRID
- `TodayPage`: ordinea `SentimentTile`, `NextEventTile`, `LiveNewsTile`, `DriversTile`, `HistoryTile`, `CoinsTile`.
- Clase:
  - `SentimentTile`: `md:row-span-2 xl:col-span-7` (era `md:col-span-2 xl:row-span-2`): de la 768 px are coloana stângă și două rânduri, iar `NextEventTile` și `LiveNewsTile` intră singure în dreapta, unul sub altul. E și `@container`: categoriile sunt `grid-cols-2 @lg:grid-cols-4` (după lățimea plăcii, nu a ecranului); etichetele „Negativ” / „Pozitiv” ale spectrului și „, N știri” sunt `@max-sm:hidden`;
  - `DriversTile`: `xl:col-span-7`;
  - `HistoryTile`: `xl:col-span-5`;
  - secțiunea favoritelor: `md:col-span-2 xl:col-span-12`.
- Grila rămâne `md:grid-cols-2 xl:grid-cols-12`. Cele două plăci au aceeași înălțime (`stretch`); graficul celor 30 de zile își păstrează `h-16` sus în placă.
- Verificat în Chrome la 1600 / 1440 / 1280 / 1024 / 800 / 390 px de lățime, cu 14 favorite și cu știrile și calendarul reale din ultimele 36 de ore, copiate într-o schemă de test.

## TD-MARKETSRC — implementează FD-MARKETSRC

### 1. Setări (`shared/settings.ts`, `server/settings.ts`)
- `MARKET_EXCHANGES` = `kucoin, binance, bybit, okx, bitget`.
- `market` (al fiecăruia) = `{ exchange?, defaultTf }`.
  - `exchange` e acum doar **preferința** dintre exchange-urile conectate, opțională: lipsește până când utilizatorul alege (atunci contează primul adăugat); o valoare salvată înainte contează ca alegere;
  - `candles` iese din grupul personal (zod îl ignoră în rândurile vechi).
- `marketData` (global, doar adminul) = `{ exchange: MARKET_EXCHANGES = 'kucoin', candles: 1500 | 3000 | 5000 = 1500 }`. Nu e în `USER_KEYS`.
- `SCANNER_TFS = ['15m', '1h', '4h', '1d']` (comutatorul de pe Azi; toate cinci exchange-uri le au).
- `SettingsService.migrateMarketData(adminId)`, la pornire, după `migrateLegacyToAdmin`: dacă rândul global nu are `marketData`, ia `market.exchange` și `market.candles` din rândul personal (JSON brut) al adminului, validate. Scrierea se face prin `writeGlobal`, în tranzacție, deci o singură dată pe Mac + Azure.

### 2. Sursa prețurilor (`market/source.ts`, nou)
`MarketSource(db, settings, market)`:
- `connected(userId)`: `SELECT exchange FROM exchange_accounts WHERE user_id = ? ORDER BY id`, păstrate doar cele din `MARKET_EXCHANGES`, fără dubluri. Cache 30 s pe utilizator; `forget(userId)` îl golește.
- `forUser(userId)` → `{ exchange, connected, defaultExchange, candles }`:
  - un singur exchange conectat → acela;
  - mai multe → `market.exchange` dacă e printre ele, altfel primul;
  - niciunul → `marketData.exchange`.
- `forSymbol(userId, symbol, tf?)`: exchange-ul utilizatorului dacă listează perechea (și are `tf`, când e dat); altfel cel implicit, dacă el o listează (și are `tf`); altfel tot al utilizatorului (eroarea lui ajunge la pagină). Perechea trece la cel implicit doar când se știe că exchange-ul utilizatorului n-o are: dacă piețele lui nu se pot citi (pană), rămâne al lui.

`MarketData` primește:
- `lists(id, symbol)`: perechea spot, activă, în `loadMarkets`;
- `timeframes(id)`: cheile lui `ex.timeframes` care sunt în `TIMEFRAMES`.

### 3. API
- `GET /api/market/source?symbol=` → `{ exchange, userExchange, connected, defaultExchange, candles, timeframes }`.
  - `exchange` e cel folosit pentru `symbol` (fără `symbol`: al utilizatorului);
  - `timeframes` sunt cele pe care le are `exchange`.
- `GET /api/market/candles`:
  - fără `exchange` → `forSymbol(user, symbol)`. Un `exchange` explicit (un tab vechi) e încă acceptat;
  - `limit` implicit = `marketData.candles`.
- `GET /api/market/symbols?q=` → caută pe exchange-ul utilizatorului și pe cel implicit; rezultatele se unesc după `symbol` (ale utilizatorului întâi), maximum 50.
- `POST /api/accounts` și `DELETE /api/accounts/:id` → `marketSource.forget(userId)` și `nudge('scanner')`.
- `/api/scanner` (încă fără rezultat) → `exchange` din `forUser`.

### 4. Scanner și connector
- `Scanner.runFor`: `forSymbol(userId, symbol, s.scanner.tf)` pentru fiecare monedă. Cheia de memo conține exchange-ul. Istoricul vine din `marketData.candles`, la fel pentru rândurile de acțiuni.
- `ScanResult.exchange` = al utilizatorului.
- `mcp/server.ts` `get_chart`: `forSymbol` + `marketData.candles`.

### 5. Interfață
- `hooks.ts`: `useMarketSource(symbol?)` (cheia `['market-source', symbol ?? '']`, `staleTime` 30 s).
- `MarketStrip.useSparks`: fără `exchange` în cerere; cheia `['spark', userExchange, symbol]`, ca să se reîncarce la o schimbare.
- `CommandPalette`: cheia simbolurilor include `userExchange`.
- `Charts.tsx`:
  - pentru crypto: `useMarketSource(symbol)`; butoanele timeframe-urilor pe care exchange-ul nu le are sunt dezactivate (`title` „<Exchange> nu are 8h”);
  - `activeTf` = cel mai apropiat disponibil (`nearestTimeframe`, fostul `stockTimeframe`, comun cu acțiunile), cu nota „<Exchange> nu are X; graficul arată Y”;
  - Market Structure: `htfAvailable` și pentru crypto;
  - numele exchange-ului din `candles.data.exchange`; `limit` din `settings.marketData.candles`; `viewKey` cu exchange-ul sursei;
  - cererile fără `exchange`.
- `Settings.tsx` („Ale mele”): fără `MarketSection`. În Conturi, cu ≥ 2 exchange-uri dintre cele 5 conectate: „Prețurile crypto vin de la:” (segment cu logo-uri), care salvează `market.exchange` și invalidează `market-source`, `spark`, `candles`, `scanner`.
- `SettingsAdmin.tsx` → Date de piață: „Exchange implicit pentru prețurile crypto” și „Istoric încărcat pe grafice”, apoi Twelve Data.
- `Today.tsx`: deasupra favoritelor, „Semnale Slingshot” cu segmentul `SCANNER_TFS` (plus valoarea salvată, dacă e alta); salvează `scanner.tf`.
- `AccountWizard` (cont adăugat) și ștergerea unui cont: invalidează `market-source`, `spark`, `candles`, `scanner`.
- Numele exchange-urilor (`EXCHANGE_NAME`): plus Bitget.

### 6. Teste
- `MarketSource`:
  - fără conturi → implicit;
  - un cont Kraken → implicit;
  - un cont Bybit → Bybit;
  - Binance + Bybit cu preferința Bybit → Bybit; fără preferință → primul;
  - perechea lipsă → implicit;
  - timeframe lipsă → implicit;
  - piețele care nu se încarcă → al utilizatorului;
  - `forget`.
- Migrarea `marketData` din setările adminului; un rând personal vechi cu `market.candles` se citește fără eroare.
- Rutele: `/api/market/source`, `/api/market/candles` fără `exchange` (sursa aleasă după cont), `/api/market/symbols` unite, contul adăugat schimbă sursa.
- Interfața, în Chrome pe o schemă de test: „Ale mele” fără secțiune; alegerea cu două conturi; Admin → Date de piață; comutatorul de pe Azi; graficul cu OKX (8h dezactivat).

## TD-TRADESTATS — implementează FD-TRADESTATS

### 1. Soldul futures (în `Portfolio`)
- `Portfolio.totals.futuresAvailable: number | null`; o eroare în `errors.futures` (secțiunea „Cont futures”).
- Citit în `AccountsService.load` (crypto), în paralel cu restul, cu `FUTURES_BALANCE[exchange]`:
| Exchange | Apel ccxt (clientul spot) | Valoare |
|---|---|---|
| KuCoin | `fetchBalance({ type: 'contract', code: 'USDT' })` (în modul UTA ccxt citește contul unificat) | `free.USDT` |
| Binance | `fetchBalance({ type: 'future' })` | `free.USDT` |
| Bybit, OKX | `fetchBalance()` (cont unificat) | `free.USDT` |
| Bitget | `fetchBalance({ type: 'swap' })` | `free.USDT` |
| Kraken, Coinbase | – | `null` (fără futures) |
- Brokerii: `futuresAvailable: null`.

### 2. Statisticile pozițiilor închise
- `AccountsService.tradeStats(accountId, period, tz)` → `TradeStats`:
  - `{ period, from, to, supported, wins, losses, breakeven, successRate, net, netPartial, currency: 'USD', error, fetchedAt }`;
  - `period` ∈ `today | 7d | 30d | 90d`; `from` = 00:00 de azi în `tz` (Azi) sau acum − N zile; `to` = acum.
- Doar crypto, doar exchange-urile cu `fetchPositionsHistory` în ccxt: KuCoin (clientul spot alege singur UTA sau clasic), Bybit (`subType: 'linear'`), OKX, Bitget. Pentru celelalte: `supported: false`.
- **Ferestre de 7 zile** (limita KuCoin și Bybit), cerute câte 3 deodată.
  - O fereastră care întoarce cât limita pe cerere (KuCoin 200, celelalte 100) se înjumătățește, recursiv, până sub limită (sau sub o oră).
  - Pozițiile se deduplică după `id` (sau `info.closeId`), apoi se păstrează cele cu `lastUpdateTimestamp` (ora închiderii) în `[from, to]`.
- Rezultatul unei poziții (`netResult`): `info.netProfit` la Bitget (cifra lui netă; `realizedPnl` din ccxt e `pnl`-ul brut); altfel `realizedPnl` (KuCoin `pnl`, Bybit `closedPnl`, OKX `realizedPnl`: toate după comisioane și funding).
  - Decontarea e partea de după `:` din simbol (`BTC/USDT:USDT` → USDT).
  - Stablecoins (USDT, USDC, …) → valoarea ca atare. Alte monede → `× preț` (`fetchTicker('<MONEDĂ>/USDT')`, o dată pe monedă). Fără preț → doar la numărare, `netPartial: true`.
- Numărare: `> 0` câștig, `< 0` pierdere, `= 0` `breakeven`.
  - `successRate` = `wins / (wins + losses) × 100` sau `null` fără tranzacții;
  - `net` = suma rezultatelor convertite.
- Cache în memorie: `(accountId, period)` → 5 minute; `force` îl ocolește. Cererile identice simultane se unesc (`inflight`).
- Erori: `mapExchangeError` → `error: { code, message }`, cu `wins / losses / net = null`.
- Reîncercări ca la portofoliu (`retryOn`).

### 3. API
- `GET /api/portfolio/:id/stats?period=today|7d|30d|90d&force=1`: contul trebuie să fie al utilizatorului (`ownAccount`); fusul orar vine din setările lui.

### 4. Interfață (`Trades.tsx`)
- Bara de sus: `[Tranzacții] [conturile] … [Reîmprospătează] [Adaugă un cont]`.
  - „Reîmprospătează” (`useRefreshAccount(id)`) cere `/api/portfolio/:id?force=1` și `/stats?force=1` pentru perioada aleasă și pune rezultatele în cache.
- `PortfolioView` (crypto): o grilă de 7 carduri (`grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7`), în ordinea din FD-TRADESTATS §2.
  - Dedesubt: „Statistici pe” cu comutatorul `Azi · 7z · 30z · 90z` (localStorage `sentiq:trades-period`, cu `try/catch`) și rândul cu tipul contului și „actualizat acum …”.
  - Query `['portfolio-stats', id, period]`, `staleTime` 60 s, `refetchInterval` 5 min.
- `PortfolioView` (brokeri): neschimbat; doar butonul s-a mutat.
- Cardul „Valoare în contul spot” are `title` cu explicația (FD-TRADESTATS §1).
- `SECTION_RO.futures` = „Cont futures”.

### 5. Setări → Favorite
- Paragraful de sub titlu pierde `max-w-[75ch]`.

### 6. Teste
- `tradeStats` cu un client fals:
  - ferestre de 7 zile și înjumătățirea unei ferestre pline;
  - deduplicarea; pozițiile în afara perioadei;
  - câștig / pierdere / zero; rata de succes; decontarea în monedă (cu și fără preț);
  - „Azi” în fusul orar;
  - exchange fără suport; eroarea; cache-ul și `force`.
- Portofoliul: `futuresAvailable` pentru KuCoin (`type: 'contract'`), `null` pentru Kraken; eroarea în `errors.futures`.
- Ruta: contul altui utilizator → 404; perioadă invalidă → 400.

## TD-MCPMULTI — implementează FD-MCPMULTI
- `config.ts`: `SENTIQ_MCP_CLIENTS` implicit = `claude.ai, claude.com, chatgpt.com, oauth-redirect.googleusercontent.com`.
- `oauth.ts`:
  - `resolveClient` (CIMD): documentul e acceptat dacă `token_endpoint_auth_method` lipsește sau e `none`, **sau** dacă `token_endpoint_auth_methods_supported` conține `none`.
  - `register` (DCR): metoda cerută poate fi `none`, `client_secret_basic` sau `client_secret_post`. Clientul e salvat public, iar răspunsul are `token_endpoint_auth_method: 'none'` (RFC 7591 §3.2.1).
  - Mesajele de refuz spun „aplicațiile AI acceptate”.
- `routes.ts` `/oauth/token`: `client_id` din formular, altfel din antetul `Authorization: Basic` (partea dinaintea lui `:`, decodată URL), altfel din `client_assertion` (`sub`, apoi `iss`, din payload-ul JWT, fără verificarea semnăturii: PKCE și legarea codului de `client_id` + `redirect_uri` rămân verificarea). Textele paginii de eroare: „aplicația AI”.
- `Consent.tsx`: titlul și listele cu `client.name` (de ex. „ChatGPT”, „Claude”, „Claude Code”); hostul rămâne afișat.
- `Security.tsx`: panoul „Asistenți AI (connector)”, cu pașii pentru Claude, ChatGPT și Gemini (CLI și aplicație) și textele generale.
- Teste (`mcp.test.ts`):
  - documentul real ChatGPT (cu `private_key_jwt` + `none`) → autorizare, consimțământ, cod, schimb cu `client_id` în formular și în antetul Basic;
  - un document doar cu `private_key_jwt` → refuzat;
  - DCR în stilul Gemini (`client_secret_basic`, întoarcere `https://oauth-redirect.googleusercontent.com/r/abc`) → înregistrat ca public, conectare completă;
  - un host necunoscut → refuzat;
  - `client_assertion` cu `sub`.

## TD-DBHEAL — implementează FD-DBHEAL
- `Db.detached(fn)`: rulează `fn` cu `txStore.exit(fn)`, deci în afara oricărei tranzacții. Scheduler-ul îl folosește la reînnoirea lease-ului (`start` / `tick`) și la fiecare rulare de job (`execute`).
- `Db.healStuckLock()`, chemat din `query()` (scrieri) și `tx()` (`begin` + lacăt) când lacătul nu vine (`isLockTimeout`):
  - cel mult o dată la 60 s pe instanță;
  - pe o conexiune din pool, fără lacăt, citește sesiunea care deține `APPLICATION` `sentiq:write:<schema>` (`sys.dm_tran_locks` + `dm_exec_sessions` + `dm_tran_session_transactions` / `dm_tran_active_transactions` + textul ultimei instrucțiuni);
  - dacă `program_name = 'Sentiq'` și tranzacția are peste `STUCK_TX_MS` (5 min): o verifică din nou (aceeași sesiune, același `login_time`), apoi `KILL <spid>`; în jurnal `database: ended a stuck session …`;
  - orice eroare (fără drept de `KILL`, DMV-uri indisponibile) → `false`, în liniște.
  - Dacă a închis ceva, scrierea se mai încearcă o dată.
- `program_name` vine din `appName: 'Sentiq'` (deja setat pe conexiuni).
- `main.ts`: la SIGTERM / SIGINT, un temporizator de 15 s (`unref`) iese cu `process.exit(0)` dacă oprirea (`app.close`, `scheduler.stop`, `db.close`) nu s-a terminat.
- Teste:
  - `detached` (un apel din interiorul unei tranzacții nu i se alătură);
  - reînnoirea lease-ului dintr-un context de tranzacție rămâne separată;
  - decizia de vindecare pe rânduri simulate (vârstă, program, sesiunea schimbată) și limita de o dată pe minut.

## TD-UIPOLISH — implementează FD-UIPOLISH
- `Today.tsx`: `TrendArrow` (`TrendingUp` / `TrendingDown` din lucide, `text-bull` / `text-bear`, `role="img"` cu `aria-label` și `title` „Uptrend (Slingshot)” / „Downtrend (Slingshot)”) în locul cuvintelor; numele monedei e `truncate` într-un `min-w-0`.
- `styles.css`: în `@layer base`, `input` (fără checkbox / radio / range / color) și `select` au `min-h-[38px]`, ca `.btn`; în `@media (pointer: coarse)` (`@layer components`), `.btn`, câmpurile și dropdown-urile au `min-h-[44px]`. `News.tsx`: dropdown-ul „Sursă” coboară minimul (`min-h-8`, pe ecrane tactile `min-h-9`), ca să rămână la înălțimea cipurilor. Câmpul de căutare din Știri, fără chenar, într-un `form` de `h-8`, are `min-h-0`. `Charts.tsx`: previzualizarea unei linii nu mai are `h-8`; rândul ei e `items-stretch`, deci are înălțimea dropdown-ului de stil.
- `Settings.tsx`: rândurile favoritelor au `[&>td]:align-middle` (`.table td` rămâne `align-top` în rest); rândul de adăugare e `items-stretch`, iar câmpul `h-full`, deci are înălțimea comutatorului.
- `Trades.tsx`: comutatorul perioadei (`PERIODS`, `choosePeriod`) trece din `CryptoCards` în bara din `AccountsView`, înaintea butoanelor, doar pentru conturile crypto. `CryptoCards` păstrează eroarea istoricului și rândul „actualizat …”.

## TD-INDICES — implementează FD-INDICES

### 1. Identitate și catalog (`shared/indices.ts`)
- Un indice e un rând `watchlist` cu `kind = 'index'`, `coin` = id-ul cu `^` (`^SPX`), `quote = 'USD'`, `name` din catalog, `exchange` NULL. Coloana `kind` n-are CHECK, deci **fără migrare**.
- Prefixul `^` (convenția Cboe / Yahoo) desparte indicele de moneda sau acțiunea cu același simbol (SPX6900, Compound, Compass): cheia `(user_id, coin)` nu se mai ciocnește.
- `INDICES`: `{ id: '^SPX', symbol: 'SPX', name: 'S&P 500', aliases: [...] }` pentru cele 7; `isIndexId(s)`, `indexById(id)`, `indexId(symbolSauId)` (normalizează „spx” / „SPX” / „^SPX”, altfel `null`), `plainSymbol(coin)` (fără `^`, pentru afișare), `searchIndices(term)` (simbol sau nume, fără diacritice și majuscule), `INDEX_TIMEFRAMES = ['1d', '1w']`, `INDEX_DELAY_NOTE`.
- `LISTED_SYMBOL_RE`: o acțiune (`STOCK_SYMBOL_RE`) sau `^` + 2–6 litere; rutele care primesc ambele îl folosesc, iar indicele se verifică apoi în catalog.

### 2. Datele (`server/market/indices.ts`, `stocks.ts`)
- `INDEX_SOURCES`: `^SPX → cboe _SPX`, `^VIX → cboe _VIX`, `^RUT → cboe _RUT`, `^DJI → cboe _DJX × 100`, `^NDX / ^COMP / ^SOX → nasdaq`.
- `CboeClient` (`cdn-api.cboe.com/api/global/delayed_quotes/…`, aceleași anteturi de browser ca Nasdaq):
  - `quote(code, scale)`: `current_price`, `price_change`, `price_change_percent`, `open/high/low`, `last_trade_time` (ora New York) → `StockQuote` (`name` din catalog, `status` din starea bursei Nasdaq);
  - `daily(code, scale)`: `charts/historical/<code>.json`, tot istoricul (SPX ~1,7 MB); rândurile cu O/H/L/C ≤ 0 sau nefinite se sar (SPX înainte de 1996);
  - `todayBar`: din cotație (`open/high/low/current_price`, ziua din `last_trade_time`), doar cu `open > 0`.
- `NasdaqClient`: `quote / daily / today` primesc o clasă fixă (`'index'`), în loc să încerce `stocks` apoi `etf`.
- `StockData` rutează după `isIndexId`:
  - `candles(id, tf, count)`: doar `INDEX_TIMEFRAMES`, altfel `UNSUPPORTED_TIMEFRAME` („Indicii au doar 1d și 1w”); id necunoscut → `UNKNOWN_SYMBOL`;
  - `IndexData.history(id)`: istoricul zilnic, ținut 5 minute (cereri simultane unite), comun pentru 1d, 1w, `spark` și scanner; lumânarea zilei se adaugă dacă e mai nouă decât ultima din istoric. Peste el, cache-ul lumânărilor din `StockData` (aceleași reguli ca la acțiuni: 15 minute pe 1d, până la deschidere cât piața e închisă); `1w` = `weeklyFromDaily`;
  - `exchange` în răspuns: `cboe` / `nasdaq`; `pricePrecision` 2;
  - `quote(id)`: TTL ca la acțiuni; `spark(id)`: ultimele 60 de închideri;
  - `timeframesFor(sym)`: `INDEX_TIMEFRAMES` pentru indici, altfel `timeframes()`.

### 3. API (`http/routes.ts`)
- `POST /api/watchlist` primește și `{ kind: 'index', coin: 'SPX' | '^SPX' }`: `indexId` → altfel 400 „Indice necunoscut”; numele și aliasurile din catalog; duplicat → 409 „SPX este deja în favorite (ca indice)”.
- `symbolRe` (ordine, aliasuri, ștergere) acceptă `^` în față; `PUT` refuză altă cotare decât USD pentru orice nu e crypto.
- `listWatchlist` trimite `kind: 'crypto' | 'stock' | 'index'`.
- `GET /api/market/candles?asset=index&symbol=SPX` (sau `^SPX`); `/api/stocks/quotes` și `/api/stocks/spark` acceptă id-uri de indici (`LISTED_SYMBOL_RE`, apoi catalogul).
- Rutele rămase care citesc `kind` (scanner, conturi) tratează ca acțiune tot ce nu e `crypto`, nu doar `stock`.

### 4. Server, în rest
- **Scanner**: `w.kind !== 'crypto'` → `stockRow(coin, kind, …)`; timeframe-ul din `timeframesFor`; `ScanRow.kind` are și `'index'`; `symbol` = `^SPX/USD`.
- **Conturi** (`accounts.ts`): perechile favoritelor doar pentru `kind = 'crypto'` (altfel `^SPX/USDT` ar fi căutat pe exchange).
- **Știri** (`coin-registry.ts`, `coins.ts`): rândurile `index` merg într-o a patra hartă, `indices: id → aliasuri`, adăugate ca numele de companii (proprii, cu majuscule sau Title Case) și legate de id; fără potrivirea simbolurilor goale (`^` nu apare în texte). `newsQuerySchema.coins` acceptă `^`.
- **Feeduri automate, rezultate, calendar**: rămân pe `kind = 'stock'` (indicii nu au feed Nasdaq și nici rezultate).
- **MCP**: `get_chart` acceptă `^SPX`; un simbol fără `^` rămâne acțiune, ca înainte; descrierea spune „or a US index (^SPX, ^NDX, ^COMP, ^DJI, ^RUT, ^VIX, ^SOX)”; timeframe sub 1d → 1d cu nota „Timeframe … is not available for indices; showing 1d.”; `rowLines` scrie `(index: S&P 500)` / `(stock)`.
- **Rezumat** (`summary/context.ts`): „(indice)” / „(acțiune)”.

### 5. Interfață
- `api-types.ts`: `WatchItem.kind: 'crypto' | 'stock' | 'index'`; `ScanRow.kind` la fel.
- `chart/paths.ts`: `indexChartPath('^SPX') = '/charts/i/SPX'`; `chartPathOf` pentru `index`; `charts.symbol` salvat ca `index:SPX`; `rememberedPath` îl înțelege. `App.tsx`: ruta `/charts/i/:index` (case-sensitive, ca `/charts/s/`).
- `CoinLogo`: pentru un id `^…`, insigna pătrată cu pictograma `ChartNoAxesCombined`, culoarea după simbol.
- `Settings.tsx`: comutatorul cu trei valori; la „Indici”, sub rând, o listă de butoane (`IndexPicker`, din `searchIndices`: toți 7 cu câmpul gol), nu un dropdown: apare imediat și nu depinde de focus; cele deja adăugate marcate „în favorite” și dezactivate; tabelul: „Indice”, „indice SUA”, simbolul fără `^`. Adăugările, ștergerile și aliasurile numără schimbările în curs: un răspuns se afișează doar când e singura schimbare în curs, iar după ultima lista se recitește (răspunsurile pot sosi în altă ordine decât cererile).
- `Today.tsx`, `MarketStrip.tsx`: tot ce nu e crypto merge pe fișa / bulina de acțiune; simbolul fără `^`; `title` cu întârzierea pe preț.
- `Charts.tsx`: `ChartsPage` citește `:index`; `ChartView` primește `listed` (acțiune sau indice) și `index`; timeframe-urile `INDEX_TIMEFRAMES`, motivul dezactivării „Indicii au doar 1d și 1w”; titlul cu simbolul simplu și numele indicelui; căutarea are grupul „Indici”.
- `CommandPalette.tsx`: favoritele indici (eticheta fără `^`, numele ca indiciu) și grupul „Indici” (cu cel puțin 2 caractere).
- `News.tsx`: cipurile și etichetele știrilor arată simbolul fără `^`; insigna indicelui vine din `CoinLogo` (după `^`), deci `useStockSet` rămâne doar pentru acțiuni. `TopicIcon`: „indice” la trecerea cursorului.
- `shared/settings.ts`: `CHART_SYMBOL_RE` acceptă `index:SPX` (graficul ținut minte).

### 6. Teste
- `shared/indices.test.ts`: `indexId`, `plainSymbol`, `searchIndices` („s&p”, „dow”, diacritice).
- `market/indices.test.ts`: parsarea Cboe (cotație, istoric cu rânduri 0 sărite, DJX × 100, lumânarea zilei fără `open`), un refuz Cboe (403) ca eroare a sursei, Nasdaq cu clasa `index`; `StockData`: 1d / 1w, 1h refuzat, lumânarea zilei adăugată o singură dată, cache-ul comun cu `spark`.
- `server.test.ts`: adăugarea după „SPX” și „^SPX”, duplicatul, moneda SPX și indicele SPX împreună, indice necunoscut, ordine / aliasuri / ștergere cu `^`, lumânările și cotațiile prin API.
- `scanner.test.ts`: rândul unui indice (1d, `STOCK_TF_FALLBACK` cu semnalele pe 1h).
- `news.test.ts`: aliasurile unui indice etichetează `^SPX`; „SPX” cu moneda și indicele în favorite → indicele; filtrul de știri cu `^SPX`.
- `mcp.test.ts`: `get_chart` cu `^SPX` (și 1h → 1d cu nota).

## TD-ROWCENTER — implementează FD-ROWCENTER
- `Settings.tsx`, rândurile favoritelor (`[&>td]:align-middle` rămâne):
  - butoanele de ordine stau într-un `div` `flex items-center` (fără `align-middle` pe mâner);
  - logo-ul, simbolul și numele, într-un `div` `flex min-w-0 items-center gap-2` (în loc de `span` `inline-flex`, care stătea pe linia de bază);
  - coșul, într-un `div` `flex justify-end`;
  - câmpul de aliasuri e `block w-full` (fără spațiul liniei de bază sub el).
- Verificare: `getBoundingClientRect` pentru fiecare celulă față de mijlocul rândului; înainte −2,9 px (săgeți, logo, simbol, coș), după 0.
- `deploy-azure.md` §5: planul B2 (schimbat de utilizator), publicarea fără oprirea aplicației; oprirea rămâne rezerva.

## TD-SELECTSAFARI — implementează FD-SELECTSAFARI
- `styles.css` (`@layer base`): `select { appearance: none; padding-right: 32px }`, cu săgeata din două `linear-gradient` (45° și −45°, 5 × 5 px, `var(--color-muted)`), la `right 18px` și `right 13px`. Fără aspectul nativ, WebKit respectă `min-h-[38px]` / `44px`.
- `News.tsx`: dropdown-ul „Sursă” fără `h-8` (regula generală), iar căutarea are `min-h-[38px]` (`pointer-coarse:min-h-11`), cu câmpul din ea `min-h-0`.
- `Charts.tsx`: căutarea de lângă favorite are `h-[30px]` (`pointer-coarse:h-9`), ca `.chip`.
- Verificare (scratchpad `wk/audit.mjs`, Playwright 1.64.1): WebKit și Chrome; pentru fiecare `.btn` / `button`, controalele de pe același rând (la cel mult 28 px, suprapuse vertical peste jumătate): diferența de înălțime și de mijloc peste 1 px; plus înălțimea fiecărui `select`.

## TD-AICLARITY — implementează FD-AICLARITY
- `sentiment/usage.ts` (nou): `ClaudeUsage`, pe ziua UTC, în `market_cache` (`claude:usage`, JSON `{ day, sentiment: { calls, items, input, output }, summary: { calls, input, output } }`). `record(kind, …)` citește și scrie într-o tranzacție (Mac-ul și Azure scriu în același rând); o eroare la scriere nu oprește scorarea și nici rezumatul.
- `ClaudeEngine` primește `onUsage` și, după fiecare răspuns, îl apelează cu titlurile lotului și cu `usage.input_tokens` / `output_tokens`. `SentimentService` îl leagă de `ClaudeUsage`.
- `SummaryService` înregistrează `message.usage` după fiecare rezumat.
- `/api/health` (admin): `claudeUsage` (ziua de azi, model sentiment, model Rezumat).
- Interfață:
  - `McpSection` se mută din `Security.tsx` în `Settings.tsx` (`#ai`), cu textele din FD §1 și starea „oprit”;
  - `Security.tsx` păstrează doar trimiterea;
  - `SettingsAdmin.tsx`: blocul „La ce folosește Sentiq cheia Claude”;
  - `DaySummary.tsx`: subsolul;
  - `App.tsx`: pagina „Asistenți AI (connector)” în ⌘K (`/settings#ai`).
- Teste: `ClaudeUsage` (ziua nouă, adunarea, doi scriitori), `ClaudeEngine` (apelul `onUsage`), `/api/health`, Rezumatul (tokenii înregistrați).

## TD-MCPREMOVE — implementează FD-MCPREMOVE
- Șterse:
  - `src/server/mcp/` (`oauth.ts`, `routes.ts`, `server.ts`, `mcp.test.ts`);
  - `src/web/pages/Consent.tsx`, `src/web/components/AiConnector.tsx`;
  - dependențele `@modelcontextprotocol/server` și `@modelcontextprotocol/client`.
- `config.ts`: fără `McpConfig` (`SENTIQ_MCP`, `SENTIQ_MCP_CLIENTS`); `publicUrl` rămâne.
- `context.ts`: fără `oauth` și `fetchClientDoc`. `http/app.ts`: fără rutele connectorului și fără regula „adresele connectorului nu sunt pagina”. `security.ts`: fără `bearerRoutes` (existau doar pentru connector).
- `auth-routes.ts`: fără `revokeUserGrants` (resetarea parolei, „Ieși peste tot”, dezactivarea contului). `jobs/register.ts`: fără `pruneMcp`. `main.ts`: fără mesajele „Claude connector on”.
- `settings.ts`: `public_instance` = `{ url, at }`; cititorul ignoră un `mcp` vechi.
- `db/schema.ts`:
  - migrarea **2** (`DROP TABLE mcp_tokens, mcp_codes, mcp_grants, mcp_clients`, copiii întâi);
  - `TABLES` și `IDENTITY_TABLES` fără ele;
  - `sqlite-migrations.ts` rămâne neschimbat (e istoria bazei SQLite, pentru import).
- `shared/api-types.ts`: fără `McpConnection`, `McpStatus`, `OAuthRequestInfo`.
- Interfața:
  - `App.tsx`: fără ruta `/oauth/consent` și fără „Asistenți AI” în ⌘K;
  - `Settings.tsx`: fără panou și fără starea lui în `useHashScroll`;
  - `Security.tsx`: textul de la „Ieși peste tot”, fără asistenți;
  - `DaySummary.tsx` și `SettingsAdmin.tsx`: fără mențiunile connectorului.
- Backup: `data/backups/sentiq-mcp-tables-2026-10-14.json` (citire din `dbo`, `chmod 600`), înainte ca migrarea să ruleze pe baza reală.
- Teste: `mcp.test.ts` dispare; `schema.test.ts` (versiunea 2, lista tabelelor) acoperă migrarea; un test nou: `/mcp`, `/.well-known/oauth-authorization-server` și `/oauth/token` nu mai răspund ca înainte.

## TD-TDPLAN — implementează FD-TDPLAN
- `TwelveDataClient.plan(key?)`: `GET /api_usage` (1 credit, luat din buget) → `{ category, perMinute: plan_limit, perDay: plan_daily_limit ?? null }`; un răspuns fără `plan_limit` numeric e o eroare.
- `CreditBudget`:
  - `perMinute` / `perDay` vin din `plan`, ținut în `market_cache` (`td:plan`: `{ category, perMinute, perDay, at, keyHint }`);
  - `perDay = null` = fără limită zilnică;
  - `ready` citește și planul; `setPlan(p)` îl scrie;
  - planul e recitit din bază la 5 minute (îl poate scrie cealaltă instanță);
  - `status()` dă și `plan` (`category`, `at`, `assumed`).
- `StockData.refreshPlan()`:
  - citește planul, dacă există cheie;
  - îl notează cu `keyHint` (ultimele 4 caractere ale cheii), pentru diagnostic; limitele nu-l verifică, fiindcă orice schimbare a cheii recitește sau șterge imediat planul (iar jobul îl recitește la pornire);
  - e folosit la salvarea cheii (după `verify`), la pornire și în jobul nou `twelvedata.plan` (6 ore, pe instanța cu joburile); ștergerea cheii șterge și planul;
  - `POST /api/settings/twelvedata-plan` (admin): recitire la cerere.
- Interfața: `SettingsAdmin.tsx` (planul, consumul fără „/ 800” când nu e limită, „Recitește planul”), `Health.tsx` („fără limită zilnică”).
- Teste: bugetul cu un plan fără limită zilnică și cu 55 pe minut, persistat și recitit; `plan()` pe răspunsurile Basic / Grow / eroare; ruta de recitire; cheia schimbată.

## TD-INDEXINTRA — implementează FD-INDEXINTRA
- `market/cnbc.ts` (nou):
  - `CnbcClient.quotes(symbols)`: `quote.cnbc.com/quote-html-webservice/restQuote/…`, mai multe simboluri într-o cerere → `last`, `change`, `change_pct`, `open/high/low`, `last_time`, `realTime`;
  - `CnbcClient.bars(symbol, interval, from, to)`: `ts-api.cnbc.com/harmony/app/bars/<sym>/<1M|5M|30M|1H|1D>/<from>/<to>/adjusted/EST5EDT.json` → lumânări cu `t = tradeTimeinMills`;
  - pe intraday păstrează doar barele cu `start < 16:00` și `start + interval > 9:30` (ora New York, din `tradeTime`); pe zilnic sare barele cu O / H / L / C ≤ 0.
- `INDEX_SOURCES` primește `cnbc` (`^SPX → .SPX`, `^COMP → .IXIC`, `^DJI → .DJI` …), lângă sursa de rezervă.
- `IndexData`:
  - `quote`: CNBC, altfel rezerva (`delayed: true` pe Cboe);
  - `history` (zilnic): CNBC din 2010, plus bara zilei din cotație, altfel rezerva;
  - `intraday(id, tf, count)`: baza (`1m` pentru 1m / 3m, `5m` pentru 5m / 15m, `30m`, `1h` pentru 1h / 2h / 4h), cerută pe câte zile trebuie (`count` / barele unei ședințe × 1,6 + 4, cel mult 110), ținută 30 s, cu cererile simultane unite;
  - comasarea pe ceasul New York: 3m și 15m pe minute, 2h pe `floor(oră / 2)`, 4h pe `floor(oră / 4)`.
- `shared/indices.ts`: `INDEX_TIMEFRAMES` = 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 1d, 1w; `INDEX_DELAY_NOTE` doar pentru `delayed`.
- `StockQuote.delayed?` (cotația unui indice din rezervă). Interfața arată nota doar atunci. Motivul dezactivării din Grafice: „Indicii nu au …”.
- Teste:
  - parsarea CNBC: cotații, bare intraday cu cele din afara ședinței sărite, zilnic;
  - comasările 3m / 15m / 2h / 4h;
  - `IndexData`: CNBC întâi, apoi rezerva (cotație cu `delayed`, zilnic);
  - `StockData`: 1h pentru un indice, 6h refuzat;
  - scanner-ul pe 1h pentru un indice;
  - API-ul (lumânări 1h prin `asset=index`).

## TD-AIKEYS — implementează FD-AIKEYS

### 1. Date (`db/schema.ts`, migrarea 3)
- `user_keys(user_id, name, secret, updated_at)`, PK `(user_id, name)`: cheile personale criptate cu `SecretBox` (ca celelalte chei); pentru AI, `name` = furnizorul (`anthropic`, `openai`, `gemini`); Twelve Data le folosește și ea (TD-TDKEYS).
- `news_ai_scores(user_id, news_id, score NULL, label NULL, engine, impact NULL, scored_at)`, PK `(user_id, news_id)`, index pe `news_id`; `score` NULL = AI-ul n-a dat scor (rămâne cel local, nu se mai trimite). `ON DELETE CASCADE` din `users` și din `news` (retenția, ștergerea unei surse).
- `ai_daily_sentiment`: coloanele lui `daily_sentiment`, cu cheia `(user_id, day, tz)`.
- `TABLES` le are (copiii întâi); importul SQLite le sare (nu există în fișier). `encryptedSecrets` numără și `user_keys`.

### 2. Clienții (`server/ai/`)
- `types.ts`: `AiClient.generate(req)` → `{ parsed, stop: 'done' | 'max_tokens' | 'refusal' | 'other', usage }`; `AiError(provider, kind, status, detail)` cu mesajul în română; `permanent` (auth / permission / model), `transient` (rate / overloaded / connection / 5xx).
- `http.ts`: `callJson` (JSON, timeout + semnalul apelantului, 2 reîncercări pe erori trecătoare, `Retry-After` ≤ 20 s), `jsonSchemaOf` (`z.toJSONSchema` fără `$schema`; obiectele au deja `additionalProperties: false`), `parseAnswer`.
- `openai.ts`: `POST /v1/responses` cu `instructions`, `input`, `max_output_tokens`, `store: false`, `text.format = { type: 'json_schema', name, schema, strict: true }`, `reasoning.effort`. Citește `output[].content[]` (`output_text` / `refusal`), `status` / `incomplete_details.reason`, `usage.input_tokens` / `output_tokens`. Un 400 despre `reasoning` → aceeași cerere fără el (ținut minte). `insufficient_quota` → `quota`.
- `gemini.ts`: `POST /v1beta/models/{model}:generateContent` (Google îl numește acum „Generate Content API (Legacy)” și recomandă Interactions API pentru proiecte noi; e documentat și funcțional la 17 oct 2026: dacă e retras, se trece pe `/v1beta/interactions` cu `response_format` și `generation_config.thinking_level`), antetul `x-goog-api-key`; `systemInstruction`, `contents`, `generationConfig = { responseMimeType: 'application/json', responseJsonSchema, maxOutputTokens, thinkingConfig.thinkingLevel }` (nivelul doar de la Gemini 3; un 400 despre „thinking” → fără el). Sare părțile `thought`; tokenii de gândire intră la ieșire. `promptFeedback.blockReason` și `finishReason` SAFETY / PROHIBITED_CONTENT / … → `refusal`; `MAX_TOKENS` → `max_tokens`. `API_KEY_INVALID` (400) → `auth`; 429 cu `PerDay` sau `limit: 0` → `quota`, altfel `rate`.
- `anthropic.ts`: SDK-ul, ca înainte: scorul prin `beta.messages.parse` (cu `server-side-fallback`, nu pe Haiku), Rezumatul prin `messages.stream` (`long`). `fromAnthropic` traduce erorile SDK-ului (mesajul API-ului, nu „400 {…}”; „credit balance” → `quota`).
- `models.ts`: `listModels(provider, key)`: Anthropic `GET /v1/models?limit=1000`, OpenAI `GET /v1/models`, Gemini `GET /v1beta/models?pageSize=1000` (pe pagini, doar cele cu `generateContent`). `usableModels` păstrează modelele de text (fără audio, imagini, embeddings, snapshot-uri datate, generațiile vechi), cele din `shared/ai.ts` întâi.

### 3. `AiService` (`server/ai/service.ts`)
- `config(userId)`: `{ provider, model: effectiveModel(…), scoring, key }`, reținut 30 s (ca setările); `isScoring`, `scoringUsers()` (conturi active), `forget(userId?)`.
- `setKey(userId, provider, key)`: forma (`checkAiKeyShape`: 20–300 caractere ASCII vizibile), apoi `listModels`; `auth` / `permission` → `ValidationError` (400); altă eroare → salvată, cu `warning`. Lista de modele a cheii e ținută 1 h (după amprenta cheii).
- `models(userId, provider)`: lista cheii, sau `shared/ai.ts` (`source: 'default'`, cu `error` dacă furnizorul n-a răspuns).
- `client(provider, key, model)`; `usage` = `AiUsage` (`market_cache`, `ai:usage:<userId>`, ziua UTC, cu modelul ultimului apel).
- `migrateLegacy(adminId)` (în `createContext`, după `migrateLegacyToAdmin` și înaintea oricărei alte scrieri a setărilor globale: `migrateMarketData` le-ar rescrie fără `sentiment`), într-o tranzacție: `claude_key` → `user_keys(admin, anthropic)`; `sentiment` din `app` → `ai` în setările adminului (`scoring = engine === 'claude' && cheie`); scorurile `claude:%` → `news_ai_scores` ale adminului; cele publicate în ultimele 4 zile se golesc pe rândul știrii (le scorează modelul local); `sentiment` dispare din `app`, `claude_key` și `claude:usage` se șterg. Nimic de făcut fără `claude_key` și fără `sentiment`.

### 4. Scorul (`sentiment/`)
- `SentimentService`: `scorePending` doar cu `LocalEngine` (scorul comun). `scoreUsers(signal)`: pentru fiecare utilizator din `scoringUsers()`, cel mult 50 de știri pe rundă (`relevance > 0`, sursă activă, publicate în ultimele 48 h, fără rând în `news_ai_scores`), cele mai noi întâi, prin `AiScorer`; se scriu doar dacă știrea are același titlu. `resetUser(userId, since)`; `aiStatus(userId)`: starea scorării, din `market_cache` `ai:scorer:<userId>` (`{ sig, lastError, pausedUntil }`), scrisă de instanța cu joburile la fiecare schimbare (o eroare, sfârșitul ei; scrierile unui utilizator în ordine, așteptate la sfârșitul rundei) și citită de oricare; o stare a altui furnizor / model / cheie (`sig`) nu contează.
- `ai-scorer.ts` (fostul `ClaudeEngine`, fără rezerva locală): loturi de 25, `effort: 'low'`, 8 192 de tokeni; pauză infinită pe erori permanente (până se schimbă furnizorul, modelul sau cheia: scorer nou), 30 min pe `quota`, 5 min în rest; titlurile lipsă / refuzate / necitite → rând cu `score` NULL. Motorul: `claude:<model>`, `openai:<model>`, `gemini:<model>` (`aiEngineId`).
- Jobul nou `sentiment.ai` (1 min, cel mult 20 de runde); `news.fetch` îl împinge după știri noi; `PUT /api/settings` (alt `ai`) și `PUT /api/ai/key` îl împing, plus `sentiment.daily`.
- `ingest.ts`: un titlu nou șterge rândurile `news_ai_scores` ale știrii.

### 5. Indicele zilei (`sentiment/daily.ts`)
- `IndexScope` = `null` (comun) sau `userId`; `scopeFor(userId)` = utilizatorul, dacă AI-ul său scorează.
- `loadItems(…, scope)`: `COALESCE(a.score, n.sentiment)` și `COALESCE(a.impact, n.sentiment_impact, n.impact)` cu `LEFT JOIN news_ai_scores a`.
- `save` / `today` / `refreshZone` / `history` primesc `scope`; al utilizatorului se scrie în `ai_daily_sentiment`. `refresh` face comunul pe toate fusurile, apoi fiecare utilizator pe fusul său, de la prima zi scorată de AI-ul său (nu ziua tăiată de retenție). `history(…, scope)` = zilele comune, înlocuite de ale utilizatorului unde există. `recomputeHistory` le șterge pe amândouă.

### 6. API
- `PUT /api/ai/key { provider, key | null }` → `SettingsView & { aiKeyWarning }`; `GET /api/ai/models?provider=`; `GET /api/ai/status` → `{ provider, model, keySet, scoring, scorer, usage }`; `POST /api/ai/rescore { hours ≤ 48 }` (400 fără scorul pe AI).
- `PUT /api/settings/claude-key` dispare (și din `ADMIN_ONLY`).
- `SettingsView`: `aiKeys: { anthropic | openai | gemini: { set, hint } }` (ale utilizatorului, cu hint doar pentru acesta); `ai` (`provider`, `model?`, `scoring`) e în `USER_KEYS`; `sentiment` iese din `settingsSchema` (zod îl ignoră în rândurile vechi).
- `/api/sentiment/today | history | day/:day`, `/api/news`, contextul Rezumatului: cu `scopeFor(userId)`.
- `/api/summary`: `hasKey` (cheia furnizorului ales), `ai: { provider, model }`; fără cheie: 400 `NO_AI_KEY`.
- `/api/health`: `sentiment: { engine: 'local', model, pending, aiUsers }`; fără `claudeStatus` și `claudeUsage`.
- Ștergerea unui utilizator: `ai.forget(id)`, `ai.usage.forget(id)` (restul prin chei străine).

### 7. Interfață
- `shared/ai.ts`: furnizorii (nume, produs, unde se face cheia, modelele curente, `modelRe`), `effectiveModel`, `modelLabel`, `providerOfModel`, `aiEngineId`, `engineLabel`.
- `components/AiSettings.tsx` (`#ai` în `Settings.tsx`), `SettingsAdmin.tsx` (secțiunea „Sentimentul știrilor”), `DaySummary.tsx` (textele, `SummaryState` din `api-types`), `News.tsx` (`engineLabel`, numele AI-ului la importanță), `Health.tsx`.

### 8. Teste
- `ai/providers.test.ts` (fără rețea): cererile și răspunsurile OpenAI / Gemini / Anthropic, refuzuri, răspunsuri tăiate, reîncercări, abandon, erori → tipuri, listele de modele.
- `ai/service.test.ts`: mutarea cheii comune (cu motor Claude / local / fără cheie; o singură dată), cine scorează.
- `ai/usage.test.ts`: consumul pe utilizator.
- `sentiment.test.ts`: `AiScorer` (pauze, consum, importanță 1–3, titluri lipsă).
- `impact.test.ts`: scorurile AI ale unui utilizator (scrise, șterse la titlu nou, fereastra de 48 h) și efectul lor doar pentru acel utilizator (indice, istoric, lista de știri, filtre).
- `summary.test.ts`: cheia fiecăruia, furnizorul ales (Gemini), erorile; `server.test.ts`: rutele `/api/ai/*` (cheie acceptată / refuzată / neverificabilă, modelele, starea, rescorarea); `users.test.ts`: cheile sunt ale fiecăruia.

## TD-TDKEYS — implementează FD-TDKEYS

### 1. Date
- `user_keys(user_id, name, secret, updated_at)` (migrarea 3, comună cu FD-AIKEYS: numele `anthropic`, `openai`, `gemini`, `twelvedata`).
- Planul și consumul: `market_cache` `td:plan:<userId>` și `td:usage:<userId>` (`tdPlanKey` / `tdUsageKey`; fără `scope`, cheile vechi).
- `SettingsService`: `getTwelveDataKey(userId)`, `setTwelveDataKey(userId, key)` (forma: `TWELVEDATA_KEY_RE`), `usersWithKey(name)` (conturi active), `migrateTwelveData(adminId)`: `twelvedata_key` din `settings` → `user_keys(admin, twelvedata)`, `td:plan` / `td:usage` → ale adminului (doar dacă acolo nu e deja ceva), apoi cheia globală se șterge; într-o tranzacție, în `createContext`, după mutarea AI și înainte de `migrateMarketData`.
- `viewFor`: `twelveDataKeySet` / `twelveDataKeyHint` ale utilizatorului (hint pentru el, indiferent de rol).

### 2. `StockData` (`market/stocks.ts`)
- `key(userId)`; `account(userId)` = `{ client: TwelveDataClient, budget: CreditBudget(scope = userId) }`, ținut în memorie; `td(userId)`, `budget(userId)`, `hasKey(userId)`, `forget(userId)`.
- `timeframes(userId)`, `timeframesFor(sym, userId)`, `refreshPlan(userId, key?)`, `candles(sym, tf, count, userId)`, `search(q, userId)`.
- Cache-ul lumânărilor: `td|<userId>|SYM|tf` (ale utilizatorului), `nq|SYM|tf` și `ix|…` (comune).
- `CreditBudget.reset(spent)`: consumul zilei de la `spent` (cheie nouă: 1, verificarea ei); așteaptă, ca `setPlan` / `clearPlan`, prima citire din bază (altfel citirea, terminată după, ar pune la loc consumul sau planul vechi).
- Mesajele: `TD_KEY_PLACE` = „Setări → Ale mele → Date pentru acțiuni”.

### 3. Scanner
- `stockRow(userId, …)`: timeframe-urile și lumânările cu cheia utilizatorului; cheia rândului ținut 30 min include `userId` când acțiunea e citită cu cheia lui (`null` pentru Nasdaq și indici: rând comun).

### 4. API
- `GET /api/stocks/info`, `/api/market/candles` (acțiuni), `/api/stocks/search`: ale utilizatorului.
- `PUT /api/settings/twelvedata-key`, `POST /api/settings/twelvedata-plan`: ale utilizatorului (nu mai sunt în `ADMIN_ONLY`); o cheie nouă: verificată pe un buget al ei (nu pe al cheii vechi), salvată, consumul de la 1 (verificarea), planul citit (încă 1); aceeași cheie salvată din nou: verificată pe bugetul utilizatorului.
- `/api/health`: `twelveData: { users }` (câți au cheie).
- Jobul `twelvedata.plan`: planul fiecărui utilizator cu cheie; erorile se adună (unul nu le oprește pe celelalte).
- Ștergerea unui utilizator: `stocks.forget(id)` și rândurile `td:*:<id>` din `market_cache`.

### 5. Interfață
- `components/StockDataSettings.tsx` (`#stock-data` în Setări → Ale mele): cheia, planul, consumul, „Recitește planul”.
- `SettingsAdmin.tsx`: „Date de piață” fără Twelve Data. `Charts.tsx`: textele și linkul spre `/settings#stock-data`. `Health.tsx`: numărul de utilizatori cu cheie. `api-types.ts`: `Health.twelveData = { users }`.

### 6. Teste
- `CreditBudget` cu `scope` (două bugete separate, persistate), `reset`; `StockData` cu două chei (fiecare cu cheia și cache-ul lui; fără cheie: Nasdaq).
- Mutarea cheii globale (cu plan și consum; o singură dată).
- Rutele: cheia unui utilizator obișnuit, info / plan per utilizator, adminul nu vede cheia altuia; scanner-ul cu și fără cheie.

## TD-2FA — implementează FD-2FA

### 1. Baza de date (migrarea 4)
- `ALTER TABLE users ADD totp_next_secret NVARCHAR(MAX) NULL`: secretul aplicației noi în timpul unei schimbări (criptat cu `SecretBox`, ca `totp_secret`); NULL în rest.
- Nimic de mutat. Conturile fără `totp_confirmed_at` ajung la configurare la următoarea cerere.

### 2. Bariera (`http/auth.ts`)
- `AuthUser.twoFactor` = `totp_confirmed_at IS NOT NULL` (din același rând citit de hook, fără cerere în plus).
- `TWO_FACTOR_SETUP`: ce poate face un cont fără 2FA, pe lângă rutele publice (`/api/auth/state`, `/api/auth/logout`…). Lista: `GET /api/account/2fa`, `POST /api/account/2fa/start`, `POST /api/account/2fa/enable`. Orice altă rută → 403 `TWO_FACTOR_REQUIRED` („Configurează mai întâi autentificarea în doi pași.”).
- Bariera ține de **starea contului**, nu de felul sesiunii. Prinde la fel sesiunile vechi, login-ul cu parolă, passkey-ul, prima parolă a adminului și activarea. Sesiunea rămâne `full` (30 de zile): instalarea aplicației poate dura mai mult decât cele 5 minute ale unei sesiuni `pending`.
- Ordinea în hook: sesiunea → rutele publice → `AUTH_REQUIRED` → `TWO_FACTOR_REQUIRED` → `FORBIDDEN` (admin). Adminul fără 2FA nu ajunge nici la rutele de admin.

### 3. `UserService`
- `confirmTwoFactor(userId, code)` → `string[] | 'on' | null`: `'on'` dacă 2FA e deja activ (alt tab), `null` pentru un cod greșit sau fără înrolare începută.
- `beginReplace(userId, password, code)` → `boolean`:
  - parola întâi (o parolă greșită nu consumă un cod de recuperare);
  - apoi, într-o tranzacție, `verifySecondFactor` (codul aplicației de acum sau un cod de recuperare, consumat);
  - la final, un secret nou în `totp_next_secret`; o schimbare deja începută e înlocuită.
- `confirmReplace(userId, code)` → `'done' | 'none' | 'invalid'`:
  - codul se verifică pe `totp_next_secret`, cu pragul anti-replay 0 (secretul nu a fost folosit încă; pragul vechi ține de secretul vechi și ar refuza un cod din aceeași fereastră de 30 s);
  - apoi, într-o tranzacție: `totp_secret = next`, `totp_last_step` = pasul confirmat, `totp_confirmed_at` = acum, `totp_next_secret = NULL`;
  - codurile de recuperare rămân.
- `cancelReplace(userId)`: `totp_next_secret = NULL`.
- `twoFactorState`:
  - `replacing` = 2FA activ și `totp_next_secret` prezent;
  - `pendingSecret` / `uri` = secretul aplicației noi în timpul unei schimbări, cel al înrolării înainte de confirmare, altfel nimic. Secretul confirmat nu iese niciodată din bază.
- `resetTwoFactor(id)` (admin) șterge și `totp_next_secret`.
- **Scoase:** `cancelTwoFactor`, `disableTwoFactor` (2FA nu se mai poate opri sau abandona).

### 4. API (`http/auth-routes.ts`)
- `POST /api/auth/activate`:
  - browserul e deja în alt cont (`req.user`): `{ ok, email, signedIn: false }`, ca până acum;
  - altfel `startSession`: `{ ok, email, signedIn: true, user }` (sesiune nouă, `last_login_at`).
- `POST /api/account/2fa/enable` `{ code }` (bugetul `account:<id>`):
  - 2FA deja activ → 409 `TWO_FACTOR_ON` (fără să consume bugetul);
  - succes → celelalte sesiuni ale contului se închid (`destroyAll(id, sesiunea curentă)`), emailul `totp-on`, `{ codes, twoFactor, user }`.
- `POST /api/account/2fa/replace` `{ password, code }` (bugetul contului; greșit → 400 „Parola sau codul nu sunt corecte.”) → vederea, cu `replacing: true` și QR-ul nou.
- `POST /api/account/2fa/replace/confirm` `{ code }` (bugetul contului):
  - greșit → 400 „Cod greșit. Scrie codul de 6 cifre arătat acum de aplicația nouă…”;
  - nicio schimbare începută → 409 `NO_REPLACEMENT`;
  - succes → emailul `totp-changed`, vederea.
- `POST /api/account/2fa/replace/cancel` → vederea.
- `POST /api/admin/users/:id/reset-2fa`: `sessions.destroyAll(id)` (înainte `destroyPending`), emailul `totp-reset`.
- **Scoase:** `POST /api/account/2fa/cancel`, `POST /api/account/2fa/disable` (404).
- `TwoFactorView.replacing` (nou).

### 5. Emailuri (`auth/email.ts`)
- `MailKind` adaugă `totp-on`, `totp-changed`, `totp-reset`: anunțuri fără link și fără cod, trimise în fundal (`sendLater`), ca `reset-done`.

### 6. Interfață
- **`auth.ts`:**
  - un mic depozit extern (`useSyncExternalStore`) pentru configurarea terminată: codurile de recuperare și utilizatorul de după;
  - `holdEnrolment(codes, user)`, `endEnrolment()`, `useEnrolment()`.
- **`App.tsx`:**
  - cu utilizator și (`!user.twoFactor` sau o configurare ținută pe ecran) → `TwoFactorSetupPage`, înaintea oricărei alte rute;
  - evenimentul `sentiq:two-factor-required` (din `api.ts`, la 403 `TWO_FACTOR_REQUIRED`) recitește `['auth']`.
- **`api.ts`:** 403 `TWO_FACTOR_REQUIRED` → `sentiq:two-factor-required`.
- **`pages/Auth.tsx`:**
  - `TwoFactorSetupPage` (`Shell`):
    - `GET /api/account/2fa`, recitit la revenirea în tab;
    - `start` automat cât nu e începută (`restart: false`, idempotent);
    - QR-ul și cheia (`TotpQr`), codul, „Cheie nouă”, „Ieși din cont”;
    - la `enable`, codurile se țin în depozit, iar `RecoveryCodes` cu „Intră în Sentiq” pune utilizatorul în `['auth']` și golește depozitul;
    - `TWO_FACTOR_ON` (alt tab) → recitește `['auth']`;
  - `ActivatePage`:
    - cu `signedIn` → `landAfterSignIn('/')`, `useAuthChange()(user)`;
    - fără (browser în alt cont) → „Contul e activ” cu „Ieși și intră cu …”: `logout`, apoi `landAfterSignOut('/login?activated=1&email=…')` (adresa completată), sau „Rămâi în contul de acum”;
  - `SetupPage`: `landAfterSignIn('/')`;
  - `SignedInAuthRoutes`: o țintă de după login (`afterSignInTarget()`) câștigă în fața paginii `/activate` sau `/reset-password` pe care s-a terminat login-ul. Altfel, după configurare, `/activate` ar fi arătat din nou pagina de activare, cu linkul deja folosit.
- **`components/RecoveryCodes.tsx`** (mutat din Securitate; eticheta butonului final e un parametru) și **`components/TotpQr.tsx`** (QR-ul, alb pe negru pe orice temă, și cheia scrisă), comune ecranului de configurare și Securității.
- **`pages/Security.tsx`:**
  - fără „Dezactivează”, „Renunță” și înrolarea inițială;
  - „Schimbă aplicația de autentificare”: `ConfirmWithCode` → `TotpQr` + codul → „Confirmă”, sau „Renunță”;
  - fără îndemnul `?welcome=1`; mesajul de după un cod de recuperare actualizat.
- **`pages/Users.tsx`:** „Resetează 2FA” cu textul nou; coloana Securitate: „2FA” / „2FA neconfigurat” / „—”.

### 7. Scripturi
- `scripts/admin.ts reset` șterge și `totp_next_secret`.
- `scripts/smoke.ts` marchează adminul de test cu 2FA înainte de sesiune.

### 8. Teste
- Bariera:
  - un cont fără 2FA vede doar rutele de configurare și pe cele publice (403 `TWO_FACTOR_REQUIRED` în rest, inclusiv la admin);
  - după `enable`, totul se deschide, iar celelalte sesiuni sunt închise;
  - 409 dintr-un al doilea tab.
- Activarea: intră direct (sesiune), spre configurare; într-un browser cu alt cont, nu schimbă contul.
- Prima parolă a adminului, login cu passkey și „Am uitat parola” pe un cont fără 2FA → configurare.
- Schimbarea aplicației:
  - cere parola și codul;
  - aplicația veche merge până la confirmare;
  - codul vechi e refuzat în câmpul nou;
  - un cod din aceeași fereastră de 30 s e acceptat;
  - „Renunță”; codurile de recuperare rămân.
- Rutele scoase răspund 404. Resetarea de către admin închide sesiunile și duce la configurare.
- Emailurile de anunț (fără link).
- `api.test.ts`: evenimentul `TWO_FACTOR_REQUIRED`.
- Testele care fac sesiuni direct (`server.test.ts`, `source.test.ts`, `summary.test.ts`) marchează conturile cu 2FA.

## TD-TRADING — implementează FD-TRADING

### 1. Baza de date (migrarea 5)
- **`exchange_accounts`:**
  - `trading_enabled_at BIGINT NULL`: tranzacționarea e pornită de atunci;
  - `trading_markets NVARCHAR(40) NULL`: ce poate cheia la pornire: `spot`, `futures`, `spot,futures` sau `stock`.
- **`trade_log`:**
  - coloane: `id` IDENTITY, `user_id` (FK `users`, CASCADE), `account_id INT NULL` (fără FK: jurnalul rămâne după ștergerea contului de exchange), `exchange`, `env`, `account_label`, `idem_key NVARCHAR(64) NULL`, `action` (`order` | `cancel` | `enable` | `disable`), `market`, `symbol`, `side`, `kind`, `amount FLOAT`, `price FLOAT`, `trigger_price FLOAT`, `leverage FLOAT`, `status` (`pending` | `sent` | `rejected` | `error` | `unknown`), `order_id`, `message NVARCHAR(500)`, `detail NVARCHAR(MAX)` (JSON: tot ce a plecat și ce s-a întors, fără chei), `created_at`, `updated_at`;
  - index unic filtrat `(user_id, idem_key) WHERE idem_key IS NOT NULL`;
  - index `(user_id, created_at)`.
- `TABLES` primește `trade_log` (înaintea lui `users`).

### 2. Comun: `shared/trading.ts`
- `TRADING: Record<ProviderId, PlatformTrading>` descrie, pe platformă:
  - `supported` (IBKR: `false`, cu `reason`);
  - piețele: `spot` / `futures` / `stock`;
  - tipurile pe piață: `market` | `limit` | `stop` | `stop_limit` | `mit` | `limit_ioc`;
  - cum se dă cantitatea: `base` | `quote`;
  - valabilitățile: `gtc` | `day`;
  - pentru futures: levier, moduri de marjă (`null` = ale contului: Bybit), TP / SL `attached` / `after-market` / `none`, reduce-only;
  - eToro: short, levier, SL / TP; Alpaca: bracket, în afara orelor;
  - `tradeSteps`: pașii pentru o cheie cu tranzacționare și fără retrageri.
- **`orderTicketSchema` (zod)**, aceeași pe server și în formular:
  - `{ accountId, idemKey (uuid), market, symbol, side, kind, amount > 0, amountIn: 'base'|'quote', price?, triggerPrice?, tif?, leverage?, marginMode?, reduceOnly?, takeProfit?, stopLoss?, extendedHours?, close?: { positionIds?: string[] } }`;
  - regulile: `price` pentru limită și stop-limită, `triggerPrice` pentru stop / stop-limită / mit, TP / SL pozitive, levier întreg 1 – 125.
- Tipurile:
  - `TradingCaps` (pe cont): `supported`, `enabled`, `markets`, `reason`;
  - `OrderPreview`: ticketul normalizat, cantitatea rotunjită (și contractele), prețurile rotunjite, prețul de acum, valoarea, marja, disponibilul, moneda, `warnings[]`, `errors[]`;
  - `OrderResult`: `status` (`sent` | `filled` | `open` | `pending` | `cancelled` | `rejected` | `unknown`), `orderId`, `message`, `followUps[]` (TP / SL trimise după);
  - `TradeLogRow`.

### 3. Server: `exchange/trading/`
- **`types.ts`:**
  - interfața `Trader`:
    - `instrument(market, symbol)` → pașii, minimele, `contractSize`, levierul maxim, prețul de acum, disponibilul, poziția;
    - `symbols(market)`;
    - `normalize(ticket)` → `OrderPreview`;
    - `place(preview)` → `OrderResult`: trimite exact ordinul verificat; ID-ul de client vine din `preview.ticket.idemKey`;
    - `cancel(order)` → `OrderResult`;
  - `TradingError(code, message)`, cu codurile:
    - `INVALID` | `PERMISSION` | `INSUFFICIENT` | `MIN_SIZE` | `HEDGE_MODE` | `MARKET_CLOSED` | `NOT_FOUND` | `RATE_LIMIT` | `REJECTED` | `UNKNOWN_OUTCOME` | `UNSUPPORTED`;
    - `DISABLED`: tranzacționarea e oprită sau piața nu e permisă;
    - `IN_PROGRESS`: același formular e în curs (409);
    - `BAD_FACTORS`: parola sau codul la pornire, pe bugetul de încercări;
    - `NO_ACCOUNT`: contul nu există sau nu e al utilizatorului (404).
- **`crypto.ts` (`CcxtTrader`, prin ccxt), pe clienții contului:**
  - **Clientul:**
    - KuCoin clasic: futures pe clientul `kucoinfutures`, spot pe `kucoin`;
    - KuCoin UTA și restul: totul pe clientul spot, care are și piețele contract.
  - **Simbolurile:**
    - spot `BASE/QUOTE`;
    - futures `BASE/USDT:USDT`, doar `swap` liniare, active.
  - **Cantitatea:**
    - `amountIn: 'quote'` → bază = valoare ÷ prețul de acum (pentru o limită: ÷ prețul limită);
    - futures: contracte = bază ÷ `contractSize`;
    - `amountToPrecision` (rotunjește în jos), apoi verificat față de `limits.amount.min` / `limits.cost.min`; zero după rotunjire → `MIN_SIZE`.
  - **Prețurile:** `priceToPrecision`.
  - **Ordinul la piață:** pleacă cu prețul de acum, ca ccxt să calculeze costul unde exchange-ul cere suma pentru o cumpărare la piață (Coinbase, Bybit spot).
  - **Stop:**
    - `params.triggerPrice`, cu tipul `market` / `limit`;
    - direcția din latură: cumpărarea peste preț, vânzarea sub el (verificată față de prețul de acum);
    - KuCoin spot: `stop: 'entry' | 'loss'`;
    - Kraken: `stopLossPrice` (Kraken numește orice stop „stop-loss”);
    - Coinbase / Binance spot: doar stop-limită;
    - Bitget unificat (UTA): refuzat la verificare, spot și futures (vezi mai jos).
  - **Futures:**
    - modul de poziție: `fetchPositionMode` (Binance, OKX, KuCoin) sau contul Bitget (clasic: `privateMixGetV2MixAccountAccount` → `posMode`; unificat: setările v3 → `holdMode`), ținut 10 min; hedge → ordinul pleacă cu `hedged: true` (TD-KUCOINHEDGE, TD-HEDGEALL; Bybit: modul din lista pozițiilor perechii); KuCoin unificat → `HEDGE_MODE`;
    - Bitget clasic one-way → `oneWayMode: true` (în hedge nu, ar suprascrie `hedged`);
    - **Bitget unificat (UTA):**
      - recunoscut după `GET /api/v3/account/settings` (îl primesc doar conturile unificate; `accountMode` `upgrading` / `switching` → refuzat până se termină), ținut 10 min și dat lui ccxt (`options.uta`). O eroare de rețea → eroare, nu „clasic” (ccxt ar păstra presupunerea);
      - ccxt 4.5 trimite parametrii brut pe `POST /api/v3/trade/place-order`: marja ca `crossed` / `isolated`, fără `oneWayMode`;
      - `setLeverage(lev, symbol)` fără marjă (v3 → cross implicit; levierul isolated cere `posSide`);
      - refuzate la verificare: ordinele stop, spot și futures (ccxt nu are ordine cu declanșare pe v3, iar prețul de declanșare s-ar pierde), și marja isolated la deschidere;
      - reduce-only: marja poziției, în numele v3;
      - cumpărarea spot la piață: v3 citește `qty` în moneda de cotare, iar ccxt trimite cantitatea așa cum e; Sentiq pune `qty` = suma din verificare (`costToPrecision(valoarea)`), care înlocuiește câmpul lui ccxt. Vânzarea și ordinele limită rămân în moneda de bază;
    - levierul: Binance / Bybit / OKX / Bitget → `setLeverage(lev, symbol, { marginMode })` înainte; KuCoin clasic isolated → `leverage` în ordin; KuCoin cross → `setLeverage(lev, symbol, { marginMode: 'cross' })`; KuCoin UTA isolated → refuzat la verificare (`setLeverage` din ccxt suportă doar cross, iar ordinul UTA nu poartă marja). Un ordin reduce-only pe UTA trece: nu schimbă levierul. Un „leverage not modified” e ignorat;
    - marja: OKX / Bitget / KuCoin → `marginMode` în ordin; Binance → `setMarginMode` înainte („No need to change” ignorat); Bybit → a contului;
    - `reduceOnly: true` unde e cerut;
    - TP / SL atașate (`attached`: KuCoin, Bybit, OKX, Bitget) → `params.stopLoss` / `takeProfit = { triggerPrice }`;
    - Binance (`after-market`, doar la o intrare la piață) → după intrare, două ordine `reduceOnly` cu `stopLossPrice` / `takeProfitPrice` pe cantitatea intrării, raportate în `followUps`;
    - un ordin `reduceOnly` (închidere) nu cheamă `setLeverage` / `setMarginMode`; trimite doar `marginMode` unde exchange-ul îl cere cu fiecare ordin (OKX, Bitget, KuCoin), din poziție.
  - **ID-ul de client:** `clientOrderId` = un șir derivat din `idemKey` (32 de caractere hex, fără cratime), pe care ccxt îl trimite ca ID al exchange-ului (KuCoin `clientOid`, Bybit `orderLinkId`…). Coinbase își face singur ID-ul: acolo contează doar jurnalul Sentiq.
  - **Anularea:**
    - `cancelOrder(id, symbol, { trigger: true })` pentru ordinele cu preț de declanșare;
    - KuCoin spot clasic: `stop: true`;
    - `OrderNotFound` → `NOT_FOUND` („nu mai e deschis”).
  - **Erorile ccxt:**
    - `InsufficientFunds` → `INSUFFICIENT`;
    - `InvalidOrder` → `REJECTED` / `MIN_SIZE`;
    - `PermissionDenied` / `AuthenticationError` → `PERMISSION`; la fel Binance `-2015`, pe care ccxt îl aruncă drept `DDoSProtection` după ce cheia a mers o dată;
    - `RateLimitExceeded` / `DDoSProtection` → `RATE_LIMIT`;
    - `RequestTimeout` / `NetworkError` după trimitere → `UNKNOWN_OUTCOME`;
    - `BadResponse` sau o eroare din afara celor ccxt (de ex. la citirea răspunsului) după trimitere → tot `UNKNOWN_OUTCOME`: ordinul poate fi în carte, deci cheia formularului rămâne legată.
  - Niciun apel de ordin nu trece prin `withRetry`.
- **`trading212.ts`:**
  - `POST /equity/orders/{market|limit|stop|stop_limit}` cu `{ ticker, quantity (negativ = vânzare), limitPrice, stopPrice, timeValidity: DAY | GOOD_TILL_CANCEL, extendedHours }`;
  - `DELETE /equity/orders/{id}`;
  - instrumentele (`/equity/metadata/instruments`, 1 cerere la 50 s) ținute 24 h pe cont; simbolul → tickerul: `shortName` egal, întâi moneda contului, apoi `_US_EQ`; tickerul pozițiilor se ia direct;
  - 403 → `PERMISSION` („activează «Orders: Execute»”); 429 → `RATE_LIMIT`, fără reîncercare;
  - rezumatul contului și pozițiile (1 cerere la câteva secunde) ținute 6 s, ca verificarea și trimiterea să nu le ceară de două ori; uitate după un ordin sau o anulare.
- **`etoro.ts`:**
  - deschiderea: `POST /api/v2/trading/execution/{,demo/}orders` cu `{ action: 'open', transaction: 'buy' | 'sellShort', instrumentId, orderType: 'mkt' | 'mit' | 'limitIOC', triggerRate | limitRate, leverage, amount (orderCurrency 'usd') | units, stopLossRate, takeProfitRate }`, antetul `x-request-id` = `idemKey`;
  - instrumentul: `GET /api/v1/market-data/search?internalSymbolFull=…` (potrivire exactă);
  - închiderea: `POST /api/v1/trading/execution/{,demo/}market-close-orders/positions/{positionId}` `{ InstrumentId, UnitsToDeduct }`, pentru fiecare poziție a deținerii (una după alta). O poziție care nu se închide nu le ascunde pe celelalte: rezultatul le numește, iar una fără răspuns apare separat, ca „nu știm sigur”. Dacă nu e primită niciuna, eroarea (`UNKNOWN_OUTCOME` dacă vreuna a rămas fără răspuns);
  - anularea: `DELETE /api/v2/trading/execution/{,demo/}orders/{orderId}`;
  - starea: `GET /api/v2/trading/info/{,demo/}orders:lookup?orderId=` (sau `referenceId` după un timeout): 3 / 5 executat, 4 / 10 refuzat (cu motivul), 1 / 2 / 11 / 12 în curs; până la 5 citiri la 1 s.
- **`alpaca.ts`:**
  - `POST /v2/orders` `{ symbol, qty | notional, side, type, time_in_force, limit_price, stop_price, extended_hours, client_order_id (= idemKey), order_class: 'bracket' + take_profit / stop_loss }`;
  - `DELETE /v2/orders/{id}` (422: nu se mai poate anula → `NOT_FOUND`); închiderea unei poziții („Închide”): un ordin la piață în sens opus, pe cantitatea ei;
  - crypto (`BTC/USD`): `gtc`, fără bracket.
- **Poziții și ordine din portofoliu, pentru acțiuni:** `PositionRow` / `BalanceRow` primesc `ref?: { positionIds?: string[]; instrumentId?: number; ticker?: string }` (eToro, Trading 212); `OrderRow` primește `cancellable: boolean` (fals pentru SL / TP-urile eToro deduse din poziții).

### 4. `TradingService` (`exchange/trading/service.ts`)
- `caps(userId)`: pe fiecare cont, `supported` / `enabled` / `markets` / `reason`.
- `enable(userId, accountId, password, code)`:
  - pasul de autentificare (`users.stepUp`: parola, apoi `verifySecondFactor`), pe bugetul `account:<id>`;
  - permisiunile recitite (`keyPermissions`; Coinbase: `v3PrivateGetBrokerageKeyPermissions` → `can_trade` / `can_transfer`). O citire fără rezultat păstrează lista știută, aici și la „Testează”;
  - `tradeRights(exchange, permissions)` → `{ spot, futures, withdraw }` (`null` = necunoscut):
    - KuCoin `Spot` / `Futures` / `Withdrawal`;
    - Binance `spot-trade` / `futures` / `withdraw`;
    - Bybit `Spot:SpotTrade` / `ContractTrade:*` / `*Withdraw*`;
    - OKX `trade` / `withdraw`;
    - Bitget `trade` / `withdraw`;
    - Coinbase `can_trade` / `can_transfer`;
  - fără tranzacționare → 400; cu retragere sau transfer → 400;
  - altfel `trading_enabled_at` și `trading_markets`, plus o intrare `enable` în jurnal.
- `disable(userId, accountId)`.
- `instrument`, `symbols`: pe trader.
- **`preview(userId, ticket)`:**
  - contul să fie al utilizatorului, cu tranzacționarea pornită și piața permisă;
  - apoi `trader.normalize`.
- **`place(userId, ticket)`:**
  1. aceleași verificări;
  2. limita de viteză (20 / min pe utilizator, fereastră glisantă în memorie);
  3. `INSERT` în jurnal cu `status = 'pending'` și `idem_key`, într-o tranzacție cu `UPDLOCK, HOLDLOCK`. Dacă există deja, sau dacă indexul unic prinde o cursă, se întoarce rezultatul rândului existent: `pending` → 409 `IN_PROGRESS`, `unknown` → 502, `sent` → rezultatul salvat;
  4. `trader.normalize` din nou: ce pleacă e exact ce a fost verificat, rotunjit la fel;
  5. `trader.place`;
  6. `UPDATE` cu starea, ID-ul și mesajul;
  7. `accounts.invalidate(id)`.
  - Un `UNKNOWN_OUTCOME` rămâne `unknown` în jurnal.
  - `rejected` / `error` pun `idem_key = NULL`: ordinul n-a intrat în carte, formularul se poate retrimite.
  - Rândul primește la final cantitatea în activ și prețurile rotunjite (o valoare scrisă în USDT apare în BTC).
  - Un rând `pending` mai vechi de 2 minute (o repornire în timpul trimiterii) răspunde ca `UNKNOWN_OUTCOME`.
  - `cancel`: piața unui simbol perpetuu (`…:USDT`) e `futures`, oricum ar lista-o contul; la brokeri e `stock`.
  - Limita de viteză se verifică înaintea jurnalului, ca un refuz pentru viteză să nu lege formularul.
  - `access` refuză și oprește tranzacționarea dacă permisiunile salvate permit mutarea fondurilor. `AccountsService.test` (butonul „Testează”) face la fel când citește o astfel de cheie. `enable` refuzat oprește și tranzacționarea pornită înainte.
- `cancel(userId, accountId, order)`: verificările, limita de viteză, `trader.cancel`, jurnal, `invalidate`.
- `log(userId)`: ultimele 50 de intrări.

### 5. API
- `GET /api/trading` → `{ accounts: TradingCaps[] }`.
- `POST /api/accounts/:id/trading` `{ enabled: true, password, code }` / `{ enabled: false }`.
- `GET /api/trading/:id/symbols?market=` (crypto, din lista de piețe deja încărcată a clientului; pagina o ține 10 min).
- `GET /api/trading/:id/instrument?market=&symbol=`.
- `POST /api/trading/:id/preview` (ticket) → `OrderPreview`.
- `POST /api/trading/:id/orders` (ticket) → `OrderResult`.
- `POST /api/trading/:id/cancel` `{ orderId, symbol, market, trigger }` → `OrderResult`.
- `GET /api/trading/log` → `TradeLogRow[]`.
- Toate:
  - cer un utilizator cu 2FA (bariera FD-2FA);
  - lucrează doar pe conturile lui (altfel 404);
  - CSRF ca orice scriere;
  - nu sunt în `ADMIN_ONLY`.
- Erorile:
  - `TradingError` → 400 cu `code`;
  - `RATE_LIMIT` → 429;
  - `UNKNOWN_OUTCOME` → 502 cu mesajul din FD §6.

### 6. Interfață
- **`components/OrderTicket.tsx`** (fereastră):
  - formularul (§2), cu `useQuery` pe `instrument` și `symbols`;
  - „Verifică ordinul” → `preview` → `ConfirmOrder`;
  - „Confirmă și trimite” → `orders` (același `idemKey` la orice reîncercare a aceluiași formular; unul nou la o modificare);
  - rezultatul;
  - recitește `['portfolio', id]` și jurnalul.
- **`pages/Trades.tsx`:**
  - „Ordin nou” / „Pornește tranzacționarea” (`EnableTrading`: parola + codul) / „Oprește”;
  - „Anulează” pe ordine (`cancellable`), „Închide” pe poziții, „Vinde” pe dețineri;
  - panoul „Ordinele trimise din Sentiq”.
- **`pages/Charts.tsx`:** „Tranzacționează” (doar cu un cont pornit care poate piața graficului) → `OrderTicket` precompletat.
- **`AccountWizard.tsx` / `Settings.tsx`:** textele noi; pașii `tradeSteps`; avertismentul de permisiuni din §8 al FD.

### 7. Siguranța codului
- Testul de odinioară devine:
  - `withdraw` / `transfer` (apeluri) nu apar nicăieri în `src/server`;
  - `createOrder` / `cancelOrder` / `setLeverage` / `setMarginMode` / `POST`-urile de ordin apar doar în `src/server/exchange/trading/`;
  - `cancelAllOrders` și `closeAllPositions` nu apar nicăieri;
  - FD-ORDEREDIT: `editOrder` și `PATCH`-urile (modificarea unui ordin sau a SL / TP-ului unei poziții) apar doar în `src/server/exchange/trading/`, ca plasarea și anularea.
- Jurnalul păstrează doar ce a plecat (fără chei). Log-urile serverului: o linie pe acțiune (contul, simbolul, latura, cantitatea, rezultatul), niciodată chei.

### 8. Teste
- `CcxtTrader`:
  - pe clienți simulați, pentru toate cele 7 exchange-uri: parametrii pe care Sentiq îi dă lui ccxt;
  - pe clasele ccxt reale (KuCoin futures și spot, Bybit, contul unificat Bitget, Coinbase), cu piețele puse din fixture (`setMarkets`) și `fetch` interceptat. Se verifică cererea HTTP care ar pleca:
  - rotunjirea, contractele;
  - levierul, marja, reduce-only, TP / SL;
  - stopul, clientOrderId-ul;
  - modul hedge: poziția numită pe fiecare exchange (TD-KUCOINHEDGE, TD-HEDGEALL §6, pe clasele ccxt reale, inclusiv Binance, OKX și Bitget clasic); refuzat doar pe contul unificat KuCoin;
  - TP / SL după intrare la Binance;
  - contul unificat KuCoin și Bitget (marja, stop-urile, suma la cumpărarea spot la piață), modul contului Bitget citit din setările v3;
  - erorile: răspuns ilizibil după trimitere → necunoscut; Binance `-2015` → permisiune.
- Brokerii, cu `fetch` simulat:
  - corpul, antetele și erorile Trading 212 (403, 429);
  - eToro: deschidere, închidere parțială, anulare, `lookup` executat / refuzat / timeout;
  - Alpaca: bracket, notional, crypto, regulile (fracționat, stop pe crypto, în afara orelor), 403 / 422.
- `TradingService`:
  - pornirea (pasul de autentificare, cheie fără tranzacționare, cu retragere, permisiuni necunoscute);
  - idempotența (aceeași cheie → același rezultat, un singur apel; `pending` → 409);
  - limita de viteză;
  - contul altuia → 404;
  - tranzacționarea oprită → 400;
  - jurnalul;
  - `invalidate`.
- Rutele, cap la cap, pe un exchange simulat.
- Portofoliul (`server.test.ts`): ordinele futures și stop citite pe Binance, cheia fără futures (inclusiv `-2015` nereîncercat, citirea sărită și cerută din nou după „Testează”), altă eroare → secțiunea marcată; Bybit: listele spot, tranzacțiile linear ca futures.
- Testul de siguranță a codului (§7).
- Interfața: verificată în Chrome pe o schemă de test, cu un exchange simulat.

## TD-INDICATORS — implementează FD-INDICATORS

### 1. Codul preluat (`src/web/indicators/vendor/`)
- **Sursa:** `deepentropy/lightweight-charts-indicators`, commit `f8e1b0ea80699a58f9d516ca74f0dfd5e6277ab2` (18 oct 2026, versiunea 0.16.8), licență MIT, păstrată în `vendor/LICENSE`.
- **Fișiere:**
  - `standard/*.ts`: cei 117 indicatori standard;
  - `render/*.ts`: `IndicatorRenderer` și primitivele lui;
  - ajutoarele pe care le importă: `types.ts`, `chart-context.ts`, `anchor-period.ts`, `alert-states.ts`, `other-symbol.ts`, `lower-tf-volume.ts`, `bar-time.ts`.
  - `vendor/README.md` spune de unde vin și ce s-a schimbat.
- **Singura modificare:** antetul `// @ts-nocheck` pe fiecare fișier.
  - Codul e scris pentru setările upstream (`strict`, fără `noUncheckedIndexedAccess` și `erasableSyntaxOnly`); sub setările Sentiq ar da ~1.300 de erori de tip, nu de logică.
  - Tipurile exportate rămân folosite de codul Sentiq.
  - Importurile de tipuri au deja `type`, deci `verbatimModuleSyntax` nu schimbă nimic la build.
- **Dependență nouă:** `oakscriptjs` **0.12.3** (MIT, fixată exact; aceeași cu upstream la commit).
  - Verificat: fără `eval`, `Function`, `fetch`, `XMLHttpRequest` sau WebSocket, nici în ea, nici în codul preluat.
  - `lightweight-charts` (5.2.1) există deja.
- **Mărime:** toți cei 117 + renderer + ce folosesc din `oakscriptjs`: ~380 KB minificat / ~112 KB gzip (chunk-ul `runtime-impl`), încărcat dinamic (§5).
- **Viteză (5.000 de bare, Node 24):** 117 indicatori în ~0,7 s în total; cei mai mulți sub 10 ms; cei mai grei ~100 ms (Auto Fib Retracement, Technical Ratings, Trading Sessions, Ghost Pivots).

### 2. Catalogul (`src/web/indicators/catalog.ts`, `src/shared/studies.ts`)
- **`shared/studies.ts`** (server și web):
  - `STUDY_IDS`: cele 118 id-uri (117 + `volume`);
  - `STUDY_MAX = 20`;
  - `studySchema`: `{ uid, id, inputs, visible, plots?, hlines?, height? }`:
    - `uid`: `/^[a-z0-9]{6,24}$/`;
    - `inputs`: cel mult 80 de chei `/^[A-Za-z_][A-Za-z0-9_]{0,63}$/`, valori `boolean | number finit | string ≤ 300`;
    - `plots` / `hlines`: cel mult 40 de chei, fiecare `{ visible?, color? (≤ 40, #hex sau rgba), width? (1–4) }`;
    - `height`: raportul față de panoul prețului, 0,05–3.
  - `studiesSchema`: listă de cel mult 20, cu `uid` unice.
- **`web/indicators/catalog.ts`:** intrările generate din registrul upstream (`src/index.ts`, `group: 'standard'`):
  - `id`, `name`, `shortName`, `description`, `category`;
  - modulul indicatorului: `calculate`, `metadata`, `defaultInputs`, `inputConfig`, `plotConfig`, `hlineConfig`, `fillConfig`, `requiredSymbols`;
  - `usesVisibleRange`;
  - plus `volume` (scris în Sentiq, §3).
  - Categoriile upstream: `Moving Averages`, `Oscillators`, `Momentum`, `Trend`, `Volatility`, `Channels & Bands`, `Volume`, cu numele românești din FD.
- **Verificare în teste:** `STUDY_IDS` și catalogul au exact aceleași id-uri.

### 3. `volume` (`web/indicators/volume.ts`)
- Același format ca modulele upstream.
- Intrări: `showMA` (false), `maLength` (20, 1–5000), culorile `#26A69A80` / `#EF535080`; o lumânare cu `close >= open` e „sus”.
- Plot-uri:
  - `plot0` „Volume”: coloane, culoarea fiecărei bare după lumânare;
  - `plot1` „Volume MA”: linie `#2196F3`, vizibilă după `showMA`.
- Desenat în panoul lui, nu overlay.

### 4. Setările (`shared/settings.ts`, `server/settings.ts`)
- **Cheie personală nouă de prim nivel: `studies: studiesSchema.default([])`.**
  - E separată de `charts`, pentru că `salvage` recuperează cheie cu cheie: o listă stricată nu mai trage după ea perechea, bifele și înălțimea LMA.
  - `USER_KEYS` primește `studies`.
- **`salvage`** primește o regulă pentru `studies`: păstrează elementele care trec de `studySchema`, cu `id` cunoscut și `uid` unic, până la 20. Un id scos dintr-o versiune viitoare a catalogului lasă restul listei neatins.
- **Scrierea** (`PUT /api/settings { studies: [...] }`): lista se înlocuiește întreagă (`deepMerge` înlocuiește listele). O listă invalidă dă 400, cu mesajul obișnuit.
- `charts.showSlingshot` / `charts.showLma` / `charts.lmaPane` rămân neschimbate.

### 5. Încărcarea (`web/indicators/runtime.ts`)
- `loadStudyRuntime()`: `import('./runtime-impl.ts')`, o singură dată (promisiune ținută minte). Conține catalogul, `IndicatorRenderer` și calculul; e chunk-ul de ~112 KB gzip.
- Pagina Grafice îl cere când lista are cel puțin un indicator vizibil sau când se deschide fereastra Indicatori.
- `catalog-meta.ts` rămâne mic și static, fără calcul: id, nume, prescurtare, categorie, overlay, descriere, generat odată cu catalogul. Fereastra se deschide imediat; calculul vine după.

### 6. Calculul (`web/indicators/compute.ts`)
- **Barele:** `{ time: t / 1000, open, high, low, close, volume }` (secunde, ca graficul).
- **Contextul graficului (`ChartContext`):**
  - `timeframe` (Pine: `1`, `3`, `5`, `15`, `30`, `60`, `120`, `240`, `360`, `480`, `720`, `1D`, `1W`);
  - `timezone` / `session`: crypto `Etc/UTC` / `24x7`; acțiuni și indici `America/New_York` / `0930-1600`;
  - `tickerid`: crypto `EXCHANGE:BASEQUOTE`, acțiuni `NASDAQ:AAPL`, indici `INDEX:SPX`;
  - `symbolType` (`crypto` / `stock` / `index`), `currency` (quote sau `USD`), `mintick` (10^-precizie), `timeUnit: 's'`;
  - `lastBarConfirmed: false` (ultima lumânare e în formare);
  - `leftVisibleBarTime` / `rightVisibleBarTime`, doar pentru `usesVisibleRange`;
  - `bars(symbol, tf)`: doar pentru indicatorii cu `requiredSymbols` (§7).
- **Intrările:** `sanitizeInputs(entry, saved)` pornește de la `defaultInputs` și ia fiecare valoare salvată doar dacă se potrivește câmpului:
  - `int`: întreg în `[min, max]`; `float`: finit în `[min, max]`;
  - `bool`; `string` cu `options`: una dintre ele; `string` liber: ≤ 300;
  - `source`: una din cele 8; `color`: `#RRGGBB(AA)` sau `rgba()`;
  - `timeframe`: `''` sau Pine valid; `symbol`: ≤ 300; `session`: `/^\d{4}-\d{4}(:[1-7]+)?$/`.
  - Restul primește valoarea implicită; cheile necunoscute se ignoră.
- **`runStudy(entry, bars, inputs, ctx)`** → `{ result, error, approximated, missing }`:
  - excepțiile se prind;
  - `MissingSymbolDataError` → `missing` (lista simbolurilor);
  - mesajul altei erori → `error` (≤ 200 de caractere).
- **Volum:** dacă toate barele au `volume = 0` și indicatorul e în `VOLUME_STUDIES`, nu se calculează: `error = 'Indicii nu au volum.'`. `VOLUME_STUDIES` = categoria Volume + VWMA, VWAP, MFI, Klinger, EOM, PVT, OBV, Chaikin, CVD, 24-hour Volume, Relative Volume at Time.
- **`useStudies(...)`** (hook):
  - calculează indicatorii vizibili câte unul pe macrotask (`setTimeout(0)` între ei), ca pagina să nu înghețe;
  - rezultatele se țin pe cheia `uid + id + inputs + bars (lungime, ultimul timp și close) + extra`; o recalculare pornește doar când se schimbă cheia;
  - un calcul nou îl anulează pe cel neterminat (generație);
  - `usesVisibleRange`: recalcul la 300 ms după ultima schimbare a zonei vizibile.

### 7. Date în plus (`web/indicators/extra-bars.ts`)
- **`pineTf(tf)` ↔ `sentiqTf(pine)`:**
  - `1`, `3`, `5`, `15`, `30`, `60`, `120`, `240`, `360`, `480`, `720` → minutele corespunzătoare;
  - `D` / `1D` → `1d`; `W` / `1W` → `1w`; `M` / `1M` → `1M` (agregat din `1d`);
  - restul (secunde, `2D`, `3M`…) → nesuportat.
- **`resolveSymbol(request, chart)`:**
  - **același simbol:** `tickerid`-ul graficului sau tickerul fără prefix;
  - **crypto:** „BASE/QUOTE”; un prefix de exchange crypto; un ticker terminat în USDT / USDC; o monedă majoră cu quote-ul ei („BTCUSD”); iar pe un grafic crypto, orice ticker terminat în USD / BTC / ETH / EUR. USD → USDT;
  - **forex** (prefixele FX, OANDA… sau două coduri de monedă, „EURUSD”) și futures („ES1!”) → nerezolvat;
  - **acțiune:** `[NASDAQ|NYSE|AMEX|BATS|ARCA:]TICKER`, cu tickerul după `stock:` din `CHART_SYMBOL_RE`;
  - altfel → nerezolvat.
- **Încărcare:**
  - fiecare cerere rezolvată, cu timeframe ≥ al graficului și pe care sursa îl are, se descarcă prin `/api/market/candles` (aceleași query-uri React Query ca graficul, deci aceeași cheie de cache);
  - `limit`: pentru același simbol, câte lumânări acoperă istoria graficului + 50, cel mult limita graficului (ca `htfCandleCount`); pentru alt simbol, limita graficului;
  - `refetchInterval` 5 min;
  - `1M` = `1d` agregat pe luni calendaristice în fusul sursei (open primul, high max, low min, close ultimul, volume suma).
- **Decizia per indicator:**
  - toate cererile date → contextul are `bars`;
  - altfel, dacă toate sunt pentru simbolul graficului → calcul **fără** `bars` (varianta originalului din barele graficului), `approximated = true`;
  - altfel → `bars` întoarce barele date și `undefined` pentru restul; `MissingSymbolDataError` → `missing` (mesajul din FD §5).

### 8. Desenarea (`web/chart/CandleChart.tsx`)
- **Props noi:**
  - `studies: StudyDraw[]` (`uid`, `entry`, `result`, `renderOptions`, `paneKey` sau `null` pentru overlay);
  - `paneOrder: string[]` (`'lma'` și uid-urile cu panou, în ordine);
  - `paneFactors: Record<string, number>`;
  - `onPaneFactors(changed)`;
  - `legends: Record<'main' | cheie de panou, (bar) => ReactNode>`;
  - `onVisibleRange({ from, to })` (ms, la 300 ms după ce vederea se oprește), dat doar când un indicator citește zona vizibilă;
  - `style` (înălțimea, `560 + 120 × panouri` px).
  - Dispar: `lmaShare`, `onLmaShareChange`, `lmaLegend` (incluse în cele de mai sus).
- **Panourile:** 0 = prețul; apoi, în ordinea `paneOrder`, LMA (dacă e) și fiecare indicator vizibil cu panou propriu.
  - `layoutKey` = `paneOrder.join()`. La schimbarea lui: se șterg toate seriile din panourile > 0 (`IndicatorRenderer.clear()` pentru fiecare indicator, apoi seria LMA), iar panourile goale dispar; apoi se recreează în ordine (LMA la indexul ei, apoi `renderer.setPaneIndex(i)` + `render`).
  - Fără schimbare de layout: `render(..., { reuseSeries: true })` pe fiecare.
  - Overlay-urile: un renderer pe pane 0, cu `mainSeries` = lumânările.
  - **Vederea:** punctele desenate înaintea ultimei lumânări (norul Ichimoku, 26 de bare în viitor) lungesc axa timpului, iar biblioteca mută vederea de pe lumânările arătate (măsurat: 25 de bare spre trecut). La fiecare desenare, indexul ultimei lumânări (`timeToIndex`) și zona vizibilă se citesc înainte și după; dacă vederea s-a mutat față de ultima lumânare, se pune înapoi (și în cadrul următor, când biblioteca își mai potrivește axa).
  - **Vederea ținută minte** (TD-CHARTUX §4) se măsoară tot de la ultima lumânare (`zona vizibilă.to − indexul ultimei lumânări`), nu de la ultimul punct al axei: altfel, cu Ichimoku, la revenire ultima lumânare ar fi tăiată la margine. Fără indicatori care desenează înainte, e aceeași valoare ca `scrollPosition()`, deci vederile salvate rămân valabile. Vederea perechii părăsite se salvează înainte să intre lumânările noi.
  - **Momentul:** biblioteca își aplică opțiunile (`rightOffset`, `barSpacing`) în primul ei cadru, peste o vedere pusă înainte, și ignoră o vedere cât graficul nu are lățime. Vederea ținută minte (sau cea implicită, ultimele 180 de bare) se pune deci după acel cadru (`requestAnimationFrame`), când `timeScale().width() > 0` (altfel la prima schimbare de mărime). Un contor (`viewEpoch`) oprește corecția de după desenarea indicatorilor să readucă o vedere mai veche.
  - `shiftVisibleRangeOnNewBar: false`: lipirea de marginea din dreapta la lumânări noi o face codul (efectul datelor); a bibliotecii pornea și pentru punctele desenate în viitor de un indicator și muta vederea.
- **Înălțimile:**
  - stretch factor 1 pentru preț, `paneFactors[key]` pentru restul;
  - LMA: `lmaPane / (1 − lmaPane)` (aceeași înălțime ca până acum);
  - indicatorii: `height`, implicit 1/3;
  - după `pointerup` pe grafic se citesc factorii; cei schimbați cu peste 1 % se raportează (`onPaneFactors`) și se salvează: LMA ca `lmaPane = f / (1 + f)`, limitat la 0,1–0,7; indicatorii ca `height`, limitat la 0,05–3.
- **Înălțimea graficului:** `560 + 120 × panouri` px; ecran complet `h-full`.
- **Legendele:** `boxes` măsoară fiecare panou (ca acum pentru LMA). Pentru fiecare legendă, un div `pointer-events-none` absolut în panoul ei; butoanele au `pointer-events-auto`. Bara de sub cursor e o singură stare (`HoverBar`), cu un singur abonament la crosshair.
- **Stilul aplicat** (`renderOptions` + `entry` copiat):
  - `plots[id] = { visible, color, lineWidth, palette: { [culoarea implicită]: color } }`;
  - `hlineConfig` filtrat (`visible`) și recolorat;
  - `fills` (rezultat și `fillConfig`) fără cele care leagă un plot ascuns;
  - `inputs` pentru plot-urile vizibile după o intrare.

### 9. Interfața
- **`components/IndicatorPicker.tsx`** (în `Modal`):
  - căutare (normalizată NFD, fără diacritice, litere mici);
  - categoriile: un `role="group"` de butoane `aria-pressed` (coloană pe ecran lat, rând derulabil pe telefon); în timpul unei căutări, niciuna nu e apăsată (căutarea e în toate);
  - lista: butoane cu numele, prescurtarea, „pe grafic” / „panou separat”, `title` = descrierea, insigna PREMIUM;
  - „Adăugat” 1,5 s după click; „Pe grafic” pentru Slingshot / LMA afișate; dezactivat la 20.
- **`components/StudySettings.tsx`:**
  - formularul generat din `inputConfig`: `group` → `fieldset`, `inline` → un rând, `tooltip` → (i);
  - `active: { input, eq | ne }` → câmp dezactivat cât condiția nu ține;
  - tabul „Stil” din `plotConfig` (fără plot-urile cu culoarea `transparent` sau `display` `data_window` / `status_line`) și `hlineConfig`;
  - „Salvează” validează cu regulile din §6 (mesajul cu câmpurile și limitele) și salvează lista întreagă (`optimistic: false`); „Valorile implicite” golește formularul la valorile din `defaultInputs` și fără suprascrieri de stil.
- **`pages/Charts.tsx`:**
  - bifele Slingshot / LMA scoase;
  - „Indicatori” → `IndicatorPicker`;
  - sertarul de setări primește ținta `slingshot` | `lma` | `study:<uid>` (fără tab-uri între indicatori);
  - legendele: Slingshot în panoul prețului (rotiță, ×), overlay-urile după ea, LMA și panourile în ale lor;
  - adăugarea, scoaterea, ochiul și înălțimile se salvează optimist (`saveSettingsPatch`), iar la eroare se recitesc setările (mecanismul existent);
  - `uid` nou: 12 caractere `[a-z0-9]` din `crypto.getRandomValues`.
- **Numerotarea legendelor:** doi indicatori cu același id și aceleași intrări primesc „#2”, „#3”.

### 10. Teste
- **`shared/studies.test.ts`:** schema (valid, id necunoscut, uid dublat, 21 de elemente, chei și valori greșite).
- **`server.test.ts`:**
  - `studies` salvat și citit per utilizator (și de un utilizator fără admin);
  - `salvage` păstrează elementele valide;
  - `charts` neatins de o listă stricată.
- **`web/indicators/*.test.ts`:**
  - catalogul ↔ `STUDY_IDS`;
  - fiecare indicator calculat pe bare sintetice (1.500), fără excepții, în afară de Correlation / Performance fără date;
  - `sanitizeInputs` pe fiecare tip;
  - `pineTf` / `sentiqTf`;
  - `resolveSymbol`;
  - agregarea lunară;
  - decizia din §7 (dat / aproximat / lipsă);
  - `volume`;
  - parametrii din legendă;
  - factorii panourilor (LMA ↔ `lmaPane`).
- **Interfața,** în Chrome pe o schemă de test:
  - adaugă RSI, MACD, EMA, Bollinger, Volume;
  - setările (o intrare, o culoare);
  - ochiul, ×, trasul separatorului, ecranul complet;
  - Slingshot / LMA scoase și adăugate din listă;
  - fără erori în consolă.

## TD-PREMIUMHIDE — implementează FD-PREMIUMHIDE

### 1. Setările (`shared/settings.ts`)
- `charts.slingshotHidden: z.boolean().default(false)` și `charts.lmaHidden: z.boolean().default(false)`.
- Setările vechi primesc `false`. `salvage` nu se schimbă: cheia `charts` se recuperează ca întreg, iar câmpurile noi au valoare implicită.
- `DEFAULT_CHART_PREFS` (Charts.tsx) primește ambele `false` (server vechi).

### 2. Ce se desenează (`web/chart/premium.ts`)
- `premiumState(prefs)` → `{ slingshot, lma }`, fiecare `'off' | 'shown' | 'hidden'`: `off` când `showX` e false, `hidden` când e pe grafic și ascuns.
- `premiumNote(state)`: ce scrie în dreapta rândului din lista Indicatori: `null`, „Pe grafic” sau „Pe grafic, ascuns”.
- **Charts.tsx:**
  - `CandleChart` primește `result` doar cu Slingshot `shown`; caseta TP / SL și avertismentele Market Structure la fel;
  - `runLma` rulează doar cu LMA `shown`. Ramura existentă `lma === null` din `CandleChart` scoate seria, panoul, liniile și culorile lumânărilor;
  - `paneOrder` conține `lma` doar atunci; `paneFactors.lma` rămâne din `lmaPane`, deci înălțimea revine la loc.

### 3. Legendele
- **Slingshot:** `LegendRow dim={hidden}`, cu `LegendButtons hidden onToggle`; ochiul salvează `{ charts: { slingshotHidden: !hidden } }` (`remember`, optimist).
- **LMA:**
  - `shown`: legenda din panoul lui, cu ochi;
  - `hidden`: un rând estompat în `legends.main`, după Slingshot, cu prescurtarea și parametrii din `effectiveLmaParams(lmaParams)` (fără calcul) și cu ochi.
- **`legends.main`** există când Slingshot nu e `off`, LMA e `hidden` sau sunt indicatori în panoul prețului.
- **×:** `{ showX: false, xHidden: false }`.
- **Lista Indicatori:** `onAddPremium` salvează `{ showX: true, xHidden: false }`. Pentru un premium ascuns, rândul arată „Pe grafic, ascuns”: `premiumOn` devine `Record<PremiumKey, 'off' | 'shown' | 'hidden'>`.

### 4. Teste
- Schema: câmpurile noi implicit `false`, păstrate când sunt salvate.
- `premiumState`: cele trei stări pentru fiecare.
- `premiumNote`: textul rândului din listă pentru fiecare stare (proiectul nu are teste de componente; rândul îl folosește direct).
- În Chrome: ochiul pe ambele, legenda estompată, panoul LMA și culorile lumânărilor, zoom-ul păstrat, după reîncărcare.

## TD-TRADEUNLOCK — implementează FD-TRADEUNLOCK

### 1. Server
- **`UserService.stepUp`** → `'ok' | 'password' | 'code'` (în loc de boolean): parola întâi (una greșită nu consumă un cod de recuperare), apoi codul.
- **`PasskeyService`:**
  - `stepUpOptions(userId, rp)`: `generateAuthenticationOptions` cu `allowCredentials` = passkey-urile utilizatorului (e autentificat, deci lista lui nu spune nimic nou) și `userVerification: 'required'`; provocarea are scopul `'stepup'` și `userId`;
  - `completeStepUp(userId, challengeId, response, rp)`: `consume(id, 'stepup', userId)`, apoi aceeași verificare ca la login (`verifyAssertion`, comună), plus `row.user_id === userId` înainte de verificare (contorul altui cont nu se atinge). Aruncă `PasskeyError`.
- **Rute:**
  - `POST /api/trading/passkey/options` (autentificat): opțiunile, plus cookie-ul `sentiq_webauthn` (`/api`, 5 min);
  - `POST /api/accounts/:id/trading`: `{ enabled: true, password?, code? } | { enabled: true, passkey: {...} }`. Cu `passkey`: cookie-ul se citește și se șterge; `PasskeyError` → 400 `PASSKEY`, fără `registerFailure`, iar o pauză în curs nu-l oprește; reușita golește bugetul (`throttle.reset`). Cu parolă și cod: ca până acum, iar după un eșec mesajul primește încercările rămase (`throttle.remaining`).
- **`TradingService.enable(userId, accountId, confirm)`** (fără `UserService` în dependențe; ruta dă `confirm`):
  - `confirm: () => Promise<'ok' | 'password' | 'code'>`;
  - ordinea: acces, platformă, permisiuni (recitite; refuz = `PERMISSION`), apoi `confirm()`;
  - `'password'` / `'code'` → `BAD_FACTORS` cu mesajul factorului (numele platformei din `PROVIDERS`);
  - `log.warn('trading: user N switching trading on for account M refused: wrong password|code')`; passkey-ul refuzat se notează în rută.

### 2. Web (`TradingControls.tsx`)
- Fereastra citește `/api/account` (aceeași cheie de cache `['account']` ca Securitate, mutată în `hooks.ts` ca `useAccountInfo`).
- **„Confirmă cu passkey”** apare când `browserSupportsWebAuthn()`, `passkeysHere` și există cel puțin un passkey: opțiuni → `startAuthentication` → POST cu `passkey`. Erorile browserului trec prin `passkeyMessage` (mutat din `Auth.tsx` în `web/passkey.ts`).
- Textele câmpurilor și indiciul, cu numele platformei.

### 3. Teste
- `stepUp`: parolă greșită → `'password'` (codul de recuperare nu se consumă); cod greșit → `'code'`; ambele corecte → `'ok'`.
- Ruta: mesajul fiecărui factor, încercările rămase („Mai ai 2 încercări”), apoi 429.
- Permisiunile întâi: o cheie doar de citire e refuzată fără să consume încercări (patru încercări la rând, toate `PERMISSION`, niciun 429), iar lista recitită se salvează.
- Passkey: opțiunile au `allowCredentials` cu passkey-urile utilizatorului; o provocare de login nu merge pentru step-up și invers; passkey-ul altui utilizator e refuzat fără să-i atingă contorul; un `PasskeyError` nu consumă încercări. Testul semnează cu autentificatorul software din `users.test.ts` (aceeași verificare criptografică ca la login).

## TD-STUDYUX — implementează FD-STUDYUX

### 1. Favoritele
- **`shared/studies.ts`:**
  - `FAVORITE_IDS = [...PREMIUM_KEYS ('slingshot', 'lma'), ...STUDY_IDS]`;
  - `studyFavoritesSchema = z.array(z.enum(FAVORITE_IDS)).max(FAVORITE_IDS.length)`, cu id-uri unice.
- **`shared/settings.ts`:** cheia personală de prim nivel `studyFavorites: studyFavoritesSchema.default([])`.
  - E separată de `studies`, ca o listă stricată să nu le ia pe celelalte.
  - `USER_KEYS` primește `studyFavorites`.
- **`server/settings.ts`:** `salvage` păstrează din `studyFavorites` id-urile cunoscute, fără dubluri (`salvageFavorites`).
- **Scrierea:** `PUT /api/settings { studyFavorites: [...] }`. Lista se înlocuiește întreagă și se calculează din ultima din cache, ca la `studies` (două click-uri rapide contează amândouă).
- **`IndicatorPicker`:**
  - primește `favorites: readonly string[]` și `onToggleFavorite(id)`;
  - categoria `'favorites'` e prima, cu numărul, și e cea inițială când lista nu e goală;
  - rândul devine `<li class="flex">` cu butonul de adăugare (`flex-1`) și butonul stelei (`Star` din lucide, umplută cu `fill-current text-accent` când e favorit). Eticheta spune ce face un click („Adaugă X la favorite” / „Scoate X din favorite”), ca la butoanele ochi; un buton nu poate sta în alt buton.

### 2. Bara de jos
- **Formularele** (`StudySettings`, formularul Slingshot / LMA din `Charts.tsx`): `px-5 pt-4`, fără `pb`, ca bara să ajungă la marginea de jos a zonei care derulează.
- **Bara:** `sticky bottom-0 -mx-5 mt-auto px-5 py-4 bg-panel border-t`, pe toată lățimea; `z-10`, ca textul derulat să treacă pe sub ea.

### 3. Stilul liniilor
- **`shared/studies.ts`:**
  - `studyPlotStyleSchema`: `width` 1–6 (era 1–4) și `style?: 'solid' | 'dashed' | 'dotted'`;
  - `studyHlineStyleSchema`: `width?` 1–6 și `style?`.
- **`web/indicators/style.ts`:**
  - `styledEntry` pune `linestyle` din `style` în copia `plotConfig` a intrării (renderer-ul citește `def.linestyle`) și `lineWidth` din `width` în override, ca acum;
  - pentru hline-uri: `linestyle` și `linewidth` în `hlineConfig`.
  - Codul preluat nu se schimbă.
- **Funcții noi:**
  - `lineKind(def)` → `'line'` (line, stepline, stepline_diamond, linebr, steplinebr, area, areabr: tip și grosime), `'width'` (histogram, circles, cross: doar grosime), `null` (restul);
  - `plotWidth(def)`: grosimea desenată fără alegere (a liniei, altfel cea a renderer-ului: 2 px, 1 px la histogramă); la hline: `linewidth ?? 1`;
  - `widthChoices(drawn)` → `[drawn, drawn + 1, drawn + 2]`, cu `drawn` limitat la 1–4.
- **`StudySettings` („Stil”):** select-urile „Tip” și „Grosime”. O grosime salvată care nu e între cele trei apare ca opțiune în plus („N px”).

### 4. Teste
- Schema: favoriții (necunoscuți / dubluri refuzați; salvage păstrează ce e valid), `width` până la 6, `style`.
- `styledEntry`: tipul și grosimea ajung în `plotConfig` / override / `hlineConfig`; fără alegeri, intrarea e cea originală.
- `lineKind`, `widthChoices`.
- Serverul: `studyFavorites` salvat și citit per utilizator; o listă veche cu un id necunoscut își păstrează restul.

## TD-STUDYMEMORY — implementează FD-STUDYMEMORY

### 1. Setarea (`shared/studies.ts`, `shared/settings.ts`, `server/settings.ts`)
- **`studyMemorySchema`:**
  - o listă de `{ id, inputs, plots?, hlines?, height? }`, cu aceleași reguli pe câmp ca `studySchema`;
  - cel mult `STUDY_IDS.length`, fiecare `id` o singură dată;
  - **listă, nu obiect:** `deepMerge` înlocuiește listele, deci memoria unui indicator se înlocuiește întreagă. Un obiect ar amesteca intrările vechi cu cele noi, iar `changedInputs` salvează doar diferențele față de valorile implicite.
- **Cheia personală:** `studyMemory: studyMemorySchema.default([])`, cu `USER_KEYS` += `studyMemory`.
- **`salvageStudyMemory`:** păstrează elementele valide, cu `id` cunoscut, primul pentru fiecare `id`.

### 2. Pagina (`Charts.tsx`, `web/indicators/memory.ts`)
- **`memoryOf(study)`** → `{ id, inputs, plots?, hlines?, height? }`.
- **`remember(list, entry)`** → lista cu intrarea înlocuită sau adăugată.
- **`fromMemory(id, entry, uid)`** → studiul nou: `visible: true` și câmpurile ținute minte.
- **`saveStudies(change, optimistic, memo?)`** trimite `{ studies, studyMemory? }` într-un singur patch. Ambele se calculează din ultimele valori din cache, deci două click-uri rapide contează amândouă.
  - `addStudy`: din memorie, dacă are;
  - `removeStudy`: memoria primește copia scoasă;
  - `saveStudy` (formularul): memoria primește copia salvată;
  - salvarea formularului nu e optimistă (serverul poate refuza o valoare), deci ajunge în cache abia cu răspunsul. O scoatere pornită între timp o așteaptă (`formSave`), altfel ar ține minte setările de dinainte de salvare.

### 3. Teste
- **Schema:** câmpurile memoriei, dublurile refuzate, `salvageStudyMemory`.
- **`memory.ts`:** `memoryOf` (fără `uid` și `visible`), `remember` (înlocuiește, adaugă), `fromMemory` (vizibil, uid nou, fără memorie = valorile TradingView).
- **Serverul:** memoria salvată per utilizator, înlocuită întreagă (o intrare veche cu `src: 'hl2'` nu rămâne după una fără `src`).
- **Chrome:**
  - RSI cu lungimea 21 și linia punctată, scos și adăugat: vine cu 21 și punctat;
  - după reîncărcare la fel;
  - „Valorile implicite” + „Salvează”, scos și adăugat: vine cu valorile TradingView.

## TD-GOLATEST — implementează FD-GOLATEST
- **`CandleChart`:** `checkBehind()` compară `getVisibleLogicalRange().to` cu indexul logic al ultimei lumânări (`timeToIndex(shownLast)`, nu `n − 1`: un indicator poate desena înaintea ei). Rezultatul ajunge în starea `behind`.
- **Când se recalculează:**
  - la fiecare schimbare a vederii (`onRange`);
  - după datele noi ale aceleiași perechi (la finalul efectului de date);
  - la o schimbare de pereche / timeframe, butonul se ascunde până vine vederea cheii noi (un cadru mai târziu), ca să nu clipească după vederea veche.
- **Butonul:**
  - poziție absolută în colțul celui mai de jos panou din `boxes` (deasupra axei timpului, în stânga axei prețului), 32 px, `z-10`;
  - click: `timeScale().scrollToRealTime()`.
- **Overlay-ul panoului prețului** (caseta TP / SL) urcă cu `translateY(−42px)` cât timp butonul e în același panou.

## TD-RODESC — implementează FD-RODESC
- **`web/indicators/catalog-meta.ts`:** cele 118 `description` traduse.
- **`vendor/README.md`:** o regenerare păstrează traducerile și traduce doar indicatorii noi.
- **`catalog.test.ts`:** fiecare descriere are peste 10 caractere și niciun cuvânt englezesc frecvent (the / and / of / with / using / measures / shows / price / average).

## TD-HLINELEVELS — implementează FD-HLINELEVELS
- **`studyHlineStyleSchema`:** `price?` (număr finit, ±1e12).
- **`styledEntry`:** `price` din stil în copia `hlineConfig`. Renderer-ul ia din ea și liniile, și umplerile dintre ele.
- **`StudySettings`:**
  - câmp numeric „nivel” pe rândul fiecărei linii orizontale (golit = `NaN`);
  - la „Salvează”, un nivel invalid e refuzat cu numele liniei, iar formularul trece pe „Stil”.
- **Teste:**
  - schema (finit, limite);
  - `styledEntry` pe Stochastic RSI: nivelurile 90 / 50 / 10 ajung în `hlineConfig`, iar `fillConfig` rămâne între aceleași linii.

## TD-TICKETMEMORY — implementează FD-TICKETMEMORY

### 1. Setarea (`shared/trading.ts`, `shared/settings.ts`, `server/settings.ts`)
- **`ticketPrefsSchema`** (toate câmpurile opționale, `.strict()`):
  - `market`: spot / futures / stock;
  - `side`: buy / sell;
  - `kind`: tipurile de ordin;
  - `amountIn`: base / quote;
  - `tif`: gtc / day;
  - `leverage`: întreg 1–125;
  - `marginMode`: cross / isolated;
  - `reduceOnly`, `extendedHours`: boolean.
- **`orderTicketMemorySchema`:**
  - `lastAccount: { crypto?: id, stocks?: id }`;
  - `accounts: Record<id, ticketPrefs>`, cu cel mult 200 de conturi (un patch nu poate șterge chei; limita e departe de numărul real de conturi, ca o salvare să nu fie refuzată pe tăcute); cheile sunt id-uri (`/^\d{1,9}$/`).
  - Obiect, nu listă: un patch pe un câmp (`{ accounts: { "12": { kind: 'limit' } } }`) se unește câmp cu câmp, exact ce trebuie aici.
- **Cheia personală:** `orderTicket: orderTicketMemorySchema.prefault({})`, cu `USER_KEYS` += `orderTicket`.
- **`salvageOrderTicket`:** păstrează contul ultim valid și intrările valide ale conturilor.

### 2. Formularul (`OrderTicket.tsx`, `web/components/ticket-memory.ts`)
- **`rememberedFields(memory, accountId, seed)`:**
  - întoarce setările de aplicat: fără cele pe care le dă seed-ul (`market`, `side`, `orderKind`, `reduceOnly`, `marginMode`);
  - nimic pentru un formular de închidere (`seed.close` / `seed.reduceOnly`).
- **`ticketPatch(accountId, prefs)`** → `{ orderTicket: { accounts: { [id]: prefs } } }`.
- **`accountPatch(kind, id)`** → `{ orderTicket: { lastAccount: { [kind]: id } } }`.
- **Contul inițial:** `seed.accountId`, altfel `lastAccount[seed.kind]`, dacă e eligibil, altfel primul eligibil. `lastAccount` se salvează când alegi contul în formular și după un „Verifică ordinul” reușit (nu la închideri).
- **Aplicarea:**
  - un efect, când contul rezolvat se schimbă și setările sunt încărcate, aplică `rememberedFields` o singură dată pe cont (`appliedFor`);
  - schimbarea contului în formular aplică setările acelui cont.
- **Salvarea:**
  - setter-ele câmpurilor (piață, direcție, tip, unitate, valabilitate, levier, marjă, reduce-only, în afara orelor) salvează și câmpul lor, prin `saveSettingsPatch` (optimist, în coadă);
  - nu în formularele de închidere;
  - `fill()` (25 / 50 / 100 %) folosește setter-ul simplu al unității, deci nu se ține minte;
  - o alegere făcută înainte să se încarce setările marchează contul ca aplicat (`appliedFor`), ca memoria venită mai târziu să n-o suprascrie;
  - levierul se ține minte doar ca întreg valid.

### 3. Teste
- **Schema:** câmpurile, cheile id, limita de 200, câmpurile necunoscute refuzate; `salvageOrderTicket`.
- **`rememberedFields`:** seed-ul câștigă; închiderea ignoră memoria; contul fără memorie.
- **Serverul:** memoria salvată per utilizator, unită câmp cu câmp.
- **Chrome:**
  - Futures + limită + levier 10 + Cross, închis fără trimitere, apoi un ordin nou: același, cu cantitatea goală;
  - după reîncărcare la fel;
  - „Închide” o poziție nu o schimbă.

## TD-KEYIPS — implementează FD-KEYIPS
- **`shared/server-ips.ts`:** `SERVER_IPS` (cele 13 adrese) și `SERVER_IPS_TEXT` (despărțite prin virgulă).
- **`ProviderDef.ipRestrict`:** adevărat la cele nouă platforme. Pașii lor (și `tradeSteps` la KuCoin, Binance, Trading 212) trimit la listă.
- **`AccountWizard`:** `ServerIps` sub pași:
  - `navigator.clipboard.writeText`, altfel selecția listei;
  - avertismentul local când `location.hostname` nu e sentiq.money / azurewebsites.net.
- **Texte:** Setări → Conturi, Tranzacții (fără conturi), ghidul (lista și unde se pune).

## TD-ETOROUNITS — implementează FD-ETOROUNITS
- **`closePlan(held, ids, units)`** (`etoro.ts`, exportat):
  - fără `units`: toate întregi;
  - altfel, întregi în ordinea `ids` până la ultima, din care se scade restul (8 zecimale, toleranță 1e-9);
  - pozițiile care nu mai sunt deținute se sar.
- **`normalize`:**
  - scoate refuzul „o singură poziție”;
  - mesajul de prea multe unități spune „Pozițiile au” la mai multe;
  - avertismentul cu împărțirea.
- **`place`:** cu `units` și mai multe poziții, recitește portofoliul și aplică planul. `UnitsToDeduct` e `null` (întreagă) sau restul; câte o cerere pe intrare din plan (`nthRequestId`); un plan gol dă `REJECTED`.
- **`OrderTicket`:** câmpul nu mai e dezactivat; indiciul explică ordinea, iar placeholder-ul arată totalul.
- **Teste:** `closePlan` (ordinea, o parte, sărite, peste total, sume zecimale) și închiderea a 3 din 5 unități în două cereri (`null`, apoi 1).

## TD-ETOROPICK — implementează FD-ETOROPICK
- **`InstrumentInfo.positions?`:** `{ id, units, openRate, openedAt, pnl, invested, isBuy, leverage }[]`, doar la eToro.
  - Vine din `EtoroTrader.portfolio`: `unrealizedPnL.pnL` (altfel `netProfit`), `amount` (investit, USD), `openDateTime`.
  - Celelalte platforme lasă câmpul nedefinit.
- **`OrderTicket`:**
  - cu `seed.close` și mai multe poziții, lista vine din `ins.positions`, filtrată la `seed.close.positionIds` și ordonată după `openedAt`;
  - `picked` (Set) e inițial cu toate;
  - `ticketBody().close.positionIds` = cele alese, în ordinea listei, deci `closePlan` le împarte în aceeași ordine;
  - butoanele „Toate” / „Doar profitabile” / „Niciuna” și sumarul de sub listă;
  - butonul de verificare e dezactivat fără alegere;
  - fără `ins.positions`: formularul de până acum.
- **Funcții pure în `web/components/close-picker.ts`:**
  - `closeRows(positions, ids)`: filtrare + ordine;
  - `pickedSummary(rows, picked)`: număr, unități, profit;
  - `profitable(rows)`: id-urile cu profit peste 0.
- **Teste:**
  - `close-picker` (ordinea, sumarul, profitabilele, profitul necunoscut);
  - `EtoroTrader.instrument` cu pozițiile și profitul lor;
  - închiderea a 2 din 3 poziții trimite doar cererile lor.

## TD-ETOROROWS — implementează FD-ETOROROWS
- **`OrderTicket`, cu `seed.close` și `ins.positions`:** `rows = closeRows(ins.positions, seed.close.positionIds)`, pentru una sau mai multe poziții.
  - **Tabelul** (`table`, `min-w-[720px]`, în `overflow-x-auto`): un rând pe poziție, câmpul „De vândut” (`rowUnits[id]`) și „Vinde”.
  - **„Vinde” pe un rând:** `check.mutate(body)`, cu `body = ticketBody()` + `close: { positionIds: [id], units? }` + `amount`.
    - Cheia vine din `keyFor(body)`, un `Map` semnătură → uuid. Același rând cu aceleași unități primește aceeași cheie.
    - `check` primește corpul ca variabilă.
  - **Rezultatul:** „Înapoi la poziții” resetează `preview` / `result` / mutațiile, revine la `form`, reîncarcă `info` și invalidează portofoliul.
  - **Fără „Verifică ordinul”** în acest mod; „Renunță” rămâne.
- **Lățimea:** `Modal width` 900 cu tabelul, 600 în rest.
- **Text în loc de câmpuri:**
  - `ReadOnly({ label, children })` pentru cont (la închidere sau cu un singur cont eligibil), simbol, piață și direcție (la închidere), pe un rând (3 coloane la futures, 2 la acțiuni);
  - „Reduce-only” la închidere e text („Reduce-only: da”), nu o bifă blocată.
- **Confirmarea:** pozițiile din `preview.ticket.close.positionIds`, cu data, unitățile și prețul; profitul la vânzarea întreagă.
- **`close-picker.ts`:**
  - rămân `closeRows` și `pnlPct`;
  - `pickedSummary` / `profitable` se scot (și testele lor);
  - nou: `rowUnitsProblem(text, units)` → `null` (gol sau valid) sau motivul.
- **Teste:**
  - `rowUnitsProblem`;
  - `closeRows` / `pnlPct` rămân;
  - serverul nu se schimbă (închiderea unei poziții e acoperită).

## TD-INDEXNEWS — implementează FD-INDEXNEWS

### 1. Indicii și setarea (`shared/stock-indices.ts`, `shared/settings.ts`)
- **`FILTER_INDICES`:**
  - `SPX` (^SPX, S&P 500, SPY / VOO);
  - `NDX` (^NDX, Nasdaq-100, QQQ);
  - `DJI` (^DJI, Dow Jones, DIA).
- **`stockNewsSchema`:** `{ mode: 'all' | 'indices', indices: FilterIndexId[] }`, implicit `{ mode: 'all', indices: [] }`. Cu `mode: 'indices'`, cel puțin un indice; fiecare o singură dată.
- **Cheia personală:** `stockNews`, cu `USER_KEYS` += `stockNews`. O valoare invalidă salvată revine la implicit (salvage-ul pe cheie).

### 2. Listele (`server/news/index-members.ts`, `index-members.snapshot.json`)
- **`IndexMembers`:**
  - `{ asOf, members: { SPX|NDX|DJI: { symbol, name, aliases }[] }, listed: string[] }`;
  - `listed`: toate simbolurile din screener-ul Nasdaq, normalizate (`BRK/B` → `BRK.B`, fără `^`, warrants sau units).
- **Parsere** (pure, testate pe fixture-uri):
  - `parseNasdaq100(json)`;
  - `parseWikiConstituents(wikitext)`: tabelul cu `id="constituents"`; simbolul din `{{NYSE link|X}}` / `{{NASDAQ link|X}}` / text, numele din `[[Link|Nume]]`; S&P 500 și Dow;
  - `parseScreener(json)`.
- **Validare:**
  - NDX 95–110, SPX 490–515, DJI = 30, listed > 5.000, simboluri `/^[A-Z][A-Z0-9]{0,6}(\.[A-Z])?$/`;
  - o listă care nu trece păstrează versiunea anterioară a ei.
- **Aliasurile (`memberAliases`):**
  - `cleanCompanyName` (din `market/stocks.ts`);
  - un tabel de nume curate pentru companiile mari (Alphabet → Alphabet, Google; Meta Platforms → Meta Platforms, Meta; JPMorgan Chase → JPMorgan, JPMorgan Chase; Exxon Mobil → Exxon, ExxonMobil; Walt Disney → Disney; Procter & Gamble → Procter & Gamble, P&G; Johnson & Johnson → Johnson & Johnson, J&J; Berkshire Hathaway → Berkshire Hathaway, Berkshire; UnitedHealth Group → UnitedHealth; Advanced Micro Devices → AMD, Advanced Micro Devices; IBM; Coca-Cola; McDonald's; Home Depot; Goldman Sachs; Dow Inc. → Dow Inc. etc.);
  - un nume dintr-un singur cuvânt care e cuvânt din dicționar (`/usr/share/dict/words`, la generarea instantaneului) nu e alias, cu excepția unei liste de mărci sigure (Apple, Amazon, Oracle, Alphabet, Meta, Google);
  - la reîmprospătare, un membru nou primește doar numele de cel puțin două cuvinte (fără dicționar pe server); cei cunoscuți își păstrează aliasurile din instantaneu.
- **`scripts/index-members.ts`** regenerează instantaneul (rețea + dicționar), pentru actualizările aplicației.

### 3. Serviciul și job-ul
- **`IndexMembersService`:**
  - `get()`: datele din `job_data['index.members']`, altfel instantaneul; ținute în memorie;
  - `refresh(now)`: citește sursele (`fetchText`, 15 s fiecare), validează, salvează și întoarce dacă s-a schimbat ceva (semnătura listelor).
- **Job-ul `index.members`:** zilnic, cu citire efectivă doar dacă datele au peste 7 zile.
- **După o schimbare** (inclusiv prima pornire cu marcaje: semnătura din datele job-ului `news.retag-members` ≠ semnătura listelor):
  - `CoinRegistry.invalidate()`;
  - job-ul `news.retag-members` re-etichetează știrile păstrate, pe zile (o zi pe tranzacție, de la cea mai recentă), doar `news_coins` (`retagCoins`: relevanța și importanța rămân), cu un cursor salvat după fiecare zi (o rulare întreruptă continuă; limită 30 min), apoi salvează semnătura și pornește recalcularea scorurilor per utilizator.

### 4. Detectorul (`news/coins.ts`, `news/coin-registry.ts`)
- **`CoinDetector`** primește `members?: { byTicker: Map<ticker, { aliases, indices }>, listed: Set<string> }` (doar detectorul de etichetare, nu și clasificatorul scorului comun).
  - Numele membrilor se potrivesc ca numele acțiunilor din favorite (majusculă, MAJUSCULE sau Title Case).
  - `$X` și `EXCHANGE: X` acceptă membrii și `listed`.
  - Tickerul singur: membrii cu cel puțin 3 caractere, nu din `SYMBOL_BLACKLIST` sau `MEMBER_TICKER_BLACKLIST` (USB, PSA, REG, DOC, GEN, AMP, CAT, MAR, MET, TAP, POOL, BALL, COST, FAST, TECH, DAY, LUV, HAL, HON, HUM, KIM, LEN, LIN, MAS, MOS, TEL, TER, WAT, ROL, ROP, PEG, ARE, ALL, NOW, KEY, LOW, HAS, ICE, WELL, ON, IT).
  - **Marcaje:** o companie găsită (membru, `listed` sau acțiune din favorite) adaugă `#CO`; un membru adaugă `#SPX` / `#NDX` / `#DJI` după apartenență.
  - Aliasurile celor trei indici (+ „QQQ” la NDX) se adaugă mereu.
- **Cititorii lui `news_coins`** ignoră etichetele `#…`:
  - lista știrilor (`query.ts`), contextul Rezumatului, iconițele știrilor din scor (`daily.ts`), gruparea la import (`ingest.ts`);
  - filtrul de favorite nu le poate atinge (favoritele nu încep cu `#`).

### 5. Filtrul (`news/stock-scope.ts`)
- **`stockScopeFor(db, settings, userId)`** → `null` (toate) sau `{ indices, allowed }`, cu `allowed = ['#SPX', '^SPX', …] ∪ acțiunile din favorite`.
- **`stockScopeSql(scope)`** → `(n.category <> 'stocks' OR NOT EXISTS (… coin = N'#CO') OR EXISTS (… coin IN (allowed)))`, plus parametrul JSON.
- **Unde se aplică:**
  - `queryNews` (pagina Știri și listele de pe Azi), care întoarce și `stockScope: { indices }` pentru nota din pagină;
  - contextul Rezumatului;
  - `DailySentimentService.loadItems` pentru un scor per utilizator.

### 6. Scorul per utilizator (`sentiment/daily.ts`)
- **`scopeFor(userId)`:** AI propriu **sau** filtru → `userId`; altfel `null`.
- **`loadItems` cu `scope = userId`:** scorurile AI ale lui, dacă există (`LEFT JOIN news_ai_scores`, ca acum), plus filtrul, dacă îl are.
- **`refresh()`:** utilizatorii cu AI propriu ∪ cei cu `stockNews.mode = 'indices'` (`JSON_VALUE` pe `user_settings`).
- **`resetUser(userId, since)`:** șterge rândurile lui din `ai_daily_sentiment` de la ziua lui `since` (începutul păstrării știrilor) încolo.
- **Ruta de setări:** după o schimbare a lui `stockNews`, `resetUser`, apoi `refreshZone` pentru el, în fundal.
- Tabelul păstrează numele `ai_daily_sentiment` (scorul per utilizator; nicio schimbare de schemă).

### 7. Web
- **Setări → Ale mele:** secțiunea „Știrile despre acțiuni” (radio + bife, numărul companiilor, data listelor din `GET /api/stock-indices`), salvată cu `saveSettingsPatch`.
- **Știri:** nota „Acțiuni: doar companiile din …” când `stockScope` e prezent.

### 8. Teste
- **Parserele** (fixture-uri scurte); validarea; aliasurile (curate, dicționar, membri noi).
- **Detectorul:** nume, `$X`, `NYSE: X`, ticker simplu ≥ 3, lista neagră, marcajele, „Dow” vs „Dow Inc.”, „Target” singur nu.
- **Filtrul (SQL, pe schema de test):**
  - știre generală → rămâne;
  - companie din indice → rămâne;
  - companie din afară → iese;
  - favorită din afară → rămâne;
  - indicele numit → rămâne;
  - alte categorii → rămân;
  - etichetele `#` nu apar în listă.
- **Scorul:** utilizator cu filtru, scor diferit de cel comun la o zi cu știri de ambele feluri; `resetUser` + recalculare.
- **Setarea:** schema; serverul (per utilizator, implicit `all`).

## TD-BROKERSTATS — implementează FD-BROKERSTATS

### 1. Adaptorii (`exchange/brokers.ts`)
- **`BrokerAdapter.closedTrades?(from)`** → `ClosedTrades`. Opțional: un adaptor fără ea dă `supported: false`. „Reîmprospătează” ocolește cache-ul serviciului (§2); rapoartele IBKR rămân 15 minute.
  - `ClosedTrades = { currency: string | null; trades: ClosedTrade[]; coveredFrom: number; asOf: number | null }`:
    - `coveredFrom`: de când e complet istoricul citit (0 = tot; `+∞` = nimic sigur);
    - `asOf`: până când are date (IBKR: închiderea zilei din raport).
  - `ClosedTrade = { id, closedAt, pnl: number | null, net: number | null }`:
    - `pnl === null`: rezultat necunoscut (nu se numără);
    - `net`: în moneda contului; `null` fără curs (se numără, nu intră în sumă).
- **eToro:**
  - `GET /api/v1/trading/info/trade/history` (Real) sau `/api/v1/trading/info/trade/demo/history` (Demo);
  - parametri: `minDate` = data UTC a lui `from − 1 zi`, `page` de la 1 (convenția eToro, ex. clasamentele: minim 1), `pageSize=100`, `x-request-id` nou;
  - răspunsul: un tablou (sau `trades` / `items` dintr-un obiect, defensiv);
  - oprire: pagină goală, o pagină fără `positionId` noi, sau 20 de pagini;
  - `coveredFrom`: fără limită atinsă → `from`; cu limită → cel mai vechi `closeTimestamp` dacă rândurile vin descrescător, altfel `+∞`;
  - tranzacția: `id = positionId`, `closedAt = closeTimestamp` (fără fus orar = UTC), `pnl = net = netProfit`, moneda `USD`.
- **Trading 212:**
  - `GET /equity/history/orders?limit=50`, apoi `nextPagePath`, cel mult 10 pagini;
  - un rând cu `(fill.filledAt ?? order.createdAt) < from` oprește după pagina curentă;
  - se numără `fill.type === 'TRADE'` cu `order.side === 'SELL'` (sau cantitate negativă), grupate după `order.id`:
    - `pnl` = suma `walletImpact.realisedProfitLoss`;
    - `closedAt` = ultima execuție;
    - fără `realisedProfitLoss` → `pnl: null`;
  - `currency` = `walletImpact.currency` (moneda contului); fără niciun rând → `null` (serviciul ia moneda portofoliului);
  - `coveredFrom`: istoric terminat → 0; oprit la `from` → `from`; limita de pagini → cel mai vechi moment văzut;
  - erorile și 429 → `get()` existent (așteaptă o dată resetul ≤ 6 s).
- **IBKR:**
  - `statement(force, range?)` acceptă `{ fd, td }` (`yyyymmdd`) → `SendRequest?t&q&v=3&fd&td`. Cache-ul (15 min) e pe `token|query|fd|td`;
  - **coadă per token** (`flexChains`): un raport la un moment dat, cel puțin 1,1 s între fluxuri (IBKR: 1 cerere / s, 10 / min);
  - `fd` = data ET a lui `from`; `td` = ultima zi lucrătoare (luni–vineri) dinaintea zilei de azi, în ET;
  - `td < fd` (nicio zi încheiată de la `from`) → fără cerere: nicio tranzacție, `asOf` = închiderea lui `td`;
  - cache-ul rapoartelor: la fiecare raport nou se șterg cele expirate (cheile pe perioadă se schimbă zilnic);
  - erorile 1003–1008 → `MAINTENANCE`, „raportul Flex nu e gata încă”;
  - parsare:
    - fără `<Trades` → `EXCHANGE`: „bifează secțiunea Trades”;
    - rândurile `Trade` cu `levelOfDetail` `EXECUTION` (sau fără); dacă nu sunt, cele `ORDER`; dacă există `Trade`, dar niciunul nu are `fifoPnlRealized` → `EXCHANGE`: „bifează toate câmpurile (Select All)”;
    - `assetCategory === 'CASH'` se ignoră;
    - închidere: `openCloseIndicator` conține `C` (dacă rândul are câmpul), altfel `fifoPnlRealized ≠ 0`;
    - grupare după `ibOrderID` (sau `orderID`, `tradeID`, `transactionID`): `pnl` = suma lui `fifoPnlRealized`; `net` = suma lui `fifoPnlRealized × fxRateToBase` (rândul în moneda de bază → × 1; fără curs → `null`); `closedAt` = ultima execuție;
  - `asOf` = `toDate` + 16:00 ET (ca la portofoliu); `coveredFrom` = `from`; `currency` = moneda din `AccountInformation`.
- **Alpaca:**
  - `GET /v2/account` (`currency`, `shorting_enabled`), apoi `GET /v2/account/activities/FILL?direction=desc&page_size=100[&page_token=<id>]`, cel mult 40 de pagini;
  - `side`: `buy`, `sell` sau `sell_short`; o vânzare `sell_short` deschide short cu ce vinde peste acțiunile deținute, oricât de complet ar fi istoricul;
  - `complete` = ultima pagină are sub 100 de rânduri;
  - **`fifoResults(execs, { complete, shorting })`** (pură, exportată):
    - execuțiile crescător, pe simbol (fără `/`), cu loturi FIFO cu semn;
    - un `buy` acoperă întâi loturile short, apoi deschide long;
    - un `sell` închide întâi loturile long; restul deschide short doar cu `complete && shorting`, altfel e „fără cost” (ordinul devine `pnl: null`);
    - opțiunile (simbol OCC `^[A-Z]{1,6}\d{6}[CP]\d{8}$`) au multiplicatorul 100;
    - rezultatul pe `order_id`, doar ordinele care au închis ceva, cu `closedAt` = ultima execuție care închide;
  - `coveredFrom`: complet → 0, altfel cea mai veche execuție citită; `currency` = cea a contului.

### 2. Serviciul (`exchange/accounts.ts`, `exchange/trade-stats.ts`)
- **`TradeStats`** primește:
  - `currency` (crypto `'USD'`);
  - `asOf: number | null`;
  - `limited: boolean`;
  - `unknownResults: number`.
- **`summarizeResults(results: { pnl, net }[])`**: numărarea comună; `summarizeClosed` (crypto) o folosește.
- **`brokerClosed(id, read, now, force)`**:
  - `closedTrades(now − 90 zile)` al adaptorului, cu `now` = ceasul statisticilor cerute (așa istoricul acoperă exact cele 90 de zile, fără să pară „limitat” cu câteva milisecunde);
  - cache 5 min per cont și cereri simultane unite;
  - `force` îl ocolește.
- `invalidate(id)` (după un ordin) și `delete(id)` uită și istoricul brokerului și statisticile contului (`forgetStats`).
- **`loadStats` pentru broker:**
  - fără `closedTrades` → `supported: false`;
  - altfel tranzacțiile cu `closedAt ∈ [from, to]`;
  - `asOf !== null && asOf < from` → numerele `null`, cu `asOf` (UI-ul explică);
  - `limited = from < coveredFrom`;
  - `unknownResults` = câte au `pnl === null`;
  - `currency` = cea a adaptorului, altfel a portofoliului (`portfolio(id)`, de regulă din cache);
  - erorile → `error`, ca la crypto.
- **`tradeStats(…, force)`** transmite `force` la `brokerTrades`.

### 3. Interfața (`Trades.tsx`)
- Selectorul de perioadă: la toate conturile. `useRefreshAccount` și `statsQ` cer statisticile la toate conturile.
- **`BrokerCards`** (în locul panourilor de acum ale brokerilor):
  - aceeași grilă de `Stat` ca la crypto: `xl:grid-cols-5|6|7`, după câte carduri sunt;
  - dedesubt, eroarea și rândul „actualizat …”;
  - `Câștig net` = `fmtMoney(net, currency)`;
  - nota de sub card, prima care se aplică: „parțial: fără curs valutar” (`netPartial`), „parțial: istoric prea lung” (`limited`), „N fără rezultat” (`unknownResults`);
  - titlurile pe broker (`BROKER_STATS_NOTE`);
  - IBKR cu `asOf < from` → „—” și explicația din FD §3.
- `CryptoCards` neschimbat, în afară de câmpurile noi (ignorate).

### 4. Pașii IBKR (`shared/providers.ts`)
- Pasul 2 adaugă: „La Trades: nivelul „Execution” și toate câmpurile („Select All”).”
- Interfața: data raportului apare ca „până la închiderea bursei de vineri, 16 octombrie”, ziua din New York (nu ora locală a închiderii).

### 4b. Reparat pe drum
- **Trading 212, comisionul execuțiilor** (`t212Taxes`): în API-ul documentat, `walletImpact.taxes` e o listă (`{ name, quantity, currency, chargedAt }`), nu un număr. Comisionul unei execuții e acum suma valorilor absolute din listă, în moneda portofelului; un număr (răspunsurile vechi) merge ca înainte.
- **IBKR, codurile 1001 și 1003–1008** („raportul nu e gata”) → `MAINTENANCE`, cu reîncercare la următoarea citire (înainte: o eroare generică).

### 5. Teste
- **eToro:** calea Real / Demo, `minDate`, paginarea și oprirea, deduplicarea, timpul fără fus orar, limita de pagini → `coveredFrom`.
- **Trading 212:** doar vânzările `TRADE`, grupate pe ordin; oprirea la `from`; limita de pagini; `realisedProfitLoss` lipsă → `null`.
- **IBKR:**
  - `fd` / `td` în `SendRequest`; gruparea pe `ibOrderID`; „C;O”; `CASH` ignorat; `fxRateToBase`; `ORDER` când nu sunt execuții;
  - erorile: fără Trades, fără `fifoPnlRealized`, 1006;
  - coada: două rapoarte cerute deodată pleacă unul după altul.
- **Alpaca:**
  - `fifoResults`: loturi multiple, execuții parțiale, short permis / nepermis, istoric incomplet, opțiuni ×100;
  - adaptorul: `page_token`, limita de pagini.
- **Serviciul / API:**
  - un cont Trading 212 simulat: numerele, moneda, perioadele din același istoric (o singură citire), `force`;
  - IBKR „Azi” → `null` cu `asOf`;
  - un adaptor fără `closedTrades` → `supported: false`.

## TD-CHARTSTEADY — implementează FD-CHARTSTEADY

### 1. Antetul (`pages/Charts.tsx`, `ChartView`)
- Partea din stânga: `min-w-0 flex-[1_1_34rem]` (o bază fixă de 544 px, care crește și se poate strânge). Așezarea pe rânduri depinde doar de această bază și de lățimea rândului din dreapta, nu de conținut.
- Prețul: mereu redat. Fără `candles.data` → „—” cu `text-faint` și `aria-busy`.
- Variația crypto (`chartSec ≤ 1 zi`): insigna e mereu redată. `change24h === null` → stilul neutru (`bg-panel-2 text-faint`) cu „— 24h”; `title`: „Se încarcă…” sau „Nu sunt lumânări de acum 24 de ore”.
- Variația la acțiuni și indici: insigna e mereu redată. Fără `stockQuote?.changePct` → neutră cu „—”; după încărcare, ca până acum.
- **Lățimea ținută** (pe telefon, partea din stânga se rupe pe rânduri după lățimea valorilor):
  - `useLatched(text)`: ultima valoare nenulă;
  - `Holding`: cât se încarcă, textul simbolului de dinainte, invizibil, cu „—” gri peste el;
  - așa se țin prețul, variația (un singur loc, comun pentru monede și acțiuni) și sursa („KuCoin”, „Nasdaq · pre-market”);
  - după încărcare, o valoare care lipsește (eroare, fără lumânarea de acum 24 h) e un „—” simplu;
  - textul sursei nu e niciodată gol (un spațiu neîntrerupt): un rând gol ar muta linia de bază.

### 2. Legenda (`components/StudyLegend.tsx`, `pages/Charts.tsx`)
- `StudyLegendRow`: `LegendButtons` imediat după nume și parametri, apoi `body` (valorile sau mesajul).
- Legenda LMA (`lmaLegend`): butoanele după parametri, apoi valoarea și starea.

### 3. Verificare
- În Chrome, în ecran complet, la 1440 și 1920 px: poziția rândului cu intervalele înainte de schimbarea simbolului, în timpul încărcării și după.
- Poziția butonului X din legendă la două poziții ale cursorului, cu valori de lungimi diferite.

## TD-GOLATESTMAIN — implementează FD-GOLATESTMAIN
- **`CandleChart`:** butonul se așază în `boxes.panes.main`, nu în cel mai de jos panou:
  - `top = max(main.top + 4, main.top + main.height − 32 − 10)`;
  - `left = plotWidth − 32 − 10`;
  - fără `main` (înainte de prima măsurare), butonul nu apare.
- **Overlay-ul panoului prețului** (caseta TP / SL) urcă (`translateY(−42px)`) oricând butonul se vede.
- **Verificare în Chrome:**
  - cu RSI și LMA dedesubt: butonul în panoul prețului, deasupra separatorului;
  - fără panouri: deasupra axei timpului;
  - caseta TP / SL ridicată;
  - click → ultima lumânare.

## TD-SCROLLLOCK — implementează FD-SCROLLLOCK

### 1. `web/scroll-lock.ts`
- **`lockScroll(): () => void`**, cu un contor global:
  - **prima blocare:** salvează `overflow` și `padding-right` din stilul lui `<html>`, pune `overflow: hidden`, iar dacă bara de derulare are lățime (`innerWidth − clientWidth > 0`) pune `padding-right` cu acea lățime;
  - **ultima eliberare:** pune la loc ce era;
  - **funcția întoarsă:** eliberează o singură dată (a doua apelare nu face nimic).
- **`useScrollLock(active = true)`:** blochează cât `active` e adevărat și componenta e montată.

### 2. Unde
- **`useScrollLock()`:** `Modal`, `AccountWizard`, `CommandPalette`, `DaySummary` (în locul lui `body.style.overflow`), `SummaryFailed` (`App.tsx`), `SettingsDrawer` (`Charts.tsx`).
- **`useFullscreen`:** în modul `css`, `lockScroll()` în locul lui `html.style.overflow`.
- **`overscroll-contain`** (`overscroll-behavior: contain`) pe zonele care derulează:
  - corpul `Modal`, al asistentului, al Rezumatului;
  - lista ⌘K;
  - formularele din panoul lateral (`IndicatorForm`, `StudySettings`);
  - cadrul ecranului complet;
  - listele de căutare din Grafice și Setări.

### 3. Teste și verificare
- **`scroll-lock.test.ts`**, cu un `document` / `window` falși:
  - contorul (două blocări, eliberări în orice ordine);
  - lățimea barei;
  - restaurarea valorilor de dinainte;
  - eliberarea dublă.
- **În Chrome** (o pagină mai înaltă decât fereastra, `scrollY` măsurat):
  - rotița peste panoul lateral la capăt și peste fundal;
  - rotița peste fundalul unei ferestre;
  - panoul și ⌘K deodată;
  - pagina pe loc la închidere.

## TD-PICKERSORT — implementează FD-PICKERSORT
- **`web/indicators/order.ts`:** `compareIndicatorNames(a, b)`, cu `Intl.Collator('ro', { sensitivity: 'base', numeric: true, ignorePunctuation: true })`.
- **`IndicatorPicker`:** rândurile fiecărei liste (căutare, Toți, Favorite, Premium, categorii) se sortează la final cu `compareIndicatorNames` după numele afișat. Lista de favorite din setări rămâne cum e.
- **Teste:** `order.test.ts`:
  - majuscule și diacritice;
  - „[DI] …” la D;
  - „24-hour Volume” primul;
  - 2 < 10;
  - catalogul întreg + Premium sortat (niciun element pierdut).

## TD-HLINE — implementează FD-HLINE

### 1. Datele (`shared/hlines.ts`, `shared/settings.ts`, `server/settings.ts`)
- **`hlineStyleSchema`**, stilul fără preț și text:
  - `color`, `textColor`: `#RRGGBB` sau `#RRGGBBAA`;
  - `width`: 1–4; `style`: `solid | dashed | dotted`; `priceLabel`;
  - `textSize`: una din 10, 11, 12, 14, 16, 20, 24, 28, 32, 40; `bold`, `italic`;
  - `vAlign`: `top | middle | bottom`; `hAlign`: `left | center | right`;
  - `visibility`: `{ minutes, hours, days, weeks }`, fiecare `{ on, from, to }`. Limitele: minute 1–59, ore 1–24, zile 1–366, săptămâni 1–52; `from ≤ to`.
- **`hlineSchema`** = stilul + `id` (`[a-z0-9]{6,24}`), `price` (număr finit), `text` (≤ 500 de caractere).
- **`chartLinesSchema`:**
  - `record(CHART_SYMBOL_RE, array(hline).max(50))`, cel mult 100 de simboluri;
  - listele goale dispar la parsare, deci un simbol fără linii nu rămâne salvat.
- **`HLINE_DEFAULT_STYLE`** (albastru `#2962FF`, 1 px, continuă, eticheta prețului, text 14 px, Mijloc / Dreapta, tot vizibil), **`HLINE_MAX = 50`**.
- **`hlineVisibleOn(style, tf)`:**
  - unitatea intervalului (`1m…30m` → minutes, `1h…12h` → hours, `1d` → days, `1w` → weeks);
  - `on` și `from ≤ n ≤ to`.
- **`salvageChartLines(stored)`:** liniile valide, una câte una, pe simbolurile valide (cel mult 100 de simboluri, 50 de linii).
- **Setări:**
  - cheile personale noi `chartLines` (prefault `{}`) și `hlineTemplate` (`hlineStyleSchema` sau `null`);
  - `USER_KEYS` += ambele; salvage pe cheie (o cheie invalidă revine la implicit);
  - un patch `{ chartLines: { 'BTC/USDT': [...] } }` înlocuiește lista simbolului (`deepMerge` unește obiectele și înlocuiește listele).

### 2. Desenul (`web/chart/primitives.ts`)
- **`HLines`** (`ISeriesPrimitive` pe seria lumânărilor): `setData(lines, { selected, precision, background })`.
- **`paneViews`:**
  - linia pe toată lățimea, `setLineDash` după tip; cea selectată cu +1 px;
  - textul, cu `font` din mărime / bold / italic, rândurile din `\n`:
    - x după `hAlign`, cu 6 px de margine;
    - y: deasupra (`top`), centrat cu un gol în linie (`middle`) sau dedesubt (`bottom`).
- **`priceAxisViews`:** câte o etichetă pe linie cu `priceLabel`: textul `toFixed(precision)`, fundalul = culoarea liniei, textul alb sau negru după luminozitate.
- **`hitTest(x, y)`:** linia cea mai apropiată, la cel mult 5 px → `{ externalId: 'hline:<id>', cursorStyle: 'ns-resize', zOrder: 'top', distance, hitTestPriority: 1 }`.

### 3. Graficul (`web/chart/CandleChart.tsx`)
- **Liniile cursorului:** `vertLine` / `horzLine` `visible: true`, `style: LargeDashed`, `width: 1`, culoarea `themeColors().muted` (și la schimbarea temei).
- **Props noi:**
  - `hlines`: liniile vizibile acum, cu previzualizarea panoului deja aplicată;
  - `selectedHLine`;
  - `onAddHLine(price)`, `onMoveHLine(id, price)`, `onOpenHLine(id)`;
  - `hlineLimit`: cele 50 sunt atinse.
- **Butonul „+” (`HLinePlus`):**
  - stare proprie, din `subscribeCrosshairMove`: y și prețul, doar în `boxes.panes.main`;
  - poziția: `left = plotWidth − 26`, centrat pe y;
  - cât mouse-ul e pe buton sau meniul e deschis, poziția rămâne;
  - meniul: „Linie orizontală la <preț>”, cu „Alt+H”.
- **Alt+H:** `keydown` pe `window`, `e.altKey && e.code === 'KeyH'`, cu ultima poziție a cursorului în panoul prețului → `onAddHLine`.
- **Tragerea** (`pointerdown` în faza de captură pe gazda graficului, doar butonul principal / un deget):
  - **pornire:** dacă y e la cel mult 5 px de o linie, în panoul prețului → `preventDefault()` (fără `mousedown`, deci fără derularea graficului) și `stopPropagation()`;
  - **`pointermove`:** prețul = `coordinateToPrice(y)`, limitat la panou și rotunjit la `precision`; se desenează pe loc;
  - **`pointerup`:** după ≥ 3 px de mișcare → `onMoveHLine`, altfel `onOpenHLine`;
  - **la atingere** (`pointerType === 'touch'`): doar `onOpenHLine`, fără tragere.

### 4. Pagina (`web/pages/Charts.tsx`, `web/components/HLineSettings.tsx`)
- **Liniile simbolului:** `settings.chartLines[savedSymbol]`, filtrate cu `hlineVisibleOn(…, activeTf)`, plus previzualizarea panoului deschis (`draft` în locul liniei cu același `id`).
- **Salvarea:**
  - `remember({ chartLines: { [savedSymbol]: next } })` (`saveSettingsPatch`, optimist, cu revenire la eroare);
  - adăugarea: id nou, stilul din `hlineTemplate ?? HLINE_DEFAULT_STYLE`.
- **Panoul:** `SettingsDrawer`, cu ținta `hline:<id>`, randează `HLineSettings`:
  - formularul complet (§4 din FD) și cele trei butoane Șablon (`hlineTemplate`);
  - butoanele Salvează / Anulează / Șterge linia;
  - `onDraft` pentru previzualizare;
  - ținta dispare dacă linia nu mai e în lista simbolului (alt simbol, ștearsă în altă parte);
  - toate salvările liniilor sunt optimiste (adăugarea, tragerea, panoul, ștergerea), așa că o schimbare făcută cât alta e pe drum pornește de la ea. Panoul verifică aceeași schemă ca serverul, iar un refuz aduce înapoi liniile serverului;
  - un click pe linia cu panoul deschis nu schimbă nimic;
  - linia trasă cu panoul ei deschis: formularul ia prețul nou (`line.price`).

### 5. Teste
- **`shared/hlines.test.ts`:** schema (limitele, `from ≤ to`, culorile), listele goale eliminate, `salvageChartLines`, `hlineVisibleOn` pe toate intervalele.
- **Serverul:** `chartLines` și `hlineTemplate` sunt ale fiecărui utilizator, înlocuite pe simbol, iar o linie invalidă e eliminată la citire.
- **În Chrome:**
  - liniile cursorului;
  - „+” și meniul, apoi Alt+H;
  - linia desenată, cu eticheta;
  - tragerea, cu prețul salvat;
  - click → panoul; previzualizarea, Anulează, Salvează, Șterge;
  - vizibilitatea pe alt interval;
  - textul în cele 3 × 3 alinieri.

## TD-DENAMES — implementează FD-DENAMES
- **`shared/indicator/params.ts`:** `SLINGSHOT_TITLE` (`[DE] Slingshot System ${SLINGSHOT_VERSION}`) și `SLINGSHOT_SHORT_TITLE` (`[DE] Slingshot ${SLINGSHOT_VERSION}`).
- **`shared/indicator/lma-params.ts`:** `LMA_TITLE` = „[DE] Logarithmic Moving Average”, `LMA_SHORT_TITLE` = „[DE] LMA”.
- **`Charts.tsx`:**
  - `PREMIUM.slingshot.name` și titlul panoului: `SLINGSHOT_TITLE`;
  - legenda Slingshot: `SLINGSHOT_SHORT_TITLE`;
  - numele butoanelor din legenda Slingshot și LMA (etichetele lor): numele scurte.
- **`order.test.ts`:** ordinea cu numele noi.

## TD-CHARTTV — implementează FD-CHARTTV

### 1. iPad (`web/chart/fullscreen.ts`, `Charts.tsx`)
- `isIPad()`: `/iPad/` în user agent, sau `Macintosh` cu `navigator.maxTouchPoints > 1` (iPadOS se prezintă ca Mac).
- În `ChartView`, cu `fs.mode === 'native' && isIPad()`, partea din stânga a antetului primește `pl-20` (80 px; `pl-14` până la TD-IPADFS).
- **Retras de TD-IPADFS2:** `isIPad()` devine `isAppleTouch()`, iar `pl-20` și `iPad` din `ChartView` dispar.

### 2. Bara (`Charts.tsx`)
- Rândul din dreapta: `flex flex-wrap items-stretch gap-2.5`, cu două copii:
  - intervalele;
  - grupul butoanelor, `flex flex-nowrap items-stretch gap-2.5`.
- Așa, fiecare element ia înălțimea rândului.
- Butonul listei (`PanelRightOpen` / `PanelRightClose`, `aria-pressed`) și ieșirea din ecranul complet (`btn btn-primary`, doar iconița, cu `title` și `aria-label`): `w-[38px] px-0`, `pointer-coarse:w-11`.

### 3. Lista (`web/components/Watchlist.tsx`)
- **Props:** `current` (ținta graficului), `onPick(path)`, `onHide()`. Lățimea și-o măsoară singură.
- **Conținutul:**
  - capul (titlul, numărul, butonul de ascundere), căutarea (logica din `SymbolPicker`, mutată aici) și antetul coloanelor;
  - rândurile în `FavoritesDnd` (`layout="rows"`, `keyMove(…, 'y')`).
- **Date:**
  - monede: `useSparks` (aceeași cheie ca banda de sus), cu prețul = ultima închidere orară, Var = ultima − cea de acum 24 de închideri, Var% = `sparkChange`;
  - acțiuni și indici: `useStockQuotes`, cu `last`, `change`, `changePct`.
- **Coloanele după lățime** (măsurată cu `ResizeObserver`): „Var” sub 280 px, „Ultimul” sub 220 px. Cotația monedei („/USDT”) apare doar de la 340 px. Coloanele cu numere au o lățime minimă (70 / 56 / 54 px), deci un preț lung le lărgește.
- **Locul în pagină (`ChartView`):**
  - rândul `flex flex-col md:flex-row`: panoul graficului (`min-w-0 flex-1`), apoi marginea (`hidden md:flex`, `role="separator"`, `aria-orientation="vertical"`, `aria-valuenow`, `tabIndex 0`), apoi lista;
  - lista: `<aside>` `relative flex flex-col`, fără `overflow-hidden`, ca rezultatele căutării (cel puțin 260 px) să poată ieși peste grafic când lista e îngustă. Pe `md+`, conținutul e un strat `absolute inset-0`, deci nu adaugă înălțime rândului (ia înălțimea graficului). Sub `md`, `max-h-[360px]`, iar conținutul și lista (`min-h-0 flex-1`, în lanț) se strâng la ea. Derulează doar rândurile (`overflow-y-auto overscroll-contain`), capul și căutarea rămân sus.
  - *TD-WATCHDRAWER înlocuiește aranjamentul de sub `md`:* rândul e `flex` (fără `flex-col`). Marginea și `<aside>` (cu `absolute inset-0`) apar doar de la 768 px (`useMediaQuery`); sub 768 px, lista e în `ListDrawer`.
- **Marginea:**
  - tragerea: `pointerdown` pe margine, cu `setPointerCapture`, apoi `pointermove` / `pointerup` / `pointercancel` pe ea; lățimea se salvează la eliberare;
  - lățimea = dreapta rândului − x − 6 (jumătatea marginii), între 200 și min(560, 50 % din rând);
  - tastele ← / → (±16 px); dublu-click → 300.
- **Memoria:** `web/chart/watchlist-prefs.ts` (`parsePrefs`, `clampWidth`, `readPrefs`, `writePrefs`) ține în `localStorage` cheia `sentiq:watchlist` = `{ width, hidden }`, cu `try / catch` și 300 / vizibilă implicit. Pe ecran lat, `md:max-w-[50%]` strânge lista dacă fereastra se îngustează.
- **Ce dispare:** `SymbolPicker` (pastilele) dispare din pagină.

### 4. Graficul (`web/chart/CandleChart.tsx`, `primitives.ts`)
- **`frameOptions`:**
  - etichetele cursorului: `labelBackgroundColor: '#3C414C'`;
  - linia cursorului: `LargeDashed`, ca până acum.
- **Seria lumânărilor:**
  - `lastValueVisible: false`;
  - `priceLineVisible: true`, `priceLineColor: '#F0CF2B'`, `priceLineStyle: Dotted`.
- **`CurrentPriceLabel`** (primitivă, `priceAxisPaneViews`, `zOrder` `normal`: pe stratul principal al scalei, sub eticheta cursorului, ca eticheta proprie a bibliotecii):
  - desenează pe scala prețului eticheta prețului curent: fundal `#FFF3A3`, text `#14161B`, prețul `toFixed(precision)`;
  - sub preț, numărătoarea până la `lastBarTime + tfMs`, cu `fmtBarCountdown`: `mm:ss` sub o oră, `hh:mm:ss` sub o zi, `Nz hh:mm` peste;
  - fără numărătoare când `countdown === false` (acțiuni și indici: bursa închisă, sau 1w);
  - la acțiuni, sfârșitul e `min(lastBarTime + tfMs, market.closesAt)` (`closeCap`);
  - se redesenează la o secundă, cu `requestUpdate`.
- **Props noi:** `tfMs`, `countdown`, `closeCap`, `logScale`, `onLogScale(on)`. Ultima lumânare e `candles.at(-1)`.
- **Cursorul:** gazda graficului are `cursor: crosshair`. Biblioteca nu pune cursor pe panouri, decât un `ns-resize` pe linii, prin `hitTest`.
- **Tragerea liberă** (în același `pointerdown` în captură ca liniile, când nu e prinsă o linie, în panoul prețului), doar dacă scala era pe automat:
  - **scala normală:** după primii 3 px pe verticală, `k` = prețul pe pixel, din `coordinateToPrice` la ¼ și ¾ din panou; apoi `range0 = getVisibleRange()` și `setAutoScale(false)`; fiecare mișcare face `setVisibleRange(range0 + dy · k)`. O tragere doar orizontală lasă scala pe automat;
  - **scala logaritmică:** `setVisibleRange` din biblioteca graficului (5.2.1) pune prețurile direct în spațiul logaritmic intern al scalei, deci nu se poate folosi. Așa că scala trece pe manual de la apăsare, iar biblioteca mută singură în ambele direcții (`startScrollPrice`). Dacă tragerea n-a avut nici 3 px pe verticală, scala revine pe automat la eliberare;
  - **al doilea deget** (un `pointerdown` cu alt `pointerId` în timpul tragerii, adică pinch): tragerea se încheie ca la eliberare, iar biblioteca face zoom-ul. Altfel, primul deget ar muta prețurile în timpul zoom-ului;
  - **dacă era deja pe manual:** biblioteca mută singură și pe verticală.
- **Butonul A:**
  - starea `auto`, citită din `options().autoScale` la `pointerup`, `dblclick` și `wheel` pe gazdă (biblioteca o schimbă când tragi de scală) și setată la click;
  - click: `setAutoScale(true)`;
  - la schimbarea `viewKey`: `setAutoScale(true)`.
- **Butonul L:** `applyOptions({ mode: logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal })`; click → `onLogScale(!logScale)`.
- **A și L:** în colțul de sub scala prețului (`left = plotWidth`, `top` = capătul ultimului panou, `height` = înălțimea gazdei − acesta). `Boxes` primește `height`.
- **„+”:** pătrățel `bg-[#3C414C] text-white` de 20 px, `left = plotWidth − 21`.
- **»:** `left = plotWidth − LATEST_SIZE − 44`.

### 5. Setări
- `charts.logScale: boolean` (implicit `false`).

### 6. Teste și verificare
- **`fmtBarCountdown`** (test unitar), cu limitele: 59:59, 1:00:00, 23:59:59, 1z.
- **Setarea:** `logScale` în `server.test.ts` (implicit `false`, salvată, o valoare greșită refuzată, setările vechi).
- **Lista și iPad-ul** (teste unitare): `clampWidth` / `parsePrefs`; `isIPad` (iPad, iPadOS „Macintosh” cu atingere, Mac, iPhone, Windows); din TD-IPADFS2, `isAppleTouch` în `apple-touch.test.ts`, unde iPhone-ul e inclus.
- **În Chrome:**
  - lista: coloanele, prețurile, rândul curent, click, tragerea marginii, ascunderea și readucerea, memoria după reîncărcare, telefonul (390 px);
  - tragerea pe verticală stinge A; A reîncadrează; L schimbă scala;
  - cu atingeri emulate: tragerea cu un deget pe verticală stinge A, pinch-ul nu (pe ambele scale);
  - etichetele galbenă și gri, cursorul cruce, „+” lipit de etichetă, » mutat;
  - bara la 1024 / 1180 px în ecran complet, pe un singur rând.

## TD-KUCOINHEDGE — implementează FD-KUCOINHEDGE

### 1. Cercetare (ccxt 4.5.85, KuCoin API)
- **Modul:** `fetchPositionMode` (`GET /api/v2/position/getPositionMode`, `positionMode` 0 / 1) e al contului, pentru toate perechile. Sentiq îl citea deja înainte de fiecare ordin futures (`assertOneWay`, ținut 10 min).
- **Ordinul pe contul clasic** (`kucoinfutures`, `createContractOrderRequest`): cu `params.hedged = true`, ccxt pune `positionSide`:
  - deschidere: `buy` → `LONG`, `sell` → `SHORT`;
  - cu `reduceOnly`: `sell` → `LONG`, `buy` → `SHORT`.
  Aceeași cerere merge și la `/st-orders` (TP / SL atașate) și la ordinele stop.
- **Contul unificat** (`createUtaOrderRequest`): `hedged` e citit doar pentru `accountMode` clasic. Documentația UTA marchează `positionSide` „Not supported”, deci UTA în hedge rămâne refuzat.
- **Pozițiile:** `parsePosition` ia direcția din semnul lui `currentQty` (negativ la short, și în hedge). `info.positionSide` (BOTH / LONG / SHORT) e citit întâi, ca să nu depindem de semn.
- **Ordinele:** lista futures are `positionSide` în `info`.
- **Eroarea de nepotrivire a modului:** `330012` → `InvalidOrder` („Your order is in One-Way Mode, while your account is set to Hedge Mode”).
- **Levierul cross** (`/api/v2/changeCrossUserLeverage`): pe pereche, fără `positionSide`. Neschimbat.

### 2. Server (`exchange/trading/crypto.ts`)
- **`hedgedOf(ex, m)`** (fostul `assertOneWay`, fără refuz): citește modul ca acum (Bitget clasic / unificat, `fetchPositionMode` în rest), ținut 10 min în `positionModes`. Întoarce `true` / `false` / `null` (necitibil).
- **`place`**, pentru futures:
  - `hedged === true`: KuCoin clasic → `params.hedged = true`; KuCoin unificat → `HEDGE_MODE` (mesajul UTA); celelalte → `HEDGE_MODE` (mesajul de acum);
  - Bitget clasic → `oneWayMode: true`, ca acum.
- **Nepotrivirea modului** la `createOrder` pe KuCoin futures (`ExchangeError` cu `330012` / „one-way mode” / „hedge mode” / `positionSide` în mesaj):
  - `positionModes.clear()`: modul e al contului, pentru toate perechile, iar cache-ul e ținut pe pereche;
  - `TradingError('REJECTED', '…s-a schimbat pe KuCoin…')`; pe contul unificat, `HEDGE_MODE` cu mesajul UTA (acolo nu ajută o retrimitere). Răspunsul e un refuz, deci nu e `UNKNOWN_OUTCOME`. Erorile de rețea și `BadResponse` (nu sunt `ExchangeError`) rămân `UNKNOWN_OUTCOME`.
- **`normalize` / `instrument`** (doar KuCoin futures): `hedgedOf` (din cache, de obicei); UTA + hedge → eroare la verificare. La `instrument`, un mod necitibil e doar lăsat deoparte (`positionMode` lipsește); la `normalize`, eroarea oprește verificarea.
  - `availability(…, hedged)`: pozițiile perechii cu `positionSideOf`. În hedge: `position = null` și `hedgePositions = { long, short }`; altfel `position` ca acum. `instrument` și `normalize` adaugă `positionMode` (`hedge` / `one-way`) când modul a fost citit.
  - Avertismentele din FD §3: cel pentru direcția opusă, „nu are ce închide” pe partea cerută, reduce-only mai mare decât poziția (KuCoin, ambele moduri; ținta e poziția închisă: în hedge partea ei, în one-way `position`).
  - `OrderPreview.positionMode` = modul citit.
- **`positionSideOf(p)`** (`exchange/accounts.ts`, exportat): partea numită de exchange în hedge (`hedgeSide`: `positionSide` LONG / SHORT, `posSide` long / short, `positionIdx` 1 / 2, după TD-HEDGEALL), altfel `p.side` (`long` / `short`), altfel `null`.
- **`orderPositionSide(info)`**: aceeași `hedgeSide` pe un ordin, altfel `null` (BOTH, net, 0, lipsă).

### 3. Tipuri (`shared/trading.ts`, `exchange/accounts.ts`)
- `HeldPosition = { side: 'long' | 'short'; amount: number; entryPrice: number | null }`, folosit de `InstrumentInfo.position`.
- `InstrumentInfo.positionMode?: 'one-way' | 'hedge'` și `hedgePositions?: { long: HeldPosition | null; short: HeldPosition | null }`.
- `OrderPreview.positionMode?: 'one-way' | 'hedge'`.
- `OrderRow.positionSide?: 'long' | 'short' | null` (portofoliu: `orderPositionSide(o.info)`). Binance pune același `positionSide` pe ordinele și pozițiile unui cont în hedge, deci acolo (doar citire) se arată la fel.
- `PositionRow.side`: `positionSideOf(p) ?? String(p.side ?? '')`.

### 4. Pagina
- **`OrderTicket.tsx`:**
  - `hedge = futures && ins?.positionMode === 'hedge'`;
  - sub pereche: „Mod hedge · long x · short y” (cele deschise);
  - butoanele de direcție, cu `hedge && reduceOnly` (și la închiderea din Tranzacții): `[['buy', 'Închide short'], ['sell', 'Închide long']]`. La închidere, eticheta e doar ea, fără „(închide poziția)”;
  - confirmarea: cu `p.positionMode === 'hedge'`, Direcție „Închide long” / „Închide short” pentru reduce-only, plus rândul „Mod poziții”.
- **`Trades.tsx`, ordine:** `o.positionSide` lângă direcție (`text-faint`, „long” / „short”).
- **`chart/pnl.ts`:**
  - `roleOf`: un ordin cu `positionSide` diferit de partea tranzacției → `null`;
  - titlurile: cu un long și un short futures pe pereche, eticheta e LONG / SHORT în loc de „futures” (două poziții pe aceeași parte, ex. USDT și USDC, rămân „futures”).

### 5. Teste
- **Simulat** (`crypto.test.ts`):
  - KuCoin clasic în hedge: ordinul pleacă cu `hedged: true`, la deschidere și la reduce-only;
  - verificarea dă `positionMode: 'hedge'`, pozițiile long / short separate și avertismentele;
  - UTA în hedge: eroare la verificare și refuz la trimitere;
  - celelalte exchange-uri în hedge: tot `HEDGE_MODE`;
  - nepotrivirea (`330012`): `REJECTED` cu mesajul, cache-ul uitat (modul se citește din nou); pe contul unificat, `HEDGE_MODE` cu mesajul UTA;
  - eroarea de rețea după trimitere: tot `UNKNOWN_OUTCOME`.
- **ccxt real** (cererile capturate):
  - hedge pe `kucoinfutures`: `positionSide` `LONG` la un buy, `SHORT` la un sell, `LONG` la un sell reduce-only, `SHORT` la un buy reduce-only; modul citit o dată;
  - la TP / SL (`/st-orders`), `positionSide` pe aceeași cerere.
- **Portofoliu:** `positionSideOf` / `orderPositionSide` (unitare, în `server.test.ts`); `PositionRow.side` și `OrderRow.positionSide` le folosesc direct.
- **`pnl.test.ts`:** long + short pe aceeași pereche (titluri LONG / SHORT); ordinul short nu e TP al long-ului.
- **Chrome:** formularul pe un cont KuCoin în hedge, simulat (serverul de test cu un client KuCoin fals): eticheta modului, butoanele „Închide long / short”, avertismentele, confirmarea.

## TD-HEDGEALL — implementează FD-HEDGEALL

### 1. Ce face ccxt 4.5.85 cu `params.hedged = true` (citit în cod)
| Exchange | Deschidere | Reduce-only | Altele |
|---|---|---|---|
| Binance (`createOrderRequest`) | `positionSide` = LONG la buy, SHORT la sell | `reduceOnly` scos; `positionSide` al poziției închise (sell → LONG) | la fel pentru `stopLossPrice` / `takeProfitPrice` (ordinele TP / SL separate) |
| Bybit (`createOrderRequest`) | `positionIdx` 1 la buy, 2 la sell | `reduceOnly` scos; `positionIdx` al poziției închise | TP / SL atașate în aceeași cerere |
| OKX (`createOrderRequest`) | `posSide` long / short | `reduceOnly` scos; `posSide` opus direcției ordinului | TP / SL atașate (`attachAlgoOrds`) în aceeași cerere |
| Bitget clasic (`createOrderRequest`) | `tradeSide: 'Open'` | `side` inversat + `tradeSide: 'Close'` | `oneWayMode`, dacă e trimis, suprascrie `hedged`: în hedge nu se trimite |
| Bitget unificat (`createUtaOrderRequest`) | `posSide` long / short | `posSide` al poziției închise | — |

Levierul în hedge, cu marjă izolată:
- **OKX:** `setLeverage(lev, sym, { marginMode: 'isolated', posSide })`, unde `posSide` e implicit `net`, deci trebuie dat `long` / `short`;
- **Bitget clasic:** `setLeverage(lev, sym, { marginMode, holdSide })`.

Cross, Binance, Bybit, KuCoin: neschimbat.

### 2. Server (`exchange/trading/crypto.ts`)
- **`hedgedOf`, pentru Bybit:** `privateGetV5PositionList({ category: 'linear', symbol: m.id })`. Orice `positionIdx` 1 / 2 → hedge; 0 → one-way; listă goală → `null`. Cache-ul e pe pereche, ca la ceilalți; pe Bybit modul chiar e pe pereche.
- **`instrument` / `normalize`:** modul se citește pentru orice exchange cu futures (nu doar KuCoin). Avertismentele hedge și `positionMode` vin pentru toți. Avertismentul „reduce-only mai mare decât poziția” rămâne doar pe KuCoin (singurul documentat).
- **`place`:**
  - `hedged === true`: KuCoin unificat → `HEDGE_MODE`; altfel `params.hedged = true`;
  - Bitget clasic: `oneWayMode: true` doar când modul nu e hedge;
  - `prepareFutures` primește `hedged`: OKX și Bitget clasic, cu marjă izolată și fără reduce-only, pun partea pe levier (`posSide` / `holdSide` = `long` la buy, `short` la sell);
  - Binance, ordinele TP / SL de după intrare: `hedged: true` când contul e în hedge (ccxt scoate `reduceOnly` și pune `positionSide`).
- **Nepotrivirea modului** (orice exchange cu futures): `ExchangeError` cu un mesaj din lista KuCoin `330012`, Binance `-4061` („position side does not match”), Bybit („position idx not match position mode”), OKX (`posSide`), Bitget `40774` („unilateral position”), sau „hedge mode” / „one-way mode” / „position side”.
  - Efect: `positionModes.clear()` (Bitget: și `this.bitget = null`), apoi `REJECTED` cu mesajul care numește exchange-ul (`providerById(…).name`).
  - KuCoin unificat: `HEDGE_MODE`, ca acum.
- **`tradingErrorOf`:** expresia `HEDGE_MODE` rămâne pentru o eroare despre mod prinsă altundeva (citirea modului, levierul). Mesajul nu mai spune „doar one-way”, ci „Exchange-ul a refuzat din cauza modului pozițiilor (one-way / hedge): <mesajul lui>. Verifică modul pe exchange și încearcă din nou.”

- **Partea pozițiilor și a ordinelor** (`accounts.ts`, `hedgeSide`): pe lângă `positionSide` (KuCoin, Binance), `posSide` long / short (OKX, Bitget; ccxt inversează `side` la un close Bitget în hedge, deci `posSide` e poziția ordinului) și `positionIdx` 1 / 2 (Bybit). Așa, eticheta „long” / „short” din Tranzacții și rolul ordinului pe grafic merg pe toate.

### 3. Brokeri
- **eToro, `instrument`:** cu poziții pe ambele părți, `position = null`, `hedgePositions = { long, short }` (unități însumate, prețul de intrare al primei), `positionMode = 'hedge'`. Cu o singură parte, `position` ca acum.
- **Alpaca, `normalize`:**
  - textul avertismentului de vânzare peste long spune că poziția e netă;
  - avertisment nou la o cumpărare cu un short deschis: acoperă întâi short-ul.
- **Trading 212, IBKR:** neschimbat.

### 4. Pagina
- **`OrderTicket`:**
  - rândul de sub instrument arată `hedgePositions` și la acțiuni (eToro), cu „Poziții separate” în loc de „Mod hedge”;
  - închiderea pe rânduri (eToro), când toate rândurile sunt short-uri (`shortsOnly`): „Închide” / „De închis” în loc de „Vinde” / „De vândut”;
  - butoanele „Închide long / short” rămân doar la futures (eToro închide pe poziții).
- **`Trades.tsx`, pozițiile:** cheia rândului = simbol + parte + `ref.positionIds` (eToro), altfel indexul. Două short-uri eToro pe același instrument nu mai au aceeași cheie.

### 5. Tipuri, `shared/trading.ts`
Textele de configurare:
- OKX: fără „modul net”;
- Bybit: „modul de marjă se alege din Bybit; modul pozițiilor (one-way / hedge) e citit de Sentiq”.

### 6. Teste
- **ccxt real, cererile capturate:**
  - Binance hedge: `positionSide`, fără `reduceOnly`, la intrare și la TP / SL;
  - Bybit: modul citit din lista pozițiilor; `positionIdx` 1 / 2 la deschidere și reduce-only;
  - OKX: `posSide` la deschidere și reduce-only; `setLeverage` cu `posSide` la izolat;
  - Bitget clasic: `tradeSide` open / close, fără `oneWayMode`; `holdSide` la levierul izolat;
  - Bitget unificat: `posSide`.
- **Simulat:**
  - nepotrivirea modului pe Binance (`-4061`): mesajul cu „Binance”, modul citit din nou;
  - Bybit cu listă goală → one-way.
- **eToro:** long + short → `hedgePositions`.
- **Alpaca:** cele două avertismente.
- **Chrome:** formularul pe un cont Binance simulat în hedge (aceleași componente ca la KuCoin), eToro cu long + short.

## TD-WATCHDRAWER — implementează FD-WATCHDRAWER

### 1. `web/media.ts` (nou)
`useMediaQuery(query)`: `matchMedia(query).matches`, apoi urmărește `change`. Fără `matchMedia` (teste), `false`.

### 2. `Charts.tsx`
- `wide = useMediaQuery('(min-width: 768px)')` (pragul `md` din Tailwind).
- `listOpen` (stare, nu ținută minte): panoul de telefon. Se pune `false` când `wide` devine `true`.
- **Ce se arată:** `listShown = wide ? !list.hidden : listOpen`.
- **Butonul listei:**
  - pe ecran lat comută `list.hidden` (ținut minte), pe telefon `listOpen`;
  - `aria-pressed` / eticheta după `listShown`.
- **Rândul grafic:**
  - `flex`; marginea și `<aside>` doar cu `wide && !list.hidden` (fără clasele `max-md:` de până acum);
  - pe telefon, sub rând: `<ListDrawer open={listOpen} onClose>` cu `<Watchlist>`. `onPick` închide panoul, apoi navighează; `onHide` îl închide.
- **Panoul e în cadrul paginii** (`frame`), ca să se vadă și în ecranul complet nativ (acolo se desenează doar elementul pus pe tot ecranul).
- `useFullscreen(frame, { blockEsc: … || listOpen })`: Esc închide întâi panoul.
- **Grupul butoanelor:** `flex flex-wrap md:flex-nowrap`.

### 3. `ListDrawer` (`components/Watchlist.tsx`)
- **Stratul:** `fixed inset-0 z-[46] overflow-clip`; `pointer-events-none` când e închis. Cu `clip`, nu cu `hidden`: un strat tăiat nu se poate derula deloc, nici de un focus, iar panoul închis, mutat în dreapta, nu lățește pagina. Toate browserele lui Tailwind 4 (Safari 16.4+) știu `clip`.
- **Umbra:** `bg-scrim`, `opacity` 0 / 100 cu tranziție; click → `onClose`.
- **Panoul:** `role="dialog"`, `aria-modal="true"`, `aria-label="Lista de simboluri"`, `tabIndex={-1}`, `inert` când e închis.
  - Clase: `w-[min(340px,88vw)]`, `translate-x-full` / `translate-x-0`, `transition-transform duration-200`, `motion-reduce:transition-none`.
- **Deschis:**
  - `useScrollLock(open)`;
  - focusul pe panou (nu pe căutare: tastatura telefonului nu sare singură), cu `preventScroll`, iar la închidere înapoi pe elementul de dinainte. Fără `preventScroll`, focusul dat în timpul glisării derula stratul la panou: panoul sărea spre stânga și revenea (raportat după deploy);
  - Esc (dacă nu l-a folosit altcineva) → `onClose`.
  - Tab / Shift+Tab se rotesc în panou (un dialog modal: focusul nu ajunge la pagina umbrită).

### 4. Teste
- `media.ts`: fără `matchMedia` → `false`; cu `matchMedia` stubuit: valoarea și schimbarea.
- **Chrome, telefon** (320 / 360 / 390 / 430 px, cu atingere, cont cu tranzacționarea pornită):
  - glisarea, cadru cu cadru: marginea stângă a panoului coboară continuu de la lățimea ecranului la locul ei, iar `scrollLeft` al stratului rămâne 0;
  - fără lățime în plus (`scrollWidth` = lățimea ecranului), butonul listei pe ecran;
  - panoul se deschide din dreapta și se închide cu ✕, cu umbra și cu un simbol ales; redeschiderea merge;
  - ecranul complet.
- **Chrome, tabletă și desktop** (768, 1024, 1440): panoul lateral ca înainte.

## TD-CHARTTOUCH — implementează FD-CHARTTOUCH

### 1. Cercetare (lightweight-charts 5.2.1, `MouseEventHandler`)
- `_touchMoveHandler` (ascultat pe `documentElement`, după `touchstart`) pune `_pinchPrevented = true` la **orice** `touchmove` al degetului activ, înainte de pragul de 5 px. Apoi `_checkPinchState` (la al doilea `touchstart`) nu mai pornește pinch-ul.
- Pinch-ul bibliotecii face `preventDefault` pe `touchmove`-urile cu două degete doar când a pornit. Altfel, Safari face zoom pe pagină.
- Chrome nu trimite paginii `touchmove`-urile din „slop”-ul atingerii (mișcări mici). Reproducerea se face cu `TouchEvent`-uri DOM trimise direct pe panoul graficului.

### 2. `CandleChart.tsx`
- **Containerul graficului** (gazda și suprapunerile: legende, A / L, », „+”): clasa `touch-none` (`touch-action: none`), deci niciun gest de browser (zoom, dublă atingere) nu pornește pe grafic. `touch-action` nu se moștenește, dar se aplică pe intersecția cu strămoșii, deci ajunge și pe gazdă. Derularea verticală nu se schimbă: biblioteca (`handleScroll.vertTouchDrag`, implicit `true`) o oprea deja pe grafic.
- **Ascultători în captură pe gazdă** (`touchstart`, `touchmove`, `touchend` / `touchcancel`, pasivi):
  - cu un singur deget, cât timp el n-a trecut de `TOUCH_DRAG_PX` (8 px, distanță Manhattan de la `touchstart`), `touchmove` e oprit (`stopPropagation`), deci nu ajunge la bibliotecă;
  - după 8 px, sau cu două degete, totul trece;
  - la `touchend` / `touchcancel` fără degete, starea se șterge;
  - efect: biblioteca anulează apăsarea lungă (240 ms, crucea în modul de urmărire) la 5 px. Mișcările oprite n-o mai anulează, deci pragul ei devine 8 px.
- **Tragerea liberă** (`onPanMove`): pragul de preluare pe verticală e `TOUCH_DRAG_PX` la `pointerType === 'touch'`, 3 px altfel.
- **Al doilea deget** (`onDown` cu alt `pointerId`): `endPan(true)` → `setAutoScale(true)`, `setAuto(true)` (tragerea pornește doar cu scala pe automat, deci asta e starea de dinainte), pe ambele scale. `endPan()` fără argument, ca acum.

### 3. `Charts.tsx`
Butonul listei, după butonul de ecran complet, cu `ml-auto` (la telefon îl duce la marginea dreaptă a rândului; pe ecran lat grupul e cât conținutul, deci nu schimbă nimic). Partea din dreapta a barei: `ml-auto justify-end`; când trece singură pe rând, se aliniază la dreapta, deasupra listei.

### 4. Teste (Chrome)
- **Pinch ca în Safari** (`TouchEvent`-uri DOM pe panou): primul deget mișcat 0 / 1 / 3 / 6 px înainte de al doilea → `barSpacing` crește de fiecare dată, „A” aprins, mișcările cu două degete ținute de la pagină;
- un deget peste 8 px apoi al doilea → tragere;
- `touch-action: none` pe gazdă;
- pinch prin CDP (cu „slop”-ul Chrome);
- tragerea cu un deget pe orizontală și pe verticală (A stins la verticală);
- tap-ul (crucea);
- butonul listei ultimul / la dreapta pe 320 / 390 / 768 / 1440;
- desktop: tragerea cu mouse-ul ca înainte.

## TD-CHARTPOLISH — implementează FD-CHARTPOLISH

### 1. `Watchlist.tsx`
- **Rândurile:** containerul derulant `flex flex-col gap-1`. dnd-kit măsoară rândurile cu tot cu spații.
- **`overscroll-contain` doar în panoul de telefon** (prop `inDrawer`) și, din TD-IPADFS, în ecranul complet (prop `contained`). În panoul lateral, în afara ecranului complet, `overscroll-auto`, deci browserul înlănțuie derularea la capăt (cu „latching”: gestul rămâne pe elementul pe care a început).
- **Capul:** fără butonul de ascundere; prop-ul `onHide` dispare.
- **`ListDrawer`:**
  - tragerea spre dreapta, cu pointer, pe panou;
  - pornește când `dx > 10` și `|dx| > 2·|dy|`, cu `setPointerCapture`; panoul urmează degetul (`transform: translateX(dx)`, fără tranziție);
  - la eliberare: `dx > 80` → `onClose`, altfel revine;
  - panoul are `touch-action: pan-y`: derularea verticală rămâne a browserului, cea orizontală vine ca evenimente pointer.

### 2. `Charts.tsx`, bara
- Partea din dreapta: `flex flex-[1_1_auto] flex-wrap items-stretch gap-2.5`, fără `ml-auto` / `justify-end`. Baza e cât conținutul, deci rândul se rupe ca înainte, iar pe rândul lui partea crește la toată lățimea.
- Butonul listei iese din grupul nedespărțit: e ultimul copil al părții din dreapta, cu `ml-auto`.
- Pe telefon, grupul e `contents` (de la `md`, `flex flex-nowrap`), deci butoanele lui și al listei împart rândurile, iar al listei stă la capătul ultimului rând, nu singur pe unul nou.
- În panoul de telefon, containerul rândurilor are și el `touch-pan-y`: un container care derulează își începe propriul lanț `touch-action`, iar fără el browserul lua tragerea laterală (`pointercancel` după ~28 px).

### 3. `CandleChart.tsx`
- **A / L:** `top = main.top + main.height − 24`, `height = 24`, `left = plotWidth`, `right = 0`, cu `bg-chart`. Condiția: `main` există.
- **`HLinePlus`:**
  - `onMove` ignoră evenimentele programatice (`p.point` fără `p.sourceEvent`) și ține minte `p.time` al ultimei poziții reale;
  - cât `menu || hover`: `chart.setCrosshairPosition(at.price, lastTime, series)`;
  - la final, fără mouse pe grafic (`cursor.current === null`), după 80 ms: `chart.clearCrosshairPosition()` și butonul pleacă.

### 4. Teste (Chrome)
- **Rândurile:** distanța dintre dreptunghiurile a două rânduri vecine ≥ 4 px; captură la hover (mouse) lângă rândul deschis.
- **Derularea la 1440 px, cu rotița** (14 favoriți): lista derulează; la capăt, rotița derulează pagina (`scrollY` crește); înapoi, lista.
- **Capul listei** fără buton (panou lateral și de telefon).
- **Telefon:** tragerea spre dreapta închide panoul (> 80 px), una scurtă îl lasă deschis; derularea verticală a listei merge.
- **Bara la 320 / 390 / 768 / 1024 / 1440:** intervalele încep la marginea stângă a conținutului; butonul listei la marginea dreaptă; fără lățime în plus.
- **A / L:** dreptunghiul lor se termină la baza panoului cu lumânări (cu LMA și fără), în coloana scalei.
- **„+”:** mouse pe „+” → crucea vizibilă (pixelii liniei orizontale pe stratul de sus al panoului; eticheta gri pe scală); captură. Mouse plecat în afara graficului → crucea dispare.

## TD-NAVOVERFLOW — implementează FD-NAVOVERFLOW

### 1. `web/components/PriorityNav.tsx` (nou)
- **`fitCount(widths, avail, gap, more)`** (pură, testată): câte elemente încap, de la început.
  - Toate încap (`Σw + gap·(n−1) ≤ avail`) → `n`;
  - altfel, cel mai mare `k` pentru care `Σw[0..k) + gap·k + more ≤ avail`, unde `more` e lățimea lui „»”.
- **`PriorityNav({ items })`:**
  - un rând `flex min-w-0 flex-1`, plus o riglă invizibilă (`aria-hidden`) cu toate paginile la lățimea lor, cu `font-semibold` ca pagina activă (mai lată). Rigla stă într-o cutie `absolute size-0 overflow-hidden`: e așezată, deci măsurabilă, dar nu lățește pagina (fără cutie, pe telefon pagina ajungea la ~950 px);
  - `useLayoutEffect` + `ResizeObserver` pe rând, plus `document.fonts.ready` → `fitCount` → `fit`;
  - vizibile `items.slice(0, fit)`, ascunse restul.
- **„»”** (`ChevronsRight`):
  - atribute: `aria-haspopup="menu"`, `aria-expanded`, `aria-label` „Mai multe pagini (N)”;
  - activ (`bg-nav-active`) când o pagină ascunsă e cea deschisă (`matchPath({ path, end })`).
- **Lista:**
  - `role="menu"`, `absolute top-full left-0 mt-2 z-40`, cu paginile ca `NavLink` `role="menuitem"`;
  - se închide la `pointerdown` în afară, la Esc (focusul revine pe „»”), la schimbarea rutei și când `fit` ajunge la `n`;
  - ↓ / ↑ mută focusul între pagini; deschisă de la tastatură, focusul trece pe prima.

### 2. `App.tsx`, `TopNav`
- Rândul: `flex items-center gap-x-3 sm:gap-x-6`, fără `flex-wrap`.
- Logo `shrink-0`; `<PriorityNav items={useMemo(forRole(NAV, user))}>`; partea din dreapta `shrink-0`.
- Scos: `order-last` / derularea / masca de pe telefon.
- Sub `md`: textul căutării și `⌘K` ascunse (`md:inline`), iar „Rezumat” doar iconița (`max-md:sr-only`). Spațiile mai mici sub `sm` (`gap-x-2`, `gap-3`). Rândul meniului are `min-w-[38px]`, deci „»” are mereu loc.

### 3. Teste
- `fitCount`: toate încap; niciunul; „»” care nu mai lasă loc ultimului; spațiile.
- **Chrome**, la 320 / 390 / 768 / 1024 / 1280 / 1440 / 1700 / 2000:
  - bara pe un rând (înălțimea antetului = un rând; toate elementele pe același `top`);
  - nicio pagină tăiată; fără lățime în plus;
  - „»” deschide lista cu paginile ascunse; Esc / click în afară o închid;
  - pagina activă ascunsă colorează „»”;
  - Tab / Enter / ↓;
  - capturi.

## TD-FULLWIDTH — implementează FD-FULLWIDTH
- **`App.tsx`:** `<main>` fără `mx-auto max-w-[1600px]`, deci `w-full flex-1 px-4 py-5 sm:px-6`.
- **Paginile:** rădăcina fără `mx-auto max-w-[…]`, deci `flex w-full flex-col …`:
  - `News` 1240, `Trades` (ambele rădăcini) 1240, `Settings` 1240, `SettingsAdmin` 1240, `Health` 1240, `Users` 1240;
  - `Security` 1100, `Economy` 1400.
- **Teste (Chrome, 1440 și 1920):** pe fiecare pagină, rădăcina conținutului are aceeași stânga / dreapta ca pe Calendar (marginile lui `<main>`); capturi pentru așezarea panourilor.

## TD-IPADFS — implementează FD-IPADFS

### 1. `Watchlist.tsx`
- Prop nou `contained`:
  - containerul rândurilor e `overscroll-contain` când `inDrawer || contained`, altfel `overscroll-auto`;
  - `touch-pan-y` rămâne doar pentru `inDrawer`.
- `Charts.tsx` îl dă panoului lateral: `<Watchlist … contained={fs.active} />`. Se schimbă odată cu ecranul complet (intrare / ieșire), fără reîncărcarea listei.

### 2. `Charts.tsx`, cadrul
- Neschimbat: `overscroll-contain` în ecranul complet, ca în versiunea care mergea. `overscroll-none` ar opri și „bounce”-ul cadrului; pe iPad nu se poate verifica dacă gestul Safari ar porni atunci.

### 3. Antetul pe iPad
- `pl-14` → `pl-20` (cu `fs.mode === 'native' && iPad`, ca înainte). **Retras de TD-IPADFS2** (pe iPad nu mai e ecranul complet al sistemului).

### 4. Teste (Chrome)
- **iPad, ecranul complet al sistemului:**
  - user agent iPad, click real prin CDP (gest de utilizator, deci API-ul Fullscreen îl acceptă), la 1024 × 768 și 1366 × 1024;
  - în ecranul complet: `document.fullscreenElement` setat, `overscroll-behavior-y` al cadrului `contain`, al rândurilor `contain`, `padding-left` al numelui 80 px (h1 la 96 px), pagina de lățimea ecranului;
  - ieșit: rândurile `auto`, fără padding;
  - captură.
- **Ecranul complet „din pagină”** (fără API-ul Fullscreen), la 1024 × 768, 820 × 1180, 844 × 390, 932 × 430: cadrul `contain`, rândurile `contain`; în afara lui, `auto`.
- **Rotița peste listă, la 1440 × 900, cu 23 de favoriți:**
  - în afara ecranului complet: lista ajunge la capăt, apoi pagina derulează (FD-CHARTPOLISH §1);
  - în ecranul complet „din pagină”, cu cadrul făcut mai înalt decât ecranul (deci ar putea derula): lista ajunge la capăt, iar cadrul și pagina rămân la 0;
  - în ecranul complet nativ, Chrome headless nu derulează nimic cu rotița, nici cadrul singur (verificare de control), deci acolo contează doar clasele.
- **Telefon 390 × 844:**
  - pagina derulată 180 px, apoi panoul;
  - capul panoului la `top` 0 și vizibil (`elementFromPoint` în panou), în și în afara ecranului complet;
  - rândurile `contain`.

## TD-IPADFS2 — implementează FD-IPADFS2

### 1. `web/chart/fullscreen.ts`
- **`isAppleTouch()`** (în locul lui `isIPad()`): `/iPhone|iPod|iPad/` în user agent, sau `Macintosh` cu `navigator.maxTouchPoints > 1` (iPadOS și iPhone-ul cu „Site pentru desktop”). Un Mac are 0 puncte de atingere.
- **`nativeFullscreenAllowed()`** = `!isAppleTouch()`.
- **`enter()`:** fără `nativeFullscreenAllowed()`, nu cere `requestFullscreen` / `webkitRequestFullscreen` (`request = null`). Restul e ca înainte: `fullscreenElement() === el` e fals, deci `'css'`, cu `lockScroll`.

### 2. `Charts.tsx`
- Scoase `isIPad`, `iPad` (`useMemo`) și `pl-20` de pe antet: în `'css'` nu e ✕-ul Safari.
- `contained={fs.active}` rămâne (TD-IPADFS).

### 3. Teste
- **`apple-touch.test.ts`** (fostul `ipad.test.ts`):
  - iPad (cu UA de iPad sau de Mac cu atingere), iPhone, Chrome pe iPad → `isAppleTouch`;
  - Mac fără atingere, Android, Windows cu atingere → nu;
  - `nativeFullscreenAllowed` invers.
- **Chrome, click real prin CDP** (un gest de utilizator, deci API-ul Fullscreen ar accepta cererea):
  - iPad (UA de Mac, atingere) la 1024 × 768 și 820 × 1180; iPhone (UA iOS 26) la 390 × 844, 430 × 932 și 844 × 390:
    - `document.fullscreenElement` gol;
    - cadrul `fixed` de la 0, cât fereastra, `overscroll-contain`; `html` cu `overflow: hidden`;
    - lista `contain`; numele fără padding;
    - pagina de lățimea ecranului; Esc iese (lista înapoi `auto` pe ecranele late);
  - iPhone: panoul de simboluri deschis în ecranul complet, capul la `top` 0 și vizibil (captură);
  - Mac (UA Mac, fără atingere) la 1440 × 900: ecranul complet al sistemului (`document.fullscreenElement` setat), ca până acum.

## TD-CHARTAUDIT — implementează FD-CHARTAUDIT

### 0. Unealta de test (doar în scratchpad, nu în aplicație)
- **Serverul de test:**
  - schemă de test (niciodată `dbo`);
  - servește o copie a `dist/web` cu `<script src="/__audit.js">`;
  - rutele `/__audit/next.js` (pagina își ia comanda ca script, permis de CSP `script-src 'self'`), `/__audit/result` și `/__audit/cmd` (din shell), câte o coadă pentru fiecare dispozitiv;
  - `/__audit/login` pune cookie-ul de sesiune.
- **Simulatorul:**
  - `xcrun simctl openurl` cu `http://127.0.0.1:4398` (`localhost` mergea pe IPv6);
  - `xcrun simctl io screenshot`;
  - atingerile sunt `TouchEvent` / `PointerEvent` sintetice.

### 1. `CandleChart.tsx`, `HLinePlus`
- **Poziția, direct pe element:**
  - `live` (ref) ține ultima poziție;
  - `place()` scrie `box.style.top = main.top + y − 10` chiar în `onMove` (handlerul `subscribeCrosshairMove`), deci în același cadru cu crucea desenată de bibliotecă;
  - `useLayoutEffect(place)` după fiecare randare (montarea, `main.top` schimbat);
  - React nu mai scrie `top` (`style={{ left }}`);
  - `setAt` rămâne pentru vizibilitate și pentru preț.
- **Hover doar de la mouse:** `onPointerEnter` / `onPointerLeave` cu `pointerType === 'mouse'`, în locul `onMouseEnter` / `onMouseLeave` (iOS trimite `mouseenter` la atingere, dar niciodată `mouseleave`).
- **`dismiss()`** (atingere sau creion):
  - `setMenu(false)`, `setHover(false)`, `setAt(null)`, `live = null`, `cursor.current = null`;
  - `chart.clearCrosshairPosition()`;
  - `quietUntil = now + 600 ms`: `onMove` nu readuce butonul cât ține atingerea care a închis meniul.
- **Unde se cheamă `dismiss()`:**
  - `pointerdown` în afara cutiei, cu meniul deschis: `pointerType !== 'mouse'` → `dismiss()`, altfel doar `setMenu(false)`, ca acum;
  - „Linie orizontală la …”: `lastPointer` (ref, setat de `onPointerDown` pe cutie) ≠ `'mouse'` → `dismiss()` după `onAdd`.

### 2. `Charts.tsx`, `SettingsDrawer`
- `fixed top-0 right-0 bottom-0` în locul lui `h-screen` (100vh e „ecranul mare” pe iOS).
- Lățimea: `w-[400px] max-w-full max-[440px]:w-full`.

### 3. `IndicatorPicker.tsx`
- Prop nou `studiesOn: Readonly<Record<string, number>>`: de câte ori e fiecare indicator pe grafic. Charts îl calculează din `studies` (`useMemo`).
- Pe rândul unui indicator obișnuit, după „Adăugat”: „Pe grafic”, sau „Pe grafic × N” pentru N > 1. Butonul rămâne activ (dublurile sunt permise).

### 4. `Watchlist.tsx`, `SymbolSearch`
- **Opțiunile:** `options` = perechi, apoi acțiuni, apoi indici, fiecare cu `path`, plus `active` (index, −1). `active` revine la −1 la fiecare termen nou.
- **Tastele, în `onKeyDown` pe input:**
  - ↓ / ↑ (cu `preventDefault`): `active` circular, apoi `scrollIntoView({ block: 'nearest' })` pe opțiune;
  - Enter: `pick(options[active ≥ 0 ? active : 0])`, dacă există;
  - Escape cu text: `setQ('')` și `preventDefault()`. Charts (`useFullscreen`) și `ListDrawer` sar peste un Esc cu `defaultPrevented`.
- **ARIA:**
  - input `role="combobox"` cu `aria-expanded`, `aria-controls`, `aria-activedescendant`, `aria-autocomplete="list"`;
  - butoanele rezultatelor `role="option"` cu `id` și `aria-selected`; titlurile grupelor `role="presentation"`;
  - cel ales primește `bg-hover`.

### 5. `primitives.ts`, `EdgeLabelRenderer`
- `w = tip + tw + 2·padX`. Dacă `x + w > bitmapSize.width` și `x − w ≥ 0`, desenul e în oglindă:
  - vârful pe ancoră, cutia de la `x − w` la `x − tip`;
  - textul la `x − w + padX`.
- Altfel rămâne ca înainte.

### 6. `Charts.tsx`, încărcarea
- `chartHeight = 560 + 120 · ((lmaDrawn ? 1 : 0) + paneStudies.length)`: aceeași valoare ca stilul graficului, din ce e pornit (valorile LMA vin abia cu lumânările).
- Mesajul „Se încarcă…” și eroarea stau într-o cutie cu `style={{ height: chartHeight }}` în afara ecranului complet, `h-full` în ecranul complet. Mesajul e centrat (`grid place-items-center`).

### 7. Bannerul „nu răspunde”
- `components/OfflineBanner.tsx` (mutat din `App.tsx`), cu `framed` (rotunjit, cu chenar, pentru interiorul ecranului complet).
- `App` îl folosește ca până acum; Charts îl pune primul în cadru când `fs.active`. Aceeași interogare `usePing`, deci nicio cerere în plus.
- În cadru are `role="status"` (bannerul paginii, din spate, are deja `role="alert"`, deci un cititor de ecran nu anunță de două ori).

### 8. Bara (`Charts.tsx`)
- Butonul listei e ultimul copil al grupului `contents md:flex md:flex-[1_1_auto] md:flex-nowrap` (cu `ml-auto shrink-0`), nu mai e frate cu grupul.
- **De la `md`:** grupul crește la lățimea rândului lui, deci butonul stă la marginea din dreapta; dacă grupul nu încape lângă intervale, trece întreg pe rândul următor.
- **Sub `md`:** grupul e `contents`, deci butonul curge cu celelalte, ca înainte.

### 9. Meniul lui „+” (`HLinePlus`)
- `style={{ minWidth: min(240, plotWidth − 8), maxWidth: plotWidth − 8 }}` în locul lui `min-w-[240px]`. E aliniat la dreapta lui „+”, deci nu mai trece de marginea stângă a graficului.

### 10. Teste
- **Unitare:**
  - opțiunile și tastele căutării (`searchNav`: ↓ / ↑ circular, Enter fără alegere = primul, listă goală);
  - eticheta LMA în oglindă (`edgeLabelBox`: încape → dreapta; nu → stânga; nici stânga → dreapta).
- **Safari (simulator):**
  - iPad și iPhone, în și în afara ecranului complet;
  - panoul de setări: butoanele de jos pe ecran;
  - „+”: apare la atingere, dispare după o atingere în afara meniului și după adăugarea liniei;
  - Esc în căutare; eticheta LMA întreagă pe iPhone; bannerul.
- **Chrome, desktop:**
  - „+” cadru cu cadru: decalajul față de cruce în pixeli, la mișcări rapide ale mouse-ului;
  - meniul și clicul în afară;
  - intervalul nou: înălțimea panoului cadru cu cadru;
  - ↓ / ↑ / Enter / Esc în căutare;
  - bara la 320–1440 px, în și în afara ecranului complet: butonul listei niciodată singur pe un rând;
  - telefon 320 / 390, cu atingeri, în ecranul complet: fiecare fereastră deasupra și pe ecran, pagina de lățimea ecranului.
- **Încărcarea:** `chartHeight` se calculează din ce e pornit (`lmaDrawn`, `paneStudies`), nu din valorile LMA, care vin abia cu lumânările. Altfel panoul scădea cu 120 px cât se încărca.

### 11. Modul cruce al bibliotecii, pe ecran tactil (FD §13)
- **Biblioteca (lightweight-charts 5.2.1), pentru fiecare panou:**
  - o apăsare de 240 ms fără mișcare (`longTap`) intră în modul cruce: pune crucea, cu evenimentul atingerii;
  - cât e în modul cruce, o tragere mută crucea, nu graficul;
  - o atingere scurtă pe panou iese din modul cruce și ia crucea (cu eveniment).
- **În efectul care trage liniile și prețurile (`CandleChart`):**
  - `lastType`: ultimul `pointerType` de pe grafic (`pointerdown` / `pointermove`, în captură);
  - `touchCross`, din `subscribeCrosshairMove`: `p.point !== undefined && p.paneIndex === 0 && lastType !== 'mouse'`;
  - crucea pusă înapoi de „+” (fără `sourceEvent`) nu schimbă `touchCross` (biblioteca e tot în modul cruce).
- **`onPanMove`:** la fiecare mișcare a unei atingeri sau a unui creion (`pan.mouse` fals), cu `touchCross` adevărat → `endPan(true)`: tragerea se oprește, iar scala revine la „A” (era pornit la apăsare, altfel tragerea nu pornește; scala logaritmică îl oprise de la apăsare).
  - `touchCross` adevărat de la început (crucea rămasă după o apăsare lungă) → oprită la prima mișcare, înainte să mute ceva;
  - devenit adevărat în timpul apăsării (apăsarea lungă de 240 ms) → oprită la prima mișcare de după.
- **Nu în `onDown`:** o apăsare care închide meniul lui „+” trece întâi prin `onDown` (captură pe grafic), abia apoi prin `pointerdown`-ul documentului, care cheamă `dismiss` și scoate biblioteca din modul cruce. Hotărâtă la apăsare, tragerea n-ar mai fi mutat prețurile.
- **Crucea mouse-ului** (`lastType === 'mouse'`) nu e modul cruce: o tragere cu degetul după ea mută prețurile ca până acum.

### 12. Ieșirea din modul cruce (FD §14)
- **`chart/touch-cross.ts`, `endTouchCross(chart)`:** pentru fiecare panou, pe canvasul de sus al bibliotecii (al doilea din celula panoului, cel care primește atingerile), un `touchstart` și un `touchend` sintetice, departe de grafic (−10000 px).
- **Ce face biblioteca:**
  - la `touchstart`: `exitOnNextTry = startTrackPoint !== null`;
  - la `touchend`: `tryExitTrackingMode()` iese din modul cruce și ia crucea, cu eveniment, deci `touchCross` devine fals;
  - fără modul cruce, nimic.
- Fără `Touch` / `TouchEvent` (un browser fără atingere): nimic.
- **`HLinePlus.dismiss()`** îl cheamă după `clearCrosshairPosition()`. Acela nu trimite eveniment și nu scoate biblioteca din modul cruce.
- **Efecte secundare verificate:**
  - „tap”-ul bibliotecii ajunge la `subscribeClick`, nefolosit în Sentiq;
  - nu există dublu tap: poziția e departe, iar o atingere reală în următoarele 500 ms trebuie să fie la sub 30 px ca să conteze;
  - biblioteca scoate focusul de pe elementul activ la `touchstart` (`blur`); la `dismiss` acesta e cel mult butonul din meniu sau „+”;
  - ascultătorii noștri de atingeri de pe grafic: FD-CHARTTOUCH pune și scoate `first`; înălțimile panourilor nu se schimbă.

### 13. „⌥H” (FD §15)
- `<kbd>` din meniul lui „+” primește `hidden md:inline`, ca scurtătura din `App.tsx`.

### 14. Teste (§11–§13)
- **Unitar:** `endTouchCross`:
  - fără `Touch`: nimic;
  - cu panouri: `touchstart` apoi `touchend` pe al doilea canvas, departe de grafic;
  - panou fără element sau fără canvas: sărit.
- **Safari (simulator, iPhone și iPad):**
  - apăsare lungă, apoi tragere: „A” rămâne pornit; a doua tragere, cu crucea rămasă: la fel;
  - tragere obișnuită: „A” se oprește, ca până acum;
  - după adăugarea liniei, după o atingere pe „Indicatori” cu meniul deschis și după o glisare cu meniul deschis: o glisare derulează graficul (vederea salvată se schimbă), iar „+” nu revine;
  - cu meniul deschis, o tragere verticală mută prețurile („A” se oprește);
  - „⌥H”: ascuns pe iPhone, vizibil pe iPad.

### 15. Atingerea pe o linie (FD §18)
- `active` ține și `startX`.
- `onMove`, pentru o atingere: distanța e `|dx| + |dy|`, cu pragul de 10 px. Pentru mouse și creion rămâne doar `|dy|`, cu pragul de 3 px.
- Peste prag, `moved = true`, deci `onUp` nu mai cheamă `onOpenHLine`. Pe ecran tactil linia tot nu se trage.
- **Safari:**
  - glisare orizontală de pe linie: setările nu se deschid, iar vederea salvată se schimbă;
  - atingere scurtă: setările se deschid.
- **Așteptarea în teste:** vederea salvată se citește la 3,5 s după glisare. Derularea din inerție continuă după ridicarea degetului, iar vederea se salvează abia la 400 ms după ultima schimbare, deci o valoare „neschimbată” citită mai devreme nu dovedește nimic.

## TD-MODALFIT — implementează FD-MODALFIT
### 1. Înălțimea din partea vizibilă
- Stratul fiecărei ferestre e `fixed inset-0`, adică exact partea vizibilă a ferestrei (fără `vh`), verificat în Safari la panoul de setări (TD-CHARTAUDIT §2).
- Fereastra din el: `max-h-full` în locul lui `max-h-[88vh]` / `sm:max-h-[94vh]`. Stratul e un container flex cu înălțime definită, deci procentul se raportează la el, minus `pt` / `pb`.
- **Căutarea (⌘K):** fereastra e `flex max-h-full flex-col`; lista are `min-h-0` (se strânge) și păstrează `max-h-[50vh]`.

### 2. Tastatura: `visible-area.ts`
- `areaStyle(vv, innerHeight)` (pur):
  - fără `visualViewport`, sau când acesta e toată fereastra (`height ≥ innerHeight − 1` și `offsetTop ≤ 0`): `undefined`, deci rămâne CSS-ul;
  - altfel (tastatura, mărirea): `{ top: offsetTop, height, bottom: 'auto' }` în px.
- `useVisibleArea()`: ascultă `resize` și `scroll` pe `visualViewport` și dă stilul de mai sus.
- Folosit pe straturile din `Modal`, `AccountWizard`, `DaySummary`, `CommandPalette`, pe `SettingsDrawer` (Charts) și pe stratul panoului listei (`Watchlist`, telefon).
- Un element `fixed` stă pe „layout viewport”; cu tastatura deschisă, Safari derulează partea vizibilă în interiorul lui (`offsetTop`), deci `top = offsetTop` îl aduce în dreptul ei.

### 3. Teste
- **Unitar:** `areaStyle`:
  - fără `visualViewport`: `undefined`;
  - toată fereastra: `undefined`;
  - tastatura (înălțime mai mică): `top` / `height`;
  - derulată (`offsetTop > 0`): `top`;
  - valori fracționare: rotunjite.
- **Safari (un simulator):** „Indicatori” → „Toți” și „Ordin nou”: marginea de jos a ferestrei ≤ `innerHeight`, în și în afara ecranului complet; `100vh` în px față de `innerHeight` (de câți px trecea înainte).

## TD-SCOREWHY — implementează FD-SCOREWHY
### 1. Server
- `daily-index.ts`: `interface ScoreWhy { engine; meta; relevance; impact; impactSource: 'ai' | 'rules'; ruleImpact }`; `Driver.why?: ScoreWhy`.
- `DailySentimentService.explainDrivers(day, scope)`: o singură interogare pentru cei (cel mult zece) driveri, cu aceeași alegere ca `loadItems` / `queryNews`:
  - indicele comun: `n.sentiment_engine`, `n.sentiment_meta`, `n.sentiment_impact`;
  - indicele unui utilizator (`scope`): `a.*` acolo unde `a.score IS NOT NULL` (scorul AI-ului lui, fără meta), altfel cel comun; importanța `COALESCE(a.impact, n.sentiment_impact)`, ca `loadItems`;
  - `impact = sentiment_impact ?? n.impact`, `impactSource = sentiment_impact !== null ? 'ai' : 'rules'`, `ruleImpact = n.impact`;
  - `meta` citit cu `safeJson`; o știre fără rând (ștearsă) rămâne fără `why`.
- **Ruta `/api/sentiment/today`:** `today()` (care salvează instantaneul fără `why`), apoi `explainDrivers`. `why` nu ajunge în baza de date și nici în rezumatul AI (`summary/context.ts` cheamă `today()` direct).

### 2. Web
- `components/ScoreWhy.tsx`: `<details>` „De ce acest scor?” (motorul, modelul, regulile, relevanța / importanța, cu numele AI-ului din `engine`), plus `children` pentru rânduri în plus. Mutat din `NewsRow`, care îl folosește la fel.
- `format.ts`, `fmtDayShare(contribution, sentiment)`: `contribution / sentiment` (partea din greutatea zilei, același semn deci pozitivă) → „12%”, „sub 1%” sub 0,5%, „—” pentru 0 sau valori nefinite.
- `Today.tsx`, `DriversTile`: în coloana titlului, titlul și sub el `<ScoreWhy why={x.why ?? null}>` cu „Cântărește … din indicele zilei”.

### 3. Teste
- **Server** (`drivers-why.test.ts`, pe schema de test):
  - indicele comun: model local cu meta (model, reguli), importanță din cuvinte-cheie și din AI;
  - indicele unui utilizator cu AI-ul lui: motorul AI-ului, fără meta, importanța lui;
  - o știre ștearsă: fără `why`;
  - fără driveri: nicio interogare / nimic.
- **Unitar:** `fmtDayShare`.

## TD-INDEXWHY — implementează FD-INDEXWHY
### 1. `daily-index.ts` (pur)
- `select(items, window, asOf)`: fereastra, excluse, fără scor, etichetele; folosit de `computeIndex` și de `explainIndex` (aceeași selecție).
- `weigh`: fiecare rând ține și termenii (`decay`, `clusterN`, `cluster = (1 + boost·log₂ n) / n`, `spec`). `aggregate` adaugă `cap` (factorul plafonului sursei, 1 fără plafon).
- `explainIndex(items, window, asOf, p)` → `IndexExplain`:
  - `counts`, `breakdown` (ca `computeIndex`);
  - `total: { raw, weight, shrunk, index, confidence }`;
  - `sources[]: { id, name, sourceWeight, count, base (Σ înainte de plafon), weight (după) }`, `capActive` (≥ 4 surse cu pondere); o sursă cu Σ 0 are factorul plafonului 1 (nu are ce tăia; ponderea rămâne 0, deci indicele nu se schimbă);
  - `items[]` (toate cele eligibile, după pondere descrescător): termenii, `weight`, `share = weight / W`, `contribution = weight · s / W`.
- `INDEX_RULES`: `labelT` 0,2, pragurile încrederii 3 / 10, factorii 0,2 / 0,5, exportate pentru fereastră.
- `computeIndex` neschimbat numeric (testul compară cele două).

### 2. Serviciul și ruta
- `DailySentimentService.explainToday(tz, now, scope)`: `loadItems` → `explainIndex`; primele 100 cu `why` (motorul, meta, sursa importanței; aceeași interogare ca `explainDrivers`, scoasă în `whyOf(ids, scope)`); restul: `rest: { count, share, contribution }`.
- `GET /api/sentiment/today/explain` → `{ day, tz, asOf, params, rules, counts, total, breakdown, sources, capActive, items, rest }`.

### 3. Web
- `components/IndexExplain.tsx`: `Modal` (lățime 980). Interogarea `['sentiment', 'explain']`, la deschidere, fără reîmprospătare automată; „Recalculează” o reface.
- Secțiunile din FD §2. Numerele cu `fmtNum` (virgulă), scorurile cu `fmtScore` (ca în restul paginii). Lista: 20, „Arată încă 20” până la `items.length`, apoi rândul „Celelalte”.
- `Today.tsx`, `SentimentTile`: rândul de sub carduri: butonul (stânga) și „în analiză” (dreapta).

### 4. Teste
- **Pur** (`index-explain.test.ts`):
  - `explainIndex` dă același `raw`, `weight`, `index`, `confidence`, `counts`, `breakdown` ca `computeIndex`, pe un set cu poveste, plafon, sponsorizat, știri vechi;
  - suma contribuțiilor = `raw`; suma `share` = 1;
  - termenii fiecărei știri înmulțiți dau ponderea;
  - plafonul: activ cu ≥ 4 surse, inactiv sub;
  - fără știri: zero și 50.
- **Serviciul** (pe schema de test): primele 100 și restul (cu 105 știri); `why` la cele din listă; scope cu AI-ul utilizatorului.

## TD-WHYPLAIN — implementează FD-WHYPLAIN
### 1. Efectul unei știri (pur, `daily-index.ts`)
- `indexValue(raw, weight, p)`: indicele nerotunjit (`toIndex` îl rotunjește la 0,1, prea grosier pentru 0,1 puncte).
- `effects(items, window, asOf, ids, p)`: pentru fiecare id, indicele refăcut fără știrea aceea (aceleași `select` / `weigh` / `aggregate`, deci cu plafonul și apropierea de neutru) → `{ without, effect = value − without }`. Cost: k × n (k = 10 la „Ce mișcă piața”, 100 în fereastră).
- `IndexExplain.total.value`: indicele nerotunjit.

### 2. Serviciul
- `explainDrivers(day, scope, items?)`: știrile zilei (primite, sau încărcate cu aceeași fereastră și același `asOf` ca `day`), `explainIndex` pentru termenii fiecărui driver și `effects` pentru cei (cel mult 10) driveri. Fiecare driver primește `why`, `effect`, `without` și `weighs: { relevance, impact, sourceWeight, spec, flags, decay, clusterN, cap, share }`.
- `todayExplained(tz, now, scope)`: ce cere ruta `/api/sentiment/today` (la fiecare minut, de pe pagina Azi). Încarcă știrile o dată, calculează ziua (`dayFrom`), o salvează fără explicații, apoi `explainDrivers` cu aceleași știri. `computeDay` = `loadItems` + `dayFrom`.
- `explainToday`: `effects` pentru primele 100; fiecare rând are `effect` și `without`.

### 3. Web
- **`DriversTile`:**
  - sub titlu: „Din cele N știri de azi: …” (N = pozitive + neutre + negative);
  - sub fiecare titlu: „Fără ea, indicele ar fi X (acum Y): ±Z puncte.”;
  - în `ScoreWhy`, explicația ponderii. Raportul față de o știre obișnuită: `share × N`. Termenii se pun doar când spun ceva: relevanța sub 1, povestea peste o sursă, factorul sub 1, plafonul sub 1.
- **`Tile`:** `onLabel` (și `labelHint`): titlul din `h2` devine un `button` (`aria-haspopup="dialog"`, `title` și `aria-description` = indicația), subliniat punctat, accent la hover. **`SentimentTile`:** `onLabel` deschide `IndexExplain` (doar cu ziua încărcată); `actions` rămâne doar cu cifrele; sub categorii, doar „în analiză”.
- **`IndexExplain`:** titlul `Modal` e un nod: textul și `PremiumBadge` (din `IndicatorPicker`); „Pe scurt” sus (din `counts`, `items`, `sources`, `total`); la fiecare rând, „fără ea”.

### 4. Motivul AI-ului (migrarea 6)
- **`schema.ts`:** migrarea 6, `ALTER TABLE news_ai_scores ADD reason NVARCHAR(400) NULL`.
- **`ai-scorer.ts`:**
  - schema răspunsului primește `reason`, string **obligatoriu**: schemele stricte OpenAI nu permit câmpuri opționale, iar `default` (din `.catch`) s-ar putea să nu fie acceptat; descrierea cere română, o propoziție, cel mult 120 de caractere; gol când nu e nimic de spus;
  - promptul de sistem spune la fel;
  - `AiScore.reason`: tăiat la 160 de caractere, gol → null.
- **`service.ts` (`scoreUsers`):** scrie `reason` cu scorul. O știre cu titlul nou își pierde scorul, deci și motivul (ca acum).
- **`whyOf`:** `a.reason` când `a.score IS NOT NULL` → `ScoreWhy.reason`. **`queryNews`:** la fel, în `meta` nu (meta e a modelului local): câmp nou `reason` în `sentiment`.
- **`ScoreWhy.tsx`:** primul rând, „Motivul (Claude): …”, când există.
- **Pornirea:** codul refuză o bază mai nouă (`migrate`). Ordinea e deploy (migrarea 6 pe baza reală, cu codul care o știe), apoi orice pornire locală pe baza reală.

### 5. Teste
- **Pur:** `effects`: fără știri → 50; o știre → `without` 50; suma… nu (efectele nu se adună: neliniar); efectul = indicele − indicele fără ea, cu `computeIndex` pe setul fără ea (± rotunjire).
- **Serviciul:** driverii au `effect`, `without`, `weighs`; fereastra are `effect` la primele 100.
- **AI:** `reason` citit, tăiat, gol → null; scris în `news_ai_scores`; citit de `whyOf` și `queryNews`.

## TD-HISTORYCHART — implementează FD-HISTORYCHART
### 1. `web/history-chart.ts` (pur)
- `daySlots(today, n)`: cele n zile (`addDays`), cea mai veche prima.
- `byDay(points, keyOf)`: `Map<day, value>` (ultima valoare câștigă).
- Zilele: Sentiq din `HistoryPoint.day`; crypto `dayKey(timestamp, 'UTC')`; CNN `dayKey(timestamp, 'America/New_York')`.
- `chartScale(values)`: pe `values ∪ {50}`, marginea `max(1, 10 % din interval)`: `lo = floor(min − margine)`, `hi = ceil(max + margine)`, în 0–100, cel puțin 4 puncte (altfel lărgită în jurul mijlocului). Mai strânsă decât `DayChart` (45–55 minim), ca zilele 47–49 să se vadă.
- Marginea din dreapta (24 px) pentru etichetele scării; `x` și alegerea zilei la hover pe lățimea fără ea.
- `fearGreedLabel(v, kind)`: benzile fiecărui indice, în cuvinte.
- Ziua de azi a liniei Sentiq: indicele live (`useSentiment`, ca pe card), provizoriu; istoricul o are doar de la ultima salvare.
- `segments(slots, map)`: bucățile continue (index, valoare) pentru o linie întreruptă (Sentiq); `points(slots, map)` pentru o linie continuă peste goluri (CNN).
### 2. `Today.tsx`, `HistoryTile`
- Aceeași interogare `['market', 'context']` ca banda.
- Mărimea din `ResizeObserver` (lățime și înălțime).
- SVG cu linia lui 50, liniile, punctele Sentiq (gol pentru `final` fals), zona de hover (o coloană pe zi, `pointermove` / `pointerleave`), eticheta HTML poziționată absolut și ținută în panou.
- Legenda: butoane `aria-pressed`; cel puțin una afișată.
### 3. Teste
- **Unitar:** `daySlots`, `byDay` (zilele UTC și New York), `chartScale` (50 inclus, limitele 0–100, valori egale), `segments` (golurile rup linia).
- **Chrome:** 390 și 1440 px; panoul plin; legenda ascunde / arată; hover-ul arată valorile zilei; fără context de piață.

## TD-MULTICAT — implementează FD-MULTICAT
### 1. Baza (migrarea 7)
- `ALTER TABLE sources ADD categories NVARCHAR(100) NULL`: categoriile, despărțite prin virgulă, în ordinea fixă `crypto, stocks, macro, geopolitics`, când sunt cel puțin două; NULL pentru o singură categorie.
- `category` rămâne (cu CHECK-ul ei): prima categorie a sursei (afișare, ordonare, categoria știrilor fără semn).
- `SOURCE_COLUMNS` și `SourceRow` primesc `categories`.

### 2. `news/categorize.ts`
- `CATEGORY_ORDER`, `normalizeCategories(list)` (unice, în ordine), `sourceCategories(row)` (`categories` sau `[category]`), `encodeCategories(list)` → `{ category, categories }`.
- `categorize(title, summary, coins, allowed, isCrypto)` → `{ category, matched }`:
  - semne: termenii fiecărei categorii (expresii regulate, termeni distincți), plus 2 pentru o monedă crypto numită (`isCrypto`), plus 2 pentru o companie / acțiune / indice (`#CO`, `#…`, `^…`, sau un simbol care nu e crypto);
  - cea mai mare sumă dintre `allowed`; egalitate → `CATEGORY_ORDER`; zero peste tot → prima din `allowed`, `matched` fals.
- `CoinDetector.isCrypto(sym)`: simbolul e în lista de monede și nu e o acțiune din favorite.

### 3. Clasarea unei știri (`ingest.ts`)
- `weighItem(source, title, summary, coins, classifierCoins, detector)`:
  - o categorie → `classify(category, …)`, categoria sursei;
  - mai multe → `categorize`, apoi `classify(categoria aleasă, …)`; fără semn → relevanța 0 și `lowRelevance`.
- Folosit de `ingestItems` (știre nouă, și titlu schimbat: acum și `category` în UPDATE) și de `retagRecent` (care citește acum și categoriile sursei: `JOIN sources`; la sursele cu mai multe categorii scrie și `category`).
- `reclassifySource(db, sourceId, detector, classifier)`: toate știrile păstrate ale sursei, cu `weighItem` (categorie, relevanță, importanță, flaguri). Chemat de `PUT /api/sources/:id` când se schimbă categoriile.

### 4. Ruta
- `POST /api/sources`: `categories: string[]` (1–4, cele patru valori) sau, ca înainte, `category`. Normalizate, apoi `{ category, categories }`.
- `PUT /api/sources/:id`: `categories` (sau `category`) doar pentru sursele adăugate; la o schimbare, `reclassifySource`.
### 5. Web (`SettingsAdmin`)
- `CategoryPicker`: patru butoane `aria-pressed` și „Toate (general)”; folosit la adăugare și la „Schimbă” în tabel (doar surse adăugate).
- `categoriesLabel(row)`: „General” (patru), altfel numele unite cu „ + ”.
### 6. Teste
- `categorize`: titluri reale pe fiecare categorie, egalități, restrângerea la `allowed`, fără semn.
- **Pe schema de test:** o sursă generală prin API (știri pe categorii, cea fără semn cu relevanța 0); titlu schimbat; `retagRecent` nu readuce relevanța; `PUT` cu alte categorii reclasează; validări (zero categorii, sursă implicită).

## TD-HTMLFEED — implementează FD-HTMLFEED
### 1. Baza (migrarea 8)
- `ALTER TABLE sources ADD read_as NVARCHAR(20) NULL, read_url NVARCHAR(MAX) NULL`.
- `read_as`: NULL (feed RSS, ca înainte) | `declared` (feed din pagină, `read_url`) | `sitemap` (sitemap de știri, `read_url`; secțiunea = calea adresei sursei) | `jsonld` | `page`.
- `SOURCE_COLUMNS` / `SourceRow` le primesc.
- Știrile „văzute” fără dată ale unei surse: `market_cache`, cheia `page-seen:<id>` (lista adreselor, cel mult 1000).

### 2. `news/page-reader.ts` (pur)
- `declaredFeeds`, `jsonLdItems`, `pageItems` (scanare cu stivă de elemente: titluri în `h1–h4` sau carduri; `nav` / `header` / `footer` / `aside` / `menu` / `dialog` / `form` ignorate; data = primul `<time>` din cel mai mic element care nu conține alt titlu, altfel `urlDate`), `sameSite`, `absoluteUrl`.
- `parseSitemap(xml)` → `{ kind: 'index', children: { loc, lastmod }[] } | { kind: 'urls', items }` (doar intrările cu `news:title`; data din `news:publication_date`, altfel `lastmod`).
- `parseRobots(txt)` → `{ sitemaps, disallowed(path) }`: grupul `User-agent: *`, `Allow` / `Disallow` cu `*` și `$`, cea mai lungă regulă câștigă.
- `isBlocked(status, body)`: 401 / 403 / 429 / 503 sau provocare („Just a moment…”, `cf-chl`, `captcha`).

### 3. `news/page-feed.ts`
- `resolveSource(url, fetch)` → `{ readAs, readUrl, items, note }`, ordinea din FD §2; folosit de `/api/sources/test` și la adăugare. Înainte de pagină și de sitemap: `robots.txt` al site-ului (o dată pe rezolvare / citire): interzis → nu se citește; 404 → permis; 5xx / fără răspuns → nu acum (eroare, reîncercare).
- `readSource(source, fetch)` → items, după `read_as` (fără o nouă rezolvare).
- `fetch` = `fetchText` cu `Accept` pentru HTML / XML, 5 MB, 15 s.
### 4. `fetcher.ts`
- `read_as` NULL: ca acum. Altfel `readSource`.
- Fără dată: cu `last_success_at` NULL (prima citire), adresele intră în `page-seen` și nu se adaugă. Mai târziu, cele din `page-seen` se sar, iar restul intră (`effectivePublishedAt(null)` = acum).
- `next_fetch_at`: +10 min pentru `read_as` ne-NULL.
### 5. Rute și web
- `POST /api/sources/test` → `{ ok, count, sample, error?, method?, dated?, note? }`.
- `POST /api/sources` → rezolvă (dacă nu `skipTest`) și salvează `read_as` / `read_url`.
- **Admin:** mesajul testului cu modul; în tabel, modul lângă stare.
### 6. Teste
- **Pur:** `pageItems` (fixture după structurile CNBC / CoinDesk: carduri cu `<time>`, date în adresă, meniuri, linkuri duble, chrome), `jsonLdItems`, `declaredFeeds`, `parseSitemap` (index, știri, fără titluri), `parseRobots`, `isBlocked`, `sameSite`.
- **Rezolvare** (cu `fetch` fals): feed; feed declarat; JSON-LD; pagină; pagină blocată → sitemap din `robots.txt` cu secțiune; nimic → mesaj.
- **Pe schema de test:** prima citire a unei pagini (fără dată → văzute), a doua (noile intră), datate intră din prima.

## TD-AIQUOTA — implementează FD-AIQUOTA
### 1. `ai/types.ts`
- `AiError` primește:
  - `detail: string | null`: cuvintele furnizorului, curățate cu `providerWords`, doar pentru `quota` și `rate`;
  - `resetsAt: number | null`.
- Constructorul are un al 6-lea parametru, `extra?: Partial<AiExplained> | null`. `said` înlocuiește descrierea implicită a tipului.
- `providerWords(text)`:
  - adună spațiile;
  - înlocuiește tot ce seamănă cu o cheie (`sk-…`, `AIza…`) cu „…”;
  - taie la 600 de caractere.
- `aiErrorLine(err)` = mesajul + ` (Google: cuvintele furnizorului)`, pentru jurnal.
- `describe()` ascunde și el cheile din textul furnizorului pe care îl pune în mesaj (permisiune, cerere respinsă, conexiune, altă eroare): `providerWords(detail).slice(0, 300)`.

### 2. `ai/http.ts`
- `JsonCall.explain?: (kind, status, body, text) => AiExplained | null`, unde `AiExplained = { said, resetsAt }`.
- `callJson` dă rezultatul către `AiError`.

### 3. `ai/gemini.ts`
- **`geminiKind`:** 402 sau „prepayment credits” → `quota`; o metrică `per_day` numită doar în mesaj → `quota`, ca `PerDay` din `quotaId`; în rest, ca acum.
- **`geminiLimits(body, text)`** → `{ metric, id, model, limit }[]`:
  - din `error.details[].violations[]` (`quotaMetric`, `quotaId`, `quotaDimensions.model`, `quotaValue`);
  - plus rândurile „Quota exceeded for metric: M, limit: N, model: X” din mesaj, care completează limita lipsă (aceeași metrică).
- **`explainGemini(kind, status, body, text, model, now)`:** doar pentru `quota`.
  - **Prepay:** 402 sau `/prepayment credits/`.
  - **Limita 0:** o încălcare cu limita 0. E pe nivelul gratuit dacă `quotaId` are `FreeTier` sau metrica are `free_tier`; altfel e pe unul plătit.
  - **Limita zilnică:** o încălcare cu `PerDay` în `quotaId` sau `per_day` în metrică, gratuită sau plătită. `resetsAt = nextPacificMidnight(now)`, adică `dayBounds(dayKey(now, LA), LA).end`.
  - **Altceva:** null (mesajul implicit).
- `GeminiClient.generate` trimite `explain` cu modelul cerut; `listModels` (verificarea cheii) trimite `explain` fără model (`null`), iar mesajele nu numesc atunci niciun model.

### 4. `sentiment/ai-scorer.ts`
- `AiScorerStatus.lastError` primește `detail?` și `resetsAt?`, opționale pentru stările vechi. Se completează din `AiError`.
- `AiScorerOptions.restored?: { lastError, pausedUntil }`:
  - o eroare permanentă → pauză fără sfârșit;
  - altfel `pausedUntil ?? 0`;
  - eroarea veche se păstrează, ca primul răspuns bun să o șteargă (`onState`).
- `resume()`: scoate pauza; eroarea rămâne până la primul răspuns.
- Jurnalul folosește `aiErrorLine`.

### 5. `sentiment/service.ts`
- `storedState(userId, sig)`: starea salvată a acestei semnături. Citirea e comună cu `aiStatus`.
- `scorerFor`:
  - **scorer nou:** pornește din starea salvată, dacă semnătura e aceeași (repornire);
  - **scorer păstrat și în pauză:** dacă starea salvată a dispărut (ștearsă de `retryNow`, pe oricare instanță), se apelează `resume()`. Asta înseamnă o citire pe minut, doar pentru utilizatorii în pauză.
- `retryNow(userId)`: șterge rândul `ai:scorer:<id>`.

### 6. Rute
- `PUT /api/settings`: când se schimbă `ai`, apelează `await ctx.sentiment.retryNow(u.id)` înainte de nudge.
- `PUT /api/ai/key`: după `setKey`, apelează `await ctx.sentiment.retryNow(u.id)`.

### 7. Web (`AiSettings.tsx`)
- Avertismentul are trei părți:
  - mesajul;
  - „Google resetează limita pe {fmtDateTime(resetsAt, timezone)}.”, dacă `resetsAt` e în viitor;
  - „Răspunsul {furnizor}: „…”” (`text-[12px] text-faint`, `[overflow-wrap:anywhere]`).

### 8. Rezumatul zilei
- Jurnalul folosește `aiErrorLine`; mesajul către utilizator rămâne `describeAiError` (acum precis).

### 9. Teste
- **`providers.test.ts`:**
  - `geminiKind` pentru 402 și 429 „prepayment”;
  - `explainGemini` pentru fiecare rând din FD §1: detalii complete, doar text, limita 0 gratuit sau plătit, zilnic gratuit sau plătit, pe minut → null;
  - `resetsAt` în PDT și în PST;
  - `providerWords` (cheie ascunsă, tăiere, spații);
  - `callJson` cap-coadă cu un corp Google real, inclusiv `detail` și `resetsAt`;
  - `detail` doar pentru `quota` și `rate`.
- **`sentiment.test.ts`:** `AiScorer` cu `restored`:
  - pauză în curs → nicio cerere;
  - permanentă → nicio cerere;
  - expirată → cerere, apoi eroarea se șterge;
  - `resume()`.
- **Pe schema de test:**
  - o „repornire” (un nou `SentimentService`) păstrează pauza;
  - `retryNow` pe instanța paginii reia scorarea pe instanța joburilor;
  - `aiStatus` are `detail` și `resetsAt`;
  - ruta `PUT /api/ai/key` șterge starea.

## TD-AISLOW — implementează FD-AISLOW
### 1. `ai/types.ts`
- `withinRo(ms)`: „într-o secundă”, „în 15 secunde”, „în 20 de secunde”, „într-un minut”, „în 3 minute”, „în 20 de minute”. Se folosesc minute când `ms` e multiplu de 60 000.
- `AiError.passing`: `transient || kind === 'timeout'`. Sunt erorile după care scorul reîncearcă repede. `transient` rămâne pentru reîncercările din cerere, unde un timp depășit nu se repetă.

### 2. Timpul cererii (`ai/http.ts`, `ai/anthropic.ts`)
- **`callJson`:**
  - `deadline = Date.now() + timeoutMs`;
  - fiecare încercare are `once(call, fetch, deadline − now)`;
  - o reîncercare a cărei pauză (1 s, 4 s sau Retry-After) ar ajunge la `deadline` nu se face: se aruncă eroarea primită.
- **La timp depășit (`once`):** `new AiError(provider, 'timeout', 0, '', model, { said: `${name} nu a răspuns ${withinRo(timeoutMs)}` })`, cu timpul întregii cereri.
- **`AnthropicClient.generate`:**
  - `deadline = AbortSignal.timeout(timeoutMs)`, combinat cu semnalul apelantului și dat SDK-ului; `timeout` pe încercare rămâne `timeoutMs`;
  - întreruperea de la `deadline`, fără ca apelantul să fi oprit, devine `AiError('anthropic', 'timeout', …, { said: 'Anthropic nu a răspuns în …' })`;
  - oprirea apelantului rămâne o întrerupere.

### 3. `sentiment/ai-scorer.ts`
- `AI_CALL_TIMEOUT_MS = 180_000` pentru lot (înainte 90 000).
- **Pauza:**
  - `PASSING_PAUSE_MS = 60_000`, `PASSING_PAUSE_MAX_MS = 15 * 60_000`;
  - după o eroare `passing`: `min(MAX, 60 000 · 2^(failures − 1))`;
  - `quota`: 30 de minute; permanentă: ∞; altfel: 5 minute.
- **`failures`:** erori la rând de la ultimul răspuns.
  - Câmp privat, în `status()` ca `failures`, salvat în stare.
  - Se restaurează din `restored.failures ?? 0`.
  - `resume()` îl pune pe 0.
  - Un răspuns, folosibil sau nu, îl pune pe 0. Când era peste 0 sau exista o eroare, se apelează `onState`.
- `lastError.passing?: boolean`, opțional pentru stările vechi.
- **Durata:** se măsoară în jurul lui `client.generate`. Peste 60 s, `log.info("AI scoring (engine): N headlines answered in S s")`.
- O întrerupere (`signal.aborted`) nu e eroare, ca înainte.

### 4. `sentiment/service.ts`
- `AI_PER_RUN = AI_BATCH` (un lot pe utilizator pe rundă).
- **`scoreUsers`:**
  - lucrul unui utilizator se mută în `scoreUser(userId, signal, now)`;
  - utilizatorii merg printr-un bazin de `AI_USERS_AT_ONCE = 4` lucrători, care iau pe rând din coadă;
  - un lucrător prinde eroarea unui utilizator și trece la următorul;
  - totalul e suma, iar prima eroare se aruncă după ce toți au terminat;
  - `stateWrites` se așteaptă la sfârșit, ca înainte.
- **`aiProgress(userId, now)`** → `{ total, scored, lastAt }`:
  - `total` și `scored` folosesc același filtru ca scorarea (sursă activă, `relevance > 0`, publicate în `AI_WINDOW_MS`); `scored` = cu rând în `news_ai_scores` al utilizatorului;
  - `lastAt` = `max(scored_at)` al utilizatorului.
- `StoredScorerState` primește `failures?: number`. `onState` îl salvează, `storedState` îl dă mai departe la `restored`.
- `scorerFor`: un scorer păstrat citește starea salvată când e în pauză **sau are erori la rând**. Dacă starea lipsește (ștearsă de `retryNow`), se apelează `resume()`, care șterge și seria.

### 5. `jobs/register.ts` (`sentiment.ai`)
- `aiRounds(round, signal, now)`: runde cât `now() − start < AI_RUN_BUDGET_MS (5 min)`, cel mult `AI_MAX_ROUNDS = 40`, până la o rundă cu 0 sau până la oprire. Întoarce câte runde a făcut.
- Jobul: `aiRounds(() => scoreUsers(signal), signal)`; `timeoutMs` rămâne 10 minute.

### 6. Rută și tipuri
- `AiStatus.progress: { total, scored, lastAt } | null`, null când scorul AI e oprit sau nu e cheie.
- `GET /api/ai/status` îl calculează doar când `scorer` nu e null.
- `AiScorerStatus` primește `failures?: number` și `lastError.passing?`.

### 7. Web (`AiSettings.tsx`)
- **Avertismentul:**
  - `show = !lastError.passing || (failures ?? 2) >= 2`;
  - pentru `passing`: „{product}: {message} (a {n}-a eroare la rând). Se reîncearcă automat la {fmtTime(pausedUntil)} | în curând; între timp, titlurile nescorate au scorul modelului local. Dacă se repetă, alege alt model din listă: unele răspund mai repede.”;
  - restul ca la FD-AIQUOTA.
- **Rândul de progres** (`text-[12px] text-muted`), când `progress.total > 0`: `progressText(product, progress, now)` din `components/ai-progress.ts`.
  - Textul: „Ultimele 48 h: {product} a scorat {scored} din {total} titluri; ultimul scor {fmtAgo(min(lastAt, now))}.”
  - Variante: „toate cele N”, „singurul titlu”, „nu a scorat încă singurul titlu”.
  - Acordul cu „de” e cel obișnuit (`tradesRo`).

### 8. Teste
- **`types.ts`:** `withinRo`, `passing`.
- **`http.ts`:** mesajul la timp depășit („Google nu a răspuns în 3 minute”).
- **Scorer:**
  - seria (1, 2, 4, 8, 15, 15 minute);
  - credit → 30 de minute, cu seria crescută;
  - un răspuns readuce seria la 0 și apelează `onState`;
  - `resume()`;
  - restaurarea seriei;
  - întreruperea nu crește seria;
  - jurnalul pentru un lot lent.
- **Serviciu:**
  - doi utilizatori în paralel: unul lent nu-l întârzie pe celălalt (cel rapid termină înainte ca cel lent să răspundă);
  - eroarea unuia nu oprește lotul celuilalt;
  - un lot pe rundă;
  - `aiProgress`.
- **Timpul cererii:** fără reîncercare când pauza ar trece de timp; a doua încercare are doar ce a rămas; Anthropic: timpul depășit e „Anthropic nu a răspuns în …”, oprirea apelantului rămâne oprire.
- **Job:** bugetul de timp (nicio rundă nouă după 5 minute).
- **Rută:** `progress` în `/api/ai/status`.
- **Web (`ai-progress.test.ts`):** variantele lui `progressText`.

## TD-EARNTV — implementează FD-EARNTV
### 1. `calendar/sources.ts`
- `TV_SCAN_URL = 'https://scanner.tradingview.com/america/scan'`.
- **`fetchTvEarnings(symbols)`:**
  - un singur POST (`httpRequest`, 20 s), cu `Origin` / `Referer` TradingView, ca la calendarul economic;
  - corpul: `{ filter: [{ left: 'name', operation: 'in_range', right: symbols }], columns: TV_EARN_COLUMNS, range: [0, 3 · n] }`;
  - simbolurile trimise sunt doar cele care arată ca acțiuni (`/^[A-Z][A-Z0-9]*(\.[A-Z0-9]+)?$/`); fără niciunul, nicio cerere;
  - un răspuns non-200 aruncă `HttpError`.
- **`parseTvEarnings(body)`** → `Map<symbol, TvEarnings>`, cu zod:
  - `{ data: [{ s, d: unknown[] }] }`, coloanele în ordinea `TV_EARN_COLUMNS`;
  - un rând de altă formă e sărit;
  - la același `name`: câștigă rândul cu tipul de publicare, apoi cel principal;
  - o dată care nu e un `Date` valid e null;
  - coloana `type` (ultima): dacă răspunsul are acțiuni (`stock` / `dr`), dar niciun rând nu are vreo dată (următoare sau ultima), se aruncă „TradingView: nicio dată de rezultate pentru N acțiuni (s-au schimbat coloanele?)”, pentru că o coloană necunoscută vine ca null, nu ca eroare.
- **`TvEarnings`:**
  - `next: { day, time, confirmed, quarter, eps } | null`, null fără zi;
  - `day` = ISO-ul UTC al lui `…next_trading_date_fq`;
  - `time`: −1 → `pre`, 1 → `after`, altfel `unknown`;
  - `confirmed` = tipul 11 / 12 / 13;
  - `quarter` = „Sep/2026” din `…next_calendar_date` (luna UTC);
  - `eps` număr finit sau null;
  - `lastDay` = ISO-ul UTC al lui `earnings_release_trading_date_fq`, sau null.

### 2. `calendar/service.ts`
- **`earningsEvent(day, row, from?)`:**
  - `from = { date?: 'tv', numbers?: 'tv' }`;
  - `period` = `time|quarter|date|numbers` (câmpurile goale pentru Nasdaq), deci evenimentele vechi (`time|quarter`) se citesc la fel.
- **`planEarnings(day, rows, wanted, tv)`** (pură), pentru o zi la care Nasdaq a răspuns. Pentru fiecare rând Nasdaq al unei acțiuni din favorite, cu `t = tv.get(symbol)`:
  - **păstrat**, dacă `t` lipsește;
  - **sărit**, dacă `t.next?.confirmed` și ziua nu e nici `t.next.day`, nici `t.lastDay`;
  - **sărit**, dacă `t.lastDay` < ziua < `t.lastDay + 45 de zile` și ziua nu e cea confirmată;
  - **altfel păstrat**: în ziua confirmată, ora TradingView când e `pre` / `after`, altfel cea Nasdaq, iar `date: 'tv'`.
  - Apoi, pentru fiecare acțiune din favorite cu `t.next.confirmed` și `t.next.day === day`, fără rând Nasdaq în ziua aceea, un eveniment numai TradingView:
    - `forecast` = `formatEps(eps)` („$0.13”, „-$0.09”);
    - `previous` null;
    - `name` = simbolul;
    - `from = { date: 'tv', numbers: 'tv' }`.
- **`refreshEarnings(symbols, fetchDay, now, fetchTv?)`:**
  - `fetchTv` se cheamă o dată, înaintea zilelor;
  - o eroare a lui duce la un `log.warn`, iar harta rămâne goală (doar Nasdaq);
  - zilele merg ca înainte, cu `planEarnings` în loc de filtrul simplu.
- **`query`:** nota după `period`:
  - `date === 'tv'` adaugă „Data e confirmată (TradingView).”;
  - `numbers === 'tv'` schimbă fraza Prognozei („…(TradingView); Nasdaq nu are încă rezultatele în calendar.”).

### 3. `jobs/register.ts`
- `refreshEarnings(symbols, (day) => nasdaq.earnings(day), undefined, (s) => fetchTvEarnings(s))`.

### 4. Teste
- **`parseTvEarnings`:**
  - codurile (10 / 11 / 12 / 13, −1 / 0 / 1);
  - zilele UTC, trimestrul, EPS null;
  - rânduri duble (cu date / principal);
  - rânduri stricate, corp care nu e JSON;
  - ETF fără date.
- **`fetchTvEarnings`:** corpul cererii (doar simbolurile de acțiuni), fără cerere fără simboluri, HTTP 403 → eroare.
- **`planEarnings`:**
  - SPCX doar la TradingView azi;
  - Nasdaq altă zi decât cea confirmată (sărit);
  - aceeași zi (ora TradingView, numerele Nasdaq);
  - estimare TradingView (Nasdaq neschimbat);
  - după publicare (ziua ultimei publicări păstrată, o dată Nasdaq la < 45 de zile sărită, una la ≥ 45 păstrată);
  - fără date TradingView;
  - confirmată fără oră (ora Nasdaq).
- **`refreshEarnings`:** TradingView căzut (doar Nasdaq, avertisment, fără eroare); ziua Nasdaq căzută (neatinsă); nota pentru cele trei feluri; evenimentele vechi `time|quarter`.

## TD-WATCHLISTS — implementează FD-WATCHLISTS
### 1. Baza (migrarea 9)
- **`watch_lists`:** `id` IDENTITY, `user_id` → `users` ON DELETE CASCADE, `name NVARCHAR(40)`, `position`, `created_at`; index `(user_id, position)`.
- **`watch_list_items`:** `list_id` → `watch_lists` ON DELETE CASCADE, `coin NVARCHAR(64)`, `position`, `added_at`, cheia `(list_id, coin)`.
- **Umplerea:** o listă „Favorite” pe fiecare utilizator cu rânduri în `watchlist`, cu rândurile lui în ordinea `position`.
- **`watchlist` rămâne registrul simbolurilor urmărite** (pereche, aliasuri, nume, bursă), adică reuniunea listelor. Toți cititorii de azi merg neschimbați: scanner, știri, calendar, feed-uri, detectorul, Rezumatul, Azi, banda.
- Nu există cheie străină `coin` → `watchlist`: ar face două căi de ștergere în cascadă de la `users`, pe care SQL Server le refuză. Legătura o ține serviciul.
- `TABLES` primește `watch_list_items` și `watch_lists`, înaintea lui `users`; `IDENTITY_TABLES` primește `watch_lists`.

### 2. `watchlists/service.ts` (`WatchlistService`)
Toate operațiile într-o tranzacție. Fiecare începe cu `reconcile(userId)`, care scrie doar când e nevoie:
- **utilizator fără liste:** „Favorite” cu rândurile din `watchlist`, în ordine; e cazul unui utilizator nou sau al seed-ului adminului;
- **rânduri din `watchlist` care nu sunt în nicio listă** (adăugate de o versiune veche): la sfârșitul primei liste;
- **elemente ale căror simboluri nu mai sunt în `watchlist`** (șterse de o versiune veche): scoase.

După orice schimbare, `syncUnion(userId)`:
- `watchlist.position` = ordinea primei apariții (listele după `position`, apoi elementele);
- rândurile din `watchlist` care nu mai sunt în nicio listă se șterg;
- întoarce simbolurile adăugate sau scoase din reuniune.

Metode:
- `view(userId)` → `{ lists: { id, name, coins[] }[], items: WatchItem[] }`;
- `create(name)`, `rename(id, name)`, `remove(id)` (refuzat la ultima listă), `orderLists(ids)`;
- `add(listId, body)`:
  - un simbol nou intră în registru (validat ca înainte), cu limita de 50 diferite;
  - unul deja în registru intră doar în listă, cu `note` dacă perechea cerută diferă;
  - unul deja în listă e un conflict;
- `orderItems(listId, coins)`;
- `copy(from, to, coins)`, `move(from, to, coins)`, `removeItems(listId, coins)` → `{ done, already, missing, gone }`, unde `gone` = simbolurile care au ieșit din reuniune.
- Limitele: `MAX_LISTS = 20`, `MAX_WATCHED = 50`; numele: tăiat la capete, 1–40 de caractere, unic fără deosebire de litere mari / mici; „Lista nu mai există” → `NotFoundError`.

### 3. Rute
- **Noi:**
  - `GET /api/watchlists`;
  - `POST /api/watchlists {name}`;
  - `PUT /api/watchlists/order {ids}`;
  - `PUT /api/watchlists/:id {name}`, `DELETE /api/watchlists/:id`;
  - `POST /api/watchlists/:id/items` (corpul de la `POST /api/watchlist`);
  - `PUT /api/watchlists/:id/items/order {coins}`;
  - `POST /api/watchlists/:id/items/copy | move {coins, to}`, `POST /api/watchlists/:id/items/delete {coins}`.
  Toate întorc `view` (plus `note` / numărătorile).
- **Cele vechi rămân, peste serviciu,** pentru o filă deschisă înainte de actualizare:
  - `POST /api/watchlist` → în prima listă;
  - `DELETE /api/watchlist/:coin` → din toate listele;
  - `PUT /api/watchlist/order` → ordinea primei liste;
  - `PUT /api/watchlist/:coin` (pereche, aliasuri) și `GET /api/watchlist` (reuniunea), neschimbate.
- **`afterWatchlistChange`** (detectorul, feed-urile, reetichetarea, nudge-urile) rulează doar când reuniunea s-a schimbat: un simbol nou (cu nudge-urile pentru acțiuni) sau `gone`.
  - Reetichetarea nu mai e așteptată: `ctx.retag` (`news/retag-queue.ts`) o rulează în fundal, câte o trecere; o cerere în timpul unei treceri cere încă una după ea; o eroare se notează în jurnal; `idle()` e pentru teste.
  - La fel la ștergerea unui utilizator.
- **`GET /api/symbols/profile?kind=crypto|stock|index&symbol=`** → `SymbolProfile`.
- **`POST /api/symbols/translate {kind, symbol}`** → `{ text }`, cu AI-ul utilizatorului; `ValidationError` fără cheie.

### 4. `market/profile.ts`
- **Acțiuni:**
  - Nasdaq `company-profile` dă descrierea, sectorul și industria; `data: null` înseamnă fără descriere.
  - TradingView (un POST, `name` exact) dă coloanele: `type`, `total_revenue_fq_h`, `gross_profit_fq_h`, `ebitda_fq_h`, `net_income_fq_h`, `earnings_per_share_diluted_fq_h`, `free_cash_flow_fq_h`, `fiscal_period_end_fq` și cele ale datei următoare (FD-EARNTV).
  - Trimestrul i (0 = cel mai nou, cel mult 4): `end` = `fiscal_period_end_fq` minus 3·i luni (ultima zi a lunii), valorile `x_h[i]`.
  - Comparația cu anul trecut: venituri `r[i] / r[i+4] − 1` (doar cu `r[i+4] > 0`); EPS `(e[i] − e[i+4]) / |e[i+4]|` (doar cu `e[i+4] ≠ 0`).
  - `type = fund` → `kind: 'fund'`, fără trimestre.
  - Tipul poate veni de la TradingView sau din registrul `watchlist`.
- **Crypto:**
  - CoinGecko `search?query=` → simbolul exact, cu cea mai bună poziție (fără poziție, la urmă);
  - apoi `coins/{id}` (fără piață / tickere): `description.en` (fără HTML și entități, tăiat la ~1.500 de caractere la sfârșit de frază), primele 5 categorii, `genesis_date`, primul `homepage`.
- **Indici:** `IndexInfo.description` (română), adăugat în catalog.
- **Cache în `market_cache`:**
  - `profile:<kind>:<symbol>`: 12 ore la acțiuni, 7 zile la crypto; un profil cu o parte eșuată nu se ține minte;
  - traducerile, sub `translate:ro:<sha256(text)[:32]>`, fără termen: comune tuturor, fiind un text public.

### 5. Traducerea și consumul
- `translateDescription(text)`, cu clientul utilizatorului: `{ text }`, `effort: 'low'`, 3.000 de tokeni, 60 de secunde.
- `AiUsage` primește felul `translate` (`AiUsageDay.translate`, zero la stările vechi).
- Rândul „Traduceri” apare în „Ce a consumat cheia ta azi”.

### 6. Setări
- `charts.listId: number | null` (null = prima listă).

### 7. Web
- **Hook-uri:**
  - `useWatchlists()` (`['watchlists']`);
  - mutațiile pun răspunsul în `['watchlists']` și reuniunea în `['watchlist']`, apoi reîmprospătează scanner-ul, știrile, sursele și calendarul, ca înainte.
- **`FavoritesDnd`** primește `onSave(coins)` în loc de ordinea reuniunii: `useReorderList(listId)`, salvări una după alta, ca înainte.
- **`components/AddSymbol.tsx`:** comutatorul, căutarea și indicii, mutate din Setări.
- **`components/SymbolInfo.tsx`:** popup-ul (`Modal`), cu traducerea cerută după profil, dacă există cheie și nu e deja tradus.
- **`pages/Watchlists.tsx`:** coloana listelor (sau câmpul de selecție pe telefon) și tabelul cu selecție.
  - Selecția e `Set` + ultima bifată. Shift + clic selectează intervalul, prin `selectRange` (testabil, în `watch-select.ts`).
- **`Watchlist.tsx` (Grafice):** `<select>` cu listele; `charts.listId` se salvează în setări.
- **`watch-guess.ts`:** starea pe care o va face o schimbare (`guessAdd`, `guessRemove`, `guessCopy`, `guessRename`, `guessDropList`, cu reuniunea recalculată), pusă imediat în cache.
  - Mutația `['watchlists', 'change']` are `scope`, deci pleacă în ordine.
  - Răspunsul se aplică doar dacă e ultima mutație în așteptare.
  - La eroare, mesajul și recitirea.
- **Bara selecției** e mereu acolo. **Mesajele** sunt în `Toast`, fix jos.
- **„+”** din antetul listelor deschide `NamePopover`; redenumirea pe ecrane late e în rând.
- **Indicii** sunt în lista derulantă a lui `AddSymbol`.
- **Panoul listei** are `px-5`, cât intră `table-bleed`.
- **Setări:** fără `WatchlistSection`.
- **Textele „favorite”** care însemnau reuniunea (FD §6).
- **Meniul:** `NAV` primește `/watchlists` după `/trades`.

### 8. Teste
- **Migrarea:** umplerea listelor pe o bază v8 cu favorite.
- **Serviciul:**
  - `reconcile` (fără liste, orfani, elemente fără registru);
  - CRUD și limite (50 diferite, 20 de liste, nume);
  - `add` (nou, deja urmărit cu altă pereche, deja în listă);
  - `copy` / `move` / `removeItems` (numărătorile, `gone`);
  - ordinea reuniunii; ultima listă; lista altcuiva (negăsită).
- **Rutele:** cele noi, cele vechi peste liste, `afterWatchlistChange` doar la schimbarea reuniunii, popup-ul și traducerea (fără cheie, din cache).
- **Profilul:**
  - trimestrele din coloanele TradingView (lunile, comparația cu anul trecut, mai puțin de 4, fond, lipsă);
  - CoinGecko (HTML, tăierea, ambiguitate);
  - Nasdaq fără date;
  - cache-ul (o parte eșuată nu se ține minte).
- **Web:** `selectRange`, formatul sumelor, textul de progres / ETF.


---

## TD-SLINGSHOT34 — implementează FD-SLINGSHOT34

### Fișiere
| Fișier | Schimbare |
|---|---|
| `Sling Shot System/sling-shot-system-3.4.pine` | **nou**: copia 3.3 + grupul „Signals” + mașina de stări SHORT + afișarea și alertele ei. `sling-shot-system.pine` (3.3) nu se atinge. |
| `src/shared/indicator/params.ts` | `SLINGSHOT_VERSION = '3.4'`; câmpuri noi `showLong` (true), `showShort` (false), `shortColor` (`#2196F3`); `.refine`: cel puțin unul dintre `showLong` / `showShort` |
| `src/shared/indicator/slingshot.ts` | portul 3.4, linie cu linie după fișierul Pine nou; `atrShort` lângă `atr` |
| `src/web/chart/slingshot-draw.ts` (nou, mutat din `CandleChart.tsx`) | `buildSegments` (liniile și etichetele TP/SL ale fiecărei părți) și `slingshotShapes` (triunghiurile LONG / SHORT / TAKE PROFIT); fără grafic, deci testabile |
| `src/web/chart/CandleChart.tsx` | le folosește |
| `src/web/pages/Charts.tsx` | grupul „Signals” în setări (cu ultima casetă blocată), alertele noi, tabelul de semnale cu partea, caseta TP/SL cu rândurile fiecărei părți; căsuțele formularului nu se mai strâng lângă o etichetă lungă (`shrink-0`) |
| `src/web/components/icons.tsx` | iconițele alertelor noi |
| `src/server/scanner/scanner.ts` | `ScanRow`: `lastSignal.side`, `entry` (fost `entryLow`), `liveShortSignal`, `waitingShortTP`, `atr.side`, `atrShort` |
| `src/web/pages/Today.tsx` | ultimul semnal cu partea, „SHORT în formare”, TP/SL ale fiecărei părți |
| `src/server/summary/context.ts` | partea semnalului și short-ul în formare, în contextul AI |
| `docs/slingshot-port.md` | sursa 3.4 și diferențele |

### Pine 3.4: ordinea pe bară
1. Seriile (neschimbate).
2. **Mașina LONG din 3.3.** Singura schimbare: `showLong and` la V1 candidat și la fixarea deal-ului. Fără ele, `bullDealIdx`, `bullV1Idx` și `bullTrendIntegrity` nu se setează niciodată, deci nicio altă ramură LONG nu rulează.
3. **Mașina SHORT**, pasul 2 inversat (variabile `bear*`):
   - **V1 candidat:** `showShort and isDowntrend and kLine >= stochOverbought and cloudTouchShortTol` → `bearCandidV1High := high`.
   - **Deal:** `showShort and isDowntrend and kLE20` (cu toleranță).
   - **Invalidare** la `not isDowntrend`.
   - **Start V2:** `kLine >= stochOverbought`, atinge norul, `bar_index > bearDealIdx`, `high < bearV1High`.
   - **Urmărire V2:** cât timp `kGE80`. Anulare dacă `high >= bearV1High`; altfel se reține maximul cel mai mare.
   - **Ieșirea din supracumpărare confirmă** dacă `bearV2BestHigh < bearV1High and isDowntrend`, exact ca LONG-ul. Atunci:
     - semnalele SHORT urmărite devin roșii (`superseded`);
     - apare eticheta SHORT și `waitingShortTP := true`;
     - se rețin `storedLowestLow` (`getLowestLow(lookback)`) și ATR-urile;
     - se declanșează alerta.

     Variabilele LONG nu se ating.
   - **Reset complet:** `not isDowntrend and not bearV2Search and not na(bearDealIdx)`. Semnalele SHORT urmărite devin roșii (`trendFlip`).
   - Gărzile 3.3 `if not waitingShortTP`, inversate.
4. **TP / ATR TP / SL / istoric LONG:** neschimbate.
5. **TP / ATR TP / SL / istoric SHORT**, inversate:
   - eticheta TAKE PROFIT short: `low < storedLowestLow`, sub lumânare, mutată la minimul cel mai jos;
   - ATR TP: `low <= storedLowestLow - storedShortTakeProfitAtr`;
   - SL: `high > activeShortSignalHigh + storedShortStopLossAtr`;
   - istoric: succes dacă `low < breakout` sau `low <= tp`, verificat primul; altfel roșu dacă `high >= sl`.
6. **Afișarea ATR, separat pe fiecare parte.**
   - **Blocul LONG** e cel din 3.3: tranzacția urmărită (dacă TP-ul nu e atins sau „hide on TP” e oprit), altfel setup-ul în formare. Garda „ascunde la SL” e și ea neschimbată.
   - **Blocul SHORT** e același, inversat, cu variabile proprii (`shortDisplayTP`, `shortDisplaySL`, `shortDisplayBar`, `shouldShowShort`).
   - **Desenarea:**
     1. se șterg desenele barei trecute: liniile și etichetele LONG, liniile și etichetele SHORT (`shortTPLine`, `shortTPLabel`, `shortSLLine`, `shortSLLabel`), apoi tabelul;
     2. se desenează LONG-ul, ca în 3.3;
     3. se desenează SHORT-ul. TAKE PROFIT e `label_up` sub linie, iar STOP LOSS e `label_down` deasupra.
   - **Ordinea creării etichetelor** e: TP LONG, SL LONG, TP SHORT, SL SHORT. Contează pentru limita de 500, iar portul o urmează.
   - **Tabelul** are 2 coloane și 2 sau 4 rânduri: rândurile LONG („TAKE PROFIT” / „STOP LOSS”), apoi cele SHORT („TAKE PROFIT (SHORT)” / „STOP LOSS (SHORT)”). Cu doar LONG, e tabelul 2 × 2 din 3.3.
7. Market Structure, ploturile: neschimbate.
8. Alertele noi: „Short Signal”, „Short Take Profit Signal”, „Short ATR Take Profit Hit”, „Short ATR Stop Loss Hit”. Cele 6 din 3.3 rămân, cu aceleași titluri.
9. `if not showLong and not showShort` → `runtime.error(...)`.

Etichetele SHORT folosesc `shortColor`, iar TAKE PROFIT short folosește `longTPColor`. Toate etichetele stau sub aceeași limită de 500 (`max_labels_count`), în ordinea creării, ca în port.

### Portul (`slingshot.ts`)
- **Tipuri:**
  - `AlertType`: plus cele 4 alerte short.
  - `SlingshotMarker.kind`: plus `short`, `shortPreview`, `shortTakeProfit`; `color` primește și `'short'`.
  - `SlingshotSignal`: `side: 'long' | 'short'`, iar `entryLow` se redenumește `entry` (minimul V2 la LONG, maximul V2 la SHORT; `sl` / `tp` / `breakout` sunt prețuri reale).
  - `AtrDisplay.side`. `SlingshotResult.atr` rămâne afișarea LONG (ca în 3.3), iar `atrShort` e afișarea SHORT; fiecare e `null` când partea ei nu arată nimic.
  - `last`: plus `waitingShortTP`, `shortTpHit`, `liveShortSignal`.
- `LabelRegistry`: tipurile noi de etichete; GC-ul comun rămâne.
- **Ordinea instrucțiunilor** urmează exact pașii 1–9 din Pine. Contează pentru GC-ul etichetelor și pentru ordinea alertelor pe aceeași bară.
- **Cu `showShort = false`**, bucla nu atinge nicio variabilă SHORT înafara condițiilor cu `showShort`. Rezultatul e identic cu 3.3; un test pe datele reale îl verifică (vezi Teste).

### Setările în Sentiq
- `slingshotParamsSchema.refine(p => p.showLong || p.showShort, { path: ['showShort'], message: 'Bifează cel puțin una dintre Long Signals și Short Signals.' })`.
  - Zod 4: `refine` pe un `z.object` rămâne `ZodObject`, deci `.prefault({})` din `settingsSchema` și `parse({})` funcționează.
  - Un PATCH cu amândouă `false` primește 400 cu mesajul.
- **Cheile necunoscute.** `z.object` elimină cheile pe care nu le știe. Un `shortCloseBelowCloud` salvat cu prima variantă 3.4, sau trimis de un client vechi, e ignorat; nu se ajunge la o eroare.
- **`IndicatorForm`:** câmpurile `bool` primesc opțional `lockedWhen(draft) → motiv | null`. Caseta e atunci dezactivată, cu motivul în `title`. Long e blocată când Short e debifat, și invers.
  - Mesajul de eroare din formular folosește `issue.message` pentru erorile `custom`; pentru celelalte rămâne lista de câmpuri.
- Setările salvate înainte primesc valorile implicite → doar Long → identic cu 3.3.

### Graficul
- **`slingshotShapes`:**
  - `short` / `shortPreview` → `position: 'above'` la maximul lumânării, text „SHORT”, culoarea `shortColor` (roșu dacă `color === 'sl'`);
  - `shortTakeProfit` → `'below'` la minim, „TAKE PROFIT”, `longTPColor`.
- **`buildSegments`:** desenează `r.atr`, apoi `r.atrShort`, fiecare cu liniile și etichetele lui. La `side === 'short'`, eticheta TP e `below`, iar SL e `above`.
- **`Charts`:**
  - `ALERT_RO` + 4;
  - `REASON_RO`: `takeProfitSignal` → „maximul depășit” (LONG) / „minimul depășit” (SHORT);
  - tabelul are coloana „Semnal (V2)” cu eticheta LONG / SHORT;
  - mesajul gol: „Niciun semnal în istoricul încărcat.”;
  - caseta TP/SL are rândurile `atr`, apoi rândurile `atrShort` cu sufixul „(SHORT)”. E poziționată `absolute` peste grafic, deci nu mută nimic din pagină;
  - titlul panoului folosește `SLINGSHOT_VERSION`.

### Scanner, Azi, AI
- **`summarize`:**
  - `lastSignal = { side, time, entry, sl, tp, outcome, provisional }`;
  - `liveSignal` rămâne LONG în formare; `liveShortSignal` e cel short;
  - `waitingShortTP`;
  - `atr: { side, tp, sl }` (LONG) și `atrShort: { side, tp, sl }` (SHORT).
  - Un client vechi citește în continuare `atr`, cu aceeași formă.
- **Azi:**
  - ultimul semnal: „LONG 19 oct., activ” / „SHORT 19 oct., TP atins”;
  - „SHORT în formare”;
  - câte un rând pentru fiecare parte afișată: „TP x SL y”, apoi „SHORT · TP x SL y”;
  - fără semnal: „fără semnal” (era „fără semnal LONG”).
- **AI:** `semnal LONG în formare`, `semnal SHORT în formare`, `ultimul semnal SHORT tp`.

### Teste
1. **Oglinda exactă.** Pe fixture-urile reale BTC 1h și 4h se compară două rulări:
   - `runSlingshot` cu `showLong:false, showShort:true`, pe lumânările reale;
   - `runSlingshot` cu Long, pe lumânările negate.

   Trebuie să fie identice:
   - semnalele (bare, confirmare, prețuri × −1, rezultat, motiv);
   - marcajele (tipuri inversate);
   - alertele LONG ↔ SHORT;
   - `atrShort` ↔ `atr` (× −1, partea);
   - `last`.

   Market Structure e exclusă, fiindcă nu e simetrică.
2. **3.4 doar Long = 3.3.** Pe BTC 1h și 4h, istoricul semnalelor, marcajele, alertele, `atr`, `ms` și `last` sunt identice cu fixture-ul generat cu portul 3.3 înaintea schimbării, `__fixtures__/btc-usdt.v3.3.json`. `entryLow` se compară ca `entry`; `atrShort` e `null`.
3. **Independența.**
   - Pe BTC 1h și 4h, cu ambele bifate: partea LONG (semnale, marcaje, alerte, `atr`, starea LONG din `last`) e identică cu Long singur. Partea SHORT e identică cu Short singur.
   - Un scenariu construit de mână: LONG confirmat → trend întors → SHORT confirmat. `waitingLongTP` rămâne true și alerta *ATR Stop Loss Hit* a LONG-ului vine la fel ca fără Short. `atr` și `atrShort` sunt afișate amândouă.
4. **Schema.** Amândouă `false` sunt respinse. Implicitele sunt Long da, Short nu. Cheia veche `shortCloseBelowCloud` e ignorată.
5. **Web** (`slingshot-draw.test.ts`):
   - etichetele TP/SL ale unui short (sub / deasupra) și ale unui long;
   - ambele părți afișate deodată;
   - triunghiurile și culorile lor;
   - marcajul din afara lumânărilor, ignorat.

   Textele din Azi sunt JSX și se verifică în Chrome (vezi mai jos).
6. **Server:** `summarize` cu un semnal short și `atrShort`.

### Verificare înafara testelor
- **Pe toate cele 192 de serii de backtest:**
  - oglinda (testul 1);
  - doar Long = portul 3.3 salvat în scratchpad înaintea schimbării;
  - independența (testul 3).
- **Pine:** codul SHORT se compară mecanic cu codul LONG. Fiecare linie LONG e transformată cu tabelul de inversare (`bull` → `bear`, `low` ↔ `high`, `<` ↔ `>`, …), iar rezultatul se compară cu liniile SHORT. Diferențele rămase trebuie să fie doar cele de afișare: culoarea, poziția etichetei, textul.
- **În Chrome**, pe serverul de test (desktop și telefon, cont cu tranzacționare activă):
  - graficul: etichetele SHORT, liniile, caseta TP/SL cu ambele părți;
  - setările: casetele blocate;
  - cardurile din Azi după o trecere a scanner-ului;
  - fără depășire pe lățime și fără deplasarea paginii.

## TD-SS34LIVE — implementează FD-SS34LIVE

### Pine 3.4 (`sling-shot-system-3.4.pine`)
**Inputs noi:**
- în grupul „Signals”: `longColor`, `longTpColor`, `shortColor` (există), `shortTpColor`, `failedColor`, `invalidColor`, `signalSizeOpt` (Tiny / Small / Normal / Large / Huge → `signalSize`);
- grupul nou „Cloud”: `cloudUpColor`, `cloudDownColor`.

**Funcții:**
- `fade(c, k) => color.new(c, 100 - (100 - color.t(c)) * k)`: opacitatea culorii înmulțită cu `k`. La o culoare opacă, e exact `color.new(c, 100 - 100k)` din 3.3.
- `showValid(lbl, c, up)`: triunghiul părții, în culoarea ei.
- `showInvalid(lbl)`: `label.style_xcross`, în `invalidColor`.
- `showFailed(lbl)`: `failedColor`; forma rămâne.

**Unde se folosesc:**
- etichetele LONG (confirmate și în formare): `longColor`, `size = signalSize`;
- TAKE PROFIT LONG: `longTpColor`. La SHORT: `shortColor` și `shortTpColor`;
- semnalele active înlocuite la confirmarea unuia nou, și cele invalidate la întoarcerea trendului: `showInvalid`, în locul culorii `longSLColor`;
- istoricul:
  - eșec → `showFailed`;
  - succes → `showValid` (poate fi X dacă un semnal nou era în formare).

**Invalidarea live**, imediat după resetul complet LONG, la fiecare bară:
```pine
for lbl in activeSignalLabels
    if bullV2Search
        showInvalid(lbl)
    else
        showValid(lbl, longColor, true)
```
- La SHORT e la fel, după resetul complet SHORT, cu `bearV2Search` și `activeShortLabels`.
- `bullV2Search` e adevărat la sfârșitul barei exact cât timp eticheta în formare e pe grafic: e creată la start și ștearsă la orice oprire a căutării.
- Pe bara confirmării, semnalele vechi au ieșit deja din listă, invalidate.

**Desenele:**
- **Norul:**
  - EMA-urile: `isUptrend ? cloudUpColor : cloudDownColor`;
  - umplerea: `fade(…, 0.5)`.
- **Liniile ATR:** `longTPColor` / `longSLColor` direct (în 3.3 era `color.new(c, 0)`, deci la culori opace e la fel). Fundalul etichetelor ATR: `fade(c, 0.2)`.
- **Market Structure:** fundalul etichetelor e `fade(c, 0.15)`.

### Portul (`slingshot.ts`)
**`LabelColor`** devine aspectul etichetei: `'signal' | 'failed' | 'invalid'`. La TAKE PROFIT e mereu `'signal'`.
- **Desenarea:** X dacă e `'invalid'`, altfel triunghi.
- **`SlingshotMarker.color`** are aceleași valori.

**Ordinea pe bară** urmează Pine:
- invalidarea live vine după resetul complet al fiecărei părți: `labels.setColor(lbl, bullV2Search ? 'invalid' : 'signal')`;
- istoricul: succes → `'signal'`, eșec → `'failed'`;
- înlocuirea și întoarcerea trendului → `'invalid'`.

Semnalele (`SlingshotSignal.outcome`), alertele, TP/SL și `last` nu se schimbă.

### Setările (`params.ts`)
- **Câmpuri noi:** `longColor`, `longTpColor`, `shortTpColor`, `failedColor`, `invalidColor`, `signalSize` (enum), `cloudUpColor`, `cloudDownColor`.
- **`hex`** acceptă `#RRGGBB` și `#RRGGBBAA`.

### Desenarea
**`slingshot-draw.ts` → `slingshotShapes`:**
- culoarea după tip și aspect;
- `shape: 'x'` la `'invalid'`;
- mărimea din `SIGNAL_SIZES[p.signalSize]`.

`SIGNAL_SIZES` (px CSS):

| Mărime | Lățime | Înălțime | Text |
|---|---|---|---|
| Tiny | 14 | 11 | 9 |
| Small | 24 | 18 | 11 |
| Normal | 32 | 24 | 13 |
| Large | 44 | 33 | 16 |
| Huge | 60 | 45 | 20 |

**`primitives.ts`:**
- **`ShapeLabel`:** primește `shape` și `size`.
- **Renderer-ul:**
  - desenează triunghiul cu lățimea și înălțimea date;
  - sau un X de lățimea triunghiului, cu linii groase (`max(2, w / 6)`) și capete rotunde;
  - textul stă la distanța formei.
- **`hexA(c, k)` devine `fade(c, k)`:**
  - citește `#RRGGBB(AA)` și `rgba()`;
  - înmulțește opacitatea;
  - îl folosesc norul (0,5) și fundalul etichetelor de pe linii (0,18).

**`CandleChart`:** EMA-urile și norul folosesc `cloudUpColor` / `cloudDownColor`.

**`Charts`:**
- grupurile „Signals” (culorile, „Signal Size”) și „Cloud”;
- tabelul de semnale: un semnal `active` al părții care are acum un semnal în formare (`last.liveSignal` / `last.liveShortSignal`) apare „invalidat (semnal nou în formare)”.

### Teste
- **Invalidarea live:** activ → în formare (X) → căutare anulată (din nou valid) → în formare din nou (X) → confirmat (X definitiv).
- **Succesul** în timp ce un semnal nou e în formare: valid. **Eșecul**: `'failed'`.
- **Independența părților:** marcajele fiecărei părți, cu aspectul lor, sunt aceleași cu ambele bifate ca atunci când partea e singură. Testul o verifică pe BTC 1h / 4h, iar verificarea pe 192 de serii. Scenariul SHORT e cel LONG întors.
- **3.3** (fixture-ul): semnalele, alertele, TP/SL și `last` sunt identice. Marcajele au aceleași bare și tipuri. Culoarea `'tp'` din 3.3 devine `'signal'`, iar `'sl'` devine `'failed'` sau `'invalid'`, după rezultatul semnalului.
- **Oglinda** (graficul întors) și **independența** pe datele reale: rămân.
- **Web:**
  - `slingshotShapes`: culorile fiecărui tip, X-ul și mărimile;
  - `fade` cu `#RRGGBBAA`.

## TD-OPACITY — implementează FD-OPACITY

### Culori (`src/web/color.ts`, nou)
- **`parseColor(css)`:**
  - întoarce `{ hex: '#RRGGBB', alpha: 0..255 }`;
  - citește `#RGB(A)`, `#RRGGBB(AA)` și `rgb()` / `rgba()`;
  - mutat din `StudySettings.hexOf`.
- **`formatColor(hex, alpha)`:** `#RRGGBB` la 255, altfel `#RRGGBBAA`, cu majuscule.
- **`fade(css, k)`:** `rgba(r, g, b, a·k)`.

### `ColorPicker` (`src/web/components/ColorPicker.tsx`, nou)
- **Butonul:** 48 × 32 px, `aria-label` de la apelant. Arată culoarea peste carouri (`linear-gradient`), iar titlul e „#RRGGBB · 74 %”.
- **Panoul:**
  - `createPortal` în `document.body`, `position: fixed`, `z-50`;
  - așezat sub buton, aliniat la dreapta lui. Dacă nu încape, deasupra; mereu cu 8 px față de marginile ferestrei;
  - conține `input type=color`, câmpul hex (validat: `#RRGGBB`), glisorul `range` 0–100 și valoarea „74 %”.
- **Închiderea:**
  - `pointerdown` în afara panoului și a butonului (capture);
  - Esc, ascultat pe `window` în capture, cu `preventDefault`: fereastra de setări vede tasta folosită și rămâne deschisă; focusul revine pe buton;
  - focusul mutat cu Tab pe un element din afara panoului (`relatedTarget`). Fereastra de culoare a browserului nu dă focusul unui element, deci nu-l închide;
  - butonul ieșit din ecran.
- **Poziția:** la `scroll` în afara panoului (capture) și la `resize` (tastatura telefonului), panoul se reașază lângă buton, cu `requestAnimationFrame`.
- **Focusul:** la deschidere, focusul trece pe glisor.
- Fiecare schimbare cheamă `onChange(formatColor(…))`.

### Unde se folosește
- `Charts.IndicatorForm`: câmpul `color` (Slingshot, LMA);
- `StudySettings`: `ColorField` (Intrări, Stil, palete, linii orizontale);
- `HLineSettings`: `Color`.

### Scheme
- **`params.ts` și `lma-params.ts`:** `hex` acceptă `#RRGGBBAA`.
- **`lma.ts → hexToRgba`:** citește și alfa (`a` = AA, implicit 255). Semantica Pine rămâne:
  - `color.new` înlocuiește alfa;
  - `from_gradient` amestecă alfa.
- **`studies.ts`:** acceptă deja `#RRGGBBAA`.

### Teste
- **`color.ts`:** citiri și formatări, inclusiv `rgba(…, 0.5)` → `#RRGGBB80`; `fade`.
- **Schemele:** `#RRGGBBAA` acceptat la Slingshot și LMA.
- **`lma.ts`:** `hexToRgba('#00FFAA80').a === 128`.
- **Chrome:**
  - panoul deschis la 1440 / 390 / 320, în ecran, fără să mute pagina;
  - Esc nu închide fereastra de setări;
  - culoarea și opacitatea salvate apar pe grafic.

## TD-SSSL — implementează FD-SSSL

### Pine 3.4
- **Inputs noi** în „Signals”, după `shortTpColor`:
  - `longSlColor = input.color(color.red, "Long Stop Loss Color")`;
  - `shortSlColor = input.color(color.red, "Short Stop Loss Color")`.
- **Ramura de eșec a istoricului LONG**, după `showFailed(lbl)`:
  `label.new(bar_index, low, "STOP LOSS", style=label.style_triangleup, yloc=yloc.belowbar, color=longSlColor, textcolor=longSlColor, size=signalSize)`.
- **La SHORT:** `high`, `label.style_triangledown`, `yloc.abovebar`, `shortSlColor`.
- **Ordinea:** etichetele se creează în bucla istoricului, după eticheta TAKE PROFIT a barei. Portul o urmează.

### Portul
- **Tipuri noi de etichetă:** `LabelKind` și `SlingshotMarker.kind` primesc `stopLoss` și `shortStopLoss`.
- **Crearea:** `labels.create(i, 'stopLoss', 'signal')` în ramura de eșec, după `setColor(lbl, 'failed')`. La SHORT e la fel.
- **`params.ts`:** `longSlColor`, `shortSlColor` (`#FF5252`).

### Graficul
- `slingshotShapes`:
  - `stopLoss` stă sub lumânare, `shortStopLoss` deasupra;
  - textul e „STOP LOSS”;
  - culorile sunt `longSlColor` / `shortSlColor`.
- `Charts`: cele două culori în grupul „Signals”.

### Teste
- **Scenariul de eșec:** eticheta STOP LOSS pe bara eșecului, la LONG și la SHORT.
- **Eșec în timpul unei invalidări live:** `failed` plus STOP LOSS.
- **3.3:** marcajele în afară de `stopLoss` sunt aceleași; iar fiecare eșec are exact o etichetă `stopLoss`, pe bara `closedBar` a semnalului.
- **Desenarea:** poziția, textul și culorile.

## TD-SSLIVEBOX — implementează FD-SSLIVEBOX

### Pine 3.4 (afișarea ATR)
**LONG:**
```pine
if liveSignalActive
    [h, b] = getHighestHigh(lookback)
    displayTP := h + takeProfitAtrValue
    displaySL := liveSignalLow - stopLossAtrValue
    displayBar := liveSignalBar
    shouldShow := true
else if waitingLongTP
    if (not hideAtrOnTP or not tpHit)
        … (ca în 3.3)
```
La SHORT e la fel, cu `liveShortActive` înaintea `waitingShortTP`. Garda „ascunde la SL” rămâne după.

### Portul
Aceeași ordine în cele două blocuri de afișare. `result.atr` / `atrShort` și scanner-ul urmează automat.

### Teste
- **Semnal urmărit + unul în formare:** `atr` are nivelurile celui în formare.
- **După anulare:** din nou ale celui urmărit.
- **După confirmare:** ale celui nou.
- **TP atins cu „hide on TP”:** apare cel în formare.
- **Datele reale:** oglinda și independența rămân. Comparația cu 3.3 exclude `atr` doar când e un semnal în formare la ultima bară.

## TD-FILLS — implementează FD-FILLS

### Cheile umplerilor (`src/web/indicators/style.ts`)
- **`styleFills(mod, result)`** întoarce `{ key, title, plot1, plot2, color?, editable }[]`:
  - **umplerile declarate:** din `mod.fillConfig` (`editable !== false`), cu cheia `id`; culoarea e `color`;
  - **umplerile desenate:** din `result.fills`, cu cheia `fillKeyOf`; culoarea e `options.color` cu transparența `options.transp` inclusă (`#RRGGBBAA`);
  - **deduplicarea** se face după cheie.
- **Culoare editabilă:** doar fără `colors` și fără `gradient`.
- **`fillKeyOf(fills)`** întoarce cheile, în ordine:
  - `id` dacă există;
  - altfel `f_` + titlul curățat (`[^A-Za-z0-9_]` → `_`, cel mult 60 de caractere);
  - altfel `f_<plot1>_<plot2>`;
  - la a doua apariție a aceleiași chei se adaugă `_2`, `_3`.

  Aceeași funcție e folosită și la afișare, și la desenare.
- **Titlul:** al umplerii; altfel „<titlul liniei 1> – <titlul liniei 2>” (din `plotConfig` / `hlineConfig`).

### Aplicarea (`styledEntry`)
- **`study.fills[key].visible === false`:** umplerea iese din `fillConfig` și din `result.fills`.
- **`color`**, la o umplere cu o singură culoare:
  - la `fillConfig`: `color`;
  - la `result.fills`: `options.color = c`, fără `options.transp`.

  Culoarea aleasă e cea finală, cu opacitatea ei.
- **Umplerile liniilor ascunse** ies, ca până acum.

### Schema și memoria
- **`studies.ts`:**
  - `studyFillStyleSchema = { visible?, color? }` (strict);
  - `studySchema.fills = keyed(…, 40)`;
  - `studyMemoryEntrySchema` include `fills`.
- **`memory.ts`:** păstrează `fills`.

### Interfața
- **`Charts`** trimite către `SettingsDrawer` → `StudySettings` rezultatul curent al studiului (`studyStates.get(uid)?.result`).
- **`StudySettings`:**
  - secțiunea „Umpleri”, după liniile orizontale;
  - fiecare rând are bifa, titlul și `ColorField` (doar pentru o culoare editabilă);
  - draft-ul, cheia de resetare, salvarea (`clean`) și „Valorile implicite” includ `fills`.

### Teste
- **`style.test.ts`:**
  - cheile: id, titlu, perechea și duplicatele numerotate;
  - transparența inclusă în culoarea afișată;
  - o umplere ascunsă iese din ambele liste;
  - culoarea aleasă înlocuiește `options.color` și scoate `transp`;
  - o umplere cu gradient nu se recolorează.
- **`studies.test` / `memory.test`:** `fills` acceptat, validat, ținut minte.
- **Chrome:**
  - Bollinger: fundalul ascuns și apoi recolorat;
  - RSI: banda 70 / 30;
  - la 1440 / 390.

## TD-ORDEREDIT — implementează FD-ORDEREDIT

### Model (`src/shared/trading.ts`)
```ts
/** One change: a position's protection (an existing SL / TP order, or a new one), or an open order. */
type ModifyChange =
  | { what: 'sl' | 'tp'; orderId: string | null; level: number | null }   // orderId null: add; level null: remove
  | { what: 'order'; orderId: string; trigger: boolean; price?: number; triggerPrice?: number; amount?: number;
      takeProfit?: number | null; stopLoss?: number | null };
modifyTicketSchema = {
  accountId, idemKey, market, symbol,
  position?: { side: 'long' | 'short'; ref?: string },   // ref: the eToro position id
  changes: ModifyChange[] (1–4),
}
// Refuzat: un SL / TP fără poziție, o adăugare fără nivel, aceeași valoare a aceluiași ordin de două ori (SL-ul și TP-ul
// unui `oco` OKX pot fi schimbate împreună), un ordin schimbat și, în același timp, ca SL / TP; mai mult de un SL și un TP noi.
interface ModifyStepPlan { change: number; how: 'amend' | 'position' | 'place' | 'cancel' | 'place-then-cancel' | 'cancel-then-place';
  before: {...}; after: {...}; orderId: string | null }
interface ModifyPreview { ticket; displaySymbol; last; steps: ModifyStepPlan[]; warnings; errors; env; currency }
interface ModifyResult { status: 'done' | 'partial' | 'failed' | 'unknown'; steps: { change: number; what: string; ok: boolean; orderId: string | null; message: string | null }[] }
```
- **`OrderRow`** primește:
  - `stopLoss` / `takeProfit`: atașate, din `o.stopLossPrice` / `o.takeProfitPrice`;
  - `contractSize`: monede pe contract (PnL-ul unui ordin fără poziție).
- **Cum se poate schimba un ordin** nu e un câmp al rândului: pagina îl află cu `orderEditMode(exchange, row)` (shared), aceeași funcție pe care o folosește serverul.
- **`PositionRow`:** neschimbat. SL / TP-ul ei sunt ordinele cu rolul `sl` / `tp` (`roleOf`) sau rândurile eToro `sl-<id>` / `tp-<id>`.

### Citirea (`accounts.ts`)
- **OKX:** în plus `{ method: 'privateGetTradeOrdersAlgoPending', ordType: 'conditional,oco' }`. Fără `method`, ccxt trimite tipul combinat la alt endpoint.
- **Bitget:** în plus `{ type: 'swap', productType: 'USDT-FUTURES', planType: 'profit_loss' }`.
- **Câmpurile noi:** `stopLoss` / `takeProfit` pe fiecare ordin.
- **`orderEditMode(exchange, row)`**, după tabelul din FD:
  - rândurile eToro `sl-` / `tp-` (`cancellable: false`) primesc `'amend'`, ordinele eToro în așteptare `null`;
  - IBKR primește `null`.
- **`pnl.ts → roleOf` / `pnlLines`:** un ordin fără `triggerPrice`, dar cu `stopLoss` / `takeProfit` (OKX `conditional` / `oco`, TP / SL Bybit / Bitget), dă câte o linie pentru fiecare nivel, legată de ordin.

### Traderii (`Trader.modify`)
- **Interfața:** `Trader` primește:
  - `normalizeModify(ticket) → ModifyPlan` (`{ preview, internal }`: ce a citit traderul — ordinele, poziția — rămâne pe server);
  - `modify(plan) → ModifyResult`.
- **Ordinul real:** fiecare trader citește ordinul țintă din nou, pe simbol (cu listările de declanșare ale platformei), și refuză („NOT_FOUND”) un ordin care nu mai e deschis.

**`CcxtTrader`:**
- **Rotunjirea:** `priceToPrecision` / `amountToPrecision`; prețul de acum vine din `fetchTicker`.
- **Bybit:**
  - **Ordin:** `editOrder(id, symbol, type, side, amount, price, { triggerPrice, takeProfit, stopLoss })` → `/v5/order/amend`.
  - **SL / TP de poziție:**
    - `privatePostV5PositionTradingStop({ category: 'linear', symbol, tpslMode: 'Full', positionIdx, stopLoss | takeProfit })`;
    - valoarea `'0'` șterge;
    - se folosește când rândul are `info.stopOrderType` ∈ {`StopLoss`, `TakeProfit`}, sau la adăugare;
    - alte ordine condiționale reduce-only: `amend` cu `triggerPrice`.
- **OKX:**
  - **Ordin normal:** `privatePostTradeAmendOrder({ instId, ordId, newPx?, newSz?, attachAlgoOrds?: [{ attachAlgoId, newTpTriggerPx, newTpOrdPx: '-1', newSlTriggerPx, newSlOrdPx: '-1' }] })`.
  - **Ordin algo:** `privatePostTradeAmendAlgos({ instId, algoId, newSz?, newTriggerPx?, newOrdPx?, newTpTriggerPx?, newTpOrdPx?, newSlTriggerPx?, newSlOrdPx? })`. `'0'` șterge un TP / SL; un `conditional` cu un singur nivel, șters, se anulează.
  - **Adăugare:** `createOrder(symbol, 'market', closing, amount, undefined, { stopLossPrice | takeProfitPrice, reduceOnly: true, hedged? })`.
- **Binance:**
  - **Futures, limită:** `editOrder(id, symbol, 'limit', side, amount, price)`.
  - **Spot:** `editOrder` (`cancelReplace`, atomic).
  - **Stop-urile futures:** înlocuire.
- **Kraken:** `editOrder(id, symbol, type, side, amount, price, { triggerPrice })` (amend).
- **Coinbase:** limită GTC → `editOrder(id, symbol, 'limit', side, amount, price)`; restul → înlocuire.
- **KuCoin, Bitget și stop-urile Binance:** înlocuire, cu metodele existente:
  - plasarea: aceleași parametri ca `place` (hedge, marja poziției, `reduceOnly`, direcția stop-ului `stopParams`);
  - anularea: `cancel` (`trigger` / KuCoin `stop`).
- **Ordinea înlocuirii:**
  - `place-then-cancel` pentru un ordin futures care doar închide (`reduceOnly`, sau SL / TP de poziție), cu declanșare sau limită;
  - `cancel-then-place` pentru restul.
- **Ce copiază ordinul nou:** tipul (limită / la piață), partea, cantitatea (sau cea nouă) și declanșarea / prețul (cele noi), cu marja ordinului (altfel a poziției). TP / SL atașate le ia din ordinul citit, unde se citesc, sau din formular.
- **Direcția declanșării se păstrează:** fiecare pas o ține (`dir`): KuCoin o spune (`stop`), altfel din locul declanșării față de prețul de acum (un ordin nedeclanșat așteaptă deasupra o urcare, dedesubt o coborâre); un SL / TP de poziție după rol.
  - un ordin futures care doar închide pleacă drept SL / TP-ul care este (`stopLossPrice` / `takeProfitPrice`), un TP limită rămâne limită;
  - restul, ca stop în aceeași direcție (`stopParams(…, dir)`); unde platforma nu o poate numi (o cumpărare la coborâre pe futures, stop-urile spot în afara KuCoin / Coinbase), înlocuirea e refuzată la verificare, înainte de orice anulare.
- **Verificări în plus:** o declanșare mutată de cealaltă parte a prețului e refuzată (s-ar executa imediat); un SL / TP de poziție trebuie să închidă poziția și să se declanșeze ca acel nivel; un ordin care doar închide nu primește TP / SL atașate; un ordin negăsit când o listă n-a putut fi citită e spus ca atare.

**`EtoroTrader`:**
- `sl-<id>` / `tp-<id>` și adăugarea (`position.ref`) → `PATCH /api/v2/trading/{demo/}positions/{id}`, cu body-ul:
  - `{ stopLossRate }`, `{ takeProfitRate }`;
  - `{ clearStopLoss: true }`, `{ clearTakeProfit: true }`.
- Răspunsul 202 înseamnă „acceptat”, deci starea e `sent`.
- Ordinele în așteptare nu se modifică de aici (verificarea o spune: „anulează-l și pune altul”).

**`AlpacaTrader`:** `PATCH /v2/orders/{id}` cu `limit_price` / `stop_price` / `qty` (cele schimbate). Ordinul nou are alt id.

**`Trading212Trader`:** înlocuire (`DELETE /equity/orders/{id}`, apoi plasarea cu tipul ordinului citit).

### Serviciul și rutele
- **`TradingService.previewModify` / `modify`:**
  - aceleași verificări ca `place` (`access` cu piața, `throttle`);
  - jurnalul `action: 'modify'`, cu cheia formularului (a doua trimitere dă primul rezultat);
  - `detail` = planul și rezultatul fiecărui pas;
  - starea jurnalului: `sent` (toți pașii OK), `error` (niciunul), `unknown` (pas incert), `rejected` (verificarea).
- **Rutele:**
  - `POST /api/trading/:id/modify/preview`;
  - `POST /api/trading/:id/modify`.

  Corpul e validat cu `modifyTicketSchema`, iar contul trebuie să fie al utilizatorului.
- **`TradeLogRow.action`** primește `'modify'` („Modificare” în jurnal).

### Impactul pe PnL (`src/web/chart/pnl.ts`)
- **`pnlAtLevel({ long, entry, qty, quote }, level) → { pnl, pct, text }`:** aceeași formulă ca liniile de acum.
- **`pnlImpact(basis, before, after, wasBasis = basis)`:** „−42,10 USDT (−1,6%) · înainte −56,00 USDT (−2,1%) · +13,90 USDT”; fără `before` (nivel nou) doar PnL-ul; fără `after` (șters) „fără nivel (era …)”. `wasBasis`: ordinul de dinainte, când i se schimbă și cantitatea.
- **`tradeLinesOf`:** linia de intrare primește `basis` (toată poziția), liniile SL / TP / ordin primesc `label` (titlul fără PnL, pentru titlul la alt nivel).
- **eToro:** rândurile `sl-<id>` / `tp-<id>` aparțin doar poziției `<id>` (`roleOf`): două poziții pe același instrument au fiecare doar liniile ei.
- **Un ordin de perpetual** (`BTC/USDT:USDT`) e futures oriunde e listat (contul unificat KuCoin îl dă cu cele spot): e SL / TP-ul poziției.

### Interfața
- **`src/web/components/modify-seeds.ts`** (pur, testat):
  - `positionSeed(account, portfolio, pos)`, `holdingSeed(account, portfolio, balance)`: rândurile SL / TP (din `tradeLinesOf`, cu ce închide fiecare), `basis` pentru unul nou, `add` (se poate adăuga: futures crypto și eToro);
  - `orderSeed(account, portfolio, order)`: un ordin care închide o poziție (PnL-ul la nivelul lui), unul de intrare (ce deschide), rândurile eToro `sl-` / `tp-` (formularul poziției lor);
  - `stepImpact(step, context)`: PnL-ul unui pas planificat, din valorile serverului (rotunjite); același în formular și pe grafic.
- **`src/web/components/ModifyTicket.tsx`:**
  - formular (nivelurile cu „Șterge”, sau câmpurile ordinului după `orderEditFields`) cu impactul sub fiecare câmp → **Verifică** (`/modify/preview`) → confirmarea (`ModifyConfirm`: vechi → nou, cum pleacă, PnL, avertismente, erori, DEMO) → **Confirmă și trimite** (`/modify`, cu tichetul întors de verificare) → rezultatul fiecărui pas (`ModifyOutcome`);
  - `useModifySend(accountId)`: cheia pe versiunea schimbărilor; `fresh()` o uită după o trimitere (aceleași schimbări făcute din nou sunt o acțiune nouă); refuzul PERMISSION / DISABLED recitește conturile.
- **`Trades.tsx`:**
  - poziții: **SL / TP** lângă „Închide”; dețineri: **SL / TP** (eToro cu o singură poziție; crypto spot când are deja ordine SL / TP);
  - ordine: **Modifică** lângă „Anulează”, când `orderSeed` dă ceva.
- **Graficul:**
  - `useTradeLines` (înlocuiește `usePositionLines`): liniile `tradeLinesOf` ale fiecărui cont, cu contul lor;
  - `src/web/chart/trade-drafts.ts` (pur, testat): `isDraggable`, `withDrafts` (linia trasă punctată, cu PnL-ul la noul nivel; TP / SL-ul unui ordin urmează prețul nou al ordinului), `liveDrafts` (o linie dispărută își ia schița), `draftGroups`, `anchorOf` (intrarea poziției sau linia ordinului), `draftTicket` (schimbările unui grup);
  - **`CandleChart`:** `PriceLineSpec` primește `id` și `draggable`; props noi `onDragLine(id, price)`, `dragTitle(id, price)`, `lineOverlays` (`{ key, price, node }`);
    - liniile care se trag rămân price lines (ținute după id), o tragere le mută pe loc (`applyOptions`); primitiva `DragTargets` (fără desen) prinde pointerul și dă cursorul ↕;
    - mouse: direct; deget: o atingere selectează linia (grosime 2), apoi se trage; atingerile acelui deget nu mai ajung la grafic (oprite în captură pe gazdă); o atingere în altă parte deselectează;
    - o linie care e trasă rămâne sub deget și când liniile se redesenează (PnL-ul de acum se schimbă cu fiecare preț);
    - `lineOverlays`: HTML la y-ul prețului, urmărit cadru cu cadru cât există, la stânga panoului (titlul liniei e la dreapta), ținut în panou;
  - **`TradeDraftBar`:** Confirmă (verificarea; erorile lângă butoane, liniile rămân trase; avertismentele → fereastra de confirmare, pe `document.body`; altfel trimiterea) și Renunță; o linie trasă din nou cât durează verificarea anulează trimiterea (pleacă doar nivelurile arătate); pe telefon doar iconițele (✓ / ✕), ca bara să lase liberă linia de lângă intrare;
  - rezultatul: `Toast` (mutat în `ui.tsx`, folosit și de Liste).

### Alinierea
- antetul graficului: numele sursei e `self-center leading-6`, ca variația pe 24 h de lângă el;
- tabelul pozițiilor: legătura simbolului și „isolated” într-un `inline-flex items-center`.

### Siguranța codului
- Testul de securitate (`server.test`): `editOrder` și `PATCH` doar în `src/server/exchange/trading/` (TD-TRADING §7, actualizat); retragerile, transferurile, `cancelAllOrders` și `closeAllPositions` nicăieri.

### Teste
- **`trading.test`:** schema (inclusiv SL + TP ale aceluiași `oco`, limita de 4) și `orderEditMode` / `orderEditFields`.
- **`modify.test`** (client ccxt fals) și **`crypto.test`** (ccxt real, cereri înregistrate): KuCoin `place-then-cancel` / `cancel-then-place` și eșecurile, Binance, Bybit `trading-stop` și amend, OKX amend-algos / amend-order și citirea din algo pending, copia unui stop spot KuCoin.
- **`brokers.test`:** eToro `PATCH`, Alpaca `PATCH`, Trading 212 anulare apoi plasare.
- **`service.test`:** jurnalul `modify`, cheia formularului, accesul.
- **`server.test`:** citirile OKX / Bitget.
- **`pnl.test`, `modify-seeds.test`, `trade-drafts.test`:** liniile, rândurile formularelor, impactul pașilor, ce se trage, schițele și tichetele lor (inclusiv eToro).
- **Chrome** (serverul de test cu KuCoin și eToro simulate, `createOrder` / `cancelOrder` / `PATCH` înregistrate), la 1440 / 390 / 320: formularele și confirmările din Tranzacții; pe grafic cursorul, tragerea, eroarea lângă butoane, Renunță, trimiterea (ordinul nou, apoi anularea celui vechi), confirmarea cu avertismente a unui ordin; telefonul cu atingeri; nimic nu mută pagina; alinierea măsurată.

## TD-TRADEUI — implementează FD-TRADEUI

### Casetele (`src/web/chart/trade-labels.ts`, pur, testat)
- **Culorile:** `TRADE_COLORS` / `TRADE_COLORS_LIGHT` (long, short, tp, sl, buy, sell, liquidation, up, down).
- **Conținutul și geometria:**
  - `TradeLabelSpec`: `{ qty, text, textColor, close, fill }`;
  - `labelGeometry(spec, plotWidth, measure)`: celulele (cantitate, text, × de 20 px) și `x`, cu marginea dreaptă la `plotWidth − 64` (minimum 4 px de la stânga);
  - `labelPartAt(g, x)`: `'body' | 'close' | null`.
- **Textul și culoarea liniei:**
  - `labelText(line, price, last, entry?)`: PnL-ul doar în bani (intrarea, la `last`), felul ordinului, „Lichidare”;
  - `orderText(o)`, `lineColor(line, palette)`, `lineQty(line)`.
- **`chartLineOf(line, opts)`:** `PriceLineSpec`-ul liniei, cu titlul gol, stilul (continuu; ordin întrerupt; lichidare și schiță punctate) și `label`.

### Graficul
- **`PriceLineSpec.label`:** când există, biblioteca desenează linia și prețul pe scală (`title: ''`), iar caseta e a primitivei.
- **`TradeLabels`** (în `primitives.ts`, înlocuiește `DragTargets`):
  - **Desenul:** pe fiecare linie cu casetă, în spațiul bitmap (Retina), peste lumânări:
    - fundalul graficului; cantitatea pe culoarea liniei la intrare; separatoarele; conturul (2 px la linia selectată sau trasă);
    - textele, cu linia de bază la `mijloc + înălțimea lui „0” / 2`, deci cifrele sunt pe mijloc;
    - ×-ul din două linii de 7 px, care se luminează sub mouse.
  - **Linia trasă:** e desenată unde e pointerul, cu textul de acolo (`setDragged`).
  - **Pointerul:** `hit(x, y)` dă caseta și partea ei; `lineAt(y)` dă linia trasabilă; `hitTest` dă cursorul (`pointer` pe ×, `ns-resize` pe casetă / linie).
- **`CandleChart`:**
  - **Apăsarea:** întâi caseta. Pe × e o acțiune (fără mișcare → `onLineAction(id)`; o atingere nu ajunge la grafic). Pe corpul unei casete trasabile e linia însăși.
  - **Hover:** din `pointermove` (mouse).
  - **`dragText(id, price)`:** textul casetei trase (înlocuiește `dragTitle`).
  - **Suprapunerile** (Confirmă / Renunță): pe linie, cu marginea dreaptă la marginea stângă a casetelor de pe acel nivel minus 6 px (unde nu e casetă, la `plotWidth − 64`).
    - Fără loc în stânga casetei (`right − w < 8`): deasupra casetei, cu marginea dreaptă a casetei, sau dedesubt. Revine pe linie doar cu 16 px în plus (histerezis pe cheie, `overlayStacked`).
    - Eroarea se deschide în partea opusă casetei.
    - Măsurate înainte de afișare, deci ascunse un cadru.
    - Eroarea primește prin `data-open` / `data-msg` și variabile CSS (`--overlay-room`, `--overlay-span`, `--overlay-from`) unde se deschide.
- **`Charts`:**
  - **Liniile:** `useTradeLines` dă liniile (fără „PnL acum”) și portofoliile; fiecare linie → `chartLineOf`.
  - **×:** `onLineAction` → `lineActionOf` (`trade-drafts.ts`):
    - intrarea → `OrderTicket` cu `closeSeed` / `sellSeed`, mutate din `Trades.tsx` în `components/trade-seeds.ts`;
    - SL / TP și TP / SL atașat → `LineActionDialog` cu o modificare (`level: null` / `stopLoss: null`);
    - un ordin → `LineActionDialog` cu anularea.
- **`LineActionDialog`:**
  - ștergerea: verificarea la deschidere, apoi `ModifyConfirm` și „Confirmă și trimite”;
  - anularea: ordinul și „Anulează ordinul”;
  - rezultatul în `Toast`.
- **`TradeDraftBar`:**
  - **Butoanele:** casete ca ale trade-ului (`h-5`, `rounded-[3px]`, 12 px, `pointer-coarse:h-7`): „Renunță” (`border-line-strong bg-chart`), apoi „Confirmă” (`#2962FF`, text alb, cercul de încărcare peste textul ascuns, deci lățimea rămâne).
  - **Eroarea:** poziționată după `data-*` (variantele `in-data-*` din Tailwind 4).
- **O modificare neconfirmată:**
  - `chartLineOf(…, { drafted })` → `label.pending`, culoarea liniei la 60 % (`#RRGGBB99`) și `axisLabelColor` plin (`PriceLineSpec.axisLabelColor` nou, trimis bibliotecii);
  - linia trasă primește același aspect în timpul tragerii (`applyOptions`: punctată, estompată), apoi revine;
  - caseta: `TradeLabels` o desenează în culoarea plină a liniei, cu fundalul colorat `fade(culoare, 0,22)` și conturul, textele și ×-ul la 70 %.

### Alinierea
- **Tiparul:** un element lângă un text de unul sau mai multe rânduri stă într-un `flex h-[1lh] items-center`, deci pe mijlocul primului rând al textului, la orice font. Înlocuiește ajustările `mt-px` / `mt-0.5` / `mt-1` din:
  - `ui.tsx` (`ErrorNote`, `Warning`), `TradingControls` (`FundsRiskNote`);
  - `Economy` (săgeata categoriei), `AiSettings` (radio), `DaySummary` (iconița titlului);
  - `Charts` (iconița alertei, legată de nume într-un grup care nu se rupe).
- **`Toast`:** textul pe `leading-5`, butonul × de `h-5`, centrat.
- **Tabelele `Trades` cu butoane:** `[&_td]:align-middle` (precedentul Setări / Liste); simbolul (sigla și numele) e un `flex` de bloc, nu `inline-flex`, care s-ar așeza pe linia de bază a siglei.
- **`Modal`, `AccountWizard`:** titlul e `flex items-center`.
- **Liste:** bifele în `flex items-center`.
- **Verificarea:** `scratchpad/audit/align-audit.ts`, scriptul Chrome cu detectorul (rânduri de tabel cu o celulă de acțiuni, rânduri flex, iconiță + text), pe toate paginile, derulate, și în ferestrele principale (ordin nou, SL / TP, Modifică, indicatori, setări Slingshot, căutare, cont nou, rezumatul zilei), la 1440 / 390 / 320. Pragul e 1,5 px.

### Teste
- **`trade-labels.test`:** textul, culorile, linia (fără titlu, cu casetă, stilurile), geometria, ce face ×-ul fiecărei linii (formularul de închidere, ștergerea, anularea, nimic fără tranzacționare, „Vinde” pe o deținere).
- **Chrome:**
  - casetele la 2× (măsurate pe pixeli: ×-ul centrat exact, cifrele la sub jumătate de pixel fizic);
  - bara lângă caseta de intrare (centrul pe linie);
  - ×-ul mesajului (0,5 px de text);
  - tragerea cu mouse-ul și cu degetul la 1440 / 390 / 320;
  - verificarea de aliniere: zero diferențe.

## TD-REVERSE — implementează FD-REVERSE

### Modelul (`shared/trading.ts`)
- **`reverseTicketSchema`:** `{ accountId, idemKey, symbol, side: 'long' | 'short' }` (strict).
- **`ReversePreview`:** `{ ticket, displaySymbol, base, from, to, leverage, marginMode, last, cancels, hedged, warnings, errors, env }`.
- **Rezultatul** are forma `ModifyResult`.
- **`subKey(idemKey, n)`:** cheia derivată a ordinului n al acțiunii (ultimul octet + n), deci fiecare ordin are id-ul lui de client, iar întregul se trimite o singură dată.
- **`TradeLogRow.action`** primește `'reverse'` („Întoarcere poziție”).

### Traderul crypto
- **`normalizeReverse`:**
  - poziția (`fetchPositions`, după latură; în hedge, după `positionSide`): mărimea (contracte × mărimea contractului), levierul rotunjit (1–125), marja;
  - cele două ordine verificate prin `normalize`: închiderea (market, reduce-only, cheia `subKey(1)`) și deschiderea (market, levierul, marja, `subKey(2)`);
  - erorile și avertismentele lor, fără nota „hedge: cealaltă poziție rămâne deschisă”, care nu se aplică;
  - ordinele de anulat: ale părții care închide, reduce-only (OKX algo, plan Bitget), ale acestei poziții în hedge; SL / TP-ul de poziție Bybit, separat.
- **`reverse`:**
  1. `place(închidere)`. Refuzată sau eroare → stop.
  2. `place(deschidere)`. Refuzată → pasul eșuat, cu mesajul „poziția a fost închisă, dar…”. Rezultat necunoscut → stop.
  3. `cancelOpen` pe fiecare ordin vechi (funcția comună cu modificarea); Bybit: `trading-stop` cu 0 pe slotul vechii poziții.
- **Brokerii:** nu implementează `normalizeReverse`, deci serviciul dă `UNSUPPORTED`.

### Serviciul și rutele
- **`claimAction`** (comun cu `modify`): rezervarea cheii în jurnal; a doua trimitere primește rezultatul primei.
- **`previewReverse`, `reverse`:** acces futures, limita pe minut, jurnalul, `settle`.
- **Rutele:**
  - `POST /api/trading/:id/reverse/preview`;
  - `POST /api/trading/:id/reverse`.

### Pagina
- **`ReverseDialog`:** verificarea la deschidere, confirmarea, `ModifyOutcome` cu etichetele întoarcerii; `canReverse(account, symbol)`.
- **`Charts`:**
  - suprapunerea fiecărei intrări futures întoarse are butonul ⇅ (casetă `BOX`, în culoarea poziției), fără `clamp` (dispare cu linia);
  - cu schițe, rândul e `[⇅][Renunță][Confirmă]`, iar `TradeDraftBar` nu mai e poziționat, deci eroarea se așază față de toată suprapunerea.
- **`Trades`:** „Întoarce” pe rândul poziției; starea dialogului ține contul.
- **`CandleChart`:** o suprapunere mutată de pe linie (ecran îngust) alege, deasupra sau dedesubt, locul care nu acoperă altă casetă (suprapunerea minimă).

### Zona
- **`PriceLineSpec.zoneFrom`** (intrarea poziției, sau prețul ordinului), din `chartLineOf`.
- **`TradeLabels`** are o a doua vedere (`zOrder 'bottom'`): dreptunghiul de la `zoneFrom` la prețul liniei trase, `fade(culoare, 0,14)`, pe toată lățimea, doar în timpul tragerii.

### Etichetele de preț
- **`CurrentPriceRenderer`:** desenează eticheta prețului curent cu geometria etichetelor bibliotecii (font de 11 px):
  - lățimea: 1 + 2 × 4,58 + 5 + lățimea textului;
  - înălțimea rândului: 11 + 2 × 2,29;
  - colțurile exterioare rotunjite la 2 px;
  - textul la 5 + 4,58 px.
- Măsurat la 2×: toate etichetele, de la x 2008 la 2130, cu 13 px liberi până la margine.

### Teste
- **`modify.test`:** întoarcerea pe clientul simulat:
  - one-way: închidere reduce-only, deschidere cu levier și marjă, chei de client diferite, anularea SL-ului;
  - hedge: doar ordinele long-ului;
  - deschiderea refuzată → `partial`, cu mesajul;
  - fără poziție → eroare, nimic trimis.
- **`service.test`:** verificarea fără trimitere (planul rămâne pe server), o singură trimitere, jurnalul `reverse`, accesul.
- **`trading.test`:** schema și `subKey`.
- **Chrome:**
  - ⇅ înainte de casetă și întoarcerea trimisă (hedge: închiderea și deschiderea `hedged`, anularea SL / TP-ului long-ului);
  - fereastra din Tranzacții;
  - zona la tragerea SL-ului;
  - etichetele de pe scală la 2×;
  - 1440 / 390 / 320;
  - verificarea de aliniere (zero).

## TD-CHARTSETTINGS — implementează FD-CHARTSETTINGS

### Setările
- **`shared/chart-style.ts`:**
  - `chartStyleSchema` (Zod 4, cu `prefault` pe fiecare parte): `candles`, `precision`, `timezone`, `status`, `canvas`, `alerts`;
  - o culoare e `#RRGGBB(AA)`; una „a temei” e `null`;
  - `DEFAULT_CHART_STYLE` = aspectul de dinainte (lumânări #26A69A / #EF5350 fără margini, fără grilă, cursor întrerupt, scala la 11 px, margini 20 / 10 % și 24 de bare, butoane mereu);
  - `salvageChartStyle`: o salvare care nu se mai citește întreagă își păstrează părțile care se citesc.
- **`settingsSchema.chartStyle`** (`prefault({})`); `chartStyle` e în `USER_KEYS`, deci e al fiecărui utilizator.
- **Serverul:**
  - `validate` refuză un fus orar al graficului necunoscut (400);
  - la citire, un fus pe care serverul nu-l mai știe devine `null` (altfel orice salvare ulterioară ar fi refuzată);
  - `salvage` folosește `salvageChartStyle`.

### Graficul (`CandleChart`)
- **Prop-uri noi:**
  - `look`;
  - `displayPrecision` (zecimalele afișate; `precision` rămâne a perechii, pentru prețurile puse prin tragere sau prin „+”);
  - `watermark` (rândurile filigranului);
  - `resetView` (un contor);
  - `onSettings`;
  - `onContextMenu({ x, y, price })`.
- **`frameOptions(look)`:**
  - `layout.background` plin sau `VerticalGradient`;
  - `textColor`, `fontSize`, `separatorColor`;
  - `grid` (vizibil, culoare, stil);
  - marginile scalelor;
  - `rightOffset`;
  - cursorul (culoare, stil).

  Se aplică la creare, la schimbarea temei și la schimbarea setărilor (zoom-ul rămâne).
- **`backgroundOf(look)`:** `{ top, bottom }`, refăcut la schimbarea temei (`themeTick`). E folosit de:
  - `TradeLabels.setBackground`: casetele, cu culoarea gradientului la mijlocul lor, `mixColor`;
  - `--color-chart` pe container: plăcile legendelor, butoanele de lângă linii;
  - banda A / L: în gradient, ultima lui parte;
  - fiecare suprapunere de linie: `--color-chart` cu culoarea de la înălțimea ei.

  Biblioteca pictează gradientul de la vârful la baza fiecărui panou, deci `mixColor(top, bottom, y / înălțimea panoului)`.
- **Lumânările:**
  - `candleOptions(look)`: o parte oprită devine transparentă;
  - cu „închiderea anterioară”, fiecare bară primește culorile după `c ≥ c[i-1]`;
  - culorile LMA rămân deasupra.
- **Marginile de sus și jos:** `priceScale('right', 0).scaleMargins`.
- **Filigranul:** `createTextWatermark(pane 0)`, 56 / 28 px, `fade(text, 0,12)` dacă nu are culoare; e detașat înaintea `chart.remove()`.
- **„Resetează vizualizarea”:** `setVisibleLogicalRange(n − 180, n + 20)` + scara automată; vizualizarea ținută minte devine aceasta (prin salvarea obișnuită la schimbarea intervalului).
- **Butoanele:**
  - `hover` = mouse-ul pe grafic (`pointerenter` / `pointerleave`, doar mouse) sau `pointer: coarse`;
  - „Navigare” condiționează „mergi la ultima lumânare”;
  - „Panou” pune `data-pane-buttons` pe container, iar `LegendButtons` are `in-data-[pane-buttons=hidden]:hidden`.
- **Legendele:**
  - `data-legend-titles / inputs / values` + `LEGEND_TITLE / LEGEND_INPUTS / LEGEND_VALUES` (pe un `span.contents`, ca regula să nu se bată cu `hidden sm:inline`);
  - `--legend-bg` = opacitatea plăcii (0 fără fundal).
- **Eticheta prețului curent:** primește `fontSize` = mărimea textului scalelor (padding-urile și rândul se scalează ca ale bibliotecii); măsurat la 14 px: toate etichetele au 153 px la 2×.
- **Click dreapta:** doar pe panouri (nu pe scale, axa timpului sau butoane), iar pe câmpuri rămâne meniul browserului; prețul de la cursor e transmis pentru „Copiază prețul” de mai târziu.
- **⚙:** în rândul axei timpului, sub scala prețului.

### Pagina (`Charts`)
- **`look`:** ciorna ferestrei cât e deschisă, altfel `s.chartStyle`.
- **Precizia și fusul orar:**
  - `chartPrecision` dă afișarea (antetul, scala, tabelele, legendele);
  - panoul liniei orizontale păstrează precizia perechii;
  - `chartTimeZone` (fusul graficului, dacă browserul îl știe) se aplică axei, semnalelor și alertelor.
- **Linia de stare:** `ChartStatusLine`, primul rând din `legends.main`. Conține:
  - titlul: `statusTitle`, plus intervalul și sursa;
  - numele: compania, sau numele monedei din aliasurile listei;
  - punctul pieței: bursa deschisă, sau crypto non-stop;
  - OHLC, `barChange`, volumul (`fmtVolume`), `dayChange`.

  `dayChange` are `prevDayCloses(candles, tz)` calculat o dată și doar sub un interval de o zi. Semnul minus e „−” la ambele numere.
- **Meniul:** `ChartMenu` (`role=menu`):
  - măsurat ascuns, apoi pus la cursor sau întors spre stânga / în sus;
  - focusul pe primul rând după așezare (un element ascuns nu primește focus);
  - săgeți, Home / End, Enter, Esc (capturat), Tab;
  - se închide la click în afară, derulare, redimensionare sau pierderea ferestrei.
- **Rândurile meniului:**
  - „Resetează vizualizarea ⌥R / Alt+R”;
  - „Șterge N desene” (`countRo`), dacă există;
  - „Șterge N indicatori” (studiile + Slingshot + LMA), dacă există;
  - „Setări…”.
- **Ștergerile:**
  - optimiste;
  - indicatorii trec prin `formSave` și `rememberStudy` (memoria lor rămâne), iar panoul lor se închide;
  - `Toast` are `action` („Anulează”), care pune lista de dinainte la loc, plus ce s-a adăugat între timp (în limite).
- **Alt+R:** pe `code === 'KeyR'` (pe Mac, ⌥R dă „®”); nu în câmpuri, nici sub o fereastră modală deschisă (`[aria-modal=true]` care nu e `inert`: lista de simboluri închisă de pe telefon rămâne în pagină).
- **Simbolul schimbat** închide fereastra (ca „Renunță”) și meniul.
- **`Toast.autoHide`** = `look.alerts.autoHideToasts`.

### Fereastra (`ChartSettingsDialog`)
- **`Modal`:**
  - `clear`: fără voal și blur, ca previzualizarea să se vadă;
  - `flush`: corpul își face singur derularea și subsolul.
- **Aspectul:**
  - tab-urile: o coloană de 184 px de la 640 px; sub 640 px, un rând care se derulează, fără iconițe, cu tab-ul ales adus în vedere;
  - înălțimea e fixă (540 px, dar se micșorează), ca tab-urile să nu sară.
- **Rândurile:**
  - `Row`: grilă `13rem | restul` de la 640 px; pe telefon flex care se rupe, cu controalele la dreapta sau sub nume;
  - bifa stă în `flex h-[1lh] items-center`;
  - un nume fără controale ocupă tot rândul.
- **Ciorna:**
  - `onPreview(draft)` la fiecare schimbare;
  - OK = `saveSettingsPatch({ chartStyle: draft })` (optimist), apoi închiderea; o eroare rămâne afișată în fereastră;
  - „Valorile implicite” resetează tab-ul curent.
- **Culorile temei:** o culoare `null` apare în selector ca a temei (`themeColors()`) și rămâne `null` până e schimbată.
- **Efectele cu acolade:** `scrollIntoView` întoarce acum un `Promise` în Chrome, pe care React l-ar lua drept curățarea efectului.

### Selectorul de culoare
- **`ColorPicker`:**
  - paleta TradingView, 8 × 10;
  - culorile proprii (`localStorage`, cel mult 10);
  - opacitatea;
  - opțional, `lineStyle`.

### Teste
- **`chart-style.test`:** valorile implicite = aspectul de dinainte, completarea parțială, refuzurile, recuperarea pe părți.
- **`chart-look.test`:**
  - fusul și precizia;
  - `barChange`;
  - `prevDayCloses` în UTC și în București (ziua se schimbă la 22:00 UTC);
  - `dayChange`, `fmtVolume`, `statusTitle`, `statusLineOn`.
- **`color.test`:** `mixColor`. **`format.test`:** `countRo`.
- **`users.test`:** setările pe utilizator, combinarea pe părți, fusul refuzat, o parte stricată la valorile implicite și fusul necunoscut la `null` la citire.
- **Chrome** (1440 / 390 / 320):
  - meniul (rânduri, focus, săgeți, Esc, întors la colț, click în afară);
  - ștergerile cu „Anulează”;
  - ⌥R;
  - fereastra, fiecare tab;
  - previzualizarea (grilă, text 14, degrade, filigran), apoi „Renunță” (scala revine la 74 px);
  - OK cu linia de stare completă;
  - butoanele la mouse / niciodată;
  - titlurile, parametrii și valorile oprite, placa la 30 %;
  - precizia 4 și New York;
  - tema luminoasă și comutarea;
  - etichetele la 2×;
  - verificarea de aliniere: zero, în pagină, în cele patru tab-uri și în meniu.

## TD-BARCOLORBODY — implementează FD-BARCOLORBODY

### LMA (`CandleChart`, datele seriei)
- Biblioteca ia per bară `color` pentru corp; `borderColor` și `wickColor` lipsă iau opțiunile seriei după `open <= close`.
- **Fără „închiderea anterioară”:** bara cu culoare LMA primește doar `color` (transparent cu „Corp” debifat).
- **Cu „închiderea anterioară”:** `color` = culoarea LMA (sau a setărilor), iar `borderColor` și `wickColor` = ale setărilor, după `c ≥ c[i−1]`, ca la lumânările fără indicator.

### `barcolor` generic (`BarColorPrimitive`)
- Nu mai redesenează fitilul.
- Corpul e desenat cu geometria bibliotecii (`PaneRendererCandlesticks._drawCandles`):
  - lățimea optimă cu paritatea fitilului;
  - cu `borderVisible`, interiorul (micșorat cu lățimea marginii, calculată ca `_calculateBorderWidth`);
  - nimic când lumânarea e prea îngustă pentru interior.
- Corpul gol (culoarea per bară sau a seriei transparentă: „Corp” debifat) nu e colorat.
- Sub culoarea indicatorului se pune întâi fundalul graficului (`layout.background`: plin sau gradientul pe înălțimea panoului, ca biblioteca). Astfel o culoare cu opacitate se vede peste fundal, nu peste corpul desenat de bibliotecă.

### Teste
- Unitar: regula culorilor per bară (funcție pură `candleColors`) și geometria interiorului (`bodyRect`).
- Chrome: LMA cu margini bifate, la 2×: fitilul și marginea în culorile din setări, corpul în culoarea LMA.

## TD-STYLEUNIFY — implementează FD-STYLEUNIFY

### Caseta de linie: `ColorPicker`
- **Prop-uri noi:**
  - `lineWidth` / `onLineWidth`: grosimea, butoanele 1–4 px, plus valoarea curentă dacă e peste 4;
  - `onChange` opțional: fără el, caseta e „culoare fixă”, panoul n-are paleta și opacitatea, iar `value` poate fi un gradient CSS;
  - `colorNote`: de unde vine culoarea, când nu se alege aici.
- **Caseta:** cu `lineStyle` sau `lineWidth`, are 72 px: culoarea + linia (grosimea și tipul, `strokeDasharray` scalat cu grosimea).
- **Panoul:** „Grosime” (butoane `aria-pressed`, fiecare cu linia lui) și „Stilul liniei” (cele trei, cu titlu „Continuă / Întreruptă / Punctată”).
- **Rândurile din formularele Slingshot / LMA:** numele se rupe pe rânduri, iar controalele stau mereu în dreapta, în aceeași coloană; (i) e pe mijlocul primului rând al numelui.

### Mărimea: `SIZE_NAMES` și `TEXT_PX`
- `SIGNAL_SIZE_NAMES` (Tiny…Huge) e lista unică.
- `SIGNAL_SIZES[n].text` dă textul (9 / 11 / 13 / 16 / 20 px), folosit și de etichetele ATR și de Market Structure (`sizeOf` local dispare).

### Slingshot (`shared/indicator/params.ts`)
- **Cheile noi:**
  - pentru fiecare parte `s ∈ {long, short}` și stare `X ∈ {Forming, '', Failed, Invalid, Tp, Sl}`: `${s}${X}Color` (cele existente rămân: `longColor`, `longTpColor`, `longSlColor`, `shortColor`…) și `${s}${X}Size`;
  - ATR: `shortTPColor`, `shortSLColor`, plus `{long,short}{Tp,Sl}LineWidth` (1–4, implicit 2), `…LineStyle` (Dashed), `…LabelSize` (Small);
  - Cloud: `slowEmaWidth`, `fastEmaWidth` (1–4, implicit 1), `slowEmaStyle`, `fastEmaStyle` (Solid);
  - Market Structure: `msBullLineWidth`, `msBearLineWidth` (1–5), `msBullLineStyle`, `msBearLineStyle`, `msBullTextSize`, `msBearTextSize` (Tiny…Huge).
- **Scoase:** `failedColor`, `invalidColor`, `signalSize`, `msLineWidth`, `msLineStyle`, `msTextSize`.
- **`migrateSlingshotParams(raw)`** (`z.preprocess` înaintea schemei) completează cheile noi lipsă din cele vechi, deci aspectul salvat se păstrează. Cheile vechi sunt apoi ignorate (Zod le scoate). Pure, testată.

### Slingshot (desenarea)
- **`slingshotShapes`:** pentru fiecare marcaj, starea (în formare, validă, eșuată, invalidată, TP, SL) și partea dau culoarea și `SIGNAL_SIZES[size]`.
- **`buildSegments`:**
  - fiecare linie ATR are culoarea, grosimea și tipul părții și nivelului ei;
  - eticheta are mărimea aleasă, iar fundalul rămâne `fade(culoare, 0,2)`;
  - Market Structure: grosimea, tipul și mărimea textului pe linie.
- **EMA-urile:** `applyOptions({ lineWidth, lineStyle })` pe seriile fast / slow, la schimbarea parametrilor.
- **Caseta TP / SL** (`Charts`): culorile ATR ale fiecărei părți.

### LMA
- **Cheile noi:**
  - `longLineColor`, `shortLineColor`, `neutralLineColor` (`hex | null`, implicit `null` = culoarea scriptului);
  - `longLineWidth` (1), `shortLineWidth` (1), `neutralLineWidth` (2), toate 1–4;
  - `signalStyle` (Solid).
- **`lmaHlines`:** culoarea `override ?? a scriptului`, cu grosimea aleasă.
- **Seria semnalului:** `lineStyle` după `signalStyle`.

### Formularele Slingshot / LMA (`IndicatorForm`)
- **Un tip de câmp nou, `look`:**
  - opțional: o bifă (`toggle`);
  - caseta (`color` sau `swatch` fix, `width`, `style`);
  - lista de mărime (`size`);
  - valoarea nivelului (`value`).
- **Stilurile:** Pine („Solid / Dashed / Dotted”) ↔ casetă („solid / dashed / dotted”).
- O culoare `null` (LMA) arată culoarea scriptului; „Valorile implicite” o pune la loc.
- **Erorile** de validare numesc rândul.

### Indicatorii standard (`StudySettings`)
- `LineStyleField`, `LineWidthField`, `WIDTH_RO` și `widthChoices` dispar.
- Fiecare linie are o singură casetă: culoarea, plus grosimea (`lineKind` = `line` | `width`) și tipul (`line`).
- La o paletă, fiecare culoare are casetă proprie, cu aceeași grosime și același tip.
- Grosimea afișată: `o.width ?? plotWidth(def)`.

### Linia orizontală (`HLineSettings`)
Culoarea, grosimea și tipul într-o singură casetă; `HLINE_STYLES` rămâne în schemă.

### Setările graficului
- `canvas.crosshair.width` (1–4, implicit 1) intră în `frameOptions` (`width` pe ambele linii ale cursorului).
- Caseta cursorului are grosimea și tipul.

### Pine (`sling-shot-system-3.4.pine`)
- **Intrări:** aceleași chei și aceleași valori implicite.
- **Etichetele:**
  - `showValid / showFailed / showInvalid` primesc culoarea și mărimea părții (`label.set_size`);
  - etichetele în formare se creează cu culoarea și mărimea „Forming”.
- **Liniile și etichetele ATR, tabelul:** culorile, grosimea, tipul și mărimea fiecărei părți.
- **Market Structure:** pe linie.

### Teste
- **`params.test`:**
  - valorile implicite = aspectul de dinainte;
  - preluarea setărilor vechi (failed / invalid / size / ATR / MS);
  - refuzurile (grosime 0 sau 5 pentru ATR, mărime necunoscută).
- **`slingshot-draw.test`:**
  - culoarea și mărimea fiecărei stări pe parte;
  - liniile ATR ale SHORT-ului cu culorile lui;
  - Market Structure pe linie;
  - textele cu `TEXT_PX`.
- **LMA:** `lmaHlines` cu și fără culoarea aleasă.
- **Chrome:**
  - formularele (Slingshot, LMA, un indicator standard, linia orizontală, setările graficului) la 1440 / 390 / 320;
  - panoul cu grosimea;
  - graficul cu SHORT-ul în alte culori, X-ul mare;
  - verificarea de aliniere.

## TD-TRADESOUND — implementează FD-TRADESOUND

- **`web/chart/trade-ends.ts`** (pur):
  - `tradeKeys(portfolio)`: fiecare trade deschis, cu cantitatea lui.
    - Pozițiile: câte o cheie pe `ref.positionIds` (eToro), altfel `simbol|parte`.
    - Deținerile: câte o cheie pe `ref.positionIds`, altfel `bal:activ`, doar cu valoarea de cel puțin 1 și fără stablecoin-uri și numerar.
  - `endedTrades(prev, next)`: cheile dispărute, iar la deținere cantitatea scăzută la cel mult 1 %. O secțiune cu eroare sau date vechi în `next` nu se compară.
- **`useTradeEndSound(enabled)`** în `ChartView`:
  - `useQueries` pe toate conturile, aceeași cheie (`['portfolio', id]`) ca liniile de pe grafic, deci o singură citire;
  - `refetchInterval` de 20 s, `false` pentru un cont cu `asOf` (IBKR Flex);
  - React Query nu citește în fundal.
- **Comparația:**
  - pe `fetchedAt` nou al fiecărui cont, față de citirea lui anterioară;
  - `visibilitychange` → `hidden` golește citirile ținute minte, deci prima de după revenire e punctul de plecare;
  - sunetul pornește doar cu `document.visibilityState === 'visible'`.
- **`web/trade-sound.ts`:**
  - un singur `HTMLAudioElement` (`/audio/coin-money.mp3`, `preload`);
  - deblocarea la prima atingere sau tastă (redare mută, apoi pauză);
  - `playTradeSound()` pornește de la 0 și ignoră două apeluri în 1,5 s;
  - erorile de redare (autoplay) sunt ignorate.
- **Setarea:** `chartStyle.alerts.tradeSound` (implicit `true`), în tab-ul Alerte al setărilor graficului.
- **Teste:** `trade-ends.test` (cheile, închiderea totală sau parțială, eToro cu mai multe poziții, ⇅, erorile și datele vechi, praful, stablecoin-urile).

## TD-MACRORULES — implementează FD-MACRORULES

- **`server/news/macro.ts`:** `macroVerdict(title, summary, companiesInTitle)` → `{ macro, strength, areas }`.
  - **`AREAS`:** expresiile fiecărei arii din reguli (monetar, inflație, creștere, muncă, fiscal, comerț / valute, teme); fiecare expresie distinctă din titlu sau rezumat (primele 300 de caractere) e un semn.
  - **Semnele de companie** din titlu: o companie numită, plus fiecare cuvânt de companie distinct. Minus 1 când titlul vorbește de piața în ansamblu.
  - **Companiile numite:** `detector.detect` pe titlul fără instituțiile care comentează; o companie e un simbol care nu e crypto și nu e indice.
  - **Macro:** `titlu > companie`, sau un titlu fără temă, cel puțin două teme în rezumat și zero semne de companie.
  - **Forța** = 2 × titlu + rezumat, folosită în alegerea dintre categorii.
- **`categorize`:** semnalul Macro e forța regulilor (0 fără ele); cuvintele Macro vechi dispar.
- **`weighItem` → `NewsCategory`** (`SourceCategory | 'other'`). O știre care ar ajunge Macro fără să respecte regulile:
  - trece la cea mai puternică dintre Crypto / Acțiuni / Geopolitică (`categorySignals`, la egalitate ordinea fixă);
  - altfel la `other`, cu relevanța 0 și `lowRelevance`.
- **`reclassify`:** folosește categoria sursei (`s.category`), nu pe cea salvată a știrii. O știre mutată nu-și schimbă astfel regula.
- **Upgrade:** `upgradeNewsClassification` (datele jobului `news.classify`, `CLASSIFY_VERSION = 2`) reclasifică, în loturi, toate știrile salvate. Rulează în jobul `sentiment.daily`, înaintea `upgradeHistory`, iar `INDEX_VERSION = 3` recalculează istoricul o dată.
- **API și pagină:**
  - `newsQuerySchema.category` primește `other`;
  - pe pagina de știri, filtrul „Altele” și eticheta;
  - `TopicIcon` are o iconiță generală.
- **Teste:**
  - `macro.test` cu exemplele din FD (macro / companie / piață / instituție / rezumat);
  - `multicat.test` și `news.test` actualizate;
  - reclasificarea unei surse Macro (companie → Acțiuni, nimic → Altele) și upgrade-ul o singură dată.

## TD-BOT — implementează FD-BOT

### 1. Date (migrarea 10)
- **`bots`:**
  - `id`, `user_id` (FK users, cascade), `name`, `strategy` (`grid` | `dca` | `premium`), `exec` (`paper` | `real`);
  - `account_id` (fără FK: altfel SQL Server refuză a doua cale de ștergere în cascadă; un cont șters e găsit de motor);
  - `market` (`spot` | `futures` | `stock`), `area` (`crypto` | `stocks`), `symbols` (JSON), `tf`;
  - `config` (JSON, al utilizatorului);
  - `status`, `status_reason`;
  - `command` (JSON: oprirea cerută, citită de motor);
  - `state` (JSON, doar al motorului);
  - `starts_at`, `ends_at` (null = fără sfârșit), `created_at`, `updated_at`, `ran_at`.
- **`bot_trades`:** `bot_id` (cascade), `symbol`, `side`, `qty`, `entry`, `exit`, `pnl`, `fees`, `opened_at`, `closed_at`, `reason`.
- **`bot_events`:** `bot_id` (cascade), `at`, `kind`, `symbol`, `message`, `detail` (JSON: scorul defalcat, răspunsul AI, ordinul).
  - Ultimele 1 000 pe bot; motorul le taie o dată pe oră.
- **Un singur scriitor pentru fiecare coloană:**
  - `config`, `name`, `ends_at`, `command` și pauza / reluarea: API-ul;
  - `state`, `ran_at` și stările lui (Rulează, Problemă, Se încheie, Încheiat): motorul.
  - Pauza / reluarea / oprirea scriu `status` doar din stări permise (`UPDATE … WHERE status IN (…)`). Motorul scrie `status` cu `WHERE status = @văzut`: o comandă venită între timp nu se pierde.

### 2. Cod comun (`shared/bot.ts`)
- **Schemele zod:**
  - `botInputSchema` (crearea): comune + `grid` | `dca` | `premium`, după `strategy`;
  - `botEditSchema` (câmpurile editabile, FD-BOT §7);
  - aceleași reguli pe pagină și pe server.
- **Calculele pure, folosite de formular și de motor:**
  - `gridLines(lower, upper, n, spacing)`;
  - `gridPlan(cfg, price, lev, fee)`: cantitatea pe grilă, intervalele pline la pornire, câștigul pe grilă, capitalul;
  - `dcaPlan(cfg, price)`: tabelul ordinelor de siguranță și capitalul necesar;
  - `liqDistance(lev)`;
  - etichetele în română.
- **Tipurile API:** `BotView` (listă), `BotDetail` (detalii), `BotTradeRow`, `BotEventRow`, `BotCheck` (rezumatul formularului).

### 3. Strategiile (pure, `server/bots/`)
Fiecare primește configurația, starea și prețul și întoarce starea nouă plus ce are de executat. Nu citește nimic singură, deci se testează fără rețea.
- **`grid.ts`:**
  - `initGrid` → intervalele `{ side, entry | null }`, cantitatea `q`, `armed` (cu prețul de pornire);
  - `stepGrid(state, price)` → cumpărările / vânzările de făcut, cumulate într-un singur ordin net, plus ciclurile încheiate.
- **`dca.ts`:**
  - `stepDca(cfg, state, price, now)` → deschide ciclul, ordinele de siguranță atinse (toate odată), TP / SL;
  - pauza și numărul de cicluri.
- **`premium.ts`:**
  - `barEvents(result, side)`: semnalul confirmat pe ultima lumânare închisă; TP Slingshot; invalidarea prin trend a semnalului poziției, căutat după `time`;
  - `levels(cfg, signal, price)`: SL / TP după opțiuni;
  - `size(...)`: sumă fixă sau risc %, levierul cel mai mic, regula lichidării;
  - `exitFor(position, price)`.
- **`score.ts`:**
  - `scoreTrade(parts, weights)` → `{ score, parts: [{ key, a, weight, value }] }`;
  - `gates(...)` → primul motiv de refuz, în ordinea FD-BOT §6.

### 4. Motorul (`server/bots/engine.ts`)
- **Job-ul `bots`:** la 30 s, primul după 30 s, timeout 4 min. Doar pe instanța cu lease-ul.
  - Citește boții activi ai utilizatorilor activi.
  - Fiecare bot are `try / catch`: o eroare neașteptată scrie un eveniment, iar după 3 la rând starea devine Problemă.
- **Pașii unui bot la o verificare:**
  1. **Perioada:**
     - Programat → Rulează la `starts_at`;
     - după `ends_at`, Rulează / Pauză → Se încheie, cu acțiunea de la sfârșit.
  2. **Comanda de oprire**, dacă e una: Se încheie, cu acțiunea ei.
  3. **Prețul fiecărui simbol:**
     - crypto: `MarketData.candles(sursa, simbol, '1m', 2)`, ultima închidere;
     - acțiuni: `StockData.quote`, doar cu bursa deschisă.
     - Fără preț: pasul se sare. După 10 minute fără preț: Problemă.
  4. **Reconcilierea** (real): `accounts.portfolio(contId)`. O secțiune cu erori sau veche → nimic. 60 s după un ordin al botului pe acel simbol → nimic.
  5. **Ieșirile:** mereu, și în Pauză sau Problemă; în Problemă, încercate.
  6. **Intrările:** doar în Rulează, în perioadă, sub pierderea pe zi.
  7. **Starea, evenimentele și tranzacțiile** se salvează.
- **Premium:** `runSlingshot` doar când timpul lumânării închise e mai nou decât `state.premium.lastBar[simbol]`. Lumânările ca în scanner:
  - crypto: `MarketSource.forSymbol` + `MarketData.candles`, istoricul `forUser().candles`, HTF pentru structură;
  - acțiuni: `StockData.candles` cu cheia utilizatorului.
- **Execuția (`exec.ts`)**, o singură interfață `order({ symbol, side, qty, reduce, leverage, price }) → { qty, price, fee }`:
  - **`PaperExec`:** execută la `price`, comisionul din setări.
  - **`RealExec`:**
    - rotunjește cantitatea la pasul instrumentului (`TradingService.instrument`, ținut o oră) și verifică minimele;
    - scrie `state.pending = { key, cantitatea rotunjită, scopul }`;
    - trimite prin `TradingService.place` (`market`, `amountIn: 'base'`, `reduceOnly` la închiderea pe futures, `leverage` la deschidere);
    - șterge `pending`.
  - **Erorile `RealExec`:**
    - `RATE_LIMIT` / `IN_PROGRESS`: `pending` rămâne, aceeași cheie la verificarea următoare;
    - `REJECTED` / `INVALID` / `MIN_SIZE` / `INSUFFICIENT` / `MARKET_CLOSED`: o intrare se sare; o ieșire se reîncearcă (cheia e eliberată de jurnal), iar după 10 eșecuri la rând → Problemă;
    - `UNKNOWN_OUTCOME` / `PERMISSION` / `DISABLED` / `UNSUPPORTED` / `HEDGE_MODE` / `NOT_FOUND`: Problemă;
    - `NO_ACCOUNT` (sau `tradingAccess` null): Încheiat, motivul „contul a fost șters”.
  - **Un ordin `pending` găsit la începutul unei verificări** pleacă primul, exact cum a fost (aceeași cheie și cantitate, fără verificări noi: poate a ajuns deja). Reușit, i se aplică scopul.
  - **O intrare refuzată:** nicio intrare pe simbol 5 minute (`state.entryPause`), spus o dată.
  - **„Reia” după o Problemă** șterge `pending`. Reconcilierea prinde orice diferență.
- **Contabilitatea** (în `state`): pe poziție `entry`, `qty`, `margin`, `lev`, `fees`.
  - Câștigul realizat al unei închideri = latura × (ieșire − intrare) × cantitate − comisioanele.
  - Ziua (fusul utilizatorului): `dayKey`, `dayRealized`; pierderea pe zi = realizatul de azi + nerealizatul de acum.
- **Intrările Premium:**
  - **`inputs.ts`** citește o dată pe decizie:
    - `daily.today(tz, now, scope)` (scorul zilei, aria din `breakdown`);
    - `daily.history(7, …)` (sentimentul general);
    - știrile simbolului din ultimele 24 h (`news_coins`, cu scorul AI al utilizatorului unde există) prin `computeIndex`;
    - `calendar.query` (impact `High`, USD) pentru filtru și pentru AI.
  - **AI:** `ai.client(...).generate` cu schema `{ decision, confidence, reason, risks }`, `effort: 'low'`, 60 s. Consumul e scris ca `bot`. Cel mult 30 de întrebări pe zi pe bot (`state.premium.ai`).

### 5. API (`server/http/bot-routes.ts`)
- `GET /api/bots` → `BotView[]`.
- `GET /api/bots/:id` → `BotDetail`: tranzacțiile (ultimele 200), evenimentele (ultimele 300), pozițiile, grila / ciclul.
- `POST /api/bots/check` → `BotCheck`: rezumatul, capitalul, erorile și avertismentele; fără salvare.
- `POST /api/bots` → creează. Verifică:
  - limita de 10;
  - un singur bot real pe cont / piață / simbol;
  - contul are tranzacționarea pornită pentru piață;
  - simbolul există pe piață (instrument);
  - „Real” doar pe crypto.
- `PUT /api/bots/:id` (editarea), `POST /api/bots/:id/pause | resume | stop { action }`, `DELETE /api/bots/:id` (doar Încheiat).
- „Duplică” e în pagină: formularul se deschide cu `input`-ul botului (`formOf`), fără sfârșit.
- **Accesul:** doar proprietarul (al altcuiva = 404); scrierile trec prin CSRF, ca restul.

### 6. Pagina
- **`Charts.tsx`:** butonul „Bot” după „Tranzacționează” (aceeași clasă `btn`, iconița `Bot`). Lipsește pe un indice. Deschide `BotsDialog` cu simbolul, aria, timeframe-ul, prețul și intervalul ultimelor 100 de lumânări.
- **`components/bots/`:**
  - `BotsDialog` (Modal 760): lista / detaliile / bot nou;
  - `BotForm`: secțiuni, rezumatul din `POST /api/bots/check`, debounced;
  - `BotDetail`;
  - `bot-form.ts`: starea formularului → input, testabil.
- **Alinierea:** tiparele existente: `flex h-[1lh] items-center` pentru bife lângă text și `[&_td]:align-middle` în tabele.

### 7. Teste
- **`grid.test`:**
  - liniile aritmetice / geometrice;
  - cantitatea;
  - pornirea Long / Short / Neutru;
  - un salt peste mai multe linii = un ordin;
  - ciclurile și câștigul;
  - „Oprește sub / peste”.
- **`dca.test`:**
  - tabelul ordinelor (abateri, multiplicatori, capital);
  - ordinele atinse odată;
  - TP din prețul mediu;
  - SL din prețul de bază;
  - ciclurile, pauza, limita de cicluri.
- **`premium.test` / `score.test`:**
  - semnalul proaspăt / vechi / provizoriu;
  - prețul trecut de SL / TP;
  - nivelurile Slingshot luate cum sunt, fără R:R (FD-BOTSLRR);
  - calendarul;
  - aria împotrivă;
  - scorul cu părți lipsă;
  - mărimea (fixă / risc, levierul, lichidarea, plafoanele);
  - ieșirile (SL, TP, semnal TP, invalidare, opus);
  - AI care refuză / nu răspunde.
- **`engine.test`** (bază de test, `TradingService` cu un trader fals):
  - simularea cap-coadă;
  - perioada (programat → rulează → se încheie → încheiat);
  - pauza cu ieșiri;
  - oprirea cu fiecare acțiune;
  - pierderea pe zi și cea totală;
  - realul:
    - cheia salvată înaintea trimiterii, retrimisă după o eroare de rețea;
    - `UNKNOWN_OUTCOME` → Problemă;
    - contul șters → Încheiat;
    - reconcilierea „din afară”;
  - o poziție străină → fără intrare;
  - limitele de 10 boți și de un bot real pe simbol.
- **`server.test`:** rutele (proprietarul, validarea, editarea, ștergerea doar încheiat).
- **`bot-form.test`:** formularul → input.

## TD-BOTSTOCKS — implementează FD-BOT §10 (acțiunile în real)
- **`shared/bot.ts`:**
  - fără regula „acțiunile doar în simulare”;
  - short-ul e refuzat doar pe spot. Pe acțiuni, schema îl lasă, iar serviciul îl verifică după broker.
- **Serviciul (`check`)**, la un bot real pe acțiuni:
  - contul e de acțiuni, cu `stock` între piețe;
  - simbolul se găsește la broker (`instrument`);
  - short doar dacă platforma are `TRADING[x].etoro`;
  - short la eToro cere un SL: Premium îl are mereu, DCA cere `stopLoss`, iar grila Short / Neutru cere `stopAbove`;
  - un avertisment despre program și despre moneda contului.
- **`RealExec`** primește platforma contului (`exchange`) și pozițiile eToro ale botului (`state.refs`).
  - **Acțiuni:** simbolul rămâne cel al graficului; ordin la piață, `amountIn: 'base'`, fără `reduceOnly` și fără levier.
  - **eToro, deschidere:**
    - id-urile pozițiilor instrumentului înainte (`instrument().positions`);
    - ordinul pleacă, cu `stopLoss` la un short;
    - id-urile de după: cele noi, de aceeași latură, intră în `refs[simbol][latură]`;
    - nicio poziție nouă vizibilă: `refsWait[simbol] = { latură, înainte }`, rezolvat la următoarea citire a pozițiilor.
  - **eToro, închidere:**
    - pozițiile instrumentului citite din nou (`refsWait` rezolvat, `refs` curățat de cele închise);
    - `close: { positionIds: refs, units }` (`units` lipsește când se închide tot);
    - fără nicio poziție a botului, ordinul e refuzat.
  - **Trading 212 / Alpaca:** vânzarea cantității, cel mult cât e liber (`availableBase`, citit proaspăt).
- **Motorul:**
  - `BotOrder.sl`: SL-ul trimis cu un short eToro (Premium: SL-ul tranzacției; DCA: SL-ul ciclului; grila: `stopAbove`).
  - **`held()` pe acțiuni:** long-ul din soldul simbolului (`balances[asset = simbol]`), short-ul din `positions[symbol = simbol/USD]`.
  - Reconcilierea e ca la spot.
- **Pagina:**
  - „Real” se oferă și pe acțiuni, cu conturile de acțiuni cu tranzacționarea pornită.
  - Direcția Short / Ambele / Neutru apare pe acțiuni în simulare și la eToro.
- **Teste:**
  - un bot real pe un Trading 212 simulat (cumpără, vinde doar cantitatea lui, reconcilierea);
  - pe un eToro simulat: id-urile notate, închiderea doar a pozițiilor lui, short cu SL, poziția apărută târziu;
  - schema și formularul: short pe acțiuni.

## TD-SLTPDUP — implementează FIX-SLTPDUP
- **`ModifyStepResult.cancelled`:** id-ul ordinului pe care pasul l-a scos de pe platformă. Îl pun:
  - `crypto.ts`: anulat; ordinul vechi anulat (plasat-apoi-anulat, anulat-apoi-plasat); un cancel-replace cu id nou; SL / TP-ul vechi la întoarcere;
  - `trading212.ts`, `alpaca.ts`: anulat, înlocuit cu id nou.
- **`TradingService`:** după o modificare, o întoarcere sau o anulare reușită, `accounts.forgetOrders(cont, ids)`.
- **`AccountsService`:**
  - `forgetOrders`: id-urile ascunse 2 minute din `portfolio()` (și din cache);
  - `invalidate` mărește generația contului, uită citirea în curs și pornește 30 s în care portofoliul se citește cel mult o dată la 3 s;
  - o citire nu intră în cache dacă generația s-a schimbat între timp (`keep`).
- **Pagina:**
  - `portfolio-settle.ts`: `settlePortfolio(qc, cont)` după ordin / anulare / modificare / întoarcere; `portfolioInterval(cont, normal)` (3 s cât se așază). Le folosesc graficul și Tranzacții.
  - `trade-drafts.ts`:
    - `sentLevels` (liniile trimise: toate la „done”, cele reușite la „partial”);
    - `withSent` (nivelul nou până apare la bursă, fără ordin, deci fără tras / ×; ordinul vechi ascuns odată ce apare cel nou; cel mult `SENT_MS` = 60 s).
  - `Charts.tsx`: `onSent` pune nivelurile trimise; liniile afișate trec prin `withSent`, apoi prin `withDrafts`.
- **Teste:**
  - `trade-drafts.test` (toate cazurile);
  - `modify.test` (`cancelled` la plasat-apoi-anulat, nimic la o anulare eșuată);
  - `server.test` (citirea de dinaintea acțiunii, ordinele ascunse).

## TD-COINSOUND — implementează FIX-COINSOUND
- **`trade-ends.ts`:** `MAX_GAP_MS` = 50 000. `endedTrades(prev, next)` întoarce `[]` când `next.at − prev.at > MAX_GAP_MS`. Ora citirilor e `dataUpdatedAt` (ceasul paginii).
- **`trade-sound.ts`:** pregătirea pune `muted` și `volume = 0` și le reface după pauză; `playTradeSound` pune `volume = 1`.
- **Teste:**
  - `trade-ends.test`: la 20 și la 50 s se compară; la 50 001 s și la 6 h, nu.
- **Verificare în Chrome** (KuCoin simulat):
  - pagina oprită 70 s cu debuggerul (rămâne vizibilă), long-ul închis între timp: niciun sunet la revenire;
  - short-ul închis cât e urmărită: un sunet;
  - prima atingere: nimic.

## TD-COINSOUND2 — implementează FIX-COINSOUND2
- **`trade-sound.ts`:**
  - `readyTradeSound` pune `muted` și `volume = 0`, apoi `play()`, iar după rezolvare oprește doar dacă elementul e încă mut (un sunet de trade pornit între timp nu e oprit);
  - nu reface volumul: îl pornește doar `playTradeSound` (`muted = false`, `volume = 1`, `currentTime = 0`).
- **`trade-ends.ts`:** `tradeKeys(p, at, base?)`. Cu `base`, păstrează doar pozițiile cu `symbol` care începe cu `${base}/` și deținerile cu `asset === base` (regula liniilor, `pnl.ts` `tradesOf`).
- **`useTradeEndSound(enabled, base, stock)`:**
  - citește doar conturile de felul graficului (`kind === 'stocks'` pentru acțiuni), ca `useTradeLines`;
  - la schimbarea simbolului: `watchFrom = acum`, `seen` golit și o citire imediată a conturilor (`refetchQueries`); la montare nu, fiindcă citirea pornește oricum.
- **`Charts`:** `useTradeEndSound(tradeSound && !index, stock ? symbol : base, stock)`.
- **Teste:**
  - `trade-sound.test`: un element care imită WebKit (pauza nu oprește clipul) arată că pregătirea nu se aude, iar sunetul unui trade se aude o dată; un sunet pornit înainte de rezolvarea pregătirii nu e oprit. Pe codul vechi, testul pică.
  - `trade-ends.test`: filtrul pe monedă (SOL față de BTC și SOLV) și pe acțiune (TSLA, cu id-uri eToro).
- **Verificare** (fără sunet pe difuzoare: Chrome cu `--mute-audio`; în WebKit, mp3-ul înlocuit cu liniște):
  - în WebKit, pregătirea rulează clipul până la capăt, pe mut;
  - un trade de pe graficul afișat sună o dată;
  - în Chrome, un trade BTC închis cât graficul arată ETH nu sună.

## TD-COLORUNIFY — implementează FD-COLORUNIFY

### `src/web/indicators/color-links.ts` (în pachetul principal, fără runtime)
- **`INPUT_LINES`:** `{ 'ma-ribbon': { ma1Color: ['plot0'], … } }`, adică input → liniile pe care le colorează întregi (cazul A).
- **`lineInput(id, plotId)`:** inversul.
- **`INPUT_COLORED`:** `{ technicals: { plot0: { inputs: ['colStrongSell', 'colNeutral', 'colStrongBuy'], note } } }` (cazul C).
- **`PLOT_PALETTES`:** culorile fiecărei linii din cazul B, exact cum le scrie codul, în ordinea lui.
- **`colorKey(c)`:** comparația culorilor (litere mici, fără spații).
- **`linkStyle(study)`:** pură, idempotentă; aplică FD §„Setări salvate înainte”, cazul A:
  - pentru fiecare linie legată cu `plots[p].color`: dacă inputul nu e în `study.inputs` (adică e implicit), `inputs[input] = color`;
  - apoi `color` se scoate (și obiectul `plots[p]`, dacă rămâne gol).

### Catalogul
`STUDY_MODULES` primește `palette` pe liniile din `PLOT_PALETTES`, ca toate locurile (Stil, desenul, legenda) să le vadă din `plotConfig`.

### Desenul
- **`style.ts` → `styledEntry`:** paleta finală pe chei normalizate.
  - Culoarea de bază aleasă intră doar dacă paleta nu are deja o alegere pentru ea: `palette[def.color] = o.palette?.[def.color] ?? o.color`.
  - Un helper comun, **`pointColor(def, o, c)`**, e folosit și de legendă.
- **`renderer.ts`:** potrivirea paletei pe `colorKey`.
- **Liniile orizontale (cazul D):** `hlineConfig[i]` ia culoarea din `result.hlines` de pe aceeași poziție, cu același preț, când nu are una aleasă.
  - Helper: **`hlineDefault(mod, h, result)`**, folosit și de caseta din Stil (`o.color ?? hlineDefault(...)`).
  - Verificat pe toți indicatorii: la valorile implicite, culorile din rezultat și din configurare sunt aceleași, deci aspectul implicit nu se schimbă.

### Formularul (`StudySettings`)
- `initial()` pornește din `linkStyle(study)`.
- **Inputurile de culoare legate:** `ColorPicker` cu `lineWidth` / `lineStyle` ale primei linii.
  - Grosimea și tipul se scriu pe toate liniile inputului.
- **Liniile legate, în Stil:** valoarea e `draft.inputs[input]`, iar `onChange` scrie inputul.
- **Cazul C:** `ColorPicker` fără `onChange`, cu `value` = `linear-gradient` al inputurilor și `colorNote`.
- **Liniile orizontale:** valoarea e `o.color ?? hlineDefault(...)`.

### `Charts`
- Lista `studies` trece prin `linkStyle`, deci desenul, legenda și setările văd forma nouă.
- Salvările scriu forma nouă la prima „Salvează” din setări.

### Teste
**`color-links.test.ts`**, pe toți indicatorii, cu valorile implicite și cu fiecare bool / listă schimbată pe rând:
1. Fiecare culoare desenată de o linie din Stil (fără cele transparente) e culoarea ei sau din paleta ei. Excepțiile sunt doar liniile din `INPUT_LINES` (toate punctele în culoarea inputului) și din `INPUT_COLORED`.
2. Fiecare input de culoare, rulat cu o culoare-santinelă:
   - liniile vopsite întregi în santinelă sunt exact `INPUT_LINES[id][input]`;
   - cele vopsite parțial sau derivat sunt în `INPUT_COLORED`.
3. Fiecare culoare din `PLOT_PALETTES` e desenată măcar într-o rulare.

**`style.test.ts`:**
- `linkStyle`: cele două cazuri, idempotentă;
- paleta cu majuscule diferite;
- precedența `palette` față de `color`;
- `hlineDefault`.

## TD-PANES — implementează FIX-PANES
- **Lightweight Charts 5:**
  - `IPriceScaleApi.applyOptions` (și `setAutoScale`) cheamă `applyPriceScaleOptions`, care face `merge` în `options().rightPriceScale` al graficului, pentru orice panou;
  - `new Pane()` își creează scala din `model.options().rightPriceScale`.
- **`CandleChart`:**
  - imediat după `createChart`, `paneScale` reține `{ mode, autoScale, invertScale, scaleMargins }` din `chart.options().rightPriceScale`, înainte ca marginile sau logaritmul prețului să fie puse;
  - în efectul care reface panourile, fiecare `addPane` e urmat de `chart.priceScale('right', pane.paneIndex()).applyOptions(paneScale)`;
  - `merge`-ul scrie în opțiunile generale doar valorile implicite, iar panoul 0 nu e atins.
- **Verificare** (Chrome 1440 / 390 / 320 și WebKit, cu preț logaritmic):
  - Stoch RSI adăugat sub LMA din lista „Indicatori”, în pagină;
  - scala prețului trasă (autoscală oprită), apoi Stoch RSI și MACD adăugate, apoi Stoch RSI scos;
  - LMA ±0,5, Stoch RSI 0–120, MACD normal; nimic mai lat decât ecranul.
- **Fără test unitar:** biblioteca are nevoie de canvas, iar mediul de test (node, fără jsdom) nu-l are. Comportamentul e acoperit de verificarea în browser.


## TD-BOTTF — implementează FD-BOTTF
- **`shared/bot.ts` → `botEditSchema`:** `tf: common.tf.optional()` (Premium).
- **`BotService.edit`**, când `e.tf` diferă de `input.tf`:
  - strategia nu e `premium` → `ValidationError('Timeframe-ul contează doar la un bot Slingshot.')`;
  - pe acțiuni, fiecare simbol cu `stocks.timeframesFor` (aceeași regulă și același mesaj ca `check`);
  - `next.tf = e.tf`; `UPDATE` scrie și coloana `tf` (lista o citește de acolo).
  - Un `tf` egal cu cel de acum trece fără efect, la orice strategie.
- **Starea (`state.ts`):** `PremiumState.tf?: Timeframe`, timeframe-ul pe care sunt `lastBar`, `nextRead` și `signalTime`-ul pozițiilor.
  - `premiumState()` îl pune la creare (`this.input.tf`).
  - Lipsește doar în stările de dinainte de FD-BOTTF: prima verificare îl adoptă pe al botului, fără resetare (până acum timeframe-ul nu se putea schimba).
- **Motorul (`engine.ts`):**
  - `Purpose.p_open.signalTime` devine opțional.
  - **`retf(input)`**, chemat în `go()` imediat după comanda API-ului, înainte de reîncercarea unui ordin în așteptare, deci și pe pauză, cu o problemă sau cu bursa închisă. Doar Premium cu stare:
    - `ps.tf` lipsă → `ps.tf = input.tf`;
    - `ps.tf === input.tf` → nimic;
    - altfel: `lastBar = {}`, `nextRead = {}` (prima citire notează lumânarea închisă, ca la pornire);
    - `signalTime` se șterge din pozițiile deschise și din scopul unui `p_open` în așteptare (o poziție care trece după schimbare nu urmărește semnalul vechi);
    - notițele `history` și `read:…` ale simbolurilor se șterg, ca jurnalul să le spună din nou pentru timeframe-ul nou;
    - o notă `info` în jurnal (FD).
  - **De ce în motor, nu în API:**
    - numai motorul scrie `state`; API-ul scrie doar `config`;
    - o verificare care rulează în timpul salvării își scrie starea, iar următoarea vede diferența dintre `config.tf` și `ps.tf`;
    - nicio scriere nu se pierde, iar o schimbare dus-întors între două verificări nu resetează nimic.
- **Formularul (`BotFormView`):**
  - la editarea unui bot Premium, un `Field` „Timeframe-ul semnalelor” cu `TfSelect` (același `select` ca la crearea botului) și textul fix din FD (nu apare și nu dispare la schimbare, deci nu mișcă pagina);
  - `patch.tf = input.tf` pentru Premium;
  - rândul de sus nu mai arată timeframe-ul.
- **Teste (`engine.test.ts`):**
  - schimbarea fără poziții: lumânarea de 4h deja închisă, cu un semnal, nu deschide; următoarea deschide; nota din jurnal;
  - cu o poziție deschisă: invalidarea semnalului cu aceeași oră pe 4h nu o închide (pe codul vechi da); semnalul de TP de pe 4h o închide;
  - o intrare reală în reîncercare la schimbare: poziția nu are `signalTime`;
  - dus-întors înainte de o verificare: nicio notă, `lastBar` neatins; starea veche fără `tf` o adoptă;
  - API-ul: refuzul la Grid și DCA (același timeframe trece), refuzul pe acțiuni fără cheie (1w trece), lista cu timeframe-ul nou.
## TD-BOTSLRR — implementează FD-BOTSLRR
- **Înlocuit parțial de TD-BOTPCT** (aceeași zi): `sl` / `tp` / `rrRisk` / `rrReward` au devenit `levels` / `slPct` / `tpPct`. Restul (fără R:R la Slingshot, scorul, AI-ul) rămâne.
- **`shared/bot.ts`:**
  - `premiumSchema` = `z.preprocess(dropLegacyPremium, z.object({…}).strict())`:
    - `minRr` iese din obiect;
    - `dropLegacyPremium` scoate cheia `minRr` din setările salvate înainte, ca ele să se citească în continuare (strict), iar prima salvare să o șteargă.
  - **Raportul:** `rr` → `rrRisk` + `rrReward` (fiecare 0,01–1000; etichetele „Partea de risc / câștig a raportului”). `dropLegacyPremium` face dintr-un `rr` numeric `rrRisk: 1, rrReward: rr`. `rrText(p)` îl scrie „1:2” (virgulă zecimală).
  - **`checkBot`, la Premium:**
    - `tp === 'slingshot'` cu `sl !== 'slingshot'` → issue pe `['premium', 'sl']`, cu mesajul din FD;
    - la `tp === 'rr'`, câștig ÷ risc în afara [0,5; 10] → issue pe `['premium', 'rrReward']`, cu mesajul din FD.
    - Rulează și la `edit`, pentru că `BotService.edit` validează tot cu `botInputSchema`.
  - `BotEventDetail.rr` dispare (rândurile vechi îl au în JSON, dar nu-l citește nimeni).
  - Comentariul lui `ScorePart.value`: la Slingshot e structura (+1 / −1 / 0).
- **`premium.ts` → `levelsFor`:**
  - întoarce `{ sl, tp }`, fără `rr`;
  - `tp === 'slingshot'` → SL-ul și TP-ul semnalului, ambele;
  - altfel SL după `cfg.sl`, TP = preț ± `rrReward / rrRisk` × risc;
  - erorile „Prețul a trecut deja de stop loss.” / „Prețul a atins deja take profit-ul.” / TP sub zero rămân.
- **`score.ts`:**
  - `ScoreInputs.slingshot = { structure }`;
  - `a = 0,4 × ms`, `value = ms` (+1 / −1 / 0);
  - nota: „structura în direcție” / „structura împotrivă” / „fără rupere de structură”.
- **`engine.ts` (`decide` / `confirm`):**
  - verificarea `minRr` dispare;
  - `detail` primește `sl`, `tp`;
  - scorul primește doar structura;
  - AI-ul primește `levels: cfg.tp` în loc de `rr`.
- **`inputs.ts` (AI):**
  - `AiAsk.rr` → `AiAsk.levels: 'slingshot' | 'rr'`;
  - rândul prețului: „Stop loss: … Take profit: … (ale semnalului Slingshot)” sau „(TP-ul la raportul risc : câștig al utilizatorului)”;
  - `SYSTEM`: fără „nivelurile nu au sens” ca motiv de refuz. Regulă nouă: „Nu judeca stop loss-ul, take profit-ul sau raportul risc / câștig: le stabilește strategia.”
- **`service.ts` (`check`):** rândul de mărime spune „SL și TP: ale semnalului Slingshot.” sau „SL: al semnalului / x%; TP la raportul risc : câștig 1:2.” (`rrText`).
- **Formularul:**
  - **`bot-form.ts`:**
    - `DEFAULT_PREMIUM` și `NUMBER_FIELDS` fără `minRr`, cu `rrRisk: 1`, `rrReward: 2`;
    - `shownExit` înainte de `numbers`: câmpurile ascunse de alegerea ieșirii (raportul la Slingshot, `slPct` la SL-ul Slingshot) rămân cum sunt dacă sunt valide; altfel primesc valoarea implicită, ca să nu oprească salvarea;
  - **`BotFormView`:**
    - un `Seg` „Stop loss și take profit” (`tp`); „Slingshot” pune și `sl: 'slingshot'`;
    - lângă el, la „Risc / câștig”, „Raportul risc : câștig”: două `Num` (`min-w-0 flex-1`, ca să încapă în coloană) cu „:” între ele (`aria-hidden`; numele câmpurilor: „Riscul”, „Câștigul”); altfel o celulă goală;
    - textul fix din FD pe toată lățimea (`sm:col-span-2`);
    - la „Risc / câștig”, „Stop loss” (Slingshot / Procent) și procentul;
    - textul de la „Filtrul Sentiq” spune „structura pieței” în loc de „R:R-ul semnalului”.
- **Teste:**
  - **`strategies.test`:**
    - `levelsFor`: cu Slingshot, nivelurile semnalului la orice preț dintre ele; preț trecut de SL / TP refuzat;
    - scorul fără R:R (structura ±0,4);
    - schema: `minRr` vechi citit și scos; SL procentual cu TP Slingshot refuzat.
  - **`engine.test`:**
    - un semnal cu R:R de acum 0,2 intră cu SL-ul și TP-ul semnalului;
    - un bot salvat cu `minRr` rulează;
    - AI-ul nu primește R:R (promptul fără „R:R”);
    - API-ul refuză SL procentual + TP Slingshot.
  - **`bot-form.test`:** formularul implicit fără `minRr`, cu 1:2; 2:3 scris și citit înapoi la fel; un câmp gol; Slingshot cu SL procentual refuzat; câmpurile ascunse goale / greșite nu opresc salvarea.
  - **`strategies.test`:** și `rr` vechi → 1:R (`rrText` „1:2,5”), limitele 2:1 și 1:10.

## TD-INFOTIP — implementează FIX-INFOTIP
- **`components/InfoTip.tsx`:**
  - **Butonul:** `type="button"`, `aria-label="Explicația setării"`, `aria-expanded`, iar cât e deschis `aria-describedby` = id-ul bulei.
  - **Bula:** `role="tooltip"`, randată cu `createPortal` în `document.body`, `position: fixed`, `z-[70]` (peste `Modal`, care are `z-50`).
  - **Starea:** `hover` (doar `pointerType === 'mouse'`, din `pointerenter` / `pointerleave`) și `pinned` (click / tap / Enter / Space); deschisă = oricare dintre ele.
    - Click-ul face `preventDefault`: în eticheta unui checkbox nu-l comută.
  - **Închiderea:**
    - `pointerdown` în afara butonului și a bulei (pe `document`, în faza de captură) → `pinned = false`;
    - `Esc` → listener pe `window`, în captură, cu `preventDefault()` + `stopPropagation()`, deci `Modal` nu se închide;
    - o singură bulă deschisă: un eveniment `infotip-open` cu id-ul ei le închide pe celelalte.
  - **Poziția (`useLayoutEffect`):**
    - din `getBoundingClientRect()` al butonului și mărimea bulei;
    - sub iconiță la 6 px, sau deasupra când nu încape jos;
    - centrată pe iconiță, limitată la [8, lățimea ferestrei − 8 − lățimea bulei];
    - recalculată la `scroll` (captură) și `resize`; iconița ieșită din fereastră închide bula (ca `ColorPicker`);
    - lățimea `max-w-[min(280px,calc(100vw-16px))]`.
- **`StudySettings.tsx` (`tip`) și `Charts.tsx` (`tipIcon`):** iconița devine `<InfoTip text={…} />`, cu aceeași aliniere: `flex h-[1lh] items-center` la Charts, `inline-flex` la StudySettings. `title`-ul de pe controale rămâne (descrierea lor).
- **Verificare:**
  - Chrome la 1440 / 390 / 320 și WebKit (Safari): hover, click, tap, Esc, bula la marginea dreaptă și jos;
  - într-un checkbox, click pe (i) nu comută căsuța;
  - Esc închide întâi bula, apoi fereastra.
## TD-BOTPCT — implementează FD-BOTPCT
- **`shared/bot.ts` → `premiumSchema`:**
  - câmpuri noi: `levels: 'slingshot' | 'percent'`, `slPct` (0,1–50), `tpPct` (0,1–500);
  - dispar `sl`, `tp`, `rrRisk`, `rrReward` (și `rr`, `minRr` de dinainte).
  - **`upgradePremium`** (preprocesarea, în locul lui `dropLegacyPremium`), pentru setările salvate înainte:
    - `levels` = `tp === 'rr'` ? `'percent'` : `'slingshot'`;
    - `tpPct` = `slPct` × R, unde R = `rrReward / rrRisk`, altfel `rr`, altfel 2;
    - șterge `sl`, `tp`, `rr`, `rrRisk`, `rrReward`, `minRr`.
  - **`checkBot`:** la `levels === 'percent'`, `tpPct / slPct` în afara [0,5; 10] → issue pe `['premium', 'tpPct']`. Verificarea „SL procentual cu TP Slingshot” dispare (combinația nu mai există).
  - **`rrText(slPct, tpPct)`** = „1:” + raportul cu cel mult 2 zecimale, virgulă zecimală.
- **`premium.ts` → `levelsFor`:**
  - `slingshot`: nivelurile semnalului;
  - `percent`: SL = preț × (1 − dir × slPct / 100), TP = preț × (1 + dir × tpPct / 100);
  - aceleași erori (SL / TP depășit, TP sub zero).
- **`engine.ts`:**
  - ieșirile „Slingshot a marcat SL / TP-ul atins” doar la `levels === 'slingshot'`;
  - AI-ul primește `levels: cfg.levels`.
- **`inputs.ts`:** `AiAsk.levels: 'slingshot' | 'percent'`; textul „(procentele utilizatorului de la intrare)”.
- **`service.ts` (`check`):** „SL și TP: ale semnalului Slingshot.” sau „SL x% și TP y% de la intrare (risc : câștig 1:z).”
- **Formularul:**
  - **`bot-form.ts`:**
    - `DEFAULT_PREMIUM` cu `levels: 'slingshot'`, `slPct: 1`, `tpPct: 2`;
    - `NUMBER_FIELDS`: „Stop loss-ul”, „Take profit-ul”;
    - `shownExit`: la `slingshot`, `slPct` / `tpPct` ascunse rămân dacă sunt valide, altfel cele implicite;
    - `ratioOf(text, text)`: raportul afișat, sau „—”.
  - **`BotFormView`:**
    - `Seg` pe `levels`, lângă el o celulă goală;
    - explicația fixă din FD;
    - la `percent`, două `Field`: „Stop loss (% de la intrare)” și „Take profit (% de la intrare)”, apoi `<p>` pe toată lățimea cu raportul.
  - **`BotsDialog`:** „SL-ul și TP-ul semnalului, sau ale tale, în procente de la intrare (de exemplu 1% și 2%, adică 1:2)”.
- **Teste:**
  - **`strategies.test`:** `levelsFor` cu procente (long / short); `upgradePremium` (Slingshot vechi, „Risc / câștig” vechi cu SL %, raportul de azi); limitele; `rrText`.
  - **`engine.test`:** o intrare cu 1% / 2%; „Verifică”; setările vechi rulează; AI-ul primește sursa.
  - **`bot-form.test`:** implicit 1% / 2%, raportul afișat, câmpurile ascunse.
## TD-BROTLI — implementează FIX-BROTLI
- **`net/plain-fetch.ts` → `plainFetch(input, init)`:** subsetul de `fetch` folosit de `fetchText` (`method`, `headers`, `body`, `signal`, `redirect: 'follow'`), construit pe `node:http` / `node:https`, care nu decomprimă singure.
  - **Cererea:**
    - `accept-encoding: gzip, deflate` (dacă apelantul nu-l dă);
    - agentul global, deci și proxy-ul `NODE_USE_ENV_PROXY`;
    - `signal` distruge cererea, iar eroarea e `signal.reason` (deci `TimeoutError`).
  - **Răspunsul:**
    - `Content-Encoding` împărțit pe virgule, fără `identity`;
    - `br` / `zstd` oriunde în listă → `res.destroy()` și eroarea `BrotliRefused`, înainte de orice decodor;
    - `gzip` / `x-gzip` → `createGunzip`; `deflate` → `createInflate` sau `createInflateRaw`, după primul octet (`(b & 0x0f) === 8`), ambele cu `Z_SYNC_FLUSH`;
    - un token necunoscut → fără decodare, ca `undici`.
  - **Redirecționările** (301 / 302 / 303 / 307 / 308 cu `Location`):
    - urmate până la 20;
    - URL relativ rezolvat;
    - 303 (și 301 / 302 după POST) → GET fără corp;
    - `authorization` scos la schimbarea originii;
    - corpul răspunsului 3xx e aruncat, nedecodat.
  - **Rezultatul:** `new Response(Readable.toWeb(stream), { status, statusText, headers })`.
    - 204 / 205 / 304 au corp `null`.
    - Antetele multiple se adaugă pe rând.
    - `cancel()` pe corp distruge `pipeline`-ul, deci și socket-ul.
- **`net/http.ts`:**
  - `setFetchImpl` pune un cârlig (`hook`);
  - `fetchText` (și deci `fetchJson`) folosește `hook ?? plainFetch`;
  - `httpRequest` folosește `hook ?? fetch` (neschimbat).
  - `fetchText` traduce `BrotliRefused` în `HttpError('BROTLI', …)`, cu mesajul din FD.
- **Teste (`net/plain-fetch.test.ts`, server HTTP local):**
  - antetul cerut;
  - identity / gzip / deflate cu și fără zlib;
  - br și „gzip, br” refuzate, inclusiv cu un corp br invalid (eroarea e a noastră, nu a decodorului);
  - un token necunoscut trece brut;
  - redirecționări: relativă, 303 după POST, limita de 20, `authorization` scos la alt origin;
  - limita de timp la antete și la corp;
  - 304;
  - `fetchText` cap-coadă, cu bomba gzip peste limită.

## TD-BOTDIR — implementează FD-BOTDIR
- **`shared/bot.ts`:**
  - **`premiumSchema`:** `longMin` („Scorul minim pentru long”) și `shortMax` („Scorul maxim pentru short”), întregi 0–100, în locul lui `minScore`.
  - **`upgradePremium`** face două treceri independente:
    - FD-BOTPCT, ca înainte, doar fără `levels`;
    - FD-BOTDIR: cu `minScore` și fără `longMin` → `longMin = minScore`, `shortMax = 100 − minScore` (un `minScore` care nu e număr pică drept „Scorul minim pentru long: lipsește”). Cu `longMin` deja prezent, `minScore` se șterge.
  - **`ScorePart.a`:** înclinarea pieței (+1 în sus … −1 în jos). La evenimentele vechi, acordul cu tranzacția.
  - **`BotScore`:**
    - `min?` doar la evenimentele vechi;
    - `limit?: { side, value }` la cele noi, care marchează și scara pieței.
- **`server/bots/score.ts`:**
  - **`marketScore(x, weights)`** → `{ score, parts }`: `lean = (index − 50) / 50`, structura `'up' | 'down' | 'none'` → ±0,4. Notele: „ultima rupere în sus / în jos”, „fără rupere de structură”.
  - **`limitOf(side, cfg)`:** pragul laturii (`longMin` / `shortMax`), pus în `BotScore.limit`.
  - **`passes(side, score, cfg)`:** long `score ≥ longMin`, short `score ≤ shortMax`, pe scorul rotunjit (cel afișat).
  - **`favoured(side, score)`:** long → score, short → 100 − score. Ordonează două semnale de pe aceeași lumânare.
  - **`scoreReach(weights)`:** scorul cel mai mare posibil, rotunjit (`scoreTrade` dispare).
- **`server/bots/engine.ts`:**
  - **`decide`:**
    - structura → `'up'` / `'down'` / `'none'` din `msBullish` / `msBearish`;
    - `detail.score = { ...marketScore(…), limit }`;
    - refuzul cu textele din FD.
  - **`onBar`:** sortarea după `favoured`.
- **`server/bots/inputs.ts` (`aiPrompt`):** linia scorului pieței cu pragul laturii.
- **`server/bots/service.ts` (`check`):**
  - propoziția pragurilor după direcție;
  - avertismentele de prag de neatins (`scoreReach`), doar pentru direcțiile botului.
- **Formularul:**
  - **`bot-form.ts`:**
    - `DEFAULT_PREMIUM`: `longMin: 50`, `shortMax: 50`;
    - `NUMBER_FIELDS`: etichetele din schemă;
    - `keepHidden` primește `int`;
    - `shownExit` → `shownPremium`, care păstrează și pragul direcției ascunse;
    - `zoneText(premium)`: propoziția de sub praguri.
  - **`BotFormView`:**
    - „Filtrul Sentiq” cu explicația fixă;
    - `direction` = direcția afișată (doar long când formularul arată „doar long”: spot, acțiuni reale fără eToro);
    - un rând de două celule: pragurile direcției afișate, sau pragul și o celulă goală;
    - `<p>` cu `zoneText`, tot pe direcția afișată;
    - un rând cu „Ferește știrile” și „Pauză după o pierdere”.
  - **`BotDetailView` (`Journal`):**
    - `score.limit` → „Scorul pieței … (long de la X / short până la Y)” și „spre long / spre short” (ce se rotunjește la 0,00: „neutru”);
    - altfel textul vechi, cu „Scorul tranzacției”.
  - **`BotsDialog`:** textul Premium spune pragurile pe direcții.
- **Teste:**
  - **`strategies.test`:** `marketScore` (aceeași valoare pentru orice latură, structura în sus / în jos), `passes` la limite, `scoreReach`, `upgradePremium` (`minScore` 39 → 39 / 61; ambele forme).
  - **`engine.test`:** un short intră pe scor mic, un long e refuzat pe același scor, un short refuzat pe scor mare, un long intră pe el; două semnale pe aceeași lumânare; „Verifică” cu propoziția și avertismentul; editarea pragurilor.
  - **`bot-form.test`:** implicit 50 / 50, pragul ascuns (gol, zecimal, valid), erorile pragurilor arătate, `formOf` înapoi, `zoneText` în toate cazurile.
  - **`shared/bot.test`:** setările vechi (cu `minScore`) trec.

## TD-NEWSWIN — implementează FD-NEWSWIN
- **`BotFormView` („Filtrul Sentiq”):**
  - `Field` cu numele nou, `className="sm:col-span-2"` și hint-ul din FD;
  - `Num` cu `sm:w-[calc(50%-6px)]`, adică lățimea unei coloane din grila cu `gap-3`;
  - „Pauză după o pierdere (min)” rămâne în aceeași grilă, pe rândul următor.
- **Eticheta erorilor:** „Minutele dinaintea știrilor economice importante”, în `shared/bot.ts` (`whole(…)`) și `bot-form.ts` (`NUMBER_FIELDS`).
- **Ghidul:** numele nou și ce face setarea.
- **Teste:** `bot-form.test` cu mesajul unui câmp gol.

## TD-PINESYNC — implementează FIX-PINESYNC
- **`Sling Shot System/sling-shot-system-3.4.pine`** (repo separat, fișier necomis):
  - `indicator("[DE] Slingshot System 3.4", shorttitle="[DE] Slingshot 3.4", …)`;
  - cele 8 `str.tostring(…, "#.##")` (4 etichete de nivel, 4 celule din tabel) → `str.tostring(…, format.mintick)`;
  - o linie nouă în antet care spune schimbarea.
- **`docs/slingshot-port.md`:** dispare rândul despre precizia prețurilor din „Diferențe intenționate”; numele sunt aceleași.
- **FD-DENAMES §2:** nota că 3.4 primește numele „[DE]” (FIX-PINESYNC).
