import { useMemo, useState } from 'react'
import { PageShell } from '@/components/layout/PageShell'
import { PnlTable } from '@/components/pnl/PnlTable'
import { NativePnlTable } from '@/components/pnl/NativePnlTable'
import { useDataStore } from '@/store/dataStore'
import { useFilterStore } from '@/store/filterStore'
import { CHANNELS, CHANNEL_MAP, type ChannelId } from '@/config/channels'
import { buildChannelPnlView } from '@/engine/channelPnlRouter'
import { marketingFromAds } from '@/engine/marketing'
import { monthLabel } from '@/lib/format'
import { nextDownloadFileName, toMonthYearSuffix } from '@/lib/downloadNaming'
import { downloadCsv, nativePnlToCsv, pnlToCsv } from '@/lib/exportCsv'

export function ChannelPnlPage() {
  const {
    salesRecords, adsRecords, skuMaster, fixedExpenses, flipkartFacts, amazonUsaFacts, meeshoFacts,
    patchFlipkartFacts, patchAmazonUsaFacts,
  } = useDataStore()
  const { month } = useFilterStore()
  const [channel, setChannel] = useState<ChannelId>('amazon_in_seller')
  const [view, setView] = useState<'native' | 'standardized'>('native')

  const pnlView = useMemo(() => {
    const marketing = marketingFromAds(adsRecords, month)
    return buildChannelPnlView(channel, month, {
      salesRecords, skuMaster, fixedExpenses, marketing,
      facts: { flipkartFacts, amazonUsaFacts, meeshoFacts },
    })
  }, [salesRecords, adsRecords, skuMaster, fixedExpenses, flipkartFacts, amazonUsaFacts, meeshoFacts, channel, month])

  const showingNative = view === 'native' && !!pnlView.native

  function handleEditManualEntry(key: string, value: number) {
    if (channel === 'flipkart') patchFlipkartFacts(month, { [key]: value })
    else if (channel === 'amazon_us') patchAmazonUsaFacts(month, { [key]: value })
  }

  function handleExport() {
    const fileName = nextDownloadFileName(CHANNEL_MAP[channel].group.replace(/\s+/g, ''), toMonthYearSuffix(month))
    const csv = showingNative && pnlView.native
      ? nativePnlToCsv(pnlView.native.lineDefs, pnlView.native.values)
      : pnlToCsv(pnlView.canonical.lines)
    downloadCsv(fileName, csv)
  }

  return (
    <PageShell title="Channel P&L" subtitle={`${pnlView.native ? "This channel's real P&L structure" : 'Standardized structure — no real P&L data uploaded for this channel yet'} — ${monthLabel(month)}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value as ChannelId)}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
          >
            {CHANNELS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          {pnlView.native && (
            <div className="flex rounded-md border border-slate-300 bg-white text-xs">
              <button
                type="button"
                onClick={() => setView('native')}
                className={`rounded-l-md px-3 py-1.5 font-medium ${view === 'native' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
              >
                Native (real)
              </button>
              <button
                type="button"
                onClick={() => setView('standardized')}
                className={`rounded-r-md px-3 py-1.5 font-medium ${view === 'standardized' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
              >
                Standardized
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={handleExport}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          Export
        </button>
      </div>

      {showingNative && pnlView.native ? (
        <>
          <p className="text-xs text-slate-400">
            Rows marked "Manual entry" aren't in the uploaded report — click a value to edit it for {monthLabel(month)}.
          </p>
          <NativePnlTable
            lineDefs={pnlView.native.lineDefs}
            values={pnlView.native.values}
            currency={pnlView.native.currency}
            onEditManualEntry={handleEditManualEntry}
          />
        </>
      ) : (
        <PnlTable lines={pnlView.canonical.lines} currency={CHANNEL_MAP[channel].currency} />
      )}
    </PageShell>
  )
}
