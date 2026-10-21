import { useMemo, useState } from 'react'
import { statementMonths, useDataStore } from '@/store/dataStore'
import { fxRateForMonth, lineValuesFromInr } from '@/data/fxRates'
import { useFilterStore } from '@/store/filterStore'
import {
  BUSINESS_CHANNEL_IDS, displayCurrencyFor, isForeignChannel, nativeCurrencyOf,
  type BusinessChannelId, type ChannelCurrency, type ChannelCurrencyView,
} from '@/config/channels'
import { toMonthKey } from '@/lib/format'
import {
  amazonInHalfSplit, buildAllChannelPnlViews, buildChannelPnlView, type AmazonInHalf,
} from '@/engine/channelPnlRouter'
import { buildMasterPnl, computeSubtotals } from '@/engine/pnl'
import { usePnlInputs } from '@/engine/usePnlInputs'
import {
  quickPeriodAnchor,
  buildMultiMonthPnl,
  comparePnlMonths,
  comparisonMonths,
  monthsBetween,
  monthsForQuickPeriod,
  tradedMonths,
  type QuickPeriod,
} from '@/engine/multiMonthPnl'
import type { PnlLineValues } from '@/data/models'

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
  amazonInHalf?: AmazonInHalf
  currencyView?: ChannelCurrencyView
}

export function usePnlReport(start: PnlReportStart = {}) {
  const store = useDataStore()
  const { fxRates } = store
  const { month } = useFilterStore()
  const { inputs: pnlInputs, forMonth } = usePnlInputs()
  // Today's month, which is the one month a comparison must not use as its
  // later column: it is only as much of a month as has happened so far.
  const currentMonth = toMonthKey(new Date().toISOString().slice(0, 10))

  const [view, setView] = useState<PnlView>(start.view ?? 'master')
  // Amazon India is wholesale to RK World and a marketplace under one name.
  // The channel — both halves added — is what opens, because that is the
  // Amazon India every other screen reports; the halves are there to be read
  // one at a time, which no single waterfall can do.
  const [amazonInHalf, setAmazonInHalf] = useState<AmazonInHalf>(start.amazonInHalf ?? 'both')
  // A channel that earns and is charged in dollars or dirhams reads naturally
  // in that currency, so its own statement opens there. Rupees is the second
  // view, for reading it beside the other channels. The Master P&L is always
  // rupees — one report, one currency.
  const [currencyView, setCurrencyView] = useState<ChannelCurrencyView>(start.currencyView ?? 'native')
  const [period, setPeriod] = useState<PnlPeriod>(start.period ?? { mode: 'quick', quick: '6m', from: month, to: month })

  // Every channel's months, from one list in the store. Each screen used to
  // keep its own, and each in turn missed a channel added later.
  const monthsWithData = useMemo(() => statementMonths(store), [store])

  // Whether there are two Amazon India businesses to choose between. A toggle
  // with an empty side is worse than no toggle: it reads as a channel with
  // nothing in it rather than as a half that has no file yet.
  const hasBothAmazonInHalves =
    (store.amazonInVendorFacts ?? []).length > 0 && (store.amazonInSellerFacts ?? []).length > 0

  return useMemo(() => {
    const months =
      period.mode === 'custom'
        ? monthsBetween(period.from, period.to)
        : monthsForQuickPeriod(period.quick, quickPeriodAnchor(month, monthsWithData, currentMonth), monthsWithData)

    // Amazon USA is the one channel that can be read in either currency. The
    // Master P&L is always rupees — it sums every channel, and a report in two
    // currencies at once is not a report.
    // Driven by the registry, so a foreign channel added later is offered the
    // same choice without this file knowing it exists.
    const displayCurrency: ChannelCurrency = view === 'master' ? 'INR' : displayCurrencyFor(view, currencyView)

    // Reading one half of Amazon India is a choice about that channel's own
    // report. The Master P&L sums every channel and has to be the company, so
    // it reads the whole of Amazon India however this is left set.
    const halfForView: AmazonInHalf = view === 'amazon_in' ? amazonInHalf : 'both'

    /** One month's P&L lines for the selected view, in `displayCurrency`. */
    const linesFor = (m: string): PnlLineValues => {
      const inputs = { ...forMonth(m), currencyView, amazonInHalf: halfForView }
      if (view === 'master') {
        const views = buildAllChannelPnlViews(BUSINESS_CHANNEL_IDS, m, inputs)
        return buildMasterPnl(views.map((v) => v.canonical), m).lines
      }
      const lines = buildChannelPnlView(view, m, inputs).canonical.lines
      // The canonical buckets are built in rupees so they can roll up into the
      // Master P&L. Reading Amazon USA in dollars divides them back out at the
      // same month's rate, so the round trip is exact and the margins — being
      // ratios — do not move at all.
      // Out of rupees at whichever currency is being read, not at the dollar
      // alone: this checked for 'USD' exactly, so Amazon UAE fell through it
      // and printed rupees under a dirham symbol.
      if (displayCurrency === 'INR') return lines
      return lineValuesFromInr(lines, fxRateForMonth(m, fxRates, displayCurrency === 'AED' ? 'AEDINR' : 'USDINR').rate)
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
    const latestChannelViews =
      view === 'master'
        ? buildAllChannelPnlViews(BUSINESS_CHANNEL_IDS, latestMonth, { ...forMonth(latestMonth), currencyView, amazonInHalf: 'both' })
        : []
    const channelBreakdown = latestChannelViews
      .map((v) => ({ channel: v.channel, netSales: v.canonical.lines.netSales ?? 0 }))
      .filter((c) => c.netSales !== 0)
      .sort((a, b) => b.netSales - a.netSales)

    // The same month's EBITDA, channel by channel, best first — which is the
    // order the question is asked in: who is making money.
    //
    // It adds to the Master EBITDA above it rather than approximating it.
    // `buildMasterPnl` sums the input lines of these same views and takes the
    // subtotals of the sum, and every subtotal between them is a sum or a
    // difference, so the channels' EBITDA and the company's are the same
    // arithmetic in a different order.
    //
    // A channel with no sales is kept where it still has an EBITDA: a month
    // that spent on a channel and sold nothing is a loss, and dropping it for
    // having no revenue would hide exactly that.
    const ebitdaBreakdown = latestChannelViews
      .map((v) => ({
        channel: v.channel,
        ebitda: v.canonical.lines.ebitda ?? 0,
        netSales: v.canonical.lines.netSales ?? 0,
      }))
      .filter((c) => c.netSales !== 0 || c.ebitda !== 0)
      .sort((a, b) => b.ebitda - a.ebitda)

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
    const nativeCurrency: ChannelCurrency = view === 'master' ? 'INR' : nativeCurrencyOf(view)
    // Why there is no statement, when there is none. The note used to ride
    // along with the statement, so the one case it was written for — a channel
    // with no settlement events stored at all — was the one case it never
    // appeared in, and the order-row template stood in silently.
    let missingStatementNote: string | null = null
    if (view !== 'master') {
      for (let i = months.length - 1; i >= 0; i--) {
        const built = buildChannelPnlView(view, months[i], { ...forMonth(months[i]), currencyView, amazonInHalf: halfForView })
        if (built.native) { native = built.native; nativeNotes = built.notes; nativeMonth = months[i]; break }
      }
      if (!native) {
        const built = buildChannelPnlView(view, latestMonth, { ...forMonth(latestMonth), currencyView, amazonInHalf: halfForView })
        missingStatementNote = built.notes[0] ?? null
      }
    }

    const nativeRate = fxRateForMonth(nativeMonth, fxRates, nativeCurrency === 'AED' ? 'AEDINR' : 'USDINR')

    return {
      view, setView,
      missingStatementNote,
      amazonInHalf, setAmazonInHalf,
      // Offered only where there are two halves on file to read apart, and
      // labelled with what each one is of the channel over this period.
      showAmazonInHalves: view === 'amazon_in' && hasBothAmazonInHalves,
      amazonInSplit: amazonInHalfSplit(pnlInputs.facts, months),
      currencyView, setCurrencyView,
      displayCurrency,
      // Named for whichever currency this view is settled in, so Amazon UAE
      // does not report its dirham rate as dollars.
      nativeCurrency,
      isForeign: view !== 'master' && isForeignChannel(view),
      fxRateLabel: `₹${nativeRate.rate.toFixed(2)} per 1 ${nativeCurrency}`,
      fxRateEntered: nativeRate.entered,
      native, nativeMonth, nativeNotes,
      period, setPeriod,
      months,
      monthsWithData,
      table,
      channelBreakdown,
      ebitdaBreakdown,
      comparison,
      trend,
      latestMonth,
    }
  }, [
    view, amazonInHalf, currencyView, period, month, currentMonth,
    monthsWithData, hasBothAmazonInHalves, pnlInputs, forMonth, fxRates,
  ])
}
