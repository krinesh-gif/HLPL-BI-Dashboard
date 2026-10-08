import { CartesianGrid, LabelList, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CHART_AXIS_PROPS, CHART_COLORS, CHART_GRID_COLOR, CHART_TOOLTIP_STYLE } from './theme'

export interface SeriesDef {
  key: string
  label: string
  color?: string
  /**
   * Which scale this series is measured on.
   *
   * Rupees and unit counts share no scale — ₹36 lakh and 3,000 units on one
   * axis renders the units as a flat line along the bottom. A series on the
   * right gets its own axis and its own formatter, so both can be read at
   * their own magnitude on the same set of months.
   */
  axis?: 'left' | 'right'
  /** Formats this series' axis and tooltip. Falls back to the chart's. */
  valueFormatter?: (v: number) => string
}

export function TrendLineChart({
  data,
  xKey,
  series,
  height = 280,
  valueFormatter,
  showValues = false,
}: {
  data: Record<string, string | number | null>[]
  xKey: string
  series: SeriesDef[]
  height?: number
  valueFormatter?: (v: number) => string
  /**
   * Prints every point's figure above it, instead of one at a time under the
   * pointer.
   *
   * A tooltip is a fine way to read one month and a poor way to read six: the
   * reader has to remember what the last one said while hovering the next. It
   * also disappears when the chart is copied as an image, which is how these
   * charts reach a group chat — a picture of a line with no numbers on it is
   * not a figure anyone can act on.
   *
   * Only where the labels fit. Past twelve points they sit on top of each
   * other and the chart reads worse with them than without, so the request is
   * ignored rather than honoured into illegibility.
   */
  showValues?: boolean
}) {
  const format = (s: SeriesDef | undefined, v: number) =>
    (s?.valueFormatter ?? valueFormatter)?.(v) ?? String(v)
  const rightSeries = series.filter((s) => s.axis === 'right')
  const leftSeries = series.filter((s) => s.axis !== 'right')
  const labelled = showValues && data.length <= 12

  return (
    <ResponsiveContainer width="100%" height={height}>
      {/* Room above the line for the labels, so the highest month is not
          clipped by the top of the plot. */}
      <LineChart data={data} margin={{ top: labelled ? 26 : 8, right: labelled ? 28 : rightSeries.length > 0 ? 8 : 16, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={CHART_GRID_COLOR} strokeDasharray="3 3" vertical={false} />
        {/* A label is centred over its point, so the first and last of them
            hang half off the plot — the last month's figure, which is the one
            being read, loses its final digits. Holding the end points in off
            the edges is what makes room for them. */}
        <XAxis dataKey={xKey} {...CHART_AXIS_PROPS} padding={labelled ? { left: 30, right: 30 } : undefined} />
        <YAxis
          yAxisId="left"
          {...CHART_AXIS_PROPS}
          axisLine={false}
          tickFormatter={(v) => format(leftSeries[0], v)}
        />
        {rightSeries.length > 0 && (
          <YAxis
            yAxisId="right"
            orientation="right"
            {...CHART_AXIS_PROPS}
            axisLine={false}
            tickFormatter={(v) => format(rightSeries[0], v)}
          />
        )}
        <Tooltip
          {...CHART_TOOLTIP_STYLE}
          cursor={{ stroke: CHART_GRID_COLOR, strokeWidth: 1 }}
          formatter={(v, name) => format(series.find((s) => s.label === name), Number(v))}
        />
        {/* Two or more series always carry a legend, so identity is never colour alone. */}
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12, color: 'var(--ink-2)', paddingTop: 8 }} iconType="plainline" iconSize={14} />}
        {series.map((s, i) => {
          const colour = s.color ?? CHART_COLORS[i % CHART_COLORS.length]
          return (
            <Line
              key={s.key}
              yAxisId={s.axis === 'right' ? 'right' : 'left'}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={colour}
              strokeWidth={2}
              // A labelled point gets a dot, so the figure above it is clearly
              // the figure for that month and not for the space between two.
              dot={labelled ? { r: 3, strokeWidth: 0, fill: colour } : false}
              // Big enough to hit comfortably, ringed in the surface so it stays
              // legible where lines cross.
              activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--surface)' }}
              // No draw-on animation, for the same reason the bars have none: it
              // is motion nobody asked for, it delays the figure being readable
              // on every filter change, and a line that draws itself over half a
              // second cannot be captured or printed.
              isAnimationActive={false}
            >
              {labelled && (
                <LabelList
                  dataKey={s.key}
                  position="top"
                  offset={10}
                  fontSize={11}
                  fontWeight={600}
                  fill="var(--ink-2)"
                  // A month with no figure is left blank rather than printed
                  // as 0 — the two are different statements.
                  formatter={(v) => (v === null || v === undefined || v === '' ? '' : format(s, Number(v)))}
                />
              )}
            </Line>
          )
        })}
      </LineChart>
    </ResponsiveContainer>
  )
}
