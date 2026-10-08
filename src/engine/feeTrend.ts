/**
 * A marketplace fee, read month by month.
 *
 * The statement says a fee cost ₹75,818 this month. That is a fact, and there
 * is nothing to do with it. What leads to a decision is whether it was ₹11,420
 * in April — a storage fee climbing month on month is ageing stock, and that
 * is a restocking call someone can make this week.
 *
 * The arithmetic is the same whichever marketplace raised the charge, so it
 * lives here once. A channel supplies the list of its own fee lines, in its
 * own words, and which of them someone can actually do something about.
 *
 * Amounts are positive magnitudes, as the statements store them: a bigger
 * number is a bigger charge.
 */

export interface FeeTrendDef<F> {
  /** The key on the channel's facts, which is also its statement's line key. */
  id: Extract<keyof F, string>
  /** As the channel's own statement names it. One figure, one name. */
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

export interface FeeTrendPoint {
  month: string
  amount: number
}

export interface FeeTrend<F> {
  def: FeeTrendDef<F>
  points: FeeTrendPoint[]
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

const amountOf = <F,>(facts: F | undefined, id: Extract<keyof F, string>): number => {
  const value = facts?.[id]
  return typeof value === 'number' ? value : 0
}

export function buildFeeTrend<F extends { month: string }>(
  def: FeeTrendDef<F>,
  months: string[],
  facts: F[],
): FeeTrend<F> {
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

/**
 * The fees that were charged something, the ones with a lever first and the
 * biggest of those first.
 *
 * Ordering by size alone puts commission at the top of every list, which is
 * true and useless: it is a rate card. The fee worth reading first is the
 * largest one somebody can move.
 */
export function rankFeeTrends<T extends { def: { lever?: string }; total: number; monthsCharged: number }>(
  trends: T[],
): T[] {
  return trends
    .filter((t) => t.monthsCharged > 0)
    .sort((a, b) => {
      if (Boolean(a.def.lever) !== Boolean(b.def.lever)) return a.def.lever ? -1 : 1
      return Math.abs(b.total) - Math.abs(a.total)
    })
}
