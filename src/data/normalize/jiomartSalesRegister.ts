import type { CanonicalSalesRecord, SkuMaster } from '@/data/models'
import type { ComboComponent, SkuMapping } from '@/data/skuMapping'
import { mappedCodeFor } from '@/data/skuMapping'
import { normalizeCategory } from '@/data/categories'
import { getField, headersPresent, type NormalizeResult } from './types'

/**
 * JioMart's sales register, as it downloads from the seller panel.
 *
 * It is a GST register rather than an order report, and that is the whole
 * difference. Three things follow from it.
 *
 * **It states the tax exactly, so nothing has to be derived.** Every row
 * carries `Taxable Value` beside IGST or CGST+SGST, and the two add back to
 * the invoice to the paisa across August's file. Where Snapdeal leaves its
 * tax column empty and the rate has to come from the Product Master, here
 * the file is the authority on its own arithmetic and is read as such.
 *
 * **A credit note is a row of its own, with a negative value and an invoice
 * number pointing at the sale it reverses.** August's file carries one
 * (`C24FWC8FCGA00012` against `S24FWC8FCGA00059`) and the sale it reverses is
 * not in the file at all — invoice 59 was raised before this month started.
 * Read as a sale it would add ₹199 of revenue; read as a return of a sale
 * this month it would add ₹199 of gross that never happened. It is neither:
 * it is revenue coming off, so it carries no gross, no units and a negative
 * net, and the month it lands in is the month it reduces.
 *
 * **Shipment status and event type disagree, on purpose.** August has two
 * rows marked `shipment_returned` whose event is still `sale` with positive
 * values — the parcel bounced but the credit note has not been raised. They
 * keep the gross JioMart billed and earn no net, the same reversal every
 * other channel's undelivered row makes here, and the credit note that
 * eventually follows will reverse nothing twice because it carries no gross.
 *
 * **It states no commission.** There is no fee, no shipping charge and no
 * payout column anywhere in it, so the statement runs from what the shopper
 * paid down to net sales and stops. The TCS and TDS it does state are tax
 * deposited against the company's own account, recoverable at filing — not a
 * cost — so they are reported to the uploader and kept out of the P&L.
 */
const COLUMNS = {
  orderId: ['order id'],
  orderItemId: ['order item id'],
  orderDate: ['order date'],
  invoiceDate: ['buyer invoice date'],
  productName: ['product title/description', 'product title', 'product description'],
  sku: ['sku'],
  status: ['order status'],
  eventType: ['event type'],
  eventSubType: ['event sub type'],
  quantity: ['item quantity'],
  offerPrice: ['offer price'],
  coupon: ['seller coupon amount'],
  finalAmount: ['final invoice amount'],
  taxableValue: ['taxable value'],
  igst: ['igst amount'],
  cgst: ['cgst amount'],
  sgst: ['sgst amount'],
  tcs: ['total tcs deducted'],
  invoiceId: ['buyer invoice id'],
  originalInvoiceId: ['original invoice id'],
}

/** What makes a file JioMart's register rather than any other GST extract. */
const REQUIRED = ['orderId', 'sku', 'eventSubType', 'finalAmount', 'taxableValue'] as const

export function detectJiomartSalesRegister(headers: string[]): boolean {
  return REQUIRED.every((field) => headersPresent(headers, COLUMNS[field]))
    // `Order Status` beside an `Event Sub Type` is the pair no other report
    // here has; a Flipkart extract carries neither.
    && headersPresent(headers, COLUMNS.status)
}

function num(raw: string | undefined): number {
  if (raw === undefined) return 0
  const text = raw.replace(/[₹,\s]/g, '')
  if (text === '' || text === '-') return 0
  const n = Number(text)
  return Number.isFinite(n) ? n : 0
}

/**
 * JioMart writes `2026-08-02 20:48:04 +0530` — ISO, with a time and an offset
 * that are both dropped. A report date is a calendar date, and handing the
 * whole string to `new Date` is what once moved a month of Amazon USA into
 * the month before.
 */
export function jiomartDate(raw: string | undefined): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw ?? '').trim())
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null
}

export type JiomartOutcome = 'delivered' | 'rto' | 'returned' | 'in_flight'

/**
 * What a JioMart shipment status means for the money.
 *
 * Anything not plainly delivered earns nothing, which is the reading that
 * cannot overstate a month. Every status seen is reported so a new one is
 * noticed rather than quietly counted as in flight.
 */
export function jiomartOutcome(status: string): JiomartOutcome {
  const s = status.trim().toLowerCase()
  if (s === 'delivered' || s === 'complete' || s === 'completed') return 'delivered'
  if (s.includes('rto') || s.includes('shipment_returned') || s.includes('returned to origin')) return 'rto'
  if (s.includes('return')) return 'returned'
  return 'in_flight'
}

/** True where the row reverses an earlier sale rather than making one. */
export function jiomartIsReversal(eventType: string, eventSubType: string, finalAmount: number): boolean {
  const t = `${eventType} ${eventSubType}`.toLowerCase()
  if (finalAmount < 0) return true
  return t.includes('return') || t.includes('reversal') || t.includes('cancel')
}

export interface JiomartNormalizeResult extends NormalizeResult {
  months: string[]
  /** What each shipment status came to, for the upload summary. */
  statusTotals: { status: string; rows: number; amount: number }[]
  /** Credit notes in the file, and the sales they reverse. */
  reversals: { invoiceId: string; against: string; amount: number }[]
  /** Deposited against the company's own tax account, not a cost. Reported
   * so the number is not simply absent from a file that states it. */
  tcsDeducted: number
  /** Codes in the file that neither the Product Master nor the SKU map
   * knows, so nothing can cost them. */
  unmappedCodes: string[]
}

export function normalizeJiomartSalesRegister(
  rows: Record<string, string>[],
  skuMaster: SkuMaster[],
  mappings: SkuMapping[],
  comboComponents: ComboComponent[],
  importId: string,
): JiomartNormalizeResult {
  const validRecords: CanonicalSalesRecord[] = []
  const invalidRows: NormalizeResult['invalidRows'] = []
  const warnings: string[] = []

  const internalBySku = new Map(mappings.map((m) => [m.channelSku, m.internalSku]))
  const master = new Map(skuMaster.map((s) => [s.sku, s]))
  const mappingTables = { skuMaster, mappings, comboComponents }
  const monthsSeen = new Set<string>()
  const statuses = new Map<string, { rows: number; amount: number }>()
  const reversals: JiomartNormalizeResult['reversals'] = []
  const unmapped = new Set<string>()
  let tcsDeducted = 0

  rows.forEach((row, index) => {
    const field = (name: keyof typeof COLUMNS): string | undefined => getField(row, COLUMNS[name])
    const sku = (field('sku') ?? '').trim()
    const date = jiomartDate(field('orderDate') ?? field('invoiceDate'))
    if (!sku && date === null) return
    if (date === null) {
      invalidRows.push({ rowIndex: index, reason: `Unreadable order date: "${field('orderDate') ?? ''}"` })
      return
    }
    if (!sku) {
      invalidRows.push({ rowIndex: index, reason: 'Missing SKU' })
      return
    }

    const status = (field('status') ?? '').trim()
    const eventType = (field('eventType') ?? '').trim()
    const eventSubType = (field('eventSubType') ?? '').trim()
    const quantity = Math.abs(num(field('quantity'))) || 1
    const offerPrice = num(field('offerPrice'))
    const coupon = num(field('coupon'))
    const finalAmount = num(field('finalAmount'))
    const taxableValue = num(field('taxableValue'))
    const gst = num(field('igst')) + num(field('cgst')) + num(field('sgst'))
    tcsDeducted += num(field('tcs'))

    // Read as the Product Master and SKU map spell it, so cost, category and
    // tax all resolve from one code.
    const code = mappedCodeFor(sku, mappingTables) ?? sku
    const internalSku = internalBySku.get(code) ?? code
    const product = master.get(internalSku) ?? master.get(code)
    if (!product && !internalBySku.has(code)) unmapped.add(sku)

    const seen = statuses.get(status) ?? { rows: 0, amount: 0 }
    statuses.set(status, { rows: seen.rows + 1, amount: seen.amount + finalAmount })
    monthsSeen.add(date.slice(0, 7))

    const reversal = jiomartIsReversal(eventType, eventSubType, finalAmount)
    const outcome = jiomartOutcome(status)
    const sold = !reversal && outcome === 'delivered'

    if (reversal) {
      reversals.push({
        invoiceId: String(field('invoiceId') ?? ''),
        against: String(field('originalInvoiceId') ?? ''),
        amount: Math.abs(taxableValue),
      })
    }

    validRecords.push({
      orderId: String(field('orderId') ?? `jiomart-${index}`),
      // One order carries several items and JioMart files them under one
      // order id; without this they collide on the de-dup key and one is
      // silently dropped.
      lineId: String(field('orderItemId') ?? field('invoiceId') ?? index),
      orderDate: date,
      channel: 'jiomart',
      marketplace: 'jiomart',
      sellerType: 'marketplace',
      sku: code,
      productName: product?.productName ?? (field('productName') ?? sku),
      category: normalizeCategory(product?.category ?? ''),
      // A credit note moves no goods: the unit shipped, and was costed, in
      // the month the sale was filed. Counting it again here would charge
      // the cost of one unit twice and report a sale that did not happen.
      quantity: reversal || !sold ? 0 : quantity,
      // Likewise it bills no gross. It is revenue coming off, which the
      // negative net below is, and nothing else.
      grossSales: reversal ? 0 : offerPrice,
      discount: reversal ? 0 : coupon,
      // Ex-GST on both sides: a sale earns its taxable value, an undelivered
      // shipment earns nothing, and a credit note earns the negative of what
      // the original sale earned.
      netSales: reversal ? -Math.abs(taxableValue) : sold ? taxableValue : 0,
      returnUnits: reversal || outcome === 'returned' ? quantity : 0,
      rtoUnits: outcome === 'rto' && !reversal ? quantity : 0,
      shippingCost: 0,
      // JioMart's register states no commission, no shipping and no payout.
      marketplaceFee: 0,
      tax: sold ? gst : 0,
      taxInGross: true,
      status: reversal ? 'returned'
        : outcome === 'delivered' ? 'completed'
          : outcome === 'rto' ? 'rto'
            : outcome === 'returned' ? 'returned' : 'pending',
      currency: 'INR',
      importId,
    })
  })

  const months = [...monthsSeen].sort()
  const inr = (v: number): string => `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

  if (months.length > 1) {
    warnings.push(`These rows span ${months.join(', ')}. Each lands in its own month.`)
  }
  if (reversals.length > 0) {
    const total = reversals.reduce((sum, r) => sum + r.amount, 0)
    warnings.push(
      `${reversals.length} credit ${reversals.length === 1 ? 'note' : 'notes'} worth ${inr(total)} — ` +
      `${reversals.map((r) => `${r.invoiceId || 'unnumbered'} against ${r.against || 'an unstated invoice'}`).join(', ')}. ` +
      'Each takes revenue off this month; the sale it reverses was counted in the month it was invoiced.',
    )
  }
  const notDelivered = [...statuses.entries()].filter(([s]) => jiomartOutcome(s) !== 'delivered')
  if (notDelivered.length > 0) {
    warnings.push(
      `${notDelivered.map(([s, v]) => `${v.rows} ${s}`).join(', ')} — these keep the gross JioMart billed and earn no net.`,
    )
  }
  if (unmapped.size > 0) {
    warnings.push(
      `${unmapped.size} code${unmapped.size === 1 ? '' : 's'} in this file ${unmapped.size === 1 ? 'is' : 'are'} not in the ` +
      `Product Master and ${unmapped.size === 1 ? 'is' : 'are'} mapped to nothing — ${[...unmapped].sort().join(', ')}. ` +
      'Their sales are counted; their cost cannot be, so they will show no margin until they are mapped.',
    )
  }
  if (tcsDeducted > 0) {
    warnings.push(
      `${inr(tcsDeducted)} of TCS is stated in this file. It is deposited against the company's own tax account and is ` +
      'recoverable at filing, so it is not charged to the P&L here.',
    )
  }

  return {
    validRecords,
    totalRows: rows.length,
    invalidRows,
    warnings,
    months,
    statusTotals: [...statuses.entries()]
      .map(([status, v]) => ({ status, rows: v.rows, amount: v.amount }))
      .sort((a, b) => b.amount - a.amount),
    reversals,
    tcsDeducted,
    unmappedCodes: [...unmapped].sort(),
  }
}
