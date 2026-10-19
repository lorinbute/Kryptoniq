// Inputs of "[Dusty Investments] Slingshot System Long 3.3" with the exact Pine defaults.
import { z } from 'zod';
import { TIMEFRAMES } from '../time.ts';

export const SLINGSHOT_VERSION = '3.3';
/** FD-DENAMES: "[DE]" for Dusty Enterprise; the title in lists and the settings panel, the short one on the chart. */
export const SLINGSHOT_TITLE = `[DE] Slingshot System ${SLINGSHOT_VERSION}`;
export const SLINGSHOT_SHORT_TITLE = `[DE] Slingshot ${SLINGSHOT_VERSION}`;

/** Pine `color.red` in v5. */
export const PINE_RED = '#FF5252';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const slingshotParamsSchema = z.object({
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
  longTPColor: hex.default('#00FFAA'),
  longSLColor: hex.default(PINE_RED),
  // Market Structure
  showMS: z.boolean().default(true),
  msTf: z.enum(['', ...TIMEFRAMES]).default(''),
  msSwing: z.number().int().min(1).max(100).default(5),
  msLineLength: z.number().int().min(1).max(1000).default(50),
  msRightExtend: z.number().int().min(0).max(490).default(10),
  msBreakOnClose: z.boolean().default(true),
  msBullText: z.string().max(200).default('Above this line we enter bullish market structure'),
  msBearText: z.string().max(200).default('Below this line we enter bearish market structure'),
  msBullColor: hex.default('#00FFAA'),
  msBearColor: hex.default(PINE_RED),
  msLineWidth: z.number().int().min(1).max(5).default(1),
  msLineStyle: z.enum(['Solid', 'Dashed', 'Dotted']).default('Dotted'),
  msTextSize: z.enum(['Tiny', 'Small', 'Normal', 'Large']).default('Small'),
});

export type SlingshotParams = z.infer<typeof slingshotParamsSchema>;

export const DEFAULT_SLINGSHOT_PARAMS: SlingshotParams = slingshotParamsSchema.parse({});
