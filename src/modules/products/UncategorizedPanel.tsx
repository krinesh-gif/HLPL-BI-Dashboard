import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useDataStore } from '@/store/dataStore'
import { formatCurrencyFull, formatNumber, formatPercent } from '@/lib/format'
import { useUncategorized, type UncategorizedSku } from './useUncategorized'

/**
 * The Uncategorized pile, with the means to empty it.
 *
 * Most of what lands here is not an unclassified product — it is a marketplace
 * listing code that has not been mapped to one yet. `C2/RO/AH/FOOT/50` is a
 * two-item bundle, not something to invent a Product Master row for. So the
 * primary action on those rows is to map the code, which gives it a category
 * and a cost at the same time; only a code that really is a new product gets
 * added here.
 *
 * The first version of this panel offered a category box on every row and
 * disabled it wherever the SKU had no Product Master entry — which, for real
 * data, was every row. It counted the problem and could not act on it.
 */
export function UncategorizedPanel() {
  const work = useUncategorized()
  const [open, setOpen] = useState(false)

  if (work.skus.length === 0) return null

  const needMapping = work.skus.filter((s) => !s.inProductMaster)
  const needCategory = work.skus.filter((s) => s.inProductMaster)

  return (
    <section className="rounded-lg border border-amber-300 bg-amber-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-amber-900">
            ⚠ {formatNumber(work.skus.length)} SKU{work.skus.length === 1 ? ' is' : 's are'} currently Uncategorized.
          </h3>
          <p className="mt-1 text-xs text-amber-800">
            {work.netSales > 0 && (
              <>
                They account for {formatCurrencyFull(work.netSales)} ({formatPercent(work.sharePct)}) of net sales, which is missing
                from every category breakdown until they are classified.{' '}
              </>
            )}
            {needMapping.length > 0 && (
              <>
                <strong>{formatNumber(needMapping.length)}</strong> of them are marketplace codes with no Product Master entry — those
                are mapped, not categorised. Mapping a code gives it a category and a cost together.
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {needMapping.length > 0 && (
            <Link
              to="/products/sku-mapping"
              className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
            >
              Map {formatNumber(needMapping.length)} codes
            </Link>
          )}
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="rounded-md border border-amber-400 bg-white px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100"
          >
            {open ? 'Hide' : 'Show all'}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-3 max-h-[30rem] overflow-auto rounded-md border border-amber-200 bg-white">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-amber-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-amber-900">SKU</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-amber-900">Units</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-amber-900">Net Sales</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-amber-900">Action</th>
              </tr>
            </thead>
            <tbody>
              {/* Rows that only need a category come first — they are one click
                  from done, where the mapping work is a separate exercise. */}
              {[...needCategory, ...needMapping].map((row) => (
                <Row key={row.sku} row={row} categories={work.availableCategories} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function Row({ row, categories }: { row: UncategorizedSku; categories: string[] }) {
  const { updateSkuMaster, addProduct } = useDataStore()
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  async function apply() {
    const category = value.trim()
    if (!category) return
    setBusy(true)
    setError(null)
    try {
      if (row.inProductMaster) {
        await updateSkuMaster(row.sku, { category })
      } else {
        // Creating the row and classifying it in one step; a SKU that is
        // genuinely a new product needs to exist before it can be categorised.
        await addProduct({ sku: row.sku, productName: row.productName || row.sku, category })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that category.')
    } finally {
      setBusy(false)
    }
  }

  const showInput = row.inProductMaster || adding

  return (
    <tr className="border-t border-amber-100 align-top">
      <td className="px-3 py-2">
        <div className="font-mono text-xs text-slate-700">{row.sku}</div>
        {row.productName && row.productName !== row.sku && (
          <div className="text-xs text-slate-500">{row.productName}</div>
        )}
        {!row.inProductMaster && (
          <div className="mt-0.5 text-xs text-slate-500">
            {row.mapped
              ? 'Mapped, but the product it points at has no category either.'
              : 'A marketplace code with no Product Master entry.'}
          </div>
        )}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-slate-600">{formatNumber(row.units)}</td>
      <td className="px-3 py-2 text-right font-medium tabular-nums text-slate-800">{formatCurrencyFull(row.netSales)}</td>
      <td className="px-3 py-2">
        {showInput ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              list={`categories-${row.sku}`}
              value={value}
              disabled={busy}
              autoFocus={adding}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void apply() }}
              placeholder="Type or pick a category…"
              className="w-52 rounded-md border border-slate-300 px-2 py-1 text-xs focus:border-indigo-500 focus:outline-none disabled:opacity-50"
            />
            {/* Existing categories are offered so the team does not end up with
                six spellings of the same thing; a new one can still be typed. */}
            <datalist id={`categories-${row.sku}`}>
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <button
              type="button"
              onClick={() => void apply()}
              disabled={busy || !value.trim()}
              className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
            >
              {busy ? 'Saving…' : adding ? 'Add product' : 'Save'}
            </button>
            {adding && (
              <button type="button" onClick={() => setAdding(false)} className="text-xs text-slate-500 hover:text-slate-700">
                Cancel
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Link
              to={`/products/sku-mapping?q=${encodeURIComponent(row.sku)}`}
              className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700"
            >
              Map this code
            </Link>
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="text-xs font-medium text-slate-600 underline hover:text-slate-900"
            >
              It is a new product — add it
            </button>
          </div>
        )}
        {error && <div className="mt-1 text-xs text-rose-600">{error}</div>}
      </td>
    </tr>
  )
}
