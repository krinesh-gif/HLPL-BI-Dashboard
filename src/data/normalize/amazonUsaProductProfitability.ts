import { NATIVE_PNL_ASSUMPTIONS } from '@/config/nativePnlAssumptions'
import type { AmazonUsaPnlFacts, CanonicalSalesRecord, SkuMaster } from '@/data/models'
import { AMAZON_USA_FEE_COLUMNS } from '@/data/amazonUsa/feeColumns'
import { getField, headersPresent, type NormalizeResult } from './types'
import { normalizeCategory } from '@/data/categories'
import { toIsoDate } from '@/lib/format'
import { parseReportDate } from '@/lib/reportDate'
import { amazonPpFeeColumns, amazonPpIsStore, amazonPpNestedFeeIds } from './amazonProductProfitability'

// Column names as they appear in Seller Central ▸ Reports ▸ Business Reports ▸
// Product Profitability. Amazon changes both the number and the order of the
// fee columns between months — the four months in
// Aravi_Amazon_USA_PnL_FY2627_v7.xlsx carry 66, 66, 72 and 78 columns — so
// every column is found by its header text and never by position.
const COLUMNS = {
  msku: ['msku'],
  startDate: ['start date'],
  currencyCode: ['currency code'],
  unitsSold: ['units sold'],
  unitsReturned: ['units returned'],
  netUnitsSold: ['net units sold'],
  sales: ['sales'],
  netSales: ['net sales'],
  cogsPerUnit: ['cost of goods sold per unit'],
  miscCostPerUnit: ['miscellaneous cost per unit'],
  netProceeds: ['net proceeds total'],
}

/**
 * True when this is the Product Profitability export **for the US store**.
 *
 * The header names are the same in every marketplace, so matching on them
 * alone claimed any store's export for Amazon USA. An Indian export reached
 * this detector as a US one and its rupees would have been read as dollars —
 * ₹1.82 lakh of April net sales booked as $182,052, about ₹1.6 crore, in a
 * channel it has nothing to do with. The rows are what tell the stores apart.
 */
/** The store code and currency the US marketplace exports. */
export const AMAZON_US_STORE = 'US'
export const AMAZON_US_CURRENCY = 'USD'

export function detectAmazonUsaProductProfitabilityReport(
  headers: string[],
  rows: Record<string, string>[],
): boolean {
  if (!headersPresent(headers, COLUMNS.msku) || !headersPresent(headers, COLUMNS.netSales)) return false
  if (!headersPresent(headers, COLUMNS.unitsSold)) return false
  return amazonPpIsStore(headers, rows, AMAZON_US_STORE, AMAZON_US_CURRENCY)
}

function num(row: Record<string, string>, key: string): number {
  const n = Number(row[key])
  return Number.isFinite(n) ? n : 0
}

export interface AmazonUsaNormalizeResult extends NormalizeResult {
  facts: AmazonUsaPnlFacts
  month: string
}

export function normalizeAmazonUsaProductProfitability(
  headers: string[],
  rows: Record<string, string>[],
  skuMaster: SkuMaster[],
  importId: string,
): AmazonUsaNormalizeResult {
  const validRecords: CanonicalSalesRecord[] = []
  const invalidRows: NormalizeResult['invalidRows'] = []
  const skuByCode = new Map(skuMaster.map((s) => [s.sku, s]))
  let unknownSkuCount = 0
  let detectedMonth = ''

  // Every "... total" column, matched to the fee it names. Shared with the
  // Indian export, which is the same report with the same fee blocks.
  const { feeColumns, unmappedColumns } = amazonPpFeeColumns(headers)

  // Resolve each simple column name once, rather than re-scanning `headers` per row.
  const resolve = (candidates: string[], fallback: string) =>
    headers.find((h) => candidates.includes(h.trim().toLowerCase())) ?? fallback
  const netUnitsSoldCol = resolve(COLUMNS.netUnitsSold, 'Net units sold')
  const unitsSoldCol = resolve(COLUMNS.unitsSold, 'Units sold')
  const unitsReturnedCol = resolve(COLUMNS.unitsReturned, 'Units returned')
  const salesCol = resolve(COLUMNS.sales, 'Sales')
  const netSalesCol = resolve(COLUMNS.netSales, 'Net sales')
  const cogsPerUnitCol = resolve(COLUMNS.cogsPerUnit, 'Cost of goods sold per unit')
  const miscCostPerUnitCol = resolve(COLUMNS.miscCostPerUnit, 'Miscellaneous cost per unit')
  const netProceedsCol = resolve(COLUMNS.netProceeds, 'Net proceeds total')
  const startDateCol = headers.find((h) => COLUMNS.startDate.includes(h.trim().toLowerCase()))

  const feeTotalsUsd: Record<string, number> = {}
  for (const c of AMAZON_USA_FEE_COLUMNS) feeTotalsUsd[c.id] = 0
  const unmappedFeeTotalsUsd: Record<string, number> = {}
  for (const h of unmappedColumns) unmappedFeeTotalsUsd[h] = 0
  // The same numbers kept per SKU. A month's total says a fee was charged; only
  // the per-SKU split says which products are causing it, which is the
  // difference between seeing a cost and being able to act on it.
  const feeBySkuUsd: Record<string, Record<string, number>> = {}

  const facts: AmazonUsaPnlFacts = {
    month: '', schemaVersion: 2,
    unitsSoldQty: 0, unitsReturnedQty: 0, netUnitsSoldQty: 0,
    feeTotalsUsd, unmappedFeeTotalsUsd, feeBySkuUsd,
    sheetCogsUsd: 0, sheetMiscCostUsd: 0, sheetNetProceedsUsd: 0,
    grossSalesUsd: 0, netSalesUsd: 0, referralFeeUsd: 0, fbaFulfilmentFeeUsd: 0,
    storageAgedDisposalUsd: 0, couponDealFeesUsd: 0, refundAdminFeeUsd: 0, fbaReimbursementsUsd: 0,
    otherAmazonFeesUsd: 0, sponsoredProductsUsd: 0, cogsUsd: 0, freightUsd: 0,
    sponsoredBrandsUsd: 0, sponsoredDisplayDspUsd: 0, offAmazonAdsUsd: 0, exportDocsUsd: 0, usImportDutyUsd: 0,
  }

  let nonSellingRowCount = 0

  rows.forEach((row, rowIndex) => {
    const msku = getField(row, COLUMNS.msku)
    if (!msku) return invalidRows.push({ rowIndex, reason: 'Missing MSKU' })

    const netUnitsSold = num(row, netUnitsSoldCol)
    const unitsSold = num(row, unitsSoldCol)
    // A SKU that sold nothing this month can still be charged: storage, aged
    // inventory and disposal all accrue on stock sitting in the warehouse, and
    // Amazon counts them in Net proceeds. Such a row is excluded from the sales
    // records — a zero-quantity order line would be a fiction — but its fees
    // belong to the month. Skipping the row wholesale, as this used to, quietly
    // understated July's charges by $84.22.
    const nonSelling = unitsSold === 0 && netUnitsSold === 0
    if (nonSelling) nonSellingRowCount++

    const sales = num(row, salesCol)
    const netSales = num(row, netSalesCol)

    // Amazon writes this report the American way: "6/1/2026" is 1 June, and
    // the band it belongs to is June 2026. Read as an Indian date it would be
    // 6 January and the whole month would land in the wrong place.
    const startDateRaw = startDateCol ? row[startDateCol] : undefined
    const startDate = parseReportDate(startDateRaw, 'us')
    if (startDate && !detectedMonth) {
      detectedMonth = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}`
    }

    const skuRecord = skuByCode.get(msku)
    if (!skuRecord) unknownSkuCount++
    // Cost of goods and freight are rupee costs. They are carried in rupees
    // and converted at the month's rate when the statement is read — not
    // converted here and frozen, which left the statement half-converted at
    // upload day's rate and half at the reader's.
    const cogsPerUnitInr = skuRecord?.cogs ?? 0

    facts.grossSalesUsd += sales
    facts.netSalesUsd += netSales
    facts.unitsSoldQty = (facts.unitsSoldQty ?? 0) + unitsSold
    facts.unitsReturnedQty = (facts.unitsReturnedQty ?? 0) + num(row, unitsReturnedCol)
    facts.netUnitsSoldQty = (facts.netUnitsSoldQty ?? 0) + netUnitsSold
    facts.cogsSourceInr = (facts.cogsSourceInr ?? 0) + cogsPerUnitInr * netUnitsSold
    facts.freightSourceInr = (facts.freightSourceInr ?? 0) + NATIVE_PNL_ASSUMPTIONS.indiaUsaFreightPerUnitInr * netUnitsSold
    // Fees keep the export's own sign. Taking the magnitude, as this used to,
    // turned every credit into a charge — a reimbursement and a referral-fee
    // refund are money coming back, and were being counted as money going out.
    for (const { header, id } of feeColumns) {
      const amount = num(row, header)
      feeTotalsUsd[id] += amount
      if (amount !== 0) {
        const bySku = (feeBySkuUsd[msku] ??= {})
        bySku[id] = (bySku[id] ?? 0) + amount
      }
    }
    for (const h of unmappedColumns) unmappedFeeTotalsUsd[h] += num(row, h)
    // Amazon nets the seller's own per-unit costs off Net proceeds, so they are
    // carried here to reconcile against the export's own figure.
    facts.sheetCogsUsd = (facts.sheetCogsUsd ?? 0) + num(row, cogsPerUnitCol) * netUnitsSold
    facts.sheetMiscCostUsd = (facts.sheetMiscCostUsd ?? 0) + num(row, miscCostPerUnitCol) * netUnitsSold
    facts.sheetNetProceedsUsd = (facts.sheetNetProceedsUsd ?? 0) + num(row, netProceedsCol)

    if (nonSelling) return

    validRecords.push({
      orderId: `amazon_us-${msku}-${startDateRaw ?? detectedMonth}`,
      orderDate: startDate ? toIsoDate(startDate) : `${detectedMonth}-01`,
      channel: 'amazon_us',
      marketplace: 'amazon_us',
      sellerType: 'seller_central',
      sku: msku,
      productName: skuRecord?.productName ?? msku,
      category: normalizeCategory(skuRecord?.category),
      quantity: netUnitsSold,
      grossSales: sales,
      discount: 0,
      netSales,
      returnUnits: num(row, unitsReturnedCol),
      rtoUnits: 0,
      shippingCost: 0,
      marketplaceFee: sales - netSales,
      tax: 0,
      isAggregate: true,
      status: 'completed',
      currency: 'USD',
      raw: row,
      importId,
    })
  })

  facts.month = detectedMonth

  // Which columns this file proves are contained in another, tested row by
  // row against the file just uploaded rather than assumed.
  const nested = amazonPpNestedFeeIds(rows, feeColumns)
  facts.nestedFeeIds = nested

  const warnings: string[] = []
  if (unknownSkuCount > 0) warnings.push(`${unknownSkuCount} row(s) reference an MSKU not found in the Product Master — COGS could not be attributed for these.`)
  if (!detectedMonth) warnings.push('Could not detect the report month from a "Start date" column — facts were aggregated but the month key is empty.')
  if (nonSellingRowCount > 0) warnings.push(`${nonSellingRowCount} row(s) had zero units sold this month (non-selling SKUs). Their storage, aged-inventory and disposal fees are counted; no sales record was created for them.`)
  if (unmappedColumns.length > 0) {
    warnings.push(`Amazon exported ${unmappedColumns.length} fee column(s) this build does not recognise — they are counted and shown on their own line, not merged into another fee: ${unmappedColumns.join(', ')}.`)
  }
  // The export computes its own Net proceeds. Checking against it here is what
  // turns "the statement should tie" into "the statement is known to tie".
  const nestedSet = new Set(nested)
  const computedNetProceeds =
    facts.netSalesUsd
    - AMAZON_USA_FEE_COLUMNS.filter((c) => !nestedSet.has(c.id)).reduce((sum, c) => sum + (feeTotalsUsd[c.id] ?? 0), 0)
    - Object.values(unmappedFeeTotalsUsd).reduce((a, b) => a + b, 0)
    - (facts.sheetCogsUsd ?? 0) - (facts.sheetMiscCostUsd ?? 0)
  const proceedsGap = computedNetProceeds - (facts.sheetNetProceedsUsd ?? 0)
  if (Math.abs(proceedsGap) > 0.01) {
    warnings.push(`Net proceeds computed from the fee columns differs from the export's own "Net proceeds total" by ${proceedsGap.toFixed(2)} USD.`)
  }

  return { validRecords, totalRows: rows.length, invalidRows, warnings, facts, month: detectedMonth }
}
