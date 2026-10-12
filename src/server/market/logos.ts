// Coin logos for the UI (TD-ICONS): branded SVGs from @web3icons/core, served locally on demand so the web
// bundle does not carry 1.8k icons.

/** Tickers whose logo is filed under an older symbol in the icon set. */
const ALIASES: Record<string, string> = { RENDER: 'RNDR' };
const VALID = /^[A-Z0-9]{1,15}$/;
const MAX_CACHE = 2000;
const cache = new Map<string, string | null>();

/** The SVG markup for a ticker, or null when the symbol is invalid or has no logo. */
export async function coinLogo(symbol: string): Promise<string | null> {
  const sym = symbol.toUpperCase();
  // Only plain tickers reach the dynamic import below: no path separators or dots, ever.
  if (!VALID.test(sym)) return null;
  if (cache.has(sym)) return cache.get(sym) ?? null;
  let svg: string | null = null;
  try {
    const mod = (await import(`@web3icons/core/svgs/tokens/branded/${ALIASES[sym] ?? sym}.svg.js`)) as { default?: unknown };
    svg = typeof mod.default === 'string' && mod.default.trimStart().startsWith('<svg') ? mod.default : null;
  } catch {
    svg = null;
  }
  if (cache.size >= MAX_CACHE) cache.clear();
  cache.set(sym, svg);
  return svg;
}
