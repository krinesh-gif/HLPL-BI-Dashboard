import { describe, expect, it } from 'vitest'
import type { FlipkartPnlFacts } from '@/data/models'
import { AMAZON_AE_LINE_DEFS } from './amazonAe'
import { AMAZON_IN_SELLER_LINE_DEFS } from './amazonInSeller'
import { AMAZON_IN_SELLER_EXPORT_LINE_DEFS } from './amazonInSellerExport'
import { AMAZON_IN_VENDOR_LINE_DEFS } from './amazonInVendor'
import { AMAZON_USA_LINE_DEFS } from './amazonUsa'
import { BLINKIT_LINE_DEFS } from './blinkit'
import { FLIPKART_LINE_DEFS, computeFlipkartPnl } from './flipkart'
import { MEESHO_LINE_DEFS } from './meesho'
import { MYNTRA_LINE_DEFS } from './myntra'
import { NYKAA_LINE_DEFS } from './nykaa'
import { PURPLLE_LINE_DEFS } from './purplle'
import { SWIGGY_LINE_DEFS } from './swiggyInstamart'
import type { NativeLineDef, NativeLineValues } from './types'

const STATEMENTS: { channel: string; defs: NativeLineDef[] }[] = [
  { channel: 'flipkart', defs: FLIPKART_LINE_DEFS },
  { channel: 'myntra', defs: MYNTRA_LINE_DEFS },
  { channel: 'nykaa', defs: NYKAA_LINE_DEFS },
  { channel: 'meesho', defs: MEESHO_LINE_DEFS },
  { channel: 'blinkit', defs: BLINKIT_LINE_DEFS },
  { channel: 'amazon_in_seller', defs: AMAZON_IN_SELLER_LINE_DEFS },
  { channel: 'amazon_in_seller_export', defs: AMAZON_IN_SELLER_EXPORT_LINE_DEFS },
  { channel: 'amazon_in_vendor', defs: AMAZON_IN_VENDOR_LINE_DEFS },
  { channel: 'amazon_us', defs: AMAZON_USA_LINE_DEFS },
  { channel: 'amazon_ae', defs: AMAZON_AE_LINE_DEFS },
  { channel: 'purplle', defs: PURPLLE_LINE_DEFS },
  { channel: 'swiggy_instamart', defs: SWIGGY_LINE_DEFS },
]

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
 * reading, and adding those as well would count the same charge twice.
 *
 * A memo line is reference and never part of a sum — except where the line
 * it is a memo of is this block's own head, which is a different statement:
 * it says the figure is inside the total above and must not be added to the
 * statement a second time, not that the total above excludes it. Myntra's
 * Commission Discount is the case. Myntra prints Rewards & Other Benefits at
 * 42,276, of which only the 30,131 incentive reaches the bank and the 12,145
 * discount is already inside the commission fee. Both are parts of the 42,276,
 * so a reader who opens that block has to land back on it.
 */
export function groupTotalsAgree(defs: NativeLineDef[], values: NativeLineValues): string[] {
  const complaints: string[] = []
  for (const head of defs.filter((d) => d.isGroupHead && d.group)) {
    const leaves = defs.filter(
      (d) =>
        d.group === head.group && !d.isGroupHead && d.kind === 'input' &&
        (!d.memoOf || d.memoOf === head.key),
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

/**
 * The shape of the bargain, on every statement.
 *
 * Grouping moves no money — it reorders the lines and tags them — so what
 * can go wrong is structural: a total with nothing behind it, a block whose
 * charges sit above the figure they add to, two heads claiming one group.
 * Each of those reads as a broken statement rather than a wrong one, and
 * each is invisible until someone opens the block.
 */
describe('every collapsible block is well formed', () => {
  it.each(STATEMENTS)('$channel opens each block on its total', ({ defs }) => {
    const groups = [...new Set(defs.map((d) => d.group).filter((g): g is string => Boolean(g)))]
    for (const group of groups) {
      const members = defs.filter((d) => d.group === group)
      const heads = members.filter((d) => d.isGroupHead)
      expect(heads, `${group} should have exactly one head`).toHaveLength(1)
      expect(members[0].isGroupHead, `${group} should open on its total`).toBe(true)
      expect(members.length, `${group} hides nothing`).toBeGreaterThan(1)
    }
  })

  it.each(STATEMENTS)('$channel leaves no head without a group to head', ({ defs }) => {
    for (const d of defs.filter((x) => x.isGroupHead)) {
      expect(d.group, `${d.key} is a head with no group`).toBeTruthy()
    }
  })

  /**
   * "Total …" where the block sums charges of one kind, "Net …" where it
   * nets credits against them. The head is the only line of a closed block,
   * so its name is the whole label a reader gets.
   */
  it.each(STATEMENTS)('$channel names every total block Total… or Net…', ({ defs }) => {
    for (const head of defs.filter((d) => d.isGroupHead)) {
      expect(head.label, `${head.key}`).toMatch(/^(Total|Net) /)
    }
  })

  it('covers every statement the app renders', () => {
    expect(STATEMENTS).toHaveLength(12)
  })
})
