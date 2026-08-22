import { useMemo } from 'react'
import { PageShell } from '@/components/layout/PageShell'
import { PnlTable } from '@/components/pnl/PnlTable'
import { useDataStore } from '@/store/dataStore'
import { useFilterStore } from '@/store/filterStore'
import { buildAllChannelPnls, buildMasterPnl } from '@/engine/pnl'
import { marketingFromAds } from '@/engine/marketing'
import { monthLabel } from '@/lib/format'
import { nextDownloadFileName, toMonthYearSuffix } from '@/lib/downloadNaming'
import { downloadCsv, pnlToCsv } from '@/lib/exportCsv'

export function MasterPnlPage() {
  const { salesRecords, adsRecords, skuMaster, fixedExpenses } = useDataStore()
  const { month } = useFilterStore()

  const master = useMemo(() => {
    const marketing = marketingFromAds(adsRecords, month)
    const pnls = buildAllChannelPnls(salesRecords, skuMaster, fixedExpenses, month, marketing)
    return buildMasterPnl(pnls, month)
  }, [salesRecords, adsRecords, skuMaster, fixedExpenses, month])

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
