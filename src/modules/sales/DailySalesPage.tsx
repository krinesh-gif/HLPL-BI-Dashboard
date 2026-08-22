import { useState } from 'react'
import { PageShell } from '@/components/layout/PageShell'
import { KPICard, KPIGrid } from '@/components/ui/KPICard'
import { TrendLineChart } from '@/components/charts/TrendLineChart'
import { DataTable } from '@/components/ui/DataTable'
import { useDataStore } from '@/store/dataStore'
import { formatCurrencyFull, formatDate, formatNumber } from '@/lib/format'
import { useDailySales } from './useDailySales'

export function DailySalesPage() {
  const { skuMaster } = useDataStore()
  const [sku, setSku] = useState(skuMaster[0]?.sku ?? '')
  const d = useDailySales(sku)

  const chartData = d.rows.map((r) => ({
    date: formatDate(r.date).replace(/, \d{4}$/, ''),
    units: r.units,
    movingAvg7: r.movingAvg7 !== null ? Math.round(r.movingAvg7) : null,
  }))

  return (
    <PageShell title="Daily Sales" subtitle="Day-level trend, growth, and run rate per SKU" showFilters={false}>
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-slate-500">SKU</label>
        <select
          value={sku}
          onChange={(e) => setSku(e.target.value)}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
        >
          {skuMaster.map((s) => (
            <option key={s.sku} value={s.sku}>
              {s.productName}
            </option>
          ))}
        </select>
      </div>

      <KPIGrid>
        <KPICard label="Current Month Run Rate (Units)" value={formatNumber(d.runRateUnits)} />
        <KPICard label="Days Tracked" value={String(d.rows.length)} />
      </KPIGrid>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-700">Daily Units with 7-Day Moving Average</h3>
        <TrendLineChart
          data={chartData}
          xKey="date"
          series={[
            { key: 'units', label: 'Daily Units' },
            { key: 'movingAvg7', label: '7-Day Avg' },
          ]}
        />
      </div>

      <DataTable
        exportFileName={`HLPL_DailySales_${sku}`}
        columns={[
          { key: 'date', header: 'Date', accessor: (r) => r.date, render: (r) => formatDate(r.date) },
          { key: 'units', header: 'Units', accessor: (r) => r.units, align: 'right', render: (r) => formatNumber(r.units) },
          { key: 'revenue', header: 'Revenue', accessor: (r) => r.revenue, align: 'right', render: (r) => formatCurrencyFull(r.revenue) },
          { key: 'orders', header: 'Orders', accessor: (r) => r.orders, align: 'right' },
          {
            key: 'dodGrowthPct',
            header: 'DoD Growth',
            accessor: (r) => r.dodGrowthPct ?? 0,
            align: 'right',
            render: (r) => (r.dodGrowthPct === null ? '—' : `${r.dodGrowthPct >= 0 ? '▲' : '▼'} ${Math.abs(r.dodGrowthPct).toFixed(1)}%`),
          },
        ]}
        rows={[...d.rows].reverse()}
      />
    </PageShell>
  )
}
