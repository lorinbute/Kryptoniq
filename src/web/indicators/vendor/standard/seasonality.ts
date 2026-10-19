// @ts-nocheck
/**
 * Seasonality
 *
 * Monthly percentage changes of the symbol per year, from monthly bars (request.security on "1M" with lookahead):
 * the change of a month is 100 * (close - previous close) / previous close, recorded from 'Starting year' on (the
 * months of 'Ignored months', written "YYYY-MM", are left out and shown as "SKIP").
 *
 * - Heatmap table on the last bar: one row per year with the change of each month, then the "Avgs" (average),
 *   "StDev" (sample standard deviation) and "Pos%" (share of positive changes) rows of each month. Cell colours: the
 *   positive or negative colour, more intense up to 'Color intensity cutoff (%)' (Pos%: the distance from 50%).
 * - On the first bar of each month, a dashed box on the price pane from the previous close to the expected price
 *   (previous close moved by the historical average change of that month), to the end of the month, with the average
 *   as text.
 * - Data window / status line: the expected price, the historical average and standard deviation of the current
 *   month, and the number of months in the average.
 *
 * Based on the standard Seasonality indicator.
 *
 * Monthly bars: the original reads the whole monthly history of the symbol (daily-based data). The port asks the host
 * for the monthly bars of the chart symbol on every chart timeframe other than one month (`requiredSymbols`: the
 * ticker id of the chart context on "1M"; `bars` accessor of the context) and shows them with `securityOther`
 * (lookahead on): exact on every chart timeframe, also above one month. The table covers every year from 'Starting
 * year', so the history before the first chart bar matters on any chart, not only intraday ones.
 * When the host gives no bars, the months are built from the chart bars (src/anchor-period.ts, exchange calendar of
 * the chart context): exact on daily charts that start before 'Starting year'; the months before the first chart bar
 * are missing, a week across two months is in one month only, the monthly closes of intraday bars of stocks differ
 * from the daily ones, and a chart timeframe above one month throws (lower timeframe data).
 * With 'Starting year' 1970 or earlier the original also shows a first row for the year of time 0 (empty months),
 * made on the first monthly bar where the previous close time is na; the port reads that year with the library, which
 * gives na there, so that row is not shown.
 *
 * Chart values read: the chart timeframe, the ticker id (host bars), the exchange time zone and session (months, end of the month) and the
 * chart foreground colour (text of the boxes and the table; the dark theme colour without a context).
 */

import {
  array, box, color, str, table, math, time as ptime, timeframe, periodClose, resetDrawings, setDrawingBar,
  drawingOutputs, mapToChart, type SessionContext, type IndicatorResult, type InputConfig, type PlotConfig, type Bar,
} from 'oakscriptjs';
import type { BoxData, TableData } from '../types';
import { chartTimeframe, hasCalendar, higherTimeframeBars, periodChanges } from '../anchor-period';
import { foregroundColorOf, tickeridOf, timezoneOf, type ChartContext, type SymbolRequest } from '../chart-context';
import { otherSymbolChart, securityOther } from '../other-symbol';

export interface SeasonalityInputs {
  /** The year where the calculations start (the boxes start one year later) */
  startYear: number;
  posColor: string;
  negColor: string;
  /** Absolute values at or above this percentage have the most intense colour */
  cutoffPercent: number;
  tablePosition: 'Left' | 'Center' | 'Right';
  /** Table width in percent of the pane (0: fit the contents) */
  tableWidth: number;
  /** Table height in percent of the pane (0: fit the contents) */
  tableHeight: number;
  showAvg: boolean;
  showStDev: boolean;
  showPos: boolean;
  /** Months to skip, "YYYY-MM" separated by commas */
  skippedMonths: string;
}

export const defaultInputs: SeasonalityInputs = {
  startYear: 2015,
  posColor: '#089981',
  negColor: '#F23745',
  cutoffPercent: 10,
  tablePosition: 'Center',
  tableWidth: 100,
  tableHeight: 95,
  showAvg: true,
  showStDev: true,
  showPos: true,
  skippedMonths: 'YYYY-MM, YYYY-MM',
};

const TT_SY = 'The year to start seasonality calculations. Box drawings start one year after this value.';
const TT_PC = 'The base color for boxes and table cells that show positive values.';
const TT_NC = 'The base color for boxes and table cells that show negative values.';
const TT_CP = 'The cutoff for maximum color intensity. Absolute values at or above this level have the same color.';
const TT_WT = 'The table width as a percentage of the pane where the table is located. If this value is 0, the width fits the contents of the table, and the table can be wider than the pane.';
const TT_HG = 'The table height as a percentage of the pane where the table is located. If this value is 0, the height fits the contents of the table, and the table can be taller than the pane.';
const TT_SA = "Toggles the 'Avgs' row, which shows average change percentages for each month.";
const TT_SD = "Toggles the 'StDev' row, which shows the standard deviation of each month's percentages.";
const TT_SP = "Toggles the 'Pos%' row, which shows the percentage of positive changes in each month's column.";
const TT_SM = "Specifies months to skip. Write months in the 'YYYY-MM' format, separated by commas and spaces.";
const COLOR_GRP = 'Color settings';
const HEATMAP_GRP = 'Heatmap settings';
const ADD_GRP = 'Additional settings';

export const inputConfig: InputConfig[] = [
  { id: 'startYear', type: 'int', title: 'Starting year', defval: 2015, min: 1800, tooltip: TT_SY, display: 'data_window' },
  { id: 'posColor', type: 'color', title: 'Positive Color', defval: '#089981', group: COLOR_GRP, tooltip: TT_PC },
  { id: 'negColor', type: 'color', title: 'Negative Color', defval: '#F23745', group: COLOR_GRP, tooltip: TT_NC },
  { id: 'cutoffPercent', type: 'int', title: 'Color intensity cutoff (%)', defval: 10, group: COLOR_GRP, tooltip: TT_CP, display: 'none' },
  { id: 'tablePosition', type: 'string', title: 'Table Position', defval: 'Center', options: ['Left', 'Center', 'Right'], group: HEATMAP_GRP, display: 'none' },
  { id: 'tableWidth', type: 'float', title: 'Table Width (%)', defval: 100, min: 0, max: 100, group: HEATMAP_GRP, tooltip: TT_WT, display: 'none' },
  { id: 'tableHeight', type: 'float', title: 'Table Height (%)', defval: 95, min: 0, max: 100, group: HEATMAP_GRP, tooltip: TT_HG, display: 'none' },
  { id: 'showAvg', type: 'bool', title: 'Show Averages', defval: true, group: HEATMAP_GRP, tooltip: TT_SA, display: 'none' },
  { id: 'showStDev', type: 'bool', title: 'Show Standard Deviation', defval: true, group: HEATMAP_GRP, tooltip: TT_SD, display: 'none' },
  { id: 'showPos', type: 'bool', title: 'Show Percent Positive', defval: true, group: HEATMAP_GRP, tooltip: TT_SP, display: 'none' },
  // input.text_area: a multi-line text input
  { id: 'skippedMonths', type: 'string', title: 'Ignored months', defval: 'YYYY-MM, YYYY-MM', group: ADD_GRP, tooltip: TT_SM, display: 'none' },
];

const GRAY = '#787B86';
const PLOT_BLUE = '#2962FF';

// display = display.data_window + display.status_line (the three first plots), display.data_window (the last one)
export const plotConfig: PlotConfig[] = [
  { id: 'plot0', title: 'Expected price for current month', color: GRAY, lineWidth: 1, display: 'status_line' },
  { id: 'plot1', title: 'Historical average for current month', color: GRAY, lineWidth: 1, display: 'status_line' },
  { id: 'plot2', title: 'Historical standard deviation for current month', color: GRAY, lineWidth: 1, display: 'status_line' },
  { id: 'plot3', title: 'No. of months used in the current average', color: PLOT_BLUE, lineWidth: 1, display: 'data_window' },
];

export const metadata = {
  title: 'Seasonality',
  shortTitle: 'Seasonality',
  overlay: false,
};

/** indicator(max_boxes_count = 500) */
const MAX_BOXES = 500;
const MONTH_NAMES = ['Year', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The monthly bars of the chart symbol that the port asks the host for: on every chart timeframe other than one
 * month (null: none, or no ticker in the context)
 */
function hostRequest(chartTf: string, chart?: ChartContext): SymbolRequest | null {
  const symbol = tickeridOf(chart);
  if (symbol === '' || chartTf === '' || timeframe.in_seconds(chartTf) === timeframe.in_seconds('1M')) return null;
  return { symbol, timeframe: '1M' };
}

/**
 * Bars of another timeframe that the port reads from the chart context (`bars` accessor): the monthly bars of the
 * chart symbol (`chart.timeframe` needed). Without them the port builds the months from the chart bars.
 */
export function requiredSymbols(_inputs: Partial<SeasonalityInputs> = {}, chart?: ChartContext): SymbolRequest[] {
  const req = hostRequest(chart?.timeframe ? timeframe.info(chart.timeframe).period : '', chart);
  return req ? [req] : [];
}

/** Pine `x >= 0` for floats: x - 0 within 1e-10 counts as equal; na compares false */
const ge0 = (x: number) => x >= -1e-10;

export function calculate(
  bars: Bar[],
  inputs: Partial<SeasonalityInputs> = {},
  chart?: ChartContext,
): IndicatorResult & { boxes: BoxData[]; tables: TableData[] } {
  const cfg = { ...defaultInputs, ...inputs };
  const n = bars.length;
  const meta = { title: metadata.title, shorttitle: metadata.shortTitle, overlay: metadata.overlay };
  if (n === 0) return { metadata: meta, plots: {}, boxes: [], tables: [] };

  const tz = timezoneOf(chart);
  const msUnit = bars[0].time >= 1e12;
  const ms = (t: number) => (msUnit ? t : t * 1000);
  const chartTf = chartTimeframe(bars, chart);

  // time_close / time_close("1M") of a bar: the session calendar of the context, else the UTC calendar. On the chart
  // the context has the chart timeframe; in the security context (monthly bars) the timeframe "1M": on an intraday
  // chart time_close("1M") is the open of the next month, the close of a monthly bar the session end of its last day
  const sessionOf = (tf: string): SessionContext | null => {
    if (!chart || !hasCalendar(chart) || tf === '') return null;
    const s: SessionContext = { timeframe: tf, timezone: chart.timezone, session: chart.session, regularSession: chart.regularSession, timeUnit: msUnit ? 'ms' : 's' };
    try {
      periodClose(bars[0].time, '1M', s);
      return s;
    } catch {
      return null;
    }
  };
  const session = sessionOf(chartTf);
  const monthlySession = sessionOf('1M');
  const nextMonthUtc = (t: number) => {
    const d = new Date(t);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  };
  const monthClose = (barTime: number) => (session ? periodClose(barTime, '1M', session) : nextMonthUtc(ms(barTime)));
  const monthlyBarClose = (barTime: number) => (monthlySession ? periodClose(barTime, '1M', monthlySession) : nextMonthUtc(ms(barTime)));
  const barCloseMinus1 = (barTime: number) => {
    if (session) {
      const c = periodClose(barTime, chartTf, session);
      if (!Number.isNaN(c)) return c - 1;
    }
    return ms(barTime);
  };

  // colours
  const posColorInput = color.new(cfg.posColor, 0);
  const negColorInput = color.new(cfg.negColor, 0);
  const calcColor = (value: number, topTranspValue = NaN): string => {
    const heavyColor = color.new(ge0(value) ? posColorInput : negColorInput, 50);
    const lightColor = color.new(ge0(value) ? posColorInput : negColorInput, 90);
    const baseColor = Number.isNaN(value) ? GRAY : ge0(value) ? posColorInput : negColorInput;
    if (Number.isNaN(topTranspValue)) return baseColor;
    return color.from_gradient(Math.abs(value), 0, topTranspValue, lightColor, heavyColor);
  };
  const css = (c: string) => (/^rgba\(\s*0,\s*0,\s*0,\s*0\s*\)$/.test(c) ? 'transparent' : c);

  // ignoredMonthsArray: "YYYY-MM" items as YYYYMM numbers
  const ignoredMonthsArray: number[] = [];
  for (const item of str.split(str.replace_all(cfg.skippedMonths, ' ', ''), ',')) {
    const num = str.tonumber(str.replace_all(item, '-', ''));
    ignoredMonthsArray.push(num === null || num === undefined ? NaN : math.round(num));
  }

  // request.security(syminfo.tickerid, "1M", calculateMontlyChanges(...), lookahead = barmerge.lookahead_on)
  const monthSeconds = timeframe.in_seconds('1M');
  const chartSeconds = chartTf === '' ? monthSeconds : timeframe.in_seconds(chartTf);
  // the host's monthly bars of the chart symbol, when it gives them
  const request = hostRequest(chartTf, chart);
  const hostBars = request ? chart?.bars?.(request.symbol, request.timeframe) : undefined;
  const fromHost = !!hostBars && hostBars.length > 0;
  if (chartSeconds > monthSeconds && !fromHost) {
    throw new Error(`Seasonality: the chart timeframe (${chartTf}) is higher than one month; the monthly changes need lower timeframe data.`);
  }
  let htf: ReadonlyArray<Bar>;
  let first: number[] = [];
  let group: number[] = [];
  let latest: number[] = [];
  let shown: number[] = [];
  if (fromHost) {
    htf = hostBars!;
    const other = chart?.symbolInfo?.(request!.symbol) ?? { timezone: chart?.timezone, session: chart?.session };
    shown = securityOther(bars, htf, '1M', otherSymbolChart(bars, chart), { lookahead: true, other });
  } else if (chartSeconds === monthSeconds) {
    htf = bars;
    group = bars.map((_, i) => i);
    first = group;
    latest = group;
  } else {
    const sec = higherTimeframeBars(bars, '1M', chart);
    htf = sec.htf;
    first = sec.first;
    group = sec.group;
    latest = sec.latest;
  }
  // State of [yearIndexArray, dataMatrix] after each monthly bar
  const yearsAt: number[][] = [];
  const matrixAt: number[][][] = [];
  {
    const dataMatrix: number[][] = [];
    const yearIndexArray: number[] = [];
    let prevYearHist = NaN;
    htf.forEach((_b, k) => {
      // prevTimeClose = time_close[1] - 1 of the monthly bars
      const prevTimeClose = k > 0 ? monthlyBarClose(fromHost ? htf[k - 1].time : bars[first[k - 1]].time) - 1 : NaN;
      const prevBarYear = ptime.year(prevTimeClose, tz);
      const prevBarMonth = ptime.month(prevTimeClose, tz);
      // changePercent(close[1]) = 100 * (close[1] - close[2]) / close[2]
      const c1 = k >= 1 ? htf[k - 1].close : NaN;
      const c2 = k >= 2 ? htf[k - 2].close : NaN;
      const prevChangePercent = (100.0 * (c1 - c2)) / c2;
      if (prevBarYear >= cfg.startYear && !array.includes(ignoredMonthsArray, prevBarYear * 100 + prevBarMonth)) {
        // prevBarYear != prevBarYear[1]: false when one side is na
        if ((!Number.isNaN(prevYearHist) && prevBarYear !== prevYearHist) || dataMatrix.length === 0) {
          dataMatrix.push(new Array(13).fill(NaN));
          yearIndexArray.push(prevBarYear);
        }
        dataMatrix[dataMatrix.length - 1][prevBarMonth] = prevChangePercent;
      }
      prevYearHist = prevBarYear;
      yearsAt.push(yearIndexArray.slice());
      matrixAt.push(dataMatrix.map((r) => r.slice()));
    });
  }
  const htfIndex = fromHost ? shown.map((k) => (k < 0 ? NaN : k)) : mapToChart(htf.map((_, k) => k), group, latest, true, false);
  const colOf = (m: number[][], c: number) => m.map((r) => r[c]);
  const nonNA = (a: number[]) => a.filter((x) => !Number.isNaN(x)).length;

  resetDrawings({ box: MAX_BOXES });
  const textColor = foregroundColorOf(chart);
  const boxTextColor = color.new(textColor, 60);
  const monthChange = periodChanges(bars, '1M', chart);

  const plot0: Array<{ time: number; value: number; color: string }> = [];
  const plot1: Array<{ time: number; value: number; color: string }> = [];
  const plot2: Array<{ time: number; value: number; color: string }> = [];
  const plot3: Array<{ time: number; value: number }> = [];
  let currMonthAverage = NaN;
  let currMonthStDev = NaN;
  let currAvgNumberOfMonths = NaN;
  let currMonthExpectedPrice = NaN;

  for (let i = 0; i < n; i++) {
    setDrawingBar(i, i === n - 1);
    const b = bars[i];
    const k = htfIndex[i];
    const changesMatrix = Number.isNaN(k) ? null : matrixAt[k];
    if (monthChange[i] && changesMatrix) {
      const currMonth = ptime.month(barCloseMinus1(b.time), tz);
      const column = colOf(changesMatrix, currMonth);
      const prevClose = i > 0 ? bars[i - 1].close : NaN;
      currMonthAverage = array.avg(column);
      currMonthStDev = array.stdev(column, false);
      currAvgNumberOfMonths = nonNA(column);
      currMonthExpectedPrice = prevClose + (prevClose * currMonthAverage) / 100;
      box.new(ms(b.time), currMonthExpectedPrice, monthClose(b.time), prevClose, calcColor(currMonthAverage), undefined,
        'dashed', undefined, 'bar_time', calcColor(currMonthAverage, cfg.cutoffPercent),
        str.tostring(currMonthAverage, 'percent'), undefined, boxTextColor, undefined, undefined, undefined, undefined, true);
    }
    const lineColor = calcColor(currMonthAverage);
    plot0.push({ time: b.time, value: currMonthExpectedPrice, color: lineColor });
    plot1.push({ time: b.time, value: currMonthAverage, color: lineColor });
    plot2.push({ time: b.time, value: currMonthStDev, color: GRAY });
    plot3.push({ time: b.time, value: currAvgNumberOfMonths });
  }

  // Heatmap on the last bar
  const kLast = htfIndex[n - 1];
  if (!Number.isNaN(kLast)) {
    const changesMatrix = matrixAt[kLast];
    const yearIndexArray = yearsAt[kLast];
    const rows = changesMatrix.length;
    const showMetrics = cfg.showAvg || cfg.showStDev || cfg.showPos;
    const position = cfg.tablePosition === 'Left' ? 'bottom_left' : cfg.tablePosition === 'Center' ? 'bottom_center' : 'bottom_right';
    const dataTable = table.new(position, 13, rows + 5);
    const informerCellBgcolor = color.new(GRAY, 80);
    let totalRowCount = 1 + rows;
    if (showMetrics) totalRowCount += 1 + (cfg.showAvg ? 1 : 0) + (cfg.showStDev ? 1 : 0) + (cfg.showPos ? 1 : 0);
    const cellHeight = cfg.tableHeight / totalRowCount;
    const cellWidth = cfg.tableWidth / 13.0;
    const cell = (c: number, r: number, text: string, bg: string, tc: string | undefined = textColor, size?: string) =>
      table.cell(dataTable, c, r, text, cellWidth, cellHeight, tc, undefined, undefined, size, bg);

    MONTH_NAMES.forEach((item, index) => cell(index, 0, item, informerCellBgcolor));
    changesMatrix.forEach((arr, arrIndex) => {
      const thisYear = yearIndexArray[arrIndex];
      arr.forEach((item, itemIndex) => {
        if (itemIndex === 0) {
          cell(itemIndex, arrIndex + 1, str.tostring(thisYear), informerCellBgcolor);
        } else {
          const isSkipped = array.includes(ignoredMonthsArray, Math.trunc(thisYear * 100 + itemIndex));
          const cellText = isSkipped ? 'SKIP' : str.tostring(item, 'percent');
          const cellColor = isSkipped ? color.new(GRAY, 50) : css(calcColor(item, cfg.cutoffPercent));
          cell(itemIndex, arrIndex + 1, cellText, cellColor);
        }
      });
    });
    if (showMetrics) {
      const dividerRow = rows + 1;
      cell(0, dividerRow, '', informerCellBgcolor, 'transparent', 'tiny');
      table.merge_cells(dataTable, 0, dividerRow, 12, dividerRow);
      if (cfg.showAvg) {
        const avgsRow = rows + 2;
        cell(0, avgsRow, 'Avgs:', informerCellBgcolor);
        for (let c = 1; c <= 12; c++) {
          const avgValue = array.avg(colOf(changesMatrix, c));
          cell(c, avgsRow, str.tostring(avgValue, 'percent'), css(calcColor(avgValue, cfg.cutoffPercent)));
        }
      }
      if (cfg.showStDev) {
        const stDevRow = rows + 3;
        cell(0, stDevRow, 'StDev:', informerCellBgcolor);
        for (let c = 1; c <= 12; c++) {
          const stdevValue = array.stdev(colOf(changesMatrix, c), false);
          cell(c, stDevRow, str.tostring(stdevValue, '##.##'), color.new(GRAY, 80));
        }
      }
      if (cfg.showPos) {
        const ratioRow = rows + 4;
        cell(0, ratioRow, 'Pos%:', informerCellBgcolor);
        for (let c = 1; c <= 12; c++) {
          const column = colOf(changesMatrix, c);
          const nn = nonNA(column);
          const pos = column.filter((x) => !Number.isNaN(x) && ge0(x)).length;
          const ratioValue = (100.0 * pos) / nn;
          cell(c, ratioRow, str.tostring(ratioValue, '#') + '%', css(calcColor(ratioValue - 50, 50)));
        }
      }
    }
  }
  setDrawingBar(null);

  const out = drawingOutputs(bars, msUnit ? 'ms' : 's');
  const finite = (v: number) => (Number.isFinite(v) ? v : NaN);
  return {
    metadata: meta,
    plots: {
      plot0: plot0.map((p) => ({ ...p, value: finite(p.value) })),
      plot1: plot1.map((p) => ({ ...p, value: finite(p.value) })),
      plot2: plot2.map((p) => ({ ...p, value: finite(p.value) })),
      plot3,
    },
    boxes: out.boxes ?? [],
    tables: out.tables ?? [],
  };
}

export const Seasonality = { calculate, metadata, defaultInputs, inputConfig, plotConfig, requiredSymbols };
