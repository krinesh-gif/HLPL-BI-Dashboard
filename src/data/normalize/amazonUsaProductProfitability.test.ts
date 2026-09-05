import { describe, expect, it } from 'vitest'
import { detectAmazonUsaProductProfitabilityReport, normalizeAmazonUsaProductProfitability } from './amazonUsaProductProfitability'
import type { SkuMaster } from '@/data/models'

/**
 * Two real rows of the owner's July 2026 export, copied out of
 * Aravi_Amazon_USA_PnL_FY2627_v7.xlsx unchanged — headers, blanks, signs and
 * all. Made-up rows were what let the importer look right while taking the
 * magnitude of every fee and turning the month's credits into charges.
 */
const headers: string[] = [
  "Amazon store",
  "Start date",
  "End date",
  "Parent ASIN",
  "ASIN",
  "FNSKU",
  "MSKU",
  "Currency code",
  "Average sales price",
  "Units sold",
  "Units returned",
  "Net units sold",
  "Sales",
  "Net sales",
  "Aged inventory surcharge per unit",
  "Aged inventory surcharge quantity",
  "Aged inventory surcharge total",
  "Base fulfillment fee per unit",
  "Base fulfillment fee quantity",
  "Base fulfillment fee total",
  "Base monthly storage fee per unit",
  "Base monthly storage fee quantity",
  "Base monthly storage fee total",
  "Coupon participation fee per unit",
  "Coupon participation fee quantity",
  "Coupon participation fee total",
  "Coupon performance-based fee per unit",
  "Coupon performance-based fee quantity",
  "Coupon performance-based fee total",
  "Deal daily fee per unit",
  "Deal daily fee quantity",
  "Deal daily fee total",
  "Deal performance-based fee per unit",
  "Deal performance-based fee quantity",
  "Deal performance-based fee total",
  "FBA Inventory Reimbursement per unit",
  "FBA Inventory Reimbursement quantity",
  "FBA Inventory Reimbursement total",
  "FBA disposal order fee per unit",
  "FBA disposal order fee quantity",
  "FBA disposal order fee total",
  "FBA fulfillment fees per unit",
  "FBA fulfillment fees quantity",
  "FBA fulfillment fees total",
  "FBA inbound placement service fee per unit",
  "FBA inbound placement service fee quantity",
  "FBA inbound placement service fee total",
  "Fuel and Logistics-related surcharge per unit",
  "Fuel and Logistics-related surcharge quantity",
  "Fuel and Logistics-related surcharge total",
  "Low-inventory-level fee per unit",
  "Low-inventory-level fee quantity",
  "Low-inventory-level fee total",
  "Monthly inventory storage fee per unit",
  "Monthly inventory storage fee quantity",
  "Monthly inventory storage fee total",
  "Referral Fee Refunds per unit",
  "Referral Fee Refunds quantity",
  "Referral Fee Refunds total",
  "Referral fee per unit",
  "Referral fee quantity",
  "Referral fee total",
  "Refund administration fee per unit",
  "Refund administration fee quantity",
  "Refund administration fee total",
  "Returns Processing Fee for Non-Apparel and Non-Shoes per unit",
  "Returns Processing Fee for Non-Apparel and Non-Shoes quantity",
  "Returns Processing Fee for Non-Apparel and Non-Shoes total",
  "Storage utilization surcharge per unit",
  "Storage utilization surcharge quantity",
  "Storage utilization surcharge total",
  "Sponsored Products charge per unit",
  "Sponsored Products charge quantity",
  "Sponsored Products charge total",
  "Cost of goods sold per unit",
  "Miscellaneous cost per unit",
  "Net proceeds total",
  "Net proceeds per net unit sold"
]

const julyRows: Record<string, string>[] = [
  {
    "Amazon store": "US",
    "Start date": "07/01/2026",
    "End date": "07/31/2026",
    "Parent ASIN": "B0DDBYGTQS",
    "ASIN": "B0DDBYGTQS",
    "FNSKU": "",
    "MSKU": "AO/LBalm/Tinted(BT)",
    "Currency code": "USD",
    "Average sales price": "10.052308",
    "Units sold": "13",
    "Units returned": "1",
    "Net units sold": "12",
    "Sales": "130.68",
    "Net sales": "121.69",
    "Aged inventory surcharge per unit": "",
    "Aged inventory surcharge quantity": "",
    "Aged inventory surcharge total": "",
    "Base fulfillment fee per unit": "2.91",
    "Base fulfillment fee quantity": "26",
    "Base fulfillment fee total": "75.66",
    "Base monthly storage fee per unit": "0.00283",
    "Base monthly storage fee quantity": "89.57",
    "Base monthly storage fee total": "0.2535",
    "Coupon participation fee per unit": "0.009067",
    "Coupon participation fee quantity": "3",
    "Coupon participation fee total": "0.0272",
    "Coupon performance-based fee per unit": "0.237167",
    "Coupon performance-based fee quantity": "3",
    "Coupon performance-based fee total": "0.7115",
    "Deal daily fee per unit": "",
    "Deal daily fee quantity": "",
    "Deal daily fee total": "",
    "Deal performance-based fee per unit": "",
    "Deal performance-based fee quantity": "",
    "Deal performance-based fee total": "",
    "FBA Inventory Reimbursement per unit": "-5.516667",
    "FBA Inventory Reimbursement quantity": "3",
    "FBA Inventory Reimbursement total": "-16.55",
    "FBA disposal order fee per unit": "0.84",
    "FBA disposal order fee quantity": "1",
    "FBA disposal order fee total": "0.84",
    "FBA fulfillment fees per unit": "3.01",
    "FBA fulfillment fees quantity": "26",
    "FBA fulfillment fees total": "78.26",
    "FBA inbound placement service fee per unit": "",
    "FBA inbound placement service fee quantity": "",
    "FBA inbound placement service fee total": "",
    "Fuel and Logistics-related surcharge per unit": "0.1",
    "Fuel and Logistics-related surcharge quantity": "26",
    "Fuel and Logistics-related surcharge total": "2.6",
    "Low-inventory-level fee per unit": "",
    "Low-inventory-level fee quantity": "",
    "Low-inventory-level fee total": "",
    "Monthly inventory storage fee per unit": "0.00283",
    "Monthly inventory storage fee quantity": "89.57",
    "Monthly inventory storage fee total": "0.2535",
    "Referral Fee Refunds per unit": "-0.72",
    "Referral Fee Refunds quantity": "1",
    "Referral Fee Refunds total": "-0.72",
    "Referral fee per unit": "0.7925",
    "Referral fee quantity": "16",
    "Referral fee total": "12.68",
    "Refund administration fee per unit": "0.14",
    "Refund administration fee quantity": "1",
    "Refund administration fee total": "0.14",
    "Returns Processing Fee for Non-Apparel and Non-Shoes per unit": "",
    "Returns Processing Fee for Non-Apparel and Non-Shoes quantity": "",
    "Returns Processing Fee for Non-Apparel and Non-Shoes total": "",
    "Storage utilization surcharge per unit": "0",
    "Storage utilization surcharge quantity": "35.36",
    "Storage utilization surcharge total": "0",
    "Sponsored Products charge per unit": "0.364333",
    "Sponsored Products charge quantity": "60",
    "Sponsored Products charge total": "21.86",
    "Cost of goods sold per unit": "0.3",
    "Miscellaneous cost per unit": "",
    "Net proceeds total": "20.5878",
    "Net proceeds per net unit sold": "1.71565"
  },
  {
    "Amazon store": "US",
    "Start date": "07/01/2026",
    "End date": "07/31/2026",
    "Parent ASIN": "B0H9DSYFK1",
    "ASIN": "B0GS1FXMW1",
    "FNSKU": "",
    "MSKU": "NX/Spray/Sunscreen/100",
    "Currency code": "USD",
    "Average sales price": "15.045217",
    "Units sold": "989",
    "Units returned": "58",
    "Net units sold": "931",
    "Sales": "14879.72",
    "Net sales": "14084.12",
    "Aged inventory surcharge per unit": "",
    "Aged inventory surcharge quantity": "",
    "Aged inventory surcharge total": "",
    "Base fulfillment fee per unit": "3.938622",
    "Base fulfillment fee quantity": "1038",
    "Base fulfillment fee total": "4088.29",
    "Base monthly storage fee per unit": "0.008359",
    "Base monthly storage fee quantity": "401.58",
    "Base monthly storage fee total": "3.357",
    "Coupon participation fee per unit": "0.018394",
    "Coupon participation fee quantity": "262",
    "Coupon participation fee total": "4.8191",
    "Coupon performance-based fee per unit": "0.332417",
    "Coupon performance-based fee quantity": "262",
    "Coupon performance-based fee total": "87.0932",
    "Deal daily fee per unit": "0.133205",
    "Deal daily fee quantity": "508",
    "Deal daily fee total": "67.6679",
    "Deal performance-based fee per unit": "0.175041",
    "Deal performance-based fee quantity": "508",
    "Deal performance-based fee total": "88.9209",
    "FBA Inventory Reimbursement per unit": "-3.77",
    "FBA Inventory Reimbursement quantity": "1",
    "FBA Inventory Reimbursement total": "-3.77",
    "FBA disposal order fee per unit": "0.84",
    "FBA disposal order fee quantity": "14",
    "FBA disposal order fee total": "11.76",
    "FBA fulfillment fees per unit": "4.718565",
    "FBA fulfillment fees quantity": "1038",
    "FBA fulfillment fees total": "4897.87",
    "FBA inbound placement service fee per unit": "0.24",
    "FBA inbound placement service fee quantity": "1900",
    "FBA inbound placement service fee total": "456",
    "Fuel and Logistics-related surcharge per unit": "0.14",
    "Fuel and Logistics-related surcharge quantity": "1067",
    "Fuel and Logistics-related surcharge total": "149.38",
    "Low-inventory-level fee per unit": "0.618744",
    "Low-inventory-level fee quantity": "1067",
    "Low-inventory-level fee total": "660.2",
    "Monthly inventory storage fee per unit": "0.008359",
    "Monthly inventory storage fee quantity": "401.58",
    "Monthly inventory storage fee total": "3.357",
    "Referral Fee Refunds per unit": "-2.079107",
    "Referral Fee Refunds quantity": "56",
    "Referral Fee Refunds total": "-116.43",
    "Referral fee per unit": "2.221604",
    "Referral fee quantity": "991",
    "Referral fee total": "2201.61",
    "Refund administration fee per unit": "0.416724",
    "Refund administration fee quantity": "58",
    "Refund administration fee total": "24.17",
    "Returns Processing Fee for Non-Apparel and Non-Shoes per unit": "",
    "Returns Processing Fee for Non-Apparel and Non-Shoes quantity": "",
    "Returns Processing Fee for Non-Apparel and Non-Shoes total": "",
    "Storage utilization surcharge per unit": "0",
    "Storage utilization surcharge quantity": "18.1",
    "Storage utilization surcharge total": "0",
    "Sponsored Products charge per unit": "0.725018",
    "Sponsored Products charge quantity": "2214",
    "Sponsored Products charge total": "1605.19",
    "Cost of goods sold per unit": "",
    "Miscellaneous cost per unit": "",
    "Net proceeds total": "4755.8619",
    "Net proceeds per net unit sold": "5.108337"
  }
]

const skuMaster: SkuMaster[] = [
  { sku: 'NX/Spray/Sunscreen/100', productName: 'NX Sunscreen Spray 100ml', category: 'Skin Care', brand: 'Aravi Organic', cogs: 96.4, mrp: 449, launchDate: '2025-01-01', status: 'active', leadTimeDays: 21, safetyStock: 120 },
]

const run = (rows = julyRows, hdrs = headers) =>
  normalizeAmazonUsaProductProfitability(hdrs, rows, skuMaster, 'import-1')

describe('detectAmazonUsaProductProfitabilityReport', () => {
  it('recognises the real header set', () => {
    expect(detectAmazonUsaProductProfitabilityReport(headers)).toBe(true)
  })
  it('rejects an unrelated header set', () => {
    expect(detectAmazonUsaProductProfitabilityReport(['Campaign', 'Ad Spend'])).toBe(false)
  })
})

describe('every fee column is kept as itself', () => {
  const facts = run().facts

  it('sums each column under its own name', () => {
    const f = facts.feeTotalsUsd ?? {}
    expect(f.referralFee).toBeCloseTo(12.68 + 2201.61, 4)
    expect(f.fbaFulfillmentFees).toBeCloseTo(78.26 + 4897.87, 4)
    expect(f.baseFulfillmentFee).toBeCloseTo(75.66 + 4088.29, 4)
    expect(f.dealDailyFee).toBeCloseTo(67.6679, 4)
    expect(f.sponsoredProductsCharge).toBeCloseTo(21.86 + 1605.19, 4)
  })

  it('keeps a credit negative instead of charging the month for its own refund', () => {
    const f = facts.feeTotalsUsd ?? {}
    expect(f.referralFeeRefunds).toBeCloseTo(-0.72 - 116.43, 4)
    expect(f.fbaInventoryReimbursement).toBeCloseTo(-16.55 - 3.77, 4)
  })

  it('carries the export’s own cost and Net proceeds columns for reconciliation', () => {
    expect(facts.sheetCogsUsd).toBeCloseTo(0.3 * 12, 4)
    expect(facts.sheetMiscCostUsd).toBeCloseTo(0, 6)
    expect(facts.sheetNetProceedsUsd).toBeCloseTo(20.5878 + 4755.8619, 4)
  })

  it('records the units behind the month', () => {
    expect(facts.unitsSoldQty).toBe(13 + 989)
    expect(facts.unitsReturnedQty).toBe(1 + 58)
    expect(facts.netUnitsSoldQty).toBe(12 + 931)
  })
})

describe('the import reconciles itself against the export', () => {
  it('ties to Amazon’s own Net proceeds and says nothing', () => {
    const result = run()
    expect(result.warnings.some((w) => w.includes('Net proceeds'))).toBe(false)
  })

  it('says so loudly when it does not tie', () => {
    // Drop the referral fee column from the header list: the importer can no
    // longer see it, so its own total must stop agreeing with the export's.
    const hdrs = headers.filter((h) => h !== 'Referral fee total')
    const result = run(julyRows, hdrs)
    expect(result.warnings.some((w) => w.includes('Net proceeds'))).toBe(true)
  })
})

describe('a column Amazon has just introduced', () => {
  const hdrs = [...headers, 'Some New Fee total']
  const rows = julyRows.map((r) => ({ ...r, 'Some New Fee total': '5' }))

  it('is kept under its own header rather than folded into another fee', () => {
    const facts = run(rows, hdrs).facts
    expect(facts.unmappedFeeTotalsUsd).toEqual({ 'Some New Fee total': 10 })
  })

  it('is named in a warning, so it is dealt with rather than discovered later', () => {
    expect(run(rows, hdrs).warnings.some((w) => w.includes('Some New Fee total'))).toBe(true)
  })
})

describe('rows', () => {
  it('detects the report month from the Start date column', () => {
    expect(run().month).toBe('2026-07')
  })

  it('creates no sales record for a SKU that sold nothing, but still charges its fees', () => {
    // Stock sitting in the warehouse accrues storage, aged-inventory and
    // disposal fees whether or not it sells, and Amazon counts them in Net
    // proceeds. Dropping these rows understated July's charges by $84.22.
    const rows = [{ ...julyRows[0], 'Units sold': '0', 'Net units sold': '0' }]
    const result = run(rows)
    expect(result.validRecords).toHaveLength(0)
    expect(result.invalidRows).toHaveLength(0)
    expect(result.facts.feeTotalsUsd?.baseMonthlyStorageFee).toBeCloseTo(0.2535, 4)
    expect(result.facts.feeTotalsUsd?.fbaDisposalOrderFee).toBeCloseTo(0.84, 4)
    expect(result.warnings.some((w) => w.includes('non-selling SKUs'))).toBe(true)
  })

  it('rejects rows with no MSKU', () => {
    expect(run([{ ...julyRows[0], MSKU: '' }]).invalidRows).toHaveLength(1)
  })
})

describe('whether a column is inside another is decided by the file, not assumed', () => {
  it('proves the nesting when the July file shows it, row by row', () => {
    // FBA fulfilment fees = base + fuel + low-inventory, and monthly inventory
    // storage repeats base monthly storage, on every row of this export.
    expect(run().facts.nestedFeeIds?.sort()).toEqual([
      'baseFulfillmentFee', 'fuelLogisticsSurcharge', 'lowInventoryLevelFee', 'monthlyInventoryStorageFee',
    ])
  })

  it('counts every column on its own when the file does not show the nesting', () => {
    // One row where the parent no longer equals its parts is enough: the
    // relationship is a property of Amazon's export, not a rule this code owns.
    const rows = julyRows.map((r, i) =>
      i === 0 ? { ...r, 'FBA fulfillment fees total': '999' } : r)
    expect(run(rows).facts.nestedFeeIds).not.toContain('baseFulfillmentFee')
  })

  it('still ties to the export’s own Net proceeds either way', () => {
    expect(run().warnings.some((w) => w.includes('Net proceeds'))).toBe(false)
  })
})
