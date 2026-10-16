import type { BusinessChannelId } from '@/config/channels'
import { BUSINESS_CHANNELS } from '@/config/channels'
import type { CanonicalSalesRecord, FixedExpenseEntry, NykaaPnlFacts } from '@/data/models'
import type { ChannelPnlView } from './channelPnlRouter'
import { buildChannelFeesStatement } from './feesStatement'
import { nykaaDiscountRecovered } from './nativePnl/nykaa'

/**
 * Whether a month is finished, and what is wrong with it if not.
 *
 * The monthly report goes to the team on a fixed date. A report sent from an
 * incomplete month is worse than no report: it reads as a statement of how
 * the business did, and a channel whose file nobody uploaded shows up as a
 * channel that sold nothing rather than as a gap. So the month is checked
 * before it is sent, and the same check is on screen all month so the gaps
 * are closed as they appear rather than discovered on the send date.
 *
 * Three kinds of finding, and the difference between them matters:
 *
 *  - A **blocker** makes a figure wrong or missing. A channel that traded
 *    last month and has filed nothing this month, a month with no fixed
 *    expenses, a foreign channel with no exchange rate. The report does not
 *    go out with one of these open.
 *
 *  - A **warning** is something the reader should know but which does not
 *    make the month untrue. Most of these are not invented here: the P&L
 *    router already explains every gap it worked around, month by month and
 *    channel by channel, and those explanations are the warnings.
 *
 *  - A **red flag** is a charge that deserves a decision, not a fix. Storage
 *    and ageing, the low-inventory-level fee, penalties, recalls, a channel
 *    trading at a negative contribution. Nothing is wrong with the data; the
 *    money is the problem.
 *
 * The thresholds are at the top of this file rather than buried in it,
 * because they are judgement and not arithmetic, and whoever disagrees with
 * one should be able to find it.
 */

/** Storage is rent on stock. Past this share of a channel's basis it stops
 * being a cost of doing business and becomes a stock decision. */
const STORAGE_PCT_OF_BASIS = 2
/** A storage bill that grew by this much, by both measures, against last
 * month. Both, so a charge of ₹120 against ₹60 does not shout. */
const STORAGE_GROWTH_PCT = 50
const STORAGE_GROWTH_MIN_INR = 2000
/** Any penalty or recall at all above this is worth a line; below it the
 * noise would bury the months that matter. */
const PENALTY_MIN_INR = 500

export type CloseSeverity = 'blocker' | 'warning'

export interface CloseItem {
  id: string
  severity: CloseSeverity
  /** What is missing, in the words of the person who has to fix it. */
  title: string
  detail: string
  /** Where it is fixed. */
  path: string
  actionLabel: string
  channel?: BusinessChannelId
}

export interface RedFlag {
  id: string
  title: string
  detail: string
  /** Signed as the statement states it: a charge is negative. Absent where
   * the flag is not about one number. */
  amountInr?: number
  channel?: BusinessChannelId
  path: string
}

export interface TopProduct {
  sku: string
  productName: string
  units: number
  netSales: number
  /** Share of the month's net sales across every channel. */
  pctOfNetSales: number
}

export interface MonthlyCloseInput {
  month: string
  /** Every channel's P&L for the month, as the screens build it. */
  views: ChannelPnlView[]
  /** The month before, for the comparisons that need one. Omit for the
   * first month on file. */
  previousViews?: ChannelPnlView[]
  salesRecords: CanonicalSalesRecord[]
  fixedExpenses: FixedExpenseEntry[]
  nykaaFacts: NykaaPnlFacts[]
  /** True when a rate for this month is on file. Worked out by the caller,
   * which owns the effective-dating rules. */
  has: {
    fxUsd: boolean
    fxAed: boolean
    freightIndiaUsa: boolean
    nykaaInboundFreight: boolean
    packaging: boolean
    nykaaConfirmedDiscount: boolean
  }
  /** Product Master gaps, already counted by the catalogue screens. */
  catalogue: {
    unpricedSkus: number
    unpricedNetSales: number
    totalNetSales: number
    missingGstSkus: number
  }
  /** A SKU's reporting name, so a combo is not five rows of nothing. */
  productName: (sku: string, fallback?: string) => string
}

export interface MonthlyClose {
  month: string
  blockers: CloseItem[]
  warnings: CloseItem[]
  redFlags: RedFlag[]
  topProducts: TopProduct[]
  /** True when nothing blocks the month. Red flags never block it: they are
   * the reason to send the report, not a reason to hold it. */
  ready: boolean
}

const labelOf = (channel: BusinessChannelId): string =>
  BUSINESS_CHANNELS.find((c) => c.id === channel)?.label ?? channel

const inr = (v: number): string =>
  `₹${Math.abs(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** What a channel sold in a month, on the basis its own statement reports. */
function netSalesOf(view: ChannelPnlView | undefined): number {
  return view?.canonical.lines.netSales ?? 0
}

function tradedIn(views: ChannelPnlView[], channel: BusinessChannelId): boolean {
  const view = views.find((v) => v.channel === channel)
  return netSalesOf(view) !== 0 || (view?.canonical.lines.grossSales ?? 0) !== 0
}

/**
 * The month's findings.
 *
 * Everything here is derived from what is on file. Nothing is assumed about
 * a channel that has never traded: a marketplace we are not on yet is not a
 * missing report.
 */
export function buildMonthlyClose(input: MonthlyCloseInput): MonthlyClose {
  const blockers: CloseItem[] = []
  const warnings: CloseItem[] = []

  // ---- A channel that was trading and has filed nothing ------------------
  for (const channel of BUSINESS_CHANNELS) {
    const now = tradedIn(input.views, channel.id)
    const before = input.previousViews ? tradedIn(input.previousViews, channel.id) : false
    if (now || !before) continue
    const previous = netSalesOf(input.previousViews?.find((v) => v.channel === channel.id))
    blockers.push({
      id: `missing-${channel.id}`,
      severity: 'blocker',
      channel: channel.id,
      title: `${channel.label} has filed nothing for ${input.month}`,
      detail:
        `It reported ${inr(previous)} of net sales the month before. An unfiled month reads as a month with no ` +
        'sales, not as a gap, so the report cannot go out until the file is uploaded or the channel is known to ' +
        'have stopped trading.',
      path: '/data/upload',
      actionLabel: 'Upload the report',
    })
  }

  // ---- Monthly inputs the month's figures depend on ----------------------
  const needsUsd = tradedIn(input.views, 'amazon_us')
  const needsAed = tradedIn(input.views, 'amazon_ae')
  if (needsUsd && !input.has.fxUsd) {
    blockers.push({
      id: 'fx-usd', severity: 'blocker', channel: 'amazon_us',
      title: `No USD rate for ${input.month}`,
      detail: 'Amazon USA is denominated in dollars. Without the month\'s rate its figures cannot join the rupee P&L.',
      path: '/settings/monthly-inputs', actionLabel: 'Enter the rate',
    })
  }
  if (needsAed && !input.has.fxAed) {
    blockers.push({
      id: 'fx-aed', severity: 'blocker', channel: 'amazon_ae',
      title: `No AED rate for ${input.month}`,
      detail: 'Amazon UAE is denominated in dirhams, and the Master P&L is in rupees.',
      path: '/settings/monthly-inputs', actionLabel: 'Enter the rate',
    })
  }
  if (input.fixedExpenses.filter((e) => e.month === input.month).length === 0) {
    blockers.push({
      id: 'fixed-expenses', severity: 'blocker',
      title: `No fixed expenses for ${input.month}`,
      detail:
        'Salaries, rent, software — the month\'s whole overhead as one figure. Without it every channel\'s EBITDA ' +
        'is its contribution, which overstates the business.',
      path: '/settings/monthly-inputs', actionLabel: 'Enter the month\'s costs',
    })
  }
  if (needsUsd && !input.has.freightIndiaUsa) {
    warnings.push({
      id: 'freight-usa', severity: 'warning', channel: 'amazon_us',
      title: `No India→USA freight rate for ${input.month}`,
      detail: 'Units shipped to the US carry no delivery cost without it, so Amazon USA reads better than it is.',
      path: '/settings/monthly-inputs', actionLabel: 'Enter the rate',
    })
  }
  if (tradedIn(input.views, 'nykaa') && !input.has.nykaaInboundFreight) {
    warnings.push({
      id: 'freight-nykaa', severity: 'warning', channel: 'nykaa',
      title: `No warehouse→Nykaa freight rate for ${input.month}`,
      detail: 'The units sold carry no delivery cost without it.',
      path: '/settings/monthly-inputs', actionLabel: 'Enter the rate',
    })
  }
  if (tradedIn(input.views, 'meesho') && !input.has.packaging) {
    warnings.push({
      id: 'packaging', severity: 'warning', channel: 'meesho',
      title: `No packaging rate for ${input.month}`,
      detail: 'Meesho charges per shipment and no marketplace report carries what a parcel costs us to pack.',
      path: '/settings/monthly-inputs', actionLabel: 'Enter the rate',
    })
  }

  // ---- Nykaa's discount, the channel's second largest cost ---------------
  const nykaa = input.nykaaFacts.find((f) => f.month === input.month)
  if (nykaa && nykaa.netSalesMrp > 0) {
    if (nykaaDiscountRecovered(nykaa) === 0) {
      blockers.push({
        id: 'nykaa-discount-missing', severity: 'blocker', channel: 'nykaa',
        title: `${input.month} shows no Nykaa customer discount`,
        detail:
          'Nykaa sells below MRP and charges the difference back on every month, so nil here means missing rather ' +
          'than none. Revenue is what Nykaa invoiced, not what we kept, and every margin below it is overstated.',
        path: '/data/upload', actionLabel: 'Re-upload the Nykaa sales file',
      })
    } else if (!input.has.nykaaConfirmedDiscount) {
      warnings.push({
        id: 'nykaa-discount-unconfirmed', severity: 'warning', channel: 'nykaa',
        title: `${input.month}'s Nykaa discount is the sales file's figure, not a confirmed one`,
        detail:
          `The statement deducts ${inr(nykaaDiscountRecovered(nykaa))}, derived from the month's own totals. What ` +
          'Nykaa actually bills arrives on a financial debit note weeks later, and on August 2026 the two differed ' +
          'by ₹93,217.64. Enter the note\'s figure once it comes.',
        path: '/settings/monthly-inputs', actionLabel: 'Enter the confirmed figure',
      })
    }
  }

  // ---- The catalogue, which prices everything ----------------------------
  const unpricedPct = input.catalogue.totalNetSales > 0
    ? (input.catalogue.unpricedNetSales / input.catalogue.totalNetSales) * 100
    : 0
  if (input.catalogue.unpricedSkus > 0) {
    warnings.push({
      id: 'unpriced-skus', severity: 'warning',
      title: `${input.catalogue.unpricedSkus} SKU(s) sold with no cost on file`,
      detail:
        `They cover ${inr(input.catalogue.unpricedNetSales)} of net sales (${unpricedPct.toFixed(1)}%), and their ` +
        'cost is estimated rather than looked up, so every margin that includes them is approximate.',
      path: '/products/sku-mapping', actionLabel: 'Map them',
    })
  }
  if (input.catalogue.missingGstSkus > 0) {
    warnings.push({
      id: 'missing-gst', severity: 'warning',
      title: `${input.catalogue.missingGstSkus} product(s) have no GST rate`,
      detail:
        'The Product Master is what decides tax on every channel. Until a product has a rate, its channel falls ' +
        'back to whatever its own file or purchase order said — and those disagree with each other.',
      path: '/products/master', actionLabel: 'Enter the rates',
    })
  }

  // ---- What each channel's own statement says is missing -----------------
  // Not restated here: the router writes these month by month, in the terms
  // of the channel they belong to, and a second wording of the same gap is a
  // second thing to keep true.
  for (const view of input.views) {
    for (const [i, note] of view.notes.entries()) {
      warnings.push({
        id: `note-${view.channel}-${i}`,
        severity: 'warning',
        channel: view.channel,
        title: `${labelOf(view.channel)}: ${note.split('. ')[0]}.`,
        detail: note,
        path: `/channels/${view.channel}`,
        actionLabel: 'Open the statement',
      })
    }
  }

  return {
    month: input.month,
    blockers,
    warnings,
    redFlags: buildRedFlags(input),
    topProducts: topSellingProducts(input, 5),
    ready: blockers.length === 0,
  }
}

/**
 * The charges that need a decision this month.
 *
 * Read off the fees statement rather than from the facts, so a charge counts
 * once and under the same name the Marketplace Fees screen gives it.
 */
export function buildRedFlags(input: MonthlyCloseInput): RedFlag[] {
  const flags: RedFlag[] = []
  const previous = new Map(
    (input.previousViews ?? []).map((v) => [v.channel, buildChannelFeesStatement(v)]),
  )

  for (const view of input.views) {
    const statement = buildChannelFeesStatement(view)
    if (statement.currency !== 'INR') continue
    const path = `/channels/${view.channel}`
    const name = labelOf(view.channel)

    const storage = statement.categories.find((c) => c.category === 'storage')
    if (storage) {
      const before = previous.get(view.channel)?.categories.find((c) => c.category === 'storage')?.amount ?? 0
      const grew = Math.abs(storage.amount) - Math.abs(before)
      const grewPct = Math.abs(before) > 0 ? (grew / Math.abs(before)) * 100 : Infinity
      if (storage.pctOfBasis >= STORAGE_PCT_OF_BASIS) {
        flags.push({
          id: `storage-share-${view.channel}`, channel: view.channel, path,
          amountInr: storage.amount,
          title: `${name}: storage and ageing is ${storage.pctOfBasis.toFixed(1)}% of ${statement.basisLabel}`,
          detail:
            `${inr(storage.amount)} of rent on stock sitting in their warehouse, charged whether or not it sells. ` +
            'It is the one charge that falls if less stock is sent.',
        })
      } else if (grew >= STORAGE_GROWTH_MIN_INR && grewPct >= STORAGE_GROWTH_PCT) {
        flags.push({
          id: `storage-growth-${view.channel}`, channel: view.channel, path,
          amountInr: storage.amount,
          title: `${name}: storage and ageing up ${grewPct.toFixed(0)}% on last month`,
          detail: `${inr(before)} to ${inr(storage.amount)}. Stock is ageing faster than it is selling.`,
        })
      }
    }

    for (const category of statement.categories) {
      for (const line of category.lines) {
        const key = line.key.toLowerCase()
        const label = line.label.toLowerCase()
        const amount = Math.abs(line.amount)
        // Charged for holding too little stock of something that is selling:
        // the opposite problem to storage, and the one with a deadline.
        if ((key.includes('lowinventory') || label.includes('low-inventory') || label.includes('low inventory')) && amount > 0) {
          flags.push({
            id: `low-inventory-${view.channel}`, channel: view.channel, path, amountInr: line.amount,
            title: `${name}: ${inr(line.amount)} of low-inventory-level fee`,
            detail:
              'Charged for holding too little stock against what is selling. Every rupee of it is avoidable by ' +
              'restocking, and it keeps being charged until the cover improves.',
          })
        }
        if ((key.includes('recall') || label.includes('recall')) && amount >= PENALTY_MIN_INR) {
          flags.push({
            id: `recall-${view.channel}-${line.key}`, channel: view.channel, path, amountInr: line.amount,
            title: `${name}: ${inr(line.amount)} of recall charges`,
            detail: `${line.label}. Stock pulled back out of the marketplace, at our cost.`,
          })
        }
      }
    }

    const penalty = statement.categories.find((c) => c.category === 'penalty')
    if (penalty && Math.abs(penalty.amount) >= PENALTY_MIN_INR && penalty.amount < 0) {
      flags.push({
        id: `penalty-${view.channel}`, channel: view.channel, path, amountInr: penalty.amount,
        title: `${name}: ${inr(penalty.amount)} of penalties`,
        detail:
          penalty.lines.map((l) => `${l.label} ${inr(l.amount)}`).join('; ') +
          '. Charged against us for a breach — a late dispatch, a cancellation, an SLA miss.',
      })
    }

    const contribution = view.canonical.lines.contributionProfit ?? 0
    if (contribution < 0 && netSalesOf(view) !== 0) {
      flags.push({
        id: `negative-contribution-${view.channel}`, channel: view.channel, path, amountInr: contribution,
        title: `${name} lost ${inr(contribution)} before overheads`,
        detail:
          `On ${inr(netSalesOf(view))} of net sales, the channel's own costs came to more than it earned. This is ` +
          'before any share of head office.',
      })
    }
  }

  return flags
}

/** The month's best sellers across every channel, by what they earned. */
export function topSellingProducts(input: MonthlyCloseInput, count: number): TopProduct[] {
  const rows = input.salesRecords.filter((r) => r.orderDate.slice(0, 7) === input.month)
  const bySku = new Map<string, { units: number; netSales: number; title: string }>()
  let total = 0
  for (const row of rows) {
    total += row.netSales
    const name = input.productName(row.sku, row.productName)
    const existing = bySku.get(name)
    if (existing) {
      existing.units += row.quantity
      existing.netSales += row.netSales
    } else {
      bySku.set(name, { units: row.quantity, netSales: row.netSales, title: row.sku })
    }
  }
  return [...bySku.entries()]
    .map(([productName, v]) => ({
      sku: v.title,
      productName,
      units: v.units,
      netSales: v.netSales,
      pctOfNetSales: total > 0 ? (v.netSales / total) * 100 : 0,
    }))
    .sort((a, b) => b.netSales - a.netSales)
    .slice(0, count)
}
