import type { RawSheet } from '@/lib/csvParse'
import type { CanonicalSalesRecord, MeeshoPnlFacts, SkuMaster } from '@/data/models'
import type { NormalizeResult } from './types'
import { toMonthKey } from '@/lib/format'

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
  subOrderNo: 0, orderDate: 1, productName: 3, supplierSku: 4,
  liveOrderStatus: 7, quantity: 10, finalSettlementAmount: 13,
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
  factsByMonth: MeeshoPnlFacts[]
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
  const factsByMonth = new Map<string, MeeshoPnlFacts>()
  let unknownSkuCount = 0

  function factsFor(month: string): MeeshoPnlFacts {
    let f = factsByMonth.get(month)
    if (!f) {
      f = {
        month, grossSale: 0, returns: 0, forwardShipping: 0, reverseShipping: 0, returnPremium: 0,
        returnPremiumRecovered: 0, commission: 0, fixedFee: 0, warehousing: 0, goldFee: 0, mallFee: 0,
        otherSettlementCharge: 0, ads: 0, gst: 0, tcs: 0, tds: 0, compensation: 0, claims: 0, recovery: 0,
        settlementAmount: 0, cogs: 0,
      }
      factsByMonth.set(month, f)
    }
    return f
  }

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

    const month = toMonthKey(orderDate.toISOString().slice(0, 10))
    const grossSale = num(row, COL.totalSaleAmount)
    const returns = num(row, COL.totalSaleReturnAmount)
    const fixedFee = num(row, COL.fixedFee1) + num(row, COL.fixedFee2)
    const warehousing = num(row, COL.warehousingFee1) + num(row, COL.warehousingFee2)
    const returnPremium = num(row, COL.returnPremium)
    const returnPremiumRecovered = num(row, COL.returnPremiumOfReturn)
    const commission = num(row, COL.commission)
    const goldFee = num(row, COL.goldFee)
    const mallFee = num(row, COL.mallFee)
    const reverseShipping = num(row, COL.returnShippingCharge)
    const forwardShipping = num(row, COL.shippingCharge)
    const otherSettlementCharge = num(row, COL.netOtherSupportCharges) + num(row, COL.gstOnNetOtherSupport) + num(row, COL.gstCompensation)
    const tcs = num(row, COL.tcs)
    const tds = num(row, COL.tds)
    const compensation = num(row, COL.compensation)
    const claims = num(row, COL.claims)
    const recovery = num(row, COL.recovery)
    const settlementAmount = num(row, COL.finalSettlementAmount)

    const skuRecord = skuByCode.get(sku)
    if (!skuRecord) unknownSkuCount++
    const cogs = skuRecord ? skuRecord.cogs * quantity : grossSale * UNPRICED_COGS_FALLBACK_PCT

    const f = factsFor(month)
    f.grossSale += grossSale
    f.returns += Math.abs(returns)
    f.forwardShipping += Math.abs(forwardShipping)
    f.reverseShipping += Math.abs(reverseShipping)
    f.returnPremium += Math.abs(returnPremium)
    f.returnPremiumRecovered += Math.abs(returnPremiumRecovered)
    f.commission += Math.abs(commission)
    f.fixedFee += Math.abs(fixedFee)
    f.warehousing += Math.abs(warehousing)
    f.goldFee += Math.abs(goldFee)
    f.mallFee += Math.abs(mallFee)
    f.otherSettlementCharge += Math.abs(otherSettlementCharge)
    f.tcs += Math.abs(tcs)
    f.tds += Math.abs(tds)
    f.compensation += Math.abs(compensation)
    f.claims += Math.abs(claims)
    f.recovery += Math.abs(recovery)
    f.settlementAmount += settlementAmount
    f.cogs += cogs

    const status = String(row[COL.liveOrderStatus] ?? '')

    validRecords.push({
      orderId: subOrderNo,
      orderDate: orderDate.toISOString().slice(0, 10),
      channel: 'meesho',
      marketplace: 'meesho',
      sellerType: 'marketplace',
      sku,
      productName: skuRecord?.productName ?? String(row[COL.productName] ?? sku),
      category: skuRecord?.category ?? 'Uncategorized',
      quantity,
      grossSales: grossSale,
      discount: 0,
      netSales: Math.max(0, grossSale - Math.abs(returns)),
      returnUnits: mapOrderStatus(status) === 'returned' ? quantity : 0,
      rtoUnits: mapOrderStatus(status) === 'rto' ? quantity : 0,
      shippingCost: Math.abs(forwardShipping) + Math.abs(reverseShipping),
      marketplaceFee: Math.abs(commission) + Math.abs(fixedFee) + Math.abs(warehousing),
      tax: Math.abs(tcs) + Math.abs(tds),
      status: mapOrderStatus(status),
      currency: 'INR',
      importId,
    })
  })

  if (adsSheet) {
    const adsDataStart = 3 // title, header, formula-key rows precede data
    for (const row of adsSheet.slice(adsDataStart)) {
      const dateRaw = String(row[0] ?? row[1] ?? '')
      const d = new Date(dateRaw)
      if (Number.isNaN(d.getTime())) continue
      const month = toMonthKey(d.toISOString().slice(0, 10))
      const totalAdsCost = Number(row[7])
      factsFor(month).ads += Math.abs(Number.isFinite(totalAdsCost) ? totalAdsCost : 0)
    }
  }

  const warnings: string[] = []
  if (unknownSkuCount > 0) {
    warnings.push(`${unknownSkuCount} row(s) reference a Supplier SKU not found in the Product Master — COGS was estimated at 25% of sale value for these.`)
  }

  return {
    validRecords,
    totalRows: dataRows.length,
    invalidRows,
    warnings,
    factsByMonth: Array.from(factsByMonth.values()),
  }
}
