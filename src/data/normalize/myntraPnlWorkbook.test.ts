import { describe, expect, it } from 'vitest'
import {
  detectMyntraPnlWorkbook,
  normalizeMyntraPnlWorkbook,
  parseMyntraMonth,
} from './myntraPnlWorkbook'
import type { RawSheet } from '@/lib/csvParse'
import type { SkuMaster } from '@/data/models'
import type { SkuMapping } from '@/data/skuMapping'

/**
 * The July 2026 report's own shape and figures: the summary sheet's bullets
 * and indentation, its negative expenses, and the SKU sheet's positive ones.
 */
const SUMMARY: RawSheet = [
  ['Report Specifications', '', ''],
  ['Report Type:', 'Profit & Loss Report', ''],
  ['Orders Received During:', 'July 2026', ''],
  ['Seller ID:', '26493', ''],
  ['PNL Summary', '', ''],
  ['Item', 'Amount (INR)', 'Units'],
  ['Gross Sales', 677353, 2810],
  ['Returns and Cancellations', -137012, -549],
  ['------------------------------------------------------', '', ''],
  ['Estimated Net Sales', 540341, 2261],
  ['Total Expenses (Forward − Reverse)', -258008.374, ''],
  ['• Forward Expense', -201356.985, ''],
  ['    ◦ Commission Fee', -85109.049, '-'],
  ['    ◦ Taxes (TCS)', -2656.013, '-'],
  ['    ◦ Taxes (TDS)', -531.401, '-'],
  ['    ◦ Logistic Charge', -113060.522, '-'],
  ['    ◦ Additional Charges', -0, '-'],
  ['• Reverse Expense', -56651.389, ''],
  ['    ◦ Commission Recovery', 11299.675, '-'],
  ['    ◦ TCS Recovery', 353.325, '-'],
  ['    ◦ TDS Recovery', 70.71, '-'],
  ['    ◦ Reverse Logistic Charge', -68375.099, '-'],
  ['    ◦ Additional Recovery', 0, '-'],
  ['Estimated Net Sales After Expenses', 282332.626, 2261],
  ['    • Product GST', -91753.31, '-'],
  ['Non Order Deductions', '', ''],
  ['NOD Paid', 0, ''],
  ['NOD Deducted', 0, ''],
  ['Rewards & Other Benefits', 27730.994, ''],
  ['• SJIT Incentive', 17089.994, ''],
  ['• Commission Discount', 10641, ''],
  ['• Order SPF', 0, ''],
  ['Bank Settlement (Projected)', 299422.62, ''],
  ['Bank Settlement (Settled)', 375765.789, ''],
  ['Bank Settlement (Unsettled)', -76343.169, ''],
  ['Input Tax Credits', 531.401, ''],
  ['• GST + TCS', 531.401, ''],
  ['• TDS', 0, ''],
  ['Earnings on Platform', 299954.021, ''],
  ['Net Margin (% of Net Sales)', 0.5541, ''],
]

const DETAIL_HEADER = [
  'seller_id', 'sku_code', 'style_id', 'sku_id', 'brand_name',
  'GrossSalesAmount', 'GrossSalesUnit', 'ReturnsandCancellationsAmount', 'ReturnsandCancellationsUnit',
  'EstimatedNetSalesAmount', 'EstimatedNetSalesUnit', 'TotalExpensesAmount', 'GST_Amount',
  'BankSettlement_Projected',
]
// Expenses are positive here and negative on the summary sheet — the one real
// trap in this workbook.
const LOTION = ['26493', 'AO/BodyLotion/AHA_BHA/200', '30431795', '97817143', 'Aravi Organic', 13848, 44, 2282, 7, 11566, 37, 5057.726, 2000.01, 6983.274]
const ALMOND = ['26493', 'AO/CO/Almond/200', '22329066', '70735168', 'Aravi Organic', 9478, 39, 2278, 9, 7200, 30, 3731.351, 162, 3468.649]
const NOTHING = ['26493', 'C2/VITC-UARO', '36573909', '116912442', 'Aravi Organic', 0, 0, 0, 0, 0, 0, 0, 0, 0]

const sheets = (detail: (string | number)[][] = [LOTION, ALMOND]): Record<string, RawSheet> => ({
  PnL_Summary: SUMMARY,
  Glossary: [['Column Name', 'Description']],
  SKU_Detail: [DETAIL_HEADER, ...detail],
})

const MASTER: SkuMaster[] = [
  {
    sku: 'AO/BodyLotion/AHA_BHA/200', productName: 'Aravi Organic AHA BHA Body Lotion - 200 ml', category: 'Skin Care',
    brand: 'Aravi Organic', cogs: 64, mrp: 449, launchDate: '2024-01-01', status: 'active', leadTimeDays: 30, safetyStock: 0,
  },
]
const MAPPINGS: SkuMapping[] = []

describe('parseMyntraMonth', () => {
  it('reads the month Myntra writes in words', () => {
    expect(parseMyntraMonth('July 2026')).toBe('2026-07')
    expect(parseMyntraMonth('January 2027')).toBe('2027-01')
  })

  it('returns nothing rather than a guess for anything else', () => {
    expect(parseMyntraMonth('07/2026')).toBe('')
    expect(parseMyntraMonth('')).toBe('')
  })
})

describe('detectMyntraPnlWorkbook', () => {
  it('recognises the workbook by its two data sheets', () => {
    expect(detectMyntraPnlWorkbook(['PnL_Summary', 'Glossary', 'SKU_Detail'])).toBe(true)
  })

  it('does not claim a workbook that has only one of them', () => {
    expect(detectMyntraPnlWorkbook(['PnL_Summary', 'Glossary'])).toBe(false)
    expect(detectMyntraPnlWorkbook(['Order Payments', 'Ads Cost'])).toBe(false)
  })
})

describe('normalizeMyntraPnlWorkbook', () => {
  const result = () => normalizeMyntraPnlWorkbook(sheets(), MASTER, MAPPINGS, 'imp')

  it('reads the month and seller from the report header', () => {
    const r = result()
    expect(r.month).toBe('2026-07')
    expect(r.facts?.sellerId).toBe('26493')
  })

  it('reads every line through Myntra\'s bullets and indentation', () => {
    const f = result().facts!
    expect(f.grossSales).toBe(677353)
    expect(f.grossSalesUnits).toBe(2810)
    expect(f.estimatedNetSales).toBe(540341)
    expect(f.estimatedNetSalesUnits).toBe(2261)
    expect(f.fwdCommissionFee).toBeCloseTo(85109.049, 3)
    expect(f.fwdLogisticCharge).toBeCloseTo(113060.522, 3)
    expect(f.earningsOnPlatform).toBeCloseTo(299954.021, 3)
  })

  it('normalizes the sheet\'s negative expenses to magnitudes', () => {
    const f = result().facts!
    expect(f.returnsAndCancellations).toBe(137012)
    expect(f.returnsAndCancellationsUnits).toBe(549)
    expect(f.totalExpenses).toBeCloseTo(258008.374, 3)
    expect(f.forwardExpense).toBeCloseTo(201356.985, 3)
    expect(f.revLogisticCharge).toBeCloseTo(68375.099, 3)
  })

  it('keeps Reverse Expense signed, because its recoveries are credits', () => {
    const f = result().facts!
    expect(f.reverseExpense).toBeCloseTo(-56651.389, 3)
    expect(f.revCommissionRecovery).toBeCloseTo(11299.675, 3)
    expect(f.revTcsRecovery).toBeCloseTo(353.325, 3)
  })

  it('does not let a reverse line overwrite its forward twin', () => {
    // "Commission Fee" under Forward and "Commission Recovery" under Reverse
    // are different numbers for the same word. Read into one key, the recovery
    // would silently replace the fee.
    const f = result().facts!
    expect(f.fwdCommissionFee).toBeCloseTo(85109.049, 3)
    expect(f.revCommissionRecovery).toBeCloseTo(11299.675, 3)
  })

  it('checks the statement against the per-SKU sheet and reports the gap', () => {
    // The two rows here are a subset of the month, so the sheets disagree and
    // the import says so rather than showing a total nothing supports.
    const r = result()
    const gross = r.checks.find((c) => c.name === 'Gross Sales')!
    expect(gross.passed).toBe(false)
    expect(gross.detail).toContain('677353.00')
  })

  it('confirms the Commission Discount is already inside the Commission Fee', () => {
    // Bank Settlement (Projected) is Net Sales After Expenses plus the SJIT
    // incentive alone. Adding the 10,641 Commission Discount as well would
    // count it twice — this check is what would catch that changing.
    const check = result().checks.find((c) => c.name.startsWith('Bank Settlement (Projected)'))!
    expect(check.passed).toBe(true)
  })

  it('turns each SKU row into one aggregated record for the month', () => {
    const r = result()
    expect(r.validRecords).toHaveLength(2)
    const lotion = r.validRecords[0]
    expect(lotion.sku).toBe('AO/BodyLotion/AHA_BHA/200')
    expect(lotion.orderId).toBe('myntra-AO/BodyLotion/AHA_BHA/200-2026-07')
    expect(lotion.orderDate).toBe('2026-07-01')
    expect(lotion.isAggregate).toBe(true)
    expect(lotion.channel).toBe('myntra')
  })

  it('counts net units, not gross, so returns are deducted once', () => {
    const lotion = result().validRecords[0]
    expect(lotion.quantity).toBe(37)
    expect(lotion.returnUnits).toBe(7)
    expect(lotion.grossSales).toBe(13848)
    expect(lotion.netSales).toBe(11566)
  })

  it('names the product from the Product Master and flags what is missing', () => {
    const r = result()
    expect(r.validRecords[0].productName).toBe('Aravi Organic AHA BHA Body Lotion - 200 ml')
    expect(r.validRecords[0].category).toBe('Skin Care')
    expect(r.validRecords[1].category).toBe('Uncategorized')
    expect(r.warnings.some((w) => w.includes('1 Myntra SKU code(s) are not in the Product Master'))).toBe(true)
  })

  it('skips a SKU row with no sales, no returns and no charges', () => {
    const r = normalizeMyntraPnlWorkbook(sheets([LOTION, NOTHING]), MASTER, MAPPINGS, 'imp')
    expect(r.validRecords).toHaveLength(1)
    expect(r.warnings.some((w) => w.includes('no sales, no returns and no charges'))).toBe(true)
  })

  it('gives a row the same identity every time so a re-upload restates it', () => {
    const first = normalizeMyntraPnlWorkbook(sheets(), MASTER, MAPPINGS, 'imp-1')
    const second = normalizeMyntraPnlWorkbook(sheets(), MASTER, MAPPINGS, 'imp-2')
    expect(second.validRecords[0].orderId).toBe(first.validRecords[0].orderId)
    expect(second.validRecords[0].orderDate).toBe(first.validRecords[0].orderDate)
  })

  it('imports nothing and explains itself when the month is missing', () => {
    const withoutMonth = { ...sheets(), PnL_Summary: SUMMARY.filter((r) => r[0] !== 'Orders Received During:') }
    const r = normalizeMyntraPnlWorkbook(withoutMonth, MASTER, MAPPINGS, 'imp')
    expect(r.facts).toBeNull()
    expect(r.validRecords).toHaveLength(0)
    expect(r.warnings[0]).toContain('Orders Received During')
  })

  it('passes every cross-check when the SKU sheet is the whole month', () => {
    // The same two rows, scaled so they add up to the statement — which is
    // what a real file does.
    const whole = [
      ['26493', 'AO/BodyLotion/AHA_BHA/200', '1', '1', 'Aravi Organic', 677353, 2810, 137012, 549, 540341, 2261, 258008.374, 91753.31, 299422.62],
    ]
    const r = normalizeMyntraPnlWorkbook(sheets(whole), MASTER, MAPPINGS, 'imp')
    expect(r.checks.filter((c) => !c.passed)).toEqual([])
  })
})
