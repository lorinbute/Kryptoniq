# Sentiq

Asistent de day-trading (*sentiment* + *IQ*, fostul Kryptoniq), cu datele în **Azure SQL Database**. Rulează pe Mac-ul tău și se deschide din rețeaua de acasă; e pregătit și pentru Azure App Service ([pașii](docs/deploy-azure.md)):
- știri crypto, acțiuni, macro și geopolitică, cu **sentimentul zilei** (model local, sau AI-ul fiecăruia) și **rezumatul zilei** scris de AI-ul ales de fiecare (Claude, ChatGPT sau Gemini, pe cheia proprie);
- **calendar economic** cu rezultatele companiilor și pagina **Economie** (indicatorii pe 9 țări / zone);
- **grafice** cu Slingshot System 3.3 și [DI] LMA (Premium) plus oricare dintre cei 117 indicatori standard TradingView și Volume, pentru monede, acțiuni și indici americani (S&P 500, Nasdaq, Dow…), cu pozițiile tale și PnL; acțiunile pe 1m – 4h cu cheia Twelve Data a fiecăruia;
- **portofolii** de la 7 exchange-uri crypto și 4 brokeri, cu **ordine din Sentiq** (spot, futures, acțiuni; pornite pe cont cu parola și 2FA, fiecare ordin confirmat; fără retrageri sau transferuri) pe toate în afară de Interactive Brokers;
- temă întunecată și temă luminoasă.

```bash
npm install
# conexiunea la bază: data/database.env (server, bază, utilizator, parolă sau connection string)
scripts/sentiq.sh db-check
npm start   # http://localhost:4317 (și din rețeaua locală)
```

Datele de dinainte de Azure (`data/kryptoniq.db`) se mută o singură dată cu `scripts/sentiq.sh import-sqlite`. Testele (`npm test`) rulează în aceeași bază, în scheme separate (`t_…`) pe care le șterg la final. Detalii în [ghid](docs/user-guide.md#pornire).

Conturi pentru mai mulți utilizatori: adminul (deja creat, cu datele de până acum) își setează parola la prima deschidere de pe Mac; ceilalți cer un cont (nume și email), adminul îl aprobă, iar ei își setează parola din linkul de activare primit pe email (Resend). Autentificarea în doi pași (TOTP + coduri de recuperare) e obligatorie: se configurează imediat după activare, înainte de orice altceva. Login cu parolă și cod sau cu passkey. Detalii în [ghid](docs/user-guide.md#conturi-și-autentificare).

AI în Sentiq: fiecare utilizator își pune cheia API proprie (Anthropic, OpenAI sau Google Gemini) în Setări → Ale mele → Inteligență artificială. Cu ea are Rezumatul zilei și, dacă alege, scorul știrilor dat de AI-ul său; fără cheie, sentimentul vine de la modelul local. Consumul zilei se vede în același panou. (Connectorul MCP a fost scos pe 14 oct 2026.)

Fără Terminal: `scripts/sentiq.sh app` creează **`Sentiq.app`**. La dublu-click pornește serverul în fundal și deschide browserul; îl poți pune în Dock sau la Login Items. Din Terminal: `scripts/sentiq.sh start | stop | restart | status | logs`. Vechiul `Kryptoniq.app` (și `scripts/kryptoniq.sh`) nu mai există: dacă îl ai în Dock sau la Login Items, înlocuiește-l cu `Sentiq.app`. Detalii în [ghidul de utilizare](docs/user-guide.md#pornire-fără-terminal-sentiqapp).

Toată documentația este în [`docs/`](docs/): [ghid de utilizare](docs/user-guide.md), [functional design](docs/functional-design.md) și [technical design](docs/technical-design.md) (Partea I: aplicația de azi; Partea a II-a: istoricul deciziilor), [research](docs/research.md), [portul indicatorului](docs/slingshot-port.md), [jurnalul de lucru](docs/PROGRESS.md), [review-urile](docs/review-log.md).
