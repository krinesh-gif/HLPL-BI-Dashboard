import type { CanonicalSalesRecord, SkuMaster } from '@/data/models'
import { getField, headersPresent, type NormalizeResult } from './types'
import { normalizeCategory } from '@/data/categories'

// Column names as they appear in Meesho's raw "Order Summary" export
// (Sub orderId, Catalog ID, Quantity, Price, Order Date, Order Status,
// Payout Value, Payout Status, Claim Status, SKU ID). No fee breakdown —
// good for Sales/SKU analytics; use the Meesho Settlement Data (JSON) import
// for the native channel P&L.
const COLUMNS = {
  orderId: ['sub orderid', 'sub order id'],
  sku: ['sku id', 'sku'],
  quantity: ['quantity'],
  price: ['price'],
  orderDate: ['order date'],
  orderStatus: ['order status'],
  payoutValue: ['payout value'],
}

export function detectMeeshoOrderSummaryReport(headers: string[]): boolean {
  return headersPresent(headers, COLUMNS.orderId) && headersPresent(headers, COLUMNS.sku) && headersPresent(headers, COLUMNS.payoutValue)
}

function mapStatus(raw: string | undefined): CanonicalSalesRecord['status'] {
  const v = (raw ?? '').toLowerCase()
  if (v.includes('cancel')) return 'cancelled'
  if (v.includes('rto')) return 'rto'
  if (v.includes('return')) return 'returned'
  if (v.includes('pending') || v === '') return 'pending'
  return 'completed'
}

export function normalizeMeeshoOrderSummary(
  rows: Record<string, string>[],
  skuMaster: SkuMaster[],
  importId: string,
): NormalizeResult {
  const validRecords: CanonicalSalesRecord[] = []
  const invalidRows: NormalizeResult['invalidRows'] = []
  const skuByCode = new Map(skuMaster.map((s) => [s.sku, s]))
  let unknownSkuCount = 0

  rows.forEach((row, rowIndex) => {
    const orderId = getField(row, COLUMNS.orderId)
    const sku = getField(row, COLUMNS.sku)
    const orderDateRaw = getField(row, COLUMNS.orderDate)
    const quantityRaw = getField(row, COLUMNS.quantity)

    if (!orderId) return invalidRows.push({ rowIndex, reason: 'Missing Sub orderId' })
    if (!sku) return invalidRows.push({ rowIndex, reason: 'Missing SKU ID' })
    if (!orderDateRaw) return invalidRows.push({ rowIndex, reason: 'Missing Order Date' })

    const orderDate = new Date(orderDateRaw)
    if (Number.isNaN(orderDate.getTime())) return invalidRows.push({ rowIndex, reason: `Invalid date: "${orderDateRaw}"` })

    const quantity = Number(quantityRaw)
    if (!Number.isFinite(quantity) || quantity <= 0) return invalidRows.push({ rowIndex, reason: `Invalid quantity: "${quantityRaw}"` })

    const price = Number(getField(row, COLUMNS.price) ?? 0) || 0
    const payoutValue = Number(getField(row, COLUMNS.payoutValue) ?? 0) || 0
    const status = mapStatus(getField(row, COLUMNS.orderStatus))
    const skuRecord = skuByCode.get(sku)
    if (!skuRecord) unknownSkuCount++

    validRecords.push({
      orderId,
      orderDate: orderDate.toISOString().slice(0, 10),
      channel: 'meesho',
      marketplace: 'meesho',
      sellerType: 'marketplace',
      sku,
      productName: skuRecord?.productName ?? sku,
      category: normalizeCategory(skuRecord?.category),
      quantity,
      grossSales: price * quantity,
      discount: 0,
      netSales: Math.max(0, payoutValue),
      returnUnits: status === 'returned' ? quantity : 0,
      rtoUnits: status === 'rto' ? quantity : 0,
      shippingCost: 0,
      marketplaceFee: Math.max(0, price * quantity - payoutValue),
      tax: 0,
      status,
      currency: 'INR',
      raw: row,
      importId,
    })
  })

  const warnings: string[] = []
  if (unknownSkuCount > 0) warnings.push(`${unknownSkuCount} row(s) reference a SKU not found in the Product Master — categorized as "Uncategorized".`)
  warnings.push('This report has no fee breakdown — marketplace fee is estimated as Price minus Payout Value. Upload Meesho Settlement Data (JSON) for the real channel P&L.')

  return { validRecords, totalRows: rows.length, invalidRows, warnings }
}
