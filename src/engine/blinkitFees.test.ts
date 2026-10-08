import { describe, expect, it } from 'vitest'
import type { BlinkitPnlFacts } from '@/data/models'
import { BLINKIT_FEE_LINES, blinkitFeeSeries, buildBlinkitFeeSeries } from './blinkitFees'
import { BLINKIT_LINE_DEFS } from './nativePnl/blinkit'

/**
 * Blinkit's charges, read as a trend.
 *
 * The figures here are the owner's own: August 2026's archive charges ₹3,126
 * of storage against ₹128.60 of commission, and April's ₹11,778.76 against
 * ₹350.98. That shape — the charge nobody bills you for dwarfing the one on
 * the rate card — is the whole reason this screen exists.
 */
const month = (m: string, over: Partial<BlinkitPnlFacts>): BlinkitPnlFacts => ({
  schemaVersion: 1, month: m,
  customerPayable: 0, outputGstOnSales: 0, mrpValue: 0, unitsSold: 0, orderLines: 0,
  commission: 0, commissionGst: 0, shipping: 0, shippingGst: 0,
  customerReturnCharge: 0, customerReturnChargeGst: 0, tcs: 0, tds: 0,
  upfrontStorage: 0, upfrontStorageGst: 0, recallCharge: 0, recallChargeGst: 0,
  storageCharge: 0, storageChargeGst: 0, courierCharge: 0, courierChargeGst: 0,
  adsRefund: 0, adsRefundGst: 0, lostDamagedCompensation: 0,
  tcsReimbursement: 0, tdsReimbursement: 0, otherCreditDebitNote: 0,
  otherDeductions: 0, netPayoutPerFile: 0,
  lpSpAdjustmentInclTax: 0, lpSpAdjustmentTax: 0, lpSpAdjustmentLines: 0,
  ...over,
})

const MONTHS = ['2026-04', '2026-08']
const FACTS = [
  month('2026-04', { storageCharge: 11778.76, commission: 350.98, shipping: 4050, courierCharge: 4757.76 }),
  month('2026-08', { storageCharge: 3126, commission: 128.6, shipping: 1500 }),
]

describe('a Blinkit charge read month by month', () => {
  const storage = buildBlinkitFeeSeries(BLINKIT_FEE_LINES.find((d) => d.id === 'storageCharge')!, MONTHS, FACTS)

  it('puts each month in the order it was asked for', () => {
    expect(storage.points.map((p) => p.month)).toEqual(MONTHS)
    expect(storage.points.map((p) => p.amount)).toEqual([11778.76, 3126])
  })

  it('totals the period and counts the months it was charged in', () => {
    expect(storage.total).toBeCloseTo(14904.76, 2)
    expect(storage.monthsCharged).toBe(2)
  })

  it('reports the fall as a fall', () => {
    expect(storage.changeLastMonth).toBeCloseTo(3126 - 11778.76, 2)
    expect(storage.vsAveragePct).toBeCloseTo(((3126 - 11778.76) / 11778.76) * 100, 4)
  })

  it('leaves a month with no earlier month unmeasurable rather than flat', () => {
    // 0% would read as "no change". There is no baseline, which is different.
    const one = buildBlinkitFeeSeries(BLINKIT_FEE_LINES[0], ['2026-08'], FACTS)
    expect(one.changeLastMonth).toBeNull()
    expect(one.vsAveragePct).toBeNull()
  })

  it('counts a month Blinkit did not raise the charge in as not charged', () => {
    const recall = buildBlinkitFeeSeries(BLINKIT_FEE_LINES.find((d) => d.id === 'recallCharge')!, MONTHS, FACTS)
    expect(recall.monthsCharged).toBe(0)
    expect(recall.total).toBe(0)
  })
})

describe('the list of charges', () => {
  const list = blinkitFeeSeries(MONTHS, FACTS)

  it('leaves out the charges that were never raised', () => {
    expect(list.map((s) => s.def.id)).not.toContain('recallCharge')
    expect(list.every((s) => s.monthsCharged > 0)).toBe(true)
  })

  it('puts the storage charge first, because it is the one with a lever', () => {
    // Not merely the biggest: ordering by size alone would be a list headed by
    // whatever Blinkit's rate card happens to charge most for, which is true
    // and useless. Storage is both here, which is the point.
    expect(list[0].def.id).toBe('storageCharge')
    expect(list[0].def.lever).toBeTruthy()
  })

  it('ranks every actionable charge above every rate-card one', () => {
    const lastLever = list.map((s) => Boolean(s.def.lever)).lastIndexOf(true)
    const firstFixed = list.map((s) => Boolean(s.def.lever)).indexOf(false)
    if (firstFixed >= 0) expect(lastLever).toBeLessThan(firstFixed)
  })

  it('dwarfs commission with storage, which is the finding', () => {
    const storage = list.find((s) => s.def.id === 'storageCharge')!
    const commission = list.find((s) => s.def.id === 'commission')!
    expect(storage.total / commission.total).toBeGreaterThan(20)
  })
})

describe('one name per figure', () => {
  it('calls each charge what Blinkit’s own statement calls it', () => {
    // A charge named one thing on the statement and another on the screen
    // beside it reads as two different charges.
    const onStatement = new Map(BLINKIT_LINE_DEFS.map((d) => [d.key, d.label]))
    for (const def of BLINKIT_FEE_LINES) {
      const statementLabel = onStatement.get(def.id)
      if (statementLabel) expect(def.label, `${def.id} is "${statementLabel}" on the statement`).toBe(statementLabel)
    }
  })

  it('names a key that exists on the facts', () => {
    const facts = month('2026-08', {})
    for (const def of BLINKIT_FEE_LINES) expect(facts).toHaveProperty(def.id)
  })

  it('offers each charge once', () => {
    expect(new Set(BLINKIT_FEE_LINES.map((d) => d.id)).size).toBe(BLINKIT_FEE_LINES.length)
  })
})
