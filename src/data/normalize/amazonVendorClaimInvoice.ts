import { getField, headersPresent, type RowIssue } from './types'
import { parseReportDate } from '@/lib/reportDate'
import { toIsoDate } from '@/lib/format'

/**
 * RK World's invoice for a Vendor Central claim, as the CSV beside the PDF.
 *
 * Amazon India's vendor team bills a claim by invoice and deducts it from the
 * next payment, and sends the same invoice two ways: a one-row CSV and a GST
 * invoice PDF. This reads the CSV, which is the one a computer can be sure
 * about — every field is in a named column, and the figure the statement
 * charges is in `REVENUE AMOUNT` rather than in a layout that moves.
 *
 * What the CSV does not carry is the tax: the PDF for the August claim shows
 * ₹24,252 of claim plus ₹4,365.36 of IGST, ₹28,617.36 deducted in total. The
 * tax is input credit rather than a cost, so the P&L wants the ₹24,252 and
 * this file is enough for it — but the bank will show the gross, and the
 * invoice number here is what ties the two together.
 *
 * Which claim it is comes from the description, not from the transaction
 * type: Amazon bills both the cross-dock charge and the margin-support claim
 * under `CCOGS_IN`, and only the text says which one arrived. A claim this
 * build cannot name is reported rather than guessed at — booking a margin
 * claim as cross-dock would charge the right money on the wrong line.
 */

const COLUMNS = {
  invoiceNumber: ['invoice number'],
  invoiceDate: ['invoice date'],
  vendorCode: ['pub code', 'vendor code'],
  agreement: ['agreement#', 'agreement no'],
  transactionType: ['transaction type'],
  amount: ['revenue amount'],
  description: ['description'],
}

export type VendorClaimKind = 'ixd' | 'marginSupport' | 'unknown'

export interface VendorClaim {
  kind: VendorClaimKind
  /** The month the claim bills, from the period in its description. */
  month: string
  periodStart: string
  periodEnd: string
  /** Before tax, which is what the statement charges. */
  amount: number
  invoiceNumber: string
  invoiceDate: string
  /** The description as billed, so a figure on the statement can be found in
   * the document it came from. */
  description: string
}

export interface VendorClaimInvoiceResult {
  claims: VendorClaim[]
  totalRows: number
  invalidRows: RowIssue[]
  warnings: string[]
}

export function detectAmazonVendorClaimInvoice(headers: string[]): boolean {
  return (
    headersPresent(headers, COLUMNS.invoiceNumber) &&
    headersPresent(headers, COLUMNS.amount) &&
    headersPresent(headers, COLUMNS.description) &&
    headersPresent(headers, COLUMNS.transactionType)
  )
}

/** `24,252.00` and `24252.0000000000` alike. */
function money(raw: string | undefined): number {
  if (!raw) return 0
  const n = Number(raw.replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

/**
 * Which claim this is.
 *
 * The cross-dock charge says IXD; the margin support says CCOGS or PPM
 * without it. Nothing is inferred from the transaction type, which is
 * `CCOGS_IN` on both.
 */
export function vendorClaimKind(description: string): VendorClaimKind {
  const text = description.toLowerCase()
  if (text.includes('ixd')) return 'ixd'
  if (text.includes('ccogs') || text.includes('ppm')) return 'marginSupport'
  return 'unknown'
}

/** `Period 2024-08-01 to 2024-08-31`, which is the only place the month is. */
function periodOf(description: string): { start: string; end: string } | null {
  const m = /period\s+(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})/i.exec(description)
  return m ? { start: m[1], end: m[2] } : null
}

/** The claim amount the description repeats, for checking the column against. */
function statedAmount(description: string): number | null {
  const m = /claim:\s*([\d,]+(?:\.\d+)?)/i.exec(description)
  return m ? money(m[1]) : null
}

export function normalizeAmazonVendorClaimInvoice(rows: Record<string, string>[]): VendorClaimInvoiceResult {
  const claims: VendorClaim[] = []
  const invalidRows: RowIssue[] = []
  const warnings: string[] = []

  rows.forEach((row, rowIndex) => {
    const description = (getField(row, COLUMNS.description) ?? '').trim()
    const amount = money(getField(row, COLUMNS.amount))
    const invoiceNumber = (getField(row, COLUMNS.invoiceNumber) ?? '').trim()

    if (description === '' && amount === 0) return
    if (amount === 0) {
      return invalidRows.push({ rowIndex, reason: `Invoice ${invoiceNumber || '(unnumbered)'} bills nothing` })
    }

    const period = periodOf(description)
    if (!period) {
      return invalidRows.push({
        rowIndex,
        reason: `No period in the description, so there is no month to bill: "${description.slice(0, 80)}"`,
      })
    }

    const invoiceDate = parseReportDate(getField(row, COLUMNS.invoiceDate), 'us')

    // The description repeats the claim. Two statements of one figure is a
    // check worth making: they have never disagreed, and if they ever do, the
    // month is wrong by whichever one this build believed.
    const stated = statedAmount(description)
    if (stated !== null && Math.abs(stated - amount) > 0.01) {
      warnings.push(
        `Invoice ${invoiceNumber} bills ₹${amount.toFixed(2)} in its amount column and says ` +
        `₹${stated.toFixed(2)} in its description. The column is what has been read; the two should agree.`,
      )
    }

    const month = period.start.slice(0, 7)
    if (period.end.slice(0, 7) !== month) {
      warnings.push(
        `Invoice ${invoiceNumber} bills ${period.start} to ${period.end}, which crosses a month end. It is ` +
        `charged to ${month}, the month it starts in.`,
      )
    }

    claims.push({
      kind: vendorClaimKind(description),
      month,
      periodStart: period.start,
      periodEnd: period.end,
      amount,
      invoiceNumber,
      invoiceDate: invoiceDate ? toIsoDate(invoiceDate) : '',
      description,
    })
  })

  for (const claim of claims) {
    const label = claim.kind === 'ixd'
      ? 'inward cross-dock (IXD)'
      : claim.kind === 'marginSupport' ? 'margin support (contra-COGS)' : null
    if (label) {
      warnings.push(
        `Read as Amazon India Vendor Central's ${label} claim for ${claim.month}: ₹${claim.amount.toFixed(2)} on ` +
        `invoice ${claim.invoiceNumber}, billing ${claim.periodStart} to ${claim.periodEnd}. The claim is before ` +
        'tax, which is what the statement charges — GST on it is input credit and is not a cost.',
      )
    } else {
      warnings.push(
        `Invoice ${claim.invoiceNumber} bills ₹${claim.amount.toFixed(2)} for ${claim.month} and its description ` +
        `names no claim this build recognises: "${claim.description.slice(0, 120)}". It is not charged to any line ` +
        'until somebody says which one it belongs on — send the invoice over.',
      )
    }
  }

  return { claims, totalRows: rows.length, invalidRows, warnings }
}
