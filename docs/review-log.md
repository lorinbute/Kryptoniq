# Sentiq — Code review log

> Rundele de review pentru fiecare schimbare, în ordinea lucrului (Sentiq se numea Kryptoniq până pe 13 oct 2026). Prima parte, fără titlu propriu, e review-ul versiunii v1.

# Review — v1

Fiecare rundă acoperă tot codul nou + impactul asupra restului. Se repetă până la o rundă cu 0 probleme.

## Runda 1 — 8 probleme (toate reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Grafice / scanner | Se cereau mereu 500 de lumânări HTF; la istoric lung, Market Structure lipsea la începutul graficului | `htfCandleCount()` calculează câte lumânări HTF acoperă tot istoricul (+ încălzirea pivoților) |
| 2 | Detectare monede | Nume CoinGecko dintr-un cuvânt („Core” din „Core CPI”, „Sky”, „Quant”) și titluri TOT CU MAJUSCULE produceau monede false | doar nume CoinGecko din mai multe cuvinte + listă curatoriată; fără tickere „goale” în textul cu majuscule; titlu și rezumat scanate separat |
| 3 | Indicele zilnic | Zilele vechi fără știri erau recalculate la fiecare 2 minute | memorate ca „goale” odată ce nu mai pot primi știri (> 3 zile) |
| 4 | Scanner | Coloana „24h” arăta schimbarea săptămânală pe timeframe 1w | `null` pentru timeframe > 1 zi |
| 5 | Bara de sus / Azi | Ignorau valutele alese în Setări | folosesc `settings.calendar.currencies` |
| 6 | Grafic | Nu urmărea lumânarea nouă când ultima bară era pe ecran | păstrează vizualizarea lipită de marginea dreaptă, ca TradingView |
| 7 | Grafice | Fetch dublu la intrare (BTC, apoi prima monedă din watchlist) | așteaptă watchlist-ul când URL-ul nu are simbol |
| 8 | Documentație | Politica de „rafale” pentru Actual descrisă diferit de implementare | FD/TD aliniate |

## Runda 2 — 10 probleme (toate reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Portofoliu | Preț mediu verificat pe rând de cont (trade/main), nu pe deținerea totală | completitudinea se verifică pe totalul activului din toate conturile |
| 2 | Portofoliu | Fereastra de fills exact 7 zile (limita KuCoin) | 7 zile − 1 minut |
| 3 | API / UI | Mesajele de eroare ale serverului erau în engleză într-o interfață în română | traduse; includ câmpul invalid (`formatIssues`) |
| 4 | Scanner | `POST /api/scanner/run` putea rula în paralel cu job-ul periodic | trece prin scheduler (fără suprapuneri) |
| 5 | Date piață | La căderea exchange-ului graficul dispărea | serverul servește ultimele lumânări bune; `fetchedAt` real → avertisment „date vechi” |
| 6 | UI (toate paginile) | O reîmprospătare eșuată înlocuia datele afișate cu eroarea | datele rămân; banner global când serverul nu răspunde (`/api/ping`) |
| 7 | Sentiment | Fallback-ul local al motorului Claude putea aștepta descărcarea modelului (~170 MB) | scorarea nu așteaptă niciodată descărcarea; pornește încărcarea și folosește regulile |
| 8 | Grafice | Avertismentul HTF clipea cât timp lumânările HTF se încărcau | afișat doar după eșec/răspuns gol |
| 9 | Tranzacții | Un preț mediu manual invalid (ex. „abc”) ajungea `null` și ștergea suprascrierea | validare în formular; gol = ștergere explicită |
| 10 | Tranzacții | (legat de 9) mesaj clar pentru valoare invalidă | adăugat |

## Runda 3 — 7 probleme (toate reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Indicele zilnic | Ziua de ieri se îngheța imediat după miezul nopții, chiar dacă știrile ei erau încă „în analiză” sau veneau cu întârziere | îngheț după 2 h de grație și doar fără știri neevaluate (zilele > 3 zile se îngheață oricum); până atunci snapshot provizoriu |
| 2 | Calendar | Un răspuns gol de la TradingView ștergea toate evenimentele TV din fereastră | răspunsul gol e ignorat |
| 3 | Detectare monede | „ripple effects” devenea XRP (nume insensibile la majuscule) | numele care sunt și cuvinte obișnuite (Ripple, Tether, Ether, Tron) sunt sensibile la majuscule; „bitcoin” rămâne recunoscut |
| 4 | UI | Sume în USD formatate en-US („$2.8T”) lângă numere ro-RO („82.593,1”) | totul în format ro-RO |
| 5 | Știri | Filtre pe monede scoase între timp din favorite rămâneau active (mesaj „Nicio știre despre  …”) | se iau în calcul doar monedele încă favorite |
| 6 | Calendar | Avertismentul „fără date ForexFactory” se baza pe o suprapunere aproximativă a săptămânilor | apare exact când există evenimente venite din TradingView |
| 7 | Calendar | Deselectarea tuturor filtrelor însemna, tacit, „toate” | ultima opțiune nu se poate deselecta |

## Runda 4 — 4 probleme de documentație (reparate), 0 în cod
| # | Problemă | Reparație |
|---|---|---|
| 1 | TD menționa o coloană `news.title_hash` inexistentă | eliminată din TD |
| 2 | Rutele `/ping`, `/sentiment/day/:day`, `/scanner/run` lipseau din TD | adăugate |
| 3 | Tratarea conturilor KuCoin HF și a conturilor trade/main nedocumentată | documentată în TD §10 |
| 4 | TD descria polling-ul calendarului la 10 s și nu menționa păstrarea datelor la erori | aliniat cu implementarea |

## Runda 5 — 2 probleme (găsite la verificarea vizuală, reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Istoric sentiment | La prima pornire, zilele dinaintea instalării (doar backlog-ul feed-urilor) intrau în istoric ca zile complete | istoricul începe cu prima zi de colectare |
| 2 | Azi / istoric 30 zile | Cu puține zile, barele se întindeau pe toată lățimea | 30 de poziții fixe, una pe zi; zilele lipsă rămân goale |

## Runda 6 — 2 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Cod | Funcții nefolosite (`Sparkline`, `daysBetween`, `scoreTone`) | eliminate |
| 2 | Azi | Clasificarea Fear & Greed afișată în engleză | tradusă |

## Runda 7 — trasabilitate FD → implementare: 2 cerințe lipsă (implementate)
| # | Cerință FD | Problemă | Reparație |
|---|---|---|---|
| 1 | §2.1 „Știrile noi apar sus, marcate «nou»” | lipsea marcajul | badge „nou” pentru știrile colectate în ultimele 15 minute (`fetchedAt` în DTO) |
| 2 | §6.3 „Exchange în mentenanță → ultimele date + ora” | o secțiune eșuată apărea goală | ultimele date bune per secțiune, marcate cu ora lor; test nou |

## Runda 8 — 4 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | HTTP | Un timeout apărut în timpul citirii corpului răspunsului ieșea ca eroare generică | mapat la `TIMEOUT` / `NETWORK` |
| 2 | Sentiment (Claude) | Cu o cheie invalidă se retrimitea o cerere la fiecare rulare (20 s) | „siguranță”: cheie invalidă → oprit până la schimbarea cheii; alte erori → pauză 5 min |
| 3 | Sentiment (Claude) | Eroarea Claude era vizibilă doar în log | afișată în Stare sistem și în Setări |
| 4 | Setări | Câmpul de aliasuri se reseta în timpul editării la o reîmprospătare din fundal | resetare doar când aliasurile salvate se schimbă |

## Runda 9 — 2 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Scanner | Calcula indicatorul pe 1000 de lumânări, graficul pe 1500: mașina de stări depinde de istoric, deci „ultimul semnal” putea diferi între scanner și grafic | scanner-ul folosește același număr de lumânări ca graficele (Setări); schimbarea lui repornește scanarea |
| 2 | Scanner | O scanare întreruptă (oprire/timeout) înlocuia rezultatul complet anterior cu unul parțial | se păstrează rezultatul complet anterior |

## Runda 10 — aspecte transversale: 3 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | UI | O eroare neașteptată într-o componentă ar fi lăsat tot ecranul alb | `ErrorBoundary` per pagină (se resetează la navigare) |
| 2 | Operare pe termen lung | Log-urile zilnice nu se ștergeau niciodată | job-ul de întreținere șterge log-urile > 30 de zile; test |
| 3 | Pornire | Pe Node < 24 aplicația ar fi crăpat cu o eroare de sintaxă greu de înțeles | `scripts/check-node.mjs` rulează înainte de `start`/`serve`/`dev` |

## Runda 11 — 1 problemă (reparată)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Accesibilitate | Panoul „Setările indicatorului” nu se închidea cu Escape, nu primea focus și nu era anunțat ca dialog | `role="dialog"`, focus la deschidere, Escape închide, focusul revine pe buton |

## Runda 12 — verificare vizuală desktop + telefon (390 px emulat prin DevTools): 4 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Azi | Graficul zilei se scala proporțional: pe telefon textele axelor deveneau ilizibile | lățime măsurată (ResizeObserver), text la mărime reală, etichete la 6 h pe ecrane înguste |
| 2 | Azi | Istoricul pe 30 de zile păstra raportul de aspect și devenea foarte scund pe telefon | `preserveAspectRatio="none"` (doar bare, fără text) |
| 3 | Setări | Formularele (cheie Claude, retenție) depășeau ecranul la 390 px | se rup pe rândul următor |
| 4 | Layout | Panourile nu se puteau îngusta sub conținutul tabelelor; tabelul de monede nu derula | `min-width: 0` pe panouri, tabel în container derulabil, segmentul de timeframe-uri se rupe pe rânduri |

Verificare finală 390 px: `scrollWidth == clientWidth` pe Azi, Grafice, Știri, Calendar, Tranzacții, Setări.

## Runda 13 — 0 probleme
Recitit tot codul modificat în rundele 10–12; `typecheck` curat, 129/129 teste, build OK, smoke test pe date reale (28/28 surse, 409 știri scorate, calendar, lumânări, scanner, protecții CSRF/DNS-rebinding), capturi desktop pentru toate paginile și 390 px fără depășire orizontală. **Bucla de review s-a încheiat.**

---

# Reparația Slingshot 3.3 (FD-SS33 / TD-SS33), 12 oct 2026
Scop: tot codul nou (gărzile din Pine și din port, testele, fixture-ul, versiunea) și impactul asupra scanner-ului, graficelor, listei de alerte, istoricului semnalelor și documentației.

## Runda 1 — 2 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | FD-SS33 | Nu spunea că rezultatul din istoric și urmărirea TP/SL sunt independente: în scanner pot apărea „LONG …, invalidat” și niveluri TP/SL active (comportament existent și în 3.2, acum mai vizibil) | paragraf nou în „Ce NU se schimbă”, plus aserțiuni în testul „trend flip invalidates”, care confirmă că nivelurile rămân urmărite |
| 2 | research.md §5 | Încă descria scriptul ca fiind 3.2, fără trimitere la 3.3 | notă: cercetarea s-a făcut pe 3.2, semantica rămâne valabilă, iar reparația e în slingshot-port.md |

Verificat fără probleme: Pine (indentare de 4 spații, `waitingLongTP` declarat la l.82 înainte de folosire, fără tab-uri), aceeași ordine a instrucțiunilor în port, `scanner.summarize` (`atr` nu mai poate fi `NaN`), `Charts.tsx`/`CandleChart.tsx`/`Today.tsx` (folosesc `SLINGSHOT_VERSION` sau datele portului, fără „3.2” scris în cod), setările indicatorului (input-uri neschimbate, setările salvate rămân compatibile).

## Runda 2 — 1 problemă (reparată)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | TD-SS33 | Lista testelor omitea testul „trend întors → Take Profit Signal” și noile aserțiuni din „trend flip invalidates” | lista completată (a–e), cu numele fixture-ului |

Recitit: diff-ul Pine, cele 3 gărzi din port, antetele, testele, fixture-ul (JSON valid), FD/TD/slingshot-port/research/user-guide. Fără caractere invizibile. `typecheck` curat, 134/134 teste, build OK.

## Runda 3 — 0 probleme
Recitit tot codul și toată documentația reparației, inclusiv impactul asupra scanner-ului, graficelor, alertelor și setărilor. `typecheck` curat, 134/134 teste, build OK. Smoke test pe date reale: lumânări KuCoin, scanner pe BTC/ETH/SOL fără erori, protecții CSRF/DNS-rebinding. Pine nu se poate compila local; sintaxa gărzilor e identică cu garda deja existentă la l.308 (verificat prin indentare). **Bucla de review s-a încheiat.**

---

# Lansatorul fără Terminal (FD-LAUNCH / TD-LAUNCH), 12 oct 2026
Scop: `scripts/kryptoniq.sh`, `Kryptoniq.app`, opțiunea `KRYPTONIQ_QUIET`, plus impactul asupra pornirii existente (`npm start`/`dev`), log-urilor, securității și documentației.

Verificat înainte de review: ShellCheck 0.11 curat, `bash -n` sub bash 3.2. Scenarii reale în mediul minim al apletului (`env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin`, port de test, date temporare): pornire la rece cu build, pornire când rulează, două porniri simultane (o singură instanță), lacăt vechi, port ocupat de alt program (refuzat la start/stop), Node invalid sau prea vechi, crash la pornire (se afișează doar output-ul pornirii curente), stop/stop repetat, status 0/3, restart, `logs`, port invalid → 4317, argumente greșite, pornire dintr-un pseudo-terminal (serverul în grup de procese propriu). Apletul: compilat, decompilat, semnătură ad-hoc validă; căutarea scriptului testată cu un aplet de test (lângă proiect / mutat).

Pe parcursul testelor am reparat: liniile vechi din log-ul zilei apăreau la o eroare de pornire (acum doar ce a scris pornirea curentă); prefixul „Kryptoniq:” dublat în mesaje; erorile brute ale `mkdir`; rebuild inutil declanșat de `.DS_Store`, teste și fixture-uri.

## Runda 1 — 3 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | `is_up` | Un `~/.curlrc` al utilizatorului (ex. `-o`, `-x`) putea face ca un server pornit să pară oprit, deci s-ar fi încercat a doua pornire | `curl -q` (ignoră `.curlrc`); testat cu un `.curlrc` care conține `-o /dev/null` și un proxy |
| 2 | `status` | Codul de ieșire 1 („pornit, dar nu răspunde”) nu apărea în help și nici în TD | documentat în ambele |
| 3 | Aplet | Rula scriptul direct, deci depindea de bitul de execuție (proiect copiat fără permisiuni → „Permission denied”) | rulează `/bin/bash <script> start`; aplet regenerat și verificat |

## Runda 2 — 3 probleme (reparate, toate în TD-LAUNCH)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | TD, lacăt | Spunea „max 120 s”, iar codul așteaptă 200 s; nu menționa că și `stop` așteaptă o pornire în curs | aliniat cu codul |
| 2 | TD, build | Lipseau `tsconfig.json` din lista de surse și excluderile (`.DS_Store`, teste, fixture-uri) | completat |
| 3 | TD, pornire | Nu descria job control-ul din terminal (Ctrl+C), `KRYPTONIQ_PORT` transmis serverului și faptul că la eroare se arată doar ce a scris pornirea curentă | completat |

Codul recitit integral, fără probleme noi. FD-LAUNCH verificat rând cu rând față de implementare.

## Runda 3 — 2 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Ghid de utilizare | Rândul „Pentru dezvoltare” ajunsese sub subsecțiunea „Pornire fără Terminal” | mutat înapoi în secțiunea generală „Pornire” |
| 2 | Ghid de utilizare | Tabelul de comenzi urma imediat după un paragraf, fără rând gol, deci unele randări Markdown nu îl afișează ca tabel | rând gol adăugat |

Re-rulat tot: ShellCheck curat, `bash -n` (3.2), `typecheck`, 135/135 teste, build, toate scenariile lansatorului, plus oprirea unei instanțe pornite manual (ca `npm start`): recunoscută ca „rulează deja”, oprită curat (exit 0).

## Runda 4 — 0 probleme
Recitit tot ce s-a schimbat (script, aplet decompilat, `config.ts`/`main.ts`, teste, FD/TD-LAUNCH, ghid, README). ShellCheck curat, `typecheck` curat, 135/135 teste, semnătura apletului validă, niciun tabel Markdown lipit de paragraf în docs. **Bucla de review s-a încheiat.** Nu se pot verifica aici (necesită sesiunea macOS a utilizatorului): dublu-click real pe `Kryptoniq.app`, promptul TCC pentru Documents, Login Items.

---

# Redesign „Cockpit” (FD-REDESIGN / TD-REDESIGN), 12 oct 2026
Istoric: prima variantă (recolorare a structurii vechi) a fost respinsă de utilizator înainte de review. Pe canvas-ul Claude Design s-au făcut 3 direcții, utilizatorul a ales **Cockpit**, apoi au urmat machetele pentru toate paginile și implementarea.

Verificat înainte de review:
- capturi headless la 1440 × 900, 1024 și 390 px pentru toate paginile, fără depășire orizontală;
- *Azi* încape pe un ecran la 1440 × 900;
- testul ⌘K prin CDP: deschidere cu Ctrl+K, căutare fără diacritice, perechi de pe exchange, ↑/↓/Enter → `/charts/SOL/USDT`, Esc, „Caută în știri” → `/news?q=fed` cu câmpul completat;
- 143 de teste (noi: `spark.test.ts`, `format.test.ts`).

## Runda 1 — 6 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Azi, eveniment următor | `aria-label` pe un `div` generic (ignorat de cititoarele de ecran, interzis de ARIA 1.2) | eliminat; textul vizibil e suficient |
| 2 | Banda de prețuri | Dacă lumânările unei monede nu se încarcă, prețul rămânea „…” la nesfârșit | „—” cu explicație la hover |
| 3 | Căutare ⌘K | Tab muta focusul în spatele dialogului modal | Tab rămâne în câmp (singurul element focusabil) |
| 4 | Calendar | Fișele fără detalii erau butoane dezactivate (anunțate „indisponibil”) | doar fișele cu detalii sunt butoane, restul sunt conținut simplu |
| 5 | Cod | Rămăsese cod mort din varianta respinsă (`PageHeader`, `ScorePill`, `.page-sub`, `.score-pill`, `.wide`) | șters |
| 6 | Banda + fișele monedelor | Culoarea graficului mic (direcția pe 48 h) putea contrazice procentul afișat (24 h), ex. ETH verde cu −0,89% | culoarea urmează procentul afișat |

## Runda 2 — 3 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Calendar, fișe | Prescurtări ambigue („A” putea fi Actual sau Anterior) | „Act.”, „Prog.”, „Ant.”, cu numele întreg la hover |
| 2 | Calendar, fișe trecute | Estompate prin opacitate, deci textul mic scădea sub 4,5:1 | estompate prin culoare (`text-muted`), fără opacitate |
| 3 | Știri cu relevanță scăzută | Aceeași opacitate (moștenită din v1) contrazicea criteriul de contrast din FD-REDESIGN | titlul e afișat în `muted` și cu greutate normală, fără opacitate |

Recapturat la 1440 / 390 px, fără depășiri; testul ⌘K trece, iar consola nu are erori pe *Azi* și *Calendar*.

## Runda 3 — 1 problemă (reparată)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Grafice, telefon | Tabelul de semnale se strângea pe 390 px, iar coloana „Rezultat” se rupea pe multe rânduri, deci rândurile ieșeau foarte înalte | lățime minimă 680 px și „Rezultat” pe un rând; pe telefon tabelul derulează orizontal |

Restul rundei: `typecheck`, 143/143 teste, build, capturi la 1440 / 390 px (fără depășiri), consola fără erori pe toate cele 7 pagini, fără caractere invizibile.

## Runda 4 — 1 problemă (reparată)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Tabele care derulează orizontal (Setări, Stare sistem, Tranzacții) | Aceeași cauză ca în runda 3: pe telefon tabelele se strângeau, iar celulele cu timp sau stare se rupeau cuvânt cu cuvânt (rânduri de ~5 ori mai înalte) | regulă generală: lățime minimă 640 px pentru tabelele din containere care derulează. Sursele din Setări au 820 px. Celulele cu timp și stare stau pe un rând. Setări pe telefon: de la 5922 la 4037 px |

## Runda 5 — 0 probleme
Recitit modificările din runda 4. Verificări: `typecheck` curat, 143/143 teste, build. Toate cele 7 pagini la 1440, 1024 și 390 px, fără depășire orizontală. Testul ⌘K trece, iar consola nu are erori pe nicio pagină. **Bucla de review s-a încheiat.** Neverificat aici: *Tranzacții* cu un cont KuCoin real (fără cheie, se vede doar ecranul de început).

---

# Reparație: pagină neagră în Safari după un build (FD-STATIC / TD-STATIC), 12 oct 2026
Diagnostic: serverul utilizatorului răspundea corect, iar pagina se randa complet în Chrome și în WebKit (Playwright). Safari nu avea nicio conexiune activă spre aplicație. Fereastra privată mergea, iar ⌥⌘R a rezolvat. Cauza: `@fastify/static` cu `wildcard: false` nu servea fișierele create după pornire, iar fallback-ul SPA trimitea `index.html` (200, HTML) în locul noilor module JS.

Verificat: test de regresie în `server.test.ts` (asset nou după pornire → 200; asset lipsă → 404 text `no-store`; `/`, `/news`, `/charts/BTC/USDT`, `/news?q=a.b` → pagina cu `no-store`; `/api/nope` → 404 JSON). Scenariu real: server pornit, build cu o schimbare (hash nou), fără repornire: noul entry → 200 JavaScript, vechiul → 404 text, iar pagina se randează în WebKit. `typecheck`, 144/144 teste.

## Runda 1 — 0 probleme
Recitită schimbarea din `app.ts`. Rutele `/api/*` explicite au prioritate față de wildcard (testul de securitate și cel de 404 JSON trec). `GET /` are rută proprie, pentru că directorul ar primi 403. Cererile HEAD și DNS-rebinding / CSRF rămân neschimbate (testele existente trec). O filă veche care cere un chunk vechi primește 404 și ajunge în ErrorBoundary, comportament documentat în FD-STATIC. **Bucla s-a încheiat.**

---

# Iconițe, bandă cu derulare automată, cursor, data în Știri (FD-ICONS / TD-ICONS), 12 oct 2026
Verificat înainte de review:
- **Teste:** 152 (noi: `icons.test.ts` pe titluri reale, `/api/logo` cu alias / 404 / simboluri nesigure, `drivers` cu categorie și monede).
- **Verificări prin CDP:**
  - banda se mișcă (~40 px/s) și se oprește la hover;
  - copiile pentru buclă sunt `inert`;
  - cursorul e de tip mână pe link-uri, butoane, filtre, selectoare, `summary` și căsuțe;
  - logo-urile se încarcă, iar INJ și 2Z primesc insignă;
  - la „Ieri”, data se suprapune cu titlul în 0 din 47 de știri.
- **Capturi** la 1440 / 390 px: Azi, Știri, Calendar, Grafice, Setări.

## Runda 1 — 3 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Iconițe de subiect | „Justice Department investigates…” ieșea „geopolitică” (glob), deși e despre justiție | regula „reglementare și justiție” include DOJ, „investigates”, „probe”, „antitrust”; test |
| 2 | Iconițe cu tooltip | Învelișurile cu `title` nu erau `aria-hidden`, deși FD spune că iconițele sunt decorative | `aria-hidden` (tooltip-ul rămâne la hover) |
| 3 | TD-ICONS | Pomenea un fișier `components/CoinLogo.tsx` inexistent | corectat: `CoinLogo` în `components/icons.tsx` |

## Runda 2 — 0 probleme
Același domeniu ca runda 1 (tot codul nou + impactul asupra paginilor existente), după reparații:
- `tsc` curat, 152 de teste trec, build OK.
- CDP: banda se mișcă și se oprește la hover; cursor de tip mână pe toate elementele clicabile verificate; logo-urile se încarcă; „Ieri” nu se mai suprapune cu titlul (0 din 47); ⌘K arată iconițe și logo-uri.
- Capturi 1440 / 390 px fără depășire orizontală pe Azi, Știri, Calendar, Grafice, Tranzacții, Setări.
- Singurul mesaj din consolă: `404` pentru `/api/logo/INJ` și `/api/logo/2Z`. E comportamentul descris în FD-ICONS (monedă fără logo → insignă cu inițiale); răspunsul 404 e cache-uit o zi, deci nu se repetă la fiecare afișare.

---

# Review — FD-RATELIMIT / TD-RATELIMIT (limita KuCoin 429000, prețuri, încărcarea piețelor)

Domeniu: `exchange/retry.ts` (nou), `exchange/accounts.ts` (reîncercări, prețuri comune, prețuri individuale, ultimele prețuri bune, pauză după refuz, `ensureMarkets`), `market/market.ts` (reîncercări, `loadMarkets(true)`, fără `fetchTickersFees`), `context.ts`, `pages/Trades.tsx`, teste și documentație. Impact verificat asupra: grafice, banda de prețuri, carduri Azi, scanner, ⌘K (căutare de perechi), Setări → conturi („Testează conexiunea”), Tranzacții.

Verificări:
- `tsc` curat; 160 de teste trec.
- Testele noi verificate prin mutație.
- Rulare cu ccxt real contra KuCoin real, cu `allTickers` refuzat artificial: prețuri corecte una câte una, fără eroare.
- Graficele se recuperează după o încărcare a piețelor eșuată.
- Server de test: lumânări pentru BTC / ETH / RENDER / INJ / 2Z; în consolă doar 404-urile de logo așteptate.

## Runda 1 — 2 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | `accounts.ts` | Dacă lista de piețe a unui client nu se încărca, ccxt repeta instant eroarea la fiecare citire, iar reîncercările (1,5 s + 4 s fiecare) doar adăugau așteptare: până la ~30 s pe o încărcare de portofoliu, fără nicio cerere utilă | `retryOn`: citirile unificate se reîncearcă doar dacă clientul are piețele; test nou (o singură citire, eroare `RATE_LIMIT`) |
| 2 | Ghidul utilizatorului | Noul mesaj de pe Tranzacții nu era explicat în „Probleme frecvente” | rând nou în tabel |

## Runda 2 — 1 problemă (reparată)
Același domeniu complet. Am verificat și o suspiciune care s-a dovedit falsă: după o reîncărcare a piețelor eșuată, ccxt **nu** repetă eroarea dacă piețele vechi există. Metodele cheamă `loadMarkets()` doar când `markets` lipsește (KuCoin 95/95, Binance 85/85, Bybit 76/76, OKX 71/71), iar cu ccxt real `fetchOHLCV` și `fetchTicker` merg. TD-ul e acum precis în această privință.

| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | `market.ts` | O reîmprospătare zilnică a piețelor eșuată era reîncercată la **fiecare** cerere de lumânări, cu ~4 s de așteptare în plus (din cauza reîncercărilor noi), cât timp dura problema la exchange | piețele vechi rămân, iar reîncărcarea se reîncearcă după 5 min (`MARKETS_RETRY_MS`); test nou, verificat prin mutație |

## Runda 3 — 0 probleme
Același domeniu complet, recitit cap-coadă după reparații: `retry.ts`, `accounts.ts` (`retryOn`, `ensureMarkets`, `tickerSnapshot`, `singlePrices`, căderea pe prețuri vechi), `market.ts` (`loadMarkets(true)`, pauza de 5 min, mesajele), `context.ts`, `Trades.tsx`, testele și documentația.
- Promisiunile respinse sunt toate tratate: `snapshotP` are ambele ramuri, iar apelanții concurenți primesc aceeași promisiune.
- Încărcările de piețe simultane se deduplică: ccxt cu `reloadingMarkets`, `MarketData` cu `marketsLoading`.
- Erorile de cheie (`AUTH`, inclusiv `loadMigrationStatus` din `fetchMarkets` cu o cheie greșită) nu se reîncearcă și duc, ca înainte, la ștergerea clientului.
- `tsc` curat; 161 de teste trec; build OK.
- Server de test repornit: Azi, Grafice, Tranzacții, Știri, Calendar și Setări fără erori în consolă (în afară de 404-urile de logo descrise în FD-ICONS); fără WARN / ERROR în jurnal.

---

# Review — FD-CHARTUX / TD-CHARTUX (grafic fără grilă și linii de cursor, setări ținute minte, LMA, ecran complet)

Domeniu, la fiecare rundă:
- **Cod nou:** `shared/indicator/lma.ts`, `lma-params.ts`, `pine.ts` (`RollingSum`, `Wma`), `shared/settings.ts` (`lma`, `charts`), `web/chart/CandleChart.tsx`, `primitives.ts` (`GradientFill`, `EdgeLabel`), `prefs.ts`, `view-store.ts`, `fullscreen.ts`, `pages/Charts.tsx`, `App.tsx` (⌘K), `pages/Settings.tsx` (eticheta), teste, FD / TD / ghid.
- **Impact verificat asupra:** Slingshot (nor, LONG, TP/SL, Market Structure, tabel), Pozițiile mele, scanner, ⌘K, meniu și bandă, Setări (timeframe), serverul de setări (`salvage`, nudge scanner).

Verificări:
- `tsc` curat; 180 de teste trec, între care portul LMA comparat cu o implementare de referință scrisă direct din Pine, pe 600 de bare BTC, pentru 5 tipuri de netezire × 3 preseturi.
- **CDP (Chrome):**
  - fără grilă, fără linii sub cursor;
  - legenda urmează cursorul;
  - perechea, timeframe-ul, comutatoarele și zoom-ul rămân după navigare și după reîncărcare;
  - ecranul complet nativ funcționează; Esc iese; ⌘K iese din ecran complet;
  - preseturile blochează câmpurile; ascunderea din legendă merge;
  - o pereche greșită nu e reținută;
  - consola e curată.
- **WebKit:**
  - ecranul complet nativ și Esc merg;
  - modul de rezervă (refuz simulat, 390 px): Esc închide întâi sertarul, apoi ecranul complet; `overflow` se reface.

## Runda 1 — 6 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | `CandleChart` | Canvas-urile bibliotecii (`z-index` 1–2) acopereau legenda LMA, deci butoanele nu răspundeau. Separatorul de panouri (`z-index` 49–50) putea apărea peste meniul fix și peste sertar | `isolation: isolate` pe gazda graficului |
| 2 | `fullscreen.ts` | În modul nativ, un Esc ajuns la pagină era ignorat | Esc iese și în modul nativ (cu aceeași regulă pentru sertarul deschis) |
| 3 | `CandleChart` | Lățimea zonei de desen (pentru tabelul TP/SL și legendă) nu se recalcula când scala de preț se lățea | recalculare și pe `timeScale().subscribeSizeChange` |
| 4 | `Charts.tsx` (impact) | La o pereche inexistentă, „Semnale” rămânea la nesfârșit pe „Se încarcă…” | mesaj „lumânările nu s-au putut încărca” |
| 5 | Legendă LMA pe telefon | Rândul se rupea, iar butoanele ajungeau peste linie | parametrii se ascund sub `sm` |
| 6 | FD | „LMA apare de la prima bară” era inexact (apare după netezire, iar încălzirea ține ~`period`+10 bare) | text corectat |

## Runda 2 — 2 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | `fullscreen.ts` | Un dublu-click pe „Ecran complet” putea porni a doua cerere; dacă aceea era respinsă, aplicația trecea în modul css deși browserul era deja în ecran complet nativ (starea aplicației ≠ starea browserului) | o singură cerere pe rând (`entering`); starea finală se citește din `fullscreenElement`; verificat în WebKit cu dublu-click |
| 2 | Sertarul „Indicatori” | Filele aveau `aria-pressed`, atribut nepermis pentru `role="tab"`, și nu se navigau cu săgețile | stilul `.seg` acceptă și `aria-selected`; `tabIndex` pe fila activă; ← / → schimbă fila și mută focusul |

## Runda 3 — 1 problemă (reparată)
Recitire completă a codului nou. Verificat suplimentar: tragerea separatorului salvează înălțimea panoului LMA (0.25 → 0.397) și o reaplică după reîncărcare (rânduri 392/259 → 393/258 px).

| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | `Charts.tsx` (compatibilitate) | Raportată de utilizator: „Pagina nu a putut fi afișată — undefined is not an object (evaluating 'n.data?.charts.symbol')”. Interfața nouă e servită imediat după build, dar serverul pornit înainte nu trimite grupurile `charts` / `lma` | valorile implicite completează ce lipsește, iar accesul la `charts` e opțional; verificat prin CDP cu un răspuns `/api/settings` fără `charts` / `lma`: pagina se afișează, fără excepții |

## Runda 4 — 2 probleme (reparate)
Domeniu: tot ce e mai sus, plus două extinderi cerute între timp de utilizator:
- §7: setările LMA ca în TradingView (fila Style, culorile pe un rând, (i));
- §8: triunghiuri pentru LONG / TAKE PROFIT.

Probleme găsite:
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Formularul indicatorilor | Iconița (i) era în interiorul etichetei, cu `role="img"` și tooltip-ul întreg ca nume; numele accesibil al câmpului devenea tot textul tooltip-ului | (i) e `aria-hidden` (tooltip doar la hover); textul devine descrierea controlului (`title`) |
| 2 | Sertarul „Indicatori” | Formularul derulat ajungea lipit de file, fără separare | separator sub file |

Verificări:
- teste noi pentru schema Style: valori implicite, limite, valori salvate înainte de Style;
- formularul Style schimbat și salvat prin CDP (prag long ascuns, prag short punctat, fără umplere, grosime 1), cu efectul vizibil pe grafic;
- triunghiurile LONG / TAKE PROFIT verificate pe captură (SOL 4h).

Raportat de utilizator în aceeași perioadă, „nu reține ce grafic aveam selectat”: cauza era serverul aplicației lui, pornit înainte de această versiune. Serverul vechi ignora grupul `charts`, iar interfața nouă era deja servită. Aplicația utilizatorului a fost repornită (`scripts/kryptoniq.sh restart`) și acum trimite `charts`. Pe serverul de test, perechea se reține după navigare și după reîncărcare (pașii 3–5 din verificarea CDP).

## Runda 5 — 0 probleme
Același domeniu complet (inclusiv §7 Style și §8 triunghiuri), după reparațiile din runda 4.
- `tsc` curat; 180 de teste trec; build OK.
- **Chrome (CDP), 11 pași, toți corecți:**
  - `/charts` → prima favorită; legenda urmează cursorul;
  - pereche, timeframe, „Pozițiile mele” și zoom păstrate după navigare și reîncărcare;
  - ecran complet nativ, Esc, ⌘K din ecran complet;
  - sertar LMA cu preset Scalping (câmpuri blocate, salvare); legenda arată presetul; ascunderea merge;
  - starea de pe server e corectă; consola e curată.
- Consola e curată și pe Azi, Știri, Calendar, Grafice, Tranzacții, Setări și Stare sistem (în afară de 404-urile de logo descrise în FD-ICONS).
- **WebKit:**
  - ecranul complet nativ: Esc al browserului iese;
  - modul de rezervă la 390 px: primul Esc închide sertarul, al doilea iese, `overflow` se reface;
  - dublu-click stabil; file cu ← / →.
- O eroare intermitentă la pasul 9 a fost atribuită atunci scriptului de test. **Corectură (runda 6):** era o problemă reală a aplicației, descrisă mai jos.


## Runda 6 — 2 probleme (reparate)
Găsite la regresia repetată (prin instrumentarea pasului 9: sub rotiță era fundalul căutării ⌘K, încă deschisă).

| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | ⌘K din ecran complet | Ieșirea din ecranul complet nativ și deschiderea căutării au loc deodată; uneori focusul nu ajungea în câmpul de căutare, deci tastarea și Esc nu ajungeau la căutare și ea rămânea deschisă peste grafic | căutarea pune din nou focusul în câmp la `fullscreenchange` și închide la Esc și când focusul e în altă parte; 3 regresii la rând trec; WebKit: ⌘K din ecran complet → focus în căutare, „eth” scris, Esc închide |
| 2 | Esc cu straturi | Cu sertarul de setări deschis și căutarea ⌘K deasupra, un Esc le închidea pe amândouă | sertarul și ecranul complet ignoră un Esc deja folosit (`defaultPrevented`); WebKit: primul Esc închide căutarea, al doilea sertarul |


## Runda 7 — 0 probleme
Același domeniu complet, după reparațiile din runda 6 (inclusiv `CommandPalette`, singurul fișier din afara paginii Grafice atins de această rundă).
- `tsc` curat; 189 de teste trec; build OK.
- Regresia Chrome (11 pași) trece de 5 ori la rând, inclusiv pasul 9 (rotița după ecran complet + ⌘K).
- Testul ⌘K existent (navigare cu săgeți, Enter, Esc, căutare în știri) trece.
- **WebKit:** ⌘K din ecran complet; Esc pe straturi (căutare, apoi sertar); ecranul complet nativ și cel de rezervă; dublu-click.
- Consola e curată pe toate paginile, în afară de 404-urile de logo (INJ, 2Z, RLUSD), comportamentul descris în FD-ICONS.

---

# Review — FD-PNL / TD-PNL (PnL la SL / TP / prețul curent pentru poziția KuCoin)

Domeniu: `exchange/accounts.ts` (`stop`, `stopDirection`), `web/chart/pnl.ts` (nou), `CandleChart` (`PriceLineSpec.lineVisible` / `axisLabelVisible`), `Charts.tsx` (`usePositionLines`), teste, FD / TD. Impact verificat asupra: liniile „Pozițiile mele” existente (lichidare, alte ordine, prețul mediu spot), pagina Tranzacții (tipul `OrderRow` are un câmp nou), triunghiurile și LMA.

Verificări:
- `tsc` curat; 188 de teste trec (noi: clasificarea SL / TP pentru long, short și spot, TP parțial, direcție necunoscută, două trade-uri, cont numit, formatul textului, `stopDirection`).
- Captură cu o poziție INJ long simulată (răspunsuri `/api/accounts` și `/api/portfolio/1` înlocuite prin CDP): TP „+3,69 USDT (+9,7%)” la 8,359, SL „−1,14 USDT (−3,0%)” la 7,392, intrare, lichidare și „PnL −0,41 USDT (−1,1%)” la prețul curent; fără erori în consolă.

## Runda 1 — 2 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | PnL la prețul curent | Cu `axisLabelVisible: false`, biblioteca nu desena deloc titlul liniei: eticheta „PnL …” lipsea (văzut pe captură) | eticheta de pe axă rămâne (linia nu); biblioteca o deplasează ca să nu acopere eticheta prețului |
| 2 | Mai multe conturi | Trade-uri pe aceeași monedă în două conturi dădeau linii cu etichete identice | numele contului apare în etichete când sunt mai multe conturi; test |

## Runda 2 — 1 problemă (reparată)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | `pnl.ts` (spot) | Un rest mic de monedă în spot, cu preț mediu, adăuga pe grafic linii „Intrare spot” și „PnL” fără sens | deținerile spot cu valoare sub 1 (în moneda de cotare) sunt ignorate (`DUST_VALUE`); test; rând nou în FD |

## Runda 3 — 0 probleme
Recitire completă (`pnl.ts`, `usePositionLines`, `stopDirection`, tipurile `OrderRow` / `PriceLineSpec`) după rundele 1–2.
- Ordinele fără direcție de la un server vechi (`stop` lipsă) folosesc rezerva după prețul curent.
- Liniile se recalculează la fiecare preț nou; aceeași cheie JSON evită redesenarea când nu se schimbă nimic.
- 189 de teste trec.
- Captura cu poziția simulată arată SL, TP, intrarea, lichidarea și PnL-ul curent, fără erori.
- Regresia completă a graficelor trece.

---

# Review — FD-SENTIQ / TD-SENTIQ (acțiuni, conturi prin wizard, redenumire în Sentiq)

Domeniu (fără restrângere): tot codul nou sau schimbat de FD-SENTIQ și impactul asupra funcțiilor existente.
- Server: `config` / `log` / `security` / launcher (redenumire), migrarea 2 și rularea migrărilor, `shared/providers.ts`, `exchange/accounts.ts` (conectare, adaptor ccxt generic, brokeri), `exchange/brokers.ts`, `net/http.ts` (`httpRequest`), `market/stocks.ts`, `market/stock-context.ts`, `news/*` (surse, detector, clasificare, filtre), `calendar/service.ts` (rezultate), `scanner`, `settings` (cheia Twelve Data), rute și joburi.
- Web: wizard-ul, `ProviderLogo`, Setări (conturi, favorite, cheia Twelve Data, surse), Tranzacții, Grafice (acțiuni, PnL), banda, Azi, Știri, Calendar, ⌘K, Stare sistem, adrese.
- Impact verificat asupra: graficelor crypto (rută `/charts/S/USDT`, timeframe salvat, zoom, PnL KuCoin), știrilor crypto (detector, `$SPX`), calendarului macro (filtre de valută, rafale TradingView), sentimentului zilei (defalcare), conturilor KuCoin vechi, CSRF și variabilelor vechi.

## Runda 1 — 16 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | eToro | Valoarea și PnL% ale deținerilor se calculau din `openRate × units` (moneda instrumentului), amestecate cu PnL-ul în USD: greșit pentru o acțiune în EUR | valoarea = suma investită + PnL, procentul din suma investită (ambele USD); test cu o acțiune în EUR |
| 2 | Conectare | O excepție în timpul testului (ex. client care nu se poate construi din chei) lăsa contul salvat pe jumătate | contul se șterge la orice eșec al testului |
| 3 | Kraken / Coinbase | Prețurile se căutau doar în USDT / USDC: monedele listate doar în USD rămâneau fără valoare | USD e a treia monedă de cotare; test (pică fără reparație) |
| 4 | Coinbase | O cheie privată copiată din fișierul JSON descărcat are „\n” scris literal: cheia ar fi fost invalidă | câmpurile pe mai multe rânduri refac rândurile; test |
| 5 | Tranzacții | Insignele acțiunilor erau rotunde, nu pătrate ca în restul aplicației | `square` peste tot la brokeri |
| 6 | Tranzacții | Mesajele de eroare spuneau „exchange-ul” și la brokeri | textul folosește „brokerul” pentru conturile de acțiuni |
| 7 | Tranzacții | O monedă crypto ținută la eToro / IBKR / Alpaca ducea spre graficul unei acțiuni inexistente | `BalanceRow.crypto` din adaptoare (tipul eToro, `CRYPTO` la IBKR, `asset_class` la Alpaca, cu `BTCUSD` → `BTC`); link spre graficul crypto; teste |
| 8 | `/api/stocks/quotes` | Cotațiile se cereau pe rând (până la 50 de cereri secvențiale la prima încărcare) | câte 5 în paralel, ordinea păstrată |
| 9 | Știri | Filtrul pe simbol ignora simbolurile cu punct (BRK.B) | modelul acceptă `.` și `-`; test |
| 10 | Preț mediu manual | Ruta respingea simbolurile cu punct (BRK.B, SAP.DE), deși serviciul le accepta | același model ca serviciul; test |
| 11 | Tranzacții | Adresa prețului mediu manual nu era codată; un instrument eToro fără simbol („#1234”) avea link și editor stricate | `encodeURIComponent`; fără link și editor pentru „#…” |
| 12 | Cheia Twelve Data | Cheia era trimisă la Twelve Data (o cerere din buget) înainte de verificarea formatului | formatul se verifică întâi; test că nu pleacă nicio cerere |
| 13 | Redenumire | Iconița din tab desena încă „K” | „S” în același stil |
| 14 | Brokeri | Un timeout sau o conexiune căzută apărea ca „eroare de la broker” | `HttpError` → `NETWORK`, în secțiuni și la test; test |
| 15 | Scanner | Rândurile acțiunilor se refoloseau după schimbarea parametrilor Slingshot (cu bursa închisă, până la redeschidere) | cache-ul ține și semnătura parametrilor; teste pentru fallback-ul 1d, ritmul de 30 min și bursa închisă (pică fără reparație) |
| 16 | Azi și banda | Monedele apăreau mereu înaintea acțiunilor, ignorând ordinea din Setări | afișare în ordinea favoritelor |

Verificări după reparații: `tsc` curat; 254 de teste trec; build OK; captură Azi cu ordinea AAPL, BTC, …; FD completat cu cazurile noi (eToro în EUR, crypto la broker, „#1234”, USD la Kraken / Coinbase, cheia Coinbase din JSON, ordinea favoritelor).

## Runda 2 — 2 probleme (reparate)
Același domeniu, recitit complet după runda 1 (server, web, lansator, documente).
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Grafice de acțiuni (FD §4.3) | Când bugetul Twelve Data se termina (sau Nasdaq nu răspundea), serverul dădea în tăcere ultimele lumânări: lipsea mesajul „limita Twelve Data atinsă, revine …” | `CandlesResult.notice` cu motivul; graficul arată „Se afișează lumânările primite acum 7 min, pentru că …”; test; captură cu răspunsul simulat |
| 2 | Sentiment | Feed-ul „Nasdaq Stocks” are și articole despre mărfuri (porumb, zahăr); cu relevanță 1 cântăreau cât știrile despre acțiuni | la categoria Acțiuni: relevanță 1 pentru o acțiune etichetată sau termeni de piață, altfel 0,8 (ca la Macro); test; TD actualizat |

Verificări: `tsc` curat; 254 de teste trec; build OK; regresia graficelor crypto (11 pași) trece, consola curată; interacțiunile pentru acțiuni (⌘K → TSLA, timeframe-uri dezactivate cu explicație, MSFT din căutarea graficului, `/charts/S/USDT` = Sonic, MSFT adăugat din Setări cu alias „Microsoft”, ancora `#market`, cipul „Rezultate companii”) trec, fără erori; scanner-ul pe serverul de test: acțiunile pe 1d cu `STOCK_TF_FALLBACK`, monedele pe 1h.

## Runda 3 — 2 probleme (reparate)
Același domeniu complet, recitit după runda 2.
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Graficul unei acțiuni | Variația din antet apărea „+1,29% azi” și noaptea / în weekend, când e variația ultimei ședințe | „la închidere” cât bursa e închisă, „azi” în rest; captură |
| 2 | TD-SENTIQ | Ruta `GET /api/stocks/info`, câmpul `notice` și ordinea verificării cheii Twelve Data lipseau din descriere | TD §5 completat |

Verificat și fără probleme: sursa „Investing.com Stock News” primește puține știri noi pentru că aceleași articole vin întâi prin feed-ul general Investing (deduplicarea normală); lansatorul recunoaște și un server pornit cu vechiul nume (după port și comandă); `tsc` curat, 254 de teste, build OK.

## Runda 4 — 1 problemă (reparată)
Același domeniu complet, plus verificări transversale: `tsc --noUnusedLocals --noUnusedParameters`, căutare de `console.log` / `TODO` rămase, diacritice cu sedilă, securitatea rutelor noi (GET fără efecte; `PUT /api/settings/twelvedata-key` trece prin CSRF și Host), construirea adreselor externe (simbolurile sunt filtrate de `STOCK_SYMBOL_RE` și codate; adresa IBKR e verificată; paginarea Trading 212 rămâne pe gazda brokerului), cheile (criptate; nu apar în jurnale sau în mesajele de eroare), textele de instrucțiuni ale celor 11 furnizori.
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | `accounts.ts` | Import rămas nefolosit (`formatIssues`) după rescrierea validării conturilor | scos |

(`storedHighestBar` din portul Slingshot e din afara domeniului: variabila există și în Pine.) `tsc` curat; 254 de teste; build OK.

## Runda 5 — 1 problemă (reparată)
Același domeniu complet; în plus, toate verificările automate pe build-ul final: ⌘K (navigare, Enter, Esc, căutare în știri, perechi și acțiuni pentru „sol”), wizard-ul (15 carduri, 4 fără API, niciun logo stricat, validarea IBKR, Esc), Tranzacții cu un portofoliu eToro simulat (acțiune, monedă, instrument „#9999”, secțiune cu limită de cereri) la 1440 și 390 px.
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Tranzacții | Prețurile acțiunilor apăreau cu 4 zecimale („340,9700”, „320,0000”), altfel decât pe grafic | la conturile de acțiuni: 2 zecimale (4 sub 1 $); monedele ținute la broker își păstrează zecimalele; capturi |

## Runda 6 — 1 problemă (reparată)
Același domeniu complet, cu atenție la consumul surselor externe (Twelve Data, Nasdaq, CNN, brokeri) în fiecare stare a bursei.
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Bugetul Twelve Data | Lumânările intraday citite cu bursa închisă rămâneau valabile doar dacă Nasdaq raporta o deschidere viitoare. Seara (20:00–24:00 ET), în pre-market, în after-hours și probabil în weekend (când „ora de deschidere” raportată e în trecut), un grafic deschis ar fi cerut Twelve Data la fiecare minut fără date noi: sute de cereri pe noapte din cele 800 | lumânările citite în afara ședinței regulate rămân valabile până la deschidere (sursele dau doar barele ședinței); „Date vechi” nu mai apare în acest interval; eticheta variației spune „la închidere” și în pre-market; test pe un weekend cu „ora de deschidere” în trecut, pre-market, deschidere și TTL-ul din timpul ședinței; TD și ghidul actualizate |

`tsc` curat; 254 de teste; build OK.

## Runda 7 — 2 probleme (reparate)
Același domeniu complet; inventarul tuturor cererilor periodice spre surse externe (joburi, bandă, Azi, grafice, Tranzacții) în fiecare stare a bursei.
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Cotații Nasdaq | Se cereau la fiecare minut și noaptea / în weekend, când nu se schimbă: cu aplicația deschisă toată ziua, mii de cereri pe zi (risc de blocare de către Nasdaq) | 15 min cât bursa e închisă (starea are cel mult 10 min), 1 min în rest; test |
| 2 | „Pozițiile mele” | Pe un grafic crypto se cereau la fiecare minut și portofoliile brokerilor (și invers), deși nu se afișau: cereri inutile spre API-uri cu limite (Trading 212, eToro) | se cer doar portofoliile conturilor potrivite tipului de grafic; numele contului apare când sunt mai multe conturi potrivite |

`tsc` curat; 255 de teste; build OK. TD actualizat.

## Runda 8 — 1 problemă (reparată)
Același domeniu complet, cu accent pe ce se întâmplă când o sursă externă cade pentru mult timp.
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Starea bursei | Dacă API-ul Nasdaq pentru starea bursei cădea, ultima stare cunoscută se păstra fără limită: un „închis” de vineri seara ar fi ținut luni lumânările nemodificate (cache valabil „până la deschidere”), rândurile scanner-ului vechi, iar banda ar fi arătat „Bursa SUA închisă” | `confirmedStatus()`: starea contează doar dacă e confirmată în ultimele 15 min, altfel e necunoscută (TTL normal); folosită de lumânări, scanner, contextul din bandă și `/api/stocks/info`; test (Nasdaq „închis” vineri, apoi căzut până luni → graficul se reîmprospătează) |

`tsc` curat; 256 de teste; build OK; serverul de test răspunde corect la `/api/stocks/info`, lumânări NVDA 1w, cotații.

## Runda 9 — 2 probleme (reparate)
Același domeniu complet, plus o verificare punct cu punct a FD-SENTIQ §1–§5 față de cod.
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | FD §5 „Simbol schimbat / delistat” | Eroarea pentru o acțiune pe care sursa nu o știe nu avea „sugestii din căutare” | `StockData.candles` adaugă cele mai apropiate simboluri listate („FB nu are istoric la Nasdaq; încearcă META”); test |
| 2 | FD §2, avertismentul de permisiuni | Permisiunile cheii se citeau doar la KuCoin; la Binance, Bybit, OKX și Bitget o cheie cu tranzacționare sau retragere nu primea avertismentul promis | `keyPermissions`: endpoint-ul de permisiuni al fiecărui exchange (formatele verificate în documentația Binance, Bybit, OKX; la Bitget, unde formatul v2 nu e confirmat, doar numele recunoscute, fără alarme false); teste, inclusiv o cheie Binance cu retrageri conectată prin API |

FD aliniat cu butonul real („Altă platformă”). `tsc` curat; teste trec; build OK.

## Runda 10 — 1 problemă (reparată)
Același domeniu complet, plus FD §1 (redenumirea) punct cu punct: vechiul `Kryptoniq.app` rulează `kryptoniq.sh start`, care trece prin scurtătura spre `sentiq.sh` (verificat decompilând aplicația); variabilele vechi, baza de date, cheile și preferințele din browser rămân.
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Sugestii pentru un simbol necunoscut | Ordinea venea de la căutarea Nasdaq: pentru „APPL” ieșea „AADX, AAOI, AAPL” | sugestiile se ordonează după distanța de scriere („APPL” → AAPL, APLE, AADX); test |

`tsc` curat; 259 de teste; build OK; pe serverul de test „APPL” dă acum sugestiile în ordinea nouă.

## Runda 11 — 0 probleme
Același domeniu complet, recitit după rundele 6–10, cu efectele reparațiilor asupra restului aplicației (regula sesiunii și starea confirmată în lumânări, scanner, bandă și `/api/stocks/info`; cotațiile cu bursa închisă; portofoliile cerute doar pentru tipul de grafic, inclusiv cu un server vechi fără `kind`; permisiunile KuCoin neschimbate; sugestiile pentru simboluri necunoscute).
- `tsc` curat (și cu `--noUnusedLocals --noUnusedParameters`, în afara variabilei din portul Pine); 259 de teste trec; build OK; ShellCheck curat.
- Regresia graficelor crypto (11 pași) trece, consola curată; interacțiunile pentru acțiuni trec (⌘K, timeframe-uri, căutarea graficului, `/charts/S/USDT`, favorite din Setări, `#market`, „Rezultate companii”), fără erori.
- Capturi la 390 px pentru Azi, graficul AAPL, Calendar, Știri, Tranzacții și Setări: fără depășiri pe orizontală.
- Pe serverul de test: lumânări Nasdaq 1d / 1w, cotații, context (S&P 500, Nasdaq 100, VIX, F&G CNN, starea bursei), rezultatele BAC în calendar, feed-uri Nasdaq pe acțiune, scanner cu acțiuni pe 1d, sugestii „APPL” → AAPL.

## Iconița Sentiq în site (13 oct 2026) — runda 1: 0 probleme
Domeniu: `public/brand/*` (generate din PNG-ul de 1024 px primit), `index.html` (iconițele), `App.tsx` (`Monogram`), FD / TD.
- Variantele mici verificate mărite pe fundal închis și deschis: lizibile și la 16 px; iconița pentru ecranul principal e opacă (colțurile `#07090E`).
- Serverul servește `/brand/*.png` cu `image/png`; build-ul le include; meniul arată iconița la 1440 și 390 px, fără depășiri pe orizontală; `tsc` curat.
- De reținut: sursele (PNG-ul de 1,9 MB și `Sentiq.icon`) stau în `public/`, deci intră și în build; fără efect pentru o aplicație locală.

## Iconița pe Sentiq.app (13 oct 2026) — runda 1: 0 probleme
Domeniu: `scripts/sentiq.sh` (`cmd_app`), `scripts/app-icon/` (fișiere compilate + `build.sh`), FD / TD / ghid.
- ShellCheck curat pe `sentiq.sh`, `kryptoniq.sh`, `app-icon/build.sh`; `build.sh` rulează și reface aceleași fișiere.
- `scripts/sentiq.sh app`: `CFBundleIconFile` / `CFBundleIconName` = `Sentiq`, `applet.icns` scos, `Assets.car` cu iconița Sentiq (fără alte resurse ale appletului de pierdut: catalogul vechi avea doar iconița generică), semnătura validă, identitatea `com.dustyinvestments.sentiq.launcher` păstrată (permisiunea pentru Documents rămâne legată de ea).
- Iconița afișată de macOS (`NSWorkspace.icon(forFile:)`) e cea nouă; varianta `.icns` pentru sisteme vechi are forma și marginile standard macOS.
- Fără fișierele din `scripts/app-icon/`, aplicația se creează tot, cu iconița generică și un mesaj.

---

# Review — FD-CHARTFAV / TD-CHARTFAV (bifa Slingshot, favoritele reordonate prin tragere)

Domeniu: `shared/settings.ts` (`charts.showSlingshot`), `Charts.tsx` (bifa, `result` / caseta TP-SL, cipurile), `components/SortableFavorites.tsx` (nou), `hooks.ts` (`useReorderWatchlist`), `reorder.ts` (nou), `Settings.tsx` (rândurile), testele, FD / TD / ghid. Impact verificat asupra: LMA (panou, culorile lumânărilor), „Pozițiile mele”, panourile „Semnale” / „Alerte”, ecran complet, ordinea favoritelor în bandă / Azi / ⌘K / Știri, adăugarea / ștergerea / aliasurile din Setări, serverul vechi (fără câmpul nou).

## Runda 1 — 3 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Grafice | Avertismentele „…liniile Market Structure sunt ascunse” apăreau și cu Slingshot oprit, când liniile nu se desenează oricum | apar doar cu Slingshot pornit |
| 2 | Salvarea ordinii | Mutările rapide plecau în paralel și puteau ajunge la server în altă ordine: rămânea salvată o ordine mai veche | salvările au `scope` comun (una după alta); răspunsul uneia nu suprascrie ecranul cât mai așteaptă alta |
| 3 | Alt + → repetat | Patru apăsări rapide mutau favoritul o singură poziție: ordinea afișată se actualiza abia la pornirea salvării, iar mutările se calculau din lista randată | ordinea apare imediat (`save`), mutările se calculează din ultima ordine (ref); la eroare lista se recitește de pe server; verificat: 4 × Alt + → → poziția 5 |

Verificări: `tsc` curat; 262 de teste (noi: `moveItem`, `showSlingshot` implicit / vechi / oprit; testul API al setărilor de grafic); build OK; CDP la 1440 px: bifa Slingshot (norul EMA și liniile MS dispar, setarea rămâne după reîncărcare, ambele bife oprite → doar lumânări, în culorile normale), tragerea unui cip (ordinea nouă pe server, graficul nu se schimbă), click simplu → graficul, Alt + → (anunț „BTC: poziția 2 din 11”, focusul rămâne), salvare eșuată simulată (ordinea revine, mesaj), rând tras în Setări, Alt + ↑ pe mâner; la 390 px cu touch: ținut apăsat + tras mută, atingerea scurtă deschide graficul; fără erori în consolă.

## Runda 2 — 0 probleme
Același domeniu, recitit după reparații (`SortableFavorites.tsx`, `useReorderWatchlist`, `Charts.tsx`, `Settings.tsx`), cu cazurile din FD §3.
- Ref-ul cu ultima ordine se reface din fiecare listă nouă; o salvare veche nu suprascrie ecranul cât așteaptă alta (verificat cu 4 × Alt + →); la eroare lista vine de pe server.
- Tragerea în ecran complet: ordinea se schimbă, ecranul complet și graficul rămân.
- Un singur favorit, Alt + ← pe primul, lăsat pe loc sau în afara zonei: nicio salvare.
- `tsc --noUnusedLocals --noUnusedParameters` curat pe codul nou; 262 de teste; build OK.

---

# Review — FD-USERS / TD-USERS (utilizatori, email, 2FA, passkey, admin, rețea)

Domeniu: migrarea 3; `server/auth/*` (parole, TOTP, coduri de recuperare, throttle, sesiuni, email, utilizatori, passkey-uri); `http/auth.ts`, `http/auth-routes.ts`, `http/cookies.ts`, `http/security.ts`, `http/app.ts`; toate rutele existente trecute pe utilizator (`routes.ts`); `settings.ts`, `scanner.ts`, `sentiment/daily.ts`, `news/coin-registry.ts`, `news/ingest.ts`, `news/query.ts`, `calendar/service.ts`, `exchange/accounts.ts`, `jobs/register.ts`, `context.ts`, `config.ts`, `main.ts`; interfața (`auth.ts`, `api.ts`, `App.tsx`, `pages/Auth.tsx`, `Security.tsx`, `Users.tsx`, `Settings.tsx`); `scripts/sentiq.sh`, `scripts/admin.ts`, `scripts/smoke.ts`, `vite.config.ts`; testele. Impact verificat asupra: sentimentul comun și etichetarea știrilor, scanner, calendar și rezultatele companiilor, portofolii, grafice (setări, vederi salvate, ecran complet), ⌘K, banda de prețuri, logo-uri, Stare sistem, lansator / `Sentiq.app`, serverul de dezvoltare Vite.

## Runda 1 — 9 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Autorizare (critic) | Verificarea rutelor publice / de admin se făcea pe URL-ul brut, dar routerul decodifică `%61` → `a`: un utilizator normal ajungea la `/api/%61dmin/users` și `/api/%68ealth` (confirmat cu `inject`) | decizia se ia pe ruta potrivită de router (`req.routeOptions.url`); o cerere e „API” după rută sau după cale; antetul CSRF se cere pe orice modificare, oricum ar arăta calea; test permanent cu căi codificate |
| 2 | Sentimentul comun | Aliasurile oricărui utilizator intrau în detectorul care dă ponderea știrilor (BTC / ETH ⇒ impact 2, relevanța la acțiuni): un alias ca „the” → BTC schimba indexul tuturor | două detectoare: etichetele (`news_coins`, filtrul de favorite) din favoritele tuturor; ponderea (relevanță, impact) din lista de monede + favoritele adminului, ca înainte de FD-USERS; test |
| 3 | Prima parolă de admin | Două cereri `setup` simultane: a doua primea și ea sesiune de admin, cu parola primei | `UPDATE … WHERE password_hash IS NULL` verifică rândurile schimbate; a doua e refuzată; test |
| 4 | Confidențialitate | `GET /api/auth/state` dădea adresa adminului oricui din rețea cât lipsea parola | doar pe Mac (loopback); test |
| 5 | Pagina Utilizatori | O acțiune pe un utilizator inexistent dădea 400, ștergerea 404 | `UserMissingError` → 404 peste tot; test |
| 6 | Email (Resend) | O cheie bună cu un expeditor invalid: cheia se salva, apoi venea eroarea | ambele se validează înainte, salvarea într-o tranzacție; test |
| 7 | Scanner | `POST /api/scanner/run` (acum pentru favoritele tuturor) putea fi apelat în buclă de orice utilizator | cel mult o scanare manuală pe minut |
| 8 | Securitate (UI) | „Copiază” codurile de recuperare nu mergea pe `http://192.168…` (Clipboard API există doar în context securizat), fără mesaj | rezervă cu comanda veche de copiere; mesaj când nici ea nu merge |
| 9 | Securitate (UI) | Câmpul ascuns pentru managerul de parole n-avea emailul; erorile „Cheie nouă” / „Renunță” din pasul QR nu se afișau | emailul pus în câmp; erorile afișate |

Găsite și reparate tot în runda 1, la verificarea în Chrome (CDP, autentificator WebAuthn virtual): după login / setup, routerul (tranziție) și utilizatorul nou (sincron) se întreceau și o redirecționare veche ducea pe `/`; după „Ieși” rămânea `?next=` spre pagina părăsită, iar `navigate()` din meniul demontat era ignorat → ținta se pune într-o variabilă (`landAfterSignIn` / `landAfterSignOut`) citită de redirecționare. Tot atunci: mesajul cu încercările rămase și indiciul despre ora telefonului, promise în FD §5 / §10, lipseau → adăugate.

Verificări: `tsc` curat; 292 de teste (noi: TOTP RFC 6238, coduri de recuperare, parole, throttle, sesiuni, 22 de fluxuri HTTP: setup, înregistrare, confirmare, login, 2FA, recuperare, parolă uitată, izolarea datelor, admin, Resend, passkey cu autentificator construit în test, rețea, căi codificate, aliasuri); build OK; parcurs complet în Chrome (setup → 2FA cu QR → coduri → passkey → ieșire → passkey → parolă + cod → cod de recuperare → link adânc → înregistrare → neconfirmat → retrimitere → confirmare → utilizator normal fără paginile de admin → parolă uitată → Utilizatori → 390 px), fără erori în consolă; regresia graficelor (`chartux`, 11 pași) identică.

## Runda 2 — 2 probleme (reparate)
Același domeniu, recitit după reparații: hook-ul de autentificare și rutele (cont, 2FA, passkey, admin), ecranele de login, Securitate, Utilizatori, Setări, plus paginile existente pentru ce văd utilizatorii normali (Grafice, Azi, Știri, Calendar, Tranzacții, ⌘K), scripturile.
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Grafice | Unui utilizator normal, la o acțiune fără cheia Twelve Data, i se spunea „Adaugă cheia gratuită” (link spre Setări) și „Setări → Date de piață”, dar cheia o poate pune doar adminul | după rol: adminul vede linkul, ceilalți „Cheia gratuită o poate pune adminul.” (verificat în Chrome ca utilizator normal) |
| 2 | `scripts/smoke.ts` | Pe un folder de date nou, sesiunea creată pentru admin nu conta (adminul fără parolă nu e un cont activ), deci toate cererile primeau 401 | setează o parolă adminului când lipsește; rulat cap-coadă pe internetul real: toate 200, CSRF 403, rebinding 403 |

Verificări: `tsc` curat; 292 de teste; build OK; ShellCheck curat; `scripts/admin.ts` (refuză `email` cu parolă pusă, `reset` șterge parola / 2FA / passkey-urile / sesiunile, `email` după reset, folder fără bază de date → mesaj); parcursul în Chrome și regresia graficelor din nou, fără erori.

## Runda 3 — 2 probleme (reparate)
Tot domeniul, recitit cap-coadă (server, interfață, scripturi, documentație), cu accent pe ciclul de viață al sesiunii și pe trecerea de la un utilizator la altul în același browser.
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Sesiunea | Pe server sesiunea glisa (30 de zile de la ultima folosire), dar cookie-ul din browser avea `Max-Age` fix de la login: după 30 de zile browserul îl arunca, deși sesiunea era folosită zilnic (contrar FD §5) | când sesiunea glisează (cel mult o dată la 5 min), hook-ul retrimite cookie-ul cu `Max-Age` nou; test cu ceas simulat: folosită la 29 și 58 de zile rămâne deschisă, lăsată 31 de zile se închide |
| 2 | Schimbarea utilizatorului | Un răspuns întârziat al utilizatorului anterior (ex. salvarea ordinii favoritelor, plecată înainte de „Ieși”) putea scrie în cache-ul următorului utilizator din același browser | `newSessionEpoch()` la fiecare schimbare de utilizator; răspunsurile cererilor plecate înainte se aruncă |

Documentația completată cu deciziile din rundele 1–3 (ponderea știrilor doar din favoritele adminului, regulile pe ruta găsită, cookie-ul glisant, răspunsurile aruncate). Verificări: `tsc` curat; 293 de teste; build OK; parcursul în Chrome din nou, fără erori.

## Runda 4 — 2 probleme (reparate)
Tot domeniul; fiecare rând din FD §10 (cazuri limită) confruntat cu implementarea și cu un test; paginile noi și cele existente verificate la 390 px ca admin și ca utilizator.
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Passkey | Un passkey copiat (contorul dă înapoi) era refuzat corect, dar cu mesajul englezesc al bibliotecii | mesaj în română, cu ce e de făcut; test cu un autentificator care trimite un contor vechi |
| 2 | Securitate pe telefon | La 390 px pagina se derula orizontal (637 px): eticheta ascunsă „Acțiuni” din antetul tabelului de passkey-uri e poziționată absolut și ieșea din cutia de scroll a tabelului | antetul e `relative`; toate paginile (Azi, Știri, Calendar, Grafice, Tranzacții, Setări, Stare sistem, Securitate, Utilizatori) au acum exact 390 px |

Teste noi pentru rânduri din FD §10 fără acoperire: răspunsul aruncat după schimbarea utilizatorului, evenimentul de ieșire doar la `AUTH_REQUIRED` (`web/api.test.ts`), passkey copiat. Verificări: `tsc` curat; 295 de teste; build OK.

## Runda 5 — 3 probleme (reparate)
Tot domeniul, plus migrarea 3 pe date reale: o copie a bazei tale (`VACUUM INTO`, originalul neatins) migrează în 2 ms, cele 26 de favorite și contul KuCoin devin ale adminului, `foreign_key_check` gol, `integrity_check` ok. Test nou pentru migrarea 3 pe o bază versiunea 2 (favorite, cont, preț mediu, eveniment, setări → adminul; al doilea utilizator pornește de la valorile implicite și împarte retenția; ștergerea lui îi ia rândurile). `tsc --noUnusedLocals --noUnusedParameters`: doar o variabilă veche din portul Slingshot, în afara domeniului.
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Cod mort | `ForbiddenError` (și maparea ei în `app.ts`) nu era aruncată nicăieri | scoasă |
| 2 | Cod mort | Coloana `sessions.return_to` nu era citită de nimic (ținta după login o ține pagina) | scoasă din migrare (încă neaplicată pe baza ta) și din cod / TD |
| 3 | Denumire | `MAX_FAVORITES_DEFAULT` era de fapt lista de favorite a unui cont nou | `NEW_USER_FAVORITES` |

Verificări: `tsc` curat; 296 de teste; build OK.

## Runda 6 — 0 probleme
Tot domeniul recitit în forma finală: `server/auth/*`, `http/auth.ts` (rutele publice / de admin după ruta găsită, cookie-ul glisant), `http/auth-routes.ts` (mesajele generice, bugetele de încercări, relying party, Resend), rutele pe utilizator, `settings.ts`, `scanner.ts`, `daily.ts`, `coin-registry.ts` / `ingest.ts` (etichete vs. ponderi), migrarea 3, interfața (`auth.ts`, `api.ts`, `App.tsx`, `Auth.tsx`, `Security.tsx`, `Users.tsx`, `Settings.tsx`, `Charts.tsx`), `scripts/*`, FD / TD / ghid.
- Rândurile din FD §10 au fiecare implementare și test; mesajele către utilizator sunt în română.
- `tsc` curat; 296 de teste; build OK; ShellCheck curat; `scripts/smoke.ts` pe internetul real (toate 200, CSRF 403, rebinding 403).
- Chrome (CDP): parcursul complet (setup, 2FA, coduri, passkey, ieșire, passkey, parolă + cod, cod de recuperare, link adânc, înregistrare, retrimitere, confirmare, utilizator normal, parolă uitată, Utilizatori, 390 px) fără erori; regresia graficelor identică; paginile la 390 px fără derulare orizontală, ca admin și ca utilizator.

---

# Review — FD-IMPACT / TD-IMPACT (importanța de la Claude, geopolitica la 0,8)

Domeniu: migrarea 4; `sentiment/engine.ts`, `claude.ts`, `service.ts`, `daily.ts`; `news/classify.ts`, `ingest.ts`, `query.ts`; `jobs/register.ts` (jobul zilnic, întreținerea); `web/pages/News.tsx`; testele; FD / TD / research / ghid. Impact verificat asupra: indexului zilei și sub-indicilor, „Ce mișcă piața”, evoluției pe ore, istoricului (și butonul de recalculare), renotării (admin), motorului local și rezervei lui, re-etichetării la schimbarea favoritelor (FD-USERS), retenției, fusurilor orare ale utilizatorilor.

## Runda 1 — 2 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Istoric | Recalcularea trecea doar prin fusurile orare în uz; zilele unui fus părăsit rămâneau calculate după regula veche și ar fi reapărut amestecate cu cele noi dacă un utilizator îl alegea din nou | se curăță și fusurile care au doar snapshot-uri (tot de la prima zi completă); `refresh` le reface când fusul e folosit; test |
| 2 | Documentație | FD §3 (formula sentimentului) și TD §6.4 descriau impactul doar după cuvinte-cheie | trimiteri la FD-IMPACT / TD-IMPACT |

Verificări: `tsc` curat; 302 teste (noi: importanța de la Claude rotunjită / limitată, rezerva locală fără importanță, scrierea / golirea / re-etichetarea, indexul cu importanța lui Claude, geopolitica 0,8, recalcularea o singură dată cu zilele tăiate de retenție păstrate, migrarea 4 cu meta lipsă / invalidă); build OK. Rulare pe o copie a bazei reale: 1.313 din 1.377 de știri au importanța de la Claude, 47 de știri geopolitice trec la 0,8, 58 rămân în afara indexului; 12 oct 45,1 → 44,5, 13 oct 44,9 → 42,4.

## Runda 2 — 1 problemă (reparată)
Același domeniu, recitit după reparații, plus verificarea în Chrome pe o copie a bazei reale (server de test cu joburile oprite, deci fără apeluri la Claude).
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Comentariu | Descrierea lui `recomputeHistory` spunea „fusurile în uz”, după ce runda 1 a adăugat și fusurile cu snapshot-uri | descrierea corectată |

Verificări: pagina Știri arată, la „De ce acest scor?”, „Relevanță 0,8, importanță 1 (Claude)” și „importanță 1 (Claude; după cuvinte-cheie ar fi 3)”, fără erori în consolă; copia datelor ștearsă după test.

## Runda 3 — 0 probleme
Tot domeniul recitit în forma finală: migrarea 4 (completarea din meta, relevanța geopolitică doar de la 0,6), `ClaudeEngine` (importanța rotunjită, limitată, lipsă la rezerva locală), `SentimentService` (scriere / golire), `ingestItems` / `retagRecent` (titlu schimbat vs. re-etichetare), `DailySentimentService` (`COALESCE`, `upgradeHistory` o singură dată, zilele tăiate de retenție păstrate, fusurile părăsite), jobul zilnic și întreținerea (pragul de retenție), `queryNews` și pagina Știri, FD / TD / research / ghid. Fiecare rând din FD-IMPACT §4 are implementare și test sau verificare.
- `tsc` curat (și cu `--noUnusedLocals --noUnusedParameters` pe codul nou); 302 teste; build OK.

---

# Review — FD-ECON / TD-ECON (pagina „Economie”)

Domeniu: migrarea 5; `calendar/sources.ts` (câmpurile în plus, țările ca parametru); `economy/service.ts`, `economy/names.ts`; `jobs/register.ts` (citirea Calendarului, jobul `econ.history`, întreținerea); `context.ts`; rutele `/api/economy`, `/api/economy/description`; `web/pages/Economy.tsx`, `web/econ-format.ts`, `App.tsx` (meniu, rută, ⌘K), `Health.tsx`; testele; FD / TD / research / ghid. Impact verificat asupra: paginii Calendar (aceleași citiri, aceleași evenimente), joburilor (durată, limite, pauze), mărimii bazei de date, utilizatorilor (pagină comună, fusul fiecăruia), meniului la 1440 px și pe telefon.

Verificări pe date reale (folder de test, server cu joburile oprite): istoricul pentru 13 țări în 21 s, 13.323 de publicări, 739 de indicatori; SUA 189, zona euro 53 (după regula membrilor), Marea Britanie 70, Japonia 65, China 29, Canada 47, Elveția 20, Australia 61, Noua Zeelandă 38; aproape toți cu data următoarei publicări.

## Runda 1 — 3 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Programul publicărilor | Citirea Calendarului (−7 … +14 zile, 13 țări) ștergea publicările viitoare lipsă din răspuns; un răspuns tăiat la limita sursei (2.000) ar fi șters și publicări reale de după tăietură | un răspuns gol sau la limită nu șterge nimic; test |
| 2 | Teste | Legătura Calendar → Economie (în `register.ts`) nu era testată | `feedingEconomy()` în serviciu; test: același răspuns ajunge la Calendar, o eroare pe partea Economie nu-l oprește |
| 3 | Performanță | Pagina (sute de rânduri) se re-randa la 30 s, deși numărătorile sunt în minute | la 60 s |

Găsite și reparate tot în runda 1, la verificarea în Chrome: mini-graficele ieșeau din fișe când valoarea era lată (pagina avea 1468 px la 1440); fișele „Esențiale” nu erau ordonate (dobânda înaintea inflației); zona euro avea 127 de indicatori, mulți regionali (inflația fiecărui land german) și fișe „esențiale” ale statelor membre (obligațiunile Franței, Italiei…); un singur punct apărea ca „—” în fișă; pe telefon o fișă pe rând și numărătoarea ieșea din fișă (408 px la 390); răspunsul avea 715 KB, din care descrierile în engleză → grafice pe toată lățimea fișei, ordine pe grupe, membrii doar cu importanță medie / mare și esențiali doar dacă sursa îi marchează, două fișe pe rând pe telefon cu numărătoarea dedesubt, descrierea la cerere și istoricul ca perechi: 367 KB.

Verificări: `tsc` curat; 315 teste (noi: câmpurile în plus, împărțirea la limită, cheia fără ticker, ultima valoare / anteriorul revizuit / flash-final / următoarea / în așteptare / necunoscută, grupul zonei euro, istoricul 13 / 26, ștergerea programului, valori păstrate / corectate, `prune`, istoricul o dată pe țară cu reîncercare, programul, formatul web, ruta); build OK; Chrome la 1440 și 390 px fără depășiri și fără erori; căutarea „somaj” fără diacritice găsește șomajul în toate țările.

## Runda 2 — 1 problemă (reparată)
Același domeniu recitit, plus citirea reală a Calendarului care alimentează pagina: 600 de evenimente pe citire (sub limita de 2.000), 551 de publicări actualizate, calendarul neschimbat (`calendar_raw` primește aceleași coloane).
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Pagina Economie | La o căutare, cipurile țărilor fără rezultate rămâneau și nu duceau nicăieri (secțiunea era ascunsă) | apar doar țările rămase pe pagină |

## Runda 3 — 0 probleme
Tot domeniul în forma finală (`economy/*`, `calendar/sources.ts`, joburile, rutele, `Economy.tsx`, `econ-format.ts`, meniul, FD / TD / research / ghid); fiecare rând din FD-ECON §4 are implementare și test sau verificare în Chrome.
- `tsc` curat (și cu `--noUnusedLocals --noUnusedParameters` pe codul nou); 315 teste; build OK.

---

# Review — FD-ECONCOLOR / TD-ECONCOLOR (culori pe pagina „Economie”)

Domeniu: `economy/names.ts` (`polarityOf`), `economy/service.ts` (`polarity`), `web/econ-format.ts` (`toneOf`), `web/pages/Economy.tsx` (valoare, schimbare, istoric, prognoză, legendă); testele; research §11, FD / TD. Clasificarea verificată pe toate cele 344 de nume reale de indicatori: 173 cu creșterea bună, 108 cu creșterea rea, 63 neutri.

## Runda 1 — 4 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Sensul indicatorilor | Prețul mașinilor rulate (grupa consum) ieșea „creștere bună”, deși e un semnal de inflație | regulă proprie: creșterea e rea |
| 2 | Culori | O schimbare neutră (0) apărea albă, la fel de vizibilă ca valorile colorate | schimbarea neutră e discretă |
| 3 | Accesibilitate | „Bine / rău” se vedea doar prin culoare (cititor de ecran, daltonism) | săgeata spune direcția; textul ascuns și tooltip-ul spun „bine / rău pentru economie” |
| 4 | Telefon | Textul ascuns de la #3, poziționat absolut, ieșea din cutia de scroll a tabelelor (pagina avea 685 px la 390) | containerul e `relative`; 390 px și 1440 px fără depășiri |

Verificări: `tsc` curat; 317 teste (noi: `polarityOf` pe nume din fiecare rând al tabelului din research §11 și pe nume necunoscute, `toneOf`, `polarity` în răspuns); build OK; Chrome pe o copie a datelor reale (server de test cu joburile oprite): inflația lunară în creștere roșie, inflația de bază în scădere verde, cererile de șomaj în scădere verzi, NFP / JOLTS în scădere roșii, punctul de la capătul istoricului în culoarea schimbării, „conform prognozei” neutru.

## Runda 2 — 1 problemă (reparată)
Același domeniu recitit (`Spark` cu punctul final în ambele moduri, `Change`, `toneOf` și rotunjirea, prognoza, legenda, membrii zonei euro).
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Documentație | Ghidul nu spunea ce înseamnă culorile pe pagina Economie | paragraf despre verde / roșu / neutru, săgeată și punctul istoricului |

## Runda 3 — 0 probleme
Tot domeniul în forma finală; fiecare rând din FD-ECONCOLOR §3 verificat (schimbare zero, fără anterior, indicator neutru, nume necunoscut după grupă, dobânzi și randamente, NFP). `tsc` curat; 317 teste; build OK; 390 px și 1440 px fără depășiri, fără erori în consolă.

---

# Review — FD-ECONFILTER / TD-ECONFILTER (țările ca filtre pe pagina „Economie”)

Domeniu: `web/pages/Economy.tsx` (cipurile, filtrul în adresă, mesajele, bara de filtre), `web/econ-format.ts` (`filterEconomy`), testele, FD / TD / ghid. Verificat în Chrome pe o copie a datelor reale (server de test cu joburile oprite), la 1440 și 390 px: click pe Japonia → doar Japonia (`?tara=JP`); click din nou / „Toate” → toate; `?tara=EU` deschide zona euro; `?tara=XX` → toate; căutarea cu o țară activă; fără erori.

## Runda 1 — 2 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Mesaje | Cu o țară activă și o căutare fără rezultate nicăieri, mesajul spunea „Niciun indicator din Japonia…”, ca și cum în altă parte ar exista | mesajul despre țară (cu „Caută în toate țările”) doar când alte țări au rezultate; altfel „Niciun indicator nu se potrivește.” |
| 2 | Bara de filtre | Cu numerele pe cipuri, „Doar importante” (apoi căutarea) rămânea singură pe un rând, cu un gol mare | două rânduri: țările, apoi căutarea și bifa |

## Runda 2 — 1 problemă (reparată)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Cod mort | `scroll-mt-28` pe secțiuni rămăsese de la ancore, care nu mai există | scos |

## Runda 3 — 0 probleme
Tot domeniul în forma finală; fiecare rând din FD-ECONFILTER §3 verificat (cod necunoscut, țara activă fără date, reîmprospătarea la 5 minute păstrează filtrul, telefon). `tsc` curat (și cu `--noUnusedLocals --noUnusedParameters`); 318 teste; build OK.

---

# Review — FD-SUMMARY / TD-SUMMARY („Rezumat”: rezumatul zilei cu Claude)

Domeniu: migrarea 6, `server/summary/context.ts` și `service.ts`, rutele `GET`/`POST /api/summary`, maparea erorilor în `app.ts`, `web/components/DaySummary.tsx`, butonul din `App.tsx` (și ⌘K, închiderea la schimbarea paginii), tipurile din `api-types.ts`, testele, FD / TD / ghid. Verificat cap-coadă pe o copie a datelor reale (server de test cu joburile oprite): un apel real la Claude (~25 s, verdict „mixtă”, 3 grafice: sentimentul pe ore, pe categorii, un indicator publicat azi); Chrome la 1440 și 390 px.

## Runda 1 — 10 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Grafice (server) | Un id de grafic ca „constructor” sau „__proto__” trecea de `ctx.charts[id]` (moștenit din `Object`) și ajungea salvat ca grafic fără date → fereastra cădea la desenare | `Object.hasOwn(ctx.charts, id)`; test cu „constructor”, „__proto__”, id necunoscut și repetat |
| 2 | Grafice (server) | `content.charts` (salvat) și `charts` (seriile) se filtrau separat: lista din conținut putea păstra repetiții | o singură listă aleasă, folosită pentru amândouă |
| 3 | Prompt | Titlurile știrilor intră în prompt; nimic nu spunea că sunt date, nu instrucțiuni | o frază în instrucțiunile de sistem |
| 4 | Erori (server) | O eroare la citirea datelor zilei ieșea ca 500 generic, fără mesaj în română | `SummaryFailedError` („Datele zilei nu s-au putut citi”), cu jurnal; test (Claude nu e întrebat) |
| 5 | Accesibilitate | Fereastra e `aria-modal`, dar Tab ieșea în pagina din spate | Tab / Shift+Tab rămân în fereastră (ca în asistentul de conturi); Esc respectă `defaultPrevented` |
| 6 | ⌘K | Cu rezumatul deschis, ⌘K deschidea căutarea *sub* fereastră (același z-index, mai devreme în DOM): căutare invizibilă cu focusul în ea | ⌘K închide întâi rezumatul |
| 7 | Telefon | „Actualizează” lat rupea titlul pe două rânduri; subtitlul se tăia („generat acum 3…”) | pe telefon butonul doar cu iconiță (eticheta rămâne pentru cititoare de ecran); subtitlul pe rânduri, fiecare bucată întreagă, modelul doar pe ecrane mari |
| 8 | Mesaje | Fără cheie, apărea și eroarea 400, și explicația cu link spre Setări | eroarea se ascunde când există mesajul dedicat (fără cheie / prea devreme) |
| 9 | Ce urmează | Coloana orei („mâine 05:10”) se suprapunea peste text | subgrid: coloana are lățimea celei mai lungi ore |
| 10 | Grafic cu bare | Cheia fiecărei bare era eticheta: o monedă și o acțiune cu același simbol s-ar fi ciocnit | indexul |

Verificări: `tsc` curat; 324 de teste (noi: id-uri speciale, eroare la datele zilei); build OK; Chrome: Tab ×6 și Shift+Tab ×4 rămân în fereastră, Esc închide și întoarce focusul pe „Rezumat”, ⌘K închide rezumatul și deschide căutarea vizibilă, fără erori în consolă, fără depășiri la 390 px.

## Runda 2 — 5 probleme (reparate)
Tot domeniul recitit, plus impactul asupra calendarului, `ErrorBoundary`, ⌘K și documentației.
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Date trimise | `calendar.query` include mereu evenimentele notate de utilizator (orice impact); ajungeau la Claude nemarcate, iar FD §4 spunea „fără date personale” | marcate „(notat de utilizator)”, fără notiță (nici înainte nu era trimisă); FD §4 / TD §2 spun asta; test (titlul da, notița nu) |
| 2 | Încărcare | Fereastra, încărcată la cerere, era în afara oricărui `ErrorBoundary`: dacă fișierul ei lipsește (tab vechi după o actualizare), cădea toată aplicația | `ErrorBoundary` propriu, cu `fallback` nou: fereastra „Rezumatul nu a putut fi afișat” („Aplicația a fost actualizată între timp: reîncarcă pagina”), cu focus, Esc și „Închide”; verificat blocând fișierul în Chrome |
| 3 | Cost | Ghidul spunea „câțiva cenți” fără măsurare; nimic nu arăta costul real | promptul măsurat pe datele reale (~10 400 de caractere): ~5–15 cenți la $4 / $20 pe milion; tokenii fiecărui rezumat în jurnal; research §12 și ghidul corectate |
| 4 | Documentație | FD / TD descriau altfel decât codul: modelul „jos” (e sus, doar pe ecrane mari), „Ce urmează azi” (sunt 24 h), `generate(userId, now)`, lipseau Tab-ul, ⌘K, fallback-ul | FD §2, §4, §5 și TD §2, §3, §5 aliniate |
| 5 | Documentație | Ghidul și PROGRESS nu aveau Rezumatul | paragraf la „Azi” (și la „Sentiment cu Claude”); intrare în PROGRESS |

Verificări: `tsc` curat; 324 de teste; build OK; Chrome cu fișierul ferestrei blocat: fereastra de eroare, focus pe „Reîncarcă pagina”, Esc închide, pagina rămâne întreagă (1440 și 390 px).

## Runda 3 — 2 probleme (reparate)
Tot domeniul în forma finală, inclusiv ce s-a adăugat în runda 2.
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Accesibilitate | Fereastra nouă de eroare (`SummaryFailed`) e `aria-modal`, dar Tab ieșea din ea (aceeași problemă ca în runda 1, la fereastra nouă) | Tab / Shift+Tab rămân pe cele două butoane; verificat în Chrome |
| 2 | Comentarii | Două JSDoc la rând pe `ErrorBoundary`: primul nu se mai lega de clasă | unul singur |

## Runda 4 — 1 problemă (reparată)
Tot domeniul în forma finală, cu `tsc --noUnusedLocals --noUnusedParameters` pe fișierele lui.
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Cod mort | `sparkPath` importat în `DaySummary.tsx` și nefolosit (graficele au propriul desen) | scos |

Verificări: `tsc` curat; 324 de teste; build OK; Chrome la 1440 și 390 px: butonul doar pe Azi, fereastra cu verdict și 3 grafice, Esc, Tab / Shift+Tab în fereastră, focusul înapoi pe „Rezumat”, ⌘K, fără depășiri, fără erori în consolă.

## Runda 5 — 0 probleme
Tot domeniul recitit în forma finală (server, fereastră, buton, ⌘K, `ErrorBoundary`, teste, FD / TD / ghid / research): fiecare rând din FD-SUMMARY §5 verificat (fără cheie, cheie invalidă, refuz / răspuns tăiat, dimineața devreme, grafic inexistent, zi fără date, telefon, ⌘K, fereastra care nu se încarcă). `tsc` curat (și cu `--noUnusedLocals --noUnusedParameters`); 324 de teste; build OK; Chrome la 1440 și 390 px fără erori.

---

# Review — FD-MCP / TD-MCP (connector Claude pe abonamentul fiecăruia)

Domeniu: `config.ts` (`SENTIQ_PUBLIC_URL`, `SENTIQ_MCP`, `SENTIQ_MCP_CLIENTS`), migrarea 7, `mcp/oauth.ts`, `mcp/server.ts`, `mcp/routes.ts`, `http/security.ts` (scutirile), `context.ts`, `http/app.ts`, revocările din `auth-routes.ts`, curățenia din `jobs/register.ts`, `main.ts`, `summary/context.ts` (`forTools`), `web/pages/Consent.tsx`, `web/pages/Security.tsx`, `App.tsx`, tipurile, testele, FD / TD / ghid / README / research. Verificat pe o copie a datelor reale cu un server de test (connector pornit pe `http://localhost:4399`, joburi oprite): Chrome → autorizare (și pornind din alt site) → login → consimțământ → callback; schimbul de cod; clientul MCP real al SDK-ului pe toate uneltele; documentul real al Claude citit de pe claude.ai.

## Runda 1 — 6 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Securitate (consimțământ) | O cerere de autorizare putea fi aprobată de oricine logat care primea linkul: cineva pornea conectarea din Claude-ul lui și îți trimitea pagina de consimțământ, iar tu îi legai datele tale de contul lui | cererea e legată de browserul care a pornit-o (cookie `sentiq_oauth` aleator, HttpOnly, SameSite=Strict, 10 min, comparat în timp constant); fără el: „a pornit din alt browser”; teste; verificat în Chrome pornind dintr-o pagină de pe alt site |
| 2 | OAuth | `redirect_uri` era opțional la autorizare (dacă aplicația avea unul singur), dar obligatoriu la token: un client care l-ar fi omis n-ar fi putut termina conectarea | obligatoriu la autorizare (pagină de eroare clară); test |
| 3 | Atomicitate | Conexiunea și token-urile ei se scriau în pași separați: o eroare între ei lăsa o conexiune fără token-uri | într-o singură tranzacție |
| 4 | Unelte | „Ziua de azi” purta id-urile de grafic ale Rezumatului („Grafice disponibile”, `econ:…`), fără sens pentru uneltele lui Claude | `buildDayContext(…, { forTools: true })`: cheile indicatorilor (cele pe care le ia „Indicatori economici”), fără lista de grafice; test |
| 5 | Unelte | La indicatorii fără perioadă apărea un spațiu dublu („(Interest Rate)  = 4%”), văzut pe datele reale | perioada doar când există |
| 6 | Documentație | FD nu spunea că graficele de acțiuni cerute de Claude folosesc același buget Twelve Data ca scannerul și nici cum e legată cererea de browser | FD §6 (trei rânduri noi), §7; TD §3, §4, §5 |

Verificări: `tsc` curat; 336 de teste; build OK; fluxul real în Chrome (direct și din alt site), 1440 și 390 px, fără erori în consolă.

## Runda 2 — 3 probleme (reparate)
Tot domeniul recitit (rutele, serverul MCP, uneltele, pagina de consimțământ, secțiunea din Securitate, documentația), cu `tsc --noUnusedLocals --noUnusedParameters`.
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Cod | Un import ajunsese după constante în `mcp/routes.ts` (de la reparația din runda 1) | mutat sus |
| 2 | Unelte | La o pereche necunoscută, bursa dă sugestii (`MarketError.suggestions`), dar Claude primea doar mesajul | „Poate: XYZ/USDC, XYZ/BTC.” adăugat la eroare; test |
| 3 | Curățenie | Curățenia zilnică rula doar cu connectorul pornit: rândurile rămase dintr-o perioadă în care fusese pornit nu se mai ștergeau | `pruneMcp(db)` rulează mereu în mentenanță (metoda serviciului o folosește) |

Verificări: `tsc` curat (și strict); 336 de teste; build OK.

## Runda 3 — 1 problemă (reparată)
Tot domeniul în forma finală, cu accent pe fluxul OAuth (cod, refresh, rotire, revocare, `iss`, `state`, resursă) și pe ce ajunge în jurnal.
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Jurnal | Numele pe care și-l dă un client DCR (și cel din documentul CIMD) ajungea în jurnal cu tot cu rânduri noi: putea falsifica linii de jurnal | `cleanClientName`: caracterele de control (și U+2028 / U+2029) devin spațiu, maxim 100; test |

Verificări: `tsc` curat; 336 de teste; build OK.

## Runda 4 — 1 problemă (reparată)
Diff-ul tuturor fișierelor existente atinse (`context.ts`, `app.ts`, `security.ts`, `auth-routes.ts`, `register.ts`, `main.ts`, `summary/context.ts`, `api-types.ts`, `App.tsx`, `Security.tsx`) și fișierele noi, încă o dată.
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Cod | Două tipuri luate cu `import('…')` în linie (`DocFetcher` în `context.ts`, `Connection` în `api-types.ts`), deși modulele erau deja importate | importuri obișnuite |

Verificări: `tsc` curat; build OK.

## Runda 5 — 0 probleme
Tot domeniul în forma finală; fiecare rând din FD-MCP §6 verificat (oprit / pornit pe jumătate, aplicație și callback necunoscute, PKCE, resursă, refuz, cerere expirată sau din alt browser, două conectări în paralel, cod refolosit, refresh refolosit în grație și după, cont dezactivat / șters, limite, date lipsă, simbol necunoscut, repornire). `tsc` curat (și strict); 336 de teste; build OK; pe copia datelor reale: fluxul complet în Chrome la 1440 și 390 px (direct, din alt site, nelogat → login → consimțământ), clientul MCP real pe toate uneltele, fără erori în consolă și fără depășiri.

## Runda 6 — 1 problemă (reparată)
Găsită la verificarea pe aplicația reală (port 4317, connector oprit), după repornire.
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Connector oprit | Cu build-ul web prezent, `GET /mcp`, `/.well-known/…` și `/oauth/…` primeau pagina aplicației (200, HTML) din fallback-ul SPA, nu 404 cum spune FD §2; testele nu o vedeau pentru că rulau fără build web | fallback-ul răspunde 404 (JSON) pentru `/.well-known/*`, `/mcp…` și `/oauth/*` (în afară de `/oauth/consent`, care e o pagină a aplicației); testele MCP rulează acum cu un build web; verificat pe aplicația reală: 404 / 404 / 404, consimțământul și Securitate 200 |

## Runda 7 — 0 probleme
Fallback-ul verificat pe toate formele (`/mcp`, `/mcp/`, `/mcp?x`, `/mcpx`, `/oauth/consent?…`, `/oauth/consentx`, `/oauthx`, `/.well-known/openid-configuration` cu connectorul pornit); tot domeniul recitit încă o dată. `tsc` curat (și strict); 336 de teste; build OK; aplicația ta repornită cu connectorul oprit, fără erori în jurnal.

---

# Review — FD-INVITE / TD-INVITE (conturi doar la cerere, aprobate de admin)

Domeniu: migrarea 8, `auth/users.ts` (cerere, aprobare, respingere, link nou, activare, curățenie; ce s-a scos), `auth/email.ts`, `http/auth-routes.ts`, `http/auth.ts` (rutele publice), `jobs/register.ts`, `web/pages/Auth.tsx`, `web/pages/Users.tsx`, `web/App.tsx` (meniul contului), `web/auth.ts`, `web/clipboard.ts`, `web/pages/Security.tsx` (helperul mutat), tipurile, testele, FD / TD / ghid / README. Verificat în Chrome pe o copie a datelor reale (fără cheia Resend, ca să nu plece emailuri adevărate), la 1440 și 390 px: cerere → punct la admin → aprobare cu link → activare → login cu emailul completat → intrare; linkul a doua oară refuzat.

## Runda 1 — 5 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Telefon | În panoul de cereri, „Aprobă” / „Respinge” erau în tabelul care se derulează lateral: pe telefon, tocmai acțiunea panoului era în afara ecranului | listă în loc de tabel: butoanele trec sub nume pe ecrane înguste |
| 2 | Telefon | Linkul de activare ieșea din chenar: clasa `.num` are `white-space: nowrap`, care anula `break-all` (la fel adresa connectorului din Securitate) | linkul pe rândul lui, cu `whitespace-normal`; la fel în Securitate |
| 3 | API | „Prea multe cereri în așteptare” cu 503 ajungea 500 („Eroare internă”): handler-ul aplicației lasă să treacă doar 4xx | 429 `REQUESTS_FULL`; test |
| 4 | Mesaje | După cerere, cu expeditorul de test al Resend, persoana aștepta un email care nu vine (vechea pagină de înregistrare spunea asta) | notă „Deocamdată emailurile Sentiq ajung doar la admin: linkul de activare ți-l trimite el.”; FD §1 |
| 5 | Activare | Deschis într-un browser logat cu alt cont (adminul încercând linkul), „Intră în cont” ducea în contul curent fără explicație; FD descria altceva | notă pe ecranul de succes (cum intri cu noul cont); FD §5 corectat |

Verificări: `tsc` curat (și strict); 337 de teste; build OK; Chrome: ambele note, fluxul complet la 1440 și 390 px, fără erori în consolă, fără depășiri.

## Runda 2 — 1 problemă (reparată)
Tot domeniul recitit (rutele noi, serviciul, emailurile, paginile, meniul, testele, documentația), cu fiecare rând din FD-INVITE §5.
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Documentație | TD §3 nu spunea că aprobarea întoarce și cererile rămase, iar respingerea lista lor (pagina le folosește) | TD §3 corectat |

Verificări: `tsc` curat; 337 de teste; build OK.

## Runda 3 — 0 probleme
Tot domeniul în forma finală; fiecare rând din FD-INVITE §5 verificat. `tsc` curat (strict: singura observație e veche și în afara domeniului, `storedHighestBar` din portul Slingshot); 337 de teste; build OK; Chrome pe copia datelor, 1440 și 390 px: cererea (cu nota de dezvoltare), punctul din meniu, aprobarea, activarea, login-ul cu emailul completat, linkul refolosit refuzat, `/register` → „Cere un cont”, `/verify-email` → login, link fals → „Linkul nu mai e valabil”; fără erori în consolă, fără depășiri.

---

# Review — FD-STALE / TD-STALE („Importing a module script failed.” după actualizări)

Domeniu: `vite.config.ts` (fără golirea folderului, pluginul de curățare), `src/build/prune-assets.ts`, `web/stale.ts`, `web/main.tsx`, `components/ErrorBoundary.tsx`, `App.tsx` (fereastra de eroare a Rezumatului), testele, FD / TD / ghid / PROGRESS; impactul asupra serviciului fișierelor statice (FD-STATIC) și a launcher-ului (verificarea „build mai nou”). Verificat în Chrome cu cereri interceptate (fișierul paginii lipsă o dată / mereu), cu serverul de test oprit și pornit în timpul încărcării, pe serverul tău (fișierele vechi 200, unul inexistent 404) și cu un build Vite separat (pluginul șterge doar fișierele vechi).

## Runda 1 — 3 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Documentație | TD indica alt loc pentru funcția de curățare | TD §1 |
| 2 | Documentație (impact FD-INVITE) | „Probleme frecvente” încă spunea „Nu primești emailul de confirmare … adminul îți confirmă contul”, din fluxul vechi | rândul rescris pentru linkul de activare |
| 3 | Documentație | Ghidul nu explica noul mesaj „Codul paginii nu s-a putut încărca” | rând nou în „Probleme frecvente”; intrare în PROGRESS |

Verificări: `tsc` curat; 342 de teste; build OK.

## Runda 2 — 1 problemă (reparată)
Codul nou recitit (`stale.ts`, pluginul, `ErrorBoundary`), cu fiecare rând din FD-STALE §3.
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Buclă de reîncărcare | Unde browserul refuză `sessionStorage` (moduri private mai vechi din Safari), momentul ultimei reîncărcări se pierdea la reîncărcare: o eroare permanentă ar fi reîncărcat pagina la nesfârșit | `reloadMarker`: `sessionStorage`, altfel `window.name` al tabului (supraviețuiește reîncărcării; nu suprascrie un nume pus de altcineva); test; TD §2 |

Verificări: `tsc` curat (și strict); 343 de teste; build OK.

## Runda 3 — 0 probleme
Forma finală recitită: ascultătorul e instalat înaintea oricărui import la cerere (în `main.tsx`); evenimentul Vite acoperă și fișierele cerute din alte fișiere și CSS-ul; `npm run dev` neatins; launcher-ul compară sursele cu `index.html`, deci păstrarea fișierelor vechi nu-l afectează; un fișier inexistent rămâne 404 (FD-STATIC). `tsc` curat (și strict); 343 de teste; build OK; Chrome: lipsă o dată → reîncărcare și pagina; lipsă mereu → o reîncărcare, apoi mesajul în română, fără buclă; server oprit → așteaptă, apoi reîncarcă singur.

---

# Review — FD-THEME / TD-THEME (tema luminoasă și comutatorul)

Domeniu: `styles.css` (tokenurile noi, tema luminoasă, umbrele), `public/theme.js`, `index.html`, `web/theme.ts`, `components/ThemeToggle.tsx`, `App.tsx` (bara de sus, meniul contului, fereastra de eroare a Rezumatului), `pages/Auth.tsx`, `chart/CandleChart.tsx`, `chart/pnl.ts`, `pages/Charts.tsx`, ferestrele (⌘K, Rezumat, asistentul de conturi), `Today.tsx`, `News.tsx`, `Settings.tsx`, logo-ul Revolut, testele, FD / TD / ghid / PROGRESS. Verificat în Chrome pe o copie a datelor (fără cheile Claude și Resend): toate paginile și ferestrele în ambele teme, la 1440 și 390 px; comutarea fără reîncărcare, graficul recolorat, al doilea tab urmează, tema aplicată înainte de primul desen.

## Runda 1 — 4 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Grafice | Tabelul TAKE PROFIT / STOP LOSS (culorile Pine, neon) pe fundalul luminos al temei: aproape ilizibil | placă închisă fixă în ambele teme, ca în indicator; FD §1, TD §4 |
| 2 | Telefon | Pe Azi, „Rezumat” + căutare + noul buton + contul nu mai încăpeau: bara trecea pe două rânduri | pe telefon comutarea e în meniul contului; bara rămâne pe un rând; FD §2, TD §3, ghid |
| 3 | Telefon (găsit în trecere) | Setări era mai lată decât ecranul (505 px la 390): rândul cu consumul Twelve Data avea `.num` (`white-space: nowrap`) | `whitespace-normal` |
| 4 | Documentație | PROGRESS spunea 353 de teste | 348 |

Verificări: `tsc` curat (și strict); 348 de teste; build OK; contrastul paletei luminoase ≥ 4,66:1 pe toate fundalurile; Chrome fără erori, fără depășiri.

## Runda 2 — 1 problemă (reparată)
Tot codul recitit; variabilele de temă verificate în CSS-ul compilat (toate există în ambele teme, inclusiv cele folosite doar prin `var()`); bara de sus verificată la 640, 700, 768, 900, 1024 și 1180 px (fără depășiri; de la 1024 căutarea și contul trec sub meniu, ca înainte).
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Documentație | FD §4 („Telefon”) spunea că butonul e în bara de sus, deși pe telefon comutarea e acum în meniul contului | rândul corectat |

Verificări: `tsc` curat; 348 de teste; build OK.

## Runda 3 — 0 probleme
Forma finală: `tsc` curat (strict: doar observația veche din portul Slingshot); 348 de teste; build OK; `theme.js` servit de aplicația ta (200) și inclus în pagină; toate paginile în ambele teme la 1440 și 390 px fără erori în consolă și fără depășiri.

---

# Review — FD-THEME2 / TD-THEME2 (tema Navy, rânduri alternate, hover, graficul pe placa lui)

Domeniu: `styles.css` (paleta Navy, tokenurile noi, insula `.theme-bar` / `.theme-page`, cipul apăsat, butoane / cipuri / segmente / tabele / liste), redenumirea `brass` → `accent` în toate componentele, `App.tsx` (bara, navigarea, meniul contului), `MarketStrip.tsx`, `ThemeToggle.tsx`, `CommandPalette.tsx`, `AccountWizard.tsx`, `Charts.tsx`, `Today.tsx`, `News.tsx`, `Users.tsx`, `Economy.tsx`, `Settings.tsx`, `Calendar.tsx`, `theme.ts`, `chart/pnl.ts`, testele (`palette.test.ts` nou, `theme.test.ts`), FD / TD / ghid / PROGRESS. Verificat în Chrome pe o copie a datelor (fără cheile Claude și Resend), server de test pe 4399.

## Runda 1 — 10 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Bara (luminos) | Hover-ul alb translucid din bară, pe banda pieței, cobora contrastul textului sub 4,5:1 (gri 4,14, roșu 4,11) — prins de testul nou | hover opac `#304b74`; textele insulei puțin mai deschise (toate ≥ 4,8:1 pe hover) |
| 2 | Banda pieței | Hover-ul (`#2a4166` pe `#1b2d4a`) abia se vedea | același `#304b74` (de 1,6× mai luminos decât banda) |
| 3 | Cipuri (întunecat) | Cipul apăsat sub cursor nu se schimba (chenarul era deja auriu) | token `selected-hover` (auriu 22% / bleumarin `#233b60`) + inel |
| 4 | Segmente, cipuri „soft” | Hover-ul (specificitate 0,3,1) bătea starea selectată (0,2,1): intervalul ales al graficului își pierdea umplerea sub cursor | hover-ul exclude opțiunea selectată (`:not(:disabled, [aria-pressed='true'], [aria-selected='true'])`) |
| 5 | Telefon | Hover-urile din CSS erau `:hover` simplu: după o atingere rândul / butonul rămânea colorat (FD §5: pe telefon fără hover) | toate sub `@media (hover: hover)`, ca utilitarele `hover:` din Tailwind 4 |
| 6 | Meniul contului | Inelul punctului „cereri de cont” rămânea în culoarea butonului când butonul se colora sub cursor | `group-hover:ring-hover` |
| 7 | Tema întunecată | Rândurile alternate (`#131925` pe `#0d1118`) prea discrete | `#151b28` (contrast verificat) |
| 8 | Teste | `theme.test.ts` aștepta fundalul canvas-ului din `--color-ink` | `--color-chart` (FD-THEME2 §2) |
| 9 | Teste | Funcția de culoare din `palette.test.ts` arunca dintr-un IIFE pe un rând | funcție explicită |
| 10 | Documentație | FD: tranziții „≈120 ms” (Tailwind folosește 150 ms); „Sănătate” în loc de „Stare sistem” (FD și ghid) | corectate |

Verificări: `tsc` curat; 356 de teste; build OK (selectorul `:nth-child(2n of :not(.table-detail))` și insula în CSS-ul compilat); Chrome: toate paginile în ambele teme la 1440 și 390 px fără depășiri și fără erori; hover simulat pe 20 de elemente (rânduri, butoane, cipuri, segmente, navigare, căutare, comutator, cont, banda, carduri, liste, primar, ștergere) — fiecare se schimbă vizibil, opțiunile selectate își păstrează umplerea; meniul contului pe culorile paginii; ⌘K, Rezumat, asistentul de conturi; ecranul complet al graficului; comutarea recolorează graficul.

## Runda 2 — 5 probleme (reparate)
Tot codul recitit (toate utilitarele `hover:` rămase, toate fundalurile `panel-2` / `panel-3` / `ink` din componente, `index.html` / `theme.js`, testul de paletă).
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Hover | Butoanele-icon mici (săgețile și mânerul din Setări, ochiul din asistentul de conturi) și „De ce acest scor?” / descrierea sursei își schimbau doar nuanța de gri | `hover:text-accent` (ochiul și fundal `hover`) |
| 2 | Azi (luminos) | Plăcuțele categoriilor (Crypto, Acțiuni…) `#f5f7fa` pe placa albă, fără margine: se topeau | chenar `line-soft` |
| 3 | Azi (luminos) | Pista celor 30 de zile (`panel-2`) abia se vedea pe alb | `panel-3` |
| 4 | Setări | Lista de rezultate a căutării folosea umbra implicită Tailwind (`shadow-lg`), nu umbra temei | `shadow-pop` |
| 5 | Documentație | TD nu spunea că hover-urile sunt sub `@media (hover: hover)`, că opțiunea selectată e exclusă, nici reparațiile de mai sus | TD §6 completat |

Verificări: `tsc` curat; 356 de teste; build OK; Chrome: toate paginile în ambele teme la 1440 px fără depășiri și fără erori.

## Runda 3 — 0 probleme
Forma finală recitită: `styles.css` (paleta, insula, cipul apăsat, toate hover-urile sub `@media (hover: hover)`, specificitățile hover / selectat), toate componentele atinse, testele, FD / TD / ghid / PROGRESS. Fiecare `var(--color-…)` din CSS-ul compilat există în temă (singurul în plus, `--color-white`, vine din Tailwind). `tsc` curat; 356 de teste; build OK; Chrome: toate paginile în ambele teme la 1440 și 390 px fără depășiri și fără erori.

## Ajustare după feedback — rândurile alternate pe tema întunecată
Cererea: „Pe tema întunecată, rândurile alternative ar trebui să aibă o culoare ușor mai ștearsă, pentru că este prea evidentă. Tema albă însă e foarte bună.” `--color-row-alt` (întunecat) `#151b28` → `#12171f` (aproape la jumătatea distanței față de placă `#0d1118`); tema luminoasă neschimbată. FD-THEME2 §3 și TD-THEME2 §2 actualizate.

Runda 1 — 0 probleme: contrastul (testul de paletă) trece pe noul fundal; hover-ul (`#241f15`) rămâne clar diferit de rândul alternat (verificat în Chrome pe tabele și liste); `tsc` curat; 356 de teste; build OK; Chrome pe o copie a datelor: toate paginile pe tema întunecată la 1440 px, fără erori și fără depășiri.

---

# Review — FD-NOAPI / TD-NOAPI (fără platformele care nu au API)

Domeniu: `shared/providers.ts`, `server/exchange/accounts.ts`, `web/components/AccountWizard.tsx`, `ProviderLogo.tsx` (fallback-ul pentru id-uri necunoscute), logo-urile din `public/provider-logos/`, `vite.config.ts` și `src/build/prune-assets.ts`, testele (`providers.test.ts`, `server.test.ts`, `prune-assets.test.ts`), ghidul, FD / TD. Baza reală citită (doar citire): singurul cont e pe KuCoin.

## Runda 1 — 1 problemă (reparată)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Build | Cu `emptyOutDir: false` (FD-STALE), un fișier scos din `public/` (logo-urile XTB, Tradeville, Revolut) rămânea în `dist/web` și era servit la nesfârșit; curățenia atingea doar `assets/` | `pruneRemovedPublic`: în folderele din `public/`, fișierele care nu mai există acolo pleacă după aceeași săptămână; dot-folderele și rădăcina nu sunt atinse; test nou |

Verificări: niciun `available` / `unavailableReason` / id vechi rămas în cod; `tsc` curat; 357 de teste; build OK; Chrome pe o copie a datelor: asistentul arată cele 11 platforme (crypto: KuCoin, Binance, Bybit, OKX, Kraken, Coinbase, Bitget; acțiuni: Trading 212, eToro, Interactive Brokers, Alpaca), filtrul „Acțiuni” pe cele 4, căutarea „xtb” → „Nicio platformă cu acest nume.”, fără erori.

## Runda 2 — 0 probleme
Codul recitit: cardul nu mai are stare dezactivată, lista păstrează ordinea din `PROVIDERS`, serverul refuză orice id necunoscut cu „Platformă necunoscută: …” (testat pentru `xtb`), migrare inutilă (coloana fără CHECK, niciun cont). `tsc` curat; 357 de teste; build OK.

---

# Review — documentația adusă la zi (Sentiq azi)

Domeniu: README, `user-guide.md`, `functional-design.md` și `technical-design.md` (Partea I rescrisă, Partea a II-a cu ce a fost înlocuit), `research.md`, `PROGRESS.md`, `slingshot-port.md`, titlul acestui jurnal. Fiecare afirmație din Partea I verificată în cod: `config.ts`, `http/security.ts`, `http/auth.ts`, `auth/*`, `db/migrations.ts`, `jobs/register.ts`, rutele, `shared/settings.ts` și `server/settings.ts`, `news/sources.ts` și `classify.ts`, `sentiment/*`, `calendar/*`, `market/*`, `exchange/*`, `scanner/`, `summary/`, `mcp/`, `web/App.tsx` și paginile.

## Runda 1 — 7 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | FD / TD | Partea I renumerotată: comentariile din 24 de fișiere de cod („TD §6.4”, „FD §5.4”…) și secțiunile vechi ar fi trimis la alt subiect | numerotarea v1 păstrată pentru aceleași subiecte (FD §0–§9, TD §1–§15); subiectele noi după ele (FD §10–§13, TD §16–§18), cu notă |
| 2 | TD §7.4 | Rezultatele companiilor „cu sursa `earnings`” | sursa e `earn` |
| 3 | TD §2 | Lista câmpurilor redactate în log-uri (`token`) și a apelurilor interzise nu era cea din cod | listele exacte (`apiKey\|api_key\|secret\|password\|passphrase\|claudeKey\|x-api-key`; `createOrder\|cancelOrder\|cancelAllOrders\|editOrder\|withdraw\|transfer\|setLeverage\|setMarginMode`) |
| 4 | TD §11 | Cheile Claude / Twelve Data / Resend marcate „utilizator” | doar admin; `PUT /settings` cu globalele doar pentru admin |
| 5 | TD (tabele) | `\|` în interiorul codului (`GET\|POST`) rupea coloanele tabelelor Markdown | escapat (`\|`), 9 rânduri |
| 6 | README, ghid, FD §0.2, TD §1, PROGRESS | Spuneau că vechiul `scripts/kryptoniq.sh` și `Kryptoniq.app` pornesc în continuare Sentiq; ambele lipsesc acum din proiect (șterse în afara acestei sesiuni) | documentele descriu starea reală (folosește `Sentiq.app` / `scripts/sentiq.sh`); întrebarea dacă scurtătura trebuie repusă rămâne la utilizator |
| 7 | Cod (găsit la verificare) | `ACCOUNT_EXCHANGES = ['kucoin']` în `shared/settings.ts`, rămas din v1, nefolosit nicăieri | șters |

Alte corecturi făcute în timpul scrierii: ghidul spunea „punct auriu” și „butonul auriu” (pe tema luminoasă accentul e turcoaz), „ghid în trei pași” (asistentul are 2), Stare sistem și setările globale fără mențiunea „doar admin”, ordinea paginilor diferită de meniu; FD §10 „conexiunile Claude” (doar când connectorul e pornit).

Verificări: `tsc` curat; 357 de teste; nicio mențiune „Kryptoniq” în părțile curente în afara celor despre fostul nume și compatibilitate.

## Runda 2 — 0 probleme
Recitite în forma finală: README (lista funcțiilor, cele 9 țări / zone ale paginii Economie, 7 exchange-uri și 4 brokeri, ancorele spre ghid), ghidul (părțile schimbate: lansatorul, „De la Kryptoniq la Sentiq”, asistentul în doi pași cu „Conectează”, Setări / Stare sistem cu „doar admin”, ordinea paginilor ca în meniu), FD și TD Partea I (nicio urmă a stării v1: meniu lateral, „fără login”, „doar KuCoin”, `brass`), notele despre ce a fost înlocuit în Partea a II-a, tabelele cu `|` escapat. `tsc` curat; 357 de teste.

---

# Review — FD-AZURE / TD-AZURE (Azure SQL Database; pregătit pentru App Service)

Domeniu: `server/db/*` (config, database, schema, import, codul SQLite păstrat pentru import), toate serviciile devenite asincrone (`settings`, `auth/*`, `mcp/*`, `news/*`, `sentiment/*`, `calendar`, `economy`, `exchange/accounts`, `market/*`, `scanner`, `summary/*`, `jobs/*`), `http/*` (rute, autentificare, securitate / modul Azure, cookie-uri, erori 503), `config.ts`, `main.ts`, `context.ts`, `scripts/*` (admin, db-check, import-sqlite, smoke, sentiq.sh), `web/pages/Health.tsx`, `shared/api-types.ts`, testele (infrastructura de scheme `t_…`, toate fișierele convertite, testele noi), documentele (FD / TD Partea I și secțiunile noi, ghidul, README, `deploy-azure.md`, PROGRESS). Pe lângă recitire: un detector de promisiuni neașteptate (API-ul TypeScript 5, în scratchpad) peste `src/server` și `scripts`, și `tsc` și pe `scripts/` (care nu sunt în `tsconfig`).

## Runda 1 — 15 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Teste (`test/schemas.ts`) | Schemele de test nu se ștergeau: `EXEC(N'…' + QUOTENAME(@s))` nu e voie (funcții în `EXEC(...)`), lotul nu se compila, iar eroarea era înghițită | comenzile se construiesc într-o variabilă și rulează cu `sp_executesql`; eroarea de la final e scrisă; resturile au fost șterse |
| 2 | Teste (scanner) | `vi.useFakeTimers()` oprea și timerele driverului de bază de date → testele se blocau | se falsifică doar `Date` (`toFake: ['Date']`) |
| 3 | Teste (MCP) | Știrea pusă „acum o oră” cădea în ziua de ieri dacă testul rula după miezul nopții (exista și înainte) | „acum o secundă” |
| 4 | Teste (utilizatori) | Mailul pleacă în fundal și își citește setările din bază: linkul apare în jurnal după răspuns, iar `until` folosea `Date`, falsificat | testele așteaptă linkul (`until` cu `performance.now()`) sau un scurt răgaz înainte de a verifica că nu a plecat nimic |
| 5 | Schema / import | SQL Server consumă un număr de identitate și la un `INSERT` respins: id-urile pot avea goluri (în SQLite nu) | testul verifică doar că id-urile continuă; TD-AZURE §3 o spune; nimic din aplicație nu presupune id-uri consecutive |
| 6 | Securitate (login, 2FA, acțiunile cu parolă) | Încercările aceluiași apelant trimise în paralel treceau toate de verificare înainte să fie numărată vreuna (verificarea parolei era deja asincronă; drumurile la baza Azure lărgesc fereastra) | `Throttle.serial`: încercările unei chei rulează una după alta; test nou (5 în paralel → 2 × 400, 3 × 429) |
| 7 | Cereri de cont | Mutarea numărării înaintea răspunsului bazei număra și cererile invalide | `checkRequest` validează întâi; se numără doar cele valide |
| 8 | Pornire (`main.ts`) | O eroare în `createContext` / `buildApp` (o migrare, seed-ul) rămânea o promisiune respinsă, fără mesaj în jurnal | prinsă, scrisă în jurnal, ieșire cu cod 1 |
| 9 | Teste | Numărul de scheme era fix (4); cu `--maxWorkers` mai mare, doi workeri ar fi folosit aceeași schemă | o schemă pentru fiecare worker posibil (`maxWorkers` din configurația Vitest) |
| 10 | Import | Copia de rezervă (când `VACUUM INTO` nu merge) lua doar fișierul principal, nu și `-wal`: ultimele schimbări s-ar fi pierdut | se copiază și `-wal` / `-shm` |
| 11 | `db-check` | „Utilizatorul nu vede alte baze” era fals liniștitor: în Azure SQL `sys.databases` arată mereu doar baza curentă (așa a apărut și pentru `serento_sa`) | detectează adminul serverului (`USER_NAME() = 'dbo'`) și avertizează |
| 12 | Jurnal | Redactarea nu acoperea `pwd=` (din connection string-uri), cum spunea TD-AZURE §1 | adăugat |
| 13 | Scanner pe instanța care nu rulează joburile | Rezultatele sunt în memoria fiecărui proces și niciun buton din interfață nu cere o scanare: pe acea instanță pagina Azi nu ar fi avut niciodată semnale | `GET /api/scanner` pornește o scanare în fundal pe un proces care nu e lider, cel mult o dată pe minut; FD / TD |
| 14 | Teste (contractul joburilor) | Timpii ficși (900 / 1200 ms) cădeau cu suita completă în paralel | testul așteaptă condiția (până la 15 s) |
| 15 | TD-AZURE | Textul nu spunea cum expiră cache-urile (30 s / 5 min), nici despre `Throttle.serial`, mailul în fundal, copia cu `-wal`, schemele per worker; „`@@SERVERNAME`” în loc de serverul din config | aliniat cu codul |

Tot în această sesiune (nu e o problemă a codului): o redenumire făcută cu `git mv` a atins indexul git, pe care utilizatorul nu vrea să-l atingem; intrarea a fost pusă la loc cu `git update-index` (indexul arată ca înainte), iar fișierele se mută de acum doar cu `mv`.

Verificări: nicio urmă de SQL SQLite în codul aplicației (`LIMIT`, `group_concat`, `json_each`, `INSERT OR`, `ON CONFLICT`, `PRAGMA`, `key` fără paranteze); `SELECT *` doar pe tabele ale căror rânduri nu ajung neprelucrate în API (hash-urile calculate nu ies); texte de 250.000 de caractere și 20.000 de rânduri JSON într-un parametru; `tsc` curat (și pe `scripts/`); nicio promisiune neașteptată în afara celor intenționate (verificări `if (pending)` de cache); 381 de teste pe Azure SQL; schemele de test șterse după fiecare rulare.

## Runda 2 — 3 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Cheia master | Fără `SENTIQ_MASTER_KEY` pe Azure (sau fără `data/master.key` pe un alt calculator legat la aceeași bază), `SecretBox.load` făcea în tăcere o cheie nouă: cheile de exchange mutate n-ar mai fi putut fi citite, iar cele salvate de atunci ar fi fost criptate cu altă cheie | `SecretBox.available`; `createContext` refuză să pornească dacă lipsește cheia, dar baza are ceva criptat (conturi, cheile aplicației, TOTP), cu mesaj; o cheie nouă doar pe o bază fără nimic criptat; test; FD-AZURE §2, TD-AZURE §8 |
| 2 | Import | Verificarea cheii la finalul importului folosea `SecretBox.load`, care face o cheie nouă dacă lipsește | verifică doar dacă există; altfel avertizează că Sentiq nu va porni fără ea |
| 3 | Joburi | Un `stop()` venit cât o reînnoire a contractului era pe drum lăsa contractul ținut de un proces oprit până la 60 s | după reînnoire, un proces oprit eliberează imediat contractul (`release`) |

Verificări: `tsc` curat, și pe `scripts/` (cu tipurile proiectului); promisiuni neașteptate: doar verificările intenționate de cache și `dummyHash ??=`; 382 de teste pe Azure SQL; schemele de test șterse.

## Runda 3 — 5 probleme (reparate)
Alte unghiuri: fiecare secvență citire → scriere a fiecărui serviciu (în tranzacție sau protejată de o condiție în `WHERE`), tipurile parametrilor față de coloane, booleenii (`INT` 0 / 1), ordinea rezultatelor folosită de cod, literali SQL cu diacritice fără `N`, concordanța FD-AZURE / TD-AZURE cu codul, pornirea pe **Node 24** (runtime-ul App Service), toate paginile în Chrome pe un server de test legat la o schemă de test cu o copie a datelor.

| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | TD-AZURE §10 | Lista drepturilor refuzate utilizatorilor de test pe `dbo` era incompletă (codul refuză și `REFERENCES`, `EXECUTE`) | aliniată |
| 2 | Stare sistem | „Joburi de fundal” venea din ce știa procesul la ultima reînnoire; pe un proces cu joburile oprite (`SENTIQ_DISABLE_JOBS`) arăta „nu rulează nicăieri” chiar dacă alt proces le rula | `Scheduler.currentLeader()` citește contractul din bază (cu ceasul bazei) |
| 3 | Viteză (de pe Mac) | `/api/health` făcea ~10 interogări una după alta: 1,5–1,9 s de pe Mac (~50 ms pe drum până la Azure); setările ~0,7 s | citirile independente rulează deodată (`Promise.all`): 0,3 s fiecare |
| 4 | Stare sistem | Limita bazei apărea „10240.0 MB”, iar mărimea necitibilă (utilizator fără `VIEW DATABASE STATE`) apărea „?” | `fmtBytes` ajunge la GB („10 GB”); „mărime necunoscută”; test |
| 5 | Teste | Fără acces la bază (fără internet, sandbox) setup-ul global oprea toată suita, și testele care n-au nevoie de bază | setup-ul dă motivul (`missing`), doar testele cu bază îl raportează |

Verificări: serverul pornit pe Node 24.21 cu datele de test (`/api/auth/state` OK, fără avertismente); toate paginile în Chrome, temă întunecată 1440 px și luminoasă 390 px, fără depășiri pe orizontală și fără erori în consolă; 383 de teste; `tsc` curat.

**Incident în timpul verificării.** Serverul de test (Node 24) l-am oprit cu `pkill -f src/server/main.ts -n`, iar comanda a oprit aplicația utilizatorului de pe 4317 („SIGTERM received” la 01:12). Codul vechi (SQLite) nu mai era în folder, așa că am făcut mutarea planificată pentru final, cu aplicația oprită (deci fără scrieri pierdute):
1. backup `data/backups/kryptoniq-before-azure-2026-10-14.db`;
2. `scripts/sentiq.sh import-sqlite`: toate cele 17 tabele cu date, cheia master verificată;
3. pornirea pe codul nou: contul de admin cu parola lui, joburile rulând cu succes pe Azure SQL.

Serverele de test se opresc de acum doar prin lansator (`SENTIQ_PORT=4399 … stop`) sau după PID (notat în memorie).

## Runda 4 — 3 probleme (reparate, toate în documentație)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Ghid | „Datele rămân în `data/`” la oprire: datele sunt acum în Azure SQL | în `data/` rămân conexiunea, cheia master, modelul și jurnalele |
| 2 | TD §14 | Durata suitei (~4–5 min) și cazul „fără acces la bază” (runda 3) nu erau la zi | ~5–6 minute de pe Mac; doar testele cu bază eșuează, cu motivul |
| 3 | FD-AZURE §1 | „Resturile … se șterg la rularea următoare” fără pragul de 3 ore din cod | pragul spus; și ce se întâmplă fără acces la bază |

Codul recitit după runda 3 (citirile paralele din `/api/health` și din setări, `currentLeader`, `fmtBytes`, setup-ul global): fără probleme.

## Runda 5 — 11 probleme (reparate, toate în TD-AZURE)
TD-AZURE recitit integral față de codul final; textul rămăsese în urma schimbărilor din rundele 1–3:
1. §1: `describe()` → `describeDb()`.
2. §2: semnătura lui `Db.open` avea un `log` care nu există; lipsea `Db.shared`.
3. §2: „listele mari se împart la apelant” → loturile merg ca un parametru JSON (`OPENJSON`); un `NULL` într-o coloană `VARBINARY` doar prin `CONVERT`.
4. §2: lipsea apărarea față de o tranzacție rămasă deschisă după un timeout (`IF @@TRANCOUNT > 0 ROLLBACK`; reluarea unei tranzacții care găsește `@@TRANCOUNT > 1`).
5. §3: migrările sunt sub lock-ul de scriere, nu sub un lock `sentiq:migrate`.
6. §3: căutarea duplicatelor după adresă se face pe lot (hash-uri din JSON), nu cu `CAST(@p …)`.
7. §6: `jobsLeader` vine din contract (`currentLeader`).
8. §7: IP-ul din `X-Forwarded-For` e ultimul element, nu primul; numele reale (`req.clientIp`, `req.viaHttps`, `req.behindProxy`).
9. §9: verificarea cheii nu mai folosește `SecretBox.load` (runda 2).
10. §10 / §11: testele SQLite vechi rămân; `db-check` detectează adminul serverului, nu „ce alte baze vede”; `smoke.ts` rulează într-o schemă de test; regiunea = cea a serverului bazei.
11. §12: latența măsurată (~40–60 ms de pe Mac), nivelul bazei (S0), pornirea verificată pe Node 24.

## Runda 6 — 2 probleme (reparate, în FD-AZURE)
1. §3: lipsea cazul „cheia master lipsește pe calculatorul care face mutarea” (runda 2): mutarea se face, avertizează, nu se face o cheie nouă.
2. §7: planul „aplicația rulează codul vechi până la repornire” nu spunea că mutarea a fost făcută (14 oct, backup, `import-sqlite`, pornirea pe codul nou).

Recitite fără probleme: `deploy-azure.md` (pașii, setările, variabilele, firewall-ul, publicarea, domeniul), README, ghidul (Pornire, comenzi, Backup, probleme frecvente), FD Partea I §0, §0.2, §9, §10, §14.

## Runda 7 — 2 probleme (reparate)
1. Teste (`global-setup.ts`): dacă o schemă veche rămasă nu se putea șterge (încă folosită de altă rulare), setup-ul se oprea și toate testele cu bază cădeau → eșecul e doar semnalat.
2. FD-AZURE §3: un `import-sqlite --replace` făcut când Sentiq rulează deja pe Azure pe aceeași bază nu poate fi observat de pe Mac (verificarea e doar pe portul local) → cazul spus: App Service se oprește întâi din portal.

Recitite fără probleme: `test/db.ts` (reset, identități, adminul), `test/schemas.ts`, `db/import-sqlite.ts`, `scripts/import-sqlite.ts`, `/api/health`, `Health.tsx`.

## Runda 8 — 0 probleme
Recitire completă a ce s-a schimbat după runda 7 și a pornirii (`main.ts`: configurația, conectarea, contextul, job-urile, oprirea), plus verificările automate: `tsc` curat (și pe `scripts/`); nicio promisiune neașteptată în afara celor intenționate; 383 de teste pe Azure SQL (35 de fișiere, ~4,5 min); schemele de test șterse la final.

## Runda 9 — publicarea pe App Service, 3 probleme (reparate)
Prima publicare pe App Service (`sentiq`, Austria East, B1) a scos la iveală:
1. **Build-ul pica** cu „vite: not found”: cu `NODE_ENV=production` (setare din ghid), `npm install` al lui Oryx sare peste devDependencies.
   - Reparat cu `scripts/azure-build.sh` (`npm ci --include=dev`, `npm run build`, `npm prune --omit=dev`, `ONNXRUNTIME_NODE_INSTALL=skip`), pornit prin `CUSTOM_BUILD_COMMAND`.
   - Verificat local cu `NODE_ENV=production` pe o copie a zip-ului, apoi serverul pornit din copie pe o schemă de test.
   - Verificat pe Azure: build în 147 s, 104 pachete de dev scoase.
2. **Un login refuzat (firewall) apărea ca „serverul nu răspunde”.**
   - tedious nu pune număr de eroare pe `ELOGIN`, deci pornirea îl reîncerca drept trecător, iar `explainConnectError` vedea doar `DbUnavailableError`.
   - Reparat cu `connectRetryable` (un `ELOGIN` se reîncearcă doar dacă tedious l-a marcat `isTransient`) și cu citirea cauzei în `explainConnectError`. Erorile de rețea păstrează cuvintele driverului.
   - 5 teste noi (`db/connect-errors.test.ts`). Pe Azure, jurnalul spune acum „nu acceptă conexiuni de la IP-ul 68.210.131.80”.
3. **Ghidul** (`deploy-azure.md`) cerea IP-urile de ieșire fără să spună că trebuie **toate** (aplicația iese prin oricare). Apoi, `zip` fără `rm -f` adaugă la arhiva veche. Ambele sunt corectate, la fel și TD-AZURE §11.

## Runda 10 — 1 problemă (reparată)
1. Mesajul pentru utilizator / parolă greșite trimitea doar la `data/database.env`; pe Azure, valorile sunt în setările `SENTIQ_DB_*` ale aplicației. Codul și FD-AZURE §2 spun acum ambele.

## Runda 11 — 0 probleme
Recitite: `connectRetryable`, `explainConnectError`, `Db.open`, testul nou, `azure-build.sh`, `deploy-azure.md` §3–§5, TD-AZURE §2 și §11, FD-AZURE §2. `tsc` e curat, și pe `scripts/`. 388 de teste pe Azure SQL (36 de fișiere). Fișierele de diagnostic folosite pe Azure au fost șterse.

# FD-ONLINE, FD-ADMINSET, FD-AUTOFEED, FD-TODAYGRID (14 oct 2026)

Domeniu:
- server: `settings.ts` (`public_instance`, `publishPublicInstance`, `publicInstance()`, `viewFor` fără Resend pentru utilizatori), `context.ts`, `http/auth-routes.ts` (`publicBase`, `linkBase`, `publicUrl` în starea de login), `mcp/routes.ts` (`registerMcpApi(app, ctx)`), `mcp/oauth.ts` (`listConnections`, `revokeGrantIn`), `news/sources.ts` (ștergerea feed-urilor automate), `jobs/register.ts`, `main.ts`;
- interfață: `pages/Settings.tsx`, `pages/SettingsAdmin.tsx` (nou), `components/SettingsTabs.tsx` (nou), `hooks.ts`, `App.tsx`, `pages/Today.tsx`, `Auth.tsx`, `Security.tsx`, `DaySummary.tsx`, `Charts.tsx`, `AccountWizard.tsx`;
- teste, FD / TD (Partea I și a II-a), ghidul, README, `deploy-azure.md`, PROGRESS.

Verificat înainte de review:
- connectorul pornit pe App Service (metadatele, 401, autorizarea cu documentul real al Claude);
- 391 de teste pe Azure SQL;
- Chrome pe o schemă de test, cu știrile și calendarul reale din ultimele 36 h (admin și utilizator, la 6 lățimi).

## Runda 12 — 3 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | TD-ADMINSET §1 | filele erau descrise „în stilul `.seg`”; codul are file subliniate (`border-accent`) | TD corectat |
| 2 | TD-ONLINE §5 | testul promis pentru cache-ul lui `publicInstance()` (30 s) lipsea | test nou: neschimbat în fereastră, citit din nou după `SETTINGS_TTL_MS` |
| 3 | FD-ONLINE §3 | textul despre passkey din tabel nu era cel din aplicație („sentiq.money” față de „adresa publică”) | FD adus la textul din cod |

Recitite fără alte probleme:
- `syncStockSources` (cascada pe `news` / `news_coins`; grupurile de știri nu depind de rândul șters; o citire a feed-ului în paralel cu ștergerea se oprește cu un avertisment);
- `publishPublicInstance` (loopback, App Service fără adresă, Mac);
- `/api/mcp/status` și `DELETE` pe o instanță fără connector (doar conexiunile proprii; `verify` nu ține nimic în memorie, deci revocarea de pe Mac oprește imediat token-ul pe Azure);
- `linkBase` (activare, cererea nouă; parola uitată rămâne pe adresa de pe care s-a cerut);
- paginile de setări (ancorele după încărcarea listelor de deasupra, `/settings/admin` pentru un utilizator obișnuit, căutarea);
- grila de pe Azi (containerul plăcii de sentiment).

## Runda 13 — 1 problemă (reparată)
1. FD-ONLINE §4: un server de test cu `SENTIQ_PUBLIC_URL=http://localhost:…` „scrie doar în schema lui”; de fapt `publishPublicInstance` nu scrie deloc o adresă loopback. FD corectat.

Recitite fără probleme: `pages/Settings.tsx` întreg (secțiunile, ancorele, nota despre Twelve Data pentru admin și pentru ceilalți), `App.tsx` (ruta, căutarea, bannerul), `Auth.tsx`, `Today.tsx`, ghidul, README, `deploy-azure.md`. `tsc` curat, și pe `scripts/`; verificarea promisiunilor arată doar cazurile vechi, intenționate (cache-uri de cereri în curs), niciunul în fișierele schimbate.

## Runda 14 — 8 probleme (reparate, în TD și un test)
1. §2: „validat cu zod”; verificarea e în `parsePublicInstance` (`parsePublicUrl`, fără loopback, `mcp` doar pentru `true`).
2. §3: `registerMcpApi(app, ctx)` descris de două ori.
3. §4: `AuthState.publicUrl` e opțional (lipsește la un server mai vechi), nu `string | null`.
4. §4: lista fișierelor cu texte schimbate nu avea `SettingsAdmin.tsx` și nota din jurnalul de pornire (`main.ts`).

5. TD-ADMINSET §1: lista din căutare se numește `SEARCH_PAGES`, nu `PALETTE_PAGES`.
6. TD-ADMINSET §1: `useHashScroll` nu spunea că așteaptă listele de deasupra ancorei.
7. TD-AUTOFEED: jurnalul feed-urilor șterse îl scriu și schimbarea favoritelor și ștergerea unui utilizator; testele sunt doar în `news.test.ts`.
8. TD-AUTOFEED: cazul „o sursă manuală cu aceeași adresă rămâne după ce acțiunea iese din favorite” nu era testat → test extins.

Recitit fără probleme: FD-ONLINE întreg (cazurile limită față de cod: `SENTIQ_MCP` scos → Azure scrie `mcp: false`, deci panoul dispare și pe Mac).

## Runda 15 — 1 problemă (reparată)
1. FD-AUTOFEED §3: „feed-ul se citește imediat” la o acțiune adăugată din nou. Pe instanța fără joburi (`job_lease`), `nudge` nu face nimic, deci feed-ul se citește la următoarea rundă `news.fetch` (în cel mult un minut). FD corectat.

Recitite fără probleme: FD-ADMINSET (cazurile limită față de pagini: eroarea cu „Reîncearcă”, Înapoi între file, nota Twelve Data pentru admin / ceilalți), FD-AUTOFEED (BSOL în copiile de siguranță: activ înainte de conturi, oprit după), FD-TODAYGRID (fără favorite: placa goală pe toată lățimea).

## Runda 16 — 0 probleme
Recitite după runda 15: rândul corectat din FD-AUTOFEED, secțiunea connectorului din ghid, README. `tsc` curat (și pe `scripts/`), build-ul trece, 391 de teste pe Azure SQL (36 de fișiere).

## Publicarea (14 oct 2026) — un incident
1. Primul deploy (`2b6506ab`, 12:09 UTC) a fost întrerupt: la 12:11 Azure a mutat aplicația pe alt worker (`…YC` → `…YB`), iar Kudu a repornit în mijlocul `npm ci`.
2. Build-ul apucase să șteargă `oryx-manifest.toml`, deci aplicația, repornită pe noul worker, nu mai dezarhiva `node_modules`. Ieșea cu `exit code 1` după ~25 s, fără nimic în jurnalul Sentiq. sentiq.money a răspuns 503 între 12:11 și 12:27 UTC.
3. Al doilea deploy a fost refuzat (409, „deployment in progress”) din cauza lacătului rămas (`/home/site/locks/deployment`, expira la 12:49).
4. Reparat: am șters lacătul și am republicat aceeași arhivă. Deploy-ul `e246b51e` a reușit (12:27 UTC), cu „removed the automatic feed of BSOL” și „Claude connector on” în jurnal.
5. Pașii au intrat în `deploy-azure.md` §5.

Apoi am repornit aplicația de pe Mac pe codul nou. Ambele instanțe dau `publicUrl: https://sentiq.money`, iar sursa BSOL nu mai e în bază.

# FD-MARKETSRC (14 oct 2026)

Domeniu:
- server: `shared/settings.ts` (`marketData`, `MARKET_EXCHANGES` cu Bitget, `SCANNER_TFS`, `market.exchange` opțional), `market/source.ts` (nou), `market/market.ts` (`lists`, `timeframes`), `settings.ts` (`migrateMarketData`), `context.ts`, `http/routes.ts` (sursa, lumânările, căutarea, scanner-ul, conturile), `scanner/scanner.ts`, `mcp/server.ts`; mesajele „Setări → Admin → …” din `stocks.ts` și `summary/service.ts`;
- interfață: `hooks.ts`, `MarketStrip.tsx`, `CommandPalette.tsx`, `Charts.tsx`, `chart/paths.ts` (`nearestTimeframe`), `Settings.tsx`, `SettingsAdmin.tsx`, `Today.tsx`, `AccountWizard.tsx`;
- teste, FD / TD (ambele părți), ghidul, PROGRESS.

## Runda 17 — 2 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | `market.exchange` | avea valoarea implicită `kucoin`: cu KuCoin și Binance conectate (Binance primul) și nicio alegere, ieșea KuCoin, nu „primul adăugat” (FD-MARKETSRC §2) | câmpul e opțional (lipsește până la o alegere); valorile salvate înainte contează ca alegere; test nou |
| 2 | `Charts.tsx` | cererea pentru timeframe-ul mare (Market Structure) putea pleca înainte să se știe exchange-ul și timeframe-urile lui | pornește doar după ce sursa e cunoscută |

Recitite fără alte probleme: `MarketSource` (cache-ul, „nu listează” față de „nu se poate citi”), migrarea `marketData`, rutele (un `exchange` explicit dintr-un tab vechi, căutarea unită), scanner-ul (cheia de memo cu exchange-ul), `get_chart`, invalidările din interfață după cont / alegere / Admin.

## Runda 18 — 1 problemă (reparată)
1. TD-MARKETSRC §1: `market.exchange` era descris cu valoare; acum e opțional (lipsește până la o alegere). TD corectat.

Recitite fără probleme: FD-MARKETSRC §2–§3 față de cod (cazurile limită: contul ales șters, pana exchange-ului, timeframe-ul vechi al semnalelor, Market Structure), TD §2–§6.

## Runda 19 — 0 probleme
Recitit TD-MARKETSRC §1 după corectură. `tsc` curat (și cu `--noUnusedLocals` pe fișierele atinse), 397 de teste pe Azure SQL (37 de fișiere).

# FD-TRADESTATS (14 oct 2026)

Domeniu:
- server: `exchange/trade-stats.ts` (nou), `exchange/accounts.ts` (`futuresAvailable`, `tradeStats`), `http/routes.ts` (`/api/portfolio/:id/stats`);
- interfață: `shared/api-types.ts`, `pages/Trades.tsx` (cardurile, perioada, butonul mutat), `pages/Settings.tsx` (textul de la Favorite);
- teste, FD / TD, ghidul, PROGRESS.

Verificat înainte de review:
- în citire, pe contul KuCoin real (clasic): soldul futures se citește; 1 / 3 / 3 / 3 poziții închise pe Azi / 7z / 30z / 90z;
- Chrome pe o schemă de test, la 1440 și 390.

## Runda 20 — 2 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Bitget | ccxt pune în `realizedPnl` câmpul `pnl` (înainte de comisioane), iar FD cere rezultatul net | `netResult` folosește `netProfit` al Bitget când există; test |
| 2 | Teste | TD-TRADESTATS §6 promitea exchange fără istoric, eroarea, cache-ul și `force`, Kraken fără futures și eroarea soldului futures; lipseau | adăugate în `server.test.ts` |

Recitite fără alte probleme:
- ccxt pentru Bybit / OKX / Bitget: ora închiderii (`lastUpdateTimestamp`) și rezultatul sunt citite;
- ferestrele, înjumătățirea și paginile OKX;
- `futuresAvailable` (KuCoin `type: 'contract'` iese înainte de tratarea conturilor HF);
- pagina: titlurile cardurilor cu „—”, perioada ținută minte, butonul mutat.

## Runda 21 — 1 problemă (reparată)
1. `Trades.tsx`: după o reîmprospătare eșuată, avertismentul rămânea și pe contul ales apoi → se șterge la schimbarea contului.

Recitite fără alte probleme: `AccountsView`, `CryptoCards` (pe ce date se bazează fiecare card, „…” cât se încarcă, „—” cu motivul), FD-TRADESTATS §2–§4 față de pagină.

## Runda 22 — 0 probleme
`tsc` curat (și pe `scripts/`, și cu `--noUnusedLocals` pe fișierele atinse); verificarea promisiunilor arată doar cazurile vechi, intenționate (mutate la alte linii); 401 teste pe Azure SQL (38 de fișiere).

## Publicarea FD-MARKETSRC + FD-TRADESTATS (14 oct 2026) — același incident
1. Deploy-ul `05b181fd` (14:16 UTC) a fost întrerupt ca la prânz: instanța a repornit pe alt worker (`…RR`) la un minut după începutul build-ului, `oryx-manifest.toml` era deja șters, iar site-ul n-a mai pornit.
2. În Kudu: 1,25 GB din 1,8 GB ocupați, plus 0,7 GB swap. Ambele deploy-uri reușite de azi au rulat cu aplicația deja oprită, deci cauza e memoria B1 (aplicația + build-ul).
3. Reparat la fel: lacătul șters, deploy-ul `4cc0acb2` reușit la 14:24 UTC. Pe Mac, aplicația a fost repornită pe codul nou; `marketData` s-a mutat (KuCoin, 1500).
4. `deploy-azure.md` §5 spune cauza și ce încercăm la următoarea publicare: aplicația oprită întâi.

# FD-MCPMULTI + FD-DBHEAL (14 oct 2026)

Domeniu:
- `config.ts`, `mcp/oauth.ts`, `mcp/routes.ts` (`withClientId`), `Consent.tsx`, `Security.tsx`;
- `db/database.ts` (`detached`, `healStuckLock`, `healing`, `beginLocked`), `jobs/scheduler.ts`, `context.ts`, `main.ts`;
- teste noi (`mcp.test.ts`, `db/heal.test.ts`), FD / TD, ghidul, README, `deploy-azure.md`, PROGRESS.

## Runda 23 — 1 problemă (reparată)
1. README: „connector MCP pentru Claude” → Claude, ChatGPT și Gemini.

Recitite fără alte probleme:
- `withClientId`: formularul are întâietate; aserțiunea doar alege clientul, iar PKCE rămâne verificarea;
- pagina de consimțământ (numele aplicației și hostul ei; ordinea hook-urilor neschimbată);
- autovindecarea:
  - pragul de 5 minute față de tranzacțiile Sentiq: Economie, știrile și calendarul scriu în bloc prin `OPENJSON`, deci durează secunde;
  - verificarea dublă înainte de `KILL`; o dată pe minut;
  - dreptul de `KILL` confirmat pentru `sentiq_app` (folosit la incident);
- `detached` în scheduler: lease-ul și rulările joburilor.

## Runda 24 — 1 problemă (reparată)
1. `db/heal.test.ts`: tipul `Db & { pool … }` se reducea la `never` (`pool` e privat), deci `tsc` pica. Testul trecea, fiindcă vitest ignoră tipurile. Reparat cu un acces separat la câmpurile private; `tsc` e curat.

Verificări: 408 teste pe Azure SQL (39 de fișiere); `tsc` curat (și pe `scripts/`, și fără nimic nefolosit în fișierele atinse).

# FD-UIPOLISH (14 oct 2026)

Domeniu:
- `styles.css` (înălțimea minimă a câmpurilor și a dropdown-urilor), `Today.tsx` (`TrendArrow`), `Settings.tsx` (rândurile favoritelor, rândul de adăugare), `Trades.tsx` (perioada în bara de sus), `News.tsx`, `Security.tsx` (codul pentru Gemini CLI se rupe pe rânduri);
- FD / TD, ghidul.

Verificat înainte de review: Chrome pe o schemă de test, la 1440 și 390 (câmp + buton la 38 px în Admin, Securitate și Surse; săgețile pe fișe; perioada pe același rând cu butoanele).

## Runda 25 — 3 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Știri | regula globală de 38 px făcea câmpul de căutare (fără chenar) mai înalt decât formularul lui de 32 px; ieșea din el, nevăzut, și pe ecranele tactile cu 6 px | `min-h-0` pe câmp; măsurat: 30 px în formularul de 32 |
| 2 | Grafice → Indicatori | previzualizarea liniei (`h-8`, 32 px) stătea lângă dropdown-ul de stil, acum de 38 px | rândul e `items-stretch`, previzualizarea fără `h-8`; măsurat: 38 / 38 |
| 3 | FD | „Telefon: două rânduri” în bara din Tranzacții; la 390 px sunt trei (titlul și conturile, perioada, butoanele) | FD corectat |

Recitite fără alte probleme:
- toate câmpurile și dropdown-urile din `src/web` față de regula nouă: paleta ⌘K (`h-14`), parolele, wizard-ul de conturi, calendarul, economia și prețul mediu din Tranzacții au deja 38 px sau mai mult; câmpurile de culoare sunt excluse;
- `TrendArrow`: eticheta pentru cititoarele de ecran, numele care se taie cu „…”;
- stratul regulii pentru ecranele tactile (`components`) față de excepțiile din Știri (`utilities`, câștigă).

## Runda 26 — 1 problemă (reparată)
1. Știri, pe ecranele tactile: dropdown-ul „Sursă” urca la 36 px, ca cipurile, dar căutarea rămânea la 32 px → formularul căutării are și el `pointer-coarse:h-9`.

Recitite fără alte probleme: reparațiile din runda 25 (stratul `min-h-0` față de regula pentru ecranele tactile; rândul previzualizării, cu valoarea centrată), FD / TD față de cod.

## Runda 27 — 0 probleme
Recitite: toate fișierele din domeniu, după reparațiile din rundele 25–26; măsurat din nou în Chrome (Știri: căutarea 32 / 36 px ca dropdown-ul și cipurile, pe ecran obișnuit / tactil; favoritele: comutatorul și căutarea 48 / 48 pe tabletă; câmpurile din Admin și Securitate la 44 px pe ecran tactil, ca butoanele). `tsc` curat (și pe `scripts/`); 408 teste pe Azure SQL (39 de fișiere).

# FD-MCPMULTI + FD-DBHEAL — runda de închidere (14 oct 2026)

## Runda 28 — 0 probleme
Rundele 23 și 24 au avut câte o problemă; aceasta e runda fără probleme, după ele. Recitite:
- `withClientId` (antetul Basic, `client_assertion` neverificat, dar codul rămâne legat de client, de adresa de întoarcere și de PKCE), CIMD cu `none` printre metode, DCR cu metodă cu secret → client public, gazdele implicite;
- autovindecarea: interogarea lacătului (resursa `sentiq:write:<schema>`, sub 32 de caractere și pe schemele de test), vârsta tranzacției (ora serverului, UTC pe Azure, ca `SYSDATETIME()`), verificarea dublă, `KILL` doar pentru sesiunile `Sentiq`, o dată pe minut; `detached` la lease și la rulările joburilor; oprirea forțată după 15 s.

Verificat după publicare (deploy `608d7489`, 15:21 UTC): metadatele OAuth (`none`, CIMD), `authorize` cu documentul real ChatGPT și cu cel Claude ajung la consimțământ; niciun lacăt ținut în bază.

## Publicarea FD-MCPMULTI + FD-DBHEAL + FD-UIPOLISH (14 oct 2026)
1. Prima publicare după procedura nouă (`deploy-azure.md` §5): aplicația oprită la 15:10 UTC, arhiva urcată, build-ul terminat cu aplicația oprită, aplicația pornită la 15:20, site-ul răspunde din 15:21. Pauză planificată: ~11 minute; build-ul nu s-a mai întrerupt.
2. `az webapp deploy --async true` așteaptă totuși pornirea site-ului (oprit), deci comanda nu se termină singură: pasul `az webapp start` se dă când `/api/deployments/latest` arată `status 4`, `complete true`.
3. Pe Mac, aplicația repornită pe codul nou (18:22 ora României); joburile rulează pe Mac.

# FD-INDICES (14 oct 2026)

Domeniu:
- comune: `shared/indices.ts` (nou), `shared/settings.ts` (`CHART_SYMBOL_RE`), `shared/api-types.ts`;
- server: `market/indices.ts` (nou), `market/stocks.ts` (clasa Nasdaq fixă, rutarea în `StockData`), `http/routes.ts`, `scanner/scanner.ts`, `exchange/accounts.ts`, `news/coin-registry.ts`, `news/coins.ts`, `news/query.ts`, `mcp/server.ts`, `summary/context.ts`;
- interfață: `Settings.tsx` (`IndexPicker`, schimbările în curs), `Today.tsx`, `MarketStrip.tsx`, `Charts.tsx`, `CommandPalette.tsx`, `News.tsx`, `icons.tsx`, `chart/paths.ts`, `App.tsx`;
- teste noi, FD / TD, ghidul, README, PROGRESS.

Verificat înainte de review: Chrome pe o schemă de test, cu date reale de la Cboe și Nasdaq (toți 7 indici, 1440 și 390 px); a găsit o problemă veche din Setări (răspunsurile la adăugări rapide, în altă ordine), reparată și trecută în FD.

## Runda 29 — 4 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | `listWatchlist` | tipul se citea dintr-un obiect (`KINDS[w.kind]`), deci un text ca `toString` ar fi întors o funcție din prototip | comparație directă cu `stock` / `index`, altfel `crypto` |
| 2 | Cboe | un 403 (Cloudflare blochează uneori centrele de date) devenea „indice necunoscut”, deși se cer doar codurile din catalog | orice răspuns în afară de 200 e eroarea sursei („Cboe: HTTP 403”); rândul nou în FD §3 |
| 3 | FD | pomenea căutarea „Altă pereche sau acțiune”; textul nou e „Pereche, acțiune sau indice” | FD corectat |
| 4 | FD | lipsea cazul unei pagini deschise de dinainte de publicare | rând nou în FD §3 |

Recitite fără alte probleme:
- `StockData`: excepția din `indexCandles` ajunge ca respingere (apelată din `candles`, care e `async`); cache-ul lumânărilor și ultimele lumânări bune la o eroare; `quote` / `spark` după `^`;
- `IndexData`: lumânarea zilei nu se dublează (seara, în weekend, cu istoricul deja publicat), `DJX × 100` și pe cotație, cererile simultane unite;
- scanner-ul (cheia rândului, timeframe-ul indicelui, piața închisă), `accounts.ts`, știrile (aliasurile cu prioritate, filtrul „doar favorite” citește `^SPX` din favorite), MCP (`timeframesFor`, HTF), Rezumatul;
- interfața: id-urile cipurilor din Grafice și din ⌘K, `savedSymbol` / `rememberedPath`, insigna (după `useState`), titlul cu întârzierea.

## Runda 30 — 1 problemă (reparată)
1. Rândul nou din FD §3 (Cboe refuză → eroarea sursei) nu avea test → `CboeClient` în `market/indices.test.ts`: 403 → „Cboe: HTTP 403”, un răspuns care nu e JSON → „Cboe: răspuns neașteptat”, adresa CDN-ului.

Verificat și: Cboe și Nasdaq răspund de pe Azure (din Kudu, aceleași IP-uri de ieșire ca aplicația): 200 pentru cotația SPX, istoricul VIX și NDX.

Recitite fără alte probleme: reparațiile din runda 29; `IndexPicker` și numărarea schimbărilor în curs (`onSettled` vine și după o eroare); scanner-ul cu Market Structure pe un timeframe pe care indicii nu-l au; promptul `analyze_symbol`.

## Runda 31 — 0 probleme
Recitit testul nou și FD / TD / ghidul față de cod. `tsc` curat (și pe `scripts/`, și fără nimic nefolosit în fișierele atinse).

Suita: prima rulare a avut un singur eșec, în pregătirea primului test din `server.test.ts`: SQL Server a ales tranzacția testului ca victimă a unui deadlock (1205) în schema de test, nelegat de indici; fișierul a trecut singur, iar a doua rulare a întregii suite a trecut: 428 de teste pe Azure SQL (41 de fișiere). E primul deadlock din toate rulările de azi; dacă revine, se cercetează separat.

## Publicarea FD-INDICES (14 oct 2026)
Procedura din `deploy-azure.md` §5, a doua oară: aplicația oprită la 16:11 UTC, build-ul `6330eb3b` gata în 3,5 minute, site-ul răspunde din 16:16. Niciun lacăt ținut în bază după pornire. Pe Mac, aplicația repornită pe codul nou (19:16 ora României); fără migrare de schemă, deci fără backup.

# FD-ROWCENTER + FD-SELECTSAFARI + FD-AICLARITY (14 oct 2026, seara)

Domeniu:
- `Settings.tsx` (rândurile favoritelor, panoul connectorului), `styles.css` (dropdown-urile), `News.tsx`, `Charts.tsx`;
- `components/AiConnector.tsx` (nou, mutat din `Security.tsx`), `Security.tsx`, `SettingsAdmin.tsx` (`KeyUse`), `DaySummary.tsx`, `App.tsx` (⌘K);
- server: `sentiment/usage.ts` (nou), `sentiment/claude.ts` (`onUsage`), `sentiment/service.ts`, `summary/service.ts`, `context.ts`, `http/routes.ts` (`claudeUsage` în `/api/health`), `shared/api-types.ts`;
- `deploy-azure.md` (planul B2, publicarea fără oprire), FD / TD, ghidul, teste noi (`usage.test.ts`, motorul Claude, Rezumatul, `/api/health`).

Verificat înainte de review:
- rândurile favoritelor, măsurate față de mijlocul rândului: −2,9 px înainte, 0 după (1440 și 390);
- auditul controalelor (`wk/audit.mjs`) în WebKit și Chrome, pe toate paginile, la 1440 și la 390 cu ecran tactil: dropdown-urile au 38 / 44 px și în WebKit (erau 22);
- panoul connectorului, blocul de consum și Securitate, în WebKit.

Găsite și reparate pe drum, înainte de review:
1. Adresa connectorului (31 px) lângă „Copiază” (38 px) → `min-h-[38px]`.
2. Cu un server mai vechi, consumul ar fi rămas „…” la nesfârșit → „consumul nu e disponibil”.
3. Un link spre `/settings#ai` derula înainte să apară panoul (care își încarcă starea) → pagina așteaptă și starea connectorului.
4. Rezumatul număra tokenii abia după ce citea răspunsul: unul refuzat sau tăiat, deși plătit, nu se număra → numărat imediat după răspuns (și testat).

## Runda 32 — 0 probleme
Recitite:
- CSS-ul dropdown-urilor: niciun `select` nu are padding orizontal propriu care să acopere săgeata; săgeata ia `--color-muted` în ambele teme; lista deschisă rămâne a sistemului;
- `ClaudeUsage`: tranzacția (doi scriitori, Mac și Azure; testat), ziua UTC, valori negative sau nefinite numărate ca zero, nicio eroare propagată;
- `onUsage` apelat fără `await` în scorare (nu o încetinește), cu `await` la Rezumat; `/api/health` rămâne doar pentru admin;
- textele: connectorul (ce face, ce nu face, starea „oprit”), blocul din Admin (motor Local, fără cheie, consumul), subsolul Rezumatului, trimiterea din Securitate.

Verificări: `tsc` curat (și pe `scripts/`); 433 de teste pe Azure SQL (42 de fișiere).

## Publicarea FD-ROWCENTER + FD-SELECTSAFARI + FD-AICLARITY (14 oct 2026)
Prima publicare pe B2, fără oprirea aplicației: deploy `d6965246`, build în 1,7 minute, `/api/ping` 200 pe toată durata, codul nou pornit la 17:01:34 UTC; `az webapp deploy` s-a terminat singur. Niciun lacăt rămas. Pe Mac, aplicația repornită la 20:02 ora României.

# FD-MCPREMOVE (14 oct 2026, seara)

Domeniu:
- șterse: `src/server/mcp/` (cu `mcp.test.ts`), `Consent.tsx`, `AiConnector.tsx`, dependențele `@modelcontextprotocol/server` și `/client`;
- server: `config.ts`, `context.ts`, `http/app.ts`, `http/security.ts`, `http/auth-routes.ts`, `jobs/register.ts`, `main.ts`, `settings.ts`, `summary/context.ts` (fără `forTools`), `db/schema.ts` (migrarea 2), `shared/api-types.ts`;
- interfață: `App.tsx`, `Settings.tsx`, `Security.tsx`, `DaySummary.tsx`, `SettingsAdmin.tsx`;
- teste: `public-instance.test.ts` (nou: testele FD-ONLINE, care erau în `mcp.test.ts`), linkul de activare spre adresa publică (`users.test.ts`), adresele fostului connector (`server.test.ts`);
- FD / TD (Partea I și secțiunile noi), ghidul, README, `deploy-azure.md`.

Înainte: `SENTIQ_MCP` scos din App Service (la cererea utilizatorului); backup al celor 4 tabele în `data/backups/sentiq-mcp-tables-2026-10-14.json` (o conexiune Claude, făcută de utilizator la 16:34 UTC și ștearsă de el din Claude).

## Runda 33 — 0 probleme
Recitite:
- ordinea din migrarea 2 (`mcp_tokens` și `mcp_codes` înaintea `mcp_grants`, apoi `mcp_clients`; `IF EXISTS`); `TABLES` / `IDENTITY_TABLES` (testul schemei compară lista cu baza; importul SQLite sare tabelele care nu mai sunt în listă);
- CSRF-ul: fără excepția pentru rutele Bearer, orice cerere ne-GET cere din nou `X-Sentiq`; adresele vechi răspund 404 JSON, nu cu pagina;
- `public_instance` fără `mcp` (un rând vechi se citește la fel); linkurile de activare de pe Mac (testate);
- nicio altă referință la connector în cod (`tsc` curat și cu `--noUnusedLocals` pe fișierele atinse);
- ordinea publicării: întâi Mac-ul (migrează baza la 2 și ține joburile), apoi Azure. Versiunea veche de pe Azure nu mai atinge tabelele: connectorul e oprit acolo din 17:34 UTC.

Verificări: `tsc` curat (și pe `scripts/`); 422 de teste pe Azure SQL (42 de fișiere).

## Publicarea FD-MCPREMOVE (14 oct 2026)
Întâi Mac-ul: repornit la 20:46 ora României; baza e la versiunea 2, fără tabelele `mcp_*`. Apoi Azure: deploy `3c6e980b`, codul nou pornit la 17:48:33 UTC, fără oprire. `/api/ping` 200, `/mcp` și `/.well-known/oauth-authorization-server` 404. Niciun lacăt rămas.

# FD-TDPLAN + FD-INDEXINTRA (14 oct 2026, seara)

Domeniu:
- server: `market/stocks.ts` (`CreditBudget` pe planul cheii, `TwelveDataClient.plan`, `StockData.refreshPlan`, indicii intraday în `load`), `market/cnbc.ts` (nou), `market/indices.ts` (CNBC întâi, rezerva, `mergeNy`, `intraday`), `jobs/register.ts` (`twelvedata.plan`), `http/routes.ts` (planul la salvarea cheii, `POST /api/settings/twelvedata-plan`), `http/auth.ts`;
- comune: `shared/indices.ts` (`INDEX_TIMEFRAMES`, nota); interfață: `SettingsAdmin.tsx` (`TdPlanLine`), `Health.tsx`, `Charts.tsx`, `Today.tsx`, `MarketStrip.tsx`;
- teste: `cnbc.test.ts` (nou), `indices.test.ts`, `stocks.test.ts`, `server.test.ts`, `scanner.test.ts`; FD / TD, ghidul.

Cercetare: CNBC (cotații în timp real, zilnic din 2010, intraday ~100 de zile; răspunde de pe Azure), Massive / Polygon (oficial, 49 $ / 99 $), Twelve Data (fără indici americani în catalog), FMP / EODHD (intraday doar plătit), Yahoo / Stooq (refuză). `/api_usage` din specificația OpenAPI Twelve Data (1 credit; `plan_daily_limit` doar pe planurile cu limită).

Verificat înainte de review: WebKit pe o schemă de test, cu date CNBC reale (SPX pe 1h, cu Slingshot; 6h / 8h / 12h dezactivate; fișele de pe Azi pe 1h).

## Runda 34 — 2 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Nota de întârziere | o cotație CNBC nemarcată „în timp real” ar fi primit nota „(sursa de rezervă)”, care nu era adevărată | nota spune doar „până la 15 minute întârziere”; FD menționează ambele cazuri |
| 2 | TD-TDPLAN | promitea că un plan citit pentru altă cheie e ignorat, dar limitele nu verificau asta (la schimbarea cheii, planul se recitește sau se șterge oricum imediat) | TD corectat: `keyHint` e pentru diagnostic |

Recitite fără alte probleme:
- bugetul (limitele fixe din teste față de cele din plan, fără limită zilnică, recitirea la 5 minute, ștergerea cheii);
- `plan()` (1 credit, eroare la un răspuns fără `plan_limit`); jobul la 6 ore pe instanța cu joburile; ruta doar pentru admin;
- CNBC: sfârșitul exclusiv al intervalului, filtrul ședinței (bara de 9:00 pe 1h, cea de 16:00 sărită), comasările pe ceasul New York;
- cache-ul intraday pe index și interval (o citire mai lungă servește și cererile mai scurte), cererile simultane unite;
- rezerva (cotații și zilnic), sursa numită pe grafic; scanner-ul pe timeframe-ul ales.

## Runda 35 — 0 probleme
Recitite reparațiile din runda 34 și FD / TD / ghidul față de cod. Verificat în WebKit: planul Grow citit din bază apare în Admin („55 cereri pe minut, fără limită zilnică”, consumul fără „/ 800”) după recitirea de 5 minute. `tsc` curat (și pe `scripts/`); 434 de teste pe Azure SQL (43 de fișiere).

## Publicarea FD-TDPLAN + FD-INDEXINTRA (14 oct 2026)
Azure: deploy `19c474cd`, codul nou pornit la 18:26:15 UTC, fără oprire. Mac: repornit la 21:26 ora României; ține joburile și a citit planul cheii reale: „twelvedata: plan basic, 8 credits a minute, 800 a day” (înainte de upgrade). Niciun lacăt rămas.

# FD-AIKEYS + FD-TDKEYS (16–17 oct 2026)

Domeniu (tot codul nou și impactul lui; fiecare rundă îl recitește întreg):
- server: `ai/` (nou: `types.ts`, `http.ts`, `openai.ts`, `gemini.ts`, `anthropic.ts`, `models.ts`, `service.ts`, `usage.ts`), `sentiment/ai-scorer.ts` (nou), `sentiment/service.ts`, `sentiment/daily.ts`, `news/query.ts`, `news/ingest.ts`, `summary/service.ts`, `summary/context.ts`, `settings.ts` (cheile personale în `user_keys`, mutările de la pornire), `db/schema.ts` (migrarea 3), `context.ts`, `http/routes.ts`, `http/auth.ts`, `http/auth-routes.ts`, `http/app.ts`, `jobs/register.ts`, `market/stocks.ts` (`StockData` și `CreditBudget` per utilizator), `scanner/scanner.ts`;
- comune: `shared/ai.ts` (nou), `shared/settings.ts`, `shared/api-types.ts`;
- interfață: `components/AiSettings.tsx` și `components/StockDataSettings.tsx` (noi), `Settings.tsx`, `SettingsAdmin.tsx`, `DaySummary.tsx`, `News.tsx`, `Health.tsx`, `Charts.tsx`;
- teste: `ai/providers.test.ts`, `ai/service.test.ts` (noi), `ai/usage.test.ts`, `sentiment.test.ts`, `impact.test.ts`, `summary.test.ts`, `server.test.ts`, `users.test.ts`, `stocks.test.ts`, `indices.test.ts`, `scanner.test.ts`; FD / TD, ghidul, README.

Cercetare: modelele curente OpenAI și Gemini (16 oct 2026; ID-uri retrase în octombrie → lista citită din cheie), Responses API (JSON Schema strict, `store: false`), `generateContent` (`responseJsonSchema`, `thinkingLevel`), erorile fiecărui furnizor; Twelve Data (Basic 8 / minut, 800 / zi, `/api_usage`, atribuirea).

Verificat înainte de review: 456 de teste pe Azure SQL; Chrome pe o schemă de test cu furnizori simulați (adminul cu cheia Claude mutată, alt utilizator cu ChatGPT; 1280 și 390 px). Verificarea a prins deja ordinea mutării la pornire (reparată, cu test).

## Runda 36 — 4 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | `AiService.setKey` | după salvare, `forget` ștergea și lista de modele tocmai citită: furnizorul era întrebat din nou la deschiderea listei | se uită doar alegerea (`configs`); lista rămâne, legată de amprenta cheii |
| 2 | `CreditBudget` per utilizator | bugetul unui utilizator, făcut la prima cerere, răspundea la `/api/stocks/info` și la primele cereri înainte să-și citească planul și consumul din bază („Basic (presupus)”, limita zilnică neverificată) | `TwelveDataClient.get` și ruta așteaptă `budget.ready` |
| 3 | TD-AIKEYS / PROGRESS | numele vechi al tabelei (`user_ai_keys`) | `user_keys` |
| 4 | TD-AIKEYS | spunea că mutarea AI rulează „după celelalte migrări de setări”; codul (corect) o rulează înaintea lui `migrateMarketData` | TD corectat, cu motivul |

Recitite fără alte probleme: SQL-ul (parametrii `?` / `@` nu se amestecă; ordinea parametrilor la `LEFT JOIN … a.user_id = ?` înaintea `WHERE` în indice, știri și contextul Rezumatului), migrarea 3 (cascadele din `users` și `news`), mutările de la pornire (idempotente, în tranzacții), cheile (doar hint-ul, doar pentru proprietar; nimic în log-uri sau în mesajele de eroare), clienții (reîncercări doar pe erori trecătoare, abandonul apelantului, timeout-ul neîncercat din nou), nicio buclă care plătește de două ori același lot (refuz / răspuns necitit → rând fără scor), cache-urile (30 s pentru alegere, scorer refăcut la altă cheie / model), scanner-ul (rândul acțiunii cu cheie e al utilizatorului), scripturile (`tsc` curat).

## Runda 37 — 6 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | `PUT /api/settings` | o schimbare de model / furnizor uita și listele de modele ale cheilor: panoul cerea din nou lista de la furnizor la fiecare schimbare | `AiService.forgetChoice` (doar alegerea); `forget` rămâne pentru ștergerea utilizatorului |
| 2 | Starea scorării AI | eroarea și pauza stăteau în memoria instanței cu joburile: cu pagina servită de cealaltă instanță (Mac / Azure), panoul nu arăta niciodată o cheie refuzată | starea se scrie în `market_cache` (`ai:scorer:<userId>`, legată de furnizor / model / cheie), în ordine, așteptată la sfârșitul rundei; `aiStatus` o citește; ștearsă cu utilizatorul; test cu două instanțe |
| 3 | `settings.ts` | `secret()` rămăsese nefolosit | scos |
| 4 | `settings.ts` | comentariul lui `viewFor` spunea că hint-urile cheilor sunt doar ale adminului | corectat (cheile proprii, pentru proprietar; emailul, pentru admin) |
| 5 | `ai/service.test.ts` | o variabilă nefolosită | scoasă (`tsc --noUnusedLocals` curat pe fișierele atinse) |
| 6 | TD-AIKEYS | riscul nenotat: Google numește `generateContent` „Legacy” (recomandă Interactions API) | notat, cu calea de trecere; `thinkingLevel: "low"` confirmat în ghidul oficial Gemini 3 |

## Runda 38 — 2 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | FD-TDKEYS / TD-TDKEYS / ghidul | spuneau că o cheie Twelve Data nouă „începe ziua de la zero”; codul (corect) o verifică pe un buget al ei și pornește de la cererile ei (verificarea, planul) | textele corectate (și `reset(spent)` descris cu așteptarea primei citiri) |
| 2 | Teste | TD-TDKEYS promitea un test al scanner-ului cu și fără cheie, care lipsea | test nou: trei utilizatori, doi cu cheie (rândul fiecăruia, cu cheia lui), unul fără (zilnicul comun); cheia ștearsă → rândul comun, fără cerere nouă |

Recitite fără alte probleme: `ai/http.ts` (abandonul în timpul așteptării dintre reîncercări, limita de mărime), scorer-ul și starea lui (scrierile în ordine; o eroare permanentă la repornirea instanței cu joburile: o singură cerere refuzată, gratuită), retenția (scorurile AI pleacă odată cu știrile; istoricul zilnic nu se taie nici pentru cel comun), FD-AIKEYS față de cod (textele panoului, valorile implicite, tabelul de cazuri limită), scripturile. `tsc` curat (și cu `--noUnusedLocals` pe fișierele atinse), build curat, 458 de teste pe Azure SQL.

## Runda 39 — 0 probleme
Recitit tot domeniul (cele două funcționalități și impactul lor): `shared/ai.ts` (motoarele, modelele implicite, `effectiveModel`), migrarea 3 (cascadele: niciun drum dublu), rutele (CSRF pe toate scrierile, cheile doar ale utilizatorului, `forgetChoice` / `forget`), log-urile și mesajele (nicio cheie), ștergerea și dezactivarea unui utilizator (chei, scoruri, istoric, consum, starea scorării, bugetul Twelve Data), scanner-ul (rândul cu cheie al fiecăruia, cel comun fără), interfața (panourile, textele fără gen gramatical pentru utilizatori, legăturile spre `/settings#ai` și `/settings#stock-data`).

Verificat în Chrome pe o schemă de test, cu cheile vechi ale adminului (Claude cu motorul Claude și Sonnet; Twelve Data cu planul Grow și 37 de cereri azi): după pornire, adminul are ambele chei, cu modelul, scorul, planul și consumul mutate; Ana, fără chei: acțiunile pe 1d / 1w, cu mesajul și linkul spre setările ei, Rezumatul cere cheia; Stare sistem: 1 utilizator cu cheie Twelve Data, 1 cu scorul pe AI. `tsc` curat (și pe `scripts/`), build curat, 458 de teste pe Azure SQL (45 de fișiere).

## Publicarea FD-AIKEYS + FD-TDKEYS (16 oct 2026)
- Primul deploy (`9be0ed8b`, 22:08 UTC, cu aplicația pornită, ca pe B2 până acum): build întrerupt de o repornire a Kudu (~22:11); manifestul deja șters → aplicația nu a mai pornit (`Cannot find package 'mssql'`), blocată de Azure după pornirile eșuate. Site căzut 22:11–22:27 UTC. `az webapp deploy` a raportat totuși „completed successfully” (endpoint-ul lui de stare a dat timeout).
- Reparat: aplicația oprită, lacătul `/home/site/locks/deployment` șters (niciun `npm` nu mai rula), aceeași arhivă publicată din nou (`d724277f`, build 22:20–22:23:29), `az webapp start`. Codul nou a pornit la 22:27:03 UTC: migrarea 3, „the Claude key and engine are now the admin's own”, „the Twelve Data key is now the admin's own”, „Sentiq running”; `/api/ping` 200.
- Mac: preluase joburile cu codul vechi cât Azure era oprit; repornit pe codul nou la 22:27:59 UTC (ține joburile).
- Verificat în bază: schema 3; nicio cheie globală rămasă; adminul are cheile Anthropic și Twelve Data, scorul pe Claude (`claude-opus-5-5`), 8.083 de scoruri Claude mutate, planul și consumul Twelve Data; după un minut: scorarea AI a adminului merge (35 de știri, tokenii înregistrați), rescorarea locală a celor 6.454 de știri din ultimele 4 zile avansează, joburile fără erori.
- `deploy-azure.md`: publicarea doar cu aplicația oprită; capcanele urmăririi (Kudu, `complete` cu literă mică, Mac-ul la o schimbare de schemă).

## Runda 40 — importanța cu sursa ei (18 oct 2026) — 0 probleme
Recitite cele trei ramuri din „De ce acest scor?” (`News.tsx`): notă AI diferită de cuvinte-cheie (două valori, fiecare cu sursa), egală (o valoare, ambele surse), fără notă AI (doar cuvinte-cheie); motorul necunoscut tot „AI”; `1,5` formatat ca înainte; niciun test sau text din altă parte nu depindea de formularea veche (căutat în `src/` și `docs/`). Documentele (FD, TD-IMPACT §5, ghidul) spun la fel. `tsc` curat.

# FD-2FA — autentificarea în doi pași, obligatorie (18 oct 2026)

Domeniu (tot codul nou și impactul lui; fiecare rundă îl recitește întreg):
- **server:**
  - `auth/users.ts` (schimbarea aplicației, `confirmTwoFactor` → `'on'`; scoase `cancelTwoFactor` / `disableTwoFactor`);
  - `auth/sessions.ts` (scos `destroyPending`), `auth/email.ts` (3 anunțuri);
  - `http/auth.ts` (bariera `TWO_FACTOR_REQUIRED`);
  - `http/auth-routes.ts` (activarea care intră în cont, `enable` cu sesiunile închise, `replace*`, resetarea de către admin);
  - `db/schema.ts` (migrarea 4);
- **scripturi:** `admin.ts`, `smoke.ts`;
- **comune:** `shared/api-types.ts`;
- **interfață:**
  - `auth.ts` (depozitul configurării), `api.ts`, `App.tsx`;
  - `pages/Auth.tsx` (`TwoFactorSetupPage`, activarea, prima parolă, `SignedInAuthRoutes`), `pages/Security.tsx`, `pages/Users.tsx`;
  - `components/RecoveryCodes.tsx` și `components/TotpQr.tsx` (noi);
- **teste:** `users.test.ts`, `server.test.ts`, `source.test.ts`, `summary.test.ts`, `api.test.ts`;
- **documente:** FD / TD, ghidul, README.

Cercetare:
- OWASP MFA Cheat Sheet: al doilea factor pentru toți; reautentificare cu un factor existent la schimbare; anunț pe alt canal; resetare sigură.
- Riscul înrolării după un login doar cu parola (Mandiant, APT29).
- Baza de producție: 2 conturi, amândouă cu 2FA.

Verificat înainte de review:
- `tsc` curat;
- 463 de teste pe Azure SQL (45 de fișiere);
- Chrome pe o schemă de test:
  - activarea → configurarea (cod greșit, apoi bun) → codurile (rămân și după recitirea stării) → Azi;
  - Securitate → „Schimbă aplicația de autentificare” → QR nou → confirmat;
  - Utilizatori („2FA neconfigurat”, „Resetează 2FA”);
  - la 390 px, Bob (cont vechi fără 2FA): login → configurare (un link spre `/news` arată tot configurarea) → `/news`;
  - fără erori în consolă.

## Runda 41 — 4 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | `auth-routes.ts`, `scripts/admin.ts` | comentariile de antet depășeau lățimea de rând a proiectului | rescrise pe mai multe rânduri |
| 2 | `web/auth.ts` | `useEnrolment` dădea lui `useSyncExternalStore` o funcție de abonare nouă la fiecare randare (dezabonare și reabonare la fiecare randare) | abonarea și citirea, funcții stabile la nivel de modul |
| 3 | `TwoFactorSetupPage` | „Cheie nouă” după o configurare terminată în alt tab arăta eroarea „deja activă”, în loc să deschidă aplicația (doar „Activează” o trata) | `TWO_FACTOR_ON` tratat în `run` pentru ambele acțiuni: starea se recitește, aplicația se deschide |
| 4 | FD-2FA | butonul era numit „Cheie nouă” (pe ecran: „Am scanat pe alt telefon: cheie nouă”); un rând spunea „pagina se reîmprospătează” (o reîncărcare a paginii pierde codurile; e vorba de recitirea stării) | textele aliniate cu ecranul; lipsa lui „Renunță” la configurare, notată |

Recitite fără alte probleme:
- bariera (ordinea în hook, `HEAD` → `GET`, rutele publice, adminul fără 2FA);
- schimbarea aplicației (pragul 0 pe secretul nou, cu motivul lui; aplicația veche până la confirmare; codurile de recuperare păstrate; `'none'` după terminare în alt tab);
- sesiunile (cele deschise înainte de configurare se închid; resetarea închide tot);
- emailurile (fără link sau cod; în fundal);
- interfața (activarea → configurare → `/`; prima parolă; ținta de după login peste `/activate`; codurile păstrate până la „Intră în Sentiq”; evenimentul `TWO_FACTOR_REQUIRED`).

## Runda 42 — 2 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | TD §11 (tabelul API) | „Contul meu” lista încă `2fa/cancel` și `2fa/disable` și nu spunea ce poate un cont fără 2FA | rutele de acum (`replace`, `replace/confirm`, `replace/cancel`) și bariera |
| 2 | TD §3 (baza de date) | versiunile schemei se opreau la 2, iar tabelele FD-AIKEYS / FD-TDKEYS (`user_keys`, `news_ai_scores`, `ai_daily_sentiment`) lipseau din listă (rămas din publicarea anterioară) | versiunile 3 și 4; rândurile tabelelor; `totp_next_secret` la `users` |

Recitite fără alte probleme:
- rutele din afara `/api` (doar `index.html`): nimic nu ocolește bariera;
- `UPDATE … SET totp_secret = totp_next_secret, totp_next_secret = NULL` (T-SQL folosește valorile de dinainte);
- ordinea hook-urilor în `TwoFactorSetupPage` / `SignedInAuthRoutes` (toate înaintea primului `return`);
- referințele rămase la comportamentul vechi (`welcome=1`, `Oprește 2FA`, `destroyPending`): doar în istoric și în testele care verifică că au dispărut.

`tsc` curat (și pe `scripts/`, și cu `--noUnusedLocals` pe fișierele atinse), build curat.

## Runda 43 — 4 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | FD-2FA §1 | „pagina închisă înainte de final: la următorul login…” era inexact: sesiunea (30 de zile) rămâne, deci ecranul revine la simpla redeschidere | „la următoarea deschidere… iar dacă între timp sesiunea s-a încheiat, după login” |
| 2 | FD-2FA §6 | „o nouă «Schimbă…» începe de la capăt” lăsa de înțeles că butonul apare cât schimbarea e începută (ecranul arată atunci doar „Confirmă” / „Renunță”) | „după «Renunță», o nouă «Schimbă…»” |
| 3 | FD-2FA §6, ghidul | ordinea recomandată după o configurare făcută de altcineva era greșită: cu resetarea 2FA înaintea parolei noi, cine are parola veche ar putea configura din nou primul | întâi parola nouă din „Am uitat parola” (linkul vine pe emailul titularului; închide sesiunile), apoi resetarea 2FA de către admin; motivul notat |
| 4 | `auth/email.ts` | anunțurile „e activă” / „a fost schimbată” spuneau doar „scrie-i adminului”, fără primul pas sigur | „cere cât mai repede o parolă nouă din «Am uitat parola» (închide toate sesiunile), apoi scrie-i adminului”; FD §5 la fel |

Recitite fără alte probleme: TD-2FA față de cod (bariera, `UserService`, rutele, emailurile, interfața, scripturile, testele promise), testele noi (timpul înghețat, IP-urile diferite pentru bugetele de login, bugetul contului resetat de fiecare succes).

## Runda 44 — 5 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | `ActivatePage` | pagina de activare nu spunea că urmează configurarea 2FA (persoana afla abia după parolă) | „…apoi configurezi autentificarea în doi pași (un cod de pe telefon).” |
| 2 | `TwoFactorSetupPage` | un secret de înrolare care nu se poate decripta (altă cheie master) lăsa pașii fără cod QR și fără explicație | o notă cu butonul care face o cheie nouă (pornirea automată rămâne fără `restart`, ca două taburi să primească același secret) |
| 3 | `Security.tsx` | o schimbare nouă a aplicației arăta eroarea rămasă de la cea dinainte (ex. „Nu e nicio schimbare începută” după o terminare în alt tab) | `confirm.reset()` la pornirea unei schimbări |
| 4 | `Security.tsx` | codul scris rămânea în câmp după „Renunță” sau la o schimbare nouă | câmpul se golește |
| 5 | `TwoFactorSetupPage` | un comentariu numea butonul „Cheie nouă” | reformulat |

Recitite fără alte probleme: tipurile comune (`ActivateResult`, `TwoFactorEnabled`, `TwoFactorView.replacing`), pagina Utilizatori (coloana, confirmarea, butonul doar pentru conturile cu 2FA), `RecoveryCodes` / `TotpQr`.

## Runda 45 — 1 problemă (reparată)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | `ActivatePage` („Contul e activ”) | ecranul apare acum doar într-un browser deja în alt cont, iar butonul lui „Intră în cont” ducea în acel cont, nu în cel nou (și lead-ul „Contul e activ. Intră cu parola nouă.” al login-ului nu mai era atins de nicăieri) | „Ieși și intră cu …”: `logout`, apoi login-ul cu adresa completată și lead-ul lui; „Rămâi în contul de acum”; FD-2FA §1 și TD-2FA §6 la fel. Verificat în Chrome: browserul adminului → activarea Anei → „Ieși și intră cu ana@…” → login completat → configurarea |

Recitit restul domeniului fără alte probleme (migrarea 4 pe schemele de test, `import-sqlite` cu coloana nouă nulabilă, întreținerea sesiunilor, scripturile).

## Runda 46 — 1 problemă (reparată)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | FD-2FA §6, TD-2FA §2, `users.test.ts` | formulări cu gen gramatical pentru persoane, pe care proiectul le evită („titularul… emailul lui”, „rutele lui” pentru admin, „she / her” în comentariile noi ale testelor) | „persoana care deține contul… adresa contului”, „rutele de admin”, comentarii fără pronume |

Recitite fără alte probleme: toate locurile care pornesc o sesiune (prima parolă, login, codul, passkey-ul, activarea) trec prin aceeași barieră; textele noi din interfață și din emailuri (fără gen, cu pașii corecți).

## Runda 47 — 0 probleme
Recitit tot domeniul, cu impactul lui:
- **bariera:** hook-ul, rutele permise, toate intrările care pornesc o sesiune, rutele din afara `/api`;
- **`UserService`:** înrolarea, schimbarea aplicației, resetarea;
- **rutele:** activarea, `enable` cu sesiunile închise, `replace*`, resetarea de către admin, emailurile;
- **scripturile;**
- **interfața:**
  - ecranul de configurare: QR, cheia, cod greșit, alt tab, lipsa QR-ului;
  - codurile ținute până la „Intră în Sentiq”;
  - ținta de după login;
  - „Contul e activ” într-un browser cu alt cont;
  - Securitate și Utilizatori;
- **documentele:** FD-2FA / TD-2FA față de cod, ghidul, README, tabelul API și baza de date din TD.

`tsc` curat (și pe `scripts/`, fără variabile nefolosite în fișierele atinse), build curat, 463 de teste pe Azure SQL (45 de fișiere).

# FD-TRADING — ordine de tranzacționare din Sentiq (18 oct 2026)

Domeniu (tot codul nou și impactul lui; fiecare rundă îl recitește întreg):
- **server:**
  - `exchange/trading/` (nou): `types.ts`, `crypto.ts`, `trading212.ts`, `etoro.ts`, `alpaca.ts`, `http.ts`, `rights.ts`, `service.ts`;
  - `exchange/accounts.ts` (accesul de tranzacționare, permisiunile Coinbase, `invalidate`, `TradeRef`, `cancellable`, oprirea la „Testează”), `exchange/brokers.ts` (referințele);
  - `auth/users.ts` (`stepUp`), `db/schema.ts` (migrarea 5), `context.ts`, `http/app.ts`, `http/routes.ts`, `http/auth-routes.ts`;
- **comune:** `shared/trading.ts` (nou), `shared/providers.ts`;
- **interfață:**
  - `components/OrderTicket.tsx`, `components/TradingControls.tsx`, `components/Modal.tsx` (noi);
  - `pages/Trades.tsx`, `pages/Charts.tsx`, `pages/Settings.tsx`, `components/AccountWizard.tsx`;
- **teste:** `trading/crypto.test.ts`, `brokers.test.ts`, `service.test.ts` (noi), testul de siguranță din `server.test.ts`;
- **documente:** FD / TD, ghidul, README, PROGRESS.

Cercetare:
- documentațiile oficiale Trading 212 (Orders), eToro (Trading Real / Demo, market orders), Alpaca (POST /v2/orders), IBKR (Web API: Gateway sau OAuth);
- ccxt 4.5.85 (createOrder, stop-uri, TP / SL, levier, marjă, modul de poziție) pe cele 7 exchange-uri.

Verificat înainte de review:
- `tsc` curat;
- 491 de teste pe Azure SQL (48 de fișiere);
- Chrome pe o schemă de test, cu un exchange simulat:
  - pornirea cu parola + 2FA;
  - ordin nou → verificare → confirmare → rezultat;
  - „Închide” pe o poziție;
  - „Anulează”;
  - jurnalul;
  - „Tranzacționează” pe grafic;
  - telefon 390 px.
- Pe drum, verificarea a prins:
  - o închidere reduce-only ar fi schimbat levierul;
  - o cheie care primește retrageri după pornire rămânea pornită;
  - textul direcției greu de citit pe butonul ales;
  - piața și direcția modificabile la „Închide”;
  - „Vinde” pe soldul „main” KuCoin.

## Runda 48 — 4 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | `TradingService.fromLog` | un rând rămas „în curs” după o repornire în timpul trimiterii bloca formularul pentru totdeauna („deja în curs de trimitere”) | după 2 minute, răspunsul e „trimiterea a fost întreruptă: nu știm sigur dacă a ajuns” (`UNKNOWN_OUTCOME`) |
| 2 | `TradingService.cancel` | pe un cont KuCoin unificat, ordinele futures sunt listate cu cele spot: anularea lor se verifica pe piața spot (refuzată dacă tranzacționarea era pornită doar pentru futures) | piața se deduce din simbol (`…:USDT` → futures); la brokeri, `stock` |
| 3 | Jurnalul | o cantitate scrisă ca valoare (USDT) rămânea în jurnal ca „Cantitate” | rândul primește cantitatea în activ și prețurile rotunjite ale ordinului verificat |
| 4 | `TradingService.enable` | o cheie care nu poate tranzacționa nimic din ce Sentiq trimite pe acel exchange pornea cu o listă de piețe goală | refuzată, cu motivul |

Recitite fără alte probleme:
- prețul trimis cu ordinele la piață (ccxt îl folosește doar unde exchange-ul cere suma la o cumpărare la piață; ignorat la futures și la ordinele pe cantitate);
- `availability` pe conturile KuCoin clasice / unificate;
- detectarea modului hedge;
- `etoro.ts` folosește acum `randomUUID` din `node:crypto`, ca restul codului.

Teste noi pentru 1–3. FD §7 și TD §4 au acum rândurile pentru întrerupere, prețul Trading 212 și anularea pe contul unificat.

## Runda 49 — 2 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | `trading212.ts` | verificarea și trimiterea citeau fiecare rezumatul contului și pozițiile; Trading 212 le răspunde o dată la câteva secunde, deci trimiterea putea primi 429 chiar după verificare | citirile ținute 6 s în trader (păstrat per cont), uitate după un ordin sau o anulare; testul numără o singură citire a rezumatului |
| 2 | `etoro.ts` | închiderea unei dețineri din mai multe poziții se oprea la prima eroare: pozițiile deja închise nu mai apăreau în rezultat, iar jurnalul spunea „eroare” | poziție cu poziție, cu rezultatul celor închise și motivul celor rămase; eroarea doar dacă nu se închide niciuna; test nou |

Recitite fără alte probleme:
- `http.ts` (o scriere fără răspuns e „necunoscută”, un GET doar refuzat);
- `alpaca.ts` (simbolurile crypto, poziția fără „/”, 422 la anulare);
- `rights.ts`;
- pagina Tranzacții („Închide” / „Vinde” pe fiecare platformă, `cancellable`);
- formularul în modul de închidere (TP / SL ascunse, câmpurile fixe);
- Graficele (fără buton pe indici), expertul, Setările.

## Runda 50 — 6 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | `OrderTicket` | la eToro, levierul arăta „max 400×”, deși schema primește cel mult 125×, iar eToro are limite pe instrument | fără maxim afișat la eToro (îl verifică eToro); restul din piață / platformă |
| 2 | FD §3 / §7 | promiteau un buton „Reîncearcă” pentru TP / SL-ul Binance refuzat după intrare; nu există | FD descrie ce se face: un ordin stop reduce-only în sens opus, din formular (posibil) sau din Binance |
| 3 | `TradingService.place` | FD §7: o cheie refuzată de platformă la primul ordin primește „pașii platformei”; mesajul nu-i avea | pașii platformei adăugați la o eroare de permisiune; test nou |
| 4 | FD §5 | „pe primul cont cu tranzacționare care are perechea”: codul ia primul exchange pornit, iar perechea se semnalează dacă lipsește | FD aliniat (contul și piața se schimbă din formular; X/USDT → X/USD sau X/USDC pe Kraken / Coinbase) |
| 5 | TD §5 / §3 | lista de perechi „ținută 10 min” pe server (o ține doar pagina); ID-ul de client „pleacă și la platformă” peste tot (Coinbase își face singur ID-ul) | TD corectat |
| 6 | Ghidul | jurnalul „sub ordinele contului” (e în josul paginii, cu pornirile și opririle) | corectat |

Recitite fără alte probleme:
- maparea ID-ului de client în ccxt (KuCoin `clientOid`, Kraken `cl_ord_id`, Bybit `orderLinkId`, OKX / Bitget / Binance), formatul de 32 de caractere hex acceptat de toate;
- `reduceOnly` boolean la Binance futures;
- textele noi fără gen pentru persoane;
- ștergerea unui utilizator (jurnalul pleacă prin cheia străină), a unui cont (jurnalul rămâne), importul SQLite și resetarea schemelor de test cu tabelul nou.

## Runda 51 — 2 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | `AccountsService.refreshPermissions` / `test` | o recitire a permisiunilor fără rezultat (endpoint căzut chiar atunci) scria `NULL` peste lista știută: o cheie știută cu retrageri devenea „necunoscută” și tranzacționarea putea porni | o citire fără rezultat păstrează lista știută (la pornire și la „Testează”); test nou; FD §7 și TD §4 la fel |
| 2 | Pagina Tranzacții | nota „cheia poate tranzacționa (…)” apărea pentru orice permisiune în plus față de citire (ex. „Earn”), nu doar pentru tranzacționare | „are permisiuni în plus față de citire (…); dacă poate tranzacționa…” |

Recitite fără alte probleme:
- diff-ul `accounts.ts` (vederea contului, accesul, comutatorul, `invalidate`);
- „Închide” / „Vinde” pe fiecare platformă (pozițiile copiate eToro fără buton);
- fără buton pe IBKR (motivul afișat);
- „Pornește” pe o cheie cu retrageri: refuzat la server, cu nota deja vizibilă.

## Runda 52 — 2 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | `OrderTicket` | „valoare” (USDT / USD) aleasă pe un cont rămânea aleasă după trecerea pe un cont care primește doar cantități (Trading 212): ordinul era refuzat | unitatea folosită e cea aleasă doar dacă platforma o primește; altfel cantitatea în activ |
| 2 | `OrderTicket` | la eToro, 25 / 50 / 100% pentru „Short” luau unitățile deținute (ca la o vânzare), deși un short se plătește din numerar | la eToro, procentele vin din numerar în ambele direcții |

Recitite fără alte probleme:
- schema formularului (regulile prețului, ale declanșării, ale marjei și ale levierului; levierul pe `stock` permis pentru eToro);
- fereastra modală (blocată cât pleacă ordinul);
- comutatorul și jurnalul;
- cheia formularului (nouă la orice modificare, aceeași la retrimiterea aceluiași formular).

## Runda 53 — 4 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | `trading/types.ts` | `floorToStep` / `roundToStep` exportate, nefolosite (rotunjirea o face ccxt) | scoase |
| 2 | FD §7 | „levier peste maxim: limitat la maxim în formular”; formularul nu-l limitează, verificarea îl refuză | FD aliniat (maximul afișat lângă câmp, refuzul la verificare) |
| 3 | `trading212.ts` | FD §7: la un simbol de pe mai multe burse, confirmarea arată ISIN-ul / bursa; arăta doar numele | instrumentul din confirmare are numele, ISIN-ul și tickerul Trading 212 |
| 4 | `alpaca.ts` | FD §7: un ordin la piață pe o piață închisă are avertisment și la Alpaca (se execută la deschidere); lipsea | avertisment pentru ordinele la piață pe acțiuni |

Recitite fără alte probleme:
- FD-TRADING §1–§8, punct cu punct, față de cod: valorile implicite, tipurile pe platformă, procentele, valabilitatea, eticheta DEMO, starea eToro citită după trimitere, jurnalul, limitele, mesajele de eroare;
- `--noUnusedLocals` / `--noUnusedParameters` curat pe fișierele noi.

## Runda 54 — 4 probleme (reparate, documentație)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | TD §2 | `OrderResult` avea în TD un câmp `unknown` care nu există (e una din stări) | stările listate |
| 2 | TD §3 | `place(ticket, clientId)`; codul are `place(preview)` (ID-ul de client din cheia formularului) | TD corectat |
| 3 | TD §3 | Alpaca: „închiderea: DELETE /v2/positions”; „Închide” trimite un ordin la piață în sens opus pe cantitatea poziției (același drum, cu confirmare) | TD corectat, plus 422 la anulare |
| 4 | TD §8 | testele cu clasele ccxt reale erau trecute pentru toate cele 7 exchange-uri (sunt KuCoin, Bybit, Coinbase; restul pe clienți simulați); „închidere” la Alpaca | TD corectat |

Recitit restul TD-TRADING față de cod fără alte probleme.

## Runda 55 — 1 problemă (reparată)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | `OrderTicket` (confirmarea) | o închidere reduce-only („Închide” pe un long) apărea ca „Direcție: Short”, ca și cum s-ar deschide un short | „Închidere (vânzare)” / „Închidere (cumpărare)” pentru reduce-only |

Recitite fără alte probleme:
- ghidul și README-ul față de cod (tabelul permisiunilor, regulile pe platformă, limita de 20 / minut);
- ordinea hook-urilor în `OrderTicket` (toate înaintea primului `return`);
- fluxul complet în Chrome pe codul curent: pornire, ordin, confirmare, „Închide”, „Anulează”, jurnal, „Tranzacționează” pe grafic; fără erori în consolă.

## Runda 56 — 1 problemă (reparată)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | `CcxtTrader` (KuCoin, cont unificat) | un ordin futures cu marjă isolated pe un cont UTA chema `setLeverage(…, { marginMode: 'isolated' })`, pe care ccxt 4.5 îl refuză (NotSupported): ordinul pica abia la trimitere, cu un mesaj tehnic | refuzat la verificare, cu „alege Cross”; închiderile reduce-only trec (nu schimbă levierul, iar ordinul UTA nu poartă marja); test nou; FD / TD / ghidul actualizate |

Recitite fără alte probleme:
- `createUtaOrderRequest` din ccxt: `marginMode` / `leverage` se trimit doar pe conturile clasice;
- ultima rulare completă: 48 de fișiere, 492 de teste trecute.

## Runda 57 — 8 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | `CcxtTrader.isUta` | dacă citirea modului contului KuCoin (unificat / clasic) eșua, eroarea ccxt ieșea nemapată: un 500 generic în loc de mesajul exchange-ului | mapată prin `tradingErrorOf` (nimic trimis); se recitește la următoarea cerere; test |
| 2 | `tradingErrorOf` (după trimitere) | un `BadResponse` sau o eroare din afara ccxt la citirea răspunsului devenea `REJECTED`: cheia formularului se elibera și același ordin, poate deja în carte, se putea retrimite | `UNKNOWN_OUTCOME`; test; TD |
| 3 | `EtoroTrader` (închiderea mai multor poziții) | o poziție fără răspuns apărea la „NU s-au închis”; dacă nu se primea niciuna, se arunca prima eroare (poate un refuz), nu „necunoscut” | listată separat („nu știm sigur… verifică pe eToro”); fără nicio primire → `UNKNOWN_OUTCOME` dacă vreuna a rămas fără răspuns; test; TD |
| 4 | `OrderTicket` (confirmarea) | după un „necunoscut”, „Înapoi” și un formular schimbat, eroarea veche rămânea și ascundea „Confirmă și trimite” | „Înapoi” golește eroarea trimiterii (același formular retrimis primește tot „necunoscut” de la server) |
| 5 | `OrderTicket` | un refuz care a oprit tranzacționarea (cheia poate acum retrage) sau a găsit-o oprită nu reîmprospăta comutatorul paginii | la `PERMISSION` / `DISABLED` se recitesc conturile și capabilitățile |
| 6 | `TradeJournal` | cantitatea și prețul apăreau brut (ex. 0.30000000000000004, cu punct) | `fmtNum(…, 8)`, ca restul paginii |
| 7 | `Trades` | „Închide” (futures), „Vinde” (spot) și „Anulează” apăreau și pe piețele pentru care tranzacționarea nu e pornită (o cheie doar pentru spot): formularul spunea doar „niciun exchange”, anularea dădea eroare | afișate doar pe piețele pornite (piața ordinului citită ca pe server: un perpetuu e futures); FD |
| 8 | `TradingControls` | două importuri din `lucide-react` | unul singur |

Verificat:
- fluxul în Chrome pe codul nou: pornire, ordin, confirmare, „Închide”, „Anulează”, jurnalul formatat, „Tranzacționează” pe grafic; fără erori în consolă;
- `createUtaOrderRequest` / `handleTradeType` din ccxt pentru reduce-only pe UTA.

## Runda 58 — 3 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | `CcxtTrader` (Bitget, cont unificat) | ccxt 4.5 detectează singur contul unificat și trimite ordinul pe v3 cu parametrii brut: un ordin stop își pierdea prețul de declanșare (v3 nu are câmpul; ar fi putut pleca drept ordin obișnuit), marja pleca drept `cross` (v3 vrea `crossed`), `oneWayMode` pleca în plus, iar modul de poziție se citea de pe endpoint-ul clasic | contul unificat recunoscut din setările v3 (care dau și `holdMode`), transmis lui ccxt; stop și isolated la deschidere refuzate la verificare; marja `crossed` / `isolated`, fără `oneWayMode`, levierul fără marjă; o eroare de rețea nu mai e luată drept „clasic”; teste (inclusiv cu clasa reală ccxt `bitget`); FD / TD / ghidul |
| 2 | `AlpacaTrader` | fracționat și pe sumă se refuzau la orice tip în afară de „la piață”, deși Alpaca le primește la piață, limită, stop și stop-limită, valabile o zi | doar regula „valabil o zi”; pe sumă cu limită, cantitatea la prețul limită; test; FD / ghidul |
| 3 | `AlpacaTrader` | TP / SL (bracket) în afara orelor nu era refuzat înainte de trimitere (Alpaca: `extended_hours` trebuie să lipsească la bracket) | refuzat la verificare; test |

Recitite fără alte probleme: `rights.ts`, `types.ts`, `accounts.ts` (vederea, accesul, comutatorul, permisiunile), rutele, `Charts.tsx` („Tranzacționează”).

## Runda 59 — 4 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Portofoliul (`accounts.ts`), ordinele deschise | pe Binance, Bybit, OKX și Bitget nu se citeau ordinele futures și / sau cele stop (fiecare exchange le ține în liste separate): un ordin limită futures sau un stop trimis din Sentiq nu apărea la „Ordine deschise” și nu se putea anula, deși FD-TRADING §4 promite „Anulează” pe fiecare | `EXTRA_ORDER_READS` per exchange (Binance futures și algo, Bybit linear, OKX algo `trigger`, Bitget stop spot și futures), fiecare citire separat, tolerantă la o cheie fără futures; piața ordinului luată din simbol (repară și eticheta ordinelor futures ale contului unificat KuCoin, care nu se mai potriveau cu pozițiile pe grafic); teste; FD / TD |
| 2 | Portofoliul (Bybit), lista simplă | clientul ccxt Bybit pornește pe linear: lista „spot” de ordine și tranzacții aducea de fapt futures (iar ordinele și tranzacțiile spot lipseau), iar tranzacțiile futures intrau în costul mediu spot | `{ type: 'spot' }` cu paginile permise de Bybit (50 / 100); tranzacțiile linear citite separat (rămân în „Tranzacții recente”, ca futures); piața unei tranzacții luată din simbol, deci un perpetuu nu intră niciodată în costul spot; test |
| 3 | Citirile noi de ordine (Binance) | ccxt aruncă `-2015` (cheie fără futures) drept `DDoSProtection` după ce cheia a mers o dată: citirea s-ar fi reîncercat la fiecare reîmprospătare și ar fi marcat secțiunea „orders” ca eroare pentru orice cheie doar spot | recunoscut (`binanceDenied`), nereîncercat, nimic listat acolo; o citire sărită nu se mai cere 15 minute (una cerută greșit: 6 ore, scrisă o dată în jurnal), iar „Testează” o cere din nou; teste |
| 4 | `tradingErrorOf` (Binance) | același `-2015` la un ordin apărea drept „exchange-ul limitează cererile” | `PERMISSION`, cu pașii platformei; test; TD |

Verificat în sursele ccxt 4.5.85: `binance.fetchOpenOrders` (linear → `fapi` / `openAlgoOrders`), `bybit.fetchOpenOrders` (`settleCoin`, `orderFilter`), `okx.fetchOpenOrders` (algo `trigger`), `bitget.fetchOpenOrders` (clasic / v3), anularea condiționată Binance (`fapiPrivateDeleteAlgoOrder`).

## Runda 60 — 2 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | `CcxtTrader` (Bitget, cont unificat, spot) | v3 citește `qty` al unei cumpărări la piață în moneda de cotare, iar ccxt 4.5 trimite cantitatea în moneda de bază: „cumpără 1000 DOGE” ar fi cheltuit 1000 USDT (de zece ori mai mult la 0,1 USDT) | `qty` = suma arătată la verificare (`costToPrecision`), care înlocuiește câmpul lui ccxt; vânzarea și limita rămân în bază; test cu clasa reală ccxt `bitget` (cerere și răspunsuri v3 simulate); TD |
| 2 | `CcxtTrader.bitgetMode` | dacă citirea setărilor v3 era refuzată, contul era declarat „clasic” chiar când ccxt îl găsise deja unificat (`options.uta`), iar ordinele ar fi plecat pe v2 | păstrat unificat (modul de poziție rămâne necunoscut; un hedge e prins apoi din răspunsul platformei, `posSide`) |

Verificat: KuCoin UTA trimite cumpărarea spot la piață în moneda de bază (`sizeUnit: 'BASECCY'` implicit), deci acolo nu e cazul.

## Runda 61 — 1 problemă (reparată, claritate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | `CcxtTrader.prepareFutures` (KuCoin) | ramura „UTA → `setLeverage` cu marja aleasă” nu mai era atinsă pentru isolated (verificarea îl refuză pe contul unificat), dar citea ca și cum s-ar trimite | doar „cross → `setLeverage`, altfel `leverage` în ordin”, cu motivul în comentariu |

Verificat:
- suita completă pe codul final: 48 de fișiere, 496 de teste trecute;
- fluxul în Chrome pe codul nou (inclusiv citirea nouă a ordinelor): pornire, ordin, confirmare, „Închide”, „Anulează”, jurnalul, „Tranzacționează”; fără erori în consolă;
- README, ghidul și FD / TD față de regulile noi (Bitget și KuCoin UTA, Alpaca fracționat, ordinele deschise).

## Runda 62 — 2 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | `accounts.ts` | `EXTRA_ORDER_READS` era exportat fără să-l folosească altcineva (spre deosebire de `FUTURES_BALANCE`, citit de trader) | intern modulului, ca `SPOT_LISTING` |
| 2 | TD-TRADING §8 (testele) | lista testelor nu avea testele noi (contul unificat KuCoin / Bitget, erorile după trimitere, ordinele din portofoliu) | completată |

Recitite fără alte probleme: `crypto.ts` cap-coadă (`isUta`, `bitgetMode`, verificarea, `assertOneWay`, `prepareFutures`, `stopParams`, `place`, `cancel`), lățimea comentariilor, README.

## Runda 63 — zero probleme
Recitite, full scope:
- traderii (`crypto.ts`, `trading212.ts`, `etoro.ts`, `alpaca.ts`), `types.ts`, `http.ts`, `rights.ts`, `service.ts`;
- rutele, maparea erorilor din `app.ts`, legăturile din `context.ts`, ștergerea contului și a utilizatorului (traderii și citirile sărite uitate), migrarea 5;
- portofoliul (`accounts.ts`): comutatorul, permisiunile, citirile noi de ordine, listele Bybit;
- interfața (`OrderTicket`, `TradingControls`, `Trades`, „Tranzacționează” pe grafic), `shared/trading.ts`;
- FD / TD / ghidul / README față de cod.

Verificat: `tsc` fără erori; suita completă 48 de fișiere, 496 de teste trecute; fluxul în Chrome fără erori în consolă.

# FD-INDICATORS — orice indicator TradingView pe grafic; Slingshot și LMA la „Premium” (18 oct 2026)

Găsite și reparate la verificarea în Chrome, înainte de runde:
- legenda arăta „— — —” pentru linii fără nicio valoare (benzile RSI oprite, linia de netezire a EMA): acum nu le arată, ca TradingView;
- „BTCUSD” din lista implicită Performance era luat drept acțiune pe graficul unui indice: o monedă majoră cu quote-ul ei e crypto pe orice grafic;
- Ichimoku (norul desenat 26 de bare în viitor) muta vederea cu 25 de bare spre trecut: vederea e ținută acum pe ultimele lumânări.

## Runda 64 — 3 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | `CandleChart` (demontare) | rendererele nu erau curățate înainte de `chart.remove()`: observatorii și cadrele programate pentru tabelele indicatorilor (Performance, Seasonality) ar fi rulat pe un grafic deja distrus | `r.clear()` pentru fiecare, înaintea graficului |
| 2 | `CandleChart` (vederea ținută minte) | distanța de la marginea din dreapta se salva față de ultimul punct al axei, pe care Ichimoku îl mută cu 26 de bare în viitor: la revenire, ultima lumânare ajungea tăiată la margine | salvată și pusă înapoi față de ultima lumânare (fără astfel de indicatori, aceeași valoare ca înainte, deci vederile vechi rămân valabile); vederea perechii părăsite se salvează înainte să intre lumânările noi; TD |
| 3 | TD / FD (mărimea codului) | „122 KB gzip” venea dintr-o măsurătoare de probă; build-ul real dă ~112 KB | corectat |

Recitite fără alte probleme: `useStudies` (planul, încărcările, cache-ul, generațiile), `compute.ts`, `extra-bars.ts`, `style.ts`, fereastra Indicatori, setările, legendele, `Charts.tsx` (salvările, limitele, sertarul, ecranul complet); toate scrierile setărilor sunt patch-uri, deci lista de indicatori nu poate fi suprascrisă dintr-un alt formular.

## Runda 65 — 2 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | `CandleChart` (vederea ținută minte, FD-CHARTUX §2) | la o încărcare a paginii, vederea salvată nu se aplica: biblioteca își pune opțiunile (`rightOffset`, `barSpacing`) în primul ei cadru, peste vederea setată imediat după `setData` (măsurat: `barSpacing` și poziția rămâneau 6 / 24, apoi `rightOffset` 24); problema era veche, iar indicatorii o făceau vizibilă | vederea (salvată sau implicită) se pune după acel cadru, când axa are lățime (altfel la prima schimbare de mărime); un contor de „epocă” oprește corecția de după desenarea indicatorilor să readucă o vedere mai veche; verificat în Chrome: BTC derulat, ETH, BTC din nou → aceeași vedere, cu Ichimoku pe grafic; TD |
| 2 | `CandleChart` (vederea cu Ichimoku) | `shiftVisibleRangeOnNewBar` al bibliotecii trata punctele desenate în viitor ca bare noi și muta vederea cu 24 + 25 de bare, după corecția din cadrul precedent | oprit (lipirea de marginea din dreapta la lumânări noi o face deja efectul datelor) |

Verificat: fluxul complet în Chrome (fereastra, legende, setări, ochi, ×, LMA scos și pus la loc) fără erori în consolă.

## Runda 66 — 1 problemă (reparată, documentație)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | TD-INDICATORS §8 / §9 | lipseau `onVisibleRange` și `style` din props-urile graficului, iar categoriile ferestrei erau descrise ca `tablist` (codul: `group` cu butoane `aria-pressed`) | completat / corectat |

Recitite fără alte probleme: efectul datelor din `CandleChart` după runda 65 (lipirea de marginea din dreapta cu lumânări noi, fereastra glisantă a lumânărilor, chei schimbate repede, demontarea înaintea cadrului), `useStudies` (dependențele planului, identitățile listelor), `Charts.tsx` (ordinea și înălțimile panourilor, legendele).

## Runda 67 — zero probleme
Recitite, full scope:
- codul nou: catalogul și metadatele, `compute.ts`, `extra-bars.ts`, `style.ts`, `useStudies`, `runtime`, `volume.ts`, fereastra Indicatori, setările Intrări / Stil, legendele, `CandleChart` (panourile, înălțimile, vederea, desenarea), `Charts.tsx`;
- serverul: schema `studies`, cheia personală, recuperarea element cu element; scrierile setărilor sunt patch-uri peste tot;
- impactul: Slingshot, LMA, pozițiile și PnL-ul pe grafic, ecranul complet, vederea ținută minte, CSP-ul (chunk din `'self'`, fără `eval`), build-ul pe Azure (`oakscriptjs` fixat, ca `lightweight-charts`), fără migrare de schemă;
- documentele: FD / TD / ghidul / README / `vendor/README.md`.

Verificat: `tsc` fără erori; suita completă 53 de fișiere, 532 de teste; în Chrome, pe 1280 și 390 px (fereastra, legendele, setările, panourile), fără erori în consolă.

# FD-PREMIUMHIDE și FD-TRADEUNLOCK

## Runda 68 — 1 problemă (reparată)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | `routes.ts` (pornirea tranzacționării) | mesajul cu încercările rămase avea „15 minute” scris de mână; o schimbare a pauzei l-ar fi lăsat greșit | din `COOLDOWN_MS` |

Recitite fără alte probleme:
- **PREMIUMHIDE:**
  - `premiumState` și cele trei stări;
  - legendele (ordinea în panoul prețului, rândul LMA ascuns, × golește și ascunderea);
  - `paneOrder` / `paneFactors` (înălțimea LMA rămâne);
  - lista Indicatori („Pe grafic, ascuns”);
  - un server vechi (câmpurile lipsă: vizibil).
- **TRADEUNLOCK:**
  - ordinea în `enable` (permisiunile întâi; `refuse` oprește o tranzacționare pornită);
  - `stepUp` (parola întâi, deci un cod de recuperare nu se pierde pe o parolă greșită);
  - passkey-ul: provocare legată de utilizator și de scop; passkey-ul altui cont refuzat înainte să i se atingă contorul; fără `registerFailure`; o reușită golește bugetul;
  - cookie-ul provocării șters la folosire;
  - jurnalul fără secrete;
  - fereastra (eroarea ultimei încercări, butoanele blocate cât rulează una).

Verificat:
- `tsc`, build-ul și testele țintite (101) trec;
- în Chrome, pe o schemă de test, cu un autentificator virtual:
  - fereastra fără și cu passkey;
  - parola greșită și codul greșit, cu încercările rămase;
  - pornirea cu passkey (spot + futures, permisiunile recitite);
  - ochiul pe Slingshot și LMA: norul, semnalele și liniile dispar; panoul LMA și culorile lumânărilor dispar; legendele estompate; după reîncărcare la fel; lista arată „Pe grafic, ascuns”; înapoi la loc la fel.

## Runda 69 — zero probleme (PREMIUMHIDE, TRADEUNLOCK)
Recitite, full scope:
- passkey-ul (`stepUpOptions`, `completeStepUp`, `verifyAssertion` comun cu login-ul);
- ruta și fereastra de pornire a tranzacționării;
- `stepUp`;
- ordinea din `enable`;
- legendele Slingshot / LMA și lista Indicatori;
- documentele (FD / TD / ghidul).

Suita completă: 54 de fișiere, 538 de teste.

# FD-STUDYUX

## Runda 70 — 2 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | „Stil” (grosimea) | o linie fără grosime declarată e desenată de renderer cu 2 px (histograma cu 1 px), dar „Implicită” era 1 px: alegerea ei subția linia, iar „Groasă” nu schimba nimic (și selectul vechi 1–4 px arăta tot 1 px) | `plotWidth(def)`: grosimea desenată fără alegere; opțiunile pornesc de la ea; FD / TD |
| 2 | Lista Indicatori (steaua) | butonul avea și `aria-pressed`, și o etichetă care se schimbă („Adaugă…” / „Scoate…”): un cititor de ecran ar anunța ambele | doar eticheta, ca la butoanele ochi; TD |

Recitite fără alte probleme:
- **Favoritele:**
  - schema, cheia personală, recuperarea id cu id;
  - salvarea din ultima listă din cache, cu revenirea la eșec;
  - categoria inițială, rândurile în ordinea marcării, rândul cu două butoane, mesajul listei goale;
  - căutarea.
- **Bara de jos:** ambele formulare, fără padding jos în zona care derulează.
- **Stilul:**
  - `lineKind`;
  - copia `plotConfig` doar când e nevoie, iar modulul nu se atinge;
  - `hlineConfig` cu tip și grosime;
  - „Valorile implicite” golește și tipul;
  - o grosime veche în pixeli rămâne listată.

Verificat în Chrome pe o schemă de test:
- fără favoriți, lista se deschide pe „Premium” și „Favorite” arată mesajul listei goale;
- cu trei stele, lista se deschide pe „Favorite 3”, în ordinea marcării;
- adăugare din favorite;
- RSI cu linie punctată și „Groasă”, salvat și desenat;
- bara de jos peste un formular derulat, la RSI și la Slingshot, pe 560 px înălțime.

## Runda 71 — zero probleme (STUDYUX)
Recitite, full scope:
- `style.ts`:
  - `lineKind`, `plotWidth`, `widthChoices`;
  - `styledEntry`: copia `plotConfig` doar cu alegeri; legenda citește tot definițiile modulului;
  - noua identitate a intrării se schimbă doar odată cu rezultatul.
- `StudySettings` („Stil”, bara de jos).
- `IndicatorPicker`: rândul cu două butoane, categoria „Favorite”, eticheta stelei.
- `Charts.tsx`: favoriții din cache, eroarea în fereastră, formularul Slingshot / LMA.
- Schema, `USER_KEYS`, `salvageFavorites`.
- Documentele: FD / TD / ghidul / PROGRESS.

Suita completă: 54 de fișiere, 543 de teste.
- O rulare precedentă a avut 24 de eșecuri în lanț: Azure SQL a răspuns lent, un test a depășit 60 s și a continuat în fundal peste celelalte.
- Fișierele afectate au trecut apoi separat, apoi și suita completă.

# FD-STUDYMEMORY

## Runda 72 — 1 problemă (reparată)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | `Charts.tsx` (scoaterea) | salvarea din formular nu e optimistă: „Salvează” urmat repede de × (înainte de răspunsul serverului) calcula memoria din cache-ul de dinainte de salvare, iar cererea ei, venită a doua, o suprascria | scoaterea așteaptă salvarea formularului aflată în curs (`formSave`); TD |

Recitite fără alte probleme:
- `memory.ts` (ce se ține minte, înlocuirea întreagă, copia nouă vizibilă);
- `saveStudies` și cele cinci locuri care-l folosesc (adăugare, ochi, scoatere, formular, înălțimi), cu lista și memoria în aceeași cerere;
- schema, `USER_KEYS`, `salvageStudyMemory`.

Verificat:
- teste: memoria (3), schema, serverul (34, inclusiv memoria înlocuită întreagă și recuperată element cu element);
- în Chrome, pe o schemă de test: RSI cu lungimea 21 și linia punctată, scos și adăugat (21, punctat), după reîncărcare la fel; „Valorile implicite” + „Salvează”, scos și adăugat: valorile TradingView.

## Runda 73 — zero probleme (STUDYMEMORY)
Recitite, full scope:
- `saveStudies` și folosirile lui după reparația rundei 72 (`formSave` se actualizează doar la formular, iar o salvare eșuată nu blochează scoaterea);
- `memory.ts`;
- schema și recuperarea pe server;
- FD / TD / ghidul.

`tsc` fără erori.

# FD-GOLATEST, FD-RODESC, FD-HLINELEVELS

## Runda 74 — 1 problemă (reparată)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | „Stil” (liniile orizontale) | culoare + tip + grosime + nivel nu încăpeau în panoul de 400 px: câmpul nivelului ieșea în dreapta (văzut în Chrome la Stochastic RSI) | numele și nivelul pe primul rând, aspectul liniei pe al doilea; controalele liniilor se pot rupe pe rând nou; verificat în Chrome (Stochastic RSI, MACD): nimic nu iese din panou |

Recitite fără alte probleme:
- **Butonul `>>`:**
  - ultima lumânare se compară cu indexul ei logic, nu cu `n − 1`;
  - verificarea are loc la fiecare schimbare a vederii și după datele noi;
  - colțul celui mai de jos panou; caseta TP / SL urcă doar când împart colțul;
  - `scrollToRealTime` păstrează zoom-ul.
- **Descrierile:** 118 traduse, plus testul care prinde engleza rămasă.
- **Nivelurile:**
  - schema;
  - `styledEntry` (umplerea urmează nivelurile, pentru că renderer-ul ia prețurile din aceeași listă);
  - validarea la „Salvează”;
  - „Valorile implicite”;
  - memoria setărilor le ține și pe ele.

Verificat în Chrome:
- butonul: lipsă la început; apare după o derulare înapoi; hover; click → la ultima lumânare, butonul dispare;
- descrierile în listă;
- Stochastic RSI la 90 / 10, salvat și desenat; un nivel gol e refuzat cu numele liniei.

## Runda 75 — 1 problemă (reparată)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | `CandleChart` (butonul `>>`) | la schimbarea perechii sau a timeframe-ului, verificarea de după datele noi rula pe vederea veche (cea nouă vine un cadru mai târziu): butonul putea clipi un cadru | la o schimbare de cheie butonul se ascunde, iar vederea nouă îl verifică la aplicare; la datele aceleiași perechi, verificarea rulează la finalul efectului de date (nu într-un efect separat); TD |

## Runda 76 — zero probleme
Recitite, full scope:
- `CandleChart` după reparația rundei 75 (cele trei momente în care se verifică butonul, colțul, caseta TP / SL);
- `catalog-meta.ts` (118 descrieri);
- nivelurile (schema, `styledEntry`, „Stil”, validarea);
- documentele (FD / TD / ghidul / `vendor/README.md`).

Verificat:
- suita completă: 55 de fișiere, 549 de teste;
- în Chrome, butonul: BTC derulat înapoi (apare) → ETH cu vederea lui (nu apare) → BTC din nou (apare, vederea ținută minte) → click (dispare); fără erori în consolă.

# FD-TICKETMEMORY

## Runda 77 — 2 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | `OrderTicket` (aplicarea memoriei) | dacă setările se încărcau după deschiderea formularului și după o alegere deja făcută, efectul aplica memoria peste alegerea respectivă | o alegere marchează contul ca aplicat (`appliedFor`) |
| 2 | Schema (`accounts`, cel mult 50) | un patch nu poate șterge chei: după 50 de conturi diferite (chiar șterse între timp), fiecare salvare ar fi fost refuzată pe tăcute (eroarea e ignorată, ca la celelalte alegeri) | limita 200, departe de numărul real de conturi; testul și TD |

Recitite fără alte probleme:
- **`ticket-memory.ts`:** seed-ul câștigă; închiderea nu citește și nu scrie; contul inițial.
- **`OrderTicket`:**
  - stările inițiale din memorie, când conturile și setările sunt deja încărcate;
  - efectul la schimbarea contului;
  - cele 10 alegeri salvate;
  - `fill()` nu se ține minte;
  - levierul doar ca întreg valid;
  - contul folosit, după „Verifică ordinul”.
- **Schema și recuperarea pe server.**

Verificat:
- teste: helper-ele și schema (6), serverul (35, inclusiv unirea câmp cu câmp);
- în Chrome, pe o schemă de test:
  - Futures + Short + limită + levier 10 + Cross, închis fără trimitere, redeschis: aceleași, cu cantitatea goală;
  - după reîncărcare, pe ETH: aceleași;
  - formularul „Închide” al unei poziții nu schimbă memoria.

## Runda 78 — zero probleme (TICKETMEMORY)
Recitite:
- reparațiile rundei 77: o alegere marchează contul ca aplicat; limita de 200;
- `OrderTicket` în întregime: cele 10 alegeri, contul folosit, formularele de închidere, `fill()`.

Suita completă: 56 de fișiere, 556 de teste.

# FD-KEYTEXT, FD-KEYIPS, FD-ETOROUNITS

## Runda 79 — 4 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Wizard (lista IP-urilor) | `.num` păstrează textul pe un rând (`nowrap`): lista lățea coloana, iar fereastra se derula lateral, cu textul tăiat (văzut în Chrome) | `font-mono` în loc de `.num`, coloana cu `min-w-0` |
| 2 | Wizard (lista IP-urilor) | cu `break-all`, adresele se rupeau la mijloc („68.” / „210.131.71”) | rupere doar după virgule (`<wbr>`), fără caractere în plus: textul selectat sau copiat rămâne „a,b,c” (verificat) |
| 3 | `OrderTicket` (unitățile eToro) | indiciul afișa codul intern „FD-ETOROUNITS” | scos |
| 4 | `etoro.ts` (avertismentul planului) | „(1 unități)” | „1 unitate” / „N unități”; testul |

Recitite fără alte probleme:
- **Pașii celor 11 platforme și `tradeSteps`:** nicio interdicție veche („Nu bifa Trade”, „Nu alege Write”), niciun „IP-ul tău”.
- **Textele din Setări / Tranzacții / ghid:** passkey-ul pomenit la pornirea tranzacționării.
- **`closePlan`:**
  - ordinea, restul, toleranța;
  - pozițiile sărite;
  - recitirea portofoliului la trimitere;
  - cererile pe poziție, cu planul gol refuzat.

Verificat:
- teste (brokeri 11, platforme);
- în Chrome: wizard-ul KuCoin pe 1280 și 390 px (pașii, caseta, lista, „Copiază lista” cu selecția de rezervă, avertismentul local) și Alpaca fără casetă; fără erori în consolă.

## Runda 80 — zero probleme (KEYTEXT, KEYIPS, ETOROUNITS)
Recitite, full scope:
- pașii celor 11 platforme și `tradeSteps`;
- `ServerIps` (lista, copierea, selecția de rezervă, avertismentul local);
- `closePlan` și `place` la eToro;
- textele din Setări / Tranzacții / ghid;
- FD / TD.

Teste:
- Suita completă a avut 26 de eșecuri în lanț, ca în runda 71. Azure SQL răspundea în 70–490 ms pe interogare (măsurat), iar un test din `users.test.ts` a depășit 60 s și a continuat în fundal peste celelalte.
- Fișierele afectate, rulate separat: 44 + 3 teste trec (inclusiv passkey-urile, rulate a doua oară separat).
- Restul suitei trece.
- Producția nu e afectată: `/api/ping` 200, nicio eroare în jurnalul de azi.

# FD-ETOROPICK

## Runda 81 — 2 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Lista pozițiilor | procentul cu punct zecimal („+33.33%”), lângă suma în stil românesc („+75,00 USD”) | `fmtPct` („+33,33%”) |
| 2 | Confirmarea | nu spunea ce poziții se închid sau ce profit iese din ele; se vedea doar cantitatea | rândurile „Poziții: 2 din 3: 20 nov. 2025, 2 mar. 2026” și „Profit / pierdere (nerealizat)” (al doilea doar fără unități parțiale) |

Recitite fără alte probleme:
- `EtoroTrader.portfolio` / `instrument` (profitul din `unrealizedPnL.pnL`, altfel `netProfit`; data; suma investită);
- `close-picker.ts`;
- `OrderTicket` (cele alese în ordinea listei, deci `closePlan` le împarte la fel; cantitatea fără unități = suma celor alese; verificarea dezactivată fără alegere; fără listă: formularul de până acum).

Verificat:
- teste (`close-picker` 3, brokeri 9, inclusiv pozițiile cu profitul lor);
- în Chrome, pe o schemă de test, cu un eToro simulat (trei poziții AAPL, două pe plus):
  - lista, de la cea mai veche;
  - „Doar profitabile” → 2 din 3, 3,5 unități, +115 USD;
  - „Niciuna” → verificarea dezactivată, cu mesajul;
  - confirmarea cu pozițiile și profitul;
  - eToro primește închiderea doar pentru cele două alese;
  - pe 390 px, rândurile se rup curat.

## Runda 82 — zero probleme (ETOROPICK)
Recitite:
- `OrderTicket` după runda 81: lista, alegerea, confirmarea, alias-ul `closeRowsList` (`rows` e umbrit în pasul de confirmare);
- o reîncărcare a pozițiilor care scoate o poziție închisă între timp: alegerea se filtrează pe listă;
- FD / TD / ghidul.

Suita completă: 57 de fișiere, 561 de teste.

# FD-ETOROROWS

## Runda 83 — 3 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Cheia unei vânzări (rândurile) | cu o cheie pe versiune (`Map` semnătură → cheie), a doua vânzare a acelorași unități din aceeași poziție, după „Înapoi la poziții”, ar fi refolosit cheia primei vânzări: serverul ar fi răspuns cu ordinul deja trimis, fără o vânzare nouă | „Înapoi la poziții” golește cheile (o rundă nouă de vânzări) |
| 2 | Formularul de închidere | contul și simbolul ca text stăteau fiecare pe rândul lui (văzut în Chrome) | pe același rând cu piața (3 coloane la futures, 2 la acțiuni) |
| 3 | Formularul de închidere futures | „Reduce-only” era o bifă blocată, nu text | „Reduce-only: da” ca text |

Recitite fără alte probleme:
- `check` cu corpul ca variabilă (formularul de rezervă trimite `ticketBody()`, rândul trimite `rowBody`);
- `send` folosește cheia previzualizării;
- „Vinde” e dezactivat cât rulează o verificare sau cu unități invalide;
- confirmarea, din `preview.ticket.close.positionIds`;
- `ReadOnly` pentru cont (închidere sau un singur cont), simbol, piață și direcție;
- formularul de rezervă fără `ins.positions`;
- lățimea de 900 doar cu tabelul.

Verificat:
- teste (`close-picker` 3);
- în Chrome, cu eToro simulat:
  - tabelul cu coloanele cerute și „Vinde” pe rând;
  - 9 unități pe o poziție de 1,5 → „Vinde” dezactivat;
  - vânzarea poziției profitabile (confirmarea cu poziția și profitul), „Înapoi la poziții” (rămân două rânduri), 1 unitate din ultima;
  - eToro primește exact cele două cereri (`null`, apoi 1);
- închiderea unei poziții futures KuCoin: contul, piața, perechea, direcția și reduce-only ca text; fără erori în consolă.

## Runda 84 — zero probleme (ETOROROWS)
Recitite:
- `OrderTicket` după runda 83: tabelul, `rowBody`, cheile, „Înapoi la poziții”, `ReadOnly`, reduce-only ca text, formularul de rezervă;
- `close-picker.ts`;
- FD / TD / ghidul.

Suita completă: 57 de fișiere, 561 de teste.

# FD-INDEXNEWS

## Runda 85 — 5 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Aliasurile (instantaneu) | „U.S.” (U.S. Bancorp) și „Nasdaq” (Nasdaq Inc.) ar fi etichetat aproape orice știre despre SUA sau bursă; „Edison”, „Everest”, „Regions”, „Waters”, „Hartford”, „Jacobs”, „Rollins”, „Lennox”, „Microchip”, „Motorola”, „EQT”, „PTC”, „Old Dominion” sunt și alte lucruri | nume complete curate; tickerele ambigue în `MEMBER_TICKER_BLACKLIST`; testul instantaneului verifică aceste nume |
| 2 | Parserul Wikipedia | când numele companiei nu are link, lua primul link de pe rând, sediul (Insulet → „Acton, Massachusetts”) | celulele rândului: numele e celula de după ticker (S&P 500) sau prima (Dow) |
| 3 | Aliasurile | „Deere & Co.” → „Deere &”, „Mosaic Company (The)” rămânea cu „(The)” | curățare de „&” și „(The)”; nume curate pentru companiile mari (SpaceX, MicroStrategy, T-Mobile, Chipotle, Micron …) |
| 4 | Detectorul | numele sub 3 caractere erau ignorate: „3M” nu se recunoștea după nume | două caractere pentru o companie, doar cu o cifră; test |
| 5 | FD §6 | promitea data listelor în „Stare sistem” (acolo e doar eroarea job-ului) | data e în Setări; FD |

Plus:
- un test vechi (FD-INDICES) cerea ca S&P 500 să dispară din etichete după scoaterea din favorite; acum cei trei indici ai filtrului sunt etichetați mereu (FD-INDEXNEWS §7); testul.

Recitite fără alte probleme:
- **Parametrii SQL** în lista de știri (cu AI propriu: `limit`, `userId`, apoi filtrele), în contextul Rezumatului și în scorul per utilizator.
- **Marcajele `#`:** ascunse în listă, în Rezumat, în iconițele scorului și în grupare (`findCluster`).
- **Job-urile:** re-etichetarea reluabilă, cu cursor (30 min); producția are ~9.200 de știri, deci ~20 s.
- **Scorul per utilizator:** începutul istoricului pentru filtru fără AI e știrile comune; `resetUser` la schimbare.

Verificat:
- teste: 15 noi (listele, aliasurile, instantaneul, detectorul, serviciul, filtrul, scorul per utilizator) + serverul;
- detectorul: ~2 ms pe știre;
- în Chrome: secțiunea din Setări (radio, bife, „Alege cel puțin un indice”, salvare) și nota din Știri.

## Runda 86 — zero probleme (INDEXNEWS)
Recitite, full scope:
- `index-members.ts`, `coins.ts`, `coin-registry.ts`, `stock-scope.ts`;
- `query.ts`, `summary/context.ts`, `sentiment/daily.ts`;
- job-urile, ruta de setări și `/api/stock-indices`;
- `StockNewsSettings`, nota din Știri;
- scriptul instantaneului;
- FD / TD / ghidul (în TD, numele datelor job-ului de re-etichetare, corectat).

Suita completă: 58 de fișiere, 575 de teste.

# FD-BROKERSTATS, FD-CHARTSTEADY

## Runda 87 — 7 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Statisticile brokerilor, „parțial” | la prima citire pe 90z, istoricul era cerut cu un `Date.now()` luat cu câteva milisecunde după începutul perioadei, deci perioada părea mai lungă decât istoricul („parțial: istoric prea lung” la IBKR, găsit în Chrome) | istoricul se cere cu ceasul statisticilor (`brokerClosed(…, now, …)`) |
| 2 | IBKR, memoria | rapoartele pe perioadă (90 de zile de tranzacții) aveau o cheie nouă în fiecare zi și nu se ștergeau niciodată | la fiecare raport nou se șterg cele expirate; test |
| 3 | IBKR, „Azi” cerut direct | cu `from` azi (sau în weekendul de după ultima închidere), `td` ajungea înaintea lui `fd` și se cerea raportul zilei curente | fără cerere: nicio tranzacție, `asOf` = închiderea ultimei zile lucrătoare; test |
| 4 | Alpaca, vânzările short | execuțiile `sell_short` erau ignorate, iar cumpărarea care închidea short-ul devenea o poziție long falsă | `sell_short` e vânzare și deschide short oricât de complet ar fi istoricul; teste |
| 5 | Antetul graficului, pe telefon | rândul cu intervalele se mișca totuși: prețul „—” e mai îngust decât cel încărcat, iar partea din stânga trecea de pe un rând pe două (găsit în Chrome, 390 px) | cât se încarcă, fiecare valoare ține lățimea celei de dinainte (`useLatched`, `Holding`); variația are un singur loc pentru monede și acțiuni |
| 6 | Antetul graficului | o deplasare de 1 px: textul sursei era gol cât se încărca, iar un rând gol mută linia de bază | textul sursei nu e niciodată gol |
| 7 | Textele | „profitul lor” lângă „1 tranzacție”; TD-ul descria un parametru `force` pe care adaptorul nu-l are; explicația Alpaca era greu de citit | texte și TD corectate |

Recitite fără alte probleme:
- **Adaptorii:**
  - eToro: paginile de la 1, oprirea, `seen` pentru rândurile repetate;
  - Trading 212: oprirea la începutul perioadei, `coveredFrom`, comisionul din lista de taxe;
  - IBKR: `fd` / `td`, coada pe token, gruparea pe ordin, „C;O”, `CASH`, cursul;
  - Alpaca: FIFO, opțiunile ×100.
- **Serviciul:**
  - un singur istoric pentru toate perioadele;
  - `force`;
  - `invalidate` / `delete` uită și statisticile;
  - moneda din portofoliu când lipsește.
- **Interfața:**
  - selectorul la toate conturile;
  - `BrokerCards`, cu nota „parțial” și titlurile pe broker;
  - IBKR „Azi” → „—”, cu data în ziua din New York;
  - serverul vechi.
- **Legenda:** butoanele înaintea valorilor, la indicatori și la LMA.
- **FD / TD / ghidul.**

Verificat în Chrome:
- **Statisticile:** eToro, Trading 212 (EUR), IBKR (Flex simulat), Alpaca (FIFO) și KuCoin, pe toate perioadele, cu numerele calculate de mână.
- **Antetul:** la trecerea ETH → SOL → AAPL → SPX → BTC, poziția rândului cu intervalele e una singură, eșantionată la 25 ms:
  - în ecran complet, la 1440 și 1920 px;
  - normal, la 1280 și 390 px.
- **Legenda:** butonul X al fiecărui indicator rămâne la același x / y cu cursorul în trei locuri.

Suita completă (rulată în timpul reparațiilor): 58 de fișiere, 591 de teste; 30 picate. Cauzele:
- 4 în `brokers.test.ts`, rulate pe versiunea de dinainte a `brokers.ts` (fișierele s-au schimbat în timpul rulării);
- 26 în `users.test.ts` și `trading/service.test.ts`: un timeout de 60 s la Azure SQL, apoi cascada cunoscută.

Rulate din nou separat, pe codul curent (brokerii, numărarea, serviciul de tranzacționare, utilizatorii): 4 fișiere, 78 de teste, toate trec.

## Runda 88 — 1 problemă (reparată)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Cardurile IBKR, textul | data raportului se termina cu două puncte: „până la închiderea bursei din 16 oct..” (luna scurtă are deja punct) | ziua întreagă, în New York: „de vineri, 16 octombrie”; TD |

Recitite fără alte probleme:
- **`BrokerCards`:** cardurile condiționate, cheile, nota „parțial” și titlurile, IBKR „Azi”, serverul vechi.
- **`useRefreshAccount`:** un eșec al statisticilor nu oprește reîmprospătarea portofoliului.
- **Testele noi:** eToro, Trading 212, IBKR (raport, „Azi”, cache, coadă), Alpaca (FIFO, `sell_short`, paginare), numărarea, API-ul.
- **Ghidul:** IBKR, cu „Azi” → „—”.

## Runda 89 — zero probleme (BROKERSTATS, CHARTSTEADY)
Recitite, full scope:
- `brokers.ts`: tipurile, `utcTime`, `t212Taxes`, cei patru `closedTrades`, coada și cache-ul Flex, `fifoResults`;
- `trade-stats.ts` (`summarizeResults`, `summarizeClosed` pe ea), `accounts.ts` (`TradeStats`, `loadBrokerStats`, `brokerClosed`, `forgetStats`);
- `Trades.tsx` (selectorul, `useRefreshAccount`, `BrokerCards`), `providers.ts` (pasul IBKR);
- `Charts.tsx` (antetul, `useLatched`, `Holding`, legenda LMA), `StudyLegend.tsx`;
- testele noi; FD / TD / ghidul / PROGRESS;
- niciun alt consumator al `TradeStats` (căutat în `src` și `scripts`).

Notă: la un cont IBKR de consilier, cu subconturi în monede de bază diferite, suma folosește moneda primului subcont, la fel ca portofoliul de până acum. Nu e o schimbare.

# FD-GOLATESTMAIN

## Runda 90 — zero probleme
Recitite:
- **`CandleChart`:** butonul în `boxes.panes.main`, ținut în panou și când acesta e foarte scund; fără `main`, nu apare.
- **Caseta TP / SL:** urcă oricând se vede butonul. Ridicată, se termină la 12 px deasupra butonului.
- **Restul:** butonul, cu `z-10`, stă deasupra legendelor; nu mai rămâne nicio referință la „cel mai de jos panou”.
- **FD / TD / ghidul.**

Verificat în Chrome, la 1440 px:
- cu LMA și RSI dedesubt: butonul la 717–749 px, panoul LMA de la 766 px;
- fără panouri: deasupra axei timpului;
- click → ultima lumânare, iar butonul dispare.

# FD-SCROLLLOCK

## Runda 91 — zero probleme
Recitite:
- `scroll-lock.ts`:
  - contorul și eliberarea dublă;
  - locul barei;
  - dubla montare din StrictMode (blocare → eliberare → blocare: contorul 1).
- Unde se folosește:
  - `Modal` și cele trei ferestre pe care le servește, `AccountWizard`, `CommandPalette` (hook-ul înaintea lui `return null`, ordinea hook-urilor e constantă), `DaySummary`, `SummaryFailed`;
  - `SettingsDrawer`, care se demontează la schimbarea paginii, deci deblochează;
  - `useFullscreen` (doar modul `css`; în cel nativ pagina nu se vede).
- `overscroll-contain` pe zonele care derulează (ferestre, panou, ecran complet, listele de căutare).
- FD / TD / ghidul.

Verificat în Chrome, la 1440 px:
- **panoul Slingshot:** formularul derulat până la capăt (804 / 804 px), iar pagina rămâne la 200 px; la fel cu rotița lângă panou;
- **⌘K deschis peste panou și închis:** pagina rămâne blocată;
- **după închiderea panoului:** pagina derulează din nou;
- **fereastra Indicatori:** fundalul nu se mișcă;
- **ecran complet + panou:** blocarea ține până la ieșirea din ecranul complet.
- **Control:** fără nimic deschis, rotița derulează pagina; peste grafic face zoom.

Suita completă (după FD-BROKERSTATS, FD-CHARTSTEADY, FD-GOLATESTMAIN, FD-SCROLLLOCK): 59 de fișiere, 593 de teste, toate trec.

# FD-PICKERSORT

## Runda 92 — zero probleme
Recitite:
- **`order.ts`:** colația `ro`, fără majuscule / diacritice / punctuație, numerele după valoare.
- **`IndicatorPicker`:**
  - fiecare ramură (căutare, Toți, Favorite, Premium, categorie) dă un tablou nou, sortat la final;
  - lista de favorite salvată nu se schimbă;
  - steaua scoate rândul fără să strice ordinea.
- **Comentariul `PREMIUM` din `Charts.tsx`; FD / TD / ghidul.**
- **Ordinea indicatorilor pe grafic și în legendă:** neatinsă.

Teste: `order.test.ts` (2), verificarea de tipuri, build-ul web.

Verificat în Chrome, la 1440 px, cu favoritele marcate în altă ordine (RSI, Slingshot, BB, EMA, LMA, ADR): Favorite, Premium, Toți (120), Medii mobile, Oscilatori, Volum și căutarea „average”, toate alfabetic.

# FD-HLINE, FD-DENAMES

## Runda 93 — 5 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Panoul liniei | un click pe linia al cărei panou e deschis ștergea previzualizarea, deși formularul își păstra modificările | un click pe linia cu panoul deschis nu schimbă nimic; verificat în Chrome |
| 2 | Tragerea cu panoul deschis | ciorna din panou (cu prețul vechi) acoperea prețul nou, linia sărea înapoi, iar „Salvează” punea la loc prețul vechi | ciorna se mută odată cu linia (în aceeași randare), iar formularul ia prețul nou; verificat (81982.9 → 81238.7, apoi salvat cu textul și culoarea din panou) |
| 3 | Salvările | salvarea din panou (cu răspunsul serverului) și o adăugare sau o tragere făcută între timp (optimiste) puteau să se suprascrie | toate salvările liniilor sunt optimiste: o schimbare pornește de la cea de dinainte; panoul verifică aceeași schemă ca serverul |
| 4 | Ghidul | liniile orizontale și cursorul lipseau | secțiunea din Grafice |
| 5 | FD §3 | Alt+H la limita de 50 de linii nu era descris | nu adaugă nimic (meniul „+” spune de ce) |

Recitite fără alte probleme:
- **`hlines.ts`:** schema, limitele, eliminarea listelor goale, salvarea parțială, vizibilitatea pe cele 13 intervale.
- **Setările:** cheile noi în `USER_KEYS`, salvarea parțială pe cheie.
- **`HLines`:**
  - linia, întreruperea pentru textul „Mijloc”, alinierile, rândurile textului;
  - eticheta de pe axă, ascunsă în afara panoului;
  - `hitTest` / `lineAt`.
- **`CandleChart`:**
  - liniile cursorului și tema;
  - „+”: ținut sub mouse, ascuns după 150 ms, meniul cu Esc și click în afară;
  - tragerea: `preventDefault` pe `pointerdown`, deci fără `mousedown` pentru grafic; atingerea doar deschide; `pointercancel`;
  - Alt+H, ignorat cât scrii într-un câmp.
- **`HLineSettings` și legătura cu pagina:** previzualizarea, Anulează / Esc, închiderea la schimbarea simbolului.
- **Numele `[DE]`:** constantele, legenda, panoul, lista, testul de ordine.

Teste: `hlines.test.ts` (5), `order.test.ts` (2), serverul (liniile și șablonul fiecăruia).

Notă: `order.test.ts` avea „[DI] Slingshot System 3.3” în așteptări, la 14:03, fără să fi fost scris în această sesiune (testul ar fi picat). Fișierul a fost rescris pentru numele `[DE]`.

## Runda 94 — 2 probleme (reparate)
| # | Zonă | Problemă | Reparație |
|---|---|---|---|
| 1 | Meniul „+” | cu meniul și panoul liniei deschise, Esc ar fi închis și panoul, cu modificările lui | meniul ascultă Esc în faza de captură și îl oprește. În Chrome, „+” stă sub panoul lateral cât acesta e deschis, deci cazul se atinge doar așa; Esc cu panoul singur îl închide fără să salveze, verificat |
| 2 | `saveHlines` | un parametru rămas nefolosit după ce toate salvările au devenit optimiste | scos |

## Runda 95 — zero probleme (HLINE, DENAMES)
Recitite, full scope:
- `hlines.ts`, setările (schema, `USER_KEYS`, salvarea parțială);
- `HLines`, `CandleChart` („+”, tragerea, Alt+H, liniile cursorului);
- `HLineSettings`:
  - sincronizarea prețului după o tragere;
  - previzualizarea doar cu o ciornă validă;
  - Anulează / Esc;
- legătura cu pagina:
  - salvările optimiste;
  - click pe linia deschisă;
  - închiderea la schimbarea simbolului;
- numele `[DE]`;
- FD / TD / ghidul.

Suita completă (după HLINE și DENAMES): 61 de fișiere, 601 teste, toate trec.
