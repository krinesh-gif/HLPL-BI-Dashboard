import type { FlipkartPnlFacts } from '@/data/models'
import { buildFeeTrend, rankFeeTrends, type FeeTrend, type FeeTrendDef } from './feeTrend'

/**
 * Flipkart's fees, read month by month.
 *
 * The statement says a fee cost ₹41,000 this month. That is a fact, and there
 * is nothing to do with it. What leads to a decision is whether it was ₹4,000
 * three months ago — a storage fee climbing month on month is ageing stock,
 * and that is a restocking call someone can make this week.
 *
 * Unlike Amazon USA there is no per-SKU view here, and that is a property of
 * the file rather than a gap in this screen. Flipkart's SKU-level export does
 * carry these fees per row, but only the month's total is kept, so attributing
 * a fee to products would mean spreading it by guesswork. The month-on-month
 * shape is what the stored figures can honestly support.
 *
 * Amounts are positive magnitudes, as the statement stores them: a bigger
 * number is a bigger charge.
 */
/** The month-on-month arithmetic is the same on every channel and lives in
 * `feeTrend`; what is Flipkart's own is the list below and the per-SKU split. */
export type FlipkartFeeDef = FeeTrendDef<FlipkartPnlFacts>

export const FLIPKART_FEE_LINES: FlipkartFeeDef[] = [
  { id: 'storageFee', label: 'Storage Fee', lever: 'Stock ageing in Flipkart’s warehouse — clear it or stop sending it' },
  { id: 'recallFee', label: 'Recall Fee', lever: 'Charged when stock is pulled back out of the warehouse' },
  { id: 'reverseShippingFee', label: 'Reverse Shipping Fee', lever: 'Driven by the return and RTO rate' },
  { id: 'forwardShippingFee', label: 'Forward Shipping Fee', lever: 'Weight and packaging decide the slab' },
  { id: 'pickPackFee', label: 'Pick & Pack Fee' },
  { id: 'commissionFee', label: 'Commission Fee' },
  { id: 'collectionFee', label: 'Collection Fee' },
  { id: 'fixedFee', label: 'Fixed Fee' },
  { id: 'otherMarketplaceFees', label: 'Other Marketplace Fees' },
  { id: 'rewardsSpf', label: 'Rewards & SPF', isCredit: true },
]

export interface FlipkartFeeSkuRow {
  sku: string
  total: number
  /** Amount per month, in the order the months were asked for. */
  byMonth: number[]
  /** Share of the fee's total across the months that carry a split. */
  sharePct: number
}

export interface FlipkartFeeSeries extends FeeTrend<FlipkartPnlFacts> {
  /** The products carrying the fee, biggest first. Empty when no month in
   * range was imported with its per-SKU split. */
  skus: FlipkartFeeSkuRow[]
  /** The part of the total that the per-SKU rows actually account for. Below
   * 100% some months predate the split being captured, and the screen has to
   * say so rather than let the table read as the whole fee. */
  skuCoveragePct: number
  /** How much of the covered total sits in the worst three products. A
   * concentrated fee is a shortlist; a spread one is a policy problem. */
  topThreeSharePct: number
}

export function buildFlipkartFeeSeries(
  def: FlipkartFeeDef,
  months: string[],
  facts: FlipkartPnlFacts[],
): FlipkartFeeSeries {
  const trend = buildFeeTrend(def, months, facts)

  // Only months imported with their per-SKU split contribute. A month without
  // one adds nothing here rather than having its total spread across products
  // by guesswork, and `skuCoveragePct` is what tells the screen to say so.
  const bySku = new Map<string, number[]>()
  let covered = 0
  months.forEach((m, i) => {
    const split = facts.find((f) => f.month === m)?.feeBySku
    if (!split) return
    for (const [sku, fees] of Object.entries(split)) {
      const amount = fees[def.id as string]
      if (!amount) continue
      const row = bySku.get(sku) ?? months.map(() => 0)
      row[i] += amount
      bySku.set(sku, row)
      covered += amount
    }
  })

  const skus: FlipkartFeeSkuRow[] = [...bySku.entries()]
    .map(([sku, byMonth]) => {
      const skuTotal = byMonth.reduce((a, b) => a + b, 0)
      return { sku, byMonth, total: skuTotal, sharePct: covered !== 0 ? (skuTotal / covered) * 100 : 0 }
    })
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total))

  return {
    ...trend,
    skus,
    skuCoveragePct: trend.total !== 0 ? (covered / trend.total) * 100 : 0,
    topThreeSharePct: covered !== 0 ? (skus.slice(0, 3).reduce((s, r) => s + r.total, 0) / covered) * 100 : 0,
  }
}

/** Every fee charged something across the period, the ones with a lever first. */
export function flipkartFeeSeries(months: string[], facts: FlipkartPnlFacts[]): FlipkartFeeSeries[] {
  return rankFeeTrends(FLIPKART_FEE_LINES.map((def) => buildFlipkartFeeSeries(def, months, facts)))
}
