import type { BusinessChannelId } from '@/config/channels'
import type { PnlBasis } from '@/data/models'
import type {
  AmazonInSkuFeeFacts,
  AmazonInSellerPnlFacts,
  AmazonInVendorFacts,
  CanonicalSalesRecord,
  ChannelChargeEntry,
  ChannelPnl,
  FixedExpenseEntry,
  MeeshoPnlFacts,
  NykaaPnlFacts,
  PnlLineValues,
  SkuMaster,
} from '@/data/models'
import { channelLabel, channelOfSource, type ChannelCurrencyView } from '@/config/channels'
import { MEESHO_ASSUMPTIONS } from '@/config/nativePnlAssumptions'
import { DEFAULT_FX_INR, inrPerUnit, type FxRatesInr } from '@/data/fxRates'
import { formatCurrencyFull, toMonthKey } from '@/lib/format'
import { cogsForMonth } from '@/data/costVersions'
import { resolveCogs } from '@/data/skuMapping'
import { allocateFixedExpensesForMonth } from './allocation'
import { channelChargesFor, channelChargeSummary, channelChargesTotal } from './channelCharges'
import {
  buildChannelPnl, cogsForRecords, computeSubtotals, estimateUncostedCogs,
  type CogsInputs, type MarketingByChannel, type UncostedCogsEstimate,
} from './pnl'
import {
  amazonUsaFactsAtRate, amazonUsaLineDefs, amazonUsaToCanonicalBuckets, amazonUsaValuesInInr,
  applyAmazonUsaOtherCosts, computeAmazonUsaPnl, isLegacyAmazonUsaFacts,
} from './nativePnl/amazonUsa'
import { applyFlipkartOtherCosts, computeFlipkartPnl, flipkartToCanonicalBuckets, FLIPKART_LINE_DEFS } from './nativePnl/flipkart'
import { applyMeeshoOtherCosts, computeMeeshoPnl, meeshoToCanonicalBuckets, MEESHO_LINE_DEFS } from './nativePnl/meesho'
import { blinkitToCanonicalBuckets, computeBlinkitPnl, BLINKIT_LINE_DEFS } from './nativePnl/blinkit'
import { amazonAeToCanonicalBuckets, amazonAeValuesInInr, computeAmazonAePnl, AMAZON_AE_LINE_DEFS } from './nativePnl/amazonAe'
import { applyMyntraOtherCosts, computeMyntraPnl, myntraToCanonicalBuckets, MYNTRA_LINE_DEFS } from './nativePnl/myntra'
import { computePurpllePnl, purplleToCanonicalBuckets, PURPLLE_LINE_DEFS } from './nativePnl/purplle'
import {
  computeSwiggyInstamartPnl, swiggyInstamartToCanonicalBuckets, SWIGGY_LINE_DEFS,
} from './nativePnl/swiggyInstamart'
import {
  applyNykaaOtherCosts, computeNykaaPnl, nykaaDiscountPerSalesFile, nykaaDiscountRecovered,
  nykaaDiscountWasDerived, nykaaToCanonicalBuckets, NYKAA_LINE_DEFS,
} from './nativePnl/nykaa'
import {
  AMAZON_IN_SELLER_LINE_DEFS, amazonInSellerToCanonicalBuckets, applyAmazonInSellerOtherCosts,
  computeAmazonInSellerPnl,
} from './nativePnl/amazonInSeller'
import {
  AMAZON_IN_VENDOR_LINE_DEFS, amazonInVendorToCanonicalBuckets, applyAmazonInVendorOtherCosts,
  computeAmazonInVendorPnl, type VendorCogs,
} from './nativePnl/amazonInVendor'
import {
  amazonInSellerExportLineDefs, amazonInSellerExportToCanonicalBuckets,
  applyAmazonInSellerExportOtherCosts, computeAmazonInSellerExportPnl, EMPTY_SELLER_EXPORT_COGS,
  type SellerExportCogs,
} from './nativePnl/amazonInSellerExport'
import type { NativeLineDef, NativeLineValues } from './nativePnl/types'
import type { ChannelFactsStore } from './channelFactsStore'

export interface NativePnlView {
  lineDefs: NativeLineDef[]
  values: NativeLineValues
  currency: 'INR' | 'USD' | 'AED'
}

/**
 * Which of Amazon India's two businesses a view is for.
 *
 * `'both'` is the channel — one row in the Master P&L, the Overview and the
 * MIS, and what every roll-up reads. The other two are one business each, for
 * the screens that let the owner read them apart: wholesale to RK World and
 * the marketplace are different businesses on different revenue bases, and a
 * single waterfall can only be one of them.
 *
 * The two halves add to the channel exactly, in every line — that is the
 * property the tests hold, and the reason the shared ad spend is charged on
 * one side only and the month's fixed expenses are divided between them.
 */
export type AmazonInHalf = 'both' | 'vendor' | 'seller'

export interface ChannelPnlView {
  channel: BusinessChannelId
  month: string
  /** Always populated — the generic canonical bucket structure, used by Master P&L/MIS. */
  canonical: ChannelPnl
  /** Populated only when this channel has real native facts for this month. */
  native?: NativePnlView
  /** Anything the reader needs to know to trust these numbers — currently only
   * raised when effective-dated costs could not be applied. Empty is the
   * normal case. */
  notes: string[]
}

/**
 * How Amazon India's net sales divide between its two businesses.
 *
 * Read off the same figures the statements report — the wholesale invoice and
 * the marketplace's net sales — so the shares on screen are the shares in the
 * P&L rather than a second reading of the month.
 */
export interface AmazonInHalfSplit {
  vendorNet: number
  sellerNet: number
  /** Each half's share of the two, 0–100. Null when neither half traded in
   * the months asked for: there is no split to show, and 0% would claim
   * there is. */
  vendorPct: number | null
  sellerPct: number | null
}

/** Amazon India's split over a set of months, summed. */
export function amazonInHalfSplit(facts: ChannelFactsStore, months: string[]): AmazonInHalfSplit {
  let vendorNet = 0
  let sellerNet = 0
  for (const month of months) {
    vendorNet += facts.amazonInVendorFacts?.find((f) => f.month === month)?.invoiceValue ?? 0
    // The same precedence the statement uses: the export states the month,
    // the settlement is the fortnight's cash behind it.
    const exported = facts.amazonInSkuFeeFacts?.find((f) => f.month === month)
    const settlement = facts.amazonInSellerFacts?.find((f) => f.month === month)
    sellerNet += exported
      ? exported.netSalesInr
      : settlement
        ? computeAmazonInSellerPnl(settlement).netSales
        : 0
  }
  const total = vendorNet + sellerNet
  if (total <= 0) return { vendorNet, sellerNet, vendorPct: null, sellerPct: null }
  return {
    vendorNet, sellerNet,
    vendorPct: (vendorNet / total) * 100,
    sellerPct: (sellerNet / total) * 100,
  }
}

export type { ChannelFactsStore } from './channelFactsStore'

/** Sums this channel's allocated share (sales-contribution method) of the
 * month's fixed expenses into one lump figure, for channels whose native
 * template has a single "Other Costs" line rather than a category breakdown. */
/**
 * A native channel's canonical buckets with its share of the month's fixed
 * expenses put back in.
 *
 * A channel with its own statement returns canonical lines built from that
 * statement's facts, and those facts describe trading — what was sold, what
 * the marketplace charged. They say nothing about salaries or rent, so every
 * native channel reached the multi-month P&L with its OPEX lines empty and an
 * EBITDA identical to its contribution. The generic path never had this
 * problem: it allocates the same expenses itself.
 *
 * Allocating per category rather than as one lump is what keeps the Master
 * P&L's own OPEX breakdown adding up to the company total.
 */
function withAllocatedOpex(
  lines: PnlLineValues,
  inputs: ChannelPnlViewInputs,
  channel: BusinessChannelId,
  month: string,
  /**
   * The fraction of the channel's allocation these lines carry. Below 1 only
   * where one business inside a channel is being read on its own — see
   * `amazonInHalfShare`.
   */
  share = 1,
): PnlLineValues {
  const allocation = allocateFixedExpensesForMonth(
    inputs.salesRecords, inputs.fixedExpenses, month, inputs.facts, inputs.fxRate,
  )[channel] ?? {}
  // The channel's own charges go in beside its share of the company's, and
  // are scaled by the same fraction for the same reason: reading half a
  // channel has to give half of everything the channel carries, or the two
  // halves stop adding to it.
  const own = channelChargesTotal(inputs.channelCharges, channel, month) * share
  const opex: PnlLineValues = own === 0 ? {} : { channelCharges: own }
  for (const [key, value] of Object.entries(allocation) as [keyof PnlLineValues, number | undefined][]) {
    opex[key] = (value ?? 0) * share
  }
  return { ...lines, ...opex }
}

function computeAllocatedOtherCosts(
  inputs: ChannelPnlViewInputs,
  channel: BusinessChannelId,
  month: string,
  share = 1,
): number {
  const allocation = allocateFixedExpensesForMonth(
    inputs.salesRecords, inputs.fixedExpenses, month, inputs.facts, inputs.fxRate,
  )[channel] ?? {}
  const allocated = Object.values(allocation).reduce((sum, v) => sum + (v ?? 0), 0)
  // A native statement shows one "Other Costs" line rather than the opex
  // breakdown, and a channel charge is one of those costs — left out of it,
  // the statement's EBITDA would disagree with the canonical one by exactly
  // the charge.
  return (allocated + channelChargesTotal(inputs.channelCharges, channel, month)) * share
}

/** Share of revenue charged as COGS for a SKU with no cost on file. Matches the
 * fallback the company's own model uses for its unpriced bucket. */
/** Records carrying a foreign currency have to be brought to rupees before a
 * rupee cost is estimated from them. Amazon USA's rows are dollars; costs are
 * always rupees. */
function uncostedNetSalesInInr(
  records: CanonicalSalesRecord[],
  uncostedSkus: string[],
  fxRate: FxRatesInr,
): number {
  const uncosted = new Set(uncostedSkus)
  return records.reduce((sum, r) => {
    if (r.status === 'cancelled' || !uncosted.has(r.sku)) return sum
    return sum + r.netSales * inrPerUnit(r.currency, fxRate)
  }, 0)
}

/** How far the order rows' unit count may drift from the statement's dispatched
 * units before they are treated as describing different things. They come from
 * the same upload, so any real gap means one of them is stale. */
const UNIT_MATCH_TOLERANCE = 0.02

/**
 * COGS for a channel-month, recomputed from order rows at the cost that applied
 * in that month.
 *
 * Native facts carry a `cogs` figure, but a marketplace does not know what a
 * product costs us — that number was computed by the importer from whatever was
 * in the Product Master on the day the file was uploaded, and then frozen into
 * the facts blob. Left alone it makes effective-dated costs a no-op on exactly
 * the channels that have settlement files, and it prices a month at an
 * arbitrary date rather than at that month's cost.
 *
 * Returns null when there are no order rows to recompute from, in which case
 * the imported figure is the only number available and is kept.
 */
/**
 * COGS for a Vendor Central month, priced from the ASINs the NPPM file lists.
 *
 * Not from the sales rows, deliberately. The Retail Analytics export that
 * filled those rows states ordered units at a retail value, and this
 * statement is about shipped units at an invoice value — pricing one with the
 * other would cost a month's goods against a different month's demand.
 *
 * An ASIN with no cost behind it falls to the same estimate every other
 * channel uses, so there is one policy for an unpriced line in this build
 * rather than one per channel.
 */
function vendorCogs(facts: AmazonInVendorFacts, month: string, inputs: ChannelPnlViewInputs): VendorCogs {
  const tables = {
    skuMaster: inputs.skuMaster,
    mappings: inputs.cogs?.mappings ?? [],
    comboComponents: inputs.cogs?.comboComponents ?? [],
    costFor: (sku: string) => {
      const index = inputs.cogs?.costIndex
      if (!index) return undefined
      // Effective-dated, so a closed month keeps the cost that applied then.
      return cogsForMonth(sku, month, index) ?? undefined
    },
  }
  let priced = 0
  let costedUnits = 0
  let uncostedUnits = 0
  let uncostedInvoice = 0
  const uncostedAsins: string[] = []
  for (const asin of facts.asins) {
    const resolved = resolveCogs(asin.asin, tables)
    if (resolved && resolved.cogs > 0) {
      priced += resolved.cogs * asin.units
      costedUnits += asin.units
    } else {
      uncostedUnits += asin.units
      uncostedInvoice += asin.invoice
      uncostedAsins.push(asin.asin)
    }
  }
  const estimate = estimateUncostedCogs(
    { cogs: priced, costedUnits, uncostedUnits, uncostedSkus: uncostedAsins, uncostedNetSales: uncostedInvoice },
    uncostedInvoice,
  )
  return { priced, unpriced: estimate.amount, uncostedAsins: uncostedAsins.length, uncostedUnits }
}

/**
 * Cost of goods for a Seller Central month, priced from the MSKUs the export
 * lists.
 *
 * Amazon's own seller-cost column in that export is whatever someone typed
 * into Seller Central, and ours is blank on every month on file, so the cost
 * is priced here from our cost sheet against the units each MSKU sold. An
 * MSKU with no cost behind it falls to the same estimate every other channel
 * uses.
 *
 * A month imported before the export carried units per SKU cannot be priced
 * at all. Rather than report a 100% gross margin it estimates the whole
 * month's cost and says so on the statement, and a re-upload prices it.
 */
function sellerExportCogs(
  facts: AmazonInSkuFeeFacts,
  month: string,
  inputs: ChannelPnlViewInputs,
): SellerExportCogs {
  const tables = {
    skuMaster: inputs.skuMaster,
    mappings: inputs.cogs?.mappings ?? [],
    comboComponents: inputs.cogs?.comboComponents ?? [],
    costFor: (sku: string) => {
      const index = inputs.cogs?.costIndex
      if (!index) return undefined
      return cogsForMonth(sku, month, index) ?? undefined
    },
  }
  const units = facts.unitsBySku ?? {}
  const netSalesBySku = facts.netSalesBySku ?? {}
  const skus = Object.keys(units)
  if (skus.length === 0) {
    const charged = Object.keys(facts.feeBySkuInr ?? {})
    const estimate = estimateUncostedCogs(
      {
        cogs: 0, costedUnits: 0, uncostedUnits: facts.netUnitsSoldQty,
        uncostedSkus: charged, uncostedNetSales: facts.netSalesInr,
      },
      facts.netSalesInr,
    )
    return {
      priced: 0, unpriced: estimate.amount, uncostedSkus: charged.length,
      uncostedUnits: facts.netUnitsSoldQty, estimatedWholeMonth: true,
    }
  }

  let priced = 0
  let costedUnits = 0
  let uncostedUnits = 0
  let uncostedNetSales = 0
  const uncostedSkus: string[] = []
  for (const sku of skus) {
    const qty = units[sku] ?? 0
    const resolved = resolveCogs(sku, tables)
    if (resolved && resolved.cogs > 0) {
      priced += resolved.cogs * qty
      costedUnits += qty
    } else {
      uncostedUnits += qty
      uncostedNetSales += netSalesBySku[sku] ?? 0
      uncostedSkus.push(sku)
    }
  }
  const estimate = estimateUncostedCogs(
    { cogs: priced, costedUnits, uncostedUnits, uncostedSkus, uncostedNetSales },
    uncostedNetSales,
  )
  return {
    priced, unpriced: estimate.amount, uncostedSkus: uncostedSkus.length,
    uncostedUnits, estimatedWholeMonth: false,
  }
}

/** Two canonical bucket sets added line by line, for a channel built from
 * more than one statement. */
function addBuckets(a: PnlLineValues, b: PnlLineValues): PnlLineValues {
  const out: PnlLineValues = { ...a }
  for (const [key, value] of Object.entries(b) as [keyof PnlLineValues, number | undefined][]) {
    if (typeof value !== 'number') continue
    out[key] = (out[key] ?? 0) + value
  }
  return out
}

/**
 * The Seller Central month in canonical buckets, with advertising taken out.
 *
 * Amazon India has one ad account across both halves and the figure is
 * charged once, on the wholesale statement. Letting it through here as well
 * would count the same spend twice in the Master P&L.
 */
function sellerBucketsWithoutAds(facts: AmazonInSellerPnlFacts): PnlLineValues {
  return { ...amazonInSellerToCanonicalBuckets(facts), ads: 0 }
}

/**
 * The share of Amazon India's allocated fixed expenses one half carries.
 *
 * Rent, salaries and software are allocated to the channel, not to a business
 * inside it, so reading one half on its own has to divide them. Charging each
 * half the whole channel's overhead would make the two halves add to more
 * than Amazon India, and the P&L has to hold whichever way it is read.
 *
 * Divided on net revenue — the wholesale invoice against the marketplace's
 * net sales — which is the basis this build shares every other common cost
 * on. A month with only one half on file has nothing to divide.
 */
function amazonInHalfShare(
  vendor: AmazonInVendorFacts | undefined,
  sellerNet: number,
  half: AmazonInHalf,
): number {
  if (half === 'both' || !vendor || sellerNet === 0) return 1
  const vendorNet = vendor.invoiceValue
  const total = vendorNet + sellerNet
  // Neither half sold anything, so there is no revenue to divide on. The
  // overhead stays with the wholesale side rather than being split in two.
  if (total <= 0) return half === 'vendor' ? 1 : 0
  return (half === 'vendor' ? vendorNet : sellerNet) / total
}

function recomputedCogs(
  channel: BusinessChannelId,
  month: string,
  inputs: ChannelPnlViewInputs,
): {
  priced: number
  unpriced: number
  total: number
  uncostedSkus: string[]
  uncostedUnits: number
  method: UncostedCogsEstimate['method']
} | null {
  if (!inputs.cogs?.costIndex) return null

  const records = inputs.salesRecords.filter(
    (r) => channelOfSource(r.channel) === channel && toMonthKey(r.orderDate) === month,
  )
  if (records.length === 0) return null

  const fxRate = inputs.fxRate ?? DEFAULT_FX_INR
  const result = cogsForRecords(records, inputs.skuMaster, month, inputs.cogs)
  const estimate = estimateUncostedCogs(result, uncostedNetSalesInInr(records, result.uncostedSkus, fxRate))
  return {
    priced: result.cogs,
    unpriced: estimate.amount,
    total: result.cogs + estimate.amount,
    uncostedSkus: result.uncostedSkus,
    uncostedUnits: result.uncostedUnits,
    method: estimate.method,
  }
}

/**
 * The Nykaa statement's line definitions, with the discount line told to
 * explain where its own figure came from.
 *
 * A zero on this line has three quite different meanings — the month really
 * was sold at MRP, the figure was rebuilt from order rows, or it could not be
 * established at all — and they need different responses. That explanation was
 * put in a note above the table, which is the one part of a long statement a
 * reader scrolls straight past. It belongs on the line it explains.
 */
function nykaaLineDefsFor(facts: NykaaPnlFacts): NativeLineDef[] {
  if (facts.confirmedDiscount !== undefined) {
    return NYKAA_LINE_DEFS.map((d) => (d.key === 'customerDiscount'
      ? { ...d, note: 'Confirmed with Nykaa and entered by hand — this replaces what the sales file implied' }
      : d))
  }
  if (facts.customerDiscount !== undefined) return NYKAA_LINE_DEFS
  const note = nykaaDiscountWasDerived(facts)
    ? 'Derived from this month\'s own MRP and sale totals, because the month predates this line. Upload the Sales '
      + 'and Cart Rule files again to split it and credit any coupons Nykaa funded.'
    : '⚠ Not established — this month has no record of what shoppers paid, so every margin below is overstated. '
      + 'Re-upload the Nykaa Sales file.'
  return NYKAA_LINE_DEFS.map((d) => (d.key === 'customerDiscount' ? { ...d, note } : d))
}

/**
 * Meesho's three COGS lines, recomputed at the month's effective cost.
 *
 * Meesho's statement splits cost of goods three ways — units actually sold,
 * the unsaleable part of RTO stock, and the unsaleable part of customer
 * returns — because a parcel that comes back is not the same cost as one that
 * stayed sold. Recomputing them as a single number would collapse that split
 * and report an RTO write-off of zero on a month that had 155 RTO units.
 *
 * Only the order basis is recomputed. Order rows are bucketed by order date,
 * so pairing them with a settlement month would price one month's cost using
 * a different month's orders. On settlement basis the imported figure stands.
 */
function recomputedMeeshoCogs(
  month: string,
  imported: MeeshoPnlFacts,
  inputs: ChannelPnlViewInputs,
): { unitsSold: number; rtoWriteOff: number; returnWriteOff: number } | { note: string } | null {
  if (!inputs.cogs?.costIndex) return null

  const records = inputs.salesRecords.filter(
    (r) => channelOfSource(r.channel) === 'meesho' && toMonthKey(r.orderDate) === month,
  )
  if (records.length === 0) return null

  // The order rows and the statement must describe the same month's trading.
  // One upload produces both, so they normally agree exactly; when they do
  // not, the rows are a different population and pricing the statement from
  // them would quietly report a cost for units it never sold. Better to keep
  // the imported figure and say the cost sheet did not reach this month.
  const rowUnits = records.reduce((n, r) => (r.status === 'cancelled' ? n : n + r.quantity), 0)
  const gap = Math.abs(rowUnits - imported.unitsDispatched)
  if (imported.unitsDispatched === 0 || gap > imported.unitsDispatched * UNIT_MATCH_TOLERANCE) {
    return {
      note:
        `Cost sheet not applied to this month: the ${Math.round(rowUnits).toLocaleString('en-IN')} unit(s) in Meesho order rows ` +
        `do not match the ${Math.round(imported.unitsDispatched).toLocaleString('en-IN')} unit(s) the statement reports as ` +
        `dispatched, so COGS is the figure from the uploaded file. Re-upload the aggregated payment workbook for this month ` +
        `to price it from the cost sheet.`,
    }
  }

  const bucket = (rows: CanonicalSalesRecord[]): number => {
    if (rows.length === 0) return 0
    const result = cogsForRecords(rows, inputs.skuMaster, month, inputs.cogs)
    // Meesho rows are already rupees, so no conversion is needed here.
    return result.cogs + estimateUncostedCogs(result, result.uncostedNetSales).amount
  }

  return {
    unitsSold: bucket(records.filter((r) => r.status === 'completed' || r.status === 'pending')),
    rtoWriteOff: bucket(records.filter((r) => r.status === 'rto')) * (1 - MEESHO_ASSUMPTIONS.rtoSaleablePct),
    returnWriteOff:
      bucket(records.filter((r) => r.status === 'returned')) * (1 - MEESHO_ASSUMPTIONS.customerReturnSaleablePct),
  }
}

export interface ChannelPnlViewInputs {
  salesRecords: CanonicalSalesRecord[]
  skuMaster: SkuMaster[]
  fixedExpenses: FixedExpenseEntry[]
  /**
   * Charges billed to one channel and paid outside its settlement — a
   * marketplace programme fee on a payment link, say. Charged whole to that
   * channel in that month, never shared out, which is what separates them
   * from the fixed expenses above.
   */
  channelCharges?: ChannelChargeEntry[]
  marketing: MarketingByChannel
  facts: ChannelFactsStore
  /** Effective-dated costs and combo recipes. Optional so a caller with
   * neither still gets a P&L, costed from the Product Master as before. */
  cogs?: CogsInputs
  /** Which calendar Meesho's months are cut on. Defaults to order basis. */
  meeshoBasis?: PnlBasis
  /** Which of Amazon India's two businesses to report. Defaults to the whole
   * channel, so a caller that knows nothing about the split still gets both. */
  amazonInHalf?: AmazonInHalf
  /** Rupees per unit of each currency the company is paid in, for this month.
   * Amazon USA is denominated in dollars and Amazon UAE in dirhams, so these
   * scale those channels wherever they roll into the rupee P&L. */
  fxRate?: FxRatesInr
  /** Rupees of India→USA freight per unit shipped, for this month. */
  freightPerUnitInr?: number
  /** Rupees a unit from our warehouse to Nykaa's, for the month being read. */
  nykaaFreightPerUnitInr?: number
  /** Rupees to pack one parcel, for the month being read. Meesho's statement
   * charges it per shipment; no marketplace report carries it. */
  packagingPerShipmentInr?: number
  /** What Nykaa confirmed it is charging back as discount for this month.
   * Undefined means nothing has been confirmed and the sales file stands. */
  confirmedNykaaDiscount?: number
  /** Whether a channel's own statement is rendered in its own currency or in
   * rupees. The canonical roll-up is always rupees regardless — the Master
   * P&L has one currency. */
  currencyView?: ChannelCurrencyView
}

/**
 * The line every native statement deducts head office on, whatever it calls
 * its key. One of these is on each of the twelve templates.
 */
const ALLOCATED_COST_KEYS = ['otherCosts', 'overheads', 'allocatedOverheadsUsd']

/**
 * The native statement's allocated-costs line, named for what is actually in
 * it when a channel charge is in it too.
 *
 * A native statement has one line for everything below contribution, and it
 * is called "(−) Allocated Fixed Expenses" on every channel — a name the
 * owner settled so that two statements side by side could be read as the
 * same figure. A channel charge is not an allocated fixed expense: it is
 * Flipkart's own NextGen fee, billed to Flipkart. Folded into that line
 * silently, September's statement would say ₹25,000 of allocated head office
 * where the company allocated none, and nothing on the screen would say
 * otherwise.
 *
 * The figure stays where it is — splitting it would mean a thirteenth line
 * on twelve statements the owner is happy with — and the name is extended to
 * say what joined it. Only for the months that have charges, so the settled
 * name is still the name everywhere else.
 */
function nameChannelCharges(
  view: ChannelPnlView,
  inputs: ChannelPnlViewInputs,
  channel: BusinessChannelId,
  month: string,
): ChannelPnlView {
  const charges = channelChargesFor(inputs.channelCharges, channel, month)
  if (charges.length === 0 || !view.native) return view
  return {
    ...view,
    native: {
      ...view.native,
      lineDefs: view.native.lineDefs.map((d) => (
        ALLOCATED_COST_KEYS.includes(d.key)
          ? { ...d, label: `${d.label} & ${channelChargeSummary(charges)}` }
          : d
      )),
    },
  }
}

/**
 * Builds the P&L view for one channel/month. Flipkart, Amazon USA and Meesho
 * render their real native waterfall whenever facts exist for that month;
 * every channel (native or not) also gets the generic canonical bucket
 * structure so the Master P&L and Investor MIS can roll up consistently.
 */
export function buildChannelPnlView(channel: BusinessChannelId, month: string, inputs: ChannelPnlViewInputs): ChannelPnlView {
  return nameChannelCharges(buildChannelPnlStatement(channel, month, inputs), inputs, channel, month)
}

function buildChannelPnlStatement(channel: BusinessChannelId, month: string, inputs: ChannelPnlViewInputs): ChannelPnlView {
  if (channel === 'flipkart') {
    const imported = inputs.facts.flipkartFacts.find((f) => f.month === month)
    if (imported) {
      const recomputed = recomputedCogs(channel, month, inputs)
      const facts = recomputed
        ? { ...imported, cogsPriced: recomputed.priced, cogsUnpriced: recomputed.unpriced }
        : imported
      const otherCosts = computeAllocatedOtherCosts(inputs, channel, month)
      const values = applyFlipkartOtherCosts(computeFlipkartPnl(facts), otherCosts)
      const canonicalLines = computeSubtotals(withAllocatedOpex(flipkartToCanonicalBuckets(facts), inputs, channel, month))
      return {
        channel, month,
        canonical: { channel, month, lines: canonicalLines },
        native: { lineDefs: FLIPKART_LINE_DEFS, values, currency: 'INR' },
        notes: [],
      }
    }
  }

  if (channel === 'amazon_us') {
    const imported = inputs.facts.amazonUsaFacts.find((f) => f.month === month)
    if (imported) {
      const fxRate = (inputs.fxRate ?? DEFAULT_FX_INR).USD
      // Rupee costs are converted at this month's rate rather than the one
      // that happened to be configured when the file was uploaded.
      // Freight is priced when the statement is read, at the month's rate, so
      // correcting the rate restates the months it should and leaves closed
      // months on the rate they were closed at. It used to be a constant
      // multiplied in at import and frozen, which meant neither.
      const withFreight = inputs.freightPerUnitInr !== undefined && imported.netUnitsSoldQty !== undefined
        ? { ...imported, freightSourceInr: inputs.freightPerUnitInr * imported.netUnitsSoldQty }
        : imported
      const atRate = amazonUsaFactsAtRate(withFreight, fxRate)
      const recomputed = recomputedCogs(channel, month, inputs)
      const facts = recomputed
        ? {
            ...atRate,
            cogsUsd: recomputed.total / fxRate,
            cogsPricedUsd: recomputed.priced / fxRate,
            cogsEstimatedUsd: recomputed.unpriced / fxRate,
            uncostedUnitsQty: recomputed.uncostedUnits,
          }
        : atRate

      // Amazon USA's own overhead lines are US costs. This is its share of the
      // company's fixed expenses, which every other channel's statement
      // already carried and this one did not.
      const otherCosts = computeAllocatedOtherCosts(inputs, channel, month)
      const usd = applyAmazonUsaOtherCosts(computeAmazonUsaPnl(facts), otherCosts, fxRate, facts.netSalesUsd)
      const showInr = inputs.currencyView === 'INR'
      const canonicalLines = computeSubtotals(withAllocatedOpex(amazonUsaToCanonicalBuckets(facts, fxRate), inputs, channel, month))
      // A month imported before the fee columns were kept one-for-one has no
      // column-level figures to show. Saying so is the only honest option:
      // spreading its eight old buckets across Amazon's real column names put
      // the old catch-all on the "Storage utilization surcharge" line and
      // showed a five-figure charge against a sheet that said zero.
      const notes = isLegacyAmazonUsaFacts(imported)
        ? [`${month} was imported before the fee columns were read individually, so only Gross and Net Sales are reliable for it. Re-upload this month's Product Profitability export to fill in the charges.`]
        : []
      // No order rows for the month means COGS cannot be recomputed at all and
      // the statement is showing whatever was frozen into the file at import.
      // That fallback used to be silent, which is how an order-date bug that
      // filed every Amazon USA month under the previous one went unnoticed:
      // the figure looked plausible and nothing said it was stale.
      if (!recomputed) {
        notes.push(
          `No Amazon USA order rows are on file for ${month}, so COGS is the figure frozen when the file was ` +
          `imported rather than priced from this month's cost sheet. Re-upload this month's Product Profitability ` +
          `export to price it properly.`,
        )
      }
      // A month whose cost is largely guessed says so, and names the SKUs to
      // fix. COGS that jumps about between months is almost always this: the
      // set of SKUs with no cost on file changes, not the cost of the goods.
      if (recomputed && recomputed.uncostedUnits > 0) {
        const share = recomputed.total > 0 ? (recomputed.unpriced / recomputed.total) * 100 : 0
        const shown = recomputed.uncostedSkus.slice(0, 8).join(', ')
        const rest = recomputed.uncostedSkus.length - 8
        notes.push(
          `${recomputed.uncostedSkus.length} SKU(s) sold in ${month} have no cost on file, covering ` +
          `${recomputed.uncostedUnits.toLocaleString('en-IN')} unit(s). Their cost is estimated ` +
          `${recomputed.method === 'average-unit-cost' ? 'at what a costed unit averaged this month' : 'at 25% of what they sold for'}, ` +
          `which is ${share.toFixed(0)}% of the COGS shown. Add costs for ${shown}${rest > 0 ? ` and ${rest} more` : ''} to price them properly.`,
        )
      }
      return {
        channel, month,
        canonical: { channel, month, lines: canonicalLines },
        native: {
          lineDefs: amazonUsaLineDefs(imported),
          values: showInr ? amazonUsaValuesInInr(usd, fxRate) : usd,
          currency: showInr ? 'INR' : 'USD',
        },
        notes,
      }
    }
  }

  if (channel === 'nykaa') {
    const imported = inputs.facts.nykaaFacts?.find((f) => f.month === month)
    if (imported) {
      // Nykaa states what it bought, never what the goods cost us. COGS is
      // priced here, from the order rows at the month's effective cost, so a
      // corrected cost sheet restates the month rather than leaving whatever
      // was frozen at upload time.
      const recomputed = recomputedCogs(channel, month, inputs)
      // Nykaa's Marketing Invest bill arrives as a PDF, not inside the sales
      // files, so the month's ad spend comes from the same place the Ads
      // screens read it. One figure, one source: entering or re-reading the MI
      // moves the P&L and the Ads page together, and re-uploading the sales
      // file cannot wipe it.
      const adSpend = inputs.marketing[channel]?.ads ?? 0
      // Priced when the statement is read, at the month's own rate card, so a
      // corrected rate restates the months it should and a closed month keeps
      // the rate it closed on. Charged on net units, matching the freight to
      // the units whose revenue is in this month.
      const inboundFreight = (inputs.nykaaFreightPerUnitInr ?? 0) * imported.netUnits
      const facts: NykaaPnlFacts = {
        ...imported,
        ...(recomputed ? { cogsPriced: recomputed.priced, cogsUnpriced: recomputed.unpriced } : {}),
        inboundFreight,
        confirmedDiscount: inputs.confirmedNykaaDiscount,
        nykaaAds: imported.nykaaAds || adSpend,
      }
      const otherCosts = computeAllocatedOtherCosts(inputs, channel, month)
      const values = applyNykaaOtherCosts(computeNykaaPnl(facts), otherCosts)
      const notes: string[] = []
      if (inboundFreight === 0 && imported.netUnits > 0) {
        notes.push(
          `No warehouse-to-Nykaa freight rate is on file for ${month}, so the ` +
          `${imported.netUnits.toLocaleString('en-IN')} unit(s) sold carry no delivery cost. Enter the rate card ` +
          'on Settings → Rates. It is left at zero rather than estimated, because a guessed rate card is a cost ' +
          'nobody agreed to.',
        )
      }
      if (facts.nykaaAds === 0) {
        notes.push(
          `No Nykaa Marketing Invest is on file for ${month}, so CM2 is the same figure as CM1. Upload the MI ` +
          'invoice PDF Nykaa emails for the month — it is booked to the activity month it bills, not its own date.',
        )
      }
      if (!recomputed) {
        notes.push(
          `No Nykaa order rows are on file for ${month}, so the statement shows no cost of goods. Re-upload this ` +
          `month's Nykaa Sales file — it is what the cost is priced from.`,
        )
      }
      // The discount is the channel's second largest cost and the one most
      // likely to be disputed, so the statement says where its figure came
      // from rather than leaving the number to speak for itself.
      const expectedDiscount = nykaaDiscountRecovered(facts)
      const charged = facts.discountDebitNote?.amount
      if (expectedDiscount === 0 && facts.netSalesMrp > 0 && facts.confirmedDiscount === undefined) {
        notes.push(
          `${month} shows no customer discount, which on this channel means the figure is missing rather than nil: ` +
          'Nykaa sells below MRP and charges the difference back on every month. Revenue here is what Nykaa ' +
          `invoiced, not what we kept, so every margin below it is overstated. Re-upload ${month}'s Nykaa Sales file.`,
        )
      } else if (facts.confirmedDiscount !== undefined) {
        const perFile = nykaaDiscountPerSalesFile(facts)
        const gap = facts.confirmedDiscount - perFile
        notes.push(
          Math.abs(gap) <= 1
            ? `The ${formatCurrencyFull(expectedDiscount)} of customer discount is the figure confirmed for ${month}, ` +
              'and it matches what the sales file implied.'
            : `The ${formatCurrencyFull(expectedDiscount)} of customer discount is the figure confirmed for ${month}, ` +
              `entered by hand. Its sales file implied ${formatCurrencyFull(perFile)}, ` +
              `${formatCurrencyFull(Math.abs(gap))} ${gap > 0 ? 'less' : 'more'} — the confirmed figure is the one ` +
              'deducted, and the file\'s is kept beside it on the statement.',
        )
      } else if (nykaaDiscountWasDerived(facts)) {
        notes.push(
          `The ${formatCurrencyFull(expectedDiscount)} of customer discount deducted here was derived from ${month}'s ` +
          'own MRP and sale totals, because the month was imported before this cost was modelled. The total is right; ' +
          'uploading the Sales and Cart Rule files again splits it and credits any coupons Nykaa funded.',
        )
      }
      if (charged !== undefined && Math.abs(charged - expectedDiscount) > Math.max(expectedDiscount * 0.01, 1)) {
        notes.push(
          `Nykaa's debit note ${facts.discountDebitNote?.documentNumber ?? ''} charges ${formatCurrencyFull(charged)} of ` +
          `discount for ${month}, against the ${formatCurrencyFull(expectedDiscount)} this month's sales file accounts for. ` +
          'The statement deducts the sales file figure; the difference is worth taking up with Nykaa.',
        )
      }
      if (recomputed && recomputed.uncostedUnits > 0) {
        const share = recomputed.total > 0 ? (recomputed.unpriced / recomputed.total) * 100 : 0
        const shown = recomputed.uncostedSkus.slice(0, 8).join(', ')
        const rest = recomputed.uncostedSkus.length - 8
        notes.push(
          `${recomputed.uncostedSkus.length} Nykaa SKU(s) sold in ${month} have no cost on file, covering ` +
          `${recomputed.uncostedUnits.toLocaleString('en-IN')} unit(s). Their cost is estimated ` +
          `${recomputed.method === 'average-unit-cost' ? 'at what a costed unit averaged this month' : 'at 25% of what they sold for'}, ` +
          `which is ${share.toFixed(0)}% of the COGS shown. Link ${shown}${rest > 0 ? ` and ${rest} more` : ''} on SKU Mapping to price them properly.`,
        )
      }
      return {
        channel, month,
        canonical: { channel, month, lines: computeSubtotals(withAllocatedOpex(nykaaToCanonicalBuckets(facts), inputs, channel, month)) },
        native: { lineDefs: nykaaLineDefsFor(facts), values, currency: 'INR' },
        notes,
      }
    }
  }

  if (channel === 'amazon_in') {
    // Amazon India is two businesses under one name, and which of them is
    // being read is a question the channel cannot answer for itself. 'both'
    // is the channel — every roll-up reads that — and the other two are one
    // business each: the other half is not folded in, the shared ad spend
    // stays on the side that carries it, and each half takes its own share of
    // the month's fixed expenses, so the two still add to Amazon India.
    const half = inputs.amazonInHalf ?? 'both'
    const vendorMonth = inputs.facts.amazonInVendorFacts?.find((f) => f.month === month)

    // The marketplace half has two possible sources, and they are two
    // readings of the same trading rather than two months. The Product
    // Profitability export states every SKU the month sold; a settlement
    // report states one fortnight's cash. For six months the settlements were
    // the only source and two of them had been uploaded, which read Seller
    // Central as an ₹8,000 business against the ₹2 lakh its exports show — so
    // the export is the month wherever there is one, and the settlement stays
    // beside it as the tie to what Amazon deposited.
    const exportMonth = inputs.facts.amazonInSkuFeeFacts?.find((f) => f.month === month)
    const settlementMonth = inputs.facts.amazonInSellerFacts?.find((f) => f.month === month)
    const sellerCogs = exportMonth ? sellerExportCogs(exportMonth, month, inputs) : EMPTY_SELLER_EXPORT_COGS
    // One ad account lifts both halves, so the month's spend is charged once.
    // The wholesale statement carries it where the month has one, and the
    // marketplace statement where it does not — July 2026 has no NPPM file,
    // and with the spend pinned to the wholesale side its ₹3.53 lakh of
    // measured Sponsored Products spend was charged nowhere at all.
    const channelAds = inputs.marketing[channel]?.ads ?? 0
    const adsOnVendor = vendorMonth ? channelAds : 0
    const adsOnSeller = vendorMonth ? 0 : channelAds
    const sellerNetSales = exportMonth
      ? exportMonth.netSalesInr
      : settlementMonth
        ? computeAmazonInSellerPnl(settlementMonth).netSales
        : 0
    // That half in canonical buckets, for the channel total. Advertising is
    // dropped from the settlement reading because the channel charges its one
    // AMC account on the wholesale statement; the export's own advertising
    // lines are what Amazon billed inside the report and stand.
    const marketplaceBuckets = (): PnlLineValues | null =>
      exportMonth
        ? amazonInSellerExportToCanonicalBuckets(exportMonth, sellerCogs, adsOnSeller)
        : settlementMonth
          ? sellerBucketsWithoutAds(settlementMonth)
          : null
    // What to call that half in a note, in the terms of whichever source
    // states it.
    const marketplaceSays = exportMonth
      ? `${formatCurrencyFull(exportMonth.netSalesInr)} of Seller Central net sales on ` +
        `${exportMonth.netUnitsSoldQty.toLocaleString('en-IN')} unit(s)`
      : settlementMonth
        ? `${formatCurrencyFull(settlementMonth.settlementTotal)} settled on Seller Central across ` +
          `${settlementMonth.units} unit(s)`
        : null
    const share = amazonInHalfShare(vendorMonth, sellerNetSales, half)
    const vendor = half === 'seller' ? undefined : vendorMonth

    // Amazon India is one channel over two businesses, and the wholesale one
    // is the larger by an order of magnitude. Where its month is on file the
    // statement shown is its own — a marketplace waterfall has no line for a
    // trade margin or a contra-COGS claim, and a settlement waterfall has no
    // line for the other side's referral fees. The Master P&L still gets
    // both, because the canonical below adds them.
    if (vendor) {
      const cogs = vendorCogs(vendor, month, inputs)
      const adSpend = adsOnVendor
      const otherCosts = computeAllocatedOtherCosts(inputs, channel, month, share)
      const values = applyAmazonInVendorOtherCosts(
        computeAmazonInVendorPnl(vendor, cogs, adSpend),
        otherCosts,
      )

      const vendorBuckets = amazonInVendorToCanonicalBuckets(vendor, cogs, adSpend)
      const marketplace = half === 'both' ? marketplaceBuckets() : null
      const canonicalLines = computeSubtotals(
        withAllocatedOpex(
          marketplace ? addBuckets(vendorBuckets, marketplace) : vendorBuckets,
          inputs, channel, month, share,
        ),
      )

      const notes: string[] = []
      // Said only when there is an allocation to divide. Amazon India's is
      // zero today — the weights come from order rows and this channel's
      // statements carry none — and "carries 16% of the fixed expenses"
      // against a zero on the line reads as a contradiction.
      const sharedOpex = otherCosts !== 0
        ? ` This half carries ${(share * 100).toFixed(1)}% of the month's fixed expenses, its share of the two by `
          + 'net revenue, so the halves still add to Amazon India.'
        : ''
      if (marketplaceSays && half === 'both') {
        notes.push(
          `The statement above is Vendor Central only. ${marketplaceSays} in ${month} is in the Master P&L ` +
          'alongside it, but the marketplace is a different business on a different revenue basis and has its own ' +
          'fees — switch to Seller Central to read it on its own.',
        )
      } else if (marketplaceSays) {
        notes.push(`Vendor Central on its own. ${marketplaceSays} in ${month} is not below.${sharedOpex}`)
      }
      if (cogs.uncostedAsins > 0) {
        notes.push(
          `${cogs.uncostedAsins} ASIN(s) on ${cogs.uncostedUnits} unit(s) have no cost behind them, so their ` +
          `share of COGS is estimated. Link them on the SKU Mapping screen to price the month outright.`,
        )
      }
      if (!vendor.ixd) {
        notes.push(
          `No inward cross-dock charge is on file for ${month}, so the statement charges none. It arrives two ways ` +
          'and either will do: RK World\u2019s claim invoice, which is what they deducted, or the IXD workbook, ' +
          'which is the units behind it.',
        )
      } else if (vendor.ixd.invoice) {
        const implied = vendor.ixd.unitsUnpacked * vendor.ixd.ratePerUnit
        notes.push(
          `The cross-dock charge is ${formatCurrencyFull(vendor.ixd.invoice.amount)} on invoice ` +
          `${vendor.ixd.invoice.number}, which is what Amazon deducted` +
          (vendor.ixd.unitsUnpacked > 0
            ? `, against ${vendor.ixd.unitsUnpacked.toLocaleString('en-IN')} unit(s) unpacked in the workbook` +
              (Math.abs(implied - vendor.ixd.invoice.amount) > 1
                ? ` — which at ${formatCurrencyFull(vendor.ixd.ratePerUnit)} a unit comes to ` +
                  `${formatCurrencyFull(implied)}, ${formatCurrencyFull(Math.abs(implied - vendor.ixd.invoice.amount))} ` +
                  'from the invoice. The invoice is charged; the gap is worth taking up with them.'
                : ', which agrees with it.')
            : '. No workbook is on file, so the units behind it are not known.'),
        )
      }
      if (vendor.marginClosedPct > 0 && vendor.marginAchievedPct < vendor.marginClosedPct) {
        notes.push(
          `${month} realised ${(vendor.marginAchievedPct * 100).toFixed(2)}% against the ` +
          `${(vendor.marginClosedPct * 100).toFixed(2)}% contracted, so ` +
          `${formatCurrencyFull(vendor.ccogsClaimed)} was billed back as contra-COGS` +
          (vendor.ccogsFinal === undefined
            ? '. The statement charges the claim, since no settlement is recorded against it.'
            : `, settled at ${formatCurrencyFull(vendor.ccogsFinal)}, which is what the statement charges` +
              (vendor.ccogsInvoice
                ? ` — the figure on invoice ${vendor.ccogsInvoice.number}, which is what they deducted.`
                : '.')),
        )
      }

      return {
        channel, month,
        canonical: { channel, month, lines: canonicalLines },
        native: { lineDefs: AMAZON_IN_VENDOR_LINE_DEFS, values, currency: 'INR' },
        notes,
      }
    }

    // Seller Central, as the export states the whole month.
    if (half !== 'vendor' && exportMonth) {
      const otherCosts = computeAllocatedOtherCosts(inputs, channel, month, share)
      const values = applyAmazonInSellerExportOtherCosts(
        computeAmazonInSellerExportPnl(exportMonth, sellerCogs, adsOnSeller),
        otherCosts,
      )
      const notes: string[] = []

      // Amazon computes its own Net proceeds for the month. A gap against it
      // is a charge in the file this build has not learnt to read, and it is
      // the one number that says whether the fees below are the whole of what
      // was charged.
      const gap = values.netProceedsDiff
      if (Math.abs(gap) > 1) {
        notes.push(
          `Net sales less every fee read here comes to ${formatCurrencyFull(Math.abs(gap))} ` +
          `${gap > 0 ? 'more' : 'less'} than Amazon's own Net proceeds column for ${month}. That difference is a ` +
          'charge in the export this build has not read, so the fees below are short by it. Send the file over and ' +
          'the column will be named.',
        )
      }
      if (sellerCogs.estimatedWholeMonth) {
        notes.push(
          `${month}'s cost of goods is estimated as a share of sales, because this month's export was read before ` +
          'units per SKU were stored. Upload the Product Profitability export for the month again and the cost is ' +
          'priced from the cost sheet, SKU by SKU.',
        )
      } else if (sellerCogs.uncostedSkus > 0) {
        notes.push(
          `${sellerCogs.uncostedSkus} MSKU(s) on ${sellerCogs.uncostedUnits.toLocaleString('en-IN')} unit(s) have ` +
          'no cost behind them, so their share of COGS is estimated. Link them on the SKU Mapping screen to price ' +
          'the month outright.',
        )
      }
      if (settlementMonth) {
        notes.push(
          `This statement is the Product Profitability export, which states the whole month. The settlement ` +
          `report(s) on file for ${month} carry ${formatCurrencyFull(settlementMonth.settlementTotal)} of deposits ` +
          `across ${settlementMonth.settlementIds.length} settlement period(s) — upload every fortnightly ` +
          'settlement for the month to tie this to the cash as well.',
        )
      } else {
        notes.push(
          `No settlement report is on file for ${month}, so nothing ties this statement to what Amazon actually ` +
          'deposited. The export is Amazon\u2019s own and reconciles against its Net proceeds column; the settlement ' +
          'is the cash.',
        )
      }
      // One AMC account lifts both halves and the channel charges it once, on
      // the wholesale statement. Advertising Amazon billed inside this export
      // is different money and is on the statement — if both ever appear, say
      // so rather than letting the same spend be counted twice.
      const exportAds = -values.totalAdvertising - adsOnSeller
      if (exportAds > 0 && channelAds > 0) {
        notes.push(
          `This export bills ${formatCurrencyFull(exportAds)} of advertising itself, and ` +
          `${formatCurrencyFull(channelAds)} is on file for ${month} from the ads reports. Both are charged above; ` +
          'check they are not the same rupees twice over before reading the margin.',
        )
      } else if (adsOnSeller > 0) {
        notes.push(
          `${formatCurrencyFull(adsOnSeller)} of campaign spend is charged here, from the ads reports — the whole ` +
          `channel's, because ${month} has no Vendor Central statement to carry it. One ad account lifts both ` +
          'halves, so this is the only place it can go without going missing. But it is also lifting a wholesale ' +
          'half that is not in this statement, so every margin below this line is understated until that month\u2019s ' +
          'NPPM file is in.',
        )
      } else if (vendorMonth) {
        notes.push(
          `Seller Central on its own. Vendor Central invoiced ${formatCurrencyFull(vendorMonth.invoiceValue)} in ` +
          `${month} on its own statement, and the channel's advertising is charged there because one AMC account ` +
          `lifts both halves — so this half shows none.` +
          (otherCosts !== 0
            ? ` It carries ${(share * 100).toFixed(1)}% of the month's fixed expenses, its share of the two by net revenue.`
            : ''),
        )
      }

      return {
        channel, month,
        canonical: {
          channel, month,
          lines: computeSubtotals(
            withAllocatedOpex(
              amazonInSellerExportToCanonicalBuckets(exportMonth, sellerCogs, adsOnSeller),
              inputs, channel, month, share,
            ),
          ),
        },
        native: { lineDefs: amazonInSellerExportLineDefs(exportMonth), values, currency: 'INR' },
        notes,
      }
    }

    // No export for the month: the settlement report is all there is.
    const imported = half === 'vendor' ? undefined : settlementMonth
    if (imported) {
      // The settlement report says what Amazon paid, never what the goods
      // cost. COGS is priced here from the order rows at the month's own
      // cost, so a corrected cost sheet restates the month.
      const recomputed = recomputedCogs(channel, month, inputs)
      // Sponsored Products is billed separately and never appears in a
      // settlement, so it comes from where the Ads screens keep it. One
      // figure, one source — and one side: the month's spend is bought
      // through a single AMC account that lifts both halves, so where a
      // Vendor Central month is on file it is charged there and this half
      // shows none. Otherwise the same rupees would appear twice over.
      const adSpend = inputs.marketing[channel]?.ads ?? 0
      const facts: AmazonInSellerPnlFacts = {
        ...imported,
        ...(recomputed ? { cogsPriced: recomputed.priced, cogsUnpriced: recomputed.unpriced } : {}),
        ads: vendorMonth ? 0 : (imported.ads || adSpend),
      }
      const otherCosts = computeAllocatedOtherCosts(inputs, channel, month, share)
      const values = applyAmazonInSellerOtherCosts(computeAmazonInSellerPnl(facts), otherCosts)
      const notes: string[] = []
      if (!recomputed) {
        notes.push(
          `No Amazon India order rows are on file for ${month}, so the statement shows no cost of goods. Upload ` +
          'the All Orders report for the month — the settlement file carries the money, never what the goods cost.',
        )
      }
      if (Math.abs(values.unrecognised) > 1) {
        notes.push(
          `${formatCurrencyFull(Math.abs(values.unrecognised))} of ${month}'s settlement is on charge descriptions ` +
          'this build does not recognise. It is counted, so the month still ties to the deposit, but it is not on a ' +
          'named line — send the settlement file over and the descriptions will be added.',
        )
      }
      // Amazon India is one channel with two businesses under it, and only
      // one of them has a statement. A month with a Seller Central settlement
      // returns here with Vendor Central's shipments nowhere in it, which on
      // a channel whose wholesale side is the larger of the two understates
      // the month by most of itself.
      const vendorSales = inputs.salesRecords
        .filter((r) => r.channel === 'amazon_in_vendor' && r.orderDate.slice(0, 7) === month)
        .reduce((sum, r) => sum + r.grossSales, 0)
      // Only where the wholesale half has no statement for the month. Once it
      // has one this would be saying the opposite of what is true: that the
      // shipments are nowhere, when they are on their own statement and in
      // the channel total beside it.
      if (vendorSales > 0 && !vendorMonth) {
        notes.push(
          `This is the Seller Central settlement only. ${formatCurrencyFull(vendorSales)} of Vendor Central ` +
          `shipments are on file for ${month} and none of it is below — that is a wholesale business with its ` +
          'own revenue basis and its own charges, and it has no statement of its own yet. Amazon India is ' +
          'understated by roughly that much until it gets one.',
        )
      }
      if (Math.abs(values.settlementCheck) > 0.05) {
        notes.push(
          `${month}'s statement does not tie to what Amazon deposited: a gap of ` +
          `${formatCurrencyFull(values.settlementCheck)}. Every figure below the sales lines should be treated as ` +
          'suspect until that is explained.',
        )
      }
      if (vendorMonth) {
        notes.push(
          `Seller Central on its own. Vendor Central invoiced ${formatCurrencyFull(vendorMonth.invoiceValue)} in ` +
          `${month} on its own statement, and the channel's advertising is charged there because one AMC account ` +
          `lifts both halves — so this half shows none.` +
          (otherCosts !== 0
            ? ` It carries ${(share * 100).toFixed(1)}% of the month's fixed expenses, its share of the two by net revenue.`
            : ''),
        )
      }
      return {
        channel, month,
        canonical: { channel, month, lines: computeSubtotals(withAllocatedOpex(amazonInSellerToCanonicalBuckets(facts), inputs, channel, month, share)) },
        native: { lineDefs: AMAZON_IN_SELLER_LINE_DEFS, values, currency: 'INR' },
        notes,
      }
    }
  }

  if (channel === 'myntra') {
    const imported = inputs.facts.myntraFacts?.find((f) => f.month === month)
    if (imported) {
      // Myntra states what it charged, never what the goods cost. COGS is
      // priced here, from the order rows at the month's effective cost, so a
      // corrected cost sheet restates the month instead of leaving whatever
      // was frozen at upload time.
      const recomputed = recomputedCogs(channel, month, inputs)
      // Myntra's P&L report carries no advertising at all, so the figure comes
      // from the PLA campaign report, the same way every other channel's does.
      // A figure already on the facts wins, since that was entered against
      // this month deliberately.
      const adSpend = inputs.marketing[channel]?.ads ?? 0
      const facts = {
        ...imported,
        ...(recomputed ? { cogsPriced: recomputed.priced, cogsUnpriced: recomputed.unpriced } : {}),
        myntraAds: imported.myntraAds || adSpend,
      }
      const otherCosts = computeAllocatedOtherCosts(inputs, channel, month)
      const values = applyMyntraOtherCosts(computeMyntraPnl(facts), otherCosts)
      const notes: string[] = []
      if (facts.myntraAds === 0) {
        notes.push(
          `No Myntra advertising is on file for ${month}, so the statement shows none. Myntra's P&L report ` +
          'carries no advertising line — upload the PLA campaign report, whose ad_spend column is the only ' +
          'place this channel\'s spend comes from.',
        )
      }
      if (!recomputed) {
        notes.push(
          `No Myntra order rows are on file for ${month}, so the statement shows no cost of goods. Re-upload this ` +
          `month's P&L report — its SKU_Detail sheet is what the cost is priced from.`,
        )
      }
      if (recomputed && recomputed.uncostedUnits > 0) {
        const share = recomputed.total > 0 ? (recomputed.unpriced / recomputed.total) * 100 : 0
        const shown = recomputed.uncostedSkus.slice(0, 8).join(', ')
        const rest = recomputed.uncostedSkus.length - 8
        notes.push(
          `${recomputed.uncostedSkus.length} SKU(s) sold on Myntra in ${month} have no cost on file, covering ` +
          `${recomputed.uncostedUnits.toLocaleString('en-IN')} unit(s). Their cost is estimated ` +
          `${recomputed.method === 'average-unit-cost' ? 'at what a costed unit averaged this month' : 'at 25% of what they sold for'}, ` +
          `which is ${share.toFixed(0)}% of the COGS shown. Add costs for ${shown}${rest > 0 ? ` and ${rest} more` : ''} to price them properly.`,
        )
      }
      return {
        channel, month,
        canonical: { channel, month, lines: computeSubtotals(withAllocatedOpex(myntraToCanonicalBuckets(facts), inputs, channel, month)) },
        native: { lineDefs: MYNTRA_LINE_DEFS, values, currency: 'INR' },
        notes,
      }
    }
  }

  if (channel === 'blinkit') {
    const facts = inputs.facts.blinkitFacts?.find((f) => f.month === month)
    if (facts) {
      // Blinkit's archive says what Blinkit charged, never what the goods
      // cost us, so COGS is priced here from the order rows at the month's
      // effective cost — a corrected cost sheet then restates the month
      // instead of leaving whatever was frozen at upload time.
      const recomputed = recomputedCogs(channel, month, inputs)
      const cogs = recomputed ? recomputed.total : 0
      const otherCosts = computeAllocatedOtherCosts(inputs, channel, month)
      // Advertising is billed separately from the payout, so it comes from
      // where the Ads screens keep it. One figure, one source.
      const adSpend = inputs.marketing[channel]?.ads ?? 0
      const notes: string[] = []
      if (!recomputed) {
        notes.push(
          `No Blinkit order rows are on file for ${month}, so the statement shows no cost of goods. Re-upload the ` +
          'payout archive — its Order_level_charges workbook is what the cost is priced from.',
        )
      }
      if (recomputed && recomputed.uncostedUnits > 0) {
        // Blinkit's archive carries only its own item codes, so until those
        // are linked on SKU Mapping the cost of a Blinkit unit is unknown —
        // and that has to be said, not estimated past.
        const shown = recomputed.uncostedSkus.slice(0, 8).join(', ')
        const rest = recomputed.uncostedSkus.length - 8
        notes.push(
          `${recomputed.uncostedSkus.length} Blinkit item code(s) sold in ${month} have no cost on file, covering ` +
          `${recomputed.uncostedUnits.toLocaleString('en-IN')} unit(s). Blinkit's file carries no seller SKU, so link ` +
          `${shown}${rest > 0 ? ` and ${rest} more` : ''} on SKU Mapping to price them properly.`,
        )
      }
      return {
        channel, month,
        canonical: {
          channel, month,
          lines: computeSubtotals(withAllocatedOpex(blinkitToCanonicalBuckets(facts, cogs, adSpend), inputs, channel, month)),
        },
        native: { lineDefs: BLINKIT_LINE_DEFS, values: computeBlinkitPnl(facts, cogs, otherCosts, adSpend), currency: 'INR' },
        notes,
      }
    }
  }

  if (channel === 'amazon_ae') {
    const facts = inputs.facts.amazonAeFacts?.find((f) => f.month === month)
    if (facts) {
      const rate = (inputs.fxRate ?? DEFAULT_FX_INR).AED
      // Amazon does not know what the goods cost us, so COGS is priced from
      // the order rows at the month's effective cost — a corrected cost sheet
      // then restates the month instead of leaving whatever was frozen at
      // upload time. It is a rupee cost; the statement reads in dirhams, so
      // it is divided at the month's rate rather than at upload day's.
      const recomputed = recomputedCogs(channel, month, inputs)
      const cogsInr = recomputed ? recomputed.total : (facts.cogsSourceInr ?? 0)
      const otherCostsInr = computeAllocatedOtherCosts(inputs, channel, month)
      // The UAE export carries no advertising column, so the console's
      // monthly cost report is the only place this channel's spend is
      // stated. In rupees here, because the marketing roll-up has already
      // brought the dirhams across at this month's rate.
      const adsInr = inputs.marketing[channel]?.ads ?? 0

      const notes: string[] = []
      // Said on the statement, not only at upload: anyone reading the P&L in
      // three months' time has to know why there is one fee line and not ten.
      notes.push(
        'Amazon exported this month without its fee columns, so what Amazon took is one figure — net sales less ' +
        'the Net proceeds Amazon states — and not a breakdown. A download carrying the fee columns will split it ' +
        'without changing any of these totals.',
      )
      if (recomputed && recomputed.uncostedUnits > 0) {
        const shown = recomputed.uncostedSkus.slice(0, 8).join(', ')
        const rest = recomputed.uncostedSkus.length - 8
        notes.push(
          `${recomputed.uncostedSkus.length} MSKU(s) sold in ${month} have no cost on file, covering ` +
          `${recomputed.uncostedUnits.toLocaleString('en-IN')} unit(s). Add ` +
          `${shown}${rest > 0 ? ` and ${rest} more` : ''} to the Product Master to price them properly.`,
        )
      }

      return {
        channel, month,
        canonical: {
          channel, month,
          lines: computeSubtotals(
            withAllocatedOpex(amazonAeToCanonicalBuckets(facts, rate, cogsInr, adsInr), inputs, channel, month),
          ),
        },
        native: (() => {
          const aed = computeAmazonAePnl(
            facts,
            rate !== 0 ? cogsInr / rate : 0,
            rate !== 0 ? otherCostsInr / rate : 0,
            rate !== 0 ? adsInr / rate : 0,
          )
          const showInr = inputs.currencyView === 'INR'
          return {
            lineDefs: AMAZON_AE_LINE_DEFS,
            values: showInr ? amazonAeValuesInInr(aed, rate) : aed,
            currency: showInr ? ('INR' as const) : ('AED' as const),
          }
        })(),
        notes,
      }
    }
  }

  if (channel === 'purplle') {
    const facts = inputs.facts.purplleFacts?.find((f) => f.month === month)
    if (facts) {
      // Purplle does not know what the goods cost, so COGS is priced from the
      // order rows at the month's effective cost where they exist, and from
      // what the Product Master held at upload otherwise.
      const recomputed = recomputedCogs(channel, month, inputs)
      const cogs = recomputed ? recomputed.total : facts.cogsSourceInr
      const otherCosts = computeAllocatedOtherCosts(inputs, channel, month)

      // On the statement, not only at upload: whoever reads this in three
      // months has to know why there is no commission line.
      const notes: string[] = [
        'Purplle sends a sales file, not a settlement — it states no commission, logistics, payment or return ' +
        'charges — so this statement runs to gross profit and names what Purplle took as not supplied. Nothing ' +
        'above that line changes when the payout statement arrives.',
      ]
      if (facts.marketingStated) {
        notes.push(
          'Advertising is the "Marketing" figure written above the table in Purplle’s file rather than a column of ' +
          'it. Worth checking against Purplle’s invoice.',
        )
      }
      if (recomputed && recomputed.uncostedUnits > 0) {
        const shown = recomputed.uncostedSkus.slice(0, 8).join(', ')
        const rest = recomputed.uncostedSkus.length - 8
        notes.push(
          `${recomputed.uncostedSkus.length} Purplle SKU code(s) sold in ${month} have no cost on file, covering ` +
          `${recomputed.uncostedUnits.toLocaleString('en-IN')} unit(s). Link ` +
          `${shown}${rest > 0 ? ` and ${rest} more` : ''} on Catalogue ▸ SKU Mapping to price them.`,
        )
      }

      return {
        channel, month,
        canonical: {
          channel, month,
          lines: computeSubtotals(withAllocatedOpex(purplleToCanonicalBuckets(facts, cogs), inputs, channel, month)),
        },
        native: { lineDefs: PURPLLE_LINE_DEFS, values: computePurpllePnl(facts, cogs, otherCosts), currency: 'INR' },
        notes,
      }
    }
  }

  if (channel === 'swiggy_instamart') {
    const facts = inputs.facts.swiggyInstamartFacts?.find((f) => f.month === month)
    if (facts) {
      const recomputed = recomputedCogs(channel, month, inputs)
      const cogs = recomputed ? recomputed.total : facts.cogsSourceInr
      const otherCosts = computeAllocatedOtherCosts(inputs, channel, month)

      // A month stored before the trade margin was computed carries none, and
      // reads as though Swiggy took nothing. Saying so is the point: the
      // revenue above is MRP less GST, with the 25% still in it.
      const marginStated = facts.marginInr !== undefined
      const notes: string[] = [
        marginStated
          ? `Swiggy's trade margin of ${((facts.marginPct ?? 0) * 100).toFixed(0)}% inclusive on MRP comes from the agreed ` +
            'terms and purchase order FC5PO365689, which proves it line by line. It is deducted from revenue rather ' +
            'than charged below gross profit, because we invoice MRP less the margin and the rest was never ours.'
          : '⚠ This month was read before Swiggy\'s trade margin was modelled, so no margin is deducted and the ' +
            'revenue above is GMV less GST with Swiggy\'s 25% still in it. Upload the month\'s sales report again ' +
            'to restate it — the terms are proved line by line on purchase order FC5PO365689.',
        'Beyond that margin the report carries no fulfilment, payment or return charge, and on a return-to-vendor ' +
        'basis no record of stock sent back. GST comes out at each item’s own rate from that purchase order; the ' +
        'report itself states none.',
      ]
      if ((facts.marketingContributionInr ?? 0) > 0) {
        notes.push(
          `Marketing contribution of ${((facts.marketingContributionPct ?? 0) * 100).toFixed(0)}% of MRP sales applies ` +
          'for the first six months from launch, taken here from the date of the first purchase order on file.',
        )
      }
      if (recomputed && recomputed.uncostedUnits > 0) {
        const shown = recomputed.uncostedSkus.slice(0, 8).join(', ')
        const rest = recomputed.uncostedSkus.length - 8
        notes.push(
          `${recomputed.uncostedSkus.length} Swiggy item code(s) sold in ${month} have no cost on file, covering ` +
          `${recomputed.uncostedUnits.toLocaleString('en-IN')} unit(s). Link ` +
          `${shown}${rest > 0 ? ` and ${rest} more` : ''} on Catalogue ▸ SKU Mapping to price them.`,
        )
      }

      return {
        channel, month,
        canonical: {
          channel, month,
          lines: computeSubtotals(
            withAllocatedOpex(swiggyInstamartToCanonicalBuckets(facts, cogs), inputs, channel, month),
          ),
        },
        native: {
          lineDefs: SWIGGY_LINE_DEFS,
          values: computeSwiggyInstamartPnl(facts, cogs, otherCosts),
          currency: 'INR',
        },
        notes,
      }
    }
  }

  if (channel === 'meesho') {
    const basis = inputs.meeshoBasis ?? 'order'
    // A month stored under the older, thinner shape is treated as absent
    // rather than rendered as if it were complete — a half-read P&L is worse
    // than an obviously missing one.
    const imported = inputs.facts.meeshoFacts.find(
      (f) => f.month === month && f.basis === basis && f.schemaVersion === 3,
    )
    if (imported) {
      // COGS is recomputed from order rows at the month's effective cost
      // where those rows exist, since the imported figure was priced at
      // whatever the Product Master held on upload day. The three-way split
      // is preserved, and only the order basis can be recomputed.
      const recomputed = basis === 'order' ? recomputedMeeshoCogs(month, imported, inputs) : null
      const facts =
        recomputed && !('note' in recomputed)
          ? {
              ...imported,
              cogsUnitsSold: recomputed.unitsSold,
              cogsRtoWriteOff: recomputed.rtoWriteOff,
              cogsReturnWriteOff: recomputed.returnWriteOff,
            }
          : imported
      const otherCosts = computeAllocatedOtherCosts(inputs, channel, month)
      const packaging = inputs.packagingPerShipmentInr
      const values = applyMeeshoOtherCosts(computeMeeshoPnl(facts, 0, packaging), otherCosts)
      const canonicalLines = computeSubtotals(
        withAllocatedOpex(meeshoToCanonicalBuckets(facts, packaging), inputs, channel, month),
      )
      return {
        channel, month,
        canonical: { channel, month, lines: canonicalLines },
        native: { lineDefs: MEESHO_LINE_DEFS, values, currency: 'INR' },
        notes: recomputed && 'note' in recomputed ? [recomputed.note] : [],
      }
    }
  }

  // Every other channel (and these before any real facts are uploaded) falls
  // back to the generic template built from order-level sales records.
  //
  // The fallback used to be silent, which is how a channel whose settlement
  // events were never stored went months reading as though its statement were
  // the real one. A template built from order rows is a different figure on a
  // different basis — it cannot show the fees the settlement states, and its
  // Gross Sales will not tie to the file's own column — so a month on it says
  // so rather than letting the reader assume otherwise.
  const generic = buildChannelPnl(
    inputs.salesRecords, inputs.skuMaster, inputs.fixedExpenses, channel, month, inputs.marketing, inputs.cogs,
    inputs.facts, inputs.fxRate,
  )
  // The channel's own charges, on the generic template as on every native
  // one. A channel without a statement is the likeliest to be billed off to
  // one side, so this is the last path that should miss them.
  const ownCharges = channelChargesTotal(inputs.channelCharges, channel, month)
  const canonical = ownCharges === 0
    ? generic
    : { ...generic, lines: computeSubtotals({ ...generic.lines, channelCharges: ownCharges }) }
  const source = NATIVE_STATEMENT_SOURCE[channel]
  return {
    channel, month, canonical,
    notes: source
      ? [`No settlement report is stored for ${channelLabel(channel)} in ${month}, so this is built from the order rows instead. Its Gross Sales will not tie to the ${source}. Upload that report for the month to replace it.`]
      : [],
  }
}

/** What a channel's own statement is read from, for the six that have one. A
 * channel missing from here has no native statement to be missing. */
const NATIVE_STATEMENT_SOURCE: Partial<Record<BusinessChannelId, string>> = {
  meesho: 'aggregated payment file',
  blinkit: 'monthly payout archive',
  flipkart: 'SKU-level P&L export',
  myntra: 'P&L report',
  nykaa: 'monthly sales file',
  amazon_us: 'Product Profitability export',
  amazon_ae: 'Product Profitability export',
  amazon_in: 'settlement report',
  purplle: 'monthly sales file',
  swiggy_instamart: 'monthly sales report',
}

export function buildAllChannelPnlViews(channels: BusinessChannelId[], month: string, inputs: ChannelPnlViewInputs): ChannelPnlView[] {
  return channels.map((c) => buildChannelPnlView(c, month, inputs))
}
