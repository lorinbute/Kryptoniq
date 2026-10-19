// @ts-nocheck
/**
 * Performance
 *
 * A table of price changes over several periods for a list of symbols. Each symbol is read on daily bars
 * (request.security with lookahead on): on the daily bar shown on the last chart bar, the change of each period is
 *
 *   change % = (close - close of the reference bar) / close of the reference bar * 100
 *
 * The reference bar is the latest daily bar that opens at or before a time behind the last daily bar of that symbol
 * (its last bar time, as given): "nD" / "nW" go back n days / weeks, "nM" n calendar months, "nY" n years, "YTD" to
 * January 1 at 00:00, each in the exchange time zone of the symbol (the ValueAtTime library). A time before the first
 * bar takes the first bar. The first row shows the periods, the first column the description of each symbol. A cell
 * is green for a change of 0 or more, red below, and its background goes from 90 % to 70 % transparency up to the
 * colour cutoff; a change that cannot be computed shows "No data". The tooltip of a cell is the date of its
 * reference bar in the exchange time zone of the chart.
 *
 * The chart symbol is added as the first row when "Include chart symbol" is on and its ticker is not in the list; on
 * a daily chart its row uses the chart bars.
 *
 * Based on the standard Performance indicator.
 *
 * Needs the chart context (third argument of calculate): the daily bars of each symbol of the list (and of the chart
 * symbol on a chart that is not daily) come from its `bars` accessor (`requiredSymbols` lists them), the time zone and
 * session of each symbol from `symbolInfo`, the chart time zone, ticker and foreground colour from the context.
 * Without the bars `calculate` throws a MissingSymbolDataError. The symbol list is passed to the accessor as written
 * (in upper case, e.g. "AAPL", "EURUSD"): the caller resolves a symbol without an exchange prefix as its symbol
 * search does. The description of a symbol comes from `symbolInfo(symbol).description` when the caller gives it;
 * without it the cell shows the symbol as written.
 */

import { str, time as pineTime, timeframe as pineTimeframe, color, array as pineArray, type Bar, type IndicatorResult, type InputConfig, type PlotConfig } from 'oakscriptjs';
import type { TableCellData, TableData, TablePosition } from '../types';
import {
  symbolBarsOf, timezoneOf, tickeridOf, tickerOf, foregroundColorOf, type ChartContext, type SymbolInfo, type SymbolRequest,
} from '../chart-context';
import { chartTimeframe } from '../anchor-period';
import { otherSymbolChart, securityOther } from '../other-symbol';

export interface PerformanceInputs {
  /** Include chart symbol: add the chart symbol as the first row when its ticker is not in the list */
  includeCurrentSymbol: boolean;
  /** Symbol list: symbols or ticker ids separated by commas */
  symbolList: string;
  /** Timeframe list: periods separated by commas ("1W", "3M", "12M", "YTD", "5Y", ...) */
  tfList: string;
  /** Positive Color: cells with a change of 0 or more */
  posColor: string;
  /** Negative Color: cells with a negative change */
  negColor: string;
  /** Color intensity cutoff (%): changes of this size or more have the strongest background */
  cutoffPercent: number;
  /** Table position, horizontal */
  tableXPosition: 'left' | 'center' | 'right';
  /** Table position, vertical */
  tableYPosition: 'top' | 'middle' | 'bottom';
  /** Table width (%): 0 fits the contents */
  tableWidth: number;
  /** Table height (%): 0 fits the contents */
  tableHeight: number;
}

export const defaultInputs: PerformanceInputs = {
  includeCurrentSymbol: true,
  symbolList: 'AAPL, NASDAQ:AMZN, EURUSD, ES1!, BTCUSD',
  tfList: '1W, 1M, 3M, 6M, 12M, YTD, 5Y',
  posColor: '#089981',
  negColor: '#F23745',
  cutoffPercent: 10,
  tableXPosition: 'center',
  tableYPosition: 'middle',
  tableWidth: 100,
  tableHeight: 95,
};

const TT_SL = 'A list of symbols or ticker IDs, separated by commas and optional spaces.';
const TT_LT = "A list of timeframe strings, separated by commas and optional spaces. A valid timeframe string contains a number followed by 'D', 'W', 'M', or 'Y'. Additionally, 'YTD' is supported.";
const TT_PC = 'The base color for table cells that show positive values.';
const TT_NC = 'The base color for table cells that show negative values.';
const TT_CP = 'The change percentage cutoff for maximum color intensity. Absolute percentages at or above this level correspond to the same color intensity.';
const TT_WT = "The table width, expressed as a percentage. If the value is 0, the width automatically adapts to the table's contents. Note that using a large list of timeframe strings can cause the table's width to exceed the width of the chart pane.";
const TT_HG = "The table height, expressed as a percentage. If the value is 0, the height automatically adapts to the table's contents. Note that using a large list of symbols or ticker IDs can cause the table's height to exceed the height of the chart pane.";
const COLOR_GRP = 'Color settings';
const TABLE_GRP = 'Table settings';

// The two lists are multi-line text boxes in the original (input.text_area): InputConfig has no such type
export const inputConfig: InputConfig[] = [
  { id: 'includeCurrentSymbol', type: 'bool', title: 'Include chart symbol', defval: true, display: 'none' },
  { id: 'symbolList', type: 'string', title: 'Symbol list', defval: defaultInputs.symbolList, tooltip: TT_SL, display: 'none' },
  { id: 'tfList', type: 'string', title: 'Timeframe list', defval: defaultInputs.tfList, tooltip: TT_LT, display: 'none' },
  { id: 'posColor', type: 'color', title: 'Positive Color', defval: '#089981', tooltip: TT_PC, group: COLOR_GRP, display: 'none' },
  { id: 'negColor', type: 'color', title: 'Negative Color', defval: '#F23745', tooltip: TT_NC, group: COLOR_GRP, display: 'none' },
  { id: 'cutoffPercent', type: 'int', title: 'Color intensity cutoff (%)', defval: 10, tooltip: TT_CP, group: COLOR_GRP, display: 'none' },
  {
    id: 'tableXPosition', type: 'string', title: 'Table position', defval: 'center', options: ['left', 'center', 'right'],
    inline: '31', group: TABLE_GRP, display: 'none',
  },
  {
    id: 'tableYPosition', type: 'string', title: '', defval: 'middle', options: ['top', 'middle', 'bottom'],
    inline: '31', group: TABLE_GRP, display: 'none',
  },
  { id: 'tableWidth', type: 'float', title: 'Table width (%)', defval: 100, min: 0, max: 100, step: 1, tooltip: TT_WT, group: TABLE_GRP, display: 'none' },
  { id: 'tableHeight', type: 'float', title: 'Table height (%)', defval: 95, min: 0, max: 100, step: 1, tooltip: TT_HG, group: TABLE_GRP, display: 'none' },
];

export const plotConfig: PlotConfig[] = [];

export const metadata = {
  title: 'Performance',
  shortTitle: 'Performance',
  overlay: false,
};

const HEAVY_TRANSP = 70;
const LOW_TRANSP = 90;
/** color.new(color.gray, 80) */
const NEUTRAL = color.new_color('#787B86', 80);
const DAILY = '1D';

/**
 * ValueAtTime getArrayFromString: split on commas, trim each item and remove the empty ones. The original removes
 * them inside its `for ... in` loop, which then skips the item after a removed one (that item is neither trimmed nor
 * removed).
 */
function arrayFromString(text: string): string[] {
  const result = text.split(',');
  for (let i = 0; i < result.length; i++) {
    const trimmed = result[i].trim();
    if (trimmed === '') {
      result.splice(i, 1);
      continue;
    }
    result[i] = trimmed;
  }
  return result;
}

/** Symbols of the table: the list (upper case), with the chart ticker id first when it is added */
function symbolsOf(cfg: PerformanceInputs, chart?: ChartContext): { symbols: string[]; chartRow: boolean } {
  const symbols = arrayFromString(cfg.symbolList.toUpperCase());
  const chartRow = cfg.includeCurrentSymbol && !symbols.includes(tickerOf(chart));
  if (chartRow) symbols.unshift(tickeridOf(chart));
  return { symbols, chartRow };
}

/** The chart symbol's row uses the chart bars on a daily chart, else its daily bars from the context */
function isDaily(tf: string): boolean {
  return tf !== '' && pineTimeframe.in_seconds(tf) === 86400;
}

/** Daily bars the table needs: every symbol of the list, and the chart symbol on a chart that is not daily */
export function requiredSymbols(inputs: Partial<PerformanceInputs> = {}, chart?: ChartContext): SymbolRequest[] {
  const cfg = { ...defaultInputs, ...inputs };
  const { symbols, chartRow } = symbolsOf(cfg, chart);
  const daily = isDaily(chart?.timeframe ? chartTimeframe([], chart) : '');
  const list = symbols.filter((_, k) => !(chartRow && k === 0 && daily));
  return [...new Set(list)].map((symbol) => ({ symbol, timeframe: DAILY }));
}

/** ValueAtTime getTFMult: the multiplier of a period string ("12M" -> 12), 1 without one */
function tfMult(period: string): number {
  const n = str.tonumber(period.substring(0, period.length - 1)) as number | null;
  const v = n === null || n === undefined || Number.isNaN(n) ? NaN : Math.trunc(n);
  return Number.isNaN(v) ? 1 : v;
}

/** ValueAtTime periodToTimestamp: the time `period` behind `referenceTime` (ms) in the time zone `tz` */
function periodToTimestamp(period: string, referenceTime: number, tz: string): number {
  const refYear = pineTime.year(referenceTime, tz);
  const refMonth = pineTime.month(referenceTime, tz);
  const refDay = pineTime.dayofmonth(referenceTime, tz);
  const refHour = pineTime.hour(referenceTime, tz);
  const refMin = pineTime.minute(referenceTime, tz);
  if (period === 'YTD') return pineTime.timestamp(tz, refYear, 1, 1, 0, 0);
  if (period.endsWith('Y')) return pineTime.timestamp(tz, refYear - tfMult(period), refMonth, refDay, refHour, refMin);
  if (period.endsWith('M')) {
    const totalMonths = refYear * 12 + refMonth - tfMult(period);
    let pastYear = Math.trunc(totalMonths / 12);
    let pastMonth = totalMonths % 12;
    if (pastMonth === 0) {
      pastYear -= 1;
      pastMonth = 12;
    }
    return pineTime.timestamp(tz, pastYear, pastMonth, refDay, refHour, refMin);
  }
  if (period.endsWith('W') || (period.endsWith('D') && !period.includes('YTD'))) {
    return referenceTime - pineTimeframe.in_seconds(period) * 1000;
  }
  throw new Error(
    `Invalid period: '${period}'. The period must use one of the following units: 'Y', 'M', 'W', 'D', 'YTD'. `
    + "All options except for 'YTD' can include a multiplier prefix (e.g., '3D').",
  );
}

/** What request.security(symbol, "1D", getDataAtPeriodOffsets(periods, close, last_bar_time)) gives on the last bar */
interface SymbolData {
  values: number[];
  times: number[];
  close: number;
}

/**
 * getDataAtPeriodOffsets on the daily bar `j` of a symbol: the closes and open times (ms) collected up to that bar,
 * searched for the time of each period behind the symbol's last bar time
 */
function dataAtPeriodOffsets(daily: ReadonlyArray<Bar>, j: number, periods: string[], tz: string, toMs: number): SymbolData {
  const times = new Array<number>(j + 1);
  const closes = new Array<number>(j + 1);
  for (let k = 0; k <= j; k++) {
    times[k] = daily[k].time * toMs;
    closes[k] = daily[k].close;
  }
  const lastBarTime = daily[daily.length - 1].time * toMs;
  const values: number[] = [];
  const found: number[] = [];
  for (const period of periods) {
    const index = pineArray.binary_search_leftmost(times, periodToTimestamp(period, lastBarTime, tz));
    values.push(pineArray.get(closes, index));
    found.push(pineArray.get(times, index));
  }
  return { values, times: found, close: closes[j] };
}

type SymbolInfoWithDescription = SymbolInfo & { description?: string };

/** syminfo.description of a symbol: from the context when it gives it, else the symbol as written */
function descriptionOf(symbol: string, chart?: ChartContext): string {
  const info = chart?.symbolInfo?.(symbol) as SymbolInfoWithDescription | undefined;
  return info?.description ?? symbol;
}

export function calculate(
  bars: Bar[],
  inputs: Partial<PerformanceInputs> = {},
  chart?: ChartContext,
): IndicatorResult & { tables: TableData[] } {
  const cfg = { ...defaultInputs, ...inputs };
  const n = bars.length;
  const timeframes = arrayFromString(cfg.tfList.toUpperCase());
  const { symbols, chartRow } = symbolsOf(cfg, chart);
  const daily = isDaily(chartTimeframe(bars, chart));
  const useChartBars = (k: number) => chartRow && k === 0 && daily;

  // daily bars of the symbols, all at once (one MissingSymbolDataError for everything missing)
  const requests = [...new Set(symbols.filter((_, k) => !useChartBars(k)))].map((symbol) => ({ symbol, timeframe: DAILY }));
  const loaded = symbolBarsOf(requests, chart);
  const barsOf = new Map(requests.map((r, k) => [r.symbol, loaded[k]]));

  const posColor = color.new_color(cfg.posColor, 0);
  const negColor = color.new_color(cfg.negColor, 0);
  const fg = foregroundColorOf(chart);
  const chartTz = timezoneOf(chart);
  const toMs = chart?.timeUnit === 'ms' || (chart?.timeUnit === undefined && n > 0 && bars[0].time >= 1e12) ? 1 : 1000;
  const position = `${cfg.tableYPosition}_${cfg.tableXPosition}` as TablePosition;
  const table: TableData = { position, columns: timeframes.length + 1, rows: symbols.length + 1, borderWidth: 3, cells: [] };

  if (n > 0) {
    const width = cfg.tableWidth / (timeframes.length + 1);
    const height = cfg.tableHeight / (symbols.length + 1);
    const cell = (column: number, row: number, text: string, extra: Partial<TableCellData>) => {
      table.cells.push({ column, row, text, width, height, textSize: 'auto', ...extra });
    };
    timeframes.forEach((tf, i) => cell(i + 1, 0, tf, { bgColor: NEUTRAL, textColor: fg }));

    const mergeChart = otherSymbolChart(bars, chart);
    symbols.forEach((symbol, i) => {
      const own = useChartBars(i);
      const symbolBars = own ? bars : barsOf.get(symbol)!;
      if (symbolBars.length === 0) throw new Error(`Invalid symbol: ${symbol}`);
      // calendar of the symbol (the chart's for the chart symbol when the context has no entry for it)
      const isChartSymbol = chartRow && i === 0;
      const info = chart?.symbolInfo?.(symbol) ?? (isChartSymbol ? { timezone: chart?.timezone, session: chart?.session } : undefined);
      // daily bar shown on the last chart bar (lookahead on); -1: the symbol has no bar yet
      const j = own ? n - 1 : securityOther(bars, symbolBars, DAILY, mergeChart, { lookahead: true, other: info })[n - 1];
      if (j < 0) {
        cell(0, i + 1, '', { bgColor: NEUTRAL, textColor: fg });
        return;
      }
      const tz = isChartSymbol ? chartTz : info?.timezone ?? 'Etc/UTC';
      const data = dataAtPeriodOffsets(symbolBars, j, timeframes, tz, toMs);
      const description = descriptionOf(symbol, chart);
      cell(0, i + 1, description, { tooltip: description, bgColor: NEUTRAL, textColor: fg });

      data.values.forEach((value, k) => {
        const change = (data.close - value) / value * 100;
        // Pine >= : equal within 1e-10
        let base = !(0 - change > 1e-10) && !Number.isNaN(change) ? posColor : negColor;
        let bg = color.from_gradient(Math.abs(change), 0, cfg.cutoffPercent, color.new_color(base, LOW_TRANSP), color.new_color(base, HEAVY_TRANSP));
        let text = str.tostring(change, 'percent');
        let tooltip: string | undefined = str.format_time(data.times[k], 'dd MMM yyyy', chartTz);
        if (!Number.isFinite(change)) {
          base = fg;
          bg = color.new_color(NEUTRAL, LOW_TRANSP);
          text = 'No data';
          tooltip = undefined;
        }
        cell(k + 1, i + 1, text, { ...(tooltip === undefined ? {} : { tooltip }), bgColor: bg, textColor: base });
      });
    });
  }

  return {
    metadata: { title: metadata.title, shorttitle: metadata.shortTitle, overlay: metadata.overlay },
    plots: {},
    tables: [table],
  };
}

export const Performance = { calculate, metadata, defaultInputs, inputConfig, plotConfig, requiredSymbols };
