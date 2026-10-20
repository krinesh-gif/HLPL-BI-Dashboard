import { describe, expect, it } from 'vitest'
import { PNL_STRUCTURE } from '@/config/pnlStructure'
import type { PnlLineValues } from '@/data/models'
import { buildMasterPnl, computeSubtotals } from './pnl'
import { PNL_ROWS } from './multiMonthPnl'
import { buildMisRows } from './mis'

/**
 * One margin ladder, the same on every view and every channel.
 *
 * CM1 is after the goods, CM2 after the marketplace's fees, CM3 after
 * advertising, CM4 after the channel's own charges and its share of the
 * month's fixed expenses. Each rung answers a different question, and CM2
 * answers the one that decides whether to be on a marketplace at all — which
 * the P&L could not ask, because it had no rung there. Flipkart, Myntra and
 * Amazon Vendor each struck it on their own statement and nowhere else.
 */
const MONTH: PnlLineValues = computeSubtotals({
  grossSales: 1_000_000, discounts: 20_000, returns: 150_000, otherRevenueAdj: 80_000,
  cogs: 260_000,
  marketplaceCommission: 60_000, fulfilment: 25_000, shipping: 12_000,
  collectionFees: 8_000, returnCharges: 3_000, otherMarketplaceCharges: 7_000,
  ads: 90_000, performanceMarketing: 15_000,
  channelCharges: 25_000, fixedExpensesTotal: 40_000, salaries: 30_000,
})

const marketplaceFees = 60_000 + 25_000 + 12_000 + 8_000 + 3_000 + 7_000
const marketing = 90_000 + 15_000

describe('the ladder steps down one cost at a time', () => {
  it('CM1 is net sales less the goods', () => {
    expect(MONTH.grossProfit).toBeCloseTo((MONTH.netSales ?? 0) - 260_000, 6)
  })

  it('CM2 is CM1 less the marketplace fees, and nothing else', () => {
    expect(MONTH.channelMargin).toBeCloseTo((MONTH.grossProfit ?? 0) - marketplaceFees, 6)
  })

  it('CM3 is CM2 less the advertising', () => {
    expect(MONTH.contributionProfit).toBeCloseTo((MONTH.channelMargin ?? 0) - marketing, 6)
  })

  it('CM4 is CM3 less the channel’s charges and its share of the fixed expenses', () => {
    expect(MONTH.ebitda).toBeCloseTo((MONTH.contributionProfit ?? 0) - 25_000 - 40_000 - 30_000, 6)
  })

  it('every rung is a percentage of the same net sales', () => {
    const net = MONTH.netSales ?? 0
    for (const [pct, value] of [
      [MONTH.grossMarginPct, MONTH.grossProfit],
      [MONTH.channelMarginPct, MONTH.channelMargin],
      [MONTH.contributionMarginPct, MONTH.contributionProfit],
      [MONTH.ebitdaMarginPct, MONTH.ebitda],
    ] as const) {
      expect(pct).toBeCloseTo(((value ?? 0) / net) * 100, 6)
    }
  })

  it('has no revenue to measure against, and says so rather than claiming 0%', () => {
    const empty = computeSubtotals({ ads: 5_000 })
    expect(empty.channelMarginPct).toBe(0)
    expect(empty.channelMargin).toBeCloseTo(0, 6)
  })
})

describe('the ladder is named the same way wherever it appears', () => {
  const rungs = ['(CM1 %)', '(CM2 %)', '(CM3 %)', '(CM4 %)']

  it('the P&L names all four', () => {
    const labels = PNL_ROWS.map((r) => r.label)
    for (const rung of rungs) {
      expect(labels.filter((l) => l.includes(rung)), rung).toHaveLength(1)
    }
  })

  it('the Investor MIS names them the same, so the two reports are one ladder', () => {
    const particulars = buildMisRows('2026-09', () => MONTH).map((r) => r.particular)
    for (const rung of rungs) {
      expect(particulars.filter((p) => p.includes(rung)), rung).toHaveLength(1)
    }
    expect(particulars).toContain('Channel Margin (CM2)')
  })

  it('the structure carries the rung as a subtotal, not something that gets summed', () => {
    const def = PNL_STRUCTURE.find((d) => d.key === 'channelMargin')
    expect(def?.kind).toBe('subtotal')
    // An additive line would be double-counted when the channels are summed.
    expect(PNL_STRUCTURE.filter((d) => d.kind === 'input').map((d) => d.key))
      .not.toContain('channelMargin')
  })
})

describe('the company is the sum of its channels at every rung', () => {
  it('adds CM2 across channels exactly, as it does every other subtotal', () => {
    const a = computeSubtotals({ grossSales: 600_000, cogs: 200_000, marketplaceCommission: 50_000, ads: 30_000 })
    const b = computeSubtotals({ grossSales: 400_000, cogs: 150_000, fulfilment: 20_000, ads: 10_000 })
    const master = buildMasterPnl(
      [{ channel: 'flipkart', month: '2026-09', lines: a }, { channel: 'myntra', month: '2026-09', lines: b }],
      '2026-09',
    ).lines
    expect(master.channelMargin).toBeCloseTo((a.channelMargin ?? 0) + (b.channelMargin ?? 0), 6)
  })
})
