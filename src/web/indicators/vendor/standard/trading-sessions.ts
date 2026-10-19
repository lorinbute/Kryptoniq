// @ts-nocheck
/**
 * Trading Sessions
 *
 * Draws up to three trading sessions (Tokyo, London and New York by default) on intraday charts. Each session has
 * its hours and its own time zone (an IANA name or a GMT offset). For every session run the indicator draws:
 * - a box from the first to the last bar of the session, from the lowest low to the highest high
 * - a label under the box with the range in ticks, the average close of the session and the session name
 * - dashed lines at the session open and at the latest close, with the area between them filled
 * - a dotted line at the average close of the session bars
 * A bar belongs to a session when its open time is inside the session hours. A new session display starts on the
 * first bar of a session run and on the first bar of a new trading day.
 *
 * Based on the standard Trading Sessions indicator.
 *
 * The range and the average are formatted with the symbol tick, and the new trading day comes from the exchange
 * time zone and session: the port reads them from the chart context (third argument of calculate). Without them
 * the tick is 0.01 and the trading days are the UTC days of the bars (see src/anchor-period.ts). Like the
 * original, it throws an Error on daily, weekly and monthly bars.
 */

import {
  box, label, line, linefill, str, color, time as pineTime, timeframe as pineTimeframe, resetDrawings, setDrawingBar,
  drawingOutputs, type Bar, type Box, type Label, type Line, type IndicatorResult, type InputConfig, type PlotConfig,
} from 'oakscriptjs';
import { chartTimeframe, periodChanges } from '../anchor-period';
import { mintickOf, type ChartContext } from '../chart-context';

export interface TradingSessionsInputs {
  showSessionNames: boolean;
  showSessionOC: boolean;
  showSessionTickRange: boolean;
  showSessionAverage: boolean;
  showFirst: boolean;
  firstSessionName: string;
  /** Session hours, e.g. "0900-1500" */
  firstSessionTime: string;
  /** IANA time zone name or GMT offset of the session hours */
  firstSessionTZ: string;
  firstSessionColor: string;
  showSecond: boolean;
  secondSessionName: string;
  secondSessionTime: string;
  secondSessionTZ: string;
  secondSessionColor: string;
  showThird: boolean;
  thirdSessionName: string;
  thirdSessionTime: string;
  thirdSessionTZ: string;
  thirdSessionColor: string;
}

export const defaultInputs: TradingSessionsInputs = {
  showSessionNames: true,
  showSessionOC: true,
  showSessionTickRange: true,
  showSessionAverage: true,
  showFirst: true,
  firstSessionName: 'Tokyo',
  firstSessionTime: '0900-1500',
  firstSessionTZ: 'Asia/Tokyo',
  firstSessionColor: 'rgba(41, 98, 255, 0.15)',
  showSecond: true,
  secondSessionName: 'London',
  secondSessionTime: '0830-1630',
  secondSessionTZ: 'Europe/London',
  secondSessionColor: 'rgba(255, 152, 0, 0.15)',
  showThird: true,
  thirdSessionName: 'New York',
  thirdSessionTime: '0930-1600',
  thirdSessionTZ: 'America/New_York',
  thirdSessionColor: 'rgba(8, 153, 129, 0.15)',
};

const TZ_TOOLTIP_TEXT = "The session's time zone, specified in either GMT notation (e.g., 'GMT-5') or as an IANA time zone database name (e.g., 'America/New_York')."
  + ' We recommend the latter since it includes other time-related changes, such as daylight savings.';

const sessionInputs = (k: 'first' | 'second' | 'third', show: 'showFirst' | 'showSecond' | 'showThird', group: string): InputConfig[] => [
  { id: show, type: 'bool', title: 'Show session', defval: defaultInputs[show], group, display: 'none' },
  { id: `${k}SessionName`, type: 'string', title: 'Displayed name', defval: defaultInputs[`${k}SessionName`], group, display: 'none', active: show },
  { id: `${k}SessionTime`, type: 'session', title: 'Session time', defval: defaultInputs[`${k}SessionTime`], group, display: 'none', active: show },
  { id: `${k}SessionTZ`, type: 'string', title: 'Session timezone', defval: defaultInputs[`${k}SessionTZ`], group, display: 'none', tooltip: TZ_TOOLTIP_TEXT, active: show },
  { id: `${k}SessionColor`, type: 'color', title: 'Session color', defval: defaultInputs[`${k}SessionColor`], group, active: show },
];

export const inputConfig: InputConfig[] = [
  { id: 'showSessionNames', type: 'bool', title: 'Show session names', defval: true, display: 'none' },
  { id: 'showSessionOC', type: 'bool', title: 'Draw session open and close lines', defval: true, display: 'none' },
  { id: 'showSessionTickRange', type: 'bool', title: 'Show tick range for each session', defval: true, display: 'none' },
  { id: 'showSessionAverage', type: 'bool', title: 'Show average price per session', defval: true, display: 'none' },
  ...sessionInputs('first', 'showFirst', 'First Session'),
  ...sessionInputs('second', 'showSecond', 'Second session'),
  ...sessionInputs('third', 'showThird', 'Third session'),
];

// No plots: boxes, labels, lines and linefills
export const plotConfig: PlotConfig[] = [];

export const metadata = {
  title: 'Trading Sessions',
  shortTitle: 'Trading Sessions',
  overlay: true,
};

/** indicator(max_boxes_count = 500, max_lines_count = 500, max_labels_count = 500) */
const MAX_OBJECTS = 500;

/** SessionDisplay of the original: the drawings of one session run and its running close sum */
interface SessionDisplay {
  sessionBox: Box;
  sessionLabel: Label;
  openLine: Line | null;
  avgLine: Line | null;
  closeLine: Line | null;
  sumClose: number;
  numOfBars: number;
}

/** SessionInfo of the original */
interface SessionInfo {
  color: string;
  name: string;
  session: string;
  timezone: string;
  active: SessionDisplay | null;
}

export function calculate(bars: Bar[], inputs: Partial<TradingSessionsInputs> = {}, chart?: ChartContext): IndicatorResult {
  const cfg = { ...defaultInputs, ...inputs };
  const n = bars.length;
  const result: IndicatorResult = {
    metadata: { title: metadata.title, shorttitle: metadata.shortTitle, overlay: metadata.overlay },
    plots: {},
  };
  if (n === 0) return result;

  const tf = chartTimeframe(bars, chart);
  if (tf !== '' && pineTimeframe.info(tf).isdwm) {
    throw new Error('This indicator can only be used on intraday timeframes.');
  }
  const unit = bars[0].time >= 1e12 ? 1 : 1000;
  const barMs = tf !== '' ? pineTimeframe.in_seconds(tf) * 1000 : undefined;
  const mintick = mintickOf(chart);
  // timeframe.change("1D")
  const isChange = periodChanges(bars, '1D', chart);

  // getSessionInfos()
  const sessionInfos: SessionInfo[] = [];
  if (cfg.showFirst) sessionInfos.push({ color: cfg.firstSessionColor, name: cfg.firstSessionName, session: cfg.firstSessionTime, timezone: cfg.firstSessionTZ, active: null });
  if (cfg.showSecond) sessionInfos.push({ color: cfg.secondSessionColor, name: cfg.secondSessionName, session: cfg.secondSessionTime, timezone: cfg.secondSessionTZ, active: null });
  if (cfg.showThird) sessionInfos.push({ color: cfg.thirdSessionColor, name: cfg.thirdSessionName, session: cfg.thirdSessionTime, timezone: cfg.thirdSessionTZ, active: null });

  resetDrawings({ line: MAX_OBJECTS, box: MAX_OBJECTS, label: MAX_OBJECTS });

  const setName = (dis: SessionDisplay, name: string) => {
    const boxText: string[] = [];
    if (cfg.showSessionTickRange) {
      boxText.push('Range: ' + str.tostring((box.get_top(dis.sessionBox) - box.get_bottom(dis.sessionBox)) / mintick, 'mintick', mintick));
    }
    if (cfg.showSessionAverage) boxText.push('Avg: ' + str.tostring(dis.sumClose / dis.numOfBars, 'mintick', mintick));
    if (cfg.showSessionNames) boxText.push(name);
    label.set_y(dis.sessionLabel, box.get_bottom(dis.sessionBox));
    label.set_text(dis.sessionLabel, boxText.join('\n'));
  };

  const createSessionDisplay = (info: SessionInfo, i: number) => {
    const b = bars[i];
    const boxColor = info.color;
    const opaqueColor = String(color.new(boxColor, 0));
    const sessionBox = box.new(i, b.high, i, b.low, 'transparent', undefined, undefined, undefined, undefined, boxColor);
    const sessionLabel = label.new(i, b.low, '', 'bar_index', 'price', 'transparent', 'label_upper_left', opaqueColor, undefined, 'left');
    const openLine = cfg.showSessionOC ? line.new(i, b.open, i, b.open, 'bar_index', undefined, opaqueColor, 'dashed', 1) : null;
    const closeLine = cfg.showSessionOC ? line.new(i, b.close, i, b.close, 'bar_index', undefined, opaqueColor, 'dashed', 1) : null;
    const avgLine = cfg.showSessionAverage ? line.new(i, b.close, i, b.close, 'bar_index', undefined, opaqueColor, 'dotted', 2) : null;
    const dis: SessionDisplay = { sessionBox, sessionLabel, openLine, avgLine, closeLine, sumClose: b.close, numOfBars: 1 };
    // an na line gives no linefill
    if (openLine && closeLine) linefill.new(openLine, closeLine, boxColor);
    setName(dis, info.name);
    info.active = dis;
  };

  const updateSessionDisplay = (info: SessionInfo, i: number) => {
    const b = bars[i];
    const dis = info.active!;
    dis.sumClose += b.close;
    dis.numOfBars += 1;
    box.set_top(dis.sessionBox, Math.max(box.get_top(dis.sessionBox), b.high));
    box.set_bottom(dis.sessionBox, Math.min(box.get_bottom(dis.sessionBox), b.low));
    box.set_right(dis.sessionBox, i);
    setName(dis, info.name);
    if (cfg.showSessionOC && dis.openLine && dis.closeLine) {
      line.set_x2(dis.openLine, i);
      line.set_x2(dis.closeLine, i);
      line.set_y1(dis.closeLine, b.close);
      line.set_y2(dis.closeLine, b.close);
    }
    if (cfg.showSessionAverage && dis.avgLine) {
      line.set_x2(dis.avgLine, i);
      const avg = dis.sumClose / dis.numOfBars;
      line.set_y1(dis.avgLine, avg);
      line.set_y2(dis.avgLine, avg);
    }
  };

  for (let i = 0; i < n; i++) {
    setDrawingBar(i, i === n - 1);
    const t = bars[i].time * unit;
    for (const info of sessionInfos) {
      // not na(time("", session, timezone)): the bar opens inside the session
      if (pineTime.inSession(t, info.session, info.timezone, barMs)) {
        if (info.active === null || isChange[i]) createSessionDisplay(info, i);
        else updateSessionDisplay(info, i);
      } else if (info.active !== null) {
        info.active = null;
      }
    }
  }
  setDrawingBar(null);

  return { ...result, ...drawingOutputs(bars, unit === 1 ? 'ms' : 's') };
}

export const TradingSessions = { calculate, metadata, defaultInputs, inputConfig, plotConfig };
