import { describe, expect, it } from 'vitest'
import {
  detectAmazonVendorCentralSalesReport,
  normalizeAmazonVendorCentralSales,
  parseVendorAmount,
  parseVendorPreamble,
} from './amazonVendorCentralSales'
import type { RawSheet } from '@/lib/csvParse'
import type { SkuMaster } from '@/data/models'
import type { SkuMapping } from '@/data/skuMapping'

const PREAMBLE = [
  '\uFEFFProgramme=[Retail]', 'Distributor View=[Manufacturing]', 'View By=[ASIN]', 'Countries=[IN]',
  'Businesses=[HIVEFY LIFESTYLE PRIVATE LIMITED -Gujarat -MVR]', 'Locale=[en_IN]', 'Currency=[INR]',
  'Reporting Range=[Month]', 'Viewing Range=[01/07/26 - 31/07/26]', 'Report Updated=[04/09/26]',
]
const HEADER = ['ASIN', 'Product Title', 'Brand', 'Ordered Revenue', 'Ordered Units', 'Shipped Revenue', 'Shipped COGS', 'Shipped Units', 'Customer Returns']

/** The real export's shape: money with a symbol and Indian digit grouping,
 * thousands quoted, and blanks where a measure is absent. */
function sheet(rows: (string | number)[][]): RawSheet {
  return [PREAMBLE, HEADER, ...rows]
}

const ROSEMARY_30 = ['B0B8ZZ22JQ', 'Aravi Organic Rosemary Essential Oil - 30 ml', 'Aravi Organic', '₹3,05,148.87', '818', '₹0.00', '₹0.00', '844', '41']
const SUNSCREEN = ['B0CPFP8NNB', 'Aravi Organic Sunscreen Body Lotion 200ml', 'Aravi Organic', '₹2,84,875.79', '974', '₹0.00', '₹0.00', '979', '53']
const RETURNED_NET = ['B0D9L6CXL1', 'Aravi Organic Pure Batana Hair Oil - 15 ml', 'Aravi Organic', '-₹379.04', '-2', '₹0.00', '₹0.00', '5', '1']
const NO_ACTIVITY = ['B0F6C3LLKB', 'Aravi Organic Lip Glowy Balm Pack Of 2', 'Aravi Organic', '₹0.00', '0', '', '', '', '']

const MASTER: SkuMaster[] = [
  {
    sku: 'AO/EO/Rosemary/30', productName: 'Aravi Organic Rosemary Essential Oil - 30 ml', category: 'Essential Oils',
    brand: 'Aravi Organic', cogs: 81, mrp: 649, launchDate: '2024-01-01', status: 'active', leadTimeDays: 30, safetyStock: 0,
  },
]
const MAPPINGS: SkuMapping[] = [
  { channelSku: 'B0B8ZZ22JQ', internalSku: 'AO/EO/Rosemary/30', kind: 'SINGLE', source: 'manual', verified: true },
]

describe('parseVendorAmount', () => {
  it('reads Indian digit grouping, which is not every three digits', () => {
    expect(parseVendorAmount('₹3,05,148.87')).toBeCloseTo(305148.87, 2)
    expect(parseVendorAmount('"1,683"'.replace(/"/g, ''))).toBe(1683)
  })

  it('reads a negative written with the minus outside the currency symbol', () => {
    expect(parseVendorAmount('-₹1,608.48')).toBeCloseTo(-1608.48, 2)
    expect(parseVendorAmount('-2')).toBe(-2)
  })

  it('treats a blank or a dash as nothing, not as NaN', () => {
    expect(parseVendorAmount('')).toBe(0)
    expect(parseVendorAmount('  ')).toBe(0)
    expect(parseVendorAmount('-')).toBe(0)
  })
})

describe('parseVendorPreamble', () => {
  it('reads the settings line past a byte-order mark', () => {
    const settings = parseVendorPreamble(PREAMBLE)
    expect(settings['programme']).toBe('Retail')
    expect(settings['currency']).toBe('INR')
    expect(settings['viewing range']).toBe('01/07/26 - 31/07/26')
  })
})

describe('detectAmazonVendorCentralSalesReport', () => {
  it('recognises the export even though its first line is not the header', () => {
    expect(detectAmazonVendorCentralSalesReport(sheet([ROSEMARY_30]))).toBe(true)
  })

  it('does not claim a file that has no ASIN column', () => {
    expect(detectAmazonVendorCentralSalesReport([['sku', 'Ordered Revenue'], ['A', '1']])).toBe(false)
  })
})

describe('normalizeAmazonVendorCentralSales', () => {
  it('reads the month from the settings line as Indian day-first, not American', () => {
    const r = normalizeAmazonVendorCentralSales(sheet([ROSEMARY_30]), MASTER, MAPPINGS, 'imp')
    // 01/07/26 - 31/07/26 is July 2026. Read the American way it would be
    // 7 January, filing the whole month six months early.
    expect(r.meta?.month).toBe('2026-07')
    expect(r.meta?.from).toBe('2026-07-01')
    expect(r.meta?.to).toBe('2026-07-31')
    expect(r.validRecords[0].orderDate).toBe('2026-07-01')
  })

  it('keeps the reported figures exactly', () => {
    const r = normalizeAmazonVendorCentralSales(sheet([ROSEMARY_30, SUNSCREEN]), MASTER, MAPPINGS, 'imp')
    expect(r.totals.orderedRevenue).toBeCloseTo(305148.87 + 284875.79, 2)
    expect(r.totals.orderedUnits).toBe(818 + 974)
    expect(r.totals.shippedUnits).toBe(844 + 979)
    expect(r.totals.customerReturns).toBe(41 + 53)
  })

  it('marks rows as aggregates so an ASIN count is never read as an order count', () => {
    const r = normalizeAmazonVendorCentralSales(sheet([ROSEMARY_30]), MASTER, MAPPINGS, 'imp')
    expect(r.validRecords[0].isAggregate).toBe(true)
  })

  it('uses Shipped COGS as the vendor\'s revenue when the file carries it', () => {
    const withCogs = [...ROSEMARY_30]
    withCogs[6] = '₹1,50,000.00'
    const r = normalizeAmazonVendorCentralSales(sheet([withCogs]), MASTER, MAPPINGS, 'imp')
    expect(r.revenueBasis).toBe('shipped_cogs')
    expect(r.validRecords[0].netSales).toBeCloseTo(150000, 2)
    // Ordered Revenue is still kept — it is the retail demand signal.
    expect(r.validRecords[0].grossSales).toBeCloseTo(305148.87, 2)
  })

  it('falls back to Ordered Revenue and says so when Shipped COGS is absent', () => {
    const r = normalizeAmazonVendorCentralSales(sheet([ROSEMARY_30, SUNSCREEN]), MASTER, MAPPINGS, 'imp')
    expect(r.revenueBasis).toBe('ordered_revenue')
    expect(r.validRecords[0].netSales).toBeCloseTo(305148.87, 2)
    expect(r.warnings.some((w) => w.includes('Shipped COGS') && w.includes('retail value'))).toBe(true)
    expect(r.validRecords[0].raw?.['Revenue basis']).toBe('ordered_revenue')
  })

  it('does not mix the two revenue definitions inside one month', () => {
    // One ASIN has Shipped COGS and another does not. The month is on the
    // Shipped COGS basis, and the ASIN without it contributes nothing rather
    // than silently contributing a retail figure.
    const withCogs = [...ROSEMARY_30]
    withCogs[6] = '₹1,50,000.00'
    const r = normalizeAmazonVendorCentralSales(sheet([withCogs, SUNSCREEN]), MASTER, MAPPINGS, 'imp')
    expect(r.revenueBasis).toBe('shipped_cogs')
    expect(r.validRecords.map((v) => v.netSales)).toEqual([150000, 0])
  })

  it('keeps a month whose returns outweighed its orders as reported', () => {
    const r = normalizeAmazonVendorCentralSales(sheet([RETURNED_NET]), MASTER, MAPPINGS, 'imp')
    expect(r.validRecords[0].quantity).toBe(-2)
    expect(r.validRecords[0].netSales).toBeCloseTo(-379.04, 2)
    expect(r.warnings.some((w) => w.includes('negative ordered units'))).toBe(true)
  })

  it('skips an ASIN with no sales, no shipments and no returns', () => {
    const r = normalizeAmazonVendorCentralSales(sheet([ROSEMARY_30, NO_ACTIVITY]), MASTER, MAPPINGS, 'imp')
    expect(r.validRecords).toHaveLength(1)
    expect(r.warnings.some((w) => w.includes('no sales, no shipments and no returns'))).toBe(true)
  })

  it('resolves category through the ASIN mapping and flags the ASINs still unlinked', () => {
    const r = normalizeAmazonVendorCentralSales(sheet([ROSEMARY_30, SUNSCREEN]), MASTER, MAPPINGS, 'imp')
    expect(r.validRecords[0].category).toBe('Essential Oils')
    expect(r.validRecords[1].category).toBe('Uncategorized')
    expect(r.warnings.some((w) => w.includes('1 ASIN(s) are not linked'))).toBe(true)
  })

  it('gives a row the same identity every month so a re-upload restates it', () => {
    const first = normalizeAmazonVendorCentralSales(sheet([ROSEMARY_30]), MASTER, MAPPINGS, 'imp-1')
    const second = normalizeAmazonVendorCentralSales(sheet([ROSEMARY_30]), MASTER, MAPPINGS, 'imp-2')
    expect(first.validRecords[0].orderId).toBe('amazon_in_vendor-B0B8ZZ22JQ-2026-07')
    expect(second.validRecords[0].orderId).toBe(first.validRecords[0].orderId)
    expect(second.validRecords[0].orderDate).toBe(first.validRecords[0].orderDate)
  })

  it('imports nothing and explains itself when the settings line is missing', () => {
    const r = normalizeAmazonVendorCentralSales([HEADER, ROSEMARY_30], MASTER, MAPPINGS, 'imp')
    expect(r.validRecords).toHaveLength(0)
    expect(r.warnings.some((w) => w.includes('Viewing Range'))).toBe(true)
  })
})
