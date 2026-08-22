import { PageShell } from '@/components/layout/PageShell'
import { DataTable } from '@/components/ui/DataTable'
import { formatDate, formatNumber } from '@/lib/format'
import { nextDownloadFileName, toMonthYearSuffix } from '@/lib/downloadNaming'
import { downloadCsv } from '@/lib/exportCsv'
import { useDataStore } from '@/store/dataStore'
import { useInventoryPlan } from './useInventoryPlan'
import type { RiskStatus } from '@/engine/forecast'

const PRIORITY: Record<RiskStatus, 'High' | 'Medium' | 'Low'> = {
  BUY_NOW: 'High',
  STOCK_OUT_RISK: 'High',
  PLAN_PURCHASE: 'Medium',
  HEALTHY: 'Low',
  EXCESS_INVENTORY: 'Low',
}

const PRIORITY_STYLE: Record<'High' | 'Medium' | 'Low', string> = {
  High: 'bg-rose-100 text-rose-700',
  Medium: 'bg-amber-100 text-amber-700',
  Low: 'bg-emerald-100 text-emerald-700',
}

export function ProcurementPlanningPage() {
  const inventoryRows = useInventoryPlan()
  const currentMonth = useDataStore((s) => s.inventorySnapshots[0]?.asOfDate.slice(0, 7)) ?? new Date().toISOString().slice(0, 7)

  const rows = inventoryRows
    .map((r) => ({
      sku: r.sku,
      productName: r.productName,
      currentStock: r.currentStock,
      forecastDemand: r.forecastM1,
      requiredStock: r.forecastM1 + r.safetyStock,
      recommendedPurchase: r.recommendedPurchaseQty,
      purchaseDate: r.recommendedPurchaseDate,
      priority: PRIORITY[r.riskStatus],
    }))
    .filter((r) => r.recommendedPurchase > 0)
    .sort((a, b) => (a.priority === b.priority ? b.recommendedPurchase - a.recommendedPurchase : a.priority === 'High' ? -1 : 1))

  function handleExport() {
    const fileName = nextDownloadFileName('Procurement', toMonthYearSuffix(currentMonth))
    const header = 'SKU,Product,Current Stock,Forecast Demand,Required Stock,Recommended Purchase,Purchase Date,Priority'
    const lines = rows.map((r) =>
      [r.sku, `"${r.productName}"`, r.currentStock, Math.round(r.forecastDemand), Math.round(r.requiredStock), r.recommendedPurchase, r.purchaseDate ?? '', r.priority].join(','),
    )
    downloadCsv(fileName, [header, ...lines].join('\n'))
  }

  return (
    <PageShell title="Procurement Planning" subtitle="Ready-to-share purchase recommendations for the supply chain team" showFilters={false}>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleExport}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          Export Procurement Report
        </button>
      </div>
      <DataTable
        exportFileName="HLPL_Procurement"
        columns={[
          { key: 'sku', header: 'SKU', accessor: (r) => r.sku },
          { key: 'productName', header: 'Product', accessor: (r) => r.productName },
          { key: 'currentStock', header: 'Current Stock', accessor: (r) => r.currentStock, align: 'right', render: (r) => formatNumber(r.currentStock) },
          { key: 'forecastDemand', header: 'Forecast Demand', accessor: (r) => r.forecastDemand, align: 'right', render: (r) => formatNumber(r.forecastDemand) },
          { key: 'requiredStock', header: 'Required Stock', accessor: (r) => r.requiredStock, align: 'right', render: (r) => formatNumber(r.requiredStock) },
          { key: 'recommendedPurchase', header: 'Recommended Purchase', accessor: (r) => r.recommendedPurchase, align: 'right', render: (r) => formatNumber(r.recommendedPurchase) },
          { key: 'purchaseDate', header: 'Purchase Date', accessor: (r) => r.purchaseDate ?? '', render: (r) => (r.purchaseDate ? formatDate(r.purchaseDate) : 'Immediately') },
          {
            key: 'priority',
            header: 'Priority',
            accessor: (r) => r.priority,
            render: (r) => <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${PRIORITY_STYLE[r.priority]}`}>{r.priority}</span>,
          },
        ]}
        rows={rows}
        searchable={false}
      />
    </PageShell>
  )
}
