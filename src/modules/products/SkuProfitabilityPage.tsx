import { useMemo, useState } from 'react'
import { PageShell } from '@/components/layout/PageShell'
import { KPICard } from '@/components/ui/KPICard'
import { channelLabel, type BusinessChannelId } from '@/config/channels'
import { exportRowsToCsv } from '@/lib/exportCsv'
import { formatCurrencyFull, formatNumber, formatPercent, formatUnitCost, monthLabel } from '@/lib/format'
import {
  LOSS_CAUSE_LABELS, lossCause, summariseLosses,
  type MarginBasis, type SkuChannelMargin,
} from '@/engine/skuChannelMargin'
import { useSkuChannelMargins } from './useSkuChannelMargins'

type View = 'losers' | 'all'
type Floor = 0 | 5 | 25

const FLOORS: { value: Floor; label: string }[] = [
  { value: 0, label: 'Every product' },
  { value: 5, label: '5+ units' },
  { value: 25, label: '25+ units' },
]

/**
 * A fee or an ad spend is either what the channel billed for this product or
 * this product's share of what it billed for the month. The difference
 * decides whether a row is worth acting on alone or only worth reading as
 * part of a pattern, so it is on the row and not in a footnote.
 */
function BasisTag({ basis }: { basis: MarginBasis }) {
  if (basis === 'none') return null
  const text = basis === 'measured' ? 'stated' : basis === 'allocated' ? 'shared' : 'part shared'
  const tone = basis === 'measured'
    ? 'border-[var(--line-2)] text-[var(--ink-3)]'
    : 'border-[color-mix(in_oklab,var(--warning)_40%,transparent)] text-[var(--warning)]'
  return <span className={`ml-1.5 rounded border px-1 py-px text-[10px] font-medium ${tone}`}>{text}</span>
}

function Money({ value }: { value: number | null }) {
  if (value === null) return <span className="text-[var(--ink-3)]">—</span>
  return (
    <span className={value < 0 ? 'font-semibold text-[var(--critical)]' : 'text-[var(--ink)]'}>
      {formatCurrencyFull(value)}
    </span>
  )
}

/**
 * Which products lose money, on which channel, and what took them under.
 *
 * A channel P&L is an average and an average cannot be negative anywhere:
 * Myntra's September is comfortably in profit while fifteen of its products
 * are not, because the winners pay for the losers before the statement is
 * printed. This screen is the same month's figures taken apart by product, so
 * the losers can be repriced, delisted or de-advertised one at a time.
 */
export function SkuProfitabilityPage() {
  const { rows, channels, uncosted, month } = useSkuChannelMargins()
  const [view, setView] = useState<View>('losers')
  const [channel, setChannel] = useState<BusinessChannelId | 'all'>('all')
  const [floor, setFloor] = useState<Floor>(0)
  const [search, setSearch] = useState('')

  const scoped = useMemo(
    () => rows.filter((r) => channel === 'all' || r.channel === channel),
    [rows, channel],
  )
  const summary = useMemo(() => summariseLosses(scoped), [scoped])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return scoped.filter(
      (r) =>
        r.units >= floor &&
        (view === 'all' || (r.cm3 !== null && r.cm3 < 0)) &&
        (!q || r.sku.toLowerCase().includes(q) || r.productName.toLowerCase().includes(q) ||
          r.channelCodes.some((c) => c.toLowerCase().includes(q))),
    )
  }, [scoped, view, floor, search])

  const scaled = useMemo(() => channels.filter((c) => c.revenueScale !== null), [channels])
  const channelsWithRows = useMemo(
    () => channels.filter((c) => rows.some((r) => r.channel === c.channel)),
    [channels, rows],
  )

  function exportCsv() {
    exportRowsToCsv(
      `sku-channel-margin-${month}`,
      shown.map((r) => ({
        SKU: r.sku,
        Product: r.productName,
        Channel: channelLabel(r.channel),
        'Channel codes': r.channelCodes.join(' | '),
        Units: r.units,
        'Units that earned': r.earningUnits,
        'Returned / RTO units': r.returnedUnits,
        'Net sales': Math.round(r.netSales),
        'Revenue basis': r.revenueBasis === 'statement' ? 'channel statement' : 'order rows',
        'Unit cost': r.unitCost ?? '',
        COGS: r.cogs === null ? '' : Math.round(r.cogs),
        CM1: r.cm1 === null ? '' : Math.round(r.cm1),
        Fee: Math.round(r.fee),
        'Fee basis': r.feeBasis,
        CM2: r.cm2 === null ? '' : Math.round(r.cm2),
        Ads: Math.round(r.ads),
        'Ads basis': r.adsBasis,
        CM3: r.cm3 === null ? '' : Math.round(r.cm3),
        'CM3 %': r.cm3Pct === null ? '' : r.cm3Pct.toFixed(1),
        'What took it under': lossCause(r) ? LOSS_CAUSE_LABELS[lossCause(r)!] : '',
      })),
    )
  }

  return (
    <PageShell
      title="SKU × Channel Profitability"
      subtitle={`Which products lose money where — ${monthLabel(month)}`}
      showChannelFilter={false}
      headerActions={
        <button
          type="button"
          onClick={exportCsv}
          disabled={shown.length === 0}
          className="rounded-md border border-[var(--line-2)] px-3 py-1.5 text-sm font-medium text-[var(--ink-2)] hover:bg-[var(--surface-hover)] disabled:opacity-40"
        >
          Export CSV
        </button>
      }
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KPICard
          label="Products losing money"
          value={formatNumber(summary.losers)}
          note={`of ${formatNumber(summary.judged)} that could be judged`}
          tone={summary.losers > 0 ? 'bad' : 'good'}
          accent={3}
        />
        <KPICard
          label="Lost this month"
          value={formatCurrencyFull(summary.lostAmount)}
          note="after goods, fees and ads"
          tone={summary.lostAmount < 0 ? 'bad' : 'neutral'}
          accent={1}
        />
        <KPICard
          label="Revenue sold at a loss"
          value={summary.lostSharePct === null ? '—' : formatPercent(summary.lostSharePct)}
          note={`${formatCurrencyFull(summary.lostNetSales)} on ${formatNumber(summary.lostUnits)} units`}
          accent={2}
        />
        <KPICard
          label="Priced under cost"
          value={formatNumber(summary.belowCost)}
          note={uncosted > 0 ? `${formatNumber(uncosted)} more cannot be costed` : 'before any fee or ad'}
          tone={summary.belowCost > 0 ? 'bad' : 'neutral'}
          accent={4}
        />
      </div>

      {/* The point the screen exists to make, stated rather than left to be
          inferred from two numbers on different rows. */}
      {channelsWithRows.length > 0 && (
        <section className="mt-4 rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] p-4 shadow-[var(--shadow-card)]">
          <h3 className="text-sm font-semibold text-[var(--ink)]">What each channel is hiding</h3>
          <p className="mt-0.5 text-sm text-[var(--ink-2)]">
            A channel in profit can still be carrying products that are not. These are the same figures the Channel P&amp;L is built
            from, taken apart by product.
          </p>
          <div className="mt-3 overflow-x-auto rounded-md border border-[var(--line)]">
            <table className="w-full text-sm">
              <thead className="bg-[var(--surface-2)]">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--ink-3)]">Channel</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--ink-3)]">Net sales</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--ink-3)]">Channel CM3</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--ink-3)]">Losing products</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--ink-3)]">Lost inside it</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--ink-3)]">Revenue</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--ink-3)]">Fees</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--ink-3)]">Ads</th>
                </tr>
              </thead>
              <tbody>
                {channelsWithRows.map((c) => {
                  const own = summariseLosses(rows.filter((r) => r.channel === c.channel))
                  return (
                    <tr key={c.channel} className="border-t border-[var(--line)]">
                      <td className="px-3 py-1.5 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setChannel(c.channel)}
                          className="font-medium text-[var(--ink)] underline-offset-2 hover:underline"
                        >
                          {channelLabel(c.channel)}
                        </button>
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatCurrencyFull(c.netSales)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        <Money value={c.cm3} />
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(own.losers)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        <Money value={own.losers === 0 ? 0 : own.lostAmount} />
                      </td>
                      <td className="px-3 py-1.5 text-xs text-[var(--ink-3)]">
                        {c.revenueScale === null
                          ? 'from order rows'
                          : (
                            <span className="text-[var(--warning)]">
                              on statement · rows said {formatCurrencyFull(c.rowNetSales)}
                            </span>
                          )}
                      </td>
                      <td className="px-3 py-1.5 text-xs text-[var(--ink-3)]">
                        {c.feeBasis === 'none' ? 'none billed' : c.feeBasis === 'measured' ? 'per line' : c.feeBasis === 'allocated' ? 'shared from statement' : 'part shared'}
                      </td>
                      <td className="px-3 py-1.5 text-xs text-[var(--ink-3)]">
                        {c.adsBasis === 'none' ? 'none' : c.adsBasis === 'measured' ? 'per SKU' : c.adsBasis === 'allocated' ? 'shared by net sales' : 'part shared'}
                        {c.adsUnattributed > 0 && (
                          <span className="text-[var(--warning)]">
                            {' '}· {formatCurrencyFull(c.adsUnattributed)} unmatched
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="mt-4 rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] p-4 shadow-[var(--shadow-card)]">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border border-[var(--line-2)] p-0.5">
            {(['losers', 'all'] as View[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`rounded px-3 py-1 text-sm font-medium ${
                  view === v ? 'bg-[var(--surface-2)] text-[var(--ink)]' : 'text-[var(--ink-3)] hover:text-[var(--ink-2)]'
                }`}
              >
                {v === 'losers' ? 'Losing money' : 'Every product'}
              </button>
            ))}
          </div>
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value as BusinessChannelId | 'all')}
            aria-label="Channel"
            className="rounded-md border border-[var(--line-2)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
          >
            <option value="all">All channels</option>
            {channelsWithRows.map((c) => (
              <option key={c.channel} value={c.channel}>{channelLabel(c.channel)}</option>
            ))}
          </select>
          <select
            value={floor}
            onChange={(e) => setFloor(Number(e.target.value) as Floor)}
            aria-label="Minimum units"
            className="rounded-md border border-[var(--line-2)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
          >
            {FLOORS.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search SKU or product…"
            className="w-64 rounded-md border border-[var(--line-2)] px-3 py-1.5 text-sm focus:border-[var(--accent)] focus:outline-none"
          />
          <span className="ml-auto text-xs text-[var(--ink-3)]">
            {formatNumber(shown.length)} of {formatNumber(scoped.length)} rows
          </span>
        </div>

        {shown.length === 0 ? (
          <p className="mt-3 rounded-md border border-dashed border-[var(--line-2)] px-4 py-6 text-center text-sm text-[var(--ink-3)]">
            {scoped.length === 0
              ? `Nothing sold in ${monthLabel(month)} yet. Upload the month's files on Data → Data Upload.`
              : view === 'losers'
                ? 'No product on this channel loses money after goods, fees and ads. Switch to Every product to see the ladder.'
                : 'Nothing matches that search.'}
          </p>
        ) : (
          <div className="mt-3 max-h-[42rem] overflow-auto rounded-md border border-[var(--line)]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-[var(--surface-2)]">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--ink-3)]">Product</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--ink-3)]">Channel</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--ink-3)]">Units</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--ink-3)]">Net sales</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--ink-3)]">COGS</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--ink-3)]">CM1</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--ink-3)]">Fee</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--ink-3)]">CM2</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--ink-3)]">Ads</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--ink-3)]">CM3</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--ink-3)]">What took it under</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <Row key={`${r.channel}-${r.sku}`} row={r} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {scaled.length > 0 && (
          <p className="mt-3 rounded-md border border-[color-mix(in_oklab,var(--warning)_40%,transparent)] bg-[color-mix(in_oklab,var(--warning)_10%,transparent)] px-3 py-2 text-xs text-[var(--ink)]">
            {scaled.map((c) => channelLabel(c.channel)).join(', ')}{' '}
            {scaled.length === 1 ? 'sells' : 'sell'} wholesale, so{' '}
            {scaled.length === 1 ? 'its' : 'their'} sales file is written at MRP and is not revenue. Each product below is
            stated on what the channel&apos;s own statement earned instead, in proportion to what it sold — so this screen and the
            Channel P&amp;L state one revenue for the month. The gross column stays at MRP, which is what it is.
          </p>
        )}

        <p className="mt-3 text-xs text-[var(--ink-3)]">
          CM1 is after the goods, CM2 after the marketplace&apos;s fee, CM3 after advertising. There is no rung for returns: the rows
          state how many units came back, but what a return costs in freight is not on any file this app reads, and an invented
          rupee here would be acted on. A unit that was sent back still cost what it cost, which is why a well-priced product can
          show below cost — the cause column separates the two.
        </p>
      </section>
    </PageShell>
  )
}

function Row({ row }: { row: SkuChannelMargin }) {
  const cause = lossCause(row)
  const codes = row.channelCodes.join(' · ')
  // A code the Product Master has never heard of has no name to show, and
  // printing the code twice reads as a rendering fault.
  const named = row.productName.trim() !== '' && row.productName !== codes
  return (
    <tr className={`border-t border-[var(--line)] ${row.cm3 !== null && row.cm3 < 0 ? 'bg-[color-mix(in_oklab,var(--critical)_6%,transparent)]' : ''}`}>
      <td className="px-3 py-1.5">
        {named && <div className="font-medium text-[var(--ink)]">{row.productName}</div>}
        <div className={`font-mono text-[11px] ${named ? 'text-[var(--ink-3)]' : 'font-medium text-[var(--ink)]'}`}>{codes}</div>
        {!named && <div className="text-[11px] text-[var(--warning)]">not on the Product Master</div>}
      </td>
      <td className="px-3 py-1.5 whitespace-nowrap text-[var(--ink-2)]">{channelLabel(row.channel)}</td>
      <td className="px-3 py-1.5 text-right tabular-nums text-[var(--ink-2)]">
        {formatNumber(row.units)}
        {/* Units, not a percentage. A return of an order placed last month
            lands in this one, so the count can exceed what shipped — and
            "167% back" reads as a broken screen rather than as the timing
            difference it is. */}
        {row.returnedUnits > 0 && (
          <div className="text-[11px] text-[var(--warning)]">{formatNumber(row.returnedUnits)} back</div>
        )}
      </td>
      <td className="px-3 py-1.5 text-right tabular-nums">{formatCurrencyFull(row.netSales)}</td>
      <td className="px-3 py-1.5 text-right tabular-nums text-[var(--ink-2)]">
        {row.cogs === null ? <span className="text-[var(--ink-3)]">no cost</span> : formatCurrencyFull(row.cogs)}
        {row.unitCost !== null && (
          <div className="text-[11px] text-[var(--ink-3)]">{formatUnitCost(row.unitCost)}/unit</div>
        )}
      </td>
      <td className="px-3 py-1.5 text-right tabular-nums"><Money value={row.cm1} /></td>
      <td className="px-3 py-1.5 text-right tabular-nums text-[var(--ink-2)]">
        {row.fee === 0 ? '—' : formatCurrencyFull(row.fee)}
        <BasisTag basis={row.feeBasis} />
      </td>
      <td className="px-3 py-1.5 text-right tabular-nums"><Money value={row.cm2} /></td>
      <td className="px-3 py-1.5 text-right tabular-nums text-[var(--ink-2)]">
        {row.ads === 0 ? '—' : formatCurrencyFull(row.ads)}
        <BasisTag basis={row.adsBasis} />
      </td>
      <td className="px-3 py-1.5 text-right tabular-nums">
        <Money value={row.cm3} />
        {row.cm3Pct !== null && (
          <div className="text-[11px] text-[var(--ink-3)]">{formatPercent(row.cm3Pct, 0)}</div>
        )}
      </td>
      <td className="px-3 py-1.5 text-xs whitespace-nowrap text-[var(--ink-2)]">
        {cause ? LOSS_CAUSE_LABELS[cause] : ''}
      </td>
    </tr>
  )
}

export default SkuProfitabilityPage
