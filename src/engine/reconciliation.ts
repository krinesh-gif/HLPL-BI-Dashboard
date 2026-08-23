import type { BusinessChannelId } from '@/config/channels'
import { channelOfSource } from '@/config/channels'
import { NATIVE_PNL_ASSUMPTIONS } from '@/config/nativePnlAssumptions'
import { toMonthKey } from '@/lib/format'
import type { CanonicalSalesRecord } from '@/data/models'
import {
  orderBasisNetSales,
  settlementBasisNetSales,
  type ChannelFacts,
  type NetSalesFigure,
} from './netSales'

/**
 * Explains why a channel's order-level Net Sales differs from the Net Sales on
 * its settlement report.
 *
 * The goal is not to force the two numbers together. They measure different
 * things and a standing gap is normal: an order placed on the 30th settles next
 * month, a return of July's order lands in August. The goal is that the gap has
 * a stated size and named candidate causes, so that when it changes shape
 * someone can tell business-as-usual from a broken import.
 *
 * A note on honesty. Only some causes can be measured exactly. Late-month
 * orders and the returns-timing difference both draw on the same rupees, so
 * adding them up and calling the remainder "unexplained" would invent a
 * precision the data does not support. Causes are therefore split:
 *
 *  - DEFINITIVE causes account for a known part of the gap and are subtracted
 *    from the residual.
 *  - CANDIDATE causes are sized and shown, but do not reduce the residual,
 *    because they overlap each other.
 */

export interface ReconciliationCause {
  key: string
  label: string
  /**
   * Signed contribution to (settlement - order), in rupees. Negative means this
   * cause pushes the settlement figure below the order figure.
   */
  amount: number
  /** True when this cause accounts for a known, non-overlapping part of the
   * gap. False when it is a sized candidate that may overlap other causes. */
  definitive: boolean
  /** False when the cause is real but cannot be measured from the data on hand. */
  measurable: boolean
  explanation: string
}

export interface ChannelReconciliation {
  channel: BusinessChannelId
  month: string
  orderBasis: NetSalesFigure
  settlementBasis: NetSalesFigure | null
  /** settlement - order. Negative means settlement reports less than the orders do. */
  difference: number
  differencePct: number | null
  causes: ReconciliationCause[]
  /** The gap left after the definitive causes. The candidate causes are the
   * places to look for it. */
  residual: number
  status: 'no-settlement-report' | 'no-order-report' | 'reconciled' | 'gap'
  /**
   * Set when the settlement report looks like it covers only part of the
   * month. Because settlement is the authoritative source for Net Sales, a
   * partial file makes every figure on the channel understate — the opposite
   * of the problem this whole area was built to fix, and worth saying loudly
   * rather than leaving to be inferred from a percentage.
   */
  partialSettlementWarning: string | null
}

/** How far below the order rows the settlement gross has to fall before the
 * file is more likely incomplete than merely lagging. A week of settlement lag
 * on a month is roughly a quarter; a third is past what timing explains. */
const PARTIAL_SETTLEMENT_THRESHOLD = 1 / 3

/** A gap smaller than this share of settlement net sales is rounding, not a
 * finding worth chasing. */
const TOLERANCE_PCT = 0.5

/** How many days at the end of a month are treated as likely to settle late. */
const SETTLEMENT_LAG_DAYS = 7

function inr(r: CanonicalSalesRecord, fxRate: number): number {
  return r.netSales * (r.currency === 'USD' ? fxRate : 1)
}

export function reconcileChannelMonth(
  records: CanonicalSalesRecord[],
  channel: BusinessChannelId,
  month: string,
  facts: ChannelFacts,
  fxRate: number = NATIVE_PNL_ASSUMPTIONS.usdToInrRate,
): ChannelReconciliation {
  const monthRecords = records.filter((r) => channelOfSource(r.channel) === channel && toMonthKey(r.orderDate) === month)
  const orderBasis = orderBasisNetSales(monthRecords, fxRate)
  const settlementBasis = settlementBasisNetSales(channel, month, facts, fxRate)

  if (!settlementBasis) {
    return {
      channel, month, orderBasis, settlementBasis: null,
      difference: 0, differencePct: null, causes: [], residual: 0,
      status: 'no-settlement-report', partialSettlementWarning: null,
    }
  }

  const difference = settlementBasis.netSales - orderBasis.netSales
  const causes: ReconciliationCause[] = []

  // --- Definitive: no order report at all ----------------------------------
  // Nothing to compare against, so the entire gap is this and nothing else.
  if (orderBasis.orders === 0) {
    causes.push({
      key: 'no-order-report',
      label: 'No order-level rows uploaded for this channel and month',
      amount: settlementBasis.netSales,
      definitive: true,
      measurable: true,
      explanation:
        'The settlement report for this month is loaded but the order report is not. Every per-SKU, per-day and per-category figure for this channel and month reads zero until it is uploaded. This accounts for the whole difference.',
    })

    return {
      channel, month, orderBasis, settlementBasis,
      difference,
      differencePct: settlementBasis.netSales !== 0 ? 100 : null,
      causes, residual: 0,
      status: 'no-order-report', partialSettlementWarning: null,
    }
  }

  // --- Informational: cancelled orders -------------------------------------
  // Excluded from Net Sales on both sides. Reported because if anyone compares
  // these screens against a raw order export that counts cancellations, this is
  // the size of that difference.
  const cancelled = monthRecords.filter((r) => r.status === 'cancelled')
  if (cancelled.length > 0) {
    causes.push({
      key: 'cancelled',
      label: `${cancelled.length.toLocaleString('en-IN')} cancelled order line(s)`,
      amount: cancelled.reduce((s, r) => s + inr(r, fxRate), 0),
      definitive: false,
      measurable: true,
      explanation:
        'Cancelled orders never shipped and are never settled. Net Sales excludes them on both sides, so they do not contribute to this gap — this is what they would have added if they were counted.',
    })
  }

  // --- Candidate: settlement lag -------------------------------------------
  const lagStart = lastNDaysOfMonth(month, SETTLEMENT_LAG_DAYS)
  const lateOrders = monthRecords.filter((r) => r.status !== 'cancelled' && r.orderDate >= lagStart)
  if (lateOrders.length > 0) {
    causes.push({
      key: 'settlement-lag',
      label: `${lateOrders.length.toLocaleString('en-IN')} order line(s) placed in the last ${SETTLEMENT_LAG_DAYS} days of the month`,
      amount: -lateOrders.reduce((s, r) => s + inr(r, fxRate), 0),
      definitive: false,
      measurable: true,
      explanation:
        'Order reports are dated by when the order was placed; settlement reports by when the marketplace paid. Orders late in the month typically settle in the following month, appearing on the order side now and the settlement side later. This is the upper bound of that effect, not a defect.',
    })
  }

  // --- Candidate: returns timing -------------------------------------------
  const returnsGap = settlementBasis.returnsValue - orderBasis.returnsValue
  if (Math.abs(returnsGap) > 1) {
    causes.push({
      key: 'returns-timing',
      label:
        returnsGap > 0
          ? 'Settlement deducts more returns than the order rows do'
          : 'Order rows carry more returns than settlement deducts',
      amount: -returnsGap,
      definitive: false,
      measurable: true,
      explanation:
        'A return is deducted on the settlement report when the item physically comes back, often weeks after the sale and so in a later month than the order. A return of an earlier month\'s order reduces settlement Net Sales now with no matching order row in this month.',
    })
  }

  // --- Candidate: gross-side gap -------------------------------------------
  const grossGap = settlementBasis.grossSales - orderBasis.grossSales
  if (Math.abs(grossGap) > 1) {
    causes.push({
      key: 'gross-gap',
      label:
        grossGap > 0
          ? 'Settlement reports more gross sales than the order rows do'
          : 'Order rows report more gross sales than settlement does',
      amount: grossGap,
      definitive: false,
      measurable: true,
      explanation:
        grossGap > 0
          ? 'The settlement report covers sales the order report does not — usually orders from the previous month that settled in this one, or an order file covering only part of the month.'
          : 'The order report covers sales the settlement report does not — usually this month\'s later orders, which settle next month.',
    })
  }

  // --- Real but not measurable ---------------------------------------------
  causes.push({
    key: 'marketplace-adjustments',
    label: 'Marketplace adjustments booked only in settlement',
    amount: 0,
    definitive: false,
    measurable: false,
    explanation:
      'Compensation, claims, recovery, SPF rewards and penalty reversals appear only in the settlement file. They are carried as their own P&L lines rather than inside Net Sales, so they should not move this gap — but a sudden change in the gap is a reason to check them.',
  })

  const definitiveTotal = causes.filter((c) => c.definitive).reduce((s, c) => s + c.amount, 0)
  const residual = difference - definitiveTotal

  const differencePct =
    settlementBasis.netSales !== 0 ? (difference / Math.abs(settlementBasis.netSales)) * 100 : null

  // A settlement file downloaded before the month has fully settled contains
  // only part of it. Since settlement is what Net Sales is read from, that
  // silently understates the channel everywhere.
  const shortfall =
    orderBasis.grossSales > 0 ? (orderBasis.grossSales - settlementBasis.grossSales) / orderBasis.grossSales : 0
  const partialSettlementWarning =
    shortfall > PARTIAL_SETTLEMENT_THRESHOLD
      ? `The settlement report shows ${Math.round(shortfall * 100)}% less gross sales than the order rows for this month. ` +
        'That is more than settlement lag usually explains, so this file may cover only part of the month. ' +
        'Net Sales is read from it, so every figure for this channel would be understated. ' +
        'Re-download the settlement report once the month has fully settled and upload it again.'
      : null

  return {
    channel, month, orderBasis, settlementBasis,
    difference, differencePct, causes, residual,
    status: differencePct !== null && Math.abs(differencePct) <= TOLERANCE_PCT ? 'reconciled' : 'gap',
    partialSettlementWarning,
  }
}

/** ISO date of the first day of the last `n` days of a yyyy-mm month. */
function lastNDaysOfMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number)
  const daysInMonth = new Date(y, m, 0).getDate()
  const startDay = Math.max(1, daysInMonth - n + 1)
  return `${month}-${String(startDay).padStart(2, '0')}`
}

export function reconcileAllChannels(
  records: CanonicalSalesRecord[],
  channels: BusinessChannelId[],
  month: string,
  facts: ChannelFacts,
  fxRate: number = NATIVE_PNL_ASSUMPTIONS.usdToInrRate,
): ChannelReconciliation[] {
  return channels.map((c) => reconcileChannelMonth(records, c, month, facts, fxRate))
}
