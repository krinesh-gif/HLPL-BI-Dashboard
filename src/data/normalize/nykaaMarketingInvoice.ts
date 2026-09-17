/**
 * Nykaa's monthly Marketing Invest (MI) invoice, as emailed in PDF.
 *
 * It is a one-line tax invoice, and both of the things that matter about it
 * are easy to get wrong by hand:
 *
 *  1. THE COST IS THE TAXABLE VALUE, NOT THE TOTAL. June's invoice bills
 *     ₹1,35,542.00 of marketing plus ₹24,397.56 of IGST, ₹1,59,939.56 in all.
 *     The GST is input tax credit — recoverable, not a cost — so charging the
 *     total to the P&L would overstate the month's advertising by 18%.
 *
 *  2. THE MONTH IS THE ACTIVITY MONTH, NOT THE INVOICE DATE. June's invoice is
 *     dated 22 July. Booking it on its own date would move every month's
 *     marketing one month late, which on a rising spend never looks wrong
 *     enough to notice — it just quietly flatters one month and punishes the
 *     next. The `ACTIVITY MONTH` column is what the invoice is for.
 *
 * The parser reads the item row rather than the summary block. Nykaa's summary
 * "Total" line reports IGST as 0.00 even when the item row charges it — on
 * June's invoice the two disagree by the whole ₹24,397.56 — so the summary is
 * not a safe place to read tax from.
 */

export interface NykaaMarketingInvoice {
  /** yyyy-mm, from the ACTIVITY MONTH column: the month the spend belongs to. */
  activityMonth: string
  /** What goes in the P&L. Ex-GST. */
  taxableValue: number
  cgst: number
  sgst: number
  igst: number
  /** Taxable value plus every tax — what is actually paid. */
  totalAmount: number
  invoiceNumber: string
  /** ISO, from the invoice's own DD.MM.YYYY document date. */
  invoiceDate: string
  brand?: string
  supplierGstin?: string
  buyerGstin?: string
  hsnCode?: string
}

export interface NykaaMarketingInvoiceResult {
  invoice: NykaaMarketingInvoice | null
  warnings: string[]
  checks: { name: string; passed: boolean; detail: string }[]
}

/** `1,35,542.00` — Indian digit grouping, so no assumption about where the
 * separators fall; they are simply removed. */
function amount(raw: string): number {
  const value = Number(raw.replace(/,/g, ''))
  return Number.isFinite(value) ? value : 0
}

const AMOUNT = String.raw`(\d[\d,]*\.\d{2})`
const RATE = String.raw`(\d+(?:\.\d+)?)\s*%`

/**
 * The one item row, read as: taxable value, then a rate/amount pair for each
 * of CGST, SGST and IGST, then the total. Matching the shape rather than
 * hunting for labels is what survives Nykaa moving a column.
 */
const ITEM_ROW = new RegExp(
  String.raw`(0[1-9]|1[0-2])-(20\d{2})\s+${AMOUNT}\s+${RATE}\s+${AMOUNT}\s+${RATE}\s+${AMOUNT}\s+${RATE}\s+${AMOUNT}\s+${AMOUNT}`,
)

export function detectNykaaMarketingInvoice(text: string): boolean {
  const flat = text.replace(/\s+/g, ' ')
  return (
    /MARKETINGINVEST|Marketing Invest/i.test(flat) &&
    /Nykaa/i.test(flat) &&
    /ACTIVITY\s*MONTH/i.test(flat)
  )
}

export function parseNykaaMarketingInvoice(text: string): NykaaMarketingInvoiceResult {
  const warnings: string[] = []
  const checks: NykaaMarketingInvoiceResult['checks'] = []
  const flat = text.replace(/\s+/g, ' ')

  const row = ITEM_ROW.exec(flat)
  if (!row) {
    return {
      invoice: null,
      warnings: [
        'This looks like a Nykaa MI invoice but its charge line could not be read. Nothing was imported — ' +
        'send the PDF over and the reader will be taught this layout.',
      ],
      checks,
    }
  }

  const [, month, year, taxableRaw, , cgstRaw, , sgstRaw, , igstRaw, totalRaw] = row
  const taxableValue = amount(taxableRaw)
  const cgst = amount(cgstRaw)
  const sgst = amount(sgstRaw)
  const igst = amount(igstRaw)
  const totalAmount = amount(totalRaw)

  const docNumber = /Document Number\s*:?\s*([A-Z0-9][A-Z0-9/-]*)/i.exec(flat)
  const docDate = /Document Date\s*:?\s*(\d{2})\.(\d{2})\.(\d{4})/i.exec(flat)
  const brand = /BRAND NAME\s+ACTIVITY MONTH[\s\S]*?\b([A-Z][A-Z ]*[A-Z])\s+(?:0[1-9]|1[0-2])-20\d{2}/.exec(flat)
  const supplierGstin = /Supplier GSTIN\s*:?\s*([0-9A-Z]{15})/i.exec(flat)
  const buyerGstin = /GSTIN\s*:?\s*([0-9A-Z]{15})/i.exec(flat.split(/Buyer\(Bill To\)/i)[1] ?? '')
  const hsn = /\b(99\d{4})\b/.exec(flat)

  const invoice: NykaaMarketingInvoice = {
    activityMonth: `${year}-${month}`,
    taxableValue,
    cgst,
    sgst,
    igst,
    totalAmount,
    invoiceNumber: docNumber?.[1] ?? '',
    invoiceDate: docDate ? `${docDate[3]}-${docDate[2]}-${docDate[1]}` : '',
    brand: brand?.[1]?.trim(),
    supplierGstin: supplierGstin?.[1],
    buyerGstin: buyerGstin?.[1],
    hsnCode: hsn?.[1],
  }

  const summed = taxableValue + cgst + sgst + igst
  checks.push({
    name: 'Taxable + CGST + SGST + IGST = Total',
    passed: Math.abs(summed - totalAmount) <= 1,
    detail: `${summed.toFixed(2)} vs ${totalAmount.toFixed(2)} (gap ${(summed - totalAmount).toFixed(2)})`,
  })

  if (taxableValue <= 0) {
    warnings.push('The invoice reads a taxable value of zero, which is not a bill. Nothing will be charged to the P&L.')
  }
  // The invoice is raised after the month it covers, so this is the normal
  // case and is said out loud rather than left for someone to discover.
  if (invoice.invoiceDate && invoice.invoiceDate.slice(0, 7) !== invoice.activityMonth) {
    warnings.push(
      `Invoice ${invoice.invoiceNumber || '(no number)'} is dated ${invoice.invoiceDate} but bills the ${invoice.activityMonth} ` +
      'activity month. It has been booked to the activity month, which is the month the spend belongs to.',
    )
  }
  warnings.push(
    `₹${taxableValue.toLocaleString('en-IN', { minimumFractionDigits: 2 })} charged to the P&L as Nykaa advertising. ` +
    `The ₹${(cgst + sgst + igst).toLocaleString('en-IN', { minimumFractionDigits: 2 })} of GST on top ` +
    `(₹${totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })} paid in all) is input tax credit, not a cost.`,
  )

  return { invoice, warnings, checks }
}
