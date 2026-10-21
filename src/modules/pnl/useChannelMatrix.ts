import { useMemo, useState } from 'react'
import { statementMonths, useDataStore } from '@/store/dataStore'
import { BUSINESS_CHANNEL_IDS, type BusinessChannelId } from '@/config/channels'
import { buildAllChannelPnlViews } from '@/engine/channelPnlRouter'
import { buildMasterPnl, computeSubtotals } from '@/engine/pnl'
import { buildPnlColumns, isEmptyPnlColumn } from '@/engine/multiMonthPnl'
import { usePnlInputs } from '@/engine/usePnlInputs'
import { latestFinishedMonth } from '@/lib/format'
import type { PnlLineValues } from '@/data/models'

/**
 * One month, every channel side by side.
 *
 * The P&L screen reads a channel down the months. This reads a month across
 * the channels, which is the other question management asks of the same
 * figures: not "how is Flipkart trending" but "where did this month's money
 * come from and where did it go".
 *
 * It is built from the same `buildPnlColumns` and the same channel statements,
 * so it cannot disagree with the P&L screen — a second report with its own
 * arithmetic is how two numbers for one month get into one meeting. The Total
 * column is the Master Company: `buildMasterPnl` sums the input lines of these
 * same views and takes the subtotals of the sum, which is exactly what the
 * Total column does, so the two are the same arithmetic in a different order.
 */
export interface ChannelMatrixColumn {
  channel: BusinessChannelId
  lines: PnlLineValues
}

export function useChannelMatrix() {
  const store = useDataStore()
  const { forMonth } = usePnlInputs()

  const monthsWithData = useMemo(() => statementMonths(store), [store])
  // The newest *finished* month there is a statement for. Never the running
  // month: a month four days old has one channel's file in it, and this
  // report would show the rest of the business as having stopped trading.
  const latest = latestFinishedMonth(monthsWithData) ?? ''
  const [chosenMonth, setMonth] = useState<string | null>(null)
  const month = chosenMonth ?? latest

  return useMemo(() => {
    const inputs = {
      ...forMonth(month),
      // Rupees, always. The columns sit beside each other and are added up at
      // the end of the row, so a dollar column would make the row meaningless.
      currencyView: 'INR' as const,
      // Amazon India as the business every other screen reports — both halves.
      amazonInHalf: 'both' as const,
    }

    const views = buildAllChannelPnlViews(BUSINESS_CHANNEL_IDS, month, inputs)

    // A channel with nothing at all in the month is left out: an empty column
    // is noise in a report that is already ten wide. Every additive line is
    // zero, so dropping it cannot move the Total — which is what makes hiding
    // it safe rather than convenient.
    const columns: ChannelMatrixColumn[] = views
      .map((v) => ({ channel: v.channel, lines: v.canonical.lines }))
      .filter((c) => !isEmptyPnlColumn(c.lines))
      .sort((a, b) => (b.lines.netSales ?? 0) - (a.lines.netSales ?? 0))

    const byChannel = new Map<string, PnlLineValues>(columns.map((c) => [c.channel, c.lines]))
    const table = buildPnlColumns(
      columns.map((c) => c.channel),
      (c) => byChannel.get(c) ?? {},
      computeSubtotals,
    )

    return {
      month,
      setMonth,
      monthsWithData,
      channels: columns.map((c) => c.channel),
      table,
      // The same month built the way the P&L screen builds it, so the page can
      // say the Total column is the Master Company rather than imply it.
      master: buildMasterPnl(views.map((v) => v.canonical), month).lines,
      // Channels with a statement that had nothing in this month, named so the
      // reader knows a missing column is a missing month and not a missing
      // channel.
      absent: views.filter((v) => isEmptyPnlColumn(v.canonical.lines)).map((v) => v.channel),
    }
  }, [month, monthsWithData, forMonth])
}
