# Kryptoniq

Asistent local de day-trading: știri crypto + macro cu sentimentul zilei, calendar economic, grafice cu Slingshot System și pozițiile de pe exchange.

```bash
npm install
npm start   # http://127.0.0.1:4317
```

Fără Terminal: `scripts/kryptoniq.sh app` creează **`Kryptoniq.app`**. La dublu-click pornește serverul în fundal și deschide browserul; îl poți pune în Dock sau la Login Items. Din Terminal: `scripts/kryptoniq.sh start | stop | restart | status | logs`. Detalii în [ghidul de utilizare](docs/user-guide.md#pornire-fără-terminal-kryptoniqapp).

Toată documentația este în [`docs/`](docs/): [ghid de utilizare](docs/user-guide.md), [functional design](docs/functional-design.md), [technical design](docs/technical-design.md), [research](docs/research.md), [portul indicatorului](docs/slingshot-port.md).
