import { describe, expect, it } from 'vitest'
import { detectNykaaMarketingInvoice, parseNykaaMarketingInvoice } from './nykaaMarketingInvoice'

/**
 * June 2026's invoice exactly as pdf.js extracts it — including Nykaa's own
 * quirk of reporting IGST as 0.00 on the summary Total line while the item row
 * charges ₹24,397.56.
 */
const JUNE = `Page 1 of 2  Registered Address for Nykaa E-Retail Limited 104, Vasan Udyog Bhavan, Sun Mill Compound,Senapati Bapat Marg, Lower Parel, 400013 Mumbai|CIN - U74999MH2017PLC291558  IRN No :   dc1d98a531a4373981e8be6d339e502443088b3dce4197b09aafcd2edbbc0930  Ack No :   122633721155369  Ack Date :   2026-07-22 19:11:00  TAX INVOICE  Supplier :   Nykaa E-Retail Limited  Address :  104, Vasan Udyog Bhavan, Sun Mill Compound,Senapati Bapat Marg, Lower Parel, 400013 Mumbai  Supplier GSTIN :   27AAFCN5072P1ZV  Billing State :   MAHARASHTRA  Buyer(Bill To) :   HIVEFY LIFESTYLE PRIVATE LIMITED_GJ  Address :  10th Floor, Office No. B-1008 Pragati IT Park Near Air mall Mota Varachha 394101 Surat  GSTIN :   24AAFCH4834H1ZO  State + State Code   GUJARAT - 24  Place of Supply :   GUJARAT - 24  Currency   INR  Document Number :   MH2601109237  Document Date :   22.07.2026  Original Invoice Number :  Original Invoice Date :  Buyer(Ship To) :   HIVEFY LIFESTYLE PRIVATE LIMITED_GJ.  S.No.  Product Description + SKU Code + HSN/SAC Code  BRAND NAME   ACTIVITY MONTH  TAXABLE VALUE   CGST   SGST/UGST   IGST   TOTAL AMOUNT  Rate   Amount   Rate   Amount   Rate   Amount  1  Marketing Invest MARKETINGINVEST 998361  ARAVI ORGANIC   06-2026   1,35,542.00   0.00%   0.00   0.00%   0.00   18.00%   24397.56   1,59,939.56  Total  1,35,542.00   0.00   0.00   24397.56   1,59,939.56  Summary  HSN/SAC Code   Taxable Value   CGST   SGST/UGST   IGST   TOTAL AMOUNT  Rate   Amount   Rate   Amount   Rate   Amount  998361   1,35,542.00   0.00%   0.00   0.00%   0.00   18.00%   24397.56   1,59,939.56  Total   1,35,542.00   0.00   0.00   0.00   1,59,939.56 `

/** A Maharashtra-billed month would split the tax into CGST + SGST instead. */
const INTRASTATE = JUNE
  .replace('06-2026   1,35,542.00   0.00%   0.00   0.00%   0.00   18.00%   24397.56   1,59,939.56',
           '07-2026   1,00,000.00   9.00%   9000.00   9.00%   9000.00   0.00%   0.00   1,18,000.00')

describe('detectNykaaMarketingInvoice', () => {
  it('recognises the MI invoice', () => {
    expect(detectNykaaMarketingInvoice(JUNE)).toBe(true)
  })

  it('does not claim someone else\'s invoice', () => {
    expect(detectNykaaMarketingInvoice('TAX INVOICE Amazon Seller Services commission')).toBe(false)
    expect(detectNykaaMarketingInvoice('')).toBe(false)
  })
})

describe('parseNykaaMarketingInvoice', () => {
  const r = parseNykaaMarketingInvoice(JUNE)

  it('books the invoice to the month it bills, not the month it is dated', () => {
    // Raised 22 July for June's activity. Booking it on its own date would
    // move every month's marketing one month late.
    expect(r.invoice?.activityMonth).toBe('2026-06')
    expect(r.invoice?.invoiceDate).toBe('2026-07-22')
    expect(r.warnings.some((w) => w.includes('bills the 2026-06 activity month'))).toBe(true)
  })

  it('charges the taxable value, never the total', () => {
    expect(r.invoice?.taxableValue).toBeCloseTo(135542, 2)
    expect(r.invoice?.totalAmount).toBeCloseTo(159939.56, 2)
    // The gap is recoverable tax, and is 18% of the charge.
    expect(r.invoice!.totalAmount - r.invoice!.taxableValue).toBeCloseTo(24397.56, 2)
  })

  it('reads the tax off the item row, not the summary', () => {
    // Nykaa's summary Total line says IGST 0.00 while the item row charges
    // 24,397.56. Reading the summary would lose the whole tax and break the
    // reconciliation.
    expect(r.invoice?.igst).toBeCloseTo(24397.56, 2)
    expect(r.checks[0].passed).toBe(true)
  })

  it('reads the invoice identity for the audit trail', () => {
    expect(r.invoice?.invoiceNumber).toBe('MH2601109237')
    expect(r.invoice?.brand).toBe('ARAVI ORGANIC')
    expect(r.invoice?.supplierGstin).toBe('27AAFCN5072P1ZV')
    expect(r.invoice?.buyerGstin).toBe('24AAFCH4834H1ZO')
    expect(r.invoice?.hsnCode).toBe('998361')
  })

  it('handles a CGST + SGST month as well as an IGST one', () => {
    const intra = parseNykaaMarketingInvoice(INTRASTATE)
    expect(intra.invoice?.activityMonth).toBe('2026-07')
    expect(intra.invoice?.taxableValue).toBeCloseTo(100000, 2)
    expect(intra.invoice?.cgst).toBeCloseTo(9000, 2)
    expect(intra.invoice?.sgst).toBeCloseTo(9000, 2)
    expect(intra.invoice?.igst).toBe(0)
    expect(intra.checks[0].passed).toBe(true)
  })

  it('fails the reconciliation rather than importing a bill that does not add up', () => {
    const broken = JUNE.replace('1,59,939.56  Total', '9,99,999.99  Total')
    const bad = parseNykaaMarketingInvoice(broken)
    expect(bad.checks[0].passed).toBe(false)
  })

  it('imports nothing when the charge line cannot be read', () => {
    const noRow = JUNE.replace(/1\s+Marketing Invest[\s\S]*$/, 'Total')
    const r2 = parseNykaaMarketingInvoice(noRow)
    expect(r2.invoice).toBeNull()
    expect(r2.warnings[0]).toContain('could not be read')
  })
})
