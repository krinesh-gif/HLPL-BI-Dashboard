import { useState } from 'react'
import { PageShell } from '@/components/layout/PageShell'
import { useDataStore } from '@/store/dataStore'
import { useSkuMappingWork, type MappingRow } from './useSkuMappingWork'
import { formatCurrencyFull, formatPercent } from '@/lib/format'
import type { ComboComponent, SkuMapping } from '@/data/skuMapping'

type Tab = 'unmapped' | 'review' | 'done'

interface DraftComponent {
  componentSku: string
  quantity: number
}

export function SkuMappingPage() {
  const { skuMaster, saveMappings, removeMapping } = useDataStore()
  const work = useSkuMappingWork()
  const [tab, setTab] = useState<Tab>('unmapped')
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftComponent[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const rows = tab === 'unmapped' ? work.unmapped : tab === 'review' ? work.needsVerification : work.done
  const unmappedShare = work.totalNetSales > 0 ? (work.unmappedNetSales / work.totalNetSales) * 100 : 0

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      setEditing(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that change.')
    } finally {
      setBusy(false)
    }
  }

  function acceptSuggestion(row: MappingRow) {
    if (!row.suggestion) return
    void run(() =>
      saveMappings({
        mappings: [row.suggestion!.mapping],
        comboComponents: row.suggestion!.components,
        replaceRecipesFor: [row.suggestion!.mapping.internalSku],
      }),
    )
  }

  function acceptAllSuggestions() {
    const withSuggestions = work.unmapped.filter((r) => r.suggestion)
    if (withSuggestions.length === 0) return
    void run(() =>
      saveMappings({
        mappings: withSuggestions.map((r) => r.suggestion!.mapping),
        comboComponents: withSuggestions.flatMap((r) => r.suggestion!.components),
        replaceRecipesFor: withSuggestions.map((r) => r.suggestion!.mapping.internalSku),
      }),
    )
  }

  function linkAsSingle(row: MappingRow, internalSku: string) {
    if (!internalSku) return
    const mapping: SkuMapping = {
      channelSku: row.channelSku,
      internalSku,
      kind: 'SINGLE',
      source: 'manual',
      verified: true,
    }
    void run(() => saveMappings({ mappings: [mapping] }))
  }

  function markVerified(row: MappingRow) {
    if (!row.mapping) return
    void run(() => saveMappings({ mappings: [{ ...row.mapping!, verified: true, source: 'manual' }] }))
  }

  function startComboEdit(row: MappingRow) {
    setEditing(row.channelSku)
    setDraft(
      row.components.length > 0
        ? row.components.map((c) => ({ componentSku: c.componentSku, quantity: c.quantity }))
        : [{ componentSku: '', quantity: 1 }],
    )
  }

  function saveCombo(row: MappingRow) {
    const usable = draft.filter((d) => d.componentSku)
    if (usable.length === 0) {
      setError('A combo needs at least one component.')
      return
    }
    const mapping: SkuMapping = {
      channelSku: row.channelSku,
      internalSku: row.channelSku,
      kind: 'COMBO',
      source: 'manual',
      verified: true,
    }
    const components: ComboComponent[] = usable.map((d) => ({
      comboSku: row.channelSku,
      componentSku: d.componentSku,
      quantity: d.quantity || 1,
      source: 'manual',
    }))
    void run(() => saveMappings({ mappings: [mapping], comboComponents: components, replaceRecipesFor: [row.channelSku] }))
  }

  const suggestionCount = work.unmapped.filter((r) => r.suggestion).length

  return (
    <PageShell
      title="SKU Mapping"
      subtitle="Link marketplace codes to your Product Master so combo sales get a real cost instead of an estimate"
      showFilters={false}
    >
      {error && <p className="mb-4 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Still estimated" value={formatCurrencyFull(work.unmappedNetSales)} note={`${formatPercent(unmappedShare)} of net sales · ${work.unmapped.length} SKUs`} tone="amber" />
        <Stat label="Awaiting your check" value={String(work.needsVerification.length)} note="costed from a guess" tone="indigo" />
        <Stat label="Confirmed" value={String(work.done.length)} note="real component costs" tone="emerald" />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <TabButton active={tab === 'unmapped'} onClick={() => setTab('unmapped')}>Not mapped ({work.unmapped.length})</TabButton>
        <TabButton active={tab === 'review'} onClick={() => setTab('review')}>To verify ({work.needsVerification.length})</TabButton>
        <TabButton active={tab === 'done'} onClick={() => setTab('done')}>Confirmed ({work.done.length})</TabButton>

        {tab === 'unmapped' && suggestionCount > 0 && (
          <button
            type="button"
            onClick={acceptAllSuggestions}
            disabled={busy}
            className="ml-auto rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            Accept all {suggestionCount} suggestion{suggestionCount === 1 ? '' : 's'}
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
          {tab === 'unmapped' ? 'Every SKU in your sales data has a cost. Nothing to map.' : 'Nothing here yet.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Marketplace SKU</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">Orders</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">Net Sales</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Cost basis</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.channelSku} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2">
                    <div className="font-mono text-xs text-slate-700">{row.channelSku}</div>
                    {row.mapping && (
                      <div className="mt-0.5 text-xs text-slate-500">
                        → {row.mapping.internalSku} <span className="text-slate-400">({row.mapping.kind.toLowerCase()})</span>
                      </div>
                    )}
                    {row.mapping?.note && <div className="mt-0.5 text-xs text-amber-700">{row.mapping.note}</div>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">{row.orders.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium text-slate-800">{formatCurrencyFull(row.netSales)}</td>
                  <td className="px-3 py-2">
                    {row.resolvedCogs === null ? (
                      <span className="text-amber-700">estimated at 25% of sales</span>
                    ) : (
                      <>
                        <span className="text-slate-700">{formatCurrencyFull(row.resolvedCogs)} / unit</span>
                        {row.components.length > 0 && (
                          <div className="mt-0.5 text-xs text-slate-500">
                            {row.components.map((c) => `${c.componentSku}${c.quantity > 1 ? ` ×${c.quantity}` : ''}`).join(' + ')}
                          </div>
                        )}
                        {row.missingComponents.length > 0 && (
                          <div className="mt-0.5 text-xs text-rose-700">
                            no cost on file for {row.missingComponents.join(', ')} — this is understated
                          </div>
                        )}
                      </>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {editing === row.channelSku ? (
                      <ComboEditor
                        skuMaster={skuMaster}
                        draft={draft}
                        setDraft={setDraft}
                        busy={busy}
                        onSave={() => saveCombo(row)}
                        onCancel={() => setEditing(null)}
                      />
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        {row.suggestion && (
                          <button
                            type="button"
                            onClick={() => acceptSuggestion(row)}
                            disabled={busy}
                            className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
                            title={row.suggestion.mapping.note}
                          >
                            Use suggestion: {row.suggestion.components.length > 0
                              ? row.suggestion.components.map((c) => `${c.componentSku}${c.quantity > 1 ? `×${c.quantity}` : ''}`).join(' + ')
                              : row.suggestion.mapping.internalSku}
                          </button>
                        )}

                        {!row.mapping?.verified && row.mapping && (
                          <button
                            type="button"
                            onClick={() => markVerified(row)}
                            disabled={busy}
                            className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
                          >
                            Looks right
                          </button>
                        )}

                        <select
                          defaultValue=""
                          disabled={busy}
                          onChange={(e) => linkAsSingle(row, e.target.value)}
                          className="rounded-md border border-slate-300 px-2 py-1 text-xs focus:border-indigo-500 focus:outline-none"
                        >
                          <option value="">Link to a product…</option>
                          {skuMaster.map((s) => (
                            <option key={s.sku} value={s.sku}>{s.sku}</option>
                          ))}
                        </select>

                        <button
                          type="button"
                          onClick={() => startComboEdit(row)}
                          disabled={busy}
                          className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                        >
                          {row.components.length > 0 ? 'Edit combo' : 'Build combo'}
                        </button>

                        {row.mapping && (
                          <button
                            type="button"
                            onClick={() => void run(() => removeMapping(row.channelSku))}
                            disabled={busy}
                            className="text-xs font-medium text-rose-600 hover:text-rose-800 disabled:opacity-40"
                          >
                            Unlink
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageShell>
  )
}

function Stat({ label, value, note, tone }: { label: string; value: string; note: string; tone: 'amber' | 'indigo' | 'emerald' }) {
  const tones = {
    amber: 'border-amber-300 bg-amber-50 text-amber-900',
    indigo: 'border-indigo-300 bg-indigo-50 text-indigo-900',
    emerald: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  }
  return (
    <div className={`rounded-lg border p-4 ${tones[tone]}`}>
      <div className="text-xs font-semibold uppercase tracking-wide opacity-80">{label}</div>
      <div className="mt-1 text-xl font-bold">{value}</div>
      <div className="mt-0.5 text-xs opacity-80">{note}</div>
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-sm font-medium ${active ? 'bg-indigo-600 text-white' : 'border border-slate-300 text-slate-700 hover:bg-slate-50'}`}
    >
      {children}
    </button>
  )
}

function ComboEditor({
  skuMaster,
  draft,
  setDraft,
  busy,
  onSave,
  onCancel,
}: {
  skuMaster: { sku: string }[]
  draft: DraftComponent[]
  setDraft: (d: DraftComponent[]) => void
  busy: boolean
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <div className="min-w-72 space-y-2 rounded-md border border-indigo-200 bg-indigo-50 p-3">
      <p className="text-xs font-semibold text-indigo-900">What is in this pack?</p>
      {draft.map((component, i) => (
        <div key={i} className="flex items-center gap-2">
          <select
            value={component.componentSku}
            onChange={(e) => setDraft(draft.map((d, j) => (j === i ? { ...d, componentSku: e.target.value } : d)))}
            className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs focus:border-indigo-500 focus:outline-none"
          >
            <option value="">Choose a product…</option>
            {skuMaster.map((s) => (
              <option key={s.sku} value={s.sku}>{s.sku}</option>
            ))}
          </select>
          <input
            type="number"
            min={1}
            value={component.quantity}
            onChange={(e) => setDraft(draft.map((d, j) => (j === i ? { ...d, quantity: Number(e.target.value) || 1 } : d)))}
            className="w-16 rounded-md border border-slate-300 px-2 py-1 text-right text-xs focus:border-indigo-500 focus:outline-none"
            title="How many of this product are in the pack"
          />
          {draft.length > 1 && (
            <button type="button" onClick={() => setDraft(draft.filter((_, j) => j !== i))} className="text-xs text-rose-600 hover:text-rose-800">
              ×
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() => setDraft([...draft, { componentSku: '', quantity: 1 }])}
        className="text-xs font-medium text-indigo-700 hover:text-indigo-900"
      >
        + Add another product
      </button>
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onSave}
          disabled={busy}
          className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
        >
          Save combo
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-white disabled:opacity-40">
          Cancel
        </button>
      </div>
    </div>
  )
}
