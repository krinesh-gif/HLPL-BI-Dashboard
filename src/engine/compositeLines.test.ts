import { describe, expect, it } from 'vitest'
import type { PnlLineValues } from '@/data/models'
import { buildMisRows } from './mis'
import { PNL_ROWS } from './multiMonthPnl'
import { SECTION_LABELS } from '@/config/pnlStructure'

/**
 * Two lines on the P&L are sums rather than figures: the marketplace's charges,
 * and what was spent advertising. Each one exists twice in the codebase — once
 * as a P&L row and once as an MIS particular — with its own copy of the list of
 * buckets it adds up and its own copy of the name.
 *
 * Two copies of a figure is how a report starts disagreeing with itself, and
 * two names for it is how a reader starts believing they are different things.
 * The owner settled the names: `Marketplace Fees` and `Advertising (MI)`. These
 * hold both reports to them, and to the same arithmetic underneath.
 */

/** Every bucket a P&L line can hold, each a different number, so a list that
 * has gained or lost one cannot add up to the same total by coincidence. */
const EVERY_BUCKET: PnlLineValues = {
  grossSales: 1_000_000, discounts: 1, returns: 2, otherRevenueAdj: 4, cogs: 8,
  marketplaceCommission: 16, fulfilment: 32, shipping: 64, collectionFees: 128,
  rtoCharges: 256, returnCharges: 512, otherMarketplaceCharges: 1024,
  ads: 2048, performanceMarketing: 4096, otherMarketing: 8192,
  fixedExpensesTotal: 16_384, salaries: 32_768, rent: 65_536, software: 131_072,
  warehouse: 262_144, logistics: 524_288, professionalFees: 1_048_576,
  officeExpenses: 2_097_152, generalExpenses: 4_194_304, otherOpex: 8_388_608,
}

const AGREED = [
  { pnlKey: 'marketplaceCosts', misLabel: 'Marketplace Fees', section: 'marketplaceVariable' },
  { pnlKey: 'marketing', misLabel: 'Advertising (MI)', section: 'marketing' },
] as const

const misRows = buildMisRows('2026-09', (m) => (m === '2026-09' ? EVERY_BUCKET : {}))

describe('the summed lines are one figure under one name', () => {
  it.each(AGREED)('the P&L calls $misLabel what the MIS calls it', ({ pnlKey, misLabel }) => {
    const row = PNL_ROWS.find((r) => r.key === pnlKey)
    // The P&L prefixes a deduction, the MIS does not — that difference is the
    // report's own convention. Everything after it has to match.
    expect(row?.label).toBe(`Less: ${misLabel}`)
  })

  it.each(AGREED)('$misLabel adds up the same on both', ({ pnlKey, misLabel }) => {
    const row = PNL_ROWS.find((r) => r.key === pnlKey)
    const mis = misRows.find((r) => r.particular === misLabel)
    expect(mis, `the MIS should carry a "${misLabel}" particular`).toBeDefined()
    expect(row?.value(EVERY_BUCKET)).toBe(mis!.currentMonth)
  })

  it.each(AGREED)('the structure names the $misLabel section the same way', ({ misLabel, section }) => {
    expect(SECTION_LABELS[section]).toBe(misLabel)
  })

  it('names each figure once, so neither report offers two of them', () => {
    for (const { misLabel } of AGREED) {
      expect(PNL_ROWS.filter((r) => r.label === `Less: ${misLabel}`)).toHaveLength(1)
      expect(misRows.filter((r) => r.particular === misLabel)).toHaveLength(1)
    }
  })

  it('has retired the old names everywhere', () => {
    const retired = /marketplace costs|marketplace \/ variable|^(less: )?marketing$/i
    for (const label of PNL_ROWS.map((r) => r.label)) expect(label).not.toMatch(retired)
    for (const label of misRows.map((r) => r.particular)) expect(label).not.toMatch(retired)
    for (const label of Object.values(SECTION_LABELS)) expect(label).not.toMatch(retired)
  })
})
