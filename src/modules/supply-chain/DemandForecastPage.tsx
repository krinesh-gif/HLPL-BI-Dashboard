import { PageShell } from '@/components/layout/PageShell'
import { DataTable } from '@/components/ui/DataTable'
import { formatNumber } from '@/lib/format'
import { useInventoryPlan } from './useInventoryPlan'

export function DemandForecastPage() {
  const rows = useInventoryPlan()

  return (
    <PageShell title="Demand Forecast" subtitle="3-month unit forecast per SKU" showFilters={false}>
      <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4 text-sm text-[var(--ink-2)]">
        <strong className="text-[var(--ink)]">Methodology:</strong> {rows[0]?.methodology ?? 'No sales history available yet.'}
      </div>
      <DataTable
        exportFileName="HLPL_DemandForecast"
        columns={[
          { key: 'productName', header: 'Product', accessor: (r) => r.productName },
          { key: 'avgMonthlySales', header: 'Current Monthly Run Rate', accessor: (r) => r.avgMonthlySales, align: 'right', render: (r) => formatNumber(r.avgMonthlySales) },
          { key: 'forecastM1', header: 'Forecast M1', accessor: (r) => r.forecastM1, align: 'right', render: (r) => formatNumber(r.forecastM1) },
          { key: 'forecastM2', header: 'Forecast M2', accessor: (r) => r.forecastM2, align: 'right', render: (r) => formatNumber(r.forecastM2) },
          { key: 'forecastM3', header: 'Forecast M3', accessor: (r) => r.forecastM3, align: 'right', render: (r) => formatNumber(r.forecastM3) },
        ]}
        rows={rows}
      />
    </PageShell>
  )
}
