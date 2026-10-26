// "De ce acest scor?" (FD-SCOREWHY): what gave a news item its score, on the News page and in "Ce mișcă piața".
import type { ReactNode } from 'react';
import type { ScoreWhy as Why } from '../../shared/api-types.ts';
import { engineLabel } from '../../shared/ai.ts';
import { fmtNum } from '../format.ts';

type Meta = { model?: number | null; rules?: { id: string; score: number; text: string; negated: boolean }[] } | null;

/** The AI that scored an item ("Claude", "ChatGPT", "Gemini"), from its engine; "AI" for any other. */
export function aiNameOf(engine: string): string {
  return /^(claude|openai|gemini):/.test(engine) ? engineLabel(engine).replace(/ \(.*$/, '') : 'AI';
}

/** Closed at first; `why` null shows only `children` (the item's details are gone). */
export function ScoreWhy({ why, children }: { why: Why | null; children?: ReactNode }) {
  const meta = why?.meta as Meta;
  // Who gave the importance: the AI that scored the item.
  const aiName = why ? aiNameOf(why.engine) : 'AI';
  return (
    <details className="text-[12px] text-faint">
      <summary className="cursor-pointer transition-colors hover:text-accent">De ce acest scor?</summary>
      <div className="mt-1.5 space-y-0.5">
        {why && (
          <>
            {/* FD-WHYPLAIN §3: the AI's own reason first, when it gave one. */}
            {why.reason && (
              <div className="text-muted">
                Motivul ({aiName}): {why.reason}
              </div>
            )}
            <div>Motor: {engineLabel(why.engine)}</div>
            {typeof meta?.model === 'number' && <div>Model: {meta.model.toFixed(2)}</div>}
            {meta?.rules?.map((r, i) => (
              <div key={i}>
                Regula „{r.id}” pe „{r.text}”: {r.score > 0 ? '+' : ''}
                {r.score}
                {r.negated ? ' (negată)' : ''}
              </div>
            ))}
            <div>
              Relevanță {fmtNum(why.relevance, 2)}, importanță {fmtNum(why.impact, 1)}{' '}
              {why.impactSource === 'ai'
                ? why.ruleImpact !== why.impact
                  ? `(${aiName}), importanță ${fmtNum(why.ruleImpact, 1)} (cuvinte-cheie)`
                  : `(${aiName} și cuvinte-cheie)`
                : '(cuvinte-cheie)'}
            </div>
          </>
        )}
        {children}
      </div>
    </details>
  );
}
