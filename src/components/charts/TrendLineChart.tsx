import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
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
}: {
  data: Record<string, string | number | null>[]
  xKey: string
  series: SeriesDef[]
  height?: number
  valueFormatter?: (v: number) => string
}) {
  const format = (s: SeriesDef | undefined, v: number) =>
    (s?.valueFormatter ?? valueFormatter)?.(v) ?? String(v)
  const rightSeries = series.filter((s) => s.axis === 'right')
  const leftSeries = series.filter((s) => s.axis !== 'right')

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: rightSeries.length > 0 ? 8 : 16, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={CHART_GRID_COLOR} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey={xKey} {...CHART_AXIS_PROPS} />
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
        {series.map((s, i) => (
          <Line
            key={s.key}
            yAxisId={s.axis === 'right' ? 'right' : 'left'}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color ?? CHART_COLORS[i % CHART_COLORS.length]}
            strokeWidth={2}
            dot={false}
            // Big enough to hit comfortably, ringed in the surface so it stays
            // legible where lines cross.
            activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--surface)' }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
