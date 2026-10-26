import { describe, expect, it } from 'vitest';
import { chartStyleSchema, DEFAULT_CHART_STYLE, salvageChartStyle } from './chart-style.ts';
import { settingsSchema } from './settings.ts';

describe('the chart settings (FD-CHARTSETTINGS)', () => {
  it('default to the chart as it was', () => {
    expect(DEFAULT_CHART_STYLE.candles).toEqual({
      prevClose: false,
      body: { visible: true, up: '#26A69A', down: '#EF5350' },
      borders: { visible: false, up: '#26A69A', down: '#EF5350' },
      wick: { visible: true, up: '#26A69A', down: '#EF5350' },
    });
    expect(DEFAULT_CHART_STYLE.precision).toBe('default');
    expect(DEFAULT_CHART_STYLE.timezone).toBeNull();
    // No grid, the theme's colours, the scales' 11 px, the library's margins, 24 bars on the right, every button shown.
    const cv = DEFAULT_CHART_STYLE.canvas;
    expect(cv.vertGrid.visible || cv.horzGrid.visible || cv.watermark.visible).toBe(false);
    expect([cv.background.top, cv.background.bottom, cv.separators, cv.crosshair.color, cv.scaleText.color, cv.scaleLines]).toEqual([null, null, null, null, null, null]);
    expect(cv.crosshair.style).toBe('dashed');
    expect(cv.crosshair.width).toBe(1);
    expect(cv.scaleText.size).toBe(11);
    expect(cv.margins).toEqual({ top: 20, bottom: 10, right: 24 });
    expect([cv.navigation, cv.paneButtons]).toEqual(['always', 'always']);
    // The legends as they were; the status line as TradingView starts it (logo, symbol, volume).
    expect(DEFAULT_CHART_STYLE.status).toMatchObject({ logo: true, title: true, titleMode: 'symbol', volume: true, values: false, indicatorTitles: true, indicatorInputs: true, indicatorValues: true, indicatorBackground: true, backgroundOpacity: 75 });
    expect(DEFAULT_CHART_STYLE.alerts.autoHideToasts).toBe(true);
    // FD-TRADESOUND: the coin sound when a trade ends, on by default.
    expect(DEFAULT_CHART_STYLE.alerts.tradeSound).toBe(true);
    // Every account starts with them.
    expect(settingsSchema.parse({}).chartStyle).toEqual(DEFAULT_CHART_STYLE);
  });

  it('fill in what a partial save leaves out and refuse what is out of range', () => {
    const s = chartStyleSchema.parse({ canvas: { vertGrid: { visible: true } }, precision: 3 });
    expect(s.canvas.vertGrid).toEqual({ visible: true, color: null, style: 'solid' });
    expect(s.canvas.horzGrid.visible).toBe(false);
    expect(s.precision).toBe(3);
    for (const bad of [
      { precision: 9 },
      { precision: 1.5 },
      { candles: { body: { up: 'red' } } },
      { canvas: { background: { top: '#fff' } } },
      { canvas: { crosshair: { style: 'wavy' } } },
      { canvas: { scaleText: { size: 9 } } },
      { canvas: { margins: { top: 41 } } },
      { canvas: { margins: { right: -1 } } },
      { canvas: { navigation: 'sometimes' } },
      { status: { backgroundOpacity: 101 } },
      { status: { titleMode: 'ticker' } },
    ]) {
      expect(chartStyleSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    // A colour with its opacity is kept as it is.
    expect(chartStyleSchema.parse({ canvas: { background: { top: '#11223380' } } }).canvas.background.top).toBe('#11223380');
  });

  it('keep the parts that still read when a stored save no longer does', () => {
    const stored = {
      candles: { body: { up: '#00FF00' } },
      precision: 42,
      status: { volume: false },
      canvas: { margins: { top: 'lots' } },
      alerts: { autoHideToasts: false },
    };
    const s = salvageChartStyle(stored);
    expect(s.candles.body.up).toBe('#00FF00');
    expect(s.precision).toBe('default');
    expect(s.status.volume).toBe(false);
    expect(s.canvas).toEqual(DEFAULT_CHART_STYLE.canvas);
    expect(s.alerts.autoHideToasts).toBe(false);
    expect(salvageChartStyle('nonsense')).toEqual(DEFAULT_CHART_STYLE);
    expect(salvageChartStyle(null)).toEqual(DEFAULT_CHART_STYLE);
  });
});
