import type { CanonicalSalesRecord, SkuMaster } from '@/data/models'
import type { ComboComponent, SkuMapping } from '@/data/skuMapping'
import { mappedCodeFor, resolveGstPct } from '@/data/skuMapping'
import { normalizeCategory } from '@/data/categories'
import { getField, headersPresent, type NormalizeResult } from './types'

/**
 * Unicommerce's Sale Orders export, which is how the D2C website is read.
 *
 * The website is a Shopify store, and Shopify is the better record of what a
 * customer paid — but it never learns what happened to the parcel. Shiprocket
 * ships the orders and writes nothing back: across 16,800 orders the store has
 * recorded 101 refunds, 0.6%, while this file shows 8.2% of September going to
 * RTO and returns. So the channel is read from Unicommerce, which is the only
 * system that holds both the money and the outcome.
 *
 * **One row is one unit.** There is no quantity column anywhere in the export.
 * Two of the same product in one order are two rows, with the order's discount
 * split across them — ₹253.83 and ₹223.48 for the same body lotion in the same
 * order. Reading a row as a line and multiplying by anything would double it.
 *
 * **The date column is not what its name says.** It is headed "Order Date as
 * dd/mm/yyyy hh:MM:ss" and the export writes `8/30/2026` — month first. Taking
 * the header at its word reads 30 August as the 8th of an impossible 30th
 * month, and any date before the 13th would land in the wrong month without
 * anything looking wrong. The order is therefore worked out from the file's
 * own values rather than from the header or from the engine's guess.
 *
 * **The tax columns are the reliable ones; `taxable value` is not.** It is
 * blank on 372 of September's 548 rows, while CGST, SGST and IGST are filled
 * on every one. Net is therefore what the customer paid less the GST actually
 * stated, which also ties to the rate in `GST Tax Type Code` on every row.
 *
 * **`Total Price` includes the shipping the customer was charged.** It runs
 * ₹29 above `Selling Price` on the rows that carry delivery — ₹2,117 across
 * September. That is money the customer paid us, so it stays in revenue; the
 * courier's own bill is a cost and arrives on the courier's invoice.
 *
 * **And the export is not only the website.** Unicommerce holds every channel,
 * so a file pulled without a channel filter would book Flipkart's and Amazon's
 * orders a second time under D2C. Only the website's rows are read, and any
 * other channel in the file is named and skipped.
 */
const COLUMNS = {
  orderCode: ['sale order code'],
  orderDate: ['order date as dd/mm/yyyy hh:mm:ss', 'order date'],
  status: ['sale order status'],
  courierStatus: ['shipping courier status'],
  trackingStatus: ['shipping tracking status'],
  channel: ['channel name'],
  sku: ['item sku code'],
  sellerSku: ['seller sku code'],
  itemName: ['item type name'],
  hsn: ['hsn code'],
  mrp: ['mrp'],
  totalPrice: ['total price'],
  sellingPrice: ['selling price'],
  subtotal: ['subtotal'],
  discount: ['discount'],
  taxableValue: ['taxable value'],
  gstRate: ['gst tax type code'],
  cgst: ['cgst'],
  sgst: ['sgst'],
  igst: ['igst'],
  utgst: ['utgst'],
  shippingProvider: ['shipping provider'],
  courier: ['shipping courier'],
  dispatchDate: ['dispatch date'],
  city: ['shipping address city'],
  state: ['shipping address state'],
}

const REQUIRED = ['orderCode', 'sku', 'totalPrice', 'courierStatus'] as const

export function detectUnicommerceSaleOrders(headers: string[]): boolean {
  return REQUIRED.every((field) => headersPresent(headers, COLUMNS[field]))
    // A channel name beside a courier status is what makes this Unicommerce's
    // export rather than any other order list.
    && headersPresent(headers, COLUMNS.channel)
    && headersPresent(headers, COLUMNS.mrp)
}

/** The channel names Unicommerce gives the website. Everything else in the
 * file belongs to a marketplace that is already read from its own report. */
const WEBSITE_CHANNELS = new Set(['shopify', 'website', 'd2c', 'custom'])

function num(raw: string | undefined): number {
  if (raw === undefined) return 0
  const text = raw.replace(/[₹,\s]/g, '')
  if (text === '' || text === '-') return 0
  const n = Number(text)
  return Number.isFinite(n) ? n : 0
}

export type DateOrder = 'mdy' | 'dmy'

/**
 * Which way round the export writes its dates, read from the dates themselves.
 *
 * A value above 12 in the first position can only be a day, and one in the
 * second can only be a month. September's file settles it in the second
 * position — `8/30/2026` — and says month first, whatever the column is
 * called. When a file is short enough that every number is 12 or under,
 * nothing in it can decide, and the caller says so rather than picking
 * silently: the header has already been caught lying once.
 */
export function unicommerceDateOrder(dates: string[]): { order: DateOrder; decided: boolean } {
  let firstOver12 = false
  let secondOver12 = false
  for (const text of dates) {
    const m = /^\s*(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(text)
    if (!m) continue
    if (Number(m[1]) > 12) firstOver12 = true
    if (Number(m[2]) > 12) secondOver12 = true
  }
  if (firstOver12 && !secondOver12) return { order: 'dmy', decided: true }
  if (secondOver12 && !firstOver12) return { order: 'mdy', decided: true }
  // Both, or neither. Both means the file mixes two conventions and no single
  // reading is right; neither means it is too short to tell.
  return { order: 'mdy', decided: false }
}

export function unicommerceDate(raw: string | undefined, order: DateOrder): string | null {
  const text = String(raw ?? '').trim()
  if (text === '') return null
  const m = /^\s*(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(text)
  if (!m) {
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text)
    return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null
  }
  const day = Number(order === 'dmy' ? m[1] : m[2])
  const month = Number(order === 'dmy' ? m[2] : m[1])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return `${m[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export type DeliveryOutcome = 'delivered' | 'rto' | 'returned' | 'in_flight'

/**
 * What a courier status means for the money.
 *
 * September writes six of them: DELIVERED, RTO, RETURN_DELIVERED, OFD,
 * INTRANSIT and blank. Anything this does not recognise is treated as still
 * moving, which is the reading that cannot overstate a month, and the upload
 * names every status it saw so a new one is noticed rather than absorbed.
 *
 * The courier's status decides and the tracking status is read only where
 * the courier has not said anything, which is six rows of September. Reading
 * both together let a contradiction — in transit by one, delivered by the
 * other — settle as delivered, and the safe way round is the other one.
 */
export function unicommerceOutcome(courierStatus: string, trackingStatus = ''): DeliveryOutcome {
  const stated = courierStatus.trim() === '' ? trackingStatus : courierStatus
  const s = stated.trim().toUpperCase()
  if (/RETURN_DELIVERED|RETURNED_DELIVERED|RETURN DELIVERED/.test(s)) return 'returned'
  if (/RTO|RETURNED_TO_ORIGIN/.test(s)) return 'rto'
  if (/^DELIVERED|\bDELIVERED\b/.test(s)) return 'delivered'
  return 'in_flight'
}

export interface UnicommerceNormalizeResult extends NormalizeResult {
  months: string[]
  /** Every courier status in the file, with what it came to. */
  outcomes: { status: string; units: number; customerPaid: number }[]
  totals: {
    units: number
    orders: number
    mrp: number
    customerPaid: number
    gst: number
    netSales: number
    /** Value that went out and came back — RTO and customer returns. */
    lostToReturns: number
    /** Still moving when the file was exported, so not yet revenue. */
    inFlight: number
    /** Delivery charged to the customer, inside `customerPaid`. */
    shippingCharged: number
  }
  /** Rows belonging to a marketplace, which this channel must not book. */
  skippedChannels: { channel: string; rows: number }[]
}

export function normalizeUnicommerceSaleOrders(
  rows: Record<string, string>[],
  skuMaster: SkuMaster[],
  mappings: SkuMapping[],
  comboComponents: ComboComponent[],
  importId: string,
): UnicommerceNormalizeResult {
  const validRecords: CanonicalSalesRecord[] = []
  const invalidRows: NormalizeResult['invalidRows'] = []
  const warnings: string[] = []

  const field = (row: Record<string, string>, name: keyof typeof COLUMNS): string | undefined =>
    getField(row, COLUMNS[name])

  const { order, decided } = unicommerceDateOrder(rows.map((r) => String(field(r, 'orderDate') ?? '')))

  const internalBySku = new Map(mappings.map((m) => [m.channelSku, m.internalSku]))
  const master = new Map(skuMaster.map((s) => [s.sku, s]))
  const mappingTables = { skuMaster, mappings, comboComponents }
  const gstByCode = new Map<string, number | null>()
  const respelled = new Map<string, string>()
  const gstMismatch = new Set<string>()
  const unknownSkus = new Set<string>()
  const monthsSeen = new Set<string>()
  const orders = new Set<string>()
  const outcomes = new Map<string, { units: number; customerPaid: number }>()
  const skipped = new Map<string, number>()

  const totals = {
    units: 0, orders: 0, mrp: 0, customerPaid: 0, gst: 0, netSales: 0,
    lostToReturns: 0, inFlight: 0, shippingCharged: 0,
  }

  rows.forEach((row, index) => {
    const sku = (field(row, 'sku') ?? '').trim()
    const channel = (field(row, 'channel') ?? '').trim()
    const date = unicommerceDate(field(row, 'orderDate'), order)
    if (!sku && !channel && date === null) return

    // A marketplace's rows are already read from that marketplace's own
    // report. Booking them here would count the same sale twice.
    if (channel !== '' && !WEBSITE_CHANNELS.has(channel.toLowerCase())) {
      skipped.set(channel, (skipped.get(channel) ?? 0) + 1)
      return
    }
    if (date === null) {
      invalidRows.push({ rowIndex: index, reason: `Unreadable order date: "${field(row, 'orderDate') ?? ''}"` })
      return
    }
    if (!sku) {
      invalidRows.push({ rowIndex: index, reason: 'Missing Item SKU Code' })
      return
    }

    const courierStatus = (field(row, 'courierStatus') ?? '').trim()
    const outcome = unicommerceOutcome(courierStatus, field(row, 'trackingStatus') ?? '')
    const mrp = num(field(row, 'mrp'))
    const customerPaid = num(field(row, 'totalPrice'))
    const sellingPrice = num(field(row, 'sellingPrice'))
    // Every row states its GST, and only some state the taxable value it came
    // out of, so the tax is summed from the parts that are always there.
    const gst = num(field(row, 'cgst')) + num(field(row, 'sgst')) + num(field(row, 'igst')) + num(field(row, 'utgst'))

    const code = mappedCodeFor(sku, mappingTables) ?? sku
    if (code !== sku) respelled.set(sku, code)
    let masterRate = gstByCode.get(code)
    if (masterRate === undefined) {
      masterRate = resolveGstPct(code, mappingTables)
      gstByCode.set(code, masterRate)
    }
    const statedRate = num(field(row, 'gstRate')) / 100
    if (masterRate !== null && statedRate > 0 && Math.abs(masterRate - statedRate) > 0.0001) gstMismatch.add(sku)

    const internalSku = internalBySku.get(code) ?? code
    const product = master.get(internalSku) ?? master.get(code)
    if (!product) unknownSkus.add(sku)

    const sold = outcome === 'delivered'
    const seen = outcomes.get(courierStatus || '(none stated)') ?? { units: 0, customerPaid: 0 }
    outcomes.set(courierStatus || '(none stated)', { units: seen.units + 1, customerPaid: seen.customerPaid + customerPaid })

    monthsSeen.add(date.slice(0, 7))
    orders.add(String(field(row, 'orderCode') ?? index))
    totals.units += 1
    totals.mrp += mrp
    totals.customerPaid += customerPaid
    totals.shippingCharged += Math.max(0, customerPaid - sellingPrice)
    if (sold) {
      totals.gst += gst
      totals.netSales += customerPaid - gst
    } else if (outcome === 'in_flight') {
      totals.inFlight += customerPaid
    } else {
      totals.lostToReturns += customerPaid
    }

    validRecords.push({
      orderId: String(field(row, 'orderCode') ?? `d2c-${index}`),
      // One order carries several rows, and two units of one product in one
      // order are two of them.
      lineId: `${sku}-${index}`,
      orderDate: date,
      channel: 'd2c_website',
      marketplace: 'd2c_website',
      sellerType: 'marketplace',
      // Stored as the Product Master and SKU map spell it, so cost, category
      // and tax all resolve from one code.
      sku: code,
      productName: product?.productName ?? (field(row, 'itemName') ?? sku),
      category: normalizeCategory(product?.category ?? ''),
      // One row is one unit: the export carries no quantity at all.
      quantity: sold ? 1 : 0,
      grossSales: mrp > 0 ? mrp : customerPaid,
      discount: mrp > customerPaid ? mrp - customerPaid : 0,
      netSales: sold ? customerPaid - gst : 0,
      returnUnits: outcome === 'returned' ? 1 : 0,
      rtoUnits: outcome === 'rto' ? 1 : 0,
      // The courier's bill is a cost on the courier's invoice; what the
      // customer was charged for delivery is inside `customerPaid` above.
      shippingCost: 0,
      // Nothing: the website pays no marketplace a commission. The costs it
      // does carry — courier, payment gateway — are on their own statements.
      marketplaceFee: 0,
      tax: sold ? gst : 0,
      taxInGross: true,
      status: outcome === 'delivered' ? 'completed' : outcome === 'rto' ? 'rto' : outcome === 'returned' ? 'returned' : 'pending',
      currency: 'INR',
      importId,
    })
  })

  totals.orders = orders.size
  const months = [...monthsSeen].sort()
  const inr = (v: number): string => `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
  const outcomeList = [...outcomes.entries()]
    .map(([status, v]) => ({ status, units: v.units, customerPaid: v.customerPaid }))
    .sort((a, b) => b.customerPaid - a.customerPaid)
  const skippedChannels = [...skipped.entries()].map(([channel, rows_]) => ({ channel, rows: rows_ }))

  if (!decided && validRecords.length > 0) {
    warnings.push(
      'This file\'s dates could be read either way round — no date in it has a number above 12 in either place — ' +
      `so they were read month first, which is how this export writes them despite its column being named ` +
      `"dd/mm/yyyy". That puts these rows in ${months.join(', ')}. Check that is the month they belong to before ` +
      'importing.',
    )
  }
  if (months.length > 1) {
    warnings.push(
      `These rows cover ${months.length} months (${months.join(', ')}), read month-first as the export writes ` +
      'them. Each is filed under its own order month.',
    )
  }
  warnings.push(
    `${totals.orders} order(s), ${totals.units} unit(s) — one row is one unit, as the export has no quantity ` +
    `column. Delivered: ${inr(totals.netSales)} of net sales after ${inr(totals.gst)} of GST. ` +
    `${outcomeList.map((o) => `${o.status} ${o.units}`).join(' · ')}.`,
  )
  if (totals.lostToReturns > 0) {
    const pct = totals.customerPaid > 0 ? (totals.lostToReturns / totals.customerPaid) * 100 : 0
    warnings.push(
      `${inr(totals.lostToReturns)} went out and came back — RTO and customer returns, ${pct.toFixed(1)}% of what ` +
      'the month billed. Those units keep their gross and earn no net. This is the figure Shopify cannot see: the ' +
      'store records a refund only when somebody raises one.',
    )
  }
  if (totals.inFlight > 0) {
    warnings.push(
      `${inr(totals.inFlight)} was still in transit when this file was exported, so it earns nothing yet. Re-upload ` +
      'the month once those have landed and the revenue follows them.',
    )
  }
  if (totals.shippingCharged > 0) {
    warnings.push(
      `${inr(totals.shippingCharged)} of that is delivery charged to customers, which is inside Total Price and ` +
      'stays in revenue. The courier\'s own bill is a cost and is not in this file — nor is the payment gateway\'s.',
    )
  }
  if (skippedChannels.length > 0) {
    warnings.push(
      `${skippedChannels.map((c) => `${c.rows} row(s) from ${c.channel}`).join(', ')} were skipped: this channel is ` +
      'the website only, and a marketplace is read from its own report. Export Unicommerce filtered to the website ' +
      'channel to avoid the question.',
    )
  }
  if (respelled.size > 0) {
    const pairs = [...respelled.entries()].map(([file, mapped]) => `${file} → ${mapped}`)
    const shown = pairs.slice(0, 6).join(', ')
    const rest = pairs.length - 6
    warnings.push(
      `${pairs.length} code(s) differ from the SKU map only in their separators and were read as the map spells ` +
      `them: ${shown}${rest > 0 ? ` and ${rest} more` : ''}.`,
    )
  }
  if (unknownSkus.size > 0) {
    const codes = [...unknownSkus].sort()
    const shown = codes.slice(0, 8).join(', ')
    const rest = codes.length - 8
    warnings.push(
      `${codes.length} code(s) are not in the Product Master, so their goods cost nothing and their sales carry no ` +
      `GST rate of their own: ${shown}${rest > 0 ? ` and ${rest} more` : ''}. Link them on Catalogue ▸ SKU Mapping.`,
    )
  }
  if (gstMismatch.size > 0) {
    const codes = [...gstMismatch].sort()
    const shown = codes.slice(0, 8).join(', ')
    const rest = codes.length - 8
    warnings.push(
      `${codes.length} code(s) are invoiced on this file at a GST rate that differs from the Product Master: ` +
      `${shown}${rest > 0 ? ` and ${rest} more` : ''}. The GST taken out is the one the invoice states.`,
    )
  }

  return { validRecords, totalRows: rows.length, invalidRows, warnings, months, outcomes: outcomeList, totals, skippedChannels }
}
