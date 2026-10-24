import type { CanonicalSalesRecord, SkuMaster } from '@/data/models'
import type { ComboComponent, SkuMapping } from '@/data/skuMapping'
import { normalizeCategory } from '@/data/categories'
import { getField, headersPresent, type NormalizeResult } from './types'

/**
 * Walmart Marketplace's item performance export, in US dollars.
 *
 * One row per item for the whole period — not per order — with GMV, units,
 * orders, page views and conversion, the cancelled and refunded money, and
 * `GMV - commission`, which is the only place any marketplace charge appears
 * in it. August is five items: $105.91 of GMV, 9 units, 8 orders, and $10.14
 * of commission read as the gap between GMV and `GMV - commission`.
 *
 * Three things decide how it is read.
 *
 * **It carries no date at all.** Not a column, not a header line, nothing —
 * the period lives in the Seller Center filter that produced it and in the
 * name of the download. So the month is asked for on upload rather than
 * guessed from a file name that may have been renamed, the same way
 * Flipkart's SKU P&L is handled. Every row is filed on the first of that
 * month and marked as an aggregate, so nothing counts it as one order on one
 * day.
 *
 * **It is in dollars.** The rows are stored in dollars, as Amazon USA's are,
 * and converted at the month's rate when the Master P&L reads them — so a
 * month with no rate on Monthly Inputs is visibly missing rather than
 * silently counted as rupees.
 *
 * **Commission is the one real charge in it.** `GMV - commission` is what
 * Walmart states, so the commission is the subtraction; it is kept as the
 * marketplace fee rather than being folded into net sales, which keeps the
 * revenue line comparable with every other channel's.
 */
const COLUMNS = {
  itemName: ['item name'],
  sku: ['sku'],
  gmv: ['gmv'],
  unitsSold: ['units sold'],
  orders: ['orders'],
  authSales: ['auth sales'],
  cancelledSales: ['cancelled sales'],
  refundSales: ['refund sales', 'refunded sales'],
  gmvLessCommission: ['gmv - commission', 'gmv-commission'],
  itemId: ['item id'],
  categories: ['categories'],
  brand: ['brand'],
  cancelledUnits: ['cancelled units'],
  aur: ['aur'],
}

const REQUIRED = ['sku', 'gmv', 'unitsSold'] as const

export function detectWalmartUsItemReport(headers: string[]): boolean {
  return REQUIRED.every((field) => headersPresent(headers, COLUMNS[field]))
    // GMV net of commission beside an auth-sales column is what makes this
    // Walmart's export rather than any other item summary.
    && headersPresent(headers, COLUMNS.gmvLessCommission)
    && headersPresent(headers, COLUMNS.authSales)
}

/** Walmart writes money as `$9.99` and percentages as `50.00%`. */
function num(raw: string | undefined): number {
  if (raw === undefined) return 0
  const text = raw.replace(/[$,%\s]/g, '')
  if (text === '' || text === '-') return 0
  const n = Number(text)
  return Number.isFinite(n) ? n : 0
}

export interface WalmartNormalizeResult extends NormalizeResult {
  month: string
  totals: {
    gmv: number
    cancelled: number
    refunded: number
    commission: number
    netSales: number
    units: number
    orders: number
  }
}

/** `month` (yyyy-mm) comes from the uploader: this export carries no date. */
export function normalizeWalmartUsItemReport(
  rows: Record<string, string>[],
  skuMaster: SkuMaster[],
  mappings: SkuMapping[],
  _comboComponents: ComboComponent[],
  month: string,
  importId: string,
): WalmartNormalizeResult {
  const validRecords: CanonicalSalesRecord[] = []
  const invalidRows: NormalizeResult['invalidRows'] = []
  const warnings: string[] = []

  const internalBySku = new Map(mappings.map((m) => [m.channelSku, m.internalSku]))
  const master = new Map(skuMaster.map((s) => [s.sku, s]))
  const unpriced = new Set<string>()
  const totals = { gmv: 0, cancelled: 0, refunded: 0, commission: 0, netSales: 0, units: 0, orders: 0 }

  rows.forEach((row, index) => {
    const field = (name: keyof typeof COLUMNS): string | undefined => getField(row, COLUMNS[name])
    const sku = (field('sku') ?? '').trim()
    if (!sku) {
      // The export ends with a blank line, which is not a row anybody needs
      // told about; a line with money on it and no SKU is.
      if (num(field('gmv')) > 0) invalidRows.push({ rowIndex: index, reason: 'Missing SKU' })
      return
    }

    const gmv = num(field('gmv'))
    const cancelled = num(field('cancelledSales'))
    const refunded = num(field('refundSales'))
    const lessCommission = num(field('gmvLessCommission'))
    // Walmart states the money after commission rather than the commission,
    // so the charge is the gap. A row with no such column states no charge,
    // which is not the same as being charged nothing — it reads as unknown.
    const commission = lessCommission > 0 ? Math.max(0, gmv - lessCommission) : 0
    const units = num(field('unitsSold'))
    const orders = num(field('orders'))
    // What was actually sold: the US has no GST to come out, so this is the
    // revenue line itself.
    const netSales = gmv - cancelled - refunded

    const internalSku = internalBySku.get(sku) ?? sku
    const product = master.get(internalSku) ?? master.get(sku)
    if (!product) unpriced.add(sku)

    totals.gmv += gmv
    totals.cancelled += cancelled
    totals.refunded += refunded
    totals.commission += commission
    totals.netSales += netSales
    totals.units += units
    totals.orders += orders

    validRecords.push({
      orderId: `walmart-${sku}-${month}`,
      orderDate: `${month}-01`,
      channel: 'walmart_us',
      marketplace: 'walmart_us',
      sellerType: 'marketplace',
      sku,
      productName: product?.productName ?? (field('itemName') ?? sku),
      category: normalizeCategory(product?.category ?? field('categories') ?? ''),
      quantity: units,
      grossSales: gmv,
      discount: 0,
      netSales,
      // Walmart reports refunds as money, not as units, so there is no unit
      // count to put here — saying 1 would be inventing one.
      returnUnits: 0,
      rtoUnits: 0,
      shippingCost: 0,
      marketplaceFee: commission,
      // No GST in the United States. The dollar figures are the whole of it.
      tax: 0,
      status: 'completed',
      currency: 'USD',
      // One row is the item's whole month, not an order: counting it as one
      // is what made Amazon USA read 35 orders and a ₹70.6K order value.
      isAggregate: true,
      importId,
    })
  })

  const usd = (v: number): string => `$${v.toFixed(2)}`
  warnings.push(
    `Filed under ${month}, the month chosen on upload: this export carries no date of its own, in any column or ` +
    'header. Check it against the period the Seller Center filter was set to.',
  )
  warnings.push(
    `${totals.orders} order(s), ${totals.units} unit(s): ${usd(totals.gmv)} of GMV less ${usd(totals.cancelled)} ` +
    `cancelled and ${usd(totals.refunded)} refunded is ${usd(totals.netSales)} of net sales, with ` +
    `${usd(totals.commission)} of Walmart commission read as the gap between GMV and "GMV - commission". ` +
    'Figures are stored in dollars and converted at the month\'s rate from Monthly Inputs.',
  )
  warnings.push(
    'One row per item for the whole period, not per order, so Daily Sales shows Walmart as a single point on the ' +
    'first of the month. Beyond commission the export states no fulfilment, shipping or payment charge and no ' +
    'payout, so what else Walmart took is missing, not zero.',
  )
  if (unpriced.size > 0) {
    const codes = [...unpriced].sort()
    const shown = codes.slice(0, 6).join(', ')
    const rest = codes.length - 6
    warnings.push(
      `${codes.length} Walmart SKU code(s) are not in the Product Master, so their goods cost nothing in the ` +
      `statement: ${shown}${rest > 0 ? ` and ${rest} more` : ''}. Link them on Catalogue ▸ SKU Mapping.`,
    )
  }

  return { validRecords, totalRows: rows.length, invalidRows, warnings, month, totals }
}
