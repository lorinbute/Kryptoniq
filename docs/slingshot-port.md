# Portul Slingshot System 3.3 în Sentiq

> Sentiq se numea Kryptoniq când a fost portat indicatorul (12 oct 2026). Al doilea indicator al graficelor, [DI] Logarithmic Moving Average, e portat la fel, linie cu linie: TD-CHARTUX §2 și TD §9.4 (`src/shared/indicator/lma.ts`).

Sursa: `Sling Shot System/sling-shot-system.pine` (v3.3 = v3.2 „Market Structure Levels” + urmărirea TP/SL reparată, vezi FD-SS33 / TD-SS33).
Implementare: `src/shared/indicator/slingshot.ts` (logica) + `src/shared/indicator/pine.ts` (funcțiile `ta.*`).

## Cum a fost portat
- **Linie cu linie**, în aceeași ordine a instrucțiunilor ca în Pine (mașina de stări LONG depinde de ordine).
- Variabilele `var` sunt stare persistentă; restul se recalculează la fiecare bară.
- `na` = `NaN`; toate testele de `na` sunt explicite, ca în Pine.
- Funcțiile `ta.ema`, `ta.rma`, `ta.rsi`, `ta.stoch`, `ta.sma`, `ta.atr`, `ta.highest/lowest(+bars)`, `ta.pivothigh/pivotlow`, `ta.valuewhen` reproduc semantica TradingView (detalii în [research.md](research.md) §5). Sunt verificate cu teste față de implementări de referință pe 2000 de lumânări BTC reale.
- `request.security(..., lookahead_off)` pentru Market Structure pe un timeframe superior: pe istoric se vede bara HTF închisă la închiderea barei de chart; pe bara în formare, bara HTF în formare.
- `max_labels_count = 500` este emulat (etichetele cele mai vechi dispar primele).

## Diferențe intenționate față de TradingView
| Ce | De ce |
|---|---|
| Prețurile din etichete/tabel au precizia pieței (ex. `0.00001234`), nu `#.##` | `#.##` afișează `0` pentru monede mici |
| Dacă lumânările HTF nu se pot încărca, Market Structure se ascunde (cu avertisment) | nu inventăm valori |
| Semnalele/alertele de pe lumânarea în formare sunt marcate „neconfirmat” | în TradingView se pot schimba până la închiderea barei |
| Alertele identice pe bare consecutive sunt grupate în listă („× N bare”) | doar afișare; logica de alertare e neschimbată |
| Primele semnale din istoric pot diferi | TradingView pornește calculul de la altă bară; semnalele recente coincid la aceleași date |

## Particularități ale scriptului Pine
Găsite în timpul portării (12 oct 2026).

1. ~~**Urmărirea TP/SL a unui semnal putea fi pierdută.**~~ **Reparată în 3.3** (în Pine și în port). În 3.2, dacă după un LONG confirmat (care încă aștepta TP/SL) se forma un nou „deal” și apoi trendul se întorcea sau minimul V1 era încălcat, nivelurile semnalului deveneau `na` deși semnalul rămânea „urmărit”: tabelul TP/SL arăta `NaN`, iar alertele „ATR Stop Loss Hit” / „Take Profit Signal” nu mai apăreau. Pe 75.000 de lumânări reale: 154 de cazuri, 47 de alerte de stop loss pierdute. Reparația nu schimbă semnalele LONG, culorile lor sau rezultatele din istoric. Detalii: [functional-design.md](functional-design.md) FD-SS33, [technical-design.md](technical-design.md) TD-SS33.
2. **`currentCycleLabel` nu este niciodată setat**, deci blocul „SUCCESS: Remove current signal from danger list” din logica de Take Profit nu rulează niciodată (cod mort, inofensiv; păstrat).
3. **Condiția finală `if waitingLongTP and low < (activeLongSignalLow - storedStopLossAtr) and hideAtrOnStop`** nu poate fi niciodată adevărată: blocul de Stop Loss de mai sus pune deja `waitingLongTP := false` în exact aceeași situație (inofensiv; păstrat).
4. **„ATR Take Profit Hit”** se declanșează la fiecare bară cu maximul peste țintă cât timp semnalul e urmărit (comportamentul standard al `alertcondition`).

## Când actualizezi indicatorul în TradingView
1. Fă diff între versiunea veche și cea nouă a fișierului `.pine`.
2. Aplică aceleași schimbări în `slingshot.ts` (păstrând ordinea instrucțiunilor) și noile input-uri în `params.ts` (cu aceleași valori implicite).
3. Actualizează `SLINGSHOT_VERSION`.
4. Adaugă un test de scenariu pentru comportamentul nou în `slingshot.test.ts` și rulează `npm test`.
