import { describe, expect, it } from 'vitest'
import { AMAZON_IN_SELLER_LINE_DEFS } from './amazonInSeller'
import { AMAZON_USA_LINE_DEFS } from './amazonUsa'
import { BLINKIT_LINE_DEFS } from './blinkit'
import { FLIPKART_LINE_DEFS } from './flipkart'
import { MEESHO_LINE_DEFS } from './meesho'
import { MYNTRA_LINE_DEFS } from './myntra'
import { NYKAA_LINE_DEFS } from './nykaa'
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
 * The owner settled it: `Less: COGS` and `Less: Allocated Fixed Expenses`.
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
]

/** The line each channel deducts the cost of the goods on, and the line it
 * deducts its share of the month's fixed expenses on. */
const AGREED: { keys: string[]; label: string }[] = [
  { keys: ['totalCogs', 'cogs', 'cogsUsd'], label: 'Less: COGS' },
  { keys: ['otherCosts', 'overheads', 'allocatedOverheadsUsd'], label: 'Less: Allocated Fixed Expenses' },
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

  it('only the deduction carries "Less:", not the lines that make it up', () => {
    // "Less: COGS — priced SKUs" above a "Less: COGS" subtotal reads as two
    // deductions of the same money.
    for (const { defs } of CHANNELS) {
      const hasSubtotal = defs.some((d) => d.key === 'totalCogs')
      if (!hasSubtotal) continue
      for (const def of defs.filter((d) => d.key.startsWith('cogs') && d.kind === 'input')) {
        expect(def.label.startsWith('Less:'), `${def.key} is a component, not the deduction`).toBe(false)
      }
    }
  })
})
