import { describe, expect, it } from 'vitest'
import type { AdsRecord, AmazonUsaPnlFacts, FlipkartPnlFacts, MyntraPnlFacts } from '@/data/models'
import type { ChannelFactsStore } from './channelFactsStore'
import { acosOf, adsSpendFor, adsSpendForMonth, measuredSpendOf, roasOf, totalAdsSpend } from './adsSpend'
import { marketingFromAds } from './marketing'
import { statementAdSpend } from './channelNetSales'

/**
 * Two screens were reporting different advertising for the same month.
 *
 * Where a marketplace bills advertising inside the statement it settles on,
 * the P&L charges that figure — it is the money the platform took. The Ads
 * pages read the uploaded campaign report instead, which is the platform's
 * measurement of what the campaigns did, cut on campaign dates rather than on
 * the billing cycle. Measured against the owner's own six months:
 *
 *   Flipkart     ₹15,79,224 on the Ads pages, ₹15,56,837 in the P&L. Months
 *                apart by as much as ₹2.8 lakh in both directions, and the
 *                period 1.4% apart — a difference of timing, not of fact.
 *   Amazon USA   ₹3,27,958 against ₹11,38,871. Five of seven months had no
 *                campaign report at all and read as "No data" while the P&L
 *                charged ₹8.11 lakh.
 *
 * So the billed figure is the spend, and the report keeps what only it can
 * measure. Nothing here changes a P&L figure: the marketing roll-up the P&L
 * reads is untouched, which the last test holds.
 */

const EMPTY: ChannelFactsStore = { flipkartFacts: [], amazonUsaFacts: [], meeshoFacts: [] }

function flipkart(over: Partial<FlipkartPnlFacts> = {}): FlipkartPnlFacts {
  return {
    month: '2026-08', grossSales: 1_700_000, estimatedNetSales: 1_400_000,
    cogsPriced: 0, cogsUnpriced: 0, commissionFee: 0, collectionFee: 0, fixedFee: 0,
    pickPackFee: 0, forwardShippingFee: 0, reverseShippingFee: 0, storageFee: 0,
    recallFee: 0, otherMarketplaceFees: 0, rewardsSpf: 0,
    sellerFundedDiscount: 0, customerAddOns: 0, outputGst: 0,
    flipkartAds: 229_795.5, googleAds: 26_151.729,
    ...over,
  }
}

function amazonUsa(over: Partial<AmazonUsaPnlFacts> = {}): AmazonUsaPnlFacts {
  return {
    month: '2026-08', schemaVersion: 2,
    feeTotalsUsd: { sponsoredProductsCharge: 2257.91 },
    unmappedFeeTotalsUsd: {}, nestedFeeIds: [],
    sheetCogsUsd: 0, sheetMiscCostUsd: 0, sheetNetProceedsUsd: 0,
    grossSalesUsd: 26_436.7, netSalesUsd: 24_787.73,
    referralFeeUsd: 0, fbaFulfilmentFeeUsd: 0, storageAgedDisposalUsd: 0,
    couponDealFeesUsd: 0, refundAdminFeeUsd: 0, fbaReimbursementsUsd: 0, otherAmazonFeesUsd: 0,
    sponsoredProductsUsd: 0, cogsUsd: 0, freightUsd: 0,
    sponsoredBrandsUsd: 0, sponsoredDisplayDspUsd: 0, offAmazonAdsUsd: 0,
    exportDocsUsd: 0, usImportDutyUsd: 0,
    cogsSourceInr: 0, freightSourceInr: 0,
    ...over,
  }
}

const record = (over: Partial<AdsRecord> = {}): AdsRecord => ({
  date: '2026-08-15', channel: 'flipkart', campaign: 'C1',
  impressions: 100_000, clicks: 2_000, spend: 342_832.8, adSales: 1_640_675.8, adOrders: 900,
  importId: 'i', ...over,
})

describe('advertising a marketplace bills inside its own statement', () => {
  it('shows what Flipkart billed, Ads and Google Ads as one figure', () => {
    // The P&L charges both lines as one Total Advertising, so the Ads page
    // reports the same thing rather than Flipkart's PLA alone.
    const facts = { ...EMPTY, flipkartFacts: [flipkart()] }
    const f = adsSpendFor('flipkart', '2026-08', [], [], undefined, facts)

    expect(f.source).toBe('statement')
    expect(f.spend).toBeCloseTo(229_795.5 + 26_151.729, 3)
    expect(f.sourceLabel).toMatch(/statement/i)
  })

  it('converts Amazon USA at the month’s rate', () => {
    const facts = { ...EMPTY, amazonUsaFacts: [amazonUsa()] }
    const f = adsSpendFor('amazon_us', '2026-08', [], [], { USD: 95.43, AED: 25.97 }, facts)

    expect(f.source).toBe('statement')
    expect(f.spend).toBeCloseTo(2257.91 * 95.43, 2)
  })

  /**
   * The month the owner was looking at. The statement billed ₹2,55,947 and
   * the campaign report measured ₹3,42,833 — both real, cut differently.
   * Showing one and hiding the other is what made this impossible to see.
   */
  it('keeps the campaign report’s own figure beside it', () => {
    const facts = { ...EMPTY, flipkartFacts: [flipkart()] }
    const f = adsSpendFor('flipkart', '2026-08', [record()], [], undefined, facts)

    expect(f.spend).toBeCloseTo(255_947.229, 3)
    expect(f.reportedSpend).toBeCloseTo(342_832.8, 3)
    // What only the report can measure survives.
    expect(f.adSales).toBeCloseTo(1_640_675.8, 3)
    expect(f.impressions).toBe(100_000)
  })

  it('does not repeat the same figure twice', () => {
    const facts = { ...EMPTY, flipkartFacts: [flipkart({ flipkartAds: 342_832.8, googleAds: 0 })] }
    const f = adsSpendFor('flipkart', '2026-08', [record()], [], undefined, facts)
    expect(f.reportedSpend).toBeNull()
  })

  /**
   * ROAS and ACOS are the report's measurement. The sales beside them were
   * counted against the report's spend and on its calendar, so dividing by a
   * figure cut on the billing cycle states a return neither source claims —
   * here it would read 6.41x against a measured 4.79x.
   */
  it('measures ROAS and ACOS against the spend that was measured', () => {
    const facts = { ...EMPTY, flipkartFacts: [flipkart()] }
    const f = adsSpendFor('flipkart', '2026-08', [record()], [], undefined, facts)

    expect(measuredSpendOf(f)).toBeCloseTo(342_832.8, 3)
    expect(roasOf(f)).toBeCloseTo(1_640_675.8 / 342_832.8, 6)
    expect(acosOf(f)).toBeCloseTo((342_832.8 / 1_640_675.8) * 100, 6)
    expect(roasOf(f)).not.toBeCloseTo(1_640_675.8 / f.spend, 3)
  })

  it('totals the billed spend and still measures the measured one', () => {
    const facts = { ...EMPTY, flipkartFacts: [flipkart()] }
    const totals = totalAdsSpend(adsSpendForMonth('2026-08', [record()], [], ['flipkart'], undefined, facts))

    expect(totals.spend).toBeCloseTo(255_947.229, 3)
    expect(totals.roas).toBeCloseTo(1_640_675.8 / 342_832.8, 6)
    expect(totals.hasBilledDifference).toBe(true)
  })
})

describe('a statement that carries no advertising', () => {
  /**
   * Most do not have the column at all, and a zero that outranked a real
   * campaign report would wipe the spend off every one of them. Myntra is the
   * case to watch: its P&L report has an advertising line that is always zero,
   * and the figure comes from the PLA campaign report.
   */
  it('leaves the campaign report in charge', () => {
    const myntraFacts = [{ month: '2026-08', myntraAds: 0 } as MyntraPnlFacts]
    const facts = { ...EMPTY, myntraFacts }
    const f = adsSpendFor('myntra', '2026-08', [record({ channel: 'myntra', spend: 79_799 })], [], undefined, facts)

    expect(statementAdSpend('myntra', '2026-08', facts)).toBeNull()
    expect(f.source).toBe('report')
    expect(f.spend).toBeCloseTo(79_799, 3)
  })

  it('leaves a hand-entered invoice in charge', () => {
    const f = adsSpendFor('nykaa', '2026-08', [], [
      { channel: 'nykaa', month: '2026-08', amount: 169_087, enteredAt: '2026-09-28T00:00:00Z' },
    ], undefined, EMPTY)

    expect(f.source).toBe('manual')
    expect(f.spend).toBe(169_087)
  })

  it('says so for a month with no statement at all', () => {
    expect(statementAdSpend('flipkart', '2026-08', EMPTY)).toBeNull()
  })
})

/**
 * The P&L is settled and must not move. It reads its advertising from the
 * marketing roll-up, which is built from the campaign reports and the manual
 * entries — the channels that bill inside their statement take it from the
 * statement in their own branch of the router and never from here.
 */
describe('the P&L is left exactly as it was', () => {
  it('rolls marketing up from the reports, untouched by any of this', () => {
    const marketing = marketingFromAds([record()], '2026-08', [])
    expect(marketing.flipkart?.ads).toBeCloseTo(342_832.8, 3)
  })
})
