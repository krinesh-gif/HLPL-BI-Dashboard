import { describe, expect, it } from 'vitest'
import {
  detectAmazonVendorClaimInvoice, normalizeAmazonVendorClaimInvoice, vendorClaimKind,
} from './amazonVendorClaimInvoice'

/**
 * August's cross-dock invoice, exactly as the CSV beside the PDF reads it.
 * ₹24,252 of claim; the PDF adds ₹4,365.36 of IGST for ₹28,617.36 deducted,
 * which is tax and not a cost.
 */
const HEADERS = [
  'INVOICE NUMBER', 'INVOICE DATE', 'PAYMENT TERM', 'DUE DATE', 'BUYER', 'PUB CODE', 'AGREEMENT#',
  'PAYMENT METHOD', 'TRANSACTION TYPE', 'PRODUCT LINE', 'PO NUMBER', 'LINE NUMBER', 'QUANTITY ORDERED',
  'QUANTITY CREDITED', 'QUANTITY INVOICED', 'UNIT STANDARD PRICE', 'UNIT SELLING PRICE', 'REVENUE AMOUNT',
  'SALES ORDER', 'SALES ORDER LINE', 'DESCRIPTION',
]

const row = (over: Record<string, string> = {}) => ({
  'INVOICE NUMBER': '20000036977', 'INVOICE DATE': '21-SEP-24', 'PAYMENT TERM': 'IMMEDIATE',
  'DUE DATE': '21-SEP-24', BUYER: '', 'PUB CODE': 'WBA7J', 'AGREEMENT#': '80008830',
  'PAYMENT METHOD': 'Deduct From Payment', 'TRANSACTION TYPE': 'CCOGS_IN', 'PRODUCT LINE': 'BEAUTY',
  'LINE NUMBER': '1', 'QUANTITY INVOICED': '1', 'UNIT SELLING PRICE': '24252', 'REVENUE AMOUNT': '24252',
  DESCRIPTION: "MDF# 80008830: Aravi organic August'24 IXD PPM Claim: 24252.0000000000 Straight Payment: "
    + 'Period 2024-08-01 to 2024-08-31',
  ...over,
})

describe('detectAmazonVendorClaimInvoice', () => {
  it('recognizes the invoice export', () => {
    expect(detectAmazonVendorClaimInvoice(HEADERS)).toBe(true)
  })
  it('does not claim the NPPM or the cross-dock workbook', () => {
    expect(detectAmazonVendorClaimInvoice(['ASIN', 'Ship Day', 'Net Shipped GMS'])).toBe(false)
    expect(detectAmazonVendorClaimInvoice(['Inbound date', 'asin', 'quantity_unpacked'])).toBe(false)
  })
})

// Amazon bills both claims under CCOGS_IN, so only the text tells them apart.
// Booking a margin claim as cross-dock would charge the right money on the
// wrong line.
describe('vendorClaimKind', () => {
  it('reads the cross-dock claim', () => {
    expect(vendorClaimKind("Aravi organic August'24 IXD PPM Claim: 24252")).toBe('ixd')
  })
  it('reads the margin-support claim', () => {
    expect(vendorClaimKind('Aravi organic Sept CCOGS Claim: 50000')).toBe('marginSupport')
    expect(vendorClaimKind('PPM shortfall claim: 6526.14')).toBe('marginSupport')
  })
  it('names nothing it cannot recognise', () => {
    expect(vendorClaimKind('MDF# 80008830: some other arrangement')).toBe('unknown')
  })
})

describe('normalizeAmazonVendorClaimInvoice', () => {
  it('reads the claim, its month and the invoice it is billed on', () => {
    const r = normalizeAmazonVendorClaimInvoice([row()])
    expect(r.invalidRows).toEqual([])
    expect(r.claims).toHaveLength(1)
    const claim = r.claims[0]
    expect(claim.kind).toBe('ixd')
    expect(claim.amount).toBe(24252)
    expect(claim.month).toBe('2024-08')
    expect(claim.periodStart).toBe('2024-08-01')
    expect(claim.periodEnd).toBe('2024-08-31')
    expect(claim.invoiceNumber).toBe('20000036977')
    expect(claim.invoiceDate).toBe('2024-09-21')
  })

  it('reads an amount however it is punctuated', () => {
    expect(normalizeAmazonVendorClaimInvoice([row({ 'REVENUE AMOUNT': '24,252.00' })]).claims[0].amount).toBe(24252)
  })

  // The description repeats the figure. Two statements of one number is a
  // check worth making rather than an inconsistency to average.
  it('checks the amount against the one its own description states', () => {
    const r = normalizeAmazonVendorClaimInvoice([row({ 'REVENUE AMOUNT': '25000' })])
    expect(r.claims[0].amount).toBe(25000)
    expect(r.warnings.some((w) => w.includes('says ₹24252.00 in its description'))).toBe(true)
  })

  it('refuses a row with no period, because it bills no month', () => {
    const r = normalizeAmazonVendorClaimInvoice([row({ DESCRIPTION: 'MDF# 80008830: IXD claim, no dates' })])
    expect(r.claims).toEqual([])
    expect(r.invalidRows[0].reason).toContain('no month to bill')
  })

  it('says when a period crosses a month end rather than splitting it', () => {
    const r = normalizeAmazonVendorClaimInvoice([
      row({ DESCRIPTION: 'IXD Claim: 100 Period 2026-08-15 to 2026-09-14' }),
    ])
    expect(r.claims[0].month).toBe('2026-08')
    expect(r.warnings.some((w) => w.includes('crosses a month end'))).toBe(true)
  })

  it('charges nothing for a claim it cannot name', () => {
    const r = normalizeAmazonVendorClaimInvoice([
      row({ DESCRIPTION: 'MDF# 1: some new arrangement Period 2026-08-01 to 2026-08-31' }),
    ])
    expect(r.claims[0].kind).toBe('unknown')
    expect(r.warnings.some((w) => w.includes('names no claim this build recognises'))).toBe(true)
  })

  it('reads several claims from one export', () => {
    const r = normalizeAmazonVendorClaimInvoice([
      row(),
      row({
        'INVOICE NUMBER': '20000036978',
        DESCRIPTION: 'MDF# 80008830: Aravi organic CCOGS Claim: 68079.97 Period 2026-08-01 to 2026-08-31',
        'REVENUE AMOUNT': '68079.97',
      }),
    ])
    expect(r.claims.map((c) => c.kind)).toEqual(['ixd', 'marginSupport'])
    expect(r.claims[1].amount).toBeCloseTo(68079.97, 2)
  })
})
