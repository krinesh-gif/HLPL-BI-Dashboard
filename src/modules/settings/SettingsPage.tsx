import { PageShell } from '@/components/layout/PageShell'
import { INSIGHT_THRESHOLDS, ADS_ACTION_THRESHOLDS, FORECAST_ASSUMPTIONS, INVENTORY_THRESHOLDS, FISCAL_YEAR } from '@/config/thresholds'
import { channelLabel, DEFAULT_ALLOCATION_WEIGHTS, SOURCE_MAP, channelOfSource } from '@/config/channels'
import type { BusinessChannelId, SalesSourceId } from '@/config/channels'
import { DEFAULT_CHANNEL_FEE_RATES } from '@/config/marketplaceFees'

function ConfigTable({ title, rows }: { title: string; rows: { key: string; value: string }[] }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="mb-2 text-sm font-semibold text-slate-700">{title}</h3>
      <table className="w-full text-sm">
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-slate-100">
              <td className="py-1.5 pr-4 text-slate-500">{r.key}</td>
              <td className="py-1.5 text-right font-medium tabular-nums text-slate-800">{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function SettingsPage() {
  return (
    <PageShell title="Settings" subtitle="Business-rule configuration — thresholds and assumptions driving every engine" showFilters={false}>
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        These values live in <code className="rounded bg-amber-100 px-1 py-0.5">src/config/</code> and are read by every
        calculation engine (business insight, Amazon Ads actions, inventory forecast, fixed-expense allocation). This
        milestone ships them as reviewable configuration; an in-app editor is a follow-up.
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ConfigTable
          title="Business Insight Thresholds"
          rows={Object.entries(INSIGHT_THRESHOLDS).map(([k, v]) => ({ key: k, value: String(v) }))}
        />
        <ConfigTable
          title="Amazon Ads Action Thresholds"
          rows={Object.entries(ADS_ACTION_THRESHOLDS).map(([k, v]) => ({ key: k, value: String(v) }))}
        />
        <ConfigTable
          title="Forecast Assumptions"
          rows={Object.entries(FORECAST_ASSUMPTIONS).map(([k, v]) => ({ key: k, value: String(v) }))}
        />
        <ConfigTable
          title="Inventory Thresholds"
          rows={Object.entries(INVENTORY_THRESHOLDS).map(([k, v]) => ({ key: k, value: String(v) }))}
        />
        <ConfigTable title="Fiscal Year" rows={[{ key: 'startMonth (0-indexed)', value: String(FISCAL_YEAR.startMonth) }]} />
        <ConfigTable
          title="Default Fixed-Expense Allocation Weights"
          rows={Object.entries(DEFAULT_ALLOCATION_WEIGHTS).map(([k, v]) => ({
            key: channelLabel(k as BusinessChannelId),
            value: `${(v * 100).toFixed(0)}%`,
          }))}
        />
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-700">Default Marketplace Fee Rates (used until an actual charge report is uploaded)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold text-slate-500">
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
                <tr key={channel} className="border-t border-slate-100">
                  <td className="py-1.5 pr-4 text-slate-700">
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
