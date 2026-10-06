import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { normalizeBlinkitPayoutZip } from '@/data/normalize/blinkitPayout'
import { blinkitToCanonicalBuckets, computeBlinkitPnl } from './blinkit'
import type { BlinkitPnlFacts } from '@/data/models'

const ARCHIVE = '/root/.claude/uploads/f24a295e-093a-5385-9288-97acefc06862/6e71377f-payout_sheet_2026-08-01_To_2026-08-31.zip'

const facts = (over: Partial<BlinkitPnlFacts> = {}): BlinkitPnlFacts => ({
  schemaVersion: 1, month: '2026-08',
  customerPayable: 0, outputGstOnSales: 0, mrpValue: 0, unitsSold: 0, orderLines: 0,
  commission: 0, commissionGst: 0, shipping: 0, shippingGst: 0,
  customerReturnCharge: 0, customerReturnChargeGst: 0, tcs: 0, tds: 0,
  upfrontStorage: 0, upfrontStorageGst: 0, recallCharge: 0, recallChargeGst: 0,
  storageCharge: 0, storageChargeGst: 0, courierCharge: 0, courierChargeGst: 0,
  adsRefund: 0, adsRefundGst: 0, lostDamagedCompensation: 0,
  tcsReimbursement: 0, tdsReimbursement: 0, otherCreditDebitNote: 0,
  otherDeductions: 0, netPayoutPerFile: 0,
  lpSpAdjustmentInclTax: 0, lpSpAdjustmentTax: 0, lpSpAdjustmentLines: 0, ...over,
})

describe.skipIf(!existsSync(ARCHIVE))('August 2026, from the owner’s own archive', () => {
  const load = async () =>
    computeBlinkitPnl((await normalizeBlinkitPayoutZip(readFileSync(ARCHIVE), 't', 'payout_sheet_2026-08-01_To_2026-08-31.zip')).facts)

  it('lands on the net payout Blinkit states, to the paisa', async () => {
    const v = await load()
    // The whole statement is worth nothing if this line disagrees with the
    // file, because that is the one figure the bank also knows.
    expect(v.netPayout).toBeCloseTo(814.12, 2)
    expect(v.payoutPerFile).toBeCloseTo(814.12, 2)
  })

  it('states revenue ex-GST', async () => {
    const v = await load()
    expect(v.customerPayable).toBe(6430)
    expect(v.netRevenue).toBeCloseTo(6430 - 980.94, 2)
  })

  it('shows storage dwarfing commission, which is the point of the month', async () => {
    const v = await load()
    // ₹3,126 of ageing against ₹128.60 of commission on ₹6,430 of sales. If
    // these were grouped as one "marketplace fees" line the only actionable
    // number on the statement would be invisible.
    expect(-v.storageCharge).toBe(3126)
    expect(-v.commission).toBeCloseTo(128.6, 2)
    expect(-v.totalInventoryCharges).toBeGreaterThan(-v.totalOrderCharges)
  })

  it('is thin but positive before cost of goods', async () => {
    const v = await load()
    // 5,449.06 of net revenue, less 1,628.60 of order charges, less 3,126 of
    // ageing, is 694.46. Storage alone takes 57% of what Blinkit sold.
    expect(v.cm1).toBeCloseTo(3820.46, 2)
    expect(v.cm2).toBeCloseTo(694.46, 2)
    expect(-v.totalInventoryCharges / v.netRevenue).toBeGreaterThan(0.5)
  })

  it('keeps the LP-SP memo out of every margin', async () => {
    const v = await load()
    expect(v.lpSpAdjustment).toBeCloseTo(4483.4, 2)
    // Six times CM2, on a month whose net revenue is 5,449. Folding it in
    // would be the difference between a thin month and a good one, which is
    // exactly why it waits for someone to confirm what it settles.
    expect(v.cm3).toBeCloseTo(694.46, 2)
    expect(v.lpSpAdjustment).toBeGreaterThan(v.cm3 * 5)
  })
})

describe('the statement holds together', () => {
  it('reports nil rather than dividing by it in a month with no trade', () => {
    const v = computeBlinkitPnl(facts())
    expect(v.netRevenue).toBe(0)
    expect(Number.isFinite(v.cm1Pct)).toBe(true)
    expect(Number.isFinite(v.ebitdaPct)).toBe(true)
  })

  it('treats a storage reversal bigger than its charge as the credit it is', () => {
    // Negation, not absolute value. A month whose credit notes exceed its
    // ageing really was paid back, and must not read as a cost.
    const v = computeBlinkitPnl(facts({ customerPayable: 1000, storageCharge: -250 }))
    expect(v.storageCharge).toBe(250)
    expect(v.cm2).toBe(1250)
  })

  it('lifts the margin when Blinkit refunds, rather than lowering it', () => {
    const base = computeBlinkitPnl(facts({ customerPayable: 1000 }))
    const refunded = computeBlinkitPnl(facts({ customerPayable: 1000, adsRefund: 300 }))
    expect(refunded.cm3 - base.cm3).toBe(300)
  })

  it('agrees with the canonical buckets on what Blinkit sold', () => {
    // The native statement and the Master P&L must not disagree about one
    // channel's net sales, or the roll-up is not the sum of its parts.
    const f = facts({ customerPayable: 6430, outputGstOnSales: 980.94, commission: 128.6, shipping: 1500, storageCharge: 3126 })
    const b = blinkitToCanonicalBuckets(f)
    const canonicalNetSales = (b.grossSales ?? 0) - (b.discounts ?? 0) - (b.returns ?? 0) - (b.otherRevenueAdj ?? 0)
    expect(canonicalNetSales).toBeCloseTo(computeBlinkitPnl(f).netRevenue, 6)
  })

  it('files storage as fulfilment, not as commission', () => {
    const b = blinkitToCanonicalBuckets(facts({ storageCharge: 3126, upfrontStorage: 10, commission: 128.6 }))
    expect(b.fulfilment).toBe(3136)
    expect(b.marketplaceCommission).toBeCloseTo(128.6, 2)
  })
})
