import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { blinkitMonthFromPaths, normalizeBlinkitPayoutZip } from './blinkitPayout'

const ARCHIVE = '/root/.claude/uploads/f24a295e-093a-5385-9288-97acefc06862/6e71377f-payout_sheet_2026-08-01_To_2026-08-31.zip'

describe('which month an archive covers', () => {
  it('reads the cycle out of the folder Blinkit names', () => {
    expect(blinkitMonthFromPaths(['payout_sheet_2026-08-01 To 2026-08-31/Payout Breakup.xlsx'])).toBe('2026-08')
  })

  it('falls back to the file name, since a download often gets renamed', () => {
    expect(blinkitMonthFromPaths(['junk/x.xlsx'], 'payout_sheet_2026-11-01_To_2026-11-30.zip')).toBe('2026-11')
  })

  it('says nothing rather than guessing when no cycle is named', () => {
    expect(blinkitMonthFromPaths(['stuff/Payout Breakup.xlsx'], 'payout.zip')).toBeNull()
  })
})

/**
 * The owner's own August archive, read end to end. These are his figures, not
 * a fixture: the point of the test is that the code agrees with the file
 * Blinkit sent, which is the only thing the P&L can be checked against.
 */
describe.skipIf(!existsSync(ARCHIVE))('the owner’s August 2026 payout archive', () => {
  const run = () => normalizeBlinkitPayoutZip(readFileSync(ARCHIVE), 'test-import', 'payout_sheet_2026-08-01_To_2026-08-31.zip')

  it('reads the statement Blinkit published', async () => {
    const r = await run()
    expect(r.facts.month).toBe('2026-08')
    expect(r.facts.customerPayable).toBe(6430)
    expect(r.facts.commission).toBeCloseTo(128.6, 2)
    expect(r.facts.commissionGst).toBeCloseTo(23.15, 2)
    expect(r.facts.shipping).toBe(1500)
    expect(r.facts.shippingGst).toBe(270)
    expect(r.facts.tds).toBeCloseTo(5.45, 2)
    expect(r.facts.storageCharge).toBe(3126)
    expect(r.facts.storageChargeGst).toBeCloseTo(562.68, 2)
    expect(r.facts.netPayoutPerFile).toBeCloseTo(814.12, 2)
  })

  it('leaves nothing on the statement unaccounted for', async () => {
    const r = await run()
    expect(r.unknownPayoutRows).toEqual([])
  })

  it('agrees with the detail sheets behind it', async () => {
    const r = await run()
    // Every check passing is what says the statement and its workings are the
    // same month. A failure here is a real discrepancy, not a parser bug.
    expect(r.checks.filter((c) => !c.passed)).toEqual([])
  })

  it('reads the 30 delivered lines and ties them to customer payable', async () => {
    const r = await run()
    expect(r.validRecords).toHaveLength(30)
    expect(r.invalidRows).toEqual([])
    expect(r.facts.unitsSold).toBe(30)
    expect(r.validRecords.reduce((n, x) => n + x.grossSales, 0)).toBe(6430)
    // Net sales is stated ex-GST, as on every other channel.
    expect(r.facts.outputGstOnSales).toBeCloseTo(980.94, 2)
    expect(r.validRecords.reduce((n, x) => n + x.netSales, 0)).toBeCloseTo(6430 - 980.94, 2)
  })

  it('stores each line under Blinkit’s own item code, to be mapped later', async () => {
    const r = await run()
    // There is no seller SKU anywhere in the archive, so this is the code SKU
    // Mapping has to be pointed at.
    expect(r.validRecords.every((x) => /^\d+$/.test(x.sku))).toBe(true)
    expect(new Set(r.validRecords.map((x) => x.lineId)).size).toBe(30)
    expect(r.validRecords.every((x) => x.channel === 'blinkit')).toBe(true)
  })

  it('holds the LP-SP adjustments out of the statement, as a flagged memo', async () => {
    const r = await run()
    // Not one rupee of these appears in Blinkit's Payout Breakup, and they are
    // against goods received months earlier, so folding them into revenue
    // would be inventing income.
    expect(r.facts.lpSpAdjustmentLines).toBe(26)
    expect(r.facts.lpSpAdjustmentInclTax).toBeCloseTo(4483.4, 2)
    expect(r.warnings.some((w) => w.includes('landing-price/selling-price'))).toBe(true)
    // Four of the thirty rows name a product and carry no amount at all.
    // Blinkit's own blanks, reported rather than skipped in silence.
    expect(r.warnings.some((w) => w.includes('4 landing-price/selling-price row(s)'))).toBe(true)
  })
})
