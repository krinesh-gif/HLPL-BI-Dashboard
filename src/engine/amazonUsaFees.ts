import { AMAZON_USA_FEE_COLUMNS, type AmazonUsaFeeColumn } from '@/data/amazonUsa/feeColumns'
import type { AmazonUsaPnlFacts } from '@/data/models'

/**
 * Amazon's fees, read month by month and traced to the products carrying them.
 *
 * A P&L line says a fee cost $701 this month. That is a fact, and there is
 * nothing to do with it. The question worth asking is whether it was $0 three
 * months ago and which twelve SKUs account for all of it — because a
 * low-inventory-level fee concentrated in four products is a restocking
 * decision, and the same total spread evenly across ninety is a pricing one.
 *
 * Amounts keep the export's own sign: a charge is positive, a credit negative.
 */
export interface FeeMonthPoint {
  month: string
  amount: number
}

export interface FeeSkuRow {
  sku: string
  total: number
  /** Amount per month, in the same order as the months requested. */
  byMonth: number[]
  /** Share of the fee's total across the period. */
  sharePct: number
}

export interface FeeSeries {
  column: AmazonUsaFeeColumn
  points: FeeMonthPoint[]
  total: number
  /** Months in which the fee was charged anything at all. */
  monthsCharged: number
  /** The most recent month's amount less the one before it. Positive is worse. */
  changeLastMonth: number | null
  skus: FeeSkuRow[]
  /** How much of the total sits in the worst three SKUs. A concentrated fee is
   * a shortlist; a spread one is a policy problem. */
  topThreeSharePct: number
}

const factsFor = (month: string, facts: AmazonUsaPnlFacts[]): AmazonUsaPnlFacts | undefined =>
  facts.find((f) => f.month === month)

/** Every fee that was charged something across the period, worst first, with
 * the ones you can do something about ahead of the ones you cannot. */
export function amazonUsaFeeSeries(months: string[], facts: AmazonUsaPnlFacts[]): FeeSeries[] {
  const series = AMAZON_USA_FEE_COLUMNS.map((column) => buildSeries(column, months, facts))
  return series
    .filter((s) => s.monthsCharged > 0)
    .sort((a, b) => {
      // A fee with a lever comes first even when a bigger one has none: the
      // list is meant to be worked through, and an unactionable line at the top
      // of it is just a bigger number.
      if (Boolean(a.column.lever) !== Boolean(b.column.lever)) return a.column.lever ? -1 : 1
      return Math.abs(b.total) - Math.abs(a.total)
    })
}

export function buildSeries(column: AmazonUsaFeeColumn, months: string[], facts: AmazonUsaPnlFacts[]): FeeSeries {
  const points = months.map((month) => ({
    month,
    amount: factsFor(month, facts)?.feeTotalsUsd?.[column.id] ?? 0,
  }))
  const total = points.reduce((sum, p) => sum + p.amount, 0)

  // Per-SKU detail only exists for months imported since it was captured. A
  // month without it contributes zero to the SKU table rather than being
  // spread across SKUs by guesswork.
  const bySku = new Map<string, number[]>()
  months.forEach((month, i) => {
    const detail = factsFor(month, facts)?.feeBySkuUsd
    if (!detail) return
    for (const [sku, fees] of Object.entries(detail)) {
      const amount = fees[column.id]
      if (amount === undefined || amount === 0) continue
      const row = bySku.get(sku) ?? months.map(() => 0)
      row[i] = amount
      bySku.set(sku, row)
    }
  })

  const skus: FeeSkuRow[] = [...bySku.entries()]
    .map(([sku, byMonth]) => {
      const skuTotal = byMonth.reduce((a, b) => a + b, 0)
      return { sku, byMonth, total: skuTotal, sharePct: total !== 0 ? (skuTotal / total) * 100 : 0 }
    })
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total))

  const last = points[points.length - 1]?.amount ?? 0
  const previous = points.length >= 2 ? points[points.length - 2].amount : null

  return {
    column,
    points,
    total,
    monthsCharged: points.filter((p) => p.amount !== 0).length,
    changeLastMonth: previous === null ? null : last - previous,
    skus,
    topThreeSharePct: total !== 0
      ? (skus.slice(0, 3).reduce((sum, r) => sum + r.total, 0) / total) * 100
      : 0,
  }
}
