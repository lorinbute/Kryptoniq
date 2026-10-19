// The order of the "Indicatori" window's lists (FD-PICKERSORT): alphabetical by the name shown, whatever the tab.

// Case and diacritics do not count, nor punctuation ("[DE] Logarithmic …" is under D); numbers by value (2 before 10).
const collator = new Intl.Collator('ro', { sensitivity: 'base', numeric: true, ignorePunctuation: true });

export const compareIndicatorNames = (a: string, b: string): number => collator.compare(a, b);
