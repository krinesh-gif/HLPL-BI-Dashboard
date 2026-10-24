import type { CanonicalSalesRecord, SkuMaster } from '@/data/models'
import type { ComboComponent, SkuMapping } from '@/data/skuMapping'
import { mappedCodeFor, resolveGstPct } from '@/data/skuMapping'
import { normalizeCategory } from '@/data/categories'
import { getField, headersPresent, type NormalizeResult } from './types'

/**
 * PharmEasy's monthly sales report.
 *
 * One row per order line, and unusually for a sales file it states both
 * sides of the trade: `seller_order_mrp` is what the shopper was charged and
 * `unit_selling_price` is what PharmEasy pays us for the unit, with
 * `unit_net_discount` the difference between them. The two tie on every row
 * of August — 349 = 202.42 + 146.58 — so the trade margin is read from the
 * file rather than assumed from an agreement, which is what makes this
 * channel's revenue a fact instead of a rate.
 *
 * That margin is not a fixed percentage: the foot roll-on goes at 42% off
 * MRP and the body wash at 14%, so applying one rate to the month would be
 * wrong by thousands. Each row carries its own.
 *
 * **`fulfilled_` is the real column family.** A cancelled row still shows
 * `received_gmv` and a full `unit_selling_price`, and only `fulfilled_qty`
 * and `fulfilled_gmv` fall to zero. August has 77 delivered rows against 23
 * cancelled or cancelling: read off `received_gmv` the month would have been
 * ₹42,918 of gross instead of ₹33,118, and the revenue overstated by a
 * third. A row that was not fulfilled keeps the gross PharmEasy billed and
 * earns no net.
 *
 * **The tax columns are per unit, not per line.** `igst` on a ₹349 line is
 * ₹30.88, which is the tax inside the ₹202.42 we are paid, not inside the
 * ₹349 the shopper paid. They are read as the per-unit figures they are, and
 * the rate the statement uses comes from the Product Master, with the file's
 * own `igst_percent` as the fallback where the Master has none.
 */
const COLUMNS = {
  orderId: ['c_order_id', 'order_id'],
  orderDate: ['order_placed_date', 'order placed date'],
  invoicedDate: ['invoiced_date'],
  status: ['order_status', 'order status'],
  sku: ['sku'],
  productName: ['product_name'],
  category: ['business_category'],
  mrp: ['seller_order_mrp'],
  unitSellingPrice: ['unit_selling_price'],
  unitNetDiscount: ['unit_net_discount'],
  fulfilledQty: ['fulfilled_qty'],
  fulfilledGmv: ['fulfilled_gmv'],
  receivedQty: ['received_qty'],
  receivedGmv: ['received_gmv'],
  returnQty: ['return_qty'],
  returnGmv: ['return_gmv'],
  cnrQty: ['cnr_qty'],
  cancellationReason: ['cancellation_reason'],
  igstPct: ['igst_percent'],
  cgstPct: ['cgst_percent'],
  sgstPct: ['sgst_percent'],
}

const REQUIRED = ['sku', 'fulfilledQty', 'unitSellingPrice', 'status'] as const

export function detectPharmeasySalesReport(headers: string[]): boolean {
  return REQUIRED.every((field) => headersPresent(headers, COLUMNS[field]))
    // The seller-side MRP beside a fulfilled quantity is what makes this
    // PharmEasy's file rather than any other order list.
    && headersPresent(headers, COLUMNS.mrp)
}

function num(raw: string | undefined): number {
  if (raw === undefined) return 0
  const text = raw.replace(/[₹,\s]/g, '')
  if (text === '' || text === '-' || text.toLowerCase() === 'null') return 0
  const n = Number(text)
  return Number.isFinite(n) ? n : 0
}

/** PharmEasy writes `dd-mm-yyyy`, day first as Indian reports are written,
 * and `null` where a cancelled line never got an invoice. */
export function pharmeasyDate(raw: string | undefined): string | null {
  const text = String(raw ?? '').trim()
  if (text === '' || text.toLowerCase() === 'null') return null
  const dmy = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(text)
  if (dmy) {
    const [, d, m, y] = dmy
    if (Number(m) < 1 || Number(m) > 12 || Number(d) < 1 || Number(d) > 31) return null
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text)
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null
}

export interface PharmeasyNormalizeResult extends NormalizeResult {
  months: string[]
  /** What the month came to, so the upload can be checked against the file. */
  totals: {
    fulfilledGmv: number
    receivedGmv: number
    sellerRevenueInclGst: number
    tradeDiscount: number
    fulfilledUnits: number
    cancelledRows: number
    cancelledGmv: number
  }
}

export function normalizePharmeasySalesReport(
  rows: Record<string, string>[],
  skuMaster: SkuMaster[],
  mappings: SkuMapping[],
  comboComponents: ComboComponent[],
  importId: string,
): PharmeasyNormalizeResult {
  const validRecords: CanonicalSalesRecord[] = []
  const invalidRows: NormalizeResult['invalidRows'] = []
  const warnings: string[] = []

  const internalBySku = new Map(mappings.map((m) => [m.channelSku, m.internalSku]))
  const master = new Map(skuMaster.map((s) => [s.sku, s]))
  const mappingTables = { skuMaster, mappings, comboComponents }
  const gstByCode = new Map<string, number | null>()
  const respelled = new Map<string, string>()
  const gstMissing = new Set<string>()
  const gstMismatch = new Set<string>()
  const mrpMismatchRows: number[] = []
  const monthsSeen = new Set<string>()
  const statuses = new Map<string, number>()

  const totals = {
    fulfilledGmv: 0, receivedGmv: 0, sellerRevenueInclGst: 0, tradeDiscount: 0,
    fulfilledUnits: 0, cancelledRows: 0, cancelledGmv: 0,
  }

  rows.forEach((row, index) => {
    const field = (name: keyof typeof COLUMNS): string | undefined => getField(row, COLUMNS[name])
    const sku = (field('sku') ?? '').trim()
    const date = pharmeasyDate(field('orderDate') ?? field('invoicedDate'))
    if (!sku && date === null) return
    if (date === null) {
      invalidRows.push({ rowIndex: index, reason: `Unreadable order date: "${field('orderDate') ?? ''}"` })
      return
    }
    if (!sku) {
      invalidRows.push({ rowIndex: index, reason: 'Missing sku' })
      return
    }

    const status = (field('status') ?? '').trim()
    statuses.set(status, (statuses.get(status) ?? 0) + 1)

    const fulfilledQty = num(field('fulfilledQty'))
    const fulfilledGmv = num(field('fulfilledGmv'))
    const receivedGmv = num(field('receivedGmv'))
    const mrp = num(field('mrp'))
    const unitPrice = num(field('unitSellingPrice'))
    const unitDiscount = num(field('unitNetDiscount'))
    const returnQty = num(field('returnQty'))

    // The file states the trade margin twice — as a price and as a discount
    // off MRP — so the two are checked against each other rather than one
    // being trusted. August ties on all 100 rows.
    if (mrp > 0 && Math.abs(mrp - unitPrice - unitDiscount) > 0.02) mrpMismatchRows.push(index + 2)

    // Read as the SKU map spells the code where only the separator differs.
    const code = mappedCodeFor(sku, mappingTables) ?? sku
    if (code !== sku) respelled.set(sku, code)

    let masterRate = gstByCode.get(code)
    if (masterRate === undefined) {
      masterRate = resolveGstPct(code, mappingTables)
      gstByCode.set(code, masterRate)
    }
    const statedRate = (num(field('igstPct')) || num(field('cgstPct')) + num(field('sgstPct'))) / 100
    if (masterRate !== null && statedRate > 0 && Math.abs(masterRate - statedRate) > 0.0001) gstMismatch.add(sku)
    const rate = masterRate ?? (statedRate > 0 ? statedRate : null)
    if (rate === null) gstMissing.add(sku)

    const internalSku = internalBySku.get(code) ?? code
    const product = master.get(internalSku) ?? master.get(sku)

    const sold = fulfilledQty > 0
    // What PharmEasy pays us for what was actually fulfilled, GST included.
    const revenueInclGst = unitPrice * fulfilledQty
    const gst = rate !== null ? revenueInclGst - revenueInclGst / (1 + rate) : 0

    totals.fulfilledGmv += fulfilledGmv
    totals.receivedGmv += receivedGmv
    totals.sellerRevenueInclGst += revenueInclGst
    totals.tradeDiscount += unitDiscount * fulfilledQty
    totals.fulfilledUnits += fulfilledQty
    if (!sold) {
      totals.cancelledRows += 1
      totals.cancelledGmv += receivedGmv
    }

    monthsSeen.add(date.slice(0, 7))

    validRecords.push({
      orderId: String(field('orderId') ?? `pharmeasy-${index}`),
      lineId: `${sku}-${index}`,
      orderDate: date,
      channel: 'pharmeasy',
      marketplace: 'pharmeasy',
      sellerType: 'marketplace',
      // Stored as the Product Master and SKU map spell it, so cost,
      // category and tax all resolve from one code.
      sku: code,
      productName: product?.productName ?? (field('productName') ?? sku),
      category: normalizeCategory(product?.category ?? field('category') ?? ''),
      quantity: fulfilledQty,
      // At the price the shopper was charged, with PharmEasy's trade margin
      // as the deduction from it — the margin is money we never receive, so
      // it belongs here and not below gross profit.
      grossSales: sold ? fulfilledGmv : receivedGmv,
      discount: sold ? unitDiscount * fulfilledQty : 0,
      netSales: sold ? revenueInclGst - gst : 0,
      returnUnits: returnQty > 0 ? returnQty : sold ? 0 : num(field('receivedQty')),
      rtoUnits: 0,
      shippingCost: 0,
      // Nothing: PharmEasy's margin is a trade discount off MRP, already in
      // `discount` above. Counting it here as well would charge it twice.
      marketplaceFee: 0,
      tax: sold ? gst : 0,
      // The gross is the shopper price, so the GST is inside it.
      taxInGross: true,
      status: sold ? 'completed' : status.toUpperCase().startsWith('CANCEL') ? 'cancelled' : 'returned',
      currency: 'INR',
      importId,
    })
  })

  const months = [...monthsSeen].sort()
  const inr = (v: number): string => `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

  if (months.length > 1) {
    warnings.push(
      `These rows cover ${months.length} months (${months.join(', ')}). Each is filed under its own order month; ` +
      'upload one month at a time if that was not intended.',
    )
  }
  warnings.push(
    `Read on order date, off the fulfilled columns. ${totals.fulfilledUnits} unit(s) fulfilled at ` +
    `${inr(totals.fulfilledGmv)} of shopper price, of which PharmEasy pays us ${inr(totals.sellerRevenueInclGst)} ` +
    `including GST — a trade margin of ${inr(totals.tradeDiscount)}, taken from each row's own ` +
    'unit_selling_price rather than from an agreed rate. ' +
    `${totals.cancelledRows} row(s) worth ${inr(totals.cancelledGmv)} were cancelled or are cancelling: they keep ` +
    'their gross and earn no net.',
  )
  warnings.push(
    'This is a sales report, not a settlement: beyond the trade margin it states no commission, no logistics ' +
    'charge, no payment fee and no payout. PharmEasy\'s statement runs to net sales and stops — anything further ' +
    'PharmEasy charges is missing, not zero.',
  )
  if (mrpMismatchRows.length > 0) {
    warnings.push(
      `${mrpMismatchRows.length} row(s) do not tie: seller_order_mrp is not unit_selling_price plus ` +
      `unit_net_discount (first at row ${mrpMismatchRows[0]}). The statement uses unit_selling_price, which is ` +
      'what PharmEasy pays; the discount column is the one to query.',
    )
  }
  if (respelled.size > 0) {
    const pairs = [...respelled.entries()].map(([file, mapped]) => `${file} → ${mapped}`)
    const shown = pairs.slice(0, 6).join(', ')
    const rest = pairs.length - 6
    warnings.push(
      `${pairs.length} PharmEasy code(s) differ from the SKU map only in their separators and were read as ` +
      `the map spells them: ${shown}${rest > 0 ? ` and ${rest} more` : ''}. Add the channel's spelling on ` +
      'Catalogue ▸ SKU Mapping to make it explicit.',
    )
  }
  if (gstMissing.size > 0) {
    const codes = [...gstMissing].sort()
    const shown = codes.slice(0, 8).join(', ')
    const rest = codes.length - 8
    warnings.push(
      `${codes.length} PharmEasy code(s) have no GST rate in the Product Master and none on the file, so their ` +
      `sales are shown with no tax taken out: ${shown}${rest > 0 ? ` and ${rest} more` : ''}. Set the rate on ` +
      'Catalogue ▸ Product Master.',
    )
  }
  if (gstMismatch.size > 0) {
    const codes = [...gstMismatch].sort()
    const shown = codes.slice(0, 8).join(', ')
    const rest = codes.length - 8
    warnings.push(
      `${codes.length} PharmEasy code(s) are invoiced on this file at a GST rate that differs from the Product ` +
      `Master: ${shown}${rest > 0 ? ` and ${rest} more` : ''}. The statement uses the Master, so one of the two ` +
      'is wrong on the invoice and it is worth raising with PharmEasy.',
    )
  }

  return { validRecords, totalRows: rows.length, invalidRows, warnings, months, totals }
}
