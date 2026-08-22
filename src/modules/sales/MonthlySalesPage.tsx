import { useMemo } from 'react'
import { PageShell } from '@/components/layout/PageShell'
import { TrendLineChart } from '@/components/charts/TrendLineChart'
import { DataTable } from '@/components/ui/DataTable'
import { useDataStore } from '@/store/dataStore'
import { useFilterStore } from '@/store/filterStore'
import { addMonths, formatCurrencyFull, formatNumber, monthLabel } from '@/lib/format'
import { filterByMonth, growthPct, sumFacts } from '@/engine/sales'

const MONTHS_SHOWN = 12

export function MonthlySalesPage() {
  const { salesRecords } = useDataStore()
  const { month } = useFilterStore()

  const rows = useMemo(() => {
    const months = Array.from({ length: MONTHS_SHOWN }).map((_, i) => addMonths(month, i - (MONTHS_SHOWN - 1)))
    return months.map((m, i) => {
      const facts = sumFacts(filterByMonth(salesRecords, m))
      const prevFacts = i > 0 ? sumFacts(filterByMonth(salesRecords, months[i - 1])) : null
      return {
        month: m,
        label: monthLabel(m),
        netSales: facts.netSales,
        units: facts.quantity,
        orders: facts.orders,
        growthPct: prevFacts ? growthPct(facts.netSales, prevFacts.netSales) : null,
      }
    })
  }, [salesRecords, month])

  return (
    <PageShell title="Monthly Sales" subtitle="Trailing 12-month revenue, units, and orders" showFilters={false}>
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-700">Net Sales Trend</h3>
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
            key: 'growthPct',
            header: 'MoM Growth',
            accessor: (r) => r.growthPct ?? 0,
            align: 'right',
            render: (r) => (r.growthPct === null ? '—' : `${r.growthPct >= 0 ? '▲' : '▼'} ${Math.abs(r.growthPct).toFixed(1)}%`),
          },
        ]}
        rows={rows}
      />
    </PageShell>
  )
}
