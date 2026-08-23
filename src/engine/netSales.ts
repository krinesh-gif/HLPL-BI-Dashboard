import type { ChannelId } from '@/config/channels'
import { CHANNEL_MAP } from '@/config/channels'
import { NATIVE_PNL_ASSUMPTIONS } from '@/config/nativePnlAssumptions'
import { toMonthKey } from '@/lib/format'
import type {
  AmazonUsaPnlFacts,
  CanonicalSalesRecord,
  FlipkartPnlFacts,
  MeeshoPnlFacts,
} from '@/data/models'

/**
 * THE central Net Sales calculation.
 *
 * Every surface in the app — Overview, Channel dashboards, Master P&L, Channel
 * P&L, Investor MIS, Business Insight, Sales pages — must get its Net Sales
 * from this module and nowhere else. Before this existed each page summed the
 * numbers its own way, which is why the Meesho dashboard and the Meesho P&L
 * disagreed: they were not two views of one figure, they were two unrelated
 * calculations over two different datasets.
 *
 * ---------------------------------------------------------------------------
 * The definition
 * ---------------------------------------------------------------------------
 *
 *   Net Sales = Gross Sales - Discounts - Returns - Other revenue adjustments
 *
 * with three rules that are applied here and must not be re-applied or skipped
 * by any caller:
 *
 *  1. CANCELLED ORDERS ARE EXCLUDED. A cancelled order never shipped and never
 *     invoiced, so it is not revenue. Marketplaces never settle it either,
 *     which is precisely why including it made order-level totals drift away
 *     from settlement totals.
 *  2. EVERYTHING IS CONVERTED TO INR. Amazon USA rows are stored in USD.
 *     Summing them into a rupee total without converting overstated nothing
 *     visibly but made every consolidated figure meaningless.
 *  3. RETURNS ARE A DEDUCTION, NEVER A SEPARATE DATASET. Whichever basis is in
 *     use, the returned value is subtracted once and only once.
 */

/** Where a Net Sales figure was measured. */
export type NetSalesBasis =
  /** Summed from order-level rows uploaded from the marketplace's order report. */
  | 'order'
  /** Taken from the marketplace's own settlement/payment report for the month. */
  | 'settlement'

export interface NetSalesFigure {
  netSales: number
  grossSales: number
  discounts: number
  returnsValue: number
  units: number
  orders: number
  returnUnits: number
  rtoUnits: number
  /** Units that actually shipped — the denominator for RTO %. */
  shippedUnits: number
  /** Variable costs carried on the same rows, converted to INR here so no
   * caller has to sum records a second time (and get the currency wrong). */
  marketplaceFee: number
  shippingCost: number
  tax: number
  basis: NetSalesBasis
  /** Which report this came from, for display next to the number. */
  sourceLabel: string
  currency: 'INR'
}

export const EMPTY_FIGURE: NetSalesFigure = {
  netSales: 0,
  grossSales: 0,
  discounts: 0,
  returnsValue: 0,
  units: 0,
  orders: 0,
  returnUnits: 0,
  rtoUnits: 0,
  shippedUnits: 0,
  marketplaceFee: 0,
  shippingCost: 0,
  tax: 0,
  basis: 'order',
  sourceLabel: 'No data',
  currency: 'INR',
}

/** Statuses that represent revenue. A cancelled order is not one of them. */
export function countsAsRevenue(record: CanonicalSalesRecord): boolean {
  return record.status !== 'cancelled'
}

/** Rupee value of one record's fields, converting Amazon USA's USD rows. */
function fx(record: CanonicalSalesRecord, fxRate: number): number {
  return record.currency === 'USD' ? fxRate : 1
}

// ---------------------------------------------------------------------------
// Order basis
// ---------------------------------------------------------------------------

/**
 * Net Sales summed from order-level rows. This is the basis behind every
 * per-SKU, per-day and per-category figure, because settlement reports are
 * monthly totals and cannot be broken down that way.
 */
export function orderBasisNetSales(
  records: CanonicalSalesRecord[],
  fxRate: number = NATIVE_PNL_ASSUMPTIONS.usdToInrRate,
): NetSalesFigure {
  const figure: NetSalesFigure = { ...EMPTY_FIGURE, sourceLabel: 'Order reports' }

  for (const r of records) {
    if (!countsAsRevenue(r)) continue
    const rate = fx(r, fxRate)

    figure.grossSales += r.grossSales * rate
    figure.discounts += r.discount * rate
    // The normalizers already write netSales net of the row's own returns, so
    // the returned value is what gross minus discount leaves above it. Deriving
    // it keeps this identity exact rather than trusting two fields to agree:
    //   netSales === grossSales - discounts - returnsValue
    figure.returnsValue += (r.grossSales - r.discount - r.netSales) * rate
    figure.netSales += r.netSales * rate

    figure.units += r.quantity
    figure.orders += 1
    figure.returnUnits += r.returnUnits
    figure.rtoUnits += r.rtoUnits
    // An RTO unit was shipped and came back; a cancelled unit never shipped and
    // is already excluded above. So shipped units are simply the units on every
    // revenue-bearing row.
    figure.shippedUnits += r.quantity

    figure.marketplaceFee += r.marketplaceFee * rate
    figure.shippingCost += r.shippingCost * rate
    figure.tax += r.tax * rate
  }

  return figure
}

// ---------------------------------------------------------------------------
// Settlement basis
// ---------------------------------------------------------------------------

export interface ChannelFacts {
  flipkartFacts: FlipkartPnlFacts[]
  amazonUsaFacts: AmazonUsaPnlFacts[]
  meeshoFacts: MeeshoPnlFacts[]
}

/**
 * Net Sales as the marketplace itself reported it for the month. Returns null
 * when that channel has no settlement report for the month, which is the signal
 * to fall back to the order basis.
 *
 * Unit counts are absent here on purpose: settlement reports state money, not
 * units, and inventing a unit count from a different dataset is exactly the
 * kind of silent cross-contamination this module exists to stop.
 */
export function settlementBasisNetSales(
  channel: ChannelId,
  month: string,
  facts: ChannelFacts,
  fxRate: number = NATIVE_PNL_ASSUMPTIONS.usdToInrRate,
): NetSalesFigure | null {
  if (channel === 'meesho') {
    const f = facts.meeshoFacts.find((x) => x.month === month)
    if (!f) return null
    return {
      ...EMPTY_FIGURE,
      grossSales: f.grossSale,
      returnsValue: f.returns,
      netSales: f.grossSale - f.returns,
      basis: 'settlement',
      sourceLabel: 'Meesho settlement report',
    }
  }

  if (channel === 'flipkart') {
    const f = facts.flipkartFacts.find((x) => x.month === month)
    if (!f) return null
    return {
      ...EMPTY_FIGURE,
      grossSales: f.grossSales,
      returnsValue: f.grossSales - f.estimatedNetSales,
      netSales: f.estimatedNetSales,
      basis: 'settlement',
      sourceLabel: 'Flipkart SKU-level P&L',
    }
  }

  if (channel === 'amazon_us') {
    const f = facts.amazonUsaFacts.find((x) => x.month === month)
    if (!f) return null
    return {
      ...EMPTY_FIGURE,
      grossSales: f.grossSalesUsd * fxRate,
      returnsValue: (f.grossSalesUsd - f.netSalesUsd) * fxRate,
      netSales: f.netSalesUsd * fxRate,
      basis: 'settlement',
      sourceLabel: 'Amazon USA profitability report',
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// The one entry point
// ---------------------------------------------------------------------------

export interface NetSalesScope {
  records: CanonicalSalesRecord[]
  channel: ChannelId
  month: string
  facts: ChannelFacts
  fxRate?: number
}

/**
 * The authoritative Net Sales for one channel and month.
 *
 * The marketplace's own settlement report wins when it exists: it is the money
 * that actually moved, it is what the channel P&L is built from, and it is what
 * the finance team reconciles the bank against. Order-level rows are the
 * fallback, and the returned `basis` says which was used so the screen can show
 * it rather than leaving the reader to guess.
 *
 * Unit-based figures always come from the order rows even on a settlement
 * month, because settlement reports carry no unit counts.
 */
export function netSalesForChannelMonth(scope: NetSalesScope): NetSalesFigure {
  const fxRate = scope.fxRate ?? NATIVE_PNL_ASSUMPTIONS.usdToInrRate
  const monthRecords = scope.records.filter(
    (r) => r.channel === scope.channel && toMonthKey(r.orderDate) === scope.month,
  )
  const order = orderBasisNetSales(monthRecords, fxRate)
  const settlement = settlementBasisNetSales(scope.channel, scope.month, scope.facts, fxRate)

  if (!settlement) return order

  return {
    ...settlement,
    units: order.units,
    orders: order.orders,
    returnUnits: order.returnUnits,
    rtoUnits: order.rtoUnits,
    shippedUnits: order.shippedUnits,
    marketplaceFee: order.marketplaceFee,
    shippingCost: order.shippingCost,
    tax: order.tax,
  }
}

/** Adds two figures. The result's basis is 'settlement' only when every part
 * of it was settled, so a consolidated total can never claim more authority
 * than its weakest component. */
export function addFigures(a: NetSalesFigure, b: NetSalesFigure): NetSalesFigure {
  const bothSettled = a.basis === 'settlement' && b.basis === 'settlement'
  return {
    netSales: a.netSales + b.netSales,
    grossSales: a.grossSales + b.grossSales,
    discounts: a.discounts + b.discounts,
    returnsValue: a.returnsValue + b.returnsValue,
    units: a.units + b.units,
    orders: a.orders + b.orders,
    returnUnits: a.returnUnits + b.returnUnits,
    rtoUnits: a.rtoUnits + b.rtoUnits,
    shippedUnits: a.shippedUnits + b.shippedUnits,
    marketplaceFee: a.marketplaceFee + b.marketplaceFee,
    shippingCost: a.shippingCost + b.shippingCost,
    tax: a.tax + b.tax,
    basis: bothSettled ? 'settlement' : 'order',
    sourceLabel: bothSettled ? 'Settlement reports' : 'Mixed sources',
    currency: 'INR',
  }
}

/** Company-wide Net Sales for a month: every channel's authoritative figure,
 * added up. The Master P&L and the Overview both read this, so they cannot
 * drift apart. */
export function netSalesForMonth(
  records: CanonicalSalesRecord[],
  month: string,
  facts: ChannelFacts,
  channels: ChannelId[],
  fxRate: number = NATIVE_PNL_ASSUMPTIONS.usdToInrRate,
): NetSalesFigure {
  return channels
    .map((channel) => netSalesForChannelMonth({ records, channel, month, facts, fxRate }))
    .reduce(addFigures, { ...EMPTY_FIGURE, sourceLabel: 'All channels' })
}

// ---------------------------------------------------------------------------
// Derived metrics — defined once so no page invents its own variant
// ---------------------------------------------------------------------------

/** Average Selling Price. Net Sales per unit, per the agreed definition. */
export function asp(figure: NetSalesFigure): number | null {
  return figure.units > 0 ? figure.netSales / figure.units : null
}

/** Average Order Value. Net Sales per order. */
export function aov(figure: NetSalesFigure): number | null {
  return figure.orders > 0 ? figure.netSales / figure.orders : null
}

/** RTO as a share of shipped units. Null when nothing shipped, because 0% and
 * "nothing to measure" are different answers. */
export function rtoPct(figure: NetSalesFigure): number | null {
  return figure.shippedUnits > 0 ? (figure.rtoUnits / figure.shippedUnits) * 100 : null
}

/** Returns as a share of shipped units. */
export function returnPct(figure: NetSalesFigure): number | null {
  return figure.shippedUnits > 0 ? (figure.returnUnits / figure.shippedUnits) * 100 : null
}

export function channelLabel(channel: ChannelId): string {
  return CHANNEL_MAP[channel]?.label ?? channel
}
