# Sentiq — Ghid de utilizare

Sentiq (de la *sentiment* + *IQ*, fostul Kryptoniq) adună într-un singur loc știrile și sentimentul pieței, calendarul economic, graficele cu Slingshot și LMA, plus portofoliile tale de la exchange-uri crypto și brokeri de acțiuni. Rulează pe Mac-ul tău și se poate deschide și de pe alte dispozitive din rețeaua de acasă, fiecare utilizator cu contul lui.

## Pornire
Cerințe: macOS, Node.js ≥ 24 (testat pe 25.9).

```bash
npm install        # o singură dată
npm start          # construiește interfața și pornește serverul
```
Deschide **http://localhost:4317**. Din rețeaua de acasă (telefon, alt calculator) merge și adresa Mac-ului, de exemplu `http://192.168.1.20:4317` (o vezi cu `scripts/sentiq.sh status`). La prima pornire macOS poate întreba dacă Node are voie să primească conexiuni: alege **Allow**. Ca Sentiq să asculte doar pe Mac, pornește-l cu `SENTIQ_BIND=127.0.0.1`.

> Dacă `npm install` se plânge de fișiere „root-owned” în `~/.npm`, rulează o dată: `sudo chown -R $(id -u):$(id -g) ~/.npm`.

La prima pornire:
- se creează `data/` (baza de date, cheia de criptare `master.key`, log-uri, modelul AI);
- se descarcă modelul de sentiment (~170 MB, o singură dată). Până e gata, știrile apar „în analiză”;
- favoritele pornesc cu BTC, ETH, SOL.

Oprire: `Ctrl+C` în terminal. Datele rămân în `data/`. Log-urile (`data/logs/`, câte unul pe zi) se păstrează 30 de zile.

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

**De la Kryptoniq la Sentiq.** Datele tale rămân aceleași: baza de date existentă (`data/kryptoniq.db`), cheia `data/master.key` și cheile salvate se folosesc mai departe, fără nicio mutare. Variabilele `KRYPTONIQ_*` sunt acceptate în continuare, alături de noile `SENTIQ_*`. Vechiul `Kryptoniq.app` și `scripts/kryptoniq.sh` au fost scoase din proiect: folosește `Sentiq.app` și `scripts/sentiq.sh`.

Serverul pornit așa rulează până îl oprești sau până închizi sesiunea / oprești Mac-ul. Comenzi utile, din Terminal:

| Comandă | Ce face |
|---|---|
| `scripts/sentiq.sh` sau `scripts/sentiq.sh start` | pornește în fundal (dacă nu rulează) și deschide browserul (`--no-open` = fără browser) |
| `scripts/sentiq.sh stop` | oprește serverul (inclusiv unul pornit cu `npm start`) |
| `scripts/sentiq.sh restart` | oprește și pornește din nou, de exemplu după o actualizare a codului |
| `scripts/sentiq.sh status` | arată dacă rulează, de cât timp și adresele din rețea |
| `scripts/sentiq.sh logs` | urmărește log-ul zilei (`Ctrl+C` pentru ieșire) |
| `scripts/sentiq.sh admin-email ADRESA` | adresa contului de admin, înainte de prima intrare |
| `scripts/sentiq.sh admin-reset` | dacă adminul nu mai poate intra: șterge parola, 2FA și passkey-urile adminului (datele rămân); prima deschidere de pe Mac cere din nou parola |

## Conturi și autentificare
Fiecare persoană are contul ei: favoritele, setările graficelor și ale calendarului, fusul orar, conturile de exchange / broker, evenimentele personale și scanner-ul sunt doar ale ei. Știrile, sentimentul zilei, calendarul economic și datele de piață sunt comune.

**Contul tău de admin** există deja și are toate datele de până acum. La prima deschidere **de pe Mac** (http://localhost:4317) îți setezi numele și parola; apoi ajungi în *Securitate*, unde merită să pornești imediat autentificarea în doi pași. Doar adminul vede sursele de știri, motorul de sentiment, cheile (Claude, Twelve Data, Resend), retenția, *Stare sistem* și *Utilizatori*.

**Ceilalți primesc cont doar la cerere:**
1. Din pagina de autentificare, **„Cere un cont”**: numele și emailul, fără parolă. Răspunsul e mereu același („Am primit cererea…”), indiferent dacă adresa are deja cont.
2. Adminul află imediat: un email „Cerere nouă de cont” și un punct (în culoarea accentului) pe inițiala lui, sus în dreapta (în meniu: „Utilizatori · 1 cerere”).
3. În *Utilizatori → Cereri de cont*, adminul apasă **Aprobă** sau **Respinge** (o cerere respinsă dispare fără niciun email; o cerere la care nu răspunde în 30 de zile dispare singură).
4. La aprobare se creează contul (cu favoritele BTC, ETH, SOL), cu starea „Așteaptă activarea”, iar persoana primește pe email **linkul de activare** (valabil 7 zile). Pagina îi arată adminului dacă emailul a plecat și, oricum, linkul, cu **Copiază**.
5. Din link, persoana își alege parola (minimum 12 caractere, cu literă mare, literă mică și cifră), apoi **„Intră în cont”** o duce la login cu emailul completat.

Un link expirat sau pierdut se înlocuiește din *Utilizatori → Link nou de activare* (cel vechi nu mai merge). Linkul folosește adresa publică a aplicației (`SENTIQ_PUBLIC_URL`) când există, altfel adresa din care aprobi: aprobat de pe `localhost`, merge doar pe Mac-ul tău (pagina te avertizează).

> **Emailuri, varianta de dezvoltare.** Emailurile pleacă prin Resend, cu expeditorul de test `onboarding@resend.dev`, care livrează **doar la adresa contului Resend** (a adminului): emailul „cerere nouă” îți ajunge, dar cel cu linkul de activare nu ajunge la ceilalți. Trimite-le tu linkul din pagina de aprobare (nu apare niciodată în jurnal). Când ai un domeniu verificat în Resend, pune expeditorul nou în *Setări → Email (Resend)* și emailurile ajung la toți.

**Intrarea:**
- email și parolă; cu 2FA pornit, urmează codul de 6 cifre din aplicația de autentificare (ai 5 minute) sau un cod de recuperare;
- sau **„Intră cu un passkey”** (Touch ID, Face ID, PIN): fără parolă și fără cod. Passkey-urile merg doar la `http://localhost:4317`, pe Mac; pe adresa din rețea (`http://192.168…`) browserele nu le permit;
- 3 încercări greșite de pe același dispozitiv blochează intrarea 15 minute;
- rămâi conectat 30 de zile de la ultima folosire.

**Parola uitată:** „Am uitat parola” trimite un link valabil o oră. Parola nouă închide toate sesiunile; autentificarea în doi pași rămâne pornită.

**Securitate** (meniul cu inițiala ta, sus în dreapta):
- numele și parola (schimbarea parolei închide celelalte sesiuni);
- **autentificarea în doi pași**: scanezi codul QR cu Google Authenticator, Microsoft Authenticator, 1Password, Authy etc., scrii primul cod și primești **10 coduri de recuperare**, afișate o singură dată (copiază-le sau descarcă-le). Oprirea și codurile noi cer parola și un cod;
- **passkey-uri**: adaugă, redenumește, șterge;
- „Ieși de pe toate dispozitivele”.

**Utilizatori** (doar admin): cererile de cont (Aprobă / Respinge) și lista conturilor, cu „Link nou de activare” (pentru conturile neactivate), „Dezactivează” / „Reactivează”, „Oprește 2FA” (pentru cine și-a pierdut telefonul și codurile) și „Șterge” (cu toate datele contului).

## Tema luminoasă / întunecată
Butonul cu **soare** din bara de sus (lângă căutare) trece pe tema luminoasă; cel cu **lună** te întoarce pe cea întunecată. Pe telefon, comutarea e în meniul contului (inițiala, sus în dreapta). Alegerea se ține minte în acest browser (și pentru celelalte taburi deschise); fără alegere, tema e cea întunecată. Pe paginile de login butonul e sus în dreapta.

Tema luminoasă („Navy”): bara de sus și banda cu prețuri rămân bleumarin, pagina e gri-albăstruie, plăcile albe cu chenar, iar accentul e turcoaz (pe tema întunecată rămâne auriul). Pe ambele teme:
- **graficul** stă pe placa lui, cu altă culoare decât pagina (alb pe tema luminoasă);
- **tabelele și listele** (Tranzacții, Economie, Stare sistem, Știri, alertele de pe grafic…) au rândurile alternate; rândul de sub cursor se colorează;
- **butoanele, filtrele, segmentele și meniul** își schimbă clar chenarul, fundalul și textul sub cursor; filtrele apăsate sunt pline (bleumarin pe tema luminoasă).

## Pagini
Meniul e sus. Sub el, **banda de prețuri** arată, pe orice pagină:
- monedele favorite (preț, variația pe 24 h, grafic pe 48 h) și acțiunile favorite (preț, variația zilei, grafic pe 60 de zile, „închis” când bursa e închisă);
- evenimentul major următor, cu numărătoare;
- Fear & Greed crypto, capitalizarea pieței și dominanța BTC;
- bursa americană (deschisă / pre-market / after-hours / închisă, cu numărătoare până la deschidere sau închidere), S&P 500, Nasdaq 100, VIX și Fear & Greed pentru acțiuni (CNN).

**Căutare rapidă: ⌘K** (Ctrl+K pe Windows/Linux) sau butonul „Caută” din meniu. Scrii o pagină („calendar”), o monedă („sol”, din favorite sau orice pereche de pe exchange), o acțiune („tesla”, „AAPL”) sau un subiect, apoi alegi „Caută în știri”. Navighezi cu ↑/↓, deschizi cu Enter, închizi cu Esc. Nu contează diacriticele („stiri” găsește „Știri”).

- **Azi**: un cockpit pe un singur ecran (la 1440 × 900). Cuprinde:
  - sentimentul zilei (0–100) cu spectrul, variația față de acum o oră, ziua pe ore și sub-indicii crypto / acțiuni / macro / geopolitică;
  - evenimentul major următor (inclusiv rezultatele companiilor favorite), cu numărătoare și cu evenimentele de azi;
  - știrile live;
  - favoritele tale (preț, variație, grafic, trend, ultimul semnal Slingshot, TP/SL active, structura);
  - ce mișcă piața („Arată toate” pentru toate știrile-motor);
  - ultimele 30 de zile.

  Pe ecrane mai mici, tile-urile se așază unul sub altul.

  **Rezumat** (butonul din stânga căutării, doar pe Azi): o fereastră mare în care Claude rezumă ziua **de până acum** și spune dacă e o **zi bună de trading**, **mixtă** sau **slabă** (cu cât de sigur e). Dedesubt: câteva secțiuni scurte (sentiment, macro și indicatori, crypto, acțiuni), **Oportunități**, **Riscuri**, **Ce urmează** în următoarele 24 de ore (cu ora) și până la 4 grafice alese după situație: sentimentul pe ore sau pe ultimele zile, sentimentul pe categorii, istoricul indicatorilor economici publicați azi (cu prognoza ca cerc gol și punctul final verde / roșu, ca pe pagina Economie) și variația favoritelor pe 24 h. Cifrele graficelor sunt ale aplicației, nu ale lui Claude. La prima deschidere din zi rezumatul se face singur (20–60 de secunde); după aceea vezi ultimul rezumat de azi, iar **Actualizează** face unul nou cu datele de acum (cel mult o dată la 2 minute). Se închide cu ×, Esc sau click în afara ei. Claude primește doar datele aplicației despre azi (sentimentul, titlurile știrilor, calendarul, indicatorii, contextul pieței, favoritele tale), niciodată chei, conturi sau portofolii. Folosește cheia Claude din Setări → Motorul de sentiment (pusă de admin) și costă în jur de 5–15 cenți pe rezumat (jurnalul aplicației arată tokenii fiecăruia). Nu este un sfat de investiții.
- **Știri**: toate știrile, cu sentiment per știre („De ce acest scor?” arată motorul, scorul modelului, regulile aplicate și importanța cu care știrea intră în sentimentul zilei: cea dată de Claude, când Claude a notat-o, altfel cea după cuvinte-cheie). Filtrele sunt într-o bară deasupra listei: interval, categorie (Crypto, Acțiuni, Macro, Geopolitică), sentiment, sursă, favoritele tale, căutare. Filtrele schimbă doar lista, nu și sentimentul zilei.
- **Calendar**: săptămâna pe coloane, câte o zi pe coloană (pe ecrane mici, o zi sub alta). Click pe o fișă arată explicația evenimentului și abaterea față de așteptări. Are filtre de impact și valută, cipul **„Rezultate companii”** (rezultatele trimestriale ale acțiunilor favorite, cu EPS estimat și EPS-ul de anul trecut) și evenimente personale (se șterg din fișa lor).
- **Economie**: nivelul curent al indicatorilor economici, pe țări: SUA, zona euro (UE), Marea Britanie, Japonia, China, Canada, Elveția, Australia, Noua Zeelandă. Pentru fiecare: ultima valoare și perioada ei, valoarea anterioară (revizuită) și schimbarea, istoricul pe ~13 luni, **data și ora următoarei publicări** (cu prognoza, când există) și sursa oficială. Sus sunt „Esențialele” fiecărei țări (inflație, șomaj, PIB, dobândă, cereri de șomaj, NFP…), dedesubt toți indicatorii pe grupe (prețuri, muncă, PIB, industrie, consum, locuințe, bani și dobânzi, comerț, buget, energie, obligațiuni). Un click pe rând arată explicația și ce s-a publicat față de prognoză. **Culorile:** verde = schimbare bună pentru economie, roșu = rea (inflația sau șomajul în creștere sunt roșii, PIB-ul sau locurile de muncă în creștere sunt verzi, dobânzile și randamentele în creștere sunt roșii); fără culoare = indicator neutru (salarii, stocuri, prețul locuințelor) sau fără schimbare; săgeata ▲ / ▼ arată direcția, iar punctul de la capătul istoricului are culoarea ultimei schimbări. Pentru zona euro apar și indicatorii Germaniei, Franței, Italiei și Spaniei care nu există la nivelul zonei euro (ex. Ifo). Sus, cipurile țărilor sunt **filtre**: un click pe o țară arată doar indicatorii ei, alt click pe ea (sau „Toate”) le arată din nou pe toate; numărul de pe cip spune câți indicatori are țara, iar filtrul rămâne în adresa paginii. Căutare și „Doar importante”. Datele vin din același calendar economic ca pagina Calendar; valorile noi apar la câteva minute după publicare, iar la prima pornire istoricul se încarcă în câteva minute.
- **Grafice**: lumânări cu Slingshot System 3.3 (nor EMA, LONG, TAKE PROFIT, TP/SL, Market Structure) și, în panoul de jos, **[DI] Logarithmic Moving Average** (linia de semnal, pragurile, starea BULLISH / BEARISH / NEUTRAL). Mai sunt istoricul semnalelor și al alertelor. Opțional, pozițiile și ordinele tale apar ca linii pe grafic, cu PnL la SL, TP și la prețul curent.
  - Merge pentru perechi crypto (`/charts/BTC/USDT`) și pentru acțiuni americane (`/charts/s/AAPL`). Câmpul de căutare de lângă favorite găsește ambele.
  - „Indicatori” deschide setările ambilor indicatori, cu aceleași nume și valori ca în TradingView. Legenda LMA are butoane pentru setări și pentru ascundere.
  - „Color Price Bars” (implicit activ, ca în TradingView) colorează lumânările după LMA; îl poți opri din setările LMA.
  - Graficul nu are grilă și nici linii sub cursor; prețul și ora apar pe axe.
  - Bifele **„Slingshot”** și **„LMA”** arată sau ascund fiecare indicator; cu ambele debifate, graficul are doar lumânările. Panourile „Semnale” și „Alerte” de sub grafic rămân.
  - **Favoritele de deasupra graficului se pot reordona:** le tragi cu mouse-ul (pe ecran tactil: ții apăsat, apoi tragi) sau, cu tastatura, Alt + ← / → pe un favorit. Ordinea e aceeași peste tot (bandă, Azi, Setări). Un click simplu deschide graficul, ca înainte.
  - Aplicația ține minte perechea sau acțiunea, timeframe-ul, comutatoarele „Pozițiile mele”, „Slingshot” și „LMA”, înălțimea panoului LMA și setările indicatorilor. „Grafice” din meniu redeschide ultimul grafic. Zoom-ul fiecărui grafic și al fiecărui timeframe e ținut minte în browser.
  - **Ecran complet**: butonul din bara graficului. Ieși cu „Ieși din ecran complet” sau cu **Esc**; dacă sertarul de setări e deschis, primul Esc îl închide.
- **Tranzacții**: pentru fiecare cont, cu logo-ul lui: poziții, dețineri cu preț mediu și PnL, numerar (la brokeri), ordine deschise și tranzacțiile recente.
- **Setări**: favorite (monede și acțiuni; ordinea se schimbă trăgând de mânerul ⋮⋮, cu săgețile sau cu Alt + ↑ / ↓), conturi (exchange-uri și brokeri), date de piață și scanner, fus orar. Doar adminul vede și sursele de știri, motorul de sentiment (local / Claude), cheia Twelve Data, emailul (Resend) și retenția.
- **Stare sistem** (doar admin): sănătatea surselor, a job-urilor și a modelului, plus consumul Twelve Data.

## Acțiuni
1. **Favorite**: Setări → Favorite → **Acțiuni**, apoi caută după simbol sau nume („Apple”, „MSFT”). Numele companiei devine alias pentru știri (îl poți edita).
2. **Ce primești** pentru fiecare acțiune favorită: prețul în bandă și în Azi, graficul cu Slingshot și LMA, știrile ei (Nasdaq adaugă automat un feed pentru ea), rezultatele trimestriale în calendar și rândul ei în scanner.
3. **Graficele fără cheie** au lumânări zilnice și săptămânale (Nasdaq, gratuit). Pentru 1m – 4h pune cheia gratuită **Twelve Data**:
   - înregistrare pe https://twelvedata.com/register, apoi pagina **API Keys**;
   - Setări → Date de piață → „Cheie Twelve Data” → „Verifică și salvează”.

   Planul gratuit are 800 de cereri pe zi și 8 pe minut. Aplicația ține minte lumânările și nu mai cere altele cât bursa nu e în ședința regulată (noaptea, în pre-market și after-hours, în weekend); dacă limita e atinsă, graficul arată ultimele lumânări și ora la care revine. Twelve Data nu are 3m, 6h, 8h, 12h: graficul arată atunci timeframe-ul cel mai apropiat.
4. Datele sunt pentru bursele americane (NASDAQ, NYSE), cu câteva minute întârziere la preț.

## Conturi: exchange-uri și brokeri
Setări → Conturi → **„Adaugă un cont”** (sau butonul din pagina Tranzacții) deschide un ghid în doi pași:
1. alegi exchange-ul sau brokerul (după nume sau logo; filtrul separă crypto de acțiuni);
2. urmezi pașii afișați pentru crearea cheii (cu linkul direct spre pagina furnizorului) și completezi exact câmpurile cerute de acel furnizor.

La „Conectează”, aplicația testează conexiunea și salvează cheile criptat doar dacă testul reușește.

Sentiq **doar citește**: solduri, poziții, ordine și tranzacții. Nu plasează și nu anulează niciodată ordine. Creează cheile doar cu permisiuni de citire.

| Furnizor | Ce ceri la creare | Ce completezi |
|---|---|---|
| KuCoin | permisiunea „General” | API Key, Secret, Passphrase |
| Binance | doar „Enable Reading” | API Key, Secret Key |
| Bybit | „Read-Only” | API Key, API Secret |
| OKX | „Read” | API Key, Secret Key, Passphrase |
| Kraken | „Query Funds”, „Query Open Orders & Trades”, „Query Closed Orders & Trades” | API Key, Private Key |
| Coinbase | o cheie CDP „View” (ECDSA) | numele cheii (`organizations/…/apiKeys/…`) și cheia privată |
| Bitget | „Read-only” | API Key, Secret Key, Passphrase |
| Trading 212 | cheie API cu permisiunile de citire (cont Invest sau ISA) | API Key, API Secret, Live / Practice |
| eToro | cheie API „Read” | Public API Key, User Key, Real / Demo |
| Interactive Brokers | Flex Web Service + un Activity Flex Query (XML) cu Open Positions, Trades și Cash Report | Token Flex, Query ID |
| Alpaca | cheile contului | API Key ID, Secret Key, Live / Paper |

Lista are doar platformele care se pot conecta. XTB, Tradeville, Revolut (acțiuni) și Degiro nu au (sau nu mai au) un API pentru clienți, deci nu apar.

Cheile sunt criptate (AES-256-GCM) cu `data/master.key`. **Nu șterge, nu redenumi și nu partaja `data/master.key`**: fără ea cheile salvate nu mai pot fi citite (le reintroduci).

> Notă: integrările au fost testate cu răspunsurile documentate de fiecare furnizor, nu cu conturi reale. La prima conectare cu cheia ta, verifică pagina Tranzacții; dacă o secțiune afișează o eroare, mesajul spune cauza, iar „Stare sistem” și log-ul din `data/logs/` arată detaliile.

**Interactive Brokers** dă datele printr-un raport Flex, nu în timp real: pozițiile sunt cele de la ultima închidere. Tokenul Flex expiră implicit după 6 ore; la generare alege o expirare mai lungă.

## Sentiment cu Claude (opțional)
Setări → Motorul de sentiment → Claude, apoi cheia API Anthropic. Se trimit doar titlurile știrilor. Claude dă fiecărei știri scorul (bună / proastă pentru piață) și importanța (1 minoră, 2 notabilă, 3 mișcă piața); amândouă intră în sentimentul zilei. Știrile geopolitice legate de piețe cântăresc 0,8 față de știrile crypto (1). Model implicit: `claude-opus-5-5`. Pentru cost minim alege `claude-haiku-5-5`. Dacă Claude nu răspunde, se folosește automat motorul local. Aceeași cheie face și **Rezumatul** zilei de pe pagina Azi (mereu cu `claude-opus-5-5`, pentru oricare utilizator îl cere).

## Claude cu abonamentul tău (connector)
Fiecare utilizator își poate conecta **propriul abonament Claude** la datele lui din Sentiq, fără cheie API și fără cost în plus (intră în limitele abonamentului). Analiza o face Claude, în aplicația Claude: întrebi „e o zi bună de trading?”, „ce s-a întâmplat azi cu SOL?”, „arată-mi BTC pe 4h cu Slingshot”, iar Claude citește din Sentiq ce îi trebuie.

**Stare:** connectorul e gata, dar **oprit**. Merge doar cu o adresă publică HTTPS (Claude se conectează din serverele Anthropic, nu din browserul tău), deci se pornește odată cu găzduirea online.

**Pornire (adminul, pe server):** `SENTIQ_PUBLIC_URL=https://adresa-ta` și `SENTIQ_MCP=1`, apoi repornire. În jurnal apare „Claude connector on: https://adresa-ta/mcp”. Opțional, `SENTIQ_MCP_CLIENTS` schimbă aplicațiile acceptate (implicit `claude.ai,claude.com`).

**Conectare (fiecare utilizator, o singură dată):**
1. În Claude (claude.ai sau Claude Desktop): **Customize → Connectors → Add custom connector**, cu adresa din Sentiq, Securitate → „Claude (connector)” (de forma `https://adresa-ta/mcp`).
2. **Connect** → se deschide Sentiq: intri în cont (parolă + 2FA sau passkey), apoi pagina „Conectezi Claude la Sentiq?” arată cine cere, unde te întorci, ce poate vedea Claude și ce nu → **Permite accesul**.
3. Gata: connectorul merge în Claude pe web, pe Desktop și pe telefon (pe telefon apare după ce l-ai adăugat pe web). În meniul „+” al conversației găsești și prompturile **Rezumatul zilei** și **Analiza unei monede sau acțiuni**.
4. Din Claude Code: `claude mcp add --transport http sentiq https://adresa-ta/mcp`, apoi `/mcp` pentru login.

**Ce poate citi Claude (doar ale tale, doar citire):** ziua de azi (ca la Rezumat), sentimentul (azi și ultimele zile), știrile (cu căutare), calendarul economic (cu evenimentele și notițele tale), indicatorii economici, contextul pieței, favoritele din scanner și graficul oricărei monede / acțiuni cu analiza Slingshot după setările tale. **Nu vede niciodată** cheile, conturile de exchange / broker, portofoliile, pozițiile, parola sau datele altor utilizatori și **nu poate schimba nimic** în Sentiq.

**Deconectare:** Securitate → „Claude (connector)” → **Deconectează**. Conexiunile se șterg singure și la „Ieși de pe toate dispozitivele”, la o parolă nouă prin link de resetare și când adminul dezactivează sau șterge contul. Claude rămâne conectat cât îl folosești măcar o dată la 30 de zile.

## Backup
Copiază folderul `data/` cu aplicația oprită (`scripts/sentiq.sh stop`). Conține și conturile utilizatorilor (parolele doar ca hash, cheile criptate cu `data/master.key`).

## Probleme frecvente
| Simptom | Cauză / soluție |
|---|---|
| Nu primești emailul cu linkul de activare | în varianta de dezvoltare emailurile ajung doar la admin: adminul îți trimite linkul (din *Utilizatori*, după aprobare, sau cu „Link nou de activare”) |
| „Pagina nu a putut fi afișată — Codul paginii nu s-a putut încărca” | aplicația tocmai s-a actualizat sau serverul repornește: pagina se reîncarcă singură când serverul răspunde; dacă nu, apasă „Reîncarcă pagina” |
| „Prea multe încercări” la login | așteaptă 15 minute sau intră cu un passkey (pe Mac) |
| Codul din aplicație e „greșit” | pune ora telefonului pe automat; sau folosește un cod de recuperare |
| Ai pierdut telefonul și codurile de recuperare | adminul îți oprește 2FA din *Utilizatori*; adminul însuși: `scripts/sentiq.sh admin-reset` |
| Passkey-ul nu apare pe telefon / alt calculator | e normal: passkey-urile merg doar la http://localhost:4317 pe Mac |
| Din rețea: „Sentiq răspunde doar pe adresele acestui Mac” | folosește adresa IP sau numele `.local` al Mac-ului; un alt nume (alias DNS) se adaugă în `SENTIQ_ALLOWED_HOSTS` |
| „Serverul Sentiq nu răspunde” | serverul nu rulează: dublu-click pe `Sentiq.app` (sau `scripts/sentiq.sh start`, sau `npm start`) |
| `Port 4317 is already in use` | Sentiq rulează deja (sau alt program folosește portul; setează `SENTIQ_PORT`) |
| `Sentiq.app` arată „Sentiq nu a pornit” | mesajul conține cauza (Node lipsă, `npm install` nerulat, port ocupat, eroare la pornire); detalii în `data/logs/launcher.log` și în log-ul zilei |
| `Sentiq.app` arată că nu are acces la Documents | *System Settings → Privacy & Security → Files and Folders → Sentiq → Documents* |
| Calendar fără valori Actual | sursa TradingView nu răspunde; lista ForexFactory rămâne |
| Banner „ForexFactory a limitat temporar accesul” | se reia automat după o oră |
| O sursă de știri cu eroare | se reîncearcă automat (5 → 60 min); o poți dezactiva din Setări |
| Tranzacții: „exchange-ul limitează temporar cererile” | exchange-ul e supraîncărcat sau s-a atins limita de cereri. Aplicația reîncearcă singură sau folosește ultimele prețuri bune (cu ora lor). Nu trebuie să faci nimic |
| Grafic de acțiune: timeframe-urile mici sunt gri | lipsește cheia Twelve Data (vezi „Acțiuni”) |
| Grafic de acțiune: „limita Twelve Data atinsă” | s-au consumat cele 8 cereri pe minut sau 800 pe zi; graficul revine singur la ora afișată |
| IBKR: „tokenul Flex a expirat” | generează un token nou, cu expirare mai lungă, și adaugă din nou contul |
