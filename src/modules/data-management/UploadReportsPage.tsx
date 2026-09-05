import { useState } from 'react'
import { PageShell } from '@/components/layout/PageShell'
import { parseSpreadsheetFile, readWorkbookSheetsRaw, type ParsedFile } from '@/lib/csvParse'
import { detectAmazonSellerCentralReport, normalizeAmazonSellerCentralRows } from '@/data/normalize/amazonSellerCentral'
import { detectFlipkartSkuPnlReport, normalizeFlipkartSkuPnl } from '@/data/normalize/flipkartSkuPnl'
import { detectFlipkartWorkbook, normalizeFlipkartWorkbook } from '@/data/normalize/flipkartWorkbook'
import { detectAmazonUsaProductProfitabilityReport, normalizeAmazonUsaProductProfitability } from '@/data/normalize/amazonUsaProductProfitability'
import { detectMeeshoOrderSummaryReport, normalizeMeeshoOrderSummary } from '@/data/normalize/meeshoOrderSummary'
import { detectMeeshoOrderPaymentsSheet, normalizeMeeshoOrderPayments } from '@/data/normalize/meeshoOrderPayments'
import { detectSkuMapWorkbook, normalizeSkuMapWorkbook } from '@/data/normalize/skuMapWorkbook'
import { detectAmazonAdsSponsoredProductsReport, normalizeAmazonAdsSponsoredProductsReport } from '@/data/normalize/amazonAdsSponsoredProducts'
import { checkForDuplicates } from '@/data/normalize/duplicates'
import { useDataStore, type ImportOutcome } from '@/store/dataStore'
import { monthLabel } from '@/lib/format'
import { useFilterStore } from '@/store/filterStore'
import { CHANNEL_MAP, type ChannelId } from '@/config/channels'
import type { AdsRecord, AmazonUsaPnlFacts, CanonicalSalesRecord, FlipkartPnlFacts, ImportRecord, MeeshoPnlFacts } from '@/data/models'
import type { MeeshoTransaction } from '@/data/meesho/transaction'
import type { MeeshoAdsRow, MeeshoRecoveryRow } from '@/data/normalize/meeshoOrderPayments'

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
  meeshoTransactions?: MeeshoTransaction[]
  meeshoAdsRows?: MeeshoAdsRow[]
  meeshoRecoveryRows?: MeeshoRecoveryRow[]
}

/**
 * One file waiting to be imported.
 *
 * Reports arrive a month at a time, so a season's catch-up is a dozen files.
 * Doing them one at a time means a dozen rounds of pick, wait, read, confirm —
 * and the reading is the part that matters, because a file that quietly failed
 * detection looks exactly like one that imported. Every file is therefore
 * analysed up front and listed with what it was recognised as and what it will
 * do, and they import in one pass with each result kept beside its own file.
 */
type ItemStatus = 'ready' | 'needs-month' | 'error' | 'importing' | 'done' | 'failed'

interface QueueItem {
  id: string
  fileName: string
  status: ItemStatus
  preview?: PreviewState
  /** Held for a Flipkart SKU P&L, which cannot be normalized until its month
   * is known, and for nothing else. */
  parsed?: ParsedFile
  month?: string
  skuMap?: SkuMapWorkbookResult
  error?: string
  outcome?: ImportOutcome
}

type SkuMapWorkbookResult = ReturnType<typeof normalizeSkuMapWorkbook>

/** A one-off id. Kept out of the component so the linter can see it is called
 * from an event handler and never while rendering. */
let idCounter = 0
function uniqueId(prefix: string): string {
  idCounter += 1
  return `${prefix}-${Date.now()}-${idCounter}`
}

export function UploadReportsPage() {
  const { skuMaster, importReport, importProgress, importSkuMapWorkbook, clearMeeshoData, meeshoFacts } = useDataStore()
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null)
  const { month: filterMonth } = useFilterStore()
  const [stage, setStage] = useState<Stage>('idle')
  const [error, setError] = useState<string | null>(null)
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [reading, setReading] = useState<{ done: number; total: number } | null>(null)
  const [resetting, setResetting] = useState(false)
  const [resetResult, setResetResult] = useState<string | null>(null)

  const meeshoMonths = meeshoFacts.filter((f) => f.basis === 'order').length

  async function resetMeesho() {
    if (!window.confirm(
      'Remove every stored Meesho event?\n\nThe P&L for every Meesho month will be empty until you upload the ' +
      'payment files again. Nothing else is touched.',
    )) return
    setResetting(true)
    setResetResult(null)
    try {
      const { clearedEvents, clearedOrderRows } = await clearMeeshoData()
      setResetResult(
        `Removed ${clearedEvents.toLocaleString('en-IN')} Meesho event(s) and ` +
        `${clearedOrderRows.toLocaleString('en-IN')} order row(s). Upload the payment files again to rebuild.`,
      )
    } catch (e) {
      setResetResult(e instanceof Error ? e.message : String(e))
    } finally {
      setResetting(false)
    }
  }

  /** Builds a preview without touching component state, so it can be called
   * once per file while a batch is being read. */
  async function buildPreview(
    partial: Omit<PreviewState, 'duplicateCount' | 'isLikelyReupload' | 'adsRecords'> & { adsRecords?: AdsRecord[] },
  ): Promise<PreviewState> {
    // The duplicate check runs against the shared database now, not a local
    // copy of every row — so it also catches rows a teammate already imported.
    const dup = await checkForDuplicates(partial.validRecords)
    return {
      ...partial,
      adsRecords: partial.adsRecords ?? [],
      duplicateCount: dup.duplicateCount,
      isLikelyReupload: dup.isLikelyReupload,
    }
  }

  async function previewSimple(kind: ReportKind, fileName: string, parsed: ParsedFile, month: string): Promise<PreviewState> {
    const importId = uniqueId('import')
    const base = { fileName, reportKind: kind }
    if (kind === 'amazon_seller_central') {
      const r = normalizeAmazonSellerCentralRows(parsed.rows, skuMaster, importId)
      return buildPreview({ ...base, totalRows: r.totalRows, validRecords: r.validRecords, invalidCount: r.invalidRows.length, warnings: r.warnings })
    }
    if (kind === 'flipkart_sku_pnl') {
      const r = normalizeFlipkartSkuPnl(parsed.rows, skuMaster, month, importId)
      return buildPreview({ ...base, totalRows: r.totalRows, validRecords: r.validRecords, invalidCount: r.invalidRows.length, warnings: r.warnings, flipkartFacts: r.facts })
    }
    if (kind === 'amazon_usa_product_profitability') {
      const r = normalizeAmazonUsaProductProfitability(parsed.headers, parsed.rows, skuMaster, importId)
      return buildPreview({ ...base, totalRows: r.totalRows, validRecords: r.validRecords, invalidCount: r.invalidRows.length, warnings: r.warnings, amazonUsaFacts: r.facts })
    }
    if (kind === 'meesho_order_summary') {
      const r = normalizeMeeshoOrderSummary(parsed.rows, skuMaster, importId)
      return buildPreview({ ...base, totalRows: r.totalRows, validRecords: r.validRecords, invalidCount: r.invalidRows.length, warnings: r.warnings })
    }
    const r = normalizeAmazonAdsSponsoredProductsReport(parsed.rows, importId)
    return buildPreview({ ...base, totalRows: r.totalRows, validRecords: [], adsRecords: r.adsRecords, invalidCount: r.invalidRows.length, warnings: r.warnings })
  }

  /** Reads one file and works out what it is. Returns the result rather than
   * setting state, so a failure on one file leaves the others alone. */
  async function analyzeFile(file: File): Promise<QueueItem> {
    const id = uniqueId(file.name)
    const fail = (reason: string): QueueItem => ({ id, fileName: file.name, status: 'error', error: reason })
    try {
      const lowerName = file.name.toLowerCase()
      if (lowerName.endsWith('.json')) {
        return fail(
          'Meesho is now read from the aggregated payment workbook (Payments ▸ Download aggregated payment file), ' +
          'which produces both the order-basis and settlement-basis P&L from one upload. Upload that .xlsx instead ' +
          'of the settlement JSON.',
        )
      }

      const importId = uniqueId('import')
      if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls')) {
        const sheets = await readWorkbookSheetsRaw(file)
        const sheetNames = Object.keys(sheets)

        if (detectSkuMapWorkbook(sheetNames)) {
          return { id, fileName: file.name, status: 'ready', skuMap: normalizeSkuMapWorkbook(sheets) }
        }
        if (detectFlipkartWorkbook(sheetNames)) {
          const r = normalizeFlipkartWorkbook(sheets, skuMaster, importId)
          return { id, fileName: file.name, status: 'ready', preview: await buildPreview({
            fileName: file.name, reportKind: 'flipkart_workbook', totalRows: r.totalRows,
            validRecords: r.validRecords, invalidCount: r.invalidRows.length, warnings: r.warnings, flipkartFacts: r.facts,
          }) }
        }
        if (detectMeeshoOrderPaymentsSheet(sheets['Order Payments'])) {
          const r = normalizeMeeshoOrderPayments(
            sheets['Order Payments'], sheets['Ads Cost'], skuMaster, importId, file.name,
            sheets['Compensation and Recovery'],
          )
          // Failed post-import assertions go in front of the owner before the
          // figures are relied on, not into a log nobody reads.
          const failed = r.checks.filter((c) => !c.passed).map((c) => `${c.name}: ${c.detail}`)
          return { id, fileName: file.name, status: 'ready', preview: await buildPreview({
            fileName: file.name, reportKind: 'meesho_order_payments', totalRows: r.totalRows,
            validRecords: r.validRecords, invalidCount: r.invalidRows.length,
            warnings: [...failed, ...r.warnings], meeshoFactsByMonth: r.factsByMonth,
            meeshoTransactions: r.transactions, meeshoAdsRows: r.adsRows, meeshoRecoveryRows: r.recoveryRows,
          }) }
        }
        // Not a recognized multi-sheet workbook — fall through to the single-sheet path.
      }

      const parsed = await parseSpreadsheetFile(file)
      let kind: ReportKind | null = null
      if (detectAmazonSellerCentralReport(parsed.headers)) kind = 'amazon_seller_central'
      else if (detectFlipkartSkuPnlReport(parsed.headers)) kind = 'flipkart_sku_pnl'
      else if (detectAmazonUsaProductProfitabilityReport(parsed.headers)) kind = 'amazon_usa_product_profitability'
      else if (detectMeeshoOrderSummaryReport(parsed.headers)) kind = 'meesho_order_summary'
      else if (detectAmazonAdsSponsoredProductsReport(parsed.headers)) kind = 'amazon_ads_sponsored_products'

      if (!kind) return fail('This file did not match any supported report format.')

      if (kind === 'flipkart_sku_pnl') {
        // This report is a monthly total per SKU with no date column of its
        // own, so it cannot be normalized until someone says which month it is.
        return { id, fileName: file.name, status: 'needs-month', parsed, month: filterMonth }
      }
      return { id, fileName: file.name, status: 'ready', preview: await previewSimple(kind, file.name, parsed, filterMonth) }
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  }

  async function addFiles(files: File[]) {
    setError(null)
    setOutcome(null)
    setStage('idle')
    setReading({ done: 0, total: files.length })
    const added: QueueItem[] = []
    // One at a time: each file runs a duplicate check against the shared
    // database, and firing a dozen of those at once helps nobody.
    for (const file of files) {
      added.push(await analyzeFile(file))
      setReading({ done: added.length, total: files.length })
    }
    setReading(null)
    setQueue((q) => [...q, ...added])
  }

  function updateItem(id: string, patch: Partial<QueueItem>) {
    setQueue((q) => q.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  async function setItemMonth(item: QueueItem, month: string) {
    if (!item.parsed) return
    updateItem(item.id, { month })
  }

  async function resolveMonth(item: QueueItem) {
    if (!item.parsed) return
    const preview = await previewSimple('flipkart_sku_pnl', item.fileName, item.parsed, item.month ?? filterMonth)
    updateItem(item.id, { status: 'ready', preview, parsed: undefined })
  }

  /** Imports one queued file. Never throws: a file that fails is marked failed
   * and the batch carries on, because stopping at the first bad file would
   * leave the rest in limbo with nothing said about them. */
  async function importItem(item: QueueItem): Promise<void> {
    updateItem(item.id, { status: 'importing', error: undefined })
    try {
      if (item.skuMap) {
        const result = await importSkuMapWorkbook(item.fileName, item.skuMap)
        setOutcome(result)
        updateItem(item.id, { status: 'done', outcome: result })
        return
      }
      const preview = item.preview
      if (!preview) throw new Error('Nothing to import for this file.')

      const channel = preview.adsRecords[0]?.channel ?? REPORT_CHANNEL[preview.reportKind]
      const importRecord: ImportRecord = {
        id: uniqueId('import'),
        fileName: preview.fileName,
        channel,
        reportType: REPORT_LABELS[preview.reportKind],
        uploadedAt: new Date().toISOString(),
        recordCount: preview.totalRows,
        validRecordCount: preview.validRecords.length + preview.adsRecords.length,
        status: preview.invalidCount > 0 ? 'partial' : 'success',
        warnings: preview.warnings,
      }
      const result = await importReport({
        importRecord,
        salesRecords: preview.validRecords,
        adsRecords: preview.adsRecords,
        flipkartFacts: preview.flipkartFacts,
        amazonUsaFacts: preview.amazonUsaFacts,
        meeshoFactsByMonth: preview.meeshoFactsByMonth,
      })
      updateItem(item.id, { status: 'done', outcome: result })
    } catch (e) {
      updateItem(item.id, { status: 'failed', error: e instanceof Error ? e.message : String(e) })
    }
  }

  async function importAll() {
    setStage('importing')
    setError(null)
    // Sequential on purpose. These writes are not independent — two files can
    // carry the same month, and the import restates rows rather than only
    // adding them — so running them at once would race over the same rows.
    for (const item of queue) {
      if (item.status !== 'ready') continue
      await importItem(item)
    }
    setStage('idle')
  }

  function removeItem(id: string) {
    setQueue((q) => q.filter((item) => item.id !== id))
  }

  function clearFinished() {
    setQueue((q) => q.filter((item) => item.status !== 'done'))
  }

  const readyCount = queue.filter((i) => i.status === 'ready').length
  const needsMonthCount = queue.filter((i) => i.status === 'needs-month').length
  const busy = stage === 'importing' || reading !== null

  return (
    <PageShell title="Upload Reports" subtitle="Upload marketplace reports for normalization and import" showFilters={false}>
      <div className="rounded-lg border border-dashed border-[var(--line-2)] bg-[var(--surface)] p-6 text-center">
        <input
          type="file"
          multiple
          accept=".csv,.xlsx,.xls,.json"
          disabled={busy}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            if (files.length > 0) void addFiles(files)
            e.target.value = ''
          }}
          className="mx-auto block text-sm text-[var(--ink-2)]"
        />
        <p className="mt-2 text-xs font-medium text-[var(--ink-2)]">
          Pick as many files as you like — a whole year of months in one go. Each is checked on its own before anything
          is written.
        </p>
        <p className="mt-2 text-xs text-[var(--ink-3)]">
          Supported: Amazon India Seller Central order reports, Flipkart SKU-level P&L exports (or the full P&L
          workbook), Amazon USA Product Profitability exports, Amazon Ads Sponsored Products campaign reports, Meesho
          Order Summary reports, and the Meesho aggregated payment file.
        </p>
        {reading && (
          <p className="mt-3 text-sm text-[var(--ink-2)]">
            Reading {reading.done} of {reading.total}…
          </p>
        )}
      </div>

      {queue.length > 0 && (
        <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)]">
          <div className="flex flex-wrap items-center gap-3 border-b border-[var(--line)] px-4 py-3">
            <h2 className="text-sm font-semibold text-[var(--ink)]">
              {queue.length} file{queue.length === 1 ? '' : 's'} ready to import
            </h2>
            {needsMonthCount > 0 && (
              <span className="rounded-full bg-[color-mix(in_oklab,var(--warning)_15%,transparent)] px-2.5 py-0.5 text-xs text-[var(--ink-2)]">
                {needsMonthCount} need a month set
              </span>
            )}
            <button
              type="button"
              onClick={importAll}
              disabled={readyCount === 0 || busy}
              className="ml-auto rounded-md bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-[var(--accent-ink)] hover:opacity-90 disabled:opacity-40"
            >
              {stage === 'importing'
                ? importProgress && importProgress.total > 0
                  ? `Importing ${importProgress.sent.toLocaleString()} of ${importProgress.total.toLocaleString()}…`
                  : 'Importing…'
                : `Import ${readyCount} file${readyCount === 1 ? '' : 's'}`}
            </button>
            {queue.some((i) => i.status === 'done') && (
              <button type="button" onClick={clearFinished} disabled={busy} className="text-xs text-[var(--ink-3)] hover:text-[var(--ink-2)] disabled:opacity-40">
                Clear finished
              </button>
            )}
            <button type="button" onClick={() => setQueue([])} disabled={busy} className="text-xs text-[var(--ink-3)] hover:text-[var(--ink-2)] disabled:opacity-40">
              Clear all
            </button>
          </div>

          <ul className="divide-y divide-[var(--line)]">
            {queue.map((item) => (
              <QueueRow
                key={item.id}
                item={item}
                busy={busy}
                onSetMonth={(m: string) => void setItemMonth(item, m)}
                onResolveMonth={() => void resolveMonth(item)}
                onRemove={() => removeItem(item.id)}
              />
            ))}
          </ul>
        </section>
      )}

      {stage === 'error' && error && (
        <div className="rounded-lg border border-[color-mix(in_oklab,var(--critical)_35%,transparent)] bg-[color-mix(in_oklab,var(--critical)_10%,transparent)] p-4 text-sm text-[var(--critical-ink)]">{error}</div>
      )}

      <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
        <h2 className="text-sm font-semibold text-[var(--ink-2)]">Start Meesho over</h2>
        <p className="mt-1 text-xs text-[var(--ink-3)]">
          Uploading a Meesho payment file adds to what is stored, because a month arrives across several files. That
          leaves no way back if what is stored is wrong — figures from an earlier upload stay whatever you upload next.
          This removes every Meesho event so the channel is rebuilt from the files alone. Nothing else is touched.
        </p>
        <p className="mt-2 text-xs text-[var(--ink-3)]">
          Currently holding {meeshoMonths} Meesho month(s) on the order-date basis.
        </p>
        <button
          type="button"
          onClick={resetMeesho}
          disabled={resetting}
          className="mt-3 rounded-md border border-[color-mix(in_oklab,var(--critical)_45%,transparent)] px-3 py-1.5 text-xs font-medium text-[var(--critical-ink)] hover:bg-[color-mix(in_oklab,var(--critical)_10%,transparent)] disabled:opacity-50"
        >
          {resetting ? 'Removing…' : 'Remove all Meesho data'}
        </button>
        {resetResult && <p className="mt-2 text-xs text-[var(--ink-2)]">{resetResult}</p>}
      </section>

      {outcome && stage === 'idle' && (
        <div className="mb-6 rounded-lg border border-[color-mix(in_oklab,var(--good)_45%,transparent)] bg-[color-mix(in_oklab,var(--good)_10%,transparent)] p-4">
          <h3 className="text-sm font-semibold text-[var(--good-ink)]">✓ Imported {outcome.fileName}</h3>
          <ul className="mt-2 space-y-0.5 text-sm text-[var(--good-ink)]">
            {outcome.mapping ? (
              <>
                <li>{outcome.mapping.mappingsSaved.toLocaleString()} SKU mapping(s) saved.</li>
                <li>{outcome.mapping.recipesSaved.toLocaleString()} combo recipe(s) saved.</li>
                {outcome.mapping.costChanges.length > 0 && (
                  <li>
                    <span>{outcome.mapping.costChanges.length} product cost(s) changed:</span>
                    <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                      {outcome.mapping.costChanges.slice(0, 8).map((c) => (
                        <span key={c.sku} className="whitespace-nowrap">
                          <span className="font-mono">{c.sku}</span>{' '}
                          {c.from === null ? 'added at' : `${c.from} →`} {c.to}
                        </span>
                      ))}
                      {outcome.mapping.costChanges.length > 8 && (
                        <span>+{outcome.mapping.costChanges.length - 8} more</span>
                      )}
                    </span>
                  </li>
                )}
                {outcome.mapping.warnings.slice(0, 4).map((w) => (
                  <li key={w} className="text-[var(--ink-2)]">⚠ {w}</li>
                ))}
                <li className="pt-1 font-medium">
                  Check the results under Products → SKU Mapping.
                </li>
              </>
            ) : (
              <li>{outcome.added.toLocaleString()} new record(s) added to the shared data.</li>
            )}
            {!outcome.mapping && outcome.skippedAsDuplicate > 0 && (
              <li>
                {outcome.skippedAsDuplicate.toLocaleString()} row(s) were already imported and were skipped, so nothing
                is double-counted.
              </li>
            )}
            {!outcome.mapping && outcome.monthsUpdated.length > 0 && (
              <li>P&amp;L updated for {outcome.monthsUpdated.map(monthLabel).join(', ')}.</li>
            )}
            {!outcome.mapping && outcome.added === 0 && outcome.skippedAsDuplicate > 0 && (
              <li className="font-medium">This file had already been imported — nothing changed.</li>
            )}
          </ul>
          <button
            type="button"
            onClick={() => setOutcome(null)}
            className="mt-3 text-xs font-medium text-[var(--good-ink)] hover:text-[var(--good-ink)]"
          >
            Dismiss
          </button>
        </div>
      )}

    </PageShell>
  )
}

/**
 * One file in the queue: what it was recognised as, what it will do, and — once
 * it has run — what it did. Each file keeps its own result, so a batch of
 * twelve does not collapse into one line saying "done".
 */
function QueueRow({
  item, busy, onSetMonth, onResolveMonth, onRemove,
}: {
  item: QueueItem
  busy: boolean
  onSetMonth: (month: string) => void
  onResolveMonth: () => void
  onRemove: () => void
}) {
  const p = item.preview
  const validCount = p ? p.validRecords.length + p.adsRecords.length : 0
  // A file that was not recognised has no report type to name, and guessing
  // one would be worse than saying nothing — the row already carries the
  // reason it was rejected.
  const label = item.skuMap
    ? 'SKU Map & Cost workbook'
    : p
      ? `${REPORT_LABELS[p.reportKind]}${p.adsRecords.length === 0 ? ` — ${CHANNEL_MAP[REPORT_CHANNEL[p.reportKind]].label}` : ''}`
      : item.status === 'needs-month'
        ? 'Flipkart SKU-level P&L'
        : 'Not recognised'
  const months = [
    ...(p?.amazonUsaFacts ? [p.amazonUsaFacts.month] : []),
    ...(p?.flipkartFacts ? [p.flipkartFacts.month] : []),
    ...(p?.meeshoFactsByMonth ?? []).filter((f) => f.basis === 'order').map((f) => f.month),
  ]

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-start gap-3">
        <StatusDot status={item.status} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-[var(--ink)]">{item.fileName}</div>
          <div className="mt-0.5 text-xs text-[var(--ink-3)]">
            {label}
            {months.length > 0 && ` · ${[...new Set(months)].sort().map(monthLabel).join(', ')}`}
            {p && ` · ${validCount.toLocaleString()} of ${p.totalRows.toLocaleString()} rows`}
          </div>

          {item.status === 'needs-month' && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-xs text-[var(--ink-2)]">
                This report is a monthly total per SKU with no date of its own. Which month?
              </span>
              <input
                type="month"
                value={item.month ?? ''}
                onChange={(e) => onSetMonth(e.target.value)}
                className="rounded-md border border-[var(--line-2)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
              />
              <button
                type="button"
                onClick={onResolveMonth}
                disabled={busy || !item.month}
                className="rounded-md bg-[var(--accent)] px-2.5 py-1 text-xs font-medium text-[var(--accent-ink)] hover:opacity-90 disabled:opacity-40"
              >
                Set
              </button>
            </div>
          )}

          {p && p.isLikelyReupload && item.status === 'ready' && (
            <p className="mt-1 text-xs text-[var(--ink-2)]">
              ⚠ Looks already imported — 90% or more of its rows match rows on file.
            </p>
          )}
          {p && p.duplicateCount > 0 && item.status === 'ready' && (
            <p className="mt-1 text-xs text-[var(--ink-3)]">
              {p.duplicateCount.toLocaleString()} row(s) already on file will be skipped.
            </p>
          )}
          {p && p.invalidCount > 0 && (
            <p className="mt-1 text-xs text-[var(--ink-3)]">
              {p.invalidCount.toLocaleString()} row(s) failed validation and will be skipped.
            </p>
          )}
          {p?.warnings.slice(0, 3).map((w, i) => (
            <p key={i} className="mt-1 text-xs text-[var(--ink-2)]">⚠ {w}</p>
          ))}
          {p && p.warnings.length > 3 && (
            <p className="mt-1 text-xs text-[var(--ink-3)]">+{p.warnings.length - 3} more warning(s)</p>
          )}

          {item.error && (
            <p className="mt-1 text-xs text-[var(--critical-ink)]">{item.error}</p>
          )}
          {item.status === 'done' && item.outcome && (
            <p className="mt-1 text-xs text-[var(--good-ink)]">
              {item.outcome.mapping
                ? `${item.outcome.mapping.mappingsSaved.toLocaleString()} mapping(s), ${item.outcome.mapping.recipesSaved.toLocaleString()} recipe(s) saved.`
                : `${item.outcome.added.toLocaleString()} record(s) added` +
                  (item.outcome.skippedAsDuplicate > 0 ? `, ${item.outcome.skippedAsDuplicate.toLocaleString()} already on file` : '') +
                  (item.outcome.monthsUpdated.length > 0 ? ` · P&L updated for ${item.outcome.monthsUpdated.map(monthLabel).join(', ')}` : '')}
            </p>
          )}
        </div>

        {item.status !== 'importing' && (
          <button
            type="button"
            onClick={onRemove}
            disabled={busy}
            title="Remove from the list"
            aria-label={`Remove ${item.fileName}`}
            className="rounded p-1 text-[var(--ink-3)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)] disabled:opacity-40"
          >
            ×
          </button>
        )}
      </div>
    </li>
  )
}

function StatusDot({ status }: { status: ItemStatus }) {
  const map: Record<ItemStatus, { cls: string; label: string }> = {
    ready: { cls: 'bg-[var(--accent)]', label: 'Ready' },
    'needs-month': { cls: 'bg-[var(--warning)]', label: 'Needs a month' },
    error: { cls: 'bg-[var(--critical)]', label: 'Not recognised' },
    importing: { cls: 'bg-[var(--accent)] animate-pulse', label: 'Importing' },
    done: { cls: 'bg-[var(--good)]', label: 'Imported' },
    failed: { cls: 'bg-[var(--critical)]', label: 'Failed' },
  }
  const { cls, label } = map[status]
  return (
    <span className="mt-1 flex items-center gap-1.5" title={label}>
      <span className={`inline-block h-2 w-2 rounded-full ${cls}`} aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  )
}
