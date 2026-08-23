import { useState } from 'react'
import { useDataStore } from '@/store/dataStore'
import { formatCurrencyFull, formatNumber, formatPercent } from '@/lib/format'
import { useUncategorized, type UncategorizedSku } from './useUncategorized'

/**
 * The Uncategorized pile, with the means to empty it.
 *
 * A warning that only counts the problem gets ignored. Setting a category here
 * writes it straight to the Product Master, so the SKU leaves this list as soon
 * as it is classified — the fix is where the warning is.
 */
export function UncategorizedPanel() {
  const work = useUncategorized()
  const [open, setOpen] = useState(false)

  if (work.skus.length === 0) return null

  return (
    <section className="rounded-lg border border-amber-300 bg-amber-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-amber-900">
            ⚠ {formatNumber(work.skus.length)} SKU{work.skus.length === 1 ? ' is' : 's are'} currently Uncategorized.
          </h3>
          <p className="mt-1 text-xs text-amber-800">
            Update the Product Master to classify these SKUs.{' '}
            {work.netSales > 0 && (
              <>
                They account for {formatCurrencyFull(work.netSales)} ({formatPercent(work.sharePct)}) of net sales, which is missing from
                every category breakdown until they are classified.
              </>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="shrink-0 rounded-md border border-amber-400 bg-white px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100"
        >
          {open ? 'Hide' : 'Classify them'}
        </button>
      </div>

      {open && (
        <div className="mt-3 max-h-96 overflow-auto rounded-md border border-amber-200 bg-white">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-amber-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-amber-900">SKU</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-amber-900">Units</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-amber-900">Net Sales</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-amber-900">Set category</th>
              </tr>
            </thead>
            <tbody>
              {work.skus.map((row) => (
                <ClassifyRow key={row.sku} row={row} categories={work.availableCategories} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function ClassifyRow({ row, categories }: { row: UncategorizedSku; categories: string[] }) {
  const { updateSkuMaster } = useDataStore()
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function apply(category: string) {
    const trimmed = category.trim()
    if (!trimmed) return
    setBusy(true)
    setError(null)
    try {
      await updateSkuMaster(row.sku, { category: trimmed })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that category.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <tr className="border-t border-amber-100">
      <td className="px-3 py-2">
        <div className="font-mono text-xs text-slate-700">{row.sku}</div>
        <div className="text-xs text-slate-500">{row.productName}</div>
        {!row.inProductMaster && (
          <div className="mt-0.5 text-xs text-rose-600">
            Not in the Product Master — add it there first, or map it on SKU Mapping if it is a marketplace code.
          </div>
        )}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-slate-600">{formatNumber(row.units)}</td>
      <td className="px-3 py-2 text-right tabular-nums font-medium text-slate-800">{formatCurrencyFull(row.netSales)}</td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <input
            list={`categories-${row.sku}`}
            value={value}
            disabled={busy || !row.inProductMaster}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void apply(value)
            }}
            placeholder="Type or pick a category…"
            className="w-52 rounded-md border border-slate-300 px-2 py-1 text-xs focus:border-indigo-500 focus:outline-none disabled:bg-slate-50 disabled:opacity-50"
          />
          {/* Existing categories are offered so the team does not end up with
              six spellings of the same thing, but a new one can still be typed. */}
          <datalist id={`categories-${row.sku}`}>
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <button
            type="button"
            onClick={() => void apply(value)}
            disabled={busy || !value.trim() || !row.inProductMaster}
            className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            Save
          </button>
        </div>
        {error && <div className="mt-1 text-xs text-rose-600">{error}</div>}
      </td>
    </tr>
  )
}
