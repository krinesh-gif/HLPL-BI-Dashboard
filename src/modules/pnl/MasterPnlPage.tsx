import { useMemo } from 'react'
import { PageShell } from '@/components/layout/PageShell'
import { PnlTable } from '@/components/pnl/PnlTable'
import { useDataStore } from '@/store/dataStore'
import { useFilterStore } from '@/store/filterStore'
import { CHANNELS } from '@/config/channels'
import { buildAllChannelPnlViews } from '@/engine/channelPnlRouter'
import { buildMasterPnl } from '@/engine/pnl'
import { marketingFromAds } from '@/engine/marketing'
import { monthLabel } from '@/lib/format'
import { nextDownloadFileName, toMonthYearSuffix } from '@/lib/downloadNaming'
import { downloadCsv, pnlToCsv } from '@/lib/exportCsv'

export function MasterPnlPage() {
  const { salesRecords, adsRecords, skuMaster, fixedExpenses, flipkartFacts, amazonUsaFacts, meeshoFacts } = useDataStore()
  const { month } = useFilterStore()

  const master = useMemo(() => {
    const marketing = marketingFromAds(adsRecords, month)
    const views = buildAllChannelPnlViews(CHANNELS.map((c) => c.id), month, {
      salesRecords, skuMaster, fixedExpenses, marketing,
      facts: { flipkartFacts, amazonUsaFacts, meeshoFacts },
    })
    return buildMasterPnl(views.map((v) => v.canonical), month)
  }, [salesRecords, adsRecords, skuMaster, fixedExpenses, flipkartFacts, amazonUsaFacts, meeshoFacts, month])

  function handleExport() {
    const fileName = nextDownloadFileName('MasterPnL', toMonthYearSuffix(month))
    downloadCsv(fileName, pnlToCsv(master.lines))
  }

  return (
    <PageShell title="Master P&L" subtitle={`Consolidated across all channels — ${monthLabel(month)}`}>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleExport}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          Export
        </button>
      </div>
      <PnlTable lines={master.lines} />
    </PageShell>
  )
}
