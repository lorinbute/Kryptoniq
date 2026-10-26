// FD-AISLOW §4: the line under the AI scoring choice that says how far the user's AI got with the last 48 hours.
import type { AiProgress } from '../../shared/api-types.ts';
import { fmtAgo, fmtNum } from '../format.ts';

/** Two or more headlines, with the Romanian „de” from 20 on. */
const titlesRo = (n: number): string => `${fmtNum(n, 0)}${n % 100 >= 20 || n % 100 === 0 ? ' de' : ''} titluri`;

/** FD-AISLOW §4: how far the user's AI got with the news it scores. */
export function progressText(product: string, p: AiProgress, now = Date.now()): string {
  const done =
    p.total === 1
      ? p.scored >= 1
        ? `${product} a scorat singurul titlu`
        : `${product} nu a scorat încă singurul titlu`
      : p.scored >= p.total
        ? `${product} a scorat toate cele ${titlesRo(p.total)}`
        : `${product} a scorat ${fmtNum(p.scored, 0)} din ${titlesRo(p.total)}`;
  return `Ultimele 48 h: ${done}${p.lastAt != null ? `; ultimul scor ${fmtAgo(Math.min(p.lastAt, now), now)}` : ''}.`;
}
