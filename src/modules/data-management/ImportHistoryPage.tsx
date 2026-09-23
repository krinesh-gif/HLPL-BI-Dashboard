import { useState } from 'react'
import { PageShell } from '@/components/layout/PageShell'
import { DataTable } from '@/components/ui/DataTable'
import { EmptyState } from '@/components/ui/EmptyState'
import { CHANNEL_MAP } from '@/config/channels'
import { useDataStore, type ReverseImportResult } from '@/store/dataStore'
import { formatNumber } from '@/lib/format'

/**
 * What a reverse did, in the words of what actually happened.
 *
 * A reverse is not a delete, and saying "removed" would be wrong in both
 * directions: it puts back the facts and the restated rows the import
 * displaced, and it deliberately leaves Meesho events that were already on
 * file before this upload arrived. Both are reported.
 */
function describeReversal(r: ReverseImportResult): string {
  const parts: string[] = []
  if (r.removedSales > 0) parts.push(`${formatNumber(r.removedSales)} sales row(s) removed`)
  if (r.removedAds > 0) parts.push(`${formatNumber(r.removedAds)} ads row(s) removed`)
  if (r.removedMeeshoRows > 0) parts.push(`${formatNumber(r.removedMeeshoRows)} Meesho event(s) removed`)
  if (r.restoredFacts > 0) parts.push(`${r.restoredFacts} month(s) of figures put back`)
  if (r.removedFacts > 0) parts.push(`${r.removedFacts} month(s) of figures removed`)
  if (r.restoredRows > 0) parts.push(`${formatNumber(r.restoredRows)} restated row(s) put back`)
  return parts.length === 0
    ? `${r.fileName} is reversed. It had written nothing that is still on file.`
    : `${r.fileName} is reversed — ${parts.join(', ')}.`
}

export function ImportHistoryPage() {
  const imports = useDataStore((s) => s.imports)
  const reverseImport = useDataStore((s) => s.reverseImport)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function reverse(id: string): Promise<void> {
    setBusy(id)
    setError(null)
    setOutcome(null)
    try {
      setOutcome(describeReversal(await reverseImport(id)))
      setConfirming(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <PageShell title="Import History" subtitle="Every report ever uploaded, with its validation outcome — and a way to take one back out" showFilters={false}>
      {outcome && (
        <p className="mb-3 rounded-md border border-[color-mix(in_oklab,var(--good)_45%,transparent)] bg-[color-mix(in_oklab,var(--good)_12%,transparent)] px-3 py-2 text-sm text-[var(--ink)]">
          {outcome}
        </p>
      )}
      {error && (
        <p className="mb-3 rounded-md border border-[color-mix(in_oklab,var(--critical)_45%,transparent)] bg-[color-mix(in_oklab,var(--critical)_12%,transparent)] px-3 py-2 text-sm text-[var(--ink)]">
          {error}
        </p>
      )}
      {imports.length === 0 ? (
        <EmptyState title="No reports have been uploaded yet." description="Uploaded reports will appear here with their validation results." />
      ) : (
        <DataTable
          exportFileName="HLPL_ImportHistory"
          columns={[
            { key: 'fileName', header: 'File Name', accessor: (r) => r.fileName },
            { key: 'channel', header: 'Channel', accessor: (r) => CHANNEL_MAP[r.channel]?.label ?? r.channel },
            { key: 'reportType', header: 'Report Type', accessor: (r) => r.reportType },
            { key: 'uploadedAt', header: 'Upload Date', accessor: (r) => r.uploadedAt, render: (r) => new Date(r.uploadedAt).toLocaleString('en-IN') },
            { key: 'recordCount', header: 'Records', accessor: (r) => r.recordCount, align: 'right' },
            { key: 'validRecordCount', header: 'Valid', accessor: (r) => r.validRecordCount, align: 'right' },
            {
              key: 'status',
              header: 'Status',
              accessor: (r) => r.status,
              render: (r) => (
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    r.status === 'success' ? 'bg-[color-mix(in_oklab,var(--good)_16%,transparent)] text-[var(--good-ink)]' : r.status === 'partial' ? 'bg-[color-mix(in_oklab,var(--warning)_20%,transparent)] text-[var(--ink-2)]' : 'bg-[color-mix(in_oklab,var(--critical)_16%,transparent)] text-[var(--critical-ink)]'
                  }`}
                >
                  {r.status}
                </span>
              ),
            },
            {
              key: 'reverse',
              header: 'Reverse',
              accessor: (r) => r.id,
              align: 'right',
              render: (r) => (confirming === r.id ? (
                <span className="flex items-center justify-end gap-2 whitespace-nowrap">
                  <button
                    type="button" disabled={busy === r.id} onClick={() => void reverse(r.id)}
                    className="rounded-md bg-[var(--critical)] px-2 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40"
                  >
                    {busy === r.id ? 'Reversing…' : 'Yes, reverse'}
                  </button>
                  <button
                    type="button" onClick={() => setConfirming(null)}
                    className="text-xs font-medium text-[var(--ink-3)] hover:text-[var(--ink)]"
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => { setConfirming(r.id); setOutcome(null); setError(null) }}
                  title="Take this upload back out and put back whatever it replaced"
                  className="text-xs font-medium text-[var(--ink-3)] hover:text-[var(--critical-ink)]"
                >
                  Reverse
                </button>
              )),
            },
          ]}
          rows={imports}
        />
      )}
    </PageShell>
  )
}
