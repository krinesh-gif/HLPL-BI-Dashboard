import type { CanonicalSalesRecord, SkuMaster } from '@/data/models'
import type { ComboComponent, SkuMapping } from '@/data/skuMapping'
import { mappedCodeFor, resolveGstPct } from '@/data/skuMapping'
import { normalizeCategory } from '@/data/categories'
import { getField, headersPresent, type NormalizeResult } from './types'

/**
 * Tata 1mg's monthly sales register.
 *
 * It is written as an invoice register rather than as a marketplace report:
 * one row per bill line, with the customer, the batch, the HSN code and the
 * expiry on it. What matters for the P&L is four columns — the bill date,
 * the quantity, `Product MRP` and `SALE RATE`.
 *
 * **`SALE RATE` is the line total, not a unit price.** Two shampoos at ₹311
 * MRP come to ₹573.98, two serums at ₹666 to ₹1,044.02. Dividing it by
 * quantity to get a unit price and multiplying back would be the same
 * number; reading it as a unit price and multiplying would double the four
 * multi-unit lines in August. It is taken as the line.
 *
 * **It includes GST, and the rate is on the row.** The register states
 * `SGST%`, `CGST%` and `IGST%`, and August runs at both 5% and 18% — 34
 * lines against 56 — so one rate for the file would be wrong either way.
 * The Product Master decides the rate as it does on every channel here, and
 * the register's own rate stands in where the Master has none; where the two
 * disagree the codes are named, because one of the two invoices is wrong.
 *
 * **It states nothing Tata 1mg took and nothing that came back.** There is
 * no commission, no logistics charge, no payout, no return and no
 * cancellation — every row is a `SalesOrder`. So the statement runs to net
 * sales and stops, and the month's returns are unknown rather than nil.
 */
const COLUMNS = {
  voucherType: ['voucher type'],
  orderId: ['order id'],
  billNo: ['bill no'],
  billDate: ['bill date'],
  itemId: ['item id'],
  itemName: ['item name'],
  mrp: ['product mrp'],
  batchMrp: ['batch mrp'],
  qty: ['qty', 'quantity'],
  saleRate: ['sale rate'],
  hsn: ['hsn'],
  sgstPct: ['sgst%', 'sgst %', 'sgst'],
  cgstPct: ['cgst%', 'cgst %', 'cgst'],
  igstPct: ['igst%', 'igst %', 'igst'],
  brand: ['brand name'],
  packForm: ['pack form'],
}

const REQUIRED = ['billDate', 'itemId', 'qty', 'saleRate'] as const

export function detectTata1mgSalesReport(headers: string[]): boolean {
  return REQUIRED.every((field) => headersPresent(headers, COLUMNS[field]))
    // A bill number and a voucher type beside a sale rate are what make this
    // 1mg's register rather than any other invoice list.
    && headersPresent(headers, COLUMNS.billNo)
    && headersPresent(headers, COLUMNS.voucherType)
}

function num(raw: string | undefined): number {
  if (raw === undefined) return 0
  const text = raw.replace(/[₹,\s]/g, '')
  if (text === '' || text === '-') return 0
  const n = Number(text)
  return Number.isFinite(n) ? n : 0
}

/** 1mg writes `dd-mm-yyyy`, day first as Indian registers are written. */
export function tata1mgDate(raw: string | undefined): string | null {
  const text = String(raw ?? '').trim()
  if (text === '') return null
  const dmy = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(text)
  if (dmy) {
    const [, d, m, y] = dmy
    if (Number(m) < 1 || Number(m) > 12 || Number(d) < 1 || Number(d) > 31) return null
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text)
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null
}

export interface Tata1mgNormalizeResult extends NormalizeResult {
  months: string[]
  totals: { mrpValue: number; saleRateInclGst: number; units: number; bills: number; outputGst: number }
}

export function normalizeTata1mgSalesReport(
  rows: Record<string, string>[],
  skuMaster: SkuMaster[],
  mappings: SkuMapping[],
  comboComponents: ComboComponent[],
  importId: string,
): Tata1mgNormalizeResult {
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
  const monthsSeen = new Set<string>()
  const bills = new Set<string>()
  const totals = { mrpValue: 0, saleRateInclGst: 0, units: 0, bills: 0, outputGst: 0 }

  rows.forEach((row, index) => {
    const field = (name: keyof typeof COLUMNS): string | undefined => getField(row, COLUMNS[name])
    // 1mg writes its own catalogue id in ITEM ID on some lines and our SKU
    // code on others, and both are what the SKU map is keyed on.
    const sku = (field('itemId') ?? '').trim()
    const date = tata1mgDate(field('billDate'))
    if (!sku && date === null) return
    if (date === null) {
      invalidRows.push({ rowIndex: index, reason: `Unreadable bill date: "${field('billDate') ?? ''}"` })
      return
    }
    if (!sku) {
      invalidRows.push({ rowIndex: index, reason: 'Missing ITEM ID' })
      return
    }

    const qty = num(field('qty'))
    const mrp = num(field('mrp')) || num(field('batchMrp'))
    const saleRate = num(field('saleRate'))

    // Read as the SKU map spells the code where only the separator differs.
    const code = mappedCodeFor(sku, mappingTables) ?? sku
    if (code !== sku) respelled.set(sku, code)

    let masterRate = gstByCode.get(code)
    if (masterRate === undefined) {
      masterRate = resolveGstPct(code, mappingTables)
      gstByCode.set(code, masterRate)
    }
    // IGST where the sale crossed a state line, the two halves where it did
    // not; the register fills both columns and they agree.
    const statedRate = (num(field('igstPct')) || num(field('cgstPct')) + num(field('sgstPct'))) / 100
    if (masterRate !== null && statedRate > 0 && Math.abs(masterRate - statedRate) > 0.0001) gstMismatch.add(sku)
    const rate = masterRate ?? (statedRate > 0 ? statedRate : null)
    if (rate === null) gstMissing.add(sku)

    const gst = rate !== null ? saleRate - saleRate / (1 + rate) : 0
    const grossAtMrp = mrp * qty

    const internalSku = internalBySku.get(code) ?? code
    const product = master.get(internalSku) ?? master.get(sku)

    monthsSeen.add(date.slice(0, 7))
    bills.add(String(field('billNo') ?? field('orderId') ?? index))
    totals.mrpValue += grossAtMrp
    totals.saleRateInclGst += saleRate
    totals.outputGst += gst
    totals.units += qty

    validRecords.push({
      orderId: String(field('orderId') ?? field('billNo') ?? `tata1mg-${index}`),
      // One bill can carry several lines, and two lines of one bill would
      // otherwise collide on the de-dup key.
      lineId: `${sku}-${index}`,
      orderDate: date,
      channel: 'tata_1mg',
      marketplace: 'tata_1mg',
      sellerType: 'marketplace',
      // Stored as the Product Master and SKU map spell it, so cost,
      // category and tax all resolve from one code.
      sku: code,
      productName: product?.productName ?? (field('itemName') ?? sku),
      category: normalizeCategory(product?.category ?? ''),
      quantity: qty,
      grossSales: grossAtMrp > 0 ? grossAtMrp : saleRate,
      discount: grossAtMrp > saleRate ? grossAtMrp - saleRate : 0,
      netSales: saleRate - gst,
      returnUnits: 0,
      rtoUnits: 0,
      shippingCost: 0,
      // Nothing: the register states no commission. Missing, not zero.
      marketplaceFee: 0,
      tax: gst,
      // The gross is an MRP, so the GST is inside it, not charged on top.
      taxInGross: true,
      status: 'completed',
      currency: 'INR',
      importId,
    })
  })

  totals.bills = bills.size
  const months = [...monthsSeen].sort()
  const inr = (v: number): string => `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

  if (months.length > 1) {
    warnings.push(
      `These rows cover ${months.length} months (${months.join(', ')}). Each is filed under its own bill month; ` +
      'upload one month at a time if that was not intended.',
    )
  }
  warnings.push(
    `Read on bill date. ${totals.bills} bill(s), ${totals.units} unit(s): ${inr(totals.saleRateInclGst)} invoiced ` +
    `including GST against ${inr(totals.mrpValue)} of MRP, with ${inr(totals.outputGst)} of GST taken out at each ` +
    "product's own rate from the Product Master.",
  )
  warnings.push(
    'Every row in this register is a SalesOrder: it carries no return, no cancellation and no credit note, and ' +
    'nothing Tata 1mg charged — no commission, no logistics, no payout. So the month shows no returns because ' +
    'none are stated, not because there were none, and the statement runs to net sales and stops.',
  )
  if (respelled.size > 0) {
    const pairs = [...respelled.entries()].map(([file, mapped]) => `${file} → ${mapped}`)
    const shown = pairs.slice(0, 6).join(', ')
    const rest = pairs.length - 6
    warnings.push(
      `${pairs.length} 1mg code(s) differ from the SKU map only in their separators and were read as ` +
      `the map spells them: ${shown}${rest > 0 ? ` and ${rest} more` : ''}. Add the channel's spelling on ` +
      'Catalogue ▸ SKU Mapping to make it explicit.',
    )
  }
  if (gstMissing.size > 0) {
    const codes = [...gstMissing].sort()
    const shown = codes.slice(0, 8).join(', ')
    const rest = codes.length - 8
    warnings.push(
      `${codes.length} 1mg item id(s) have no GST rate in the Product Master and none on the register, so their ` +
      `sales are shown with no tax taken out: ${shown}${rest > 0 ? ` and ${rest} more` : ''}. Link them on ` +
      'Catalogue ▸ SKU Mapping and set the rate on Product Master.',
    )
  }
  if (gstMismatch.size > 0) {
    const codes = [...gstMismatch].sort()
    const shown = codes.slice(0, 8).join(', ')
    const rest = codes.length - 8
    warnings.push(
      `${codes.length} 1mg item id(s) are invoiced on this register at a GST rate that differs from the Product ` +
      `Master: ${shown}${rest > 0 ? ` and ${rest} more` : ''}. The statement uses the Master.`,
    )
  }

  return { validRecords, totalRows: rows.length, invalidRows, warnings, months, totals }
}
