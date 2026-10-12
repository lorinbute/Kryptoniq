# Code review log (v1)

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
