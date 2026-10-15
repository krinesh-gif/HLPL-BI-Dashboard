import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import type { RawSheet } from '@/lib/csvParse'
import { workbookSheetsFromBytes } from '@/lib/csvParse'
import type { SkuMaster } from '@/data/models'
import {
  detectSwiggyInstamartReport,
  normalizeSwiggyInstamartReport,
  swiggyDate,
} from './swiggyInstamartSalesReport'
import { computeSwiggyInstamartPnl, swiggyInstamartToCanonicalBuckets } from '@/engine/nativePnl/swiggyInstamart'
import { computeSubtotals } from '@/engine/pnl'

const REPORT = '/root/.claude/uploads/f24a295e-093a-5385-9288-97acefc06862/d6c36f9b-June.xlsx'

const SALES_HEADER = [
  null, 'BRAND', 'ORDERED_DATE', 'CITY', 'AREA_NAME', 'STORE_ID', 'L1_CATEGORY', 'L2_CATEGORY',
  'L3_CATEGORY', 'PRODUCT_NAME', 'VARIANT', 'ITEM_CODE', 'COMBO', 'COMBO_ITEM_CODE',
  'COMBO_UNITS_SOLD', 'BASE_MRP', 'UNITS_SOLD', 'GMV',
]

/** One row of the sales report: a product, in a store, on a day. */
const row = (over: Record<string, string | number> = {}): (string | number | null)[] => {
  const mrp = Number(over.mrp ?? 249)
  const units = Number(over.units ?? 1)
  return [
    0, 'aravi organic', over.date ?? 46179, over.city ?? 'mumbai', 'andheri west',
    over.store ?? '1398452', 'beauty and grooming', 'face and lip care', 'lip balm',
    'Aravi Organic Tinted Beetroot Lip Balm', '5 g', over.item ?? '80537', over.combo ?? 'No',
    null, 0, mrp, units, over.gmv ?? mrp * units,
  ]
}

const book = (rows: (string | number | null)[][], metrics?: (string | number | null)[][]): Record<string, RawSheet> => ({
  'Sales Report': [SALES_HEADER, ...rows] as RawSheet,
  ...(metrics
    ? { 'Brand Metrics': [
        ['Note: This data is for all the products related to the brand.'],
        [null, 'BRAND_NAME', 'DATE', 'CITY', 'NTB_BUYERS', 'BRAND_IMPRESSIONS', 'BRAND_GMV', 'BRAND_ORDERS'],
        ...metrics,
      ] as RawSheet }
    : {}),
})

describe('recognising Swiggy’s report', () => {
  it('claims a workbook with the sales sheet in it', () => {
    expect(detectSwiggyInstamartReport(book([row()]))).toBe(true)
  })

  it('refuses a workbook that is not it', () => {
    expect(detectSwiggyInstamartReport({})).toBe(false)
    expect(detectSwiggyInstamartReport({ 'Sales Report': [['order_id', 'qty']] as RawSheet })).toBe(false)
  })

  it('claims the report even with no rows under the header', () => {
    // April's export arrived exactly like this. It is a month with nothing
    // sold, not a file nobody recognises.
    const empty = detectSwiggyInstamartReport(book([]))
    expect(empty).toBe(true)
    const r = normalizeSwiggyInstamartReport(book([]), [], [], 'test')
    expect(r.totalRows).toBe(0)
    expect(r.facts.gmv).toBe(0)
  })

  it('reads Excel’s own serial date, and a written one', () => {
    expect(swiggyDate(46174)).toBe('2026-06-01')
    expect(swiggyDate(46202)).toBe('2026-06-29')
    expect(swiggyDate('2026-06-01')).toBe('2026-06-01')
    expect(swiggyDate('01-06-2026')).toBe('2026-06-01')
    expect(swiggyDate('whenever')).toBeNull()
  })
})

describe('reading the month', () => {
  const run = (rows: (string | number | null)[][], master: SkuMaster[] = [], metrics?: (string | number | null)[][]) =>
    normalizeSwiggyInstamartReport(book(rows, metrics), master, [], 'test')

  it('sums GMV and takes the GST out at the declared rate', () => {
    const r = run([row({ mrp: 118, units: 1 })])
    expect(r.facts.gmv).toBe(118)
    expect(r.facts.outputGstPct).toBe(0.18)
    expect(r.facts.outputGst).toBeCloseTo(18, 6)
    expect(r.facts.gmvExGst).toBeCloseTo(100, 6)
  })

  it('stores the rate with the month, so changing the assumption later cannot restate it', () => {
    expect(run([row()]).facts.outputGstPct).toBe(0.18)
  })

  it('says on every upload that the rate was assumed, not read', () => {
    expect(run([row()]).warnings.some((w) => w.includes('assumption and not a figure from the file'))).toBe(true)
  })

  it('counts stores and cities, which is what this channel is read for', () => {
    const r = run([
      row({ store: 'A', city: 'mumbai' }),
      row({ store: 'B', city: 'mumbai' }),
      row({ store: 'C', city: 'pune' }),
    ])
    expect(r.facts.storesSold).toBe(3)
    expect(r.facts.citiesSold).toBe(2)
    expect(r.facts.salesRows).toBe(3)
  })

  it('says when GMV is not base MRP × units', () => {
    // Which would mean the month was discounted and the report does not say
    // so in a column.
    const r = run([row({ mrp: 249, units: 2, gmv: 400 })])
    expect(r.warnings.some((w) => w.includes('not sold at MRP throughout'))).toBe(true)
  })

  it('reads the reach sheet, and checks its GMV against the sales sheet', () => {
    const r = run([row({ mrp: 100, units: 1 })], [], [[0, 'aravi organic', 46179, 'mumbai', 3, '500', 100, 1]])
    expect(r.facts.brandImpressions).toBe(500)
    expect(r.facts.brandOrders).toBe(1)
    expect(r.facts.newToBrandBuyers).toBe(3)
    expect(r.facts.brandGmv).toBe(100)
    expect(r.warnings.some((w) => w.includes('disagree about GMV'))).toBe(false)
  })

  it('says when the two sheets disagree about GMV', () => {
    const r = run([row({ mrp: 100, units: 1 })], [], [[0, 'aravi organic', 46179, 'mumbai', 3, '500', 250, 1]])
    expect(r.warnings.some((w) => w.includes('disagree about GMV'))).toBe(true)
  })

  it('creates no marketplace fee, because the report states none', () => {
    const r = run([row()])
    expect(r.validRecords.every((x) => x.marketplaceFee === 0)).toBe(true)
    expect(r.warnings.some((w) => w.includes('not a settlement'))).toBe(true)
  })

  it('names the item codes it could not price', () => {
    const master: SkuMaster[] = [{
      sku: '80537', productName: 'Tinted Beetroot Lip Balm', category: 'Lip Balm', brand: 'Aravi Organic',
      cogs: 60, mrp: 249, launchDate: '2026-01-01', status: 'active', leadTimeDays: 21, safetyStock: 0,
    }]
    const r = run([row({ item: '80537', units: 2 }), row({ item: '99999' })], master)
    expect(r.facts.cogsSourceInr).toBe(120)
    expect(r.facts.unpricedSkus).toEqual(['99999'])
  })

  it('files a file spanning two months under the first, and says so', () => {
    const r = run([row({ date: 46179 }), row({ date: 46210 })])
    expect(r.months).toEqual(['2026-06', '2026-07'])
    expect(r.warnings.some((w) => w.includes('cover 2 months'))).toBe(true)
  })
})

/**
 * The owner's own June 2026 report, read end to end. Its two sheets state GMV
 * independently, which is the one figure in the file that can be checked
 * against itself.
 */
describe.skipIf(!existsSync(REPORT))('the owner’s June 2026 Swiggy Instamart report', () => {
  const run = () => {
    const sheets = workbookSheetsFromBytes(readFileSync(REPORT))
    return { sheets, result: normalizeSwiggyInstamartReport(sheets, [], [], 'test') }
  }

  it('is recognised and read without a bad row', () => {
    const { sheets, result } = run()
    expect(detectSwiggyInstamartReport(sheets)).toBe(true)
    expect(result.totalRows).toBe(58)
    expect(result.validRecords).toHaveLength(58)
    expect(result.invalidRows).toEqual([])
    expect(result.months).toEqual(['2026-06'])
  })

  it('totals ₹19,934 of GMV across 60 units', () => {
    const f = run().result.facts
    expect(f.gmv).toBe(19934)
    expect(f.unitsSold).toBe(60)
    expect(f.skusSold).toBe(6)
    // Every row is base MRP × units, so June was sold at MRP throughout.
    expect(f.mrpValue).toBe(19934)
    expect(run().result.warnings.some((w) => w.includes('not sold at MRP throughout'))).toBe(false)
  })

  it('agrees with the Brand Metrics sheet about GMV', () => {
    // The two sheets are produced separately, so this is the file checking
    // itself rather than this code checking the file.
    const f = run().result.facts
    expect(f.brandGmv).toBe(19934)
    expect(f.brandGmv).toBe(f.gmv)
  })

  it('reads the reach the second sheet carries', () => {
    const f = run().result.facts
    expect(f.brandImpressions).toBe(73560)
    expect(f.brandOrders).toBe(59)
    expect(f.newToBrandBuyers).toBe(57)
  })

  it('counts 47 dark stores across 7 cities', () => {
    const f = run().result.facts
    expect(f.storesSold).toBe(47)
    expect(f.citiesSold).toBe(7)
  })

  it('builds a statement that ties, with the GST flagged as assumed', () => {
    const f = run().result.facts
    const v = computeSwiggyInstamartPnl(f, 0, 0)
    expect(v.gmv + v.outputGst).toBeCloseTo(v.netRevenue, 6)
    expect(v.netRevenue).toBeCloseTo(16893.22, 2)
    expect(f.outputGst).toBeCloseTo(3040.78, 2)
    // Not supplied, and not claimed as free.
    expect(v.swiggyCharges).toBe(0)
    expect(run().result.warnings.some((w) => w.includes('not a settlement'))).toBe(true)
  })

  it('rolls into the Master P&L on the same basis as every other channel', () => {
    const lines = computeSubtotals(swiggyInstamartToCanonicalBuckets(run().result.facts, 0))
    expect(lines.grossSales).toBe(19934)
    expect(lines.netSales).toBeCloseTo(16893.22, 2)
    expect(lines.marketplaceCommission).toBe(0)
    expect(lines.otherMarketplaceCharges).toBe(0)
  })
})
