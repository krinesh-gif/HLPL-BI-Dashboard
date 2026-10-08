import { useMemo, useState } from 'react'
import { useDataStore } from '@/store/dataStore'
import { fxRateForMonth, fxRateValue, lineValuesToUsd } from '@/data/fxRates'
import { useFilterStore } from '@/store/filterStore'
import { BUSINESS_CHANNEL_IDS, type BusinessChannelId } from '@/config/channels'
import { toMonthKey } from '@/lib/format'
import { buildAllChannelPnlViews, buildChannelPnlView } from '@/engine/channelPnlRouter'
import { buildMasterPnl, computeSubtotals } from '@/engine/pnl'
import { usePnlInputs } from '@/engine/usePnlInputs'
import {
  anchorWithinData,
  buildMultiMonthPnl,
  comparePnlMonths,
  comparisonMonths,
  monthsBetween,
  monthsForQuickPeriod,
  tradedMonths,
  type QuickPeriod,
} from '@/engine/multiMonthPnl'
import type { PnlBasis, PnlLineValues } from '@/data/models'

/** Master Company, or one business channel. */
export type PnlView = 'master' | BusinessChannelId

export interface PnlPeriod {
  mode: 'quick' | 'custom'
  quick: QuickPeriod
  from: string
  to: string
}

/**
 * The data behind the P&L screen.
 *
 * Master Company and a single channel are produced by the same code — the only
 * difference is whether every channel's lines are summed first. That is what
 * keeps the two reports in the same format and stops them from being
 * calculated two different ways.
 */
/**
 * Where the report should start. Only initial values: the snapshot opens on
 * the selection it was linked with, and the controls still work from there.
 */
export interface PnlReportStart {
  view?: PnlView
  period?: PnlPeriod
  meeshoBasis?: PnlBasis
  amazonUsaCurrency?: 'USD' | 'INR'
}

export function usePnlReport(start: PnlReportStart = {}) {
  const { salesRecords, flipkartFacts, amazonUsaFacts, meeshoFacts, myntraFacts, nykaaFacts, blinkitFacts, amazonInSellerFacts, fxRates } =
    useDataStore()
  const { month } = useFilterStore()
  const { forMonth } = usePnlInputs()
  // Today's month, which is the one month a comparison must not use as its
  // later column: it is only as much of a month as has happened so far.
  const currentMonth = toMonthKey(new Date().toISOString().slice(0, 10))

  const [view, setView] = useState<PnlView>(start.view ?? 'master')
  // Meesho carries both an order-date and a payment-date statement. Order
  // basis is the default: it is what a month's trading is judged on.
  const [meeshoBasis, setMeeshoBasis] = useState<PnlBasis>(start.meeshoBasis ?? 'order')
  // Amazon USA earns and is charged in dollars, so its own statement reads
  // naturally in dollars. Rupees is the second view, for reading it beside the
  // other channels. The Master P&L is always rupees — one report, one currency.
  const [amazonUsaCurrency, setAmazonUsaCurrency] = useState<'USD' | 'INR'>(start.amazonUsaCurrency ?? 'USD')
  const [period, setPeriod] = useState<PnlPeriod>(start.period ?? { mode: 'quick', quick: '6m', from: month, to: month })

  const monthsWithData = useMemo(() => {
    const set = new Set<string>()
    for (const r of salesRecords) set.add(toMonthKey(r.orderDate))
    for (const f of flipkartFacts) set.add(f.month)
    for (const f of amazonUsaFacts) set.add(f.month)
    for (const f of meeshoFacts) set.add(f.month)
    for (const f of myntraFacts) set.add(f.month)
    for (const f of nykaaFacts) set.add(f.month)
    // Blinkit and Amazon India Seller reach the P&L through `usePnlInputs`
    // like every other channel, so their months belong in this list too. Left
    // out, a month that only Blinkit traded in was not offered in From/To and
    // did not count as a month with data.
    for (const f of blinkitFacts) set.add(f.month)
    for (const f of amazonInSellerFacts ?? []) set.add(f.month)
    return [...set].sort()
  }, [salesRecords, flipkartFacts, amazonUsaFacts, meeshoFacts, myntraFacts, nykaaFacts, blinkitFacts, amazonInSellerFacts])

  return useMemo(() => {
    const months =
      period.mode === 'custom'
        ? monthsBetween(period.from, period.to)
        : monthsForQuickPeriod(period.quick, anchorWithinData(month, monthsWithData), monthsWithData)

    // Amazon USA is the one channel that can be read in either currency. The
    // Master P&L is always rupees — it sums every channel, and a report in two
    // currencies at once is not a report.
    const displayCurrency: 'INR' | 'USD' =
      view === 'amazon_us' && amazonUsaCurrency === 'USD' ? 'USD' : 'INR'

    /** One month's P&L lines for the selected view, in `displayCurrency`. */
    const linesFor = (m: string): PnlLineValues => {
      const inputs = { ...forMonth(m), meeshoBasis, amazonUsaCurrency }
      if (view === 'master') {
        const views = buildAllChannelPnlViews(BUSINESS_CHANNEL_IDS, m, inputs)
        return buildMasterPnl(views.map((v) => v.canonical), m).lines
      }
      const lines = buildChannelPnlView(view, m, inputs).canonical.lines
      // The canonical buckets are built in rupees so they can roll up into the
      // Master P&L. Reading Amazon USA in dollars divides them back out at the
      // same month's rate, so the round trip is exact and the margins — being
      // ratios — do not move at all.
      return displayCurrency === 'USD' ? lineValuesToUsd(lines, fxRateValue(m, fxRates)) : lines
    }

    const table = buildMultiMonthPnl(months, linesFor, computeSubtotals)

    const at = (key: string, i: number): number => table.rows.find((r) => r.def.key === key)?.values[i] ?? 0

    // The months of the period this view has trading in. Sales rather than any
    // figure at all: a month carrying only costs is an incomplete month, not
    // one to report as the latest or to compare against.
    const traded = tradedMonths(months, (i) => at('grossSales', i) !== 0 || at('netSales', i) !== 0)

    // Per-channel Net Sales for the latest month in the period, so the Master
    // P&L can be broken down into the channels behind it. The latest month
    // that traded, not simply the last in the period — on the last of them the
    // breakdown was a table of zeroes, which renders as no table at all.
    const latestMonth = traded[traded.length - 1] ?? months[months.length - 1] ?? month
    const channelBreakdown =
      view === 'master'
        ? buildAllChannelPnlViews(BUSINESS_CHANNEL_IDS, latestMonth, { ...forMonth(latestMonth), meeshoBasis, amazonUsaCurrency })
            .map((v) => ({ channel: v.channel, netSales: v.canonical.lines.netSales ?? 0 }))
            .filter((c) => c.netSales !== 0)
            .sort((a, b) => b.netSales - a.netSales)
        : []

    // The two most recent finished months in the period that traded, which is
    // what "September vs August" asks for.
    const pair = comparisonMonths(traded, currentMonth)
    const comparison = pair && { ...pair, rows: comparePnlMonths(pair.earlierMonth, pair.laterMonth, linesFor) }

    const trend = months.map((m, i) => ({
      month: m,
      netSales: at('netSales', i),
      grossProfit: at('grossProfit', i),
      contribution: at('contribution', i),
      ebitda: at('ebitda', i),
      grossMarginPct: at('grossMarginPct', i),
      contributionMarginPct: at('contributionMarginPct', i),
      ebitdaMarginPct: at('ebitdaMarginPct', i),
    }))

    // The channel's own waterfall, for the most recent month in the period
    // that actually has one. Anchoring it to the last month of the period
    // showed nothing whenever that month had no statement yet — which is the
    // normal state of the current month.
    let native: ReturnType<typeof buildChannelPnlView>['native']
    let nativeNotes: string[] = []
    let nativeMonth = latestMonth
    // Why there is no statement, when there is none. The note used to ride
    // along with the statement, so the one case it was written for — a channel
    // with no settlement events stored at all — was the one case it never
    // appeared in, and the order-row template stood in silently.
    let missingStatementNote: string | null = null
    if (view !== 'master') {
      for (let i = months.length - 1; i >= 0; i--) {
        const built = buildChannelPnlView(view, months[i], { ...forMonth(months[i]), meeshoBasis, amazonUsaCurrency })
        if (built.native) { native = built.native; nativeNotes = built.notes; nativeMonth = months[i]; break }
      }
      if (!native) {
        const built = buildChannelPnlView(view, latestMonth, { ...forMonth(latestMonth), meeshoBasis, amazonUsaCurrency })
        missingStatementNote = built.notes[0] ?? null
      }
    }

    return {
      view, setView,
      missingStatementNote,
      meeshoBasis, setMeeshoBasis,
      amazonUsaCurrency, setAmazonUsaCurrency,
      displayCurrency,
      fxRateLabel: `₹${fxRateForMonth(nativeMonth, fxRates).rate.toFixed(2)} per $1`,
      fxRateEntered: fxRateForMonth(nativeMonth, fxRates).entered,
      native, nativeMonth, nativeNotes,
      period, setPeriod,
      months,
      monthsWithData,
      table,
      channelBreakdown,
      comparison,
      trend,
      latestMonth,
    }
  }, [view, meeshoBasis, amazonUsaCurrency, period, month, currentMonth, monthsWithData, forMonth, fxRates])
}
