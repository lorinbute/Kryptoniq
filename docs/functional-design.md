# Kryptoniq — Functional Design (v1)

> Document viu. Fiecare feature nou adaugă o secțiune (sau o versiune) aici înainte de implementare.
> Cercetarea pe care se bazează deciziile: [research.md](research.md). Implementarea: [technical-design.md](technical-design.md).

## 0. Scop și principii

Kryptoniq este un **asistent local de day-trading** care adună într-un singur loc ce se întâmplă acum în piață (crypto + macro + geopolitică), calculează **sentimentul zilei**, arată **calendarul economic**, **grafice cu indicatorul Slingshot System** și **tranzacțiile active** de pe exchange.

Principii:
1. **Rulează doar local** (pe Mac-ul tău), cel puțin 6–12 luni. Serverul ascultă numai pe `127.0.0.1`, nu există conturi sau login.
2. **Informează, nu tranzacționează.** Aplicația nu plasează și nu anulează ordine. Cheile de exchange trebuie să fie read-only.
3. **Transparentă.** Fiecare cifră (sentimentul zilei, scorul unei știri) poate fi „deschisă” ca să vezi de unde vine.
4. **Robustă.** O sursă căzută nu strică restul. Ultimele date bune rămân vizibile, marcate „din cache”.
5. **Temă întunecată**, interfață în română, termeni de trading în engleză (LONG, TAKE PROFIT, CPI…).

### 0.1 Fus orar și „ziua”
- „Ziua” înseamnă ziua calendaristică în **fusul orar al utilizatorului** (implicit cel al sistemului, de ex. `Europe/Bucharest`), configurabil din Setări.
- Trecerile la ora de vară/iarnă (zile de 23 h sau 25 h) sunt tratate corect: ziua e intervalul [00:00, 00:00 a zilei următoare) în fusul ales.
- Orele evenimentelor macro se afișează în fusul utilizatorului, cu ora New York (ET) în tooltip.

### 0.2 Pornire
- `npm start` → aplicația pornește la `http://127.0.0.1:4317`.
- La prima pornire: se creează baza de date, se încarcă sursele implicite și watchlist-ul implicit (BTC, ETH, SOL), se descarcă modelul de sentiment (~170 MB, o singură dată). Până e gata modelul, sentimentul se calculează doar cu regulile de domeniu (marcat în UI).
- Dacă aplicația a fost oprită, la repornire recuperează: știrile publicate între timp (cât timp sunt încă în feed-uri), închide zilele rămase deschise, actualizează calendarul.

## 1. Navigare și layout
- Sidebar stânga: **Azi** (dashboard) · **Știri** · **Calendar** · **Grafice** · **Tranzacții** · **Setări** · **Stare sistem**.
- Bara de sus (vizibilă peste tot): mini-indicator cu sentimentul zilei (scor + culoare), countdown până la următorul eveniment macro **High**, ceas local + ET.
- Stările „se încarcă”, „gol” și „eroare” sunt tratate explicit pe fiecare pagină. Fără ecrane albe.

## 2. Știri (FD-NEWS)

### 2.1 Ce face
- Colectează știri din surse RSS gratuite, în 3 categorii: **Crypto**, **Macro/Piețe**, **Geopolitică** (listă implicită în research §1, editabilă).
- Fiecare știre are: titlu, sursă, oră, rezumat scurt (text simplu), link spre articol, **categorie**, **monedele detectate** (BTC, ETH, …), **sentiment** (scor −1…+1 și etichetă Pozitiv/Neutru/Negativ), **relevanță** și **impact**.
- Lista e în ordine cronologică inversă și se reîmprospătează automat (~1 min). Știrile noi apar sus, marcate „nou”.

### 2.2 Filtre (afectează DOAR ce vezi)
- **Monedele mele (favorite)** — un comutator „doar favoritele” plus alegerea uneia sau mai multor monede din watchlist.
- Categorie, sursă, sentiment (pozitiv/negativ/neutru), căutare text, interval (ultimele 24 h implicit; azi; ieri; 7 zile).
- **Regula de aur:** filtrele nu schimbă niciodată sentimentul zilei. Sentimentul se calculează mereu pe **toate** știrile relevante (§3).

### 2.3 Duplicate și aceeași poveste din mai multe surse
- Aceeași știre văzută de mai multe ori (același GUID/link, link cu parametri `utm_*`) se salvează o singură dată.
- Aceeași poveste publicată de mai multe publicații e **grupată** (cluster): în listă apare o singură intrare cu „+N surse” care se poate desface.

### 2.4 Detectarea monedelor
- Se detectează după nume („Bitcoin”, „Ethereum”), simbol (`BTC`, `$SOL`) și aliasuri configurabile per monedă din watchlist.
- Protecție la ambiguități: simbolurile se potrivesc doar scrise cu MAJUSCULE sau cu `$`; simbolurile de 1–2 litere și cuvintele comune (`ONE`, `GAS`, `SUN`, `NEAR` scris „near”, `LINK` scris „link”, `CEO`, `ETF`, `SEC`, `USD`, `AI`) nu sunt considerate monede; numele mai lungi au prioritate („Bitcoin Cash” ≠ „Bitcoin”, „Ethereum Classic” ≠ „Ethereum”).

### 2.5 Edge cases
| Situație | Comportament |
|---|---|
| Știre fără dată | se folosește momentul primei descoperiri |
| Dată în viitor (fus greșit în feed) | dacă e > 5 min în viitor → se folosește momentul descoperirii |
| Știre veche reapărută în feed (> 3 zile) | ignorată la prima descoperire |
| Titlul unei știri existente se schimbă | se actualizează titlul și se recalculează sentimentul |
| HTML/entități/CDATA în titlu sau rezumat | convertite în text simplu; nu se afișează niciodată HTML din feed |
| Link care nu e `http(s)` | știrea se păstrează, dar fără link |
| Conținut sponsorizat / „press release” / „price prediction” | marcat, cu pondere redusă în sentiment |
| Știre geopolitică fără termeni relevanți pentru piață | afișată (gri, „relevanță scăzută”), dar **nu** intră în sentimentul zilei |
| Sursă căzută / timeout / 4xx / 5xx / HTML în loc de XML / 429 | sursa trece pe pauză cu backoff (5 → 10 → 20 → 40 → 60 min); restul merg normal; în Stare sistem apare eroarea |
| Feed uriaș (> 5 MB) | ignorat, eroare „feed prea mare” |
| Favorite selectate dar nicio știre | mesaj „Nicio știre despre BTC, ETH în intervalul ales” |
| Watchlist gol + „doar favoritele” | comutatorul e dezactivat, cu explicație |
| Sursă dezactivată | știrile ei dispar din listă și nu mai intră în sentiment (reapar dacă o reactivezi) |
| Retenție | știrile mai vechi de 90 de zile (configurabil) se șterg; scorurile zilnice deja calculate rămân |

## 3. Sentimentul zilei (FD-SENT)

### 3.1 Sentimentul unei știri
- Fiecare știre primește un scor între **−1 (foarte negativ)** și **+1 (foarte pozitiv)** pentru prețurile crypto și ale acțiunilor (risk-on/risk-off), plus o etichetă: Pozitiv (> +0,2), Negativ (< −0,2), Neutru.
- **Motor local (implicit):** un model AI care rulează pe Mac (fără internet după descărcare) + **reguli de domeniu** pentru ce modelele generale nu înțeleg (ex. „Fed cuts rates” = pozitiv, „yields jump” = negativ, „dollar slides” = pozitiv, „exchange hacked” = negativ, „ETF inflows” = pozitiv). Când se aplică o regulă, ea se vede în detaliile știrii.
- **Motor Claude (opțional):** dacă introduci o cheie Anthropic în Setări, titlurile se evaluează cu Claude (mai bun la implicații macro). Model configurabil (implicit `claude-opus-5-5`, alternativ `claude-haiku-5-5` pentru cost minim). Dacă Claude nu răspunde, se folosește automat motorul local.
- Știrile noi apar imediat, cu eticheta „în analiză”, până primesc scor (de obicei câteva secunde).

### 3.2 Indicele zilei (0–100)
Un singur număr, **0 = extrem de negativ, 50 = neutru, 100 = extrem de pozitiv**, cu etichetele:
0–20 *Foarte negativ* · 20–40 *Negativ* · 40–60 *Neutru* · 60–80 *Pozitiv* · 80–100 *Foarte pozitiv*.

Cum se calculează (versiunea pe înțelesul tuturor; formula exactă în TD §6):
1. Se iau **toate** știrile relevante din ziua respectivă (indiferent de filtre).
2. Fiecare știre are o **pondere** = relevanță × impact × încrederea în sursă × cât de recentă e.
   - *Impact* mare: Fed/FOMC/dobânzi, CPI/inflație, joburi (NFP), ETF-uri, SEC/reglementare, hack-uri, lichidări, tarife, război, BTC/ETH. Impact normal: un altcoin mic.
   - *Recentă*: o știre de acum 1 oră contează mai mult decât una de acum 10 ore (înjumătățire la 8 ore).
   - *Speculativă* („price prediction”, „could”, „?”), *sponsorizată* sau *recap* → pondere redusă.
3. Aceeași poveste din 5 surse **nu** contează de 5 ori: contează ca o știre, cu un bonus mic de acoperire.
4. **Nicio sursă nu poate domina:** o singură sursă nu poate depăși 25% din ponderea totală (ex. un site care publică 100 de articole pe zi).
5. Se face media ponderată a scorurilor. Când sunt puține știri, rezultatul e „tras” spre neutru (nu sari la 90 din 2 știri).
6. Se transformă în 0–100.

Pe dashboard vezi și:
- **Încrederea** (scăzută/medie/ridicată) — câte dovezi stau în spatele cifrei.
- **Defalcarea** pe Crypto / Macro / Geopolitică (fiecare cu indicele propriu).
- **Evoluția pe ore** în ziua curentă și **istoricul pe 30 de zile**.
- **Ce mișcă indicele:** top 5 știri pozitive și top 5 negative după contribuție.
- Numărul de știri: pozitive/neutre/negative/în analiză.

### 3.3 Edge cases
| Situație | Comportament |
|---|---|
| Nicio știre încă (după miezul nopții) | indicele 50, „date insuficiente”, încredere scăzută |
| Doar știri „în analiză” | ca mai sus; se recalculează imediat ce primesc scor |
| Modelul nu s-a descărcat (offline) | doar reguli; marcat „motor redus”; când modelul devine disponibil, știrile din ultimele 48 h scorate doar cu reguli se rescorează |
| Schimbi motorul (local ↔ Claude) | știrile noi folosesc noul motor; buton „Rescorează ultimele 48 h” |
| Schimbi fusul orar | zilele se recalculează în noul fus |
| Ziua s-a încheiat | indicele zilei se **îngheață** (snapshot final) după 2 ore de grație (feed-uri întârziate) și după ce toate știrile zilei au primit scor; până atunci apare în istoric ca provizoriu |
| Aplicația a fost oprită peste noapte | la pornire se calculează snapshot-urile zilelor rămase deschise |
| Prima pornire | zilele dinaintea primei zile de colectare nu intră în istoric (feed-urile mai conțin doar câteva știri din ele, deci indicele ar fi înșelător) |
| Rescorare după ce ziua s-a închis | snapshot-ul final nu se schimbă automat; există „Recalculează istoricul” în Setări |

## 4. Calendar economic (FD-CAL)

### 4.1 Ce face
- Arată evenimentele macro: azi (implicit) și săptămâna (curentă / următoare / anterioară).
- Pentru fiecare: ora (fusul tău), valuta/țara, titlu, **impact** (High = roșu, Medium = portocaliu, Low = galben, Holiday = gri), **Actual**, **Forecast**, **Previous** și, după publicare, abaterea Actual vs Forecast (↑ peste așteptări / ↓ sub așteptări).
- Explicații scurte în română pentru evenimentele cheie (CPI, Core CPI, NFP, Unemployment Rate, FOMC/Federal Funds Rate, PCE, PPI, Retail Sales, GDP, ISM PMI, Jobless Claims, JOLTS, Michigan Sentiment, discursurile Fed).
- Countdown până la următorul eveniment **High** (și în bara de sus). Evenimentele în desfășurare (± 2 min) sunt evidențiate.
- La ora unui eveniment High/Medium, valoarea Actual se caută activ: o verificare imediat după ora publicării, apoi la ~2 minute cât timp lipsește (până la 15 minute după eveniment).
- Filtre: impact (implicit High + Medium), valute (implicit USD, EUR, GBP, JPY, CNY + „Global”).
- **Evenimente personalizate**: poți adăuga manual evenimente (ex. „ETH upgrade”, „Termen ETF SOL”, „Token unlock ARB”), cu dată/oră, impact și notă. Apar în calendar ca „Personal”.

### 4.2 Surse
- **ForexFactory** — lista principală și impactul (standardul folosit de traderi). Se citește cel mult o dată pe oră (limita lor).
- **TradingView** — valorile Actual (FF nu le are) și fallback pentru zilele pe care FF nu le acoperă (ex. săptămâna viitoare).

### 4.3 Edge cases
| Situație | Comportament |
|---|---|
| FF blocat (rate limit, HTML în loc de JSON) / căzut | se folosesc ultimele date FF din DB; pentru zilele fără FF → TradingView (impact mapat 1 → High, 0 → Medium, −1 → Low); banner „sursă de rezervă” |
| Ambele surse căzute | date din cache cu „actualizat la HH:MM” |
| Eveniment fără Forecast/Actual (ex. discursuri) | coloane goale „—” |
| Actual nu a apărut încă după publicare | „în așteptare” până la +15 min, apoi „—” |
| Titluri diferite între surse („CPI m/m” vs „Inflation Rate MoM”) | potrivire pe valută + oră + dicționar de sinonime; dacă nu e sigur, nu se potrivește (mai bine fără Actual decât cu Actual greșit) |
| Mai multe evenimente la aceeași oră (CPI m/m, y/y, Core…) | fiecare se potrivește separat, după perioadă (m/m, y/y, q/q) |
| Unități diferite („20.0K” vs 20 cu scala K) | normalizate înainte de comparare |
| Holiday | afișat ca „toată ziua” pe ziua respectivă, fără oră |
| Valuta „All” (ex. IMF Meetings) | afișat „Global” |
| Ora de vară în SUA vs Europa (decalaj diferit 2–3 săptămâni/an) | orele sunt convertite din ISO cu offset, deci corecte |
| Eveniment mutat/anulat de sursă | la următorul fetch dispare/se mută; evenimentele trecute rămân în istoric |

## 5. Grafice + Slingshot System (FD-CHART)

### 5.1 Ce face
- Grafic candlestick simplu pentru monedele din watchlist (sau orice pereche de pe exchange-ul de date, implicit **KuCoin**), timeframe-uri: 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1D, 1W.
- Se actualizează automat (ultima lumânare la ~10 s pentru TF ≤ 15m, ~30 s pentru TF mai mari).
- **Indicatorul tău, Slingshot System Long 3.3**, portat 1:1 din Pine Script (3.3 = 3.2 + reparația din FD-SS33):
  - Norul EMA 38/62 (verde în uptrend, roșu în downtrend) și cele două EMA.
  - Semnale **LONG** (triunghi sub bară): verzi cât timp sunt valide sau au atins TP, **roșii** când au fost invalidate (trend întors, înlocuite de un semnal nou cât timp erau active) sau au atins SL — exact logica de culori din Pine.
  - Previzualizarea **LONG** live (cât timp setup-ul V2 se formează).
  - **TAKE PROFIT** (triunghi deasupra barei) când prețul depășește maximul de referință.
  - Liniile **TP/SL ATR** active + tabelul TAKE PROFIT / STOP LOSS (colț dreapta-jos).
  - **Market Structure**: limita superioară (verde, „Above this line we enter bullish market structure”) și inferioară (roșie, „Below this line…”), inclusiv pe un timeframe superior ales.
  - Lista **Alertelor** generate (Long Signal, Take Profit Signal, ATR TP Hit, ATR SL Hit, Bullish/Bearish Market Structure), cu ora.
  - Tabel cu **istoricul semnalelor**: ora, preț intrare (low V2), SL, TP, rezultat (Activ / TP atins / SL atins / Invalidat).
- **Setările indicatorului** sunt aceleași ca în TradingView (aceleași nume și valori implicite) și se salvează.
- Dacă ai poziții/ordine deschise pe moneda afișată (FD-TRADE), ele se pot afișa pe grafic: preț intrare, preț lichidare, ordine limit/stop.

### 5.2 Diferențe intenționate față de TradingView (și de ce)
- Prețurile din etichete/tabel se afișează cu **precizia pieței** (ex. `0.00001234`), nu cu `#.##` ca în Pine (pentru monede mici `#.##` arată `0`).
- Istoricul disponibil e cel descărcat (implicit 1500 lumânări, configurabil până la 5000). TradingView pornește calculul de la altă bară, deci primele semnale din istoric pot diferi; semnalele recente sunt identice dacă datele sunt identice (aceeași bursă, același simbol).
- Lumânarea în formare e inclusă (ca „realtime” în TradingView): semnalele de pe ea sunt marcate „neconfirmat” până la închiderea lumânării.

### 5.3 Edge cases
| Situație | Comportament |
|---|---|
| Pereche nouă, prea puține lumânări pentru încălzirea indicatorului (EMA 62, ATR 14, pivoți) | graficul apare; indicatorul afișează ce se poate; mesaj „istoric insuficient” |
| Simbolul nu există pe exchange-ul de date | eroare clară + sugestii de perechi asemănătoare |
| Timeframe-ul pentru Market Structure < timeframe-ul graficului | se folosește timeframe-ul graficului (ca în Pine) |
| Datele HTF nu se pot descărca | liniile Market Structure se ascund + avertisment (nu se inventează valori) |
| Goluri în date (mentenanță exchange) | barele se tratează secvențial, ca în TradingView |
| Exchange-ul de date nu răspunde | ultimul set de lumânări rămâne, cu „date vechi de N min” |
| Peste 500 de etichete | cele mai vechi dispar (ca `max_labels_count=500`) |
| Schimbi setările indicatorului | recalculare instantanee, fără re-descărcare |

### 5.4 Scanner pe watchlist (pe dashboard)
Pentru fiecare monedă favorită, pe timeframe-ul implicit (configurabil, ex. 1h): trend (EMA cloud sus/jos), ultimul semnal LONG (cât de vechi, starea lui), nivelurile TP/SL active, ultima ruptură de structură (bullish/bearish). Se recalculează la 5 minute. Click → deschide graficul.

## 6. Tranzacții / portofoliu (FD-TRADE)

### 6.1 Ce face
- Adaugi unul sau mai multe conturi de exchange (**KuCoin** în v1; arhitectura permite Binance, Bybit, OKX) cu API key + secret + passphrase **read-only**.
- Vezi, pe cont:
  - **Poziții futures deschise**: simbol, direcție (long/short), mărime, preț intrare, mark price, PnL nerealizat (sumă și %), preț lichidare, levier, mod marjă.
  - **Dețineri spot** (non-zero): cantitate, valoare în USDT, preț mediu de achiziție estimat din istoricul de tranzacții, PnL estimat.
  - **Ordine deschise** (limit, stop, take-profit), spot și futures.
  - **Tranzacții recente** (fills, ultimele 7 zile).
- Reîmprospătare la 30 s cât timp pagina e deschisă + buton manual.

### 6.2 Securitate
- Cheile se salvează **criptat** pe disc; după salvare nu mai sunt afișate niciodată (doar mascat `abcd…wxyz`).
- Aplicația **nu are niciun cod** care plasează sau anulează ordine.
- La „Testează conexiunea”: dacă exchange-ul raportează că cheia are drepturi de Trade sau Withdraw, apare un avertisment roșu cu recomandarea de a crea o cheie doar cu „General/Read”.

### 6.3 Edge cases
| Situație | Comportament |
|---|---|
| Cheie greșită / expirată / IP nepermis | contul arată eroarea exactă; restul aplicației merge |
| Ceas Mac decalat față de exchange | sincronizare automată a diferenței de timp |
| Cont KuCoin în mod Unified (UTA) vs clasic | detectat automat |
| Preț mediu necunoscut (deținere mai veche decât istoricul de fills) | „necunoscut” + poți introduce manual prețul mediu (salvat local) |
| Monedă fără pereche USDT (ex. dust) | valoare „—”, exclusă din total |
| Exchange în mentenanță / rate limit | ultimele date + „actualizat la HH:MM” |
| Niciun cont configurat | pagina explică pașii de creare a unei chei read-only |

## 7. Setări (FD-SET)
- **Watchlist / monede favorite**: adaugi (căutare în piețele exchange-ului), ștergi, reordonezi, aliasuri pentru detectarea în știri.
- **Fus orar** (implicit sistemul).
- **Surse de știri**: activare/dezactivare, pondere (0,5–1,5), categorie; adaugi un feed RSS propriu (cu test înainte de salvare); sursele implicite nu se pot șterge, doar dezactiva.
- **Motor de sentiment**: Local / Claude (cheie API, model), „Rescorează ultimele 48 h”, „Recalculează istoricul”.
- **Conturi de exchange** (FD-TRADE).
- **Date de piață**: exchange-ul pentru grafice (implicit KuCoin), timeframe implicit, număr de lumânări (1500/3000/5000).
- **Indicator Slingshot**: toate input-urile din Pine (aceleași valori implicite).
- **Retenție**: zile de păstrare a știrilor (implicit 90).

Validare: valori în afara intervalelor sunt respinse cu mesaj clar; nimic nu se salvează parțial.

## 8. Stare sistem (FD-HEALTH)
- Pentru fiecare sursă: ultima încercare, ultimul succes, ultima știre nouă, eroare, următoarea încercare.
- Pentru fiecare job: ultima rulare, durată, eroare, următoarea rulare.
- Motorul de sentiment: încărcat / se descarcă / indisponibil; câte știri așteaptă scor.
- Dimensiunea bazei de date.

## 9. Ce NU face v1 (candidați pentru versiuni viitoare)
- Notificări desktop / sonore (alerte indicator, reminder înainte de CPI).
- Evenimente crypto automate (unlock-uri, upgrade-uri) — doar manual în v1.
- Plasare de ordine (exclus prin design).
- Backtesting în aplicație.
- Rularea online / multi-utilizator.

---

## FD-SS33 — Slingshot System 3.3: urmărirea TP/SL nu se mai pierde (12 oct 2026)

### Problema (3.2)
După un LONG confirmat, indicatorul urmărește semnalul („waiting for TP”): linii și tabel TP/SL, eticheta TAKE PROFIT, alertele *Take Profit Signal*, *ATR Take Profit Hit*, *ATR Stop Loss Hit*. Dacă **înainte** ca semnalul să atingă TP sau SL apare un nou „deal” (K ≥ 80), iar apoi:
- trendul se întoarce, sau
- noul pullback (căutarea V2) coboară sub minimul V1,

versiunea 3.2 șterge nivelurile semnalului urmărit, dar îl lasă „urmărit”. Efecte: tabelul TP/SL arată `NaN`, liniile dispar, iar **alertele de TP/SL pentru acel semnal nu mai pot apărea**.

Măsurat pe 75.000 de lumânări KuCoin (BTC, ETH, SOL, XRP, DOGE × 15m/1h/4h): apare în toate cele 15 seturi, de 154 de ori, cu ~11.650 de bare (≈15%) în această stare. Ca urmare, 47 de alerte *ATR Stop Loss Hit* și 4 *Take Profit Signal* nu s-au declanșat.

### Comportamentul corect (3.3)
Un semnal confirmat rămâne urmărit cu nivelurile lui până când:
- atinge stop loss-ul (ca până acum), sau
- este înlocuit de un LONG nou confirmat (ca până acum).

Ciclurile noi (deal nou, căutare V2 anulată, trend întors) curăță doar starea **lor**, nu și pe a semnalului deja confirmat. Exact așa se comportă deja ramura „exit oversold” din 3.2 (`if not waitingLongTP`).

### Ce NU se schimbă
- Semnalele LONG (unde apar), culoarea etichetelor (verde/roșu) și rezultatul lor (TP atins / SL atins / invalidat) — identice în toate cele 15 seturi de test. **Backtest-ul bazat pe etichete rămâne valabil.**
- Market Structure, EMA, alertele *Long Signal* și *Market Structure*.
- Când nu e niciun semnal urmărit, comportamentul e identic (resetările nu afectau nimic vizibil).
- Rezultatul din istoric (culoarea etichetei) și urmărirea TP/SL rămân independente, ca în 3.2: un semnal marcat „invalidat” (de ex. trend întors) își poate păstra încă nivelurile TP/SL în tabel și poate declanșa alertele lor. În scanner pot apărea deci împreună „LONG …, invalidat” și niveluri TP/SL active, exact ca în TradingView.

### Ce se schimbă (vizibil)
- Tabelul TP/SL și liniile ATR nu mai devin `NaN`; arată nivelurile semnalului urmărit (au prioritate față de previzualizarea live a unui setup nou, ca în 3.2).
- Pot apărea etichete TAKE PROFIT și alertele TP/SL care înainte lipseau.

### Edge cases
| Situație | 3.2 | 3.3 |
|---|---|---|
| Semnal urmărit → deal nou → trend întors | niveluri `NaN`, fără alerte TP/SL | nivelurile rămân; alertele TP/SL funcționează |
| Semnal urmărit → deal nou → pullback sub V1 | idem | idem |
| Semnal urmărit → deal nou → LONG nou confirmat | noul semnal preia urmărirea | neschimbat |
| Semnal urmărit → SL atins | urmărirea se oprește | neschimbat |
| Nimic urmărit → trend întors / V1 încălcat | resetare | resetare (neschimbat) |
| Semnal urmărit, TP atins, `hideAtrOnTP` activ | liniile ascunse | neschimbat |

### În TradingView
Scriptul `sling-shot-system.pine` devine 3.3. Alertele existente create pe 3.2 rămân pe versiunea veche până când sunt recreate (comportament standard TradingView).

---

## FD-LAUNCH — Pornire fără Terminal (12 oct 2026)

### Problema
Ca să folosești Kryptoniq trebuie să deschizi Terminal, să intri în folder și să rulezi `npm start`, apoi să lași fereastra deschisă.

### Ce face
- **`Kryptoniq.app`** (în folderul proiectului). La dublu-click:
  - dacă serverul nu rulează, îl pornește **în fundal** (fără fereastră de Terminal) și așteaptă până răspunde;
  - deschide **http://127.0.0.1:4317** în browserul implicit.
  
  Îl poți trage în **Dock**. Ca să pornească automat la login, îl adaugi în *System Settings → General → Login Items → Open at Login*.
- **`scripts/kryptoniq.sh`**: același lucru din Terminal, plus control:
  - `start`: pornește în fundal (dacă nu rulează) și deschide browserul; cu `--no-open` nu deschide browserul;
  - `stop`: oprește serverul (închidere curată);
  - `restart`: oprește și pornește din nou; după o actualizare a codului reconstruiește interfața;
  - `status`: arată dacă rulează, pe ce port, de cât timp;
  - `open`: deschide browserul (pornește serverul dacă e nevoie);
  - `logs`: urmărește log-ul zilei;
  - `app`: (re)generează `Kryptoniq.app`.
- `npm start` / `npm run dev` funcționează în continuare ca înainte.

### Prima deschidere
Proiectul e în `~/Documents`, iar macOS poate întreba: *„Kryptoniq” would like to access files in your Documents folder* → **Allow**. Se întreabă o singură dată. Dacă ai refuzat, aplicația îți spune unde reactivezi accesul (*System Settings → Privacy & Security → Files and Folders → Kryptoniq → Documents*).

### Edge cases
| Situație | Comportament |
|---|---|
| Serverul rulează deja (pornit din aplicație, din `kryptoniq.sh` sau cu `npm start`) | nu se pornește a doua oară; se deschide doar browserul |
| Dublu-click de două ori rapid / două `start` simultane | o singură pornire; al doilea așteaptă și apoi deschide browserul |
| Portul 4317 e ocupat de alt program | mesaj clar cu numele și PID-ul programului; nu se oprește nimic străin |
| Node.js lipsește sau e mai vechi de 24 | mesaj: instalează Node 24+ (`brew install node`) |
| `node_modules` lipsește | mesaj: rulează o dată `npm install` |
| Codul interfeței s-a schimbat (sau `dist/` lipsește) | interfața se reconstruiește automat la pornire |
| Reconstruirea sau pornirea eșuează | mesaj cu ultimele linii din log; nu rămâne niciun proces pornit pe jumătate |
| Serverul nu răspunde în 90 s | mesaj „nu a pornit la timp” + unde e log-ul; procesul rămâne pornit (poate termina) |
| `Kryptoniq.app` mutat din folderul proiectului (ex. în Applications) | merge în continuare: ține minte calea proiectului |
| Proiectul mutat în alt folder | aplicația din proiect merge (se găsește singură); o copie mutată în altă parte cere `kryptoniq.sh app` |
| Accesul la Documents refuzat | mesaj cu pașii de reactivare |
| Adăugat la Login Items | la login pornește serverul și deschide browserul |
| `stop` când nu rulează | „Kryptoniq nu rulează”, fără eroare |
| `stop` pe o instanță pornită cu `npm start` în Terminal | o oprește curat (fereastra de Terminal revine la prompt) |
| Logout / oprirea Mac-ului | serverul se închide curat (baza de date închisă corect) |
| Mac adormit | serverul își continuă job-urile după trezire |

### De ce nu un serviciu pornit automat de macOS (launchd)
Un serviciu `launchd` nu are voie să citească `~/Documents` decât dacă primește **Full Disk Access** (permisiune pentru tot discul, acordată manual binarului `node`, care se pierde la fiecare upgrade Homebrew). E o permisiune prea largă pentru un beneficiu mic. Login Items + `Kryptoniq.app` dau același rezultat, cu permisiunea minimă (doar Documents, doar pentru Kryptoniq).

---

## FD-REDESIGN — Redesign „Cockpit” (12 oct 2026)

### Cum s-a ales direcția
O primă variantă păstra structura veche (meniu în stânga, panouri unul sub altul) și schimba doar culorile. Ai respins-o („redesign, nu o pată de culoare”). Pe canvas-ul Claude Design „Kryptoniq Redesign” au urmat trei direcții diferite ca structură: **Cockpit**, Briefing editorial și Ceasul zilei. Ai ales **Cockpit**. Celelalte două rămân pe canvas, pe pagina „Alternative”.

### Ideea
Un terminal de trading modern. Pagina *Azi* încape **pe un singur ecran**, fără derulare, la 1440 × 900. Totul e organizat în tile-uri de mărimi diferite, după importanță. Celelalte pagini folosesc același limbaj vizual.

### Ce se schimbă (vizibil)
| Zonă | Înainte | Cockpit |
|---|---|---|
| Navigare | bară laterală cu iconițe | **meniu orizontal sus** (Azi, Știri, Calendar, Grafice, Tranzacții, Setări, Stare sistem), logo în stânga, căutare ⌘K și ceasurile în dreapta |
| Piața acum | doar pe *Azi* (context) | **bandă de prețuri** sub meniu, pe toate paginile: monedele favorite (preț, 24h, grafic mic pe 48 h), Fear & Greed, capitalizare, dominanță BTC, evenimentul următor cu numărătoare |
| Căutare | — | **⌘K / Ctrl+K**: sari la o pagină, la graficul unei monede (din favorite sau orice pereche de pe exchange) sau caută în știri |
| *Azi* | panouri unul sub altul | tile-uri: sentiment (cifră mare, spectru 0–100, ziua pe ore, categorii, pozitive/neutre/negative), eveniment următor (numărătoare + evenimentele de azi), știri live, monedele tale (preț, 24h, grafic 48 h, trend, ultimul semnal, TP/SL, structură), ce mișcă piața, ultimele 30 de zile |
| Știri | coloană de filtre + listă | filtre ca bară orizontală deasupra listei (interval, categorie și sentiment ca butoane, sursa, monedele, căutarea); rânduri compacte cu ora, sursa, titlul și scorul |
| Calendar | tabel pe zile | **săptămâna pe coloane**, câte o zi pe coloană, cu evenimentele ca fișe (ora, valuta, impact, Actual / Prognoză / Anterior); un click pe fișă arată explicația evenimentului și abaterea față de așteptări; filtrele de impact și valute stau într-un singur rând |
| Grafice | antet + grafic + tabele | graficul cât mai mare, cu bara de unelte deasupra; semnalele și alertele în tile-uri dedesubt |
| Tranzacții, Setări, Stare sistem | panouri | tile-uri în același stil |
| Tipografie | Archivo | **Geist** pentru text, **Geist Mono** pentru prețuri, ore, scoruri și numărători (cifrele stau aliniate) |
| Culori | bleumarin | negru adânc `#07090E`, tile-uri `#0D1118`, alama Kryptoniq pentru accent; verde și roșu doar pentru sus/jos |

### Ce NU se schimbă
- Datele, calculele (sentimentul zilei, indicatorul Slingshot), filtrele, setările și persistența lor, rutele.
- Culorile indicatorului din grafic (setabile, ca în TradingView).
- Funcționarea locală: fonturile sunt incluse în aplicație, fără CDN.
- Accesibilitatea: contrast cel puțin 4,5:1 pentru text, focus vizibil, navigare cu tastatura (inclusiv în căutarea ⌘K), etichete pentru cititoare de ecran, „reduce motion” respectat.

### Edge cases
| Situație | Comportament |
|---|---|
| Ecran mai mic de 1440 × 900 | tile-urile se reașază pe mai puține coloane și pagina *Azi* derulează (nimic nu se taie) |
| Telefon (390 px) | o singură coloană; meniul și banda de prețuri derulează orizontal; nicio depășire a paginii |
| Mai multe monede favorite (ex. 8) | banda de prețuri derulează orizontal; pe *Azi* fișele monedelor trec pe rândul următor |
| Nicio monedă favorită | banda arată doar contextul pieței; pe *Azi*, tile-ul monedelor invită la adăugare (Setări) |
| Lumânările pentru graficul mic nu se încarcă | fișa monedei apare fără grafic, restul datelor rămâne |
| Niciun eveniment major în 8 zile | tile-ul evenimentului spune asta și trimite la Calendar |
| Zi fără știri analizate | spectrul fără marcaj, mesajul existent |
| Căutare ⌘K fără rezultate | „Niciun rezultat”, plus opțiunea „Caută în știri” |
| ⌘K pe Windows/Linux | Ctrl+K; butonul din meniu arată scurtătura potrivită |
| Server oprit | banner-ul existent, cu instrucțiunea actualizată (`Kryptoniq.app` sau `scripts/kryptoniq.sh start`) |

---

## FD-STATIC — Pagină neagră în Safari după actualizarea interfeței (reparație, 12 oct 2026)

### Ce s-a întâmplat
Aplicația a rămas pornită în timp ce interfața a fost reconstruită (redesign-ul). Când a fost deschisă apoi în Safari, s-a văzut o pagină neagră. În Chrome și într-o fereastră privată Safari mergea. A revenit după o reîncărcare fără cache (⌥⌘R).

### Comportamentul corect
- O interfață reconstruită se vede imediat, chiar dacă serverul nu a fost repornit.
- Browserul nu poate rămâne cu o versiune veche a paginii: pagina principală nu se păstrează în cache, deci se cere mereu de la server.
- Un fișier care nu mai există (de exemplu JavaScript-ul unei versiuni vechi) primește „negăsit”, nu pagina aplicației. Astfel browserul nu tratează HTML-ul drept cod.

### Edge cases
| Situație | Comportament |
|---|---|
| Interfața e reconstruită cât rulează serverul | următoarea încărcare a paginii folosește noua versiune |
| O filă veche (deschisă înainte de actualizare) cere o pagină încărcată la cerere (ex. Știri) | fișierul vechi lipsește → eroarea apare în pagină (ErrorBoundary); o reîncărcare normală rezolvă |
| Adrese de pagini (`/news`, `/charts/BTC/USDT`) | pagina aplicației, ca până acum |
| Adresă inexistentă sub `/api/` | eroare JSON 404, ca până acum |

---

## FD-ICONS — Iconițe relevante, bandă cu derulare automată, cursor, data în Știri (12 oct 2026)

### Ce cere utilizatorul
1. Banda de tickere să **deruleze singură**.
2. Tot ce se poate apăsa (butoane, link-uri, filtre) să arate **cursorul de mână**.
3. În *Știri*, la filtrul „Ieri” (sau 7 zile), **data intra peste titlu**.
4. **Iconițe relevante pentru toate elementele**, peste tot în aplicație.

### Comportament
**Banda de tickere**
- Derulează continuu spre stânga (aprox. 40 px/s), în buclă, fără salt la reluare.
- Se oprește cât timp ai cursorul pe ea sau focusul de tastatură e în ea. Poți apăsa liniștit pe o monedă sau pe eveniment.
- Cu „Reduce motion” activ în macOS nu se mișcă; derulează manual, ca înainte.
- Cititoarele de ecran citesc conținutul o singură dată (copia folosită pentru buclă e ascunsă pentru ele și nu primește focus).

**Cursor**: butoanele, link-urile, filtrele, căsuțele, selectoarele, opțiunile din căutarea ⌘K și „De ce acest scor?” au cursorul de mână. Elementele dezactivate păstrează cursorul normal.

**Data în Știri**: o știre din altă zi decât azi arată data pe un rând (ex. „12 oct.”) și ora sub ea, într-o coloană destul de lată. Nimic nu mai trece peste titlu.

**Iconițe**
| Unde | Iconița |
|---|---|
| Știri (pagina Știri, „Știri live”, „Ce mișcă piața”) | după subiect, din titlu și rezumat: bănci centrale și dobânzi, inflație, joburi, PIB și economie, petrol și energie, aur, acțiuni și rezultate, obligațiuni și randamente, dolar și valute, război și conflict, politică și tarife, reglementare și justiție, hack și fraudă, ETF și fonduri, stablecoin, DeFi și rețele, AI și tehnologie. Dacă știrea e despre o monedă anume, apare **logo-ul monedei**. Altfel, iconița categoriei (crypto / macro / geopolitică) |
| Monede (banda, fișele de pe Azi, Grafice, filtrele din Știri, etichetele de monede, Setări, Tranzacții, căutarea ⌘K) | **logo-ul real** al monedei. Pentru o monedă fără logo cunoscut, o insignă cu inițiala, într-o culoare stabilă pe monedă |
| Evenimente din calendar (Calendar, tile-ul de pe Azi) | după tip: inflație, piața muncii, PIB, vânzări, producție/PMI, bancă centrală (discurs, decizie), imobiliare, încredere, balanță comercială, sărbătoare, eveniment personal |
| Alerte Slingshot (Grafice) | Long Signal, Take Profit, ATR TP, ATR SL, structură bullish / bearish, fiecare cu iconița ei |
| Rezultatele semnalelor | TP atins, SL atins, invalidat, activ |
| Meniul de sus | câte o iconiță pe pagină |
| Titlurile tile-urilor și secțiunilor | o iconiță mică lângă titlu (Azi, Grafice, Setări, Stare sistem, Tranzacții) |

Iconițele sunt decorative pentru cititoarele de ecran (textul spune deja totul), cu excepția celor care înlocuiesc text.

### Edge cases
| Situație | Comportament |
|---|---|
| Știre care se potrivește cu mai multe subiecte | câștigă prima regulă din lista de priorități (ex. „Fed” înaintea „inflației”) |
| Știre despre o monedă fără logo | insigna cu inițiala |
| Logo-ul nu se poate încărca | insigna cu inițiala, fără reîncercări repetate |
| Monedă nouă adăugată în favorite | logo-ul apare automat, dacă există în colecție |
| Ecran îngust | iconițele se micșorează; nu creează depășiri |

---

## FD-RATELIMIT — „Prețuri: eroare de la exchange (429000 … System-level rate limit exceeded)” (reparație, 12 oct 2026)

### Ce s-a întâmplat
Pe pagina Tranzacții, secțiunea de prețuri a afișat: `Prețuri: eroare de la exchange (kucoin {"code":"429000","msg":"Too many requests. System-level rate limit exceeded."})`. Jurnalul arată o singură încărcare a portofoliului (20:02), deci nu aplicația a trimis prea multe cereri.

### Ce înseamnă eroarea
- KuCoin are două feluri de limită care întorc același cod `429000`:
  - **limita contului / a IP-ului**: cota de cereri pe 30 s (pentru prețurile publice 2000 de „puncte” la 30 s pe IP; lista tuturor prețurilor costă 15);
  - **limita de sistem**: KuCoin e temporar supraîncărcat și refuză cereri, indiferent de cota ta. Documentația recomandă reîncercarea mai târziu.
- Mesajul „System-level” e al doilea caz. Aplicația folosea sub 2% din cotă.
- Aplicația nu recunoștea codul `429000` ca „limită de cereri”. Îl trata ca o eroare oarecare, nu reîncerca și lăsa dețineri fără preț, deci valoarea totală era greșită.

### Comportamentul corect
1. **Limita e recunoscută** ca „limită de cereri” (ambele variante), iar mesajul e clar, în română: exchange-ul limitează temporar cererile și aplicația reîncearcă automat. Textul brut al exchange-ului nu mai apare în pagină; rămâne în tooltip și în jurnal.
2. **Reîncercare scurtă**: o citire refuzată temporar (limită de cereri sau eroare de rețea trecătoare) se reîncearcă de 2 ori, după aproximativ 1,5 s și 4 s. Citirile care au expirat (timeout) sau mentenanța nu se reîncearcă imediat; le reia reîmprospătarea următoare (30 s).
3. **Prețurile nu mai lipsesc** când lista completă de prețuri e refuzată:
   - întâi se cer, separat, prețurile doar pentru monedele deținute (o cerere ușoară pe monedă, cel mult 30);
   - pentru ce nu se poate afla așa, se folosesc ultimele prețuri bune (cel mult 1 oră vechime), iar pagina spune ora lor;
   - numai dacă nu există nici asta, deținerea rămâne fără preț („—”) și e exclusă din total, ca până acum.
4. **Mai puține cereri grele**: lista completă de prețuri se ține minte 15 s și e folosită în comun de toate conturile. După un refuz, nu se mai cere un minut; între timp se folosesc prețurile individuale.
5. **Graficele și banda de prețuri**: citirea lumânărilor și a listei de piețe primește aceeași reîncercare scurtă. Dacă tot eșuează, se arată ultimele lumânări bune (ca până acum); dacă nu există, mesajul spune clar că e o limită temporară.
6. **Problemă ascunsă găsită la investigație**: dacă lista de piețe a exchange-ului nu se putea încărca o dată (de exemplu exact la o asemenea limită), graficele, banda de prețuri și scannerul rămâneau cu eroarea **până la repornirea aplicației**. Contul de exchange rămânea blocat până la 10 minute. Acum lista se cere din nou la următoarea folosire.
7. **Încărcarea listei de piețe KuCoin nu mai descarcă lista completă de prețuri.** Biblioteca o cerea doar pentru comisioane, pe care aplicația nu le folosește. Astfel graficele și conturile nu mai depind de endpoint-ul care a fost supraîncărcat.

### Edge cases
| Situație | Comportament |
|---|---|
| Limită de sistem trecătoare (câteva secunde) | reîncercarea o depășește; nu apare nicio eroare |
| Lista completă refuzată, prețurile individuale merg | prețuri actuale, fără avertisment (doar în jurnal) |
| Lista completă refuzată, unele prețuri individuale lipsesc | acele monede primesc ultimul preț bun (≤ 1 h); avertisment „Prețuri: … se afișează datele din HH:MM” |
| Imediat după pornirea aplicației (nu există prețuri anterioare) și totul e refuzat | fără preț pentru monedele afectate, avertisment clar; reîmprospătarea de la 30 s reia |
| Lista de piețe nu e încărcată (exchange-ul refuză tot) | nu se pot cere prețuri individuale; se folosesc ultimele prețuri bune, dacă există |
| Peste 30 de monede deținute | primele 30 primesc preț individual; restul folosesc ultimele prețuri bune |
| Lista de prețuri vine goală | tratată ca eroare (nu șterge prețurile bune) |
| Două conturi pe același exchange | aceeași listă de prețuri, o singură cerere |
| Limita contului (cota pe 30 s) e atinsă | reîncercările nu o agravează (2 cereri în plus); secțiunea rămâne cu ultimele date bune până la reîmprospătarea următoare |
| Cheie greșită, permisiuni, mentenanță | neschimbat: nu se reîncearcă, mesajul explică cauza |
| „Testează conexiunea” lovește limita | se reîncearcă la fel; dacă tot eșuează, contul arată „limită de cereri” |
| Lista de piețe nu s-a putut încărca la pornire | graficele / banda / scannerul o cer din nou la următoarea reîmprospătare (nu mai e nevoie de repornire) |

---

## FD-CHARTUX — Grafice: fără grilă, fără liniile cursorului, setări ținute minte, indicatorul LMA, ecran complet (12 oct 2026)

### Cererea
„in grafice vreau sa elimini grid layoutul de pe chart. si elimina liniile punctate de sub cursor. si sa tii minte orice setare a graficelor. daca plec de pe grafice si revin vreau sa ramana setarile. si pune pe chart si acest indicator: …/Logarithmic Moving Average. in partea de jos. iar graficul trebuie sa aiba buton de full screen si sa-l arati pe full screen. sa pui buton de exit full screen si suport pentru tasta esc pentru a iesi din full screen.”

### 1. Grafic fără grilă și fără liniile cursorului
- Graficul nu mai desenează liniile de grilă (orizontale și verticale), nici în panoul principal, nici în panoul LMA.
- Sub cursor nu mai apar liniile punctate (orizontală și verticală). Rămân etichetele de pe axe: prețul (sau valoarea LMA) pe axa din dreapta și data/ora pe axa de jos, ca să poți citi în continuare unde ești.
- Liniile care fac parte din indicatori rămân așa cum le desenează TradingView: pragurile LMA (întrerupte), nivelurile ATR și Market Structure ale Slingshot. Rămân și liniile pozițiilor tale.

### 2. Setările graficelor sunt ținute minte
Tot ce alegi pe pagina Grafice rămâne la fel când pleci și revii, după o reîncărcare a paginii, după repornirea aplicației și în alt browser (Safari / Chrome). Excepție face zoom-ul, ținut minte în browserul curent.

| Setare | Unde se reține |
|---|---|
| Perechea afișată (ex. SOL/USDT) | server; „Grafice” din meniu sau ⌘K deschide ultima pereche |
| Timeframe-ul | server; e aceeași setare cu „Timeframe grafice” din Setări |
| „Pozițiile mele” afișate / ascunse | server |
| LMA afișat / ascuns | server |
| Înălțimea panoului LMA (dacă o tragi de separator) | server |
| Setările Slingshot | server (ca până acum) |
| Setările LMA | server |
| Zoom-ul și poziția pe istoric, per pereche și timeframe | browserul curent (cele mai recente 60 de combinații) |
| Exchange-ul de date și numărul de lumânări | server (în Setări, ca până acum) |

- O pereche se reține doar după ce graficul ei s-a încărcat cu succes. O adresă greșită (ex. `/charts/XYZ/USDT`) nu înlocuiește ultima pereche bună.
- Zoom-ul: revii la aceeași distanță între lumânări și la aceeași poziție față de ultima lumânare. Dacă erai lipit de marginea din dreapta, rămâi lipit și cu lumânările noi.

### 3. Indicatorul [DI] Logarithmic Moving Average (LMA), în panoul de jos
Port 1:1 din `logarithmic-moving-average.pine` (Pine v6, © Dusty Investments), cu aceleași nume, grupuri și valori implicite ca în TradingView.
- **Panou separat sub grafic**, cam un sfert din înălțime. Separatorul se poate trage, iar înălțimea se ține minte.
- **Desenul** e cel din Pine:
  - linia „LMA Signal” (groasă), colorată în gradient: verde peste pragul long, roșu sub pragul short, galben (neutru) la 0, cu nuanțe intermediare între 0 și praguri;
  - umplere în gradient între linie și 0;
  - pragurile long / short, cu linii întrerupte;
  - linia 0, gri, continuă;
  - eticheta de stare (BULLISH / BEARISH / NEUTRAL) în dreapta ultimei bare.
- **„Color Price Bars”** (implicit activ, ca în Pine): lumânările din graficul principal se colorează după semnalul LMA. Se poate dezactiva din setările LMA. Când LMA e ascuns, lumânările revin la verde / roșu.
- **Legenda panoului** (stânga-sus): numele, parametrii efectivi, valoarea și starea. Arată barei de sub cursor, altfel ultima bară. Are butoane pentru setări și pentru ascundere.
- **Setări** (sertarul „Indicatori”, fila LMA), cu numele și limitele din Pine:
  - Strategy Preset: Default / Scalping / Swing Trading / Trend Following / Mean Reversion / Custom;
  - LMA Period (50–200), Log Steepness (1.5–5.0), Smoothing MA Type (EMA, SMA, WMA, RMA, VWMA), Signal Smoothing (3–25), Momentum Confirmation Weight (1.0–2.0);
  - Long Entry Threshold (0.1–2.0), Short Entry Threshold (−2.0 – −0.1);
  - culorile Bullish / Bearish / Neutral și Color Price Bars.
- **Preseturile** se comportă ca în Pine. Scalping, Swing Trading, Trend Following și Mean Reversion impun perioada, panta, netezirea și pragurile; aceste câmpuri apar blocate, cu valorile presetului. „Default” și „Custom” folosesc valorile introduse de tine.

### 4. Ecran complet
- Butonul **„Ecran complet”** din bara graficului afișează graficul pe tot ecranul (modul ecran complet al sistemului). Rămân vizibile bara graficului (pereche, preț, timeframe, comutatoare, indicatori) și graficul cu panoul LMA, întins pe tot spațiul.
- În ecran complet, același loc are butonul **„Ieși din ecran complet”**, cu indicația `Esc`.
- **Esc** iese din ecran complet. Dacă e deschis sertarul de setări, primul Esc închide sertarul, al doilea iese din ecran complet. În modul ecran complet al sistemului, browserul poate ieși direct, la primul Esc.
- Dacă browserul nu permite ecranul complet al sistemului (de exemplu iPhone), graficul acoperă toată fereastra aplicației, cu același buton de ieșire și același Esc.
- **⌘K** iese întâi din ecran complet, apoi deschide căutarea (altfel căutarea ar rămâne ascunsă sub grafic).
- Zoom-ul și poziția pe grafic se păstrează la intrare și la ieșire. Ecranul complet nu e o setare și nu se ține minte.

### 5. Conflicte cu funcțiile existente
| Funcție | Rezolvare |
|---|---|
| Tabelul TAKE PROFIT / STOP LOSS al Slingshot (dreapta-jos) | rămâne în colțul de jos al panoului principal, deasupra panoului LMA, ca în TradingView |
| Timeframe implicit din Setări | devine „Timeframe grafice” și e chiar timeframe-ul ales pe grafic (o singură setare) |
| Scanner, banda de prețuri, cardurile Azi | neschimbate (LMA e doar pe grafic) |
| Alertele LMA din Pine (`alertcondition`) | nu se generează în această versiune; lista „Alerte” rămâne a Slingshot |
| Pozițiile mele (linii de preț) | neschimbate, în panoul principal |
| Căutarea ⌘K, meniul, banda de prețuri | ascunse în ecran complet; ⌘K iese din ecran complet |

### 6. Edge cases
| Situație | Comportament |
|---|---|
| Începutul istoricului încărcat | linia apare după primele `Signal Smoothing` bare, ca în TradingView. Cam primele `LMA Period` + 10 bare sunt de încălzire: Pine împarte la suma tuturor greutăților, deci valorile de acolo sunt exagerate. Graficul se deschide pe ultimele bare, unde LMA e complet |
| Prețuri constante pe toată fereastra (pereche fără tranzacții) | panta 0, R² 0, semnal 0, stare NEUTRAL (fără erori numerice) |
| VWMA pe bare cu volum 0 | valoarea e na pe acele bare (ca în Pine): linia are goluri |
| Schimbi presetul | recalculare instantanee; câmpurile impuse arată valorile presetului |
| Valoare în afara limitelor (ex. perioadă 300) | salvarea e refuzată cu un mesaj clar; graficul folosește în continuare setările salvate |
| Ascunzi LMA | panoul dispare, graficul principal ia toată înălțimea, lumânările revin la culorile normale |
| Pereche reținută care nu mai există pe exchange | eroarea obișnuită cu sugestii; alegi alta și se reține aceea |
| Două file deschise | ultima schimbare câștigă; cealaltă filă se actualizează la reîncărcarea setărilor |
| Ieși din ecran complet din meniul browserului / gestul macOS | aplicația observă și revine la afișarea normală |
| Ferestră îngustă / telefon | butoanele se rup pe rânduri; butonul de ecran complet rămâne vizibil |

### 7. Addendum: setările LMA ca în TradingView (capturile din 12 oct 2026)
Utilizatorul a trimis capturi din setările indicatorului în TradingView: fila **Style** („LMA Signal Bar Colors”, „Long Threshold”, „Short Threshold”, „Neutral Line”, fiecare cu bifă, stil de linie și valoare) și grupul **Visual Settings** (cele trei culori pe un rând, „Color Price Bars” cu (i)). Fila LMA din sertarul „Indicatori” devine la fel:
- **Visual Settings**: Bullish / Bearish / Neutral Color pe un singur rând (ca `inline="colors"` din Pine). „Color Price Bars” are bifa în stânga și (i) cu explicația din Pine.
- **Grup nou „Style”** (setările de afișare pe care TradingView le pune în fila Style):

| Rând | Ce face | Implicit |
|---|---|---|
| LMA Signal | afișează linia; grosime 1–4 | afișat, grosime 3 |
| LMA Signal Fill | afișează umplerea în gradient | afișat |
| LMA Signal Bar Colors | afișează colorarea lumânărilor (doar dacă „Color Price Bars” e bifat; ca în TV, ambele trebuie active) | afișat |
| Long Threshold | bifă + stil (continuu / întrerupt / punctat); culoarea și valoarea vin din setări (Bullish Color, Long Entry Threshold), afișate lângă | afișat, întrerupt |
| Short Threshold | la fel, cu Bearish Color și Short Entry Threshold | afișat, întrerupt |
| Neutral Line | linia 0, gri | afișat, continuu |

- Toate setările cu tooltip în Pine au (i), cu același text. Bifele sunt în stânga etichetei, ca în TradingView, la ambii indicatori.
- O linie ascunsă (prag sau 0) nu mai lărgește scala panoului.
- Când linia LMA e ascunsă, legenda, eticheta de stare și pragurile rămân; dispar linia și eticheta ei de pe scală.

### 8. Addendum: LONG și TAKE PROFIT ca triunghiuri (13 oct 2026)
Cererea: „in loc de sageata pentru long si take profit foloseste tringhiul. asa e si in indicatorul original”.
- **LONG**: triunghi plin cu vârful în sus, sub bară, cu textul „LONG” dedesubt.
- **TAKE PROFIT**: triunghi plin cu vârful în jos, deasupra barei, cu textul „TAKE PROFIT” deasupra.
- Mărimea e cea din Pine (`size.small`), iar culoarea e a semnalului (verde când e valid sau a atins TP, roșu când e invalidat sau a atins SL), ca până acum.
- FD §5.1 descria deja triunghiul; săgețile erau o abatere a implementării.

---

## FD-PNL — PnL pe grafic la stop loss, take profit și prețul curent (13 oct 2026)

### Cererea
„pe chart poti afisa pln pentru stop loss, take profit si current price, pentru tradeul activ?” La întrebarea de clarificare, utilizatorul a ales: **poziția mea reală de pe KuCoin**, cu **stop loss și take profit din ordinele mele de pe KuCoin**.

### Ce face
Când „Pozițiile mele” e bifat și ai un trade deschis pe moneda din grafic, liniile poziției arată și PnL-ul:

| Linie | Text | Culoare |
|---|---|---|
| Intrarea | „Intrare LONG 0,05 BTC” (sau SHORT) | auriu, continuă (ca acum) |
| Stop loss (ordinul tău) | „SL −11,40 USDT (−3,0%)” | roșie, întreruptă |
| Take profit (ordinul tău) | „TP +31,45 USDT (+8,2%)” | verde, întreruptă |
| Prețul curent | „PnL +6,17 USDT (+1,6%)” lângă ultimul preț | verde dacă e profit, roșu dacă e pierdere |

- **Trade-ul activ**:
  - poziția futures deschisă pe moneda graficului (long sau short; mărimea în monedă = contracte × mărimea contractului);
  - dacă nu există poziție futures, deținerea spot cu preț mediu cunoscut (din istoric sau setat manual în Tranzacții).
  - Dacă le ai pe amândouă, se afișează amândouă; etichetele spun „futures” / „spot”.
- **Care ordine sunt SL / TP** (doar ordinele care închid trade-ul: sell pentru long și spot, buy pentru short):
  - ordin stop care se declanșează la **scădere** (long / spot) sau la **creștere** (short) → **SL**;
  - ordin stop care se declanșează în direcția profitului, sau ordin limit → **TP**;
  - dacă exchange-ul nu spune direcția, decide poziția declanșatorului față de prețul curent.
- **Calcul:**
  - PnL = (preț − intrare) × cantitate pentru long și spot; (intrare − preț) × cantitate pentru short;
  - procentul e mișcarea prețului față de intrare (fără levier);
  - pentru un ordin care închide doar o parte, cantitatea e cea a ordinului (cel mult cât are poziția);
  - fără comisioane și fără funding (estimare).
- **Prețul curent** e ultimul preț din grafic (se actualizează la 10–30 s). KuCoin calculează PnL-ul nerealizat cu prețul „mark”, deci pot exista mici diferențe.
- Ordinele care nu închid trade-ul (de exemplu un buy limit sub preț pe o poziție long) rămân ca acum, linii albastre cu tipul ordinului.

### Edge cases
| Situație | Comportament |
|---|---|
| Fără cont KuCoin sau fără trade pe moneda graficului | nimic nou (ca până acum) |
| Trade fără ordine SL / TP | doar intrarea și PnL-ul la prețul curent |
| Mai multe ordine TP (închideri parțiale) | câte o linie pentru fiecare, cu PnL-ul cantității lui |
| Preț mediu spot necunoscut | fără PnL spot (se poate seta manual în Tranzacții) |
| Graficul e pe altă cotare (ex. BTC/USDC) decât poziția (BTC/USDT:USDT) | PnL-ul folosește prețul graficului, aproape identic; liniile se afișează la fel ca acum (după monedă) |
| Portofoliul nu se poate citi (limită, rețea) | ultimele date bune, ca până acum; PnL-ul se calculează cu ele |
| „Pozițiile mele” debifat | nicio linie de poziție și niciun PnL |
| Mai multe conturi KuCoin cu trade pe aceeași monedă | câte un set de linii pe cont, cu numele contului în etichete |
| Rest mic de monedă în spot (valoare sub 1 USDT) | nu e tratat ca trade: nicio linie |
