import { hasSheets, mergeHeaderRows, rowsToRecords, sheetNamed, type RawSheet } from '@/lib/csvParse'
import type { CanonicalSalesRecord, FlipkartPnlFacts, SkuMaster } from '@/data/models'
import { getField, type NormalizeResult } from './types'
import { normalizeCategory } from '@/data/categories'
import { toIsoDate } from '@/lib/format'
import { parseReportDate } from '@/lib/reportDate'

/**
 * Normalizes the REAL Flipkart P&L workbook (Seller Hub ▸ Reports ▸ Profit &
 * Loss, downloaded as a single .xlsx with "Overall Summary", "SKU-level P&L"
 * and "Orders P&L" sheets). "Overall Summary" already carries every
 * account-level total Flipkart itself reports (fees, ads, taxes, seller
 * discount, customer add-ons) plus the report's own month — so unlike the
 * standalone SKU-level P&L CSV path (flipkartSkuPnl.ts), no manual month
 * entry is needed here. "Orders P&L" is order-level with a real date per
 * row, giving genuine daily granularity for Sales/SKU analytics.
 */

const CATCHALL_LABELS = [
  'offer adjustments', 'no cost emi fee reimbursement', 'installation fee', 'tech visit fee',
  'uninstallation & packaging fee', 'customer add-ons amount recovery', 'franchise fee',
  'shopsy marketing fee', 'product cancellation fee', 'value added services (vas)',
]

function normalizeLabel(s: string): string {
  return s.replace(/^[•\s]+/, '').replace(/:$/, '').trim().toLowerCase()
}

function parseLabelValueSheet(sheet: RawSheet): Map<string, number | string> {
  const map = new Map<string, number | string>()
  for (const row of sheet) {
    const label = row[0]
    if (typeof label !== 'string' || !label.trim()) continue
    const value = row[1]
    map.set(normalizeLabel(label), typeof value === 'number' ? value : String(value ?? ''))
  }
  return map
}

function num(map: Map<string, number | string>, key: string): number {
  const v = map.get(key)
  return typeof v === 'number' ? v : Number(v) || 0
}

/**
 * The Overall Summary lines this reader looks up by name, written as the sheet
 * writes them.
 *
 * A label the sheet does not carry reads as zero, and a zero on the P&L looks
 * exactly like a month Flipkart charged nothing for — the same trap that hid
 * Myntra's fees for every month on its earlier layout. So the sheet is checked
 * for these names and the ones it does not have are reported, which keeps
 * "Flipkart billed nothing" apart from "the line was not found under that
 * name".
 *
 * Collection Fee, Forward Shipping Fee and the catch-all charges are left out
 * on purpose: real months have gone without them, so their absence says
 * nothing.
 */
const EXPECTED_SUMMARY_LABELS = [
  'Gross Sales', 'Estimated Net Sales', 'Seller-Funded Discount', 'Customer Add-Ons Amount',
  'Commission Fee', 'Fixed Fee', 'Pick and Pack Fee', 'Reverse Shipping Fee',
  'Storage Fee', 'Recall Fee', 'Ads', 'Google Ads',
  'Taxes (GST)', 'Taxes (TCS)', 'Taxes (TDS)', 'Rewards & Other Benefits',
]

/** Flipkart's own stated total of the charges itemised below it. */
const EXPENSE_TOTAL_LABEL = 'Total Expenses'

const inr = (n: number): string => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const SUMMARY_SHEET = 'Overall Summary'
const ORDERS_SHEET = 'Orders P&L'

export function detectFlipkartWorkbook(sheetNames: string[]): boolean {
  return hasSheets(sheetNames, SUMMARY_SHEET, ORDERS_SHEET)
}

function extractMonthFromSummary(map: Map<string, number | string>): string {
  const range = map.get('orders recieved during') ?? map.get('orders received during')
  if (typeof range !== 'string') return ''
  const startPart = range.split(' to ')[0]?.trim()
  const d = parseReportDate(startPart, 'iso') ?? new Date(NaN)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export interface ExpenseReconciliation {
  /** What Flipkart says the month's charges came to. */
  stated: number
  /** What the lines this reader recognises add up to. */
  read: number
  gap: number
}

interface SummaryReadResult {
  facts: Omit<FlipkartPnlFacts, 'cogsPriced' | 'cogsUnpriced'>
  month: string
  missingLabels: string[]
  /** Null when the sheet does not state a total, so there is nothing to check against. */
  expenses: ExpenseReconciliation | null
}

function buildFactsFromOverallSummary(summarySheet: RawSheet): SummaryReadResult {
  const map = parseLabelValueSheet(summarySheet)
  const month = extractMonthFromSummary(map)

  const catchallSum = CATCHALL_LABELS.reduce((sum, label) => sum + num(map, label), 0)

  const facts: Omit<FlipkartPnlFacts, 'cogsPriced' | 'cogsUnpriced'> = {
    month,
    grossSales: num(map, 'gross sales'),
    estimatedNetSales: num(map, 'estimated net sales'),
    commissionFee: Math.abs(num(map, 'commission fee')),
    collectionFee: Math.abs(num(map, 'collection fee')),
    fixedFee: Math.abs(num(map, 'fixed fee')),
    pickPackFee: Math.abs(num(map, 'pick and pack fee')),
    forwardShippingFee: Math.abs(num(map, 'forward shipping fee')),
    reverseShippingFee: Math.abs(num(map, 'reverse shipping fee')),
    storageFee: Math.abs(num(map, 'storage fee')),
    recallFee: Math.abs(num(map, 'recall fee')),
    otherMarketplaceFees: -catchallSum,
    rewardsSpf: num(map, 'rewards & other benefits'),
    flipkartAds: Math.abs(num(map, 'ads')),
    googleAds: Math.abs(num(map, 'google ads')),
    sellerFundedDiscount: Math.abs(num(map, 'seller-funded discount')),
    customerAddOns: num(map, 'customer add-ons amount'),
    outputGst: Math.abs(num(map, 'taxes (gst)')) + Math.abs(num(map, 'taxes (tcs)')) + Math.abs(num(map, 'taxes (tds)')),
  }

  // Flipkart states its own total above the itemised charges, and the items
  // below add up to it exactly, which makes the sheet check itself: if the
  // lines this reader recognises fall short of the stated total, the sheet
  // charges something on a line it does not know by name, and the gap is what
  // went missing. A label that reads as zero is otherwise indistinguishable
  // from a month with no such charge.
  //
  // Verified on the September'26 report: the recognised lines come to
  // ₹8,52,546.43 against a stated ₹8,52,546.43.
  const read =
    facts.commissionFee + facts.collectionFee + facts.fixedFee + facts.pickPackFee +
    facts.forwardShippingFee + facts.reverseShippingFee + facts.storageFee + facts.recallFee +
    facts.otherMarketplaceFees + facts.flipkartAds + facts.googleAds + facts.outputGst
  const stated = Math.abs(num(map, normalizeLabel(EXPENSE_TOTAL_LABEL)))

  return {
    month,
    facts,
    missingLabels: EXPECTED_SUMMARY_LABELS.filter((label) => !map.has(normalizeLabel(label))),
    // Absent on a sheet that does not state the line, which is how an earlier
    // layout of this report would arrive.
    expenses: map.has(normalizeLabel(EXPENSE_TOTAL_LABEL)) ? { stated, read, gap: stated - read } : null,
  }
}

function mapOrderStatus(raw: string | undefined): CanonicalSalesRecord['status'] {
  const v = (raw ?? '').toLowerCase()
  if (v.includes('cancel')) return 'cancelled'
  if (v.includes('rto')) return 'rto'
  if (v.includes('return') || v.includes('rvp')) return 'returned'
  return 'completed'
}

export interface FlipkartWorkbookNormalizeResult extends NormalizeResult {
  facts: FlipkartPnlFacts
  month: string
}

export function normalizeFlipkartWorkbook(
  sheets: Record<string, RawSheet>,
  skuMaster: SkuMaster[],
  importId: string,
): FlipkartWorkbookNormalizeResult {
  // Looked up the same way they are detected. These were matched exactly
  // while detection was already case-insensitive, so a workbook saved with
  // lower-case sheet names was recognised and then read as empty — a month of
  // zeroes rather than an error.
  const summarySheet = sheetNamed(sheets, SUMMARY_SHEET) ?? []
  const ordersSheet = sheetNamed(sheets, ORDERS_SHEET) ?? []
  const { facts: partialFacts, month, missingLabels, expenses } = buildFactsFromOverallSummary(summarySheet)

  const headers = mergeHeaderRows(ordersSheet[0] ?? [], ordersSheet[1] ?? [])
  const rows = rowsToRecords(headers, ordersSheet, 2)

  const validRecords: CanonicalSalesRecord[] = []
  const invalidRows: NormalizeResult['invalidRows'] = []
  const skuByCode = new Map(skuMaster.map((s) => [s.sku, s]))
  let unknownSkuCount = 0
  let cogsPriced = 0
  let cogsUnpriced = 0

  rows.forEach((row, rowIndex) => {
    const orderItemId = getField(row, ['order item id', 'order id'])
    const sku = getField(row, ['sku name', 'sku'])
    const orderDateRaw = getField(row, ['order date'])
    if (!orderItemId) return invalidRows.push({ rowIndex, reason: 'Missing order item ID' })
    if (!sku) return invalidRows.push({ rowIndex, reason: 'Missing SKU' })
    if (!orderDateRaw) return invalidRows.push({ rowIndex, reason: 'Missing order date' })

    const orderDate = parseReportDate(orderDateRaw, 'iso') ?? new Date(NaN)
    if (Number.isNaN(orderDate.getTime())) return invalidRows.push({ rowIndex, reason: `Invalid date: "${orderDateRaw}"` })

    const grossUnits = Number(getField(row, ['gross units'])) || 0
    const netUnits = Number(getField(row, ['net units'])) || 0
    const rtoUnits = Number(getField(row, ['rto (logistics return)', 'rto'])) || 0
    const rvpUnits = Number(getField(row, ['rvp (customer return)', 'rvp'])) || 0
    const orderItemValue = Number(getField(row, ['order item value'])) || 0
    const estimatedNetSales = Number(getField(row, ['estimated net sales'])) || 0
    const handlingFee = Number(getField(row, ['handling fee'])) || 0

    const skuRecord = skuByCode.get(sku)
    if (!skuRecord) {
      unknownSkuCount++
      cogsUnpriced += orderItemValue * 0.25
    } else {
      cogsPriced += skuRecord.cogs * netUnits
    }

    validRecords.push({
      orderId: orderItemId,
      orderDate: toIsoDate(orderDate),
      channel: 'flipkart',
      marketplace: 'flipkart',
      sellerType: 'marketplace',
      sku,
      productName: skuRecord?.productName ?? sku,
      category: normalizeCategory(skuRecord?.category),
      quantity: grossUnits,
      grossSales: orderItemValue,
      discount: 0,
      netSales: estimatedNetSales,
      returnUnits: rvpUnits,
      rtoUnits,
      shippingCost: 0,
      marketplaceFee: handlingFee,
      tax: 0,
      status: mapOrderStatus(getField(row, ['order status'])),
      currency: 'INR',
      raw: row,
      importId,
    })
  })

  const warnings: string[] = []
  if (unknownSkuCount > 0) {
    warnings.push(`${unknownSkuCount} row(s) reference a SKU not found in the Product Master — COGS for these was estimated at 25% of revenue, not looked up.`)
  }
  if (!month) warnings.push('Could not detect the report month from the "Orders Recieved During" line in Overall Summary.')
  if (missingLabels.length > 0) {
    const one = missingLabels.length === 1
    warnings.push(
      `Overall Summary has no line named ${missingLabels.join(', ')}, so ${one ? 'it was' : 'they were'} read as zero. ` +
        `If Flipkart charged for ${one ? 'it' : 'them'} this month, this file names the line something else.`,
    )
  }
  if (expenses !== null && Math.abs(expenses.gap) > 1) {
    warnings.push(
      `Overall Summary states Total Expenses of ₹${inr(expenses.stated)}, and the charges read from it come to ` +
        `₹${inr(expenses.read)} — a gap of ₹${inr(Math.abs(expenses.gap))}. ` +
        (expenses.gap > 0
          ? 'That much is charged on a line this reader does not recognise, so the P&L is short of it.'
          : 'That is more than the sheet says was charged, so a line on it is being counted twice.'),
    )
  }

  return {
    validRecords,
    totalRows: rows.length,
    invalidRows,
    warnings,
    month,
    facts: { ...partialFacts, cogsPriced, cogsUnpriced },
  }
}
