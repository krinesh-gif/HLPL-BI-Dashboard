import { useMemo, useState } from 'react'
import { ComparisonBarChart } from '@/components/charts/ComparisonBarChart'
import { useDataStore } from '@/store/dataStore'
import { useFilterStore } from '@/store/filterStore'
import { channelOfSource, type BusinessChannelId, type SalesSourceId } from '@/config/channels'
import { addMonths, formatCurrencyCompact, formatCurrencyFull, formatNumber, formatPercent } from '@/lib/format'
import { filterByMonth, growthPct } from '@/engine/sales'
import { orderBasisNetSales } from '@/engine/netSales'
import { buildCostIndex, cogsForMonth } from '@/data/costVersions'
import { resolveCogs } from '@/data/skuMapping'
import { productLabelResolver } from '@/data/productLabel'
import { exportRowsToCsv } from '@/lib/exportCsv'

export type RankBy = 'netSales' | 'units' | 'orders' | 'contribution' | 'growth'

const RANKINGS: { key: RankBy; label: string }[] = [
  { key: 'netSales', label: 'Net Sales' },
  { key: 'units', label: 'Units' },
  { key: 'orders', label: 'Orders' },
  { key: 'contribution', label: 'Contribution' },
  { key: 'growth', label: 'Growth %' },
]

const TOP_N_OPTIONS = [5, 10, 15, 20]

interface ProductRow {
  /** The code the marketplace listed it under. Kept because it is what a
   * Flipkart or Meesho report has to be traced back to. */
  sku: string
  /** The Uniware code the SKU mapping resolves it to — one code per product
   * across every channel, which is what makes two channels' rows comparable.
   * Falls back to the channel's own code when nothing is mapped. */
  internalSku: string
  productName: string
  /** False when the Product Master has no entry for this SKU. */
  resolvedName: boolean
  netSales: number
  units: number
  orders: number
  /** Net sales less COGS less the marketplace's own charges on those orders.
   * Null when the SKU has no cost on file, since a contribution computed from
   * a missing cost is just net sales wearing a different label. */
  contribution: number | null
  growth: number | null
}

/**
 * Top products for one channel, with the count and the ranking both
 * configurable.
 *
 * Every ranking reads the same rows, so switching from Net Sales to Units
 * reorders one list rather than showing two lists that disagree about what a
 * product sold.
 */
export function TopProducts({ channel, source }: { channel: BusinessChannelId; source?: SalesSourceId }) {
  const { salesRecords, skuMaster, costVersions, mappings, comboComponents } = useDataStore()
  const { month } = useFilterStore()
  const [topN, setTopN] = useState(10)
  const [rankBy, setRankBy] = useState<RankBy>('netSales')

  const rows = useMemo(() => {
    const channelRecords = salesRecords.filter((r) =>
      source ? r.channel === source : channelOfSource(r.channel) === channel,
    )
    const current = filterByMonth(channelRecords, month)
    const previous = filterByMonth(channelRecords, addMonths(month, -1))

    const costIndex = buildCostIndex(costVersions, skuMaster)
    const tables = {
      skuMaster,
      mappings,
      comboComponents,
      costFor: (sku: string) => cogsForMonth(sku, month, costIndex) ?? undefined,
    }

    const group = (records: typeof current) => {
      const map = new Map<string, typeof current>()
      for (const r of records) {
        const list = map.get(r.sku)
        if (list) list.push(r)
        else map.set(r.sku, [r])
      }
      return map
    }

    const currentBySku = group(current)
    const previousBySku = group(previous)
    // One name per product, from the Product Master, reached through the SKU
    // mapping. Marketplace listing titles differ per channel, run to four
    // wrapped lines, and are sometimes just the SKU code repeated.
    const label = productLabelResolver({ skuMaster, mappings, comboComponents })

    const result: ProductRow[] = [...currentBySku.entries()].map(([sku, records]) => {
      const figure = orderBasisNetSales(records)
      const previousFigure = orderBasisNetSales(previousBySku.get(sku) ?? [])

      const unitCost = resolveCogs(sku, tables)?.cogs ?? null
      const contribution =
        unitCost === null
          ? null
          : figure.netSales - unitCost * figure.units - figure.marketplaceFee - figure.shippingCost

      const named = label(sku, records[0]?.productName)

      return {
        sku,
        internalSku: named.sku,
        productName: named.title,
        resolvedName: named.resolved,
        netSales: figure.netSales,
        units: figure.units,
        orders: figure.orders,
        contribution,
        growth: growthPct(figure.netSales, previousFigure.netSales),
      }
    })

    const sorted = [...result].sort((a, b) => {
      if (rankBy === 'growth') {
        // A product with no prior month has undefined growth, not the worst
        // growth; sorting it as -Infinity would bury genuinely new winners.
        if (a.growth === null && b.growth === null) return b.netSales - a.netSales
        if (a.growth === null) return 1
        if (b.growth === null) return -1
        return b.growth - a.growth
      }
      if (rankBy === 'contribution') {
        if (a.contribution === null && b.contribution === null) return b.netSales - a.netSales
        if (a.contribution === null) return 1
        if (b.contribution === null) return -1
        return b.contribution - a.contribution
      }
      return b[rankBy] - a[rankBy]
    })

    return { all: sorted, top: sorted.slice(0, topN), total: orderBasisNetSales(current).netSales }
  }, [salesRecords, skuMaster, costVersions, mappings, comboComponents, channel, source, month, rankBy, topN])

  function exportRows() {
    exportRowsToCsv(
      `HLPL_Top${topN}_${source ?? channel}_${month}`,
      rows.top.map((r, i) => ({
        Rank: i + 1,
        'Uniware SKU': r.internalSku,
        'Channel SKU': r.sku,
        Product: r.productName,
        'Net Sales': Math.round(r.netSales),
        Units: r.units,
        Orders: r.orders,
        Contribution: r.contribution === null ? '' : Math.round(r.contribution),
        'Growth %': r.growth === null ? '' : Math.round(r.growth * 10) / 10,
      })),
    )
  }

  if (rows.all.length === 0) {
    return (
      <div className="rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-card)] p-6 text-center text-sm text-[var(--ink-3)]">
        No product-level sales for this channel in this month.
      </div>
    )
  }

  const chartValue = (r: ProductRow): number =>
    rankBy === 'growth' ? (r.growth ?? 0) : rankBy === 'contribution' ? (r.contribution ?? 0) : r[rankBy]

  const chartFormat = (v: number) =>
    rankBy === 'growth' ? formatPercent(v) : rankBy === 'units' || rankBy === 'orders' ? formatNumber(v) : formatCurrencyCompact(v)

  /** The axis shortens a tick repeated five times; a tooltip is the one figure
   * the reader pointed at, so it keeps every rupee. */
  const tooltipFormat = (v: number) =>
    rankBy === 'growth' ? formatPercent(v) : rankBy === 'units' || rankBy === 'orders' ? formatNumber(v) : formatCurrencyFull(v)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-[var(--ink-3)]">
          Top
          <select
            value={topN}
            onChange={(e) => setTopN(Number(e.target.value))}
            className="rounded-md border border-[var(--line-2)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
          >
            {TOP_N_OPTIONS.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-[var(--ink-3)]">
          Rank by
          <select
            value={rankBy}
            onChange={(e) => setRankBy(e.target.value as RankBy)}
            className="rounded-md border border-[var(--line-2)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
          >
            {RANKINGS.map((r) => (
              <option key={r.key} value={r.key}>{r.label}</option>
            ))}
          </select>
        </label>

        <span className="text-xs text-[var(--ink-3)]">
          {rows.top.length} of {rows.all.length} products
        </span>

        <button
          type="button"
          onClick={exportRows}
          className="ml-auto rounded-md border border-[var(--line-2)] px-3 py-1.5 text-sm font-medium text-[var(--ink-2)] hover:bg-[var(--surface-hover)]"
        >
          Export CSV
        </button>
      </div>

      <div className="rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-card)] p-4">
        <ComparisonBarChart
          // Labelled by Uniware code rather than product name. The names run
          // past the axis and several share a long prefix, so a column of them
          // reads as near-identical; the codes are short, unique and the thing
          // the warehouse and the cost sheet are both keyed on.
          data={rows.top.map((r) => ({ name: r.internalSku, value: chartValue(r) }))}
          xKey="name"
          yKey="value"
          horizontal
          valueFormatter={chartFormat}
          tooltipFormatter={tooltipFormat}
          valueLabel={RANKINGS.find((r) => r.key === rankBy)?.label ?? 'Value'}
        />
      </div>

      <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-card)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--surface-2)]">
            <tr>
              <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--ink-3)]">#</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--ink-3)]">Uniware SKU</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--ink-3)]">Net Sales</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--ink-3)]">Share</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--ink-3)]">Units</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--ink-3)]">Orders</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--ink-3)]">Contribution</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--ink-3)]">Growth</th>
            </tr>
          </thead>
          <tbody>
            {rows.top.map((r, i) => (
              <tr key={r.sku} className="border-t border-[var(--line)]">
                <td className="px-3 py-2 text-right tabular-nums text-[var(--ink-3)]">{i + 1}</td>
                <td className="max-w-[26rem] px-3 py-2">
                  <div className="truncate font-mono text-[var(--ink)]" title={r.internalSku}>
                    {r.internalSku}
                    {!r.resolvedName && (
                      <span
                        className="ml-1.5 rounded bg-[color-mix(in_oklab,var(--warning)_18%,transparent)] px-1.5 py-0.5 font-sans text-[10px] font-medium text-[var(--ink-2)]"
                        title="Not mapped to a Uniware code — this is the marketplace's own. Link it on SKU Mapping."
                      >
                        unmapped
                      </span>
                    )}
                  </div>
                  {/* The name stays, underneath: the code says which product
                      without saying what it is, and a reader checking a figure
                      needs both. */}
                  <div className="truncate text-xs text-[var(--ink-3)]" title={r.productName}>{r.productName}</div>
                  {r.internalSku !== r.sku && (
                    // Only when they differ, so the common case stays quiet and
                    // a Meesho row can still be traced back to its own report.
                    <div className="font-mono text-[11px] text-[var(--ink-3)]">listed as {r.sku}</div>
                  )}
                </td>
                <td className="px-3 py-2 text-right font-medium tabular-nums text-[var(--ink)]">{formatCurrencyFull(r.netSales)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-[var(--ink-3)]">
                  {rows.total > 0 ? formatPercent((r.netSales / rows.total) * 100) : '—'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-[var(--ink-2)]">{formatNumber(r.units)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-[var(--ink-2)]">{formatNumber(r.orders)}</td>
                <td
                  className={`px-3 py-2 text-right tabular-nums ${
                    r.contribution === null ? 'text-[var(--ink-3)]' : r.contribution >= 0 ? 'text-[var(--ink-2)]' : 'text-[var(--critical-ink)]'
                  }`}
                  title={r.contribution === null ? 'No cost on file for this SKU' : undefined}
                >
                  {r.contribution === null ? 'no cost' : formatCurrencyFull(r.contribution)}
                </td>
                <td
                  className={`px-3 py-2 text-right tabular-nums ${
                    r.growth === null ? 'text-[var(--ink-3)]' : r.growth >= 0 ? 'text-[var(--good-ink)]' : 'text-[var(--critical-ink)]'
                  }`}
                >
                  {r.growth === null ? 'new' : `${r.growth >= 0 ? '▲' : '▼'} ${formatPercent(Math.abs(r.growth))}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
