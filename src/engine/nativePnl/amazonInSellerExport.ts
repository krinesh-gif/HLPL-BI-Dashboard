import type { AmazonInSkuFeeFacts, PnlLineValues } from '@/data/models'
import { AMAZON_USA_FEE_COLUMNS, AMAZON_USA_FEE_COLUMNS_IN_ORDER, type AmazonUsaFeeColumn } from '@/data/amazonUsa/feeColumns'
import { amazonInSkuFeesTotal } from '@/data/normalize/amazonIndiaProductProfitability'
import type { NativeLineDef, NativeLineValues } from './types'

/**
 * Amazon India Seller Central, built from the Product Profitability export.
 *
 * The marketplace half of Amazon India, and for six months it read as a
 * ₹8,000 business. It is a ₹2 lakh one. The statement was built from
 * settlement reports, each of which covers one fortnightly payment period, and
 * two of them had ever been uploaded — so July showed one order, August and
 * September sixteen and fifteen. The months were right about those
 * settlements and wrong about the business by a factor of twenty-five.
 *
 * This export is the month: every SKU sold in it, with units, returns, sales
 * net of returns and each fee Amazon charged, column by column. It is the same
 * report Amazon USA and Amazon UAE already build their statements from, which
 * is why the fee columns here are the shared `AMAZON_USA_FEE_COLUMNS` rather
 * than a second list — Amazon exports one report in every marketplace, with
 * British spellings in this one.
 *
 * Three things decide how it is read.
 *
 *  1. AMAZON'S OWN NET PROCEEDS IS THE CHECK. The export carries a Net
 *     proceeds column of Amazon's own computing. Net sales less every fee read
 *     has to come back to it, and the statement shows both figures and the
 *     difference rather than asserting that they agree. A charge this build
 *     has not learnt to read shows up there as a gap instead of quietly
 *     flattering the month.
 *
 *  2. IT IS EX-GST, ESTABLISHED RATHER THAN ASSUMED. September's referral fee
 *     is 8.122% of this export's sales; the same month's settlement charges
 *     8.155% commission on a principal the file itself proves ex-GST (its
 *     product tax is exactly 18.0% of principal in every month on file). A
 *     tax-inclusive base would make the export's rate read about 6.9%. So the
 *     two bases agree and there is no output GST to take off the top.
 *
 *  3. THE COST OF GOODS IS OURS, NOT AMAZON'S. The export has a seller-cost
 *     column that Seller Central leaves blank unless someone types costs into
 *     it, and ours is empty — every month on file states zero. Cost is
 *     therefore priced here from our own cost sheet against the units each
 *     SKU sold, and estimated only for a SKU with no cost on file, which the
 *     statement says on its own line.
 *
 * Advertising is charged here in the month that has no Vendor Central
 * statement to carry it. One ad account lifts both halves, so the channel
 * charges the month's spend once — on the wholesale statement where there is
 * one, and on this one where there is not. July 2026 is why that second half
 * of the rule exists: its NPPM file never arrived, so ₹3,53,388.82 of
 * measured Sponsored Products spend was charged on neither statement and
 * Amazon India's July read as having advertised for nothing.
 */

/** Cost of goods for a month, priced from the SKUs the export lists. */
export interface SellerExportCogs {
  priced: number
  unpriced: number
  uncostedSkus: number
  uncostedUnits: number
  /** True when the export predates per-SKU units, so nothing could be priced
   * and the whole cost is a share-of-sales estimate. */
  estimatedWholeMonth: boolean
}

export const EMPTY_SELLER_EXPORT_COGS: SellerExportCogs = {
  priced: 0, unpriced: 0, uncostedSkus: 0, uncostedUnits: 0, estimatedWholeMonth: false,
}

/** Which fee columns this month's file proved to sit inside another one. */
function nestedIds(facts: AmazonInSkuFeeFacts): Set<string> {
  return new Set(facts.nestedFeeIds ?? [])
}

const feeLineDefs = (group: AmazonUsaFeeColumn['group'], section: string): NativeLineDef[] =>
  AMAZON_USA_FEE_COLUMNS_IN_ORDER.filter((c) => c.group === group).map((c) => ({
    key: `fee.${c.id}`,
    label: c.header,
    section,
    kind: 'input' as const,
    group: section,
    // India's export carries about thirty fee columns and charges on six of
    // them. The others are shown the month they are charged and not before.
    hideWhenZero: true,
    href: `#/channels/amazon_in?fee=${c.id}`,
    fee: c.fee,
  }))

export const AMAZON_IN_SELLER_EXPORT_LINE_DEFS: NativeLineDef[] = [
  { key: 'grossSales', label: 'Gross Sales (ex-GST)', section: 'SALES', kind: 'input', note: 'What the month sold, before returns' },
  { key: 'returns', label: '(−) Returns and refunds', section: 'SALES', kind: 'input' },
  { key: 'netSales', label: 'NET SALES (ex-GST)', section: 'SALES', kind: 'subtotal', note: '⭐ denominator for every %' },

  { key: 'totalCogs', label: 'Total COGS', section: 'COST OF GOODS SOLD', kind: 'subtotal', group: 'cogs', isGroupHead: true },
  { key: 'cogsPriced', label: 'COGS — priced from the cost sheet', section: 'COST OF GOODS SOLD', kind: 'input', group: 'cogs' },
  { key: 'cogsUnpriced', label: 'COGS — SKUs with no cost on file (est.)', section: 'COST OF GOODS SOLD', kind: 'input', note: '⚠ estimate — goes to zero once every MSKU is linked to a SKU', hideWhenZero: true, group: 'cogs' },
  { key: 'cm1', label: 'GROSS MARGIN (CM1)', section: 'COST OF GOODS SOLD', kind: 'subtotal' },
  { key: 'cm1Pct', label: 'CM1 %', section: 'COST OF GOODS SOLD', kind: 'percent' },

  { key: 'totalMarketplaceCharges', label: 'Total Amazon Charges', section: 'AMAZON CHARGES', kind: 'subtotal', isGroupHead: true, group: 'AMAZON CHARGES' },
  ...feeLineDefs('marketplace', 'AMAZON CHARGES'),
  { key: 'unmappedFees', label: 'Fee columns not yet named', section: 'AMAZON CHARGES', kind: 'input', fee: 'otherFees', group: 'AMAZON CHARGES', hideWhenZero: true, note: 'Amazon sent a fee block with no heading — counted here rather than dropped or guessed at' },
  { key: 'cm2', label: 'CHANNEL MARGIN (CM2)', section: 'AMAZON CHARGES', kind: 'subtotal', note: 'Is this marketplace worth being on?' },
  { key: 'cm2Pct', label: 'CM2 %', section: 'AMAZON CHARGES', kind: 'percent' },

  { key: 'totalAdvertising', label: 'Total Advertising', section: 'ADVERTISING', kind: 'subtotal', isGroupHead: true, group: 'ADVERTISING', hideWhenZero: true },
  ...feeLineDefs('advertising', 'ADVERTISING'),
  {
    key: 'channelAds', label: 'Campaign spend, from the ads reports', section: 'ADVERTISING', kind: 'input',
    fee: 'advertising', group: 'ADVERTISING', hideWhenZero: true,
    note: 'Billed outside this export — Sponsored Products and Brands, from the Amazon Ads console. Charged here '
      + 'only in a month with no Vendor Central statement to carry it, so the channel pays for it once',
  },
  { key: 'cm3', label: 'CONTRIBUTION MARGIN (CM3)', section: 'ADVERTISING', kind: 'subtotal', note: '⭐ the number to manage this half on' },
  { key: 'cm3Pct', label: 'CM3 %', section: 'ADVERTISING', kind: 'percent' },

  { key: 'otherCosts', label: '(−) Allocated Fixed Expenses', section: 'FIXED EXPENSES', kind: 'input' },
  { key: 'cm4', label: 'NET PROFIT (CM4)', section: 'FIXED EXPENSES', kind: 'subtotal' },
  { key: 'cm4Pct', label: 'Net Profit %', section: 'FIXED EXPENSES', kind: 'percent' },

  // Amazon's own bottom line and the check against it. Not a rung: Amazon
  // strikes it before the goods, which is what used to pull this statement's
  // CM1 out of line with every other channel's.
  { key: 'netProceeds', label: 'Net proceeds, from the fees read here', section: 'MEMO — NET PROCEEDS', kind: 'subtotal' },
  { key: 'sheetNetProceeds', label: 'Net proceeds per Amazon’s own column', section: 'MEMO — NET PROCEEDS', kind: 'input', note: 'Reconciliation' },
  { key: 'netProceedsDiff', label: 'Difference', section: 'MEMO — NET PROCEEDS', kind: 'input', note: 'Reconciliation — anything here is a charge in the file this build has not read' },

  { key: 'unitsSold', label: 'Units sold', section: 'THE MONTH IN UNITS', kind: 'count' },
  { key: 'unitsReturned', label: 'Units returned', section: 'THE MONTH IN UNITS', kind: 'count' },
  { key: 'netUnitsSold', label: 'Units that stayed sold', section: 'THE MONTH IN UNITS', kind: 'count' },
  { key: 'skusCharged', label: 'SKUs charged a fee', section: 'THE MONTH IN UNITS', kind: 'count' },
  { key: 'nonSellingChargedRows', label: 'SKUs charged without selling', section: 'THE MONTH IN UNITS', kind: 'count', hideWhenZero: true, note: 'Stock accruing storage, or a removal order — the charge is the month’s, the sale is not' },
]

/** The month's rows, with a column this file proved to be contained in
 * another shown under its parent rather than counted twice. */
export function amazonInSellerExportLineDefs(facts: AmazonInSkuFeeFacts): NativeLineDef[] {
  const nested = nestedIds(facts)
  const out: NativeLineDef[] = []
  for (const def of AMAZON_IN_SELLER_EXPORT_LINE_DEFS) {
    if (!def.key.startsWith('fee.')) { out.push(def); continue }
    const id = def.key.slice(4)
    const col = AMAZON_USA_FEE_COLUMNS.find((c) => c.id === id)
    const isNested = nested.has(id) && col?.componentOf !== undefined
    // A column that only repeats another one is dropped: there is no sum to
    // check, just the same number printed twice.
    if (isNested && col?.hideWhenNested) continue
    out.push({ ...def, memoOf: isNested ? `fee.${col.componentOf}` : undefined })
  }
  return out
}

/** The month's fees, with a contained column left to its parent. */
export function sellerExportFees(facts: AmazonInSkuFeeFacts): number {
  return amazonInSkuFeesTotal(facts)
}

const less = (v: number): number => (v === 0 ? 0 : -v)

export function computeAmazonInSellerExportPnl(
  facts: AmazonInSkuFeeFacts,
  cogs: SellerExportCogs = EMPTY_SELLER_EXPORT_COGS,
  /** The month's campaign spend, where this statement is the one carrying it. */
  ads = 0,
): NativeLineValues {
  const nested = nestedIds(facts)
  const fee = (id: string) => facts.feeTotalsInr[id] ?? 0
  const counts = (c: AmazonUsaFeeColumn) => !nested.has(c.id)
  const sumGroup = (group: AmazonUsaFeeColumn['group']) =>
    AMAZON_USA_FEE_COLUMNS.filter((c) => c.group === group && counts(c)).reduce((sum, c) => sum + fee(c.id), 0)

  const unmappedFees = Object.values(facts.unmappedFeeTotalsInr ?? {}).reduce((a, b) => a + b, 0)
  const totalMarketplaceCharges = sumGroup('marketplace') + unmappedFees
  // Advertising comes from two places and only one of them is in this file.
  // They are kept apart because Amazon's own Net proceeds column cannot know
  // about spend it did not bill, and netting it in would put the statement
  // out against the export by the whole campaign figure.
  const reportAds = sumGroup('advertising')
  const totalAdvertising = reportAds + ads
  const netSales = facts.netSalesInr
  // The goods first, then the marketplace, then advertising: the ladder every
  // channel is read on. Amazon's export nets its charges before it mentions a
  // cost of goods, and following that order gave this statement a CM1 that
  // meant "after Amazon's charges" while the P&L's meant "after the goods".
  const cm1 = netSales - (cogs.priced + cogs.unpriced)

  // Amazon's Net proceeds also nets off the per-unit seller costs typed into
  // Seller Central. Ours are blank, so this is zero on every month on file —
  // it stays in the arithmetic because Amazon's own figure includes it, and
  // dropping it would put the statement out against the export by that much
  // the first month someone fills the column in.
  const sheetSellerCost = (facts.sheetCogsInr ?? 0) + (facts.sheetMiscCostInr ?? 0)
  const netProceeds = netSales - totalMarketplaceCharges - reportAds - sheetSellerCost

  const totalCogs = cogs.priced + cogs.unpriced
  const cm2 = cm1 - totalMarketplaceCharges
  const cm3 = cm2 - totalAdvertising
  const pct = (v: number): number => (netSales !== 0 ? (v / netSales) * 100 : 0)

  const values: NativeLineValues = {
    grossSales: facts.grossSalesInr,
    returns: less(facts.grossSalesInr - netSales),
    netSales,

    totalMarketplaceCharges: less(totalMarketplaceCharges),
    unmappedFees: less(unmappedFees),
    cm1,
    cm1Pct: pct(cm1),

    totalAdvertising: less(totalAdvertising),
    channelAds: less(ads),

    netProceeds,
    sheetNetProceeds: facts.sheetNetProceedsInr ?? 0,
    netProceedsDiff: netProceeds - (facts.sheetNetProceedsInr ?? 0),

    cogsPriced: less(cogs.priced),
    cogsUnpriced: less(cogs.unpriced),
    totalCogs: less(totalCogs),
    cm2,
    cm2Pct: pct(cm2),
    cm3,
    cm3Pct: pct(cm3),

    otherCosts: 0, // filled in by applyAmazonInSellerExportOtherCosts
    cm4: cm3,
    cm4Pct: pct(cm3),

    unitsSold: facts.unitsSoldQty,
    unitsReturned: facts.unitsReturnedQty,
    netUnitsSold: facts.netUnitsSoldQty,
    skusCharged: Object.keys(facts.feeBySkuInr ?? {}).length,
    nonSellingChargedRows: facts.nonSellingChargedRows,
  }
  // Each fee column on its own line, negated so a charge reads as a cost and
  // a credit — a reimbursement, a referral-fee refund — reads as money back.
  for (const c of AMAZON_USA_FEE_COLUMNS) values[`fee.${c.id}`] = less(fee(c.id))
  return values
}

export function applyAmazonInSellerExportOtherCosts(
  computed: NativeLineValues,
  otherCosts: number,
): NativeLineValues {
  const cm4 = computed.cm3 - otherCosts
  const netSales = computed.netSales
  return { ...computed, otherCosts: less(otherCosts), cm4, cm4Pct: netSales !== 0 ? (cm4 / netSales) * 100 : 0 }
}

/**
 * The same month in the buckets the Master P&L rolls up.
 *
 * Each fee lands in the bucket its own column config assigns it, so the
 * roll-up is built from the same columns the statement shows rather than from
 * a second mapping that can drift away from it.
 */
export function amazonInSellerExportToCanonicalBuckets(
  facts: AmazonInSkuFeeFacts,
  cogs: SellerExportCogs = EMPTY_SELLER_EXPORT_COGS,
  ads = 0,
): PnlLineValues {
  const nested = nestedIds(facts)
  const byBucket = (bucket: string) =>
    AMAZON_USA_FEE_COLUMNS
      .filter((c) => c.bucket === bucket && !nested.has(c.id))
      .reduce((sum, c) => sum + (facts.feeTotalsInr[c.id] ?? 0), 0)
  const unmapped = Object.values(facts.unmappedFeeTotalsInr ?? {}).reduce((a, b) => a + b, 0)

  return {
    grossSales: facts.grossSalesInr,
    discounts: 0,
    returns: facts.grossSalesInr - facts.netSalesInr,
    // Already ex-GST — see the note at the top of this file.
    otherRevenueAdj: 0,
    cogs: cogs.priced + cogs.unpriced + (facts.sheetCogsInr ?? 0),
    marketplaceCommission: byBucket('marketplaceCommission'),
    fulfilment: byBucket('fulfilment'),
    shipping: byBucket('shipping'),
    collectionFees: 0,
    rtoCharges: 0,
    returnCharges: byBucket('returnCharges'),
    otherMarketplaceCharges: byBucket('otherMarketplaceCharges') + unmapped + (facts.sheetMiscCostInr ?? 0),
    ads: byBucket('ads') + ads,
    performanceMarketing: 0,
    otherMarketing: 0,
  }
}
