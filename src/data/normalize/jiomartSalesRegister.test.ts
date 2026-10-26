import { describe, expect, it } from 'vitest'
import type { SkuMaster } from '@/data/models'
import {
  detectJiomartSalesRegister, jiomartDate, jiomartIsReversal, jiomartOutcome,
  normalizeJiomartSalesRegister,
} from './jiomartSalesRegister'

/** The real August file's headers, verbatim. */
const HEADERS = [
  'Seller GSTIN', 'Order ID', 'Order Item ID', 'Order Type', 'Order Date', 'Order Approval Date', 'Type',
  'Shipment Number', 'Original Shipment Number', 'Fulfillment Type', 'Fulfiller Name',
  'Product Title/Description', 'FSN / Product ID', 'SKU', 'HSN Code', 'Order Status', 'Event Type',
  'Event Sub Type', 'Item Quantity', 'Buyer Invoice ID', 'Original Invoice ID', 'Buyer Invoice Date',
  'Offer Price', 'Seller Coupon Amount', 'Final Invoice Amount (Offer Price minus Seller Coupon Amount)',
  'Taxable Value (Final Invoice Amount -Taxes)', 'IGST Rate', 'IGST Amount', 'CGST Rate', 'CGST Amount',
  'SGST Rate (or UTGST as applicable)', 'SGST Amount (Or UTGST as applicable)', 'Total TCS Deducted',
]

const skuMaster: SkuMaster[] = [
  { sku: 'AO/BWash/Salicylic/300', productName: 'Body Wash', category: 'Body Care', brand: 'AO', cogs: 62, mrp: 299,
    launchDate: '2025-01-01', status: 'active', leadTimeDays: 21, safetyStock: 0 },
  { sku: 'AO/Water/Rosemary/100', productName: 'Rosemary Water', category: 'Hair Care', brand: 'AO', cogs: 28, mrp: 199,
    launchDate: '2025-01-01', status: 'active', leadTimeDays: 21, safetyStock: 0 },
]

function row(over: Record<string, string>): Record<string, string> {
  return {
    'Order ID': 'JM001', 'Order Item ID': '1', 'Order Date': '2026-08-02 20:48:04 +0530',
    'Product Title/Description': 'Thing', SKU: 'AO/BWash/Salicylic/300', 'Order Status': 'delivered',
    'Event Type': 'sale', 'Event Sub Type': 'sale', 'Item Quantity': '1',
    'Buyer Invoice ID': 'S001', 'Original Invoice ID': 'S001',
    'Offer Price': '299.0', 'Seller Coupon Amount': '0',
    'Final Invoice Amount (Offer Price minus Seller Coupon Amount)': '299.0',
    'Taxable Value (Final Invoice Amount -Taxes)': '284.76',
    'IGST Amount': '14.24', 'CGST Amount': '', 'SGST Amount (Or UTGST as applicable)': '',
    'Total TCS Deducted': '1.42',
    ...over,
  }
}

const run = (rows: Record<string, string>[]) =>
  normalizeJiomartSalesRegister(rows, skuMaster, [], [], 'test')

describe('recognising the file', () => {
  it('knows JioMart\'s register', () => {
    expect(detectJiomartSalesRegister(HEADERS)).toBe(true)
  })

  it('does not claim someone else\'s report', () => {
    expect(detectJiomartSalesRegister(['Order ID', 'SKU', 'Quantity', 'Net Price'])).toBe(false)
  })
})

describe('reading the date', () => {
  it('takes the calendar date and drops the time and the offset', () => {
    expect(jiomartDate('2026-08-02 20:48:04 +0530')).toBe('2026-08-02')
  })

  it('refuses what it cannot read rather than guessing', () => {
    expect(jiomartDate('')).toBeNull()
    expect(jiomartDate('02/08/2026')).toBeNull()
  })
})

describe('what a status means', () => {
  it('reads the three endings and treats the rest as still moving', () => {
    expect(jiomartOutcome('delivered')).toBe('delivered')
    expect(jiomartOutcome('complete')).toBe('delivered')
    expect(jiomartOutcome('shipment_returned')).toBe('rto')
    expect(jiomartOutcome('in_transit')).toBe('in_flight')
  })
})

describe('telling a reversal from a sale', () => {
  it('reads the event, and a negative amount whatever the event says', () => {
    expect(jiomartIsReversal('sale', 'sale', 299)).toBe(false)
    expect(jiomartIsReversal('return', 'ReturnToOrigin', -199)).toBe(true)
    // A credit note whose event column was left blank is still a credit note.
    expect(jiomartIsReversal('', '', -199)).toBe(true)
  })
})

describe('a delivered sale', () => {
  const r = run([row({})])

  it('earns its taxable value, ex-GST', () => {
    const rec = r.validRecords[0]
    expect(rec.grossSales).toBe(299)
    expect(rec.netSales).toBeCloseTo(284.76, 2)
    expect(rec.tax).toBeCloseTo(14.24, 2)
    expect(rec.taxInGross).toBe(true)
    expect(rec.quantity).toBe(1)
    expect(rec.status).toBe('completed')
  })

  it('ties: taxable plus GST is what the shopper paid', () => {
    const rec = r.validRecords[0]
    expect(rec.netSales + rec.tax).toBeCloseTo(299, 2)
  })

  it('adds CGST and SGST where the sale is in-state', () => {
    const inState = run([row({ 'IGST Amount': '', 'CGST Amount': '7.12', 'SGST Amount (Or UTGST as applicable)': '7.12' })])
    expect(inState.validRecords[0].tax).toBeCloseTo(14.24, 2)
  })
})

describe('a shipment that bounced', () => {
  const r = run([row({ 'Order Status': 'shipment_returned' })])

  it('keeps the gross JioMart billed and earns nothing', () => {
    const rec = r.validRecords[0]
    expect(rec.grossSales).toBe(299)
    expect(rec.netSales).toBe(0)
    expect(rec.tax).toBe(0)
    expect(rec.rtoUnits).toBe(1)
    expect(rec.status).toBe('rto')
  })

  it('costs nothing, because the goods came back', () => {
    expect(r.validRecords[0].quantity).toBe(0)
  })

  it('says so on the upload', () => {
    expect(r.warnings.join(' ')).toContain('shipment_returned')
  })
})

describe('a credit note against an earlier month', () => {
  // The real one: C24FWC8FCGA00012 reverses S24FWC8FCGA00059, and invoice 59
  // was raised before this file's month began.
  const r = run([row({
    SKU: 'AO/Water/Rosemary/100', 'Order Status': 'complete',
    'Event Type': 'return', 'Event Sub Type': 'ReturnToOrigin',
    'Buyer Invoice ID': 'C24FWC8FCGA00012', 'Original Invoice ID': 'S24FWC8FCGA00059',
    'Offer Price': '-199.0', 'Final Invoice Amount (Offer Price minus Seller Coupon Amount)': '-199.0',
    'Taxable Value (Final Invoice Amount -Taxes)': '-189.52',
    'IGST Amount': '', 'CGST Amount': '-4.74', 'SGST Amount (Or UTGST as applicable)': '-4.74',
  })])

  it('takes revenue off and bills no gross', () => {
    const rec = r.validRecords[0]
    expect(rec.grossSales).toBe(0)
    expect(rec.netSales).toBeCloseTo(-189.52, 2)
    expect(rec.returnUnits).toBe(1)
    expect(rec.status).toBe('returned')
  })

  it('moves no goods, so it charges no cost a second time', () => {
    expect(r.validRecords[0].quantity).toBe(0)
  })

  it('names the invoice it reverses', () => {
    expect(r.reversals).toEqual([
      { invoiceId: 'C24FWC8FCGA00012', against: 'S24FWC8FCGA00059', amount: 189.52 },
    ])
    expect(r.warnings.join(' ')).toContain('S24FWC8FCGA00059')
  })
})

describe('the returns identity', () => {
  it('holds on every shape of row: net === gross - discount - returns', () => {
    const r = run([
      row({}),
      row({ 'Order ID': 'JM002', 'Order Status': 'shipment_returned' }),
      row({ 'Order ID': 'JM003', 'Seller Coupon Amount': '20',
        'Final Invoice Amount (Offer Price minus Seller Coupon Amount)': '279.0',
        'Taxable Value (Final Invoice Amount -Taxes)': '265.71', 'IGST Amount': '13.29' }),
    ])
    for (const rec of r.validRecords) {
      const returnsValue = rec.grossSales - rec.discount - rec.netSales
      expect(rec.netSales).toBeCloseTo(rec.grossSales - rec.discount - returnsValue, 6)
    }
  })

  it('carries a seller coupon as a discount', () => {
    const r = run([row({ 'Seller Coupon Amount': '20',
      'Final Invoice Amount (Offer Price minus Seller Coupon Amount)': '279.0',
      'Taxable Value (Final Invoice Amount -Taxes)': '265.71', 'IGST Amount': '13.29' })])
    expect(r.validRecords[0].discount).toBe(20)
  })
})

describe('a code nothing here knows', () => {
  const r = run([row({ SKU: 'AN/Water/Rosemary/100' })])

  it('counts the sale and names the code rather than guessing what it meant', () => {
    expect(r.validRecords).toHaveLength(1)
    expect(r.unmappedCodes).toEqual(['AN/Water/Rosemary/100'])
    expect(r.warnings.join(' ')).toContain('AN/Water/Rosemary/100')
  })
})

describe('tax withheld', () => {
  it('is reported and not charged to the P&L', () => {
    const r = run([row({})])
    expect(r.tcsDeducted).toBeCloseTo(1.42, 2)
    expect(r.validRecords[0].marketplaceFee).toBe(0)
    expect(r.warnings.join(' ')).toContain('TCS')
  })
})

describe('two items of one order', () => {
  it('are two rows, not one overwriting the other', () => {
    const r = run([
      row({ 'Order Item ID': '1' }),
      row({ 'Order Item ID': '2', SKU: 'AO/Water/Rosemary/100' }),
    ])
    expect(r.validRecords).toHaveLength(2)
    expect(new Set(r.validRecords.map((x) => x.lineId)).size).toBe(2)
  })
})
