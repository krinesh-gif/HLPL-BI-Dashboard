import { NATIVE_PNL_ASSUMPTIONS } from '@/config/nativePnlAssumptions'
import type { AmazonUsaPnlFacts, PnlLineValues } from '@/data/models'
import type { NativeLineDef, NativeLineValues } from './types'

/**
 * Matches the real Amazon USA P&L model (Aravi_Amazon_USA_PnL_FY2627_v7.xlsx,
 * "P&L (USD)" sheet). Unlike Flipkart, CM1 here is defined AFTER marketplace
 * fees and advertising but BEFORE COGS/freight — a genuinely different
 * sequencing, matched exactly rather than forced into one template.
 * Facts come from normalizing the Seller Central "Product Profitability"
 * export plus a small monthly form for figures that export doesn't carry
 * (Sponsored Brands/Display/off-Amazon spend, overheads, FX).
 *
 * Sign convention: every fact field is a positive USD magnitude.
 */
export const AMAZON_USA_LINE_DEFS: NativeLineDef[] = [
  { key: 'grossSalesUsd', label: 'Gross Product Sales', section: 'REVENUE', kind: 'input' },
  { key: 'refundsReturnsUsd', label: 'Less: Refunds & Returns', section: 'REVENUE', kind: 'input' },
  { key: 'netSalesUsd', label: 'Net Sales', section: 'REVENUE', kind: 'subtotal' },

  { key: 'referralFeeUsd', label: 'Referral Fee', section: 'AMAZON MARKETPLACE FEES', kind: 'input' },
  { key: 'fbaFulfilmentFeeUsd', label: 'FBA Fulfilment Fees', section: 'AMAZON MARKETPLACE FEES', kind: 'input' },
  { key: 'storageAgedDisposalUsd', label: 'Storage, Aged Inventory & Disposal', section: 'AMAZON MARKETPLACE FEES', kind: 'input' },
  { key: 'couponDealFeesUsd', label: 'Coupon & Deal Fees', section: 'AMAZON MARKETPLACE FEES', kind: 'input' },
  { key: 'refundAdminFeeUsd', label: 'Refund Admin & Returns Processing', section: 'AMAZON MARKETPLACE FEES', kind: 'input' },
  { key: 'otherAmazonFeesUsd', label: 'Other Amazon Fees', section: 'AMAZON MARKETPLACE FEES', kind: 'input' },
  { key: 'fbaReimbursementsUsd', label: 'Add: FBA Reimbursements / Clawbacks', section: 'AMAZON MARKETPLACE FEES', kind: 'input' },
  { key: 'totalAmazonFeesUsd', label: 'Total Amazon Fees', section: 'AMAZON MARKETPLACE FEES', kind: 'subtotal' },
  { key: 'grossContributionUsd', label: 'Gross Contribution After Amazon Fees', section: 'AMAZON MARKETPLACE FEES', kind: 'subtotal' },

  { key: 'sponsoredProductsUsd', label: 'Sponsored Products', section: 'ADVERTISING', kind: 'input' },
  { key: 'sponsoredBrandsUsd', label: 'Sponsored Brands', section: 'ADVERTISING', kind: 'input', note: 'Manual entry' },
  { key: 'sponsoredDisplayDspUsd', label: 'Sponsored Display / DSP', section: 'ADVERTISING', kind: 'input', note: 'Manual entry' },
  { key: 'offAmazonAdsUsd', label: 'Off-Amazon Advertising', section: 'ADVERTISING', kind: 'input', note: 'Manual entry' },
  { key: 'totalAdvertisingUsd', label: 'Total Advertising', section: 'ADVERTISING', kind: 'subtotal' },
  { key: 'cm1', label: 'CM1 — After Amazon Fees & Advertising', section: 'ADVERTISING', kind: 'subtotal' },
  { key: 'cm1Pct', label: 'CM1 %', section: 'ADVERTISING', kind: 'percent' },

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

export function computeAmazonUsaPnl(facts: AmazonUsaPnlFacts): NativeLineValues {
  const refundsReturnsUsd = facts.grossSalesUsd - facts.netSalesUsd

  const totalAmazonFeesUsd =
    facts.referralFeeUsd + facts.fbaFulfilmentFeeUsd + facts.storageAgedDisposalUsd +
    facts.couponDealFeesUsd + facts.refundAdminFeeUsd + facts.otherAmazonFeesUsd - facts.fbaReimbursementsUsd
  const grossContributionUsd = facts.netSalesUsd - totalAmazonFeesUsd

  const totalAdvertisingUsd = facts.sponsoredProductsUsd + facts.sponsoredBrandsUsd + facts.sponsoredDisplayDspUsd + facts.offAmazonAdsUsd
  const cm1 = grossContributionUsd - totalAdvertisingUsd

  const totalLandedCostUsd = facts.cogsUsd + facts.freightUsd + facts.exportDocsUsd + facts.usImportDutyUsd
  const cm2 = cm1 - totalLandedCostUsd

  const fxConversionCostUsd = facts.netSalesUsd * (facts.fxConversionCostPct / 100)
  const totalOverheadsUsd =
    facts.amazonSellingPlanUsd + facts.productLiabilityInsuranceUsd + facts.fdaLegalUsd +
    facts.agencySoftwareUsd + facts.otherOverheadUsd + fxConversionCostUsd
  const cm3 = cm2 - totalOverheadsUsd

  return {
    grossSalesUsd: facts.grossSalesUsd,
    refundsReturnsUsd: -refundsReturnsUsd,
    netSalesUsd: facts.netSalesUsd,
    referralFeeUsd: -facts.referralFeeUsd,
    fbaFulfilmentFeeUsd: -facts.fbaFulfilmentFeeUsd,
    storageAgedDisposalUsd: -facts.storageAgedDisposalUsd,
    couponDealFeesUsd: -facts.couponDealFeesUsd,
    refundAdminFeeUsd: -facts.refundAdminFeeUsd,
    otherAmazonFeesUsd: -facts.otherAmazonFeesUsd,
    fbaReimbursementsUsd: facts.fbaReimbursementsUsd,
    totalAmazonFeesUsd: -totalAmazonFeesUsd,
    grossContributionUsd,
    sponsoredProductsUsd: -facts.sponsoredProductsUsd,
    sponsoredBrandsUsd: -facts.sponsoredBrandsUsd,
    sponsoredDisplayDspUsd: -facts.sponsoredDisplayDspUsd,
    offAmazonAdsUsd: -facts.offAmazonAdsUsd,
    totalAdvertisingUsd: -totalAdvertisingUsd,
    cm1,
    cm1Pct: facts.netSalesUsd !== 0 ? (cm1 / facts.netSalesUsd) * 100 : 0,
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
}

/** Re-buckets into the canonical structure, converting USD to INR at the
 * configured rate so this channel rolls up correctly into the (₹) Master P&L. */
export function amazonUsaToCanonicalBuckets(facts: AmazonUsaPnlFacts, fxRate = NATIVE_PNL_ASSUMPTIONS.usdToInrRate): PnlLineValues {
  const inr = (usd: number) => usd * fxRate
  return {
    grossSales: inr(facts.grossSalesUsd),
    discounts: 0,
    returns: inr(facts.grossSalesUsd - facts.netSalesUsd),
    otherRevenueAdj: 0,
    cogs: inr(facts.cogsUsd),
    marketplaceCommission: inr(facts.referralFeeUsd),
    fulfilment: inr(facts.fbaFulfilmentFeeUsd),
    shipping: inr(facts.freightUsd + facts.exportDocsUsd + facts.usImportDutyUsd),
    collectionFees: 0,
    rtoCharges: 0,
    returnCharges: inr(facts.refundAdminFeeUsd),
    otherMarketplaceCharges: inr(facts.storageAgedDisposalUsd + facts.couponDealFeesUsd + facts.otherAmazonFeesUsd - facts.fbaReimbursementsUsd),
    ads: inr(facts.sponsoredProductsUsd + facts.sponsoredBrandsUsd + facts.sponsoredDisplayDspUsd),
    performanceMarketing: inr(facts.offAmazonAdsUsd),
    otherMarketing: 0,
    otherOpex: inr(
      facts.amazonSellingPlanUsd + facts.productLiabilityInsuranceUsd + facts.fdaLegalUsd +
      facts.agencySoftwareUsd + facts.otherOverheadUsd + facts.netSalesUsd * (facts.fxConversionCostPct / 100),
    ),
  }
}
