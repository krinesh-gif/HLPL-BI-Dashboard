import { useId, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageShell } from '@/components/layout/PageShell'
import { useDataStore } from '@/store/dataStore'
import { useSkuMappingWork, type MappingRow } from './useSkuMappingWork'
import { formatCurrencyFull, formatPercent } from '@/lib/format'
import { CHANNEL_MAP, type SalesSourceId } from '@/config/channels'
import type { ComboComponent, SkuMapping } from '@/data/skuMapping'
import type { SkuMaster } from '@/data/models'

type Tab = 'unmapped' | 'review' | 'done'

interface DraftComponent {
  componentSku: string
  quantity: number
}

export function SkuMappingPage() {
  const { skuMaster, saveMappings, removeMapping } = useDataStore()
  const work = useSkuMappingWork()
  const [tab, setTab] = useState<Tab>('unmapped')
  // Arriving from the Uncategorized warning lands on the exact code that
  // needs mapping, rather than on a list of several hundred to find it in.
  const [params] = useSearchParams()
  const [search, setSearch] = useState(params.get('q') ?? '')
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftComponent[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // Which marketplace to look at, and what to rank by. Both default to the
  // whole list newest-money-first, which is the order this page is worked in:
  // the biggest unmapped seller is the one worth mapping next.
  const [marketplace, setMarketplace] = useState<SalesSourceId | 'all'>('all')
  const [sort, setSort] = useState<{ key: 'orders' | 'netSales'; dir: 'asc' | 'desc' }>({ key: 'netSales', dir: 'desc' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const allRows = tab === 'unmapped' ? work.unmapped : tab === 'review' ? work.needsVerification : work.done

  // Search covers the code, the product name from the report, the marketplace,
  // and what it currently maps to — so a SKU can be found by any of the things
  // someone might remember about it.
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const terms = q ? q.split(/\s+/) : []
    const filtered = allRows.filter((r) => {
      if (marketplace !== 'all' && !r.channels.includes(marketplace)) return false
      if (terms.length === 0) return true
      const haystack = [
        r.channelSku,
        r.productName,
        r.mapping?.internalSku ?? '',
        ...r.channels.map((c) => CHANNEL_MAP[c]?.label ?? c),
      ]
        .join(' ')
        .toLowerCase()
      return terms.every((t) => haystack.includes(t))
    })
    const sign = sort.dir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => (a[sort.key] - b[sort.key]) * sign)
  }, [allRows, search, marketplace, sort])

  /** Only the marketplaces this tab actually contains, so the filter never
   * offers a choice that empties the table. */
  const marketplaceOptions = useMemo(() => {
    const seen = new Set<SalesSourceId>()
    for (const r of allRows) for (const c of r.channels) seen.add(c)
    return [...seen].sort((a, b) => (CHANNEL_MAP[a]?.label ?? a).localeCompare(CHANNEL_MAP[b]?.label ?? b))
  }, [allRows])

  function toggleSort(key: 'orders' | 'netSales') {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }))
  }

  const unmappedShare = work.totalNetSales > 0 ? (work.unmappedNetSales / work.totalNetSales) * 100 : 0
  const selectedInView = rows.filter((r) => selected.has(r.channelSku))

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
    const withSuggestions = rows.filter((r) => r.suggestion)
    if (withSuggestions.length === 0) return
    void run(() =>
      saveMappings({
        mappings: withSuggestions.map((r) => r.suggestion!.mapping),
        comboComponents: withSuggestions.flatMap((r) => r.suggestion!.components),
        replaceRecipesFor: withSuggestions.map((r) => r.suggestion!.mapping.internalSku),
      }),
    )
  }

  /** Linking to a single product also clears any recipe left over from a
   * previous combo mapping, so a corrected SKU cannot keep costing as a bundle. */
  function linkAsSingle(row: MappingRow, internalSku: string) {
    if (!internalSku) return
    const mapping: SkuMapping = { channelSku: row.channelSku, internalSku, kind: 'SINGLE', source: 'manual', verified: true }
    void run(() =>
      saveMappings({
        mappings: [mapping],
        replaceRecipesFor: [row.channelSku, row.mapping?.internalSku].filter((s): s is string => Boolean(s)),
      }),
    )
  }

  function markVerified(rowsToMark: MappingRow[]) {
    const mappings = rowsToMark.filter((r) => r.mapping).map((r) => ({ ...r.mapping!, verified: true, source: 'manual' as const }))
    if (mappings.length === 0) return
    void run(async () => {
      await saveMappings({ mappings })
      setSelected(new Set())
    })
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
    const mapping: SkuMapping = { channelSku: row.channelSku, internalSku: row.channelSku, kind: 'COMBO', source: 'manual', verified: true }
    const components: ComboComponent[] = usable.map((d) => ({
      comboSku: row.channelSku,
      componentSku: d.componentSku,
      quantity: d.quantity || 1,
      source: 'manual',
    }))
    void run(() =>
      saveMappings({
        mappings: [mapping],
        comboComponents: components,
        replaceRecipesFor: [row.channelSku, row.mapping?.internalSku].filter((s): s is string => Boolean(s)),
      }),
    )
  }

  function toggle(channelSku: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(channelSku)) next.delete(channelSku)
      else next.add(channelSku)
      return next
    })
  }

  const suggestionCount = rows.filter((r) => r.suggestion).length
  const allInViewSelected = rows.length > 0 && rows.every((r) => selected.has(r.channelSku))

  return (
    <PageShell
      title="SKU Mapping"
      subtitle="Link marketplace codes to your Product Master so combo sales get a real cost instead of an estimate"
      showFilters={false}
    >
      {error && <p className="mb-4 rounded-md bg-[color-mix(in_oklab,var(--critical)_10%,transparent)] px-3 py-2 text-sm text-[var(--critical-ink)]">{error}</p>}

      {/* One strip rather than three cards: the numbers are a status line for
          the work below, not the point of the page. */}
      <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-2.5">
        <Stat label="Still estimated" value={formatCurrencyFull(work.unmappedNetSales)} note={`${formatPercent(unmappedShare)} of net sales · ${work.unmapped.length} SKUs`} tone="amber" />
        <Stat label="Awaiting your check" value={String(work.needsVerification.length)} note="costed from a guess" tone="indigo" />
        <Stat label="Confirmed" value={String(work.done.length)} note="real component costs" tone="emerald" />
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <TabButton active={tab === 'unmapped'} onClick={() => { setTab('unmapped'); setSelected(new Set()) }}>Not mapped ({work.unmapped.length})</TabButton>
        <TabButton active={tab === 'review'} onClick={() => { setTab('review'); setSelected(new Set()) }}>To verify ({work.needsVerification.length})</TabButton>
        <TabButton active={tab === 'done'} onClick={() => { setTab('done'); setSelected(new Set()) }}>Confirmed ({work.done.length})</TabButton>

        <select
          value={marketplace}
          onChange={(e) => setMarketplace(e.target.value as SalesSourceId | 'all')}
          aria-label="Marketplace"
          className="cursor-pointer rounded-md border border-[var(--line-2)] bg-[var(--surface)] px-2.5 py-1.5 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
        >
          <option value="all">All marketplaces</option>
          {marketplaceOptions.map((c) => (
            <option key={c} value={c}>{CHANNEL_MAP[c]?.label ?? c}</option>
          ))}
        </select>

        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search SKU, product, or marketplace…"
          className="ml-auto w-64 rounded-md border border-[var(--line-2)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
        />

        {tab === 'unmapped' && suggestionCount > 0 && (
          <button
            type="button"
            onClick={acceptAllSuggestions}
            disabled={busy}
            className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-ink)] hover:opacity-90 disabled:opacity-40"
          >
            Accept all {suggestionCount} suggestion{suggestionCount === 1 ? '' : 's'}
          </button>
        )}
      </div>

      {/* Bulk actions appear only once something is selected, so the row is not
          three lines of controls waiting for a click that may never come. */}
      {(selectedInView.length > 0 || rows.length > 0) && (
        <div className="mb-2 flex flex-wrap items-center gap-3 text-sm">
          {rows.length > 0 && (
            <label className="flex items-center gap-2 text-[var(--ink-3)]">
              <input type="checkbox" checked={allInViewSelected} onChange={() => setSelected(allInViewSelected ? new Set() : new Set(rows.map((r) => r.channelSku)))} />
              Select all ({rows.length})
            </label>
          )}
          {selectedInView.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => markVerified(selectedInView)}
                disabled={busy}
                className="rounded-md bg-[var(--good)] px-3 py-1 text-sm font-medium text-[var(--accent-ink)] hover:opacity-90 disabled:opacity-40"
              >
                Mark {selectedInView.length} as verified
              </button>
              <button type="button" onClick={() => setSelected(new Set())} className="text-[var(--ink-3)] hover:text-[var(--ink-2)]">
                Clear selection
              </button>
            </>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-6 text-center text-sm text-[var(--ink-3)]">
          {search
            ? `Nothing matches “${search}” in this tab.`
            : tab === 'unmapped'
              ? 'Every SKU in your sales data has a cost. Nothing to map.'
              : 'Nothing here yet.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--line)] bg-[var(--surface)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--surface-2)]">
              <tr>
                <th className="w-8 px-3 py-1.5" />
                <th className="px-3 py-1.5 text-left text-xs font-semibold text-[var(--ink-3)]">Marketplace SKU</th>
                <th className="px-3 py-1.5 text-left text-xs font-semibold text-[var(--ink-3)]">Marketplace</th>
                <SortHeader label="Orders" active={sort.key === 'orders'} dir={sort.dir} onClick={() => toggleSort('orders')} />
                <SortHeader label="Net Sales" active={sort.key === 'netSales'} dir={sort.dir} onClick={() => toggleSort('netSales')} />
                <th className="px-3 py-1.5 text-left text-xs font-semibold text-[var(--ink-3)]">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.channelSku} className="border-t border-[var(--line)] align-top">
                  <td className="px-3 py-1.5">
                    <input type="checkbox" checked={selected.has(row.channelSku)} onChange={() => toggle(row.channelSku)} />
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="font-mono text-xs text-[var(--ink-2)]">{row.channelSku}</div>
                    <div className="mt-0.5 text-xs text-[var(--ink-3)]">{row.productName}</div>
                    {/* What the "Cost basis" column used to hold. On the tab it
                        was read from it said the same thing on every row, and
                        the part that did vary — the recipe and the missing-cost
                        warning — belongs beside the SKU it describes. */}
                    {row.mapping && (
                      <div className="mt-0.5 text-xs text-[var(--accent)]">
                        → {row.mapping.internalSku} <span className="text-[var(--ink-3)]">({row.mapping.kind.toLowerCase()})</span>
                        {row.resolvedCogs !== null && (
                          <span className="text-[var(--ink-3)]"> · {formatCurrencyFull(row.resolvedCogs)}/unit</span>
                        )}
                      </div>
                    )}
                    {row.components.length > 0 && (
                      <div className="mt-0.5 text-xs text-[var(--ink-3)]">
                        {row.components.map((c) => `${c.componentSku}${c.quantity > 1 ? ` ×${c.quantity}` : ''}`).join(' + ')}
                      </div>
                    )}
                    {row.missingComponents.length > 0 && (
                      <div className="mt-0.5 text-xs text-[var(--critical-ink)]">
                        no cost on file for {row.missingComponents.join(', ')} — this is understated
                      </div>
                    )}
                    {row.mapping?.note && <div className="mt-0.5 text-xs text-[var(--ink-2)]">{row.mapping.note}</div>}
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex flex-wrap gap-1">
                      {row.channels.map((c) => (
                        <span key={c} className="whitespace-nowrap rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-xs text-[var(--ink-2)]">
                          {CHANNEL_MAP[c]?.label ?? c}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-[var(--ink-2)]">{row.orders.toLocaleString()}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-medium text-[var(--ink)]">{formatCurrencyFull(row.netSales)}</td>
                  <td className="px-3 py-1.5">
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
                            className="rounded-md bg-[var(--accent)] px-2.5 py-1 text-xs font-medium text-[var(--accent-ink)] hover:opacity-90 disabled:opacity-40"
                            title={row.suggestion.mapping.note}
                          >
                            Use: {row.suggestion.components.length > 0
                              ? row.suggestion.components.map((c) => `${c.componentSku}${c.quantity > 1 ? `×${c.quantity}` : ''}`).join(' + ')
                              : row.suggestion.mapping.internalSku}
                          </button>
                        )}

                        {row.mapping && !row.mapping.verified && (
                          <button
                            type="button"
                            onClick={() => markVerified([row])}
                            disabled={busy}
                            className="rounded-md bg-[var(--good)] px-2.5 py-1 text-xs font-medium text-[var(--accent-ink)] hover:opacity-90 disabled:opacity-40"
                          >
                            Looks right
                          </button>
                        )}

                        <ProductPicker
                          skuMaster={skuMaster}
                          disabled={busy}
                          label={row.mapping ? 'Change to…' : 'Link to a product…'}
                          onPick={(sku) => linkAsSingle(row, sku)}
                        />

                        <button
                          type="button"
                          onClick={() => startComboEdit(row)}
                          disabled={busy}
                          title={row.components.length > 0 ? 'Edit combo' : 'Build combo'}
                          aria-label={row.components.length > 0 ? 'Edit combo' : 'Build combo'}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-[var(--accent)] text-[var(--accent-ink)] hover:opacity-90 disabled:opacity-40"
                        >
                          <ComboIcon />
                        </button>

                        {row.mapping && (
                          <button
                            type="button"
                            onClick={() => void run(() => removeMapping(row.channelSku))}
                            disabled={busy}
                            className="text-xs font-medium text-[var(--critical-ink)] hover:text-[var(--critical-ink)] disabled:opacity-40"
                            title="Remove this mapping and start again"
                          >
                            Unmap
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

/**
 * A type-to-search product chooser. A plain dropdown of several hundred SKUs is
 * unusable; a text input backed by a datalist filters as you type on any part
 * of the code or product name.
 */
function ProductPicker({
  skuMaster,
  disabled,
  label,
  onPick,
}: {
  skuMaster: SkuMaster[]
  disabled: boolean
  label: string
  onPick: (sku: string) => void
}) {
  const listId = useId()
  const [value, setValue] = useState('')

  function commit(next: string) {
    // Accept either the raw code or the "code — name" form the list shows.
    const code = next.split(' — ')[0].trim()
    if (skuMaster.some((s) => s.sku === code)) {
      onPick(code)
      setValue('')
    }
  }

  return (
    <>
      <input
        list={listId}
        value={value}
        disabled={disabled}
        placeholder={label}
        onChange={(e) => {
          setValue(e.target.value)
          commit(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(value)
        }}
        className="w-48 rounded-md border border-[var(--line-2)] px-2 py-1 text-xs focus:border-[var(--accent)] focus:outline-none disabled:opacity-40"
      />
      <datalist id={listId}>
        {skuMaster.map((s) => (
          <option key={s.sku} value={`${s.sku} — ${s.productName}`} />
        ))}
      </datalist>
    </>
  )
}

/**
 * A sortable numeric column header.
 *
 * Both arrows are always drawn, with the active direction picked out — an
 * arrow that only appears once a column is sorted gives no clue that the
 * column can be sorted at all.
 */
function SortHeader({
  label, active, dir, onClick,
}: { label: string; active: boolean; dir: 'asc' | 'desc'; onClick: () => void }) {
  return (
    <th className="px-3 py-1.5 text-right text-xs font-semibold text-[var(--ink-3)]">
      <button
        type="button"
        onClick={onClick}
        aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
        className={`inline-flex items-center gap-1 hover:text-[var(--ink)] ${active ? 'text-[var(--ink)]' : ''}`}
      >
        {label}
        <span aria-hidden className="flex flex-col leading-[0.55]">
          <span className={active && dir === 'asc' ? 'text-[var(--accent)]' : 'text-[var(--ink-4,var(--ink-3))] opacity-40'}>▲</span>
          <span className={active && dir === 'desc' ? 'text-[var(--accent)]' : 'text-[var(--ink-4,var(--ink-3))] opacity-40'}>▼</span>
        </span>
      </button>
    </th>
  )
}

/** Two items joining into a pack — the shape of what "build combo" does. */
function ComboIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 2 3 7l9 5 9-5-9-5Z" />
      <path d="m3 17 9 5 9-5" />
      <path d="m3 12 9 5 9-5" />
    </svg>
  )
}

function Stat({ label, value, note, tone }: { label: string; value: string; note: string; tone: 'amber' | 'indigo' | 'emerald' }) {
  const tones = {
    amber: 'bg-[var(--warning)]',
    indigo: 'bg-[var(--accent)]',
    emerald: 'bg-[var(--good)]',
  }
  return (
    <div className="flex items-baseline gap-2">
      <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${tones[tone]}`} />
      <span className="text-xs text-[var(--ink-3)]">{label}</span>
      <span className="text-base font-semibold text-[var(--ink)]">{value}</span>
      <span className="text-xs text-[var(--ink-3)]">{note}</span>
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-sm font-medium ${active ? 'bg-[var(--accent)] text-[var(--accent-ink)]' : 'border border-[var(--line-2)] text-[var(--ink-2)] hover:bg-[var(--surface-hover)]'}`}
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
  skuMaster: SkuMaster[]
  draft: DraftComponent[]
  setDraft: (d: DraftComponent[]) => void
  busy: boolean
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <div className="min-w-80 space-y-2 rounded-md border border-[var(--accent)] bg-[var(--accent-soft)] p-3">
      <p className="text-xs font-semibold text-[var(--accent)]">What is in this pack?</p>
      {draft.map((component, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="flex-1">
            <ProductPicker
              skuMaster={skuMaster}
              disabled={busy}
              label={component.componentSku || 'Search for a product…'}
              onPick={(sku) => setDraft(draft.map((d, j) => (j === i ? { ...d, componentSku: sku } : d)))}
            />
            {component.componentSku && <div className="mt-0.5 font-mono text-xs text-[var(--accent)]">{component.componentSku}</div>}
          </div>
          <input
            type="number"
            min={1}
            value={component.quantity}
            onChange={(e) => setDraft(draft.map((d, j) => (j === i ? { ...d, quantity: Number(e.target.value) || 1 } : d)))}
            className="w-16 rounded-md border border-[var(--line-2)] px-2 py-1 text-right text-xs focus:border-[var(--accent)] focus:outline-none"
            title="How many of this product are in the pack"
          />
          {draft.length > 1 && (
            <button type="button" onClick={() => setDraft(draft.filter((_, j) => j !== i))} className="text-xs text-[var(--critical-ink)] hover:text-[var(--critical-ink)]">
              ×
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() => setDraft([...draft, { componentSku: '', quantity: 1 }])}
        className="text-xs font-medium text-[var(--accent)] hover:text-[var(--accent)]"
      >
        + Add another product
      </button>
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onSave}
          disabled={busy}
          className="rounded-md bg-[var(--accent)] px-3 py-1 text-xs font-medium text-[var(--accent-ink)] hover:opacity-90 disabled:opacity-40"
        >
          Save combo
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="rounded-md border border-[var(--line-2)] px-3 py-1 text-xs text-[var(--ink-2)] hover:bg-[var(--surface)] disabled:opacity-40">
          Cancel
        </button>
      </div>
    </div>
  )
}
