import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import type { RawSheet } from '@/lib/csvParse'
import { workbookSheetsFromBytes } from '@/lib/csvParse'
import type { SkuMaster } from '@/data/models'
import {
  detectPurplleSalesReport,
  normalizePurplleSalesReport,
  purplleDate,
  purplleHeaderRow,
  purplleMarketing,
} from './purplleSalesReport'
import { computePurpllePnl, purplleToCanonicalBuckets } from '@/engine/nativePnl/purplle'
import { computeSubtotals } from '@/engine/pnl'

const REPORT = '/root/.claude/uploads/f24a295e-093a-5385-9288-97acefc06862/658b78dc-Purplle_-_April.xlsx'

const HEADER = [
  'dt', 'order_id', 'ean_code', 'sku', 'name', 'brand_name', 'brand_house', 'category_name',
  'category_root', 'Gst Rate', 'nmv', 'mrp', 'qty', 'Price Off %', 'Price Off Amt',
  null, null, null, 'Price off Amount', 'Difference',
]

/** A file in Purplle's shape: a strip of the sender's own totals, then the
 * column names, then the order lines. */
function sheet(
  rows: (string | number | null)[][],
  strip: (string | number | null)[] = [null, null, null, null, null, null, null, null, null, null,
    null, null, null, null, null, null, 'Marketing', 1000],
): RawSheet {
  return [strip, HEADER, ...rows] as RawSheet
}

/** One order line. MRP less the price off is what the shopper paid. */
const line = (over: Partial<Record<string, string | number>> = {}): (string | number | null)[] => {
  const mrp = Number(over.mrp ?? 500)
  const off = Number(over.off ?? 100)
  return [
    over.dt ?? 46113, over.order ?? 1001, 8906140850036, over.sku ?? 'PPLB001', 'A product',
    'Aravi Organic', 'Aravi Organic', 'Lip Balm', 'skin', over.gst ?? 0.18,
    mrp - off, mrp, over.qty ?? 1, off / mrp, off, null, null, null, over.alt ?? off, 0,
  ]
}

describe('finding the table inside Purplle’s file', () => {
  it('finds the header row below the sender’s strip of totals', () => {
    expect(purplleHeaderRow(sheet([line()]))).toBe(1)
  })

  it('claims the file, on nmv and a price-off column together', () => {
    expect(detectPurplleSalesReport(sheet([line()]))).toBe(true)
    expect(detectPurplleSalesReport([['order_id', 'qty', 'total']] as RawSheet)).toBe(false)
    expect(detectPurplleSalesReport([] as RawSheet)).toBe(false)
    expect(detectPurplleSalesReport(undefined)).toBe(false)
  })

  it('reads the marketing figure by its label, not by its cell', () => {
    // It is written loose above the table, and next month it will not be in
    // the same column.
    expect(purplleMarketing(sheet([line()], [null, 'Marketing', 2500]), 1)).toBe(2500)
    expect(purplleMarketing(sheet([line()], [null, null, null]), 1)).toBeNull()
  })

  it('reads Excel’s own serial date, and a written one', () => {
    // 46113 is 1 April 2026. A month read wrong puts the whole file in the
    // wrong statement.
    expect(purplleDate(46113)).toBe('2026-04-01')
    expect(purplleDate(46142)).toBe('2026-04-30')
    expect(purplleDate('2026-04-01')).toBe('2026-04-01')
    expect(purplleDate('01-04-2026')).toBe('2026-04-01')
    expect(purplleDate('sometime')).toBeNull()
    expect(purplleDate('')).toBeNull()
  })
})

describe('reading the month', () => {
  const run = (rows: (string | number | null)[][], master: SkuMaster[] = []) =>
    normalizePurplleSalesReport(sheet(rows), master, [], 'test')

  it('takes the GST out at each line’s own rate', () => {
    // April's file carries 18% lines beside 5% ones. One rate for the file
    // would be wrong by hundreds of rupees.
    const r = run([line({ mrp: 118, off: 0, gst: 0.18 }), line({ mrp: 105, off: 0, gst: 0.05 })])
    expect(r.facts.nmv).toBe(223)
    expect(r.facts.outputGst).toBeCloseTo(23, 6)
    expect(r.facts.netRevenue).toBeCloseTo(200, 6)
  })

  it('keeps MRP and the price off apart, because the discount is the lever', () => {
    const r = run([line({ mrp: 500, off: 100 }), line({ mrp: 300, off: 50 })])
    expect(r.facts.mrpValue).toBe(800)
    expect(r.facts.priceOff).toBe(150)
    expect(r.facts.nmv).toBe(650)
  })

  it('counts orders and lines separately', () => {
    // Two lines of one order is one order. Counting lines as orders would
    // overstate how many shoppers there were.
    const r = run([line({ order: 1 }), line({ order: 1 }), line({ order: 2 })])
    expect(r.facts.orderLines).toBe(3)
    expect(r.facts.orders).toBe(2)
  })

  it('reports a row whose date cannot be read rather than filing it anyway', () => {
    const r = run([line(), line({ dt: 'whenever' })])
    expect(r.invalidRows).toHaveLength(1)
    expect(r.facts.orderLines).toBe(1)
  })

  it('names the SKUs it could not price', () => {
    const master: SkuMaster[] = [{
      sku: 'PPLB001', productName: 'A product', category: 'Lip Balm', brand: 'Aravi Organic',
      cogs: 40, mrp: 500, launchDate: '2026-01-01', status: 'active', leadTimeDays: 21, safetyStock: 0,
    }]
    const r = run([line({ sku: 'PPLB001', qty: 2 }), line({ sku: 'PPLB999' })], master)
    expect(r.facts.cogsSourceInr).toBe(80)
    expect(r.facts.unpricedSkus).toEqual(['PPLB999'])
    expect(r.warnings.some((w) => w.includes('PPLB999'))).toBe(true)
  })

  it('says on every upload that the file carries no marketplace charges', () => {
    // The one thing a reader must not assume about this channel.
    expect(run([line()]).warnings.some((w) => w.includes('not a settlement'))).toBe(true)
    expect(run([line()]).validRecords.every((r) => r.marketplaceFee === 0)).toBe(true)
  })

  it('says when the file’s two discount columns disagree', () => {
    const r = run([line({ off: 100, alt: 95 })])
    expect(r.facts.priceOffDifference).toBe(5)
    expect(r.warnings.some((w) => w.includes('disagree by ₹5.00'))).toBe(true)
  })

  it('files a file spanning two months under the first, and says so', () => {
    const r = run([line({ dt: 46113 }), line({ dt: 46143 })])
    expect(r.months).toEqual(['2026-04', '2026-05'])
    expect(r.warnings.some((w) => w.includes('cover 2 months'))).toBe(true)
  })

  it('states sales rows ex-GST, as every other channel does', () => {
    const r = run([line({ mrp: 118, off: 0, gst: 0.18 })])
    expect(r.validRecords[0].netSales).toBeCloseTo(100, 6)
    expect(r.validRecords[0].grossSales).toBe(118)
    expect(r.validRecords[0].tax).toBeCloseTo(18, 6)
    expect(r.validRecords[0].channel).toBe('purplle')
  })
})

/**
 * The owner's own April 2026 file, read end to end. The sender writes their
 * own totals above the table, and every figure below is checked against them.
 */
describe.skipIf(!existsSync(REPORT))('the owner’s April 2026 Purplle file', () => {
  const run = () => {
    const first = Object.values(workbookSheetsFromBytes(readFileSync(REPORT)))[0]
    return { sheet: first, result: normalizePurplleSalesReport(first, [], [], 'test') }
  }

  it('is recognised and read without a bad row', () => {
    const { sheet: s, result } = run()
    expect(detectPurplleSalesReport(s)).toBe(true)
    expect(result.totalRows).toBe(519)
    expect(result.validRecords).toHaveLength(519)
    expect(result.invalidRows).toEqual([])
    expect(result.months).toEqual(['2026-04'])
  })

  it('agrees with the totals the sender wrote above the table', () => {
    // ₹1,70,979 of MRP, ₹45,285 of price off and ₹1,25,694 of nmv are the
    // sender's own three figures in row 1. If this reading of the file
    // disagreed with them, one of the two would be wrong.
    const f = run().result.facts
    expect(f.mrpValue).toBe(170979)
    expect(f.priceOff).toBe(45285)
    expect(f.nmv).toBe(125694)
    expect(f.mrpValue - f.priceOff).toBe(f.nmv)
  })

  it('takes out ₹18,360.19 of GST, from two rates', () => {
    const f = run().result.facts
    expect(f.outputGst).toBeCloseTo(18360.19, 2)
    expect(f.netRevenue).toBeCloseTo(107333.81, 2)
  })

  it('counts 527 units across 512 orders and 28 SKUs', () => {
    const f = run().result.facts
    expect(f.unitsSold).toBe(527)
    expect(f.orders).toBe(512)
    expect(f.orderLines).toBe(519)
    expect(f.skusSold).toBe(28)
  })

  it('reads the month’s advertising from the loose "Marketing" cell', () => {
    const f = run().result.facts
    expect(f.marketingStated).toBe(true)
    expect(f.marketingInr).toBeCloseTo(8548.95, 2)
  })

  it('reports that the file does not agree with itself about the discount', () => {
    const f = run().result.facts
    expect(f.priceOffAlt).toBe(45239)
    expect(f.priceOffDifference).toBe(46)
    // And the sender's own Difference column says 48, which is neither.
    expect(f.priceOffDifferenceStated).toBe(48)
    expect(run().result.warnings.some((w) => w.includes('does not agree with itself'))).toBe(true)
  })

  it('builds a statement that ties from MRP to contribution', () => {
    const v = computePurpllePnl(run().result.facts, 0, 0)
    expect(v.mrpValue + v.priceOff).toBeCloseTo(v.nmv, 6)
    expect(v.nmv + v.outputGst).toBeCloseTo(v.netRevenue, 6)
    expect(v.netRevenue + v.cogs).toBeCloseTo(v.grossProfit, 6)
    expect(v.grossProfit + v.marketing).toBeCloseTo(v.contribution, 6)
    expect(v.contribution).toBeCloseTo(98784.86, 2)
    // What Purplle took is zero because it is not in the file, and the line
    // says so rather than the statement implying the channel is free.
    expect(v.purplleCharges).toBe(0)
  })

  it('rolls into the Master P&L on the same basis as every other channel', () => {
    const lines = computeSubtotals(purplleToCanonicalBuckets(run().result.facts, 0))
    // Net sales ex-GST, which is what the other channels' net sales mean.
    expect(lines.netSales).toBeCloseTo(107333.81, 2)
    expect(lines.grossSales).toBe(170979)
    expect(lines.discounts).toBe(45285)
    expect(lines.otherRevenueAdj).toBeCloseTo(18360.19, 2)
    expect(lines.ads).toBeCloseTo(8548.95, 2)
    // No marketplace charge is claimed, in either direction.
    expect(lines.marketplaceCommission).toBe(0)
    expect(lines.otherMarketplaceCharges).toBe(0)
  })
})
