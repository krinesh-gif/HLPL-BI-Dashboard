import { useMemo } from 'react'
import { PageShell } from '@/components/layout/PageShell'
import { useFilterStore } from '@/store/filterStore'
import { BUSINESS_CHANNEL_IDS } from '@/config/channels'
import { buildAllChannelPnlViews } from '@/engine/channelPnlRouter'
import { buildMasterPnl } from '@/engine/pnl'
import { usePnlInputs } from '@/engine/usePnlInputs'
import { buildMisRows } from '@/engine/mis'
import { formatCurrencyFull, formatPercent, monthLabel } from '@/lib/format'
import clsx from 'clsx'

export function MisPage() {
  const { month } = useFilterStore()
  const { forMonth } = usePnlInputs()

  const rows = useMemo(() => {
    const getLinesForMonth = (m: string) => {
      const views = buildAllChannelPnlViews(BUSINESS_CHANNEL_IDS, m, forMonth(m))
      return buildMasterPnl(views.map((v) => v.canonical), m).lines
    }
    return buildMisRows(month, getLinesForMonth)
  }, [forMonth, month])

  return (
    <PageShell title="Investor MIS" subtitle={`Management-level reporting for ${monthLabel(month)}`}>
      <div className="overflow-x-auto rounded-lg border border-[var(--line)] bg-[var(--surface)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--surface-2)]">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--ink-3)]">Particular</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-[var(--ink-3)]">Current Month</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-[var(--ink-3)]">Previous Month</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-[var(--ink-3)]">MoM</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-[var(--ink-3)]">YTD</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-[var(--ink-3)]">YoY</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.particular} className="border-t border-[var(--line)]">
                <td className={clsx('px-4 py-2.5', row.isPercent ? 'text-[var(--ink-3)]' : 'font-medium text-[var(--ink)]')}>{row.particular}</td>
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
  return <td className="px-4 py-2.5 text-right tabular-nums text-[var(--ink-2)]">{isPercent ? formatPercent(value) : formatCurrencyFull(value)}</td>
}

function DeltaCell({ value, isPercent }: { value: number | null; isPercent: boolean }) {
  if (value === null) return <td className="px-4 py-2.5 text-right text-[var(--ink-3)]">—</td>
  const tone = value >= 0 ? 'text-[var(--good-ink)]' : 'text-[var(--critical-ink)]'
  const suffix = isPercent ? ' pts' : '%'
  return (
    <td className={clsx('px-4 py-2.5 text-right tabular-nums font-medium', tone)}>
      {value >= 0 ? '▲' : '▼'} {Math.abs(value).toFixed(1)}
      {suffix}
    </td>
  )
}
