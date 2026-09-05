import type { CanonicalSalesRecord, SkuMaster } from '@/data/models'
import type { SkuMapping } from '@/data/skuMapping'
import type { RawSheet } from '@/lib/csvParse'
import { normalizeCategory } from '@/data/categories'
import { toIsoDate, toMonthKey } from '@/lib/format'
import { parseInSlashDate } from '@/lib/reportDate'
import type { NormalizeResult } from './types'

/**
 * Amazon India Vendor Central — the ASIN-level monthly sales report
 * (Retail Analytics ▸ Sales ▸ View by ASIN, Reporting Range: Month).
 *
 * Two things about this export shape the whole reader.
 *
 * The first is that its top line is not a header. Amazon writes the report's
 * own settings there — programme, distributor view, currency, and the
 * reporting range the file covers — and puts the column names on line two.
 * That settings line is the only place the file says which month it is, so it
 * is read rather than skipped.
 *
 * The second is that a vendor's revenue is not on the same line as a seller's.
 * Selling *through* Amazon, the money is what the customer paid. Selling *to*
 * Amazon, the money is what Amazon paid us — the `Shipped COGS` column, which
 * is Amazon's cost and therefore our invoice. `Ordered Revenue` is the retail
 * value Amazon went on to sell at, which is a demand signal and not our
 * turnover. Amazon omits Shipped COGS from some distributor views, and this
 * reader will not quietly promote retail revenue into a vendor P&L line: when
 * the file has no Shipped COGS it says so, in as many words, and marks every
 * row with the basis it actually used.
 */

const HEADERS = {
  asin: 'ASIN',
  title: 'Product Title',
  brand: 'Brand',
  orderedRevenue: 'Ordered Revenue',
  orderedUnits: 'Ordered Units',
  shippedRevenue: 'Shipped Revenue',
  shippedCogs: 'Shipped COGS',
  shippedUnits: 'Shipped Units',
  customerReturns: 'Customer Returns',
}

/** Which column the vendor's own turnover was taken from. */
export type VendorRevenueBasis = 'shipped_cogs' | 'ordered_revenue'

export interface VendorReportMeta {
  /** yyyy-mm, from the reporting range on the settings line. */
  month: string
  /** First and last day the report covers, ISO. */
  from: string
  to: string
  currency: string
  programme?: string
  distributorView?: string
  viewBy?: string
  business?: string
  reportingRange?: string
  reportUpdated?: string
}

export interface VendorSalesResult extends NormalizeResult {
  meta: VendorReportMeta | null
  revenueBasis: VendorRevenueBasis
  totals: {
    orderedRevenue: number
    orderedUnits: number
    shippedRevenue: number
    shippedCogs: number
    shippedUnits: number
    customerReturns: number
  }
}

function cell(row: (string | number)[] | undefined, index: number): string {
  if (!row || index < 0) return ''
  const v = row[index]
  return v === undefined || v === null ? '' : String(v).trim()
}

/**
 * `₹2,84,875.79`, `-₹1,608.48`, `"1,683"`, `₹0.00`, or nothing at all.
 *
 * Indian digit grouping is not every three digits, so no assumption is made
 * about where the separators fall — they are simply removed. The sign is read
 * before the symbol because Amazon writes a negative as `-₹379.04`, with the
 * minus outside the currency symbol.
 */
export function parseVendorAmount(raw: string): number {
  const text = raw.trim()
  if (text === '' || text === '-' || text === '—') return 0
  const negative = /^\(.*\)$/.test(text) || text.startsWith('-')
  const digits = text.replace(/[()]/g, '').replace(/^-/, '').replace(/[^0-9.]/g, '')
  if (digits === '' || digits === '.') return 0
  const value = Number(digits)
  if (!Number.isFinite(value)) return 0
  return negative ? -value : value
}

/** Reads `Key=[value]` pairs off the report's settings line. */
export function parseVendorPreamble(row: (string | number)[]): Record<string, string> {
  const settings: Record<string, string> = {}
  for (const raw of row) {
    // The first cell of a CSV can carry a byte-order mark, which would
    // otherwise leave the mark stuck to the first key so it matches nothing.
    const text = String(raw ?? '').replace(/^\uFEFF/, '').trim()
    const m = /^([^=]+)=\[(.*)\]$/.exec(text)
    if (m) settings[m[1].trim().toLowerCase()] = m[2].trim()
  }
  return settings
}

/** Index of the row holding the column names, or -1. Amazon has moved the
 * settings line before, so the header is found rather than assumed. */
function findHeaderRow(sheet: RawSheet): number {
  for (let i = 0; i < Math.min(sheet.length, 10); i++) {
    const cells = sheet[i].map((c) => String(c ?? '').replace(/^\uFEFF/, '').trim())
    if (cells.includes(HEADERS.asin) && cells.includes(HEADERS.orderedRevenue)) return i
  }
  return -1
}

export function detectAmazonVendorCentralSalesReport(sheet: RawSheet): boolean {
  return findHeaderRow(sheet) >= 0
}

function readMeta(settings: Record<string, string>): VendorReportMeta | null {
  const range = settings['viewing range'] ?? ''
  const [fromRaw, toRaw] = range.split(/\s*[-–]\s*/)
  const from = fromRaw ? parseInSlashDate(fromRaw) : null
  const to = toRaw ? parseInSlashDate(toRaw) : null
  if (!from) return null
  return {
    month: toMonthKey(toIsoDate(from)),
    from: toIsoDate(from),
    to: toIsoDate(to ?? from),
    currency: settings['currency'] || 'INR',
    programme: settings['programme'],
    distributorView: settings['distributor view'],
    viewBy: settings['view by'],
    business: settings['businesses'],
    reportingRange: settings['reporting range'],
    reportUpdated: settings['report updated'],
  }
}

/**
 * Turns the export into one aggregated sales record per ASIN for the month.
 *
 * Like the Amazon USA profitability export, a row here is a month's total for
 * one product and not an order, so it is marked `isAggregate` — otherwise the
 * ASIN count is reported as an order count and every average order value in
 * the dashboard is wrong by the size of the catalogue.
 *
 * ASINs are kept as the record's SKU. They are Amazon's codes, not ours, and
 * pretending otherwise would put a channel code in the middle of company-wide
 * SKU reporting; mapped on the SKU Mapping screen they resolve to the
 * Unicommerce product like every other channel code, and unmapped they show as
 * what they are.
 */
export function normalizeAmazonVendorCentralSales(
  sheet: RawSheet,
  skuMaster: SkuMaster[],
  mappings: SkuMapping[],
  importId: string,
): VendorSalesResult {
  const validRecords: CanonicalSalesRecord[] = []
  const invalidRows: NormalizeResult['invalidRows'] = []
  const warnings: string[] = []

  const headerIndex = findHeaderRow(sheet)
  if (headerIndex < 0) {
    return {
      validRecords, totalRows: 0, invalidRows, warnings: ['No "ASIN" / "Ordered Revenue" header row was found.'],
      meta: null, revenueBasis: 'ordered_revenue',
      totals: { orderedRevenue: 0, orderedUnits: 0, shippedRevenue: 0, shippedCogs: 0, shippedUnits: 0, customerReturns: 0 },
    }
  }

  const headerCells = sheet[headerIndex].map((c) => String(c ?? '').replace(/^\uFEFF/, '').trim())
  const col = (name: string): number => headerCells.indexOf(name)
  const columns = {
    asin: col(HEADERS.asin),
    title: col(HEADERS.title),
    brand: col(HEADERS.brand),
    orderedRevenue: col(HEADERS.orderedRevenue),
    orderedUnits: col(HEADERS.orderedUnits),
    shippedRevenue: col(HEADERS.shippedRevenue),
    shippedCogs: col(HEADERS.shippedCogs),
    shippedUnits: col(HEADERS.shippedUnits),
    customerReturns: col(HEADERS.customerReturns),
  }

  const meta = headerIndex > 0 ? readMeta(parseVendorPreamble(sheet[headerIndex - 1])) : null
  const dataRows = sheet.slice(headerIndex + 1).filter((r) => cell(r, columns.asin) !== '')

  const measured = dataRows.map((row) => ({
    row,
    asin: cell(row, columns.asin),
    title: cell(row, columns.title),
    brand: cell(row, columns.brand),
    orderedRevenue: parseVendorAmount(cell(row, columns.orderedRevenue)),
    orderedUnits: parseVendorAmount(cell(row, columns.orderedUnits)),
    shippedRevenue: parseVendorAmount(cell(row, columns.shippedRevenue)),
    shippedCogs: parseVendorAmount(cell(row, columns.shippedCogs)),
    shippedUnits: parseVendorAmount(cell(row, columns.shippedUnits)),
    customerReturns: parseVendorAmount(cell(row, columns.customerReturns)),
  }))

  const totals = {
    orderedRevenue: measured.reduce((s, r) => s + r.orderedRevenue, 0),
    orderedUnits: measured.reduce((s, r) => s + r.orderedUnits, 0),
    shippedRevenue: measured.reduce((s, r) => s + r.shippedRevenue, 0),
    shippedCogs: measured.reduce((s, r) => s + r.shippedCogs, 0),
    shippedUnits: measured.reduce((s, r) => s + r.shippedUnits, 0),
    customerReturns: measured.reduce((s, r) => s + r.customerReturns, 0),
  }

  // Decided once for the whole file, not per row: a mixture of two revenue
  // definitions inside one month would be a total that means nothing.
  const revenueBasis: VendorRevenueBasis = totals.shippedCogs !== 0 ? 'shipped_cogs' : 'ordered_revenue'

  const internalBySku = new Map(mappings.map((m) => [m.channelSku, m.internalSku]))
  const master = new Map(skuMaster.map((s) => [s.sku, s]))
  const orderDate = meta?.from ?? ''
  const month = meta?.month ?? ''

  let unmappedAsins = 0
  let emptyRows = 0

  measured.forEach((r, i) => {
    const rowIndex = headerIndex + 1 + i
    if (!month) return invalidRows.push({ rowIndex, reason: 'Report month unknown — the "Viewing Range" setting could not be read.' })

    const noActivity =
      r.orderedRevenue === 0 && r.orderedUnits === 0 && r.shippedCogs === 0 &&
      r.shippedRevenue === 0 && r.shippedUnits === 0 && r.customerReturns === 0
    if (noActivity) { emptyRows++; return }

    const internalSku = internalBySku.get(r.asin)
    const product = internalSku ? master.get(internalSku) : undefined
    if (!product) unmappedAsins++

    const netSales = revenueBasis === 'shipped_cogs' ? r.shippedCogs : r.orderedRevenue

    validRecords.push({
      // One row per ASIN per month, so the month is part of the identity —
      // re-uploading a corrected file restates the row instead of adding
      // a second copy of the same month.
      orderId: `amazon_in_vendor-${r.asin}-${month}`,
      orderDate,
      channel: 'amazon_in_vendor',
      marketplace: 'amazon_in_vendor',
      sellerType: 'vendor_central',
      sku: r.asin,
      productName: r.title || product?.productName || r.asin,
      category: normalizeCategory(product?.category),
      // Units the customer ordered. Shipped units are what Amazon actually
      // pulled from its warehouses in the month and are kept in `raw`; they
      // answer a different question and are not the sales quantity.
      quantity: r.orderedUnits,
      grossSales: r.orderedRevenue,
      discount: 0,
      netSales,
      returnUnits: r.customerReturns,
      rtoUnits: 0,
      shippingCost: 0,
      marketplaceFee: 0,
      tax: 0,
      status: 'completed',
      currency: 'INR',
      isAggregate: true,
      raw: {
        ASIN: r.asin,
        'Product Title': r.title,
        Brand: r.brand,
        'Ordered Revenue': r.orderedRevenue,
        'Ordered Units': r.orderedUnits,
        'Shipped Revenue': r.shippedRevenue,
        'Shipped COGS': r.shippedCogs,
        'Shipped Units': r.shippedUnits,
        'Customer Returns': r.customerReturns,
        'Revenue basis': revenueBasis,
      },
      importId,
    })
  })

  if (!meta) {
    warnings.push(
      'The report month could not be read from the file\'s settings line ("Viewing Range=[01/07/26 - 31/07/26]"). ' +
      'Nothing was imported — re-download the report without editing its first line.',
    )
  }
  if (revenueBasis === 'ordered_revenue') {
    warnings.push(
      'This export\'s "Shipped COGS" column is zero on every row, so what Amazon actually paid you is not in the file. ' +
      'Sales have been recorded at "Ordered Revenue" — the retail value Amazon sold at, which is higher than your ' +
      'vendor invoice. To get the real vendor revenue, re-run the report with the Sourcing distributor view and ' +
      'upload it again; it will replace these figures rather than add to them.',
    )
  }
  if (unmappedAsins > 0) {
    warnings.push(
      `${unmappedAsins} ASIN(s) are not linked to a Unicommerce SKU, so they carry no cost and no category. ` +
      'Link them on the SKU Mapping screen to get COGS and contribution for Vendor Central.',
    )
  }
  if (emptyRows > 0) {
    warnings.push(`${emptyRows} ASIN(s) had no sales, no shipments and no returns this month and were skipped.`)
  }
  const negatives = measured.filter((r) => r.orderedUnits < 0).length
  if (negatives > 0) {
    warnings.push(`${negatives} ASIN(s) show negative ordered units — returns and cancellations outweighed new orders. Kept as reported.`)
  }

  return { validRecords, totalRows: dataRows.length, invalidRows, warnings, meta, revenueBasis, totals }
}
