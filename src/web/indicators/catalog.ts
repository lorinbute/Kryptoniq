// The code of each indicator (TD-INDICATORS §2): the vendored module's fields as the upstream registry gives them, plus
// Sentiq's Volume. Loaded with the runtime chunk only (runtime.ts). Generated from the vendored registry.
import type { Bar, FillConfig, HLineConfig, IndicatorResult, InputConfig, PlotConfig } from 'oakscriptjs';
import type { StudyId } from '../../shared/studies.ts';
import type { ChartContext, SymbolRequest } from './vendor/chart-context';
import { VolumeStudy } from './volume.ts';
import * as n24HourVolumeStd from './vendor/standard/24-hour-volume';
import * as accumulationDistributionStd from './vendor/standard/accumulation-distribution';
import * as adrIndicator from './vendor/standard/adr';
import * as adrBarsStd from './vendor/standard/adr-bars';
import * as adxIndicator from './vendor/standard/adx';
import * as almaIndicator from './vendor/standard/alma';
import * as aroonIndicator from './vendor/standard/aroon';
import * as aroonOscIndicator from './vendor/standard/aroon-oscillator';
import * as atrIndicator from './vendor/standard/atr';
import * as autoFibExtensionStd from './vendor/standard/auto-fib-extension';
import * as autoFibRetracementStd from './vendor/standard/auto-fib-retracement';
import * as autoKeyLevelsIndicator from './vendor/standard/auto-key-levels';
import * as autoPitchforkStd from './vendor/standard/auto-pitchfork';
import * as autoTrendDetectorIndicator from './vendor/standard/auto-trend-detector';
import * as awesomeOscIndicator from './vendor/standard/awesome-oscillator';
import * as bbIndicator from './vendor/standard/bb';
import * as bbBandwidthIndicator from './vendor/standard/bb-bandwidth';
import * as bbPercentBIndicator from './vendor/standard/bb-percent-b';
import * as bbtrendIndicator from './vendor/standard/bbtrend';
import * as bollingerBarsIndicator from './vendor/standard/bollinger-bars';
import * as bopIndicator from './vendor/standard/bop';
import * as bullBearPowerIndicator from './vendor/standard/bull-bear-power';
import * as cciIndicator from './vendor/standard/cci';
import * as chaikinMFIndicator from './vendor/standard/chaikin-mf';
import * as chaikinOscIndicator from './vendor/standard/chaikin-oscillator';
import * as chandeKrollStopIndicator from './vendor/standard/chande-kroll-stop';
import * as chandeMOIndicator from './vendor/standard/chande-mo';
import * as chandelierStd from './vendor/standard/chandelier';
import * as chopZoneIndicator from './vendor/standard/chop-zone';
import * as choppinessIndicator from './vendor/standard/choppiness';
import * as connorsRsiIndicator from './vendor/standard/connors-rsi';
import * as coppockCurveIndicator from './vendor/standard/coppock-curve';
import * as correlationCoefficientStd from './vendor/standard/correlation-coefficient';
import * as cumulativeVolumeDeltaIndicator from './vendor/standard/cumulative-volume-delta';
import * as demaIndicator from './vendor/standard/dema';
import * as dmiIndicator from './vendor/standard/dmi';
import * as donchianIndicator from './vendor/standard/donchian';
import * as dpoIndicator from './vendor/standard/dpo';
import * as eomIndicator from './vendor/standard/ease-of-movement';
import * as elderForceIndicator from './vendor/standard/elder-force';
import * as emaIndicator from './vendor/standard/ema';
import * as envelopeIndicator from './vendor/standard/envelope';
import * as fisherTransformIndicator from './vendor/standard/fisher-transform';
import * as gapsStd from './vendor/standard/gaps';
import * as histVolIndicator from './vendor/standard/historical-volatility';
import * as hmaIndicator from './vendor/standard/hma';
import * as ichimokuIndicator from './vendor/standard/ichimoku';
import * as kamaStd from './vendor/standard/kama';
import * as keltnerIndicator from './vendor/standard/keltner';
import * as klingerIndicator from './vendor/standard/klinger';
import * as kstIndicator from './vendor/standard/kst';
import * as linregChannelStd from './vendor/standard/linreg-channel';
import * as lsmaIndicator from './vendor/standard/lsma';
import * as maCrossIndicator from './vendor/standard/ma-cross';
import * as maRibbonIndicator from './vendor/standard/ma-ribbon';
import * as macdIndicator from './vendor/standard/macd';
import * as massIndexIndicator from './vendor/standard/mass-index';
import * as mcGinleyDynamicIndicator from './vendor/standard/mcginley-dynamic';
import * as medianIndicator from './vendor/standard/median';
import * as mfiIndicator from './vendor/standard/mfi';
import * as momentumIndicator from './vendor/standard/momentum';
import * as moonPhasesIndicator from './vendor/standard/moon-phases';
import * as multiTimePeriodChartsStd from './vendor/standard/multi-time-period-charts';
import * as netVolumeIndicator from './vendor/standard/net-volume';
import * as nviIndicator from './vendor/standard/nvi';
import * as obvIndicator from './vendor/standard/obv';
import * as parabolicSarIndicator from './vendor/standard/parabolic-sar';
import * as performanceStd from './vendor/standard/performance';
import * as pivotPointsHighLowStd from './vendor/standard/pivot-points-high-low';
import * as pivotPointsStandardStd from './vendor/standard/pivot-points-standard';
import * as pmoStd from './vendor/standard/pmo';
import * as priceOscillatorIndicator from './vendor/standard/price-oscillator';
import * as pringsSpecialKIndicator from './vendor/standard/prings-special-k';
import * as pviIndicator from './vendor/standard/pvi';
import * as pvtIndicator from './vendor/standard/pvt';
import * as rciIndicator from './vendor/standard/rank-correlation-index';
import * as rciRibbonIndicator from './vendor/standard/rci-ribbon';
import * as relativeVolatilityIndexIndicator from './vendor/standard/relative-volatility-index';
import * as relativeVolumeAtTimeIndicator from './vendor/standard/relative-volume-at-time';
import * as robBookerZivGhostPivotsStd from './vendor/standard/rob-booker-ziv-ghost-pivots';
import * as rocIndicator from './vendor/standard/roc';
import * as rsiIndicator from './vendor/standard/rsi';
import * as rsiDivergenceIndicatorStd from './vendor/standard/rsi-divergence-indicator';
import * as rviIndicator from './vendor/standard/rvi';
import * as seasonalityStd from './vendor/standard/seasonality';
import * as smaIndicator from './vendor/standard/sma';
import * as smiStd from './vendor/standard/smi';
import * as smiErgodicIndicator from './vendor/standard/smi-ergodic';
import * as smiErgodicOscIndicator from './vendor/standard/smi-ergodic-oscillator';
import * as smmaIndicator from './vendor/standard/smma';
import * as stdevIndicator from './vendor/standard/stdev';
import * as stochIndicator from './vendor/standard/stoch';
import * as stochRsiIndicator from './vendor/standard/stoch-rsi';
import * as supertrendIndicator from './vendor/standard/supertrend';
import * as technicalsStd from './vendor/standard/technicals';
import * as temaIndicator from './vendor/standard/tema';
import * as tradingSessionsStd from './vendor/standard/trading-sessions';
import * as trendStrengthIndicator from './vendor/standard/trend-strength';
import * as trixIndicator from './vendor/standard/trix';
import * as tsiIndicator from './vendor/standard/tsi';
import * as twapIndicator from './vendor/standard/twap';
import * as ulcerIndexIndicator from './vendor/standard/ulcer-index';
import * as ultimateOscIndicator from './vendor/standard/ultimate-oscillator';
import * as upDownVolumeIndicator from './vendor/standard/up-down-volume';
import * as visibleAveragePriceStd from './vendor/standard/visible-average-price';
import * as volatilityStopIndicator from './vendor/standard/volatility-stop';
import * as volumeDeltaIndicator from './vendor/standard/volume-delta';
import * as volumeOscIndicator from './vendor/standard/volume-oscillator';
import * as vortexIndicator from './vendor/standard/vortex';
import * as vwapIndicator from './vendor/standard/vwap';
import * as vwmaIndicator from './vendor/standard/vwma';
import * as williamsAlligatorIndicator from './vendor/standard/williams-alligator';
import * as williamsFractalsIndicator from './vendor/standard/williams-fractals';
import * as williamsRIndicator from './vendor/standard/williams-r';
import * as wmaIndicator from './vendor/standard/wma';
import * as woodiesCCIIndicator from './vendor/standard/woodies-cci';
import * as zigzagIndicator from './vendor/standard/zigzag';

export interface StudyModule {
  overlay: boolean;
  metadata: { title: string; shortTitle: string; overlay: boolean };
  defaultInputs: Record<string, unknown>;
  inputConfig: InputConfig[];
  plotConfig: PlotConfig[];
  hlineConfig?: HLineConfig[];
  fillConfig?: FillConfig[];
  /** Bars of other symbols or timeframes it reads (PineScript request.security). */
  requiredSymbols?: (inputs: Record<string, unknown>, chart?: ChartContext) => SymbolRequest[];
  /** Calculated again when the visible part of the chart changes. */
  usesVisibleRange?: boolean;
  calculate: (bars: Bar[], inputs?: Record<string, unknown>, chart?: ChartContext) => IndicatorResult;
}

const MODULES = {
  'sma': { overlay: true, metadata: smaIndicator.metadata, defaultInputs: smaIndicator.defaultInputs, inputConfig: smaIndicator.inputConfig, plotConfig: smaIndicator.plotConfig, calculate: smaIndicator.calculate },
  'adr': { overlay: false, metadata: adrIndicator.metadata, defaultInputs: adrIndicator.defaultInputs, inputConfig: adrIndicator.inputConfig, plotConfig: adrIndicator.plotConfig, calculate: adrIndicator.calculate },
  'alma': { overlay: true, metadata: almaIndicator.metadata, defaultInputs: almaIndicator.defaultInputs, inputConfig: almaIndicator.inputConfig, plotConfig: almaIndicator.plotConfig, calculate: almaIndicator.calculate },
  'atr': { overlay: false, metadata: atrIndicator.metadata, defaultInputs: atrIndicator.defaultInputs, inputConfig: atrIndicator.inputConfig, plotConfig: atrIndicator.plotConfig, calculate: atrIndicator.calculate },
  'bb': { overlay: true, metadata: bbIndicator.metadata, defaultInputs: bbIndicator.defaultInputs, inputConfig: bbIndicator.inputConfig, plotConfig: bbIndicator.plotConfig, calculate: bbIndicator.calculate },
  'bop': { overlay: false, metadata: bopIndicator.metadata, defaultInputs: bopIndicator.defaultInputs, inputConfig: bopIndicator.inputConfig, plotConfig: bopIndicator.plotConfig, calculate: bopIndicator.calculate },
  'cci': { overlay: false, metadata: cciIndicator.metadata, defaultInputs: cciIndicator.defaultInputs, inputConfig: cciIndicator.inputConfig, plotConfig: cciIndicator.plotConfig, hlineConfig: cciIndicator.hlineConfig, fillConfig: cciIndicator.fillConfig, calculate: cciIndicator.calculate },
  'dema': { overlay: true, metadata: demaIndicator.metadata, defaultInputs: demaIndicator.defaultInputs, inputConfig: demaIndicator.inputConfig, plotConfig: demaIndicator.plotConfig, calculate: demaIndicator.calculate },
  'ema': { overlay: true, metadata: emaIndicator.metadata, defaultInputs: emaIndicator.defaultInputs, inputConfig: emaIndicator.inputConfig, plotConfig: emaIndicator.plotConfig, calculate: emaIndicator.calculate },
  'hma': { overlay: true, metadata: hmaIndicator.metadata, defaultInputs: hmaIndicator.defaultInputs, inputConfig: hmaIndicator.inputConfig, plotConfig: hmaIndicator.plotConfig, calculate: hmaIndicator.calculate },
  'ichimoku': { overlay: true, metadata: ichimokuIndicator.metadata, defaultInputs: ichimokuIndicator.defaultInputs, inputConfig: ichimokuIndicator.inputConfig, plotConfig: ichimokuIndicator.plotConfig, calculate: ichimokuIndicator.calculate },
  'keltner': { overlay: true, metadata: keltnerIndicator.metadata, defaultInputs: keltnerIndicator.defaultInputs, inputConfig: keltnerIndicator.inputConfig, plotConfig: keltnerIndicator.plotConfig, calculate: keltnerIndicator.calculate },
  'lsma': { overlay: true, metadata: lsmaIndicator.metadata, defaultInputs: lsmaIndicator.defaultInputs, inputConfig: lsmaIndicator.inputConfig, plotConfig: lsmaIndicator.plotConfig, calculate: lsmaIndicator.calculate },
  'macd': { overlay: false, metadata: macdIndicator.metadata, defaultInputs: macdIndicator.defaultInputs, inputConfig: macdIndicator.inputConfig, plotConfig: macdIndicator.plotConfig, hlineConfig: macdIndicator.hlineConfig, calculate: macdIndicator.calculate },
  'mass-index': { overlay: false, metadata: massIndexIndicator.metadata, defaultInputs: massIndexIndicator.defaultInputs, inputConfig: massIndexIndicator.inputConfig, plotConfig: massIndexIndicator.plotConfig, calculate: massIndexIndicator.calculate },
  'mc-ginley-dynamic': { overlay: true, metadata: mcGinleyDynamicIndicator.metadata, defaultInputs: mcGinleyDynamicIndicator.defaultInputs, inputConfig: mcGinleyDynamicIndicator.inputConfig, plotConfig: mcGinleyDynamicIndicator.plotConfig, calculate: mcGinleyDynamicIndicator.calculate },
  'momentum': { overlay: false, metadata: momentumIndicator.metadata, defaultInputs: momentumIndicator.defaultInputs, inputConfig: momentumIndicator.inputConfig, plotConfig: momentumIndicator.plotConfig, calculate: momentumIndicator.calculate },
  'obv': { overlay: false, metadata: obvIndicator.metadata, defaultInputs: obvIndicator.defaultInputs, inputConfig: obvIndicator.inputConfig, plotConfig: obvIndicator.plotConfig, calculate: obvIndicator.calculate },
  'roc': { overlay: false, metadata: rocIndicator.metadata, defaultInputs: rocIndicator.defaultInputs, inputConfig: rocIndicator.inputConfig, plotConfig: rocIndicator.plotConfig, hlineConfig: rocIndicator.hlineConfig, calculate: rocIndicator.calculate },
  'rsi': { overlay: false, metadata: rsiIndicator.metadata, defaultInputs: rsiIndicator.defaultInputs, inputConfig: rsiIndicator.inputConfig, plotConfig: rsiIndicator.plotConfig, hlineConfig: rsiIndicator.hlineConfig, fillConfig: rsiIndicator.fillConfig, calculate: rsiIndicator.calculate },
  'stoch': { overlay: false, metadata: stochIndicator.metadata, defaultInputs: stochIndicator.defaultInputs, inputConfig: stochIndicator.inputConfig, plotConfig: stochIndicator.plotConfig, hlineConfig: stochIndicator.hlineConfig, fillConfig: stochIndicator.fillConfig, calculate: stochIndicator.calculate },
  'tema': { overlay: true, metadata: temaIndicator.metadata, defaultInputs: temaIndicator.defaultInputs, inputConfig: temaIndicator.inputConfig, plotConfig: temaIndicator.plotConfig, calculate: temaIndicator.calculate },
  'vwma': { overlay: true, metadata: vwmaIndicator.metadata, defaultInputs: vwmaIndicator.defaultInputs, inputConfig: vwmaIndicator.inputConfig, plotConfig: vwmaIndicator.plotConfig, calculate: vwmaIndicator.calculate },
  'wma': { overlay: true, metadata: wmaIndicator.metadata, defaultInputs: wmaIndicator.defaultInputs, inputConfig: wmaIndicator.inputConfig, plotConfig: wmaIndicator.plotConfig, calculate: wmaIndicator.calculate },
  'donchian': { overlay: true, metadata: donchianIndicator.metadata, defaultInputs: donchianIndicator.defaultInputs, inputConfig: donchianIndicator.inputConfig, plotConfig: donchianIndicator.plotConfig, calculate: donchianIndicator.calculate },
  'parabolic-sar': { overlay: true, metadata: parabolicSarIndicator.metadata, defaultInputs: parabolicSarIndicator.defaultInputs, inputConfig: parabolicSarIndicator.inputConfig, plotConfig: parabolicSarIndicator.plotConfig, calculate: parabolicSarIndicator.calculate },
  'supertrend': { overlay: true, metadata: supertrendIndicator.metadata, defaultInputs: supertrendIndicator.defaultInputs, inputConfig: supertrendIndicator.inputConfig, plotConfig: supertrendIndicator.plotConfig, calculate: supertrendIndicator.calculate },
  'adx': { overlay: false, metadata: adxIndicator.metadata, defaultInputs: adxIndicator.defaultInputs, inputConfig: adxIndicator.inputConfig, plotConfig: adxIndicator.plotConfig, calculate: adxIndicator.calculate },
  'awesome-oscillator': { overlay: false, metadata: awesomeOscIndicator.metadata, defaultInputs: awesomeOscIndicator.defaultInputs, inputConfig: awesomeOscIndicator.inputConfig, plotConfig: awesomeOscIndicator.plotConfig, calculate: awesomeOscIndicator.calculate },
  'bbtrend': { overlay: false, metadata: bbtrendIndicator.metadata, defaultInputs: bbtrendIndicator.defaultInputs, inputConfig: bbtrendIndicator.inputConfig, plotConfig: bbtrendIndicator.plotConfig, hlineConfig: bbtrendIndicator.hlineConfig, calculate: bbtrendIndicator.calculate },
  'bull-bear-power': { overlay: false, metadata: bullBearPowerIndicator.metadata, defaultInputs: bullBearPowerIndicator.defaultInputs, inputConfig: bullBearPowerIndicator.inputConfig, plotConfig: bullBearPowerIndicator.plotConfig, hlineConfig: bullBearPowerIndicator.hlineConfig, calculate: bullBearPowerIndicator.calculate },
  'chande-mo': { overlay: false, metadata: chandeMOIndicator.metadata, defaultInputs: chandeMOIndicator.defaultInputs, inputConfig: chandeMOIndicator.inputConfig, plotConfig: chandeMOIndicator.plotConfig, hlineConfig: chandeMOIndicator.hlineConfig, calculate: chandeMOIndicator.calculate },
  'dpo': { overlay: false, metadata: dpoIndicator.metadata, defaultInputs: dpoIndicator.defaultInputs, inputConfig: dpoIndicator.inputConfig, plotConfig: dpoIndicator.plotConfig, hlineConfig: dpoIndicator.hlineConfig, calculate: dpoIndicator.calculate },
  'elder-force': { overlay: false, metadata: elderForceIndicator.metadata, defaultInputs: elderForceIndicator.defaultInputs, inputConfig: elderForceIndicator.inputConfig, plotConfig: elderForceIndicator.plotConfig, hlineConfig: elderForceIndicator.hlineConfig, calculate: elderForceIndicator.calculate },
  'hist-volatility': { overlay: false, metadata: histVolIndicator.metadata, defaultInputs: histVolIndicator.defaultInputs, inputConfig: histVolIndicator.inputConfig, plotConfig: histVolIndicator.plotConfig, calculate: histVolIndicator.calculate },
  'ma-cross': { overlay: true, metadata: maCrossIndicator.metadata, defaultInputs: maCrossIndicator.defaultInputs, inputConfig: maCrossIndicator.inputConfig, plotConfig: maCrossIndicator.plotConfig, calculate: maCrossIndicator.calculate },
  'ma-ribbon': { overlay: true, metadata: maRibbonIndicator.metadata, defaultInputs: maRibbonIndicator.defaultInputs, inputConfig: maRibbonIndicator.inputConfig, plotConfig: maRibbonIndicator.plotConfig, calculate: maRibbonIndicator.calculate },
  'median': { overlay: true, metadata: medianIndicator.metadata, defaultInputs: medianIndicator.defaultInputs, inputConfig: medianIndicator.inputConfig, plotConfig: medianIndicator.plotConfig, calculate: medianIndicator.calculate },
  'mfi': { overlay: false, metadata: mfiIndicator.metadata, defaultInputs: mfiIndicator.defaultInputs, inputConfig: mfiIndicator.inputConfig, plotConfig: mfiIndicator.plotConfig, hlineConfig: mfiIndicator.hlineConfig, fillConfig: mfiIndicator.fillConfig, calculate: mfiIndicator.calculate },
  'pvt': { overlay: false, metadata: pvtIndicator.metadata, defaultInputs: pvtIndicator.defaultInputs, inputConfig: pvtIndicator.inputConfig, plotConfig: pvtIndicator.plotConfig, calculate: pvtIndicator.calculate },
  'rvi': { overlay: false, metadata: rviIndicator.metadata, defaultInputs: rviIndicator.defaultInputs, inputConfig: rviIndicator.inputConfig, plotConfig: rviIndicator.plotConfig, calculate: rviIndicator.calculate },
  'smi-ergodic': { overlay: false, metadata: smiErgodicIndicator.metadata, defaultInputs: smiErgodicIndicator.defaultInputs, inputConfig: smiErgodicIndicator.inputConfig, plotConfig: smiErgodicIndicator.plotConfig, calculate: smiErgodicIndicator.calculate },
  'smi-ergodic-osc': { overlay: false, metadata: smiErgodicOscIndicator.metadata, defaultInputs: smiErgodicOscIndicator.defaultInputs, inputConfig: smiErgodicOscIndicator.inputConfig, plotConfig: smiErgodicOscIndicator.plotConfig, calculate: smiErgodicOscIndicator.calculate },
  'smma': { overlay: true, metadata: smmaIndicator.metadata, defaultInputs: smmaIndicator.defaultInputs, inputConfig: smmaIndicator.inputConfig, plotConfig: smmaIndicator.plotConfig, calculate: smmaIndicator.calculate },
  'stdev': { overlay: false, metadata: stdevIndicator.metadata, defaultInputs: stdevIndicator.defaultInputs, inputConfig: stdevIndicator.inputConfig, plotConfig: stdevIndicator.plotConfig, calculate: stdevIndicator.calculate },
  'stoch-rsi': { overlay: false, metadata: stochRsiIndicator.metadata, defaultInputs: stochRsiIndicator.defaultInputs, inputConfig: stochRsiIndicator.inputConfig, plotConfig: stochRsiIndicator.plotConfig, hlineConfig: stochRsiIndicator.hlineConfig, fillConfig: stochRsiIndicator.fillConfig, calculate: stochRsiIndicator.calculate },
  'trend-strength': { overlay: false, metadata: trendStrengthIndicator.metadata, defaultInputs: trendStrengthIndicator.defaultInputs, inputConfig: trendStrengthIndicator.inputConfig, plotConfig: trendStrengthIndicator.plotConfig, hlineConfig: trendStrengthIndicator.hlineConfig, calculate: trendStrengthIndicator.calculate },
  'tsi': { overlay: false, metadata: tsiIndicator.metadata, defaultInputs: tsiIndicator.defaultInputs, inputConfig: tsiIndicator.inputConfig, plotConfig: tsiIndicator.plotConfig, hlineConfig: tsiIndicator.hlineConfig, calculate: tsiIndicator.calculate },
  'volume-osc': { overlay: false, metadata: volumeOscIndicator.metadata, defaultInputs: volumeOscIndicator.defaultInputs, inputConfig: volumeOscIndicator.inputConfig, plotConfig: volumeOscIndicator.plotConfig, hlineConfig: volumeOscIndicator.hlineConfig, calculate: volumeOscIndicator.calculate },
  'vortex': { overlay: false, metadata: vortexIndicator.metadata, defaultInputs: vortexIndicator.defaultInputs, inputConfig: vortexIndicator.inputConfig, plotConfig: vortexIndicator.plotConfig, calculate: vortexIndicator.calculate },
  'williams-alligator': { overlay: true, metadata: williamsAlligatorIndicator.metadata, defaultInputs: williamsAlligatorIndicator.defaultInputs, inputConfig: williamsAlligatorIndicator.inputConfig, plotConfig: williamsAlligatorIndicator.plotConfig, calculate: williamsAlligatorIndicator.calculate },
  'williams-r': { overlay: false, metadata: williamsRIndicator.metadata, defaultInputs: williamsRIndicator.defaultInputs, inputConfig: williamsRIndicator.inputConfig, plotConfig: williamsRIndicator.plotConfig, hlineConfig: williamsRIndicator.hlineConfig, fillConfig: williamsRIndicator.fillConfig, calculate: williamsRIndicator.calculate },
  'woodies-cci': { overlay: false, metadata: woodiesCCIIndicator.metadata, defaultInputs: woodiesCCIIndicator.defaultInputs, inputConfig: woodiesCCIIndicator.inputConfig, plotConfig: woodiesCCIIndicator.plotConfig, hlineConfig: woodiesCCIIndicator.hlineConfig, fillConfig: woodiesCCIIndicator.fillConfig, calculate: woodiesCCIIndicator.calculate },
  'bb-percent-b': { overlay: false, metadata: bbPercentBIndicator.metadata, defaultInputs: bbPercentBIndicator.defaultInputs, inputConfig: bbPercentBIndicator.inputConfig, plotConfig: bbPercentBIndicator.plotConfig, hlineConfig: bbPercentBIndicator.hlineConfig, fillConfig: bbPercentBIndicator.fillConfig, calculate: bbPercentBIndicator.calculate },
  'bb-bandwidth': { overlay: false, metadata: bbBandwidthIndicator.metadata, defaultInputs: bbBandwidthIndicator.defaultInputs, inputConfig: bbBandwidthIndicator.inputConfig, plotConfig: bbBandwidthIndicator.plotConfig, calculate: bbBandwidthIndicator.calculate },
  'chaikin-mf': { overlay: false, metadata: chaikinMFIndicator.metadata, defaultInputs: chaikinMFIndicator.defaultInputs, inputConfig: chaikinMFIndicator.inputConfig, plotConfig: chaikinMFIndicator.plotConfig, hlineConfig: chaikinMFIndicator.hlineConfig, calculate: chaikinMFIndicator.calculate },
  'envelope': { overlay: true, metadata: envelopeIndicator.metadata, defaultInputs: envelopeIndicator.defaultInputs, inputConfig: envelopeIndicator.inputConfig, plotConfig: envelopeIndicator.plotConfig, calculate: envelopeIndicator.calculate },
  'price-oscillator': { overlay: false, metadata: priceOscillatorIndicator.metadata, defaultInputs: priceOscillatorIndicator.defaultInputs, inputConfig: priceOscillatorIndicator.inputConfig, plotConfig: priceOscillatorIndicator.plotConfig, hlineConfig: priceOscillatorIndicator.hlineConfig, calculate: priceOscillatorIndicator.calculate },
  'aroon': { overlay: false, metadata: aroonIndicator.metadata, defaultInputs: aroonIndicator.defaultInputs, inputConfig: aroonIndicator.inputConfig, plotConfig: aroonIndicator.plotConfig, calculate: aroonIndicator.calculate },
  'coppock-curve': { overlay: false, metadata: coppockCurveIndicator.metadata, defaultInputs: coppockCurveIndicator.defaultInputs, inputConfig: coppockCurveIndicator.inputConfig, plotConfig: coppockCurveIndicator.plotConfig, calculate: coppockCurveIndicator.calculate },
  'choppiness': { overlay: false, metadata: choppinessIndicator.metadata, defaultInputs: choppinessIndicator.defaultInputs, inputConfig: choppinessIndicator.inputConfig, plotConfig: choppinessIndicator.plotConfig, hlineConfig: choppinessIndicator.hlineConfig, fillConfig: choppinessIndicator.fillConfig, calculate: choppinessIndicator.calculate },
  'eom': { overlay: false, metadata: eomIndicator.metadata, defaultInputs: eomIndicator.defaultInputs, inputConfig: eomIndicator.inputConfig, plotConfig: eomIndicator.plotConfig, calculate: eomIndicator.calculate },
  'chaikin-osc': { overlay: false, metadata: chaikinOscIndicator.metadata, defaultInputs: chaikinOscIndicator.defaultInputs, inputConfig: chaikinOscIndicator.inputConfig, plotConfig: chaikinOscIndicator.plotConfig, hlineConfig: chaikinOscIndicator.hlineConfig, calculate: chaikinOscIndicator.calculate },
  'zigzag': { overlay: true, metadata: zigzagIndicator.metadata, defaultInputs: zigzagIndicator.defaultInputs, inputConfig: zigzagIndicator.inputConfig, plotConfig: zigzagIndicator.plotConfig, calculate: zigzagIndicator.calculate },
  'fisher-transform': { overlay: false, metadata: fisherTransformIndicator.metadata, defaultInputs: fisherTransformIndicator.defaultInputs, inputConfig: fisherTransformIndicator.inputConfig, plotConfig: fisherTransformIndicator.plotConfig, hlineConfig: fisherTransformIndicator.hlineConfig, calculate: fisherTransformIndicator.calculate },
  'trix': { overlay: false, metadata: trixIndicator.metadata, defaultInputs: trixIndicator.defaultInputs, inputConfig: trixIndicator.inputConfig, plotConfig: trixIndicator.plotConfig, hlineConfig: trixIndicator.hlineConfig, calculate: trixIndicator.calculate },
  'dmi': { overlay: false, metadata: dmiIndicator.metadata, defaultInputs: dmiIndicator.defaultInputs, inputConfig: dmiIndicator.inputConfig, plotConfig: dmiIndicator.plotConfig, calculate: dmiIndicator.calculate },
  'klinger': { overlay: false, metadata: klingerIndicator.metadata, defaultInputs: klingerIndicator.defaultInputs, inputConfig: klingerIndicator.inputConfig, plotConfig: klingerIndicator.plotConfig, calculate: klingerIndicator.calculate },
  'ultimate-osc': { overlay: false, metadata: ultimateOscIndicator.metadata, defaultInputs: ultimateOscIndicator.defaultInputs, inputConfig: ultimateOscIndicator.inputConfig, plotConfig: ultimateOscIndicator.plotConfig, calculate: ultimateOscIndicator.calculate },
  'chande-kroll-stop': { overlay: true, metadata: chandeKrollStopIndicator.metadata, defaultInputs: chandeKrollStopIndicator.defaultInputs, inputConfig: chandeKrollStopIndicator.inputConfig, plotConfig: chandeKrollStopIndicator.plotConfig, calculate: chandeKrollStopIndicator.calculate },
  'relative-volume-at-time': { overlay: false, metadata: relativeVolumeAtTimeIndicator.metadata, defaultInputs: relativeVolumeAtTimeIndicator.defaultInputs, inputConfig: relativeVolumeAtTimeIndicator.inputConfig, plotConfig: relativeVolumeAtTimeIndicator.plotConfig, hlineConfig: relativeVolumeAtTimeIndicator.hlineConfig, calculate: relativeVolumeAtTimeIndicator.calculate },
  'rci-ribbon': { overlay: false, metadata: rciRibbonIndicator.metadata, defaultInputs: rciRibbonIndicator.defaultInputs, inputConfig: rciRibbonIndicator.inputConfig, plotConfig: rciRibbonIndicator.plotConfig, hlineConfig: rciRibbonIndicator.hlineConfig, fillConfig: rciRibbonIndicator.fillConfig, calculate: rciRibbonIndicator.calculate },
  'volume-delta': { overlay: false, metadata: volumeDeltaIndicator.metadata, defaultInputs: volumeDeltaIndicator.defaultInputs, inputConfig: volumeDeltaIndicator.inputConfig, plotConfig: volumeDeltaIndicator.plotConfig, hlineConfig: volumeDeltaIndicator.hlineConfig, plotCandleConfig: volumeDeltaIndicator.plotCandleConfig, calculate: volumeDeltaIndicator.calculate },
  'cvd': { overlay: false, metadata: cumulativeVolumeDeltaIndicator.metadata, defaultInputs: cumulativeVolumeDeltaIndicator.defaultInputs, inputConfig: cumulativeVolumeDeltaIndicator.inputConfig, plotConfig: cumulativeVolumeDeltaIndicator.plotConfig, hlineConfig: cumulativeVolumeDeltaIndicator.hlineConfig, plotCandleConfig: cumulativeVolumeDeltaIndicator.plotCandleConfig, calculate: cumulativeVolumeDeltaIndicator.calculate },
  'net-volume': { overlay: false, metadata: netVolumeIndicator.metadata, defaultInputs: netVolumeIndicator.defaultInputs, inputConfig: netVolumeIndicator.inputConfig, plotConfig: netVolumeIndicator.plotConfig, hlineConfig: netVolumeIndicator.hlineConfig, calculate: netVolumeIndicator.calculate },
  'kst': { overlay: false, metadata: kstIndicator.metadata, defaultInputs: kstIndicator.defaultInputs, inputConfig: kstIndicator.inputConfig, plotConfig: kstIndicator.plotConfig, hlineConfig: kstIndicator.hlineConfig, calculate: kstIndicator.calculate },
  'connors-rsi': { overlay: false, metadata: connorsRsiIndicator.metadata, defaultInputs: connorsRsiIndicator.defaultInputs, inputConfig: connorsRsiIndicator.inputConfig, plotConfig: connorsRsiIndicator.plotConfig, hlineConfig: connorsRsiIndicator.hlineConfig, fillConfig: connorsRsiIndicator.fillConfig, calculate: connorsRsiIndicator.calculate },
  'chop-zone': { overlay: false, metadata: chopZoneIndicator.metadata, defaultInputs: chopZoneIndicator.defaultInputs, inputConfig: chopZoneIndicator.inputConfig, plotConfig: chopZoneIndicator.plotConfig, calculate: chopZoneIndicator.calculate },
  'rci': { overlay: false, metadata: rciIndicator.metadata, defaultInputs: rciIndicator.defaultInputs, inputConfig: rciIndicator.inputConfig, plotConfig: rciIndicator.plotConfig, hlineConfig: rciIndicator.hlineConfig, fillConfig: rciIndicator.fillConfig, calculate: rciIndicator.calculate },
  'rvol': { overlay: false, metadata: relativeVolatilityIndexIndicator.metadata, defaultInputs: relativeVolatilityIndexIndicator.defaultInputs, inputConfig: relativeVolatilityIndexIndicator.inputConfig, plotConfig: relativeVolatilityIndexIndicator.plotConfig, hlineConfig: relativeVolatilityIndexIndicator.hlineConfig, fillConfig: relativeVolatilityIndexIndicator.fillConfig, calculate: relativeVolatilityIndexIndicator.calculate },
  'williams-fractals': { overlay: true, metadata: williamsFractalsIndicator.metadata, defaultInputs: williamsFractalsIndicator.defaultInputs, inputConfig: williamsFractalsIndicator.inputConfig, plotConfig: williamsFractalsIndicator.plotConfig, calculate: williamsFractalsIndicator.calculate },
  'twap': { overlay: true, metadata: twapIndicator.metadata, defaultInputs: twapIndicator.defaultInputs, inputConfig: twapIndicator.inputConfig, plotConfig: twapIndicator.plotConfig, calculate: twapIndicator.calculate },
  'bb-bars': { overlay: true, metadata: bollingerBarsIndicator.metadata, defaultInputs: bollingerBarsIndicator.defaultInputs, inputConfig: bollingerBarsIndicator.inputConfig, plotConfig: bollingerBarsIndicator.plotConfig, plotCandleConfig: bollingerBarsIndicator.plotCandleConfig, calculate: bollingerBarsIndicator.calculate },
  'moon-phases': { overlay: true, metadata: moonPhasesIndicator.metadata, defaultInputs: moonPhasesIndicator.defaultInputs, inputConfig: moonPhasesIndicator.inputConfig, plotConfig: moonPhasesIndicator.plotConfig, calculate: moonPhasesIndicator.calculate },
  'aroon-oscillator': { overlay: false, metadata: aroonOscIndicator.metadata, defaultInputs: aroonOscIndicator.defaultInputs, inputConfig: aroonOscIndicator.inputConfig, plotConfig: aroonOscIndicator.plotConfig, hlineConfig: aroonOscIndicator.hlineConfig, calculate: aroonOscIndicator.calculate },
  'nvi': { overlay: false, metadata: nviIndicator.metadata, defaultInputs: nviIndicator.defaultInputs, inputConfig: nviIndicator.inputConfig, plotConfig: nviIndicator.plotConfig, calculate: nviIndicator.calculate },
  'pvi': { overlay: false, metadata: pviIndicator.metadata, defaultInputs: pviIndicator.defaultInputs, inputConfig: pviIndicator.inputConfig, plotConfig: pviIndicator.plotConfig, calculate: pviIndicator.calculate },
  'ulcer-index': { overlay: false, metadata: ulcerIndexIndicator.metadata, defaultInputs: ulcerIndexIndicator.defaultInputs, inputConfig: ulcerIndexIndicator.inputConfig, plotConfig: ulcerIndexIndicator.plotConfig, hlineConfig: ulcerIndexIndicator.hlineConfig, calculate: ulcerIndexIndicator.calculate },
  'prings-special-k': { overlay: false, metadata: pringsSpecialKIndicator.metadata, defaultInputs: pringsSpecialKIndicator.defaultInputs, inputConfig: pringsSpecialKIndicator.inputConfig, plotConfig: pringsSpecialKIndicator.plotConfig, hlineConfig: pringsSpecialKIndicator.hlineConfig, calculate: pringsSpecialKIndicator.calculate },
  'volatility-stop': { overlay: true, metadata: volatilityStopIndicator.metadata, defaultInputs: volatilityStopIndicator.defaultInputs, inputConfig: volatilityStopIndicator.inputConfig, plotConfig: volatilityStopIndicator.plotConfig, calculate: volatilityStopIndicator.calculate },
  'vwap': { overlay: true, metadata: vwapIndicator.metadata, defaultInputs: vwapIndicator.defaultInputs, inputConfig: vwapIndicator.inputConfig, plotConfig: vwapIndicator.plotConfig, calculate: vwapIndicator.calculate },
  'up-down-volume': { overlay: false, metadata: upDownVolumeIndicator.metadata, defaultInputs: upDownVolumeIndicator.defaultInputs, inputConfig: upDownVolumeIndicator.inputConfig, plotConfig: upDownVolumeIndicator.plotConfig, calculate: upDownVolumeIndicator.calculate },
  'auto-key-levels': { overlay: true, metadata: autoKeyLevelsIndicator.metadata, defaultInputs: autoKeyLevelsIndicator.defaultInputs, inputConfig: autoKeyLevelsIndicator.inputConfig, plotConfig: autoKeyLevelsIndicator.plotConfig, calculate: autoKeyLevelsIndicator.calculate },
  'auto-trend-detector': { overlay: true, metadata: autoTrendDetectorIndicator.metadata, defaultInputs: autoTrendDetectorIndicator.defaultInputs, inputConfig: autoTrendDetectorIndicator.inputConfig, plotConfig: autoTrendDetectorIndicator.plotConfig, calculate: autoTrendDetectorIndicator.calculate },
  '24-hour-volume': { overlay: false, metadata: n24HourVolumeStd.metadata, defaultInputs: n24HourVolumeStd.defaultInputs, inputConfig: n24HourVolumeStd.inputConfig, plotConfig: n24HourVolumeStd.plotConfig, requiredSymbols: n24HourVolumeStd.requiredSymbols, calculate: n24HourVolumeStd.calculate },
  'accumulation-distribution': { overlay: false, metadata: accumulationDistributionStd.metadata, defaultInputs: accumulationDistributionStd.defaultInputs, inputConfig: accumulationDistributionStd.inputConfig, plotConfig: accumulationDistributionStd.plotConfig, calculate: accumulationDistributionStd.calculate },
  'adr-bars': { overlay: false, metadata: adrBarsStd.metadata, defaultInputs: adrBarsStd.defaultInputs, inputConfig: adrBarsStd.inputConfig, plotConfig: adrBarsStd.plotConfig, hlineConfig: adrBarsStd.hlineConfig, calculate: adrBarsStd.calculate },
  'auto-fib-extension': { overlay: true, metadata: autoFibExtensionStd.metadata, defaultInputs: autoFibExtensionStd.defaultInputs, inputConfig: autoFibExtensionStd.inputConfig, plotConfig: autoFibExtensionStd.plotConfig, calculate: autoFibExtensionStd.calculate },
  'auto-fib-retracement': { overlay: true, metadata: autoFibRetracementStd.metadata, defaultInputs: autoFibRetracementStd.defaultInputs, inputConfig: autoFibRetracementStd.inputConfig, plotConfig: autoFibRetracementStd.plotConfig, calculate: autoFibRetracementStd.calculate },
  'auto-pitchfork': { overlay: true, metadata: autoPitchforkStd.metadata, defaultInputs: autoPitchforkStd.defaultInputs, inputConfig: autoPitchforkStd.inputConfig, plotConfig: autoPitchforkStd.plotConfig, calculate: autoPitchforkStd.calculate },
  'chandelier': { overlay: true, metadata: chandelierStd.metadata, defaultInputs: chandelierStd.defaultInputs, inputConfig: chandelierStd.inputConfig, plotConfig: chandelierStd.plotConfig, calculate: chandelierStd.calculate },
  'correlation-coefficient': { overlay: false, metadata: correlationCoefficientStd.metadata, defaultInputs: correlationCoefficientStd.defaultInputs, inputConfig: correlationCoefficientStd.inputConfig, plotConfig: correlationCoefficientStd.plotConfig, hlineConfig: correlationCoefficientStd.hlineConfig, requiredSymbols: correlationCoefficientStd.requiredSymbols, calculate: correlationCoefficientStd.calculate },
  'gaps': { overlay: true, metadata: gapsStd.metadata, defaultInputs: gapsStd.defaultInputs, inputConfig: gapsStd.inputConfig, plotConfig: gapsStd.plotConfig, calculate: gapsStd.calculate },
  'kama': { overlay: true, metadata: kamaStd.metadata, defaultInputs: kamaStd.defaultInputs, inputConfig: kamaStd.inputConfig, plotConfig: kamaStd.plotConfig, calculate: kamaStd.calculate },
  'linreg-channel': { overlay: true, metadata: linregChannelStd.metadata, defaultInputs: linregChannelStd.defaultInputs, inputConfig: linregChannelStd.inputConfig, plotConfig: linregChannelStd.plotConfig, calculate: linregChannelStd.calculate },
  'multi-time-period-charts': { overlay: true, metadata: multiTimePeriodChartsStd.metadata, defaultInputs: multiTimePeriodChartsStd.defaultInputs, inputConfig: multiTimePeriodChartsStd.inputConfig, plotConfig: multiTimePeriodChartsStd.plotConfig, calculate: multiTimePeriodChartsStd.calculate },
  'performance': { overlay: false, metadata: performanceStd.metadata, defaultInputs: performanceStd.defaultInputs, inputConfig: performanceStd.inputConfig, plotConfig: performanceStd.plotConfig, requiredSymbols: performanceStd.requiredSymbols, calculate: performanceStd.calculate },
  'pivot-points-high-low': { overlay: true, metadata: pivotPointsHighLowStd.metadata, defaultInputs: pivotPointsHighLowStd.defaultInputs, inputConfig: pivotPointsHighLowStd.inputConfig, plotConfig: pivotPointsHighLowStd.plotConfig, calculate: pivotPointsHighLowStd.calculate },
  'pivot-points-standard': { overlay: true, metadata: pivotPointsStandardStd.metadata, defaultInputs: pivotPointsStandardStd.defaultInputs, inputConfig: pivotPointsStandardStd.inputConfig, plotConfig: pivotPointsStandardStd.plotConfig, requiredSymbols: pivotPointsStandardStd.requiredSymbols, calculate: pivotPointsStandardStd.calculate },
  'pmo': { overlay: false, metadata: pmoStd.metadata, defaultInputs: pmoStd.defaultInputs, inputConfig: pmoStd.inputConfig, plotConfig: pmoStd.plotConfig, hlineConfig: pmoStd.hlineConfig, calculate: pmoStd.calculate },
  'rob-booker-ziv-ghost-pivots': { overlay: true, metadata: robBookerZivGhostPivotsStd.metadata, defaultInputs: robBookerZivGhostPivotsStd.defaultInputs, inputConfig: robBookerZivGhostPivotsStd.inputConfig, plotConfig: robBookerZivGhostPivotsStd.plotConfig, requiredSymbols: robBookerZivGhostPivotsStd.requiredSymbols, calculate: robBookerZivGhostPivotsStd.calculate },
  'rsi-divergence-indicator': { overlay: false, metadata: rsiDivergenceIndicatorStd.metadata, defaultInputs: rsiDivergenceIndicatorStd.defaultInputs, inputConfig: rsiDivergenceIndicatorStd.inputConfig, plotConfig: rsiDivergenceIndicatorStd.plotConfig, hlineConfig: rsiDivergenceIndicatorStd.hlineConfig, fillConfig: rsiDivergenceIndicatorStd.fillConfig, calculate: rsiDivergenceIndicatorStd.calculate },
  'seasonality': { overlay: false, metadata: seasonalityStd.metadata, defaultInputs: seasonalityStd.defaultInputs, inputConfig: seasonalityStd.inputConfig, plotConfig: seasonalityStd.plotConfig, requiredSymbols: seasonalityStd.requiredSymbols, calculate: seasonalityStd.calculate },
  'smi': { overlay: false, metadata: smiStd.metadata, defaultInputs: smiStd.defaultInputs, inputConfig: smiStd.inputConfig, plotConfig: smiStd.plotConfig, hlineConfig: smiStd.hlineConfig, fillConfig: smiStd.fillConfig, calculate: smiStd.calculate },
  'technicals': { overlay: false, metadata: technicalsStd.metadata, defaultInputs: technicalsStd.defaultInputs, inputConfig: technicalsStd.inputConfig, plotConfig: technicalsStd.plotConfig, hlineConfig: technicalsStd.hlineConfig, requiredSymbols: technicalsStd.requiredSymbols, calculate: technicalsStd.calculate },
  'trading-sessions': { overlay: true, metadata: tradingSessionsStd.metadata, defaultInputs: tradingSessionsStd.defaultInputs, inputConfig: tradingSessionsStd.inputConfig, plotConfig: tradingSessionsStd.plotConfig, calculate: tradingSessionsStd.calculate },
  'visible-average-price': { overlay: true, metadata: visibleAveragePriceStd.metadata, defaultInputs: visibleAveragePriceStd.defaultInputs, inputConfig: visibleAveragePriceStd.inputConfig, plotConfig: visibleAveragePriceStd.plotConfig, usesVisibleRange: true, calculate: visibleAveragePriceStd.calculate },
  'volume': VolumeStudy,
};

export const STUDY_MODULES = MODULES as unknown as Record<StudyId, StudyModule>;
