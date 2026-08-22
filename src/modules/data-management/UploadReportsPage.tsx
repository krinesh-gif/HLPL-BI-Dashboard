import { useState } from 'react'
import { PageShell } from '@/components/layout/PageShell'
import { parseSpreadsheetFile, type ParsedFile } from '@/lib/csvParse'
import { detectAmazonSellerCentralReport, normalizeAmazonSellerCentralRows } from '@/data/normalize/amazonSellerCentral'
import { detectFlipkartSkuPnlReport, normalizeFlipkartSkuPnl } from '@/data/normalize/flipkartSkuPnl'
import { detectAmazonUsaProductProfitabilityReport, normalizeAmazonUsaProductProfitability } from '@/data/normalize/amazonUsaProductProfitability'
import { detectMeeshoOrderSummaryReport, normalizeMeeshoOrderSummary } from '@/data/normalize/meeshoOrderSummary'
import { isMeeshoSettlementJson, normalizeMeeshoSettlementJson, type MeeshoSettlementJson } from '@/data/normalize/meeshoSettlementJson'
import { checkForDuplicates } from '@/data/normalize/duplicates'
import { useDataStore } from '@/store/dataStore'
import { useFilterStore } from '@/store/filterStore'
import { CHANNEL_MAP, type ChannelId } from '@/config/channels'
import type { AmazonUsaPnlFacts, CanonicalSalesRecord, FlipkartPnlFacts, ImportRecord, MeeshoPnlFacts } from '@/data/models'

type ReportKind = 'amazon_seller_central' | 'flipkart_sku_pnl' | 'amazon_usa_product_profitability' | 'meesho_order_summary' | 'meesho_settlement_json'

const REPORT_LABELS: Record<ReportKind, string> = {
  amazon_seller_central: 'Amazon India — Seller Central Order Report',
  flipkart_sku_pnl: 'Flipkart — SKU-Level P&L Report',
  amazon_usa_product_profitability: 'Amazon USA — Product Profitability Report',
  meesho_order_summary: 'Meesho — Order Summary Report',
  meesho_settlement_json: 'Meesho — Settlement Data (JSON)',
}
const REPORT_CHANNEL: Record<ReportKind, ChannelId> = {
  amazon_seller_central: 'amazon_in_seller',
  flipkart_sku_pnl: 'flipkart',
  amazon_usa_product_profitability: 'amazon_us',
  meesho_order_summary: 'meesho',
  meesho_settlement_json: 'meesho',
}

type Stage = 'idle' | 'needs-month' | 'parsed' | 'error'

interface PreviewState {
  fileName: string
  reportKind: ReportKind
  totalRows: number
  validRecords: CanonicalSalesRecord[]
  invalidCount: number
  warnings: string[]
  duplicateCount: number
  isLikelyReupload: boolean
  flipkartFacts?: FlipkartPnlFacts
  amazonUsaFacts?: AmazonUsaPnlFacts
  meeshoFactsByMonth?: MeeshoPnlFacts[]
}

export function UploadReportsPage() {
  const { skuMaster, salesRecords, addImportedSales, setFlipkartFacts, setAmazonUsaFacts, setMeeshoFacts } = useDataStore()
  const { month: filterMonth } = useFilterStore()
  const [stage, setStage] = useState<Stage>('idle')
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [pendingFile, setPendingFile] = useState<{ fileName: string; parsed: ParsedFile } | null>(null)
  const [flipkartMonth, setFlipkartMonth] = useState(filterMonth)

  function buildPreview(kind: ReportKind, fileName: string, parsed: ParsedFile, month: string) {
    const importId = `import-${Date.now()}`
    let result: { validRecords: CanonicalSalesRecord[]; totalRows: number; invalidRows: { reason: string }[]; warnings: string[] }
    let flipkartFacts: FlipkartPnlFacts | undefined
    let amazonUsaFacts: AmazonUsaPnlFacts | undefined

    if (kind === 'amazon_seller_central') {
      result = normalizeAmazonSellerCentralRows(parsed.rows, skuMaster, importId)
    } else if (kind === 'flipkart_sku_pnl') {
      const r = normalizeFlipkartSkuPnl(parsed.rows, skuMaster, month, importId)
      result = r
      flipkartFacts = r.facts
    } else if (kind === 'amazon_usa_product_profitability') {
      const r = normalizeAmazonUsaProductProfitability(parsed.headers, parsed.rows, skuMaster, importId)
      result = r
      amazonUsaFacts = r.facts
    } else {
      result = normalizeMeeshoOrderSummary(parsed.rows, skuMaster, importId)
    }

    const dup = checkForDuplicates(result.validRecords, salesRecords)
    setPreview({
      fileName, reportKind: kind, totalRows: result.totalRows, validRecords: result.validRecords,
      invalidCount: result.invalidRows.length, warnings: result.warnings,
      duplicateCount: dup.duplicateCount, isLikelyReupload: dup.isLikelyReupload,
      flipkartFacts, amazonUsaFacts,
    })
    setStage('parsed')
  }

  async function handleFile(file: File) {
    setError(null)
    try {
      if (file.name.toLowerCase().endsWith('.json')) {
        const text = await file.text()
        const data = JSON.parse(text) as unknown
        if (!isMeeshoSettlementJson(data)) {
          setStage('error')
          setError('Upload failed. Existing data has NOT been changed. Reason: this JSON file does not match the expected Meesho settlement data schema (missing ROWF/orders).')
          return
        }
        const importId = `import-${Date.now()}`
        const result = normalizeMeeshoSettlementJson(data as MeeshoSettlementJson, skuMaster, importId)
        const dup = checkForDuplicates(result.validRecords, salesRecords)
        setPreview({
          fileName: file.name, reportKind: 'meesho_settlement_json', totalRows: result.totalRows,
          validRecords: result.validRecords, invalidCount: result.invalidRows.length, warnings: result.warnings,
          duplicateCount: dup.duplicateCount, isLikelyReupload: dup.isLikelyReupload,
          meeshoFactsByMonth: result.factsByMonth,
        })
        setStage('parsed')
        return
      }

      const parsed = await parseSpreadsheetFile(file)
      let kind: ReportKind | null = null
      if (detectAmazonSellerCentralReport(parsed.headers)) kind = 'amazon_seller_central'
      else if (detectFlipkartSkuPnlReport(parsed.headers)) kind = 'flipkart_sku_pnl'
      else if (detectAmazonUsaProductProfitabilityReport(parsed.headers)) kind = 'amazon_usa_product_profitability'
      else if (detectMeeshoOrderSummaryReport(parsed.headers)) kind = 'meesho_order_summary'

      if (!kind) {
        setStage('error')
        setError(
          'Upload failed. Existing data has NOT been changed. Reason: this file did not match any supported report format (Amazon India Seller Central, Flipkart SKU-level P&L, Amazon USA Product Profitability, or Meesho Order Summary).',
        )
        return
      }

      if (kind === 'flipkart_sku_pnl') {
        // This report has no date column of its own — ask which month it covers before normalizing.
        setPendingFile({ fileName: file.name, parsed })
        setStage('needs-month')
        return
      }

      buildPreview(kind, file.name, parsed, filterMonth)
    } catch (e) {
      setStage('error')
      setError(`Upload failed. Existing data has NOT been changed. Reason: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  function confirmFlipkartMonth() {
    if (!pendingFile) return
    buildPreview('flipkart_sku_pnl', pendingFile.fileName, pendingFile.parsed, flipkartMonth)
    setPendingFile(null)
  }

  function confirmImport() {
    if (!preview) return
    const importRecord: ImportRecord = {
      id: `import-${Date.now()}`,
      fileName: preview.fileName,
      channel: REPORT_CHANNEL[preview.reportKind],
      reportType: REPORT_LABELS[preview.reportKind],
      uploadedAt: new Date().toISOString(),
      recordCount: preview.totalRows,
      validRecordCount: preview.validRecords.length,
      status: preview.invalidCount > 0 ? 'partial' : 'success',
      warnings: preview.warnings,
    }
    addImportedSales(preview.validRecords, importRecord)
    if (preview.flipkartFacts) setFlipkartFacts(preview.flipkartFacts)
    if (preview.amazonUsaFacts) setAmazonUsaFacts(preview.amazonUsaFacts)
    if (preview.meeshoFactsByMonth) for (const f of preview.meeshoFactsByMonth) setMeeshoFacts(f)
    setPreview(null)
    setStage('idle')
  }

  function cancel() {
    setPreview(null)
    setPendingFile(null)
    setStage('idle')
  }

  return (
    <PageShell title="Upload Reports" subtitle="Upload marketplace reports for normalization and import" showFilters={false}>
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
        <input
          type="file"
          accept=".csv,.xlsx,.xls,.json"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) handleFile(file)
            e.target.value = ''
          }}
          className="mx-auto block text-sm text-slate-600"
        />
        <p className="mt-3 text-xs text-slate-400">
          Supported: Amazon India Seller Central order reports, Flipkart SKU-level P&L exports, Amazon USA Product
          Profitability exports, Meesho Order Summary reports (.csv/.xlsx/.xls), and Meesho Settlement Data (.json).
        </p>
      </div>

      {stage === 'error' && error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
      )}

      {stage === 'needs-month' && pendingFile && (
        <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-5">
          <div className="text-sm font-semibold text-slate-800">{pendingFile.fileName}</div>
          <p className="text-sm text-slate-600">
            Flipkart's SKU-level P&L report is a monthly total per SKU — it doesn't carry its own date column. Which
            month does this file cover?
          </p>
          <input
            type="month"
            value={flipkartMonth}
            onChange={(e) => setFlipkartMonth(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
          />
          <div className="flex gap-2">
            <button type="button" onClick={confirmFlipkartMonth} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
              Continue
            </button>
            <button type="button" onClick={cancel} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
              Cancel
            </button>
          </div>
        </div>
      )}

      {preview && (
        <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
          <div className="text-sm font-semibold text-slate-800">{preview.fileName}</div>
          <div className="text-sm text-slate-600">
            {REPORT_LABELS[preview.reportKind]} — {CHANNEL_MAP[REPORT_CHANNEL[preview.reportKind]].label}
          </div>

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
            <button type="button" onClick={cancel} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
              Cancel
            </button>
          </div>
        </div>
      )}
    </PageShell>
  )
}
