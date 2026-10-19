// The indicator code, as one chunk loaded on demand (TD-INDICATORS §5): the catalog of the 118 indicators, the
// renderer that draws them on the chart, and the library's rule for inputs that depend on others.
export { STUDY_MODULES } from './catalog.ts';
export { IndicatorRenderer } from './vendor/render/index';
export { isInputActive } from 'oakscriptjs';
