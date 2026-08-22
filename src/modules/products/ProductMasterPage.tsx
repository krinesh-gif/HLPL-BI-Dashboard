import { PageShell } from '@/components/layout/PageShell'
import { useDataStore } from '@/store/dataStore'
import type { SkuMaster } from '@/data/models'

const EDITABLE_NUMERIC_FIELDS: { key: keyof SkuMaster; label: string }[] = [
  { key: 'cogs', label: 'COGS' },
  { key: 'mrp', label: 'MRP' },
  { key: 'standardSellingPrice', label: 'Std. Selling Price' },
  { key: 'leadTimeDays', label: 'Lead Time (days)' },
  { key: 'minimumStock', label: 'Min Stock' },
  { key: 'safetyStock', label: 'Safety Stock' },
]

export function ProductMasterPage() {
  const { skuMaster, updateSkuMaster } = useDataStore()

  return (
    <PageShell title="Product Master" subtitle="Centralized SKU data — COGS here is the single source of truth for every channel's P&L" showFilters={false}>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">SKU</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Product</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Category</th>
              {EDITABLE_NUMERIC_FIELDS.map((f) => (
                <th key={f.key} className="px-3 py-2 text-right text-xs font-semibold text-slate-500">
                  {f.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {skuMaster.map((sku) => (
              <tr key={sku.sku} className="border-t border-slate-100">
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-500">{sku.sku}</td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-800">{sku.productName}</td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-600">{sku.category}</td>
                {EDITABLE_NUMERIC_FIELDS.map((f) => (
                  <td key={f.key} className="px-3 py-1 text-right">
                    <input
                      type="number"
                      defaultValue={sku[f.key] as number}
                      onBlur={(e) => {
                        const value = Number(e.target.value)
                        if (Number.isFinite(value)) updateSkuMaster(sku.sku, { [f.key]: value })
                      }}
                      className="w-24 rounded border border-transparent bg-transparent px-2 py-1 text-right tabular-nums hover:border-slate-300 focus:border-indigo-500 focus:bg-white focus:outline-none"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PageShell>
  )
}
