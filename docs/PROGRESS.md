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

## Graficul ca în TradingView: lista de simboluri, tragere liberă, A / L, etichetele prețului; iPad (20 oct 2026)
- [x] Cererea: (iPad) butonul ✕ al Safari peste simbol; „Pozițiile mele” mai scund; ieșirea din ecranul complet pe al doilea rând; lista de simboluri verticală în dreapta, redimensionabilă și ascunsă; „aplici generic, doar ✕ e pentru iPad”; tragere liberă fără deblocare; butoanele A și L; etichetele prețului curent și ale cursorului în culorile din captură; cursorul cruce; » mai la stânga; lista ca în TradingView (Symbol, Last, Chg, Chg%)
- [x] Cercetare:
  - „blocarea” e autoScale-ul scalei de preț: biblioteca mută graficul pe verticală doar pe manual, iar decizia o ia la începutul tragerii. Are `setVisibleRange` / `getVisibleRange` / `setAutoScale`;
  - eticheta prețului curent nu poate avea două rânduri, deci e desenată de o primitivă pe scală;
  - cursorul graficului se moștenește de la gazdă;
  - datele listei există deja (banda de sus);
  - pe ecran tactil, butoanele au 44 px, intervalele 48 px, iar „Pozițiile mele” avea 38 px
- [x] FD-CHARTTV / TD-CHARTTV
- [x] Implementare:
  - `Watchlist.tsx` (coloanele, căutarea, reordonarea, ascunderea) și `watchlist-prefs.ts`; rândul grafic + listă cu marginea de tras; pastilele scoase;
  - bara: rândul la aceeași înălțime, grupul butoanelor nedespărțit, ieșirea doar iconiță, butonul listei;
  - pe iPad, în ecranul complet al sistemului, loc pentru ✕;
  - graficul:
    - `CurrentPriceLabel` (eticheta galben-pal cu numărătoarea), linia prețului galbenă punctată;
    - etichetele cursorului gri, cursorul cruce;
    - tragerea liberă (scala normală preluată de Sentiq, cea logaritmică lăsată bibliotecii);
    - butoanele A / L (`charts.logScale` în setări);
    - „+” pătrățel gri, » cu 34 px mai la stânga;
  - ghidul
- [x] Teste (numărătoarea, preferințele listei, iPad-ul); verificat în Chrome:
  - 1440 px: lista și prețurile, bara pe un rând, cursorul cruce; tragerea orizontală păstrează A, cea verticală îl stinge, A îl aprinde, L se salvează (la fel pe scala logaritmică); » și „+” fără suprapunere; click pe rând, marginea trasă (420 px, ținută după reîncărcare), ascunderea și readucerea;
  - 1024 / 1180 px, cu atingere și ecran complet: bara pe un singur rând, 48 px;
  - 390 px: lista sub grafic, fără derulare orizontală; cu 14 favoriți, rândurile derulează în cei 360 px;
  - căutarea cu lista îngustă (200 px): rezultatele întregi, peste grafic;
  - cu atingeri emulate: un deget pe verticală stinge A, pinch-ul nu (pe ambele scale);
  - cursorul pe prețul curent: eticheta lui gri rămâne deasupra celei galbene, iar numărătoarea merge
- [x] Review rounds:
  - 96: 1 problemă; 97: 1; 98: 1 (testul setărilor, găsit de suita completă); 99: 2 (pinch-ul, indentarea);
  - 100: 2 (FD); 101: 1 (TD); 102: 1 (ghidul); 103: 1 (eticheta peste cursor); 104: 2 (căutarea tăiată, lista pe telefon);
  - 105: zero probleme;
  - suita completă: 64 de fișiere, 607 teste
- [x] Publicat pe Azure (deploy `853f38b3`, împreună cu graficul TradingView, hedge-ul KuCoin și hedge-ul pe toate platformele): prima încercare (`0745c3c6`) oprită de Azure la o repornire a containerului de build, în timpul `npm ci` (codul vechi a rămas neatins); a doua: build 04:34–04:38 UTC cu aplicația oprită, pornit la 04:40 UTC, `/api/ping` 200, „Sentiq running”, textele noi în codul servit; fără migrare de schemă; fără commit

## Futures KuCoin și în modul hedge (20 oct 2026)
- [x] Cererea: un trade ratat, pentru că Sentiq refuza contul KuCoin în modul hedge; ordinele futures KuCoin trebuie să meargă și în hedge, nu doar în one-way
- [x] Cercetare:
  - KuCoin: modul e al contului; `positionSide` LONG / SHORT e obligatoriu în hedge; contul unificat nu-l primește; eroarea 330012;
  - ccxt 4.5.85: `hedged: true` pune `positionSide` după direcție și reduce-only, inclusiv la TP / SL;
  - Sentiq: refuzul din `assertOneWay`, poziția unică din formular, liniile graficului, rândurile din Tranzacții
- [x] FD-KUCOINHEDGE / TD-KUCOINHEDGE
- [x] Implementare:
  - `crypto.ts`: modul citit (`hedgedOf`), ordinul KuCoin clasic cu `hedged: true`, UTA refuzat la verificare, nepotrivirea modului (330012) spusă și citită din nou; pozițiile long / short apart, avertismentele;
  - `accounts.ts`: partea pozițiilor din `positionSide`, `positionSide` pe ordine;
  - formularul: „Mod hedge” cu pozițiile, „Închide long / short”, confirmarea; Tranzacții: poziția ordinului; graficul: LONG / SHORT, ordinele legate de poziția lor;
  - FD-TRADING / TD-TRADING / ghidul actualizate
- [x] Teste (simulate, ccxt real: `positionSide` LONG / SHORT pe ordine și pe TP / SL, liniile graficului, `positionSideOf`); verificat în Chrome cu un cont KuCoin simulat în hedge:
  - Tranzacții: long și short pe rânduri separate, ordinele cu „long” / „short”;
  - „Închide” pe long: „Mod hedge · long 0.01 · short 0.02”, „Închide long”, confirmarea cu „Mod poziții”, ordinul trimis cu `hedged: true` și reduce-only;
  - Short nou cu long deschis: avertismentul; reduce-only → „Închide short / Închide long”;
  - graficul: „PnL LONG”, „PnL SHORT”, „Lichidare SHORT”
- [x] Review rounds: 106: 2 probleme (UTA la nepotrivirea modului, FD / TD); 107: 1 (Binance dă același `positionSide`); 108: 1 (TD); 109: zero probleme; suita completă: 64 de fișiere, 611 teste
- [x] Publicat pe Azure (deploy `853f38b3`, împreună cu graficul TradingView, hedge-ul KuCoin și hedge-ul pe toate platformele): prima încercare (`0745c3c6`) oprită de Azure la o repornire a containerului de build, în timpul `npm ci` (codul vechi a rămas neatins); a doua: build 04:34–04:38 UTC cu aplicația oprită, pornit la 04:40 UTC, `/api/ping` 200, „Sentiq running”, textele noi în codul servit; fără migrare de schemă; fără commit

## Modul hedge pe toate platformele (20 oct 2026)
- [x] Cererea: „verifici documentația pentru toate exchange-urile și aplici la fel pentru toate, inclusiv brokeri” (după FD-KUCOINHEDGE)
- [x] Cercetare (documentațiile și ccxt 4.5.85):
  - Binance `positionSide` (reduce-only interzis în hedge); Bybit `positionIdx`, modul pe pereche, citit din lista pozițiilor;
  - OKX `posSide` (levierul izolat pe parte); Bitget clasic `tradeSide` open / close (levierul izolat cu `holdSide`), unificat `posSide`;
  - eToro poziții separate pe linie; Alpaca o poziție netă pe simbol; Trading 212 fără short; Kraken / Coinbase doar spot; IBKR doar citire
- [x] FD-HEDGEALL / TD-HEDGEALL
- [x] Implementare:
  - `crypto.ts`: modul citit pentru toate futures (Bybit nou), `hedged: true` pe toate (KuCoin unificat refuzat), Bitget fără `oneWayMode` în hedge, levierul izolat pe parte (OKX, Bitget), TP / SL Binance în hedge, nepotrivirea modului pe orice exchange (cu numele lui);
  - eToro: ambele părți în formular, „Închide” / „De închis” la short-uri; Alpaca: poziția netă spusă; Tranzacții: cheia rândurilor;
  - pașii cheilor (OKX, Bybit), FD-TRADING / TD-TRADING / FD-KUCOINHEDGE / ghidul
- [x] Teste (ccxt real: Binance, Bybit, OKX, Bitget clasic și unificat; simulat: nepotrivirea pe Binance; eToro, Alpaca); verificat în Chrome:
  - eToro simulat: două short-uri pe rânduri separate, „Poziții separate · long 2 · short 2”, „Închide” / „De închis”;
  - KuCoin hedge din nou (regresie)
- [x] Review rounds: 110: 2 probleme (partea ordinelor Bybit / OKX / Bitget, mesajul `HEDGE_MODE`); 111: 1 (TD-TRADING); 112: 1 (comentarii); 113: zero probleme; suita completă: 64 de fișiere, 617 teste
- [x] Publicat pe Azure (deploy `853f38b3`, împreună cu graficul TradingView, hedge-ul KuCoin și hedge-ul pe toate platformele): prima încercare (`0745c3c6`) oprită de Azure la o repornire a containerului de build, în timpul `npm ci` (codul vechi a rămas neatins); a doua: build 04:34–04:38 UTC cu aplicația oprită, pornit la 04:40 UTC, `/api/ping` 200, „Sentiq running”, textele noi în codul servit; fără migrare de schemă; fără commit

## Lista de simboluri pe telefon: panou din dreapta (20 oct 2026)
- [x] Cererea (după deploy): pe telefon, lista nu trebuie sub grafic, ci un panou care glisează din dreapta; ascunsă nu mai putea fi readusă; pagina se lățea
- [x] Reprodus în Chrome (320–430 px, cu atingere, cont cu tranzacționarea pornită): grupul butoanelor nu se rupea (până la 545 px), deci pagina era mai lată decât ecranul, iar butonul listei ajungea în afara lui (x 445–489)
- [x] FD-WATCHDRAWER / TD-WATCHDRAWER
- [x] Implementare: `media.ts` (`useMediaQuery`), `ListDrawer`; în `Charts.tsx`, panoul lateral doar de la 768 px, iar sub 768 px panoul glisant (închis la intrare, neținut minte); grupul butoanelor se rupe sub 768 px; Esc în ecranul complet închide întâi panoul
- [x] Teste (`media.test.ts`); verificat în Chrome:
  - telefon 320 / 360 / 390 / 430 / 744 px: pagina de lățimea ecranului; panoul din dreapta se deschide și se închide cu umbra, cu butonul lui și cu alegerea unui simbol; focusul în panou, pagina blocată; ecranul complet (Esc închide întâi panoul);
  - rotirea 390 → 900 → 390;
  - tabletă / desktop 768 / 1024 / 1440: panoul lateral ca înainte (ascuns, arătat, ținut minte); fluxurile vechi (1440, iPad 1180)
- [x] Review rounds: 114: 1 problemă (Tab ieșea din panoul modal); 115: zero probleme; suita completă: 65 de fișiere, 619 teste
- [x] Publicat pe Azure (deploy `08e4e061`: aplicația oprită la 05:08 UTC, deploy după un minut de pauză, build 05:09–05:12 UTC, pornit la 05:14 UTC, `/api/ping` 200, „Sentiq running”, panoul în codul servit); fără migrare de schemă; fără commit

## Pinch pe grafic, butonul listei în dreapta; glisarea panoului (20 oct 2026)
- [x] Cererea: „Pinch to zoom pe grafic face pe pagină, nu pe grafic; comportamentul e inconsecvent”; butonul listei primul la dreapta; „Se deschide până în extremă stânga și apoi se mută în dreapta”; un singur deploy, la final
- [x] Cercetare și reproducere:
  - lightweight-charts renunță la pinch la orice mișcare a primului deget înainte de al doilea; Safari trimite și mișcările de 1 px, iar Chrome le ascunde (reprodus cu `TouchEvent`-uri DOM: 1 / 3 px → graficul nemărit);
  - panoul: focusul derula stratul în timpul glisării (cadru cu cadru: `scroll334`)
- [x] FD-CHARTTOUCH / TD-CHARTTOUCH (și TD-WATCHDRAWER pentru glisare)
- [x] Implementare:
  - `touch-none` pe tot graficul; primele mișcări (sub 8 px) ale unui singur deget nu ajung la bibliotecă; tragerea la atingere de la 8 px; al doilea deget lasă „A” aprins;
  - butonul listei ultimul, `ml-auto`; bara aliniată la dreapta când e pe rândul ei;
  - panoul: focus fără derulare, strat `overflow-clip`
- [x] Verificat în Chrome:
  - pinch ca în Safari (0 / 1 / 3 / 6 px înainte → mărit, „A” aprins; 10 px → tragere) la 390 și 1180 px; pinch prin CDP; un deget pe orizontală (A aprins) și pe verticală (A stins); atingere pe „A”;
  - butonul listei ultimul și la marginea conținutului la 320 / 390 / 768 / 1024 / 1440;
  - panoul cadru cu cadru; fluxurile de telefon, desktop, iPad, rotirea, Tab
- [x] Review rounds: glisarea raportată după deploy (reparată, notată); 116: zero; 117: 1 problemă (apăsarea lungă nedocumentată); 118: zero probleme; suita completă: 65 de fișiere, 619 teste
- [x] Publicat pe Azure (cerut: „Faci deploy când termini”), un singur deploy (`e72ebab7`): aplicația oprită la 05:50 UTC, deploy după un minut, build 05:51–05:54 UTC, pornit la 05:55 UTC, `/api/ping` 200, „Sentiq running”, reparațiile în codul servit; fără migrare de schemă; fără commit

## Lista, bara, A / L și „+”: corecturi (20 oct 2026)
- [x] Cererea:
  - spațiu între rândurile listei; la capătul listei derularea trece la pagină;
  - fără butonul din capul listei; bara aliniată la stânga, doar butonul listei la dreapta;
  - A / L la baza scalei prețului; crucea păstrată pe „+”
- [x] FD-CHARTPOLISH / TD-CHARTPOLISH
- [x] Implementare:
  - `Watchlist.tsx`: `gap-1`, `overscroll-auto` în panoul lateral, fără butonul din cap; panoul de telefon se închide trăgându-l spre dreapta (`touch-pan-y` pe panou și pe rânduri);
  - `Charts.tsx`: partea din dreapta a barei `flex-[1_1_auto]`, butonul listei separat cu `ml-auto`, grupul `contents` pe telefon;
  - `CandleChart.tsx`: A / L la baza panoului cu lumânări (`bg-chart`), `HLinePlus` pune crucea la loc cât e mouse-ul pe el sau meniul e deschis, o șterge la plecarea în afara graficului
- [x] Verificat în Chrome (măsurători și capturi):
  - bara: intervalele la marginea stângă a conținutului, butonul listei la cea dreaptă, la 320 / 390 / 430 / 768 / 1024 / 1440; pe telefon, pe rândul lui „Indicatori”;
  - rândurile: 4 px între ele; hover lângă rândul deschis (captură);
  - rotița: lista derulează (120 → 240 → 246 / 246), apoi pagina (0 → 541);
  - A / L: baza lor la linia dintre lumânări și LMA, în coloana scalei (1440 / 1024 / 768);
  - „+”: eticheta prețului și linia punctată rămân cu mouse-ul pe el (pixeli și captură), dispar plecat de pe grafic (1440 / 1024 / 768);
  - telefon: capul fără buton; tragerea de 40 px îl lasă, cea de 140 px îl închide; tragerea pornită pe un rând nu-l deschide; atingerea îl deschide; derularea verticală merge;
  - fluxurile vechi: telefon, glisarea cadru cu cadru, Tab, rotirea, 1440, iPad, pinch
- [x] Review rounds: 119: 3 probleme (crucea pe LMA, spațiul lui „»”, rigla care lățea pagina); 120: 1 (Azi pe telefon); 121: zero probleme
- [x] Publicat pe Azure, un singur deploy pentru lot (`9c37795a`): aplicația oprită la 07:42 UTC, deploy după un minut, build 07:43–07:47 UTC, pornit la 07:48 UTC, `/api/ping` 200, „Sentiq running”, schimbările în codul servit; fără migrare de schemă; fără commit

## Bara de sus pe un singur rând, cu „»” (20 oct 2026)
- [x] Cererea (cu o captură: bara pe două rânduri): un rând; meniurile care nu încap sub „»”, cu lista plutitoare
- [x] FD-NAVOVERFLOW / TD-NAVOVERFLOW
- [x] Implementare: `components/PriorityNav.tsx` (`fitCount`, rigla, „»”, lista, tastatura); `TopNav` fără `flex-wrap` și fără rândul de telefon
- [x] Teste (`priority-nav.test.ts`); verificat în Chrome la 320 / 390 / 768 / 1024 / 1280 / 1440 / 1700 / 2000:
  - un rând (înălțimea antetului 57 px, toate pe același mijloc), nimic tăiat, pagina de lățimea ecranului;
  - „»” deschide lista cu paginile ascunse; Esc (focusul înapoi pe „»”), ↓ / ↑, click în afară;
  - pagina deschisă ascunsă colorează „»”; de la 1700 px încap toate, iar „»” dispare;
  - capturi
- [x] Review rounds: în lotul cu FD-CHARTPOLISH (119–121)
- [x] Publicat pe Azure, un singur deploy pentru lot (`9c37795a`): aplicația oprită la 07:42 UTC, deploy după un minut, build 07:43–07:47 UTC, pornit la 07:48 UTC, `/api/ping` 200, „Sentiq running”, schimbările în codul servit; fără migrare de schemă; fără commit

## Toate paginile pe toată lățimea (20 oct 2026)
- [x] Cererea: „fă-le pe toate full width”, ca pe Calendar, Economie, Grafice
- [x] FD-FULLWIDTH / TD-FULLWIDTH
- [x] Implementare: `<main>` fără `max-w-[1600px]`; Știri, Tranzacții, Setări, Setări admin, Stare sistem, Utilizatori (1240), Securitate (1100), Economie (1400) fără limita lor
- [x] Verificat în Chrome la 1440 și 1920: pe toate cele 11 pagini, conținutul are marginile lui `<main>` (ca la Calendar), fără lățime în plus; capturi (Azi, Știri, Setări, Tranzacții, Stare sistem)
- [x] Review rounds: în lotul cu FD-CHARTPOLISH (119–121)
- [x] Publicat pe Azure, un singur deploy pentru lot (`9c37795a`): aplicația oprită la 07:42 UTC, deploy după un minut, build 07:43–07:47 UTC, pornit la 07:48 UTC, `/api/ping` 200, „Sentiq running”, schimbările în codul servit; fără migrare de schemă; fără commit

## iPad: ecranul complet nu se mai închide la tragerea în jos; loc pentru ✕ (20 oct 2026)
- [x] Cererea:
  - pe iPad, tragerea în jos în ecranul complet scotea din el (de la versiunea de la 10:48; cauza, spusă de utilizator: derularea trecută la pagină de la capătul listei, din FD-CHARTPOLISH);
  - primul rând mai la dreapta, pentru ✕-ul Safari;
  - pe iPhone, partea de sus a panoului de simboluri tăiată
- [x] FD-IPADFS / TD-IPADFS
- [x] Implementare:
  - `Watchlist.tsx`: prop `contained`, rândurile `overscroll-contain` și în ecranul complet;
  - `Charts.tsx`: `contained={fs.active}` pe panoul lateral, numele la `pl-20` pe iPad în ecranul complet al sistemului;
  - FD-CHARTTV §1, FD-CHARTPOLISH §1, TD-uri și ghid actualizate
- [x] Verificat în Chrome:
  - iPad în ecranul complet nativ (1024 × 768, 1366 × 1024): lista `contain`, numele la 80 px; ieșit, lista `auto`;
  - ecranul complet „din pagină” (1024 × 768, 820 × 1180, 844 × 390, 932 × 430): la fel;
  - rotița: în afara ecranului complet, lista apoi pagina; în ecranul complet, lista se oprește la capăt (cadrul și pagina nemișcate);
  - telefon: capul panoului vizibil (390 × 844, pagina derulată, și orizontal); lățimea paginii cât ecranul peste tot
- [x] iPhone, partea de sus a panoului: nereprodusă în Chrome; tratată în FD-IPADFS2
- [x] Rezultat pe iPad (utilizatorul, după deploy): ieșirea la tragerea în jos a rămas; cauza reală și reparația în FD-IPADFS2
- [x] Review rounds: 122: 1 problemă (cadrul trecut necerut la `overscroll-none`, înapoi la `contain`); 123: 1 (FD-ul dădea ca sigure lucruri neverificate pe iPad); 124: 1 (TD-CHARTPOLISH §1 rămas în urmă); 125: zero probleme
- [x] Teste: 66 fișiere, 622 teste, toate trec
- [x] Publicat pe Azure, un singur deploy (`dd04edcd`): aplicația oprită la 08:51 UTC, deploy după un minut, build 08:52–08:55 UTC, pornit la 08:56 UTC, `/api/ping` 200, „Sentiq running”, schimbările în codul servit (`pl-20`, fără `pl-14`); fără migrare de schemă; fără commit

## iPhone și iPad: ecranul complet „din pagină” (20 oct 2026)
- [x] Cererea: „Nu a funcționat. Rezolvă.”; orice tragere în jos scoate din ecranul complet; „nici pe iPhone nu funcționează”
- [x] Cercetare:
  - codul WebKit: ecranul complet al sistemului pe iPhone / iPad iese la orice tragere în jos, recunoscută odată cu derularea paginii;
  - inginerul WebKit (bug 264215): intenționat, pagina nu-l poate opri;
  - a apărut odată cu lista din ecranul complet (FD-CHARTTV), a cărei derulare e o tragere în jos
- [x] FD-IPADFS2 / TD-IPADFS2
- [x] Implementare:
  - `fullscreen.ts`: `isAppleTouch()` (în locul lui `isIPad()`), `nativeFullscreenAllowed()`, iar `enter()` nu mai cere ecranul complet al sistemului pe iPhone / iPad;
  - `Charts.tsx`: fără `pl-20` / `iPad`;
  - `apple-touch.test.ts`; documentele și ghidul
- [x] Verificat în Chrome, cu click real:
  - iPad (1024 × 768, 820 × 1180) și iPhone (390 × 844, 430 × 932, 844 × 390): ecranul complet „din pagină” (cadrul cât fereastra, pagina blocată, lista `contain`), Esc iese, pagina de lățimea ecranului;
  - iPhone: capul panoului de simboluri vizibil în ecranul complet;
  - Mac (1440 × 900): ecranul complet al sistemului, ca până acum
- [x] Review rounds: 126: 3 probleme (comentariu / ternar, comentariul lui `contained`, nota din FD-IPADFS); 127: 2 (TD-IPADFS §3, testele din TD-CHARTTV); 128: 1 (o presupunere despre iPhone dată ca sigură); 129: zero probleme
- [x] Teste: 66 fișiere, 623 teste, toate trec
- [x] Publicat pe Azure, un singur deploy (`6a364703`): aplicația oprită la 09:30 UTC, deploy după un minut, build 09:31–09:35 UTC, pornit la 09:36 UTC, `/api/ping` 200, „Sentiq running”, schimbările în codul servit (`iPhone|iPod|iPad`, fără `pl-20`); fără migrare de schemă; fără commit

## Pagina Grafice testată buton cu buton (20 oct 2026)
- [x] Cererea: test pe toată pagina, fiecare buton, în și în afara ecranului complet; „+” rămas în urmă; „+” care nu dispare după închiderea meniului
- [x] Testat:
  - Safari real din simulatorul iOS 27 (iPhone 17 Pro, iPad Pro 11"), comandat de la distanță într-o copie de test, cu capturi;
  - Chrome pe desktop (mouse, ecranul complet al sistemului) și pe telefon / tabletă (atingeri);
  - simulatoarele, oprite și șterse la cererea utilizatorului (încărcau laptopul)
- [x] FD-CHARTAUDIT / TD-CHARTAUDIT
- [x] Reparat:
  1. „+” se mută în același cadru cu crucea;
  2. pe ecran tactil, „+” și crucea dispar după o atingere în afara meniului și după adăugarea liniei;
  3. panoul de setări (indicatori, Slingshot, LMA, linia) cât partea vizibilă, cu butoanele de jos pe ecran (pe iPhone / iPad erau sub ecran); pe telefon, toată lățimea;
  4. „Pe grafic” / „Pe grafic × N” în „Indicatori”;
  5. căutarea din listă: ↓ / ↑ / Enter, iar Esc golește întâi căutarea;
  6. eticheta de stare LMA trece în stânga când ar fi tăiată;
  7. panoul graficului își păstrează înălțimea cât se încarcă un alt interval / simbol;
  8. bannerul „nu răspunde” și în ecranul complet;
  9. butonul listei nu mai rămâne singur pe un rând (1180 px, 1024 px în ecranul complet);
  10. meniul lui „+” nu mai trece de marginea graficului la 320 px
- [x] Verificat în Chrome după reparații:
  - „+” la 0 px de cursor chiar în evenimentul de mișcare (25 de mișcări);
  - atingeri: apariția, închiderea, adăugarea;
  - telefon 320 / 390 în ecranul complet: toate ferestrele deasupra și pe ecran, „Salvează” vizibil;
  - bara la 320–1440 px;
  - căutarea cu tastele; „Pe grafic × 2”;
  - intervalul nou: 682 px în fiecare cadru;
  - bannerul în ecranul complet
- [x] Review rounds: 130: 2 probleme (`aria-activedescendant`, două alerte); 131: 1 (ghidul); 132: zero probleme
- [x] Retestat în Safari (simulatoarele iOS 27, câte unul pornit; FD §12):
  - iPhone 17: toate reparațiile 1–10 confirmate;
  - iPad Air 11": bara, panoul de setări, gesturile cu „+”
- [x] Găsite la retestare și reparate (FD §13–§18):
  11. pe ecran tactil, apăsarea lungă și tragerea nu mai mută prețurile și nu mai opresc „A”;
  12. după ce „+” dispare printr-o atingere, graficul iese din modul cruce: următoarea glisare îl derulează (înainte readucea crucea și „+”);
  13. „⌥H” nu mai apare în meniul lui „+” pe telefon;
  14. o glisare pornită de pe o linie orizontală nu-i mai deschide setările
- [x] Review rounds: 133: 2 probleme (FD §18, ghidul); 134: 3 (TD §11, FD §12, TD §15); 135: zero probleme
- [x] Teste: 69 fișiere, 632 teste, toate trec
- [x] Deploy: `6357bc2e` (20 oct 2026, 13:11 UTC); „Sentiq running” în jurnal, iar codul nou e în fișierele servite

## FD-MODALFIT — ferestrele nu mai ies din ecran pe iPhone / iPad (20 oct 2026)
- [x] FD-MODALFIT / TD-MODALFIT
- [x] Cauza: ferestrele (Modal: „Indicatori”, „Ordin nou” și celelalte; asistentul de conturi; rezumatul zilei; căutarea) își luau înălțimea din `vh`, care pe iPhone / iPad e mai mare decât partea vizibilă; cu lista lungă („Indicatori” → „Toți”) jos ieșeau din ecran
- [x] Reparat: înălțimea din partea vizibilă (`max-h-full` în stratul `fixed inset-0`); cu tastatura de pe ecran, ferestrele, panoul de setări al graficului și panoul listei stau deasupra ei (`useVisibleArea`)
- [x] Verificat în Chrome (un singur browser, închis după): 390×664, 844×340, 1180×740, în și în afara ecranului complet, și cu pagina mărită 2×: marginea de jos în ecran, ✕ vizibil, lista se derulează
- [x] Review rounds: 136: 1 problemă (FD-CHARTAUDIT §10); 137: zero probleme
- [x] Teste: 70 fișiere, 636 teste, toate trec
- [x] Deploy: `10a592ea` (20 oct 2026, 16:35 UTC)

## FD-SCOREWHY — „De ce acest scor?” în „Ce mișcă piața” (Azi) (20 oct 2026)
- [x] Cerut: la fiecare știre din „Ce mișcă piața”, ca pe pagina Știri (ales de utilizator dintre: Ce mișcă piața / Știri live / Sentimentul zilei)
- [x] FD-SCOREWHY / TD-SCOREWHY
- [x] Server: `explainDrivers` (motorul, meta, relevanța, importanța, ca `queryNews`, pentru scorul folosit de indice), doar în răspunsul `/api/sentiment/today`, nesalvat
- [x] Web: `ScoreWhy.tsx` comun cu pagina Știri; în „Ce mișcă piața” plus „Cântărește X% din indicele zilei”
- [x] Verificat în Chrome (390 și 1440 px) cu știri de test: toate rândurile, procentele adunate ≈ 100%, fără lățire, fără erori
- [x] Review rounds: 138: 1 problemă (ghidul); 139: zero probleme
- [x] Teste: 71 fișiere, 641 teste, toate trec
- [x] Deploy: `10a592ea` (20 oct 2026, 16:35 UTC)

## FD-INDEXWHY — „Cum s-a calculat?” la Sentimentul zilei (Azi) (20 oct 2026)
- [x] FD-INDEXWHY / TD-INDEXWHY
- [x] Calculul: `explainIndex` din aceleași funcții ca indicele (`select`, `weigh`, `aggregate`), cu termenii fiecărei știri; ponderile identice la ultima cifră (ordinea înmulțirilor păstrată), testele vechi ale indicelui trec
- [x] Serverul: `explainToday` (primele 100 de știri cu „De ce acest scor?”, restul însumat), `GET /api/sentiment/today/explain`, pentru indicele utilizatorului (AI-ul lui, filtrul lui)
- [x] Fereastra: pașii 1–6 cu cifrele de azi, categoriile, sursele (greutatea, plafonul), știrile (20 o dată, până la 100, apoi „Celelalte”), parametrii; „Recalculează”
- [x] Verificat în Chrome (390 și 1440 px, 137 de știri de test): indicele ferestrei = cel de pe card, fereastra încape, fără lățire (după reparația formulelor), fără erori
- [x] Review rounds: 140: 4 probleme (plafonul la pondere 0, greutatea sursei, explicația goală, FD); 141: zero probleme
- [x] Teste: 72 fișiere, 649 teste. Din 4 rulări complete, prima a avut un test picat (neidentificat, ieșirea nu era salvată); următoarele 3 au trecut toate, inclusiv cea cu ieșirea păstrată
- [x] Deploy: `10a592ea` (20 oct 2026, 16:35 UTC)

## FD-WHYPLAIN — explicații pe înțeles (20 oct 2026)
- [x] FD-WHYPLAIN / TD-WHYPLAIN (pornit de la datele reale: 1.147 de știri, 937 neutre, driverii mută indicele cu 0,1–0,2 puncte)
- [x] „Ce mișcă piața”: de ce sunt acolo (rândul de sus); la fiecare, cât a mutat indicele („Fără ea, indicele ar fi …”), calculat refăcând indicele fără știre; de ce cântărește (față de o știre obișnuită: importanța, sursa, vechimea, povestea, factorul, plafonul)
- [x] „Cum s-a calculat?”: pe rândul de titlu al cardului; „Pe scurt” în cuvinte; „fără ea” la fiecare știre
- [x] Motivul scorului de la AI-ul utilizatorului: cerut cu scorul (o propoziție în română), salvat (migrarea 6), arătat primul în „De ce acest scor?” (Azi și Știri); doar pentru știrile notate după deploy
- [x] Verificat în Chrome (schema de test, 390 și 1440 px); pornit local pe baza reală fără motiv (fără migrare), ca utilizatorul să vadă restul
- [x] Review rounds: 142: 5 probleme (o singură încărcare a știrilor, TD, FD, „Pe scurt”, teste vechi); 143: zero; după vitest, 1 test vechi actualizat; 144: zero
- [x] Corecții cerute: titlul „Sentimentul zilei” e legătura spre „Cum s-a calculat?” (fără buton separat); insigna PREMIUM după titlul ferestrei (doar insigna: nu există încă plăți / acces premium); legătura nu se aprindea venind de jos (cifra mare o acoperea), reparat
- [x] Review rounds: 145, 146: zero probleme
- [x] Teste: 74 fișiere, 658 teste, toate trec
- [x] Deploy: `10a592ea` (20 oct 2026, 16:35 UTC)

## FD-HISTORYCHART — „Ultimele 30 de zile” pe toată înălțimea, cu Fear & Greed (20 oct 2026)
- [x] FD-HISTORYCHART / TD-HISTORYCHART (ales de utilizator: graficul mărit cu valoarea la hover + comparația cu Fear & Greed)
- [x] Trei linii 0–100 pe aceeași scară: Sentiq (azi = indicele live), Crypto F&G (alternative.me), Stocks F&G (CNN); legenda ascunde / arată liniile, scara se mărește pe ce e afișat; hover / atingere cu valorile zilei, ținut în panou; etichetele scării într-o margine
- [x] Fără cereri noi (aceeași interogare a contextului pieței ca banda)
- [x] Verificat în Chrome (schema de test cu istoric și Fear & Greed): panoul cât „Ce mișcă piața” la 1440 px; telefon 390 fără ieșiri
- [x] Review rounds: 147: 1 problemă (FD); 148, 149: zero probleme
- [x] Teste: 75 fișiere, 663 teste, toate trec
- [x] Deploy: `10a592ea` (20 oct 2026, 16:35 UTC)

## FD-MULTICAT — surse de știri cu mai multe categorii („General”) (20 oct 2026)
- [x] FD-MULTICAT / TD-MULTICAT
- [x] Migrarea 7 (`sources.categories`); `category` rămâne prima categorie
- [x] La o sursă cu mai multe categorii, fiecare știre primește categoria pe care o tratează (monede, companii, cuvintele subiectului); una fără niciun semn: relevanța 0, în afara indicelui
- [x] Aducere, titlu schimbat, reetichetarea zilnică și schimbarea categoriilor (reclasează știrile păstrate) folosesc aceeași regulă
- [x] Setări → Admin → Surse: „Categorii” cu patru butoane și „Toate (general)” la adăugare; „Schimbă” la sursele adăugate
- [x] Verificat în Chrome (1440 și 390 px); testele noi (clasare, aducere, reetichetare, rută)
- [x] Review rounds: 150: 3 probleme; 151: zero probleme
- [x] Teste: 76 fișiere, 671 teste, toate trec
- [x] Deploy: `10a592ea` (20 oct 2026, 16:35 UTC)

## FD-HTMLFEED — știri de pe site-uri fără RSS (20 oct 2026)
- [x] FD-HTMLFEED / TD-HTMLFEED, cercetat pe site-uri reale (CoinDesk, CNBC, Benzinga, Reuters, AP News)
- [x] O adresă de pagină se citește, în ordine: feed RSS; feed declarat în pagină; JSON-LD; titlurile din pagină (cititor propriu, fără biblioteci noi); sitemap-ul de știri al site-ului (pentru pagini blocate sau fără titluri)
- [x] `robots.txt` respectat la pagini și sitemap-uri (Reuters refuzat); fără ocolirea protecțiilor anti-bot; doar adrese ale aceluiași site
- [x] Migrarea 8 (`sources.read_as`, `read_url`): modul găsit la adăugare, folosit la fiecare citire (la 10 minute)
- [x] Titlurile fără dată: la prima citire doar notate; apoi cele noi intră cu ora la care au fost văzute; data doar din adresă → ora la care a fost văzută, după prima citire
- [x] Admin: „Testează” spune cum se citește și câte știri au dată; tabelul arată modul
- [x] Verificat în Chrome cu adrese reale: CoinDesk Markets (pagină, 27), Benzinga Markets (sitemap, 291), Reuters (refuzat, robots.txt), feed-ul Benzinga
- [x] Review rounds: 152: 3 probleme; 153: zero probleme
- [x] Teste: 78 fișiere, 693 teste, toate trec
- [x] Deploy: `10a592ea` (20 oct 2026, 16:35 UTC), cu migrările 6, 7, 8; „Sentiq running” în jurnal, codul nou în fișierele servite
- [x] Benzinga adăugat (cerut ca cel mai important): `https://www.benzinga.com/`, General, citit din sitemap-ul lor Google News; prima citire pe Azure: 486 de știri, fără eroare (Acțiuni 340, Crypto 117 din care 90 fără subiect, relevanța 0, Macro 16, Geopolitică 13)

## FD-AIQUOTA — erorile de credit și de limită ale AI-ului, spuse exact (20 oct 2026)
- [x] Cauza la utilizatorul 2 (Gemini), din jurnalul Azure:
  - 12:49 UTC: `402: Your prepayment credits are depleted` (soldul Prepay al proiectului era 0);
  - de la 14:12: refuzul de limită zilnică, ascuns sub mesajul general, inclusiv cu cheia salvată din nou la 16:51;
  - limitele Google sunt ale proiectului, nu ale cheii.
- [x] FD-AIQUOTA / TD-AIQUOTA
- [x] Gemini: mesaj precis pentru Prepay epuizat (402 sau 429), limita zilnică a nivelului gratuit sau plătit (câte cereri, pentru ce model, „limita e a proiectului, nu a cheii”), limita 0 (model indisponibil pe nivel); ora resetării (miezul nopții ora Pacificului) în fusul utilizatorului
- [x] Textul exact al furnizorului (orice furnizor) sub mesaj, la erorile de credit și limită și la cele de cereri pe minut; în jurnal la fel; cheile citate de furnizor ascunse peste tot
- [x] Pauza și eroarea rămân după o repornire (nu se mai trimite o cerere imediat după deploy); eroarea veche dispare la primul răspuns bun și după o repornire (bug reparat)
- [x] Salvarea cheii AI-ului ales (chiar aceeași) sau o altă alegere AI reîncearcă imediat, pe oricare instanță
- [x] Verificarea cheii la salvare: același mesaj precis dacă Google refuză și lista de modele
- [x] Verificat în Chrome (schema de test, o stare ca a utilizatorului 2): 1440 și 390 px, fără ieșiri orizontale, fără erori
- [x] Review rounds: 154: 4 probleme; 155: 2; 156: 1; 157: 1; 158: zero probleme
- [x] Teste: 79 fișiere, 706 teste, toate trec
- [x] Deploy: 20 oct 2026, 18:41 UTC (deployment 0cbffd5b); schema rămâne v8

## FD-AISLOW — scorarea AI când furnizorul răspunde greu (20 oct 2026)
- [x] Cauza la utilizatorul 2 (eroarea din captură: „Google nu a răspuns la timp”, nu una de credit):
  - de la 12:58 UTC, gemini-3.8-flash răspunde în 30–60 s, adesea peste 90 s; la 12:54–12:57 răspundea în ~5 s;
  - după fiecare timp depășit, 5 minute de pauză: ~25 de titluri la 7 minute, 1.639 în așteptare;
  - pe forumul Google, rapoarte de lentoare și 503 la 3.8 Flash de la 13 oct, mai rău pe 20 oct; problema e la Google.
- [x] FD-AISLOW / TD-AISLOW
- [x] Un lot are 3 minute (înainte 90 s), cu reîncercările cu tot, la toți furnizorii; mesajul spune cât s-a așteptat („Google nu a răspuns în 3 minute”)
- [x] După o eroare trecătoare: pauza 1 → 2 → 4 → 8 → 15 minute, la zero după primul răspuns; credit 30 de minute, cheie refuzată până se schimbă (neschimbate)
- [x] Utilizatorii în paralel (câte 4), un lot fiecare pe rundă; nicio rundă nouă după 5 minute: un furnizor lent nu-i mai ține pe ceilalți
- [x] Setări → AI: o singură eroare trecătoare nu mai aprinde avertismentul; de la a doua, „(a N-a eroare la rând)”, ora reîncercării, sfatul de a alege alt model
- [x] Rândul de progres: „Ultimele 48 h: Gemini a scorat X din Y titluri; ultimul scor acum N min.”
- [x] Jurnalul: loturile care răspund după mai mult de un minut, cu durata
- [x] Verificat în Chrome (schema de test, 3 erori la rând, 12 din 30 scorate): 1440 și 390 px, fără ieșiri orizontale, fără erori
- [x] Review rounds: 159: 4 probleme; 160: 3; 161: 1; 162: 2; 163: zero; 164: 1 (găsită de suita completă); 165: zero probleme
- [x] Teste: 81 fișiere, 723 teste, toate trec
- [x] Deploy: 20 oct 2026, 20:28 UTC (deployment 40b71ff8), cu FD-EARNTV

## FD-EARNTV — data rezultatelor trimestriale și de la TradingView (20 oct 2026)
- [x] Cauza: Nasdaq (date de la Zacks) avea SPCX pe 3 nov., ca dată estimată algoritmic, deși SpaceX anunțase pe 16 oct. rezultatele pe 20 oct., după închidere; TradingView avea data corectă, marcată confirmată
- [x] FD-EARNTV / TD-EARNTV (codurile TradingView deduse din 227 de companii: 10 estimată; 11 / 12 / 13 confirmată înainte de deschidere / după închidere / fără oră)
- [x] O cerere TradingView pentru toate acțiunile din favorite, la fiecare reîmprospătare (6 h și la adăugare)
- [x] Data confirmată de TradingView câștigă; o dată Nasdaq diferită dispare; după o publicare, o dată Nasdaq la mai puțin de 45 de zile e sărită; o estimare TradingView nu schimbă nimic
- [x] Doar la TradingView: Prognoza = EPS-ul estimat de TradingView, fără Anterior; nota spune de unde e data și numerele
- [x] TradingView căzut sau cu coloane schimbate: doar Nasdaq, cu avertisment în jurnal, fără eroare de job
- [x] Verificat pe datele reale (fără scriere): SPCX azi, după închidere; TSLA, META, TXN mâine; restul pe zilele lor
- [x] Review rounds: 166: 3 probleme; 167: 1; 168: 2; 169: zero probleme
- [x] Teste: 82 fișiere, 735 teste, toate trec
- [x] Deploy: 20 oct 2026, 20:28 UTC (deployment 40b71ff8), cu FD-AISLOW; schema rămâne v8; primul job după deploy a pus SPCX pe 20 oct., 16:30 ET

## FD-WATCHLISTS — Liste de urmărire (20–21 oct 2026)
- [x] Alegerile utilizatorului: toate listele împreună alimentează restul aplicației; descrierile traduse cu AI-ul utilizatorului
- [x] FD-WATCHLISTS / TD-WATCHLISTS
- [x] Migrarea 9: `watch_lists`, `watch_list_items`; favoritele fiecăruia devin lista „Favorite”; `watchlist` rămâne registrul (reuniunea)
- [x] Pagina „Liste de urmărire” (după Tranzacții): liste (nouă, redenumire, ștergere, ordine), adăugare, selecție multiplă (Shift + clic), Copiază / Mută / Șterge, ordine, aliasuri, prețuri
- [x] Popup „Date financiare”: descrierea (Nasdaq / CoinGecko / Sentiq), tradusă cu AI-ul tău și ținută minte; ultimele 4 trimestre (TradingView), comparația cu anul trecut, rezultatele următoare; ETF / indici / crypto fără rezultate
- [x] Grafice: dropdown cu listele în panoul de simboluri, lista aleasă ținută minte
- [x] Setări fără panoul Favorite; textele „favorite” → „urmărite” unde însemnau toate listele; consumul AI cu rândul „Traduceri”
- [x] Rutele vechi `/api/watchlist` lucrează peste liste (o filă deschisă înainte de actualizare)
- [x] Verificat în Chrome pe o schemă de test (server de test cu codul nou): 1440 și 390 px, fără ieșiri orizontale, fără erori
- [x] Review rounds: 170: 5 probleme; 171: 2 (Chrome); 172: 1; 173: zero probleme
- [x] Teste: 85 fișiere, 756 teste, toate trec
- [x] Testare locală pe datele reale (FD-LOCALSTAGE, decizia utilizatorului): Sentiq local cu codul nou, baza reală migrată la v9 pe 21 oct, 00:57 (ora României); fiecare utilizator are lista „Favorite”
- [x] Reparații după testarea utilizatorului (rundele 174–177):
  - nimic nu mai împinge pagina (bara selecției, mesajele, „+”, indicii);
  - rândurile alternante nu mai ies din panou;
  - reetichetarea știrilor trece în fundal, iar schimbările se văd imediat;
  - 762 de teste trec.
- [x] Deploy: 21 oct 2026, 01:49 (ora României; deployment 37de46c0), cerut de utilizator după reparații; baza era deja la v9

## FD-SLINGSHOT34 — Slingshot System 3.4: partea SHORT (21 oct 2026)
- [x] FD-SLINGSHOT34 / TD-SLINGSHOT34
- [x] **Pine:** `sling-shot-system-3.4.pine`, fișier nou (repo separat, necomis). Conține:
  - grupul „Signals” (Long, Short, culoarea short-ului), cu eroare dacă amândouă sunt debifate;
  - mașina SHORT, TP/SL, istoricul și alertele ei;
  - afișarea TP/SL a fiecărei părți.
  `sling-shot-system.pine` (3.3) e neatins.
- [x] **Portul** `slingshot.ts` (3.4, linie cu linie). Setările noi au `refine`: cel puțin o parte bifată.
- [x] **Sentiq:**
  - graficul (SHORT, TAKE PROFIT short, TP/SL ale fiecărei părți, prin modulul nou `slingshot-draw.ts`);
  - setările (ultima casetă bifată blocată);
  - tabelul de semnale, alertele, caseta TP/SL;
  - Azi (scanner) și contextul AI.
- [x] **Corecție la cererea utilizatorului (21 oct 2026).** SHORT-ul trebuie să aibă exact regulile LONG-ului, inversate, iar backtest-ul verifică doar că semnalele se activează unde trebuie. Am scos două lucruri adăugate de mine:
  - regula „confirmare doar cu o închidere sub nor”, aleasă după rata de succes; ea sărea semnale valide;
  - legătura dintre părți (un semnal nou al unei părți oprea urmărirea TP/SL a celeilalte).

  Acum fiecare parte e independentă și își afișează singură TP/SL-ul. Din FD au ieșit cifrele de succes.
- [x] **Verificări pe toate cele 192 de serii reale** (44 de monede pe 1h / 4h / 1d, 60 de acțiuni și ETF-uri pe 1d):
  - SHORT pe graficul real = LONG pe graficul întors (6273 de semnale SHORT; etichete, alerte, TP/SL, stare);
  - ambele bifate = fiecare parte singură;
  - doar Long = 3.3;
  - fiecare SHORT verificat față de regulile scrise, independent de cod.
- [x] **Pine:** codul SHORT = codul LONG trecut mecanic prin tabelul de inversare (mașina de stări, TP/SL, istoricul, afișarea). Singura diferență e blocul mort `currentCycleLabel` din LONG.
- [x] **Chrome**, pe schema de test, cu interfața construită în scratchpad:
  - caseta TP/SL cu LONG urmărit și SHORT în formare (AVAX 4h, 17 sep), la 1440 / 390 / 320;
  - textul nu se rupe și caseta rămâne în grafic, inclusiv cu prețuri de 10 caractere;
  - setările și cardurile din Azi.
- [x] Review: runda 181 (3 probleme), 182 (2), 183 (zero); vezi mai jos.
- [x] Teste: 89 de fișiere, 791 de teste, toate trec.
- [x] Deploy: 21 oct 2026, 18:59 (ora României; deployment fcacd546), cerut de utilizator; aplicația oprită pe durata build-ului (B1)

## FD-SS34LIVE — invalidarea live, X pentru invalidat, personalizarea semnalelor (21 oct 2026)
- [x] **Cauza „două LONG la rând fără TP”** (găsită de utilizator):
  - eticheta semnalului nou apare din prima bară a căutării V2;
  - cel vechi se înroșea abia la confirmare.
- [x] FD-SS34LIVE / TD-SS34LIVE
- [x] **Pine 3.4:**
  - invalidarea live, la LONG și la SHORT;
  - X pentru invalidat; eșecul are culoarea lui;
  - culorile tuturor semnalelor și „Signal Size”;
  - grupul „Cloud”;
  - opacitatea păstrată (`fade` cu `color.t`).
- [x] **Portul:** aspectul etichetelor (`'signal' | 'failed' | 'invalid'`), în aceeași ordine pe bară.
- [x] **Sentiq:**
  - setările noi;
  - X-ul și mărimile, calibrate pe TradingView;
  - norul cu culorile lui;
  - tabelul de semnale („invalidat (semnal nou în formare)”).
- [x] **Verificări pe date reale:**
  - 6408 bare (8 serii × 800): 3.3 arăta două LONG valide neîncheiate pe 16 bare, 3.4 pe niciuna;
  - cele 192 de serii (oglinda, independența, Long = 3.3, auditul regulilor) trec.
- [x] Chrome: grupurile, câmpurile și graficul (X, Large).

## FD-OPACITY — opacitatea oricărei culori, în orice indicator (21 oct 2026)
- [x] FD-OPACITY / TD-OPACITY
- [x] `color.ts` (citire, salvare, `fade`) și `ColorPicker`. Panoul stă peste pagină, cu culoarea, codul hex și opacitatea.
- [x] **Folosit peste tot unde se alege o culoare:**
  - Slingshot și LMA;
  - indicatorii standard (Intrări și Stil);
  - linia orizontală.
- [x] **Schemele** Slingshot / LMA acceptă `#RRGGBBAA`. LMA păstrează opacitatea aleasă, cu semantica Pine.
- [x] **Chrome** (1440 / 390 / 320):
  - panoul stă în ecran și nu mută nimic;
  - Esc închide doar panoul;
  - un click în afara lui îl închide;
  - se salvează `#00FFAA66` la Slingshot și `#7E57C280` la RSI.
- [x] **Umplerile indicatorilor standard** (fundalul Bollinger etc.): adăugate de FD-FILLS, la cererea utilizatorului.

## FD-SSSL — eticheta STOP LOSS; FD-SSLIVEBOX — TP/SL ale semnalului în formare; FD-FILLS — umplerile în tab-ul Stil (21 oct 2026)
- [x] FD / TD pentru toate trei.
- [x] **Pine 3.4:**
  - eticheta STOP LOSS pe bara eșecului (Long / Short Stop Loss Color, Signal Size);
  - afișarea TP/SL ia întâi semnalul în formare.
- [x] **Portul și graficul:** marcajele `stopLoss` / `shortStopLoss`; ordinea nouă a afișării.
- [x] **Umplerile:**
  - cheile stabile (id / titlu / perechea de linii);
  - lista din tab-ul Stil, cu transparența de acum;
  - ascunderea și recolorarea (fără `transp`);
  - schema și memoria.
- [x] **Verificări:** cele 192 de serii trec; Chrome (STOP LOSS pe SOL 15m, Bollinger, RSI, la 1440 / 390).
- [x] Review: runda 184, zero probleme.
- [x] Teste: 89 de fișiere, 797 de teste, toate trec.
- [x] Deploy: 21 oct 2026, 18:59 (ora României; deployment fcacd546), cerut de utilizator; aplicația oprită pe durata build-ului (B1)

## FD-ORDEREDIT — modificarea ordinelor și a SL / TP, în Tranzacții și pe grafic; alinierea „KuCoin” / „isolated” (21 oct 2026)
- [x] Cercetare: cum modifică fiecare platformă un ordin și SL / TP-ul unei poziții (Bybit amend / trading-stop, OKX amend-order / amend-algos, Binance, KuCoin, Bitget, Kraken, Coinbase, eToro `PATCH`, Alpaca `PATCH`, Trading 212).
- [x] FD / TD, cu tabelul platformelor, ordinea înlocuirii și edge cases.
- [x] **Server:**
  - schema schimbărilor, verificarea și planul (`/modify/preview`), trimiterea o singură dată (`/modify`, jurnalul „Modificare”);
  - citirile noi: TP / SL OKX (algo) și Bitget (`profit_loss`), TP / SL atașate ordinelor;
  - înlocuirea păstrează direcția declanșării și marja; un SL / TP de poziție: întâi cel nou, apoi anularea celui vechi.
- [x] **Tranzacții:** „SL / TP” pe poziții (și dețineri), „Modifică” pe ordine; impactul pe PnL în formular și în confirmare.
- [x] **Grafic:** SL / TP-ul pozițiilor, liniile ordinelor și TP / SL-ul lor se trag (mouse direct; pe telefon după o atingere); Confirmă / Renunță pe linia de intrare; rezultatul într-un mesaj.
- [x] **Alinierea:** „KuCoin” cu variația pe 24 h, „isolated” cu simbolul (măsurate).
- [x] **Verificări în Chrome** (KuCoin și eToro simulate) la 1440 / 390 / 320.
- [x] Review: rundele 185–189, ultima cu zero probleme.
- [x] Teste: 93 de fișiere, 853 de teste, toate trec (rularea completă a găsit garda de securitate de actualizat; reluată după reparație).
- [x] Deploy: 21 oct 2026, 18:59 (ora României; deployment fcacd546), cerut de utilizator; aplicația oprită pe durata build-ului (B1)

## FD-TRADEUI — grafica unui trade ca în TradingView; Confirmă / Renunță la dreapta; alinierea în toată aplicația (21 oct 2026)
- [x] FD / TD.
- [x] **Casetele de pe grafic:** cantitate | PnL (sau felul ordinului) | ×, la 64 px de scala prețului, în culorile TradingView. „PnL acum” trece în caseta intrării. Se trag și de casetă.
- [x] **×:** închide poziția (formularul ei), șterge un SL / TP, scoate TP / SL-ul atașat, anulează un ordin. Toate cu confirmare.
- [x] **Confirmă / Renunță:** pe linie, imediat la stânga casetei; compacte; pe un ecran îngust, deasupra casetei, fără salturi.
- [x] **Alinierea:** ×-ul mesajelor, rândurile cu butoane din Tranzacții, bifele din Liste, iconițele și radio-urile lângă text (centrate pe primul rând, la orice font), titlurile ferestrelor, alertele de pe grafic la 320 px.
- [x] **Verificarea automată a alinierii** în Chrome, pe toate paginile și în ferestrele principale, la 1440 / 390 / 320: zero diferențe peste 1,5 px. Casetele, măsurate pe pixeli la 2×.
- [x] **Confirmă / Renunță ca în TradingView:** două casete de 20 px pe linia intrării, „Renunță” apoi „Confirmă” (albastru), lipite de caseta poziției. O modificare neconfirmată apare colorată și estompată, cu linia punctată.
- [x] Review: rundele 190–193, ultima cu zero probleme.
- [x] Teste: 94 de fișiere, 859 de teste, toate trec.
- [x] Deploy: 21 oct 2026, 18:59 (ora României; deployment fcacd546), cerut de utilizator; aplicația oprită pe durata build-ului (B1)

## FD-REVERSE — întoarcerea poziției (⇅), zona dintre intrare și SL / TP, etichetele de preț la aceeași mărime (21 oct 2026)
- [x] FD / TD.
- [x] **Întoarcerea poziției** (futures crypto, one-way și hedge): închidere reduce-only, deschiderea poziției opuse cu același levier și marjă, anularea SL / TP-urilor vechi. Verificare, confirmare, o singură trimitere, jurnal („Întoarcere poziție”). ⇅ pe grafic (la stânga casetei de intrare, ca în TradingView) și „Întoarce” în Tranzacții.
- [x] **Zona colorată** între intrare și SL / TP-ul tras (verde / portocaliu), sub lumânări, cât ții linia.
- [x] **Etichetele de pe scala prețului:** prețul curent are geometria celorlalte (aceeași lățime, colțuri, distanță de margine). Măsurat la 2×.
- [x] **Verificări în Chrome:** 1440 / 390 / 320; întoarcerea trimisă pe KuCoin simulat (hedge); verificarea de aliniere: zero.
- [x] Review: rundele 194–196, ultima cu zero probleme.
- [x] Teste: 94 de fișiere, 866 de teste, toate trec.
- [x] Deploy: 21 oct 2026, 18:59 (ora României; deployment fcacd546), cerut de utilizator; aplicația oprită pe durata build-ului (B1)

## FD-CHARTSETTINGS — meniul graficului (click dreapta) și setările graficului, ca în TradingView (21 oct 2026)
- [x] FD / TD; ghidul utilizatorului.
- [x] **Meniul de click dreapta:** „Resetează vizualizarea” (și ⌥R / Alt+R), „Șterge N desene”, „Șterge N indicatori” (cu „Anulează” în mesaj), „Setări…”. Tastatura, întors la margini, doar pe mouse (pe atingere, ⚙).
- [x] **Fereastra „Setări”** (din meniu sau ⚙ sub scala prețului): tab-urile Simbol, Linia de stare, Canvas, Alerte, cu opțiunile din capturi. Previzualizare pe loc; OK salvează pe cont, Renunță / × / Esc / click în afară pun la loc; „Valorile implicite” pe tab.
- [x] **Linia de stare** (logo, titlu cu interval și sursă, starea pieței, D / Max / Min / Î, variația lumânării, volumul, variația față de ziua precedentă); legendele indicatorilor după setări (titluri, parametri, valori, fundal cu opacitate).
- [x] **Canvas:** fundal plin / degrade (casetele tranzacțiilor, butoanele și banda A / L îl urmează), grila, separatoarele, cursorul, filigranul, textul și liniile scalelor (etichetele rămân la aceeași lățime), butoanele, marginile.
- [x] **Simbol:** culorile lumânărilor, colorarea după închiderea anterioară, precizia (doar afișarea), fusul orar al graficului.
- [x] **Selectorul de culoare ca în TradingView** peste tot (paletă, culorile proprii, opacitate, tipul liniei).
- [x] Ecran complet: Esc închide întâi fereastra deschisă; panourile plutitoare se văd și în ecran complet nativ.
- [x] **Verificări în Chrome:** 1440 / 390 / 320; tema luminoasă; etichetele de preț la 2× (14 px); verificarea de aliniere: zero în pagină, în cele patru tab-uri și în meniu.
- [x] Review: rundele 197–200, ultima cu zero probleme.
- [x] Teste: 96 de fișiere, 879 de teste, toate trec.
- [ ] Mai târziu (cerut): restul meniului (copiază / lipește prețul, alerte, ordine, cumpărare / vânzare).
- [x] Deploy: 21 oct 2026, 18:59 (ora României; deployment fcacd546), cerut de utilizator; aplicația oprită pe durata build-ului (B1)

## FD-BARCOLORBODY — un indicator colorează doar corpul lumânării (21 oct 2026)
- [x] FD / TD; ghidul utilizatorului.
- [x] **LMA („Color Price Bars”)** și orice `barcolor`: corpul ia culoarea indicatorului; marginea și fitilul rămân în culorile din Setări → Simbol, după direcție (deschiderea sau închiderea anterioară). Cu „Corp” debifat, corpul rămâne gol.
- [x] `barcolor` generic: doar interiorul corpului, cu geometria bibliotecii, peste fundalul graficului.
- [x] Verificat în Chrome la 2× (margini și fitiluri în culori distincte).
- [x] Review: rundele 201–202, ultima cu zero probleme.
- [x] Teste: 97 de fișiere, 883 de teste, toate trec.
- [x] Deploy: 21 oct 2026, 18:59 (ora României; deployment fcacd546), cerut de utilizator; aplicația oprită pe durata build-ului (B1)

## FD-STYLEUNIFY — Slingshot: culoare, opacitate și mărime pentru fiecare stare; o singură casetă de linie în toți indicatorii (21 oct 2026)
- [x] FD / TD; ghidul utilizatorului; `slingshot-port.md`.
- [x] **Slingshot, pe fiecare parte (LONG / SHORT):** Forming, Signal, Failed, Invalidated, Take Profit, Stop Loss, fiecare cu culoarea (și opacitatea) și mărimea ei. Nivelurile ATR (linia: culoare, grosime, stil; mărimea etichetei) pe parte și nivel. EMA-urile au grosimea și stilul. Market Structure are fiecare linie cu stilul ei. Setările vechi își păstrează aspectul.
- [x] **Fișierul Pine 3.4:** aceleași intrări (rânduri inline: culoare + mărime / grosime / stil).
- [x] **LMA:** pragurile cu culoare (implicit a scriptului), grosime și stil; linia de semnal cu grosime și stil.
- [x] **O singură casetă de linie peste tot** (Slingshot, LMA, indicatorii standard, linia orizontală, cursorul din setările graficului): culoarea, opacitatea, grosimea 1–4 px (o grosime veche mai mare rămâne afișată) și stilul liniei. Aceeași listă de mărimi (Tiny…Huge) și aceleași mărimi de text.
- [x] **Verificări în Chrome:** 1440 / 390 / 320; verificarea de aliniere: zero pe 66 de ecrane.
- [x] Review: rundele 203–204, ultima cu zero probleme.
- [x] Teste: 98 de fișiere, 889 de teste, toate trec.
- [x] Deploy: 21 oct 2026, 18:59 (ora României; deployment fcacd546), cerut de utilizator; aplicația oprită pe durata build-ului (B1)

## FD-TRADESOUND — sunetul de monede la închiderea unui trade (21 oct 2026)
- [x] FD / TD; ghidul utilizatorului.
- [x] **Sunetul `coin-money.mp3`, o dată,** când un trade se termină (SL, TP, închis de mână, ⇅, lichidat), în oricare cont, cât timp graficul e deschis și se vede. Portofoliile se citesc la 20 s (serverul nu întreabă bursa mai des).
- [x] Nimic la deschidere, nimic pentru ce s-a închis cu fila ascunsă; închiderile parțiale nu cântă; o eroare a bursei nu e luată drept închidere. Pe iPhone / iPad, gata după prima atingere.
- [x] Setarea: Setările graficului → Alerte → „Sunet la închiderea unui trade” (implicit pornit).
- [x] Verificat în Chrome pe KuCoin-ul simulat: un sunet după 16 s, niciunul repetat sau cu fila ascunsă.

## FD-MACRORULES — categoria Macro după regulile utilizatorului (21 oct 2026)
- [x] FD / TD; ghidul utilizatorului.
- [x] **Macro doar pentru știrile despre economie la nivel de țară sau de sistem financiar:** politica monetară, inflația, creșterea, piața muncii, fiscalul, comerțul și valutele, temele dominante. Fără companii individuale.
- [x] **Celelalte trec la subiectul lor** (Acțiuni, Crypto, Geopolitică) sau la noua categorie „Altele”, fără scor; filtrul „Altele” e pe pagina de știri.
- [x] Știrile salvate se reclasifică o dată la prima pornire a versiunii instalate, iar istoricul scorurilor se recalculează (`INDEX_VERSION` 3).
- [x] Verificat pe știrile reale (3 976, doar citire): 410 Macro, 2 203 Acțiuni, 62 Geopolitică, 38 Crypto, 558 Altele.
- [x] Review: rundele 205–206, ultima cu zero probleme.
- [x] Teste: 101 fișiere, 903 teste, toate trec.
- [x] Deploy: 21 oct 2026, 18:59 (ora României; deployment fcacd546), cerut de utilizator; aplicația oprită pe durata build-ului (B1)

## Deploy 21 oct 2026 (deployment fcacd546)
- [x] Cerut de utilizator. Conține toate funcțiile de după deploy-ul 37de46c0: FD-SLINGSHOT34 … FD-MACRORULES (reparațiile din 21 oct, editarea ordinelor, grafica trade-urilor ca în TradingView, întoarcerea poziției, setările graficului, colorarea doar a corpului, culorile pe stări și caseta de linie, sunetul, regulile macro).
- [x] Procedura din `deploy-azure.md` (plan B1): aplicația oprită la 15:45:36 UTC, build 15:45:53–15:50:40 (neîntrerupt), pornită la 15:55:59, `/api/ping` 200 de la 15:57:26. Pachetul web servit e cel construit local (`index-DD_H6qph.js`).
- [x] Jurnalul Sentiq de pe Azure: „Sentiq running” la 15:57:10; „stored news classified again with the macro rules” la 15:59:23; „daily history recomputed” la 15:59:31.
- [x] În bază (ultimele 3 zile): Macro 433, Acțiuni 3 846, Crypto 605, Geopolitică 224, Altele 554 (niciuna în scor); `sentiment.daily` = `{indexVersion: 3, classifyVersion: 2}`.

## FD-BOT — boți de tranzacționare în Grafice: Grid, DCA și Slingshot Premium (21 oct 2026)
- [x] Cercetarea boților (research §14); FD / TD; ghidul utilizatorului.
- [x] **Butonul „Bot”** lângă „Tranzacționează” (nu pe indici). Fereastra cu lista boților, alegerea tipului, formularul cu rezumatul serverului, pagina unui bot (poziții, grilă / ciclu, tranzacții, jurnal), Pauză / Reia / Oprește / Editează / Duplică / Șterge.
- [x] **Clasic:**
  - **Grid:** aritmetic / geometric; Long / Short / Neutru pe futures; preț de pornire; oprește sub / peste.
  - **DCA:** ordinele de siguranță cu multiplicatori; TP din prețul mediu; SL din prețul de bază; cicluri, pauză.
- [x] **Premium:** semnalele Slingshot ca declanșator, filtrate de scorul Sentiq (scorul zilei, aria, 7 zile, știrile simbolului, R:R + structura).
  - Opțiuni: aria împotrivă, evenimentele cu impact mare, AI-ul utilizatorului care poate doar opri o intrare.
  - Mărimea fixă sau pe risc, cu levierul cel mai mic care încape și SL-ul înaintea lichidării.
  - Ieșirile: SL / TP ale semnalului sau R:R, semnalul de TP, întoarcerea trendului, semnalul opus.
- [x] **Limitele utilizatorului:** direcția, suma maximă, levierul maxim, perioada și ce face la sfârșit, pierderea pe zi, pierderea la care se oprește, comisionul.
- [x] **Simulare (implicit) sau real:**
  - Realul merge doar pe exchange-uri crypto, cu ordine la piață prin serviciul de tranzacționare (aceeași cheie anti-dublură, același jurnal).
  - Cheia se salvează înaintea trimiterii; un ordin rămas „în trimitere” pleacă din nou exact la fel.
  - Pozițiile închise din afara botului sunt reconciliate.
  - O Problemă oprește orice ordin până la „Reia”.
  - Acțiunile rulează doar în simulare.
- [x] **Pe server:** job-ul `bots` la 30 s; migrarea 10 (`bots`, `bot_trades`, `bot_events`); consumul AI are rândul „Boți”.
- [x] **Verificări în Chrome** (serverul de audit, KuCoin simulat), la 1440 / 390 / 320:
  - alegerea, cele trei formulare, editarea, realul, pagina unui bot, oprirea;
  - nimic mai lat decât ecranul, nicio suprapunere, câmpurile unui rând la aceeași înălțime;
  - verificarea de aliniere: zero.
- [x] Review: rundele 207–209, ultima cu zero probleme.
- [x] Teste: 105 fișiere, 951 de teste, toate trec.
- [x] Local, pe baza reală: `dist/` refăcut, serverul local repornit (migrarea 10 aplicată). Local job-urile sunt oprite, deci boții nu rulează aici: rulează pe instanța care ține job-urile, după deploy.
- [x] Deploy: 21 oct 2026, 21:05 (ora României; deployment 76ddc2cc), cerut de utilizator; aplicația oprită pe durata build-ului (B1)

## Deploy 21 oct 2026, seara (deployment 76ddc2cc)
- [x] Cerut de utilizator. Conține FD-BOT (boții de tranzacționare) și migrarea 10.
- [x] Procedura din `deploy-azure.md` (plan B1): aplicația oprită la 18:01:25 UTC, build 18:01:45–18:04:51 (neîntrerupt), pornită la 18:05:09, `/api/ping` 200 de la 18:06:28. Pachetul web servit e cel construit local (`index-525FLQ4w.js`).
- [x] Jurnalul Sentiq de pe Azure: „this instance runs the background jobs” și „Sentiq running” la 18:06:22.
- [x] Job-ul `bots`: prima rulare la 18:06:51, terminată fără eroare. `/api/bots` răspunde (cere login); schema bazei e 10.

## FD-BOTSTOCKS — boții reali pe acțiuni (21 oct 2026)
- [x] Cerut de utilizator după deploy: motivul „acțiunile doar în simulare” nu ținea, aplicația știe deja cum închide fiecare broker. FD-BOT §10, TD-BOTSTOCKS; ghidul utilizatorului.
- [x] **Real pe acțiuni la Trading 212, eToro și Alpaca:** ordine la piață, pe cantitate, prin serviciul de tranzacționare; doar în sesiunea bursei; fără levier.
- [x] **Trading 212 și Alpaca:** botul vinde doar cantitatea lui (cel mult cât e liber); acțiunile utilizatorului rămân. Doar long.
- [x] **eToro:**
  - botul își notează pozițiile (id-urile apărute după ordinul lui, și când eToro le arată mai târziu) și le închide doar pe ele;
  - short, cu stop loss-ul cerut de eToro: tranzacția Premium, SL-ul ciclului DCA, „Oprește peste” la grilă; formularul spune ce lipsește;
  - grila pe ordine separate pe laturi;
  - reconcilierea după id.
- [x] Formularul: „Real” cu conturile de acțiuni; Short / Ambele / Neutru doar unde se poate.
- [x] **Verificat în Chrome** (eToro simulat), la 1440 / 390 / 320: nimic mai lat decât ecranul, rândurile la aceeași înălțime, nicio eroare în consolă.
- [x] Review: rundele 210–211, ultima cu zero probleme.
- [x] Teste: 105 fișiere, 955 de teste, toate trec.
- [x] Local, pe baza reală: `dist/` refăcut, serverul local repornit (fără migrare nouă).
- [x] Deploy: 21 oct 2026, 22:15 (ora României; deployment 9914a406), cerut de utilizator; aplicația oprită pe durata build-ului (B1)

## Deploy 21 oct 2026, noaptea (deployment 9914a406)
- [x] Cerut de utilizator. Conține FD-BOTSTOCKS (boții reali pe acțiuni).
- [x] Procedura din `deploy-azure.md` (plan B1): aplicația oprită la 19:10:07 UTC, build 19:10:33–19:15:11 (neîntrerupt), pornită la 19:15:32, `/api/ping` 200 de la 19:16:52. Pachetul web servit e cel construit local (`index-CzmeDghQ.js`).
- [x] Jurnalul Sentiq de pe Azure: „this instance runs the background jobs” și „Sentiq running” la 19:16:44.
- [x] Job-ul `bots` pe codul nou: rulat 19:17:16–19:17:37, fără eroare. Botul utilizatorului (Premium, real, futures) rulează, fără nicio problemă în jurnal.

## FIX-SLTPDUP — SL / TP mutat: o singură linie, la nivelul nou (21 oct 2026)
- [x] Raportat de utilizator: după mutarea SL / TP și confirmare, o linie apărea dublată sau rămânea cea veche. Cauza: KuCoin (plasat-apoi-anulat) listează ordinele cu câteva secunde întârziere, iar Sentiq ținea lista citită imediat 20 s, iar graficul o recitea abia după un minut. FD / TD.
- [x] **Graficul:** linia mutată stă la nivelul nou imediat după confirmare, până o listează bursa (cel mult un minut); ordinul vechi nu se mai vede.
- [x] **Serverul:**
  - un ordin anulat sau înlocuit dispare imediat, chiar dacă bursa îl mai listează;
  - după orice acțiune de tranzacționare, portofoliul se citește la 3 s, timp de 30 s (pe grafic și în Tranzacții);
  - o citire pornită înainte de acțiune nu mai e păstrată după ea.
- [x] Verificat în Chrome pe un KuCoin simulat cu 8 s întârziere: o singură linie, la nivelul nou, de la prima secundă.
- [x] Review: rundele 212–213, ultima cu zero probleme.
- [x] Teste: 105 fișiere, 960 de teste, toate trec.
- [x] Local, pe baza reală: `dist/` refăcut, serverul local repornit.
- [x] Deploy: 21 oct 2026, 22:50 (ora României; deployment 68c10bf1), cerut de utilizator; aplicația oprită pe durata build-ului (B1)

## Deploy 21 oct 2026, 22:50 (deployment 68c10bf1)
- [x] Cerut de utilizator. Conține FIX-SLTPDUP.
- [x] Procedura din `deploy-azure.md` (plan B1): aplicația oprită la 19:45:48 UTC, build 19:46:09–19:50:17 (neîntrerupt), pornită la 19:50:37, `/api/ping` 200 de la 19:51:57. Pachetul web servit e cel construit local (`index-BOmcf2Bo.js`).
- [x] Jurnalul Sentiq de pe Azure: „this instance runs the background jobs” și „Sentiq running” la 19:51:49.
- [x] Job-ul `bots`: rulat 19:52:18–19:52:38, fără eroare. Botul utilizatorului (Premium, real, futures) rulează, fără probleme în jurnalul lui.

## FIX-COINSOUND — sunetul de monede nu mai sună la deschiderea aplicației (21 oct 2026)
- [x] Raportat de utilizator. Cauza: după o pauză fără ca pagina să devină ascunsă (laptop în sleep, aplicație în fundal), prima citire era comparată cu una de acum câteva ore, iar un trade închis între timp suna la deschidere. FD / TD.
- [x] Se compară doar citiri la cel mult 50 s una de alta; pregătirea sunetului la prima atingere e complet fără sunet (mut și volum 0).
- [x] Verificat pe datele reale (citiri consecutive fără alarme false) și în Chrome (pagina înghețată 70 s: fără sunet; un trade închis cât e urmărită: un sunet).
- [x] Review: runda 214, zero probleme.
- [x] Teste: 105 fișiere, 961 de teste, toate trec.
- [x] Local, pe baza reală: `dist/` refăcut, serverul local repornit.
- [x] Deploy: 22 oct 2026, 00:23 (ora României; deployment ec00bf61), cerut de utilizator.
- [ ] **Nerezolvat:** utilizatorul raportează că sunetul se aude în continuare la orice tab nou cu graficul, local și pe server, cu și fără trade-ul SOL. Investigația continuă ca FIX-COINSOUND2. Până acum:
  - în Chrome nu se reproduce: zero redări cu sunet; pregătirea la primul click rămâne la 0,000 s;
  - 7 minute de citiri reale: nicio închidere falsă;
  - utilizatorul folosește Safari (macOS și iPhone), deci urmează verificarea în WebKit.
- [x] Rezolvat de FIX-COINSOUND2 (mai jos). Regula de 50 s rămâne.

## FD-COLORUNIFY — o culoare, o casetă, un efect, la toți indicatorii standard (21 oct 2026)
- [x] Cerut de utilizator (MA Ribbon: culori și în Intrări, și în Stil, cu efecte diferite). FD / TD.
- [x] Verificat automat pe toți cei 118 indicatori. Ce s-a corectat:
  - **MA Ribbon:** culoarea din Intrări și caseta liniei din Stil sunt aceeași valoare, cu aceeași casetă în ambele taburi (culoare, opacitate, grosime, tip), legate;
  - **11 indicatori cu linii în mai multe culori** (MACD, Price / Volume Oscillator, AO, Bull Bear Power, Woodies CCI, Aroon Oscillator, Volatility Stop, Relative Volume at Time, BBTrend, Chop Zone): câte o casetă pentru fiecare culoare, fiecare aplicată (înainte, caseta unică nu schimba nimic);
  - **Technical Ratings:** caseta coloanelor spune că acele culori se aleg în Intrări (Table Settings);
  - **TSI, Technical Ratings:** liniile orizontale urmează culoarea din Intrări, ca în Pine, până alegi alta în Stil.
- [x] **Setările salvate înainte:** aspectul se păstrează (culoarea aleasă înainte în Stil la MA Ribbon devine culoarea liniei, dacă ea era cea desenată).
- [x] Un test pe toți indicatorii: orice culoare desenată de o linie din Stil are caseta ei, iar legăturile cu Intrările sunt exact cele din tabel.
- [x] Verificat în Chrome (1440 / 390 / 320) pe serverul de audit: MA Ribbon, MACD, Technical Ratings, TSI; nimic mai lat decât ecranul.
- [x] Review: rundele 215–216, ultima cu zero probleme.
- [x] Teste: 106 fișiere, 970 de teste, toate trec.
- [x] Local, pe baza reală: `dist/` refăcut (`index-Dt1BOmTS.js`), serverul local repornit.
- [x] Deploy: 22 oct 2026, 00:23 (ora României; deployment ec00bf61), cerut de utilizator.

## FIX-COINSOUND2 — sunetul de la deschiderea în Safari; doar trade-urile graficului de pe ecran (22 oct 2026)
- [x] **Raportat de utilizator:** sunetul la orice tab nou cu graficul. **Cerut:** sunet doar pentru trade-urile simbolului din grafic. FD / TD.
- [x] **Cauza, confirmată în WebKit (motorul Safari):** pregătirea sunetului la primul click îl oprea și îi dădea drumul la volum. Safari nu oprește însă clipul, care se auzea până la capăt.
- [x] **Reparat:**
  - pregătirea rămâne pe mut; doar sunetul unui trade încheiat pornește volumul;
  - se urmăresc doar trade-urile simbolului din grafic (pozițiile pe perechile monedei și deținerea ei; la acțiuni, ale tickerului), în conturile de felul graficului;
  - alt simbol pe același tab pornește urmărirea de la zero.
- [x] **Verificat fără sunet pe difuzoare:**
  - WebKit: pregătirea pe mut până la capăt; un trade BTC închis pe graficul BTC sună o dată;
  - Chrome: primul click e silențios; un trade BTC închis cât graficul arată ETH nu sună.
  - Notă: primele teste WebKit din investigație au redat sunetul pe difuzoarele utilizatorului (o dată, apoi de două ori). De atunci, testele nu mai pot scoate sunet.
- [x] Review: rundele 217–218, ultima cu zero probleme.
- [x] Teste: 106 fișiere, 973 de teste, toate trec.
- [x] Local, pe baza reală: `dist/` refăcut (`index-DxdT_tiY.js`), serverul local repornit; sesiunea temporară de test ștearsă.
- [x] Deploy: 22 oct 2026, 00:23 (ora României; deployment ec00bf61), cerut de utilizator.

## Deploy 22 oct 2026, 00:23 (deployment ec00bf61)
- [x] Cerut de utilizator. Conține FIX-COINSOUND, FD-COLORUNIFY și FIX-COINSOUND2.
- [x] Procedura din `deploy-azure.md` (plan B1):
  - aplicația oprită la 21:18:19 UTC;
  - build terminat la 21:23:33 (neîntrerupt);
  - pornită la 21:23:39; `/api/ping` 200 de la 21:25:05.
  - Pachetul web servit e cel construit local (`index-DxdT_tiY.js`).
- [x] Jurnalul Sentiq de pe Azure: „this instance runs the background jobs” și „Sentiq running” la 21:24:56.
- [x] Job-ul `bots`: rulat 21:25:24–21:25:31, fără eroare.

## FIX-PANES — un indicator nou în panourile de jos nu mai strică scalele lor (22 oct 2026)
- [x] **Raportat de utilizator:** după al doilea indicator în panourile de jos (Stoch RSI sub LMA), scalele și desenele se stricau. FD / TD.
- [x] **Cauza:** cu prețul pe scară logaritmică, biblioteca graficului dădea logaritmul (și autoscala oprită, marginile) panourilor create la adăugarea unui indicator; la reîncărcare era corect.
- [x] **Reparat:** fiecare panou de jos pornește cu scala lui normală, ca la deschiderea paginii. Prețul își păstrează scala.
- [x] Verificat în Chrome (1440 / 390 / 320) și în WebKit, cu preț logaritmic și cu autoscala prețului oprită: adăugare, a doua adăugare, scoatere.
- [x] Review: rundele 219–220, ultima cu zero probleme.
- [x] Teste: 106 fișiere, 973 de teste, toate trec.
- [x] Local, pe baza reală: `dist/` refăcut (`index-Fv08sp52.js`), serverul local repornit.
- [x] Deploy: 22 oct 2026, 01:06 (ora României; deployment e95aa120), cerut de utilizator.

## Deploy 22 oct 2026, 01:06 (deployment e95aa120)
- [x] Cerut de utilizator. Conține FIX-PANES.
- [x] Procedura din `deploy-azure.md` (plan B1):
  - aplicația oprită la 22:01:47 UTC;
  - build terminat la 22:06:23 (neîntrerupt);
  - pornită la 22:06:30; `/api/ping` 200 de la 22:08:11.
  - Pachetul web servit e cel construit local (`index-Fv08sp52.js`).
- [x] Jurnalul Sentiq de pe Azure: „this instance runs the background jobs” și „Sentiq running” la 22:08:05.
- [x] Job-ul `bots`: rulat 22:08:34–22:08:39, fără eroare.

## FD-BOTTF — timeframe-ul semnalelor se schimbă și la un bot Slingshot pornit (22 oct 2026)
- [x] **Cerut de utilizator:** la Editează, timeframe-ul unui bot nu se putea schimba. Cercetare, FD / TD.
- [x] **La Editează, pe un bot Slingshot Premium:** câmpul „Timeframe-ul semnalelor”. La Grid și DCA nu apare (nu folosesc lumânări), iar serverul refuză o schimbare pentru ele. Pe acțiuni fără cheie Twelve Data, sub 1d e refuzat.
- [x] **Motorul preia schimbarea la următoarea verificare:**
  - ca la pornire, lumânarea deja închisă e doar notată, iar semnalele vin de pe cele care se închid după ea;
  - pozițiile deschise își păstrează SL / TP-ul; semnalul lor de pe timeframe-ul vechi nu se mai urmărește;
  - jurnalul o spune.
- [x] Teste noi (5): pică pe codul fără reparație (4 din 5; al cincilea verifică doar API-ul).
- [x] Verificat în Chrome (1440 / 390 / 320) și în WebKit (390), pe un server de test: câmpul, salvarea 1h → 4h → 1h, nota din jurnal după o verificare a motorului.
- [x] Review: rundele 221–223, ultima cu zero probleme.
- [x] Teste: 106 fișiere, 978 de teste, toate trec.
- [x] Local, pe baza reală: `dist/` refăcut (`index-UR38N08O.js`), serverul local repornit.
- [x] Deploy: 22 oct 2026, 09:40 (ora României; deployment eb5a4f5b), cerut de utilizator.

## Deploy 22 oct 2026, 09:40 (deployment eb5a4f5b)
- [x] Cerut de utilizator. Conține FD-BOTTF.
- [x] Procedura din `deploy-azure.md` (plan B1):
  - aplicația oprită la 06:33:41 UTC;
  - build terminat la 06:38:32 (neîntrerupt);
  - pornită la 06:38:45; `/api/ping` 200 de la 06:40:14.
  - Pachetul web servit e cel construit local (`index-UR38N08O.js`).
- [x] Jurnalul Sentiq de pe Azure: „this instance runs the background jobs” și „Sentiq running” la 06:40:05–06:40:06.
- [x] Job-ul `bots`: rulat 06:40:33–06:40:40, fără eroare.

## FD-BOTSLRR — cu „Slingshot”, botul intră cu SL-ul și TP-ul semnalului, fără niciun R:R; FIX-INFOTIP (22 oct 2026)
- [x] **Cerut de utilizator, după analiza botului SOL/USDT:**
  - singurele două semnale de la pornire au fost refuzate: unul de o poziție manuală pe SOL, celălalt de „R:R minim” (0,91 < 1, calculat din prețul de la confirmare);
  - Slingshot își dă singur SL-ul și TP-ul, deci nu se combină cu niciun R:R;
  - în formular, explicația că variantele se exclud;
  - raportul scris ca 1:2, nu ca număr.
- [x] **„Stop loss și take profit”: „Slingshot” sau „Risc / câștig”**, cu explicația pe toată lățimea.
  - „R:R minim la intrare” nu mai există.
  - Scorul (partea Slingshot = doar structura) și AI-ul nu mai văd niciun R:R.
  - Prețul trecut de SL / TP refuză tot, pentru că ordinul nu s-ar putea pune.
- [x] **„Risc / câștig”:** raportul în două câmpuri, riscul întâi (implicit 1 : 2), păstrat cum e scris; limitele 2:1–1:10.
  - Setările vechi se citesc: R → 1:R, „R:R minim” ignorat. Botul SOL e verificat pe baza reală: SL / TP Slingshot, 1:2, fără R:R minim.
- [x] **FIX-INFOTIP:** iconița (i) din setările tuturor indicatorilor (cei standard, Slingshot, LMA) arată explicația:
  - la hover;
  - la click sau tap (rămâne deschisă), din tastatură;
  - Esc închide întâi bula.
  - Nu mai era doar `title`-ul browserului, care la click nu arăta nimic și pe iPhone nu exista.
- [x] **Verificat în Chrome (1440 / 390 / 320) și în WebKit (mouse la 1440, tap la 390):**
  - formularul fără depășiri, cu rândurile la același nivel;
  - bula în ecran, căsuța de lângă (i) neatinsă;
  - iconița centrată pe text la 0,9 px.
- [x] Review: rundele 224–228, ultima cu zero probleme.
- [x] Teste: 106 fișiere, 984 de teste, toate trec.
- [x] Local, pe baza reală: `dist/` refăcut (`index-CkihU4xZ.js`), serverul local repornit.
- [x] Deploy: 22 oct 2026, 13:38 (ora României; deployment 0d6d0258), cerut de utilizator.

## Deploy 22 oct 2026, 13:38 (deployment 0d6d0258)
- [x] Cerut de utilizator („După ce termin, faci deploy”). Conține FD-BOTSLRR și FIX-INFOTIP.
- [x] Procedura din `deploy-azure.md` (plan B1):
  - aplicația oprită la 10:26:31 UTC;
  - build terminat la 10:30:34 (neîntrerupt);
  - pornită la 10:36:50; `/api/ping` 200 de la 10:38:31.
  - Pachetul web servit e cel construit local (`index-CkihU4xZ.js`).
- [x] Jurnalul Sentiq de pe Azure: „this instance runs the background jobs” și „Sentiq running” la 10:38:17–10:38:18.
- [x] Job-ul `bots`: rulat 10:39:19–10:39:23, fără eroare. Botul SOL/USDT a fost verificat la 10:39:21, „running”, fără problemă.

## FD-BOTPCT — „Risc / câștig” = SL % și TP % de la intrare, raportul calculat (22 oct 2026)
- [x] **Cerut de utilizator:** la „Risc / câștig” vrea să stabilească singur până unde merge SL-ul și până unde merge TP-ul. Dintre cele trei variante propuse, a ales „SL % și TP % direct”.
- [x] **„Risc / câștig” are două câmpuri,** „Stop loss (% de la intrare)” și „Take profit (% de la intrare)” (implicit 1% și 2%).
  - Sub ele, raportul calculat: „Raportul risc : câștig: 1:2”.
  - Nimic de la Slingshot în modul ăsta: varianta „SL: Slingshot” și raportul scris în două câmpuri (FD-BOTSLRR) dispar.
  - Limitele raportului: de la 2:1 la 1:10.
- [x] **Setările vechi se citesc cu aceleași niveluri.** Botul SOL rămâne pe Slingshot (procentele ascunse: 2% și 4%), verificat pe baza reală.
- [x] **Verificat în Chrome (1440 / 390 / 320) și în WebKit (390 cu tap, 1440):** fără depășiri, raportul urmează procentele scrise.
- [x] Review: rundele 229–230, ultima cu zero probleme.
- [x] Teste: 106 fișiere, 984 de teste, toate trec.
- [x] Local, pe baza reală: `dist/` refăcut (`index-DmBPk_3s.js`), serverul local repornit.
- [x] Deploy: 22 oct 2026, 14:20 (ora României; deployment ee6a0d74), cerut de utilizator.

## Deploy 22 oct 2026, 14:20 (deployment ee6a0d74)
- [x] Cerut de utilizator („fa deploy”). Conține FD-BOTPCT.
- [x] Procedura din `deploy-azure.md` (plan B1):
  - aplicația oprită la 11:15:02 UTC;
  - build terminat la 11:18:56 (neîntrerupt);
  - pornită la 11:19:07; `/api/ping` 200 de la 11:20:47.
  - Pachetul web servit e cel construit local (`index-DmBPk_3s.js`).
- [x] Jurnalul Sentiq de pe Azure: „this instance runs the background jobs” și „Sentiq running” la 11:20:31–11:20:32.
- [x] Job-ul `bots`: rulat 11:21:01–11:21:23, fără eroare. Botul SOL/USDT a fost verificat la 11:21:02, „running”, fără problemă.

## FIX-BROTLI — conținutul extern se descarcă fără decompresie Brotli (22 oct 2026)
- [x] **Cerut de utilizator, după avizul Node.js din 21 oct 2026** (CVE-2026-111497, Brotli, rulare de cod de la distanță).
  - Azure rulează Node 24.20.0 (imaginea Microsoft „24-lts” din 4 sept.); reparat e 24.22.1, pe care îl aplică Microsoft când vrea.
  - Varianta aleasă: o protecție în cod, până atunci.
- [x] **Transport propriu (`plainFetch`, pe `node:https`) pentru știri, pagini, calendar, componența indicilor și contextul piețelor:**
  - cere doar gzip / deflate;
  - refuză Brotli / zstd înainte de orice decodare.
  - API-urile serviciilor cunoscute (brokeri, ordine, burse, AI, e-mail, date de piață) rămân pe `fetch`.
- [x] Teste noi (5) pe un server local. 48 de surse reale: aceleași răspunsuri ca prin `fetch`.
- [x] Review: rundele 231–232, ultima cu zero probleme.
- [x] Teste: 107 fișiere, 989 de teste, toate trec.
- [x] Local, pe baza reală: `dist/` refăcut (`index-DmBPk_3s.js`, interfața neschimbată), serverul local repornit.
- [x] Deploy: 22 oct 2026, 15:34 (ora României; deployment 8aa45557), cerut de utilizator.

## Deploy 22 oct 2026, 15:34 (deployment 8aa45557)
- [x] Cerut de utilizator („ok, fă 1”). Conține FIX-BROTLI.
- [x] Procedura din `deploy-azure.md` (plan B1):
  - aplicația oprită la 12:29:02 UTC;
  - build terminat la 12:32:57 (neîntrerupt);
  - pornită la 12:33:16; `/api/ping` 200 de la 12:34:58.
  - Pachetul web servit e cel construit local (`index-DmBPk_3s.js`).
- [x] Jurnalul Sentiq de pe Azure: „this instance runs the background jobs” și „Sentiq running” la 12:34:47.
  - Azure raportează încă Node 24.20.0, deci Microsoft n-a trecut imaginea pe 24.22.1.
- [x] Job-urile `news.fetch` (12:34:47–12:35:54), `scanner` și `bots`: fără eroare.
  - 46 din cele 48 de surse active au fost descărcate după deploy, cu noul transport, fără nicio eroare.

## FD-BOTDIR — scorul pieței, cu un prag pentru long și altul pentru short (26 oct 2026)
- [x] **Cerut de utilizator:** „un scor mic favorizează short-urile, un scor mare favorizează long-urile […] trebuie să avem scoruri diferite pe direcții diferite”.
- [x] **Verificat pe baza reală, botul SOL:**
  - pe 2h, din 23 oct 21:11 UTC, Slingshot n-a confirmat niciun semnal (29 de lumânări refăcute una câte una);
  - nicio intrare refuzată pentru scor după 23 oct 16:00 UTC. Scorul de atunci era al tranzacției, deci un singur minim M însemna deja „long de la M, short până la 100 − M” pe scara pieței.
- [x] **Scorul pieței** (aceleași cinci părți, cu semnul pieței):
  - un scor mare favorizează long-urile, unul mic short-urile;
  - pragurile: „Scorul minim pentru long” și „Scorul maxim pentru short” (implicit 50 / 50).
  - Setările vechi se citesc la fel: botul SOL, cu minimul 39, devine long de la 39 și short până la 61.
- [x] **În aplicație:**
  - formularul arată pragurile direcțiilor botului și o propoziție cu zona lor;
  - jurnalul spune „Scorul pieței … (short până la 45)” și „spre long / spre short”;
  - „Verifică” spune pragurile și avertizează la un prag de neatins;
  - AI-ul primește scorul pieței cu pragul laturii.
- [x] **Verificat în Chrome (1440 / 390 / 320)**, pe o schemă de test ștearsă la sfârșit: formularul și jurnalul, fără depășiri.
- [x] Review: rundele 233–239, ultima cu zero probleme.
- [x] Teste: 107 fișiere, 994 de teste, toate trec (pe Node 26.12.1, după actualizarea Mac-ului).
- [x] Local, pe baza reală: `dist/` refăcut (`index-BeUUmOfJ.js`), serverul local repornit. Setările botului SOL se citesc: Ambele, Slingshot, long de la 39, short până la 61.
- [x] Deploy: 26 oct 2026, 11:34 (ora României; deployment 1cdb0797), cerut de utilizator.

## Deploy 26 oct 2026, 11:34 (deployment 1cdb0797)
- [x] Cerut de utilizator („Fă deploy”). Conține FD-BOTDIR.
- [x] Înainte: botul SOL fără poziții și fără ordine în curs; următoarea lumânare de 2h se închidea la 10:00 UTC.
- [x] Procedura din `deploy-azure.md` (plan B1):
  - aplicația oprită la 08:29:31 UTC;
  - build terminat la 08:34:09 (neîntrerupt);
  - pornită la 08:34:25; `/api/ping` 200 de la 08:35:45.
  - Pachetul web servit e cel construit local (`index-BeUUmOfJ.js`).
- [x] Jurnalul Sentiq de pe Azure: „this instance runs the background jobs” și „Sentiq running” la 08:35:38–08:35:39.
- [x] **Azure pornește acum cu Node 24.22.1** (imaginea Microsoft `24-lts_20261022.3`): breșele din avizul Node.js din 21 oct sunt reparate și pe server. FIX-BROTLI rămâne.
- [x] Job-ul `bots`: rulat 08:36:11–08:36:19, fără eroare.
  - Botul SOL e „running”, citit cu setările convertite: long de la 39, short până la 61.
  - Niciun eveniment nou în jurnalul lui.
- [x] Job-urile `news.fetch` (08:35:42–08:37:34), `scanner`, `calendar.*`, `sentiment.*`, `market.context`: fără eroare.
- [x] **De notat din zilele trecute:** pe 25 oct, la 00:59 UTC, Azure a repornit aplicația.
  - Prima pornire a eșuat: „Baza de date nu răspunde acum”.
  - A doua a mers la 01:00:07, deci pauza a fost de câteva minute, fără niciun semnal pierdut de bot.

## FD-NEWSWIN — „Ferește știrile (min înainte)” redenumită după ce face (26 oct 2026)
- [x] **Cerut de utilizator:** numele vechi „nu spune nimic”. Setarea se numește acum „Evită deschiderea de tranzacții în perioada știrilor economice importante”.
- [x] **Sub câmp, ce înseamnă numărul:** „Minutele dinaintea unei știri economice cu impact mare pentru dolar (și încă 15 după ea) în care botul nu deschide tranzacții. Pozițiile deschise merg normal. 0: oprit.”
- [x] **Așezarea:**
  - un rând al ei, cu câmpul cât o coloană;
  - „Pauză după o pierdere” pe rândul următor.
  - Erorile spun „Minutele dinaintea știrilor economice importante”.
- [x] **Neschimbate:** valorile salvate (botul SOL: 60) și comportamentul.
- [x] **Verificat în Chrome (1440 / 390 / 320)**, pe o schemă de test ștearsă la sfârșit.
- [x] Review: rundele 240–241, ultima cu zero probleme.
- [x] Teste: 107 fișiere, 995 de teste, toate trec.
- [x] Local, pe baza reală: `dist/` refăcut (`index-C5FVobCC.js`), serverul local repornit.
- [x] Deploy: 26 oct 2026, 12:20 (ora României; deployment 050108d3), cerut de utilizator.

## Deploy 26 oct 2026, 12:20 (deployment 050108d3)
- [x] Cerut de utilizator („ok, fa deploy”). Conține FD-NEWSWIN.
- [x] Înainte: botul SOL fără poziții și fără ordine în curs; următoarea lumânare de 2h se închidea la 10:00 UTC.
- [x] Procedura din `deploy-azure.md` (plan B1):
  - aplicația oprită la 09:16:05 UTC;
  - build terminat la 09:20:20 (neîntrerupt);
  - pornită la 09:20:34; `/api/ping` 200 de la 09:21:55.
  - Pachetul web servit e cel construit local (`index-C5FVobCC.js`).
- [x] Jurnalul Sentiq de pe Azure: „this instance runs the background jobs” și „Sentiq running” la 09:21:49–09:21:50.
- [x] Toate job-urile au rulat după pornire fără eroare, `bots` inclus (09:23:01–09:23:03). Botul SOL e „running”.

## FIX-PINESYNC — Slingshot 3.4 în TradingView: numele și prețurile ca în Sentiq (26 oct 2026)
- [x] **Cerut de utilizator:** indicatorul în TradingView, cu ultimele modificări.
- [x] **Prima verificare a fost greșită.** M-am uitat la datele fișierelor și la setări, iar utilizatorul a semnalat că nu e destul.
- [x] **Refăcută pe ce se desenează efectiv:** o captură a graficului Sentiq cu setările utilizatorului (SOL/USDT 15m, pe o schemă de test), comparată cu `label.new` / `table.cell` din Pine.
  - Etichetele sunt aceleași. La stop loss: SHORT „eșuat” plus „STOP LOSS”, cu triunghi; X doar pentru invalidat.
  - Utilizatorul a ales să rămână așa.
- [x] **În `Sling Shot System/sling-shot-system-3.4.pine`:**
  - numele „[DE] Slingshot System 3.4” / „[DE] Slingshot 3.4”;
  - prețurile din etichetele nivelurilor și din tabel cu `format.mintick` (precizia tick-ului), nu `#.##`.
- [x] Review: rundele 242–245, ultima cu zero probleme.
- [x] Teste: 107 fișiere, 995 de teste, toate trec (codul Sentiq neschimbat).
- [x] Local: `dist/` refăcut (același `index-C5FVobCC.js`), serverul local repornit.
- [ ] Fișierul Pine e necomis în repo-ul „Sling Shot System”; se adaugă de mână în TradingView.
