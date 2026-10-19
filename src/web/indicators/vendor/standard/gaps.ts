// @ts-nocheck
/**
 * Gaps
 *
 * Finds price gaps between two bars: a gap up when the low is above the previous high, a gap down when the high is
 * below the previous low, at least `Minimal Deviation (%)` of the 14-bar average high-low range (ta.sma(high - low,
 * 14)). Each gap is drawn as a box from the bar before the gap, extended to the right until price covers it:
 * - by default the box stops on the bar where price enters the gap (or covers it, or the length limit is reached);
 * - with "Close Gaps Partially", each bar that enters the gap stops the current box and starts a smaller box with the
 *   part still open; the gap ends (its last box deleted) when price covers it fully or the length limit is reached.
 * Only the last `Max Number of Gaps` gaps are kept (their boxes are deleted with them); at most 500 boxes stay on
 * the chart (max_boxes_count = 500, oldest deleted first).
 * When no gap is found, a table at the bottom right says so (on the last confirmed bar of the history).
 *
 * Based on the standard Gaps indicator.
 *
 * The table colours are the chart colours (chart.bg_color text on chart.fg_color) and the bar of
 * barstate.islastconfirmedhistory depends on the state of the last bar: both come from the optional third argument
 * (see src/chart-context.ts); without it the dark theme colours are used and the last bar is taken as closed.
 * The alert conditions are not ported.
 */

import {
  ta, box, table, compare, resetDrawings, setDrawingBar, drawingOutputs, Series,
  type Box, type IndicatorResult, type InputConfig, type PlotConfig, type Bar,
} from 'oakscriptjs';
import type { BoxData, TableData } from '../types';
import { alertStates, type AlertConditionDecl, type AlertConditionState } from '../alert-states';
import { backgroundColorOf, foregroundColorOf, lastBarConfirmedOf, type ChartContext } from '../chart-context';

export interface GapsInputs {
  /** Close Gaps Partially */
  closeGapsPartially: boolean;
  /** Max Number of Gaps */
  boxLimit: number;
  /** Minimal Deviation (%) of the 14-bar average high-low range */
  minimalDeviation: number;
  /** Limit Max Gap Trail Length (bars) */
  limitBoxLength: boolean;
  /** Maximum length of a gap box in bars, when the limit is on */
  boxLengthLimit: number;
  /** Border colour of the up gaps */
  colorUpBorder: string;
  /** Fill colour of the up gaps */
  colorUpBackground: string;
  /** Border colour of the down gaps */
  colorDownBorder: string;
  /** Fill colour of the down gaps */
  colorDownBackground: string;
}

export const defaultInputs: GapsInputs = {
  closeGapsPartially: false,
  boxLimit: 15,
  minimalDeviation: 30.0,
  limitBoxLength: false,
  boxLengthLimit: 300,
  colorUpBorder: '#4CAF50',
  // color.new(color.green, 85) as an input default: alpha 0.15, byte 38
  colorUpBackground: '#4CAF5026',
  colorDownBorder: '#F23645',
  // color.new(color.red, 85)
  colorDownBackground: '#F2364526',
};

const MINIMAL_DEVIATION_TOOLTIP = 'Specifies the minimal size of detected gaps, as a percentage of the average high-low range for the last 14 bars.';
const COLOR_GROUP = 'Border and fill colors';

export const inputConfig: InputConfig[] = [
  { id: 'closeGapsPartially', type: 'bool', title: 'Close Gaps Partially', defval: false, display: 'data_window' },
  { id: 'boxLimit', type: 'int', title: 'Max Number of Gaps', defval: 15, min: 1, max: 500, display: 'data_window' },
  { id: 'minimalDeviation', type: 'float', title: 'Minimal Deviation (%)', defval: 30.0, min: 1, max: 100, tooltip: MINIMAL_DEVIATION_TOOLTIP, display: 'data_window' },
  { id: 'limitBoxLength', type: 'bool', title: 'Limit Max Gap Trail Length (bars)', defval: false, inline: 'Length Limit', display: 'data_window' },
  { id: 'boxLengthLimit', type: 'int', title: '', defval: 300, min: 1, inline: 'Length Limit', display: 'data_window', active: 'limitBoxLength' },
  { id: 'colorUpBorder', type: 'color', title: 'Up Gaps', defval: '#4CAF50', inline: 'Gap Up', group: COLOR_GROUP, display: 'data_window' },
  { id: 'colorUpBackground', type: 'color', title: '', defval: '#4CAF5026', inline: 'Gap Up', group: COLOR_GROUP, display: 'data_window' },
  { id: 'colorDownBorder', type: 'color', title: 'Down Gaps', defval: '#F23645', inline: 'Gap Down', group: COLOR_GROUP, display: 'data_window' },
  { id: 'colorDownBackground', type: 'color', title: '', defval: '#F2364526', inline: 'Gap Down', group: COLOR_GROUP, display: 'data_window' },
];

// No plots: the output is boxes (and a table when no gap is found)
export const plotConfig: PlotConfig[] = [];

export const metadata = {
  title: 'Gaps',
  shortTitle: 'Gaps',
  overlay: true,
};

/** indicator(max_boxes_count = 500) */
const MAX_BOXES = 500;

/** Pine v6 default text colour of a box (white); the boxes have no text */
const BOX_TEXT_COLOR = '#FFFFFF';

const NO_GAP_TEXT = 'No gaps found on the current chart. \n The cause could be that some exchanges align the open of new bars on the close of the previous one, resulting in charts with no gaps. Alternatively, your Minimal Deviation might be too high.';

/** type Gap: isActive, isBull (true for a gap DOWN in the original, see registerNewGap), the boxes drawn for it */
interface Gap {
  isActive: boolean;
  isBull: boolean;
  boxes: Box[];
}

/** Reference alertconditions: a gap registered on the bar / a gap fully closed on the bar (AlertInfo counts, reset
 *  on every bar) */
export const alertConditions: AlertConditionDecl[] = [
  { id: 'alert0', title: 'New Gap Appeared', message: 'A new gap has appeared.' },
  { id: 'alert1', title: 'Gap Closed', message: 'A gap was closed.' },
];

export function calculate(
  bars: Bar[],
  inputs: Partial<GapsInputs> = {},
  chart?: ChartContext,
): IndicatorResult & { boxes: BoxData[]; tables: TableData[]; alerts: AlertConditionState[] } {
  const cfg = { ...defaultInputs, ...inputs };
  const n = bars.length;

  // minimalDeviationInput = nz(input / 100 * ta.sma(high - low, 14))
  const range = ta.sma(new Series(bars, (b) => b.high - b.low), 14).toArray();
  const minimalDeviation = range.map((v) => {
    const d = (cfg.minimalDeviation / 100) * (v ?? NaN);
    return Number.isNaN(d) ? 0 : d;
  });

  resetDrawings({ box: MAX_BOXES });

  // var allGaps = array.new<Gap>()
  const allGaps: Gap[] = [];
  const last = (g: Gap) => g.boxes[g.boxes.length - 1];

  // barstate.islastconfirmedhistory: the last bar when it is closed, else the bar before it
  const lastConfirmedHistory = lastBarConfirmedOf(chart) ? n - 1 : n - 2;
  let infoTableMade = false;
  const opened: boolean[] = new Array(n).fill(false);
  const closed: boolean[] = new Array(n).fill(false);

  for (let i = 0; i < n; i++) {
    setDrawingBar(i, i === n - 1);
    const { high, low } = bars[i];

    // method fullClose(Gap this)
    const fullClose = (gap: Gap) => {
      // alertInfo.countClosedGap += 1
      closed[i] = true;
      const activeBox = last(gap);
      box.set_extend(activeBox, 'none');
      gap.isActive = false;
      if (cfg.closeGapsPartially) box.delete(activeBox);
    };

    // method partialClose(Gap this): stops the box, starts a smaller box with the part still open
    const partialClose = (gap: Gap) => {
      const activeBox = last(gap);
      box.set_extend(activeBox, 'none');
      const top = gap.isBull ? box.get_top(activeBox) : low;
      const bottom = gap.isBull ? high : box.get_bottom(activeBox);
      gap.boxes.push(box.new(i, top, i, bottom,
        gap.isBull ? cfg.colorDownBorder : cfg.colorUpBorder, undefined, undefined, undefined, undefined,
        gap.isBull ? cfg.colorDownBackground : cfg.colorUpBackground, undefined, undefined, BOX_TEXT_COLOR));
    };

    // Detect covering of gaps: for gap in allGaps: gap.checkForClose()
    for (const gap of allGaps) {
      if (!gap.isActive) continue;
      const activeBox = last(gap);
      const top = box.get_top(activeBox);
      const bot = box.get_bottom(activeBox);
      const isBull = gap.isBull;
      box.set_right(activeBox, i);

      if ((compare.gt(high, bot) && isBull) || (compare.lt(low, top) && !isBull)) {
        if (cfg.closeGapsPartially) partialClose(gap);
        else fullClose(gap);
      }

      const forceClose = cfg.limitBoxLength && i - box.get_left(activeBox) >= cfg.boxLengthLimit;
      if ((compare.gt(high, top) && isBull) || (compare.lt(low, bot) && !isBull) || forceClose) {
        fullClose(gap);
      }
    }

    // Detect gaps
    const prev = i > 0 ? bars[i - 1] : undefined;
    const prevLow = prev ? prev.low : NaN;
    const prevHigh = prev ? prev.high : NaN;
    const isGapDown = compare.lt(high, prevLow) && compare.ge(prevLow - high, minimalDeviation[i]);
    const isGapUp = compare.gt(low, prevHigh) && compare.ge(low - prevHigh, minimalDeviation[i]);

    // registerNewGap(isGapDown)
    if (isGapDown || isGapUp) {
      // alertInfo.countOpenGap += 1
      opened[i] = true;
      const newBox = box.new(i - 1, isGapDown ? prevLow : low, i, isGapDown ? high : prevHigh,
        isGapDown ? cfg.colorDownBorder : cfg.colorUpBorder, undefined, undefined, 'right', undefined,
        isGapDown ? cfg.colorDownBackground : cfg.colorUpBackground, undefined, undefined, BOX_TEXT_COLOR);
      allGaps.push({ isActive: true, isBull: isGapDown, boxes: [newBox] });
      if (allGaps.length > cfg.boxLimit) {
        // allGaps.shift().delete(): deletes every box of the oldest gap
        for (const b of allGaps.shift()!.boxes) box.delete(b);
      }
    }

    // if barstate.islastconfirmedhistory and allGaps.size() == 0: var infoTable = table.new(position.bottom_right, 1, 1)
    if (i === lastConfirmedHistory && allGaps.length === 0) {
      if (!infoTableMade) {
        const infoTable = table.new('bottom_right', 1, 1);
        // text_size not set: size.auto (the reference cell has 'auto')
        table.cell(infoTable, 0, 0, NO_GAP_TEXT, undefined, undefined, backgroundColorOf(chart), undefined, undefined,
          'auto', foregroundColorOf(chart));
        infoTableMade = true;
      }
    }
  }
  setDrawingBar(null);

  const { boxes = [], tables = [] } = drawingOutputs(bars);
  return {
    metadata: { title: metadata.title, shorttitle: metadata.shortTitle, overlay: metadata.overlay },
    plots: {},
    boxes,
    tables,
    alerts: alertStates(alertConditions, bars, [opened, closed]),
  };
}

export const Gaps = { calculate, metadata, defaultInputs, inputConfig, plotConfig, alertConditions };
