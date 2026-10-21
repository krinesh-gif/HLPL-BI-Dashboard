import { useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { PageShell } from '@/components/layout/PageShell'
import { KPICard, KPIGrid } from '@/components/ui/KPICard'
import { TrendLineChart } from '@/components/charts/TrendLineChart'
import { EmptyState } from '@/components/ui/EmptyState'
import { useDataStore } from '@/store/dataStore'
import { fxRatesForMonth } from '@/data/fxRates'
import { usePnlInputs } from '@/engine/usePnlInputs'
import { useFilterStore } from '@/store/filterStore'
import { ADS_CHANNELS, ADS_CHANNEL_MAP, isAdsChannel, type AdsChannelId } from '@/config/adsChannels'
import { addMonths, formatCurrencyCompact, formatCurrencyFull, formatNumber, formatPercent, monthLabel } from '@/lib/format'
import { acosOf, adsSpendByProgram, adsSpendFor, measuredSpendOf, roasOf, tacos, type AdsProgramSpend } from '@/engine/adsSpend'
import { netSalesForChannelMonth } from '@/engine/netSales'
import { ManualAdSpendForm } from './ManualAdSpendForm'
import { MyntraAdsDepth } from './MyntraAdsDepth'
import { FlipkartAdsDepth } from './FlipkartAdsDepth'

const TREND_MONTHS = 6

/**
 * What the month was spent on, where the platform says.
 *
 * Amazon buys Sponsored Products, Brands and Display separately and names the
 * product on every row. They are different decisions — Sponsored Products
 * defends a listing someone is already searching for, Sponsored Brands buys
 * reach — so a single spend figure for the month cannot be managed. ROAS is
 * per product for the same reason: the blended number hides whichever of them
 * is not paying for itself.
 */
function ByProgram({ rows }: { rows: AdsProgramSpend[] }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] p-4 shadow-[var(--shadow-card)]">
      <h3 className="text-sm font-semibold text-[var(--ink-2)]">What it was spent on</h3>
      <table className="mt-2 w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--line)] text-xs uppercase tracking-wide text-[var(--ink-3)]">
            <th className="py-1.5 text-left font-semibold">Ad product</th>
            <th className="py-1.5 text-right font-semibold">Spend</th>
            <th className="py-1.5 text-right font-semibold">Share</th>
            <th className="py-1.5 text-right font-semibold">Ad sales</th>
            <th className="py-1.5 text-right font-semibold">ROAS</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.program ?? 'unlabelled'} className="border-b border-[var(--line)] last:border-0">
              <td className="py-1.5 font-medium text-[var(--ink)]">
                {r.program ?? <span className="text-[var(--ink-3)]">Not reported by product</span>}
              </td>
              <td className="py-1.5 text-right tabular-nums">{formatCurrencyFull(r.spend)}</td>
              <td className="py-1.5 text-right tabular-nums text-[var(--ink-3)]">{formatPercent(r.shareOfSpend, 0)}</td>
              <td className="py-1.5 text-right tabular-nums">{formatCurrencyFull(r.adSales)}</td>
              <td className="py-1.5 text-right tabular-nums">{r.roas === null ? '—' : `${r.roas.toFixed(2)}x`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** One advertising channel: its KPIs, its trend, and — where the platform bills
 * by invoice — the form for entering the month's figure. */
export function AdsChannelPage() {
  const { adsChannelId } = useParams<{ adsChannelId: string }>()
  const navigate = useNavigate()
  const { adsRecords, manualAdSpend, salesRecords, fxRates } = useDataStore()
  // One facts object, the same one the P&L is built from.
  const { inputs: { facts: pnlFacts } } = usePnlInputs()
  const { month } = useFilterStore()

  const channel = adsChannelId as AdsChannelId
  const def = isAdsChannel(adsChannelId ?? '') ? ADS_CHANNEL_MAP[channel] : undefined

  const data = useMemo(() => {
    if (!def) return null
    // An Amazon account billed in dirhams or dollars is converted at the
    // month's own rate, so every figure on this page is rupees.
    const figure = adsSpendFor(channel, month, adsRecords, manualAdSpend, fxRatesForMonth(month, fxRates), pnlFacts)
    const netSales = netSalesForChannelMonth({
      records: salesRecords, channel, month,
      facts: pnlFacts,
    }).netSales

    const trend = Array.from({ length: TREND_MONTHS }, (_, i) => {
      const m = addMonths(month, i - (TREND_MONTHS - 1))
      const f = adsSpendFor(channel, m, adsRecords, manualAdSpend, fxRatesForMonth(m, fxRates), pnlFacts)
      return {
        month: monthLabel(m),
        spend: f.spend,
        adSales: f.adSales,
        // Null, not zero, where it cannot be worked out — a month with no
        // report, or one entered by hand with no attributed sales behind it.
        // A nil return and an unmeasured one are different statements, and on
        // one chart with the spend a false nil drags the whole axis down to
        // meet it.
        roas: roasOf(f),
      }
    })

    // Only where the platform reports one: it is Amazon's split, and a
    // single row labelled "not reported by product" tells nobody anything.
    const byProgram = adsSpendByProgram(channel, month, adsRecords, fxRatesForMonth(month, fxRates))
    const programs = byProgram.length > 1 || byProgram.some((p) => p.program !== null) ? byProgram : []

    return { figure, netSales, trend, programs }
  }, [def, channel, month, adsRecords, manualAdSpend, salesRecords, pnlFacts, fxRates])

  if (!def || !data) {
    return (
      <PageShell title="Ads channel not found">
        <EmptyState title="Unknown ads channel" description="This advertising channel is not configured." />
      </PageShell>
    )
  }

  const { figure, netSales, trend, programs } = data
  // Measured against the campaign report's own spend where the billed figure
  // came from the statement: the sales and clicks were counted beside that
  // spend, on that calendar, so dividing by anything else states a return
  // neither source claims.
  const roas = roasOf(figure)
  const acos = acosOf(figure)
  const ctr = figure.impressions !== null && figure.impressions > 0 && figure.clicks !== null
    ? (figure.clicks / figure.impressions) * 100 : null
  const cpc = figure.clicks !== null && figure.clicks > 0 ? measuredSpendOf(figure) / figure.clicks : null
  const cvr = figure.clicks !== null && figure.clicks > 0 && figure.adOrders !== null
    ? (figure.adOrders / figure.clicks) * 100 : null

  return (
    <PageShell title={`${def.label} Ads`} subtitle={monthLabel(month)}>
      <label className="flex items-center gap-2 text-xs font-medium text-[var(--ink-3)]">
        Ads channel
        <select
          value={channel}
          onChange={(e) => navigate(`/marketing/ads/${e.target.value}`)}
          className="rounded-md border border-[var(--line-2)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
        >
          {ADS_CHANNELS.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>
      </label>

      {figure.source === 'manual' && (
        <div className="rounded-lg border border-[color-mix(in_oklab,var(--warning)_45%,transparent)] bg-[color-mix(in_oklab,var(--warning)_12%,transparent)] p-3 text-xs text-[var(--ink)]">
          This month's spend was entered by hand, not taken from a campaign report. It counts as real spend, but there are no
          impressions, clicks or attributed sales behind it, so ROAS, ACOS and CTR cannot be calculated.
        </div>
      )}

      <KPIGrid>
        <KPICard
          label="Ad Spend"
          value={figure.spend === 0 ? '—' : formatCurrencyCompact(figure.spend)}
          note={figure.reportedSpend === null
            ? figure.sourceLabel
            : `${figure.sourceLabel} · campaign report ${formatCurrencyFull(figure.reportedSpend)}`}
        />
        <KPICard label="Ad Sales" value={figure.adSales === null ? '—' : formatCurrencyCompact(figure.adSales)} />
        <KPICard label="ROAS" value={roas === null ? '—' : `${roas.toFixed(2)}x`} />
        <KPICard label="ACOS" value={acos === null ? '—' : formatPercent(acos)} />
        <KPICard
          label="TACOS"
          value={tacos(figure.spend, netSales) === null ? '—' : formatPercent(tacos(figure.spend, netSales)!)}
          note="Ad spend ÷ this channel's net sales"
        />
        <KPICard label="Orders" value={figure.adOrders === null ? '—' : formatNumber(figure.adOrders)} />
        <KPICard label="CTR" value={ctr === null ? '—' : formatPercent(ctr, 2)} />
        <KPICard label="CPC" value={cpc === null ? '—' : formatCurrencyFull(cpc)} />
        <KPICard label="CVR" value={cvr === null ? '—' : formatPercent(cvr, 2)} />
      </KPIGrid>

      {/* Dashes with no explanation read as a reporting failure. This is a
          choice about which file is uploaded, so the page says which. */}
      {figure.costOnly && figure.source === 'report' && (
        <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-3 text-xs text-[var(--ink-2)]">
          This month comes from the monthly cost report, which states what every ad product cost and nothing else.
          The spend is the figure the P&L charges. ROAS, ACOS, CTR and CPC need the per-product campaign reports —
          Sponsored Products, Brands and Display — which carry impressions, clicks and attributed sales.
        </div>
      )}

      {programs.length > 0 && <ByProgram rows={programs} />}

      {def.usesMonthlyInvoice && <ManualAdSpendForm channel={channel} def={def} month={month} current={figure} />}

      {/* One chart, because the question is whether the two move together:
          spending more and earning less per rupee is the thing worth seeing,
          and it is invisible when the two lines are in separate frames.
          They have no common scale — rupees against a multiple — so ROAS
          takes the right-hand axis and is drawn dashed, and the caption says
          which side each is read on. */}
      <div className="rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-card)] p-4">
        <h3 className="text-sm font-semibold text-[var(--ink-2)]">Ad spend and ROAS</h3>
        <p className="mb-2 text-xs text-[var(--ink-3)]">
          Spend in rupees on the left, ROAS as a multiple on the right. The two scales are set by their own
          figures, so where the lines cross means nothing — read each against its own side.
        </p>
        <TrendLineChart
          data={trend}
          xKey="month"
          height={300}
          series={[
            { key: 'spend', label: 'Ad spend', color: 'var(--series-1)', valueFormatter: (v) => formatCurrencyCompact(v) },
            { key: 'roas', label: 'ROAS', axis: 'right', dash: true, color: 'var(--series-2)', valueFormatter: (v) => `${v.toFixed(2)}x` },
          ]}
        />
      </div>

      {/* Myntra's report carries campaign states, a direct/indirect split and
          three dayparts that no other platform's does, so it has a section
          the shared KPIs cannot hold. */}
      {channel === 'myntra' && <MyntraAdsDepth month={month} />}

      {/* Flipkart's report is the one that can be held against a figure the
          channel already bills, and the only one with a per-product split, so
          it gets its own section too. */}
      {channel === 'flipkart' && <FlipkartAdsDepth month={month} />}

      {figure.source === 'none' && !def.usesMonthlyInvoice && (
        <EmptyState
          title={`No ${def.label} ads data for ${monthLabel(month)}.`}
          description="Upload this channel's advertising report on the Data Upload page."
        />
      )}
    </PageShell>
  )
}
