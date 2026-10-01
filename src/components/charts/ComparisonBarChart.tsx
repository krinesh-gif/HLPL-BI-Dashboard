import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CHART_AXIS_PROPS, CHART_COLORS, CHART_GRID_COLOR, CHART_TOOLTIP_STYLE } from './theme'

/**
 * Roughly how wide one character of the 11px tick font is.
 *
 * Deliberately an estimate. Measuring text properly means a canvas and a
 * re-render per resize, and the cost of being a little out here is a label
 * ending slightly early — against a label that silently overlaps the one above
 * it, which is what happens when nothing truncates at all.
 */
const TICK_CHAR_PX = 6.2

/** The room one horizontal bar needs before its label meets its neighbour's. */
const ROW_HEIGHT = 34

/**
 * Cuts out of the middle, not off the end.
 *
 * These labels are product names, and a catalogue's names share their opening
 * words — every one of ours starts "Aravi Organic". Trimming the tail turns
 * eight different products into eight identical labels, while what actually
 * tells them apart, the variant and the size, is exactly what sits at the end.
 */
/**
 * Keeps the front and cuts the end.
 *
 * Tried keeping both ends first, on the reasoning that the size at the back
 * tells variants apart. Rendering the real catalogue showed the opposite: the
 * word that separates two products arrives early — Tinted Beetroot against
 * Tinted Cocoa — and holding the tail back spent the budget that word needed,
 * so three different lip balms all printed as the same label. Cutting the end
 * keeps every one of the owner's top ten distinct.
 */
function truncate(text: string, widthPx: number): string {
  const max = Math.max(8, Math.floor(widthPx / TICK_CHAR_PX))
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
}

/**
 * A category label on one line, cut to the width it has.
 *
 * Recharts' own tick wraps a long string onto as many lines as it needs and
 * does not grow the row to fit, so ten product names in a 280px chart printed
 * on top of one another and none of them could be read. The full name stays
 * reachable: it is on the bar's tooltip, and on the label's own title.
 */
function CategoryTick({
  x, y, payload, axisWidth,
}: {
  x?: number
  y?: number
  payload?: { value?: string | number }
  axisWidth: number
}) {
  const label = String(payload?.value ?? '')
  const shown = truncate(label, axisWidth - 12)
  return (
    <text x={x} y={y} dy={4} textAnchor="end" fontSize={11} fill="var(--ink-3)">
      <title>{label}</title>
      {shown}
    </text>
  )
}

export function ComparisonBarChart({
  data,
  xKey,
  yKey,
  height = 280,
  valueFormatter,
  horizontal = false,
  categoryWidth = 240,
}: {
  data: Record<string, string | number>[]
  xKey: string
  yKey: string
  height?: number
  valueFormatter?: (v: number) => string
  horizontal?: boolean
  /** How much room the category labels get. Wider suits product names, narrower
   * suits months — the chart cannot tell which it has been given. */
  categoryWidth?: number
}) {
  // A horizontal chart grows with its rows. Fixed height meant that asking for
  // the top 20 of anything made every label unreadable, so the control that
  // chose 20 could not be used.
  const chartHeight = horizontal ? Math.max(height, data.length * ROW_HEIGHT + 48) : height

  return (
    <ResponsiveContainer width="100%" height={chartHeight}>
      <BarChart
        data={data}
        layout={horizontal ? 'vertical' : 'horizontal'}
        margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
      >
        <CartesianGrid stroke={CHART_GRID_COLOR} strokeDasharray="3 3" horizontal={!horizontal} vertical={horizontal} />
        {horizontal ? (
          <>
            <XAxis type="number" {...CHART_AXIS_PROPS} tickFormatter={(v) => (valueFormatter ? valueFormatter(v) : String(v))} />
            <YAxis
              type="category"
              dataKey={xKey}
              {...CHART_AXIS_PROPS}
              width={categoryWidth}
              // Every row gets its label. Letting recharts thin them out hides
              // the name of a bar that is still on screen.
              interval={0}
              tick={<CategoryTick axisWidth={categoryWidth} />}
            />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} {...CHART_AXIS_PROPS} />
            <YAxis {...CHART_AXIS_PROPS} tickFormatter={(v) => (valueFormatter ? valueFormatter(v) : String(v))} />
          </>
        )}
        <Tooltip {...CHART_TOOLTIP_STYLE} formatter={(v) => (valueFormatter ? valueFormatter(Number(v)) : String(v))} />
        {/* No grow-in animation. It is motion nobody asked for, it delays the
            figure being readable on every filter change, and a chart that
            draws itself over half a second cannot be captured or printed. */}
        <Bar dataKey={yKey} radius={[4, 4, 4, 4]} isAnimationActive={false}>
          {data.map((_, i) => (
            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
