/**
 * The chart layer's half of the design tokens.
 *
 * Every value here is a CSS variable rather than a hex literal, so a chart
 * repaints with the theme instead of staying light while the page goes dark.
 * The eight series slots are a validated categorical order — assigned in this
 * fixed order and never cycled — so a ninth series folds into "Other" rather
 * than inventing a colour. Re-run the palette validator before changing any of
 * them; the order is what keeps adjacent pairs apart for colour-blind readers,
 * not decoration.
 */
export const CHART_COLORS = [
  'var(--series-1)', // blue
  'var(--series-2)', // orange
  'var(--series-3)', // aqua
  'var(--series-4)', // yellow
  'var(--series-5)', // magenta
  'var(--series-6)', // green
  'var(--series-7)', // violet
  'var(--series-8)', // red
]

export const CHART_GRID_COLOR = 'var(--grid)'
export const CHART_AXIS_COLOR = 'var(--ink-3)'
export const CHART_BASELINE_COLOR = 'var(--axis)'

/** Status colours, kept apart from the series slots so a state can never be
 * mistaken for a series. Always paired with a word or an icon. */
export const CHART_STATUS = {
  good: 'var(--good)',
  warning: 'var(--warning)',
  serious: 'var(--serious)',
  critical: 'var(--critical)',
}

/** Recharts' tooltip, in the app's surface rather than its own white box. */
export const CHART_TOOLTIP_STYLE = {
  contentStyle: {
    background: 'var(--surface)',
    border: '1px solid var(--line)',
    borderRadius: 12,
    boxShadow: 'var(--shadow-pop)',
    fontSize: 12,
    color: 'var(--ink)',
  },
  labelStyle: { color: 'var(--ink-2)', fontWeight: 600, marginBottom: 4 },
  itemStyle: { color: 'var(--ink)' },
  cursor: { fill: 'var(--surface-hover)' },
}

/** Axis props shared by every chart, so ticks are recessive everywhere. */
export const CHART_AXIS_PROPS = {
  tick: { fontSize: 11, fill: 'var(--ink-3)' },
  axisLine: { stroke: 'var(--axis)' },
  tickLine: false,
} as const
