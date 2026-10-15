import type { CanonicalSalesRecord, PurpllePnlFacts, SkuMaster } from '@/data/models'
import type { ComboComponent, SkuMapping } from '@/data/skuMapping'
import { resolveGstPct } from '@/data/skuMapping'
import type { RawSheet } from '@/lib/csvParse'
import { PURPLLE_ASSUMPTIONS } from '@/config/nativePnlAssumptions'
import { normalizeCategory } from '@/data/categories'
import type { NormalizeResult } from './types'

/**
 * Purplle's monthly sales file, as the Purplle team sends it.
 *
 * One row per order line: the date, the order, Purplle's own SKU code, the
 * EAN, the category, the GST rate, MRP, the price off, and `nmv` — what the
 * customer actually paid, which is MRP less the price off and includes GST.
 *
 * Three things about this file decide how it is read.
 *
 * **It is a sales file, not a settlement.** There is no commission, no
 * logistics charge, no payment fee, no payout and no returns column — nothing
 * Purplle took. So the statement it supports runs from MRP down to gross
 * profit and stops: the line for Purplle's charges is on it, stated as not
 * supplied, rather than left off as though the channel were free.
 *
 * **The money includes GST.** `nmv` is what the shopper paid, and the rate
 * is per product rather than per file — April's lines run at both 18% and
 * 5%. The rate comes from the Product Master, which is the single source of
 * truth for tax; the file states its own rate on every row, and that is used
 * only where the Master has none, with the codes named either way. Where the
 * two disagree the Master decides the statement and the difference is
 * reported, because it is the rate Purplle is invoicing at.
 *
 * **The header is not the first row.** Row 1 holds a strip of totals the
 * sender keeps for their own check, and one of them is labelled Marketing —
 * the month's advertising, which appears nowhere else. The header row is
 * found by its column names, and the marketing figure by its label, rather
 * than by position, because a position is a promise about next month's file
 * that nobody has made.
 */
const COLUMNS = {
  date: ['dt', 'date', 'order_date'],
  orderId: ['order_id', 'order id'],
  ean: ['ean_code', 'ean'],
  sku: ['sku', 'sku_code'],
  name: ['name', 'product_name'],
  category: ['category_name', 'category'],
  categoryRoot: ['category_root'],
  gstRate: ['gst rate', 'gst_rate'],
  nmv: ['nmv'],
  mrp: ['mrp'],
  qty: ['qty', 'quantity', 'units'],
  priceOff: ['price off amt', 'price_off_amt'],
  /** The sender's own second reading of the discount, and their own
   * difference column. Read so the two can be compared rather than ignored. */
  priceOffAlt: ['price off amount'],
  /** The sender's own difference column, read so the file can be checked
   * against itself rather than only against this reading of it. */
  priceOffDifferenceStated: ['difference'],
}

/** Columns a file must have for this to be Purplle's sales report. */
const REQUIRED: (keyof typeof COLUMNS)[] = ['date', 'orderId', 'nmv', 'mrp', 'qty']

const key = (raw: unknown): string => String(raw ?? '').trim().toLowerCase()

function columnIndex(headerRow: unknown[], candidates: string[]): number {
  return headerRow.findIndex((h) => candidates.includes(key(h)))
}

/** Where the column names are. Purplle puts a strip of its own totals above
 * them, so the header is found by looking for it. */
export function purplleHeaderRow(sheet: RawSheet): number {
  return sheet.findIndex((row) =>
    REQUIRED.every((field) => columnIndex(row as unknown[], COLUMNS[field]) >= 0),
  )
}

export function detectPurplleSalesReport(sheet: RawSheet | undefined): boolean {
  if (!sheet || sheet.length === 0) return false
  const header = purplleHeaderRow(sheet)
  if (header < 0) return false
  // `nmv` and a price-off column together are what make this Purplle's file
  // rather than any other order list.
  return (
    columnIndex(sheet[header] as unknown[], COLUMNS.nmv) >= 0 &&
    columnIndex(sheet[header] as unknown[], COLUMNS.priceOff) >= 0
  )
}

function num(raw: unknown): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0
  const text = String(raw ?? '').replace(/[₹,\s]/g, '')
  if (text === '' || text === '-') return 0
  const n = Number(text)
  return Number.isFinite(n) ? n : 0
}

/**
 * The date of a row. Purplle writes it as Excel's own serial number — 46113
 * is 1 April 2026 — and a text date is accepted too in case a later export
 * changes, but only in a form that cannot be read two ways.
 */
export function purplleDate(raw: unknown): string | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 20000 && raw < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + raw * 86400000)
    return d.toISOString().slice(0, 10)
  }
  const text = String(raw ?? '').trim()
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  // dd-mm-yyyy or dd/mm/yyyy, day first as Indian reports are written.
  const dmy = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(text)
  if (dmy) {
    const [, d, m, y] = dmy
    if (Number(m) < 1 || Number(m) > 12 || Number(d) < 1 || Number(d) > 31) return null
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  return null
}

/**
 * The month's advertising, which Purplle writes as a loose label and figure
 * above the table rather than as a column.
 *
 * Found by its label and not by its cell, and reported as read on every
 * upload: a figure picked up from a corner of a spreadsheet has to be visible
 * to whoever uploads it, or nobody can tell the month it was missing from the
 * month it was genuinely zero.
 */
export function purplleMarketing(sheet: RawSheet, headerRow: number): number | null {
  for (let r = 0; r < headerRow; r++) {
    const row = sheet[r] as unknown[]
    for (let i = 0; i < row.length; i++) {
      if (!key(row[i]).startsWith('marketing')) continue
      for (let j = i + 1; j < row.length; j++) {
        if (row[j] !== null && row[j] !== undefined && String(row[j]).trim() !== '') return num(row[j])
      }
    }
  }
  return null
}

export interface PurplleNormalizeResult extends NormalizeResult {
  facts: PurpllePnlFacts
  month: string
  /** Every month the rows fall in. More than one is reported: the statement
   * is monthly, and a file spanning two would land half of it in each. */
  months: string[]
}

export function normalizePurplleSalesReport(
  sheet: RawSheet,
  skuMaster: SkuMaster[],
  mappings: SkuMapping[],
  comboComponents: ComboComponent[],
  importId: string,
): PurplleNormalizeResult {
  const validRecords: CanonicalSalesRecord[] = []
  const invalidRows: NormalizeResult['invalidRows'] = []
  const warnings: string[] = []

  const headerRow = purplleHeaderRow(sheet)
  const header = (sheet[headerRow] ?? []) as unknown[]
  const at = Object.fromEntries(
    Object.entries(COLUMNS).map(([field, candidates]) => [field, columnIndex(header, candidates)]),
  ) as Record<keyof typeof COLUMNS, number>
  const cell = (row: unknown[], field: keyof typeof COLUMNS): unknown =>
    at[field] >= 0 ? row[at[field]] : undefined

  const internalBySku = new Map(mappings.map((m) => [m.channelSku, m.internalSku]))
  const master = new Map(skuMaster.map((s) => [s.sku, s]))
  const mappingTables = { skuMaster, mappings, comboComponents }
  // A code repeats on many rows, so its rate is resolved once.
  const gstByCode = new Map<string, number | null>()
  const gstFallback = new Set<string>()
  const gstMismatch = new Set<string>()
  const unpriced = new Set<string>()
  const orders = new Set<string>()

  const facts: PurpllePnlFacts = {
    month: '', schemaVersion: 1,
    mrpValue: 0, priceOff: 0, nmv: 0, outputGst: 0, netRevenue: 0,
    unitsSold: 0, orderLines: 0, orders: 0, skusSold: 0,
    marginInr: 0, marginPct: PURPLLE_ASSUMPTIONS.marginPct,
    marginBase: PURPLLE_ASSUMPTIONS.marginBase, invoiceValueInr: 0,
    marketingInr: 0, marketingStated: false,
    gstFallbackSkus: [], gstMismatchSkus: [],
    cogsSourceInr: 0, unpricedSkus: [],
    priceOffAlt: 0, priceOffDifference: 0, priceOffDifferenceStated: 0,
  }

  const monthsSeen = new Set<string>()

  for (let r = headerRow + 1; r < sheet.length; r++) {
    const row = sheet[r] as unknown[]
    const rowIndex = r
    if (row.every((v) => v === null || v === undefined || String(v).trim() === '')) continue

    const sku = String(cell(row, 'sku') ?? '').trim()
    const date = purplleDate(cell(row, 'date'))
    if (!sku && date === null) continue
    if (date === null) {
      // Its sales would otherwise land in whichever month the rest of the
      // file happened to be.
      invalidRows.push({ rowIndex, reason: `Unreadable date: "${String(cell(row, 'date') ?? '')}"` })
      continue
    }
    if (!sku) {
      invalidRows.push({ rowIndex, reason: 'Missing SKU' })
      continue
    }

    const qty = num(cell(row, 'qty'))
    const mrp = num(cell(row, 'mrp'))
    const priceOff = num(cell(row, 'priceOff'))
    const nmv = num(cell(row, 'nmv'))
    const statedGstRate = num(cell(row, 'gstRate'))
    // The Product Master decides the rate; the file's own is the fallback.
    // They are not always the same figure, and where they differ the
    // difference is reported rather than averaged away.
    let masterGstRate = gstByCode.get(sku)
    if (masterGstRate === undefined) {
      masterGstRate = resolveGstPct(sku, mappingTables)
      gstByCode.set(sku, masterGstRate)
    }
    if (masterGstRate === null) gstFallback.add(sku)
    else if (Math.abs(masterGstRate - statedGstRate) > 0.0001) gstMismatch.add(sku)
    const gstRate = masterGstRate ?? statedGstRate

    // What Purplle takes, on the base its margin sheet names: 31% inclusive
    // on MRP. Inclusive, so nothing is added for GST on top of it.
    const margin = (facts.marginBase === 'nmv' ? nmv : mrp) * facts.marginPct
    // What we invoice Purplle, GST included. Our revenue is this and not the
    // nmv — the price off between them is Purplle's own, since the margin
    // sheet charges no discount back to us.
    const invoiceValue = (facts.marginBase === 'nmv' ? nmv : mrp) - margin
    // The tax inside what we invoice, at this row's own rate. Taking one rate
    // for the file would be wrong by hundreds on April alone, where the 5%
    // lines sit beside the 18% ones.
    const gst = gstRate > 0 ? invoiceValue - invoiceValue / (1 + gstRate) : 0

    monthsSeen.add(date.slice(0, 7))
    orders.add(String(cell(row, 'orderId') ?? `${date}-${rowIndex}`))

    facts.mrpValue += mrp
    facts.priceOff += priceOff
    facts.nmv += nmv
    facts.outputGst += gst
    facts.marginInr += margin
    facts.invoiceValueInr += invoiceValue
    facts.unitsSold += qty
    facts.orderLines += 1
    facts.priceOffAlt += num(cell(row, 'priceOffAlt'))
    facts.priceOffDifferenceStated += num(cell(row, 'priceOffDifferenceStated'))

    const internalSku = internalBySku.get(sku) ?? sku
    const product = master.get(internalSku) ?? master.get(sku)
    if (!product) unpriced.add(sku)
    facts.cogsSourceInr += (product?.cogs ?? 0) * qty

    validRecords.push({
      orderId: String(cell(row, 'orderId') ?? `purplle-${sku}-${date}-${rowIndex}`),
      lineId: String(rowIndex),
      orderDate: date,
      channel: 'purplle',
      marketplace: 'purplle',
      sellerType: 'marketplace',
      sku,
      productName: product?.productName ?? String(cell(row, 'name') ?? sku),
      category: normalizeCategory(product?.category ?? String(cell(row, 'category') ?? '')),
      quantity: qty,
      // At MRP, with Purplle's trade margin as the deduction from it. The
      // margin is what we never receive, so it belongs here rather than
      // below gross profit — the same treatment Nykaa's margin gets, and for
      // the same reason.
      grossSales: mrp,
      discount: margin,
      // What we invoice, ex-GST, so a Purplle sale means what a sale means
      // everywhere else.
      netSales: invoiceValue - gst,
      returnUnits: 0,
      rtoUnits: 0,
      shippingCost: 0,
      // Nothing: what Purplle takes is a trade margin off MRP, already in
      // `discount` above. Counting it here as well would charge it twice.
      marketplaceFee: 0,
      tax: gst,
      status: 'completed',
      currency: 'INR',
      importId,
    })
  }

  facts.netRevenue = facts.invoiceValueInr - facts.outputGst
  facts.orders = orders.size
  facts.skusSold = new Set(validRecords.map((r) => r.sku)).size
  facts.priceOffDifference = facts.priceOff - facts.priceOffAlt
  facts.unpricedSkus = [...unpriced].sort()
  facts.gstFallbackSkus = [...gstFallback].sort()
  facts.gstMismatchSkus = [...gstMismatch].sort()

  const months = [...monthsSeen].sort()
  facts.month = months[0] ?? ''

  const marketing = purplleMarketing(sheet, headerRow)
  if (marketing !== null) {
    facts.marketingInr = marketing
    facts.marketingStated = true
  }

  if (months.length > 1) {
    warnings.push(
      `These rows cover ${months.length} months (${months.join(', ')}). The statement is monthly, so it is filed ` +
      `under ${months[0]} and the later rows belong in their own upload.`,
    )
  }
  const inr = (v: number): string => `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  warnings.push(
    `Purplle's Basic Product Margin of ${(facts.marginPct * 100).toFixed(0)}% ` +
    `${facts.marginBase === 'mrp' ? 'inclusive on MRP' : 'on nmv'} — ${inr(facts.marginInr)} — comes from the ` +
    'margin sheet and not from this file, which states nothing Purplle took. What we invoice is ' +
    `${inr(facts.invoiceValueInr)} including GST, and the GST inside it — ${inr(facts.outputGst)} — comes out at ` +
    "each product's own rate from the Product Master.",
  )
  if ((facts.gstFallbackSkus?.length ?? 0) > 0) {
    const codes = facts.gstFallbackSkus ?? []
    const shown = codes.slice(0, 8).join(', ')
    const rest = codes.length - 8
    warnings.push(
      `${codes.length} Purplle code(s) have no GST rate in the Product Master, so their tax came out at the rate ` +
      `stated on this file: ${shown}${rest > 0 ? ` and ${rest} more` : ''}. Enter their rate on Catalogue ▸ ` +
      'Product Master, which is what decides the rate once it is there.',
    )
  }
  if ((facts.gstMismatchSkus?.length ?? 0) > 0) {
    const codes = facts.gstMismatchSkus ?? []
    const shown = codes.slice(0, 8).join(', ')
    const rest = codes.length - 8
    warnings.push(
      `${codes.length} Purplle code(s) are invoiced on this file at a GST rate that differs from the Product ` +
      `Master: ${shown}${rest > 0 ? ` and ${rest} more` : ''}. The statement uses the Master. One of the two is ` +
      'wrong on the invoice, so it is worth raising with Purplle.',
    )
  }
  warnings.push(
    `Shoppers paid ${inr(facts.nmv)} after ${inr(facts.priceOff)} of price off. That price off is Purplle's own — ` +
    'the margin sheet charges no discount back to us — so it is kept as a memo and not as a cost. It is the ' +
    'figure to watch for sell-through, not for revenue.',
  )
  warnings.push(
    'The file carries no logistics, payment or return charge, and on a sale-or-return model no record of stock ' +
    'returned to us against the purchase order — the margin sheet has excess stock coming back every 45 days. ' +
    'Send the Purplle payout statement and those lines fill in; nothing above them changes when they do.',
  )
  if (marketing !== null) {
    warnings.push(
      `Advertising of ₹${marketing.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ` +
      'was read from the "Marketing" figure written above the table, not from a column. Check it against Purplle’s ' +
      'own invoice before relying on it.',
    )
  } else {
    warnings.push('No "Marketing" figure was written above the table, so this month carries no Purplle advertising.')
  }
  if (facts.unpricedSkus.length > 0) {
    const shown = facts.unpricedSkus.slice(0, 6).join(', ')
    const rest = facts.unpricedSkus.length - 6
    warnings.push(
      `${facts.unpricedSkus.length} Purplle SKU code(s) have no cost on file, so their goods cost nothing in the ` +
      `statement: ${shown}${rest > 0 ? ` and ${rest} more` : ''}. Link them on Catalogue ▸ SKU Mapping to price the ` +
      'month properly.',
    )
  }
  if (Math.abs(facts.priceOffDifference) > 0.005) {
    warnings.push(
      `The file's two discount columns disagree by ₹${facts.priceOffDifference.toFixed(2)} — "Price Off Amt" totals ` +
      `₹${facts.priceOff.toFixed(2)} and "Price off Amount" ₹${facts.priceOffAlt.toFixed(2)}. The statement uses ` +
      '"Price Off Amt", the one that ties MRP to nmv on every row; the other is the sender’s own second reading.' +
      (Math.abs(facts.priceOffDifferenceStated - facts.priceOffDifference) > 0.005
        ? ` The file’s own "Difference" column totals ₹${facts.priceOffDifferenceStated.toFixed(2)}, which is not that ` +
          'gap either, so the file does not agree with itself.'
        : ''),
    )
  }

  return { facts, month: facts.month, months, validRecords, totalRows: facts.orderLines, invalidRows, warnings }
}
