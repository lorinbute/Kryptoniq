# Sentiq — Progress tracker

> Jurnalul lucrului, în ordine (Sentiq se numea Kryptoniq până pe 13 oct 2026). Primele 4 faze sunt v1; fiecare secțiune datată e o schimbare, cu FD / TD și review-ul ei.

Status legend: [ ] todo · [~] in progress · [x] done

## Phase 1 — Research
- [x] News sources (crypto + macro/markets) — free, local-friendly
- [x] Economic calendar sources
- [x] Sentiment scoring approach (per item + daily aggregate)
- [x] Charting library + OHLCV source
- [x] Slingshot indicator port (Pine v5 semantics: ema/rsi/stoch/atr/pivots)
- [x] KuCoin API (spot + futures, read-only, signing)

## Phase 2 — Design docs
- [x] docs/research.md
- [x] docs/functional-design.md
- [x] docs/technical-design.md

## Phase 3 — Implementation
- [x] Backend scaffold + API (smoke-tested on real data)
- [x] Frontend (React, dark theme) — verified with headless Chrome screenshots on real data
- [x] News ingestion + storage + sentiment
- [x] Daily sentiment algorithm
- [x] Economic calendar
- [x] Coin watchlist + news filter
- [x] Charts + Slingshot indicator
- [x] KuCoin trades/positions (server; needs real read-only key to verify)
- [x] Settings (API keys, encrypted at rest)
- [x] Tests (129 passing: indicator, news, sentiment, calendar, API/security/accounts/scheduler)

## Phase 4 — Review loop
- [x] Review rounds 1–13 (see docs/review-log.md); round 13: 0 issues

## Slingshot 3.3 — reparația urmăririi TP/SL (12 oct 2026)
- [x] Cercetare: cauza (3 resetări fără `if not waitingLongTP`), impact măsurat pe 75.000 de lumânări reale (154 cazuri, 47 alerte SL pierdute)
- [x] FD-SS33 / TD-SS33
- [x] Fixture de regresie creat înainte de reparație (`btc-usdt-1h.signals-v3.2.json`)
- [x] Pine `sling-shot-system.pine` → 3.3 (repo separat, necomis)
- [x] Port `slingshot.ts` + `SLINGSHOT_VERSION = '3.3'`
- [x] Teste (134 trec; scenariile noi pică pe logica 3.2)
- [x] Review rounds 1–3 (docs/review-log.md); runda 3: 0 probleme

## Pornire fără Terminal (12 oct 2026)
- [x] Cercetare: launchd + `~/Documents` (TCC cere Full Disk Access) → aplet AppleScript + Login Items; mediul minim al `do shell script`
- [x] FD-LAUNCH / TD-LAUNCH
- [x] `scripts/kryptoniq.sh` (start/stop/restart/status/open/logs/app), `KRYPTONIQ_QUIET`, `Kryptoniq.app` generat (ignorat de git)
- [x] Teste: 135 (config + retenție log-uri); scenarii reale ale lansatorului în mediul minim, ShellCheck
- [x] Review rounds 1–4 (docs/review-log.md); runda 4: 0 probleme
- [ ] De verificat de utilizator: dublu-click, promptul Documents, Login Items

## Redesign „Cockpit” (12 oct 2026)
- [x] Cercetare: capturile interfeței vechi, structura codului, datele reale pentru machete
- [x] Claude Design: prima variantă (recolorare) respinsă; 3 direcții noi (Cockpit, Briefing, Ceasul zilei); ales Cockpit; machete pentru Azi, Grafice, Știri, Calendar, telefon (https://claude.ai/artifact/BQz9e3jgyLeJd6GrKbrCNK)
- [x] FD-REDESIGN / TD-REDESIGN
- [x] Implementare: Geist + Geist Mono (locale), tokens noi, meniu sus, bandă de prețuri, căutare ⌘K, Azi pe un ecran, Calendar pe coloane, Știri cu bară de filtre, restul paginilor în stil tile
- [x] Teste: 143 (noi: `spark.test.ts`, `format.test.ts`); capturi la 1440 / 1024 / 390 px; ⌘K testat prin CDP
- [x] Review rounds 1–5 (docs/review-log.md); runda 5: 0 probleme

## Pagină neagră în Safari (12 oct 2026)
- [x] Cauza: `@fastify/static` cu `wildcard: false` nu servea fișierele construite după pornire; fallback-ul SPA trimitea HTML în loc de JS
- [x] FD-STATIC / TD-STATIC; reparație în `http/app.ts`; test de regresie
- [x] Review: runda 1 — 0 probleme

## Iconițe, bandă cu derulare automată, cursor, data în Știri (12 oct 2026)
- [x] Cercetare: colecția `@web3icons/core` (MIT), titluri reale din baza de date, comportamentul benzii
- [x] FD-ICONS / TD-ICONS
- [x] Implementare: `/api/logo/:symbol`, logo-uri de monede peste tot (insignă când lipsește), iconițe de subiect pentru știri, de tip pentru evenimente, pentru alerte și rezultate Slingshot, în meniu și pe titluri; banda se derulează singur și se oprește la hover; cursor de tip mână pe tot ce e clicabil; data deasupra orei în Știri
- [x] Teste: 152; verificări CDP; capturi la 1440 / 390 px
- [x] Review rounds 1–2 (docs/review-log.md); runda 2: 0 probleme

## Limita KuCoin 429000 la prețuri (12 oct 2026)
- [x] Cercetare: documentația KuCoin (limită de cont vs. limită de sistem la supraîncărcare); maparea erorilor în ccxt 4.5.85 (`429000` → `ExchangeError`); `loadMarkets` din ccxt repetă un eșec; încărcarea piețelor KuCoin cerea și lista completă de prețuri
- [x] FD-RATELIMIT / TD-RATELIMIT
- [x] Implementare:
  - `exchange/retry.ts`: limita e recunoscută, iar citirile se reîncearcă scurt;
  - lista de prețuri e comună, ținută 15 s și urmată de o pauză de 1 min după un refuz;
  - rezerve: prețuri individuale, apoi ultimele prețuri bune, cu ora lor;
  - recuperare după o încărcare a piețelor eșuată, la conturi și la grafice;
  - mesaj clar pe Tranzacții.
- [x] Teste: 161 (verificate prin mutație); rulare cu ccxt real contra KuCoin real
- [x] Review rounds 1–3 (docs/review-log.md); runda 3: 0 probleme
- [x] Repornirea serverului (`scripts/kryptoniq.sh restart`, azi `scripts/sentiq.sh restart`): făcută la actualizările ulterioare

## Grafice: fără grilă, setări ținute minte, LMA, ecran complet (12–13 oct 2026)
- [x] Cercetare:
  - `logarithmic-moving-average.pine` (Pine v6);
  - semantica PyneCore pentru `math.sum`, `ta.wma`, `ta.vwma`, `color.from_gradient`, `color.new`;
  - API-ul de panouri și primitive din lightweight-charts 5.2.1;
  - Fullscreen API în Chrome și WebKit.
- [x] FD-CHARTUX / TD-CHARTUX (+ §7 setări ca în TradingView, + §8 triunghiuri LONG / TAKE PROFIT)
- [x] Implementare:
  - portul LMA, cu panou, gradient, praguri, etichetă de stare, culorile lumânărilor, legendă și preseturi;
  - setările graficelor salvate pe server (pereche, timeframe, comutatoare, înălțimea panoului), zoom-ul în browser;
  - ecran complet cu buton de ieșire, Esc și ⌘K;
  - fără grilă și fără linii sub cursor;
  - fila Style a LMA;
  - triunghiuri Slingshot.
- [x] Teste: 180 (port LMA vs. referință scrisă direct din Pine; coada de salvare; zoom; schema)
- [x] Review rounds 1–7 (docs/review-log.md); runda 7: 0 probleme
- [x] Aplicația utilizatorului repornită (codul serverului s-a schimbat)

## PnL pe grafic pentru poziția KuCoin (13 oct 2026)
- [x] Clarificare cu utilizatorul: poziția reală de pe KuCoin, cu SL / TP din ordinele de pe exchange
- [x] Cercetare: câmpurile ccxt pentru ordine și poziții KuCoin (`info.stop`: futures `down` / `up`, spot `loss` / `entry`)
- [x] FD-PNL / TD-PNL
- [x] Implementare: `OrderRow.stop`; `web/chart/pnl.ts` (SL / TP / PnL curent, futures și spot, TP parțial, mai multe conturi, fără resturi mici); legat în „Pozițiile mele”
- [x] Teste: 189
- [x] Review rounds 1–3; runda 3: 0 probleme
- [x] Repornirea serverului (câmpul nou `stop` vine de la server): făcută la actualizările ulterioare

## Sentiq: acțiuni, conturi prin wizard, redenumire (13 oct 2026)
- [x] Clarificare cu utilizatorul: brokeri Trading 212, eToro, Interactive Brokers, Alpaca; exchange-urile crypto mari; date Twelve Data + Nasdaq; tot pachetul (favorite, grafice, știri, calendar, context, redenumire)
- [x] Cercetare (docs/research.md §8): API-urile brokerilor și ale exchange-urilor, sursele de date pentru acțiuni (Nasdaq, Twelve Data, CNN, RSS), brokerii fără API (XTB, Tradeville, Revolut, Degiro), logo-urile
- [x] FD-SENTIQ / TD-SENTIQ
- [x] Implementare:
  - redenumire în Sentiq, compatibilă cu datele, variabilele, antetul CSRF și lansatorul vechi;
  - migrarea 2 (credențiale generice, mediu, favorite cu tip, categoria „stocks”, surse automate);
  - wizard-ul de conturi (15 furnizori, cu logo, pași și câmpuri per furnizor), adaptoarele T212 / eToro / IBKR Flex / Alpaca și adaptorul ccxt generic;
  - date pentru acțiuni (Nasdaq fără cheie, Twelve Data cu buget local), favorite, grafice `/charts/s/AAPL`, banda și Azi, ⌘K;
  - știri despre acțiuni (feed Nasdaq automat per acțiune, surse noi, recunoaștere în titluri), sentiment cu defalcarea „Acțiuni”;
  - rezultatele trimestriale în calendar, contextul bursei americane (S&P 500, Nasdaq 100, VIX, F&G CNN, starea bursei), scanner pentru acțiuni, PnL pe graficele de acțiuni.
- [x] Teste: 259 (adaptoare, migrare, furnizori, date de acțiuni, detector, surse automate, calendar, scanner, rute, interfață)
- [x] Review rounds 1–11 (docs/review-log.md); runda 11: 0 probleme
- [x] `Sentiq.app` generat (`scripts/sentiq.sh app`); vechiul `Kryptoniq.app` și `scripts/kryptoniq.sh` au fost scoase ulterior din proiect
- [ ] De făcut de utilizator: prima conectare reală a unui broker

## Bifa Slingshot și favoritele reordonate prin tragere (13 oct 2026)
- [x] Cercetare: cum desenează `CandleChart` Slingshot (norul, triunghiurile, segmentele ATR / MS, caseta TP / SL); biblioteci de tragere (`@dnd-kit` 6.3.1 / 10.0.0: mouse, touch, liste pe mai multe rânduri, React 19)
- [x] FD-CHARTFAV / TD-CHARTFAV
- [x] Implementare: `charts.showSlingshot`, bifa „Slingshot” lângă „LMA”; cipurile favoritelor și rândurile din Setări se trag (mouse, touch, Alt + săgeți); ordinea se salvează imediat, în ordinea mutărilor
- [x] Teste: 262; verificări în Chrome (mouse, touch, tastatură, eroare la salvare, ecran complet)
- [x] Review rounds 1–2 (docs/review-log.md); runda 2: 0 probleme

## Utilizatori: cont, email, 2FA, passkey, admin (13 oct 2026)
- [x] Clarificare cu utilizatorul: date separate pe utilizator; cheia Resend de dezvoltare din Serento.Web; adminul `accounts@dustyenterprise.com`; acces și din rețeaua locală
- [x] Cercetare: identitatea din Serento.Web (`Auth/*`, `AccountController`: parole, TOTP, coduri de recuperare, passkey, throttle, Resend), `@simplewebauthn` 13, `uqr`, WebAuthn pe localhost / IP
- [x] FD-USERS / TD-USERS
- [x] Implementare:
  - migrarea 3 (utilizatori, sesiuni, passkey-uri, linkuri, setări pe utilizator; favoritele, conturile și evenimentele devin ale adminului);
  - `server/auth/*` (parole scrypt, TOTP, coduri de recuperare, throttle, sesiuni, Resend, utilizatori, passkey-uri), rutele de autentificare, cont și admin, verificarea sesiunii pe fiecare rută;
  - datele pe utilizator: favorite, setări, conturi, evenimente, scanner, sentimentul în fusul fiecăruia, filtrul de știri;
  - ecranele de login, înregistrare, confirmare, parolă uitată, prima parolă de admin; paginile Securitate și Utilizatori; secțiunea Email (Resend);
  - ascultare pe rețeaua locală (cu lista de gazde), `localhost` în lansator, `admin-email` / `admin-reset`.
- [x] Teste: 296 (TOTP RFC 6238, parole, throttle, sesiuni, fluxuri HTTP, izolarea datelor, admin, Resend, passkey cu autentificator construit în test); parcurs complet în Chrome cu autentificator virtual
- [x] Review rounds 1–6 (docs/review-log.md); runda 6: 0 probleme


## Importanța știrilor după Claude; geopolitica la 0,8 (13 oct 2026)
- [x] Cercetare (research §9): importanța din cuvinte-cheie vs. cea de la Claude pe 1.240 de știri reale
- [x] FD-IMPACT / TD-IMPACT
- [x] Implementare: migrarea 4 (`news.sentiment_impact`, completată din scorurile existente; relevanța geopolitică 0,6 → 0,8); importanța de la Claude scrisă odată cu scorul și folosită de index (cuvintele-cheie doar la știrile notate local); istoricul recalculat o dată (`INDEX_VERSION` 2), fără zilele tăiate de retenție; „De ce acest scor?” arată importanța și sursa ei
- [x] Teste: 302
- [x] Review rounds 1–3 (docs/review-log.md); runda 3: 0 probleme

## Pagina „Economie”: indicatorii economici pe țări (13 oct 2026)
- [x] Cercetare (research §10): calendarul TradingView (ticker, perioade, unități, publicările viitoare, limita de 2.000 de evenimente pe cerere, ~5 săptămâni de program), FRED, Eurostat / BCE
- [x] FD-ECON / TD-ECON
- [x] Implementare: migrarea 5 (`econ_indicators`, `econ_releases`); `economy/service.ts` (citire cu împărțire la limită, istoric ~400 de zile o dată, programul zilnic, valorile proaspete din citirile Calendarului), `economy/names.ts` (nume în română, grupe, esențiale); `GET /api/economy` (+ descrierea la cerere); pagina „Economie” (esențiale, tabele pe grupe, următoarea publicare, istoric, căutare, „Doar importante”)
- [x] Teste: 315; verificat pe date reale și în Chrome (1440 și 390 px)
- [x] Review rounds 1–3 (docs/review-log.md); runda 3: 0 probleme

## Culori pe pagina „Economie” (13 oct 2026)
- [x] Cercetare (research §11): sensul fiecărui indicator (creșterea bună / rea / neutră), pe toate cele 344 de nume reale
- [x] FD-ECONCOLOR / TD-ECONCOLOR
- [x] Implementare: `polarityOf` (reguli pe nume + grupa), `polarity` în răspuns; valoarea și schimbarea (▲ / ▼) colorate în fișe și tabele, istoricul auriu cu punctul final colorat, prognoza colorată, legendă, „bine / rău” și în text pentru cititoarele de ecran
- [x] Teste: 317
- [x] Review rounds 1–3 (docs/review-log.md); runda 3: 0 probleme


## Țările din pagina „Economie” ca filtre (13 oct 2026)
- [x] Cercetare în cod (cipurile, stilul `aria-pressed`, filtrele existente), FD-ECONFILTER / TD-ECONFILTER
- [x] Implementare: „Toate” + câte un cip pe țară, cu numărul de indicatori; o singură țară activă; filtrul în adresă (`?tara=`); împreună cu căutarea și „Doar importante”; bara de filtre pe două rânduri
- [x] Teste: 318; verificat în Chrome (1440 și 390 px)
- [x] Review rounds 1–3 (docs/review-log.md); runda 3: 0 probleme

## „Rezumat”: rezumatul zilei cu Claude, pe pagina Azi (13 oct 2026)
- [x] Cercetare (research §12): datele din aplicație, ieșirea structurată, costul, graficele; FD-SUMMARY / TD-SUMMARY
- [x] Implementare: migrarea 6 (`day_summaries`), contextul zilei (`summary/context.ts`, cu seriile graficelor), `SummaryService` (Claude Opus 5.5, ieșire structurată, o generare în curs pe utilizator, pauză de 2 min), `GET`/`POST /api/summary`; butonul „Rezumat” pe Azi și fereastra (verdict, secțiuni, oportunități / riscuri / ce urmează, grafice linie și bare)
- [x] Teste: 324; un rezumat real (25 s) pe o copie a datelor; verificat în Chrome (1440 și 390 px, tastatură)
- [x] Review rounds 1–5 (docs/review-log.md); runda 5: 0 probleme

## Connector Claude (MCP) pe abonamentul fiecăruia — gata, oprit până la găzduire (13 oct 2026)
- [x] Cercetare (research §13): termenii Anthropic (abonamentele nu pot fi folosite de aplicații), specificația MCP 2026-07-28 (OAuth 2.1, RFC 9728 / 8414 / 8707 / 9207, CIMD, DCR), cerințele concrete ale Claude (CIMD cu `token_endpoint_auth_methods_supported: ["none"]`, callback-uri, refresh), SDK-ul TypeScript v2 (`@modelcontextprotocol/server` 2.3.1)
- [x] FD-MCP / TD-MCP
- [x] Implementare: `config` (`SENTIQ_PUBLIC_URL`, `SENTIQ_MCP`, `SENTIQ_MCP_CLIENTS`), migrarea 7, `mcp/oauth.ts` (server de autorizare: CIMD + DCR restrâns, PKCE S256, coduri de 60 s, acces 1 h, refresh rotit 30 de zile cu detectarea refolosirii, audiența token-ului), `mcp/server.ts` (8 unelte doar citire + 2 prompturi + instrucțiuni), `mcp/routes.ts` (metadata, `/oauth/*`, `/mcp` cu Bearer, limite de cereri, API pentru pagini), scutirile din `security.ts`, revocări la ieșirea de peste tot / resetare / dezactivare, curățenie zilnică; pagina „Conectezi Claude la Sentiq?” și secțiunea „Claude (connector)” din Securitate
- [x] Teste: 336 (12 noi, cu clientul SDK real, plus legarea cererii de browser); verificat pe o copie a datelor (server de test cu connectorul pornit pe `http://localhost:4399`): Chrome → autorizare → login → consimțământ → callback, token, client MCP real pe toate uneltele (BTC 4h, NVDA 1d, SOL 15m), documentul real al Claude citit de pe claude.ai
- [x] Review rounds 1–7 (docs/review-log.md); runda 7: 0 probleme
- [x] Aplicația repornită cu connectorul oprit (migrarea 7: tabele goale); backup `data/backups/kryptoniq-before-mcp-2026-10-13.db`
- [ ] La găzduire: adresa publică, `trustProxy`, cookie `Secure`, passkey pe domeniu (FD-ul de hosting), apoi conectarea fiecărui utilizator

## Conturi doar la cerere, aprobate de admin (13 oct 2026)
- [x] Cercetare în cod (înregistrarea, confirmarea, linkurile unice, Resend de test, pagina Utilizatori; în baza reală doar contul de admin), FD-INVITE / TD-INVITE
- [x] Implementare: migrarea 8 (`account_requests`, tokenul `activate`), `UserService` (cerere, aprobare, respingere, link nou, activare, curățenie la 30 de zile; scoase înregistrarea, confirmarea, retrimiterea, „Confirmă emailul”, ștergerea conturilor neconfirmate), rutele (`/api/auth/request-account`, `/api/auth/activate[/check]`, `/api/admin/account-requests…`, `/api/admin/users/:id/activation-link`), emailurile `activate` și `request` (linkul de activare niciodată în jurnal); paginile „Cere un cont” și „Activează-ți contul”, panoul de cereri din Utilizatori cu linkul de trimis, punctul din meniul contului
- [x] Teste: 337; verificat în Chrome pe o copie a datelor (fără cheia Resend, ca să nu plece emailuri reale), 1440 și 390 px: cerere → punct la admin → aprobare cu link → activare → login → intrare; linkul a doua oară refuzat
- [x] Review rounds 1–3 (docs/review-log.md); runda 3: 0 probleme
- [x] Aplicația repornită (migrarea 8); backup `data/backups/kryptoniq-before-invite-2026-10-13.db`

## „Importing a module script failed.” după actualizări (13 oct 2026)
- [x] Cauza: fiecare build (`emptyOutDir: true`) ștergea fișierele paginilor încărcate la cerere ale versiunii anterioare; un tab deschis înainte de actualizare nu le mai găsea (azi, multe build-uri la rând). La fel în timpul unei reporniri a serverului
- [x] FD-STALE / TD-STALE
- [x] Implementare: build-ul păstrează fișierele versiunilor anterioare 7 zile (`src/build/prune-assets.ts`, plugin în `vite.config.ts`); `web/stale.ts`: la un import eșuat (`vite:preloadError`), o singură reîncărcare automată la 30 s, după ce serverul răspunde (cel mult un minut); mesaj în română în `ErrorBoundary`
- [x] Teste: 343; în Chrome: fișierul paginii lipsă o dată → o reîncărcare și pagina; lipsă mereu → o reîncărcare, apoi mesajul, fără buclă; server oprit în timpul încărcării → așteaptă, apoi reîncarcă singur când serverul revine; fișierele vechi servite (200), unul inexistent 404
- [x] Review rounds 1–3 (docs/review-log.md); runda 3: 0 probleme

## Tema luminoasă și comutatorul (13 oct 2026)
- [x] Cercetare în cod (tokenurile Tailwind v4 din `styles.css`, culorile scrise direct, graficul pe canvas, CSP fără script inline), contrastul paletei calculat (minim 4,66:1), FD-THEME / TD-THEME
- [x] Implementare: tema luminoasă pe aceleași tokenuri (`:root[data-theme='light']`), tokenuri noi (`brass-hover`, `on-brass`, `scrim`, `shadow`), umbrele și fundalurile ferestrelor din tokenuri, gradientul sentimentului, `public/theme.js` (tema înainte de desen), `web/theme.ts` (localStorage `sentiq:theme`, sincronizare între taburi), `ThemeToggle` (bara de sus, paginile de login; pe telefon în meniul contului), graficul recolorat la comutare, liniile PnL în paleta luminoasă, logo-ul Revolut pe placă, tabelul TP/SL pe placă închisă
- [x] Reparat în trecere: rândul cu consumul Twelve Data din Setări lărgea pagina pe telefon (`.num` nu rupe rândul)
- [x] Teste: 348; verificat în Chrome: toate paginile în ambele teme (1440 și 390), comutarea fără reîncărcare, graficul recolorat, al doilea tab urmează, fără clipire la încărcare
- [x] Review rounds 1–3 (docs/review-log.md); runda 3: 0 probleme

## Tema luminoasă refăcută: Navy, rânduri alternate, hover, graficul pe placa lui (13 oct 2026)
- [x] Trei direcții pe pânza Claude Design (Cobalt, Pastel, Navy); aleasă **Navy** (bară bleumarin, accent turcoaz), cu rândurile alternate, hover-ul vizibil și graficul pe placă și pe tema întunecată
- [x] Cercetare în cod (graficul pe `bg-ink` = culoarea paginii, hover-urile, tabelele `.table` și listele cu rânduri), contrastul calculat pentru fiecare text pe fiecare fundal, FD-THEME2 / TD-THEME2
- [x] Implementare: accentul redenumit `brass` → `accent`; paleta Navy; tokenuri noi (`chart`, `row-alt`, `row-head`, `hover`, `hover-soft`, `selected*`, `bar`, `strip`, `nav-*`, `--panel-shadow`); „insula” `.theme-bar` (bara și banda închise pe tema luminoasă) și `.theme-page` (meniul contului); rânduri alternate și hover pe tabele (`.table`, rândul de detalii din Economie exclus) și liste (`.rows`); `table-bleed` (favoritele din Setări); hover-uri noi pe butoane, cipuri, segmente, navigare, banda pieței, carduri, meniuri, ⌘K; graficul pe `--color-chart`; linia de intrare PnL turcoaz
- [x] Teste: 356 (nou `palette.test.ts`: contrastul fiecărui text pe fiecare fundal în ambele teme și pe bară, tokenurile insulei resetate de `.theme-page`, niciun `brass` rămas); verificat în Chrome pe o copie a datelor: toate paginile în ambele teme (1440 și 390, fără depășiri, fără erori), hover-ul simulat pe 20 de elemente, meniul contului, ferestrele, ecranul complet, comutarea
- [x] După feedback: rândurile alternate pe tema întunecată mai discrete (`#12171f`); tema luminoasă neschimbată

## Fără platformele care nu au API (13 oct 2026)
- [x] Cererea: „elimină exchange-urile / brokerii care nu au API. Ce rost are să îi afișăm?”; FD-NOAPI / TD-NOAPI
- [x] Implementare: XTB, Tradeville, Revolut și Degiro scoase din `shared/providers.ts` (fără câmpurile `available` / `unavailableReason`), asistentul fără carduri dezactivate, serverul fără verificarea de disponibilitate (un id necunoscut era deja refuzat), logo-urile lor șterse; build-ul curăță și fișierele scoase din `public/` după o săptămână (`pruneRemovedPublic`)
- [x] Teste: 357; Chrome pe o copie a datelor: 11 platforme, filtrul „Acțiuni” cu 4, căutarea „xtb” fără rezultat
- [x] Review rounds 1–2 (docs/review-log.md); runda 2: 0 probleme
- [x] Aplicația repornită (codul serverului s-a schimbat; fără migrare)

## Documentația adusă la zi, cu noul nume (13 oct 2026)
- [x] Cererea: „actualizează documentele să reflecte ce face acum aplicația și noul nume”
- [x] FD și TD: Partea I (aplicația de azi, cu numerotarea v1 păstrată, ca trimiterile din cod să rămână valide, plus subiectele noi) și Partea a II-a (istoricul deciziilor, cu ce a fost înlocuit); README, ghidul, research, PROGRESS, portul indicatorului și jurnalul de review cu numele Sentiq
- [x] Fiecare afirmație din Partea I verificată în cod (config, securitate, migrații, job-uri, rute, setări, surse, piață, brokeri, connector)

## Baza de date în Azure SQL; pregătit pentru Azure App Service (14 oct 2026)
- [x] Cererea: găzduire pe Azure; „rescrierea este 100% de făcut […] vom folosi o bază de date SQL de la Microsoft”; fără mașină virtuală Linux administrată de mână → Azure SQL Database + App Service pe Linux administrat de Microsoft; FD-AZURE / TD-AZURE
- [x] Baza `sentiq` pe serverul `serento-sql` (creată de utilizator), utilizatorul `sentiq_app` doar pe ea (`db_owner`), conexiunea în `data/database.env` (`chmod 600`, gitignored)
- [x] Stratul de date rescris (`mssql`): parametri, `BIGINT`, scrieri serializate cu `sp_getapplock`, tranzacții cu `AsyncLocalStorage`, reîncercări, erori de pornire în română; schema T-SQL (migrarea 1 = cele 8 SQLite); tot codul care atinge baza devenit asincron, secvențele citire → scriere în tranzacții; scrieri în loturi cu `OPENJSON`
- [x] Joburile pe o singură instanță (`job_lease`); modul Azure (IP, HTTPS, sonda, HSTS, `PORT`, `/home/data`); Stare sistem cu baza și instanța joburilor
- [x] Import din SQLite (`scripts/sentiq.sh import-sqlite`), `db-check`, ghidul de publicare `docs/deploy-azure.md`
- [x] Teste: 370+ pe Azure SQL, în scheme `t_…` create și șterse de setup-ul global
- [x] Review rounds (docs/review-log.md)
- [x] Mutarea datelor de pe Mac în Azure SQL și repornirea aplicației (14 oct, 01:13–01:15, după ce o comandă a mea a oprit aplicația; backup `data/backups/kryptoniq-before-azure-2026-10-14.db`)
- [x] Publicarea pe App Service (14 oct): aplicația `sentiq` (Austria East, B1), creată de utilizator; build-ul prin `scripts/azure-build.sh` (`CUSTOM_BUILD_COMMAND`); firewall-ul `serento-sql` cu toate cele 13 IP-uri de ieșire (adăugate de utilizator); rulează la `https://sentiq-e9f4hfa0ababh0ax.austriaeast-01.azurewebsites.net` din 08:15 UTC, pe aceeași bază cu Mac-ul (joburile le ține instanța care are `job_lease`)
- [x] Reparat la publicare: erorile de login la pornire (firewall, parolă) erau raportate ca „serverul nu răspunde” (review-log, rundele 9–11)
- [x] Domeniul: utilizatorul a legat **`sentiq.money`** (cu certificat) și a pus `SENTIQ_PUBLIC_URL=https://sentiq.money`; `sentiq.app` nu mai e folosit
- [ ] Passkey-urile refăcute pe sentiq.money (fiecare utilizator, în Securitate)

## Connectorul Claude pornit; setările adminului separate; feed-urile automate; Azi (14 oct 2026)
- [x] Cercetare: cerințele actuale ale Claude pentru connectori (claude.com/docs/connectors: 401 cu `resource_metadata`, CIMD cu `none`, callback-uri, refresh rotit, limite de timp, abonamentele), documentele CIMD reale ale Claude și Claude Code; cauza „Nasdaq: BSOL” (copiile SQLite: BSOL în favorite pe 13 oct, apoi scos; feed-ul ținut până la expirarea știrilor); cauza plăcilor lungi de pe Azi (rândul cu favoritele pe ecrane late)
- [x] FD-ONLINE, FD-ADMINSET, FD-AUTOFEED, FD-TODAYGRID + TD-urile lor
- [x] Connectorul pornit pe App Service (`SENTIQ_MCP=1`, 11:29 UTC); verificat din exterior: metadatele, 401, autorizarea cu documentul real al Claude până la pagina de consimțământ
- [x] Adresa publică în bază (`public_instance`): linkurile de activare făcute pe Mac duc la sentiq.money; panoul connectorului și pe Mac; textele „doar pe Mac” refăcute
- [x] Setări: filele „Ale mele” și „Admin” (doar admin; `/settings/admin`, ⌘K „Setări admin”); detaliile Resend nu mai ajung la utilizatori
- [x] Feed-ul automat al unei acțiuni se șterge (cu știrile lui) când acțiunea nu mai e în favoritele nimănui; BSOL pleacă la prima pornire
- [x] Azi: sentimentul în stânga, evenimentul și știrile live în dreapta pe toată înălțimea lui (de la 768 px); „Ce mișcă piața” și „Ultimele 30 de zile” deasupra favoritelor; favoritele pe toată lățimea
- [x] Teste: 391 pe Azure SQL; verificat în Chrome pe o schemă de test (cu știrile și calendarul reale din ultimele 36 h): admin / utilizator, filele, ancorele, căutarea, Securitate, login pe IP, bannerul offline, Azi la 1600 / 1440 / 1280 / 1024 / 800 / 390 px
- [x] Review rounds (docs/review-log.md, rundele 12–16; ultima fără probleme)
- [x] Publicat pe Azure (deploy `e246b51e`, 12:27 UTC; BSOL șters la pornire) și aplicația de pe Mac repornită pe codul nou (15:27 ora României)
- [x] Incident la publicare: primul build a fost întrerupt de mutarea aplicației pe alt worker; fără `oryx-manifest.toml`, site-ul a fost căzut 12:11–12:27 UTC. Reparat prin ștergerea lacătului rămas și o publicare nouă; pașii sunt în `deploy-azure.md` §5

## Prețurile crypto de la exchange-ul fiecăruia; „Grafice și scanner” scos din setările clientului (14 oct 2026)
- [x] Cercetare: ce dă fiecare dintre cele 7 exchange-uri conectabile (ccxt + verificare live pe datele publice, cu favoritele adminului): KuCoin, Binance, Bybit, OKX, Bitget dau tot (Bybit / OKX / Bitget fără 8h); Kraken (6 din 10 perechi lipsă, doar 720 de lumânări) și Coinbase (7 din 10 lipsă, fără 4h și 1w) nu pot fi surse
- [x] FD-MARKETSRC + TD-MARKETSRC
- [x] Implementare: `market/source.ts` (exchange-ul conectat → cel ales → cel implicit; perechea / timeframe-ul lipsă → cel implicit), Bitget ca sursă nouă, `marketData` global (exchange implicit + istoric) mutat din setările adminului, `/api/market/source`, lumânările, căutarea, scanner-ul și `get_chart` pe sursa utilizatorului; interfața: fără „Grafice și scanner”, alegerea dintre conturi, Date de piață la Admin, comutatorul semnalelor pe Azi, timeframe-urile lipsă dezactivate pe grafic
- [x] Teste noi (`market/source.test.ts`); verificat în Chrome pe o schemă de test (OKX + Bybit: alegerea, 8h dezactivat cu nota „OKX nu are 8h; graficul arată 6h”, comutatorul pe Azi, Admin → Date de piață, 1440 și 390 px)
- [x] Review rounds (rundele 17–19; ultima fără probleme)
- [x] Publicat pe Azure și pe Mac (împreună cu cardurile din Tranzacții)

## Tranzacții: soldul futures și rezultatele pozițiilor închise; textul de la Favorite (14 oct 2026)
- [x] Cercetare: istoricul pozițiilor închise în ccxt (KuCoin clasic / UTA, Bybit, OKX, Bitget; Binance fără), limitele KuCoin (7 zile pe cerere, 3 luni păstrate, `pnl` net de comisioane și funding), soldul futures (`account-overview`)
- [x] Întrebări puse utilizatorului: perioada (a ales selectorul Azi · 7z · 30z · 90z) și ce e o tranzacție (o poziție futures închisă)
- [x] FD-TRADESTATS + TD-TRADESTATS
- [x] Implementare: `exchange/trade-stats.ts` (ferestre de 7 zile cu înjumătățire, paginile OKX, numărarea), `AccountsService.tradeStats` (cache 5 min) și `futuresAvailable`, `/api/portfolio/:id/stats`; pagina Tranzacții cu 7 carduri, perioada ținută minte, „Reîmprospătează” lângă „Adaugă un cont”; textul de la Favorite pe toată lățimea
- [x] Teste noi (`trade-stats.test.ts`, portofoliul din `server.test.ts`); verificat în citire pe contul KuCoin real (clasic: soldul futures se citește; 1 / 3 / 3 / 3 poziții închise pe Azi / 7z / 30z / 90z, 90z în ~2 s) și în Chrome pe o schemă de test (1440, 390)
- [x] Review rounds (rundele 20–22; ultima fără probleme)
- [x] Publicat pe Azure (deploy `4cc0acb2`, 14:24 UTC) și pe Mac (17:16 ora României), împreună cu sursa prețurilor; `marketData` mutat din setările adminului (KuCoin, 1500)
- [x] Incident la publicare: build-ul întrerupt din nou (memoria B1 cu aplicația pornită), site-ul căzut 14:16–14:24 UTC; reparat ca la prânz; cauza și varianta de încercat în `deploy-azure.md` §5

## Connectorul și pentru ChatGPT și Gemini (14 oct 2026)
- [x] Cercetare: OAuth-ul ChatGPT (CIMD `chatgpt.com/oauth/client.json`, `private_key_jwt` + `none`, întoarcere `connector_platform_oauth_redirect` cu `iss`, DCR alternativ), aplicația Gemini (Custom apps, DCR, întoarcere `oauth-redirect.googleusercontent.com/r/…`, doar unele conturi) și Gemini CLI (loopback); documentele citite de pe Azure (200)
- [x] FD-MCPMULTI + TD-MCPMULTI
- [x] Implementare: gazdele implicite, CIMD cu `none` acceptat, DCR cu metodă cu secret → public, `client_id` din antetul Basic / `client_assertion`, textele (consimțământ cu numele aplicației, „Asistenți AI (connector)” cu pașii)
- [x] Teste: ChatGPT (documentul real, Basic), un document doar cu semnătură refuzat, Gemini prin DCR (`client_secret_basic`, `client_assertion`)
- [x] Review rounds (rundele 23, 24 și 28; ultima fără probleme)
- [x] Publicat pe Azure (deploy `608d7489`, 15:21 UTC, cu aplicația oprită în timpul build-ului) și pe Mac (18:22 ora României); verificat: `authorize` cu documentele reale ChatGPT și Claude ajunge la consimțământ

## Lacătul de scriere blocat după publicare (reparație, 14 oct 2026)
- [x] Incident: 14:25–14:35 UTC nicio scriere (o sesiune a containerului vechi cu tranzacția deschisă, reînnoirile lease-ului alipite ei); rezolvat manual cu `KILL` după verificarea sesiunii (tranzacție de 598 s)
- [x] FD-DBHEAL + TD-DBHEAL: lease-ul și joburile `detached`, autovindecarea (sesiune Sentiq blocată > 5 min → `KILL`, în jurnal), oprirea limitată la 15 s, publicarea cu aplicația oprită
- [x] Teste (`db/heal.test.ts`)
- [x] Publicat împreună cu MCPMULTI; procedura nouă a mers (pauză planificată de ~11 minute, build neîntrerupt); `az webapp start` se dă când deploy-ul arată `status 4`

## Săgețile de trend, înălțimea câmpurilor, perioada din Tranzacții (14 oct 2026)
- [x] FD-UIPOLISH + TD-UIPOLISH
- [x] Implementare: săgeți verzi / roșii în locul cuvintelor Uptrend / Downtrend pe fișele de pe Azi; câmpurile și dropdown-urile la înălțimea butoanelor (38 px, 44 pe ecrane tactile) peste tot; favoritele centrate pe verticală, căutarea la înălțimea comutatorului; perioada din Tranzacții lângă butoane; codul pentru Gemini CLI se rupe pe rânduri
- [x] Verificat în Chrome (1440, 1024, 390, și cu ecran tactil emulat)
- [x] Review rounds (rundele 25–27; ultima fără probleme)
- [x] Publicat pe Azure și pe Mac (împreună cu MCPMULTI și DBHEAL)


## Indici în favorite: SPX, NDX, COMP, DJI, RUT, VIX, SOX (14 oct 2026)
- [x] Cercetare: Nasdaq dă doar indicii proprii (NDX, COMP, SOX, `assetclass=index`, 10 ani de istoric); Cboe dă SPX, VIX, RUT și DJX (= Dow / 100) cu 15 min întârziere și istoric lung (SPX din 1975, cu deschideri 0 până în 1996; RUT din 2020); Yahoo (429), Stooq (cere JavaScript) și Twelve Data gratuit (fără indici) nu merg; pagina „Use of Content” a Cboe cere acordul lor pentru date
- [x] FD-INDICES + TD-INDICES
- [x] Implementare: `shared/indices.ts` (catalogul, id-ul `^SPX`), `market/indices.ts` (Cboe, Nasdaq `index`, istoricul comun 5 min), rutarea în `StockData`, favoritele (`kind = 'index'`, fără migrare), lumânările / cotațiile / graficul mic, scanner-ul, aliasurile în știri, connectorul (`get_chart ^SPX`), Rezumatul; interfața: „Indici” în Setări (lista de 7 sub câmp), fișele de pe Azi, banda, Grafice (`/charts/i/SPX`, doar 1d / 1w, întârzierea), ⌘K, Știri
- [x] Reparat pe drum: răspunsurile la adăugări rapide în Setări puteau sosi în altă ordine și ascundeau din listă favorite salvate
- [x] Teste noi (`shared/indices.test.ts`, `market/indices.test.ts`, API, scanner, știri, MCP); verificat în Chrome pe o schemă de test cu date reale de la Cboe și Nasdaq (toți 7 indici: preț, variație, semnal; graficul SPX; filtrul de știri SPX; 1440 și 390 px)
- [x] Review rounds (rundele 29–31; ultima fără probleme); Cboe și Nasdaq verificate și de pe Azure
- [x] Publicat pe Azure (deploy `6330eb3b`, aplicația oprită 16:11–16:16 UTC, build neîntrerupt) și pe Mac (19:16 ora României); fără migrare de schemă

## Centrarea favoritelor, dropdown-urile în Safari, connectorul în Setări și consumul cheii Claude (14 oct 2026, seara)
- [x] Cauza centrării (pictogramele și simbolul pe linia de bază a textului, ~3 px mai sus) → FD-ROWCENTER / TD-ROWCENTER
- [x] Dropdown-urile: Safari ignora înălțimea (22 px) → desenate de Sentiq, 38 / 44 px în orice browser; Știri și Grafice aliniate (FD-SELECTSAFARI / TD-SELECTSAFARI); audit automat în WebKit și Chrome pe toate paginile
- [x] Întrebare pusă utilizatorului (connectorul nu poate înlocui cheia): a ales „Păstrez totul pe cheie”
- [x] FD-AICLARITY / TD-AICLARITY: connectorul mutat în Setări → Ale mele (mereu vizibil, cu ce face și ce nu face), Securitate cu trimitere, ⌘K; în Admin „La ce folosește Sentiq cheia Claude” cu consumul zilei (titluri, apeluri, tokeni, modele), înregistrat în bază (`sentiment/usage.ts`); subsolul Rezumatului
- [x] Planul App Service trecut pe B2 (de utilizator); `deploy-azure.md`: publicarea fără oprirea aplicației
- [x] Review rounds (runda 32, fără probleme)
- [x] Publicat pe Azure (deploy `d6965246`, prima publicare pe B2, fără oprire: site-ul a răspuns tot timpul) și pe Mac (20:02 ora României); fără migrare de schemă


## Connectorul MCP scos (14 oct 2026, seara)
- [x] Întrebări puse utilizatorului: chat în Sentiq („Nu”, „nu faci nimic”); connectorul: „Îl opresc”, apoi „scoate mcp-ul”
- [x] `SENTIQ_MCP` scos din App Service; backup al tabelelor connectorului
- [x] FD-MCPREMOVE + TD-MCPREMOVE
- [x] Implementare: codul, pagina de consimțământ, panoul, dependențele și tabelele (migrarea 2) scoase; adresele vechi răspund 404
- [x] Teste (adresa publică mutată în `public-instance.test.ts`, linkurile de activare, adresele vechi); review (runda 33, fără probleme)
- [x] Publicat: întâi pe Mac (20:46 ora României; migrarea 2 aplicată, tabelele connectorului șterse), apoi pe Azure (deploy `3c6e980b`, 17:48 UTC, fără oprire); `/mcp` și `/.well-known/…` răspund 404

## Limitele Twelve Data din planul cheii; indicii pe intraday (14 oct 2026, seara)
- [x] Cercetare: `/api_usage` (specificația OpenAPI Twelve Data); surse pentru indici intraday (CNBC, Massive / Polygon, Twelve Data, FMP, EODHD, Yahoo, Stooq)
- [x] FD-TDPLAN / TD-TDPLAN: bugetul pe planul citit (la salvarea cheii, la pornire, la 6 ore, „Recitește planul”), în bază pentru ambele instanțe; Admin și Stare sistem
- [x] FD-INDEXINTRA / TD-INDEXINTRA: indicii de la CNBC (cotații în timp real, zilnic din 2010, 1m – 4h pe ~100 de zile), Nasdaq / Cboe ca rezervă; scanner-ul pe timeframe-ul ales
- [x] Teste noi (`cnbc.test.ts`, planul, intraday); verificat în WebKit cu date reale
- [x] Review rounds (rundele 34–35; ultima fără probleme)
- [x] Publicat pe Azure (deploy `19c474cd`, 18:26 UTC, fără oprire) și pe Mac (21:26 ora României); planul cheii reale citit la pornire: Basic (8 / minut, 800 / zi), până la upgrade

## Cheia AI a fiecărui utilizator: Claude, ChatGPT sau Gemini (16 oct 2026)
- [x] Întrebare: au OpenAI și Gemini chei API? Da, facturate separat de abonamente (ca la Anthropic); cererea: cheia devine a fiecăruia, cu scorul pe local implicit și Rezumatul mereu pe cheie
- [x] Cercetare (16 oct 2026): modelele curente (OpenAI: GPT-6 Astra / 6.1 Sol / 6 Luna; Gemini: 4 Argon / 3.8 Flash / 3.5 Flash-Lite; ID-uri vechi retrase în octombrie → lista se citește din cheie), Responses API cu JSON Schema strict, `generateContent` cu `responseJsonSchema` și `thinkingLevel`
- [x] FD-AIKEYS / TD-AIKEYS
- [x] Implementare: `server/ai/` (clienții OpenAI, Gemini, Anthropic, listele de modele, `AiService`, consumul pe utilizator), migrarea 3 (`user_keys`, `news_ai_scores`, `ai_daily_sentiment`), scorul comun mereu local, scorul AI per utilizator (jobul `sentiment.ai`), indicele / istoricul / Știrile / Rezumatul pe scorurile fiecăruia, mutarea cheii comune a adminului la pornire; Setări → Ale mele → „Inteligență artificială”, Admin → „Sentimentul știrilor”, Rezumatul, Stare sistem
- [x] Reparat pe drum: mutarea motorului vechi trebuie să ruleze înaintea oricărei scrieri a setărilor globale (`migrateMarketData` ar fi pierdut alegerea), prinsă în verificarea vizuală; test nou la pornire
- [x] Teste: 455 (noi: `ai/providers.test.ts`, `ai/service.test.ts`; rescrise: consumul, scorarea, importanța, Rezumatul, rutele, utilizatorii); verificat în Chrome pe o schemă de test, cu furnizori simulați (1280 și 390 px; admin cu cheia mutată, utilizator cu ChatGPT)
- [x] Review rounds (rundele 36–39; ultima fără probleme), împreună cu FD-TDKEYS
- [ ] De verificat de utilizator cu chei reale OpenAI și Gemini (integrările au fost testate pe răspunsurile documentate)
- [x] Publicat pe Azure (deploy `d724277f`, codul nou pornit la 22:27:03 UTC; primul build, `9be0ed8b`, întrerupt de o repornire a Kudu: site căzut 22:11–22:27 UTC, vezi `deploy-azure.md` §5) și pe Mac (22:27:59 UTC, ține joburile); schema 3, cheile mutate la admin

## Cheia Twelve Data a fiecărui utilizator (16–17 oct 2026)
- [x] Cererea: „fiecare utilizator își plătește abonamentele pentru date”: cheia Twelve Data din Admin trece în setările fiecăruia
- [x] Regulile de lucru ale utilizatorului (fără agenți; cercetare; FD/TD cu toate cazurile limită; review-uri succesive până la zero probleme; watchdog) — aplicate de aici înainte
- [x] Cercetare: codul (StockData, CreditBudget, scanner, Grafice, Admin, Stare sistem), Twelve Data (Basic 8 / minut, 800 / zi; `/api_usage`; atribuirea)
- [x] FD-TDKEYS / TD-TDKEYS
- [x] Implementare: cheile personale toate în `user_keys` (migrarea 3), `StockData` per utilizator (cheie, credite, plan, cache), scanner-ul, rutele, jobul planurilor, mutarea cheii comune la admin; Setări → Ale mele → „Date pentru acțiuni”, Admin → „Date de piață” fără cheie, Grafice, Stare sistem
- [x] Reparat pe drum: un buget creat chiar înainte de citirea planului își punea înapoi planul vechi din bază (citirea inițială terminată după `setPlan`); `setPlan` / `clearPlan` / `reset` așteaptă acum citirea
- [x] Teste: 458 (noi: buget și `StockData` per utilizator, mutarea cheii, scanner-ul cu și fără cheie, rutele); verificat în Chrome pe o schemă de test (cheia mutată la admin cu planul și consumul; alt utilizator fără cheie)
- [x] Review rounds (rundele 36–39, cu FD-AIKEYS; ultima fără probleme)
- [x] Publicat împreună cu FD-AIKEYS (aceeași publicare)

## Importanța știrii, cu sursa fiecărei valori (18 oct 2026)
- [x] Cererea: „Relevanță 1, importanță 2 (Claude; după cuvinte-cheie ar fi 3)” se citea invers (3 ca notă a lui Claude); acum valori separate, fiecare cu sursa ei: „Relevanță 1, importanță 2 (Claude), importanță 3 (cuvinte-cheie)”; la valori egale „importanță 2 (Claude și cuvinte-cheie)”; fără notă AI „importanță 3 (cuvinte-cheie)”
- [x] `News.tsx`; FD (Importanța în index), TD-IMPACT §5, ghidul
- [x] Review (runda 40, fără probleme); `tsc` curat
- [x] Publicat pe Azure (deploy `d7f4b886`, 18 oct 2026, împreună cu FD-2FA și FD-TRADING)

## Autentificarea în doi pași, obligatorie (18 oct 2026)
- [x] Cererea: fiecare cont își configurează 2FA înainte de orice acces; contul nou, imediat după activare
- [x] Cercetare:
  - codul (`auth/users.ts`, sesiunile, hook-ul de acces, rutele, paginile de login, Securitate, Utilizatori, testele care fac sesiuni direct);
  - OWASP MFA Cheat Sheet;
  - riscul înrolării după un login doar cu parola (Mandiant, APT29);
  - baza de producție: 2 conturi, amândouă cu 2FA, deci nimeni blocat la publicare
- [x] FD-2FA / TD-2FA
- [x] Implementare:
  - bariera din hook (doar configurarea pentru un cont fără 2FA, altfel 403 `TWO_FACTOR_REQUIRED`);
  - activarea care intră direct în cont;
  - celelalte sesiuni închise la configurare;
  - schimbarea aplicației (migrarea 4: `totp_next_secret`), fără oprire sau renunțare;
  - resetarea de către admin închide sesiunile;
  - 3 emailuri de anunț;
  - interfața: ecranul de configurare înaintea oricărei pagini, codurile de recuperare ținute până la „Intră în Sentiq”, Securitate, Utilizatori
- [x] Teste (noi: bariera, activarea, sesiunile închise, schimbarea aplicației, passkey fără 2FA, parola uitată fără 2FA, resetarea, evenimentul din `api.ts`); verificat în Chrome pe o schemă de test (activare → configurare → coduri → Azi; schimbarea aplicației; Utilizatori; telefon 390 px)
- [x] Reparat pe drum (review): „Contul e activ” într-un browser cu alt cont duce acum la login cu adresa nouă („Ieși și intră cu …”); ordinea sigură după o configurare făcută de altcineva (întâi parola nouă, apoi resetarea 2FA), în emailuri și în ghid
- [x] Review rounds (rundele 41–47; ultima fără probleme); 463 de teste pe Azure SQL
- [x] Publicat pe Azure (deploy `d7f4b886`, 18 oct 2026, împreună cu FD-TRADING; schema 4 și 5 aplicate la pornire). Mac-ul nu rula; pornește doar cu codul nou

## Ordine de tranzacționare din Sentiq (18 oct 2026)
- [x] Cererea: ordine din aplicație, cu cheile care permit tranzacționarea, pe fiecare broker și exchange care o oferă
- [x] Decizii (AskUserQuestion): spot și futures cu levier; o fereastră de confirmare la fiecare ordin (parola și 2FA o dată, la pornirea pe cont); ordine din Tranzacții și din grafic
- [x] Cercetare:
  - documentațiile oficiale: Trading 212 Orders, eToro Trading Real / Demo, Alpaca Orders, IBKR Web API;
  - ccxt 4.5 (`createOrder`, stop-uri, TP / SL, levier, marjă, modul de poziție) pe KuCoin, Binance, Bybit, OKX, Bitget, Kraken, Coinbase;
  - IBKR rămâne doar citire (cheia Flex nu poate trimite ordine)
- [x] FD-TRADING / TD-TRADING
- [x] Implementare:
  - `exchange/trading/`: traderul ccxt, Trading 212, eToro, Alpaca, drepturile cheii, `TradingService` cu jurnal, idempotență și limită de viteză;
  - migrarea 5 (tranzacționarea pe cont, `trade_log`);
  - rutele;
  - formularul de ordin, confirmarea, pornirea cu parola + 2FA, „Anulează”, „Închide”, „Vinde”, jurnalul, „Tranzacționează” pe grafic, textele expertului și ale setărilor
- [x] Reparat pe drum:
  - o închidere reduce-only ar fi schimbat levierul (acum nu-l mai atinge);
  - o cheie care primește între timp retrageri oprește tranzacționarea;
  - „Vinde” pe soldul „main” KuCoin
- [x] Teste:
  - traderul crypto cu clienți simulați și cu clasele ccxt reale (cererile KuCoin futures / spot, Bybit, contul unificat Bitget, Coinbase);
  - ordinele futures și stop citite în portofoliu (Binance, Bybit, OKX, Bitget), cheia fără futures;
  - brokerii pe HTTP simulat;
  - serviciul și rutele cap la cap;
  - testul de siguranță a codului rescris;
  - verificat în Chrome pe o schemă de test, cu un exchange simulat
- [x] Review rounds (48–63; runda 63: zero probleme)
- [ ] De verificat de utilizator pe Demo / Paper sau cu sume mici (integrările urmează documentațiile, nu au fost încercate pe conturi reale)
- [x] Publicat pe Azure (deploy `d7f4b886`: build 17:46–17:50 UTC cu aplicația oprită, codul nou pornit la 18:13 UTC, `/api/ping` 200, „Sentiq running”, joburile pe Azure). Fără commit, la cererea utilizatorului

## Orice indicator TradingView pe grafic; Slingshot și LMA la „Premium” (18 oct 2026)
- [x] Cererea: „adăugarea de orice indicator oferit de providerul de chart (gratis sunt vreo 100), cu un UI; Slingshot și LMA sus, într-o categorie dedicată, cu tag premium (vor fi cu plată)”
- [x] Cercetare: Lightweight Charts nu are indicatori incluși (cei 100+ sunt ai Advanced Charts, cu licență cerută și altă librărie); portul MIT `lightweight-charts-indicators` (117 indicatori standard TradingView, renderer pentru Lightweight Charts 5, teste față de TradingView); pachetul npm de 15 MB nu se poate tăia la build, deci sursa standard e preluată la commitul `f8e1b0e`, cu `oakscriptjs` 0.12.3; verificat: fără rețea, fără `eval`; 117 indicatori în ~0,7 s pe 5.000 de bare; 122 KB gzip
- [x] FD-INDICATORS / TD-INDICATORS
- [x] Implementare:
  - codul preluat (`src/web/indicators/vendor/`, 129 de fișiere, MIT, commit `f8e1b0e`) și `oakscriptjs` 0.12.3; catalogul generat (117 + Volume, scris în Sentiq);
  - setarea personală `studies` (listă de cel mult 20, recuperată element cu element la citire);
  - calculul în browser, indicator cu indicator, din chunk-ul încărcat la nevoie (112 KB gzip); datele în plus (alt timeframe al aceluiași simbol, alte perechi / acțiuni, lunarul din zilnic);
  - graficul cu N panouri (`addPane`), înălțimile ținute minte, legendele (valori, ochi, setări, ×), vederea ținută pe ultimele lumânări când un indicator desenează în viitor (Ichimoku);
  - fereastra Indicatori (Premium sus, categorii, căutare), setările Intrări / Stil; bifele Slingshot / LMA înlocuite de listă și legendă
- [x] Teste: 532 (noi: schema listei, catalogul cu toți cei 118 indicatori rulați, intrările, timeframe-urile, datele în plus, stilul, legenda, Volume, lista salvată per utilizator); verificat în Chrome pe o schemă de test (fereastra, legende, setări, ochi, ×, separatorul, ecran complet, indice fără volum, Performance cu simboluri lipsă)
- [x] Review rounds (64–67; runda 67: zero probleme). Reparat pe drum: vederea ținută minte nu se aplica la încărcarea paginii (problemă veche), Ichimoku muta vederea
- [x] Publicat pe Azure (deploy `838af7ae`: build 19:44–19:48 UTC cu aplicația oprită, codul nou pornit la 19:50 UTC, `/api/ping` 200, „Sentiq running”, chunk-ul indicatorilor servit); fără migrare de schemă; fără commit

## Ochiul și la Slingshot și LMA (18 oct 2026)
- [x] Cererea: „butonul de View, Show sau Hide și pentru indicatorii premium, ca să îi pot ascunde temporar”
- [x] FD-PREMIUMHIDE / TD-PREMIUMHIDE
- [x] Implementare: `charts.slingshotHidden` / `charts.lmaHidden` (implicit `false`); ochiul în legendele lor; ascuns = nedesenat (Slingshot: medii, nor, semnale, Market Structure, TP / SL; LMA: panoul și culorile lumânărilor), legenda estompată în panoul prețului; lista Indicatori: „Pe grafic, ascuns”
- [x] Teste (schema, stările, textul din listă); verificat în Chrome
- [x] Review rounds (68–69; runda 69: zero probleme)
- [x] Publicat pe Azure (deploy `f07606c3`: build 22:14–22:18 UTC cu aplicația oprită, pornit la 22:22 UTC, `/api/ping` 200, „Sentiq running”, ecranele noi în codul servit); fără migrare de schemă; fără commit

## Pornirea tranzacționării: passkey, mesaje clare, permisiunile întâi (reparație, 19 oct 2026)
- [x] Cererea: „deși am introdus parola și codul 2FA corecte, nu mă lasă, și m-a blocat 15 minute; repară și resetează-mi cooldown-ul”
- [x] Blocajul șters: aplicația de pe Azure repornită (18 oct, 21:05 UTC), versiunea neschimbată
- [x] Cercetare: cheia master de pe Azure = a Mac-ului, secretul 2FA se citește, ceasul serverului e exact; parola sau codul au fost refuzate la fiecare încercare (ultimul cod acceptat: 14 oct; de atunci doar login cu passkey). Fereastra cerea „parola contului Sentiq”, iar contul KuCoin se numește chiar „Sentiq”; permisiunile cheii (salvate „General”) se recitieau abia după factori
- [x] FD-TRADEUNLOCK / TD-TRADEUNLOCK
- [x] Implementare: confirmarea cu passkey; texte clare (parola și codul Sentiq, nu ale exchange-ului); mesajul spune factorul greșit și încercările rămase; permisiunile cheii recitite înaintea factorilor; refuzurile notate în jurnalul serverului
- [x] Teste (mesajele, încercările, permisiunile întâi, passkey-ul: provocarea, alt cont, contorul); verificat în Chrome cu un autentificator virtual
- [x] Review rounds (68–69; runda 69: zero probleme)
- [x] Publicat pe Azure (deploy `f07606c3`: build 22:14–22:18 UTC cu aplicația oprită, pornit la 22:22 UTC, `/api/ping` 200, „Sentiq running”, ecranele noi în codul servit); fără migrare de schemă; fără commit

## Indicatori favoriți, bara de jos a setărilor, stilul liniilor (19 oct 2026)
- [x] Cererile: o categorie „Favorite” și o stea pe fiecare rând în lista Indicatori; bara Salvează / Valorile implicite pe toată baza panoului, fără text pe sub ea; tipul liniei (dotted / dashed / solid) și trei grosimi pentru orice linie a indicatorilor
- [x] Răspuns la întrebare: „Moving Average Ribbon” are deja 4 medii, fiecare cu tipul (inclusiv EMA), perioada, sursa și culoarea ei
- [x] FD-STUDYUX / TD-STUDYUX
- [x] Implementare: `studyFavorites` (setare personală), steaua și categoria „Favorite”; bara de jos a formularelor de setări (indicatori, Slingshot, LMA); tipul și grosimea în tab-ul „Stil”, pentru linii și linii orizontale
- [x] Teste (schema, favoriții per utilizator și recuperarea lor, tipul și grosimea ajunse la renderer, opțiunile de grosime); verificat în Chrome
- [x] Review rounds (70–71; runda 71: zero probleme)
- [x] Publicat pe Azure (deploy `f07606c3`: build 22:14–22:18 UTC cu aplicația oprită, pornit la 22:22 UTC, `/api/ping` 200, „Sentiq running”, ecranele noi în codul servit); fără migrare de schemă; fără commit

## Fiecare indicator își ține minte ultimele setări (19 oct 2026)
- [x] Cererea: „toate indicatoarele trebuie să rețină ultimele setări; dacă șterg un indicator și îl readaug, să vină cu setările de dinainte”
- [x] FD-STUDYMEMORY / TD-STUDYMEMORY
- [x] Implementare: `studyMemory` (setare personală, o intrare pe indicator: intrări, stil, înălțimea panoului), actualizată la „Salvează” și la scoatere, în aceeași cerere cu lista; folosită la adăugare
- [x] Teste (memoria, schema, serverul); verificat în Chrome
- [x] Review rounds (72–73; runda 73: zero probleme)
- [x] Publicat pe Azure (deploy `09b95fb3`: build 06:58–07:02 UTC cu aplicația oprită, pornit la 07:03 UTC, `/api/ping` 200, „Sentiq running”, ecranele noi în codul servit); fără migrare de schemă; fără commit

## Butonul „la ultima lumânare”, descrieri în română, nivelurile liniilor orizontale (19 oct 2026)
- [x] Cererile: un buton » în colțul din dreapta jos al graficului care te duce la lumânarea curentă când ai derulat înapoi (ca în TradingView); explicațiile indicatorilor în română; limitele de sus / mijloc / jos la Stochastic RSI
- [x] FD-GOLATEST, FD-RODESC, FD-HLINELEVELS (+ TD)
- [x] Implementare: butonul în colțul celui mai de jos panou (apare doar cu ultima lumânare în afara vederii; caseta TP / SL urcă cât împart colțul); cele 118 descrieri traduse; nivelul fiecărei linii orizontale în tab-ul „Stil”, la toți indicatorii care au astfel de linii
- [x] Teste (descrierile fără engleză, schema nivelurilor, nivelurile Stochastic RSI și umplerea lor); verificat în Chrome
- [x] Review rounds (74–76; runda 76: zero probleme)
- [x] Publicat pe Azure (deploy `09b95fb3`: build 06:58–07:02 UTC cu aplicația oprită, pornit la 07:03 UTC, `/api/ping` 200, „Sentiq running”, ecranele noi în codul servit); fără migrare de schemă; fără commit

## Formularul de ordin își ține minte alegerile (19 oct 2026)
- [x] Cererea: „ordinele trebuie să țină minte setările, chiar dacă nu inițiez tranzacția; orice setare (mai puțin simbolul și valoarea) să persiste de la ordin la ordin”
- [x] FD-TICKETMEMORY / TD-TICKETMEMORY
- [x] Implementare: `orderTicket` (setare personală: alegerile pe cont și contul folosit ultima dată, pentru monede și acțiuni); salvate la fiecare schimbare; aplicate la deschidere și la schimbarea contului; fără simbol, cantitate și prețuri; închiderile nu le citesc și nu le schimbă
- [x] Teste (helper-ele, schema, serverul); verificat în Chrome
- [x] Review rounds (77–78; runda 78: zero probleme)
- [x] Publicat pe Azure (deploy `09b95fb3`: build 06:58–07:02 UTC cu aplicația oprită, pornit la 07:03 UTC, `/api/ping` 200, „Sentiq running”, ecranele noi în codul servit); fără migrare de schemă; fără commit

## Textele conectorilor, IP-urile serverului, unitățile eToro (19 oct 2026)
- [x] Cererile:
  - textele conectorilor nu mai interzic drepturile de tranzacționare (write);
  - sfaturile despre chei învață limitarea la IP-urile serverului (cele 13 adrese date);
  - la vânzarea unei dețineri eToro, câmpul de unități era blocat
- [x] Cercetare:
  - lista IP-urilor = `outboundIpAddresses` ale aplicației Azure;
  - câmpul era blocat pentru că închiderea parțială mergea doar pe o singură poziție
- [x] FD-KEYTEXT, FD-KEYIPS, FD-ETOROUNITS (+ TD)
- [x] Implementare:
  - pașii celor 11 platforme (citire, plus tranzacționare la cerere, niciodată retrageri; IP-urile Sentiq în loc de „IP-ul tău”);
  - caseta cu lista și „Copiază lista” în wizard;
  - textele din Setări / Tranzacții / ghid;
  - `closePlan` (poziții întregi, apoi o parte din următoarea) și câmpul de unități deschis
- [x] Teste; verificat în Chrome
- [x] Review rounds (79–80; runda 80: zero probleme)
- [x] Publicat pe Azure (deploy `09b95fb3`: build 06:58–07:02 UTC cu aplicația oprită, pornit la 07:03 UTC, `/api/ping` 200, „Sentiq running”, ecranele noi în codul servit); fără migrare de schemă; fără commit

## Alegi pozițiile eToro pe care le închizi (19 oct 2026)
- [x] Cererea: „dacă sunt mai multe poziții, arată-mi-le pe toate când vreau să le lichidez, să le selectez eu (vreau să le vând doar pe cele profitabile)”
- [x] FD-ETOROPICK / TD-ETOROPICK
- [x] Implementare:
  - pozițiile instrumentului, cu profitul nerealizat, data și suma investită, în `InstrumentInfo.positions` (eToro);
  - lista cu bife și butoanele „Toate” / „Doar profitabile” / „Niciuna”, plus sumarul;
  - doar cele alese se închid; unitățile se împart pe ele;
  - confirmarea cu pozițiile și profitul
- [x] Teste; verificat în Chrome (eToro simulat)
- [x] Review rounds (81–82; runda 82: zero probleme)
- [x] Publicat pe Azure (deploy `09b95fb3`: build 06:58–07:02 UTC cu aplicația oprită, pornit la 07:03 UTC, `/api/ping` 200, „Sentiq running”, ecranele noi în codul servit); fără migrare de schemă; fără commit

## Pozițiile eToro ca rânduri, fiecare cu „Vinde” (19 oct 2026)
- [x] Cererea: „pozițiile listate ca rânduri cu buton de vânzare pentru fiecare, coloane cu datele existente, popup-ul mai lat; ce nu pot modifica (contul, simbolul) ca text, nu câmp”
- [x] FD-ETOROROWS / TD-ETOROROWS (înlocuiește interfața FD-ETOROPICK)
- [x] Implementare:
  - tabelul pozițiilor (deschisă, unități, preț intrare, investit, profit / pierdere, „De vândut”, „Vinde”), cu o vânzare pe rând și „Înapoi la poziții”;
  - fereastra de 900 px;
  - în formularele de închidere, contul, simbolul, piața, direcția și reduce-only ca text
- [x] Teste; verificat în Chrome (eToro simulat, închidere futures)
- [x] Review rounds (83–84; runda 84: zero probleme)
- [x] Publicat pe Azure (deploy `5bb9ad95`: build 08:16–08:19 UTC cu aplicația oprită, pornit la 08:21 UTC, `/api/ping` 200, „Sentiq running”, ecranele noi în codul servit; știrile păstrate re-etichetate în ~26 s, fără erori); fără migrare de schemă; fără commit

## Știrile și scorul acțiunilor, pe indici (19 oct 2026)
- [x] Cererea: „o setare care filtrează știrile despre acțiuni și scorul la companiile din unul sau mai mulți indici (ex. QQQ); dacă nu avem datele, generează listele de companii”
- [x] Cercetare:
  - Sentiq avea cotațiile indicilor, nu componența;
  - surse publice găsite: Nasdaq-100 (API-ul Nasdaq), S&P 500 și Dow (Wikipedia), toate acțiunile listate (screener-ul Nasdaq);
  - fără sursă: Russell 2000, PHLX Semiconductor, Nasdaq Composite
- [x] Decizii (AskUserQuestion): se filtrează doar partea de acțiuni; știrile generale de bursă rămân; favoritele rămân
- [x] FD-INDEXNEWS / TD-INDEXNEWS
- [x] Implementare:
  - listele (parsere, validare, aliasuri cu dicționar și nume curate, instantaneu generat de `scripts/index-members.ts`, job săptămânal);
  - detectorul cu companiile și marcajele `#CO` / `#SPX` / `#NDX` / `#DJI`, ascunse în aplicație;
  - re-etichetarea știrilor păstrate, pe zile, reluabilă;
  - filtrul în Știri / Azi / Rezumat și în scorul per utilizator (recalculat la schimbare);
  - setarea în Setări și nota din Știri
- [x] Teste (14 noi); verificat în Chrome
- [x] Review rounds (85–86; runda 86: zero probleme)
- [x] Publicat pe Azure (deploy `5bb9ad95`: build 08:16–08:19 UTC cu aplicația oprită, pornit la 08:21 UTC, `/api/ping` 200, „Sentiq running”, ecranele noi în codul servit; știrile păstrate re-etichetate în ~26 s, fără erori); fără migrare de schemă; fără commit


## Tranzacțiile închise și la brokeri (19 oct 2026)
- [x] Cererea: „pentru kucoin am selectorul Tranzacții închise în Azi / 7z / 30z / 90z; pentru etoro de ce nu am? adaugă pentru toate tipurile de cont; citește documentația”
- [x] Cercetare (documentația brokerilor):
  - eToro: istoricul tranzacțiilor (`netProfit`), Real și Demo;
  - Trading 212: istoricul ordinelor (`realisedProfitLoss` pe vânzări), 20 de cereri pe minut;
  - IBKR: Flex cu `fd` / `td` (până la 365 de zile), câmpul Realized P/L din Trades (cu comisioane), codurile de eroare 1003–1008;
  - Alpaca: execuțiile (`FILL`) nu au rezultatul realizat, deci se calculează FIFO
- [x] FD-BROKERSTATS / TD-BROKERSTATS
- [x] Implementare:
  - `closedTrades` la cei patru brokeri (eToro: istoricul; Trading 212: vânzările cu profitul realizat; IBKR: raport Flex pe 90 de zile, `fd` / `td`, coadă pe token; Alpaca: FIFO din execuții, cu short și opțiuni);
  - serviciul: un istoric pentru toate perioadele, 5 minute; moneda contului; „parțial” și „fără rezultat”;
  - pagina Tranzacții: selectorul la toate conturile, cardurile brokerilor;
  - pasul IBKR (Trades: „Execution”, toate câmpurile);
  - reparat pe drum: comisionul execuțiilor Trading 212 (lista de taxe), codurile IBKR „raportul nu e gata”
- [x] Teste (adaptorii, FIFO, numărarea, API-ul); verificat în Chrome (cei patru brokeri simulați + KuCoin, toate perioadele)
- [x] Review rounds (87: 7 probleme; 88: 1 problemă; 89: zero probleme)
- [x] Publicat pe Azure (deploy `ae3e6d30`: build 10:22–10:25 UTC cu aplicația oprită, pornit la 10:27 UTC, `/api/ping` 200, „Sentiq running”, ecranele noi în codul servit, fără erori noi în jurnal); fără migrare de schemă; fără commit

## Graficul nu mai sare: antetul și butoanele din legendă (19 oct 2026)
- [x] Cererea (două buguri): „în ecran complet, la schimbarea simbolului, rândul cu intervalele urcă pe primul rând și apoi coboară”; „butoanele X / setări / ochi din legenda indicatorului se mută după valori”
- [x] Cauzele: insigna variației și prețul lipsesc cât se încarcă simbolul (antetul se îngustează); butoanele stau după valori
- [x] FD-CHARTSTEADY / TD-CHARTSTEADY
- [x] Implementare: partea din stânga a antetului cu bază fixă; prețul și variația gri cu „—”, ținând lățimea simbolului de dinainte; butoanele legendei înaintea valorilor (indicatori și LMA)
- [x] Verificat în Chrome: poziția rândului cu intervalele, eșantionată la 25 ms la ETH → SOL → AAPL → SPX → BTC (ecran complet 1440 / 1920, normal 1280 / 390), și butonul X la trei poziții ale cursorului
- [x] Review rounds (87–89; runda 89: zero probleme)
- [x] Publicat pe Azure (deploy `ae3e6d30`: build 10:22–10:25 UTC cu aplicația oprită, pornit la 10:27 UTC, `/api/ping` 200, „Sentiq running”, ecranele noi în codul servit, fără erori noi în jurnal); fără migrare de schemă; fără commit

## Butonul „la ultima lumânare”, în panoul prețului (19 oct 2026)
- [x] Cererea: „mută săgeata de derulare pe chart, nu în zona de jos cu panouri; să fie deasupra panourilor”
- [x] FD-GOLATESTMAIN / TD-GOLATESTMAIN
- [x] Implementare (`CandleChart`: butonul în panoul prețului; caseta TP / SL urcă oricând se vede butonul); ghidul
- [x] Verificat în Chrome (cu LMA + RSI dedesubt și fără panouri; click)
- [x] Review rounds (90: zero probleme)
- [x] Publicat pe Azure (deploy `ae3e6d30`: build 10:22–10:25 UTC cu aplicația oprită, pornit la 10:27 UTC, `/api/ping` 200, „Sentiq running”, ecranele noi în codul servit, fără erori noi în jurnal); fără migrare de schemă; fără commit

## Pagina nu se mai derulează în spatele panourilor și ferestrelor (19 oct 2026)
- [x] Cererea: „când deschid orice side panel sau popup care are scroll, blochează scrollul doar în el; nu mai permite scroll în fundal cât sunt deschise”
- [x] Cercetare: elementele (`Modal` și cei trei care îl folosesc, asistentul de conturi, ⌘K, Rezumatul, fereastra lui de eroare, panoul lateral al indicatorilor, ecranul complet, listele de căutare); doar Rezumatul și ecranul complet blocau pagina, fiecare în felul lui
- [x] FD-SCROLLLOCK / TD-SCROLLLOCK
- [x] Implementare: `scroll-lock.ts` (o blocare cu contor, locul barei păstrat); folosită de `Modal`, asistentul de conturi, ⌘K, Rezumat, fereastra lui de eroare, panoul lateral al indicatorilor și ecranul complet; `overscroll-contain` pe zonele care derulează și pe listele de căutare; ghidul
- [x] Teste (contorul, lățimea barei, eliberarea dublă); verificat în Chrome (rotița peste panou până la capăt și lângă el, ⌘K peste panou, fereastra Indicatori, ecran complet + panou, pagina după închidere)
- [x] Review rounds (91: zero probleme); suita completă: 59 de fișiere, 593 de teste
- [x] Publicat pe Azure (deploy `ae3e6d30`: build 10:22–10:25 UTC cu aplicația oprită, pornit la 10:27 UTC, `/api/ping` 200, „Sentiq running”, ecranele noi în codul servit, fără erori noi în jurnal); fără migrare de schemă; fără commit

## Indicatorii din fereastra „Indicatori”, în ordine alfabetică (19 oct 2026)
- [x] Cererea: „indicatorii din popup trebuie să fie ordonați alfabetic, indiferent de filtrare (taburi)”
- [x] Cercetare: „Toți” punea Premium primele, apoi ordinea catalogului; Favoritele, în ordinea marcării; căutarea, la fel ca „Toți”
- [x] FD-PICKERSORT / TD-PICKERSORT
- [x] Implementare: `indicators/order.ts` (colația românească, fără majuscule / diacritice / punctuație, numerele după valoare); `IndicatorPicker` sortează fiecare listă; ghidul
- [x] Teste (regula; catalogul întreg + Premium); verificat în Chrome (Favorite marcate în altă ordine, Premium, Toți: 120, Medii mobile, Oscilatori, Volum, căutarea „average”: toate alfabetic)
- [x] Review rounds (92: zero probleme)
- [x] Publicat pe Azure (deploy `a4836c1e`: build 10:36–10:40 UTC cu aplicația oprită, pornit la 10:42 UTC, `/api/ping` 200, „Sentiq running”, sortarea în codul servit); fără migrare de schemă; fără commit

## Liniile cursorului înapoi; butonul „+” și liniile orizontale (19 oct 2026)
- [x] Cererea: „pune la loc liniile punctate la cursor și butonul plus care adaugă linie orizontală; linia are setările din poze (TradingView), toate într-un singur panou, nu pe tab-uri”
- [x] Cercetare:
  - liniile cursorului fuseseră scoase de FD-CHARTUX;
  - biblioteca graficului (5.2.1) are primitive cu etichete pe axa prețului (`priceAxisViews`) și cursor la trecere (`hitTest`);
  - Sentiq are deja primitive (`HSegments`), câmpurile de culoare / grosime / tip din setările indicatorilor și panoul lateral
- [x] FD-HLINE / TD-HLINE
- [x] Implementare:
  - liniile cursorului (cu liniuțe, culoarea temei);
  - `shared/hlines.ts` (schema, șablonul, vizibilitatea, salvarea parțială), cheile `chartLines` și `hlineTemplate`;
  - primitiva `HLines` (linia, textul aliniat, eticheta pe axă, prinderea cu cursorul);
  - în `CandleChart`: „+” cu meniul, Alt+H, tragerea și click-ul;
  - panoul `HLineSettings` (Linie, Text, Preț, Vizibilitate, Șablon; Salvează, Anulează, Șterge);
  - în pagina Grafice: liniile simbolului, previzualizarea, salvarea
- [x] Teste (modelul: 5; serverul: liniile și șablonul fiecăruia); verificat în Chrome (liniile cursorului, „+” ținut sub mouse și meniul, Alt+H, două linii cu etichete, cursorul sus-jos pe linie, tragerea 83203.5 → 82215.2 fără derularea graficului, panoul, previzualizarea, Anulează, Salvează, șablonul, vizibilitatea, ștergerea)
- [x] Review rounds (93: 5 probleme; 94: 2; 95: zero probleme); suita completă: 61 de fișiere, 601 teste
- [x] Publicat pe Azure (deploy `e0ac6176`: build 11:29–11:32 UTC cu aplicația oprită, pornit la 11:34 UTC, `/api/ping` 200, „Sentiq running”, liniile orizontale și numele [DE] în codul servit); fără migrare de schemă; fără commit

## Numele Slingshot și LMA, cu „[DE]” (19 oct 2026)
- [x] Cererea: „Slingshot să aibă și el titlu și nume scurt, ca LMA; pe grafic numele scurt «[DE] Slingshot 3.3» (DE = Dusty Enterprise); la LMA, din DI în DE”
- [x] Cercetare: scriptul Pine are „[Dusty Investments] Slingshot System Long 3.3” / „[DI] SS LONG 3.3”; aplicația folosea „Slingshot System 3.3” și „Slingshot”
- [x] FD-DENAMES / TD-DENAMES
- [x] Implementare: titlurile și numele scurte în constante; legenda, panoul, lista Indicatori; ghidul
- [x] Teste (ordinea alfabetică cu numele noi); verificat în Chrome (legenda „[DE] Slingshot 3.3 38 62” și „[DE] LMA …”, panoul „[DE] Slingshot System 3.3”, tab-ul Premium)
- [x] Review rounds (93: 5 probleme; 94: 2; 95: zero probleme); suita completă: 61 de fișiere, 601 teste
- [x] Publicat pe Azure (deploy `e0ac6176`: build 11:29–11:32 UTC cu aplicația oprită, pornit la 11:34 UTC, `/api/ping` 200, „Sentiq running”, liniile orizontale și numele [DE] în codul servit); fără migrare de schemă; fără commit
