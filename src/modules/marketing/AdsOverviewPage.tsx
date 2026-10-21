import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { PageShell } from '@/components/layout/PageShell'
import { KPICard, KPIGrid } from '@/components/ui/KPICard'
import { ComparisonBarChart } from '@/components/charts/ComparisonBarChart'
import { useDataStore } from '@/store/dataStore'
import { fxRatesForMonth } from '@/data/fxRates'
import { usePnlInputs } from '@/engine/usePnlInputs'
import { useFilterStore } from '@/store/filterStore'
import { ADS_CHANNELS } from '@/config/adsChannels'
import { formatCurrencyCompact, formatCurrencyFull, formatPercent, monthLabel } from '@/lib/format'
import { acosOf, adsSpendForMonth, paidShare, roasOf, tacos, totalAdsSpend } from '@/engine/adsSpend'
import { netSalesForChannelMonth, netSalesForMonth } from '@/engine/netSales'
import { exportRowsToCsv } from '@/lib/exportCsv'

/**
 * Total advertising investment across the company, so management can see what
 * is being spent in one place rather than a channel at a time.
 */
export function AdsOverviewPage() {
  const { adsRecords, manualAdSpend, salesRecords, fxRates } = useDataStore()
  // One facts object, the same one the P&L is built from.
  const { inputs: { facts: pnlFacts } } = usePnlInputs()
  const { month } = useFilterStore()

  const { figures, totals, netSales, grossSalesOf, paidTotals } = useMemo(() => {
    const fx = fxRatesForMonth(month, fxRates)
    const figures = adsSpendForMonth(month, adsRecords, manualAdSpend, undefined, fx, pnlFacts)
    // Each channel's own gross sales, read the way the P&L reads it — the
    // statement where there is one, the order rows otherwise.
    //
    // Gross and not net, because gross is the basis a platform attributes
    // on: it credits the order as the customer placed it, before returns and
    // including GST. Against net, Flipkart's September read 111% paid.
    const grossSalesOf = new Map(figures.map((f) => [
      f.channel,
      netSalesForChannelMonth({ records: salesRecords, channel: f.channel, month, facts: pnlFacts, fxRate: fx }).grossSales,
    ]))
    // Only the channels whose report attributes sales. Counting a channel
    // that measures nothing as wholly organic would invent the answer: not
    // knowing what advertising did is not knowing it did nothing.
    const measured = figures.filter((f) => f.adSales !== null)
    const paidSales = measured.reduce((sum, f) => sum + (f.adSales ?? 0), 0)
    const measuredGrossSales = measured.reduce((sum, f) => sum + (grossSalesOf.get(f.channel) ?? 0), 0)
    return {
      figures,
      grossSalesOf,
      totals: totalAdsSpend(figures),
      netSales: netSalesForMonth(salesRecords, month, pnlFacts).netSales,
      paidTotals: {
        channels: measured.length,
        paidSales,
        grossSales: measuredGrossSales,
        organicSales: Math.max(measuredGrossSales - paidSales, 0),
        paidPct: paidShare(measured.length > 0 ? paidSales : null, measuredGrossSales),
      },
    }
  }, [adsRecords, manualAdSpend, salesRecords, pnlFacts, month, fxRates])

  const label = (id: string) => ADS_CHANNELS.find((c) => c.id === id)?.label ?? id

  function handleExport() {
    exportRowsToCsv(
      `HLPL_Ads_AllChannels_${month}`,
      figures.map((f) => ({
        Channel: label(f.channel),
        Spend: Math.round(f.spend),
        'Ad Sales': f.adSales === null ? '' : Math.round(f.adSales),
        'Campaign report spend': f.reportedSpend === null ? '' : Math.round(f.reportedSpend),
        ROAS: roasOf(f) === null ? '' : Number(roasOf(f)!.toFixed(2)),
        'ACOS %': acosOf(f) === null ? '' : Number(acosOf(f)!.toFixed(1)),
        'Gross Sales': Math.round(grossSalesOf.get(f.channel) ?? 0),
        'Paid share %': paidShare(f.adSales, grossSalesOf.get(f.channel) ?? 0) === null
          ? ''
          : Number(paidShare(f.adSales, grossSalesOf.get(f.channel) ?? 0)!.toFixed(1)),
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
        <KPICard
          label="Paid share"
          value={paidTotals.paidPct === null ? '—' : formatPercent(paidTotals.paidPct)}
          note={paidTotals.channels === 0
            ? 'No channel attributes sales this month'
            : `Organic ${formatPercent(Math.max(100 - paidTotals.paidPct!, 0))} of gross sales · across the ${paidTotals.channels} channel${paidTotals.channels === 1 ? '' : 's'} that measure it`}
        />
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

      <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-card)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--surface-2)]">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--ink-3)]">Ads Channel</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--ink-3)]">Spend</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--ink-3)]">Ad Sales</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--ink-3)]">ROAS</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--ink-3)]">ACOS</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--ink-3)]">Paid share</th>
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
                  {/* The campaign report's own figure, where it differs. The
                      two are cut differently — the statement on the billing
                      cycle, the report on campaign dates — and a reader who
                      has the report open is owed the number in it rather than
                      being left to wonder which of the two is broken. */}
                  {f.reportedSpend !== null && (
                    <div className="text-[11px] font-normal text-[var(--ink-3)]">
                      report: {formatCurrencyFull(f.reportedSpend)}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-[var(--ink-2)]">
                  {f.adSales === null ? <span className="text-xs italic text-[var(--ink-3)]">not measured</span> : formatCurrencyFull(f.adSales)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-[var(--ink-2)]">
                  {roasOf(f) === null ? '—' : `${roasOf(f)!.toFixed(2)}x`}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-[var(--ink-2)]">
                  {acosOf(f) === null ? '—' : formatPercent(acosOf(f)!)}
                </td>
                {/* What share of this channel's gross sales the platform
                    credits to its advertising — gross, because gross is what
                    it attributes on. The rest is not proved organic; it is
                    what advertising was not credited with. */}
                <td className="px-3 py-2 text-right tabular-nums text-[var(--ink-2)]">
                  {paidShare(f.adSales, grossSalesOf.get(f.channel) ?? 0) === null
                    ? '—'
                    : formatPercent(paidShare(f.adSales, grossSalesOf.get(f.channel) ?? 0)!)}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs ${
                      f.source === 'report' || f.source === 'statement'
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
              <td className="px-3 py-2 text-right tabular-nums text-[var(--ink-2)]">
                {paidTotals.paidPct === null ? '—' : formatPercent(paidTotals.paidPct)}
              </td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>

      {paidTotals.paidPct !== null && (
        <p className="text-xs text-[var(--ink-3)]">
          <strong className="text-[var(--ink-2)]">Paid share</strong> is what the platform credits to its own advertising:
          {' '}{formatCurrencyFull(paidTotals.paidSales)} of {formatCurrencyFull(paidTotals.grossSales)} in gross sales across
          the {paidTotals.channels} channel{paidTotals.channels === 1 ? '' : 's'} that measure it, leaving
          {' '}{formatCurrencyFull(paidTotals.organicSales)} not credited to an ad. Gross on both sides, because a platform
          attributes the order as the customer placed it — before returns and including GST. Read it as a ceiling rather than
          a measurement: a sale counts as paid when the buyer saw or clicked an ad inside the attribution window, whether or
          not the ad is why they bought. Channels with no attribution are left out rather than counted as organic — not
          knowing what advertising did is not knowing it did nothing.
        </p>
      )}

      {totals.hasBilledDifference && (
        <p className="text-xs text-[var(--ink-3)]">
          Where a marketplace bills advertising inside the statement it settles on — Flipkart's Ads and Google Ads lines, Amazon
          USA's Sponsored Products charge — that billed figure is the spend shown, because it is the money the platform took and
          it is what the P&amp;L charges. The campaign report below it is the platform's own measurement, cut on campaign dates
          rather than on the billing cycle, so the two differ month to month while agreeing over a period. ROAS and ACOS are
          measured against the report's spend, since the attributed sales were counted beside it.
        </p>
      )}

      {totals.includesManual && (
        <p className="text-xs text-[var(--ink-3)]">
          ROAS and ACOS are measured only against spend that came with attributed sales. A manually entered figure is real money and
          counts towards total spend and TACOS, but it carries no attributed sales, so including it in ROAS would understate the
          return on the campaigns that were actually measured.
        </p>
      )}

      {figures.some((f) => f.spend > 0) && (
        <div className="rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-card)] p-4">
          <h3 className="mb-2 text-sm font-semibold text-[var(--ink-2)]">Ad spend by channel</h3>
          <ComparisonBarChart
            data={figures.filter((f) => f.spend > 0).map((f) => ({ name: label(f.channel), value: f.spend }))}
            xKey="name" yKey="value" horizontal
            valueFormatter={(v) => formatCurrencyCompact(v)}
            tooltipFormatter={(v) => formatCurrencyFull(v)}
            valueLabel="Ad spend"
          />
        </div>
      )}
    </PageShell>
  )
}
