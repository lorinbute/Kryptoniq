# Kryptoniq — Research (12 oct 2026)

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
Sursa: `/Users/lorinbute/Documents/Development/GitHub/Sling Shot System/sling-shot-system.pine` (v3.2, „Market Structure Levels”). Cercetarea s-a făcut pe 3.2. Între timp scriptul și portul au ajuns la 3.3 (reparația urmăririi TP/SL, vezi [slingshot-port.md](slingshot-port.md)), iar semantica de mai jos rămâne valabilă.

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

## Surse
- PyneCore `ta.py`, `safe_convert.py`, `_math_stateful.py` — github.com/PyneSys/pynecore
- [KuCoin — Signing a Message](https://KuCoin.com/docs/basic-info/connection-method/authentication/signing-a-message)
- [KuCoin — anunț UTA](https://www.kucoin.com/es/announcement/id-kucoin-unified-trading-account-uta-launch-announcement), [upgrade API 2026-06-03](https://www.kucoin.com/fr/announcement/vn-announcement-of-kucoin-api-upgrade-2026-06-03)
- [ForexFactory — limită download calendar](https://www.forexfactory.com/thread/post/15166506)
- [MQL5 forum — endpoint FF JSON](https://www.mql5.com/en/forum/343908/16870225)
- Hugging Face: `Xenova/finbert`, `Xenova/nli-deberta-v3-small`, `Xenova/twitter-roberta-base-sentiment-latest`
