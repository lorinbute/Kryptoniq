// @ts-nocheck
/**
 * Pivot Points Standard
 *
 * Support and resistance levels of a higher timeframe period, drawn as horizontal lines with labels from the start of
 * each period. The levels of a period come from the high, low and close (and the open for Woodie and DM) of the
 * period before it, with one of six formulas (ta.pivot_point_levels): Traditional (P, R1-R5, S1-S5), Fibonacci
 * (P, R1-R3, S1-S3), Woodie and Classic (P, R1-R4, S1-S4), DM (P, R1, S1) and Camarilla (P, R1-R5, S1-S5).
 *
 * Pivots Timeframe "Auto": a day on charts of 15 minutes or less, a week on other intraday charts, a month on daily
 * charts, a year above. Biyearly / Triyearly / Quinquennially / Decennially: yearly periods that start in a year
 * divisible by 2 / 3 / 5 / 10. Each period draws a line and a label per level from the first bar of the period to
 * the expected end of the period (start time plus the period length); the lines of the period before end where the
 * new ones start. The last 'Number of Pivots Back' periods are kept (at most 500 lines and 500 labels).
 *
 * Based on the standard Pivot Points Standard indicator.
 *
 * Use Daily-based Values (default): the levels of the bars of the pivots timeframe of the symbol (request.security
 * with lookahead). On intraday and weekly charts the port asks the host for these bars of the chart symbol
 * (`requiredSymbols`: the ticker id of the chart context on the pivots timeframe; `bars` accessor of the context) and
 * shows them with `securityOther` (lookahead on): exact, as the original reads the symbol's own daily-based bars.
 * When the host gives no bars, and on daily and monthly charts (their bars fall inside the periods), the periods are
 * built from the chart bars (src/anchor-period.ts, exchange calendar of the chart context). Limits of that fallback
 * on intraday and weekly charts: the closes of stocks differ from the daily data (closing auction), a week across two
 * periods is in one period only, and the periods before the first chart bar are missing, so the first period can
 * differ and, when no period starts on the chart, the port throws its "Not enough data" error where the original
 * draws the levels of the period before from the first bar.
 * Off: the periods are built from the chart bars, as the original.
 * A pivots timeframe below the chart timeframe with daily-based values needs lower timeframe data: the port throws.
 *
 * Chart values read: the chart timeframe, the ticker id (host bars), the exchange time zone and session (periods, year of a period), the symbol
 * tick (prices of the labels) and the state of the last bar (the levels are drawn from the first bar when no period
 * starts on the chart).
 */

import {
  taCore, timeframe, time as ptime, str, line, label, resetDrawings, setDrawingBar, drawingOutputs, mapToChart,
  type Line, type Label, type IndicatorResult, type InputConfig, type PlotConfig, type Bar,
} from 'oakscriptjs';
import type { LabelData, LineDrawingData } from '../types';
import { chartTimeframe, higherTimeframeBars, periodChanges } from '../anchor-period';
import { lastBarConfirmedOf, mintickOf, tickeridOf, timezoneOf, type ChartContext, type SymbolRequest } from '../chart-context';
import { otherSymbolChart, securityOther } from '../other-symbol';

export type PivotType = 'Traditional' | 'Fibonacci' | 'Woodie' | 'Classic' | 'DM' | 'Camarilla';
export type PivotAnchor = 'Auto' | 'Daily' | 'Weekly' | 'Monthly' | 'Quarterly' | 'Yearly' | 'Biyearly' | 'Triyearly'
  | 'Quinquennially' | 'Decennially';

export interface PivotPointsStandardInputs {
  pivotType: PivotType;
  pivotAnchor: PivotAnchor;
  /** Number of periods kept on the chart */
  maxHistoricalPivots: number;
  /** Levels of the periods of the symbol (true) or of the chart bars (false) */
  isDailyBased: boolean;
  showLabels: boolean;
  showPrices: boolean;
  positionLabels: 'Left' | 'Right';
  linewidth: number;
  pColor: string;
  pShow: boolean;
  s1Color: string;
  s1Show: boolean;
  r1Color: string;
  r1Show: boolean;
  s2Color: string;
  s2Show: boolean;
  r2Color: string;
  r2Show: boolean;
  s3Color: string;
  s3Show: boolean;
  r3Color: string;
  r3Show: boolean;
  s4Color: string;
  s4Show: boolean;
  r4Color: string;
  r4Show: boolean;
  s5Color: string;
  s5Show: boolean;
  r5Color: string;
  r5Show: boolean;
}

const DEFAULT_COLOR = '#FB8C00';

export const defaultInputs: PivotPointsStandardInputs = {
  pivotType: 'Traditional',
  pivotAnchor: 'Auto',
  maxHistoricalPivots: 15,
  isDailyBased: true,
  showLabels: true,
  showPrices: true,
  positionLabels: 'Left',
  linewidth: 1,
  pColor: DEFAULT_COLOR,
  pShow: true,
  s1Color: DEFAULT_COLOR,
  s1Show: true,
  r1Color: DEFAULT_COLOR,
  r1Show: true,
  s2Color: DEFAULT_COLOR,
  s2Show: true,
  r2Color: DEFAULT_COLOR,
  r2Show: true,
  s3Color: DEFAULT_COLOR,
  s3Show: true,
  r3Color: DEFAULT_COLOR,
  r3Show: true,
  s4Color: DEFAULT_COLOR,
  s4Show: true,
  r4Color: DEFAULT_COLOR,
  r4Show: true,
  s5Color: DEFAULT_COLOR,
  s5Show: true,
  r5Color: DEFAULT_COLOR,
  r5Show: true,
};

const DAILY_TOOLTIP = 'When this option is unchecked, Pivot Points will use intraday data while calculating on intraday charts. If Extended Hours are displayed on the chart, they will be taken into account during the pivot level calculation. If intraday OHLC values are different from daily-based values (normal for stocks), the pivot levels will also differ.';
const PAD = '‏  ‏  ‏  ‏  ‏  ‏  ‏  ‏';
const LEVEL_2_3 = { input: 'pivotType', ne: 'DM' };
const LEVEL_4 = { all: [{ input: 'pivotType', ne: 'DM' }, { input: 'pivotType', ne: 'Fibonacci' }] };
const LEVEL_5 = { any: [{ input: 'pivotType', eq: 'Traditional' }, { input: 'pivotType', eq: 'Camarilla' }] };

export const inputConfig: InputConfig[] = [
  { id: 'pivotType', type: 'string', title: 'Type', defval: 'Traditional', options: ['Traditional', 'Fibonacci', 'Woodie', 'Classic', 'DM', 'Camarilla'] },
  { id: 'pivotAnchor', type: 'string', title: 'Pivots Timeframe', defval: 'Auto', options: ['Auto', 'Daily', 'Weekly', 'Monthly', 'Quarterly', 'Yearly', 'Biyearly', 'Triyearly', 'Quinquennially', 'Decennially'] },
  { id: 'maxHistoricalPivots', type: 'int', title: 'Number of Pivots Back', defval: 15, min: 1, max: 200, display: 'data_window' },
  { id: 'isDailyBased', type: 'bool', title: 'Use Daily-based Values', defval: true, tooltip: DAILY_TOOLTIP, display: 'data_window' },
  { id: 'showLabels', type: 'bool', title: 'Show Labels', defval: true, group: 'labels', display: 'data_window' },
  { id: 'showPrices', type: 'bool', title: 'Show Prices', defval: true, group: 'labels', display: 'data_window' },
  { id: 'positionLabels', type: 'string', title: 'Labels Position', defval: 'Left', options: ['Left', 'Right'], group: 'labels', display: 'data_window', active: { any: ['showLabels', 'showPrices'] } },
  { id: 'linewidth', type: 'int', title: 'Line Width', defval: 1, min: 1, max: 100, group: 'levels', display: 'data_window' },
  { id: 'pColor', type: 'color', title: 'P‏  ‏  ‏', defval: DEFAULT_COLOR, inline: 'P', group: 'levels', display: 'data_window' },
  { id: 'pShow', type: 'bool', title: '', defval: true, inline: 'P', group: 'levels', display: 'data_window' },
  { id: 's1Color', type: 'color', title: 'S1', defval: DEFAULT_COLOR, inline: 'S1/R1', group: 'levels', display: 'data_window' },
  { id: 's1Show', type: 'bool', title: '', defval: true, inline: 'S1/R1', group: 'levels', display: 'data_window' },
  { id: 'r1Color', type: 'color', title: `${PAD}R1`, defval: DEFAULT_COLOR, inline: 'S1/R1', group: 'levels', display: 'data_window' },
  { id: 'r1Show', type: 'bool', title: '', defval: true, inline: 'S1/R1', group: 'levels', display: 'data_window' },
  { id: 's2Color', type: 'color', title: 'S2', defval: DEFAULT_COLOR, inline: 'S2/R2', group: 'levels', display: 'data_window', active: LEVEL_2_3 },
  { id: 's2Show', type: 'bool', title: '', defval: true, inline: 'S2/R2', group: 'levels', display: 'data_window', active: LEVEL_2_3 },
  { id: 'r2Color', type: 'color', title: `${PAD}R2`, defval: DEFAULT_COLOR, inline: 'S2/R2', group: 'levels', display: 'data_window', active: LEVEL_2_3 },
  { id: 'r2Show', type: 'bool', title: '', defval: true, inline: 'S2/R2', group: 'levels', display: 'data_window', active: LEVEL_2_3 },
  { id: 's3Color', type: 'color', title: 'S3', defval: DEFAULT_COLOR, inline: 'S3/R3', group: 'levels', display: 'data_window', active: LEVEL_2_3 },
  { id: 's3Show', type: 'bool', title: '', defval: true, inline: 'S3/R3', group: 'levels', display: 'data_window', active: LEVEL_2_3 },
  { id: 'r3Color', type: 'color', title: `${PAD}R3`, defval: DEFAULT_COLOR, inline: 'S3/R3', group: 'levels', display: 'data_window', active: LEVEL_2_3 },
  { id: 'r3Show', type: 'bool', title: '', defval: true, inline: 'S3/R3', group: 'levels', display: 'data_window', active: LEVEL_2_3 },
  { id: 's4Color', type: 'color', title: 'S4', defval: DEFAULT_COLOR, inline: 'S4/R4', group: 'levels', display: 'data_window', active: LEVEL_4 },
  { id: 's4Show', type: 'bool', title: '', defval: true, inline: 'S4/R4', group: 'levels', display: 'data_window', active: LEVEL_4 },
  { id: 'r4Color', type: 'color', title: `${PAD}R4`, defval: DEFAULT_COLOR, inline: 'S4/R4', group: 'levels', display: 'data_window', active: LEVEL_4 },
  { id: 'r4Show', type: 'bool', title: '', defval: true, inline: 'S4/R4', group: 'levels', display: 'data_window', active: LEVEL_4 },
  { id: 's5Color', type: 'color', title: 'S5', defval: DEFAULT_COLOR, inline: 'S5/R5', group: 'levels', display: 'data_window', active: LEVEL_5 },
  { id: 's5Show', type: 'bool', title: '', defval: true, inline: 'S5/R5', group: 'levels', display: 'data_window', active: LEVEL_5 },
  { id: 'r5Color', type: 'color', title: `${PAD}R5`, defval: DEFAULT_COLOR, inline: 'S5/R5', group: 'levels', display: 'data_window', active: LEVEL_5 },
  { id: 'r5Show', type: 'bool', title: '', defval: true, inline: 'S5/R5', group: 'levels', display: 'data_window', active: LEVEL_5 },
];

export const plotConfig: PlotConfig[] = [];

export const metadata = {
  title: 'Pivot Points Standard',
  shortTitle: 'Pivots',
  overlay: true,
};

/** indicator(max_lines_count = 500, max_labels_count = 500) */
const MAX_OBJECTS = 500;

const MULTI_YEAR: Partial<Record<PivotAnchor, number>> = { Biyearly: 2, Triyearly: 3, Quinquennially: 5, Decennially: 10 };

/** pivotTimeframe of the original for a chart timeframe ('' = unknown) */
function pivotTimeframeOf(anchor: PivotAnchor, chartTf: string): string {
  let autoAnchor = '12M';
  if (chartTf !== '') {
    const info = timeframe.info(chartTf);
    autoAnchor = info.isintraday ? (info.multiplier <= 15 ? '1D' : '1W') : info.isdaily ? '1M' : '12M';
  }
  return anchor === 'Auto' ? autoAnchor
    : anchor === 'Daily' ? '1D'
    : anchor === 'Weekly' ? '1W'
    : anchor === 'Monthly' ? '1M'
    : anchor === 'Quarterly' ? '3M'
    : '12M';
}

/**
 * The bars of the chart symbol that the port asks the host for, with daily-based values: the pivots timeframe, on the
 * charts where the periods grouped from the chart bars can differ from those of the symbol: intraday charts (daily
 * data of stocks, history before the first bar) and weekly charts (a week across two months or years). Daily and
 * monthly bars fall inside the periods: none there (null).
 */
function hostRequest(cfg: PivotPointsStandardInputs, chartTf: string, chart?: ChartContext): SymbolRequest | null {
  const symbol = tickeridOf(chart);
  if (!cfg.isDailyBased || symbol === '' || chartTf === '') return null;
  const info = timeframe.info(chartTf);
  const tf = pivotTimeframeOf(cfg.pivotAnchor, chartTf);
  if (!(info.isintraday || info.isweekly) || timeframe.in_seconds(tf) <= timeframe.in_seconds(chartTf)) return null;
  return { symbol, timeframe: tf };
}

/**
 * Bars of other timeframes that the port reads from the chart context (`bars` accessor): the chart symbol on the
 * pivots timeframe, with daily-based values on an intraday chart (`chart.timeframe` needed). Without them the port
 * builds the periods from the chart bars.
 */
export function requiredSymbols(inputs: Partial<PivotPointsStandardInputs> = {}, chart?: ChartContext): SymbolRequest[] {
  const req = hostRequest({ ...defaultInputs, ...inputs }, chart?.timeframe ? timeframe.info(chart.timeframe).period : '', chart);
  return req ? [req] : [];
}

interface PivotGraphic {
  pivotLine: Line;
  pivotLabel: Label;
}

export function calculate(
  bars: Bar[],
  inputs: Partial<PivotPointsStandardInputs> = {},
  chart?: ChartContext,
): IndicatorResult & { lines: LineDrawingData[]; labels: LabelData[] } {
  const cfg = { ...defaultInputs, ...inputs };
  const n = bars.length;
  const result = (lines: LineDrawingData[], labels: LabelData[]) => ({
    metadata: { title: metadata.title, shorttitle: metadata.shortTitle, overlay: metadata.overlay },
    plots: {},
    lines,
    labels,
  });
  if (n === 0) return result([], []);

  const tz = timezoneOf(chart);
  const msUnit = bars[0].time >= 1e12;
  const ms = (t: number) => (msUnit ? t : t * 1000);
  const mintick = mintickOf(chart);

  // graphicSettingsArray: the order of ta.pivot_point_levels [P, R1, S1, R2, S2, ..., R5, S5]
  const settings: Array<{ levelName: string; levelColor: string; showLevel: boolean }> = [
    { levelName: ' P', levelColor: cfg.pColor, showLevel: cfg.pShow },
    { levelName: 'R1', levelColor: cfg.r1Color, showLevel: cfg.r1Show },
    { levelName: 'S1', levelColor: cfg.s1Color, showLevel: cfg.s1Show },
    { levelName: 'R2', levelColor: cfg.r2Color, showLevel: cfg.r2Show },
    { levelName: 'S2', levelColor: cfg.s2Color, showLevel: cfg.s2Show },
    { levelName: 'R3', levelColor: cfg.r3Color, showLevel: cfg.r3Show },
    { levelName: 'S3', levelColor: cfg.s3Color, showLevel: cfg.s3Show },
    { levelName: 'R4', levelColor: cfg.r4Color, showLevel: cfg.r4Show },
    { levelName: 'S4', levelColor: cfg.s4Color, showLevel: cfg.s4Show },
    { levelName: 'R5', levelColor: cfg.r5Color, showLevel: cfg.r5Show },
    { levelName: 'S5', levelColor: cfg.s5Color, showLevel: cfg.s5Show },
  ];

  // autoAnchor / pivotTimeframe / pivotYearMultiplier
  const chartTf = chartTimeframe(bars, chart);
  const pivotTimeframe = pivotTimeframeOf(cfg.pivotAnchor, chartTf);
  const pivotYearMultiplier = MULTI_YEAR[cfg.pivotAnchor] ?? 1;
  const yearOk = (t: number) => ptime.year(t, tz) % pivotYearMultiplier === 0;

  const high = bars.map((b) => b.high);
  const low = bars.map((b) => b.low);
  const close = bars.map((b) => b.close);
  const open = bars.map((b) => b.open);

  // [ta.pivot_point_levels(...), pivotTimeframeChangeCounter(...)] on the bars of the pivots timeframe
  const securityLevels = (htf: ReadonlyArray<Bar>) => {
    const change = htf.map((b, k) => k > 0 && yearOk(ms(b.time)));
    const levels = taCore.pivot_point_levels(cfg.pivotType, change, false, htf.map((b) => b.high),
      htf.map((b) => b.low), htf.map((b) => b.close), htf.map((b) => b.open)) as number[][];
    const counter: number[] = [];
    let count = 0;
    change.forEach((c, k) => {
      if (c && k > 0) count++;
      counter.push(count);
    });
    return { levels, counter };
  };

  // request.security(syminfo.tickerid, pivotTimeframe, [ta.pivot_point_levels(type, timeframe.change(timeframe.period)
  // and year % mult == 0), pivotTimeframeChangeCounter(...)], lookahead = barmerge.lookahead_on)
  const pivotSeconds = timeframe.in_seconds(pivotTimeframe);
  const chartSeconds = chartTf === '' ? pivotSeconds : timeframe.in_seconds(chartTf);
  let securityPivots: number[][] | null = null;
  let securityCounter: number[] | null = null;
  // the host's bars of the chart symbol on the pivots timeframe, when it gives them
  const request = hostRequest(cfg, chartTf, chart);
  const hostBars = request ? chart?.bars?.(request.symbol, request.timeframe) : undefined;
  if (hostBars && hostBars.length > 0 && pivotSeconds >= chartSeconds) {
    const other = chart?.symbolInfo?.(request!.symbol) ?? { timezone: chart?.timezone, session: chart?.session };
    const shown = securityOther(bars, hostBars, pivotTimeframe, otherSymbolChart(bars, chart), { lookahead: true, other });
    const { levels, counter } = securityLevels(hostBars);
    securityPivots = levels.map((lv) => shown.map((k) => (k < 0 ? NaN : lv[k])));
    securityCounter = shown.map((k) => (k < 0 ? NaN : counter[k]));
  } else if (pivotSeconds >= chartSeconds) {
    let htf: Bar[];
    let group: number[];
    let latest: number[];
    if (pivotSeconds === chartSeconds) {
      htf = bars;
      group = bars.map((_, i) => i);
      latest = group;
    } else {
      const sec = higherTimeframeBars(bars, pivotTimeframe, chart);
      htf = sec.htf;
      group = sec.group;
      latest = sec.latest;
    }
    const { levels, counter } = securityLevels(htf);
    securityPivots = levels.map((lv) => mapToChart(lv, group, latest, true, false));
    securityCounter = mapToChart(counter, group, latest, true, false);
  } else if (cfg.isDailyBased) {
    throw new Error(`Pivot Points Standard: the pivots timeframe (${pivotTimeframe}) is lower than the chart timeframe `
      + `(${chartTf}); daily-based values need lower timeframe data. Choose a higher pivots timeframe or turn off `
      + `'Use Daily-based Values'.`);
  }

  // localPivots = ta.pivot_point_levels(type, timeframe.change(pivotTimeframe) and year % mult == 0)
  const localChange = cfg.isDailyBased ? [] : periodChanges(bars, pivotTimeframe, chart).map((c, i) => c && yearOk(ms(bars[i].time)));
  const localPivots = cfg.isDailyBased ? [] : taCore.pivot_point_levels(cfg.pivotType, localChange, false, high, low, close, open) as number[][];

  resetDrawings({ line: MAX_OBJECTS, label: MAX_OBJECTS });
  // drawnGraphics: one row of graphics per period
  const drawnGraphics: PivotGraphic[][] = [];
  const periodMs = pivotSeconds * 1000 * pivotYearMultiplier;

  const affixOldPivots = (endTime: number) => {
    if (drawnGraphics.length > 0) {
      for (const graphic of drawnGraphics[drawnGraphics.length - 1]) {
        line.set_x2(graphic.pivotLine, endTime);
        if (cfg.positionLabels === 'Right') label.set_x(graphic.pivotLabel, endTime);
      }
    }
  };

  const drawNewPivots = (startTime: number, pivotPointsArray: number[]) => {
    const newGraphics: PivotGraphic[] = [];
    pivotPointsArray.forEach((coord, index) => {
      const levelSettings = settings[index];
      if (!Number.isNaN(coord) && levelSettings.showLevel) {
        const lineEndTime = startTime + periodMs;
        const pivotLine = line.new(startTime, coord, lineEndTime, coord, 'bar_time', undefined, levelSettings.levelColor,
          undefined, cfg.linewidth);
        const text = (cfg.showLabels ? levelSettings.levelName + ' ' : '')
          + (cfg.showPrices ? '(' + str.tostring(coord, 'mintick', mintick) + ')' : '');
        const pivotLabel = label.new(cfg.positionLabels === 'Left' ? startTime : lineEndTime, coord, text, 'bar_time',
          undefined, '#00000000', cfg.positionLabels === 'Left' ? 'label_right' : 'label_left', levelSettings.levelColor);
        newGraphics.push({ pivotLine, pivotLabel });
      }
    });
    drawnGraphics.push(newGraphics);
    if (drawnGraphics.length > cfg.maxHistoricalPivots) {
      for (const graphic of drawnGraphics.shift()!) {
        line.delete(graphic.pivotLine);
        label.delete(graphic.pivotLabel);
      }
    }
  };

  const levelsAt = (levels: number[][], i: number) => levels.map((lv) => lv[i]);
  // barstate.islastconfirmedhistory: the last bar, or the bar before it when the last bar is still open
  const lastConfirmedHistory = lastBarConfirmedOf(chart) ? n - 1 : n - 2;
  const firstBarTime = ms(bars[0].time);

  for (let i = 0; i < n; i++) {
    setDrawingBar(i, i === n - 1);
    const t = ms(bars[i].time);
    // securityPivotCounter != securityPivotCounter[1] (false when one side is na)
    const securityDraw = cfg.isDailyBased && securityCounter !== null && i > 0
      && !Number.isNaN(securityCounter[i]) && !Number.isNaN(securityCounter[i - 1])
      && securityCounter[i] !== securityCounter[i - 1];
    const localDraw = !cfg.isDailyBased && localChange[i];
    if (securityDraw || localDraw) {
      affixOldPivots(t);
      drawNewPivots(t, levelsAt(cfg.isDailyBased ? securityPivots! : localPivots, i));
    }

    // If possible, draw pivots from the beginning of the chart if none were found
    const columns = drawnGraphics.length > 0 ? drawnGraphics[0].length : 0;
    if (i === lastConfirmedHistory && columns === 0) {
      if (securityCounter !== null && securityCounter[i] > 0) {
        if (cfg.isDailyBased) {
          drawNewPivots(firstBarTime, levelsAt(securityPivots!, i));
        } else {
          throw new Error("Not enough intraday data to calculate Pivot Points. Lower the Pivots Timeframe or turn on the 'Use Daily-based Values' option in the indicator settings.");
        }
      } else {
        throw new Error('Not enough data to calculate Pivot Points. Lower the Pivots Timeframe in the indicator settings.');
      }
    }
  }
  setDrawingBar(null);

  const out = drawingOutputs(bars, msUnit ? 'ms' : 's');
  return result(out.lines ?? [], out.labels ?? []);
}

export const PivotPointsStandard = { calculate, metadata, defaultInputs, inputConfig, plotConfig, requiredSymbols };
