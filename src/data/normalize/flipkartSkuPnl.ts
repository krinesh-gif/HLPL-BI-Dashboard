import type { CanonicalSalesRecord, FlipkartPnlFacts, SkuMaster } from '@/data/models'
import { getField, type NormalizeResult } from './types'
import { normalizeCategory } from '@/data/categories'

// Column names as they appear in Flipkart's "SKU-level P&L" export (Seller Hub
// ▸ Reports ▸ Profit & Loss). One row per SKU per month (Flipkart aggregates
// this report monthly, not per order) — so canonical records built from it
// carry monthly granularity, not daily.
const COLUMNS = {
  sku: ['sku id', 'sku'],
  grossUnits: ['gross units'],
  retCancUnits: ['ret & canc units'],
  rtoUnits: ['rto units'],
  netUnits: ['net units'],
  estimatedNetSales: ['estimated net sales'],
  orderItemValue: ['order item value'],
  commissionFee: ['commission fee'],
  collectionFee: ['collection fee'],
  fixedFee: ['fixed fee'],
  pickAndPack: ['pick and pack fee', 'pick and pack'],
  forwardShipping: ['forward shipping fee', 'forward shipping'],
  reverseShipping: ['reverse shipping fee', 'reverse shipping'],
  storageFee: ['storage fee'],
  recallFee: ['recall fee'],
}
const OTHER_FEE_COLUMNS = ['offer adjustments', 'no cost emi', 'installation', 'tech visit', 'uninstall & pack', 'franchise fee', 'shopsy mktg fee', 'product cancel fee']
const REWARDS_COLUMNS = ['rewards', 'order spf', 'non order spf', 'add-ons recovery']

export function detectFlipkartSkuPnlReport(headers: string[]): boolean {
  const normalized = headers.map((h) => h.trim().toLowerCase())
  return normalized.some((h) => COLUMNS.sku.includes(h)) && normalized.some((h) => COLUMNS.estimatedNetSales.includes(h))
}

function num(row: Record<string, string>, candidates: string[]): number {
  const v = getField(row, candidates)
  const n = Number(v)
  return Number.isFinite(n) ? Math.abs(n) : 0
}

export interface FlipkartNormalizeResult extends NormalizeResult {
  facts: FlipkartPnlFacts
}

/** `month` (yyyy-mm) must be supplied by the uploader — this report doesn't carry a date column of its own. */
export function normalizeFlipkartSkuPnl(
  rows: Record<string, string>[],
  skuMaster: SkuMaster[],
  month: string,
  importId: string,
): FlipkartNormalizeResult {
  const validRecords: CanonicalSalesRecord[] = []
  const invalidRows: NormalizeResult['invalidRows'] = []
  const skuByCode = new Map(skuMaster.map((s) => [s.sku, s]))
  let unknownSkuCount = 0

  const facts: FlipkartPnlFacts = {
    month, grossSales: 0, estimatedNetSales: 0, cogsPriced: 0, cogsUnpriced: 0,
    commissionFee: 0, collectionFee: 0, fixedFee: 0, pickPackFee: 0, forwardShippingFee: 0,
    reverseShippingFee: 0, storageFee: 0, recallFee: 0, otherMarketplaceFees: 0, rewardsSpf: 0,
    flipkartAds: 0, sellerFundedDiscount: 0, customerAddOns: 0, outputGst: 0, googleAds: 0,
  }

  rows.forEach((row, rowIndex) => {
    const sku = getField(row, COLUMNS.sku)
    if (!sku) return invalidRows.push({ rowIndex, reason: 'Missing SKU' })

    const netUnits = num(row, COLUMNS.netUnits)
    const grossUnits = num(row, COLUMNS.grossUnits)
    if (grossUnits <= 0 && netUnits <= 0) return invalidRows.push({ rowIndex, reason: 'Zero gross and net units' })

    const estimatedNetSales = num(row, COLUMNS.estimatedNetSales)
    const orderItemValue = num(row, COLUMNS.orderItemValue) || estimatedNetSales
    const retCancUnits = num(row, COLUMNS.retCancUnits)
    const rtoUnits = num(row, COLUMNS.rtoUnits)

    const skuRecord = skuByCode.get(sku)
    if (!skuRecord) unknownSkuCount++
    const cogsPerUnit = skuRecord?.cogs ?? 0

    facts.grossSales += orderItemValue
    facts.estimatedNetSales += estimatedNetSales
    if (skuRecord) facts.cogsPriced += cogsPerUnit * netUnits
    else facts.cogsUnpriced += orderItemValue * 0.25 // unpriced-SKU estimate, matches the real model's fallback bucket
    // Each fee is added to the month and kept against the SKU that carried it.
    // The report is one row per SKU, so the split is the file's own and costs
    // nothing to keep — and without it the statement can say a fee cost
    // ₹69,228 but not which products it came from, which is the half that
    // leads to a decision.
    const perSku: Record<string, number> = {}
    const charge = (field: keyof FlipkartPnlFacts & string, amount: number): void => {
      if (amount === 0) return
      ;(facts[field] as number) += amount
      perSku[field] = (perSku[field] ?? 0) + amount
    }

    charge('commissionFee', num(row, COLUMNS.commissionFee))
    charge('collectionFee', num(row, COLUMNS.collectionFee))
    charge('fixedFee', num(row, COLUMNS.fixedFee))
    charge('pickPackFee', num(row, COLUMNS.pickAndPack))
    charge('forwardShippingFee', num(row, COLUMNS.forwardShipping))
    charge('reverseShippingFee', num(row, COLUMNS.reverseShipping))
    charge('storageFee', num(row, COLUMNS.storageFee))
    charge('recallFee', num(row, COLUMNS.recallFee))
    charge('otherMarketplaceFees', OTHER_FEE_COLUMNS.reduce((sum, c) => sum + num(row, [c]), 0))
    charge('rewardsSpf', REWARDS_COLUMNS.reduce((sum, c) => sum + num(row, [c]), 0))

    if (Object.keys(perSku).length > 0) {
      // A SKU can legitimately appear on more than one row, so its fees add up
      // rather than the later row replacing the earlier one.
      const existing = (facts.feeBySku ??= {})[sku]
      if (existing) for (const [field, amount] of Object.entries(perSku)) existing[field] = (existing[field] ?? 0) + amount
      else facts.feeBySku[sku] = perSku
    }

    validRecords.push({
      orderId: `flipkart-${sku}-${month}`,
      orderDate: `${month}-01`,
      channel: 'flipkart',
      marketplace: 'flipkart',
      sellerType: 'marketplace',
      sku,
      productName: skuRecord?.productName ?? sku,
      category: normalizeCategory(skuRecord?.category),
      quantity: netUnits,
      grossSales: orderItemValue,
      discount: 0,
      netSales: estimatedNetSales,
      returnUnits: retCancUnits,
      rtoUnits,
      shippingCost: num(row, COLUMNS.forwardShipping) + num(row, COLUMNS.reverseShipping),
      marketplaceFee: num(row, COLUMNS.commissionFee) + num(row, COLUMNS.fixedFee) + num(row, COLUMNS.pickAndPack),
      tax: 0,
      isAggregate: true,
      status: 'completed',
      currency: 'INR',
      raw: row,
      importId,
    })
  })

  const warnings: string[] = []
  if (unknownSkuCount > 0) {
    warnings.push(
      `${unknownSkuCount} row(s) reference a SKU not found in the Product Master — COGS for these was estimated at 25% of revenue (matches the real model's "unpriced SKU" fallback), not looked up.`,
    )
  }
  warnings.push(
    'This report gives one row per SKU per month, not per order — Daily Sales trend charts for Flipkart will show one point per month until an order-level report is added.',
  )

  return { validRecords, totalRows: rows.length, invalidRows, warnings, facts }
}
