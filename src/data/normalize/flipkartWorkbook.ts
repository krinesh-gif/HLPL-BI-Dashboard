import { mergeHeaderRows, rowsToRecords, type RawSheet } from '@/lib/csvParse'
import type { CanonicalSalesRecord, FlipkartPnlFacts, SkuMaster } from '@/data/models'
import { getField, type NormalizeResult } from './types'
import { normalizeCategory } from '@/data/categories'
import { toIsoDate } from '@/lib/format'

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

export function detectFlipkartWorkbook(sheetNames: string[]): boolean {
  const normalized = sheetNames.map((s) => s.trim().toLowerCase())
  return normalized.includes('overall summary') && normalized.includes('orders p&l')
}

function extractMonthFromSummary(map: Map<string, number | string>): string {
  const range = map.get('orders recieved during') ?? map.get('orders received during')
  if (typeof range !== 'string') return ''
  const startPart = range.split(' to ')[0]?.trim()
  const d = new Date(startPart)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function buildFactsFromOverallSummary(summarySheet: RawSheet): { facts: Omit<FlipkartPnlFacts, 'cogsPriced' | 'cogsUnpriced'>; month: string } {
  const map = parseLabelValueSheet(summarySheet)
  const month = extractMonthFromSummary(map)

  const catchallSum = CATCHALL_LABELS.reduce((sum, label) => sum + num(map, label), 0)

  return {
    month,
    facts: {
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
    },
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
  const summarySheet = sheets['Overall Summary']
  const ordersSheet = sheets['Orders P&L']
  const { facts: partialFacts, month } = buildFactsFromOverallSummary(summarySheet)

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

    const orderDate = new Date(orderDateRaw)
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

  return {
    validRecords,
    totalRows: rows.length,
    invalidRows,
    warnings,
    month,
    facts: { ...partialFacts, cogsPriced, cogsUnpriced },
  }
}
