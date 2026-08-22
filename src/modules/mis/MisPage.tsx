import { useMemo } from 'react'
import { PageShell } from '@/components/layout/PageShell'
import { useDataStore } from '@/store/dataStore'
import { useFilterStore } from '@/store/filterStore'
import { CHANNELS } from '@/config/channels'
import { buildAllChannelPnlViews } from '@/engine/channelPnlRouter'
import { buildMasterPnl } from '@/engine/pnl'
import { marketingFromAds } from '@/engine/marketing'
import { buildMisRows } from '@/engine/mis'
import { formatCurrencyFull, formatPercent, monthLabel } from '@/lib/format'
import clsx from 'clsx'

export function MisPage() {
  const { salesRecords, adsRecords, skuMaster, fixedExpenses, flipkartFacts, amazonUsaFacts, meeshoFacts } = useDataStore()
  const { month } = useFilterStore()

  const rows = useMemo(() => {
    const getLinesForMonth = (m: string) => {
      const marketing = marketingFromAds(adsRecords, m)
      const views = buildAllChannelPnlViews(CHANNELS.map((c) => c.id), m, {
        salesRecords, skuMaster, fixedExpenses, marketing,
        facts: { flipkartFacts, amazonUsaFacts, meeshoFacts },
      })
      return buildMasterPnl(views.map((v) => v.canonical), m).lines
    }
    return buildMisRows(month, getLinesForMonth)
  }, [salesRecords, adsRecords, skuMaster, fixedExpenses, flipkartFacts, amazonUsaFacts, meeshoFacts, month])

  return (
    <PageShell title="Investor MIS" subtitle={`Management-level reporting for ${monthLabel(month)}`}>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">Particular</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500">Current Month</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500">Previous Month</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500">MoM</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500">YTD</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500">YoY</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.particular} className="border-t border-slate-100">
                <td className={clsx('px-4 py-2.5', row.isPercent ? 'text-slate-500' : 'font-medium text-slate-800')}>{row.particular}</td>
                <Cell value={row.currentMonth} isPercent={row.isPercent} />
                <Cell value={row.previousMonth} isPercent={row.isPercent} />
                <DeltaCell value={row.momPct} isPercent={row.isPercent} />
                <Cell value={row.ytd} isPercent={row.isPercent} />
                <DeltaCell value={row.yoyPct} isPercent={row.isPercent} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PageShell>
  )
}

function Cell({ value, isPercent }: { value: number; isPercent: boolean }) {
  return <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{isPercent ? formatPercent(value) : formatCurrencyFull(value)}</td>
}

function DeltaCell({ value, isPercent }: { value: number | null; isPercent: boolean }) {
  if (value === null) return <td className="px-4 py-2.5 text-right text-slate-400">—</td>
  const tone = value >= 0 ? 'text-emerald-600' : 'text-rose-600'
  const suffix = isPercent ? ' pts' : '%'
  return (
    <td className={clsx('px-4 py-2.5 text-right tabular-nums font-medium', tone)}>
      {value >= 0 ? '▲' : '▼'} {Math.abs(value).toFixed(1)}
      {suffix}
    </td>
  )
}
