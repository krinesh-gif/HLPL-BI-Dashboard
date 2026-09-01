import { PageShell } from '@/components/layout/PageShell'
import { DataTable } from '@/components/ui/DataTable'
import { EmptyState } from '@/components/ui/EmptyState'
import { CHANNEL_MAP } from '@/config/channels'
import { useDataStore } from '@/store/dataStore'

export function ImportHistoryPage() {
  const imports = useDataStore((s) => s.imports)

  return (
    <PageShell title="Import History" subtitle="Every report ever uploaded, with validation outcome" showFilters={false}>
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
          ]}
          rows={imports}
        />
      )}
    </PageShell>
  )
}
