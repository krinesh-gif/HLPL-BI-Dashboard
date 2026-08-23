import { Link } from 'react-router-dom'
import { PageShell } from '@/components/layout/PageShell'
import { useDataStore } from '@/store/dataStore'
import { useSkuCostValidation } from './useSkuCostValidation'
import { UncategorizedPanel } from './UncategorizedPanel'
import { formatCurrencyFull, formatPercent } from '@/lib/format'
import type { SkuMaster } from '@/data/models'

// COGS drives every P&L and MRP is the reference price; the stock-planning
// fields were removed from this screen because they are set once and are not
// what anyone comes here to edit.
const EDITABLE_NUMERIC_FIELDS: { key: keyof SkuMaster; label: string }[] = [
  { key: 'cogs', label: 'COGS' },
  { key: 'mrp', label: 'MRP' },
]

export function ProductMasterPage() {
  const { skuMaster, updateSkuMaster } = useDataStore()
  const { unmappedSkus, unmappedNetSales, totalNetSales, missingCogsSkus } = useSkuCostValidation()
  const missingCogsSet = new Set(missingCogsSkus)
  const unmappedSharePct = totalNetSales > 0 ? (unmappedNetSales / totalNetSales) * 100 : 0

  return (
    <PageShell title="Product Master" subtitle="Centralized SKU data — COGS here is the single source of truth for every channel's P&L" showFilters={false}>
      <UncategorizedPanel />

      {unmappedSkus.length > 0 && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <h3 className="text-sm font-semibold text-amber-900">
            ⚠ {unmappedSkus.length} SKU{unmappedSkus.length === 1 ? '' : 's'} in your uploaded sales data {unmappedSkus.length === 1 ? 'is' : 'are'} not in the Product Master
          </h3>
          <p className="mt-1 text-xs text-amber-800">
            These SKUs account for {formatCurrencyFull(unmappedNetSales)} ({formatPercent(unmappedSharePct)}) of total net sales. Their COGS was
            estimated (not looked up) in every P&L that includes them.
          </p>
          <p className="mt-2 text-xs text-amber-900">
            Most marketplace codes are renamed singles or combos rather than new products — link them on{' '}
            <Link to="/products/sku-mapping" className="font-semibold underline">
              Products → SKU Mapping
            </Link>
            . Only add a row here when it is genuinely a product you sell.
          </p>
          <div className="mt-3 overflow-x-auto rounded border border-amber-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-amber-100/60">
                <tr>
                  <th className="px-3 py-1.5 text-left text-xs font-semibold text-amber-900">SKU</th>
                  <th className="px-3 py-1.5 text-left text-xs font-semibold text-amber-900">Product Name (from report)</th>
                  <th className="px-3 py-1.5 text-right text-xs font-semibold text-amber-900">Orders</th>
                  <th className="px-3 py-1.5 text-right text-xs font-semibold text-amber-900">Net Sales</th>
                </tr>
              </thead>
              <tbody>
                {unmappedSkus.map((u) => (
                  <tr key={u.sku} className="border-t border-amber-100">
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs text-slate-600">{u.sku}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-slate-700">{u.productName}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right text-slate-600">{u.orders.toLocaleString()}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right font-medium text-amber-800">{formatCurrencyFull(u.netSales)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
            {skuMaster.map((sku) => {
              const missingCogs = missingCogsSet.has(sku.sku)
              return (
                <tr key={sku.sku} className={`border-t border-slate-100 ${missingCogs ? 'bg-rose-50' : ''}`}>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-500">{sku.sku}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-800">{sku.productName}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">{sku.category}</td>
                  {EDITABLE_NUMERIC_FIELDS.map((f) => (
                    <td key={f.key} className="px-3 py-1 text-right">
                      <input
                        type="number"
                        defaultValue={sku[f.key] as number}
                        title={f.key === 'cogs' && missingCogs ? 'No COGS on file — this SKU\'s cost is being treated as ₹0' : undefined}
                        onBlur={(e) => {
                          const value = Number(e.target.value)
                          if (Number.isFinite(value)) updateSkuMaster(sku.sku, { [f.key]: value })
                        }}
                        className={`w-24 rounded border px-2 py-1 text-right tabular-nums focus:border-indigo-500 focus:bg-white focus:outline-none ${
                          f.key === 'cogs' && missingCogs
                            ? 'border-rose-300 bg-rose-100 font-semibold text-rose-700'
                            : 'border-transparent bg-transparent hover:border-slate-300'
                        }`}
                      />
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </PageShell>
  )
}
