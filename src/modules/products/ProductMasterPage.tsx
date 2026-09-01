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
        <div className="mb-6 rounded-lg border border-[color-mix(in_oklab,var(--warning)_45%,transparent)] bg-[color-mix(in_oklab,var(--warning)_12%,transparent)] p-4">
          <h3 className="text-sm font-semibold text-[var(--ink)]">
            ⚠ {unmappedSkus.length} SKU{unmappedSkus.length === 1 ? '' : 's'} in your uploaded sales data {unmappedSkus.length === 1 ? 'is' : 'are'} not in the Product Master
          </h3>
          <p className="mt-1 text-xs text-[var(--ink-2)]">
            These SKUs account for {formatCurrencyFull(unmappedNetSales)} ({formatPercent(unmappedSharePct)}) of total net sales. Their COGS was
            estimated (not looked up) in every P&L that includes them.
          </p>
          <p className="mt-2 text-xs text-[var(--ink)]">
            Most marketplace codes are renamed singles or combos rather than new products — link them on{' '}
            <Link to="/products/sku-mapping" className="font-semibold underline">
              Products → SKU Mapping
            </Link>
            . Only add a row here when it is genuinely a product you sell.
          </p>
          <div className="mt-3 overflow-x-auto rounded border border-[color-mix(in_oklab,var(--warning)_35%,transparent)] bg-[var(--surface)]">
            <table className="w-full text-sm">
              <thead className="bg-[color-mix(in_oklab,var(--warning)_20%,transparent)]/60">
                <tr>
                  <th className="px-3 py-1.5 text-left text-xs font-semibold text-[var(--ink)]">SKU</th>
                  <th className="px-3 py-1.5 text-left text-xs font-semibold text-[var(--ink)]">Product Name (from report)</th>
                  <th className="px-3 py-1.5 text-right text-xs font-semibold text-[var(--ink)]">Orders</th>
                  <th className="px-3 py-1.5 text-right text-xs font-semibold text-[var(--ink)]">Net Sales</th>
                </tr>
              </thead>
              <tbody>
                {unmappedSkus.map((u) => (
                  <tr key={u.sku} className="border-t border-[color-mix(in_oklab,var(--warning)_30%,transparent)]">
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs text-[var(--ink-2)]">{u.sku}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-[var(--ink-2)]">{u.productName}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right text-[var(--ink-2)]">{u.orders.toLocaleString()}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right font-medium text-[var(--ink-2)]">{formatCurrencyFull(u.netSales)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-[var(--line)] bg-[var(--surface)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--surface-2)]">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--ink-3)]">SKU</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--ink-3)]">Product</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--ink-3)]">Category</th>
              {EDITABLE_NUMERIC_FIELDS.map((f) => (
                <th key={f.key} className="px-3 py-2 text-right text-xs font-semibold text-[var(--ink-3)]">
                  {f.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {skuMaster.map((sku) => {
              const missingCogs = missingCogsSet.has(sku.sku)
              return (
                <tr key={sku.sku} className={`border-t border-[var(--line)] ${missingCogs ? 'bg-[color-mix(in_oklab,var(--critical)_10%,transparent)]' : ''}`}>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-[var(--ink-3)]">{sku.sku}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-[var(--ink)]">{sku.productName}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-[var(--ink-2)]">{sku.category}</td>
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
                        className={`w-24 rounded border px-2 py-1 text-right tabular-nums focus:border-[var(--accent)] focus:bg-[var(--surface)] focus:outline-none ${
                          f.key === 'cogs' && missingCogs
                            ? 'border-[color-mix(in_oklab,var(--critical)_45%,transparent)] bg-[color-mix(in_oklab,var(--critical)_16%,transparent)] font-semibold text-[var(--critical-ink)]'
                            : 'border-transparent bg-transparent hover:border-[var(--line-2)]'
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
