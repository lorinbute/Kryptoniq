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
