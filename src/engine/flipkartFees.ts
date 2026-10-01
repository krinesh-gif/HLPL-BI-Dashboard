import type { FlipkartPnlFacts } from '@/data/models'

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
export interface FlipkartFeeDef {
  /** The key on FlipkartPnlFacts, which is also the statement's line key. */
  id: keyof FlipkartPnlFacts
  label: string
  /**
   * What someone could actually do about it. A fee with a lever is listed
   * first — the list is meant to be worked through, and a rate-card fee at the
   * top of it is just a bigger number nobody can move.
   */
  lever?: string
  /** A credit rather than a charge, so a rise in it is good news. */
  isCredit?: boolean
}

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

export interface FlipkartFeeMonthPoint {
  month: string
  amount: number
}

export interface FlipkartFeeSeries {
  def: FlipkartFeeDef
  points: FlipkartFeeMonthPoint[]
  total: number
  /** Months in which the fee was charged anything at all. */
  monthsCharged: number
  /** The latest month's amount less the one before it. Positive is worse,
   * except on a credit, where the screen says so. */
  changeLastMonth: number | null
  /** The latest month against the average of the months before it. Null until
   * there is a month to compare against. */
  vsAveragePct: number | null
}

const amountOf = (facts: FlipkartPnlFacts | undefined, id: keyof FlipkartPnlFacts): number => {
  const value = facts?.[id]
  return typeof value === 'number' ? value : 0
}

export function buildFlipkartFeeSeries(
  def: FlipkartFeeDef,
  months: string[],
  facts: FlipkartPnlFacts[],
): FlipkartFeeSeries {
  const points = months.map((month) => ({
    month,
    amount: amountOf(facts.find((f) => f.month === month), def.id),
  }))

  const total = points.reduce((sum, p) => sum + p.amount, 0)
  const last = points[points.length - 1]?.amount ?? 0
  const previous = points.length >= 2 ? points[points.length - 2].amount : null

  const earlier = points.slice(0, -1)
  const earlierAverage = earlier.length > 0 ? earlier.reduce((s, p) => s + p.amount, 0) / earlier.length : null

  return {
    def,
    points,
    total,
    monthsCharged: points.filter((p) => p.amount !== 0).length,
    changeLastMonth: previous === null ? null : last - previous,
    // Against nothing, a percentage change is not zero — it is unmeasurable,
    // and printing 0% would read as "no change" rather than "no baseline".
    vsAveragePct: earlierAverage === null || earlierAverage === 0 ? null : ((last - earlierAverage) / earlierAverage) * 100,
  }
}

/** Every fee charged something across the period, the ones with a lever first. */
export function flipkartFeeSeries(months: string[], facts: FlipkartPnlFacts[]): FlipkartFeeSeries[] {
  return FLIPKART_FEE_LINES.map((def) => buildFlipkartFeeSeries(def, months, facts))
    .filter((s) => s.monthsCharged > 0)
    .sort((a, b) => {
      if (Boolean(a.def.lever) !== Boolean(b.def.lever)) return a.def.lever ? -1 : 1
      return Math.abs(b.total) - Math.abs(a.total)
    })
}
