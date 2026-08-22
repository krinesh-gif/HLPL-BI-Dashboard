import { useMemo } from 'react'
import { PageShell } from '@/components/layout/PageShell'
import { ComparisonBarChart } from '@/components/charts/ComparisonBarChart'
import { DataTable } from '@/components/ui/DataTable'
import { useDataStore } from '@/store/dataStore'
import { useFilterStore } from '@/store/filterStore'
import { CHANNELS } from '@/config/channels'
import { addMonths, formatCurrencyCompact, formatCurrencyFull, formatNumber } from '@/lib/format'
import { filterByChannel, filterByMonth, growthPct, sumFacts } from '@/engine/sales'

export function ChannelSalesPage() {
  const { salesRecords } = useDataStore()
  const { month } = useFilterStore()

  const rows = useMemo(() => {
    const previousMonth = addMonths(month, -1)
    return CHANNELS.map((c) => {
      const channelRecords = filterByChannel(salesRecords, c.id)
      const current = sumFacts(filterByMonth(channelRecords, month))
      const previous = sumFacts(filterByMonth(channelRecords, previousMonth))
      return {
        channel: c.label,
        netSales: current.netSales,
        units: current.quantity,
        orders: current.orders,
        growth: growthPct(current.netSales, previous.netSales),
      }
    }).filter((r) => r.netSales > 0)
  }, [salesRecords, month])

  return (
    <PageShell title="Channel Sales" subtitle="Revenue and unit comparison across channels for the selected month" showFilters={false}>
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-700">Net Sales by Channel</h3>
        <ComparisonBarChart
          data={rows.map((r) => ({ name: r.channel, value: r.netSales }))}
          xKey="name"
          yKey="value"
          horizontal
          valueFormatter={(v) => formatCurrencyCompact(v)}
        />
      </div>
      <DataTable
        exportFileName="HLPL_ChannelSales"
        searchable={false}
        columns={[
          { key: 'channel', header: 'Channel', accessor: (r) => r.channel },
          { key: 'netSales', header: 'Net Sales', accessor: (r) => r.netSales, align: 'right', render: (r) => formatCurrencyFull(r.netSales) },
          { key: 'units', header: 'Units', accessor: (r) => r.units, align: 'right', render: (r) => formatNumber(r.units) },
          { key: 'orders', header: 'Orders', accessor: (r) => r.orders, align: 'right', render: (r) => formatNumber(r.orders) },
          {
            key: 'growth',
            header: 'MoM Growth',
            accessor: (r) => r.growth ?? 0,
            align: 'right',
            render: (r) => (r.growth === null ? '—' : `${r.growth >= 0 ? '▲' : '▼'} ${Math.abs(r.growth).toFixed(1)}%`),
          },
        ]}
        rows={rows}
      />
    </PageShell>
  )
}
