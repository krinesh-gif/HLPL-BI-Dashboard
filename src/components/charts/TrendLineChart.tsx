import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CHART_AXIS_COLOR, CHART_COLORS, CHART_GRID_COLOR } from './theme'

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
        <XAxis dataKey={xKey} tick={{ fontSize: 12, fill: CHART_AXIS_COLOR }} axisLine={{ stroke: CHART_GRID_COLOR }} tickLine={false} />
        <YAxis
          tick={{ fontSize: 12, fill: CHART_AXIS_COLOR }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => (valueFormatter ? valueFormatter(v) : String(v))}
        />
        <Tooltip formatter={(v) => (valueFormatter ? valueFormatter(Number(v)) : String(v))} />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {series.map((s, i) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color ?? CHART_COLORS[i % CHART_COLORS.length]}
            strokeWidth={2}
            dot={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
