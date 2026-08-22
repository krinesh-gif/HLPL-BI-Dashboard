import type { MeeshoPnlFacts, PnlLineValues } from '@/data/models'
import type { NativeLineDef, NativeLineValues } from './types'

/**
 * Meesho's native waterfall, built from its real settlement field set
 * (commission, fixed fee, warehousing, forward/reverse shipping, return
 * premium, GST/TCS/TDS, compensation/claims/recovery) — aggregated monthly
 * from order-level settlement rows. GST/TCS/TDS are a memo, not a cost
 * (Meesho collects and remits them; they aren't the seller's expense), matching
 * how the Flipkart and Amazon USA models both treat tax as reconciliation-only.
 *
 * Sign convention: every fact field is a positive magnitude.
 */
export const MEESHO_LINE_DEFS: NativeLineDef[] = [
  { key: 'grossSale', label: 'Gross Sale', section: 'SALES', kind: 'input' },
  { key: 'returns', label: 'Less: Returns', section: 'SALES', kind: 'input' },
  { key: 'netSale', label: 'Net Sale', section: 'SALES', kind: 'subtotal' },

  { key: 'cogs', label: 'Less: COGS', section: 'COGS', kind: 'input' },
  { key: 'cm1', label: 'GROSS MARGIN (CM1)', section: 'COGS', kind: 'subtotal' },
  { key: 'cm1Pct', label: 'CM1 %', section: 'COGS', kind: 'percent' },

  { key: 'forwardShipping', label: 'Less: Forward Shipping', section: 'MARKETPLACE FEES', kind: 'input' },
  { key: 'reverseShipping', label: 'Less: Reverse Shipping', section: 'MARKETPLACE FEES', kind: 'input' },
  { key: 'returnPremium', label: 'Less: Return Premium', section: 'MARKETPLACE FEES', kind: 'input' },
  { key: 'returnPremiumRecovered', label: 'Add: Return Premium Recovered', section: 'MARKETPLACE FEES', kind: 'input' },
  { key: 'commission', label: 'Less: Commission', section: 'MARKETPLACE FEES', kind: 'input' },
  { key: 'fixedFee', label: 'Less: Fixed Fee', section: 'MARKETPLACE FEES', kind: 'input' },
  { key: 'warehousing', label: 'Less: Warehousing Fee', section: 'MARKETPLACE FEES', kind: 'input' },
  { key: 'goldFee', label: 'Less: Meesho Gold Fee', section: 'MARKETPLACE FEES', kind: 'input' },
  { key: 'mallFee', label: 'Less: Meesho Mall Fee', section: 'MARKETPLACE FEES', kind: 'input' },
  { key: 'otherSettlementCharge', label: 'Less: Other Settlement Charges', section: 'MARKETPLACE FEES', kind: 'input' },
  { key: 'totalFees', label: 'Total Marketplace Fees', section: 'MARKETPLACE FEES', kind: 'subtotal' },
  { key: 'cm2', label: 'CHANNEL MARGIN (CM2)', section: 'MARKETPLACE FEES', kind: 'subtotal' },
  { key: 'cm2Pct', label: 'CM2 %', section: 'MARKETPLACE FEES', kind: 'percent' },

  { key: 'ads', label: 'Less: Ads', section: 'ADVERTISING', kind: 'input' },
  { key: 'compensation', label: 'Add: Compensation', section: 'ADVERTISING', kind: 'input' },
  { key: 'claims', label: 'Add: Claims', section: 'ADVERTISING', kind: 'input' },
  { key: 'recovery', label: 'Add: Recovery', section: 'ADVERTISING', kind: 'input' },
  { key: 'cm3', label: 'CONTRIBUTION MARGIN (CM3)', section: 'ADVERTISING', kind: 'subtotal' },
  { key: 'cm3Pct', label: 'CM3 %', section: 'ADVERTISING', kind: 'percent' },

  { key: 'otherCosts', label: 'Less: Other Costs (allocated fixed expenses)', section: 'YOUR OTHER COSTS', kind: 'input' },
  { key: 'cm4', label: 'NET PROFIT (CM4)', section: 'YOUR OTHER COSTS', kind: 'subtotal' },
  { key: 'cm4Pct', label: 'Net Profit %', section: 'YOUR OTHER COSTS', kind: 'percent' },

  { key: 'gst', label: 'GST deducted', section: 'MEMO — TAX (not a cost)', kind: 'input' },
  { key: 'tcs', label: 'TCS deducted', section: 'MEMO — TAX (not a cost)', kind: 'input' },
  { key: 'tds', label: 'TDS deducted', section: 'MEMO — TAX (not a cost)', kind: 'input' },
  { key: 'settlementAmount', label: 'Reported Settlement Amount', section: 'MEMO — TAX (not a cost)', kind: 'input' },
]

export function computeMeeshoPnl(facts: MeeshoPnlFacts): NativeLineValues {
  const netSale = facts.grossSale - facts.returns
  const cm1 = netSale - facts.cogs

  const totalFees =
    facts.forwardShipping + facts.reverseShipping + facts.returnPremium - facts.returnPremiumRecovered +
    facts.commission + facts.fixedFee + facts.warehousing + facts.goldFee + facts.mallFee + facts.otherSettlementCharge
  const cm2 = cm1 - totalFees

  const cm3 = cm2 - facts.ads + facts.compensation + facts.claims + facts.recovery

  return {
    grossSale: facts.grossSale,
    returns: -facts.returns,
    netSale,
    cogs: -facts.cogs,
    cm1,
    cm1Pct: netSale !== 0 ? (cm1 / netSale) * 100 : 0,
    forwardShipping: -facts.forwardShipping,
    reverseShipping: -facts.reverseShipping,
    returnPremium: -facts.returnPremium,
    returnPremiumRecovered: facts.returnPremiumRecovered,
    commission: -facts.commission,
    fixedFee: -facts.fixedFee,
    warehousing: -facts.warehousing,
    goldFee: -facts.goldFee,
    mallFee: -facts.mallFee,
    otherSettlementCharge: -facts.otherSettlementCharge,
    totalFees: -totalFees,
    cm2,
    cm2Pct: netSale !== 0 ? (cm2 / netSale) * 100 : 0,
    ads: -facts.ads,
    compensation: facts.compensation,
    claims: facts.claims,
    recovery: facts.recovery,
    cm3,
    cm3Pct: netSale !== 0 ? (cm3 / netSale) * 100 : 0,
    otherCosts: 0,
    cm4: cm3,
    cm4Pct: netSale !== 0 ? (cm3 / netSale) * 100 : 0,
    gst: -facts.gst,
    tcs: -facts.tcs,
    tds: -facts.tds,
    settlementAmount: facts.settlementAmount,
  }
}

export function applyMeeshoOtherCosts(computed: NativeLineValues, otherCosts: number): NativeLineValues {
  const cm4 = computed.cm3 - otherCosts
  const netSale = computed.netSale
  return { ...computed, otherCosts: -otherCosts, cm4, cm4Pct: netSale !== 0 ? (cm4 / netSale) * 100 : 0 }
}

export function meeshoToCanonicalBuckets(facts: MeeshoPnlFacts): PnlLineValues {
  return {
    grossSales: facts.grossSale,
    discounts: 0,
    returns: facts.returns,
    otherRevenueAdj: 0,
    cogs: facts.cogs,
    marketplaceCommission: facts.commission,
    fulfilment: facts.warehousing,
    shipping: facts.forwardShipping + facts.reverseShipping,
    collectionFees: 0,
    rtoCharges: facts.returnPremium - facts.returnPremiumRecovered,
    returnCharges: 0,
    otherMarketplaceCharges: facts.fixedFee + facts.goldFee + facts.mallFee + facts.otherSettlementCharge - facts.compensation - facts.claims - facts.recovery,
    ads: facts.ads,
    performanceMarketing: 0,
    otherMarketing: 0,
  }
}
