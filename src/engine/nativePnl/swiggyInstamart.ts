import type { PnlLineValues, SwiggyInstamartPnlFacts } from '@/data/models'
import type { NativeLineDef, NativeLineValues } from './types'

/**
 * Swiggy Instamart's statement.
 *
 * Swiggy sends a sales report: GMV at base MRP, the units, the stores, the
 * cities, and a second sheet of reach — impressions, orders, new-to-brand
 * buyers. It states nothing it took, so the ladder runs from GMV to gross
 * profit and the line where the marketplace's charges belong says they were
 * not supplied.
 *
 * What Swiggy takes is the contract, not the report: B2B on the same shape as
 * Purplle, with a trade margin of 25% inclusive on MRP that purchase order
 * FC5PO365689 proves line by line. It is deducted from revenue rather than
 * charged below gross profit, because we invoice MRP less the margin and the
 * rest was never ours — the treatment Nykaa's margin already gets.
 *
 * GST comes out at each item's own rate from the Product Master, which is
 * what decides a rate here: the report states none, the range is not all at
 * one rate, and Swiggy's and Nykaa's purchase orders state different rates
 * for the same HSN codes, so no order can be the authority.
 *
 * The marketing contribution — 10% of MRP sales for the first six months from
 * launch — is a cost of the channel that ends, so it sits on its own line
 * rather than inside the margin.
 *
 * The reach block is not money and is never part of a total. It is on the
 * statement because 73,560 impressions against 59 orders is the question this
 * channel actually raises, and it would be lost on a screen of its own.
 */
export const SWIGGY_LINE_DEFS: NativeLineDef[] = [
  { key: 'gmv', label: 'GMV (at MRP, incl. GST)', section: 'REVENUE', kind: 'input',
    note: 'What the units sold for, from the Sales Report — base MRP × units on every row of the file' },
  { key: 'margin', label: '(−) Swiggy trade margin', section: 'REVENUE', kind: 'input',
    note: '25%, inclusive, on MRP — the agreed terms, proved line by line on purchase order FC5PO365689, where every item totals exactly 75% of MRP × quantity. Deducted from revenue rather than charged below gross profit, because we invoice MRP less the margin and the rest was never ours.' },
  { key: 'invoiceValue', label: 'INVOICE VALUE (what we bill Swiggy)', section: 'REVENUE', kind: 'subtotal',
    note: 'GMV less the margin, GST included — the channel’s revenue' },
  { key: 'outputGst', label: '(−) Output GST', section: 'REVENUE', kind: 'input',
    note: 'At each item’s own rate from the Product Master, which is what decides the rate across every channel. The sales report states none; where the Master has none either, the rate on purchase order FC5PO365689 stands in and the upload names those codes.' },
  { key: 'netRevenue', label: 'NET REVENUE (ex-GST)', section: 'REVENUE', kind: 'subtotal' },

  { key: 'cogs', label: '(−) COGS', section: 'COST OF GOODS SOLD', kind: 'input',
    note: 'Priced from the Product Master at the month’s cost, through the SKU mapping for Swiggy’s own item codes' },
  { key: 'grossProfit', label: 'Gross Profit (after COGS)', section: 'COST OF GOODS SOLD', kind: 'subtotal' },
  { key: 'grossMarginPct', label: 'Gross Margin %', section: 'COST OF GOODS SOLD', kind: 'percent' },

  { key: 'marketingContribution', label: '(−) Marketing contribution', section: 'PROFIT', kind: 'input',
    fee: 'advertising', hideWhenZero: true,
    note: '10% of MRP sales, for the first six months from launch. The window is taken from the date of the first purchase order on file, so confirm the launch month — it decides which month this stops in.' },
  { key: 'contribution', label: 'Contribution (after marketing)', section: 'PROFIT', kind: 'subtotal' },
  { key: 'contributionPct', label: 'Contribution %', section: 'PROFIT', kind: 'percent' },
  { key: 'overheads', label: '(−) Allocated Fixed Expenses', section: 'PROFIT', kind: 'input',
    note: 'This channel’s share of the month’s fixed expenses, by its share of sales' },
  { key: 'ebitda', label: 'EBITDA', section: 'PROFIT', kind: 'subtotal' },
  { key: 'ebitdaPct', label: 'EBITDA %', section: 'PROFIT', kind: 'percent' },

  { key: 'unitsSold', label: 'Units sold', section: 'UNITS', kind: 'count' },
  { key: 'skusSold', label: 'SKUs sold', section: 'UNITS', kind: 'count' },
  { key: 'storesSold', label: 'Stores that sold', section: 'UNITS', kind: 'count',
    note: 'Dark stores carrying stock that moved this month' },
  { key: 'citiesSold', label: 'Cities', section: 'UNITS', kind: 'count' },
  { key: 'salesRows', label: 'Product-store-days', section: 'UNITS', kind: 'count', hideWhenZero: true,
    note: 'Rows of the sales report: one product, one store, one day' },

  { key: 'brandImpressions', label: 'Brand impressions', section: 'REACH', kind: 'count', hideWhenZero: true,
    note: 'From the Brand Metrics sheet. Not money, and not part of any total above.' },
  { key: 'brandOrders', label: 'Orders', section: 'REACH', kind: 'count', hideWhenZero: true },
  { key: 'newToBrandBuyers', label: 'New-to-brand buyers', section: 'REACH', kind: 'count', hideWhenZero: true,
    note: 'Shoppers who bought this brand on Instamart for the first time' },
  { key: 'impressionsPerOrder', label: 'Impressions per order', section: 'REACH', kind: 'count', hideWhenZero: true },
  { key: 'gmvPerOrder', label: 'GMV per order', section: 'REACH', kind: 'input', hideWhenZero: true },
]

/** The month's statement, in rupees. `cogs` and `overheads` come from outside
 * the report: Swiggy knows neither what the goods cost nor what head office
 * costs. */
export function computeSwiggyInstamartPnl(
  facts: SwiggyInstamartPnlFacts,
  cogs = 0,
  overheads = 0,
): NativeLineValues {
  const netRevenue = facts.gmvExGst
  const grossProfit = netRevenue - cogs
  const marketing = facts.marketingContributionInr
  const contribution = grossProfit - marketing
  const ebitda = contribution - overheads
  const pct = (part: number, whole: number) => (whole !== 0 ? (part / whole) * 100 : 0)

  return {
    gmv: facts.gmv,
    margin: -facts.marginInr,
    invoiceValue: facts.invoiceValueInr,
    outputGst: -facts.outputGst,
    netRevenue,
    cogs: -cogs,
    grossProfit,
    grossMarginPct: pct(grossProfit, netRevenue),
    marketingContribution: -marketing,
    contribution,
    contributionPct: pct(contribution, netRevenue),
    overheads: -overheads,
    ebitda,
    ebitdaPct: pct(ebitda, netRevenue),
    unitsSold: facts.unitsSold,
    skusSold: facts.skusSold,
    storesSold: facts.storesSold,
    citiesSold: facts.citiesSold,
    salesRows: facts.salesRows,
    brandImpressions: facts.brandImpressions,
    brandOrders: facts.brandOrders,
    newToBrandBuyers: facts.newToBrandBuyers,
    impressionsPerOrder: facts.brandOrders !== 0 ? facts.brandImpressions / facts.brandOrders : 0,
    gmvPerOrder: facts.brandOrders !== 0 ? facts.gmv / facts.brandOrders : 0,
  }
}

/**
 * The canonical buckets, so Swiggy Instamart rolls into the Master P&L beside
 * every other channel.
 *
 * GMV is gross sales, the trade margin is a discount and the GST goes to
 * `otherRevenueAdj`, which leaves net sales at what we invoice, ex-GST — the
 * same basis as every other channel. Every marketplace-charge bucket is zero:
 * the margin is already out of revenue above, and counting it twice is the
 * mistake Nykaa's buckets warn about.
 */
export function swiggyInstamartToCanonicalBuckets(
  facts: SwiggyInstamartPnlFacts,
  cogs = 0,
): PnlLineValues {
  return {
    grossSales: facts.gmv,
    // Swiggy's trade margin: a deduction from revenue, as Nykaa's and
    // Purplle's are, because we invoice MRP less the margin.
    discounts: facts.marginInr,
    returns: 0,
    otherRevenueAdj: facts.outputGst,
    cogs,
    marketplaceCommission: 0,
    fulfilment: 0,
    shipping: 0,
    collectionFees: 0,
    rtoCharges: 0,
    returnCharges: 0,
    otherMarketplaceCharges: 0,
    ads: 0,
    performanceMarketing: 0,
    // The marketing contribution: 10% of MRP sales while the launch window
    // runs. A real cost of the channel, and one that ends.
    otherMarketing: facts.marketingContributionInr,
  }
}
