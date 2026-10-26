import { describe, expect, it } from 'vitest'
import { buildCostIndex } from '@/data/costVersions'
import type { AdsRecord, CanonicalSalesRecord, SkuMaster } from '@/data/models'
import type { SkuMapping } from '@/data/skuMapping'
import { buildSkuChannelMargins, lossCause, summariseLosses, type SkuChannelInputs } from './skuChannelMargin'

/**
 * Every case here is one the owner's own September actually contains. The
 * arithmetic is easy; what is not easy is being wrong about it quietly, which
 * is what each of these is here to prevent.
 */

const MONTH = '2026-09'

const skuMaster: SkuMaster[] = [
  { sku: 'AO/LBalm/NonTinted', productName: 'Lip Balm', category: 'Lip Care', brand: 'AO', cogs: 19.85, mrp: 299,
    launchDate: '2025-01-01', status: 'active', leadTimeDays: 21, safetyStock: 0 },
  { sku: 'NX/LBalm/BarrierRpr', productName: 'Barrier Repair Balm', category: 'Lip Care', brand: 'NX', cogs: 24.90, mrp: 399,
    launchDate: '2025-01-01', status: 'active', leadTimeDays: 21, safetyStock: 0 },
  { sku: 'F/Pouch/Green/M', productName: 'Gift Pouch', category: 'Packaging', brand: 'AO', cogs: 30, mrp: 399,
    launchDate: '2025-01-01', status: 'active', leadTimeDays: 21, safetyStock: 0 },
  { sku: 'NX/Spray/Sunscreen/100', productName: 'Sunscreen Spray', category: 'Sun Care', brand: 'NX', cogs: 96.40, mrp: 799,
    launchDate: '2025-01-01', status: 'active', leadTimeDays: 21, safetyStock: 0 },
]

const mappings: SkuMapping[] = [
  { channelSku: 'ARAVI00000155', internalSku: 'F/Pouch/Green/M', kind: 'SINGLE', source: 'manual', verified: true },
  { channelSku: 'AO/F/Pouch', internalSku: 'F/Pouch/Green/M', kind: 'SINGLE', source: 'manual', verified: true },
]

function row(over: Partial<CanonicalSalesRecord> & { sku: string; quantity: number; netSales: number }): CanonicalSalesRecord {
  return {
    orderId: `${over.sku}-${over.quantity}-${over.netSales}-${over.channel ?? 'myntra'}`,
    orderDate: `${MONTH}-12`,
    channel: 'myntra', marketplace: 'myntra', sellerType: 'marketplace',
    productName: over.sku, category: 'Lip Care',
    grossSales: over.netSales, discount: 0,
    returnUnits: 0, rtoUnits: 0, shippingCost: 0, marketplaceFee: 0, tax: 0,
    status: 'completed', currency: 'INR', importId: 'test',
    ...over,
  }
}

function build(inputs: Partial<SkuChannelInputs> & { salesRecords: CanonicalSalesRecord[] }) {
  return buildSkuChannelMargins(MONTH, {
    skuMaster,
    adsRecords: [],
    cogs: { costIndex: buildCostIndex([], skuMaster), mappings, comboComponents: [] },
    channelFees: {},
    channelAds: {},
    ...inputs,
  })
}

describe('a product losing money inside a channel that is not', () => {
  // Myntra, September: the channel keeps ₹1.19L while this balm's fee is
  // 127% of what it earned.
  const result = build({
    salesRecords: [
      row({ sku: 'NX/LBalm/BarrierRpr', quantity: 32, netSales: 5246, marketplaceFee: 6659 }),
      row({ sku: 'AO/LBalm/NonTinted', quantity: 500, netSales: 90000, marketplaceFee: 30000 }),
    ],
    channelFees: { myntra: 36659 },
  })

  it('finds the loser', () => {
    const balm = result.rows.find((r) => r.sku === 'NX/LBalm/BarrierRpr')!
    expect(balm.cm1).toBeCloseTo(5246 - 24.90 * 32, 2)
    expect(balm.cm2).toBeCloseTo(5246 - 24.90 * 32 - 6659, 2)
    expect(balm.cm2).toBeLessThan(0)
  })

  it('leaves the channel itself in profit, which is the whole point', () => {
    const myntra = result.channels.find((c) => c.channel === 'myntra')!
    expect(myntra.cm3).toBeGreaterThan(0)
    expect(summariseLosses(result.rows).losers).toBe(1)
  })

  it('sorts the worst row to the top so the screen opens on it', () => {
    expect(result.rows[0].sku).toBe('NX/LBalm/BarrierRpr')
  })

  it('names the fee as what did it, because the remedy is delisting and not a price rise', () => {
    expect(lossCause(result.rows[0])).toBe('fee')
  })
})

describe('a statement whose fee the rows do not carry', () => {
  // Nykaa, Snapdeal, Tata 1mg and the rest stated a month's total and
  // nothing per line.
  const result = build({
    salesRecords: [
      row({ sku: 'AO/LBalm/NonTinted', quantity: 100, netSales: 10000, channel: 'purplle', marketplace: 'purplle' }),
      row({ sku: 'NX/LBalm/BarrierRpr', quantity: 100, netSales: 30000, channel: 'purplle', marketplace: 'purplle' }),
    ],
    channelFees: { purplle: 8000 },
  })

  it('shares it out by net sales', () => {
    const [small, large] = ['AO/LBalm/NonTinted', 'NX/LBalm/BarrierRpr']
      .map((s) => result.rows.find((r) => r.sku === s)!)
    expect(small.fee).toBeCloseTo(2000, 2)
    expect(large.fee).toBeCloseTo(6000, 2)
  })

  it('says so on every row it did that to', () => {
    expect(result.rows.every((r) => r.feeBasis === 'allocated')).toBe(true)
    expect(result.channels[0].feeAllocated).toBe(8000)
  })
})

describe('a statement that bills less than its own lines', () => {
  const result = build({
    salesRecords: [row({ sku: 'NX/LBalm/BarrierRpr', quantity: 32, netSales: 5246, marketplaceFee: 6659 })],
    channelFees: { myntra: 4000 },
  })

  it('charges the line and apportions nothing, rather than billing twice', () => {
    expect(result.rows[0].fee).toBe(6659)
    expect(result.rows[0].feeBasis).toBe('measured')
    expect(result.channels[0].feeAllocated).toBe(0)
  })
})

describe('a dollar row beside a rupee cost', () => {
  // The trap this screen was built to avoid: read without conversion, every
  // Amazon USA product is catastrophically loss-making and the screen's
  // first act is to recommend closing a profitable business.
  const result = build({
    salesRecords: [
      row({ sku: 'NX/Spray/Sunscreen/100', quantity: 10, netSales: 150, channel: 'amazon_us', marketplace: 'amazon_us', currency: 'USD' }),
    ],
    fx: { USD: 95.45, AED: 26 },
  })

  it('converts the sale before subtracting the cost', () => {
    expect(result.rows[0].netSales).toBeCloseTo(150 * 95.45, 2)
    expect(result.rows[0].cm1).toBeCloseTo(150 * 95.45 - 96.40 * 10, 2)
    expect(result.rows[0].cm1).toBeGreaterThan(0)
  })
})

describe('advertising', () => {
  const ads: AdsRecord[] = [
    { date: `${MONTH}-09`, channel: 'flipkart', campaign: 'balm', sku: 'AO/LBalm/NonTinted',
      impressions: 0, clicks: 0, spend: 5852, adSales: 0, adOrders: 0, importId: 'test' },
    { date: `${MONTH}-09`, channel: 'flipkart', campaign: 'listing', sku: 'lstholgguf6n63jhqhwetdrzf',
      impressions: 0, clicks: 0, spend: 11617, adSales: 0, adOrders: 0, importId: 'test' },
  ]
  const result = build({
    salesRecords: [
      row({ sku: 'AO/LBalm/NonTinted', quantity: 53, netSales: 5654, channel: 'flipkart', marketplace: 'flipkart' }),
      row({ sku: 'NX/LBalm/BarrierRpr', quantity: 100, netSales: 40000, channel: 'flipkart', marketplace: 'flipkart' }),
    ],
    adsRecords: ads,
    channelAds: { flipkart: 17469 },
  })

  it('sets the report\'s own SKU spend against that product and no other', () => {
    const balm = result.rows.find((r) => r.sku === 'AO/LBalm/NonTinted')!
    expect(balm.ads).toBe(5852)
    expect(balm.adsBasis).toBe('measured')
    expect(result.rows.find((r) => r.sku === 'NX/LBalm/BarrierRpr')!.ads).toBe(0)
  })

  it('finds the product that spent more on ads than it earned', () => {
    const balm = result.rows.find((r) => r.sku === 'AO/LBalm/NonTinted')!
    expect(balm.cm3).toBeCloseTo(5654 - 19.85 * 53 - 5852, 2)
    expect(balm.cm3).toBeLessThan(0)
    expect(lossCause(balm)).toBe('ads')
  })

  it('names the spend it could not attribute instead of sharing it over products it was not spent on', () => {
    const flipkart = result.channels.find((c) => c.channel === 'flipkart')!
    expect(flipkart.adsUnattributed).toBe(11617)
    expect(flipkart.adsUnattributedCodes).toEqual(['lstholgguf6n63jhqhwetdrzf'])
    expect(flipkart.adsAllocated).toBe(0)
  })
})

describe('the gift pouch', () => {
  // 285 units in September across three channels under three codes, every
  // one of them free, and Flipkart advertised it.
  const result = build({
    salesRecords: [
      row({ sku: 'ARAVI00000155', quantity: 201, netSales: 0, grossSales: 0, channel: 'nykaa', marketplace: 'nykaa' }),
      row({ sku: 'AO/F/Pouch', quantity: 54, netSales: 0, grossSales: 0, channel: 'flipkart', marketplace: 'flipkart' }),
      row({ sku: 'F/Pouch/Green/M', quantity: 30, netSales: 0, grossSales: 0 }),
    ],
  })

  it('reads three spellings as one product', () => {
    expect(result.rows.every((r) => r.sku === 'F/Pouch/Green/M')).toBe(true)
    expect(result.rows).toHaveLength(3)
    expect(result.rows.flatMap((r) => r.channelCodes).sort())
      .toEqual(['AO/F/Pouch', 'ARAVI00000155', 'F/Pouch/Green/M'])
  })

  it('costs all 285 units and earns nothing on any of them', () => {
    expect(result.rows.reduce((sum, r) => sum + (r.cogs ?? 0), 0)).toBe(285 * 30)
    expect(result.rows.reduce((sum, r) => sum + (r.cm3 ?? 0), 0)).toBe(-285 * 30)
  })

  it('calls it free goods rather than a pricing mistake', () => {
    expect(result.rows.map(lossCause)).toEqual(['free-goods', 'free-goods', 'free-goods'])
  })
})

describe('a product that is priced fine and keeps coming back', () => {
  const result = build({
    salesRecords: [
      row({ sku: 'AO/LBalm/NonTinted', quantity: 6, netSales: 300, returnUnits: 0 }),
      row({ sku: 'AO/LBalm/NonTinted', quantity: 10, netSales: 0, returnUnits: 10, status: 'returned', orderId: 'back' }),
    ],
  })

  it('is below cost over the month', () => {
    expect(result.rows[0].cm1).toBeCloseTo(300 - 19.85 * 16, 2)
    expect(result.rows[0].cm1).toBeLessThan(0)
  })

  it('blames the returns and not the price, because the two need opposite remedies', () => {
    expect(result.rows[0].earningUnits).toBe(6)
    expect(lossCause(result.rows[0])).toBe('returns')
  })
})

describe('a product nothing on file can cost', () => {
  const result = build({
    salesRecords: [row({ sku: 'AO/F/LOOFAH', quantity: 40, netSales: 4000 })],
  })

  it('is left unjudged rather than shown at 100% margin', () => {
    expect(result.rows[0].cogs).toBeNull()
    expect(result.rows[0].cm1).toBeNull()
    expect(result.rows[0].cm3).toBeNull()
    expect(result.uncosted).toBe(1)
  })

  it('is kept out of the loss summary entirely', () => {
    const summary = summariseLosses(result.rows)
    expect(summary.judged).toBe(0)
    expect(summary.losers).toBe(0)
  })
})

describe('a cancelled order', () => {
  const result = build({
    salesRecords: [
      row({ sku: 'AO/LBalm/NonTinted', quantity: 10, netSales: 1000 }),
      row({ sku: 'AO/LBalm/NonTinted', quantity: 5, netSales: 0, status: 'cancelled', orderId: 'gone' }),
    ],
  })

  it('costs nothing, because the goods never left', () => {
    expect(result.rows[0].units).toBe(10)
    expect(result.rows[0].cogs).toBeCloseTo(198.5, 2)
  })
})

describe('the month summary', () => {
  const result = build({
    salesRecords: [
      row({ sku: 'NX/LBalm/BarrierRpr', quantity: 32, netSales: 5246, marketplaceFee: 6659 }),
      row({ sku: 'AO/LBalm/NonTinted', quantity: 500, netSales: 90000, marketplaceFee: 20000 }),
    ],
  })

  it('states how much of the month is being sold at a loss', () => {
    const summary = summariseLosses(result.rows)
    expect(summary.losers).toBe(1)
    expect(summary.lostUnits).toBe(32)
    expect(summary.lostNetSales).toBe(5246)
    expect(summary.lostSharePct).toBeCloseTo((5246 / 95246) * 100, 4)
  })
})

describe('a product mostly given away rather than sent back', () => {
  // Flipkart, September: 54 gift pouches, 8 sold, 9 returned, 37 free.
  const result = build({
    salesRecords: [
      row({ sku: 'AO/F/Pouch', quantity: 8, netSales: 922, channel: 'flipkart', marketplace: 'flipkart' }),
      row({ sku: 'AO/F/Pouch', quantity: 9, netSales: 0, returnUnits: 9, status: 'returned', channel: 'flipkart', marketplace: 'flipkart', orderId: 'back' }),
      row({ sku: 'AO/F/Pouch', quantity: 37, netSales: 0, channel: 'flipkart', marketplace: 'flipkart', orderId: 'free' }),
    ],
  })

  it('blames the giveaway and not the courier', () => {
    expect(result.rows[0].units).toBe(54)
    expect(result.rows[0].earningUnits).toBe(8)
    expect(lossCause(result.rows[0])).toBe('free-goods')
  })
})

describe('a fee charged where nothing shipped', () => {
  // Myntra bills a few of these each month — a charge against a product that
  // sold in an earlier month, or a cancellation fee.
  const result = build({
    salesRecords: [row({ sku: 'NX/LBalm/BarrierRpr', quantity: 0, netSales: 0, marketplaceFee: 309 })],
  })

  it('is a loss, and is named as a charge rather than a giveaway', () => {
    expect(result.rows[0].units).toBe(0)
    expect(result.rows[0].cm3).toBe(-309)
    expect(lossCause(result.rows[0])).toBe('charge-only')
  })
})

describe('a wholesale channel, whose order rows are not revenue', () => {
  // Nykaa buys the goods and sells them on, so its sales file is written at
  // MRP. September's rows add to ₹28.3 lakh; the statement says ₹8.6 lakh.
  const salesRecords = [
    row({ sku: 'AO/LBalm/NonTinted', quantity: 100, netSales: 20000, channel: 'nykaa', marketplace: 'nykaa' }),
    row({ sku: 'NX/LBalm/BarrierRpr', quantity: 100, netSales: 60000, channel: 'nykaa', marketplace: 'nykaa' }),
  ]
  const result = build({ salesRecords, channelNetSales: { nykaa: 24000 } })

  it('states each product on what the statement earned, in proportion to what it sold', () => {
    const small = result.rows.find((r) => r.sku === 'AO/LBalm/NonTinted')!
    const large = result.rows.find((r) => r.sku === 'NX/LBalm/BarrierRpr')!
    expect(small.netSales).toBeCloseTo(6000, 6)
    expect(large.netSales).toBeCloseTo(18000, 6)
    expect(small.netSales + large.netSales).toBeCloseTo(24000, 6)
  })

  it('leaves gross at MRP, which is what it is', () => {
    expect(result.rows.reduce((t, r) => t + r.grossSales, 0)).toBe(80000)
  })

  it('says it did so, and what the rows had said', () => {
    expect(result.rows.every((r) => r.revenueBasis === 'statement')).toBe(true)
    const nykaa = result.channels.find((c) => c.channel === 'nykaa')!
    expect(nykaa.revenueScale).toBeCloseTo(0.3, 6)
    expect(nykaa.rowNetSales).toBe(80000)
  })

  it('strikes the margin on the real revenue, not on MRP', () => {
    const large = result.rows.find((r) => r.sku === 'NX/LBalm/BarrierRpr')!
    // 18,000 earned against 100 units at ₹24.90, not 60,000 against them.
    expect(large.cm1).toBeCloseTo(18000 - 24.90 * 100, 6)
  })
})

describe('a channel whose rows and statement broadly agree', () => {
  const salesRecords = [
    row({ sku: 'AO/LBalm/NonTinted', quantity: 100, netSales: 10000, channel: 'flipkart', marketplace: 'flipkart' }),
  ]

  it('is left on its rows: a half-percent timing gap is not a restatement', () => {
    const result = build({ salesRecords, channelNetSales: { flipkart: 10050 } })
    expect(result.rows[0].netSales).toBe(10000)
    expect(result.rows[0].revenueBasis).toBe('rows')
    expect(result.channels[0].revenueScale).toBeNull()
  })

  it('is left on its rows when no statement exists at all', () => {
    const result = build({ salesRecords })
    expect(result.rows[0].netSales).toBe(10000)
    expect(result.rows[0].revenueBasis).toBe('rows')
  })
})

/**
 * The 5% lines on a wholesale channel.
 *
 * Hair oil and shampoo are at 5% GST and the rest of the range at 18%, so a
 * shampoo keeps more of its MRP than a sunscreen does. Splitting the
 * statement in proportion to MRP hands that difference to the sunscreen — on
 * Nykaa's September it understated the five 5% lines by about ₹5,700,
 * roughly a ninth of their revenue, on the screen that decides what to stop
 * selling.
 */
describe('a wholesale channel selling at two GST rates', () => {
  const mixedMaster: SkuMaster[] = [
    { sku: 'AO/Shmp/Rosemary/200', productName: 'Shampoo', category: 'Hair Care', brand: 'AO', cogs: 70, mrp: 349,
      launchDate: '2025-01-01', status: 'active', leadTimeDays: 21, safetyStock: 0, gstPct: 5 },
    { sku: 'AO/SS/BodyLotion', productName: 'Sunscreen', category: 'Sun Care', brand: 'AO', cogs: 120, mrp: 549,
      launchDate: '2025-01-01', status: 'active', leadTimeDays: 21, safetyStock: 0, gstPct: 18 },
    { sku: 'AO/Unrated', productName: 'No rate yet', category: 'Skin Care', brand: 'AO', cogs: 40, mrp: 199,
      launchDate: '2025-01-01', status: 'active', leadTimeDays: 21, safetyStock: 0 },
  ]
  const nykaaRow = (sku: string, quantity: number, netSales: number) =>
    row({ sku, quantity, netSales, channel: 'nykaa', marketplace: 'nykaa' })

  it('gives the 5% line the revenue its own rate leaves it, not its share of MRP', () => {
    const result = build({
      skuMaster: mixedMaster,
      salesRecords: [nykaaRow('AO/Shmp/Rosemary/200', 100, 100_000), nykaaRow('AO/SS/BodyLotion', 100, 100_000)],
      channelNetSales: { nykaa: 100_000 },
    })
    const shampoo = result.rows.find((r) => r.sku === 'AO/Shmp/Rosemary/200')!
    const sunscreen = result.rows.find((r) => r.sku === 'AO/SS/BodyLotion')!

    // Equal MRP, so an MRP split would give each ₹50,000. Tax-exclusive, the
    // shampoo's ₹1,00,000 is worth 100,000/1.05 against 100,000/1.18.
    const shampooWeight = 100_000 / 1.05
    const sunscreenWeight = 100_000 / 1.18
    const base = shampooWeight + sunscreenWeight
    expect(shampoo.netSales).toBeCloseTo(100_000 * (shampooWeight / base), 6)
    expect(sunscreen.netSales).toBeCloseTo(100_000 * (sunscreenWeight / base), 6)
    expect(shampoo.netSales).toBeGreaterThan(50_000)
    expect(sunscreen.netSales).toBeLessThan(50_000)
    // And the statement still ties exactly, which is the whole point of
    // restating against it.
    expect(shampoo.netSales + sunscreen.netSales).toBeCloseTo(100_000, 6)
  })

  it('is the same split as before where every product is on one rate', () => {
    const result = build({
      skuMaster: mixedMaster,
      salesRecords: [nykaaRow('AO/SS/BodyLotion', 100, 20_000), nykaaRow('AO/SS/BodyLotion', 100, 0)],
      channelNetSales: { nykaa: 5_000 },
    })
    expect(result.rows.find((r) => r.sku === 'AO/SS/BodyLotion')!.netSales).toBeCloseTo(5_000, 6)
  })

  it('weighs a product with no rate on file at what the rated ones blend to', () => {
    const result = build({
      skuMaster: mixedMaster,
      salesRecords: [nykaaRow('AO/SS/BodyLotion', 100, 100_000), nykaaRow('AO/Unrated', 100, 100_000)],
      channelNetSales: { nykaa: 100_000 },
    })
    const rated = result.rows.find((r) => r.sku === 'AO/SS/BodyLotion')!
    const unrated = result.rows.find((r) => r.sku === 'AO/Unrated')!
    // Everything rated here is at 18%, so the blend is 18% and the two split
    // evenly. A missing rate must neither flatter the product nor penalise it.
    expect(rated.netSales).toBeCloseTo(50_000, 6)
    expect(unrated.netSales).toBeCloseTo(50_000, 6)
  })

  it('keeps a credit note a credit note instead of zeroing it', () => {
    const result = build({
      skuMaster: mixedMaster,
      salesRecords: [nykaaRow('AO/SS/BodyLotion', 100, 100_000), nykaaRow('AO/Shmp/Rosemary/200', 0, -10_000)],
      channelNetSales: { nykaa: 45_000 },
    })
    const credit = result.rows.find((r) => r.sku === 'AO/Shmp/Rosemary/200')!
    expect(credit.netSales).toBeLessThan(0)
    expect(result.rows.reduce((t, r) => t + r.netSales, 0)).toBeCloseTo(45_000, 6)
  })

  it('refuses to split a statement over a month with nothing to weigh', () => {
    // Credit notes outweighing the month's sales against a statement that
    // says the channel earned. Dividing by that turns the credit note into
    // revenue, so the rows are left alone and labelled as rows.
    const result = build({
      skuMaster: mixedMaster,
      salesRecords: [
        nykaaRow('AO/SS/BodyLotion', 100, 100),
        nykaaRow('AO/Shmp/Rosemary/200', 0, -99),
      ],
      channelNetSales: { nykaa: 5_000 },
    })
    expect(result.rows.every((r) => r.revenueBasis === 'rows')).toBe(true)
    expect(result.rows.find((r) => r.sku === 'AO/Shmp/Rosemary/200')!.netSales).toBeCloseTo(-99, 6)
    expect(result.channels.find((c) => c.channel === 'nykaa')!.revenueScale).toBeNull()
  })
})

describe('fees and ads on a rescaled channel', () => {
  it('are shared out on the real revenue, not on MRP', () => {
    const result = build({
      salesRecords: [
        row({ sku: 'AO/LBalm/NonTinted', quantity: 100, netSales: 20000, channel: 'nykaa', marketplace: 'nykaa' }),
        row({ sku: 'NX/LBalm/BarrierRpr', quantity: 100, netSales: 60000, channel: 'nykaa', marketplace: 'nykaa' }),
      ],
      channelNetSales: { nykaa: 24000 },
      channelAds: { nykaa: 4000 },
    })
    const small = result.rows.find((r) => r.sku === 'AO/LBalm/NonTinted')!
    const large = result.rows.find((r) => r.sku === 'NX/LBalm/BarrierRpr')!
    // A quarter of the revenue carries a quarter of the advertising, which is
    // the same share either way — but it must be struck after the scaling, or
    // a later change to the base would silently move it.
    expect(small.ads).toBeCloseTo(1000, 6)
    expect(large.ads).toBeCloseTo(3000, 6)
  })
})
