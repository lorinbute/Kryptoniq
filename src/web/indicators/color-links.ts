// FD-COLORUNIFY: one colour, one box, one effect, in every standard indicator. Which colour inputs are the colour of a
// whole line (one value, the same box in Intrări and Stil), which lines are coloured from the inputs by a calculation
// (their Stil box only says where), and the fixed colours of the lines drawn in several (a box each). Checked against
// every indicator by color-links.test.ts. In the main bundle: no indicator code needed.
import type { Study, StudyId } from '../../shared/studies.ts';

/** Colour inputs that are the whole colour of lines (case A): input id → the plots it colours. */
export const INPUT_LINES: Partial<Record<StudyId, Readonly<Record<string, readonly string[]>>>> = {
  'ma-ribbon': { ma1Color: ['plot0'], ma2Color: ['plot1'], ma3Color: ['plot2'], ma4Color: ['plot3'] },
};

/** The input whose colour a plot is drawn in (case A), if any. */
export function lineInput(id: StudyId, plotId: string): string | null {
  for (const [input, plots] of Object.entries(INPUT_LINES[id] ?? {})) if (plots.includes(plotId)) return input;
  return null;
}

/** Plots coloured from the inputs by a calculation (case C): the inputs the box shows, and where they are chosen. */
export const INPUT_COLORED: Partial<Record<StudyId, Readonly<Record<string, { inputs: readonly string[]; note: string }>>>> = {
  technicals: { plot0: { inputs: ['colStrongSell', 'colNeutral', 'colStrongBuy'], note: 'Culorile se aleg în Intrări, la Table Settings: Buy, Neutral, Sell.' } },
};

/** Lines drawn in several fixed colours (case B): every colour as the code writes it, in its order (TradingView's boxes). */
export const PLOT_PALETTES: Partial<Record<StudyId, Readonly<Record<string, readonly string[]>>>> = {
  // Grows above 0, falls above 0, grows below 0, falls below 0.
  macd: { plot0: ['#26A69A', '#B2DFDB', '#FFCDD2', '#FF5252'] },
  'price-oscillator': { plot0: ['#26A69A', '#B2DFDB', '#FFCDD2', '#FF5252'] },
  'volume-osc': { histogram: ['#26A69A', '#B2DFDB', '#FFCDD2', '#FF5252'] },
  'awesome-oscillator': { plot0: ['#009688', '#F44336'] },
  'bull-bear-power': { plot0: ['#089981', '#f23645'] },
  'woodies-cci': { plot0: ['#009688', '#F44336'] },
  'aroon-oscillator': { plot0: ['#4CAF50', '#FF5252'] },
  'volatility-stop': { plot0: ['#009688', '#F44336'] },
  'relative-volume-at-time': { plot0: ['#4CAF504D', '#F236454D'] },
  bbtrend: { plot0: ['#089981BF', '#08998180', '#F2364580', '#F23645BF'] },
  'chop-zone': { plot0: ['#26C6DA', '#43A047', '#A5D6A7', '#009688', '#D50000', '#E91E63', '#FF6D00', '#FFB74D', '#FDD835'] },
};

/** Two colour strings compared as one (the code writes #f23645 here, #F23645 there). */
export const colorKey = (c: string): string => c.toLowerCase().replace(/\s+/g, '');

/**
 * A study in the linked form (case A): a colour chosen before in Stil for a linked line was drawn only while its input
 * kept its default, so it becomes the input's value then; else the input's was drawn and stays. Pure, idempotent.
 */
export function linkStyle(study: Study): Study {
  const links = INPUT_LINES[study.id];
  if (!links || !study.plots) return study;
  let inputs = study.inputs;
  let plots: NonNullable<Study['plots']> | undefined = study.plots;
  for (const [input, ids] of Object.entries(links)) {
    for (const pid of ids) {
      const o = plots?.[pid];
      if (!o?.color) continue;
      if (!(input in inputs)) inputs = { ...inputs, [input]: o.color };
      const { color: _gone, ...rest } = o;
      const next: NonNullable<Study['plots']> = { ...plots };
      if (Object.keys(rest).length) next[pid] = rest;
      else delete next[pid];
      plots = Object.keys(next).length ? next : undefined;
    }
  }
  if (inputs === study.inputs && plots === study.plots) return study;
  const { plots: _old, ...base } = study;
  return { ...base, inputs, ...(plots ? { plots } : {}) };
}
