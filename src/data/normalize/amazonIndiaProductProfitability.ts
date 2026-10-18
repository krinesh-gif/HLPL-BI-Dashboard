import type { AmazonInSkuFeeFacts } from '@/data/models'
import { AMAZON_USA_FEE_COLUMNS } from '@/data/amazonUsa/feeColumns'
import { parseReportDate } from '@/lib/reportDate'
import type { NormalizeResult } from './types'
import {
  amazonPpColumn,
  amazonPpFeeColumns,
  amazonPpIsStore,
  amazonPpNestedFeeIds,
  amazonPpNum,
  isAmazonProductProfitabilityExport,
} from './amazonProductProfitability'

/**
 * Amazon India's Product Profitability export: Seller Central's month.
 *
 * The same report the US and UAE marketplaces send, in rupees, and read here
 * for the same reason — it states the whole month. Every SKU sold, its units,
 * its returns, its sales net of those returns, and every fee Amazon charged
 * it, column by column, against Amazon's own Net proceeds figure to check
 * them by.
 *
 * It was read for the fee detail alone until the settlements it was standing
 * beside turned out to cover two payment periods of six months' trading, and
 * Seller Central had been reporting ₹8,000 months against ₹2 lakh ones. The
 * settlement report is now what ties the statement to the cash Amazon
 * deposited rather than what states the month.
 *
 * No sales records: these are a month's facts, and a second set of order rows
 * for April would count April twice.
 *
 * It still answers the question a statement cannot — a referral fee of
 * ₹19,028 is a fact nobody can act on, the same ₹19,028 in three SKUs is a
 * pricing decision — which is what `feeBySkuInr` is for.
 */
const COLUMNS = {
  startDate: ['start date'],
  msku: ['msku'],
  unitsSold: ['units sold'],
  unitsReturned: ['units returned'],
  netUnitsSold: ['net units sold'],
  sales: ['sales'],
  netSales: ['net sales'],
  cogsPerUnit: ['cost of goods sold per unit'],
  miscCostPerUnit: ['miscellaneous cost per unit'],
  netProceeds: ['net proceeds total'],
}

/** The store code and currency the Indian marketplace exports. */
export const AMAZON_IN_STORE = 'IN'
export const AMAZON_IN_CURRENCY = 'INR'

/**
 * True when this is the Product Profitability export for the Indian store.
 *
 * Decided on the rows, like the other two: the column names are identical in
 * every marketplace, so nothing in the headers could tell them apart and a
 * header-only match would read rupees as dollars.
 */
export function detectAmazonIndiaProductProfitability(
  headers: string[],
  rows: Record<string, string>[],
): boolean {
  if (!isAmazonProductProfitabilityExport(headers)) return false
  // An export that names no store is the older US download, not this.
  if (amazonPpColumn(headers, ['amazon store', 'sc_fba_calc_label_country']) === null) return false
  return amazonPpIsStore(headers, rows, AMAZON_IN_STORE, AMAZON_IN_CURRENCY)
}

export interface AmazonIndiaSkuFeeResult extends NormalizeResult {
  facts: AmazonInSkuFeeFacts
  month: string
}

export function normalizeAmazonIndiaProductProfitability(
  headers: string[],
  rows: Record<string, string>[],
): AmazonIndiaSkuFeeResult {
  const invalidRows: NormalizeResult['invalidRows'] = []
  const warnings: string[] = []

  const { feeColumns, unmappedColumns } = amazonPpFeeColumns(headers)
  const col = (candidates: string[]) => amazonPpColumn(headers, candidates)
  const c = {
    startDate: col(COLUMNS.startDate),
    msku: col(COLUMNS.msku),
    unitsSold: col(COLUMNS.unitsSold),
    unitsReturned: col(COLUMNS.unitsReturned),
    netUnitsSold: col(COLUMNS.netUnitsSold),
    sales: col(COLUMNS.sales),
    netSales: col(COLUMNS.netSales),
    cogsPerUnit: col(COLUMNS.cogsPerUnit),
    miscCostPerUnit: col(COLUMNS.miscCostPerUnit),
    netProceeds: col(COLUMNS.netProceeds),
  }

  const feeTotalsInr: Record<string, number> = {}
  for (const fee of AMAZON_USA_FEE_COLUMNS) feeTotalsInr[fee.id] = 0
  const unmappedFeeTotalsInr: Record<string, number> = {}
  for (const h of unmappedColumns) unmappedFeeTotalsInr[h] = 0
  const feeBySkuInr: Record<string, Record<string, number>> = {}
  // Per SKU, so the month's goods can be costed from the cost sheet instead
  // of estimated: this export is the statement for the month, and a statement
  // with an estimated cost of goods has an estimated margin.
  const unitsBySku: Record<string, number> = {}
  const netSalesBySku: Record<string, number> = {}

  const facts: AmazonInSkuFeeFacts = {
    month: '', schemaVersion: 1,
    feeTotalsInr, unmappedFeeTotalsInr, feeBySkuInr, nestedFeeIds: [],
    unitsBySku, netSalesBySku,
    unitsSoldQty: 0, unitsReturnedQty: 0, netUnitsSoldQty: 0,
    grossSalesInr: 0, netSalesInr: 0, sheetNetProceedsInr: 0,
    sheetCogsInr: 0, sheetMiscCostInr: 0, nonSellingChargedRows: 0,
  }

  let detectedMonth = ''

  rows.forEach((row, rowIndex) => {
    const msku = c.msku === null ? '' : (row[c.msku] ?? '').trim()
    if (msku === '') return invalidRows.push({ rowIndex, reason: 'Missing MSKU' })

    // Amazon writes this report the American way in every marketplace:
    // "04/01/2026" is 1 April. Read the Indian way it would be 4 January and
    // the month would be the wrong one.
    const startDate = parseReportDate(c.startDate === null ? undefined : row[c.startDate], 'us')
    if (startDate && !detectedMonth) {
      detectedMonth = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}`
    }

    const unitsSold = amazonPpNum(row, c.unitsSold)
    const netUnitsSold = amazonPpNum(row, c.netUnitsSold)
    // Net of returns, because that is the stock that stayed sold and so the
    // units whose cost the month actually bore.
    if (netUnitsSold !== 0) unitsBySku[msku] = (unitsBySku[msku] ?? 0) + netUnitsSold
    const rowNetSales = amazonPpNum(row, c.netSales)
    if (rowNetSales !== 0) netSalesBySku[msku] = (netSalesBySku[msku] ?? 0) + rowNetSales

    facts.unitsSoldQty += unitsSold
    facts.unitsReturnedQty += amazonPpNum(row, c.unitsReturned)
    facts.netUnitsSoldQty += netUnitsSold
    facts.grossSalesInr += amazonPpNum(row, c.sales)
    facts.netSalesInr += rowNetSales
    facts.sheetNetProceedsInr += amazonPpNum(row, c.netProceeds)
    facts.sheetCogsInr += amazonPpNum(row, c.cogsPerUnit) * netUnitsSold
    facts.sheetMiscCostInr += amazonPpNum(row, c.miscCostPerUnit) * netUnitsSold

    // Fees keep the export's own sign: a charge positive, a credit negative.
    // A reimbursement and a referral-fee refund are money coming back, and
    // taking the magnitude would count them as money going out.
    let charged = 0
    for (const { header, id } of feeColumns) {
      const amount = amazonPpNum(row, header)
      feeTotalsInr[id] += amount
      charged += amount
      if (amount !== 0) {
        const bySku = (feeBySkuInr[msku] ??= {})
        bySku[id] = (bySku[id] ?? 0) + amount
      }
    }
    for (const h of unmappedColumns) {
      const amount = amazonPpNum(row, h)
      unmappedFeeTotalsInr[h] += amount
      charged += amount
    }

    // A SKU can be charged without selling anything: stock sits in the
    // warehouse and accrues, or a removal order is raised against it. Those
    // charges are the month's and are counted; the row simply has no sale.
    if (unitsSold === 0 && netUnitsSold === 0 && charged !== 0) facts.nonSellingChargedRows++
  })

  facts.month = detectedMonth
  facts.nestedFeeIds = amazonPpNestedFeeIds(rows, feeColumns)

  if (!detectedMonth) {
    warnings.push('Could not read the report month from a "Start date" column, so these fees have no month to sit in.')
  }
  const skuCount = Object.keys(feeBySkuInr).length
  warnings.push(
    `Read as Amazon India Seller Central's month: ${skuCount} SKU(s) across ${rows.length} rows, ` +
    `${facts.unitsSoldQty.toLocaleString('en-IN')} unit(s) sold and ₹${facts.netSalesInr.toFixed(2)} of net sales. ` +
    'This is the Seller Central statement for the month. It adds no order rows — the settlement report stays ' +
    'beside it as the tie to what Amazon actually deposited.',
  )
  if (facts.nonSellingChargedRows > 0) {
    warnings.push(
      `${facts.nonSellingChargedRows} SKU(s) were charged a fee without selling anything this month. Their charges ` +
      'are counted; they have no sales of their own.',
    )
  }
  if (unmappedColumns.length > 0) {
    const named = unmappedColumns.map((h) => (h.trim() === 'total' ? '(a fee block Amazon left unnamed)' : h.trim()))
    warnings.push(
      `${unmappedColumns.length} fee column(s) arrived without a heading this build recognises — they are counted and ` +
      `kept under the heading they came with rather than merged into another fee: ${named.join(', ')}.`,
    )
  }

  // Amazon computes its own Net proceeds, and checking against it is what
  // turns "these fees should be the month's fees" into "these fees are known
  // to be the month's fees".
  const nested = new Set(facts.nestedFeeIds)
  const countedFees =
    AMAZON_USA_FEE_COLUMNS.filter((f) => !nested.has(f.id)).reduce((sum, f) => sum + feeTotalsInr[f.id], 0)
    + Object.values(unmappedFeeTotalsInr).reduce((a, b) => a + b, 0)
  const gap = facts.netSalesInr - countedFees - facts.sheetCogsInr - facts.sheetMiscCostInr - facts.sheetNetProceedsInr
  if (Math.abs(gap) > 0.01) {
    warnings.push(
      `Net sales less every fee read differs from Amazon's own "Net proceeds total" by ₹${gap.toFixed(2)}, so some ` +
      'charge in this file has not been read. The per-SKU figures are short by that much.',
    )
  }

  return { facts, month: detectedMonth, validRecords: [], totalRows: rows.length, invalidRows, warnings }
}

/** What the month's fees came to, for a screen that needs one number: every
 * column that counts, with a contained one left to its parent. */
export function amazonInSkuFeesTotal(facts: AmazonInSkuFeeFacts): number {
  const nested = new Set(facts.nestedFeeIds)
  return (
    AMAZON_USA_FEE_COLUMNS.filter((f) => !nested.has(f.id)).reduce((sum, f) => sum + (facts.feeTotalsInr[f.id] ?? 0), 0)
    + Object.values(facts.unmappedFeeTotalsInr).reduce((a, b) => a + b, 0)
  )
}
