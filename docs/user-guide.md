# Sentiq — Ghid de utilizare

Sentiq (de la *sentiment* + *IQ*, fostul Kryptoniq) adună într-un singur loc știrile și sentimentul pieței, calendarul economic, graficele cu Slingshot și LMA, plus portofoliile tale de la exchange-uri crypto și brokeri de acțiuni. Datele stau într-o bază **Azure SQL**. Aplicația rulează pe Mac-ul tău și se poate deschide și de pe alte dispozitive din rețeaua de acasă, fiecare utilizator cu contul lui. Publicarea online (Azure App Service) e descrisă în [deploy-azure.md](deploy-azure.md).

## Pornire
Cerințe: macOS, Node.js ≥ 24 (testat pe 25.9) și baza de date Azure SQL.

**Conexiunea la bază** stă în `data/database.env`, un fișier local care nu ajunge în git. Completezi fie cele 4 rânduri, fie connection string-ul:
- `SENTIQ_DB_SERVER`, `SENTIQ_DB_NAME`, `SENTIQ_DB_USER`, `SENTIQ_DB_PASSWORD`;
- sau `SENTIQ_DB_CONNECTION`: din portal (baza → *Connection strings* → *ADO.NET (SQL authentication)*), cu parola pusă în locul lui `{your_password}`.

Valorile se scriu fără ghilimele. Verifici legătura cu `scripts/sentiq.sh db-check`, care nu afișează parola. Utilizatorul bazei e bine să fie unul doar pentru baza Sentiq (`CREATE USER sentiq_app WITH PASSWORD = '…'; ALTER ROLE db_owner ADD MEMBER sentiq_app;`, rulat în baza Sentiq), nu adminul serverului.

```bash
npm install        # o singură dată
npm start          # construiește interfața și pornește serverul
```
Deschide **http://localhost:4317**. Din rețeaua de acasă (telefon, alt calculator) merge și adresa Mac-ului, de exemplu `http://192.168.1.20:4317` (o vezi cu `scripts/sentiq.sh status`). La prima pornire macOS poate întreba dacă Node are voie să primească conexiuni: alege **Allow**. Ca Sentiq să asculte doar pe Mac, pornește-l cu `SENTIQ_BIND=127.0.0.1`.

> Dacă `npm install` se plânge de fișiere „root-owned” în `~/.npm`, rulează o dată: `sudo chown -R $(id -u):$(id -g) ~/.npm`.

La prima pornire:
- se creează tabelele în baza Azure SQL și `data/` (cheia de criptare `master.key`, log-uri, modelul AI);
- se descarcă modelul de sentiment (~170 MB, o singură dată). Până e gata, știrile apar „în analiză”;
- favoritele pornesc cu BTC, ETH, SOL.

Oprire: `Ctrl+C` în terminal. Datele rămân în baza Azure SQL; în `data/` stau conexiunea, cheia master, modelul de sentiment și log-urile (`data/logs/`, câte unul pe zi, păstrate 30 de zile).

Pentru dezvoltare: `npm run dev` (server cu reîncărcare + interfață pe http://localhost:5317; passkey-urile merg și aici), `npm test`, `npm run typecheck`.

### Pornire fără Terminal (`Sentiq.app`)
Generezi o singură dată aplicația, din Terminal, în folderul proiectului:
```bash
scripts/sentiq.sh app
```
Apare **`Sentiq.app`** în folderul proiectului. La dublu-click pornește serverul în fundal (dacă nu rulează deja), fără fereastră de Terminal, și deschide http://localhost:4317. Prima pornire poate dura câteva secunde în plus dacă trebuie reconstruită interfața.
- **Dock**: trage `Sentiq.app` în Dock (și scoate de acolo vechiul `Kryptoniq.app`, care nu mai pornește nimic).
- **Pornire automată la login**: *System Settings → General → Login Items → Open at Login → +* → alege `Sentiq.app`. Dacă aveai acolo `Kryptoniq.app`, înlocuiește-l.
- **Prima dată** macOS poate întreba dacă „Sentiq” are voie să acceseze folderul **Documents**. Alege **Allow**, pentru că proiectul e acolo. Dacă ai refuzat: *System Settings → Privacy & Security → Files and Folders → Sentiq → Documents*.
- Dacă regenerezi aplicația (`scripts/sentiq.sh app`), macOS poate cere din nou permisiunea.
- Iconița aplicației vine din `src/web/public/Sentiq.icon`. Dacă o modifici în Icon Composer, rulează `scripts/app-icon/build.sh` (cere Xcode), apoi `scripts/sentiq.sh app`.

**De la fișierul local la Azure SQL.** Până pe 14 oct 2026 datele stăteau în `data/kryptoniq.db`. Le muți o singură dată:
1. Oprești Sentiq: `scripts/sentiq.sh stop`.
2. Rulezi `scripts/sentiq.sh import-sqlite`. Copiază utilizatorii, conturile, cheile, favoritele, setările, știrile, calendarul și restul, totul sau nimic, apoi verifică numărul de rânduri și cheia master.
3. Pornești Sentiq din nou.

Pe o bază care are deja date, importul refuză; `--replace` o înlocuiește. Fișierul rămâne pe disc ca rezervă. Cheia `data/master.key` rămâne aceeași (pe Azure, ca setarea `SENTIQ_MASTER_KEY`).

**De la Kryptoniq la Sentiq.** Cheia `data/master.key` și cheile salvate se folosesc mai departe, fără nicio mutare. Variabilele `KRYPTONIQ_*` sunt acceptate în continuare, alături de noile `SENTIQ_*`. Vechiul `Kryptoniq.app` și `scripts/kryptoniq.sh` au fost scoase din proiect: folosește `Sentiq.app` și `scripts/sentiq.sh`.

Serverul pornit așa rulează până îl oprești sau până închizi sesiunea / oprești Mac-ul. Comenzi utile, din Terminal:

| Comandă | Ce face |
|---|---|
| `scripts/sentiq.sh` sau `scripts/sentiq.sh start` | pornește în fundal (dacă nu rulează) și deschide browserul (`--no-open` = fără browser) |
| `scripts/sentiq.sh stop` | oprește serverul (inclusiv unul pornit cu `npm start`) |
| `scripts/sentiq.sh restart` | oprește și pornește din nou, de exemplu după o actualizare a codului |
| `scripts/sentiq.sh status` | arată dacă rulează, de cât timp și adresele din rețea |
| `scripts/sentiq.sh logs` | urmărește log-ul zilei (`Ctrl+C` pentru ieșire) |
| `scripts/sentiq.sh admin-email ADRESA` | adresa contului de admin, înainte de prima intrare |
| `scripts/sentiq.sh admin-reset` | dacă adminul nu mai poate intra: șterge parola, 2FA și passkey-urile adminului (datele rămân); prima deschidere de pe Mac cere din nou parola, apoi configurarea 2FA |
| `scripts/sentiq.sh db-check` | verifică legătura cu baza de date: serverul, baza, nivelul, spațiul, dacă utilizatorul își poate crea tabelele; fără parolă |
| `scripts/sentiq.sh import-sqlite` | mută o singură dată `data/kryptoniq.db` în Azure SQL (cu Sentiq oprit); `--replace` înlocuiește o bază care are deja date |

## Conturi și autentificare
Fiecare persoană are contul ei: favoritele, setările graficelor și ale calendarului, timeframe-ul semnalelor, fusul orar, conturile de exchange / broker (și, prin ele, de unde vin prețurile ei crypto), propriile chei: AI (Rezumatul și, la alegere, scorul știrilor) și Twelve Data (acțiunile pe 1m – 4h), evenimentele personale și scanner-ul sunt doar ale ei. Știrile, sentimentul comun al zilei (al modelului local), calendarul economic și datele de piață sunt comune.

**Contul tău de admin** există deja și are toate datele de până acum. La prima deschidere **de pe Mac** (http://localhost:4317) îți setezi numele și parola, apoi autentificarea în doi pași (vezi mai jos). Doar adminul vede sursele de știri, cheia de email (Resend), retenția, *Stare sistem* și *Utilizatori*. Cheile AI și Twelve Data sunt ale fiecăruia, inclusiv ale tale (Setări → Ale mele).

**Ceilalți primesc cont doar la cerere:**
1. Din pagina de autentificare, **„Cere un cont”**: numele și emailul, fără parolă. Răspunsul e mereu același („Am primit cererea…”), indiferent dacă adresa are deja cont.
2. Adminul află imediat: un email „Cerere nouă de cont” și un punct (în culoarea accentului) pe inițiala lui, sus în dreapta (în meniu: „Utilizatori · 1 cerere”).
3. În *Utilizatori → Cereri de cont*, adminul apasă **Aprobă** sau **Respinge** (o cerere respinsă dispare fără niciun email; o cerere la care nu răspunde în 30 de zile dispare singură).
4. La aprobare se creează contul (cu favoritele BTC, ETH, SOL), cu starea „Așteaptă activarea”, iar persoana primește pe email **linkul de activare** (valabil 7 zile). Pagina îi arată adminului dacă emailul a plecat și, oricum, linkul, cu **Copiază**.
5. Din link, persoana își alege parola (minimum 12 caractere, cu literă mare, literă mică și cifră) și e deja în cont: urmează direct **autentificarea în doi pași**.

Un link expirat sau pierdut se înlocuiește din *Utilizatori → Link nou de activare* (cel vechi nu mai merge). Linkul folosește adresa publică a aplicației (`SENTIQ_PUBLIC_URL`) când există, altfel adresa din care aprobi: aprobat de pe `localhost`, merge doar pe Mac-ul tău (pagina te avertizează).

> **Emailuri, varianta de dezvoltare.** Emailurile pleacă prin Resend, cu expeditorul de test `onboarding@resend.dev`, care livrează **doar la adresa contului Resend** (a adminului): emailul „cerere nouă” îți ajunge, dar cel cu linkul de activare nu ajunge la ceilalți. Trimite-le tu linkul din pagina de aprobare (nu apare niciodată în jurnal). Când ai un domeniu verificat în Resend, pune expeditorul nou în *Setări → Admin → Email (Resend)* și emailurile ajung la toți.

**Autentificarea în doi pași e obligatorie** pentru toate conturile, inclusiv al adminului. Până nu e configurată, Sentiq arată doar ecranul de configurare (și „Ieși din cont”):
1. instalezi pe telefon o aplicație de autentificare (Google Authenticator, Microsoft Authenticator, 1Password, Authy…);
2. scanezi codul QR (sau scrii cheia de mână); „Am scanat pe alt telefon: cheie nouă” face alt cod QR;
3. scrii codul de 6 cifre din aplicație;
4. primești **10 coduri de recuperare**, afișate o singură dată: copiază-le sau descarcă-le, bifează „Le-am salvat”, apoi **„Intră în Sentiq”**.

Un cont nou ajunge aici imediat după activare. Un cont fără 2FA (de exemplu după o resetare făcută de admin) ajunge aici la următorul login cu parola. Orice configurare sau schimbare a aplicației e anunțată pe email. Dacă nu tu ai făcut-o: pune-ți întâi o parolă nouă din „Am uitat parola” (toate sesiunile se închid), apoi scrie-i adminului să-ți reseteze 2FA și configurează-l la login.

**Intrarea:**
- email și parolă, apoi codul de 6 cifre din aplicația de autentificare (ai 5 minute) sau un cod de recuperare;
- sau **„Intră cu un passkey”** (Touch ID, Face ID, PIN): fără parolă și fără cod. Un passkey merge doar pe adresa pe care l-ai creat: pe `https://sentiq.money` sau pe Mac la `http://localhost:4317`; pe adresa din rețea (`http://192.168…`) browserele nu le permit;
- 3 încercări greșite de pe același dispozitiv blochează intrarea 15 minute;
- rămâi conectat 30 de zile de la ultima folosire.

**Parola uitată:** „Am uitat parola” trimite un link valabil o oră. Parola nouă închide toate sesiunile; autentificarea în doi pași rămâne pornită.

**Securitate** (meniul cu inițiala ta, sus în dreapta):
- numele și parola (schimbarea parolei închide celelalte sesiuni);
- **autentificarea în doi pași** (nu se poate opri):
  - **„Schimbă aplicația de autentificare”**, pentru un telefon nou: cu parola și un cod din aplicația de acum (sau un cod de recuperare), scanezi un cod QR nou și confirmi cu codul din aplicația nouă. Până confirmi, aplicația veche merge; codurile de recuperare rămân;
  - **„Coduri de recuperare noi”**, cu parola și un cod;
- **passkey-uri**: adaugă, redenumește, șterge;
- „Ieși de pe toate dispozitivele”.

**Utilizatori** (doar admin): cererile de cont (Aprobă / Respinge) și lista conturilor, cu „Link nou de activare” (pentru conturile neactivate), „Dezactivează” / „Reactivează”, „Resetează 2FA” (pentru cine și-a pierdut telefonul și codurile: sesiunile contului se închid, iar la următorul login își configurează din nou aplicația) și „Șterge” (cu toate datele contului). Coloana *Securitate* arată „2FA neconfigurat” pentru un cont activat care nu și-a configurat încă aplicația.

## Tema luminoasă / întunecată
Butonul cu **soare** din bara de sus (lângă căutare) trece pe tema luminoasă; cel cu **lună** te întoarce pe cea întunecată. Pe telefon, comutarea e în meniul contului (inițiala, sus în dreapta). Alegerea se ține minte în acest browser (și pentru celelalte taburi deschise); fără alegere, tema e cea întunecată. Pe paginile de login butonul e sus în dreapta.

Tema luminoasă („Navy”): bara de sus și banda cu prețuri rămân bleumarin, pagina e gri-albăstruie, plăcile albe cu chenar, iar accentul e turcoaz (pe tema întunecată rămâne auriul). Pe ambele teme:
- **graficul** stă pe placa lui, cu altă culoare decât pagina (alb pe tema luminoasă);
- **tabelele și listele** (Tranzacții, Economie, Stare sistem, Știri, alertele de pe grafic…) au rândurile alternate; rândul de sub cursor se colorează;
- **butoanele, filtrele, segmentele și meniul** își schimbă clar chenarul, fundalul și textul sub cursor; filtrele apăsate sunt pline (bleumarin pe tema luminoasă).

## Pagini
Meniul e sus. Sub el, **banda de prețuri** arată, pe orice pagină:
- monedele favorite (preț, variația pe 24 h, grafic pe 48 h), acțiunile și indicii favoriți (preț, variația zilei, grafic pe 60 de zile, „închis” când bursa e închisă);
- evenimentul major următor, cu numărătoare;
- Fear & Greed crypto, capitalizarea pieței și dominanța BTC;
- bursa americană (deschisă / pre-market / after-hours / închisă, cu numărătoare până la deschidere sau închidere), S&P 500, Nasdaq 100, VIX și Fear & Greed pentru acțiuni (CNN).

**Căutare rapidă: ⌘K** (Ctrl+K pe Windows/Linux) sau butonul „Caută” din meniu. Scrii o pagină („calendar”), o monedă („sol”, din favorite sau orice pereche de pe exchange), o acțiune („tesla”, „AAPL”) sau un subiect, apoi alegi „Caută în știri”. Navighezi cu ↑/↓, deschizi cu Enter, închizi cu Esc. Nu contează diacriticele („stiri” găsește „Știri”).

**Panouri și ferestre:** cât e deschisă o fereastră (Ordin nou, Indicatori, căutarea ⌘K, Rezumatul zilei, adăugarea unui cont) sau panoul de setări al unui indicator, pagina din spate nu se mai derulează: derulezi doar în ce ai deschis, iar la închidere pagina e unde era. Lângă panoul de setări, rotița pe grafic face în continuare zoom.

- **Azi**: un cockpit; plăcile de sus încap pe un ecran la 1440 × 900. Cuprinde, în ordine:
  - în stânga, sentimentul zilei (0–100) cu spectrul, variația față de acum o oră, ziua pe ore și sub-indicii crypto / acțiuni / macro / geopolitică;
  - în dreapta, unul sub altul, pe toată înălțimea sentimentului: evenimentul major următor (inclusiv rezultatele companiilor favorite), cu numărătoare și cu evenimentele de azi, și știrile live;
  - ce mișcă piața („Arată toate” pentru toate știrile-motor) și ultimele 30 de zile, alăturate;
  - dedesubt, pe toată lățimea, favoritele tale (preț, variație, grafic, trend, ultimul semnal Slingshot, TP/SL active, structura). Deasupra lor, „Semnale Slingshot pe” 15m · 1h · 4h · 1d alege timeframe-ul semnalelor. Săgeata de lângă simbol arată trendul Slingshot: în sus, verde (uptrend), sau în jos, roșie (downtrend).

  Pe telefon (sub 768 px), plăcile se așază una sub alta, în aceeași ordine.

  **Rezumat** (butonul din stânga căutării, doar pe Azi): o fereastră mare în care AI-ul tău (Claude, ChatGPT sau Gemini, cu cheia ta) rezumă ziua **de până acum** și spune dacă e o **zi bună de trading**, **mixtă** sau **slabă** (cu cât de sigur e). Dedesubt: câteva secțiuni scurte (sentiment, macro și indicatori, crypto, acțiuni), **Oportunități**, **Riscuri**, **Ce urmează** în următoarele 24 de ore (cu ora) și până la 4 grafice alese după situație: sentimentul pe ore sau pe ultimele zile, sentimentul pe categorii, istoricul indicatorilor economici publicați azi (cu prognoza ca cerc gol și punctul final verde / roșu, ca pe pagina Economie) și variația favoritelor pe 24 h. Cifrele graficelor sunt ale aplicației, nu ale AI-ului. La prima deschidere din zi rezumatul se face singur (20–60 de secunde); după aceea vezi ultimul rezumat de azi, iar **Actualizează** face unul nou cu datele de acum (cel mult o dată la 2 minute). Se închide cu ×, Esc sau click în afara ei. AI-ul primește doar datele aplicației despre azi (sentimentul, titlurile știrilor, calendarul, indicatorii, contextul pieței, favoritele tale), niciodată chei, conturi sau portofolii. Folosește cheia și modelul tău din Setări → Ale mele → Inteligență artificială; fără cheie, fereastra te trimite acolo. Tokenii fiecărui rezumat se adună tot acolo, la „Ce a consumat cheia ta azi”, iar prețul îl arată consola furnizorului. Nu este un sfat de investiții.
- **Știri**: toate știrile, cu sentiment per știre („De ce acest scor?” arată motorul, scorul modelului, regulile aplicate și importanța cu care știrea intră în sentimentul zilei, cu sursa în paranteză: „importanță 2 (Claude)” când AI-ul tău a notat-o, „importanță 3 (cuvinte-cheie)” după cuvintele din titlu; când AI-ul și cuvintele-cheie dau valori diferite le vezi pe amândouă, iar prima e cea care contează). Filtrele sunt într-o bară deasupra listei: interval, categorie (Crypto, Acțiuni, Macro, Geopolitică), sentiment, sursă, favoritele tale, căutare. Filtrele schimbă doar lista, nu și sentimentul zilei.
- **Calendar**: săptămâna pe coloane, câte o zi pe coloană (pe ecrane mici, o zi sub alta). Click pe o fișă arată explicația evenimentului și abaterea față de așteptări. Are filtre de impact și valută, cipul **„Rezultate companii”** (rezultatele trimestriale ale acțiunilor favorite, cu EPS estimat și EPS-ul de anul trecut) și evenimente personale (se șterg din fișa lor).
- **Știrile despre acțiuni pe indici** (Setări → „Știrile despre acțiuni”): „Toate acțiunile” (implicit) sau „Doar companiile din indicii aleși”: S&P 500 (SPY, VOO), Nasdaq-100 (QQQ), Dow Jones (DIA), unul sau mai mulți. Cu indici aleși, pagina Știri, Azi și Rezumatul zilei arată doar știrile despre companiile din ei, iar partea de acțiuni a scorului tău se calculează doar din ele. Rămân știrile generale de bursă, acțiunile din favoritele tale și știrile crypto, macro și de geopolitică. Listele de companii se actualizează săptămânal (Nasdaq, Wikipedia); o companie se recunoaște după nume, după „$TICKER”, după „(NYSE: TICKER)” sau după ticker; numele care sunt cuvinte obișnuite („Target”, „Visa”) doar după ticker sau numele complet. După o schimbare, scorul tău se recalculează în câteva minute pentru zilele de care Sentiq mai are știrile.
- **Economie**: nivelul curent al indicatorilor economici, pe țări: SUA, zona euro (UE), Marea Britanie, Japonia, China, Canada, Elveția, Australia, Noua Zeelandă. Pentru fiecare: ultima valoare și perioada ei, valoarea anterioară (revizuită) și schimbarea, istoricul pe ~13 luni, **data și ora următoarei publicări** (cu prognoza, când există) și sursa oficială. Sus sunt „Esențialele” fiecărei țări (inflație, șomaj, PIB, dobândă, cereri de șomaj, NFP…), dedesubt toți indicatorii pe grupe (prețuri, muncă, PIB, industrie, consum, locuințe, bani și dobânzi, comerț, buget, energie, obligațiuni). Un click pe rând arată explicația și ce s-a publicat față de prognoză. **Culorile:** verde = schimbare bună pentru economie, roșu = rea (inflația sau șomajul în creștere sunt roșii, PIB-ul sau locurile de muncă în creștere sunt verzi, dobânzile și randamentele în creștere sunt roșii); fără culoare = indicator neutru (salarii, stocuri, prețul locuințelor) sau fără schimbare; săgeata ▲ / ▼ arată direcția, iar punctul de la capătul istoricului are culoarea ultimei schimbări. Pentru zona euro apar și indicatorii Germaniei, Franței, Italiei și Spaniei care nu există la nivelul zonei euro (ex. Ifo). Sus, cipurile țărilor sunt **filtre**: un click pe o țară arată doar indicatorii ei, alt click pe ea (sau „Toate”) le arată din nou pe toate; numărul de pe cip spune câți indicatori are țara, iar filtrul rămâne în adresa paginii. Căutare și „Doar importante”. Datele vin din același calendar economic ca pagina Calendar; valorile noi apar la câteva minute după publicare, iar la prima pornire istoricul se încarcă în câteva minute.
- **Grafice**: lumânări cu **[DE] Slingshot System 3.3** (pe grafic, „[DE] Slingshot 3.3”: nor EMA, LONG, TAKE PROFIT, TP/SL, Market Structure) și, în panoul de jos, **[DE] Logarithmic Moving Average** („[DE] LMA”: linia de semnal, pragurile, starea BULLISH / BEARISH / NEUTRAL). DE vine de la Dusty Enterprise. Mai sunt istoricul semnalelor și al alertelor. Opțional, pozițiile și ordinele tale apar ca linii pe grafic, cu PnL la SL, TP și la prețul curent.
  - Merge pentru perechi crypto (`/charts/BTC/USDT`), acțiuni americane (`/charts/s/AAPL`) și indici americani (`/charts/i/SPX`). Câmpul de căutare de lângă favorite le găsește pe toate.
  - **Prețurile crypto vin de la exchange-ul tău** conectat (KuCoin, Binance, Bybit, OKX sau Bitget; numele lui apare lângă preț), ca liniile pozițiilor tale să fie pe prețurile de acolo. Fără unul dintre ele (sau cu Kraken / Coinbase, care nu au perechile și istoricul necesare), prețurile vin de la exchange-ul ales de admin; la fel, o monedă pe care exchange-ul tău n-o are. Un timeframe pe care exchange-ul nu-l are (8h pe Bybit / OKX / Bitget) apare dezactivat.
  - **„Indicatori”** deschide lista: cei 117 indicatori standard din TradingView (RSI, MACD, Bollinger, Ichimoku, Supertrend, VWAP, Pivot Points…) plus Volume, cu căutare și pe categorii (Medii mobile, Oscilatori, Momentum, Trend, Volatilitate, Canale și benzi, Volum). Sus, la **Premium**, sunt Slingshot și LMA, cu eticheta PREMIUM (deocamdată gratuite). Un click adaugă indicatorul; poți adăuga același indicator de mai multe ori (ex. EMA 20 și EMA 50), cel mult 20. Un indicator scos și adăugat din nou vine cu **ultimele tale setări** (intrări, stil, înălțimea panoului); „Valorile implicite” + „Salvează” îl readuce la valorile TradingView. **Steaua** din dreapta unui rând îl pune la **Favorite**, prima categorie; cu cel puțin un favorit, lista se deschide direct acolo. Toate listele ferestrei (Favorite, Premium, Toți, fiecare categorie și căutarea) sunt în ordine alfabetică. Pentru mai multe medii mobile într-un singur indicator: **Moving Average Ribbon** (4 linii, fiecare cu tipul ei — SMA, EMA, SMMA, WMA, VWMA —, perioada, sursa și culoarea).
  - Cei „pe grafic” (medii, benzi, Ichimoku…) se desenează peste lumânări; ceilalți au fiecare panoul lor dedesubt, iar graficul crește cu 120 px pentru fiecare panou. Separatorul dintre panouri se trage, iar înălțimea se ține minte.
  - Fiecare indicator are o **legendă** sus-stânga: numele și parametrii, apoi **ochi** (ascunde / arată), **rotiță** (setări) și **×** (scoate), apoi valorile la lumânarea de sub cursor. Butoanele stau lângă nume, așa că nu se mută când valorile se schimbă cu cursorul. Ochiul există și la Slingshot și LMA: ascunși, nu se mai desenează (nici culorile lumânărilor de la LMA), dar rămân pe grafic, cu legenda estompată. Setările au tab-urile **Intrări** (aceleași câmpuri, valori implicite și limite ca în TradingView) și **Stil**: pentru fiecare linie, vizibilitatea, culoarea, **tipul** (continuă, liniuțe, puncte) și **grosimea** (implicită, groasă, foarte groasă); la fel pentru liniile orizontale (ex. 70 / 30 la RSI), care au în plus **nivelul** lor (ex. 80 / 50 / 20 la Stochastic RSI), cu umplerea dintre ele. Setările Slingshot și LMA se deschid tot din rotița legendei.
  - Câțiva indicatori citesc alte date: Pivot Points Standard sau Technical Ratings cer același simbol pe un timeframe mai mare, pe care Sentiq îl descarcă (altfel le calculează din lumânările graficului, cu nota „aproximat”). Performance și Correlation Coefficient cer alte simboluri: merg perechi crypto și acțiuni americane, nu forex sau futures (legenda spune ce lipsește; schimbi simbolurile din setări). Indicatorii de volum nu au valori pe indici (fără volum).
  - „Color Price Bars” (implicit activ, ca în TradingView) colorează lumânările după LMA; îl poți opri din setările LMA.
  - Graficul nu are grilă și nici linii sub cursor; prețul și ora apar pe axe.
  - Când derulezi în istoric și ultima lumânare iese din ecran, în colțul din dreapta jos al panoului cu lumânări (deasupra panourilor LMA și ale indicatorilor) apare butonul **»** („Mergi la ultima lumânare”): un click te readuce la prezent, cu același zoom.
  - Slingshot și LMA se adaugă din lista Indicatori și se scot cu × din legenda lor; fără ei, graficul are doar lumânările (și ce indicatori ai adăugat). Panourile „Semnale” și „Alerte” de sub grafic rămân.
  - **Favoritele de deasupra graficului se pot reordona:** le tragi cu mouse-ul (pe ecran tactil: ții apăsat, apoi tragi) sau, cu tastatura, Alt + ← / → pe un favorit. Ordinea e aceeași peste tot (bandă, Azi, Setări). Un click simplu deschide graficul, ca înainte.
  - Aplicația ține minte perechea sau acțiunea, timeframe-ul, „Pozițiile mele”, indicatorii de pe grafic (aceiași pe toate graficele), înălțimea fiecărui panou și setările indicatorilor. „Grafice” din meniu redeschide ultimul grafic. Zoom-ul fiecărui grafic și al fiecărui timeframe e ținut minte în browser.
  - **Ecran complet**: butonul din bara graficului. Ieși cu „Ieși din ecran complet” sau cu **Esc**; dacă sertarul de setări e deschis, primul Esc îl închide.
  - Când treci de la un simbol la altul, prețul și variația rămân pe loc, gri cu „—”, până sosesc datele noului simbol: bara cu intervalele și butoanele nu mai sare de pe un rând pe altul.
  - **Cursorul** are linii punctate, verticală și orizontală, cu prețul și ora pe axe.
  - **Linii orizontale:**
    - **adăugare:** cu cursorul pe panoul lumânărilor, la capătul liniei lui orizontale apare **+**; un click pe el și „Linie orizontală la …” adaugă linia la acel preț. Mai repede: **Alt+H** (pe Mac ⌥H);
    - **mutare:** trage linia în sus sau în jos (cursorul devine o săgeată sus-jos);
    - **setări:** un click pe linie deschide panoul ei, cu tot ce are TradingView, într-un singur loc:
      - linia: culoarea, grosimea, tipul, eticheta prețului;
      - textul: culoarea, mărimea, îngroșat, cursiv, rândurile lui, alinierea sus / mijloc / jos și stânga / centru / dreapta;
      - prețul;
      - vizibilitatea pe minute, ore, zile și săptămâni;
      - șablonul: stilul cu care încep liniile noi;
    - **previzualizare:** ce schimbi se vede pe loc; „Salvează” păstrează, „Anulează” (sau Esc) pune la loc, „Șterge linia” o scoate;
    - **unde apar:** liniile sunt ale simbolului pe care le-ai desenat, pe toate intervalele, cel mult 50 pe simbol, și se văd pe orice dispozitiv;
    - **pe telefon:** atingerea unei linii deschide panoul; o muți din câmpul de preț.
- **Tranzacții**: pentru fiecare cont, cu logo-ul lui: poziții, dețineri cu preț mediu și PnL, numerar (la brokeri), ordine deschise și tranzacțiile recente. „Reîmprospătează” e sus, lângă „Adaugă un cont”.
  - La un exchange crypto, sus sunt 7 carduri. **Disponibil în futures**: suma liberă din contul futures (USDT). **Valoare în contul spot**: tot ce ai în conturile spot (la KuCoin: Trading și Funding), monedele la prețul de acum plus stablecoins, fără contul futures. **PnL nerealizat**: pozițiile futures încă deschise.
  - Apoi **Tranzacții profitabile**, **Tranzacții cu pierdere**, **Rata de succes** (profitabile din profitabile + cu pierdere) și **Câștig net**, toate pentru pozițiile futures închise în perioada aleasă sus, lângă butoane: Azi · 7z · 30z · 90z. Rezultatul fiecărei poziții e cel net, după comisioane și funding, cum îl dă exchange-ul. Merge la KuCoin, Bybit, OKX și Bitget; Binance nu dă istoricul pozițiilor închise prin API.
  - La un broker, cardurile sunt **Valoare dețineri**, **Numerar disponibil**, **PnL nerealizat** (doar cu poziții cu levier sau short), apoi aceleași patru pentru tranzacțiile închise în perioada aleasă, cu câștigul net în moneda contului. Ce e o tranzacție închisă:
    - **eToro:** o poziție închisă (o închidere parțială e separată), cu profitul net dat de eToro;
    - **Trading 212:** o vânzare executată, cu profitul realizat dat de Trading 212;
    - **Interactive Brokers:** un ordin care închide o poziție, cu Realized P/L din raportul Flex (cu comisioane). Raportul are doar zilele încheiate, deci „Azi” arată „—”; la Flex Query, secțiunea Trades trebuie să aibă nivelul „Execution” și toate câmpurile;
    - **Alpaca:** un ordin care închide o poziție. Alpaca nu dă rezultatul, așa că Sentiq îl calculează din execuții (primele cumpărate, primele vândute). O vânzare fără cumpărarea ei în istoric (acțiuni transferate, split) nu se numără, iar cardul spune câte sunt.
- **Setări → Ale mele**: favorite (monede, acțiuni și indici; ordinea se schimbă trăgând de mânerul ⋮⋮, cu săgețile sau cu Alt + ↑ / ↓), conturi (exchange-uri și brokeri; cu două sau mai multe exchange-uri, alegi de la care vin prețurile crypto), datele pentru acțiuni (cheia Twelve Data, planul și consumul ei; vezi „Acțiuni”), inteligența artificială (cheia, modelul, scorul știrilor; vezi „AI în Sentiq”), fus orar. Fiecare le are pe ale lui. Timeframe-ul graficului se alege pe Grafice, iar cel al semnalelor pe Azi.
- **Setări → Admin** (fila apare doar pentru admin; ⌘K „Setări admin”): ce se aplică tuturor: sursele de știri, sentimentul comun (modelul local: rescorare, recalcularea istoricului), datele de piață (exchange-ul implicit pentru prețurile crypto, istoricul încărcat pe grafice), păstrarea știrilor și emailul (Resend).
- **Stare sistem** (doar admin): sănătatea surselor, a job-urilor și a modelului, câți utilizatori au scorul pe AI-ul propriu și câți au cheie Twelve Data.

## Acțiuni
1. **Favorite**: Setări → Favorite → **Acțiuni**, apoi caută după simbol sau nume („Apple”, „MSFT”). Numele companiei devine alias pentru știri (îl poți edita).
2. **Ce primești** pentru fiecare acțiune favorită: prețul în bandă și în Azi, graficul cu Slingshot și LMA, știrile ei (Nasdaq adaugă automat un feed pentru ea, marcat „automată” în Setări → Admin → Surse; feed-ul se șterge, cu știrile lui, când acțiunea nu mai e în favoritele nimănui), rezultatele trimestriale în calendar și rândul ei în scanner.
3. **Graficele fără cheie** au lumânări zilnice și săptămânale (Nasdaq, gratuit). Pentru 1m – 4h, fiecare își pune **propria cheie Twelve Data** (gratuită):
   - înregistrare pe https://twelvedata.com/register, apoi pagina **API Keys**;
   - Setări → Ale mele → Date pentru acțiuni → „Cheia Twelve Data” → „Verifică și salvează” (verificarea costă o cerere a cheii).

   Cheia, planul și creditele ei sunt doar ale tale: graficele, căutarea și semnalele acțiunilor de pe Azi le folosesc doar pentru tine; cine nu are cheie vede acțiunile pe 1d și 1w. Planul gratuit are 800 de cereri pe zi și 8 pe minut; un plan plătit (de ex. Grow: 55 pe minut, fără limită zilnică) se recunoaște singur din cheie, iar același panou arată planul citit și consumul de azi („Recitește planul” după un upgrade). O cheie nouă începe ziua doar cu cele două cereri ale ei (verificarea și citirea planului). Dacă doi oameni folosesc aceeași cheie, Twelve Data o numără o singură dată, deci limita se atinge mai repede. Până pe 16 oct 2026 cheia era una, a adminului, pentru toți; a rămas cheia adminului. Aplicația ține minte lumânările și nu mai cere altele cât bursa nu e în ședința regulată (noaptea, în pre-market și after-hours, în weekend); dacă limita e atinsă, graficul arată ultimele lumânări și ora la care revine. Twelve Data nu are 3m, 6h, 8h, 12h: graficul arată atunci timeframe-ul cel mai apropiat.
4. Datele sunt pentru bursele americane (NASDAQ, NYSE), cu câteva minute întârziere la preț.

## Indici
1. **Favorite**: Setări → Favorite → **Indici**. Lista apare direct sub câmp; un click adaugă indicele. Câmpul o filtrează („spx”, „dow”, „nasdaq”).
2. Indicii disponibili: **SPX** (S&P 500), **NDX** (Nasdaq-100), **COMP** (Nasdaq Composite), **DJI** (Dow Jones), **RUT** (Russell 2000), **VIX** (volatilitatea S&P 500), **SOX** (semiconductori).
3. **Ce primești**: ca la acțiuni, prețul în bandă și în Azi, graficul cu Slingshot și LMA, filtrul de știri (după aliasuri: „S&P 500”, „Dow Jones”…, editabile) și rândul în scanner. Fără feed de știri propriu și fără rezultate în calendar.
4. **Timeframe-uri**: 1m – 4h și 1d / 1w, cu prețul în timp real. Nu există 6h, 8h și 12h, fiindcă ședința are 6 ore și jumătate.
5. **Limite**:
   - istoricul intraday e de cam 100 de zile: ~500 de lumânări pe 1h, ~140 pe 4h; zilnicul merge înapoi până în 2010;
   - dacă sursa principală nu răspunde, zilnicul și prețul vin dintr-o rezervă, cu până la 15 minute întârziere (se spune la trecerea cursorului peste preț), iar graficele intraday arată ultimele lumânări primite;
   - doar indici americani: DAX, FTSE, Nikkei și futures (ES, NQ) nu au o sursă gratuită. Pentru ei poți folosi un ETF la „Acțiuni” (ex. EWG pentru Germania, EWJ pentru Japonia).

## Conturi: exchange-uri și brokeri
Setări → Conturi → **„Adaugă un cont”** (sau butonul din pagina Tranzacții) deschide un ghid în doi pași:
1. alegi exchange-ul sau brokerul (după nume sau logo; filtrul separă crypto de acțiuni);
2. urmezi pașii afișați pentru crearea cheii (cu linkul direct spre pagina furnizorului) și completezi exact câmpurile cerute de acel furnizor.

La „Conectează”, aplicația testează conexiunea și salvează cheile criptat doar dacă testul reușește.

Implicit Sentiq **doar citește**: solduri, poziții, ordine și tranzacții. Cheia trebuie să poată citi; ca să trimiți ordine din Sentiq, trebuie să poată și tranzacționa (vezi „Tranzacționare din Sentiq”, mai jos). **Niciodată** retrageri sau transferuri: Sentiq refuză cheile care le permit. Dacă nu tranzacționezi din Sentiq, ajunge o cheie doar pentru citire.

| Furnizor | Ce ceri la creare (citire) | În plus, ca să tranzacționezi din Sentiq | Ce completezi |
|---|---|---|---|
| KuCoin | „General” | „Spot” și / sau „Futures” | API Key, Secret, Passphrase |
| Binance | „Enable Reading” | „Enable Spot & Margin Trading” și / sau „Enable Futures”, cu restricția pe IP | API Key, Secret Key |
| Bybit | „Read-Only” | „Read-Write”, cu Spot → Trade și / sau Contracts → Orders, Positions | API Key, API Secret |
| OKX | „Read” | „Trade” | API Key, Secret Key, Passphrase |
| Kraken | „Query Funds”, „Query Open Orders & Trades”, „Query Closed Orders & Trades” | „Create & Modify Orders”, „Cancel & Close Orders” | API Key, Private Key |
| Coinbase | o cheie CDP „View” (ECDSA) | „Trade” | numele cheii (`organizations/…/apiKeys/…`) și cheia privată |
| Bitget | „Read-only” | „Read-write”, cu „Trade” | API Key, Secret Key, Passphrase |
| Trading 212 | cheie API cu permisiunile de citire (cont Invest sau ISA) | „Orders: Execute” (la crearea cheii) | API Key, API Secret, Live / Practice |
| eToro | cheie API „Read” | „Write” (la crearea cheii) | Public API Key, User Key, Real / Demo |
| Interactive Brokers | Flex Web Service + un Activity Flex Query (XML) cu Open Positions, Trades și Cash Report | — (IBKR nu primește ordine prin Flex) | Token Flex, Query ID |
| Alpaca | cheile contului | nimic (cheile pot tranzacționa întotdeauna) | API Key ID, Secret Key, Live / Paper |

**Restricționează fiecare cheie la IP-urile serverului Sentiq.** Cererile către exchange-uri și brokeri pleacă de pe serverul Sentiq (sentiq.money), nu de pe calculatorul tău. O cheie limitată la aceste adrese nu poate fi folosită de altcineva, chiar dacă ajunge la el. Wizard-ul arată lista, cu buton de copiere:

`68.210.130.64,68.210.130.28,68.210.129.102,68.210.131.71,68.210.130.70,68.210.130.73,68.210.131.64,68.210.130.36,68.210.130.38,68.210.131.80,68.210.131.82,68.210.130.44,68.210.171.1`

- **Unde se pune:** KuCoin, Binance (obligatoriu pentru tranzacționare), Bybit, OKX, Kraken, Coinbase, Bitget, Trading 212 și eToro au câmpul pentru IP-uri la crearea cheii. Alpaca și Interactive Brokers nu sunt în listă.
- **Pe Mac:** Sentiq pornit pe calculatorul tău trimite cererile de pe conexiunea ta, deci o cheie limitată la aceste adrese merge doar din sentiq.money.

Lista are doar platformele care se pot conecta. XTB, Tradeville, Revolut (acțiuni) și Degiro nu au (sau nu mai au) un API pentru clienți, deci nu apar.

Cheile sunt criptate (AES-256-GCM) cu `data/master.key`. **Nu șterge, nu redenumi și nu partaja `data/master.key`**: fără ea cheile salvate nu mai pot fi citite (le reintroduci).

> Notă: integrările au fost testate cu răspunsurile documentate de fiecare furnizor, nu cu conturi reale. La prima conectare cu cheia ta, verifică pagina Tranzacții; dacă o secțiune afișează o eroare, mesajul spune cauza, iar „Stare sistem” și log-ul din `data/logs/` arată detaliile.

**Interactive Brokers** dă datele printr-un raport Flex, nu în timp real: pozițiile sunt cele de la ultima închidere. Tokenul Flex expiră implicit după 6 ore; la generare alege o expirare mai lungă.

## Tranzacționare din Sentiq
Pe orice cont, în afară de Interactive Brokers, poți trimite ordine direct din Sentiq: spot pe toate exchange-urile crypto, futures perpetue USDT pe KuCoin, Binance, Bybit, OKX și Bitget, acțiuni la Trading 212, eToro și Alpaca. **Sentiq nu face niciodată retrageri sau transferuri.**

**Pornirea, pe fiecare cont:**
1. Cheia trebuie să poată tranzacționa, dar **nu și retrage sau transfera** (pașii apar în expert, la „Pentru tranzacționare din Sentiq”, și în fereastra de pornire):

| Platformă | Ce bifezi în plus la cheie |
|---|---|
| KuCoin | „Spot” și / sau „Futures” (pe lângă „General”) |
| Binance | „Enable Spot & Margin Trading” și / sau „Enable Futures” (Binance cere și restricția pe IP) |
| Bybit | „Read-Write”: Spot → Trade și / sau Contracts → Orders, Positions |
| OKX | „Trade” |
| Kraken | „Create & Modify Orders”, „Cancel & Close Orders” |
| Coinbase | „Trade” (fără „Transfer”) |
| Bitget | „Read-write” cu „Trade” |
| Trading 212 | o cheie nouă cu „Orders: Execute” (se adaugă ca un cont nou) |
| eToro | o cheie nouă cu „Write” (se adaugă ca un cont nou) |
| Alpaca | nimic: cheile pot tranzacționa întotdeauna |

2. În Tranzacții, la cont: **„Pornește tranzacționarea”**. Sentiq recitește întâi permisiunile cheii, unde exchange-ul le spune (deci o cheie schimbată pe platformă, ex. cu Spot și Futures adăugate, se vede imediat):
   - pornește doar pentru ce poate cheia (doar spot, de exemplu);
   - refuză o cheie fără tranzacționare;
   - refuză orice cheie care poate retrage sau transfera fonduri.

   Apoi confirmi că ești tu:
   - cu **passkey-ul** („Confirmă cu passkey”), dacă ai unul pe acest browser;
   - sau cu **parola ta Sentiq** (cea de la login, nu parola sau passphrase-ul exchange-ului) și **codul 2FA Sentiq** (din aplicația de autentificare, nu codul exchange-ului).

   Mesajul spune ce e greșit (parola sau codul) și câte încercări mai ai. După 3 greșite urmează o pauză de 15 minute, dar passkey-ul merge și atunci.
3. **„Oprește tranzacționarea”** o oprește imediat, fără parolă. Ordinele deja plasate rămân pe platformă.

**Ordinele:**
- **„Ordin nou”** (Tranzacții), **„Tranzacționează”** (pe grafic, cu perechea graficului), **„Vinde”** (la o deținere) și **„Închide”** (la o poziție) deschid același formular.
- **„Vinde” / „Închide” la eToro** arată pozițiile într-un tabel: data deschiderii, unitățile, prețul de intrare, suma investită, profitul / pierderea (USD și %), un câmp „De vândut” (gol = toată poziția) și butonul **Vinde** pe fiecare rând. Fiecare vânzare are confirmarea ei (cu poziția și profitul); după rezultat, „Înapoi la poziții” te lasă să vinzi și alta. În formularele de închidere, contul, simbolul, piața și direcția apar ca text.
- **Formularul ține minte alegerile** pentru fiecare cont (piață, direcție, tip, unitatea cantității, levier, marjă, valabilitate, reduce-only, în afara orelor), chiar dacă închizi fără să trimiți: la ordinul următor schimbi doar cantitatea. Simbolul, cantitatea și prețurile nu se țin minte, iar „Închide” o poziție nu schimbă alegerile. „Tranzacționează” de pe grafic deschide contul folosit ultima dată.
- **Formularul:**
  - piața;
  - perechea;
  - direcția;
  - tipul: la piață, limită, stop sau stop-limită; la eToro, la piață, „market-if-touched” sau limită imediată;
  - cantitatea în activ sau ca valoare, cu 25 / 50 / 100% din disponibil;
  - la futures: levierul, marja, reduce-only, TP / SL.
- **„Verifică ordinul”:** Sentiq rotunjește la pașii pieței și verifică minimele, direcția stop-ului și soldul.
- **Fereastra de confirmare** arată exact ce pleacă: cantitatea rotunjită (și în contracte la futures), prețurile, valoarea, marja, plus avertismentele.
- Ordinul pleacă doar la **„Confirmă și trimite”**. Un dublu click sau o reîncercare a aceluiași formular nu face două ordine.
- **„Anulează”** pe un ordin deschis.
- **Jurnalul „Ordinele trimise din Sentiq”** apare în josul paginii contului: ordinele, anulările, pornirile și opririle, cu rezultatul fiecăruia.

**De știut:**
- Cel mult 20 de acțiuni de tranzacționare pe minut.
- Dacă nu vine niciun răspuns după trimitere, Sentiq spune că nu știe sigur dacă ordinul a ajuns și nu-l retrimite singur: verifică ordinele deschise.
- Futures doar în modul **one-way**: un cont în modul hedge e refuzat, cu explicația.
- Pe Bybit, marja (cross / isolated) e a contului: Sentiq nu o schimbă.
- Pe Binance, TP / SL se trimit ca ordine separate, după o intrare la piață.
- Pe KuCoin, futures se tranzacționează în loturi întregi (un lot BTC = 0,001 BTC); pe un cont unificat (UTA), doar cu marjă cross.
- Pe un cont unificat Bitget (UTA): futures doar cu marjă cross, iar ordinele stop se pun din aplicația Bitget.
- La Alpaca, ordinele fracționate sau pe sumă sunt valabile doar o zi.
- Trading 212 vinde doar ce deții, în moneda contului; API-ul lor e în beta.
- La eToro, „Vinde” pe o deținere îi închide pozițiile, iar „Short” deschide o poziție short (levierul peste 1× și short-ul cer stop loss).
- Soldul „main” al unui cont KuCoin clasic nu se vinde din Sentiq: mută-l întâi în contul de trading, pe KuCoin.
- **Integrările au fost verificate pe cererile documentate de fiecare platformă, nu cu conturi reale.** Începe pe Demo / Paper, unde există (Trading 212 Practice, eToro Demo, Alpaca Paper), sau cu sume mici.

## AI în Sentiq: cheia fiecăruia
Fiecare utilizator își pune **propria cheie API** în Setări → Ale mele → Inteligență artificială, la unul dintre furnizori:
- **Anthropic** (Claude): cheia se face la console.anthropic.com → API keys;
- **OpenAI** (ChatGPT): platform.openai.com → API keys;
- **Google** (Gemini): aistudio.google.com → Get API key. Are un nivel gratuit, cu limite mici; pe el, Google poate folosi datele trimise ca să-și îmbunătățească produsele.

Cheia API se plătește **separat** de abonamentele Claude (Pro, Max), ChatGPT (Plus, Pro) sau Gemini: credite preplătite sau facturare la furnizor, după consum. Sentiq nu poate folosi abonamentul cuiva. La salvare, cheia e verificată la furnizor (cererea pentru lista de modele, gratuită): una refuzată nu se salvează; dacă furnizorul nu răspunde atunci, cheia se salvează cu un avertisment. Cheile se păstrează criptat, câte una pe furnizor; doar tu vezi primele și ultimele 4 caractere ale lor, nici măcar adminul.

Cu cheia, alegi:
- **modelul**: lista e cea a cheii tale (modelele pe care le poate folosi), cu cele recomandate primele; fără cheie, lista Sentiq;
- **scorul știrilor**: **Model local** (implicit, gratuit, scorul comun) sau **AI-ul tău**. Cu AI-ul tău, titlurile știrilor din ultimele 48 de ore se trimit la furnizor în loturi de 25 (de obicei câteva sute pe zi), iar scorul și importanța lui (1 minoră, 2 notabilă, 3 mișcă piața) intră în sentimentul zilei **doar pentru tine**: pe Azi, în Știri și în Rezumat. Ceilalți văd în continuare scorul comun. Ce AI-ul nu a scorat încă (sau n-a vrut să scoreze) rămâne cu scorul local. Istoricul tău zilnic începe din ziua în care AI-ul tău a scorat prima știre; zilele dinainte sunt cele comune. „Scorează din nou ultimele 48 h” refolosește AI-ul (de exemplu, după ce schimbi modelul).

**Rezumatul** de pe Azi folosește mereu AI-ul și cheia ta, cu modelul ales; fără cheie nu e disponibil. Știrile geopolitice legate de piețe cântăresc 0,8 față de cele crypto (1), oricare ar fi motorul.

Dacă furnizorul refuză cheia sau modelul, scorul revine la cel local până schimbi cheia sau modelul; la alte erori (furnizor supraîncărcat, limită de cereri) se reîncearcă după 5 minute, iar la un cont fără credit după 30. Mesajul apare în panou. Sub el, „Ce a consumat cheia ta azi” arată (ziua UTC) titlurile trimise, apelurile, tokenii și modelul, separat pentru scor și pentru Rezumat; prețul în dolari îl arată consola furnizorului.

**De la cheia comună la cheile fiecăruia (16 oct 2026).** Cheia Claude a adminului, folosită până atunci de toți, a devenit cheia personală a adminului, cu modelul și motorul alese până atunci (dacă motorul era Claude, scorul știrilor rămâne pe Claude, doar pentru admin). Scorurile Claude de până atunci sunt ale adminului; știrile din ultimele 4 zile au fost scorate din nou de modelul local, pentru ceilalți. Ceilalți utilizatori își pun cheia lor pentru Rezumat. Connectorul MCP a fost scos pe 14 oct 2026.

## Backup
Baza de date o salvează Azure, automat (pe nivelurile Basic / Standard poți restaura orice moment din ultimele 7 zile, din portal → baza → *Restore*). Ce trebuie păstrat de tine e **`data/master.key`**, într-un loc sigur: fără ea, cheile de exchange și ale aplicației din bază nu mai pot fi citite. `data/database.env` se poate reface oricând din portal.

## Probleme frecvente
| Simptom | Cauză / soluție |
|---|---|
| Nu primești emailul cu linkul de activare | în varianta de dezvoltare emailurile ajung doar la admin: adminul îți trimite linkul (din *Utilizatori*, după aprobare, sau cu „Link nou de activare”) |
| „Pagina nu a putut fi afișată — Codul paginii nu s-a putut încărca” | aplicația tocmai s-a actualizat sau serverul repornește: pagina se reîncarcă singură când serverul răspunde; dacă nu, apasă „Reîncarcă pagina” |
| „Prea multe încercări” la login | așteaptă 15 minute sau intră cu un passkey |
| „Parola nu e corectă” / „Codul 2FA nu e corect” la pornirea tranzacționării | e parola cu care intri în Sentiq și codul Sentiq din aplicația de autentificare, nu cele ale exchange-ului; un cod folosit deja (ex. la login) nu merge a doua oară: așteaptă codul următor; sau confirmă cu passkey-ul |
| Codul din aplicație e „greșit” | pune ora telefonului pe automat; sau folosește un cod de recuperare |
| „Contul e în modul hedge” la un ordin futures | Sentiq trimite ordine futures doar în modul one-way: schimbă modul din setările exchange-ului (fără poziții deschise) |
| „Cheia nu are permisiunea de tranzacționare” | adaugă permisiunea pe platformă (vezi tabelul de la „Tranzacționare din Sentiq”); la Trading 212 și eToro, fă o cheie nouă și adaug-o ca un cont nou |
| Ai pierdut telefonul, dar ai codurile de recuperare | intră cu un cod de recuperare, apoi *Securitate → Schimbă aplicația de autentificare* (cu parola și alt cod de recuperare) |
| Ai pierdut telefonul și codurile de recuperare | adminul îți resetează 2FA din *Utilizatori*; la login îl configurezi din nou; adminul însuși: `scripts/sentiq.sh admin-reset` |
| După login vezi doar „Autentificarea în doi pași” | contul nu are încă 2FA: configurează-l (e obligatoriu); până atunci nu se deschide nimic altceva |
| Passkey-ul nu apare pe telefon / alt calculator | un passkey merge doar pe adresa pe care l-ai creat: fă-ți unul pe https://sentiq.money (Securitate) |
| Din rețea: „Sentiq răspunde doar pe adresele acestui Mac” | folosește adresa IP sau numele `.local` al Mac-ului; un alt nume (alias DNS) se adaugă în `SENTIQ_ALLOWED_HOSTS` |
| „Serverul Sentiq nu răspunde” | serverul nu rulează: dublu-click pe `Sentiq.app` (sau `scripts/sentiq.sh start`, sau `npm start`) |
| „Baza de date nu e configurată” | completează `data/database.env` (vezi „Pornire”) |
| „Serverul Azure SQL nu acceptă conexiuni de la IP-ul …” | adaugă IP-ul în portal: serverul SQL → *Networking* → *Firewall rules* |
| „Baza de date a refuzat utilizatorul …” | utilizatorul sau parola din `data/database.env` sunt greșite |
| „Baza de date nu răspunde acum. Reîncearcă în câteva secunde.” | Azure face mentenanță sau rețeaua e căzută; aplicația revine singură |
| Stare sistem: „Joburi de fundal: rulează pe …, nu aici” | normal când Sentiq rulează și pe Mac, și pe Azure pe aceeași bază: joburile le face una singură |
| `Port 4317 is already in use` | Sentiq rulează deja (sau alt program folosește portul; setează `SENTIQ_PORT`) |
| `Sentiq.app` arată „Sentiq nu a pornit” | mesajul conține cauza (Node lipsă, `npm install` nerulat, port ocupat, eroare la pornire); detalii în `data/logs/launcher.log` și în log-ul zilei |
| `Sentiq.app` arată că nu are acces la Documents | *System Settings → Privacy & Security → Files and Folders → Sentiq → Documents* |
| Calendar fără valori Actual | sursa TradingView nu răspunde; lista ForexFactory rămâne |
| Banner „ForexFactory a limitat temporar accesul” | se reia automat după o oră |
| O sursă de știri cu eroare | se reîncearcă automat (5 → 60 min); adminul o poate dezactiva din Setări → Admin |
| Tranzacții: „exchange-ul limitează temporar cererile” | exchange-ul e supraîncărcat sau s-a atins limita de cereri. Aplicația reîncearcă singură sau folosește ultimele prețuri bune (cu ora lor). Nu trebuie să faci nimic |
| Grafic de acțiune: timeframe-urile mici sunt gri | lipsește cheia ta Twelve Data (Setări → Ale mele → Date pentru acțiuni; vezi „Acțiuni”) |
| Grafic de acțiune: „limita Twelve Data atinsă” | s-au consumat cererile pe minut sau pe zi ale cheii tale (8 / 800 pe planul gratuit); graficul revine singur la ora afișată |
| IBKR: „tokenul Flex a expirat” | generează un token nou, cu expirare mai lungă, și adaugă din nou contul |
