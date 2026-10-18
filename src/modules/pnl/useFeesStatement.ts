import { useMemo, useState } from 'react'
import { BUSINESS_CHANNEL_IDS } from '@/config/channels'
import { amazonInHalfSplit, buildAllChannelPnlViews, type AmazonInHalf } from '@/engine/channelPnlRouter'
import { buildFeesStatement, buildChannelFeesStatement, type ChannelFeesStatement } from '@/engine/feesStatement'
import { usePnlInputs } from '@/engine/usePnlInputs'
import { addMonths } from '@/lib/format'
import { statementMonths, useDataStore } from '@/store/dataStore'
import { useFilterStore } from '@/store/filterStore'

/** How many months of history the trend reads. */
const TREND_MONTHS = 6

/**
 * The fees statement for a month, and the take rate per channel over the
 * months before it.
 *
 * Amazon USA is read in rupees here, not dollars. Its own statement reads
 * naturally in dollars, but this page exists to put eight channels beside each
 * other and a table in two currencies is not a comparison.
 *
 * Amazon India charges on two quite different bases — a trade margin and a
 * contra-COGS claim on the wholesale side, referral and fulfilment fees on the
 * marketplace side — so which business is being costed is part of the
 * question. Both is the channel; the halves are read one at a time.
 */
export function useFeesStatement() {
  const store = useDataStore()
  const { month } = useFilterStore()
  const { inputs: pnlInputs, forMonth } = usePnlInputs()
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null)
  const [amazonInHalf, setAmazonInHalf] = useState<AmazonInHalf>('both')

  // Nothing to choose between unless both halves have a month on file.
  const hasBothAmazonInHalves =
    (store.amazonInVendorFacts ?? []).length > 0 && (store.amazonInSellerFacts ?? []).length > 0

  // One list, shared with the P&L: a channel added later was otherwise
  // missed here as well.
  const monthsWithData = useMemo(() => statementMonths(store), [store])

  return useMemo(() => {
    const active = selectedMonth ?? month
    const viewsFor = (m: string) =>
      buildAllChannelPnlViews(BUSINESS_CHANNEL_IDS, m, { ...forMonth(m), currencyView: 'INR', amazonInHalf })

    const statement = buildFeesStatement(viewsFor(active), active)

    // The months leading up to the selected one, for reading a charge as a
    // trend rather than as one month's figure. A charge that has doubled is a
    // different thing from one that is simply large.
    const trendMonths = Array.from({ length: TREND_MONTHS }, (_, i) => addMonths(active, i - (TREND_MONTHS - 1)))
    const history = new Map<string, ChannelFeesStatement[]>()
    for (const m of trendMonths) {
      for (const view of viewsFor(m)) {
        const s = buildChannelFeesStatement(view)
        const list = history.get(view.channel)
        if (list) list.push(s)
        else history.set(view.channel, [s])
      }
    }

    return {
      month: active,
      setMonth: setSelectedMonth,
      amazonInHalf, setAmazonInHalf,
      showAmazonInHalves: hasBothAmazonInHalves,
      amazonInSplit: amazonInHalfSplit(pnlInputs.facts, [active]),
      monthOptions: monthsWithData.length > 0 ? monthsWithData : [active],
      statement,
      trendMonths,
      history,
    }
  }, [selectedMonth, month, amazonInHalf, hasBothAmazonInHalves, monthsWithData, pnlInputs, forMonth])
}
