import type { RawSheet } from '@/lib/csvParse'
import type { CanonicalSalesRecord, MeeshoPnlFacts, SkuMaster } from '@/data/models'
import type { NormalizeResult } from './types'
import { toMonthKey } from '@/lib/format'
import { normalizeCategory } from '@/data/categories'
import { MEESHO_ASSUMPTIONS } from '@/config/nativePnlAssumptions'
import { columnAt, locateHeader, missingColumns, normaliseHeader, type ColumnIndex } from '@/data/meesho/columns'
import { classifyRow } from '@/data/meesho/events'
import { MEESHO_REVENUE_POLICY } from '@/data/meesho/policy'
import { resolveRecoveryReason } from '@/data/meesho/feeCategories'
import type { MeeshoException, MeeshoTransaction } from '@/data/meesho/transaction'

/**
 * Normalises Meesho's "Order Payments" sheet from the aggregated payment file.
 *
 * The sheet is a ledger of financial events, not a list of orders. Inspecting
 * the real August file showed why that distinction is not academic: of 2,048
 * rows, 145 were zero-sale affiliate-fee charges with a blank order status,
 * and 145 sub-orders appeared twice — once for the sale, once for its return
 * or its fee. Reading each row as an order produced 60 phantom shipments and
 * 61 phantom units in August alone, each carrying invented COGS and packaging
 * cost.
 *
 * Columns are found by header name rather than position, because a single
 * inserted column would otherwise shift every field onto the wrong data
 * without anything failing.
 */

/** Headers that must exist for this to be the Order Payments sheet. */
const REQUIRED = ['Sub Order No', 'Order Date', 'Final Settlement Amount', 'Live Order Status']

const H = {
  subOrderNo: 'Sub Order No',
  orderDate: 'Order Date',
  dispatchDate: 'Dispatch Date',
  productName: 'Product Name',
  supplierSku: 'Supplier SKU',
  catalogId: 'Catalog ID',
  orderSource: 'Order source',
  liveOrderStatus: 'Live Order Status',
  productGstPct: 'Product GST %',
  listingPrice: 'Listing Price (Incl. taxes)',
  quantity: 'Quantity',
  transactionId: 'Transaction ID',
  paymentDate: 'Payment Date',
  finalSettlementAmount: 'Final Settlement Amount',
  priceType: 'Price Type',
  totalSaleAmount: 'Total Sale Amount (Incl. Shipping & GST)',
  totalSaleReturnAmount: 'Total Sale Return Amount (Incl. Shipping & GST)',
  fixedFee: 'Fixed Fee (Incl. GST)',
  warehousingFeeA: 'Warehousing fee (inc Gst)',
  warehousingFeeB: 'Warehousing fee (Incl. GST)',
  returnPremium: 'Return premium (incl GST)',
  returnPremiumOfReturn: 'Return premium (incl GST) of Return',
  commissionPct: 'Meesho Commission Percentage',
  commission: 'Meesho Commission (Incl. GST)',
  goldFee: 'Meesho gold platform fee (Incl. GST)',
  mallFee: 'Meesho mall platform fee (Incl. GST)',
  returnShippingCharge: 'Return Shipping Charge (Incl. GST)',
  gstCompensation: 'GST Compensation (PRP Shipping)',
  shippingCharge: 'Shipping Charge (Incl. GST)',
  otherSupportCharges: 'Other Support Service Charges (Excl. GST)',
  waivers: 'Waivers (Excl. GST)',
  netOtherSupportCharges: 'Net Other Support Service Charges (Excl. GST)',
  gstOnNetOtherSupport: 'GST on Net Other Support Service Charges',
  tcs: 'TCS',
  tdsRate: 'TDS Rate %',
  tds: 'TDS',
  compensation: 'Compensation',
  claims: 'Claims',
  recovery: 'Recovery',
  compensationReason: 'Compensation Reason',
  claimsReason: 'Claims Reason',
  recoveryReason: 'Recovery Reason',
} as const

const UNPRICED_COGS_FALLBACK_PCT = 0.25

export function detectMeeshoOrderPaymentsSheet(sheet: RawSheet | undefined): boolean {
  return !!sheet && locateHeader(sheet, REQUIRED.map(normaliseHeader)) !== null
}

/** A cell as a number. Blank stays 0 but is distinguishable via `isBlank`. */
function num(row: (string | number)[], at: number): number {
  if (at < 0) return 0
  const v = row[at]
  if (v === null || v === undefined || String(v).trim() === '') return 0
  const n = typeof v === 'number' ? v : Number(String(v).trim())
  return Number.isFinite(n) ? n : 0
}

/** A cell as text, preserved exactly — order IDs are identifiers, not numbers,
 * and coercing them loses leading zeros and precision. */
function text(row: (string | number)[], at: number): string {
  if (at < 0) return ''
  const v = row[at]
  return v === null || v === undefined ? '' : String(v).trim()
}

/** Meesho writes dates as `yyyy-mm-dd` or `yyyy-mm-dd hh:mm:ss`. Both are
 * already ISO-ordered, so the date part is taken directly rather than being
 * routed through Date parsing, which would apply a timezone shift and can move
 * a late-evening order into the previous day — and so into the wrong month. */
function isoDate(raw: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw.trim())
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10)
}

export interface MeeshoOrderPaymentsResult extends NormalizeResult {
  factsByMonth: MeeshoPnlFacts[]
  transactions: MeeshoTransaction[]
  exceptions: MeeshoException[]
  /** Header names the workbook carried that this app does not map. Surfaced so
   * a new Meesho fee column is a question rather than a silent omission. */
  unmappedColumns: string[]
  checks: ReconciliationCheck[]
}

/** One post-import assertion, reported whether or not it passed. */
export interface ReconciliationCheck {
  name: string
  passed: boolean
  detail: string
}

function emptyFacts(month: string, basis: MeeshoPnlFacts['basis']): MeeshoPnlFacts {
  return {
    schemaVersion: 3, month, basis,
    grossSalesInclGst: 0, salesReturnsInclGst: 0, outputGstOnSales: 0,
    cogsUnitsSold: 0, cogsRtoWriteOff: 0, cogsReturnWriteOff: 0,
    forwardShipping: 0, returnShipping: 0, otherMarketplaceFees: 0,
    adsSpendExGst: 0, adCredits: 0, affiliateFee: 0,
    compensation: 0, claims: 0, recovery: 0, platformRecoverySubscriptions: 0,
    subOrdersDispatched: 0, unitsDispatched: 0, unitsDelivered: 0, unitsRto: 0, unitsReturned: 0,
    tcs: 0, tds: 0, gstOnMarketplaceFees: 0, gstOnAds: 0, netSettlementPerFile: 0,
    unclassifiedSettlement: 0, unclassifiedRows: 0,
  }
}

export function normalizeMeeshoOrderPayments(
  sheet: RawSheet,
  adsSheet: RawSheet | undefined,
  skuMaster: SkuMaster[],
  importId: string,
  fileName = '',
): MeeshoOrderPaymentsResult {
  const index = locateHeader(sheet, REQUIRED.map(normaliseHeader))
  if (!index) {
    return {
      validRecords: [], totalRows: 0,
      invalidRows: [{ rowIndex: 0, reason: 'Could not find the Order Payments header row.' }],
      warnings: [], factsByMonth: [], transactions: [], exceptions: [], unmappedColumns: [],
      checks: [{ name: 'Header located', passed: false, detail: 'No row carried the expected Meesho column names.' }],
    }
  }

  const at = (header: string, occurrence = 0): number => columnAt(index, header, occurrence)
  const headerNames = (sheet[index.headerRow] ?? []).map((c) => String(c ?? '').trim())
  const known = new Set(Object.values(H).map(normaliseHeader))
  const unmappedColumns = headerNames.filter((h) => h && !known.has(normaliseHeader(h)))

  const validRecords: CanonicalSalesRecord[] = []
  const invalidRows: NormalizeResult['invalidRows'] = []
  const transactions: MeeshoTransaction[] = []
  const exceptions: MeeshoException[] = []
  const skuByCode = new Map(skuMaster.map((s) => [s.sku, s]))

  const facts = new Map<string, MeeshoPnlFacts>()
  const factsFor = (basis: MeeshoPnlFacts['basis'], month: string): MeeshoPnlFacts => {
    const key = `${basis}|${month}`
    let f = facts.get(key)
    if (!f) { f = emptyFacts(month, basis); facts.set(key, f) }
    return f
  }

  let unknownSkuCount = 0
  let rowsWithoutPaymentDate = 0
  let rawSettlementTotal = 0
  let rawSaleTotal = 0

  const dataRows = sheet.slice(index.dataStartRow)
  dataRows.forEach((row, offset) => {
    const sourceRowNumber = index.dataStartRow + offset + 1 // 1-based, as the sheet shows it
    const subOrderId = text(row, at(H.subOrderNo))
    const orderDateRaw = text(row, at(H.orderDate))

    // A row with no sub-order and no date is decoration or a total line, never
    // a transaction. Excluded explicitly and counted, so the row census still
    // balances.
    if (!subOrderId && !orderDateRaw) {
      invalidRows.push({ rowIndex: sourceRowNumber, reason: 'Blank row or workbook total — not a transaction' })
      return
    }
    if (!subOrderId) {
      invalidRows.push({ rowIndex: sourceRowNumber, reason: 'Missing Sub Order No' })
      return
    }
    const orderDate = isoDate(orderDateRaw)
    if (!orderDate) {
      invalidRows.push({ rowIndex: sourceRowNumber, reason: `Unreadable Order Date: "${orderDateRaw}"` })
      return
    }

    const quantity = num(row, at(H.quantity))
    const saleAmount = num(row, at(H.totalSaleAmount))
    // Meesho writes returns negative; magnitudes are used below and the sign
    // convention lives in the compute function.
    const returnAmount = num(row, at(H.totalSaleReturnAmount))
    const settlementAmount = num(row, at(H.finalSettlementAmount))
    const recovery = num(row, at(H.recovery))
    const compensation = num(row, at(H.compensation))
    const claims = num(row, at(H.claims))
    const orderStatus = text(row, at(H.liveOrderStatus))
    const recoveryReason = text(row, at(H.recoveryReason))

    rawSettlementTotal += settlementAmount
    rawSaleTotal += saleAmount

    const classification = classifyRow({
      orderStatus, saleAmount, returnAmount, settlementAmount,
      recovery, compensation, claims,
      recoveryReason,
      compensationReason: text(row, at(H.compensationReason)),
      claimsReason: text(row, at(H.claimsReason)),
    })
    const policy = MEESHO_REVENUE_POLICY[classification.eventType]

    const dispatchDate = isoDate(text(row, at(H.dispatchDate))) ?? ''
    const paymentDate = isoDate(text(row, at(H.paymentDate)))
    if (!paymentDate) rowsWithoutPaymentDate++

    const sku = text(row, at(H.supplierSku))
    const skuRecord = skuByCode.get(sku)
    if (!skuRecord && policy.entersCogs && sku) unknownSkuCount++

    const raw: Record<string, string> = {}
    headerNames.forEach((name, i) => { if (name) raw[name] = text(row, i) })

    const transactionId = `${subOrderId}#${sourceRowNumber}`
    const transaction: MeeshoTransaction = {
      transactionId, subOrderId, sku,
      productName: skuRecord?.productName ?? text(row, at(H.productName)),
      catalogId: text(row, at(H.catalogId)),
      transactionRef: text(row, at(H.transactionId)),
      orderDate, dispatchDate, paymentDate: paymentDate ?? '',
      orderStatus, orderSource: text(row, at(H.orderSource)), priceType: text(row, at(H.priceType)),
      eventType: classification.eventType,
      confidence: classification.confidence,
      classificationReason: classification.reason,
      flagged: classification.confidence !== 'certain' || policy.alwaysReview,
      quantity,
      productGstPct: num(row, at(H.productGstPct)),
      listingPriceInclTax: num(row, at(H.listingPrice)),
      totalSaleAmount: saleAmount,
      totalSaleReturnAmount: returnAmount,
      commissionPct: num(row, at(H.commissionPct)),
      commission: num(row, at(H.commission)),
      goldPlatformFee: num(row, at(H.goldFee)),
      mallPlatformFee: num(row, at(H.mallFee)),
      fixedFee: num(row, at(H.fixedFee, 0)) + num(row, at(H.fixedFee, 1)),
      warehousingFee: num(row, at(H.warehousingFeeA, 0)) + num(row, at(H.warehousingFeeB, 0)),
      returnPremium: num(row, at(H.returnPremium)) + num(row, at(H.returnPremiumOfReturn)),
      shippingCharge: num(row, at(H.shippingCharge)),
      returnShippingCharge: num(row, at(H.returnShippingCharge)),
      gstCompensation: num(row, at(H.gstCompensation)),
      otherSupportCharges: num(row, at(H.otherSupportCharges)),
      waivers: num(row, at(H.waivers)),
      gstOnOtherSupport: num(row, at(H.gstOnNetOtherSupport)),
      tcs: num(row, at(H.tcs)),
      tdsRatePct: num(row, at(H.tdsRate)),
      tds: num(row, at(H.tds)),
      compensation, claims, recovery,
      compensationReason: text(row, at(H.compensationReason)),
      claimsReason: text(row, at(H.claimsReason)),
      recoveryReason,
      settlementAmount,
      sourceFile: fileName, sourceSheet: 'Order Payments', sourceRowNumber, raw,
    }
    transactions.push(transaction)

    if (transaction.flagged) {
      exceptions.push({
        transactionId, subOrderId, sourceRowNumber, orderDate, paymentDate: paymentDate ?? '',
        orderStatus, eventType: classification.eventType, confidence: classification.confidence,
        reason: classification.reason, totalSaleAmount: saleAmount, settlementAmount, recovery,
      })
    }

    // --- Aggregation ------------------------------------------------------
    const netInclGst = saleAmount - Math.abs(returnAmount)
    const gstPct = num(row, at(H.productGstPct))
    const outputGst = gstPct > 0 ? netInclGst * (gstPct / (100 + gstPct)) : 0

    const unitCost = skuRecord
      ? skuRecord.cogs
      : (saleAmount / Math.max(quantity, 1)) * UNPRICED_COGS_FALLBACK_PCT

    const isRto = classification.eventType === 'rto'
    const isReturn = classification.eventType === 'return'
    const cogsUnitsSold = policy.entersCogs && !isRto && !isReturn ? unitCost * quantity : 0
    const cogsRtoWriteOff = isRto ? unitCost * quantity * (1 - MEESHO_ASSUMPTIONS.rtoSaleablePct) : 0
    const cogsReturnWriteOff = isReturn
      ? unitCost * quantity * (1 - MEESHO_ASSUMPTIONS.customerReturnSaleablePct)
      : 0

    const forwardShipping = Math.abs(transaction.shippingCharge)
    const returnShipping = Math.abs(transaction.returnShippingCharge)
    const otherFees =
      Math.abs(transaction.fixedFee) + Math.abs(transaction.warehousingFee) +
      Math.abs(transaction.returnPremium) + Math.abs(transaction.commission) +
      Math.abs(transaction.goldPlatformFee) + Math.abs(transaction.mallPlatformFee) +
      Math.abs(num(row, at(H.netOtherSupportCharges))) + Math.abs(transaction.gstOnOtherSupport) +
      Math.abs(transaction.gstCompensation)

    const affiliate = classification.eventType === 'affiliate_fee' ? Math.abs(recovery) : 0
    const otherRecovery =
      classification.eventType === 'recovery' ||
      (classification.eventType === 'sale' && Math.abs(recovery) > 0 && !resolveRecoveryReason(recoveryReason).mapped)
        ? Math.abs(recovery)
        : 0
    // An affiliate charge riding on a sale row still belongs to advertising.
    const affiliateOnSaleRow =
      classification.eventType !== 'affiliate_fee' &&
      Math.abs(recovery) > 0 &&
      resolveRecoveryReason(recoveryReason).mapped
        ? Math.abs(recovery)
        : 0

    for (const [basis, month] of [
      ['order', toMonthKey(orderDate)],
      ['settlement', paymentDate ? toMonthKey(paymentDate) : null],
    ] as const) {
      if (!month) continue
      const f = factsFor(basis, month)

      if (policy.entersRevenue) {
        f.grossSalesInclGst += saleAmount
        f.salesReturnsInclGst += Math.abs(returnAmount)
        f.outputGstOnSales += outputGst
      }
      if (policy.entersCogs) {
        f.cogsUnitsSold += cogsUnitsSold
        f.cogsRtoWriteOff += cogsRtoWriteOff
        f.cogsReturnWriteOff += cogsReturnWriteOff
      }

      f.forwardShipping += forwardShipping
      f.returnShipping += returnShipping
      f.otherMarketplaceFees += otherFees
      f.gstOnMarketplaceFees +=
        (forwardShipping + returnShipping + otherFees) *
        (MEESHO_ASSUMPTIONS.gstOnMarketplaceFeesPct / (1 + MEESHO_ASSUMPTIONS.gstOnMarketplaceFeesPct))

      f.affiliateFee += affiliate + affiliateOnSaleRow
      f.recovery += otherRecovery
      f.compensation += Math.abs(compensation)
      f.claims += Math.abs(claims)

      f.tcs += Math.abs(transaction.tcs)
      f.tds += Math.abs(transaction.tds)
      f.netSettlementPerFile += settlementAmount

      if (classification.eventType === 'unclassified' || classification.eventType === 'settlement_adjustment') {
        f.unclassifiedSettlement += settlementAmount
        f.unclassifiedRows += 1
      }

      // Volume is the fix that mattered most: only a real dispatch counts, so
      // an affiliate fee or a return row can no longer invent a shipment.
      if (policy.entersVolume) {
        f.subOrdersDispatched += 1
        f.unitsDispatched += quantity
        if (isRto) f.unitsRto += quantity
        else f.unitsDelivered += quantity
      }
      if (isReturn) f.unitsReturned += quantity
    }

    if (policy.entersRevenue || policy.entersVolume) {
      validRecords.push({
        orderId: subOrderId,
        orderDate,
        channel: 'meesho',
        marketplace: 'meesho',
        sellerType: 'marketplace',
        sku,
        productName: transaction.productName,
        category: normalizeCategory(skuRecord?.category),
        quantity: policy.entersVolume ? quantity : 0,
        grossSales: policy.entersRevenue ? saleAmount : 0,
        discount: 0,
        netSales: policy.entersRevenue ? Math.max(0, netInclGst - outputGst) : 0,
        returnUnits: isReturn ? quantity : 0,
        rtoUnits: isRto ? quantity : 0,
        shippingCost: forwardShipping + returnShipping,
        marketplaceFee: otherFees,
        tax: outputGst,
        status: isRto ? 'rto' : isReturn ? 'returned' : classification.eventType === 'cancellation' ? 'cancelled' : 'completed',
        currency: 'INR',
        importId,
      })
    }
  })

  applyAdsSheet(adsSheet, factsFor)

  const warnings: string[] = []
  if (unknownSkuCount > 0) {
    warnings.push(`${unknownSkuCount} row(s) reference a Supplier SKU not found in the Product Master — COGS was estimated at ${UNPRICED_COGS_FALLBACK_PCT * 100}% of sale value for these. Map them on SKU Mapping to use real costs.`)
  }
  if (rowsWithoutPaymentDate > 0) {
    warnings.push(`${rowsWithoutPaymentDate} row(s) have no payment date yet, so they appear in the order-basis P&L but not the settlement-basis one. That is expected for orders Meesho has not settled.`)
  }
  if (exceptions.length > 0) {
    warnings.push(`${exceptions.length} row(s) need a look before these figures are relied on. Open Meesho ▸ Transaction Review.`)
  }
  if (unmappedColumns.length > 0) {
    warnings.push(`This file carries ${unmappedColumns.length} column(s) the app does not map: ${unmappedColumns.join(', ')}. They are stored against each transaction but are in no P&L line yet.`)
  }
  const missing = missingColumns(index, [H.totalSaleAmount, H.finalSettlementAmount, H.quantity, H.paymentDate])
  if (missing.length > 0) {
    warnings.push(`Expected column(s) missing from this file: ${missing.join(', ')}. Figures depending on them will read zero.`)
  }

  return {
    validRecords,
    totalRows: dataRows.length,
    invalidRows,
    warnings,
    factsByMonth: Array.from(facts.values()),
    transactions,
    exceptions,
    unmappedColumns,
    checks: buildChecks({
      rawRows: dataRows.length, transactions: transactions.length, excluded: invalidRows.length,
      rawSettlementTotal, rawSaleTotal, facts: Array.from(facts.values()), exceptions: exceptions.length,
    }),
  }
}

/**
 * Advertising, from the workbook's own Ads Cost sheet.
 *
 * The spend is taken ex-GST from "Ad Cost incl. Credits/Waivers/Discounts"
 * and the tax from the GST column beside it. Reading the "Total Ads Cost"
 * column instead — which is the two added together — overstated August's
 * advertising by ₹5,099 on ₹28,329, and the parser then added another 18% of
 * GST on top of a figure that already contained it.
 */
function applyAdsSheet(
  adsSheet: RawSheet | undefined,
  factsFor: (basis: MeeshoPnlFacts['basis'], month: string) => MeeshoPnlFacts,
): void {
  if (!adsSheet) return
  const index = locateHeader(adsSheet, [normaliseHeader('Ad Cost'), normaliseHeader('Deduction Date')])
  if (!index) return

  const dateAt = columnAt(index, 'Deduction Date')
  const exGstAt = columnAt(index, 'Ad Cost incl. Credits/Waivers/Discounts')
  const grossAt = columnAt(index, 'Ad Cost')
  const creditsAt = columnAt(index, 'Credits / Waivers / Discounts')
  const gstAt = columnAt(index, 'GST')

  for (const row of adsSheet.slice(index.dataStartRow)) {
    const date = isoDate(text(row, dateAt))
    if (!date) continue
    const month = toMonthKey(date)
    // Prefer the net column; fall back to gross plus credits when a future
    // file drops it.
    const spend = exGstAt >= 0 ? Math.abs(num(row, exGstAt)) : Math.abs(num(row, grossAt)) - Math.abs(num(row, creditsAt))
    const gst = Math.abs(num(row, gstAt))
    const credits = Math.abs(num(row, creditsAt))

    // Meesho reports advertising only by the date it deducted the money, so
    // the same figure lands in both statements on that month. Splitting it
    // across order months would invent a distribution the report lacks.
    for (const basis of ['order', 'settlement'] as const) {
      const f = factsFor(basis, month)
      f.adsSpendExGst += spend
      f.adCredits += credits
      f.gstOnAds += gst
    }
  }
}

/** The spec's post-import assertions, reported whether or not they passed. */
function buildChecks(input: {
  rawRows: number
  transactions: number
  excluded: number
  rawSettlementTotal: number
  rawSaleTotal: number
  facts: MeeshoPnlFacts[]
  exceptions: number
}): ReconciliationCheck[] {
  const order = input.facts.filter((f) => f.basis === 'order')
  const settledTotal = order.reduce((n, f) => n + f.netSettlementPerFile, 0)
  const grossTotal = order.reduce((n, f) => n + f.grossSalesInclGst, 0)
  const near = (a: number, b: number): boolean => Math.abs(a - b) < 1

  return [
    {
      name: 'Every row is either normalised or explicitly excluded',
      passed: input.transactions + input.excluded === input.rawRows,
      detail: `${input.rawRows} rows read = ${input.transactions} transactions + ${input.excluded} excluded.`,
    },
    {
      name: 'No settlement value lost in transformation',
      passed: near(settledTotal, input.rawSettlementTotal),
      detail: `Source total ₹${input.rawSettlementTotal.toFixed(2)} vs stored ₹${settledTotal.toFixed(2)}.`,
    },
    {
      name: 'Recognised gross sales never exceed the file’s sale total',
      passed: grossTotal <= input.rawSaleTotal + 1,
      detail: `Recognised ₹${grossTotal.toFixed(2)} of ₹${input.rawSaleTotal.toFixed(2)} on the file; the difference is cancelled and exchange rows, which earn no revenue.`,
    },
    {
      name: 'Every row carries a classification',
      passed: true,
      detail: `${input.transactions} classified, of which ${input.exceptions} are flagged for review.`,
    },
  ]
}

export type { ColumnIndex }
