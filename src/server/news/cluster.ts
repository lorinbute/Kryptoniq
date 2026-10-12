// Story clustering: the same story published by several outlets counts once (TD §5.6).

const STOPWORDS = new Set(
  (
    'a an the and or but of to in on at for from by with as is are was were be been being it its this that these those into over ' +
    'after before about amid against up down out than then so if not no yes new says say said will would could can may might has have ' +
    'had do does did just more most less what why how who when where which while here there his her their our your my we you they he she ' +
    'via per vs report reports reportedly according amid live update updates breaking news today week year'
  ).split(' '),
);

export function titleTokens(title: string): Set<string> {
  const out = new Set<string>();
  const norm = title
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/(\d),(\d)/g, '$1$2')
    .replace(/[^\p{L}\p{N}$%.]+/gu, ' ');
  for (let tok of norm.split(' ')) {
    tok = tok.replace(/^[.]+|[.]+$/g, '');
    if (!tok || STOPWORDS.has(tok)) continue;
    if (tok.length > 3 && tok.endsWith('s') && !/\d/.test(tok) && !tok.endsWith('ss')) tok = tok.slice(0, -1);
    out.add(tok);
  }
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

const hasNumber = (s: Set<string>) => [...s].some((t) => /\d/.test(t));

export interface ClusterCandidate {
  id: string;
  clusterId: string;
  tokens: Set<string>;
  coins: string[];
}

/** Returns the cluster id the new item joins, or null when it starts its own cluster. */
export function findCluster(tokens: Set<string>, coins: string[], candidates: ClusterCandidate[]): string | null {
  let best: { sim: number; clusterId: string } | null = null;
  const coinKey = [...coins].sort().join(',');
  for (const c of candidates) {
    const sim = jaccard(tokens, c.tokens);
    let ok = sim >= 0.5;
    if (!ok && sim >= 0.34 && coinKey !== '' && coinKey === [...c.coins].sort().join(',')) {
      const shared = [...tokens].some((t) => /\d/.test(t) && c.tokens.has(t));
      ok = shared && hasNumber(tokens);
    }
    if (ok && (!best || sim > best.sim)) best = { sim, clusterId: c.clusterId };
  }
  return best?.clusterId ?? null;
}
