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
import { DEDUCTION_MARK } from '../multiMonthPnl'
import type { NativeLineDef } from './types'

/**
 * One name per figure, across every channel.
 *
 * The statements were each written against the marketplace that produces
 * them, and the same two lines ended up with seven spellings between them —
 * "Total COGS" on four, "Total Cost of Goods Sold" on Meesho, "Cost of Goods
 * Sold" on Amazon USA, "Less: Cost of goods sold" on Blinkit; the allocated
 * share of head office was "Less: Other Costs (allocated fixed expenses)",
 * "Total Operating Overheads", "Less: Allocated overheads" and "Less:
 * Allocated company overheads". Reading two channels side by side, that looks
 * like two different figures.
 *
 * The owner settled it: `Total COGS` and `(−) Allocated Fixed Expenses`.
 * This holds the statements to it, because a name only stays settled if
 * something checks.
 */
const CHANNELS: { channel: string; defs: NativeLineDef[] }[] = [
  { channel: 'flipkart', defs: FLIPKART_LINE_DEFS },
  { channel: 'meesho', defs: MEESHO_LINE_DEFS },
  { channel: 'myntra', defs: MYNTRA_LINE_DEFS },
  { channel: 'nykaa', defs: NYKAA_LINE_DEFS },
  { channel: 'amazon_in', defs: AMAZON_IN_SELLER_LINE_DEFS },
  { channel: 'blinkit', defs: BLINKIT_LINE_DEFS },
  { channel: 'amazon_us', defs: AMAZON_USA_LINE_DEFS },
  { channel: 'amazon_ae', defs: AMAZON_AE_LINE_DEFS },
  { channel: 'amazon_in_vendor', defs: AMAZON_IN_VENDOR_LINE_DEFS },
  { channel: 'amazon_in_seller_export', defs: AMAZON_IN_SELLER_EXPORT_LINE_DEFS },
  { channel: 'purplle', defs: PURPLLE_LINE_DEFS },
  { channel: 'swiggy_instamart', defs: SWIGGY_LINE_DEFS },
]

/** The line each channel deducts the cost of the goods on, and the line it
 * deducts its share of the month's fixed expenses on. */
const AGREED: { keys: string[]; label: string }[] = [
  { keys: ['totalCogs', 'cogs', 'cogsUsd'], label: 'Total COGS' },
  { keys: ['otherCosts', 'overheads', 'allocatedOverheadsUsd'], label: '(−) Allocated Fixed Expenses' },
]

describe('the same figure is called the same thing on every statement', () => {
  it.each(CHANNELS)('$channel uses the agreed names', ({ defs }) => {
    for (const { keys, label } of AGREED) {
      for (const def of defs.filter((d) => keys.includes(d.key))) {
        expect(def.label, `${def.key} should read "${label}"`).toBe(label)
      }
    }
  })

  it.each(CHANNELS)('$channel has exactly one of each', ({ defs }) => {
    // Two lines claiming to be the COGS deduction is the confusion this test
    // exists to stop, whichever way round they are spelled.
    for (const { label } of AGREED) {
      expect(defs.filter((d) => d.label === label).length).toBeLessThanOrEqual(1)
    }
  })

  it.each(CHANNELS)('$channel retires the old wordings', ({ defs }) => {
    const stale = defs
      .filter((d) => /overhead|other costs|cost of goods sold/i.test(d.label))
      // A heading may still say what the section is about in full.
      .filter((d) => d.kind === 'input' || d.kind === 'subtotal')
      .map((d) => `${d.key}: ${d.label}`)
    expect(stale).toEqual([])
  })

  it('only the deduction carries the minus, not the lines that make it up', () => {
    // "(−) COGS — priced SKUs" above a "(−) COGS" subtotal reads as two
    // deductions of the same money.
    for (const { defs } of CHANNELS) {
      const hasSubtotal = defs.some((d) => d.key === 'totalCogs')
      if (!hasSubtotal) continue
      for (const def of defs.filter((d) => d.key.startsWith('cogs') && d.kind === 'input')) {
        expect(def.label.startsWith(DEDUCTION_MARK), `${def.key} is a component, not the deduction`).toBe(false)
      }
    }
  })
})

/**
 * A deduction is marked "(−) ", not "Less: ".
 *
 * The word was five characters on the widest column of a table read by
 * scanning across, and it had to be translated into arithmetic by every
 * reader. The mark is the arithmetic. This holds every statement to it,
 * including the ones added later: a channel written against the old
 * convention would otherwise sit beside the others spelling the same idea
 * two ways.
 *
 * U+2212 MINUS SIGN, not a hyphen — it is drawn at digit width and height,
 * so it sits level with the figures beside it.
 */
describe('every statement marks a deduction the same way', () => {
  it('uses a true minus sign, not a hyphen or a dash', () => {
    expect(DEDUCTION_MARK).toBe('(−)')
    expect(DEDUCTION_MARK).not.toContain('-')
    expect(DEDUCTION_MARK).not.toContain('\u2013')
  })

  it.each(CHANNELS)('$channel has no line left saying "Less:"', ({ defs }) => {
    const stale = defs.filter((d) => /\bless:/i.test(d.label)).map((d) => `${d.key}: ${d.label}`)
    expect(stale).toEqual([])
  })

  it.each(CHANNELS)('$channel marks its deductions with the agreed sign', ({ defs }) => {
    // Every statement deducts something, so a channel with no marked line at
    // all has been written to some other convention.
    expect(defs.some((d) => d.label.startsWith(DEDUCTION_MARK))).toBe(true)
  })
})
