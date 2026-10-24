import type { BusinessChannelId } from '@/config/channels'
import { channelOfSource } from '@/config/channels'
import type { AdsRecord, CanonicalSalesRecord, SkuMaster } from '@/data/models'
import { inrPerUnit, type FxRatesInr, DEFAULT_FX_INR } from '@/data/fxRates'
import { mappedCodeFor, type ComboComponent, type SkuMapping } from '@/data/skuMapping'
import { toMonthKey } from '@/lib/format'
import { filterByMonth } from './sales'
import { unitCostResolver, type CogsInputs } from './pnl'

/**
 * One product on one channel, down the margin ladder.
 *
 * The channel P&L is an average, and an average cannot be negative anywhere.
 * Myntra's September margin after fees is positive and healthy while fifteen
 * of its eighty-three products lose money inside it; the winners pay for the
 * losers and the statement nets them off. This module takes the same month's
 * figures apart by product so the losers can be seen and priced, delisted or
 * de-advertised one at a time.
 *
 * Three rungs, because only three can be measured:
 *
 *  - CM1, after the goods. Exact on every channel.
 *  - CM2, after the marketplace's fee. Exact where the channel's file states
 *    a fee per line; apportioned from the statement where it does not.
 *  - CM3, after advertising. Exact where the ad report carries a SKU;
 *    apportioned from the channel's total where it does not.
 *
 * There is no CM4. Returns and RTO are counted here in units, because the
 * rows state them, but what a return actually costs in freight is not on any
 * file this app reads. A fourth rung would have to be invented, and an
 * invented rupee on this screen is worse than a missing one: the whole point
 * of the screen is to be acted on.
 */

/** How a cost on a row was arrived at. */
export type MarginBasis =
  /** The channel's own file states it for this product. */
  | 'measured'
  /** The channel states only a month's total; this is that total shared out
   * in proportion to net sales. True in aggregate, indicative per product. */
  | 'allocated'
  /** Part stated, part apportioned — the statement bills more than the rows
   * account for, and the difference has to land somewhere. */
  | 'part'
  /** Nothing to apportion: the channel charges no such cost, or no file
   * stating one has been uploaded. */
  | 'none'

export interface SkuChannelMargin {
  /** The Product Master's code where the channel's code maps to one, so a
   * product sold under three spellings is one row and not three. */
  sku: string
  productName: string
  category: string
  /** Every code this channel billed the product under. */
  channelCodes: string[]
  channel: BusinessChannelId
  /** Units that left the warehouse — everything but a cancellation. */
  units: number
  /** Units that earned something. The rest shipped and were sent back, or
   * went out free. */
  earningUnits: number
  returnedUnits: number
  grossSales: number
  netSales: number
  /** Null when nothing on file can cost this product. Never zero as a
   * stand-in: a zero cost shows a product at 100% margin, which is the one
   * answer that is certainly wrong. */
  unitCost: number | null
  cogs: number | null
  fee: number
  feeBasis: MarginBasis
  ads: number
  adsBasis: MarginBasis
  /** Null wherever `cogs` is null — an unknown cost poisons every rung below
   * it, and a ladder that quietly drops the unknown reads as a profit. */
  cm1: number | null
  cm2: number | null
  cm3: number | null
  /** CM3 over net sales. Null when CM3 is null, or when nothing was earned to
   * divide by. */
  cm3Pct: number | null
}

export interface ChannelCoverage {
  channel: BusinessChannelId
  /** The channel's whole month, for the reader to see that the products below
   * add up to a channel that is itself doing fine. */
  netSales: number
  cm3: number
  feeBasis: MarginBasis
  adsBasis: MarginBasis
  /** What the statement billed that no row could be matched to, and was
   * therefore shared out by net sales. */
  feeAllocated: number
  adsAllocated: number
  /** Ad spend whose SKU matches nothing sold this month — a listing id, a
   * portfolio name, or a product that was advertised and did not sell. It is
   * real money and is named rather than dropped, but it cannot be set against
   * a product's margin. */
  adsUnattributed: number
  adsUnattributedCodes: string[]
}

export interface SkuChannelMarginResult {
  month: string
  rows: SkuChannelMargin[]
  channels: ChannelCoverage[]
  /** Products that could not be costed, so could not be judged. */
  uncosted: number
}

export interface SkuChannelInputs {
  salesRecords: CanonicalSalesRecord[]
  skuMaster: SkuMaster[]
  adsRecords: AdsRecord[]
  cogs?: CogsInputs
  fx?: FxRatesInr
  /**
   * What each channel's statement billed in marketplace charges for the
   * month, in rupees — commission, fulfilment, shipping, collection, RTO and
   * return charges and the rest.
   *
   * Supplied by the caller rather than recomputed here, so this screen and
   * the Channel P&L bill the same total. Where the order rows already carry
   * more fee than this, the rows win and nothing is apportioned: a statement
   * that disagrees with its own lines is a reconciliation question, not a
   * licence to charge a product twice.
   */
  channelFees: Partial<Record<BusinessChannelId, number>>
  /** The month's advertising per channel, in rupees, on the same terms. */
  channelAds: Partial<Record<BusinessChannelId, number>>
}

interface Bucket {
  sku: string
  channel: BusinessChannelId
  codes: Set<string>
  productName: string
  category: string
  units: number
  earningUnits: number
  returnedUnits: number
  grossSales: number
  netSales: number
  rowFees: number
}

/**
 * The Product Master code a channel's code stands for.
 *
 * Three spellings of the gift pouch — `AO/F/Pouch` on Flipkart,
 * `ARAVI00000155` on Nykaa and `F/Pouch/Green/M` in the Master — are one
 * product losing money in three places, and reading them as three products
 * hides the size of it.
 */
function internalSkuFor(code: string, tables: {
  skuMaster: SkuMaster[]
  mappings: SkuMapping[]
  comboComponents: ComboComponent[]
}): string {
  if (tables.skuMaster.some((s) => s.sku === code)) return code
  const direct = tables.mappings.find((m) => m.channelSku === code)
  if (direct) return direct.internalSku

  // The file spells it with underscores where the map spells it with slashes.
  const canonical = mappedCodeFor(code, tables)
  if (canonical === null) return code
  if (tables.skuMaster.some((s) => s.sku === canonical)) return canonical
  const mapped = tables.mappings.find((m) => m.channelSku === canonical)
  return mapped ? mapped.internalSku : canonical
}

/** Whether a figure was stated, shared out, or both. */
function basisOf(measured: number, allocated: number): MarginBasis {
  if (measured > 0 && allocated > 0) return 'part'
  if (measured > 0) return 'measured'
  return allocated > 0 ? 'allocated' : 'none'
}

/** Shares `total` out over the buckets in proportion to net sales. */
function allocate(total: number, buckets: Bucket[], key: (b: Bucket) => number): Map<Bucket, number> {
  const share = new Map<Bucket, number>()
  const base = buckets.reduce((sum, b) => sum + Math.max(0, key(b)), 0)
  if (total <= 0 || base <= 0) return share
  for (const b of buckets) share.set(b, total * (Math.max(0, key(b)) / base))
  return share
}

export function buildSkuChannelMargins(month: string, inputs: SkuChannelInputs): SkuChannelMarginResult {
  const fx = inputs.fx ?? DEFAULT_FX_INR
  const tables = {
    skuMaster: inputs.skuMaster,
    mappings: inputs.cogs?.mappings ?? [],
    comboComponents: inputs.cogs?.comboComponents ?? [],
  }
  const resolveCost = unitCostResolver(inputs.skuMaster, month, inputs.cogs ?? {})
  const master = new Map(inputs.skuMaster.map((s) => [s.sku, s]))
  const internalOf = new Map<string, string>()
  const internal = (code: string): string => {
    const cached = internalOf.get(code)
    if (cached !== undefined) return cached
    const value = internalSkuFor(code, tables)
    internalOf.set(code, value)
    return value
  }

  // --- the month's rows, gathered per product per channel ---------------
  const buckets = new Map<string, Bucket>()
  for (const r of filterByMonth(inputs.salesRecords, month)) {
    if (r.status === 'cancelled') continue
    const channel = channelOfSource(r.channel)
    const sku = internal(r.sku)
    const key = `${channel}\u0000${sku}`
    let b = buckets.get(key)
    if (!b) {
      const m = master.get(sku)
      b = {
        sku, channel, codes: new Set(),
        productName: m?.productName ?? r.productName ?? sku,
        category: m?.category ?? r.category ?? '',
        units: 0, earningUnits: 0, returnedUnits: 0, grossSales: 0, netSales: 0, rowFees: 0,
      }
      buckets.set(key, b)
    }

    // A dollar row and a rupee row sit in the same table and are subtracted
    // from a rupee cost, so both are converted on the way in. Read without
    // this, every Amazon USA product is catastrophically loss-making — $15 of
    // revenue against ₹96 of cost — and the screen's first act is to
    // recommend closing a profitable business.
    const rate = inrPerUnit(r.currency, fx)
    b.codes.add(r.sku)
    b.units += r.quantity
    if (r.netSales > 0) b.earningUnits += r.quantity
    b.returnedUnits += r.returnUnits + r.rtoUnits
    b.grossSales += r.grossSales * rate
    b.netSales += r.netSales * rate
    b.rowFees += r.marketplaceFee * rate
  }

  // --- advertising, matched to a product where the report names one ------
  const adsBySku = new Map<string, number>()
  const adsByChannel = new Map<BusinessChannelId, number>()
  const unmatched = new Map<BusinessChannelId, { spend: number; codes: Set<string> }>()
  for (const a of inputs.adsRecords) {
    if (toMonthKey(a.date) !== month) continue
    if (!a.sku) continue
    const channel = channelOfSource(a.channel)
    const spend = a.spend * inrPerUnit(a.currency ?? 'INR', fx)
    const sku = internal(a.sku)
    const key = `${channel}\u0000${sku}`
    if (buckets.has(key)) {
      adsBySku.set(key, (adsBySku.get(key) ?? 0) + spend)
      adsByChannel.set(channel, (adsByChannel.get(channel) ?? 0) + spend)
    } else {
      const u = unmatched.get(channel) ?? { spend: 0, codes: new Set<string>() }
      u.spend += spend
      u.codes.add(a.sku)
      unmatched.set(channel, u)
    }
  }

  // --- down the ladder, one channel at a time ----------------------------
  const rows: SkuChannelMargin[] = []
  const coverage: ChannelCoverage[] = []
  let uncosted = 0

  const byChannel = new Map<BusinessChannelId, Bucket[]>()
  for (const b of buckets.values()) {
    const list = byChannel.get(b.channel) ?? []
    list.push(b)
    byChannel.set(b.channel, list)
  }

  for (const [channel, list] of byChannel) {
    const rowFeeTotal = list.reduce((sum, b) => sum + b.rowFees, 0)
    const statementFee = inputs.channelFees[channel] ?? 0
    // Only the part of the statement the rows do not already account for.
    // Apportioning the whole statement on top of stated line fees charges the
    // product twice and invents a loss.
    const feeResidual = Math.max(0, statementFee - rowFeeTotal)
    const feeShare = allocate(feeResidual, list, (b) => b.netSales)

    const adsMeasured = adsByChannel.get(channel) ?? 0
    const adsUnmatched = unmatched.get(channel) ?? { spend: 0, codes: new Set<string>() }
    const channelAdTotal = inputs.channelAds[channel] ?? 0
    // Spend the report pinned to a code that sold nothing is already spoken
    // for: it cannot be apportioned to the products that did sell, because it
    // was not spent on them.
    const adsResidual = Math.max(0, channelAdTotal - adsMeasured - adsUnmatched.spend)
    const adShare = allocate(adsResidual, list, (b) => b.netSales)

    const feeBasis: MarginBasis =
      rowFeeTotal > 0 && feeResidual > 0 ? 'part'
        : rowFeeTotal > 0 ? 'measured'
          : feeResidual > 0 ? 'allocated' : 'none'
    const adsBasis: MarginBasis =
      adsMeasured > 0 && adsResidual > 0 ? 'part'
        : adsMeasured > 0 ? 'measured'
          : adsResidual > 0 ? 'allocated' : 'none'

    let channelCm3 = 0
    let channelNet = 0
    for (const b of list) {
      const key = `${channel}\u0000${b.sku}`
      // The Master's code first, then the codes the channel billed under: a
      // combo is usually priced from the channel's own code, and a product
      // the Master has never heard of can still be costed through the map.
      let unitCost = resolveCost(b.sku)
      for (const code of b.codes) {
        if (unitCost !== null) break
        unitCost = resolveCost(code)
      }
      const cogs = unitCost === null ? null : unitCost * b.units
      const feeAllocatedHere = feeShare.get(b) ?? 0
      const adsMeasuredHere = adsBySku.get(key) ?? 0
      const adsAllocatedHere = adShare.get(b) ?? 0
      const fee = b.rowFees + feeAllocatedHere
      const ads = adsMeasuredHere + adsAllocatedHere

      const cm1 = cogs === null ? null : b.netSales - cogs
      const cm2 = cm1 === null ? null : cm1 - fee
      const cm3 = cm2 === null ? null : cm2 - ads
      if (cogs === null) uncosted += 1
      channelNet += b.netSales
      channelCm3 += cm3 ?? 0

      rows.push({
        sku: b.sku,
        productName: b.productName,
        category: b.category,
        channelCodes: [...b.codes].sort(),
        channel,
        units: b.units,
        earningUnits: b.earningUnits,
        returnedUnits: b.returnedUnits,
        grossSales: b.grossSales,
        netSales: b.netSales,
        unitCost,
        cogs,
        fee,
        feeBasis: basisOf(b.rowFees, feeAllocatedHere),
        ads,
        adsBasis: basisOf(adsMeasuredHere, adsAllocatedHere),
        cm1,
        cm2,
        cm3,
        cm3Pct: cm3 === null || b.netSales <= 0 ? null : (cm3 / b.netSales) * 100,
      })
    }

    coverage.push({
      channel,
      netSales: channelNet,
      cm3: channelCm3,
      feeBasis,
      adsBasis,
      feeAllocated: feeResidual,
      adsAllocated: adsResidual,
      adsUnattributed: adsUnmatched.spend,
      adsUnattributedCodes: [...adsUnmatched.codes].sort(),
    })
  }

  rows.sort((a, b) => (a.cm3 ?? Number.POSITIVE_INFINITY) - (b.cm3 ?? Number.POSITIVE_INFINITY))
  coverage.sort((a, b) => b.netSales - a.netSales)
  return { month, rows, channels: coverage, uncosted }
}

export interface LossSummary {
  /** Rows that lose money after everything that can be measured. */
  losers: number
  /** Rows that could be judged at all. */
  judged: number
  lostAmount: number
  lostNetSales: number
  lostUnits: number
  /** The losers' share of the net sales of everything judged — how much of
   * the month's revenue is being sold at a loss. */
  lostSharePct: number | null
  /** Rows priced under what the goods cost, before any fee or advertising.
   * The subset that is a pricing decision and nothing else. */
  belowCost: number
}

export function summariseLosses(rows: SkuChannelMargin[]): LossSummary {
  const judged = rows.filter((r) => r.cm3 !== null)
  const losers = judged.filter((r) => (r.cm3 ?? 0) < 0)
  const net = judged.reduce((sum, r) => sum + r.netSales, 0)
  const lostNetSales = losers.reduce((sum, r) => sum + r.netSales, 0)
  return {
    losers: losers.length,
    judged: judged.length,
    lostAmount: losers.reduce((sum, r) => sum + (r.cm3 ?? 0), 0),
    lostNetSales,
    lostUnits: losers.reduce((sum, r) => sum + r.units, 0),
    lostSharePct: net > 0 ? (lostNetSales / net) * 100 : null,
    belowCost: judged.filter((r) => (r.cm1 ?? 0) < 0).length,
  }
}

/**
 * Why this row is losing money — the rung that took it below zero.
 *
 * A product priced under its cost needs a new price; one killed by a 127% fee
 * needs delisting or a bigger pack; one killed by its own advertising needs
 * the campaign turned off. They look identical on a margin column and the
 * action for each is different, so the screen names which it is.
 */
export type LossCause = 'charge-only' | 'below-cost' | 'free-goods' | 'returns' | 'fee' | 'ads' | null

export function lossCause(row: SkuChannelMargin): LossCause {
  if (row.cm3 === null || row.cm3 >= 0) return null

  // A charge against a product that did not ship this month at all. Myntra
  // bills a handful of these — a fee on something sold in an earlier month,
  // or on a cancellation. It is a real cost and belongs on the product, but
  // calling it a giveaway or a pricing mistake sends someone to fix a
  // listing that is behaving perfectly.
  if (row.units === 0) return 'charge-only'
  if (row.netSales <= 0) return 'free-goods'

  if ((row.cm1 ?? 0) < 0) {
    // Below cost over the month, but is the price wrong, or is the product
    // simply not earning on most of what ships? A unit that earned nothing
    // still cost what it cost, so enough of them drag a well-priced product
    // under. What a unit that did sell actually realised separates the two.
    const realised = row.earningUnits > 0 ? row.netSales / row.earningUnits : 0
    if (row.unitCost === null || realised < row.unitCost) return 'below-cost'

    // It is priced fine, so the drag is the units that earned nothing. The
    // rows say how many of those came back; the rest went out free. Flipkart
    // shipped 54 gift pouches in September, 9 of them returned and 37 given
    // away, and calling that a returns problem sends someone to the courier
    // over a decision the business made on purpose.
    const silent = row.units - row.earningUnits
    if (silent <= 0) return 'below-cost'
    return row.returnedUnits >= silent / 2 ? 'returns' : 'free-goods'
  }

  if ((row.cm2 ?? 0) < 0) return 'fee'
  return 'ads'
}

export const LOSS_CAUSE_LABELS: Record<Exclude<LossCause, null>, string> = {
  'charge-only': 'Charged with no sale',
  'below-cost': 'Priced under cost',
  'free-goods': 'Shipped free',
  returns: 'Lost to returns',
  fee: 'Eaten by fees',
  ads: 'Eaten by ads',
}
