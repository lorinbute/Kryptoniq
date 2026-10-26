// FD-WHYPLAIN: the explanations in words: how much one news item moved the day's index, and why it weighs what it does.
import { fmtNum } from './format.ts';

export interface Weighs {
  relevance: number;
  impact: number;
  sourceWeight: number;
  spec: number;
  flags: string[];
  decay: number;
  clusterN: number;
  cap: number;
  share: number;
}

const FLAG: Record<string, string> = { sponsored: 'sponsorizat', speculative: 'speculativ', recap: 'rezumat' };

/** "+0,10 puncte", "−0,04 puncte", "0,00 puncte". */
export function fmtPoints(effect: number): string {
  const s = fmtNum(Math.abs(effect), 2, 2);
  const zero = Math.abs(effect) < 0.005;
  return `${zero ? '' : effect > 0 ? '+' : '−'}${zero ? fmtNum(0, 2, 2) : s} puncte`;
}

/** "Fără ea, indicele ar fi 47.8 (acum 47.9): +0,10 puncte." The index written as on the card. */
export function effectLine(index: number, without: number, effect: number): string {
  const was = (Math.round(without * 10) / 10).toFixed(1);
  const now = index.toFixed(1);
  return was === now ? `Fără ea, indicele ar fi tot ${now}: ${fmtPoints(effect)}.` : `Fără ea, indicele ar fi ${was} (acum ${now}): ${fmtPoints(effect)}.`;
}

/** "acum 35 min", "acum 4 h". */
function ago(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  return min < 60 ? `acum ${min} min` : `acum ${Math.round(min / 60)} h`;
}

/**
 * "Cântărește de 4,4 ori cât o știre obișnuită de azi: importanță 3 (Claude), sursa CoinDesk are greutatea 1,2, e de acum
 * 4 h (mai contează 68%)." — `count`: the news counted today; `importanceBy`: who gave the importance.
 */
export function weighLine(w: Weighs, count: number, source: string, publishedAt: number, now: number, importanceBy: string): string {
  const ratio = w.share * count;
  const head =
    ratio >= 1
      ? `Cântărește de ${fmtNum(ratio, 1, 1)} ori cât o știre obișnuită de azi`
      : `Cântărește cât ${fmtNum(ratio * 100, 0)}% dintr-o știre obișnuită de azi`;
  const parts = [`importanță ${fmtNum(w.impact, 1)} (${importanceBy})`, `sursa ${source} are greutatea ${fmtNum(w.sourceWeight, 2)}`, `e de ${ago(now - publishedAt)} (mai contează ${fmtNum(w.decay * 100, 0)}%)`];
  if (w.relevance < 1) parts.push(`relevanță ${fmtNum(w.relevance, 2)}`);
  if (w.clusterN > 1) parts.push(`preluată de ${w.clusterN} surse (povestea contează aproape o dată)`);
  if (w.spec < 1) {
    const why = w.flags.map((f) => FLAG[f]).filter(Boolean).join(', ');
    parts.push(`factor ${fmtNum(w.spec, 1)}${why ? ` (${why})` : ''}`);
  }
  // How much it moved the index says the effect line; here only what the cap did to its weight.
  const capped = w.cap < 1 ? ` Sursa ei e tăiată de plafon, deci fiecare știre a ei cântărește cu ${fmtNum((1 - w.cap) * 100, 0)}% mai puțin.` : '';
  return `${head}: ${parts.join(', ')}.${capped}`;
}
