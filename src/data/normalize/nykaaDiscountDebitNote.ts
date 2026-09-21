/**
 * Nykaa's Financial Debit Note — the document that charges the customer
 * discount back to us.
 *
 * Nykaa raises its purchase order on MRP and takes its margin off MRP. When it
 * then sells below MRP, it recovers that shortfall with this note. Three
 * things about it decide how it is read:
 *
 *  1. IT CARRIES NO GST. The June note charges ₹11,92,243 with CGST, SGST and
 *     IGST all printed as `N/A`. So unlike the Marketing Invest invoice, where
 *     the tax on top is recoverable and only the taxable value is a cost, here
 *     the whole amount is the cost. There is nothing to claim back.
 *
 *  2. IT IS NOT WHAT THE P&L DEDUCTS. The sample note is dated 20.03.2026 and
 *     bills the 06-2025 activity month — nine months after the fact. A month
 *     that waited for its note to close would never close, so the discount is
 *     deducted from the sales file, which states it exactly and arrives on
 *     time. The note is read to check that figure, and the difference between
 *     the two is the finding.
 *
 *  3. THE MONTH IS THE ACTIVITY MONTH. Same rule as the MI invoice: the
 *     `ACTIVITY MONTH` column, not the document date.
 *
 * The item row is read by counting back from the end rather than forward from
 * the start. Its leading columns (MRP, UNIT PRICE, QTY, RTV QTY) are blank on
 * a discount note and simply do not appear in the extracted text, so a
 * left-to-right parse lands on the wrong column. The last four values are
 * always CGST, SGST, IGST and TOTAL AMOUNT, which makes the value before them
 * the taxable one no matter how many of the leading columns Nykaa fills in.
 */

export interface NykaaDiscountDebitNote {
  /** yyyy-mm, from the ACTIVITY MONTH column: the month the discount was given. */
  activityMonth: string
  /** The charge. No GST is levied on it, so this is the whole cost. */
  amount: number
  cgst: number
  sgst: number
  igst: number
  totalAmount: number
  documentNumber: string
  /** ISO, from the note's own DD.MM.YYYY document date. */
  documentDate: string
  brand?: string
  supplierGstin?: string
  buyerGstin?: string
  remarks?: string
}

export interface NykaaDiscountDebitNoteResult {
  note: NykaaDiscountDebitNote | null
  warnings: string[]
  checks: { name: string; passed: boolean; detail: string }[]
}

/** `1,192,243.00` — the separators are simply removed rather than interpreted,
 * because Nykaa groups some amounts the Indian way and some the Western way. */
function amount(raw: string): number {
  const value = Number(raw.replace(/,/g, ''))
  return Number.isFinite(value) ? value : 0
}

/** A money column, or the `N/A` Nykaa prints where a tax does not apply. */
const CELL = String.raw`(?:N/A|\d[\d,]*\.\d{2})`

/** Everything from the activity month to the end of the item row. */
const ITEM_ROW = new RegExp(String.raw`(0[1-9]|1[0-2])-(20\d{2})\s+((?:${CELL}\s+){3,}${CELL})`)

export function detectNykaaDiscountDebitNote(text: string): boolean {
  const flat = text.replace(/\s+/g, ' ')
  return (
    /Financial Debit Note/i.test(flat) &&
    /Nykaa/i.test(flat) &&
    /Discount\s*Reimbursement|Discount for the month/i.test(flat)
  )
}

export function parseNykaaDiscountDebitNote(text: string): NykaaDiscountDebitNoteResult {
  const warnings: string[] = []
  const checks: NykaaDiscountDebitNoteResult['checks'] = []
  const flat = text.replace(/\s+/g, ' ')

  const row = ITEM_ROW.exec(flat)
  if (!row) {
    return {
      note: null,
      warnings: [
        'This looks like a Nykaa discount debit note but its charge line could not be read. Nothing was imported — ' +
        'send the PDF over and the reader will be taught this layout.',
      ],
      checks,
    }
  }

  const [, month, year, tail] = row
  const cells = tail.trim().split(/\s+/)
  // CGST, SGST, IGST, TOTAL are the last four columns of the row on every
  // Nykaa document, whatever is or is not filled in ahead of them.
  const value = (fromEnd: number): number => {
    const cell = cells[cells.length - fromEnd]
    return cell === undefined || cell === 'N/A' ? 0 : amount(cell)
  }
  const totalAmount = value(1)
  const igst = value(2)
  const sgst = value(3)
  const cgst = value(4)
  const taxable = value(5)

  const docNumber = /Document Number\s*:?\s*([A-Z0-9][A-Z0-9/-]*)/i.exec(flat)
  const docDate = /Document Date\s*:?\s*(\d{2})\.(\d{2})\.(\d{4})/i.exec(flat)
  const brand = /BRAND\s*NAME[\s\S]*?\b([A-Z][A-Z ]*[A-Z])\s+(?:0[1-9]|1[0-2])-20\d{2}/.exec(flat)
  const supplierGstin = /Supplier GSTIN\s*:?\s*([0-9A-Z]{15})/i.exec(flat)
  const buyerGstin = /GSTIN\s*:?\s*([0-9A-Z]{15})/i.exec(flat.split(/Supplier GSTIN\s*:?\s*[0-9A-Z]{15}/i)[1] ?? '')
  // The note is an XFA form, and its extracted text puts the `Remarks :` label
  // *after* the remark it labels. So the remark is found by what it says
  // rather than by where the label is.
  const remarks = /(Discount for the month\s.*?)\s*Remarks\s*:/i.exec(flat)

  const note: NykaaDiscountDebitNote = {
    activityMonth: `${year}-${month}`,
    amount: taxable,
    cgst,
    sgst,
    igst,
    totalAmount,
    documentNumber: docNumber?.[1] ?? '',
    documentDate: docDate ? `${docDate[3]}-${docDate[2]}-${docDate[1]}` : '',
    brand: brand?.[1]?.trim(),
    supplierGstin: supplierGstin?.[1],
    buyerGstin: buyerGstin?.[1],
    remarks: remarks?.[1]?.trim(),
  }

  const summed = taxable + cgst + sgst + igst
  checks.push({
    name: 'Charge + CGST + SGST + IGST = Total',
    passed: Math.abs(summed - totalAmount) <= 1,
    detail: `${summed.toFixed(2)} vs ${totalAmount.toFixed(2)} (gap ${(summed - totalAmount).toFixed(2)})`,
  })

  if (note.amount <= 0) {
    warnings.push('The note reads a charge of zero, which is not a debit note. Nothing will be recorded against the month.')
  }
  // A note with tax on it is a different document, and treating its total as a
  // cost would overstate the month by the tax. Worth stopping on rather than
  // absorbing quietly.
  if (cgst + sgst + igst > 0) {
    warnings.push(
      `This note charges ₹${(cgst + sgst + igst).toFixed(2)} of GST, which a discount debit note normally does not. ` +
      'Only the charge before tax has been recorded — check with Nykaa whether the tax is claimable.',
    )
  }
  // The gap between the discount being given and the note arriving is the
  // thing most likely to put a cost in the wrong year, so it is said out loud.
  if (note.documentDate) {
    const lag = monthsBetween(note.activityMonth, note.documentDate.slice(0, 7))
    if (lag >= 3) {
      warnings.push(
        `Note ${note.documentNumber || '(no number)'} is dated ${note.documentDate} but bills the ` +
        `${note.activityMonth} activity month — ${lag} months earlier. It has been recorded against ${note.activityMonth}, ` +
        'the month the discount was actually given. Check the activity month with Nykaa if that looks wrong.',
      )
    }
  }

  return { note, warnings, checks }
}

/** Whole months from one yyyy-mm to another. Both are calendar months, so this
 * counts them directly rather than going anywhere near a Date. */
function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  if (!fy || !fm || !ty || !tm) return 0
  return (ty - fy) * 12 + (tm - fm)
}
