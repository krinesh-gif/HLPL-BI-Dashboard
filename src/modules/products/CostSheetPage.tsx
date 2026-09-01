import { useMemo, useRef, useState } from 'react'
import { PageShell } from '@/components/layout/PageShell'
import { useDataStore } from '@/store/dataStore'
import { useFilterStore } from '@/store/filterStore'
import { parseSpreadsheetFile } from '@/lib/csvParse'
import { addMonths, formatCurrencyFull, formatPercent, monthLabel } from '@/lib/format'
import {
  buildCostIndex,
  cogsForMonth,
  describeCostChanges,
  indexCostVersions,
  type CostChange,
  type CostVersion,
} from '@/data/costVersions'
import {
  detectCostSheet,
  normalizeCostSheet,
  productNamesFromCostSheet,
  type CostSheetResult,
} from '@/data/normalize/costSheet'

interface Staged extends CostSheetResult {
  fileName: string
  changes: CostChange[]
  productNames: Map<string, string>
}

/** Months offered in the effective-from picker: two years back, one year on. */
function monthOptions(anchor: string): string[] {
  return Array.from({ length: 37 }, (_, i) => addMonths(anchor, i - 24))
}

export function CostSheetPage() {
  const { skuMaster, costVersions, saveCostVersions, removeCostVersion } = useDataStore()
  const { month } = useFilterStore()

  const [effectiveFrom, setEffectiveFrom] = useState(month)
  const [staged, setStaged] = useState<Staged | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const index = useMemo(() => buildCostIndex(costVersions, skuMaster), [costVersions, skuMaster])

  async function handleFile(file: File) {
    setBusy(true)
    setError(null)
    setSaved(null)
    setStaged(null)
    try {
      const parsed = await parseSpreadsheetFile(file)
      if (!detectCostSheet(parsed.headers)) {
        setError(
          `This does not look like a cost sheet. It needs a SKU column and a cost column. Columns found: ${
            parsed.headers.join(', ') || '(none)'
          }.`,
        )
        return
      }

      const result = normalizeCostSheet(parsed.rows, parsed.headers, {
        defaultEffectiveFrom: effectiveFrom,
        fileName: file.name,
      })
      const productNames = productNamesFromCostSheet(parsed.rows, parsed.headers)
      const namedMaster = [
        ...skuMaster,
        // So the preview can label a SKU the Product Master has not seen yet.
        ...[...productNames.entries()]
          .filter(([sku]) => !skuMaster.some((s) => s.sku === sku))
          .map(([sku, productName]) => ({ sku, productName }) as (typeof skuMaster)[number]),
      ]

      setStaged({
        ...result,
        fileName: file.name,
        productNames,
        changes: describeCostChanges(result.versions, index, namedMaster),
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that file.')
    } finally {
      setBusy(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  async function commit() {
    if (!staged || staged.versions.length === 0) return
    setBusy(true)
    setError(null)
    try {
      await saveCostVersions(staged.versions)
      setSaved(
        `Saved ${staged.versions.length.toLocaleString('en-IN')} cost${staged.versions.length === 1 ? '' : 's'} from ${staged.fileName}. ` +
          `Months before each effective date are unchanged.`,
      )
      setStaged(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save these costs.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <PageShell
      title="Cost Sheet"
      subtitle="Upload new costs with the month they take effect. Closed months keep the cost they were closed at."
      showFilters={false}
    >
      <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
        <h3 className="text-sm font-semibold text-[var(--ink)]">Upload a cost sheet</h3>
        <p className="mt-1 text-sm text-[var(--ink-2)]">
          Excel or CSV, with a <strong>SKU</strong> column and a <strong>New COGS</strong> (or <strong>COGS</strong>) column. Add an{' '}
          <strong>Effective From</strong> column to set the month per row — otherwise every row uses the month chosen here.
        </p>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-[var(--ink-3)]">
            Effective from
            <select
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
              className="rounded-md border border-[var(--line-2)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
            >
              {monthOptions(month).map((m) => (
                <option key={m} value={m}>{monthLabel(m)}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs font-medium text-[var(--ink-3)]">
            File
            <input
              ref={fileInput}
              type="file"
              accept=".csv,.xlsx,.xls"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void handleFile(file)
              }}
              className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-[var(--accent)] file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-[var(--accent-ink)] hover:file:bg-[var(--accent)]"
            />
          </label>
        </div>

        <p className="mt-3 rounded-md bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--ink-2)]">
          Example — with these rows, January to July stay at ₹50 and August onward is ₹55:
          <br />
          <span className="font-mono">SKU001, Rosemary 15 ml, ₹50, ₹55, Aug 2026</span>
          <br />
          The <span className="font-mono">Old COGS</span> column is ignored on purpose: what the previous cost actually was comes from
          the history below, not from the file.
        </p>
      </section>

      {error && (
        <div className="rounded-lg border border-[color-mix(in_oklab,var(--critical)_35%,transparent)] bg-[color-mix(in_oklab,var(--critical)_10%,transparent)] p-4 text-sm text-[var(--critical-ink)]">{error}</div>
      )}
      {saved && (
        <div className="rounded-lg border border-[color-mix(in_oklab,var(--good)_35%,transparent)] bg-[color-mix(in_oklab,var(--good)_10%,transparent)] p-4 text-sm text-[var(--good-ink)]">{saved}</div>
      )}

      {staged && <StagedReview staged={staged} busy={busy} onCommit={commit} onCancel={() => setStaged(null)} />}

      <CostHistory
        versions={costVersions}
        skuMaster={skuMaster}
        month={month}
        index={index}
        onRemove={removeCostVersion}
      />
    </PageShell>
  )
}

function StagedReview({
  staged,
  busy,
  onCommit,
  onCancel,
}: {
  staged: Staged
  busy: boolean
  onCommit: () => void
  onCancel: () => void
}) {
  const changed = staged.changes.filter((c) => c.previousCogs !== null && c.previousCogs !== c.newCogs)
  const unchanged = staged.changes.filter((c) => c.previousCogs !== null && c.previousCogs === c.newCogs)
  const added = staged.changes.filter((c) => c.previousCogs === null)

  return (
    <section className="rounded-lg border border-[var(--accent)] bg-[var(--accent-soft)]/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--ink)]">Review before saving — {staged.fileName}</h3>
          <p className="mt-0.5 text-sm text-[var(--ink-2)]">
            {changed.length} cost{changed.length === 1 ? '' : 's'} changing, {added.length} new, {unchanged.length} unchanged
            {staged.rejected.length > 0 && `, ${staged.rejected.length} rejected`}.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="rounded-md border border-[var(--line-2)] bg-[var(--surface)] px-3 py-1.5 text-sm font-medium text-[var(--ink-2)] hover:bg-[var(--surface-hover)] disabled:opacity-40">
            Cancel
          </button>
          <button
            type="button"
            onClick={onCommit}
            disabled={busy || staged.versions.length === 0}
            className="rounded-md bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-[var(--accent-ink)] hover:opacity-90 disabled:opacity-40"
          >
            {busy ? 'Saving…' : `Save ${staged.versions.length.toLocaleString('en-IN')} cost(s)`}
          </button>
        </div>
      </div>

      {staged.warnings.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-[var(--ink-2)]">
          {staged.warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}

      {staged.rejected.length > 0 && (
        <details className="mt-3 rounded-md border border-[color-mix(in_oklab,var(--critical)_35%,transparent)] bg-[var(--surface)] p-3">
          <summary className="cursor-pointer text-xs font-semibold text-[var(--critical-ink)]">
            {staged.rejected.length} row(s) could not be used
          </summary>
          <ul className="mt-2 space-y-1 text-xs text-[var(--ink-2)]">
            {staged.rejected.slice(0, 50).map((r) => (
              <li key={`${r.row}-${r.sku}`}>
                Row {r.row} ({r.sku || 'no SKU'}) — {r.reason}
              </li>
            ))}
            {staged.rejected.length > 50 && <li className="text-[var(--ink-3)]">…and {staged.rejected.length - 50} more.</li>}
          </ul>
        </details>
      )}

      {(changed.length > 0 || added.length > 0) && (
        <div className="mt-3 max-h-96 overflow-auto rounded-md border border-[var(--line)] bg-[var(--surface)]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[var(--surface-2)]">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--ink-3)]">SKU</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--ink-3)]">Effective from</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--ink-3)]">Was</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--ink-3)]">Becomes</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--ink-3)]">Change</th>
              </tr>
            </thead>
            <tbody>
              {[...changed, ...added].map((c) => (
                <tr key={`${c.sku}-${c.effectiveFrom}`} className="border-t border-[var(--line)]">
                  <td className="px-3 py-1.5">
                    <div className="font-mono text-xs text-[var(--ink-2)]">{c.sku}</div>
                    <div className="text-xs text-[var(--ink-3)]">{c.productName}</div>
                  </td>
                  <td className="px-3 py-1.5 text-xs text-[var(--ink-2)]">{monthLabel(c.effectiveFrom)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-[var(--ink-3)]">
                    {c.previousCogs === null ? <span className="text-xs italic text-[var(--ink-3)]">new</span> : formatCurrencyFull(c.previousCogs)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-medium tabular-nums text-[var(--ink)]">{formatCurrencyFull(c.newCogs)}</td>
                  <td
                    className={`px-3 py-1.5 text-right tabular-nums ${
                      c.changePct === null ? 'text-[var(--ink-3)]' : Math.abs(c.changePct) > 25 ? 'font-semibold text-[var(--critical-ink)]' : 'text-[var(--ink-2)]'
                    }`}
                  >
                    {c.changePct === null ? '—' : `${c.changePct >= 0 ? '+' : ''}${formatPercent(c.changePct)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function CostHistory({
  versions,
  skuMaster,
  month,
  index,
  onRemove,
}: {
  versions: CostVersion[]
  skuMaster: { sku: string; productName: string }[]
  month: string
  index: ReturnType<typeof buildCostIndex>
  onRemove: (sku: string, effectiveFrom: string) => Promise<void>
}) {
  const [search, setSearch] = useState('')
  const nameBySku = useMemo(() => new Map(skuMaster.map((s) => [s.sku, s.productName])), [skuMaster])

  const rows = useMemo(() => {
    const bySku = indexCostVersions(versions)
    const q = search.trim().toLowerCase()
    return [...bySku.entries()]
      .map(([sku, list]) => ({
        sku,
        productName: nameBySku.get(sku) ?? sku,
        versions: list,
        currentCost: cogsForMonth(sku, month, index),
      }))
      .filter((r) => !q || r.sku.toLowerCase().includes(q) || r.productName.toLowerCase().includes(q))
      .sort((a, b) => a.sku.localeCompare(b.sku))
  }, [versions, search, nameBySku, month, index])

  return (
    <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--ink)]">Cost history</h3>
          <p className="mt-0.5 text-sm text-[var(--ink-2)]">
            Every uploaded cost and the month it took effect. The cost shown for {monthLabel(month)} is what every P&amp;L for that month
            uses.
          </p>
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search SKU or product…"
          className="w-64 rounded-md border border-[var(--line-2)] px-3 py-1.5 text-sm focus:border-[var(--accent)] focus:outline-none"
        />
      </div>

      {rows.length === 0 ? (
        <p className="mt-4 rounded-md border border-dashed border-[var(--line-2)] px-4 py-6 text-center text-sm text-[var(--ink-3)]">
          {versions.length === 0
            ? 'No cost sheets uploaded yet. Every SKU is costed from the Product Master until one is.'
            : `Nothing matches “${search}”.`}
        </p>
      ) : (
        <div className="mt-3 max-h-[32rem] overflow-auto rounded-md border border-[var(--line)]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[var(--surface-2)]">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--ink-3)]">SKU</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--ink-3)]">Cost in {monthLabel(month)}</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--ink-3)]">Version history</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.sku} className="border-t border-[var(--line)] align-top">
                  <td className="px-3 py-2">
                    <div className="font-mono text-xs text-[var(--ink-2)]">{r.sku}</div>
                    <div className="text-xs text-[var(--ink-3)]">{r.productName}</div>
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums text-[var(--ink)]">
                    {r.currentCost === null ? <span className="text-xs italic text-[var(--ink-2)]">no cost on file</span> : formatCurrencyFull(r.currentCost)}
                  </td>
                  <td className="px-3 py-2">
                    <ul className="space-y-1">
                      {r.versions.map((v) => (
                        <li key={v.effectiveFrom} className="flex items-center gap-2 text-xs">
                          <span className="w-20 shrink-0 text-[var(--ink-3)]">{monthLabel(v.effectiveFrom)}→</span>
                          <span className="w-20 shrink-0 font-medium tabular-nums text-[var(--ink)]">{formatCurrencyFull(v.cogs)}</span>
                          {v.fileName && <span className="truncate text-[var(--ink-3)]">{v.fileName}</span>}
                          <button
                            type="button"
                            onClick={() => void onRemove(v.sku, v.effectiveFrom)}
                            title="Remove this version — the month falls back to the cost in force before it"
                            className="ml-auto shrink-0 text-[var(--critical-ink)] hover:text-[var(--critical-ink)]"
                          >
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
