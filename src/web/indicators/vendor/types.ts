// @ts-nocheck
/**
 * Output types of the indicators: the oakscriptjs IndicatorResult shapes, shared by the built-in indicators and
 * scripts run with executeScript.
 *
 * A point on a bar after the last bar (Pine bar_index + k) has the time of that future bar: barTime(bars, index).
 * A property that is not set is omitted (the renderer applies the Pine default); a colour set to na is 'transparent'.
 */
/**
 * A PineScript `alert()` call of an indicator: the time of the bar it ran on (as given in the input bars), its message
 * and how often it may trigger the alert (`alert.freq_all`, `alert.freq_once_per_bar` (default),
 * `alert.freq_once_per_bar_close`). The host fires the calls made on the realtime bar.
 */
export interface AlertCall {
  time: number;
  message: string;
  freq: 'all' | 'once_per_bar' | 'once_per_bar_close';
}

/**
 * One output of a study as PineScript numbers them for alert messages (`{{plot_<n>}}`): its line plots, shapes,
 * characters and arrows in the order the script declares them (colour outputs are not numbered). `id`: the plot id
 * (`plotConfig`) of a line plot, else the key of the output's values in the result's `outputValues`.
 */
export interface OutputDecl {
  kind: 'plot' | 'shape' | 'char' | 'arrow';
  id: string;
  title?: string;
}

/** The values of shape / character / arrow outputs by id: on each bar where the output's series is not na, at the bar
 *  it was computed on (its offset not applied); a condition gives 1 or 0. */
export type OutputValues = Record<string, { time: number; value: number }[]>;

export type {
  PineSize,
  MarkerData,
  MarkerPosition,
  MarkerShape,
  BarColorData,
  BgColorData,
  PlotCandleData,
  PlotBarData,
  LabelData,
  LabelStyle,
  LineDrawingData,
  BoxData,
  LinefillData,
  PolylineData,
  TableData,
  TableCellData,
  TableCellData as TableCell,
  TableMergeData,
  TablePosition,
} from 'oakscriptjs';
