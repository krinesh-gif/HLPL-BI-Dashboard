import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import Papa from 'papaparse'
import { detectAmazonUsaProductProfitabilityReport } from './amazonUsaProductProfitability'
import {
  amazonStoreOf,
  detectAmazonUaeProductProfitability,
  normalizeAmazonUaeProductProfitability,
} from './amazonUaeProductProfitability'
import { amazonAeFeesTaken, amazonAeToCanonicalBuckets, computeAmazonAePnl } from '@/engine/nativePnl/amazonAe'

const ARCHIVE = '/root/.claude/uploads/f24a295e-093a-5385-9288-97acefc06862/898cc0c6-b2b81b8c-08df-4ff2-9584-e075f2c1922a.amzn1.tortuga.4.eu.csv'

function parse(text: string) {
  const out = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ''), { header: true, skipEmptyLines: true })
  return { headers: out.meta.fields ?? [], rows: out.data }
}

/**
 * A UAE export with its headings intact, which is what Amazon is supposed to
 * send and what the September file was not. Both spellings have to read.
 */
const WELL_FORMED = [
  'Amazon store,Start date,End date,ASIN,MSKU,Currency code,Units sold,Units returned,Net units sold,Sales,Net sales,Net proceeds total',
  'AE,09/01/2026,09/30/2026,B01,AO/X,AED,10,1,9,500,450,300',
].join('\n')

/** The same report from the US marketplace. It must never read as UAE. */
const US_FILE = [
  'Amazon store,Start date,End date,ASIN,MSKU,Currency code,Units sold,Units returned,Net units sold,Sales,Net sales,Net proceeds total',
  'US,09/01/2026,09/30/2026,B01,AO/X,USD,10,1,9,500,450,300',
].join('\n')

describe('telling the UAE export from the USA one', () => {
  it('reads the store and currency out of the file, not its name', () => {
    // The download is named with a random string, so nothing outside the file
    // can tell them apart.
    const ae = parse(WELL_FORMED)
    expect(amazonStoreOf(ae.headers, ae.rows)).toEqual({ store: 'AE', currency: 'AED' })
    const us = parse(US_FILE)
    expect(amazonStoreOf(us.headers, us.rows)).toEqual({ store: 'US', currency: 'USD' })
  })

  it('claims the UAE file and refuses the US one', () => {
    const ae = parse(WELL_FORMED)
    const us = parse(US_FILE)
    expect(detectAmazonUaeProductProfitability(ae.headers, ae.rows)).toBe(true)
    expect(detectAmazonUaeProductProfitability(us.headers, us.rows)).toBe(false)
  })

  it('is checked before the USA detector, which matches a tidy UAE file too', () => {
    // This is why the order on the upload screen matters. A UAE export with
    // its headings intact satisfies the USA detector exactly, and a UAE month
    // filed under Amazon USA would have its dirhams counted as dollars.
    const ae = parse(WELL_FORMED)
    expect(detectAmazonUsaProductProfitabilityReport(ae.headers)).toBe(true)
  })

  it('reads a tidy export and a mangled one the same way', () => {
    const ae = parse(WELL_FORMED)
    const r = normalizeAmazonUaeProductProfitability(ae.headers, ae.rows, [], 'test')
    expect(r.facts.month).toBe('2026-09')
    expect(r.facts.grossSalesAed).toBe(500)
    expect(r.facts.netSalesAed).toBe(450)
    expect(r.facts.netProceedsAed).toBe(300)
    expect(amazonAeFeesTaken(r.facts)).toBe(150)
  })

  it('reads the American date order, as Amazon writes it for every store', () => {
    // "09/01/2026" is 1 September. Read the Indian way it would be 9 January
    // and the whole month would land in the wrong place.
    const ae = parse(WELL_FORMED)
    const r = normalizeAmazonUaeProductProfitability(ae.headers, ae.rows, [], 'test')
    expect(r.validRecords[0].orderDate).toBe('2026-09-01')
  })
})

/**
 * The owner's own September 2026 export, read end to end. These are his
 * figures, not a fixture: the point is that the code agrees with the file
 * Amazon sent, which is the only thing the P&L can be checked against.
 *
 * Amazon exported it with its headings unresolved — `SC_FBA_Calc_label_country`
 * for the store, two columns with no heading at all, and `SC_FBA_SER_per_unit`
 * twice with every cell empty — and with none of the fee columns the US
 * download of the same report carries.
 */
describe.skipIf(!existsSync(ARCHIVE))('the owner’s September 2026 Amazon UAE export', () => {
  const run = () => {
    const { headers, rows } = parse(readFileSync(ARCHIVE, 'utf8'))
    return { headers, rows, result: normalizeAmazonUaeProductProfitability(headers, rows, [], 'test') }
  }

  it('is recognised although Amazon mangled every heading', () => {
    const { headers, rows } = run()
    expect(amazonStoreOf(headers, rows)).toEqual({ store: 'AE', currency: 'AED' })
    expect(detectAmazonUaeProductProfitability(headers, rows)).toBe(true)
  })

  it('reads the revenue Amazon states', () => {
    const { result } = run()
    expect(result.facts.month).toBe('2026-09')
    expect(result.facts.grossSalesAed).toBeCloseTo(7501.29, 2)
    expect(result.facts.netSalesAed).toBeCloseTo(7250.33, 2)
    expect(result.facts.netProceedsAed).toBeCloseTo(4311.287, 3)
  })

  it('states what Amazon took as the one figure the file supports', () => {
    const { result } = run()
    // Net sales less Amazon's own Net proceeds. 40.5% of net sales, and the
    // export says nothing about how much of it was referral fee, fulfilment
    // or storage — so neither does this.
    expect(amazonAeFeesTaken(result.facts)).toBeCloseTo(2939.04, 2)
    const pct = (amazonAeFeesTaken(result.facts) / result.facts.netSalesAed) * 100
    expect(pct).toBeCloseTo(40.54, 1)
  })

  it('counts the units and the rows that sold', () => {
    const { result } = run()
    expect(result.facts.unitsSoldQty).toBe(241)
    expect(result.facts.unitsReturnedQty).toBe(7)
    expect(result.facts.netUnitsSoldQty).toBe(234)
    // 52 rows in the file; 31 of them sold something.
    expect(result.validRecords).toHaveLength(31)
    expect(result.invalidRows).toEqual([])
  })

  it('keeps a SKU charged without selling out of the sales rows and in the month', () => {
    const { result } = run()
    // Three rows were charged while selling nothing — storage accrues on
    // stock that sits there. A zero-quantity order line would be a fiction,
    // but the charge was real, so it stays in Net proceeds.
    expect(result.facts.nonSellingRows).toBe(3)
    // Every row that is here moved units one way or the other. A line that
    // sold one and had it returned nets to zero and is still a real sale.
    expect(result.validRecords.every((r) => r.quantity > 0 || r.returnUnits > 0)).toBe(true)
  })

  it('stores every row in dirhams, against the UAE channel', () => {
    const { result } = run()
    // A row filed as USD or against amazon_us would be read at the dollar
    // rate, which is 3.7 times the dirham.
    expect([...new Set(result.validRecords.map((r) => r.currency))]).toEqual(['AED'])
    expect([...new Set(result.validRecords.map((r) => r.channel))]).toEqual(['amazon_ae'])
    expect([...new Set(result.validRecords.map((r) => r.orderDate.slice(0, 7)))]).toEqual(['2026-09'])
  })

  it('says on every upload why there is no fee breakdown', () => {
    const { result } = run()
    expect(result.warnings.some((w) => w.includes('without its fee columns'))).toBe(true)
  })

  it('builds a statement that ties back to the export', () => {
    const { result } = run()
    const v = computeAmazonAePnl(result.facts, 0, 0)
    // Gross less returns is net sales; net sales less what Amazon took is
    // Amazon's own Net proceeds. Both have to hold or the statement is not
    // describing this file.
    expect(v.grossSales + v.returns).toBeCloseTo(v.netSales, 6)
    expect(v.netSales + v.amazonFees).toBeCloseTo(v.netProceeds, 6)
    expect(v.netProceeds).toBeCloseTo(4311.287, 3)
  })

  it('converts the whole channel at the month’s dirham rate', () => {
    const { result } = run()
    const rate = 24.07
    const inr = amazonAeToCanonicalBuckets(result.facts, rate, 0)
    // Against the unrounded dirham figures, so this measures the conversion
    // rather than how many decimals the comment above happens to quote.
    expect(inr.grossSales).toBeCloseTo(result.facts.grossSalesAed * rate, 6)
    expect(inr.returns).toBeCloseTo((result.facts.grossSalesAed - result.facts.netSalesAed) * rate, 6)
    // Everything Amazon took, under one bucket, because the export states no
    // split and putting it under Commission would be a claim about it.
    expect(inr.otherMarketplaceCharges).toBeCloseTo(amazonAeFeesTaken(result.facts) * rate, 6)
    expect(inr.otherMarketplaceCharges).toBeCloseTo(70742.77, 1)
    expect(inr.marketplaceCommission).toBe(0)
    expect(inr.fulfilment).toBe(0)
  })
})
