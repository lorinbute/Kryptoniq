// Inputs of "[DI] Logarithmic Moving Average" (© Dusty Investments, Pine v6) with the exact Pine defaults and limits.
import { z } from 'zod';

export const LMA_TITLE = '[DI] Logarithmic Moving Average';
export const LMA_SHORT_TITLE = '[DI] LMA';

export const LMA_PRESETS = ['Default', 'Scalping', 'Swing Trading', 'Trend Following', 'Mean Reversion', 'Custom'] as const;
export const LMA_MA_TYPES = ['EMA', 'SMA', 'WMA', 'RMA', 'VWMA'] as const;
export type LmaPreset = (typeof LMA_PRESETS)[number];
export type LmaMaType = (typeof LMA_MA_TYPES)[number];

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const LINE_STYLES = ['Solid', 'Dashed', 'Dotted'] as const;
export type LineStyleName = (typeof LINE_STYLES)[number];

export const lmaParamsSchema = z.object({
  // Strategy Presets
  preset: z.enum(LMA_PRESETS).default('Default'),
  // LMA Core Settings
  period: z.number().int().min(50).max(200).default(100),
  steepness: z.number().min(1.5).max(5).default(2.5),
  maType: z.enum(LMA_MA_TYPES).default('EMA'),
  smooth: z.number().int().min(3).max(25).default(10),
  momentumWeight: z.number().min(1).max(2).default(1.2),
  // Trading Thresholds
  longThreshold: z.number().min(0.1).max(2).default(0.5),
  shortThreshold: z.number().min(-2).max(-0.1).default(-0.5),
  // Visual Settings
  bullishColor: hex.default('#00FFAA'),
  bearishColor: hex.default('#B22833'),
  neutralColor: hex.default('#FFFF00'),
  colorBars: z.boolean().default(true),
  // Style (TradingView's Style tab: plots, fill, bar colours and hlines of the script)
  showSignal: z.boolean().default(true),
  signalWidth: z.number().int().min(1).max(4).default(3),
  showFill: z.boolean().default(true),
  showBarColors: z.boolean().default(true),
  showLongLine: z.boolean().default(true),
  longLineStyle: z.enum(LINE_STYLES).default('Dashed'),
  showShortLine: z.boolean().default(true),
  shortLineStyle: z.enum(LINE_STYLES).default('Dashed'),
  showNeutralLine: z.boolean().default(true),
  neutralLineStyle: z.enum(LINE_STYLES).default('Solid'),
});

export type LmaParams = z.infer<typeof lmaParamsSchema>;

export const DEFAULT_LMA_PARAMS: LmaParams = lmaParamsSchema.parse({});

/** The values each named preset forces (Pine: `if strategyPreset != "Custom"`; "Default" forces nothing). */
export const LMA_PRESET_VALUES: Partial<Record<LmaPreset, Pick<LmaParams, 'period' | 'steepness' | 'smooth' | 'longThreshold' | 'shortThreshold'>>> = {
  Scalping: { period: 60, steepness: 3.0, smooth: 5, longThreshold: 0.3, shortThreshold: -0.3 },
  'Swing Trading': { period: 120, steepness: 2.0, smooth: 15, longThreshold: 0.7, shortThreshold: -0.7 },
  'Trend Following': { period: 150, steepness: 1.8, smooth: 20, longThreshold: 1.0, shortThreshold: -1.0 },
  'Mean Reversion': { period: 80, steepness: 3.5, smooth: 8, longThreshold: 0.4, shortThreshold: -0.4 },
};

/** The parameters the indicator actually runs with once the preset is applied. */
export function effectiveLmaParams(p: LmaParams): LmaParams {
  const forced = LMA_PRESET_VALUES[p.preset];
  return forced ? { ...p, ...forced } : p;
}

/** The inputs' tooltips, verbatim from the script. */
export const LMA_TOOLTIPS = {
  preset: "Select a predefined configuration optimized for different trading approaches. Each preset adjusts period, steepness, smoothing, and thresholds to match the selected strategy.\n\nDefault (100, 2.5, 10, ±0.5): Universally applicable configuration that works well across multiple timeframes and assets. Balanced for medium-term investing and general trading.\n\nScalping (60, 3.0, 5, ±0.3): Highly responsive for ultra-short-term trades. More sensitive to quick price movements. Best for 1-15min charts.\n\nSwing Trading (120, 2.0, 15, ±0.7): Designed for multi-day positions with stronger noise filtering. Focuses on larger price swings. Works best on 1-4h and daily charts.\n\nTrend Following (150, 1.8, 20, ±1.0): Maximum smoothing for established trends only. Generates fewer but more reliable signals. Best for daily/weekly charts.\n\nMean Reversion (80, 3.5, 8, ±0.4): Optimized for counter-trend strategies. More sensitive to extreme moves for reversal opportunities. Best for ranging markets.",
  period: "The number of bars to include in the logarithmic moving average calculation.\n\n• Lower values (50-80): More responsive to recent price changes, better for short-term signals, but may produce more noise\n• Medium values (80-120): Balanced approach suitable for most trading styles and timeframes\n• Higher values (120-200): More stable signals, better for long-term trends, less sensitive to market noise\n\nEffect: Determines how much historical data influences the current signal. Higher values provide smoother but slower signals.",
  steepness: "Controls the logarithmic weight decay rate - how aggressively recent data is prioritized over older data.\n\n• Lower values (1.5-2.0): Gradual weight decay, smoother signals, includes more historical context, less reactive\n• Medium values (2.0-3.0): Balanced weight distribution, good for most market conditions\n• Higher values (3.0-5.0): Steep weight decay, highly responsive to recent price action, more volatile signals\n\nMathematical effect: Controls the logarithmic decay rate in the weighting formula. Higher steepness means recent bars get exponentially more importance.",
  maType: "Type of moving average used for final signal smoothing.\n\n• EMA: Exponential Moving Average - responsive, good for trending markets\n• SMA: Simple Moving Average - stable, equal weight to all periods\n• WMA: Weighted Moving Average - linear weight decay, moderate responsiveness\n• RMA: Rolling Moving Average - very smooth, similar to EMA but more stable\n• VWMA: Volume Weighted Moving Average - incorporates volume data for better accuracy",
  smooth: "Number of periods used to smooth the final LMA signal using the selected moving average type.\n\n• Lower values (3-8): More sensitive signals, quicker response to trend changes, more trading opportunities, but higher noise\n• Medium values (8-15): Balanced signal quality with reasonable responsiveness\n• Higher values (15-25): Smoother signals, fewer false signals, reduced whipsaws, but slower response to trend changes\n\nEffect: Reduces signal noise and prevents whipsaws at the cost of some delay in signal generation.",
  momentumWeight: "Multiplier applied when logarithmic momentum confirms the LMA signal direction.\n\n• 1.0: No momentum confirmation boost, pure LMA signal\n• 1.2-1.5: Moderate boost when momentum aligns with trend (recommended range)\n• 1.5-2.0: Strong boost for momentum-confirmed signals, more aggressive approach\n\nEffect: Strengthens signals when short-term price momentum aligns with the overall LMA trend direction, helping to filter out weak or counter-trend signals.",
  longThreshold: "Signal value required to trigger long entry alerts and bullish position classification.\n\n• Lower values (0.1-0.5): More frequent long signals, higher sensitivity, but increased risk of false positives\n• Medium values (0.5-1.0): Balanced approach suitable for most trading strategies\n• Higher values (1.0-2.0): Fewer but potentially more reliable long signals, requires stronger bullish momentum\n\nRecommendation: Start with default value and adjust based on your risk tolerance and trading frequency preferences.",
  shortThreshold: "Signal value required to trigger short entry alerts and bearish position classification.\n\n• Higher values (-0.1 to -0.5): More frequent short signals, higher sensitivity, but increased risk of false positives\n• Medium values (-0.5 to -1.0): Balanced approach suitable for most trading strategies\n• Lower values (-1.0 to -2.0): Fewer but potentially more reliable short signals, requires stronger bearish momentum\n\nRecommendation: Should typically mirror your long threshold value but with opposite sign for symmetrical trading approach.",
  colorBars: "Enable/disable coloring of price bars based on LMA signal direction.\n\n• Enabled: Price bars will be colored to match the current LMA signal (bullish=green, bearish=red, neutral=yellow)\n• Disabled: Price bars retain their default coloring scheme\n\nUseful for: Quick visual identification of current market sentiment according to LMA analysis.",
} as const;
