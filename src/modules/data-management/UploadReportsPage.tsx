import { useState } from 'react'
import { PageShell } from '@/components/layout/PageShell'
import { parseSpreadsheetFile } from '@/lib/csvParse'
import { detectAmazonSellerCentralReport, normalizeAmazonSellerCentralRows } from '@/data/normalize/amazonSellerCentral'
import { checkForDuplicates } from '@/data/normalize/duplicates'
import { useDataStore } from '@/store/dataStore'
import type { CanonicalSalesRecord, ImportRecord } from '@/data/models'

type Stage = 'idle' | 'parsed' | 'error'

interface PreviewState {
  fileName: string
  reportType: string
  totalRows: number
  validRecords: CanonicalSalesRecord[]
  invalidCount: number
  warnings: string[]
  duplicateCount: number
  isLikelyReupload: boolean
}

export function UploadReportsPage() {
  const { skuMaster, salesRecords, addImportedSales } = useDataStore()
  const [stage, setStage] = useState<Stage>('idle')
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<PreviewState | null>(null)

  async function handleFile(file: File) {
    setError(null)
    try {
      const parsed = await parseSpreadsheetFile(file)

      if (!detectAmazonSellerCentralReport(parsed.headers)) {
        setStage('error')
        setError(
          'Upload failed. Existing data has NOT been changed. Reason: could not identify this as an Amazon Seller Central order report (required columns amazon-order-id / purchase-date / sku not found). Only this report type is supported in this build — other marketplaces are coming soon.',
        )
        return
      }

      const importId = `import-${Date.now()}`
      const result = normalizeAmazonSellerCentralRows(parsed.rows, skuMaster, importId)
      const dup = checkForDuplicates(result.validRecords, salesRecords)

      setPreview({
        fileName: file.name,
        reportType: 'Amazon India — Seller Central Order Report',
        totalRows: result.totalRows,
        validRecords: result.validRecords,
        invalidCount: result.invalidRows.length,
        warnings: result.warnings,
        duplicateCount: dup.duplicateCount,
        isLikelyReupload: dup.isLikelyReupload,
      })
      setStage('parsed')
    } catch (e) {
      setStage('error')
      setError(`Upload failed. Existing data has NOT been changed. Reason: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  function confirmImport() {
    if (!preview) return
    const importRecord: ImportRecord = {
      id: `import-${Date.now()}`,
      fileName: preview.fileName,
      channel: 'amazon_in_seller',
      reportType: preview.reportType,
      uploadedAt: new Date().toISOString(),
      recordCount: preview.totalRows,
      validRecordCount: preview.validRecords.length,
      status: preview.invalidCount > 0 ? 'partial' : 'success',
      warnings: preview.warnings,
    }
    addImportedSales(preview.validRecords, importRecord)
    setPreview(null)
    setStage('idle')
  }

  return (
    <PageShell title="Upload Reports" subtitle="Upload marketplace reports for normalization and import" showFilters={false}>
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
        <input
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) handleFile(file)
            e.target.value = ''
          }}
          className="mx-auto block text-sm text-slate-600"
        />
        <p className="mt-3 text-xs text-slate-400">
          Supported now: Amazon India — Seller Central order reports (.csv, .xlsx, .xls). Additional marketplace
          report types are added incrementally.
        </p>
      </div>

      {stage === 'error' && error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
      )}

      {preview && (
        <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
          <div className="text-sm font-semibold text-slate-800">{preview.fileName}</div>
          <div className="text-sm text-slate-600">{preview.reportType}</div>

          <ul className="space-y-1 text-sm">
            <li className="text-slate-700">✓ {preview.totalRows.toLocaleString()} records detected</li>
            <li className="text-emerald-700">✓ {preview.validRecords.length.toLocaleString()} valid</li>
            {preview.invalidCount > 0 && <li className="text-amber-700">⚠ {preview.invalidCount.toLocaleString()} records failed validation and will be skipped</li>}
            {preview.duplicateCount > 0 && <li className="text-amber-700">⚠ {preview.duplicateCount.toLocaleString()} duplicate record(s) already imported previously</li>}
            {preview.warnings.map((w, i) => (
              <li key={i} className="text-amber-700">
                ⚠ {w}
              </li>
            ))}
          </ul>

          {preview.isLikelyReupload && (
            <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
              This file looks like it has already been imported (≥90% of rows match existing records). Review before
              proceeding — importing again will add duplicate rows to Sales/SKU analytics.
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={confirmImport}
              disabled={preview.validRecords.length === 0}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
            >
              Import {preview.validRecords.length.toLocaleString()} Records
            </button>
            <button
              type="button"
              onClick={() => {
                setPreview(null)
                setStage('idle')
              }}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </PageShell>
  )
}
