# Kryptoniq — Ghid de utilizare

## Pornire
Cerințe: macOS, Node.js ≥ 24 (testat pe 25.9).

```bash
npm install        # o singură dată
npm start          # construiește interfața și pornește serverul
```
Deschide **http://127.0.0.1:4317**. Aplicația ascultă doar pe calculatorul tău.

> Dacă `npm install` se plânge de fișiere „root-owned” în `~/.npm`, rulează o dată: `sudo chown -R $(id -u):$(id -g) ~/.npm`.

La prima pornire:
- se creează `data/` (baza de date, cheia de criptare `master.key`, log-uri, modelul AI);
- se descarcă modelul de sentiment (~170 MB, o singură dată). Până e gata, știrile apar „în analiză”;
- watchlist-ul pornește cu BTC, ETH, SOL.

Oprire: `Ctrl+C` în terminal. Datele rămân în `data/`. Log-urile (`data/logs/`, câte unul pe zi) se păstrează 30 de zile.

Pentru dezvoltare: `npm run dev` (server cu reîncărcare + interfață pe http://127.0.0.1:5317), `npm test`, `npm run typecheck`.

### Pornire fără Terminal (`Kryptoniq.app`)
Generezi o singură dată aplicația, din Terminal, în folderul proiectului:
```bash
scripts/kryptoniq.sh app
```
Apare **`Kryptoniq.app`** în folderul proiectului. La dublu-click pornește serverul în fundal (dacă nu rulează deja), fără fereastră de Terminal, și deschide http://127.0.0.1:4317. Prima pornire poate dura câteva secunde în plus dacă trebuie reconstruită interfața.
- **Dock**: trage `Kryptoniq.app` în Dock.
- **Pornire automată la login**: *System Settings → General → Login Items → Open at Login → +* → alege `Kryptoniq.app`. La login pornește serverul și se deschide browserul.
- **Prima dată** macOS poate întreba dacă „Kryptoniq” are voie să acceseze folderul **Documents**. Alege **Allow**, pentru că proiectul e acolo. Dacă ai refuzat: *System Settings → Privacy & Security → Files and Folders → Kryptoniq → Documents*.
- Dacă regenerezi aplicația (`scripts/kryptoniq.sh app`), macOS poate cere din nou permisiunea.

Serverul pornit așa rulează până îl oprești sau până închizi sesiunea / oprești Mac-ul. Comenzi utile, din Terminal:

| Comandă | Ce face |
|---|---|
| `scripts/kryptoniq.sh` sau `scripts/kryptoniq.sh start` | pornește în fundal (dacă nu rulează) și deschide browserul (`--no-open` = fără browser) |
| `scripts/kryptoniq.sh stop` | oprește serverul (inclusiv unul pornit cu `npm start`) |
| `scripts/kryptoniq.sh restart` | oprește și pornește din nou, de exemplu după o actualizare a codului |
| `scripts/kryptoniq.sh status` | arată dacă rulează și de cât timp |
| `scripts/kryptoniq.sh logs` | urmărește log-ul zilei (`Ctrl+C` pentru ieșire) |

## Pagini
Meniul e sus. Sub el, **banda de prețuri** arată, pe orice pagină, monedele favorite (preț, variația pe 24 h, grafic pe 48 h), evenimentul major următor cu numărătoare, Fear & Greed, capitalizarea pieței și dominanța BTC.

**Căutare rapidă: ⌘K** (Ctrl+K pe Windows/Linux) sau butonul „Caută” din meniu. Scrii o pagină („calendar”), o monedă („sol”, din favorite sau orice pereche de pe exchange) sau un subiect, apoi alegi „Caută în știri”. Navighezi cu ↑/↓, deschizi cu Enter, închizi cu Esc. Nu contează diacriticele („stiri” găsește „Știri”).

- **Azi**: un cockpit pe un singur ecran (la 1440 × 900). Cuprinde:
  - sentimentul zilei (0–100) cu spectrul, variația față de acum o oră, ziua pe ore și sub-indicii crypto / macro / geopolitică;
  - evenimentul major următor, cu numărătoare și cu evenimentele de azi;
  - știrile live;
  - monedele tale (preț, 24h, grafic pe 48 h, trend, ultimul semnal Slingshot, TP/SL active, structura);
  - ce mișcă piața („Arată toate” pentru toate știrile-motor);
  - ultimele 30 de zile.

  Pe ecrane mai mici, tile-urile se așază unul sub altul.
- **Știri**: toate știrile, cu sentiment per știre („De ce acest scor?” arată motorul, scorul modelului și regulile aplicate). Filtrele sunt într-o bară deasupra listei: interval, categorie, sentiment, sursă, monedele tale, căutare. Filtrele schimbă doar lista, nu și sentimentul zilei.
- **Calendar**: săptămâna pe coloane, câte o zi pe coloană (pe ecrane mici, o zi sub alta). Click pe o fișă arată explicația evenimentului și abaterea față de așteptări. Are filtre de impact și valută și evenimente personale (se șterg din fișa lor).
- **Grafice**: lumânări cu Slingshot System 3.3 (nor EMA, LONG, TAKE PROFIT, TP/SL, Market Structure) și, în panoul de jos, **[DI] Logarithmic Moving Average** (linia de semnal, pragurile, starea BULLISH / BEARISH / NEUTRAL). Mai sunt istoricul semnalelor și al alertelor. Opțional, pozițiile și ordinele tale apar ca linii pe grafic.
  - „Indicatori” deschide setările ambilor indicatori, cu aceleași nume și valori ca în TradingView. Legenda LMA are butoane pentru setări și pentru ascundere.
  - „Color Price Bars” (implicit activ, ca în TradingView) colorează lumânările după LMA; îl poți opri din setările LMA.
  - Graficul nu are grilă și nici linii sub cursor; prețul și ora apar pe axe.
  - Aplicația ține minte perechea, timeframe-ul, comutatoarele „Pozițiile mele” și „LMA”, înălțimea panoului LMA și setările indicatorilor. „Grafice” din meniu redeschide ultima pereche. Zoom-ul fiecărei perechi și al fiecărui timeframe e ținut minte în browser.
  - **Ecran complet**: butonul din bara graficului. Ieși cu „Ieși din ecran complet” sau cu **Esc**; dacă sertarul de setări e deschis, primul Esc îl închide.
- **Tranzacții**: poziții futures, dețineri spot cu preț mediu și PnL estimat, ordine deschise, tranzacții din ultimele 7 zile.
- **Setări**: monede favorite, surse de știri, motorul de sentiment (local / Claude), conturi exchange, date de piață, fus orar, retenție.
- **Stare sistem**: sănătatea surselor, a job-urilor și a modelului.

## Cheia KuCoin (read-only)
1. KuCoin → API Management → Create API.
2. Permisiuni: **doar „General”**. Fără Trade, Transfer, Withdrawal.
3. Opțional: restricție pe IP.
4. În Kryptoniq: Setări → Conturi exchange → completează API Key, Secret, Passphrase.

Cheile sunt criptate (AES-256-GCM) cu `data/master.key`. **Nu șterge și nu partaja `data/master.key`**: fără ea cheile salvate nu mai pot fi citite (le reintroduci).

> Notă: integrarea KuCoin a fost testată cu un exchange simulat. La prima conectare cu cheia ta reală, verifică pagina Tranzacții. Dacă o secțiune afișează o eroare, pagina „Stare sistem” și log-ul din `data/logs/` arată detaliile.

## Sentiment cu Claude (opțional)
Setări → Motorul de sentiment → Claude, apoi cheia API Anthropic. Se trimit doar titlurile știrilor. Model implicit: `claude-opus-5-5`. Pentru cost minim alege `claude-haiku-5-5`. Dacă Claude nu răspunde, se folosește automat motorul local.

## Backup
Copiază folderul `data/` cu aplicația oprită (`scripts/kryptoniq.sh stop`).

## Probleme frecvente
| Simptom | Cauză / soluție |
|---|---|
| „Serverul Kryptoniq nu răspunde” | serverul nu rulează: dublu-click pe `Kryptoniq.app` (sau `scripts/kryptoniq.sh start`, sau `npm start`) |
| `Port 4317 is already in use` | Kryptoniq rulează deja (sau alt program folosește portul; setează `KRYPTONIQ_PORT`) |
| `Kryptoniq.app` arată „Kryptoniq nu a pornit” | mesajul conține cauza (Node lipsă, `npm install` nerulat, port ocupat, eroare la pornire); detalii în `data/logs/launcher.log` și în log-ul zilei |
| `Kryptoniq.app` arată că nu are acces la Documents | *System Settings → Privacy & Security → Files and Folders → Kryptoniq → Documents* |
| Calendar fără valori Actual | sursa TradingView nu răspunde; lista ForexFactory rămâne |
| Banner „ForexFactory a limitat temporar accesul” | se reia automat după o oră |
| O sursă de știri cu eroare | se reîncearcă automat (5 → 60 min); o poți dezactiva din Setări |
| Tranzacții: „exchange-ul limitează temporar cererile” | KuCoin e supraîncărcat sau s-a atins limita de cereri. Aplicația reîncearcă singură, cere prețurile monedelor tale una câte una sau folosește ultimele prețuri bune (cu ora lor). Nu trebuie să faci nimic |
