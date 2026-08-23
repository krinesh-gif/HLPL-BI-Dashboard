import { useState } from 'react'
import { PageShell } from '@/components/layout/PageShell'
import { parseSpreadsheetFile, readWorkbookSheetsRaw, type ParsedFile } from '@/lib/csvParse'
import { detectAmazonSellerCentralReport, normalizeAmazonSellerCentralRows } from '@/data/normalize/amazonSellerCentral'
import { detectFlipkartSkuPnlReport, normalizeFlipkartSkuPnl } from '@/data/normalize/flipkartSkuPnl'
import { detectFlipkartWorkbook, normalizeFlipkartWorkbook } from '@/data/normalize/flipkartWorkbook'
import { detectAmazonUsaProductProfitabilityReport, normalizeAmazonUsaProductProfitability } from '@/data/normalize/amazonUsaProductProfitability'
import { detectMeeshoOrderSummaryReport, normalizeMeeshoOrderSummary } from '@/data/normalize/meeshoOrderSummary'
import { detectMeeshoOrderPaymentsSheet, normalizeMeeshoOrderPayments } from '@/data/normalize/meeshoOrderPayments'
import { isMeeshoSettlementJson, normalizeMeeshoSettlementJson, type MeeshoSettlementJson } from '@/data/normalize/meeshoSettlementJson'
import { detectAmazonAdsSponsoredProductsReport, normalizeAmazonAdsSponsoredProductsReport } from '@/data/normalize/amazonAdsSponsoredProducts'
import { checkForDuplicates } from '@/data/normalize/duplicates'
import { useDataStore, type ImportOutcome } from '@/store/dataStore'
import { monthLabel } from '@/lib/format'
import { useFilterStore } from '@/store/filterStore'
import { CHANNEL_MAP, type ChannelId } from '@/config/channels'
import type { AdsRecord, AmazonUsaPnlFacts, CanonicalSalesRecord, FlipkartPnlFacts, ImportRecord, MeeshoPnlFacts } from '@/data/models'

type ReportKind =
  | 'amazon_seller_central'
  | 'flipkart_sku_pnl'
  | 'flipkart_workbook'
  | 'amazon_usa_product_profitability'
  | 'meesho_order_summary'
  | 'meesho_order_payments'
  | 'meesho_settlement_json'
  | 'amazon_ads_sponsored_products'

const REPORT_LABELS: Record<ReportKind, string> = {
  amazon_seller_central: 'Amazon India — Seller Central Order Report',
  flipkart_sku_pnl: 'Flipkart — SKU-Level P&L Report',
  flipkart_workbook: 'Flipkart — Full P&L Workbook (Overall Summary + Orders P&L)',
  amazon_usa_product_profitability: 'Amazon USA — Product Profitability Report',
  meesho_order_summary: 'Meesho — Order Summary Report',
  meesho_order_payments: 'Meesho — Aggregated Payment File (Order Payments + Ads Cost)',
  meesho_settlement_json: 'Meesho — Settlement Data (JSON)',
  amazon_ads_sponsored_products: 'Amazon Ads — Sponsored Products Campaign Report',
}
const REPORT_CHANNEL: Record<ReportKind, ChannelId> = {
  amazon_seller_central: 'amazon_in_seller',
  flipkart_sku_pnl: 'flipkart',
  flipkart_workbook: 'flipkart',
  amazon_usa_product_profitability: 'amazon_us',
  meesho_order_summary: 'meesho',
  meesho_order_payments: 'meesho',
  meesho_settlement_json: 'meesho',
  amazon_ads_sponsored_products: 'amazon_in_seller', // overridden per-preview when ads records exist
}

type Stage = 'idle' | 'needs-month' | 'parsed' | 'importing' | 'error'

interface PreviewState {
  fileName: string
  reportKind: ReportKind
  totalRows: number
  validRecords: CanonicalSalesRecord[]
  adsRecords: AdsRecord[]
  invalidCount: number
  warnings: string[]
  duplicateCount: number
  isLikelyReupload: boolean
  flipkartFacts?: FlipkartPnlFacts
  amazonUsaFacts?: AmazonUsaPnlFacts
  meeshoFactsByMonth?: MeeshoPnlFacts[]
}

export function UploadReportsPage() {
  const { skuMaster, importReport, importProgress } = useDataStore()
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null)
  const { month: filterMonth } = useFilterStore()
  const [stage, setStage] = useState<Stage>('idle')
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [pendingFile, setPendingFile] = useState<{ fileName: string; parsed: ParsedFile } | null>(null)
  const [flipkartMonth, setFlipkartMonth] = useState(filterMonth)

  async function showPreview(partial: Omit<PreviewState, 'duplicateCount' | 'isLikelyReupload' | 'adsRecords'> & { adsRecords?: AdsRecord[] }) {
    // The duplicate check runs against the shared database now, not a local
    // copy of every row — so it also catches rows a teammate already imported.
    const dup = await checkForDuplicates(partial.validRecords)
    setPreview({ ...partial, adsRecords: partial.adsRecords ?? [], duplicateCount: dup.duplicateCount, isLikelyReupload: dup.isLikelyReupload })
    setStage('parsed')
  }

  async function buildSimplePreview(kind: ReportKind, fileName: string, parsed: ParsedFile, month: string) {
    const importId = `import-${Date.now()}`

    if (kind === 'amazon_seller_central') {
      const r = normalizeAmazonSellerCentralRows(parsed.rows, skuMaster, importId)
      await showPreview({ fileName, reportKind: kind, totalRows: r.totalRows, validRecords: r.validRecords, invalidCount: r.invalidRows.length, warnings: r.warnings })
    } else if (kind === 'flipkart_sku_pnl') {
      const r = normalizeFlipkartSkuPnl(parsed.rows, skuMaster, month, importId)
      await showPreview({ fileName, reportKind: kind, totalRows: r.totalRows, validRecords: r.validRecords, invalidCount: r.invalidRows.length, warnings: r.warnings, flipkartFacts: r.facts })
    } else if (kind === 'amazon_usa_product_profitability') {
      const r = normalizeAmazonUsaProductProfitability(parsed.headers, parsed.rows, skuMaster, importId)
      await showPreview({ fileName, reportKind: kind, totalRows: r.totalRows, validRecords: r.validRecords, invalidCount: r.invalidRows.length, warnings: r.warnings, amazonUsaFacts: r.facts })
    } else if (kind === 'meesho_order_summary') {
      const r = normalizeMeeshoOrderSummary(parsed.rows, skuMaster, importId)
      await showPreview({ fileName, reportKind: kind, totalRows: r.totalRows, validRecords: r.validRecords, invalidCount: r.invalidRows.length, warnings: r.warnings })
    } else if (kind === 'amazon_ads_sponsored_products') {
      const r = normalizeAmazonAdsSponsoredProductsReport(parsed.rows, importId)
      await showPreview({ fileName, reportKind: kind, totalRows: r.totalRows, validRecords: [], adsRecords: r.adsRecords, invalidCount: r.invalidRows.length, warnings: r.warnings })
    }
  }

  async function handleFile(file: File) {
    setError(null)
    setOutcome(null)
    try {
      const lowerName = file.name.toLowerCase()

      if (lowerName.endsWith('.json')) {
        const text = await file.text()
        const data = JSON.parse(text) as unknown
        if (!isMeeshoSettlementJson(data)) {
          setStage('error')
          setError('Upload failed. Existing data has NOT been changed. Reason: this JSON file does not match the expected Meesho settlement data schema (missing ROWF/orders).')
          return
        }
        const importId = `import-${Date.now()}`
        const r = normalizeMeeshoSettlementJson(data as MeeshoSettlementJson, skuMaster, importId)
        await showPreview({
          fileName: file.name, reportKind: 'meesho_settlement_json', totalRows: r.totalRows,
          validRecords: r.validRecords, invalidCount: r.invalidRows.length, warnings: r.warnings,
          meeshoFactsByMonth: r.factsByMonth,
        })
        return
      }

      if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls')) {
        const sheets = await readWorkbookSheetsRaw(file)
        const sheetNames = Object.keys(sheets)
        const importId = `import-${Date.now()}`

        if (detectFlipkartWorkbook(sheetNames)) {
          const r = normalizeFlipkartWorkbook(sheets, skuMaster, importId)
          await showPreview({
            fileName: file.name, reportKind: 'flipkart_workbook', totalRows: r.totalRows,
            validRecords: r.validRecords, invalidCount: r.invalidRows.length, warnings: r.warnings, flipkartFacts: r.facts,
          })
          return
        }

        if (detectMeeshoOrderPaymentsSheet(sheets['Order Payments'])) {
          const r = normalizeMeeshoOrderPayments(sheets['Order Payments'], sheets['Ads Cost'], skuMaster, importId)
          await showPreview({
            fileName: file.name, reportKind: 'meesho_order_payments', totalRows: r.totalRows,
            validRecords: r.validRecords, invalidCount: r.invalidRows.length, warnings: r.warnings, meeshoFactsByMonth: r.factsByMonth,
          })
          return
        }
        // Not a recognized multi-sheet workbook — fall through to the single-sheet path below.
      }

      const parsed = await parseSpreadsheetFile(file)
      let kind: ReportKind | null = null
      if (detectAmazonSellerCentralReport(parsed.headers)) kind = 'amazon_seller_central'
      else if (detectFlipkartSkuPnlReport(parsed.headers)) kind = 'flipkart_sku_pnl'
      else if (detectAmazonUsaProductProfitabilityReport(parsed.headers)) kind = 'amazon_usa_product_profitability'
      else if (detectMeeshoOrderSummaryReport(parsed.headers)) kind = 'meesho_order_summary'
      else if (detectAmazonAdsSponsoredProductsReport(parsed.headers)) kind = 'amazon_ads_sponsored_products'

      if (!kind) {
        setStage('error')
        setError(
          'Upload failed. Existing data has NOT been changed. Reason: this file did not match any supported report format.',
        )
        return
      }

      if (kind === 'flipkart_sku_pnl') {
        // This report has no date column of its own — ask which month it covers before normalizing.
        setPendingFile({ fileName: file.name, parsed })
        setStage('needs-month')
        return
      }

      await buildSimplePreview(kind, file.name, parsed, filterMonth)
    } catch (e) {
      setStage('error')
      setError(`Upload failed. Existing data has NOT been changed. Reason: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  async function confirmFlipkartMonth() {
    if (!pendingFile) return
    await buildSimplePreview('flipkart_sku_pnl', pendingFile.fileName, pendingFile.parsed, flipkartMonth)
    setPendingFile(null)
  }

  async function confirmImport() {
    if (!preview) return
    const channel = preview.adsRecords[0]?.channel ?? REPORT_CHANNEL[preview.reportKind]
    const importRecord: ImportRecord = {
      id: `import-${Date.now()}`,
      fileName: preview.fileName,
      channel,
      reportType: REPORT_LABELS[preview.reportKind],
      uploadedAt: new Date().toISOString(),
      recordCount: preview.totalRows,
      validRecordCount: preview.validRecords.length + preview.adsRecords.length,
      status: preview.invalidCount > 0 ? 'partial' : 'success',
      warnings: preview.warnings,
    }

    setStage('importing')
    try {
      const result = await importReport({
        importRecord,
        salesRecords: preview.validRecords,
        adsRecords: preview.adsRecords,
        flipkartFacts: preview.flipkartFacts,
        amazonUsaFacts: preview.amazonUsaFacts,
        meeshoFactsByMonth: preview.meeshoFactsByMonth,
      })
      setOutcome(result)
      setPreview(null)
      setStage('idle')
    } catch (e) {
      // The upload writes to a shared database now, so a failure has to be
      // visible — silently returning to idle would look like it succeeded.
      setStage('error')
      setError(`Import failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  function cancel() {
    setPreview(null)
    setPendingFile(null)
    setStage('idle')
  }

  const totalValid = preview ? preview.validRecords.length + preview.adsRecords.length : 0

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
          Supported: Amazon India Seller Central order reports, Flipkart SKU-level P&L exports (or the full P&L
          workbook), Amazon USA Product Profitability exports, Amazon Ads Sponsored Products campaign reports, Meesho
          Order Summary reports, the Meesho aggregated payment file, and Meesho Settlement Data (.json).
        </p>
      </div>

      {stage === 'error' && error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
      )}

      {outcome && stage === 'idle' && (
        <div className="mb-6 rounded-lg border border-emerald-300 bg-emerald-50 p-4">
          <h3 className="text-sm font-semibold text-emerald-900">✓ Imported {outcome.fileName}</h3>
          <ul className="mt-2 space-y-0.5 text-sm text-emerald-800">
            <li>{outcome.added.toLocaleString()} new record(s) added to the shared data.</li>
            {outcome.skippedAsDuplicate > 0 && (
              <li>
                {outcome.skippedAsDuplicate.toLocaleString()} row(s) were already imported and were skipped, so nothing
                is double-counted.
              </li>
            )}
            {outcome.monthsUpdated.length > 0 && (
              <li>P&amp;L updated for {outcome.monthsUpdated.map(monthLabel).join(', ')}.</li>
            )}
            {outcome.added === 0 && outcome.skippedAsDuplicate > 0 && (
              <li className="font-medium">This file had already been imported — nothing changed.</li>
            )}
          </ul>
          <button
            type="button"
            onClick={() => setOutcome(null)}
            className="mt-3 text-xs font-medium text-emerald-700 hover:text-emerald-900"
          >
            Dismiss
          </button>
        </div>
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
            {REPORT_LABELS[preview.reportKind]}
            {preview.adsRecords.length === 0 && ` — ${CHANNEL_MAP[REPORT_CHANNEL[preview.reportKind]].label}`}
          </div>

          <ul className="space-y-1 text-sm">
            <li className="text-slate-700">✓ {preview.totalRows.toLocaleString()} records detected</li>
            <li className="text-emerald-700">✓ {totalValid.toLocaleString()} valid</li>
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
              disabled={totalValid === 0 || stage === 'importing'}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
            >
              {stage === 'importing'
                ? importProgress && importProgress.total > 0
                  ? `Importing ${importProgress.sent.toLocaleString()} of ${importProgress.total.toLocaleString()}…`
                  : 'Importing…'
                : `Import ${totalValid.toLocaleString()} Records`}
            </button>
            <button type="button" onClick={cancel} disabled={stage === 'importing'} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40">
              Cancel
            </button>
          </div>
        </div>
      )}
    </PageShell>
  )
}
