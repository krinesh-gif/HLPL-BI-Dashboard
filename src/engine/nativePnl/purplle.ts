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
 * out at each product's own rate from the Product Master — the range runs at
 * 18% and at 5%, and one rate for the file would be ₹369 wrong.
 *
 * What Purplle takes is the contract, not the file: B2B on sale or return,
 * a commission on what sells, stored with the month it was read at. The GST
 * on it sits beside it and is never deducted — it is input tax credit, and
 * charging it to the P&L would understate the channel.
 *
 * Advertising is Purplle's marketing charge, and it comes to 5% of the
 * month's MRP: April writes it once above the table under a "Marketing"
 * label, June as an unnamed column carrying the same 5% on every row. It is
 * the only cost of selling this file carries, so it is on the statement —
 * flagged, because 5% of MRP is on no document Purplle has sent us. The
 * margin sheet's A&P line is blank.
 */
export const PURPLLE_LINE_DEFS: NativeLineDef[] = [
  { key: 'mrpValue', label: 'MRP value of what sold', section: 'REVENUE', kind: 'input',
    note: 'What the units Purplle sold this month list at' },
  { key: 'margin', label: '(−) Purplle margin', section: 'REVENUE', kind: 'input',
    note: 'Basic Product Margin from the margin sheet — 31%, inclusive, on MRP, taken on invoice. Inclusive means nothing is added for GST. It is deducted here rather than below gross profit because it was never our revenue: we invoice MRP less the margin.' },
  { key: 'invoiceValue', label: 'INVOICE VALUE (what we bill Purplle)', section: 'REVENUE', kind: 'subtotal',
    note: 'MRP less the margin, GST included — the channel’s revenue' },
  { key: 'outputGst', label: '(−) Output GST', section: 'REVENUE', kind: 'input',
    note: 'On what we invoice, at each product’s own rate from the Product Master, which is what decides the rate across every channel. Where the Master has none yet, the rate stated on Purplle’s file stands in and the upload names those codes.' },
  { key: 'netRevenue', label: 'NET REVENUE (ex-GST)', section: 'REVENUE', kind: 'subtotal' },

  { key: 'nmv', label: 'What shoppers paid', section: 'MEMO — PURPLLE’S SHOP FLOOR', kind: 'input',
    note: 'The file’s own nmv column, including GST. Purplle’s realisation, not ours, and part of no total here.' },
  { key: 'priceOff', label: 'Price off Purplle gave', section: 'MEMO — PURPLLE’S SHOP FLOOR', kind: 'input',
    note: 'Out of Purplle’s own margin: the margin sheet charges no discount back to us. Worth watching as the price the market is paying.' },
  { key: 'discountPct', label: 'Price off, % of MRP', section: 'MEMO — PURPLLE’S SHOP FLOOR', kind: 'percent' },
  { key: 'purplleRealisationPct', label: 'Purplle’s own margin after that', section: 'MEMO — PURPLLE’S SHOP FLOOR', kind: 'percent',
    note: 'What Purplle keeps of the MRP once it has discounted — its 31% less the price off it funded' },

  { key: 'cogs', label: 'Total COGS', section: 'COST OF GOODS SOLD', kind: 'input',
    note: 'Priced from the Product Master at the month’s cost, through the SKU mapping for Purplle’s own codes' },
  { key: 'grossProfit', label: 'GROSS MARGIN (CM1)', section: 'COST OF GOODS SOLD', kind: 'subtotal' },
  { key: 'grossMarginPct', label: 'CM1 %', section: 'COST OF GOODS SOLD', kind: 'percent' },

  { key: 'marketplaceCharges', label: '(−) Marketplace Charges', section: 'MARKETPLACE CHARGES', kind: 'input',
    note: 'Nil, and not because Purplle is free: its 31% margin is taken on the invoice, so it is already out of revenue above rather than charged here. If Purplle ever bills a commission, logistics or payment fee, it belongs on this line.' },
  { key: 'channelMargin', label: 'CHANNEL MARGIN (CM2)', section: 'MARKETPLACE CHARGES', kind: 'subtotal',
    note: 'Is this marketplace worth being on?' },
  { key: 'channelMarginPct', label: 'CM2 %', section: 'MARKETPLACE CHARGES', kind: 'percent' },

  { key: 'marketing', label: '(−) Advertising (MI)', section: 'ADVERTISING', kind: 'input', fee: 'advertising',
    note: 'Purplle’s marketing charge, which is 5% of the month’s MRP: April writes it once above the table under a "Marketing" label, June as an unnamed column of the same 5% per row. It is not on the margin sheet, where every line but the 31% is blank — so check it against Purplle’s invoice.' },
  { key: 'contribution', label: 'CONTRIBUTION MARGIN (CM3)', section: 'ADVERTISING', kind: 'subtotal',
    note: '⭐ the number to manage the business on' },
  { key: 'contributionPct', label: 'CM3 %', section: 'ADVERTISING', kind: 'percent' },

  { key: 'overheads', label: '(−) Allocated Fixed Expenses', section: 'FIXED EXPENSES', kind: 'input',
    note: 'This channel’s share of the month’s fixed expenses, by its share of sales' },
  { key: 'ebitda', label: 'NET PROFIT (CM4)', section: 'FIXED EXPENSES', kind: 'subtotal' },
  { key: 'ebitdaPct', label: 'Net Profit %', section: 'FIXED EXPENSES', kind: 'percent' },

  { key: 'unitsSold', label: 'Units sold', section: 'UNITS', kind: 'count' },
  { key: 'orders', label: 'Orders', section: 'UNITS', kind: 'count' },
  { key: 'orderLines', label: 'Order lines', section: 'UNITS', kind: 'count', hideWhenZero: true,
    note: 'More lines than orders means an order carried two products' },
  { key: 'skusSold', label: 'SKUs sold', section: 'UNITS', kind: 'count' },
]

/** The month's statement, in rupees. `cogs` and `overheads` come from outside
 * the file: Purplle knows neither what the goods cost nor what head office
 * costs. */
export function computePurpllePnl(facts: PurpllePnlFacts, cogs = 0, overheads = 0): NativeLineValues {
  const netRevenue = facts.netRevenue
  const grossProfit = netRevenue - cogs
  // Nil, on this channel. The rung is struck all the same, so Purplle's CM2
  // can be read beside Flipkart's and the ladder means one thing everywhere.
  const marketplaceCharges = 0
  const channelMargin = grossProfit - marketplaceCharges
  const marketing = facts.marketingInr
  const contribution = channelMargin - marketing
  const ebitda = contribution - overheads
  const pct = (part: number, whole: number) => (whole !== 0 ? (part / whole) * 100 : 0)

  return {
    mrpValue: facts.mrpValue,
    margin: -facts.marginInr,
    invoiceValue: facts.invoiceValueInr,
    outputGst: -facts.outputGst,
    netRevenue,
    nmv: facts.nmv,
    priceOff: facts.priceOff,
    discountPct: pct(facts.priceOff, facts.mrpValue),
    // What Purplle is left with on the MRP it sold: its margin less the
    // price off it funded out of it.
    purplleRealisationPct: pct(facts.marginInr - facts.priceOff, facts.mrpValue),
    cogs: -cogs,
    grossProfit,
    grossMarginPct: pct(grossProfit, netRevenue),
    marketplaceCharges: marketplaceCharges === 0 ? 0 : -marketplaceCharges,
    channelMargin,
    channelMarginPct: pct(channelMargin, netRevenue),
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
 * The commission is the one charge here, and it comes from the contract
 * rather than the file: Purplle is B2B on sale or return, and takes a
 * percentage of what sells. Every other charge bucket is zero, and that is a
 * statement of what the file contains rather than of what Purplle charges.
 */
export function purplleToCanonicalBuckets(facts: PurpllePnlFacts, cogs = 0): PnlLineValues {
  return {
    grossSales: facts.mrpValue,
    // Purplle's trade margin, and only it: the price off shoppers got is
    // funded by Purplle, so it never reduced what we were paid.
    discounts: facts.marginInr,
    returns: 0,
    otherRevenueAdj: facts.outputGst,
    cogs,
    // Zero deliberately. The margin is a deduction from revenue above, not a
    // charge below gross profit — the same treatment as Nykaa's, and putting
    // it in both places would charge it twice.
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
