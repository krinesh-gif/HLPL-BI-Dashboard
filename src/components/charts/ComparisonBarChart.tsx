import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CHART_AXIS_PROPS, CHART_COLORS, CHART_GRID_COLOR, CHART_TOOLTIP_STYLE } from './theme'

export function ComparisonBarChart({
  data,
  xKey,
  yKey,
  height = 280,
  valueFormatter,
  horizontal = false,
}: {
  data: Record<string, string | number>[]
  xKey: string
  yKey: string
  height?: number
  valueFormatter?: (v: number) => string
  horizontal?: boolean
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        layout={horizontal ? 'vertical' : 'horizontal'}
        margin={{ top: 8, right: 16, bottom: 0, left: horizontal ? 80 : 0 }}
      >
        <CartesianGrid stroke={CHART_GRID_COLOR} strokeDasharray="3 3" horizontal={!horizontal} vertical={horizontal} />
        {horizontal ? (
          <>
            <XAxis type="number" {...CHART_AXIS_PROPS} axisLine={false} tickFormatter={(v) => (valueFormatter ? valueFormatter(v) : String(v))} />
            <YAxis type="category" dataKey={xKey} {...CHART_AXIS_PROPS} axisLine={false} width={80} />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} {...CHART_AXIS_PROPS} />
            <YAxis {...CHART_AXIS_PROPS} axisLine={false} tickFormatter={(v) => (valueFormatter ? valueFormatter(v) : String(v))} />
          </>
        )}
        <Tooltip {...CHART_TOOLTIP_STYLE} formatter={(v) => (valueFormatter ? valueFormatter(Number(v)) : String(v))} />
        <Bar dataKey={yKey} radius={[4, 4, 4, 4]}>
          {data.map((_, i) => (
            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
