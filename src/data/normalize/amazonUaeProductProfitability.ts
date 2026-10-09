import type { AmazonAePnlFacts, CanonicalSalesRecord, SkuMaster } from '@/data/models'
import { normalizeCategory } from '@/data/categories'
import { toIsoDate } from '@/lib/format'
import { parseReportDate } from '@/lib/reportDate'
import type { NormalizeResult } from './types'

/**
 * Amazon UAE's Product Profitability export.
 *
 * The same report as Amazon USA's, downloaded from the UAE marketplace, and
 * it does not arrive in the same state. The US download names its columns
 * ("Units sold", "Referral fee total"); the UAE one came out with Amazon's
 * internal keys instead — `skucentral-amz-fees-card-units-sold` — two columns
 * with no heading at all, and `SC_FBA_SER_per_unit` repeated twice with every
 * cell empty.
 *
 * Both spellings are therefore accepted for every column that matters. A file
 * that Amazon exports properly tomorrow reads through the same code.
 *
 * The fee columns are simply absent from that export, which is why this
 * produces no fee breakdown. What Amazon took is stated once, as net sales
 * less Amazon's own Net proceeds, because that subtraction is a fact of the
 * file. Apportioning it across invented fee names would not be.
 */

/** Each column, named as the US download names it and as the UAE one does. */
const COLUMNS = {
  store: ['amazon store', 'sc_fba_calc_label_country'],
  startDate: ['start date', 'sc_fba_ser_start_date'],
  currency: ['currency code', 'sc_fba_ser_currency_code'],
  msku: ['msku'],
  unitsSold: ['units sold', 'skucentral-amz-fees-card-units-sold'],
  unitsReturned: ['units returned', 'skucentral-amz-fees-card-units-net-returned'],
  netUnitsSold: ['net units sold', 'skucentral-amz-fees-card-units-net-unit-sold-after-returns'],
  sales: ['sales', 'skucentral-amz-fees-card-sales'],
  netSales: ['net sales', 'skucentral-amz-fees-card-sales-net-returned'],
  netProceeds: ['net proceeds total', 'sc_fba_ser_total'],
}

/** The store code and currency the UAE marketplace exports. */
export const AMAZON_AE_STORE = 'AE'
export const AMAZON_AE_CURRENCY = 'AED'

const header = (h: string): string => h.trim().toLowerCase()

/**
 * The header this file actually uses for a column, out of the spellings both
 * downloads use.
 *
 * The UAE export repeats one heading and leaves two blank, but every column
 * that matters here has a name of its own, so reading by name loses nothing.
 * The repeated and blank ones are the per-unit columns, which carry no data
 * in this export and nothing below reads.
 */
function columnKey(headers: string[], candidates: string[]): string | null {
  return headers.find((h) => candidates.includes(header(h))) ?? null
}

const value = (row: Record<string, string>, key: string | null): string => (key === null ? '' : (row[key] ?? '').trim())

function num(row: Record<string, string>, key: string | null): number {
  const n = Number(value(row, key))
  return Number.isFinite(n) ? n : 0
}

/**
 * True when this is the UAE export rather than the US one.
 *
 * The two reports are otherwise the same and the downloaded file is named
 * with a random string, so nothing outside the file can tell them apart. The
 * store column can: the UAE marketplace writes `AE` and prices in `AED`.
 * Deciding by anything looser would land a UAE month inside Amazon USA, where
 * its dirhams would be read as dollars.
 */
export function detectAmazonUaeProductProfitability(headers: string[], rows: Record<string, string>[]): boolean {
  const storeCol = columnKey(headers, COLUMNS.store)
  const currencyCol = columnKey(headers, COLUMNS.currency)
  if (!columnKey(headers, COLUMNS.msku) || !columnKey(headers, COLUMNS.netSales)) return false
  return rows.some(
    (r) => value(r, storeCol).toUpperCase() === AMAZON_AE_STORE || value(r, currencyCol).toUpperCase() === AMAZON_AE_CURRENCY,
  )
}

/** The store and currency a Product Profitability file is for, so the upload
 * screen can say which marketplace it read rather than guessing at one. */
export function amazonStoreOf(headers: string[], rows: Record<string, string>[]): { store: string; currency: string } {
  const storeCol = columnKey(headers, COLUMNS.store)
  const currencyCol = columnKey(headers, COLUMNS.currency)
  const first = rows.find((r) => value(r, storeCol) !== '' || value(r, currencyCol) !== '')
  return {
    store: value(first ?? {}, storeCol).toUpperCase(),
    currency: value(first ?? {}, currencyCol).toUpperCase(),
  }
}

export interface AmazonUaeNormalizeResult extends NormalizeResult {
  facts: AmazonAePnlFacts
  month: string
}

export function normalizeAmazonUaeProductProfitability(
  headers: string[],
  rows: Record<string, string>[],
  skuMaster: SkuMaster[],
  importId: string,
): AmazonUaeNormalizeResult {
  const col = {
    startDate: columnKey(headers, COLUMNS.startDate),
    msku: columnKey(headers, COLUMNS.msku),
    unitsSold: columnKey(headers, COLUMNS.unitsSold),
    unitsReturned: columnKey(headers, COLUMNS.unitsReturned),
    netUnitsSold: columnKey(headers, COLUMNS.netUnitsSold),
    sales: columnKey(headers, COLUMNS.sales),
    netSales: columnKey(headers, COLUMNS.netSales),
    netProceeds: columnKey(headers, COLUMNS.netProceeds),
  }

  const validRecords: CanonicalSalesRecord[] = []
  const invalidRows: NormalizeResult['invalidRows'] = []
  const warnings: string[] = []
  const skuByCode = new Map(skuMaster.map((s) => [s.sku, s]))
  let unknownSkuCount = 0
  let detectedMonth = ''

  const facts: AmazonAePnlFacts = {
    month: '', schemaVersion: 1,
    grossSalesAed: 0, netSalesAed: 0, netProceedsAed: 0,
    unitsSoldQty: 0, unitsReturnedQty: 0, netUnitsSoldQty: 0,
    nonSellingRows: 0, cogsSourceInr: 0,
  }

  rows.forEach((row, rowIndex) => {
    const msku = value(row, col.msku)
    if (!msku) return invalidRows.push({ rowIndex, reason: 'Missing MSKU' })

    // Amazon writes this report the American way whichever marketplace it is
    // for: "09/01/2026" is 1 September. Read as an Indian date it would be
    // 9 January and the whole month would land in the wrong place.
    const startDateRaw = value(row, col.startDate)
    const startDate = parseReportDate(startDateRaw, 'us')
    if (startDate && !detectedMonth) {
      detectedMonth = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}`
    }

    const unitsSold = num(row, col.unitsSold)
    const netUnitsSold = num(row, col.netUnitsSold)
    const sales = num(row, col.sales)
    const netSales = num(row, col.netSales)
    const netProceeds = num(row, col.netProceeds)

    // A SKU that sold nothing can still be charged — storage accrues on stock
    // sitting in the warehouse, and Amazon counts it in Net proceeds. Three
    // rows of the owner's September file are like this. They are kept out of
    // the sales records, where a zero-quantity order line would be a fiction,
    // and their proceeds stay in the month, because the charge was real.
    const nonSelling = unitsSold === 0 && netUnitsSold === 0
    // Counted only where Amazon actually charged something. Most of the
    // non-selling rows are simply SKUs that were listed and did not sell,
    // which is not worth reporting; three of the owner's September rows were
    // charged while selling nothing, and those are.
    if (nonSelling && netProceeds !== 0) facts.nonSellingRows += 1

    const skuRecord = skuByCode.get(msku)
    if (!skuRecord && !nonSelling) unknownSkuCount++

    facts.grossSalesAed += sales
    facts.netSalesAed += netSales
    facts.netProceedsAed += netProceeds
    facts.unitsSoldQty += unitsSold
    facts.unitsReturnedQty += num(row, col.unitsReturned)
    facts.netUnitsSoldQty += netUnitsSold
    // Cost of goods is a rupee cost and stays in rupees, converted when the
    // statement is read at the month's rate — not frozen here at upload day's.
    facts.cogsSourceInr = (facts.cogsSourceInr ?? 0) + (skuRecord?.cogs ?? 0) * netUnitsSold

    if (nonSelling) return

    validRecords.push({
      orderId: `amazon_ae-${msku}-${startDateRaw || detectedMonth}`,
      orderDate: startDate ? toIsoDate(startDate) : `${detectedMonth}-01`,
      channel: 'amazon_ae',
      marketplace: 'amazon_ae',
      sellerType: 'seller_central',
      sku: msku,
      productName: skuRecord?.productName ?? msku,
      category: normalizeCategory(skuRecord?.category),
      quantity: netUnitsSold,
      grossSales: sales,
      discount: 0,
      netSales,
      returnUnits: num(row, col.unitsReturned),
      rtoUnits: 0,
      shippingCost: 0,
      // Everything Amazon took on this line. The export carries no split, so
      // this is the only honest figure to put here.
      marketplaceFee: netSales - netProceeds,
      tax: 0,
      isAggregate: true,
      status: 'completed',
      currency: 'AED',
      importId,
    } as CanonicalSalesRecord)
  })

  facts.month = detectedMonth

  if (unknownSkuCount > 0) {
    warnings.push(
      `${unknownSkuCount} MSKU(s) in this file have no cost on file, so their goods cost nothing in the statement. ` +
      'Add them to the Product Master, or link them on SKU Mapping, to price the month properly.',
    )
  }
  // Said once, on every upload, because it is the reason this channel has no
  // fee breakdown and a reader will otherwise assume one is coming.
  warnings.push(
    'Amazon exported this report without its fee columns — no referral fee, FBA fulfilment, storage or advertising. ' +
    'Everything Amazon took is therefore shown as one figure: net sales less the Net proceeds Amazon states. ' +
    'A download that carries the fee columns will break it down without changing any of these totals.',
  )

  return {
    facts,
    month: detectedMonth,
    validRecords,
    totalRows: rows.length,
    invalidRows,
    warnings,
  }
}
