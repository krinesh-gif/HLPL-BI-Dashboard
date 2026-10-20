import { describe, expect, it } from 'vitest'
import { AMAZON_AE_LINE_DEFS } from './amazonAe'
import { AMAZON_IN_SELLER_LINE_DEFS } from './amazonInSeller'
import { AMAZON_IN_SELLER_EXPORT_LINE_DEFS } from './amazonInSellerExport'
import { AMAZON_IN_VENDOR_LINE_DEFS } from './amazonInVendor'
import { AMAZON_USA_LINE_DEFS } from './amazonUsa'
import { BLINKIT_LINE_DEFS } from './blinkit'
import { FLIPKART_LINE_DEFS } from './flipkart'
import { MEESHO_LINE_DEFS } from './meesho'
import { MYNTRA_LINE_DEFS } from './myntra'
import { NYKAA_LINE_DEFS } from './nykaa'
import { PURPLLE_LINE_DEFS } from './purplle'
import { SWIGGY_LINE_DEFS } from './swiggyInstamart'
import type { NativeLineDef } from './types'

/**
 * One ladder, on every statement.
 *
 * Each statement was written against the marketplace that produces it, and
 * each inherited that marketplace's order of deduction. Amazon's settlement
 * nets its fees before it mentions a cost of goods; Blinkit's payout sheet
 * works down from what the shopper paid through every charge it makes and
 * never mentions the goods at all; Myntra prints its charges at the top
 * because it cannot know what the goods cost. Following each in turn gave
 * eleven statements whose CM1 meant five different things:
 *
 *   Flipkart, Myntra, Amazon Vendor   after the goods
 *   Amazon India Seller               after the goods AND Amazon's fees
 *   Amazon India export, Amazon USA   after the marketplace, before the goods
 *   Blinkit                           after the order charges, before the goods
 *   Meesho                            after the marketplace charges
 *   Nykaa, Purplle, Swiggy, UAE       no CM naming at all
 *
 * Two channels could not be read side by side, and the figure the P&L calls
 * this channel's gross profit was not the figure the statement called CM1.
 *
 * The owner settled it: Flipkart's ladder, on all of them. The goods, then
 * the marketplace, then advertising, then this channel's share of the fixed
 * expenses. A statement keeps its own vocabulary for the charges — they are
 * its marketplace's charges — and gives up its own order for them.
 *
 * Nothing here checks a number. It checks that the rungs exist, are named
 * the one agreed way, and come in the one agreed order, because that is what
 * stops the next channel from arriving with a sixth meaning for CM1.
 */
const STATEMENTS: { channel: string; defs: NativeLineDef[] }[] = [
  { channel: 'flipkart', defs: FLIPKART_LINE_DEFS },
  { channel: 'myntra', defs: MYNTRA_LINE_DEFS },
  { channel: 'nykaa', defs: NYKAA_LINE_DEFS },
  { channel: 'meesho', defs: MEESHO_LINE_DEFS },
  { channel: 'blinkit', defs: BLINKIT_LINE_DEFS },
  { channel: 'amazon_in_seller', defs: AMAZON_IN_SELLER_LINE_DEFS },
  { channel: 'amazon_in_seller_export', defs: AMAZON_IN_SELLER_EXPORT_LINE_DEFS },
  { channel: 'amazon_in_vendor', defs: AMAZON_IN_VENDOR_LINE_DEFS },
  { channel: 'amazon_usa', defs: AMAZON_USA_LINE_DEFS },
  { channel: 'amazon_ae', defs: AMAZON_AE_LINE_DEFS },
  { channel: 'purplle', defs: PURPLLE_LINE_DEFS },
  { channel: 'swiggy_instamart', defs: SWIGGY_LINE_DEFS },
]

/** The rungs, in the order they are struck, and the exact words for each. */
const LADDER = [
  'GROSS MARGIN (CM1)',
  'CM1 %',
  'CHANNEL MARGIN (CM2)',
  'CM2 %',
  'CONTRIBUTION MARGIN (CM3)',
  'CM3 %',
  '(−) Allocated Fixed Expenses',
  'NET PROFIT (CM4)',
  'Net Profit %',
]

describe('every statement is read on the same ladder', () => {
  it.each(STATEMENTS)('$channel strikes all four margins', ({ defs }) => {
    const labels = defs.map((d) => d.label)
    for (const rung of LADDER) {
      expect(labels.filter((l) => l === rung), `${rung}`).toHaveLength(1)
    }
  })

  it.each(STATEMENTS)('$channel strikes them in that order', ({ defs }) => {
    const labels = defs.map((d) => d.label)
    const positions = LADDER.map((rung) => labels.indexOf(rung))
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  /**
   * The goods above CM1 and the marketplace below it. This is the ordering
   * that actually moved, and the one a statement written against a
   * marketplace's own report will get wrong again: the charge block has to
   * sit between the first margin and the second, never above the first.
   */
  it.each(STATEMENTS)('$channel deducts the goods before the marketplace', ({ defs }) => {
    const labels = defs.map((d) => d.label)
    const cm1 = labels.indexOf('GROSS MARGIN (CM1)')
    const cm2 = labels.indexOf('CHANNEL MARGIN (CM2)')

    // Whatever each marketplace calls its own cost of goods.
    const cogs = defs.findIndex((d) => /^(Total COGS|Total Landed Cost)$/.test(d.label))
    expect(cogs, 'no cost-of-goods line').toBeGreaterThan(-1)
    expect(cogs).toBeLessThan(cm1)

    // And every charge block below the revenue line, between the two margins.
    // A head is the only line of a closed block, so its position is the
    // block's position.
    //
    // Above the revenue line is a different question and keeps its own order:
    // how this channel gets to a revenue figure at all. Nykaa's margin and
    // the discount it charges back are deducted there because Nykaa buys the
    // goods rather than selling them for us, and Myntra's whole report is
    // reproduced there, charges first, as Myntra prints it. Neither is a
    // charge against the margin below; Myntra restates its charges as their
    // own block in the ladder, where this does check them.
    // The last one before CM1: Nykaa states net sales at MRP first and
    // reaches the revenue the margins are measured on several lines later.
    const revenue = defs.reduce(
      (last, d, i) =>
        i < cm1 && d.kind === 'subtotal' && /^net (revenue|sales)\b/i.test(d.label) ? i : last,
      -1,
    )
    expect(revenue, 'no net revenue line').toBeGreaterThan(-1)

    const chargeHeads = defs
      .map((d, i) => ({ d, i }))
      .filter(({ d }) => d.isGroupHead && !/COGS|Landed Cost|Advertising/.test(d.label))
    for (const { d, i } of chargeHeads) {
      // The memo blocks below Net Profit are reconciliation, not cost.
      if (i < revenue || i > labels.indexOf('NET PROFIT (CM4)')) continue
      expect(i, `${d.label} should sit between CM1 and CM2`).toBeGreaterThan(cm1)
      expect(i, `${d.label} should sit between CM1 and CM2`).toBeLessThan(cm2)
    }
  })

  it('covers every statement the app renders', () => {
    expect(STATEMENTS).toHaveLength(12)
  })
})
