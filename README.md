# Sentiq

Asistent de day-trading (*sentiment* + *IQ*, fostul Kryptoniq) care rulează pe Mac-ul tău și se deschide din rețeaua de acasă:
- știri crypto, acțiuni, macro și geopolitică, cu **sentimentul zilei** (model local sau Claude) și, opțional, **rezumatul zilei** scris de Claude;
- **calendar economic** cu rezultatele companiilor și pagina **Economie** (indicatorii pe 9 țări / zone);
- **grafice** cu Slingshot System 3.3 și [DI] LMA pentru monede și acțiuni americane, cu pozițiile tale și PnL;
- **portofolii** de la 7 exchange-uri crypto și 4 brokeri (doar citire);
- temă întunecată și temă luminoasă.

```bash
npm install
npm start   # http://localhost:4317 (și din rețeaua locală)
```

Conturi pentru mai mulți utilizatori: adminul (deja creat, cu datele de până acum) își setează parola la prima deschidere de pe Mac; ceilalți cer un cont (nume și email), adminul îl aprobă, iar ei își setează parola din linkul de activare primit pe email (Resend). Login cu parolă și 2FA (TOTP + coduri de recuperare) sau cu passkey. Detalii în [ghid](docs/user-guide.md#conturi-și-autentificare).

Claude cu abonamentul fiecăruia: Sentiq e și un **connector MCP** pentru Claude (doar citire, OAuth cu login-ul Sentiq). E gata, dar oprit până la găzduirea online: pornește cu `SENTIQ_PUBLIC_URL=https://…` și `SENTIQ_MCP=1`. Detalii în [ghid](docs/user-guide.md#claude-cu-abonamentul-tău-connector).

Fără Terminal: `scripts/sentiq.sh app` creează **`Sentiq.app`**. La dublu-click pornește serverul în fundal și deschide browserul; îl poți pune în Dock sau la Login Items. Din Terminal: `scripts/sentiq.sh start | stop | restart | status | logs`. Vechiul `Kryptoniq.app` (și `scripts/kryptoniq.sh`) nu mai există: dacă îl ai în Dock sau la Login Items, înlocuiește-l cu `Sentiq.app`. Detalii în [ghidul de utilizare](docs/user-guide.md#pornire-fără-terminal-sentiqapp).

Toată documentația este în [`docs/`](docs/): [ghid de utilizare](docs/user-guide.md), [functional design](docs/functional-design.md) și [technical design](docs/technical-design.md) (Partea I: aplicația de azi; Partea a II-a: istoricul deciziilor), [research](docs/research.md), [portul indicatorului](docs/slingshot-port.md), [jurnalul de lucru](docs/PROGRESS.md), [review-urile](docs/review-log.md).
