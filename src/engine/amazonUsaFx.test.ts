import { describe, expect, it } from 'vitest'
import type { AmazonUsaPnlFacts, CanonicalSalesRecord, SkuMaster } from '@/data/models'
import { lineValuesToUsd } from '@/data/fxRates'
import { buildChannelPnlView, type ChannelPnlViewInputs } from './channelPnlRouter'
import { buildMultiMonthPnl } from './multiMonthPnl'
import { computeSubtotals } from './pnl'
import { AMAZON_USA_LINE_DEFS, amazonUsaFactsAtRate, amazonUsaValuesInInr, computeAmazonUsaPnl } from './nativePnl/amazonUsa'

/**
 * Amazon USA is denominated in dollars, so one exchange rate scales the entire
 * channel wherever it rolls into the rupee P&L. Two things follow, and both
 * were wrong before: the rate has to belong to the month, and it has to apply
 * to the whole statement rather than half of it.
 */

const skuMaster: SkuMaster[] = [
  { sku: 'AO/Serum/VitC/030', productName: 'Vitamin C Serum', category: 'Skin Care', brand: 'AO', cogs: 120, mrp: 699,
    launchDate: '2025-04-01', status: 'active', leadTimeDays: 21, safetyStock: 0 },
]

function facts(over: Partial<AmazonUsaPnlFacts> = {}): AmazonUsaPnlFacts {
  return {
    month: '2026-07', schemaVersion: 2,
    // Column-level facts, as the importer now produces them.
    feeTotalsUsd: { referralFee: 1350, fbaFulfillmentFees: 900, sponsoredProductsCharge: 500 },
    unmappedFeeTotalsUsd: {}, nestedFeeIds: [],
    sheetCogsUsd: 0, sheetMiscCostUsd: 0, sheetNetProceedsUsd: 0,
    grossSalesUsd: 10000, netSalesUsd: 9000,
    referralFeeUsd: 1350, fbaFulfilmentFeeUsd: 900, storageAgedDisposalUsd: 0,
    couponDealFeesUsd: 0, refundAdminFeeUsd: 0, fbaReimbursementsUsd: 0, otherAmazonFeesUsd: 0,
    sponsoredProductsUsd: 500, cogsUsd: 0, freightUsd: 0,
    sponsoredBrandsUsd: 0, sponsoredDisplayDspUsd: 0, offAmazonAdsUsd: 0,
    exportDocsUsd: 0, usImportDutyUsd: 0, amazonSellingPlanUsd: 0,
    productLiabilityInsuranceUsd: 0, fdaLegalUsd: 0, agencySoftwareUsd: 0, otherOverheadUsd: 0,
    // The rupee costs, carried in rupees so they convert with everything else.
    cogsSourceInr: 264_000,
    freightSourceInr: 22_024,
    ...over,
  }
}

function inputs(fxRate: number, currency: 'USD' | 'INR' = 'USD'): ChannelPnlViewInputs {
  return {
    salesRecords: [] as CanonicalSalesRecord[],
    skuMaster,
    fixedExpenses: [],
    marketing: {},
    facts: { flipkartFacts: [], amazonUsaFacts: [facts()], meeshoFacts: [] },
    fxRate,
    amazonUsaCurrency: currency,
  }
}

describe('rupee costs convert at the month’s rate', () => {
  it('prices cost of goods at the rate given, not at one frozen on upload day', () => {
    // ₹2,64,000 of stock is $3,000 at 88 and $2,750 at 96. Freezing the
    // dollar figure at import left the statement half-converted at one rate
    // and half at another.
    expect(amazonUsaFactsAtRate(facts(), 88).cogsUsd).toBeCloseTo(3000, 6)
    expect(amazonUsaFactsAtRate(facts(), 96).cogsUsd).toBeCloseTo(2750, 6)
  })

  it('converts freight the same way', () => {
    expect(amazonUsaFactsAtRate(facts(), 88).freightUsd).toBeCloseTo(250.27, 2)
  })

  it('keeps a month imported before rupee costs existed rather than reading zero', () => {
    const old = facts({ cogsSourceInr: undefined, freightSourceInr: undefined, cogsUsd: 3000, freightUsd: 250 })
    expect(amazonUsaFactsAtRate(old, 96).cogsUsd).toBe(3000)
  })

  it('refuses a nonsense rate instead of dividing by it', () => {
    expect(amazonUsaFactsAtRate(facts(), 0).cogsUsd).toBe(facts().cogsUsd)
  })
})

describe('a closed month keeps the rate it was closed on', () => {
  it('reports a different rupee roll-up per rate, and the same dollar statement', () => {
    const atJune = buildChannelPnlView('amazon_us', '2026-07', inputs(88.1))
    const atJuly = buildChannelPnlView('amazon_us', '2026-07', inputs(90.2))

    // Gross sales are $10,000 either way; only the rupee figure moves.
    expect(atJune.canonical.lines.grossSales).toBeCloseTo(881_000, 2)
    expect(atJuly.canonical.lines.grossSales).toBeCloseTo(902_000, 2)
    expect(atJune.native?.values.grossSalesUsd).toBe(10_000)
    expect(atJuly.native?.values.grossSalesUsd).toBe(10_000)
  })

  it('moves cost of goods with the rate too, so the margin is internally consistent', () => {
    // The whole statement converts at one rate: a rupee cost divided by a
    // higher rate is fewer dollars, so the dollar margin widens.
    const cheap = computeAmazonUsaPnl(amazonUsaFactsAtRate(facts(), 88))
    const dear = computeAmazonUsaPnl(amazonUsaFactsAtRate(facts(), 96))
    expect(dear.cm2).toBeGreaterThan(cheap.cm2)
  })
})

describe('the same statement in either currency', () => {
  const usd = computeAmazonUsaPnl(amazonUsaFactsAtRate(facts(), 88))
  const inr = amazonUsaValuesInInr(usd, 88)

  it('scales every money line by the rate', () => {
    expect(inr.grossSalesUsd).toBeCloseTo(usd.grossSalesUsd * 88, 4)
    expect(inr.cm2).toBeCloseTo(usd.cm2 * 88, 4)
  })

  it('leaves margin percentages alone — a ratio is the same in any currency', () => {
    // Multiplying 42% by 88 would print 3,696%.
    expect(inr.cm1Pct).toBe(usd.cm1Pct)
    expect(inr.cm2Pct).toBe(usd.cm2Pct)
    expect(inr.cm3Pct).toBe(usd.cm3Pct)
  })

  it('renders the statement in the currency the view asks for', () => {
    const dollars = buildChannelPnlView('amazon_us', '2026-07', inputs(88, 'USD'))
    const rupees = buildChannelPnlView('amazon_us', '2026-07', inputs(88, 'INR'))
    expect(dollars.native?.currency).toBe('USD')
    expect(rupees.native?.currency).toBe('INR')
    expect(rupees.native?.values.grossSalesUsd).toBeCloseTo(880_000, 2)
  })

  it('rolls up into the Master P&L in rupees whichever view is selected', () => {
    // One report, one currency — the toggle is a reading aid, not an accounting
    // choice, so it must not reach the consolidated numbers.
    const dollars = buildChannelPnlView('amazon_us', '2026-07', inputs(88, 'USD'))
    const rupees = buildChannelPnlView('amazon_us', '2026-07', inputs(88, 'INR'))
    expect(rupees.canonical.lines.grossSales).toBe(dollars.canonical.lines.grossSales)
  })
})

describe('the multi-month table follows the currency toggle', () => {
  // The toggle used to move only the native statement lower down the page, so
  // switching to dollars left the main table sitting in rupees and the screen
  // showed two currencies at once with nothing to say which was which.
  const rate = 88.1
  const built = buildChannelPnlView('amazon_us', '2026-07', inputs(rate, 'USD'))

  it('reads the same dollars the native statement does', () => {
    const usd = lineValuesToUsd(built.canonical.lines, rate)
    expect(usd.grossSales).toBeCloseTo(built.native?.values.grossSalesUsd ?? 0, 4)
  })

  it('keeps the Total column and margins right after conversion', () => {
    const inr = buildMultiMonthPnl(['2026-07'], () => built.canonical.lines, computeSubtotals)
    const usd = buildMultiMonthPnl(['2026-07'], () => lineValuesToUsd(built.canonical.lines, rate), computeSubtotals)

    const total = (t: typeof inr, key: string) => t.rows.find((r) => r.def.key === key)?.total ?? 0
    // Money scales by the rate; margins, being ratios, do not move at all.
    expect(total(usd, 'grossSales') * rate).toBeCloseTo(total(inr, 'grossSales'), 2)
    expect(total(usd, 'grossMarginPct')).toBeCloseTo(total(inr, 'grossMarginPct'), 6)
    expect(total(usd, 'ebitdaMarginPct')).toBeCloseTo(total(inr, 'ebitdaMarginPct'), 6)
  })
})

describe('freight is priced when the statement is read, at the month’s rate', () => {
  // 2,311 net units in July. It used to be a constant multiplied in at import
  // and frozen into the month, so correcting the rate reached nothing already
  // loaded and changing it at all needed a deploy.
  const withUnits = { ...facts(), netUnitsSoldQty: 2311, freightSourceInr: 110.12 * 2311 }
  const base = (freightPerUnitInr?: number): ChannelPnlViewInputs => ({
    ...inputs(90, 'USD'),
    facts: { flipkartFacts: [], amazonUsaFacts: [withUnits], meeshoFacts: [] },
    freightPerUnitInr,
  })

  it('multiplies the month’s rate by the units it shipped', () => {
    const v = buildChannelPnlView('amazon_us', '2026-07', base(120)).native?.values
    expect(v?.freightUsd).toBeCloseTo(-(120 * 2311) / 90, 4)
  })

  it('restates the month when the rate is corrected', () => {
    const cheap = buildChannelPnlView('amazon_us', '2026-07', base(90)).native?.values.freightUsd ?? 0
    const dear = buildChannelPnlView('amazon_us', '2026-07', base(150)).native?.values.freightUsd ?? 0
    expect(Math.abs(dear)).toBeGreaterThan(Math.abs(cheap))
  })

  it('keeps the figure imported with the month when no rate is supplied', () => {
    const v = buildChannelPnlView('amazon_us', '2026-07', base(undefined)).native?.values
    expect(v?.freightUsd).toBeCloseTo(-(110.12 * 2311) / 90, 4)
  })
})

describe('the seller-entered cost is out of the statement but still in the tie', () => {
  it('has no line of its own', () => {
    expect(AMAZON_USA_LINE_DEFS.map((d) => d.label)).not.toContain('Seller-entered cost per unit × net units')
  })
})
