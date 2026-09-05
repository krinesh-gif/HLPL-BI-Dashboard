import { useMemo } from 'react'
import { PageShell } from '@/components/layout/PageShell'
import { TrendLineChart } from '@/components/charts/TrendLineChart'
import { DataTable } from '@/components/ui/DataTable'
import { useDataStore } from '@/store/dataStore'
import { useFilterStore } from '@/store/filterStore'
import { BUSINESS_CHANNEL_IDS } from '@/config/channels'
import { addMonths, formatCurrencyFull, formatNumber, formatPercent, monthLabel } from '@/lib/format'
import { growthPct } from '@/engine/sales'
import { asp, netSalesForMonth, rtoPct } from '@/engine/netSales'

const MONTHS_SHOWN = 12

export function MonthlySalesPage() {
  const { salesRecords, flipkartFacts, amazonUsaFacts, meeshoFacts, myntraFacts } = useDataStore()
  const { month } = useFilterStore()

  const rows = useMemo(() => {
    const facts = { flipkartFacts, amazonUsaFacts, meeshoFacts, myntraFacts }
    const channelIds = BUSINESS_CHANNEL_IDS
    const months = Array.from({ length: MONTHS_SHOWN }, (_, i) => addMonths(month, i - (MONTHS_SHOWN - 1)))

    const figures = months.map((m) => netSalesForMonth(salesRecords, m, facts, channelIds))

    return months.map((m, i) => {
      const figure = figures[i]
      const previous = i > 0 ? figures[i - 1] : null
      const currentAsp = asp(figure)
      const previousAsp = previous ? asp(previous) : null
      return {
        month: m,
        label: monthLabel(m),
        netSales: figure.netSales,
        units: figure.units,
        orders: figure.orders,
        asp: currentAsp,
        aspGrowthPct: currentAsp !== null && previousAsp !== null ? growthPct(currentAsp, previousAsp) : null,
        rtoPct: rtoPct(figure),
        growthPct: previous ? growthPct(figure.netSales, previous.netSales) : null,
      }
    })
  }, [salesRecords, flipkartFacts, amazonUsaFacts, meeshoFacts, myntraFacts, month])

  return (
    <PageShell title="Monthly Sales" subtitle="Trailing 12-month revenue, units, orders and ASP" showFilters={false}>
      <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
        <h3 className="mb-2 text-sm font-semibold text-[var(--ink-2)]">Net Sales Trend</h3>
        <TrendLineChart data={rows} xKey="label" series={[{ key: 'netSales', label: 'Net Sales' }]} valueFormatter={formatCurrencyFull} />
      </div>
      <DataTable
        exportFileName="HLPL_MonthlySales"
        searchable={false}
        columns={[
          { key: 'label', header: 'Month', accessor: (r) => r.label },
          { key: 'netSales', header: 'Net Sales', accessor: (r) => r.netSales, align: 'right', render: (r) => formatCurrencyFull(r.netSales) },
          { key: 'units', header: 'Units', accessor: (r) => r.units, align: 'right', render: (r) => formatNumber(r.units) },
          { key: 'orders', header: 'Orders', accessor: (r) => r.orders, align: 'right', render: (r) => formatNumber(r.orders) },
          {
            key: 'asp',
            header: 'ASP',
            accessor: (r) => r.asp ?? 0,
            align: 'right',
            render: (r) => (r.asp === null ? '—' : formatCurrencyFull(r.asp)),
          },
          {
            key: 'aspGrowthPct',
            header: 'ASP MoM',
            accessor: (r) => r.aspGrowthPct ?? 0,
            align: 'right',
            render: (r) => (r.aspGrowthPct === null ? '—' : `${r.aspGrowthPct >= 0 ? '▲' : '▼'} ${formatPercent(Math.abs(r.aspGrowthPct))}`),
          },
          {
            key: 'rtoPct',
            header: 'RTO %',
            accessor: (r) => r.rtoPct ?? 0,
            align: 'right',
            render: (r) => (r.rtoPct === null ? '—' : formatPercent(r.rtoPct)),
          },
          {
            key: 'growthPct',
            header: 'MoM Growth',
            accessor: (r) => r.growthPct ?? 0,
            align: 'right',
            render: (r) => (r.growthPct === null ? '—' : `${r.growthPct >= 0 ? '▲' : '▼'} ${formatPercent(Math.abs(r.growthPct))}`),
          },
        ]}
        rows={rows}
      />
    </PageShell>
  )
}
