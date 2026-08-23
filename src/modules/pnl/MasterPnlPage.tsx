import { useMemo } from 'react'
import { PageShell } from '@/components/layout/PageShell'
import { PnlTable } from '@/components/pnl/PnlTable'
import { useFilterStore } from '@/store/filterStore'
import { CHANNELS } from '@/config/channels'
import { buildAllChannelPnlViews } from '@/engine/channelPnlRouter'
import { buildMasterPnl } from '@/engine/pnl'
import { usePnlInputs } from '@/engine/usePnlInputs'
import { monthLabel } from '@/lib/format'
import { nextDownloadFileName, toMonthYearSuffix } from '@/lib/downloadNaming'
import { downloadCsv, pnlToCsv } from '@/lib/exportCsv'

export function MasterPnlPage() {
  const { month } = useFilterStore()
  const { forMonth } = usePnlInputs()

  const master = useMemo(() => {
    const views = buildAllChannelPnlViews(CHANNELS.map((c) => c.id), month, forMonth(month))
    return buildMasterPnl(views.map((v) => v.canonical), month)
  }, [forMonth, month])

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
