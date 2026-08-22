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
                    r.status === 'success' ? 'bg-emerald-100 text-emerald-700' : r.status === 'partial' ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'
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
