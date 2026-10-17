import { useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { PageShell } from '@/components/layout/PageShell'
import { KPICard, KPIGrid } from '@/components/ui/KPICard'
import { TrendLineChart } from '@/components/charts/TrendLineChart'
import { EmptyState } from '@/components/ui/EmptyState'
import { useDataStore } from '@/store/dataStore'
import { useFilterStore } from '@/store/filterStore'
import { ADS_CHANNELS, ADS_CHANNEL_MAP, isAdsChannel, type AdsChannelId } from '@/config/adsChannels'
import { addMonths, formatCurrencyCompact, formatCurrencyFull, formatNumber, formatPercent, monthLabel } from '@/lib/format'
import { adsSpendFor, tacos } from '@/engine/adsSpend'
import { netSalesForChannelMonth } from '@/engine/netSales'
import { ManualAdSpendForm } from './ManualAdSpendForm'
import { MyntraAdsDepth } from './MyntraAdsDepth'
import { FlipkartAdsDepth } from './FlipkartAdsDepth'

const TREND_MONTHS = 6

/** One advertising channel: its KPIs, its trend, and — where the platform bills
 * by invoice — the form for entering the month's figure. */
export function AdsChannelPage() {
  const { adsChannelId } = useParams<{ adsChannelId: string }>()
  const navigate = useNavigate()
  const { adsRecords, manualAdSpend, salesRecords, flipkartFacts, amazonUsaFacts, meeshoFacts, myntraFacts, nykaaFacts } = useDataStore()
  const { month } = useFilterStore()

  const channel = adsChannelId as AdsChannelId
  const def = isAdsChannel(adsChannelId ?? '') ? ADS_CHANNEL_MAP[channel] : undefined

  const data = useMemo(() => {
    if (!def) return null
    const figure = adsSpendFor(channel, month, adsRecords, manualAdSpend)
    const netSales = netSalesForChannelMonth({
      records: salesRecords, channel, month,
      facts: { flipkartFacts, amazonUsaFacts, meeshoFacts, myntraFacts, nykaaFacts },
    }).netSales

    const trend = Array.from({ length: TREND_MONTHS }, (_, i) => {
      const m = addMonths(month, i - (TREND_MONTHS - 1))
      const f = adsSpendFor(channel, m, adsRecords, manualAdSpend)
      return {
        month: monthLabel(m),
        spend: f.spend,
        adSales: f.adSales,
        // Null, not zero, where it cannot be worked out — a month with no
        // report, or one entered by hand with no attributed sales behind it.
        // A nil return and an unmeasured one are different statements, and on
        // one chart with the spend a false nil drags the whole axis down to
        // meet it.
        roas: f.adSales !== null && f.spend > 0 ? f.adSales / f.spend : null,
      }
    })

    return { figure, netSales, trend }
  }, [def, channel, month, adsRecords, manualAdSpend, salesRecords, flipkartFacts, amazonUsaFacts, meeshoFacts, myntraFacts, nykaaFacts])

  if (!def || !data) {
    return (
      <PageShell title="Ads channel not found">
        <EmptyState title="Unknown ads channel" description="This advertising channel is not configured." />
      </PageShell>
    )
  }

  const { figure, netSales, trend } = data
  const roas = figure.adSales !== null && figure.spend > 0 ? figure.adSales / figure.spend : null
  const acos = figure.adSales !== null && figure.adSales > 0 ? (figure.spend / figure.adSales) * 100 : null
  const ctr = figure.impressions !== null && figure.impressions > 0 && figure.clicks !== null
    ? (figure.clicks / figure.impressions) * 100 : null
  const cpc = figure.clicks !== null && figure.clicks > 0 ? figure.spend / figure.clicks : null
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
        <KPICard label="Ad Spend" value={figure.spend === 0 ? '—' : formatCurrencyCompact(figure.spend)} note={figure.sourceLabel} />
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
