import { useMemo, useState } from 'react'
import { useDataStore } from '@/store/dataStore'
import { useFilterStore } from '@/store/filterStore'
import { BUSINESS_CHANNEL_IDS, type BusinessChannelId } from '@/config/channels'
import { toMonthKey } from '@/lib/format'
import { buildAllChannelPnlViews, buildChannelPnlView } from '@/engine/channelPnlRouter'
import { buildMasterPnl, computeSubtotals } from '@/engine/pnl'
import { usePnlInputs } from '@/engine/usePnlInputs'
import {
  buildMultiMonthPnl,
  comparePnlMonths,
  monthsBetween,
  monthsForQuickPeriod,
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
export function usePnlReport() {
  const { salesRecords, flipkartFacts, amazonUsaFacts, meeshoFacts } = useDataStore()
  const { month } = useFilterStore()
  const { forMonth } = usePnlInputs()

  const [view, setView] = useState<PnlView>('master')
  const [period, setPeriod] = useState<PnlPeriod>({ mode: 'quick', quick: '6m', from: month, to: month })

  const monthsWithData = useMemo(() => {
    const set = new Set<string>()
    for (const r of salesRecords) set.add(toMonthKey(r.orderDate))
    for (const f of flipkartFacts) set.add(f.month)
    for (const f of amazonUsaFacts) set.add(f.month)
    for (const f of meeshoFacts) set.add(f.month)
    return [...set].sort()
  }, [salesRecords, flipkartFacts, amazonUsaFacts, meeshoFacts])

  return useMemo(() => {
    const months =
      period.mode === 'custom'
        ? monthsBetween(period.from, period.to)
        : monthsForQuickPeriod(period.quick, month, monthsWithData)

    /** One month's P&L lines for the selected view. */
    const linesFor = (m: string): PnlLineValues => {
      const inputs = forMonth(m)
      if (view === 'master') {
        const views = buildAllChannelPnlViews(BUSINESS_CHANNEL_IDS, m, inputs)
        return buildMasterPnl(views.map((v) => v.canonical), m).lines
      }
      return buildChannelPnlView(view, m, inputs).canonical.lines
    }

    const table = buildMultiMonthPnl(months, linesFor, computeSubtotals)

    // Per-channel Net Sales for the latest month in the period, so the Master
    // P&L can be broken down into the channels behind it.
    const latestMonth = months[months.length - 1] ?? month
    const channelBreakdown =
      view === 'master'
        ? buildAllChannelPnlViews(BUSINESS_CHANNEL_IDS, latestMonth, forMonth(latestMonth))
            .map((v) => ({ channel: v.channel, netSales: v.canonical.lines.netSales ?? 0 }))
            .filter((c) => c.netSales !== 0)
            .sort((a, b) => b.netSales - a.netSales)
        : []

    // The two most recent months in the period, which is what "August vs July"
    // asks for. Absent when the period is a single month.
    const comparison =
      months.length >= 2
        ? {
            earlierMonth: months[months.length - 2],
            laterMonth: months[months.length - 1],
            rows: comparePnlMonths(months[months.length - 2], months[months.length - 1], linesFor),
          }
        : null

    const trend = months.map((m, i) => ({
      month: m,
      netSales: table.rows.find((r) => r.def.key === 'netSales')?.values[i] ?? 0,
      grossProfit: table.rows.find((r) => r.def.key === 'grossProfit')?.values[i] ?? 0,
      contribution: table.rows.find((r) => r.def.key === 'contribution')?.values[i] ?? 0,
      ebitda: table.rows.find((r) => r.def.key === 'ebitda')?.values[i] ?? 0,
      grossMarginPct: table.rows.find((r) => r.def.key === 'grossMarginPct')?.values[i] ?? 0,
      contributionMarginPct: table.rows.find((r) => r.def.key === 'contributionMarginPct')?.values[i] ?? 0,
      ebitdaMarginPct: table.rows.find((r) => r.def.key === 'ebitdaMarginPct')?.values[i] ?? 0,
    }))

    return {
      view, setView,
      period, setPeriod,
      months,
      monthsWithData,
      table,
      channelBreakdown,
      comparison,
      trend,
      latestMonth,
    }
  }, [view, period, month, monthsWithData, forMonth])
}
