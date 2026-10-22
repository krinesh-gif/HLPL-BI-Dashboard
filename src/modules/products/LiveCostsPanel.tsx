import { useMemo, useState } from 'react'
import { KPICard } from '@/components/ui/KPICard'
import { formatNumber, formatPercent, formatUnitCost, monthLabel } from '@/lib/format'
import { exportRowsToCsv } from '@/lib/exportCsv'
import { liveCosts, summariseLiveCosts, type CostVersion, type LiveCost } from '@/data/costVersions'
import type { SkuMaster } from '@/data/models'

type SortKey = 'cost-desc' | 'cost-asc' | 'sku' | 'product' | 'category'

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'cost-desc', label: 'Cost — highest first' },
  { key: 'cost-asc', label: 'Cost — lowest first' },
  { key: 'sku', label: 'SKU A–Z' },
  { key: 'product', label: 'Product A–Z' },
  { key: 'category', label: 'Category' },
]

/** Uncosted rows sink to the bottom of either cost sort — they have no number
 * to rank by, and they are the rows that need attention, not hiding. */
function sortRows(rows: LiveCost[], key: SortKey): LiveCost[] {
  const out = [...rows]
  switch (key) {
    case 'cost-desc':
    case 'cost-asc':
      return out.sort((a, b) => {
        if (a.cogs === null || b.cogs === null) return a.cogs === b.cogs ? a.sku.localeCompare(b.sku) : a.cogs === null ? 1 : -1
        if (a.cogs === b.cogs) return a.sku.localeCompare(b.sku)
        return key === 'cost-desc' ? b.cogs - a.cogs : a.cogs - b.cogs
      })
    case 'product':
      return out.sort((a, b) => a.productName.localeCompare(b.productName))
    case 'category':
      return out.sort((a, b) => a.category.localeCompare(b.category) || a.productName.localeCompare(b.productName))
    default:
      return out.sort((a, b) => a.sku.localeCompare(b.sku))
  }
}

function sourceLabel(row: LiveCost): string {
  if (row.cogs === null) return 'no cost on file'
  if (row.source === 'sku-master') return 'Product Master'
  const from = row.effectiveFrom ? `from ${monthLabel(row.effectiveFrom)}` : ''
  return [row.source === 'manual' ? 'Entered by hand' : row.fileName || 'Cost sheet', from].filter(Boolean).join(' · ')
}

/**
 * Every cost the P&L is using this month, on the screen.
 *
 * This is the answer to "what does each SKU cost us right now" — the same
 * numbers the margin on every channel is struck at, read out of the same
 * lookup the P&L reads.
 */
export function LiveCostsPanel({
  skuMaster,
  versions,
  month,
  months,
  onMonthChange,
}: {
  skuMaster: SkuMaster[]
  versions: CostVersion[]
  month: string
  months: string[]
  /** Sets the dashboard's month, so the cost read here is the one every other
   * screen is costing that month at. */
  onMonthChange: (month: string) => void
}) {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [sort, setSort] = useState<SortKey>('cost-desc')

  const rows = useMemo(() => liveCosts(skuMaster, versions, month), [skuMaster, versions, month])
  const summary = useMemo(() => summariseLiveCosts(rows), [rows])
  const categories = useMemo(
    () => [...new Set(rows.map((r) => r.category).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [rows],
  )

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = rows.filter(
      (r) =>
        (category === 'all' || r.category === category) &&
        (!q || r.sku.toLowerCase().includes(q) || r.productName.toLowerCase().includes(q)),
    )
    return sortRows(filtered, sort)
  }, [rows, search, category, sort])

  function exportCsv() {
    exportRowsToCsv(
      `live-costs-${month}`,
      shown.map((r) => ({
        SKU: r.sku,
        Product: r.productName,
        Category: r.category,
        [`Cost in ${monthLabel(month)}`]: r.cogs === null ? '' : r.cogs,
        MRP: r.mrp === null || r.mrp === 0 ? '' : r.mrp,
        'Cost % of MRP': r.cogs !== null && r.mrp ? ((r.cogs / r.mrp) * 100).toFixed(1) : '',
        Source: sourceLabel(r),
      })),
    )
  }

  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] p-4 shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--ink)]">Costs live in {monthLabel(month)}</h3>
          <p className="mt-0.5 text-sm text-[var(--ink-2)]">
            What every channel&apos;s P&amp;L costs a unit at, this month. Changing the month here changes it for the whole dashboard.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs font-medium text-[var(--ink-3)]">
            Month
            <select
              value={month}
              onChange={(e) => onMonthChange(e.target.value)}
              className="rounded-md border border-[var(--line-2)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
            >
              {months.map((m) => (
                <option key={m} value={m}>{monthLabel(m)}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={exportCsv}
            disabled={shown.length === 0}
            className="rounded-md border border-[var(--line-2)] px-3 py-1.5 text-sm font-medium text-[var(--ink-2)] hover:bg-[var(--surface-hover)] disabled:opacity-40"
          >
            Export CSV
          </button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KPICard label="SKUs costed" value={formatNumber(summary.costed)} note={`of ${formatNumber(summary.skus)} on file`} accent={1} />
        <KPICard
          label="No cost"
          value={formatNumber(summary.uncosted)}
          tone={summary.uncosted > 0 ? 'bad' : 'neutral'}
          note={summary.uncosted > 0 ? 'costed at ₹0 in every P&L' : 'every SKU has a cost'}
          accent={3}
        />
        <KPICard
          label="Cost range"
          value={summary.lowest === null ? '—' : `${formatUnitCost(summary.lowest)} – ${formatUnitCost(summary.highest ?? summary.lowest)}`}
          note="per unit"
          accent={2}
        />
        <KPICard
          label="From a cost sheet"
          value={formatNumber(summary.fromCostSheet)}
          note={`${formatNumber(summary.fromProductMaster)} still on the Product Master baseline`}
          accent={4}
        />
      </div>

      {summary.fromCostSheet === 0 && summary.costed > 0 && (
        <p className="mt-3 rounded-md border border-[color-mix(in_oklab,var(--warning)_40%,transparent)] bg-[color-mix(in_oklab,var(--warning)_10%,transparent)] px-3 py-2 text-xs text-[var(--ink)]">
          No cost sheet has been uploaded yet, so every cost below is the Product Master baseline and is treated as having applied in
          every month ever reported. Editing one on Product Master restates closed months too — upload it here with an effective month
          instead, and the months before it keep the cost they were closed at.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search SKU or product…"
          className="w-64 rounded-md border border-[var(--line-2)] px-3 py-1.5 text-sm focus:border-[var(--accent)] focus:outline-none"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Category"
          className="rounded-md border border-[var(--line-2)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
        >
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          aria-label="Sort by"
          className="rounded-md border border-[var(--line-2)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
        >
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>{s.label}</option>
          ))}
        </select>
        <span className="ml-auto text-xs text-[var(--ink-3)]">
          {formatNumber(shown.length)} of {formatNumber(rows.length)} SKUs
        </span>
      </div>

      {shown.length === 0 ? (
        <p className="mt-3 rounded-md border border-dashed border-[var(--line-2)] px-4 py-6 text-center text-sm text-[var(--ink-3)]">
          {rows.length === 0
            ? 'No SKUs on file yet. Add them on Products → Product Master.'
            : 'Nothing matches that search.'}
        </p>
      ) : (
        <div className="mt-3 max-h-[36rem] overflow-auto rounded-md border border-[var(--line)]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[var(--surface-2)]">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--ink-3)]">SKU</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--ink-3)]">Product</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--ink-3)]">Category</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--ink-3)]">Cost</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--ink-3)]">MRP</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--ink-3)]">Cost % of MRP</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--ink-3)]">Cost from</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const costPctOfMrp = r.cogs !== null && r.mrp ? (r.cogs / r.mrp) * 100 : null
                return (
                  <tr
                    key={r.sku}
                    className={`border-t border-[var(--line)] ${r.cogs === null ? 'bg-[color-mix(in_oklab,var(--critical)_8%,transparent)]' : ''}`}
                  >
                    <td className="px-3 py-1.5 font-mono text-xs whitespace-nowrap text-[var(--ink-2)]">{r.sku}</td>
                    <td className="px-3 py-1.5 text-[var(--ink)]">
                      {r.productName === r.sku ? <span className="text-xs italic text-[var(--ink-3)]">no product name on file</span> : r.productName}
                      {!r.inProductMaster && (
                        <span className="ml-2 rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--ink-3)]">
                          not in Product Master
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-[var(--ink-2)]">{r.category || '—'}</td>
                    <td className="px-3 py-1.5 text-right font-medium tabular-nums text-[var(--ink)]">
                      {r.cogs === null ? <span className="text-xs italic text-[var(--critical-ink)]">none</span> : formatUnitCost(r.cogs)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-[var(--ink-2)]">
                      {r.mrp === null || r.mrp === 0 ? '—' : formatUnitCost(r.mrp)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-[var(--ink-2)]">
                      {costPctOfMrp === null ? '—' : formatPercent(costPctOfMrp)}
                    </td>
                    <td className="px-3 py-1.5 text-xs whitespace-nowrap text-[var(--ink-3)]">{sourceLabel(r)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
