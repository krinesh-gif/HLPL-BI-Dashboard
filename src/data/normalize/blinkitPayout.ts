import type { BlinkitPnlFacts, CanonicalSalesRecord } from '@/data/models'
import { workbookSheetsFromBytes, type RawSheet } from '@/lib/csvParse'
import { unzip } from '@/lib/unzip'
import type { NormalizeResult, RowIssue } from './types'
import type { ReconciliationCheck } from './meeshoOrderPayments'

/**
 * Blinkit's monthly payout archive.
 *
 * Blinkit does not publish a P&L. It publishes a zip of six workbooks, one of
 * which — the Payout Breakup — is a lettered statement that every other
 * workbook explains:
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
 * On the owner's August 2026 archive the two agree: the detail sums to the
 * same 6,430 of customer payable, 128.60 of commission, 1,500 of shipping and
 * 4,071 of storage, and the statement's own arithmetic lands on the 814.12 it
 * says was paid.
 */

/** The sheet that is the statement. Every workbook in the archive carries a
 * copy of it; the one named for it is the one read. */
const PAYOUT_FILE = 'Payout Breakup'
const ORDERS_FILE = 'Order_level_charges'
const INVENTORY_FILE = 'Inventory_charges'
const LP_SP_FILE = 'LP_SP_adjustments'

/**
 * Which field each row of the Payout Breakup fills, and which way it points.
 *
 * `cost: true` means a row the file writes as a negative. It is stored as a
 * positive magnitude — as every other channel's charges are — by negating the
 * file's Net Amount, rather than by taking its absolute value. The difference
 * matters in the month a reversal exceeds its charge: negation turns that into
 * the credit it is, where absolute value would report it as a cost.
 */
const PAYOUT_LINES: { label: string; field: keyof BlinkitPnlFacts; cost: boolean }[] = [
  { label: 'customer payable', field: 'customerPayable', cost: false },

  { label: 'commission charge', field: 'commission', cost: true },
  { label: 'gst on commission', field: 'commissionGst', cost: true },
  { label: 'shipping charge', field: 'shipping', cost: true },
  { label: 'gst on shipping', field: 'shippingGst', cost: true },
  { label: 'customer return charge', field: 'customerReturnCharge', cost: true },
  { label: 'gst on customer return charges', field: 'customerReturnChargeGst', cost: true },
  { label: 'tcs charge', field: 'tcs', cost: true },
  { label: 'tds charge 194o & q', field: 'tds', cost: true },

  { label: 'upfront storage charge', field: 'upfrontStorage', cost: true },
  { label: 'gst on upfront storage charge', field: 'upfrontStorageGst', cost: true },
  { label: 'recall charge', field: 'recallCharge', cost: true },
  { label: 'gst on recall charge', field: 'recallChargeGst', cost: true },
  { label: 'storage charge', field: 'storageCharge', cost: true },
  { label: 'gst on storage charge', field: 'storageChargeGst', cost: true },
  { label: 'courier charge', field: 'courierCharge', cost: true },
  { label: 'gst on courier charge', field: 'courierChargeGst', cost: true },

  { label: 'ads refund', field: 'adsRefund', cost: false },
  { label: 'gst on ads refund', field: 'adsRefundGst', cost: false },
  { label: 'lost/damaged inventory', field: 'lostDamagedCompensation', cost: false },
  { label: 'tcs reimbursement', field: 'tcsReimbursement', cost: false },
  { label: 'tds reimbursement', field: 'tdsReimbursement', cost: false },
  { label: 'other credit - debit note', field: 'otherCreditDebitNote', cost: false },

  { label: 'other deductions', field: 'otherDeductions', cost: true },
  { label: 'net payout in this cycle', field: 'netPayoutPerFile', cost: false },
]

/** Rows that are headings or running totals, not figures of their own. They
 * are named so an unrecognised row can be reported without reporting these. */
const IGNORED_LABELS = new Set([
  'order level charges', 'inventory & fulfillment charges', 'inventory & fulfilment charges',
  'other additions', 'payout breakup',
  'amount calculated from present cycle', 'unsettled from previous cycle', 'amount calculated till date',
])

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

/** The header row of a detail sheet, which Blinkit puts under a title and a
 * blank line rather than at the top. */
function headerRowOf(sheet: RawSheet, firstColumn: string): number {
  for (let i = 0; i < Math.min(sheet.length, 10); i++) {
    if (labelKey(sheet[i]?.[0]) === labelKey(firstColumn)) return i
  }
  return -1
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

/** True when the archive looks like a Blinkit payout zip. */
export function detectBlinkitPayoutArchive(paths: string[]): boolean {
  const names = paths.map((p) => p.split('/').pop() ?? '')
  return names.some((n) => n.startsWith(PAYOUT_FILE)) && names.some((n) => n.includes(ORDERS_FILE))
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
  if (!detectBlinkitPayoutArchive(paths)) {
    throw new Error('This zip does not look like a Blinkit payout sheet — it has no Payout Breakup and no Order_level_charges workbook.')
  }

  const sheetsOf = (needle: string): Record<string, RawSheet> | null => {
    const entry = entries.find((e) => (e.path.split('/').pop() ?? '').includes(needle))
    return entry ? workbookSheetsFromBytes(entry.bytes) : null
  }

  const facts = EMPTY_FACTS(month)
  const warnings: string[] = []
  const unknownPayoutRows: string[] = []

  // ---- A to E, from the statement itself ---------------------------------
  const payoutBook = sheetsOf(PAYOUT_FILE)
  const payoutSheet = payoutBook?.[PAYOUT_FILE]
  if (!payoutSheet) throw new Error('The archive has no "Payout Breakup" sheet, which is the statement everything else explains.')

  const byLabel = new Map(PAYOUT_LINES.map((l) => [l.label, l]))
  for (const row of payoutSheet.slice(2)) {
    const serial = clean(row[0])
    const key = labelKey(row[1])
    if (key === '' || IGNORED_LABELS.has(key)) continue
    // "Other Deductions" names both a section heading and the E row under it.
    // The heading carries no serial, so the serial is what tells them apart.
    if (key === 'other deductions' && serial === '') continue

    const line = byLabel.get(key)
    if (!line) {
      unknownPayoutRows.push(clean(row[1]))
      continue
    }
    // The Net Amount column, which is the Sale column after the Return column
    // has been applied to it — the figure Blinkit actually settled.
    const net = num(row[4])
    ;(facts[line.field] as number) = line.cost ? -net : net
  }
  if (unknownPayoutRows.length > 0) {
    warnings.push(
      `Blinkit's payout sheet carries ${unknownPayoutRows.length} line(s) this dashboard does not know: ${unknownPayoutRows.join(', ')}. ` +
      'They are not in the statement below. Send them over and they will be added.',
    )
  }

  // ---- The order lines ----------------------------------------------------
  const ordersBook = sheetsOf(ORDERS_FILE)
  const ordersSheet = ordersBook?.['Forward & Return Orders']
  const validRecords: CanonicalSalesRecord[] = []
  const invalidRows: RowIssue[] = []
  let detailCustomerPayable = 0
  let detailCommission = 0
  let detailShipping = 0

  if (ordersSheet) {
    const headerRow = headerRowOf(ordersSheet, 'S.No.')
    if (headerRow < 0) {
      warnings.push('The order sheet has no recognisable header row, so no product detail was read for this month.')
    } else {
      const rows = records(ordersSheet, headerRow)
      facts.orderLines = rows.length
      rows.forEach((r, i) => {
        const orderId = clean(r['Order ID'])
        const itemId = clean(r['Item ID'])
        const orderDate = clean(r['Order Date']).slice(0, 10)
        if (!orderId || !itemId) {
          invalidRows.push({ rowIndex: headerRow + 2 + i, reason: 'Row has no Order ID or Item ID.' })
          return
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(orderDate)) {
          invalidRows.push({ rowIndex: headerRow + 2 + i, reason: `Unreadable Order Date: "${clean(r['Order Date'])}"` })
          return
        }

        const isReturn = clean(r['Order Type']).toLowerCase() === 'return'
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
          lineId: `${clean(r['Forward Invoice ID']) || orderId}#${itemId}`,
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
  } else {
    warnings.push('The archive has no "Forward & Return Orders" sheet, so this month has a statement but no product detail.')
  }

  // ---- The memo that is not in the payout --------------------------------
  const lpBook = sheetsOf(LP_SP_FILE)
  const lpSheet = lpBook?.['LP-SP Adjustment']
  if (lpSheet) {
    const headerRow = headerRowOf(lpSheet, 'S.No.')
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
  const inventoryBook = sheetsOf(INVENTORY_FILE)
  const agingSheet = inventoryBook?.['Aging Charge']
  let detailAging = 0
  if (agingSheet) {
    const headerRow = headerRowOf(agingSheet, 'S.No.')
    if (headerRow >= 0) {
      for (const r of records(agingSheet, headerRow)) {
        detailAging += num(r['Aging Amount (Rs)']) - num(r['Total Aging Amt CN-ed (Rs)'])
      }
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

  const checks: ReconciliationCheck[] = [
    {
      name: 'The statement adds up to the payout Blinkit states',
      passed: near(statementNet, facts.netPayoutPerFile, 1),
      detail: `A less B to E is ₹${statementNet.toFixed(2)}; the file's Net Payout is ₹${facts.netPayoutPerFile.toFixed(2)}.`,
    },
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
    {
      name: 'Storage matches the ageing rows behind it',
      passed: near(detailAging, facts.storageCharge, 1),
      detail: `The ageing sheet nets to ₹${detailAging.toFixed(2)} against the statement's ₹${facts.storageCharge.toFixed(2)}.`,
    },
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
