// Short Romanian explanations for the key macro events (FD §4.1).

const ENTRIES: [RegExp, string][] = [
  [/\bcore (cpi|inflation)/i, 'Inflația de bază (fără energie și alimente). Peste așteptări → dobânzi mari mai mult timp → presiune pe crypto și acțiuni.'],
  [/\bcpi\b|\binflation rate\b|consumer price/i, 'Inflația prețurilor de consum. Peste așteptări e de obicei negativ pentru crypto/acțiuni; sub așteptări, pozitiv.'],
  [/\bcore pce\b/i, 'Indicatorul de inflație preferat de Fed (fără energie și alimente).'],
  [/\bpce\b/i, 'Inflația cheltuielilor de consum (PCE), urmărită atent de Fed.'],
  [/\bppi\b|producer price/i, 'Inflația la producător — semnal timpuriu pentru inflația de consum.'],
  [/adp/i, 'Estimarea ADP a locurilor de muncă din sectorul privat (preview pentru NFP).'],
  [/non-?farm|\bnfp\b|payrolls/i, 'Locuri de muncă nou create în afara agriculturii (NFP). Mișcă puternic piețele.'],
  [/unemployment rate/i, 'Rata șomajului. Creșterea neașteptată semnalează o economie mai slabă.'],
  [/jobless claims|unemployment claims/i, 'Cereri noi de ajutor de șomaj (săptămânal).'],
  [/average hourly earnings/i, 'Creșterea salariilor — componentă importantă a inflației.'],
  [/jolts/i, 'Posturi disponibile (JOLTS) — cererea de forță de muncă.'],
  [/federal funds rate|fed interest rate|fomc statement|rate decision/i, 'Decizia Fed privind dobânda. Cel mai important eveniment macro pentru piețe.'],
  [/fomc (meeting )?minutes/i, 'Minutele ședinței Fed — detalii despre discuțiile membrilor.'],
  [/fomc press conference|powell/i, 'Conferința/discursul președintelui Fed — tonul (hawkish/dovish) contează.'],
  [/fomc member|speech|speaks/i, 'Discurs al unui oficial de bancă centrală — poate da indicii despre dobânzi.'],
  [/retail sales/i, 'Vânzările cu amănuntul — puterea consumului.'],
  [/\bgdp\b/i, 'Produsul intern brut — creșterea economică.'],
  [/ism manufacturing/i, 'Indicele ISM al industriei (peste 50 = expansiune).'],
  [/ism services|ism non-?manufacturing/i, 'Indicele ISM al serviciilor (peste 50 = expansiune).'],
  [/michigan|uom consumer sentiment/i, 'Încrederea consumatorilor (Univ. Michigan) + așteptările de inflație.'],
  [/cb consumer confidence/i, 'Încrederea consumatorilor (Conference Board).'],
  [/crude oil inventories|crude oil stocks/i, 'Stocurile de țiței din SUA — influențează prețul petrolului.'],
  [/ecb|main refinancing rate/i, 'Decizia Băncii Centrale Europene privind dobânda.'],
  [/boj|bank of japan/i, 'Decizia Băncii Japoniei — poate declanșa mișcări mari în yen și în piețele de risc.'],
  [/bank holiday/i, 'Zi liberă bancară — lichiditate redusă.'],
];

export function explain(title: string): string | null {
  for (const [re, text] of ENTRIES) if (re.test(title)) return text;
  return null;
}
