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
 * Amazon India's Product Profitability export, read for its fees and nothing
 * else.
 *
 * This is the same report the US and UAE marketplaces send, in rupees. What
 * makes India different is that the channel already has its numbers: sales
 * come from the All Orders report, and the statement comes from the settlement
 * report, which states what Amazon actually charged and settled rather than
 * estimating it per SKU. A second source for a month that already has one is
 * not a better statement, it is two statements.
 *
 * So this reads the one thing neither of those gives — **which SKUs carry
 * which fee** — and contributes to no total anywhere. No sales records: a
 * second set of sales rows for April would count April twice. No canonical
 * buckets, no P&L line, nothing the Master P&L reads.
 *
 * What it is for: a referral fee of ₹17,115 is a fact nobody can act on. The
 * same ₹17,115 sitting in three SKUs is a pricing decision.
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

  const facts: AmazonInSkuFeeFacts = {
    month: '', schemaVersion: 1,
    feeTotalsInr, unmappedFeeTotalsInr, feeBySkuInr, nestedFeeIds: [],
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

    facts.unitsSoldQty += unitsSold
    facts.unitsReturnedQty += amazonPpNum(row, c.unitsReturned)
    facts.netUnitsSoldQty += netUnitsSold
    facts.grossSalesInr += amazonPpNum(row, c.sales)
    facts.netSalesInr += amazonPpNum(row, c.netSales)
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
    `Read as Amazon India's per-SKU fees: ${skuCount} SKU(s) charged across ${rows.length} rows. This export adds no ` +
    'sales and no P&L line — Amazon India’s statement stays on the settlement report, which states what Amazon ' +
    'actually charged. It is read for which products carry which fee.',
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
