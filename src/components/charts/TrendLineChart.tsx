import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CHART_AXIS_PROPS, CHART_COLORS, CHART_GRID_COLOR, CHART_TOOLTIP_STYLE } from './theme'

export interface SeriesDef {
  key: string
  label: string
  color?: string
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
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={CHART_GRID_COLOR} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey={xKey} {...CHART_AXIS_PROPS} />
        <YAxis
          {...CHART_AXIS_PROPS}
          axisLine={false}
          tickFormatter={(v) => (valueFormatter ? valueFormatter(v) : String(v))}
        />
        <Tooltip {...CHART_TOOLTIP_STYLE} cursor={{ stroke: CHART_GRID_COLOR, strokeWidth: 1 }} formatter={(v) => (valueFormatter ? valueFormatter(Number(v)) : String(v))} />
        {/* Two or more series always carry a legend, so identity is never colour alone. */}
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12, color: 'var(--ink-2)', paddingTop: 8 }} iconType="plainline" iconSize={14} />}
        {series.map((s, i) => (
          <Line
            key={s.key}
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
