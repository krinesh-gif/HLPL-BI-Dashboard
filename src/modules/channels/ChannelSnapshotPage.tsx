import { useParams, Link } from 'react-router-dom'
import { useDataStore } from '@/store/dataStore'
import { useFilterStore } from '@/store/filterStore'
import { ChannelMark } from '@/components/ui/ChannelMark'
import { TrendLineChart } from '@/components/charts/TrendLineChart'
import { BUSINESS_CHANNEL_MAP, type BusinessChannelId } from '@/config/channels'
import { formatCurrencyCompact, formatCurrencyFull, formatNumber, formatPercent, monthLabel, currencyName } from '@/lib/format'
import { useChannelData } from './useChannelData'

/**
 * One channel, one month, on one page, for the person who runs that channel.
 *
 * The owner sends this to a marketplace manager who has no account and no
 * business seeing the rest of the company. So it carries what that person acts
 * on — what sold, to how many people, how much came back, which products led —
 * and nothing that belongs to the business as a whole: no cost of goods, no
 * margin, no overhead allocation, no other channel.
 *
 * It is a page rather than a generated image on purpose. The browser's own
 * Save-as-PDF turns it into a file that can be attached, and a screenshot of
 * it is a picture that can be pasted into a chat, so neither needs a rendering
 * service the deployment does not have.
 *
 * It states the month, the report behind the figures and the date it was taken
 * at the top, because a snapshot's whole risk is being read weeks later as
 * though it were current.
 */
export function ChannelSnapshotPage() {
  const { channelId } = useParams<{ channelId: string }>()
  const channel = channelId as BusinessChannelId
  const channelDef = BUSINESS_CHANNEL_MAP[channel]
  const d = useChannelData(channel)
  const month = useFilterStore((s) => s.month)
  const setMonth = useFilterStore((s) => s.setMonth)
  const { salesRecords } = useDataStore()

  const months = [...new Set(salesRecords.map((r) => r.orderDate.slice(0, 7)))].filter(Boolean).sort().reverse()
  const takenOn = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

  if (!channelDef) {
    return <div className="p-10 text-sm text-[var(--ink-3)]">Unknown channel.</div>
  }

  const money = (v: number) => formatCurrencyFull(v, d.displayCurrency)

  return (
    <div className="mx-auto w-full max-w-[860px] px-6 py-6 print:max-w-none print:p-0">
      {/* Everything the recipient should not receive lives here, and prints
          as nothing. */}
      <div className="mb-4 flex flex-wrap items-center gap-3 print:hidden">
        <Link to={`/channels/${channel}`} className="text-sm font-medium text-[var(--accent)] hover:underline">
          ← Back to {channelDef.label}
        </Link>
        <label className="ml-auto flex items-center gap-2 text-xs font-medium text-[var(--ink-3)]">
          Month
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-md border border-[var(--line-2)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
          >
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </label>
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-[var(--radius-control)] bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-ink)] transition-opacity hover:opacity-90"
        >
          Save as PDF
        </button>
      </div>
      <p className="mb-4 text-xs text-[var(--ink-3)] print:hidden">
        Save as PDF to attach it, or screenshot the card below to paste into a chat. It carries sales and volume
        only — no costs, no margins and no other channel.
      </p>

      {/* ---- The card itself. This is what gets sent. ------------------- */}
      <div className="rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[var(--shadow-card)] print:rounded-none print:border-0 print:shadow-none">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--line)] pb-4">
          <div>
            <ChannelMark channel={channel} className="block text-xl font-bold text-[var(--ink)]" />
            <div className="mt-1 text-[15px] font-semibold text-[var(--ink)]">{monthLabel(month)}</div>
          </div>
          <div className="text-right text-[11px] leading-snug text-[var(--ink-3)]">
            <div className="font-semibold text-[var(--ink-2)]">Aravi Organic</div>
            <div>Hivefy Lifestyle Pvt Ltd</div>
            <div className="mt-1">Taken on {takenOn}</div>
          </div>
        </header>

        {d.partialSettlementWarning && (
          <p className="mt-4 rounded-md border border-[color-mix(in_oklab,var(--warning)_45%,transparent)] bg-[color-mix(in_oklab,var(--warning)_12%,transparent)] px-3 py-2 text-xs text-[var(--ink-2)]">
            <span className="font-semibold">This month may be incomplete.</span> {d.partialSettlementWarning}
          </p>
        )}

        <div className="mt-5 grid grid-cols-4 gap-x-4 gap-y-5">
          <Figure label="Net Sales" value={formatCurrencyCompact(d.currentFacts.netSales, d.displayCurrency)} big />
          <Figure label="Units" value={formatNumber(d.currentFacts.units)} big />
          <Figure label="Orders" value={d.orders === null ? '—' : formatNumber(d.orders)} big
            foot={d.orders === null ? 'not in this channel’s report' : undefined} />
          <Figure
            label="Growth vs last month"
            value={d.growth === null ? '—' : `${d.growth >= 0 ? '+' : ''}${formatPercent(d.growth)}`}
            big
            tone={d.growth === null ? undefined : d.growth >= 0 ? 'good' : 'bad'}
          />
          <Figure label="AOV" value={d.aov === null ? '—' : formatCurrencyCompact(d.aov, d.displayCurrency)} />
          <Figure label="ASP" value={formatCurrencyCompact(d.asp, d.displayCurrency)} />
          <Figure label="RTO %" value={formatPercent(d.rtoRate)} tone={d.rtoRate > 5 ? 'bad' : undefined} />
          <Figure label="Returns %" value={formatPercent(d.returnRate)} />
        </div>

        <section className="mt-6">
          <h2 className="text-[13px] font-semibold text-[var(--ink-2)]">Net sales, last six months</h2>
          <div className="mt-1">
            <TrendLineChart
              data={d.trend.map((t) => ({ month: t.month, netSales: t.netSales }))}
              xKey="month"
              series={[{ key: 'netSales', label: 'Net Sales' }]}
              height={180}
              valueFormatter={(v) => money(v)}
            />
          </div>
        </section>

        <section className="mt-5">
          <h2 className="text-[13px] font-semibold text-[var(--ink-2)]">Top products this month</h2>
          {d.topSkus.length === 0 ? (
            <p className="mt-2 text-xs text-[var(--ink-3)]">No product-level rows for this month.</p>
          ) : (
            <table className="mt-2 w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--line)] text-[var(--ink-3)]">
                  <th className="py-1.5 text-left font-semibold">Uniware SKU</th>
                  <th className="py-1.5 text-right font-semibold">Net Sales</th>
                  <th className="py-1.5 text-right font-semibold">Units</th>
                  <th className="py-1.5 text-right font-semibold">Share</th>
                </tr>
              </thead>
              <tbody>
                {d.topSkus.map((s) => (
                  <tr key={s.sku} className="border-b border-[var(--line)] last:border-0">
                    <td className="py-1.5 pr-3">
                      <div className="font-mono text-[var(--ink)]">{s.internalSku}</div>
                      <div className="text-[11px] text-[var(--ink-3)]">{s.productName}</div>
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-[var(--ink)]">{money(s.netSales)}</td>
                    <td className="py-1.5 text-right tabular-nums text-[var(--ink-2)]">{formatNumber(s.units)}</td>
                    <td className="py-1.5 text-right tabular-nums text-[var(--ink-3)]">
                      {d.currentFacts.netSales > 0 ? formatPercent((s.netSales / d.currentFacts.netSales) * 100) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Where the figures came from. A number sent out of the dashboard is
            read without any of the dashboard around it, so the report behind
            it travels with it. */}
        <footer className="mt-5 border-t border-[var(--line)] pt-3 text-[11px] leading-snug text-[var(--ink-3)]">
          Built from {d.sourceLabel}. Figures are in {currencyName(d.displayCurrency)} and
          cover orders placed in {monthLabel(month)}.
        </footer>
      </div>
    </div>
  )
}

function Figure({
  label, value, foot, big = false, tone,
}: { label: string; value: string; foot?: string; big?: boolean; tone?: 'good' | 'bad' }) {
  return (
    <div>
      <div className="text-[11px] font-medium text-[var(--ink-3)]">{label}</div>
      <div
        className={`mt-0.5 font-bold tabular-nums tracking-[-0.02em] ${big ? 'text-[20px]' : 'text-[16px]'} ${
          tone === 'good' ? 'text-[var(--good-ink)]' : tone === 'bad' ? 'text-[var(--critical-ink)]' : 'text-[var(--ink)]'
        }`}
      >
        {value}
      </div>
      {foot && <div className="mt-0.5 text-[10px] leading-tight text-[var(--ink-3)]">{foot}</div>}
    </div>
  )
}
