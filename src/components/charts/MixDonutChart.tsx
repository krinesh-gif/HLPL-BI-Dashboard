import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { CHART_COLORS, CHART_TOOLTIP_STYLE } from './theme'

export function MixDonutChart({
  data,
  height = 260,
  valueFormatter,
}: {
  data: { name: string; value: number }[]
  height?: number
  valueFormatter?: (v: number) => string
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="82%" paddingAngle={2}>
          {data.map((_, i) => (
            // A ring in the surface colour keeps neighbouring segments apart
            // without a border colour of their own.
            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} stroke="var(--surface)" strokeWidth={2} />
          ))}
        </Pie>
        <Tooltip {...CHART_TOOLTIP_STYLE} formatter={(v) => (valueFormatter ? valueFormatter(Number(v)) : String(v))} />
        <Legend wrapperStyle={{ fontSize: 12, color: 'var(--ink-2)' }} iconType="circle" iconSize={9} />
      </PieChart>
    </ResponsiveContainer>
  )
}
