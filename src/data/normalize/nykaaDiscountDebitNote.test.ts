import { describe, expect, it } from 'vitest'
import { detectNykaaDiscountDebitNote, parseNykaaDiscountDebitNote } from './nykaaDiscountDebitNote'

/**
 * Nykaa's note 1100005020, exactly as pdfjs extracts page 1 of the real PDF —
 * only rewrapped, which changes nothing, because the parser flattens
 * whitespace before it reads anything.
 *
 * Two things about it are easy to get wrong and are why the real text is
 * pinned here rather than a tidied-up version. The item row's MRP, UNIT PRICE,
 * QTY and RTV QTY columns are blank and simply do not appear, so the charge
 * can only be found by counting back from the total. And the note is an XFA
 * form, so `Remarks :` prints *after* the remark it labels.
 */
const JUNE = `
Page 1 of 2 Registered Address for Nykaa E-Retail Limited VUB, Sun Mill Compound,Tulsi Pipe Road,
Lower Parel, 400013, Mumbai, 27|CIN - U74999MH2017PLC291558 Supplier : Nykaa E-Retail Limited
Address : 104, Vasan Udyog Bhavan, Sun Mill Compound,Senapati Bapat Marg, 400013 Mumbai Supplier
GSTIN : 27AAFCN5072P1ZV Billing State : MAHARASHTRA Buyer(Bill To) : HIVEFY LIFESTYLE PRIVATE
LIMITED_GJ . Address : 10th Floor, Office No. B-1008 Pragati IT Park Near Air mall Mota Varachha
394101 Surat GUJARAT India GSTIN : 24AAFCH4834H1ZO State + State Code : Place of Supply : N/A
Description : N/A Currency : INR Document Number : 1100005020 Document Date : 20.03.2026 Original
Invoice Number : Original Invoice Date : Buyer (Ship To) : Address : GSTIN : State + State code :
Reference: Financial Debit Note IRN No : N/A Ack No : N/A Ack Date : N/A S.No. Product Description
+ SKU Code + HSN Code MRP UNIT PRICE BRAND NAME ACTIVITY MONTH QTY RTV QTY TOTAL DISC (Excl Tax)
TAXABLE VALUE CGST SGST/ UGST IGST TOTAL AMOUNT 1 Discount Reimbursement - 20506 - ARAVI ORGANIC
06-2025 0.00 1,192,243.00 N/A N/A N/A 1,192,243.00 Summary QTY HSN Code Taxable Value CGST
SGST/UGST IGST TOTAL AMOUNT N/A N/A 1,192,243.00 N/A N/A N/A 1,192,243.00 Total 1,192,243.00 N/A
N/A N/A 1,192,243.00 Eleven Lakh Ninety Two Thousand Two Hundred Forty Three Rupees Amount ( in
Words ) : Discount for the month Jun'25 Brand-aravi organic Remarks : Bank Name: Kotak Mahindra
Bank Ltd. Beneficiary Name: Nykaa E Retail Limited (Formerly known as Nykaa ERetail Private
Limited) Account number: 1011979828 IFSC Code: KKBK0000638 Declaration -
`

describe('detectNykaaDiscountDebitNote', () => {
  it('recognises the note', () => {
    expect(detectNykaaDiscountDebitNote(JUNE)).toBe(true)
  })

  it('does not claim the Marketing Invest invoice, which is a different document', () => {
    const mi = 'Nykaa E-Retail Limited Tax Invoice MARKETINGINVEST ACTIVITY MONTH 06-2026 1,35,542.00'
    expect(detectNykaaDiscountDebitNote(mi)).toBe(false)
  })
})

describe('parseNykaaDiscountDebitNote', () => {
  const { note, warnings, checks } = parseNykaaDiscountDebitNote(JUNE)

  it('reads the charge by counting back from the total, not forward from the start', () => {
    // MRP, UNIT PRICE, QTY and RTV QTY are all absent from the text. A parse
    // that counted forward would land on the 0.00 and report the note as nil.
    expect(note?.amount).toBe(1192243)
    expect(note?.totalAmount).toBe(1192243)
  })

  it('reads no GST, because a discount note carries none', () => {
    expect(note?.cgst).toBe(0)
    expect(note?.sgst).toBe(0)
    expect(note?.igst).toBe(0)
    // So unlike the MI invoice, the charge and the total are the same figure
    // and there is nothing to claim back.
    expect(note?.amount).toBe(note?.totalAmount)
  })

  it('books it to the activity month, not the document date', () => {
    expect(note?.activityMonth).toBe('2025-06')
    expect(note?.documentDate).toBe('2026-03-20')
  })

  it('says out loud how late the note is', () => {
    expect(warnings.some((w) => w.includes('9 months earlier'))).toBe(true)
  })

  it('carries the identifying detail so the charge can be traced back', () => {
    expect(note?.documentNumber).toBe('1100005020')
    expect(note?.supplierGstin).toBe('27AAFCN5072P1ZV')
    expect(note?.buyerGstin).toBe('24AAFCH4834H1ZO')
    expect(note?.brand).toBe('ARAVI ORGANIC')
    expect(note?.remarks).toContain("Jun'25")
  })

  it('reconciles the charge against the total', () => {
    expect(checks.every((c) => c.passed)).toBe(true)
  })

  it('reads a taxed note without swallowing the tax into the charge', () => {
    const taxed = JUNE.replace(
      '06-2025 0.00 1,192,243.00 N/A N/A N/A 1,192,243.00',
      '06-2025 0.00 1,000,000.00 N/A N/A 180,000.00 1,180,000.00',
    )
    const r = parseNykaaDiscountDebitNote(taxed)
    expect(r.note?.amount).toBe(1000000)
    expect(r.note?.igst).toBe(180000)
    expect(r.checks.every((c) => c.passed)).toBe(true)
    expect(r.warnings.some((w) => w.includes('charges ₹180000.00 of GST'))).toBe(true)
  })

  it('imports nothing rather than guessing when the charge line cannot be read', () => {
    const r = parseNykaaDiscountDebitNote('Financial Debit Note Nykaa Discount Reimbursement, layout unknown')
    expect(r.note).toBeNull()
    expect(r.warnings[0]).toContain('could not be read')
  })
})
