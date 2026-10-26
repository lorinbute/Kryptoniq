# Sentiq — Functional Design

> Document viu, în două părți:
> - **Partea I — Sentiq azi**: ce face aplicația acum, pagină cu pagină, cu regulile și cazurile limită care sunt în vigoare. Aceasta e referința.
> - **Partea a II-a — Istoricul deciziilor**: secțiunile FD-… scrise înaintea fiecărei schimbări (datate), cu cererea utilizatorului, cazurile limită și conflictele de atunci. O secțiune mai nouă poate înlocui o parte dintr-una mai veche; Partea I spune ce e valabil.
>
> Sentiq se numea **Kryptoniq** până pe 13 oct 2026 (FD-SENTIQ §1). Cercetarea pe care se bazează deciziile: [research.md](research.md). Implementarea: [technical-design.md](technical-design.md). Ghidul pentru utilizator: [user-guide.md](user-guide.md).

# Partea I — Sentiq azi

> Numerotarea §0–§9 e cea din v1 (codul și secțiunile mai vechi trimit la ea); subiectele apărute după v1 sunt §10–§14.

## 0. Scop și principii

Sentiq (de la *sentiment* + *IQ*) este un **asistent de day-trading** pentru crypto și acțiunile americane. Adună într-un singur loc ce se întâmplă în piață (știri crypto, acțiuni, macro, geopolitică), calculează **sentimentul zilei**, arată **calendarul economic** (cu rezultatele companiilor), **indicatorii economici pe țări**, **grafice cu indicatorii Slingshot System și LMA și cu oricare dintre cei 117 indicatori standard TradingView** și **portofoliile** de la exchange-uri crypto și brokeri. Opțional, Claude scrie **rezumatul zilei**.

Principii:
1. **Datele stau în Azure SQL Database** (FD-AZURE). Aplicația rulează online pe Azure App Service, la **https://sentiq.money** (pași în [deploy-azure.md](deploy-azure.md)), și pe Mac, pe aceeași bază. Fiecare persoană are **contul ei** (parolă, 2FA, passkey); conturile se dau doar la cerere, aprobate de admin.
2. **Informează; tranzacționează doar la cerere** (FD-TRADING). Implicit doar citește. Ordinele pleacă numai de pe conturile unde utilizatorul a pornit tranzacționarea (cu parola și 2FA), după o confirmare a fiecărui ordin. Nu mută niciodată fonduri (fără retrageri sau transferuri).
3. **Transparentă.** Fiecare cifră (sentimentul zilei, scorul unei știri, culoarea unui indicator) poate fi „deschisă” ca să vezi de unde vine.
4. **Robustă.** O sursă căzută nu strică restul. Ultimele date bune rămân vizibile, cu ora lor.
5. **Ușor de citit.** Temă întunecată (implicită) și temă luminoasă, contrast de cel puțin 4,5:1 pentru orice text, interfață în română, termeni de trading în engleză (LONG, TAKE PROFIT, CPI…).

### 0.1 Fus orar și „ziua”
- „Ziua” înseamnă ziua calendaristică în **fusul orar al utilizatorului** (implicit cel al sistemului, de ex. `Europe/Bucharest`), configurabil din Setări, pentru fiecare cont.
- Trecerile la ora de vară / iarnă (zile de 23 h sau 25 h) sunt tratate corect: ziua e intervalul [00:00, 00:00 a zilei următoare) în fusul ales.
- Orele evenimentelor se afișează în fusul utilizatorului; bara de sus arată și ora New York.

### 0.2 Pornire
- `npm start`, `scripts/sentiq.sh start` sau dublu-click pe `Sentiq.app` (FD-LAUNCH) → `http://localhost:4317`, plus adresa Mac-ului în rețeaua locală.
- Conexiunea la bază: `data/database.env` (sau setările App Service), FD-AZURE §1. Fără ea Sentiq nu pornește și spune ce lipsește; `scripts/sentiq.sh db-check` verifică legătura.
- La prima pornire pe o bază nouă: se creează tabelele, sursele implicite și favoritele implicite (BTC, ETH, SOL), se descarcă modelul de sentiment (~170 MB, o singură dată; până atunci, doar regulile de domeniu, marcat în UI). Contul de admin există din start; parola lui se pune la prima deschidere **de pe Mac**. Datele de dinainte (fișierul SQLite) se mută o singură dată cu `scripts/sentiq.sh import-sqlite` (FD-AZURE §3).
- După o oprire, la repornire se recuperează știrile publicate între timp (cât sunt încă în feed-uri), se închid zilele rămase deschise și se actualizează calendarul.
- Cheia master de dinainte de redenumire rămâne (`data/master.key`, pe Azure `SENTIQ_MASTER_KEY`), iar variabilele `KRYPTONIQ_*` merg mai departe. Fișierul `data/kryptoniq.db` rămâne doar ca sursă a importului. Vechiul `Kryptoniq.app` și `scripts/kryptoniq.sh` nu mai există în proiect.

## 1. Navigare și layout (FD-REDESIGN, FD-ICONS, FD-THEME2)
- **Bara de sus:** logo-ul, meniul (**Azi · Știri · Calendar · Economie · Grafice · Tranzacții · Setări**, plus **Stare sistem** pentru admin), „Rezumat” (doar pe Azi), căutarea **⌘K**, ceasurile (local și New York) cu starea serverului, comutatorul de temă și meniul contului (Securitate, Utilizatori pentru admin, Ieși din cont). Setări are, pentru admin, două file: „Ale mele” și „Admin” (FD-ADMINSET). Pe telefon meniul derulează orizontal, iar comutatorul de temă e în meniul contului.
- **Banda pieței** (sub bară, pe orice pagină, derulează singură și se oprește sub cursor): favoritele (monede: preț, variația pe 24 h, grafic pe 48 h; acțiuni: preț, variația zilei, grafic pe 60 de zile), evenimentul major următor cu numărătoare, Fear & Greed crypto, capitalizarea pieței și dominanța BTC, starea bursei americane, S&P 500, Nasdaq 100, VIX și Fear & Greed pentru acțiuni.
- **⌘K / Ctrl K:** pagini, monede (favorite sau orice pereche), acțiuni, „Caută în știri”; fără diacritice obligatorii.
- **Teme:** întunecată (implicită, accent auriu) și luminoasă „Navy” (bară și bandă bleumarin, plăci albe, accent turcoaz). Alegerea se ține în browser, se aplică înainte de primul desen și se sincronizează între taburi. Pe ambele teme: graficul pe suprafața lui, rânduri alternate în tabele și liste, hover evident (doar unde există cursor).
- Stările „se încarcă”, „gol” și „eroare” sunt tratate pe fiecare pagină. Fără ecrane albe: o eroare neașteptată arată un mesaj în română cu „Reîncarcă pagina”; după o actualizare a aplicației, pagina se reîncarcă singură (FD-STALE). Când serverul nu răspunde apare un banner.

## 2. Știri (FD-NEWS)

### 2.1 Ce face
- Colectează știri din surse RSS gratuite, în 4 categorii: **Crypto**, **Acțiuni**, **Macro / Piețe**, **Geopolitică** (31 de surse implicite, research §1 și §8). Pentru fiecare acțiune din favoritele cuiva se adaugă automat feed-ul ei de la Nasdaq; feed-ul se șterge (cu știrile venite doar prin el) imediat ce acțiunea nu mai e în favoritele nimănui (FD-AUTOFEED).
- Fiecare știre are: titlu, sursă, oră, rezumat (text simplu), link, categorie, **monedele și acțiunile detectate**, **sentiment** (−1…+1, Pozitiv / Neutru / Negativ), relevanță și importanță.
- Lista e în ordine cronologică inversă, se reîmprospătează la ~1 minut; știrile noi sunt marcate „nou”; știrile din altă zi arată și data. „De ce acest scor?” arată motorul, scorul modelului, regulile aplicate și importanța cu care știrea intră în sentimentul zilei.

### 2.2 Filtre (afectează DOAR ce vezi)
- Interval (ultimele 24 h implicit; azi; ieri; 7 zile), categorie, sentiment (pozitiv / neutru / negativ / în analiză), sursă, favoritele tale (una sau mai multe, sau „doar favorite”), căutare în titluri și rezumate.
- **Regula de aur:** filtrele nu schimbă niciodată sentimentul zilei, care se calculează mereu pe **toate** știrile relevante (§3).

### 2.3 Duplicate și aceeași poveste din mai multe surse
- Aceeași știre (același GUID / link, link cu parametri `utm_*`) se salvează o singură dată.
- Aceeași poveste din mai multe publicații e **grupată**: în listă apare o singură intrare, cu celelalte surse dedesubt.

### 2.4 Detectarea monedelor și a acțiunilor
- Monede: după nume („Bitcoin”), simbol (`BTC`, `$SOL`) și aliasurile din favorite. Protecție la ambiguități: simbolurile se potrivesc doar cu MAJUSCULE sau cu `$`; simbolurile scurte și cuvintele comune (`ONE`, `GAS`, `NEAR` scris „near”, `CEO`, `ETF`, `SEC`, `USD`, `AI`…) nu sunt monede; numele mai lungi au prioritate („Bitcoin Cash” ≠ „Bitcoin”).
- Acțiuni favorite: după simbol și numele companiei (alias editabil, ex. „Apple”, „iPhone”).
- Indici favoriți: după aliasuri („S&P 500”, „Dow Jones”, „Russell 2000”…), editabile (FD-INDICES).

### 2.5 Cazuri limită
| Situație | Comportament |
|---|---|
| Știre fără dată | se folosește momentul primei descoperiri |
| Dată în viitor (fus greșit în feed) | > 5 min în viitor → momentul descoperirii |
| Știre veche reapărută în feed (> 3 zile) | ignorată la prima descoperire |
| Titlul unei știri existente se schimbă | se actualizează și se rescorează |
| HTML / entități / CDATA | convertite în text simplu; nu se afișează niciodată HTML din feed |
| Link care nu e `http(s)` | știrea rămâne, fără link |
| Conținut sponsorizat / „press release” / „price prediction” | pondere redusă în sentiment |
| Știre geopolitică fără legătură cu piețele | afișată, dar **nu** intră în sentimentul zilei |
| Sursă căzută / timeout / 4xx / 5xx / HTML în loc de XML / 429 | pauză cu backoff (5 → 10 → 20 → 40 → 60 min); restul merg normal; eroarea apare în Stare sistem |
| Feed uriaș (> 5 MB) | ignorat, eroare „feed prea mare” |
| Favorite selectate, nicio știre | „Nicio știre despre BTC, ETH în intervalul ales” |
| Fără favorite | filtrul de favorite lipsește, cu explicație |
| Sursă dezactivată | știrile ei dispar din listă și din sentiment (revin dacă o reactivezi) |
| Retenție | știrile mai vechi de 90 de zile (configurabil) se șterg; scorurile zilnice rămân |

## 3. Sentimentul zilei (FD-SENT, FD-IMPACT)

### 3.1 Sentimentul unei știri
- Scor între **−1** și **+1** pentru prețurile crypto și ale acțiunilor (risk-on / risk-off); etichete: Pozitiv (> +0,2), Negativ (< −0,2), Neutru.
- **Motor local (implicit):** un model AI pe Mac (offline după descărcare) + **reguli de domeniu** („Fed cuts rates” = pozitiv, „yields jump” = negativ, „exchange hacked” = negativ…). Regulile aplicate se văd în detaliile știrii.
- **Motor Claude (opțional, ales de admin):** titlurile se evaluează cu Claude (`claude-opus-5-5` implicit; `claude-sonnet-5-5` sau `claude-haiku-5-5` pentru cost mai mic). Claude dă și **importanța** știrii (1 minoră, 2 notabilă, 3 mișcă piața). Dacă Claude nu răspunde, se folosește motorul local.
- Știrile noi apar imediat „în analiză”, până primesc scor.

### 3.2 Indicele zilei (0–100)
**0 = extrem de negativ, 50 = neutru, 100 = extrem de pozitiv**: 0–20 *Foarte negativ* · 20–40 *Negativ* · 40–60 *Neutru* · 60–80 *Pozitiv* · 80–100 *Foarte pozitiv*.

Cum se calculează (formula exactă în TD §6.4):
1. Se iau **toate** știrile relevante ale zilei (indiferent de filtre).
2. Fiecare știre are o **pondere** = relevanță × importanță × încrederea în sursă × cât de recentă e.
   - *Importanța*: cea dată de Claude, la știrile notate de Claude; altfel cea după cuvinte-cheie (Fed/FOMC, CPI, NFP, ETF, SEC, hack-uri, lichidări, tarife, război, BTC/ETH → mare; un altcoin mic → normală).
   - *Relevanța*: știrile geopolitice legate de piețe 0,8 față de știrile crypto (1).
   - *Recentă*: înjumătățire la 8 ore.
   - *Speculativă*, *sponsorizată* sau *recap* → pondere redusă.
3. Aceeași poveste din mai multe surse contează ca o știre, cu un bonus mic de acoperire.
4. Nicio sursă nu poate depăși 25% din ponderea totală.
5. Media ponderată a scorurilor; cu puține știri, rezultatul e tras spre neutru.
6. Transformare în 0–100.

Se mai văd: **încrederea** (scăzută / medie / ridicată), sub-indicii **Crypto / Acțiuni / Macro / Geopolitică**, evoluția pe ore, istoricul pe 30 de zile, ce mișcă indicele (top 5 pozitive și negative) și numărul de știri pozitive / neutre / negative / în analiză.

### 3.3 Cazuri limită
| Situație | Comportament |
|---|---|
| Nicio știre încă (după miezul nopții) | indicele 50, „date insuficiente”, încredere scăzută |
| Doar știri „în analiză” | ca mai sus; se recalculează când primesc scor |
| Modelul nu s-a descărcat | doar reguli, „motor redus”; când modelul devine disponibil, știrile din ultimele 48 h se rescorează |
| Adminul schimbă motorul (local ↔ Claude) | știrile noi folosesc noul motor; „Rescorează ultimele 48 h” |
| Schimbi fusul orar | zilele se recalculează în noul fus |
| Ziua s-a încheiat | indicele se **îngheață** după 2 ore de grație și după ce toate știrile zilei au scor; până atunci e provizoriu |
| Aplicația a fost oprită peste noapte | la pornire se calculează zilele rămase deschise |
| Prima pornire | zilele dinaintea primei colectări nu intră în istoric |
| Rescorare după ce ziua s-a închis | ziua finală nu se schimbă automat; „Recalculează istoricul” în Setări (admin) |
| O schimbare a modului de ponderare (ex. FD-IMPACT) | istoricul încă păstrat se recalculează o dată, automat |

## 4. Calendar economic (FD-CAL)

### 4.1 Ce face
- Săptămâna (curentă, anterioară, următoare) pe coloane, câte o zi pe coloană (pe ecrane mici, o zi sub alta); ziua de azi evidențiată.
- Pentru fiecare eveniment: ora (fusul tău), valuta / țara, titlu, **impact** (High = roșu, Medium = portocaliu, Low = galben, Holiday = gri), Actual, Forecast, Previous și, după publicare, abaterea (▲ peste / ▼ sub așteptări).
- Click pe o fișă: explicația în română (CPI, NFP, FOMC, PCE, PPI, Retail Sales, GDP, ISM PMI, Jobless Claims, JOLTS, Michigan, discursurile Fed…) și abaterea.
- Numărătoare până la următorul eveniment **High** (și în bandă). Evenimentele în desfășurare (± 2 min) sunt evidențiate. La ora unui eveniment High / Medium, valoarea Actual se caută activ (la ~2 minute, până la 15 minute după).
- Filtre (ale fiecăruia): impact (implicit High + Medium), valute (implicit USD, EUR, GBP, JPY, CNY + „Global”; mai sunt CAD, AUD, NZD, CHF), **„Rezultate companii”**: rezultatele trimestriale ale acțiunilor favorite (cu EPS estimat și cel de anul trecut).
- **Evenimente personale** (ale fiecăruia): dată / oră sau toată ziua, impact, notă; se șterg din fișa lor.

### 4.2 Surse
- **ForexFactory**: lista principală și impactul; citit cel mult o dată pe oră.
- **TradingView**: valorile Actual și zilele pe care FF nu le acoperă; tot de aici vin datele paginii Economie.
- **Nasdaq**: rezultatele companiilor.

### 4.3 Cazuri limită
| Situație | Comportament |
|---|---|
| FF blocat (rate limit, HTML în loc de JSON) / căzut | ultimele date FF din DB; zilele fără FF → TradingView (impact mapat 1 → High, 0 → Medium, −1 → Low); banner „ForexFactory a limitat temporar accesul” |
| Ambele surse căzute | datele din cache, cu ora |
| Eveniment fără Forecast / Actual (discursuri) | „—” |
| Actual încă nepublicat | „în așteptare” până la +15 min, apoi „—” |
| Titluri diferite între surse („CPI m/m” vs „Inflation Rate MoM”) | potrivire pe valută + oră + sinonime; dacă nu e sigur, nu se potrivește |
| Mai multe evenimente la aceeași oră | fiecare se potrivește separat, după perioadă (m/m, y/y, q/q) |
| Holiday | „toată ziua” |
| Valuta „All” | „Global” |
| Ora de vară diferită SUA / Europa | orele vin cu offset, deci corecte |
| Eveniment mutat / anulat | dispare / se mută la următorul fetch; cele trecute rămân |

## 5. Grafice (FD-CHART, FD-CHARTUX, FD-CHARTFAV, FD-PNL)

### 5.1 Ce face
- Lumânări pentru **perechi crypto** (`/charts/BTC/USDT`), **acțiuni americane** (`/charts/s/AAPL`) și **indici americani** (`/charts/i/SPX`, FD-INDICES).
  - Crypto: de la exchange-ul conectat al utilizatorului (KuCoin, Binance, Bybit, OKX, Bitget; cu mai multe, cel ales), altfel de la cel implicit al adminului; o pereche pe care exchange-ul lui n-o are vine de la cel implicit (FD-MARKETSRC). 1m – 1w; un timeframe pe care exchange-ul nu-l are (8h pe Bybit / OKX / Bitget) e dezactivat, iar graficul arată cel mai apropiat.
  - Acțiuni: zilnic și săptămânal fără cheie (Nasdaq), 1m – 4h cu cheia Twelve Data a adminului (Twelve Data nu are 3m, 6h, 8h, 12h: se folosește timeframe-ul cel mai apropiat).
  - Indici: 1m – 4h (fără 6h / 8h / 12h; istoric de ~100 de zile) și 1d / 1w (din 2010), de la CNBC, în timp real; dacă CNBC nu răspunde, zilnicul și cotațiile vin de la Nasdaq / Cboe (FD-INDEXINTRA).
- Se actualizează automat; fără grilă și fără liniile cursorului (prețul și ora pe axe); graficul stă pe placa lui, nu pe culoarea paginii.
- **Slingshot System Long 3.3** (indicatorul utilizatorului), portat 1:1 din Pine: norul EMA 38/62, semnalele **LONG** (verzi cât sunt valide sau au atins TP, roșii când au fost invalidate sau au atins SL), previzualizarea LONG, **TAKE PROFIT**, liniile TP/SL ATR cu tabelul lor, **Market Structure** (și pe un timeframe superior), lista **alertelor** și istoricul **semnalelor** (intrare, SL, TP, rezultat).
- **[DI] Logarithmic Moving Average (LMA)** în panoul de jos (linia de semnal, pragurile, starea BULLISH / BEARISH / NEUTRAL); „Color Price Bars” colorează lumânările după LMA.
- **Indicatori** (FD-INDICATORS): lista cu cei 117 indicatori standard TradingView plus Volume, pe categorii și cu căutare; Slingshot și LMA sus, la „Premium”, cu eticheta PREMIUM. Fiecare indicator adăugat are legenda lui (valori, ochi, setări, ×), panoul lui dacă nu e „pe grafic” și setările Intrări / Stil cu numele și valorile implicite din TradingView. Bifa „Pozițiile mele” arată / ascunde pozițiile.
- **Pozițiile și ordinele** tale pe moneda afișată apar ca linii, cu PnL la SL, TP și la prețul curent.
- Simbolurile din panoul graficului sunt ale listei de urmărire alese în capul lui (FD-WATCHLISTS §4) și se reordonează prin tragere (sau Alt + ↑ / ↓), în lista aceea.
- Se țin minte: perechea, timeframe-ul, „Pozițiile mele”, indicatorii de pe grafic (aceiași pe toate graficele), înălțimea fiecărui panou, setările indicatorilor; zoom-ul pe fiecare pereche și timeframe, în browser. **Ecran complet**, cu ieșire prin buton sau Esc.

### 5.2 Diferențe intenționate față de TradingView
- Prețurile din etichete / tabel au **precizia pieței** (ex. `0.00001234`), nu `#.##`.
- Istoricul e cel descărcat (implicit 1500 de lumânări, până la 5000, ales de admin): primele semnale din istoric pot diferi de TradingView; cele recente coincid la aceleași date.
- Lumânarea în formare e inclusă: semnalele de pe ea sunt „neconfirmat” până la închidere.

### 5.3 Cazuri limită
| Situație | Comportament |
|---|---|
| Prea puține lumânări pentru indicatori | graficul apare; indicatorul afișează ce poate; „istoric insuficient” |
| Simbolul nu există | eroare clară + sugestii |
| Timeframe-ul Market Structure < cel al graficului | se folosește timeframe-ul graficului (ca în Pine) |
| Datele HTF nu se pot descărca | liniile Market Structure se ascund, cu avertisment |
| Exchange-ul / sursa nu răspunde | ultimele lumânări rămân, cu „date vechi de N min” |
| Acțiune: limita Twelve Data atinsă | ultimele lumânări + ora la care revine |
| Acțiune în afara ședinței | nu se cer lumânări noi (economie de cereri) |
| Peste 500 de etichete | cele mai vechi dispar (`max_labels_count=500`) |
| Schimbi setările indicatorului | recalculare instantanee, fără re-descărcare |

### 5.4 Scanner (pe Azi)
Pentru fiecare favorit, pe timeframe-ul ales pe Azi, deasupra favoritelor („Semnale Slingshot pe” 15m · 1h · 4h · 1d; implicit 1h), de la același exchange ca graficul: trend, ultimul semnal LONG (vârsta, starea), TP/SL active, ultima ruptură de structură. Se recalculează la 5 minute.

## 6. Tranzacții / portofoliu (FD-TRADE, FD-SENTIQ, FD-NOAPI)

### 6.1 Ce face
- „Adaugă un cont” (pagina Tranzacții sau Setări) deschide un asistent: alegi platforma după logo (filtru Crypto / Acțiuni, căutare), urmezi pașii pentru o cheie doar de citire (sau, separat, cu tranzacționare, dar fără retrageri) cu linkul spre pagina furnizorului, completezi exact câmpurile cerute; contul se salvează doar dacă testul conexiunii reușește.
- **Tranzacționare** (FD-TRADING): pe conturile unde e pornită, „Ordin nou” (spot, futures, acțiuni), „Anulează” pe ordine, „Închide” pe poziții, „Vinde” pe dețineri și „Tranzacționează” pe grafic, fiecare ordin cu fereastra de confirmare; jurnalul ordinelor trimise din Sentiq. Toate platformele în afară de Interactive Brokers.
- Platforme (doar cele cu API): **KuCoin, Binance, Bybit, OKX, Kraken, Coinbase, Bitget** (crypto) și **Trading 212, eToro, Interactive Brokers, Alpaca** (acțiuni).
- Pe fiecare cont, cu logo-ul lui: poziții (futures / cu levier), dețineri cu preț mediu și PnL, numerar (la brokeri), ordine deschise, tranzacțiile recente (7 zile). Reîmprospătare la 30 s cât pagina e deschisă + butonul „Reîmprospătează” din bara paginii, lângă „Adaugă un cont”.
- **Cardurile unui cont crypto** (FD-TRADESTATS): Disponibil în futures · Valoare în contul spot · PnL nerealizat (futures) · Tranzacții profitabile · Tranzacții cu pierdere · Rata de succes · Câștig net. Ultimele patru numără pozițiile futures închise în perioada aleasă în bara paginii (Azi · 7z · 30z · 90z), după rezultatul lor net; KuCoin, Bybit, OKX, Bitget (Binance nu dă istoricul prin API).
- La brokeri: Valoare dețineri · Numerar disponibil · PnL nerealizat (poziții).

### 6.2 Securitate
- Cheile se salvează **criptat**; după salvare se vede doar un indiciu (`abcd…wxyz`).
- Ordinele pleacă doar de pe conturile cu tranzacționarea pornită (parola + 2FA), după confirmare; aplicația nu are cod de retrageri sau transferuri.
- Dacă platforma raportează că o cheie poate retrage sau transfera fonduri, apare un avertisment, iar tranzacționarea nu poate fi pornită cu ea.

### 6.3 Cazuri limită
| Situație | Comportament |
|---|---|
| Cheie greșită / expirată / IP nepermis | contul arată eroarea exactă; restul aplicației merge |
| Ceas decalat față de exchange | diferența se sincronizează automat |
| O secțiune (solduri, poziții, ordine, tranzacții) eșuează | ultimele ei date bune, cu ora, și eroarea deasupra |
| Exchange supraîncărcat / limită de cereri | reîncercare automată; ultimele prețuri bune, cu ora |
| Preț mediu necunoscut | „necunoscut”; se poate introduce manual |
| Monedă fără pereche USDT | valoare „—”, exclusă din total |
| Interactive Brokers | raport Flex: datele de la închiderea zilei precedente; tokenul expiră |
| Niciun cont | pagina explică pașii |

## 7. Setări (FD-SET, FD-ADMINSET)
**Ale mele** (`/settings`, oricine, doar pentru contul lui):
- **Simbolurile urmărite (din 20 oct 2026, în Liste de urmărire, FD-WATCHLISTS; în restul documentului, „favoritele” sunt simbolurile din toate listele împreună)**: monede (căutare pe exchange-ul utilizatorului și pe cel implicit), acțiuni (căutare după simbol sau nume) și indici (din lista de 7: SPX, NDX, COMP, DJI, RUT, VIX, SOX); reordonare prin tragere, săgeți sau Alt + ↑ / ↓; aliasuri pentru știri.
- **Conturi** (exchange-uri și brokeri), prin asistent. Cu două sau mai multe exchange-uri dintre KuCoin, Binance, Bybit, OKX, Bitget: „Prețurile crypto vin de la:” (FD-MARKETSRC).
- **General**: fusul orar.

**Admin** (`/settings/admin`, doar adminul; fila nu apare pentru ceilalți; se aplică tuturor):
- **Surse de știri**: activare, pondere 0,5–1,5, feed propriu cu test; cele implicite doar se dezactivează; cele automate țin de favoritele acțiunilor (FD-AUTOFEED).
- **Motorul de sentiment**: local / Claude, modelul, cheia Anthropic (folosită și de Rezumat), „La ce folosește Sentiq cheia Claude” cu consumul zilei (FD-AICLARITY), „Rescorează ultimele 48 h”, „Recalculează istoricul”.
- **Date de piață**: exchange-ul implicit pentru prețurile crypto, istoricul încărcat pe grafice (1500 / 3000 / 5000 de lumânări), cheia Twelve Data și consumul zilei.
- **Păstrarea știrilor** (implicit 90 de zile).
- **Email (Resend)**: cheia, expeditorul.

- Setările indicatorilor sunt în pagina Grafice („Indicatori”).
- Validare: valorile în afara intervalelor sunt respinse cu mesaj clar; nimic nu se salvează parțial.

## 8. Stare sistem (FD-HEALTH, doar admin)
- Motorul de sentiment (încărcat / se descarcă / indisponibil) și câte știri așteaptă scor; sursele calendarului și ale rezultatelor; dimensiunea bazei de date; consumul Twelve Data (cereri azi / 800).
- Fiecare job: ultima rulare, durata, următoarea rulare, eroarea.
- Fiecare sursă de știri: ultimul succes, ultima știre nouă, următoarea verificare, eroarea.

## 9. Ce NU face (candidați pentru mai târziu)
- Ordine prin Interactive Brokers (cer Client Portal Gateway sau OAuth, nu cheia Flex; FD-TRADING); futures pe Kraken și Coinbase.
- Notificări desktop / sonore (alerte de indicator, reminder înainte de CPI).
- Evenimente crypto automate (unlock-uri, upgrade-uri): doar ca evenimente personale.
- Backtesting.
- Indici din afara SUA și futures pe indici (fără o sursă gratuită, FD-INDICES §2).

## 10. Conturi, roluri și acces (FD-USERS, FD-INVITE)
- **Roluri:** un **admin** (proprietarul, cu toate datele de dinainte de conturi) și **utilizatori**.
- **Ale fiecăruia:** favoritele, setările graficelor, ale calendarului și timeframe-ul semnalelor, alegerea exchange-ului de prețuri (dintre cele conectate), fusul orar, conturile de exchange / broker, evenimentele personale, rezumatul zilei, conexiunile Claude. **Comune:** știrile, sentimentul zilei, calendarul economic, indicatorii economici, datele de piață.
- **Doar adminul:** sursele de știri, motorul de sentiment și cheia Claude, cheia Twelve Data, emailul (Resend), retenția (toate în Setări → Admin), *Stare sistem* și *Utilizatori*.
- **Cont nou doar la cerere:** „Cere un cont” (nume și email) → adminul primește email și vede un punct pe inițiala lui → *Utilizatori* → Aprobă (sau Respinge) → persoana primește linkul de activare (7 zile), își alege parola → login. O cerere fără răspuns dispare după 30 de zile.
- **2FA obligatoriu (FD-2FA):** fiecare cont, adminul inclus, își configurează aplicația de autentificare (cod QR + 10 coduri de recuperare) înainte să intre în aplicație: contul nou imediat după activare, celelalte la primul login fără 2FA. Până atunci nu se deschide nimic altceva.
- **Login:** email + parolă (minimum 12 caractere, literă mare, literă mică, cifră), apoi codul TOTP (5 minute) sau un cod de recuperare; sau **passkey** (merge pe adresa pe care a fost creat: https://sentiq.money sau `http://localhost:4317` pe Mac; niciodată pe o adresă IP). 3 încercări greșite de pe același dispozitiv → pauză 15 minute. Sesiunea ține 30 de zile de la ultima folosire.
- **Parola uitată:** link valabil o oră; parola nouă închide toate sesiunile.
- **Securitate** (meniul contului): nume, parolă, 2FA („Schimbă aplicația de autentificare”, „Coduri de recuperare noi”; nu se poate opri), passkey-uri, „Ieși de pe toate dispozitivele”.
- **Utilizatori** (admin): cereri de cont, link nou de activare, dezactivare / reactivare, resetarea 2FA (contul și-l configurează din nou la login), ștergerea contului (cu datele lui).
- **Acces din rețea:** serverul ascultă pe toate interfețele, dar răspunde doar la numele și adresele Mac-ului (plus `SENTIQ_ALLOWED_HOSTS`); `SENTIQ_BIND=127.0.0.1` îl ține doar pe Mac. Pe Azure răspunde la adresa `*.azurewebsites.net` și la adresa publică (FD-AZURE §1).
- Emailurile (cerere nouă, activare, parolă uitată) pleacă prin **Resend**; cu expeditorul de test ajung doar la admin, care copiază linkul de activare din pagina de aprobare. Linkurile folosesc adresa publică (https://sentiq.money), și când adminul aprobă de pe Mac (FD-ONLINE §2).

## 11. Azi (dashboard)
Plăci, în ordine: sentimentul zilei (indicele, spectrul, variația față de acum o oră, ziua pe ore, sub-indicii Crypto / Acțiuni / Macro / Geopolitică), evenimentul major următor (cu evenimentele zilei), știrile live, „Ce mișcă piața” (știrile care contează cel mai mult) și ultimele 30 de zile, apoi **favoritele** pe toată lățimea: monede, acțiuni și indici (preț, variație, grafic, trend, ultimul semnal Slingshot, TP/SL active). De la 768 px, sentimentul stă în coloana din stânga, iar evenimentul următor și știrile live, unul sub altul, în dreapta, pe toată înălțimea lui. La 1440 × 900 plăcile de sus încap pe un ecran. Sub 768 px plăcile se așază una sub alta; „Ce mișcă piața” și „Ultimele 30 de zile” sunt mereu deasupra favoritelor (FD-TODAYGRID).

**Rezumat** (FD-SUMMARY): Claude rezumă ziua de până acum într-o fereastră mare: verdictul (zi bună / mixtă / slabă de trading, cu încrederea), secțiuni scurte, Oportunități, Riscuri, Ce urmează în 24 h și până la 4 grafice cu cifrele aplicației. Se face singur la prima deschidere din zi; „Actualizează” cel mult o dată la 2 minute. Folosește cheia Claude a adminului; Claude primește doar datele zilei, niciodată chei, conturi sau portofolii. Nu e sfat de investiții.

## 12. Economie (FD-ECON, FD-ECONCOLOR, FD-ECONFILTER)
- Nivelul curent al indicatorilor economici pentru SUA, zona euro (cu Germania, Franța, Italia, Spania unde zona euro nu are indicatorul), Marea Britanie, Japonia, China, Canada, Elveția, Australia, Noua Zeelandă.
- Pentru fiecare: ultima valoare și perioada ei, valoarea anterioară (revizuită) și schimbarea, istoricul pe ~13 luni, data și ora următoarei publicări (cu prognoza), sursa oficială. Sus „Esențialele” fiecărei țări, dedesubt toți indicatorii pe grupe; click pe rând → explicația și publicarea față de prognoză.
- **Culori:** verde = schimbare bună pentru economie, roșu = rea, fără culoare = indicator neutru sau fără schimbare.
- Cipurile țărilor sunt **filtre** (păstrate în adresa paginii), plus căutare și „Doar importante”.
- Datele vin din calendarul TradingView: istoricul (~400 de zile) se încarcă o dată, apoi valorile noi apar la câteva minute după publicare.

## 13. Claude în Sentiq: doar pe cheia API (FD-MCPREMOVE)
- Claude lucrează în Sentiq doar prin cheia API a adminului: sentimentul știrilor (cu motorul Claude) și Rezumatul de pe Azi; consumul zilei e în Admin (FD-AICLARITY). Abonamentele Claude nu pot fi folosite de Sentiq (termenii Anthropic).
- Connectorul MCP (FD-MCP, FD-MCPMULTI), prin care aplicațiile Claude / ChatGPT / Gemini citeau datele din Sentiq, a fost scos pe 14 oct 2026, la cererea utilizatorului: direcția lui (de la aplicația AI spre Sentiq) nu era ce voia.

## 14. Baza de date și găzduirea (FD-AZURE)
- **Azure SQL Database** (`sentiq`, pe serverul `serento-sql`), cu un utilizator care vede doar baza Sentiq. Backup-ul îl face Azure.
- Mai multe procese pot folosi aceeași bază (Mac-ul și Azure): scrierile se fac una după alta, iar **joburile de fundal le rulează una singură**; Stare sistem arată care. O sesiune Sentiq care ține lacătul de scriere de peste 5 minute e închisă singură (FD-DBHEAL).
- Dacă baza nu răspunde, paginile spun „Baza de date nu răspunde acum. Reîncearcă în câteva secunde.” și aplicația revine singură.
- **Stare sistem:** serverul și baza, nivelul, spațiul ocupat din maxim (avertisment peste 80%).
- Testele automate rulează în aceeași bază, în scheme separate, șterse la final.

---

# Partea a II-a — Istoricul deciziilor

Fiecare secțiune de mai jos a fost scrisă înaintea schimbării ei și descrie ce s-a decis atunci. Ce a fost înlocuit ulterior:
- v1 (12 oct 2026): aplicație doar pe `127.0.0.1`, fără conturi, meniu lateral, doar KuCoin, temă doar întunecată → Partea I.
- FD-THEME §1 (tema luminoasă „hârtie rece” cu accent auriu) → FD-THEME2 (tema luminoasă Navy, accent turcoaz; tokenul `brass` redenumit `accent`). Tema întunecată din FD-REDESIGN rămâne.
- FD-SENTIQ §2 (cardurile „fără API” XTB, Tradeville, Revolut, Degiro) → FD-NOAPI (nu mai apar).
- FD-USERS §4 (înregistrare liberă și confirmarea emailului) → FD-INVITE (conturi doar la cerere, aprobate de admin).
- FD-THEME §1 (placa neagră a logo-ului Revolut) → FD-NOAPI.
- FD-SENTIQ §1 (scurtătura `scripts/kryptoniq.sh` și vechiul `Kryptoniq.app`) → scoase din proiect; rămân `Sentiq.app` și `scripts/sentiq.sh`.
- Baza de date SQLite (`data/kryptoniq.db`, backup-urile `VACUUM INTO`, „rulează pe Mac” din principiul 1) → FD-AZURE (Azure SQL Database; fișierul rămâne doar pentru import).

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
- Dacă browserul nu permite ecranul complet al sistemului, și întotdeauna pe iPhone și iPad (FD-IPADFS2), graficul acoperă toată fereastra aplicației, cu același buton de ieșire și același Esc.
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

---

## FD-SENTIQ — Acțiuni, conturi prin wizard, redenumire în Sentiq (13 oct 2026)

### Cererea
„as vrea sa extindem suportul si pentru actiuni … research … surse de date … integrarea exchange-urilor importante cu api key … wizzard de alegere a exchangeului (cu nume si poza/logo) si dupa alegere sa introduca datele, conform cerintelor fiecarui api. si vom redenumi aplicatia in sentiq”.

Alegerile utilizatorului (după cercetarea din research.md §8):
- **brokeri:** Trading 212, eToro, Interactive Brokers, Alpaca;
- **crypto:** și exchange-urile mari, pe lângă KuCoin;
- **date pentru grafice:** Twelve Data (cheie gratuită) + Nasdaq (fără cheie);
- **etapă completă:** acțiuni în toată aplicația.

### 1. Redenumire: Sentiq
- **Nume nou:** aplicația se numește **Sentiq** (sentiment + IQ) peste tot: titlul ferestrei, meniul, căutarea ⌘K („Caută în Sentiq”), mesajele, documentația, lansatorul.
- **Iconița Sentiq** (litera „q” cu graficul auriu) apare în tab-ul browserului, în meniu, lângă nume, când site-ul e adăugat pe ecranul principal sau în Dock, și pe `Sentiq.app` (Finder, Dock, Login Items).
- **Lansator:**
  - `scripts/sentiq.sh` (start / stop / restart / status / open / logs / app) și aplicația `Sentiq.app`;
  - vechiul `scripts/kryptoniq.sh` rămâne ca scurtătură către cel nou, ca vechile comenzi și scurtături să meargă în continuare;
  - un `Kryptoniq.app` aflat deja în Login Items continuă să pornească aplicația; `scripts/sentiq.sh app` creează `Sentiq.app`, care îl poate înlocui.
- **Datele rămân unde sunt** (folderul `data/`: setări, chei, știri, istoric). Nimic nu se pierde la redenumire.
- **Variabilele de mediu** `SENTIQ_*` înlocuiesc `KRYPTONIQ_*`, iar cele vechi sunt acceptate în continuare.
- **Preferințele din browser** (zoom-ul graficelor) se mută automat la noul nume.

### 2. Conturi: wizard cu logo-uri
**Unde:** „Adaugă un cont” în Setări → Conturi și în Tranzacții (pagina goală și butonul de lângă conturi).

**Pas 1 — alegi platforma:**
- filtru Toate / Crypto / Acțiuni și căutare după nume;
- o grilă de carduri: logo, nume, tip (Crypto / Acțiuni), o frază despre ce se citește;
- **disponibile:**
  - crypto: KuCoin, Binance, Bybit, OKX, Kraken, Coinbase, Bitget;
  - acțiuni: Trading 212, eToro, Interactive Brokers, Alpaca;
- **fără API** (card estompat, cu motivul): XTB („API închis de XTB în martie 2025”), Tradeville, Revolut, Degiro („nu oferă API pentru clienți”).

**Pas 2 — cheia:**
- logo și nume sus; butonul „Altă platformă” întoarce la pasul 1;
- **„Cum creezi o cheie doar pentru citire”**: pașii pentru acea platformă, cu linkul către pagina de chei;
- **formularul**, cu exact câmpurile cerute de platformă:

| Platformă | Câmpuri | Mediu |
|---|---|---|
| KuCoin, OKX, Bitget | API Key, API Secret, Passphrase | — |
| Binance, Bybit, Kraken | API Key, API Secret | — |
| Coinbase | Nume cheie API (`organizations/…/apiKeys/…`), cheie privată (text pe mai multe rânduri, PEM) | — |
| Trading 212 | API Key, API Secret | Live / Demo (Practice) |
| eToro | Public API Key, User Key | Real / Demo |
| Interactive Brokers | Flex Web Service Token, Flex Query ID | — |
| Alpaca | API Key ID, Secret Key | Live / Paper |

- plus un nume ales de tine (ex. „IBKR principal”);
- câmpurile secrete sunt ascunse la tastare, cu buton de afișare; lipirea textului curăță spațiile de la capete.

**Pas 3 — verificare:**
- „Conectează” verifică imediat cheia (o citire de test);
- **succes:** contul apare în listă, cu logo, iar Tranzacții îl arată;
- **eroare:** rămâi pe formular, cu mesajul exact („cheie greșită”, „cheia nu are permisiunea de citire a portofoliului”, „IP nepermis”, „exchange-ul limitează cererile”), fără să pierzi ce ai introdus;
- dacă cheia are permisiuni de tranzacționare sau retragere (unde platforma spune asta: KuCoin, Binance, Bybit, OKX, Bitget), contul se salvează, dar cu avertismentul roșu de acum.

**Lista conturilor:** logo, nume, platformă, mediu (Demo / Paper vizibil), indiciul cheii (`abcd…wxyz`), starea (conectat acum N min / eroare), plus „Testează” și „Șterge”.

**Securitate (ca până acum):**
- cheile se criptează pe disc și nu mai sunt afișate;
- Sentiq doar citește: nu plasează, nu modifică și nu anulează ordine, nu mută fonduri;
- pentru fiecare platformă, instrucțiunile cer explicit o cheie doar pentru citire.

### 3. Ce se vede de la fiecare broker (Tranzacții)
| Broker | Dețineri | Poziții cu levier / short | Ordine deschise | Tranzacții | Actualizare |
|---|---|---|---|---|---|
| Trading 212 | acțiuni / ETF-uri: cantitate, preț mediu, preț curent, PnL | — | da | istoricul ordinelor executate (7 zile) | 30 s |
| eToro | pozițiile fără levier ale acțiunilor / ETF-urilor, ca dețineri | pozițiile cu levier sau short, cu SL / TP | ordinele de intrare | — | 30 s |
| Interactive Brokers | pozițiile din raportul Flex | opțiuni / futures / short, ca poziții | — | tranzacțiile din raport | **la închiderea zilei precedente**, recitit cel mult o dată la 15 min; pagina spune data raportului |
| Alpaca | acțiunile (long) | short | da | execuțiile din ultimele 7 zile | 30 s |
| Exchange-urile crypto noi | sold spot | poziții futures (unde există) | da | ultimele tranzacții (perechile monedelor deținute + favorite) | 30 s |
| KuCoin | neschimbat | | | | |

- **Monede:**
  - valorile apar în moneda contului (USD, EUR, GBP) sau în USDT la crypto, cu simbolul ei;
  - totalul nu amestecă monede: fiecare cont are totalul lui.
- **Prețul mediu** vine de la broker (Trading 212, eToro, IBKR, Alpaca îl dau), deci nu se mai estimează din istoric; prețul manual rămâne posibil.
- **Liniile de pe grafic** (intrare, SL / TP, PnL) funcționează și pentru acțiuni: o deținere sau o poziție pe simbolul graficului.

### 4. Acțiuni în toată aplicația
#### 4.1 Favorite
- În Setări → Favorite alegi tipul (**Crypto / Acțiuni**) și cauți după simbol sau nume (ex. „Apple” → AAPL, NASDAQ).
- O acțiune favorită are simbolul (AAPL), bursa (NASDAQ / NYSE), numele companiei și moneda (USD).
- Aliasurile (ex. „Apple”, „iPhone maker”) ajută la recunoașterea în știri; numele companiei fără „Inc.” se adaugă automat (și numele scurt când e marca: „Palantir Technologies” → și „Palantir”).
- Un simbol nu poate fi în favorite și ca monedă, și ca acțiune (ex. `COIN`); mesajul spune asta.
- Maximum 50 de favorite în total, ca acum.

#### 4.2 Banda de prețuri și Azi
- Acțiunile favorite apar în bandă și pe cardurile din Azi (preț, variația zilei, grafic mic).
- Prețul vine de la Nasdaq, gratuit, cu întârziere de câteva minute; eticheta „închis” apare când bursa e închisă.
- **Contextul de piață** primește: S&P 500, Nasdaq 100, VIX, Fear & Greed pentru acțiuni (CNN) și starea bursei americane (deschisă, pre-market, after-hours, închisă, cu numărătoare inversă).

#### 4.3 Grafice
- Graficele de acțiuni au aceleași instrumente: Slingshot, LMA, PnL, ecran complet, setări ținute minte.
- **Sursa lumânărilor:**
  - **Twelve Data**, dacă ai pus cheia gratuită în Setări: toate timeframe-urile suportate de ea: 1m, 5m, 15m, 30m, 1h, 2h, 4h, 1d, 1w;
  - altfel **Nasdaq**: 1d și 1w (ultimii ani), plus ziua curentă pe minute.
  - Timeframe-urile pe care sursa nu le are sunt dezactivate, cu explicația; Twelve Data nu are 3m, 6h, 8h, 12h.
- Lumânările urmează orele de tranzacționare (fără weekend / noapte), ca în TradingView.
- **Bugetul Twelve Data** (8 cereri / min, 800 / zi, plan gratuit):
  - lumânările se țin minte (1 min intraday, 15 min pentru 1d / 1w, până la redeschidere când bursa e închisă);
  - când bugetul se termină, graficul arată ultimele lumânări primite, cu mesajul „limita Twelve Data atinsă, revine la …”;
  - Setări → Stare sistem arată consumul zilei.
- ⌘K și căutarea de pe grafic găsesc și acțiuni (simbol sau nume); adresa e de forma `/charts/s/AAPL`.

#### 4.4 Știri și sentiment
- **Surse noi** (categoria „Acțiuni”): Nasdaq pe fiecare acțiune favorită (adăugată sau scoasă automat odată cu favorita), Nasdaq Stocks, Investing.com Stock News, CNBC Business.
- **Recunoașterea acțiunilor favorite** în titluri: simbolul (`$AAPL`, `(NASDAQ: AAPL)`, `AAPL` scris cu majuscule), numele companiei și aliasurile. Știrea primește eticheta acțiunii, cu insigna pătrată cu inițiale.
  - Numele se recunosc doar scrise ca nume („Apple”, „APPLE”), nu ca vorbe obișnuite („an apple a day”, „hit their target”).
  - Simbolurile care sunt și cuvinte (`AI`, `NOW`) contează doar ca `$AI` sau `(NYSE: NOW)`.
  - Indicii scriși ca simboluri în știrile bursiere (`$SPX` = S&P 500) nu mai sunt luați drept monede.
- Știri: filtrul de categorie are „Acțiuni”, iar filtrul de monede include acțiunile favorite.
- **Sentimentul zilei** include și știrile despre acțiuni, cu defalcarea „Acțiuni” lângă Crypto / Macro / Geopolitică.

#### 4.5 Calendar
- **Rezultatele trimestriale** ale acțiunilor favorite (de la Nasdaq; data confirmată de companie, de la TradingView, are întâietate: FD-EARNTV) apar ca evenimente:
  - impact „High”, ora: înainte de deschidere / după închidere / în timpul zilei;
  - estimarea EPS și EPS-ul de anul trecut în câmpurile Forecast / Previous.
- Titlul: „Rezultate trimestriale Bank of America”, cu simbolul în colț și o notă (ora, trimestrul, ce înseamnă Prognoză / Anterior).
- Filtrul de calendar are „Rezultate companii” (pornit implicit, ținut minte). Evenimentul următor din Azi și din banda de sus le include.
- Vin pentru următoarele 10 zile lucrătoare și se reîmprospătează la 6 ore; o acțiune adăugată în favorite își aduce rezultatele imediat.

#### 4.6 Scanner
- Acțiunile favorite intră în scanner, pe timeframe-ul scanner-ului.
- Ca să încapă în bugetul Twelve Data, sunt recalculate o dată la 30 min, doar cât bursa e deschisă (o dată după închidere).
- Fără cheie Twelve Data, scanner-ul folosește lumânări zilnice și o spune.

### 5. Edge cases
| Situație | Comportament |
|---|---|
| Cheie Twelve Data lipsă sau greșită | graficele de acțiuni pe 1d / 1w merg (Nasdaq); timeframe-urile intraday cer cheia, cu link spre Setări; o cheie greșită apare ca eroare la salvare (se verifică) |
| Bursa închisă (noapte, weekend, sărbători americane) | ultimele lumânări și ultimul preț, cu „închis”; fără cereri inutile |
| Acțiune listată în afara SUA (ex. pe Xetra) | căutarea arată doar ce poate servi sursa; Twelve Data în planul gratuit acoperă SUA, iar o acțiune neacoperită dă un mesaj clar |
| Split / dividend | lumânările vin ajustate de la sursă; prețul mediu de la broker e cel raportat de broker |
| Simbol schimbat / delistat | eroarea de la sursă, cu sugestii din căutare |
| IBKR: token expirat (6 ore implicit) | eroare „tokenul Flex a expirat; generează unul nou cu expirare mai lungă”, plus pașii |
| IBKR: raport în generare | se reîncearcă automat câteva secunde |
| IBKR: query fără secțiunea Open Positions | mesaj care spune ce secțiuni trebuie bifate |
| Trading 212: cont CFD (nu Invest / ISA) | eroarea API-ului, cu explicația că doar Invest și ISA au API |
| eToro: instrument fără simbol în metadate | apare cu ID-ul instrumentului |
| eToro: copy trading | pozițiile copiate apar cu eticheta „copiat de la <utilizator>” |
| Alpaca: cheie paper pe Live (sau invers) | „cheia nu e validă pentru mediul ales” |
| Coinbase: cheie veche (legacy) | instrucțiunile cer o cheie CDP; eroarea spune asta |
| Exchange fără `fetchPositions` (Kraken spot, Coinbase spot) | doar solduri, ordine și tranzacții |
| Cont șters | dispare din Tranzacții și de pe grafice |
| Mai multe conturi la același broker | fiecare cu numele lui |
| Monedă fără logo / companie fără logo | insigna cu inițiale, ca acum |
| Acțiune scoasă din favorite | dispare din bandă, Azi, scanner și calendar; feed-ul ei Nasdaq se oprește, iar știrile primite rămân până la retenție |
| Feed Nasdaq al unei acțiuni dezactivat de mine | rămâne dezactivat; se reactivează doar dacă scot și adaug din nou acțiunea |
| Ticker care e și cuvânt (`AI`, `NOW`, `ALL`) | recunoscut doar ca `$AI` / `(NYSE: NOW)` sau prin numele companiei |
| Acțiune pe grafic cu un timeframe pe care sursa nu îl are (ex. 3m) | se arată cel mai apropiat (5m cu cheie, 1d fără), cu explicația; timeframe-ul ales rămâne pentru monede |
| Simbolul `S` (Sonic) și adresa unei acțiuni | `/charts/S/USDT` e perechea, `/charts/s/AAPL` acțiunea |
| eToro: acțiune listată în altă monedă (ex. EUR) | valoarea și PnL-ul sunt în USD (din suma investită); prețul și prețul mediu rămân în moneda instrumentului |
| Monedă crypto ținută la un broker (eToro, IBKR, Alpaca) | apare în Tranzacții cu link spre graficul crypto, nu spre o acțiune |
| Instrument eToro fără simbol | „#1234”, fără link spre grafic și fără preț mediu manual |
| Kraken / Coinbase: monedă listată doar în USD | prețul vine din perechea în USD |
| Cheie Coinbase copiată din fișierul JSON (cu „\n” în loc de rânduri noi) | rândurile se refac automat |
| Ordinea favoritelor | banda, Azi și grafice le arată în ordinea din Setări, monede și acțiuni amestecate |

---

## FD-CHARTFAV — Slingshot pornit / oprit pe grafic; favoritele reordonate prin tragere (13 oct 2026)

Cererea utilizatorului: „la fel cum ai pus bifa pentru indicatorul LMA pune și pentru SS. Dacă nu vreau niciun indicator pe chart ar trebui să pot să fac asta. În plus, în zona de indici favoriți ar trebui să pot să rearanjez favoritele cu drag and drop.”

### 1. Bifa „Slingshot”
- Lângă „Pozițiile mele” și „LMA” apare bifa **„Slingshot”** (titlul: „Slingshot System 3.3”), în aceeași formă.
- **Debifată:** pe grafic dispar tot ce desenează Slingshot: norul EMA (cele două medii și umplutura), triunghiurile LONG / TAKE PROFIT, liniile și etichetele ATR (TP / SL), liniile Market Structure și caseta TAKE PROFIT / STOP LOSS din colț.
- Cu „Slingshot” și „LMA” debifate, graficul are doar lumânările (și, dacă e bifat, „Pozițiile mele”). Lumânările își iau culorile normale: „Color Price Bars” ține de LMA și se oprește odată cu ea.
- Panourile de sub grafic („Semnale Slingshot” și „Alerte”) rămân: sunt liste, nu desene pe grafic.
- Alegerea se ține minte, ca LMA: aceeași pentru toate graficele (monede și acțiuni), după reîncărcare și din ecran complet.
- Setările indicatorului rămân neschimbate; scanner-ul, Azi și alertele nu depind de bifă.

### 2. Favoritele reordonate prin tragere
- **Unde:** cipurile favoritelor de deasupra graficului (pagina Grafice) și tabelul din Setări → Favorite.
- **Cu mouse-ul:** apeși pe un favorit și îl tragi; celelalte se dau la o parte; îl lași unde vrei. Un click simplu (fără tragere) deschide graficul, ca până acum.
- **Pe ecran tactil:** ții degetul apăsat puțin, apoi tragi; o atingere scurtă deschide graficul, iar derularea paginii merge ca înainte.
- **Cu tastatura:** pe un favorit, **Alt + ← / →** (pe Mac: ⌥ + ← / →) îl mută cu o poziție. Un cititor de ecran anunță noua poziție („BTC: poziția 3 din 11”). În Setări rămân și săgețile ↑ / ↓.
- **În Setări:** fiecare rând are un mâner de tragere (⋮⋮) în coloana „Ordine”, lângă săgeți.
- **Ordinea e una singură:** se salvează imediat și apare la fel peste tot (bandă, Azi, Grafice, ⌘K, Știri, Setări).

### 3. Cazuri limită
| Situație | Comportament |
|---|---|
| Favoritul e lăsat în afara zonei | rămâne unde era |
| Lăsat pe același loc | nimic nu se salvează |
| Salvarea eșuează (server oprit) | ordinea revine la cea dinainte, cu mesajul erorii |
| Tragere cu click la final | după o tragere, graficul nu se schimbă (eliberarea nu e un click) |
| Graficul în ecran complet | cipurile se pot trage și acolo |
| Un singur favorit | nimic de mutat |
| Alt + ← pe primul / Alt + → pe ultimul | nu se întâmplă nimic |
| Altă filă a schimbat favoritele între timp | se folosește lista curentă; ordinea trimisă e lista completă văzută |

---

## FD-USERS — Utilizatori: cont, verificare pe email, login cu 2FA și passkey, admin (13 oct 2026)

Cererea utilizatorului: „adaugă suport pentru useri. tot procesul de identity plus login cu 2fa și passkey. astea au fost deja implementate și în Serento.Web. doar că în serento.web nu este permis crearea de useri dar aici vreau. userul meu trebuie creat deja cu drepturi de admin. ceilalți useri sunt useri normali și se creează singuri, trimiți emailul de verificare folosind resend. momentan în varianta de dezvoltare.”

Decizii (AskUserQuestion, 13 oct 2026):
- **Datele:** separare clară pe utilizator; comune doar știrile, sentimentul, calendarul și datele de piață.
- **Resend:** cheia de dezvoltare din Serento.Web, cu expeditorul `onboarding@resend.dev`.
- **Admin:** `accounts@dustyenterprise.com`.
- **Acces:** și din rețeaua locală, nu doar de pe Mac.

Model: Serento.Web (`Auth/*`, `AccountController`): aceleași reguli de securitate (parola hash-uită, TOTP cu prag anti-replay și coduri de recuperare, passkey-uri care înlocuiesc parola și al doilea factor, limitarea încercărilor, linkuri cu hash și expirare), extinse la mai mulți utilizatori.

### 1. Roluri
- **Admin** (unul: contul tău, creat deja): tot ce poate un utilizator, plus:
  - sursele de știri, motorul de sentiment și cheia Claude, cheile Twelve Data și Resend, retenția;
  - pagina „Stare sistem”;
  - pagina „Utilizatori”.
- **Utilizator:** se înregistrează singur; are propriile favorite, setări, conturi de exchange / broker, evenimente personale și rezultate de scanner.

### 2. Ce e al fiecăruia și ce e comun
| Al fiecărui utilizator | Comun (setat de admin) |
|---|---|
| favoritele și ordinea lor, aliasurile | știrile, sentimentul zilei, calendarul economic, rezultatele companiilor |
| fusul orar (ziua sentimentului se calculează în fusul fiecăruia) | sursele de știri |
| setările graficelor, Slingshot, LMA, timeframe-uri, exchange-ul pentru grafice | motorul de sentiment, cheia Claude |
| filtrele calendarului, evenimentele personale | cheia Twelve Data (și bugetul ei, comun) |
| conturile de exchange / broker (cheile lor), prețurile medii manuale | cheia Resend |
| scanner-ul (pe favoritele și parametrii lui) | retenția știrilor |

- Datele de acum (favorite, conturi, setări, evenimente) devin ale contului de admin.
- Un utilizator nou pornește cu BTC, ETH, SOL la favorite și setările implicite.
- Știrile se etichetează după favoritele tuturor (aliasurile oricui ajută la recunoaștere); fiecare filtrează doar după ale lui.
- **Ponderea știrilor în sentimentul comun** (relevanța, impactul: o știre despre BTC / ETH cântărește dublu) se calculează doar din lista de monede și favoritele adminului, ca înainte: aliasul pus de un utilizator îi aduce lui știrile în filtru, dar nu schimbă indexul tuturor.
- **Limite pe utilizator:** 50 de favorite, 20 de conturi de exchange / broker, 1000 de evenimente personale.
- **Feed-urile Nasdaq ale acțiunilor** sunt surse de știri, deci ale adminului: o acțiune adăugată de oricine își primește feed-ul, dar doar adminul repornește un feed pe care el l-a oprit.

### 3. Primul acces al adminului
- Contul `accounts@dustyenterprise.com` există deja, cu rol de admin, dar **fără parolă**.
- Prima deschidere a Sentiq **de pe Mac** (localhost) arată „Bun venit în Sentiq”: numele, emailul (completat și blocat când e deja știut), parola de două ori, apoi intri direct în „Securitate”, cu îndemnul să pornești 2FA.
- Din rețea, același ecran spune doar că parola de admin se setează de pe Mac, ca nimeni din rețea să nu poată revendica contul.
- **Din Terminal, pe Mac:**
  - `scripts/sentiq.sh admin-email <adresa>`: adresa adminului înainte de prima intrare;
  - `scripts/sentiq.sh admin-reset` (cere „da”): dacă adminul nu mai poate intra (parolă uitată și fără email, telefon și coduri pierdute), șterge parola, 2FA și passkey-urile adminului; prima deschidere de pe Mac cere din nou parola. Datele rămân.

### 4. Înregistrare și verificarea emailului
> Înlocuit de **FD-INVITE** (conturi doar la cerere, aprobate de admin, activate din link). Rămâne aici pentru istoric.

- **„Creează cont”:** nume, email, parolă (de două ori).
- **Parola:**
  - minimum 12 caractere, cu literă mare, literă mică și cifră;
  - orice simbol e permis, maximum 200 de caractere.
- **După trimitere**, mesajul e mereu același: „Dacă adresa nu era deja folosită, ți-am trimis un email de confirmare”. Nu spune dacă emailul există deja.
- **Linkul de confirmare** e valabil 24 de ore și merge o dată. Deschis, arată „Adresa e confirmată” cu „Intră în cont”; tokenul dispare din bara de adrese.
- **Fără confirmare nu se poate intra:** login-ul (doar cu parola corectă) spune „Confirmă mai întâi adresa de email” și oferă „Trimite din nou linkul de confirmare”.
- **Retrimiterea:** noul link îl anulează pe cel vechi. Cererile care trimit emailuri (retrimitere, parolă uitată) sunt cel mult 3 la 15 minute de pe același calculator; la fel crearea de conturi.
- **Varianta de dezvoltare (acum):**
  - expeditorul `onboarding@resend.dev` poate trimite doar către adresa contului Resend (a ta);
  - pentru ceilalți, Resend refuză mesajul, iar linkul de confirmare apare în jurnalul serverului (`data/logs/`);
  - adminul poate confirma utilizatorul și din pagina „Utilizatori”;
  - când adaugi un domeniu verificat în Resend, schimbi expeditorul din Setări și emailurile ajung la toți.
- Un cont neconfirmat după 7 zile se șterge (adresa devine din nou liberă).

### 5. Login
- **Email și parolă.**
- **Cu 2FA pornit:**
  - urmează „Codul din aplicația de autentificare”: 6 cifre sau un cod de recuperare;
  - fereastra pentru cod e de 5 minute; după ea, se reia de la parolă.
- **Cu un cod de recuperare:** după login ajungi la „Securitate”, cu mesajul că acel cod a fost folosit și câte au rămas.
- **„Intră cu un passkey”:**
  - Touch ID, Face ID, cheie de securitate sau telefon;
  - fără email și fără parolă: passkey-ul ține loc de parolă și de al doilea factor, pentru că cere amprenta sau PIN-ul dispozitivului;
  - butonul apare doar unde browserul permite passkey-uri: pe `localhost` sau pe HTTPS, nu pe `http://192.168…`.
- **Limitarea încercărilor:**
  - 3 încercări greșite (parolă sau cod, socotite împreună) de pe același calculator blochează login-ul 15 minute;
  - mesajul spune câte încercări au rămas;
  - passkey-ul merge și în timpul blocării (nu poate fi ghicit).
- **După login** ajungi pe pagina pe care o cerusei (un link deschis înainte de login, sau pagina unde a expirat sesiunea); după „Ieși” rămâi pe login, fără trimitere înapoi.
- **Sesiunea:**
  - rămâne 30 de zile de la ultima folosire;
  - „Ieși” o închide; „Ieși de pe toate dispozitivele” (în Securitate) le închide pe toate.
- **Un cont dezactivat de admin** nu mai poate intra; sesiunile lui se închid.

### 6. Parola uitată
- **„Am uitat parola”:** emailul, apoi mereu același mesaj („Dacă există un cont confirmat cu această adresă, ți-am trimis un link”).
- **Linkul** e valabil 1 oră; cât e valabil, nu se emite altul (ca în Serento: nimeni nu-l poate invalida trimițând cereri).
- **Parola nouă** închide celelalte sesiuni ale contului. 2FA rămâne pornit: resetarea parolei nu ocolește al doilea factor; pentru telefonul pierdut există codurile de recuperare.

### 7. Pagina „Securitate” (meniul contului)
> Din **FD-2FA**: 2FA e obligatoriu; „Dezactivează” și „Renunță” dispar, apare „Schimbă aplicația de autentificare”.

- **Contul tău:** numele (se poate schimba), emailul și rolul.
- **Schimbă parola:** parola actuală și cea nouă de două ori. Celelalte sesiuni se închid.
- **Autentificare în doi pași (TOTP):**
  - **pornire:** cod QR și cheia scrisă (grupuri de câte 4), plus câmpul pentru primul cod; după confirmare apar **10 coduri de recuperare**, o singură dată, cu „Copiază” și „Descarcă”;
  - **„Cheie nouă”:** generează altă cheie înainte de confirmare (ai scanat pe alt telefon); **„Renunță”** abandonează pornirea;
  - **oprirea și codurile noi** cer parola și un cod (sau un cod de recuperare);
  - **un cod se poate folosi o singură dată**, chiar dacă încă e afișat în aplicație.
- **Passkey-uri:**
  - lista (nume, data adăugării, ultima folosire, „sincronizat” dacă e în iCloud / Google);
  - „Adaugă un passkey”, redenumire, ștergere;
  - ștergerea nu cere al doilea factor: parola rămâne oricum.
- **Sesiuni:** „Ieși de pe toate dispozitivele”.

### 8. Pagina „Utilizatori” (doar admin)
> Din **FD-2FA** §4: „Oprește 2FA” devine „Resetează 2FA” (închide și sesiunile contului).

- **Tabel:** nume, email, rol, email confirmat, 2FA, număr de passkey-uri, creat, ultimul login, stare.
- **Acțiuni:**
  - „Confirmă emailul” (pentru varianta de dezvoltare);
  - „Dezactivează” / „Reactivează”;
  - „Oprește 2FA” (utilizator fără telefon și fără coduri; cere confirmare);
  - „Șterge” (cu toate datele lui, cere confirmare).
- **Limite:** adminul nu se poate dezactiva, șterge sau retrograda pe sine; nu există al doilea admin.

### 9. Acces din rețea
- Sentiq ascultă și pe adresa Mac-ului din rețeaua locală (ex. `http://192.168.1.20:4317` sau `http://numele-macului.local:4317`).
- Cererile cu alt nume de gazdă sunt refuzate (protecția anti-DNS-rebinding de acum, extinsă la adresele Mac-ului).
- macOS poate întreba la prima pornire dacă Node are voie să primească conexiuni: „Allow”.
- Lansatorul și `Sentiq.app` deschid acum `http://localhost:4317`, ca passkey-urile să meargă pe Mac (nu merg pe `127.0.0.1`).
- `scripts/sentiq.sh status` arată și adresele din rețea (`http://192.168.x.y:4317`).

### 10. Cazuri limită
| Situație | Comportament |
|---|---|
| Email scris cu majuscule / spații | normalizat (litere mici, fără spații); unic indiferent de majuscule |
| Înregistrare cu un email deja folosit | același mesaj ca la succes; nu se trimite nimic |
| Link de confirmare expirat / folosit | „Linkul nu mai e valabil”, cu trimitere la login, de unde se cere altul |
| Login cu un cont neconfirmat | „Confirmă mai întâi adresa de email”, cu „Trimite din nou linkul de confirmare” |
| 2FA oprit în alt tab cât aștepta codul | ecranul de cod revine la login; login-ul trece direct |
| Același cod TOTP folosit de două ori | a doua oară e refuzat |
| Ceasul telefonului decalat | codul greșit amintește de ora automată pe telefon (fereastră ±30 s) |
| Passkey șters între timp | „Passkey-ul nu e înregistrat aici” |
| Passkey copiat (contorul scade) | refuzat |
| Passkey pentru alt cont (userHandle diferit) | refuzat |
| Adminul fără parolă, accesat din rețea | doar mesajul care trimite la Mac |
| Cheia Resend lipsă / refuzată | linkul de confirmare apare în jurnal; linkul de resetare apare în jurnal doar când cheia lipsește (un link de resetare e o parolă temporară) |
| Server repornit | sesiunile rămân (sunt în baza de date); provocările passkey în curs se pierd (se reîncearcă) |
| Cookie-ul de sesiune pe `127.0.0.1` vs `localhost` | sunt adrese diferite pentru browser: fiecare cere login separat |
| Utilizator șters | sesiunile, passkey-urile, favoritele, conturile, evenimentele lui dispar |
| Utilizator normal pe o rută de admin | 403 „Doar adminul poate face asta”; meniul nu arată paginile de admin |
| Tab vechi, deschis înainte de login | prima cerere primește 401 și duce la login; după login revine pe aceeași pagină |
| Sesiune folosită zilnic | nu expiră: și cookie-ul din browser primește din nou 30 de zile (cel mult o dată la 5 minute) |
| Alt utilizator intră în același browser imediat după „Ieși” | răspunsurile întârziate ale celui dinainte se aruncă; ecranele noului utilizator se încarcă de la zero |
| URL codificat (`/api/%61dmin/…`) | regulile de acces se aplică rutei găsite, nu textului adresei: refuzat ca orice rută de admin |
| Aceeași monedă la doi utilizatori | fiecare o are în lista lui, cu ordinea și aliasurile lui |
| Același simbol, crypto la unul și acțiune la altul (ex. COIN) | știrile se etichetează cu simbolul; filtrul de favorite îl arată amândurora |
| Adminul fără acces la email, parolă uitată | „Am uitat parola” (Resend de dezvoltare livrează la adresa contului Resend, adică a adminului) sau `admin-reset` din Terminal |

### 11. Conflicte cu funcțiile existente
- **Toate rutele API cer login**, inclusiv logo-urile monedelor, în afară de: `ping`, starea autentificării, login, înregistrare, confirmare, resetare și passkey login. Fișierele interfeței rămân publice (arată ecranul de login). O rută API necunoscută primește tot „intră în cont”, nu „nu există”.
- **Joburile din fundal** (știri, sentiment, calendar, scanner, context) nu au utilizator. Lucrează pe date comune sau pe favoritele tuturor:
  - feed-urile Nasdaq și rezultatele companiilor: pentru acțiunile oricui;
  - sentimentul zilei: pentru fusul orar al fiecăruia;
  - scanner-ul: pentru fiecare utilizator.
- **Bugetul Twelve Data e comun:** graficele de acțiuni ale tuturor consumă din aceleași 800 de cereri pe zi.
- **Lansatorul:** `stop` / `status` rămân la fel; serverul ascultă pe toate interfețele (configurabil cu `SENTIQ_BIND=127.0.0.1` pentru doar-local).
- **CSRF:** antetul `X-Sentiq` rămâne obligatoriu la modificări; în plus, `Origin` trebuie să fie chiar adresa din bara browserului (aceeași origine).
- **Testele și scripturile** care apelau API-ul direct au nevoie de o sesiune.

## FD-IMPACT — Importanța știrilor după Claude; geopolitica la 0,8 (13 oct 2026)

Cererea utilizatorului: „Implementează varianta Claude, doar că vreau să modifici ceva la algoritm. Vreau să ridici impactul evenimentelor geopolitice la 0,8, pentru că în ultima perioadă de când este Trump președinte, aceste evenimente cântăresc foarte mult.”

Cercetare: research §9 (comparația pe 1.240 de știri reale).

Interpretare: „0,8” e **ponderea de relevanță** a știrilor geopolitice (acum 0,6), nu importanța de la Claude, care e pe scara 1–3.

### 1. Importanța fiecărei știri (cât cântărește în indexul zilei)
- **Știre notată de Claude:** importanța dată de Claude (1 = minoră, 2 = notabilă, 3 = mișcă piața), judecată din tot titlul.
- **Știre notată local** (motorul local ales, sau rezerva când Claude nu răspunde): cuvintele-cheie, ca până acum (1; 1,5; 2; 3).
- **„De ce acest scor?”** (pagina Știri) arată importanța folosită și de unde vine; când diferă, și ce ar fi dat cuvintele-cheie, ca valoare separată, fiecare cu sursa ei în paranteză: „Relevanță 1, importanță 2 (Claude), importanță 3 (cuvinte-cheie)”. Prima e cea care intră în sentimentul zilei.

### 2. Știrile geopolitice
- Cele legate de piețe (război, sancțiuni, tarife, petrol, alegeri etc.): relevanța urcă de la **0,6 la 0,8**, deci cântăresc cu o treime mai mult.
- Cele fără nicio legătură cu piețele rămân în afara indexului (relevanța 0, „relevanță scăzută”).
- Se aplică și știrilor deja salvate.

### 3. Istoricul
- La prima pornire după actualizare, istoricul zilnic se **recalculează o dată**, automat, pentru fusurile orare ale tuturor utilizatorilor, ca zilele vechi să fie comparabile cu cele noi.
- O zi din care retenția a șters deja știri își păstrează valoarea de atunci: n-ar mai putea fi recalculată corect. La fel și butonul „Recalculează istoricul zilnic” (Setări, admin), care până acum ștergea și zilele acelea.

### 4. Cazuri limită
| Situație | Comportament |
|---|---|
| Claude nu întoarce rezultat pentru o știre din lot | știrea e notată local → importanța din cuvinte-cheie |
| Motorul trece din Claude în local | știrile notate deja de Claude își păstrează scorul și importanța; cele noi primesc cuvintele-cheie |
| „Renotează ultimele N ore” (admin) | scor și importanță refăcute cu motorul de acum |
| Titlul unei știri se schimbă la sursă | scorul și importanța se refac |
| Se schimbă lista de monede sau favoritele adminului | se recalculează doar importanța din cuvinte-cheie; cea de la Claude rămâne |
| Claude întoarce o importanță în afara 1–3 sau cu zecimale | rotunjită și limitată la 1–3 |
| Știri notate de Claude înainte de actualizare | importanța lor era deja salvată: se folosește și pentru ele |
| Știri notate „doar reguli” (modelul local se descărca) | cuvintele-cheie |
| Zi cu puține știri | Claude dă mai des 1, deci totalul ponderilor e mai mic: indexul se apropie mai mult de 50 și încrederea poate fi mai mică decât înainte; în zilele obișnuite (sute de știri) nu se simte |

### 5. Conflicte cu funcțiile existente
- **FD-USERS §2** (ponderea din lista de monede și favoritele adminului): rămâne valabil doar pentru știrile notate local; la cele de la Claude, monedele etichetate nu mai schimbă importanța (Claude judecă conținutul). Relevanța știrilor despre acțiuni folosește în continuare etichetele.
- **Sub-indicii** pe categorii, „Ce mișcă piața”, evoluția pe ore și „față de acum o oră”: calculate la fel, cu noile ponderi.
- **Scorul** fiecărei știri (−1…+1) nu se schimbă.

## FD-ECON — Pagina „Economie”: indicatorii economici pe țări (13 oct 2026)

Cererea utilizatorului: „Acum îmi trebuie o pagină dedicată pentru situația curentă economică. Adică vreau o pagină care să arate toți indicatorii economici ai piețelor principale, în special Statele Unite. Vreau să văd care este nivelul curent al inflației, care este nivelul curent al Job claims, și toți ceilalți indicatori despre industrie, despre prețuri, despre housing, everything, inclusiv pe o pagină, și toate grupate pe țară, sau, în cazul Uniunii Europene, dacă există informații la nivel de Uniunea Europeană, atunci afișat la nivel de Uniunea Europeană.” Și: „pentru fiecare indicator din această pagină, vreau să adaugi acolo şi data următorului update, dacă se cunoaşte.”

Cercetare: research §10. Sursa: calendarul economic TradingView, cel folosit deja de pagina Calendar.

### 1. Pagina
- În meniu, după Calendar: **„Economie”**, pentru toți utilizatorii (datele sunt comune, ca știrile și calendarul).
- Sus: când s-au actualizat datele, cipuri cu țările (duc la secțiunea țării), căutare după nume și comutatorul **„Doar importante”**.
- **Țările**, în ordine: SUA, Zona euro (UE), Marea Britanie, Japonia, China, Canada, Elveția, Australia, Noua Zeelandă (aceleași ca în Calendar).
- **Uniunea Europeană:** se afișează indicatorii zonei euro (nivelul UE pe care îl publică sursa). Un indicator al Germaniei, Franței, Italiei sau Spaniei apare în aceeași secțiune, cu numele țării, **doar când nu există același indicator la nivelul zonei euro** (ex. Ifo din Germania da, inflația Germaniei nu, pentru că există inflația zonei euro), și doar dacă sursa îl socotește de importanță medie sau mare (fără detaliile regionale, ca inflația fiecărui land german). Între „Esențiale” intră doar cei marcați importanți de sursă.
- **Fiecare țară** are:
  - **„Esențiale”**: indicatorii marcați importanți de sursă (inflația, șomajul, PIB-ul, dobânda, NFP, cererile de șomaj…), ca fișe cu valoarea mare;
  - apoi **toți indicatorii**, pe grupe: Prețuri și inflație, Piața muncii, PIB, Industrie și afaceri, Consum, Locuințe, Bani și dobânzi, Comerț exterior, Buget, Energie, Obligațiuni, Altele (PMI-urile intră la Industrie și afaceri).

### 2. Ce arată fiecare indicator
- **Numele** în română pentru indicatorii obișnuiți (ex. „Cereri inițiale de șomaj”), cu numele original dedesubt („Initial Jobless Claims”); ceilalți păstrează numele original.
- **Ultima valoare**, cu unitatea (%, mii, mil., mld., $, € …), **perioada** la care se referă (ex. „august”, „T2”, „săpt. 3 oct.”) și **data publicării**.
- **Anterior** (valoarea perioadei dinainte, cu revizuirea din ultima publicare) și **schimbarea**.
- **Surpriza** la ultima publicare: peste / sub prognoză, când a existat o prognoză.
- **Următoarea publicare:** data și ora (fusul tău), cât mai e până atunci, și prognoza, dacă se cunoaște. Dacă nu e programată în următoarele ~5 săptămâni (cât publică sursa): „nu e anunțată încă”. Dacă ora a trecut și valoarea n-a venit: „în așteptare”.
- **Istoricul**: un mini-grafic cu ultimele publicări (până la ~13 luni).
- **Explicația**: în română pentru indicatorii din glosarul Calendarului; altfel descrierea sursei (în engleză), la cerere.
- **Sursa oficială** (ex. Bureau of Labor Statistics), cu link.

### 3. Actualizarea
- Valorile noi apar la câteva minute după publicare: se folosesc aceleași citiri ca pagina Calendar (la 15 minute, mai des imediat după publicările importante), fără cereri în plus.
- Programul publicărilor viitoare și prognozele: o dată pe zi.
- Istoricul (≈ 400 de zile): o singură dată, la prima pornire, apoi se completează singur. Publicările mai vechi de 2 ani se șterg.

### 4. Cazuri limită
| Situație | Comportament |
|---|---|
| Sursa nu răspunde | rămân ultimele valori, cu ora actualizării; un mesaj spune că datele pot fi vechi |
| Prima pornire, istoricul încă se încarcă | „Se încarcă istoricul indicatorilor…”; pagina se completează singură |
| Aceeași perioadă publicată de două ori (flash, apoi final) | contează ultima publicare |
| Valoare revizuită | „Anterior” e cea revizuită, din ultima publicare; în istoric rămâne valoarea publicată atunci |
| Publicare amânată (ora a trecut, fără valoare) | ultima valoare rămâne; la „Următoarea”: „în așteptare” |
| Indicator fără nicio valoare publicată (licitații, discursuri, „Calendar”, „Holidays”) | nu apare |
| Indicator care nu mai e publicat | rămâne cu ultima valoare și data ei, până iese din cei 2 ani |
| Valoare fără unitate (indici, ex. PMI) | numai numărul; la PMI, 50 = pragul dintre expansiune și contracție (în explicație) |
| Căutare fără rezultat | „Niciun indicator nu se potrivește”; țările fără rezultat se ascund |
| Ecran de telefon | fișele una sub alta; tabelele se derulează pe orizontală în cutia lor |

### 5. Conflicte cu funcțiile existente
- **Calendarul** nu se schimbă (aceleași citiri, aceleași evenimente); citirea lui alimentează și pagina Economie.
- **Sentimentul zilei** nu folosește pagina Economie.
- **Utilizatori (FD-USERS):** pagina e comună, ca Știrile și Calendarul; fusul orar e al fiecăruia.
- **Căutarea ⌘K** găsește și pagina „Economie”.

## FD-ECONCOLOR — Culori pe pagina „Economie” (13 oct 2026)

Cererea utilizatorului: „Pe rândurile de indicatori, să colorezi valorile de diferite culori. Și, de exemplu, dacă o valoare a crescut sau a scăzut, să poarte o culoare potrivită, verde sau roșu, în funcție de faptul dacă este bine sau rău. De exemplu, dacă inflația crește, este rău; dacă inflația scade, este bine. Dacă PIB-ul a crescut, este bine; dacă a scăzut, este rău. … Apoi, istoricul, graficul de istoric, acolo trebuie și el să fie colorat, la fel ca în cardurile de indicatori … să dau un pic de culoare acestor rânduri, pentru că sunt prea banale și mă pierd în ele.”

Cercetare: research §11 (sensul fiecărui indicator, pe toate cele 344 de nume din baza reală).

### 1. Regula
- Fiecare indicator are un **sens**: creșterea e bună (ex. PIB, locuri de muncă), rea (ex. inflație, șomaj, dobânzi) sau neutră (ex. salarii, stocuri, prețul locuințelor).
- **Verde** = schimbarea față de perioada anterioară e bună pentru economie; **roșu** = e rea; **neutru** (culoarea textului) = indicator neutru, schimbare zero sau fără valoare anterioară.

### 2. Unde apar culorile
- **Rândurile din tabele:** ultima valoare și schimbarea (cu săgeată ▲ / ▼: săgeata arată direcția, culoarea arată dacă e bine sau rău); valoarea anterioară rămâne discretă.
- **Istoricul din tabele:** linia aurie, ca în fișe, cu un punct la capăt colorat după ultima schimbare.
- **Fișele „Esențiale”:** la fel: valoarea, schimbarea și punctul de la capătul graficului.
- **Detaliile rândului:** „peste / sub prognoză” colorat după același sens.
- Sus pe pagină, o legendă scurtă: „Verde = bine pentru economie, roșu = rău (ex. inflația în creștere e roșie, PIB-ul în creștere e verde); fără culoare = neutru.”

### 3. Cazuri limită
| Situație | Culoare |
|---|---|
| Schimbare 0, sau fără valoare anterioară | neutru |
| Indicator neutru (salarii, stocuri, prețul locuințelor…) | neutru; săgeata arată totuși direcția |
| Indicator necunoscut (nume nou de la sursă) | după grupa lui (prețuri: creșterea rea; muncă, PIB, industrie, consum, locuințe, comerț: bună; restul: neutru) |
| Dobânzi și randamente | creșterea e roșie (finanțare mai scumpă) |
| NFP foarte puternic | verde (perspectiva economiei, nu reacția bursei) |

### 4. Conflicte cu funcțiile existente
- **Tema „Cockpit”:** verde / roșu înseamnă în rest „sus / jos”; pe pagina Economie înseamnă „bine / rău”. Legenda o spune explicit; săgeata păstrează direcția.
- Datele, calculele și restul paginii nu se schimbă.

## FD-ECONFILTER — Țările din pagina „Economie” devin filtre (13 oct 2026)

Cererea utilizatorului: „Ancorele pe care le-ai pus tu acolo, pentru țări sau zone, care să mă ducă către indicatorii țării sau zonei, vreau să se transforme în filtre. Și când apăs pe 1, se activează filtrul ăla și îmi afișează indicatorii doar pentru țara respectivă.”

Cercetare (în cod): cipurile erau linkuri spre secțiunile țărilor; stilul `.chip[aria-pressed='true']` există deja (cipurile active din Știri și Grafice); celelalte filtre ale paginii sunt căutarea și „Doar importante”.

### 1. Comportament
- Bara de sus are cipurile **„Toate”** și câte unul pentru fiecare țară / zonă, fiecare cu numărul de indicatori afișabili (ex. „SUA 189”).
- **Un click pe o țară** o activează: pagina arată doar indicatorii ei. Cipul activ e evidențiat.
- **Un click pe țara activă** sau pe **„Toate”** arată din nou toate țările.
- Se alege **o singură țară** odată (cum s-a cerut: „doar pentru țara respectivă”).
- Filtrul ales stă în adresa paginii (`/economy?tara=US`): rămâne la reîncărcare, la întoarcerea pe pagină și într-un link trimis cuiva.

### 2. Împreună cu căutarea și „Doar importante”
- Numerele de pe cipuri țin cont de căutare și de „Doar importante”; țările fără niciun rezultat dispar din bară (în afară de cea activă).
- Dacă țara activă nu are rezultate pentru căutarea curentă: „Niciun indicator din <țară> nu se potrivește.”, cu butonul „Caută în toate țările”.

### 3. Cazuri limită
| Situație | Comportament |
|---|---|
| Cod de țară necunoscut în adresă (`?tara=XX`) | toate țările |
| Țara activă nu mai are date | rămâne activă, cu mesajul de mai sus |
| Pagina se reîmprospătează singură (la 5 minute) | filtrul rămâne |
| Telefon | cipurile se așază pe mai multe rânduri |

### 4. Conflicte
- Cipurile nu mai sar la secțiunea țării (o arată singură). Titlul țării rămâne deasupra indicatorilor ei.

## FD-SUMMARY — „Rezumat”: rezumatul zilei cu Claude, pe pagina Azi (13 oct 2026)

Cererea utilizatorului: „on the first page, that is, on the page today, there should be a button on the left of the search field called Summary, and when I press it, a pop-up opens for me, a bigger one, … in which Claude can make me a summary of the day, up to the point … because things change over time. And I want you to show me a summary, written and possibly with a few graphs, if that's the case, depending on the situation. Gen, dacă astăzi s-au afișat niște indicatori noi, să îi văd sub formă de grafice, practic cu rolul de a-mi spune overall dacă este o zi bună de trading sau nu.”

Cercetare: research §12.

### 1. Butonul
- Pe pagina **Azi**, în bara de sus, în stânga câmpului de căutare: **„Rezumat”** (cu o iconiță de scânteie). Pe celelalte pagini nu apare. Numele e în română, ca restul interfeței.

### 2. Fereastra
- O fereastră mare (aproape tot ecranul pe laptop, tot ecranul pe telefon), peste pagină; se închide cu ×, Esc sau click în afara ei.
- **Sus:** „Rezumatul zilei”, ora până la care e făcut (ex. „azi până la 15:20”), când a fost generat și modelul (modelul doar pe ecrane mari) și butonul **„Actualizează”** (pe telefon doar iconița).
- **Verdictul**, mare și colorat: **„Zi bună de trading”** (verde), **„Zi mixtă”** (galben) sau **„Zi slabă: prudență”** (roșu), cu încrederea (scăzută / medie / ridicată), o frază de titlu și 2–4 fraze de ansamblu.
- **Textul**, pe secțiuni scurte (ex. Sentiment, Macro și indicatori, Crypto, Acțiuni), plus două liste: **Oportunități** și **Riscuri**, și **„Ce urmează”** (evenimentele importante din următoarele 24 de ore, cu ora).
- **Graficele**, 0–4, alese de Claude după situație, fiecare cu o frază despre ce arată: evoluția sentimentului azi, sub-indicii, istoricul indicatorilor publicați azi (cu prognoza și culoarea bine / rău din pagina Economie), variația favoritelor pe 24 h, sentimentul ultimelor 7 zile. Cifrele vin din aplicație, nu din Claude.
- **Jos:** din ce date s-a făcut și „Nu este un sfat de investiții”.

### 3. Când se generează
- La prima deschidere din zi (pentru tine), rezumatul se generează automat (~20–60 s, cu un mesaj de așteptare).
- La redeschidere apare ultimul rezumat de azi, cu „generat acum X min”; **„Actualizează”** face unul nou cu datele de acum. Cât se generează, cel vechi rămâne vizibil, estompat.
- O actualizare se poate cere cel mult o dată la 2 minute (butonul arată cât mai e); două cereri simultane (dublu click, două tab-uri) produc un singur rezumat.
- A doua zi (în fusul tău orar) rezumatul vechi nu mai apare.

### 4. Ce primește Claude
- Doar datele aplicației despre azi: sentimentul și știrile (titluri, scoruri), calendarul (inclusiv evenimentele notate de tine, cu titlul și ora, marcate ca ale tale; nu și notița lor), indicatorii economici, contextul pieței și **favoritele tale** cu semnalele din scanner. Nu primește chei, conturi, portofolii, email sau alte date personale.
- Fiecare utilizator are rezumatul lui (favoritele și fusul lui).

### 5. Cazuri limită
| Situație | Comportament |
|---|---|
| Nu e pusă cheia Claude | fereastra explică: „Rezumatul folosește Claude: cheia se pune în Setări → Motorul de sentiment” (adminul are link direct; ceilalți: „o pune adminul”) |
| Cheie invalidă / fără acces la model | mesajul erorii, în română; rămâne ultimul rezumat |
| Claude nu răspunde / refuză / răspuns tăiat | „Rezumatul nu s-a putut genera…”, cu „Încearcă din nou”; rămâne ultimul rezumat |
| Dimineața devreme, puține date | Claude o spune; încrederea e scăzută |
| Weekend / bursa închisă | spus în rezumat (crypto merge, acțiunile nu) |
| Claude alege un grafic care nu există | e ignorat |
| Nicio știre / niciun indicator azi | rezumatul se face din ce există; graficele lipsă nu apar |
| Fereastră pe telefon | o coloană; graficele una sub alta |
| ⌘K cu rezumatul deschis | rezumatul se închide și se deschide căutarea |
| Fereastra nu se poate încărca (tab vechi după o actualizare a aplicației) | o fereastră mică: „Aplicația a fost actualizată între timp: reîncarcă pagina”, cu „Reîncarcă pagina” și „Închide”; restul paginii merge |

### 6. Conflicte cu funcțiile existente
- **Cheia Claude** e cea a motorului de sentiment (a adminului): fiecare rezumat costă puțin (research §12), indiferent cine îl cere.
- **Motorul de sentiment** nu se schimbă; rezumatul nu modifică nimic din aplicație.
- **Bara de sus:** butonul apare doar pe Azi; ⌘K rămâne neschimbat.

---

## FD-MCP — Connector Claude: fiecare își folosește abonamentul Claude (13 oct 2026)

Cererea utilizatorului: Sentiq nu se vinde; îl folosesc el și 3–4 prieteni, fiecare cu **abonamentul lui Claude**, fără cost API; aplicația va fi pusă online. „Ce vreau să construiești este MCP-ul să fie gata. Și-l vom implementa abia după ce avem un URL public. Până atunci nu legi nimic de acest MCP.”

Cercetare: research §13 (termenii Anthropic nu permit aplicației să folosească abonamentele; calea permisă e un connector MCP).

### 1. Ce face
- Sentiq devine un **connector pentru Claude**: fiecare utilizator îl adaugă o singură dată în Claude (claude.ai → Customize → Connectors → *Add custom connector*, adresa `https://<adresa Sentiq>/mcp`), se loghează cu contul lui Sentiq și aprobă accesul.
- Apoi, în Claude (web, desktop, telefon; și Claude Code), întreabă orice despre piață („e o zi bună de trading?”, „ce s-a întâmplat cu SOL?”); Claude citește datele lui din Sentiq și face analiza **pe abonamentul lui**. Poate pune întrebări de continuare și poate desena singur grafice din cifre.

### 2. Starea până avem adresă publică
- Codul e complet și testat, dar **oprit**. Pornește doar cu amândouă: `SENTIQ_PUBLIC_URL=https://…` (adresa publică) și `SENTIQ_MCP=1`.
- Cât e oprit: nu există nicio rută nouă (404 pe `/mcp`, `/oauth/…`, `/.well-known/…`), pagina Securitate nu arată nimic nou, nimic din aplicație nu se schimbă.
- `SENTIQ_MCP=1` fără o adresă publică validă (https; `http://localhost` doar pentru teste locale): rămâne oprit, cu un avertisment în jurnal.

### 3. Ce poate citi Claude (doar citire, doar datele tale)
| Unealtă | Ce întoarce |
|---|---|
| **Ziua de azi** | tot contextul zilei (sentiment, știri importante, calendar, indicatori publicați azi, piața, favoritele), același ca la Rezumat |
| **Sentimentul** | indexul de azi (pe ore, pe categorii, știrile care trag în sus / jos) și ultimele 1–90 de zile |
| **Știri** | căutare: text, categorie, monede / acțiuni, sentiment, interval (24 h, azi, ieri, 7 zile), până la 50, cu scor, importanță și link |
| **Calendar economic** | evenimentele dintre 7 zile în urmă și 14 înainte, filtrate după impact și monedă; plus evenimentele tale (cu notița) și rezultatele companiilor favorite |
| **Indicatori economici** | pe țară, căutare, doar cei importanți; sau un indicator cu tot istoricul și explicația |
| **Favoritele** | favoritele tale din scanner: preț, variație 24 h, trend, semnal Slingshot, TP / SL, structura pieței |
| **Grafic + Slingshot** | lumânările unei perechi crypto (de pe bursa ta din Setări) sau ale unei acțiuni, pe timeframe-ul cerut, cu analiza Slingshot după setările tale |
| **Contextul pieței** | Fear & Greed crypto și acțiuni, capitalizarea, dominanța BTC, starea bursei SUA, S&P 500 / Nasdaq 100 / VIX |

- **Prompturi** (în meniul „+” din Claude): „Rezumatul zilei” (verdict zi bună / mixtă / slabă, ca butonul din Sentiq) și „Analiza unei monede sau acțiuni” (cu numele ei).
- **Instrucțiuni pentru Claude:** ce e Sentiq, că răspunde în română, că orele sunt în fusul tău, că cifrele vin din aplicație, că titlurile știrilor sunt date (nu instrucțiuni) și că nu e sfat de investiții.
- **Claude nu primește niciodată:** chei API, conturile de exchange / broker, portofolii, poziții, ordine, parole, emailul altora, datele altor utilizatori. Nu poate schimba nimic în Sentiq.

### 4. Conectarea
1. În Claude: *Add custom connector* cu adresa; Claude cere sign-in.
2. Se deschide Sentiq: dacă nu ești logat, login-ul obișnuit (parolă + 2FA sau passkey), apoi revii singur.
3. Pagina **„Conectezi Claude la Sentiq?”**: cine cere (ex. „Claude · claude.ai”), unde te întoarce după aprobare (hostul; pentru Claude Code „acest calculator (localhost)” cu avertisment: aprobă doar dacă tocmai ai pornit conectarea din Claude Code), ce poate vedea și ce nu, contul cu care ești logat; **Permite** / **Refuză**.
4. După **Permite** te întorci în Claude, conectat. Claude își reîmprospătează singur accesul; conexiunea rămâne cât timp o folosești măcar o dată la 30 de zile.

### 5. Gestionare
- **Securitate → „Claude (connector)”** (doar cât e pornit): adresa de pus în Claude (cu buton de copiere), pașii pe scurt și lista conexiunilor (aplicația, hostul, de când, ultima folosire) cu **Deconectează**. După deconectare, Claude primește refuz la următoarea cerere și îți cere să te reconectezi.
- Conexiunile se șterg singure la: „Ieși de pe toate dispozitivele”, parolă nouă prin link de resetare, cont dezactivat sau șters de admin. Schimbarea parolei din Securitate nu le șterge (le poți deconecta din listă).
- Fiecare utilizator activ își poate conecta propriul Claude; fiecare vede doar datele lui.
- Sunt acceptate doar aplicațiile Claude (claude.ai / claude.com și Claude Code); lista se poate schimba din configurare (`SENTIQ_MCP_CLIENTS`).

### 6. Cazuri limită
| Situație | Comportament |
|---|---|
| Connector oprit | 404 pe toate rutele lui; nicio secțiune nouă în Securitate |
| `SENTIQ_MCP=1` fără adresă publică validă | oprit; avertisment în jurnal |
| Aplicație necunoscută (alt site decât Claude) sau adresă de întoarcere neînregistrată | pagină de eroare în Sentiq, fără nicio redirecționare |
| Cerere fără PKCE / cu altă metodă decât S256 / pentru altă resursă | Claude primește eroarea (`invalid_request`, `invalid_target`) |
| Refuzi | Claude primește `access_denied`; nimic salvat |
| Cererea de autorizare expiră (10 min) sau serverul a repornit între timp | „Cererea a expirat sau a pornit din alt browser. Pornește din nou conectarea din Claude.” |
| Cineva îți trimite un link de consimțământ pornit de el (ca să-i conectezi datele tale la Claude-ul lui) | refuzat: o cerere poate fi aprobată doar din browserul care a pornit-o (cookie de 10 min); același mesaj ca mai sus |
| Două conectări pornite în paralel în același browser | doar ultima poate fi aprobată; prima cere repornire |
| Codul de autorizare folosit de două ori | conexiunea creată cu el se anulează (cod furat) |
| Token de reîmprospătare folosit din nou după rotire | după 60 s: conexiunea se anulează (token furat); în primele 60 s (o repetare a lui Claude după un timeout): refuz fără anulare |
| Cont dezactivat / șters | accesul încetează imediat (401), conexiunile se șterg |
| Prea multe cereri | token: 429; unelte: peste 300 de cereri în 5 min pe conexiune → 429 |
| Lipsesc datele (scanner încă nepornit, istoric nescris) | Claude primește un text clar („scannerul n-a terminat încă…”) |
| Monedă / acțiune necunoscută la grafic, bursa nu răspunde, limita Twelve Data | eroarea în română, ca rezultat al uneltei |
| Repornirea serverului | conexiunile rămân (în baza de date) |

### 7. Conflicte cu funcțiile existente
- **Securitatea HTTP:** `/mcp` și endpoint-urile OAuth nu folosesc cookie-ul de sesiune (doar token Bearer, respectiv PKCE), deci nu cer header-ul `X-Sentiq`, iar `/oauth/token` și `/oauth/revoke` primesc formular (`application/x-www-form-urlencoded`), cum cere OAuth. Host-ul public intră automat în lista de adrese permise; un `Origin` străin rămâne refuzat. Pagina de consimțământ și lista conexiunilor sunt rute `/api` obișnuite (sesiune + `X-Sentiq`).
- **Login / 2FA / passkey:** neschimbate; consimțământul cere login complet.
- **Rezumat (FD-SUMMARY):** rămâne cu cheia API (pentru cine o are); promptul „Rezumatul zilei” din Claude e varianta pe abonament. „Ziua de azi” e același text, dar numește indicatorii după cheia pe care o primește „Indicatori economici” și nu are lista de grafice a Rezumatului.
- **Twelve Data:** graficele de acțiuni cerute de Claude folosesc același buget gratuit (8 / min, 800 / zi) ca scannerul și pagina Grafice; bugetul nu se depășește niciodată, dar dacă Claude cere multe grafice, scannerul folosește o vreme ultimele valori.
- **Sentiment:** neschimbat.
- **Multi-user:** fiecare conexiune e legată de un utilizator; uneltele folosesc fusul, favoritele, scannerul, setările indicatorului și evenimentele lui.
- **Hosting (etapa următoare):** în spatele unui proxy HTTPS trebuie setat `trustProxy` (IP-ul real pentru limitele de cereri, cookie-ul `Secure`) și passkey-urile pe domeniu; se tratează în FD-ul de hosting.

---

## FD-INVITE — Conturi doar la cerere, aprobate de admin (13 oct 2026)

Cererea utilizatorului: „vreau să elimin funcționalitatea de creare de cont și să o înlocuiesc cu «vreau să cer un cont». Utilizatorul face cerere și își completează numele și adresa de e-mail. Dacă eu aprob asta într-un panou de administrare, utilizatorul va primi un e-mail, un link să-și activeze contul. Când îl deschide, își poate seta parola și continua mai departe cu logarea.”

Înlocuiește FD-USERS §4 (înregistrarea și confirmarea emailului) și „Confirmă emailul” din FD-USERS §8. Restul FD-USERS (login, 2FA, passkey, parola uitată, Securitate) rămâne.

### 1. Cererea de cont (oricine)
- Pe pagina de login, în loc de „Creează un cont”: **„Cere un cont”** → pagina „Cere un cont”: **nume** și **email**, butonul „Trimite cererea”. Fără parolă.
- După trimitere, mesajul e mereu același: „Am primit cererea. Când adminul o aprobă, primești pe email un link ca să-ți activezi contul.” Nu spune dacă adresa are deja un cont sau o cerere. Cu expeditorul de test al Resend se adaugă: „Deocamdată emailurile Sentiq ajung doar la admin: linkul de activare ți-l trimite el.”
- Adminul află imediat: primește un email „Cerere nouă de cont: Nume (email)” cu link spre pagina Utilizatori, iar în meniul contului apare un punct auriu și „Utilizatori · 1 cerere”.
- Limite: cel mult 3 cereri la 15 minute de pe același calculator; cel mult 50 de cereri în așteptare (peste: „Nu mai primim cereri acum. Încearcă mai târziu.”); o cerere neaprobată în 30 de zile dispare.

### 2. Panoul de administrare (Utilizatori, doar admin)
- Sus, **„Cereri de cont”**: nume, email, de când; **Aprobă** / **Respinge** (cu confirmare). Fără cereri: secțiunea nu apare.
- **Respinge:** cererea dispare, fără niciun email; persoana poate cere din nou.
- **Aprobă:** contul se creează (cu favoritele implicite BTC, ETH, SOL), fără parolă, cu starea **„Așteaptă activarea”**, și i se trimite emailul cu linkul de activare (valabil **7 zile**). Panoul arată rezultatul:
  - „Email trimis la ana@…” sau
  - „Emailul nu a plecat (cheia Resend de test livrează doar la adresa ta). Trimite-i tu linkul:” + linkul + **Copiază**.
  - Linkul se vede doar acum (Sentiq păstrează doar o amprentă a lui); se poate face oricând unul nou.
- În tabelul conturilor, un cont „Așteaptă activarea” are **„Link nou de activare”** (anulează linkul vechi, trimite un email nou, arată linkul) și **Șterge**.
- Linkul folosește adresa publică (`SENTIQ_PUBLIC_URL`) când există, altfel adresa din care adminul folosește Sentiq; dacă aceea e `localhost`, panoul avertizează că linkul merge doar pe Mac-ul lui.

### 3. Activarea (cel aprobat)
> Din **FD-2FA** §1: după parolă urmează direct configurarea 2FA, deja în cont (fără „Intră în cont”).

- Emailul „Sentiq · contul tău a fost aprobat”: „Setează-ți parola ca să intri. Linkul e valabil 7 zile.” cu butonul **„Activează contul”**.
- Pagina „Activează-ți contul”: numele și emailul (fixe), **parola** de două ori (aceeași regulă: minimum 12 caractere, literă mare, mică și cifră). Linkul dispare din bara de adrese.
- După salvare: „Contul e activ” cu **„Intră în cont”**, care deschide login-ul cu emailul completat. Adresa e confirmată prin chiar folosirea linkului.
- Linkul merge o singură dată; expirat, folosit sau anulat: „Linkul nu mai e valabil. Cere adminului unul nou.”

### 4. Ce dispare
- „Creează un cont” (pagina și API-ul), confirmarea separată a emailului, „Trimite din nou linkul de confirmare”, „Confirmă emailul” din Utilizatori, ștergerea automată a conturilor neconfirmate. Adresele vechi `/register` și `/verify-email` duc la „Cere un cont”, respectiv la login.

### 5. Cazuri limită
| Situație | Comportament |
|---|---|
| Cerere pentru o adresă care are cont | același mesaj; nimic creat; adminul nu e anunțat |
| A doua cerere pentru aceeași adresă | același mesaj; rămâne prima (numele nu se poate suprascrie de altcineva) |
| 50 de cereri în așteptare | „Nu mai primim cereri acum. Încearcă mai târziu.” |
| Nume gol / email invalid | eroare în formular |
| Aprobare pentru o adresă care între timp a primit cont | „Adresa are deja un cont”; cererea dispare |
| Aprobare / respingere de două ori (dublu click, două taburi) | a doua: „Cererea nu mai există” |
| Login cu emailul unui cont neactivat | „Email sau parolă greșită” (nu are parolă) |
| „Am uitat parola” pentru un cont neactivat | același mesaj generic, niciun email (activarea se face din linkul de activare) |
| Link de activare expirat / înlocuit / folosit | „Linkul nu mai e valabil. Cere adminului unul nou.” |
| Contul șters sau dezactivat de admin înainte de activare | linkul nu mai merge |
| Linkul deschis într-un browser logat cu alt cont (ex. adminul îl încearcă) | activarea merge; ecranul de succes spune că trebuie ieșit întâi din contul curent („Intră în cont” duce în contul curent) |
| Resend cu expeditorul de test | emailurile către ceilalți nu pleacă: adminul vede linkul și îl trimite el; emailul către admin (cerere nouă) pleacă |
| Fără cheie Resend | niciun email; adminul vede cererile în panou și linkul la aprobare |

### 6. Conflicte cu funcțiile existente
- **FD-USERS §4 / §8:** înlocuite ca mai sus; contul de admin și primul lui acces nu se schimbă.
- **Login / 2FA / passkey / parola uitată:** neschimbate; un cont neactivat nu are parolă, deci nu poate intra și nu primește link de parolă nouă.
- **Scanner, sentiment, favorite:** un cont aprobat primește favoritele implicite, dar e scanat abia după activare (ca un cont neconfirmat până acum).
- **Emailuri:** linkul de activare (care pune o parolă) nu se scrie niciodată în jurnal: adminul îl are în panou.
- **Connectorul Claude (FD-MCP):** neschimbat; un cont neactivat nu se poate loga, deci nici conecta.

---

## FD-STALE — „Importing a module script failed.” după o actualizare (reparație, 13 oct 2026)

Cererea utilizatorului: „te rog rezolvă erorile astea: Importing a module script failed. sunt prea dese.”

### 1. Cauza
- Paginile (Știri, Calendar, Economie, Grafice, Setări, Utilizatori…) și ferestre ca Rezumatul se încarcă la cerere, din fișiere cu nume unic pe fiecare versiune (`News-AbC123.js`).
- Fiecare actualizare a interfeței (build) ștergea fișierele versiunii anterioare. Un tab deschis înainte de actualizare cerea, la următoarea pagină, un fișier care nu mai exista; Safari spune atunci „Importing a module script failed.” (Chrome: „Failed to fetch dynamically imported module”), iar pagina arăta „Pagina nu a putut fi afișată”.
- Azi au fost multe actualizări una după alta, deci eroarea a apărut des. Se poate întâmpla și când serverul repornește exact când se încarcă o pagină.

### 2. Ce se schimbă
- **Fișierele versiunilor anterioare rămân 7 zile** după o actualizare: un tab vechi își găsește în continuare paginile și merge mai departe cu versiunea lui până la următoarea reîncărcare.
- **Dacă totuși un fișier lipsește** (tab deschis de peste 7 zile, server în repornire): pagina **se reîncarcă singură** și deschide versiunea nouă, fără mesaj de eroare. Înainte așteaptă ca serverul să răspundă (cel mult un minut), ca să nu ajungă pe ecranul „nu se poate conecta” al browserului.
- O singură reîncărcare la 30 de secunde: dacă după reîncărcare tot nu merge (o problemă reală), apare mesajul de până acum, cu „Reîncarcă pagina”.

### 3. Cazuri limită
| Situație | Comportament |
|---|---|
| Tab deschis înainte de o actualizare, pagină nouă cerută | merge (fișierele vechi există încă) |
| Tab deschis de peste 7 zile după o actualizare | reîncărcare automată, apoi pagina cerută |
| Serverul repornește chiar atunci | așteaptă până răspunde (verificare la 2 s, cel mult 60 s), apoi reîncarcă; dacă nu răspunde, mesajul de eroare rămâne |
| Fișier lipsă și după reîncărcare | fără buclă: a doua oară în 30 s apare mesajul „Pagina nu a putut fi afișată” |
| Formular pe jumătate completat când se reîncarcă | se pierde (rar: doar după 7 zile sau la o repornire) |
| `npm run dev` (Vite dev server) | neschimbat |

### 4. Conflicte
- **FD-STATIC:** fișierele se citesc tot de pe disc la fiecare cerere; un fișier lipsă e tot un 404 adevărat (nu pagina HTML).
- **Rezumatul (fereastra lui de eroare):** rămâne pentru cazul în care reîncărcarea nu ajută.

---

## FD-THEME — Tema luminoasă și comutatorul (13 oct 2026)

Cererea utilizatorului: „acum creează o temă luminoasă și pune buton de comutare. Salvezi preferința în local storage.”

### 1. Tema luminoasă
- Aceeași aplicație „Cockpit” (structură, plăci, tipografie Geist, auriul ca accent), pe hârtie rece: fundal gri foarte deschis, plăci albe, linii fine gri, text aproape negru.
- Culorile cu sens rămân aceleași ca rol: auriul = marca / selecția, verdele = sus / bine, roșul = jos / rău, portocaliul = atenție; doar nuanțele sunt mai închise, ca să se citească pe alb (contrast de cel puțin 4,5:1 pentru orice text, pe orice fundal al temei).
- Butonul principal devine auriu închis cu text alb; selecțiile (segmentele) la fel.
- Graficul cu lumânări (Grafice) trece și el pe alb, cu axele în gri; lumânările verde / roșu rămân. Liniile PnL și ordinele de pe grafic au nuanțe mai închise. Indicatorul Slingshot și LMA păstrează culorile din scriptul Pine (ca pe TradingView, la fel pe fundal deschis); tabelul lui TAKE PROFIT / STOP LOSS rămâne pe placa lui închisă, ca neonul să se citească.
- Ferestrele (căutarea ⌘K, Rezumatul, asistentul de conturi, consimțământul) au fundalul paginii ușor întunecat dedesubt, nu negru; umbrele sunt discrete.
- Codul QR din 2FA rămâne pe alb; logo-urile brokerilor se văd pe ambele teme (Revolut primește placa lui neagră, ca celelalte).

### 2. Comutatorul
- În bara de sus, lângă căutare: un buton cu **soare** (pe tema întunecată: „Trece la tema luminoasă”) sau **lună** (pe tema luminoasă: „Trece la tema întunecată”).
- Pe telefon, în **meniul contului** (inițiala, sus în dreapta): „Temă luminoasă” / „Temă întunecată”; bara de sus rămâne pe un rând (pe Azi are deja „Rezumat”).
- Și pe paginile fără cont (login, cerere de cont, activare, parolă nouă), sus în dreapta.
- Comutarea e imediată, fără reîncărcare, pe toată pagina (inclusiv graficul).

### 3. Preferința
- Se păstrează în **localStorage** (`sentiq:theme` = `light` / `dark`), pe acel browser, pentru toate conturile de pe el.
- Fără preferință: **tema întunecată** (cum e acum).
- La deschidere, tema se aplică înainte de primul desen (fără clipire întunecat → luminos).
- Două taburi deschise: comutarea într-unul se vede și în celălalt.

### 4. Cazuri limită
| Situație | Comportament |
|---|---|
| localStorage indisponibil (mod privat strict) | comutarea merge până la reîncărcare; apoi tema implicită |
| Valoare necunoscută în localStorage | tema întunecată |
| Graficul deschis când comuți | se recolorează pe loc, fără să piardă zoom-ul |
| Telefon | comutarea în meniul contului (bara de sus rămâne pe un rând); câmpurile și barele de derulare urmează tema (`color-scheme`) |
| Pagina de eroare a connectorului Claude, emailurile | neschimbate (pagini separate) |

### 5. Conflicte
- **FD-REDESIGN (Cockpit):** tema întunecată rămâne implicită și neschimbată; tema luminoasă folosește aceleași denumiri de culori (tokenuri), deci fiecare pagină o primește automat.
- **CSP (`script-src 'self'`):** scriptul care aplică tema înainte de desen e un fișier al aplicației, nu cod inline.
- **FD-STALE:** fișierul temei e servit ca restul fișierelor publice.

## FD-THEME2 — Tema luminoasă refăcută (Navy), rânduri alternate, hover vizibil, graficul pe suprafața lui (13 oct 2026)

Cererea utilizatorului: „Refă tema, pentru că trebuie să existe elemente mai contrastante. Este greu de citit […] cea mai gravă chestie este că fundalul graficului este aceeași culoare cu fundalul aplicației. […] Pune și tu alternating row colors […] în tabele unde am rânduri […] Hover events pe chestii, să fie mult mai evidente […] nu e obligatoriu să folosești tot o variațiune de culoare gold ca accent […] Poți să folosești un albastru […] sau o combinație de culori pastel, dar trebuie să faci o întreagă paletă.”

Pe pânza Claude Design s-au arătat trei direcții (A Cobalt, B Pastel, C Navy). Utilizatorul a ales **C · Navy (bară închisă)** și ca rândurile alternate, hover-ul vizibil și suprafața graficului să fie aplicate **pe ambele teme** (tema întunecată își păstrează culorile și auriul).

### 1. Tema luminoasă „Navy”
- **Bara de sus și banda pieței sunt închise, bleumarin** (bara `#14233b`, banda `#1b2d4a`), cu text deschis; restul paginii e deschis. Ancorează pagina și separă clar navigarea de conținut.
- **Pagina** gri-albăstruie deschisă (`#eef1f5`); **plăcile albe** cu chenar vizibil (gri-albastru `#c3ccd8`) și o umbră discretă — plăcile nu se mai topesc în fundal.
- **Accentul devine turcoaz închis** (`#0b6f80`), nu auriu: butonul principal, segmentele selectate (ex. intervalul graficului), legăturile de tip „Vezi toate”, inelul de focus, indicatorul zilei.
- **Filtrele selectate** (cipurile apăsate: „Toate”, monede, impact, valute) sunt pline, bleumarin cu text alb.
- **Navigarea:** pagina curentă e o „pastilă” albă cu text bleumarin; la hover, fundal alb translucid și text alb.
- **Câmpurile** (căutare, formulare) au fundal gri foarte deschis și chenar mai închis decât plăcile.
- Culorile cu sens rămân: verde = sus / bine, roșu = jos / rău, portocaliu = atenție, nuanțe închise pentru alb; pe bara închisă au variante deschise (verde mentă, roșu somon).
- **Contrast:** orice text are cel puțin 4,5:1 pe orice fundal al temei, inclusiv pe rândurile alternate, pe hover și pe bara bleumarin; chenarele de focus / hover cel puțin 3:1.

### 2. Graficul pe suprafața lui (ambele teme)
- Placa graficului (Grafice) are fundalul **plăcii**, nu al paginii: pe tema luminoasă, alb cu chenar pe pagina gri; pe tema întunecată, gri-negru de placă pe pagina neagră. Canvas-ul graficului are aceeași culoare cu placa lui.
- Pe ecran complet: pagina rămâne în jur, graficul pe placa lui.
- Lumânările, Slingshot, LMA și tabelul TP/SL păstrează culorile (paritate cu TradingView / Pine).

### 3. Rânduri alternate (ambele teme)
- În **toate tabelele** (Tranzacții, Economie, Grafice — semnale, Stare sistem, Securitate, Utilizatori, Setări) rândurile pare au un fundal ușor diferit (pe tema întunecată discret, abia mai deschis decât placa — cerut de utilizator după prima variantă); capul tabelului are o bandă proprie (pe tema luminoasă gri, pe cea întunecată mai închisă decât placa).
- În **listele cu rânduri**: Știri (pagina Știri și „Știri” de pe Azi), alertele Slingshot (Grafice), cererile de cont (Utilizatori).
- Un rând deschis (detaliile unui indicator pe Economie) nu strică alternanța: rândul de detalii nu se numără și stă sub rândul lui.
- Rândurile alternate ajung până la marginile plăcii; prima coloană rămâne aliniată cu titlul plăcii.

### 4. Hover vizibil (ambele teme)
- **Rânduri** de tabel și de listă: fundal colorat cu accentul (turcoaz deschis pe luminos, auriu foarte închis pe întunecat), clar diferit de rândul alternat.
- **Butoane** (`Actualizează`, `Indicatori`, săgețile din Calendar etc.): chenar în culoarea accentului, fundal colorat, text în accent. Butonul principal se închide la culoare; butonul de ștergere rămâne roșu.
- **Cipuri / filtre:** chenar și text în accent, fundal colorat; cele selectate rămân pline și primesc chenar de accent.
- **Segmente** (intervalul graficului, tab-uri): fundal colorat și text accent; cel selectat rămâne plin.
- **Navigarea** de sus, **căutarea**, **comutatorul de temă**, **meniul contului**: fundal și chenar evidente (pe bara închisă, alb translucid).
- **Elemente de listă** (rezultatele căutării ⌘K, meniul contului, căutarea de perechi din Grafice, căutarea din Setări, cardurile de pe Azi, cardurile de cont din asistent, evenimentele din Calendar cu detalii): fundal colorat și/sau chenar în accent.
- **Banda pieței:** fiecare monedă / acțiune / eveniment primește fundal la hover (banda se oprește deja sub cursor).
- Tranziție scurtă (150 ms); cu „reduce motion” instantanee.

### 5. Cazuri limită
| Situație | Comportament |
|---|---|
| Meniul contului se deschide din bara închisă | fereastra meniului folosește culorile paginii (alb), nu ale barei |
| Rezumatul, căutarea ⌘K, asistentul de conturi | ferestre pe culorile paginii (nu sunt în bară) |
| Tabel cu un singur rând / gol | fără alternanță vizibilă; mesajul „gol” neschimbat |
| Rând tras (Setări → favorite) | păstrează umbra și fundalul de tragere peste alternanță |
| Rând dezactivat (surse oprite) | text estompat, alternanța rămâne |
| Hover pe un element dezactivat (segment fără date, buton dezactivat) | fără fundal de hover |
| Telefon (fără hover) | alternanța rămâne; hover-ul nu apare; focusul de tastatură rămâne inelul de accent |
| Tema întunecată | aceleași culori ca înainte, plus alternanță, cap de tabel, hover și graficul pe placă |
| Paginile fără cont (login etc.) | pagina Navy deschisă cu plăci albe (fără bară) |
| Consimțământul connectorului Claude (OFF până la URL public) | pagina deschisă, plăci albe, accent turcoaz |

### 6. Conflicte
- **FD-THEME:** comutatorul, localStorage și aplicarea înainte de desen rămân; se schimbă doar paleta luminoasă și se adaugă tokenuri.
- **FD-REDESIGN (Cockpit):** auriul rămâne accentul temei întunecate; numele tokenului de accent devine neutru (`accent`), pentru că pe tema luminoasă e turcoaz.
- **FD-CHARTUX:** graficul rămâne fără grilă; doar fundalul se schimbă (placa, nu pagina).
- **PnL pe grafic:** linia de intrare urmează accentul temei (turcoaz pe luminos).

## FD-NOAPI — Fără platformele care nu au API (13 oct 2026)

Cererea utilizatorului: „elimină exchange-urile / brokerii care nu au API. Ce rost are să îi afișăm?”

### 1. Ce se schimbă
- Asistentul „Adaugă un cont” arată doar platformele care se pot conecta: KuCoin, Binance, Bybit, OKX, Kraken, Coinbase, Bitget (crypto) și Trading 212, eToro, Interactive Brokers, Alpaca (acțiuni).
- XTB, Tradeville, Revolut și Degiro dispar din listă (și din căutarea ei). Motivul rămâne documentat în [research.md §8](research.md): XTB și-a închis API-ul în martie 2025; Tradeville, Revolut (acțiuni) și Degiro nu oferă API pentru clienți.
- Dacă una dintre ele publică un API, se adaugă ca orice platformă nouă (o intrare în listă, cu câmpurile, pașii și citirea datelor).

### 2. Cazuri limită
| Situație | Comportament |
|---|---|
| Cauți „XTB” în asistent | „Nicio platformă cu acest nume.” |
| Filtrul „Acțiuni” | cele 4 platforme de acțiuni care se conectează |
| Un tab deschis înainte de actualizare (asistentul vechi, cu cardurile estompate) | cardurile vechi nu se pot apăsa; după reîncărcare dispar |
| O cerere directă către server pentru `xtb` (de exemplu din tabul vechi) | refuzată: „Platformă necunoscută: xtb” |
| Conturi salvate pe aceste platforme | nu există (nu s-au putut adăuga niciodată); verificat în baza de date |

### 3. Conflicte
- **FD-SENTIQ §2** (cardurile „fără API”): înlocuit de această secțiune.
- **FD-THEME §1** (placa neagră pentru logo-ul Revolut): nu mai e nevoie; logo-ul dispare.

## FD-AZURE — Baza de date în Azure SQL; pregătit pentru Azure App Service (13 oct 2026)

Cererea utilizatorului (după ce a respins o mașină virtuală Linux): „rescrierea este 100% de făcut. Știam de la bun început că vom rescrie pentru SQL, deci vom folosi o bază de date SQL de la Microsoft. […] o mașină virtuală Linux necesită o tonă de configurare, mai ales pe partea de security […] Linux este exclus, decât dacă este patchuit și făcut, pusă securitatea de către cineva care se pricepe.” A ales: **Azure SQL Database** (o creează el) + **Azure App Service pe Linux administrat de Microsoft** (patch-uri făcute de Microsoft, fără SSH deschis spre internet); rescrierea direct pe `main`, fără commit înainte; testele automate **în aceeași bază, separat** de datele reale.

### 1. Ce se schimbă
- **Datele stau în Azure SQL Database**, nu în fișierul `data/kryptoniq.db`. Paginile, funcțiile și datele rămân aceleași; nimic nu se schimbă la vedere, în afară de pagina Stare sistem (§5).
- **Conexiunea** se scrie într-un fișier local, `data/database.env` (nu ajunge în git, doar contul utilizatorului îl poate citi), sau, pe Azure, ca „Application settings” cu aceleași nume:
  - `SENTIQ_DB_SERVER`, `SENTIQ_DB_NAME`, `SENTIQ_DB_USER`, `SENTIQ_DB_PASSWORD`, **sau**
  - `SENTIQ_DB_CONNECTION` = connection string-ul ADO.NET din portal (cu parola pusă în locul lui `{your_password}`).
  Valorile se scriu fără ghilimele; tot ce urmează după `=` e valoarea. Setările din mediu au prioritate față de fișier.
- **Utilizatorul bazei** recomandat e unul doar pentru baza Sentiq (`CREATE USER … WITH PASSWORD` + `db_owner` pe baza Sentiq), nu adminul serverului: dacă serverul găzduiește și alte baze (Serento), Sentiq nu le poate vedea.
- **Mutarea datelor existente** se face o singură dată, cu `scripts/sentiq.sh import-sqlite`: utilizatorii (parole, 2FA, passkey-uri, sesiuni), conturile și cheile criptate, favoritele, setările, sursele și știrile, calendarul, pagina Economie, rezumatele, connectorul. Fișierul SQLite rămâne pe disc ca rezervă și nu mai e folosit.
- **Cheia master** (`data/master.key`) rămâne aceeași: pe Mac e fișierul, pe Azure se pune ca setarea `SENTIQ_MASTER_KEY` (base64, recomandat dintr-un Azure Key Vault). Fără aceeași cheie, cheile de exchange / broker și cele ale aplicației nu mai pot fi citite.
- **Backup**: îl face Azure SQL (Basic: restaurare la orice moment din ultimele 7 zile). Copiile `VACUUM INTO` din `data/backups/` nu se mai fac; cele vechi rămân.
- **Pe Azure App Service** (publicarea propriu-zisă e pasul următor, cu pașii din [deploy-azure.md](deploy-azure.md)):
  - HTTPS-ul îl face Azure; aplicația recunoaște că e în spatele lui și citește corect IP-ul vizitatorului și faptul că legătura e HTTPS (cookie `Secure`, limitele de încercări pe IP-ul real, passkey).
  - răspunde pe adresa `<nume>.azurewebsites.net` și pe adresa publică (`SENTIQ_PUBLIC_URL`, domeniul ales);
  - datele locale (modelul de sentiment, jurnalele) stau în `/home/data`, care supraviețuiește actualizărilor;
  - connectorul Claude rămâne **oprit** până când utilizatorul spune altfel (FD-MCP).
- **Joburile de fundal** (știri, calendar, sentiment, piață, scanner, mentenanță) rulează **o singură dată**, chiar dacă pornesc două copii ale aplicației pe aceeași bază (Mac + Azure, sau două instanțe în timpul unei actualizări): una le rulează, cealaltă doar servește paginile. Dacă cea care le rula se oprește, cealaltă le preia în cel mult ~2 minute. Semnalele scanner-ului (Slingshot pe favorite) se țin în memoria fiecărei instanțe: pe cea care nu rulează joburile, scanarea pornește când o pagină le cere (cel mult o dată pe minut), deci apar la următoarea reîmprospătare.
- **Testele automate** rulează în baza Sentiq, fiecare în scheme proprii (`t_…`), cu utilizatori de test care nu au acces la tabelele reale; la final schemele și utilizatorii se șterg. Resturile unei rulări întrerupte (mai vechi de 3 ore) se șterg la rularea următoare. Fără acces la bază, doar testele care au nevoie de ea eșuează, cu motivul.

### 2. Pornirea și erorile de conexiune
| Situație | Comportament |
|---|---|
| `data/database.env` lipsește sau e incomplet (și nu sunt setări în mediu) | Sentiq nu pornește; `sentiq.sh start` și jurnalul spun „Baza de date nu e configurată: completează data/database.env (server, bază, utilizator, parolă sau connection string).” |
| Utilizator / parolă greșite | „Baza de date a refuzat utilizatorul X: verifică utilizatorul și parola din data/database.env (pe Azure, setările SENTIQ_DB_* ale aplicației).” |
| IP-ul nu e permis în firewall-ul serverului | „Serverul Azure SQL nu acceptă conexiuni de la IP-ul A.B.C.D: adaugă-l în Networking → Firewall rules.” |
| Baza nu există / utilizatorul nu are acces la ea | „Baza X nu există pe server sau utilizatorul nu are acces la ea.” |
| Serverul nu răspunde (adresă greșită, rețea) | „Serverul de baze de date nu răspunde (S): verifică adresa și conexiunea la internet.”, urmat de „Detaliu:” cu mesajul driverului (adresă, port, timeout), fără parolă |
| Baza cade sau e indisponibilă temporar în timpul rulării (mentenanță Azure) | citirile se reîncearcă de câteva ori; dacă tot nu merge, pagina arată „Baza de date nu răspunde acum. Reîncearcă în câteva secunde.” (503); joburile reîncearcă la rularea următoare; aplicația revine singură, fără repornire |
| Prea multe scrieri simultane (o scriere așteaptă peste 30 s) | 503 cu același mesaj; nu se pierde nimic din ce s-a salvat deja |
| Baza se apropie de limita de spațiu (Basic: 2 GB) | Stare sistem arată ocuparea; peste 80% o marchează ca avertisment |
| Parola nu apare niciodată | nici în jurnal, nici în mesajele de eroare, nici în Stare sistem |
| Lipsește cheia master (pe Azure fără `SENTIQ_MASTER_KEY`, pe alt calculator fără `data/master.key`), iar baza are deja chei criptate | Sentiq nu pornește: „Cheia master lipsește …, dar baza are deja chei criptate cu ea: pune aceeași cheie, altfel nu mai pot fi citite.” O cheie nouă se face doar pe o bază fără nimic criptat |

### 3. Mutarea datelor (`sentiq.sh import-sqlite`)
| Situație | Comportament |
|---|---|
| Aplicația veche încă rulează pe Mac | refuză: „Oprește întâi Sentiq (scripts/sentiq.sh stop): ce se salvează după copie s-ar pierde.” |
| Sentiq rulează deja pe Azure pe aceeași bază (un `--replace` târziu) | importul nu poate vedea asta de pe Mac: App Service se oprește întâi din portal (*Stop*), apoi se pornește la loc |
| Baza Azure e goală (doar adminul inițial, fără parolă) | copiază totul într-o singură tranzacție, apoi compară numărul de rânduri din fiecare tabel și verifică faptul că cheia master deschide cheile salvate |
| Baza Azure are deja date | refuză: „Baza are deja date (N utilizatori, M știri). Ca s-o înlocuiești cu datele de pe Mac: import-sqlite --replace.” |
| `--replace` | șterge tot din baza Azure și copiază din nou, tot într-o tranzacție |
| Eroare la jumătate (rețea, spațiu) | nu rămâne nimic pe jumătate: tranzacția se anulează, baza rămâne cum era |
| Fișierul SQLite e de la o versiune mai veche | întâi i se aplică migrările SQLite vechi (pe o copie), apoi se mută |
| Fișierul SQLite e de la o versiune necunoscută (mai nouă) | refuză, cu versiunea găsită |
| Cheia master de pe Mac nu deschide cheile salvate | mutarea se face (cheile rămân criptate), dar avertizează: „Cheia master nu deschide cheile salvate: folosește același data/master.key cu care au fost salvate.” |
| Cheia master lipsește pe calculatorul care face mutarea | mutarea se face, dar avertizează că Sentiq nu pornește fără cheia cu care au fost salvate cheile (nu face una nouă) |
| Sesiunile | se mută: pe Mac rămâi logat. Pe adresa publică (alt domeniu) fiecare se loghează din nou |
| Passkey-urile | se mută, dar merg doar pe domeniul pe care au fost create (`localhost`); pe adresa publică fiecare își adaugă un passkey nou (Securitate). Parola și 2FA merg peste tot |

### 4. Contul de admin și siguranța
- Prima parolă a adminului (pe o bază nouă) și refacerea ei după `sentiq.sh admin-reset` se fac în continuare **doar de pe Mac**, la `http://localhost:4317`, cu Mac-ul legat la aceeași bază. Pe Azure nu există „Mac-ul pe care rulează Sentiq”, deci acolo pagina de primă parolă nu apare niciodată.
- `sentiq.sh admin-email` și `admin-reset` lucrează pe baza din `data/database.env`.
- În spatele Azure, aplicația trimite și `Strict-Transport-Security` (browserul folosește doar HTTPS pe domeniul ei).

### 5. Stare sistem (admin)
- „Baza de date”: Azure SQL, serverul și numele bazei, nivelul (de ex. Basic), spațiul ocupat din maxim (avertisment peste 80%).
- „Joburi”: pe ce instanță rulează (numele mașinii); dacă instanța curentă nu le rulează, o spune.

### 6. Cazuri limită de date
| Situație | Comportament |
|---|---|
| Emailuri care diferă doar prin litere mari / mici | tratate ca același email (ca înainte) |
| Orice alt text (simboluri, ID-uri, coduri, chei) | comparat exact, literă cu literă (ca înainte) |
| URL-uri foarte lungi (știri, feed-uri) | se salvează întregi; duplicatele se recunosc la fel ca înainte |
| Două cereri simultane care modifică același lucru (de ex. două taburi care salvează setări, aprobarea aceleiași cereri de cont de două ori, același cod 2FA trimis de două ori) | se execută una după alta; a doua vede rezultatul primei (cererea deja aprobată, codul deja folosit) |
| Pagina e deschisă când Sentiq trece pe noua bază | după repornire, pagina se reîncarcă normal (FD-STALE); sesiunea rămâne |

### 7. Conflicte cu ce exista
- **TD §3** (SQLite, `PRAGMA`, backup prin `VACUUM INTO`) → înlocuit: Azure SQL, schema versionată în tabelul `schema_version`, backup-ul Azure.
- **FD-USERS §9 / TD §2.11** (prima parolă doar de pe Mac): rămâne; pe Azure pagina nu apare niciodată (§4).
- **FD-LAUNCH** (pornirea pe Mac): `sentiq.sh` rămâne, dar cere `data/database.env` și are două comenzi noi: `import-sqlite` și `db-check` (verifică conexiunea fără a afișa parola).
- **Testele** (TD §14): rulează pe baza din `data/database.env`, deci cer conexiune la internet și baza pornită.
- **Aplicația pornită acum pe Mac** rulează codul vechi (SQLite) până la repornire. Repornirea se face doar după ce baza e configurată și datele sunt mutate (§3), altfel aplicația nu pornește. *(Făcut pe 14 oct 2026: backup `data/backups/kryptoniq-before-azure-2026-10-14.db`, `import-sqlite`, pornirea pe codul nou; vezi jurnalul de review.)*

## FD-ONLINE — Connectorul Claude pornit pe sentiq.money; adresa publică știută și de Mac (14 oct 2026)

Cererea utilizatorului: „ok, totul funcționează. hai cu mcp-ul.” Înainte, utilizatorul a legat domeniul **sentiq.money** de App Service (cu certificat) și a pus `SENTIQ_PUBLIC_URL=https://sentiq.money`; `sentiq.app` nu mai e folosit.

### 1. Connectorul pornit
- Pe App Service: `SENTIQ_MCP=1` (14 oct 2026, 11:29 UTC). Jurnalul spune „Claude connector on: https://sentiq.money/mcp”.
- Verificat din exterior:
  - documentele de descoperire (`/.well-known/oauth-protected-resource/mcp`, `/.well-known/oauth-authorization-server`);
  - `/mcp` fără token răspunde 401 cu `resource_metadata` și `scope`;
  - autorizarea cu documentul real al Claude (`https://claude.ai/oauth/mcp-oauth-client-metadata`) ajunge la pagina de consimțământ. Cererea e ținută doar în memorie, deci nu se scrie nimic în bază.
- **Cum îl adaugă fiecare:**
  1. În Claude: Customize → Connectors → **Add custom connector**.
  2. Nume „Sentiq”, URL `https://sentiq.money/mcp`. Clientul OAuth rămâne cel implicit, „Use Claude's published identity”.
  3. **Add**, apoi **Connect**: se deschide sentiq.money.
  4. Intri cu contul Sentiq (parolă + 2FA, sau passkey făcut pe sentiq.money) și apeși **Permite**.
- Merge în claude.ai, în aplicația Desktop și pe mobil (connectorul ține de contul Claude).
  - Pe abonamentul **Free** se poate adăuga un singur connector propriu; pe Pro și Max, oricâți.
  - În Claude Code: `claude mcp add --transport http sentiq https://sentiq.money/mcp`, apoi `/mcp` pentru login.
- Neschimbat față de FD-MCP: Claude doar citește, doar datele celui care s-a conectat. Nu vede chei, conturi de exchange sau portofolii.

### 2. Adresa publică, știută și de Mac
Mac-ul nu are `SENTIQ_PUBLIC_URL`. Fără o schimbare:
- linkurile de activare făcute de pe Mac ar duce la `http://localhost:4317`, deci nu ar merge pentru prieteni;
- Securitate pe Mac nu ar arăta connectorul.

Ce se schimbă:
- Instanța care are `SENTIQ_PUBLIC_URL` (Azure) scrie la pornire în bază adresa publică și dacă e pornit connectorul.
- O instanță de pe App Service fără `SENTIQ_PUBLIC_URL` șterge această înregistrare la pornire. O instanță locală (Mac) fără ea nu schimbă nimic.
- Mac-ul folosește adresa din bază pentru:
  - **linkurile** de activare (din emailuri și din pagina Utilizatori) și cel din emailul adminului despre o cerere nouă: `https://sentiq.money/…`. Merg pentru oricine, chiar dacă adminul aprobă de pe Mac, iar avertismentul „merge doar pe acest Mac” dispare singur. Linkul de parolă uitată duce, ca înainte, la adresa de pe care a fost cerut;
  - **Securitate → „Claude (connector)”**: aceeași adresă de copiat în Claude, conexiunile tale și „Deconectează”. Conectarea propriu-zisă se face din Claude, către sentiq.money.
- Mac-ul nu devine connector. Rutele `/mcp` și `/oauth/*` există doar pe instanța publică.
- O adresă publică pusă direct pe o instanță (`SENTIQ_PUBLIC_URL`) are prioritate față de cea din bază.

### 3. Texte rămase din vremea „doar pe Mac”
| Unde | Acum |
|---|---|
| Conturi (Setări) și asistentul de cont | „Cheile se salvează criptat în baza Sentiq și nu mai sunt afișate.” Confirmarea ștergerii: „Cheile lui se șterg din Sentiq.” |
| Motorul de sentiment (Setări admin) | „Local: model AI pe serverul Sentiq, plus reguli de piață. Gratuit.” |
| Email (Setări admin) | ce pleacă prin Resend: cererile de cont, linkurile de activare și de parolă nouă; fără cheie, linkurile sunt în jurnalul serverului. Cu expeditorul de test: „… până atunci, trimite-le tu linkul de activare din pagina Utilizatori.” (confirmarea manuală a adresei nu mai există din FD-INVITE) |
| Passkey-uri (Securitate) | „… Merge doar pe adresa pe care l-ai creat: unul făcut pe adresa publică nu merge pe http://localhost și invers.” |
| Login pe o adresă unde passkey-urile nu merg (o adresă IP din rețea) | „Passkey-urile nu merg pe o adresă IP. Deschide Sentiq la https://sentiq.money sau la http://localhost:4317 pe Mac-ul care îl rulează.” (adresa publică doar dacă e cunoscută) |
| Bannerul „Serverul nu răspunde” | pe Mac (`localhost`), ca acum: deschide Sentiq.app sau `scripts/sentiq.sh start`. Pe orice altă adresă: „Serverul Sentiq nu răspunde. Datele afișate pot fi vechi; pagina revine singură când serverul răspunde.” |

### 4. Cazuri limită
| Situație | Comportament |
|---|---|
| Adresa publică se schimbă (alt domeniu) | Azure o scrie pe cea nouă la pornire, iar Mac-ul o vede în cel mult 30 de secunde. Connectorii adăugați în Claude pe vechea adresă trebuie adăugați din nou |
| `SENTIQ_MCP` scos de pe Azure | panoul connectorului dispare și pe Azure, și pe Mac. Conexiunile rămân în bază, dar nu mai sunt folosite; pornit din nou, connectorul le acceptă cât timp n-au expirat |
| `SENTIQ_PUBLIC_URL` scos de pe Azure | la pornire, Azure șterge adresa din bază; Mac-ul revine la linkuri `localhost`, cu avertismentul de pe Utilizatori |
| Azure e oprit | linkurile făcute pe Mac duc tot la sentiq.money, care nu răspunde până pornește Azure |
| Un passkey făcut pe `localhost`, folosit pe sentiq.money | nu merge (alt domeniu). Intri cu parola + 2FA, apoi adaugi un passkey nou pe sentiq.money (Securitate) |
| Un prieten pe Free are deja un connector propriu | Claude nu-l lasă să adauge al doilea; îl scoate pe celălalt sau trece pe Pro |
| „Ieși de pe toate dispozitivele”, parolă nouă, cont dezactivat | conexiunile Claude se închid, de pe oricare instanță (ca până acum) |
| Mac și Azure pornesc în același timp | doar Azure scrie adresa; Mac-ul o citește |
| Server de test cu `SENTIQ_PUBLIC_URL=http://localhost:…` | nu scrie nimic: o adresă `localhost` nu e publică. Un server de test cu o adresă https scrie doar în schema lui de test |

### 5. Conflicte cu ce exista
- **FD-MCP / Partea I §13** („gata, oprit”): acum e **pornit** pe sentiq.money. Utilizatorul a decis asta („hai cu mcp-ul”).
- **FD-INVITE §2** (linkul de activare „merge doar pe acest Mac” când adminul aprobă de pe Mac): nu mai e cazul cât timp există adresa publică.
- **FD-AZURE §3** („passkey-urile merg doar pe `localhost`; pe adresa publică fiecare își adaugă unul nou”): rămâne valabil; textele din aplicație spun asta acum (§3).
- **Partea I §9** („publicarea efectivă … connectorul pornit”): făcut, deci scos din listă.

## FD-ADMINSET — Setările adminului, separate (14 oct 2026)

Cererea utilizatorului: „vreau să existe o secțiune dedicată setărilor de admin. setările de acum trebuie să fie strict ale utilizatorului iar setările de admin să apară doar pentru admin.”

### 1. Ce se schimbă
- Pagina **Setări** are două file:
  - **Ale mele** (`/settings`);
  - **Admin** (`/settings/admin`), doar pentru admin.
- Ceilalți utilizatori nu văd bara cu file, ci direct setările lor.
- **Ale mele** (oricine, doar pentru contul lui):
  - **Favorite**;
  - **Conturi** (exchange-uri și brokeri);
  - **Grafice și scanner**: exchange-ul graficelor, timeframe-ul, lumânările, timeframe-ul scanner-ului, plus o notă despre sursa datelor pentru acțiuni (Nasdaq, Twelve Data dacă adminul a pus cheia);
  - **General**: fusul orar.
- **Admin** (doar adminul). Sus scrie „Aceste setări se aplică tuturor utilizatorilor.”:
  - **Surse de știri**;
  - **Motorul de sentiment**: motorul, modelul, cheia Anthropic (folosită și de Rezumat), „Rescorează ultimele 48 h”, „Recalculează istoricul”;
  - **Date de piață**: cheia Twelve Data și consumul zilei;
  - **Păstrarea știrilor** (zile);
  - **Email (Resend)**.
- Căutarea ⌘K are, pentru admin, și „Setări admin”.
- Linkurile spre setările adminului duc acum la fila Admin:
  - „Pune cheia în Setări admin” (Rezumat fără cheie) → `/settings/admin#sentiment`;
  - „Adaugă cheia gratuită” (graficul unei acțiuni fără Twelve Data) → `/settings/admin#market-data`.
- Pe server, drepturile rămân aceleași: un utilizator care trimite o setare globală primește 403.
- În plus, detaliile emailului (cheia Resend setată, expeditorul, „doar la admin”) nu se mai trimit decât adminului. Sunt setări de admin.

### 2. Cazuri limită
| Situație | Comportament |
|---|---|
| Un utilizator deschide `/settings/admin` (link primit) | „Pagina nu există.”, ca la `/users` și `/health` |
| Adminul folosește un link vechi `/settings#market` | rămâne pe „Ale mele”, la secțiunea Grafice și scanner (ancora `market` rămâne acolo) |
| Setările nu se pot încărca | fiecare filă arată eroarea cu „Reîncearcă” |
| Trecerea între file | schimbă adresa; Înapoi din browser revine la fila dinainte |
| Telefon | filele încap pe un rând deasupra secțiunilor |
| Ziua („fusul orar”) | rămâne a fiecăruia, în „Ale mele” |
| Timeframe-urile acțiunilor fără cheie Twelve Data | nota din „Ale mele” spune că adminul poate pune cheia. Pentru admin, nota are linkul spre fila Admin |

### 3. Conflicte cu ce exista
- **FD-USERS §2** (ce e al fiecăruia, ce e al adminului): neschimbat ca reguli; se schimbă doar locul din pagină.
- **FD-SENTIQ §4.3** (cheia Twelve Data în Setări → Date de piață): acum în Setări → Admin → Date de piață.
- **FD-SET / Partea I §7**: rescris pe cele două file.

## FD-AUTOFEED — Feed-ul automat al unei acțiuni dispare odată cu ea (14 oct 2026)

Cererea utilizatorului: „sursele de știri văd că afișează nasdaq: bsol dar nu înțeleg de ce. este automată, dar nu am în portofoliu bsol. verifică de ce nu dispare din listă.” Apoi: „nu e vb de ce e activată, ci de ce există”.

### 1. De ce exista
- BSOL a fost în favorite pe 13 oct. Copia de siguranță de dinainte de conturi are feed-ul lui activ, iar cele de după îl au oprit.
- După ce BSOL a fost scos, regula din FD-SENTIQ §4.4 a oprit feed-ul, dar l-a **păstrat** cât timp știrile lui erau în bază. Asta înseamnă până la 90 de zile (păstrarea știrilor), ca să nu se piardă știrile odată cu sursa.
- Rândul a rămas deci în listă, deși BSOL nu mai e în favoritele nimănui.

### 2. Regula nouă
- Un feed automat există doar cât timp acțiunea e în favoritele **cuiva** (oricare utilizator).
- Când acțiunea iese din ultimele favorite, feed-ul **se șterge imediat**, cu știrile venite doar prin el.
- Acele știri erau oricum ascunse: o sursă oprită nu apare nicăieri și nu intră în sentiment.
- Feed-urile rămase așa de dinainte (BSOL) se șterg la prima pornire după actualizare.
- Eticheta „automată” spune acum: „Adăugată pentru o acțiune din favoritele cuiva. Dispare când acțiunea nu mai e în favoritele nimănui.”

### 3. Cazuri limită
| Situație | Comportament |
|---|---|
| Acțiunea e încă în favoritele altui utilizator | feed-ul rămâne (sursele sunt comune) |
| Adminul a oprit feed-ul, iar acțiunea e încă în favorite | rămâne oprit; se șterge când acțiunea iese din toate favoritele |
| Acțiunea e adăugată din nou | feed-ul se creează din nou și se citește la următoarea rundă de știri (imediat pe instanța cu joburile, în cel mult un minut de pe cealaltă); revin știrile pe care feed-ul le mai are |
| Aceeași poveste a venit și prin alte surse | grupul rămâne, cu celelalte surse |
| O știre care a venit întâi prin feed-ul acțiunii (salvată o singură dată, la prima sursă) | dispare odată cu feed-ul; era deja ascunsă cât feed-ul era oprit, deci nu se schimbă nimic la vedere |
| Zilele închise ale sentimentului | rămân cum au fost salvate. „Recalculează istoricul” le refăcea și înainte fără știrile unei surse oprite |
| O sursă adăugată de mână cu aceeași adresă | nu e automată, deci rămâne |
| Mac și Azure fac curățenia în același timp | se face o singură dată (tranzacție) |
| Feed-ul e șters chiar în timp ce e citit (pe instanța cu joburile) | citirea se oprește cu un avertisment în jurnal; nu se salvează nimic |

### 4. Conflicte cu ce exista
- **FD-SENTIQ §4.4 / Partea I §2.1** („feed-ul pleacă după ce acțiunea iese din favorite și știrile ei s-au învechit”): înlocuit de §2.

## FD-TODAYGRID — Azi: „Ce mișcă piața” și „Ultimele 30 de zile” deasupra favoritelor (14 oct 2026)

Cererile utilizatorului:
- „coloanele de ce mișcă piața și ultimele 30 de zile când e zoom-ul paginii mai mic, se listează împreună cu simbolurile. și se fac foarte lungi pe verticală. nu le mai afișa în rând cu simbolurile ci deasupra simbolurilor.”
- apoi: „pe prima pagina vreau ca sentimentul zilei sa fie afisata in coloana din stanga si apoi in coloana din dreapta pe 2 randuri care acopera toata inaltimea sentimentului zilei sa fie urmatorul eveniment major si stiri live.”

### 1. Cauza
- Pe ecrane late (cel puțin 1280 px; pe un laptop, cu zoom sub 100%), al treilea rând punea alături Favoritele (jumătate), „Ce mișcă piața” (un sfert) și „Ultimele 30 de zile” (un sfert).
- Un rând are înălțimea celei mai înalte plăci. Cu multe favorite, cele două plăci se întindeau pe toată înălțimea favoritelor.
- Sub 1280 px, sentimentul zilei ocupa tot rândul, iar „Următorul eveniment major” și „Știri live” veneau dedesubt, alăturate. Așezarea cu sentimentul în stânga exista doar pe ecrane late.

### 2. Ce se schimbă
- De la 768 px în sus: **sentimentul zilei în coloana din stânga**; în dreapta, unul sub altul, „Următorul eveniment major” și „Știri live”, care împreună acoperă toată înălțimea sentimentului. Dacă ele sunt mai înalte decât sentimentul, placa sentimentului crește până la ele.
- „Ce mișcă piața” și „Ultimele 30 de zile” stau, la orice lățime, **deasupra** favoritelor.

| Lățime | Așezare |
|---|---|
| Lată (≥ 1280 px) | sentimentul (7/12) │ eveniment + știri (5/12); apoi „Ce mișcă piața” (7/12) │ „Ultimele 30 de zile” (5/12); apoi Favoritele pe toată lățimea (mai multe fișe pe rând) |
| Medie (768–1279 px) | sentimentul │ eveniment + știri, pe jumătăți; apoi cele două plăci alăturate; apoi Favoritele pe toată lățimea. În placa sentimentului, cele patru categorii se așază 2 × 2 când placa e îngustă |
| Îngustă (< 768 px) | una sub alta: sentimentul, evenimentul, știrile, „Ce mișcă piața”, „Ultimele 30 de zile”, Favoritele |

### 3. Cazuri limită
| Situație | Comportament |
|---|---|
| „Arată toate” la „Ce mișcă piața” | crește doar rândul celor două plăci. Graficul celor 30 de zile rămâne sus în placa lui, cu înălțimea lui. Favoritele coboară |
| Nicio favorită | placa „Adaugă favorite” e pe toată lățimea, sub cele două |
| Nimic notabil încă / istoricul abia începe | plăcile își arată mesajele, ca înainte |

### 4. Conflicte cu ce exista
- **Partea I §11**: ordinea plăcilor se schimbă. „Un ecran la 1440 × 900” rămâne valabil pentru plăcile de sus; favoritele sunt sub ele.
- **TD-REDESIGN** („sub 1280 px … sentimentul pe tot rândul”): înlocuit; sentimentul are coloana lui de la 768 px.

## FD-MARKETSRC — Prețurile crypto de la exchange-ul tău; „Grafice și scanner” scos din setările clientului (14 oct 2026)

Cererile utilizatorului:
- „de ce Grafice și scanner este opțiune? vreau să înțeleg. eu sunt client al acestei aplicații. nu mă interesează de unde vin datele.”
- „Dacă un utilizator se conectează cu un exchange, este garantat că exchange-ul acela oferă informația despre datele pe care le folosim când afișăm graficul, că dacă da, atunci îl selectăm automat în funcție de ce exchange are conectat. Dacă are mai multe exchange-uri conectate, atunci trebuie să-l punem să aleagă.”
- La propunerea de mai jos (cu cele 6 puncte): „da”.

### 1. Ce am verificat (14 oct 2026, live, pe datele publice și pe cele 10 favorite crypto ale adminului)
| Exchange | Favoritele în perechi /USDT | 1500 de lumânări de 1h | Timeframe-uri lipsă |
|---|---|---|---|
| KuCoin, Binance | toate | da | – |
| Bybit, OKX, Bitget | toate | da | 8h |
| Kraken | lipsesc 6 din 10 | **nu**, doar ultimele 720 | 3m, 2h, 6h, 8h, 12h |
| Coinbase | lipsesc 7 din 10 | da | 3m, **4h**, 8h, 12h, **1w** |

- Lumânările sunt date publice: cheia contului nu e folosită pentru ele.
- Exchange-ul conectat arată doar unde tranzacționează omul, ca să-i arătăm prețurile de acolo (pe grafic apar și intrarea, TP-ul și SL-ul din contul lui).
- Kraken și Coinbase nu pot fi surse pentru grafice: lucrează mai ales în USD, iar Kraken nu dă istoricul de care are nevoie Slingshot.
- Bitget devine sursă nouă (dă tot ce trebuie).

### 2. Ce se schimbă
1. **Automat.** Prețurile crypto ale unui utilizator vin de la exchange-ul lui conectat, dacă e unul dintre KuCoin, Binance, Bybit, OKX, Bitget. Asta înseamnă graficele, banda de sus, fișele și semnalele de pe Azi, căutarea monedelor și connectorul Claude.
2. **Mai multe exchange-uri conectate (dintre cele 5).** În Setări → Ale mele → Conturi apare „Prețurile crypto vin de la:”, cu exchange-urile lui, ca să aleagă. Până alege, se folosește primul adăugat. Cu un singur exchange (sau niciunul), alegerea nu apare.
3. **Niciun exchange dintre cele 5** (niciun cont, doar Kraken / Coinbase, doar brokeri): se folosește **exchange-ul implicit**, ales de admin în Setări → Admin → Date de piață.
4. **O favorită pe care exchange-ul lui n-o are:** prețul și graficul ei vin de la exchange-ul implicit, fără nimic de setat.
5. **Un timeframe pe care exchange-ul nu-l are** (8h pe Bybit / OKX / Bitget): pe grafic butonul e dezactivat, cu explicația în titlu, ca la acțiuni. Dacă ultimul timeframe ales nu există acolo, graficul arată cel mai apropiat și spune asta.
6. **Setări → Ale mele** nu mai are secțiunea „Grafice și scanner”:
   - timeframe-ul graficului se alege doar pe pagina Grafice (era deja acolo);
   - **timeframe-ul semnalelor Slingshot** devine un comutator pe Azi, deasupra favoritelor: 15m · 1h · 4h · 1d (toate cinci exchange-uri le au);
   - **istoricul încărcat** (1500 / 3000 / 5000 de lumânări) și **exchange-ul implicit** trec la Setări → Admin → Date de piață, unul pentru toți;
   - nota despre sursele acțiunilor rămâne doar la Admin.

### 3. Cazuri limită
| Situație | Comportament |
|---|---|
| Utilizatorul adaugă sau șterge un cont | sursa se schimbă imediat (graficele, banda și fișele se reîncarcă); semnalele de pe Azi la următoarea scanare (cel mult un minut) |
| Exchange-ul ales din mai multe e șters | se trece la primul rămas; cu niciunul, la cel implicit |
| Contul are cheia expirată sau greșită | prețurile tot de acolo vin (sunt publice); doar portofoliul arată eroarea |
| Exchange-ul conectat nu răspunde (pană) | graficul arată eroarea exchange-ului, ca până acum; nu se trece singur pe altul |
| Favorita nu există nici pe exchange-ul implicit | eroarea de azi: „perechea nu e listată”, cu sugestii |
| Căutarea monedelor (⌘K, Favorite) | caută pe exchange-ul utilizatorului și pe cel implicit; o pereche apare o singură dată |
| Timeframe-ul semnalelor salvat înainte, altul decât 15m / 1h / 4h / 1d (ex. 30m) | rămâne cel ales și apare pe comutator lângă cele patru, până alege altul |
| Timeframe-ul semnalelor lipsește pe exchange-ul lui (8h salvat, OKX) | semnalul monedei vine de la exchange-ul implicit |
| Market Structure pe un timeframe pe care exchange-ul nu-l are | liniile se ascund, cu mesaj, ca la acțiuni |
| Adminul schimbă exchange-ul implicit sau istoricul | se aplică tuturor celor care îl folosesc, la următoarea reîncărcare (cel mult 30 s pe cealaltă instanță) |
| Setările de dinainte | exchange-ul și istoricul adminului devin cele implicite (azi: KuCoin, 1500); alegerile de exchange ale celorlalți se păstrează și contează doar dacă au mai multe exchange-uri conectate |
| Acțiunile | neschimbate (Nasdaq / Twelve Data) |
| Mac și Azure | fiecare instanță ține lista conturilor 30 s; o schimbare făcută pe cealaltă se vede după cel mult 30 s |

### 4. Conflicte cu ce exista
- **FD-SET / FD-ADMINSET** (secțiunea „Grafice și scanner” din „Ale mele”): scoasă; exchange-ul și istoricul la Admin.
- **FD-CHARTUX §2** („Exchange-ul de date și numărul de lumânări: server, în Setări”): exchange-ul vine din contul conectat sau de la admin; numărul de lumânări de la admin.
- **v1 / TD §8** (exchange-urile de date: KuCoin, Binance, Bybit, OKX): plus Bitget.

## FD-TRADESTATS — Tranzacții: soldul futures, rezultatele pozițiilor închise; textul de la Favorite (14 oct 2026)

Cererea utilizatorului:
- „textul Monede și acțiuni care apar în bandă, … numele companiei se adaugă singur. din settings are line breaks și nu ar trebui.”
- „în zona de tranzacții vreau 5 carduri noi pe lângă cel de valoare spot și pnl nerealizat”:
  - „primul card să fie cel de sumă disponibilă în contul de futures trading”;
  - „apoi pnl nerealizat”;
  - „apoi număr tranzacții cu succes, adică profitabile”;
  - „apoi număr de tranzacții fără succes, cu pierdere”;
  - „și apoi încă un card cu rata de succes în procente”;
  - „apoi încă un card cu valoare netă a câștigurilor”.
- „nu știu ce reprezintă valoare spot. poate îmi explici.”
- „butonul reîmprospătează îl pui pe același rând cu adaugă un cont ca să faci loc la cardurile noi.”
- La întrebări a ales:
  - perioada: un **selector Azi · 7z · 30z · 90z**;
  - o „tranzacție” = **o poziție futures închisă**.

### 1. Ce e „Valoare spot” (răspuns)
- Suma, în dolari, a tot ce e în conturile spot ale exchange-ului (la KuCoin: Trading și Funding): monedele la prețul de acum, plus stablecoins.
- Contul futures nu intră în ea.
- Ca să fie clar, cardul se numește acum **„Valoare în contul spot”**. La trecerea cursorului, explică asta.

### 2. Cardurile unui cont crypto, în ordine
| # | Card | Ce arată |
|---|---|---|
| 1 | **Disponibil în futures** | suma liberă din contul futures, în USDT (la KuCoin `availableBalance`; la conturile unificate, USDT liber din contul unificat) |
| 2 | **Valoare în contul spot** | ca până acum (§1) |
| 3 | **PnL nerealizat (futures)** | ca până acum |
| 4 | **Tranzacții profitabile** | pozițiile futures închise în perioadă cu rezultat net > 0 |
| 5 | **Tranzacții cu pierdere** | pozițiile futures închise în perioadă cu rezultat net < 0 |
| 6 | **Rata de succes** | profitabile ÷ (profitabile + cu pierdere) × 100, cu o zecimală |
| 7 | **Câștig net** | suma rezultatelor nete ale pozițiilor închise în perioadă (verde peste 0, roșu sub 0) |

- „Rezultat net” = cum îl dă exchange-ul pentru poziția închisă, după comisioane și funding (KuCoin: `pnl`).
- **Perioada** (cardurile 4–7) se alege pe un comutator **Azi · 7z · 30z · 90z**, lângă carduri; implicit 30z. „Azi” începe la 00:00 în fusul tău orar. Alegerea se ține minte în browser.
- **„Reîmprospătează”** stă acum în bara de sus, lângă „Adaugă un cont”. Reîncarcă portofoliul și statisticile contului ales.
- Pe telefon, cardurile se așază câte două pe rând.

### 3. Cazuri limită
| Situație | Comportament |
|---|---|
| Nicio poziție închisă în perioadă | 0 și 0; rata de succes „—”; câștigul net 0 $ |
| Poziție închisă exact pe zero | nu intră nici la profitabile, nici la pierdere; intră în câștigul net (cu 0) |
| Lichidare | e o poziție închisă cu pierdere |
| O poziție închisă în mai multe bucăți | se numără cum o raportează exchange-ul (fiecare închidere raportată e o tranzacție) |
| Futures decontat în monedă (ex. BTC) | rezultatul se transformă în dolari la prețul de acum; dacă prețul lipsește, intră doar la numărare și cardul spune „parțial” |
| Exchange-ul dă istoricul doar pe bucăți de 7 zile (KuCoin, Bybit) | Sentiq cere perioada pe bucăți și le adună; KuCoin păstrează 3 luni |
| Binance (API-ul nu dă istoricul pozițiilor închise), Kraken, Coinbase (fără futures în Sentiq) | cardurile 4–7 (și 1, la Kraken / Coinbase) arată „—”, iar la trecerea cursorului explică de ce |
| Istoricul nu se poate citi (eroare, permisiune) | cardurile 4–7 arată „—”; sub ele apare eroarea; restul paginii merge |
| Soldul futures nu se poate citi | cardul 1 arată „—”, cu eroarea la trecerea cursorului |
| Brokeri (acțiuni) | neschimbat: Valoare dețineri, Numerar disponibil, PnL nerealizat |
| Câte cereri | statisticile se citesc la deschiderea paginii și la schimbarea perioadei, apoi sunt ținute 5 minute (sau până la „Reîmprospătează”) |
| Server mai vechi (Mac sau Azure încă nepublicat) | cardurile noi arată „—” |

### 4. Textul de la Favorite (Setări → Ale mele)
- Paragraful de sub „Favorite” avea o lățime maximă (75 de caractere), așa că se rupea pe 3–4 rânduri.
- Acum ocupă toată lățimea panoului, ca restul textelor, și se rupe doar unde se termină rândul.

### 5. Conflicte cu ce exista
- **Partea I §6.1**: plus cardurile, perioada și locul butonului.
- **FD-TRADE** (cardurile „Valoare spot” și „PnL nerealizat”): rămân, primul redenumit.

## FD-MCPMULTI — Connectorul Sentiq și pentru ChatGPT și Gemini (14 oct 2026)

Cererea utilizatorului: „după ce termini să implementezi mcp pentru chatgpt și pentru gemini.”

### 1. Ce am verificat (14 oct 2026)
**ChatGPT** (documentația OpenAI pentru autentificarea serverelor MCP):
- OAuth cu PKCE S256 și parametrul `resource`, ca la Claude.
- Clientul vine preferabil printr-un document publicat (CIMD), `https://chatgpt.com/oauth/client.json`:
  - adresa de întoarcere e `https://chatgpt.com/connector_platform_oauth_redirect`, pentru că Sentiq trimite `iss` în fiecare răspuns de autorizare;
  - documentul cere `private_key_jwt`, dar declară că acceptă și `none` (client public).
- Alternativa e înregistrarea dinamică (DCR), cu întoarcere la `https://chatgpt.com/connector/oauth/{id}`.
- Documentul se poate citi de pe Azure (200).
- Pentru utilizator: Developer mode (Setări → Apps & Connectors → Advanced), apoi „Create”. Planurile diferă între surse: Plus / Pro, Business, Enterprise, Edu.

**Gemini**:
- Aplicația Gemini („Custom apps”: Setări → Connected apps → Custom apps → Add):
  - înregistrare dinamică (DCR), cu întoarcere la `https://oauth-redirect.googleusercontent.com/r/…` (diferită pe utilizator și connector);
  - din surse terțe: deocamdată doar pe Google AI Ultra și doar în engleză. Nu există pagină oficială Google.
- Gemini CLI: `gemini mcp add --transport http sentiq https://sentiq.money/mcp`, apoi `/mcp auth sentiq`. DCR cu întoarcere pe calculatorul propriu (loopback), pe care Sentiq o acceptă deja.
- Gemini Enterprise (pentru firme, client introdus de admin): nu e cazul aici.

### 2. Ce se schimbă
- **Aplicațiile acceptate:**
  - Claude (claude.ai, claude.com, Claude Code);
  - **ChatGPT** (chatgpt.com);
  - **Gemini** (întoarcerea prin `oauth-redirect.googleusercontent.com`; Gemini CLI pe calculatorul propriu).
  - Lista rămâne configurabilă (`SENTIQ_MCP_CLIENTS`).
- **CIMD:** un document se acceptă și când cere altă metodă, dacă declară că acceptă și `none` (ChatGPT). Sentiq îl tratează ca client public, cu PKCE.
- **DCR:** o aplicație care cere o metodă cu secret (`client_secret_basic` / `client_secret_post`) e înregistrată tot ca client public; răspunsul spune `none` (RFC 7591 lasă serverul să decidă). Codul de autorizare rămâne legat de PKCE.
- **Schimbul codului:** dacă aplicația trimite `client_id` doar în antetul Basic sau în `client_assertion`, Sentiq îl ia de acolo. Siguranța vine din PKCE și din legarea codului de client și de adresa de întoarcere.
- **Texte:**
  - pagina de consimțământ: „Conectezi **ChatGPT** la Sentiq?”, cu numele aplicației din documentul / înregistrarea ei și hostul ei;
  - în Securitate, panoul „**Asistenți AI (connector)**” are pașii pentru Claude, ChatGPT și Gemini;
  - mesajele de eroare spun „aplicația AI”, nu „Claude”.
- Uneltele sunt aceleași pentru toate aplicațiile: doar citire, doar datele celui conectat, niciodată chei, conturi sau portofolii.

### 3. Cazuri limită
| Situație | Comportament |
|---|---|
| Planul ChatGPT nu are Developer mode (Free) | ChatGPT nu oferă adăugarea; Sentiq nu poate ocoli asta |
| Aplicația Gemini nu are „Custom apps” pe contul tău | Gemini CLI merge (pe calculatorul tău); aplicația, când Google o deschide |
| O aplicație se înregistrează cu un nume înșelător (de ex. „Claude”) printr-o adresă de întoarcere Google | pagina de consimțământ arată și hostul real al întoarcerii (`oauth-redirect.googleusercontent.com`); fără „Permite”, nu primește nimic |
| Altă aplicație decât cele acceptate | refuzată, cu numele hostului |
| Un document CIMD care cere doar `private_key_jwt` (fără `none`) | refuzat: Sentiq nu verifică semnături de client |
| Mai multe aplicații conectate de același om (Claude și ChatGPT) | fiecare are conexiunea ei în Securitate, cu „Deconectează” |
| „Ieși de pe toate dispozitivele”, parolă nouă, cont dezactivat | închid conexiunile tuturor aplicațiilor |
| Gemini (aplicația) | verificat doar pe documentația publică (DCR, adresa Google); primul cont real e verificarea finală |

### 4. Conflicte cu ce exista
- **FD-MCP §2** („sunt acceptate doar aplicațiile Claude”): acum Claude, ChatGPT și Gemini.
- **Termenii Anthropic** (FD-MCP): neschimbat. Pentru ChatGPT și Gemini, connectorul MCP adăugat de fiecare în aplicația lui e la fel calea oferită de ele; Sentiq nu folosește abonamentele nimănui.

## FD-DBHEAL — Lacătul de scriere nu mai poate rămâne blocat (reparație, 14 oct 2026)

### 1. Ce s-a întâmplat
- La publicarea de la 14:16 UTC, Azure a mutat aplicația pe alt worker în timpul build-ului. Un container (`aef27428e9f3`, conectat la 14:16:51) a rămas viu cu **o tranzacție deschisă** de la ~14:25 UTC.
- Reînnoirile lease-ului de joburi ale acelui container au intrat în tranzacția deschisă (o scriere făcută „din” contextul ei i se alătură), așa că lacătul de scriere a rămas luat aproape 10 minute.
- Între ~14:25 și 14:35 UTC, nicio altă instanță n-a putut scrie (Mac-ul și noul container Azure: „Baza de date nu răspunde acum”); citirile au mers.
- Rezolvat manual: sesiunea blocată (tranzacție de 598 s) a fost închisă (`KILL`); lacătul a circulat imediat.
- Declanșatorul exact (cum a rămas tranzacția deschisă) nu se mai poate reconstitui. Tranzacțiile Sentiq durează secunde, deci una care ține lacătul minute întregi e oricum o eroare.

### 2. Ce se schimbă
1. **Lease-ul și joburile nu intră niciodată într-o tranzacție deschisă.** Reînnoirea lease-ului și fiecare rulare a unui job pornesc „curat”: o tranzacție rămasă deschisă undeva nu le mai poate prelungi.
2. **Autovindecare.**
   - Când o scriere nu primește lacătul în 30 de secunde, instanța verifică cine îl ține.
   - Dacă e o sesiune Sentiq cu tranzacția deschisă de **peste 5 minute**, o închide (tranzacția ei se anulează) și scrie în jurnal ce rula (instanța, vârsta tranzacției, ultima instrucțiune).
   - Scrierea încearcă apoi încă o dată.
   - O singură verificare pe minut, pe instanță.
3. **Oprirea unei instanțe** (o publicare, o mutare pe alt worker) durează cel mult 15 secunde: dacă ceva o ține pe loc (un flux deschis, o interogare agățată), procesul iese oricum. Nu mai rămâne un proces pe jumătate oprit care ține conexiuni.
4. **Publicarea pe Azure** (deploy-azure.md §5): aplicația se oprește întâi (`az webapp stop`), apoi deploy, apoi pornire. Așa nu mai rulează două containere deodată, iar build-ul are memorie. (Din 14 oct seara, pe planul B2, nu mai e nevoie de oprire: build-ul încape lângă aplicația pornită; oprirea rămâne rezerva.)

### 3. Cazuri limită
| Situație | Comportament |
|---|---|
| O tranzacție legitimă lungă (importul SQLite, care se face cu aplicația oprită) | pragul de 5 minute e mult peste orice tranzacție normală; importul trebuie făcut, ca până acum, cu Sentiq oprit pe Mac și pe Azure |
| Lacătul e ținut de altceva decât Sentiq | nu se închide nimic; scrierea dă „Baza de date nu răspunde acum”, ca până acum |
| Utilizatorul bazei nu are dreptul de a închide sesiuni (schemele de test) | verificarea eșuează în liniște; comportamentul e cel de dinainte |
| Două instanțe găsesc aceeași sesiune blocată | prima o închide; a doua nu mai găsește nimic |
| Sesiunea se termină singură între verificare și închidere | se verifică din nou chiar înainte de `KILL` (aceeași sesiune, aceeași oră de login); altfel nu se închide nimic |

### 4. Conflicte cu ce exista
- **TD-AZURE §2** (lacătul de scriere, tranzacțiile rămase după un timeout): se adaugă autovindecarea și pornirea „curată” a lease-ului și a joburilor.

## FD-UIPOLISH — Săgețile de trend pe Azi; perioada din Tranzacții în bara de sus (14 oct 2026)

Cererile utilizatorului:
- „pe pagina azi, unde afișezi cardurile de simboluri înlocuiește uptrend și downtrend cu săgeți verzi și roșii pentru că se suprapune textul cu numele simbolului”;
- „în setări, pe rândurile cu simboluri. centrează conținutul vertical.”;
- „… câmpul de căutare să fie la aceeași înălțime cu comutatorul din stânga.” (cererea de indici din același mesaj are secțiunea ei, FD-INDICES);
- „oriunde ai text field lângă un buton fă-l de aceeași înălțime. mai sunt situații de genul ăsta prin settings - admin. la date de piață, la păstrarea știrilor, la email (resend)” și „valabil și pentru dropdowns lângă butoane”;
- „în tranzacții, rândul tranzacții închise în ce caută acolo? e foarte prost amplasat. pune pe același rând cu butoanele de reîmprospătează și adaugă un cont”.

### Ce se schimbă
- **Azi, fișele favoritelor** (monede și acțiuni): în locul cuvintelor „Uptrend” / „Downtrend” apare o săgeată în sus, verde, sau o săgeată în jos, roșie.
  - La trecerea cursorului, și pentru cititoarele de ecran, spune „Uptrend (Slingshot)” / „Downtrend (Slingshot)”.
  - Numele simbolului își păstrează locul; dacă tot nu încape, se taie cu „…”, fără să se suprapună.
- **Peste tot:** câmpurile de text și dropdown-urile au aceeași înălțime minimă ca butoanele (38 px; pe ecranele tactile 44 px), deci un câmp lângă un buton are înălțimea lui (Setări admin: Date de piață, Păstrarea știrilor, Email, Motorul de sentiment, Surse; Securitate; Tranzacții). Excepție: în Știri, dropdown-ul „Sursă” și căutarea rămân la înălțimea cipurilor de lângă ele.
- **Grafice → Indicatori:** previzualizarea unei linii (culoarea și stilul) are înălțimea dropdown-ului de stil de lângă ea.
- **Setări → Favorite, adăugarea:** câmpul de căutare are mereu înălțimea comutatorului Crypto / Acțiuni (și pe ecranele tactile, unde comutatorul e mai înalt).
- **Setări → Favorite:** conținutul fiecărui rând (mânerul, săgețile, simbolul, tipul, perechea, aliasurile, ștergerea) e centrat pe verticală; câmpul de aliasuri, mai înalt, nu mai lasă textul de alături sus.
- **Tranzacții:** comutatorul „Tranzacții închise în Azi · 7z · 30z · 90z” stă în bara de sus, lângă „Reîmprospătează” și „Adaugă un cont” (doar la conturile crypto).
  - Sub carduri rămân doar eroarea istoricului (dacă e) și „actualizat acum …”, mici, la dreapta.

### Cazuri limită
| Situație | Comportament |
|---|---|
| Scanner-ul încă n-a calculat trendul | nicio săgeată (ca înainte, niciun cuvânt) |
| Cont de broker | bara de sus fără comutatorul perioadei |
| Telefon | bara de sus se rupe pe trei rânduri: titlul și conturile, perioada, apoi butoanele |

## FD-INDICES — Indici bursieri în favorite (14 oct 2026)

Cererea utilizatorului: „în zona de jos a rândurilor, unde pot adăuga crypto și acțiuni, vreau să adaugi și indici precum spx”.

### 1. Ce se schimbă
- **Setări → Favorite, rândul de adăugare:** comutatorul devine **Crypto · Acțiuni · Indici**.
  - Cu „Indici”, sub câmp apare direct lista indicilor disponibili; scrisul o filtrează după simbol sau nume („spx”, „s&p”, „dow”, „nasdaq”).
  - Un indice deja în favorite apare în listă cu „în favorite” și nu se mai poate alege.
- **Indicii disponibili** (toți americani):

| Simbol | Indice |
|---|---|
| SPX | S&P 500 |
| NDX | Nasdaq-100 |
| COMP | Nasdaq Composite |
| DJI | Dow Jones Industrial Average |
| RUT | Russell 2000 |
| VIX | VIX (volatilitatea S&P 500) |
| SOX | PHLX Semiconductor |

- **Un indice în favorite se poartă ca o acțiune:**
  - pe Azi: fișa cu prețul, variația zilei, graficul pe 60 de zile, săgeata de trend și ultimul semnal Slingshot;
  - în banda de prețuri de sus;
  - în Grafice: favoritele de deasupra, căutarea de lângă ele („Pereche, acțiune sau indice”, cu grupul „Indici”), adresa `/charts/i/SPX`;
  - în ⌘K: favoritele și grupul „Indici”;
  - în Știri: cipul lui filtrează știrile care îl pomenesc;
  - la Claude (connector): `get_watchlist` și `get_chart` (simbolul `^SPX`); în Rezumat, la favorite.
- **Cum se afișează:**
  - simbolul simplu („SPX”), cu o insignă proprie (un grafic, nu inițiale), ca să nu se confunde cu o monedă sau o acțiune;
  - în tabelul favoritelor: tipul „Indice”, iar la „Pereche / bursă”: „indice SUA”.
- **Timeframe-uri:** doar **1d** și **1w**. Celelalte butoane din Grafice sunt dezactivate, cu explicația „Indicii au doar 1d și 1w”.
  - Pe Azi, cu semnalele pe 15m / 1h / 4h, fișa unui indice arată Slingshot pe 1d, cu nota existentă („Slingshot pe 1d (sursa nu are 1h)”).
- **Întârziere:** cotațiile pot avea până la 15 minute întârziere. Se spune la trecerea cursorului peste preț, pe fișă și în Grafice.
- **Aliasuri pentru știri**, implicite, editabile ca la acțiuni:

| Indice | Aliasuri implicite |
|---|---|
| SPX | S&P 500, S&P500, SPX |
| NDX | Nasdaq-100, Nasdaq 100, NDX |
| COMP | Nasdaq Composite |
| DJI | Dow Jones, DJIA |
| RUT | Russell 2000 |
| VIX | VIX, volatility index |
| SOX | Philadelphia Semiconductor, PHLX Semiconductor |

  - Doar „Dow” nu e alias: ar prinde și compania Dow Inc.
  - Doar „COMP” nu e alias: e și simbolul monedei Compound.

### 2. Sursele (pentru transparență; utilizatorul nu alege nimic)
- **Nasdaq** (același API gratuit ca la acțiuni) pentru NDX, COMP și SOX.
- **Cboe** (cotațiile publice, cu 15 minute întârziere) pentru SPX, VIX, RUT și Dow Jones.
  - Dow Jones e calculat din DJX, indicele Cboe care valorează exact o sutime din el, deci e rotunjit la un punct.
- **Nu există o sursă gratuită** pentru indicii din afara SUA (DAX, FTSE 100, Nikkei 225, Euro Stoxx 50), pentru futures (ES, NQ) sau pentru intraday la indici. Încercate:
  - Twelve Data are indici doar pe planurile plătite (de la ~29 $ / lună);
  - Yahoo refuză cererile automate (429);
  - Stooq cere JavaScript în browser.
- **De știut:** pagina „Use of Content” a Cboe spune că datele de pe site-urile Cboe se folosesc cu acordul lor. Sentiq le citește pentru câțiva utilizatori, fără să le redistribuie, la fel ca datele Nasdaq pentru acțiuni.
  - Dacă utilizatorul nu vrea asta, SPX, VIX, RUT și Dow Jones se scot din listă. Alternativa pentru ele sunt ETF-urile echivalente, care se pot adăuga deja la „Acțiuni”: SPY, VXX, IWM, DIA.

### 3. Cazuri limită
| Situație | Comportament |
|---|---|
| Indicele e deja în favorite | „SPX este deja în favorite (ca indice)” |
| Mai mulți indici aleși repede, unul după altul | toți se adaugă; lista arată, după ultimul, ce e salvat (înainte, un răspuns sosit mai târziu putea ascunde din listă adăugările mai noi, deși erau salvate) |
| Moneda SPX (SPX6900) și indicele SPX, amândouă în favorite | merg amândouă: sunt simboluri diferite pentru Sentiq; insigna și tipul le deosebesc |
| Un titlu spune „SPX” și utilizatorul are amândouă | știrea e legată de indice (aliasul indicelui are prioritate față de simbolul monedei) |
| Limita de 50 de favorite | indicii intră în ea |
| Sursa indicelui nu răspunde | pe fișă „—”; graficul arată eroarea, sau ultimele lumânări cu vârsta lor (ca la acțiuni) |
| Piața e închisă (noaptea, weekend, sărbătoare) | ultima închidere, „închis”, fără avertismentul „Date vechi” |
| Înainte de deschidere | fără lumânarea zilei până la primul preț al ședinței |
| Zile vechi fără preț de deschidere (SPX înainte de 1996) | sărite; graficul are oricum doar ultimele 1500–5000 de zile |
| Russell 2000 | istoric doar din noiembrie 2020 (cât publică Cboe): graficul are mai puține lumânări |
| Timeframe sub 1d cerut direct (adresă veche, Claude) | graficul arată 1d; Claude primește nota „Timeframe … is not available for indices; showing 1d.” |
| Un indice cerut prin API care nu e în listă | refuzat cu „Indice necunoscut” |
| Versiunea veche de pe Azure, până la publicare | ar trata indicele ca pe o monedă necunoscută: Mac-ul și Azure se publică împreună |
| O pagină Sentiq rămasă deschisă de dinainte de publicare | până la reîncărcare, arată indicele ca pe o monedă fără preț; după reîncărcare, corect |
| Cboe refuză cererile (de pildă blocat de Cloudflare) | ca la sursa căzută: „—” și eroarea „Cboe: HTTP 403”, nu „indice necunoscut” |

### 4. Conflicte cu ce exista
- **FD-SENTIQ §4 (acțiunile):** indicii folosesc aceleași fișe și același scanner; acțiunile nu se schimbă.
- **FD-AUTOFEED:** indicii nu primesc un feed propriu (Nasdaq are feeduri doar pe acțiuni); știrile despre ei vin din toate sursele, prin aliasuri.
- **Calendarul (rezultatele trimestriale):** doar pentru acțiuni, ca înainte.
- **FD-MARKETSRC:** nu se aplică (indicii nu vin de la exchange-uri crypto).

## FD-ROWCENTER — Rândurile favoritelor, centrate exact (14 oct 2026)

Cererea utilizatorului (cu o captură din Setări → Favorite): „conținutul nu e centrat perfect. e vreun padding, margin pe undeva”.

### Cauza
- Rândul era centrat pe verticală (FD-UIPOLISH), dar mânerul, săgețile, logo-ul cu simbolul și coșul erau elemente din linia de text: stăteau pe linia de bază a textului, iar sub ea rămânea spațiul pentru literele cu „coadă” (p, g, y).
- Măsurat în Chrome: ele erau cu ~3 px mai sus decât mijlocul rândului; câmpul de aliasuri și textul („Crypto”, „BTC/USDT”) erau la mijloc.
- Nu era un padding sau un margin.

### Ce se schimbă
- În fiecare rând, mânerul cu săgețile, logo-ul cu simbolul și numele, și coșul sunt centrate pe mijlocul rândului, ca textul și câmpul de aliasuri.
- Măsurat după: toate la 0 px față de mijlocul rândului, la 1440 și la 390 px.
- Textul simplu („Crypto”) și textul din câmpul de aliasuri au același mijloc. Diferența de sub un pixel pe care o raportează browserul vine din metricile fontului, nu din așezare.

### Cazuri limită
| Situație | Comportament |
|---|---|
| Rândul tras cu mouse-ul | la fel (doar așezarea din celule s-a schimbat; mânerul de tragere e același) |
| Numele lung al unei acțiuni | se taie cu „…”, ca înainte |
| Telefon (390 px) | aceleași măsurători, 0 px |

## FD-SELECTSAFARI — Dropdown-urile la înălțimea butoanelor și în Safari (14 oct 2026)

Cererea utilizatorului (cu o captură din Admin → Surse, unde „Categorie” era mai scund decât câmpurile și butoanele): „ți-am zis și de dropdowns. cauți butoane, verifici elementele de lângă ele și reglezi situația dacă e nevoie”.

### Cauza
- Safari desenează dropdown-ul cu aspectul lui și ignoră înălțimea minimă și padding-ul: în Safari toate dropdown-urile aveau 22 px, oricât cerea Sentiq.
- FD-UIPOLISH fusese verificat doar în Chrome, care respectă înălțimea.

### Ce se schimbă
- **Toate dropdown-urile** sunt desenate de Sentiq: aceeași cutie ca un câmp, cu săgeata în culoarea temei. Au 38 px (44 pe ecrane tactile) în orice browser, deci și „Categorie” de lângă „Testează” / „Adaugă sursa”.
  - Lista care se deschide rămâne cea a sistemului (tastatura, căutarea după literă și cititoarele de ecran merg ca înainte).
- **Știri:** dropdown-ul „Sursă” și căutarea au acum 38 px, ca comutatorul „24 h · Azi · Ieri · 7 zile” de pe același rând. Asta înlocuiește excepția din FD-UIPOLISH.
  - Filtrele fără chenar („Toate”, „Crypto”…) rămân cum sunt: au înălțimea butoanelor din comutator.
- **Grafice:** căutarea „Pereche, acțiune sau indice” stă în rândul favoritelor, deci are înălțimea lor (30 px; 36 pe ecrane tactile), nu a unui buton.
- **Verificat automat:** pe fiecare pagină, fiecare buton și ce are lângă el, pe același rând, comparate ca înălțime și ca mijloc.
  - Paginile: Azi, Știri, Calendar (și formularul de eveniment), Economie, Grafice (și panoul Indicatori), Tranzacții, Setări, Admin, Securitate, Stare sistem, Utilizatori.
  - Motoarele: WebKit (al lui Safari) și Chrome, la 1440 px și la 390 px cu ecran tactil.
  - Rămân doar filtrele fără chenar din Știri (intenționat) și suprapuneri false (butoanele panoului Indicatori, peste câmpurile de sub el).

### Cazuri limită
| Situație | Comportament |
|---|---|
| Text lung într-un dropdown îngust | se taie înaintea săgeții (are 32 px rezervați) |
| Dropdown dezactivat | aceeași cutie, cursorul „interzis”, ca înainte |
| Tema luminoasă | săgeata ia culoarea temei |

## FD-AICLARITY — Connectorul în Setări; la ce folosește Sentiq cheia Claude (14 oct 2026)

Cererile utilizatorului:
- „și unde sunt setările de mcp? nu văd nimic nicăieri”;
- „ce caută în securitate? trebuie să fie în setări”;
- „nu este clar nicăieri că odată ce am folosit mcp-ul, modelul ales de mine e folosit pentru analiză. unde scrie, unde văd la ce e folosit? … în setările de admin văd în continuare că se folosește cheia api de la anthropic. păi mcp-ul nu avea drept scop să elimine folosirea acelei chei? și dacă mcp-ul e conectat de ce încă mai văd opțiunea cu claude opus 5 și cheia api?”

Răspunsul, pe scurt: connectorul și cheia fac lucruri diferite.
- **Connectorul** lucrează doar când îl întrebi pe Claude (sau ChatGPT, Gemini) în aplicația lui: acela răspunde cu modelul și abonamentul tău și citește datele din Sentiq.
- **Cheia** e a lui Sentiq: cu ea, Sentiq lucrează singur, fără să-l întrebe cineva. Calculează sentimentul fiecărei știri și face Rezumatul de pe Azi.
- Sentiq nu poate folosi abonamentul cuiva: termenii Anthropic interzic asta. De aceea connectorul nu poate înlocui cheia.
- Întrebat ce să facă Sentiq, utilizatorul a ales **„Păstrez totul pe cheie”**: sentimentul cu Claude și Rezumatul rămân. Doar se spune clar, în aplicație, la ce e folosită cheia și cât.

### 1. Ce se schimbă
- **Setări → Ale mele → „Asistenți AI (connector)”**, mutat din Securitate. Apare mereu, nu doar când connectorul e pornit:
  - ce face: „Conectezi Claude, ChatGPT sau Gemini la Sentiq. Când îi întrebi ceva în aplicația lor, citesc datele tale din Sentiq (ziua, știrile și sentimentul, calendarul, indicatorii, favoritele, graficele cu Slingshot) și răspund cu modelul ales de tine acolo, pe abonamentul tău.”;
  - ce nu face: „Connectorul nu folosește cheia Claude a lui Sentiq și nu schimbă ce calculează Sentiq singur (sentimentul știrilor, Rezumatul).”;
  - adresa, pașii pentru fiecare aplicație și conexiunile tale (cu „Deconectează”), ca înainte;
  - connector oprit: „Connectorul nu e pornit pe această instalare” (adminului: cum se pornește).
- **Securitate:** fără panou; „Ieși peste tot” spune în continuare că deconectează și asistenții AI, cu trimitere la Setări → Asistenți AI.
- **Setări → Admin → Motorul de sentiment:** un bloc nou, „La ce folosește Sentiq cheia Claude”, cu consumul de azi (ziua UTC, ca la Twelve Data):
  - **Sentimentul știrilor** (doar cu motorul Claude): titluri trimise, apeluri, tokeni de intrare / ieșire, modelul;
  - **Rezumatul de pe Azi:** rezumate făcute, tokeni, modelul (`claude-opus-5-5`);
  - „Connectorul (Setări → Asistenți AI) nu folosește această cheie: acolo lucrează abonamentul fiecăruia.”;
  - prețul în dolari îl arată consola Anthropic (Sentiq arată tokenii, nu inventează un preț).
  - Textul de la motorul Claude nu mai spune „câțiva cenți pe zi”: costul depinde de model și de numărul de știri. Spune „se plătește la Anthropic, după tokenii de mai jos”.
- **Fereastra Rezumat**, în subsol: „Scris de Sentiq cu cheia Claude a adminului (claude-opus-5-5). Poți cere un rezumat și lui Claude, cu abonamentul tău, prin connector: promptul «Rezumatul zilei».”
- **⌘K:** „Asistenți AI (connector)” deschide panoul din Setări.

### 2. Cazuri limită
| Situație | Comportament |
|---|---|
| Motorul e Local | sentimentul nu consumă nimic; blocul spune „Motorul e Local: sentimentul nu folosește cheia” |
| Fără cheie | blocul spune ce s-ar folosi; Rezumatul cere cheia, ca înainte |
| Un apel la Anthropic eșuat | se numără doar ce a răspuns Anthropic (tokenii vin din răspuns); titlurile scorate apoi local nu se numără |
| Mac-ul și Azure | consumul e ținut în bază, deci adună ambele instanțe |
| Utilizator obișnuit | nu vede consumul și nici cheia (ca înainte), dar vede connectorul în Setări |
| Ziua nouă (UTC) | contoarele încep de la zero |

## FD-MCPREMOVE — Connectorul (MCP) scos din Sentiq (14 oct 2026)

Cererile utilizatorului:
- „dacă e vorba că direcția este de la claude la sentiq, mcp-ul este useless. eu vreau să integrez claude în sentiq nu invers”;
- la întrebarea dacă păstrez connectorul: „Îl opresc”; apoi „atunci scoate mcp-ul. nu avem ce face cu el”.

Context: connectorul lăsa Claude / ChatGPT / Gemini să citească datele din Sentiq, dar întrebările se puneau doar în aplicațiile lor. Utilizatorul voia Claude în Sentiq. Asta se poate doar pe cheia API, iar chat-ul pe cheie l-a refuzat („Nu”, „nu faci nimic”). Prin urmare, connectorul nu mai are rost.

### 1. Ce se schimbă
- **Connectorul dispare cu totul**: adresa `/mcp`, autorizarea OAuth (`/.well-known/…`, `/oauth/…`), pagina de consimțământ, înregistrarea aplicațiilor, uneltele și prompturile.
- **Setări → „Asistenți AI (connector)”** dispare; la fel ⌘K → „Asistenți AI”, trimiterea din Securitate („Ieși peste tot” nu mai pomenește asistenții AI) și cele două mențiuni (subsolul Rezumatului, blocul din Admin).
- **Baza de date:** tabelele connectorului (`mcp_clients`, `mcp_grants`, `mcp_codes`, `mcp_tokens`) se șterg, printr-o migrare nouă (2). Înainte, conținutul lor se salvează într-un fișier în `data/backups/`. La backup era o conexiune (Claude, făcută de utilizator la 16:34 UTC), pe care utilizatorul a șters-o din Claude.
- **Configurația:** `SENTIQ_MCP` și `SENTIQ_MCP_CLIENTS` nu mai înseamnă nimic. `SENTIQ_MCP` a fost scos de pe App Service, la cererea utilizatorului, înainte de publicare. `SENTIQ_PUBLIC_URL` rămâne, fiindcă de el depind linkurile de activare (FD-ONLINE).
- **Rămân pe cheia API** (FD-AICLARITY): sentimentul cu Claude, Rezumatul și blocul „La ce folosește Sentiq cheia Claude”.

### 2. Cazuri limită
| Situație | Comportament |
|---|---|
| Cineva (sau Claude, dintr-o conexiune veche) cere `https://sentiq.money/mcp`, `/oauth/…` sau `/.well-known/…` | adresele nu mai există: „404 nu există” (nu pagina aplicației); nu se mai dă niciun token |
| Connectorul adăugat cândva în Claude | rămâne în lista lui Claude, dar nu mai merge; se șterge din Claude (Customize → Connectors) |
| Conexiunea făcută de utilizator pe 14 oct, 16:34 UTC | utilizatorul a șters-o deja din Claude; rândurile ei sunt în backup |
| Mac-ul sau Azure rămas pe versiunea veche | schema 2 e mai nouă: versiunea veche refuză să pornească („actualizează Sentiq”); se publică împreună |
| `public_instance` scris de versiunea veche (cu `mcp`) | câmpul în plus e ignorat |
| Importul unei baze SQLite vechi | tabelele connectorului se sar |

## FD-TDPLAN — Limitele Twelve Data citite din planul cheii (14 oct 2026)

Cererea utilizatorului: „mă interesează planul grow cu 55 api + 8ws. e de ajuns pt mine? practic nu mai vreau limite pe minut și zilnice.”; apoi „modifică să citească limitele”.

### Situația
- Sentiq presupunea mereu planul gratuit (8 cereri pe minut, 800 pe zi) și nu cerea niciodată mai mult. Cu un plan plătit s-ar fi limitat singur în continuare.
- Twelve Data spune limitele cheii la `/api_usage`, la un credit pe întrebare:
  - limita pe minut (`plan_limit`);
  - limita zilnică (`plan_daily_limit`), doar pe planurile care au una (Basic); Grow, Pro și Enterprise nu au limită zilnică;
  - numele planului (`plan_category`).

### Ce se schimbă
- Sentiq citește planul cheii:
  - la salvarea cheii (după verificare);
  - la pornire;
  - apoi la 6 ore;
  - la cerere, cu butonul „Recitește planul” din Admin → Date de piață (după un upgrade, ca să nu aștepți).
- Bugetul local folosește limitele citite: de exemplu 55 pe minut și fără limită zilnică pe Grow. Planul citit se ține în bază, deci Mac-ul și Azure folosesc aceleași limite.
- **Admin → Date de piață** arată: „Planul Twelve Data: Grow: 55 de cereri pe minut, fără limită zilnică (citit acum 2 min)” și consumul. „Stare sistem” arată „fără limită zilnică” în loc de „x / 800”.
- Textul despre cheie spune că planul gratuit are 8 pe minut și 800 pe zi, iar un plan plătit se recunoaște singur.

### Cazuri limită
| Situație | Comportament |
|---|---|
| Planul n-a fost citit încă (cheie veche, `/api_usage` n-a răspuns) | limitele planului gratuit (8 / 800), ca înainte; Admin spune „Basic (presupus)” |
| `/api_usage` nu răspunde la o recitire | rămâne ultimul plan citit |
| Cheia se schimbă sau se șterge | planul vechi se uită; cu o cheie nouă se citește din nou |
| Upgrade făcut pe site-ul Twelve Data | se vede la următoarea citire (cel mult 6 ore) sau imediat cu „Recitește planul” |
| Downgrade | la fel; limitele mai mici se aplică de la citire |
| Twelve Data refuză totuși o cerere (429, cheia folosită și în altă parte) | ca înainte: nicio cerere până la minutul următor, ultimele lumânări cu motivul |

## FD-INDEXINTRA — Indicii pe timeframe-uri intraday (14 oct 2026)

Cererea utilizatorului: „caută pe net soluții pentru indecși. măcar pt 1h.”

### Cercetarea
| Sursă | Ce dă | De ce da / nu |
|---|---|---|
| **CNBC** (API-ul graficelor de pe cnbc.com, neoficial, fără cheie) | toți cei 7 indici: cotații **în timp real**, zilnic din 2010, intraday 1m / 5m / 30m / 1h pe ~100 de zile (din 7 iulie 2026) | ales; răspunde și de pe Azure; zilnicul e identic cu Cboe (verificat pe SPX, 12 oct); Dow-ul e cel adevărat, nu DJX × 100 |
| Massive (fostul Polygon), Indices Starter / Advanced | minute, 15 min întârziere / timp real | oficial, dar 49 $ / 99 $ pe lună; acoperirea DJI nesigură |
| Twelve Data | — | catalogul nu are SPX, NDX, DJI, VIX ca indici (nici pe Grow) |
| Financial Modeling Prep, EODHD | intraday pe indici | doar pe planuri plătite |
| Yahoo / Stooq | — | refuză cererile automate (429 / JavaScript) |
| Cboe, Nasdaq (sursele de acum) | zilnic; intraday doar ziua curentă | rămân rezervă pentru zilnic și cotații |

- CNBC e neoficial, ca Nasdaq și Cboe: termenii site-urilor nu permit, în general, folosirea automată. Alternativa oficială e Massive.

### Ce se schimbă
- **Timeframe-uri pentru indici:** 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 1d, 1w.
  - 3m se face din 1m, 15m din 5m, 2h și 4h din 1h.
  - 6h, 8h și 12h nu există: o ședință are 6 ore și jumătate.
- **Istoric intraday:** cât dă CNBC, cam 100 de zile, adică ~500 de lumânări pe 1h și ~140 pe 4h. Pe 1m, 3m și 5m se încarcă doar ultimele zile, cât cere numărul de lumânări ales în Admin.
- **Doar ședința regulată** (9:30–16:00, ora New York). Barele de după închidere, plate, se sar.
  - Prima bară de 1h e cea de la 9:30 (CNBC o numește 9:00), iar ultima, de la 15:00, se închide la 16:00.
- **Cotațiile** vin de la CNBC, în timp real, deci nota „până la 15 minute întârziere” dispare. Rămâne doar când cotația vine din rezervă (Cboe) sau când CNBC nu o marchează ca fiind în timp real.
- **Zilnicul** vine tot de la CNBC; cu CNBC căzut, de la sursele de acum (Nasdaq pentru NDX / COMP / SOX, Cboe pentru celelalte).
- **Pe Azi**, cu semnalele pe 15m / 1h / 4h, fișa unui indice arată acum Slingshot chiar pe timeframe-ul ales, nu pe 1d.
- **În Grafice**, butoanele 6h / 8h / 12h sunt dezactivate pentru indici, cu „Indicii nu au 6h”.

### Cazuri limită
| Situație | Comportament |
|---|---|
| CNBC nu răspunde | cotația și zilnicul din rezervă (cu nota de întârziere); intraday: ultimele lumânări cu motivul, sau eroarea „Datele intraday ale indicilor nu sunt disponibile acum” |
| Istoric intraday mai scurt decât cere Slingshot | avertismentul existent: „Istoric insuficient …” |
| Ședință scurtă (de ex. 13:00 înainte de sărbători) | barele care există; nimic inventat |
| Weekend, sărbătoare, noapte | ultima ședință; fără „Date vechi” (piața e închisă) |
| Bara curentă (ședința în desfășurare) | apare, deschisă, și se actualizează la minut |
| Timeframe salvat 6h / 8h / 12h | graficul arată cel mai apropiat (4h sau 1d), cu nota „Indicii nu au …” |

## FD-AIKEYS — Cheia AI a fiecărui utilizator: Claude, ChatGPT sau Gemini (16 oct 2026)

Cererile utilizatorului:
- „Vreau să știu dacă Gemini și ChatGPT au API keys ca să putem să le adăugăm ca fiecare client să-și treacă API key-ul în aplicație ca să nu-mi consume mie creditele.”
- „implementează integrarea cu Gemini și OpenAI ca să suporte API key-uri de la ei, și această setare de API key devine una personală, pentru fiecare utilizator. Deci chiar și în cazul meu […] din zona de setări de admin în zona de setări de utilizator. Utilizatorul când introduce acest API key poate să folosească prin API modelul respectiv pe care și-l alege, pentru score și pentru rezumat. Dacă nu-și dorește pentru score, folosește modelul local, dar rezumatul tot trebuie să folosească API key.”
- „Motorul de sentiment va folosi modelul local implicit până când utilizatorul își adaugă API key-ul. Și atunci are de ales.”

Context: cheia Claude era una singură, a adminului, pusă în Setări → Admin. Plătea scorul tuturor știrilor (cu motorul Claude) și Rezumatul oricărui utilizator. OpenAI și Google dau chei API ca Anthropic, facturate separat de abonamentele ChatGPT și Gemini (la fel ca la Claude).

### 1. Ce se schimbă
- **Setări → Ale mele → „Inteligență artificială”** (nou, pentru oricine, adminul inclus):
  - **furnizorul**: Claude (Anthropic), ChatGPT (OpenAI) sau Gemini (Google); un ✓ verde arată furnizorii la care ai cheie salvată;
  - **cheia API** a furnizorului ales, cu „Salvează cheia” / „Înlocuiește cheia”, „Șterge cheia” (cu confirmare) și linkul „Fă o cheie la …”. La salvare, Sentiq cere furnizorului lista de modele (gratuit). O cheie refuzată nu se salvează („Google nu a acceptat cheia: …”); dacă furnizorul nu răspunde, cheia se salvează cu un avertisment;
  - **modelul**: lista cheii (doar modelele de text pe care le poate folosi), cu cele recomandate primele; fără cheie, lista Sentiq. Implicit: `claude-opus-5-5`, `gpt-6.1-sol`, `gemini-3.8-flash`;
  - **scorul de sentiment al știrilor**: „Model local” (implicit, gratuit) sau AI-ul tău (activ doar cu cheia salvată). Textul spune ce se trimite (titlurile din ultimele 48 h, în loturi de 25) și că scorurile calculate așa le vede doar utilizatorul;
  - **„Ce a consumat cheia ta azi”** (ziua UTC): titluri, apeluri, tokeni și modelul, separat pentru scor și Rezumat; „Prețul în dolari îl arată consola furnizorului”, plus ce se trimite și ce nu (niciodată conturile, cheile, portofoliile);
  - eroarea AI-ului, dacă scorul are una („cheia API OpenAI nu este validă. Până schimbi cheia sau modelul, vezi scorul modelului local.”);
  - „Scorează din nou ultimele 48 h” (doar cu scorul pe AI-ul tău).
  - Pe Gemini, o notă: pe nivelul gratuit, Google poate folosi datele trimise.
- **Scorul comun** e mereu al modelului local, pentru toți. Un utilizator cu scorul pe AI-ul său vede, **numai în contul său**, scorurile acestui AI în Știri, în sentimentul zilei (Azi, istoric, pe ore) și în Rezumat. Unde AI-ul n-a dat încă un scor, rămâne cel local.
- **Rezumatul zilei** e scris de AI-ul fiecăruia, cu cheia și modelul său. Fără cheie: „Rezumatul îl scrie AI-ul tău (Claude, ChatGPT sau Gemini), cu cheia ta API…” și butonul „Pune cheia în Setări” (pentru oricine, nu doar pentru admin). Subsolul spune cine l-a scris și cu ce model.
- **Setări → Admin → „Sentimentul știrilor”** (fostul „Motorul de sentiment”): fără alegerea motorului, fără cheie, fără consum. Rămân textul despre scorul comun (cu trimitere la setările fiecăruia), câți utilizatori își scorează știrile cu AI-ul lor, „Rescorează ultimele 48 h” și „Recalculează istoricul zilnic” (scorul comun).
- **Stare sistem:** „Scorul comun: local”, „Scor cu AI-ul propriu: n utilizatori” și jobul nou „Scorare cu AI-ul utilizatorilor”.
- **Știri → „De ce acest scor?”:** motorul („ChatGPT (gpt-6-luna)”, „Gemini (…)”, „Claude (…)”) și importanța dată de AI-ul respectiv.

### 2. Cazuri limită
| Situație | Comportament |
|---|---|
| Utilizator fără cheie | scorul local; Rezumatul cere cheia |
| Cheie la OpenAI, dar furnizorul ales e Gemini | contează doar cheia furnizorului ales: ca fără cheie (scorul local, Rezumatul cere cheia) |
| Scorul pe AI ales, cheia ștearsă apoi | scorul local, cu avertisment în panou; alegerea rămâne, pentru când pui o cheie |
| Cheie refuzată (401 / 403) sau model inexistent | nu se mai cere nimic până schimbi cheia sau modelul; între timp, scorul local |
| Cont fără credit (OpenAI `insufficient_quota`, Anthropic „credit balance”, Gemini limita zilnică) | pauză de 30 de minute; scorul local între timp |
| Furnizor supraîncărcat, limită pe minut, rețea | 2 reîncercări (1 s, 4 s sau cât cere `Retry-After`, cel mult 20 s), apoi pauză de 5 minute |
| AI-ul refuză un lot, răspunsul nu se poate citi sau sare titluri | acele titluri rămân cu scorul local și nu se mai trimit (nu se plătesc de două ori) |
| Titlul unei știri se schimbă la sursă | scorurile AI ale tuturor pentru ea se șterg și se refac |
| Știri vechi de peste 48 h, sau cu relevanță 0 | nu se trimit (nu contează în indicele zilelor care se mai schimbă) |
| Un model al altui furnizor rămas salvat | se folosește modelul implicit al furnizorului ales |
| Utilizator dezactivat | AI-ul său nu mai scorează |
| Utilizator șters | cheile, scorurile, istoricul și consumul său se șterg |
| Rezumat: AI-ul refuză / răspunsul e prea lung / furnizorul dă eroare | „Claude a refuzat…”, „Rezumatul a ieșit prea lung…”, „Rezumatul nu s-a putut genera: contul Google nu mai are credit…”; tokenii se numără oricum |
| Mac-ul și Azure | totul e în bază: cheile, scorurile, consumul și starea scorării (eroarea se vede în panou oricare instanță ar servi pagina); scorarea rulează pe instanța cu joburile |

### 3. Ce pleacă la furnizor
- **Scorul:** titlurile știrilor (fără rezumat, fără sursă), numerotate.
- **Rezumatul:** ce primea și înainte Claude (sentimentul, știrile importante, calendarul, indicatorii, contextul pieței, favoritele utilizatorului din scanner).
- OpenAI: cu `store: false` (OpenAI nu păstrează răspunsul). Gemini: cheia în antet, nu în adresă.

### 4. Mutarea cheii comune (o singură dată, la pornire)
- Cheia Claude a adminului devine cheia Anthropic **personală** a adminului (aceeași cheie criptată).
- Motorul și modelul alese pentru toți devin alegerea adminului: motorul Claude cu cheie înseamnă scorul pe Claude, doar pentru admin.
- Scorurile Claude de până atunci devin scorurile AI ale adminului. Știrile din ultimele 4 zile (zilele care se mai pot schimba) se scorează din nou cu modelul local, pentru ceilalți; zilele mai vechi, deja închise, rămân cum erau.
- Consumul cheii comune de azi se șterge (era al tuturor).
- Ceilalți utilizatori trebuie să-și pună cheia lor pentru Rezumat.

### 5. Conflicte cu ce exista
- FD-AICLARITY („La ce folosește Sentiq cheia Claude”, în Admin) se mută în panoul fiecăruia, ca „Ce a consumat cheia ta azi”.
- FD-SUMMARY: Rezumatul nu mai e „mereu cu `claude-opus-5-5`, pentru oricine”, ci cu AI-ul și modelul fiecăruia.
- FD-IMPACT: importanța dată de AI cântărește doar în indicele utilizatorului al cărui AI a dat-o.
- Schema bazei trece la versiunea 3: Mac-ul și Azure se publică împreună (versiunea veche refuză să pornească).

## FD-TDKEYS — Cheia Twelve Data a fiecărui utilizator (16 oct 2026)

Cererea utilizatorului: „vreau tot așa să implementez, pentru fiecare utilizator, API-ul de la Twelve Data. Fiecare utilizator își plătește abonamentele pentru date. Asta înseamnă că muți setarea API key-ului de la Twelve Data din admin în user settings.”

Context: cheia Twelve Data era una singură, a adminului (Setări → Admin → Date de piață), și dădea tuturor graficele de acțiuni pe 1m – 4h, căutarea Twelve Data și semnalele intraday ale acțiunilor; creditele (8 pe minut și 800 pe zi pe planul gratuit Basic, mai multe pe planurile plătite, FD-TDPLAN) erau ale tuturor.

Cercetare (16 oct 2026): planul gratuit Basic dă 8 credite pe minut și 800 pe zi; planurile plătite (Grow, Pro…) nu au limită zilnică; planul cheii se citește la `/api_usage` (1 credit). Atribuirea „Twelve Data” trebuie arătată când datele se afișează (graficul spune deja sursa). Folosirea cu cheia proprie a fiecăruia e folosire personală.

### 1. Ce se schimbă
- **Setări → Ale mele → „Date pentru acțiuni”** (nou, pentru oricine, adminul inclus):
  - ce dă cheia: „Cu cheia ta Twelve Data, graficele acțiunilor au 1m – 4h (pe lângă 1d și 1w) și semnalele de pe Azi folosesc timeframe-ul ales. Fără cheie: 1d și 1w, de la Nasdaq, gratuit.”;
  - cheia (salvată / înlocuită / ștearsă), verificată la salvare (1 credit al cheii, ca înainte); o cheie refuzată nu se salvează;
  - planul cheii și consumul de azi (ca în Admin până acum: „Planul Twelve Data: Grow: 55 de cereri pe minut, fără limită zilnică (citit acum 2 min)”, „x / 800 azi”, „Recitește planul”);
  - linkul de înregistrare (planul gratuit ajunge pentru câteva acțiuni).
- **Fiecare folosește doar cheia lui**: graficele, căutarea Twelve Data, semnalele acțiunilor de pe Azi (scanner-ul), creditele și planul sunt ale utilizatorului. Un utilizator fără cheie are acțiunile pe 1d și 1w (Nasdaq), ca un Sentiq fără cheie.
- **Setări → Admin → Date de piață**: rămân exchange-ul implicit pentru prețurile crypto și istoricul încărcat pe grafice; cheia, planul și consumul Twelve Data pleacă de aici.
- **Grafice**: un timeframe indisponibil spune „1h are nevoie de cheia ta Twelve Data (Setări → Ale mele → Date pentru acțiuni; planul gratuit ajunge); fără ea sunt 1d și 1w”, cu link pentru oricine (nu mai „o pune adminul”).
- **Stare sistem**: „Twelve Data: n utilizatori cu cheie” (consumul fiecăruia e în setările lui).
- **Indicii** (CNBC, Cboe, Nasdaq) și cotațiile, graficele mici și rezultatele companiilor (Nasdaq) nu au nevoie de cheie: rămân la fel pentru toți.

### 2. Cazuri limită
| Situație | Comportament |
|---|---|
| Utilizator fără cheie | acțiunile pe 1d și 1w (Nasdaq); timeframe-urile mici sunt gri, cu motivul și linkul spre setările lui; semnalele de pe Azi pe 1d („Slingshot pe 1d”) |
| Cheie refuzată la salvare | nu se salvează; mesajul Twelve Data |
| Cheie înlocuită | verificată pe creditele ei (nu ale cheii vechi); planul ei se citește imediat; consumul zilei începe de la cele două cereri ale ei (verificarea și planul) |
| Cheie ștearsă | limitele planului gratuit (presupuse) și consumul se uită; graficele trec pe 1d / 1w |
| Doi utilizatori cu aceeași cheie | Sentiq numără creditele pentru fiecare separat, Twelve Data pe cheie: limita poate fi atinsă mai devreme; un 429 oprește cererile acelui utilizator până la minutul următor (ca înainte) |
| Limita pe minut / pe zi a cuiva | doar el primește ultimele lumânări cu motivul; ceilalți nu sunt afectați |
| Utilizator dezactivat | planul lui nu se mai citește; scanner-ul nu-l mai scanează |
| Utilizator șters | cheia (prin cheia străină), planul, consumul și lumânările lui din memorie se șterg |
| Aceeași acțiune la doi utilizatori | cu cheie: fiecare o citește cu cheia lui (lumânările nu se împart); fără cheie: Nasdaq, o dată pentru toți |
| Mac-ul și Azure | cheia, planul și consumul zilei sunt în bază; fereastra pe minut e a fiecărei instanțe (ca înainte) |
| Planul nu poate fi citit la job | ceilalți utilizatori se citesc în continuare; jobul raportează cheile care n-au mers |

### 3. Mutarea cheii comune (o singură dată, la pornire)
- Cheia Twelve Data din Admin devine cheia **adminului** (aceeași cheie criptată), cu planul citit și consumul zilei.
- **Ceilalți utilizatori pierd 1m – 4h pentru acțiuni** până își pun cheia lor (gratuită). Semnalele lor intraday pentru acțiuni trec pe 1d.

### 4. Conflicte cu ce exista
- FD-SENTIQ §4.3 / FD-TDPLAN: cheia și planul nu mai sunt în Admin, ci la fiecare.
- FD-USERS §2 / FD-ADMINSET: Twelve Data nu mai e o setare „a tuturor”; Admin → Date de piață păstrează doar exchange-ul implicit și istoricul.
- FD-SENTIQ §4.6: scanner-ul calculează rândurile acțiunilor pentru fiecare utilizator cu cheie (cu creditele lui); fără cheie, rândul zilnic e comun.
- Schema bazei: același salt de versiune ca FD-AIKEYS (3); cheile personale stau toate în `user_keys`.

## FD-2FA — Autentificarea în doi pași, obligatorie (18 oct 2026)

Cererea utilizatorului: „implementează obligativitatea ca conturile să-și seteze identificarea cu doi factori. Dacă nu fac asta, nu le dai acces la aplicație. Deci introduci partea de two-factor authentication ca setup imediat după ce își activează contul. Ei încă nu intră în aplicație până când nu au setat 2FA.”

Context: 2FA (aplicația de autentificare + 10 coduri de recuperare) era opțional, din Securitate (FD-USERS §7); un cont nou intra în aplicație direct după activare și login, doar cu parola.

Cercetare (18 oct 2026):
- OWASP (Multifactor Authentication Cheat Sheet): al doilea factor pentru toți utilizatorii, mai ales pentru admin; schimbarea unui factor cere reautentificarea cu un factor existent (sesiunea singură nu ajunge); utilizatorul e anunțat pe alt canal (email) la orice schimbare a factorilor; resetarea trebuie să nu devină o cale de ocolire.
- Riscul cunoscut al configurării „la primul login” (Mandiant, APT29): cine are doar parola unui cont fără 2FA își poate înrola propriul telefon. De aceea contul nou își configurează 2FA imediat după linkul de activare (care dovedește adresa de email), iar orice configurare sau schimbare e anunțată pe email.
- În baza de producție (18 oct 2026): 2 conturi (adminul și un utilizator), amândouă cu 2FA. Nimeni nu e blocat la publicare.

Decizii:
- **Al doilea factor obligatoriu e aplicația de autentificare** (TOTP), cu codurile de recuperare. Passkey-ul rămâne un mod de a intra (ține loc de parolă și de cod), dar nu înlocuiește aplicația: un cont fără aplicație o configurează întâi, chiar dacă a intrat cu un passkey. Motiv: codurile de recuperare vin cu aplicația; un passkey pierdut nu are rezervă.
- **Pentru toate conturile**, adminul inclus.

### 1. Contul nou: configurarea imediat după activare
- Pe pagina „Activează-ți contul”, după parolă, nu mai urmează „Contul e activ” → „Intră în cont”: persoana e deja în cont și ajunge direct la **„Autentificarea în doi pași”**. Activarea ține loc de login.
- Ecranul (în stilul paginilor de login, fără meniul aplicației):
  1. „Instalează pe telefon o aplicație de autentificare: Google Authenticator, Microsoft Authenticator, 1Password, Authy…”;
  2. codul QR, plus cheia scrisă (pentru cine nu poate scana) și „Am scanat pe alt telefon: cheie nouă”;
  3. „Codul de 6 cifre din aplicație” → **„Activează”**.
- Apoi cele **10 coduri de recuperare**, o singură dată („Copiază”, „Descarcă .txt”, „Le-am salvat”) → **„Intră în Sentiq”** → pagina Azi.
- **Până la capăt, nimic altceva** din aplicație nu se deschide; singura ieșire e „Ieși din cont”. Pagina închisă înainte de final: la următoarea deschidere apare același ecran (cu același cod QR), iar dacă între timp sesiunea s-a încheiat, după login (email și parolă).
- **Excepția de acum** (FD-INVITE §5): linkul de activare deschis într-un browser deja în alt cont (ex. adminul îl încearcă). Activarea merge, dar contul curent din browser nu se schimbă. Ecranul „Contul e activ” spune, ca până acum, să ieși întâi din el. Butonul **„Ieși și intră cu ana@…”** face asta și deschide login-ul cu adresa completată; „Rămâi în contul de acum” duce înapoi. La login, contul nou ajunge la configurare.

### 2. Conturile care nu au încă 2FA
- Adminul, după prima parolă (pagina „Bun venit în Sentiq”) sau după `scripts/sentiq.sh admin-reset`; un cont căruia adminul i-a resetat 2FA; orice cont mai vechi fără 2FA.
- Ca la contul nou: după email și parolă (sau un passkey) urmează ecranul de configurare, fără acces la altceva până la final.
- **Sesiunile deschise înainte de configurare** pe alte dispozitive se închid când 2FA devine activ: au fost deschise fără al doilea factor.

### 3. Pagina „Securitate”
- **„Dezactivează” dispare**: autentificarea în doi pași nu se mai poate opri. Pe ecranul de configurare nu există „Renunță”; rămâne „Am scanat pe alt telefon: cheie nouă”.
- **„Schimbă aplicația de autentificare”** (nou, pentru telefon nou):
  - pornește doar cu parola și un cod din aplicația de acum (sau un cod de recuperare);
  - urmează un cod QR nou și codul de 6 cifre din aplicația nouă; după confirmare, aplicația nouă o înlocuiește pe cea veche;
  - până la confirmare, aplicația veche merge în continuare; „Renunță” o păstrează;
  - codurile de recuperare rămân aceleași.
- **„Coduri de recuperare noi”**: neschimbat (parola și un cod).
- După un login cu un cod de recuperare, mesajul devine: „Dacă ți-ai pierdut telefonul, schimbă aplicația de autentificare (cu parola și un cod de recuperare) sau generează coduri noi.”
- Îndemnul „Activează autentificarea în doi pași” pentru admin (după prima parolă) dispare: configurarea e deja făcută.

### 4. Pagina „Utilizatori” (admin)
- **„Oprește 2FA” devine „Resetează 2FA”**, cu confirmarea: „Resetezi autentificarea în doi pași pentru X? Sesiunile contului se închid; la următorul login, cu parola, își configurează din nou aplicația. Folosește asta doar dacă și-a pierdut telefonul și codurile de recuperare.”
- **Coloana „Securitate”**: „2FA”; „2FA neconfigurat” (contul e activat, dar nu și-a configurat încă aplicația); „—” (cont neactivat). Numărul de passkey-uri, ca până acum.

### 5. Emailuri de anunț (OWASP)
- **„Sentiq · autentificarea în doi pași e activă”**: la configurare. „Dacă nu tu ai făcut asta, cere cât mai repede o parolă nouă din «Am uitat parola» (închide toate sesiunile), apoi scrie-i adminului.”
- **„Sentiq · aplicația de autentificare a fost schimbată”**: la schimbarea aplicației, cu același îndemn.
- **„Sentiq · autentificarea în doi pași a fost resetată”**: la resetarea făcută de admin. „La următorul login îți configurezi din nou aplicația.”
- Nu conțin linkuri sau coduri. Cu expeditorul de test al Resend ajung doar la admin, ca toate emailurile.

### 6. Cazuri limită
| Situație | Comportament |
|---|---|
| Cod greșit la configurare | „Cod greșit…”, cu amintirea orei automate pe telefon; după 3 greșeli, 15 minute de pauză (bugetul contului) |
| Ceasul telefonului decalat | același mesaj; fereastra e de ±30 s |
| Ecranul de configurare deschis în două taburi | terminat într-unul, celălalt intră în aplicație la revenirea în tab sau la „Activează” |
| „Am scanat pe alt telefon: cheie nouă” într-un tab | celălalt tab arată codul QR nou la revenire; codul din QR-ul vechi e refuzat |
| Pagina închisă în timp ce se văd codurile de recuperare | 2FA e deja activ, iar codurile nu se mai arată; coduri noi din Securitate (parola și un cod) |
| Codurile de recuperare sunt pe ecran, iar starea contului se recitește (revenirea în tab) | codurile rămân pe ecran până la „Intră în Sentiq” |
| Sesiunea închisă în altă parte în timpul configurării | ecranul de login |
| Contul dezactivat în timpul configurării | sesiunile se închid; la login: „Contul este dezactivat” |
| Adminul resetează 2FA cât contul e în aplicație | sesiunile contului se închid; login cu parola → configurare; emailul de resetare |
| Login cu passkey, cont fără aplicație | ecranul de configurare |
| Login cu passkey, cont cu aplicație | intră direct, fără cod, ca până acum |
| „Am uitat parola” pentru un cont fără 2FA | parola nouă, apoi la login ecranul de configurare |
| Parola cuiva cu contul încă neconfigurat ajunge la altcineva | primul care intră configurează aplicația. Persoana care deține contul primește emailul „e activă” și, în ordinea asta: își pune o parolă nouă din „Am uitat parola” (linkul vine pe adresa contului; toate sesiunile se închid), apoi îi scrie adminului, care resetează 2FA, iar la login își configurează propria aplicație. În ordine inversă, cine are parola veche ar putea configura din nou primul. Conturile noi nu au această fereastră: configurează imediat după linkul de activare |
| Schimbarea aplicației lăsată la jumătate | aplicația veche merge; Securitate arată schimbarea începută (codul QR nou), cu „Confirmă” și „Renunță”; după „Renunță”, o nouă „Schimbă…” începe de la capăt (din nou cu parola și un cod) |
| Schimbarea: în câmpul nou e scris codul aplicației vechi | refuzat: se cere codul din aplicația nouă |
| Telefon pierdut, coduri de recuperare la îndemână | login cu un cod de recuperare → „Schimbă aplicația” cu parola și alt cod de recuperare |
| Telefon și coduri pierdute | adminul resetează 2FA; adminul însuși: `scripts/sentiq.sh admin-reset` |
| Tab vechi, de dinainte de actualizare, al unui cont fără 2FA | cererile lui primesc „Configurează mai întâi autentificarea în doi pași”; la reîncărcare apare ecranul de configurare |
| Joburile din fundal pentru un cont fără 2FA | continuă (scanner, planul Twelve Data, scorul AI pe cheia proprie, dacă fusese pus): datele sunt gata la intrare |

### 7. Conflicte cu ce exista
- **FD-USERS §5:** codul la login nu mai e „dacă 2FA e pornit”: e mereu cerut, cu excepția passkey-ului.
- **FD-USERS §7:** din Securitate dispar „Dezactivează” și „Renunță”; apare „Schimbă aplicația de autentificare”.
- **FD-USERS §8:** „Oprește 2FA” devine „Resetează 2FA”, iar sesiunile se închid. Înainte se închidea doar pasul de cod în așteptare.
- **FD-USERS §3:** după prima parolă, adminul ajunge la configurare, nu în Securitate cu îndemnul de a porni 2FA.
- **FD-INVITE §3:** după activare nu mai e nevoie de „Intră în cont”: persoana e deja în cont, pe ecranul de configurare.
- **Passkey-urile:** la login țin loc în continuare de ambii factori, dar un cont fără aplicație o configurează întâi.
- **Schema bazei (versiunea 4):** o coloană pentru aplicația nouă în timpul unei schimbări. Codul vechi (Mac-ul neactualizat) refuză să pornească pe schema nouă până e actualizat.
- **Testele și scripturile care fac sesiuni direct** (fără login) trebuie să marcheze contul cu 2FA, altfel primesc „Configurează mai întâi…”.

## FD-TRADING — Ordine de tranzacționare din Sentiq (18 oct 2026)

Cererea utilizatorului: „vreau să pot crea ordine de tranzacționare direct din aplicație. Atunci când obțin un API key care are drepturi să inițieze tranzacții, să pot să fac și eu aceste tranzacții. Citești documentația pentru fiecare broker și exchange crypto și implementezi pentru fiecare această posibilitate, acolo unde se oferă.”

Decizii (AskUserQuestion, 18 oct 2026):
- **Piețe:** spot pe toate exchange-urile crypto, plus futures perpetue USDT cu levier, marjă cross / isolated, TP / SL și închiderea pozițiilor, unde există. Acțiuni la brokeri.
- **Confirmare:** fiecare ordin arată un rezumat și pleacă doar după „Confirmă”. Pornirea tranzacționării pe un cont cere o dată parola și codul 2FA.
- **Unde:** pagina Tranzacții (ordin nou, anularea ordinelor, închiderea pozițiilor, vânzarea unei dețineri) și butonul „Tranzacționează” de pe grafic (formularul precompletat).

Până acum (FD §0, principiul 2): „Informează, nu tranzacționează”. Cheile erau cerute doar pentru citire, iar un test verifica lipsa oricărui apel de ordin. Acest FD schimbă principiul: Sentiq poate trimite ordine **doar** pe conturile unde utilizatorul a pornit tranzacționarea și cu o cheie care o permite. **Nu mută niciodată fonduri:** nu face retrageri sau transferuri și refuză cheile care le permit.

### Cercetare (18 oct 2026): ce permite fiecare platformă
Surse: documentațiile oficiale (Trading 212 Public API, eToro Public API, Alpaca Trading API, IBKR Web API) și implementarea ccxt 4.5 (biblioteca prin care Sentiq vorbește cu exchange-urile crypto), care trimite cererile după documentația fiecărui exchange.

| Platformă | Ce se poate din Sentiq | Permisiunea cheii (fără retrageri) | Limitări |
|---|---|---|---|
| **KuCoin** | spot: la piață, limită, stop (piață / limită); futures USDT: aceleași, cu levier, cross / isolated, TP / SL atașate, reduce-only, închiderea poziției; anulare | „Spot” și / sau „Futures” (pe lângă „General”); fără „Withdrawal” | futures în **loturi întregi** (minimum 1 lot; un lot = mărimea contractului, ex. 0,001 BTC); conturile unificate (UTA) și cele clasice au endpoint-uri diferite (le alege ccxt); pe un cont unificat, futures doar cu marjă **cross** (isolated e refuzat cu „alege Cross”) |
| **Binance** | spot: la piață, limită, stop-limită (Binance spot nu are stop la piață); futures USDⓈ-M: la piață, limită, stop, levier, cross / isolated, reduce-only, închidere; anulare | „Enable Spot & Margin Trading” și / sau „Enable Futures”; fără „Enable Withdrawals” | TP / SL nu se atașează la intrare: Sentiq le trimite separat, ca ordine reduce-only, imediat după o intrare la piață |
| **Bybit** | spot și futures liniare USDT: la piață, limită, stop, levier, TP / SL atașate, reduce-only, închidere; anulare | „Read-Write”: Spot (SpotTrade) și / sau Contract (Orders, Positions); fără Withdraw | modul de marjă (cross / isolated) e al întregului cont unificat: Sentiq nu-l schimbă, îl folosește pe cel ales pe Bybit |
| **OKX** | spot și swap USDT: la piață, limită, stop, levier, cross / isolated, TP / SL atașate, reduce-only, închidere; anulare | „Trade”; fără „Withdraw” | cantitatea la swap e în contracte (ex. 0,01 BTC); Sentiq o convertește |
| **Bitget** | spot și futures USDT-M: la piață, limită, stop, levier, cross / isolated, TP / SL atașate, reduce-only, închidere; anulare | „Trade”; fără „Withdraw” | modul de poziție (one-way / hedge) trebuie trimis cu fiecare ordin: Sentiq îl citește din cont (și hedge-ul merge, FD-HEDGEALL). Pe un cont unificat (UTA): futures doar cu marjă cross, iar ordinele stop se pun din aplicația Bitget (ccxt nu le are încă pentru acest cont) |
| **Kraken** | spot: la piață, limită, stop-loss (piață / limită); anulare | „Create & Modify Orders” și „Cancel & Close Orders”; fără „Withdraw Funds” | Kraken Futures e un API separat (neconectat în Sentiq): fără futures; Kraken nu spune permisiunile cheii |
| **Coinbase** | spot (Advanced Trade): la piață (cumpărarea pe sumă în USD / USDC), limită, stop-limită; anulare | cheie CDP cu „Trade”; fără „Transfer” | fără stop la piață; fără futures (derivatele Coinbase au alt cont) |
| **Trading 212** | la piață (și în afara orelor, opțional), limită, stop, stop-limită; anulare; vânzarea unei dețineri | permisiunea „Orders: Execute” | doar conturi Invest / ISA, doar în moneda contului; API-ul e în beta și nu e idempotent (o cerere repetată poate dubla ordinul); o documentație mai veche spunea că pe Live merg doar ordinele la piață (dacă Trading 212 refuză, Sentiq arată mesajul lor) |
| **eToro** | deschiderea unei poziții: la piață, „market-if-touched” (la un preț țintă) sau limită imediată, pe sumă (USD) sau unități, cumpărare sau short, levier, SL / TP; închiderea unei poziții (toată sau parțial); anularea unui ordin în așteptare | cheie cu „Write” (pe mediul ales: Real / Demo) | confirmarea e asincronă: un 200 înseamnă „primit”, nu „executat” (Sentiq verifică starea); levier peste 1 sau short cer stop-loss |
| **Alpaca** | acțiuni: la piață, limită, stop, stop-limită; zi / până la anulare; fracționat și pe sumă (USD), cu oricare dintre cele patru tipuri, valabile o zi; TP / SL atașate (bracket, nu în afara orelor); crypto: la piață, limită, stop-limită; anulare; închiderea poziției | cheile Alpaca pot tranzacționa întotdeauna (nu au variantă doar pentru citire) | ordinele în afara orelor merg doar limită; crypto doar „până la anulare” sau „imediat” |
| **Interactive Brokers** | **nu** | — | Sentiq citește IBKR printr-un raport Flex (doar citire). Ordinele cer Client Portal Gateway (program local, cu login zilnic din browser) sau OAuth (înregistrare separată, pentru conturi Pro / instituții): nu merg cu cheia de acum. Rămâne doar citire, cu explicația în aplicație |

### 1. Pornirea tranzacționării pe un cont
- Fiecare cont are **„Tranzacționare: oprită”** implicit (și conturile de până acum).
- **„Pornește tranzacționarea”** (pe pagina Tranzacții, la cont, și în Setări → Conturi):
  - cere **parola și codul 2FA** (sau un cod de recuperare);
  - Sentiq recitește permisiunile cheii, unde exchange-ul le spune:
    - cheia **nu poate tranzacționa**: refuzat, cu pașii platformei pentru o cheie cu tranzacționare;
    - cheia poate tranzacționa doar spot sau doar futures: pornit pentru ce poate („doar spot”);
    - cheia **poate retrage sau transfera fonduri**: refuzat. „Cheia poate retrage fonduri. Fă o cheie fără retrageri / transferuri: Sentiq nu pornește tranzacționarea cu ea.”;
    - permisiunile nu se pot citi (Kraken, Trading 212, eToro): pornit, cu avertismentul să verifici că cheia nu poate retrage fonduri;
  - IBKR: butonul nu apare, ci „Interactive Brokers nu permite ordine prin cheia Flex (doar citire)”.
- **„Oprește tranzacționarea”**: imediat, fără parolă.
- Pe conturile Demo / Paper / Practice, eticheta **DEMO** apare lângă orice ordin.

### 2. Formularul de ordin
- Se deschide din „Ordin nou” (Tranzacții), din „Tranzacționează” (grafic), din „Vinde” (o deținere) sau din „Închide” (o poziție).
- **Contul:** doar conturile cu tranzacționarea pornită, care pot tranzacționa piața aleasă.
- **Piața:**
  - crypto: „Spot” sau „Futures” (doar unde există și cheia permite);
  - brokeri: acțiunea (simbolul).
- **Simbolul:**
  - crypto: lista perechilor exchange-ului (USDT, apoi USDC / USD), cu căutare;
  - futures: perpetuele USDT;
  - brokeri: simbolul (ex. AAPL), căutat la broker.
- **Cumpără / Vinde** (futures: **Long / Short**; eToro: Cumpără / Short).
- **Tipul:**
  - La piață;
  - Limită;
  - Stop: se declanșează la un preț, apoi la piață; de cumpărare peste prețul de acum, de vânzare sub el;
  - Stop-limită;
  - doar cele pe care platforma le are (vezi tabelul).
- **Cantitatea:** în activ (ex. 0,01 BTC, 5 acțiuni) sau ca valoare (ex. 100 USDT).
  - Butoane 25% / 50% / 100% din ce e disponibil: pentru cumpărare, din USDT / numerar (la futures: marja × levierul); pentru vânzare spot, din deținere.
  - Futures: valoarea e cea a poziției; marja = valoare ÷ levier.
- **Prețul** (limită), **prețul de declanșare** (stop), **valabilitatea** (până la anulare / până la sfârșitul zilei, unde există).
- **Futures:**
  - levierul (1× – maximul pieței);
  - marja cross / isolated (nu la Bybit, unde e a contului);
  - **reduce-only** („doar micșorează poziția”);
  - **TP / SL** opționale (prețuri de declanșare);
  - pe Binance: doar la o intrare la piață, trimise după ea;
  - KuCoin: cantitatea se rotunjește în jos la loturi întregi.
- **eToro:**
  - levierul (1× = deținere);
  - SL / TP;
  - suma în USD sau unitățile.
- **Alpaca:**
  - în afara orelor (doar limită);
  - TP / SL (bracket, doar acțiuni, cantitate întreagă).
- **„Verifică ordinul”** trimite datele la Sentiq, care:
  - rotunjește cantitatea și prețurile la pașii pieței;
  - calculează valoarea, marja și ce rămâne disponibil;
  - verifică minimele platformei, soldul (unde se poate citi), direcția stop-ului față de prețul de acum și prețul limită față de prețul de acum (avertisment peste 10% distanță).

### 3. Fereastra de confirmare
- Rezumatul exact al ce pleacă:
  - contul (cu DEMO, dacă e cazul);
  - piața și simbolul;
  - direcția (verde / roșu);
  - tipul;
  - cantitatea rotunjită (și în loturi / contracte, unde e altfel);
  - prețurile;
  - valoarea estimată;
  - levierul și marja;
  - TP / SL;
  - reduce-only.
- **Avertismente**, unde e cazul:
  - prețul limită e peste prețul de acum la cumpărare (se execută imediat);
  - ordinul la piață pe o piață închisă (Trading 212: se execută la deschidere);
  - levier peste 10×;
  - ordinul folosește peste 50% din disponibil;
  - cantitatea a fost rotunjită.
- **„Confirmă și trimite”** / „Înapoi”. Butonul se blochează după primul click, ca un dublu click să nu trimită de două ori.
- **După trimitere:**
  - „Ordin trimis: ID … (stare: deschis / executat / în așteptare)”, cu „Vezi în Tranzacții”;
  - portofoliul se recitește;
  - pentru eToro, starea se verifică încă câteva secunde („primit… executat”);
  - cu TP / SL trimise separat (Binance), fiecare apare în rezumat cu starea lui. Dacă unul nu a mers: „Stop loss: NU a fost plasat: … Poziția e deschisă: pune-l din nou.”. Se pune din formular, ca ordin stop reduce-only în sens opus, sau din Binance.

### 4. Pe pagina Tranzacții
- Lângă selectorul de cont: **„Ordin nou”** (pornit) sau **„Pornește tranzacționarea”**.
- **Ordine deschise:** pe exchange-uri, și ordinele futures și cele stop (Binance, Bybit, OKX, Bitget le țin în liste separate, citite fiecare). „Anulează” pe fiecare ordin plasat pe platformă, cu o confirmare scurtă. Nu apare:
  - pe SL / TP-urile eToro deduse din poziții, care se schimbă din eToro;
  - pe ordinele unei piețe pentru care tranzacționarea nu e pornită (de ex. ordinele futures, la o cheie doar pentru spot).
- **Poziții:**
  - „Închide” → formularul precompletat: la piață, toată poziția, reduce-only. Piața, direcția și contul sunt fixe; cantitatea se poate micșora (închidere parțială). Levierul și marja nu se schimbă la o închidere;
  - eToro: închiderea poziției, cu „parțial” opțional;
  - Alpaca: închiderea poziției;
  - pe un cont crypto, „Închide” apare doar dacă tranzacționarea e pornită pentru futures.
- **Dețineri:** „Vinde” → formularul precompletat cu vânzarea cantității libere. Nu apare pe:
  - un cont crypto unde tranzacționarea e pornită doar pentru futures;
  - stablecoin-uri;
  - instrumentele fără simbol;
  - soldul „main” al unui cont KuCoin clasic: se tranzacționează doar după mutarea în contul de trading, iar Sentiq nu mută fonduri.
- **„Ordinele trimise din Sentiq”** (ultimele 50):
  - ora, contul, simbolul, direcția, tipul, cantitatea, prețul;
  - rezultatul (trimis / refuzat, cu motivul);
  - anulările și închiderile.

### 5. Din grafic
- **„Tranzacționează”**, lângă selectorul de timeframe: formularul cu simbolul graficului și prețul de acum ca preț limită.
  - Crypto: piața spot pe primul exchange cu tranzacționarea pornită. Contul și piața se pot schimba din formular; o pereche care nu e pe exchange-ul ales e semnalată (pe Kraken / Coinbase, X/USDT devine X/USD sau X/USDC).
  - Acțiuni: primul broker cu tranzacționare.
- Butonul apare doar dacă utilizatorul are cel puțin un cont cu tranzacționarea pornită. Indicii nu se tranzacționează.

### 6. Siguranță
- **Doar cu tranzacționarea pornită** pe cont (parola + 2FA o dată) și numai pentru conturile utilizatorului: nimeni, nici adminul, nu tranzacționează pe contul altuia.
- **Niciodată retrageri sau transferuri:** codul nu are astfel de apeluri, iar un test verifică asta.
  - Cheile care le permit sunt refuzate la pornire.
  - O cheie care primește mai târziu o astfel de permisiune (văzută la „Testează” sau la ordinul următor) oprește singură tranzacționarea pe cont.
  - O nouă încercare de pornire refuzată (cheie fără tranzacționare sau cu retrageri) oprește și tranzacționarea pornită înainte.
- **Idempotență:** fiecare formular trimis are un identificator unic.
  - O a doua trimitere cu același identificator (dublu click, reîncercare după o eroare de rețea) primește rezultatul primei, fără un ordin nou, pe ambele instanțe (Mac / Azure).
  - Un ordin **refuzat** (verificare, sold, platformă), care n-a intrat în cartea de ordine, eliberează identificatorul: același formular se poate trimite din nou, de exemplu după o depunere.
  - Unde platforma acceptă un ID de client (crypto, Alpaca, eToro), acesta pleacă și la platformă.
- **Limită de viteză:** cel mult 20 de acțiuni de tranzacționare (ordine, anulări, închideri) pe minut, pe utilizator, ca o buclă sau un tab blocat să nu trimită zeci de ordine.
- **Jurnal:** fiecare ordin, anulare și închidere se scrie în bază (cine, când, ce, rezultatul), fără chei. Nu se șterge odată cu contul de exchange, ci doar odată cu utilizatorul.
- **Eroare fără răspuns** (timeout după trimitere): „Nu știm sigur dacă ordinul a ajuns. Verifică ordinele deschise înainte să-l trimiți din nou.”, iar portofoliul se recitește. Nu se reîncearcă automat.
- Erorile platformelor apar cu mesajul lor (ex. „Insufficient balance”), plus o explicație în română pentru cele cunoscute: sold insuficient, cantitate sub minim, permisiune lipsă, piață închisă, preț în afara limitelor, modul hedge.

### 7. Cazuri limită
| Situație | Comportament |
|---|---|
| Cheie doar de citire, tranzacționarea pornită pe ea | refuzată la pornire (unde permisiunile se citesc); altfel primul ordin primește „cheia nu are permisiunea de tranzacționare” cu pașii platformei, iar tranzacționarea rămâne pornită până o oprești |
| Cheia schimbată pe platformă (permisiunea scoasă) după pornire | ordinele primesc eroarea de permisiune, cu pașii |
| Cheie cu permisiune de retragere | tranzacționarea nu pornește; contul rămâne doar citire |
| Permisiunile nu se pot citi chiar acum (o eroare de moment) | se păstrează cele știute: o cheie știută cu retrageri rămâne refuzată |
| Cheie care poate doar spot (fără futures) | „Futures” nu apare în formular pentru acel cont |
| Cont futures în modul hedge | ordinele merg, cu poziția numită (FD-KUCOINHEDGE, FD-HEDGEALL), pe KuCoin clasic, Binance, Bybit, OKX și Bitget. Refuzat doar pe contul unificat KuCoin, cu explicația |
| Levier peste maximul pieței | refuzat la verificare, cu maximul pieței (formularul arată maximul lângă câmp) |
| Schimbarea levierului / marjei cu o poziție deschisă | platforma poate refuza (ex. Binance nu schimbă marja cu poziție deschisă): mesajul ei; ordinul nu pleacă |
| Cantitate sub minim (sau 0 după rotunjire) | refuzată la verificare: „Minimul pe … e …” |
| KuCoin futures: sub un lot | „Minimul e 1 lot (= 0,001 BTC)” |
| Sold insuficient | avertisment la verificare (unde soldul se citește); platforma refuză oricum |
| Stop de cumpărare sub prețul de acum (sau de vânzare peste) | refuzat la verificare: „Un stop de cumpărare se declanșează peste prețul de acum; pentru a cumpăra mai jos, folosește un ordin limită” |
| Preț limită foarte departe de piață (> 10%) | avertisment în confirmare; eToro refuză peste 10% |
| Piața nu există pe exchange (pereche delistată) | refuzat la verificare: „Perechea … nu e pe …” |
| Simbol necunoscut la broker | „Trading 212 / eToro / Alpaca nu are simbolul …” |
| Același simbol pe mai multe burse (Trading 212) | se alege instrumentul în moneda contului, apoi cel american; confirmarea arată ISIN-ul / bursa |
| Ordin la piață pe o piață închisă (acțiuni) | Trading 212 / Alpaca îl pun în așteptare până la deschidere; avertisment în confirmare |
| Dublu click pe „Confirmă” | un singur ordin (butonul blocat, plus idempotența pe server) |
| Același formular trimis din două taburi | două ordine distincte (fiecare tab are identificatorul lui): e intenția utilizatorului |
| Rețeaua cade după trimitere | starea necunoscută (§6); nimic retrimis automat |
| Serverul repornește chiar în timpul trimiterii | după 2 minute, același formular primește „trimiterea a fost întreruptă: nu știm sigur dacă a ajuns”; nimic retrimis |
| Trading 212: prețul de acum | API-ul lor nu dă cotații: formularul arată prețul doar pentru acțiunile deținute (de pe grafic, prețul graficului e completat ca preț limită) |
| KuCoin cont unificat: anularea unui ordin futures | recunoscut după simbol (BTC/USDT:USDT) ca futures, oricum l-ar lista contul |
| eToro: ordinul rămâne „în așteptare” (piață închisă) | „Primit de eToro; se execută la deschiderea pieței” |
| eToro: refuzat după acceptare | „Refuzat de eToro: …” (motivul din starea ordinului) |
| Binance: TP / SL după intrare refuzate | poziția rămâne deschisă; rezultatul cere să le pui din nou (un ordin stop reduce-only în sens opus, din formular) |
| Anulare pentru un ordin deja executat | „Ordinul nu mai e deschis (poate s-a executat)”; portofoliul se recitește |
| Închiderea unei poziții deja închise | „Poziția nu mai e deschisă” |
| Închidere parțială (eToro) peste unitățile poziției | refuzată la verificare |
| eToro: o deținere din mai multe poziții, una nu se închide | celelalte se închid; rezultatul spune care nu s-a închis și de ce; una fără răspuns apare separat: „nu știm sigur dacă s-a închis (verifică pe eToro)” |
| Cheie fără futures (Binance, Bybit, Bitget) | ordinele futures nu se pot citi: lista arată ordinele spot, fără eroare |
| Bitget cont unificat: stop sau marjă isolated | refuzate la verificare: „pune-l din aplicația Bitget” / „alege Cross” |
| KuCoin cont unificat: futures cu marjă isolated | refuzat la verificare: „alege Cross”; închiderile trec |
| Alpaca: fracționat sau pe sumă, valabil „până la anulare” | refuzat la verificare: „valabile o zi” |
| După „necunoscut”, „Înapoi” și un formular schimbat | eroarea veche dispare; formularul nou se verifică și se confirmă normal (același formular retrimis primește tot „necunoscut”) |
| Tranzacționarea oprită între formular și confirmare | „Tranzacționarea e oprită pe acest cont” |
| Contul de exchange șters cât formularul e deschis | „Contul nu mai există” |
| Contul utilizatorului dezactivat | sesiunile se închid; nimic nu mai pleacă |
| Limita de viteză (20 / minut) | „Prea multe ordine într-un minut. Mai încearcă peste … secunde.” |
| Limitele de viteză ale platformei (ex. Trading 212: 1 ordin limită la 2 s) | mesajul platformei; nimic retrimis automat |
| Prețul s-a mișcat între verificare și confirmare | ordinul la piață se execută la prețul de atunci (avertismentul de slippage); cel limită la prețul ales |
| Cont Demo / Paper | ordinele merg pe mediul de test al platformei; eticheta DEMO |
| IBKR | fără tranzacționare; mesajul din §1 |
| Kraken / Coinbase și futures | doar spot |
| Ordin pe o monedă cu valoare foarte mică (zecimale multe) | prețul și cantitatea se rotunjesc la pașii pieței; confirmarea arată valorile rotunjite |
| Mac-ul și Azure | ordinele pleacă de pe instanța care servește pagina; jurnalul și idempotența sunt în baza comună |

### 8. Conflicte cu ce exista
- **FD §0 (principiul 2), FD-SENTIQ §2, TD §2.7 și testul „fără cod de tranzacționare”:**
  - principiul devine: „Informează; tranzacționează doar la cerere, pe conturile alese”;
  - testul verifică acum că retragerile și transferurile nu există nicăieri;
  - apelurile de ordin apar doar în modulul de tranzacționare.
- **Expertul „Adaugă un cont”:**
  - pașii rămân pentru o cheie doar de citire (recomandat);
  - în plus, pentru fiecare platformă, „Pentru tranzacționare”: ce permisiune adaugi și ce nu bifezi niciodată (retrageri, transferuri);
  - textul „Sentiq doar citește” devine „Sentiq citește; tranzacționează doar dacă pornești asta pe cont”.
- **Avertismentul „permisiuni în plus față de citire”:**
  - rămâne pentru retrageri și transferuri;
  - pentru tranzacționare apare doar cât tranzacționarea e oprită în Sentiq, ca informare („cheia poate tranzacționa; pornește tranzacționarea dacă vrei să o folosești”).
- **Alpaca:** textul „Sentiq folosește cheia numai pentru citire” devine „doar pentru citire, până pornești tranzacționarea”.
- **Graficele (FD-PNL):** liniile ordinelor și ale TP / SL rămân afișate ca până acum; ordinele trimise din Sentiq apar după recitirea portofoliului.
- **Portofoliul (cache 20 s):** se golește după orice acțiune de tranzacționare pe acel cont.
- **Schema bazei:** migrarea 5 (tranzacționarea pe cont, jurnalul ordinelor). Ca la migrarea 4, codul vechi refuză să pornească pe schema nouă până e actualizat.
- **FD-2FA:** pornirea tranzacționării folosește aceeași verificare (parola, apoi codul, cu bugetul de încercări al contului).

## FD-INDICATORS — Orice indicator TradingView pe grafic; Slingshot și LMA la „Premium” (18 oct 2026)

Cererea utilizatorului: „Acum implementează adăugarea de orice indicator oferit de providerul de chart. Gratis sunt vreo 100 de indicatori, așa că trebuie să faci un UI pentru asta. Iar cele ale mele, Slingshot și LMA, le pui sus într-o categorie dedicată în lista de indicatori și le pui un tag premium. Astea vor fi cu plată în viitor.”

### Cercetare (18 oct 2026): de unde vin indicatorii
- Graficul Sentiq folosește **TradingView Lightweight Charts** (5.2). Librăria **nu are niciun indicator inclus**: documentația TradingView o spune explicit și dă doar câteva exemple de calcul. Cei „100+ indicatori gratuiți” sunt ai **Advanced Charts**, alt produs TradingView: altă librărie (fără sursă publică), care se primește doar după o cerere de licență aprobată de TradingView și ar înlocui tot graficul (Slingshot, LMA, pozițiile, PnL-ul).
- Sentiq ia, în schimb, **cei 117 indicatori standard TradingView** din portul open-source [`lightweight-charts-indicators`](https://github.com/deepentropy/lightweight-charts-indicators) (licență MIT), făcut chiar pentru Lightweight Charts 5: aceleași nume, intrări, valori implicite, culori, linii orizontale și umpleri ca în TradingView. Upstream are teste de regresie față de rezultatele TradingView. Se calculează în browser.
- Pachetul npm întreg are 15 MB (1.713 indicatori, inclusiv 1.551 de porturi comunitare). Sentiq preia doar sursa celor 117 standard și a desenatorului, de la un commit fix (`f8e1b0e`), plus biblioteca lor de calcul `oakscriptjs` (MIT, versiune fixată). Totul ocupă ~112 KB comprimat și se încarcă doar pe pagina Grafice, când e nevoie. Codul preluat nu face cereri de rețea și nu execută cod dinamic (verificat).
- Indicatorul de bază **Volume** (histograma volumului) nu e în setul standard al portului: Sentiq îl scrie el, cu regulile TradingView (bare verzi / roșii după lumânare, media volumului opțională).

### 1. Lista de indicatori
- Butonul **„Indicatori”** din bara graficului deschide fereastra **Indicatori**: căutare sus, categoriile în stânga, lista în dreapta.
- **Categorii**, în ordine:
  1. **Premium**: **Slingshot System 3.3** și **[DI] Logarithmic Moving Average**, fiecare cu eticheta **PREMIUM**. Deocamdată merg pentru toată lumea, ca până acum. Plata vine mai târziu, cu regulile ei într-un FD separat.
  2. **Toți**: toți indicatorii (Premium primii).
  3. **Medii mobile** (16), **Oscilatori** (23), **Momentum** (15), **Trend** (28), **Volatilitate** (10), **Canale și benzi** (7), **Volum** (19, cu Volume).
- **Un rând** arată:
  - numele TradingView (în engleză, ca acolo) și prescurtarea;
  - unde apare: „pe grafic” sau „panou separat”;
  - descrierea scurtă, la trecerea mouse-ului;
  - eticheta PREMIUM, unde e cazul.
- **Click pe un rând:** indicatorul se adaugă pe grafic, iar rândul arată scurt „Adăugat”. Fereastra rămâne deschisă, pentru încă unul. Se închide cu ×, cu Esc sau cu un click în afara ei.
  - Slingshot / LMA deja pe grafic: rândul arată „Pe grafic”, iar un click nu-l dublează.
  - Un indicator standard se poate adăuga de mai multe ori (ex. EMA 20 și EMA 50).
- **Căutarea** găsește după nume sau prescurtare („rsi”, „bollinger”, „macd”), fără să țină cont de majuscule sau diacritice, în toate categoriile. Fără rezultat: „Niciun indicator nu se potrivește.”
- **Limita:** cel mult **20 de indicatori standard** pe grafic, plus Slingshot și LMA. La limită, rândurile sunt dezactivate, cu „Ai deja 20 de indicatori pe grafic: scoate unul ca să adaugi altul.”
- **Pe telefon:** fereastra ocupă lățimea ecranului, iar categoriile devin un rând de butoane care se derulează.
- Tastatura: tab prin categorii și rânduri, Enter adaugă, Esc închide.

### 2. Pe grafic
- Un indicator **„pe grafic”** (overlay: medii mobile, Bollinger, Ichimoku, Supertrend…) se desenează peste lumânări. **Ceilalți** au fiecare panoul lor sub grafic, în ordinea adăugării, după panoul LMA, dacă e afișat.
- **Înălțimea:** graficul crește cu 120 px pentru fiecare panou (ca acum la LMA: 560 → 680 px). În ecran complet, panourile împart înălțimea ecranului.
- **Separatorul** dintre panouri se trage, iar înălțimea fiecărui panou se ține minte.
- **Legenda** fiecărui indicator stă sus-stânga, în panoul lui (cei de pe grafic, unul sub altul în panoul prețului). Conține:
  - prescurtarea și parametrii principali (ex. „RSI 14 close”);
  - valorile la lumânarea de sub cursor (fără cursor, la ultima lumânare), fiecare în culoarea liniei ei;
  - butoanele **ochi** (ascunde / arată), **rotiță** (setări), **×** (scoate de pe grafic).
- **Ascuns cu ochiul:** nu se mai calculează și nu se mai desenează. Legenda lui rămâne, estompată: în panoul prețului pentru cei de pe grafic; pentru cei cu panou propriu, panoul dispare, iar legenda trece, estompată, în panoul prețului, de unde îl arăți din nou.
- **Slingshot și LMA:**
  - au legendă cu rotiță și ×; × înseamnă scos de pe grafic, ca debifarea de acum;
  - **bifele „Slingshot” și „LMA” din bara graficului dispar**: se adaugă din lista Indicatori și se scot din legendă;
  - „Pozițiile mele” rămâne bifă, nefiind indicator.
- Desenele indicatorilor sunt cele din TradingView:
  - linii, histograme, coloane, umpleri între linii, linii orizontale (ex. 70 / 30 la RSI);
  - semne pe lumânări (ex. Williams Fractals), etichete, linii și cutii (ex. Pivot Points, Auto Fib);
  - tabele (ex. Performance, Seasonality).
- **Actualizare:**
  - indicatorii se recalculează cu fiecare lumânare nouă (la 10 s, 30 s sau 60 s, ca graficul);
  - zoom-ul și poziția nu se schimbă;
  - **Visible Average Price** se recalculează și când muți sau mărești graficul (după 300 ms de liniște).

### 3. Setările unui indicator (rotița)
- Se deschid în panoul lateral de acum, cu numele indicatorului sus și tab-urile **„Intrări”** și **„Stil”**.
- **Intrări:** exact câmpurile din TradingView ale indicatorului, cu aceleași nume (în engleză), grupuri, valori implicite, limite, liste și tooltip-uri (i):
  - număr întreg / zecimal, cu limitele lui;
  - bifă;
  - listă de variante;
  - **sursă** (open, high, low, close, hl2, hlc3, ohlc4, hlcc4);
  - culoare;
  - **timeframe**: „Grafic” sau unul anume;
  - **simbol** (text) și **sesiune** (ex. „0930-1600”).
- Un câmp care depinde de altul (ex. „Length” al mediei RSI, când tipul mediei e „None”) e dezactivat cât nu se aplică.
- **Stil:**
  - fiecare linie desenată (plot), cu bifa de vizibilitate, culoarea și grosimea (1–4);
  - fiecare linie orizontală (hline), cu bifa și culoarea;
  - umplerea dintre două linii desenate dispare odată cu una dintre ele; cea dintre două linii orizontale rămâne, ca în TradingView.
- **Butoane:**
  - **„Salvează”** aplică pe grafic și ține minte;
  - **„Valorile implicite”** pune în formular valorile TradingView, aplicate abia la „Salvează”;
  - o valoare în afara limitelor e refuzată la salvare cu numele câmpului și limitele lui, ca la formularele de acum.
- **Slingshot și LMA:** formularele lor de acum, neschimbate.

### 4. Ce se ține minte
- Pe server, pentru fiecare utilizator, la fel pe toate graficele (monede, acțiuni, indici): lista indicatorilor, în ordinea adăugării, cu intrările, stilul, vizibilitatea și înălțimea panoului fiecăruia.
- Slingshot / LMA pe grafic sau nu: ca acum (`showSlingshot` / `showLma`), schimbate acum din listă și din legendă.
- Ce ai adăugat rămâne după reîncărcare, în alt browser și pe Azure sau pe Mac (aceeași bază).

### 5. Date în plus
- Aproape toți indicatorii folosesc doar lumânările graficului.
- **Același simbol, alt timeframe** (Pivot Points Standard, Technical Ratings, Rob Booker - Ziv Ghost Pivots, 24-hour Volume, Seasonality):
  - Sentiq descarcă de la aceeași sursă timeframe-ul cerut, dacă sursa îl are; lunarul se face din zilnic;
  - timeframe-urile mai mici decât al graficului nu se descarcă (ar fi zeci de mii de lumânări);
  - dacă vreun timeframe cerut nu se poate da, indicatorul se calculează din lumânările graficului, cum face și originalul fără datele furnizorului. Legenda arată atunci „aproximat din lumânările graficului”.
- **Alt simbol** (Correlation Coefficient, Performance):
  - perechi crypto („ETH/USDT”, „ETHUSDT”, „BINANCE:ETHUSDT”; „BTCUSD” = BTC/USDT), de la exchange-ul graficului, iar pe graficul unei acțiuni de la exchange-ul tău (sau al adminului);
  - acțiuni americane („AAPL”, „NASDAQ:AMZN”): zilnic fără cheie, intraday cu cheia ta Twelve Data;
  - altceva (forex „EURUSD”, futures „ES1!”, simboluri necunoscute): legenda arată „Sentiq nu are datele pentru: EURUSD, ES1!. Schimbă simbolurile din setări.”, iar indicatorul nu se desenează.
- Lumânările în plus se reîncarcă la 5 minute (acțiunile consumă credite Twelve Data, ca graficul).

### 6. Cazuri limită
| Situație | Comportament |
|---|---|
| Indicator de volum pe un indice (CNBC nu dă volum) | legenda: „Indicii nu au volum.”; nimic desenat |
| Prea puține lumânări pentru perioada aleasă (ex. SMA 500 pe 300 de lumânări) | linia începe de unde are date sau lipsește; legenda arată „—” |
| Calculul unui indicator aruncă o eroare (ex. „Not enough data”, un timeframe mai mic decât graficul) | legenda arată eroarea în roșu; ceilalți indicatori și graficul merg normal |
| Același indicator de două ori | două legende, numerotate dacă au aceiași parametri |
| Salvarea listei eșuează (server oprit, sesiune expirată) | lista revine la cea de pe server, cu mesajul erorii |
| Codul indicatorilor nu se încarcă (fără internet, o versiune nouă publicată între timp) | avertisment „Codul indicatorilor nu s-a putut încărca … Reîncarcă pagina.”; graficul, Slingshot și LMA merg; legendele arată indicatorii fără valori |
| O versiune viitoare a catalogului nu mai are un indicator salvat | indicatorul acela dispare din listă; ceilalți rămân |
| Intrări salvate cu valori pe care indicatorul nu le mai acceptă (ex. o opțiune redenumită upstream) | se folosește valoarea implicită a câmpului |
| Schimbi perechea sau timeframe-ul | aceiași indicatori, recalculați pe noile lumânări |
| Datele extra nu se pot descărca (sursa nu răspunde, limită Twelve Data) | aproximare din lumânările graficului (același simbol) sau mesajul de date lipsă (alt simbol); se reîncearcă la 5 minute |
| Cursor pe o lumânare fără valoare a indicatorului | „—” în legendă |
| 20 de indicatori și încerci al 21-lea | rândurile din listă dezactivate, cu explicația |
| Tabelul unui indicator în același colț cu caseta TP / SL a Slingshot | se suprapun, ca în TradingView; poziția tabelului se schimbă din intrările indicatorului |
| Multe panouri (în pagină sau în ecran complet) | înălțimile rămân în aceleași proporții (cele trase de tine); în pagină graficul crește cu 120 px pe panou, în ecran complet se micșorează proporțional |
| Ascuns cu ochiul | nu se calculează și nu se desenează; panoul lui dispare, iar legenda lui stă estompată în panoul prețului până îl arăți din nou |
| Schimbi tema | culorile indicatorilor rămân cele din TradingView (aceleași în ambele teme); fundalul și axele urmează tema |

### 7. Conflicte cu ce exista
- **FD-CHARTFAV §1 (bifa Slingshot) și FD-CHARTUX §3 (bifa LMA):** bifele dispar din bara graficului. Același lucru se face acum din lista Indicatori (adaugă) și din legendă (×). Setările salvate (`showSlingshot`, `showLma`) rămân aceleași, deci nimic nu se pierde.
- **FD-CHARTUX §2 (înălțimea panoului LMA):** rămâne ținută minte. Panourile noi au înălțimea lor, ținută minte la fel.
- **Butonul „Indicatori”** deschidea setările Slingshot / LMA. Acum deschide lista. Setările se deschid din rotița fiecărei legende.
- **Panourile „Semnale Slingshot” și „Alerte”**, scanner-ul și Azi nu se schimbă.
- **„Color Price Bars” (LMA):** rămâne. Niciun indicator standard nu recolorează lumânările (cei cu lumânări proprii, ex. Bollinger Bars, își desenează propriile lumânări peste).
- **Pozițiile și PnL-ul (FD-PNL)** rămân linii pe grafic. Legendele indicatorilor stau sus-stânga, iar caseta TP / SL a Slingshot jos-dreapta.
- **Viteza paginii:** codul indicatorilor se încarcă doar pe pagina Grafice, când e nevoie (ai indicatori sau deschizi lista). Calculul se face în browser, indicator cu indicator, ca pagina să rămână fluidă.
- **Azure / Mac:** nicio schimbare de schemă a bazei. Lista stă în setările personale, iar indicatorii se calculează în browser.

## FD-PREMIUMHIDE — Ochiul și la Slingshot și LMA (18 oct 2026)

**Cererea:** „Vreau să adaugi butonul de View, Show sau Hide și pentru indicatorii premium, pentru că acum nu îi pot ascunde temporar dacă vreau.”

**Pe scurt:** legendele Slingshot și LMA primesc butonul **ochi**, ca ceilalți indicatori. Ascuns înseamnă că rămâne pe grafic, cu setările lui, dar nu se mai desenează până îl arăți din nou. **×** îl scoate de pe grafic, ca până acum.

### 1. Ce face ochiul
- **Ordinea butoanelor:** ochi, rotiță, ×, ca la orice indicator. Ochiul deschis = desenat; ochiul tăiat = ascuns.
- **Slingshot ascuns:**
  - nu se mai desenează nimic din el: cele două medii, norul, triunghiurile, liniile Market Structure și caseta TAKE PROFIT / STOP LOSS;
  - avertismentele despre liniile Market Structure (timeframe lipsă, lumânări care nu s-au încărcat) nu se mai arată, pentru că liniile nu se desenează;
  - panourile „Semnale Slingshot” și „Alerte” de sub grafic rămân, ca atunci când e scos.
- **LMA ascuns:**
  - panoul lui dispare, cu linia, umplerea, eticheta și liniile orizontale; graficul scade cu 120 px, ca la orice panou ascuns;
  - „Color Price Bars” se oprește: lumânările revin la culorile lor;
  - înălțimea panoului rămâne ținută minte: când îl arăți, revine la fel de înalt.
- **Legenda unui premium ascuns** rămâne, estompată, în panoul prețului: numele, parametrii (fără valori) și cele trei butoane. Ordinea în panoul prețului: Slingshot, LMA ascuns, apoi ceilalți indicatori, ca în listă.
- **Rotița** merge și cu indicatorul ascuns: setările se salvează și se văd când îl arăți.
- **×** pe un indicator ascuns îl scoate de pe grafic. Când îl adaugi din nou din lista Indicatori, apare vizibil.

### 2. Ce se ține minte
- Pe server, pentru fiecare utilizator, la fel pe toate graficele: `charts.slingshotHidden` și `charts.lmaHidden`, implicit `false` (setările vechi rămân vizibile).
- Schimbarea se vede imediat și se salvează în fundal, ca celelalte bife ale graficului. Dacă salvarea eșuează, graficul revine la ce e pe server.

### 3. Cazuri limită
| Situație | Comportament |
|---|---|
| Slingshot și LMA ascunși, fără alți indicatori | panoul prețului arată doar cele două legende estompate; graficul are doar lumânările |
| Lista Indicatori cu un premium ascuns | rândul lui arată „Pe grafic, ascuns”, nu se poate adăuga a doua oară; îl arăți din ochiul legendei |
| Zoom-ul și poziția când ascunzi / arăți | nu se schimbă (doar înălțimea graficului, pentru panoul LMA) |
| Pagina reîncărcată, alt browser, Azure sau Mac | rămâne ascuns (aceeași setare pe server) |
| Server mai vechi, fără câmpurile noi | indicatorii apar vizibili, ca înainte |
| Graficul unui indice sau al unei acțiuni | la fel ca pe monede |
| Ecran complet | la fel; panourile rămase împart înălțimea |

### 4. Conflicte cu ce exista
- **FD-INDICATORS §2** („Slingshot și LMA au legendă cu rotiță și ×”): acum au ochi, rotiță și ×.
- **FD-CHARTFAV §1:** „cu Slingshot oprit nu se desenează nimic din el, panourile de sub grafic rămân” se aplică și când e ascuns.
- **Scanner-ul, Azi, alertele și semnalele:** nu se schimbă; ochiul privește doar desenul de pe grafic.
- **Azure / Mac:** nicio schimbare de schemă a bazei; două câmpuri noi în setările personale `charts`.

## FD-TRADEUNLOCK — Pornirea tranzacționării: cu passkey, mesaje clare, permisiunile citite întâi (reparație, 19 oct 2026)

**Cererea:** „Am încercat să pornesc tranzacțiile și deși am introdus toate datele corecte, adică parola corectă, codul de 2FA corect, nu mă lasă. Și mai mult de atât am lăsat blocat pentru 15 minute, că am prea multe încercări. Te rog, repare treaba asta și elimină-mi, resetează-mi cooldown-ul de 15 minute.” Apoi: „nu are doar general, am adăugat și spot și futures”, „probabil trebuie reîmprospătat accesul”.

### Ce s-a găsit (18 oct 2026, pe Azure)
- **Blocajul:** pauza de 15 minute stă în memoria serverului. A fost ștearsă prin repornirea aplicației (21:05 UTC), cum s-a cerut.
- **Verificat:**
  - cheia master de pe Azure e aceeași cu a Mac-ului, iar secretul 2FA al contului se poate citi;
  - ceasul serverului e exact.
- **Cauza:** parola sau codul au fost refuzate la fiecare încercare. Ultimul cod 2FA acceptat e din 14 oct; de atunci contul intră doar cu passkey.
- **Confuzii posibile:**
  - fereastra cerea „parola contului Sentiq”, iar contul KuCoin se numește chiar „Sentiq”: se poate înțelege parola sau passphrase-ul cheii KuCoin;
  - „Cod 2FA” se poate înțelege ca un cod KuCoin.
  - Mesajul „Parola sau codul nu sunt corecte” nu spunea care dintre ele e greșit.
- **Permisiunile cheii:** în Sentiq a rămas lista veche („General”), citită înainte să adaugi Spot și Futures. Sentiq o recitea doar după ce treceau parola și codul.

### 1. Ce se schimbă
- **Confirmare cu passkey:** dacă ai un passkey pe cont și browserul îl poate folosi, fereastra arată întâi **„Confirmă cu passkey”**. Passkey-ul dovedește ambii factori (dispozitivul și amprenta / PIN-ul), ca la login. Parola și codul rămân dedesubt, ca variantă.
- **Textele ferestrei:**
  - „**Parola ta Sentiq** (cea cu care intri în Sentiq, nu parola sau passphrase-ul {exchange})”;
  - „**Codul 2FA Sentiq** (din aplicația de autentificare, intrarea Sentiq, nu codul {exchange}), sau un cod de recuperare”.
- **Mesajele de eroare spun ce e greșit:**
  - „Parola nu e corectă: e parola cu care intri în Sentiq, nu cea a {exchange}.”;
  - „Codul 2FA nu e corect sau a fost deja folosit: e codul Sentiq din aplicația de autentificare, nu cel al {exchange}. Așteaptă codul următor.”;
  - plus încercările rămase: „Mai ai 2 încercări, apoi o pauză de 15 minute.” / „Mai ai o încercare, apoi o pauză de 15 minute.”
- **Permisiunile se recitesc întâi:** Sentiq citește cheia de la exchange înainte să verifice parola și codul. O cheie care nu poate tranzacționa (sau care poate retrage) e refuzată cu pașii platformei și nu consumă încercări. Lista nouă (ex. „General, Spot, Futures”) se salvează oricum.
- **Jurnalul serverului** notează fiecare refuz, cu factorul greșit (parola / codul / passkey-ul), fără parola sau codul.

### 2. Ce rămâne
- 3 încercări greșite (parolă sau cod), apoi 15 minute de pauză, pe același buget cu schimbarea parolei și a aplicației de autentificare. Protejează contul dacă cineva îi fură sesiunea.
- Un passkey refuzat nu consumă încercări, pentru că nu se poate ghici. Passkey-ul merge și în timpul pauzei de 15 minute, ca la login, iar o confirmare reușită golește încercările greșite.
- Oprirea tranzacționării nu cere nimic.

### 3. Cazuri limită
| Situație | Comportament |
|---|---|
| Fără passkey pe cont, sau browserul nu poate folosi passkey-uri (ex. adresa nu e HTTPS) | doar parola și codul, ca până acum, cu textele noi |
| Anulezi fereastra passkey-ului | „Operația a fost anulată sau a expirat.”; nicio încercare consumată |
| Passkey-ul altui cont sau unul șters între timp | „Passkey-ul nu este înregistrat aici.” / „Passkey-ul aparține altui cont.”; nicio încercare consumată |
| Ai așteptat peste 5 minute între „Confirmă cu passkey” și răspunsul dispozitivului | „A durat prea mult…”; încerci din nou |
| Cheia nu poate tranzacționa | refuzată înainte de factori, cu pașii platformei; nicio încercare consumată |
| Exchange-ul nu răspunde la citirea permisiunilor | rămâne lista salvată (ca până acum) și se cer factorii |
| Cheia poate tranzacționa, dar și retrage | refuzată înainte de factori; dacă tranzacționarea era pornită, se oprește |
| Codul folosit deja (ex. la login, în aceleași 30 de secunde) | mesajul despre cod: așteaptă codul următor |
| Cod de recuperare | merge ca înainte și se consumă |

### 4. Conflicte cu ce exista
- **FD-TRADING §1:** „cere parola și codul 2FA” devine „passkey-ul, sau parola și codul 2FA”. Ordinea se schimbă: întâi permisiunile cheii, apoi factorii.
- **FD-2FA:** passkey-ul era deja acceptat ca ambii factori la login. Acum e acceptat și aici.
- **Azure / Mac:** nicio schimbare de schemă a bazei.

## FD-STUDYUX — Indicatori favoriți, bara de jos a setărilor, stilul liniilor (19 oct 2026)

**Cererile:**
- „În pop-up-ul în care selectez indicatorii, adaugă în panoul din stânga o categorie de favorite, iar pe rândul fiecărui indicator o stea în dreapta, ca să pot face un indicator favorit. Astfel se grupează în noua categorie, ca să le accesez rapid pe cele care îmi plac.”
- „Când deschid setările unui indicator, panoul de la bază cu butoanele Salvează și Valorile implicite nu coboară până jos și nici până la capăt în dreapta și în stânga, încât văd conținut sub el. Să acopere toată baza, ca să nu mai văd text pe sub.”
- „La indicatorii care afișează linii de orice fel, vreau să pot stabili ce fel de linie (dotted, dashed sau solid) și grosimea. Trei grosimi: implicită, mai groasă și și mai groasă.”

### 1. Favoritele din lista Indicatori
- **Steaua** stă în dreapta fiecărui rând, inclusiv la Slingshot și LMA:
  - goală = nu e favorit; plină (galbenă) = favorit;
  - un click o schimbă și nu adaugă indicatorul pe grafic;
  - are eticheta „Adaugă la favorite” / „Scoate din favorite”.
- **Categoria „Favorite”** stă prima în panoul din stânga, cu numărul lor (ex. „Favorite 3”). Arată favoriții în ordinea în care i-ai marcat.
- **La deschidere:** lista se deschide pe „Favorite” când ai cel puțin unul, altfel pe „Premium”, ca acum.
- **Fără favoriți:** „Niciun favorit încă. Apasă steaua de lângă un indicator ca să-l adaugi aici.”
- **Căutarea** caută ca acum în toți; steaua apare și în rezultate.
- **Pe telefon:** „Favorite” e primul buton din rândul de categorii.
- **Unde se ține minte:** pe server, în setările tale, la fel pe toate graficele și în orice browser. Se salvează imediat, iar dacă salvarea eșuează, steaua revine și apare mesajul erorii.

### 2. Bara de jos din setări (Salvează / Valorile implicite)
- Bara acoperă toată lățimea panoului și coboară până la marginea lui de jos, pe fundal opac, cu linia de sus. Nimic nu se mai vede pe lângă ea sau sub ea când derulezi.
- **Se aplică la:** setările oricărui indicator, ale Slingshot și ale LMA (aceeași bară).

### 3. Stilul liniilor (tab-ul „Stil”)
- **Fiecare linie a unui indicator** (linie, linie în trepte, linie cu întreruperi, conturul unei arii) are, pe lângă bifă și culoare:
  - **Tip:** „Continuă”, „Liniuțe”, „Puncte” (solid / dashed / dotted). Implicit e tipul din TradingView al liniei;
  - **Grosime:** „Implicită”, „Groasă”, „Foarte groasă” = grosimea cu care se desenează linia fără alegere (a ei din TradingView, altfel 2 px), +1 px, +2 px.
- **Ce n-are tip de linie** (histograme, cercuri, cruci) are doar grosimea. **Coloanele, semnele și etichetele** n-au niciuna (înainte, semnele aveau o grosime care nu schimba nimic).
- **Liniile orizontale** (ex. 70 / 30 la RSI) au și ele tip și grosime.
- **„Valorile implicite”** pune înapoi și tipul, și grosimea.
- Setările vechi cu o grosime aleasă în pixeli (1–4 px) rămân: lista arată grosimea salvată („3 px”) până alegi alta.
- **Slingshot și LMA:** formularele lor rămân cum sunt (LMA are deja stilul liniilor orizontale).

### 4. Cazuri limită
| Situație | Comportament |
|---|---|
| Un favorit dispare dintr-o versiune viitoare a catalogului | iese din favorite; ceilalți rămân |
| Favorit care e și pe grafic | rândul arată steaua plină și, la Premium, „Pe grafic” |
| Click pe stea cât rândul arată „Adăugat” | doar steaua se schimbă |
| Prea mulți favoriți | nu există o limită practică (toți cei 120 pot fi favoriți) |
| Panoul setărilor e scurt (fără derulare) | bara stă jos, ca acum |
| O linie ascunsă din bifă | tipul și grosimea ei rămân alese |
| Grosimea implicită a unei linii e deja 4 px | „Groasă” = 5 px, „Foarte groasă” = 6 px |

### 5. Conflicte cu ce exista
- **FD-INDICATORS §1 (fereastra):** se adaugă categoria „Favorite” și steaua. Rândul nu mai e un singur buton: rândul adaugă, steaua marchează.
- **FD-INDICATORS §3 („Stil”):** grosimea 1–4 px devine Implicită / Groasă / Foarte groasă, iar tipul liniei e nou.
- **Azure / Mac:** nicio schimbare de schemă a bazei; o setare personală nouă (`studyFavorites`).

## FD-STUDYMEMORY — Fiecare indicator își ține minte ultimele setări (19 oct 2026)

**Cererea:** „Toate indicatoarele trebuie să rețină ultimele setări făcute de utilizator. Dacă eu șterg un indicator și îl readaug, vreau să fie adăugat cu setările pe care le aveam înainte de ștergere.”

### 1. Ce se ține minte
- **Pentru fiecare indicator** (RSI, EMA, MACD…), ultimele lui setări:
  - **Intrări** (perioade, surse, opțiuni);
  - **Stil** (vizibilitatea, culoarea, tipul și grosimea fiecărei linii; liniile orizontale);
  - **înălțimea panoului** lui, dacă are panou propriu.
- **Când se actualizează:**
  - la **„Salvează”** în setările lui;
  - când îl **scoți** de pe grafic (×): se ține minte exact cum era, inclusiv înălțimea trasă cu mouse-ul.
- **La adăugare** (din lista Indicatori, inclusiv din Favorite), indicatorul vine cu aceste setări. Fără setări ținute minte, vine cu valorile TradingView, ca până acum.
- **Vizibilitatea nu se ține minte:** un indicator adăugat apare mereu vizibil.
- **Slingshot și LMA** își păstrau deja setările (formularele lor sunt separate de prezența pe grafic). Acum revin și vizibili.

### 2. Același indicator de mai multe ori
- Memoria e una pe indicator, nu pe copie. EMA adăugat a doua oară vine cu ultimele setări salvate sau scoase ale oricărui EMA. Exemplu: ai EMA 20 și EMA 50, salvezi EMA 50, apoi adaugi încă un EMA: vine ca EMA 50.
- Le schimbi apoi din rotiță; legenda numerotează copiile cu aceiași parametri („#2”), ca acum.

### 3. Înapoi la valorile TradingView
- „Valorile implicite” + „Salvează”, în setările indicatorului: memoria devine valorile TradingView.

### 4. Unde se ține minte
- Pe server, în setările tale, la fel pe toate graficele și în orice browser.
- Se salvează în aceeași cerere cu lista de pe grafic: nu poate exista o listă salvată fără memoria ei.

### 5. Cazuri limită
| Situație | Comportament |
|---|---|
| Scoți și adaugi imediat (înainte să răspundă serverul) | vine cu setările de dinainte (memoria e actualizată pe loc, ca lista) |
| Salvarea eșuează | lista și memoria revin împreună la cele de pe server, cu mesajul erorii |
| O intrare ținută minte nu mai e acceptată de indicator (o versiune nouă a catalogului) | se folosește valoarea TradingView a câmpului, ca la indicatorii de pe grafic |
| Un indicator scos din catalog într-o versiune viitoare | memoria lui dispare; a celorlalți rămâne |
| Ai 20 de indicatori | lista nu primește al 21-lea, ca acum; memoria nu se schimbă |
| Ascunzi un indicator cu ochiul, apoi îl scoți | memoria ține setările lui; adăugat din nou, apare vizibil |
| Schimbi doar înălțimea panoului, fără să-l scoți | memoria se actualizează abia la „Salvează” sau la scoatere; o copie nouă adăugată între timp vine cu înălțimea ținută minte înainte |

### 6. Conflicte cu ce exista
- **FD-INDICATORS §1:** „un click adaugă indicatorul” cu valorile TradingView devine „cu ultimele tale setări, altfel cu valorile TradingView”.
- **Azure / Mac:** nicio schimbare de schemă a bazei; o setare personală nouă (`studyMemory`).

## FD-GOLATEST — Butonul „la ultima lumânare” (19 oct 2026)

**Cererea:** „Pe chart să pui în colțul dreapta jos un icon cu fundal și hover, cu două >>, care să mă ducă la lumânarea curentă dacă ea nu mai este în view (am derulat înapoi), ca să nu derulez manual până ajung în prezent. La fel cum are TradingView.”

### 1. Comportament
- **Când apare:** doar cât ultima lumânare e în dreapta zonei vizibile (ai derulat în istoric). Când ultima lumânare se vede, chiar și la margine, butonul dispare.
- **Unde:** colțul din dreapta jos al graficului, deasupra axei timpului și la stânga axei prețului, în ultimul panou (sub LMA sau sub ultimul indicator cu panou propriu, dacă există).
- **Cum arată:**
  - pătrat de 32 px, colțuri rotunjite, fundalul și marginea plăcilor, cu umbră;
  - iconul „»” (două săgeți);
  - la hover: fundal mai deschis, iconul și marginea în culoarea de accent;
  - eticheta și tooltip-ul „Mergi la ultima lumânare”.
- **Click:** graficul revine la ultima lumânare, cu spațiul obișnuit din dreapta (24 de bare). Zoom-ul (lățimea lumânărilor) rămâne cel ales.
- **Tastatura:** butonul se poate focaliza cu Tab și se apasă cu Enter / Space.

### 2. Cazuri limită
| Situație | Comportament |
|---|---|
| Caseta TAKE PROFIT / STOP LOSS a Slingshot e în același colț (fără panouri dedesubt) | caseta urcă cu înălțimea butonului cât timp el se vede, apoi revine |
| Sosesc lumânări noi cât ești derulat înapoi | vederea nu se mută, iar butonul rămâne |
| Schimbi perechea sau timeframe-ul | apare doar dacă vederea ținută minte a noii perechi lasă ultima lumânare în afară |
| Ecran complet, telefon | la fel |
| Toate lumânările încap pe ecran | butonul nu apare |

## FD-RODESC — Descrierile indicatorilor în română (19 oct 2026)

**Cererea:** „Explicațiile / subtitlurile fiecărui indicator să fie în română. Tot site-ul e în română.”

- Descrierile celor 118 indicatori din lista Indicatori (rândul de sub nume și tooltip-ul) sunt traduse în română.
- **Ce rămâne în engleză:**
  - **numele** (ex. „Relative Strength Index (RSI)”) și prescurtările, ca în TradingView, unde le găsești și în tutoriale;
  - câmpurile din setări, ca în TradingView (FD-INDICATORS §3).
- Un test verifică faptul că nicio descriere nu a rămas în engleză.

## FD-HLINELEVELS — Nivelurile liniilor orizontale (19 oct 2026)

**Cererea:** „Stochastic RSI trebuie să permită stabilirea limitelor de sus, mijloc și jos.”

- **În tab-ul „Stil”**, fiecare linie orizontală a unui indicator are, pe lângă bifă, culoare, tip și grosime, un câmp **„nivel”**, ca în TradingView. Exemple:
  - Stochastic RSI: Upper Band 80, Middle Band 50, Lower Band 20;
  - RSI: 70 / 50 / 30;
  - CCI: 100 / 0 / −100.
- Se aplică **tuturor indicatorilor cu linii orizontale** (42).
- **Umplerea** dintre două linii orizontale (ex. fundalul dintre 80 și 20 la Stochastic RSI) urmează nivelurile noi.
- **Validare:** un nivel gol sau care nu e număr e refuzat la „Salvează”, cu numele liniei, iar tab-ul „Stil” rămâne deschis.
- **„Valorile implicite”** pune înapoi și nivelurile TradingView.
- **Memoria setărilor** (FD-STUDYMEMORY) ține minte și nivelurile.

### Cazuri limită
| Situație | Comportament |
|---|---|
| Nivelul de sus pus sub cel de jos | se desenează așa; umplerea rămâne între ele |
| Nivel în afara valorilor indicatorului (ex. 150 la RSI) | se desenează; axa panoului se lărgește ca să-l cuprindă |
| Indicator ale cărui linii orizontale vin din calcul (nu din configurație) | nu apar în „Stil”, ca acum |

## FD-TICKETMEMORY — Formularul de ordin își ține minte setările (19 oct 2026)

**Cererea:** „Ordinele de tranzacție trebuie să țină minte setările pe care le fac, chiar dacă nu inițiez tranzacția. Eu repet același tip de ordin și vreau să fie preselectate opțiunile când fac un ordin nou și să mă joc doar cu cantitatea. Așa că orice setare din ecranul de ordin (mai puțin simbolul, care poate oscila, și valoarea) trebuie să persiste de la ordin la ordin.”

### 1. Ce se ține minte
- **Pentru fiecare cont**, ultima alegere din formular:
  - piața (Spot / Futures);
  - direcția (Cumpără / Vinde, Long / Short);
  - tipul ordinului (la piață, limită, stop…);
  - cantitatea în activ sau în monedă / valoare;
  - levierul și marja (Cross / Isolated);
  - valabilitatea (până la anulare / până la sfârșitul zilei);
  - „Reduce-only”;
  - „Și în afara orelor de tranzacționare”.
- **Contul ales sau folosit ultima dată** (ales în formular sau cel pe care ai verificat un ordin), separat pentru monede și pentru acțiuni: butonul „Tranzacționează” de pe grafic deschide formularul pe el.
- **Când se salvează:** imediat ce schimbi o setare, chiar dacă închizi formularul fără să trimiți ordinul.
- **Unde:** pe server, în setările tale, la fel în orice browser.

### 2. Ce nu se ține minte
- **Simbolul:** vine de unde deschizi formularul (graficul, deținerea) sau îl scrii.
- **Cantitatea:** „valoarea” de la un ordin la altul.
- **Prețurile:** limită, declanșare, take profit, stop loss. Țin de simbol, iar prețul altui instrument ar fi greșit sau periculos (un stop loss BTC pe ETH).

### 3. Ce are prioritate
- **Ce vine de unde deschizi formularul** câștigă: contul paginii Tranzacții, piața și direcția de la „Vinde”, prețul de pe grafic.
- **Închiderea unei poziții** („Închide”, „Vinde” la eToro): formularul are setările poziției și nu folosește memoria. Nici nu o schimbă, ca un ordin nou să nu pornească drept închidere.
- **O setare ținută minte pe care contul nu o mai permite** (ex. tipul „stop” pe o piață care nu îl are) se înlocuiește cu prima permisă, ca acum.
- **Schimbi contul în formular:** formularul ia setările ținute minte ale acelui cont.

### 4. Cazuri limită
| Situație | Comportament |
|---|---|
| Prima dată pe un cont | valorile de acum (Spot, Cumpără, la piață, levier 1, Isolated) |
| Contul ținut minte a fost șters sau și-a oprit tranzacționarea | primul cont eligibil, ca acum |
| „Reduce-only” bifat la ultimul ordin | rămâne bifat (se vede în formular și în confirmare: „Reduce-only: da”) |
| Levierul scris nu e un număr întreg între 1 și 125 | nu se ține minte; rămâne cel de dinainte |
| Salvarea nu reușește (fără conexiune) | formularul merge normal; memoria rămâne cea de dinainte |
| Butoanele 25 % / 50 % / 100 % | schimbă cantitatea (și, la nevoie, unitatea ei) doar pentru ordinul acesta |

### 5. Conflicte cu ce exista
- **FD-TRADING §2:** formularul pornea mereu de la aceleași valori; acum pornește de la ultimele alegeri ale contului.
- **Azure / Mac:** nicio schimbare de schemă a bazei; o setare personală nouă (`orderTicket`).

## FD-KEYTEXT — Textele conectorilor, după tranzacționare (19 oct 2026)

**Cererea:** „Corectează textul din conectorii de brokeri și exchange-uri. Acolo spune să nu dau drepturi de write la cheie, dar nu mai este adevărat, pentru că am adăugat tranzacționare și pentru asta trebuie write.”

- **Wizard-ul de conectare** („Cum creezi cheia”, fost „Cum creezi o cheie doar pentru citire”). Pașii fiecărei platforme spun:
  - permisiunea de **citire**;
  - **ca să tranzacționezi din Sentiq**, permisiunea de tranzacționare a platformei (ex. KuCoin „Spot” / „Futures”, OKX „Trade”, eToro „Write”, Trading 212 „Orders: Execute”);
  - **niciodată** retrageri sau transferuri.
  - Dispar interdicțiile vechi („Nu bifa Trade”, „Nu alege Write”, „Lasă oprită execuția de ordine”).
  - Secțiunea pliabilă rămâne, ca „Detalii pentru tranzacționarea din Sentiq” (restricția IP la Binance, modurile de cont la Bybit / OKX, cheia nouă la eToro / Trading 212).
- **Pagina Tranzacții** (fără conturi), **Setări → Conturi** și avertismentul pentru o cheie cu mai multe permisiuni spun același lucru: citire, plus tranzacționare dacă vrei; dacă nu tranzacționezi, ajunge citirea.
- **Ghidul:** tabelul furnizorilor are o coloană nouă, cu permisiunea de tranzacționare a fiecăruia.
- **Ce nu se schimbă:**
  - Sentiq citește implicit;
  - tranzacționarea se pornește pe cont (FD-TRADING §1, FD-TRADEUNLOCK);
  - cheile care pot retrage sau transfera sunt refuzate.
- **Interactive Brokers:** rămâne doar citire, prin raportul Flex.
- **Conflict:** FD-TRADING §1 păstra pașii „doar citire” separat de cei de tranzacționare; acum pașii principali le cuprind pe amândouă.

## FD-KEYIPS — Cheile, limitate la IP-urile serverului Sentiq (19 oct 2026)

**Cererea:** „Când dai sfaturi în aplicație despre API keys, adaugă și informația legată de lista de IP-uri. Învață utilizatorii să limiteze API keys la acces doar de la aceste IP-uri: 68.210.130.64, 68.210.130.28, 68.210.129.102, 68.210.131.71, 68.210.130.70, 68.210.130.73, 68.210.131.64, 68.210.130.36, 68.210.130.38, 68.210.131.80, 68.210.131.82, 68.210.130.44, 68.210.171.1.”

- **Verificat (19 oct 2026):** lista e exact `outboundIpAddresses` a aplicației `sentiq` din Azure. Adresele de pe care serverul de pe sentiq.money cheamă exchange-urile și brokerii.
- **În wizard-ul de conectare**, la platformele care permit limitarea pe IP (KuCoin, Binance, Bybit, OKX, Kraken, Coinbase, Bitget, Trading 212, eToro):
  - o casetă „Restricționează cheia la IP-urile serverului Sentiq”, cu explicația: cererile pleacă de pe server, nu de pe calculatorul tău; o cheie limitată nu poate fi folosită de altcineva, chiar dacă ajunge la el;
  - lista și butonul **„Copiază lista”** (adresele separate prin virgulă, cum le cer paginile de chei). Fără clipboard (o pagină http din rețeaua locală), lista se selectează, cu indicația Cmd / Ctrl + C;
  - pașii fiecărei platforme spun unde se pune lista.
  - Dispar pașii greșiți „restricționează cheia la IP-ul tău”: cu IP-ul utilizatorului, Sentiq ar fi fost refuzat.
- **Pe Sentiq de pe Mac** (orice adresă în afară de sentiq.money): caseta adaugă că cererile pleacă de pe conexiunea ta, deci o cheie limitată la aceste adrese merge doar din sentiq.money.
- **Setări → Conturi, pagina Tranzacții fără conturi și ghidul** amintesc limitarea și unde e lista.
- **Alpaca și Interactive Brokers** nu au casetă: limitarea pe IP nu e un pas al cheilor lor.
- **Dacă Azure schimbă adresele** (doar la mutarea planului pe alt nivel), lista din `shared/server-ips.ts` se actualizează, iar cheile limitate trebuie actualizate și ele.

## FD-ETOROUNITS — Unitățile la închiderea mai multor poziții eToro (19 oct 2026)

**Cererea:** „Cu eToro conectat, dacă vreau să vând o poziție, câmpul de unități este blocat, nu poate fi completat numarul de unități.”

- **Cauza:** o deținere eToro e făcută din mai multe poziții. Închiderea parțială mergea doar pe o singură poziție, de aceea câmpul era blocat când erau mai multe.
- **Acum:** câmpul „Unități de închis” e mereu deschis.
  - Gol: se închid toate pozițiile, ca înainte.
  - Cu un număr: Sentiq închide **poziții întregi, în ordinea în care le dă eToro, apoi o parte din următoarea**. Exemplu: poziții de 2 și 3 unități, 3 unități de închis → prima întreagă și 1 unitate din a doua.
- **Confirmarea** spune ce se întâmplă: „Se închid complet 1 poziție și parțial poziția 112 (1 unitate).”
- **La trimitere**, împărțirea se face pe pozițiile din acel moment. O poziție închisă între timp e sărită; dacă nu mai e niciuna deschisă: „Pozițiile nu mai sunt deschise.”
- **Mai multe unități decât au pozițiile:** refuzat la verificare, cu totalul („Pozițiile au 5 unități; închizi 6.”).
- **Fiecare poziție** are cererea ei, iar o poziție care nu se închide nu le ascunde pe cele închise (ca înainte, FD-TRADING).

## FD-ETOROPICK — Alegi pozițiile eToro pe care le închizi (19 oct 2026)

**Cererea:** „Dacă sunt mai multe poziții, de ce nu mi le arăți pe toate când vreau să le lichidez și să selectez eu. Motivul e că unele sunt profitabile și altele nu. Vreau să le vând doar pe cele profitabile.”

### 1. Ce se vede
- **Unde:** în formularul „Vinde” al unei dețineri eToro făcute din mai multe poziții. Pozițiile cu levier sau short sunt deja fiecare pe rândul lor, cu „Închide” propriu.
- **Fiecare poziție** are un rând:
  - **bifă**;
  - data deschiderii;
  - unitățile;
  - prețul de intrare;
  - **profitul / pierderea nerealizat(ă)**, în USD și în procente din suma investită, verde sau roșu, cum le dă eToro.
- **Ordinea:** de la cea mai veche la cea mai nouă (fără dată, în ordinea eToro).
- **Butoane:** „Toate”, „Doar profitabile” (profit peste 0), „Niciuna”. La deschidere sunt bifate toate, ca înainte.
- **Sub listă:** „Alese: 2 din 4 poziții · 5 unități · +123,45 USD”.

### 2. Ce se închide
- **Doar pozițiile bifate.**
- **Câmpul „Unități de închis”** se aplică lor:
  - gol: le închide pe toate cele bifate;
  - un număr: poziții bifate întregi, în ordinea din listă, apoi o parte din următoarea (FD-ETOROUNITS).
- **Nicio poziție bifată:** „Verifică ordinul” e dezactivat, cu „Alege cel puțin o poziție.”
- **Confirmarea** arată unitățile alese și, la închiderea parțială a mai multor poziții, împărțirea.

### 3. Cazuri limită
| Situație | Comportament |
|---|---|
| Lista nu s-a putut citi (eToro nu răspunde) | formularul de până acum: toate pozițiile, cu câmpul de unități |
| O poziție s-a închis între timp (pe eToro) | „Poziția X nu mai e deschisă.” la verificare; lista se reîncarcă la redeschidere |
| Profitul nu e dat de eToro pentru o poziție | „—”; „Doar profitabile” nu o bifează |
| O singură poziție | fără listă, ca acum |
| Poziții copiate (CopyTrader) | nu fac parte din deținere, deci nici din listă |

### 4. Conflicte cu ce exista
- **FD-TRADING §4 („Vinde” la eToro închide pozițiile deținerii) și FD-ETOROUNITS:** acum închide pozițiile alese, iar unitățile se împart pe ele.

## FD-ETOROROWS — Pozițiile eToro ca rânduri, fiecare cu „Vinde” (19 oct 2026)

**Cererea:** „Nu îmi place. Pozițiile trebuie listate ca rând cu buton de vinde pentru fiecare, coloane pe rând cu datele existente. Popup-ul un pic mai wide ca să încapă tabelul cu pozițiile și coloane cu buton. Dacă nu pot modifica ceva, precum contul, simbolul, nu le afișa ca text field ci ca text.”

Înlocuiește interfața din FD-ETOROPICK (bife, „Toate / Doar profitabile / Niciuna”, sumarul).

### 1. Tabelul pozițiilor
- **Unde:** în formularul „Vinde” al unei dețineri eToro și „Închide” al unei poziții eToro, oricâte poziții ar fi (și una).
- **Un rând pe poziție**, de la cea mai veche:

| Deschisă | Unități | Preț intrare | Investit | Profit / pierdere | De vândut | |
|---|---|---|---|---|---|---|
| 20 nov. 2025 | 1,5 | 150 | 225,00 USD | +75,00 USD (+33,33%), verde | câmp gol (= toate) | **Vinde** |

- **„De vândut”** e opțional: gol = toată poziția; un număr = doar atâtea unități din ea. Un număr care nu e pozitiv sau trece de unitățile poziției se marchează cu roșu, iar „Vinde” e dezactivat.
- **„Vinde”** pe un rând verifică închiderea **doar a acelei poziții**: confirmarea, apoi „Confirmă și trimite”.
- **După rezultat:** „Înapoi la poziții” reîncarcă lista (poziția vândută dispare) ca să vinzi și alta; „Închide” închide fereastra.
- Fereastra e mai lată (900 px), ca tabelul să încapă. Pe telefon, tabelul se derulează lateral.

### 2. Câmpurile care nu se pot schimba apar ca text
- **Într-un formular de închidere** (eToro, poziție futures, vânzarea unei dețineri): contul, simbolul, piața și direcția sunt text („Cont: eToro”, „Simbol: AAPL · Apple”), nu câmpuri dezactivate.
- **Contul** e text și când e un singur cont eligibil.
- Câmpurile care se pot schimba rămân ca acum.

### 3. Confirmarea
- **Rândurile ei:** „Poziție: 20 nov. 2025 (1,5 unități @ 150)” și profitul / pierderea ei (la vânzarea întreagă).
- La vânzarea parțială: unitățile alese.

### 4. Cazuri limită
| Situație | Comportament |
|---|---|
| Lista nu s-a putut citi | formularul de până acum: câmpul de unități pentru toate pozițiile și „Verifică ordinul” |
| O poziție s-a închis între timp | „Poziția X nu mai e deschisă.” la verificare |
| „Vinde” de două ori pe același rând (aceleași unități) | aceeași cerere (aceeași cheie): eToro o primește o singură dată |
| Profit necunoscut | „—” |

### 5. Conflicte cu ce exista
- **FD-ETOROPICK:** bifele, butoanele de grup și sumarul dispar.
- **FD-ETOROUNITS:** împărțirea pe mai multe poziții rămâne pe server (pentru formularul de rezervă), dar tabelul vinde poziție cu poziție.

## FD-INDEXNEWS — Știrile și scorul acțiunilor, doar pentru companiile din indicii aleși (19 oct 2026)

**Cererea:** „Verifică dacă avem acces la indici precum QQQ. Vreau o setare care să filtreze știrile despre acțiuni la doar companiile care participă la un index sau mai multi, în funcție de câți selectez. Dacă cineva investește doar în QQQ va dori știri doar din zona aia și își dorește ca scorul să fie calculat pe baza știrilor despre companiile din QQQ; dacă bifează mai mulți indici, atunci de la toate companiile din indicii bifați. Deci trebuie opțiune care bifează acțiuni generale sau indici, pentru calculul scorului și filtrarea știrilor. Dacă nu avem date despre indici, caută informații pe net și generează-i tu, fără valoare, dar măcar cu lista de companii.”

**Decizii (AskUserQuestion, 19 oct 2026):**
- Se filtrează **doar partea de acțiuni** a scorului; crypto, macro și geopolitica rămân ca acum.
- Știrile generale de bursă (fără o companie anume) **rămân toate**.
- Știrile despre acțiunile din **favorite rămân**, chiar dacă nu sunt în indicii aleși.

### Cercetare (19 oct 2026): ce date avem
- **Sentiq are deja cotațiile a 7 indici** (S&P 500, Nasdaq-100, Nasdaq Composite, Dow Jones, Russell 2000, VIX, PHLX Semiconductor), de la CNBC, dar **nu și componența lor**. Twelve Data o are doar pe planurile plătite, iar CNBC nu o dă.
- **Componența, din surse publice:**

| Indice (ETF) | Sursă | Companii |
|---|---|---|
| **Nasdaq-100** (QQQ) | API-ul Nasdaq (`api.nasdaq.com/api/quote/list-type/nasdaq100`), actualizat zilnic | 101 simboluri (Alphabet are două clase) |
| **S&P 500** (SPY, VOO) | Wikipedia, „List of S&P 500 companies” (tabelul `constituents`, ținut la zi de editori) | 502 simboluri (19 oct 2026; câteva companii au două clase) |
| **Dow Jones Industrial Average** (DIA) | Wikipedia, „List of Dow Jones Industrial Average companies” | 30 |

- **Fără sursă publică accesibilă:**
  - Russell 2000 (2.000 de companii; lista iShares cere un browser cu consimțământ);
  - PHLX Semiconductor (Wikipedia nu are lista; pagina Nasdaq nu răspunde la cereri automate);
  - Nasdaq Composite (practic toate cele ~3.000 de acțiuni de pe Nasdaq).
  - Rămân fără filtru și se pot adăuga când apare o sursă.
- **Toate acțiunile listate în SUA (7.002):** screener-ul Nasdaq. Folosit ca să se recunoască o companie din afara indicilor când o știre o numește explicit („(NASDAQ: XYZ)”, „$XYZ”).
- **Fără valori:** indicii aceștia au deja cotații în Sentiq. Listele sunt doar de companii.

### 1. Setarea (Setări → Ale mele → „Știrile despre acțiuni”)
- **„Toate acțiunile”** (implicit, ca până acum) sau **„Doar companiile din indicii aleși”**, cu bife:
  - **S&P 500** — SPY, VOO · 502 companii;
  - **Nasdaq-100** — QQQ · 101;
  - **Dow Jones** — DIA · 30.
- Cel puțin un indice trebuie bifat ca să alegi a doua variantă. Mai mulți bifați = companiile din toți.
- **Sub bife:**
  - ce rămâne: știrile generale de bursă, acțiunile din favorite, crypto, macro și geopolitica;
  - data listelor („Listele de companii: 19 oct. 2026, actualizate săptămânal”).
- **Se salvează pe server, per utilizator.** Scorul se recalculează în câteva minute (vezi §3).

### 2. Ce știri despre acțiuni rămân (pagina Știri, Azi, Rezumatul zilei)
- **O știre din categoria Acțiuni rămâne dacă:**
  - nu numește nicio companie (știre generală de bursă), **sau**
  - numește o companie dintr-un indice ales, **sau**
  - numește indicele ales (ex. „Nasdaq-100”, „QQQ”, „S&P 500”), **sau**
  - numește o acțiune din favoritele tale.
- **Iese** o știre care numește doar companii din afara acestora (ex. JPMorgan, care e în S&P 500, dar nu în Nasdaq-100, pentru cine a ales doar Nasdaq-100).
- **Știrile din celelalte categorii** (crypto, macro, geopolitică) nu se schimbă.
- **Pagina Știri** arată, deasupra listei, „Acțiuni: doar companiile din Nasdaq-100 (Setări)”.

### 3. Scorul
- **Partea de acțiuni a scorului** (și deci scorul total) se calculează doar din știrile despre acțiuni rămase după §2. Restul categoriilor rămân la fel.
- **Cine are filtrul primește un scor al lui** (zilnic și istoric), ca utilizatorii cu AI propriu. Cine are și AI propriu: scorurile AI-ului lui, plus filtrul.
- **La schimbarea filtrului:** zilele pentru care Sentiq mai are știrile (păstrarea știrilor, implicit 90 de zile) se recalculează cu filtrul nou. Zilele mai vechi rămân cum erau.
- Scorul comun (al celor fără filtru și fără AI propriu) nu se schimbă.

### 4. Cum se recunosc companiile în știri
- **Fiecare companie din cei trei indici** se recunoaște după:
  - numele ei („Apple”, „Nvidia”, „Alphabet” / „Google”, „JPMorgan”), scris cu majusculă (nu „apple pie”);
  - „$AAPL”, „(NASDAQ: AAPL)”;
  - tickerul scris singur (de cel puțin 3 litere, „NVDA”).
- **Numele care sunt cuvinte obișnuite** („Target”, „Visa”, „Carrier”, „Pool”, „Southern”, „Progressive”) nu se recunosc singure, ca să nu prindă „visa rules” sau „southern states”. Se recunosc după numele complet („Target Corporation”), „$TGT”, „(NYSE: TGT)”.
- **Tickerele care sunt și acronime obișnuite** (ex. „USB”, „PSA”, „REG”) nu se recunosc singure.
- **Orice altă acțiune listată în SUA** se recunoaște doar explicit, după „$XYZ” sau „(NASDAQ: XYZ)” / „(NYSE: XYZ)”.
- **Etichetele companiilor recunoscute** apar pe știri ca acum (ex. „AAPL”), iar marcajele interne de apartenență la indici nu se văd.

### 5. Listele se țin la zi
- **Săptămânal** (și la pornire, dacă au peste 7 zile), Sentiq recitește cele trei liste și lista acțiunilor listate.
- **O listă care pare greșită** se ignoră și rămâne cea de dinainte:
  - Nasdaq-100: 95–110 simboluri;
  - S&P 500: 490–515;
  - Dow: exact 30;
  - acțiuni listate: peste 5.000.
- **Fără nicio citire reușită**, rămân listele incluse în aplicație (din 19 oct 2026).
- **O companie nou intrată** se recunoaște după ticker; după nume doar dacă numele are cel puțin două cuvinte sau nu e un cuvânt obișnuit.
- **Când listele se schimbă**, știrile din perioada păstrată se etichetează din nou, în fundal.

### 6. Cazuri limită
| Situație | Comportament |
|---|---|
| O știre numește și o companie din indice, și una din afară | rămâne |
| O companie a ieșit din indice | știrile noi despre ea ies; cele de dinainte de schimbare rămân etichetate cu apartenența de atunci |
| Alphabet (GOOGL, GOOG) | ambele clase, același nume |
| Berkshire Hathaway (BRK.B) | „Berkshire”, „$BRK.B”, „(NYSE: BRK.B)” |
| O companie numită doar printr-un cuvânt obișnuit („Target cuts forecast”) | nu se recunoaște: rămâne ca știre generală |
| „Dow” singur | e indicele Dow Jones, nu Dow Inc. (care se recunoaște ca „Dow Inc.”) |
| Utilizator fără favorite și fără filtru | totul ca acum |
| Adaugi sau scoți o acțiune din favorite, cu filtrul pornit | pagina Știri și ziua de azi o urmează imediat; zilele deja încheiate ale scorului rămân cum au fost calculate |
| Cititul listelor eșuează pe Azure (sursa blochează serverul) | rămân ultimele liste reușite sau cele incluse; „Stare sistem” arată eroarea job-ului `index.members`, iar data listelor apare în Setări |

### 7. Conflicte cu ce exista
- **FD-AIKEYS (scorul propriu):** scorul per utilizator, până acum doar pentru AI propriu, e folosit și pentru filtru.
- **FD-INDICES:** aliasurile indicilor S&P 500, Nasdaq-100 și Dow sunt acum folosite la etichetare pentru toți, nu doar pentru cine îi are în favorite. Rezultatul: mai multe știri etichetate cu indicele. Favoritele se filtrează ca înainte, după favoritele fiecăruia.
- **Azure / Mac:**
  - nicio schimbare de schemă a bazei;
  - listele se țin în datele job-urilor;
  - marcajele de apartenență sunt etichete speciale ale știrilor (`#CO`, `#SPX`, `#NDX`, `#DJI`), ascunse în aplicație.

## FD-BROKERSTATS — Tranzacțiile închise și la brokeri: eToro, Trading 212, Interactive Brokers, Alpaca (19 oct 2026)

Cererea utilizatorului:
- „pentru kucoin am și selectorul de Tranzacții închise în Azi 7z 30z 90z. pentru etoro de ce nu am?”
- „adaugi pentru toate tipurile de cont. citești documentația și implementezi. unde nu poți citi dă-mi linkul și îți dau eu textul”

Răspunsul la întrebare: FD-TRADESTATS a cerut cardurile doar pentru conturile crypto (pozițiile futures închise). La brokeri pagina a rămas cum era.

### 1. Ce se schimbă
- Selectorul **„Tranzacții închise în Azi · 7z · 30z · 90z”** apare la orice cont, crypto sau broker. Alegerea e una singură, ținută în browser, ca până acum.
- Cardurile unui cont de broker, în ordine:

| # | Card | Ce arată |
|---|---|---|
| 1 | **Valoare dețineri** | ca până acum |
| 2 | **Numerar disponibil** | ca până acum (doar dacă brokerul îl dă) |
| 3 | **PnL nerealizat (poziții)** | ca până acum (doar cu poziții cu levier sau short) |
| 4 | **Tranzacții profitabile** | tranzacțiile închise în perioadă cu rezultat > 0 |
| 5 | **Tranzacții cu pierdere** | tranzacțiile închise în perioadă cu rezultat < 0 |
| 6 | **Rata de succes** | profitabile ÷ (profitabile + cu pierdere) × 100, cu o zecimală |
| 7 | **Câștig net** | suma rezultatelor, **în moneda contului** (ex. EUR la un cont Trading 212 în euro), verde peste 0, roșu sub 0 |

- Regulile de numărare sunt cele din FD-TRADESTATS: zero exact nu e nici câștig, nici pierdere; „Azi” începe la 00:00 în fusul tău orar.
- La trecerea cursorului, fiecare card spune ce numără la brokerul respectiv (§2).

### 2. Ce e o „tranzacție închisă” la fiecare broker (din documentația lor)
| Broker | O tranzacție | Rezultatul ei | De unde |
|---|---|---|---|
| **eToro** | o poziție închisă; o închidere parțială e o tranzacție separată | profitul net dat de eToro (`netProfit`), în USD | istoricul tranzacțiilor (`/api/v1/trading/info/trade/history`, la Demo `…/trade/demo/history`) |
| **Trading 212** | un ordin de vânzare executat (oricâte bucăți ar avea) | profitul realizat dat de Trading 212 (`realisedProfitLoss`), în moneda contului | istoricul ordinelor (`/api/v0/equity/history/orders`) |
| **Interactive Brokers** | un ordin care închide sau reduce o poziție: acțiuni, ETF-uri, opțiuni, futures. Schimburile valutare nu intră | „Realized P/L” (FIFO) dat de IBKR (cu comisioane), în moneda de bază a contului | raportul Flex, cerut pentru ultimele 90 de zile |
| **Alpaca** | un ordin care închide sau reduce o poziție | **calculat de Sentiq**: Alpaca nu dă rezultatul realizat. Prețul vânzării minus costul cumpărărilor, după regula FIFO (primele cumpărate sunt primele vândute) | execuțiile contului (`/v2/account/activities/FILL`) |

### 3. Cazuri limită
| Situație | Comportament |
|---|---|
| Nicio tranzacție închisă în perioadă | 0 și 0; rata de succes „—”; câștig net 0 (în moneda contului) |
| Rezultat exact zero | nu intră la profitabile sau la pierdere; intră în câștigul net, cu 0 |
| Un ordin executat în mai multe bucăți (Trading 212, IBKR, Alpaca) | o singură tranzacție, cu suma bucăților |
| Un ordin care închide o poziție și deschide una în sens invers (IBKR „C;O”, Alpaca) | contează partea care închide |
| **IBKR, „Azi”** | raportul Flex are doar zilele încheiate. Cardurile 4–7 arată „—”, iar la trecerea cursorului: „Interactive Brokers trimite tranzacțiile unei zile după închiderea ei. Alege 7z, 30z sau 90z.” |
| IBKR, 7z / 30z / 90z | tranzacțiile până la închiderea ultimei zile lucrătoare; cursorul arată data |
| IBKR, rapoartele pe perioadă | ținute 15 minute, apoi șterse din memorie (perioada se mută în fiecare zi) |
| IBKR, Flex Query-ul fără secțiunea Trades sau fără câmpul „Realized P/L” | cardurile arată „—”; sub ele, ce trebuie bifat în Flex Query |
| IBKR, raportul pentru zilele cerute nu e gata încă (codurile IBKR 1003–1008) | „—” și „raportul Flex nu e gata încă”; se reîncearcă la următoarea citire |
| IBKR, tranzacție în altă monedă decât cea de bază | convertită cu cursul dat de IBKR; fără curs, intră doar la numărare, iar cardul spune „parțial” |
| IBKR, portofoliul și statisticile în același timp | cererile Flex ale aceluiași token se fac una după alta (IBKR: cel mult una pe secundă, zece pe minut) |
| Trading 212: cumpărări, ordine anulate, evenimente corporative (split, distribuții) | nu sunt tranzacții închise |
| Trading 212, o vânzare fără profitul realizat în răspuns | nu se numără; cardul spune „N fără rezultat” |
| Trading 212 (20 de cereri pe minut, 50 de ordine pe pagină) | Sentiq citește cel mult 10 pagini (500 de ordine, cu tot cu cumpărări). Dacă perioada are mai multe, cardul spune „parțial: istoric prea lung”, iar perioadele scurte rămân complete |
| Trading 212, o vânzare limită plasată înainte de perioadă și executată în ea | se numără, dacă Trading 212 o listează după data execuției (documentația nu spune ordinea) |
| eToro: pagini de 100, cel mult 20 (2.000 de poziții închise) | peste ele, cardul spune „parțial: istoric prea lung” |
| eToro copy trading | se numără pozițiile copiate dacă eToro le pune în istoric (documentația nu spune) |
| Alpaca: istoric | Sentiq citește execuțiile de la cea mai nouă înapoi, cel mult 4.000 |
| Alpaca: vânzări fără cost cunoscut | nu se numără. Cazuri: cumpărarea e mai veche decât ce s-a citit, acțiunile au venit prin transfer sau split, ori contul nu permite short. Cardul spune „N fără rezultat” |
| Alpaca, short | o vânzare pe care Alpaca o marchează ca short (`sell_short`), sau orice vânzare fără acțiuni pe un cont cu short permis, deschide un short; cumpărarea care îl închide e tranzacția |
| Alpaca, opțiuni | rezultatul × 100 (un contract = 100 de acțiuni). Expirarea fără valoare nu e o execuție, deci nu apare |
| Alpaca, crypto | comisionul se ia din monedă, nu intră în rezultat |
| Alpaca, taxele regulatorii (TAF, SEC) | nu intră în rezultat (sunt sume separate, de cenți) |
| Istoricul nu se poate citi (cheie, permisiune, limită de cereri) | cardurile 4–7 arată „—”; eroarea apare sub carduri; restul paginii merge |
| Trading 212, cheie fără permisiunea „History” | eroarea numește permisiunea lipsă |
| Câte cereri | istoricul ultimelor 90 de zile se citește o dată și servește toate perioadele 5 minute; „Reîmprospătează” îl citește din nou (la IBKR rămâne raportul din ultimele 15 minute) |
| Server mai vechi (Mac sau Azure încă nepublicat) | cardurile noi arată „—” |

### 4. Pașii de conectare
- **IBKR:** pasul cu Flex Query-ul spune acum: la secțiunea Trades, nivelul „Execution” și toate câmpurile („Select All”). Așa raportul conține „Realized P/L”, „Open/Close” și „IB Order ID”.
- **Ceilalți:** nicio schimbare. Trading 212 cerea deja permisiunea History, iar eToro și Alpaca citesc istoricul cu cheia existentă.

### 5. Reparat pe drum
- **Trading 212, comisionul din „Tranzacții recente”:** apărea „—”, pentru că Trading 212 dă taxele ca listă (conversie valutară, taxa FINRA, stamp duty). Acum apare suma lor, în moneda contului.
- **IBKR, „raportul nu e gata încă”** (codurile 1001, 1003–1008): mesajul spune asta și se reîncearcă la următoarea citire. Înainte era o eroare generică.

### 6. Conflicte cu ce exista
- **FD-TRADESTATS §3**, „Brokeri (acțiuni) | neschimbat”: brokerii au acum și ei cardurile 4–7, iar selectorul de perioadă apare la toate conturile.
- **Azure / Mac:** nicio schimbare de schemă a bazei; nimic nou salvat.

## FD-CHARTSTEADY — Graficul nu mai sare: antetul la schimbarea simbolului, butoanele din legendă (19 oct 2026)

Cererea utilizatorului (două buguri):
- „când sunt în full screen mode și mă uit la un grafic și trec prin simbolurile disponibile, time frame-ul dispare până când se încarcă noul simbol, și acest lucru mută rândul pe care se află time frame-ul și celelalte butoane împreună pe primul rând. După ce se încarcă …, împinge conținutul ăla pe al doilea rând … Vreau să rămână intervalul acela disponibil, doar că poți să-l faci disabled, și să-l faci enabled când ai datele … Dar măcar să nu se mai miște interfața în felul ăsta.”
- „butonul X … când merg cu mouse-ul peste acel indicator, valorile … se schimbă în funcție de unde sunt cu mouse-ul. Iar anumite valori împing poziția butonului X sau butonului de settings sau butonului de ochi … uneori este greu să nimeresc butonul X … Trebuie să … rămână pe loc, și valorile astea nu le mai împing aiurea.”

### 1. Antetul graficului, la schimbarea simbolului
- **Cauza:** cât se încarcă simbolul nou, prețul și insigna variației („+0,73 % 24h”; la acțiuni „azi” / „la închidere”) dispar. Partea din stânga a antetului se îngustează, iar în ecran complet rândul cu intervalele (1m … 1w) și butoanele încape lângă ea și urcă pe primul rând. Când sosesc datele, coboară la loc.
- **Acum:**
  - prețul și insigna variației rămân pe loc cât se încarcă, **gri, cu „—”** (insigna păstrează „24h”). Se colorează când sosesc datele. Cât se încarcă, fiecare păstrează lățimea valorii simbolului de dinainte, așa că antetul își schimbă așezarea cel mult o dată (de la simbolul vechi la cel nou), nu de două ori;
  - dacă variația nu se poate calcula (o pereche nouă, fără lumânarea de acum 24 de ore), insigna rămâne gri, cu „—”. La cursor spune de ce;
  - **rândul cu intervalele și butoanele nu mai depinde de lățimea prețului, a numelui sau a variației.** Stă lângă simbol doar dacă e loc pentru amândouă la o lățime fixă a părții din stânga, altfel pe rândul următor. Așa nu mai sare de la un simbol la altul, nici în ecran complet;
  - la intervalul 1w, unde variația pe 24 de ore nu are sens, insigna nu apare deloc, ca până acum. Așa e la toate simbolurile, deci nimic nu sare.

### 2. Butoanele din legenda unui indicator
- **Cauza:** în legendă, butoanele (ochi, setări, X) stăteau după valori. Valorile se schimbă cu poziția mouse-ului („98,5” → „101,25”), deci butoanele se mutau.
- **Acum:** butoanele stau imediat după numele indicatorului și parametrii lui, **înaintea valorilor**, ca în TradingView: „RSI 14 close [ochi] [⚙] [X] 55,23”. Numele și parametrii nu se schimbă cu mouse-ul, deci butoanele rămân pe loc.
- La fel la LMA (care are valori). La Slingshot și la LMA ascuns, legenda nu are valori, așa că nu se schimbă nimic.
- Mesajele din legendă („Se încarcă…”, erorile) vin tot după butoane.

### 3. Cazuri limită
| Situație | Comportament |
|---|---|
| Ecran îngust (telefon) | antetul se așază pe rânduri ca până acum; partea din stânga ocupă rândul ei |
| Ecran complet pe un monitor lat | simbolul și rândul cu intervalele pe același rând, oricare ar fi simbolul |
| Ecran complet pe un laptop | rândul cu intervalele mereu pe al doilea rând |
| Numele companiei lung (acțiuni) | se rupe în partea din stânga, nu mută rândul cu intervalele |
| Legenda mai lată decât graficul | se rupe pe rânduri după valori; butoanele rămân lângă nume |
| Butonul „Tranzacționează” apare sau dispare (alt fel de simbol: monedă ↔ acțiune) | rândul din dreapta își schimbă lățimea; e o schimbare reală, nu o pâlpâire la încărcare |

### 4. Conflicte cu ce exista
- **FD-INDICATORS §2** („numele, parametrii, valorile … și butoanele”): ordinea devine nume, parametri, butoane, valori.
- **FD-PREMIUMHIDE:** ochiul de la Slingshot și LMA rămâne în același loc față de nume.

## FD-GOLATESTMAIN — Butonul „la ultima lumânare”, în panoul prețului (19 oct 2026)

**Cererea:** „mută săgeata de derulare pe chart, nu în zona de jos cu panouri. să fie deasupra panourilor”

### 1. Comportament
- Butonul „»” (FD-GOLATEST) stă acum **în colțul din dreapta jos al panoului prețului** (cel cu lumânările), chiar deasupra panourilor de dedesubt: LMA și indicatorii cu panou propriu (RSI, MACD …).
- Fără panouri dedesubt, panoul prețului e și cel mai de jos, deci butonul rămâne unde era: deasupra axei timpului.
- Restul nu se schimbă: când apare, cum arată, ce face la click, tastatura.

### 2. Cazuri limită
| Situație | Comportament |
|---|---|
| Caseta TAKE PROFIT / STOP LOSS a Slingshot (tot în colțul din dreapta jos al panoului prețului) | urcă cu înălțimea butonului cât timp butonul se vede, apoi revine. Acum se întâmplă și cu panouri dedesubt, fiindcă butonul e mereu în colțul ei |
| Panoul prețului micșorat mult (tras de separator) | butonul rămâne în panou; dacă panoul e mai scund decât butonul, butonul se lipește de marginea lui de sus |
| Eticheta PnL a poziției, la dreapta, pe linia prețului, dacă prețul e jos în panou | butonul poate acoperi o parte din ea cât timp se vede, ca în TradingView; dispare la click |
| Ecran complet, telefon | la fel |
| Adaugi sau scoți un panou de indicator cât butonul se vede | butonul se mută odată cu marginea de jos a panoului prețului |

### 3. Conflicte cu ce exista
- **FD-GOLATEST §1** („în ultimul panou, sub LMA sau sub ultimul indicator cu panou propriu”): înlocuit de §1 de aici.
- **FD-GOLATEST §2:** caseta TP / SL urca doar fără panouri dedesubt. Acum urcă oricând se vede butonul.

## FD-SCROLLLOCK — Cât e deschis un panou sau o fereastră, pagina din spate nu se mai derulează (19 oct 2026)

**Cererea:** „când deschid orice side panel, popup și are scroll, vreau să blochezi scrollul doar în acel panou sau popup. nu mai permite scroll în fundal dacă elementele astea sunt deschise.”

### 1. Comportament
- **Cât e deschis unul dintre aceste elemente, pagina din spate stă pe loc.** Rotița, trackpad-ul, tastele (Page Down, spațiu) și degetul pe telefon derulează doar elementul deschis:
  - panoul lateral cu setările unui indicator, Slingshot sau LMA (Grafice);
  - ferestrele: Ordin nou, lista Indicatori, Pornește tranzacționarea, asistentul de conturi, căutarea ⌘K, Rezumatul zilei și fereastra lui de eroare;
  - ecranul complet al graficului (cum era deja).
- **Când derularea ajunge la capătul elementului**, nu mai trece în pagină.
- **La închidere**, pagina e exact unde era.
- **Pagina nu sare lateral** când dispare bara ei de derulare (pe sistemele cu bară vizibilă, ca Windows): locul barei rămâne.
- **Lângă panoul lateral, graficul rămâne utilizabil:** rotița pe grafic face zoom (nu derulează pagina), ca să vezi efectul setărilor.
- **Listele derulante ale căutărilor** (perechea pe Grafice, favoritele în Setări, rezultatele ⌘K): derularea în ele rămâne în ele, fără să miște pagina. Ele nu blochează toată pagina, pentru că rămân deschise cât e text în căutare și pagina ar rămâne blocată până ștergi textul.

### 2. Cazuri limită
| Situație | Comportament |
|---|---|
| Două deodată (panoul lateral și ⌘K, ecran complet și panoul lateral, fereastra Ordin nou din panou) | pagina rămâne blocată până se închide ultimul |
| Un element deschis pe o pagină scurtă (fără derulare) | nimic vizibil nu se schimbă |
| Elementul nu are ce derula (conținut scurt) | rotița nu mișcă nimic |
| Schimbi pagina (link) cu panoul deschis | panoul se închide, iar pagina se poate derula din nou |
| Telefon (iOS / Android) | la fel; derularea care trece de capăt nu mai mișcă pagina |
| Ecran complet al graficului | blocarea lui trece prin același mecanism, ca să nu se încurce cu panourile |

### 3. Conflicte cu ce exista
- **Rezumatul zilei** și **ecranul complet** blocau pagina fiecare în felul lui (`body` și `html`). Acum folosesc același mecanism, cu numărătoare, ca să nu se deblocheze unul pe altul.

## FD-PICKERSORT — Indicatorii din fereastra „Indicatori”, în ordine alfabetică (19 oct 2026)

**Cererea:** „indicatorii din popup trebuie să fie ordonați alfabetic, indiferent de filtrare (taburi)”

### 1. Comportament
- **Toate listele ferestrei „Indicatori” sunt în ordine alfabetică după nume:** Favorite, Premium, Toți, fiecare categorie (Medii mobile, Oscilatori …) și rezultatele căutării.
- **Regula:**
  - nu contează majusculele sau diacriticele;
  - semnele de punctuație nu contează: „[DI] Logarithmic Moving Average” e la D;
  - numerele sunt în ordinea lor („24-hour Volume” e primul, iar „2” vine înainte de „10”).
- **Slingshot și LMA** au în continuare eticheta PREMIUM, dar în „Toți” și în căutare stau la locul lor alfabetic, nu primii.
- **Favoritele** apar alfabetic, nu în ordinea în care au fost marcate cu stea.

### 2. Cazuri limită
| Situație | Comportament |
|---|---|
| Căutare | doar potrivirile, alfabetic |
| Un favorit care nu mai există în catalog | nu apare, ca până acum |
| Steaua apăsată în „Favorite” (scoate un favorit) | rândul dispare, iar restul rămâne alfabetic |
| Ordinea indicatorilor pe grafic și în legendă | neschimbată (ordinea în care au fost adăugați) |

### 3. Conflicte cu ce exista
- **FD-INDICATORS §1** („Premium primele în listă”): în „Toți” și în căutare, Premium nu mai sunt primele. Tab-ul Premium rămâne primul după Favorite.
- **FD-STUDYUX §1** („favoritele în ordinea în care au fost marcate”): acum alfabetic. Lista salvată nu se schimbă, doar afișarea.

## FD-HLINE — Liniile cursorului înapoi; butonul „+” și liniile orizontale (19 oct 2026)

**Cererea:** „pune la loc liniile punctate la cursor pe chart și butonul plus care adaugă linie orizontală. linia orizontală are setările din poze dar le pui pe toate în panou, nu taburi diferite ca pe TradingView.” (cu capturi din TradingView: butonul „+” lângă eticheta prețului de la cursor, meniul lui cu „Draw horizontal line at 2.023 ⌥H”, setările liniei pe tab-urile Style, Text, Coordinates, Visibility, plus Template, Cancel și Ok)

### 1. Liniile cursorului
- Pe grafic revin liniile cursorului: o linie verticală și una orizontală, cu liniuțe, subțiri, în culoarea discretă a temei. Etichetele de pe axe (prețul și ora) rămân.
- În toate panourile (prețul, LMA, indicatorii), ca în TradingView.

### 2. Butonul „+”
- Cât cursorul e în panoul prețului, la capătul din dreapta al liniei orizontale a cursorului (lângă eticheta prețului) apare un buton „+”.
- Când duci mouse-ul pe el, butonul rămâne pe loc.
- Un click deschide un meniu cu: **„Linie orizontală la 2.023”**, cu scurtătura **Alt+H** afișată.
- Alegerea adaugă linia la prețul acela, rotunjit la zecimalele graficului. Linia ia stilul din șablon (§5) sau, fără șablon, pe cel inițial: albastru `#2962FF`, 1 px, continuă, cu eticheta prețului, fără text.
- **Alt+H** (pe Mac: ⌥H), cu cursorul în panoul prețului: adaugă direct linia la prețul cursorului.
- Meniul se închide cu Esc, cu un click în afara lui sau după alegere.

### 3. Liniile pe grafic
- O linie orizontală merge pe toată lățimea panoului prețului, cu culoarea, grosimea și tipul alese.
- **Eticheta prețului:** pe axa prețului, în culoarea liniei, dacă e bifată.
- **Textul**, dacă are, e desenat lângă linie:
  - **vertical:** deasupra (Sus), pe linie (Mijloc, iar linia se întrerupe în dreptul lui) sau dedesubt (Jos);
  - **orizontal:** la stânga, la mijloc sau la dreapta;
  - cu culoarea, mărimea, îngroșat și cursiv alese;
  - pe mai multe rânduri, dacă are.
- **Ce se poate face cu o linie:**
  - **cu mouse-ul pe ea:** cursorul devine o săgeată sus-jos;
  - **tras în sus sau în jos:** se mută, iar prețul nou se salvează la eliberare; graficul nu se derulează cât tragi;
  - **un click (fără tragere):** se deschide panoul ei de setări (§4), iar linia apare selectată (mai groasă) cât panoul e deschis.
- **Unde apare:** pe graficul simbolului pe care a fost desenată (perechea, acțiunea sau indicele), pe toate intervalele permise de „Vizibilitate”. Se salvează în contul tău și apare pe orice dispozitiv.
- Cel mult **50 de linii pe un simbol**. La limită, opțiunea din meniu e dezactivată și spune de ce, iar Alt+H nu mai adaugă nimic.

### 4. Panoul de setări al liniei (un singur panou, fără tab-uri)
Panoul lateral din dreapta, ca la indicatori, cu titlul „Linie orizontală” și secțiunile una sub alta:
- **Linie:** culoarea (cu transparența păstrată), grosimea (1–4 px), tipul (continuă, liniuțe, puncte); **Eticheta prețului** (bifă).
- **Text:**
  - culoarea, mărimea (10, 11, 12, 14, 16, 20, 24, 28, 32, 40), **B** (îngroșat), *I* (cursiv);
  - textul (pe mai multe rânduri, cel mult 500 de caractere);
  - alinierea: verticală (Sus, Mijloc, Jos) și orizontală (Stânga, Centru, Dreapta).
- **Preț:** prețul liniei, cu pasul zecimalelor graficului.
- **Vizibilitate:** pentru fiecare unitate a intervalelor din Sentiq, o bifă și un interval „de la – până la”, ca în TradingView:
  - Minute (1–59): 1m, 3m, 5m, 15m, 30m;
  - Ore (1–24): 1h, 2h, 4h, 6h, 8h, 12h;
  - Zile (1–366): 1d;
  - Săptămâni (1–52): 1w.
  Linia apare pe un interval doar dacă unitatea e bifată și numărul e în interval.
- **Șablon** (trei butoane):
  - **„Salvează ca șablon”:** stilul de acum (fără preț și fără text) devine cel al liniilor noi;
  - **„Aplică șablonul”:** îl pune în formular;
  - **„Stilul inițial”:** albastrul de la §2.
- **Jos:** **Șterge linia**, **Anulează** (pune la loc ce era și închide), **Salvează**.
- **Ce se schimbă se vede pe grafic pe loc** (previzualizare); se păstrează doar la „Salvează”. Esc sau ✕ fac ca „Anulează”.

### 5. Cazuri limită
| Situație | Comportament |
|---|---|
| Linia e în afara prețurilor vizibile | nu se vede (graficul nu se scalează după linii, ca în TradingView); eticheta ei de pe axă nu apare |
| Prețul scris în panou e invalid (gol, negativ la o acțiune, nu e număr) | „Salvează” e dezactivat, cu motivul |
| Interval „de la” mai mare decât „până la” sau în afara limitelor | „Salvează” e dezactivat, cu motivul |
| Toate unitățile de vizibilitate debifate | linia nu apare pe niciun interval (permis, ca în TradingView); panoul spune asta |
| Tragi linia până la marginea panoului | se oprește la margine |
| Trageri pe telefon | atingerea unei linii deschide panoul; mutarea se face din câmpul de preț (tragerea pe ecranul tactil derulează graficul) |
| Schimbi simbolul cu panoul deschis | panoul se închide, fără să salveze (linia e a celuilalt simbol) |
| Schimbi intervalul cu panoul deschis | panoul rămâne; dacă linia nu e vizibilă pe noul interval, nu se vede pe grafic până o faci vizibilă |
| Linia ștearsă din alt tab sau de pe alt dispozitiv | panoul se închide la următoarea citire a setărilor |
| Ștergi linia | dispare de pe toate intervalele simbolului |
| Salvarea eșuează (rețea) | liniile revin la cele de pe server, iar panoul arată eroarea |
| Ecran complet | totul funcționează la fel, inclusiv panoul |
| Linia trece prin dreptul etichetei prețului curent | etichetele de pe axă se așază una sub alta (biblioteca graficului le mută ca să nu se suprapună) |
| Tema luminoasă | culorile liniilor rămân cele alese; textul „Mijloc” e pe fundalul graficului |

### 6. Ce din TradingView nu e aici, și de ce
- **Vizibilitatea pe Ticks, Secunde, Luni și Ranges:** Sentiq nu are aceste intervale.
- **Redenumirea liniei (creionul de lângă titlu):** Sentiq nu are o listă de obiecte desenate unde numele să conteze.
- **Celelalte opțiuni din meniul „+”** (alerte, ordine): nu au fost cerute.

### 7. Conflicte cu ce exista
- **FD-CHARTUX §1** („fără liniile cursorului”): liniile cursorului revin, la cererea de acum. Grila rămâne ascunsă.

## FD-DENAMES — Numele Slingshot și LMA, cu „[DE]” (Dusty Enterprise) (19 oct 2026)

**Cererea:** „pt indicatorul premium LMA ai folosit Title și short title, iar pentru Slingshot nu. Vreau să folosești și acolo, pentru că pe chart vreau să văd numele scurt pentru Slingshot așa cum era setat în script: [DE] Slingshot 3.3. DE e abrevierea pentru Dusty Enterprise. Și la LMA schimbi la fel, din DI în DE.”

### 1. Numele
| Indicator | Titlu (lista Indicatori, panoul de setări) | Nume scurt (legenda de pe grafic) |
|---|---|---|
| Slingshot | **[DE] Slingshot System 3.3** | **[DE] Slingshot 3.3** |
| LMA | **[DE] Logarithmic Moving Average** | **[DE] LMA** |

- În script, Slingshot are titlul „[Dusty Investments] Slingshot System Long 3.3” și numele scurt „[DI] SS LONG 3.3”. Numele scurt e cel cerut acum („[DE] Slingshot 3.3”), iar titlul urmează forma celui de la LMA: prefixul, apoi numele de până acum.
- Versiunea din nume vine din aceeași constantă ca restul aplicației (3.3), deci se schimbă singură la o versiune nouă.
- Legenda Slingshot de pe grafic arată numele scurt, apoi parametrii („38 62”) și butoanele, ca la LMA.

### 2. Ce nu se schimbă
- Titlul panoului „Semnale Slingshot 3.3 pe 1h” și subtitlurile din lista Indicatori („Slingshot · pe grafic”, „LMA · panou separat”).
- Scripturile Pine originale și comentariile din cod care le citează numele. (Din 26 oct 2026, fișierul 3.4 are și el numele „[DE]”: FIX-PINESYNC.)

### 3. Conflicte cu ce exista
- **FD-PICKERSORT §1** („[DI] Logarithmic Moving Average e la D, după Detrended”): cu „[DE]”, ambii indicatori Premium sunt tot la D, dar înainte de „Detrended Price Oscillator” („DE L…” și „DE S…” vin înainte de „Det…”).
- **FD-CHARTUX §3 și FD-INDICATORS §1** („[DI] Logarithmic Moving Average”, „Slingshot System 3.3”): numele de mai sus le înlocuiesc.

## FD-CHARTTV — Graficul ca în TradingView: lista de simboluri în dreapta, tragere liberă, A / L, etichetele prețului; ecranul complet pe iPad (20 oct 2026)

Cererea utilizatorului (cu capturi de pe iPad și din TradingView):
- „în full screen mode butonul X de ieșire din full screen acoperă numele simbolului. Asta ține de Safari pe iPad.”
- „Pozițiile mele nu are aceeași înălțime ca elementele din jurul lui.”
- „Butonul de ieși din ecran se află pe al doilea rând și ar trebui să fie pe rând cu indicatorii.”
- „Lista de simboluri ar trebui să fie o listă verticală la fel ca la TradingView, în dreapta. În stânga se afișează chartul. Trebuie să pot să modific mărimea panoului cu lista de simboluri sau să o ascund complet.”
- „Ce aplici acum aplici generic, nu doar pe iPad. Singura chestie specifică iPadului e butonul X.”
- „Să nu mai blochezi lumânările pe chart. Vreau să trag de oriunde, oricând, fără să deblochez manual.”
- „Buton de încadrare automată a lumânărilor, așa cum are TradingView: A și L (Automat și Logaritmic). Automat așază lumânările să încapă în spațiul disponibil.”
- „Marchează prețul cu diverse culori pe bara verticală de preț, la fel ca în poză: aceleași culori pentru prețul unde am cursorul și pentru prețul actual.”
- „Cursorul se transformă în + când intru pe chart și se afișează dungile punctate.”
- „Butonul >> să fie câțiva pixeli la stânga, pentru că butonul + pentru adăugarea unei linii se așază pe el.”
- „Lista verticală de simboluri ca pe TradingView, adică ca în poza atașată” (coloanele Symbol, Last, Chg, Chg%).

### 1. Ecranul complet pe iPad (doar aici e ceva specific iPad-ului)
- În ecranul complet al sistemului, Safari (și orice browser) pe iPad pune propriul buton ✕ în colțul din stânga sus, peste pagină.
- Pe iPad, în ecranul complet al sistemului, numele simbolului se mută spre dreapta cât e lat butonul (80 px, din FD-IPADFS §2; 56 px nu ajungeau), ca să nu mai fie acoperit. **Retras de FD-IPADFS2:** pe iPad nu se mai folosește ecranul complet al sistemului, deci nici ✕-ul Safari nu mai apare.
- Pe alte dispozitive, sau în ecranul complet „din pagină” (când browserul nu-l are pe al sistemului), nu se schimbă nimic.

### 2. Bara graficului (peste tot)
- **Aceeași înălțime:** intervalele, „Pozițiile mele” și butoanele au aceeași înălțime, pe mouse și pe ecran tactil (unde totul e mai mare).
- **Butoanele stau împreună:** „Pozițiile mele”, „Tranzacționează”, „Indicatori”, butonul listei și cel de ecran complet sunt un grup care nu se rupe. Dacă nu încape lângă intervale, trece tot grupul pe rândul următor; ieșirea din ecranul complet rămâne lângă „Indicatori”.
- **Ieșirea din ecranul complet:** doar iconița, în culoarea de accent, cu explicația la cursor („Ieși din ecran complet (Esc)”). Intrarea rămâne ca acum.

### 3. Lista de simboluri, în dreapta graficului (ca în TradingView)
- **Locul:** favoritele nu mai sunt pastile deasupra graficului, ci o listă verticală într-un panou în dreapta lui. Graficul ocupă restul lățimii.
- **Coloanele:**

  | Coloană | Monede | Acțiuni și indici |
  |---|---|---|
  | Simbol | logo + monedă, cu cotația mai mică („BTC /USDT”) | logo + simbol |
  | Ultimul | prețul de acum | ultimul preț |
  | Var | variația pe 24 h, în preț | variația zilei, în preț |
  | Var% | variația pe 24 h, în procente | variația zilei, în procente |

  Valorile vin din aceleași date ca banda de sus (fără cereri în plus), verzi în creștere, roșii în scădere, și se actualizează la minut.
- **Rândul simbolului deschis** e încadrat. Un click pe un rând deschide graficul lui.
- **Ordinea:** se schimbă trăgând de un rând (pe ecran tactil, după o apăsare scurtă) sau cu Alt + ↑ / ↓. E aceeași ordine ca în Setări și în banda de sus.
- **Căutarea** (pereche, acțiune sau indice) e în capul listei.
- **Mărimea:** panoul se lărgește sau se îngustează trăgând de marginea lui din stânga, între 200 px și jumătate din lățime. Cu tastatura: marginea primește focus, iar ← / → o mută cu 16 px. Dublu-click pe margine revine la 300 px.
- **Coloanele care nu încap:** când panoul e îngust, dispare întâi „Var” (sub 280 px), apoi „Ultimul” (sub 220 px). Cotația monedei („/USDT”) apare doar de la 340 px; la lățimea implicită (300 px) rândul arată doar moneda.
- **Ascunderea:**
  - butonul din capul listei (sau butonul listei din bara graficului) o ascunde, iar graficul ia toată lățimea;
  - același buton din bară o readuce.
- **Ce se ține minte:** lățimea și dacă lista e ascunsă, pe fiecare dispozitiv (în browser).
- **Pe ecran îngust** (sub 768 px, telefon): lista stă sub grafic, pe toată lățimea, cu cel mult 360 px înălțime (derulează în ea), fără margine de tras. *Înlocuit de FD-WATCHDRAWER: pe telefon, panou care glisează din dreapta.*
- **În ecranul complet:** lista e în dreapta, pe toată înălțimea graficului.

### 4. Tragerea graficului și butoanele A / L
- **Tragere liberă:** pe panoul prețului, graficul se trage în orice direcție, de oriunde și oricând. Când tragerea are și o componentă verticală, scala prețului trece singură pe manual (ca în TradingView). Cu tragere doar orizontală, rămâne pe automat.
- **A (Automat)**, în colțul din dreapta jos, sub scala prețului: aprins = lumânările vizibile încap pe înălțime (scala urmărește singură prețurile). Un click îl aprinde și reîncadrează lumânările. Se stinge singur când tragi graficul pe verticală sau tragi de scala prețului.
- **L (Logaritmic)**, lângă A: scala prețului logaritmică sau normală. Se ține minte în cont.
- **Ce se întâmplă singur:** la schimbarea simbolului sau a intervalului, A se aprinde din nou.
- **Panourile indicatorilor:** se încadrează singure, ca până acum; tragerea orizontală merge ca înainte.

### 5. Etichetele prețului și cursorul
- **Prețul curent:**
  - pe scala prețului, o etichetă galben-pal cu text închis la culoare;
  - sub preț, cât mai e până se închide lumânarea („50:31”, „12:34:56”, „3z 04:10”);
  - linia lui orizontală e galbenă, punctată.
- **Numărătoarea la acțiuni și indici:**
  - apare doar cu bursa deschisă, iar lumânarea se închide cel târziu la închiderea bursei: ultima lumânare de 1h a zilei, sau cea de o zi, numără până la 16:00 la New York;
  - pe 1w nu apare (lumânarea nu se închide azi);
  - cu bursa închisă, eticheta are doar prețul.
- **Prețul și ora de sub cursor:** etichete gri închis cu text alb.
- **Cursorul:**
  - pe grafic, cursorul e o cruce („+”), iar liniile lui sunt punctate;
  - pe o linie orizontală devine săgeata sus-jos;
  - pe scale rămâne cum e acum.
- **Butonul „+”** (linie orizontală, FD-HLINE): un pătrățel gri, lipit de eticheta prețului de sub cursor, ca în TradingView.
- **Butonul »** (la ultima lumânare) se mută cu 34 px spre stânga, ca „+” să nu mai stea peste el.

### 6. Cazuri limită
| Situație | Comportament |
|---|---|
| Lista ascunsă | graficul ia toată lățimea. Simbolurile se pot schimba din bara graficului (butonul listei) sau din căutarea ⌘K |
| Niciun favorit | lista spune unde se adaugă (Setări → Favorite) și că din căutarea din capul ei se deschide orice grafic |
| Mulți favoriți | lista derulează în ea, fără să miște pagina (și pe telefon, în cei 360 px) |
| Cauți cu lista îngustă | rezultatele au cel puțin 260 px și ies peste grafic, întregi |
| Prețul unui favorit nu se poate citi | „—” în coloane, cu motivul la cursor |
| Fereastra se îngustează sub lățimea panoului | panoul se strânge la jumătate din lățime |
| Tragi A de pe un interval cu lumânări puține | se încadrează ce se vede |
| L cu prețuri foarte mici (monede de 0,0001) | merge; tragerea pe verticală se face pe scara logaritmică |
| Tragi graficul și eliberezi fără mișcare | e un click, nu schimbă scala |
| Tragi o linie orizontală (FD-HLINE) | linia se mută, nu graficul |
| Ecran tactil | tragerea cu un deget mută graficul la fel; A și L se ating |
| Ciupești graficul cu două degete (zoom) | e zoom, nu tragere: prețurile nu se mută, A rămâne cum era |
| Tema luminoasă | etichetele au aceleași culori (galbenul și griul se citesc pe ambele) |

### 7. Conflicte cu ce exista
- **FD-CHARTFAV §2** (pastilele favoritelor deasupra graficului): înlocuite de lista din dreapta. Reordonarea rămâne (pe verticală).
- **FD-CHARTSTEADY:** bara graficului păstrează partea din stânga cu bază fixă.
- **FD-GOLATESTMAIN:** butonul » e cu 34 px mai la stânga.
- **FD-HLINE §1–2:** liniile cursorului rămân punctate. Etichetele lor și butonul „+” capătă culorile de aici.

## FD-KUCOINHEDGE — Ordine futures pe KuCoin și în modul hedge (20 oct 2026)
Cererea:
- „Am ratat un trade bun pentru că Sentiq nu m-a lăsat să fac trade-ul. Face trade cu KuCoin de futures doar în one-way mode și eu vreau să facă și în hedge mode.”

Ce spune KuCoin (documentația API, oct 2026):
- Modul pozițiilor e al contului, pentru toate perechile futures: one-way (o singură poziție pe pereche) sau hedge (un long și un short separate pe aceeași pereche).
- Se schimbă din KuCoin (Futures → Setări → Preferințe → Mod poziție), doar fără poziții deschise și fără ordine active.
- În hedge, fiecare ordin spune poziția lui (`positionSide` LONG / SHORT); fără ea, KuCoin îl refuză („Your order is in One-Way Mode, while your account is set to Hedge Mode”, cod 330012).
- Pe contul unificat (UTA), ordinul nu primește `positionSide` („Not supported”), deci acolo nu există ordine hedge prin API.

### 1. Ce se schimbă
- **KuCoin, contul clasic:** Sentiq trimite ordine futures și când contul e în modul hedge, nu doar în one-way. Modul se citește din cont, ca acum (ținut 10 minute); Sentiq nu-l schimbă.
- **One-way:** totul rămâne ca acum.
- **Contul unificat KuCoin (UTA) în hedge:** rămâne refuzat, cu explicația nouă: „Pe contul unificat KuCoin (UTA), API-ul KuCoin primește ordine futures doar în modul one-way. Schimbă modul pozițiilor în KuCoin (Futures → Preferințe → Mod poziție, fără poziții deschise), sau tranzacționează din aplicația KuCoin.” Refuzul apare deja la verificare, înainte de confirmare.
- **Celelalte exchange-uri (Binance, Bybit, OKX, Bitget):** rămân doar one-way, ca acum (cererea e pentru KuCoin). *Înlocuit de FD-HEDGEALL: hedge pe toate.*

### 2. Ce face fiecare ordin în modul hedge
| În formular | One-way (ca acum) | Hedge |
|---|---|---|
| **Long**, fără reduce-only | cumpără: mărește long-ul, sau micșorează / întoarce short-ul | deschide sau mărește long-ul; short-ul rămâne |
| **Short**, fără reduce-only | vinde: mărește short-ul, sau micșorează / întoarce long-ul | deschide sau mărește short-ul; long-ul rămâne |
| reduce-only, vânzare | micșorează poziția (long) | **Închide long**: micșorează sau închide long-ul |
| reduce-only, cumpărare | micșorează poziția (short) | **Închide short**: micșorează sau închide short-ul |

- **Butoanele de direcție:** în hedge, cu reduce-only bifat, se numesc „Închide long” și „Închide short” (în loc de „Short” și „Long”).
- **TP / SL atașate și ordinele stop de intrare:** se pun pe poziția pe care o deschide ordinul (long-ul sau short-ul).
- **„Închide” din Tranzacții → Poziții:** închide exact poziția de pe rândul ei (long-ul sau short-ul), cu un ordin la piață reduce-only.
- **Levierul cross:** pe KuCoin e al perechii, comun pentru long și short; Sentiq îl setează ca acum. Levierul izolat merge cu ordinul, ca acum.

### 3. Ce arată formularul
- **Sub pereche:** „Mod hedge”, apoi pozițiile deschise: „long 0,01”, „short 0,02” (fiecare doar dacă e deschisă).
- **Avertismente** (nu blochează):
  - Short fără reduce-only, cu un long deschis: „Contul e în modul hedge: «Short» deschide un short separat, iar long-ul de 0,01 BTC rămâne deschis. Ca să-l închizi, bifează reduce-only («Închide long»).” La fel, invers, pentru Long cu un short deschis;
  - „Închide long” fără long deschis: „Nu e niciun long deschis pe BTC/USDT:USDT: «Închide long» nu are ce închide.” La fel pentru short;
  - un reduce-only mai mare decât poziția (în ambele moduri, pe KuCoin): „Închizi 0,05 BTC, iar poziția are 0,02 BTC: KuCoin anulează un ordin reduce-only mai mare decât poziția.”
- **Confirmarea:** Direcție „Long”, „Short”, „Închide long” sau „Închide short”, plus rândul „Mod poziții: hedge (long și short separate)”.

### 4. Unde se mai vede
- **Tranzacții → Poziții:** un long și un short pe aceeași pereche sunt rânduri separate (ca acum, cheia e perechea + direcția), fiecare cu „Închide”. Direcția vine din poziția numită de KuCoin (LONG / SHORT), nu doar din semnul cantității.
- **Tranzacții → Ordine:** un ordin hedge arată, lângă direcție, poziția lui („long” / „short”). La fel la un cont Binance în hedge, care se poate doar citi (Binance dă același câmp).
- **Graficul („Pozițiile mele”):**
  - cu long și short deschise pe aceeași pereche, titlurile liniilor (lichidare, SL, TP, PnL) spun LONG sau SHORT, nu doar „futures”;
  - un ordin hedge se leagă doar de poziția lui. Un short deschis cu o vânzare limită nu mai apare ca TP al long-ului, iar SL-ul short-ului nu apare la long.

### 5. Cazuri limită
| Situație | Comportament |
|---|---|
| Modul schimbat pe KuCoin între timp (Sentiq îl ține 10 min) | KuCoin refuză ordinul și nu se execută nimic. Mesaj: „Modul pozițiilor (one-way / hedge) s-a schimbat pe KuCoin: ordinul n-a fost primit. Trimite-l din nou.” Sentiq uită modul ținut minte și îl citește din nou la următoarea verificare. Pe contul unificat (care nu primește deloc ordine hedge): explicația din §1, nu „trimite-l din nou” |
| Modul nu se poate citi (rețea, cheie) | la verificare: eroarea, înainte de trimitere, ca acum; nimic nu e ghicit. În formular (înainte de verificare), modul pur și simplu nu apare |
| Contul unificat (UTA) în hedge | refuzat la verificare (§1) |
| Long izolat deschis, apoi un short cross pe aceeași pereche | KuCoin decide (marja e a perechii); dacă refuză, apare mesajul lui |
| Hedge, Short fără reduce-only când vrei să închizi long-ul | avertismentul din §3; dacă confirmi, se deschide un short și long-ul rămâne |
| Hedge, reduce-only cu TP / SL | refuzat la verificare, ca acum (un ordin care închide nu primește TP / SL) |
| Hedge, ambele poziții, „Închide” pe una | doar ea se închide |
| Ordine trimise înainte, încă deschise | rămân pe KuCoin; anularea merge la fel |
| Trecerea one-way ↔ hedge | KuCoin cere înainte închiderea pozițiilor și anularea ordinelor, deci nu există poziții amestecate |
| Spot | neschimbat |
| Alt exchange în hedge | refuzat, ca acum |
| Statisticile tranzacțiilor închise (FD-TRADESTATS) | neschimbate: fiecare poziție închisă (long sau short) e un rând în istoricul KuCoin |

### 6. Conflicte cu ce exista
- **FD-TRADING §7** (cazul „Cont futures în modul hedge (Binance, OKX, KuCoin, Bitget)”, refuzat): KuCoin clasic iese de acolo. Refuzul rămâne pentru celelalte exchange-uri și pentru contul unificat KuCoin.
- **Ghidul** („Futures doar în modul one-way”, „Contul e în modul hedge”): primesc excepția KuCoin.
- **Liniile pozițiilor pe grafic** (`pnlLines`): rolul unui ordin ține cont de poziția lui în hedge (§4).

## FD-HEDGEALL — Modul hedge pe toate platformele (20 oct 2026)
Cererea:
- „Trebuie să verifici documentația pentru toate exchange-urile și să aplici la fel pentru toate. Inclusiv brokeri.” (după FD-KUCOINHEDGE, făcut doar pentru KuCoin)

### Cercetare (documentațiile platformelor și ccxt 4.5.85)
| Platformă | Poziții long și short separate pe același instrument? | Cum se citește modul | Ce cere fiecare ordin în hedge |
|---|---|---|---|
| **KuCoin** (clasic) | da, modul hedge al contului | `getPositionMode` | `positionSide` LONG / SHORT (FD-KUCOINHEDGE) |
| **KuCoin** (unificat) | nu prin API („positionSide: Not supported”) | — | refuzat, cu explicația |
| **Binance** USDⓈ-M | da, „Hedge Mode” (`dualSidePosition`) al contului, pentru toate perechile USDⓈ-M | `GET /fapi/v1/positionSide/dual` | `positionSide` LONG / SHORT; `reduceOnly` nu se trimite în hedge (închiderea e o vânzare pe LONG sau o cumpărare pe SHORT) |
| **Bybit** (cont unificat) | da, „Both Sides” (mode 3), **pe pereche** (perechea > moneda > implicit one-way) | lista pozițiilor perechii (`/v5/position/list` cu `symbol` răspunde și fără poziție): `positionIdx` 0 = one-way, 1 / 2 = hedge | `positionIdx` 1 (long) / 2 (short) |
| **OKX** | da, „long/short mode” al contului (`posMode` `long_short_mode`) | `GET /api/v5/account/config` | `posSide` long / short; reduce-only e închiderea pe partea poziției; levierul izolat se pune pe partea ei (`posSide`) |
| **Bitget** clasic | da, `hedge_mode` al contului | contul futures (`posMode`) | `tradeSide` open / close; levierul izolat pe partea poziției (`holdSide`) |
| **Bitget** unificat | da, `holdMode` al contului | setările v3 | `posSide` long / short |
| **eToro** | da, întotdeauna: fiecare ordin e o poziție a lui („You cannot simply «sell» the instrument; you must close the specific line item”) | — (nu are moduri) | un short e o poziție nouă; închiderea e pe poziție (ca acum) |
| **Alpaca** | **nu**: o singură poziție pe simbol (long sau short, netă) | — | — |
| **Trading 212** | **nu**: prin API doar conturile Invest / ISA, fără short | — | — |
| **Kraken, Coinbase** | **nu**: Sentiq tranzacționează doar spot acolo | — | — |
| **Interactive Brokers** | nu se tranzacționează din Sentiq (doar citire) | — | — |

### 1. Ce se schimbă
- **Binance, Bybit, OKX, Bitget (clasic și unificat):** ordinele futures merg și în modul hedge, exact ca pe KuCoin (FD-KUCOINHEDGE §2–§4): „Long” deschide sau mărește long-ul, „Short” short-ul, reduce-only închide partea ei („Închide long / short”), TP / SL și stop-urile pe poziția ordinului, „Închide” din Poziții închide poziția de pe rând.
- **Modul se citește** înainte de verificare (ținut 10 minute; pe Bybit, pe pereche). Formularul arată „Mod hedge” și pozițiile long / short ale perechii, avertismentele și confirmarea ca pe KuCoin.
- **Levierul cu marjă izolată în hedge** (OKX, Bitget clasic): se pune pe partea pe care o deschide ordinul (long sau short), cum cer cele două exchange-uri. Cu marjă cross, ca acum.
- **Binance, TP / SL** (trimise după o intrare la piață): în hedge, pe partea poziției deschise, fără reduce-only (Binance nu-l primește în hedge).
- **Tranzacții → Ordine și graficul:** eticheta „long” / „short” a unui ordin hedge și legarea lui de poziția lui merg pe toate exchange-urile. Fiecare își numește partea altfel: `positionSide` la KuCoin și Binance, `posSide` la OKX și Bitget, `positionIdx` la Bybit.
- **Modul schimbat între timp** (pe orice exchange): exchange-ul refuză ordinul, nimic nu se execută. Mesajul e „Modul pozițiilor (one-way / hedge) s-a schimbat pe <exchange>: ordinul n-a fost primit. Trimite-l din nou.”, iar Sentiq citește modul din nou.
- **KuCoin unificat:** rămâne refuzat (API-ul nu primește ordine hedge acolo).
- **eToro:**
  - pozițiile sunt deja separate (un „Short” deschide un short lângă cumpărările ținute; o deținere se vinde cu „Închide”), deci nu e nimic de deblocat;
  - formularul arăta doar partea long când erau amândouă. Acum arată „long x · short y” (sumele pe fiecare parte);
  - Tranzacții: două poziții pe aceeași parte a aceluiași instrument (ex. două short-uri) nu se mai încurcă pe pagină (fiecare rând își are cheia lui);
  - închiderea unui short: butonul rândului spune „Închide” (nu „Vinde”), coloana „De închis”, iar nota „Fiecare închidere are o confirmare” (un short se răscumpără, nu se vinde).
- **Alpaca:** hedge-ul nu există (o poziție netă pe simbol). Formularul spune ce se întâmplă de fapt:
  - vânzare peste long: „Alpaca ține o singură poziție pe simbol: vânzarea închide întâi long-ul de x, iar peste el deschide un short (dacă contul permite short). Nu există long și short în același timp.”;
  - cumpărare cu un short deschis, mai mult decât short-ul: „Alpaca ține o singură poziție pe simbol: cumpărarea acoperă întâi short-ul de x, iar peste el deschide un long.”; cel mult cât short-ul: „…cumpărarea micșorează short-ul de x (nu deschide un long separat).”
- **Trading 212, Kraken, Coinbase, IBKR:** nicio schimbare (fără short, doar spot, sau fără tranzacționare); ghidul spune de ce.
- **Pașii de configurare** (cheile): OKX nu mai cere modul „net”; la Bybit, modul pozițiilor nu mai trebuie să fie one-way.

### 2. Cazuri limită
| Situație | Comportament |
|---|---|
| Bybit: o pereche în hedge, alta în one-way (modul e pe pereche) | fiecare ordin în modul perechii lui |
| Bybit: lista pozițiilor nu spune modul (răspuns gol) | ordinul pleacă one-way; dacă Bybit refuză pentru mod, mesajul de mai sus, iar modul se citește din nou |
| OKX cu mai multe conturi (subconturi) pe aceeași cheie | ca acum: eroarea OKX la citirea modului, înainte de trimitere |
| Hedge + marjă izolată pe OKX / Bitget, iar long-ul și short-ul au levier diferit | fiecare parte cu levierul ei; Sentiq îl schimbă doar pe partea ordinului |
| Binance hedge: TP / SL după intrare | pe partea poziției deschise; dacă unul eșuează, apare în rezultat, ca acum |
| Binance hedge: „Închide” mai mult decât poziția | Binance refuză, cu mesajul lui |
| Bitget clasic: ordinul nu mai poartă `oneWayMode` în hedge | în hedge, ordinul e „open” / „close” pe parte; în one-way, ca acum |
| eToro: long și short pe același instrument | ambele în formular; „Închide” pe fiecare rând, ca acum |
| Alpaca: vânzare cu un short deja deschis | mărește short-ul (dacă contul permite), ca acum |
| Un exchange răspunde la mod cu o eroare de rețea | eroarea, înainte de trimitere; formularul doar nu arată modul |

### 3. Conflicte cu ce exista
- **FD-KUCOINHEDGE §1** („Celelalte exchange-uri rămân doar one-way”): înlocuit de §1 de aici.
- **FD-TRADING** (cercetarea: OKX „net”, Bitget „modul trebuie trimis cu fiecare ordin”; §7: hedge refuzat pe Binance, OKX, Bitget, Bybit): hedge-ul merge acum; rămâne refuzat doar pe contul unificat KuCoin.
- **Ghidul:** „Futures în modul one-way. Excepție: KuCoin” devine „one-way sau hedge, pe toate exchange-urile cu futures, în afară de contul unificat KuCoin”.

## FD-WATCHDRAWER — Lista de simboluri pe telefon: panou care glisează din dreapta (20 oct 2026)
Cererea (după deploy):
- „Nu ai testat pe mobil. Nu funcționează panoul de simboluri. Nu trebuie afișat sub grafic, ci ca panou sliding din dreapta. Și după ce îl retrag nu mai poate fi adus înapoi. Și strică și mărimea paginii pe lățime.”
- „Nu e vorba de tranzacționare. E vorba de lista de simboluri.”

Ce era greșit (măsurat în Chrome, 320–430 px, cu atingere):
- lista stătea sub grafic (FD-CHARTTV §3, „pe ecran îngust”), nu era un panou;
- grupul butoanelor din bara graficului nu se rupea pe rânduri (FD-CHARTTV §2), deci se întindea până la 545 px. Pagina devenea mai lată decât ecranul, iar butonul listei ajungea la x 445–489, în afara ecranului. După „Ascunde lista”, lista nu mai putea fi readusă.

### 1. Pe telefon (sub 768 px lățime)
- **Lista e un panou** care glisează din dreapta peste grafic, pe toată înălțimea ecranului, lat de 340 px (cel mult 88 % din ecran), cu pagina umbrită în spate.
- **Se deschide** cu butonul listei din bara graficului (mereu pe ecran, §3).
- **Se închide:**
  - cu butonul din capul listei;
  - atingând zona umbrită;
  - cu Esc (tastatură);
  - alegând un simbol (se deschide graficul lui, iar panoul se închide).
- **La fiecare intrare pe pagină, panoul e închis**, ca să nu acopere graficul. Pe telefon nu se ține minte nimic, iar lățimea și „ascunsă” de pe ecranele late rămân neatinse.
- Cât e deschis, pagina din spate nu derulează (FD-SCROLLLOCK). Focusul trece în panou, iar la închidere revine la butonul listei.
- **În ecranul complet:** panoul merge la fel. Esc închide întâi panoul, abia apoi ecranul complet.
- Conținutul e același ca pe ecranele late: capul, căutarea, coloanele (după lățime: la 340 px apar toate patru) și reordonarea.

### 2. Pe ecranele late (de la 768 px: tabletă, desktop)
- Ca acum (FD-CHARTTV §3): panoul din dreapta graficului, cu lățimea trasă, ascuns sau arătat, ținut minte în browser.

### 3. Bara graficului
- Pe telefon, butoanele („Pozițiile mele”, „Tranzacționează”, „Indicatori”, butonul listei, ecranul complet) se rup pe rânduri cât e nevoie. Nimic nu iese din ecran, iar pagina nu mai e mai lată decât el.
- De la 768 px, grupul rămâne nedespărțit (FD-CHARTTV §2: ieșirea din ecranul complet lângă „Indicatori”).

### 4. Cazuri limită
| Situație | Comportament |
|---|---|
| Telefonul rotit (lățimea trece peste 768 px) | panoul de telefon se închide, iar lista apare ca pe ecranele late (după ce s-a ținut minte acolo) |
| Fereastra îngustată sub 768 px cu lista arătată | lista devine panoul de telefon, închis |
| Cauți în panou | rezultatele se deschid sub căutare, în panou |
| Reordonezi favoritele în panou | ca în listă (apăsare lungă, apoi tragi) |
| Niciun favorit | panoul spune cum se adaugă |
| Panou deschis și apeși butonul listei din bară | nu se poate (e sub zona umbrită); se închide cu ✕ / zona umbrită / Esc |
| Alt sertar (setările unui indicator) sau ⌘K deschise | fiecare își are stratul și blocarea derulării (numărată, FD-SCROLLLOCK) |

### 5. Conflicte cu ce exista
- **FD-CHARTTV §3** („Pe ecran îngust: lista stă sub grafic”): înlocuit de §1.
- **FD-CHARTTV §2** („grupul nu se rupe”): doar de la 768 px.

## FD-CHARTTOUCH — Pinch pe grafic (telefon, iPad) și butonul listei ultimul în dreapta (20 oct 2026)
Cererea:
- „Bugul de pinch to zoom încă e prezent.” „Pinch to zoom pe grafic face pe pagină, nu pe grafic. Comportamentul este inconsecvent.”
- „Butonul de panou trebuie să fie primul la dreapta… pentru că deschide un panou de la dreapta.”
- „Tratează bine. M-am săturat de câte deploy-uri faci.” „Faci deploy când termini.”

Ce era greșit (cercetat în biblioteca graficului, lightweight-charts 5.2.1, și reprodus):
- Biblioteca renunță la pinch dacă primul deget s-a mișcat **oricât de puțin** (orice `touchmove`) înainte să atingă al doilea. Safari pe iPhone / iPad trimite și mișcările de 1 px, iar Chrome le ascunde pe cele mici (de aceea testele mele din Chrome nu vedeau problema).
- Fără pinch-ul bibliotecii, gestul ajungea la browser, care mărea pagina. Pentru că primul deget se mișcă sau nu, după mână, comportamentul era inconsecvent.
- Tragerea liberă a lui Sentiq (FD-CHARTTV §4) prelua mișcarea pe verticală de la 3 px. Un pinch în care primul deget se mișca 3–5 px stingea „A” și muta prețurile.

### 1. Pinch-ul (telefon, tabletă)
- **Pinch cu două degete pe grafic mărește sau micșorează graficul, de fiecare dată**, oricum ar atinge degetele (simultan sau unul după altul, cu primul mișcat puțin).
- **Pagina nu se mai mărește** dintr-un gest pe grafic (nici pinch, nici dublă atingere), nici pornit de pe ce stă peste grafic (legenda, „A” / „L”, », „+”). Atingerile pe butoanele acestea merg ca înainte. Pe restul paginii, zoom-ul browserului rămâne ca acum.
- **„A” rămâne cum era:** un pinch nu e tragere; scala prețului se încadrează singură în continuare.
- Tragerea cu un deget: ca acum (în orice direcție). Începe după 8 px de mișcare: sub atât, poate fi începutul unui pinch.
- Derularea paginii: ca acum. Pe grafic, glisarea o folosea și înainte graficul; deasupra și dedesubtul lui, pagina derulează.

### 2. Butonul listei
- În bara graficului, butonul listei e **ultimul, cel mai din dreapta** (după „Ecran complet” / ieșirea din el), pentru că deschide un panou din dreapta.
- Pe telefon, unde butoanele se rup pe rânduri, butonul listei stă la marginea din dreapta a rândului lui.
- Când bara graficului trece pe rândul ei, sub numele simbolului (de ex. la 1440 px, cu „Tranzacționează”), se aliniază la dreapta. Așa, butonul listei stă deasupra listei, la marginea conținutului.
- Ieșirea din ecranul complet rămâne lângă „Indicatori” (FD-CHARTTV §2).

### 3. Cazuri limită
| Situație | Comportament |
|---|---|
| Primul deget se mișcă sub 8 px, apoi vine al doilea | pinch |
| Primul deget se mișcă peste 8 px (tragere începută), apoi vine al doilea | tragerea continuă (biblioteca nu face pinch în timpul unei trageri). Pagina nu se mărește |
| Pinch pe scala prețului sau a timpului | ca biblioteca (pe scale, tragerea le schimbă) |
| Atingere scurtă (tap) pe grafic | ca acum (crucea, „+” la linia orizontală) |
| Un deget ținut aproape pe loc (sub 8 px) un sfert de secundă | crucea care urmărește degetul (apăsare lungă), ca înainte; pragul de „pe loc” era 5 px, acum 8 px. O tragere care pornește foarte încet poate deveni cruce |
| Pinch pe scara logaritmică | la fel, „A” rămâne |
| Mouse / trackpad | neschimbat (rotița, tragerea de la 3 px) |

### 4. Conflicte cu ce exista
- **FD-CHARTTV §4** (tragerea liberă de la 3 px): la atingere, de la 8 px. Al doilea deget lasă scala cum era înainte de gest.
- **FD-CHARTTV §2:** ordinea butoanelor din grup: „Pozițiile mele”, „Tranzacționează”, „Indicatori”, ecranul complet, lista.
- **FD-CHARTSTEADY:** partea din stânga a barei (numele, prețul) rămâne cu baza fixă. Partea din dreapta, când trece pe rândul ei, stă acum la dreapta, nu la stânga.

## FD-CHARTPOLISH — Lista, bara, A / L și „+”: corecturi (20 oct 2026)
Cererea:
- „Nu ai pus destul spațiu între item-urile din lista de simboluri. La hover, fundalul elementului selectat și fundalul de hover al elementului de lângă se ating.”
- „Când fac scroll în panou nu se mai face scroll la pagină, ceea ce e bine. Dar când am ajuns la capătul listei, dacă insist cu scrollul în aceeași direcție, ar trebui să permiți scroll pe pagină, temporar.”
- „Scoate butonul de ascundere a panoului din panou, pentru că există deja buton deasupra panoului. De ce e de 2 ori?”
- „Rândul cu intervalele, Pozițiile mele etc. de ce nu e aliniat la stânga? Ai aliniat butonul de ascundere a panoului la dreapta și ai tras tot rândul cu el.”
- „Butoanele A și L sunt la baza barei de preț, nu la baza panoului secundar din grafic.”
- „Când fac hover pe butonul +, nu trebuie să dispară liniile punctate și nici fundalul prețului de pe linia pe care sunt.”

### 1. Lista de simboluri
- **Spațiu între rânduri:** 4 px. Fundalul rândului deschis (încadrat) și cel de hover al vecinului nu se mai ating.
- **Derularea**, pe ecranele late (panoul lateral):
  - cât lista mai are unde derula, derulează doar lista;
  - ajunsă la capăt, un scroll nou în aceeași direcție derulează pagina (comportamentul obișnuit al browserelor: gestul început în listă rămâne în listă, cel început la capătul ei trece la pagină);
  - înapoi, lista derulează din nou;
  - **în ecranul complet, nu** (FD-IPADFS §1): acolo nu e nicio pagină de derulat, iar pe iPad derularea trecută mai departe ajungea la Safari, care ieșea din ecranul complet.
- **Pe telefon** (panoul glisant), pagina din spate rămâne blocată cât panoul e deschis (FD-WATCHDRAWER).
- **Fără buton de ascundere în capul listei:** capul arată doar „Listă” și numărul. Lista se ascunde și se arată din butonul de deasupra ei (ultimul din dreapta al barei graficului).
- **Pe telefon, panoul se închide:**
  - atingând zona umbrită;
  - trăgând panoul spre dreapta (îl urmează degetul; peste 80 px se închide, altfel revine);
  - cu Esc;
  - alegând un simbol.

### 2. Bara graficului
- Intervalele, „Pozițiile mele”, „Tranzacționează”, „Indicatori” și ecranul complet stau **aliniate la stânga**, ca înainte de FD-CHARTTOUCH.
- **Doar butonul listei e la marginea din dreapta**, deasupra listei, pe orice lățime. Pe telefon e la capătul ultimului rând de butoane (lângă ecranul complet), la dreapta, nu singur pe un rând.

### 3. A și L
- Stau **la baza scalei prețului** (colțul din dreapta jos al panoului cu lumânări), nu sub panourile de dedesubt (LMA, indicatori).
- Fără panouri dedesubt: tot acolo, deasupra axei timpului.
- Au fundalul graficului sub ele, ca să nu se amestece cu prețurile de pe scală.

### 4. Butonul „+”
- Cât mouse-ul e pe „+” sau pe meniul lui, crucea rămâne: liniile punctate (orizontală și verticală) și eticheta gri a prețului de pe scală, la prețul unde era.
- Plecat de pe „+” înapoi pe grafic: crucea urmează mouse-ul, ca de obicei. Plecat în afara graficului (cu meniul închis): crucea dispare.

### 5. Cazuri limită
| Situație | Comportament |
|---|---|
| Lista scurtă (nu derulează) | scroll-ul pe ea derulează pagina |
| Cauți în listă (rezultatele derulează în ele) | ca acum: rezultatele nu trec la pagină |
| Reordonezi un rând (tragere) | spațiul dintre rânduri nu încurcă |
| Tragere spre dreapta mai mult pe verticală decât pe orizontală (pe telefon) | e derularea listei, nu închiderea |
| Apăsare lungă pe un rând, apoi tragere (reordonare) | reordonarea, nu închiderea |
| A / L cu un preț de pe scală chiar acolo | butoanele îl acoperă, cu fundalul graficului |
| Meniul „+” deschis, mouse-ul plecat | crucea rămâne până se închide meniul |
| Scara logaritmică, panoul LMA ascuns | A / L la baza scalei prețului, la fel |

### 6. Conflicte cu ce exista
- **FD-CHARTTV §3:** butonul de ascundere din capul listei dispare.
- **FD-CHARTTV §4:** A / L nu mai stau în colțul de sub toate panourile.
- **FD-WATCHDRAWER §1:** închiderea cu butonul listei dispare, iar tragerea spre dreapta se adaugă.
- **FD-CHARTTOUCH §2:** alinierea la dreapta a întregii bare se retrage; doar butonul listei rămâne la dreapta.

## FD-NAVOVERFLOW — Bara de sus pe un singur rând, cu „»” pentru meniurile care nu încap (20 oct 2026)
Cererea (cu o captură: bara de sus pe două rânduri, meniul pe primul, căutarea / ceasurile / contul pe al doilea):
- „Asta ar trebui să fie un singur rând. Prefer să colapsezi meniul, să ascunzi items din meniu cu un buton de genul » și, când apăs pe el, să afișezi restul de items, floating, decât să faci două rânduri.”

### 1. Comportament
- **Un singur rând la orice lățime**, de la telefon la ecranele mari: logo-ul, meniul, apoi în dreapta „Rezumat” (pe Azi), căutarea, ceasurile, tema și contul, cum sunt acum.
- **Meniul arată câte pagini încap**, în ordinea de acum (Azi, Știri, Calendar, Economie, Grafice, Tranzacții, Setări, Stare sistem pentru admin). Cele care nu încap trec, de la coadă, sub un buton **„»”**, pus imediat după ultima pagină vizibilă.
- **„»”** deschide o listă plutitoare, sub el, cu paginile ascunse (iconița și numele, ca în meniu). Alegerea unei pagini o deschide și închide lista. Lista se închide și cu un click în afara ei, cu Esc (focusul revine pe „»”) sau cu un nou click pe „»”.
- **Pagina deschisă ascunsă sub „»”:** butonul „»” are culoarea paginii active, iar în listă pagina e marcată la fel ca în meniu.
- **Redimensionarea** (fereastra, rotirea telefonului, „Rezumat” apărut pe Azi): meniul își recalculează pe loc câte pagini arată.
- **Toate încap:** „»” nu apare.
- **Pe telefon**, meniul nu mai e un al doilea rând care derulează orizontal: e în același rând, cu „»” (de obicei, pe telefon, aproape toate paginile sunt sub „»”). Comutatorul de temă rămâne în meniul contului (FD-THEME §2).
- **Sub 768 px**, ca totul să încapă pe un rând: căutarea e doar lupa (fără textul „Caută…” și fără ⌘K), iar „Rezumat” (pe Azi) e doar iconița cu scânteie. Numele lor se citesc în continuare (cititoarele de ecran, explicația la cursor).

### 2. Cazuri limită
| Situație | Comportament |
|---|---|
| Un singur meniu nu încape lângă „»” | doar „»”, cu toate paginile în listă |
| Fonturile se încarcă după prima afișare (lățimi schimbate) | calculul se refac la încărcarea fonturilor |
| Utilizatorul nu e admin | „Stare sistem” nu există nici în meniu, nici sub „»” |
| Lista deschisă și fereastra se lărgește până încap toate | „»” dispare, lista se închide |
| Tastatura | Tab ajunge la „»”; Enter / Space o deschide; ↓ / ↑ trec prin pagini; Esc închide |
| Navigare din altă parte (⌘K, un link) | lista se închide |

### 3. Conflicte cu ce exista
- **FD-REDESIGN / §1 Navigare și layout** („Pe telefon meniul derulează orizontal”): înlocuit de §1.

## FD-FULLWIDTH — Toate paginile pe toată lățimea (20 oct 2026)
Cererea:
- „Să modifici cât de wide este conținutul fiecărei pagini, să fie la fel pe toate paginile. De exemplu, Calendar, Economie și Grafice sunt full width și celelalte nu: fă-le pe toate full width.”

Ce era: conținutul avea cel mult 1600 px. Peste asta, Știri, Tranzacții, Setări (ambele file), Stare sistem și Utilizatori aveau 1240 px, Securitate 1100 px, Economie 1400 px; Azi, Calendar și Grafice nu aveau limită proprie.

### 1. Comportament
- **Toate paginile au aceeași lățime:** toată lățimea ferestrei, cu aceeași margine laterală (16 px pe telefon, 24 px de la 640 px), fără limită de 1600 px.
- **Ce nu se schimbă:**
  - ferestrele (rezumatul zilei, confirmările, formularul de ordin) și formularele de autentificare (login, 2FA) rămân cât sunt;
  - în pagini, câmpurile și textele care au o lățime a lor (de ex. un câmp de formular) rămân așa.

### 2. Cazuri limită
| Situație | Comportament |
|---|---|
| Ecran foarte lat (2000 px și peste) | paginile se întind pe toată lățimea; grilele de panouri își folosesc coloanele, iar listele (Știri) au rânduri mai lungi |
| Telefon | neschimbat (paginile erau deja pe toată lățimea) |

## FD-IPADFS — iPad: ecranul complet nu se mai închide la tragerea în jos; loc pentru ✕ (20 oct 2026)
> **Nu a rezolvat ieșirea** (deploy `dd04edcd`, verificat de utilizator): gestul Safari nu ține cont de pagină. Reparația e FD-IPADFS2; §1 de aici rămâne, §2 e retras, iar iPhone-ul (§3) e tratat tot acolo.
Cererea:
- „Gestul de scroll down pe iPad în modul full screen scoate pagina din full screen. Repară asta.”
- „Mută primul rând câțiva pixeli la dreapta, pentru că nu e îndeajuns spațiu pentru butonul X introdus de Safari.”
- „Pe iPhone, partea de sus a panoului de simboluri e tăiată.”

Lămuriri:
- gestul: oriunde, cu degetul în jos;
- apare de la versiunea de la 10:48 (FD-CHARTPOLISH);
- cauza, spusă de utilizator: „Ai introdus tu, la cererea mea, permisiunea de scroll în momentul în care am ajuns la limita unei liste. Înainte era blocat scroll-ul. Asta cauza problema aceasta.” și „În full screen nu ai la ce să faci scroll.”

Cercetare (codul WebKit pentru ecranul complet pe iOS / iPadOS, `WKFullScreenWindowControllerIOS`):
- Safari are propriul gest de ieșire: o tragere în jos, recunoscută odată cu gesturile paginii;
- din cod nu reiese exact când îl lasă să pornească;
- derularea lăsată să treacă mai departe (FD-CHARTPOLISH §1) iese din listă spre pagina din spatele ecranului complet;
- versiunea de dinainte de 10:48, cu lista blocată la capăt, nu ieșea din ecranul complet.

### 1. Derularea în ecranul complet
- **În ecranul complet** (al sistemului sau „din pagină”), lista de simboluri din panoul lateral **nu mai trece derularea mai departe** când ajunge la capăt (ca înainte de FD-CHARTPOLISH).
- Restul ecranului complet rămâne cum era înainte de 10:48 (nu trecea derularea mai departe nici atunci).
- **În afara ecranului complet**, rămâne ca în FD-CHARTPOLISH §1: la capătul listei, derularea trece la pagină.
- Panoul glisant de pe telefon era deja blocat; nu se schimbă.

### 2. Loc pentru ✕-ul Safari
- Pe iPad, în ecranul complet al sistemului, numele simbolului (primul rând) începe la **80 px** de marginea ecranului complet, în loc de 56 px. **Retras de FD-IPADFS2** (fără ecranul complet al sistemului pe iPad, fără ✕).
- Pe alte dispozitive și în ecranul complet „din pagină”, nu se schimbă nimic.

### 3. iPhone: partea de sus a panoului
- **Nu se reproduce în Chrome.** Am verificat la 390 × 844 (pagina derulată înainte) și în modul orizontal (844 × 390, 932 × 430), cu și fără ecran complet: capul panoului („Listă”) e întreg și vizibil.
- **Cauza ține de Safari pe iPhone:**
  - iOS 26 are probleme cunoscute cu elementele fixe (după tastatură, cu bara de adrese sus);
  - fără o captură nu se știe care dintre ele e.
- **Nu se schimbă nimic aici** până la captură (cu versiunea iOS și poziția barei Safari: sus sau jos).

### 4. Cazuri limită
| Situație | Comportament |
|---|---|
| Ecran complet, tragere în jos pe listă, ajunsă la capăt | lista stă; ecranul complet rămâne |
| Ecran complet, tragere în jos pe grafic | graficul se mută (FD-CHARTTOUCH); neschimbat față de versiunea de dinainte de 10:48 |
| Ecran complet, tragere în jos pe bara de sus a graficului | neschimbat față de versiunea de dinainte de 10:48 |
| Cadrul ecranului complet mai înalt decât ecranul (telefon culcat) | cadrul derulează în el; la capete nu trece mai departe (neschimbat) |
| Ieșit din ecranul complet | lista trece iar derularea la pagină, la capăt |
| ✕-ul Safari ascuns (ecranul complet fără bara lui) | numele rămâne la 80 px (nu se știe când apare bara) |
| Ieșirea voită din ecranul complet | butonul de ieșire de lângă „Indicatori”, Esc (tastatură) sau ✕-ul Safari |

### 5. Conflicte cu ce exista
- **FD-CHARTPOLISH §1:** derularea trecută la pagină de la capătul listei nu mai există în ecranul complet.
- **FD-CHARTTV §1:** spațiul pentru ✕ crește de la 56 la 80 px.

## FD-IPADFS2 — iPhone și iPad: ecranul complet „din pagină” (20 oct 2026)
Cererea, după deploy-ul FD-IPADFS:
- „Nu a funcționat. Rezolvă. Nu știu cum, dar rezolvi.”
- „Trebuie să înțelegi că comportamentul de acum este un conflict cu ce ai implementat tu, pentru că orice scroll în jos omoară full screen, și îți dai seama că Apple nu putea livra așa ceva.”
- „Nici pe iPhone nu funcționează.”

Cercetare:
- **Codul WebKit** (`WKFullScreenWindowControllerIOS`, pe iPhone și iPad):
  - ecranul complet al sistemului are un gest „trage în jos”, care iese imediat (`requestExitFullScreen`);
  - gestul e pus deasupra paginii și se recunoaște odată cu orice derulare.
- **Apple îl vrea așa** ([WebKit 264215](https://bugs.webkit.org/show_bug.cgi?id=264215), inginerul WebKit al ecranului complet): „intenționat, o protecție anti-phishing; site-ul nu-l poate împiedica pe utilizator să iasă din ecranul complet”.
  - Nici `preventDefault`, nici `touch-action: none` nu îl opresc.
  - MDN, la iPad: „Swiping down exits fullscreen mode”.
- **De ce a apărut abia azi:**
  - lista de simboluri e în ecranul complet de azi-dimineață (FD-CHARTTV);
  - derularea ei în sus înseamnă un deget care trage în jos, deci exact gestul Safari;
  - FD-IPADFS (lista blocată la capăt) nu putea ajuta: gestul nu ține cont de pagină.
- **Pe iPhone:**
  - ce iOS are ecranul complet al sistemului primește același gest;
  - în plus, ecranul complet al sistemului acoperă tot ecranul, inclusiv zona camerei și a barei de stare. Partea de sus a panoului de simboluri ajungea probabil acolo (nu se poate verifica fără iPhone; în Chrome capul panoului e întreg).

### 1. Comportament
- **Pe iPhone și iPad**, butonul „Ecran complet” nu mai cere ecranul complet al sistemului. Graficul acoperă toată fereastra browserului, ca pe iPhone până acum:
  - dispar bara de sus a aplicației, banda de prețuri și marginile paginii;
  - rămân bara graficului, graficul și lista de simboluri;
  - barele Safari (adresa, filele) rămân vizibile;
  - nicio tragere în jos nu mai iese din ecranul complet;
  - ieșirea: butonul de lângă „Indicatori”, Esc (tastatură).
- **Pe calculator** (Mac, Windows, Linux) și pe Android, nu se schimbă nimic: ecranul complet al sistemului, ca până acum.
- Panoul de simboluri de pe iPhone stă în fereastra Safari, deci sub barele lui, nu sub zona camerei.
- Fără ✕-ul Safari, numele simbolului nu mai e mutat spre dreapta pe iPad.

### 2. Cazuri limită
| Situație | Comportament |
|---|---|
| iPad cu tastatură | Esc iese; ⌘K iese și deschide căutarea (ca până acum) |
| iPad în Split View / Stage Manager | graficul acoperă fereastra Safari, oricât de mică |
| iPhone cu „Site pentru desktop” (se prezintă ca Mac) | tot ecranul complet „din pagină” (are ecran tactil) |
| Chrome / Firefox / Edge pe iPhone sau iPad | la fel (toate folosesc WebKit, deci au același gest) |
| Mac cu Safari | ecranul complet al sistemului, ca până acum |
| Derulare în listă în ecranul complet | doar lista derulează; pagina din spate e blocată |
| Rotirea ecranului | graficul acoperă fereastra nouă |

### 3. Conflicte cu ce exista
- **FD-CHARTUX §4** („modul ecran complet al sistemului”): pe iPhone și iPad, întotdeauna cel „din pagină”.
- **FD-CHARTTV §1 și FD-IPADFS §2** (locul pentru ✕-ul Safari): retrase, fiindcă nu mai există ✕.
- **FD-IPADFS §1** rămâne: lista nu trece derularea mai departe în ecranul complet.

## FD-CHARTAUDIT — Pagina Grafice testată buton cu buton (20 oct 2026)
Cererea:
- „Fă test la toată pagina aia. Fiecare buton îl apeși, până când iese bine. […] sunt multe alte probleme, cum ar fi popup-uri care nu apar în ecran complet. Te rog frumos, ia în serios treaba asta. Fă o analiză completă și repară orice problemă de UI și user experience.”
- „Butonul + nu ține pasul cu linia dungată și nici cu prețul de lângă: dacă mișc liniile rapid, butonul + rămâne în urmă.”
- „Odată ce am apăsat pe + și a apărut opțiunea de linie orizontală, butonul + nu mai dispare dacă apăs oriunde ca să dispară popupul.”

Cum s-a testat:
- **Safari real** din simulatorul iOS 27 (iPhone 17 Pro, iPad Pro 11"):
  - pagina comandată de la distanță, de pe aceeași origine, doar într-o copie de test;
  - capturi de ecran reale din simulator;
  - măsurători cu `elementFromPoint` (e deasupra?) și cu dreptunghiurile elementelor (e pe ecran?).
- **Chrome, pe desktop**, cu mouse real și ecranul complet al sistemului.
- Butoanele încercate, în și în afara ecranului complet:
  - antetul, intervalele, „Pozițiile mele”, „Tranzacționează” (Spot / Futures, verificarea ordinului), „Indicatori” (căutare, adăugare);
  - legendele (ochiul, setările, ✕), A / L, „+” și meniul lui, linia orizontală și setările ei;
  - lista (căutarea, alegerea, ascunderea), panoul de pe telefon, ieșirea din ecranul complet;
  - pe telefon, meniul „»”; tabelul de semnale și alertele.

Ce a mers fără probleme:
- toate ferestrele („Ordin nou”, confirmarea, „Indicatori”, setările, meniul lui „+”, rezultatele căutării, panoul listei) apar deasupra în ecranul complet, pe iPad, pe iPhone și pe desktop;
- intervalele, A / L, ochiul, ✕, ascunderea listei, alegerea unui simbol (rămâne în ecranul complet), ieșirea, meniul „»”.

### 1. Butonul „+” de lângă prețul crucii
- **Ține pasul cu crucea:** se mută în același cadru cu linia punctată și cu eticheta gri a prețului, oricât de repede se mișcă (mouse-ul sau degetul).
- **Pe ecran tactil** (iPhone, iPad, orice ecran atins cu degetul):
  - „+” apare unde e crucea, ca acum (apăsare lungă, apoi tragere);
  - după ce meniul lui se închide printr-o atingere oriunde în afara lui, „+” dispare, și odată cu el crucea; atingerea care a închis meniul nu-l readuce, nici pe grafic;
  - după „Linie orizontală la …”, la fel: linia se adaugă, iar „+” și crucea dispar;
  - o atingere pe „+” nu-l mai face să pară „sub mouse” (de aceea rămânea).
- **Cu mouse-ul**, ca până acum:
  - „+” urmează mouse-ul pe panoul cu lumânări;
  - un clic în afara graficului închide meniul, iar „+” dispare;
  - un clic pe grafic închide meniul, iar „+” urmează iar mouse-ul;
  - după „Linie orizontală la …”, „+” revine la următoarea mișcare.

### 2. Panoul de setări (indicatori, Slingshot, LMA, linia orizontală)
- **Ce era:**
  - pe iPhone și iPad, panoul avea înălțimea „ecranului mare” al Safari, mai mare decât partea vizibilă;
  - butoanele de jos (Salvează, Anulează, Valorile implicite, Șterge linia) rămâneau sub ecran, deci nu se puteau atinge;
  - măsurat: iPad, butoanele la 1093–1137 px dintr-un ecran vizibil de 1078; iPhone, la 694–738 din 714.
- **Acum:** panoul ține de sus până jos exact cât partea vizibilă a ferestrei; butoanele de jos sunt mereu pe ecran.
- Pe ecrane mai înguste de 440 px, panoul are toată lățimea (nu mai rămâne o fâșie de grafic de 2 px în stânga).

### 3. „Indicatori”: ce e deja pe grafic
- „Adăugat” apare o secundă și jumătate, ca acum.
- **Apoi rămâne „Pe grafic”** lângă un indicator deja adăugat, sau „Pe grafic × 2” dacă e de două ori, ca la cele Premium.
- Indicatorul se poate adăuga în continuare (de mai multe ori, cu parametri diferiți).

### 4. Căutarea din lista de simboluri
- **↓ / ↑** trec prin rezultate (cel ales e evidențiat și adus în vedere); **Enter** deschide rezultatul ales, sau primul dacă nu e ales niciunul.
- **Esc:**
  - cu text în căutare: o golește, fără să închidă panoul de pe telefon și fără să iasă din ecranul complet „din pagină”;
  - cu căutarea goală: ca până acum (închide panoul sau iese din ecranul complet).
  - În ecranul complet al sistemului (desktop), browserul iese oricum la Esc; pagina nu poate împiedica asta.
- Cititoarele de ecran: o listă de opțiuni, cu cea aleasă anunțată.

### 5. Eticheta de stare LMA (BULLISH / BEARISH / NEUTRAL)
- Pe ecranele înguste (telefonul), eticheta de la capătul liniei era tăiată de scara prețului („NE…”).
- **Acum, când nu încape la dreapta, trece în stânga ancorei** (vârful spre dreapta) și se citește întreagă.
- Când încape, rămâne ca în TradingView (la dreapta).

### 6. Graficul cât se încarcă un alt interval sau simbol
- **Ce era:** panoul graficului scădea la înălțimea mesajului „Se încarcă lumânările…” (măsurat: 682 → 70 px, apoi înapoi după ~0,5 s), deci tot ce era dedesubt sărea în sus și înapoi.
- **Acum:** panoul își păstrează înălțimea, iar mesajul stă în mijlocul lui. La fel mesajul de eroare.

### 7. „Serverul Sentiq nu răspunde” în ecranul complet
- Bannerul era doar în pagina din spatele ecranului complet, deci nu se vedea.
- **Acum apare și în ecranul complet**, deasupra graficului (aceeași cerere, nimic în plus).

### 8. Bara graficului: butonul listei nu mai rămâne singur pe un rând
- **Ce era:** la 1180 px (iPad Air culcat, laptopuri mici) și la 1024 px în ecranul complet (iPad culcat), butonul listei trecea singur pe un rând nou, sub celelalte.
- **Acum:** de la 768 px în sus, butonul listei e la capătul rândului cu „Pozițiile mele”, „Tranzacționează”, „Indicatori” și ecranul complet, la marginea din dreapta, și trece pe rândul următor doar împreună cu ele.
- Pe telefon, neschimbat: la capătul ultimului rând (FD-CHARTPOLISH §2).

### 9. Meniul lui „+” pe ecrane înguste
- **Ce era:** la 320 px, meniul („Linie orizontală la …”) începea la stânga graficului și era tăiat.
- **Acum:** meniul nu e niciodată mai lat decât zona graficului; textul trece pe două rânduri dacă nu încape.

### 10. Cazuri limită
| Situație | Comportament |
|---|---|
| Mouse pe iPad (trackpad) | ca mouse-ul: „+” urmează cursorul, iar hover-ul contează |
| Creion (Apple Pencil) | ca degetul: atingerea nu contează ca hover |
| Atingere pe „+” cu meniul deschis | meniul se închide (ca acum), „+” rămâne pentru următoarea atingere |
| Atingere în afara meniului, pe altă fereastră sau buton | meniul se închide, „+” și crucea dispar; butonul atins își face treaba |
| Esc cu meniul lui „+” deschis | se închide doar meniul (ca acum) |
| „Linie orizontală” blocată (limita de linii, nicio pereche) | meniul arată motivul; nimic nu se adaugă |
| Panou de setări cu tastatura de pe ecran deschisă (iPhone) | panoul stă deasupra tastaturii, cu butoanele de jos vizibile (FD-MODALFIT; înainte, doar dacă Safari micșora fereastra) |
| Panou de setări pe desktop | neschimbat (cât fereastra) |
| Căutare fără rezultate + Enter | nimic |
| Rezultate încă în curs + Enter | se deschide primul rezultat deja venit |
| ↓ după ultimul rezultat | revine la primul (și ↑ de la primul, la ultimul) |
| Text nou în căutare | alegerea se șterge (Enter = primul) |
| Eticheta LMA nu încape nici la stânga | rămâne la dreapta (tăiată), ca înainte |
| Ancora etichetei LMA în afara graficului (derulat spre dreapta) | nu se desenează, ca înainte |
| Eroare la încărcarea lumânărilor | „Încearcă din nou” în panoul de aceeași înălțime |
| Ecran complet + interval nou | panoul avea deja înălțimea ecranului complet; neschimbat |
| Serverul revine | bannerul dispare din ambele locuri |
| Bara la orice lățime între 320 și 1600 px, în și în afara ecranului complet | butonul listei niciodată singur pe un rând |

### 11. Conflicte cu ce exista
- **FD-CHARTPOLISH §2 (bara):** butonul listei face parte din grupul de butoane de la 768 px în sus; locul lui (marginea din dreapta) rămâne.
- **FD-HLINE §2 / FD-CHARTPOLISH §4 („+”):** pe ecran tactil, „+” și crucea dispar după închiderea meniului (înainte rămâneau). Cu mouse-ul, neschimbat.
- **FD-WATCHDRAWER, FD-CHARTUX (Esc):** Esc golește întâi căutarea din listă.
- **FD-SCROLLLOCK:** neschimbat (panoul de setări blochează în continuare pagina).
- **FD-ONLINE §3:** bannerul apare și în ecranul complet.

### 12. Retestat în Safari, după reparații (iPhone 17, iOS 27)
- Reluat după ce simulatoarele au fost oprite, cu un singur simulator pornit.
- Confirmat în Safari:
  - „+” ține pasul cu degetul: 0 px față de deget după fiecare mișcare (20 de mișcări);
  - o atingere în afara meniului lui „+” închide meniul și ia „+” și crucea;
  - meniul lui „+” e în zona graficului (80–320 px într-un grafic de 13–389 px);
  - panoul de setări (Slingshot, linia orizontală) are toată lățimea, iar „Salvează”, „Anulează” și „Șterge linia” sunt pe ecran;
  - „Indicatori” arată „Pe grafic”; „Ordin nou” și lista apar deasupra în ecranul complet;
  - căutarea: ↓ / ↑ aleg, Esc golește căutarea, iar ecranul complet și panoul rămân;
  - panoul graficului rămâne la 682 px în toate cele 37 de cadre cât se încarcă un simbol nou;
  - eticheta NEUTRAL a LMA e întreagă (trecută în stânga ancorei);
  - bannerul „nu răspunde” apare în ecranul complet și dispare când serverul revine.
- Apoi pe iPad Air 11" (iOS 27), după reparațiile §13–§18: în ecranul complet, butonul listei e pe rândul cu „Indicatori”, „Salvează” e pe ecran (1034–1078 din 1094 px), iar gesturile cu „+” se comportă ca pe iPhone.
- Găsite la retestare: §13, §14, §15 și §18.

### 13. Pe ecran tactil, apăsarea lungă nu mai mută prețurile
- **Ce era:**
  - apăsare lungă pe grafic (apar crucea și „+”), apoi tragere ca să alegi prețul;
  - crucea urma degetul, dar se mutau și prețurile, pe verticală (tragerea graficului din FD-CHARTTV §4), iar „A” se oprea;
  - prețul de sub deget se schimba deci chiar în timp ce îl alegeai.
- **Acum:**
  - după apăsarea lungă, tragerea mută doar crucea și „+”; prețurile stau, iar „A” rămâne cum era;
  - la fel cât timp crucea e încă pe ecran după o apăsare lungă: tragerea o mută pe ea (modul cruce, ca până acum).
- O tragere obișnuită, fără apăsare lungă și fără cruce pe ecran, mută graficul ca până acum, în ambele direcții.

### 14. Pe ecran tactil, după ce „+” dispare, graficul se derulează iar
- **Ce era:**
  - după „Linie orizontală la …”, sau după o atingere în afara meniului lui „+” (în afara graficului), crucea și „+” dispăreau;
  - graficul rămânea însă în modul cruce: următoarea glisare nu îl derula, ci aducea înapoi crucea și „+”, mutate cu degetul.
- **Acum:** odată cu „+”, graficul iese și din modul cruce. Următoarea glisare derulează graficul, iar crucea revine doar la o nouă apăsare lungă.

### 15. Scurtătura „⌥H” din meniul lui „+”, pe telefon
- Sub 768 px nu se mai arată, ca scurtăturile din bara de sus: pe un telefon nu e tastatură.
- Pe iPad și pe desktop rămâne.

### 16. Cazuri limită (§13–§15)
| Situație | Comportament |
|---|---|
| Apăsare lungă, tragere, ridicare, apoi altă tragere (crucea încă pe ecran) | se mută crucea, nu prețurile (modul cruce, ca până acum) |
| Apoi o atingere scurtă pe grafic | crucea și „+” dispar (ca până acum); următoarea tragere derulează graficul |
| Meniul lui „+” deschis, apoi o tragere pe grafic | meniul, „+” și crucea dispar; tragerea derulează graficul, în ambele direcții |
| Meniul lui „+” deschis, apoi o atingere pe un buton al paginii | meniul, „+” și crucea dispar; butonul își face treaba; următoarea glisare pe grafic derulează |
| Tragere fără apăsare lungă | ca până acum: graficul se mută în ambele direcții, iar „A” se oprește |
| Scala logaritmică, apăsare lungă și tragere | prețurile stau, iar „A” rămâne pornit |
| Doi degete (ciupire) | neschimbat (FD-CHARTTOUCH) |
| Apăsare lungă pe o linie orizontală, apoi tragere | se mută crucea; linia nu (pe ecran tactil liniile nu se trag, FD-HLINE) |
| Mouse, trackpad | neschimbat |
| Mouse pe grafic (iPad cu trackpad), apoi o tragere cu degetul | graficul se mută în ambele direcții (crucea mouse-ului nu e modul cruce) |
| iPad, sub sau peste 768 px | „⌥H” se vede de la 768 px în sus |

### 17. Conflicte (§13–§15)
- **FD-CHARTTV §4 (tragerea în ambele direcții):** nu și în modul cruce, pe ecran tactil.
- **FD-CHARTAUDIT §1:** când „+” dispare după o atingere, graficul iese și din modul cruce.
- **FD-CHARTTOUCH (ciupirea):** neschimbat.
- **FD-HLINE (scurtătura Alt+H):** tasta merge în continuare; doar indicația lipsește pe telefon.

### 18. Pe ecran tactil, o glisare care pornește de pe o linie orizontală nu-i mai deschide setările
- **Ce era:** o glisare spre stânga sau spre dreapta pornită chiar de pe o linie derula graficul, dar la ridicarea degetului se deschideau și setările liniei. Ca „mișcare” se număra doar deplasarea pe verticală.
- **Acum:** o mișcare de cel puțin 10 px în orice direcție înseamnă glisare: graficul se derulează, iar setările nu se deschid.
- O atingere scurtă pe linie îi deschide setările, ca până acum.
- **Cu mouse-ul sau creionul, neschimbat:** linia se trage doar în sus și în jos, iar un clic îi deschide setările.

| Situație | Comportament |
|---|---|
| Atingere scurtă pe linie (sub 10 px de mișcare) | setările liniei (ca până acum) |
| Glisare orizontală pornită de pe linie | graficul se derulează; setările nu se deschid |
| Glisare verticală pornită de pe linie | ca până acum: graficul se mută cum îl mută biblioteca, iar setările nu se deschid |
| Apăsare lungă pe linie, fără mișcare | setările liniei (ca până acum) |
| Mouse: clic pe linie, cu o mică mișcare laterală | setările liniei (ca până acum) |

## FD-MODALFIT — Ferestrele nu mai ies din ecran pe iPhone și iPad (20 oct 2026)
Cererea: „Nu ai rezolvat popupul de indicatori. Am deschis «Indicatori» pe grafic și iese în afara ecranului.”

### 1. Ce era
- Ferestrele aplicației își luau înălțimea din `vh`:
  - „Indicatori”, „Ordin nou” și celelalte ferestre de tip Modal: sus la 6 % din `vh`, cel mult 88 % din `vh`;
  - asistentul de conturi: la fel;
  - rezumatul zilei: cel mult 94 % din `vh`;
  - căutarea (⌘K): lista ei, cel mult 50 % din `vh`.
- Pe iPhone și iPad, `vh` e înălțimea ferestrei cu barele Safari ascunse, deci mai mare decât partea vizibilă când barele se văd. Cât de mare e diferența depinde de bara aleasă în Safari (compactă, jos, sus) și de poziția telefonului; culcat, e cea mai mare.
- Cu o listă lungă („Indicatori” → „Toți”, „Ordin nou” cu toate câmpurile), partea de jos a ferestrei ieșea din ecran și nu se mai putea ajunge la ea.
- **Tastatura de pe ecran** acoperea și ea partea de jos (ferestrele, panoul de setări al graficului, panoul listei de pe telefon), fără ca acestea să se strângă.
- Aceeași cauză ca la panoul de setări (FD-CHARTAUDIT §2). Acolo a fost reparată doar pentru panou; ferestrele n-au fost verificate cu lista lungă.

### 2. Acum
- **Orice fereastră** (Modal, asistentul de conturi, rezumatul zilei, căutarea) e cel mult cât partea vizibilă a ferestrei browserului, minus marginile ei. Ce nu încape se derulează în interiorul ferestrei, iar antetul (cu ✕) rămâne sus.
- **Cu tastatura de pe ecran deschisă:** ferestrele, panoul de setări al graficului și panoul listei de pe telefon stau deasupra tastaturii (în partea care se vede).
- Pe desktop nu se schimbă nimic (acolo partea vizibilă e toată fereastra).

### 3. Cazuri limită
| Situație | Comportament |
|---|---|
| iPhone culcat (înălțime mică) | fereastra ține de sub marginea de sus până la cea de jos; lista se derulează |
| Barele Safari apar / dispar | fereastra urmează partea vizibilă |
| Tastatura apare (căutarea din „Indicatori”, câmpurile din „Ordin nou”) | fereastra se strânge deasupra ei; câmpul în care scrii rămâne vizibil |
| Tastatura dispare | fereastra revine la înălțimea ei |
| Pagina mărită cu două degete | fereastra urmează partea mărită care se vede |
| Fereastră scurtă (puține rânduri) | neschimbată: cât conținutul, sus |
| Browser fără `visualViewport` | doar limita din CSS (partea vizibilă fără tastatură) |
| Ecranul complet „din pagină” (iPhone, iPad) | la fel, ferestrele sunt deasupra lui |
| Fereastra „Rezumatul nu a putut fi afișat” | neschimbată (două rânduri, fără câmpuri) |

### 4. Conflicte
- **FD-CHARTAUDIT §2 (panoul de setări):** rămâne de sus până jos; acum și deasupra tastaturii (cazul limită „panoul cu tastatura deschisă” din §10 nu mai depinde de Safari).
- **FD-WATCHDRAWER (panoul listei pe telefon):** la fel, deasupra tastaturii.
- **FD-SCROLLLOCK:** neschimbat.

## FD-SCOREWHY — „De ce acest scor?” în „Ce mișcă piața” (20 oct 2026)
Cererea: „Vreau să adaugi în «Azi» «de ce acest scor», ca la știri, și la «ce mișcă piața».” Dintre cele trei locuri propuse („Ce mișcă piața”, „Știri live”, „Sentimentul zilei”), a fost ales „Ce mișcă piața”.

### 1. Ce se vede
- Sub titlul fiecărei știri din „Ce mișcă piața” (cele două cele mai puternice în fiecare sens, sau toate cu „Arată toate”) apare **„De ce acest scor?”**, închis la început, ca pe pagina Știri.
- Deschis, arată aceleași rânduri ca pe pagina Știri:
  - **Motor:** modelul local + regulile, doar regulile, sau AI-ul tău („Gemini (gemini-3.8-flash)”), după cine a dat scorul;
  - **Model:** scorul modelului local, când există;
  - **Regulile** care s-au potrivit: „Regula «hack» pe «exchange hacked»: −0,6 (negată)”;
  - **Relevanța și importanța**, cu sursa importanței (AI-ul, cuvintele-cheie, sau amândouă când diferă).
- În plus, specific acestei liste: **„Cântărește 12% din indicele zilei”**, adică partea știrii din media ponderată din care iese indicele. Ponderea vine din relevanță, importanță, sursă, cât de recentă e știrea și câte surse au scris-o.
- Scorul afișat (de ex. +0,62) e cel din care s-a calculat indicele tău: al AI-ului tău unde a dat unul, altfel cel comun. Explicația e a aceluiași scor.

### 2. Cazuri limită
| Situație | Comportament |
|---|---|
| Știre scorată de AI-ul tău | „Motor: Gemini (…)”, fără model și reguli; importanța AI-ului |
| Știre scorată doar cu regulile (modelul local indisponibil) | „Motor: doar reguli”, regulile potrivite |
| Știre fără nicio regulă potrivită (doar modelul) | motorul și „Model: …”, fără rânduri de reguli |
| Importanța AI-ului diferă de cea din cuvinte-cheie | amândouă, ca pe pagina Știri |
| Știrea a dispărut între calcul și explicație (curățenia zilnică) | doar „Cântărește …” |
| Sub 0,5% din indicele zilei | „Cântărește sub 1% din indicele zilei” |
| Lista se reîmprospătează (la 60 s) cu explicația deschisă | rămâne deschisă cât timp știrea e în listă |
| „Arată toate” / „Mai puține” | fiecare știre are explicația ei; cele ascunse și reafișate pornesc închise |
| Telefon | rândurile explicației trec pe mai multe rânduri |
| Zilele trecute (istoricul) | neschimbate: explicația e doar pentru azi, calculată la cerere, nu salvată |

### 3. Conflicte
- **Pagina Știri:** aceeași explicație, din aceeași componentă; textul de acolo nu se schimbă.
- **FD-TODAYGRID:** tile-ul crește cu un rând mic pentru fiecare știre afișată.
- **Rezumatul zilei (AI):** primește driverii ca până acum, fără explicație.

## FD-INDEXWHY — „Cum s-a calculat?” la Sentimentul zilei (20 oct 2026)
Cererea: „În cardul Sentimentul zilei, sub cele patru carduri cu scorurile pe categorii, un link sau un buton care deschide un pop-up și explică cum s-a calculat sentimentul zilei, cu fiecare element luat în considerare și scorul care i s-a dat. Dacă sunt foarte multe știri, nu le afișa pe toate: «știrile au cântărit atât». Vreau să observ în timp ce trebuie ajustat: unde trebuie mai multă sau mai puțină importanță.”

### 1. Butonul
- Sub cele patru carduri (Crypto, Acțiuni, Macro, Geopolitică), în stânga: **„Cum s-a calculat?”**, în culoarea de accent. Pe același rând, în dreapta, rămâne „N știri încă în analiză”, când e cazul. *(Mutat pe rândul de titlu al cardului: FD-WHYPLAIN §2.)*
- Deschide o fereastră mare (ca „Indicatori”), cu datele de acum. Se închide cu ✕, Esc sau clic în afara ei.

### 2. Fereastra „Cum s-a calculat sentimentul zilei”
Antetul: indicele, eticheta, încrederea și ora calculului („azi, până la 16:40”). Indicele e cel al tău: din scorurile AI-ului tău unde a dat unul și cu filtrul tău pentru știrile de acțiuni, ca pe card.

**Pașii**, fiecare cu cifrele de azi:
1. **Știrile zilei** (de la 00:00, în fusul tău, până acum):
   - câte intră în calcul: pozitive (peste +0,2), neutre, negative (sub −0,2);
   - câte nu țin de piețe (relevanță 0): nu intră;
   - câte nu au încă scor: intră când primesc unul.
2. **Ponderea fiecărei știri** = relevanță × importanță × greutatea sursei × factor × prospețime × poveste (× plafonul sursei), cu regula fiecărui termen:
   - **relevanța:** 1 pentru crypto; 1 pentru acțiuni și macro cu termeni de piață, altfel 0,8; 0,8 pentru geopolitica legată de piețe, altfel 0;
   - **importanța** 1–3: a AI-ului, unde a dat una; altfel din cuvinte-cheie (3: Fed, dobânzi, inflație, război, tarife, hack, faliment…; 2: ETF, randamente, dolar, BTC / ETH…; 1,5: alte monede din top 10; 1: restul);
   - **greutatea sursei**, aleasă în Setări → Admin → Surse;
   - **factorul:** sponsorizat 0,2; speculativ sau rezumat 0,5; altfel 1;
   - **prospețimea:** se înjumătățește la fiecare 8 ore;
   - **povestea:** o știre preluată de n surse cântărește, toate la un loc, 1 + 0,5 · log₂ n, împărțit între ele;
   - **plafonul sursei:** cu cel puțin 4 surse, niciuna nu trece de 25 % din total; se spune la care s-a aplicat azi.
3. **Media ponderată a scorurilor:** Σ(pondere × scor) ÷ Σ pondere, cu valorile de azi.
4. **Spre neutru când sunt puține știri:** media × Σ pondere ÷ (Σ pondere + 4).
5. **Pe scala 0–100:** 50 + 50 · tanh(1,6 × rezultatul de la pasul 4), rotunjit la o zecimală, adică indicele.
6. **Încrederea:** din Σ pondere (sub 3 mică, sub 10 medie, altfel mare).

**Pe categorii:** pentru fiecare categorie, câte știri, Σ pondere, media și indicele. Fiecare se calculează la fel, doar din știrile ei.

**Pe surse:** fiecare sursă cu știri azi: câte știri, greutatea ei (cea din Setări → Admin → Surse), ponderea știrilor ei înainte și după plafon (cea tăiată e marcată) și partea ei din total. O sursă tăiată poate avea, după plafon, o parte mai mare decât înainte: totalul a scăzut și el; de aceea se arată ponderile, nu doar procentele.

**Știrile**, de la cea care a cântărit cel mai mult:
- scorul (colorat), titlul (legătură spre articol), sursa, categoria, ora;
- termenii ponderii cu valorile lor („relevanță 1 × importanță 2 (cuvinte-cheie) × sursă 1,2 × prospețime 0,84 × poveste 0,61 (3 surse)”), ponderea, partea din total și **contribuția** la medie (pondere × scor ÷ Σ pondere; suma contribuțiilor e media de la pasul 3);
- „De ce acest scor?” (FD-SCOREWHY): motorul, modelul, regulile;
- primele 20, apoi „Arată încă 20”, până la 100;
- **celelalte**, într-un singur rând: „Celelalte 160 de știri: 31 % din pondere, contribuție +0,05 la medie.”

**Parametrii** (la final): toate constantele de mai sus într-un loc, cu ce se poate schimba azi din aplicație (greutatea surselor) și ce ține de cod (restul).

### 3. Cazuri limită
| Situație | Comportament |
|---|---|
| Nicio știre azi | pașii cu zero; indicele 50, încredere mică; lista goală („Încă nu sunt știri analizate azi.”) |
| Doar știri fără scor | la fel, cu „N încă fără scor” |
| Sub 4 surse | „Plafonul nu se aplică (sub 4 surse).” |
| Plafonul nu atinge nicio sursă | „Nicio sursă nu a trecut de 25 %.” |
| O știre cu pondere 0 (de ex. sursa la 0) | în listă, la sfârșit, cu pondere 0; fără „plafon” (nu a fost tăiată) |
| Știrea a dispărut între calcul și explicație | rândul ei, fără „De ce acest scor?” |
| Scor 0 (neutru) | intră cu ponderea ei: trage media spre 0; contribuția 0 |
| Peste 100 de știri | primele 100 în listă; restul în rândul „Celelalte” |
| AI-ul tău a notat știrea | scorul și importanța lui; „(AI)” la importanță |
| Filtrul de acțiuni pe indici | doar știrile lui, ca la indice |
| Indicele de pe card s-a schimbat între timp (la 60 s) | fereastra arată ora calculului ei; „Recalculează” o reface |
| Zi cu schimbarea orei (25 sau 23 de ore) | ziua în fusul tău, ca la indice |
| Telefon | rândurile trec pe mai multe rânduri; fereastra încape (FD-MODALFIT) |
| Eroare la încărcare | mesajul și „Încearcă din nou” |

### 4. Conflicte
- **FD-SCOREWHY:** aceeași explicație a scorului, în fiecare rând.
- **FD-TODAYGRID:** cardul crește cu un rând (butonul).
- Nimic din calcul nu se schimbă: fereastra doar îl arată. Aceleași funcții calculează indicele și explicația, deci cifrele nu pot fi diferite.

## FD-WHYPLAIN — Explicații pe înțeles: cât mută o știre indicele, și de ce (20 oct 2026)
Cererea, după ce a văzut explicațiile pe datele reale: „Toate știrile de la «Ce mișcă piața» au acest text: «Motor: Claude… Cântărește sub 1% din indicele zilei.» De ce? Ce înseamnă sub 1%? De ce au fost alese aceste 10? Eu vreau o explicație; ce mi-ai dat nu înseamnă nimic.” Apoi: „Da (efectul în puncte, rezumatul în cuvinte, motivul cerut lui Claude), și mută «Cum s-a calculat?» pe eyebrow-ul «Sentimentul zilei».”

Pe datele reale din 20 oct: 1.147 de știri azi, din care 937 neutre (82 %); o știre obișnuită are 0,09 % din pondere; cele din „Ce mișcă piața” 0,2–0,4 %, adică fiecare mută indicele cu 0,1–0,2 puncte; Investing.com a dat 393 de știri și e tăiată la 25 %.

### 1. „Ce mișcă piața”
- **Sub titlu, de ce sunt acolo:** „Din cele N știri de azi: cele care au împins indicele cel mai mult în sus și cele care l-au tras cel mai mult în jos (pondere × scor).”
- **La fiecare știre, mereu vizibil, efectul ei:** „Fără ea, indicele ar fi 47.8 (acum 47.9): +0,10 puncte.” (indicele scris ca pe card) Calculat refăcând indicele fără știrea aceea (cu plafonul, cu apropierea de neutru), deci exact cât a mutat-o.
- **„De ce acest scor?”** (închis la început): motorul, regulile (la modelul local), relevanța și importanța, ca până acum, plus **de ce cântărește cât cântărește**, în cuvinte: „Cântărește de 4,4 ori cât o știre obișnuită de azi: importanță 3 (Claude), sursa CoinDesk are greutatea 1,2, e de acum 4 h (mai contează 68 %).” Plus, când e cazul: „relevanță 0,8”, „preluată de 2 surse (contează o dată)”, „factor 0,5 (speculativ)”, „sursa ei a fost tăiată de plafon”.
- Rândul „Cântărește sub 1% din indicele zilei” dispare.

### 2. „Cum s-a calculat?”
- **Titlul cardului, „Sentimentul zilei”, e legătura** care deschide fereastra: subliniat punctat (se vede că e legătură și pe ecran tactil), în culoarea de accent la hover, cu „Cum s-a calculat sentimentul zilei” ca indicație. Nu mai e niciun buton separat, nici sub categorii, nici pe rând. *(Prima variantă punea un buton „Cum s-a calculat?” pe rândul de titlu: cererea era ca titlul însuși să fie legătura.)*
- **Funcție premium:** după titlul ferestrei, insigna PREMIUM (aceeași ca la Slingshot și LMA). Deocamdată e doar insigna: Sentiq nu are încă plăți sau acces premium, deci fereastra se deschide pentru oricine.
- **Sus, „Pe scurt”, în cuvinte**, cu cifrele de azi:
  - câte știri intră și câte sunt pozitive, neutre (cu procentul) și negative;
  - când neutrele sunt peste jumătate: „Neutrele trag media spre 0, deci indicele spre 50.”;
  - cât cântărește o știre obișnuită și cât cea mai grea; care știre a mutat singură cel mai mult indicele și cu câte puncte (dintre cele 100 mai grele, când sunt mai multe);
  - de la ce sursă vin cele mai multe știri, partea ei și dacă a fost tăiată de plafon;
  - media ponderată și indicele care iese din ea.
- **La fiecare știre din listă:** „fără ea: 47,8 (+0,10 puncte)”, lângă partea din total.
- Restul (pașii, categoriile, sursele, parametrii) neschimbat.

### 3. Motivul scorului, de la Claude (AI-ul utilizatorului)
- La fiecare titlu notat, AI-ul dă și **un motiv scurt, în română** (cel mult o propoziție, ~120 de caractere), lângă scor și importanță.
- Se păstrează cu scorul (al acelui utilizator) și apare primul în „De ce acest scor?”: „Motivul (Claude): Fluxuri record în ETF-ul BlackRock: cerere instituțională.”
- Doar pentru știrile notate de acum înainte; cele notate înainte nu au motiv (rândul lipsește).
- **Costul:** ~30 de tokeni de răspuns în plus pe știre, pe cheia utilizatorului; se văd ca până acum la „Ce a consumat cheia ta azi”.
- **Pornire:** cere o coloană nouă în bază (migrarea 6), deci ajunge doar odată cu deploy-ul. Codul de pe Azure nu pornește pe o bază mai nouă decât el, așa că nu se pornește local pe baza reală înainte.

### 4. Cazuri limită
| Situație | Comportament |
|---|---|
| O singură știre azi | „Fără ea, indicele ar fi 50,0” (fără știri, neutru) |
| Efectul sub 0,005 puncte | „+0,00 puncte”: practic nu a mutat indicele |
| Știre dintr-o sursă tăiată de plafon (azi: Investing.com, 393 de știri) | „Sursa ei e tăiată de plafon, deci fiecare știre a ei cântărește cu X % mai puțin.” Efectul o spune pe rândul lui: de obicei aproape 0 (fără ea, sursa tot ar avea 25 %, ponderea se împarte între celelalte știri ale ei); mare doar când sursa e chiar la limită și fără știre coboară sub plafon |
| Efect cu semn opus scorului (rar: plafonul sursei redistribuie ponderea) | se arată cum e, e efectul real |
| Știre veche (de 12 h) | „mai contează 35 %” |
| Neutrele sub jumătate | fără rândul despre neutre |
| Nicio știre | „Pe scurt” spune doar că nu sunt știri |
| AI-ul nu dă un motiv pentru un titlu, sau îl dă gol | fără rândul „Motivul” |
| Motiv prea lung | tăiat la 160 de caractere |
| Știre notată de modelul local | regulile, ca până acum (motivul e doar al AI-ului) |
| Alt AI (ChatGPT, Gemini) | la fel: „Motivul (ChatGPT): …” |

### 5. Conflicte
- **FD-SCOREWHY:** „Cântărește X%” e înlocuit de efectul în puncte și de explicația ponderii.
- **FD-INDEXWHY §1:** butonul se mută pe rândul de titlu.
- **FD-AIKEYS (scorarea cu AI-ul utilizatorului):** cererea și răspunsul au un câmp în plus; restul neschimbat.

## FD-HISTORYCHART — „Ultimele 30 de zile”: graficul pe toată înălțimea și comparația cu Fear & Greed (20 oct 2026)
Cererea: „Acum că s-a înălțat panoul «Ce mișcă piața», panoul «Ultimele 30 de zile» e trei sferturi gol. Ce am putea pune acolo?” Din propuneri a ales: (1) graficul pe toată înălțimea, cu scara mărită și valoarea la hover; (2) comparația cu Fear & Greed crypto și CNN Fear & Greed (acțiuni), pe aceleași 30 de zile.

Ce era: bare de la linia de 50 în sus sau în jos, pe o scară 0–100. Zilele reale (47–49) dădeau bare de 1–2 px, abia vizibile („liniuțe”), într-un panou cu trei sferturi gol.

### 1. Graficul
- Ocupă toată înălțimea panoului (cât îi dă rândul, lângă „Ce mișcă piața”), cel puțin 160 px.
- O coloană pe zi, 30 de zile, cea mai veche în stânga, azi în dreapta, în fusul utilizatorului (ca acum). O zi fără valoare rămâne goală (linia se întrerupe).
- **Trei linii, pe aceeași scară 0–100** (toate trei sunt indici 0–100, deci se pot compara direct):
  - **Sentiq** (accentul aplicației, mai groasă, cu puncte; ziua de azi și zilele încă provizorii cu punct gol);
  - **Fear & Greed crypto** (alternative.me), albastru;
  - **Stocks F&G**, adică CNN Fear & Greed, gri punctat. E doar al bursei americane (S&P 500, maximele / minimele de la NYSE, VIX, put / call, junk bonds, active-refugiu), nu global; legenda spune sursa la hover. Doar zilele de bursă, între ele linia continuă (weekendul nu e o pauză a datelor).
- **Scara se mărește** pe liniile afișate: de la puțin sub cea mai mică valoare la puțin peste cea mai mare (o zecime din interval, cel puțin un punct), cu 50 mereu inclus și marcat (linie punctată), cel puțin 4 puncte între capete. Etichetele scării (sus, 50, jos) stau într-o margine în dreapta, departe de linii. Cu toate trei, scara cuprinde și Fear & Greed (de obicei mai larg); cu doar Sentiq (de ex. 47–52 → scara 45–53), se văd și zecimile.
- **Legenda**, sus, butoane cu culoarea, numele și valoarea de azi: „Sentiq 48.3”, „Crypto F&G 34”, „Stocks F&G 52” (la hover, sursa fiecăreia). Un clic ascunde sau arată linia, iar scara se reface. Ultima linie rămasă nu se poate ascunde.
- **Cursor sau atingere pe o zi:** linie verticală și o etichetă cu data și valorile zilei: „azi, 20 oct. · Sentiq 48.3 (provizoriu) · 1.209 știri · Crypto F&G 34, frică · CNN F&G 52, neutru”. Cu mouse-ul dispare când cursorul pleacă; pe ecran tactil rămâne până la următoarea atingere pe grafic (glisarea cu degetul trece prin zile, iar derularea paginii în sus și în jos merge mai departe).
- **Azi** e indicele live, ca pe card (provizoriu): istoricul îl are doar de la ultima salvare, care poate fi încă a zilei de ieri.
- **Datele** sub grafic: prima zi, mijlocul și „azi”.

### 2. Cazuri limită
| Situație | Comportament |
|---|---|
| Sentiq are sub 2 zile (instalare nouă) | Fear & Greed se văd pe toate 30 de zile; nota „Istoricul se construiește zi de zi” rămâne pentru Sentiq |
| Contextul pieței lipsește sau nu s-a putut încărca | doar Sentiq; legenda nu arată Fear & Greed |
| Unul dintre Fear & Greed lipsește | doar celălalt |
| Valorile Fear & Greed mai vechi de 30 de zile | nu intră |
| Fear & Greed crypto (o valoare pe zi, ora 00:00 UTC) | ziua lui e data UTC a valorii |
| CNN (zile de bursă, ora New York) | ziua lui e data din New York |
| O singură valoare pe o linie | un punct, fără linie |
| Toate valorile egale | scara tot cuprinde 50 și o margine |
| Telefon | graficul pe lățimea panoului; eticheta zilei se mută spre stânga lângă marginea din dreapta, ca să nu iasă din panou |
| Teme (deschisă / închisă) | culorile din temă |
| Cititor de ecran | rezumatul: „Sentiq în ultimele 30 de zile, între X și Y, azi Z; Fear & Greed crypto azi …; CNN azi …” |

### 3. Conflicte
- **FD-TODAYGRID:** panoul păstrează locul (lângă „Ce mișcă piața”); doar conținutul se schimbă.
- **Banda de sus (FD-SENTIQ):** arată aceleași Fear & Greed; folosesc aceeași interogare, deci nicio cerere în plus.

## FD-MULTICAT — Surse de știri cu mai multe categorii („General”) (20 oct 2026)
Cererea: „Vreau să pot adăuga un news feed în categoria General: General înseamnă că oferă informații din toate cele 4 categorii. Sau să mă lași să aleg mai multe categorii. De exemplu, benzinga.com dă știri din toate cele 4 categorii.”

### 1. Ce era
- Fiecare sursă avea o singură categorie (Crypto, Acțiuni, Macro, Geopolitică), iar toate știrile ei o primeau pe aceea, oricare ar fi fost subiectul.
- Un feed general (Benzinga, Reuters Business…) trebuia pus într-una singură. Știrile lui despre Bitcoin intrau atunci, de exemplu, la Acțiuni: categoria greșită pe pagina Știri, la filtre și în indicele pe categorii, cu relevanța acelei categorii.

### 2. Acum
- **Setări → Admin → Surse, la adăugare:** „Categorii”, cu patru butoane (Crypto, Acțiuni, Macro, Geopolitică), oricâte alese, cel puțin unul, plus **„Toate (general)”**, care le alege pe toate patru.
- **O sursă cu o singură categorie:** ca până acum.
- **O sursă cu mai multe categorii:** fiecare știre a ei primește, la aducere, **categoria pe care o tratează, dintre cele alese pentru sursă**, după:
  - monedele crypto numite (Bitcoin, ETH…) → Crypto;
  - companiile și acțiunile numite (Apple, „$TSLA”, „(NYSE: F)”), indicii bursieri → Acțiuni;
  - cuvintele subiectului: crypto (blockchain, stablecoin, token…), acțiuni (shares, earnings, IPO, S&P 500, Nasdaq…), macro (Fed, inflație, dobânzi, PIB, randamente, dolar, tarife…), geopolitică (război, sancțiuni, rachete, alegeri, NATO…).
  - Câștigă categoria cu cele mai multe semne. La egalitate, ordinea e Crypto, Acțiuni, Macro, Geopolitică.
- **O știre fără niciun semn al categoriilor alese** (de ex. „Cele mai bune carduri de credit” într-un feed general) intră la prima categorie a sursei, dar cu relevanță 0: apare în listă cu „relevanță scăzută” și nu intră în indice.
- Relevanța, importanța și restul calculului se fac apoi exact ca la o sursă din acea categorie (de ex. geopolitica fără legătură cu piețele are relevanța 0, ca la BBC World).
- **În tabel**, coloana „Categorie” arată „General” pentru toate patru, altfel „Crypto + Acțiuni”.
- **La sursele adăugate de tine, categoriile se pot schimba din tabel** („Schimbă”, aceleași patru butoane, „Salvează” / „Anulează”). La salvare, știrile păstrate ale sursei se reclasează după noile categorii. Sursele implicite rămân cum sunt (ca până acum: doar activarea și ponderea).

### 3. Cazuri limită
| Situație | Comportament |
|---|---|
| Niciun buton ales | „Adaugă sursa” nu merge; mesaj: „Alege cel puțin o categorie” |
| Un singur buton ales | sursă obișnuită, ca până acum |
| „Toate (general)” apăsat cu toate alese | le deselectează pe toate (nu poți adăuga până nu alegi) |
| Știre cu Bitcoin și Fed („Bitcoin scade după decizia Fed”) | Crypto: moneda numită contează mai mult |
| Știre despre Apple și dobânzi | categoria cu mai multe semne; la egalitate Acțiuni înaintea Macro |
| Știre despre tarife | Macro (tarifele sunt și macro, și geopolitică; la egalitate Macro) |
| Sursă doar Crypto + Acțiuni, știre despre Fed | nu are semne Crypto / Acțiuni: Crypto (prima), relevanța 0 |
| Titlul unei știri se schimbă la sursă | scorul se reface, ca acum, și categoria se alege din nou |
| Reetichetarea zilnică a știrilor recente (lista de monede s-a schimbat) | la sursele cu mai multe categorii, categoria se alege din nou, cu aceleași reguli |
| Categoriile unei surse schimbate din tabel | toate știrile ei păstrate se reclasează; indicele de azi se reface singur; zilele trecute înghețate rămân cum au fost |
| Feed-uri automate ale acțiunilor (Nasdaq: AAPL) | neschimbate (Acțiuni) |
| Filtrul „Știrile despre acțiuni pe indici” (FD-INDEXNEWS) | se aplică știrilor cu categoria Acțiuni, oricare ar fi sursa |
| Pagina Știri, filtrul „Categorie” | după categoria fiecărei știri (o sursă generală apare la fiecare categorie, cu știrile ei de acolo) |

### 4. Conflicte
- **FD-INDEXNEWS, FD-AUTOFEED:** neschimbate (lucrează pe categoria știrii).
- **Schimbarea categoriei unei surse (API-ul existent):** până acum rescria doar categoria știrilor, nu și relevanța lor (care depinde de categorie). Acum le reclasează complet.
- **Migrarea 7** (coloana `categories` a surselor): ajunge pe baza reală odată cu deploy-ul, împreună cu migrarea 6.

## FD-HTMLFEED — Știri de pe site-uri fără RSS (20 oct 2026)
Cererea: „Există servicii care generează RSS din adresele care nu au RSS și vor abonament, ceea ce mi se pare ridicol: putem construi noi același lucru. Pentru site-urile fără RSS, construiește un feed pentru acea adresă, sau citește direct conținutul site-ului, dacă se poate. Vreau să-ți dau un site și să prind știrile de pe el, chiar dacă n-are RSS. Sunt site-uri foarte importante fără RSS.”

### 1. Ce s-a verificat pe site-uri reale (20 oct)
- **Reuters:** paginile întorc 401 (protecție anti-bot). Sitemap-ul de știri ar merge tehnic (cele mai noi 50 de articole, cu titlul și ora exactă), dar `robots.txt` îl interzice: „Block all other bots: `User-agent: *` → `Disallow: /`”, iar termenii lor interzic colectarea automată fără acord scris. **Sentiq nu-l citește.**
- **AP News:** paginile și sitemap-ul de știri sunt în spatele provocării Cloudflare („Just a moment…”): nu se pot citi automat.
- **CNBC Markets:** pagina se citește: 59 de titluri, cu data luată din adresă (`/2026/10/20/…`).
- **CoinDesk Markets:** pagina se citește: 27 de titluri, cu ora exactă din `<time>` de lângă fiecare.
- **Benzinga:** pagina de Markets întoarce 403, dar Benzinga are RSS (`https://www.benzinga.com/feed`), care se citește normal.

### 2. Cum citește Sentiq o adresă
Se dă adresa paginii (de ex. `https://www.reuters.com/markets/`), exact ca un feed. Sentiq încearcă, în ordine:
1. **E un feed RSS / Atom:** ca până acum.
2. **Pagina declară un feed** (`<link rel="alternate" type="application/rss+xml">`): se citește feed-ul acela.
3. **Pagina are JSON-LD** cu articole (titlu, adresă, dată): se citesc acelea.
4. **Titlurile din pagină:** legăturile spre articole ale aceluiași site, cu text de titlu (cel puțin 4 cuvinte, 20–220 de caractere), din titluri sau carduri. Meniurile, antetul, subsolul și casetele laterale nu contează. Data vine din `<time>`-ul cardului știrii, altfel din adresă; dacă lipsesc amândouă, știrea nu are dată.
5. **Sitemap-ul de știri al site-ului** (din `robots.txt`): când pagina e blocată (401, 403, 429, provocare anti-bot) sau are prea puține titluri (sub 3). Dacă adresa dată avea o secțiune (`/markets/`), se păstrează doar articolele din ea.
- **Înainte de orice citire a unei pagini sau a unui sitemap, `robots.txt`:** o adresă interzisă cititorilor obișnuiți (`User-agent: *`) nu se citește deloc. Exemplu: „Reuters interzice cititorii automați (robots.txt: Disallow / pentru toți, în afara celor aprobați).”

**„Testează”** spune ce a găsit și cum: „Citită din sitemap-ul de știri al site-ului (secțiunea /markets/): 18 știri, toate cu oră. Ultimele: …”. Dacă nu merge nimic: „Site-ul blochează cititorii automați (HTTP 403 / Cloudflare) și nu are un sitemap de știri care să se poată citi.”

**La adăugare**, Sentiq ține minte modul găsit și îl folosește la fiecare citire. Coloana „Stare” din tabel îl arată sub numărul de știri: „titlurile din pagină”, „sitemap-ul de știri”, „feed găsit în pagină”, „datele structurate ale paginii” (la feed-urile RSS, nimic, ca până acum).
- După o schimbare a adresei în formular, rezultatul testului de dinainte dispare (era al adresei vechi).

### 3. Știrile fără dată
- O pagină poate avea titluri fără nicio dată. La prima citire nu se știe cât de vechi sunt, așa că nu intră ca știri noi: Sentiq le notează ca „văzute” și nu le adaugă (altfel 50 de titluri vechi ar intra toate ca știri „de acum” și ar strica indicele zilei).
- De la a doua citire, un titlu fără dată apărut între timp e nou: intră cu ora la care a fost văzut.
- Un titlu cu dată mai veche de 3 zile nu intră, ca la feed-uri (de ex. linkurile vechi rămase pe pagină).
- **Data doar din adresă** (`/2026/10/20/…`, doar ziua): la prima citire, ora 12:00 UTC a acelei zile (sau acum, dacă e mai devreme). După aceea, o știre nouă de azi intră cu ora la care a fost văzută (altfel o știre de seară ar fi cântărit ca una de prânz).

### 4. Ritmul și politețea
- **Paginile și sitemap-urile** se citesc o dată la 10 minute (feed-urile, ca până acum, la 5).
- Se respectă `robots.txt` (grupul `User-agent: *`), la pagină și la sitemap: ce e interzis nu se citește, oricât de important ar fi site-ul. Feed-urile RSS (făcute anume pentru cititori automați) se citesc ca până acum.
- `robots.txt` care nu există (404) = totul permis; `robots.txt` cu eroare de server (5xx) sau fără răspuns = nu se citește acum, se reîncearcă mai târziu (ca Google).
- Sentiq nu ocolește protecțiile anti-bot (Cloudflare, provocări JavaScript, autentificare): ce nu se citește așa, nu se citește.
- Doar adrese ale aceluiași site: un feed sau un sitemap declarat spre alt site (sau spre o adresă internă) nu se urmează.

### 5. Cazuri limită
| Situație | Comportament |
|---|---|
| Pagina e un feed RSS | ca până acum („feed RSS”) |
| `robots.txt` interzice pagina, dar permite sitemap-ul | se citește sitemap-ul (dacă are știri) |
| `robots.txt` interzice tot (Reuters) | nu se adaugă: „Site-ul interzice cititorii automați” |
| Pagina declară mai multe feed-uri | primul care se citește |
| Site construit doar în JavaScript (pagina goală fără browser) | „Pagina nu are titluri care să se poată citi fără browser”; se încearcă sitemap-ul |
| Sitemap index | se citește sitemap-ul cel mai recent din index |
| Sitemap fără titluri (sitemap obișnuit, nu de știri) | nu se folosește |
| Secțiunea dată nu are articole în sitemap | „Sitemap-ul are N știri, dar niciuna din /secțiune/” |
| Pagina se schimbă (alt design) și nu mai are titluri | eroare în tabel, ca la un feed stricat; „Testează” spune de ce |
| Același articol pe două surse | o singură dată (după adresă), ca acum |
| Același titlu la două adrese în aceeași pagină (variante, parametri de urmărire) | o singură dată, prima |
| Pagina redirecționează | se urmează redirecționarea, ca la feed-uri |
| Titlu fără dată la prima citire | notat ca văzut, neadăugat |
| Un link vechi rămas pe pagină, cu data în adresă | nu intră (peste 3 zile) |
| Pagină foarte mare | cel mult 5 MB, ca la feed-uri |
| Categoriile | ca la orice sursă (FD-MULTICAT) |

### 6. Conflicte
- **Feed-urile existente:** neschimbate (modul lor e „feed RSS”).
- **FD-MULTICAT:** o sursă de pagină poate avea mai multe categorii.
- **Migrarea 8** (modul și adresa citită ale unei surse): ajunge pe baza reală odată cu deploy-ul, împreună cu 6 și 7.

## FD-AIQUOTA — Erorile de credit și de limită ale AI-ului, spuse exact (20 oct 2026)
Cererea: celălalt utilizator primea „contul Google nu mai are credit sau a atins limita planului” cu o cheie nouă, făcută pe un abonament plătit. Sentiq nu păstra textul primit de la Google, așa că nu se putea spune ce limită era. În jurnal s-a văzut, o singură dată, `402: Your prepayment credits are depleted` (soldul Prepay al proiectului era 0), apoi doar mesajul general. „Implementează partea noastră”: textul exact al furnizorului, un mesaj clar pentru soldul Prepay și o pauză care rămâne valabilă după o repornire.

Ce spune Google (documentația Gemini API, 20 oct):
- Limitele sunt **ale proiectului, nu ale cheii**; cele zilnice se resetează la miezul nopții ora Pacificului.
- Cu facturarea Prepay, API-ul răspunde doar cât soldul e peste 0; altfel întoarce 402.
- Creditele Cloud (inclusiv cele primite cu un abonament) se folosesc doar după ce există credit Prepay cumpărat.

### 1. Ce se vede
Avertismentul din Setări → Ale mele → Inteligență artificială (sub alegerea scorului) spune acum exact ce s-a întâmplat, când Google o spune:

| Ce răspunde Google | Mesajul |
|---|---|
| 402, sau „prepayment credits are depleted” | creditul preplătit (Prepay) al proiectului Google al cheii e epuizat: adaugă credit în AI Studio, la Billing. Creditele primite cu abonamentul se folosesc doar cât soldul Prepay e peste 0 |
| 429, limita zilnică a nivelului gratuit (N cereri) | cheia e pe nivelul gratuit Google și a atins limita lui zilnică: N cereri pe zi pentru `model`. Limita e a proiectului Google, nu a cheii: o cheie nouă din același proiect nu ajută. Pentru mai mult, proiectul cheii trebuie legat de facturare (AI Studio, la Billing) |
| 429, limita 0 pe nivelul gratuit | modelul `model` nu e inclus în nivelul gratuit Google: cheia trebuie să fie dintr-un proiect cu facturare (AI Studio, la Billing) |
| 429, limita zilnică a unui nivel plătit | proiectul Google al cheii a atins limita zilnică a nivelului său: N cereri pe zi pentru `model`. Limita e a proiectului, nu a cheii |
| 429, limita 0 pe un nivel plătit | proiectul Google al cheii are limita 0 pentru `model`: modelul nu e disponibil pe nivelul proiectului (vezi AI Studio, la Rate limits) |
| altceva (OpenAI, Anthropic, o limită pe care Google nu o descrie) | ca până acum: „contul … nu mai are credit sau a atins limita planului” |

- **La limitele zilnice:** „Google resetează limita pe 21 oct., 10:00.” Ora e miezul nopții ora Pacificului, arătat în fusul orar din Setări. Propoziția nu apare după ce ora a trecut, nici la limita 0 (aceea nu se resetează).
- **Textul exact al furnizorului, sub mesaj:** „Răspunsul Google: „You exceeded your current quota … limit: 20, model: …””, cel mult 600 de caractere. Apare la erorile de credit sau limită și la cele de cereri pe minut, la orice furnizor (Anthropic, OpenAI, Google). La celelalte erori, textul furnizorului e deja în mesaj (permisiune, cerere respinsă, conexiune, altă eroare) sau nu spune nimic în plus (cheie invalidă, model inexistent, supraîncărcare, timp depășit).
- **Jurnalul serverului:** același mesaj, plus textul furnizorului.
- **Rezumatul zilei:** aceeași eroare are mesajul precis; jurnalul are și textul furnizorului.

### 2. Pauza
- Duratele rămân ca până acum: credit sau limită → 30 de minute; eroare trecătoare → 5 minute; cheie refuzată → până se schimbă cheia sau modelul.
- **Nou: pauza și eroarea rămân valabile după o repornire** a aplicației (deploy, repornire Azure). Nu se mai trimite o cerere imediat după pornire dacă furnizorul tocmai refuzase.
- **Bug reparat:** după o repornire, eroarea veche rămânea afișată și după ce scorarea mergea din nou, până la următoarea eroare. Acum dispare la primul răspuns bun.
- **Reîncercare imediată:** pauza se șterge când utilizatorul salvează cheia furnizorului ales (chiar aceeași) sau schimbă alegerea AI (furnizor, model, scorul pornit sau oprit). Următoarea rulare, în câteva secunde, încearcă din nou. Așa se poate reîncerca imediat după ce s-a rezolvat facturarea la Google, fără 30 de minute de așteptare. Merge și când pagina e servită de o altă instanță decât cea care rulează joburile (Mac / Azure).

### 3. Cazuri limită
| Situație | Comportament |
|---|---|
| 429 cu mai multe încălcări (pe minut și pe zi) | contează cea zilnică; dacă vreuna are limita 0, contează limita 0 |
| 429 doar pe minut | „limită de cereri Google atinsă”, ca acum (trecătoare: reîncercări după câteva secunde, apoi pauză de 5 minute), cu textul Google dedesubt |
| Limita zilnică fără număr în răspuns | mesajul fără număr („limita zilnică a nivelului gratuit”) |
| Răspunsul nu numește modelul | modelul cerut |
| Răspuns doar cu text, fără `details` | se citește din rândurile „Quota exceeded for metric: …, limit: N, model: …”; o metrică `…_per_day` e limita zilnică (pauză de 30 de minute, nu de 5) |
| Textul furnizorului conține ceva ce seamănă cu o cheie (`sk-…`, `AIza…`) | înlocuit cu „…” înainte de afișare și de jurnal, inclusiv în mesajele care conțin textul furnizorului (permisiune, cerere respinsă, conexiune, altă eroare) |
| Text foarte lung sau pe mai multe rânduri | spațiile adunate, tăiat la 600 de caractere |
| Stare salvată de versiunea veche (fără text, fără ora de resetare) | se afișează ca înainte |
| Cheie refuzată definitiv, apoi repornire | rămâne oprită (nu se trimite nimic) până se schimbă sau se salvează din nou cheia ori alegerea AI |
| Pauza a expirat cât aplicația era oprită | după pornire se încearcă imediat; eroarea veche rămâne afișată până la primul răspuns |
| Starea nu s-a putut salva (baza nu răspunde) | după o repornire, prima rulare încearcă imediat, ca până acum |
| Salvarea cheii cade exact în timpul unei încercări care eșuează | contează eșecul (pauză nouă); următoarea salvare reîncearcă |
| Pe telefon, adrese lungi în textul Google | textul se rupe pe rânduri, fără depășire orizontală |
| Cheie nouă, alt proiect Google | stare nouă, ca până acum (starea e a furnizorului, modelului și cheii) |

### 4. Conflicte
- **FD-AIKEYS** (pauza; starea văzută de ambele instanțe): starea primește două câmpuri opționale (textul furnizorului și ora de resetare); o stare veche fără ele merge.
- **FD-AICLARITY** (consumul de azi): neschimbat. Cererile refuzate nu au tokeni și nu se numără.
- **Verificarea cheii la salvare** (lista de modele, gratuită): o cheie fără credit trece de obicei verificarea, iar eroarea apare la primul scor. Dacă Google refuză și lista (402), cheia se salvează cu avertismentul precis („…nu a putut fi verificată acum (creditul preplătit (Prepay) … e epuizat …)”), nu cu „eroare Google 402”.

## FD-AISLOW — Scorarea AI când furnizorul răspunde greu (20 oct 2026)
Cererea: „nu a ajutat deloc ce ai făcut, aceeași eroare o primea și înainte”. Eroarea din captura celuilalt utilizator e „Gemini: Google nu a răspuns la timp”, nu una de credit: FD-AIQUOTA nu o atingea.

Ce s-a văzut (producție, 20 oct, UTC):
- **12:54–12:57:** 10 runde la rând, câte 2 loturi, cam 5 secunde pe lot. Cheia și creditul erau în regulă.
- **De la 12:58:** aproape fiecare rulare se termină cu „Google nu a răspuns la timp” (limita era de 90 de secunde). Loturile care trec durează 30–60 de secunde (de exemplu 18:56 → 18:58: două loturi în 89 de secunde).
- **După fiecare timp depășit urma o pauză de 5 minute.** Rezultatul: cam 25 de titluri la 7 minute, deși intră 100–180 de știri pe oră. La 19:20 așteptau 1.639 de titluri din ultimele 48 h. Totuși, cheia scorase 1.495 de titluri în 24 h, iar avertismentul arăta ca și cum nimic nu ar merge.
- **Utilizatorul 1 (Claude):** nimic nu așteaptă.
- **Forumul Google AI pentru dezvoltatori** (fără răspuns oficial de la Google): de la 13 oct, gemini-3.8-flash răspunde foarte lent și dă 503 „no capacity”, mai rău pe 20 oct. Un raport din septembrie, despre gemini-3.7-flash: Flash-urile mai vechi, pe aceeași cheie, răspundeau în circa o secundă, iar nivelul Priority nu ajuta.

Problema e la Google și Sentiq nu o poate repara. Partea Sentiq: să ceară mai inteligent, să nu se oprească degeaba, să spună adevărul despre progres și ce se poate face.

### 1. Mai mult timp pentru un răspuns
- Un lot de scor are acum **3 minute** (înainte 90 de secunde), cât are și Rezumatul zilei.
- **Timpul e al întregii cereri, cu reîncercările ei cu tot** (după un 503, de exemplu), la toți furnizorii. Înainte, fiecare încercare avea timpul ei: până la de 3 ori 90 de secunde, iar la Anthropic, prin SDK, la fel.
  - Așa, un lot nu ține runda mai mult de 3 minute.
  - O reîncercare a cărei așteptare ar trece de timp nu se mai face: rămâne eroarea primită (de exemplu „Google e supraîncărcat acum”).
- Mesajul spune cât s-a așteptat: „Google nu a răspuns în 3 minute”, la fel la OpenAI și Anthropic. La verificarea cheii Google sau OpenAI: „…în 15 secunde”.

### 2. Reîncercare repede după o eroare trecătoare
Erorile trecătoare sunt: timp depășit, supraîncărcare, conexiune, limită pe minut, eroare 5xx.
- **Pauza după ele nu mai e fixă (5 minute).** Crește cu fiecare eroare la rând: 1 minut după prima, apoi 2, 4, 8, cel mult 15 minute. Primul răspuns o readuce la zero.
- **Neschimbate:** credit sau limită zilnică → 30 de minute; cheie refuzată → până se schimbă; altă eroare (cerere respinsă, 4xx) → 5 minute.
- Și un răspuns fără scor folosibil (refuz, prea lung) e un răspuns: seria de erori se oprește.

### 3. Utilizatorii nu se mai așteaptă unul pe altul
- Fiecare rundă a jobului face **un singur lot (25 de titluri) pentru fiecare utilizator**, iar utilizatorii sunt serviți **în paralel** (cel mult 4 deodată).
- Un furnizor lent (până la 3 minute) întârzie doar runda, nu și pe ceilalți utilizatori în aceeași rundă. Un utilizator cu Claude primește o rundă cel puțin la 3 minute, chiar dacă un altul așteaptă după Google.
- Jobul nu mai începe runde noi după **5 minute** de la pornire. Lotul în curs se termină, deci rularea rămâne sub limita jobului (10 minute) și nu se pierde un răspuns deja plătit.

### 4. Ce se vede în Setări → AI
- **O singură eroare trecătoare nu mai aprinde avertismentul.** Se reîncearcă într-un minut, iar de obicei trece. Avertismentul apare de la a doua eroare la rând:
  > Gemini: Google nu a răspuns în 3 minute (a 3-a eroare la rând). Se reîncearcă automat la 22:14; între timp, titlurile nescorate au scorul modelului local. Dacă se repetă, alege alt model din listă: unele răspund mai repede.

  Dacă pauza a trecut deja: „Se reîncearcă automat în curând”.
- Celelalte erori (credit, cheie, cerere respinsă) se arată ca până acum, de la prima.
- **Rândul nou, mereu vizibil cât scorul AI e pornit și cheia e salvată:**
  > Ultimele 48 h: Gemini a scorat 1.869 din 3.508 titluri; ultimul scor acum 2 min.

  Variante:
  - toate scorate: „Ultimele 48 h: Gemini a scorat toate cele 3.508 titluri; ultimul scor acum 2 min.”;
  - un singur titlu: „…a scorat singurul titlu” / „…nu a scorat încă singurul titlu”;
  - niciun scor până acum: fără „ultimul scor”.

  Titlurile numărate sunt aceleași pe care le scorează AI-ul: din sursele active, care contează în indice. Unul pe care modelul nu l-a putut scora (refuz) a trecut totuși prin el și se numără. Așa se vede că scorarea merge, chiar dacă încet.

### 5. Jurnal
- Un lot care a primit răspuns după mai mult de un minut se notează cu durata: „AI scoring (gemini:gemini-3.8-flash): 25 headlines answered in 74 s”. Ajută la diagnostic data viitoare.

### 6. Cazuri limită
| Situație | Comportament |
|---|---|
| Repornire în mijlocul unei serii de erori | seria și pauza rămân (sunt în starea salvată, ca la FD-AIQUOTA) |
| Stare salvată de versiunea veche (fără serie) | avertismentul se arată ca înainte (seria necunoscută contează ca repetată) |
| Utilizatorul salvează cheia sau alegerea AI | pauza și seria se șterg; următoarea rundă încearcă din nou |
| Oprirea aplicației sau a jobului în timpul unui lot | nu e o eroare: nu crește seria |
| Google răspunde cu 503 de mai multe ori | reîncercările de câteva secunde din cerere rămân (1 s, 4 s), în cele 3 minute ale cererii; apoi pauza din §2 |
| Utilizatorul salvează cheia după o eroare trecătoare, când pauza trecuse deja | seria se șterge și ea (următoarea eroare are din nou un minut) |
| Modelul refuză setarea de gândire / raționament (un 400, imediat) | a doua cerere, fără ea, are din nou 3 minute; se întâmplă o singură dată pe cheie și model, ca până acum |
| O eroare de credit după timpi depășiți | 30 de minute, avertismentul imediat (nu e trecătoare) |
| Furnizorul nu răspunde deloc ore întregi | pauzele cresc până la 15 minute, deci cel mult ~4 cereri pe oră, fiecare de cel mult 3 minute |
| Cererea abandonată după 3 minute | Google o poate factura dacă a terminat-o după ce Sentiq a renunțat; un lot are cam 1.500 de tokeni, adică sub un cent |
| Eroare a bazei la un utilizator | ceilalți își termină lotul; rularea e marcată cu eroare, ca înainte |
| Mai mult de 4 utilizatori cu scor AI | câte 4 deodată, în ordine |
| Niciun titlu în ultimele 48 h | rândul de progres nu apare |
| Scorul AI oprit sau fără cheie | rândul de progres nu apare (ca avertismentul) |
| Pe telefon | rândul de progres și avertismentul se rup pe rânduri, fără depășire orizontală |
| Două instanțe (Mac / Azure) | scorează doar instanța cu joburile; pagina citește starea și progresul din bază |

### 7. Conflicte
- **FD-AIQUOTA §2** (durata pauzelor): „eroare trecătoare → 5 minute” devine pauza care crește 1 → 15 minute. Credit / limită și cheie refuzată: neschimbate.
- **FD-AIKEYS** („două loturi pe rulare”): devine un lot pe rundă, runde cât permite timpul (5 minute) și cel mult 40, utilizatorii în paralel.
- **Rezumatul zilei:** tot 3 minute, dar acum cu reîncercările cu tot (înainte, 3 minute pe fiecare încercare); mesajul la timp depășit e cel precis. La fel la verificarea cheii (15 secunde).
- **FD-AICLARITY** (consumul de azi): neschimbat; rândul de progres e separat.

Ce poate face celălalt utilizator acum: alege alt model Gemini din listă. Rapoartele de pe forum spun că modelele Flash mai vechi răspundeau mult mai repede; viteza lor nu e verificată de Sentiq. Sau rămâne pe gemini-3.8-flash: cu schimbările de mai sus, scorarea înaintează și când Google e lent.

## FD-EARNTV — Data rezultatelor trimestriale și de la TradingView (20 oct 2026)
Cererea: „de ce în calendar nu îmi apare earnings de la SpaceX, care sunt chiar în 30 de minute, deși SPCX e în lista mea de urmărire”, apoi „da, adaugă TradingView”.

Cauza:
- Sentiq lua rezultatele doar din calendarul Nasdaq (§4.5).
- **Nasdaq nu avea SPCX pe 20 oct.** Îl avea pe 3 nov., ca dată „estimată de un algoritm din datele istorice de raportare” (furnizorul Zacks), deși SpaceX anunțase pe 16 oct. rezultatele pe 20 oct., după închidere.
- **TradingView avea data corectă**, cu tipul de publicare „confirmat” și ora „după închidere”. Tesla (21 oct.) și Apple (2 nov.) erau corecte la ambele.

Ce dă TradingView (scanner-ul public `scanner.tradingview.com/america/scan`, verificat pe 20 oct.), pentru fiecare acțiune:

| Câmp | Ce e |
|---|---|
| `earnings_release_next_trading_date_fq` | ziua de bursă a următoarei publicări (miezul nopții UTC al zilei) |
| `earnings_publication_type_next_fq` | 10 = dată estimată; 11 = confirmată, înainte de deschidere; 12 = confirmată, după închidere; 13 = confirmată, fără oră |
| `earnings_release_next_time` | −1 înainte de deschidere, 1 după închidere, 0 necunoscut |
| `earnings_release_next_calendar_date` | sfârșitul trimestrului raportat (ex. 30 sept. 2026) |
| `earnings_per_share_forecast_next_fq` | EPS-ul estimat de analiști |
| `earnings_release_trading_date_fq` | ziua ultimei publicări (rezultate deja date) |

Codurile au fost deduse din date: 227 de companii mari cu rezultate în 60 de zile, comparate cu ora Nasdaq și cu anunțurile cunoscute. TradingView nu le documentează.

### 1. Regula
Pentru fiecare acțiune din favorite, la fiecare reîmprospătare (6 ore și la adăugarea unei acțiuni):
- **Data confirmată de TradingView câștigă.**
  - Rezultatul apare în ziua confirmată (dacă e în cele 10 zile lucrătoare), chiar dacă Nasdaq nu-l are în acea zi. Așa apare SpaceX pe 20 oct.
  - O dată Nasdaq diferită pentru aceeași acțiune dispare, pentru că e o estimare depășită. Excepție: ziua ultimei publicări, adică rezultatele date chiar azi.
- **După o publicare, estimările vechi dispar.** O dată Nasdaq la mai puțin de 45 de zile după ultima publicare știută de TradingView e o estimare care nu s-a actualizat: dispare. Exemplu: SpaceX raportează pe 20 oct., iar Nasdaq încă îl are pe 3 nov.
- **O dată doar estimată de TradingView nu schimbă nimic:** rămâne ce spune Nasdaq, ca înainte.
- **Fără date TradingView** pentru acțiune (ETF, simbol necunoscut, TradingView indisponibil): totul ca înainte, doar Nasdaq.
- **Ora:** cea confirmată de TradingView (înainte de deschidere / după închidere), altfel cea de la Nasdaq. Afișarea rămâne cea de acum: 08:00 sau 16:30 ora New York-ului, ori toată ziua.

### 2. Ce se vede
- **Când Nasdaq are rezultatul în aceeași zi:** Prognoza și Anteriorul rămân de la Nasdaq (EPS estimat, EPS-ul din același trimestru de anul trecut).
- **Când doar TradingView îl are:**
  - Prognoza e EPS-ul estimat de TradingView („$0.13”);
  - Anterior lipsește (TradingView nu dă EPS-ul de anul trecut pe același trimestru);
  - trimestrul vine din sfârșitul perioadei raportate.
- **Nota** spune de unde e data:
  - doar Nasdaq: ca acum;
  - data confirmată de TradingView, numerele de la Nasdaq: „…după închiderea bursei (în jur de 16:30, ora New York-ului). Data e confirmată (TradingView). Prognoza este EPS-ul estimat de analiști, iar Anterior este EPS-ul din același trimestru de anul trecut (Nasdaq).”;
  - doar TradingView: „…Data e confirmată (TradingView). Prognoza este EPS-ul estimat de analiști (TradingView); Nasdaq nu are încă rezultatele în calendar.”

### 3. Cazuri limită
| Situație | Comportament |
|---|---|
| TradingView nu răspunde / răspunde greșit | doar Nasdaq, ca înainte; în jurnal un avertisment; jobul nu e marcat cu eroare dacă Nasdaq a răspuns |
| TradingView își schimbă coloanele (o coloană necunoscută vine ca null, fără eroare) | acțiuni fără nicio dată de rezultate în tot răspunsul = schimbare: doar Nasdaq, cu avertisment în jurnal („s-au schimbat coloanele?”); doar ETF-uri fără date e normal |
| O dată TradingView în afara intervalului valid | tratată ca lipsă |
| Nasdaq nu răspunde pentru o zi | ziua își păstrează ce avea (ca înainte); TradingView nu adaugă nimic în ea |
| Nasdaq nu răspunde deloc | eroare a jobului, ca înainte (zilele rămân cum erau) |
| ETF-uri (SPY, QQQ, SMH, SSK) | TradingView nu are date de rezultate: doar Nasdaq (care nu le are nici el) |
| Clase de acțiuni (GOOGL, BRK.B) | același simbol cu punct la Nasdaq, TradingView și Sentiq; TradingView le marchează „neprimare”, deci nu se filtrează după asta |
| Același simbol pe mai multe burse la TradingView | se ia rândul cu date de rezultate; între mai multe, cel principal |
| Simboluri care nu sunt acțiuni (indici `^SPX`) | nu se trimit la TradingView |
| Data confirmată e în weekend sau după cele 10 zile lucrătoare | nu apare încă; datele Nasdaq diferite din fereastră dispar |
| Data confirmată a trecut (TradingView nu s-a actualizat după publicare) | nu apare; o dată Nasdaq diferită dispare (după o publicare nu mai vine alta în două săptămâni) |
| Rezultatele de azi, deja publicate | rămân azi (ziua ultimei publicări e păstrată), și după ce TradingView trece la trimestrul următor |
| Ora confirmată diferă de Nasdaq | ora TradingView |
| Confirmată fără oră (13) | ora Nasdaq dacă o are, altfel toată ziua |
| EPS estimat lipsă la TradingView | Prognoza goală |
| EPS negativ | „-$0.09”; rotunjit înainte de semn, deci niciodată „-$0.00” |
| Multe acțiuni în favorite | o singură cerere TradingView pentru toate, la fiecare reîmprospătare |
| Evenimente salvate de versiunea veche | se citesc ca înainte (nota „Nasdaq”) |

### 4. Conflicte
- **§4.5 (Calendar):** sursa devine „Nasdaq, cu data confirmată de TradingView”; restul (filtrul, ora afișată, 10 zile, 6 ore, la adăugare) neschimbat.
- **FD-USERS §2:** fiecare vede doar rezultatele acțiunilor lui, neschimbat.
- **Evenimentul următor (Azi, banda de sus) și exploziile TradingView ale calendarului economic:** rezultatele nu le pornesc, neschimbat (filtrul pe sursele `ff` / `tv` ale calendarului economic).

## FD-WATCHLISTS — Liste de urmărire (20 oct 2026)
Cererea:
- un element nou în meniu, „Liste de urmărire”, după Tranzacții;
- liste cu nume, cu simboluri în ele;
- simbolurile se aleg prin selecție multiplă, ca să fie copiate sau mutate în altă listă ori șterse;
- ordinea se poate schimba;
- lista de favorite din Setări se mută în acest concept, iar Setările nu o mai au;
- în Grafice, ca în TradingView, panoul de simboluri are un dropdown cu listele;
- pe fiecare rând, un buton deschide un popup mare cu datele financiare: descrierea, apoi rezultatele pe ultimele 4 trimestre; la crypto, măcar descrierea.

Alegerile utilizatorului (20 oct):
1. **Toate listele împreună** alimentează restul aplicației (Azi, banda, scanner-ul, știrile, calendarul, Rezumatul).
2. **Descrierile se traduc în română** cu AI-ul utilizatorului, când are cheie; altfel apare originalul în engleză.

### 1. Meniul și pagina
- **Meniul:** „Liste de urmărire” vine după „Tranzacții”, cu adresa `/watchlists`. Apare și în căutarea ⌘K (Pagini) și în meniul de pe telefon.
- **Pe ecrane late, două coloane:**
  - **stânga, „Listele mele”:** în antet, butonul **+** („Listă nouă”); dedesubt, fiecare listă cu numele și numărul de simboluri, cea deschisă evidențiată. Se ordonează trăgând sau cu Alt + ↑ / ↓;
  - **dreapta:** lista deschisă.
- **Pe telefon:** lista se alege dintr-un câmp de selecție, cu butoanele + / Redenumește / Șterge alături, iar dedesubt vine lista deschisă.
- **Nimic nu împinge pagina** (cerut de utilizator pe 21 oct.): ce apare la o acțiune apare peste pagină sau în locul a ceva de aceeași înălțime.
  - Numele unei liste noi (și, pe telefon, redenumirea) se scrie într-o fereastră mică sub buton; un clic în afară sau Esc renunță.
  - Pe ecrane late, redenumirea se face în rândul listei.
- **Acțiunile unei liste:**
  - **Redenumește:** câmp în loc.
  - **Șterge:** cu confirmare, care spune câte simboluri pleacă și din restul aplicației, pentru că nu mai sunt în nicio altă listă.
  - **Ultima listă nu se poate șterge:** „Păstrează cel puțin o listă; o poți goli”.
- **Lista deschisă** e în adresă (`?list=ID`): reîncărcarea și un link o păstrează. Fără adresă, se deschide prima listă.

### 2. Lista deschisă
- **Antet:** numele listei și „N simboluri”.
- **Adăugare:** un comutator Crypto / Acțiuni / Indici și o căutare. Rezultatele, inclusiv cei șapte indici, se deschid sub câmp, peste pagină. Cei deja în listă au „în listă” și nu se mai pot alege. La Indici, lista se deschide imediat.
- **Tabelul**, pe fiecare rând:
  - căsuța de selecție;
  - ordinea (mâner de tras, ↑ / ↓, Alt + ↑ / ↓);
  - simbolul (sigla, simbolul, numele);
  - tipul;
  - perechea / bursa;
  - **Ultimul** și **Var%** (aceleași prețuri ca banda);
  - aliasurile din știri (ca în Setări până acum);
  - butonul ⓘ „Date financiare”.
  Pe telefon tabelul se derulează orizontal în cadrul lui, ca până acum în Setări; pagina nu iese din ecran.
- **Selecția:**
  - căsuța din antet selectează tot sau nimic (și „parțial”, când sunt câteva);
  - Shift + clic pe o căsuță selectează tot intervalul de la ultima bifată;
  - selecția e a listei deschise: se golește la schimbarea listei.
- **Bara de acțiuni**, mereu deasupra tabelului: „Niciunul selectat” / „N selectate” · **Copiază în…** · **Mută în…** · **Șterge** · **Anulează selecția**. Butoanele sunt dezactivate cât nu e nimic bifat, deci bifarea nu mută nimic.
- **Mesajele acțiunilor** („3 copiate în Tech; 1 era deja acolo.”, erorile) apar jos, peste pagină, și dispar singure după câteva secunde; se pot închide cu ×.
- **Fiecare schimbare se vede imediat**, înainte de răspunsul serverului (de pe Mac, ~1 s până la Azure): adăugarea, ștergerea, copierea, mutarea, redenumirea și ștergerea unei liste.
  - Schimbările pleacă una după alta. Răspunsul serverului pune starea exactă după ultima.
  - La o eroare, mesajul spune de ce și listele se recitesc.
  - O listă nouă apare când răspunde serverul, pentru că abia atunci are un număr.
  - **Copiază în** (meniu cu celelalte liste):
    - simbolurile ajung la sfârșitul listei alese, în ordinea lor;
    - cele care erau deja acolo rămân pe locul lor;
    - mesajul: „3 copiate în Tech; 1 era deja acolo.”
  - **Mută în:** la fel, apoi le scoate din lista deschisă, inclusiv pe cele care erau deja în ținta.
  - **Șterge:**
    - cu confirmare: „Ștergi 3 simboluri din Favorite?”;
    - dacă unele nu mai sunt în nicio altă listă, confirmarea adaugă: „AAPL, TSLA nu mai sunt în nicio altă listă: dispar și din Azi, din bandă, din scanner, din filtrul de știri și din calendar.”
  - Cu o singură listă, Copiază / Mută sunt dezactivate, iar indicația („Fă întâi altă listă…”) apare la trecerea cu mouse-ul.
- **Lista goală:** „Lista e goală. Adaugă simboluri cu căutarea de mai sus.”

### 3. Popup-ul „Date financiare” (butonul ⓘ)
Un popup mare (pe telefon, aproape tot ecranul), cu titlul „AAPL · Apple Inc.” și închis cu ×, Esc sau clic în afară.
- **Descrierea, prima:**
  - **Cu cheie AI:** traducerea în română. Cât se traduce, se vede originalul cu „Se traduce în română…”. Traducerea se ține minte (o dată pe text, pentru toți), iar a doua deschidere e imediată.
  - **Fără cheie:** originalul, cu „În engleză. Cu o cheie AI (Setări → Inteligență artificială), descrierea apare în română.”
  - **Traducerea eșuează:** originalul, cu „Traducerea nu s-a putut face: {motivul}.”
  - **Sursa** sub text: Nasdaq (acțiuni), CoinGecko (crypto), Sentiq (indici).
- **Date scurte:**
  - acțiuni: sectorul și industria;
  - crypto: categoriile (primele 5), data lansării, site-ul.
- **Rezultate trimestriale** (acțiuni): ultimele 4 trimestre raportate, cel mai nou în stânga, cu luna în care s-a încheiat trimestrul („iun. 2026”).
  - **Rândurile:** Venituri, Profit brut (cu marja brută), EBITDA, Profit net (cu marja netă), EPS diluat, Flux de numerar liber.
  - **Comparația cu anul trecut:** la venituri și la EPS, sub valoare („+21,0% față de anul trecut”), când TradingView are și trimestrul de acum un an.
  - **Sumele** în dolari, scurt și ca în restul aplicației: „28,24 mld. USD”, „541 mil. USD”, „-0,04 USD”. Valorile negative sunt roșii.
  - **Sursa:** TradingView, care are și companiile listate de curând, ca SpaceX, pe care Nasdaq încă nu le are.
  - **Sub tabel**, rezultatele următoare, din FD-EARNTV: „Următoarele rezultate: 21 oct. 2026, după închiderea bursei (confirmat) · EPS estimat 0,45 USD”, sau „(dată estimată)”.
- **Fond (ETF):** „Fond tranzacționat la bursă (ETF): fondurile nu publică rezultate trimestriale.” Nasdaq nu dă descrieri de fonduri, deci nu apare descriere.
- **Indice:** o descriere scurtă în română, scrisă în Sentiq pentru fiecare din cei șapte indici, plus „Un indice nu are rezultate financiare.”
- **Crypto:** descrierea CoinGecko și „Monedele nu publică rezultate financiare.”
- **O sursă care nu răspunde:** se arată ce s-a putut citi, iar partea lipsă spune „nu s-a putut încărca acum ({motivul})”.

### 4. Grafice
- **Antetul panoului de simboluri** („Listă”) devine un dropdown cu listele (nume și număr de simboluri). Rândurile sunt ale listei alese, iar ordinea se schimbă în lista aceea.
- **Lista aleasă se ține minte** pentru utilizator, pe toate dispozitivele. O listă ștearsă duce la prima.
- **Lista goală:** „Lista e goală. Adaugi simboluri în Liste de urmărire.”, cu link.
- **Graficul deschis când adresa nu are pereche:** primul simbol urmărit, ca până acum.

### 5. Setări
- **Panoul „Favorite” dispare** din Setări → Ale mele. Totul (adăugare, ordine, aliasuri) e acum în Liste de urmărire.

### 6. Restul aplicației: toate listele împreună („simbolurile urmărite”)
- **Ce folosesc:** Azi, banda de sus, scanner-ul, filtrul de știri, rezultatele din Calendar, feed-urile automate de știri ale acțiunilor, Rezumatul, recunoașterea în titluri și ⌘K folosesc toate simbolurile din toate listele, o singură dată fiecare.
- **Ordinea lor:** listele în ordinea lor, simbolurile în ordinea din listă; un simbol din mai multe liste stă pe primul loc unde apare.
- **Cuvintele** se schimbă unde „favorite” însemna acest ansamblu:
  - „doar favorite” devine „doar urmărite” (Știri);
  - grupul „Favorite” devine „Urmărite” (⌘K);
  - Azi fără simboluri: „Nu urmărești încă nicio monedă sau acțiune. Adaugă simboluri”, cu link la Liste de urmărire;
  - alte texte mai mici (Calendar, Rezumat, Știrile acțiunilor, ștergerea unui cont).
- **Limitele:**
  - **cel mult 50 de simboluri diferite** în toate listele împreună, ca până acum: așa rămân în buget Twelve Data (scanner-ul) și feed-urile automate. Copierea unui simbol deja urmărit în altă listă nu se socotește;
  - **cel mult 20 de liste;**
  - **numele unei liste:** 1–40 de caractere, unic la utilizator (fără deosebire între litere mari și mici).
- **Setările unui simbol sunt ale simbolului,** nu ale listei: perechea crypto, aliasurile și numele sunt aceleași în toate listele în care apare. Aliasurile schimbate într-o listă se schimbă peste tot.

### 7. Trecerea la liste
- **La actualizare:** favoritele fiecărui utilizator devin lista „Favorite”, în aceeași ordine.
- **Un utilizator nou:** lista „Favorite”, cu BTC, ETH și SOL, ca până acum.
- **Simboluri adăugate sau șterse de o versiune veche** a Sentiq (de exemplu Mac-ul, înainte să fie actualizat):
  - unul adăugat intră la sfârșitul primei liste;
  - unul șters iese din toate listele;
  - corectura se face la următoarea citire.

### 8. Cazuri limită
| Situație | Comportament |
|---|---|
| Adaugi BTC (perechea USDC) când BTC e urmărit cu USDT în altă listă | BTC intră în listă cu perechea de până acum (USDT); mesaj: „BTC e deja urmărit ca BTC/USDT; perechea e aceeași în toate listele.” |
| Adaugi un simbol deja în lista deschisă | refuzat: „AAPL e deja în Favorite.” |
| Al 51-lea simbol diferit | refuzat: „Listele au împreună cel mult 50 de simboluri diferite.”; copierea / mutarea între liste nu e afectată |
| A 21-a listă | refuzat: „Poți avea cel mult 20 de liste.” |
| Nume gol, prea lung sau deja folosit | refuzat, cu motivul; spațiile de la capete se taie |
| Mutare în aceeași listă | nu e oferită (meniul arată doar celelalte liste) |
| Copiere / mutare / ștergere cu simboluri pe care altă filă le-a scos între timp | cele care nu mai sunt sunt ignorate; mesajul spune câte s-au făcut |
| O listă ștearsă în altă filă | la următoarea acțiune: „Lista nu mai există”; pagina se întoarce la prima listă |
| Două file schimbă ordinea în același timp | câștigă ultima salvare; lista se recitește după o eroare |
| Ștergi o listă cu simboluri care sunt și în alte liste | rămân urmărite; doar cele care nu mai sunt nicăieri pleacă din restul aplicației |
| Lista aleasă în Grafice e ștearsă | Grafice arată prima listă |
| Selecție, apoi schimbi lista | selecția se golește |
| Shift + clic fără o căsuță bifată înainte | bifează doar căsuța aceea |
| Popup pentru un simbol fără date TradingView (o acțiune nouă, un ADR rar) | descrierea, plus „Rezultatele trimestriale nu sunt disponibile pentru acest simbol.” |
| Mai puțin de 4 trimestre raportate (listare recentă) | câte sunt |
| Comparația cu anul trecut fără trimestrul de acum un an | nu apare |
| Descriere foarte lungă (unele monede) | tăiată la ~1.500 de caractere, la sfârșit de frază, cu „…” |
| Descrierea CoinGecko cu linkuri HTML | text simplu, fără etichete |
| Moneda nu e la CoinGecko sau simbolul e ambiguu | se ia moneda cu acel simbol exact și cea mai bună poziție după capitalizare; fără niciuna: „Descrierea nu e disponibilă.” |
| Traducerea: cheie fără credit, limită, timp depășit | originalul, cu motivul (mesajele precise de la FD-AIQUOTA / FD-AISLOW) |
| Traducerea costă | câțiva tokeni pe descriere, o singură dată pe text (ținută minte pentru toți utilizatorii); apare la „Ce a consumat cheia ta azi”, pe un rând nou „Traduceri” |
| Datele financiare se schimbă | ținute minte 12 ore (descrierile 7 zile), deci după un raport apar în cel mult 12 ore |
| Telefon | popup aproape pe tot ecranul, tabelul trimestrelor se derulează orizontal în el; nicio depășire a paginii |
| Utilizator fără niciun simbol | Azi și Grafice trimit la Liste de urmărire |
| După o adăugare sau o ștergere care schimbă simbolurile urmărite | știrile ultimelor 7 zile se reetichetează **în fundal** (~20 s pentru 10.000 de știri văzute de pe Mac): răspunsul nu așteaptă; schimbări repetate cer o singură trecere în plus; filtrul de știri „doar urmărite” prinde simbolul nou după trecere |

### 9. Conflicte
- **FD-SENTIQ §4.1 / FD-INDICES (favoritele):** devin simbolurile din liste. Validarea simbolurilor și aliasurile implicite (numele companiei, ale indicelui) rămân.
- **FD-CHARTFAV §2 (ordinea prin tragere):** se aplică în fiecare listă. Ordinea comună (Azi, banda) vine din ordinea listelor.
- **FD-CHARTTV §3 / FD-WATCHDRAWER (panoul de simboluri):** primește dropdown-ul; lățimea și ascunderea rămân per browser.
- **FD-USERS §2:** listele sunt ale fiecărui utilizator. Feed-urile automate și rezultatele merg după simbolurile urmărite de oricine, ca până acum.
- **FD-AICLARITY:** consumul are un rând nou, „Traduceri”.
- **Ștergerea unui cont:** îi șterge și listele.

## FD-LOCALSTAGE — Testarea locală înaintea unui deploy (21 oct 2026, decizie)
Întrebarea: o versiune cu o migrare nouă (FD-WATCHLISTS: migrarea 9), pornită pe Mac, schimbă baza comună cu producția înainte de deploy.

Am propus o copie a datelor reale într-o schemă separată (`scripts/sentiq.sh stage`). Utilizatorul a ales să testeze **direct pe datele reale**: Sentiq local pornește cu codul nou pe baza reală și o migrează, iar deploy-ul vine după test.
- **Producția, cu codul vechi:** merge mai departe pe baza nouă (o migrare care doar adaugă tabele nu o deranjează). La o repornire Azure de dinainte de deploy, ar refuza să pornească până la deploy; utilizatorul acceptă riscul.
- **Ce rămâne de reținut:** o greșeală găsită chiar în migrare se repară cu o migrare nouă (baza reală o are deja); ce se schimbă la testare rămâne în datele reale.
- **Ce s-a schimbat în cod:** nimic. Copia de test a rămas doar propunere și nu a fost păstrată.

## FD-SLINGSHOT34 — Slingshot System 3.4: partea SHORT (21 oct 2026)

### Ce cere utilizatorul
- O versiune nouă a indicatorului, **3.4**, care pe lângă LONG dă și semnale **SHORT**.
- **SHORT = exact regulile LONG-ului, inversate.** Nicio regulă în plus și nicio regulă schimbată: semnalul se activează când se îndeplinesc condițiile și lumânarea atinge norul, ca la LONG.
- Long și Short sunt **opțiuni bifabile**; cel puțin una rămâne bifată.
- **Backtest-ul verifică doar că semnalele SHORT se activează exact unde spun regulile**, pe multe simboluri. Rata de succes nu e criteriu: ea depinde de piață, nu de algoritm.
- Versiunea 3.3 (fișierul Pine) rămâne neatinsă.

> **Corecție (21 oct 2026).** Prima variantă 3.4 avea două lucruri care nu fac parte din algoritm. Utilizatorul le-a respins, așa că au fost scoase:
> - o regulă proprie: SHORT confirmat doar cu o închidere sub nor, aleasă după rata de succes din backtest;
> - o legătură între părți: un semnal nou al unei părți oprea urmărirea TP/SL a celeilalte.

### Setări noi (grupul „Signals”, primul în setările indicatorului)
| Setare | Implicit | Ce face |
|---|---|---|
| Long Signals | bifat | semnalele LONG, exact ca în 3.3 |
| Short Signals | nebifat | semnalele SHORT |
| Short Signal Color | albastru `#2196F3` (culoarea SHORT din vechea versiune) | culoarea etichetei SHORT; doar afișare |

- Cel puțin unul dintre Long și Short rămâne bifat.
  - **În Sentiq:** ultima casetă bifată nu se poate debifa (e dezactivată, cu explicație); serverul refuză oricum o combinație fără niciunul.
  - **În TradingView:** cu amândouă debifate, indicatorul arată o eroare.
- Implicit (doar Long), 3.4 se comportă **identic cu 3.3**.

### SHORT = LONG inversat
Fiecare regulă a LONG-ului, cu sus și jos inversate: maximul ↔ minimul, K ↔ 100 − K (supravânzarea ↔ supracumpărarea), uptrend ↔ downtrend. Altfel spus, SHORT-ul pe un grafic dă exact ce dă LONG-ul pe același grafic întors cu susul în jos.

| | LONG (3.3, neschimbat) | SHORT (3.4) |
|---|---|---|
| Trend | EMA 38 > EMA 62 (nor verde) | EMA 38 < EMA 62 (nor roșu) |
| V1 (candidat) | K ≤ 20 și lumânarea atinge norul; reține **minimul** | K ≥ 80 și lumânarea atinge norul; reține **maximul** |
| Deal | K ≥ 80: fixează V1 | K ≤ 20: fixează V1 |
| Căutarea V2 | K ≤ 20, atinge norul, după deal, **minim mai sus** decât V1; urmărește minimul cel mai jos | K ≥ 80, atinge norul, după deal, **maxim mai jos** decât V1; urmărește maximul cel mai sus |
| Anulare V2 | minimul coboară până la V1 | maximul urcă până la V1 |
| Confirmare | K iese din supravânzare, V2 > V1, uptrend | K iese din supracumpărare, V2 < V1, downtrend |
| Stop loss | minimul V2 − ATR × multiplicator | maximul V2 + ATR × multiplicator |
| Breakout | cel mai mare maxim din ultimele 20 de lumânări | cel mai mic minim din ultimele 20 de lumânări |
| Take profit (ATR) | breakout + ATR × multiplicator | breakout − ATR × multiplicator |
| Succes în istoric | maximul trece de breakout înaintea SL | minimul trece sub breakout înaintea SL |

Restul regulilor din 3.3 sunt inversate la fel:
- invalidarea la întoarcerea trendului;
- un SHORT confirmat înlocuiește SHORT-urile încă urmărite, cum face LONG-ul cu LONG-urile;
- nivelurile SHORT-ului confirmat se păstrează până la stop loss sau până la un SHORT mai nou (FD-SS33).

### Fiecare parte, independent
- Mașinile LONG și SHORT nu se influențează. Semnalele, istoricul, tranzacția urmărită și alertele unei părți sunt aceleași, fie că cealaltă parte e bifată, fie că nu.
- Un LONG și un SHORT pot fi urmărite în același timp. Fiecare rămâne urmărit până la stop loss-ul lui sau până la un semnal nou de aceeași parte.

### Pe grafic
- **SHORT:** triunghi în jos deasupra lumânării V2, cu „SHORT”, în culoarea short-ului. Devine roșu dacă semnalul eșuează (stop loss, înlocuit, trend întors), ca LONG-ul.
- Semnalul **în formare** (V2 căutat) apare la fel, deasupra lumânării.
- **TAKE PROFIT al short-ului:** triunghi sub lumânarea care trece sub breakout, verde (culoarea de take profit), mutat la minimul cel mai jos.
- **Liniile și etichetele TP/SL:** fiecare parte le are pe ale ei. Arată ca în 3.3 tranzacția ei urmărită, iar fără una, setup-ul ei în formare. La short, TAKE PROFIT e sub preț, iar STOP LOSS deasupra.
- **Tabelul TP/SL:** rândurile LONG, apoi „TAKE PROFIT (SHORT)” / „STOP LOSS (SHORT)”. În TradingView e tabelul din colț. În Sentiq e caseta de pe grafic.
- Norul, EMA-urile și Market Structure nu se schimbă.

### Alerte noi
**Short Signal**, **Short Take Profit Signal**, **Short ATR Take Profit Hit**, **Short ATR Stop Loss Hit**. Funcționează ca cele de LONG. Alertele LONG și Market Structure rămân, cu aceleași nume.

### Verificare (backtest)
Pe 192 de serii reale:
- 44 de monede de pe Binance, pe 1h, 4h și 1d;
- 60 de acțiuni și ETF-uri americane, pe 1d.

Verificările:
1. **SHORT-ul se activează exact unde trebuie.** SHORT-ul pe prețurile reale dă exact ce dă LONG-ul pe prețurile întoarse:
   - aceleași lumânări V2 și de confirmare;
   - aceleași prețuri, întoarse (V2, SL, TP, breakout);
   - același rezultat;
   - aceleași etichete și alerte;
   - același TP/SL urmărit.

   Deci fiecare SHORT apare acolo unde regulile LONG-ului, inversate, îl cer, și nicăieri altundeva.
2. **Doar Long = 3.3**, identic.
3. **Cu ambele bifate,** partea LONG e identică cu Long singur, iar partea SHORT cu Short singur.

### În Sentiq
- **Grafice:**
  - setările noi;
  - semnalele SHORT, desenate;
  - liniile și caseta TP/SL ale fiecărei părți;
  - tabelul „Semnale Slingshot 3.4”: prima coloană arată partea (LONG / SHORT) și ora V2, apoi prețul V2 (minimul la LONG, maximul la SHORT), SL, TP și rezultatul;
  - lista de alerte, cu alertele noi.
- **Azi (scanner):** ultimul semnal arată partea („SHORT 19 oct., activ”), apare „SHORT în formare” și sunt afișate TP/SL ale fiecărei tranzacții urmărite („TP … SL …”, „SHORT · TP … SL …”). Scanner-ul folosește aceleași setări ca graficul: short-ul apare doar dacă e bifat.
- **Rezumatul AI:** primește partea semnalului (LONG / SHORT) și short-ul în formare.
- **Numele:** „[DE] Slingshot System 3.4” (pe grafic, „[DE] Slingshot 3.4”).

### În TradingView
- Fișierul nou: `Sling Shot System/sling-shot-system-3.4.pine`. Titlul era „[Dusty Investments] Slingshot System 3.4”, iar titlul scurt „[DI] SS 3.4”, fără „LONG”, fiindcă are ambele părți. Din 26 oct 2026 sunt „[DE] Slingshot System 3.4” / „[DE] Slingshot 3.4”, ca în Sentiq (FIX-PINESYNC).
- `sling-shot-system.pine` (3.3) rămâne neschimbat.
- Alertele create pe 3.3 rămân pe 3.3; pentru 3.4 se creează din nou.

### Edge cases
| Situație | Comportament |
|---|---|
| Doar Long bifat (implicit) | identic cu 3.3: semnale, etichete, alerte, TP/SL, Market Structure |
| Doar Short bifat | niciun LONG; SHORT, alertele lui, TP/SL short; Market Structure ca de obicei |
| Ambele bifate | ambele părți, independent; tabelul de semnale le amestecă, în ordinea timpului |
| Ambele debifate | Sentiq nu permite (caseta rămasă e dezactivată; serverul refuză); TradingView arată o eroare |
| LONG urmărit, trendul se întoarce, apoi SHORT confirmat | amândouă rămân urmărite, fiecare cu liniile, rândurile din tabel și alertele lui de TP/SL |
| LONG urmărit, SHORT în formare | LONG-ul își arată tranzacția urmărită, SHORT-ul setup-ul în formare |
| SHORT urmărit și cu take profit atins (cu „Hide ATR Levels … on Take Profit Hit”) | se ascund doar liniile SHORT-ului, ca la LONG; ale LONG-ului rămân |
| Praguri asimetrice (ex. 30 / 70) | short-ul folosește pragul de supracumpărare unde LONG-ul îl folosește pe cel de supravânzare și invers; toleranțele K și ale norului, la fel |
| Istoric scurt | ca la 3.3: avertismentul „istoric insuficient” |
| Lumânarea în formare | semnalele și alertele SHORT de pe ea sunt marcate „neconfirmat”, ca la LONG |
| Setări salvate înainte de 3.4 | primesc valorile implicite (doar Long), deci nimic nu se schimbă până nu bifezi Short |
| Setări salvate cu prima variantă 3.4 (cu regula „sub nor”) | câmpul vechi e ignorat; restul setărilor rămân |
| Moneda / acțiunea în scanner cu Short nebifat | ca înainte: doar LONG |

## FD-SS34LIVE — Slingshot 3.4: invalidarea live, X pentru invalidat, personalizarea semnalelor (21 oct 2026)

### Ce cere utilizatorul
- **Problema veche:** apar două semnale LONG (sau SHORT) unul după altul, fără un take profit între ele. Un semnal se termină întotdeauna cu take profit sau cu eșec.
- **Cauza** (găsită de utilizator pe graficul SOL 30m):
  - eticheta semnalului nou apare din prima bară a căutării V2 („în formare”);
  - cel vechi devine roșu abia la confirmarea celui nou (K iese din supravânzare), câteva bare mai târziu;
  - între timp se văd două semnale valide.
- **Cerința:** invalidarea e live, ca afișarea semnalului nou.
  - Cât timp semnalul nou e afișat, dar neconfirmat, cel vechi apare invalidat.
  - Dacă cel nou dispare neconfirmat (piața s-a schimbat), cel vechi apare din nou valid.
  - La LONG și la SHORT.
- **Un semnal invalidat** se afișează ca acum, dar cu un **X mare** în loc de triunghi.
- **Personalizare:**
  - culori pentru LONG, take profit LONG, SHORT, take profit SHORT, eșec și invalidare;
  - mărimea triunghiului (în TradingView e mai mare decât în Sentiq);
  - regula generală: orice indicator se poate personaliza cât mai mult (vezi și FD-OPACITY).

### Cum arată o etichetă de semnal
| Starea | Forma | Culoarea |
|---|---|---|
| Valid: activ, sau terminat cu take profit | triunghi | Long Signal Color / Short Signal Color |
| Eșuat: stop loss | triunghi | Failed Signal Color |
| Invalidat: înlocuit de un semnal nou confirmat, sau trend întors | **X** | Invalidated Signal Color |
| Invalidat live: un semnal nou de aceeași parte e în formare | **X** | Invalidated Signal Color; revine la „valid” dacă cel nou dispare neconfirmat |

- În 3.3, eșuatul și invalidatul erau amândouă triunghiuri roșii. Implicit, cele două culori rămân roșii.
- Semnalul în formare arată ca unul valid (triunghi, culoarea părții), ca până acum.
- Invalidarea live e doar afișare. Semnalul vechi rămâne urmărit (istoricul lui, TP/SL, alertele) până la confirmarea celui nou, exact ca în 3.3.
  - Dacă își atinge take profit-ul în timp ce cel nou e în formare, s-a terminat cu succes: triunghi, culoarea părții.
  - Dacă își atinge stop loss-ul, e eșuat: triunghi, Failed Signal Color.
- LONG și SHORT sunt independente: un SHORT în formare nu schimbă etichetele LONG, și invers.

### Setări noi
**Grupul „Signals”:**

| Setare | Implicit |
|---|---|
| Long Signals / Short Signals | ca înainte |
| Long Signal Color | `#00FFAA` |
| Long Take Profit Color | `#00FFAA` |
| Short Signal Color | albastru `#2196F3` |
| Short Take Profit Color | `#00FFAA` |
| Failed Signal Color | roșu `#FF5252` |
| Invalidated Signal Color | roșu `#FF5252` |
| Signal Size | Small (Tiny, Small, Normal, Large, Huge) |

**Grupul nou „Cloud”:**
- Cloud Uptrend Color (`#00FFAA`) și Cloud Downtrend Color (`#FF5252`).
- EMA-urile au culoarea trendului; umplerea norului o are la jumătate din opacitate, ca acum.
- Până acum norul folosea culorile ATR TP / SL. Acum are culori proprii, cu aceleași valori implicite.

**Restul rămâne:**
- culorile ATR (liniile, etichetele și tabelul TP/SL);
- culorile Market Structure.

**Opacitatea:** fiecare culoare o are (FD-OPACITY).

### Mărimea
- **Signal Size** se aplică triunghiurilor LONG, SHORT și TAKE PROFIT și X-ului, cu textul lor.
- **În TradingView** sunt mărimile Pine `size.tiny` … `size.huge`.
- **În Sentiq**, mărimile urmează TradingView:
  - „Small” e calibrat pe capturile utilizatorului: un triunghi de ~24 px;
  - celelalte sunt scalate (Tiny ~14 px, Normal ~32 px, Large ~44 px, Huge ~60 px).
- Înainte, triunghiul din Sentiq avea 11 px.

### În Sentiq
- **Graficul:** formele, culorile și mărimea de mai sus.
- **Tabelul de semnale:** cât timp un semnal nou de aceeași parte e în formare, rezultatul semnalului activ e „invalidat (semnal nou în formare)”. Tabelul spune astfel același lucru ca graficul.
- **Alertele, scanner-ul și Azi:** neschimbate. Nivelurile TP/SL afișate cât timp un semnal e în formare le schimbă FD-SSLIVEBOX.

### Edge cases
| Situație | Comportament |
|---|---|
| Semnal activ, apare unul nou în formare | cel vechi: X, Invalidated Signal Color, de pe bara pe care apare cel nou |
| Cel nou se confirmă | cel vechi rămâne X (invalidat definitiv, ca în 3.3) |
| Cel nou dispare neconfirmat (minimul coboară până la V1, K iese fără V2 valid, trend întors, deal nou) | cel vechi redevine triunghi, în culoarea părții |
| Căutarea V2 repornește în același deal | cel vechi devine din nou X |
| Cel vechi își atinge TP în timp ce cel nou e în formare | succes: triunghi, culoarea părții, plus eticheta TAKE PROFIT |
| Cel vechi își atinge SL în timp ce cel nou e în formare | eșec: triunghi, Failed Signal Color |
| Cel vechi e invalidat de întoarcerea trendului | X (era triunghi roșu în 3.3) |
| SHORT în formare, LONG activ | LONG-ul rămâne valid (părțile sunt independente) |
| Lumânarea în formare | invalidarea live poate apărea și dispărea odată cu semnalul nou, pe aceeași lumânare |
| Setări salvate înainte | primesc valorile implicite: același aspect, cu X pentru invalidat |
| Doar Long (implicit) | semnalele, alertele și TP/SL sunt ca în 3.3. Diferă doar aspectul: X-ul, invalidarea live, culorile și mărimea alese |

## FD-OPACITY — opacitatea oricărei culori, în orice indicator (21 oct 2026)

### Ce cere utilizatorul
Oriunde se modifică o culoare, în orice indicator, se poate regla și opacitatea.

### Unde
- **Slingshot și LMA:** toate culorile din setări.
- **Cei 117 indicatori standard și Volume:**
  - culorile din tab-ul Intrări;
  - culorile din tab-ul Stil: linii, paletele lor, liniile orizontale.
- **Linia orizontală desenată** (FD-HLINE): culoarea ei.

### Cum arată
- Caseta de culoare rămâne de aceeași mărime și arată culoarea peste un fundal în carouri, ca opacitatea să se vadă.
- Un click deschide un panou mic peste pagină, care nu împinge nimic. Panoul are:
  - selectorul de culoare;
  - codul hex;
  - glisorul **Opacitate**, 0–100 %, cu valoarea lui.
- Panoul se închide la click în afara lui, la Esc sau la un nou click pe casetă.
  - Esc închide doar panoul, nu și fereastra de setări.
  - La derularea ferestrei de setări (sau când apare tastatura pe telefon), panoul își urmează caseta. Se închide doar dacă aceasta iese din ecran.
- Schimbarea se vede imediat în formular. Se aplică la „Salvează”, ca orice altă setare.

### Ce se salvează și ce se desenează
- **Salvarea:** `#RRGGBB` la 100 %, altfel `#RRGGBBAA`.
- **Desenarea:** elementul se desenează cu acea opacitate.
- **Slingshot:** unde indicatorul face el o culoare transparentă (umplerea norului la 50 %, fundalul etichetelor TP/SL la 20 %), cele două opacități se înmulțesc. În fișierul Pine 3.4 e la fel (`color.t`).
- **LMA** e scriptul utilizatorului din TradingView, portat exact.
  - Unde scriptul își fixează singur transparența (`color.new(culoare, 30)`, ca la liniile pragurilor), valoarea scriptului câștigă, ca în TradingView.
  - În rest (linia de semnal, gradientul, culorile lumânărilor), opacitatea se aplică.
- **Indicatorii standard:** culorile din Stil înlocuiesc culoarea liniei, cu opacitate cu tot.
  - O culoare din Intrări ajunge la indicator ca în TradingView: unde scriptul fixează transparența, valoarea lui câștigă.

### Umplerile
Umplerile indicatorilor standard (de exemplu fundalul benzilor Bollinger) nu aveau o casetă de culoare. Le-a adăugat FD-FILLS, la cererea utilizatorului.

### Edge cases
| Situație | Comportament |
|---|---|
| Culori salvate fără opacitate | 100 %, nimic nu se schimbă |
| Culoarea implicită a unui indicator e `rgba(...)` sau `#RGB` | caseta o citește, cu opacitate cu tot; după o schimbare se salvează `#RRGGBBAA` |
| Opacitate 0 % | elementul e invizibil, dar rămâne pe grafic (ca în TradingView) |
| Panoul deschis lângă marginea ecranului / pe telefon | rămâne în ecran (se mută la stânga sau deasupra casetei) |
| Tastatura | Tab ajunge în panou; Esc îl închide și întoarce focusul pe casetă |

## FD-SSSL — Slingshot 3.4: eticheta STOP LOSS (21 oct 2026)

### Ce cere utilizatorul
Pe bara unde un semnal eșuează, o etichetă „STOP LOSS”, pereche cu TAKE PROFIT. Explică ce s-a întâmplat, mai ales pentru cine nu cunoaște algoritmul.

### Cum arată
- **Unde apare:** pe bara pe care semnalul își atinge stop loss-ul, aceeași pe care eticheta lui devine „eșuat” (triunghi în Failed Signal Color).
  - **LONG:** sub lumânare, cu un triunghi în sus spre minimul care a atins stop loss-ul.
  - **SHORT:** deasupra lumânării, cu un triunghi în jos spre maxim.
- **Câte apar:** câte una pentru fiecare semnal eșuat. Unul invalidat (X) nu primește etichetă, fiindcă nu s-a terminat cu stop loss.
- **Setări noi**, în grupul „Signals”: Long Stop Loss Color și Short Stop Loss Color (roșu `#FF5252`, cu opacitate). Mărimea e Signal Size.
- **Alertele** rămân neschimbate („ATR Stop Loss Hit” există deja).

### Edge cases
| Situație | Comportament |
|---|---|
| Semnalul arăta invalidat (unul nou în formare) și își atinge stop loss-ul | eșuat, plus eticheta STOP LOSS |
| Mai multe semnale eșuează pe aceeași bară (nu se poate în practică: e cel mult unul activ pe parte) | câte o etichetă fiecare |
| Doar Long | ca 3.3, plus etichetele STOP LOSS |
| Limita de 500 de etichete | o etichetă în plus la fiecare eșec; cele mai vechi dispar primele, ca în Pine |

## FD-SSLIVEBOX — Slingshot 3.4: TP/SL ale semnalului în formare (21 oct 2026)

### Ce cere utilizatorul
- **Până acum:** cât timp un semnal nou se forma, iar cel vechi apărea invalidat (FD-SS34LIVE), liniile și caseta TP/SL arătau încă nivelurile celui vechi, până la confirmare.
- **Cerința:** utilizatorul a ales să arate nivelurile semnalului în formare.

### Comportament
Pe fiecare parte, ordinea afișării devine:
1. semnalul în formare (TP = cel mai mare maxim din ultimele 20 de lumânări + ATR; SL = V2 − ATR; la SHORT, invers);
2. altfel, semnalul urmărit (ca în 3.3, cu „Hide ATR Levels … on Take Profit Hit” / „… on Stop Loss Hit”).

- **Când cel nou se confirmă:** apar nivelurile lui, ca semnal urmărit.
- **Când dispare neconfirmat:** revin nivelurile celui vechi, dacă e încă urmărit și nu sunt ascunse.
- **Urmărirea celui vechi nu se schimbă:** alertele „ATR Take Profit Hit” / „ATR Stop Loss Hit” și eticheta TAKE PROFIT rămân ale lui până la confirmarea celui nou. Se schimbă doar afișarea.
- **În Sentiq**, aceleași niveluri apar:
  - pe grafic;
  - în caseta TP/SL;
  - în cardurile din Azi;
  - în contextul AI.

### Edge cases
| Situație | Comportament |
|---|---|
| Semnalul urmărit și-a atins TP-ul, cu „Hide … on Take Profit Hit” | înainte nu se afișa nimic, nici semnalul în formare; acum apare cel în formare |
| Niciun semnal urmărit | ca înainte: cel în formare |
| Doar Long, fără semnal în formare | ca 3.3 |

## FD-FILLS — umplerile indicatorilor standard în tab-ul Stil (21 oct 2026)

### Ce cere utilizatorul
Umplerile indicatorilor standard se pot ascunde și recolora, cu opacitate, ca în tab-ul Stil din TradingView. Exemple: fundalul benzilor Bollinger, Keltner sau Donchian, benzile VWAP, banda 70 / 30 a RSI-ului, norul Ichimoku.

### Comportament
**Unde:** în tab-ul Stil, secțiunea nouă **„Umpleri”**, după liniile orizontale. Fiecare umplere are:
- **bifa „vizibilă”;** o umplere ascunsă nu se desenează;
- **caseta de culoare cu opacitate**, dacă umplerea are o singură culoare. Arată culoarea cu transparența ei de acum: fundalul Bollinger e transparent 95 %, deci caseta arată 5 %.
  - Culoarea aleasă se desenează exact, cu opacitatea ei. Transparența proprie a indicatorului nu se mai adaugă.
- **doar bifa**, la o umplere colorată pe fiecare bară (norul Ichimoku) sau în gradient (supracumpărare / supravânzare la RSI), ca în TradingView.

**Numele:** al umplerii (de exemplu „Background”, „BB Background”, „Cloud Fill”). Dacă nu are nume, apar cele două linii între care stă.

**Care umpleri apar:**
- cele declarate de indicator;
- cele pe care le desenează acum, cu intrările salvate. De exemplu, „BB Background” apare la SMA doar cu netezirea „SMA + Bollinger Bands”.

**Salvarea:** odată cu indicatorul, la „Salvează”. E ținută minte la readăugare (FD-STUDYMEMORY). „Valorile implicite” readuce umplerile ca la început.

**Liniile ascunse:** o umplere legată de o linie ascunsă rămâne ascunsă, ca până acum.

### Edge cases
| Situație | Comportament |
|---|---|
| Indicator fără umpleri | secțiunea nu apare |
| Indicator ascuns (fără rezultat calculat) | apar doar umplerile declarate |
| Două umpleri cu același nume | fiecare rămâne separată: primește un număr |
| Umplere salvată care nu mai apare (alte intrări) | setarea ei rămâne și se aplică dacă apare din nou |
| Studii salvate înainte | nicio umplere modificată: ca acum |

## FD-ORDEREDIT — modificarea ordinelor și a SL / TP (Tranzacții și Grafice) (21 oct 2026)

### Ce cere utilizatorul
- **În Tranzacții:** modificarea a tot ce permite brokerul sau exchange-ul. Cel mai important sunt stop loss-ul și take profit-ul. Fiecare modificare arată impactul asupra PnL-ului.
- **Pe Grafice, ca în TradingView:**
  - liniile SL și TP se trag cu mouse-ul (sau cu degetul) până la nivelul nou;
  - pe linia de intrare apar butoanele **Confirmă** / **Renunță**, care trimit sau anulează modificarea.
- **Alinierea verticală** a textului „KuCoin” (numele exchange-ului, lângă variația pe 24 h din antetul graficului) și a textului „isolated” (lângă simbolul unei poziții futures), cu elementele de lângă ele.

### Ce se poate modifica
1. **SL / TP-ul unei poziții deschise:** poziții futures, poziții eToro, inclusiv dețineri. Se poate:
   - muta un nivel existent;
   - adăuga un SL / TP care lipsește;
   - șterge unul.
2. **Un ordin deschis:**
   - prețul (limită);
   - prețul de declanșare (stop);
   - cantitatea;
   - SL / TP-ul atașat, acolo unde platforma îl ține pe ordin.

Pozițiile fără SL / TP propriu (acțiunile la Alpaca și Trading 212) au stop-urile și țintele ca ordine separate, care se modifică la punctul 2.

### Cum se trimite, pe platforme
| Platformă | Ordin deschis | SL / TP al poziției |
|---|---|---|
| Bybit | modificare directă (`amend`): preț, cantitate, declanșare, TP / SL atașate | SL / TP-ul poziției (`trading-stop`): setare, mutare, ștergere |
| OKX | modificare directă: ordinul (`amend-order`, cu TP / SL atașate) sau ordinul de declanșare (`amend-algos`) | ordinele TP / SL (`conditional` / `oco`): mutare și ștergere directă (`amend-algos`); adăugare ca ordin nou |
| Binance | futures limită: modificare directă (preț, cantitate); spot: înlocuire atomică (`cancelReplace`); stop-urile futures: înlocuire | înlocuire; adăugare ca ordin nou |
| KuCoin | înlocuire (KuCoin nu are modificare pentru futures și ordinele stop) | înlocuire; adăugare ca ordin nou |
| Bitget | înlocuire | înlocuire; adăugare ca ordin nou |
| Kraken (spot) | modificare directă (`AmendOrder`): preț, cantitate, declanșare | — |
| Coinbase (spot) | limită GTC: modificare directă; restul: înlocuire | — |
| eToro | ordinele în așteptare nu se modifică (se anulează și se pune altul) | modificare directă a poziției (`PATCH`): SL, TP, ștergere |
| Alpaca | modificare directă (`PATCH` / replace): preț, declanșare, cantitate (acțiuni întregi), inclusiv SL / TP dintr-un bracket | — (SL / TP sunt ordine) |
| Trading 212 | înlocuire (API-ul nu are modificare) | — |
| Interactive Brokers | — (nu tranzacționează din Sentiq) | — |

**Înlocuirea** înseamnă două cereri, iar ordinea lor contează:
- **Ordinele care doar închid** (SL / TP futures, reduce-only) nu blochează fonduri. Întâi se plasează cel nou, apoi se anulează cel vechi, deci poziția nu rămâne nicio clipă fără stop.
  - Dacă anularea celui vechi eșuează, rămân amândouă. Mesajul spune asta, iar cel vechi se poate anula din listă.
- **Ordinele care blochează fonduri sau ar putea dubla o intrare** (vânzările spot și de acțiuni, ordinele de intrare): întâi se anulează cel vechi, apoi se plasează cel nou.
  - Confirmarea avertizează: „pentru o clipă, ordinul nu există”.
  - Dacă plasarea eșuează, mesajul spune că ordinul vechi a fost anulat și de ce a fost refuzat cel nou.
  - Dacă anularea eșuează (ordinul tocmai s-a executat), nu se plasează nimic.
- **TP / SL atașate unui ordin de intrare:**
  - unde platforma le citește (Bybit, OKX, Bitget), se păstrează la înlocuire;
  - unde nu le citește (KuCoin), formularul spune deschis: ordinul nou pleacă doar cu TP / SL scrise în formular.

### Verificarea și confirmarea
- **Verificarea**, înainte de trimitere, pe server, cu prețul de acum:
  - prețurile se rotunjesc la pasul pieței;
  - SL-ul unui long trebuie să fie sub prețul de acum, iar TP-ul peste. Altfel s-ar executa imediat, deci se refuză cu explicație. La un short, invers;
  - TP / SL ale unui ordin de intrare se compară cu prețul lui de intrare (regulile ordinului nou);
  - cantitatea respectă pasul și minimul pieței.
- **Confirmarea** arată:
  - ce se schimbă (vechi → nou);
  - cum se trimite (modificare directă sau înlocuire, cu ordinea pașilor);
  - avertismentele;
  - impactul asupra PnL-ului.
- **Siguranța**, ca la ordinele noi:
  - doar pe conturile cu tranzacționarea pornită, pe piețele pornite;
  - limita de acțiuni pe minut;
  - jurnalul („Modificare”) cu fiecare pas și rezultatul lui;
  - aceeași confirmare trimisă de două ori pleacă o singură dată.

### Impactul asupra PnL-ului
- **SL / TP al unei poziții:**
  - PnL-ul dacă se atinge nivelul nou, cu procentul față de cost; dacă nivelul e același, ca înainte;
  - diferența față de vechiul nivel.

  Exemplu: „La SL: −42,10 USDT (−1,6 %) · înainte −56,00 USDT · +13,90 USDT”.
  - Un SL / TP care închide doar o parte din poziție se calculează pe cantitatea lui.
  - Un SL șters: „fără stop: pierderea nu mai e limitată de un ordin”.
- **Ordin de intrare** cu TP / SL: PnL-ul la TP și la SL, cu prețul și cantitatea noi, comparat cu cel dinainte.
- **Ordin de intrare fără TP / SL:** valoarea ordinului înainte și după.
- **Unde se vede:** în formular, în confirmare și, pe grafic, pe eticheta liniei trase, în timp ce o tragi.

### În Tranzacții
- **Poziții** (și **dețineri**: eToro cu o singură poziție; crypto spot când au deja ordine SL / TP): butonul **SL / TP**, lângă „Închide” / „Vinde”. Deschide formularul cu SL-ul și TP-ul de acum (sau un câmp gol pentru unul nou, unde se poate adăuga):
  - câmpurile nivelurilor;
  - butonul „Șterge”, pentru fiecare;
  - impactul pe PnL;
  - **Verifică** → confirmare → **Confirmă**.
- **Ordine deschise:** butonul **Modifică**, lângă „Anulează”, doar la ordinele pe care platforma le lasă modificate (sau înlocuite). Formularul are doar câmpurile permise pe acel ordin. La eToro, rândurile SL / TP ale unei poziții deschid formularul poziției.
- **Rezultatul:** „Modificat”, „Înlocuit (ordin nou …)”, sau eșecul, cu pasul la care s-a oprit. Listele se actualizează.

### Pe Grafice
- **Ce se poate trage:**
  - SL-ul și TP-ul fiecărei poziții de pe simbol;
  - linia unui ordin deschis, adică prețul lui sau declanșarea;
  - TP / SL atașate unui ordin deschis, unde platforma le citește (acum apar și ca linii, legate de ordin).
- **Când:** doar pe conturile cu tranzacționarea pornită pentru acea piață. Celelalte linii rămân fixe, ca acum.
- **Cum arată o linie care se poate trage:**
  - o etichetă în grafic, la dreapta, ca în TradingView: „SL · −56,00 USDT (−2,1 %)”;
  - cursorul ↕ deasupra ei;
  - în timp ce o tragi, eticheta arată PnL-ul la noul nivel, iar prețul se rotunjește la pasul pieței.
- **După ce o lași:**
  - linia rămâne la noul nivel, punctată;
  - pe linia de intrare (intrarea poziției, sau linia ordinului) apar **Confirmă** și **Renunță**, la stânga graficului (eticheta liniei e la dreapta); pe telefon, doar iconițele ✓ și ✕;
  - se pot trage și SL-ul, și TP-ul înainte de confirmare.
- **Confirmă:**
  - verificarea serverului; dacă are avertismente, se arată o fereastră de confirmare cu ele;
  - trimiterea;
  - un mesaj cu rezultatul.

  Erorile apar lângă butoane, iar liniile rămân trase ca să poată fi corectate.
- **Renunță:** liniile revin la nivelurile reale.
- **Pe telefon:** o atingere pe o linie o selectează (se îngroașă); apoi se trage cu degetul. O atingere în altă parte o deselectează. Fără selecție, degetul derulează graficul, ca acum.
- **Nimic nu se mută:** butoanele și etichetele stau peste grafic.

### Ce trebuia citit în plus
- **OKX:** ordinele TP / SL ale pozițiilor (algo `conditional` / `oco`) nu erau citite deloc, deci nu apăreau pe grafic. Acum se citesc. Un `oco` (TP și SL în același ordin) apare ca două linii.
- **Bitget:** ordinele TP / SL (`profit_loss`) nu erau citite. Acum se citesc.
- **Ordinele** aduc acum și TP / SL-ul atașat, unde platforma îl dă.

### Alinierea
- „KuCoin” lângă variația pe 24 h, din antetul graficului;
- „isolated” lângă simbolul unei poziții, în tabelul din Tranzacții.

Amândouă se centrează vertical cu elementele de lângă ele (măsurat în Chrome).

### Edge cases
| Situație | Comportament |
|---|---|
| Ordinul s-a executat sau a fost anulat între timp | modificarea directă e refuzată de platformă; la înlocuire, anularea eșuează și nu se plasează nimic. Mesajul explică, iar listele se reîncarcă |
| SL tras peste prețul de acum (long) | refuzat la verificare: s-ar executa imediat |
| Nivel egal cu cel vechi | nicio cerere pentru el |
| Două SL pentru aceeași poziție (unul parțial) | fiecare e o linie separată, care se trage separat |
| Poziție hedge (long și short pe același simbol) | fiecare are SL / TP-ul ei; modificarea numește poziția (positionIdx / posSide / positionSide) |
| SL șters pe o poziție cu levier eToro | eToro îl poate refuza („Normally it cannot be done for leveraged and future positions”): mesajul platformei |
| Bybit, SL / TP de poziție „Full” | `trading-stop` îl mută sau, cu 0, îl șterge |
| OKX `oco`, doar SL-ul mutat | `amend-algos` cu doar `newSlTriggerPx`; TP-ul rămâne |
| Cont demo / paper | merge, cu insigna DEMO în confirmare |
| Tranzacționarea oprită sau piața nepornită | nimic nu se poate trage; butoanele nu apar |
| Două file / două confirmări | a doua primește rezultatul primei (cheia formularului) |
| Limita de acțiuni pe minut | refuzat cu timpul de așteptare |
| Pagina se reîncarcă în timp ce o linie e trasă | linia revine (nimic nu s-a trimis) |
| Prețul se mișcă mult în timpul tragerii | verificarea folosește prețul de la confirmare; linia rămâne sub cursor / deget cât liniile se redesenează |
| Două poziții eToro pe același instrument | fiecare are doar SL / TP-ul ei, pe grafic și în formular |
| Aceleași schimbări făcute din nou, după o trimitere | o acțiune nouă, nu rezultatul celei vechi |
| Un `oco` OKX: SL și TP trase amândouă | o singură confirmare, câte o modificare pentru fiecare nivel |

## FD-TRADEUI — grafica unui trade ca în TradingView; Confirmă / Renunță la dreapta; alinierea peste tot (21 oct 2026)

### Ce cere utilizatorul
- **Butoanele Confirmă / Renunță:** la dreapta, lângă eticheta liniei de intrare, nu în stânga graficului.
- **Grafica unui trade ca în TradingView:** pe fiecare linie, o casetă departe de marginea dreaptă, cu un × care închide trade-ul.
- **× din mesajul „Modificat.”:** aliniat vertical cu textul.
- **Rândurile din Tranzacții:** textul aliniat cu butoanele.
- **Atenție la aliniere peste tot în aplicație.**

### Casetele de pe grafic
- **Pe fiecare linie** (intrare, take profit, stop loss, ordin, TP / SL atașat unui ordin, lichidare), o casetă: **cantitate | text | ×**.
  - Marginea dreaptă e la 64 px de scala prețului, ca în TradingView. Înălțimea e de 20 px, textul de 12 px, centrat pe înălțimea cifrelor.
  - **Textul casetei:**
    - intrarea: PnL-ul de acum;
    - SL, TP și TP / SL atașat: PnL-ul la acel nivel;
    - un ordin: felul și partea („Limită cumpărare”, „Stop vânzare”);
    - lichidarea: „Lichidare”, fără cantitate.
  - **Culoarea textului:** verde pentru un PnL pozitiv, roșu pentru unul negativ; restul, în culoarea liniei.
  - Cu mai multe conturi, textul se încheie cu numele contului („· Main”).
- **Culorile TradingView:** un long albastru, un short roșu, TP verde, SL portocaliu, un ordin în culoarea părții lui (cumpărare albastru, vânzare roșu). Tema deschisă are variante mai închise.
- **Liniile:**
  - intrarea, SL și TP sunt continue;
  - ordinele sunt întrerupte;
  - lichidarea și o linie trasă (nesalvată încă) sunt punctate.

  Prețul rămâne pe scală, în culoarea liniei.
- **Linia separată „PnL acum” nu mai există:** PnL-ul de acum e în caseta intrării.
- **Caseta urmează linia** și când e trasă: textul arată PnL-ul la noul nivel.

### ×
| Linia | Ce face × |
|---|---|
| Intrarea unei poziții | deschide formularul „Închide” al poziției (sau „Vinde” al deținerii), cu confirmarea lui |
| Stop loss / take profit | ștergerea: verificarea serverului, apoi confirmarea (ce se schimbă, avertismentele, PnL-ul) |
| TP / SL atașat unui ordin | scoaterea lui de pe ordin: verificare, apoi confirmare |
| Un ordin | anularea, cu confirmare |
| Lichidarea | nu are × |

- × apare doar unde acțiunea e posibilă: tranzacționarea pornită pe piața aceea și un ordin pe care platforma îl poate schimba sau anula.
- Nimic nu pleacă fără al doilea clic.

### Pointerul
- Linia se trage și de casetă, nu doar de linie, dar nu de ×.
- Cursorul e ↕ peste casetă sau linie și mână peste ×. ×-ul se luminează sub mouse.
- **Pe telefon:** o atingere pe × deschide confirmarea. O atingere pe casetă o selectează, la fel ca pe linie.
- **Tastatura:** casetele sunt desenate în grafic (ca în TradingView), deci nu primesc focus. Aceleași acțiuni sunt în Tranzacții, cu butoane: Închide, SL / TP, Modifică, Anulează.

### Confirmă / Renunță
- **Ca în TradingView:** două casete cu forma, înălțimea (20 px) și fontul casetelor de trade, pe linia de intrare (sau a ordinului), **imediat la stânga casetei** de pe acel nivel, la 6 px.
  - Ordinea e **Renunță** (conturată, fundalul graficului), apoi **Confirmă** (albastrul poziției, text alb), lângă caseta poziției.
  - Pe un ecran tactil au 28 px înălțime (ținta unui deget), cu același aspect.
  - Cât durează verificarea și trimiterea, „Confirmă” arată un cerc care se învârte în locul textului, fără să-și schimbe lățimea.
- **O modificare neconfirmată** (o linie trasă sau lăsată, care încă nu a fost trimisă) arată ca în TradingView:
  - caseta e colorată în nuanța liniei, cu conținutul estompat;
  - linia e punctată și estompată;
  - prețul de pe scală rămâne plin.
- **Eroarea** apare sub ele (deasupra lor, în jumătatea de jos a graficului), aliniată la dreapta cu ele. Pe un ecran îngust pornește din stânga graficului.

### Alinierea
- **× din mesaje** e pe mijlocul primului rând de text.
- **Rândurile tabelelor cu butoane** (Tranzacții: poziții, dețineri, ordine) au toate celulele pe mijlocul rândului. Sigla și numele simbolului sunt pe același mijloc.
- **Iconițele și butoanele radio lângă un text** de unul sau mai multe rânduri stau pe mijlocul primului rând, oricât de mare e fontul:
  - avertismente, erori, cheia cu drept de retragere, categoriile din Economie, alegerea scorului AI;
  - alertele de pe grafic, unde iconița rămâne lângă nume și pe ecran îngust;
  - iconița din rezumatul zilei.
- **Titlul ferestrelor de dialog** (cu sigla platformei) e pe mijlocul antetului, ca ×-ul de închidere.
- **Bifele din tabelul listelor** sunt pe mijlocul rândului.
- **Verificarea:** o măsurătoare automată în Chrome, pe toate paginile și în ferestrele principale, la 1440 / 390 / 320. Compară mijlocul fiecărui text cu al butonului sau iconiței de pe același rând; orice diferență peste 1,5 px e o problemă.

### Edge cases
| Situație | Comportament |
|---|---|
| Linia în afara graficului (sus / jos) | caseta nu se vede, ca linia |
| Două niveluri foarte apropiate | casetele rămân pe linia lor; cea trasă sau selectată e deasupra |
| Grafic îngust (telefon) | caseta rămâne în grafic: se lipește de marginea stângă dacă nu încape |
| Cont fără tranzacționare pe acea piață | caseta, fără × și fără tragere |
| eToro, SL / TP al unei poziții | × îl șterge (`PATCH` cu `clearStopLoss` / `clearTakeProfit`), după confirmare |
| Bara Confirmă / Renunță lângă o casetă lată | bara se mută spre stânga; dacă pe linie nu mai e loc (un telefon), stă deasupra casetei (dedesubt, dacă sus nu încape), aliniată la dreapta cu ea și la cel puțin 8 px de marginea graficului, iar eroarea se deschide în partea opusă casetei |
| PnL-ul își schimbă lățimea cu prețul | bara nu sare între cele două locuri: se întoarce pe linie doar cu 16 px de loc în plus |

## FD-REVERSE — întoarcerea poziției (⇅); zona dintre intrare și SL / TP; etichetele de preț la aceeași mărime (21 oct 2026)

### Ce cere utilizatorul
- **⇅ ca în TradingView:** întoarce poziția, pe grafic și în Tranzacții.
- **Zona colorată:** în timpul tragerii unui TP, spațiul dintre linia de intrare și TP se colorează (verde); la SL, la fel (portocaliu).
- **Etichetele de pe scala prețului:** toate cele cu fundal (prețul curent inclus) au aceeași mărime, care nu se întinde până la marginea dreaptă a scalei.

### Întoarcerea poziției
- **Ce face:** o poziție futures long devine short (sau invers), cu aceeași mărime, levier și marjă.
- **Cum se trimite:** două ordine la piață, pe toate exchange-urile și în ambele moduri (one-way, hedge):
  1. poziția se închide (reduce-only);
  2. se deschide poziția opusă;
  3. ordinele SL / TP ale vechii poziții se anulează (pe Bybit, SL / TP-ul poziției se șterge). Ele erau ale ei; pentru poziția nouă se pun din nou.
  - În modul hedge, cealaltă poziție de pe pereche (dacă există) și ordinele ei rămân neatinse.
- **Unde:**
  - **pe grafic:** ⇅ e o casetă în culoarea poziției, pe linia de intrare, la stânga casetei. Cu o modificare neconfirmată, Renunță și Confirmă stau între ⇅ și casetă (ca în TradingView);
  - **în Tranzacții:** butonul „Întoarce” pe rândul poziției.
- **Confirmarea:**
  - verificarea serverului;
  - poziția de acum și cea care devine (latura, mărimea), levierul și marja, prețul de acum;
  - avertismentele: două ordine la piață; dacă al doilea e refuzat, poziția rămâne închisă; numărul de ordine SL / TP anulate;
  - erorile (ex. poziția nu mai e deschisă);
  - butonul „Întoarce poziția”.
- **Rezultatul:** fiecare pas (închisă, deschisă, ordine anulate), în fereastră și în mesaj. În jurnal apare „Întoarcere poziție”.
- **Siguranța:**
  - doar pe conturile crypto cu tranzacționarea futures pornită;
  - o singură trimitere pe confirmare (cheia);
  - limita pe minut;
  - un pas cu rezultat necunoscut oprește restul.
- **Brokerii nu au ⇅:**
  - Alpaca ține o poziție netă și nu întoarce dintr-un ordin;
  - Trading 212 nu are short;
  - la eToro, short-ul cere stop loss.

### Zona dintre intrare și SL / TP
- **Cât timp tragi** SL-ul sau TP-ul unei poziții, spațiul dintre linia de intrare și nivelul tras se colorează în culoarea liniei (TP verde, SL portocaliu), estompat, sub lumânări, pe toată lățimea graficului.
- La TP / SL-ul atașat unui ordin, zona pornește de la prețul ordinului (cel nou, dacă și ordinul a fost tras).
- Dispare când lași linia.

### Etichetele de preț pe scală
- Toate etichetele cu fundal de pe scala prețului au aceeași geometrie:
  - lățimea textului plus aceleași margini;
  - colțurile rotunjite spre exterior;
  - aceeași distanță de margine.
- Asta include prețul curent (cu numărătoarea inversă a lumânării pe al doilea rând), care se întindea până la marginea dreaptă.

### Edge cases
| Situație | Comportament |
|---|---|
| Al doilea ordin (deschiderea) e refuzat | poziția rămâne închisă; mesajul o spune, iar ordinele SL / TP vechi se anulează oricum (nu mai au poziție) |
| Închiderea e refuzată | nimic altceva nu pleacă |
| Rezultat necunoscut la închidere sau la deschidere | restul se oprește; mesajul cere verificarea pozițiilor |
| Levierul poziției nu e întreg (ex. 3,5×) | rotunjit, cu avertisment |
| Hedge: long și short pe aceeași pereche | se întoarce doar poziția aleasă; ordinele celeilalte rămân |
| Telefon îngust, fără loc pe linie | ⇅ (și butoanele) deasupra sau dedesubt casetei, unde nu acoperă altă casetă |
| Linia de intrare în afara graficului | ⇅ dispare cu ea (Renunță / Confirmă rămân la marginea graficului) |

## FD-CHARTSETTINGS — meniul graficului (click dreapta) și setările graficului, ca în TradingView (21 oct 2026)

### Ce cere utilizatorul
- **Meniul de click dreapta pe grafic:**
  - „Resetează vizualizarea”;
  - „Șterge N desene” (liniile orizontale);
  - „Șterge N indicatori”;
  - **„Setări…”**, cel mai important.
- **Restul meniului TradingView** (copiază / lipește prețul, alerte, ordine, blocarea cursorului vertical, tabel, arborele obiectelor, șabloane) vine mai târziu.
- **„Setări…” deschide o fereastră** cu tab-uri în stânga, cu opțiunile din capturi:
  - Simbol;
  - Linia de stare;
  - Canvas;
  - Alerte.
- **Selectorul de culoare ca în TradingView:**
  - paleta;
  - culorile proprii (+);
  - opacitatea;
  - stilul liniei, unde e o linie.

### Meniul
- **Se deschide** la click dreapta pe grafic, în locul meniului browserului, la cursor, în fereastră. Rândurile au iconiță, text și scurtătură, ca acolo.
- **Rândurile:**
  - **Resetează vizualizarea** (⌥R / Alt+R, și fără meniu, cât timp nu scrii într-un câmp și nu e deschisă o fereastră): ultimele 180 de lumânări cu 20 de bare libere la dreapta, scala prețului din nou automată; vizualizarea ținută minte pentru simbolul și intervalul acesta devine aceasta;
  - **Șterge N desene:** liniile orizontale ale graficului; apare doar când există;
  - **Șterge N indicatori:** toți indicatorii de pe grafic, Slingshot și LMA incluși; apare doar când există;
  - **Setări…**
- **Ștergerile:** nu cer confirmare (ca în TradingView), dar mesajul de jos are **„Anulează”**, care le pune la loc.
- **Tastatura:** săgețile mută selecția (și mouse-ul o mută), Enter alege, Esc sau Tab închid. Un click în afară, o derulare sau redimensionarea ferestrei închid.
- **Locul:** la cursor; lângă marginea dreaptă sau de jos, se deschide spre stânga sau în sus, ca să rămână întreg în fereastră.
- **Pe telefon** (fără click dreapta), butonul ⚙ din colțul din dreapta-jos al graficului, sub scala prețului (unde e în TradingView), deschide direct setările. Pe calculator, ⚙ e acolo la fel.

### Fereastra „Setări”
- **Aspectul:** tab-urile în stânga (pe telefon, sus, pe un rând care se derulează, fără iconițe), conținutul în dreapta, care se derulează, iar jos **Valorile implicite** (stânga), **Renunță** și **OK**. Fereastra are aceeași înălțime pe fiecare tab.
- **Previzualizarea:** orice schimbare se vede pe loc pe grafic. **OK** salvează (pe cont, deci peste tot); **Renunță**, ×, Esc sau un click în afară pun la loc ce era.
- **Ce nu există încă nu apare:**
  - „Template”;
  - tab-urile „Scale și linii”, „Trading” și „Evenimente” (fără capturi);
  - „Butoane de cumpărare / vânzare” (tranzacționarea din grafic vine mai târziu).

**Simbol — Lumânări**
- **Colorează lumânările după închiderea anterioară:** sus / jos după închiderea lumânării dinainte, nu după deschiderea ei.
- **Corp, Margini, Fitil:** fiecare cu o bifă și culoarea de creștere și de scădere. Implicit, aspectul de acum: corp și fitil verde / roșu, fără margini.
- Un indicator care colorează lumânările (LMA cu „Color Price Bars”, orice `barcolor`) schimbă **doar umplerea corpului**; marginea și fitilul rămân în culorile de aici (vezi FD-BARCOLORBODY).

**Simbol — Modificarea datelor**
- **Precizia:** implicită (cea a perechii) sau 0–8 zecimale.
- **Fusul orar:** cel din setările contului (implicit), sau oricare altul, doar pentru grafic: axa timpului și tabelele de sub el (semnalele, alertele).

**Linia de stare** (rândul de sus din stânga graficului, deasupra indicatorilor)
- **Instrumentul:**
  - Logo;
  - Titlul, ca simbol („BTC/USDT”), ca nume („Apple Inc.”; la o monedă, numele ei din aliasurile listei, de exemplu „Bitcoin”) sau ambele, urmat de interval și sursă („· 1h · KuCoin”, ca în TradingView); fără nume, simbolul;
  - Starea pieței (un punct verde deschis / gri închis, cu explicația; crypto: mereu deschis);
  - Valorile lumânării (D, Max, Min, Î);
  - Variația lumânării (± și %);
  - Volumul;
  - Variația față de ziua dinainte (față de închiderea ultimei lumânări a zilei precedente, în fusul graficului), doar sub un interval de o zi: la 1d și 1w, variația lumânării e chiar aceea.

  Valorile sunt ale lumânării de sub cursor (fără cursor, ale ultimei), în culorile corpului lumânării (creștere / scădere); semnul minus e „−” și la sumă, și la procent.
- **Indicatorii:**
  - Titlurile, cu Parametrii (sub-bifă);
  - Valorile;
  - Fundalul, cu opacitatea lui.
- **Implicit:** logo, titlul ca simbol și volumul (ca în TradingView), plus indicatorii cum sunt acum: titluri, parametri, valori, fundal la 75 %.

**Canvas — Stilurile graficului**
- **Fundalul:** plin sau în degrade (două culori, de sus în jos).
- **Liniile grilei verticale / orizontale:** bifă, culoare și stil (continuă, întreruptă, punctată). Implicit fără grilă, ca acum.
- **Separatoarele panourilor:** culoarea.
- **Cursorul în cruce:** culoarea și stilul.
- **Filigranul:** ascuns, sau simbolul și intervalul în mijlocul graficului, cu culoarea lui.

**Canvas — Scale**
- **Textul:** culoarea și mărimea (10–16; implicit 11, ca acum). Eticheta prețului curent urmează aceeași mărime, deci etichetele rămân de aceeași lățime.
- **Liniile:** culoarea marginilor scalelor.

**Canvas — Butoane**
- **Navigare** (butonul „mergi la ultima lumânare”) și **Panou** (ochiul, setările, × din legenda indicatorilor): vizibile când mouse-ul e pe grafic, mereu vizibile sau ascunse.
  - Implicit „mereu”, ca acum.
  - Pe ecranele fără mouse, „vizibile când mouse-ul e pe grafic” înseamnă mereu.

**Canvas — Margini**
- **Sus** și **Jos** (%, spațiul gol al scalei prețului).
- **Dreapta** (bare libere după ultima lumânare).

**Alerte — Notificări**
- **Ascunde automat mesajele:** implicit da. Dacă nu, mesajele de jos (ex. „Modificat.”) rămân până la ×.
- „Liniile alertelor” vin odată cu alertele de preț.

**Culorile implicite** urmează tema (luminoasă / întunecată). O culoare aleasă rămâne aceeași în ambele teme; „Valorile implicite” din colțul ferestrei pun tab-ul curent la loc.

### Selectorul de culoare (oriunde în aplicație)
- **Ca în TradingView:**
  - un rând de gri;
  - un rând de culori de bază;
  - 6 rânduri de nuanțe;
  - **culorile proprii**: + deschide alegerea liberă (hex), iar culoarea se adaugă pe rând, ținută minte în acest browser, cel mult 10;
  - **opacitatea**: glisorul pe tabla de șah și procentul;
  - **stilul liniei** (continuă / întreruptă / punctată) unde culoarea e a unei linii.
- **Același selector** e și la indicatori, Slingshot, LMA și liniile orizontale.

### Edge cases
| Situație | Comportament |
|---|---|
| Setările salvate nu se mai pot citi (o versiune veche) | partea care nu se mai citește (lumânările, precizia, fusul, linia de stare, canvas-ul, alertele) revine la valorile implicite; restul rămâne |
| Fusul orar al graficului nu mai e cunoscut (serverul actualizat) | graficul folosește fusul contului; salvarea merge mai departe |
| Fusul orar al graficului greșit, trimis direct | refuzat |
| „Renunță” după schimbări | graficul revine exact cum era |
| Fereastra închisă din alt motiv (alt simbol, altă pagină) | ca „Renunță” |
| Mărimea textului scalei mărită | scala se lărgește; etichetele, prețul curent inclus, au aceeași lățime |
| Precizia mai mică decât a perechii | prețurile se rotunjesc doar la afișare; ordinele și liniile își păstrează prețul (o linie trasă sau adăugată se rotunjește la precizia perechii) |
| Fundal în degrade | casetele tranzacțiilor, butoanele de lângă linii și banda A / L iau culoarea degradeului de la înălțimea lor |
| Tema schimbată cu fereastra deschisă sau închisă | culorile lăsate „ale temei” o urmează pe loc (și fundalul casetelor) |
| „Șterge N desene”, apoi „Anulează” după ce ai mai tras o linie | liniile șterse revin, iar cea nouă rămâne (în limita de linii) |
| Lista de simboluri închisă pe telefon | ⌥R funcționează (lista închisă nu e o fereastră deschisă) |
| Fusul orar al graficului ≠ al contului | doar graficul (axa timpului, tabelul semnalelor de sub el) |
| Margini sus + jos ≥ 90 % | limitate (sus 0–40 %, jos 0–40 %) |
| „Șterge N indicatori”, apoi „Anulează” după ce mesajul a dispărut | nu se mai poate anula (ca după 4,5 s în TradingView) |
| Click dreapta pe legendă sau pe scale | meniul graficului doar pe zona lumânărilor și a panourilor; pe butoane, meniul lor (nimic) |

## FD-BARCOLORBODY — un indicator colorează doar corpul lumânării (21 oct 2026)

### Ce cere utilizatorul
Când un indicator schimbă culoarea lumânărilor, schimbă **doar culoarea**, adică umplerea corpului. **Marginea** și **fitilul** rămân în culorile din setările graficului (Setări → Simbol → Lumânări).

### Comportament
- **LMA („Color Price Bars”)** și orice indicator cu `barcolor`: corpul ia culoarea indicatorului.
- **Marginea:** culoarea de creștere / scădere din setări. Fără margini bifate, nu există margine.
- **Fitilul:** culoarea de creștere / scădere din setări. Debifat, nu e desenat.
- **Creșterea / scăderea** se socotește ca la lumânările fără indicator: după deschidere sau, cu „Colorează lumânările după închiderea anterioară”, după închiderea dinainte.
- **„Corp” debifat:** indicatorul nu are ce colora; corpul rămâne gol, iar marginea și fitilul ca în setări.

### Edge cases
| Situație | Comportament |
|---|---|
| LMA ascuns (ochiul) sau „Color Price Bars” oprit | lumânările sunt exact cele din setări |
| Margini bifate | culoarea indicatorului umple corpul în interiorul marginii; marginea rămâne cea din setări |
| Lumânare foarte îngustă (zoom mic), fără loc de umplere în interiorul marginii | ca biblioteca: se vede doar marginea |
| Culoarea indicatorului cu opacitate | doar corpul e transparent; marginea și fitilul rămân întregi |
| Tema schimbată | culorile din setări nu depind de temă; nimic nu se schimbă |
| Lumânare doji (deschidere = închidere) | contează ca „creștere”, ca în bibliotecă |

## FD-STYLEUNIFY — Slingshot: culoare, opacitate și mărime pentru fiecare stare; o singură casetă de linie în toți indicatorii (21 oct 2026)

### Ce cere utilizatorul
- **Slingshot:** o culoare (cu opacitate) și o mărime pentru **fiecare stare** a fiecărui element, separat pentru LONG și SHORT. Exemple: semnalul, take profit, stop loss, eșecul, invalidarea.
- **Toți indicatorii** (Slingshot, LMA, cei standard), linia orizontală și setările graficului: **același mod** de a alege culoarea, opacitatea, grosimea și tipul liniei. Până acum, fiecare loc avea altul.
- **Decizia utilizatorului:** caseta din TradingView, cu grosimea 1–4 px.

### Caseta de linie (peste tot)
- **O singură casetă:** în stânga culoarea (peste carouri, ca să se vadă opacitatea), în dreapta linia cu grosimea și tipul ei.
- **Un click** deschide panoul:
  - paleta TradingView și culorile tale (+);
  - **Opacitate** 0–100 %;
  - **Grosime:** patru butoane, 1, 2, 3 și 4 px, fiecare cu linia lui (o grosime veche, peste 4 px, apare ca al cincilea buton);
  - **Stilul liniei:** continuă, întreruptă, punctată.
- **Ce n-are un element nu apare:**
  - un element fără tip de linie (o histogramă, cercuri, cruci) are doar grosimea;
  - o umplere sau o etichetă are doar culoarea și opacitatea;
  - grila graficului are culoarea și tipul (biblioteca nu-i schimbă grosimea).
- **Culoarea care vine din altă parte** (linia de semnal LMA, colorată după stare; EMA-urile Slingshot, colorate după trend): caseta arată culorile, iar panoul are doar grosimea și tipul, cu o notă despre unde se schimbă culoarea.
- **Grosimi vechi de 5–6 px:** indicatorii standard („Foarte groasă” la o linie de 4 px) și Market Structure (până la 5) le păstrează. Butonul lor apare selectat lângă 1–4, până alegi altă grosime.
- **„Implicită / Groasă / Foarte groasă”** (FD-STUDYUX) devine grosimea în pixeli. Grosimea desenată acum e cea selectată.
- **Denumiri unice** pentru stilul liniei, în toată aplicația: „Continuă”, „Întreruptă”, „Punctată”.

### Mărimea (formele și textele)
- **O singură listă,** peste tot: Tiny, Small, Normal, Large, Huge, ca mărimile Pine `size.*`.
- **Aceeași mărime de text** pentru același nume, peste tot: Tiny 9, Small 11, Normal 13, Large 16, Huge 20 px. Textele Market Structure „Normal” și „Large” se aliniază la aceste valori (erau 12 și 14 px).

### Slingshot
**Signals:** fiecare stare pe un rând, cu culoarea și mărimea ei.

| Rând (LONG; la fel SHORT) | Ce este | Implicit |
|---|---|---|
| Long Forming Signal | semnalul în formare (căutarea V2) | culoarea și mărimea semnalului de acum: `#00FFAA` (SHORT `#2196F3`), Small |
| Long Signal | valid: activ sau terminat cu take profit | `#00FFAA` (SHORT `#2196F3`), Small |
| Long Failed Signal | eșuat: și-a atins stop loss-ul (triunghi) | `#FF5252`, Small |
| Long Invalidated Signal | invalidat: X (înlocuit, trend întors, unul nou în formare) | `#FF5252`, Small |
| Long Take Profit | eticheta TAKE PROFIT | `#00FFAA`, Small |
| Long Stop Loss | eticheta STOP LOSS (bara eșecului) | `#FF5252`, Small |

- **Dispar:** Failed Signal Color, Invalidated Signal Color și Signal Size, comune ambelor părți. Fiecare parte își are acum culorile și mărimile ei.
- **O etichetă care își schimbă starea** își schimbă și mărimea: de exemplu, un LONG invalidat ia mărimea „Long Invalidated Signal”.

**ATR Settings:** câte un rând pentru fiecare nivel: Long Take Profit, Long Stop Loss, Short Take Profit, Short Stop Loss.
- Fiecare rând are caseta liniei (culoare, opacitate, grosime, tip) și mărimea etichetei („TAKE PROFIT / preț”).
- **Implicit:** culorile de acum (TP `#00FFAA`, SL `#FF5252`), 2 px, întreruptă, eticheta Small. Până acum, SHORT-ul folosea culorile LONG-ului; acum le are pe ale lui.
- **Caseta TP / SL** din colțul graficului folosește culorile părții.

**Cloud:** culorile trendului rămân (Uptrend / Downtrend).
- **Slow EMA** și **Fast EMA** primesc grosimea și tipul liniei (implicit 1 px, continuă), ca în tab-ul Stil din TradingView.
- Culoarea lor vine din trend.

**Market Structure:** linia Bullish și linia Bearish au fiecare caseta ei (culoare, opacitate, grosime, tip) și mărimea textului ei. Implicit sunt valorile de acum: 1 px, punctată, Small. Lista mărimii textului primește și Huge.

**Setări salvate înainte:** aspectul rămâne exact același.
- Failed / Invalidated Color trec la ambele părți.
- Signal Size trece la toate stările.
- Culorile semnalului trec la „Forming Signal”.
- Culorile ATR trec la SHORT.
- Grosimea, tipul și mărimea textului Market Structure trec la ambele linii.

**Fișierul Pine** (`sling-shot-system-3.4.pine`) primește aceleași intrări, ca Sentiq să rămână portul lui exact. EMA-urile se reglează în TradingView din tab-ul Stil, deci n-au nevoie de intrări.

### LMA
- **Long Threshold, Short Threshold, Neutral Line:** caseta de linie (culoare, opacitate, grosime, tip), cu bifa de afișare și valoarea nivelului, ca în tab-ul Stil din TradingView.
  - Implicit, culoarea e a scriptului: Bullish / Bearish la 30 % transparență, respectiv gri. Urmează culorile din Visual Settings până alegi una.
  - Grosimea implicită: 1 / 1 / 2 px. „Valorile implicite” pune la loc culoarea scriptului.
- **LMA Signal:** caseta cu grosimea (1–4) și tipul liniei; culoarea rămâne după stare.

### Indicatorii standard (tab-ul Stil)
- **Fiecare linie:** bifa, numele, caseta de linie.
- **O linie cu mai multe culori** (o paletă) are câte o casetă pentru fiecare culoare. Grosimea și tipul, comune liniei, se aleg din oricare.
- **Liniile orizontale** au caseta de linie și nivelul. **Umplerile** au caseta de culoare.

### Linia orizontală desenată (FD-HLINE)
- **Linie:** caseta de linie, în loc de culoare + listă de grosime + listă de tip.
- **Textul:** culoarea, mărimea, B / I, ca acum.

### Setările graficului
- **Cursorul în cruce:** caseta cu grosimea (1–4, implicit 1) și tipul.
- **Grila:** caseta cu tipul.

### Edge cases
| Situație | Comportament |
|---|---|
| Setări Slingshot salvate înainte de această versiune | același aspect (preluările de mai sus); la prima salvare se scriu cheile noi |
| Linie standard salvată cu „Foarte groasă” (5–6 px) | caseta arată 5 / 6 selectat lângă 1–4, până alegi alta |
| Market Structure salvat cu 5 px | la fel, „5” rămâne până alegi alta |
| LMA: schimbi Bullish Color după ce ai ales culoarea pragului Long | pragul își păstrează culoarea aleasă (ca în TradingView); fără alegere, o urmează |
| Opacitate 0 % | elementul e invizibil, dar rămâne (ca în TradingView) |
| Doar Long activ | rândurile SHORT rămân în formular, fără efect până activezi Short |
| O etichetă devine invalidată live, apoi validă la loc | revine la culoarea și mărimea „Long Signal” |
| Mărimi mari (Huge) pe telefon | formele sunt mari, ca în TradingView; nimic nu iese din panou |
| Panoul de culoare lângă marginea ecranului | rămâne în ecran (stânga / deasupra casetei) |
| Grosimea în panou cu tastatura | butoanele se aleg cu Tab și Enter, ca restul panoului |

## FD-TRADESOUND — un sunet la închiderea unui trade, cât timp graficul e deschis (21 oct 2026)

### Ce cere utilizatorul
Când un trade se termină, prin stop loss, take profit sau închidere manuală, se aude o dată `coin-money.mp3`. Doar cât timp pagina graficului e deschisă și se vede.

### Comportament
- **Ce e un trade terminat:**
  - o **poziție** care nu mai există (futures; la eToro, fiecare poziție a instrumentului: una închisă din mai multe e un trade terminat);
  - o **deținere vândută** în întregime: o monedă spot sau o acțiune care avea cel puțin 1 (în moneda contului) și din care a rămas cel mult 1 %.
- **Toate conturile tale contează,** nu doar simbolul deschis: un trade ETH închis cât te uiți la BTC sună și el.
- **Cum se află:** cât timp graficul se vede, portofoliile se citesc la 20 de secunde (serverul nu întreabă bursa mai des decât până acum). Un trade închis din Sentiq (×, „Întoarce poziția”, formularul de ordin) sună imediat ce se citește portofoliul.
- **O singură dată:** mai multe trade-uri închise în același timp dau un singur sunet.
- **Doar cât te uiți:**
  - fila ascunsă (alt tab, ecran blocat) nu cântă;
  - ce s-a închis între timp nu cântă la întoarcere (prima citire de după e punctul de plecare);
  - pe altă pagină (Tranzacții, Azi) nu se aude nimic.
- **Setarea:** Setările graficului → Alerte → „Sunet la închiderea unui trade” (implicit pornit).

### Edge cases
| Situație | Comportament |
|---|---|
| Deschizi graficul | prima citire e punctul de plecare: trade-urile închise înainte nu sună |
| Închidere parțială | nu sună (trade-ul continuă) |
| Poziție întoarsă (⇅) | sună: trade-ul vechi s-a terminat |
| Lichidare | sună (poziția s-a terminat) |
| Bursa nu răspunde la o citire (eroare, date vechi) | citirea aceea nu se compară: o poziție lipsă din cauza erorii nu sună |
| Un cont adăugat sau șters cât graficul e deschis | contul nou începe de la prima lui citire; cel șters nu sună |
| Un cont cu date de la închiderea zilei (IBKR Flex) | nu se citește la 20 s; nu sună |
| O monedă transferată în alt cont (retragere) | arată ca o vânzare: sună |
| Prima atingere pe iPhone / iPad | sunetul e pregătit la prima atingere (Safari nu redă sunete înainte de o atingere); până atunci, nimic |
| Sunetul oprit din setări | nu sună; citirile continuă pentru liniile de pe grafic |
| Mai multe file cu graficul | sună doar fila care se vede |

## FD-MACRORULES — ce este o știre macro (21 oct 2026)

### Ce cere utilizatorul
- **Categoria Macro** (lista de știri și scorul Macro) primește doar știri despre economie la nivel de țară sau de sistem financiar, după regulile utilizatorului. Nu știri despre companii individuale.
- **Decizia utilizatorului:** o știre care nu respectă regulile ajunge la subiectul ei:
  - o companie → Acțiuni;
  - crypto → Crypto;
  - geopolitică → Geopolitică;
  - altfel → „Altele”, o categorie nouă, fără scor.

### Regulile (de la utilizator)
1. **Politica monetară și băncile centrale:**
   - deciziile de dobândă (Fed, BCE, Banca Angliei, Banca Japoniei și celelalte bănci centrale);
   - QE / QT;
   - randamentele titlurilor de stat (2 ani, 10 ani…) și curba randamentelor;
   - dobânzile ipotecare ca efect al lor.
2. **Inflația:**
   - CPI, PCE, PPI;
   - șocurile de preț de la intrare: energia (țiței, gaze), produsele agricole.
3. **Creșterea economică:**
   - PIB;
   - PMI / ISM;
   - vânzările retail, încrederea consumatorilor;
   - recesiunea, expansiunea, încetinirea.
4. **Piața muncii:**
   - locurile de muncă create (nonfarm payrolls);
   - cererile de șomaj, rata șomajului;
   - salariile (câștigul mediu orar).
5. **Politica fiscală și datoria suverană:**
   - deficitele și bugetele, stimulii, austeritatea;
   - ratingurile suverane;
   - licitațiile de titluri de stat;
   - costul dobânzilor la datoria publică.
6. **Comerțul și valutele:**
   - balanța comercială, contul curent, importurile și exporturile;
   - valutele (indicele dolarului, EUR/USD, USD/JPY…);
   - tarifele, controlul exporturilor, lanțurile de aprovizionare (reshoring).

**Temele dominante:**
- randamentele reale și povara datoriilor suverane;
- creșterea divergentă (serviciile din SUA, industria din Europa, imobiliarele din China);
- investițiile în infrastructura AI și cererea de credit (emisiunile de obligațiuni corporative la nivel de piață);
- volatilitatea mărfurilor și cea geopolitică: coridoarele maritime, primele de risc la petrol, transport, metale prețioase.

### Cum se decide
- **Fiecare arie contează o dată** (Brent și „crude” sunt aceeași temă): numărul de arii din titlu se compară cu semnele de companie din titlu.
- **Titlul contează cel mai mult.**
  - **Macro:** titlul vorbește despre una dintre temele de mai sus mai mult decât despre o companie.
  - **Companie:** titlul numește o companie (Apple, Nvidia, Tesla…) sau folosește cuvintele unei companii (rezultate, venituri, profit, acțiunile companiei, CEO, IPO, fuziune…). Cu tot atâtea semne de companie cât de macro, știrea e despre companie.
  - **Instituțiile care comentează economia** (Goldman Sachs, JPMorgan, Morgan Stanley, Moody's, S&P, Fitch, FMI…) nu fac o știre „despre o companie”: „Goldman vede Fed tăind dobânda în decembrie” e macro.
  - **Piața în ansamblu** („acțiunile europene”, „Wall Street”, „S&P 500”) nu e o companie: „Acțiunile scad după un CPI peste așteptări” e macro.
- **Fără nicio temă în titlu,** știrea e macro doar dacă rezumatul are cel puțin două teme diferite și titlul nu e despre o companie.
- **Doar mișcarea pieței** („S&P 500 la un nou record”), fără o temă macro, nu e macro. Ajunge la Acțiuni (dacă e despre acțiuni) sau la „Altele”.

### Unde se aplică
- **Sursele Macro** (o singură categorie):
  - macro: știrile care respectă regulile;
  - celelalte trec la subiectul lor (Acțiuni / Crypto / Geopolitică, după cuvintele și numele din ele) sau la „Altele”.
- **Sursele cu mai multe categorii** (FD-MULTICAT): Macro intră în alegere doar când regulile se potrivesc.
  - O știre care ar ajunge Macro fără să le respecte trece, la fel, la subiectul ei sau la „Altele”.
  - O știre care nu e despre nicio categorie a sursei rămâne ca până acum (prima categorie, fără scor), cu o excepție: dacă prima e Macro, merge și ea la subiectul ei sau la „Altele”.
- **Sursele Crypto, Acțiuni și Geopolitică** nu se schimbă.
- **„Altele”:**
  - se vede în „Toate” și are filtrul ei pe pagina de știri, cu eticheta „Altele”;
  - relevanța e 0: nu intră în niciun scor, în rezumatul AI sau în „Cum s-a calculat?”.

### Subiectul unei știri care nu e macro
- **Acțiuni:** o companie numită, cuvintele unei companii, forma ei juridică (Inc, Corp, plc, Bancorp…), o recomandare a unui analist (raised to Buy, price target…) sau un act corporativ (plasament privat, contract, FDA, lansare…).
- **Crypto:** o monedă numită sau cuvintele crypto. „Mining” / „miners” / „wallets” nu mai contează: minele de aur nu sunt crypto (valabil și pentru sursele cu mai multe categorii).
- **Geopolitică:** cuvintele ei.

### Verificat pe știrile reale
Pe 3 976 de știri din sursele Macro (ultimele 3 zile, 21 oct 2026), fără să se scrie nimic în bază:
- 410 au rămas Macro (dobânzi, inflație, randamente, petrol, valute, bugete, FMI…);
- 2 203 au trecut la Acțiuni (rezultate, recomandări, companii);
- 62 la Geopolitică, 38 la Crypto;
- 558 la Altele (proteste, sănătate, tehnologie fără o companie recunoscută).

### Știrile deja salvate
- La prima pornire după actualizare, toate știrile păstrate sunt reclasificate după aceste reguli.
- Istoricul scorurilor se recalculează o dată pentru zilele ale căror știri sunt încă păstrate, ca în FD-IMPACT §3. Zilele mai vechi își păstrează valoarea.

### Edge cases
| Situație | Comportament |
|---|---|
| „Apple says tariffs will cost $1.1 billion” | Acțiuni (companie + o singură temă: egalitate, câștigă compania) |
| „Trump announces 25% tariffs on EU cars” | Macro |
| „Exxon profit falls as oil prices slide” | Acțiuni |
| „Oil jumps as OPEC+ cuts output” | Macro |
| „European shares slip as ECB holds rates” | Macro (piața în ansamblu nu e o companie) |
| „Goldman sees Fed cutting in December” | Macro (o instituție care comentează) |
| „Nvidia hits $5 trillion as AI spending booms” | Acțiuni |
| „AI data center boom drives record corporate bond issuance” | Macro (tema cererii de credit) |
| „Bitcoin rises as dollar weakens” dintr-o sursă Macro | Macro (dolarul); dintr-o sursă Crypto rămâne Crypto |
| „S&P 500 hits record” fără temă macro | Acțiuni |
| O știre fără nicio temă (sport, sănătate…) dintr-o sursă Macro | „Altele”, fără scor |
| Sursa schimbată din Macro în altă categorie | știrile ei urmează categoria nouă (ca până acum) |
| O temă doar în rezumat | macro doar cu cel puțin două teme diferite și un titlu care nu e despre o companie |

## FD-BOT — boți de tranzacționare în Grafice: Grid, DCA și Slingshot Premium (21 oct 2026)

### Ce cere utilizatorul
- Un buton **„Bot”** lângă „Tranzacționează”, pe grafic.
- Botul pornește cu simbolul graficului, dar se pot alege și altele.
- **Două familii, care nu se amestecă:**
  - **Clasic:** setările obișnuite ale boților de pe piață (cercetare: research §14);
  - **Premium:** metoda Sentiq. Semnalele Slingshot (long, short, take profit, stop loss) sunt declanșatorul. Scorul zilei, sentimentul ariei (crypto sau acțiuni), sentimentul general și știrile decid dacă intrarea are sens. Modelul AI al utilizatorului poate face o ultimă verificare. LMA nu se folosește.
- **Limitele utilizatorului:**
  - doar long, doar short sau ambele;
  - suma maximă;
  - levierul maxim;
  - raportul risc / câștig al fiecărei tranzacții, sau SL / TP-ul Slingshot;
  - perioada (de la – până la).

### 1. Butonul și fereastra
- **„Bot”** (iconița unui robot) stă imediat după „Tranzacționează”, în același rând. Lipsește pe un indice, ca „Tranzacționează”.
- **Se vede și fără un cont de tranzacționare:** simularea nu are nevoie de cont.
- **Deschide fereastra „Boți”:**
  - lista boților utilizatorului, cu „Bot nou”;
  - fără niciun bot, fereastra se deschide direct pe alegerea tipului.
- **Bot nou:**
  1. alegerea tipului: Clasic (Grid sau DCA) sau Premium (Slingshot);
  2. formularul, completat cu simbolul și timeframe-ul graficului;
  3. un rezumat în cuvinte („Ce va face botul”), capitalul folosit și avertismentele;
  4. „Pornește botul” sau „Programează” (când începutul e în viitor).
- **Pe telefon:** fereastra ocupă lățimea ecranului (ca formularul de ordin). Nimic nu iese din ecran pe orizontală.

### 2. Execuția: Simulare sau Real
- **Simulare** (implicit):
  - nicio comandă nu pleacă spre o platformă;
  - botul face exact ce ar face în real, la prețul de atunci, cu un comision simulat (implicit 0,1% la fiecare execuție);
  - capitalul de pornire = suma maximă;
  - merge pe orice simbol: crypto (spot sau futures) și acțiuni.
- **Real:**
  - **Ce cere:** un cont cu tranzacționarea pornită pentru piața aleasă, din pagina Tranzacții: crypto (spot sau futures) sau un broker de acțiuni (Trading 212, eToro, Alpaca; §10).
  - **Cum pleacă ordinele:** la piață, prin același drum ca formularul de ordin (aceleași verificări, același jurnal din Tranzacții, aceeași cheie anti-dublură). Fiecare ordin are cheia lui, salvată înainte de trimitere: o repornire în timpul trimiterii nu face două ordine.
  - **La pornire:** o bifă obligatorie: „Înțeleg că botul trimite ordine reale în contul X”.
  - **Conturile demo** (testnet) au eticheta DEMO, ca peste tot.
- **Acțiunile merg și în real** (FD-BOTSTOCKS, §10), la fiecare broker cum închide el: eToro după id-urile pozițiilor botului, Trading 212 și Alpaca prin vânzarea cantității botului.
- **Execuția, contul și piața nu se schimbă** după pornire. Pentru altele: un bot nou („Duplică”).

### 3. Ce e comun tuturor boților
| Setare | Ce face | Implicit |
|---|---|---|
| Nume | apare în listă | „BTC/USDT · Grid” |
| Simbol(uri) | Grid și DCA: unul; Premium: unul sau mai multe (cel mult 10) | simbolul graficului |
| Piața | spot / futures (crypto); acțiuni | spot |
| Suma maximă | cât poate avea botul angajat în orice moment: valoarea cumpărată pe spot, marja pe futures. Obligatorie | — |
| Levier maxim | doar futures, 1× … maximul platformei | 3× |
| Început | acum sau o dată și o oră | acum |
| Sfârșit | o dată și o oră, sau fără sfârșit | fără |
| La sfârșit / la oprire | Închide pozițiile · Termină tranzacțiile deschise (fără altele noi; nu la Grid) · Lasă pozițiile deschise | Termină tranzacțiile deschise (Grid: Închide pozițiile) |
| Pierdere maximă pe zi | ajunsă (realizat + nerealizat de azi, în fusul utilizatorului): nicio intrare nouă până mâine; ieșirile continuă | 10% din suma maximă (se poate goli) |
| Oprește la o pierdere de | ajunsă (realizat + nerealizat, de la pornire): botul închide tot și se oprește | gol |
| Comision | în simulare se scade din fiecare execuție; în real estimează câștigul afișat (platforma ia comisionul ei) | 0,1% |

**Stările unui bot:**
- **Programat:** începutul e în viitor.
- **Rulează.**
- **Pauză:** pusă de utilizator. Nicio intrare nouă; ieșirile (SL, TP, grila care vinde) continuă.
- **Problemă:** platforma a refuzat ceva ce botul nu poate rezolva singur (tranzacționarea oprită, cheia fără drept, rezultatul unui ordin necunoscut, o ieșire refuzată de 10 ori).
  - Botul nu mai trimite niciun ordin, nici ieșiri: un ordin al cărui rezultat nu se știe poate a ajuns deja, iar o a doua închidere ar vinde ce nu mai e al lui.
  - Prețurile și pozițiile din cont se urmăresc în continuare: o poziție închisă între timp apare „din afară”.
  - Mesajul spune ce s-a întâmplat. „Reia” pornește din nou botul (și ieșirile).
  - Prețul care nu se poate citi de 10 minute e tot o Problemă, dar trece singură când prețul revine.
- **Se încheie:** închide pozițiile, sau așteaptă să se termine tranzacțiile deschise.
- **Încheiat:** cu motivul. Botul nu se mai poate porni; „Duplică” face unul nou cu aceleași setări.

**Limite:**
- cel mult **10 boți activi** pe utilizator (orice stare în afară de Încheiat);
- un singur bot **real** activ pe același cont, piață și simbol (doi s-ar încurca pe aceeași poziție).

### 4. Grid (clasic)
**Setări:**
- **Limita de jos și de sus.** Implicit: minimul și maximul ultimelor 100 de lumânări ale graficului. Jos < sus.
- **Grile:** 2–100 de intervale.
- **Spațierea:** aritmetică (pas egal) sau geometrică (procent egal).
- **Direcția:**
  - spot: doar Long;
  - futures, acțiunile în simulare și acțiunile la eToro: Long / Short / Neutru;
  - acțiunile la Trading 212 și Alpaca: doar Long (§10).
- **Investiția:** cât din suma maximă folosește (pe futures e marja; poziția = investiția × levier).
- **Levierul:** futures.
- **„Oprește sub” / „Oprește peste”** (opționale): un preț sub limita de jos / peste cea de sus. Atins, botul închide tot și se încheie.
- **Prețul de pornire** (opțional): botul așteaptă până când prețul îl atinge.

**Cum lucrează:**
- **Intervalele:** liniile L0 < L1 < … < Ln împart intervalul în n intervale. Fiecare interval cumpără la linia lui de jos și vinde la cea de sus (unul „long”), sau invers (unul „short”).
- **Cantitatea:** egală pe fiecare interval: investiția × levier / suma prețurilor de intrare ale tuturor intervalelor. Așa, toate intervalele pline la un loc nu depășesc investiția.
- **La pornire:**
  - **Long:** intervalele de deasupra prețului se cumpără la piață (au ce vinde când urcă prețul);
  - **Short:** intervalele de sub preț se vând la piață;
  - **Neutru:** nu cumpără nimic la pornire. Intervalele de sub preț sunt long, cele de deasupra short.
  - Intervalul în care e prețul așteaptă (ca linia fără ordin de pe Binance).
- **La fiecare verificare** (la 30 s; acțiunile: cât timp bursa e deschisă):
  - un interval long gol se umple când prețul e la sau sub linia lui de jos;
  - unul plin se golește când prețul e la sau peste linia lui de sus;
  - short-ul în oglindă.
  - Toate intervalele atinse se execută împreună, într-un singur ordin (cumpărările minus vânzările).
- **În afara intervalului:** botul nu face nimic până revine prețul (sau până la „Oprește sub / peste”).
- **Câștigul:**
  - fiecare interval golit e o tranzacție încheiată: cantitatea × (vânzare − cumpărare) − comisioanele;
  - intervalele pline intră în nerealizat.
- **Rezumatul formularului:** prețurile liniilor, cantitatea pe grilă, câștigul pe grilă (în % după comisioane) și valoarea minimă a ordinului pe platformă.
  - O grilă sub minimul platformei e o eroare: „Ordinul unei grile (4,1 USDT) e sub minimul KuCoin (5 USDT): mai puține grile sau o investiție mai mare.”
  - Un câștig pe grilă mai mic decât comisioanele e o eroare.

### 5. DCA (clasic)
**Setări** (numele de la 3Commas, în română):
- **Direcția:** Long / Short (short: pe futures, pe acțiunile în simulare și la eToro, §10).
- **Ordinul de bază:** suma.
- **Ordinele de siguranță:**
  - câte (0–25);
  - suma primului;
  - multiplicatorul de volum (1–5);
  - abaterea până la primul (0,1–50%);
  - multiplicatorul de pas (0,5–5).
- **Take profit:** % din prețul mediu.
- **Stop loss** (opțional): % din prețul ordinului de bază.
  - Acțiunea la SL: „Închide și începe alt ciclu” sau „Închide și oprește botul” (implicit).
  - Un SL mai aproape decât ultimul ordin de siguranță e o eroare: ordinele de după el n-ar avea loc.
- **Ciclurile:**
  - „Repetă după take profit” (implicit da);
  - câte cicluri cel mult (opțional);
  - pauza între cicluri (minute).
- **Levierul:** futures.

**Cum lucrează:**
- **Ordinul de bază:** un ciclu începe cu el, la piață, la prima verificare permisă.
- **Ordinul de siguranță k** se execută când prețul ajunge la prețul de bază × (1 − abaterea k) (long). Abaterea k = abaterea 1 × (1 + m + m² + … + m^(k−1)), m = multiplicatorul de pas. Mărimea lui = primul × volumul^(k−1).
- **Mai multe ordine atinse odată** (o cădere bruscă) se execută împreună.
- **Take profit-ul** se recalculează din prețul mediu după fiecare ordin de siguranță.
- **Capitalul necesar** = ordinul de bază + suma tuturor ordinelor de siguranță (marja, pe futures). Trebuie să încapă în suma maximă. Rezumatul arată tabelul ordinelor: abaterea, prețul la prețul de acum, suma și prețul mediu după fiecare.

### 6. Premium: Slingshot + sentimentul Sentiq (+ AI)
**Setări:**
- **Simbolurile:** unul sau mai multe (crypto și acțiuni separat: un bot are o singură arie).
- **Timeframe-ul:** al graficului.
- **Semnalele:** setările Slingshot ale utilizatorului, aceleași ca pe grafic.
- **Direcția:** Long / Short / Ambele. Pe spot nu se poate short (nimic de vândut), iar la Trading 212 și Alpaca nici: acolo, Short și Ambele lipsesc (§10).
- **Mărimea unei tranzacții:**
  - „Sumă fixă” (marja / valoarea pe tranzacție);
  - sau „Risc %” din suma maximă: pierderea la SL = atât.
  - Opțional: „Suma maximă pe tranzacție”.
- **Ieșirea:**
  - **Stop loss și take profit** (FD-BOTSLRR, FD-BOTPCT): „Slingshot” (SL-ul și TP-ul semnalului) sau „Risc / câștig” (SL-ul și TP-ul tău, în procente de la intrare, implicit 1% și 2%; raportul calculat, „1:2”);
  - „Ieși la semnalul de take profit Slingshot” (implicit da);
  - „Ieși când trendul se întoarce” (invalidarea Slingshot; implicit da);
  - „La semnal opus: închide” (implicit da).
- **Filtrul:**
  - pragurile scorului pieței (FD-BOTDIR): „Scorul minim pentru long” și „Scorul maxim pentru short” (implicit 50 amândouă);
  - „Nu intra împotriva ariei” (implicit da);
  - „Evită deschiderea de tranzacții în perioada știrilor economice importante” (FD-NEWSWIN; înainte „Ferește știrile”): minute înainte de un eveniment cu impact mare din calendar, plus 15 după (implicit 60; 0 = oprit);
  - **Avansat:** ponderile scorului.
- **AI:**
  - „Fără AI” (implicit) sau „AI confirmă” (cu modelul ales în Setări → AI);
  - dacă AI-ul nu răspunde: „Nu intra” (implicit) sau „Intră după reguli”.
- **Tranzacții deschise odată:** implicit câte simboluri are botul.
- **Pauză după o pierdere:** minute; implicit 0.

**Declanșatorul (pe lumânarea care tocmai s-a închis):**
- **LONG** confirmat pe ea (nu provizoriu) → candidat long. **SHORT** confirmat → candidat short.
- **Un semnal mai vechi** (botul a lipsit o lumânare: server oprit, pauză) nu mai e luat: „Semnal prea vechi”.
- **Semnalul de take profit Slingshot** al laturii unei poziții deschise → ieșire, dacă opțiunea e pornită.
- **Semnalul pe care a intrat botul invalidat de întoarcerea trendului** → ieșire, dacă opțiunea e pornită.
  - Un semnal înlocuit de unul nou de aceeași latură nu închide poziția: ea rămâne cu nivelurile ei, fără ieșire și reintrare.
- **SL-ul și TP-ul** se verifică la fiecare 30 s, la prețul de atunci.

**Decizia, în ordinea verificărilor (prima care spune „nu” oprește intrarea; jurnalul spune care):**
1. Direcția e permisă.
2. Semnalul e proaspăt și confirmat.
3. **Prețul n-a trecut deja de SL sau de TP-ul semnalului:** „Prețul a trecut deja de stop loss”. Cu „Slingshot”, nicio altă condiție pe niveluri: niciun R:R (FD-BOTSLRR).
4. **Calendarul:** niciun eveniment USD cu impact mare în următoarele N minute sau în ultimele 15.
5. **„Nu intra împotriva ariei”:** long cu aria sub 40 (negativă), short cu aria de la 60 (pozitivă) → nu.
6. **Scorul pieței la prag (FD-BOTDIR):** long la scor ≥ minimul pentru long, short la scor ≤ maximul pentru short.
7. **Locul:**
   - mai puțin decât „tranzacții deschise odată”;
   - simbolul fără o poziție a botului;
   - nicio pauză după o pierdere în curs;
   - pierderea pe zi neatinsă;
   - suma disponibilă (suma maximă − cât e angajat) ajunge pentru minimul platformei.
8. **AI** (dacă e pornit). AI-ul poate doar să oprească o intrare pe care regulile au aprobat-o, niciodată să pornească una refuzată.
9. **În real:**
    - destui bani liberi în cont;
    - pe futures, nicio poziție pe simbol care să nu fie a botului.

**Scorul pieței (0–100), din cinci părți (FD-BOTDIR).** Fiecare dă o înclinare a între −1 (spre scădere, favorizează short-ul) și +1 (spre creștere, favorizează long-ul). Până la FD-BOTDIR, a era acordul cu tranzacția (la short, semnul invers) și exista un singur scor minim:
| Parte | Ce citește | a | Pondere implicită |
|---|---|---|---|
| Scorul zilei | indicele de azi, toate categoriile | (indice − 50) / 50 × încrederea (mare 1, medie 0,75, mică 0,5) | 20 |
| Aria | indicele de azi al ariei (Crypto sau Acțiuni) | (indice − 50) / 50 × încrederea după numărul de știri (≥ 10: 1; 3–9: 0,75; 1–2: 0,5) | 30 |
| Sentimentul general | media indicelui pe ultimele 7 zile | (medie − 50) / 50 | 15 |
| Știrile simbolului | indicele știrilor despre simbol din ultimele 24 h, cu aceeași formulă ca indicele zilei | (indice − 50) / 50 × încrederea lui | 15 |
| Slingshot | structura pieței (fără R:R, FD-BOTSLRR) | 0,4 × (ultima rupere de structură: în sus +1, în jos −1, niciuna 0) | 20 |

- **Formula:** scor = 50 + 50 × Σ(pondere × a) / Σ ponderi.
  - Se adună doar părțile care au date: fără știri despre simbol, partea lui lipsește din ambele sume.
  - Indicele e al utilizatorului (cu scorurile AI-ului lui, unde există), în fusul lui orar.
- **De ce pragurile implicite sunt 50:** semnalul Slingshot e motivul intrării. Scorul doar oprește intrările împotriva contextului.
  - Un context neutru trece în ambele direcții (50; cu o rupere de structură în sus ≈ 54, în jos ≈ 46).
  - Pentru mai puține intrări, mai sigure: minimul long mai mare (55–70), maximul short mai mic (30–45).

**AI-ul („AI confirmă”):**
- **Primește:**
  - simbolul, latura și timeframe-ul;
  - prețul și nivelurile (SL, TP, cu sursa lor; fără R:R, FD-BOTSLRR);
  - trendul și structura;
  - cele cinci părți ale scorului;
  - cele mai importante 10 știri despre simbol din ultimele 24 h (cu scorul lor);
  - motivele zilei (driverele indicelui);
  - evenimentele cu impact mare din următoarele 24 h;
  - ultimele 5 tranzacții ale botului.
- **Răspunde:** „intră” / „nu intra”, o încredere 0–100, motivul (o frază, în română) și riscurile.
- **În jurnal:** motivul și încrederea.
- **Limite:** cel mult 30 de întrebări pe zi pentru un bot. Peste ele, ca și cum AI-ul n-ar răspunde.
- **Costul** intră în consumul AI din Setări → AI (rândul „Boți”).

**Mărimea:**
- **Sumă fixă:** marja = suma; levierul = levierul maxim; valoarea = suma × levier (spot: valoarea = suma).
- **Risc %:**
  - pierderea dorită = suma maximă × risc %;
  - valoarea = pierderea / distanța până la SL (în %);
  - levierul = cel mai mic care încape în suma disponibilă, până la cel maxim;
  - dacă nici cu levierul maxim nu încape, valoarea scade: riscul e mai mic decât cel cerut, iar jurnalul o spune.
- **Lichidarea** (futures): SL-ul trebuie atins cu mult înainte de lichidare (distanța SL < 80% din distanța lichidării, ≈ 1/levier − 0,5%). Altfel levierul scade până e adevărat.
- **Suma maximă pe tranzacție** (dacă e pusă) și suma disponibilă limitează oricum.

**Ieșirea (la fiecare verificare):**
- **SL / TP atins** → închide la piață.
- **La închiderea unei lumânări:** semnalul de TP Slingshot, invalidarea prin trend sau semnalul opus → închide, după opțiuni.
- **Semnalul opus** cu latura permisă și filtrul trecut: după închidere, botul intră pe latura nouă la aceeași verificare.
- **În simulare, pe futures:** prețul de lichidare atins (≈ intrare × (1 ∓ 1/levier ± 0,5%)) → poziția se închide cu pierderea întregii marje.

### 7. Ce se vede despre un bot
- **Lista:**
  - numele;
  - strategia (Grid / DCA / Slingshot);
  - SIMULARE / REAL (+ DEMO);
  - starea;
  - simbolurile;
  - câștigul realizat și cel nerealizat;
  - tranzacțiile încheiate și cât la sută au câștigat.
- **Detaliile:**
  - **Butoanele:** Pauză / Reia, Oprește, Editează, Duplică, Șterge (doar încheiat).
  - **Cifrele:** suma angajată din suma maximă, câștigul realizat și cel nerealizat, tranzacțiile și rata de câștig.
  - **Pozițiile deschise:** simbol, latură, cantitate, intrare, preț, SL / TP, nerealizat.
  - **Grid:** liniile cu intervalele pline și cele goale.
  - **DCA:** ciclul în curs, cu ordinele de siguranță executate și cele care urmează.
  - **Tranzacțiile încheiate:** intrare, ieșire, câștig și motivul (TP, SL, semnal TP, invalidare, semnal opus, grilă, sfârșit, oprire, lichidare, din afară).
  - **Jurnalul:** fiecare decizie, cu ora.
    - Semnalele refuzate apar cu motivul și cu scorul defalcat pe cele cinci părți, plus răspunsul AI.
    - Ordinele, cu rezultatul.
    - Problemele.
    - Se păstrează ultimele 1 000 de rânduri ale unui bot.
- **Oprește:**
  - întreabă ce face cu pozițiile: „Închide pozițiile” / „Lasă-le deschise”; DCA și Premium mai au „Termină tranzacțiile deschise”;
  - închiderea o face botul la următoarea verificare (≤ 30 s); până atunci, starea e „Se încheie”.
- **Editează** (un bot neîncheiat):
  - **Oricând:** numele, sfârșitul și ce face la sfârșit, pierderea maximă pe zi, „Oprește la o pierdere de”, comisionul.
  - **DCA și Premium:** suma maximă (nu sub cât e angajat). La o grilă, suma e investită la pornire: nu se schimbă.
  - **Premium:** levierul maxim, direcția, filtrul, AI-ul, mărimea și ieșirea, pentru tranzacțiile care urmează; timeframe-ul semnalelor (FD-BOTTF).
  - **Restul** (grila, ordinele DCA, simbolurile, execuția, contul) doar la un bot nou: „Duplică” deschide formularul cu aceleași setări.
- **Pozițiile reale ale botului** apar și pe grafic, cu „Pozițiile mele”, și în Tranzacții. Ordinele lui sunt în jurnalul din Tranzacții.

### 8. Cum rulează
- **Pe server**, fără pagina deschisă: o verificare la 30 s, pe serverul care rulează job-urile (unul singur). Fiecare bot pe rând; o problemă la unul nu le oprește pe celelalte.
- **Prețul:**
  - crypto: ultima lumânare de 1 minut a sursei graficului (cea din Setări → Piață);
  - acțiuni: cotația Nasdaq (cel mult o dată pe minut), doar cât bursa e deschisă.
  - Botul real pe futures folosește același preț ca graficul (perechea spot): nivelurile Slingshot sunt calculate pe el.
- **Semnalele Slingshot:**
  - se calculează doar când s-a închis o lumânare a timeframe-ului botului;
  - cu același istoric ca graficul, deci aceleași semnale ca pe grafic;
  - acțiunile, cu cheia Twelve Data a utilizatorului (fără ea: 1d și 1w).
- **În real, botul își verifică pozițiile** din portofoliul contului (citit cel mult o dată la 20 s):
  - O poziție a botului care nu mai e acolo, sau e mai mică (lichidare, închisă de mână): botul o consideră închisă la prețul de atunci, cu motivul „din afară”, și scrie în jurnal.
  - Pe spot: activul liber mai puțin decât ce a cumpărat botul → la fel.
- **Comisioanele în real:** platforma le ia. Câștigul afișat e estimat din prețurile de la execuție și din comisionul din setări; extrasul platformei rămâne adevărul.
- **Botul închide pozițiile el însuși, la piață:** nu pune ordine SL / TP pe platformă.
  - Cu serverul oprit, botul nu poate închide nimic. Formularul o spune la „Real”.
  - Pierderea pe zi, oprirea la o pierdere și levierul limitează riscul.

### 9. Erori și situații limită
| Situație | Comportament |
|---|---|
| Ordinul e sub minimul platformei | intrarea se sare, cu motivul în jurnal; botul continuă |
| Bani insuficienți în cont | intrarea se sare („Disponibil 12 USDT; trebuie 40”) |
| Platforma refuză o intrare (minim, fonduri, alt motiv) | nicio intrare nouă pe acel simbol 5 minute; jurnalul o spune o dată. Ieșirile se încearcă la fiecare verificare |
| Prea multe ordine într-un minut (limita de 20) | se reîncearcă la verificarea următoare, cu aceeași cheie |
| Platforma nu răspunde / eroare de rețea la trimitere | se reîncearcă cu aceeași cheie: nu face al doilea ordin |
| Rezultatul unui ordin necunoscut (UNKNOWN_OUTCOME) | Problemă: „Verifică pozițiile în Tranzacții, apoi Reia” |
| Tranzacționarea oprită pe cont / cheia fără drept | Problemă, cu mesajul platformei; niciun ordin până la „Reia” |
| Contul șters | Încheiat, motivul „contul a fost șters”; pozițiile rămân pe platformă |
| O poziție pe simbol care nu e a botului (futures) | rezumatul avertizează la creare; botul nu intră cât timp e acolo; jurnalul o spune o dată |
| O poziție deschisă de mână pe simbol după intrarea botului (futures) | poziția netă nu mai e a botului: reconcilierea o poate socoti „din afară”. Rezumatul spune: nu deschide de mână poziții pe simbolul unui bot |
| Prima verificare a unui bot Premium | ia doar semnalele de pe lumânările care se închid după pornire (cea închisă deja e doar notată) |
| O vânzare a activului de mână (spot) | botul consideră poziția închisă „din afară” |
| Lichidare pe platformă | poziția lipsește → închisă „din afară” |
| Prețul nu se poate citi | verificarea se sare; după 10 minute fără preț: Problemă |
| Slingshot fără destul istoric | nicio intrare; jurnalul spune o dată „istoric insuficient” |
| Bursa închisă (acțiuni) | nicio acțiune; la deschidere, SL / TP sărite peste noapte se execută la prețul deschiderii |
| Un salt peste mai multe linii / ordine de siguranță | toate cele atinse se execută într-un singur ordin |
| Prețul iese din grilă | grila așteaptă; „Oprește sub / peste” închide |
| Sfârșitul perioadei cu „Termină tranzacțiile” | „Se încheie” până se închide ultima; apoi Încheiat |
| Început în trecut, la salvare | pornește acum |
| Sfârșit înainte de început | eroare în formular |
| Sfârșit în trecut, la editare | eroare în formular |
| Pauză cu poziții deschise | SL / TP / grila care vinde continuă |
| Pierderea pe zi atinsă | nicio intrare până la miezul nopții utilizatorului; jurnalul o spune o dată |
| „Oprește la o pierdere de” atins | închide tot, Încheiat |
| AI-ul fără cheie / fără credit / timeout | după opțiune (implicit: nu intră); motivul în jurnal |
| Două semnale (long și short) pe aceeași lumânare | Slingshot 3.4 le ține separat; botul ia doar unul: cel al direcției permise, iar cu „Ambele”, întâi latura pe care o favorizează scorul pieței (FD-BOTDIR) |
| Serverul repornit în timpul unei trimiteri | ordinul se cere din nou cu aceeași cheie: răspunsul e cel dintâi |
| Doi utilizatori, același simbol | fiecare bot e al utilizatorului lui; nimic comun |
| Utilizator dezactivat de admin | boții lui nu mai rulează (pozițiile rămân) |
| Al 11-lea bot activ | refuzat: „Cel mult 10 boți activi” |
| Un al doilea bot real pe același cont și simbol | refuzat |
| Editarea sumei maxime sub cât e angajat | refuzată |
| Un simbol crypto și unul de acțiuni în același bot Premium | refuzat: o singură arie |
| Short pe spot, la Trading 212 sau la Alpaca | nu se oferă (§10) |
| Simbol fără perpetuu pe futures (botul real) | refuzat la salvare: „KuCoin nu are BTC/EUR pe futures” |
| Prețul de pornire al grilei deja atins la salvare | grila pornește imediat |
| Lumânarea timeframe-ului 1m | permisă; semnalele la fiecare minut |

### 10. Acțiuni în real (FD-BOTSTOCKS, 21 oct 2026)
**Ce cere utilizatorul:** boții merg și în real pe acțiuni. Aplicația știe deja cum închide fiecare broker, deci botul face la fel.

**Contul:** unul de acțiuni cu tranzacționarea pornită (Trading 212, eToro sau Alpaca; IBKR nu primește ordine). Simbolul e cel al graficului (AAPL), iar fiecare broker îl găsește ca în formularul de ordin.

**Cum lucrează la fiecare broker** (ordine la piață, pe cantitate, prin același serviciu de tranzacționare):
| Broker | Deschide | Închide | Short |
|---|---|---|---|
| Trading 212 | cumpără cantitatea (fracționat, unde se poate) | vinde cantitatea botului, cel mult cât e liber în cont | nu (contul nu are short) |
| Alpaca | cumpără cantitatea (întreagă la acțiunile care nu se tranzacționează fracționat) | vinde cantitatea botului | nu: Alpaca ține o singură poziție netă pe simbol, iar un short al botului ar vinde acțiunile tale |
| eToro | deschide o poziție (cumpără sau short) | închide pozițiile deschise de bot, după id-urile lor, toată cantitatea sau o parte | da; eToro cere stop loss la short, deci botul trimite stop loss-ul lui cu fiecare short |

**Pozițiile eToro ale botului:**
- La fiecare deschidere, botul notează pozițiile instrumentului dinainte și cele de după: cele noi sunt ale lui.
- Dacă eToro nu le arată imediat (ordinul încă se procesează), le caută la verificările următoare.
- Închide doar pozițiile lui; ale tale, pe același simbol, rămân neatinse.
- O poziție a botului închisă pe eToro (de mână, la stop loss) apare „din afară”, ca la crypto.

**Short-ul la eToro** cere un stop loss de la început:
- Premium: stop loss-ul tranzacției;
- DCA: stop loss-ul ciclului, obligatoriu pentru un DCA short;
- Grid Short / Neutru: „Oprește peste”, obligatoriu.
Fără el, formularul spune ce lipsește.

**Programul:** botul acționează doar în sesiunea obișnuită (bursa deschisă, după Nasdaq). Cu bursa închisă nu trimite nimic; un SL / TP sărit peste noapte se execută la deschidere.

**Banii:** sumele botului sunt în USD (prețurile Nasdaq). Un cont în altă monedă (Trading 212 în EUR) plătește în moneda lui: câștigul botului rămâne o estimare în USD.

**Levierul:** pe acțiuni, botul nu folosește levier (1×).

**Cazuri:**
| Situație | Comportament |
|---|---|
| Ai deja acțiuni din simbol în cont | rămân ale tale: botul vinde doar cât a cumpărat el (la eToro: doar pozițiile lui) |
| Le vinzi de mână pe ale botului (Trading 212, Alpaca) | ce lipsește din cantitatea botului e socotit „din afară” |
| Cantitatea sub minimul brokerului / fracții la o acțiune nefracționabilă (Alpaca) | rotunjită în jos la pas; sub minim, intrarea e refuzată și botul mai încearcă după 5 minute |
| Short pe Trading 212 sau Alpaca | nu se oferă |
| Short la eToro fără stop loss (DCA fără SL, grilă fără „Oprește peste”) | eroare în formular |
| Bursa închisă | nimic; la deschidere botul continuă |
| eToro nu arată încă poziția nouă | o caută la verificările următoare; între timp nu închide nimic din ea |
| O poziție eToro a botului nu mai există | socotită închisă „din afară” |
| Alpaca refuză (de exemplu, regula pattern day trader) | refuzul platformei: intrarea așteaptă 5 minute, ieșirea se reîncearcă |

## FIX-SLTPDUP — un SL / TP mutat pe grafic apare o dată, la nivelul nou (21 oct 2026)

### Ce a raportat utilizatorul
După ce mută stop loss-ul și / sau take profit-ul unui trade și confirmă, una dintre linii apare dublată pe grafic sau rămâne cea veche.

### De ce
- **Pe KuCoin futures, o mutare înseamnă două ordine:** plasează ordinul nou, apoi îl anulează pe cel vechi. Ambele reușesc (jurnalul din Tranzacții o arată).
- **Bursa le listează cu câteva secunde întârziere:**
  - cel vechi, anulat, mai apare un timp: de aici dublura;
  - cel nou încă nu apare: de aici linia veche.
- **Sentiq reținea lista citită imediat după confirmare 20 de secunde, iar graficul o recitea abia după un minut.**
- **O citire pornită chiar înainte de confirmare** putea aduce lista veche și după ea.

### Cum e acum
- **Imediat după confirmare,** linia mutată stă la nivelul nou, chiar dacă bursa nu-l listează încă.
  - Ordinul vechi nu se mai vede, chiar dacă bursa îl mai listează.
  - Până apare ordinul nou, linia nu se poate trage și nu are ×. Așteaptă cel mult un minut.
- **Un ordin anulat sau înlocuit** (mutare, ×, întoarcerea poziției) dispare de pe grafic și din Tranzacții imediat, nu când îl scoate bursa din listă.
- **După orice acțiune de tranzacționare** (ordin, anulare, modificare, întoarcere), portofoliul contului se citește din nou la fiecare 3 secunde, timp de 30 de secunde: graficul și Tranzacții ajung din urmă bursa în câteva secunde.
- **O citire pornită înainte de acțiune** nu mai e păstrată după ea.

### Cazuri
| Situație | Comportament |
|---|---|
| Bursa listează și ordinul vechi, și pe cel nou | o singură linie, a celui nou |
| Bursa nu listează încă ordinul nou | linia rămâne la nivelul nou, fără × până apare |
| Ordin modificat pe loc (același id, alt nivel) | linia trece la nivelul nou; gata când bursa îl arată |
| Rezultat parțial (o schimbare a mers, alta nu) | doar schimbarea reușită rămâne la nivelul nou; cealaltă revine |
| Ordinul vechi n-a putut fi anulat | rămâne vizibil (sunt amândouă), cum spune mesajul |
| Bursa nu arată ordinul nou nici după un minut | linia revine la ce listează bursa |

## FIX-COINSOUND — sunetul de monede doar pentru un trade încheiat cât graficul e urmărit (21 oct 2026)

### Ce a raportat utilizatorul
La deschiderea aplicației se aude sunetul de monede, deși nu s-a închis niciun trade.

### De ce
- **Sunetul compară două citiri ale portofoliului.** Le compara când pagina fusese „vizibilă” între ele.
- **Aplicația poate sta oprită fără să devină „ascunsă”:** laptopul în sleep, aplicația de pe telefon ținută în fundal, fereastra lăsată în spatele altora. Citirile se opresc.
- **La revenire, prima citire nouă era comparată cu una de acum câteva ore.** Un trade închis între timp (de exemplu, la stop loss) suna exact la deschidere.
- **Verificat pe conturile reale:** citirile consecutive nu dau nicio alarmă falsă, iar botul n-a închis nimic.

### Cum e acum
- **Se compară doar două citiri consecutive, la cel mult 50 de secunde una de alta** (pagina citește la 20 s, iar după o acțiune la 3 s).
  - Două citiri mai depărtate înseamnă că între ele graficul n-a fost urmărit: ce s-a închis atunci rămâne fără sunet, ca un trade închis cu fila ascunsă.
- **Pregătirea sunetului la prima atingere** (cerută de Safari) se face cu sunetul oprit și volumul la zero: nu se aude nimic pe niciun browser.

### Cazuri
| Situație | Sunet |
|---|---|
| Un trade se închide cât graficul e deschis și urmărit | o dată, în cel mult ~20 s |
| Laptopul a dormit / aplicația a stat în fundal, iar între timp s-a închis un trade | nu |
| Fila ascunsă cât s-a închis | nu (ca până acum) |
| Prima atingere de pe pagină | nu |
| Serverul răspunde foarte târziu (peste 50 s între citiri) | nu: e tratat ca o pauză |

> **Corectat de FIX-COINSOUND2.** Utilizatorul a raportat că sunetul se aude în continuare la orice tab nou cu graficul. Cauza de mai sus (citiri depărtate) e reală și regula de 50 s rămâne, dar nu era cauza sunetului de la deschidere.

## FIX-COINSOUND2 — sunetul de la deschiderea în Safari; doar trade-urile graficului de pe ecran (22 oct 2026)

### Ce a raportat utilizatorul
- Sunetul de monede se aude la **orice deschidere de tab nou cu graficul**, local și pe server, cu sau fără trade-ul pe SOL.
- **Cerință nouă:** sunetul doar pentru trade-urile din graficul la care se uită, nu pentru orice trade.

### Cauza (confirmată)
- **Utilizatorul folosește Safari** (macOS și iPhone; în Chrome, defectul nu apare).
- Safari redă un sunet fără click doar după ce pagina l-a pornit o dată dintr-un click. De aceea, la primul click sau tastă pe pagină, Sentiq îl pornea pe mut și îl oprea imediat, apoi îi dădea drumul la volum.
- **În Safari (WebKit), oprirea nu oprește clipul:** el merge mai departe până la capăt (1,1 s).
  - Volumul repornit imediat după oprire făcea ca restul clipului să se audă.
  - Rezultatul: sunetul de monede la primul click din fiecare tab nou, fără niciun trade închis.
- **Verificat în WebKit, motorul Safari:** după click, evenimentele arată pauza, apoi „ended” la 1,1 s, cu sunetul pornit. Datele portofoliilor sunt stabile (7 minute de citiri reale, nicio închidere falsă).

### Cum e acum
- **Pregătirea la primul click rămâne pe mut până la capăt.** Doar sunetul unui trade încheiat pornește volumul.
- **Doar trade-urile graficului de pe ecran**, aceleași pentru care graficul desenează liniile:
  - **crypto** (de exemplu SOL/USDT): pozițiile pe orice pereche a monedei (SOL/USDT:USDT, SOL/USDC…) și deținerea de SOL, în conturile de la exchange-uri;
  - **acțiuni** (de exemplu TSLA): pozițiile și deținerea TSLA, în conturile de la brokeri;
  - **indici:** fără sunet (n-au trade-uri).
- **Alt simbol pe același tab:** urmărirea pornește de la zero pentru simbolul nou, ca la deschiderea graficului. Conturile lui se citesc imediat.

### Cazuri
| Situație | Sunet |
|---|---|
| Primul click / prima tastă dintr-un tab nou (Safari, Chrome, iPhone) | nu |
| Un trade pe simbolul din grafic se închide cât graficul se vede | o dată |
| Un trade pe alt simbol se închide (de exemplu un bot pe SOL, iar tu te uiți la BTC) | nu |
| Treci de pe BTC pe SOL, iar trade-ul SOL se închisese înainte | nu: ce s-a închis înainte de a vedea simbolul nu sună. Excepție: un trade închis cu câteva secunde înainte, pe care serverul încă nu-l citise de la platformă (o citește cel mult o dată la 20 s), poate suna la prima citire nouă, ca la deschiderea graficului |
| Treci pe SOL, iar trade-ul SOL se închide după | o dată |
| Sunetul unui trade pornește chiar în clipa pregătirii (aceeași secundă) | se aude întreg; pregătirea nu-l mai oprește |
| Același simbol în două conturi, ambele închise în aceeași citire | o dată |

## FD-COLORUNIFY — o culoare, o casetă, un efect, la toți indicatorii standard (21 oct 2026)

### Ce cere utilizatorul
- **Problema, la MA Ribbon:**
  - culorile apar și în Intrări, și în Stil, cu casete diferite;
  - în Stil, culoarea aleasă nu se aplică, doar grosimea;
  - în Intrări, culoarea se aplică, dar nu se pot alege grosimea și tipul liniei.
- **Cerința:** curățenie la **toți** indicatorii. Același selector de culoare, ca în TradingView, și orice casetă de culoare afișată chiar schimbă ce se desenează.

### Ce s-a găsit (verificare automată pe toți cei 118 indicatori)
| Caz | Indicatori | Ce era greșit |
|---|---|---|
| **A.** O culoare din Intrări este culoarea întregii linii | MA Ribbon (MA #1–#4) | două valori pentru același lucru: Intrări colora punctele liniei, Stil doar culoarea „de bază”, pe care punctele o acoperă |
| **B.** O linie desenată în mai multe culori fixe, nedeclarate | MACD, Price Oscillator, Volume Oscillator (histograma, 4 culori); Awesome Oscillator, Bull Bear Power, Woodies CCI (histograma), Aroon Oscillator, Volatility Stop, Relative Volume at Time (2 culori); BBTrend (4); Chop Zone (9) | Stil avea o singură casetă, cu o culoare pe care linia n-o folosește (la MACD, albastrul `#2962FF`): alegerea nu schimba nimic |
| **C.** O linie colorată printr-un calcul din culorile din Intrări | Technical Ratings (coloanele: gradient între Strong Sell, Neutral și Strong Buy) | caseta din Stil nu putea avea efect |
| **D.** Liniile orizontale care, în Pine, urmează o culoare din Intrări | Trend Strength Index (Bullish / Bearish Band), Technical Ratings (Level) | rămâneau în culoarea implicită când schimbai culoarea în Intrări |

Restul culorilor din Intrări (cele ale etichetelor, desenelor, cutiilor, tabelelor: Fibonacci, Pivot Points, ZigZag, Trading Sessions etc.) colorează elemente care nu au rând în Stil: nu se dublează nimic, rămân doar în Intrări. Toate cele 173 de linii celelalte din Stil sunt corecte.

### Comportament

**A. Culoarea din Intrări care este culoarea unei linii (MA Ribbon)**
- **O singură valoare:** culoarea liniei.
- **Aceeași casetă în ambele taburi:** culoare, opacitate, grosime 1–4 px, tipul liniei.
  - În **Intrări**, pe rândul MA-ului: „MA #1 ☑ SMA close 20 [caseta liniei]”.
  - În **Stil**, pe rândul liniei.
- **Legate:** schimbi în oricare tab și celălalt arată imediat la fel.
- „Valorile implicite” readuce culoarea, grosimea și tipul.

**B. Liniile cu mai multe culori**
- Stil arată **câte o casetă pentru fiecare culoare** a liniei, în ordinea din cod, ca în TradingView.
  - Exemplu MACD, histograma: crește peste 0, scade peste 0, crește sub 0, scade sub 0.
- Fiecare culoare aleasă se aplică barelor desenate în ea, cu opacitate cu tot.
- Grosimea și tipul, unde linia le are, sunt comune liniei și se aleg din oricare casetă.

**C. Linia colorată din Intrări printr-un calcul (Technical Ratings)**
- În Stil, caseta arată culorile coloanelor (gradientul Strong Sell → Neutral → Strong Buy, cu valorile din Intrări de acum).
- Panoul ei spune unde se schimbă: „Culorile se aleg în Intrări, la Table Settings: Buy, Neutral, Sell.” Nu oferă o paletă care n-ar avea efect.

**D. Liniile orizontale care urmează o culoare din Intrări**
- Implicit, urmează culoarea din Intrări, ca în Pine. Exemple:
  - banda Bullish a TSI ia „Bullish Color” cu opacitate deplină;
  - nivelurile Technical Ratings iau Buy / Sell la 50 %.
- O culoare aleasă în Stil pentru linia orizontală câștigă, ca în TradingView și ca pragurile LMA (FD-STYLEUNIFY). „Valorile implicite” o șterge, iar linia urmează din nou Intrările.
- Caseta din Stil arată culoarea desenată acum.

**Legenda** (valorile de lângă numele indicatorului) folosește culorile alese, în toate cazurile.

### Setări salvate înainte
- **A.** O culoare aleasă înainte în Stil pentru o linie MA Ribbon:
  - dacă nu schimbaseși culoarea în Intrări, ea era cea desenată, deci devine culoarea liniei;
  - dacă o schimbaseși, se desena cea din Intrări, care rămâne.
  - Aspectul de pe grafic nu se schimbă. La prima salvare se scrie forma nouă.
- **B.** O culoare aleasă înainte în caseta unică a unei linii cu mai multe culori:
  - se aplică în continuare culorii de bază, dacă linia o folosește (de exemplu verdele AO);
  - altfel nu avea efect și nu are nici acum.

### Edge cases
| Situație | Comportament |
|---|---|
| MA ascuns (bifa MA #1 debifată) | caseta rămâne activă în ambele taburi (ca restul rândului), linia nu se desenează |
| Culoare cu opacitate 0 % | linia e invizibilă, dar rămâne (ca în TradingView) |
| O culoare din Intrări legată de mai multe linii (nu există acum, regula e generală) | în Intrări, grosimea și tipul se aplică tuturor liniilor ei; caseta arată valorile primei |
| Linie cu mai multe culori, o culoare care apare doar cu alte intrări | are caseta ei oricum (ca în TradingView) |
| Indicatorul re-adăugat din memorie (FD-STUDYMEMORY) | aceleași reguli; memoria se scrie în forma nouă la „Salvează” |
| O versiune viitoare a unui indicator cu o legătură nouă sau o culoare nedeclarată | un test pe toți indicatorii pică până când e tratată (nicio casetă fără efect) |
| Telefon (390 / 320 px) | caseta de linie are 72 px; rândul MA din Intrări se rupe pe două rânduri, fără depășire |

## FIX-PANES — un indicator nou în panourile de jos nu mai strică scalele lor (22 oct 2026)

### Ce a raportat utilizatorul
Când adaugă un al doilea indicator în panourile de sub preț (de exemplu Stoch RSI sub LMA), afișajul se strică:
- panoul LMA arată un „bloc”, cu scala greșită (−1 … 4);
- Stoch RSI are scala 0 … 400;
- desenele ies din panou.

### Cauza (reprodusă)
- **Utilizatorul are scala de preț logaritmică** (butonul „L”).
- **Biblioteca graficului** (Lightweight Charts) copiază opțiunile puse pe scala panoului principal în opțiunile generale ale graficului: logaritmul, autoscala oprită după o tragere, marginile. Orice panou creat mai târziu pornește din ele.
- **La adăugarea sau scoaterea unui indicator cu panou propriu**, Sentiq reface panourile de jos. Acestea primeau deci scala logaritmică a prețului: valorile negative sau din jurul lui 0 (LMA, oscilatorii) se desenau greșit.
- **La deschiderea paginii totul era corect**, fiindcă panourile se creau înainte ca prețul să devină logaritmic. De aceea bug-ul apărea doar la adăugare și dispărea la reîncărcare.

### Cum e acum
- **Fiecare panou de jos pornește cu scala lui proprie**, aceeași ca la deschiderea paginii: normală, cu autoscală, cu marginile implicite.
- **Scala prețului rămâne neschimbată:** logaritmică, cu autoscala pornită sau oprită, cu marginile alese.

### Cazuri
| Situație | Rezultat |
|---|---|
| Preț logaritmic, adaugi un indicator cu panou propriu | LMA și indicatorul nou au scale normale |
| Scala prețului trasă cu mouse-ul („A” oprit), apoi adaugi un indicator | panourile de jos au autoscală |
| Scoți un indicator dintre mai multe | cele rămase își păstrează scalele normale |
| Ascunzi / arăți LMA (panoul refăcut) | scala LMA e normală |
| Marginile graficului din setări (sus / jos) | se aplică prețului, ca până acum; panourile de jos au marginile lor implicite, ca la deschidere |
| Telefon, iPad, ecran complet | la fel |

## FD-BOTTF — timeframe-ul semnalelor se schimbă și la un bot Slingshot pornit (22 oct 2026)

### Ce cere utilizatorul
„Când editez un bot nu pot modifica time frame-ul. Aș vrea să pot face asta.”

### Ce era
- **La un bot nou**, formularul are „Timeframe-ul semnalelor”, doar la Slingshot Premium. Grid și DCA nu folosesc lumânări: lucrează pe prețul de acum.
- **La Editează**, timeframe-ul apărea doar ca text („BTC/USDT · Spot · Simulare · 1h”). FD-BOT §7 îl lăsa doar la un bot nou, deci schimbarea cerea „Duplică”, adică un bot nou, fără pozițiile și istoricul celui vechi.

### Cercetare
- **În cod**, timeframe-ul unui bot Slingshot decide trei lucruri:
  - din ce lumânări calculează motorul Slingshot (aceleași ca pe grafic);
  - ce lumânare a citit ultima, pe fiecare simbol;
  - semnalul pe care a intrat fiecare poziție deschisă, urmărit pe lumânările lui (invalidarea prin trend, SL / TP marcat de Slingshot pe lumânare).
- **Pe piață:** n-am găsit o documentație oficială despre schimbarea timeframe-ului unui bot pornit (căutare: 3Commas, setările unui bot pornit). Platformele de boți aplică de obicei o setare schimbată tranzacțiilor care urmează. Asta e și regula Sentiq pentru celelalte setări Premium (FD-BOT §7).

### Cum e acum
- **Editează, la un bot Slingshot Premium neîncheiat:** câmpul „Timeframe-ul semnalelor”, cu aceleași valori ca la un bot nou (1m … 1w), pornind de la cel de acum.
  - Textul de sub el: „Botul îl preia la următoarea verificare (≤ 30 s) și ia semnalele de pe lumânările care se închid după ea; pozițiile deschise își păstrează SL / TP-ul.”
  - Rândul de sus („BTC/USDT · Spot · Simulare”) nu mai repetă timeframe-ul.
- **La Grid și DCA nu apare:** nu folosesc lumânări. Serverul refuză o schimbare trimisă pentru ele: „Timeframe-ul contează doar la un bot Slingshot.”
- **După „Salvează”:**
  - lista și pagina botului arată timeframe-ul nou imediat;
  - jurnalul scrie „Setările au fost schimbate.”, ca la orice editare.
- **La următoarea verificare a botului (≤ 30 s), schimbarea intră în vigoare:**
  - **Ca la pornire (FD-BOT §9):** lumânarea deja închisă pe timeframe-ul nou e doar notată. Semnalele se iau de pe lumânările care se închid după ea. Un semnal mai vechi de pe timeframe-ul nou nu deschide nimic.
  - **Jurnalul:** „Timeframe-ul semnalelor e acum 4h (era 1h): botul ia semnalele de pe lumânările de 4h care se închid de acum.”
  - **Pozițiile deschise rămân deschise:**
    - își păstrează SL și TP (prețurile), verificate la fiecare verificare, ca până acum;
    - semnalul de take profit Slingshot și semnalul opus vin de pe lumânările timeframe-ului nou, după opțiunile botului;
    - semnalul pe care au intrat e pe timeframe-ul vechi, deci nu mai e urmărit: „Ieși când trendul se întoarce” și SL / TP-ul marcat de Slingshot pe lumânare nu se mai aplică lor.
    - Jurnalul o spune: „Pozițiile deschise își păstrează SL / TP-ul; semnalul de 1h pe care au intrat nu se mai urmărește.”
  - **AI-ul** („AI confirmă”) primește timeframe-ul nou.
- **Restul nu se schimbă:** pauza după o pierdere, pierderea pe zi, întrebările AI de azi, câștigul, tranzacțiile încheiate.

### Cazuri limită
| Situație | Comportament |
|---|---|
| Același timeframe ales (nicio schimbare) | nimic nu se resetează; jurnalul are doar „Setările au fost schimbate.” |
| 1h → 4h → 1h înainte ca botul să verifice | botul nu vede nicio schimbare: continuă pe 1h, fără nicio lumânare pierdută |
| Două schimbări la câteva minute | fiecare, văzută de bot, o ia de la capăt: lumânarea închisă e notată, se așteaptă următoarea |
| Bot pe pauză sau cu o problemă | timeframe-ul se schimbă; botul îl preia la următoarea verificare, iar semnalele vin de pe lumânările care se închid după ea (pe pauză nu intră oricum) |
| Bot programat, încă nepornit | pornește direct pe timeframe-ul nou, cu regula de la pornire (FD-BOT §9) |
| Bot „Se încheie” cu „Termină tranzacțiile” | se poate schimba; pozițiile se închid după regulile de mai sus |
| Bot încheiat | nu se editează (ca până acum); „Duplică” |
| Acțiuni fără cheia ta Twelve Data, timeframe sub 1d | „Salvează” refuză: „AAPL pe 1h cere cheia ta Twelve Data (Setări → Date acțiuni); fără ea, botul merge pe 1d și 1w.” Botul rămâne cum era |
| Crypto: exchange-ul tău n-are timeframe-ul (8h pe Bybit / OKX / Bitget) | lumânările vin de la exchange-ul implicit, ca pe grafic (ca la un bot nou) |
| Istoric prea scurt pe timeframe-ul nou | jurnalul o spune din nou, o dată, pentru timeframe-ul nou |
| O intrare reală trimisă pe timeframe-ul vechi și încă în reîncercare | când trece, poziția e ca celelalte deschise: SL / TP-ul ei, fără urmărirea semnalului vechi |
| Un semnal pe timeframe-ul nou cu aceeași oră ca semnalul unei poziții | nu e luat drept semnalul ei (urmărirea semnalului vechi s-a oprit) |
| „Duplică” după schimbare | botul nou pornește cu timeframe-ul nou |
| Graficul pe alt timeframe decât botul | botul nu urmează graficul; „Bot” de pe grafic propune timeframe-ul graficului doar la un bot nou |
| Telefon (390 / 320 px) | câmpul ocupă un rând, fără depășire |

## FD-BOTSLRR — cu „Slingshot”, botul intră cu SL-ul și TP-ul semnalului, fără niciun R:R (22 oct 2026)

### Ce cere utilizatorul
- „Tu aici, în setările botului, trebuia să pui așa: respect take profit-ul și stop loss-ul oferit de Slingshot sau setez tu risk reward ratio. Și eu am bifat Slingshot.”
- „Nu mă interesează punctul de intrare, pentru că este evident că o lumânare mai târzie va oferi confirmarea semnalului. […] Respectăm ce spune Slingshot. Știi stop loss-ul, știi take profit-ul. Faci un trade cu aceste două.”
- „Risk reward ratio este că nu vrei să respecți Slingshot-ul. Nu merg împreună niciodată.”
- „Slingshot-ul este cel care calculează risk to reward ratio singur. De asta îți oferă nivelele de stop loss și take profit.”
- „Trebuie să fie foarte clar acest lucru în formular. Trebuie să dai o explicație acolo, că se exclud și că nu merg împreună.”
- „Risk reward ratio se afișează sub formă de fracție. Vreau să menționez întâi care este riscul pe care îl vreau și care este reward-ul. Adică gen 1 la 2: scrii 1:2. Nu ca un număr, chiar și el fie el decimal.”

### Ce era (cauza, confirmată pe botul SOL/USDT, 22 oct, 12:13)
- **„R:R minim la intrare”** (implicit 1), în FD-BOT §6, verificarea 4: cu TP-ul Slingshot, botul calcula raportul din **prețul de la citire** până la SL și TP. Sub minim, refuza.
- **De ce nu se potrivește cu Slingshot:**
  - semnalul se confirmă după eticheta lui (ieșirea din supravânzare / supracumpărare), deci prețul a plecat deja de la intrarea etichetei;
  - pe SOL/USDT 1m, eticheta SHORT avea intrare 103,88, SL 103,97 și TP 103,55. La citire, prețul era 103,75, deci R:R 0,91: refuzat, deși Slingshot a atins apoi TP-ul.
- **R:R-ul din prețul de acum mai intra în două locuri:**
  - partea „Slingshot” a scorului: 0,6 × limitat(R:R − 1) + 0,4 × structura;
  - întrebarea pentru AI. Pe 21 oct, AI-ul a trecut la riscuri „R:R scăzut de doar 1,07”.
- **Formularul** avea două alegeri separate, „Stop loss: Slingshot / Procent” și „Take profit: Slingshot / Risc / câștig”. Se putea deci amesteca un SL procentual cu TP-ul Slingshot.

### Cercetare
- **În cod:** R:R-ul din prețul de acum apare doar în `decide` (verificarea și scorul), în `levelsFor` și în întrebarea AI. Mărimea („Risc %”) folosește doar distanța până la SL, deci nu e atinsă.
- **În bază (22 oct):** un singur bot Premium, SOL/USDT, cu SL și TP pe Slingshot și „R:R minim” 1. Niciun bot nu are SL procentual cu TP Slingshot.
- **Pe piață:** boții care pornesc din semnale externe (3Commas, cu semnale TradingView) folosesc fie nivelurile semnalului, fie pe ale botului (TP / SL proprii). N-am găsit un filtru suplimentar de R:R peste nivelurile semnalului.

### Cum e acum
- **Ieșirea are o singură alegere: „Stop loss și take profit”**, cu două variante:
  - **„Slingshot”** (implicit): SL-ul și TP-ul sunt ale semnalului, exact ca pe grafic. Niciun alt câmp.
  - **„Risc / câștig”** (înlocuit în aceeași zi de FD-BOTPCT: SL % și TP % de la intrare, raportul calculat): take profit-ul vine din raportul tău. Apar câmpurile:
    - **„Raportul risc : câștig”:** două câmpuri, riscul întâi, cu „:” între ele, implicit „1 : 2”. Raportul rămâne cum l-ai scris (2:3 rămâne 2:3, nu devine 1,5). TP-ul e la câștig ÷ risc × distanța până la SL (1:2 → de două ori distanța).
    - **„Stop loss”:** Slingshot (al semnalului) sau Procent (x% de la intrare).
- **Explicația din formular**, sub alegere, pe toată lățimea, aceeași la ambele variante (nu se schimbă, deci nu mișcă pagina; textul de acum e în FD-BOTPCT):
  > „Două variante care se exclud, nu merg împreună. Slingshot: botul intră cu stop loss-ul și take profit-ul semnalului, exact ca pe grafic. Slingshot își calculează singur raportul risc / câștig, deci botul nu pune niciun R:R peste el. Risc / câștig: nu respectă nivelurile Slingshot. Alegi stop loss-ul (al semnalului sau un procent) și raportul risc : câștig (de exemplu 1:2: take profit-ul e la de două ori distanța până la stop loss).”
- **„R:R minim la intrare” nu mai există**, nici în formular, nici în motor.
- **Decizia (FD-BOT §6), cu „Slingshot”:** semnalul confirmat pe lumânarea închisă intră cu SL-ul și TP-ul lui, oricât de departe ar fi prețul de intrarea etichetei.
  - Singurul refuz legat de niveluri: prețul a trecut deja de SL („Prețul a trecut deja de stop loss.”) sau de TP („Prețul a atins deja take profit-ul.”). Atunci ordinul nu se poate pune: SL-ul ar fi de partea greșită a prețului, iar TP-ul ar fi deja atins.
  - Celelalte verificări rămân la fel: direcția, calendarul, aria împotrivă, scorul minim, locul, AI-ul, banii și pozițiile din afară.
- **Scorul nu mai citește niciun R:R.** Partea „Slingshot” e doar structura pieței (ultima rupere de structură până la lumânarea închisă):
  - în direcția tranzacției: +0,4;
  - împotrivă: −0,4;
  - nicio rupere: 0.
  - E exact cât cântărea structura până acum (0,4), iar R:R-ul e scos (ca și cum ar fi neutru). Ponderile tale își păstrează sensul.
  - **În jurnal:** „Slingshot: structura în direcție / structura împotrivă / fără rupere de structură”, fără R:R.
- **AI-ul („AI confirmă”)** primește prețul, SL-ul și TP-ul, cu sursa lor („ale semnalului Slingshot” sau „TP-ul la raportul risc : câștig al utilizatorului”), fără un R:R calculat din prețul de acum. Regula lui: nu judecă SL-ul, TP-ul sau raportul risc / câștig, pentru că le stabilește strategia. „Nivelurile nu au sens” nu mai e un motiv de refuz.
- **„Verifică” (rezumatul de dinainte de pornire):** „SL și TP: ale semnalului Slingshot.” sau „SL: al semnalului; TP la raportul risc : câștig 1:2.” (cu x% în loc de „al semnalului” la Procent).
- **Raportul se arată peste tot ca raport, riscul întâi** (1:2, 1:1,5, 2:3), niciodată ca un singur număr. Jurnalul și scorul nu mai arată niciun R:R.
- **Textul de la „Filtrul Sentiq”:** scorul adună scorul zilei, aria, sentimentul pe 7 zile, știrile simbolului și structura pieței.
- **Botul care rulează** (SOL/USDT) primește regula nouă la prima verificare după deploy, fără editare. „R:R minim”-ul din setările lui e ignorat, apoi scos la prima salvare.

### Cazuri limită
| Situație | Comportament |
|---|---|
| „Slingshot”, prețul între SL și TP, raportul din prețul de acum oricât de mic (0,2) | intră cu SL-ul și TP-ul semnalului |
| „Slingshot”, long cu prețul la sau sub SL (short: la sau peste) | nu intră: „Prețul a trecut deja de stop loss.” |
| „Slingshot”, long cu prețul la sau peste TP (short: la sau sub) | nu intră: „Prețul a atins deja take profit-ul.” |
| „Risc / câștig” (rândurile despre raport, până la „tab vechi”, sunt înlocuite de FD-BOTPCT) | TP = preț ± câștig ÷ risc × distanța până la SL |
| Raportul scris 2:3 | rămâne 2:3 la Editează și în „Verifică”; TP-ul la 1,5 × distanța până la SL |
| Raportul în afara limitelor (câștigul sub jumătate din risc sau peste de 10 ori riscul, de ex. 3:1 sau 1:11) | refuzat: „Raportul risc : câștig 3:1 iese din limite: câștigul e între jumătate din risc și de 10 ori riscul (de la 2:1 la 1:10).” (limitele de dinainte, 0,5–10) |
| Un câmp al raportului gol | „Partea de risc a raportului: lipsește.” / „Partea de câștig a raportului: lipsește.” |
| Cu „Slingshot”, raportul (ascuns) nu contează | nu se verifică și nu se folosește; golit sau greșit înainte de a alege „Slingshot”, nu oprește salvarea (rămâne cel valid, altfel 1:2). La fel procentul de SL ascuns cu SL-ul Slingshot (altfel 2%) |
| Un bot vechi cu R:R-ul ca un singur număr (R = 2,5) | se citește ca 1:2,5; se salvează așa la prima salvare |
| Un bot vechi cu „R:R minim” în setări | setarea e ignorată; dispare la prima salvare (Editează / Duplică) |
| Un tab deschis cu versiunea veche (trimite R și R:R minim) | salvarea trece: R devine 1:R, R:R minim e ignorat; după reîncărcare, formularul nou |
| Setări trimise cu SL procentual și TP Slingshot (API, un formular vechi deschis) | refuzate: „Cu Slingshot, stop loss-ul și take profit-ul sunt amândouă ale semnalului; pentru un SL procentual alege „Risc / câștig”.” |
| Un bot salvat cu SL procentual și TP Slingshot | nu există în bază (verificat 22 oct); setările lui n-ar mai trece, iar botul ar arăta „Setările botului nu se mai pot citi” |
| Trecerea din „Risc / câștig” în „Slingshot” în formular | SL-ul devine și el al semnalului; câmpurile de SL și R dispar |
| Trecerea din „Slingshot” în „Risc / câștig” | apar „Stop loss” (Slingshot) și R (valoarea de dinainte, implicit 2) |
| „Risc %” cu un SL foarte aproape de preț | mărimea vine tot din distanța până la SL, limitată de suma liberă, de levier și de lichidare (FD-BOT §6) |
| Ambele semnale pe aceeași lumânare | se încearcă întâi cel cu scorul mai mare (ca până acum); scorul nu mai depinde de R:R |
| Poziții deschise înainte de schimbare | neatinse: SL-ul și TP-ul lor rămân |
| Rânduri vechi din jurnal | își păstrează textul de atunci (cu R:R) |
| Simulare | aceleași reguli |
| Scorul minim al botului | rămâne cum l-ai pus. Fără R:R, un context neutru fără rupere de structură face 50 |
| Telefon (390 / 320 px) | alegerea ocupă un rând, câmpurile de la „Risc / câștig” sub ea, fără depășire |

## FIX-INFOTIP — iconița (i) din setările indicatorilor arată explicația la hover și la click (22 oct 2026)

### Ce a raportat utilizatorul
„În niciun indicator, mouse hover pe acea iconiță de question mark sau click pe ea nu afișează ceva. Deci tu ai pus informații despre o setare dintr-un indicator fără să apară informația.”

### Cauza (confirmată în cod)
- **Ambele ferestre de setări** au iconița (i) lângă o setare cu explicație:
  - indicatorii din listă (`StudySettings`, explicațiile Pine ale fiecărui input);
  - Slingshot și LMA (`Charts.tsx`).
- **Iconița era doar un `<span title="…">`:**
  - **click:** nimic, pentru că nu avea niciun handler;
  - **hover:** doar tooltip-ul nativ al browserului. În Safari pe Mac apare după o pauză lungă și doar cu fereastra activă. Pe iPhone și iPad nu există deloc (fără hover).

### Cum e acum
- **Iconița (i) e un buton.** Explicația apare într-o bulă:
  - **cu mouse-ul:** cât timp cursorul e pe iconiță;
  - **la click sau tap:** rămâne deschisă până la alt click / tap în afara ei, Esc sau un nou click pe iconiță;
  - **din tastatură:** Tab pe iconiță, apoi Enter sau Space.
- **Bula:**
  - nu mută nimic din pagină (plutește deasupra);
  - stă sub iconiță, sau deasupra când jos nu e loc;
  - rămâne în fereastră, la 8 px de margini, cel mult 280 px lățime;
  - are textul setării, exact ca în Pine.
- **Click pe (i) dintr-o etichetă de checkbox:** nu bifează și nu debifează căsuța.
- **Esc cu bula deschisă:** închide doar bula, nu și fereastra de setări. Un al doilea Esc închide fereastra.
- **Cititoarele de ecran:** butonul se numește „Explicația setării” și e legat de bulă cât e deschisă.

### Cazuri limită
| Situație | Comportament |
|---|---|
| Hover, apoi cursorul pleacă | bula se închide |
| Tap pe iPhone | bula se deschide; alt tap în afara ei o închide |
| Tap pe altă iconiță (i) | bula veche se închide, se deschide cea nouă |
| Iconița lângă marginea dreaptă, la 320 px | bula se mută spre stânga, ca să rămână în ecran |
| Iconița în partea de jos a ferestrei | bula apare deasupra |
| Fereastra de setări derulată cu bula deschisă | bula urmează iconița; dacă iconița iese din ecran, bula se închide |
| Setare inactivă (gri, „nu se aplică”) | explicația se poate citi la fel |
| Text lung | se rupe pe rânduri, în cel mult 280 px |
| Setare fără explicație | nicio iconiță (ca până acum) |
| Lista de ponderi / alte câmpuri fără explicație | neschimbate |

## FD-BOTPCT — „Risc / câștig” = SL % și TP % de la intrare, raportul calculat (22 oct 2026)

### Ce cere utilizatorul
- „Eu știu că risk/reward stabilește ambele lucruri, și stop loss-ul, și take profit-ul, pentru că spui cât risc vreau să-mi asum, adică până unde se duce stop loss-ul și până unde se duce take profit-ul. Nu înțeleg de ce ai pus la stop loss opțiunea de procent.”
- După explicație (un raport singur, 1:2, nu spune cât de departe e SL-ul) și trei variante propuse, varianta aleasă: **„SL % și TP % direct”**. Două câmpuri, cât la sută până la SL și cât la sută până la TP; raportul se calculează și se afișează ca 1:2.

### Ce era (FD-BOTSLRR)
- „Risc / câștig” avea:
  - „Stop loss”: Slingshot (al semnalului) sau Procent;
  - „Raportul risc : câștig” în două câmpuri; TP-ul ieșea din raport × distanța până la SL.
- Varianta „SL: Slingshot” amesteca SL-ul semnalului cu raportul utilizatorului, deși regula lui e că Slingshot și risk/reward nu merg împreună.

### Cercetare
- **Pe piață:** boții obișnuiți (3Commas) au „Take profit %” și „Stop loss %” de la prețul de intrare. Exemplul lor: un stop de 10% la o intrare de 10 000 vinde la 9 000.
- **În bază (22 oct):** un singur bot Premium, cu „Slingshot”. Niciun bot nu folosește „Risc / câștig”.

### Cum e acum
- **„Stop loss și take profit”:** „Slingshot” sau „Risc / câștig”, două variante care se exclud (FD-BOTSLRR).
- **„Risc / câștig”** are doar procentele tale, fără nimic de la Slingshot:
  - **„Stop loss (% de la intrare)”** (implicit 1);
  - **„Take profit (% de la intrare)”** (implicit 2);
  - sub ele, pe toată lățimea: „Raportul risc : câștig: 1:2 (calculat din cele două procente).” Raportul e scris cu riscul întâi, adus la 1 (1% și 1,5% → „1:1,5”; 1,5% și 2% → „1:1,33”). Cu un procent gol sau greșit: „—”.
- **Explicația din formular**, fixă:
  > „Două variante care se exclud, nu merg împreună. Slingshot: botul intră cu stop loss-ul și take profit-ul semnalului, exact ca pe grafic. Slingshot își calculează singur raportul risc / câștig, deci botul nu pune niciun R:R peste el. Risc / câștig: nu respectă nivelurile Slingshot. Alegi tu până unde merge stop loss-ul și până unde merge take profit-ul, în procente de la intrare; raportul risc : câștig se calculează din ele (de exemplu 1% și 2% dau 1:2).”
- **Nivelurile unei intrări cu „Risc / câștig”:**
  - long la 100 cu 1% / 2%: SL 99, TP 102;
  - short la 100: SL 101, TP 98.
- **Ieșirile marcate de Slingshot pe lumânare** (SL / TP-ul semnalului atins) se aplică doar la „Slingshot”, ca până acum. Semnalul de TP Slingshot, întoarcerea trendului și semnalul opus rămân opțiunile lor.
- **„Verifică”:** „SL și TP: ale semnalului Slingshot.” sau „SL 1% și TP 2% de la intrare (risc : câștig 1:2).”
- **AI-ul** primește sursa nivelurilor: „ale semnalului Slingshot” sau „procentele utilizatorului de la intrare”.
- **„Risc %”** (mărimea) folosește în continuare distanța până la SL.

### Cazuri limită
| Situație | Comportament |
|---|---|
| 1% și 2% | SL 1%, TP 2% de la intrare; raportul 1:2 |
| 2% și 3% | raportul „1:1,5” |
| TP mai aproape decât SL (2% și 1%) | permis până la 2:1 („1:0,5”) |
| Raportul în afara limitelor (TP sub jumătate din SL sau peste de 10 ori SL-ul) | refuzat: „Raportul risc : câștig 1:20 iese din limite: take profit-ul e între jumătate și de 10 ori distanța stop loss-ului (de la 2:1 la 1:10).” |
| SL în afara 0,1–50% sau TP în afara 0,1–500% | refuzat, cu limita („Stop loss-ul: cel mult 50”) |
| Short cu TP de 100% sau mai mult | nu intră: „Take profit-ul ar fi la un preț sub zero.” |
| Un procent gol | „Stop loss-ul: lipsește.” / „Take profit-ul: lipsește.”; raportul arată „—” |
| Cu „Slingshot”, procentele (ascunse) | nu se folosesc; golite sau greșite, nu opresc salvarea (rămân cele valide, altfel 1% și 2%) |
| Botul SOL (Slingshot, salvat cu SL 2% și R 2) | neschimbat: SL / TP-ul semnalului. Procentele ascunse devin 2% și 4% (la trecerea pe „Risc / câștig” arată 1:2) |
| Setări salvate cu „Risc / câștig” și SL procentual (x%, raport R) | SL x%, TP x% × R: aceleași niveluri |
| Setări salvate cu „Risc / câștig” și SL-ul semnalului | nu există în bază (verificat); s-ar citi ca SL-ul procentului salvat și TP-ul × R, deci SL-ul nu mai vine de la Slingshot |
| Un tab cu o versiune veche (trimite SL / TP / R / raport) | salvarea trece, convertită ca mai sus; după reîncărcare, formularul nou |
| Simulare / real, spot / futures / acțiuni | aceleași niveluri; pe futures, SL-ul trebuie să rămână înaintea lichidării (FD-BOT §6) |
| Telefon (390 / 320 px) | câmpurile unul sub altul, raportul sub ele, fără depășire |

## FIX-BROTLI — conținutul extern se descarcă fără decompresie Brotli, până la Node.js 24.22.1 pe Azure (22 oct 2026)

### Ce cere utilizatorul
„Au apărut patch-uri pentru Node.js, foarte importante pentru securitate. Trebuie să facem noi update sau Microsoft?” Varianta aleasă dintre cele propuse: o protecție în cod, până când Microsoft trece imaginea pe Node 24.22.1.

### Situația (verificată 22 oct)
- **Avizul Node.js din 21 oct 2026:** zece vulnerabilități, reparate în 22.23.4, 24.22.1 și 26.12.1. Cea mai gravă e CVE-2026-111497: o scriere în afara memoriei în decodorul Brotli, care permite rularea de cod de la distanță.
- **Azure:** imaginea `appsvc/node:24-lts_20260904`, cu Node **24.20.0**. Cu „24-lts”, Microsoft alege și aplică singur patch-urile, fără o dată garantată.
- **Expunerea Sentiq:**
  - descarcă fluxuri de știri (inclusiv surse adăugate de utilizatori), pagini, calendarul economic și contextul piețelor de pe site-uri externe;
  - `fetch`-ul din Node cere `br` și decomprimă automat răspunsurile Brotli;
  - decodorul pornește pe măsură ce sosesc datele, înainte ca Sentiq să citească corpul răspunsului, deci verificarea antetului după `fetch` nu ajunge;
  - o sursă rău intenționată sau compromisă ar putea trimite exact datele care declanșează breșa.

### Cum e acum
- **Descărcarea conținutului extern** (știri, pagini, sitemap-uri, calendar, componența indicilor, contextul piețelor) folosește un transport propriu, fără decompresia automată a lui `fetch`:
  - cere doar `gzip, deflate`;
  - decomprimă gzip și deflate, care nu sunt afectate;
  - un răspuns Brotli (sau zstd) e refuzat înainte de orice decodare, chiar dacă serverul îl trimite fără să i se ceară. Sursa arată eroarea: „Serverul a trimis conținut comprimat Brotli (br); Sentiq nu-l decomprimă (FIX-BROTLI).”
- **Restul descărcării rămâne la fel:**
  - limita de timp și limita de mărime;
  - cererile condiționate (ETag / Last-Modified);
  - redirecționările (cel mult 20);
  - proxy-ul din mediu, unde e pornit.
- **Ce rămâne pe `fetch`, neschimbat:** API-urile serviciilor cunoscute, la care un atac ar cere compromiterea serviciului:
  - brokerii și ordinele (bani reali: nicio schimbare pe calea de tranzacționare);
  - bursele (ccxt), AI-ul, e-mailul (Resend);
  - Twelve Data, Nasdaq, CNBC, TradingView.
  - Riscul rămas dispare odată cu Node 24.22.1 pe Azure.
- **Ce nu acoperă:** celelalte vulnerabilități din aviz rămân pe ambele căi până la Node 24.22.1:
  - verificarea numelui din certificatul TLS când adresa arată ca un IP;
  - `dns.resolve`;
  - socket-urile keep-alive.
  - Sentiq se conectează prin nume de domeniu și nu folosește `dns.resolve`, deci ele îl ating mai puțin decât breșa Brotli.
- **Protecția rămâne și după actualizare.** Serverele trimit Brotli doar dacă li se cere, deci nu costă nimic.
- **Verificat pe cele 48 de surse de știri active din baza reală:** aceleași răspunsuri ca prin `fetch` (47 merg cu ambele, una pică la amândouă). Niciuna n-a trimis Brotli necerut.
- **Mac-ul:** Node se actualizează local (comanda e în raport); Sentiq cere Node 24 sau mai nou.

### Cazuri limită
| Situație | Comportament |
|---|---|
| Server care respectă cererea (cele mai multe) | trimite gzip, deflate sau nimic; descărcarea merge ca înainte |
| Server care trimite totuși `br` (sau `gzip, br`, `zstd`) | refuzat înainte de decodare, cu mesajul din FD; sursa încearcă din nou la următoarea citire |
| `br` pe un răspuns de redirecționare (3xx) | corpul nu se citește; redirecționarea e urmată |
| `Content-Encoding: identity` sau o valoare necunoscută (servere greșit configurate, de ex. `utf-8`) | corpul se ia așa cum vine, ca la `fetch` |
| deflate cu sau fără antet zlib | ambele se decomprimă |
| gzip trunchiat | se ia cât s-a putut decomprima, ca la `fetch` |
| „Bombă” gzip (mic comprimat, uriaș decomprimat) | limita de mărime se aplică la ce iese decomprimat; peste ea: „Răspuns prea mare” |
| 304 Not Modified, 204 | fără corp, ca înainte |
| Redirecționare relativă, 301 / 302 / 303 după POST, 307 / 308 | ca la `fetch`: adresa rezolvată, POST → GET la 301 / 302 / 303, metoda păstrată la 307 / 308 |
| Redirecționare spre alt site | antetul `Authorization` nu se trimite mai departe, ca la `fetch` |
| Peste 20 de redirecționări | eroare: „Prea multe redirecționări” |
| Limita de timp, la antete sau la un corp care se oprește la jumătate | „Niciun răspuns în N s”, ca înainte |
| Adresă care nu e http(s) | eroare de rețea, ca la `fetch` |
| Proxy (`NODE_USE_ENV_PROXY`, local în sandbox) | folosit, ca la `fetch` |
| Testele | cârligul `setFetchImpl` înlocuiește în continuare ambele transporturi |

## FD-BOTDIR — scorul pieței: un prag pentru long, altul pentru short (26 oct 2026)

### Ce cere utilizatorul
- „Scorul sub care botul nu mai intră în tranzacții este luat în calcul greșit. Un scor mic favorizează short-urile, un scor mare favorizează long-urile, iar noi acum avem o singură valoare […] Trebuie să avem scoruri diferite pe direcții diferite ale Slingshot-ului.”

### Ce era (FD-BOT §6)
- **Scorul era al tranzacției, nu al pieței.** Fiecare parte dădea acordul cu latura semnalului: pentru un short, știrile negative urcau scorul.
  - Un singur „Scorul minim” M era deci, pe scara pieței, „long de la M în sus, short de la 100 − M în jos”. Cu M = 39 (botul SOL): long de la 39, short până la 61.
- **Formularul nu spunea asta.** „Scorul (0–100, 50 neutru)” arăta ca indicele de sentiment, unde mic = negativ. De aici concluzia firească: un short, cu piața negativă, are scor mic și e oprit de minim.
- **Verificat pe baza reală (26 oct), botul SOL** (`SOL/USDT`, futures, real, „Ambele”, scorul minim 39 din 24 oct 21:16 UTC):
  - din 23 oct 21:11 UTC rulează pe 2h. Pe cele 29 de lumânări de 2h închise de atunci, Slingshot n-a confirmat niciun semnal, nici long, nici short (refăcut lumânare cu lumânare, cu setările utilizatorului);
  - jurnalul n-are nicio intrare refuzată după 23 oct 16:00 UTC. Atunci: „LONG: scorul 43,2 e sub minim (45)” (pe 15m);
  - ultimul short (22 oct 22:15 UTC) a intrat cu scorul 51,9;
  - pe 2h, ultimul semnal e un SHORT confirmat pe 23 oct 18:00 UTC, înainte de trecerea botului pe 2h. Pe 1h au fost două SHORT pe 25 oct, dar botul nu e pe 1h.
  - Deci, în cele trei zile, niciun short n-a fost refuzat pentru scor. Cererea rămâne: fiecare direcție cu pragul ei, pe scara pe care o citește utilizatorul.

### Cercetare
- Boții care filtrează cu sentiment folosesc o singură scară (de ex. Fear & Greed, sau un scor −1…+1). Long-urile au un prag de piață pozitivă, short-urile unul de piață negativă, de obicei cu o zonă neutră între ele (TradersPost: long doar peste un scor; exemplul Interactive Brokers: prag ±0,1 în jurul neutrului).
- Scara Sentiq (0–100, 50 neutru, peste 60 pozitiv, sub 40 negativ) e deja cea a indicilor din aplicație.

### Cum e acum
- **Scorul pieței (0–100, 50 neutru):** aceleași cinci părți și aceleași ponderi, dar fiecare spune încotro înclină piața, nu dacă e de acord cu tranzacția:
  - scorul zilei, aria, sentimentul pe 7 zile, știrile simbolului: (indice − 50) / 50 × încrederea, ca înainte pentru un long;
  - Slingshot: 0,4 × (ultima rupere de structură: în sus +1, în jos −1, niciuna 0);
  - scor = 50 + 50 × Σ(pondere × înclinare) / Σ ponderi (doar părțile cu date).
  - **Un scor mare favorizează long-urile, unul mic short-urile.** Același context dă același scor, oricare ar fi latura semnalului.
- **Două praguri** în locul „Scorului minim”:
  - **„Scorul minim pentru long”** (implicit 50): un long intră doar la scor ≥ el;
  - **„Scorul maxim pentru short”** (implicit 50): un short intră doar la scor ≤ el.
  - Întregi, 0–100. Formularul arată doar pragurile direcțiilor pe care le face botul. Un prag ascuns nu oprește salvarea: rămâne cel valid, altfel 50.
- **Explicația din formular**, fixă:
  > „Semnalul Slingshot e motivul intrării. Scorul pieței (0–100, 50 neutru) adună scorul zilei, aria, sentimentul pe 7 zile, știrile simbolului și structura pieței: un scor mare favorizează long-urile, unul mic short-urile. De aceea fiecare direcție are pragul ei.”
- **Sub praguri, o propoziție după valorile scrise:**
  - (direcția e cea arătată în formular: pe spot, la Trading 212 și la Alpaca, doar long)
  - Ambele, long ≤ short: „Long de la scorul 45 în sus, short de la 55 în jos: între 45 și 55 pot intra amândouă.” (la valori egale: „la 50 pot intra amândouă”);
  - Ambele, long > short: „Long de la scorul 55 în sus, short de la 45 în jos: peste 45 și sub 55, botul nu intră.”;
  - doar long: „Long de la scorul 50 în sus.”; doar short: „Short de la scorul 50 în jos.”;
  - un prag gol sau greșit: „—” în locul lui.
- **Jurnalul:**
  - refuz long: „LONG: scorul pieței 43,2 e sub minimul pentru long (45).”;
  - refuz short: „SHORT: scorul pieței 64,1 e peste maximul pentru short (45).”;
  - intrare: „… scor 30,6.” ca înainte.
  - Detaliul: „Scorul pieței 30,6 (short până la 45)” sau „(long de la 55)”; la fiecare parte, „spre long 0,12” sau „spre short 0,12” (verde, respectiv roșu, peste 0,05), sau „neutru” (ce se rotunjește la 0,00).
  - Intrările mai vechi rămân cum au fost scrise: „Scorul tranzacției 51,9 (minim 45; calculul de dinainte de pragurile pe direcții: peste 50 în favoarea tranzacției)” și „acord”.
- **„Verifică”:**
  - „… long și short de pe 2h: long când scorul pieței e cel puțin 39, short când e cel mult 61.”;
  - doar long: „… când scorul pieței e cel puțin 50”; doar short: „… cel mult 50”;
  - cu „AI confirmă”, încă o propoziție: „AI-ul confirmă fiecare intrare.”
  - **Avertisment** când pragul unei direcții pe care o face botul nu poate fi atins cu ponderile alese (scorul cel mai mare posibil, cu toate părțile la capăt: 50 + 50 × (Σ ponderi ale indicilor + 0,4 × ponderea Slingshot) / Σ ponderi; implicit 94):
    - „Cu ponderile alese, scorul pieței ajunge cel mult la 94: cu minimul 95, botul nu intră niciodată long.”;
    - „Cu ponderile alese, scorul pieței coboară cel mult până la 6: cu maximul 5, botul nu intră niciodată short.”
- **AI-ul** primește: „Scorul pieței (0–100, 50 neutru; peste 50 favorizează long-ul, sub 50 short-ul): 30.6. Un SHORT intră până la 45.” și părțile.
- **Setările salvate înainte** (un „Scorul minim” M) se citesc ca long de la M, short până la 100 − M. Aceleași intrări ca înainte. Botul SOL: long de la 39, short până la 61. Următoarea salvare le scrie în forma nouă.
- **Două semnale pe aceeași lumânare, cu „Ambele”:** se încearcă întâi latura pe care o favorizează piața (scor > 50: long; < 50: short; la 50, ordinea Slingshot). Intră doar una, ca înainte.
- **Neschimbate:** „Nu intra împotriva ariei”, calendarul, AI-ul, ponderile, ordinea verificărilor (scorul e tot pasul 6).

### Cazuri limită
| Situație | Comportament |
|---|---|
| Piață negativă (scor 30), semnal SHORT, maxim short 45 | intră |
| Piață negativă (scor 30), semnal LONG, minim long 45 | „LONG: scorul pieței 30 e sub minimul pentru long (45).” |
| Scorul exact la prag (long 45 la minim 45; short 45 la maxim 45) | intră (pragurile includ valoarea) |
| Long ≤ short (zonă comună) | în zona comună, oricare semnal poate intra |
| Long > short (zonă neutră) | strict între ele, niciun semnal nu intră |
| Prag 0 la long / 100 la short | filtrul nu mai oprește acea direcție |
| Prag de neatins cu ponderile alese (long 95 cu ponderile implicite) | salvarea merge; „Verifică” avertizează că direcția nu intră niciodată |
| Fără date de sentiment (doar structura) | 70 (rupere în sus), 30 (în jos), 50 (niciuna), ca înainte pentru un long |
| Botul face doar long (sau spot, Trading 212, Alpaca) | doar pragul long se arată și contează; cel short, ascuns, se păstrează |
| Botul face doar short | doar pragul short se arată și contează |
| Prag ascuns gol sau greșit | nu oprește salvarea: rămâne valid sau 50 |
| Prag gol sau greșit, arătat | „Scorul minim pentru long: lipsește.” / „…: nu e un număr.”; limitele: „Scorul maxim pentru short: cel mult 100”, „…: un număr întreg” |
| Setări vechi cu „Scorul minim” M | long M, short 100 − M: aceleași intrări (la o egalitate exactă de rotunjire, x,x5, diferența e de 0,1 puncte) |
| Un tab cu versiunea veche (trimite „Scorul minim”) | salvarea trece, convertită ca mai sus |
| Setări cu ambele forme | contează pragurile noi; „Scorul minim” se ignoră |
| Editarea pragurilor la un bot pornit | se aplică de la semnalul următor |
| Două semnale pe aceeași lumânare, ambele peste prag | întâi latura favorizată de piață; a doua: „botul a intrat deja pe semnalul celălalt.” |
| Intrări vechi în jurnal | rămân cu „Scorul tranzacției” și „acord”, cum s-au calculat |
| AI-ul | primește scorul pieței și pragul laturii; poate doar să oprească o intrare |
| Simulare / real, crypto / acțiuni | aceleași praguri |
| Telefon (390 / 320 px) | pragurile unul sub altul, propoziția sub ele, fără depășire |

## FD-NEWSWIN — setarea „Ferește știrile (min înainte)” poartă numele a ceea ce face (26 oct 2026)

### Ce cere utilizatorul
- „Redenumește setarea asta ca să fie exact ceea ce ai explicat tu aici. Poți să o numești «evită deschiderea de tranzacții în perioada știrilor importante economice», pentru că titlul pe care l-ai pus tu nu spune nimic.”

### Ce face setarea (neschimbat, FD-BOT §6, pasul 4)
- La un semnal, botul nu intră dacă în calendar e un eveniment USD cu impact mare în următoarele N minute sau în ultimele 15. Contează doar evenimentele cu oră, nu cele care țin toată ziua.
- Pozițiile deschise nu sunt atinse: SL, TP și celelalte ieșiri merg normal.
- Semnalul refuzat nu se reia după eveniment.
- N implicit 60; 0 = oprit; cel mult 720.

### Cum e acum
- **Numele:** „Evită deschiderea de tranzacții în perioada știrilor economice importante” (ordinea firească a cuvintelor: „știrilor economice importante”).
- **Sub câmp, ce înseamnă numărul:**
  > „Minutele dinaintea unei știri economice cu impact mare pentru dolar (și încă 15 după ea) în care botul nu deschide tranzacții. Pozițiile deschise merg normal. 0: oprit.”
- **Așezarea:**
  - numele e lung, deci setarea are un rând al ei;
  - câmpul are lățimea unei coloane, ca celelalte;
  - „Pauză după o pierdere (min)” trece pe rândul următor.
- **Erorile** numesc numărul: „Minutele dinaintea știrilor economice importante: lipsește.” / „…: cel mult 720” / „…: un număr întreg”.
- **Neschimbate:** valorile salvate (`newsWindowMin`), comportamentul și mesajul din jurnal („eveniment cu impact mare peste 40 min: …”).

### Cazuri limită
| Situație | Comportament |
|---|---|
| Boți existenți (botul SOL: 60) | aceeași valoare, același comportament; doar numele din formular se schimbă |
| 0 | oprit: botul intră indiferent de calendar (explicația o spune) |
| Gol / text / zecimal / peste 720 | eroarea cu „Minutele dinaintea știrilor economice importante” |
| Editarea unui bot pornit | același câmp, același nume |
| Desktop (1440) | numele pe un rând, câmpul cât o coloană, explicația sub el |
| Telefon (390 / 320) | numele pe mai multe rânduri, câmpul pe toată lățimea, fără depășire |

## FIX-PINESYNC — Slingshot 3.4 în TradingView: numele și prețurile ca în Sentiq (26 oct 2026)

### Ce cere utilizatorul
- „Vreau să adaug indicatorul Slingshot și în TradingView. Vreau să aibă ultimele modificări.”
- După compararea etichetelor (captura Sentiq cu setările utilizatorului față de apelurile `label.new` / `table.cell` din Pine), utilizatorul a ales: **stop loss-ul rămâne cum e**, adică eticheta semnalului „eșuată” (triunghi) plus eticheta „STOP LOSS”, iar X doar pentru invalidat. **Se aliniază doar diferențele găsite.**

### Comparația (26 oct 2026)
- **La fel în Sentiq și în Pine:**
  - etichetele LONG / SHORT / TAKE PROFIT / STOP LOSS (texte, triunghiuri, poziții), cu stările „în formare”, „valid”, „eșuat” și „invalidat” (X);
  - nivelurile „TAKE PROFIT / STOP LOSS” cu prețul;
  - tabelul („TAKE PROFIT (SHORT)” / „STOP LOSS (SHORT)”);
  - liniile și textele Market Structure;
  - cele 79 de intrări din Pine, cu aceleași valori implicite. Sentiq are în plus grosimea și tipul liniilor celor două EMA, pe care TradingView le pune în tab-ul Stil (FD-STYLEUNIFY).
- **Diferite:**
  - **numele:** TradingView „[Dusty Investments] Slingshot System 3.4” / „[DI] SS 3.4”, Sentiq „[DE] Slingshot System 3.4” / „[DE] Slingshot 3.4”;
  - **prețurile** din etichetele nivelurilor și din tabel: TradingView `#.##` (cel mult două zecimale, deci 0 la monedele mici), Sentiq precizia pieței.

### Cum e acum (fișierul `Sling Shot System/sling-shot-system-3.4.pine`)
- **Numele:** titlul „[DE] Slingshot System 3.4”, numele scurt (legenda) „[DE] Slingshot 3.4”, ca în Sentiq (FD-DENAMES).
- **Prețurile** din cele patru etichete de nivel și din tabel: `format.mintick`, adică precizia tick-ului simbolului din TradingView, ca precizia pieței din Sentiq.
- **Neschimbate:** etichetele și forma lor, culorile, mărimile, alertele, intrările, logica. `sling-shot-system.pine` (3.3) rămâne neatins.

### Cazuri limită
| Situație | Comportament |
|---|---|
| Monedă cu preț mic (de ex. 0,00001234) | prețul cu zecimalele tick-ului, nu „0” |
| SOL pe KuCoin (tick 0,01) / BTC (tick 0,1) | două zecimale / una, ca în Sentiq (unde BTC apare 80.562,6) |
| Simbol cu tick care nu e putere a lui 10 (de ex. 0,25 la futures) | rotunjit la tick, cum îl arată scala TradingView |
| Separatorul zecimal | punct în TradingView, virgulă în caseta Sentiq (formatul fiecărei aplicații, neschimbat) |
| Zerourile de la final | cum le scrie TradingView cu `format.mintick` (nu pot verifica aici; Sentiq le scrie mereu) |
| Indicatorul vechi deja pe un grafic TradingView | scriptul nou se adaugă ca indicator separat; alertele create pe cel vechi rămân pe el și se refac pe cel nou |
| Compilarea | TradingView o face la salvare; aici nu există compilator Pine. Schimbările folosesc doar `format.mintick` (o constantă din Pine v5) și numele |
