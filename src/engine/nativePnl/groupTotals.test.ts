import { describe, expect, it } from 'vitest'
import type { FlipkartPnlFacts } from '@/data/models'
import { FLIPKART_LINE_DEFS, computeFlipkartPnl } from './flipkart'
import type { NativeLineDef, NativeLineValues } from './types'

/**
 * A total opens the block and its charges sit under it, one click away.
 *
 * Which only works if the total is the sum of what it hides. A reader who
 * expands a block and adds the lines up has to land on the figure that was
 * showing before they opened it — otherwise the statement is asking to be
 * trusted on a number it will not show its working for.
 */
const SEPT: FlipkartPnlFacts = {
  month: '2026-09', grossSales: 1_745_467, estimatedNetSales: 1_414_973,
  sellerFundedDiscount: 4_582.34, customerAddOns: 543, outputGst: 130_446.602,
  cogsPriced: 171_550.75, cogsUnpriced: 269_576.04,
  commissionFee: 85_801.805, fixedFee: 81_600, collectionFee: 0, pickPackFee: 71_848,
  forwardShippingFee: 0, reverseShippingFee: 4_255, storageFee: 75_818.28,
  recallFee: 51_965, otherMarketplaceFees: 1_276.359, rewardsSpf: 14_932.42,
  flipkartAds: 288_843.31, googleAds: 60_692.076,
} as FlipkartPnlFacts

/**
 * Every group's head against the sum of the leaves it hides.
 *
 * Only `input` leaves are added: a group may carry its own sub-totals for
 * reading, and adding those as well would count the same charge twice. A memo
 * line is reference, never part of a sum.
 */
export function groupTotalsAgree(defs: NativeLineDef[], values: NativeLineValues): string[] {
  const complaints: string[] = []
  for (const head of defs.filter((d) => d.isGroupHead && d.group)) {
    const leaves = defs.filter(
      (d) => d.group === head.group && !d.isGroupHead && d.kind === 'input' && !d.memoOf,
    )
    const summed = leaves.reduce((sum, d) => sum + (values[d.key] ?? 0), 0)
    const shown = values[head.key] ?? 0
    if (Math.abs(summed - shown) > 0.005) {
      complaints.push(`${head.label}: shows ${shown.toFixed(2)}, its ${leaves.length} parts add to ${summed.toFixed(2)}`)
    }
  }
  return complaints
}

describe('a total is the sum of the charges it hides', () => {
  const values = computeFlipkartPnl(SEPT)

  it('Flipkart: every group head equals its parts', () => {
    expect(groupTotalsAgree(FLIPKART_LINE_DEFS, values)).toEqual([])
  })

  it('opens each cost block on its total, not on its charges', () => {
    for (const group of ['cogs', 'fees', 'ads']) {
      const members = FLIPKART_LINE_DEFS.filter((d) => d.group === group)
      expect(members.length, group).toBeGreaterThan(1)
      expect(members[0].isGroupHead, `${group} should open on its total`).toBe(true)
      expect(members.slice(1).some((d) => d.isGroupHead), `${group} has two heads`).toBe(false)
    }
  })

  it('notices when a total stops matching its parts', () => {
    // The guard has to bite, or it is decoration.
    const wrong = { ...values, commissionFee: (values.commissionFee ?? 0) - 1_000 }
    expect(groupTotalsAgree(FLIPKART_LINE_DEFS, wrong)).toHaveLength(1)
  })

  it('leaves the credit outside the fees it is not one of', () => {
    // Rewards & SPF moves the margin below the total, not the total itself.
    expect(FLIPKART_LINE_DEFS.find((d) => d.key === 'rewardsSpf')?.group).toBeUndefined()
  })
})
