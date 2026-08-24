import type { RawSheet } from '@/lib/csvParse'
import type { CanonicalSalesRecord, MeeshoPnlFacts, SkuMaster } from '@/data/models'
import type { NormalizeResult } from './types'
import { toMonthKey } from '@/lib/format'
import { normalizeCategory } from '@/data/categories'
import { MEESHO_ASSUMPTIONS } from '@/config/nativePnlAssumptions'

/**
 * Normalizes Meesho's real "Order Payments" sheet from the aggregated
 * payment file (Payments ▸ Order Payments, downloaded as
 * "..._AGGREGATED_PAYMENT_FILE_...xlsx"). The sheet has three header-ish
 * rows before data starts — a group-label row, the real column-name row, and
 * a row of formula keys (A, B, C, ... referencing the column letters in
 * Meesho's own settlement-amount formula) — real data begins on row 4.
 *
 * Two columns share the exact label "Fixed Fee (Incl. GST)" (an original-order
 * instance and a returns/adjustment instance) and likewise for the
 * warehousing fee, so this reads by fixed column position rather than by
 * header-name lookup, which cannot distinguish same-named columns.
 */

const COL = {
  subOrderNo: 0, orderDate: 1, dispatchDate: 2, productName: 3, supplierSku: 4,
  liveOrderStatus: 7, productGstPct: 8, quantity: 10,
  paymentDate: 12, finalSettlementAmount: 13,
  totalSaleAmount: 15, totalSaleReturnAmount: 16,
  fixedFee1: 17, warehousingFee1: 18, returnPremium: 19, returnPremiumOfReturn: 20,
  commission: 22, goldFee: 23, mallFee: 24, fixedFee2: 25, warehousingFee2: 26,
  returnShippingCharge: 27, gstCompensation: 28, shippingCharge: 29,
  netOtherSupportCharges: 32, gstOnNetOtherSupport: 33, tcs: 34, tds: 36,
  compensation: 37, claims: 38, recovery: 39,
}

const DATA_START_ROW = 3 // 0-indexed — row 4 in the spreadsheet

const UNPRICED_COGS_FALLBACK_PCT = 0.25

export function detectMeeshoOrderPaymentsSheet(sheet: RawSheet | undefined): boolean {
  if (!sheet || sheet.length < 2) return false
  const headerRow = sheet[1] ?? []
  const joined = headerRow.map((c) => String(c).toLowerCase()).join('|')
  return joined.includes('sub order no') && joined.includes('final settlement amount')
}

function num(row: (string | number)[], col: number): number {
  const v = row[col]
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

function mapOrderStatus(raw: string): CanonicalSalesRecord['status'] {
  const v = raw.toLowerCase()
  if (v.includes('cancel')) return 'cancelled'
  if (v.includes('rto')) return 'rto'
  if (v.includes('return')) return 'returned'
  return 'completed'
}

export interface MeeshoOrderPaymentsResult extends NormalizeResult {
  /** Both bases, from the same rows. An order row carries an order date and a
   * payment date, so bucketing it twice costs one extra pass and answers two
   * genuinely different questions rather than forcing a choice between them. */
  factsByMonth: MeeshoPnlFacts[]
}

/** A fresh, all-zero month for one basis. */
function emptyFacts(month: string, basis: MeeshoPnlFacts['basis']): MeeshoPnlFacts {
  return {
    schemaVersion: 2, month, basis,
    grossSalesInclGst: 0, salesReturnsInclGst: 0, outputGstOnSales: 0,
    cogsUnitsSold: 0, cogsRtoWriteOff: 0, cogsReturnWriteOff: 0,
    forwardShipping: 0, returnShipping: 0, otherMarketplaceFees: 0,
    adsSpendExGst: 0, adCredits: 0,
    compensation: 0, claims: 0, recovery: 0, platformRecoverySubscriptions: 0,
    subOrdersDispatched: 0, unitsDispatched: 0, unitsDelivered: 0, unitsRto: 0, unitsReturned: 0,
    tcs: 0, tds: 0, gstOnMarketplaceFees: 0, gstOnAds: 0, netSettlementPerFile: 0,
  }
}

export function normalizeMeeshoOrderPayments(
  sheet: RawSheet,
  adsSheet: RawSheet | undefined,
  skuMaster: SkuMaster[],
  importId: string,
): MeeshoOrderPaymentsResult {
  const validRecords: CanonicalSalesRecord[] = []
  const invalidRows: NormalizeResult['invalidRows'] = []
  const skuByCode = new Map(skuMaster.map((s) => [s.sku, s]))

  // Keyed "basis|month" so one pass fills both statements.
  const facts = new Map<string, MeeshoPnlFacts>()
  const factsFor = (basis: MeeshoPnlFacts['basis'], month: string): MeeshoPnlFacts => {
    const key = `${basis}|${month}`
    let f = facts.get(key)
    if (!f) { f = emptyFacts(month, basis); facts.set(key, f) }
    return f
  }

  let unknownSkuCount = 0
  let rowsWithoutPaymentDate = 0

  const dataRows = sheet.slice(DATA_START_ROW)
  dataRows.forEach((row, rowIndex) => {
    const subOrderNo = String(row[COL.subOrderNo] ?? '').trim()
    const sku = String(row[COL.supplierSku] ?? '').trim()
    const orderDateRaw = String(row[COL.orderDate] ?? '').trim()
    if (!subOrderNo) return invalidRows.push({ rowIndex, reason: 'Missing Sub Order No' })
    if (!sku) return invalidRows.push({ rowIndex, reason: 'Missing Supplier SKU' })
    if (!orderDateRaw) return invalidRows.push({ rowIndex, reason: 'Missing Order Date' })

    const orderDate = new Date(orderDateRaw)
    if (Number.isNaN(orderDate.getTime())) return invalidRows.push({ rowIndex, reason: `Invalid date: "${orderDateRaw}"` })

    const quantity = num(row, COL.quantity)
    if (quantity <= 0) return invalidRows.push({ rowIndex, reason: 'Zero or missing quantity' })

    const orderMonth = toMonthKey(orderDate.toISOString().slice(0, 10))
    const paymentRaw = String(row[COL.paymentDate] ?? '').trim()
    const paymentDate = paymentRaw ? new Date(paymentRaw) : null
    const paymentMonth =
      paymentDate && !Number.isNaN(paymentDate.getTime())
        ? toMonthKey(paymentDate.toISOString().slice(0, 10))
        : null
    if (!paymentMonth) rowsWithoutPaymentDate++

    const grossSale = num(row, COL.totalSaleAmount)
    // Meesho writes returns as a negative; the P&L wants a positive magnitude.
    const returns = Math.abs(num(row, COL.totalSaleReturnAmount))
    const netInclGst = grossSale - returns

    // GST is taken at each product's own rate. The catalogue mixes 5% and 18%
    // lines, so a single blended rate would be wrong by a material amount.
    const gstPct = num(row, COL.productGstPct)
    const outputGst = gstPct > 0 ? netInclGst * (gstPct / (100 + gstPct)) : 0

    const forwardShipping = Math.abs(num(row, COL.shippingCharge))
    const returnShipping = Math.abs(num(row, COL.returnShippingCharge))
    const otherFees =
      Math.abs(num(row, COL.fixedFee1)) + Math.abs(num(row, COL.fixedFee2)) +
      Math.abs(num(row, COL.warehousingFee1)) + Math.abs(num(row, COL.warehousingFee2)) +
      Math.abs(num(row, COL.returnPremium)) + Math.abs(num(row, COL.returnPremiumOfReturn)) +
      Math.abs(num(row, COL.commission)) + Math.abs(num(row, COL.goldFee)) + Math.abs(num(row, COL.mallFee)) +
      Math.abs(num(row, COL.netOtherSupportCharges)) + Math.abs(num(row, COL.gstOnNetOtherSupport)) +
      Math.abs(num(row, COL.gstCompensation))

    const tcs = Math.abs(num(row, COL.tcs))
    const tds = Math.abs(num(row, COL.tds))
    const compensation = Math.abs(num(row, COL.compensation))
    const claims = Math.abs(num(row, COL.claims))
    const recovery = Math.abs(num(row, COL.recovery))
    const settlementAmount = num(row, COL.finalSettlementAmount)

    const status = mapOrderStatus(String(row[COL.liveOrderStatus] ?? ''))
    const isRto = status === 'rto'
    const isReturned = status === 'returned'
    const isCancelled = status === 'cancelled'

    const skuRecord = skuByCode.get(sku)
    if (!skuRecord) unknownSkuCount++
    const unitCost = skuRecord ? skuRecord.cogs : (grossSale / Math.max(quantity, 1)) * UNPRICED_COGS_FALLBACK_PCT

    // Stock that came back is split: the saleable part returns to inventory and
    // is not a cost of sale; the rest is written off. Charging the whole
    // returned quantity to COGS would overstate cost, and charging none of it
    // would hide real shrinkage.
    const cogsUnitsSold = isRto || isReturned || isCancelled ? 0 : unitCost * quantity
    const cogsRtoWriteOff = isRto ? unitCost * quantity * (1 - MEESHO_ASSUMPTIONS.rtoSaleablePct) : 0
    const cogsReturnWriteOff = isReturned
      ? unitCost * quantity * (1 - MEESHO_ASSUMPTIONS.customerReturnSaleablePct)
      : 0

    for (const [basis, month] of [['order', orderMonth], ['settlement', paymentMonth]] as const) {
      if (!month) continue
      const f = factsFor(basis, month)
      f.grossSalesInclGst += grossSale
      f.salesReturnsInclGst += returns
      f.outputGstOnSales += outputGst
      f.cogsUnitsSold += cogsUnitsSold
      f.cogsRtoWriteOff += cogsRtoWriteOff
      f.cogsReturnWriteOff += cogsReturnWriteOff
      f.forwardShipping += forwardShipping
      f.returnShipping += returnShipping
      f.otherMarketplaceFees += otherFees
      f.compensation += compensation
      f.claims += claims
      f.recovery += recovery
      f.tcs += tcs
      f.tds += tds
      f.gstOnMarketplaceFees +=
        (forwardShipping + returnShipping + otherFees) *
        (MEESHO_ASSUMPTIONS.gstOnMarketplaceFeesPct / (1 + MEESHO_ASSUMPTIONS.gstOnMarketplaceFeesPct))
      f.netSettlementPerFile += settlementAmount
      if (!isCancelled) {
        f.subOrdersDispatched += 1
        f.unitsDispatched += quantity
        if (isRto) f.unitsRto += quantity
        else if (isReturned) f.unitsReturned += quantity
        else f.unitsDelivered += quantity
      }
    }

    validRecords.push({
      orderId: subOrderNo,
      orderDate: orderDate.toISOString().slice(0, 10),
      channel: 'meesho',
      marketplace: 'meesho',
      sellerType: 'marketplace',
      sku,
      productName: skuRecord?.productName ?? String(row[COL.productName] ?? sku),
      category: normalizeCategory(skuRecord?.category),
      quantity,
      grossSales: grossSale,
      discount: 0,
      // Net of GST, matching the P&L's revenue definition, so the order rows
      // and the statement cannot disagree about what a sale was worth.
      netSales: Math.max(0, netInclGst - outputGst),
      returnUnits: isReturned ? quantity : 0,
      rtoUnits: isRto ? quantity : 0,
      shippingCost: forwardShipping + returnShipping,
      marketplaceFee: otherFees,
      tax: outputGst,
      status,
      currency: 'INR',
      importId,
    })
  })

  // Meesho reports advertising only by the date it deducted the money, so the
  // same figure lands in both statements on that month. Splitting it across
  // order months would be inventing a distribution the report does not carry.
  if (adsSheet) {
    const adsDataStart = 3 // title, header and formula-key rows precede data
    for (const row of adsSheet.slice(adsDataStart)) {
      const dateRaw = String(row[0] ?? row[1] ?? '')
      const d = new Date(dateRaw)
      if (Number.isNaN(d.getTime())) continue
      const month = toMonthKey(d.toISOString().slice(0, 10))
      const spend = Math.abs(Number(row[7]) || 0)
      for (const basis of ['order', 'settlement'] as const) {
        const f = factsFor(basis, month)
        f.adsSpendExGst += spend
        f.gstOnAds += spend * MEESHO_ASSUMPTIONS.gstOnAdvertisingPct
      }
    }
  }

  const warnings: string[] = []
  if (unknownSkuCount > 0) {
    warnings.push(`${unknownSkuCount} row(s) reference a Supplier SKU not found in the Product Master — COGS was estimated at ${UNPRICED_COGS_FALLBACK_PCT * 100}% of sale value for these. Map them on SKU Mapping to use real costs.`)
  }
  if (rowsWithoutPaymentDate > 0) {
    warnings.push(`${rowsWithoutPaymentDate} row(s) have no payment date yet, so they appear in the order-basis P&L but not the settlement-basis one. That is expected for orders Meesho has not settled.`)
  }

  return {
    validRecords,
    totalRows: dataRows.length,
    invalidRows,
    warnings,
    factsByMonth: Array.from(facts.values()),
  }
}
