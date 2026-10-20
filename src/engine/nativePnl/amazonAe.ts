import type { AmazonAePnlFacts, PnlLineValues } from '@/data/models'
import type { NativeLineDef, NativeLineValues } from './types'

/**
 * Amazon UAE's statement.
 *
 * Short, and honestly so. The Product Profitability export the UAE
 * marketplace produced for September 2026 carries revenue, units and Amazon's
 * own Net proceeds, and not one of the fee columns the US download of the
 * same report carries — no referral fee, no FBA fulfilment, no storage, no
 * advertising. Its headings arrived as raw internal keys and two of them with
 * no heading at all.
 *
 * So everything Amazon took is one line: net sales less the Net proceeds
 * Amazon states. That subtraction is a fact of the file. Splitting it across
 * fee names Amazon did not state would be inventing the breakdown, which is
 * worse than not having one — a reader would act on it.
 *
 * The ladder is measured on net sales, ex-returns, as every other channel's
 * is, so a UAE margin means the same thing as a Flipkart one.
 *
 * Everything is in dirhams except COGS, which is a rupee cost and is
 * converted at the month's rate when the statement is read.
 */
export const AMAZON_AE_LINE_DEFS: NativeLineDef[] = [
  { key: 'grossSales', label: 'Gross Sales', section: 'REVENUE', kind: 'input',
    note: 'What the units sold for before returns' },
  { key: 'returns', label: '(−) Returns', section: 'REVENUE', kind: 'input',
    note: 'Sales less Amazon’s net-of-returns figure' },
  { key: 'netSales', label: 'NET SALES', section: 'REVENUE', kind: 'subtotal' },

  { key: 'cogs', label: 'Total COGS', section: 'COST OF GOODS SOLD', kind: 'input',
    note: 'Priced from the Product Master at the month’s cost, converted from rupees at the month’s rate' },
  { key: 'grossProfit', label: 'GROSS MARGIN (CM1)', section: 'COST OF GOODS SOLD', kind: 'subtotal' },
  { key: 'grossMarginPct', label: 'CM1 %', section: 'COST OF GOODS SOLD', kind: 'percent' },

  { key: 'amazonFees', label: '(−) Amazon fees', section: 'MARKETPLACE CHARGES', kind: 'input',
    fee: 'otherFees',
    note: '⚠ One figure, not a breakdown. Amazon exported this month without its fee columns, so this is net sales less the Net proceeds Amazon states — everything it took, with nothing saying how much was referral fee, fulfilment or storage.' },
  { key: 'channelMargin', label: 'CHANNEL MARGIN (CM2)', section: 'MARKETPLACE CHARGES', kind: 'subtotal',
    note: 'Is this marketplace worth being on?' },
  { key: 'channelMarginPct', label: 'CM2 %', section: 'MARKETPLACE CHARGES', kind: 'percent' },

  { key: 'ads', label: '(−) Advertising', section: 'ADVERTISING', kind: 'input',
    note: 'From the Amazon Ads console’s monthly cost report, which is the only place this channel’s advertising is stated — the Product Profitability export Amazon sends for the UAE carries no advertising column. Billed in dirhams.' },
  { key: 'contribution', label: 'CONTRIBUTION MARGIN (CM3)', section: 'ADVERTISING', kind: 'subtotal',
    note: '⭐ the number to manage the business on' },
  { key: 'contributionPct', label: 'CM3 %', section: 'ADVERTISING', kind: 'percent' },

  { key: 'overheads', label: '(−) Allocated Fixed Expenses', section: 'FIXED EXPENSES', kind: 'input',
    note: 'This channel’s share of the month’s fixed expenses, by its share of sales' },
  { key: 'ebitda', label: 'NET PROFIT (CM4)', section: 'FIXED EXPENSES', kind: 'subtotal' },
  { key: 'ebitdaPct', label: 'Net Profit %', section: 'FIXED EXPENSES', kind: 'percent' },

  // Amazon's own bottom line, kept because it is a fact of the file and the
  // figure the settlement is read against. It is not a rung of the ladder:
  // Amazon strikes it before the goods, which is why it sits here rather
  // than where it used to, above COGS.
  { key: 'netProceeds', label: 'NET PROCEEDS (per Amazon)', section: 'MEMO — AMAZON’S OWN FIGURES', kind: 'subtotal',
    note: 'Net sales less what Amazon took, before anything about the goods — taken from the export rather than computed' },
  { key: 'feePct', label: 'Amazon’s take %', section: 'MEMO — AMAZON’S OWN FIGURES', kind: 'percent' },

  { key: 'unitsSold', label: 'Units sold', section: 'UNITS', kind: 'count' },
  { key: 'unitsReturned', label: 'Units returned', section: 'UNITS', kind: 'count', hideWhenZero: true },
  { key: 'netUnits', label: 'Net units sold', section: 'UNITS', kind: 'count' },
  { key: 'nonSellingRows', label: 'SKUs charged without selling', section: 'UNITS', kind: 'count', hideWhenZero: true,
    note: 'Stock that sat in the warehouse and was charged for it — storage accrues whether or not anything sells. Their charges are in the month; they have no sales line of their own.' },
]

/** Everything Amazon took: what was sold for, less what Amazon paid out. */
export function amazonAeFeesTaken(facts: AmazonAePnlFacts): number {
  return facts.netSalesAed - facts.netProceedsAed
}

/**
 * The statement's values, in dirhams.
 *
 * `cogsAed` and `overheadsAed` are passed in already converted, because what
 * a unit cost and what head office cost are rupee facts and the rate belongs
 * to the month being read, not to the day the file was uploaded.
 */
export function computeAmazonAePnl(
  facts: AmazonAePnlFacts,
  cogsAed: number,
  overheadsAed: number,
  /**
   * The month's advertising, in dirhams.
   *
   * It comes from the Ads console rather than from this export, which
   * carries no advertising column — so until it was wired in, a channel that
   * spent AED 1,547 in June reported no advertising at all and an EBITDA
   * that much too good. Amazon does not bill it through the settlement this
   * statement reconciles to, so it is struck below CM2 as advertising on
   * every other channel is, rather than among what Amazon took.
   */
  adsAed = 0,
): NativeLineValues {
  const netSales = facts.netSalesAed
  const amazonFees = amazonAeFeesTaken(facts)
  // The goods first, then the marketplace — the order every channel's ladder
  // uses, and the order the P&L already rolled this channel up in. Amazon's
  // own export strikes its proceeds before COGS, which is why CM1 here used
  // to be net proceeds less the goods: a figure no other statement showed and
  // the P&L never agreed with. The bottom line is unchanged either way.
  const grossProfit = netSales - cogsAed
  const channelMargin = grossProfit - amazonFees
  const contribution = channelMargin - adsAed
  const ebitda = contribution - overheadsAed

  return {
    grossSales: facts.grossSalesAed,
    returns: -(facts.grossSalesAed - facts.netSalesAed),
    netSales,
    amazonFees: -amazonFees,
    netProceeds: facts.netProceedsAed,
    // Against no sales this is unmeasurable rather than 0%: a month with
    // nothing sold did not have a take of nothing.
    feePct: netSales !== 0 ? (amazonFees / netSales) * 100 : 0,
    cogs: -cogsAed,
    grossProfit,
    grossMarginPct: netSales !== 0 ? (grossProfit / netSales) * 100 : 0,
    channelMargin,
    channelMarginPct: netSales !== 0 ? (channelMargin / netSales) * 100 : 0,
    ads: -adsAed,
    contribution,
    contributionPct: netSales !== 0 ? (contribution / netSales) * 100 : 0,
    overheads: -overheadsAed,
    ebitda,
    ebitdaPct: netSales !== 0 ? (ebitda / netSales) * 100 : 0,
    unitsSold: facts.unitsSoldQty,
    unitsReturned: facts.unitsReturnedQty,
    netUnits: facts.netUnitsSoldQty,
    nonSellingRows: facts.nonSellingRows,
  }
}

/**
 * The canonical buckets, in rupees, so Amazon UAE rolls into the Master P&L
 * beside every other channel.
 *
 * Positive magnitudes, as the engine expects: a cost is what it cost, and the
 * minus is applied when it is printed.
 *
 * Everything Amazon took goes to `otherMarketplaceCharges`. Not because it is
 * "other" in any meaningful sense — it is all of them — but because the
 * export states no split, and putting the whole figure under Commission or
 * Fulfilment would be a claim about its composition that nothing supports.
 */
export function amazonAeToCanonicalBuckets(
  facts: AmazonAePnlFacts,
  rateInrPerAed: number,
  cogsInr: number,
  /** The month's advertising, already in rupees — it comes from the ads
   * records, which the marketing roll-up has converted at this month's
   * rate. Zero where the caller only wants the revenue lines. */
  adsInr = 0,
): PnlLineValues {
  const aed = (v: number) => v * rateInrPerAed
  return {
    grossSales: aed(facts.grossSalesAed),
    discounts: 0,
    returns: aed(facts.grossSalesAed - facts.netSalesAed),
    otherRevenueAdj: 0,
    cogs: cogsInr,
    marketplaceCommission: 0,
    fulfilment: 0,
    shipping: 0,
    collectionFees: 0,
    rtoCharges: 0,
    returnCharges: 0,
    otherMarketplaceCharges: aed(amazonAeFeesTaken(facts)),
    ads: adsInr,
    performanceMarketing: 0,
    otherMarketing: 0,
  }
}

/** The money lines, for restating the statement in rupees. Listed rather than
 * inferred: a percentage is a ratio and does not move, and a unit count is
 * not money — converting 241 units at the month's rate would report 5,801. */
const MONEY_LINES = [
  'grossSales', 'returns', 'netSales', 'amazonFees', 'netProceeds',
  'cogs', 'grossProfit', 'ads', 'overheads', 'ebitda',
]

/**
 * The same statement read in rupees.
 *
 * Converted from the dirham figures rather than recomputed, so the two
 * readings of a month are the same statement at one rate and cannot drift
 * apart. The margins are unchanged, because a ratio is the same number in
 * any currency.
 */
export function amazonAeValuesInInr(values: NativeLineValues, rateInrPerAed: number): NativeLineValues {
  const out: NativeLineValues = { ...values }
  for (const key of MONEY_LINES) out[key] = (values[key] ?? 0) * rateInrPerAed
  return out
}
