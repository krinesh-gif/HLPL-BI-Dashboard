import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { PageShell } from '@/components/layout/PageShell'
import { KPICard, KPIGrid } from '@/components/ui/KPICard'
import { ComparisonBarChart } from '@/components/charts/ComparisonBarChart'
import { useDataStore } from '@/store/dataStore'
import { useFilterStore } from '@/store/filterStore'
import { ADS_CHANNELS } from '@/config/adsChannels'
import { formatCurrencyCompact, formatCurrencyFull, formatPercent, monthLabel } from '@/lib/format'
import { adsSpendForMonth, tacos, totalAdsSpend } from '@/engine/adsSpend'
import { netSalesForMonth } from '@/engine/netSales'
import { exportRowsToCsv } from '@/lib/exportCsv'

/**
 * Total advertising investment across the company, so management can see what
 * is being spent in one place rather than a channel at a time.
 */
export function AdsOverviewPage() {
  const { adsRecords, manualAdSpend, salesRecords, flipkartFacts, amazonUsaFacts, meeshoFacts } = useDataStore()
  const { month } = useFilterStore()

  const { figures, totals, netSales } = useMemo(() => {
    const figures = adsSpendForMonth(month, adsRecords, manualAdSpend)
    return {
      figures,
      totals: totalAdsSpend(figures),
      netSales: netSalesForMonth(salesRecords, month, { flipkartFacts, amazonUsaFacts, meeshoFacts }).netSales,
    }
  }, [adsRecords, manualAdSpend, salesRecords, flipkartFacts, amazonUsaFacts, meeshoFacts, month])

  const label = (id: string) => ADS_CHANNELS.find((c) => c.id === id)?.label ?? id

  function handleExport() {
    exportRowsToCsv(
      `HLPL_Ads_AllChannels_${month}`,
      figures.map((f) => ({
        Channel: label(f.channel),
        Spend: Math.round(f.spend),
        'Ad Sales': f.adSales === null ? '' : Math.round(f.adSales),
        ROAS: f.adSales !== null && f.spend > 0 ? Number((f.adSales / f.spend).toFixed(2)) : '',
        'ACOS %': f.adSales !== null && f.adSales > 0 ? Number(((f.spend / f.adSales) * 100).toFixed(1)) : '',
        Source: f.sourceLabel,
      })),
    )
  }

  const companyTacos = tacos(totals.spend, netSales)

  return (
    <PageShell title="Ads Overview" subtitle={`Advertising investment across every channel — ${monthLabel(month)}`}>
      <KPIGrid>
        <KPICard
          label="Total Ad Spend"
          value={formatCurrencyCompact(totals.spend)}
          note={totals.includesManual ? 'Includes manually entered figures' : undefined}
        />
        <KPICard label="Ad Sales" value={totals.adSales === null ? '—' : formatCurrencyCompact(totals.adSales)} />
        <KPICard label="ROAS" value={totals.roas === null ? '—' : `${totals.roas.toFixed(2)}x`} />
        <KPICard label="ACOS" value={totals.acos === null ? '—' : formatPercent(totals.acos)} />
        <KPICard label="TACOS" value={companyTacos === null ? '—' : formatPercent(companyTacos)} note="Ad spend ÷ company net sales" />
      </KPIGrid>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleExport}
          className="rounded-md border border-[var(--line-2)] px-3 py-1.5 text-sm font-medium text-[var(--ink-2)] hover:bg-[var(--surface-hover)]"
        >
          Export CSV
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[var(--line)] bg-[var(--surface)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--surface-2)]">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--ink-3)]">Ads Channel</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--ink-3)]">Spend</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--ink-3)]">Ad Sales</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--ink-3)]">ROAS</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--ink-3)]">ACOS</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--ink-3)]">Source</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {figures.map((f) => (
              <tr key={f.channel} className="border-t border-[var(--line)]">
                <td className="px-3 py-2 font-medium text-[var(--ink)]">{label(f.channel)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-[var(--ink)]">
                  {f.spend === 0 ? '—' : formatCurrencyFull(f.spend)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-[var(--ink-2)]">
                  {f.adSales === null ? <span className="text-xs italic text-[var(--ink-3)]">not measured</span> : formatCurrencyFull(f.adSales)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-[var(--ink-2)]">
                  {f.adSales !== null && f.spend > 0 ? `${(f.adSales / f.spend).toFixed(2)}x` : '—'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-[var(--ink-2)]">
                  {f.adSales !== null && f.adSales > 0 ? formatPercent((f.spend / f.adSales) * 100) : '—'}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs ${
                      f.source === 'report'
                        ? 'border-[color-mix(in_oklab,var(--good)_35%,transparent)] bg-[color-mix(in_oklab,var(--good)_10%,transparent)] text-[var(--good-ink)]'
                        : f.source === 'manual'
                          ? 'border-[color-mix(in_oklab,var(--warning)_35%,transparent)] bg-[color-mix(in_oklab,var(--warning)_12%,transparent)] text-[var(--ink-2)]'
                          : 'border-[var(--line)] bg-[var(--surface-2)] text-[var(--ink-3)]'
                    }`}
                  >
                    {f.sourceLabel}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <Link to={`/marketing/ads/${f.channel}`} className="text-xs font-medium text-[var(--accent)] hover:opacity-80">
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-[var(--line-2)] bg-[var(--surface-2)] font-semibold">
              <td className="px-3 py-2 text-[var(--ink)]">Total</td>
              <td className="px-3 py-2 text-right tabular-nums text-[var(--ink)]">{formatCurrencyFull(totals.spend)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-[var(--ink-2)]">
                {totals.adSales === null ? '—' : formatCurrencyFull(totals.adSales)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-[var(--ink-2)]">
                {totals.roas === null ? '—' : `${totals.roas.toFixed(2)}x`}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-[var(--ink-2)]">
                {totals.acos === null ? '—' : formatPercent(totals.acos)}
              </td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>

      {totals.includesManual && (
        <p className="text-xs text-[var(--ink-3)]">
          ROAS and ACOS are measured only against spend that came with attributed sales. A manually entered figure is real money and
          counts towards total spend and TACOS, but it carries no attributed sales, so including it in ROAS would understate the
          return on the campaigns that were actually measured.
        </p>
      )}

      {figures.some((f) => f.spend > 0) && (
        <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
          <h3 className="mb-2 text-sm font-semibold text-[var(--ink-2)]">Ad spend by channel</h3>
          <ComparisonBarChart
            data={figures.filter((f) => f.spend > 0).map((f) => ({ name: label(f.channel), value: f.spend }))}
            xKey="name" yKey="value" horizontal
            valueFormatter={(v) => formatCurrencyCompact(v)}
          />
        </div>
      )}
    </PageShell>
  )
}
