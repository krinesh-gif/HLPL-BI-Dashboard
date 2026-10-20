import { describe, expect, it } from 'vitest'
import {
  AMAZON_IN_VENDOR_LINE_DEFS,
  amazonInVendorToCanonicalBuckets,
  applyAmazonInVendorOtherCosts,
  computeAmazonInVendorPnl,
  vendorContraCogs,
  type VendorCogs,
} from './amazonInVendor'
import { computeSubtotals } from '../pnl'
import type { AmazonInVendorFacts } from '@/data/models'

/**
 * The owner's own months, as the NPPM files read. Nothing here is invented:
 * each row is what the file states, and the contra-COGS in every one of them
 * is exactly (contracted − achieved) × GMS.
 */
const MONTHS: Record<string, AmazonInVendorFacts> = {
  april: {
    month: '2026-04', schemaVersion: 1, periodStart: '2026-04-01', periodEnd: '2026-04-30',
    netShippedGms: 2369808.774263007, netPpm: 491267.5199980073, invoiceValue: 2369808.774263007 - 491267.5199980073,
    unitsShipped: 10926, marginClosedPct: 0.31, marginAchievedPct: 0.2073025998271898,
    ccogsClaimed: 243373.20002352487, asins: [], rows: 5023,
  },
  september: {
    month: '2026-09', schemaVersion: 1, periodStart: '2026-09-01', periodEnd: '2026-09-30',
    netShippedGms: 1682714.5624999923, netPpm: 483422.7459000003, invoiceValue: 1682714.5624999923 - 483422.7459000003,
    unitsShipped: 7486, marginClosedPct: 0.32, marginAchievedPct: 0.2872874322676473,
    ccogsClaimed: 55045.914099997244, ccogsDeductions: 5046, ccogsFinal: 50000,
    priceMatchShortfall: 6526.14, asins: [], rows: 5178,
    ixd: {
      unitsUnpacked: 3888, ratePerUnit: 2, charge: 7776, valueUnpacked: 702461.66,
      periodStart: '2026-08-08', periodEnd: '2026-08-23', asins: 19,
    },
  },
}

const COGS: VendorCogs = { priced: 400000, unpriced: 150000, uncostedAsins: 40, uncostedUnits: 2000 }

describe('vendorContraCogs', () => {
  it('charges what the claim settled at, where it settled', () => {
    expect(vendorContraCogs(MONTHS.september)).toBe(50000)
  })
  it('charges the claim where nothing was negotiated off it', () => {
    expect(vendorContraCogs(MONTHS.april)).toBeCloseTo(243373.2, 2)
  })
})

describe('computeAmazonInVendorPnl', () => {
  it('invoices the retail value less the trade margin', () => {
    const v = computeAmazonInVendorPnl(MONTHS.september)
    expect(v.netShippedGms).toBeCloseTo(1682714.56, 2)
    expect(v.tradeMargin).toBeCloseTo(-483422.75, 2)
    expect(v.invoiceValue).toBeCloseTo(1199291.82, 2)
  })

  // Net revenue is the invoice. Margin support is a charge below it, which
  // is what makes CM1 here the same figure as the Master P&L's gross profit.
  it('charges the settled margin support below the revenue, not inside it', () => {
    const v = computeAmazonInVendorPnl(MONTHS.september)
    expect(v.netRevenue).toBeCloseTo(1199291.82, 2)
    expect(v.contraCogs).toBe(-50000)
  })

  it('shows the achieved margin against the one contracted', () => {
    const v = computeAmazonInVendorPnl(MONTHS.september)
    expect(v.marginAchievedPct).toBeCloseTo(28.729, 3)
    expect(v.marginClosedPct).toBeCloseTo(32, 6)
    // April ran ten points under contract, which is why its claim is five
    // times September's on a bigger month.
    const apr = computeAmazonInVendorPnl(MONTHS.april)
    expect(apr.marginAchievedPct).toBeCloseTo(20.73, 2)
    expect(apr.contraCogs).toBeCloseTo(-243373.2, 2)
  })

  it('runs the waterfall down to contribution', () => {
    const v = computeAmazonInVendorPnl(MONTHS.september, COGS, 100000)
    expect(v.totalCogs).toBe(-550000)
    expect(v.cm1).toBeCloseTo(1199291.82 - 550000, 2)
    // Cross-dock is charged on units unpacked, not units sold.
    expect(v.ixd).toBe(-7776)
    expect(v.totalCharges).toBe(-(50000 + 7776))
    expect(v.cm2).toBeCloseTo(1199291.82 - 550000 - 50000 - 7776, 2)
    expect(v.ads).toBe(-100000)
    expect(v.cm3).toBeCloseTo(1199291.82 - 550000 - 50000 - 7776 - 100000, 2)
    expect(v.cm4).toBe(v.cm3)
  })

  it('takes every percentage on net revenue', () => {
    const v = computeAmazonInVendorPnl(MONTHS.september, COGS, 100000)
    expect(v.cm1Pct).toBeCloseTo((v.cm1 / v.netRevenue) * 100, 6)
    expect(v.cm2Pct).toBeCloseTo((v.cm2 / v.netRevenue) * 100, 6)
    expect(v.cm3Pct).toBeCloseTo((v.cm3 / v.netRevenue) * 100, 6)
  })

  it('charges no cross-dock in a month whose IXD file is not in yet', () => {
    const v = computeAmazonInVendorPnl(MONTHS.april, COGS)
    expect(v.ixd).toBe(0)
    expect(v.unitsUnpacked).toBe(0)
    // Still charged the margin support, which is the other half of this line.
    expect(v.cm2).toBeCloseTo(v.cm1 - 243373.2, 2)
  })

  it('carries the units and the price-match shortfall for reading', () => {
    const v = computeAmazonInVendorPnl(MONTHS.september)
    expect(v.unitsShipped).toBe(7486)
    expect(v.unitsUnpacked).toBe(3888)
    expect(v.priceMatchShortfall).toBe(6526.14)
  })

  it('applies the allocated fixed expenses', () => {
    const v = applyAmazonInVendorOtherCosts(computeAmazonInVendorPnl(MONTHS.september, COGS), 25000)
    expect(v.otherCosts).toBe(-25000)
    expect(v.cm4).toBeCloseTo(v.cm3 - 25000, 2)
  })

  it('has a value for every line it defines, and no line without a value', () => {
    const v = applyAmazonInVendorOtherCosts(computeAmazonInVendorPnl(MONTHS.september, COGS, 1), 1)
    for (const def of AMAZON_IN_VENDOR_LINE_DEFS) {
      expect(v[def.key], `${def.key} has no value`).toBeTypeOf('number')
    }
  })
})

/**
 * The cross-dock charge arrives two ways: RK World's claim invoice, which is
 * what they deducted, and the IXD workbook, which is the units behind it.
 * August's invoice bills ₹24,252 — 12,126 units at ₹2 — and the statement
 * charges the invoice.
 */
describe('the cross-dock charge, from the invoice', () => {
  const invoiced: AmazonInVendorFacts = {
    ...MONTHS.april,
    month: '2026-08',
    ixd: {
      unitsUnpacked: 12126, ratePerUnit: 2, charge: 24252, valueUnpacked: 0,
      periodStart: '2026-08-01', periodEnd: '2026-08-31', asins: 0,
      invoice: { number: '20000036977', date: '2026-09-21', amount: 24252 },
    },
  }

  it('charges what the invoice says was deducted', () => {
    const v = computeAmazonInVendorPnl(invoiced)
    expect(v.ixd).toBe(-24252)
    expect(v.unitsUnpacked).toBe(12126)
  })

  it('rolls it up as fulfilment, the way the workbook charge does', () => {
    expect(amazonInVendorToCanonicalBuckets(invoiced).fulfilment).toBe(24252)
  })
})

describe('amazonInVendorToCanonicalBuckets', () => {
  // A wholesale price cut is not a marketplace fee. Putting it in commission
  // would sit it beside Flipkart's referral fee and make both unreadable —
  // the call this build already makes for Nykaa's B2B margin.
  it('rolls the trade margin up as a discount, never as commission', () => {
    const b = amazonInVendorToCanonicalBuckets(MONTHS.september, COGS)
    expect(b.discounts).toBeCloseTo(483422.75, 2)
    expect(b.marketplaceCommission).toBe(0)
  })

  it('makes net sales the invoice that was actually billed', () => {
    const lines = computeSubtotals(amazonInVendorToCanonicalBuckets(MONTHS.september, COGS))
    expect(lines.netSales).toBeCloseTo(1199291.82, 2)
  })

  it('charges margin support and cross-dock rather than netting them into the price', () => {
    const b = amazonInVendorToCanonicalBuckets(MONTHS.september, COGS)
    expect(b.otherMarketplaceCharges).toBe(50000)
    expect(b.fulfilment).toBe(7776)
  })

  // The whole point of charging margin support below the revenue: the two
  // ways of computing the month now agree at the gross line as well as at
  // the bottom, so the statement and the Master P&L cannot drift.
  it('agrees with the roll-up at gross profit and at contribution', () => {
    const native = computeAmazonInVendorPnl(MONTHS.september, COGS, 100000)
    const lines = computeSubtotals(amazonInVendorToCanonicalBuckets(MONTHS.september, COGS, 100000))
    expect(lines.netSales).toBeCloseTo(native.netRevenue, 2)
    expect(lines.grossProfit).toBeCloseTo(native.cm1, 2)
    expect(lines.channelMargin).toBeCloseTo(native.cm2, 2)
    expect(lines.contributionProfit).toBeCloseTo(native.cm3, 2)
  })

  it('takes nothing off for GST, because the file is already ex-GST', () => {
    const b = amazonInVendorToCanonicalBuckets(MONTHS.september, COGS)
    expect(b.otherRevenueAdj).toBe(0)
  })
})
