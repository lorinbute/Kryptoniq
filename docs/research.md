# Sentiq — Research (12–13 oct 2026)

> Cercetarea făcută înaintea deciziilor (aplicația se numea atunci Kryptoniq). Ce face aplicația azi: [functional-design.md](functional-design.md), Partea I.

Toate sursele de mai jos au fost **testate live** pe 2026-10-12 (status HTTP, număr de item-uri, prospețimea ultimei știri). Ce nu a mers e notat explicit.

## 1. Surse de știri

### 1.1 Crypto (RSS, fără cheie)
| Sursă | URL feed | Rezultat test | Note |
|---|---|---|---|
| CoinDesk | `https://www.coindesk.com/arc/outboundfeeds/rss` | 200, 25 item-uri, proaspăt | titluri în CDATA, `media:content` pentru imagine |
| Cointelegraph | `https://cointelegraph.com/rss` | 200, 30 item-uri | |
| Decrypt | `https://decrypt.co/feed` | 200, 38 item-uri | |
| The Block | `https://www.theblock.co/rss.xml` | 200, 20 item-uri | CDATA |
| CryptoSlate | `https://cryptoslate.com/feed/` | 200, 10 item-uri | |
| BeInCrypto | `https://beincrypto.com/feed/` | 200, 12 item-uri | |
| U.Today | `https://u.today/rss` | 200, 97 item-uri | volum mare, multe „price prediction” |
| NewsBTC | `https://www.newsbtc.com/feed/` | 200, 10 item-uri | analiză tehnică, relevanță mai mică |
| Watcher.Guru | `https://watcher.guru/news/feed` | 200, 10 item-uri | breaking news scurte |
| ~~Bitcoin Magazine~~ | `/.rss/full/` | **blocat Cloudflare** | exclus |
| ~~Blockworks~~ | `/feed` | 200 dar 0 item-uri | exclus |
| ~~CryptoPanic RSS~~ | `/news/rss/` | **410 Gone** | API-ul v2 cere token; poate fi adăugat ulterior ca sursă opțională |

### 1.2 Piețe / macro (RSS, fără cheie)
| Sursă | URL feed | Rezultat |
|---|---|---|
| CNBC Top News | `https://www.cnbc.com/id/100003114/device/rss/rss.html` | 200, 30 |
| CNBC Economy | `https://www.cnbc.com/id/20910258/device/rss/rss.html` | 200, 30 |
| CNBC Finance | `https://www.cnbc.com/id/10000664/device/rss/rss.html` | 200, 30 |
| CNBC Investing | `https://www.cnbc.com/id/15839069/device/rss/rss.html` | 200, 29 |
| Bloomberg Markets | `https://feeds.bloomberg.com/markets/news.rss` | 200, 20 |
| Bloomberg Economics | `https://feeds.bloomberg.com/economics/news.rss` | 200, 18 |
| MarketWatch Top Stories | `https://feeds.content.dowjones.io/public/rss/mw_topstories` | 200, 10 (proaspăt) |
| FT Markets | `https://www.ft.com/markets?format=rss` | 200, 25 |
| Seeking Alpha Market Currents | `https://seekingalpha.com/market_currents.xml` | 200, 7 |
| FXStreet | `https://www.fxstreet.com/rss/news` | 200, 30 |
| InvestingLive (fost ForexLive) | `https://investinglive.com/feed/` | 200, 25 |
| Investing.com News | `https://www.investing.com/rss/news.rss` | 200, 10 — **dată non-RFC** (`2026-10-12 16:00:43`, UTC) |
| Federal Reserve press | `https://www.federalreserve.gov/feeds/press_all.xml` | 200, 20 — **BOM** la început, `pubDate` în CDATA |
| SEC press releases | `https://www.sec.gov/news/pressreleases.rss` | 200, 25 |
| ~~MarketWatch marketpulse / realtime~~ | | 200 dar **învechite (2025)** — excluse |
| ~~WSJ Markets (`feeds.a.dj.com`)~~ | | învechit (ian 2025) — exclus |
| ~~Yahoo Finance RSS~~ | | 404 — exclus |
| ~~Reuters~~ | | nu mai are RSS public |

### 1.3 Geopolitică (relevanță condiționată)
| Sursă | URL feed |
|---|---|
| BBC World | `https://feeds.bbci.co.uk/news/world/rss.xml` (200, 26) |
| CNBC International | `https://www.cnbc.com/id/100727362/device/rss/rss.html` (200, 30) |
| CNBC Politics & Policy | `https://www.cnbc.com/id/10000113/device/rss/rss.html` (200, 30) |
| BBC Business | `https://feeds.bbci.co.uk/news/business/rss.xml` (200, 44) |
| The Guardian Economics | `https://www.theguardian.com/business/economics/rss` (200, 20) |

Exemplu concret din testul de azi: CNBC — *„As the U.S.-Iran war heats up again, these parts of the stock market…”*. Geopolitica mișcă piața, dar feed-urile generale conțin și știri irelevante → se iau în calcul doar dacă conțin termeni care mișcă piața (vezi TD §6).

**Concluzii:** RSS e sursa principală (gratuit, fără cheie, stabil). Feed-urile pot muri sau îngheța → aplicația monitorizează sănătatea fiecărei surse (ultimul fetch reușit, ultima știre nouă, eroare) și le poți activa/dezactiva sau adăuga altele din Setări. Parserul trebuie să suporte RSS 2.0, Atom, RSS 1.0/RDF, CDATA, entități HTML, BOM și date non-RFC.

## 2. Calendar economic

### 2.1 ForexFactory (Fair Economy) — sursa principală pentru listă și impact
- `https://nfs.faireconomy.media/ff_calendar_thisweek.json` → 200. (`cdn-nfs.` nu a răspuns.)
- Câmpuri: `title, country (=valută: USD, EUR, GBP…, „All”), date (ISO cu offset US/Eastern), impact (High|Medium|Low|Holiday), forecast, previous`. **Nu are `actual`.**
- Doar săptămâna curentă (`nextweek.json` → 404). Varianta XML are în plus `url`, dar ora e în GMT și formatul e `MM-DD-YYYY` + `9:30am`.
- **Limită:** max 2 descărcări / 5 min per IP; fișierul se actualizează o dată pe oră; la depășire primești o pagină HTML („Please wait five minutes…”) în loc de JSON. → interogăm **cel mult o dată pe oră** și tratăm răspunsul HTML ca rate-limit (backoff).
- Exemplu azi: 109 evenimente (13 High), ex. `Core CPI m/m USD 2026-10-14T08:30:00-04:00 High f=0.2% p=0.3%`.

### 2.2 TradingView economic calendar — sursa pentru `actual` și fallback
- `GET https://economic-calendar.tradingview.com/events?from=<ISO>&to=<ISO>&countries=US,EU,…` cu header `Origin: https://www.tradingview.com` → 200, JSON `{status, result[]}`.
- Câmpuri: `id, title, country, indicator, period, actual, forecast, previous, currency, importance (-1|0|1), date (UTC), unit, scale, source, source_url, comment`.
- **Are `actual`** după publicare (ex. ISM Services PMI a=54.9 f=55 p=55.4).
- Endpoint **neoficial / nedocumentat** → poate dispărea. Aplicația funcționează și fără el (fără `actual`).
- Titlurile diferă de FF („CPI m/m” vs „Inflation Rate MoM”, „Unemployment Claims” vs „Initial Jobless Claims”) → potrivire pe (valută, oră exactă) + similaritate de titlu cu dicționar de sinonime (TD §7).

### 2.3 Context de piață (nu intră în sentimentul din știri)
- Crypto Fear & Greed: `https://api.alternative.me/fng/?limit=N` → 200 (azi 69 „Greed”).
- CoinGecko: `/api/v3/global` (cap total, dominanță BTC) și `/api/v3/coins/markets` (top monede: nume + simbol → folosite și pentru detectarea monedelor în știri). Gratuit, rate-limit strict → o dată pe oră.

## 3. Sentiment — evaluare modele (local, offline)

Set de evaluare: 50 de titluri etichetate manual (bullish / neutru / bearish pentru crypto și acțiuni), salvat ca test de regresie (`server/src/sentiment/__fixtures__/headlines.json`).

| Model (ONNX, transformers.js, q8) | Corecte exact | Polaritate inversată | Viteză (50 titluri) |
|---|---|---|---|
| FinBERT (`Xenova/finbert`) — test pe 10 | 5/10 | 3 (ex. „exchange hacked, $200M stolen” → neutru; „Altcoins bleed” → pozitiv) | ~45 ms |
| distilroberta financial news | ~8/13 (scoruri saturate 0/1) | 2 | rapid |
| twitter-roberta-sentiment | 26/50 | 3 | 0.46 s |
| NLI zero-shot `nli-deberta-v3-xsmall` | 32/50 | 2 | 0.9 s |
| **NLI zero-shot `nli-deberta-v3-small`** | **35/50** | **1** | 0.9 s (~170 MB) |
| NLI zero-shot `nli-deberta-v3-base` | 27/50 (prea multe „neutru”) | 0 | 2.4 s |

Etichete zero-shot câștigătoare: `["good news for crypto and stock prices", "bad news for crypto and stock prices", "neutral news"]`, template `"This is {}."` (alte formulări testate: 16–33/50).

Ce greșesc modelele: implicațiile macro („Fed cuts rates” → ar trebui pozitiv; „Treasury yields jump” → negativ; „dollar slides” → pozitiv; „Mt. Gox moves BTC to exchange” → negativ). **Decizie:** motor hibrid = NLI zero-shot + **reguli de domeniu** (lexicon macro/crypto cu precizie mare care, când se declanșează, domină scorul). Fallback numai-reguli dacă modelul nu se poate descărca.

**Opțional:** motor Claude (API Anthropic), activabil din Setări cu cheie API. Model implicit `claude-opus-5-5` (configurabil, ex. `claude-haiku-5-5` pentru cost minim). Estimare: ~1000 titluri/zi ≈ 60k tokeni input + 15k output ⇒ ~0,5 $/zi pe Opus 5.5, ~0,01 $/zi pe Haiku 5.5. Cache per știre (fiecare titlu e scorat o singură dată). La orice eroare → motorul local.

## 4. Grafice și date OHLCV
- **lightweight-charts 5.2.1** (TradingView, Apache-2.0): candlestick, linii, markere (`createSeriesMarkers`), price lines, panouri, **primitives** (plugin API) pentru umplerea norului EMA și segmente orizontale TP/SL/structură de piață care încep la o bară anume și se prelungesc în viitor.
- Date: **ccxt 4.5.85** → `fetchOHLCV` public (fără cheie). Testat KuCoin `BTC/USDT 1h`: 1500 lumânări/cerere, `paginate:true` → 3000 ok. Timeframe-uri KuCoin: 1m,3m,5m,15m,30m,1h,2h,4h,6h,8h,12h,1d,1w,1M.

## 5. Indicatorul Slingshot System 3.2 (Pine v5) — semantică necesară pentru port
Sursa: `/Users/lorinbute/Documents/Development/GitHub/Sling Shot System/sling-shot-system.pine` (v3.2, „Market Structure Levels”). Cercetarea s-a făcut pe 3.2. Între timp scriptul și portul au ajuns la 3.3 (reparația urmăririi TP/SL) și apoi la 3.4 (partea SHORT, `sling-shot-system-3.4.pine`, vezi [slingshot-port.md](slingshot-port.md) și FD-SLINGSHOT34). Semantica de mai jos rămâne valabilă pentru LONG, iar SHORT-ul este oglinda ei.

Semantica exactă a funcțiilor `ta.*` a fost verificată în **PyneCore** (runtime Python care reproduce bit-cu-bit TradingView, cu „measured laws”):
- `ta.ema`: α = 2/(len+1), **seed = SMA** pe primele `len` valori non-na; pas `prev + α·(src − prev)` (forma algebric echivalentă `α·src + (1−α)·prev` diverge pe ultimii biți).
- `ta.rma`: seed SMA; pas `(prev·(len−1) + src)/len`.
- `ta.rsi`: prima bară na; `rma(max(Δ,0))`, `rma(max(−Δ,0))`; dacă `rmaD ≤ 1e-10` → 100; altfel dacă `rmaU ≤ 1e-10` → 0; altfel `100 − 100/(1+u/d)`.
- `ta.stoch(src,h,l,len)`: `100·(src − lowest)/(highest − lowest)`, **fără clamp**; interval 0 → `0/0 = na` (semantică IEEE, identică cu JS).
- `ta.sma` / `math.sum`: fereastra e **na-compactată** (bara na → rezultat na, valoarea nu intră în fereastră).
- `ta.highest/lowest`: na dacă `bar_index < len−1`; o valoare na **resetează** fereastra (după reset, extremul se calculează doar pe valorile de după reset). `ta.highestbars/lowestbars`: la egalitate se alege **cea mai veche** bară.
- `ta.pivothigh(L,R)`: fereastră L+R+1 cu egalitate → **cea mai nouă** bară; pivotul e confirmat dacă indexul maximului e exact −R ⇒ bara centrală trebuie să fie **strict mai mare decât barele din dreapta** și **≥ barele din stânga**. `pivotlow` simetric.
- `ta.atr(len) = rma(tr(true), len)`; `tr` prima bară = `high − low`.
- `ta.valuewhen(cond, src, 0)`: ultima valoare a `src` când `cond` a fost adevărat.
- Comparații cu na → false; aritmetică cu na → na; `math.max(0, na)` → na (identic cu `NaN` în JS, **atenție la `!=`**, care în JS dă `true` cu NaN — codul Pine protejează mereu cu `na()` înainte).
- `request.security(..., lookahead_off)` pe istoric: valoarea unei bare HTF devine vizibilă pe bara de chart la care bara HTF s-a închis; înainte se vede valoarea HTF precedentă. Pe bara în formare (realtime) se vede bara HTF în formare.
- `max_labels_count = 500`: etichetele vii cele mai vechi sunt șterse automat.

## 6. Exchange — KuCoin
- Semnătura REST: `KC-API-SIGN = base64(HMAC-SHA256(secret, timestamp + METHOD + endpoint + body))`, passphrase criptat HMAC pentru cheile v2/v3 (`KC-API-KEY-VERSION`).
- **Unified Trading Account (UTA)** lansat 10 feb 2026; din iunie 2026 API-ul Pro trece pe UTA, contul clasic e în mentenanță. **ccxt** detectează automat modul (`isUTAEnabled()` → `GET /api/ua/v1/account/mode`) și folosește endpoint-urile UTA/clasice corespunzătoare → **folosim ccxt** (acoperă și Binance/Bybit/OKX pentru extinderi ulterioare: toate au `fetchPositions, fetchOpenOrders, fetchMyTrades, fetchBalance`).
- Futures clasic: clasa separată `kucoinfutures`.
- Cheile trebuie create **doar cu permisiunea „General/Read”** (fără Trade, fără Withdraw) și, ideal, cu IP whitelist.

## 7. Mediu / constrângeri locale
- Node 25.9, npm 11, macOS arm64. `node:sqlite` disponibil (SQLite 3.53) → fără dependențe native pentru DB.
- În sandbox-ul de dezvoltare ieșirea la internet trece printr-un proxy: `fetch` din Node necesită `NODE_USE_ENV_PROXY=1`, iar ccxt opțiunea `httpsProxy`. Aplicația respectă `HTTPS_PROXY` dacă e setat (inofensiv pe mașina ta, unde nu există proxy).

## 8. Acțiuni — surse de date și brokeri (cercetare 13 oct 2026)

Testele de mai jos s-au făcut din rețeaua de dezvoltare, pe 13 oct 2026.

### 8.1 Brokeri cu acces prin cheie API (portofoliu, doar citire)
| Broker | Autentificare | Ce cere de la utilizator | Doar citire? | Ce se poate citi | Note |
|---|---|---|---|---|---|
| **Trading 212** | HTTP Basic: `Authorization: Basic base64(API_KEY:API_SECRET)` | cheie + secret (*Settings → API (Beta)*; secretul apare o singură dată), mediu Live / Demo | da: cheia are permisiuni pe categorii (account, metadata, orders, portfolio, history); bifezi doar citirea | rezumatul contului (`/api/v0/equity/account/summary`), pozițiile deschise (`/api/v0/equity/positions`, 1 cerere / s), ordinele, istoricul ordinelor (`/api/v0/equity/history/orders`, paginat prin `cursor`), instrumentele | doar conturi **Invest** și **Stocks ISA**; bază `https://live.trading212.com/api/v0` / `https://demo.trading212.com/api/v0`; restricție opțională pe IP; limite per cont, cu antete `x-ratelimit-*` |
| **eToro** | antete `x-api-key` (cheia publică) + `x-user-key` (cheia de utilizator) + `x-request-id` (UUID) | cheie publică + cheie de utilizator, din *Settings → Trading → API Key Management → Create New Key* (confirmare prin SMS); mediu Real / Demo (câte o cheie pe mediu) | da: permisiunea **Read** la crearea cheii; opțional IP whitelist și dată de expirare | `GET /api/v1/trading/info/real/pnl` (pozițiile cu `instrumentID`, `isBuy`, `openRate`, `units`, `amount`, `leverage`, `stopLossRate`, `takeProfitRate`, `unrealizedPnL`, plus credit și ordine); `/trading/info/trade/history`; metadatele instrumentelor (`GET /api/v2/market-data/instruments?instrumentsIds=…`, pentru simbol și nume); lumânări | răspunsurile au doar `instrumentID`, deci simbolul vine din cererea de metadate; limite: 60 / 60 s comun pentru portofoliu / PnL, 120 / 60 s pentru market data |
| **Interactive Brokers** | **Flex Web Service**: token + ID-ul unui Flex Query | token (*Performance & Reports → Flex Queries → Flex Web Service Configuration*: activezi serviciul, alegi expirarea, implicit 6 ore, opțional un IP, „Generate New Token”) + Query ID (un Activity Flex Query cu secțiunile Open Positions, Trades, Cash Report) | da: serviciul doar citește rapoarte | poziții, tranzacții, numerar, la data raportului | `GET https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest?t=TOKEN&q=QUERY&v=3` → `ReferenceCode` + `Url`, apoi `GET <Url>?t=TOKEN&q=REF&v=3`, reîncercat cât timp răspunsul e „Statement generation in progress”; XML; cel mult 1 cerere / s și 10 / min. Datele sunt ale **zilei precedente** (Activity), nu în timp real. Alternativele în timp real (Client Portal Gateway, un program Java local cu autentificare zilnică și 2FA; OAuth care cere aprobare IBKR) nu se potrivesc unei aplicații locale cu cheie |
| **Alpaca** | antete `APCA-API-KEY-ID` + `APCA-API-SECRET-KEY` (sau Basic) | Key ID + Secret, mediu Live / Paper (cheile nu sunt interschimbabile) | cheile Alpaca nu au permisiuni separate de citire; aplicația doar citește | `/v2/account`, `/v2/positions`, `/v2/orders?status=open`, activitățile; aceleași chei dau și date de piață | broker din SUA; `https://api.alpaca.markets` / `https://paper-api.alpaca.markets`; date gratuite: feed IEX, istoric din 2016, fără ultimele 15 min, 200 cereri / min |
| **XTB** | — | — | — | — | **API închis pe 14 martie 2025** (`xapi.xtb.com`, `ws.xtb.com`); integrarea nu e posibilă |
| **Tradeville** | — | — | — | — | nu există API public pentru clienți (doar Portal, MyTradeville, aplicația mobilă) |
| **Freedom24 (Tradernet)** | cheie publică + cheie privată, cereri semnate | — | — | portofoliu, ordine (după clienții open-source) | documentația oficială nu e accesibilă din rețeaua de test; amânat |
| Revolut, Degiro, Schwab, Saxo, Webull | — | — | — | — | Revolut și Degiro: fără API oficial pentru acțiuni; Schwab și Saxo: OAuth cu aplicație aprobată și reînnoirea tokenului; Webull: OpenAPI cu aprobare |

### 8.2 Exchange-uri crypto (ccxt `requiredCredentials`)
| Exchange | Câmpuri | Observații |
|---|---|---|
| KuCoin | apiKey, secret, password (passphrase) | suport complet existent (UTA / clasic / HF) |
| OKX, Bitget | apiKey, secret, password (passphrase) | |
| Binance, Bybit, Kraken, Gate, Crypto.com, MEXC, HTX | apiKey, secret | |
| Coinbase (Advanced Trade / CDP) | apiKey = numele cheii CDP (`organizations/…/apiKeys/…`), secret = cheia privată EC (PEM) | |

Toate au `fetchBalance`, `fetchOpenOrders` și `fetchMyTrades`, iar cele cu derivate și `fetchPositions`. Permisiunile de citire diferă ca nume: Binance „Enable Reading”, Bybit „Read-Only”, OKX „Read”, Kraken „Query Funds / Query Open Orders & Trades”.

### 8.3 Date de piață pentru acțiuni
| Sursă | Cheie | Ce dă | Rezultat test | Concluzie |
|---|---|---|---|---|
| Nasdaq (`api.nasdaq.com`, neoficial, cu User-Agent de browser) | nu | istoric zilnic (`/api/quote/{SYM}/historical?assetclass=stocks&fromdate=&todate=&limit=`), intraday doar pentru ziua curentă (`/api/quote/{SYM}/chart`), calendarul de rezultate (`/api/calendar/earnings?date=YYYY-MM-DD`) | 200 JSON | bun pentru zilnic și calendarul de rezultate, doar SUA |
| Twelve Data | da, gratuită (Basic: 800 credite / zi, 8 / min) | `time_series` intraday și zilnic, căutare | 200 (cheia `demo`, AAPL 1h) | bun pentru intraday în SUA cu cheie gratuită; internațional, doar simboluri de probă |
| Alpaca Market Data | cheile contului Alpaca | bare istorice (IEX), fără ultimele 15 min, 200 / min | nu am avut chei de test | bun pentru clienții Alpaca |
| eToro Market Data | cheile eToro | lumânări și cotații pentru instrumentele eToro (acțiuni SUA și UE, ETF-uri) | nu am avut chei de test | bun pentru clienții eToro |
| Yahoo Finance (neoficial) | nu, dar cere cookie / „crumb” | grafice, căutare, RSS | **429** (limitat din rețeaua de test) | nesigur; nu e sursă principală |
| Stooq | nu | CSV zilnic | pagină de verificare JavaScript | inutilizabil automat |
| Finnhub | da, gratuită (60 / min, necomercial) | știri pe companie, calendar de rezultate (1 lună), cotație, profil; lumânările nu sunt confirmate în planul gratuit | 401 cu cheia `demo` | opțional, pentru știri și rezultate |
| Alpha Vantage | da, gratuită (25 / zi) | serii | cheia `demo` doar pentru exemple | prea limitat |
| CNN Fear & Greed (acțiuni) | nu, cu `Referer` / `Origin` CNN | indicele 0–100 și istoricul | 200 (45,4 „neutral”) | bun pentru contextul de piață |
| SEC EDGAR | nu, dar cere User-Agent cu e-mail de contact | lista ticker → CIK, filings | 403 fără e-mail | opțional, cu acordul utilizatorului pentru e-mail |

### 8.4 Știri despre acțiuni (RSS, fără cheie)
| Sursă | URL | Rezultat |
|---|---|---|
| Nasdaq pe simbol | `https://www.nasdaq.com/feed/rssoutbound?symbol=AAPL` | 200, 15 articole |
| Nasdaq Stocks | `https://www.nasdaq.com/feed/rssoutbound?category=Stocks` | 200 |
| CNBC Earnings / Business (`search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10001147`) | | 200, 30 |
| Investing.com Stock News | `https://www.investing.com/rss/news_25.rss` | 200, 10 |
| MarketWatch, Seeking Alpha, Bloomberg, FT, CNBC | deja în aplicație (§1.2) | — |

Pentru sentimentul pe acțiuni trebuie recunoscute companiile în titluri: simboluri (`$AAPL`, `(NASDAQ: AAPL)`) și nume („Apple”, „Nvidia”). Pentru simbolurile din favorite se pot folosi lista de nume de la Nasdaq sau de la broker, plus aliasuri, ca la monedele crypto.

### 8.5 Logo-uri
- **Exchange-uri crypto:** `@web3icons/core` (MIT, deja instalat) are `exchanges/branded` pentru binance, bybit, okx, kucoin, kraken, coinbase, bitget, gate-io, crypto-com, bitstamp, gemini și altele.
- **Brokeri:** `simple-icons` (CC0) nu are IBKR, Trading 212, eToro, Alpaca și XTB (are Revolut și Robinhood). Iconițele oficiale (apple-touch-icon, 96–180 px) se descarcă de pe site-urile brokerilor: interactivebrokers.com, trading212.com, etoro.com, files.alpaca.markets, xas-cdn.xtb.com, tradeville.ro, freedom24.com. Sunt folosite doar ca să identifice brokerul în aplicația locală.

## 9. Importanța știrilor: cuvinte-cheie vs. Claude (cercetare 13 oct 2026)
Întrebarea: care importanță (impact 1–3) a unei știri e mai corectă pentru indexul zilei: cea din regulile de cuvinte-cheie (`news/classify.ts`) sau cea întoarsă de Claude odată cu scorul (`meta.impact`, salvată dar nefolosită)?

Date: baza reală, 1.240 de știri notate de Claude Opus 5.5 care au ambele valori (citire, fără modificări).

| | Claude 1 | Claude 2 | Claude 3 |
|---|---|---|---|
| Reguli 1 | 638 | 77 | 2 |
| Reguli 1,5 | 25 | 4 | 0 |
| Reguli 2 | 237 | 80 | 2 |
| Reguli 3 | 121 | 48 | 6 |

- Acord în ~58% din cazuri. Dezacordul e aproape mereu „regulile umflă”: 406 știri cu 2–3 la reguli și 1 la Claude.
- Regulile dau 3 pe cuvinte, fără context: „…Strategy Is Key to Surviving a Stock Market **Crash**…” (articol de sfaturi), „…owner hit by cyber-attack” (**hack** la un lanț de haine), comentarii valutare care pomenesc „**inflation**”, „US Dollar: … no clear catalyst”.
- Regulile ratează ce nu are cuvintele lor: „Chip Selloff Sparks 7% Korea Rout…” (reguli 1, Claude 3).
- Claude e reținut: 3 doar la 10 știri din 1.240.
- Efectul asupra indexului: 0–3 puncte pe zi (ex. 13 oct: 44,8 cu reguli, 42,2 cu Claude); același sens, altă cântărire.
- Limită: „corect” e aici judecata pe exemple, nu o măsurătoare față de mișcarea prețului; un test față de randamentele BTC / S&P 500 din orele următoare devine posibil după câteva săptămâni de istoric.

Concluzie: importanța de la Claude, când există; regulile rămân pentru știrile notate local (fallback-ul sau motorul local ales).

Separat, cererea utilizatorului: știrile geopolitice cântăresc mai mult de când Trump e președinte (tarife, sancțiuni, războaie, declarații), deci relevanța lor urcă de la 0,6 la 0,8 (aceeași ca știrile macro fără termeni de piață); cele fără nicio legătură cu piețele rămân în afara indexului.

## 10. Indicatori economici pe țări (cercetare 13 oct 2026)
Cererea: o pagină cu nivelul curent al tuturor indicatorilor economici ai piețelor principale (în special SUA), grupați pe țară, cu nivelul UE unde există, și cu data următoarei publicări.

**Surse verificate**
| Sursă | Ce are | Cheie | Concluzie |
|---|---|---|---|
| Calendarul TradingView (`economic-calendar.tradingview.com/events`, folosit deja de aplicație) | pentru fiecare publicare: `ticker` stabil (ex. `ECONOMICS:USIJC`), `indicator`, `category`, `period`, `referenceDate`, `actual` / `previous` (revizuit) / `forecast`, `unit`, `scale` (K / M / B / T), `importance`, `source` + `source_url` (instituția oficială), `comment` (descriere, engleză), `date`; publicările viitoare cu data și prognoza | nu | sursa principală: aceleași date ca în Calendar, toate țările, și data următoarei publicări |
| FRED (`fred.stlouisfed.org/graph/fredgraph.csv?id=…`) | serii istorice SUA (CPI, șomaj, cereri de șomaj…), fără cheie | nu (API-ul oficial cere cheie) | doar SUA, fără date viitoare; nu e nevoie |
| Eurostat / BCE (JSON-stat, SDMX) | serii UE / zona euro | nu | ar dubla ce are TradingView pentru zona euro; fără date viitoare |

**Ce dă TradingView (măsurat pe 120 de zile, US / EU / GB / JP / CN / DE)**
- 349 de indicatori cu `ticker`; alte evenimente fără `ticker` au totuși `indicator` (randamente la licitații, U6, GDPNow, productivitate), deci cheia unui indicator = `ticker` sau `țară:indicator`. „Calendar” și „Holidays” (categoria `gov`) nu sunt indicatori.
- Categorii: `prce` prețuri, `lbr` muncă, `gdp`, `bsnss` industrie / afaceri, `cnsm` consum, `hse` locuințe, `mny` bani / dobânzi, `trd` comerț, `gov` buget, `bnd` / `mrkt` obligațiuni, `enrg` energie, fără categorie (PMI-urile).
- SUA ~150 de indicatori (inflație, CPI, PCE, PPI, cereri de șomaj, NFP, JOLTS, ISM, Fed-urile regionale, locuințe, ipoteci, stocuri de petrol…); zona euro (`EU`) ~33 (inflație, șomaj, PIB, ZEW, încredere, BCE…), fără locuințe; Germania are în plus Ifo, comenzi, producție.
- Unități: `%`; fără unitate (indici); `K` / `M` / `B` / `T` cu sau fără monedă (`$`, `€`, `£`, `¥`, `CNY`, `cf`).
- **Limită: cel mult 2.000 de evenimente pe cerere** (SUA pe 400 de zile a fost tăiat la martie). Istoricul se cere pe bucăți, cu împărțire automată când răspunsul atinge limita.
- **Viitorul:** publicările programate se văd cam 5 săptămâni înainte (cererea până la +90 de zile întoarce evenimente până la ~+36 de zile). Mai departe, data nu e cunoscută.
- Zona euro publică „flash” apoi „final” pentru aceeași perioadă (ex. inflația august: 3,3 apoi 3,2): pentru o perioadă contează ultima publicare.
- Calendarul aplicației citește deja −7 … +14 zile pentru 13 țări la 15 minute (și imediat după publicările importante): aceleași răspunsuri pot ține valorile la zi fără cereri în plus.

## 11. Când e bună o creștere: sensul fiecărui indicator (cercetare 13 oct 2026)
Pentru colorarea paginii Economie (verde = bine, roșu = rău), din perspectiva **sănătății economiei**, cum a cerut utilizatorul („dacă inflația crește, e rău; dacă PIB-ul a crescut, e bine”). Am clasificat toate cele 344 de nume distincte de indicatori din baza reală.

| Sens | Indicatori |
|---|---|
| **Creșterea e bună** | PIB (toate formele, GDPNow, investiții, contribuția exporturilor); producția industrială și manufacturieră, gradul de utilizare, comenzile (bunuri durabile, fabrici, utilaje, construcții), PMI-urile, ISM, indicii Fed-urilor regionale, Ifo, ZEW, Tankan, încrederea companiilor și a consumatorilor, indicii anticipativi; locurile de muncă (NFP, ADP, angajări, posturi libere, demisii, participarea, orele lucrate, productivitatea); vânzările cu amănuntul, cheltuielile și veniturile gospodăriilor; locuințele începute, autorizațiile, vânzările de locuințe, NAHB, cererile de ipoteci; balanța comercială, contul curent, exporturile, investițiile străine directe; soldul bugetului; creditarea în economie (China) |
| **Creșterea e rea** | toată inflația (CPI, PCE, PPI, de bază, lunară, anuală, regională, așteptările de inflație, prețurile de import, prețurile plătite din ISM / Philly Fed, prețul mașinilor rulate); șomajul (rata, U6, numărul șomerilor, cererile de ajutor de șomaj, concedierile anunțate); costul unitar al muncii; dobânzile băncilor centrale și la ipoteci; randamentele obligațiunilor; datoria publică față de PIB |
| **Neutru** (efect ambiguu) | salariile (bune pentru gospodării, dar inflaționiste); stocurile companiilor și de mărfuri / energie; prețul locuințelor (bun pentru proprietari, rău pentru accesibilitate); importurile; creditul de consum; masa monetară și bilanțul băncii centrale; prețurile exporturilor și ale materiilor prime; rezervele valutare |

Observații:
- Perspectiva e a economiei, nu reacția pieței: un NFP foarte puternic e verde aici, deși poate scădea bursa (Fed rămâne strict).
- Dobânzile și randamentele mai mari sunt roșii: condiții de finanțare mai grele pentru economie (și pentru piețele de risc), chiar când sunt răspunsul la inflație.
- „Mai mic e mai bine” la inflație ține doar cât inflația e pozitivă; o deflație ar trebui citită separat. Sursa nu are cazuri recente, deci rămâne regula simplă.

## 12. Rezumatul zilei cu Claude (cercetare 13 oct 2026)
**API (SDK `@anthropic-ai/sdk` 0.133, instalat):** `client.messages.stream({ model, max_tokens, system, messages, output_config: { effort, format: zodOutputFormat(schema) } })` + `await stream.finalMessage()` → `parsed_output` (JSON validat cu zod; `null` dacă nu se poate citi). Pe Claude Opus 5.5 gândirea e mereu adaptivă (fără parametrul `thinking`), adâncimea se reglează cu `effort` (implicit `medium`). Streaming-ul evită timeout-urile la răspunsuri lungi. `stop_reason === 'refusal'` → refuz; `max_tokens` → răspuns tăiat (`parsed_output` nul). Erorile tipizate (`AuthenticationError`, `RateLimitError`…) se folosesc deja în motorul de sentiment.

**Ce știe aplicația despre zi (fără cereri noi pe internet):**
- sentimentul zilei (index, încredere, defalcare pe categorii, evoluția pe ore, ultimele 7 zile, știrile care trag în sus / jos);
- știrile de azi, cu scor, importanță și monede;
- calendarul (evenimente de azi cu valoare / prognoză / anterior, plus ce urmează în 24 h);
- indicatorii economici publicați azi (pagina Economie: valoare, anterior, prognoză, sensul bine / rău, istoric) și cei programați;
- piața: Fear & Greed crypto și acțiuni, capitalizarea, dominanța BTC, S&P 500 / Nasdaq 100 / VIX, starea bursei americane;
- favoritele utilizatorului din scanner: preț, variația pe 24 h, trend, semnal Slingshot.

**Graficele:** Claude nu desenează și nu inventează cifre: aplicația pregătește seriile (evoluția sentimentului, sub-indicii, istoricul fiecărui indicator publicat azi, variația favoritelor), iar Claude alege, după situație, care dintre ele contează și scrie sub fiecare ce arată. Interfața le desenează din datele aplicației.

**Cost:** un rezumat trimite ~4–5 mii de tokeni (promptul real pe datele de azi: ~10 400 de caractere, plus instrucțiunile și schema) și primește ~2–5 mii (JSON-ul de ~4 200 de caractere plus gândirea); la $4 / $20 pe milion (Claude Opus 5.5) înseamnă ~5–15 cenți; jurnalul notează tokenii fiecărui rezumat; de aceea rezumatul se păstrează și se refolosește la redeschidere, iar o actualizare se poate cere cel mult o dată la 2 minute.

## 13. Connector Claude (MCP) pe abonamentul fiecăruia (cercetare 13 oct 2026)
**De ce MCP:** termenii Anthropic (code.claude.com/docs/en/legal-and-compliance, citit 13 oct 2026) nu permit unei aplicații să trimită cereri prin credențialele Free / Pro / Max ale utilizatorilor și nici să colecteze / păstreze token-urile claude.ai. Calea permisă: Sentiq e un **server MCP la distanță** pe care fiecare îl adaugă în Claude ca *custom connector*; Claude (web, desktop, mobil după ce l-ai adăugat pe web, Claude Code) citește datele Sentiq și face analiza pe abonamentul lui. Cere o adresă publică HTTPS: Claude se conectează din infrastructura Anthropic (`160.79.104.0/21`), nu din browser.

**Specificația MCP 2026-07-28 (autorizare):** OAuth 2.1; serverul MCP e *resource server* și **trebuie** să publice Protected Resource Metadata (RFC 9728) și să răspundă `401` cu `WWW-Authenticate: Bearer resource_metadata="…"`; serverul de autorizare publică RFC 8414 (`/.well-known/oauth-authorization-server`); PKCE S256 obligatoriu (`code_challenge_methods_supported: ["S256"]`, altfel clienții refuză); parametrul `resource` (RFC 8707) în autorizare și token, iar serverul **trebuie** să accepte doar token-uri emise pentru el (audiența); token-ul doar în header, niciodată în URL; `iss` în răspunsul de autorizare (RFC 9207, recomandat, cu `authorization_response_iss_parameter_supported`); token-uri de acces de scurtă durată; refresh **rotit** pentru clienți publici; redirect doar `https` sau `localhost`, comparat exact; pe ecranul de consimțământ trebuie arătat hostul redirect-ului și un avertisment pentru redirect doar pe localhost. Înregistrarea clienților: **Client ID Metadata Documents** (CIMD, recomandat: `client_id` e un URL HTTPS cu un JSON al clientului, pe care serverul îl descarcă și îl validează: `client_id` identic cu URL-ul, `redirect_uris`), pre-înregistrare sau **DCR** (RFC 7591, păstrat pentru compatibilitate).

**Ce face concret Claude (claude.com/docs/connectors/building/authentication, lazy-authentication):**
- `401` obligatoriu (un `WWW-Authenticate` pe `200` e ignorat); `resource` din metadata = exact URL-ul pus de utilizator (cu `/mcp`); folosește doar primul `authorization_servers`;
- alege **CIMD** doar dacă metadata are `client_id_metadata_document_supported: true` **și** `"none"` în `token_endpoint_auth_methods_supported`; altfel DCR (`registration_endpoint`);
- `client_id`-ul Claude (descărcat 13 oct 2026): `https://claude.ai/oauth/mcp-oauth-client-metadata` → `{"client_name":"Claude","redirect_uris":["https://claude.ai/api/mcp/auth_callback"],"token_endpoint_auth_method":"none",…}`; Claude Code: `https://claude.ai/oauth/claude-code-client-metadata` → `redirect_uris: ["http://localhost/callback","http://127.0.0.1/callback"]`, port variabil (potrivire fără port, RFC 8252 §7.3); `Cache-Control: max-age=300`; callback-ul poate trece și pe claude.com;
- PKCE S256 la fiecare autorizare; cere scope-urile din `WWW-Authenticate` sau `scopes_supported` și adaugă `offline_access` dacă metadata serverului de autorizare îl are (ca să primească refresh token);
- `/token` primește `application/x-www-form-urlencoded`; reîmprospătează pe `401` și cu până la 5 min înainte de expirare; la refresh invalid vrea `invalid_grant`; timp de răspuns: 10 s (descoperire, înregistrare, token), 30 s (refresh);
- un `200` cu `isError` nu pornește autentificarea; `403` + `insufficient_scope` cere scope în plus;
- metadata e ținută în cache ~5 min.

**SDK-ul TypeScript v2** (`@modelcontextprotocol/server` 2.3.1, instalat fix; v1 `@modelcontextprotocol/sdk` e linia veche): `createMcpHandler(factory)` → `{ fetch(Request, { authInfo, parsedBody }) → Response }`, fără stare (un `McpServer` nou per cerere), servește atât clienții 2026-07-28, cât și pe cei din 2025 (verificat: clientul SDK a vorbit 2025-11-25 și a primit unelte, prompturi și erorile de validare ca `isError`). `authInfo` e doar transmis (verificarea token-ului e a noastră); SDK-ul v2 **nu** are server de autorizare (cel din v1 e „înghețat” în `server-legacy`), deci Sentiq e propriul server de autorizare (are deja conturi, 2FA, passkey). Unelte: `registerTool(name, { title, description, inputSchema: z.object(…), annotations: { readOnlyHint } }, cb)`; prompturi: `registerPrompt`; `instructions` la server; `maxToolInputElements`. 2.3.0 (2 oct): „un server per cerere”, `expectedResource`; 2.3.1 (5 oct): doar documentație / server-legacy.

**Ce există deja în Sentiq și se refolosește:** contextul zilei (`buildDayContext`, FD-SUMMARY), `DailySentimentService.today/history`, `queryNews` (filtre: interval, categorie, monede, sentiment, text), `CalendarService.query` (cu evenimentele utilizatorului și rezultatele companiilor), `EconomyService.view`, `Scanner.result(userId)`, `readContext` (piața), `MarketData.candles` / `StockData.candles` + `runSlingshot` / `summarize` (aceeași analiză ca scannerul). Login-ul (parolă + 2FA / passkey) e cel al aplicației; `safeNext` limitează adresa de întoarcere la 300 de caractere (de aceea cererea de autorizare se ține pe server și pagina de consimțământ primește doar un id).

## 14. Boți de tranzacționare (cercetare 21 oct 2026)

**Ce tipuri există** (Binance, OKX, 3Commas, Gainium, Altrady, bit.com):
- **Grid:** cumpără sub preț și vinde peste, între o limită de jos și una de sus, împărțite în N grile.
  - Spațiere aritmetică (pas egal în preț) sau geometrică (pas egal în procente).
  - Pe spot, la pornire se cumpără activul pentru grilele de deasupra prețului (ca să existe ce vinde).
  - Pe futures: modurile Long, Short și Neutru, cu levier și o marjă inițială.
  - Opțiuni: un preț de pornire (trigger); stop loss / take profit pe preț, sau pe profit / ROI; „închide pozițiile la oprire”.
  - Câștigul pe grilă = pasul minus comisioanele (de 2 ori: cumpărare + vânzare).
  - Iese din interval: botul nu mai face nimic până revine prețul.
- **DCA** (3Commas, Gainium): un ordin de bază și ordine de siguranță (safety orders) la scăderi succesive.
  - Ordinul de bază: suma și tipul (piață / limită).
  - Ordinele de siguranță: abaterea până la primul, suma primului, multiplicatorul de volum, multiplicatorul de pas, câte cel mult.
  - Take profit: procent din prețul mediu (unul sau mai multe, opțional trailing).
  - Stop loss: procent din prețul ordinului de bază; acțiunea la SL (închide / închide și oprește botul), breakeven, trailing.
  - Ciclurile: pauză între cicluri, câte cicluri cel mult, prețul minim / maxim la care pornește un ciclu, durata maximă a unui ciclu.
- **Boți pe semnale:** intră pe semnalele unui indicator sau ale unui webhook (TradingView), cu SL / TP proprii sau ale semnalului.

**Reguli de risc folosite peste tot:**
- risc pe tranzacție de 0,5–2% din capital, riscul total deschis ~6%;
- o limită de pierdere pe zi (kill switch);
- stop loss obligatoriu;
- pauză după o pierdere;
- un număr maxim de poziții deschise.

**Ce înseamnă pentru Sentiq:**
- Setările clasice: Grid și DCA, cu numele și valorile obișnuite.
- Modul Premium: un bot pe semnale (Slingshot), cu sentimentul site-ului ca filtru și, la alegere, modelul AI al utilizatorului ca o ultimă verificare.
- Ordinele pleacă prin `TradingService.place` (aceleași verificări, același jurnal, aceeași cheie anti-dublură ca formularul).
- Platformele închid diferit:
  - un exchange crypto acceptă o vânzare la piață sau un ordin reduce-only;
  - eToro închide după id-ul poziției;
  - Trading 212 nu are short.
- De aceea modul real pornește doar pe exchange-urile crypto. Pe acțiuni, botul rulează în simulare (aceleași reguli, fără ordine).

## Surse
- PyneCore `ta.py`, `safe_convert.py`, `_math_stateful.py` — github.com/PyneSys/pynecore
- [KuCoin — Signing a Message](https://KuCoin.com/docs/basic-info/connection-method/authentication/signing-a-message)
- [KuCoin — anunț UTA](https://www.kucoin.com/es/announcement/id-kucoin-unified-trading-account-uta-launch-announcement), [upgrade API 2026-06-03](https://www.kucoin.com/fr/announcement/vn-announcement-of-kucoin-api-upgrade-2026-06-03)
- [ForexFactory — limită download calendar](https://www.forexfactory.com/thread/post/15166506)
- [MQL5 forum — endpoint FF JSON](https://www.mql5.com/en/forum/343908/16870225)
- Hugging Face: `Xenova/finbert`, `Xenova/nli-deberta-v3-small`, `Xenova/twitter-roberta-base-sentiment-latest`
- [Trading 212 Public API](https://docs.trading212.com), [Positions](https://docs.trading212.com/api/positions)
- [eToro API — Getting started](https://api-portal.etoro.com/getting-started), [Authentication & API keys](https://builders.etoro.com/learn/authentication-and-api-keys), [Portfolio & positions](https://builders.etoro.com/learn/portfolio-management-and-positions), [PnL endpoint](https://api-portal.etoro.com/api-reference/trading--real/get-account-pnl-and-portfolio-details.md), [Instruments](https://api-portal.etoro.com/api-reference/market-data/search-for-securities-instruments-by-id-or-symbol.md)
- [IBKR — Configure Flex Web Service](https://www.ibkrguides.com/clientportal/performanceandstatements/flex3.htm), [Flex Web Service](https://www.interactivebrokers.com/docs/web-api/flex-web-service/using-flex-web-service/make-request-to-send-request), [ib_insync flexreport.py](https://github.com/erdewit/ib_insync/blob/master/ib_insync/flexreport.py)
- [Alpaca — Authentication](https://docs.alpaca.markets/docs/authentication), [About Market Data API](https://docs.alpaca.markets/docs/about-market-data-api)
- [XTB — Do you offer API?](https://www.xtb.com/int/help-center/our-platforms-1/do-you-offer-api-1)
- [Twelve Data — API credits limits](https://support.twelvedata.com/en/articles/5194820-api-credits-limits), [pricing](https://twelvedata.com/pricing)
- [tradernet-mcp (Freedom24)](https://socket.dev/npm/package/tradernet-mcp)
- [Claude Code — Legal and compliance (autentificare)](https://code.claude.com/docs/en/legal-and-compliance)
- [Claude — Authentication for connectors](https://claude.com/docs/connectors/building/authentication), [Lazy authentication](https://claude.com/docs/connectors/building/lazy-authentication)
- [MCP 2026-07-28 — Authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization), [Client registration](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration), [Security considerations](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations), [Authorization server discovery](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/authorization-server-discovery)
- [MCP TypeScript SDK v2 — Serving over HTTP](https://ts.sdk.modelcontextprotocol.io/v2/serving/http), [Authorization](https://ts.sdk.modelcontextprotocol.io/v2/serving/authorization.html)
- Boți: [Binance — Spot Grid parameters](https://www.binance.com/en/support/faq/binance-spot-grid-trading-parameters-688ff6ff08734848915de76a07b953dd), [Binance — What is spot grid trading](https://www.binance.com/en/support/faq/what-is-spot-grid-trading-and-how-does-it-work-d5f441e8ab544a5b98241e00efb3a4ab), [Binance — What is futures grid trading](https://www.binance.com/en/support/faq/what-is-futures-grid-trading-f4c453bab89648beb722aa26634120c3), [3Commas — Main settings of the DCA bot](https://help.3commas.io/en/articles/3108940-main-settings-dca-bot), [Altrady — Grid bot setup](https://support.altrady.com/en/article/grid-bot-setup-configuration-guide-1pffkoo/), [Gainium — Grid bot](https://gainium.io/grid-bot), [ForkLog — OKX trading bots](https://forklog.com/en/grid-dca-and-the-signals-marketplace-an-overview-of-okxs-trading-bots/), [bit.com — Trading bot](https://www.bit.com/knowledge-hub/trading-bot)
