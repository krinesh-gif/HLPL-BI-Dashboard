import type { CanonicalSalesRecord, SkuMaster } from '@/data/models'
import { getField, headersPresent, type NormalizeResult } from './types'

// Column names as they appear in Amazon Seller Central's "All Orders" / order
// report export. Multiple aliases are accepted per field since Amazon's report
// column names have varied slightly across report versions.
const COLUMNS = {
  orderId: ['amazon-order-id', 'order-id'],
  purchaseDate: ['purchase-date', 'order-date'],
  sku: ['sku', 'seller-sku'],
  productName: ['product-name', 'title'],
  quantity: ['quantity', 'quantity-purchased', 'item-quantity'],
  itemPrice: ['item-price'],
  itemPromotionDiscount: ['item-promotion-discount'],
  shippingPrice: ['shipping-price'],
  itemTax: ['item-tax'],
  orderStatus: ['order-status', 'item-status'],
}

export const REQUIRED_FIELDS: (keyof typeof COLUMNS)[] = ['orderId', 'purchaseDate', 'sku', 'quantity']

export function detectAmazonSellerCentralReport(headers: string[]): boolean {
  return (
    headersPresent(headers, COLUMNS.orderId) &&
    headersPresent(headers, COLUMNS.purchaseDate) &&
    headersPresent(headers, COLUMNS.sku)
  )
}

function mapOrderStatus(raw: string | undefined): CanonicalSalesRecord['status'] {
  const v = (raw ?? '').toLowerCase()
  if (v.includes('cancel')) return 'cancelled'
  if (v.includes('return')) return 'returned'
  if (v.includes('rto') || v.includes('refused')) return 'rto'
  if (v.includes('pending')) return 'pending'
  return 'completed'
}

export function normalizeAmazonSellerCentralRows(
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
    const purchaseDateRaw = getField(row, COLUMNS.purchaseDate)
    const sku = getField(row, COLUMNS.sku)
    const quantityRaw = getField(row, COLUMNS.quantity)

    if (!orderId) return invalidRows.push({ rowIndex, reason: 'Missing order ID' })
    if (!sku) return invalidRows.push({ rowIndex, reason: 'Missing SKU' })
    if (!purchaseDateRaw) return invalidRows.push({ rowIndex, reason: 'Missing purchase date' })

    const purchaseDate = new Date(purchaseDateRaw)
    if (Number.isNaN(purchaseDate.getTime())) return invalidRows.push({ rowIndex, reason: `Invalid date: "${purchaseDateRaw}"` })

    const quantity = Number(quantityRaw)
    if (!Number.isFinite(quantity) || quantity <= 0) return invalidRows.push({ rowIndex, reason: `Invalid quantity: "${quantityRaw}"` })

    const itemPrice = Number(getField(row, COLUMNS.itemPrice) ?? 0) || 0
    const discount = Math.abs(Number(getField(row, COLUMNS.itemPromotionDiscount) ?? 0) || 0)
    const shippingPrice = Number(getField(row, COLUMNS.shippingPrice) ?? 0) || 0
    const itemTax = Number(getField(row, COLUMNS.itemTax) ?? 0) || 0
    const grossSales = itemPrice * quantity

    if (itemPrice < 0) return invalidRows.push({ rowIndex, reason: `Invalid item price: "${getField(row, COLUMNS.itemPrice)}"` })

    const skuRecord = skuByCode.get(sku)
    if (!skuRecord) unknownSkuCount++

    const status = mapOrderStatus(getField(row, COLUMNS.orderStatus))

    validRecords.push({
      orderId,
      orderDate: purchaseDate.toISOString().slice(0, 10),
      channel: 'amazon_in_seller',
      marketplace: 'amazon_in_seller',
      sellerType: 'seller_central',
      sku,
      productName: getField(row, COLUMNS.productName) ?? skuRecord?.productName ?? sku,
      category: skuRecord?.category ?? 'Uncategorized',
      quantity,
      grossSales,
      discount,
      netSales: Math.max(0, grossSales - discount),
      returnUnits: status === 'returned' ? quantity : 0,
      rtoUnits: status === 'rto' ? quantity : 0,
      shippingCost: shippingPrice,
      marketplaceFee: 0, // not present in the order report; comes from a separate settlement/fee report
      tax: itemTax,
      status,
      currency: 'INR',
      raw: row,
      importId,
    })
  })

  const warnings: string[] = []
  if (unknownSkuCount > 0) warnings.push(`${unknownSkuCount} row(s) reference a SKU not found in the Product Master — categorized as "Uncategorized".`)

  return { validRecords, totalRows: rows.length, invalidRows, warnings }
}
