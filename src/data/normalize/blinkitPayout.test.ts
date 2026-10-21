import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import {
  blinkitMonthFromCycle, blinkitMonthFromPaths, blinkitOrderDate, detectBlinkitPayoutArchive,
  normalizeBlinkitPayoutWorkbook, normalizeBlinkitPayoutZip,
} from './blinkitPayout'

const ARCHIVE = '/root/.claude/uploads/f24a295e-093a-5385-9288-97acefc06862/6e71377f-payout_sheet_2026-08-01_To_2026-08-31.zip'
const APRIL = '/root/.claude/uploads/f24a295e-093a-5385-9288-97acefc06862/b8c06a89-payout_sheet_2026-04-01_To_2026-04-30.zip'

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

  /**
   * Blinkit used to name these with the month alone, and the owner has
   * archives going back through that name — `payout_sheet_2025-12` is
   * December 2025. Both names are read, so neither era of file has to be
   * renamed by hand before it can be uploaded.
   */
  describe('the older name, the month on its own', () => {
    it('reads the month out of it', () => {
      expect(blinkitMonthFromPaths([], 'payout_sheet_2025-12.zip')).toBe('2025-12')
      expect(blinkitMonthFromPaths(['payout_sheet_2026-03/Payout Breakup.xlsx'])).toBe('2026-03')
    })

    it('does not mistake the start of a cycle for a month of its own', () => {
      // The first four groups of "2026-08-01 To 2026-08-31" read as a bare
      // month if nothing stops them. Here they agree, so the test is that a
      // cycle whose folder and file disagree is settled by the cycle.
      expect(blinkitMonthFromPaths(
        ['payout_sheet_2026-08-01 To 2026-08-31/Payout Breakup.xlsx'],
        'payout_sheet_2025-12.zip',
      )).toBe('2026-08')
    })

    it('is not fooled by a number that is not a month', () => {
      expect(blinkitMonthFromPaths([], 'invoice_2026-47.zip')).toBeNull()
      expect(blinkitMonthFromPaths([], 'ref_2026-00.zip')).toBeNull()
      expect(blinkitMonthFromPaths([], 'id_123456-07.zip')).toBeNull()
    })
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

/**
 * Blinkit publishes this archive in two shapes, and the owner has one of
 * each. The April file was refused outright — "this zip does not look like a
 * Blinkit payout sheet" — because the reader looked for a workbook called
 * `Order_level_charges`, which is a name only the August archive uses.
 */
describe('telling a Blinkit archive from anything else', () => {
  it('knows it by its statement, not by what the workbooks are called', () => {
    // April: thirteen topic-named workbooks, every one carrying the statement.
    expect(detectBlinkitPayoutArchive(['Payout Breakup', 'Forward Orders', 'Daily Ageing'])).toBe(true)
    // August: six lettered workbooks.
    expect(detectBlinkitPayoutArchive(['Payout Breakup', 'Forward & Return Orders', 'Aging Charge'])).toBe(true)
  })

  it('turns away a zip with no statement in it', () => {
    expect(detectBlinkitPayoutArchive(['Sheet1', 'Orders'])).toBe(false)
    expect(detectBlinkitPayoutArchive([])).toBe(false)
  })
})

describe('an order date, as either archive writes it', () => {
  it('reads the ISO date the lettered archive uses', () => {
    expect(blinkitOrderDate('2026-08-01')).toBe('2026-08-01')
    expect(blinkitOrderDate('2026-08-01 00:00:00')).toBe('2026-08-01')
  })

  it('reads the spelled-out date the other one uses', () => {
    // Every one of April's 81 lines was rejected as an unreadable date
    // before this: the reader demanded yyyy-mm-dd.
    expect(blinkitOrderDate('1 April 2026')).toBe('2026-04-01')
    expect(blinkitOrderDate('30 April 2026')).toBe('2026-04-30')
    expect(blinkitOrderDate('01-Apr-2026')).toBe('2026-04-01')
    expect(blinkitOrderDate('9 September 2026')).toBe('2026-09-09')
  })

  it('says nothing rather than guessing at anything else', () => {
    // A guessed date puts real money in the wrong month.
    expect(blinkitOrderDate('')).toBeNull()
    expect(blinkitOrderDate('-')).toBeNull()
    expect(blinkitOrderDate('01/04/2026')).toBeNull()
    expect(blinkitOrderDate('1 Smarch 2026')).toBeNull()
  })
})

/**
 * The owner's April 2026 archive: the other shape, read end to end. Thirteen
 * topic-named workbooks, forward and return orders on separate sheets,
 * charges written as positive magnitudes rather than negatives, and a
 * statement whose rows are spelled differently again.
 */
describe.skipIf(!existsSync(APRIL))('the owner’s April 2026 payout archive', () => {
  const run = () => normalizeBlinkitPayoutZip(readFileSync(APRIL), 'test-import', 'payout_sheet_2026-04-01_To_2026-04-30.zip')

  it('reads the statement Blinkit published', async () => {
    const r = await run()
    expect(r.facts.month).toBe('2026-04')
    expect(r.facts.customerPayable).toBe(17549)
    expect(r.facts.commission).toBeCloseTo(350.98, 2)
    expect(r.facts.commissionGst).toBeCloseTo(63.1764, 4)
    expect(r.facts.shipping).toBe(4050)
    expect(r.facts.shippingGst).toBe(729)
    expect(r.facts.tds).toBeCloseTo(14.9004, 4)
    expect(r.facts.storageCharge).toBeCloseTo(11778.76, 2)
    expect(r.facts.storageChargeGst).toBeCloseTo(2120.18, 2)
    expect(r.facts.courierCharge).toBeCloseTo(4757.76, 2)
  })

  it('keeps a charge a charge, where this archive writes it positive', async () => {
    const r = await run()
    // The whole risk of the second layout. August writes a commission of
    // ₹128.60 as -128.6 and it is negated into a magnitude; April writes
    // ₹350.98 as 350.98. Negating that would have made every charge on the
    // month a credit and reported a profit that did not happen.
    for (const charge of [r.facts.commission, r.facts.shipping, r.facts.storageCharge, r.facts.courierCharge, r.facts.tds]) {
      expect(charge).toBeGreaterThan(0)
    }
  })

  it('states the cycle as the loss it was', async () => {
    const r = await run()
    // April's "Net Payout in this Cycle" is blank — Blinkit pays nothing in a
    // month the account goes backwards — so the figure comes off the row that
    // carries it. ₹17,549 of sales against ₹23,864 of charges.
    expect(r.facts.netPayoutPerFile).toBeCloseTo(-6315.76, 2)
  })

  it('agrees with the detail sheets behind it', async () => {
    const r = await run()
    expect(r.checks.filter((c) => !c.passed)).toEqual([])
    // All five, so a layout that quietly skipped a check cannot pass this.
    expect(r.checks).toHaveLength(5)
  })

  it('reads all 81 order lines off the sheet they moved to', async () => {
    const r = await run()
    expect(r.validRecords).toHaveLength(81)
    expect(r.invalidRows).toEqual([])
    expect(r.facts.unitsSold).toBe(81)
    expect(r.validRecords.reduce((n, x) => n + x.grossSales, 0)).toBe(17549)
    expect(new Set(r.validRecords.map((x) => x.lineId)).size).toBe(81)
    expect(r.validRecords.every((x) => x.orderDate.startsWith('2026-04'))).toBe(true)
  })

  it('leaves nothing on the statement unaccounted for', async () => {
    const r = await run()
    // April prints a dozen rows this dashboard has no field for — ads spend,
    // pre-GRN losses, credit and debit notes. Every one is nil, so none is
    // reported; the first one to carry an amount will be.
    expect(r.unknownPayoutRows).toEqual([])
  })
})

/**
 * Before Blinkit published a month as a zip of workbooks it published it as
 * one workbook, with the same sheets inside. `payout_sheet_2025-06.xlsx` is
 * June 2025, and these are the owner's own figures, read off the file.
 */
const OLD_WORKBOOK = '/root/.claude/uploads/f24a295e-093a-5385-9288-97acefc06862/e2a12b3a-payout_sheet_2025-06.xlsx'

describe('the payout cycle the statement names itself', () => {
  it('reads it off the Note sheet', () => {
    expect(blinkitMonthFromCycle([{ Note: [['Payout Cycle', '01-Jun-2025 to 30-Jun-2025']] }])).toBe('2025-06')
    expect(blinkitMonthFromCycle([{ Note: [['Payout Cycle', '01-Apr-2026 to 30-Apr-2026']] }])).toBe('2026-04')
  })

  it('says nothing where no sheet names one', () => {
    expect(blinkitMonthFromCycle([{ Note: [['Remarks', 'something else']] }])).toBeNull()
  })
})

describe.skipIf(!existsSync(OLD_WORKBOOK))('the owner’s June 2025 statement, one workbook', () => {
  const run = () => normalizeBlinkitPayoutWorkbook(readFileSync(OLD_WORKBOOK), 'test-import', 'payout_sheet_2025-06.xlsx')

  it('is recognised by its sheets', () => {
    expect(detectBlinkitPayoutArchive([
      'Note', 'Payout Breakup', 'Forward Orders', 'Daily Ageing', 'Ads',
    ])).toBe(true)
  })

  it('reads the month and the statement', () => {
    const r = run()
    expect(r.facts.month).toBe('2025-06')
    expect(r.facts.customerPayable).toBeCloseTo(6214, 2)
    expect(r.facts.commission).toBeCloseTo(124.28, 2)
    expect(r.facts.shipping).toBeCloseTo(750, 2)
    expect(r.facts.netPayoutPerFile).toBeCloseTo(3523.66, 2)
  })

  /**
   * Blinkit writes this line two ways. The archives say "TDS Charge (194O &
   * Q)" and this one says "TDS Charge (194O)", and reading only the first
   * left ₹5.33 out of the statement — and out of its own reconciliation,
   * which came to ₹3528.99 against the file's ₹3523.66.
   */
  it('reads the TDS line under the name this file gives it', () => {
    const r = run()
    expect(r.facts.tds).toBeCloseTo(5.33, 2)
    expect(r.unknownPayoutRows).toEqual([])
    expect(r.checks.find((c) => c.name.startsWith('The statement adds up'))?.passed).toBe(true)
  })

  it('ties the orders behind it to the statement', () => {
    const r = run()
    for (const name of ['Customer payable matches', 'Commission matches', 'Shipping matches']) {
      expect(r.checks.find((c) => c.name.startsWith(name))?.passed).toBe(true)
    }
  })
})
