# Kryptoniq — Progress tracker (v1 bootstrap)

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
- [ ] De făcut de utilizator: `scripts/kryptoniq.sh restart` (codul serverului s-a schimbat)

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
- [ ] De făcut de utilizator: `scripts/kryptoniq.sh restart` (câmpul nou `stop` vine de la server; până atunci funcționează rezerva după prețul curent)
