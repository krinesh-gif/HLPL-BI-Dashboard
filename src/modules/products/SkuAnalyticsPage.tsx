import { PageShell } from '@/components/layout/PageShell'
import { DataTable } from '@/components/ui/DataTable'
import { formatCurrencyFull, formatNumber } from '@/lib/format'
import { useFilterStore } from '@/store/filterStore'
import { useSkuAnalytics, type SkuGrowthBucket } from './useSkuAnalytics'

const BUCKET_STYLE: Record<SkuGrowthBucket, string> = {
  'fast-growing': 'bg-emerald-100 text-emerald-700',
  stable: 'bg-slate-100 text-slate-600',
  declining: 'bg-amber-100 text-amber-700',
  'high-volume-declining': 'bg-rose-100 text-rose-700',
  'low-volume-high-growth': 'bg-sky-100 text-sky-700',
  'zero-sales': 'bg-slate-200 text-slate-500',
}

const BUCKET_LABEL: Record<SkuGrowthBucket, string> = {
  'fast-growing': 'Fast Growing',
  stable: 'Stable',
  declining: 'Declining',
  'high-volume-declining': 'High-Volume Declining',
  'low-volume-high-growth': 'Low-Volume High-Growth',
  'zero-sales': 'Zero Sales',
}

export function SkuAnalyticsPage() {
  const { month } = useFilterStore()
  const rows = useSkuAnalytics()

  return (
    <PageShell title="SKU Analytics" subtitle="Unit and revenue growth by SKU, classified by trend">
      <DataTable
        exportFileName={`HLPL_SkuAnalytics_${month}`}
        columns={[
          { key: 'productName', header: 'Product', accessor: (r) => r.productName },
          { key: 'category', header: 'Category', accessor: (r) => r.category },
          { key: 'currentUnits', header: 'Units (Current)', accessor: (r) => r.currentUnits, align: 'right', render: (r) => formatNumber(r.currentUnits) },
          { key: 'currentNetSales', header: 'Net Sales', accessor: (r) => r.currentNetSales, align: 'right', render: (r) => formatCurrencyFull(r.currentNetSales) },
          {
            key: 'unitGrowthPct',
            header: 'Unit Growth MoM',
            accessor: (r) => r.unitGrowthPct ?? 0,
            align: 'right',
            render: (r) => (r.unitGrowthPct === null ? '—' : `${r.unitGrowthPct >= 0 ? '▲' : '▼'} ${Math.abs(r.unitGrowthPct).toFixed(1)}%`),
          },
          {
            key: 'bucket',
            header: 'Trend',
            accessor: (r) => r.bucket,
            render: (r) => <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${BUCKET_STYLE[r.bucket]}`}>{BUCKET_LABEL[r.bucket]}</span>,
          },
        ]}
        rows={rows}
      />
    </PageShell>
  )
}
