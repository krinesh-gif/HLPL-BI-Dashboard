import { PageShell } from '@/components/layout/PageShell'
import { Link } from 'react-router-dom'
import { channelLabel, SOURCE_MAP, channelOfSource } from '@/config/channels'
import type { SalesSourceId } from '@/config/channels'
import { DEFAULT_CHANNEL_FEE_RATES } from '@/config/marketplaceFees'

export function SettingsPage() {
  return (
    <PageShell
      title="Settings"
      subtitle="What this dashboard assumes, and where the figures you control are entered"
      showFilters={false}
    >
      <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4 text-sm text-[var(--ink-2)]">
        <h3 className="mb-2 text-sm font-semibold text-[var(--ink)]">Where to change things</h3>
        <ul className="space-y-1.5">
          <li>
            <Link to="/settings/monthly-inputs" className="font-medium text-[var(--accent)] hover:underline">
              Monthly Inputs
            </Link>{' '}
            — the exchange rate, both freight rates, Nykaa&apos;s confirmed discount and the month&apos;s fixed
            expenses. These are the figures that change your P&amp;L.
          </li>
          <li>
            <Link to="/products/cost-sheet" className="font-medium text-[var(--accent)] hover:underline">
              Catalogue → Cost
            </Link>{' '}
            — what each product costs, dated by month.
          </li>
          <li>
            <Link to="/settings/team" className="font-medium text-[var(--accent)] hover:underline">
              Team
            </Link>{' '}
            — who can sign in and which sections each of them can open.
          </li>
        </ul>
        <p className="mt-3 text-xs text-[var(--ink-3)]">
          This page used to list the engine&apos;s internal thresholds — insight triggers, allocation fallbacks and
          the like. They were read-only, named after the code rather than the business, and changed nothing you
          could see, so they have been taken out. If one of them is worth controlling, say which and it will be
          made editable properly.
        </p>
      </div>

      <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
        <h3 className="text-sm font-semibold text-[var(--ink)]">Assumed marketplace fees</h3>
        <p className="mb-3 mt-1 text-xs text-[var(--ink-3)]">
          Used only for a channel-month with no charge report uploaded yet. Once a real settlement or fee
          report is in, the actual charges replace every figure here.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold text-[var(--ink-3)]">
                <th className="py-1.5 pr-4">Channel</th>
                <th className="py-1.5 pr-4 text-right">Commission %</th>
                <th className="py-1.5 pr-4 text-right">Fulfilment %</th>
                <th className="py-1.5 pr-4 text-right">Shipping %</th>
                <th className="py-1.5 pr-4 text-right">Collection %</th>
                <th className="py-1.5 pr-4 text-right">RTO Rate %</th>
                <th className="py-1.5 text-right">Return Rate %</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(DEFAULT_CHANNEL_FEE_RATES).map(([channel, rates]) => (
                <tr key={channel} className="border-t border-[var(--line)]">
                  <td className="py-1.5 pr-4 text-[var(--ink-2)]">
                    {(() => {
                      const source = channel as SalesSourceId
                      const owner = channelLabel(channelOfSource(source))
                      const name = SOURCE_MAP[source]?.label ?? source
                      return name === owner ? owner : `${owner} — ${name}`
                    })()}
                  </td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">{rates.commissionPct}</td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">{rates.fulfilmentPct}</td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">{rates.shippingPct}</td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">{rates.collectionPct}</td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">{rates.rtoRatePct}</td>
                  <td className="py-1.5 text-right tabular-nums">{rates.returnRatePct}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </PageShell>
  )
}
