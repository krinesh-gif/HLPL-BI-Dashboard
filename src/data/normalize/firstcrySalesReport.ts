import type { CanonicalSalesRecord, SkuMaster } from '@/data/models'
import type { ComboComponent, SkuMapping } from '@/data/skuMapping'
import { mappedCodeFor, resolveGstPct } from '@/data/skuMapping'
import { normalizeCategory } from '@/data/categories'
import { getField, headersPresent, type NormalizeResult } from './types'

/**
 * FirstCry's monthly sales file — one sheet, `Sales Data`, one row per order
 * line.
 *
 * The columns are few and they do tie: `MRP Sales` is `MRP` × `Quantity` on
 * all 50 rows of August, and `Net Sales` is what the shopper paid after the
 * discount FirstCry ran. ₹27,850 of MRP went out at ₹19,882.
 *
 * **`Net Sales` is a shopper price, not a payout.** The name invites it to
 * be read as our realisation and it is not: the file states no commission,
 * no margin, no fulfilment charge and no settlement, so nothing has been
 * taken out of it. It is read as what it is — the sale, GST included — and
 * the statement runs to net sales and stops, with what FirstCry took shown
 * as not supplied rather than as nil.
 *
 * **Nothing in the file carries GST.** It comes from the Product Master, as
 * it does on every channel here, and the codes with no rate are named.
 *
 * **`stocktype` says CreditVendorStock on every row.** That is FirstCry
 * holding our stock on credit rather than having bought it, which is why
 * there is no purchase order and no payout in a sales file. It is reported
 * so a month that switches to outright purchase is noticed.
 */
const COLUMNS = {
  orderId: ['poid', 'po id'],
  orderDate: ['orderdate', 'order date'],
  productId: ['productid', 'product id'],
  brand: ['brand name'],
  businessType: ['business type'],
  qty: ['quantity', 'qty'],
  mrp: ['mrp'],
  mrpSales: ['mrp sales'],
  netSales: ['net sales'],
  subCategory: ['subcategoryname', 'sub category name'],
  category: ['categoryname', 'category name'],
  stockType: ['stocktype', 'stock type'],
  sku: ['vendorstylecode', 'vendor style code'],
}

const REQUIRED = ['orderDate', 'sku', 'qty', 'netSales'] as const

export function detectFirstcrySalesReport(headers: string[]): boolean {
  return REQUIRED.every((field) => headersPresent(headers, COLUMNS[field]))
    // A vendor style code beside an MRP Sales column is what makes this
    // FirstCry's file rather than any other order list.
    && headersPresent(headers, COLUMNS.mrpSales)
}

function num(raw: string | undefined): number {
  if (raw === undefined) return 0
  const text = raw.replace(/[₹,\s]/g, '')
  if (text === '' || text === '-') return 0
  const n = Number(text)
  return Number.isFinite(n) ? n : 0
}

/**
 * FirstCry writes `yyyy-mm-dd hh:mm:ss`, which is unambiguous, and the time
 * is dropped: a report date is a calendar date.
 */
export function firstcryDate(raw: string | undefined): string | null {
  const text = String(raw ?? '').trim()
  if (text === '') return null
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text)
  if (iso) {
    const [, y, m, d] = iso
    if (Number(m) < 1 || Number(m) > 12 || Number(d) < 1 || Number(d) > 31) return null
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  const dmy = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(text)
  if (dmy) {
    const [, d, m, y] = dmy
    if (Number(m) < 1 || Number(m) > 12 || Number(d) < 1 || Number(d) > 31) return null
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  return null
}

export interface FirstcryNormalizeResult extends NormalizeResult {
  months: string[]
  totals: { mrpSales: number; netSalesInclGst: number; units: number; orders: number; outputGst: number }
  /** Every `stocktype` the file used, so a change of model is noticed. */
  stockTypes: string[]
}

export function normalizeFirstcrySalesReport(
  rows: Record<string, string>[],
  skuMaster: SkuMaster[],
  mappings: SkuMapping[],
  comboComponents: ComboComponent[],
  importId: string,
): FirstcryNormalizeResult {
  const validRecords: CanonicalSalesRecord[] = []
  const invalidRows: NormalizeResult['invalidRows'] = []
  const warnings: string[] = []

  const internalBySku = new Map(mappings.map((m) => [m.channelSku, m.internalSku]))
  const master = new Map(skuMaster.map((s) => [s.sku, s]))
  const mappingTables = { skuMaster, mappings, comboComponents }
  const gstByCode = new Map<string, number | null>()
  const respelled = new Map<string, string>()
  const gstMissing = new Set<string>()
  const monthsSeen = new Set<string>()
  const orders = new Set<string>()
  const stockTypes = new Set<string>()
  const mrpMismatchRows: number[] = []
  const totals = { mrpSales: 0, netSalesInclGst: 0, units: 0, orders: 0, outputGst: 0 }

  rows.forEach((row, index) => {
    const field = (name: keyof typeof COLUMNS): string | undefined => getField(row, COLUMNS[name])
    const sku = (field('sku') ?? '').trim()
    const date = firstcryDate(field('orderDate'))
    if (!sku && date === null) return
    if (date === null) {
      invalidRows.push({ rowIndex: index, reason: `Unreadable order date: "${field('orderDate') ?? ''}"` })
      return
    }
    if (!sku) {
      invalidRows.push({ rowIndex: index, reason: 'Missing VendorStyleCode' })
      return
    }

    const qty = num(field('qty'))
    const mrp = num(field('mrp'))
    const mrpSales = num(field('mrpSales')) || mrp * qty
    const netInclGst = num(field('netSales'))
    // The file states MRP twice — per unit and per line — so the two are
    // checked against each other rather than one being trusted.
    if (mrp > 0 && qty > 0 && Math.abs(mrp * qty - mrpSales) > 0.02) mrpMismatchRows.push(index + 2)

    // Read as the SKU map spells the code where only the separator differs.
    const code = mappedCodeFor(sku, mappingTables) ?? sku
    if (code !== sku) respelled.set(sku, code)

    let rate = gstByCode.get(code)
    if (rate === undefined) {
      rate = resolveGstPct(code, mappingTables)
      gstByCode.set(code, rate)
    }
    if (rate === null) gstMissing.add(sku)
    const gst = rate !== null ? netInclGst - netInclGst / (1 + rate) : 0

    const internalSku = internalBySku.get(code) ?? code
    const product = master.get(internalSku) ?? master.get(sku)

    monthsSeen.add(date.slice(0, 7))
    orders.add(String(field('orderId') ?? index))
    stockTypes.add((field('stockType') ?? '').trim())
    totals.mrpSales += mrpSales
    totals.netSalesInclGst += netInclGst
    totals.outputGst += gst
    totals.units += qty

    validRecords.push({
      orderId: String(field('orderId') ?? `firstcry-${index}`),
      lineId: `${sku}-${index}`,
      orderDate: date,
      channel: 'firstcry',
      marketplace: 'firstcry',
      sellerType: 'marketplace',
      // Stored as the Product Master and SKU map spell it, so cost,
      // category and tax all resolve from one code.
      sku: code,
      productName: product?.productName ?? sku,
      category: normalizeCategory(product?.category ?? field('category') ?? ''),
      subCategory: field('subCategory'),
      quantity: qty,
      grossSales: mrpSales,
      discount: mrpSales > netInclGst ? mrpSales - netInclGst : 0,
      netSales: netInclGst - gst,
      returnUnits: 0,
      rtoUnits: 0,
      shippingCost: 0,
      // Nothing: the file states no commission. Missing, not zero.
      marketplaceFee: 0,
      tax: gst,
      // The gross is an MRP, so the GST is inside it, not charged on top.
      taxInGross: true,
      status: 'completed',
      currency: 'INR',
      importId,
    })
  })

  totals.orders = orders.size
  const months = [...monthsSeen].sort()
  const inr = (v: number): string => `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

  if (months.length > 1) {
    warnings.push(
      `These rows cover ${months.length} months (${months.join(', ')}). Each is filed under its own order month; ` +
      'upload one month at a time if that was not intended.',
    )
  }
  warnings.push(
    `Read on order date. ${totals.orders} order(s), ${totals.units} unit(s): ${inr(totals.netSalesInclGst)} of ` +
    `Net Sales including GST against ${inr(totals.mrpSales)} of MRP, with ${inr(totals.outputGst)} of GST taken ` +
    "out at each product's own rate from the Product Master.",
  )
  warnings.push(
    "FirstCry's \"Net Sales\" is the price the shopper paid after discount — nothing has been taken out of it for " +
    'FirstCry. This file states no commission, no margin, no fulfilment charge, no return and no payout, so the ' +
    'statement runs to net sales and stops: what FirstCry took is missing, not zero.',
  )
  const types = [...stockTypes].filter(Boolean)
  if (types.length > 0 && !(types.length === 1 && types[0] === 'CreditVendorStock')) {
    warnings.push(
      `This file's stocktype is ${types.join(', ')} rather than CreditVendorStock alone. On outright purchase the ` +
      'money works differently — FirstCry buys the stock — so check how the month should be read before relying ' +
      'on it.',
    )
  }
  if (mrpMismatchRows.length > 0) {
    warnings.push(
      `${mrpMismatchRows.length} row(s) do not tie: MRP × Quantity is not MRP Sales (first at row ` +
      `${mrpMismatchRows[0]}). The statement uses MRP Sales.`,
    )
  }
  if (respelled.size > 0) {
    const pairs = [...respelled.entries()].map(([file, mapped]) => `${file} → ${mapped}`)
    const shown = pairs.slice(0, 6).join(', ')
    const rest = pairs.length - 6
    warnings.push(
      `${pairs.length} FirstCry code(s) differ from the SKU map only in their separators and were read as ` +
      `the map spells them: ${shown}${rest > 0 ? ` and ${rest} more` : ''}. Add the channel's spelling on ` +
      'Catalogue ▸ SKU Mapping to make it explicit.',
    )
  }
  if (gstMissing.size > 0) {
    const codes = [...gstMissing].sort()
    const shown = codes.slice(0, 8).join(', ')
    const rest = codes.length - 8
    warnings.push(
      `${codes.length} FirstCry code(s) have no GST rate in the Product Master — and this file carries none — so ` +
      `their sales are shown with no tax taken out: ${shown}${rest > 0 ? ` and ${rest} more` : ''}. Set the rate ` +
      'on Catalogue ▸ Product Master.',
    )
  }

  return { validRecords, totalRows: rows.length, invalidRows, warnings, months, totals, stockTypes: types }
}
