# Sentiq — Functional Design

> Document viu, în două părți:
> - **Partea I — Sentiq azi**: ce face aplicația acum, pagină cu pagină, cu regulile și cazurile limită care sunt în vigoare. Aceasta e referința.
> - **Partea a II-a — Istoricul deciziilor**: secțiunile FD-… scrise înaintea fiecărei schimbări (datate), cu cererea utilizatorului, cazurile limită și conflictele de atunci. O secțiune mai nouă poate înlocui o parte dintr-una mai veche; Partea I spune ce e valabil.
>
> Sentiq se numea **Kryptoniq** până pe 13 oct 2026 (FD-SENTIQ §1). Cercetarea pe care se bazează deciziile: [research.md](research.md). Implementarea: [technical-design.md](technical-design.md). Ghidul pentru utilizator: [user-guide.md](user-guide.md).

# Partea I — Sentiq azi

> Numerotarea §0–§9 e cea din v1 (codul și secțiunile mai vechi trimit la ea); subiectele apărute după v1 sunt §10–§14.

## 0. Scop și principii

Sentiq (de la *sentiment* + *IQ*) este un **asistent de day-trading** pentru crypto și acțiunile americane. Adună într-un singur loc ce se întâmplă în piață (știri crypto, acțiuni, macro, geopolitică), calculează **sentimentul zilei**, arată **calendarul economic** (cu rezultatele companiilor), **indicatorii economici pe țări**, **grafice cu indicatorii Slingshot System și LMA** și **portofoliile** de la exchange-uri crypto și brokeri. Opțional, Claude scrie **rezumatul zilei**.

Principii:
1. **Datele stau în Azure SQL Database** (FD-AZURE). Aplicația rulează online pe Azure App Service, la **https://sentiq.money** (pași în [deploy-azure.md](deploy-azure.md)), și pe Mac, pe aceeași bază. Fiecare persoană are **contul ei** (parolă, 2FA, passkey); conturile se dau doar la cerere, aprobate de admin.
2. **Informează, nu tranzacționează.** Aplicația nu plasează și nu anulează ordine. Cheile de exchange / broker trebuie să fie doar de citire.
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
- Bifele „Slingshot”, „LMA” și „Pozițiile mele” arată / ascund indicatorii și pozițiile; setările ambilor indicatori au aceleași nume și valori implicite ca în TradingView.
- **Pozițiile și ordinele** tale pe moneda afișată apar ca linii, cu PnL la SL, TP și la prețul curent.
- Favoritele de deasupra graficului se reordonează prin tragere (sau Alt + ← / →); ordinea e aceeași peste tot.
- Se țin minte: perechea, timeframe-ul, bifele, înălțimea panoului LMA, setările indicatorilor; zoom-ul pe fiecare pereche și timeframe, în browser. **Ecran complet**, cu ieșire prin buton sau Esc.

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
- „Adaugă un cont” (pagina Tranzacții sau Setări) deschide un asistent: alegi platforma după logo (filtru Crypto / Acțiuni, căutare), urmezi pașii pentru o cheie doar de citire (cu linkul spre pagina furnizorului), completezi exact câmpurile cerute; contul se salvează doar dacă testul conexiunii reușește.
- Platforme (doar cele cu API): **KuCoin, Binance, Bybit, OKX, Kraken, Coinbase, Bitget** (crypto) și **Trading 212, eToro, Interactive Brokers, Alpaca** (acțiuni).
- Pe fiecare cont, cu logo-ul lui: poziții (futures / cu levier), dețineri cu preț mediu și PnL, numerar (la brokeri), ordine deschise, tranzacțiile recente (7 zile). Reîmprospătare la 30 s cât pagina e deschisă + butonul „Reîmprospătează” din bara paginii, lângă „Adaugă un cont”.
- **Cardurile unui cont crypto** (FD-TRADESTATS): Disponibil în futures · Valoare în contul spot · PnL nerealizat (futures) · Tranzacții profitabile · Tranzacții cu pierdere · Rata de succes · Câștig net. Ultimele patru numără pozițiile futures închise în perioada aleasă în bara paginii (Azi · 7z · 30z · 90z), după rezultatul lor net; KuCoin, Bybit, OKX, Bitget (Binance nu dă istoricul prin API).
- La brokeri: Valoare dețineri · Numerar disponibil · PnL nerealizat (poziții).

### 6.2 Securitate
- Cheile se salvează **criptat**; după salvare se vede doar un indiciu (`abcd…wxyz`).
- Aplicația **nu are cod** care plasează sau anulează ordine.
- Dacă platforma raportează că o cheie are drepturi de tranzacționare sau retragere, apare un avertisment.

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
- **Favorite**: monede (căutare pe exchange-ul utilizatorului și pe cel implicit), acțiuni (căutare după simbol sau nume) și indici (din lista de 7: SPX, NDX, COMP, DJI, RUT, VIX, SOX); reordonare prin tragere, săgeți sau Alt + ↑ / ↓; aliasuri pentru știri.
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
- Plasare de ordine (exclus prin design).
- Notificări desktop / sonore (alerte de indicator, reminder înainte de CPI).
- Evenimente crypto automate (unlock-uri, upgrade-uri): doar ca evenimente personale.
- Backtesting.
- Indici din afara SUA și futures pe indici (fără o sursă gratuită, FD-INDICES §2).

## 10. Conturi, roluri și acces (FD-USERS, FD-INVITE)
- **Roluri:** un **admin** (proprietarul, cu toate datele de dinainte de conturi) și **utilizatori**.
- **Ale fiecăruia:** favoritele, setările graficelor, ale calendarului și timeframe-ul semnalelor, alegerea exchange-ului de prețuri (dintre cele conectate), fusul orar, conturile de exchange / broker, evenimentele personale, rezumatul zilei, conexiunile Claude. **Comune:** știrile, sentimentul zilei, calendarul economic, indicatorii economici, datele de piață.
- **Doar adminul:** sursele de știri, motorul de sentiment și cheia Claude, cheia Twelve Data, emailul (Resend), retenția (toate în Setări → Admin), *Stare sistem* și *Utilizatori*.
- **Cont nou doar la cerere:** „Cere un cont” (nume și email) → adminul primește email și vede un punct pe inițiala lui → *Utilizatori* → Aprobă (sau Respinge) → persoana primește linkul de activare (7 zile), își alege parola → login. O cerere fără răspuns dispare după 30 de zile.
- **Login:** email + parolă (minimum 12 caractere, literă mare, literă mică, cifră), apoi codul TOTP (5 minute) sau un cod de recuperare dacă 2FA e pornit; sau **passkey** (merge pe adresa pe care a fost creat: https://sentiq.money sau `http://localhost:4317` pe Mac; niciodată pe o adresă IP). 3 încercări greșite de pe același dispozitiv → pauză 15 minute. Sesiunea ține 30 de zile de la ultima folosire.
- **Parola uitată:** link valabil o oră; parola nouă închide toate sesiunile.
- **Securitate** (meniul contului): nume, parolă, 2FA (cod QR + 10 coduri de recuperare), passkey-uri, „Ieși de pe toate dispozitivele”.
- **Utilizatori** (admin): cereri de cont, link nou de activare, dezactivare / reactivare, oprirea 2FA, ștergerea contului (cu datele lui).
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
- **Rezultatele trimestriale** ale acțiunilor favorite (de la Nasdaq) apar ca evenimente:
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
- **„De ce acest scor?”** (pagina Știri) arată importanța folosită și de unde vine; când diferă, și ce ar fi dat cuvintele-cheie.

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
