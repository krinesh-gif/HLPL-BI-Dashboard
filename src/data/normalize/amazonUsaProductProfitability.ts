import { NATIVE_PNL_ASSUMPTIONS } from '@/config/nativePnlAssumptions'
import type { AmazonUsaPnlFacts, CanonicalSalesRecord, SkuMaster } from '@/data/models'
import { getField, headersPresent, type NormalizeResult } from './types'
import { normalizeCategory } from '@/data/categories'

// Column names as they appear in Seller Central ▸ Reports ▸ Business Reports ▸
// Product Profitability (the real export inspected in
// Aravi_Amazon_USA_PnL_FY2627_v7.xlsx's "PASTE HERE" sheet). Amazon adds,
// removes and renames fee columns between months, so every "...total" column
// is matched by keyword rather than by fixed position — new/renamed fee
// columns fall into "Other Amazon fees" rather than being silently dropped.
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
}

interface FeeBucket {
  key: 'referralFeeUsd' | 'fbaFulfilmentFeeUsd' | 'storageAgedDisposalUsd' | 'couponDealFeesUsd' | 'refundAdminFeeUsd' | 'fbaReimbursementsUsd' | 'sponsoredProductsUsd' | 'otherAmazonFeesUsd'
  match: (headerLower: string) => boolean
}

// Order matters: more specific matchers (referral fee refunds, reimbursements)
// must be checked before their broader counterparts.
const FEE_BUCKETS: FeeBucket[] = [
  { key: 'fbaReimbursementsUsd', match: (h) => h.includes('reimbursement') },
  { key: 'sponsoredProductsUsd', match: (h) => h.includes('sponsored products') },
  { key: 'referralFeeUsd', match: (h) => h.includes('referral fee') },
  { key: 'fbaFulfilmentFeeUsd', match: (h) => h.includes('fulfillment fee') || h.includes('fulfilment fee') },
  { key: 'storageAgedDisposalUsd', match: (h) => h.includes('storage') || h.includes('aged inventory') || h.includes('disposal') },
  { key: 'couponDealFeesUsd', match: (h) => h.includes('coupon') },
  { key: 'refundAdminFeeUsd', match: (h) => h.includes('refund administration') },
]

export function detectAmazonUsaProductProfitabilityReport(headers: string[]): boolean {
  return headersPresent(headers, COLUMNS.msku) && headersPresent(headers, COLUMNS.netSales) && headersPresent(headers, COLUMNS.unitsSold)
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

  // Classify every "...total" column once, up front, from the header list.
  const totalColumns = headers.filter((h) => h.trim().toLowerCase().endsWith('total'))
  const columnBucket = new Map<string, FeeBucket['key']>()
  for (const col of totalColumns) {
    const lower = col.trim().toLowerCase()
    const bucket = FEE_BUCKETS.find((b) => b.match(lower))
    columnBucket.set(col, bucket?.key ?? 'otherAmazonFeesUsd')
  }

  // Resolve each simple column name once, rather than re-scanning `headers` per row.
  const resolve = (candidates: string[], fallback: string) =>
    headers.find((h) => candidates.includes(h.trim().toLowerCase())) ?? fallback
  const netUnitsSoldCol = resolve(COLUMNS.netUnitsSold, 'Net units sold')
  const unitsSoldCol = resolve(COLUMNS.unitsSold, 'Units sold')
  const unitsReturnedCol = resolve(COLUMNS.unitsReturned, 'Units returned')
  const salesCol = resolve(COLUMNS.sales, 'Sales')
  const netSalesCol = resolve(COLUMNS.netSales, 'Net sales')
  const startDateCol = headers.find((h) => COLUMNS.startDate.includes(h.trim().toLowerCase()))

  const facts: AmazonUsaPnlFacts = {
    month: '', grossSalesUsd: 0, netSalesUsd: 0, referralFeeUsd: 0, fbaFulfilmentFeeUsd: 0,
    storageAgedDisposalUsd: 0, couponDealFeesUsd: 0, refundAdminFeeUsd: 0, fbaReimbursementsUsd: 0,
    otherAmazonFeesUsd: 0, sponsoredProductsUsd: 0, cogsUsd: 0, freightUsd: 0,
    sponsoredBrandsUsd: 0, sponsoredDisplayDspUsd: 0, offAmazonAdsUsd: 0, exportDocsUsd: 0, usImportDutyUsd: 0,
    amazonSellingPlanUsd: 0, productLiabilityInsuranceUsd: 0, fdaLegalUsd: 0, agencySoftwareUsd: 0,
    otherOverheadUsd: 0, fxConversionCostPct: NATIVE_PNL_ASSUMPTIONS.fxConversionCostPct,
  }

  let nonSellingRowCount = 0

  rows.forEach((row, rowIndex) => {
    const msku = getField(row, COLUMNS.msku)
    if (!msku) return invalidRows.push({ rowIndex, reason: 'Missing MSKU' })

    const netUnitsSold = num(row, netUnitsSoldCol)
    const unitsSold = num(row, unitsSoldCol)
    if (unitsSold === 0 && netUnitsSold === 0) {
      nonSellingRowCount++
      return // non-selling SKU row this month — not an error, just excluded from sales facts
    }

    const sales = num(row, salesCol)
    const netSales = num(row, netSalesCol)

    const startDateRaw = startDateCol ? row[startDateCol] : undefined
    if (startDateRaw && !detectedMonth) {
      const d = new Date(startDateRaw)
      if (!Number.isNaN(d.getTime())) detectedMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    }

    const skuRecord = skuByCode.get(msku)
    if (!skuRecord) unknownSkuCount++
    // The Product Master's COGS is in INR; converted here at the configured
    // FX rate so AmazonUsaPnlFacts.cogsUsd stays in USD like every other fact.
    const cogsPerUnitUsd = (skuRecord?.cogs ?? 0) / NATIVE_PNL_ASSUMPTIONS.usdToInrRate

    facts.grossSalesUsd += sales
    facts.netSalesUsd += netSales
    facts.cogsUsd += cogsPerUnitUsd * netUnitsSold
    facts.freightUsd += (NATIVE_PNL_ASSUMPTIONS.indiaUsaFreightPerUnitInr / NATIVE_PNL_ASSUMPTIONS.usdToInrRate) * netUnitsSold
    for (const [col, bucket] of columnBucket) {
      facts[bucket] += Math.abs(num(row, col))
    }

    validRecords.push({
      orderId: `amazon_us-${msku}-${startDateRaw ?? detectedMonth}`,
      orderDate: startDateRaw ? new Date(startDateRaw).toISOString().slice(0, 10) : `${detectedMonth}-01`,
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
      status: 'completed',
      currency: 'USD',
      raw: row,
      importId,
    })
  })

  facts.month = detectedMonth

  const warnings: string[] = []
  if (unknownSkuCount > 0) warnings.push(`${unknownSkuCount} row(s) reference an MSKU not found in the Product Master — COGS could not be attributed for these.`)
  if (!detectedMonth) warnings.push('Could not detect the report month from a "Start date" column — facts were aggregated but the month key is empty.')
  if (nonSellingRowCount > 0) warnings.push(`${nonSellingRowCount} row(s) had zero units sold this month (non-selling SKUs) and were excluded from sales facts.`)

  return { validRecords, totalRows: rows.length, invalidRows, warnings, facts, month: detectedMonth }
}
