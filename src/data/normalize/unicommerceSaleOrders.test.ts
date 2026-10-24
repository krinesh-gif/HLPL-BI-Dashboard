import { describe, expect, it } from 'vitest'
import {
  detectUnicommerceSaleOrders,
  normalizeUnicommerceSaleOrders,
  unicommerceDate,
  unicommerceDateOrder,
  unicommerceOutcome,
} from './unicommerceSaleOrders'
import type { SkuMaster } from '@/data/models'
import type { SkuMapping } from '@/data/skuMapping'

const HEADERS = ['Item SKU Code', 'Channel Name', 'MRP', 'Total Price', 'Selling Price', 'Subtotal', 'Discount',
  'taxable value', 'GST Tax Type Code', 'CGST', 'IGST', 'SGST', 'UTGST', 'Order Date as dd/mm/yyyy hh:MM:ss',
  'Sale Order Code', 'Sale Order Status', 'Shipping Courier Status', 'Shipping Tracking Status']

/** The owner's first September row. */
const row = (over: Partial<Record<string, string>> = {}): Record<string, string> => ({
  'Item SKU Code': 'AO/Water/Rosemary/100',
  'Channel Name': 'SHOPIFY',
  MRP: '299',
  'Total Price': '129.84',
  'Selling Price': '129.84',
  Subtotal: '229.2',
  Discount: '119.16',
  'taxable value': '110.04',
  'GST Tax Type Code': '18',
  CGST: '9.9',
  SGST: '9.9',
  IGST: '0',
  UTGST: '0',
  'Order Date as dd/mm/yyyy hh:MM:ss': '9/15/2026 10:53',
  'Sale Order Code': '`7997656400188',
  'Sale Order Status': 'COMPLETE',
  'Shipping Courier Status': 'DELIVERED',
  'Shipping Tracking Status': 'DELIVERED',
  ...over,
})

const skuMaster: SkuMaster[] = [
  { sku: 'AO/Water/Rosemary/100', productName: 'Rosemary Water Hair Spray - 100 ml', category: 'Hair Care',
    brand: 'Aravi Organic', cogs: 28, mrp: 299, gstPct: 18, launchDate: '2025-04-01', status: 'active',
    leadTimeDays: 21, safetyStock: 0 },
  { sku: 'AO/Fluid /Sunscreen/50', productName: 'Fluid Sunscreen - 50 ml', category: 'Skin Care',
    brand: 'Aravi Organic', cogs: 51, mrp: 449, gstPct: 18, launchDate: '2025-04-01', status: 'active',
    leadTimeDays: 21, safetyStock: 0 },
]
const mappings: SkuMapping[] = []
const run = (rows: Record<string, string>[]) =>
  normalizeUnicommerceSaleOrders(rows, skuMaster, mappings, [], 'imp')

describe('recognising the export', () => {
  it('takes a channel name beside a courier status as Unicommerce', () => {
    expect(detectUnicommerceSaleOrders(HEADERS)).toBe(true)
  })

  it('does not claim a marketplace order list', () => {
    expect(detectUnicommerceSaleOrders(['order id', 'sku', 'qty', 'total price'])).toBe(false)
  })
})

describe('the date, whose column name is wrong', () => {
  it('reads the export month-first, as it writes them', () => {
    // The column says dd/mm/yyyy and the file says 8/30/2026, which can only
    // be 30 August.
    expect(unicommerceDateOrder(['8/30/2026 10:53', '9/1/2026 09:00'])).toEqual({ order: 'mdy', decided: true })
    expect(unicommerceDate('8/30/2026 10:53', 'mdy')).toBe('2026-08-30')
  })

  it('reads a genuinely day-first file day-first', () => {
    expect(unicommerceDateOrder(['30/8/2026', '1/9/2026'])).toEqual({ order: 'dmy', decided: true })
    expect(unicommerceDate('30/8/2026', 'dmy')).toBe('2026-08-30')
  })

  it('says it could not decide when every number is 12 or under', () => {
    const { decided } = unicommerceDateOrder(['9/1/2026', '9/5/2026'])
    expect(decided).toBe(false)
  })

  it('reports an undecided file rather than filing it silently', () => {
    const r = run([row({ 'Order Date as dd/mm/yyyy hh:MM:ss': '9/5/2026 10:00' })])
    expect(r.warnings.some((w) => w.includes('could be read either way round'))).toBe(true)
  })
})

describe('what a courier status means', () => {
  it('reads the six September writes', () => {
    expect(unicommerceOutcome('DELIVERED', 'DELIVERED')).toBe('delivered')
    expect(unicommerceOutcome('RTO', 'RETURNED_TO_ORIGIN')).toBe('rto')
    expect(unicommerceOutcome('RETURN_DELIVERED', 'STATUS_NOT_DEFINED')).toBe('returned')
    expect(unicommerceOutcome('OFD', 'STATUS_NOT_DEFINED')).toBe('in_flight')
    expect(unicommerceOutcome('INTRANSIT', '')).toBe('in_flight')
    expect(unicommerceOutcome('', '')).toBe('in_flight')
  })

  it('treats a status it has never seen as still moving', () => {
    expect(unicommerceOutcome('SOME_NEW_STATUS')).toBe('in_flight')
  })
})

describe('a delivered unit', () => {
  const r = run([row()])

  it('earns what the customer paid less the GST the file states', () => {
    expect(r.validRecords[0].netSales).toBeCloseTo(129.84 - 19.8, 2)
    expect(r.validRecords[0].tax).toBeCloseTo(19.8, 2)
    expect(r.validRecords[0].taxInGross).toBe(true)
  })

  it('is one unit, because the export has no quantity column', () => {
    expect(r.validRecords[0].quantity).toBe(1)
    const two = run([row(), row({ 'Total Price': '223.48' })])
    expect(two.totals.units).toBe(2)
    expect(two.totals.customerPaid).toBeCloseTo(353.32, 2)
  })

  it('sums the GST from the parts, which are always stated', () => {
    // `taxable value` is blank on two thirds of the file; CGST/SGST/IGST
    // never are.
    const blank = run([row({ 'taxable value': '', CGST: '0', SGST: '0', IGST: '43.72', 'Total Price': '286.64' })])
    expect(blank.validRecords[0].tax).toBeCloseTo(43.72, 2)
    expect(blank.validRecords[0].netSales).toBeCloseTo(242.92, 2)
  })
})

describe('a unit that came back', () => {
  it('keeps its gross and earns no net', () => {
    const r = run([row({ 'Shipping Courier Status': 'RTO', 'Shipping Tracking Status': 'RETURNED_TO_ORIGIN' })])
    expect(r.validRecords[0].grossSales).toBe(299)
    expect(r.validRecords[0].netSales).toBe(0)
    expect(r.validRecords[0].rtoUnits).toBe(1)
    expect(r.validRecords[0].quantity).toBe(0)
  })

  it('separates a customer return from an RTO', () => {
    const r = run([row({ 'Shipping Courier Status': 'RETURN_DELIVERED' })])
    expect(r.validRecords[0].returnUnits).toBe(1)
    expect(r.validRecords[0].rtoUnits).toBe(0)
  })

  it('reports the value lost, which is what Shopify cannot see', () => {
    const r = run([row(), row({ 'Shipping Courier Status': 'RTO' })])
    expect(r.totals.lostToReturns).toBeCloseTo(129.84, 2)
    expect(r.warnings.some((w) => w.includes('went out and came back'))).toBe(true)
  })

  it('earns nothing while it is still moving, and says how much that is', () => {
    const r = run([row({ 'Shipping Courier Status': 'INTRANSIT' })])
    expect(r.validRecords[0].netSales).toBe(0)
    expect(r.validRecords[0].status).toBe('pending')
    expect(r.totals.inFlight).toBeCloseTo(129.84, 2)
  })
})

describe('a file that is not only the website', () => {
  it('skips a marketplace\'s rows rather than booking them twice', () => {
    const r = run([row(), row({ 'Channel Name': 'FLIPKART', 'Total Price': '999' })])
    expect(r.validRecords).toHaveLength(1)
    expect(r.skippedChannels).toEqual([{ channel: 'FLIPKART', rows: 1 }])
    expect(r.warnings.some((w) => w.includes('FLIPKART'))).toBe(true)
  })
})

describe('what the export does not carry', () => {
  it('charges no marketplace fee: the website pays none', () => {
    expect(run([row()]).validRecords[0].marketplaceFee).toBe(0)
  })

  it('keeps the delivery the customer paid for in revenue, and says so', () => {
    const r = run([row({ 'Total Price': '286.64', 'Selling Price': '257.64', IGST: '43.72', CGST: '0', SGST: '0' })])
    expect(r.totals.shippingCharged).toBeCloseTo(29, 2)
    expect(r.warnings.some((w) => w.includes('delivery charged to customers'))).toBe(true)
  })

  it('reads a code the Product Master spells with a stray space', () => {
    const r = run([row({ 'Item SKU Code': 'AO/Fluid/Sunscreen/50' })])
    expect(r.validRecords[0].sku).toBe('AO/Fluid /Sunscreen/50')
    expect(r.validRecords[0].productName).toBe('Fluid Sunscreen - 50 ml')
  })

  it('names a code the Product Master has never seen', () => {
    const r = run([row({ 'Item SKU Code': 'AO/F/LOOFAH' })])
    expect(r.warnings.some((w) => w.includes('AO/F/LOOFAH'))).toBe(true)
  })
})
