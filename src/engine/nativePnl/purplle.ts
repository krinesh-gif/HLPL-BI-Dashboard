import type { PnlLineValues, PurpllePnlFacts } from '@/data/models'
import type { NativeLineDef, NativeLineValues } from './types'

/**
 * Purplle's statement.
 *
 * Shorter than the others, and honestly so. Purplle sends a sales file: what
 * each order line listed at, what the shopper paid after the price off, the
 * GST rate, the units. It states nothing Purplle took — no commission, no
 * logistics, no payment fee — so the ladder runs from MRP to gross profit,
 * and the line where the marketplace's charges belong says they were not
 * supplied rather than printing a zero that reads as free.
 *
 * The ladder is measured on NET REVENUE, ex-GST, as Blinkit's and Meesho's
 * are, so a Purplle margin means what a Blinkit margin means. The tax comes
 * out at each row's own rate: April's file carries 18% lines and 5% lines,
 * and one rate for the file would be ₹369 wrong.
 *
 * Advertising is the "Marketing" figure the sender writes above the table.
 * It is the only cost of selling this file carries, so it is on the statement
 * — flagged, because a number read from a loose cell deserves to be checked
 * against Purplle's invoice.
 */
export const PURPLLE_LINE_DEFS: NativeLineDef[] = [
  { key: 'mrpValue', label: 'MRP value of what sold', section: 'REVENUE', kind: 'input',
    note: 'What the units listed at before the price off' },
  { key: 'priceOff', label: 'Less: Price off', section: 'REVENUE', kind: 'input',
    note: 'The discount against MRP, stated per line in the file' },
  { key: 'nmv', label: 'NET MERCHANDISE VALUE', section: 'REVENUE', kind: 'subtotal',
    note: 'What shoppers paid, including GST — the file’s own nmv column' },
  { key: 'outputGst', label: 'Less: Output GST', section: 'REVENUE', kind: 'input',
    note: 'Taken out at each line’s own rate; this month carries both 18% and 5% lines' },
  { key: 'netRevenue', label: 'NET REVENUE (ex-GST)', section: 'REVENUE', kind: 'subtotal' },

  { key: 'purplleCharges', label: 'Less: What Purplle took', section: 'WHAT PURPLLE TOOK', kind: 'input',
    fee: 'otherFees',
    note: '⚠ Not supplied. Purplle sends a sales file, not a settlement: it carries no commission, logistics, payment or return charges. This is not a claim that the channel costs nothing — it is a figure nobody has sent. The Purplle payout statement fills it in.' },

  { key: 'cogs', label: 'Less: COGS', section: 'PROFIT', kind: 'input',
    note: 'Priced from the Product Master at the month’s cost, through the SKU mapping for Purplle’s own codes' },
  { key: 'grossProfit', label: 'Gross Profit (after COGS)', section: 'PROFIT', kind: 'subtotal' },
  { key: 'grossMarginPct', label: 'Gross Margin %', section: 'PROFIT', kind: 'percent' },
  { key: 'marketing', label: 'Less: Advertising (MI)', section: 'PROFIT', kind: 'input', fee: 'advertising',
    note: 'The "Marketing" figure written above the table in Purplle’s file, not a column of it — check it against Purplle’s invoice' },
  { key: 'contribution', label: 'Contribution (after advertising)', section: 'PROFIT', kind: 'subtotal' },
  { key: 'contributionPct', label: 'Contribution %', section: 'PROFIT', kind: 'percent' },
  { key: 'overheads', label: 'Less: Allocated Fixed Expenses', section: 'PROFIT', kind: 'input',
    note: 'This channel’s share of the month’s fixed expenses, by its share of sales' },
  { key: 'ebitda', label: 'EBITDA', section: 'PROFIT', kind: 'subtotal' },
  { key: 'ebitdaPct', label: 'EBITDA %', section: 'PROFIT', kind: 'percent' },

  { key: 'unitsSold', label: 'Units sold', section: 'UNITS', kind: 'count' },
  { key: 'orders', label: 'Orders', section: 'UNITS', kind: 'count' },
  { key: 'orderLines', label: 'Order lines', section: 'UNITS', kind: 'count', hideWhenZero: true,
    note: 'More lines than orders means an order carried two products' },
  { key: 'skusSold', label: 'SKUs sold', section: 'UNITS', kind: 'count' },
  { key: 'discountPct', label: 'Price off, % of MRP', section: 'UNITS', kind: 'percent' },
]

/** The month's statement, in rupees. `cogs` and `overheads` come from outside
 * the file: Purplle knows neither what the goods cost nor what head office
 * costs. */
export function computePurpllePnl(facts: PurpllePnlFacts, cogs = 0, overheads = 0): NativeLineValues {
  const netRevenue = facts.netRevenue
  const grossProfit = netRevenue - cogs
  const marketing = facts.marketingInr
  const contribution = grossProfit - marketing
  const ebitda = contribution - overheads
  const pct = (part: number, whole: number) => (whole !== 0 ? (part / whole) * 100 : 0)

  return {
    mrpValue: facts.mrpValue,
    priceOff: -facts.priceOff,
    nmv: facts.nmv,
    outputGst: -facts.outputGst,
    netRevenue,
    // Stated as zero because it is unknown, and said in words on the line.
    purplleCharges: 0,
    cogs: -cogs,
    grossProfit,
    grossMarginPct: pct(grossProfit, netRevenue),
    marketing: -marketing,
    contribution,
    contributionPct: pct(contribution, netRevenue),
    overheads: -overheads,
    ebitda,
    ebitdaPct: pct(ebitda, netRevenue),
    unitsSold: facts.unitsSold,
    orders: facts.orders,
    orderLines: facts.orderLines,
    skusSold: facts.skusSold,
    discountPct: pct(facts.priceOff, facts.mrpValue),
  }
}

/**
 * The canonical buckets, so Purplle rolls into the Master P&L beside every
 * other channel.
 *
 * Positive magnitudes, as the engine expects. Gross sales is MRP and the
 * price off is a discount, because the file states both and the engine has a
 * bucket for exactly that; the GST goes to `otherRevenueAdj`, which is what
 * leaves net sales ex-GST, the same basis as every other channel.
 *
 * Every marketplace-charge bucket is zero, and that is a statement of what
 * the file contains rather than of what Purplle charges.
 */
export function purplleToCanonicalBuckets(facts: PurpllePnlFacts, cogs = 0): PnlLineValues {
  return {
    grossSales: facts.mrpValue,
    discounts: facts.priceOff,
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
    ads: facts.marketingInr,
    performanceMarketing: 0,
    otherMarketing: 0,
  }
}
