import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import Papa from 'papaparse'
import {
  amazonInSkuFeesTotal,
  detectAmazonIndiaProductProfitability,
  normalizeAmazonIndiaProductProfitability,
} from './amazonIndiaProductProfitability'
import { amazonUsaFeeSeries, unnamedFeeColumnsOf } from '@/engine/amazonUsaFees'

const REPORT =
  '/root/.claude/uploads/f24a295e-093a-5385-9288-97acefc06862/5eb4373b-01d545af-9df2-4bc8-9d70-4edf9bd36b54.amzn1.tortuga.4.eu.csv'

function parse(text: string) {
  const out = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ''), { header: true, skipEmptyLines: true })
  return { headers: out.meta.fields ?? [], rows: out.data }
}

const HEADER = [
  'Amazon store', 'Start date', 'End date', 'ASIN', 'MSKU', 'Currency code',
  'Units sold', 'Units returned', 'Net units sold', 'Sales', 'Net sales',
  'Referral fee total', 'FBA Weight Handling Fee total', 'Net proceeds total',
].join(',')

const file = (...rows: string[]) => parse([HEADER, ...rows].join('\n'))

describe('telling the Indian export apart', () => {
  it('claims it, on the store and the currency', () => {
    const f = file('IN,04/01/2026,04/30/2026,B01,AO/X,INR,10,0,10,1000,1000,100,50,850')
    expect(detectAmazonIndiaProductProfitability(f.headers, f.rows)).toBe(true)
  })

  it('refuses the US and UAE exports', () => {
    const us = file('US,04/01/2026,04/30/2026,B01,AO/X,USD,10,0,10,1000,1000,100,50,850')
    const ae = file('AE,04/01/2026,04/30/2026,B01,AO/X,AED,10,0,10,1000,1000,100,50,850')
    expect(detectAmazonIndiaProductProfitability(us.headers, us.rows)).toBe(false)
    expect(detectAmazonIndiaProductProfitability(ae.headers, ae.rows)).toBe(false)
  })

  it('refuses an export that names no store, which is the older US download', () => {
    const f = parse([
      'Start date,MSKU,Units sold,Units returned,Net units sold,Sales,Net sales,Referral fee total,Net proceeds total',
      '04/01/2026,AO/X,10,0,10,1000,1000,100,900',
    ].join('\n'))
    expect(detectAmazonIndiaProductProfitability(f.headers, f.rows)).toBe(false)
  })
})

describe('what it reads, and what it deliberately does not', () => {
  const run = () => {
    const f = file(
      'IN,04/01/2026,04/30/2026,B01,AO/X,INR,10,1,9,1000,900,100,50,750',
      'IN,04/01/2026,04/30/2026,B02,AO/Y,INR,4,0,4,400,400,40,20,340',
    )
    return normalizeAmazonIndiaProductProfitability(f.headers, f.rows)
  }

  it('creates no sales rows at all', () => {
    // Amazon India's revenue comes from the All Orders report. A second set of
    // sales rows for the same month would count it twice, which is the whole
    // reason this reads fees only.
    expect(run().validRecords).toEqual([])
  })

  it('reads the month the American way, as Amazon writes it everywhere', () => {
    // "04/01/2026" is 1 April. Read the Indian way it would be 4 January.
    expect(run().month).toBe('2026-04')
    expect(run().facts.month).toBe('2026-04')
  })

  it('sums each fee and keeps it per SKU', () => {
    const f = run().facts
    expect(f.feeTotalsInr.referralFee).toBeCloseTo(140, 6)
    expect(f.feeTotalsInr.fbaWeightHandlingFee).toBeCloseTo(70, 6)
    expect(f.feeBySkuInr['AO/X']).toEqual({ referralFee: 100, fbaWeightHandlingFee: 50 })
    expect(f.feeBySkuInr['AO/Y']).toEqual({ referralFee: 40, fbaWeightHandlingFee: 20 })
  })

  it('keeps the units and the revenue as memo figures, not as sales', () => {
    const f = run().facts
    expect([f.unitsSoldQty, f.unitsReturnedQty, f.netUnitsSoldQty]).toEqual([14, 1, 13])
    expect(f.grossSalesInr).toBe(1400)
    expect(f.netSalesInr).toBe(1300)
    expect(f.sheetNetProceedsInr).toBe(1090)
  })

  it('says so when its fees do not account for Amazon’s own net proceeds', () => {
    // Net sales 900 − fees 150 is 750, and the file says 700: ₹50 of charge
    // in this row has not been read, and that has to be said rather than
    // shown as a per-SKU figure that is quietly short.
    const f = file('IN,04/01/2026,04/30/2026,B01,AO/X,INR,10,1,9,1000,900,100,50,700')
    const r = normalizeAmazonIndiaProductProfitability(f.headers, f.rows)
    expect(r.warnings.some((w) => w.includes('has not been read'))).toBe(true)
  })

  it('keeps a fee column Amazon left unnamed, under the heading it came with', () => {
    // Amazon sent April's export with a fee block headed only " per unit",
    // " quantity" and " total". Naming it would be inventing a fee; dropping
    // it would lose a real charge.
    const f = parse([
      'Amazon store,Start date,MSKU,Currency code,Units sold,Units returned,Net units sold,Sales,Net sales, per unit, quantity, total,Net proceeds total',
      'IN,04/01/2026,AO/X,INR,10,0,10,1000,1000,2.5,10,25,975',
    ].join('\n'))
    const r = normalizeAmazonIndiaProductProfitability(f.headers, f.rows)
    expect(r.facts.unmappedFeeTotalsInr[' total']).toBe(25)
    expect(r.warnings.some((w) => w.includes('Amazon left unnamed'))).toBe(true)
    // Counted, so the month still ties to Amazon's own net proceeds.
    expect(amazonInSkuFeesTotal(r.facts)).toBe(25)
    expect(r.warnings.some((w) => w.includes('has not been read'))).toBe(false)
    // And readable on the fees screen as a column of its own.
    expect(unnamedFeeColumnsOf([r.facts.unmappedFeeTotalsInr])[0].header).toBe('Fee column Amazon left unnamed')
  })

  it('counts a SKU charged without selling anything', () => {
    const f = file('IN,04/01/2026,04/30/2026,B01,AO/X,INR,0,0,0,0,0,0,11.8,-11.8')
    const r = normalizeAmazonIndiaProductProfitability(f.headers, f.rows)
    expect(r.facts.nonSellingChargedRows).toBe(1)
    expect(r.facts.feeTotalsInr.fbaWeightHandlingFee).toBeCloseTo(11.8, 6)
  })
})

/**
 * The owner's own April 2026 export, read end to end. The check that matters
 * is the last one: Amazon states its own Net proceeds, and net sales less
 * every fee read here has to come to exactly that, or the per-SKU figures are
 * short by the difference and nobody would know.
 */
describe.skipIf(!existsSync(REPORT))('the owner’s April 2026 Amazon India export', () => {
  const run = () => {
    const { headers, rows } = parse(readFileSync(REPORT, 'utf8'))
    return { headers, rows, result: normalizeAmazonIndiaProductProfitability(headers, rows) }
  }

  it('is recognised as the Indian export and read without a bad row', () => {
    const { headers, rows, result } = run()
    expect(detectAmazonIndiaProductProfitability(headers, rows)).toBe(true)
    expect(result.totalRows).toBe(200)
    expect(result.invalidRows).toEqual([])
    expect(result.month).toBe('2026-04')
  })

  it('reads the revenue and units Amazon states', () => {
    const f = run().result.facts
    expect(f.grossSalesInr).toBeCloseTo(191901.88, 2)
    expect(f.netSalesInr).toBeCloseTo(182052.16, 2)
    expect([f.unitsSoldQty, f.unitsReturnedQty, f.netUnitsSoldQty]).toEqual([277, 15, 262])
  })

  it('ties to Amazon’s own Net proceeds to the paisa', () => {
    const f = run().result.facts
    expect(f.sheetNetProceedsInr).toBeCloseTo(135271.59, 2)
    expect(amazonInSkuFeesTotal(f)).toBeCloseTo(46780.57, 2)
    expect(f.netSalesInr - amazonInSkuFeesTotal(f)).toBeCloseTo(f.sheetNetProceedsInr, 2)
    expect(run().result.warnings.some((w) => w.includes('has not been read'))).toBe(false)
  })

  it('proves the base fulfilment fee sits inside FBA fulfilment fees', () => {
    // Both read ₹2,487.44. Counting both would charge the same money twice,
    // and the British spellings have to match the catalogue for the test to
    // even find them.
    const f = run().result.facts
    expect(f.feeTotalsInr.baseFulfillmentFee).toBeCloseTo(2487.44, 2)
    expect(f.feeTotalsInr.fbaFulfillmentFees).toBeCloseTo(2487.44, 2)
    expect(f.nestedFeeIds).toContain('baseFulfillmentFee')
  })

  it('names the fees Amazon charged, including the one it left unnamed', () => {
    const f = run().result.facts
    expect(f.feeTotalsInr.referralFee).toBeCloseTo(17115.22, 2)
    expect(f.feeTotalsInr.manufacturerFulfilledPostageFee).toBeCloseTo(10100.8, 2)
    expect(f.feeTotalsInr.fbaWeightHandlingFee).toBeCloseTo(6064.04, 2)
    expect(f.feeTotalsInr.fbaRemovalOrderFee).toBeCloseTo(11.8, 2)
    // Credits keep their sign: money coming back is not money going out.
    expect(f.feeTotalsInr.referralFeeRefunds).toBeCloseTo(-784.75, 2)
    expect(f.feeTotalsInr.fbaInventoryReimbursement).toBeCloseTo(-645.28, 2)
    expect(f.unmappedFeeTotalsInr[' total']).toBeCloseTo(12431.3, 2)
  })

  it('traces the fees to the SKUs carrying them', () => {
    const f = run().result.facts
    expect(Object.keys(f.feeBySkuInr)).toHaveLength(27)
    const worst = Object.entries(f.feeBySkuInr)
      .map(([sku, fees]) => [sku, Object.values(fees).reduce((a, b) => a + b, 0)] as const)
      .sort((a, b) => b[1] - a[1])[0]
    // Half the month's Amazon charges sit in one SKU, which is the point of
    // reading this file at all.
    expect(worst[0]).toBe('AO/EO/Rosemary/100')
    expect(worst[1]).toBeCloseTo(24621.65, 2)
  })

  it('reads on the fees screen, worst actionable fee first', () => {
    const f = run().result.facts
    const series = amazonUsaFeeSeries(
      ['2026-04'],
      [{ month: '2026-04', feeTotals: { ...f.feeTotalsInr, ...f.unmappedFeeTotalsInr }, feeBySku: f.feeBySkuInr }],
      unnamedFeeColumnsOf([f.unmappedFeeTotalsInr]),
    )
    // Every fee charged something, and nothing that was not charged.
    expect(series.every((s) => s.monthsCharged > 0)).toBe(true)
    expect(series.map((s) => s.column.id)).toContain(' total')
    // The referral fee has no lever, so it does not head a list meant to be
    // worked through.
    expect(series[0].column.id).not.toBe('referralFee')
  })
})
