import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PageShell } from '@/components/layout/PageShell'
import { parseSpreadsheetFile, readCsvRaw, readTsvRecords, readWorkbookSheetsRaw, type ParsedFile, type RawSheet } from '@/lib/csvParse'
import { detectAmazonSellerCentralReport, normalizeAmazonSellerCentralRows } from '@/data/normalize/amazonSellerCentral'
import { detectFlipkartSkuPnlReport, normalizeFlipkartSkuPnl } from '@/data/normalize/flipkartSkuPnl'
import { detectFlipkartWorkbook, normalizeFlipkartWorkbook } from '@/data/normalize/flipkartWorkbook'
import { detectAmazonUsaProductProfitabilityReport, normalizeAmazonUsaProductProfitability } from '@/data/normalize/amazonUsaProductProfitability'
import { detectMeeshoOrderSummaryReport, normalizeMeeshoOrderSummary } from '@/data/normalize/meeshoOrderSummary'
import { detectMeeshoOrderPaymentsSheet, normalizeMeeshoOrderPayments } from '@/data/normalize/meeshoOrderPayments'
import { detectSkuMapWorkbook, normalizeSkuMapWorkbook } from '@/data/normalize/skuMapWorkbook'
import { detectAmazonAdsSponsoredProductsReport, normalizeAmazonAdsSponsoredProductsReport } from '@/data/normalize/amazonAdsSponsoredProducts'
import { detectAmazonVendorCentralSalesReport, normalizeAmazonVendorCentralSales } from '@/data/normalize/amazonVendorCentralSales'
import { detectMyntraPnlWorkbook, normalizeMyntraPnlWorkbook } from '@/data/normalize/myntraPnlWorkbook'
import {
  detectNykaaCartRuleSheet, detectNykaaComboSheet, detectNykaaSalesSheet, normalizeNykaaWorkbook,
} from '@/data/normalize/nykaaSalesWorkbook'
import { detectNykaaMarketingInvoice, parseNykaaMarketingInvoice } from '@/data/normalize/nykaaMarketingInvoice'
import { detectNykaaDiscountDebitNote, parseNykaaDiscountDebitNote } from '@/data/normalize/nykaaDiscountDebitNote'
import { detectAmazonSettlementReport, normalizeAmazonSettlement } from '@/data/normalize/amazonSellerSettlement'
import { readPdfText } from '@/lib/pdfText'
import { checkForDuplicates } from '@/data/normalize/duplicates'
import { useDataStore, type ImportOutcome } from '@/store/dataStore'
import { monthLabel } from '@/lib/format'
import { useFilterStore } from '@/store/filterStore'
import { CHANNEL_MAP, type ChannelId } from '@/config/channels'
import type { AdsRecord, AmazonInSellerPnlFacts, AmazonUsaPnlFacts, CanonicalSalesRecord, FlipkartPnlFacts, ImportRecord, ManualAdSpend, MeeshoPnlFacts, MyntraPnlFacts, NykaaPnlFacts } from '@/data/models'
import type { MeeshoTransaction } from '@/data/meesho/transaction'
import type { MeeshoAdsRow, MeeshoRecoveryRow } from '@/data/normalize/meeshoOrderPayments'

type ReportKind =
  | 'amazon_seller_central'
  | 'amazon_vendor_central_sales'
  | 'flipkart_sku_pnl'
  | 'flipkart_workbook'
  | 'amazon_usa_product_profitability'
  | 'myntra_pnl_workbook'
  | 'nykaa_sales'
  | 'nykaa_companion'
  | 'nykaa_marketing_invoice'
  | 'nykaa_discount_debit_note'
  | 'amazon_in_settlement'
  | 'meesho_order_summary'
  | 'meesho_order_payments'
  | 'meesho_settlement_json'
  | 'amazon_ads_sponsored_products'

const REPORT_LABELS: Record<ReportKind, string> = {
  amazon_seller_central: 'Amazon India — Seller Central Order Report',
  amazon_vendor_central_sales: 'Amazon India — Vendor Central Sales by ASIN (Monthly)',
  flipkart_sku_pnl: 'Flipkart — SKU-Level P&L Report',
  flipkart_workbook: 'Flipkart — Full P&L Workbook (Overall Summary + Orders P&L)',
  amazon_usa_product_profitability: 'Amazon USA — Product Profitability Report',
  myntra_pnl_workbook: 'Myntra — P&L Report (PnL_Summary + SKU_Detail)',
  nykaa_sales: 'Nykaa — Monthly Sales Data (B2B, margin on MRP)',
  nykaa_companion: 'Nykaa — Cart Rule / Combo file',
  nykaa_marketing_invoice: 'Nykaa — Marketing Invest (MI) tax invoice',
  nykaa_discount_debit_note: 'Nykaa — discount Financial Debit Note',
  amazon_in_settlement: 'Amazon India — Seller Central settlement report',
  meesho_order_summary: 'Meesho — Order Summary Report',
  meesho_order_payments: 'Meesho — Aggregated Payment File (Order Payments + Ads Cost)',
  meesho_settlement_json: 'Meesho — Settlement Data (JSON)',
  amazon_ads_sponsored_products: 'Amazon Ads — Sponsored Products Campaign Report',
}
const REPORT_CHANNEL: Record<ReportKind, ChannelId> = {
  amazon_seller_central: 'amazon_in_seller',
  amazon_vendor_central_sales: 'amazon_in_vendor',
  flipkart_sku_pnl: 'flipkart',
  flipkart_workbook: 'flipkart',
  amazon_usa_product_profitability: 'amazon_us',
  myntra_pnl_workbook: 'myntra',
  nykaa_sales: 'nykaa',
  nykaa_companion: 'nykaa',
  nykaa_marketing_invoice: 'nykaa',
  nykaa_discount_debit_note: 'nykaa',
  amazon_in_settlement: 'amazon_in_seller',
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
  myntraFacts?: MyntraPnlFacts
  nykaaFacts?: NykaaPnlFacts
  amazonInSellerFacts?: AmazonInSellerPnlFacts[]
  /** A debit note edits one month's stored facts rather than importing rows. */
  nykaaDebitNote?: { month: string; patch: Partial<NykaaPnlFacts> }
  /** A month's ad spend that arrived as an invoice rather than a report. */
  manualAdSpend?: Omit<ManualAdSpend, 'enteredAt'>
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

interface NykaaCompanions { cartRule?: RawSheet; combo?: RawSheet }

/**
 * The Cart Rule and Combo sheets from the same batch of files, if they are
 * there. Read before anything is analysed so the Sales file can be normalized
 * with them in one pass, whichever order the three were picked in.
 */
async function findNykaaCompanions(files: File[]): Promise<NykaaCompanions> {
  const found: NykaaCompanions = {}
  for (const file of files) {
    const name = file.name.toLowerCase()
    if (!name.endsWith('.xlsx') && !name.endsWith('.xls')) continue
    try {
      const sheets = await readWorkbookSheetsRaw(file)
      const first = sheets[Object.keys(sheets)[0]] ?? []
      if (!found.cartRule && detectNykaaCartRuleSheet(first)) found.cartRule = first
      else if (!found.combo && detectNykaaComboSheet(first)) found.combo = first
    } catch {
      // A file that cannot be read here is reported properly when it is
      // analysed; this pass only looks for companions.
    }
  }
  return found
}

export function UploadReportsPage() {
  const {
    skuMaster, mappings, importReport, importProgress, importSkuMapWorkbook, saveManualAdSpend,
    patchNykaaFacts, nykaaFacts, imports,
  } = useDataStore()
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null)
  const { month: filterMonth } = useFilterStore()
  const [stage, setStage] = useState<Stage>('idle')
  const [error, setError] = useState<string | null>(null)
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [dragging, setDragging] = useState(false)
  const [reading, setReading] = useState<{ done: number; total: number } | null>(null)


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

  /**
   * What the note charges, next to what the month's own files say it should.
   *
   * The whole reason to read the note is this comparison. The discount is
   * deducted from the sales file, which states it per row and arrives on time;
   * the note turns up months later and is Nykaa's version of the same figure.
   * Where they disagree, someone has to ask Nykaa, and that only happens if
   * the difference is put in front of them at upload.
   */
  function describeDebitNote(amount: number, month: string): string {
    const inr = (v: number): string => `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
    const facts = nykaaFacts.find((f) => f.month === month)
    if (!facts) {
      return (
        `This note charges ${inr(amount)} against ${month}, but no Nykaa sales file for ${month} is on file, so ` +
        'there is nothing to check it against and nothing to record it on. Upload that month\'s Sales file first.'
      )
    }
    const expected = facts.customerDiscount ?? 0
    const gap = amount - expected
    if (Math.abs(gap) <= Math.max(expected * 0.01, 1)) {
      return `This note charges ${inr(amount)} against ${month}, which matches the ${inr(expected)} of discount in that month's sales file.`
    }
    return (
      `This note charges ${inr(amount)} against ${month}, but that month's sales file accounts for ${inr(expected)} ` +
      `— a difference of ${inr(Math.abs(gap))} ${gap > 0 ? 'more than' : 'less than'} expected. The P&L still deducts ` +
      'the figure from the sales file; take the difference up with Nykaa.'
    )
  }

  /** Reads one file and works out what it is. Returns the result rather than
   * setting state, so a failure on one file leaves the others alone. */
  async function analyzeFile(file: File, nykaa?: NykaaCompanions): Promise<QueueItem> {
    const id = uniqueId(file.name)
    const fail = (reason: string): QueueItem => ({ id, fileName: file.name, status: 'error', error: reason })
    try {
      const lowerName = file.name.toLowerCase()
      if (lowerName.endsWith('.pdf')) {
        // Two of Nykaa's charges only ever arrive as emailed PDFs — the
        // Marketing Invest bill and the debit note that charges the customer
        // discount back — so both are read here rather than retyped.
        const text = await readPdfText(file)
        if (detectNykaaDiscountDebitNote(text)) {
          const r = parseNykaaDiscountDebitNote(text)
          if (!r.note) return fail(r.warnings[0] ?? 'This Nykaa debit note could not be read.')
          const failed = r.checks.filter((c) => !c.passed).map((c) => `${c.name}: ${c.detail}`)
          return { id, fileName: file.name, status: 'ready', preview: await buildPreview({
            fileName: file.name, reportKind: 'nykaa_discount_debit_note', totalRows: 1,
            validRecords: [], invalidCount: 0,
            warnings: [...failed, ...r.warnings, describeDebitNote(r.note.amount, r.note.activityMonth)],
            nykaaDebitNote: {
              month: r.note.activityMonth,
              patch: {
                discountDebitNote: {
                  // The whole charge, because the note carries no GST: there
                  // is no taxable-value-versus-total split to get wrong here,
                  // unlike the MI invoice.
                  amount: r.note.amount,
                  documentNumber: r.note.documentNumber,
                  documentDate: r.note.documentDate,
                },
              },
            },
          }) }
        }
        if (!detectNykaaMarketingInvoice(text)) {
          return fail(
            'This PDF is not a Nykaa Marketing Invest invoice or discount debit note. No other PDF is read yet.',
          )
        }
        const r = parseNykaaMarketingInvoice(text)
        if (!r.invoice) return fail(r.warnings[0] ?? 'This Nykaa MI invoice could not be read.')
        const failed = r.checks.filter((c) => !c.passed).map((c) => `${c.name}: ${c.detail}`)
        return { id, fileName: file.name, status: 'ready', preview: await buildPreview({
          fileName: file.name, reportKind: 'nykaa_marketing_invoice', totalRows: 1,
          validRecords: [], invalidCount: 0, warnings: [...failed, ...r.warnings],
          manualAdSpend: {
            channel: 'nykaa',
            month: r.invoice.activityMonth,
            // The taxable value, never the total: the GST on top is input tax
            // credit and charging it to the P&L would overstate the month's
            // advertising by 18%.
            amount: r.invoice.taxableValue,
            fileName: file.name,
            note:
              `Invoice ${r.invoice.invoiceNumber} dated ${r.invoice.invoiceDate} · ` +
              `taxable ₹${r.invoice.taxableValue.toFixed(2)} + GST ₹${(r.invoice.cgst + r.invoice.sgst + r.invoice.igst).toFixed(2)} ` +
              `= ₹${r.invoice.totalAmount.toFixed(2)} paid`,
          },
        }) }
      }
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
        // Nykaa sends three single-sheet workbooks: Sales, Cart Rule and
        // Combo. Only Sales drives the P&L; the other two are read for their
        // memo figures and are recognised here so they are not reported as
        // unknown files.
        const firstSheet = sheets[sheetNames[0]] ?? []
        if (detectNykaaSalesSheet(firstSheet)) {
          const r = normalizeNykaaWorkbook(firstSheet, nykaa?.cartRule, nykaa?.combo, skuMaster, mappings, importId)
          const failed = r.checks.filter((c) => !c.passed).map((c) => `${c.name}: ${c.detail}`)
          return { id, fileName: file.name, status: 'ready', preview: await buildPreview({
            fileName: file.name, reportKind: 'nykaa_sales', totalRows: r.totalRows,
            validRecords: r.validRecords, invalidCount: r.invalidRows.length,
            warnings: [...failed, ...r.warnings], nykaaFacts: r.facts ?? undefined,
          }) }
        }
        if (detectNykaaCartRuleSheet(firstSheet) || detectNykaaComboSheet(firstSheet)) {
          const what = detectNykaaCartRuleSheet(firstSheet) ? 'Cart Rule' : 'Combo'
          return { id, fileName: file.name, status: 'ready', preview: await buildPreview({
            fileName: file.name, reportKind: 'nykaa_companion', totalRows: Math.max(firstSheet.length - 1, 0),
            validRecords: [], invalidCount: 0,
            warnings: [
              `Read as Nykaa's ${what} file. It carries no revenue of its own — its figures are folded into the ` +
              'Nykaa Sales file uploaded alongside it, as memo lines. Importing it on its own does nothing.',
            ],
          }) }
        }
        if (detectMyntraPnlWorkbook(sheetNames)) {
          const r = normalizeMyntraPnlWorkbook(sheets, skuMaster, mappings, importId)
          // The statement and the per-SKU sheet describe one month. A gap
          // between them goes in front of the person uploading, before the
          // figures are relied on.
          const failed = r.checks.filter((c) => !c.passed).map((c) => `${c.name}: ${c.detail}`)
          return { id, fileName: file.name, status: 'ready', preview: await buildPreview({
            fileName: file.name, reportKind: 'myntra_pnl_workbook', totalRows: r.totalRows,
            validRecords: r.validRecords, invalidCount: r.invalidRows.length,
            warnings: [...failed, ...r.warnings], myntraFacts: r.facts ?? undefined,
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

      // Amazon India's settlement report is the only tab-separated .txt any
      // marketplace sends, and it is the only file that carries this
      // channel's fees at all.
      if (lowerName.endsWith('.txt') || lowerName.endsWith('.tsv')) {
        const { headers, rows } = await readTsvRecords(file)
        if (!detectAmazonSettlementReport(headers)) {
          return fail(
            'This text file is not an Amazon India settlement report. Download it from Seller Central under ' +
            'Payments ▸ Reports Repository, as the flat file (V2).',
          )
        }
        const r = normalizeAmazonSettlement(rows)
        const failed = r.checks.filter((c) => !c.passed).map((c) => `${c.name}: ${c.detail}`)
        if (r.factsByMonth.length === 0) {
          return fail('This settlement report has no dated amounts in it, so there is no month to import it as.')
        }
        return { id, fileName: file.name, status: 'ready', preview: await buildPreview({
          fileName: file.name, reportKind: 'amazon_in_settlement', totalRows: r.totalRows,
          validRecords: [], invalidCount: 0, warnings: [...failed, ...r.warnings],
          amazonInSellerFacts: r.factsByMonth,
        }) }
      }

      if (lowerName.endsWith('.csv')) {
        // Read flat first: Amazon's Vendor Central export puts a line of
        // report settings above the column names, so parsed with the first
        // line as the header it is neither recognisable nor readable.
        const sheet = await readCsvRaw(file)
        if (detectAmazonVendorCentralSalesReport(sheet)) {
          const r = normalizeAmazonVendorCentralSales(sheet, skuMaster, mappings, importId)
          return { id, fileName: file.name, status: 'ready', preview: await buildPreview({
            fileName: file.name, reportKind: 'amazon_vendor_central_sales', totalRows: r.totalRows,
            validRecords: r.validRecords, invalidCount: r.invalidRows.length, warnings: r.warnings,
          }) }
        }
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
    // Nykaa's month arrives as three separate workbooks. The Sales file is the
    // only one that carries revenue, but the other two carry figures that
    // belong on its statement, so the batch is scanned for them first and they
    // are handed to whichever file turns out to be the Sales one.
    const nykaa = await findNykaaCompanions(files)
    // One at a time: each file runs a duplicate check against the shared
    // database, and firing a dozen of those at once helps nobody.
    for (const file of files) {
      added.push(await analyzeFile(file, nykaa))
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

      // The debit note does not import anything. It records what Nykaa charged
      // against a month whose discount the sales file already accounts for, so
      // the statement can show the two side by side.
      if (preview.nykaaDebitNote) {
        await patchNykaaFacts(preview.nykaaDebitNote.month, preview.nykaaDebitNote.patch)
        const outcome: ImportOutcome = {
          fileName: preview.fileName, added: 0, skippedAsDuplicate: 0,
          monthsUpdated: [preview.nykaaDebitNote.month],
        }
        setOutcome(outcome)
        updateItem(item.id, { status: 'done', outcome })
        return
      }

      // An invoice is not a report: it carries one figure for one channel-month
      // and is stored where the Ads screens and the channel P&L both read it.
      if (preview.manualAdSpend) {
        await saveManualAdSpend(preview.manualAdSpend)
        const outcome: ImportOutcome = {
          fileName: preview.fileName, added: 1, skippedAsDuplicate: 0,
          monthsUpdated: [preview.manualAdSpend.month],
        }
        setOutcome(outcome)
        updateItem(item.id, { status: 'done', outcome })
        return
      }

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
        myntraFacts: preview.myntraFacts,
        nykaaFacts: preview.nykaaFacts,
        amazonInSellerFacts: preview.amazonInSellerFacts,
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
  const queued = queue.length > 0
  // Importing used to end at a green box, and whether the figures had actually
  // moved was a different entry in a different part of the sidebar. The last
  // few uploads sit under the panel that made them, with the one link that
  // leads to taking one back out.
  const recent = [...imports].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)).slice(0, 5)

  return (
    <PageShell
      title="Data Upload"
      subtitle="Marketplace reports go in here. Every file is read and reported on before a figure moves."
      showFilters={false}
    >
      {/*
        Two acts, one object.
        //
        // This was a dashed box with a cloud icon and a centred blue button —
        // which is what every upload control on earth looks like, and was the
        // reason nobody could find it: it read as decoration rather than as the
        // thing to use. What is actually distinctive here is not that the page
        // accepts a file, it is that it recognises the file and says so before
        // anything is written. So the panel is a sequence — pick, then read —
        // numbered, because the second act genuinely cannot come first.
      */}
      <section
        onDragOver={(e) => { e.preventDefault(); if (!busy) setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          const files = Array.from(e.dataTransfer.files ?? [])
          if (files.length > 0 && !busy) void addFiles(files)
        }}
        className={`overflow-hidden rounded-[var(--radius-card)] border transition-colors ${
          dragging
            ? 'border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_6%,var(--surface))]'
            : 'border-[var(--line)] bg-[var(--surface)]'
        }`}
      >
        {/* Act one is the label, so a click lands anywhere in this block rather
            than only on the button. */}
        <label className={`block ${busy ? 'pointer-events-none opacity-60' : 'cursor-pointer'}`}>
          <input
            type="file"
            multiple
            // Every extension analyzeFile knows how to read. A reader added
            // without its extension here is unreachable: the picker greys the
            // file out and the person cannot select it at all, which is exactly
            // what happened to Amazon India's settlement .txt.
            accept=".csv,.tsv,.txt,.xlsx,.xls,.json,.pdf"
            disabled={busy}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? [])
              if (files.length > 0) void addFiles(files)
              e.target.value = ''
            }}
            className="peer sr-only"
          />
          <span
            className="flex flex-wrap items-start gap-x-4 gap-y-3 px-5 py-5 peer-focus-visible:outline-2 peer-focus-visible:-outline-offset-2 peer-focus-visible:outline-[var(--accent)]"
          >
            <StepMark n={1} active />
            {/* A wrap basis, not just flex-1: without it a narrow screen
                squeezes this column to one word per line rather than dropping
                the button onto its own row. */}
            <span className="min-w-0 flex-1 basis-72">
              <span className="block text-[15px] font-semibold text-[var(--ink)]">Pick the files</span>
              <span className="mt-1 block max-w-[62ch] text-sm text-[var(--ink-2)]">
                {dragging
                  ? 'Let go and they will be read.'
                  : 'Drop them anywhere on this panel, or use the button. As many as you like — a whole year in one go, each read on its own.'}
              </span>
            </span>
            {/* Filled while it is the only thing to do; an outline once there
                are files, so Import is the one bold control on screen. */}
            <span
              className={`shrink-0 self-center rounded-[var(--radius-control)] px-4 py-2 text-sm font-semibold ${
                queued
                  ? 'border border-[var(--line-2)] text-[var(--ink-2)]'
                  : 'bg-[var(--accent)] text-[var(--accent-ink)]'
              }`}
            >
              {queued ? 'Add more' : 'Choose files'}
            </span>
          </span>
        </label>

        <div className="border-t border-[var(--line)]">
          <div className="flex flex-wrap items-start gap-x-4 gap-y-3 px-5 py-4">
            <StepMark n={2} active={queued || reading !== null} />
            <div className="min-w-0 flex-1 basis-72">
              <h2 className="text-[15px] font-semibold text-[var(--ink)]">
                {reading
                  ? `Reading ${reading.done} of ${reading.total}…`
                  : queued
                    ? `${queue.length} file${queue.length === 1 ? '' : 's'} read`
                    : 'Check what was read'}
              </h2>
              <p className="mt-1 max-w-[62ch] text-sm text-[var(--ink-2)]">
                {!queued
                  ? 'Each file is matched against the report formats this dashboard knows and listed here with what it was recognised as, which month it belongs to and what it will change. Nothing is written until you import.'
                  : needsMonthCount > 0
                    ? `${needsMonthCount} of these carry no date of their own. Set the month on each before importing.`
                    : readyCount > 0
                      ? 'Read each line before importing. A file that quietly failed to be recognised looks much like one that worked.'
                      : 'Nothing here is ready to import.'}
              </p>
            </div>
            {queued && (
              <div className="flex shrink-0 items-center gap-3 self-center">
                <button
                  type="button"
                  onClick={importAll}
                  disabled={readyCount === 0 || busy}
                  className="rounded-[var(--radius-control)] bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent-ink)] hover:opacity-90 disabled:opacity-40"
                >
                  {stage === 'importing'
                    ? importProgress && importProgress.total > 0
                      ? `Importing ${importProgress.sent.toLocaleString()} of ${importProgress.total.toLocaleString()}…`
                      : 'Importing…'
                    : `Import ${readyCount} file${readyCount === 1 ? '' : 's'}`}
                </button>
                <button
                  type="button"
                  onClick={() => queue.some((i) => i.status === 'done') ? clearFinished() : setQueue([])}
                  disabled={busy}
                  className="text-xs font-medium text-[var(--ink-3)] hover:text-[var(--ink)] disabled:opacity-40"
                >
                  {queue.some((i) => i.status === 'done') ? 'Clear the finished' : 'Clear the list'}
                </button>
              </div>
            )}
          </div>

          {queued && (
            <ul>
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
          )}
        </div>

        <details className="border-t border-[var(--line)] px-5 py-3">
          <summary className="cursor-pointer text-xs font-medium text-[var(--ink-3)] hover:text-[var(--ink-2)]">
            Which reports can I upload?
          </summary>
          <ul className="mt-3 grid gap-x-10 gap-y-2 text-xs leading-relaxed text-[var(--ink-2)] sm:grid-cols-2">
            <li><strong className="text-[var(--ink)]">Amazon India</strong> — Seller Central order reports, the
              settlement report (the tab-separated .txt), and the Vendor Central monthly sales export.</li>
            <li><strong className="text-[var(--ink)]">Amazon USA</strong> — the Product Profitability export.</li>
            <li><strong className="text-[var(--ink)]">Amazon Ads</strong> — Sponsored Products campaign reports.</li>
            <li><strong className="text-[var(--ink)]">Flipkart</strong> — SKU-level P&amp;L exports, or the full
              P&amp;L workbook.</li>
            <li><strong className="text-[var(--ink)]">Meesho</strong> — Order Summary reports and the aggregated
              payment file.</li>
            <li><strong className="text-[var(--ink)]">Myntra</strong> — the P&amp;L report.</li>
            <li className="sm:col-span-2"><strong className="text-[var(--ink)]">Nykaa</strong> — the three monthly
              files (Sales, Cart Rule, Combo — drop all three in together), plus the two emailed PDFs: the Marketing
              Invest invoice and the Financial Debit Note.</li>
          </ul>
        </details>
      </section>

      {stage === 'error' && error && (
        <div className="rounded-[var(--radius-card)] border border-[color-mix(in_oklab,var(--critical)_35%,transparent)] bg-[color-mix(in_oklab,var(--critical)_10%,transparent)] p-4 text-sm text-[var(--critical-ink)]">{error}</div>
      )}

      {/*
        The SKU map is the one import whose result does not fit on its own row:
        it changes product costs, and which cost changed is the reason to look.
        Every other file now reports on its own line in the queue, so the
        blanket green success box that used to sit here said nothing twice.
      */}
      {outcome?.mapping && stage === 'idle' && (
        <div className="rounded-[var(--radius-card)] border border-[color-mix(in_oklab,var(--good)_45%,transparent)] bg-[color-mix(in_oklab,var(--good)_8%,transparent)] p-4">
          <h3 className="text-sm font-semibold text-[var(--ink)]">
            Imported <span className="font-mono text-[13px]">{outcome.fileName}</span>
          </h3>
          <ul className="mt-2 space-y-1 text-sm text-[var(--ink-2)]">
            <li>{outcome.mapping.mappingsSaved.toLocaleString()} SKU mapping(s) and {outcome.mapping.recipesSaved.toLocaleString()} combo recipe(s) saved.</li>
            {outcome.mapping.costChanges.length > 0 && (
              <li>
                <span className="text-[var(--ink)]">{outcome.mapping.costChanges.length} product cost(s) changed:</span>
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
              <li key={w} className="border-l-2 border-[color-mix(in_oklab,var(--warning)_55%,transparent)] pl-2 text-xs">{w}</li>
            ))}
          </ul>
          <div className="mt-3 flex items-center gap-4">
            <Link to="/products/sku-mapping" className="text-xs font-semibold text-[var(--accent)] hover:underline">
              Check the results under Catalogue → SKU Mapping
            </Link>
            <button
              type="button"
              onClick={() => setOutcome(null)}
              className="text-xs font-medium text-[var(--ink-3)] hover:text-[var(--ink)]"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {recent.length > 0 && (
        <section className="rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)]">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--line)] px-5 py-3">
            <h2 className="text-sm font-semibold text-[var(--ink)]">Last uploaded</h2>
            <Link to="/data/import-history" className="text-xs font-medium text-[var(--accent)] hover:underline">
              Every upload, and how to take one back out
            </Link>
          </div>
          <ul className="divide-y divide-[var(--line)]">
            {recent.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-5 py-2.5">
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-[var(--ink)]" title={r.fileName}>
                  {r.fileName}
                </span>
                <span className="w-28 shrink-0 text-right text-xs text-[var(--ink-3)]">{CHANNEL_MAP[r.channel]?.label ?? r.channel}</span>
                <span className="w-16 shrink-0 text-right text-xs text-[var(--ink-3)]">
                  {new Date(r.uploadedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

    </PageShell>
  )
}

/** The act number. A ring rather than a filled disc, so the one filled thing on
 * the panel stays the button you are meant to press. */
function StepMark({ n, active }: { n: number; active: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${
        active
          ? 'border-[var(--accent)] text-[var(--accent)]'
          : 'border-[var(--line-2)] text-[var(--ink-3)]'
      }`}
    >
      {n}
    </span>
  )
}

/**
 * How a row reads at a glance.
 *
 * Status used to be an 8px dot whose meaning was in a `title` and an sr-only
 * span — so on a batch of twelve you had to hover each one to find the file
 * that had not been recognised, and a sighted keyboard user had no way at all.
 * It is now a coloured spine down the row's left edge *and* the status in
 * words, and colour is never the only carrier.
 */
const STATUS_TONE: Record<ItemStatus, { label: string; spine: string; ink: string }> = {
  ready: { label: 'Ready', spine: 'bg-[var(--accent)]', ink: 'text-[var(--accent)]' },
  'needs-month': { label: 'Needs a month', spine: 'bg-[var(--warning)]', ink: 'text-[var(--ink-2)]' },
  error: { label: 'Not recognised', spine: 'bg-[var(--critical)]', ink: 'text-[var(--critical-ink)]' },
  importing: { label: 'Importing…', spine: 'bg-[var(--accent)] animate-pulse', ink: 'text-[var(--accent)]' },
  done: { label: 'Imported', spine: 'bg-[var(--good)]', ink: 'text-[var(--good-ink)]' },
  failed: { label: 'Failed', spine: 'bg-[var(--critical)]', ink: 'text-[var(--critical-ink)]' },
}

/**
 * What the file was recognised as, said once.
 *
 * Nearly every report label already opens with the marketplace's name, so
 * appending the channel produced "Amazon USA — Product Profitability Report —
 * Amazon USA". The channel is only added where the label does not already
 * carry it.
 */
function describeReport(p: PreviewState): string {
  const label = REPORT_LABELS[p.reportKind]
  if (p.adsRecords.length > 0) return label
  const channel = CHANNEL_MAP[REPORT_CHANNEL[p.reportKind]].label
  return label.toLowerCase().startsWith(channel.toLowerCase()) ? label : `${label} — ${channel}`
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
  // one would be worse than saying nothing — the status beside the file name
  // says it was not recognised and the row carries the reason, so there is no
  // third line to write.
  const label = item.skuMap
    ? 'SKU Map & Cost workbook'
    : p
      ? describeReport(p)
      : item.status === 'needs-month'
        ? 'Flipkart SKU-level P&L'
        : null
  const months = [
    ...(p?.amazonUsaFacts ? [p.amazonUsaFacts.month] : []),
    ...(p?.flipkartFacts ? [p.flipkartFacts.month] : []),
    ...(p?.meeshoFactsByMonth ?? []).filter((f) => f.basis === 'order').map((f) => f.month),
  ]

  const tone = STATUS_TONE[item.status]

  return (
    <li className="relative border-t border-[var(--line)] py-3 pl-5 pr-4">
      <span className={`absolute left-0 top-0 h-full w-[3px] ${tone.spine}`} aria-hidden />
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            {/* Mono, because these are machine names: a trailing _2025-08 is
                scannable in a column of them and a 1 is not an l. */}
            <span className="min-w-0 truncate font-mono text-[13px] font-medium text-[var(--ink)]" title={item.fileName}>
              {item.fileName}
            </span>
            <span className={`shrink-0 text-[11px] font-semibold ${tone.ink}`}>{tone.label}</span>
          </div>
          {label && <div className="mt-0.5 text-xs text-[var(--ink-2)]">{label}</div>}
          {(months.length > 0 || p) && (
            <div className="mt-0.5 text-xs text-[var(--ink-3)]">
              {[
                months.length > 0 ? [...new Set(months)].sort().map(monthLabel).join(', ') : null,
                p ? `${validCount.toLocaleString()} of ${p.totalRows.toLocaleString()} rows` : null,
              ].filter(Boolean).join(' · ')}
            </div>
          )}

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

          {/* Counts that only qualify the import stay on one quiet line; the
              things that need reading get the rule down their left edge. */}
          {p && item.status === 'ready' && (p.duplicateCount > 0 || p.invalidCount > 0) && (
            <div className="mt-0.5 text-xs text-[var(--ink-3)]">
              {[
                p.duplicateCount > 0 ? `${p.duplicateCount.toLocaleString()} row(s) already on file, skipped` : null,
                p.invalidCount > 0 ? `${p.invalidCount.toLocaleString()} row(s) failed validation, skipped` : null,
              ].filter(Boolean).join(' · ')}
            </div>
          )}

          {p && p.isLikelyReupload && item.status === 'ready' && (
            <p className="mt-1.5 border-l-2 border-[color-mix(in_oklab,var(--warning)_55%,transparent)] pl-2 text-xs text-[var(--ink-2)]">
              Looks already imported — 90% or more of its rows match rows on file.
            </p>
          )}
          {p?.warnings.slice(0, 3).map((w, i) => (
            <p key={i} className="mt-1.5 border-l-2 border-[color-mix(in_oklab,var(--warning)_55%,transparent)] pl-2 text-xs text-[var(--ink-2)]">
              {w}
            </p>
          ))}
          {p && p.warnings.length > 3 && (
            <p className="mt-1 text-xs text-[var(--ink-3)]">+{p.warnings.length - 3} more warning(s)</p>
          )}

          {item.error && (
            <p className="mt-1.5 border-l-2 border-[var(--critical)] pl-2 text-xs text-[var(--ink-2)]">{item.error}</p>
          )}
          {item.status === 'done' && item.outcome && (
            <p className="mt-1.5 border-l-2 border-[var(--good)] pl-2 text-xs text-[var(--ink-2)]">
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
            className="-mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-base leading-none text-[var(--ink-3)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)] disabled:opacity-40"
          >
            ×
          </button>
        )}
      </div>
    </li>
  )
}
