import { useMemo, useState } from 'react'
import { PageShell } from '@/components/layout/PageShell'
import { PnlTable } from '@/components/pnl/PnlTable'
import { useDataStore } from '@/store/dataStore'
import { useFilterStore } from '@/store/filterStore'
import { CHANNELS, CHANNEL_MAP, type ChannelId } from '@/config/channels'
import { buildChannelPnl } from '@/engine/pnl'
import { marketingFromAds } from '@/engine/marketing'
import { monthLabel } from '@/lib/format'
import { nextDownloadFileName, toMonthYearSuffix } from '@/lib/downloadNaming'
import { downloadCsv, pnlToCsv } from '@/lib/exportCsv'

export function ChannelPnlPage() {
  const { salesRecords, adsRecords, skuMaster, fixedExpenses } = useDataStore()
  const { month } = useFilterStore()
  const [channel, setChannel] = useState<ChannelId>('amazon_in_seller')

  const pnl = useMemo(() => {
    const marketing = marketingFromAds(adsRecords, month)
    return buildChannelPnl(salesRecords, skuMaster, fixedExpenses, channel, month, marketing)
  }, [salesRecords, adsRecords, skuMaster, fixedExpenses, channel, month])

  function handleExport() {
    const fileName = nextDownloadFileName(CHANNEL_MAP[channel].group.replace(/\s+/g, ''), toMonthYearSuffix(month))
    downloadCsv(fileName, pnlToCsv(pnl.lines))
  }

  return (
    <PageShell title="Channel P&L" subtitle={`Same standardized structure as Master P&L — ${monthLabel(month)}`}>
      <div className="flex items-center justify-between">
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
        <button
          type="button"
          onClick={handleExport}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          Export
        </button>
      </div>
      <PnlTable lines={pnl.lines} currency={CHANNEL_MAP[channel].currency} />
    </PageShell>
  )
}
