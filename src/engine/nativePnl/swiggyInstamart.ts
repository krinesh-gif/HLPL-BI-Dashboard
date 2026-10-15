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
 * The GST line is the one figure here that is not read from the file. GMV is
 * at MRP and therefore includes tax, and the report carries no rate, so it
 * comes out at the declared assumption — said on the line, because every
 * figure under NET REVENUE moves if the rate is wrong.
 *
 * The reach block is not money and is never part of a total. It is on the
 * statement because 73,560 impressions against 59 orders is the question this
 * channel actually raises, and it would be lost on a screen of its own.
 */
export const SWIGGY_LINE_DEFS: NativeLineDef[] = [
  { key: 'gmv', label: 'GMV (at MRP, incl. GST)', section: 'REVENUE', kind: 'subtotal',
    note: 'What the units sold for, from the Sales Report — base MRP × units on every row of the file' },
  { key: 'outputGst', label: 'Less: Output GST (assumed rate)', section: 'REVENUE', kind: 'input',
    note: '⚠ Not from the file. Swiggy states GMV at MRP, which includes GST, and gives no rate; this comes out at the rate stored with the month. Every line below moves if it is wrong.' },
  { key: 'netRevenue', label: 'NET REVENUE (ex-GST)', section: 'REVENUE', kind: 'subtotal' },

  { key: 'swiggyCharges', label: 'Less: What Swiggy took', section: 'WHAT SWIGGY TOOK', kind: 'input',
    fee: 'otherFees',
    note: '⚠ Not supplied. The report carries no commission, fulfilment, payment or return charge, and no discount off MRP. This is not a claim that the channel costs nothing — it is a figure nobody has sent.' },

  { key: 'cogs', label: 'Less: COGS', section: 'PROFIT', kind: 'input',
    note: 'Priced from the Product Master at the month’s cost, through the SKU mapping for Swiggy’s own item codes' },
  { key: 'grossProfit', label: 'Gross Profit (after COGS)', section: 'PROFIT', kind: 'subtotal' },
  { key: 'grossMarginPct', label: 'Gross Margin %', section: 'PROFIT', kind: 'percent' },
  { key: 'overheads', label: 'Less: Allocated Fixed Expenses', section: 'PROFIT', kind: 'input',
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
  const ebitda = grossProfit - overheads
  const pct = (part: number, whole: number) => (whole !== 0 ? (part / whole) * 100 : 0)

  return {
    gmv: facts.gmv,
    outputGst: -facts.outputGst,
    netRevenue,
    // Zero because it is unknown, and the line says so in words.
    swiggyCharges: 0,
    cogs: -cogs,
    grossProfit,
    grossMarginPct: pct(grossProfit, netRevenue),
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
 * GMV is gross sales and the GST goes to `otherRevenueAdj`, which leaves net
 * sales ex-GST — the same basis as every other channel. No discount is
 * claimed, because the report states GMV at MRP and names no discount; every
 * marketplace-charge bucket is zero, which is a statement about the file and
 * not about what Swiggy charges.
 */
export function swiggyInstamartToCanonicalBuckets(
  facts: SwiggyInstamartPnlFacts,
  cogs = 0,
): PnlLineValues {
  return {
    grossSales: facts.gmv,
    discounts: 0,
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
    otherMarketing: 0,
  }
}
