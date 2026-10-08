import type { BlinkitPnlFacts, CanonicalSalesRecord } from '@/data/models'
import { workbookSheetsFromBytes, type RawSheet } from '@/lib/csvParse'
import { unzip } from '@/lib/unzip'
import type { NormalizeResult, RowIssue } from './types'
import type { ReconciliationCheck } from './meeshoOrderPayments'

/**
 * Blinkit's monthly payout archive.
 *
 * Blinkit does not publish a P&L. It publishes a zip of workbooks, one of
 * which — the Payout Breakup — is a statement that every other workbook
 * explains:
 *
 *   A       Customer Payable          what shoppers paid
 *   B1–B5   Order level charges       commission, shipping, returns, TCS, TDS
 *   C1–C4   Inventory & fulfilment    upfront storage, recall, storage, courier
 *   D1–D5   Other additions           ads refunds, lost stock, reimbursements
 *   E       Other deductions
 *           Net Payout in this Cycle
 *
 * The statement is parsed from that sheet rather than rebuilt by summing the
 * detail, so what this app shows is what Blinkit says it paid. The detail
 * sheets are then summed independently and checked against it, which is how a
 * month that does not add up announces itself instead of being averaged away.
 *
 * On both of the owner's archives the two agree. August: the detail sums to
 * the same 6,430 of customer payable, 128.60 of commission, 1,500 of shipping
 * and 4,071 of storage, and the arithmetic lands on the 814.12 it says was
 * paid. April: 17,549 of customer payable over 81 lines, 350.98 of
 * commission, 4,050 of shipping, 11,778.76 of storage, and a cycle that came
 * to -6,315.76 — a month that cost more than it earned.
 *
 * The two archives are laid out differently in almost every way that a reader
 * of them can be: see `PAYOUT_SHEET` below.
 */

/**
 * Blinkit has published two shapes of this archive, and both are in use.
 *
 * August 2026 arrived as six lettered workbooks — "A&B. Order_level_charges",
 * "C. Inventory_charges" and so on — with every order on one "Forward &
 * Return Orders" sheet and charges written as negatives. April 2026 arrived
 * as thirteen workbooks named by topic, with forward and return orders on
 * separate sheets and charges written as positive magnitudes. The statement
 * rows are not even spelled the same: "Customer Return Charge" in one,
 * "Return Charge" in the other.
 *
 * So nothing here looks for a workbook by its file name. Every workbook in
 * the archive carries a copy of the statement, and the detail sheets have
 * names of their own, so a sheet is found by searching the whole archive for
 * it. That is what makes the reader indifferent to how Blinkit chose to split
 * the files this month, which is the part that keeps changing.
 */
const PAYOUT_SHEET = 'Payout Breakup'

/** The order detail. One sheet in the lettered archive, two in the other. */
const ORDER_SHEETS = ['Forward & Return Orders', 'Forward Orders', 'Cancelled or Returned Orders']

/** Sheets whose rows are every row a return, whatever the Order Type says —
 * the lettered archive marks returns per row, the other gives them a sheet. */
const RETURN_ONLY_SHEETS = new Set(['Cancelled or Returned Orders'])

/**
 * Which field each row of the Payout Breakup fills, and which way it points.
 *
 * `cost: true` means a row the file writes as a negative. It is stored as a
 * positive magnitude — as every other channel's charges are — by negating the
 * file's Net Amount, rather than by taking its absolute value. The difference
 * matters in the month a reversal exceeds its charge: negation turns that into
 * the credit it is, where absolute value would report it as a cost.
 */
const PAYOUT_LINES: { labels: string[]; field: keyof BlinkitPnlFacts; cost: boolean }[] = [
  { labels: ['customer payable'], field: 'customerPayable', cost: false },

  { labels: ['commission charge'], field: 'commission', cost: true },
  { labels: ['gst on commission'], field: 'commissionGst', cost: true },
  { labels: ['shipping charge'], field: 'shipping', cost: true },
  { labels: ['gst on shipping'], field: 'shippingGst', cost: true },
  // Two archives, two spellings of the same charge.
  { labels: ['customer return charge', 'return charge'], field: 'customerReturnCharge', cost: true },
  { labels: ['gst on customer return charges', 'gst on return charges'], field: 'customerReturnChargeGst', cost: true },
  { labels: ['tcs charge'], field: 'tcs', cost: true },
  { labels: ['tds charge 194o & q'], field: 'tds', cost: true },

  { labels: ['upfront storage charge'], field: 'upfrontStorage', cost: true },
  { labels: ['gst on upfront storage charge'], field: 'upfrontStorageGst', cost: true },
  { labels: ['recall charge'], field: 'recallCharge', cost: true },
  { labels: ['gst on recall charge'], field: 'recallChargeGst', cost: true },
  { labels: ['storage charge'], field: 'storageCharge', cost: true },
  { labels: ['gst on storage charge'], field: 'storageChargeGst', cost: true },
  { labels: ['courier charge'], field: 'courierCharge', cost: true },
  { labels: ['gst on courier charge'], field: 'courierChargeGst', cost: true },

  { labels: ['ads refund'], field: 'adsRefund', cost: false },
  { labels: ['gst on ads refund'], field: 'adsRefundGst', cost: false },
  { labels: ['lost/damaged inventory'], field: 'lostDamagedCompensation', cost: false },
  { labels: ['tcs reimbursement'], field: 'tcsReimbursement', cost: false },
  { labels: ['tds reimbursement'], field: 'tdsReimbursement', cost: false },
  { labels: ['other credit - debit note'], field: 'otherCreditDebitNote', cost: false },

  { labels: ['other deductions'], field: 'otherDeductions', cost: true },
  // What this cycle's trading came to, before anything carried over from an
  // earlier one. The lettered archive repeats it as "Net Payout in this
  // Cycle"; the other leaves that row blank in a month the account went
  // backwards and states only this, so this is the row to read. On the
  // owner's August archive the two are the same ₹814.12.
  { labels: ['amount calculated from present cycle', 'net payout in this cycle'], field: 'netPayoutPerFile', cost: false },
]

/**
 * Rows Blinkit prints that this dashboard has nowhere to put yet.
 *
 * Every one of them is nil on both archives, so nothing is lost by not having
 * a field for it. What is not acceptable is guessing: "Ads Budget Spend" is
 * plainly a charge, but which way "Credit Note" and "Debit Note" point is a
 * question for Finance, and a sign guessed on a nil row is a wrong figure
 * waiting for the month the row is used. So they are recognised — which keeps
 * them out of the unknown-row warning — and the first time one of them
 * carries an amount it is reported by name instead of being dropped.
 */
const NOT_PLACED_YET = new Set([
  'ads budget spend for t-15 days', 'gst on ads charge',
  'pre grn losses', 'pre grn damage', 'post rtv losses', 'post rtv damage',
  'rtv incorrect items delivered', 'rtv items expired', 'dn incorrect items delivered',
  'credit note', 'gst on cn', 'debit note', 'gst on dn',
  'pending charges paid', 'seller due collected',
])

/** Rows that are headings or running totals, not figures of their own. They
 * are named so an unrecognised row can be reported without reporting these. */
const IGNORED_LABELS = new Set([
  'order level charges', 'order level deductions',
  'inventory & fulfillment charges', 'inventory & fulfilment charges',
  'other additions', 'one-timer adjustments', 'payout breakup',
  'unsettled from previous cycle', 'amount calculated till date',
])

/** The cycles making up "Unsettled from previous cycle", listed under it by
 * date range. Workings of a row already ignored, not figures of their own. */
const CYCLE_ROW = /^\d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}$/

export interface BlinkitPayoutResult extends NormalizeResult {
  facts: BlinkitPnlFacts
  checks: ReconciliationCheck[]
  /** Rows of the Payout Breakup this app does not know. A new Blinkit charge
   * is a question for Finance, never a figure quietly left out. */
  unknownPayoutRows: string[]
}

const clean = (v: unknown): string => String(v ?? '').trim()

/** The file writes a nil figure as "-", and a real one with commas. */
function num(v: unknown): number {
  const s = clean(v).replace(/,/g, '').replace(/^₹/, '')
  if (s === '' || s === '-') return 0
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

/** Labels are matched on their words alone, so "(Rs)", stray spacing and the
 * odd capital cannot break a month. */
function labelKey(v: unknown): string {
  return clean(v).toLowerCase().replace(/\(rs\)/g, ' ').replace(/[().]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** yyyy-mm from the archive's own folder, which names the cycle it covers. */
export function blinkitMonthFromPaths(paths: string[], fallbackName = ''): string | null {
  for (const candidate of [...paths, fallbackName]) {
    const m = /(\d{4})-(\d{2})-\d{2}\s*[_ ]?to[_ ]?\s*\d{4}-\d{2}-\d{2}/i.exec(candidate)
    if (m) return `${m[1]}-${m[2]}`
  }
  return null
}

/** Rows of a sheet as objects, given the index of its header row. */
function records(sheet: RawSheet, headerRow: number): Record<string, string>[] {
  const header = (sheet[headerRow] ?? []).map((h) => clean(h))
  return sheet
    .slice(headerRow + 1)
    .filter((r) => r.some((c) => clean(c) !== ''))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, clean(r[i])])))
}

/**
 * The header row of a detail sheet, which Blinkit puts under a title and a
 * blank line or three rather than at the top.
 *
 * Found by the columns it must contain rather than by what its first column
 * is called, because that is the part that moves: the order sheet starts
 * "S.No." in one archive and "Forward Invoice ID" in the other, and the
 * ageing sheet starts "State". Requiring two real columns cannot match a
 * title row the way a single loose match could.
 */
function headerRowOf(sheet: RawSheet, required: string[]): number {
  for (let i = 0; i < Math.min(sheet.length, 10); i++) {
    const cells = (sheet[i] ?? []).map((c) => clean(c))
    if (required.every((name) => cells.includes(name))) return i
  }
  return -1
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

/**
 * A date as either archive writes it: "2026-08-01", or "1 April 2026".
 *
 * Null rather than a guess for anything else. A row whose date cannot be read
 * is reported as an invalid row, and lands in the wrong month if it is
 * guessed at.
 */
export function blinkitOrderDate(value: unknown): string | null {
  const text = clean(value)
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(text)
  if (iso) return iso[1]

  const spelled = /^(\d{1,2})[ -]([A-Za-z]+)[ -](\d{4})$/.exec(text)
  if (spelled) {
    const month = MONTHS.findIndex((m) => m.startsWith(spelled[2].toLowerCase().slice(0, 3)))
    if (month >= 0) return `${spelled[3]}-${String(month + 1).padStart(2, '0')}-${spelled[1].padStart(2, '0')}`
  }
  return null
}

const EMPTY_FACTS = (month: string): BlinkitPnlFacts => ({
  schemaVersion: 1, month,
  customerPayable: 0, outputGstOnSales: 0, mrpValue: 0, unitsSold: 0, orderLines: 0,
  commission: 0, commissionGst: 0, shipping: 0, shippingGst: 0,
  customerReturnCharge: 0, customerReturnChargeGst: 0, tcs: 0, tds: 0,
  upfrontStorage: 0, upfrontStorageGst: 0, recallCharge: 0, recallChargeGst: 0,
  storageCharge: 0, storageChargeGst: 0, courierCharge: 0, courierChargeGst: 0,
  adsRefund: 0, adsRefundGst: 0, lostDamagedCompensation: 0,
  tcsReimbursement: 0, tdsReimbursement: 0, otherCreditDebitNote: 0,
  otherDeductions: 0, netPayoutPerFile: 0,
  lpSpAdjustmentInclTax: 0, lpSpAdjustmentTax: 0, lpSpAdjustmentLines: 0,
})

/**
 * True when the archive looks like a Blinkit payout zip.
 *
 * The statement is the signature. It used to also insist on a workbook called
 * "Order_level_charges", which is a name only one of the two archives uses —
 * so the April file, which has a Payout Breakup in every one of its thirteen
 * workbooks, was turned away as not being a Blinkit file at all.
 */
export function detectBlinkitPayoutArchive(sheetNames: string[]): boolean {
  return sheetNames.includes(PAYOUT_SHEET)
}

/**
 * No SKU master or mapping table is taken. Blinkit's archive carries only its
 * own item codes, so a row is stored under the code the file gives and named
 * through the SKU mapping when it is read — the same way a channel's product
 * names resolve everywhere else, and the reason an unmapped Blinkit item says
 * so on screen instead of arriving silently misnamed.
 */
export async function normalizeBlinkitPayoutZip(
  zipBytes: ArrayBuffer | Uint8Array,
  importId: string,
  archiveName = '',
): Promise<BlinkitPayoutResult> {
  const entries = await unzip(zipBytes)
  const paths = entries.map((e) => e.path)

  const month = blinkitMonthFromPaths(paths, archiveName)
  if (!month) {
    throw new Error(
      'Could not tell which month this archive covers. Its folder should be named like "payout_sheet_2026-08-01 To 2026-08-31".',
    )
  }

  // Every workbook, by the sheets inside it rather than by what it is called.
  const books = entries.map((e) => workbookSheetsFromBytes(e.bytes))
  const sheetNames = [...new Set(books.flatMap((b) => Object.keys(b)))]
  /** The first sheet in the archive with this name, wherever it was filed. */
  const sheetNamed = (name: string): RawSheet | null => books.find((b) => b[name])?.[name] ?? null

  if (!detectBlinkitPayoutArchive(sheetNames)) {
    throw new Error(
      'This zip does not look like a Blinkit payout sheet — none of its workbooks has a "Payout Breakup" sheet. ' +
      `It holds: ${sheetNames.join(', ') || 'nothing this app can read'}.`,
    )
  }

  const facts = EMPTY_FACTS(month)
  const warnings: string[] = []
  const unknownPayoutRows: string[] = []

  // ---- A to E, from the statement itself ---------------------------------
  const payoutSheet = sheetNamed(PAYOUT_SHEET)
  if (!payoutSheet) throw new Error('The archive has no "Payout Breakup" sheet, which is the statement everything else explains.')

  /**
   * Which way the statement writes a charge, read off its own column heading.
   *
   * The lettered archive heads its third column "Sale/Amount Charged" and
   * writes a commission of ₹128.60 as -128.6. The other heads it "Delivered
   * Orders" and writes ₹350.98 as 350.98, subtracting it in the total below.
   * Both are stored here as positive magnitudes, as every other channel's
   * charges are, so the sign has to be taken from the file rather than
   * assumed — negating April's figures would have turned every charge on the
   * month into a credit and reported a profit that did not happen.
   *
   * This is checked arithmetically straight afterwards: A less B to E has to
   * come to the figure the statement itself prints.
   */
  const headerRow = payoutSheet.find((r) => labelKey(r[1]) === 'particular')
  const chargesAreNegative = labelKey(headerRow?.[2]).includes('charged')

  const byLabel = new Map(PAYOUT_LINES.flatMap((l) => l.labels.map((label) => [label, l] as const)))
  for (const row of payoutSheet.slice(2)) {
    const serial = clean(row[0])
    const key = labelKey(row[1])
    if (key === '' || IGNORED_LABELS.has(key) || CYCLE_ROW.test(key)) continue
    // "Other Deductions" names both a section heading and the E row under it.
    // The heading carries no serial, so the serial is what tells them apart.
    if (key === 'other deductions' && serial === '') continue

    // The last column: what was charged after any reversal against it — the
    // figure Blinkit settled on. Both archives put it in the same place.
    const stated = num(row[4])

    if (NOT_PLACED_YET.has(key)) {
      if (stated !== 0) unknownPayoutRows.push(`${clean(row[1])} (₹${stated})`)
      continue
    }

    const line = byLabel.get(key)
    if (!line) {
      unknownPayoutRows.push(clean(row[1]))
      continue
    }
    // A row already filled is a second spelling of one this statement has
    // used already, which only happens if the vocabulary above is wrong about
    // them being alternatives. Taking the first keeps a real figure.
    if (facts[line.field] !== 0) continue
    // `|| 0` only to turn -0 into 0: negating a nil charge is arithmetically
    // harmless but prints as "-₹0".
    ;(facts[line.field] as number) = (line.cost && chargesAreNegative ? -stated : stated) || 0
  }
  if (unknownPayoutRows.length > 0) {
    warnings.push(
      `Blinkit's payout sheet carries ${unknownPayoutRows.length} line(s) this dashboard does not know: ${unknownPayoutRows.join(', ')}. ` +
      'They are not in the statement below. Send them over and they will be added.',
    )
  }

  // ---- The order lines ----------------------------------------------------
  const validRecords: CanonicalSalesRecord[] = []
  const invalidRows: RowIssue[] = []
  let detailCustomerPayable = 0
  let detailCommission = 0
  let detailShipping = 0

  // One sheet in the lettered archive, two in the other. Whichever are here
  // are read; a name that is not in this archive is simply absent.
  const orderSheets = ORDER_SHEETS.map((name) => [name, sheetNamed(name)] as const).filter((s): s is [string, RawSheet] => s[1] !== null)
  if (orderSheets.length === 0) {
    warnings.push('The archive has no order sheet, so this month has a statement but no product detail.')
  }

  for (const [sheetName, ordersSheet] of orderSheets) {
    const headerRow = headerRowOf(ordersSheet, ['Item ID', 'Quantity'])
    if (headerRow < 0) {
      warnings.push(`The "${sheetName}" sheet has no recognisable header row, so no product detail was read from it.`)
      continue
    }
    {
      const rows = records(ordersSheet, headerRow)
      facts.orderLines += rows.length
      rows.forEach((r, i) => {
        // The two archives name these differently: a return row lives on its
        // own sheet in one, and is marked by its Order Type in the other.
        const returnsOnly = RETURN_ONLY_SHEETS.has(sheetName)
        const orderId = clean(r['Order ID']) || clean(r['Return Order ID'])
        const itemId = clean(r['Item ID'])
        const orderDate = blinkitOrderDate(r['Order Date'] ?? r['Return Order Date'])
        if (!orderId || !itemId) {
          invalidRows.push({ rowIndex: headerRow + 2 + i, reason: 'Row has no Order ID or Item ID.' })
          return
        }
        if (!orderDate) {
          invalidRows.push({ rowIndex: headerRow + 2 + i, reason: `Unreadable Order Date: "${clean(r['Order Date'] ?? r['Return Order Date'])}"` })
          return
        }

        const isReturn = returnsOnly || clean(r['Order Type']).toLowerCase() === 'return'
        const quantity = num(r['Quantity'])
        // "Total Gross Bill Amount" rather than "Selling Price": the first is
        // stated as a line total, the second is a unit price, and they are
        // only equal while every line is a single unit.
        const grossBill = num(r['Total Gross Bill Amount'])
        const tax = num(r['Total Tax'])
        const commission = num(r['Commission Charge (Rs)'])
        const shipping = num(r['Shipping Charge (Rs)'])

        facts.mrpValue += num(r['MRP (Rs)']) * (quantity || 1)
        if (!isReturn) {
          facts.unitsSold += quantity
          facts.outputGstOnSales += tax
          detailCustomerPayable += grossBill
        }
        detailCommission += commission
        detailShipping += shipping

        validRecords.push({
          orderId,
          // Blinkit bills a line per item, and one order can carry several, so
          // the invoice and the item together are what makes a line unique.
          lineId: `${clean(r['Forward Invoice ID']) || clean(r['Invoice ID']) || orderId}#${itemId}`,
          orderDate,
          channel: 'blinkit',
          marketplace: 'Blinkit',
          sellerType: 'marketplace',
          // Blinkit's own item code. There is no seller SKU anywhere in the
          // archive, so this is what SKU Mapping has to be pointed at.
          sku: itemId,
          productName: clean(r['Product Name']),
          category: clean(r['L1 Category']) || clean(r['Business Category']) || 'Uncategorised',
          subCategory: clean(r['L2 Category']) || undefined,
          quantity: isReturn ? 0 : quantity,
          grossSales: isReturn ? 0 : grossBill,
          discount: 0,
          // Stated ex-GST, as every other channel's net sales is: the output
          // tax was collected for the government and was never revenue.
          netSales: isReturn ? 0 : Math.max(0, grossBill - tax),
          returnUnits: isReturn ? quantity : 0,
          rtoUnits: 0,
          shippingCost: shipping,
          marketplaceFee: commission,
          tax,
          status: isReturn ? 'returned' : 'completed',
          currency: 'INR',
          importId,
        } as CanonicalSalesRecord)
      })
    }
  }

  // ---- The memo that is not in the payout --------------------------------
  const lpSheet = sheetNamed('LP-SP Adjustment')
  if (lpSheet) {
    const headerRow = headerRowOf(lpSheet, ['Item Name', 'Total CN/DN Amount (Inclusive of Tax)'])
    if (headerRow >= 0) {
      let blankAdjustments = 0
      for (const r of records(lpSheet, headerRow)) {
        const amount = num(r['Total CN/DN Amount (Inclusive of Tax)'])
        if (amount === 0) {
          // A serial and an item name with no prices and no note type at all.
          // August's archive has four. They are counted and reported rather
          // than skipped quietly, because an unpriced adjustment may be one
          // Blinkit has still to raise.
          if (clean(r['Item Name']) !== '') blankAdjustments++
          continue
        }
        // A credit note is money back to Blinkit, a debit note money to us.
        const sign = clean(r['CN/DN Type']).toUpperCase() === 'CREDIT_NOTE' ? -1 : 1
        facts.lpSpAdjustmentInclTax += sign * amount
        facts.lpSpAdjustmentTax += sign * num(r['Total Tax Amount (Rs)'])
        facts.lpSpAdjustmentLines += 1
      }
      if (blankAdjustments > 0) {
        warnings.push(
          `${blankAdjustments} landing-price/selling-price row(s) in this archive name a product but carry no amount, ` +
          'so there is nothing to report against them. Ask Blinkit whether an adjustment is still to come.',
        )
      }
    }
  }

  // ---- Does the detail agree with the statement? -------------------------
  //
  // The lettered archive puts the charge and the credit notes against it on
  // one "Aging Charge" sheet, as two columns. The other splits them over
  // "Daily Ageing" and "Ageing Reversal" — and the reversal sheet already
  // states its figures as negatives, so the two are added rather than
  // subtracted. On the owner's April archive that is 13,181.25 and -1,402.50,
  // which comes to the 11,778.76 the statement charges.
  let detailAging = 0
  let agingChecked = false

  const agingSheet = sheetNamed('Aging Charge')
  if (agingSheet) {
    const headerRow = headerRowOf(agingSheet, ['Item ID', 'Aging Amount (Rs)'])
    if (headerRow >= 0) {
      agingChecked = true
      for (const r of records(agingSheet, headerRow)) {
        detailAging += num(r['Aging Amount (Rs)']) - num(r['Total Aging Amt CN-ed (Rs)'])
      }
    }
  } else {
    for (const name of ['Daily Ageing', 'Ageing Reversal']) {
      const sheet = sheetNamed(name)
      if (!sheet) continue
      const headerRow = headerRowOf(sheet, ['Item ID', 'Total Charge (Rs)'])
      if (headerRow < 0) continue
      agingChecked = true
      for (const r of records(sheet, headerRow)) detailAging += num(r['Total Charge (Rs)'])
    }
  }

  const near = (a: number, b: number, tolerance = 1): boolean => Math.abs(a - b) <= tolerance
  const statementNet =
    facts.customerPayable
    - facts.commission - facts.commissionGst - facts.shipping - facts.shippingGst
    - facts.customerReturnCharge - facts.customerReturnChargeGst - facts.tcs - facts.tds
    - facts.upfrontStorage - facts.upfrontStorageGst - facts.recallCharge - facts.recallChargeGst
    - facts.storageCharge - facts.storageChargeGst - facts.courierCharge - facts.courierChargeGst
    + facts.adsRefund + facts.adsRefundGst + facts.lostDamagedCompensation
    + facts.tcsReimbursement + facts.tdsReimbursement + facts.otherCreditDebitNote
    - facts.otherDeductions

  // A check is only made where the detail behind it was actually read. An
  // archive missing a sheet would otherwise report its figure as ₹0 and fail
  // the month — which reads as Blinkit having overcharged, when all that
  // happened is that a workbook was not in the zip.
  const ordersRead = orderSheets.length > 0
  const checks: ReconciliationCheck[] = [
    {
      name: 'The statement adds up to the payout Blinkit states',
      passed: near(statementNet, facts.netPayoutPerFile, 1),
      detail: `A less B to E is ₹${statementNet.toFixed(2)}; the file's own total for the cycle is ₹${facts.netPayoutPerFile.toFixed(2)}.`,
    },
    ...(ordersRead
      ? [
          {
            name: 'Customer payable matches the orders behind it',
            passed: near(detailCustomerPayable, facts.customerPayable, 1),
            detail: `The order sheet totals ₹${detailCustomerPayable.toFixed(2)} against the statement's ₹${facts.customerPayable.toFixed(2)}.`,
          },
          {
            name: 'Commission matches the orders it was charged on',
            passed: near(detailCommission, facts.commission, 1),
            detail: `The order sheet totals ₹${detailCommission.toFixed(2)} against the statement's ₹${facts.commission.toFixed(2)}.`,
          },
          {
            name: 'Shipping matches the orders it was charged on',
            passed: near(detailShipping, facts.shipping, 1),
            detail: `The order sheet totals ₹${detailShipping.toFixed(2)} against the statement's ₹${facts.shipping.toFixed(2)}.`,
          },
        ]
      : []),
    ...(agingChecked
      ? [
          {
            name: 'Storage matches the ageing rows behind it',
            passed: near(detailAging, facts.storageCharge, 1),
            detail: `The ageing sheets net to ₹${detailAging.toFixed(2)} against the statement's ₹${facts.storageCharge.toFixed(2)}.`,
          },
        ]
      : []),
  ]
  for (const check of checks) if (!check.passed) warnings.push(`${check.name} — it does not. ${check.detail}`)

  if (facts.lpSpAdjustmentLines > 0) {
    warnings.push(
      `${facts.lpSpAdjustmentLines} landing-price/selling-price adjustment(s) worth ₹${facts.lpSpAdjustmentInclTax.toFixed(2)} ` +
      'are in this archive but not in its Payout Breakup, and they are against goods received in earlier months. ' +
      'They are shown as a memo under the statement and are not in any margin, because what they settle has not been confirmed.',
    )
  }

  return {
    facts,
    checks,
    unknownPayoutRows,
    validRecords,
    totalRows: facts.orderLines,
    invalidRows,
    warnings,
  }
}
