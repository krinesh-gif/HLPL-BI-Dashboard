import type { CanonicalSalesRecord, SkuMaster } from '@/data/models'
import type { ComboComponent, SkuMapping } from '@/data/skuMapping'
import { mappedCodeFor } from '@/data/skuMapping'
import { normalizeCategory } from '@/data/categories'
import { getField, headersPresent, type NormalizeResult } from './types'

/**
 * Smytten's monthly sales report.
 *
 * Alone among the sales-report channels, it states the commission on every
 * line — so Smytten is the only one of them whose products can be read down
 * to a margin after fees without anything being apportioned.
 *
 * Its columns mean three different prices and the difference matters:
 * `Actual Value` is the MRP, `Invoice Value` is what the shopper actually
 * paid with GST inside it, and `Taxable Value` is that same sale ex-GST.
 * The gap between the first two is the discount; the third is the revenue.
 *
 * `Net Value` is the payout, and it ties exactly on every row of August's
 * file: invoice less commission, less GST on that commission, less TCS, less
 * TDS. Only the first two are a cost. TCS and TDS are deposited against the
 * company's own tax account and come back at filing, so charging them to the
 * P&L would understate the channel by the one amount that is certain to
 * return. They are reported instead.
 *
 * Two rows in the sheet are not sales and both would corrupt the month:
 *
 * **The last row is a Total.** It repeats the whole file — August's totals
 * are exactly twice the truth if it is read as data — and it is recognised
 * by its Brand cell saying `Total` rather than by its position, because a
 * row appended below it later would otherwise put the total back in.
 *
 * **A reverse-logistics deduction hides in the Date column.** August's reads
 * `Logistics;Order No.5333251; DTO(...);Replacement 0 ; Wrong Product
 * Received` with no SKU, no units and no sale — only ₹125 of charge, ₹22.50
 * of GST on it and a negative payout. It is a real cost against the channel
 * and it is kept, under a charge code of its own so that it lands in the
 * P&L's marketplace charges without pretending to be a product.
 */
const COLUMNS = {
  vendor: ['vendor name'],
  brand: ['brand'],
  date: ['date'],
  orderId: ['order id'],
  sku: ['sku id', 'sku'],
  item: ['item'],
  units: ['no of units', 'no. of units'],
  state: ['state'],
  gstPct: ['product gst %', 'product gst'],
  invoiceValue: ['invoice value'],
  taxableValue: ['taxable value'],
  actualValue: ['actual value'],
  commission: ['commission value'],
  gstOnCommission: ['gst on comm'],
  tcs: ['tcs'],
  tds: ['tds'],
  netValue: ['net value'],
}

const REQUIRED = ['sku', 'invoiceValue', 'taxableValue', 'actualValue', 'commission'] as const

export function detectSmyttenSalesReport(headers: string[]): boolean {
  return REQUIRED.every((field) => headersPresent(headers, COLUMNS[field]))
    // `GST on Comm` beside a `Net Value` is Smytten's own pair.
    && headersPresent(headers, COLUMNS.gstOnCommission)
    && headersPresent(headers, COLUMNS.netValue)
}

/** The code a charge that is not a product is filed under, so a real cost
 * reaches the P&L without being mistaken for something that was sold. */
export const SMYTTEN_CHARGE_SKU = 'SMYTTEN/CHARGE'

function num(raw: string | undefined): number {
  if (raw === undefined) return 0
  const text = String(raw).replace(/[₹,\s%]/g, '')
  if (text === '' || text === '-') return 0
  const n = Number(text)
  return Number.isFinite(n) ? n : 0
}

/**
 * Smytten's dates arrive as Excel serial numbers — 46236, not a string —
 * because the column is a real date cell. Day zero is 30 December 1899, the
 * convention Excel itself uses, and the result is read in UTC so a machine
 * west of Greenwich does not shift every row back a day.
 */
export function smyttenDate(raw: string | undefined): string | null {
  const text = String(raw ?? '').trim()
  if (text === '') return null

  const serial = Number(text)
  if (Number.isFinite(serial) && serial > 20000 && serial < 60000) {
    return new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000).toISOString().slice(0, 10)
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const dmy = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(text)
  if (dmy) {
    const [, d, m, y] = dmy
    if (Number(m) < 1 || Number(m) > 12) return null
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  return null
}

/** True for the repeated-totals row at the foot of the sheet. */
export function smyttenIsTotalRow(brand: string, date: string, sku: string): boolean {
  return brand.trim().toLowerCase() === 'total' && sku.trim() === '' && date.trim() === ''
}

export interface SmyttenNormalizeResult extends NormalizeResult {
  months: string[]
  /** Charges with no product against them — reverse logistics and the like. */
  charges: { description: string; amount: number }[]
  /** Deposited against the company's own tax account, not a cost. */
  tcsDeducted: number
  tdsDeducted: number
  /** Smytten's own codes that map to no product here. */
  unmappedCodes: { code: string; item: string; units: number }[]
}

export function normalizeSmyttenSalesReport(
  rows: Record<string, string>[],
  skuMaster: SkuMaster[],
  mappings: SkuMapping[],
  comboComponents: ComboComponent[],
  importId: string,
): SmyttenNormalizeResult {
  const validRecords: CanonicalSalesRecord[] = []
  const invalidRows: NormalizeResult['invalidRows'] = []
  const warnings: string[] = []

  const internalBySku = new Map(mappings.map((m) => [m.channelSku, m.internalSku]))
  const master = new Map(skuMaster.map((s) => [s.sku, s]))
  const mappingTables = { skuMaster, mappings, comboComponents }
  const monthsSeen = new Set<string>()
  const charges: SmyttenNormalizeResult['charges'] = []
  const unmapped = new Map<string, { item: string; units: number }>()
  let tcsDeducted = 0
  let tdsDeducted = 0
  let totalRows = 0

  rows.forEach((row, index) => {
    const field = (name: keyof typeof COLUMNS): string | undefined => getField(row, COLUMNS[name])
    const brand = field('brand') ?? ''
    const rawDate = field('date') ?? ''
    const sku = (field('sku') ?? '').trim()

    if (smyttenIsTotalRow(brand, rawDate, sku)) {
      totalRows += 1
      return
    }

    const commission = num(field('commission'))
    const gstOnCommission = num(field('gstOnCommission'))
    tcsDeducted += num(field('tcs'))
    tdsDeducted += num(field('tds'))

    // A charge row: no SKU, no sale, and the description written into the
    // date cell because the sheet has nowhere else to put it.
    if (sku === '' && (commission !== 0 || gstOnCommission !== 0)) {
      const description = rawDate.trim() || 'Charge with no description'
      const amount = commission + gstOnCommission
      charges.push({ description, amount })
      validRecords.push({
        orderId: `smytten-charge-${index}`,
        lineId: String(index),
        // A charge has no date of its own in this sheet, so it belongs to
        // the month the rest of the file is for. Resolved after the loop,
        // once that month is known.
        orderDate: '',
        channel: 'smytten',
        marketplace: 'smytten',
        sellerType: 'marketplace',
        sku: SMYTTEN_CHARGE_SKU,
        productName: description,
        category: '',
        quantity: 0,
        grossSales: 0,
        discount: 0,
        netSales: 0,
        returnUnits: 0,
        rtoUnits: 0,
        shippingCost: 0,
        marketplaceFee: amount,
        tax: 0,
        status: 'completed',
        currency: 'INR',
        importId,
      })
      return
    }

    const date = smyttenDate(rawDate)
    if (!sku && date === null) return
    if (date === null) {
      invalidRows.push({ rowIndex: index, reason: `Unreadable date: "${rawDate}"` })
      return
    }
    if (!sku) {
      invalidRows.push({ rowIndex: index, reason: 'Missing SKU Id' })
      return
    }

    const units = Math.abs(num(field('units'))) || 1
    const invoiceValue = num(field('invoiceValue'))
    const taxableValue = num(field('taxableValue'))
    const actualValue = num(field('actualValue'))

    const code = mappedCodeFor(sku, mappingTables) ?? sku
    const internalSku = internalBySku.get(code) ?? code
    const product = master.get(internalSku) ?? master.get(code)
    if (!product && !internalBySku.has(code)) {
      const seen = unmapped.get(sku) ?? { item: field('item') ?? '', units: 0 }
      unmapped.set(sku, { item: seen.item, units: seen.units + units })
    }

    monthsSeen.add(date.slice(0, 7))

    validRecords.push({
      orderId: String(field('orderId') ?? `smytten-${index}`),
      lineId: String(index),
      orderDate: date,
      channel: 'smytten',
      marketplace: 'smytten',
      sellerType: 'marketplace',
      sku: code,
      productName: product?.productName ?? (field('item') ?? sku),
      category: normalizeCategory(product?.category ?? ''),
      quantity: units,
      // The MRP, which is what the discount is measured against. Where the
      // sheet leaves it blank the invoice stands in, so the row reports no
      // discount rather than a discount of its whole value.
      grossSales: actualValue > 0 ? actualValue : invoiceValue,
      discount: actualValue > invoiceValue ? actualValue - invoiceValue : 0,
      netSales: taxableValue,
      returnUnits: 0,
      rtoUnits: 0,
      shippingCost: 0,
      // Commission and the GST charged on it. Both are Smytten's, both are
      // gone, and both are stated on the line rather than apportioned.
      marketplaceFee: commission + gstOnCommission,
      tax: invoiceValue - taxableValue,
      taxInGross: true,
      status: 'completed',
      currency: 'INR',
      importId,
    })
  })

  const months = [...monthsSeen].sort()
  // A charge carries no date of its own; it belongs to the month of the file
  // it came in. With no sales row to take a month from there is nothing to
  // date it by, so it is dropped rather than parked in an arbitrary month.
  const chargeMonth = months[0]
  const dated = validRecords.filter((r) => {
    if (r.orderDate !== '') return true
    if (chargeMonth === undefined) return false
    r.orderDate = `${chargeMonth}-01`
    return true
  })

  const inr = (v: number): string => `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

  if (totalRows > 0) {
    warnings.push(
      `A "Total" row was found and left out. Read as data it would have doubled every figure in this file.`,
    )
  }
  if (months.length > 1) {
    warnings.push(`These rows span ${months.join(', ')}. Each lands in its own month.`)
  }
  if (charges.length > 0) {
    const total = charges.reduce((sum, c) => sum + c.amount, 0)
    warnings.push(
      `${inr(total)} of charges with no product against them, kept as a marketplace cost — ` +
      `${charges.map((c) => c.description).join('; ')}.`,
    )
  }
  if (unmapped.size > 0) {
    warnings.push(
      `${unmapped.size} Smytten code${unmapped.size === 1 ? '' : 's'} map to no product here, so ` +
      `${unmapped.size === 1 ? 'its' : 'their'} sales are counted and ${unmapped.size === 1 ? 'its' : 'their'} cost ` +
      'cannot be. Map them on Catalogue → SKU Mapping and the margin follows.',
    )
  }
  if (tcsDeducted > 0 || tdsDeducted > 0) {
    warnings.push(
      `${inr(tcsDeducted + tdsDeducted)} of TCS and TDS is withheld in this file. Both are deposited against the ` +
      'company\'s own tax account and recovered at filing, so neither is charged to the P&L here.',
    )
  }

  return {
    validRecords: dated,
    totalRows: rows.length,
    invalidRows,
    warnings,
    months,
    charges,
    tcsDeducted,
    tdsDeducted,
    unmappedCodes: [...unmapped.entries()]
      .map(([code, v]) => ({ code, item: v.item, units: v.units }))
      .sort((a, b) => b.units - a.units),
  }
}
