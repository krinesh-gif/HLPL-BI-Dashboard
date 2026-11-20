import { describe, expect, it } from 'vitest'
import { detectWalmartUsItemReport, normalizeWalmartUsItemReport } from './walmartUsItemReport'
import type { SkuMaster } from '@/data/models'

const HEADERS = ['Item Name', 'SKU', 'GMV', 'Units Sold', 'Orders', 'Offer pageviews', 'Offer conversion',
  'Auth Sales', 'Cancelled Sales', 'Refund sales', 'Item ID', 'GMV - commission', 'AUR', 'Cancelled Units']

/** The owner's first August row, written the way Walmart writes money. */
const row = (over: Partial<Record<string, string>> = {}): Record<string, string> => ({
  'Item Name': 'Aravi Organic Rosemary Water Spray 3.38 fl oz',
  SKU: 'AO/Water/Rosemary/100',
  GMV: '$9.99',
  'Units Sold': '1.00',
  Orders: '1.00',
  'Auth Sales': '$9.99',
  'Cancelled Sales': '$0.00',
  'Refund sales': '$0.00',
  'GMV - commission': '$9.35',
  AUR: '$9.99',
  'Cancelled Units': '0.00',
  ...over,
})

const skuMaster: SkuMaster[] = [
  { sku: 'AO/Water/Rosemary/100', productName: 'Rosemary Water Hair Spray - 100 ml', category: 'Hair Care', brand: 'Aravi Organic',
    cogs: 28, mrp: 299, gstPct: 18, launchDate: '2025-04-01', status: 'active', leadTimeDays: 21, safetyStock: 0 },
]

const run = (rows: Record<string, string>[], month = '2026-08') =>
  normalizeWalmartUsItemReport(rows, skuMaster, [], [], month, 'imp')

describe('recognising the export', () => {
  it('takes GMV net of commission beside auth sales as Walmart', () => {
    expect(detectWalmartUsItemReport(HEADERS)).toBe(true)
  })

  it('does not claim another item summary', () => {
    expect(detectWalmartUsItemReport(['sku', 'gmv', 'units sold'])).toBe(false)
  })

  /**
   * Walmart restyled this export between August and October 2026: every
   * header gained an underscore, `GMV - Commission` was rewritten as
   * `GMV_Minus_Commission`, and `Categories` became `Department`. Three of
   * those identify the file, so the October export was not recognised as
   * Walmart's at all — the upload refused a real file with nothing to say.
   */
  it('recognises the export after Walmart underscored every header', () => {
    // The October file's headers, verbatim.
    const october = ['Item_Name', 'SKU', 'GMV', 'Units_Sold', 'Orders', 'Offer_Pageviews', 'Offer_Conversion',
      'Item_id', 'Base_Item_Id', 'Item_Pageviews', 'Item_Conversion', 'Auth_Sales', 'Cancelled_Sales',
      'Refund_Sales', 'Department', 'Brand', 'Listing_Quality_Score', 'GMV_Minus_Commission', 'AUR',
      'Cancelled_Units', 'Item_Condition']
    expect(detectWalmartUsItemReport(october)).toBe(true)
  })

  it('still recognises August\'s spacing, so a reread of an old file is not a new bug', () => {
    expect(detectWalmartUsItemReport(HEADERS)).toBe(true)
  })
})

describe('the October restyling', () => {
  // The owner's real first October row.
  const october = {
    Item_Name: 'Aravi Organic Rosemary Lavender Hair Oil 6.7 fl oz',
    SKU: 'AO/Water/Rosemary/100',
    GMV: '66.93',
    Units_Sold: '6',
    Orders: '6',
    Auth_Sales: '75.92',
    Cancelled_Sales: '8.99',
    Refund_Sales: '0.00',
    Department: 'EVERYDAY HAIRCARE',
    GMV_Minus_Commission: '63.09',
    AUR: '10.845714',
    Cancelled_Units: '1',
  }

  it('reads the renamed commission column as the same charge', () => {
    const r = run([october], '2026-10')
    // 66.93 billed, 63.09 kept: the gap is what Walmart took.
    expect(r.validRecords[0].marketplaceFee).toBeCloseTo(3.84, 2)
    expect(r.totals.commission).toBeCloseTo(3.84, 2)
  })

  it('keeps the revenue identity Walmart\'s own columns state', () => {
    const r = run([october], '2026-10')
    // GMV is already net of the cancellation: auth 75.92 less 8.99 is 66.93,
    // which is what stuck. Auth sales is the gross.
    expect(r.validRecords[0].grossSales).toBeCloseTo(75.92, 2)
    expect(r.validRecords[0].netSales).toBeCloseTo(66.93, 2)
  })

  it('reads Department where the old export said Categories', () => {
    // No Product Master row for this code, so the file's own column is what
    // the category has to come from.
    const r = normalizeWalmartUsItemReport([{ ...october, SKU: 'AO/Unknown' }], [], [], [], '2026-10', 'imp')
    expect(r.validRecords[0].category).not.toBe('')
  })

  it('does not take the cancellation off GMV a second time', () => {
    const r = run([october], '2026-10')
    // The defect: GMV read as the gross and the two taken off it again, so
    // 66.93 became 57.94. It showed nothing for five months because August
    // and September cancelled and refunded nothing on any row.
    expect(r.validRecords[0].netSales).not.toBeCloseTo(66.93 - 8.99, 2)
    expect(r.totals.netSales).toBeCloseTo(66.93, 2)
  })

  it('does the same for a refund, which the owner\'s October also has', () => {
    // The real cleanser row: nothing cancelled, $9.99 refunded.
    const refunded = { ...october, SKU: 'AO/Water/Rosemary/100', GMV: '54.03', Auth_Sales: '64.02',
      Cancelled_Sales: '0.00', Refund_Sales: '9.99', GMV_Minus_Commission: '50.83' }
    const r = run([refunded], '2026-10')
    expect(r.validRecords[0].grossSales).toBeCloseTo(64.02, 2)
    expect(r.validRecords[0].netSales).toBeCloseTo(54.03, 2)
  })

  it('holds the app\'s own identity: net === gross - discount - returns', () => {
    const r = run([october], '2026-10')
    const rec = r.validRecords[0]
    const returnsValue = rec.grossSales - rec.discount - rec.netSales
    expect(returnsValue).toBeCloseTo(8.99, 2)
    expect(rec.netSales).toBeCloseTo(rec.grossSales - rec.discount - returnsValue, 6)
  })

  it('says so when a future export stops satisfying that identity', () => {
    // How this defect survived five months: nothing checked, so nothing said.
    const restated = { ...october, Auth_Sales: '66.93' }
    const r = run([restated], '2026-10')
    expect(r.warnings.some((w) => w.includes('do not satisfy'))).toBe(true)
  })

  it('reconstructs the gross where the export states no auth sales', () => {
    const { Auth_Sales: _auth, ...noAuth } = october
    const r = run([noAuth], '2026-10')
    expect(r.validRecords[0].grossSales).toBeCloseTo(66.93 + 8.99, 2)
    expect(r.validRecords[0].netSales).toBeCloseTo(66.93, 2)
    expect(r.warnings.some((w) => w.includes('do not satisfy'))).toBe(false)
  })

  it('reads an underscored row exactly as the spaced one', () => {
    const spaced = run([row({ GMV: '$66.93', 'Units Sold': '6', Orders: '6', 'Auth Sales': '$75.92',
      'Cancelled Sales': '$8.99', 'GMV - commission': '$63.09' })], '2026-10')
    const underscored = run([october], '2026-10')
    expect(underscored.validRecords[0].netSales).toBeCloseTo(spaced.validRecords[0].netSales, 6)
    expect(underscored.validRecords[0].marketplaceFee).toBeCloseTo(spaced.validRecords[0].marketplaceFee, 6)
    expect(underscored.validRecords[0].quantity).toBe(spaced.validRecords[0].quantity)
  })
})

describe('an item\'s month', () => {
  const r = run([row()])

  it('is stored in dollars, not converted here', () => {
    expect(r.validRecords[0].currency).toBe('USD')
    expect(r.validRecords[0].netSales).toBeCloseTo(9.99, 2)
  })

  it('reads the commission as the gap Walmart states', () => {
    expect(r.validRecords[0].marketplaceFee).toBeCloseTo(0.64, 2)
    expect(r.totals.commission).toBeCloseTo(0.64, 2)
  })

  // This asserted the opposite, and was wrong: it read GMV as the gross and
  // took cancelled and refunded off it, when Walmart states GMV with both
  // already out. The fixture it used could not have come from Walmart — its
  // auth sales did not equal GMV plus the two — which is exactly what the
  // reader now checks and names.
  it('leaves cancelled and refunded money where Walmart already put it', () => {
    const r2 = run([row({
      'Auth Sales': '$69.95', GMV: '$44.97', 'Cancelled Sales': '$14.99', 'Refund sales': '$9.99',
      'GMV - commission': '$39.57',
    })])
    expect(r2.validRecords[0].grossSales).toBeCloseTo(69.95, 2)
    expect(r2.validRecords[0].netSales).toBeCloseTo(44.97, 2)
    // And the two show up as returns, where every other channel's do.
    const rec = r2.validRecords[0]
    expect(rec.grossSales - rec.discount - rec.netSales).toBeCloseTo(24.98, 2)
  })

  it('is one row for the whole period, not one order', () => {
    expect(r.validRecords[0].isAggregate).toBe(true)
    expect(r.validRecords[0].orderDate).toBe('2026-08-01')
  })

  it('carries no GST: there is none in the United States', () => {
    expect(r.validRecords[0].tax).toBe(0)
  })

  it('files under the month it was given, and says that is where the month came from', () => {
    expect(run([row()], '2026-09').validRecords[0].orderDate).toBe('2026-09-01')
    expect(r.warnings.some((w) => w.includes('carries no date of its own'))).toBe(true)
  })

  it('states no commission rather than zero when the column is blank', () => {
    const r2 = run([row({ 'GMV - commission': '' })])
    expect(r2.validRecords[0].marketplaceFee).toBe(0)
  })

  it('ignores the blank line the export ends with', () => {
    expect(run([row(), {}]).validRecords).toHaveLength(1)
  })

  it('names a SKU the Product Master has never seen', () => {
    const r2 = run([row({ SKU: 'AO/NOT/IN/MASTER' })])
    expect(r2.warnings.some((w) => w.includes('AO/NOT/IN/MASTER'))).toBe(true)
  })
})
