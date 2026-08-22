import { PageShell } from '@/components/layout/PageShell'
import { KPICard, KPIGrid } from '@/components/ui/KPICard'
import { DataTable } from '@/components/ui/DataTable'
import { formatCurrencyCompact, formatNumber } from '@/lib/format'
import { useInventoryPlan } from './useInventoryPlan'
import type { RiskStatus } from '@/engine/forecast'

const RISK_STYLE: Record<RiskStatus, string> = {
  BUY_NOW: 'bg-rose-100 text-rose-700',
  STOCK_OUT_RISK: 'bg-rose-100 text-rose-700',
  PLAN_PURCHASE: 'bg-amber-100 text-amber-700',
  HEALTHY: 'bg-emerald-100 text-emerald-700',
  EXCESS_INVENTORY: 'bg-sky-100 text-sky-700',
}

const RISK_LABEL: Record<RiskStatus, string> = {
  BUY_NOW: 'Buy Now',
  STOCK_OUT_RISK: 'Stock-Out Risk',
  PLAN_PURCHASE: 'Plan Purchase',
  HEALTHY: 'Healthy',
  EXCESS_INVENTORY: 'Excess Inventory',
}

export function InventoryDashboardPage() {
  const rows = useInventoryPlan()

  const inventoryValue = rows.reduce((sum, r) => sum + r.currentStock * r.cogs, 0)
  const riskCount = rows.filter((r) => r.riskStatus === 'STOCK_OUT_RISK' || r.riskStatus === 'BUY_NOW').length
  const excessCount = rows.filter((r) => r.riskStatus === 'EXCESS_INVENTORY').length
  const avgCoverage = rows.length > 0 ? rows.reduce((s, r) => s + (Number.isFinite(r.stockCoverageDays) ? r.stockCoverageDays : 0), 0) / rows.length : 0

  return (
    <PageShell title="Inventory Dashboard" subtitle="Current stock position and risk status by SKU" showFilters={false}>
      <KPIGrid>
        <KPICard label="Inventory Value" value={formatCurrencyCompact(inventoryValue)} />
        <KPICard label="Avg Stock Coverage" value={`${Math.round(avgCoverage)} days`} />
        <KPICard label="Stock-Out Risk SKUs" value={String(riskCount)} tone={riskCount > 0 ? 'bad' : 'neutral'} />
        <KPICard label="Excess Inventory SKUs" value={String(excessCount)} tone={excessCount > 0 ? 'bad' : 'neutral'} />
      </KPIGrid>

      <DataTable
        exportFileName="HLPL_InventoryDashboard"
        columns={[
          { key: 'productName', header: 'Product', accessor: (r) => r.productName },
          { key: 'currentStock', header: 'Current Stock', accessor: (r) => r.currentStock, align: 'right', render: (r) => formatNumber(r.currentStock) },
          { key: 'avgMonthlySales', header: 'Avg Monthly Sales', accessor: (r) => r.avgMonthlySales, align: 'right', render: (r) => formatNumber(r.avgMonthlySales) },
          {
            key: 'stockCoverageDays',
            header: 'Coverage',
            accessor: (r) => (Number.isFinite(r.stockCoverageDays) ? r.stockCoverageDays : 9999),
            align: 'right',
            render: (r) => (Number.isFinite(r.stockCoverageDays) ? `${Math.round(r.stockCoverageDays)} days` : '—'),
          },
          {
            key: 'riskStatus',
            header: 'Risk Status',
            accessor: (r) => r.riskStatus,
            render: (r) => <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${RISK_STYLE[r.riskStatus]}`}>{RISK_LABEL[r.riskStatus]}</span>,
          },
        ]}
        rows={rows}
      />
    </PageShell>
  )
}
