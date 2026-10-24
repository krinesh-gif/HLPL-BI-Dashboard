import type { CanonicalSalesRecord, SkuMaster } from '@/data/models'
import type { ComboComponent, SkuMapping } from '@/data/skuMapping'
import { mappedCodeFor, resolveGstPct } from '@/data/skuMapping'
import { normalizeCategory } from '@/data/categories'
import { getField, headersPresent, type NormalizeResult } from './types'

/**
 * Snapdeal's order report, as it downloads from the seller panel.
 *
 * One row per sub-order — one item of one order — with no quantity column at
 * all: a pack of two is its own SKU code (`C2_EO_PEPPERMINT_ROSEMARY_15`),
 * not a quantity of two, so every row is one unit of whatever code it names
 * and the combo is unpacked by the SKU map like any other combo code.
 *
 * Three things about this file decide how it is read.
 *
 * **`NET PRICE` is what the shopper paid, `MRP` is what the listing struck
 * through.** Neither is a payout: the file states no commission, no shipping
 * charge, no payment fee and no settlement, so what Snapdeal took is not in
 * it. The statement therefore runs from MRP down to net sales and stops, and
 * says so, rather than showing a margin that nothing has been deducted from.
 *
 * **The status column is the whole story of whether a sale happened.**
 * August's file has 179 rows Delivered, 41 "As per Shipper Package Returned
 * to V", 2 "Shipment Returned to Origin" and one still with the courier.
 * Counting all 223 as sales would have overstated the month by ₹12,244 —
 * a fifth of it. A row that did not reach the customer keeps the gross that
 * Snapdeal billed and earns no net, the same reversal the Meesho statement
 * makes on its own line.
 *
 * **`TAXPERCENTAGE` is empty on every row of the file.** The column exists
 * and Snapdeal fills none of it, so GST comes from the Product Master, which
 * is the single source of truth for tax on every channel here. The column is
 * still read for the month where Snapdeal starts filling it, and where the
 * Master has no rate the codes are named rather than being taxed at nothing
 * in silence.
 */
const COLUMNS = {
  orderCode: ['ordercode', 'order code'],
  subOrderCode: ['subordercode', 'sub order code'],
  reference: ['referencecode'],
  productName: ['productname', 'product name'],
  orderDate: ['ordercreateddate', 'order created date'],
  verifiedDate: ['orderverifieddate'],
  invoiceDate: ['invoicedate'],
  status: ['status'],
  sku: ['skucode', 'sku code', 'sku'],
  category: ['productcategory', 'product category'],
  netPrice: ['net price', 'netprice'],
  mrp: ['mrp'],
  taxPct: ['taxpercentage', 'tax percentage'],
}

/** Columns a file must have for this to be Snapdeal's order report. */
const REQUIRED = ['subOrderCode', 'sku', 'netPrice', 'status'] as const

export function detectSnapdealOrdersReport(headers: string[]): boolean {
  return REQUIRED.every((field) => headersPresent(headers, COLUMNS[field]))
    // `SUBORDERCODE` beside an `MRP` is what makes this Snapdeal's report
    // rather than any other list of orders.
    && headersPresent(headers, COLUMNS.mrp)
}

function num(raw: string | undefined): number {
  if (raw === undefined) return 0
  const text = raw.replace(/[₹,\s]/g, '')
  if (text === '' || text === '-') return 0
  const n = Number(text)
  return Number.isFinite(n) ? n : 0
}

/**
 * Snapdeal's dates, which are `dd-mm-yyyy hh:mm` — day first, as every Indian
 * report writes them. A time is present and dropped: a report date is a
 * calendar date, and the one time this was left to `new Date` it moved a
 * whole month of Amazon USA into the month before.
 */
export function snapdealDate(raw: string | undefined): string | null {
  const text = String(raw ?? '').trim()
  if (text === '' || text.toUpperCase() === 'NA') return null
  const dmy = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(text)
  if (dmy) {
    const [, d, m, y] = dmy
    if (Number(m) < 1 || Number(m) > 12 || Number(d) < 1 || Number(d) > 31) return null
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text)
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null
}

export type SnapdealOutcome = 'delivered' | 'returned' | 'rto' | 'in_flight'

/**
 * What a Snapdeal status means for the money.
 *
 * Matched on what the status says rather than on an exact string, because the
 * panel writes several of them and truncates one mid-word ("Returned to V").
 * Anything that is not plainly one of the three known endings is treated as
 * still in flight — no revenue — which is the reading that cannot overstate a
 * month, and the upload names every status it saw so a new one is noticed.
 */
export function snapdealOutcome(status: string): SnapdealOutcome {
  const s = status.trim().toLowerCase()
  if (s === 'delivered') return 'delivered'
  if (s.includes('returned to origin') || s.includes('rto')) return 'rto'
  if (s.includes('returned')) return 'returned'
  return 'in_flight'
}

export interface SnapdealNormalizeResult extends NormalizeResult {
  /** Every month the rows fall in, so a file spanning two is reported. */
  months: string[]
  /** What each status in the file came to, for the upload summary. */
  statusTotals: { status: string; rows: number; netPrice: number }[]
}

export function normalizeSnapdealOrdersReport(
  rows: Record<string, string>[],
  skuMaster: SkuMaster[],
  mappings: SkuMapping[],
  comboComponents: ComboComponent[],
  importId: string,
): SnapdealNormalizeResult {
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
  const statuses = new Map<string, { rows: number; netPrice: number }>()
  let deliveredNet = 0
  let notDeliveredGross = 0

  rows.forEach((row, index) => {
    const field = (name: keyof typeof COLUMNS): string | undefined => getField(row, COLUMNS[name])
    const sku = (field('sku') ?? '').trim()
    const date = snapdealDate(field('orderDate') ?? field('verifiedDate') ?? field('invoiceDate'))
    if (!sku && date === null) return
    if (date === null) {
      invalidRows.push({ rowIndex: index, reason: `Unreadable order date: "${field('orderDate') ?? ''}"` })
      return
    }
    if (!sku) {
      invalidRows.push({ rowIndex: index, reason: 'Missing SKUCODE' })
      return
    }

    const status = (field('status') ?? '').trim()
    const outcome = snapdealOutcome(status)
    const netPrice = num(field('netPrice'))
    const mrp = num(field('mrp'))
    const statedGstPct = num(field('taxPct')) / 100

    // Snapdeal writes the code with underscores where the SKU map has
    // slashes. Same code, different separator; read as the map spells it.
    const code = mappedCodeFor(sku, mappingTables) ?? sku
    if (code !== sku) respelled.set(sku, code)

    let gstRate = gstByCode.get(code)
    if (gstRate === undefined) {
      gstRate = resolveGstPct(code, mappingTables)
      gstByCode.set(code, gstRate)
    }
    const rate = gstRate ?? (statedGstPct > 0 ? statedGstPct : null)
    if (rate === null) gstMissing.add(sku)

    const internalSku = internalBySku.get(code) ?? code
    const product = master.get(internalSku) ?? master.get(sku)


    // A row that never reached the customer keeps the gross Snapdeal billed
    // and earns no net: nothing was sold, so nothing is revenue.
    const sold = outcome === 'delivered'
    const gst = sold && rate !== null ? netPrice - netPrice / (1 + rate) : 0

    const seen = statuses.get(status) ?? { rows: 0, netPrice: 0 }
    statuses.set(status, { rows: seen.rows + 1, netPrice: seen.netPrice + netPrice })
    if (sold) deliveredNet += netPrice
    else notDeliveredGross += netPrice

    monthsSeen.add(date.slice(0, 7))

    validRecords.push({
      orderId: String(field('orderCode') ?? field('subOrderCode') ?? `snapdeal-${index}`),
      // Snapdeal splits an order into sub-orders, one per item, and files two
      // items of one order under the same order code. Without this they
      // collide on the de-dup key and one is silently dropped.
      lineId: String(field('subOrderCode') ?? index),
      orderDate: date,
      channel: 'snapdeal',
      marketplace: 'snapdeal',
      sellerType: 'marketplace',
      // Snapdeal writes it with underscores; stored as the Product Master
      // and SKU map spell it, so cost, category and tax all resolve.
      sku: code,
      productName: product?.productName ?? (field('productName') ?? sku),
      category: normalizeCategory(product?.category ?? field('category') ?? ''),
      // One row is one unit: the file carries no quantity, and a multipack is
      // its own code rather than a quantity of the single.
      quantity: sold ? 1 : 0,
      // At MRP, with the price off to what the shopper actually paid as the
      // discount — the same shape every other channel's gross carries.
      grossSales: mrp > 0 ? mrp : netPrice,
      discount: mrp > netPrice ? mrp - netPrice : 0,
      netSales: sold ? netPrice - gst : 0,
      returnUnits: outcome === 'returned' ? 1 : 0,
      rtoUnits: outcome === 'rto' ? 1 : 0,
      shippingCost: 0,
      // Nothing: this file states no commission at all. It is not zero, it is
      // unknown, and the upload says so rather than showing a free channel.
      marketplaceFee: 0,
      tax: gst,
      // The gross is an MRP, so the GST is inside it, not charged on top.
      taxInGross: true,
      status: outcome === 'delivered' ? 'completed' : outcome === 'rto' ? 'rto' : outcome === 'returned' ? 'returned' : 'pending',
      currency: 'INR',
      importId,
    })
  })

  const months = [...monthsSeen].sort()
  const inr = (v: number): string => `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
  const statusTotals = [...statuses.entries()]
    .map(([status, t]) => ({ status, rows: t.rows, netPrice: t.netPrice }))
    .sort((a, b) => b.netPrice - a.netPrice)

  if (months.length > 1) {
    warnings.push(
      `These rows cover ${months.length} months (${months.join(', ')}). Each is filed under its own month, which ` +
      'is what the order date says; upload one month at a time if that was not intended.',
    )
  }
  warnings.push(
    `Read on order date. ${statusTotals.map((s) => `${s.status} ${s.rows} (${inr(s.netPrice)})`).join(' · ')}. ` +
    `Only Delivered earns revenue — ${inr(deliveredNet)} including GST — and the other ${inr(notDeliveredGross)} ` +
    'is kept as gross with no net, the way a cancelled order is treated everywhere here.',
  )
  warnings.push(
    'This is an order report, not a settlement: it states no commission, no shipping charge, no payment fee and ' +
    'no payout. Snapdeal\'s statement therefore runs to net sales and stops — what Snapdeal took is missing, not ' +
    'zero. Send the Snapdeal payout statement and those lines fill in; nothing above them changes when they do.',
  )
  if (respelled.size > 0) {
    const pairs = [...respelled.entries()].map(([file, mapped]) => `${file} → ${mapped}`)
    const shown = pairs.slice(0, 6).join(', ')
    const rest = pairs.length - 6
    warnings.push(
      `${pairs.length} code(s) are written here with underscores where the SKU map has slashes, and were read as ` +
      `the map spells them: ${shown}${rest > 0 ? ` and ${rest} more` : ''}. Only the separator differs; add the ` +
      'Snapdeal spelling on Catalogue ▸ SKU Mapping to make it explicit.',
    )
  }
  if (gstMissing.size > 0) {
    const codes = [...gstMissing].sort()
    const shown = codes.slice(0, 8).join(', ')
    const rest = codes.length - 8
    warnings.push(
      `${codes.length} Snapdeal code(s) have no GST rate — the file's TAXPERCENTAGE column is empty and the ` +
      `Product Master has no rate either — so their sales are shown with no tax taken out and this month's net ` +
      `sales is overstated by whatever their tax is: ${shown}${rest > 0 ? ` and ${rest} more` : ''}. Link them on ` +
      'Catalogue ▸ SKU Mapping and set the rate on Product Master.',
    )
  }

  return { validRecords, totalRows: rows.length, invalidRows, warnings, months, statusTotals }
}
