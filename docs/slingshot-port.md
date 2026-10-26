# Portul Slingshot System 3.4 în Sentiq

> Sentiq se numea Kryptoniq când a fost portat indicatorul (12 oct 2026). Al doilea indicator al graficelor, [DI] Logarithmic Moving Average, e portat la fel, linie cu linie: TD-CHARTUX §2 și TD §9.4 (`src/shared/indicator/lma.ts`).

Sursa: `Sling Shot System/sling-shot-system-3.4.pine`. Istoricul versiunilor:
- **v3.4**: v3.3 + semnalele SHORT (exact regulile LONG-ului, inversate; fiecare parte își urmărește singură TP/SL) și comutatoarele Long / Short; vezi FD-SLINGSHOT34 / TD-SLINGSHOT34.
- **v3.3**: `sling-shot-system.pine`, păstrat neschimbat; v3.2 „Market Structure Levels” + urmărirea TP/SL reparată (FD-SS33 / TD-SS33).

Implicit (doar Long), 3.4 dă exact rezultatele lui 3.3: verificat pe 192 de serii reale și în teste, cu fixture-ul `__fixtures__/btc-usdt.v3.3.json`.
Implementare: `src/shared/indicator/slingshot.ts` (logica) + `src/shared/indicator/pine.ts` (funcțiile `ta.*`).

## Cum a fost portat
- **Linie cu linie**, în aceeași ordine a instrucțiunilor ca în Pine (mașinile de stări LONG și SHORT depind de ordine, iar ordinea creării etichetelor contează pentru limita de 500).
- **SHORT** = LONG oglindit, cu variabile proprii (`bear*`, `activeShort*`, `waitingShortTP`, `shortDisplay*`). Rezultatul e exact cel al LONG-ului pe prețurile negate (graficul întors): verificat pe 192 de serii reale și, în teste, pe datele BTC. În fișierul Pine, codul SHORT e codul LONG trecut prin tabelul de inversare, linie cu linie; singura diferență e blocul mort `currentCycleLabel` (punctul 2 de mai jos), care la SHORT lipsește.
- Variabilele `var` sunt stare persistentă; restul se recalculează la fiecare bară.
- `na` = `NaN`; toate testele de `na` sunt explicite, ca în Pine.
- Funcțiile `ta.ema`, `ta.rma`, `ta.rsi`, `ta.stoch`, `ta.sma`, `ta.atr`, `ta.highest/lowest(+bars)`, `ta.pivothigh/pivotlow`, `ta.valuewhen` reproduc semantica TradingView (detalii în [research.md](research.md) §5). Sunt verificate cu teste față de implementări de referință pe 2000 de lumânări BTC reale.
- `request.security(..., lookahead_off)` pentru Market Structure pe un timeframe superior: pe istoric se vede bara HTF închisă la închiderea barei de chart; pe bara în formare, bara HTF în formare.
- `max_labels_count = 500` este emulat (etichetele cele mai vechi dispar primele).

## Diferențe intenționate față de TradingView
Numele („[DE] Slingshot System 3.4” / „[DE] Slingshot 3.4”) și prețurile din etichetele nivelurilor și din tabel (precizia pieței; în Pine `format.mintick`) sunt aceleași din 26 oct 2026 (FIX-PINESYNC).

| Ce | De ce |
|---|---|
| Dacă lumânările HTF nu se pot încărca, Market Structure se ascunde (cu avertisment) | nu inventăm valori |
| Semnalele/alertele de pe lumânarea în formare sunt marcate „neconfirmat” | în TradingView se pot schimba până la închiderea barei |
| Alertele identice pe bare consecutive sunt grupate în listă („× N bare”) | doar afișare; logica de alertare e neschimbată |
| Primele semnale din istoric pot diferi | TradingView pornește calculul de la altă bară; semnalele recente coincid la aceleași date |
| Mărimea triunghiurilor și a X-ului: „Small” e calibrat pe TradingView (~24 px), celelalte mărimi sunt aproximate | TradingView nu publică dimensiunile în pixeli ale etichetelor (FD-SS34LIVE) |

## Particularități ale scriptului Pine
Găsite în timpul portării (12 oct 2026).

1. ~~**Urmărirea TP/SL a unui semnal putea fi pierdută.**~~ **Reparată în 3.3** (în Pine și în port). În 3.2, dacă după un LONG confirmat (care încă aștepta TP/SL) se forma un nou „deal” și apoi trendul se întorcea sau minimul V1 era încălcat, nivelurile semnalului deveneau `na` deși semnalul rămânea „urmărit”: tabelul TP/SL arăta `NaN`, iar alertele „ATR Stop Loss Hit” / „Take Profit Signal” nu mai apăreau. Pe 75.000 de lumânări reale: 154 de cazuri, 47 de alerte de stop loss pierdute. Reparația nu schimbă semnalele LONG, culorile lor sau rezultatele din istoric. Detalii: [functional-design.md](functional-design.md) FD-SS33, [technical-design.md](technical-design.md) TD-SS33.
2. **`currentCycleLabel` nu este niciodată setat**, deci blocul „SUCCESS: Remove current signal from danger list” din logica de Take Profit nu rulează niciodată (cod mort, inofensiv; păstrat).
3. **Condiția finală `if waitingLongTP and low < (activeLongSignalLow - storedStopLossAtr) and hideAtrOnStop`** nu poate fi niciodată adevărată: blocul de Stop Loss de mai sus pune deja `waitingLongTP := false` în exact aceeași situație (inofensiv; păstrat).
4. **„ATR Take Profit Hit”** se declanșează la fiecare bară cu maximul peste țintă cât timp semnalul e urmărit (comportamentul standard al `alertcondition`). La fel „Short ATR Take Profit Hit”, cu minimul sub țintă.
5. **Părțile sunt independente (3.4).** LONG-ul și SHORT-ul își urmăresc fiecare TP/SL-ul, își desenează liniile și își dau alertele, ca și cum cealaltă parte n-ar exista. Tabelul TP/SL are rândurile LONG, apoi pe cele SHORT.
6. **Garda „ascunde la SL”** din afișarea ATR e cod mort și în 3.3 (SL-ul oprește deja urmărirea pe aceeași bară); în 3.4 e oglindită pentru short, tot fără efect.
7. **Aspectul etichetelor (3.4, FD-SS34LIVE).**
   - Un semnal eșuat (stop loss) e un triunghi în Long / Short Failed Signal (culoarea și mărimea părții, FD-STYLEUNIFY).
   - Unul invalidat (înlocuit sau oprit de întoarcerea trendului) e un X (`label.style_xcross`) în Long / Short Invalidated Signal.
   - Semnalul în formare are Long / Short Forming Signal; fiecare schimbare de stare pune și mărimea stării (`label.set_size`), ca în Sentiq (`markerState` / `markerLook`).
   - Cât timp un semnal nou de aceeași parte e în formare, cel activ apare invalidat. Revine valid dacă cel nou dispare neconfirmat.
   - În port, `SlingshotMarker.color` este `'signal' | 'failed' | 'invalid'`. Verde / roșu din 3.3 se citesc ca `'signal'` / (`'failed'` sau `'invalid'`).
   - **Eticheta STOP LOSS** (FD-SSSL) se pune pe bara unde istoricul marchează eșecul (marcajele `stopLoss` / `shortStopLoss`).
8. **TP/SL afișate (3.4, FD-SSLIVEBOX):** întâi semnalul în formare, apoi cel urmărit. În 3.3 era invers. Urmărirea și alertele nu se schimbă.

## Când actualizezi indicatorul în TradingView
1. Fă diff între versiunea veche și cea nouă a fișierului `.pine`.
2. Aplică aceleași schimbări în `slingshot.ts` (păstrând ordinea instrucțiunilor) și noile input-uri în `params.ts` (cu aceleași valori implicite).
3. Actualizează `SLINGSHOT_VERSION` (titlurile din aplicație îl folosesc).
4. Adaugă un test de scenariu pentru comportamentul nou în `slingshot.test.ts` și rulează `npm test`.
