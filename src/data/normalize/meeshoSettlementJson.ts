import type { CanonicalSalesRecord, MeeshoPnlFacts, SkuMaster } from '@/data/models'
import type { NormalizeResult } from './types'

/**
 * Ingests the compact Meesho settlement JSON schema (order-level rows keyed
 * by the ROWF field-code array, plus a SKU-mapping table for combo/free-text
 * listings) — real shape confirmed from Aravi_Meesho_data_202608_4.json.
 * This is the source for Meesho's native channel P&L; the simpler raw
 * "Order Summary" CSV has no fee breakdown and only feeds Sales/SKU analytics.
 */
export interface MeeshoSettlementJson {
  v: number
  ROWF: string[]
  orders: (string | number)[][]
  map?: Record<string, { c1?: string; q1?: number; c2?: string; q2?: number }>
  /** [compositeKey, month, campaignId, adCost, credits, gst, totalAdsCost][] */
  ads?: (string | number)[][]
}

const REQUIRED_FIELDS = ['om', 'sku', 'status', 'qty', 'sale'] as const
const UNPRICED_COGS_FALLBACK_PCT = 0.25

export function isMeeshoSettlementJson(data: unknown): data is MeeshoSettlementJson {
  if (typeof data !== 'object' || data === null) return false
  const d = data as Record<string, unknown>
  return Array.isArray(d.ROWF) && Array.isArray(d.orders) && REQUIRED_FIELDS.every((f) => (d.ROWF as string[]).includes(f))
}

function resolveCogsPerUnit(sku: string, name: string, skuMaster: SkuMaster[], map: MeeshoSettlementJson['map']): { cogsPerUnit: number; priced: boolean } {
  const direct = skuMaster.find((s) => s.sku === sku)
  if (direct) return { cogsPerUnit: direct.cogs, priced: true }

  const mapped = map?.[sku] ?? map?.[name]
  if (mapped?.c1) {
    const component = skuMaster.find((s) => s.sku === mapped.c1)
    if (component) {
      const qty = mapped.q1 ?? 1
      const secondComponent = mapped.c2 ? skuMaster.find((s) => s.sku === mapped.c2) : undefined
      const secondQty = mapped.q2 ?? 0
      return { cogsPerUnit: component.cogs * qty + (secondComponent ? secondComponent.cogs * secondQty : 0), priced: true }
    }
  }
  return { cogsPerUnit: 0, priced: false }
}

export interface MeeshoJsonNormalizeResult extends NormalizeResult {
  factsByMonth: MeeshoPnlFacts[]
}

export function normalizeMeeshoSettlementJson(data: MeeshoSettlementJson, skuMaster: SkuMaster[], importId: string): MeeshoJsonNormalizeResult {
  const idx = (field: string) => data.ROWF.indexOf(field)
  const i = {
    om: idx('om'), odS: idx('odS'), sku: idx('sku'), name: idx('name'), status: idx('status'),
    sub: idx('sub'), qty: idx('qty'), sale: idx('sale'), ret: idx('ret'), fwd: idx('fwd'),
    rship: idx('rship'), rprem: idx('rprem'), rpremR: idx('rpremR'), comm: idx('comm'), ffee: idx('ffee'),
    wh: idx('wh'), gold: idx('gold'), mall: idx('mall'), oss: idx('oss'), gstOss: idx('gstOss'),
    gst: idx('gst'), tcs: idx('tcs'), tds: idx('tds'), comp: idx('comp'), claims: idx('claims'), rec: idx('rec'),
    settle: idx('settle'),
  }

  const validRecords: CanonicalSalesRecord[] = []
  const invalidRows: NormalizeResult['invalidRows'] = []
  const factsByMonth = new Map<string, MeeshoPnlFacts>()
  let unpricedCount = 0

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

  data.orders.forEach((row, rowIndex) => {
    const month = String(row[i.om] ?? '')
    const sku = String(row[i.sku] ?? '')
    const name = String(row[i.name] ?? '')
    const qty = Number(row[i.qty]) || 0

    if (!month) return invalidRows.push({ rowIndex, reason: 'Missing order month' })
    if (!sku) return invalidRows.push({ rowIndex, reason: 'Missing SKU' })

    const sale = Math.abs(Number(row[i.sale]) || 0)
    const ret = Math.abs(Number(row[i.ret]) || 0)
    const fwd = Math.abs(Number(row[i.fwd]) || 0)
    const rship = Math.abs(Number(row[i.rship]) || 0)
    const rprem = Math.abs(Number(row[i.rprem]) || 0)
    const rpremR = Math.abs(Number(row[i.rpremR]) || 0)
    const comm = Math.abs(Number(row[i.comm]) || 0)
    const ffee = Math.abs(Number(row[i.ffee]) || 0)
    const wh = Math.abs(Number(row[i.wh]) || 0)
    const gold = Math.abs(Number(row[i.gold]) || 0)
    const mall = Math.abs(Number(row[i.mall]) || 0)
    const oss = Math.abs(Number(row[i.oss]) || 0)
    const gstOss = Math.abs(Number(row[i.gstOss]) || 0)
    const gst = Math.abs(Number(row[i.gst]) || 0)
    const tcs = Math.abs(Number(row[i.tcs]) || 0)
    const tds = Math.abs(Number(row[i.tds]) || 0)
    const comp = Math.abs(Number(row[i.comp]) || 0)
    const claims = Math.abs(Number(row[i.claims]) || 0)
    const rec = Math.abs(Number(row[i.rec]) || 0)

    const { cogsPerUnit, priced } = resolveCogsPerUnit(sku, name, skuMaster, data.map)
    if (!priced) unpricedCount++
    const cogs = priced ? cogsPerUnit * qty : sale * UNPRICED_COGS_FALLBACK_PCT

    const f = factsFor(month)
    f.grossSale += sale
    f.returns += ret
    f.forwardShipping += fwd
    f.reverseShipping += rship
    f.returnPremium += rprem
    f.returnPremiumRecovered += rpremR
    f.commission += comm
    f.fixedFee += ffee
    f.warehousing += wh
    f.goldFee += gold
    f.mallFee += mall
    f.otherSettlementCharge += oss
    f.gst += gst + gstOss
    f.tcs += tcs
    f.tds += tds
    f.compensation += comp
    f.claims += claims
    f.recovery += rec
    f.settlementAmount += Number(row[i.settle]) || 0
    f.cogs += cogs

    const status = String(row[i.status] ?? '').toLowerCase()
    const orderDateRaw = i.odS >= 0 ? String(row[i.odS] ?? '') : ''
    const orderDate = orderDateRaw && !Number.isNaN(new Date(orderDateRaw).getTime()) ? orderDateRaw : `${month}-01`
    const skuMasterEntry = skuMaster.find((s) => s.sku === sku)

    validRecords.push({
      orderId: String(row[i.sub] ?? `meesho-${rowIndex}`),
      orderDate,
      channel: 'meesho',
      marketplace: 'meesho',
      sellerType: 'marketplace',
      sku,
      productName: skuMasterEntry?.productName ?? name ?? sku,
      category: skuMasterEntry?.category ?? 'Uncategorized',
      quantity: qty,
      grossSales: sale,
      discount: 0,
      netSales: Math.max(0, sale - ret),
      returnUnits: status.includes('return') ? qty : 0,
      rtoUnits: status.includes('rto') ? qty : 0,
      shippingCost: fwd + rship,
      marketplaceFee: comm + ffee + wh + gold + mall + oss,
      tax: gst + tcs + tds,
      status: status.includes('cancel') ? 'cancelled' : status.includes('rto') ? 'rto' : status.includes('return') ? 'returned' : 'completed',
      currency: 'INR',
      importId,
    })
  })

  for (const adRow of data.ads ?? []) {
    const month = String(adRow[1] ?? '')
    if (!month) continue
    factsFor(month).ads += Math.abs(Number(adRow[6]) || 0)
  }

  const warnings: string[] = []
  if (unpricedCount > 0) {
    warnings.push(`${unpricedCount} row(s) had no direct or mapped SKU cost — COGS was estimated at 25% of sale value for these.`)
  }

  return {
    validRecords,
    totalRows: data.orders.length,
    invalidRows,
    warnings,
    factsByMonth: Array.from(factsByMonth.values()),
  }
}
