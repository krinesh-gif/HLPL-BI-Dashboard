import type { CanonicalSalesRecord, MyntraPnlFacts, SkuMaster } from '@/data/models'
import type { SkuMapping } from '@/data/skuMapping'
import type { RawSheet } from '@/lib/csvParse'
import { hasSheets, sheetNamed } from '@/lib/csvParse'
import { normalizeCategory } from '@/data/categories'
import type { NormalizeResult } from './types'

/**
 * Myntra's Profit & Loss report workbook (Payments ▸ P&L Report).
 *
 * Three sheets. `PnL_Summary` is the month's statement as a label/amount/units
 * list; `SKU_Detail` is the same month broken down per SKU, one row each, with
 * every fee column; `Glossary` documents the columns and is not read.
 *
 * The two sheets are read for two different purposes and neither is derived
 * from the other. The summary is the statement — its own subtotals are kept
 * rather than recomputed, so the dashboard shows what Myntra shows. The detail
 * sheet produces the per-SKU sales rows the product and category screens run
 * on. They are checked against each other at import: they come from one file
 * and describe one month, so a gap between them means the file was not read
 * correctly, and that is worth saying before anyone trusts the figures.
 *
 * The two sheets also disagree about signs, which is the trap here. The
 * summary prints expenses negative; the detail sheet prints the same expenses
 * as positive magnitudes, except `ReverseExpense`, which is signed in both.
 * Everything below is normalized to positive magnitudes, and the statement
 * does the subtracting.
 */

const SUMMARY_SHEET = 'PnL_Summary'
const DETAIL_SHEET = 'SKU_Detail'

/**
 * How the summary sheet labels each line, and the other names Myntra has used
 * for it.
 *
 * A list rather than a string because Myntra changed the sheet partway
 * through the year, and the earlier months still have to be readable.
 *
 * The later shape, which this reader was built on, nests the fees under their
 * own Forward and Reverse headings and names the reverse ones "Commission
 * Recovery", "TCS Recovery" and so on. The earlier shape — April 2026's file
 * — lists the same fees flat under Total Expenses, spells out "Forward
 * Additional Charges" and "Reverse Additional Charges", has no "Estimated Net
 * Sales After Expenses" line at all, and titles Total Expenses "(Net
 * Commission)" rather than "(Forward − Reverse)".
 *
 * So a line is identified by its own name and nothing else. The reader used
 * to decide forward-or-reverse from the heading it had last passed, which is
 * what made the earlier months unreadable: the Reverse heading latched on and
 * every line after it — each fee, the GST, the rewards, the bank settlement,
 * the earnings — was filed as a reverse figure and read back as zero. The
 * fees were in the file the whole time.
 *
 * It works because both layouts name their reverse lines explicitly, and the
 * forward lines are the plain ones. Matched after collapsing the bullets and
 * indentation Myntra marks its hierarchy with.
 */
const SUMMARY_LABELS = {
  grossSales: ['gross sales'],
  returnsAndCancellations: ['returns and cancellations'],
  estimatedNetSales: ['estimated net sales'],
  /** The qualifier in brackets is Myntra's note on how it arrived at the
   * figure, not part of the name, and it has changed. Canonicalised on the
   * prefix in `readSummary`. */
  totalExpenses: ['total expenses'],
  forwardExpense: ['forward expense'],
  fwdCommissionFee: ['commission fee'],
  fwdTaxesTcs: ['taxes (tcs)'],
  fwdTaxesTds: ['taxes (tds)'],
  fwdLogisticCharge: ['logistic charge'],
  fwdAdditionalCharges: ['additional charges', 'forward additional charges'],
  reverseExpense: ['reverse expense'],
  revCommissionRecovery: ['commission recovery'],
  revTcsRecovery: ['tcs recovery'],
  revTdsRecovery: ['tds recovery'],
  revLogisticCharge: ['reverse logistic charge'],
  revAdditionalRecovery: ['additional recovery', 'reverse additional charges'],
  estimatedNetSalesAfterExpenses: ['estimated net sales after expenses'],
  productGst: ['product gst'],
  nodPaid: ['nod paid'],
  nodDeducted: ['nod deducted'],
  rewardsAndBenefits: ['rewards & other benefits'],
  sjitIncentive: ['sjit incentive'],
  commissionDiscount: ['commission discount'],
  orderSpf: ['order spf'],
  bankSettlementProjected: ['bank settlement (projected)'],
  bankSettlementSettled: ['bank settlement (settled)'],
  bankSettlementUnsettled: ['bank settlement (unsettled)'],
  inputTaxCredits: ['input tax credits'],
  inputTaxCreditsGstTcs: ['gst + tcs'],
  inputTaxCreditsTds: ['tds'],
  earningsOnPlatform: ['earnings on platform'],
  netMarginPct: ['net margin (% of net sales)'],
}

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
]

export interface MyntraWorkbookResult extends NormalizeResult {
  facts: MyntraPnlFacts | null
  month: string
  /** Each cross-check between the statement and the per-SKU sheet, with the
   * gap it found. A failure is surfaced to the person uploading. */
  checks: { name: string; passed: boolean; detail: string }[]
}

/**
 * Myntra's own indentation, stripped: the summary sheet marks its hierarchy
 * with bullets and leading spaces, and the label is what is left.
 */
function labelKey(raw: unknown): string {
  return String(raw ?? '')
    .replace(/[•◦]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/:$/, '')
}

function num(raw: unknown): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0
  const text = String(raw ?? '').trim()
  if (text === '' || text === '-' || text === '—') return 0
  const negative = /^\(.*\)$/.test(text) || text.startsWith('-')
  const digits = text.replace(/[()]/g, '').replace(/^-/, '').replace(/[^0-9.]/g, '')
  if (digits === '' || digits === '.') return 0
  const value = Number(digits)
  if (!Number.isFinite(value)) return 0
  return negative ? -value : value
}

/** "July 2026" → "2026-07". Myntra writes the month in words, so there is no
 * day-first/month-first ambiguity to get wrong here. */
export function parseMyntraMonth(raw: unknown): string {
  const text = String(raw ?? '').trim().toLowerCase()
  const m = /^([a-z]+)\s+(\d{4})$/.exec(text)
  if (!m) return ''
  const index = MONTHS.indexOf(m[1])
  if (index < 0) return ''
  return `${m[2]}-${String(index + 1).padStart(2, '0')}`
}

export function detectMyntraPnlWorkbook(sheetNames: string[]): boolean {
  // Matched on what the names mean rather than on the exact string: the same
  // export has arrived as `PnL_Summary` and as `PnL Summary`, and rejecting a
  // month's whole P&L over a space is how "not recognised" keeps happening.
  return hasSheets(sheetNames, SUMMARY_SHEET, DETAIL_SHEET)
}

/**
 * The summary sheet as a label → {amount, units} lookup.
 *
 * Flat, keyed by the line's own name. The first occurrence of a label wins
 * and a later one carrying a different figure is reported rather than
 * overwriting it: April lists "SJIT Incentive" twice, inside the expenses and
 * again under Rewards, with the same number both times, and a month where
 * those two part company is a month this reader has misunderstood.
 */
function readSummary(sheet: RawSheet): {
  values: Map<string, number>
  units: Map<string, number>
  header: Map<string, string>
  /** Labels that appeared twice with different figures. */
  conflicting: string[]
} {
  const values = new Map<string, number>()
  const units = new Map<string, number>()
  const header = new Map<string, string>()
  const conflicting: string[] = []

  for (const row of sheet) {
    const key = labelKey(row[0])
    if (key === '') continue
    // The rules of dashes Myntra separates its sections with.
    if (/^-{3,}$/.test(key)) continue

    // "Report Type:", "Orders Received During:", "Seller ID:" — the report's
    // own header, where the month and the seller come from.
    if (String(row[0] ?? '').trim().endsWith(':')) {
      header.set(key, String(row[1] ?? '').trim())
      continue
    }

    // "Total Expenses (Forward − Reverse)" in one month's file and "(Net
    // Commission)" in another's are the same line, and the bracket is
    // Myntra's working rather than its name.
    const canonical = key.startsWith('total expenses') ? 'total expenses' : key

    const existing = values.get(canonical)
    const amount = num(row[1])
    if (existing === undefined) {
      values.set(canonical, amount)
      units.set(canonical, num(row[2]))
    } else if (Math.abs(existing - amount) > 0.01) {
      conflicting.push(canonical)
    }
  }

  return { values, units, header, conflicting }
}

/**
 * Turns the workbook into one month's statement plus its per-SKU sales rows.
 *
 * COGS is deliberately left at zero here. Myntra does not know what the goods
 * cost us, and pricing them at import would freeze the month at whatever the
 * cost sheet said on upload day; the statement is priced when it is read, by
 * the same effective-dated cost engine every other channel uses.
 */
export function normalizeMyntraPnlWorkbook(
  sheets: Record<string, RawSheet>,
  skuMaster: SkuMaster[],
  mappings: SkuMapping[],
  importId: string,
): MyntraWorkbookResult {
  const validRecords: CanonicalSalesRecord[] = []
  const invalidRows: NormalizeResult['invalidRows'] = []
  const warnings: string[] = []
  const checks: MyntraWorkbookResult['checks'] = []

  const summarySheet = sheetNamed(sheets, SUMMARY_SHEET) ?? []
  const detailSheet = sheetNamed(sheets, DETAIL_SHEET) ?? []
  const { values, units, header, conflicting } = readSummary(summarySheet)

  if (conflicting.length > 0) {
    warnings.push(
      `${conflicting.join(', ')} appears more than once on the PnL_Summary sheet with a different figure each ` +
      'time. The first was used. Myntra lists some lines twice — the same number in two places — so two ' +
      'different numbers means this reader has misread the sheet; send the file over.',
    )
  }

  const month = parseMyntraMonth(header.get('orders received during'))
  const sellerId = header.get('seller id') || undefined

  if (!month) {
    return {
      validRecords, totalRows: 0, invalidRows,
      warnings: ['The report month could not be read from "Orders Received During:" on the PnL_Summary sheet. Nothing was imported.'],
      facts: null, month: '', checks,
    }
  }

  /** The first of a line's known names that the file actually used. */
  const v = (labels: string[]): number => {
    for (const label of labels) {
      const found = values.get(label)
      if (found !== undefined) return found
    }
    return 0
  }
  const unitsOf = (labels: string[]): number => {
    for (const label of labels) {
      const found = units.get(label)
      if (found !== undefined) return found
    }
    return 0
  }
  // Every figure is stored as a positive magnitude; the statement subtracts.
  // `reverseExpense` is the exception — Myntra reports it as a signed net,
  // because its recoveries are credits and its logistics is a charge.
  const facts: MyntraPnlFacts = {
    month,
    sellerId,
    grossSales: v(SUMMARY_LABELS.grossSales),
    grossSalesUnits: unitsOf(SUMMARY_LABELS.grossSales),
    returnsAndCancellations: Math.abs(v(SUMMARY_LABELS.returnsAndCancellations)),
    returnsAndCancellationsUnits: Math.abs(unitsOf(SUMMARY_LABELS.returnsAndCancellations)),
    estimatedNetSales: v(SUMMARY_LABELS.estimatedNetSales),
    estimatedNetSalesUnits: unitsOf(SUMMARY_LABELS.estimatedNetSales),

    fwdCommissionFee: Math.abs(v(SUMMARY_LABELS.fwdCommissionFee)),
    fwdTaxesTcs: Math.abs(v(SUMMARY_LABELS.fwdTaxesTcs)),
    fwdTaxesTds: Math.abs(v(SUMMARY_LABELS.fwdTaxesTds)),
    fwdLogisticCharge: Math.abs(v(SUMMARY_LABELS.fwdLogisticCharge)),
    fwdAdditionalCharges: Math.abs(v(SUMMARY_LABELS.fwdAdditionalCharges)),
    forwardExpense: Math.abs(v(SUMMARY_LABELS.forwardExpense)),

    revCommissionRecovery: v(SUMMARY_LABELS.revCommissionRecovery),
    revTcsRecovery: v(SUMMARY_LABELS.revTcsRecovery),
    revTdsRecovery: v(SUMMARY_LABELS.revTdsRecovery),
    revLogisticCharge: Math.abs(v(SUMMARY_LABELS.revLogisticCharge)),
    revAdditionalRecovery: v(SUMMARY_LABELS.revAdditionalRecovery),
    reverseExpense: v(SUMMARY_LABELS.reverseExpense),

    totalExpenses: Math.abs(v(SUMMARY_LABELS.totalExpenses)),
    // The earlier sheet has no such line. It is net sales less expenses — an
    // identity the later sheet states to the paisa — so it is derived rather
    // than shown as nil on the statement, and the upload says it was.
    estimatedNetSalesAfterExpenses:
      values.has(SUMMARY_LABELS.estimatedNetSalesAfterExpenses[0])
        ? v(SUMMARY_LABELS.estimatedNetSalesAfterExpenses)
        : v(SUMMARY_LABELS.estimatedNetSales) - Math.abs(v(SUMMARY_LABELS.totalExpenses)),
    productGst: Math.abs(v(SUMMARY_LABELS.productGst)),

    nodPaid: v(SUMMARY_LABELS.nodPaid),
    nodDeducted: Math.abs(v(SUMMARY_LABELS.nodDeducted)),
    sjitIncentive: v(SUMMARY_LABELS.sjitIncentive),
    commissionDiscount: v(SUMMARY_LABELS.commissionDiscount),
    rewardsAndBenefits: v(SUMMARY_LABELS.rewardsAndBenefits),
    orderSpf: v(SUMMARY_LABELS.orderSpf),

    bankSettlementProjected: v(SUMMARY_LABELS.bankSettlementProjected),
    bankSettlementSettled: v(SUMMARY_LABELS.bankSettlementSettled),
    bankSettlementUnsettled: v(SUMMARY_LABELS.bankSettlementUnsettled),
    inputTaxCredits: v(SUMMARY_LABELS.inputTaxCredits),
    inputTaxCreditsGstTcs: v(SUMMARY_LABELS.inputTaxCreditsGstTcs),
    inputTaxCreditsTds: v(SUMMARY_LABELS.inputTaxCreditsTds),
    earningsOnPlatform: v(SUMMARY_LABELS.earningsOnPlatform),
    netMarginPct: v(SUMMARY_LABELS.netMarginPct),

    cogsPriced: 0,
    cogsUnpriced: 0,
    myntraAds: 0,
  }

  // ---------------------------------------------------------------------
  // SKU_Detail → one aggregated sales row per SKU for the month.
  // ---------------------------------------------------------------------
  const headerRow = (detailSheet[0] ?? []).map((c) => String(c ?? '').trim())
  const col = (name: string): number => headerRow.indexOf(name)
  const columns = {
    sku: col('sku_code'),
    styleId: col('style_id'),
    skuId: col('sku_id'),
    brand: col('brand_name'),
    gross: col('GrossSalesAmount'),
    grossUnits: col('GrossSalesUnit'),
    returns: col('ReturnsandCancellationsAmount'),
    returnUnits: col('ReturnsandCancellationsUnit'),
    net: col('EstimatedNetSalesAmount'),
    netUnits: col('EstimatedNetSalesUnit'),
    expenses: col('TotalExpensesAmount'),
    gst: col('GST_Amount'),
    settlement: col('BankSettlement_Projected'),
  }

  const internalBySku = new Map(mappings.map((m) => [m.channelSku, m.internalSku]))
  const master = new Map(skuMaster.map((s) => [s.sku, s]))
  const orderDate = `${month}-01`
  let unmappedSkus = 0

  const detailRows = detailSheet.slice(1).filter((r) => String(r[columns.sku] ?? '').trim() !== '')
  const cell = (row: (string | number)[], index: number): number => (index < 0 ? 0 : num(row[index]))

  for (const row of detailRows) {
    const sku = String(row[columns.sku] ?? '').trim()
    const grossSales = cell(row, columns.gross)
    const returns = cell(row, columns.returns)
    const netSales = cell(row, columns.net)
    const netUnits = cell(row, columns.netUnits)
    const returnUnits = cell(row, columns.returnUnits)

    if (grossSales === 0 && netSales === 0 && netUnits === 0 && returnUnits === 0) continue

    const internalSku = internalBySku.get(sku) ?? sku
    const product = master.get(internalSku) ?? master.get(sku)
    if (!product) unmappedSkus++

    validRecords.push({
      // One row per SKU per month, so the month is part of the identity: a
      // corrected file restates the month instead of adding a second copy.
      orderId: `myntra-${sku}-${month}`,
      orderDate,
      channel: 'myntra',
      marketplace: 'myntra',
      sellerType: 'marketplace',
      sku,
      productName: product?.productName ?? sku,
      category: normalizeCategory(product?.category),
      // Net units, so the dashboard's unit count is units that stayed sold.
      // The returned units are carried separately and deducted once.
      quantity: netUnits,
      grossSales,
      discount: 0,
      netSales,
      returnUnits,
      rtoUnits: 0,
      shippingCost: 0,
      marketplaceFee: cell(row, columns.expenses),
      tax: cell(row, columns.gst),
      status: 'completed',
      currency: 'INR',
      isAggregate: true,
      raw: {
        sku_code: sku,
        style_id: String(row[columns.styleId] ?? ''),
        sku_id: String(row[columns.skuId] ?? ''),
        brand_name: String(row[columns.brand] ?? ''),
        GrossSalesAmount: grossSales,
        GrossSalesUnit: cell(row, columns.grossUnits),
        ReturnsandCancellationsAmount: returns,
        ReturnsandCancellationsUnit: returnUnits,
        EstimatedNetSalesAmount: netSales,
        EstimatedNetSalesUnit: netUnits,
        TotalExpensesAmount: cell(row, columns.expenses),
        GST_Amount: cell(row, columns.gst),
        BankSettlement_Projected: cell(row, columns.settlement),
      },
      importId,
    })
  }

  // ---------------------------------------------------------------------
  // The two sheets describe one month. Where they disagree, say so.
  // ---------------------------------------------------------------------
  const check = (name: string, sheetValue: number, detailValue: number, tolerance: number): void => {
    const gap = detailValue - sheetValue
    checks.push({
      name,
      passed: Math.abs(gap) <= tolerance,
      detail: `statement ${sheetValue.toFixed(2)} vs SKU sheet ${detailValue.toFixed(2)} (gap ${gap.toFixed(2)})`,
    })
  }
  const sum = (index: number): number => detailRows.reduce((s, r) => s + cell(r, index), 0)

  check('Gross Sales', facts.grossSales, sum(columns.gross), 1)
  check('Estimated Net Sales', facts.estimatedNetSales, sum(columns.net), 1)
  check('Net units', facts.estimatedNetSalesUnits, sum(columns.netUnits), 0.5)
  check('Product GST', facts.productGst, sum(columns.gst), 1)
  check('Total Expenses', facts.totalExpenses, sum(columns.expenses), 1)

  // What Myntra says it will pay, reconciled against what it says it charged.
  // The incentive is the moving part: the later sheet adds the SJIT on top of
  // net sales after expenses, while the earlier one has it already inside the
  // forward expense, so the settlement is net sales less expenses and nothing
  // more.
  // Either is a sound statement; neither holding means this reader has
  // misread the sheet, which is the whole point of the check.
  const afterExpenses = facts.estimatedNetSales - facts.totalExpenses
  const candidates = [
    { how: 'net sales less expenses, plus the SJIT incentive', value: afterExpenses + facts.sjitIncentive },
    { how: 'net sales less expenses, the incentive already inside them', value: afterExpenses },
  ]
  const held = candidates.find((c) => Math.abs(c.value - facts.bankSettlementProjected) <= 1)
  checks.push({
    name: 'Bank Settlement (Projected) reconciles to the statement',
    passed: held !== undefined,
    detail: held
      ? `${facts.bankSettlementProjected.toFixed(2)} — ${held.how}`
      : `the statement says ${facts.bankSettlementProjected.toFixed(2)}; net sales less expenses is ` +
        `${afterExpenses.toFixed(2)}, and with the SJIT incentive ${(afterExpenses + facts.sjitIncentive).toFixed(2)}. ` +
        'Neither matches, so a charge on this sheet is not being read as one.',
  })

  if (!values.has(SUMMARY_LABELS.estimatedNetSalesAfterExpenses[0])) {
    warnings.push(
      'This month\'s file does not state "Estimated Net Sales After Expenses" — the sheet gained that line later ' +
      'in the year — so the statement shows net sales less total expenses in its place, which is the same figure ' +
      'the later sheet states outright. Every charge above it is read from the file.',
    )
  }

  const emptySkuRows = detailRows.length - validRecords.length
  if (emptySkuRows > 0) {
    warnings.push(`${emptySkuRows} SKU row(s) had no sales, no returns and no charges this month and were skipped.`)
  }
  if (detailRows.length === 0) {
    warnings.push(`The ${DETAIL_SHEET} sheet had no SKU rows, so the statement was imported without any product-level sales.`)
  }
  if (unmappedSkus > 0) {
    warnings.push(
      `${unmappedSkus} Myntra SKU code(s) are not in the Product Master, so they carry no cost and no category. ` +
      'Link them on the SKU Mapping screen to get COGS and contribution for Myntra.',
    )
  }

  return { validRecords, totalRows: detailRows.length, invalidRows, warnings, facts, month, checks }
}
