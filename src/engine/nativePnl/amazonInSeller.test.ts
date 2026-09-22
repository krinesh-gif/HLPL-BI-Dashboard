import { describe, expect, it } from 'vitest'
import {
  AMAZON_IN_SELLER_LINE_DEFS, amazonInSellerToCanonicalBuckets, applyAmazonInSellerOtherCosts,
  computeAmazonInSellerPnl, settlementBucketOf,
} from './amazonInSeller'
import { computeSubtotals } from '@/engine/pnl'
import type { AmazonInSellerPnlFacts } from '@/data/models'

/**
 * August 2026, at the shape and scale the five weekly settlements report.
 *
 * The deposit is summed from the amounts rather than typed in, because that
 * is the invariant a real settlement has: every row in the file adds up to
 * what Amazon paid. Typing it separately would only test the arithmetic in
 * this file.
 */
const AMOUNTS: Record<string, number> = {
  'order.itemprice.principal': 61143.38, 'order.itemprice.shipping': 550.60,
  'refund.itemprice.principal': -8875.47, 'refund.itemprice.shipping': -84.70,
  'order.promotion.shipping-discount': -466.40, 'order.promotion.promo-rebates': -321.53,
  'refund.promotion.shipping-discount': 84.70, 'refund.promotion.promo-rebates': 83.91,
  'order.itemprice.product-tax': 11005.81, 'order.itemprice.shipping-tax': 99.10,
  'refund.itemprice.product-tax': -1597.53, 'refund.itemprice.shipping-tax': -15.24,
  'order.promotion.shipping-tax-discount': -83.86, 'order.promotion.product-tax-discount': -57.86,
  'refund.promotion.shipping-tax-discount': 15.24, 'refund.promotion.product-tax-discount': 15.11,
  'order.itemtcs.tcs-igst': -251.82, 'order.itemtcs.tcs-sgst': -26.48,
  'order.itemtcs.tcs-cgst': -26.48, 'refund.itemtcs.tcs-igst': 44.18,
  'order.itemtds.tds-section-194-o': -62.32,
  'order.itemfees.commission': -4995.60, 'refund.itemfees.commission': 688.27,
  'order.itemfees.commission-igst': -884.61, 'refund.itemfees.commission-igst': 123.83,
  'order.itemfees.fixed-closing-fee': -3773.00, 'refund.itemfees.fixed-closing-fee': 543.00,
  'order.itemfees.fixed-closing-fee-igst': -670.65, 'refund.itemfees.fixed-closing-fee-igst': 97.74,
  'order.itemfees.fba-weight-handling-fee': -1176.00, 'order.itemfees.fba-pick-pack-fee': -493.00,
  'fulfillment-fee-refund.item-fee-adjustment.fba-weight-handling-fee': 147.00,
  'fulfillment-fee-refund.item-fee-adjustment.fba-pick-pack-fee': 59.00,
  'fbafees.fba-inventory-storage-fee.base-fee': -9.00,
  'other-transaction.other-transaction.amazon-easy-ship-charges': -3398.00,
  'other-transaction.other-transaction.mfnpostagepurchasecompleteigst': -611.64,
  'other-transaction.untyped.amazon-easy-ship-weight-handling-fee-reversal': 623.00,
  'other-transaction.untyped.amazon-easy-ship-weight-handling-fee-reversal-igst': 112.14,
  'other.other-transactions.reimbursement-for-lost-packages': 1584.17,
  'other-transaction.fba-inventory-reimbursement.reversal-reimbursement': 1408.43,
  'order.itemfees.fba-weight-handling-fee-cgst': -105.84, 'order.itemfees.fba-weight-handling-fee-sgst': -105.84,
  'order.itemfees.fba-pick-pack-fee-cgst': -44.37, 'order.itemfees.fba-pick-pack-fee-sgst': -44.37,
  'fulfillment-fee-refund.item-fee-adjustment.fba-weight-handling-fee-cgst': 13.23,
  'fulfillment-fee-refund.item-fee-adjustment.fba-weight-handling-fee-sgst': 13.23,
  'fulfillment-fee-refund.item-fee-adjustment.fba-pick-pack-fee-cgst': 5.31,
  'fulfillment-fee-refund.item-fee-adjustment.fba-pick-pack-fee-sgst': 5.31,
  'fbafees.fba-inventory-storage-fee.tax-on-fee-cgst': -0.82,
  'fbafees.fba-inventory-storage-fee.tax-on-fee-sgst': -0.82,
}

const AUG: AmazonInSellerPnlFacts = {
  month: '2026-08', schemaVersion: 1, settlementIds: ['1', '2', '3', '4', '5'],
  settlementTotal: Object.values(AMOUNTS).reduce((s, v) => s + v, 0),
  orders: 92, units: 86, amounts: AMOUNTS,
}

describe('settlementBucketOf', () => {
  it('reads tax withheld as withheld, never as recoverable fee credit', () => {
    // TCS ends in -igst exactly like a fee tax does. Reading it as input
    // credit would claim back money Amazon is holding against our own tax.
    expect(settlementBucketOf('order.itemtcs.tcs-igst')).toBe('tcs')
    expect(settlementBucketOf('order.itemfees.commission-igst')).toBe('feeGst')
    expect(settlementBucketOf('order.itemtds.tds-section-194-o')).toBe('tds')
  })

  it('separates the tax on a sale from the tax on a fee', () => {
    expect(settlementBucketOf('order.itemprice.product-tax')).toBe('outputGst')
    expect(settlementBucketOf('fbafees.fba-inventory-storage-fee.tax-on-fee-cgst')).toBe('feeGst')
  })

  it('reads a refunded principal as a return, not a smaller sale', () => {
    expect(settlementBucketOf('refund.itemprice.principal')).toBe('returns')
    expect(settlementBucketOf('order.itemprice.principal')).toBe('grossSales')
  })

  it('puts a description it has never seen on the unrecognised line', () => {
    expect(settlementBucketOf('order.itemfees.some-new-amazon-charge')).toBe('unrecognised')
  })
})

describe('computeAmazonInSellerPnl', () => {
  const v = computeAmazonInSellerPnl(AUG)

  it('has a value for every line it declares', () => {
    for (const def of AMAZON_IN_SELLER_LINE_DEFS) {
      expect(Number.isFinite(v[def.key]), `${def.key} has no value`).toBe(true)
    }
  })

  it('ties every line back to what Amazon actually deposited', () => {
    // The one check that cannot be allowed to fail quietly: a statement built
    // from a bank credit has to add back up to it.
    expect(v.settlementCheck).toBeCloseTo(0, 6)
    expect(v.settlementTotal).toBeGreaterThan(40000)
  })

  it('recognises every charge in a real month', () => {
    expect(v.unrecognised).toBe(0)
  })

  it('shows the fees this channel was reporting none of', () => {
    expect(v.totalFees).toBeLessThan(0)
    expect(v.feesPctOfSales).toBeGreaterThan(15)
    expect(v.feesPctOfSales).toBeCloseTo((-v.totalFees / v.netSales) * 100, 6)
  })

  it('keeps GST and withheld tax out of every margin', () => {
    const noTax = computeAmazonInSellerPnl({
      ...AUG,
      amounts: Object.fromEntries(
        Object.entries(AUG.amounts).filter(([k]) => !['outputGst', 'feeGst', 'tcs', 'tds'].includes(settlementBucketOf(k))),
      ),
    })
    expect(noTax.netSales).toBeCloseTo(v.netSales, 6)
    expect(noTax.cm2).toBeCloseTo(v.cm2, 6)
  })

  it('carries CM2 down to Net Profit until fixed expenses are allocated', () => {
    expect(v.cm3).toBeCloseTo(v.cm2, 6)
    const withCosts = applyAmazonInSellerOtherCosts(v, 5000)
    expect(withCosts.otherCosts).toBe(-5000)
    expect(withCosts.cm3).toBeCloseTo(v.cm2 - 5000, 6)
  })

  it('still ties to the deposit when Amazon invents a new charge', () => {
    const withNew = computeAmazonInSellerPnl({
      ...AUG,
      amounts: { ...AUG.amounts, 'order.itemfees.brand-new-charge': -250 },
      settlementTotal: AUG.settlementTotal - 250,
    })
    expect(withNew.unrecognised).toBeCloseTo(-250, 6)
    expect(withNew.settlementCheck).toBeCloseTo(0, 2)
    expect(withNew.totalFees).toBeCloseTo(v.totalFees - 250, 6)
  })
})

describe('amazonInSellerToCanonicalBuckets', () => {
  it('reports the same Net Sales and contribution as the statement', () => {
    const native = computeAmazonInSellerPnl(AUG)
    const canonical = computeSubtotals(amazonInSellerToCanonicalBuckets(AUG))
    expect(canonical.netSales).toBeCloseTo(native.netSales, 6)
    expect(canonical.contributionProfit).toBeCloseTo(native.cm2, 6)
  })

  it('leaves GST and withheld tax out of every bucket', () => {
    const b = amazonInSellerToCanonicalBuckets(AUG)
    const total = Object.values(b).reduce((s, x) => s + (x ?? 0), 0)
    expect(Number.isFinite(total)).toBe(true)
    // Gross Sales is ex-GST, as the settlement states it.
    expect(b.grossSales).toBeCloseTo(61143.38 + 550.60, 2)
  })
})
