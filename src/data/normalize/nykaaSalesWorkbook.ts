import type { CanonicalSalesRecord, NykaaPnlFacts, SkuMaster } from '@/data/models'
import type { SkuMapping } from '@/data/skuMapping'
import type { RawSheet } from '@/lib/csvParse'
import { normalizeCategory } from '@/data/categories'
import { toMonthKey } from '@/lib/format'
import { parseIsoLocalDate } from '@/lib/reportDate'
import type { NormalizeResult } from './types'

/**
 * Nykaa's monthly data drop — three files, each read for one thing.
 *
 *  - **Sales** (`externorderno`, `skucode`, `row_mrp` …): every invoice line of
 *    the month. This is the only file the P&L is built from.
 *  - **Cart Rule** (`nykaa_orderno`, `cart_rule_discount` …): not a separate
 *    discount but a breakdown of part of `row_discount`, naming which coupons
 *    Nykaa funded itself. August's 154 cart-rule orders carry ₹6,165.03 there
 *    against ₹6,271.29 of `row_discount` on the same orders, which is what
 *    says it is a subset rather than an addition.
 *  - **Combo** (`increment_id`, `combo_sku` …): which component SKU sits inside
 *    which bundle. It restates rows the Sales file already counts, so it is
 *    never added to revenue.
 *
 * The Sales file prices every line four times, and the whole statement turns on
 * telling them apart. On one August row: `row_mrp` 322 is the printed price,
 * `row_subtotal` 259 is what the product is listed at, `row_discount` 0 is any
 * promotion on top, and `row_sp` 259 is what the shopper paid.
 * `row_subtotal − row_discount = row_sp` holds on all 6,513 rows.
 *
 * Revenue comes from MRP, because MRP is what Nykaa raises its PO on. But the
 * shortfall against MRP is not somebody else's problem: Nykaa sells below MRP
 * and charges the difference back to us on a Financial Debit Note. So the gap
 * is split out here as a cost — ₹6.90 lakh of list discount plus ₹0.99 lakh of
 * promotions in August, against a net MRP of ₹26.90 lakh.
 *
 * The file's own `ret_yes_no` flag is not the return signal. It reads "No" on
 * all 6,513 August rows including the 294 that carry a return quantity, so
 * returns are taken from `return_qty` / `return_mrp2`, which are populated and
 * internally consistent: shipped less returned equals the `final_*` columns on
 * every row.
 */

const SALES_HEADERS = {
  orderNo: 'externorderno',
  sku: 'skucode',
  skuType: 'sku_type',
  invoiceNo: 'invoiceno',
  orderDate: 'orderdate',
  day: 'day_of_date',
  unitMrp: 'unit_mrp',
  rowMrp: 'row_mrp',
  qtyShipped: 'qty_at_mrp',
  returnQty: 'return_qty',
  returnMrp: 'return_mrp2',
  finalQty: 'final_qty',
  finalMrp: 'final_mrp',
  finalSubtotal: 'final_subtotal',
  finalSp: 'final_sp',
  productName: 'product_name',
  l1: 'canonical_l1',
  l2: 'canonical_l2',
  l3: 'canonical_l3',
}

const CARTRULE_HEADERS = { orderNo: 'nykaa_orderno', discount: 'cart_rule_discount', category: 'discount_category' }
const COMBO_HEADERS = { orderNo: 'increment_id', comboSku: 'combo_sku', sku: 'sku', qty: 'qty', mrp: 'mrp' }

export interface NykaaWorkbookResult extends NormalizeResult {
  facts: NykaaPnlFacts | null
  month: string
  checks: { name: string; passed: boolean; detail: string }[]
}

function headerIndex(sheet: RawSheet): Map<string, number> {
  const index = new Map<string, number>()
  const header = sheet[0] ?? []
  header.forEach((cell, i) => {
    const key = String(cell ?? '').replace(/^﻿/, '').trim().toLowerCase()
    if (key !== '' && !index.has(key)) index.set(key, i)
  })
  return index
}

function num(raw: unknown): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0
  const text = String(raw ?? '').trim()
  if (text === '' || text === '-') return 0
  const value = Number(text.replace(/[^0-9.-]/g, ''))
  return Number.isFinite(value) ? value : 0
}

export function detectNykaaSalesSheet(sheet: RawSheet): boolean {
  const index = headerIndex(sheet)
  return index.has(SALES_HEADERS.orderNo) && index.has(SALES_HEADERS.rowMrp) && index.has(SALES_HEADERS.finalMrp)
}

export function detectNykaaCartRuleSheet(sheet: RawSheet): boolean {
  const index = headerIndex(sheet)
  return index.has(CARTRULE_HEADERS.orderNo) && index.has(CARTRULE_HEADERS.discount)
}

export function detectNykaaComboSheet(sheet: RawSheet): boolean {
  const index = headerIndex(sheet)
  return index.has(COMBO_HEADERS.orderNo) && index.has(COMBO_HEADERS.comboSku)
}

/**
 * The month the file covers, from the dates on its rows.
 *
 * Read from `day_of_date` (already `yyyy-mm-dd`) rather than the `orderdate`
 * timestamp, and never through UTC — a report date is a calendar date, and
 * putting one through UTC is what filed every Amazon USA month under the
 * previous one.
 */
export function nykaaMonthOf(sheet: RawSheet): { month: string; months: string[] } {
  const index = headerIndex(sheet)
  const dayCol = index.get(SALES_HEADERS.day)
  const orderCol = index.get(SALES_HEADERS.orderDate)
  const counts = new Map<string, number>()
  for (const row of sheet.slice(1)) {
    const raw = String((dayCol !== undefined ? row[dayCol] : undefined) ?? (orderCol !== undefined ? row[orderCol] : '') ?? '')
    const date = parseIsoLocalDate(raw)
    if (!date) continue
    const key = toMonthKey(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const months = [...counts.keys()].sort()
  // The month most rows fall in. A file that straddles a boundary by a few
  // rows still belongs to the month it is named for.
  let month = ''
  let best = 0
  for (const [key, n] of counts) if (n > best) { month = key; best = n }
  return { month, months }
}

/**
 * Turns Nykaa's month into one statement plus one aggregated sales row per SKU.
 *
 * COGS is left at zero. Nykaa does not know what the goods cost us, and
 * pricing them at import would freeze the month at whatever the cost sheet
 * said on upload day; the statement is priced when it is read, by the same
 * effective-dated cost engine every other channel uses.
 */
export function normalizeNykaaWorkbook(
  sales: RawSheet,
  cartRule: RawSheet | undefined,
  combo: RawSheet | undefined,
  skuMaster: SkuMaster[],
  mappings: SkuMapping[],
  importId: string,
): NykaaWorkbookResult {
  const validRecords: CanonicalSalesRecord[] = []
  const invalidRows: NormalizeResult['invalidRows'] = []
  const warnings: string[] = []
  const checks: NykaaWorkbookResult['checks'] = []

  const index = headerIndex(sales)
  const col = (name: string): number => index.get(name) ?? -1
  const at = (row: (string | number)[], name: string): number => {
    const i = col(name)
    return i < 0 ? 0 : num(row[i])
  }
  const text = (row: (string | number)[], name: string): string => {
    const i = col(name)
    return i < 0 ? '' : String(row[i] ?? '').trim()
  }

  const { month, months } = nykaaMonthOf(sales)
  if (!month) {
    return {
      validRecords, totalRows: 0, invalidRows,
      warnings: ['No readable date was found in the Sales file, so the report month is unknown. Nothing was imported.'],
      facts: null, month: '', checks,
    }
  }
  if (months.length > 1) {
    warnings.push(
      `The Sales file spans ${months.length} months (${months.join(', ')}). It has been imported as ${month}, ` +
      'which holds most of its rows. Upload one month per file if that is not right.',
    )
  }

  const rows = sales.slice(1).filter((r) => text(r, SALES_HEADERS.sku) !== '')

  // --- Per-SKU aggregation ------------------------------------------------
  interface Bucket {
    grossMrp: number; returnsMrp: number; netMrp: number
    shipped: number; returned: number; netQty: number
    customerPaid: number; netSubtotal: number
    productName: string; category: string
  }
  const bySku = new Map<string, Bucket>()
  const orders = new Set<string>()

  for (const row of rows) {
    const sku = text(row, SALES_HEADERS.sku)
    const orderNo = text(row, SALES_HEADERS.orderNo)
    if (orderNo !== '') orders.add(orderNo)

    const bucket = bySku.get(sku) ?? {
      grossMrp: 0, returnsMrp: 0, netMrp: 0, shipped: 0, returned: 0, netQty: 0,
      customerPaid: 0, netSubtotal: 0,
      productName: text(row, SALES_HEADERS.productName),
      // Nykaa's own taxonomy is three levels deep; the middle one is the
      // closest thing to the categories the rest of the dashboard uses.
      category: text(row, SALES_HEADERS.l2) || text(row, SALES_HEADERS.l1),
    }
    bucket.grossMrp += at(row, SALES_HEADERS.rowMrp)
    bucket.returnsMrp += at(row, SALES_HEADERS.returnMrp)
    bucket.netMrp += at(row, SALES_HEADERS.finalMrp)
    bucket.shipped += at(row, SALES_HEADERS.qtyShipped)
    bucket.returned += at(row, SALES_HEADERS.returnQty)
    bucket.netQty += at(row, SALES_HEADERS.finalQty)
    bucket.customerPaid += at(row, SALES_HEADERS.finalSp)
    // Both discount figures are taken net of returns, like every other line
    // here: a returned unit's discount is not recovered from us either.
    bucket.netSubtotal += at(row, SALES_HEADERS.finalSubtotal)
    bySku.set(sku, bucket)
  }

  const internalBySku = new Map(mappings.map((m) => [m.channelSku, m.internalSku]))
  const master = new Map(skuMaster.map((s) => [s.sku, s]))
  const orderDate = `${month}-01`
  let unmappedSkus = 0

  for (const [sku, b] of bySku) {
    if (b.grossMrp === 0 && b.netQty === 0 && b.returned === 0) continue
    const internalSku = internalBySku.get(sku) ?? sku
    const product = master.get(internalSku) ?? master.get(sku)
    if (!product) unmappedSkus++

    validRecords.push({
      // One row per SKU per month, so the month is part of the identity: a
      // corrected file restates the month instead of adding a second copy.
      orderId: `nykaa-${sku}-${month}`,
      orderDate,
      channel: 'nykaa',
      marketplace: 'nykaa',
      sellerType: 'marketplace',
      sku,
      productName: product?.productName ?? b.productName ?? sku,
      category: normalizeCategory(product?.category ?? b.category),
      // Net units — a returned unit is not a unit sold.
      quantity: b.netQty,
      // Valued at MRP, because MRP is what Nykaa trades on and what it pays
      // against. The shopper's price is carried in `raw` and shown as a memo.
      grossSales: b.grossMrp,
      discount: 0,
      netSales: b.netMrp,
      returnUnits: b.returned,
      rtoUnits: 0,
      shippingCost: 0,
      marketplaceFee: 0,
      tax: 0,
      status: 'completed',
      currency: 'INR',
      isAggregate: true,
      raw: {
        skucode: sku,
        product_name: b.productName,
        row_mrp: b.grossMrp,
        return_mrp2: b.returnsMrp,
        final_mrp: b.netMrp,
        qty_at_mrp: b.shipped,
        return_qty: b.returned,
        final_qty: b.netQty,
        final_subtotal: b.netSubtotal,
        final_sp: b.customerPaid,
      },
      importId,
    })
  }

  const total = (pick: (b: Bucket) => number): number =>
    [...bySku.values()].reduce((sum, b) => sum + pick(b), 0)

  // --- Cart Rule: the one slice of the discount Nykaa pays for itself -----
  //
  // Everything Nykaa sells below MRP comes back to us on the debit note,
  // except what Nykaa funded. This file is the only place that split is
  // stated, so a month without it is read as nothing being Nykaa-funded —
  // which errs towards charging ourselves too much rather than too little.
  let nykaaFundedCoupon = 0
  let otherCartRuleDiscount = 0
  if (cartRule && cartRule.length > 1) {
    const cIndex = headerIndex(cartRule)
    const dCol = cIndex.get(CARTRULE_HEADERS.discount)
    const catCol = cIndex.get(CARTRULE_HEADERS.category)
    for (const row of cartRule.slice(1)) {
      if (dCol === undefined) break
      const value = num(row[dCol])
      const category = catCol === undefined ? '' : String(row[catCol] ?? '').toUpperCase()
      if (category.includes('NYKAA_FUNDED')) nykaaFundedCoupon += value
      else otherCartRuleDiscount += value
    }
  }

  const netSalesMrp = total((b) => b.netMrp)
  const netSubtotal = total((b) => b.netSubtotal)
  const customerPaidValue = total((b) => b.customerPaid)
  // MRP → listed price → what was paid. Splitting the shortfall in two is what
  // lets the statement show whether the month was discounted by how the goods
  // are priced or by what was run on top of that price.
  const listDiscount = netSalesMrp - netSubtotal
  const promoDiscount = netSubtotal - customerPaidValue
  // A Nykaa-funded coupon is the one part of the shortfall Nykaa absorbs, so
  // it is credited back out of what the debit note can charge us. It is never
  // allowed to turn the deduction negative — a cart-rule file covering orders
  // the sales file does not carry would otherwise pay us to discount.
  const customerDiscount = Math.max(listDiscount + promoDiscount - nykaaFundedCoupon, 0)

  const facts: NykaaPnlFacts = {
    month,
    grossSalesMrp: total((b) => b.grossMrp),
    returnsMrp: total((b) => b.returnsMrp),
    netSalesMrp,
    unitsShipped: total((b) => b.shipped),
    unitsReturned: total((b) => b.returned),
    netUnits: total((b) => b.netQty),
    orders: orders.size,
    customerPaidValue,
    listDiscount,
    promoDiscount,
    nykaaFundedCoupon,
    customerDiscount,
    cogsPriced: 0,
    cogsUnpriced: 0,
    nykaaAds: 0,
  }

  // --- Cross-checks against the file's own arithmetic ---------------------
  const check = (name: string, expected: number, actual: number, tolerance: number): void => {
    const gap = actual - expected
    checks.push({
      name,
      passed: Math.abs(gap) <= tolerance,
      detail: `${expected.toFixed(2)} vs ${actual.toFixed(2)} (gap ${gap.toFixed(2)})`,
    })
  }
  check('Net MRP = Gross MRP − Returns MRP', facts.grossSalesMrp - facts.returnsMrp, facts.netSalesMrp, 1)
  check('Net units = Shipped − Returned', facts.unitsShipped - facts.unitsReturned, facts.netUnits, 0.5)
  // The two halves of the discount must account for the whole shortfall. If
  // they ever do not, the file has a fifth price column and the deduction is
  // reading the wrong one.
  check(
    'List + promo discount = Net MRP − what shoppers paid',
    facts.netSalesMrp - facts.customerPaidValue, facts.listDiscount + facts.promoDiscount, 1,
  )

  if (combo && combo.length > 1) {
    const kIndex = headerIndex(combo)
    const qCol = kIndex.get(COMBO_HEADERS.qty)
    const comboUnits = qCol === undefined ? 0 : combo.slice(1).reduce((s, r) => s + num(r[qCol]), 0)
    if (comboUnits > 0) {
      warnings.push(
        `${comboUnits.toLocaleString('en-IN')} unit(s) of the month came through ${new Set(
          combo.slice(1).map((r) => String(r[kIndex.get(COMBO_HEADERS.comboSku) ?? -1] ?? '')),
        ).size} combo SKU(s). The Combo file restates rows the Sales file already counts, so it adds nothing to revenue — ` +
        'it is read only to show which components sit inside each bundle.',
      )
    }
  }

  if (unmappedSkus > 0) {
    warnings.push(
      `${unmappedSkus} Nykaa SKU code(s) are not linked to a Unicommerce SKU, so they carry no cost and no category. ` +
      'Link them on the SKU Mapping screen to get COGS and contribution for Nykaa.',
    )
  }
  if (otherCartRuleDiscount > 0) {
    warnings.push(
      `₹${otherCartRuleDiscount.toFixed(2)} of the Cart Rule file is not marked COUPON_NYKAA_FUNDED, so it has been ` +
      'treated as ours and left inside the discount Nykaa recovers. Check the rule names if that is wrong.',
    )
  }

  const inr = (v: number): string => `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
  const pctOfMrp = facts.netSalesMrp > 0 ? (facts.customerDiscount / facts.netSalesMrp) * 100 : 0
  warnings.push(
    `Revenue is built from MRP (${inr(facts.netSalesMrp)} net), because that is what Nykaa raises its PO on. ` +
    `Shoppers paid ${inr(facts.customerPaidValue)}, and the ${inr(facts.customerDiscount)} of that shortfall ` +
    `(${pctOfMrp.toFixed(1)}% of MRP — ${inr(facts.listDiscount)} off the printed price, ${inr(facts.promoDiscount)} of ` +
    `promotions${nykaaFundedCoupon > 0 ? `, less ${inr(nykaaFundedCoupon)} Nykaa funds itself` : ''}) is deducted: ` +
    'Nykaa recovers it by debit note, raised without GST, so none of it comes back as input credit.',
  )

  return { validRecords, totalRows: rows.length, invalidRows, warnings, facts, month, checks }
}
