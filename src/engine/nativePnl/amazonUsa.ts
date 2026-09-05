import { NATIVE_PNL_ASSUMPTIONS } from '@/config/nativePnlAssumptions'
import type { AmazonUsaPnlFacts, PnlLineValues } from '@/data/models'
import {
  AMAZON_USA_COUNTED_FEE_COLUMNS,
  AMAZON_USA_FEE_COLUMNS,
  type AmazonUsaFeeColumn,
} from '@/data/amazonUsa/feeColumns'
import type { NativeLineDef, NativeLineValues } from './types'

/**
 * The Amazon USA statement, built line-for-line from the Seller Central
 * Product Profitability export.
 *
 * Every marketplace and advertising line below is one named column of that
 * export, carrying Amazon's own title, and its value is that column summed
 * over the month. Nothing is bucketed, renamed or inferred — the previous
 * version folded twenty columns into eight buckets, which is why Gross and
 * Net Sales tied to the sheet and no other line did.
 *
 * The statement ends where Amazon's own arithmetic ends, at Net proceeds, and
 * shows the export's own `Net proceeds total` beside the computed figure with
 * the difference between them. A statement that claims to match the sheet
 * should prove it on screen rather than ask to be believed.
 *
 * Below that tie-point the channel's own economics continue — landed cost,
 * overheads, CM2 and CM3 — because Net proceeds is Amazon's view of the month,
 * not the business's: it knows nothing about what the goods cost to make or
 * ship from India.
 *
 * Sign convention on screen: costs render negative, credits positive.
 */
const feeLineDefs = (group: AmazonUsaFeeColumn['group'], section: string): NativeLineDef[] =>
  AMAZON_USA_FEE_COLUMNS.filter((c) => c.group === group).map((c) => ({
    key: `fee.${c.id}`,
    label: c.header,
    section,
    kind: 'input' as const,
    group: section,
    memoOf: c.componentOf ? `fee.${c.componentOf}` : undefined,
  }))

export const AMAZON_USA_LINE_DEFS: NativeLineDef[] = [
  { key: 'grossSalesUsd', label: 'Gross Sales', section: 'REVENUE', kind: 'input' },
  { key: 'refundsReturnsUsd', label: 'Less: Return', section: 'REVENUE', kind: 'input' },
  { key: 'netSalesUsd', label: 'Net Sales', section: 'REVENUE', kind: 'subtotal' },

  { key: 'totalMarketplaceChargesUsd', label: 'Marketplace Charges', section: 'MARKETPLACE CHARGES', kind: 'subtotal', isGroupHead: true, group: 'MARKETPLACE CHARGES' },
  ...feeLineDefs('marketplace', 'MARKETPLACE CHARGES'),
  { key: 'unmappedFeesUsd', label: 'Fee columns not yet mapped', section: 'MARKETPLACE CHARGES', kind: 'input', group: 'MARKETPLACE CHARGES', hideWhenZero: true, note: 'New Amazon column — check the import warnings' },

  { key: 'totalAdvertisingUsd', label: 'Advertising Fees', section: 'ADVERTISING FEES', kind: 'subtotal', isGroupHead: true, group: 'ADVERTISING FEES' },
  ...feeLineDefs('advertising', 'ADVERTISING FEES'),
  { key: 'sponsoredBrandsUsd', label: 'Sponsored Brands', section: 'ADVERTISING FEES', kind: 'input', group: 'ADVERTISING FEES', note: 'Manual entry' },
  { key: 'sponsoredDisplayDspUsd', label: 'Sponsored Display / DSP', section: 'ADVERTISING FEES', kind: 'input', group: 'ADVERTISING FEES', note: 'Manual entry' },
  { key: 'offAmazonAdsUsd', label: 'Off-Amazon Advertising', section: 'ADVERTISING FEES', kind: 'input', group: 'ADVERTISING FEES', note: 'Manual entry' },

  { key: 'sheetSellerCostUsd', label: 'Seller-entered cost per unit × net units', section: 'NET PROCEEDS', kind: 'input', hideWhenZero: true, note: 'From the export’s own cost columns' },
  { key: 'netProceedsUsd', label: 'Net proceeds total', section: 'NET PROCEEDS', kind: 'subtotal' },
  { key: 'sheetNetProceedsUsd', label: 'Net proceeds per Amazon export', section: 'NET PROCEEDS', kind: 'input', note: 'Reconciliation' },
  { key: 'netProceedsDiffUsd', label: 'Difference', section: 'NET PROCEEDS', kind: 'input', note: 'Reconciliation' },

  { key: 'cogsUsd', label: 'Cost of Goods Sold', section: 'COST OF GOODS & INBOUND LOGISTICS', kind: 'input' },
  { key: 'freightUsd', label: 'India → USA Air Freight', section: 'COST OF GOODS & INBOUND LOGISTICS', kind: 'input' },
  { key: 'exportDocsUsd', label: 'Export Documentation & Handling', section: 'COST OF GOODS & INBOUND LOGISTICS', kind: 'input', note: 'Manual entry' },
  { key: 'usImportDutyUsd', label: 'US Import Duty & Clearance', section: 'COST OF GOODS & INBOUND LOGISTICS', kind: 'input', note: 'Manual entry' },
  { key: 'totalLandedCostUsd', label: 'Total Landed Cost', section: 'COST OF GOODS & INBOUND LOGISTICS', kind: 'subtotal' },
  { key: 'cm2', label: 'CM2 — Contribution Margin', section: 'COST OF GOODS & INBOUND LOGISTICS', kind: 'subtotal' },
  { key: 'cm2Pct', label: 'CM2 %', section: 'COST OF GOODS & INBOUND LOGISTICS', kind: 'percent' },

  { key: 'amazonSellingPlanUsd', label: 'Amazon Selling Plan', section: 'FIXED OVERHEADS & FINANCE', kind: 'input', note: 'Manual entry' },
  { key: 'productLiabilityInsuranceUsd', label: 'Product Liability Insurance', section: 'FIXED OVERHEADS & FINANCE', kind: 'input', note: 'Manual entry' },
  { key: 'fdaLegalUsd', label: 'FDA / MoCRA, Trademark, Legal', section: 'FIXED OVERHEADS & FINANCE', kind: 'input', note: 'Manual entry' },
  { key: 'agencySoftwareUsd', label: 'Agency, Software & Tools', section: 'FIXED OVERHEADS & FINANCE', kind: 'input', note: 'Manual entry' },
  { key: 'otherOverheadUsd', label: 'Other US Overhead', section: 'FIXED OVERHEADS & FINANCE', kind: 'input', note: 'Manual entry' },
  { key: 'fxConversionCostUsd', label: 'FX Conversion & Remittance Cost', section: 'FIXED OVERHEADS & FINANCE', kind: 'input' },
  { key: 'totalOverheadsUsd', label: 'Total Overheads & Finance', section: 'FIXED OVERHEADS & FINANCE', kind: 'subtotal' },
  { key: 'cm3', label: 'CM3 — Channel Profit Before Tax', section: 'FIXED OVERHEADS & FINANCE', kind: 'subtotal' },
  { key: 'cm3Pct', label: 'CM3 %', section: 'FIXED OVERHEADS & FINANCE', kind: 'percent' },
]

/**
 * The facts with their rupee costs converted at a given rate.
 *
 * Cost of goods and freight are rupee amounts; every other figure is already
 * in dollars because Amazon reports it that way. Converting them here, at read
 * time, is what lets a month be restated when its rate is corrected. Facts
 * imported before the rupee amounts were stored keep their frozen dollar
 * figures, so an old month still renders rather than reading as zero cost.
 */
export function amazonUsaFactsAtRate(facts: AmazonUsaPnlFacts, fxRate: number): AmazonUsaPnlFacts {
  if (fxRate <= 0) return facts
  return {
    ...facts,
    cogsUsd: facts.cogsSourceInr !== undefined ? facts.cogsSourceInr / fxRate : facts.cogsUsd,
    freightUsd: facts.freightSourceInr !== undefined ? facts.freightSourceInr / fxRate : facts.freightUsd,
  }
}

/**
 * The fee totals to read, whichever schema the month was imported under.
 *
 * A month imported before the rebuild has only the eight collapsed buckets.
 * Rather than render it as zeros, its buckets are placed on the nearest named
 * lines so the old month still reads — approximately, and labelled as such by
 * the reconciliation row, which will not tie for those months.
 */
export function amazonUsaFeeTotals(facts: AmazonUsaPnlFacts): Record<string, number> {
  if (facts.feeTotalsUsd) return facts.feeTotalsUsd
  return {
    referralFee: facts.referralFeeUsd,
    fbaFulfillmentFees: facts.fbaFulfilmentFeeUsd,
    baseMonthlyStorageFee: facts.storageAgedDisposalUsd,
    couponParticipationFee: facts.couponDealFeesUsd,
    refundAdministrationFee: facts.refundAdminFeeUsd,
    fbaInventoryReimbursement: -facts.fbaReimbursementsUsd,
    storageUtilizationSurcharge: facts.otherAmazonFeesUsd,
    sponsoredProductsCharge: facts.sponsoredProductsUsd,
  }
}

export function computeAmazonUsaPnl(facts: AmazonUsaPnlFacts): NativeLineValues {
  const refundsReturnsUsd = facts.grossSalesUsd - facts.netSalesUsd
  const feeTotals = amazonUsaFeeTotals(facts)
  const fee = (id: string) => feeTotals[id] ?? 0

  // A fee column Amazon has added since this build shipped. Counted so the
  // month still ties, and shown on its own line so it is never mistaken for a
  // fee that was understood.
  const unmappedFeesUsd = Object.values(facts.unmappedFeeTotalsUsd ?? {}).reduce((a, b) => a + b, 0)

  const sumGroup = (group: AmazonUsaFeeColumn['group']) =>
    AMAZON_USA_COUNTED_FEE_COLUMNS.filter((c) => c.group === group).reduce((sum, c) => sum + fee(c.id), 0)

  const totalMarketplaceChargesUsd = sumGroup('marketplace') + unmappedFeesUsd
  // Sponsored Products comes across in the export; the other three placements
  // are typed in monthly because Amazon does not put them in this report.
  const totalAdvertisingUsd =
    sumGroup('advertising') + facts.sponsoredBrandsUsd + facts.sponsoredDisplayDspUsd + facts.offAmazonAdsUsd

  // Amazon's Net proceeds also nets off the per-unit costs a seller typed into
  // Seller Central. Small here, but leaving it out is the difference between
  // tying to the sheet and nearly tying to it.
  const sheetSellerCostUsd = (facts.sheetCogsUsd ?? 0) + (facts.sheetMiscCostUsd ?? 0)
  const netProceedsUsd = facts.netSalesUsd - totalMarketplaceChargesUsd - totalAdvertisingUsd - sheetSellerCostUsd

  const totalLandedCostUsd = facts.cogsUsd + facts.freightUsd + facts.exportDocsUsd + facts.usImportDutyUsd
  const cm2 = netProceedsUsd - totalLandedCostUsd

  const fxConversionCostUsd = facts.netSalesUsd * (facts.fxConversionCostPct / 100)
  const totalOverheadsUsd =
    facts.amazonSellingPlanUsd + facts.productLiabilityInsuranceUsd + facts.fdaLegalUsd +
    facts.agencySoftwareUsd + facts.otherOverheadUsd + fxConversionCostUsd
  const cm3 = cm2 - totalOverheadsUsd

  const values: NativeLineValues = {
    grossSalesUsd: facts.grossSalesUsd,
    refundsReturnsUsd: -refundsReturnsUsd,
    netSalesUsd: facts.netSalesUsd,

    totalMarketplaceChargesUsd: -totalMarketplaceChargesUsd,
    unmappedFeesUsd: -unmappedFeesUsd,
    totalAdvertisingUsd: -totalAdvertisingUsd,
    sponsoredBrandsUsd: -facts.sponsoredBrandsUsd,
    sponsoredDisplayDspUsd: -facts.sponsoredDisplayDspUsd,
    offAmazonAdsUsd: -facts.offAmazonAdsUsd,

    sheetSellerCostUsd: -sheetSellerCostUsd,
    netProceedsUsd,
    sheetNetProceedsUsd: facts.sheetNetProceedsUsd ?? 0,
    netProceedsDiffUsd: netProceedsUsd - (facts.sheetNetProceedsUsd ?? 0),

    cogsUsd: -facts.cogsUsd,
    freightUsd: -facts.freightUsd,
    exportDocsUsd: -facts.exportDocsUsd,
    usImportDutyUsd: -facts.usImportDutyUsd,
    totalLandedCostUsd: -totalLandedCostUsd,
    cm2,
    cm2Pct: facts.netSalesUsd !== 0 ? (cm2 / facts.netSalesUsd) * 100 : 0,
    amazonSellingPlanUsd: -facts.amazonSellingPlanUsd,
    productLiabilityInsuranceUsd: -facts.productLiabilityInsuranceUsd,
    fdaLegalUsd: -facts.fdaLegalUsd,
    agencySoftwareUsd: -facts.agencySoftwareUsd,
    otherOverheadUsd: -facts.otherOverheadUsd,
    fxConversionCostUsd: -fxConversionCostUsd,
    totalOverheadsUsd: -totalOverheadsUsd,
    cm3,
    cm3Pct: facts.netSalesUsd !== 0 ? (cm3 / facts.netSalesUsd) * 100 : 0,
  }
  // Each fee column on its own line, negated so a charge reads as a cost and a
  // credit (a reimbursement, a referral refund) reads as income.
  for (const c of AMAZON_USA_FEE_COLUMNS) values[`fee.${c.id}`] = -fee(c.id)
  return values
}

/** Re-buckets into the canonical structure, converting USD to INR at the
 * month's rate so this channel rolls up correctly into the (₹) Master P&L. */
export function amazonUsaToCanonicalBuckets(facts: AmazonUsaPnlFacts, fxRate = NATIVE_PNL_ASSUMPTIONS.usdToInrRate): PnlLineValues {
  const inr = (usd: number) => usd * fxRate
  const feeTotals = amazonUsaFeeTotals(facts)
  // Each named fee lands in the canonical bucket its config assigns it, so the
  // Master P&L is built from the same twenty columns the statement shows
  // rather than from a second, hand-maintained mapping that can drift.
  const byBucket = (bucket: string) =>
    AMAZON_USA_COUNTED_FEE_COLUMNS
      .filter((c) => c.bucket === bucket)
      .reduce((sum, c) => sum + (feeTotals[c.id] ?? 0), 0)
  const unmapped = Object.values(facts.unmappedFeeTotalsUsd ?? {}).reduce((a, b) => a + b, 0)

  return {
    grossSales: inr(facts.grossSalesUsd),
    discounts: 0,
    returns: inr(facts.grossSalesUsd - facts.netSalesUsd),
    otherRevenueAdj: 0,
    cogs: inr(facts.cogsUsd + (facts.sheetCogsUsd ?? 0)),
    marketplaceCommission: inr(byBucket('marketplaceCommission')),
    fulfilment: inr(byBucket('fulfilment')),
    shipping: inr(facts.freightUsd + facts.exportDocsUsd + facts.usImportDutyUsd),
    collectionFees: 0,
    rtoCharges: 0,
    returnCharges: inr(byBucket('returnCharges')),
    otherMarketplaceCharges: inr(byBucket('otherMarketplaceCharges') + unmapped + (facts.sheetMiscCostUsd ?? 0)),
    ads: inr(byBucket('ads') + facts.sponsoredBrandsUsd + facts.sponsoredDisplayDspUsd),
    performanceMarketing: inr(facts.offAmazonAdsUsd),
    otherMarketing: 0,
    otherOpex: inr(
      facts.amazonSellingPlanUsd + facts.productLiabilityInsuranceUsd + facts.fdaLegalUsd +
      facts.agencySoftwareUsd + facts.otherOverheadUsd + facts.netSalesUsd * (facts.fxConversionCostPct / 100),
    ),
  }
}

/**
 * The same statement in rupees.
 *
 * Every line is a money amount except the margin percentages, which are ratios
 * and identical in either currency — converting them would turn 42% into 4,000%.
 * Percentage keys are therefore passed through untouched.
 */
export function amazonUsaValuesInInr(values: NativeLineValues, fxRate: number): NativeLineValues {
  const converted: NativeLineValues = {}
  for (const [key, value] of Object.entries(values)) {
    converted[key] = key.endsWith('Pct') ? value : value * fxRate
  }
  return converted
}
