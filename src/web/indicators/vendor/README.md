# Indicatorii standard TradingView (cod preluat)

Sursa: [deepentropy/lightweight-charts-indicators](https://github.com/deepentropy/lightweight-charts-indicators), commit
`f8e1b0ea80699a58f9d516ca74f0dfd5e6277ab2` (18 oct 2026, versiunea 0.16.8), licență MIT (`LICENSE`).

Preluate (FD-INDICATORS, TD-INDICATORS §1):
- `standard/`: cei 117 indicatori standard;
- `render/`: `IndicatorRenderer`, care îi desenează pe Lightweight Charts 5;
- ajutoarele pe care le importă: `types.ts`, `chart-context.ts`, `anchor-period.ts`, `alert-states.ts`,
  `other-symbol.ts`, `lower-tf-volume.ts`, `bar-time.ts`.

Singura modificare: antetul `// @ts-nocheck` pe fiecare fișier. Codul e verificat de tipuri cu setările upstream
(`strict`), nu cu cele ale Sentiq (`noUncheckedIndexedAccess`, `erasableSyntaxOnly`). Biblioteca lor de calcul,
`oakscriptjs`, e o dependență npm fixată (0.12.3).

La o actualizare: același set de fișiere de la un commit nou, antetul pus din nou, apoi `src/web/indicators/catalog*.ts`
regenerate din `src/index.ts` (intrările `group: 'standard'`) și testele din `src/web/indicators/`.

Descrierile din `catalog-meta.ts` sunt traduse în română (FD-RODESC): o regenerare păstrează textele românești existente
și traduce doar descrierile indicatorilor noi; numele rămân cele din TradingView.
