import { describe, expect, it } from 'vitest'
import {
  detectNykaaCartRuleSheet, detectNykaaComboSheet, detectNykaaSalesSheet,
  normalizeNykaaWorkbook, nykaaMonthOf,
} from './nykaaSalesWorkbook'
import type { RawSheet } from '@/lib/csvParse'
import type { SkuMaster } from '@/data/models'

const SALES_HEADER = [
  'externorderno', 'skucode', 'sku_type', 'brand_name', 'invoiceno', 'orderdate', 'orderqty',
  'unit_mrp', 'row_mrp', 'row_discount', 'qty_at_mrp', 'return_qty', 'return_mrp2',
  'final_qty', 'final_mrp', 'final_sp', 'product_name', 'canonical_l1', 'canonical_l2', 'day_of_date',
  'final_subtotal',
]
// orderno, sku, type, brand, invoice, orderdate, orderqty, unit_mrp, row_mrp,
// row_discount, qty_at_mrp, return_qty, return_mrp2, final_qty, final_mrp,
// final_sp, name, l1, l2, day, final_subtotal
//
// The four prices are the point of the file: MRP → listed price
// (final_subtotal) → what was paid (final_sp). Tea Tree is listed 126 below
// MRP with no promotion on top; Rosemary is listed 244.40 below MRP and then
// carries the 175.60 coupon the Cart Rule file names.
const TEATREE = ['NYK-1', 'ARAVI00000002', 'SIMPLE', 'aravi organic', 'INV1', '2026-08-01 00:39:56', 3, 322, 966, 0, 3, 1, 322, 2, 644, 518, 'Tea Tree Oil', 'Bath & Body', 'Body Care', '2026-08-01', 518]
const ROSEMARY = ['NYK-2', 'ARAVI00000033', 'CONFIG', 'aravi organic', 'INV2', '2026-08-10 13:29:00', 2, 649, 1298, 175.6, 2, 0, 0, 2, 1298, 878, 'Rosemary Oil', 'Hair', 'Hair Care', '2026-08-10', 1053.6]
const NOTHING = ['NYK-3', 'ARAVI00000099', 'SIMPLE', 'aravi organic', 'INV3', '2026-08-11 10:00:00', 0, 299, 0, 0, 0, 0, 0, 0, 0, 0, 'Dormant SKU', 'Skin', 'Lip Care', '2026-08-11', 0]

const sales = (rows: (string | number)[][] = [TEATREE, ROSEMARY]): RawSheet => [SALES_HEADER, ...rows]

const CART: RawSheet = [
  ['nykaa_orderno', 'cart_rule_discount', 'discount_category'],
  ['NYK-2', 175.6, 'COUPON_NYKAA_FUNDED'],
]
const COMBO: RawSheet = [
  ['increment_id', 'sku', 'combo_sku', 'qty', 'mrp'],
  ['NYK-1', 'ARAVI00000002', 'ARAVI00000054', 2, 644],
]

const MASTER: SkuMaster[] = [
  {
    sku: 'AO/EO/TeaTree/15', productName: 'Aravi Organic Tea Tree Essential Oil - 15 ml', category: 'Essential Oils',
    brand: 'Aravi Organic', cogs: 44, mrp: 322, launchDate: '2024-01-01', status: 'active', leadTimeDays: 30, safetyStock: 0,
  },
]

describe('detection', () => {
  it('tells the three Nykaa files apart', () => {
    expect(detectNykaaSalesSheet(sales())).toBe(true)
    expect(detectNykaaCartRuleSheet(CART)).toBe(true)
    expect(detectNykaaComboSheet(COMBO)).toBe(true)
  })

  it('does not mistake one for another', () => {
    expect(detectNykaaSalesSheet(CART)).toBe(false)
    expect(detectNykaaSalesSheet(COMBO)).toBe(false)
    expect(detectNykaaCartRuleSheet(sales())).toBe(false)
  })
})

describe('nykaaMonthOf', () => {
  it('reads the month from the rows themselves', () => {
    expect(nykaaMonthOf(sales()).month).toBe('2026-08')
  })

  it('takes the month most rows fall in when a file straddles a boundary', () => {
    const straddle = [...Array(5)].map(() => [...TEATREE])
    straddle[0][19] = '2026-07-31'
    const r = nykaaMonthOf(sales(straddle))
    expect(r.month).toBe('2026-08')
    expect(r.months).toEqual(['2026-07', '2026-08'])
  })
})

describe('normalizeNykaaWorkbook', () => {
  const run = (rows?: (string | number)[][]) =>
    normalizeNykaaWorkbook(sales(rows), CART, COMBO, MASTER, [], 'imp')

  it('values the month at MRP, net of returns', () => {
    const f = run().facts!
    expect(f.grossSalesMrp).toBe(966 + 1298)
    expect(f.returnsMrp).toBe(322)
    expect(f.netSalesMrp).toBe(644 + 1298)
    expect(f.unitsShipped).toBe(5)
    expect(f.unitsReturned).toBe(1)
    expect(f.netUnits).toBe(4)
  })

  it('splits the shortfall against MRP into the listed price and the promotions', () => {
    const f = run().facts!
    expect(f.customerPaidValue).toBe(518 + 878)
    expect(f.customerPaidValue).toBeLessThan(f.netSalesMrp)
    // 1942 of MRP listed at 1571.60 and sold for 1396.
    expect(f.listDiscount).toBeCloseTo(370.4, 2)
    expect(f.promoDiscount).toBeCloseTo(175.6, 2)
    expect(f.listDiscount + f.promoDiscount).toBeCloseTo(f.netSalesMrp - f.customerPaidValue, 6)
  })

  it('charges us the shortfall, less only what Nykaa funds itself', () => {
    const f = run().facts!
    expect(f.nykaaFundedCoupon).toBeCloseTo(175.6, 2)
    expect(f.customerDiscount).toBeCloseTo(370.4, 2)
  })

  it('treats a coupon Nykaa did not fund as ours', () => {
    const brandFunded: RawSheet = [
      ['nykaa_orderno', 'cart_rule_discount', 'discount_category'],
      ['NYK-2', 100, 'COUPON_BRAND_FUNDED'],
    ]
    const r = normalizeNykaaWorkbook(sales(), brandFunded, COMBO, MASTER, [], 'imp')
    expect(r.facts!.nykaaFundedCoupon).toBe(0)
    // Nothing is credited back, so the whole 546 comes off.
    expect(r.facts!.customerDiscount).toBeCloseTo(370.4 + 175.6, 2)
    expect(r.warnings.some((w) => w.includes('not marked COUPON_NYKAA_FUNDED'))).toBe(true)
  })

  it('never pays us to discount, however large the cart-rule file is', () => {
    const overstated: RawSheet = [
      ['nykaa_orderno', 'cart_rule_discount', 'discount_category'],
      ['NYK-2', 99999, 'COUPON_NYKAA_FUNDED'],
    ]
    const r = normalizeNykaaWorkbook(sales(), overstated, COMBO, MASTER, [], 'imp')
    expect(r.facts!.customerDiscount).toBe(0)
  })

  it('checks the file\'s own arithmetic and reports the gap', () => {
    const r = run()
    expect(r.checks.every((c) => c.passed)).toBe(true)
    const broken = [...TEATREE]
    broken[14] = 999 // final_mrp no longer gross less returns
    const bad = normalizeNykaaWorkbook(sales([broken]), CART, COMBO, MASTER, [], 'imp')
    expect(bad.checks.find((c) => c.name.startsWith('Net MRP'))?.passed).toBe(false)
  })

  it('makes one aggregated row per SKU, restated on re-upload', () => {
    const r = run()
    expect(r.validRecords).toHaveLength(2)
    const tea = r.validRecords[0]
    expect(tea.orderId).toBe('nykaa-ARAVI00000002-2026-08')
    expect(tea.orderDate).toBe('2026-08-01')
    expect(tea.isAggregate).toBe(true)
    expect(tea.channel).toBe('nykaa')
    // Valued at MRP; the shopper's price is kept in raw for traceability.
    expect(tea.grossSales).toBe(966)
    expect(tea.netSales).toBe(644)
    expect(tea.quantity).toBe(2)
    expect(tea.returnUnits).toBe(1)
    expect(tea.raw?.final_sp).toBe(518)
    expect(tea.raw?.final_subtotal).toBe(518)
  })

  it('resolves the product through the SKU mapping and flags what is unlinked', () => {
    const mapped = normalizeNykaaWorkbook(sales(), CART, COMBO, MASTER, [
      { channelSku: 'ARAVI00000002', internalSku: 'AO/EO/TeaTree/15', kind: 'SINGLE', source: 'manual', verified: true },
    ], 'imp')
    expect(mapped.validRecords[0].productName).toBe('Aravi Organic Tea Tree Essential Oil - 15 ml')
    expect(mapped.validRecords[0].category).toBe('Essential Oils')
    expect(mapped.warnings.some((w) => w.includes('1 Nykaa SKU code(s) are not linked'))).toBe(true)
  })

  it('skips a SKU with no sales and no returns', () => {
    expect(run([TEATREE, NOTHING]).validRecords).toHaveLength(1)
  })

  it('imports nothing and says so when no date can be read', () => {
    const undated = sales([[...TEATREE].map((v, i) => (i === 5 || i === 19 ? '' : v))])
    const r = normalizeNykaaWorkbook(undated, CART, COMBO, MASTER, [], 'imp')
    expect(r.facts).toBeNull()
    expect(r.warnings[0]).toContain('report month is unknown')
  })

  it('works with no companion files at all', () => {
    const r = normalizeNykaaWorkbook(sales(), undefined, undefined, MASTER, [], 'imp')
    // Without the Cart Rule file nothing is known to be Nykaa-funded, so the
    // whole shortfall is charged to us — the safe direction to be wrong in.
    expect(r.facts!.nykaaFundedCoupon).toBe(0)
    expect(r.facts!.customerDiscount).toBeCloseTo(546, 2)
    expect(r.facts!.netSalesMrp).toBe(644 + 1298)
  })
})
