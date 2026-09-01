import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts'
import { CHART_AXIS_PROPS, CHART_COLORS, CHART_GRID_COLOR, CHART_TOOLTIP_STYLE } from './theme'

export interface ScatterPoint {
  x: number
  y: number
  label: string
}

export function CorrelationScatterChart({
  data,
  xLabel,
  yLabel,
  height = 300,
}: {
  data: ScatterPoint[]
  xLabel: string
  yLabel: string
  height?: number
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
        <CartesianGrid stroke={CHART_GRID_COLOR} strokeDasharray="3 3" />
        <XAxis type="number" dataKey="x" name={xLabel} {...CHART_AXIS_PROPS} />
        <YAxis type="number" dataKey="y" name={yLabel} {...CHART_AXIS_PROPS} axisLine={false} />
        <ZAxis range={[80, 80]} />
        <Tooltip
          {...CHART_TOOLTIP_STYLE}
          cursor={{ strokeDasharray: '3 3' }}
          formatter={(value, name) => [String(value), String(name)]}
          labelFormatter={() => ''}
        />
        <Scatter data={data} fill={CHART_COLORS[0]} />
      </ScatterChart>
    </ResponsiveContainer>
  )
}
