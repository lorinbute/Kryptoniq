// Inputs of "[Dusty Investments] Slingshot System 3.4" with the exact Pine defaults.
import { z } from 'zod';
import { TIMEFRAMES } from '../time.ts';

export const SLINGSHOT_VERSION = '3.4';
/** FD-DENAMES: "[DE]" for Dusty Enterprise; the title in lists and the settings panel, the short one on the chart. */
export const SLINGSHOT_TITLE = `[DE] Slingshot System ${SLINGSHOT_VERSION}`;
export const SLINGSHOT_SHORT_TITLE = `[DE] Slingshot ${SLINGSHOT_VERSION}`;

/** Pine `color.red` in v5. */
export const PINE_RED = '#FF5252';

/** Pine `color.blue` in v5: the SHORT labels (the colour of the old SHORT, FD-SLINGSHOT34). */
export const PINE_BLUE = '#2196F3';

/** #RRGGBB, or #RRGGBBAA with its opacity (FD-OPACITY). */
const hex = z.string().regex(/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/);

/** Pine label sizes (FD-SS34LIVE): the one list of sizes for every shape and text (FD-STYLEUNIFY). */
export const SIGNAL_SIZE_NAMES = ['Tiny', 'Small', 'Normal', 'Large', 'Huge'] as const;
export type SignalSizeName = (typeof SIGNAL_SIZE_NAMES)[number];
/** Pine line styles (line.style_*), as the inputs name them. */
export const PINE_LINE_STYLES = ['Solid', 'Dashed', 'Dotted'] as const;
export type PineLineStyle = (typeof PINE_LINE_STYLES)[number];

const size = z.enum(SIGNAL_SIZE_NAMES).default('Small');
/** A line's width: TradingView's 1–4 px. */
const width = (d: number) => z.number().int().min(1).max(4).default(d);
const lineStyle = (d: PineLineStyle) => z.enum(PINE_LINE_STYLES).default(d);

/** FD-STYLEUNIFY: a label's states and the keys of their colour / size (`${side}${state}Color`, `${side}${state}Size`). */
export const SIGNAL_STATES = ['Forming', '', 'Failed', 'Invalid', 'Tp', 'Sl'] as const;
export type SignalState = (typeof SIGNAL_STATES)[number];

/**
 * FD-STYLEUNIFY: settings saved before the per-side, per-state looks keep their look. The shared failed / invalidated
 * colours and the signal size go to both sides and every state, a signal's colour to its forming state, the ATR colours to
 * the SHORT's levels, and the market structure's width / style / text size to both its lines. Only missing keys are filled.
 */
export function migrateSlingshotParams(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw;
  const r = raw as Record<string, unknown>;
  const out: Record<string, unknown> = { ...r };
  const fill = (key: string, from: unknown) => {
    if (out[key] === undefined && from !== undefined) out[key] = from;
  };
  for (const side of ['long', 'short'] as const) {
    fill(`${side}FailedColor`, r.failedColor);
    fill(`${side}InvalidColor`, r.invalidColor);
    fill(`${side}FormingColor`, r[`${side}Color`]);
    for (const st of SIGNAL_STATES) fill(`${side}${st}Size`, r.signalSize);
  }
  fill('shortTPColor', r.longTPColor);
  fill('shortSLColor', r.longSLColor);
  for (const line of ['msBull', 'msBear'] as const) {
    fill(`${line}LineWidth`, r.msLineWidth);
    fill(`${line}LineStyle`, r.msLineStyle);
    fill(`${line}TextSize`, r.msTextSize);
  }
  return out;
}

export const ONE_SIDE_MESSAGE = 'Bifează cel puțin una dintre Long Signals și Short Signals.';

const slingshotObject = z.object({
  // Signals (v3.4, FD-SLINGSHOT34): at least one side stays on
  showLong: z.boolean().default(true),
  showShort: z.boolean().default(false),
  // FD-SS34LIVE, FD-SSSL, FD-STYLEUNIFY: each state of each side's labels, its colour and its size
  longFormingColor: hex.default('#00FFAA'),
  longFormingSize: size,
  longColor: hex.default('#00FFAA'),
  longSize: size,
  longFailedColor: hex.default(PINE_RED),
  longFailedSize: size,
  longInvalidColor: hex.default(PINE_RED),
  longInvalidSize: size,
  longTpColor: hex.default('#00FFAA'),
  longTpSize: size,
  longSlColor: hex.default(PINE_RED),
  longSlSize: size,
  shortFormingColor: hex.default(PINE_BLUE),
  shortFormingSize: size,
  shortColor: hex.default(PINE_BLUE),
  shortSize: size,
  shortFailedColor: hex.default(PINE_RED),
  shortFailedSize: size,
  shortInvalidColor: hex.default(PINE_RED),
  shortInvalidSize: size,
  shortTpColor: hex.default('#00FFAA'),
  shortTpSize: size,
  shortSlColor: hex.default(PINE_RED),
  shortSlSize: size,
  // Indicator Settings
  lenFastEma: z.number().int().min(1).max(1000).default(38),
  lenSlowEma: z.number().int().min(1).max(1000).default(62),
  lenRsi: z.number().int().min(1).max(500).default(14),
  lenStoch: z.number().int().min(1).max(500).default(14),
  smoothK: z.number().int().min(1).max(100).default(3),
  stochOversold: z.number().int().min(0).max(100).default(20),
  stochOverbought: z.number().int().min(0).max(100).default(80),
  touchTolPct: z.number().min(0).max(100).default(0),
  kTol: z.number().min(0).max(100).default(0),
  // ATR Settings
  atrLength: z.number().int().min(1).max(500).default(14),
  takeProfitMultiplier: z.number().min(0).max(100).default(1),
  stopLossMultiplier: z.number().min(0).max(100).default(1),
  lookback: z.number().int().min(1).max(1000).default(20),
  atrLineLengthTP: z.number().int().min(0).max(500).default(50),
  atrLineLengthSL: z.number().int().min(0).max(500).default(50),
  showLabels: z.boolean().default(true),
  showLines: z.boolean().default(true),
  hideAtrOnTP: z.boolean().default(true),
  hideAtrOnStop: z.boolean().default(true),
  // FD-STYLEUNIFY: each side's take profit and stop loss level: its line (colour, width, style) and its label's size
  longTPColor: hex.default('#00FFAA'),
  longTpLineWidth: width(2),
  longTpLineStyle: lineStyle('Dashed'),
  longTpLabelSize: size,
  longSLColor: hex.default(PINE_RED),
  longSlLineWidth: width(2),
  longSlLineStyle: lineStyle('Dashed'),
  longSlLabelSize: size,
  shortTPColor: hex.default('#00FFAA'),
  shortTpLineWidth: width(2),
  shortTpLineStyle: lineStyle('Dashed'),
  shortTpLabelSize: size,
  shortSLColor: hex.default(PINE_RED),
  shortSlLineWidth: width(2),
  shortSlLineStyle: lineStyle('Dashed'),
  shortSlLabelSize: size,
  // Cloud (FD-SS34LIVE): the EMAs and, at half its opacity, the cloud; FD-STYLEUNIFY: the EMAs' width and style
  cloudUpColor: hex.default('#00FFAA'),
  cloudDownColor: hex.default(PINE_RED),
  slowEmaWidth: width(1),
  slowEmaStyle: lineStyle('Solid'),
  fastEmaWidth: width(1),
  fastEmaStyle: lineStyle('Solid'),
  // Market Structure
  showMS: z.boolean().default(true),
  msTf: z.enum(['', ...TIMEFRAMES]).default(''),
  msSwing: z.number().int().min(1).max(100).default(5),
  msLineLength: z.number().int().min(1).max(1000).default(50),
  msRightExtend: z.number().int().min(0).max(490).default(10),
  msBreakOnClose: z.boolean().default(true),
  msBullText: z.string().max(200).default('Above this line we enter bullish market structure'),
  msBearText: z.string().max(200).default('Below this line we enter bearish market structure'),
  // FD-STYLEUNIFY: each line its colour, width (1–5, as Pine's MS Line Width), style and text size
  msBullColor: hex.default('#00FFAA'),
  msBullLineWidth: z.number().int().min(1).max(5).default(1),
  msBullLineStyle: lineStyle('Dotted'),
  msBullTextSize: size,
  msBearColor: hex.default(PINE_RED),
  msBearLineWidth: z.number().int().min(1).max(5).default(1),
  msBearLineStyle: lineStyle('Dotted'),
  msBearTextSize: size,
});

export const slingshotParamsSchema = z.preprocess(migrateSlingshotParams, slingshotObject.refine((p) => p.showLong || p.showShort, { path: ['showShort'], message: ONE_SIDE_MESSAGE }));

export type SlingshotParams = z.infer<typeof slingshotParamsSchema>;

export const DEFAULT_SLINGSHOT_PARAMS: SlingshotParams = slingshotParamsSchema.parse({});
