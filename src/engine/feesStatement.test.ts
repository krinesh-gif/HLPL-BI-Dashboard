import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import type { BusinessChannelId } from '@/config/channels'
import type { FlipkartPnlFacts, MeeshoPnlFacts, PnlLineValues } from '@/data/models'
import { normalizeBlinkitPayoutZip } from '@/data/normalize/blinkitPayout'
import type { ChannelPnlView } from './channelPnlRouter'
import { buildChannelFeesStatement, buildFeesStatement } from './feesStatement'
import { isCostOfSelling, type FeeCategoryId } from './nativePnl/feeCategories'
import { computeSubtotals } from './pnl'
import { BLINKIT_LINE_DEFS, computeBlinkitPnl } from './nativePnl/blinkit'
import { FLIPKART_LINE_DEFS, computeFlipkartPnl, flipkartToCanonicalBuckets } from './nativePnl/flipkart'
import { MEESHO_LINE_DEFS, computeMeeshoPnl } from './nativePnl/meesho'
import { MYNTRA_LINE_DEFS } from './nativePnl/myntra'
import { NYKAA_LINE_DEFS } from './nativePnl/nykaa'
import { AMAZON_IN_SELLER_LINE_DEFS } from './nativePnl/amazonInSeller'
import { AMAZON_USA_LINE_DEFS } from './nativePnl/amazonUsa'
import type { NativeLineDef, NativeLineValues } from './nativePnl/types'

const CHANNEL_LINE_DEFS: { channel: string; defs: NativeLineDef[] }[] = [
  { channel: 'flipkart', defs: FLIPKART_LINE_DEFS },
  { channel: 'meesho', defs: MEESHO_LINE_DEFS },
  { channel: 'myntra', defs: MYNTRA_LINE_DEFS },
  { channel: 'nykaa', defs: NYKAA_LINE_DEFS },
  { channel: 'amazon_in', defs: AMAZON_IN_SELLER_LINE_DEFS },
  { channel: 'blinkit', defs: BLINKIT_LINE_DEFS },
  { channel: 'amazon_us', defs: AMAZON_USA_LINE_DEFS },
]

/**
 * A charge line left untagged on purpose, and why.
 *
 * This list is the whole point of the coverage test below. A charge section is
 * where money leaves, so a line sitting in one and carrying no `fee` tag is
 * either a mistake or a decision — and if it is a decision it gets written
 * down here, with its reason, rather than being invisible. Adding a channel
 * means either tagging its charges or saying here why a line is not one.
 */
const NOT_A_CHARGE: Record<string, string> = {
  'flipkart.rewardsSpf':
    'Rewards and the Seller Protection Fund are money Flipkart pays us, not a charge. Netting them into the fees would understate what Flipkart costs.',
  'flipkart.googleAds':
    'Billed by Google, not by Flipkart. It is advertising spend on the channel, not a charge the channel levies.',
  'meesho.adsGst':
    'The same rupees as the gstOnAds memo line, which carries the feeTax tag. Tagging both would count one month of ad GST twice.',
  'meesho.outputGstMemo':
    'GST collected from the shopper on our own sales and paid onward. Nothing to do with what Meesho charged us.',
  'nykaa.listDiscount':
    'A discount off MRP is the price the goods sold at, not a fee for selling them. Nykaa recovers it, but calling it a charge would make a price cut look like a cost of the channel.',
  'nykaa.promoDiscount':
    'Same reason as listDiscount — a promotion is a price decision. It is on the statement, under its own heading, where it reads as what it is.',
  'nykaa.nykaaFundedCoupon':
    'The part of the discount Nykaa pays for itself, added back. Not a charge in either direction.',
}

/** A section whose lines hold money the marketplace charged. */
const CHARGE_SECTION = /FEE|CHARGE|EXPENSE|COMMISSION|ADVERTIS/i

describe('every channel tags what it was charged', () => {
  it.each(CHANNEL_LINE_DEFS)('$channel leaves no charge line untagged', ({ channel, defs }) => {
    const missing = defs
      .filter((d) => d.kind === 'input' && !d.fee && !d.memoOf && CHARGE_SECTION.test(d.section))
      .filter((d) => NOT_A_CHARGE[`${channel}.${d.key}`] === undefined)
      .map((d) => `${d.section} :: ${d.key} (${d.label})`)

    // A new channel reaches this with its charges untagged, and the failure
    // names each line rather than leaving the fees statement quietly short.
    expect(missing, `tag these with a fee category, or add them to NOT_A_CHARGE with a reason:\n${missing.join('\n')}`)
      .toEqual([])
  })

  it.each(CHANNEL_LINE_DEFS)('$channel never tags a total', ({ defs }) => {
    const tagged = defs.filter((d) => d.fee)
    expect(tagged.filter((d) => d.kind !== 'input').map((d) => d.key)).toEqual([])
    expect(tagged.filter((d) => d.isGroupHead).map((d) => d.key)).toEqual([])
  })

  it.each(CHANNEL_LINE_DEFS)('$channel charges something', ({ defs }) => {
    // A statement with no cost of selling at all is a statement whose charges
    // were never tagged. Nykaa has exactly one — its margin on MRP.
    expect(defs.some((d) => d.fee && isCostOfSelling(d.fee))).toBe(true)
  })

  it('every exemption still names a real line', () => {
    for (const ref of Object.keys(NOT_A_CHARGE)) {
      const [channel, key] = ref.split('.')
      const entry = CHANNEL_LINE_DEFS.find((c) => c.channel === channel)
      expect(entry, `${ref} names no channel`).toBeDefined()
      expect(entry?.defs.some((d) => d.key === key), `${ref} names no line`).toBe(true)
    }
  })
})

const view = (
  channel: BusinessChannelId,
  lineDefs: NativeLineDef[],
  values: NativeLineValues,
  canonical: PnlLineValues = {},
): ChannelPnlView => ({
  channel,
  month: '2026-08',
  canonical: { channel, month: '2026-08', lines: computeSubtotals(canonical) },
  native: { lineDefs, values, currency: 'INR' },
  notes: [],
})

const flipkartFacts = (over: Partial<FlipkartPnlFacts> = {}): FlipkartPnlFacts => ({
  month: '2026-08', grossSales: 0, estimatedNetSales: 0, cogsPriced: 0, cogsUnpriced: 0,
  commissionFee: 0, collectionFee: 0, fixedFee: 0, pickPackFee: 0, forwardShippingFee: 0,
  reverseShippingFee: 0, storageFee: 0, recallFee: 0, otherMarketplaceFees: 0, rewardsSpf: 0,
  flipkartAds: 0, sellerFundedDiscount: 0, customerAddOns: 0, outputGst: 0, googleAds: 0, ...over,
})

describe('the charges add up to what the statement already said', () => {
  it("Flipkart's categories sum to its own Total Marketplace Fees", () => {
    const facts = flipkartFacts({
      grossSales: 120_000, estimatedNetSales: 100_000, outputGst: 15_254,
      commissionFee: 8_000, fixedFee: 1_200, collectionFee: 900, pickPackFee: 1_100,
      forwardShippingFee: 4_500, reverseShippingFee: 2_300, storageFee: 700, recallFee: 150,
      otherMarketplaceFees: 450, rewardsSpf: 600, flipkartAds: 3_000, googleAds: 1_000,
    })
    const values = computeFlipkartPnl(facts)
    const s = buildChannelFeesStatement(view('flipkart', FLIPKART_LINE_DEFS, values, flipkartToCanonicalBuckets(facts)))

    // Every rupee of the fee block, once: the statement's own subtotal is the
    // check, so a tag that went missing or landed twice shows up here.
    expect(s.totalCostOfSelling).toBeCloseTo(values.totalMarketplaceFees, 2)
    expect(s.basis).toBeCloseTo(values.netRevenueExGst, 2)
    expect(s.takeRatePct).toBeCloseTo((19_300 / 84_746) * 100, 2)

    // Rewards are not netted into the fees, so what Flipkart charged is not
    // flattered by what it paid back.
    expect(s.categories.flatMap((c) => c.lines).some((l) => l.key === 'rewardsSpf')).toBe(false)

    const byCategory = new Map(s.categories.map((c) => [c.category, c.amount]))
    expect(byCategory.get('commission')).toBeCloseTo(-8_000, 2)
    expect(byCategory.get('fixedFee')).toBeCloseTo(-1_200, 2)
    expect(byCategory.get('paymentCollection')).toBeCloseTo(-900, 2)
    expect(byCategory.get('fulfilment')).toBeCloseTo(-1_100, 2)
    expect(byCategory.get('shipping')).toBeCloseTo(-4_500, 2)
    // Reverse shipping and the recall fee are both freight on goods coming
    // back, and read together rather than as two unrelated small lines.
    expect(byCategory.get('returnsLogistics')).toBeCloseTo(-2_450, 2)
    expect(byCategory.get('storage')).toBeCloseTo(-700, 2)
    expect(byCategory.get('otherFees')).toBeCloseTo(-450, 2)
    // Flipkart's own ads are a charge the channel bills; Google's are not.
    expect(byCategory.get('advertising')).toBeCloseTo(-3_000, 2)
  })

  it("Meesho's categories sum to its own Total Marketplace Charges", () => {
    const facts: MeeshoPnlFacts = {
      schemaVersion: 3, month: '2026-08', basis: 'order',
      grossSalesInclGst: 200_000, salesReturnsInclGst: 20_000, cancellationsInclGst: 5_000,
      outputGstOnSales: 26_441, cogsUnitsSold: 60_000, cogsRtoWriteOff: 0, cogsReturnWriteOff: 0,
      forwardShipping: 12_000, returnShipping: 6_000, otherMarketplaceFees: 18_000,
      adsSpendExGst: 4_000, adCredits: 500, affiliateFee: 300,
      compensation: 200, claims: 100, recovery: 450, platformRecoverySubscriptions: 899,
      subOrdersDispatched: 2_256, unitsDispatched: 2_256, unitsDelivered: 2_000,
      unitsRto: 150, unitsReturned: 106,
      tcs: 1_000, tds: 120, gstOnMarketplaceFees: 6_480, gstOnAds: 720,
      netSettlementPerFile: 0, unclassifiedSettlement: 0, unclassifiedRows: 0,
    }
    const values = computeMeeshoPnl(facts)
    const s = buildChannelFeesStatement(view('meesho', MEESHO_LINE_DEFS, values))

    // Meesho's own CM1 block, plus the platform adjustments it books further
    // down — both are charges, and the fees statement reads them together.
    const adjustments = -450 - 899 + 200 + 100
    expect(s.totalCostOfSelling).toBeCloseTo(values.totalMarketplaceCharges + adjustments, 2)

    const byCategory = new Map(s.categories.map((c) => [c.category, c.amount]))
    expect(byCategory.get('shipping')).toBeCloseTo(-12_000, 2)
    expect(byCategory.get('returnsLogistics')).toBeCloseTo(-6_000, 2)
    expect(byCategory.get('otherFees')).toBeCloseTo(-18_000 - 899 + 200 + 100, 2)
    expect(byCategory.get('penalty')).toBeCloseTo(-450, 2)
    // Ad spend less the credits, plus the affiliate commission Meesho's own
    // roll-up also treats as advertising.
    expect(byCategory.get('advertising')).toBeCloseTo(-4_000 + 500 - 300, 2)
    // GST on the charges and on the ads, from the memo lines that state them
    // as amounts. Recoverable, so reported and never costed.
    expect(byCategory.get('feeTax')).toBeCloseTo(6_480 + 720, 2)
    expect(byCategory.get('withholding')).toBeCloseTo(1_000 + 120, 2)
    expect(s.withheld).toBeCloseTo(6_480 + 720 + 1_120, 2)
  })

  it('reports the withheld taxes as an amount whichever sign the statement prints', () => {
    // Myntra charges TCS and TDS forward and credits part of them back on
    // returns; Meesho states them as positive magnitudes in a memo. Both have
    // to come out as "this much was held back".
    const s = buildChannelFeesStatement(
      view('myntra', MYNTRA_LINE_DEFS, {
        netRevenueExGst: 100_000,
        fwdTaxesTcs: -1_000, revTcsRecovery: 200, fwdTaxesTds: -500, revTdsRecovery: 100,
        fwdCommissionFee: -15_000, revCommissionRecovery: 2_000,
      }),
    )
    const byCategory = new Map(s.categories.map((c) => [c.category, c.amount]))
    expect(byCategory.get('withholding')).toBeCloseTo(1_200, 2)
    // Commission nets its reversals, because a return takes the commission
    // back with it.
    expect(byCategory.get('commission')).toBeCloseTo(-13_000, 2)
    expect(s.totalCostOfSelling).toBeCloseTo(-13_000, 2)
  })

  it("puts Nykaa's margin over MRP, not over what is left after it", () => {
    const s = buildChannelFeesStatement(
      view('nykaa', NYKAA_LINE_DEFS, { netSalesMrp: 200_000, netRevenueExGst: 101_694, commission: -70_000 }),
    )
    expect(s.basis).toBe(200_000)
    expect(s.basisLabel).toBe('net sales at MRP')
    // 35% of MRP. Over net revenue it would read as 69%, which would be the
    // margin measured against a figure it had itself created.
    expect(s.takeRatePct).toBeCloseTo(35, 2)
  })

  it('skips a fee column contained inside another one', () => {
    const defs: NativeLineDef[] = [
      { key: 'netSalesUsd', label: 'Net Sales', section: 'REVENUE', kind: 'subtotal' },
      { key: 'fee.fbaFulfillmentFees', label: 'FBA fulfillment fees total', section: 'MARKETPLACE CHARGES', kind: 'input', fee: 'fulfilment' },
      { key: 'fee.baseFulfillmentFee', label: 'Base fulfillment fee total', section: 'MARKETPLACE CHARGES', kind: 'input', fee: 'fulfilment', memoOf: 'fee.fbaFulfillmentFees' },
    ]
    const s = buildChannelFeesStatement(
      view('amazon_us', defs, { netSalesUsd: 1_000, 'fee.fbaFulfillmentFees': -300, 'fee.baseFulfillmentFee': -250 }),
    )
    // 300, not 550: the component is shown on the statement for reference and
    // is already inside the total above it.
    expect(s.totalCostOfSelling).toBeCloseTo(-300, 2)
  })

  it('carries a lever through from the fee column that has one', () => {
    const defs: NativeLineDef[] = [
      { key: 'netSalesUsd', label: 'Net Sales', section: 'REVENUE', kind: 'subtotal' },
      { key: 'fee.agedInventorySurcharge', label: 'Aged inventory surcharge total', section: 'MARKETPLACE CHARGES', kind: 'input', fee: 'storage' },
    ]
    const s = buildChannelFeesStatement(
      view('amazon_us', defs, { netSalesUsd: 1_000, 'fee.agedInventorySurcharge': -120 }),
    )
    expect(s.categories[0].lines[0].lever).toMatch(/180 days/)
  })
})

describe('a month with no settlement file', () => {
  it('falls back to the canonical buckets and says so', () => {
    const s = buildChannelFeesStatement({
      channel: 'purplle',
      month: '2026-08',
      canonical: {
        channel: 'purplle', month: '2026-08',
        lines: computeSubtotals({
          grossSales: 50_000, marketplaceCommission: 6_000, shipping: 1_500, ads: 800,
        }),
      },
      notes: [],
    })
    expect(s.fromOrderRows).toBe(true)
    expect(s.totalCostOfSelling).toBeCloseTo(-7_500, 2)
    expect(s.advertising).toBeCloseTo(-800, 2)
    expect(s.takeRatePct).toBeCloseTo(15, 2)
    expect(s.notes.join(' ')).toMatch(/no storage line/)
  })

  it('leaves a channel that charged nothing off the statement entirely', () => {
    const idle: ChannelPnlView = {
      channel: 'purplle', month: '2026-08',
      canonical: { channel: 'purplle', month: '2026-08', lines: computeSubtotals({}) },
      notes: [],
    }
    expect(buildFeesStatement([idle], '2026-08').channels).toEqual([])
  })
})

const ARCHIVE = '/root/.claude/uploads/f24a295e-093a-5385-9288-97acefc06862/6e71377f-payout_sheet_2026-08-01_To_2026-08-31.zip'

describe.skipIf(!existsSync(ARCHIVE))("Blinkit's August 2026, from the owner's own archive", () => {
  const load = async () => {
    const { facts } = await normalizeBlinkitPayoutZip(readFileSync(ARCHIVE), 't', 'payout.zip')
    return buildChannelFeesStatement(view('blinkit', BLINKIT_LINE_DEFS, computeBlinkitPnl(facts)))
  }

  it('names storage as the charge, not commission', async () => {
    const s = await load()
    const byCategory = new Map(s.categories.map((c) => [c.category, c]))
    expect(byCategory.get('storage')?.amount).toBeCloseTo(-3_126, 2)
    expect(byCategory.get('commission')?.amount).toBeCloseTo(-128.6, 2)
    // Rent on unsold stock was 24 times the commission on what sold, and 57%
    // of the month's net revenue. In the canonical roll-up it has nowhere to
    // go but "other marketplace charges", which is why the tag exists.
    expect(byCategory.get('storage')!.pctOfBasis).toBeGreaterThan(55)
    expect(byCategory.get('storage')!.pctOfBasis).toBeLessThan(60)
    expect(byCategory.get('storage')!.amount / byCategory.get('commission')!.amount).toBeGreaterThan(20)
  })

  it('ties to the charges the payout sheet itself deducted', async () => {
    const { facts } = await normalizeBlinkitPayoutZip(readFileSync(ARCHIVE), 't', 'payout.zip')
    const values = computeBlinkitPnl(facts)
    const s = buildChannelFeesStatement(view('blinkit', BLINKIT_LINE_DEFS, values))
    expect(s.totalCostOfSelling).toBeCloseTo(
      values.totalOrderCharges + values.totalInventoryCharges + values.netAdjustments, 2,
    )
    expect(s.basis).toBeCloseTo(values.netRevenue, 2)
    // GST on those charges comes back as input credit, so it is reported and
    // never costed.
    expect(s.withheld).toBeGreaterThan(0)
  })

  it('holds the LP-SP adjustments out of the charges', async () => {
    const s = await load()
    // ₹4,483.40 of credit and debit notes against earlier months' goods, not
    // in Blinkit's payout sheet. Until the owner says what they settle they
    // are not a fee and not a margin.
    expect(s.categories.flatMap((c) => c.lines).some((l) => l.key === 'lpSpAdjustment')).toBe(false)
  })
})

describe('the comparison across channels', () => {
  it('ranks by what the channel costs and keeps the categories in order', () => {
    const cheap = view('flipkart', FLIPKART_LINE_DEFS, computeFlipkartPnl(flipkartFacts({
      grossSales: 100_000, estimatedNetSales: 100_000, commissionFee: 5_000,
    })))
    const dear = view('meesho', MEESHO_LINE_DEFS, {
      netRevenue: 100_000, forwardShipping: -20_000, otherMarketplaceFees: -10_000,
    })
    const s = buildFeesStatement([cheap, dear], '2026-08')
    expect(s.channels.map((c) => c.channel)).toEqual(['meesho', 'flipkart'])
    // Commission before shipping before other charges, whichever channel is
    // read first — the statement reads the same way every month.
    expect(s.categories).toEqual<FeeCategoryId[]>(['commission', 'shipping', 'otherFees'])
    expect(s.totalCostOfSelling).toBeCloseTo(-35_000, 2)
    expect(s.takeRatePct).toBeCloseTo(17.5, 2)
  })
})
